# dotdo Naming Conventions

> This document establishes naming conventions for the dotdo codebase to ensure consistency across all modules.

## 1. Interface/Type Suffixes

### Config vs Options

| Suffix | When to Use | Examples |
|--------|-------------|----------|
| `Config` | **Stored/persistent** configuration that defines behavior | `RetryConfig`, `CacheConfig`, `McpConfig` |
| `Options` | **Runtime parameters** passed to functions/methods | `CreateOptions`, `ForEachOptions`, `ExecOptions` |

```typescript
// CORRECT: Config is stored/persistent
interface RetryConfig {
  maxAttempts: number
  backoffMs: number
}

// CORRECT: Options are runtime parameters
interface CreateOptions {
  cascade?: boolean
  maxDepth?: number
}

// WRONG: Don't mix them
interface QueryConfig { limit?: number }  // Should be QueryOptions
```

### Result vs Response

| Suffix | When to Use | Examples |
|--------|-------------|----------|
| `Response` | **HTTP/network** responses | `JsonRpcResponse`, `McpToolResult` (HTTP context) |
| `Result` | **Operation outcomes** (success/failure) | `ExecutionResult`, `ValidationResult` |

```typescript
// CORRECT: HTTP context
interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JsonRpcError
}

// CORRECT: Operation outcome
interface ExecutionResult<T> {
  success: boolean
  data?: T
  error?: Error
}
```

### Data vs Record

| Suffix | When to Use | Examples |
|--------|-------------|----------|
| `Data` | **Stored fields** without computed properties | `ThingData`, `EventData`, `CollectionData` |
| `Record` | **Database row** with ID and timestamps | `EntityRecord` (legacy, prefer `Data`) |

**Decision**: Prefer `Data` suffix. `EntityRecord` is kept for backward compatibility in Entity.ts.

## 2. Entity Naming

### Thing vs Entity

| Name | Meaning | Location |
|------|---------|----------|
| `Thing` | **Graph node** in the unified data model (types/Thing.ts) | Core type system |
| `Entity` | **Domain object** class with schema validation (objects/Entity.ts) | DO class |
| `EntityRecord` | **Legacy**: Row returned by Entity CRUD operations | Entity.ts only |

**Relationship**: An `Entity` stores records that become `Thing` instances in the graph.

## 3. Generic Type Parameters

Use descriptive prefixes for clarity:

| Pattern | When to Use | Examples |
|---------|-------------|----------|
| `T` | Single generic (common) | `Promise<T>`, `Array<T>` |
| `TKey`, `TValue` | Map-like structures | `Map<TKey, TValue>` |
| `TInput`, `TOutput` | Function I/O | `Fn<TOutput, TInput>` |
| `TPayload` | Event/message data | `emit<TPayload>(event)` |
| `TResult` | Return type context | `AgenticExecutionResult<TResult>` |

**Note**: Current codebase uses `Out, In` in some places. Standardize to `TOutput, TInput` for new code.

## 4. Class Naming

### DO Classes

| Current | Status | Notes |
|---------|--------|-------|
| `DO` | Keep | Base Durable Object class |
| `DOBase` | Keep | Extended base with stores |
| `DOTiny` | Keep | Minimal DO variant |
| `DOFull` | Keep | Full-featured DO |
| `Worker` | Keep | DO for task execution |
| `Entity` | Keep | Domain object container |
| `Workflow` | Keep | Workflow orchestration |

The `Worker` class intentionally shadows the Web Workers API - this is by design as dotdo Workers ARE Durable Object Workers, not Web Workers.

### Store/Service Classes

| Pattern | When to Use | Examples |
|---------|-------------|----------|
| `*Store` | Data persistence layer | `ThingsStore`, `WorkerStore`, `RelationshipStore` |
| `*Service` | Business logic layer | `HumanGraphService`, `NotificationService` |
| `*Adapter` | External integration | `WorkersAIAdapter`, `StripeAdapter` |
| `*Provider` | Implementation of interface | `EmbeddingProvider`, `LLMProvider` |

## 5. Store Property Abbreviations

Full names are preferred for public APIs:

| Abbreviated | Full Name | Usage |
|-------------|-----------|-------|
| `rels` | `relationships` | Internal only, use full in public APIs |
| `dlq` | `deadLetterQueue` | Use full name |

## 6. Method Naming

### CRUD Methods

| Operation | Standard Names |
|-----------|---------------|
| Create | `create()`, `add()`, `insert()` |
| Read | `get()`, `find()`, `list()`, `query()` |
| Update | `update()`, `patch()`, `set()` |
| Delete | `delete()`, `remove()` |

### Event Emission

```typescript
// Standard pattern
$.on.Customer.signup(handler)  // Handler registration
$.emit('Customer.signup', data)  // Event emission

// Alternative (both valid)
emit('Customer', 'signup', data)  // Two-arg form
```

## 7. File Naming

| Type | Convention | Examples |
|------|------------|----------|
| Classes | PascalCase | `Entity.ts`, `WorkflowRuntime.ts` |
| Utilities | kebab-case | `type-guards.ts`, `parse-error.ts` |
| Tests | `*.test.ts` or `*.spec.ts` | `entity.test.ts` |
| Type definitions | `*.d.ts` | `optional-deps.d.ts` |
| Index exports | `index.ts` | `index.ts` |

## 8. Module Organization

```
module/
  index.ts          # Public exports
  types.ts          # Type definitions
  constants.ts      # Constants and enums
  utils.ts          # Utility functions
  errors.ts         # Error classes
  tests/            # Test files
    module.test.ts
```

## 9. Scheduling Syntax

Multiple syntaxes exist for historical reasons:

```typescript
// Property access (preferred for common intervals)
$.every.Monday.at9am(handler)
$.every.day.at('6pm')(handler)

// Natural language (for complex schedules)
$.every('5 minutes', handler)
$.every('first Monday of month', handler)
```

## 10. Import Organization

```typescript
// 1. External packages
import { z } from 'zod'
import type { DurableObjectState } from '@cloudflare/workers-types'

// 2. Internal types
import type { Thing, ThingData } from '../types/Thing'

// 3. Internal modules
import { DO, Env } from './DO'
import { validate } from './utils'

// 4. Relative imports
import { helper } from './helper'
```

## Migration Notes

### Breaking Changes to Avoid

1. **EntityRecord**: Keep for backward compatibility, but prefer `ThingData` for new code
2. **Worker class**: Intentionally shadows Web Workers - this is by design
3. **Config/Options**: Existing uses are grandfathered, apply conventions to new code

### Enforcement

See `/internal/naming-conventions-eslint.md` for ESLint rules to enforce these conventions.

---

*Last updated: 2026-01-13*
*Epic: dotdo-yw0ra - Standardize naming conventions across codebase*
