/**
 * Schedule Triggers as Graph Relationships
 *
 * Implements schedule triggers as verb-form graph relationships linking
 * schedules to workflows.
 *
 * Graph Model:
 * - Schedule Thing (source) --triggers--> Workflow Thing (target)
 * - Uses verb form state encoding: trigger -> triggering -> triggered
 *
 * State Machine (via verb forms):
 * - 'trigger' (action) = scheduled, waiting for cron time
 * - 'triggering' (activity) = actively firing
 * - 'triggered' (event) = completed trigger execution
 *
 * This allows:
 * - Store schedule->workflow relationships
 * - Query schedules by workflow (reverse traversal)
 * - Track trigger history in graph
 * - Integration with ScheduleManager
 *
 * @see dotdo-rljoj - [GREEN] Implement schedule triggers as graph relationships
 */

import { VerbFormStateMachine, getVerbFormType, type VerbFormType } from '../../db/graph/verb-forms'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Semantic trigger states derived from verb forms
 */
export type TriggerState = 'scheduled' | 'firing' | 'completed'

/**
 * Trigger relationship data payload
 */
export interface TriggerData {
  /** Cron expression for the schedule */
  cronExpression: string
  /** Timezone for schedule evaluation */
  timezone?: string
  /** When this trigger was scheduled to fire */
  scheduledAt?: Date
  /** When this trigger actually fired */
  firedAt?: Date
  /** Duration of the trigger execution in ms */
  executionDurationMs?: number
  /** Whether this was a catchup run for a missed schedule */
  isCatchup?: boolean
  /** Error message if trigger failed */
  error?: string
  /** Trigger metadata */
  metadata?: Record<string, unknown>
}

/**
 * Schedule-Workflow trigger relationship
 * Represents the graph edge: Schedule --triggers--> Workflow
 */
export interface TriggerRelationship {
  id: string
  /** Verb form encoding state: trigger | triggering | triggered */
  verb: string
  /** Source URL: the schedule thing */
  from: string
  /** Target URL: the workflow thing (null when triggering) */
  to: string | null
  /** Trigger-specific data */
  data: TriggerData | null
  /** When the relationship was created */
  createdAt: Date
  /** When the relationship was last updated */
  updatedAt: Date
}

/**
 * Schedule Thing representing a cron schedule
 */
export interface ScheduleThing {
  id: string
  /** URL of this schedule thing */
  url: string
  /** Unique name for the schedule */
  name: string
  /** Cron expression (e.g., '0 9 * * *') */
  cronExpression: string
  /** Timezone for evaluation */
  timezone?: string
  /** Whether the schedule is active */
  isActive: boolean
  /** Metadata for the schedule */
  metadata?: Record<string, unknown>
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
}

/**
 * Input for creating a schedule trigger
 */
