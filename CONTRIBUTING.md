# Contributing to dotdo

Thank you for your interest in contributing to dotdo! This guide will help you get started with development, testing, and contributing to the runtime/framework layer for Durable Objects.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@dotdo.dev](mailto:conduct@dotdo.dev).

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Code Style and Conventions](#code-style-and-conventions)
5. [Testing Guidelines](#testing-guidelines)
6. [Pull Request Process](#pull-request-process)
7. [Issue Tracking with Beads](#issue-tracking-with-beads)
8. [Package Structure](#package-structure)
9. [Process Management](#process-management)
10. [Session Close Protocol](#session-close-protocol)

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (20+ recommended)
- **npm** or **pnpm**
- **Git**
- **Cloudflare Account** (for deployment)
- **Wrangler CLI** (installed automatically via devDependencies)

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/dot-do/dotdo.git
cd dotdo

# Install dependencies (monorepo uses npm workspaces)
npm install

# Verify installation
npm run typecheck
npm test
```

### First-Time Setup

```bash
# Authenticate with Cloudflare (for deployment)
npx wrangler login

# Run development server
npm run dev

# In another terminal, run tests in watch mode
npm test
```

The dev server will start at `http://localhost:8787` (default Wrangler port).

---

## Development Workflow

### Understanding dotdo vs workers.do

**This is dotdo** - the **runtime/framework layer**. Think of it like Node.js.

| | **dotdo (this repo)** | **workers.do (separate repo)** |
|---|---|---|
| **Role** | Runtime/Framework | Platform/Product |
| **Analogy** | Node.js | Heroku |
| **Users** | Infrastructure developers | Startup founders, teams |
| **Package** | `dotdo` | `agents.do`, `teams.do`, `workers.do` |

**What belongs HERE:**
- DO class with SQLite storage (Things, Relationships, Events, Actions)
- Minimal Hono passthrough worker
- Cap'n Web RPC and transport layers
- WorkflowContext ($) and event system
- Extended primitives in `do/capabilities/` (fsx, gitx, bashx, npmx, pyx)
- AI module (`ai/`) with template literals and LLM routing

**What belongs ELSEWHERE:**
- **workers.do repo**: Named agents (Priya, Ralph, Tom), Teams, Business-as-Code
- **compat repo**: 90+ API-compatible SDKs (redis, postgres, stripe, etc.)

### Daily Development

```bash
# Start development (uses Turbo for monorepo orchestration)
npm run dev

# Run tests in watch mode
npm test

# Run tests once (CI mode)
npm run test:run

# Type checking across all packages
npm run typecheck

# Build all packages
npm run build

# Deploy to Cloudflare
npm run deploy
```

### Package-Specific Development

```bash
# Work on specific package
cd do && npm run dev       # @dotdo/do package
cd api && npm run dev      # @dotdo/api package
cd app && npm run dev      # @dotdo/app package

# Run package-specific tests
npm test --workspace=@dotdo/do
npm test --workspace=@dotdo/api
npm test --workspace=@dotdo/db
```

### Branch Strategy

This is a **v3 rewrite** using the `v3` branch. Reference implementations are available in:
- `.worktrees/v1` - Previous stable implementation
- `.worktrees/v2` - Experimental features

**Current branch:** `v3` (ephemeral worktree branch)

```bash
# Check current branch
git branch

# View reference implementations
ls .worktrees/
```

---

## Code Style and Conventions

### TypeScript Standards

- **Strict mode enabled** - All packages use strict TypeScript
- **No `any` types** - Use `unknown` or proper typing
- **Prefer interfaces over types** for object shapes
- **Use JSDoc comments** for public APIs

```typescript
// Good: Explicit types, JSDoc for public API
/**
 * Creates a new Thing in the Digital Object store
 * @param data - The Thing data including $type
 * @returns The created Thing with generated $id
 */
async function createThing(data: ThingInput): Promise<Thing> {
  // Implementation
}

// Bad: Implicit any, no documentation
async function createThing(data) {
  // Implementation
}
```

### Naming Conventions

- **PascalCase** for classes and types: `DO`, `WorkflowContext`, `ThingStore`
- **camelCase** for functions and variables: `createThing`, `handleRequest`
- **UPPER_SNAKE_CASE** for constants: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT`
- **kebab-case** for file names: `thing-store.ts`, `workflow-context.ts`

### File Organization

```
package-name/
├── src/              # Source code
│   ├── index.ts      # Public API exports
│   ├── types.ts      # TypeScript type definitions
│   └── lib/          # Internal implementation
├── tests/            # Test files (*.test.ts)
├── package.json      # Package configuration
├── tsconfig.json     # TypeScript configuration
└── README.md         # Package documentation
```

### Import Organization

Order imports by category with blank lines between:

```typescript
// 1. Node.js built-ins (none in edge runtime)

// 2. External dependencies
import { Hono } from 'hono'
import { z } from 'zod'

// 3. Workspace packages
import { DO } from '@dotdo/do'
import { createStore } from '@dotdo/db'

// 4. Relative imports
import { ThingStore } from './lib/thing-store'
import type { Thing, ThingInput } from './types'
```

### Worker Architecture Pattern

The worker is a **minimal passthrough** to the DO. All business logic lives in the DO.

```typescript
// api/index.ts - Correct pattern
export { DO } from '../objects/DO'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  }
}

// Bad: Business logic in the worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Don't implement business logic here!
    const data = await processComplexLogic()
    return new Response(JSON.stringify(data))
  }
}
```

**Namespace derivation**: `tenant.api.dotdo.dev` → `DO('tenant')`

### Error Handling

Use structured errors with proper context:

```typescript
// Good: Structured error with context
class ThingNotFoundError extends Error {
  constructor(id: string) {
    super(`Thing not found: ${id}`)
    this.name = 'ThingNotFoundError'
  }
}

// Good: Proper error propagation
async function getThing(id: string): Promise<Thing> {
  const thing = await store.get(id)
  if (!thing) {
    throw new ThingNotFoundError(id)
  }
  return thing
}

// Bad: Silent failures or generic errors
async function getThing(id: string): Promise<Thing | null> {
  return store.get(id) // Returns null, caller doesn't know why
}
```

---

## Testing Guidelines

### Philosophy: NO MOCKS

**Durable Objects require NO MOCKING.** Miniflare runs real DOs with real SQLite locally.

This is a fundamental principle of testing dotdo. Unlike traditional backend testing that requires extensive mocking of databases and external services, Durable Objects can be tested with real instances running in Miniflare.

### Why No Mocks?

1. **Real SQLite** - Miniflare provides actual SQLite storage, not an in-memory mock
2. **Real DO lifecycle** - Full alarm, fetch, and WebSocket support
3. **Real isolation** - Each test gets a clean DO instance
4. **Fast execution** - No container overhead, tests run in milliseconds

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

describe('DO Feature', () => {
  it('should handle requests', async () => {
    // Get real DO instance
    const stub = env.DO.get(env.DO.idFromName('test'))

    // Test via RPC (preferred)
    const result = await stub.things.create({
      $type: 'Customer',
      name: 'Alice'
    })
    expect(result.$id).toBeDefined()
    expect(result.name).toBe('Alice')

    // Test via fetch
    const res = await stub.fetch('https://test.api.dotdo.dev/customers')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.status).toBe('ok')
  })
})
```

### Running Tests

```bash
# Run all tests in watch mode
npm test

# Run all tests once (CI mode)
npm run test:run

# Run single test file
npx vitest run do/tests/DO.test.ts

# Run tests for specific package
npx vitest run do/tests/
npx vitest run api/tests/

# Run with specific runtime configuration
npx vitest --project=objects      # DO tests (real miniflare runtime)
npx vitest --project=workers      # Workers runtime
```

### Test File Naming

- Place tests in `tests/` directory within each package
- Use `.test.ts` suffix: `thing-store.test.ts`
- Mirror source structure: `src/lib/thing-store.ts` → `tests/lib/thing-store.test.ts`

### Testing Patterns

#### Testing CRUD Operations

```typescript
it('should create, read, update, delete Things', async () => {
  const stub = env.DO.get(env.DO.idFromName('crud-test'))

  // Create
  const thing = await stub.things.create({
    $type: 'Task',
    title: 'Write tests',
    status: 'todo'
  })
  expect(thing.$id).toBeDefined()

  // Read
  const fetched = await stub.things.get(thing.$id)
  expect(fetched.title).toBe('Write tests')

  // Update
  const updated = await stub.things.update(thing.$id, { status: 'done' })
  expect(updated.status).toBe('done')

  // Delete
  await stub.things.delete(thing.$id)
  const deleted = await stub.things.get(thing.$id)
  expect(deleted).toBeNull()
})
```

#### Testing Event Handlers

```typescript
it('should handle events with $ context', async () => {
  const stub = env.DO.get(env.DO.idFromName('event-test'))

  // Register handler via RPC
  await stub.registerHandler('Customer.signup', async (event) => {
    await stub.things.create({
      $type: 'WelcomeEmail',
      to: event.email,
      status: 'sent'
    })
  })

  // Trigger event
  await stub.$.send({ type: 'Customer.signup', email: 'test@example.com' })

  // Verify side effects
  const emails = await stub.things.query({ $type: 'WelcomeEmail' })
  expect(emails).toHaveLength(1)
  expect(emails[0].to).toBe('test@example.com')
})
```

#### Testing Storage Architecture

```typescript
it('should handle Pipeline-as-WAL correctly', async () => {
  const stub = env.DO.get(env.DO.idFromName('wal-test'))

  // Write should ACK immediately (before SQLite checkpoint)
  const startTime = Date.now()
  await stub.things.create({ $type: 'Test', data: 'value' })
  const duration = Date.now() - startTime

  // Should be fast (Pipeline ACK, not waiting for SQLite)
  expect(duration).toBeLessThan(50)

  // Read from in-memory state (O(1) lookup)
  const thing = await stub.things.query({ $type: 'Test' })
  expect(thing[0].data).toBe('value')
})
```

### Code Coverage

Code coverage is tracked automatically in CI using [Codecov](https://codecov.io). Coverage reports help identify untested code paths and maintain test quality.

#### Coverage Configuration

Coverage is configured in each vitest.config.ts with these thresholds:

| Metric | Threshold |
|--------|-----------|
| Statements | 65% |
| Branches | 60% |
| Functions | 60% |
| Lines | 65% |

**Builds will fail if coverage drops below these thresholds.**

#### Running Coverage Locally

```bash
# Run tests with coverage (root-level Node tests)
npm run test:coverage

# Run coverage for specific packages
npm run test:coverage:do      # Durable Object tests
npm run test:coverage:db      # Database tests
npm run test:coverage:api     # API tests
npm run test:coverage:mcp     # MCP tools tests

# Run all coverage reports
npm run test:coverage:all
```

#### Coverage Reports

After running coverage, reports are generated in the `coverage/` directory:

- **Text**: Console summary output
- **HTML**: Open `coverage/index.html` in a browser for detailed interactive report
- **JSON**: Machine-readable `coverage/coverage-final.json`
- **LCOV**: `coverage/lcov.info` for CI integration with Codecov

#### Coverage Goals

- **Unit tests**: All core utilities and helpers
- **Integration tests**: DO lifecycle, RPC communication, storage operations
- **E2E tests**: Full request/response cycles with real Workers

Aim for >80% coverage on core packages, but focus on meaningful tests over coverage metrics.

#### Best Practices

1. **Write tests before code** (TDD) - ensures coverage is built-in
2. **Test edge cases** - branches and error paths matter
3. **Don't chase 100%** - some code (like catch blocks for impossible errors) doesn't need coverage
4. **Review uncovered lines** - understand why code isn't covered before ignoring it

---

## Pull Request Process

### Before Submitting

1. **Check for open issues**: `bd ready` to find available work
2. **Claim an issue**: `bd update <id> --status=in_progress`
3. **Create a branch**: Use descriptive names like `feat/add-thing-store` or `fix/event-handler-race`

```bash
# Example workflow
bd ready                                    # Find work
bd update do-7rf.5 --status=in_progress     # Claim task
git checkout -b feat/add-rpc-timeout        # Create branch
```

### Making Changes

1. **Write tests first** (TDD approach preferred)
2. **Implement the feature**
3. **Update documentation** if adding public APIs
4. **Run type checking**: `npm run typecheck`
5. **Run tests**: `npm test`
6. **Verify build**: `npm run build`

### Commit Messages

Use conventional commits format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `test`: Adding or updating tests
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `chore`: Build process or auxiliary tool changes

**Examples:**

```bash
git commit -m "feat(do): add WorkflowContext $ proxy for events"
git commit -m "fix(rpc): resolve promise pipelining race condition"
git commit -m "docs(contributing): add testing guidelines section"
git commit -m "test(db): add comprehensive Thing CRUD tests"
```

### Submitting PR

```bash
# Ensure all tests pass
npm run test:run

# Type check
npm run typecheck

# Close the issue
bd close do-7rf.5

# Sync beads
bd sync

# Stage and commit
git add -A
git commit -m "feat(rpc): add timeout configuration for RPC calls"

# Push to remote
git push origin feat/add-rpc-timeout
```

**CRITICAL**: Work is NOT complete until `git push` succeeds. Never stop before pushing.

### PR Template

When creating a PR, include:

```markdown
## Description
Brief description of the change and which issue it addresses.

Closes: do-7rf.5

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
- [ ] All existing tests pass
- [ ] New tests added to cover changes
- [ ] Tested in miniflare (local)
- [ ] Tested in real Workers environment

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated (if needed)
- [ ] No new warnings in typecheck
- [ ] Beads issue closed and synced
```

---

## Issue Tracking with Beads

We use [beads](https://github.com/nathanclevenger/beads) for hierarchical issue tracking.

### Hierarchical Structure

Beads uses **hierarchical IDs** for epic → task → subtask structure:

```
do-7rf           [P0] [epic]  - dotdo v3 Architecture
├── do-7rf.1     [P1] [task]  - @dotdo/rpc - Cap'n Web RPC
│   ├── do-7rf.1.1            - Client implementation
│   ├── do-7rf.1.2            - Server implementation
│   └── do-7rf.1.3            - Transport layers
├── do-7rf.2     [P1] [task]  - @dotdo/db - Storage Layer
├── do-7rf.3     [P1] [task]  - @dotdo/do - Durable Object
└── do-7rf.4     [P1] [task]  - @dotdo/api - Hono API
```

### Creating Issues

```bash
# Create epic
bd create --type=epic --title="Feature X" --priority=0

# Create task under epic (auto-generates do-xxx.1)
bd create --type=task --parent=do-xxx --title="Implement API endpoints"

# Create subtask (auto-generates do-xxx.1.1)
bd create --type=task --parent=do-xxx.1 --title="Add POST /things endpoint"
```

### Common Commands

```bash
# Find available work (no blockers, not in progress)
bd ready

# List all open issues
bd list --status=open

# Show issue details with full hierarchy
bd show <id>

# Claim an issue (mark as in progress)
bd update <id> --status=in_progress

# Close an issue when work is complete
bd close <id>

# Close multiple issues at once
bd close <id1> <id2> <id3>

# Sync with git (keep beads database in sync)
bd sync
```

### Workflow

1. **Find work**: `bd ready` shows issues ready to be worked on
2. **Claim work**: `bd update <id> --status=in_progress`
3. **Do the work**: Implement, test, document
4. **Close issue**: `bd close <id>`
5. **Sync**: `bd sync` to update beads database
6. **Commit**: `git add -A && git commit -m "..."`
7. **Push**: `git push` (REQUIRED - work is not done until pushed)

### Priority Levels

- **P0**: Critical/Epic - Major features or critical bugs
- **P1**: High - Important features or serious bugs
- **P2**: Medium - Standard features or moderate bugs
- **P3**: Low - Nice-to-have features or minor bugs

---

## Package Structure

dotdo is organized as a monorepo with npm workspaces:

```
dotdo/                    # Main package - re-exports all modules
├── api/                  # @dotdo/api - Hono worker with HATEOAS
├── do/                   # @dotdo/do - THE Durable Object class
├── db/                   # @dotdo/db - Abstract storage layer
├── rpc/                  # @dotdo/rpc - Cap'n Web RPC
├── ai/                   # @dotdo/ai - AI routing with template literals
├── auth/                 # @dotdo/auth - JWT auth with jose
├── mcp/                  # @dotdo/mcp - Model Context Protocol tools
├── app/                  # @dotdo/app - TanStack Start frontend
└── primitives/           # Git submodule → primitives.org.ai
```

### Creating a New Package

1. **Create package directory**: `mkdir -p packages/new-package/src`
2. **Add package.json**:

```json
{
  "name": "@dotdo/new-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "dev": "tsc --watch",
    "build": "tsc",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@dotdo/do": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

3. **Add tsconfig.json**:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

4. **Create src/index.ts** with public exports
5. **Add to root package.json workspaces** (if not using wildcard)
6. **Run `npm install`** to link workspace packages

### Package Dependencies

Follow the dependency graph to avoid circular dependencies:

```
         dotdo (main)
            ↓
    ┌───────┴───────┐
    ↓               ↓
  @dotdo/api    @dotdo/mcp
    ↓               ↓
  @dotdo/do ←───────┘
    ↓
┌───┴────┐
↓        ↓
@dotdo/db  @dotdo/rpc
```

**Rules:**
- `@dotdo/db` and `@dotdo/rpc` have NO internal dependencies (leaf packages)
- `@dotdo/do` depends on `@dotdo/db` and `@dotdo/rpc`
- `@dotdo/api` and `@dotdo/mcp` depend on `@dotdo/do`
- Main `dotdo` package depends on everything

---

## Process Management

### Vitest/Vite Memory Management

**Vitest and Vite can consume significant memory.** Follow these guidelines:

1. **Never run multiple vitest instances in parallel**
   - Running tests in multiple terminals can cause memory issues
   - Use `npx vitest run` (not watch mode) for CI/automated testing

2. **Kill orphaned processes**:
   ```bash
   pkill -9 -f vitest
   pkill -9 -f vite
   ```

3. **For subagents**: Run ONE test file at a time
   ```bash
   npx vitest run path/to/single-test.test.ts
   ```

4. **Monitor memory usage**:
   ```bash
   # macOS
   top -o MEM

   # Linux
   htop
   ```

### Development Server Management

If you encounter port conflicts or stale processes:

```bash
# Find process using port 8787 (default Wrangler port)
lsof -i :8787

# Kill specific process
kill -9 <PID>

# Or kill all node processes (nuclear option)
pkill -9 node
```

---

## Session Close Protocol

**NEVER end a development session without completing these steps:**

```bash
# 1. Sync beads database
bd sync

# 2. Check git status
git status

# 3. Stage all changes
git add -A

# 4. Commit with descriptive message
git commit -m "feat(package): description of changes"

# 5. Push to remote (CRITICAL - work is NOT done until pushed)
git push
```

### Critical Rules

- **Work is NOT complete until `git push` succeeds**
- **NEVER stop before pushing** - that leaves work stranded locally
- **NEVER say "ready to push when you are"** - YOU must push
- **If push fails, resolve and retry until it succeeds**

### Note on Current Branch

The current branch (`v3`) is an ephemeral worktree branch. Always check which branch you're on before pushing:

```bash
git branch  # Should show v3 or your feature branch
```

---

## Additional Resources

- **[README.md](./README.md)** - Project overview and quick start
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Deep dive into system design
- **[CLAUDE.md](./CLAUDE.md)** - Guidance for Claude Code AI assistant
- **[v1 Reference](./.worktrees/v1/README.md)** - Previous implementation docs

---

## Getting Help

- **Questions & Help**: [Open an issue](https://github.com/dot-do/dotdo/issues/new)
- **Bug Reports**: [Open a bug report](https://github.com/dot-do/dotdo/issues/new?template=bug_report.yml)
- **Feature Requests**: [Open a feature request](https://github.com/dot-do/dotdo/issues/new?template=feature_request.yml)
- **Security Issues**: [security@dotdo.dev](mailto:security@dotdo.dev) (do not open public issues)

---

## License

By contributing to dotdo, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to dotdo!** Your work helps build the missing Node.js for the edge.
