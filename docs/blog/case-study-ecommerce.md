# Case Study: E-commerce Checkout with dotdo

**Published: January 2026**

Learn how to build a complete e-commerce checkout system using dotdo Durable Objects. This case study demonstrates shopping cart management, checkout flow, payment processing, and order tracking.

## The Problem

Building an e-commerce checkout system involves several challenges:

- **Cart state management** - Maintaining shopping cart state across sessions
- **Inventory tracking** - Ensuring accurate inventory counts during concurrent purchases
- **Payment processing** - Handling payments with proper error handling and retries
- **Order lifecycle** - Tracking orders through multiple status changes
- **Event coordination** - Sending confirmation emails, updating analytics, triggering fulfillment

Traditional approaches require multiple services: a database, cache, message queue, and job runner. With dotdo, all of this lives in a single Durable Object.

## Architecture Overview

```
Client Request
     |
     v
+------------------+
|  Worker (index)  |
|  Route by store  |
+------------------+
     |
     v
+------------------+
|   EcommerceDO    |
|  - things        |  <-- Product, Cart, Order, Payment, Customer
|  - events        |  <-- Cart.itemAdded, Order.created, Payment.completed
|  - relationships |  <-- customer -> placed -> order
+------------------+
     |
     v
+------------------+
|  Durable Storage |
|  (per-store)     |
+------------------+
```

Each store gets its own Durable Object instance, providing:
- **Isolation**: Complete data separation between stores
- **Consistency**: Strong consistency within each store
- **Scalability**: Automatic scaling per store

## Key dotdo Patterns

### Event Handlers with $.on.Noun.verb

The event system allows reactive handling of business events:

```typescript
// Initialize WorkflowContext for event handling
this.$ = createContext(state, env)

// Handle order creation - send confirmation email
this.$.on.Order.created(async (event) => {
  const { orderId, customerId, total } = event.payload
  console.log(`Order created: ${orderId} for customer ${customerId}`)
  // In production: send order confirmation email via $.do for durability
})

// Handle payment completion - update inventory and notify
this.$.on.Payment.completed(async (event) => {
  const { orderId, paymentId } = event.payload
  console.log(`Payment completed for order ${orderId}`)
  // In production: trigger fulfillment workflow
})

// Handle payment failure - notify customer
this.$.on.Payment.failed(async (event) => {
  const { orderId, reason } = event.payload
  console.log(`Payment failed for order ${orderId}: ${reason}`)
  // In production: send payment failure notification
})

// Track cart analytics
this.$.on.Cart.itemAdded(async (event) => {
  const { cartId, productId, quantity } = event.payload
  console.log(`Item added to cart ${cartId}: ${productId} x${quantity}`)
})

// Wildcard handler - audit log all events
this.$.on['*']['*'](async (event) => {
  console.log(`[Audit] Event: ${event.type}`, event.payload)
})
```

### Scheduling with $.every

Background tasks run on schedule without external cron services:

```typescript
// Every day at midnight - clean up abandoned carts
this.$.every.day.atmidnight(async () => {
  console.log('Cleaning up abandoned carts...')
  const carts = await this.things.list({ type: 'Cart' })
  const abandonedThreshold = 24 * 60 * 60 * 1000 // 24 hours

  for (const cart of carts) {
    if (cart.status === 'active') {
      // Mark as abandoned if not checked out
    }
  }
})

// Every hour - check for payment retries
this.$.every.hour(async () => {
  console.log('Checking for payment retries...')
  const orders = await this.things.list({ type: 'Order' })
  for (const order of orders) {
    if (order.status === 'payment_failed') {
      // Attempt retry or notify customer
    }
  }
})
```

### Firing Events with $.send

Events are fired with fire-and-forget semantics:

```typescript
// After adding item to cart
this.$.send({
  type: 'Cart.itemAdded',
  payload: { cartId: cart.$id, productId, quantity },
})

// After creating an order
this.$.send({
  type: 'Order.created',
  payload: { orderId: order.$id, customerId, total },
})

// After payment processing
this.$.send({
  type: 'Payment.completed',
  payload: { orderId, paymentId: payment.$id },
})

// Dynamic event types based on order status
this.$.send({
  type: `Order.${status}`,  // e.g., Order.shipped, Order.delivered
  payload: { orderId, status },
})
```

### Entity Management with Things

Products, carts, orders, and customers are all "Things":

