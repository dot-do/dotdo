# Cross-DO RPC

Cross-DO RPC provides typed communication between Durable Objects with stub caching and connection pooling.

## Features

- **Typed RPC** - Full TypeScript support for method calls
- **Stub Caching** - Automatic connection pooling per namespace
- **$ Context** - Familiar syntax for cross-DO calls
- **Broadcast** - Call methods on multiple DOs in parallel
- **Namespace Routing** - Organize DOs by type (Customer, Order, etc.)

## Quick Start

### Basic Cross-DO Call

```typescript
import { createCrossDOClient } from '@dotdo/rpc/cross-do'

// Define the remote DO interface
interface CustomerDO {
  getBalance(): Promise<number>
  charge(amount: number): Promise<boolean>
}

// Inside a Durable Object or Worker
const customer = createCrossDOClient<CustomerDO>(env.Customer, 'customer-123')
const balance = await customer.getBalance()
const charged = await customer.charge(100)
```

### Using $ Context

The `CrossDOContext` provides a more ergonomic API:

```typescript
import { CrossDOContext } from '@dotdo/rpc/cross-do'

interface CustomerDO {
  getBalance(): Promise<number>
  notify(message: string): Promise<void>
}

interface OrderDO {
  getStatus(): Promise<string>
}

// Create context (typically done once)
const $ = new CrossDOContext(env)

// Call methods on other DOs
const balance = await $.Customer<CustomerDO>('customer-123').getBalance()
const status = await $.Order<OrderDO>('order-456').getStatus()
```

### Broadcasting to Multiple DOs

Send the same method call to multiple DOs in parallel:

```typescript
const $ = new CrossDOContext(env)

const customerIds = ['c1', 'c2', 'c3']

// Broadcast notification to all customers
const results = await $.Customer<CustomerDO>().broadcast(
  customerIds,
  'notify',
  'Your order shipped!'
)

console.log(results) // [void, void, void]
```

## API Reference

### `createCrossDOClient<T>(binding, id, cache?)`

Creates a typed proxy client for cross-DO RPC calls.

**Parameters:**
- `binding: DurableObjectNamespace` - The DO namespace binding
- `id: string | DurableObjectId` - The DO identifier
- `cache?: CrossDOStubCache` - Optional stub cache for connection pooling

**Returns:** `T` - Typed proxy that forwards method calls to the remote DO

**Example:**
```typescript
interface CounterDO {
  increment(): Promise<number>
  getValue(): Promise<number>
}

const counter = createCrossDOClient<CounterDO>(env.Counter, 'counter-1')
const value = await counter.increment()
```

### `CrossDOStubCache`

Manages stub caching for connection pooling.

**Methods:**
- `getStub(binding, id)` - Get or create a DO stub (with caching)
- `clear()` - Clear all cached stubs
- `evictNamespace(binding)` - Evict all stubs for a namespace
- `evict(binding, id)` - Evict a specific DO stub

**Example:**
```typescript
const cache = new CrossDOStubCache()

// Use cache across multiple clients
const customer1 = createCrossDOClient<CustomerDO>(env.Customer, 'c1', cache)
const customer2 = createCrossDOClient<CustomerDO>(env.Customer, 'c2', cache)

// Later, evict namespace if needed
cache.evictNamespace(env.Customer)
```

### `CrossDOContext`

Provides $ style syntax for cross-DO calls with built-in caching.

**Constructor:**
```typescript
new CrossDOContext(env: Record<string, DurableObjectNamespace>)
```

**Methods:**
- `$.NameSpace<T>(id).method()` - Call method on a specific DO
- `$.NameSpace<T>().broadcast(ids, method, ...args)` - Broadcast to multiple DOs
- `clearCache()` - Clear all cached stubs
- `evictNamespace(namespace)` - Evict stubs for a namespace

**Example:**
```typescript
const $ = new CrossDOContext({
  Customer: env.Customer,
  Order: env.Order,
  Product: env.Product
})

// Type-safe calls
const balance = await $.Customer<CustomerDO>('c1').getBalance()
const order = await $.Order<OrderDO>('o1').getStatus()

// Broadcast
const results = await $.Customer<CustomerDO>().broadcast(
  ['c1', 'c2'],
  'notify',
  'Hello!'
)
```

## Usage Patterns

### Within a Durable Object

