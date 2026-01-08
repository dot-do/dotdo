import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// ACTIONS - Command Log (URL-based targets)
// ============================================================================

export const actions = sqliteTable('actions', {
  id: text('id').primaryKey(),
  verb: text('verb').notNull(),                    // 'create', 'update', 'delete'

  // URLs for target and actor
  target: text('target').notNull(),                // 'startups.studio/Startup/acme'
  actor: text('actor'),                            // 'startups.studio/Human/nathan'

  // Payload
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  before: text('before', { mode: 'json' }),
  after: text('after', { mode: 'json' }),

  // Status
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'undone', 'retrying']
  }).notNull().default('pending'),
  error: text('error', { mode: 'json' }),

  // Context
  requestId: text('request_id'),                   // Correlation ID
  sessionId: text('session_id'),                   // Session/conversation

  // Timing
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  duration: integer('duration'),                   // ms

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  verbIdx: index('actions_verb_idx').on(table.verb),
  targetIdx: index('actions_target_idx').on(table.target),
  actorIdx: index('actions_actor_idx').on(table.actor),
  statusIdx: index('actions_status_idx').on(table.status),
  requestIdx: index('actions_request_idx').on(table.requestId),
}))
