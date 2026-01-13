/**
 * Tool Invocation Tracking
 *
 * Tracks tool/function invocations as graph Relationships with verb-state
 * transitions and performance metrics.
 *
 * @module db/graph/tool-invocation
 * @see dotdo-28u9r - [GREEN] Implement Invocation Relationship Tracking
 *
 * Invocation Lifecycle:
 * - invoke:   Tool invocation requested (verb form: infinitive)
 * - invoking: Tool invocation in progress (verb form: present continuous)
 * - invoked:  Tool invocation completed (verb form: past participle)
 *
 * Relationships:
 * - Agent/Human -[invoke/invoking/invoked]-> Tool
 *
 * Call Chain Traversal:
 * - Tools can invoke other tools, forming call chains
 * - Each invocation is a Relationship with timing and result data
 *
 * Performance Metrics:
 * - Duration: Time from start to completion
 * - Cost: Optional cost tracking (tokens, API units, etc.)
 * - Error: Error message if invocation failed
 */

import type { GraphStore, GraphRelationship } from './types'
import { nanoid } from 'nanoid'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Verb for invocation start */
export const VERB_INVOKE = 'invoke'

/** Verb for invocation in progress */
export const VERB_INVOKING = 'invoking'

/** Verb for invocation completed */
export const VERB_INVOKED = 'invoked'

/** Type ID for Invocation things */
export const INVOCATION_TYPE_ID = 150

/** Type name for Invocation things */
export const INVOCATION_TYPE_NAME = 'Invocation'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Invocation status
 */
export type InvocationStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * Invocation data stored in relationship data field
 */
export interface InvocationData {
  /** Unique invocation ID */
  id: string
  /** Input arguments passed to the tool */
  input: Record<string, unknown>
  /** Output/result from tool execution */
  output?: unknown
  /** Error message if invocation failed */
  error?: { code: string; message: string }
  /** Timestamp when invocation started (Unix ms) */
  startedAt: number
  /** Timestamp when invocation completed (Unix ms) */
  completedAt?: number
  /** Duration in milliseconds */
  duration?: number
  /** Optional cost tracking (tokens, API units, etc.) */
  cost?: number
  /** Current status */
  status: InvocationStatus
  /** Parent invocation ID for nested calls */
  parentInvocationId?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Full invocation record with relationship context
 */
export interface Invocation {
  /** Relationship ID */
  relationshipId: string
  /** Invocation ID */
  id: string
  /** Caller (Agent, Human, or another Tool) URL */
  callerId: string
  /** Callee (Tool) URL */
  toolId: string
  /** Current verb (invoke, invoking, invoked) */
  verb: string
  /** Invocation data */
  data: InvocationData
  /** Relationship creation timestamp */
  createdAt: Date
}

/**
 * Input for creating a new invocation
 */
export interface CreateInvocationInput {
  /** Caller ID (Agent, Human, or Tool) */
  callerId: string
  /** Tool ID being invoked */
  toolId: string
  /** Input arguments */
  input: Record<string, unknown>
  /** Parent invocation ID for nested calls */
  parentInvocationId?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for completing an invocation
 */
export interface CompleteInvocationInput {
  /** Invocation ID */
  invocationId: string
  /** Output/result */
  output?: unknown
  /** Error if failed */
  error?: { code: string; message: string }
  /** Optional cost */
  cost?: number
}

/**
 * Query options for invocations
 */
export interface InvocationQueryOptions {
  /** Filter by caller ID */
  callerId?: string
  /** Filter by tool ID */
  toolId?: string
  /** Filter by status */
  status?: InvocationStatus
  /** Filter by parent invocation (for call chains) */
  parentInvocationId?: string
  /** Minimum start time (Unix ms) */
  since?: number
  /** Maximum start time (Unix ms) */
  until?: number
  /** Limit results */
  limit?: number
  /** Skip results */
  offset?: number
}

/**
 * Aggregated invocation metrics
 */
export interface InvocationMetrics {
  /** Total invocations */
  totalCount: number
  /** Successful invocations */
  successCount: number
  /** Failed invocations */
  failedCount: number
  /** Average duration (ms) */
  avgDuration: number
  /** Total cost */
  totalCost: number
  /** Invocations per tool */
  byTool: Record<string, { count: number; avgDuration: number }>
  /** Invocations per caller */
  byCaller: Record<string, { count: number; avgDuration: number }>
}

/**
 * Call chain entry for traversal
 */
export interface CallChainEntry {
  /** Invocation record */
  invocation: Invocation
  /** Depth in call chain (0 = root) */
  depth: number
  /** Child invocations */
  children: CallChainEntry[]
}

// ============================================================================
// IN-MEMORY STORE (for testing without mocks)
// ============================================================================

/**
 * Per-instance stores for InvocationStore instances
 */
const instanceStores = new WeakMap<object, Map<string, Invocation>>()

/**
 * Get or create in-memory store for a database object
 */
function getInvocationStore(db: object): Map<string, Invocation> {
  let store = instanceStores.get(db)
  if (!store) {
    store = new Map()
    instanceStores.set(db, store)
  }
  return store
}

// ============================================================================
// INVOCATION STORE
// ============================================================================

/**
 * InvocationStore provides CRUD operations for tool invocation tracking.
 *
 * Invocations are stored as Relationships with verb-state transitions:
 * - invoke:   Start of invocation
 * - invoking: In progress
 * - invoked:  Completed (success or failure)
 *
 * @example
 * ```typescript
 * const store = new InvocationStore(graphStore)
 *
 * // Start invocation
 * const inv = await store.startInvocation({
 *   callerId: 'agent:ralph',
 *   toolId: 'tool:web_search',
 *   input: { query: 'weather today' }
 * })
 *
 * // Complete invocation
 * await store.completeInvocation({
 *   invocationId: inv.id,
 *   output: { results: [...] }
 * })
 *
 * // Query invocations
 * const recentByTool = await store.getInvocations({
 *   toolId: 'tool:web_search',
 *   since: Date.now() - 3600000
 * })
 * ```
 */
export class InvocationStore {
  private graphStore: GraphStore | null
  private inMemoryStore: Map<string, Invocation>

