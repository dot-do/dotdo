/**
 * Schedule Thing CRUD Operations
 *
 * Stores Schedule definitions as Things in the DO Graph model.
 * Schedules are stored as graph nodes with type 'Schedule' and their
 * configuration stored in the data field.
 *
 * State via Verb Forms:
 * - 'activate' (action) -> 'activating' (activity) -> 'active' (state)
 * - 'pause' (action) -> 'pausing' (activity) -> 'paused' (state)
 *
 * When a schedule triggers, we create a 'triggered' relationship from
 * the Schedule to the triggered entity (WorkflowInstance).
 *
 * @see dotdo-2n693 - [REFACTOR] Migrate ScheduleManager to use graph Things
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
 * Type ID for Schedule Things in the graph.
 * This corresponds to the 'Schedule' noun in the type system.
 */
export const SCHEDULE_TYPE_ID = 101

/**
 * Type name for Schedule Things.
 */
export const SCHEDULE_TYPE_NAME = 'Schedule'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Status of a schedule - encoded as verb forms
 */
export type ScheduleStatus = 'active' | 'paused'

/**
 * The data payload stored in the ScheduleThing's data field.
 */
export interface ScheduleThingData {
  /** Unique name for the schedule */
  name: string
  /** Cron expression for the schedule */
  cronExpression: string
  /** Status as verb form: 'active' or 'paused' */
  status: ScheduleStatus
  /** Next scheduled run time (ISO string) */
  nextRunAt: string | null
  /** Last run time (ISO string) */
  lastRunAt: string | null
  /** Number of times this schedule has triggered */
  runCount: number
  /** IANA timezone for the schedule */
  timezone?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * A ScheduleThing is a GraphThing with Schedule type.
 */
export type ScheduleThing = GraphThing & {
  typeId: typeof SCHEDULE_TYPE_ID
  typeName: typeof SCHEDULE_TYPE_NAME
  data: ScheduleThingData | null
}

/**
 * Input for creating a new Schedule.
 */
export interface CreateScheduleInput {
  /** Unique identifier for the schedule (auto-generated if not provided) */
  id?: string
  /** Unique name for the schedule */
  name: string
  /** Cron expression */
  cronExpression: string
  /** Initial status (defaults to 'active') */
  status?: ScheduleStatus
  /** Next run time */
  nextRunAt?: Date | null
  /** IANA timezone */
  timezone?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for updating an existing Schedule.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateScheduleInput {
  /** Update cron expression */
  cronExpression?: string
  /** Update status */
  status?: ScheduleStatus
  /** Update next run time */
  nextRunAt?: Date | null
  /** Update last run time */
  lastRunAt?: Date | null
  /** Update run count */
  runCount?: number
  /** Update timezone */
  timezone?: string
  /** Update metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for listing Schedules.
 */
export interface ListSchedulesOptions {
  /** Filter by status */
  status?: ScheduleStatus
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
  /** Include soft-deleted schedules */
  includeDeleted?: boolean
}

// ============================================================================
// IN-MEMORY STORE (for testing)
// ============================================================================

/**
 * Per-instance stores for schedule things.
 */
const scheduleStores = new WeakMap<object, Map<string, ScheduleThing>>()

/**
 * Get or create the schedule store for a database.
 */
function getScheduleStore(db: object): Map<string, ScheduleThing> {
  let store = scheduleStores.get(db)
  if (!store) {
    store = new Map()
    scheduleStores.set(db, store)
  }
  return store
}

// ============================================================================
// SCHEDULE ID GENERATION
// ============================================================================

let scheduleCounter = 0

/**
 * Generate a unique schedule ID.
 */
function generateScheduleId(): string {
  scheduleCounter++
  return `schedule-${Date.now().toString(36)}-${scheduleCounter.toString(36)}`
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Create a new Schedule Thing.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param input - Schedule data to create
 * @returns The created ScheduleThing
 * @throws Error if a Schedule with the same name already exists
 */
export async function createSchedule(
  db: object,
  input: CreateScheduleInput
): Promise<ScheduleThing> {
  const store = getScheduleStore(db)
  const id = input.id ?? generateScheduleId()

  // Check for duplicate name
  for (const existing of Array.from(store.values())) {
    if (existing.data?.name === input.name && existing.deletedAt === null) {
      throw new Error(`Schedule with name "${input.name}" already exists`)
    }
  }

  const now = Date.now()
  const status = input.status ?? 'active'

  const scheduleData: ScheduleThingData = {
    name: input.name,
    cronExpression: input.cronExpression,
    status,
    nextRunAt: input.nextRunAt ? input.nextRunAt.toISOString() : null,
    lastRunAt: null,
    runCount: 0,
    timezone: input.timezone,
    metadata: input.metadata,
  }

  const schedule: ScheduleThing = {
    id,
    typeId: SCHEDULE_TYPE_ID,
    typeName: SCHEDULE_TYPE_NAME,
    data: scheduleData as ScheduleThingData,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  store.set(id, schedule)

  return schedule
}

/**
 * Get a Schedule by ID.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Schedule ID to retrieve
 * @returns The ScheduleThing or null if not found
 */
export async function getSchedule(
  db: object,
  id: string
): Promise<ScheduleThing | null> {
  const store = getScheduleStore(db)
  const schedule = store.get(id)

  if (!schedule) {
    return null
  }

  // Skip deleted schedules
  if (schedule.deletedAt !== null) {
    return null
  }

  return schedule
}

/**
 * Get a Schedule by name.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param name - The Schedule name to retrieve
 * @returns The ScheduleThing or null if not found
 */
export async function getScheduleByName(
  db: object,
  name: string
): Promise<ScheduleThing | null> {
  const store = getScheduleStore(db)

  for (const schedule of Array.from(store.values())) {
    if (schedule.data?.name === name && schedule.deletedAt === null) {
      return schedule
    }
  }

  return null
}

/**
 * List all Schedules with optional filtering.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param options - Query options (status, limit, offset, includeDeleted)
 * @returns Array of ScheduleThings
 */
export async function listSchedules(
  db: object,
  options: ListSchedulesOptions = {}
): Promise<ScheduleThing[]> {
  const store = getScheduleStore(db)
  let results = Array.from(store.values())

  // Filter by status if provided
  if (options.status !== undefined) {
    results = results.filter((s) => s.data?.status === options.status)
  }

  // Exclude deleted by default
  if (!options.includeDeleted) {
    results = results.filter((s) => s.deletedAt === null)
  }

  // Sort by createdAt descending
  results.sort((a, b) => b.createdAt - a.createdAt)

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
 * Update a Schedule's data.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Schedule ID to update
 * @param updates - The fields to update
 * @returns The updated ScheduleThing or null if not found
 */
export async function updateSchedule(
  db: object,
  id: string,
  updates: UpdateScheduleInput
): Promise<ScheduleThing | null> {
  const store = getScheduleStore(db)
  const existing = store.get(id)

  if (!existing || existing.deletedAt !== null) {
    return null
  }

  const existingData = existing.data ?? {} as ScheduleThingData
  const mergedData: ScheduleThingData = {
    ...existingData,
  }

  // Apply updates
  if (updates.cronExpression !== undefined) {
    mergedData.cronExpression = updates.cronExpression
  }
  if (updates.status !== undefined) {
    mergedData.status = updates.status
  }
  if (updates.nextRunAt !== undefined) {
    mergedData.nextRunAt = updates.nextRunAt ? updates.nextRunAt.toISOString() : null
  }
  if (updates.lastRunAt !== undefined) {
    mergedData.lastRunAt = updates.lastRunAt ? updates.lastRunAt.toISOString() : null
  }
  if (updates.runCount !== undefined) {
    mergedData.runCount = updates.runCount
  }
  if (updates.timezone !== undefined) {
    mergedData.timezone = updates.timezone
  }
  if (updates.metadata !== undefined) {
    mergedData.metadata = updates.metadata
  }

  const updated: ScheduleThing = {
    ...existing,
    data: mergedData,
    updatedAt: Date.now(),
  }

  store.set(id, updated)

  return updated
}

/**
 * Soft delete a Schedule.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Schedule ID to delete
 * @returns The deleted ScheduleThing or null if not found
 */
export async function deleteSchedule(
  db: object,
  id: string
): Promise<ScheduleThing | null> {
  const store = getScheduleStore(db)
  const existing = store.get(id)

  if (!existing || existing.deletedAt !== null) {
    return null
  }

  const deleted: ScheduleThing = {
    ...existing,
    deletedAt: Date.now(),
  }

  store.set(id, deleted)

  return deleted
}

/**
 * Delete a Schedule by name.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param name - The Schedule name to delete
 * @returns The deleted ScheduleThing or null if not found
 */
export async function deleteScheduleByName(
  db: object,
  name: string
): Promise<ScheduleThing | null> {
  const schedule = await getScheduleByName(db, name)

  if (!schedule) {
    return null
  }

  return deleteSchedule(db, schedule.id)
}

// ============================================================================
// TRIGGER EVENT TRACKING
// ============================================================================

/**
 * Trigger event data stored in relationships.
 */
export interface TriggerEventData {
  /** When the trigger occurred */
  triggeredAt: string
  /** The schedule ID that triggered */
  scheduleId: string
  /** The schedule name */
  scheduleName: string
}

/**
 * In-memory store for trigger relationships (for testing).
 */
const triggerRelationships = new WeakMap<object, Array<{
  id: string
  verb: string
  from: string
  to: string
  data: TriggerEventData
  createdAt: number
}>>()

/**
 * Get the trigger relationships store for a database.
 */
function getTriggerStore(db: object): Array<{
  id: string
  verb: string
  from: string
  to: string
  data: TriggerEventData
  createdAt: number
}> {
  let store = triggerRelationships.get(db)
  if (!store) {
    store = []
    triggerRelationships.set(db, store)
  }
  return store
}

let triggerCounter = 0

/**
 * Record a trigger event as a relationship.
 *
 * Creates a 'triggered' relationship from the Schedule to the target entity.
 *
 * @param db - Database instance
 * @param scheduleId - The schedule that triggered
 * @param targetUrl - URL of the entity that was triggered (e.g., workflow instance)
 * @returns The created trigger relationship
 */
export async function recordTriggerEvent(
  db: object,
  scheduleId: string,
  targetUrl: string
): Promise<{
  id: string
  verb: string
  from: string
  to: string
  data: TriggerEventData
  createdAt: number
}> {
  const schedule = await getSchedule(db, scheduleId)
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`)
  }

  triggerCounter++
  const now = Date.now()

  const relationship = {
    id: `trigger-${now.toString(36)}-${triggerCounter.toString(36)}`,
    verb: 'triggered',
    from: `do://schedules/${scheduleId}`,
    to: targetUrl,
    data: {
      triggeredAt: new Date(now).toISOString(),
      scheduleId,
      scheduleName: schedule.data?.name ?? '',
    },
    createdAt: now,
  }

  const store = getTriggerStore(db)
  store.push(relationship)

  return relationship
}

/**
 * Query trigger events for a schedule.
 *
 * @param db - Database instance
 * @param scheduleId - The schedule ID to query
 * @param limit - Maximum number of results
 * @returns Array of trigger relationships
 */
export async function queryTriggerEvents(
  db: object,
  scheduleId: string,
  limit?: number
): Promise<Array<{
  id: string
  verb: string
  from: string
  to: string
  data: TriggerEventData
  createdAt: number
}>> {
  const store = getTriggerStore(db)
  let results = store.filter(
    (r) => r.verb === 'triggered' && r.from === `do://schedules/${scheduleId}`
  )

  // Sort by createdAt descending
  results.sort((a, b) => b.createdAt - a.createdAt)

  if (limit !== undefined) {
    results = results.slice(0, limit)
  }

  return results
}
