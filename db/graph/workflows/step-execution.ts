/**
 * StepExecutionStore
 *
 * Manages step execution tracking as Relationships with verb form state encoding.
 *
 * State Machine (via verb forms):
 * - 'execute' (action) = pending
 * - 'executing' (activity) = running
 * - 'executed' (event) = completed
 *
 * Skip lifecycle:
 * - 'skip' (action) = intent to skip
 * - 'skipping' (activity) = being skipped
 * - 'skipped' (event) = was skipped
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 * @see dotdo-tn7hu - Step execution as Relationships
 * @module db/graph/workflows/step-execution
 */

import type { GraphStore, GraphRelationship } from '../types'
import {
  STEP_RESULT_TYPE_ID,
  STEP_RESULT_TYPE_NAME,
  type StepExecutionState,
  type StepExecutionData,
  type StepExecutionRelationship,
  type StepResultThing,
  type StepResultData,
  type CreateStepExecutionInput,
  type CompleteStepExecutionInput,
  type FailStepExecutionInput,
  type QueryStepExecutionsOptions,
} from './types'

// ============================================================================
// ID GENERATION
// ============================================================================

let executionCounter = 0

/**
 * Generate a unique execution relationship ID
 */
function generateExecutionId(verb: string, instanceId: string, stepName: string): string {
  executionCounter++
  return `rel:${verb}:${instanceId}:${stepName}:${executionCounter.toString(36)}`
}

/**
 * Generate a result Thing ID
 */
function generateResultId(instanceId: string, stepName: string): string {
  return `result:${instanceId}:${stepName}`
}

// ============================================================================
// VERB FORM MAPPING
// ============================================================================

/**
 * Execute verb forms
 */
const EXECUTE_VERBS = {
  ACTION: 'execute',
  ACTIVITY: 'executing',
  EVENT: 'executed',
} as const

/**
 * Skip verb forms
 */
const SKIP_VERBS = {
  ACTION: 'skip',
  ACTIVITY: 'skipping',
  EVENT: 'skipped',
} as const

/**
 * Maps verb forms to step execution states
 */
export function verbFormToStepState(verb: string): StepExecutionState {
  switch (verb) {
    case EXECUTE_VERBS.ACTION:
      return 'pending'
    case EXECUTE_VERBS.ACTIVITY:
      return 'running'
    case EXECUTE_VERBS.EVENT:
      return 'completed' // Note: need to check error field for 'failed'
    case SKIP_VERBS.ACTION:
    case SKIP_VERBS.ACTIVITY:
    case SKIP_VERBS.EVENT:
      return 'skipped'
    default:
      return 'pending'
  }
}

/**
 * Maps step states to verb forms for querying
 */
export function stepStateToVerbForms(state: StepExecutionState): string[] {
  switch (state) {
    case 'pending':
      return [EXECUTE_VERBS.ACTION]
    case 'running':
      return [EXECUTE_VERBS.ACTIVITY]
    case 'completed':
      return [EXECUTE_VERBS.EVENT] // Will need to filter out those with error
    case 'failed':
      return [EXECUTE_VERBS.EVENT] // Will need to filter for those with error
    case 'skipped':
      return [SKIP_VERBS.EVENT]
  }
}

// ============================================================================
// STEP EXECUTION STORE CLASS
// ============================================================================

/**
 * StepExecutionStore manages step execution tracking as graph relationships.
 *
 * Uses verb form state encoding:
 * - execute (action) -> executing (activity) -> executed (event)
 * - skip (action) -> skipping (activity) -> skipped (event)
 */
export class StepExecutionStore {
  private store: GraphStore

  constructor(store: GraphStore) {
    this.store = store
  }

  // ==========================================================================
  // CREATE OPERATIONS
  // ==========================================================================

  /**
   * Create a step execution in pending state ('execute' verb)
   */
  async createStepExecution(
    input: CreateStepExecutionInput
  ): Promise<StepExecutionRelationship> {
    const data: StepExecutionData = {
      stepName: input.stepName,
      stepIndex: input.stepIndex,
      input: input.input,
    }

    const rel = await this.store.createRelationship({
      id: generateExecutionId(EXECUTE_VERBS.ACTION, input.instanceId, input.stepName),
      verb: EXECUTE_VERBS.ACTION,
      from: input.instanceId,
      to: input.stepId,
      data: data as Record<string, unknown>,
    })

    return this.toStepExecutionRelationship(rel)
  }

  // ==========================================================================
  // STATE TRANSITIONS
  // ==========================================================================

