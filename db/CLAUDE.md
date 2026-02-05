# CLAUDE.md - @dotdo/db CLI Agent Instructions

## Project Overview

@dotdo/db is an abstract storage layer for Durable Objects with a CLI for database management. It provides:

- **Things**: Generic entity storage with CRUD operations
- **Relationships**: Graph-like connections between entities
- **Events**: Event sourcing and audit logging
- **Query**: Fluent query builder for complex queries

The CLI (`db`) enables local and remote database operations with schema validation, data import/export, and sync with db.headless.ly.

## CLI Commands

```bash
# Database management
db init [directory]          # Initialize .db directory
db schema [show|validate]    # Show/validate schema
db types                     # List entity types
db stats [type]              # Database statistics
db doctor [--fix]            # Health checks

# Data operations
db query <type> [filter]     # Query with MongoDB-style filter
db get <type> <id>           # Get single entity
db create <type> <data>      # Create entity
db update <type> <id> <data> # Update entity
db delete <type> <id>        # Delete entity
db import <type> <file>      # Import JSON/CSV/TSV
db export <type> [file]      # Export JSON/CSV/Parquet

# Remote sync
db push                      # Push to db.headless.ly
db pull [owner/database]     # Pull from remote
db sync                      # Bidirectional sync

# Development
db generate [--output path]  # Generate TypeScript types
```

## Issue Tracking (Beads)

This project uses **Beads** (bd) for issue tracking with hierarchical IDs.

### Hierarchy & Workflow

Beads supports hierarchical IDs for epics:

```
db-a3f8        (Epic: CLI Improvements)
db-a3f8.1      (Task: Schema file loading)
db-a3f8.1.1    (Sub-task: TDD Red - write tests)
db-a3f8.1.2    (Sub-task: TDD Green - implement)
db-a3f8.1.3    (Sub-task: TDD Refactor - clean up)
db-a3f8.2      (Task: Add export command)
```

### Required Subtask Patterns

**All functional issues MUST have TDD subtasks:**
```bash
# Create feature task
bd create --title="Add sync command" --type=task --parent=db-xxx

# Add required TDD subtasks
bd create --title="TDD Red: Write failing tests" --type=task --parent=db-xxx.1
bd create --title="TDD Green: Implement to pass" --type=task --parent=db-xxx.1
bd create --title="TDD Refactor: Clean up code" --type=task --parent=db-xxx.1
```

**All content issues MUST have write/edit/rewrite subtasks:**
```bash
# Create documentation task
bd create --title="Write CLI README" --type=task --parent=db-xxx

# Add required content subtasks
bd create --title="Write: Draft initial content" --type=task --parent=db-xxx.2
bd create --title="Edit: Review and improve" --type=task --parent=db-xxx.2
bd create --title="Rewrite: Final polish" --type=task --parent=db-xxx.2
```

### Common Beads Commands

```bash
bd ready                              # Find available work
bd list --status=open                 # All open issues
bd show <id>                          # Issue details with hierarchy
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Complete issue
bd close <id1> <id2> ...              # Close multiple at once
bd sync                               # Sync with git
```

### Subagent Workflow

1. **Main agent** creates epic and decomposes into tasks with TDD/content subtasks
2. **Subagents** claim individual tasks via `bd update <id> --status=in_progress`
3. **Subagents** follow Red-Green-Refactor for functional tasks
4. **Subagents** follow Write-Edit-Rewrite for content tasks
5. **Main agent** monitors progress and closes epic when all tasks done

## Architecture

### Directory Structure

