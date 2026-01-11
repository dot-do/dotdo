/**
 * RPC.do Gateway Router
 *
 * Routes requests to appropriate *.do services based on service name.
 * Supports both direct service bindings and external URL routing.
 *
 * @module services/rpc/router
 */

import type {
  GatewayRequest,
  GatewayResponse,
  GatewayError,
  ServiceDefinition,
  ServiceEndpoint,
  ServiceRegistry,
  BatchedRequest,
  BatchedResponse,
  PipelineReference,
  AuthContext,
} from './types'

// ============================================================================
// Service Registry Implementation
// ============================================================================

/**
 * In-memory service registry with support for dynamic service discovery
 */
export class InMemoryServiceRegistry implements ServiceRegistry {
  private services = new Map<string, ServiceDefinition>()
  private endpoints = new Map<string, ServiceEndpoint>()

  /**
   * Register a service
   */
  register(service: ServiceDefinition, endpoint: ServiceEndpoint): void {
    const key = service.domain.replace('.do', '')
    this.services.set(key, service)
    this.endpoints.set(key, endpoint)
  }

  /**
   * Get service definition by name
   */
  getService(name: string): ServiceDefinition | undefined {
    const key = this.normalizeServiceName(name)
    return this.services.get(key)
  }

  /**
   * Get service endpoint
   */
  getEndpoint(name: string): ServiceEndpoint | undefined {
    const key = this.normalizeServiceName(name)
    return this.endpoints.get(key)
  }

  /**
   * List all services
   */
  listServices(): ServiceDefinition[] {
    return Array.from(this.services.values())
  }

  /**
   * Check if service exists
   */
  hasService(name: string): boolean {
    const key = this.normalizeServiceName(name)
    return this.services.has(key)
  }

  /**
   * Refresh service registry (placeholder for dynamic discovery)
   */
  async refresh(): Promise<void> {
    // In production, this would fetch service definitions from a central registry
    // For now, services are registered statically
  }

  /**
   * Normalize service name (remove .do suffix if present)
   */
  private normalizeServiceName(name: string): string {
    return name.replace(/\.do$/, '').toLowerCase()
  }
}

// ============================================================================
// Default Service Definitions
// ============================================================================

/**
 * Create default service registry with known *.do services
 */
