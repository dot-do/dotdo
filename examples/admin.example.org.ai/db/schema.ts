/**
 * Drizzle Schema for Admin DO
 *
 * This file defines the drizzle-orm table schemas for the admin API.
 * Tables: nouns, verbs, actions, relationships, functions
 *
 * @module examples/admin.example.org.ai/db/schema
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// NOUNS TABLE - Type Registry with Storage/Routing Configuration
// ============================================================================

export const nouns = sqliteTable('nouns', {
  // Identity (noun is primary key)
  noun: text('noun').primaryKey(), // 'Customer', 'Agent', 'Event'
  plural: text('plural'), // 'Customers', 'Agents', 'Events'
  description: text('description'),

  // Schema - field definitions for validation
  schema: text('schema', { mode: 'json' }), // JSON Schema or field definitions

  // DO Routing
  doClass: text('do_class'), // CF binding name (e.g., 'DO', 'BROWSER_DO')

  // Sharding Configuration
  sharded: integer('sharded', { mode: 'boolean' }).default(false),
  shardCount: integer('shard_count').default(1), // Number of shards if sharded
  shardKey: text('shard_key'), // Field to shard by (default: id)

  // Storage Tier Configuration
  storage: text('storage').default('hot'), // 'hot' | 'cold' | 'tiered'
  ttlDays: integer('ttl_days'), // Days before archiving to cold (for tiered)

  // Query Optimization
  indexedFields: text('indexed_fields', { mode: 'json' }), // JSON array of fields to index

  // Namespace Strategy
  nsStrategy: text('ns_strategy').default('tenant'), // 'tenant' | 'singleton' | 'sharded'

  // Replica Configuration
  replicaRegions: text('replica_regions', { mode: 'json' }), // JSON array of regions
  consistencyMode: text('consistency_mode').default('eventual'), // 'strong' | 'eventual' | 'causal'
  replicaBinding: text('replica_binding'), // DO binding name pattern
})

export type Noun = typeof nouns.$inferSelect
export type NewNoun = typeof nouns.$inferInsert

// ============================================================================
// VERBS TABLE - Predicate Registry
// ============================================================================

export const verbs = sqliteTable('verbs', {
  // Predicate form - reads naturally in graph relationships
  verb: text('verb').primaryKey(), // 'creates' (Subject creates Object)

  // Linguistic forms
  action: text('action'), // 'create' (imperative / base form)
  activity: text('activity'), // 'creating' (present participle / gerund)
  event: text('event'), // 'created' (past participle)
  reverse: text('reverse'), // 'createdBy' (for <-, <~ backward operators)
  inverse: text('inverse'), // 'deletes' (opposite predicate)

  // Metadata
  description: text('description'),
})

export type Verb = typeof verbs.$inferSelect
export type NewVerb = typeof verbs.$inferInsert

// ============================================================================
// ACTIONS TABLE - Command Log (append-only)
// ============================================================================

export const actions = sqliteTable(
  'actions',
  {
    // Identity
    id: text('id').primaryKey(), // UUID for external reference

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
    index('admin_actions_verb_idx').on(table.verb),
    index('admin_actions_target_idx').on(table.target),
    index('admin_actions_actor_idx').on(table.actor),
    index('admin_actions_status_idx').on(table.status),
    index('admin_actions_created_idx').on(table.createdAt),
  ],
)

export type Action = typeof actions.$inferSelect
export type NewAction = typeof actions.$inferInsert

// ============================================================================
// RELATIONSHIPS TABLE - Edges (fully qualified URL-based)
// ============================================================================

export const relationships = sqliteTable(
  'relationships',
  {
    id: text('id').primaryKey(),
    verb: text('verb').notNull(), // 'created', 'manages', 'owns'

    // Fully qualified URLs - can be local, cross-DO, or external
    from: text('from').notNull(), // 'https://startups.studio/headless.ly'
    to: text('to').notNull(), // 'https://startups.studio/nathan'

    // Edge properties
    data: text('data', { mode: 'json' }),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('admin_rel_verb_idx').on(table.verb),
    index('admin_rel_from_idx').on(table.from),
    index('admin_rel_to_idx').on(table.to),
    index('admin_rel_from_verb_idx').on(table.from, table.verb),
    index('admin_rel_to_verb_idx').on(table.to, table.verb),
    uniqueIndex('admin_rel_unique_idx').on(table.verb, table.from, table.to),
  ],
)

export type Relationship = typeof relationships.$inferSelect
export type NewRelationship = typeof relationships.$inferInsert

// ============================================================================
// FUNCTIONS TABLE - Four Implementation Types
// ============================================================================

export const functions = sqliteTable(
  'functions',
  {
    // Identity
    id: text('id').primaryKey(),
    name: text('name').notNull(),

    // Type discriminant: code | generative | agentic | human
    type: text('type', {
      enum: ['code', 'generative', 'agentic', 'human'],
    })
      .notNull()
      .default('code'),

    // Common fields
    description: text('description'),

    // Code function fields
    code: text('code'), // Handler source code or reference

    // AI function fields (generative/agentic)
    model: text('model'), // AI model identifier
    prompt: text('prompt'), // Prompt template

    // Input/Output schemas (JSON array of IOSchema)
    inputs: text('inputs', { mode: 'json' }), // [{name, type, description, required}]
    outputs: text('outputs', { mode: 'json' }), // [{name, type, description}]

    // Version tracking
    version: text('version'),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
  },
  (table) => [
    index('admin_functions_name_idx').on(table.name),
    index('admin_functions_type_idx').on(table.type),
  ],
)

export type Function = typeof functions.$inferSelect
export type NewFunction = typeof functions.$inferInsert

// ============================================================================
// EXPORT ALL TABLES
// ============================================================================

export const schema = {
  nouns,
  verbs,
  actions,
  relationships,
  functions,
}
