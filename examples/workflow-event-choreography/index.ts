// Workflow Event Choreography Example Worker Entrypoint
// Four Durable Objects coordinate via events, not direct calls

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { OrderDO } from './OrderDO'
import { PaymentDO } from './PaymentDO'
import { InventoryDO } from './InventoryDO'
import { ShippingDO } from './ShippingDO'

export { OrderDO, PaymentDO, InventoryDO, ShippingDO }

interface Env {
  ORDER: DurableObjectNamespace
  PAYMENT: DurableObjectNamespace
  INVENTORY: DurableObjectNamespace
  SHIPPING: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// API documentation
app.get('/', (c) => {
  return c.json({
    name: 'Order Event Choreography API',
    version: '3.0.0',
    description: 'Event-driven order processing with four separate DOs',
    architecture: {
      pattern: 'Event Choreography with Saga Pattern',
      durableObjects: [
        { name: 'OrderDO', role: 'Saga coordinator, order lifecycle' },
        { name: 'PaymentDO', role: 'Payment processing, refunds' },
        { name: 'InventoryDO', role: 'Stock reservations, releases' },
        { name: 'ShippingDO', role: 'Shipment creation, tracking' },
      ],
    },
    endpoints: {
      orders: {
        'POST /orders': 'Place a new order',
        'GET /orders/:id': 'Get order details',
        'GET /orders/:id/saga': 'Get saga state',
        'DELETE /orders/:id': 'Cancel an order',
      },
      inventory: {
        'GET /inventory': 'Get all stock levels',
        'GET /inventory/:sku': 'Get stock for SKU',
        'POST /inventory/:sku/add': 'Add stock (admin)',
      },
      shipping: {
        'GET /shipping/:orderId': 'Get shipment for order',
        'GET /shipping/track/:trackingNumber': 'Track by number',
        'POST /shipping/:orderId/deliver': 'Simulate delivery (testing)',
      },
    },
  })
})

// Order routes -> OrderDO
app.post('/orders', async (c) => {
  const stub = c.env.ORDER.get(c.env.ORDER.idFromName('orders'))
  return stub.fetch(c.req.raw)
})

app.get('/orders/:id', async (c) => {
  const stub = c.env.ORDER.get(c.env.ORDER.idFromName('orders'))
  return stub.fetch(c.req.raw)
})

app.get('/orders/:id/saga', async (c) => {
  const stub = c.env.ORDER.get(c.env.ORDER.idFromName('orders'))
  return stub.fetch(c.req.raw)
})

app.delete('/orders/:id', async (c) => {
  const stub = c.env.ORDER.get(c.env.ORDER.idFromName('orders'))
  return stub.fetch(c.req.raw)
})

// Inventory routes -> InventoryDO
app.get('/inventory', async (c) => {
  const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('global'))
  return stub.fetch(c.req.raw)
})

app.get('/inventory/:sku', async (c) => {
  const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('global'))
  return stub.fetch(c.req.raw)
})

app.post('/inventory/:sku/add', async (c) => {
  const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('global'))
  return stub.fetch(c.req.raw)
})

// Shipping routes -> ShippingDO
app.get('/shipping/:orderId', async (c) => {
  const stub = c.env.SHIPPING.get(c.env.SHIPPING.idFromName('global'))
  return stub.fetch(c.req.raw)
})

app.get('/shipping/track/:trackingNumber', async (c) => {
  const stub = c.env.SHIPPING.get(c.env.SHIPPING.idFromName('global'))
  return stub.fetch(c.req.raw)
})

app.post('/shipping/:orderId/deliver', async (c) => {
  const stub = c.env.SHIPPING.get(c.env.SHIPPING.idFromName('global'))
  return stub.fetch(c.req.raw)
})

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    durableObjects: ['ORDER', 'PAYMENT', 'INVENTORY', 'SHIPPING'],
  })
})

export default app
