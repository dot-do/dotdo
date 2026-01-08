# ai-workflows: Capnweb-Inspired Promise Pipelining

## The Problem with Current Design

```typescript
// Current: Requires async/await everywhere
const OrderWorkflow = Workflow('order', async ($, order) => {
  const inventory = await $.Inventory(order.product).check()
  const [crm, billing] = await Promise.all([...])
  return { id: payment.id }  // Can't do this without await!
})
```

## The Solution: PipelinePromise

Inspired by [capnweb](https://github.com/cloudflare/capnweb), we use **lazy pipeline expressions** that:
1. Capture operations without executing them
2. Allow property access on unresolved values
3. Support magic `.map()` via record-replay
4. Batch independent operations automatically

```typescript
// New: No async, no await, no Promise.all
const OrderWorkflow = Workflow('order', ($, order) => {
  const inventory = $.Inventory(order.product).check()
  const crm = $.CRM(customer).createAccount()
  const billing = $.Billing(customer).setupSubscription()

  // Property access on unresolved values WORKS
  $.Email(customer).sendWelcome({
    crmId: crm.id,           // PipelinePromise capturing ["CRM", "createAccount", "id"]
    portalUrl: billing.portalUrl
  })

  return { customerId: customer.id, crmId: crm.id }
})
```

## Core Concepts

### 1. PipelinePromise

A **PipelinePromise<T>** is simultaneously:
- A **Thenable** (can be awaited for compatibility)
- A **Proxy** (property access returns another PipelinePromise)
- A **Pipeline Expression** (captures the operation for later execution)

```typescript
interface PipelinePromise<T> extends PromiseLike<T> {
  // Property access extends the pipeline
  [key: string]: PipelinePromise<any>

  // Method calls create new pipeline expressions
  [method: string]: (...args: any[]) => PipelinePromise<any>

  // Magic map with record-replay
  map<U>(fn: (item: T[number]) => PipelinePromise<U>): PipelinePromise<U[]>

  // Internal: the captured expression
  readonly __expr: PipelineExpression
}
```

### 2. Pipeline Expression

The underlying data structure capturing what should happen:

```typescript
type PipelineExpression =
  | { type: 'call', domain: string, method: string[], context: unknown, args: unknown[] }
  | { type: 'property', base: PipelineExpression, property: string }
  | { type: 'map', array: PipelineExpression, mapper: MapperInstruction[] }
```

### 3. Deferred Execution

Nothing executes until the workflow engine processes it:

```typescript
// Workflow function runs SYNCHRONOUSLY
const result = workflowFn($, input)

// Result contains PipelinePromises with captured expressions
// Engine analyzes dependencies and batches execution
const resolved = await engine.resolve(result)
```

## How Property Access Works

```typescript
const crm = $.CRM(customer).createAccount()
// crm.__expr = { type: 'call', domain: 'CRM', method: ['createAccount'], context: customer, args: [] }

const crmId = crm.id
// crmId.__expr = { type: 'property', base: crm.__expr, property: 'id' }

const nested = crm.account.settings.theme
// nested.__expr = {
//   type: 'property',
//   base: { type: 'property', base: { type: 'property', base: crm.__expr, property: 'account' }, property: 'settings' },
//   property: 'theme'
// }
```

## How Magic Map Works (Record-Replay)

```typescript
const items = $.Cart(cart).getItems()
const checked = items.map(item => $.Inventory(item.product).check())
```

**Record Phase:**
1. Create a "recording context" with placeholder value
2. Execute callback once: `$.Inventory(placeholder.product).check()`
3. Capture the operations performed (not results)

**Replay Phase:**
1. For each actual item, replay the captured operations
2. `placeholder.product` becomes `items[0].product`, `items[1].product`, etc.
3. All checks batch into a single workflow step

**MapperInstruction Format:**
```typescript
interface MapperInstruction {
  operation: 'call' | 'property'
  path: string[]           // e.g., ['Inventory', 'check']
  inputPaths: string[][]   // Paths on input value, e.g., [['product']]
}

// items.map(item => $.Inventory(item.product).check())
// Becomes:
{
  type: 'map',
  array: items.__expr,
  mapper: [
    { operation: 'call', path: ['Inventory', 'check'], inputPaths: [['product']] }
  ]
}
```

## Automatic Batching

Independent operations batch automatically:

```typescript
const crm = $.CRM(customer).createAccount()
const billing = $.Billing(customer).setupSubscription()
const support = $.Support(customer).createTicketQueue()

// Engine sees three independent expressions
// Executes them in parallel without explicit Promise.all
```

Dependent operations execute in sequence:

```typescript
const order = $.Orders(customer).create({ items })
const payment = $.Payment(order.id).process()  // Depends on order.id

// Engine sees dependency: payment needs order.id
// Executes order first, then payment
```

## Conditional Logic

Since we can't use JavaScript `if` without resolved values, we provide declarative branching:

```typescript
// Option 1: $.when() for simple branching
$.when(inventory.available, {
  then: () => $.Inventory(product).reserve({ quantity }),
  else: () => $.Notification(customer).sendOutOfStock()
})

// Option 2: $.branch() for multi-way
$.branch(order.status, {
  'pending': () => $.Payment(order).process(),
  'shipped': () => $.Tracking(order).update(),
  'delivered': () => $.Review(customer).request(),
  default: () => $.Log('Unknown status')
})

// Option 3: $.match() for pattern matching
$.match(result, [
  [r => r.success, () => $.Email(customer).sendSuccess()],
  [r => r.error, () => $.Alert(ops).notify({ error: result.error })]
])
```

## Workflow Execution Model

```
┌──────────────────────────────────────────────────────────────┐
│  1. CAPTURE PHASE (Synchronous)                              │
│                                                               │
│  workflowFn runs, all $.Domain().method() calls return       │
│  PipelinePromises. Nothing executes yet.                     │
│                                                               │
│  Result: Tree of PipelineExpressions                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  2. ANALYSIS PHASE                                           │
│                                                               │
│  Engine analyzes expression tree:                            │
│  - Build dependency graph                                    │
│  - Identify independent operations (can parallelize)         │
│  - Identify dependent operations (must sequence)             │
│  - Expand .map() operations                                  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  3. EXECUTION PHASE (Async, Batched)                         │
│                                                               │
│  Execute steps via Cloudflare Workflows step.do():           │
│  - Independent steps run in parallel                         │
│  - Dependent steps wait for their dependencies               │
│  - Results cached for replay on restart                      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  4. RESOLUTION PHASE                                         │
│                                                               │
│  Replace PipelinePromises with actual values:                │
│  - Resolve property accesses from step results               │
│  - Build final return value                                  │
└──────────────────────────────────────────────────────────────┘
```

## Example: Complete Workflow

```typescript
const OnboardingWorkflow = Workflow('customer-onboarding', ($, customer) => {
  // These execute in parallel (no dependencies between them)
  const crm = $.CRM(customer).createAccount()
  const billing = $.Billing(customer).setupSubscription()
  const support = $.Support(customer).createTicketQueue()
  const analytics = $.Analytics(customer).initializeTracking()

  // This depends on the above (uses their properties)
  $.Email(customer).sendWelcome({
    crmId: crm.id,
    billingPortal: billing.portalUrl,
    supportEmail: support.email
  })

  // Magic map: process all items in parallel
  const itemResults = customer.cartItems.map(item =>
    $.Inventory(item).reserve({ quantity: item.quantity })
  )

  // Conditional based on result
  $.when(billing.trialActive, {
    then: () => $.Calendar(customer).scheduleOnboarding(),
    else: () => $.Sales(customer).flagForFollowUp()
  })

  return {
    customerId: customer.id,
    crmId: crm.id,
    reservations: itemResults
  }
})
```

## Migration Path

For compatibility, workflows CAN still use async/await:

```typescript
// Still works - await forces immediate resolution
const OrderWorkflow = Workflow('order', async ($, order) => {
  const inventory = await $.Inventory(order.product).check()
  if (!inventory.available) {
    return { status: 'unavailable' }
  }
  // ... rest with explicit awaits
})
```

But the new style is preferred:

```typescript
// Preferred - declarative, lazy, batchable
const OrderWorkflow = Workflow('order', ($, order) => {
  const inventory = $.Inventory(order.product).check()

  return $.when(inventory.available, {
    then: () => ({
      status: 'success',
      reservation: $.Inventory(order.product).reserve({ quantity: order.quantity })
    }),
    else: () => ({ status: 'unavailable' })
  })
})
```

## Sources

- [Cap'n Web GitHub](https://github.com/cloudflare/capnweb)
- [Cap'n Web Blog Post](https://blog.cloudflare.com/capnweb-javascript-rpc-library/)
- [Cap'n Web Protocol](https://github.com/cloudflare/capnweb/blob/main/protocol.md)
