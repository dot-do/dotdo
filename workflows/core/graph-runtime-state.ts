/// <reference types="@cloudflare/workers-types" />

/**
 * GraphRuntimeState - Graph-based state management for WorkflowRuntime
 *
 * This module migrates WorkflowRuntime state from flat storage to a graph-based
 * representation using Things and Relationships:
 *
 * ## Data Model:
 *
 * ### Things (Nodes):
 * - **WorkflowRun**: The workflow instance itself
 *   - `$id`: workflow:{instanceId}
 *   - `data`: { name, version, status, input, output, startedAt, completedAt, error }
 *
 * - **WorkflowStep**: Individual step execution records
 *   - `$id`: workflow:{instanceId}:step:{stepIndex}:{stepName}
 *   - `data`: { name, index, status, output, duration, startedAt, completedAt, error, retryCount }
 *
 * ### Relationships (Edges):
 * - **executes**: WorkflowRun -> WorkflowStep (ordered by step index)
 * - **follows**: WorkflowStep -> WorkflowStep (step execution sequence)
 * - **waitingFor**: WorkflowRun -> Event (pending event waits)
 *
 * ## Benefits:
 * - Query execution history via graph traversal
 * - Cross-workflow analysis via relationship queries
 * - Natural representation of workflow DAGs
 * - Efficient retrieval of step chains
 *
 * @module workflows/core/graph-runtime-state
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Workflow runtime state values
 */
export type WorkflowRuntimeStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

/**
 * Step execution status values
 */
export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/**
 * Thing representation for a workflow run
 */
export interface WorkflowRunThing {
  $id: string
  $type: 'WorkflowRun'
  data: {
    name: string
    version?: string
    description?: string
    status: WorkflowRuntimeStatus
    instanceId: string
    input?: unknown
    output?: unknown
    error?: {
      message: string
      name: string
      stack?: string
    }
    currentStepIndex: number
    pendingEvents: string[]
    startedAt?: string
    completedAt?: string
  }
  createdAt: number
  updatedAt: number
}

/**
 * Thing representation for a workflow step
 */
export interface WorkflowStepThing {
  $id: string
  $type: 'WorkflowStep'
  data: {
    name: string
    index: number
    status: StepExecutionStatus
    output?: unknown
    error?: {
      message: string
      name: string
      stack?: string
    }
    duration?: number
    retryCount?: number
    startedAt?: string
    completedAt?: string
    // For parallel steps
    isParallel?: boolean
    parallelResults?: Record<string, {
      name: string
      status: StepExecutionStatus
      output?: unknown
      error?: {
        message: string
        name: string
        stack?: string
      }
      duration?: number
      startedAt?: string
      completedAt?: string
    }>
  }
  createdAt: number
  updatedAt: number
}

/**
 * Relationship edge between workflow entities
 */
export interface WorkflowRelationship {
  id: string
  verb: 'executes' | 'follows' | 'waitingFor' | 'contains'
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: number
}

/**
 * Storage interface for graph-based workflow state
 */
export interface GraphRuntimeStorage {
  // Thing operations
  createThing(thing: WorkflowRunThing | WorkflowStepThing): Promise<void>
  getThing<T extends WorkflowRunThing | WorkflowStepThing>(id: string): Promise<T | null>
  updateThing(id: string, updates: Partial<WorkflowRunThing['data'] | WorkflowStepThing['data']>): Promise<void>
  listThings(options: { type?: string; prefix?: string }): Promise<Array<WorkflowRunThing | WorkflowStepThing>>

  // Relationship operations
  createRelationship(rel: Omit<WorkflowRelationship, 'id' | 'createdAt'>): Promise<WorkflowRelationship>
  getRelationshipsFrom(fromId: string, verb?: string): Promise<WorkflowRelationship[]>
  getRelationshipsTo(toId: string, verb?: string): Promise<WorkflowRelationship[]>
  deleteRelationship(id: string): Promise<void>
}

/**
 * Configuration for GraphRuntimeState
 */
export interface GraphRuntimeStateConfig {
  /** Workflow name */
  name: string
  /** Workflow version */
  version?: string
  /** Workflow description */
  description?: string
  /** Unique instance ID (auto-generated if not provided) */
  instanceId?: string
}

