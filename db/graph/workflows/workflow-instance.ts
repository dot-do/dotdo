/**
 * WorkflowInstance Store
 *
 * Manages WorkflowInstance Things in the graph model with verb form state encoding.
 *
 * Key insight: verb form IS the state, no separate status column needed.
 *
 * State Machine (via verb forms):
 * - 'start' (action) = pending
 * - 'starting' (activity) = running
 * - 'started' (event) = completed
 * - 'paused' (event) = paused
 * - 'failed' (event) = failed
 * - 'cancelled' (event) = cancelled
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 * @module db/graph/workflows/workflow-instance
 */

import type { GraphStore } from '../types'
import { VerbFormStateMachine, getVerbFormType } from '../verb-forms'
import {
  WORKFLOW_INSTANCE_TYPE_ID,
  WORKFLOW_INSTANCE_TYPE_NAME,
  WORKFLOW_VERBS,
  type WorkflowInstanceThing,
  type WorkflowInstanceData,
  type CreateWorkflowInstanceInput,
  type QueryWorkflowInstancesOptions,
  type InstanceState,
} from './types'

// ============================================================================
// ID GENERATION
// ============================================================================

let instanceCounter = 0

/**
 * Generate a unique instance ID
 */
function generateInstanceId(): string {
  instanceCounter++
  return `instance:${Date.now().toString(36)}-${instanceCounter.toString(36)}`
}

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
 */
const pauseMachine = VerbFormStateMachine.fromBaseVerb('pause')

/**
 * State machine for the 'fail' verb lifecycle
 */
const failMachine = VerbFormStateMachine.fromBaseVerb('fail')

/**
 * State machine for the 'cancel' verb lifecycle
 */
const cancelMachine = VerbFormStateMachine.fromBaseVerb('cancel')

// ============================================================================
// STATE MAPPING
// ============================================================================

/**
 * Maps verb forms to semantic instance states
 */
export function verbFormToInstanceState(stateVerb: string): InstanceState {
  // Handle start lifecycle
  if (stateVerb === 'start') return 'pending'
  if (stateVerb === 'starting') return 'running'
  if (stateVerb === 'started') return 'completed'

  // Handle pause lifecycle
  if (stateVerb === 'paused') return 'paused'

  // Handle fail lifecycle
  if (stateVerb === 'failed') return 'failed'

  // Handle cancel lifecycle
  if (stateVerb === 'cancelled') return 'cancelled'

  // Default to pending for unknown states
  return 'pending'
}

/**
 * Maps semantic states to verb forms for querying
 */
export function instanceStateToVerbForms(state: InstanceState): string[] {
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
    case 'cancelled':
      return ['cancelled']
  }
}

// ============================================================================
// INSTANCE CRUD OPERATIONS
// ============================================================================

/**
 * Create a new WorkflowInstance in pending state
 *
 * @param store - GraphStore instance
 * @param input - Instance creation data
 * @returns The created WorkflowInstanceThing
 */
export async function createWorkflowInstance(
  store: GraphStore,
  input: CreateWorkflowInstanceInput
): Promise<WorkflowInstanceThing> {
  const id = input.id ?? generateInstanceId()

  const instanceData: WorkflowInstanceData = {
    templateId: input.templateId,
    stateVerb: 'start', // Action form = pending state
    input: input.input,
    metadata: input.metadata,
  }

  const thing = await store.createThing({
    id,
    typeId: WORKFLOW_INSTANCE_TYPE_ID,
    typeName: WORKFLOW_INSTANCE_TYPE_NAME,
    data: instanceData as Record<string, unknown>,
  })

  // Create instanceOf relationship to template
  await store.createRelationship({
    id: `rel:instanceOf:${id}:${input.templateId}`,
    verb: WORKFLOW_VERBS.INSTANCE_OF,
    from: id,
    to: input.templateId,
  })

  return thing as unknown as WorkflowInstanceThing
}

/**
 * Get a WorkflowInstance by ID
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @returns The instance or null if not found
 */
export async function getWorkflowInstance(
  store: GraphStore,
  id: string
): Promise<WorkflowInstanceThing | null> {
  const thing = await store.getThing(id)

  if (!thing || thing.typeId !== WORKFLOW_INSTANCE_TYPE_ID) {
    return null
  }

  return thing as unknown as WorkflowInstanceThing
}

/**
 * Get the semantic state of an instance
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @returns The semantic state or null if not found
 */
