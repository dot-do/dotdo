/**
 * Tool Execution Tracker
 *
 * Provides a high-level API for tracking Agent tool executions as Relationships
 * in the graph store. Uses verb form state encoding:
 * - invoke (action form) = intent/pending
 * - invoking (activity form) = in-progress
 * - invoked (event form) = completed
 *
 * @see dotdo-2hiae - Digital Tools Graph Integration epic
 * @see agents/tests/tool-execution-tracking.test.ts - RED phase tests
 *
 * @module agents/tool-execution-tracker
 */

import type { GraphStore, GraphRelationship } from '../db/graph/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Execution states mapped to verb forms
 */
export type ExecutionState = 'pending' | 'in_progress' | 'completed'

/**
 * Verb forms for the execution lifecycle
 */
export type ExecutionVerbForm = 'invoke' | 'invoking' | 'invoked'

/**
 * Cost metrics for an execution
 */
export interface ExecutionCost {
  inputTokens?: number
  outputTokens?: number
  apiCalls?: number
  estimatedCost?: number
}

/**
 * Error information for failed executions
 */
export interface ExecutionError {
  message: string
  code?: string
  stack?: string
}

/**
 * Options for starting an execution
 */
export interface StartExecutionOptions {
  agentId: string
  toolId: string
  input: Record<string, unknown>
}

/**
 * Options for completing an execution with additional metadata
 */
export interface CompleteExecutionOptions {
  cost?: ExecutionCost
}

/**
 * Execution handle returned from start()
 */
export interface ExecutionHandle {
  /** Unique execution ID */
  id: string
  /** Current execution state */
  state: ExecutionState
  /** Current verb form */
  verbForm: ExecutionVerbForm
  /** Output from successful execution */
  output?: unknown
  /** Whether execution succeeded (after completion) */
  success?: boolean
  /** Execution duration in ms (after completion) */
  duration?: number
  /** Error if failed */
  error?: ExecutionError
  /** Cost metrics */
  cost?: ExecutionCost

  /**
   * Begin execution (transitions from invoke to invoking)
   */
  begin(): Promise<void>

  /**
   * Complete execution with output (transitions from invoking to invoked)
   */
  complete(output: unknown, options?: CompleteExecutionOptions): Promise<void>

  /**
   * Fail execution with error (transitions to invoked with error)
   */
  fail(error: Error): Promise<void>

  /**
   * Execute a callback with automatic state transitions.
   * Calls begin(), then the callback, then complete() on success or fail() on error.
   */
  run<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Aggregate statistics for executions
 */
export interface ExecutionStats {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  successRate: number
  totalInputTokens?: number
  totalOutputTokens?: number
  totalCost?: number
}

/**
 * Execution record stored in the graph
 */
interface StoredExecutionData {
  input: Record<string, unknown>
  output?: unknown
  startedAt: number
  completedAt?: number
  duration?: number
  success?: boolean
  error?: ExecutionError
  cost?: ExecutionCost
  toolId?: string
}

// ============================================================================
// VERB FORM UTILITIES
// ============================================================================

/**
 * Map execution state to verb form
 */
function stateToVerbForm(state: ExecutionState): ExecutionVerbForm {
  switch (state) {
    case 'pending':
      return 'invoke'
    case 'in_progress':
      return 'invoking'
    case 'completed':
      return 'invoked'
  }
}

/**
 * Map verb form to execution state
 */
function verbFormToState(verbForm: ExecutionVerbForm): ExecutionState {
  switch (verbForm) {
    case 'invoke':
      return 'pending'
    case 'invoking':
      return 'in_progress'
    case 'invoked':
      return 'completed'
  }
}

// ============================================================================
// TOOL EXECUTION TRACKER CLASS
// ============================================================================

/**
 * ToolExecutionTracker manages tool execution lifecycle as graph relationships.
 *
 * Each tool execution is modeled as a Relationship from an Agent Thing to a Tool Thing,
 * with the verb encoding the current state:
 * - invoke: pending (execution requested but not started)
 * - invoking: in-progress (execution is running)
 * - invoked: completed (execution finished, check success/error in data)
 *
 * @example
 * ```typescript
 * const tracker = new ToolExecutionTracker(graphStore)
 *
 * const execution = await tracker.start({
 *   agentId: 'agent-ralph',
 *   toolId: 'tool-read-file',
 *   input: { path: '/file.ts' }
 * })
 *
 * // Option 1: Manual state transitions
 * await execution.begin()
 * const content = await readFile('/file.ts')
 * await execution.complete({ content })
 *
 * // Option 2: Automatic state management
 * const result = await execution.run(async () => {
 *   return await readFile('/file.ts')
 * })
 * ```
 */
export class ToolExecutionTracker {
  private store: GraphStore

