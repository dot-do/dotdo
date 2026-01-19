# $.on - Event Handler System

Proxy-based event handler registration for the WorkflowContext.

## Overview

The `$.on` system provides an elegant, type-safe way to register event handlers using a two-level Proxy pattern. This enables infinite `Noun.verb` combinations with wildcard support.

## Usage

### Basic Registration

```typescript
import { createContext } from '@dotdo/do'

const $ = createContext(state, env)

// Register handlers using $.on.Noun.verb() syntax
$.on.Customer.signup(async (event) => {
  console.log('Customer signed up:', event)
})

$.on.Payment.failed(async (event) => {
  console.log('Payment failed:', event)
})

$.on.Order.placed(async (event) => {
  console.log('Order placed:', event)
})
```

### Wildcard Patterns

```typescript
// Match all verbs for a noun
$.on.Customer['*'](async (event) => {
  console.log('Any customer event:', event)
})

// Match all nouns for a verb
$.on['*'].created(async (event) => {
  console.log('Something was created:', event)
})

// Match all events
$.on['*']['*'](async (event) => {
  console.log('Any event:', event)
})
```

### Event Emission

```typescript
// Fire-and-forget event emission
$.send({ type: 'Customer.signup', payload: { email: 'user@example.com' } })

// Handlers are invoked automatically via pattern matching
```

## Pattern Matching

When an event is emitted, the system matches handlers in order of specificity:

1. **Exact match**: `Customer.signup` → handlers registered via `$.on.Customer.signup()`
2. **Noun wildcard**: `Customer.signup` → handlers registered via `$.on.Customer['*']()`
3. **Verb wildcard**: `Customer.signup` → handlers registered via `$.on['*'].signup()`
4. **Global wildcard**: `Customer.signup` → handlers registered via `$.on['*']['*']()`

All matching handlers are invoked in parallel.

## API Reference

### `createOnProxy(handlers: Map<string, EventHandler[]>): OnProxy`

Creates a Proxy-based event handler registry.

**Parameters:**
- `handlers`: Map storing registered handlers

**Returns:**
- `OnProxy`: Proxy for event handler registration

**Example:**
```typescript
const handlers = new Map()
const on = createOnProxy(handlers)

on.Order.placed(async (event) => {
  console.log('Order placed:', event)
})
```

### `matchHandlers(eventType: string, handlers: Map): EventHandler[]`

Find all handlers that match a given event type.

**Parameters:**
- `eventType`: Event type in format "Noun.verb"
- `handlers`: Handler registry map

**Returns:**
- Array of matching handlers

**Example:**
```typescript
const matches = matchHandlers('Order.placed', handlers)
// Returns: [exact, noun wildcard, verb wildcard, global wildcard]
```

### `invokeHandlers(eventType: string, event: unknown, handlers: Map): Promise<void>`

Invoke all handlers that match an event.

**Parameters:**
- `eventType`: Event type in format "Noun.verb"
- `event`: Event data to pass to handlers
- `handlers`: Handler registry map

**Returns:**
- Promise that resolves when all handlers complete

**Example:**
```typescript
await invokeHandlers('Order.placed', { orderId: '123' }, handlers)
```

### `getEventTypes(handlers: Map): string[]`

Get all registered event types.

**Parameters:**
- `handlers`: Handler registry map

**Returns:**
- Array of event type strings

### `getHandlerCount(eventType: string, handlers: Map): number`

Get handler count for a specific event type.

**Parameters:**
- `eventType`: Event type in format "Noun.verb"
- `handlers`: Handler registry map

**Returns:**
- Number of handlers registered

### `clearHandlers(eventType: string, handlers: Map): void`

Clear all handlers for a specific event type.

**Parameters:**
- `eventType`: Event type in format "Noun.verb"
- `handlers`: Handler registry map

### `clearAllHandlers(handlers: Map): void`

Clear all handlers from the registry.

**Parameters:**
- `handlers`: Handler registry map

## Type Definitions

### `EventHandler`

```typescript
type EventHandler = (event: unknown) => Promise<void> | void
```

Event handler function that receives event data. Can be sync or async.

### `NounEventProxy`

```typescript
interface NounEventProxy {
  // Common verbs (autocomplete)
  created: (handler: EventHandler) => void
  updated: (handler: EventHandler) => void
  deleted: (handler: EventHandler) => void
  placed: (handler: EventHandler) => void
  completed: (handler: EventHandler) => void
  failed: (handler: EventHandler) => void
  // ... more verbs

  // Wildcard
  '*': (handler: EventHandler) => void

  // Index signature for arbitrary verbs
  [verb: string]: (handler: EventHandler) => void
}
```

Proxy for event handlers on a specific noun.

### `OnProxy`

```typescript
interface OnProxy {
  // Common nouns (autocomplete)
  Customer: NounEventProxy
  Order: NounEventProxy
  Payment: NounEventProxy
  User: NounEventProxy
  // ... more nouns

  // Wildcard
  '*': NounEventProxy

  // Index signature for arbitrary nouns
  [noun: string]: NounEventProxy
}
```