  /**
   * Start step execution (transition to 'executing' verb)
   */
  async startStepExecution(
    instanceId: string,
    stepName: string
  ): Promise<StepExecutionRelationship> {
    const current = await this.findStepExecution(instanceId, stepName, [EXECUTE_VERBS.ACTION])
    if (!current) {
      throw new Error(`No pending step execution found for ${stepName}`)
    }

    const currentData = current.data as StepExecutionData
    const newData: StepExecutionData = {
      ...currentData,
      startedAt: Date.now(),
    }

    // Delete current relationship
    await this.store.deleteRelationship(current.id)

    // Create new relationship with executing verb
    const rel = await this.store.createRelationship({
      id: generateExecutionId(EXECUTE_VERBS.ACTIVITY, instanceId, stepName),
      verb: EXECUTE_VERBS.ACTIVITY,
      from: instanceId,
      to: current.to, // Keep pointing to step during execution
      data: newData as Record<string, unknown>,
    })

    return this.toStepExecutionRelationship(rel)
  }

  /**
   * Complete step execution (transition to 'executed' verb with result)
   */
  async completeStepExecution(
    instanceId: string,
    stepName: string,
    input: CompleteStepExecutionInput
  ): Promise<StepExecutionRelationship> {
    const current = await this.findStepExecution(instanceId, stepName, [EXECUTE_VERBS.ACTIVITY])
    if (!current) {
      throw new Error(`No running step execution found for ${stepName}`)
    }

    const currentData = current.data as StepExecutionData
    const completedAt = Date.now()
    const newData: StepExecutionData = {
      ...currentData,
      completedAt,
      duration: input.duration,
    }

    // Delete current relationship
    await this.store.deleteRelationship(current.id)

    // Create new relationship with executed verb, pointing to result
    const rel = await this.store.createRelationship({
      id: generateExecutionId(EXECUTE_VERBS.EVENT, instanceId, stepName),
      verb: EXECUTE_VERBS.EVENT,
      from: instanceId,
      to: input.resultTo, // Point to result Thing
      data: newData as Record<string, unknown>,
    })

    return this.toStepExecutionRelationship(rel)
  }

  /**
   * Fail step execution (transition to 'executed' verb with error)
   */
  async failStepExecution(
    instanceId: string,
    stepName: string,
    input: FailStepExecutionInput
  ): Promise<StepExecutionRelationship> {
    const current = await this.findStepExecution(instanceId, stepName, [EXECUTE_VERBS.ACTIVITY])
    if (!current) {
      throw new Error(`No running step execution found for ${stepName}`)
    }

    const currentData = current.data as StepExecutionData
    const completedAt = Date.now()
    const newData: StepExecutionData = {
      ...currentData,
      completedAt,
      duration: input.duration,
      error: input.error.message,
    }

    // Delete current relationship
    await this.store.deleteRelationship(current.id)

    // Create new relationship with executed verb but with error
    const rel = await this.store.createRelationship({
      id: generateExecutionId(EXECUTE_VERBS.EVENT, instanceId, stepName),
      verb: EXECUTE_VERBS.EVENT,
      from: instanceId,
      to: instanceId, // Failed steps point back to instance
      data: newData as Record<string, unknown>,
    })

    return this.toStepExecutionRelationship(rel)
  }

  /**
   * Skip step execution (transition through skip -> skipping -> skipped)
   */
  async skipStepExecution(
    instanceId: string,
    stepName: string
  ): Promise<StepExecutionRelationship> {
    // Find the pending execution
    const current = await this.findStepExecution(instanceId, stepName, [EXECUTE_VERBS.ACTION])

    let stepId = current?.to
    let currentData = current?.data as StepExecutionData | undefined

    if (current) {
      stepId = current.to
      currentData = current.data as StepExecutionData
      // Delete current relationship
      await this.store.deleteRelationship(current.id)
    }

    const newData: StepExecutionData = {
      stepName,
      stepIndex: currentData?.stepIndex ?? 0,
      completedAt: Date.now(),
    }

    // Create skipped relationship directly (skip immediate transition)
    const rel = await this.store.createRelationship({
      id: generateExecutionId(SKIP_VERBS.EVENT, instanceId, stepName),
      verb: SKIP_VERBS.EVENT,
      from: instanceId,
      to: stepId ?? `step:${stepName}`,
      data: newData as Record<string, unknown>,
    })

    return this.toStepExecutionRelationship(rel)
  }

  // ==========================================================================
  // QUERY OPERATIONS
  // ==========================================================================

  /**
   * Get the current state of a step execution
   */
  async getStepExecutionState(
    instanceId: string,
    stepName: string
  ): Promise<StepExecutionState | null> {
    const execution = await this.getStepExecution(instanceId, stepName)
    if (!execution) {
      return null
    }

    // Check for executed with error = failed
    if (
      execution.verb === EXECUTE_VERBS.EVENT &&
      (execution.data as StepExecutionData)?.error
    ) {
      return 'failed'
    }

    return verbFormToStepState(execution.verb)
  }

