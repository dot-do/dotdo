# E-commerce Checkout Example

A complete e-commerce shopping cart and checkout flow built with dotdo Durable Objects.

## Features

This example demonstrates:

- **Product Catalog**: CRUD operations for products with inventory tracking
- **Shopping Cart**: Per-customer cart state with add/update/remove items
- **Checkout Flow**: Multi-step checkout with address and payment
- **Payment Processing**: Simulated payment with success/failure handling
- **Order Tracking**: Order status updates and history via events
- **Relationships**: Customer-to-order relationships using the graph model

## Key dotdo Concepts

### Things (Entities)

```typescript
// Product, Cart, Order, Payment, Customer are all "Things"
const product = await this.things.create({
  $type: 'Product',
  name: 'Widget',
  price: 29.99,
  inventory: 100,
})
```

### Events

```typescript
// Track all state changes with events
await this.events.emit({
  type: 'Cart.itemAdded',
  payload: { cartId, productId, quantity },
  source: cartId,
})
```

### Relationships

```typescript
// Link customers to their orders
await this.relationships.add({
  subject: customerId,
  predicate: 'placed',
  object: orderId,
})

// Query relationships
const orderIds = await this.relationships.getRelated(customerId, 'placed')
```

## API Endpoints

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

### Customers

| Method | Path | Description |
|--------|------|-------------|
| POST | `/customers` | Create customer |
| GET | `/customers/:id` | Get customer |

## Usage Example

```bash
# Create a product
curl -X POST http://localhost:8787/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Widget","price":29.99,"inventory":100,"sku":"WDG-001","description":"A useful widget"}'

# Create a customer
curl -X POST http://localhost:8787/customers \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice"}'

# Add to cart
curl -X POST http://localhost:8787/cart/alice/items \
  -H "Content-Type: application/json" \
  -d '{"productId":"product-id-here","quantity":2}'

# Checkout
curl -X POST http://localhost:8787/checkout/alice \
  -H "Content-Type: application/json" \
  -d '{"shippingAddress":{"name":"Alice","line1":"123 Main St","city":"San Francisco","state":"CA","postalCode":"94102","country":"US"}}'

# Pay for order
curl -X POST http://localhost:8787/orders/order-id-here/pay \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod":"card"}'
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
examples/ecommerce/
  EcommerceDO.ts    # Main Durable Object implementation
  types.ts          # TypeScript type definitions
  index.ts          # Worker entrypoint
  wrangler.jsonc    # Cloudflare configuration
  package.json      # Package configuration
  README.md         # This file
```

## Architecture

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

Each store (or tenant) gets its own Durable Object instance, providing:
- **Isolation**: Complete data separation between stores
- **Consistency**: Strong consistency within each store
- **Scalability**: Automatic scaling per store