export function createDefaultRegistry(): InMemoryServiceRegistry {
  const registry = new InMemoryServiceRegistry()

  // Register known services
  const services: Array<{ service: ServiceDefinition; endpoint: ServiceEndpoint }> = [
    {
      service: {
        name: 'agents',
        domain: 'agents.do',
        description: 'AI Agent management and execution',
        methods: [
          { name: 'create', description: 'Create a new agent', costUnits: 1 },
          { name: 'invoke', description: 'Invoke an agent', costUnits: 10, streaming: true },
          { name: 'list', description: 'List agents', costUnits: 1 },
          { name: 'get', description: 'Get agent details', costUnits: 1 },
          { name: 'update', description: 'Update an agent', costUnits: 1 },
          { name: 'delete', description: 'Delete an agent', costUnits: 1 },
        ],
        active: true,
      },
      endpoint: { domain: 'agents.do', healthy: true },
    },
    {
      service: {
        name: 'workers',
        domain: 'workers.do',
        description: 'Worker deployment and management',
        methods: [
          { name: 'deploy', description: 'Deploy a worker', costUnits: 5 },
          { name: 'invoke', description: 'Invoke a worker', costUnits: 1 },
          { name: 'list', description: 'List workers', costUnits: 1 },
          { name: 'get', description: 'Get worker details', costUnits: 1 },
          { name: 'delete', description: 'Delete a worker', costUnits: 1 },
          { name: 'logs', description: 'Get worker logs', costUnits: 2, streaming: true },
        ],
        active: true,
      },
      endpoint: { domain: 'workers.do', healthy: true },
    },
    {
      service: {
        name: 'functions',
        domain: 'functions.do',
        description: 'Serverless function execution',
        methods: [
          { name: 'create', description: 'Create a function', costUnits: 1 },
          { name: 'invoke', description: 'Invoke a function', costUnits: 1 },
          { name: 'list', description: 'List functions', costUnits: 1 },
          { name: 'get', description: 'Get function details', costUnits: 1 },
          { name: 'delete', description: 'Delete a function', costUnits: 1 },
        ],
        active: true,
      },
      endpoint: { domain: 'functions.do', healthy: true },
    },
    {
      service: {
        name: 'workflows',
        domain: 'workflows.do',
        description: 'Workflow orchestration',
        methods: [
          { name: 'create', description: 'Create a workflow', costUnits: 2 },
          { name: 'start', description: 'Start a workflow', costUnits: 5 },
          { name: 'pause', description: 'Pause a workflow', costUnits: 1 },
          { name: 'resume', description: 'Resume a workflow', costUnits: 1 },
          { name: 'cancel', description: 'Cancel a workflow', costUnits: 1 },
          { name: 'status', description: 'Get workflow status', costUnits: 1 },
          { name: 'list', description: 'List workflows', costUnits: 1 },
        ],
        active: true,
      },
      endpoint: { domain: 'workflows.do', healthy: true },
    },
    {
      service: {
        name: 'database',
        domain: 'database.do',
        description: 'Database operations',
        methods: [
          { name: 'query', description: 'Execute a query', costUnits: 1 },
          { name: 'insert', description: 'Insert records', costUnits: 1 },
          { name: 'update', description: 'Update records', costUnits: 1 },
          { name: 'delete', description: 'Delete records', costUnits: 1 },
          { name: 'batch', description: 'Batch operations', costUnits: 5 },
        ],
        active: true,
      },
      endpoint: { domain: 'database.do', healthy: true },
    },
    {
      service: {
        name: 'llm',
        domain: 'llm.do',
        description: 'LLM inference and completion',
        methods: [
          { name: 'complete', description: 'Text completion', costUnits: 10, streaming: true },
          { name: 'chat', description: 'Chat completion', costUnits: 10, streaming: true },
          { name: 'embed', description: 'Generate embeddings', costUnits: 1 },
          { name: 'models', description: 'List available models', costUnits: 1 },
        ],
        active: true,
      },
      endpoint: { domain: 'llm.do', healthy: true },
    },
    {
      service: {
        name: 'evals',
        domain: 'evals.do',
        description: 'LLM evaluation and benchmarking',
        methods: [
          { name: 'run', description: 'Run an evaluation', costUnits: 20 },
          { name: 'create', description: 'Create an evaluation', costUnits: 2 },
          { name: 'results', description: 'Get evaluation results', costUnits: 1 },
          { name: 'compare', description: 'Compare evaluations', costUnits: 5 },
        ],
        active: true,
      },
      endpoint: { domain: 'evals.do', healthy: true },
    },
    {
      service: {
        name: 'analytics',
        domain: 'analytics.do',
        description: 'Analytics and insights',
        methods: [
          { name: 'query', description: 'Query analytics data', costUnits: 2 },
          { name: 'track', description: 'Track an event', costUnits: 1 },
          { name: 'report', description: 'Generate a report', costUnits: 5 },
        ],
        active: true,
      },
      endpoint: { domain: 'analytics.do', healthy: true },
    },
  ]

  for (const { service, endpoint } of services) {
    registry.register(service, endpoint)
  }

  return registry
}

// ============================================================================
// Router Implementation
// ============================================================================

/**
 * Router options
 */
export interface RouterOptions {
  /** Service registry */
  registry: ServiceRegistry
  /** Default timeout in ms */
  defaultTimeout?: number
  /** Maximum batch size */
  maxBatchSize?: number
  /** Service bindings (for internal routing) */
  bindings?: Record<string, { fetch: typeof fetch }>
}

/**
 * Request context for routing
 */
export interface RequestContext {
  /** Authentication context */
  auth?: AuthContext
  /** Request ID */
  requestId: string
  /** Start time */
  startTime: number
  /** Trace ID for distributed tracing */
  traceId?: string
}

/**
 * Gateway Router
 *
 * Routes requests to appropriate *.do services with support for:
 * - Service discovery
 * - Request batching
 * - Promise pipelining
 * - Timeout handling
 * - Error normalization
 */
export class GatewayRouter {
  private registry: ServiceRegistry
  private defaultTimeout: number
  private maxBatchSize: number
  private bindings: Record<string, { fetch: typeof fetch }>

  constructor(options: RouterOptions) {
    this.registry = options.registry
    this.defaultTimeout = options.defaultTimeout ?? 30000
    this.maxBatchSize = options.maxBatchSize ?? 100
    this.bindings = options.bindings ?? {}
  }