// ============================================================================
// IN-MEMORY STORAGE IMPLEMENTATION (for testing/standalone use)
// ============================================================================

/**
 * In-memory implementation of GraphRuntimeStorage
 * Useful for testing or when DO storage is not available
 */
export class InMemoryGraphStorage implements GraphRuntimeStorage {
  private things = new Map<string, WorkflowRunThing | WorkflowStepThing>()
  private relationships = new Map<string, WorkflowRelationship>()
  private relationshipCounter = 0

  async createThing(thing: WorkflowRunThing | WorkflowStepThing): Promise<void> {
    this.things.set(thing.$id, thing)
  }

  async getThing<T extends WorkflowRunThing | WorkflowStepThing>(id: string): Promise<T | null> {
    return (this.things.get(id) as T) ?? null
  }

  async updateThing(
    id: string,
    updates: Partial<WorkflowRunThing['data'] | WorkflowStepThing['data']>
  ): Promise<void> {
    const thing = this.things.get(id)
    if (thing) {
      thing.data = { ...thing.data, ...updates } as typeof thing.data
      thing.updatedAt = Date.now()
    }
  }

  async listThings(options: { type?: string; prefix?: string }): Promise<Array<WorkflowRunThing | WorkflowStepThing>> {
    const results: Array<WorkflowRunThing | WorkflowStepThing> = []
    const values = Array.from(this.things.values())
    for (const thing of values) {
      if (options.type && thing.$type !== options.type) continue
      if (options.prefix && !thing.$id.startsWith(options.prefix)) continue
      results.push(thing)
    }
    return results
  }

  async createRelationship(
    rel: Omit<WorkflowRelationship, 'id' | 'createdAt'>
  ): Promise<WorkflowRelationship> {
    const id = `rel-${++this.relationshipCounter}`
    const relationship: WorkflowRelationship = {
      ...rel,
      id,
      createdAt: Date.now(),
    }
    this.relationships.set(id, relationship)
    return relationship
  }

  async getRelationshipsFrom(fromId: string, verb?: string): Promise<WorkflowRelationship[]> {
    const results: WorkflowRelationship[] = []
    const values = Array.from(this.relationships.values())
    for (const rel of values) {
      if (rel.from === fromId) {
        if (!verb || rel.verb === verb) {
          results.push(rel)
        }
      }
    }
    return results
  }

  async getRelationshipsTo(toId: string, verb?: string): Promise<WorkflowRelationship[]> {
    const results: WorkflowRelationship[] = []
    const values = Array.from(this.relationships.values())
    for (const rel of values) {
      if (rel.to === toId) {
        if (!verb || rel.verb === verb) {
          results.push(rel)
        }
      }
    }
    return results
  }

  async deleteRelationship(id: string): Promise<void> {
    this.relationships.delete(id)
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.things.clear()
    this.relationships.clear()
    this.relationshipCounter = 0
  }
}

// ============================================================================
// DO STORAGE ADAPTER
// ============================================================================

/**
 * Adapter that wraps DurableObjectStorage to implement GraphRuntimeStorage
 */
export class DOGraphStorageAdapter implements GraphRuntimeStorage {
  private storage: DurableObjectStorage

  constructor(storage: DurableObjectStorage) {
    this.storage = storage
  }

  async createThing(thing: WorkflowRunThing | WorkflowStepThing): Promise<void> {
    await this.storage.put(`graph:thing:${thing.$id}`, thing)
  }

  async getThing<T extends WorkflowRunThing | WorkflowStepThing>(id: string): Promise<T | null> {
    const thing = await this.storage.get<T>(`graph:thing:${id}`)
    return thing ?? null
  }

  async updateThing(
    id: string,
    updates: Partial<WorkflowRunThing['data'] | WorkflowStepThing['data']>
  ): Promise<void> {
    const thing = await this.getThing(id)
    if (thing) {
      thing.data = { ...thing.data, ...updates } as typeof thing.data
      thing.updatedAt = Date.now()
      await this.storage.put(`graph:thing:${id}`, thing)
    }
  }

