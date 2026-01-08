import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// OBJECTS - DO-to-DO References (ns → CF DO ID mapping)
// ============================================================================
//
// Maps namespace URLs to Cloudflare Durable Object IDs.
// Used for cross-DO resolution and geo-replication.
//
// ============================================================================

export const objects = sqliteTable(
  'objects',
  {
    // The namespace URL (which IS the DO's identity - fully qualified)
    ns: text('ns').primaryKey(), // 'https://startups.studio'

    // Cloudflare DO binding
    id: text('id').notNull(), // CF Durable Object ID
    class: text('class').notNull(), // CF binding: 'DO', 'Startup', etc.

    // Relationship type
    relation: text('relation', {
      enum: ['parent', 'child', 'follower', 'shard', 'reference'],
    }),

    // For sharding
    shardKey: text('shard_key'),
    shardIndex: integer('shard_index'),

    // For geo-replication
    region: text('region'),
    primary: integer('primary', { mode: 'boolean' }),

    // Cached data (denormalized for display)
    cached: text('cached', { mode: 'json' }),

    // Created timestamp
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('obj_id_idx').on(table.id),
    index('obj_relation_idx').on(table.relation),
    index('obj_shard_idx').on(table.shardKey, table.shardIndex),
    index('obj_region_idx').on(table.region),
  ],
)
