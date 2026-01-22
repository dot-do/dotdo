# @dotdo/do

THE Durable Object for Digital Objects.

**DO** = **D**urable **O**bject = **D**igital **O**bject

## Built-in Entities

- Nouns, Verbs, Things, Actions, Relationships
- Events, Functions, Workflows
- Integrations, Connections
- Orgs, Users, API Keys
- Analytics

## $ Context

```typescript
// Event handlers
$.on.Customer.signup(async (event) => {
  await $.send({ type: 'welcome-email', to: event.email })
})

// Scheduling
$.every.Monday.at('9am')(async () => {
  await generateWeeklyReport()
})

// Cross-DO RPC - call methods on other DOs
await $.Order('order-123').ship()
const balance = await $.Customer('user-456').getBalance()
await $.Worker('processor-1').run('batch-process', { size: 100 })
```

### Cross-DO RPC

Call methods on other Durable Objects via type-safe RPC:

```typescript
// In your DO class
export class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.$ = createContext(state, env)
  }

  async handleOrder(orderId: string) {
    // Call remote DO methods
    const customer = await $.Customer('user-123').get()
    const inventory = await $.Inventory('sku-456').check()

    if (inventory.available > 0) {
      await $.Order(orderId).confirm()
      await $.Customer('user-123').notify({ message: 'Order confirmed!' })
    }
  }
}
```

**Features:**
- Type-safe method calls with TypeScript inference
- Automatic stub caching (same ID = same stub instance)
- Works seamlessly with `$.do()` for retries
- Error propagation with stack traces
- Concurrent calls to multiple DOs

**Requirements:**
- DO bindings must be configured in `wrangler.toml`
- Method calls use fetch-based RPC under the hood
- All methods must return serializable values (JSON)

## Status

See beads issues do-7rf.6.* for implementation progress.