  async listThings(options: { type?: string; prefix?: string }): Promise<Array<WorkflowRunThing | WorkflowStepThing>> {
    const allThings = await this.storage.list<WorkflowRunThing | WorkflowStepThing>({
      prefix: 'graph:thing:',
    })

    const results: Array<WorkflowRunThing | WorkflowStepThing> = []
    for (const [, thing] of allThings) {
      if (options.type && thing.$type !== options.type) continue
      if (options.prefix && !thing.$id.startsWith(options.prefix)) continue
      results.push(thing)
    }
    return results
  }

  async createRelationship(
    rel: Omit<WorkflowRelationship, 'id' | 'createdAt'>
  ): Promise<WorkflowRelationship> {
    const id = `${rel.verb}:${rel.from}:${rel.to}:${Date.now()}`
    const relationship: WorkflowRelationship = {
      ...rel,
      id,
      createdAt: Date.now(),
    }
    await this.storage.put(`graph:rel:${id}`, relationship)
    // Also index by from and to for efficient lookups
    await this.storage.put(`graph:rel:from:${rel.from}:${id}`, relationship)
    await this.storage.put(`graph:rel:to:${rel.to}:${id}`, relationship)
    return relationship
  }

  async getRelationshipsFrom(fromId: string, verb?: string): Promise<WorkflowRelationship[]> {
    const allRels = await this.storage.list<WorkflowRelationship>({
      prefix: `graph:rel:from:${fromId}:`,
    })

    const results: WorkflowRelationship[] = []
    for (const [, rel] of allRels) {
      if (!verb || rel.verb === verb) {
        results.push(rel)
      }
    }
    return results
  }

  async getRelationshipsTo(toId: string, verb?: string): Promise<WorkflowRelationship[]> {
    const allRels = await this.storage.list<WorkflowRelationship>({
      prefix: `graph:rel:to:${toId}:`,
    })

    const results: WorkflowRelationship[] = []
    for (const [, rel] of allRels) {
      if (!verb || rel.verb === verb) {
        results.push(rel)
      }
    }
    return results
  }

  async deleteRelationship(id: string): Promise<void> {
    const rel = await this.storage.get<WorkflowRelationship>(`graph:rel:${id}`)
    if (rel) {
      await this.storage.delete(`graph:rel:${id}`)
      await this.storage.delete(`graph:rel:from:${rel.from}:${id}`)
      await this.storage.delete(`graph:rel:to:${rel.to}:${id}`)
    }
  }
}

// ============================================================================
// GRAPH RUNTIME STATE
// ============================================================================

/**
 * GraphRuntimeState manages workflow execution state as a graph of Things
 * and Relationships, enabling rich querying and history preservation.
 */
export class GraphRuntimeState {
  private storage: GraphRuntimeStorage
  private config: GraphRuntimeStateConfig
  private instanceId: string
  private workflowId: string

  constructor(storage: GraphRuntimeStorage, config: GraphRuntimeStateConfig) {
    this.storage = storage
    this.config = config
    this.instanceId = config.instanceId ?? crypto.randomUUID()
    this.workflowId = `workflow:${this.instanceId}`
  }

  // ==========================================================================
  // GETTERS
  // ==========================================================================

  get id(): string {
    return this.workflowId
  }

  get instance(): string {
    return this.instanceId
  }

  // ==========================================================================
  // WORKFLOW RUN OPERATIONS
  // ==========================================================================

  /**
   * Initialize the workflow run as a Thing
   */
  async initialize(input?: unknown): Promise<WorkflowRunThing> {
    const now = Date.now()
    const workflowRun: WorkflowRunThing = {
      $id: this.workflowId,
      $type: 'WorkflowRun',
      data: {
        name: this.config.name,
        version: this.config.version,
        description: this.config.description,
        status: 'pending',
        instanceId: this.instanceId,
        input,
        currentStepIndex: 0,
        pendingEvents: [],
      },
      createdAt: now,
      updatedAt: now,
    }

    await this.storage.createThing(workflowRun)
    return workflowRun
  }

  /**
   * Get the current workflow run Thing
   */
  async getWorkflowRun(): Promise<WorkflowRunThing | null> {
    return this.storage.getThing<WorkflowRunThing>(this.workflowId)
  }

  /**
   * Update workflow run status
   */
  async updateStatus(status: WorkflowRuntimeStatus, updates?: Partial<WorkflowRunThing['data']>): Promise<void> {
    await this.storage.updateThing(this.workflowId, {
      status,
      ...updates,
    })
  }

