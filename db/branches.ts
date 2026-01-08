import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// BRANCHES - Git-like branch management
// ============================================================================
//
// Branches enable parallel development and experimentation.
// Each branch points to a HEAD version (things.rowid).
//
// Addressing:
//   https://example.com/acme              → HEAD of main (default)
//   https://example.com/acme@main         → explicit main branch
//   https://example.com/acme@experiment   → experiment branch
//   https://example.com/acme@v1234        → specific version (rowid)
//   https://example.com/acme@~1           → one version back
//
// Operations:
//   $.branch('experiment')   → create branch at current HEAD
//   $.checkout('experiment') → switch to branch
//   $.merge('experiment')    → merge into current
// ============================================================================

export const branches = sqliteTable(
  'branches',
  {
    // rowid is implicit

    // Branch identity
    name: text('name').notNull(), // 'main', 'experiment', 'feature/x'

    // What this branch tracks (thing id, not rowid)
    thingId: text('thing_id').notNull(), // 'Startup/acme'

    // HEAD pointer (current version)
    head: integer('head').notNull(), // things.rowid (current version)

    // Fork point
    base: integer('base'), // things.rowid (where branch diverged)
    forkedFrom: text('forked_from'), // Branch name it was forked from

    // Metadata
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    // Each thing can only have one branch with a given name
    uniqueIndex('branches_thing_name_idx').on(table.thingId, table.name),
    index('branches_name_idx').on(table.name),
    index('branches_thing_idx').on(table.thingId),
  ],
)

// ============================================================================
// DEFAULT BRANCHES
// ============================================================================
//
// Every thing implicitly has a 'main' branch.
// When branch is null in things table, it's on main.
// Explicit branch records are only needed for non-main branches.
//
// ============================================================================
// MERGE STRATEGY
// ============================================================================
//
// On merge, we:
// 1. Find the base (common ancestor)
// 2. Get changes on source branch since base
// 3. Get changes on target branch since base
// 4. Apply source changes to target HEAD
// 5. Create new version on target branch
// 6. Optionally delete source branch
//
// Conflicts are detected by comparing changed fields.
// Resolution can be automatic (last-write-wins) or manual.
//
