/**
 * RPC.do Gateway Promise Pipelining
 *
 * Implements Cap'n Proto style promise pipelining for efficient RPC:
 * - Multiple calls batched in single network round trip
 * - Pipeline references allow chaining without awaiting intermediate results
 * - Automatic dependency resolution and parallel execution
 *
 * @module services/rpc/pipeline
 */

import type {
  GatewayRequest,
  GatewayResponse,
  BatchedRequest,
  BatchedResponse,
  PipelineReference,
  AuthContext,
} from './types'
import { GatewayRouter, RequestContext } from './router'
import { safeJsonClone } from '../../../lib/safe-stringify'

// ============================================================================
// Types
// ============================================================================

/**
 * Pipeline request with optional dependencies
 */
export interface PipelineRequest extends GatewayRequest {
  /** Request dependencies (other request IDs that must complete first) */
  depends?: string[]
  /** Pipeline expressions to inject into params */
  pipeline?: PipelineExpression[]
}

/**
 * Pipeline expression for extracting values from previous results
 */
export interface PipelineExpression {
  /** Source request ID */
  from: string
  /** JSONPath expression to extract value */
  path: string
  /** Target parameter path to inject into */
  into: string
}

/**
 * Execution plan for a batch of requests
 */
export interface ExecutionPlan {
  /** Execution stages (requests in same stage can run in parallel) */
  stages: PipelineRequest[][]
  /** Dependency graph */
  dependencies: Map<string, Set<string>>
  /** Detected cycles (if any) */
  cycles?: string[][]
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  /** Request ID */
  id: string
  /** Result value */
  value?: unknown
  /** Error if failed */
  error?: { code: string; message: string }
  /** Execution duration */
  durationMs: number
}

// ============================================================================
// Execution Planner
// ============================================================================

/**
 * Build execution plan from batch of requests
 *
 * Analyzes dependencies and creates staged execution plan for maximum parallelism
 */
export function buildExecutionPlan(requests: PipelineRequest[]): ExecutionPlan {
  const requestMap = new Map(requests.map((r) => [r.id, r]))
  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()

  // Build dependency graph
  for (const request of requests) {
    const deps = new Set<string>()
    dependencies.set(request.id, deps)

    if (!dependents.has(request.id)) {
      dependents.set(request.id, new Set())
    }

    // Explicit dependencies
    if (request.depends) {
      for (const dep of request.depends) {
        deps.add(dep)
        if (!dependents.has(dep)) {
          dependents.set(dep, new Set())
        }
        dependents.get(dep)!.add(request.id)
      }
    }

    // Pipeline expression dependencies
    if (request.pipeline) {
      for (const expr of request.pipeline) {
        deps.add(expr.from)
        if (!dependents.has(expr.from)) {
          dependents.set(expr.from, new Set())
        }
        dependents.get(expr.from)!.add(request.id)
      }
    }
  }

  // Detect cycles using DFS
  const cycles = detectCycles(requests.map((r) => r.id), dependencies)
  if (cycles.length > 0) {
    return { stages: [], dependencies, cycles }
  }

  // Topological sort into stages (Kahn's algorithm)
  const stages: PipelineRequest[][] = []
  const inDegree = new Map<string, number>()
  const remaining = new Set(requests.map((r) => r.id))

  // Calculate initial in-degrees
  for (const request of requests) {
    const deps = dependencies.get(request.id)!
    // Only count dependencies that are part of this batch
    const validDeps = [...deps].filter((d) => requestMap.has(d))
    inDegree.set(request.id, validDeps.length)
  }

  // Process stages
  while (remaining.size > 0) {
    // Find all nodes with in-degree 0
    const stage: PipelineRequest[] = []
    for (const id of remaining) {
      if ((inDegree.get(id) || 0) === 0) {
        const request = requestMap.get(id)
        if (request) {
          stage.push(request)
        }
      }
    }

    if (stage.length === 0) {
      // No progress possible - should not happen if cycle detection worked
      break
    }

    // Remove nodes from remaining and update in-degrees
    for (const request of stage) {
      remaining.delete(request.id)
      const deps = dependents.get(request.id) || new Set()
      for (const depId of deps) {
        const degree = inDegree.get(depId) || 0
        inDegree.set(depId, degree - 1)
      }
    }

    stages.push(stage)
  }

  return { stages, dependencies }
}

/**
 * Detect cycles in dependency graph using DFS
 */
function detectCycles(
  nodes: string[],
  dependencies: Map<string, Set<string>>
): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const path = new Set<string>()
  const pathList: string[] = []

  function dfs(node: string): boolean {
    if (path.has(node)) {
      // Found cycle - extract it
      const cycleStart = pathList.indexOf(node)
      cycles.push(pathList.slice(cycleStart))
      return true
    }

    if (visited.has(node)) {
      return false
    }

    visited.add(node)
    path.add(node)
    pathList.push(node)

    const deps = dependencies.get(node) || new Set()
    for (const dep of deps) {
      if (dependencies.has(dep)) {
        // Only check deps that are part of the graph
        dfs(dep)
      }
    }

    path.delete(node)
    pathList.pop()

    return false
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      dfs(node)
    }
  }

  return cycles
}

