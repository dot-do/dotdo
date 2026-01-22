# Package Boundaries

This document defines the package dependency rules for the dotdo monorepo. These rules are enforced by ESLint using `eslint-plugin-import` and TypeScript project references.

## Package Layering

The dotdo monorepo follows a strict layering architecture where packages can only depend on packages in lower layers.

```
                    +-----------+
          Layer 4   |   dotdo   |  (CLI + re-exports all)
                    +-----------+
                          |
          +---------------+---------------+
          |               |               |
     +---------+    +---------+    +---------+
L3   |   api   |    |   mcp   |    |   app   |
     +---------+    +---------+    +---------+
          |               |               |
          +-------+-------+-------+-------+
                  |               |
             +---------+    +--------------+
Layer 2      |   do    |    | integrations |
             +---------+    +--------------+
                  |
     +------------+------------+
     |            |            |
+--------+  +---------+  +--------+
| Layer 1|  |   rpc   |  |  auth  |
+--------+  +---------+  +--------+
     |
+--------+   +--------------+   +--------+
|   db   |   | observability|   |   ai   |
+--------+   +--------------+   +--------+
             Layer 0 (Foundation)
```

## Dependency Rules

### Layer 0 - Foundation (No internal dependencies)

These packages have NO dependencies on other workspace packages:

| Package | Purpose | External Deps |
|---------|---------|---------------|
| `@dotdo/db` | Abstract storage layer | None |
| `@dotdo/ai` | AI routing with template literals | hono, js-tiktoken |
| `@dotdo/observability` | Logging, tracing, metrics | hono |

### Layer 1 - Core Services

| Package | Can Depend On | Purpose |
|---------|---------------|---------|
| `@dotdo/rpc` | None (external only) | Cap'n Web RPC transport |
| `@dotdo/auth` | `@dotdo/observability` (optional) | JWT auth with jose |

**Note:** `@dotdo/rpc` currently has some imports from `@dotdo/db` for error types - these should be extracted to a shared types package.

### Layer 2 - Domain Layer

| Package | Can Depend On | Purpose |
|---------|---------------|---------|
| `@dotdo/do` | `@dotdo/db`, `@dotdo/rpc`, `@dotdo/auth`, `@dotdo/observability`, `@dotdo/integrations` | THE Durable Object |
| `@dotdo/integrations` | `@dotdo/db` (optional) | Third-party integration registry |

### Layer 3 - Application Layer

| Package | Can Depend On | Purpose |
|---------|---------------|---------|
| `@dotdo/api` | `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc`, `@dotdo/auth`, `@dotdo/observability` | Hono API with HATEOAS |
| `@dotdo/mcp` | `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc` | Model Context Protocol tools |
| `@dotdo/app` | `@dotdo/api`, `@dotdo/auth` | TanStack Start frontend |

### Layer 4 - Distribution

| Package | Can Depend On | Purpose |
|---------|---------------|---------|
| `dotdo` | ALL packages | Main CLI + re-exports |

## Import Rules

### Allowed Imports

1. **Workspace package imports** (preferred):
   ```typescript
   import { createThingsStore } from '@dotdo/db'
   import { createServer } from '@dotdo/rpc'
   ```

2. **Relative imports within the same package**:
   ```typescript
   // In db/things.ts
   import { generateId } from './id'
   import type { StorageAdapter } from './storage'
   ```

### Forbidden Imports

1. **Cross-package relative imports**:
   ```typescript
   // FORBIDDEN - do not use relative paths to other packages
   import { createThingsStore } from '../../db'  // BAD - use '@dotdo/db'
   import { RPCError } from '../../rpc/errors'   // BAD - use '@dotdo/rpc'
   ```

2. **Upward layer dependencies**:
   ```typescript
   // FORBIDDEN - lower layers cannot depend on higher layers
   // In @dotdo/db (Layer 0):
   import { DO } from '@dotdo/do'  // BAD - db cannot depend on do
   ```

3. **Circular dependencies**:
   ```typescript
   // FORBIDDEN - no circular dependencies between packages
   // @dotdo/rpc depends on @dotdo/db AND @dotdo/db depends on @dotdo/rpc = BAD
   ```

## Utility Packages

The following packages are special utilities available at all layers:

| Package | Purpose | Available To |
|---------|---------|--------------|
| `@dotdo/utils` | Shared utilities (logger, etc.) | All packages |
| `@dotdo/test-utils` | Testing utilities | All packages (devDependencies only) |
| `@dotdo/testing` | Integration testing | All packages (devDependencies only) |

## Primitives Submodule

The `primitives/` directory is a git submodule containing AI primitives. These are considered external dependencies:

```typescript
// Import from primitives using workspace paths
import { evaluate } from 'ai-evaluate'
import { DigitalWorker } from 'digital-workers'
```

Primitives packages:
- `ai-evaluate` - AI evaluation harness
- `ai-functions` - Type-safe AI function calling
- `ai-workflows` - AI workflow orchestration
- `digital-objects` - Digital object abstractions
- `digital-workers` - Worker abstractions
- `language-models` - LLM provider abstractions
- `id.org.ai` - Identity primitives

## Current Violations

The following cross-package imports need to be refactored:

### @dotdo/do
- Imports `../../db` - should use `@dotdo/db`
- Imports `../../rpc/errors` - should use `@dotdo/rpc`
- Imports `../../utils/logger` - should use `@dotdo/utils` or inline

### @dotdo/rpc
- Imports `../../db/errors` - error types should be in `@dotdo/rpc` or shared
- Imports `../../do/utils/proxy` - proxy utils should be in `@dotdo/utils`
- Imports `../../do/circuit-breaker` - should be in `@dotdo/rpc`

### @dotdo/mcp
- Imports `../../db/things` - should use `@dotdo/db`
- Imports `../../do/context` - should use `@dotdo/do`

### @dotdo/auth
- Imports `../../utils/logger` - should use `@dotdo/utils`
- Imports `../primitives/` - should use workspace protocol

### @dotdo/ai
- Imports `../do/` - AI should not depend on DO

## Enforcement

Package boundaries are enforced by:

1. **ESLint** - `eslint-plugin-import` with `import/no-relative-packages` rule
2. **TypeScript** - Project references in `tsconfig.json`
3. **Pre-commit hooks** - Runs ESLint on staged files

### Running Checks

```bash
# Check for boundary violations
npm run lint

# Fix auto-fixable violations
npm run lint -- --fix
```

## Adding New Packages

When adding a new package:

1. Determine which layer it belongs to
2. Add workspace dependencies only to allowed packages
3. Update this document with the new package
4. Run `npm run lint` to verify no violations
