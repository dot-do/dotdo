/**
 * Minimal Schema for DOTiny
 *
 * Only includes the tables strictly required for the tiny DO class:
 * - objects: For parent-child relationships during initialize()
 *
 * This keeps the bundle size under 15KB by excluding:
 * - nouns, verbs, things, relationships (full graph store)
 * - actions, events, search, dlq (workflow/events)
 * - branches, files, git (version control)
 * - auth, integrations, linked-accounts (identity)
 * - clickhouse, json-indexes (analytics)
 * - vault, flags (security/feature flags)
 * - exec (shell execution)
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// OBJECTS - DO-to-DO References (ns -> CF DO ID mapping)
// ============================================================================
//
// Maps namespace URLs to Cloudflare Durable Object IDs.
// Used for cross-DO resolution and parent-child relationships.
//
// ============================================================================

/**
 * Valid relation types for DO-to-DO relationships
 */
export const ObjectRelation = {
  parent: 'parent',
  child: 'child',
  follower: 'follower',
  shard: 'shard',
  reference: 'reference',
} as const

export type ObjectRelationType = (typeof ObjectRelation)[keyof typeof ObjectRelation]

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

/**
 * Type for a selected object record (all fields)
 */
export type DOObject = typeof objects.$inferSelect

/**
 * Type for inserting a new object record
 */
export type NewDOObject = typeof objects.$inferInsert