```
.do/dotdo/db/
├── adapters/                  # Storage adapter implementations
│   ├── memory.ts              # In-memory adapter
│   ├── sqlite.ts              # SQLite adapter
│   └── parquet.ts             # Parquet adapter (bridges to ParqueDB)
├── cli/                       # CLI implementation
│   ├── index.ts               # Entry point
│   ├── registry.ts            # Command registry
│   ├── types.ts               # Types and output formatting
│   ├── db-context.ts          # Database context management
│   └── commands/              # Individual commands
│       ├── init.ts
│       ├── schema.ts
│       ├── types.ts
│       ├── query.ts
│       ├── get.ts
│       ├── create.ts
│       ├── update.ts
│       ├── delete.ts
│       ├── import.ts
│       ├── export.ts
│       ├── sync.ts
│       ├── generate.ts
│       ├── stats.ts
│       └── doctor.ts
├── entities/                  # Entity stores
│   ├── things.ts              # Generic entity storage
│   ├── relationships.ts       # Graph relationships
│   └── events.ts              # Event sourcing
├── query/                     # Query system
│   ├── query.ts               # Query builder
│   └── pagination.ts          # Cursor pagination
├── schema/                    # Validation and schemas
│   ├── schema.ts
│   ├── schemas.ts
│   └── validation.ts
├── storage/                   # Storage abstraction
│   ├── storage.ts             # StorageAdapter interface
│   ├── sqlite.ts
│   ├── tiered-storage.ts
│   └── event-sourcing.ts
├── utils/                     # Utilities
│   ├── types.ts               # Core types
│   ├── errors.ts              # Error classes
│   ├── branded-types.ts       # Type-safe IDs
│   ├── id.ts                  # ID generation
│   ├── logger.ts
│   ├── constants.ts
│   └── migrations.ts
└── integrations/              # External integrations
    ├── audit.ts
    └── digital-objects.ts
```

### Key Patterns

**StorageAdapter Interface:**
```typescript
interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>
  getMany<T>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  putMany<T>(entries: Map<string, T>): Promise<void>
  delete(key: string): Promise<void>
  deleteMany(keys: string[]): Promise<void>
  list<T>(options?: ListOptions): Promise<ListResult<T>>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  has(key: string): Promise<boolean>
  clear(): Promise<void>
  count(prefix?: string): Promise<number>
}
```

**Entity Key Prefixes:**
- `thing:{id}` - Things store
- `rel:{subject}:{predicate}:{object}` - Relationships store
- `evt:{id}` - Events store

**ID Format:**
- ThingId: `{timestamp-base36}-{random-12-chars}`
- EventId: `evt-{timestamp-base36}-{random-8-chars}`

## Development Workflow

### TDD Approach (Red-Green-Refactor)

1. **Red**: Write failing test first
2. **Green**: Implement minimum code to pass
3. **Refactor**: Clean up while keeping tests green

```bash
# Run tests
pnpm test                    # Watch mode
pnpm test:run                # Run once

# Run specific test file
npx vitest run cli/tests/init.test.ts
```

### Adding a New CLI Command

1. Create command file in `cli/commands/`:
```typescript
import type { ParsedArgs } from '../types'
import { print, printError, printSuccess } from '../types'
import { getContext } from '../db-context'

export async function myCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized')
    return 1
  }

  // Implementation
  printSuccess('Done!')
  return 0
}
```

2. Register in `cli/index.ts`:
```typescript
import { myCommand } from './commands/my-command'

registry.register({
  name: 'my-command',
  description: 'Does something useful',
  usage: 'db my-command [options]',
  category: 'Data',
  execute: myCommand
})
```

3. Write tests first (TDD Red)
4. Implement to pass tests (TDD Green)
5. Refactor for clean code (TDD Refactor)

### Adding a Storage Adapter

1. Implement `StorageAdapter` interface
2. Add to `adapters/index.ts` exports
3. Add tests in `adapters/__tests__/`

## Session Close Protocol

**NEVER end a session without:**

```bash
bd sync              # Sync issues
git status           # Check for changes
git add <files>      # Stage changes
git commit -m "..."  # Commit
git push             # PUSH TO REMOTE
```

**CRITICAL:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing
- If push fails, resolve and retry

## Environment Variables

```bash
HEADLESSLY_DB_REMOTE    # Remote endpoint (db.headless.ly)
HEADLESSLY_API_KEY      # API key for remote operations
```

## Related Packages

- **parquedb** (`.do/db/parquedb/`) - Hybrid relational/document/graph database on Parquet
- **@dotdo/rpc** (`.do/rpc/`) - Cap'n Web RPC layer
- **headless.ly schema** (`.db/`) - Database schema for headless.ly platform

## Process Management

**Vitest/Vite consume memory.** Guidelines:

1. Never run multiple vitest instances in parallel
2. Use `npx vitest run` (not watch mode) for CI
3. Kill orphans: `pkill -9 -f vitest; pkill -9 -f vite`

**For subagents:** Run ONE test file at a time.
