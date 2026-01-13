/**
 * WorkflowInstance Thing Implementation
 *
 * WorkflowInstance as a Thing with verb form state encoding.
 *
 * The key insight: verb form IS the state, no separate status column needed.
 *
 * State Machine (via verb forms):
 * - 'start' (action) -> 'starting' (activity) -> 'started' (event)
 * - 'pause' (action) -> 'pausing' (activity) -> 'paused' (event)
 * - 'fail' (action) -> 'failing' (activity) -> 'failed' (event)
 * - 'resume' transitions paused -> starting
 *
 * Semantic States:
 * - pending: stateVerb = 'start' (action form, intent to start)
 * - running: stateVerb = 'starting' (activity form, in progress)
 * - completed: stateVerb = 'started' (event form, completed)
 * - paused: stateVerb = 'paused' (event form from pause verb)
 * - failed: stateVerb = 'failed' (event form from fail verb)
 *
 * @see dotdo-v9qdb - [GREEN] Implement WorkflowInstance Thing with verb form state
 */

import { type GraphThing, createThing, getThing, getThingsByType, updateThing } from '../../db/graph/things'
import { VerbFormStateMachine, getVerbFormType, type VerbFormType } from '../../db/graph/verb-forms'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Semantic workflow instance states
 */
export type InstanceState = 'pending' | 'running' | 'completed' | 'paused' | 'failed'

/**
 * WorkflowInstance data payload
 */
export interface WorkflowInstanceData {
  /** The workflow definition ID this instance belongs to */
  workflowId: string
  /** Input data provided when creating the instance */
  input: Record<string, unknown>
  /** State encoded as verb form */
  stateVerb: string
  /** Output data set when completing the instance */
  output?: Record<string, unknown>
  /** Error message if the instance failed */
  error?: string
}

/**
 * WorkflowInstance Thing - extends GraphThing with typed data
 */
export interface WorkflowInstanceThing extends Omit<GraphThing, 'data'> {
  data: WorkflowInstanceData | null
}

/**
 * Input for creating a new WorkflowInstance
 */
export interface CreateInstanceInput {
  /** Optional custom instance ID (auto-generated if not provided) */
  id?: string
  /** The workflow definition ID this instance belongs to */
  workflowId: string
  /** Input data for the workflow execution */
  input: Record<string, unknown>
}

/**
 * Query options for filtering instances
 */