export async function getWorkflowInstanceState(
  store: GraphStore,
  id: string
): Promise<InstanceState | null> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance?.data?.stateVerb) return null
  return verbFormToInstanceState(instance.data.stateVerb)
}

/**
 * Query workflow instances with filtering
 *
 * @param store - GraphStore instance
 * @param options - Query options
 * @returns Array of instances
 */
export async function queryWorkflowInstances(
  store: GraphStore,
  options: QueryWorkflowInstancesOptions = {}
): Promise<WorkflowInstanceThing[]> {
  const things = await store.getThingsByType({
    typeId: WORKFLOW_INSTANCE_TYPE_ID,
    typeName: WORKFLOW_INSTANCE_TYPE_NAME,
    limit: options.limit,
    offset: options.offset,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  })

  let results = things as unknown as WorkflowInstanceThing[]

  // Filter by template ID
  if (options.templateId) {
    results = results.filter((i) => i.data?.templateId === options.templateId)
  }

  // Filter by state
  if (options.state) {
    const verbForms = instanceStateToVerbForms(options.state)
    results = results.filter((i) =>
      verbForms.includes(i.data?.stateVerb ?? '')
    )
  }

  return results
}

/**
 * Query instances by semantic state
 *
 * @param store - GraphStore instance
 * @param state - The semantic state to filter by
 * @param options - Additional query options
 * @returns Array of instances in the specified state
 */
export async function queryInstancesByState(
  store: GraphStore,
  state: InstanceState,
  options?: Omit<QueryWorkflowInstancesOptions, 'state'>
): Promise<WorkflowInstanceThing[]> {
  return queryWorkflowInstances(store, { ...options, state })
}

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

/**
 * Helper to update instance state
 */
async function updateInstanceState(
  store: GraphStore,
  id: string,
  updates: Partial<WorkflowInstanceData>
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const mergedData: WorkflowInstanceData = {
    ...(instance.data || { templateId: '', stateVerb: 'start', input: {} }),
    ...updates,
  }

  const updated = await store.updateThing(id, {
    data: mergedData as Record<string, unknown>,
  })

  return updated as unknown as WorkflowInstanceThing
}

/**
 * Start a workflow instance (pending -> running)
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @returns The updated instance
 */
export async function startWorkflowInstance(
  store: GraphStore,
  id: string
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const currentVerb = instance.data?.stateVerb ?? ''
  if (currentVerb !== 'start') {
    throw new Error(
      `Invalid transition: cannot start from ${verbFormToInstanceState(currentVerb)} state`
    )
  }

  return updateInstanceState(store, id, {
    stateVerb: 'starting',
    startedAt: Date.now(),
  })
}

/**
 * Complete a workflow instance (running -> completed)
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @param output - Output data from the workflow
 * @returns The updated instance
 */
export async function completeWorkflowInstance(
  store: GraphStore,
  id: string,
  output: Record<string, unknown>
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const currentVerb = instance.data?.stateVerb ?? ''
  if (currentVerb !== 'starting') {
    throw new Error(
      `Invalid transition: cannot complete from ${verbFormToInstanceState(currentVerb)} state`
    )
  }

  return updateInstanceState(store, id, {
    stateVerb: 'started',
    output,
    endedAt: Date.now(),
  })
}

/**
 * Pause a workflow instance (running -> paused)
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @returns The updated instance
 */
export async function pauseWorkflowInstance(
  store: GraphStore,
  id: string
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const currentVerb = instance.data?.stateVerb ?? ''
  if (currentVerb !== 'starting') {
    throw new Error(
      `Invalid transition: cannot pause from ${verbFormToInstanceState(currentVerb)} state`
    )
  }

  return updateInstanceState(store, id, {
    stateVerb: 'paused',
  })
}

/**
 * Resume a paused workflow instance (paused -> running)
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @returns The updated instance
 */
export async function resumeWorkflowInstance(
  store: GraphStore,
  id: string
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const currentVerb = instance.data?.stateVerb ?? ''
  if (currentVerb !== 'paused') {
    throw new Error(
      `Invalid transition: cannot resume from ${verbFormToInstanceState(currentVerb)} state`
    )
  }

  return updateInstanceState(store, id, {
    stateVerb: 'starting',
  })
}

/**
 * Fail a workflow instance (running -> failed)
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @param error - The error that caused the failure
 * @returns The updated instance
 */