  constructor(store: GraphStore) {
    this.store = store
  }

  /**
   * Start a new tool execution.
   *
   * Creates an 'invoke' relationship from the agent to the tool,
   * representing the intent to execute.
   *
   * Note: To support multiple executions of the same tool by the same agent,
   * we use a unique execution URL pattern: `{toolId}/executions/{execId}`.
   * This ensures the relationship unique constraint (verb, from, to) is satisfied.
   */
  async start(options: StartExecutionOptions): Promise<ExecutionHandle> {
    const id = this.generateExecutionId()
    const startedAt = Date.now()

    // Use execution-specific URL to allow multiple executions
    // Format: {toolId}/executions/{id}
    const executionUrl = `${options.toolId}/executions/${id}`

    // Create the initial relationship with 'invoke' verb
    await this.store.createRelationship({
      id,
      verb: 'invoke',
      from: options.agentId,
      to: executionUrl,
      data: {
        input: options.input,
        startedAt,
        toolId: options.toolId,
      } satisfies StoredExecutionData,
    })

    // Return the execution handle
    return this.createExecutionHandle(id, options.agentId, executionUrl, {
      input: options.input,
      startedAt,
      toolId: options.toolId,
    })
  }

  /**
   * Get all executions for a specific agent.
   */
  async getByAgent(agentId: string): Promise<ExecutionHandle[]> {
    // Get all 'invoked' relationships (completed executions)
    const invokedRels = await this.store.queryRelationshipsFrom(agentId, { verb: 'invoked' })

    return invokedRels.map((rel) => {
      const data = rel.data as StoredExecutionData | null
      return this.relationshipToHandle(rel, data)
    })
  }

  /**
   * Get all executions for a specific tool.
   */
  async getByTool(toolId: string): Promise<ExecutionHandle[]> {
    // Query all invoked relationships and filter by toolId
    const allInvoked = await this.store.queryRelationshipsByVerb('invoked')

    const toolExecutions = allInvoked.filter((rel) => {
      const data = rel.data as StoredExecutionData | null
      return data?.toolId === toolId || rel.to === toolId
    })

    return toolExecutions.map((rel) => {
      const data = rel.data as StoredExecutionData | null
      return this.relationshipToHandle(rel, data)
    })
  }

