/**
 * StepExecutionStore - Step Execution as Relationships with Verb Forms
 *
 * TDD GREEN Phase: Implementation for step execution tracked as Relationships
 * with verb forms encoding state.
 *
 * Key Insight: Step execution state is encoded via verb forms, not a status column.
 *
 * State Machine (via verb forms):
 * - 'execute' (action) = pending/intent to execute step
 * - 'executing' (activity) = step is currently running
 * - 'executed' (event) = step completed successfully
 *
 * Skip state machine:
 * - 'skip' (action) = intent to skip step
 * - 'skipping' (activity) = step being skipped
 * - 'skipped' (event) = step was skipped
 *
 * Expected Relationships:
 * - Step execution intent:
 *   { verb: 'execute', from: 'instance:123', to: 'step:validate-expense', data: {...} }
 * - Step in-progress:
 *   { verb: 'executing', from: 'instance:123', to: 'step:...', data: {...} }
 * - Step completed:
 *   { verb: 'executed', from: 'instance:123', to: 'result:step-output-url', data: {...} }
 *
 * @see dotdo-tn7hu - [GREEN] Step execution as Relationships - verb form implementation
 */

import type { GraphStore, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Step execution state derived from verb form
 */
export type StepExecutionState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/**
 * Step execution relationship data
 */
export interface StepExecutionData {
  /** Name of the step being executed */
  stepName: string
  /** Index of the step in the workflow (0-based) */
  stepIndex: number
  /** Duration in milliseconds (only for completed/failed steps) */
  duration?: number
  /** Error message (only for failed steps) */
  error?: string
  /** Timestamp when step started */
  startedAt?: number
  /** Timestamp when step completed */
  completedAt?: number
}

/**
 * Step execution relationship representing a step's execution state
 */
export interface StepExecutionRelationship extends GraphRelationship {
  verb: 'execute' | 'executing' | 'executed' | 'skip' | 'skipping' | 'skipped'
  data: StepExecutionData | null
}

/**
 * Options for creating a step execution
 */
export interface CreateStepExecutionInput {
  /** Workflow instance ID */
  instanceId: string
  /** Step identifier (e.g., 'step:validate-expense') */
  stepId: string
  /** Step name */
  stepName: string
  /** Step index (0-based) */
  stepIndex: number
}

/**
 * Options for completing a step execution
 */
export interface CompleteStepExecutionInput {
  /** Result URL pointing to step output */
  resultTo: string
  /** Duration in milliseconds */
  duration: number
}

/**
 * Options for failing a step execution
 */
export interface FailStepExecutionInput {
  /** Error that caused the failure */
  error: Error
  /** Duration in milliseconds */
  duration: number
}

/**
 * Query options for step executions
 */
export interface QueryStepExecutionOptions {
  /** Filter by workflow instance ID */
  instanceId?: string
  /** Filter by step name */
  stepName?: string
  /** Limit number of results */
  limit?: number
}

// ============================================================================
// VERB FORM STATE MAPPINGS
// ============================================================================

/**
 * Maps verb forms to semantic states
 */
const VERB_TO_STATE: Record<string, StepExecutionState> = {
  // Execute lifecycle
  execute: 'pending',
  executing: 'running',
  executed: 'completed', // Note: 'failed' is determined by presence of error field
  // Skip lifecycle
  skip: 'pending',
  skipping: 'running',
  skipped: 'skipped',
}

/**
 * Execute verb forms in order
 */
const EXECUTE_VERBS = ['execute', 'executing', 'executed'] as const

/**
 * Skip verb forms in order
 */
const SKIP_VERBS = ['skip', 'skipping', 'skipped'] as const

/**
 * All step execution verbs
 */
const ALL_STEP_VERBS = [...EXECUTE_VERBS, ...SKIP_VERBS] as const

// ============================================================================
// StepExecutionStore IMPLEMENTATION
// ============================================================================

/**
 * StepExecutionStore encapsulates step execution tracking as relationships
 * with verb forms encoding state.
 *
 * @example
 * ```typescript
 * const stepStore = createStepExecutionStore(graphStore)
 *
 * // Create pending step execution
 * const pending = await stepStore.createStepExecution({
 *   instanceId: 'instance:exp-001',
 *   stepId: 'step:validate-expense',
 *   stepName: 'validateExpense',
 *   stepIndex: 0,
 * })
 *
 * // Start execution
 * const running = await stepStore.startStepExecution('instance:exp-001', 'validateExpense')
 *
 * // Complete execution
 * const completed = await stepStore.completeStepExecution('instance:exp-001', 'validateExpense', {
 *   resultTo: 'result:instance:exp-001:validateExpense',
 *   duration: 150,
 * })
 * ```
 */
export class StepExecutionStore {
  constructor(private readonly graphStore: GraphStore) {}

  // =========================================================================
  // STEP EXECUTION LIFECYCLE
  // =========================================================================

  /**
   * Create step execution in pending state ('execute' verb).
   *
   * @param input - Step execution creation options
   * @returns The created step execution relationship
   */
  async createStepExecution(input: CreateStepExecutionInput): Promise<StepExecutionRelationship> {
    const relId = this.buildRelationshipId('execute', input.instanceId, input.stepName)

    const relationship = await this.graphStore.createRelationship({
      id: relId,
      verb: 'execute',
      from: input.instanceId,
      to: input.stepId,
      data: {
        stepName: input.stepName,
        stepIndex: input.stepIndex,
      },
    })

    return relationship as StepExecutionRelationship
  }

  /**
   * Start step execution (transition from 'execute' to 'executing' verb).
   *
   * @param instanceId - Workflow instance ID
   * @param stepName - Name of the step
   * @returns The updated step execution relationship
   * @throws Error if step is not in pending state
   */
  async startStepExecution(instanceId: string, stepName: string): Promise<StepExecutionRelationship> {
    const current = await this.getStepExecution(instanceId, stepName)
    if (!current || current.verb !== 'execute') {
      throw new Error(`Cannot start step '${stepName}': not in pending state`)
    }

    const data = current.data as StepExecutionData
    const startedAt = Date.now()

    // Delete old 'execute' relationship
    await this.graphStore.deleteRelationship(current.id)

    // Create new 'executing' relationship
    const newRelId = this.buildRelationshipId('executing', instanceId, stepName)
    const relationship = await this.graphStore.createRelationship({
      id: newRelId,
      verb: 'executing',
      from: instanceId,
      to: current.to, // Keep pointing to step during execution
      data: {
        ...data,
        startedAt,
      },
    })

    return relationship as StepExecutionRelationship
  }

  /**
   * Complete step execution (transition from 'executing' to 'executed' verb).
   *
   * @param instanceId - Workflow instance ID
   * @param stepName - Name of the step
   * @param input - Completion options including result URL and duration
   * @returns The updated step execution relationship
   * @throws Error if step is not in running state
   */
  async completeStepExecution(
    instanceId: string,
    stepName: string,
    input: CompleteStepExecutionInput
  ): Promise<StepExecutionRelationship> {
    const current = await this.getStepExecution(instanceId, stepName)
    if (!current || current.verb !== 'executing') {
      throw new Error(`Cannot complete step '${stepName}': not in running state`)
    }

    const data = current.data as StepExecutionData
    const completedAt = Date.now()

    // Delete old 'executing' relationship
    await this.graphStore.deleteRelationship(current.id)

    // Create new 'executed' relationship pointing to result
    const newRelId = this.buildRelationshipId('executed', instanceId, stepName)
    const relationship = await this.graphStore.createRelationship({
      id: newRelId,
      verb: 'executed',
      from: instanceId,
      to: input.resultTo, // Point to the result
      data: {
        ...data,
        duration: input.duration,
        completedAt,
      },
    })

    return relationship as StepExecutionRelationship
  }

  /**
   * Fail step execution (transition from 'executing' to 'executed' verb with error).
   *
   * @param instanceId - Workflow instance ID
   * @param stepName - Name of the step
   * @param input - Failure options including error and duration
   * @returns The updated step execution relationship
   * @throws Error if step is not in running state
   */
  async failStepExecution(
    instanceId: string,
    stepName: string,
    input: FailStepExecutionInput
  ): Promise<StepExecutionRelationship> {
    const current = await this.getStepExecution(instanceId, stepName)
    if (!current || current.verb !== 'executing') {
      throw new Error(`Cannot fail step '${stepName}': not in running state`)
    }

    const data = current.data as StepExecutionData
    const completedAt = Date.now()

    // Delete old 'executing' relationship
    await this.graphStore.deleteRelationship(current.id)

    // Create new 'executed' relationship with error (point back to instance)
    const newRelId = this.buildRelationshipId('executed', instanceId, stepName)
    const relationship = await this.graphStore.createRelationship({
      id: newRelId,
      verb: 'executed',
      from: instanceId,
      to: instanceId, // Failed steps point back to instance
      data: {
        ...data,
        duration: input.duration,
        completedAt,
        error: input.error.message,
      },
    })

    return relationship as StepExecutionRelationship
  }

  /**
   * Skip step execution (transitions through skip -> skipping -> skipped).
   * This is a convenience method that performs the full skip lifecycle.
   *
   * @param instanceId - Workflow instance ID
   * @param stepName - Name of the step
   * @returns The final skipped step execution relationship
   * @throws Error if step is not in pending state
   */
  async skipStepExecution(instanceId: string, stepName: string): Promise<StepExecutionRelationship> {
    const current = await this.getStepExecution(instanceId, stepName)
    if (!current || current.verb !== 'execute') {
      throw new Error(`Cannot skip step '${stepName}': not in pending state`)
    }

    const data = current.data as StepExecutionData
    const stepId = current.to
    const completedAt = Date.now()

    // Delete the 'execute' relationship
    await this.graphStore.deleteRelationship(current.id)

    // Create 'skip' relationship (intent)
    const skipRelId = this.buildRelationshipId('skip', instanceId, stepName)
    await this.graphStore.createRelationship({
      id: skipRelId,
      verb: 'skip',
      from: instanceId,
      to: stepId,
      data,
    })

    // Delete 'skip' and create 'skipping' relationship (in-progress)
    await this.graphStore.deleteRelationship(skipRelId)
    const skippingRelId = this.buildRelationshipId('skipping', instanceId, stepName)
    await this.graphStore.createRelationship({
      id: skippingRelId,
      verb: 'skipping',
      from: instanceId,
      to: stepId,
      data,
    })

    // Delete 'skipping' and create 'skipped' relationship (final state)
    await this.graphStore.deleteRelationship(skippingRelId)
    const skippedRelId = this.buildRelationshipId('skipped', instanceId, stepName)
    const relationship = await this.graphStore.createRelationship({
      id: skippedRelId,
      verb: 'skipped',
      from: instanceId,
      to: stepId,
      data: {
        ...data,
        completedAt,
      },
    })

    return relationship as StepExecutionRelationship
  }

  // =========================================================================
  // STATE QUERIES
  // =========================================================================

  /**
   * Get current step execution state.
   *
   * @param instanceId - Workflow instance ID
   * @param stepName - Name of the step
   * @returns The step state or null if no execution found
   */
  async getStepExecutionState(instanceId: string, stepName: string): Promise<StepExecutionState | null> {
    const execution = await this.getStepExecution(instanceId, stepName)
    if (!execution) {
      return null
    }

    // Check for failed state (executed with error)
    if (execution.verb === 'executed') {
      const data = execution.data as StepExecutionData
      if (data?.error) {
        return 'failed'
      }
      return 'completed'
    }

    return VERB_TO_STATE[execution.verb] ?? null
  }

  /**
   * Get step execution relationship.
   *
   * @param instanceId - Workflow instance ID
   * @param stepName - Name of the step
   * @returns The step execution relationship or null if not found
   */
  async getStepExecution(
    instanceId: string,
    stepName: string
  ): Promise<StepExecutionRelationship | null> {
    // Query all relationships from the instance
    const allRels = await this.graphStore.queryRelationshipsFrom(instanceId)

    // Find the step execution relationship for this step
    for (const rel of allRels) {
      if (!ALL_STEP_VERBS.includes(rel.verb as typeof ALL_STEP_VERBS[number])) {
        continue
      }

      const data = rel.data as StepExecutionData | null
      if (data?.stepName === stepName) {
        return rel as StepExecutionRelationship
      }
    }

    return null
  }

  /**
   * Query step executions by state.
   *
   * @param state - The state to filter by
   * @param options - Query options
   * @returns Array of step execution relationships matching the state
   */
  async queryStepsByState(
    state: StepExecutionState,
    options?: QueryStepExecutionOptions
  ): Promise<StepExecutionRelationship[]> {
    let results: StepExecutionRelationship[] = []

    // Determine which verbs to query based on state
    const verbsToQuery = this.getVerbsForState(state)

    for (const verb of verbsToQuery) {
      let verbRels: GraphRelationship[]

      if (options?.instanceId) {
        verbRels = await this.graphStore.queryRelationshipsFrom(options.instanceId, { verb })
      } else {
        verbRels = await this.graphStore.queryRelationshipsByVerb(verb)
      }

      // Filter for step execution relationships
      const stepRels = verbRels.filter((rel) => {
        const data = rel.data as StepExecutionData | null
        if (!data?.stepName) return false

        // For 'executed' verb, check if this matches the expected state
        if (verb === 'executed') {
          const hasError = !!data.error
          if (state === 'failed' && !hasError) return false
          if (state === 'completed' && hasError) return false
        }

        // Filter by stepName if provided
        if (options?.stepName && data.stepName !== options.stepName) {
          return false
        }

        return true
      }) as StepExecutionRelationship[]

      results = results.concat(stepRels)
    }

    // Apply limit if provided
    if (options?.limit) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  /**
   * Query all step executions for a workflow instance.
   *
   * @param instanceId - Workflow instance ID
   * @returns Array of all step execution relationships for the instance
   */
  async queryStepsByInstance(instanceId: string): Promise<StepExecutionRelationship[]> {
    const allRels = await this.graphStore.queryRelationshipsFrom(instanceId)

    return allRels.filter((rel) => {
      if (!ALL_STEP_VERBS.includes(rel.verb as typeof ALL_STEP_VERBS[number])) {
        return false
      }
      const data = rel.data as StepExecutionData | null
      return !!data?.stepName
    }) as StepExecutionRelationship[]
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Build a relationship ID for step execution.
   */
  private buildRelationshipId(verb: string, instanceId: string, stepName: string): string {
    return `rel:${verb}:${instanceId}:${stepName}`
  }

  /**
   * Get the verb(s) that correspond to a given state.
   */
  private getVerbsForState(state: StepExecutionState): string[] {
    switch (state) {
      case 'pending':
        return ['execute']
      case 'running':
        return ['executing']
      case 'completed':
        return ['executed'] // Will be filtered by absence of error
      case 'failed':
        return ['executed'] // Will be filtered by presence of error
      case 'skipped':
        return ['skipped']
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Factory function to create StepExecutionStore.
 *
 * @param graphStore - The underlying GraphStore implementation
 * @returns A new StepExecutionStore instance
 */
export function createStepExecutionStore(graphStore: GraphStore): StepExecutionStore {
  return new StepExecutionStore(graphStore)
}
