/**
 * Workflow Event Choreography Example
 *
 * Entry point for the event-driven order processing demo.
 * Uses Hono for HTTP routing with four separate Durable Objects:
 * - OrderDO: Saga coordinator and order lifecycle
 * - PaymentDO: Payment processing and refunds
 * - InventoryDO: Stock reservations and releases
 * - ShippingDO: Shipment creation and tracking
 *
 * The DOs communicate via events ($.send) rather than direct RPC calls.
 * This demonstrates the choreography pattern for distributed workflows.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Import DO classes
import { OrderDO } from './objects/Order'
import { PaymentDO } from './objects/Payment'
import { InventoryDO } from './objects/Inventory'
import { ShippingDO } from './objects/Shipping'
import { OrderFlowDO } from './src/OrderFlowDO'

// Re-export DO classes for Wrangler
export { OrderDO, PaymentDO, InventoryDO, ShippingDO, OrderFlowDO }

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  ORDER: DurableObjectNamespace
  PAYMENT: DurableObjectNamespace
  INVENTORY: DurableObjectNamespace
  SHIPPING: DurableObjectNamespace
}

interface OrderRequest {
  customerId: string
  items: Array<{
    sku: string
    name: string
    quantity: number
    price: number
  }>
  shippingAddress: {
    street: string
    city: string
    state: string
    zip: string
    country: string
  }
}

// ============================================================================
// HTTP ROUTES
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for browser testing
app.use('*', cors())

/**
 * GET / - API documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'Order Event Choreography API',
    version: '2.0.0',
    description: 'Event-driven order processing with separate DOs',
    architecture: {
      pattern: 'Event Choreography with Saga Pattern',
      durableObjects: [
        { name: 'OrderDO', role: 'Saga coordinator, order lifecycle' },
        { name: 'PaymentDO', role: 'Payment processing, refunds' },
        { name: 'InventoryDO', role: 'Stock reservations, releases' },
        { name: 'ShippingDO', role: 'Shipment creation, tracking' },
      ],
      eventFlow: [
        'Order.placed -> Payment.requested, Inventory.reserveRequested',
        'Payment.completed + Inventory.reserved -> Shipment.create',
        'Shipment.dispatched -> Inventory.deducted',
        'Shipment.delivered -> Order.completed',
        'Any failure -> Compensation (refund, release, cancel)',
      ],
    },
    endpoints: {
      orders: {
        'POST /orders': 'Place a new order',
        'GET /orders/:id': 'Get order details',
        'GET /orders/:id/saga': 'Get saga state (debugging)',
        'DELETE /orders/:id': 'Cancel an order',
        'POST /orders/:id/deliver': 'Simulate delivery (testing)',
      },
      inventory: {
        'GET /inventory': 'Get all stock levels',
        'GET /inventory/:sku': 'Get stock for SKU',
        'POST /inventory/:sku/add': 'Add stock (admin)',
      },
      shipping: {
        'GET /shipping/:orderId': 'Get shipment for order',
        'GET /shipping/track/:trackingNumber': 'Track by number',
      },
    },
    example: {
      method: 'POST',
      path: '/orders',
      body: {
        customerId: 'cust_alice',
        items: [
          { sku: 'WIDGET-001', name: 'Premium Widget', quantity: 2, price: 29.99 },
          { sku: 'GADGET-002', name: 'Super Gadget', quantity: 1, price: 49.99 },
        ],
        shippingAddress: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94105',
          country: 'US',
        },
      },
    },
    availableSkus: [
      { sku: 'WIDGET-001', name: 'Premium Widget', stock: 100 },
      { sku: 'GADGET-002', name: 'Super Gadget', stock: 50 },
      { sku: 'THING-003', name: 'Useful Thing', stock: 25 },
      { sku: 'RARE-ITEM', name: 'Rare Collector Item', stock: 2 },
      { sku: 'OUT-OF-STOCK', name: 'Unavailable Item', stock: 0 },
    ],
  })
})

// ============================================================================
// ORDER ENDPOINTS
// ============================================================================

/**
 * POST /orders - Place a new order
 *
 * This triggers the saga:
 * 1. Order.placed event emitted
 * 2. Payment.requested and Inventory.reserveRequested fired in parallel
 * 3. On success, Shipment.create fired
 * 4. On any failure, compensation events triggered
 */
