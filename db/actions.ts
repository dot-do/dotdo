import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

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
  ],
)