  constructor(db: GraphStore | object) {
    // Check if db is a GraphStore (has createRelationship method)
    if (db && typeof db === 'object' && 'createRelationship' in db) {
      this.graphStore = db as GraphStore
      this.inMemoryStore = new Map()
    } else {
      this.graphStore = null
      this.inMemoryStore = getInvocationStore(db)
    }
  }

  // --------------------------------------------------------------------------
  // LIFECYCLE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Start a new invocation (creates relationship with verb: 'invoke')
   *
   * @param input - Invocation input data
   * @returns The created Invocation
   */
  async startInvocation(input: CreateInvocationInput): Promise<Invocation> {
    const invocationId = `inv-${nanoid(12)}`
    const relationshipId = `rel-${nanoid(12)}`
    const now = Date.now()

    const invocationData: InvocationData = {
      id: invocationId,
      input: input.input,
      startedAt: now,
      status: 'pending',
      parentInvocationId: input.parentInvocationId,
      metadata: input.metadata,
    }

    const invocation: Invocation = {
      relationshipId,
      id: invocationId,
      callerId: input.callerId,
      toolId: input.toolId,
      verb: VERB_INVOKE,
      data: invocationData,
      createdAt: new Date(now),
    }

    if (this.graphStore) {
      await this.graphStore.createRelationship({
        id: relationshipId,
        verb: VERB_INVOKE,
        from: input.callerId,
        to: input.toolId,
        data: invocationData,
      })
    }

    this.inMemoryStore.set(invocationId, invocation)

    return invocation
  }

  /**
   * Mark invocation as in progress (updates verb to 'invoking')
   *
   * @param invocationId - Invocation ID
   * @returns Updated Invocation or null if not found
   */
  async markRunning(invocationId: string): Promise<Invocation | null> {
    const existing = this.inMemoryStore.get(invocationId)
    if (!existing) {
      return null
    }

    const updated: Invocation = {
      ...existing,
      verb: VERB_INVOKING,
      data: {
        ...existing.data,
        status: 'running',
      },
    }

    this.inMemoryStore.set(invocationId, updated)

    return updated
  }

  /**
   * Complete an invocation (updates verb to 'invoked')
   *
   * @param input - Completion input with output/error
   * @returns Updated Invocation or null if not found
   */
  async completeInvocation(input: CompleteInvocationInput): Promise<Invocation | null> {
    const existing = this.inMemoryStore.get(input.invocationId)
    if (!existing) {
      return null
    }

    const now = Date.now()
    const duration = now - existing.data.startedAt
    const status: InvocationStatus = input.error ? 'failed' : 'completed'

    const updatedData: InvocationData = {
      ...existing.data,
      output: input.output,
      error: input.error,
      cost: input.cost,
      completedAt: now,
      duration,
      status,
    }

    const updated: Invocation = {
      ...existing,
      verb: VERB_INVOKED,
      data: updatedData,
    }

    this.inMemoryStore.set(input.invocationId, updated)

    return updated
  }