export interface CreateTriggerInput {
  /** Optional trigger ID (auto-generated if not provided) */
  id?: string
  /** Schedule URL or ID */
  scheduleUrl: string
  /** Workflow URL or ID */
  workflowUrl: string
  /** Cron expression */
  cronExpression: string
  /** Timezone */
  timezone?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a schedule thing
 */
export interface CreateScheduleInput {
  /** Optional ID */
  id?: string
  /** Unique name */
  name: string
  /** Cron expression */
  cronExpression: string
  /** Timezone */
  timezone?: string
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Query options for trigger relationships
 */
export interface QueryTriggerOptions {
  /** Filter by state */
  state?: TriggerState
  /** Filter by schedule URL */
  scheduleUrl?: string
  /** Filter by workflow URL */
  workflowUrl?: string
  /** Filter by cron expression */
  cronExpression?: string
  /** Filter by timezone */
  timezone?: string
  /** Limit results */
  limit?: number
  /** Include completed triggers */
  includeCompleted?: boolean
}

/**
 * Result of querying schedules by workflow
 */
export interface ScheduleByWorkflow {
  schedule: ScheduleThing
  trigger: TriggerRelationship
  state: TriggerState
}

/**
 * Trigger history entry
 */
export interface TriggerHistoryEntry {
  triggerId: string
  scheduleUrl: string
  workflowUrl: string
  scheduledAt: Date
  firedAt: Date
  completedAt?: Date
  executionDurationMs?: number
  state: TriggerState
  isCatchup: boolean
  error?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Schedule things */
const SCHEDULE_TYPE_ID = 200

/** Type name for Schedule things */
const SCHEDULE_TYPE_NAME = 'Schedule'

/** Base URL for schedule things */
const SCHEDULE_BASE_URL = 'https://schedules.do'

/** Base URL for workflow things */
const WORKFLOW_BASE_URL = 'https://workflows.do'

// ============================================================================
// STATE MACHINE
// ============================================================================

/**
 * State machine for trigger verb lifecycle
 * trigger (scheduled) -> triggering (firing) -> triggered (completed)
 */
const triggerMachine = VerbFormStateMachine.fromBaseVerb('trigger')

/**
 * Maps verb forms to semantic trigger states
 */
function verbFormToState(verb: string): TriggerState {
  if (verb === 'trigger') return 'scheduled'
  if (verb === 'triggering') return 'firing'
  if (verb === 'triggered') return 'completed'
  return 'scheduled'
}

/**
 * Maps semantic states to verb forms
 */
function stateToVerbForm(state: TriggerState): string {
  switch (state) {
    case 'scheduled':
      return 'trigger'
    case 'firing':
      return 'triggering'
    case 'completed':
      return 'triggered'
  }
}

/**
 * Get verb forms for querying by state
 */
function stateToVerbForms(state: TriggerState): string[] {
  return [stateToVerbForm(state)]
}

// ============================================================================
// STORES (per-db isolation)
// ============================================================================

/**
 * In-memory store for Schedule things (per-db isolation for testing)
 */
const scheduleStores = new WeakMap<object, Map<string, ScheduleThing>>()

/**
 * In-memory store for Trigger relationships (per-db isolation for testing)
 */
const triggerStores = new WeakMap<object, Map<string, TriggerRelationship>>()

/**
 * Get or create the schedule store for a database
 */
function getScheduleStore(db: object): Map<string, ScheduleThing> {
  let store = scheduleStores.get(db)
  if (!store) {
    store = new Map()
    scheduleStores.set(db, store)
  }
  return store
}

/**
 * Get or create the trigger store for a database
 */
function getTriggerStore(db: object): Map<string, TriggerRelationship> {
  let store = triggerStores.get(db)
  if (!store) {
    store = new Map()
    triggerStores.set(db, store)
  }
  return store
}

// ============================================================================
// ID GENERATION
// ============================================================================

let scheduleCounter = 0
let triggerCounter = 0

/**
 * Generate a unique schedule ID
 */
function generateScheduleId(): string {
  scheduleCounter++
  return `schedule-${Date.now().toString(36)}-${scheduleCounter.toString(36)}`
}

/**
 * Generate a unique trigger ID
 */
function generateTriggerId(): string {
  triggerCounter++
  return `trigger-${Date.now().toString(36)}-${triggerCounter.toString(36)}`
}

/**
 * Build a schedule URL from an ID
 */
function buildScheduleUrl(id: string): string {
  return `${SCHEDULE_BASE_URL}/${id}`
}

/**
 * Build a workflow URL from an ID
 */
function buildWorkflowUrl(id: string): string {
  return `${WORKFLOW_BASE_URL}/${id}`
}

// ============================================================================
// SCHEDULE THING CRUD
// ============================================================================

/**
 * Create a new Schedule thing
 *
 * @param db - Database instance
 * @param input - Schedule creation data
 * @returns The created ScheduleThing
 */
export async function createSchedule(
  db: object,
  input: CreateScheduleInput
): Promise<ScheduleThing> {
  const store = getScheduleStore(db)

  const id = input.id ?? generateScheduleId()
  const now = new Date()

  const schedule: ScheduleThing = {
    id,
    url: buildScheduleUrl(id),
    name: input.name,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    isActive: true,
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }

  store.set(id, schedule)
  return schedule
}

/**
 * Get a Schedule by ID
 *
 * @param db - Database instance
 * @param id - Schedule ID
 * @returns The schedule or null if not found
 */
export async function getSchedule(
  db: object,
  id: string
): Promise<ScheduleThing | null> {
  const store = getScheduleStore(db)
  return store.get(id) ?? null
}

/**
 * Get a Schedule by URL
 *
 * @param db - Database instance
 * @param url - Schedule URL
 * @returns The schedule or null if not found
 */
export async function getScheduleByUrl(
  db: object,
  url: string
): Promise<ScheduleThing | null> {
  const store = getScheduleStore(db)
  for (const schedule of store.values()) {
    if (schedule.url === url) {
      return schedule
    }
  }
  return null
}

/**
 * List all schedules
 *
 * @param db - Database instance
 * @param options - Query options
 * @returns Array of schedules
 */
export async function listSchedules(
  db: object,
  options?: { activeOnly?: boolean; limit?: number }
): Promise<ScheduleThing[]> {
  const store = getScheduleStore(db)
  let results = Array.from(store.values())

  if (options?.activeOnly) {
    results = results.filter((s) => s.isActive)
  }

  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Update a Schedule
 *
 * @param db - Database instance
 * @param id - Schedule ID
 * @param updates - Fields to update
 * @returns The updated schedule
 */
export async function updateSchedule(
  db: object,
  id: string,
  updates: Partial<Pick<ScheduleThing, 'name' | 'cronExpression' | 'timezone' | 'isActive' | 'metadata'>>
): Promise<ScheduleThing> {
  const store = getScheduleStore(db)
  const schedule = store.get(id)

  if (!schedule) {
    throw new Error(`Schedule not found: ${id}`)
  }

  const updated: ScheduleThing = {
    ...schedule,
    ...updates,
    updatedAt: new Date(),
  }

  store.set(id, updated)
  return updated
}

/**
 * Delete a Schedule
 *
 * @param db - Database instance
 * @param id - Schedule ID
 */
export async function deleteSchedule(
  db: object,
  id: string
): Promise<void> {
  const store = getScheduleStore(db)
  store.delete(id)
}

// ============================================================================
// TRIGGER RELATIONSHIP CRUD
// ============================================================================

/**
 * Create a schedule->workflow trigger relationship
 *
 * Creates a graph edge from Schedule to Workflow with verb 'trigger' (scheduled state)
 *
 * @param db - Database instance
 * @param input - Trigger creation data
 * @returns The created TriggerRelationship
 */
export async function createTrigger(
  db: object,
  input: CreateTriggerInput
): Promise<TriggerRelationship> {
  const store = getTriggerStore(db)

  const id = input.id ?? generateTriggerId()
  const now = new Date()

  const triggerData: TriggerData = {
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    metadata: input.metadata,
    scheduledAt: now,
  }

  const trigger: TriggerRelationship = {
    id,
    verb: 'trigger', // Action form = scheduled state
    from: input.scheduleUrl,
    to: input.workflowUrl, // Target workflow
    data: triggerData,
    createdAt: now,
    updatedAt: now,
  }

  store.set(id, trigger)
  return trigger
}

/**
 * Get a trigger relationship by ID
 *
 * @param db - Database instance
 * @param id - Trigger ID
 * @returns The trigger or null if not found
 */
export async function getTrigger(
  db: object,
  id: string
): Promise<TriggerRelationship | null> {
  const store = getTriggerStore(db)
  return store.get(id) ?? null
}

/**
 * Get the semantic state of a trigger
 *
 * @param db - Database instance
 * @param id - Trigger ID
 * @returns The trigger state or null if not found
 */
export async function getTriggerState(
  db: object,
  id: string
): Promise<TriggerState | null> {
  const trigger = await getTrigger(db, id)
  if (!trigger) return null
  return verbFormToState(trigger.verb)
}

// ============================================================================
// TRIGGER STATE TRANSITIONS
// ============================================================================

/**
 * Start firing a trigger (scheduled -> firing)
 *
 * Transitions the trigger to activity form, setting to=null
 *
 * @param db - Database instance
 * @param id - Trigger ID
 * @returns The updated trigger
 */
export async function startTrigger(
  db: object,
  id: string
): Promise<TriggerRelationship> {
  const store = getTriggerStore(db)
  const trigger = store.get(id)

  if (!trigger) {
    throw new Error(`Trigger not found: ${id}`)
  }

  if (trigger.verb !== 'trigger') {
    throw new Error(`Invalid transition: cannot start from ${verbFormToState(trigger.verb)} state`)
  }

  const now = new Date()
  const updated: TriggerRelationship = {
    ...trigger,
    verb: 'triggering', // Activity form = firing state
    to: null, // In-progress, target not yet resolved
    data: {
      ...trigger.data!,
      firedAt: now,
    },
    updatedAt: now,
  }

  store.set(id, updated)
  return updated
}

/**
 * Complete a trigger (firing -> completed)
 *
 * Transitions to event form with the workflow instance URL as result
 *
 * @param db - Database instance
 * @param id - Trigger ID
 * @param workflowInstanceUrl - URL of the created workflow instance
 * @param executionDurationMs - How long the trigger took to execute
 * @returns The updated trigger
 */
export async function completeTrigger(
  db: object,
  id: string,
  workflowInstanceUrl: string,
  executionDurationMs?: number
): Promise<TriggerRelationship> {
  const store = getTriggerStore(db)
  const trigger = store.get(id)

  if (!trigger) {
    throw new Error(`Trigger not found: ${id}`)
  }

  if (trigger.verb !== 'triggering') {
    throw new Error(`Invalid transition: cannot complete from ${verbFormToState(trigger.verb)} state`)
  }

  const now = new Date()
  const updated: TriggerRelationship = {
    ...trigger,
    verb: 'triggered', // Event form = completed state
    to: workflowInstanceUrl, // The result: created workflow instance
    data: {
      ...trigger.data!,
      executionDurationMs,
    },
    updatedAt: now,
  }

  store.set(id, updated)
  return updated
}

/**
 * Fail a trigger (firing -> completed with error)
 *
 * @param db - Database instance
 * @param id - Trigger ID
 * @param error - Error that caused the failure
 * @returns The updated trigger
 */
export async function failTrigger(
  db: object,
  id: string,
  error: Error
): Promise<TriggerRelationship> {
  const store = getTriggerStore(db)
  const trigger = store.get(id)

  if (!trigger) {
    throw new Error(`Trigger not found: ${id}`)
  }

  if (trigger.verb !== 'triggering') {
    throw new Error(`Invalid transition: cannot fail from ${verbFormToState(trigger.verb)} state`)
  }

  const now = new Date()
  const updated: TriggerRelationship = {
    ...trigger,
    verb: 'triggered', // Event form = completed (with error)
    to: null, // No result due to failure
    data: {
      ...trigger.data!,
      error: error.message,
    },
    updatedAt: now,
  }

  store.set(id, updated)
  return updated
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Query triggers by state
 *
 * @param db - Database instance
 * @param state - The state to filter by
 * @param options - Additional query options
 * @returns Array of triggers in the specified state
 */
export async function queryTriggersByState(
  db: object,
  state: TriggerState,
  options?: QueryTriggerOptions
): Promise<TriggerRelationship[]> {
  const store = getTriggerStore(db)
  const targetVerb = stateToVerbForm(state)

  let results = Array.from(store.values())

  // Filter by verb (state)
  results = results.filter((t) => t.verb === targetVerb)

  // Filter by schedule URL
  if (options?.scheduleUrl) {
    results = results.filter((t) => t.from === options.scheduleUrl)
  }

  // Filter by workflow URL
  if (options?.workflowUrl) {
    results = results.filter((t) => t.to === options.workflowUrl || t.data?.cronExpression)
  }

  // Filter by cron expression
  if (options?.cronExpression) {
    results = results.filter((t) => t.data?.cronExpression === options.cronExpression)
  }

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Query schedules by workflow (reverse traversal)
 *
 * Finds all schedules that trigger a specific workflow
 *
 * @param db - Database instance
 * @param workflowUrl - The workflow URL to find schedules for
 * @param options - Query options
 * @returns Array of schedule-trigger pairs
 */
export async function querySchedulesByWorkflow(
  db: object,
  workflowUrl: string,
  options?: { includeCompleted?: boolean; limit?: number }
): Promise<ScheduleByWorkflow[]> {
  const triggerStore = getTriggerStore(db)
  const scheduleStore = getScheduleStore(db)
  const results: ScheduleByWorkflow[] = []

  for (const trigger of triggerStore.values()) {
    // Check if this trigger targets the workflow
    // For scheduled/firing triggers, check the original data
    // For completed triggers, check the to field
    const isTargetWorkflow =
      trigger.to === workflowUrl ||
      (trigger.verb === 'trigger' && trigger.to === workflowUrl) ||
      (trigger.verb === 'triggering' && trigger.data?.metadata?.workflowUrl === workflowUrl)

    if (!isTargetWorkflow) continue

    // Skip completed triggers unless requested
    const state = verbFormToState(trigger.verb)
    if (state === 'completed' && !options?.includeCompleted) continue

    // Find the schedule
    const schedule = await getScheduleByUrl(db, trigger.from)
    if (!schedule) continue

    results.push({
      schedule,
      trigger,
      state,
    })

    if (options?.limit && results.length >= options.limit) break
  }

  return results
}

/**
 * Query triggers by schedule (forward traversal)
 *
 * Finds all triggers for a specific schedule
 *
 * @param db - Database instance
 * @param scheduleUrl - The schedule URL to find triggers for
 * @param options - Query options
 * @returns Array of triggers
 */
export async function queryTriggersBySchedule(
  db: object,
  scheduleUrl: string,
  options?: QueryTriggerOptions
): Promise<TriggerRelationship[]> {
  const store = getTriggerStore(db)

  let results = Array.from(store.values()).filter((t) => t.from === scheduleUrl)

  // Filter by state
  if (options?.state) {
    const targetVerb = stateToVerbForm(options.state)
    results = results.filter((t) => t.verb === targetVerb)
  }

  // Filter by completed
  if (!options?.includeCompleted) {
    results = results.filter((t) => t.verb !== 'triggered')
  }

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

// ============================================================================
// TRIGGER HISTORY
// ============================================================================

/**
 * Get trigger history for a schedule
 *
 * Returns completed triggers ordered by completion time
 *
 * @param db - Database instance
 * @param scheduleUrl - The schedule URL
 * @param options - Query options
 * @returns Array of history entries
 */
export async function getTriggerHistory(
  db: object,
  scheduleUrl: string,
  options?: { limit?: number }
): Promise<TriggerHistoryEntry[]> {
  const store = getTriggerStore(db)

  const completed = Array.from(store.values())
    .filter((t) => t.from === scheduleUrl && t.verb === 'triggered')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  const limited = options?.limit ? completed.slice(0, options.limit) : completed

  return limited.map((t) => ({
    triggerId: t.id,
    scheduleUrl: t.from,
    workflowUrl: t.to ?? '',
    scheduledAt: t.data?.scheduledAt ?? t.createdAt,
    firedAt: t.data?.firedAt ?? t.createdAt,
    completedAt: t.updatedAt,
    executionDurationMs: t.data?.executionDurationMs,
    state: verbFormToState(t.verb),
    isCatchup: t.data?.isCatchup ?? false,
    error: t.data?.error,
  }))
}

/**
 * Get recent trigger history across all schedules
 *
 * @param db - Database instance
 * @param options - Query options
 * @returns Array of history entries
 */
export async function getRecentTriggerHistory(
  db: object,
  options?: { limit?: number; workflowUrl?: string }
): Promise<TriggerHistoryEntry[]> {
  const store = getTriggerStore(db)

  let completed = Array.from(store.values())
    .filter((t) => t.verb === 'triggered')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  if (options?.workflowUrl) {
    completed = completed.filter((t) => t.to === options.workflowUrl)
  }

  const limited = options?.limit ? completed.slice(0, options.limit) : completed

  return limited.map((t) => ({
    triggerId: t.id,
    scheduleUrl: t.from,
    workflowUrl: t.to ?? '',
    scheduledAt: t.data?.scheduledAt ?? t.createdAt,
    firedAt: t.data?.firedAt ?? t.createdAt,
    completedAt: t.updatedAt,
    executionDurationMs: t.data?.executionDurationMs,
    state: verbFormToState(t.verb),
    isCatchup: t.data?.isCatchup ?? false,
    error: t.data?.error,
  }))
}

// ============================================================================
// SCHEDULE MANAGER INTEGRATION
// ============================================================================

/**
 * Fire a trigger for a schedule
 *
 * This is the main entry point for ScheduleManager integration.
 * Creates a trigger relationship and transitions through states.
 *
 * @param db - Database instance
 * @param scheduleId - Schedule ID to fire
 * @param workflowUrl - Target workflow URL
 * @param options - Additional options
 * @returns The completed trigger
 */
export async function fireScheduleTrigger(
  db: object,
  scheduleId: string,
  workflowUrl: string,
  options?: { isCatchup?: boolean; metadata?: Record<string, unknown> }
): Promise<TriggerRelationship> {
  const schedule = await getSchedule(db, scheduleId)
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`)
  }

  const startTime = Date.now()

  // Create trigger in scheduled state
  const trigger = await createTrigger(db, {
    scheduleUrl: schedule.url,
    workflowUrl,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    metadata: {
      ...schedule.metadata,
      ...options?.metadata,
      isCatchup: options?.isCatchup,
    },
  })

  // Transition to firing
  const firing = await startTrigger(db, trigger.id)

  // Store the original workflow URL in metadata for reverse queries
  if (firing.data) {
    firing.data.metadata = {
      ...firing.data.metadata,
      workflowUrl,
    }
    firing.data.isCatchup = options?.isCatchup
  }

  return firing
}

/**
 * Record trigger completion after workflow starts
 *
 * Called by ScheduleManager when the triggered workflow instance is created
 *
 * @param db - Database instance
 * @param triggerId - The trigger ID
 * @param workflowInstanceUrl - URL of the created workflow instance
 * @returns The completed trigger
 */
export async function recordTriggerCompletion(
  db: object,
  triggerId: string,
  workflowInstanceUrl: string
): Promise<TriggerRelationship> {
  const trigger = await getTrigger(db, triggerId)
  if (!trigger) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }

  const executionDurationMs = trigger.data?.firedAt
    ? Date.now() - trigger.data.firedAt.getTime()
    : undefined

  return completeTrigger(db, triggerId, workflowInstanceUrl, executionDurationMs)
}

/**
 * Record trigger failure
 *
 * Called by ScheduleManager when the trigger fails to execute
 *
 * @param db - Database instance
 * @param triggerId - The trigger ID
 * @param error - The error that caused the failure
 * @returns The failed trigger
 */
export async function recordTriggerFailure(
  db: object,
  triggerId: string,
  error: Error
): Promise<TriggerRelationship> {
  return failTrigger(db, triggerId, error)
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export {
  triggerMachine,
  verbFormToState,
  stateToVerbForm,
  stateToVerbForms,
  buildScheduleUrl,
  buildWorkflowUrl,
  SCHEDULE_BASE_URL,
  WORKFLOW_BASE_URL,
  SCHEDULE_TYPE_ID,
  SCHEDULE_TYPE_NAME,
}