  /**
   * Mark workflow as started
   */
  async start(input: unknown): Promise<void> {
    await this.storage.updateThing(this.workflowId, {
      status: 'running',
      input,
      startedAt: new Date().toISOString(),
    })
  }

  /**
   * Mark workflow as completed
   */
  async complete(output: unknown): Promise<void> {
    await this.storage.updateThing(this.workflowId, {
      status: 'completed',
      output,
      completedAt: new Date().toISOString(),
    })
  }

  /**
   * Mark workflow as failed
   */
  async fail(error: Error): Promise<void> {
    await this.storage.updateThing(this.workflowId, {
      status: 'failed',
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      completedAt: new Date().toISOString(),
    })
  }

  /**
   * Mark workflow as paused
   */
  async pause(pendingEvents?: string[]): Promise<void> {
    const updates: Partial<WorkflowRunThing['data']> = {
      status: 'paused',
    }
    if (pendingEvents) {
      updates.pendingEvents = pendingEvents
    }
    await this.storage.updateThing(this.workflowId, updates)
  }

  /**
   * Resume workflow from paused state
   */
  async resume(): Promise<void> {
    await this.storage.updateThing(this.workflowId, {
      status: 'running',
      pendingEvents: [],
    })
  }

  /**
   * Update current step index
   */
  async setCurrentStepIndex(index: number): Promise<void> {
    await this.storage.updateThing(this.workflowId, {
      currentStepIndex: index,
    })
  }

  // ==========================================================================
  // STEP OPERATIONS
  // ==========================================================================

  /**
   * Create a step Thing and establish relationship to workflow
   */
  async createStep(
    stepIndex: number,
    stepName: string,
    isParallel = false
  ): Promise<WorkflowStepThing> {
    const stepId = `${this.workflowId}:step:${stepIndex}:${stepName}`
    const now = Date.now()

    const step: WorkflowStepThing = {
      $id: stepId,
      $type: 'WorkflowStep',
      data: {
        name: stepName,
        index: stepIndex,
        status: 'pending',
        isParallel,
      },
      createdAt: now,
      updatedAt: now,
    }

    await this.storage.createThing(step)

    // Create executes relationship: WorkflowRun -> Step
    await this.storage.createRelationship({
      verb: 'executes',
      from: this.workflowId,
      to: stepId,
      data: { order: stepIndex },
    })

    // Create follows relationship if not first step
    if (stepIndex > 0) {
      const previousSteps = await this.getSteps()
      const previousStep = previousSteps.find((s) => s.data.index === stepIndex - 1)
      if (previousStep) {
        await this.storage.createRelationship({
          verb: 'follows',
          from: previousStep.$id,
          to: stepId,
        })
      }
    }

    return step
  }

  /**
   * Get a step by index
   */
  async getStep(stepIndex: number): Promise<WorkflowStepThing | null> {
    const steps = await this.getSteps()
    return steps.find((s) => s.data.index === stepIndex) ?? null
  }

  /**
   * Get all steps for this workflow
   */
  async getSteps(): Promise<WorkflowStepThing[]> {
    const relationships = await this.storage.getRelationshipsFrom(this.workflowId, 'executes')
    const steps: WorkflowStepThing[] = []

    for (const rel of relationships) {
      const step = await this.storage.getThing<WorkflowStepThing>(rel.to)
      if (step) {
        steps.push(step)
      }
    }

    // Sort by index
    return steps.sort((a, b) => a.data.index - b.data.index)
  }

  /**
   * Update step status and data
   */
  async updateStep(
    stepIndex: number,
    updates: Partial<WorkflowStepThing['data']>
  ): Promise<void> {
    const step = await this.getStep(stepIndex)
    if (step) {
      await this.storage.updateThing(step.$id, updates)
    }
  }