  /**
   * Fail an invocation with an error
   *
   * @param invocationId - Invocation ID
   * @param error - Error details
   * @returns Updated Invocation or null if not found
   */
  async failInvocation(
    invocationId: string,
    error: { code: string; message: string }
  ): Promise<Invocation | null> {
    return this.completeInvocation({
      invocationId,
      error,
    })
  }

  // --------------------------------------------------------------------------
  // QUERY OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Get an invocation by ID
   *
   * @param invocationId - Invocation ID
   * @returns The Invocation or null if not found
   */
  async getInvocation(invocationId: string): Promise<Invocation | null> {
    return this.inMemoryStore.get(invocationId) ?? null
  }

  /**
   * Get invocations with optional filters
   *
   * @param options - Query options
   * @returns Array of matching Invocations
   */
  async getInvocations(options: InvocationQueryOptions = {}): Promise<Invocation[]> {
    let results = Array.from(this.inMemoryStore.values())

    // Filter by caller
    if (options.callerId) {
      results = results.filter((inv) => inv.callerId === options.callerId)
    }

    // Filter by tool
    if (options.toolId) {
      results = results.filter((inv) => inv.toolId === options.toolId)
    }

    // Filter by status
    if (options.status) {
      results = results.filter((inv) => inv.data.status === options.status)
    }

    // Filter by parent
    if (options.parentInvocationId) {
      results = results.filter(
        (inv) => inv.data.parentInvocationId === options.parentInvocationId
      )
    }

    // Filter by time range
    if (options.since !== undefined) {
      results = results.filter((inv) => inv.data.startedAt >= options.since!)
    }
    if (options.until !== undefined) {
      results = results.filter((inv) => inv.data.startedAt <= options.until!)
    }

    // Sort by startedAt descending (most recent first)
    results.sort((a, b) => b.data.startedAt - a.data.startedAt)

    // Apply offset
    if (options.offset !== undefined && options.offset > 0) {
      results = results.slice(options.offset)
    }

    // Apply limit
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  /**
   * Get invocations by caller (invokedBy relationship)
   *
   * @param callerId - Caller ID
   * @param options - Additional query options
   * @returns Array of Invocations made by this caller
   */
  async getInvokedBy(
    callerId: string,
    options: Omit<InvocationQueryOptions, 'callerId'> = {}
  ): Promise<Invocation[]> {
    return this.getInvocations({ ...options, callerId })
  }

  /**
   * Get invocations for a tool (invokes relationship)
   *
   * @param toolId - Tool ID
   * @param options - Additional query options
   * @returns Array of Invocations of this tool
   */
  async getInvokes(
    toolId: string,
    options: Omit<InvocationQueryOptions, 'toolId'> = {}
  ): Promise<Invocation[]> {
    return this.getInvocations({ ...options, toolId })
  }

  // --------------------------------------------------------------------------
  // CALL CHAIN TRAVERSAL
  // --------------------------------------------------------------------------

  /**
   * Get the call chain starting from an invocation
   *
   * Builds a tree of nested invocations where tools invoke other tools.
   *
   * @param invocationId - Root invocation ID
   * @param maxDepth - Maximum depth to traverse (default: 10)
   * @returns Call chain tree or null if not found
   */
  async getCallChain(
    invocationId: string,
    maxDepth: number = 10
  ): Promise<CallChainEntry | null> {
    const root = await this.getInvocation(invocationId)
    if (!root) {
      return null
    }

    return this.buildCallChainEntry(root, 0, maxDepth)
  }

  /**
   * Get the root invocation in a call chain
   *
   * @param invocationId - Any invocation in the chain
   * @returns Root invocation or null if not found
   */
  async getCallChainRoot(invocationId: string): Promise<Invocation | null> {
    let current = await this.getInvocation(invocationId)

    while (current && current.data.parentInvocationId) {
      const parent = await this.getInvocation(current.data.parentInvocationId)
      if (!parent) break
      current = parent
    }

    return current
  }

  /**
   * Get the full call path from root to a specific invocation
   *
   * @param invocationId - Target invocation ID
   * @returns Array of invocations from root to target
   */
  async getCallPath(invocationId: string): Promise<Invocation[]> {
    const path: Invocation[] = []
    let current = await this.getInvocation(invocationId)

    while (current) {
      path.unshift(current)
      if (!current.data.parentInvocationId) break
      current = await this.getInvocation(current.data.parentInvocationId)
    }

    return path
  }

  /**
   * Build call chain entry recursively
   */
  private async buildCallChainEntry(
    invocation: Invocation,
    depth: number,
    maxDepth: number
  ): Promise<CallChainEntry> {
    const entry: CallChainEntry = {
      invocation,
      depth,
      children: [],
    }

    if (depth < maxDepth) {
      const childInvocations = await this.getInvocations({
        parentInvocationId: invocation.id,
      })

      for (const child of childInvocations) {
        const childEntry = await this.buildCallChainEntry(child, depth + 1, maxDepth)
        entry.children.push(childEntry)
      }
    }

    return entry
  }

  // --------------------------------------------------------------------------
  // METRICS
  // --------------------------------------------------------------------------

  /**
   * Get aggregated metrics for invocations
   *
   * @param options - Query options to filter which invocations to include
   * @returns Aggregated metrics
   */
  async getMetrics(options: InvocationQueryOptions = {}): Promise<InvocationMetrics> {
    const invocations = await this.getInvocations(options)

    const metrics: InvocationMetrics = {
      totalCount: 0,
      successCount: 0,
      failedCount: 0,
      avgDuration: 0,
      totalCost: 0,
      byTool: {},
      byCaller: {},
    }

    let totalDuration = 0
    let durationCount = 0

    for (const inv of invocations) {
      metrics.totalCount++

      if (inv.data.status === 'completed') {
        metrics.successCount++
      } else if (inv.data.status === 'failed') {
        metrics.failedCount++
      }

      if (inv.data.duration !== undefined) {
        totalDuration += inv.data.duration
        durationCount++
      }

      if (inv.data.cost !== undefined) {
        metrics.totalCost += inv.data.cost
      }

      // By tool
      if (!metrics.byTool[inv.toolId]) {
        metrics.byTool[inv.toolId] = { count: 0, avgDuration: 0 }
      }
      metrics.byTool[inv.toolId].count++
      if (inv.data.duration !== undefined) {
        const toolMetrics = metrics.byTool[inv.toolId]
        const prevTotal = toolMetrics.avgDuration * (toolMetrics.count - 1)
        toolMetrics.avgDuration = (prevTotal + inv.data.duration) / toolMetrics.count
      }

      // By caller
      if (!metrics.byCaller[inv.callerId]) {
        metrics.byCaller[inv.callerId] = { count: 0, avgDuration: 0 }
      }
      metrics.byCaller[inv.callerId].count++
      if (inv.data.duration !== undefined) {
        const callerMetrics = metrics.byCaller[inv.callerId]
        const prevTotal = callerMetrics.avgDuration * (callerMetrics.count - 1)
        callerMetrics.avgDuration = (prevTotal + inv.data.duration) / callerMetrics.count
      }
    }

    metrics.avgDuration = durationCount > 0 ? totalDuration / durationCount : 0

    return metrics
  }

  /**
   * Get performance metrics for a specific tool
   *
   * @param toolId - Tool ID
   * @param options - Additional query options
   * @returns Tool-specific metrics
   */
  async getToolMetrics(
    toolId: string,
    options: Omit<InvocationQueryOptions, 'toolId'> = {}
  ): Promise<{
    invocationCount: number
    successRate: number
    avgDuration: number
    p50Duration: number
    p95Duration: number
    p99Duration: number
    totalCost: number
  }> {
    const invocations = await this.getInvokes(toolId, options)

    if (invocations.length === 0) {
      return {
        invocationCount: 0,
        successRate: 0,
        avgDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        totalCost: 0,
      }
    }

    const completed = invocations.filter((inv) => inv.data.status === 'completed')
    const durations = invocations
      .filter((inv) => inv.data.duration !== undefined)
      .map((inv) => inv.data.duration!)
      .sort((a, b) => a - b)

    const totalCost = invocations.reduce((sum, inv) => sum + (inv.data.cost ?? 0), 0)
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0

    return {
      invocationCount: invocations.length,
      successRate: invocations.length > 0 ? completed.length / invocations.length : 0,
      avgDuration,
      p50Duration: percentile(durations, 0.5),
      p95Duration: percentile(durations, 0.95),
      p99Duration: percentile(durations, 0.99),
      totalCost,
    }
  }
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0
  const index = Math.ceil(p * sortedArr.length) - 1
  return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))]
}

