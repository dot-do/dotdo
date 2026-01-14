# @dotdo/core Design

> Foundational DO runtime package to resolve circular dependencies

## Problem

dotdo has circular dependency issues:
- `@dotdo/fsx`, `@dotdo/gitx`, `@mdxui/do` need base DO class
- But dotdo depends on these packages for capabilities

## Solution

Extract foundational runtime into `@dotdo/core`:

```
                          dotdo (full DO)
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
    ┌──────────┐         ┌──────────┐         ┌──────────┐
    │ @dotdo/  │         │ @dotdo/  │         │ @mdxui/  │
    │   fsx    │         │   gitx   │         │    do    │
    └────┬─────┘         └────┬─────┘         └────┬─────┘
         └────────────────────┼────────────────────┘
                              ▼
                       ┌─────────────┐
                       │ @dotdo/core │
                       └──────┬──────┘
                              │
               ┌──────────────┼──────────────┐
               ▼                             ▼
        ┌─────────────┐               ┌─────────────┐
        │ ai-database │               │ @org.ai/    │
        │  (DB() DSL) │               │   types     │
        └─────────────┘               └─────────────┘
```

## Package Structure

```
core/
├── index.ts           # Main exports
├── DO.ts              # Minimal DO base (SQLite + optional identity)
├── DB.ts              # Schema extension API (wraps ai-database)
├── context.ts         # WorkflowContext ($)
├── rpc/
│   ├── target.ts      # Cap'n Web RPC target
│   ├── router.ts      # REST router
│   └── client.ts      # RPC client
└── package.json
```

## Key Design Decisions

### 1. Minimal DO Base

The core DO class provides:
- SQLite/Drizzle integration
- Optional identity (`ns`) - parent DO can handle this
- Schema extension API: `DO.with(schema)`
- No stores - those stay in `db/stores/` in dotdo

### 2. Schema Extension API

Three paths to storage:

```typescript
// Path 1: DB() AI-native syntax (from ai-database)
const schema = DB({
  Customer: {
    name: 'string',
    '-> orders': 'Order[]',      // Forward exact - create children
    '~> similar': 'Customer[]',  // Forward fuzzy - find or create
    '<- referredBy': 'Customer', // Backward exact - aggregation
    '<~ industry': 'Industry',   // Backward fuzzy - ground to reference
  }
})
class MyDO extends DO.with(schema) { }

// Path 2: Zod schema
class MyDO extends DO.with(customerZodSchema)

// Path 3: Drizzle direct
class MyDO extends DO.withDrizzle(drizzleSchema)
```

### 3. Relationship Operators (from ai-database)

| Operator | Direction | Match Mode | When to Use |
|----------|-----------|------------|-------------|
| `->` | forward | exact | Creating child entities |
| `~>` | forward | fuzzy | Reusing existing entities |
| `<-` | backward | exact | Aggregation queries |
| `<~` | backward | fuzzy | Grounding against reference data |

### 4. WorkflowContext ($)

Event-driven programming with durability levels:

```typescript
// Events
$.track(event)          // Fire-and-forget telemetry
$.send(event)           // Durable with EventId

// Actions
$.try(action)           // Single attempt
$.do(action)            // Durable with retries

// Handlers
$.on.Customer.signup(handler)
$.every.Monday.at9am(handler)
```

### 5. Type Foundation

Types live in `@org.ai/types`:
- Thing, Noun, Verb
- Relationship operators
- Field types
- Event schema (5W+H)
- ID types (ThingId, ActionId, EventId)

The `org.ai` umbrella re-exports for concise imports:
```typescript
import { Thing, Noun, DB } from 'org.ai'
```

## What Stays in dotdo

- Concrete stores (`db/stores/`)
- DOFull lifecycle features (fork, clone, compact, branch)
- Higher-order DOs (Startup, Business, SaaS, Agent)
- Advanced features (sharding, analytics, etc.)

## Related Issues

- **dotdo**: Epic `do-7aw` - @dotdo/core implementation
- **primitives.org.ai**: Epic `aip-rcov` - @org.ai/types expansion

## Implementation Order

1. `do-7aw.1`: Create core/ directory structure
2. `do-7aw.2`: Extract minimal DO base class
3. `do-7aw.3`: Extract WorkflowContext ($)
4. `do-7aw.4`: Extract RPC layer
5. `do-7aw.5`: Create DB() schema wrapper
6. `do-7aw.6`: Refactor dotdo to use @dotdo/core
