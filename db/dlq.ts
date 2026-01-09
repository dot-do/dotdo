import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { events } from './events'

// ============================================================================
// DLQ - Dead Letter Queue (Failed Events)
// ============================================================================

/**
 * Dead Letter Queue - stores failed events for retry/analysis
 *
 * When an event handler fails, the event is moved to the DLQ with:
 * - Original event data (verb, source, data)
 * - Error information (message, stack trace)
 * - Retry tracking (count, max, last attempt)
 *
 * Events can be replayed from the DLQ, and are removed on successful replay.
 * Events that exceed max retries can be purged (archived for audit trail).
 */
export const dlq = sqliteTable(
  'dlq',
  {
    id: text('id').primaryKey(),

    // Original event reference
    eventId: text('event_id').references(() => events.id),
    verb: text('verb').notNull(),
    source: text('source').notNull(),
    data: text('data', { mode: 'json' }).notNull(),

    // Error information
    error: text('error').notNull(), // Error message
    errorStack: text('error_stack'), // Stack trace (nullable)

    // Retry tracking
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp' }),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    verbIdx: index('dlq_verb_idx').on(table.verb),
    sourceIdx: index('dlq_source_idx').on(table.source),
    retryCountIdx: index('dlq_retry_count_idx').on(table.retryCount),
    eventIdIdx: index('dlq_event_id_idx').on(table.eventId),
  }),
)