// ============================================================================
// TOOL EXECUTOR WITH INVOCATION TRACKING
// ============================================================================

/**
 * Tool handler function type
 */
export type ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<TOutput>

/**
 * Tool execution context passed to handlers
 */
export interface ToolExecutionContext {
  /** Invocation ID */
  invocationId: string
  /** Caller ID */
  callerId: string
  /** Parent invocation ID if nested */
  parentInvocationId?: string
  /** Invoke another tool (creates nested invocation) */
  invoke: <T = unknown>(toolId: string, input: Record<string, unknown>) => Promise<T>
}

/**
 * Registered tool definition
 */
export interface RegisteredTool {
  id: string
  name: string
  description: string
  handler: ToolHandler
}

/**
 * ToolExecutor executes tools with full invocation tracking.
 *
 * @example
 * ```typescript
 * const executor = new ToolExecutor(invocationStore)
 *
 * // Register a tool
 * executor.registerTool({
 *   id: 'tool:web_search',
 *   name: 'web_search',
 *   description: 'Search the web',
 *   handler: async (input) => {
 *     // ... perform search
 *     return { results: [...] }
 *   }
 * })
 *
 * // Invoke tool
 * const result = await executor.invoke('agent:ralph', 'tool:web_search', {
 *   query: 'weather'
 * })
 * ```
 */