export interface QueryInstanceOptions {
  /** Filter by workflow ID */
  workflowId?: string
  /** Maximum number of results */
  limit?: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for WorkflowInstance (using a fixed value for consistency) */
const WORKFLOW_INSTANCE_TYPE_ID = 100

/** Type name for WorkflowInstance */
const WORKFLOW_INSTANCE_TYPE_NAME = 'WorkflowInstance'

// ============================================================================
// STATE MACHINES
// ============================================================================

/**
 * State machine for the 'start' verb lifecycle
 * start (pending) -> starting (running) -> started (completed)
 */
const startMachine = VerbFormStateMachine.fromBaseVerb('start')

/**
 * State machine for the 'pause' verb lifecycle
 * pause -> pausing -> paused
 */
const pauseMachine = VerbFormStateMachine.fromBaseVerb('pause')

/**
 * State machine for the 'fail' verb lifecycle
 * fail -> failing -> failed
 */
const failMachine = VerbFormStateMachine.fromBaseVerb('fail')

// ============================================================================
// STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to semantic instance states
 */
function verbFormToState(stateVerb: string): InstanceState {
  // Handle start lifecycle
  if (stateVerb === 'start') return 'pending'
  if (stateVerb === 'starting') return 'running'
  if (stateVerb === 'started') return 'completed'

  // Handle pause lifecycle
  if (stateVerb === 'paused') return 'paused'

  // Handle fail lifecycle
  if (stateVerb === 'failed') return 'failed'

  // Default to pending for unknown states
  return 'pending'
}

/**
 * Maps semantic states to verb forms for querying
 */
function stateToVerbForms(state: InstanceState): string[] {
  switch (state) {
    case 'pending':
      return ['start']
    case 'running':
      return ['starting']
    case 'completed':
      return ['started']
    case 'paused':
      return ['paused']
    case 'failed':
      return ['failed']
  }
}

// ============================================================================
// INSTANCE STORE (per-db isolation)
// ============================================================================

/**
 * In-memory store for WorkflowInstances (per-db isolation for testing)
 */
const instanceStores = new WeakMap<object, Map<string, WorkflowInstanceThing>>()

/**
 * Get or create the instance store for a database
 */
function getInstanceStore(db: object): Map<string, WorkflowInstanceThing> {
  let store = instanceStores.get(db)
  if (!store) {
    store = new Map()
    instanceStores.set(db, store)
  }
  return store
}

// ============================================================================
// INSTANCE ID GENERATION
// ============================================================================

let instanceCounter = 0

/**
 * Generate a unique instance ID
 */
function generateInstanceId(): string {
  instanceCounter++
  return `instance-${Date.now().toString(36)}-${instanceCounter.toString(36)}`
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Create a new WorkflowInstance in pending state
 *
 * @param db - Database instance (or empty object for testing)
 * @param input - Instance creation data
 * @returns The created WorkflowInstanceThing
 */
export async function createInstance(
  db: object,
  input: CreateInstanceInput
): Promise<WorkflowInstanceThing> {
  const store = getInstanceStore(db)

  const id = input.id ?? generateInstanceId()
  const now = Date.now()

  const instanceData: WorkflowInstanceData = {
    workflowId: input.workflowId,
    input: input.input,
    stateVerb: 'start', // Action form = pending state
  }

  const instance: WorkflowInstanceThing = {
    id,
    typeId: WORKFLOW_INSTANCE_TYPE_ID,
    typeName: WORKFLOW_INSTANCE_TYPE_NAME,
    data: instanceData,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  store.set(id, instance)

  return instance
}

/**
 * Get a WorkflowInstance by ID
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @returns The instance or null if not found
 */
export async function getInstance(
  db: object,
  id: string
): Promise<WorkflowInstanceThing | null> {
  const store = getInstanceStore(db)
  return store.get(id) ?? null
}

/**
 * Get the semantic state of an instance
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @returns The semantic state or null if not found
 */
export async function getInstanceState(
  db: object,
  id: string
): Promise<InstanceState | null> {
  const instance = await getInstance(db, id)
  if (!instance?.data?.stateVerb) return null
  return verbFormToState(instance.data.stateVerb)
}

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

/**
 * Start a workflow instance (pending -> running)
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @returns The updated instance
 * @throws Error if instance not found or invalid transition
 */
export async function startInstance(
  db: object,
  id: string
): Promise<WorkflowInstanceThing> {
  const store = getInstanceStore(db)
  const instance = store.get(id)

  if (!instance) {
    throw new Error('Instance not found')
  }

  const currentVerb = instance.data?.stateVerb ?? ''

  // Can only start from pending state
  if (currentVerb !== 'start') {
    throw new Error(`Invalid transition: cannot start from ${verbFormToState(currentVerb)} state`)
  }

  // Transition: start -> starting
  const updated: WorkflowInstanceThing = {
    ...instance,
    data: {
      ...instance.data!,
      stateVerb: 'starting',
    },
    updatedAt: Date.now(),
  }

  store.set(id, updated)
  return updated
}

/**
 * Complete a workflow instance (running -> completed)
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @param output - Output data from the workflow execution
 * @returns The updated instance
 * @throws Error if instance not found or invalid transition
 */
export async function completeInstance(
  db: object,
  id: string,
  output: Record<string, unknown>
): Promise<WorkflowInstanceThing> {
  const store = getInstanceStore(db)
  const instance = store.get(id)

  if (!instance) {
    throw new Error('Instance not found')
  }

  const currentVerb = instance.data?.stateVerb ?? ''

  // Can only complete from running state
  if (currentVerb !== 'starting') {
    throw new Error(`Invalid transition: cannot complete from ${verbFormToState(currentVerb)} state`)
  }

  // Transition: starting -> started
  const updated: WorkflowInstanceThing = {
    ...instance,
    data: {
      ...instance.data!,
      stateVerb: 'started',
      output,
    },
    updatedAt: Date.now(),
  }

  store.set(id, updated)
  return updated
}

/**
 * Pause a workflow instance (running -> paused)
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @returns The updated instance
 * @throws Error if instance not found or invalid transition
 */
export async function pauseInstance(
  db: object,
  id: string
): Promise<WorkflowInstanceThing> {
  const store = getInstanceStore(db)
  const instance = store.get(id)

  if (!instance) {
    throw new Error('Instance not found')
  }

  const currentVerb = instance.data?.stateVerb ?? ''

  // Can only pause from running state
  if (currentVerb !== 'starting') {
    throw new Error(`Invalid transition: cannot pause from ${verbFormToState(currentVerb)} state`)
  }

  // Transition: starting -> paused (immediate, skip pausing activity form)
  const updated: WorkflowInstanceThing = {
    ...instance,
    data: {
      ...instance.data!,
      stateVerb: 'paused',
    },
    updatedAt: Date.now(),
  }

  store.set(id, updated)
  return updated
}

/**
 * Resume a paused workflow instance (paused -> running)
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @returns The updated instance
 * @throws Error if instance not found or invalid transition
 */
export async function resumeInstance(
  db: object,
  id: string
): Promise<WorkflowInstanceThing> {
  const store = getInstanceStore(db)
  const instance = store.get(id)

  if (!instance) {
    throw new Error('Instance not found')
  }

  const currentVerb = instance.data?.stateVerb ?? ''

  // Can only resume from paused state
  if (currentVerb !== 'paused') {
    throw new Error(`Invalid transition: cannot resume from ${verbFormToState(currentVerb)} state`)
  }

  // Transition: paused -> starting (back to running)
  const updated: WorkflowInstanceThing = {
    ...instance,
    data: {
      ...instance.data!,
      stateVerb: 'starting',
    },
    updatedAt: Date.now(),
  }

  store.set(id, updated)
  return updated
}

/**
 * Fail a workflow instance (running -> failed)
 *
 * @param db - Database instance
 * @param id - Instance ID
 * @param error - The error that caused the failure
 * @returns The updated instance
 * @throws Error if instance not found or invalid transition
 */
export async function failInstance(
  db: object,
  id: string,
  error: Error
): Promise<WorkflowInstanceThing> {
  const store = getInstanceStore(db)
  const instance = store.get(id)

  if (!instance) {
    throw new Error('Instance not found')
  }

  const currentVerb = instance.data?.stateVerb ?? ''

  // Can only fail from running state
  if (currentVerb !== 'starting') {
    throw new Error(`Invalid transition: cannot fail from ${verbFormToState(currentVerb)} state`)
  }

  // Transition: starting -> failed (immediate, skip failing activity form)
  const updated: WorkflowInstanceThing = {
    ...instance,
    data: {
      ...instance.data!,
      stateVerb: 'failed',
      error: error.message,
    },
    updatedAt: Date.now(),
  }

  store.set(id, updated)
  return updated
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Query workflow instances by semantic state
 *
 * @param db - Database instance
 * @param state - The semantic state to filter by
 * @param options - Additional query options
 * @returns Array of instances in the specified state
 */
export async function queryInstancesByState(
  db: object,
  state: InstanceState,
  options?: QueryInstanceOptions
): Promise<WorkflowInstanceThing[]> {
  const store = getInstanceStore(db)
  const verbForms = stateToVerbForms(state)

  let results = Array.from(store.values())

  // Filter by state verb forms
  results = results.filter((instance) => {
    const stateVerb = instance.data?.stateVerb
    return stateVerb && verbForms.includes(stateVerb)
  })

  // Filter by workflowId if provided
  if (options?.workflowId) {
    results = results.filter((instance) => instance.data?.workflowId === options.workflowId)
  }

  // Exclude deleted instances
  results = results.filter((instance) => instance.deletedAt === null)

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}
