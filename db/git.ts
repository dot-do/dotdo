import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// GIT - Links DOs to Git repositories
// ============================================================================
//
// Every DO can be bound to a git repository at a specific path (for monorepos).
// The DO subscribes to changes on specific branches and syncs content.
//
// Architecture:
//   R2 = Global git object store (via gitx)
//   gitx = Git engine (wire protocol, packfiles, MCP tools)
//   DO = Branch-specific hot cache + runtime state
//
// Events flow:
//   git push → gitx → Queue → Events Router → target DO(s)
//
// ============================================================================

export const git = sqliteTable(
  'git',
  {
    // The DO namespace this binding belongs to
    ns: text('ns').primaryKey(), // 'https://startups.studio'

    // Git repository (fully qualified URL)
    repo: text('repo').notNull(), // 'https://github.com/drivly/startups.studio'

    // Path within repo for monorepo support (empty string = root)
    path: text('path').notNull().default(''), // 'packages/core', 'apps/web', ''

    // Default branch to sync
    defaultBranch: text('default_branch').notNull().default('main'),

    // Current synced commit (HEAD of default branch)
    commit: text('commit'), // SHA: 'abc123...'

    // Branch patterns to auto-create preview DOs for
    // e.g., 'feature/*,fix/*' creates DOs for matching branches
    branchPatterns: text('branch_patterns'),

    // Sync mode: 'pull' (read-only), 'push' (can write back), 'mirror' (bidirectional)
    syncMode: text('sync_mode', { enum: ['pull', 'push', 'mirror'] }).default('pull'),

    // Content types to sync (comma-separated file patterns)
    // e.g., '*.md,*.mdx,*.json' or '*' for everything
    contentPatterns: text('content_patterns').default('*'),

    // Last sync timestamp
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),

    // Sync status
    syncStatus: text('sync_status', { enum: ['synced', 'pending', 'error'] }).default('pending'),
    syncError: text('sync_error'),

    // Created timestamp
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('git_repo_idx').on(table.repo),
    index('git_repo_path_idx').on(table.repo, table.path),
    index('git_commit_idx').on(table.commit),
    index('git_sync_status_idx').on(table.syncStatus),
  ],
)

// ============================================================================
// GIT BRANCHES - Tracks branch-to-DO mappings
// ============================================================================
//
// When a branch matches branchPatterns, a new DO is created.
// This table tracks which branches have corresponding DOs.
//
// Branch = DO Instance concept:
//   main → https://app.do
//   feature/dark-mode → https://app.do#feature/dark-mode (or separate DO)
//
// ============================================================================

export const gitBranches = sqliteTable(
  'git_branches',
  {
    id: text('id').primaryKey(), // UUID

    // Parent git binding
    bindingNs: text('binding_ns').notNull(), // FK → git.ns

    // Branch name
    branch: text('branch').notNull(), // 'feature/dark-mode'

    // The DO namespace for this branch
    // null = uses parent DO with branch context
    // string = separate DO was created
    branchNs: text('branch_ns'), // 'https://app.do/branches/feature-dark-mode'

    // Current commit on this branch
    commit: text('commit'),

    // Is this the default branch?
    isDefault: integer('is_default', { mode: 'boolean' }).default(false),

    // Branch status
    status: text('status', { enum: ['active', 'merged', 'deleted'] }).default('active'),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    mergedAt: integer('merged_at', { mode: 'timestamp' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('git_branch_unique_idx').on(table.bindingNs, table.branch),
    index('git_branch_ns_idx').on(table.branchNs),
    index('git_branch_status_idx').on(table.status),
  ],
)

// ============================================================================
// GIT CONTENT - Tracks individual file → Thing mappings
// ============================================================================
//
// Maps files in the git repo to Things in the DO.
// Used for incremental sync and conflict detection.
//
// ============================================================================

export const gitContent = sqliteTable(
  'git_content',
  {
    // The git binding this content belongs to
    bindingNs: text('binding_ns').notNull(), // FK → git.ns

    // File reference (integer FK to files.rowid for efficient storage)
    file: integer('file').notNull(), // FK → files.rowid

    // The Thing this file maps to
    thing: integer('thing').notNull(), // FK → things.rowid

    // Git blob SHA for this content
    blobSha: text('blob_sha'),

    // Last synced commit
    commit: text('commit'),

    // Sync direction: 'git' (from git), 'do' (from DO), 'conflict'
    syncDirection: text('sync_direction', { enum: ['git', 'do', 'conflict'] }),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    uniqueIndex('git_content_file_idx').on(table.bindingNs, table.file),
    index('git_content_thing_idx').on(table.thing),
    index('git_content_blob_idx').on(table.blobSha),
  ],
)
