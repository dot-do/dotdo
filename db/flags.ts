import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// FLAGS - Feature Flag Storage
// ============================================================================
//
// Feature flags for A/B testing and feature rollouts.
// Supports traffic allocation, branching, user targeting, and filters.
//
// ============================================================================

export const flags = sqliteTable(
  'flags',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    traffic: real('traffic').notNull(), // 0.0 to 1.0
    stickiness: text('stickiness').notNull(), // 'user_id' | 'session_id' | 'random'
    status: text('status').notNull(), // 'active' | 'disabled'
    branches: text('branches', { mode: 'json' }).notNull(), // JSON array of Branch[]
    filters: text('filters', { mode: 'json' }), // JSON array of Filter[] (optional)
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('flags_key_idx').on(table.key),
    index('flags_status_idx').on(table.status),
  ],
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/** Select type for Flag table */
export type FlagRow = typeof flags.$inferSelect

/** Insert type for Flag table */
export type NewFlagRow = typeof flags.$inferInsert

// ============================================================================
// BRANCH & FILTER TYPES
// ============================================================================

/** A branch in a feature flag (control, variant, etc.) */
export interface Branch {
  key: string
  weight: number
  payload?: Record<string, unknown>
}

/** Filter for targeting specific users/cohorts */
export interface Filter {
  type: 'property' | 'cohort'
  property?: string
  operator?: 'eq' | 'gt' | 'lt' | 'contains' | 'in'
  value?: unknown
  cohortId?: string
}

/** Stickiness type for consistent flag evaluation */
export type Stickiness = 'user_id' | 'session_id' | 'random'

/** Flag status */
export type FlagStatus = 'active' | 'disabled'

/** Full flag entity with parsed JSON fields */
export interface Flag {
  id: string
  key: string
  traffic: number
  stickiness: Stickiness
  status: FlagStatus
  branches: Branch[]
  filters?: Filter[]
  createdAt: Date
  updatedAt: Date
}

/** New flag without timestamps (for create operations) */
export type NewFlag = Omit<Flag, 'createdAt' | 'updatedAt'>

/** Options for listing flags */
export interface ListFlagsOptions {
  status?: FlagStatus
  limit?: number
  offset?: number
}