```typescript
// Create a product
const product = await this.things.create({
  $type: 'Product',
  name: 'Widget',
  price: 29.99,
  inventory: 100,
  sku: 'WDG-001',
})

// Create an order with all details
const order = await this.things.create({
  $type: 'Order',
  customerId,
  cartId: cart.$id,
  items: orderItems,
  subtotal,
  tax,
  total,
  status: 'pending',
  shippingAddress,
})

// Update inventory after payment
await this.things.update(item.productId, {
  inventory: currentInventory - item.quantity,
})
```

### Relationship Tracking

Link customers to their orders:

```typescript
// Add relationship when order is placed
await this.relationships.add({
  subject: customerId,
  predicate: 'placed',
  object: order.$id,
})

// Query customer's orders
const orderIds = await this.relationships.getRelated(customerId, 'placed')
const orders = await Promise.all(
  orderIds.map((id) => this.things.get(id))
)
```

## Type Definitions

Strong typing ensures correctness:

```typescript
export interface Product {
  $type: 'Product'
  name: string
  price: number
  description: string
  inventory: number
  sku: string
}

export interface Cart {
  $type: 'Cart'
  customerId: string
  items: CartItem[]
  total: number
  status: 'active' | 'checked_out' | 'abandoned'
}

export interface Order {
  $type: 'Order'
  customerId: string
  cartId: string
  items: OrderItem[]
  subtotal: number
  tax: number
  total: number
  status: OrderStatus
  paymentId?: string
  shippingAddress?: ShippingAddress
}

export type OrderStatus =
  | 'pending'
  | 'payment_processing'
  | 'payment_failed'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
```

## API Endpoints

The complete REST API:

### Products
| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | List all products |
| GET | `/products/:id` | Get a single product |
| POST | `/products` | Create a product |
| PATCH | `/products/:id/inventory` | Update inventory |

### Cart
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cart/:customerId` | Get or create cart |
| POST | `/cart/:customerId/items` | Add item to cart |
| PATCH | `/cart/:customerId/items/:productId` | Update item quantity |
| DELETE | `/cart/:customerId/items/:productId` | Remove item |

### Checkout
| Method | Path | Description |
|--------|------|-------------|
| POST | `/checkout/:customerId` | Create order from cart |
| POST | `/orders/:orderId/pay` | Process payment |

### Orders
| Method | Path | Description |
|--------|------|-------------|
| GET | `/orders/:orderId` | Get order details |
| GET | `/customers/:customerId/orders` | List customer orders |
| PATCH | `/orders/:orderId/status` | Update order status |
| GET | `/orders/:orderId/history` | Get order event history |

## Benefits and Results

### What We Achieved

1. **Simplified Architecture**: No separate database, cache, or message queue needed
2. **Strong Consistency**: Cart and inventory operations are atomic within the DO
3. **Real-time Events**: Event handlers fire immediately without polling
4. **Automatic Scaling**: Each store scales independently
5. **Complete Audit Trail**: All events are logged via the wildcard handler
6. **Multi-tenancy**: Built-in isolation per store

### Performance

- **Low Latency**: State is co-located with compute at the edge
- **Zero Cold Starts**: Durable Objects maintain warm state
- **Global Distribution**: Cloudflare's network provides low latency worldwide

### Developer Experience

- **Single File**: The entire checkout logic fits in one DO class
- **Type Safety**: Full TypeScript support with strict typing
- **Testable**: Real SQLite and miniflare for local testing without mocks

## Try It Yourself

The complete example is available at `examples/ecommerce/`:

```bash
# Navigate to the example
cd examples/ecommerce

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

Example API calls:

```bash
# Create a product
curl -X POST http://localhost:8787/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":29.99,"inventory":100,"sku":"WDG-001"}'

# Add to cart
curl -X POST http://localhost:8787/cart/alice/items \
  -H "Content-Type: application/json" \
  -d '{"productId":"product-id-here","quantity":2}'

# Checkout
curl -X POST http://localhost:8787/checkout/alice \
  -H "Content-Type: application/json" \
  -d '{"shippingAddress":{"name":"Alice","line1":"123 Main St","city":"SF","state":"CA","postalCode":"94102","country":"US"}}'

# Pay for order
curl -X POST http://localhost:8787/orders/order-id-here/pay \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod":"card"}'
```

---

*Next: [Real-time Collaboration Case Study](/docs/blog/case-study-realtime.md)*