  /**
   * Mark step as started
   */
  async stepStarted(stepIndex: number): Promise<void> {
    await this.updateStep(stepIndex, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })
  }

  /**
   * Mark step as completed
   */
  async stepCompleted(
    stepIndex: number,
    output: unknown,
    duration?: number
  ): Promise<void> {
    await this.updateStep(stepIndex, {
      status: 'completed',
      output,
      duration,
      completedAt: new Date().toISOString(),
    })
  }

  /**
   * Mark step as failed
   */
  async stepFailed(
    stepIndex: number,
    error: Error,
    retryCount?: number
  ): Promise<void> {
    await this.updateStep(stepIndex, {
      status: 'failed',
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      retryCount,
      completedAt: new Date().toISOString(),
    })
  }

  /**
   * Update parallel step results
   */
  async updateParallelResults(
    stepIndex: number,
    parallelResults: WorkflowStepThing['data']['parallelResults']
  ): Promise<void> {
    await this.updateStep(stepIndex, {
      parallelResults,
    })
  }

  // ==========================================================================
  // GRAPH QUERIES
  // ==========================================================================

  /**
   * Get the execution chain (sequence of steps) for this workflow
   */
  async getExecutionChain(): Promise<WorkflowStepThing[]> {
    return this.getSteps()
  }

  /**
   * Get steps that follow a given step
   */
  async getFollowingSteps(stepId: string): Promise<WorkflowStepThing[]> {
    const relationships = await this.storage.getRelationshipsFrom(stepId, 'follows')
    const steps: WorkflowStepThing[] = []

    for (const rel of relationships) {
      const step = await this.storage.getThing<WorkflowStepThing>(rel.to)
      if (step) {
        steps.push(step)
      }
    }

    return steps
  }

  /**
   * Get the step that precedes a given step
   */
  async getPrecedingStep(stepId: string): Promise<WorkflowStepThing | null> {
    const relationships = await this.storage.getRelationshipsTo(stepId, 'follows')
    if (relationships.length === 0) return null

    return this.storage.getThing<WorkflowStepThing>(relationships[0]!.from)
  }

  /**
   * Get completed steps count
   */
  async getCompletedStepsCount(): Promise<number> {
    const steps = await this.getSteps()
    return steps.filter((s) => s.data.status === 'completed').length
  }

  /**
   * Get failed steps count
   */
  async getFailedStepsCount(): Promise<number> {
    const steps = await this.getSteps()
    return steps.filter((s) => s.data.status === 'failed').length
  }

  // ==========================================================================
  // HISTORY PRESERVATION
  // ==========================================================================

  /**
   * Get full execution history including all steps and their relationships
   */
  async getExecutionHistory(): Promise<{
    workflow: WorkflowRunThing | null
    steps: WorkflowStepThing[]
    relationships: WorkflowRelationship[]
  }> {
    const workflow = await this.getWorkflowRun()
    const steps = await this.getSteps()
    const relationships = await this.storage.getRelationshipsFrom(this.workflowId)

    return {
      workflow,
      steps,
      relationships,
    }
  }

  /**
   * Export state for persistence across hibernation
   */
  async exportState(): Promise<{
    workflow: WorkflowRunThing | null
    steps: WorkflowStepThing[]
  }> {
    const workflow = await this.getWorkflowRun()
    const steps = await this.getSteps()
    return { workflow, steps }
  }

  /**
   * Import state from persistence (for recovery after hibernation)
   */
  async importState(state: {
    workflow: WorkflowRunThing
    steps: WorkflowStepThing[]
  }): Promise<void> {
    await this.storage.createThing(state.workflow)

    for (const step of state.steps) {
      await this.storage.createThing(step)

      // Recreate executes relationship
      await this.storage.createRelationship({
        verb: 'executes',
        from: this.workflowId,
        to: step.$id,
        data: { order: step.data.index },
      })
    }

    // Recreate follows relationships
    for (let i = 1; i < state.steps.length; i++) {
      await this.storage.createRelationship({
        verb: 'follows',
        from: state.steps[i - 1]!.$id,
        to: state.steps[i]!.$id,
      })
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a GraphRuntimeState with in-memory storage (for testing)
 */
export function createInMemoryGraphRuntimeState(
  config: GraphRuntimeStateConfig
): GraphRuntimeState {
  return new GraphRuntimeState(new InMemoryGraphStorage(), config)
}

/**
 * Create a GraphRuntimeState with DO storage
 */
export function createDOGraphRuntimeState(
  storage: DurableObjectStorage,
  config: GraphRuntimeStateConfig
): GraphRuntimeState {
  return new GraphRuntimeState(new DOGraphStorageAdapter(storage), config)
}
