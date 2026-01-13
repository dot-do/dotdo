/**
 * WorkflowCore Bridge
 *
 * Bridges the Graph-based workflow primitives with the existing WorkflowCore infrastructure.
 * This allows the graph model to serve as the persistence layer for WorkflowCore.
 *
 * Integration points:
 * - WorkflowCoreStorageStrategy uses graph for step tracking
 * - WorkflowHistory backed by step execution relationships
 * - Timer management connected to WaitForEvent graph primitives
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 * @module db/graph/workflows/workflow-core-bridge
 */

import type { GraphStore } from '../types'
import {
  createWorkflowInstance,
  getWorkflowInstance,
  getWorkflowInstanceState,
  startWorkflowInstance,
  completeWorkflowInstance,
  pauseWorkflowInstance,
  resumeWorkflowInstance,
  failWorkflowInstance,
  updateInstanceCurrentStep,
  type WorkflowInstanceThing,
  type InstanceState,
} from './workflow-instance'
import {
  StepExecutionStore,
  createStepExecutionStore,
  type StepExecutionState,
} from './step-execution'
import type {
  CreateWorkflowInstanceInput,
  StepExecutionRelationship,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Step result from the graph-backed workflow
 */
export interface GraphStepResult<T = unknown> {
  readonly status: 'success' | 'error'
  readonly value?: T
  readonly error?: Error
}

/**
 * Checkpoint state for workflow persistence
 */
export interface GraphCheckpointState {
  instanceId: string
  templateId: string
  stateVerb: string
  currentStepIndex: number
  currentStepName: string
  completedSteps: string[]
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
}

/**
 * Step execution options
 */
export interface GraphStepExecutionOptions {
  timeout?: number
  retries?: number
  retryDelay?: number
}

// ============================================================================
// GRAPH WORKFLOW RUNTIME
// ============================================================================

/**
 * GraphWorkflowRuntime provides a WorkflowCore-compatible interface
 * backed by the graph model for persistence and state tracking.
 *
 * This bridges the existing WorkflowCore patterns with graph-based storage.
 */
export class GraphWorkflowRuntime {
  private store: GraphStore
  private stepStore: StepExecutionStore
  private instanceId: string | null = null
  private stepResultCache = new Map<string, GraphStepResult>()

  constructor(store: GraphStore) {
    this.store = store
    this.stepStore = createStepExecutionStore(store)
  }

  // ==========================================================================
  // INSTANCE LIFECYCLE
  // ==========================================================================

  /**
   * Initialize a new workflow instance
   */
  async initialize(input: CreateWorkflowInstanceInput): Promise<WorkflowInstanceThing> {
    const instance = await createWorkflowInstance(this.store, input)
    this.instanceId = instance.id
    return instance
  }

  /**
   * Load an existing workflow instance
   */
  async load(instanceId: string): Promise<WorkflowInstanceThing | null> {
    const instance = await getWorkflowInstance(this.store, instanceId)
    if (instance) {
      this.instanceId = instance.id
      // Rebuild step cache from graph
      await this.rebuildStepCache()
    }
    return instance
  }

  /**
   * Get current instance
   */
  async getInstance(): Promise<WorkflowInstanceThing | null> {
    if (!this.instanceId) return null
    return getWorkflowInstance(this.store, this.instanceId)
  }

  /**
   * Get current workflow state
   */
  async getState(): Promise<InstanceState | null> {
    if (!this.instanceId) return null
    return getWorkflowInstanceState(this.store, this.instanceId)
  }

  // ==========================================================================
  // STATE TRANSITIONS
  // ==========================================================================

  /**
   * Start the workflow
   */
  async start(): Promise<WorkflowInstanceThing> {
    this.ensureInstance()
    return startWorkflowInstance(this.store, this.instanceId!)
  }

  /**
   * Complete the workflow with output
   */
  async complete(output: Record<string, unknown>): Promise<WorkflowInstanceThing> {
    this.ensureInstance()
    return completeWorkflowInstance(this.store, this.instanceId!, output)
  }

  /**
   * Pause the workflow
   */
  async pause(): Promise<WorkflowInstanceThing> {
    this.ensureInstance()
    return pauseWorkflowInstance(this.store, this.instanceId!)
  }

  /**
   * Resume the workflow
   */
  async resume(): Promise<WorkflowInstanceThing> {
    this.ensureInstance()
    return resumeWorkflowInstance(this.store, this.instanceId!)
  }

  /**
   * Fail the workflow with an error
   */
  async fail(error: Error): Promise<WorkflowInstanceThing> {
    this.ensureInstance()
    return failWorkflowInstance(this.store, this.instanceId!, error)
  }

  // ==========================================================================
  // STEP EXECUTION (WorkflowCore Compatible)
  // ==========================================================================

  /**
   * Execute a step with caching (WorkflowCore pattern)
   *
   * If the step has already been completed, returns the cached result.
   * Otherwise executes the function and caches the result.
   */
  async executeStep<T>(
    stepName: string,
    stepIndex: number,
    fn: () => T | Promise<T>,
    _options?: GraphStepExecutionOptions
  ): Promise<T> {
    this.ensureInstance()

    // Check local cache first
    const cached = this.stepResultCache.get(stepName)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Check if already completed in graph
    const existingState = await this.stepStore.getStepExecutionState(
      this.instanceId!,
      stepName
    )
    if (existingState === 'completed') {
      const result = await this.stepStore.getStepResult(this.instanceId!, stepName)
      if (result?.data?.output) {
        const value = result.data.output as T
        this.stepResultCache.set(stepName, { status: 'success', value })
        return value
      }
    }

    // Create step execution in pending state
    await this.stepStore.createStepExecution({
      instanceId: this.instanceId!,
      stepId: `step:${stepName}`,
      stepName,
      stepIndex,
    })

    // Start execution
    await this.stepStore.startStepExecution(this.instanceId!, stepName)

    // Update instance current step
    await updateInstanceCurrentStep(this.store, this.instanceId!, stepIndex, stepName)

    const startTime = Date.now()

    try {
      // Execute the function
      const result = await fn()

      // Create result Thing
      const resultThing = await this.stepStore.createStepResult(
        this.instanceId!,
        stepName,
        { result } as Record<string, unknown>
      )

      // Complete the step execution
      await this.stepStore.completeStepExecution(this.instanceId!, stepName, {
        resultTo: resultThing.id,
        duration: Date.now() - startTime,
      })

      // Cache result
      this.stepResultCache.set(stepName, { status: 'success', value: result })

      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Fail the step execution
      await this.stepStore.failStepExecution(this.instanceId!, stepName, {
        error: err,
        duration: Date.now() - startTime,
      })

      // Cache error
      this.stepResultCache.set(stepName, { status: 'error', error: err })

      throw err
    }
  }

  /**
   * Check if a step has been completed
   */
  async isStepCompleted(stepName: string): Promise<boolean> {
    if (this.stepResultCache.has(stepName)) {
      return true
    }

    if (!this.instanceId) {
      return false
    }

    const state = await this.stepStore.getStepExecutionState(this.instanceId, stepName)
    return state === 'completed' || state === 'failed' || state === 'skipped'
  }

  /**
   * Get step result
   */
  async getStepResult<T>(stepName: string): Promise<T | undefined> {
    const cached = this.stepResultCache.get(stepName)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    if (!this.instanceId) {
      return undefined
    }

    const result = await this.stepStore.getStepResult(this.instanceId, stepName)
    return result?.data?.output as T | undefined
  }

  /**
   * Get all step executions for this instance
   */
  async getStepExecutions(): Promise<StepExecutionRelationship[]> {
    if (!this.instanceId) return []
    return this.stepStore.queryStepsByInstance(this.instanceId)
  }

  /**
   * Skip a step
   */
  async skipStep(stepName: string): Promise<void> {
    this.ensureInstance()
    await this.stepStore.skipStepExecution(this.instanceId!, stepName)
    this.stepResultCache.set(stepName, { status: 'success', value: undefined })
  }

  // ==========================================================================
  // CHECKPOINTING
  // ==========================================================================

  /**
   * Create a checkpoint of current workflow state
   */
  async checkpoint(): Promise<GraphCheckpointState> {
    this.ensureInstance()

    const instance = await getWorkflowInstance(this.store, this.instanceId!)
    if (!instance) {
      throw new Error('Instance not found')
    }

    const completedSteps: string[] = []
    const steps = await this.stepStore.queryStepsByInstance(this.instanceId!)
    for (const step of steps) {
      if (step.verb === 'executed' || step.verb === 'skipped') {
        completedSteps.push(step.data?.stepName ?? '')
      }
    }

    return {
      instanceId: instance.id,
      templateId: instance.data?.templateId ?? '',
      stateVerb: instance.data?.stateVerb ?? 'start',
      currentStepIndex: instance.data?.currentStepIndex ?? 0,
      currentStepName: instance.data?.currentStepName ?? '',
      completedSteps,
      input: instance.data?.input ?? {},
      output: instance.data?.output,
      error: instance.data?.error,
    }
  }

  /**
   * Restore workflow state from a checkpoint
   */
  async restore(state: GraphCheckpointState): Promise<void> {
    this.instanceId = state.instanceId

    // Rebuild step cache from completed steps
    this.stepResultCache.clear()
    for (const stepName of state.completedSteps) {
      this.stepResultCache.set(stepName, { status: 'success', value: undefined })
    }

    // Load actual results from graph
    await this.rebuildStepCache()
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Clear local cache
   */
  clear(): void {
    this.stepResultCache.clear()
  }

  /**
   * Dispose of runtime resources
   */
  dispose(): void {
    this.stepResultCache.clear()
    this.instanceId = null
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private ensureInstance(): void {
    if (!this.instanceId) {
      throw new Error('No workflow instance. Call initialize() or load() first.')
    }
  }

  private async rebuildStepCache(): Promise<void> {
    if (!this.instanceId) return

    const steps = await this.stepStore.queryStepsByInstance(this.instanceId)
    for (const step of steps) {
      if (!step.data?.stepName) continue

      if (step.verb === 'executed') {
        if (step.data.error) {
          this.stepResultCache.set(step.data.stepName, {
            status: 'error',
            error: new Error(step.data.error),
          })
        } else {
          // Try to get the actual result
          const result = await this.stepStore.getStepResult(this.instanceId, step.data.stepName)
          this.stepResultCache.set(step.data.stepName, {
            status: 'success',
            value: result?.data?.output,
          })
        }
      } else if (step.verb === 'skipped') {
        this.stepResultCache.set(step.data.stepName, {
          status: 'success',
          value: undefined,
        })
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a GraphWorkflowRuntime instance
 */
export function createGraphWorkflowRuntime(store: GraphStore): GraphWorkflowRuntime {
  return new GraphWorkflowRuntime(store)
}