```typescript
import { CrossDOContext } from '@dotdo/rpc/cross-do'
import { DO } from '@dotdo/do'

export class OrderDO extends DO {
  async processPayment(amount: number) {
    // Get customer from another DO
    const $ = new CrossDOContext(this.env)
    const customerId = await this.getCustomerId()

    const charged = await $.Customer<CustomerDO>(customerId).charge(amount)

    if (charged) {
      await $.Customer<CustomerDO>(customerId).notify('Payment processed!')
    }

    return charged
  }
}
```

### Cross-DO Data Fetching

```typescript
// Get customer's payment methods from Customer DO
const $ = new CrossDOContext(env)

const customerId = 'customer-123'
const paymentMethods = await $.Customer<CustomerDO>(customerId)
  .getPaymentMethods()

const activeCards = paymentMethods.filter(pm => pm.active)
```

### Namespace Organization

Organize DOs by business entity:

```typescript
const $ = new CrossDOContext({
  // User/Auth
  User: env.User,
  Session: env.Session,

  // E-commerce
  Customer: env.Customer,
  Order: env.Order,
  Product: env.Product,
  Cart: env.Cart,

  // Payments
  PaymentMethod: env.PaymentMethod,
  Transaction: env.Transaction,
})

// Now you can call methods on any namespace
await $.User<UserDO>('u1').updateProfile({ name: 'Alice' })
await $.Cart<CartDO>('cart-1').addItem(productId, quantity)
await $.Transaction<TransactionDO>('tx-1').complete()
```

## Stub Caching

Stubs are automatically cached per namespace to avoid repeated `binding.get()` calls:

```typescript
const $ = new CrossDOContext(env)

// First call creates the stub
await $.Customer<CustomerDO>('c1').getBalance()

// Second call reuses the cached stub
await $.Customer<CustomerDO>('c1').charge(100)

// Different ID creates a new stub
await $.Customer<CustomerDO>('c2').getBalance()
```

Cache invalidation:

```typescript
// Clear all caches
$.clearCache()

// Clear specific namespace
$.evictNamespace('Customer')
```

## Error Handling

All cross-DO calls can throw errors:

```typescript
try {
  const balance = await $.Customer<CustomerDO>('c1').getBalance()
} catch (error) {
  if (error.message.includes('Cross-DO RPC error')) {
    // Handle RPC error (500, 404, etc.)
  } else if (error.message.includes('DO namespace not found')) {
    // Handle missing namespace
  } else {
    // Handle other errors (network, timeout, etc.)
  }
}
```

## Type Safety

Full TypeScript inference for DO interfaces:

```typescript
interface CustomerDO {
  getBalance(): Promise<number>
  charge(amount: number): Promise<boolean>
  notify(message: string): Promise<{ success: boolean }>
}

const customer = $.Customer<CustomerDO>('c1')

// ✅ Type-safe
const balance: number = await customer.getBalance()
const charged: boolean = await customer.charge(100)

// ❌ Type error - wrong argument type
await customer.charge('100') // Error: Argument of type 'string' is not assignable to parameter of type 'number'

// ❌ Type error - method doesn't exist
await customer.nonExistent() // Error: Property 'nonExistent' does not exist on type 'CustomerDO'
```

## Performance

- **Stub caching** - Stubs are cached per namespace using WeakMap
- **Connection pooling** - Reuses stubs for the same DO ID
- **Parallel broadcasts** - `Promise.all` for multiple DOs

## Integration with WorkflowContext ($)

The Cross-DO RPC can be integrated into the WorkflowContext for seamless DO-to-DO calls:

```typescript
// In a future version, $ might include cross-DO support:
const $ = createWorkflowContext(env)

// Hypothetical future API
await $.Customer('c1').getBalance()  // Cross-DO call
await $.on.Payment.failed(handler)   // Event handler
await $.do(action)                   // Durable action
```

## Best Practices

1. **Define interfaces** - Always type your DO interfaces for type safety
2. **Cache wisely** - Use the built-in cache for frequently-called DOs
3. **Handle errors** - Wrap cross-DO calls in try/catch
4. **Broadcast carefully** - Don't broadcast to too many DOs at once
5. **Namespace logically** - Organize DOs by business entity, not technical concerns

## Related

- [RPC Client](./client.ts) - For client-to-worker RPC
- [RPC Server](./server.ts) - For exposing methods via RPC
- [Pipeline](./pipeline.ts) - For chaining RPC calls