  /**
   * Route a single request to the appropriate service
   */
  async route(
    request: GatewayRequest,
    context: RequestContext
  ): Promise<GatewayResponse> {
    const startTime = performance.now()

    try {
      // Validate request
      const validation = this.validateRequest(request)
      if (!validation.valid) {
        return this.errorResponse(request.id, validation.error!)
      }

      // Get service endpoint
      const endpoint = this.registry.getEndpoint(request.service)
      if (!endpoint) {
        return this.errorResponse(request.id, {
          code: 'SERVICE_NOT_FOUND',
          message: `Service '${request.service}' not found`,
          retryable: false,
        })
      }

      // Check service health
      if (!endpoint.healthy) {
        return this.errorResponse(request.id, {
          code: 'SERVICE_UNAVAILABLE',
          message: `Service '${request.service}' is currently unavailable`,
          retryable: true,
          service: request.service,
        })
      }

      // Execute the request
      const result = await this.executeRequest(request, endpoint, context)
      const durationMs = performance.now() - startTime

      return {
        id: request.id,
        status: 'success',
        result,
        meta: {
          durationMs,
          service: request.service,
          traceId: context.traceId,
        },
      }
    } catch (error) {
      const durationMs = performance.now() - startTime
      return this.handleError(request.id, error, request.service, durationMs)
    }
  }

  /**
   * Route a batch of requests
   */
  async routeBatch(
    batch: BatchedRequest,
    context: RequestContext
  ): Promise<BatchedResponse> {
    const startTime = performance.now()

    // Validate batch size
    if (batch.requests.length > this.maxBatchSize) {
      return {
        id: batch.id,
        responses: batch.requests.map((req) =>
          this.errorResponse(req.id, {
            code: 'BATCH_TOO_LARGE',
            message: `Batch size ${batch.requests.length} exceeds maximum ${this.maxBatchSize}`,
            retryable: false,
          })
        ),
        durationMs: performance.now() - startTime,
      }
    }

    // Build dependency graph for pipeline
    const dependencyGraph = this.buildDependencyGraph(batch)

    // Execute requests respecting dependencies
    const responses = await this.executeBatch(
      batch.requests,
      dependencyGraph,
      batch.parallel ?? true,
      context
    )

    return {
      id: batch.id,
      responses,
      durationMs: performance.now() - startTime,
    }
  }

  /**
   * Validate a request
   */
  private validateRequest(request: GatewayRequest): { valid: boolean; error?: GatewayError } {
    if (!request.id) {
      return {
        valid: false,
        error: { code: 'INVALID_REQUEST', message: 'Request ID is required', retryable: false },
      }
    }

    if (!request.service) {
      return {
        valid: false,
        error: { code: 'INVALID_REQUEST', message: 'Service is required', retryable: false },
      }
    }

    if (!request.method) {
      return {
        valid: false,
        error: { code: 'INVALID_REQUEST', message: 'Method is required', retryable: false },
      }
    }

    // Check if service exists
    if (!this.registry.hasService(request.service)) {
      return {
        valid: false,
        error: {
          code: 'SERVICE_NOT_FOUND',
          message: `Service '${request.service}' not found`,
          retryable: false,
        },
      }
    }

    return { valid: true }
  }

  /**
   * Execute a request against a service endpoint
   */
  private async executeRequest(
    request: GatewayRequest,
    endpoint: ServiceEndpoint,
    context: RequestContext
  ): Promise<unknown> {
    const timeout = request.meta?.timeout ?? this.defaultTimeout

    // Check for service binding first (internal routing)
    const binding = this.bindings[request.service]
    if (binding) {
      return this.executeViaBinding(request, binding, timeout, context)
    }

    // Fall back to external URL
    if (endpoint.url) {
      return this.executeViaHttp(request, endpoint.url, timeout, context)
    }

    // Construct URL from domain
    const url = `https://${endpoint.domain}/rpc`
    return this.executeViaHttp(request, url, timeout, context)
  }