  /**
   * Get the step execution relationship for a step
   */
  async getStepExecution(
    instanceId: string,
    stepName: string
  ): Promise<StepExecutionRelationship | null> {
    // Check all possible verb forms
    const allVerbs = [
      EXECUTE_VERBS.ACTION,
      EXECUTE_VERBS.ACTIVITY,
      EXECUTE_VERBS.EVENT,
      SKIP_VERBS.ACTION,
      SKIP_VERBS.ACTIVITY,
      SKIP_VERBS.EVENT,
    ]

    for (const verb of allVerbs) {
      const rels = await this.store.queryRelationshipsFrom(instanceId, { verb })
      const match = rels.find(
        (r) => (r.data as StepExecutionData)?.stepName === stepName
      )
      if (match) {
        return this.toStepExecutionRelationship(match)
      }
    }

    return null
  }

  /**
   * Query step executions by state
   */
  async queryStepsByState(
    state: StepExecutionState,
    options?: QueryStepExecutionsOptions
  ): Promise<StepExecutionRelationship[]> {
    const verbForms = stepStateToVerbForms(state)
    const results: StepExecutionRelationship[] = []

    for (const verb of verbForms) {
      let rels: GraphRelationship[]

      if (options?.instanceId) {
        rels = await this.store.queryRelationshipsFrom(options.instanceId, { verb })
      } else {
        rels = await this.store.queryRelationshipsByVerb(verb)
      }

      for (const rel of rels) {
        const data = rel.data as StepExecutionData

        // Filter by step name if specified
        if (options?.stepName && data?.stepName !== options.stepName) {
          continue
        }

        // Special handling for completed vs failed
        if (state === 'completed' && data?.error) {
          continue // Skip failed steps when querying completed
        }
        if (state === 'failed' && !data?.error) {
          continue // Skip completed steps when querying failed
        }

        results.push(this.toStepExecutionRelationship(rel))
      }
    }

    // Apply limit
    if (options?.limit) {
      return results.slice(0, options.limit)
    }

    return results
  }

  /**
   * Query all step executions for a workflow instance
   */
  async queryStepsByInstance(
    instanceId: string
  ): Promise<StepExecutionRelationship[]> {
    const allVerbs = [
      EXECUTE_VERBS.ACTION,
      EXECUTE_VERBS.ACTIVITY,
      EXECUTE_VERBS.EVENT,
      SKIP_VERBS.ACTION,
      SKIP_VERBS.ACTIVITY,
      SKIP_VERBS.EVENT,
    ]

    const results: StepExecutionRelationship[] = []

    for (const verb of allVerbs) {
      const rels = await this.store.queryRelationshipsFrom(instanceId, { verb })
      for (const rel of rels) {
        results.push(this.toStepExecutionRelationship(rel))
      }
    }

    // Sort by stepIndex
    results.sort((a, b) => {
      const aIndex = (a.data as StepExecutionData)?.stepIndex ?? 0
      const bIndex = (b.data as StepExecutionData)?.stepIndex ?? 0
      return aIndex - bIndex
    })

    return results
  }

  // ==========================================================================
  // RESULT OPERATIONS
  // ==========================================================================

  /**
   * Create a step result Thing
   */
  async createStepResult(
    instanceId: string,
    stepName: string,
    output: Record<string, unknown>
  ): Promise<StepResultThing> {
    const id = generateResultId(instanceId, stepName)

    const resultData: StepResultData = {
      stepName,
      output,
      createdAt: Date.now(),
    }

    const thing = await this.store.createThing({
      id,
      typeId: STEP_RESULT_TYPE_ID,
      typeName: STEP_RESULT_TYPE_NAME,
      data: resultData as Record<string, unknown>,
    })

    return thing as unknown as StepResultThing
  }

  /**
   * Get the result for a step
   */
  async getStepResult(
    instanceId: string,
    stepName: string
  ): Promise<StepResultThing | null> {
    const id = generateResultId(instanceId, stepName)
    const thing = await this.store.getThing(id)

    if (!thing || thing.typeId !== STEP_RESULT_TYPE_ID) {
      return null
    }

    return thing as unknown as StepResultThing
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Find a step execution with specific verbs
   */
  private async findStepExecution(
    instanceId: string,
    stepName: string,
    verbs: string[]
  ): Promise<GraphRelationship | null> {
    for (const verb of verbs) {
      const rels = await this.store.queryRelationshipsFrom(instanceId, { verb })
      const match = rels.find(
        (r) => (r.data as StepExecutionData)?.stepName === stepName
      )
      if (match) {
        return match
      }
    }
    return null
  }

  /**
   * Convert a GraphRelationship to StepExecutionRelationship
   */
  private toStepExecutionRelationship(rel: GraphRelationship): StepExecutionRelationship {
    return {
      ...rel,
      verb: rel.verb as StepExecutionRelationship['verb'],
      data: rel.data as StepExecutionData | null,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a StepExecutionStore instance
 */
export function createStepExecutionStore(store: GraphStore): StepExecutionStore {
  return new StepExecutionStore(store)
}