// ============================================================================
// Pipeline Executor
// ============================================================================

/**
 * Pipeline executor for batched RPC calls
 */
export class PipelineExecutor {
  private router: GatewayRouter

  constructor(router: GatewayRouter) {
    this.router = router
  }

  /**
   * Execute a batch of requests with pipeline support
   */
  async execute(
    requests: PipelineRequest[],
    context: RequestContext
  ): Promise<BatchedResponse> {
    const startTime = performance.now()

    // Build execution plan
    const plan = buildExecutionPlan(requests)

    // Check for cycles
    if (plan.cycles && plan.cycles.length > 0) {
      return {
        id: context.requestId,
        responses: requests.map((r) => ({
          id: r.id,
          status: 'error' as const,
          error: {
            code: 'CYCLE_DETECTED',
            message: `Circular dependency detected: ${plan.cycles![0].join(' -> ')}`,
            retryable: false,
          },
        })),
        durationMs: performance.now() - startTime,
      }
    }

    // Execute stages
    const results = new Map<string, GatewayResponse>()

    for (const stage of plan.stages) {
      // Execute all requests in stage in parallel
      const stagePromises = stage.map(async (request) => {
        // Resolve pipeline expressions
        const resolvedRequest = await this.resolvePipelineExpressions(request, results)

        // Execute request
        const response = await this.router.route(resolvedRequest, context)
        return { id: request.id, response }
      })

      const stageResults = await Promise.all(stagePromises)

      // Store results
      for (const { id, response } of stageResults) {
        results.set(id, response)
      }
    }

    // Return responses in original request order
    return {
      id: context.requestId,
      responses: requests.map((r) => results.get(r.id)!),
      durationMs: performance.now() - startTime,
    }
  }

  /**
   * Resolve pipeline expressions by injecting values from previous results
   */
  private async resolvePipelineExpressions(
    request: PipelineRequest,
    results: Map<string, GatewayResponse>
  ): Promise<GatewayRequest> {
    if (!request.pipeline || request.pipeline.length === 0) {
      return request
    }

    // Clone params to avoid mutation (safely handles circular refs, BigInt, etc.)
    let params = request.params
      ? safeJsonClone(request.params, {}, { context: 'PipelineExecutor.resolvePipelineExpressions' })
      : {}

    for (const expr of request.pipeline) {
      const sourceResponse = results.get(expr.from)
      if (!sourceResponse || sourceResponse.status === 'error') {
        // Source failed - skip this expression
        continue
      }

      // Extract value using path
      const value = getValueByPath(sourceResponse.result, expr.path)

      // Inject into params
      params = setValueByPath(params, expr.into, value)
    }

    return { ...request, params }
  }
}

// ============================================================================
// JSONPath Utilities
// ============================================================================

/**
 * Get value from object by dot-separated path
 *
 * Supports:
 * - Dot notation: "user.profile.name"
 * - Array indexing: "users[0].name"
 * - Bracket notation: "user['profile']['name']"
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  if (!path || path === '' || path === '.') {
    return obj
  }

  // Normalize path: convert bracket notation to dots
  const normalizedPath = path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\['([^']+)'\]/g, '.$1')
    .replace(/\["([^"]+)"\]/g, '.$1')

  const parts = normalizedPath.split('.').filter(Boolean)
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (typeof current !== 'object') {
      return undefined
    }

    if (Array.isArray(current)) {
      const index = parseInt(part, 10)
      if (isNaN(index)) {
        return undefined
      }
      current = current[index]
    } else {
      current = (current as Record<string, unknown>)[part]
    }
  }

  return current
}

/**
 * Set value in object by dot-separated path
 *
 * Creates intermediate objects/arrays as needed
 */
export function setValueByPath(
  obj: unknown,
  path: string,
  value: unknown
): unknown {
  if (!path || path === '' || path === '.') {
    return value
  }

  // Normalize path
  const normalizedPath = path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\['([^']+)'\]/g, '.$1')
    .replace(/\["([^"]+)"\]/g, '.$1')

  const parts = normalizedPath.split('.').filter(Boolean)

  if (parts.length === 0) {
    return value
  }

  // Ensure obj is an object
  const result = obj && typeof obj === 'object' ? { ...obj as object } : {}

  let current: Record<string, unknown> = result as Record<string, unknown>

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    const nextPart = parts[i + 1]
    const isNextArray = /^\d+$/.test(nextPart)

    if (!(part in current) || current[part] === null || current[part] === undefined) {
      current[part] = isNextArray ? [] : {}
    } else if (typeof current[part] !== 'object') {
      current[part] = isNextArray ? [] : {}
    }

    // Clone to avoid mutation
    current[part] = Array.isArray(current[part])
      ? [...current[part] as unknown[]]
      : { ...(current[part] as object) }

    current = current[part] as Record<string, unknown>
  }

  const lastPart = parts[parts.length - 1]
  current[lastPart] = value

  return result
}