  /**
   * Execute request via service binding (internal)
   */
  private async executeViaBinding(
    request: GatewayRequest,
    binding: { fetch: typeof fetch },
    timeout: number,
    context: RequestContext
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await binding.fetch('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': context.requestId,
          ...(context.traceId && { 'X-Trace-ID': context.traceId }),
          ...(context.auth && { 'X-User-ID': context.auth.userId }),
          ...(context.auth && { 'X-Tenant-ID': context.auth.tenantId }),
        },
        body: JSON.stringify({
          method: request.method,
          params: request.params,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new ServiceError(
          `Service returned ${response.status}: ${errorText}`,
          'SERVICE_ERROR',
          response.status >= 500
        )
      }

      const data = await response.json()
      return data.result ?? data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Execute request via HTTP (external)
   */
  private async executeViaHttp(
    request: GatewayRequest,
    url: string,
    timeout: number,
    context: RequestContext
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': context.requestId,
          ...(context.traceId && { 'X-Trace-ID': context.traceId }),
          ...(context.auth && { Authorization: `Bearer ${context.auth.userId}` }),
          ...(request.meta?.headers ?? {}),
        },
        body: JSON.stringify({
          method: request.method,
          params: request.params,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new ServiceError(
          `Service returned ${response.status}: ${errorText}`,
          'SERVICE_ERROR',
          response.status >= 500
        )
      }

      const data = await response.json()
      return data.result ?? data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Build dependency graph for batched requests
   */
  private buildDependencyGraph(
    batch: BatchedRequest
  ): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>()

    // Initialize all requests with no dependencies
    for (const req of batch.requests) {
      graph.set(req.id, new Set())
    }

    // Add dependencies from pipeline references
    if (batch.pipeline) {
      for (const ref of batch.pipeline) {
        const deps = graph.get(ref.targetId)
        if (deps) {
          deps.add(ref.sourceId)
        }
      }
    }

    return graph
  }

  /**
   * Execute a batch of requests respecting dependencies
   */
  private async executeBatch(
    requests: GatewayRequest[],
    dependencyGraph: Map<string, Set<string>>,
    parallel: boolean,
    context: RequestContext
  ): Promise<GatewayResponse[]> {
    const results = new Map<string, GatewayResponse>()
    const requestMap = new Map(requests.map((r) => [r.id, r]))

    if (!parallel) {
      // Sequential execution
      for (const request of requests) {
        const response = await this.route(request, context)
        results.set(request.id, response)
      }
    } else {
      // Parallel execution with dependency resolution
      const pending = new Set(requests.map((r) => r.id))
      const completed = new Set<string>()

      while (pending.size > 0) {
        // Find requests that can be executed (all dependencies satisfied)
        const ready: string[] = []
        for (const id of pending) {
          const deps = dependencyGraph.get(id) ?? new Set()
          if ([...deps].every((d) => completed.has(d))) {
            ready.push(id)
          }
        }

        if (ready.length === 0) {
          // Circular dependency or missing dependency
          for (const id of pending) {
            results.set(id, this.errorResponse(id, {
              code: 'DEPENDENCY_ERROR',
              message: 'Circular or missing dependency detected',
              retryable: false,
            }))
          }
          break
        }

        // Execute ready requests in parallel
        const executions = ready.map(async (id) => {
          const request = requestMap.get(id)!
          const response = await this.route(request, context)
          return { id, response }
        })

        const executionResults = await Promise.all(executions)

        for (const { id, response } of executionResults) {
          results.set(id, response)
          pending.delete(id)
          completed.add(id)
        }
      }
    }

    // Return responses in original request order
    return requests.map((r) => results.get(r.id)!)
  }

  /**
   * Create error response
   */
  private errorResponse(id: string, error: GatewayError): GatewayResponse {
    return {
      id,
      status: 'error',
      error,
    }
  }

  /**
   * Handle execution error
   */
  private handleError(
    id: string,
    error: unknown,
    service: string,
    durationMs: number
  ): GatewayResponse {
    if (error instanceof ServiceError) {
      return {
        id,
        status: 'error',
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          service,
        },
        meta: { durationMs, service },
      }
    }

    if (error instanceof Error) {
      // Handle abort/timeout
      if (error.name === 'AbortError') {
        return {
          id,
          status: 'error',
          error: {
            code: 'TIMEOUT',
            message: 'Request timed out',
            retryable: true,
            service,
          },
          meta: { durationMs, service },
        }
      }

      return {
        id,
        status: 'error',
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          retryable: false,
          service,
        },
        meta: { durationMs, service },
      }
    }

    return {
      id,
      status: 'error',
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'An unknown error occurred',
        retryable: false,
        service,
      },
      meta: { durationMs, service },
    }
  }

  /**
   * List available services
   */
  listServices(): ServiceDefinition[] {
    return this.registry.listServices()
  }

  /**
   * Get service details
   */
  getService(name: string): ServiceDefinition | undefined {
    return this.registry.getService(name)
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Service error for routing failures
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a gateway router with default configuration
 */
export function createRouter(options?: Partial<RouterOptions>): GatewayRouter {
  return new GatewayRouter({
    registry: options?.registry ?? createDefaultRegistry(),
    defaultTimeout: options?.defaultTimeout ?? 30000,
    maxBatchSize: options?.maxBatchSize ?? 100,
    bindings: options?.bindings ?? {},
  })
}
