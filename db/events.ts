import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { actions } from './actions'

// ============================================================================
// EVENTS - Domain Events (URL-based sources)
// ============================================================================

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    verb: text('verb').notNull(), // 'created', 'updated', 'deleted'

    // URL of the source entity
    source: text('source').notNull(), // 'startups.studio/Startup/acme'

    // Event payload
    data: text('data', { mode: 'json' }).notNull(),

    // Related action (if triggered by an action)
    actionId: text('action_id').references(() => actions.id),

    // Ordering
    sequence: integer('sequence').notNull(), // Auto-increment within this DO

    // Streaming to Pipelines → R2
    streamed: integer('streamed', { mode: 'boolean' }).default(false),
    streamedAt: integer('streamed_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    verbIdx: index('events_verb_idx').on(table.verb),
    sourceIdx: index('events_source_idx').on(table.source),
    sourceVerbIdx: index('events_source_verb_idx').on(table.source, table.verb),
    sequenceIdx: index('events_sequence_idx').on(table.sequence),
    streamedIdx: index('events_streamed_idx').on(table.streamed),
  }),
)
