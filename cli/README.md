# dotdo CLI

A TypeScript REPL with IDE-quality autocomplete that runs inside Durable Objects via Cap'n Web RPC.

## Architecture

### Core Insight: `this === $ === globalThis`

Inside the DO isolate, everything shares the same capability tree:
- `this.Customer` === `$.Customer` === `Customer` (on globalThis)
- Enables clean AI-generated code without framework boilerplate
- PipelinedStub Proxy captures property/method chains

```
User Input: Customer.get("c-123").notify("hi")
     ↓
globalThis.Customer → PipelinedStub starts
     ↓
Pipeline: [method:Customer("c-123"), method:notify("hi")]
     ↓
await → ai-evaluate({ script, sdk: { rpcUrl } })
     ↓
DO isolate executes against real state
     ↓
Result streams back to REPL
```

### Promise Pipelining

Every `.` builds a pipeline - no round trips until `await`:

```typescript
// All captured in one pipeline, sent as single RPC
const orders = await Customer.get("c-123").orders.list()
```

## Components

| File | Purpose |
|------|---------|
| `src/completions.ts` | TypeScript Language Service via @typescript/vfs |
| `src/repl.tsx` | Ink-based REPL UI component |
| `src/rpc-client.ts` | Cap'n Web RPC client with pipelining |
| `src/components/` | Ink UI components (Input, Output, CompletionList) |
| `src/types/` | TypeScript type definitions |

## Autocomplete

Uses `@typescript/vfs` for in-memory TypeScript Language Service:

```
User types: Customer.g|
     ↓
@typescript/vfs with virtual files:
  - /repl.ts (user input)
  - /lib/core.d.ts ($ context types)
  - /lib/rpc-types.d.ts (from DO schema)
  - /lib/globals.d.ts (flat namespace - Customer, Order, etc.)
     ↓
languageService.getCompletionsAtPosition()
     ↓
Ink Select dropdown
```

### `.` Trigger

Completions trigger on `.` character (not just Tab):
- `$.` → WorkflowContext methods
- `Customer.` → Customer instance methods
- `.get("id").` → return type methods

## Type Generation

Types are pulled from connected DO and written to virtual FS:

```typescript
// Generated from DO schema introspection
interface Customer {
  $id: string
  name: string
  email: string
  orders: () => Promise<Order[]>
  charge: (amount: number) => Promise<Receipt>
}

// Flat namespace - available without $ prefix
declare const Customer: DOProxy<Customer>
declare const Order: DOProxy<Order>
declare const on: EventHandlerProxy
declare const every: ScheduleBuilder
```

## Time Travel

Access historical state using `@` notation:

```typescript
// Version-based
$.checkout('@v1234')      // Specific version (rowid)
$.checkout('@~1')         // One version back

// Time-based
$.checkout('@2024-01-15') // ISO 8601 timestamp

// Branch-based
$.checkout('@main')       // Branch name
$.checkout('@experiment') // Feature branch

// Address format
Customer.get("c-123@v1234")     // Customer at specific version
Customer.get("c-123@~1")        // Previous version
Customer.get("c-123@2024-01-15") // Point in time
```

## Security

Code executes in secure V8 isolate via `ai-evaluate`:
- Cloudflare `worker_loaders` in production
- Miniflare sandbox in development
- No filesystem access
- Network controlled by capability

## Usage

```bash
# Development
npm run dev

# Build
npm run build

# Test
npm test

# Run REPL
npx dotdo
```

## Configuration

Connect to a DO by URL or namespace:

```bash
# By URL
dotdo --endpoint wss://acme.api.dotdo.dev

# By namespace (derives URL)
dotdo acme

# With auth
dotdo acme --token $DOTDO_TOKEN
```

## Implementation Status

### Completed ✓
- [x] CompletionEngine with @typescript/vfs
- [x] Core `$` context types (send, try, do, on, every)
- [x] Type definitions update from RPC schema
- [x] Basic Ink REPL UI
- [x] RPC client foundation

### In Progress
- [ ] globalThis === $ (flat namespace for Nouns)
- [ ] `.` trigger for completions (vs Tab only)
- [ ] ai-evaluate integration (replace Function constructor)
- [ ] PipelinedStub integration for promise pipelining
- [ ] Time travel `@` type definitions
- [ ] Streaming output support
- [ ] History persistence

### Future
- [ ] Multi-line editing
- [ ] Syntax highlighting (pretty-repl)
- [ ] Admin mode (functions, workflows, users, orgs)
- [ ] Offline mode with cached types

## Dependencies

```json
{
  "@typescript/vfs": "^1.6.0",  // In-memory TS Language Service
  "ink": "^5.0.1",              // React for terminals
  "@inkjs/ui": "^2.0.0",        // UI components
  "typescript": "^5.7.3",       // TS compiler
  "ws": "^8.18.0"               // WebSocket for RPC
}
```

## Related

- [ai-evaluate](../ai/primitives/packages/ai-evaluate/) - Secure code evaluation
- [rpc/](../rpc/) - Cap'n Web RPC layer
- [objects/lifecycle/Branch.ts](../objects/lifecycle/Branch.ts) - Time travel `@` checkout