export class ToolExecutor {
  private invocationStore: InvocationStore
  private tools: Map<string, RegisteredTool> = new Map()

  constructor(invocationStore: InvocationStore) {
    this.invocationStore = invocationStore
  }

  /**
   * Register a tool for execution
   */
  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.id, tool)
  }

  /**
   * Get a registered tool
   */
  getTool(toolId: string): RegisteredTool | undefined {
    return this.tools.get(toolId)
  }

  /**
   * Invoke a tool with full tracking
   *
   * @param callerId - ID of the caller (Agent, Human, Tool)
   * @param toolId - ID of the tool to invoke
   * @param input - Input arguments
   * @param parentInvocationId - Parent invocation ID for nested calls
   * @returns Invocation result
   */
  async invoke<TOutput = unknown>(
    callerId: string,
    toolId: string,
    input: Record<string, unknown>,
    parentInvocationId?: string
  ): Promise<{ success: boolean; data?: TOutput; error?: { code: string; message: string } }> {
    const tool = this.tools.get(toolId)

    // Start invocation
    const invocation = await this.invocationStore.startInvocation({
      callerId,
      toolId,
      input,
      parentInvocationId,
    })

    // If tool not found, fail immediately
    if (!tool) {
      await this.invocationStore.failInvocation(invocation.id, {
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${toolId}`,
      })
      return {
        success: false,
        error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${toolId}` },
      }
    }

    // Mark as running
    await this.invocationStore.markRunning(invocation.id)

    // Create execution context with nested invoke capability
    const context: ToolExecutionContext = {
      invocationId: invocation.id,
      callerId,
      parentInvocationId,
      invoke: async <T = unknown>(nestedToolId: string, nestedInput: Record<string, unknown>) => {
        const result = await this.invoke<T>(
          toolId, // The tool becomes the caller
          nestedToolId,
          nestedInput,
          invocation.id // Current invocation is the parent
        )
        if (!result.success) {
          throw new Error(result.error?.message ?? 'Nested tool invocation failed')
        }
        return result.data!
      },
    }

    try {
      const result = await tool.handler(input, context)

      await this.invocationStore.completeInvocation({
        invocationId: invocation.id,
        output: result,
      })

      return { success: true, data: result as TOutput }
    } catch (error) {
      const errorObj = {
        code: 'TOOL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }

      await this.invocationStore.failInvocation(invocation.id, errorObj)

      return { success: false, error: errorObj }
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new InvocationStore
 *
 * @param db - GraphStore or empty object for in-memory testing
 * @returns InvocationStore instance
 */
export function createInvocationStore(db: GraphStore | object): InvocationStore {
  return new InvocationStore(db)
}

/**
 * Create a new ToolExecutor with InvocationStore
 *
 * @param db - GraphStore or empty object for in-memory testing
 * @returns ToolExecutor instance
 */
export function createToolExecutor(db: GraphStore | object): ToolExecutor {
  const store = createInvocationStore(db)
  return new ToolExecutor(store)
}