app.post('/orders', async (c) => {
  const body = await c.req.json<OrderRequest>()

  if (!body.customerId || !body.items?.length || !body.shippingAddress) {
    return c.json({ error: 'customerId, items, and shippingAddress are required' }, 400)
  }

  // Validate shipping address
  const { street, city, state, zip, country } = body.shippingAddress
  if (!street || !city || !state || !zip || !country) {
    return c.json({ error: 'Complete shipping address required' }, 400)
  }

  // Get the Order DO instance for this customer
  const orderId = c.env.ORDER.idFromName(body.customerId)
  const orderStub = c.env.ORDER.get(orderId)

  // Call the placeOrder method
  const response = await orderStub.fetch(
    new Request('http://internal/rpc/placeOrder', {
      method: 'POST',
      body: JSON.stringify({
        customerId: body.customerId,
        items: body.items,
        shippingAddress: body.shippingAddress,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const order = await response.json()

  return c.json(
    {
      success: true,
      message: 'Order placed. Saga initiated.',
      order,
      sagaSteps: [
        { step: 'Order.placed', status: 'completed' },
        { step: 'Payment.requested', status: 'pending' },
        { step: 'Inventory.reserveRequested', status: 'pending' },
        { step: 'Shipment.create', status: 'waiting for payment + inventory' },
      ],
      note: 'Watch the console for the full event cascade',
    },
    201
  )
})

/**
 * GET /orders/:id - Get order details
 */
app.get('/orders/:id', async (c) => {
  const customerId = c.req.param('id')

  const orderId = c.env.ORDER.idFromName(customerId)
  const orderStub = c.env.ORDER.get(orderId)

  const response = await orderStub.fetch(
    new Request('http://internal/rpc/getOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const order = await response.json()

  if (!order) {
    return c.json({ error: 'Order not found' }, 404)
  }

  return c.json(order)
})

/**
 * GET /orders/:id/saga - Get saga state for debugging
 */
app.get('/orders/:id/saga', async (c) => {
  const customerId = c.req.param('id')

  const orderId = c.env.ORDER.idFromName(customerId)
  const orderStub = c.env.ORDER.get(orderId)

  const response = await orderStub.fetch(
    new Request('http://internal/rpc/getSagaState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const saga = await response.json()

  if (!saga) {
    return c.json({ error: 'No saga found for this order' }, 404)
  }

  return c.json({
    saga,
    note: 'Saga state shows the current progress of the order workflow',
  })
})

/**
 * DELETE /orders/:id - Cancel an order
 */
app.delete('/orders/:id', async (c) => {
  const customerId = c.req.param('id')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}))

  const orderId = c.env.ORDER.idFromName(customerId)
  const orderStub = c.env.ORDER.get(orderId)

  // First get the order to get its ID
  const getResponse = await orderStub.fetch(
    new Request('http://internal/rpc/getOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )
  const order = await getResponse.json() as { id: string } | null

  if (!order?.id) {
    return c.json({ error: 'Order not found' }, 404)
  }

  try {
    await orderStub.fetch(
      new Request('http://internal/rpc/cancelOrder', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          reason: body.reason ?? 'Customer requested cancellation',
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    return c.json({
      success: true,
      message: 'Order cancellation initiated',
      orderId: order.id,
      compensationEvents: [
        'Order.cancelled',
        'Payment.refund (if paid)',
        'Inventory.release (if reserved)',
        'Shipment.cancel (if created)',
      ],
    })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

/**
 * POST /orders/:id/deliver - Simulate delivery (for testing)
 */
app.post('/orders/:id/deliver', async (c) => {
  const customerId = c.req.param('id')

  // Get the order first
  const orderId = c.env.ORDER.idFromName(customerId)
  const orderStub = c.env.ORDER.get(orderId)

  const getResponse = await orderStub.fetch(
    new Request('http://internal/rpc/getOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )
  const order = await getResponse.json() as { id: string } | null

  if (!order?.id) {
    return c.json({ error: 'Order not found' }, 404)
  }

  // Call shipping DO to simulate delivery
  const shippingId = c.env.SHIPPING.idFromName('global')
  const shippingStub = c.env.SHIPPING.get(shippingId)

  await shippingStub.fetch(
    new Request('http://internal/rpc/simulateDelivery', {
      method: 'POST',
      body: JSON.stringify(order.id),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  return c.json({
    success: true,
    message: 'Delivery simulated',
    orderId: order.id,
    events: [
      'Shipment.delivered',
      'Customer.notified (delivered)',
      'Order.completed',
    ],
  })
})

// ============================================================================
// INVENTORY ENDPOINTS
// ============================================================================

/**
 * GET /inventory - Get all stock levels
 */
app.get('/inventory', async (c) => {
  const inventoryId = c.env.INVENTORY.idFromName('global')
  const inventoryStub = c.env.INVENTORY.get(inventoryId)

  const response = await inventoryStub.fetch(
    new Request('http://internal/rpc/getStockLevels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const stock = await response.json()
  return c.json({ stock })
})

/**
 * GET /inventory/:sku - Get stock for SKU
 */
app.get('/inventory/:sku', async (c) => {
  const sku = c.req.param('sku')

  const inventoryId = c.env.INVENTORY.idFromName('global')
  const inventoryStub = c.env.INVENTORY.get(inventoryId)

  const response = await inventoryStub.fetch(
    new Request('http://internal/rpc/getStock', {
      method: 'POST',
      body: JSON.stringify(sku),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const stock = await response.json()

  if (!stock) {
    return c.json({ error: 'SKU not found' }, 404)
  }

  return c.json(stock)
})

/**
 * POST /inventory/:sku/add - Add stock (admin)
 */
app.post('/inventory/:sku/add', async (c) => {
  const sku = c.req.param('sku')
  const body = await c.req.json<{ quantity: number }>()

  if (!body.quantity || body.quantity <= 0) {
    return c.json({ error: 'quantity must be a positive number' }, 400)
  }

  const inventoryId = c.env.INVENTORY.idFromName('global')
  const inventoryStub = c.env.INVENTORY.get(inventoryId)

  const response = await inventoryStub.fetch(
    new Request('http://internal/rpc/addStock', {
      method: 'POST',
      body: JSON.stringify({ sku, quantity: body.quantity }),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const stock = await response.json()
  return c.json({ success: true, stock })
})

// ============================================================================
// SHIPPING ENDPOINTS
// ============================================================================

/**
 * GET /shipping/:orderId - Get shipment for order
 */
app.get('/shipping/:orderId', async (c) => {
  const orderId = c.req.param('orderId')

  const shippingId = c.env.SHIPPING.idFromName('global')
  const shippingStub = c.env.SHIPPING.get(shippingId)

  const response = await shippingStub.fetch(
    new Request('http://internal/rpc/getShipment', {
      method: 'POST',
      body: JSON.stringify(orderId),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const shipment = await response.json()

  if (!shipment) {
    return c.json({ error: 'Shipment not found' }, 404)
  }

  return c.json(shipment)
})

/**
 * GET /shipping/track/:trackingNumber - Track by number
 */
app.get('/shipping/track/:trackingNumber', async (c) => {
  const trackingNumber = c.req.param('trackingNumber')

  const shippingId = c.env.SHIPPING.idFromName('global')
  const shippingStub = c.env.SHIPPING.get(shippingId)

  const response = await shippingStub.fetch(
    new Request('http://internal/rpc/getShipmentByTracking', {
      method: 'POST',
      body: JSON.stringify(trackingNumber),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const shipment = await response.json()

  if (!shipment) {
    return c.json({ error: 'Tracking number not found' }, 404)
  }

  return c.json({
    trackingNumber,
    carrier: (shipment as { carrier: string }).carrier,
    status: (shipment as { status: string }).status,
    trackingHistory: (shipment as { trackingHistory: unknown[] }).trackingHistory,
    estimatedDelivery: (shipment as { estimatedDelivery?: string }).estimatedDelivery,
    actualDelivery: (shipment as { actualDelivery?: string }).actualDelivery,
  })
})

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * GET /health - Health check
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    durableObjects: ['ORDER', 'PAYMENT', 'INVENTORY', 'SHIPPING'],
  })
})

export default app
