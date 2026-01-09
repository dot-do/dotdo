# Git-Native DO Architecture

Every Durable Object can be bound to a git repository, enabling content sync from filesystem to edge.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              R2 (Global)                                 │
│                         Git Object Store (via gitx)                      │
│                    Single source of truth for all repos                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ git push
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              gitx Worker                                 │
│                   Git engine: wire protocol, packfiles                   │
│                         Stores objects in R2                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Queue message
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Events Router                                  │
│                   Routes git events to subscribed DOs                    │
│                Query: repo + branch + path → target DOs                  │
└─────────────────────────────────────────────────────────────────────────┘
                         │                    │
                         ▼                    ▼
              ┌──────────────────┐  ┌──────────────────┐
              │   DO: app.do     │  │  DO: docs.do     │
              │   path: /        │  │  path: /docs     │
              │   branch: main   │  │  branch: main    │
              └──────────────────┘  └──────────────────┘
```

## Key Concepts

### 1. Branch = DO Instance

Each git branch can map to a separate DO instance or a branch context within a DO:

- `main` → `https://app.do` (production)
- `feature/dark-mode` → `https://app.do#feature/dark-mode` (preview)
- Or separate DO: `https://preview-dark-mode.app.do`

### 2. Monorepo Support

The `path` field in git bindings supports monorepos:

```
repo: github.com/org/monorepo
├── packages/core     → https://core.do
├── apps/web          → https://web.do
├── apps/docs         → https://docs.do
└── services/api      → https://api.do
```

Each DO only receives events for files within its path prefix.

### 3. Parent DO as Thing

A DO IS a Thing with its own `$id` matching its namespace. Hierarchical DOs use relationships:

```typescript
// Parent DO
$id: 'https://startups.studio'
$type: 'https://schema.org/Organization'
$git: { repo: '...', path: '', branch: 'main' }

// Child DO (references parent)
$id: 'https://headless.ly'
$type: 'https://startups.studio/Startup'
$parent: { $id: 'https://startups.studio' }
$git: { repo: '...', path: 'startups/headless.ly', branch: 'main' }
```

### 4. Thing Provenance

Things synced from git track their source:

```typescript
{
  $id: 'https://docs.do/getting-started',
  $type: 'https://schema.org/Article',
  $source: {
    repo: 'https://github.com/org/docs',
    path: 'content/getting-started.mdx',
    branch: 'main',
    commit: 'abc123...'
  }
}
```

## Schema

### files (Normalized Paths)

```sql
CREATE TABLE files (
  -- rowid is implicit, used as efficient FK
  path TEXT NOT NULL,           -- '/content/blog/hello.mdx'
  parent INTEGER,               -- FK → files.rowid
  name TEXT NOT NULL,           -- 'hello.mdx'
  type TEXT NOT NULL,           -- 'file', 'directory', 'blob', 'tree'
  hash TEXT,                    -- Content SHA for dedup
  size INTEGER,
  mode INTEGER,                 -- POSIX permissions
  ns TEXT,                      -- Namespace context
  branch TEXT,                  -- Branch context
  ...
);
```

### git (DO Bindings)

```sql
CREATE TABLE git (
  ns TEXT PRIMARY KEY,          -- DO namespace: 'https://app.do'
  repo TEXT NOT NULL,           -- 'https://github.com/org/repo'
  path TEXT DEFAULT '',         -- Monorepo path: 'packages/core'
  default_branch TEXT DEFAULT 'main',
  commit TEXT,                  -- Current synced commit
  branch_patterns TEXT,         -- 'feature/*,fix/*' for preview DOs
  sync_mode TEXT,               -- 'pull', 'push', 'mirror'
  content_patterns TEXT,        -- '*.md,*.mdx' or '*'
  ...
);
```

### git_branches (Branch → DO Mapping)

```sql
CREATE TABLE git_branches (
  id TEXT PRIMARY KEY,
  binding_ns TEXT NOT NULL,     -- FK → git.ns
  branch TEXT NOT NULL,         -- 'feature/dark-mode'
  branch_ns TEXT,               -- Separate DO namespace (if created)
  commit TEXT,
  status TEXT,                  -- 'active', 'merged', 'deleted'
  ...
);
```

### git_content (File → Thing Mapping)

```sql
CREATE TABLE git_content (
  binding_ns TEXT NOT NULL,     -- FK → git.ns
  file INTEGER NOT NULL,        -- FK → files.rowid (efficient!)
  thing INTEGER NOT NULL,       -- FK → things.rowid
  blob_sha TEXT,
  commit TEXT,
  sync_direction TEXT,          -- 'git', 'do', 'conflict'
  ...
);
```

## Event Flow

### Git Push

1. User pushes to `github.com/org/repo` branch `main`
2. gitx receives push, stores objects in R2
3. gitx publishes `git.push` event to Queue:

```json
{
  "type": "git.push",
  "repo": "https://github.com/org/repo",
  "branch": "main",
  "commit": "abc123",
  "commits": [{
    "sha": "abc123",
    "added": ["docs/new-page.mdx"],
    "modified": ["content/about.mdx"],
    "removed": []
  }]
}
```

4. Events Router queries `git` table for subscribed DOs
5. For each DO with matching repo/path:
   - Filter changed files to those within DO's path
   - Send sync request to DO

### Branch Creation

1. User creates `feature/dark-mode` branch
2. gitx publishes `git.branch.created` event
3. Router checks `branch_patterns` in git bindings
4. If pattern matches (e.g., `feature/*`):
   - Create new DO or branch context
   - Record in `git_branches` table
   - Trigger full sync

### Sync Process (in DO)

```typescript
async handleSync(event: SyncEvent) {
  const gitBinding = await this.getGitBinding()

  for (const file of event.affectedFiles) {
    // Fetch content from R2 via gitx
    const blob = await gitx.getBlob(event.commit, file)

    // Parse/transform based on file type
    const thing = await this.parseContent(file, blob)

    // Upsert Thing with git provenance
    await this.upsertThing({
      ...thing,
      $source: {
        repo: gitBinding.repo,
        path: file,
        branch: event.branch,
        commit: event.commit,
      }
    })

    // Update file → thing mapping
    await this.updateGitContent(file, thing.id)
  }

  // Update synced commit
  await this.updateGitBinding({ commit: event.commit })
}
```

## Integration with fsx

The `files` table unifies git content and fsx filesystem operations:

- **Git content**: Stored with hash (content-addressable)
- **fsx operations**: Stored with path (POSIX-style)
- **Shared**: Both use integer rowid FKs for efficiency

```typescript
// fsx read
const file = await files.getByPath('/content/hello.mdx')
const blob = await blobs.get(file.hash)

// git sync
const file = await files.upsert({ path, hash, type: 'blob' })
await gitContent.upsert({ file: file.rowid, thing: thing.rowid })
```

## Three-Tier Storage

```
┌─────────────────────────────────────────────────┐
│ HOT: DO SQLite                                   │
│ - Metadata (files, things, relationships)        │
│ - Small blobs (<1MB)                             │
│ - Fast access, per-DO isolation                  │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ WARM: R2                                         │
│ - Large blobs (1MB - 100MB)                      │
│ - Git objects (packfiles, loose objects)         │
│ - Shared across DOs (content-addressable)        │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ COLD: R2 + Pipelines → Iceberg                   │
│ - Historical events                              │
│ - Analytics                                      │
│ - Time-travel queries                            │
└─────────────────────────────────────────────────┘
```