// ============================================================================
// Batch Builder
// ============================================================================

/**
 * Builder for creating batched requests with pipelines
 */
export class BatchBuilder {
  private requests: PipelineRequest[] = []
  private references: PipelineReference[] = []

  /**
   * Add a request to the batch
   */
  add(request: Omit<PipelineRequest, 'id'>, id?: string): string {
    const requestId = id || `req_${this.requests.length}`
    this.requests.push({ ...request, id: requestId })
    return requestId
  }

  /**
   * Add a request that depends on another
   */
  addAfter(
    request: Omit<PipelineRequest, 'id' | 'depends'>,
    depends: string | string[],
    id?: string
  ): string {
    const requestId = id || `req_${this.requests.length}`
    const deps = Array.isArray(depends) ? depends : [depends]
    this.requests.push({ ...request, id: requestId, depends: deps })
    return requestId
  }

  /**
   * Add a request that uses values from a previous request
   */
  addWithPipeline(
    request: Omit<PipelineRequest, 'id' | 'pipeline'>,
    pipeline: PipelineExpression[],
    id?: string
  ): string {
    const requestId = id || `req_${this.requests.length}`
    this.requests.push({ ...request, id: requestId, pipeline })
    return requestId
  }

  /**
   * Add a pipeline reference between requests
   */
  pipe(
    sourceId: string,
    sourcePath: string,
    targetId: string,
    targetParam: string
  ): this {
    this.references.push({
      sourceId,
      sourcePath,
      targetId,
      targetParam,
    })
    return this
  }

  /**
   * Build the batched request
   */
  build(batchId?: string): BatchedRequest {
    return {
      id: batchId || crypto.randomUUID(),
      requests: this.requests,
      pipeline: this.references.length > 0 ? this.references : undefined,
      parallel: true,
    }
  }

  /**
   * Reset the builder
   */
  reset(): void {
    this.requests = []
    this.references = []
  }
}

// ============================================================================
// Pipeline Client
// ============================================================================

/**
 * Client for making pipelined RPC calls
 *
 * Provides a fluent API for building and executing batched requests
 */
export class PipelineClient {
  private executor: PipelineExecutor

  constructor(router: GatewayRouter) {
    this.executor = new PipelineExecutor(router)
  }

  /**
   * Create a new batch builder
   */
  batch(): BatchBuilder {
    return new BatchBuilder()
  }

  /**
   * Execute a batch of requests
   */
  async execute(
    requests: PipelineRequest[],
    auth?: AuthContext
  ): Promise<BatchedResponse> {
    const context: RequestContext = {
      requestId: crypto.randomUUID(),
      startTime: performance.now(),
      auth,
    }

    return this.executor.execute(requests, context)
  }

  /**
   * Execute a single request (convenience method)
   */
  async call<T = unknown>(
    service: string,
    method: string,
    params?: unknown,
    auth?: AuthContext
  ): Promise<T> {
    const requests: PipelineRequest[] = [
      {
        id: 'single',
        service,
        method,
        params,
      },
    ]

    const result = await this.execute(requests, auth)
    const response = result.responses[0]

    if (response.status === 'error') {
      throw new Error(response.error?.message || 'Request failed')
    }

    return response.result as T
  }

  /**
   * Execute multiple independent requests in parallel
   */
  async parallel<T extends Record<string, { service: string; method: string; params?: unknown }>>(
    requests: T,
    auth?: AuthContext
  ): Promise<{ [K in keyof T]: unknown }> {
    const pipelineRequests: PipelineRequest[] = Object.entries(requests).map(
      ([id, { service, method, params }]) => ({
        id,
        service,
        method,
        params,
      })
    )

    const result = await this.execute(pipelineRequests, auth)

    const resultMap = new Map(result.responses.map((r) => [r.id, r]))
    const output: Record<string, unknown> = {}

    for (const id of Object.keys(requests)) {
      const response = resultMap.get(id)
      if (response?.status === 'error') {
        output[id] = { error: response.error }
      } else {
        output[id] = response?.result
      }
    }

    return output as { [K in keyof T]: unknown }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a pipeline executor
 */
export function createPipelineExecutor(router: GatewayRouter): PipelineExecutor {
  return new PipelineExecutor(router)
}

/**
 * Create a pipeline client
 */
export function createPipelineClient(router: GatewayRouter): PipelineClient {
  return new PipelineClient(router)
}
