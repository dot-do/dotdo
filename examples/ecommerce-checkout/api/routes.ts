/**
 * E-Commerce Checkout API Routes
 *
 * RESTful API for the multi-DO e-commerce checkout flow.
 * Routes interact with CartDO, InventoryDO, CheckoutDO, and OrderDO.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { CartItem, Address } from '../objects/Cart'
import type { PaymentMethod } from '../objects/Checkout'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  CART: DurableObjectNamespace
  INVENTORY: DurableObjectNamespace
  CHECKOUT: DurableObjectNamespace
  ORDER: DurableObjectNamespace
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

class APIError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: ContentfulStatusCode = 400,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'APIError'
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get customer ID from request header.
 */
function getCustomerId(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('X-Customer-ID') ?? 'demo-customer'
}

/**
 * Call DO method via RPC.
 */
async function callDO<T>(stub: DurableObjectStub, method: string, body?: unknown): Promise<T> {
  const response = await stub.fetch(
    new Request(`http://internal/rpc/${method}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json' },
    })
  )

  if (!response.ok) {
    const error = (await response.json()) as { error: string; code?: string; details?: unknown }
    throw new APIError(
      error.error,
      error.code ?? 'ERROR',
      response.status as ContentfulStatusCode,
      error.details as Record<string, unknown>
    )
  }

  return response.json() as Promise<T>
}

// ============================================================================
// CREATE API
// ============================================================================

export function createAPI() {
  const app = new Hono<{ Bindings: Env }>()

  // Enable CORS
  app.use('*', cors())

  // ============================================================================
  // ROOT - API INFO
  // ============================================================================

  app.get('/', (c) => {
    return c.json({
      name: 'E-Commerce Checkout API',
      version: '2.0.0',
      tagline: 'Multi-DO Checkout with Saga Pattern',
      description: 'Complete e-commerce checkout flow using coordinated Durable Objects',
      architecture: {
        CartDO: 'Shopping cart per customer',
        InventoryDO: 'Global inventory with reservations',
        CheckoutDO: 'Checkout session orchestrator',
        OrderDO: 'Order management per order',
      },
      endpoints: {
        cart: {
          'GET /cart': 'Get current cart',
          'POST /cart/items': 'Add item to cart',
          'PUT /cart/items/:sku': 'Update item quantity',
          'DELETE /cart/items/:sku': 'Remove item from cart',
          'DELETE /cart': 'Clear cart',
          'PUT /cart/shipping-address': 'Set shipping address',
          'PUT /cart/billing-address': 'Set billing address',
          'PUT /cart/shipping-method': 'Set shipping method',
          'POST /cart/promo': 'Apply promo code',
          'DELETE /cart/promo': 'Remove promo code',
        },
        inventory: {
          'GET /inventory': 'Get all stock levels',
          'GET /inventory/:sku': 'Get stock for specific SKU',
          'POST /inventory': 'Set stock level (admin)',
          'PUT /inventory/:sku': 'Adjust stock (admin)',
        },
        checkout: {
          'POST /checkout/sessions': 'Create checkout session',
          'GET /checkout/sessions/:id': 'Get session details',
          'GET /checkout/sessions/:id/totals': 'Calculate totals',
          'POST /checkout/sessions/:id/complete': 'Complete checkout',
          'DELETE /checkout/sessions/:id': 'Cancel session',
          'GET /shipping/rates': 'Get shipping rates',
        },
        orders: {
          'GET /orders': 'List customer orders',
          'GET /orders/:id': 'Get order details',
          'GET /orders/:id/status': 'Get order status timeline',
          'GET /orders/:id/tracking': 'Get tracking info',
          'POST /orders/:id/cancel': 'Cancel order',
          'POST /orders/:id/deliver': 'Simulate delivery (testing)',
        },
      },
      headers: {
        'X-Customer-ID': 'Customer identifier (optional, defaults to demo-customer)',
      },
      promoCodes: [
        { code: 'SAVE10', description: '$10 off' },
        { code: 'SAVE20', description: '20% off' },
        { code: 'FREESHIP', description: 'Free shipping' },
        { code: 'WELCOME15', description: '15% off for new customers' },
      ],
    })
  })

  // ============================================================================
  // CART ENDPOINTS
  // ============================================================================

  app.get('/cart', async (c) => {
    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'getCart')
    return c.json(cart)
  })

  app.get('/cart/summary', async (c) => {
    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const summary = await callDO(stub, 'getSummary')
    return c.json(summary)
  })

  app.post('/cart/items', async (c) => {
    const item = await c.req.json<CartItem>()

    if (!item.sku || !item.name || !item.price || !item.quantity) {
      return c.json({ error: 'sku, name, price, and quantity are required' }, 400)
    }

    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'addItem', item)
    return c.json({ success: true, cart }, 201)
  })

  app.put('/cart/items/:sku', async (c) => {
    const sku = c.req.param('sku')
    const body = await c.req.json<{ quantity: number }>()

    if (typeof body.quantity !== 'number') {
      return c.json({ error: 'quantity is required' }, 400)
    }

    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))

    try {
      const cart = await callDO(stub, 'updateItem', { sku, quantity: body.quantity })
      return c.json({ success: true, cart })
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  app.delete('/cart/items/:sku', async (c) => {
    const sku = c.req.param('sku')
    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))

    try {
      const cart = await callDO(stub, 'removeItem', sku)
      return c.json({ success: true, cart })
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  app.delete('/cart', async (c) => {
    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    await callDO(stub, 'clear')
    return c.json({ success: true, message: 'Cart cleared' })
  })

  app.put('/cart/shipping-address', async (c) => {
    const address = await c.req.json<Address>()

    if (!address.street || !address.city || !address.state || !address.zip || !address.country) {
      return c.json({ error: 'street, city, state, zip, and country are required' }, 400)
    }

    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'setShippingAddress', address)
    return c.json({ success: true, cart })
  })

  app.put('/cart/billing-address', async (c) => {
    const address = await c.req.json<Address>()

    if (!address.street || !address.city || !address.state || !address.zip || !address.country) {
      return c.json({ error: 'street, city, state, zip, and country are required' }, 400)
    }

    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'setBillingAddress', address)
    return c.json({ success: true, cart })
  })

  app.put('/cart/shipping-method', async (c) => {
    const body = await c.req.json<{ method: string }>()

    if (!body.method) {
      return c.json({ error: 'method is required (ground, express, overnight)' }, 400)
    }

    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'setShippingMethod', body.method)
    return c.json({ success: true, cart })
  })

  app.post('/cart/promo', async (c) => {
    const body = await c.req.json<{ code: string }>()

    if (!body.code) {
      return c.json({ error: 'code is required' }, 400)
    }

    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'setPromoCode', body.code)
    return c.json({ success: true, cart, message: 'Promo code applied (validated at checkout)' })
  })

  app.delete('/cart/promo', async (c) => {
    const customerId = getCustomerId(c)
    const stub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cart = await callDO(stub, 'removePromoCode')
    return c.json({ success: true, cart })
  })

  // ============================================================================
  // INVENTORY ENDPOINTS
  // ============================================================================

  app.get('/inventory', async (c) => {
    const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('inventory'))
    const stocks = await callDO(stub, 'getAllStock')
    return c.json({ stocks })
  })

  app.get('/inventory/:sku', async (c) => {
    const sku = c.req.param('sku')
    const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('inventory'))
    const stock = await callDO(stub, 'getStock', sku)

    if (!stock) {
      return c.json({ error: 'Product not found' }, 404)
    }

    return c.json(stock)
  })

  app.post('/inventory', async (c) => {
    const body = await c.req.json<{
      sku: string
      name: string
      quantity: number
      lowStockThreshold?: number
    }>()

    if (!body.sku || !body.name || body.quantity === undefined) {
      return c.json({ error: 'sku, name, and quantity are required' }, 400)
    }

    const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('inventory'))
    const stock = await callDO(stub, 'setStock', body)
    return c.json({ success: true, stock }, 201)
  })

  app.put('/inventory/:sku', async (c) => {
    const sku = c.req.param('sku')
    const body = await c.req.json<{ adjustment: number }>()

    if (typeof body.adjustment !== 'number') {
      return c.json({ error: 'adjustment is required' }, 400)
    }

    const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('inventory'))

    try {
      const stock = await callDO(stub, 'adjustStock', { sku, adjustment: body.adjustment })
      return c.json({ success: true, stock })
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  app.get('/inventory/check', async (c) => {
    const items = c.req.query('items')
    if (!items) {
      return c.json({ error: 'items query parameter required' }, 400)
    }

    const parsedItems = JSON.parse(items) as Array<{ sku: string; quantity: number }>
    const stub = c.env.INVENTORY.get(c.env.INVENTORY.idFromName('inventory'))
    const result = await callDO(stub, 'checkAvailability', parsedItems)
    return c.json(result)
  })

  // ============================================================================
  // CHECKOUT ENDPOINTS
  // ============================================================================

  app.post('/checkout/sessions', async (c) => {
    const customerId = getCustomerId(c)

    // Get cart data
    const cartStub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cartSummary = await callDO<{
      id: string
      items: CartItem[]
      shippingAddress?: Address
      billingAddress?: Address
      shippingMethod?: string
      promoCode?: string
    }>(cartStub, 'getSummary')

    if (!cartSummary.items.length) {
      return c.json({ error: 'Cart is empty' }, 400)
    }

    if (!cartSummary.shippingAddress) {
      return c.json({ error: 'Shipping address required' }, 400)
    }

    // Create checkout session
    const sessionId = `ses_${crypto.randomUUID().slice(0, 8)}`
    const checkoutStub = c.env.CHECKOUT.get(c.env.CHECKOUT.idFromName(sessionId))

    const session = await callDO(checkoutStub, 'createSession', {
      customerId,
      cartData: cartSummary,
    })

    return c.json({
      success: true,
      session,
      message: 'Checkout session created',
      nextSteps: [
        'GET /checkout/sessions/:id/totals - Calculate final totals',
        'POST /checkout/sessions/:id/complete - Complete checkout with payment',
      ],
    }, 201)
  })

  app.get('/checkout/sessions/:id', async (c) => {
    const sessionId = c.req.param('id')
    const checkoutStub = c.env.CHECKOUT.get(c.env.CHECKOUT.idFromName(sessionId))

    const session = await callDO(checkoutStub, 'getSession')
    if (!session) {
      return c.json({ error: 'Session not found' }, 404)
    }

    return c.json(session)
  })

  app.get('/checkout/sessions/:id/totals', async (c) => {
    const sessionId = c.req.param('id')
    const checkoutStub = c.env.CHECKOUT.get(c.env.CHECKOUT.idFromName(sessionId))

    try {
      const totals = await callDO(checkoutStub, 'calculateTotals')
      return c.json(totals)
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  app.post('/checkout/sessions/:id/complete', async (c) => {
    const sessionId = c.req.param('id')
    const body = await c.req.json<{ paymentMethod: PaymentMethod }>()

    if (!body.paymentMethod?.type || !body.paymentMethod?.token) {
      return c.json({ error: 'paymentMethod with type and token is required' }, 400)
    }

    const checkoutStub = c.env.CHECKOUT.get(c.env.CHECKOUT.idFromName(sessionId))

    try {
      const result = await callDO<{ orderId: string; paymentId: string; total: number }>(
        checkoutStub,
        'processCheckout',
        body.paymentMethod
      )

      return c.json({
        success: true,
        message: 'Order placed successfully',
        ...result,
        sagaSteps: [
          'Inventory reserved',
          'Payment processed',
          'Inventory committed',
          'Order created',
          'Cart cleared',
          'Fulfillment started',
        ],
      }, 201)
    } catch (e) {
      if (e instanceof APIError) {
        return c.json(
          {
            error: e.message,
            code: e.code,
            details: e.details,
            compensation: 'Inventory released, payment refunded if charged',
          },
          e.statusCode
        )
      }
      throw e
    }
  })

  app.delete('/checkout/sessions/:id', async (c) => {
    const sessionId = c.req.param('id')
    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }))

    const checkoutStub = c.env.CHECKOUT.get(c.env.CHECKOUT.idFromName(sessionId))

    try {
      await callDO(checkoutStub, 'cancel', body.reason ?? 'Customer cancelled')
      return c.json({ success: true, message: 'Session cancelled' })
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  app.get('/shipping/rates', async (c) => {
    const customerId = getCustomerId(c)
    const cartStub = c.env.CART.get(c.env.CART.idFromName(customerId))
    const cartSummary = await callDO<{
      items: CartItem[]
      shippingAddress?: Address
    }>(cartStub, 'getSummary')

    if (!cartSummary.shippingAddress) {
      return c.json({ error: 'Shipping address required' }, 400)
    }

    if (!cartSummary.items.length) {
      return c.json({ error: 'Cart is empty' }, 400)
    }

    // Create a temporary checkout session to calculate rates
    const tempSessionId = `temp_${crypto.randomUUID().slice(0, 8)}`
    const checkoutStub = c.env.CHECKOUT.get(c.env.CHECKOUT.idFromName(tempSessionId))

    const rates = await callDO(checkoutStub, 'getShippingRates', {
      address: cartSummary.shippingAddress,
      items: cartSummary.items,
    })

    return c.json({ rates })
  })

  // ============================================================================
  // ORDER ENDPOINTS
  // ============================================================================

  app.get('/orders', async (c) => {
    const customerId = getCustomerId(c)

    // In production: query an index or use a CustomerDO to track order IDs
    // For demo: return a message about how to get specific orders
    return c.json({
      message: 'Get specific order by ID',
      usage: 'GET /orders/:orderId',
      note: 'Order IDs are returned when completing checkout',
    })
  })

  app.get('/orders/:id', async (c) => {
    const orderId = c.req.param('id')
    const orderStub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))

    const order = await callDO(orderStub, 'getOrder')
    if (!order) {
      return c.json({ error: 'Order not found' }, 404)
    }

    return c.json(order)
  })

  app.get('/orders/:id/status', async (c) => {
    const orderId = c.req.param('id')
    const orderStub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))

    const status = await callDO(orderStub, 'getStatus')
    if (!status) {
      return c.json({ error: 'Order not found' }, 404)
    }

    return c.json({ orderId, ...status })
  })

  app.get('/orders/:id/tracking', async (c) => {
    const orderId = c.req.param('id')
    const orderStub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))

    const tracking = await callDO(orderStub, 'getTracking')
    if (!tracking) {
      return c.json({ error: 'Order not found' }, 404)
    }

    return c.json({ orderId, ...tracking })
  })

  app.post('/orders/:id/cancel', async (c) => {
    const orderId = c.req.param('id')
    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }))

    const orderStub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))

    try {
      await callDO(orderStub, 'cancel', body.reason ?? 'Customer requested cancellation')
      return c.json({
        success: true,
        message: 'Order cancellation initiated',
        compensationEvents: [
          'Inventory.release',
          'Payment.refund',
          'Email.sendCancellation',
        ],
      })
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  app.post('/orders/:id/deliver', async (c) => {
    const orderId = c.req.param('id')
    const orderStub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))

    try {
      await callDO(orderStub, 'markDelivered')
      return c.json({
        success: true,
        message: 'Delivery simulated',
        events: ['Order.delivered', 'Review.requested (scheduled for 3 days later)'],
      })
    } catch (e) {
      if (e instanceof APIError) {
        return c.json({ error: e.message, code: e.code }, e.statusCode)
      }
      throw e
    }
  })

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // ============================================================================
  // ERROR HANDLER
  // ============================================================================

  app.onError((err, c) => {
    console.error('Error:', err)

    if (err instanceof APIError) {
      return c.json({ error: err.message, code: err.code, details: err.details }, err.statusCode)
    }

    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
