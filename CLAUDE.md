# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project: dotdo

**dotdo** is the runtime/framework layer - think of it like Node.js for serverless edge computing with Durable Objects.

This is a fresh rewrite. Reference implementations are available in `.worktrees/v1` and `.worktrees/v2`.

## Commands

```bash
npm run dev          # Wrangler dev server
npm test             # Vitest watch mode
npm run test:run     # Tests once
npm run typecheck    # TypeScript check
npm run deploy       # Build + deploy
```

## Issue Tracking with Beads (bd)

Beads uses **hierarchical IDs** for epic/task/subtask structure:

```
do-a3f8           [epic]     Feature Epic
├── do-a3f8.1     [task]     First task
│   ├── do-a3f8.1.1          Sub-task A
│   └── do-a3f8.1.2          Sub-task B
├── do-a3f8.2     [task]     Second task
└── do-a3f8.3     [task]     Third task
```

### Creating Hierarchical Issues

```bash
# Create epic
bd create --type=epic --title="Feature X" --priority=0

# Create task under epic (auto-generates do-xxx.1)
bd create --type=task --parent=do-xxx --title="First task"

# Create subtask (auto-generates do-xxx.1.1)
bd create --type=task --parent=do-xxx.1 --title="Sub-task"
```

### Common Commands

```bash
bd ready                              # Find work (no blockers)
bd list --status=open                 # All open issues
bd show <id>                          # Issue details with hierarchy
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Complete
bd close <id1> <id2> ...              # Close multiple at once
```

### Subagent Workflow

The hierarchical structure simplifies subagent management:

1. **Main agent** creates epic and decomposes into tasks
2. **Subagents** claim individual tasks via `bd update <id> --status=in_progress`
3. **Subagents** close tasks when complete via `bd close <id>`
4. **Main agent** monitors progress and closes epic when all tasks done

### Session Close Protocol

**Before ending a session:**

```bash
git status              # Check for changes
git add -A              # Stage changes
bd sync --from-main     # Pull beads updates (ephemeral branch)
git commit -m "..."     # Commit
```

Note: This is an ephemeral branch (v3). Code merges to main locally, not pushed.

## Testing Philosophy: NO MOCKS

Durable Objects require **no mocking**. Miniflare runs real DOs with real SQLite locally.

```typescript
import { env } from 'cloudflare:test'

// Get real DO instance
const stub = env.DO.get(env.DO.idFromName('test'))

// Test via RPC (preferred)
const result = await stub.things.create({ $type: 'Customer', name: 'Alice' })
expect(result.$id).toBeDefined()
```

## Process Management

**Vitest/Vite consume memory.** Guidelines:

1. Never run multiple vitest instances in parallel
2. Use `npx vitest run` (not watch mode) for CI
3. Kill orphans: `pkill -9 -f vitest; pkill -9 -f vite`

**For subagents:** Run ONE test file at a time.