export async function failWorkflowInstance(
  store: GraphStore,
  id: string,
  error: Error
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const currentVerb = instance.data?.stateVerb ?? ''
  if (currentVerb !== 'starting') {
    throw new Error(
      `Invalid transition: cannot fail from ${verbFormToInstanceState(currentVerb)} state`
    )
  }

  return updateInstanceState(store, id, {
    stateVerb: 'failed',
    error: error.message,
    endedAt: Date.now(),
  })
}

/**
 * Cancel a workflow instance (any non-terminal state -> cancelled)
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @param reason - Optional cancellation reason
 * @returns The updated instance
 */
export async function cancelWorkflowInstance(
  store: GraphStore,
  id: string,
  reason?: string
): Promise<WorkflowInstanceThing> {
  const instance = await getWorkflowInstance(store, id)
  if (!instance) {
    throw new Error(`Instance not found: ${id}`)
  }

  const currentVerb = instance.data?.stateVerb ?? ''
  const currentState = verbFormToInstanceState(currentVerb)

  // Cannot cancel already completed, failed, or cancelled instances
  if (['completed', 'failed', 'cancelled'].includes(currentState)) {
    throw new Error(
      `Invalid transition: cannot cancel from ${currentState} state`
    )
  }

  return updateInstanceState(store, id, {
    stateVerb: 'cancelled',
    error: reason,
    endedAt: Date.now(),
  })
}

// ============================================================================
// STEP TRACKING
// ============================================================================

/**
 * Update the current step in an instance
 *
 * @param store - GraphStore instance
 * @param id - Instance ID
 * @param stepIndex - Current step index
 * @param stepName - Current step name
 * @returns The updated instance
 */
export async function updateInstanceCurrentStep(
  store: GraphStore,
  id: string,
  stepIndex: number,
  stepName: string
): Promise<WorkflowInstanceThing> {
  return updateInstanceState(store, id, {
    currentStepIndex: stepIndex,
    currentStepName: stepName,
  })
}

// ============================================================================
// RELATIONSHIP QUERIES
// ============================================================================

/**
 * Get the template ID for an instance
 *
 * @param store - GraphStore instance
 * @param instanceId - Instance ID
 * @returns The template ID or null
 */
export async function getInstanceTemplateId(
  store: GraphStore,
  instanceId: string
): Promise<string | null> {
  const rels = await store.queryRelationshipsFrom(instanceId, {
    verb: WORKFLOW_VERBS.INSTANCE_OF,
  })

  return rels[0]?.to ?? null
}

/**
 * Get all instances of a template
 *
 * @param store - GraphStore instance
 * @param templateId - Template ID
 * @returns Array of instances
 */
export async function getTemplateInstances(
  store: GraphStore,
  templateId: string
): Promise<WorkflowInstanceThing[]> {
  const rels = await store.queryRelationshipsTo(templateId, {
    verb: WORKFLOW_VERBS.INSTANCE_OF,
  })

  const instances: WorkflowInstanceThing[] = []
  for (const rel of rels) {
    const instance = await getWorkflowInstance(store, rel.from)
    if (instance) {
      instances.push(instance)
    }
  }

  return instances
}

/**
 * Record what triggered an instance
 *
 * @param store - GraphStore instance
 * @param instanceId - Instance ID
 * @param triggerId - Trigger source ID (schedule, event, human, etc.)
 * @param triggerData - Additional trigger data
 */
export async function recordInstanceTrigger(
  store: GraphStore,
  instanceId: string,
  triggerId: string,
  triggerData?: Record<string, unknown>
): Promise<void> {
  await store.createRelationship({
    id: `rel:triggeredBy:${instanceId}:${triggerId}`,
    verb: WORKFLOW_VERBS.TRIGGERED_BY,
    from: instanceId,
    to: triggerId,
    data: triggerData,
  })
}

/**
 * Get what triggered an instance
 *
 * @param store - GraphStore instance
 * @param instanceId - Instance ID
 * @returns The trigger relationship or null
 */
export async function getInstanceTrigger(
  store: GraphStore,
  instanceId: string
): Promise<{ triggerId: string; data: Record<string, unknown> | null } | null> {
  const rels = await store.queryRelationshipsFrom(instanceId, {
    verb: WORKFLOW_VERBS.TRIGGERED_BY,
  })

  if (rels.length === 0) {
    return null
  }

  return {
    triggerId: rels[0]!.to,
    data: rels[0]!.data,
  }
}
