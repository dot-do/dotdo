import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { eq, and, or } from 'drizzle-orm'

// ============================================================================
// ACTIONS - Command Log (append-only)
// ============================================================================
//
// Actions are the source of truth for all mutations.
// They reference thing versions by rowid for before/after state.
//
// Every action has:
//   - verb: what was done (FK to verbs, uses 'action' form like 'create')
//   - actor: who did it (local path or URL)
//   - target: what was affected (local path)
//   - input: thing.rowid before the action (null for creates)
//   - output: thing.rowid after the action (null for deletes)
//   - options: additional parameters
//
// Time travel: Join actions with things to reconstruct state at any point.
// ============================================================================

export const actions = sqliteTable(
  'actions',
  {
    // rowid is implicit and serves as sequence number

    // Identity
    id: text('id').notNull().unique(), // UUID for external reference

    // The action
    verb: text('verb').notNull(), // 'create', 'update', 'delete' (action form)

    // Actor and target (local paths within this DO)
    actor: text('actor'), // 'Human/nathan', 'Agent/support'
    target: text('target').notNull(), // 'Startup/acme'

    // Version references (rowids into things table)
    input: integer('input'), // things.rowid before (null for create)
    output: integer('output'), // things.rowid after (null for delete)

    // Additional parameters
    options: text('options', { mode: 'json' }),

    // Durability level
    durability: text('durability', {
      enum: ['send', 'try', 'do'],
    })
      .notNull()
      .default('try'),

    // Status
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'undone', 'retrying'],
    })
      .notNull()
      .default('pending'),
    error: text('error', { mode: 'json' }),

    // Context (for correlation)
    requestId: text('request_id'),
    sessionId: text('session_id'),
    workflowId: text('workflow_id'),

    // Timing (derived, not source of truth for things)
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    duration: integer('duration'), // ms

    // Created timestamp (for this action record)
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('actions_verb_idx').on(table.verb),
    index('actions_target_idx').on(table.target),
    index('actions_actor_idx').on(table.actor),
    index('actions_status_idx').on(table.status),
    index('actions_request_idx').on(table.requestId),
    index('actions_created_idx').on(table.createdAt),
    index('actions_output_idx').on(table.output),
    // Composite indexes for common query patterns
    index('actions_target_verb_idx').on(table.target, table.verb),
    index('actions_actor_target_idx').on(table.actor, table.target),
    index('actions_status_created_idx').on(table.status, table.createdAt),
    index('actions_workflow_status_idx').on(table.workflowId, table.status),
    index('actions_session_idx').on(table.sessionId),
    // Input index for time-travel queries joining with things
    index('actions_input_idx').on(table.input),
  ],
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type for selecting actions from the database
 */
export type Action = typeof actions.$inferSelect

/**
 * Type for inserting new actions into the database
 */
export type NewAction = typeof actions.$inferInsert

// ============================================================================
// ENUM/CONSTANT EXPORTS
// ============================================================================

/**
 * Action status values
 */
export const ActionStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNDONE: 'undone',
  RETRYING: 'retrying',
} as const

/**
 * Action durability values
 */
export const ActionDurability = {
  SEND: 'send',
  TRY: 'try',
  DO: 'do',
} as const

// ============================================================================
// QUERY HELPER TYPES
// ============================================================================

/**
 * Database interface required for query helpers.
 * This allows the helpers to work with any Drizzle database instance.
 */
export interface ActionsDb {
  select(): {
    from(table: typeof actions): {
      where(condition: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<Action[]>
      orderBy(...columns: unknown[]): {
        where(condition: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<Action[]>
      }
    }
  }
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get all actions for a specific target.
 * Uses the target index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param target - The target path (e.g., 'Startup/acme')
 * @returns Array of actions for the target
 *
 * @example
 * ```ts
 * const acmeActions = await getActionsByTarget(db, 'Startup/acme')
 * ```
 */
export async function getActionsByTarget(
  db: ActionsDb,
  target: string
): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(eq(actions.target, target))
}

/**
 * Get all actions by a specific actor.
 * Uses the actor index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param actor - The actor path (e.g., 'Human/nathan', 'Agent/support')
 * @returns Array of actions by the actor
 *
 * @example
 * ```ts
 * const nathanActions = await getActionsByActor(db, 'Human/nathan')
 * ```
 */
export async function getActionsByActor(
  db: ActionsDb,
  actor: string
): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(eq(actions.actor, actor))
}

/**
 * Get all actions with a specific status.
 * Uses the status index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param status - The status to filter by
 * @returns Array of actions with the status
 *
 * @example
 * ```ts
 * const failedActions = await getActionsByStatus(db, 'failed')
 * ```
 */
export async function getActionsByStatus(
  db: ActionsDb,
  status: Action['status']
): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(eq(actions.status, status))
}

/**
 * Get all pending actions.
 * Convenience wrapper around getActionsByStatus.
 *
 * @param db - Drizzle database instance
 * @returns Array of pending actions
 */
export async function getPendingActions(db: ActionsDb): Promise<Action[]> {
  return getActionsByStatus(db, 'pending')
}

/**
 * Get all running actions.
 * Convenience wrapper around getActionsByStatus.
 *
 * @param db - Drizzle database instance
 * @returns Array of running actions
 */
export async function getRunningActions(db: ActionsDb): Promise<Action[]> {
  return getActionsByStatus(db, 'running')
}

/**
 * Get all failed actions.
 * Convenience wrapper around getActionsByStatus.
 *
 * @param db - Drizzle database instance
 * @returns Array of failed actions
 */
export async function getFailedActions(db: ActionsDb): Promise<Action[]> {
  return getActionsByStatus(db, 'failed')
}

/**
 * Get action history for a thing by its rowid.
 * Finds all actions where this thing version was the input or output.
 *
 * @param db - Drizzle database instance
 * @param thingRowid - The things.rowid to look up history for
 * @returns Array of actions involving this thing version
 *
 * @example
 * ```ts
 * const history = await getActionHistory(db, 42)
 * ```
 */
export async function getActionHistory(
  db: ActionsDb,
  thingRowid: number
): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(
      or(
        eq(actions.input, thingRowid),
        eq(actions.output, thingRowid)
      )!
    )
}

/**
 * Calculate duration in milliseconds between two timestamps.
 *
 * @param startedAt - Start timestamp
 * @param completedAt - End timestamp
 * @returns Duration in milliseconds
 *
 * @example
 * ```ts
 * const duration = calculateDuration(action.startedAt, action.completedAt)
 * ```
 */
export function calculateDuration(startedAt: Date, completedAt: Date): number {
  return completedAt.getTime() - startedAt.getTime()
}
