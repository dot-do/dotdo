import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// THINGS - Version Log (append-only)
// ============================================================================
//
// Things are versioned, not mutated. Each row is a version.
// The rowid IS the version ID.
//
// Time travel: SELECT * FROM things WHERE rowid = ?
// Current state: SELECT * FROM things WHERE id = ? ORDER BY rowid DESC LIMIT 1
//
// No createdAt/updatedAt/createdBy - all derived from the Action that created
// this version.
// ============================================================================

export const things = sqliteTable(
  'things',
  {
    // rowid is implicit in SQLite and serves as version ID

    // Identity
    id: text('id').notNull(), // Local path: 'acme', 'headless.ly'
    type: integer('type').notNull(), // FK → nouns.rowid

    // Branch (null = main)
    branch: text('branch'), // 'main', 'experiment', null = main

    // Core fields
    name: text('name'),
    data: text('data', { mode: 'json' }),

    // Soft delete marker (version where thing was deleted)
    deleted: integer('deleted', { mode: 'boolean' }).default(false),
  },
  (table) => [
    index('things_id_idx').on(table.id),
    index('things_type_idx').on(table.type),
    index('things_branch_idx').on(table.branch),
    index('things_id_branch_idx').on(table.id, table.branch),
  ],
)

// ============================================================================
// Helper: Get current version of a thing
// ============================================================================
//
// SELECT * FROM things
// WHERE id = ? AND (branch = ? OR branch IS NULL)
// ORDER BY rowid DESC
// LIMIT 1
//
// ============================================================================
// Helper: Get thing at specific version
// ============================================================================
//
// SELECT * FROM things WHERE rowid = ?
//
// ============================================================================
// Helper: Get thing at timestamp (requires joining with actions)
// ============================================================================
//
// SELECT t.* FROM things t
// JOIN actions a ON a.output = t.rowid
// WHERE t.id = ? AND a.created_at <= ?
// ORDER BY t.rowid DESC
// LIMIT 1
//
