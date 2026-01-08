import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// OBJECTS - DO-to-DO References (ns → CF DO ID mapping)
// ============================================================================

export const objects = sqliteTable('objects', {
  // The namespace URL (which IS the DO's identity - fully qualified)
  ns: text('ns').primaryKey(),                     // 'https://startups.studio' or 'https://headless.ly'

  // Cloudflare DO binding
  doId: text('do_id').notNull(),                   // CF Durable Object ID
  doClass: text('do_class').notNull(),             // CF binding: 'DO', 'STARTUP', etc.

  // Relationship type
  relationType: text('relation_type', {
    enum: ['parent', 'child', 'follower', 'shard', 'reference']
  }),

  // For sharding
  shardKey: text('shard_key'),
  shardIndex: integer('shard_index'),

  // For geo-replication
  region: text('region'),
  isPrimary: integer('is_primary', { mode: 'boolean' }),

  // Cached data (denormalized for display)
  cached: text('cached', { mode: 'json' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  doIdx: index('obj_do_idx').on(table.doId),
  relationIdx: index('obj_relation_idx').on(table.relationType),
  shardIdx: index('obj_shard_idx').on(table.shardKey, table.shardIndex),
  regionIdx: index('obj_region_idx').on(table.region),
}))
