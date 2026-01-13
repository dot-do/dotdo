/**
 * Workflow Thing CRUD Operations
 *
 * Stores Workflow definitions as Things in the DO Graph model.
 * Workflows are stored as graph nodes with type 'Workflow' and their
 * configuration stored in the data field.
 *
 * @see dotdo-vtpze - [GREEN] Implement Workflow Thing CRUD operations
 */

import {
  createThing,
  getThing,
  getThingsByType,
  updateThing,
  deleteThing,
  type GraphThing,
} from '../../db/graph/things'

// ============================================================================
// TYPE CONSTANTS
// ============================================================================

/**
 * Type ID for Workflow Things in the graph.
 * This corresponds to the 'Workflow' noun in the type system.
 */
export const WORKFLOW_TYPE_ID = 100

/**
 * Type name for Workflow Things.
 */
export const WORKFLOW_TYPE_NAME = 'Workflow'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Step definition stored in workflow data.
 */
export interface WorkflowStepData {
  name: string
  type: 'do' | 'sleep' | 'waitForEvent'
  timeout?: number
  retries?: number
  retryDelay?: number
  duration?: number
  event?: string
}

/**
 * Trigger definition stored in workflow data.
 */
export interface WorkflowTriggerData {
  type: 'webhook' | 'cron' | 'event'
  config: Record<string, unknown>
}

/**
 * The data payload stored in the WorkflowThing's data field.
 * Matches the structure from WorkflowFactory.ts
 */
export interface WorkflowThingData {
  /** Workflow name (required) */
  name: string
  /** Human-readable description */
  description?: string
  /** Version string */
  version?: string
  /** Tags for categorization */
  tags?: string[]
  /** Step definitions */
  steps?: WorkflowStepData[]
  /** Trigger definitions */
  triggers?: WorkflowTriggerData[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * A WorkflowThing is a GraphThing with Workflow type.
 */
export type WorkflowThing = GraphThing & {
  typeId: typeof WORKFLOW_TYPE_ID
  typeName: typeof WORKFLOW_TYPE_NAME
  data: WorkflowThingData | null
}

/**
 * Input for creating a new Workflow.
 */
export interface CreateWorkflowInput extends WorkflowThingData {
  /** Unique identifier for the workflow */
  id: string
}

/**
 * Input for updating an existing Workflow.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateWorkflowInput {
  name?: string
  description?: string
  version?: string
  tags?: string[]
  steps?: WorkflowStepData[]
  triggers?: WorkflowTriggerData[]
  metadata?: Record<string, unknown>
}

/**
 * Options for listing Workflows.
 */
export interface ListWorkflowsOptions {
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
  /** Include soft-deleted workflows */
  includeDeleted?: boolean
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Create a new Workflow Thing.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param input - Workflow data to create
 * @returns The created WorkflowThing
 * @throws Error if a Workflow with the same ID already exists
 */
export async function createWorkflow(
  db: object,
  input: CreateWorkflowInput
): Promise<WorkflowThing> {
  const { id, ...workflowData } = input

  const thing = await createThing(db, {
    id,
    typeId: WORKFLOW_TYPE_ID,
    typeName: WORKFLOW_TYPE_NAME,
    data: workflowData as Record<string, unknown>,
  })

  return thing as WorkflowThing
}

/**
 * Get a Workflow by ID.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Workflow ID to retrieve
 * @returns The WorkflowThing or null if not found
 */
export async function getWorkflow(
  db: object,
  id: string
): Promise<WorkflowThing | null> {
  const thing = await getThing(db, id)

  if (!thing) {
    return null
  }

  // Verify this is actually a Workflow
  if (thing.typeId !== WORKFLOW_TYPE_ID) {
    return null
  }

  return thing as WorkflowThing
}

/**
 * List all Workflows with optional filtering.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param options - Query options (limit, offset, includeDeleted)
 * @returns Array of WorkflowThings
 */
export async function listWorkflows(
  db: object,
  options: ListWorkflowsOptions = {}
): Promise<WorkflowThing[]> {
  const things = await getThingsByType(db, {
    typeId: WORKFLOW_TYPE_ID,
    typeName: WORKFLOW_TYPE_NAME,
    limit: options.limit,
    offset: options.offset,
    includeDeleted: options.includeDeleted,
    orderDirection: 'desc',
    orderBy: 'createdAt',
  })

  return things as WorkflowThing[]
}

/**
 * Update a Workflow's data.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Workflow ID to update
 * @param updates - The fields to update
 * @returns The updated WorkflowThing or null if not found
 */
export async function updateWorkflow(
  db: object,
  id: string,
  updates: UpdateWorkflowInput
): Promise<WorkflowThing | null> {
  // First get the existing workflow
  const existing = await getWorkflow(db, id)

  if (!existing) {
    return null
  }

  // Merge existing data with updates
  const existingData = (existing.data || {}) as WorkflowThingData
  const mergedData: WorkflowThingData = {
    ...existingData,
    ...updates,
  }

  // Update the thing
  const updated = await updateThing(db, id, {
    data: mergedData as Record<string, unknown>,
  })

  if (!updated) {
    return null
  }

  return updated as WorkflowThing
}

/**
 * Soft delete a Workflow.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Workflow ID to delete
 * @returns The deleted WorkflowThing or null if not found
 */
export async function deleteWorkflow(
  db: object,
  id: string
): Promise<WorkflowThing | null> {
  // First verify this is a workflow
  const existing = await getWorkflow(db, id)

  if (!existing) {
    return null
  }

  const deleted = await deleteThing(db, id)

  if (!deleted) {
    return null
  }

  return deleted as WorkflowThing
}