Top-level Proxy for event handler registration.

## Examples

### Multiple Handlers

```typescript
// Multiple handlers for same event
$.on.Order.placed(async (event) => {
  // Send confirmation email
  await sendEmail(event.payload.email, 'Order confirmed')
})

$.on.Order.placed(async (event) => {
  // Update analytics
  await trackEvent('order_placed', event.payload)
})

$.on.Order.placed(async (event) => {
  // Trigger fulfillment
  await fulfillOrder(event.payload.orderId)
})
```

### Handler Chaining

```typescript
// Specific handler
$.on.Customer.signup(async (event) => {
  console.log('Specific: Customer signup')
})

// Noun wildcard
$.on.Customer['*'](async (event) => {
  console.log('Wildcard: Any customer event')
})

// Verb wildcard
$.on['*'].signup(async (event) => {
  console.log('Wildcard: Any signup event')
})

// Global wildcard
$.on['*']['*'](async (event) => {
  console.log('Global: All events')
})

// Emit event
$.send({ type: 'Customer.signup', payload: { email: 'test@example.com' } })

// Output:
// Specific: Customer signup
// Wildcard: Any customer event
// Wildcard: Any signup event
// Global: All events
```

### Error Handling

```typescript
$.on.Payment.failed(async (event) => {
  try {
    await retryPayment(event.payload.paymentId)
  } catch (error) {
    console.error('Failed to retry payment:', error)
    // Error is caught and logged, doesn't prevent other handlers
  }
})
```

### Async Handlers

```typescript
$.on.Invoice.generated(async (event) => {
  // Async operations
  const invoice = await db.invoices.get(event.payload.id)
  const pdf = await generatePDF(invoice)
  await sendEmail(invoice.customer.email, pdf)
})
```

## Implementation Details

### Two-Level Proxy

The implementation uses a two-level Proxy pattern:

1. **First level** (OnProxy): Captures the noun (Customer, Order, etc.)
2. **Second level** (NounEventProxy): Captures the verb (created, updated, etc.)
3. **Function call**: Registers the handler

```typescript
// Level 1: OnProxy captures 'Customer'
$.on.Customer
//   ↓
// Level 2: NounEventProxy captures 'signup'
$.on.Customer.signup
//            ↓
// Function call: Register handler
$.on.Customer.signup(handler)
```

### Pattern Matching Algorithm

```typescript
function matchHandlers(eventType: string, handlers: Map): EventHandler[] {
  const [noun, verb] = eventType.split('.')
  const matched: EventHandler[] = []

  // 1. Exact match (Customer.signup)
  matched.push(...(handlers.get(eventType) || []))

  // 2. Noun wildcard (Customer.*)
  matched.push(...(handlers.get(`${noun}.*`) || []))

  // 3. Verb wildcard (*.signup)
  matched.push(...(handlers.get(`*.${verb}`) || []))

  // 4. Global wildcard (*.*)
  matched.push(...(handlers.get('*.*') || []))

  return matched
}
```

### Safe Handler Invocation

Handlers are invoked safely to prevent errors in one handler from affecting others:

```typescript
const safeCall = (h: EventHandler) => {
  try {
    const result = h(event)
    if (result && typeof result.catch === 'function') {
      result.catch(console.error)
    }
  } catch (err) {
    console.error(err)
  }
}

matched.forEach(safeCall)
```

## Testing

See `do/tests/on.test.ts` for comprehensive test suite covering:

- Handler registration
- Multiple handlers per event
- Wildcard patterns
- Handler invocation
- Type safety
- Pattern matching
- Error handling
- Edge cases

Run tests:

```bash
npx vitest run do/tests/on.test.ts
```

## Integration

The `$.on` system is integrated into the WorkflowContext:

```typescript
// do/context.ts
import { createOnProxy, matchHandlers } from './on'

export function createContext(state, env): WorkflowContext {
  const handlers = new Map<string, EventHandler[]>()

  return {
    on: createOnProxy(handlers),

    send(event) {
      // Use matchHandlers for pattern matching
      const matched = matchHandlers(event.type, handlers)
      matched.forEach(safeCall)
    },

    _handlers: handlers
  }
}
```

## Best Practices

1. **Use specific handlers when possible**: `$.on.Order.placed()` is better than `$.on['*'].placed()`
2. **Avoid blocking operations**: Handlers run in parallel, keep them fast
3. **Handle errors gracefully**: Use try/catch to prevent one handler from affecting others
4. **Use wildcards for cross-cutting concerns**: Logging, analytics, auditing
5. **Keep handlers focused**: One handler should do one thing well

## See Also

- `do/context.ts` - WorkflowContext implementation
- `do/tests/on.test.ts` - Test suite
- `do/schedule.ts` - Scheduling system ($.every)
- `primitives/packages/ai-workflows/src/on.ts` - Reference implementation
