/**
 * Workflow Event Choreography Example
 *
 * Entry point for the event-driven order processing demo.
 * Uses Hono for HTTP routing and the OrderFlowDO for event choreography.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { OrderFlowDO } from './OrderFlowDO'

// Re-export the DO class for Wrangler
export { OrderFlowDO }

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  DO: DurableObjectNamespace
}

interface OrderRequest {
  customerId: string
  items: Array<{
    sku: string
    name: string
    quantity: number
    price: number
  }>
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
    version: '1.0.0',
    description: 'Event-driven order processing with $.on handlers',
    endpoints: {
      'POST /orders': 'Place a new order',
      'DELETE /orders/:id': 'Cancel an order',
      'POST /orders/:id/deliver': 'Simulate delivery (for testing)',
      'GET /orders/:id/events': 'Get event history for debugging',
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
      },
    },
  })
})

/**
 * POST /orders - Place a new order
 *
 * This single API call triggers a cascade of events:
 * Order.placed -> Payment.requested -> Payment.completed -> ...
 */
app.post('/orders', async (c) => {
  const body = await c.req.json<OrderRequest>()

  if (!body.customerId || !body.items?.length) {
    return c.json({ error: 'customerId and items are required' }, 400)
  }

  // Get or create the DO instance for this customer
  const id = c.env.DO.idFromName(body.customerId)
  const stub = c.env.DO.get(id)

  // Call the placeOrder method on the DO
  const response = await stub.fetch(
    new Request('http://internal/rpc/placeOrder', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const order = await response.json()

  return c.json({
    success: true,
    message: 'Order placed. Event cascade initiated.',
    order,
    events: [
      'Order.placed',
      'Payment.requested',
      'Inventory.check',
      'Customer.notified (order confirmation)',
    ],
    note: 'Watch the console for the full event flow',
  }, 201)
})

/**
 * DELETE /orders/:id - Cancel an order
 *
 * Triggers compensation events:
 * Order.cancelled -> Payment.refund, Inventory.release, Customer.notified
 */
app.delete('/orders/:id', async (c) => {
  const orderId = c.req.param('id')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}))

  // For demo, use a fixed customer ID (in production, extract from auth)
  const id = c.env.DO.idFromName('demo-customer')
  const stub = c.env.DO.get(id)

  await stub.fetch(
    new Request('http://internal/rpc/cancelOrder', {
      method: 'POST',
      body: JSON.stringify({
        orderId,
        reason: body.reason ?? 'Customer requested cancellation',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  return c.json({
    success: true,
    message: 'Order cancellation initiated',
    orderId,
    compensationEvents: [
      'Order.cancelled',
      'Payment.refund (if paid)',
      'Inventory.release',
      'Customer.notified',
    ],
  })
})

/**
 * POST /orders/:id/deliver - Simulate delivery (for testing)
 */
app.post('/orders/:id/deliver', async (c) => {
  const orderId = c.req.param('id')

  const id = c.env.DO.idFromName('demo-customer')
  const stub = c.env.DO.get(id)

  await stub.fetch(
    new Request('http://internal/rpc/simulateDelivery', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  return c.json({
    success: true,
    message: 'Delivery simulated',
    orderId,
    events: [
      'Shipment.delivered',
      'Customer.notified (delivered)',
      'Review.requested (scheduled for 3 days later)',
    ],
  })
})

/**
 * GET /orders/:id/events - Get event history for debugging
 */
app.get('/orders/:id/events', async (c) => {
  const id = c.env.DO.idFromName('demo-customer')
  const stub = c.env.DO.get(id)

  const response = await stub.fetch(
    new Request('http://internal/rpc/getEventHistory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const events = await response.json()

  return c.json({
    orderId: c.req.param('id'),
    events,
    note: 'Event history shows all notifications sent during order lifecycle',
  })
})

/**
 * GET /health - Health check
 */
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
