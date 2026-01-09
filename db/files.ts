import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// FILES - Unified file/path registry
// ============================================================================
//
// Normalized path storage using integer rowid for efficient FK references.
// Supports both git content and local filesystem operations (fsx).
//
// Key design:
//   - rowid = efficient integer FK (no text path duplication)
//   - parent = tree traversal via integer FK
//   - type = file, directory, symlink, blob, tree, commit (git objects too)
//   - hash = content-addressable for deduplication (optional)
//
// Use cases:
//   - git_content references files.rowid instead of storing paths
//   - fsx operations use path → rowid lookups
//   - Tree queries via parent chain
//
// ============================================================================

export const files = sqliteTable(
  'files',
  {
    // rowid is implicit in SQLite - used as efficient FK

    // Path identity
    path: text('path').notNull(), // '/content/blog/hello.mdx' or 'refs/heads/main'

    // Hierarchical structure (integer FK to parent file's rowid)
    // null = root entry
    parent: integer('parent'), // FK → files.rowid

    // File name (last segment of path, denormalized for performance)
    name: text('name').notNull(), // 'hello.mdx'

    // Type: supports both filesystem and git object types
    type: text('type', {
      enum: ['file', 'directory', 'symlink', 'blob', 'tree', 'commit', 'tag'],
    }).notNull(),

    // Content hash (SHA-1 for git, SHA-256 for fsx, null for directories)
    hash: text('hash'), // 'abc123...' (content-addressable)

    // Size in bytes (null for directories, commits)
    size: integer('size'),

    // POSIX permissions (fsx compatibility)
    mode: integer('mode'), // 0o644, 0o755, etc.

    // Symlink target (null if not a symlink)
    linkTarget: text('link_target'),

    // Storage tier for blobs (fsx compatibility)
    tier: text('tier', { enum: ['hot', 'warm', 'cold'] }),

    // Namespace this file belongs to (for multi-tenant / multi-repo)
    ns: text('ns'), // 'https://startups.studio'

    // Branch context (null = main/default)
    branch: text('branch'),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
  },
  (table) => [
    // Primary lookups
    uniqueIndex('files_path_ns_branch_idx').on(table.path, table.ns, table.branch),
    index('files_parent_idx').on(table.parent),
    index('files_name_idx').on(table.name),
    index('files_hash_idx').on(table.hash),
    index('files_type_idx').on(table.type),
    index('files_ns_idx').on(table.ns),
    index('files_ns_branch_idx').on(table.ns, table.branch),
  ],
)

// ============================================================================
// Helper: Get file by path (returns rowid for FK usage)
// ============================================================================
//
// SELECT rowid, * FROM files WHERE path = ? AND ns = ? AND (branch = ? OR branch IS NULL)
//
// ============================================================================
// Helper: Get children of a directory
// ============================================================================
//
// SELECT rowid, * FROM files WHERE parent = ?
//
// ============================================================================
// Helper: Get ancestors (path to root)
// ============================================================================
//
// WITH RECURSIVE ancestors AS (
//   SELECT rowid, * FROM files WHERE rowid = ?
//   UNION ALL
//   SELECT f.rowid, f.* FROM files f
//   JOIN ancestors a ON f.rowid = a.parent
// )
// SELECT * FROM ancestors
//