  /**
   * Get aggregate statistics across all executions.
   */
  async getStats(): Promise<ExecutionStats> {
    const allInvoked = await this.store.queryRelationshipsByVerb('invoked')

    let successfulExecutions = 0
    let failedExecutions = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCost = 0

    for (const rel of allInvoked) {
      const data = rel.data as StoredExecutionData | null
      if (data?.success === true) {
        successfulExecutions++
      } else if (data?.success === false) {
        failedExecutions++
      }

      if (data?.cost) {
        totalInputTokens += data.cost.inputTokens || 0
        totalOutputTokens += data.cost.outputTokens || 0
        totalCost += data.cost.estimatedCost || 0
      }
    }

    const totalExecutions = allInvoked.length
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate,
      totalInputTokens: totalInputTokens > 0 ? totalInputTokens : undefined,
      totalOutputTokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
      totalCost: totalCost > 0 ? totalCost : undefined,
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Generate a unique execution ID.
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Create an execution handle with state transition methods.
   */
  private createExecutionHandle(
    id: string,
    agentId: string,
    toolId: string,
    initialData: StoredExecutionData
  ): ExecutionHandle {
    let currentState: ExecutionState = 'pending'
    let currentVerbForm: ExecutionVerbForm = 'invoke'
    let output: unknown
    let success: boolean | undefined
    let duration: number | undefined
    let error: ExecutionError | undefined
    let cost: ExecutionCost | undefined

    const handle: ExecutionHandle = {
      get id() {
        return id
      },
      get state() {
        return currentState
      },
      get verbForm() {
        return currentVerbForm
      },
      get output() {
        return output
      },
      get success() {
        return success
      },
      get duration() {
        return duration
      },
      get error() {
        return error
      },
      get cost() {
        return cost
      },

      begin: async () => {
        // Delete the invoke relationship and create invoking
        await this.store.deleteRelationship(id)

        await this.store.createRelationship({
          id,
          verb: 'invoking',
          from: agentId,
          to: toolId,
          data: {
            ...initialData,
            startedAt: initialData.startedAt,
          } satisfies StoredExecutionData,
        })

        currentState = 'in_progress'
        currentVerbForm = 'invoking'
      },

      complete: async (outputValue: unknown, options?: CompleteExecutionOptions) => {
        const completedAt = Date.now()
        duration = completedAt - initialData.startedAt
        output = outputValue
        success = true
        cost = options?.cost

        // Delete the invoking relationship and create invoked
        await this.store.deleteRelationship(id)

        await this.store.createRelationship({
          id,
          verb: 'invoked',
          from: agentId,
          to: toolId,
          data: {
            ...initialData,
            output: outputValue,
            completedAt,
            duration,
            success: true,
            cost: options?.cost,
          } satisfies StoredExecutionData,
        })

        currentState = 'completed'
        currentVerbForm = 'invoked'
      },

      fail: async (err: Error) => {
        const completedAt = Date.now()
        duration = completedAt - initialData.startedAt
        success = false
        error = {
          message: err.message,
          code: (err as Error & { code?: string }).code,
          stack: err.stack,
        }

        // Delete the invoking relationship and create invoked with error
        await this.store.deleteRelationship(id)

        await this.store.createRelationship({
          id,
          verb: 'invoked',
          from: agentId,
          to: toolId,
          data: {
            ...initialData,
            completedAt,
            duration,
            success: false,
            error: {
              message: err.message,
              code: (err as Error & { code?: string }).code,
              stack: err.stack,
            },
          } satisfies StoredExecutionData,
        })

        currentState = 'completed'
        currentVerbForm = 'invoked'
      },

      run: async <T>(callback: () => Promise<T>): Promise<T> => {
        await handle.begin()

        try {
          const result = await callback()
          await handle.complete(result)
          return result
        } catch (err) {
          await handle.fail(err as Error)
          throw err
        }
      },
    }

    return handle
  }

  /**
   * Convert a stored relationship to an ExecutionHandle (read-only for queried executions)
   */
  private relationshipToHandle(rel: GraphRelationship, data: StoredExecutionData | null): ExecutionHandle {
    const verbForm = rel.verb as ExecutionVerbForm
    const state = verbFormToState(verbForm)

    return {
      id: rel.id,
      state,
      verbForm,
      output: data?.output,
      success: data?.success,
      duration: data?.duration,
      error: data?.error,
      cost: data?.cost,
      // These methods are no-ops for queried (historical) executions
      begin: async () => {
        throw new Error('Cannot modify a queried execution')
      },
      complete: async () => {
        throw new Error('Cannot modify a queried execution')
      },
      fail: async () => {
        throw new Error('Cannot modify a queried execution')
      },
      run: async () => {
        throw new Error('Cannot modify a queried execution')
      },
    }
  }
}
