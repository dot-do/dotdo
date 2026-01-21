// E-commerce Checkout Durable Object
// Demonstrates: Cart management, checkout flow, payment simulation, order tracking
// Key patterns: $.on.Noun.verb event handlers, $.every scheduling, $.do durable actions

import { Hono } from 'hono'
import { DO, type DOEnv } from '../../do'
import type {
  Product,
  Cart,
  CartItem,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  Customer,
  ShippingAddress,
} from './types'

// Constants
const TAX_RATE = 0.08 // 8% tax

export class EcommerceDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    // $ is already initialized in the base DO class

    // ========================================================================
    // Event Handlers using $.on.Noun.verb pattern
    // These demonstrate the core dotdo event-driven architecture
    // ========================================================================

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = this.$.on as any

    // Handle order creation - send confirmation email
    on.Order.created(async (event: unknown) => {
      const e = event as { payload: unknown }
      const { orderId, customerId, total } = e.payload as {
        orderId: string
        customerId: string
        total: number
      }
      console.log(`[Event] Order created: ${orderId} for customer ${customerId}, total: $${total}`)
      // In production: send order confirmation email via $.do for durability
    })

    // Handle payment completion - update inventory and notify
    on.Payment.completed(async (event: unknown) => {
      const e = event as { payload: unknown }
      const { orderId, paymentId } = e.payload as {
        orderId: string
        paymentId: string
      }
      console.log(`[Event] Payment completed for order ${orderId}, payment: ${paymentId}`)
      // In production: trigger fulfillment workflow
    })

    // Handle payment failure - notify customer
    on.Payment.failed(async (event: unknown) => {
      const e = event as { payload: unknown }
      const { orderId, reason } = e.payload as {
        orderId: string
        paymentId: string
        reason: string
      }
      console.log(`[Event] Payment failed for order ${orderId}: ${reason}`)
      // In production: send payment failure notification
    })

    // Handle cart item added - track analytics
    on.Cart.itemAdded(async (event: unknown) => {
      const e = event as { payload: unknown }
      const { cartId, productId, quantity } = e.payload as {
        cartId: string
        productId: string
        quantity: number
      }
      console.log(`[Event] Item added to cart ${cartId}: ${productId} x${quantity}`)
    })

    // Wildcard handler - log all events for debugging
    on['*']['*'](async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      console.log(`[Audit] Event: ${e.type}`, e.payload)
    })

    // ========================================================================
    // Scheduled Tasks using $.every pattern
    // ========================================================================

    // Every day at midnight - clean up abandoned carts
    const everyDay = this.$.every.day as unknown as { atmidnight: (handler: () => Promise<void>) => void }
    everyDay.atmidnight(async () => {
      console.log('[Scheduled] Cleaning up abandoned carts...')
      const carts = await this.things.list({ type: 'Cart' })
      const now = Date.now()
      const abandonedThreshold = 24 * 60 * 60 * 1000 // 24 hours

      for (const cart of carts) {
        const cartData = cart as unknown as Cart
        if (cartData.status === 'active') {
          // Check if cart is old (in production, check $updatedAt)
          // Mark as abandoned if not checked out
        }
      }
    })

    // Every hour - check for pending payment retries
    const everyHour = this.$.every as unknown as { hour: (handler: () => Promise<void>) => void }
    everyHour.hour(async () => {
      console.log('[Scheduled] Checking for payment retries...')
      const orders = await this.things.list({ type: 'Order' })
      for (const order of orders) {
        const orderData = order as unknown as Order
        if (orderData.status === 'payment_failed') {
          // In production: attempt retry or notify customer
        }
      }
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Product Catalog
    // ========================================================================

    // List products
    app.get('/products', async (c) => {
      const products = await this.things.list({ type: 'Product' })
      return c.json(products)
    })

    // Get single product
    app.get('/products/:id', async (c) => {
      const product = await this.things.get(c.req.param('id'))
      if (!product || product.$type !== 'Product') {
        return c.json({ error: 'Product not found' }, 404)
      }
      return c.json(product)
    })

    // Create product (admin)
    app.post('/products', async (c) => {
      const data = await c.req.json<Omit<Product, '$type'>>()
      const product = await this.things.create({
        $type: 'Product',
        ...data,
      })
      return c.json(product, 201)
    })

    // Update product inventory
    app.patch('/products/:id/inventory', async (c) => {
      const { quantity } = await c.req.json<{ quantity: number }>()
      const product = await this.things.update(c.req.param('id'), {
        inventory: quantity,
      })
      return c.json(product)
    })

    // ========================================================================
    // Cart Management
    // ========================================================================

    // Get or create cart for customer
    app.get('/cart/:customerId', async (c) => {
      const customerId = c.req.param('customerId')
      const carts = await this.things.list({ type: 'Cart' })
      let cart = carts.find(
        (t) => (t as unknown as Cart).customerId === customerId &&
               (t as unknown as Cart).status === 'active'
      )

      if (!cart) {
        cart = await this.things.create({
          $type: 'Cart',
          customerId,
          items: [],
          total: 0,
          status: 'active',
        })
      }

      return c.json(cart)
    })

    // Add item to cart
    app.post('/cart/:customerId/items', async (c) => {
      const customerId = c.req.param('customerId')
      const { productId, quantity = 1 } = await c.req.json<{
        productId: string
        quantity?: number
      }>()

      // Get product
      const product = await this.things.get(productId)
      if (!product || product.$type !== 'Product') {
        return c.json({ error: 'Product not found' }, 404)
      }

      const productData = product as unknown as Product
      if (productData.inventory < quantity) {
        return c.json({ error: 'Insufficient inventory' }, 400)
      }

      // Get or create cart
      const carts = await this.things.list({ type: 'Cart' })
      let cart = carts.find(
        (t) => (t as unknown as Cart).customerId === customerId &&
               (t as unknown as Cart).status === 'active'
      )

      if (!cart) {
        cart = await this.things.create({
          $type: 'Cart',
          customerId,
          items: [],
          total: 0,
          status: 'active',
        })
      }

      const cartData = cart as unknown as Cart
      const existingItem = cartData.items.find((i) => i.productId === productId)

      let updatedItems: CartItem[]
      if (existingItem) {
        updatedItems = cartData.items.map((i) =>
          i.productId === productId
            ? { ...i, quantity: i.quantity + quantity }
            : i
        )
      } else {
        const newItem: CartItem = {
          $type: 'CartItem',
          productId,
          quantity,
          price: productData.price,
          name: productData.name,
        }
        updatedItems = [...cartData.items, newItem]
      }

      const total = updatedItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      )

      const updatedCart = await this.things.update(cart.$id, {
        items: updatedItems as unknown as import('@dotdo/db').JsonValue,
        total,
      })

      // Fire event using $.send (fire-and-forget) - triggers event handlers
      this.$.send({
        type: 'Cart.itemAdded',
        payload: { cartId: cart.$id, productId, quantity },
      })

      return c.json(updatedCart)
    })

    // Update item quantity
    app.patch('/cart/:customerId/items/:productId', async (c) => {
      const customerId = c.req.param('customerId')
      const productId = c.req.param('productId')
      const { quantity } = await c.req.json<{ quantity: number }>()

      const carts = await this.things.list({ type: 'Cart' })
      const cart = carts.find(
        (t) => (t as unknown as Cart).customerId === customerId &&
               (t as unknown as Cart).status === 'active'
      )

      if (!cart) {
        return c.json({ error: 'Cart not found' }, 404)
      }

      const cartData = cart as unknown as Cart

      if (quantity <= 0) {
        // Remove item
        const updatedItems = cartData.items.filter(
          (i) => i.productId !== productId
        )
        const total = updatedItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        )
        const updatedCart = await this.things.update(cart.$id, {
          items: updatedItems as unknown as import('@dotdo/db').JsonValue,
          total,
        })
        return c.json(updatedCart)
      }

      // Check inventory
      const product = await this.things.get(productId)
      if (product && (product as unknown as Product).inventory < quantity) {
        return c.json({ error: 'Insufficient inventory' }, 400)
      }

      const updatedItems = cartData.items.map((i) =>
        i.productId === productId ? { ...i, quantity } : i
      )
      const total = updatedItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      )

      const updatedCart = await this.things.update(cart.$id, {
        items: updatedItems as unknown as import('@dotdo/db').JsonValue,
        total,
      })

      return c.json(updatedCart)
    })

    // Remove item from cart
    app.delete('/cart/:customerId/items/:productId', async (c) => {
      const customerId = c.req.param('customerId')
      const productId = c.req.param('productId')

      const carts = await this.things.list({ type: 'Cart' })
      const cart = carts.find(
        (t) => (t as unknown as Cart).customerId === customerId &&
               (t as unknown as Cart).status === 'active'
      )

      if (!cart) {
        return c.json({ error: 'Cart not found' }, 404)
      }

      const cartData = cart as unknown as Cart
      const updatedItems = cartData.items.filter(
        (i) => i.productId !== productId
      )
      const total = updatedItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      )

      const updatedCart = await this.things.update(cart.$id, {
        items: updatedItems as unknown as import('@dotdo/db').JsonValue,
        total,
      })

      // Fire event using $.send (fire-and-forget)
      this.$.send({
        type: 'Cart.itemRemoved',
        payload: { cartId: cart.$id, productId },
      })

      return c.json(updatedCart)
    })

    // ========================================================================
    // Checkout Flow
    // ========================================================================

    // Initiate checkout
    app.post('/checkout/:customerId', async (c) => {
      const customerId = c.req.param('customerId')
      const { shippingAddress } = await c.req.json<{
        shippingAddress: ShippingAddress
      }>()

      // Get active cart
      const carts = await this.things.list({ type: 'Cart' })
      const cart = carts.find(
        (t) => (t as unknown as Cart).customerId === customerId &&
               (t as unknown as Cart).status === 'active'
      )

      if (!cart) {
        return c.json({ error: 'Cart not found' }, 404)
      }

      const cartData = cart as unknown as Cart
      if (cartData.items.length === 0) {
        return c.json({ error: 'Cart is empty' }, 400)
      }

      // Verify inventory for all items
      for (const item of cartData.items) {
        const product = await this.things.get(item.productId)
        if (!product) {
          return c.json({ error: `Product ${item.productId} not found` }, 400)
        }
        if ((product as unknown as Product).inventory < item.quantity) {
          return c.json(
            { error: `Insufficient inventory for ${item.name}` },
            400
          )
        }
      }

      // Calculate totals
      const subtotal = cartData.total
      const tax = Math.round(subtotal * TAX_RATE * 100) / 100
      const total = subtotal + tax

      // Create order
      const orderItems: OrderItem[] = cartData.items.map((item) => ({
        productId: item.productId,
        productName: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        total: item.price * item.quantity,
      }))

      const order = await this.things.create({
        $type: 'Order',
        customerId,
        cartId: cart.$id,
        items: orderItems as unknown as import('@dotdo/db').JsonValue,
        subtotal,
        tax,
        total,
        status: 'pending' as OrderStatus,
        shippingAddress: shippingAddress as unknown as import('@dotdo/db').JsonValue,
      })

      // Mark cart as checked out
      await this.things.update(cart.$id, { status: 'checked_out' })

      // Fire event using $.send - triggers $.on.Order.created handler
      this.$.send({
        type: 'Order.created',
        payload: { orderId: order.$id, customerId, total },
      })

      // Add relationship
      await this.relationships.add({
        subject: customerId,
        predicate: 'placed',
        object: order.$id,
      })

      return c.json(order, 201)
    })

    // Process payment (simulated)
    app.post('/orders/:orderId/pay', async (c) => {
      const orderId = c.req.param('orderId')
      const { paymentMethod } = await c.req.json<{
        paymentMethod: 'card' | 'bank'
      }>()

      const order = await this.things.get(orderId)
      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }

      const orderData = order as unknown as Order
      if (orderData.status !== 'pending') {
        return c.json({ error: 'Order is not pending' }, 400)
      }

      // Update order status to processing
      await this.things.update(orderId, { status: 'payment_processing' })

      // Create payment record
      const payment = await this.things.create({
        $type: 'Payment',
        orderId,
        amount: orderData.total,
        status: 'processing',
        provider: paymentMethod === 'card' ? 'stripe' : 'plaid',
      })

      // Simulate payment processing (90% success rate)
      const success = Math.random() < 0.9

      if (success) {
        // Update payment
        await this.things.update(payment.$id, {
          status: 'completed',
          transactionId: `txn_${Date.now()}`,
        })

        // Update order
        await this.things.update(orderId, {
          status: 'paid',
          paymentId: payment.$id,
        })

        // Deduct inventory
        for (const item of orderData.items) {
          const product = await this.things.get(item.productId)
          if (product) {
            const currentInventory = (product as unknown as Product).inventory
            await this.things.update(item.productId, {
              inventory: currentInventory - item.quantity,
            })
          }
        }

        // Fire event - triggers $.on.Payment.completed handler
        this.$.send({
          type: 'Payment.completed',
          payload: { orderId, paymentId: payment.$id },
        })

        return c.json({
          success: true,
          order: await this.things.get(orderId),
          payment: await this.things.get(payment.$id),
        })
      } else {
        // Payment failed
        await this.things.update(payment.$id, {
          status: 'failed',
          errorMessage: 'Payment declined',
        })

        await this.things.update(orderId, { status: 'payment_failed' })

        // Fire event - triggers $.on.Payment.failed handler
        this.$.send({
          type: 'Payment.failed',
          payload: { orderId, paymentId: payment.$id, reason: 'declined' },
        })

        return c.json(
          {
            success: false,
            error: 'Payment declined',
            order: await this.things.get(orderId),
          },
          400
        )
      }
    })

    // ========================================================================
    // Order Tracking
    // ========================================================================

    // Get order
    app.get('/orders/:orderId', async (c) => {
      const order = await this.things.get(c.req.param('orderId'))
      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }
      return c.json(order)
    })

    // List orders for customer
    app.get('/customers/:customerId/orders', async (c) => {
      const customerId = c.req.param('customerId')
      const orderIds = await this.relationships.getRelated(customerId, 'placed')
      const orders = await Promise.all(
        orderIds.map((id) => this.things.get(id))
      )
      return c.json(orders.filter(Boolean))
    })

    // Update order status (fulfillment)
    app.patch('/orders/:orderId/status', async (c) => {
      const orderId = c.req.param('orderId')
      const { status } = await c.req.json<{ status: OrderStatus }>()

      const order = await this.things.get(orderId)
      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }

      const updatedOrder = await this.things.update(orderId, { status })

      // Fire event - dynamic event type based on status (e.g., Order.shipped)
      this.$.send({
        type: `Order.${status}`,
        payload: { orderId, status },
      })

      return c.json(updatedOrder)
    })

    // Get order history (events)
    app.get('/orders/:orderId/history', async (c) => {
      const orderId = c.req.param('orderId')
      const events = await this.events.query({ source: orderId })
      return c.json(events)
    })

    // ========================================================================
    // Customer Management
    // ========================================================================

    // Create customer
    app.post('/customers', async (c) => {
      const data = await c.req.json<Omit<Customer, '$type'>>()
      const customerData: Record<string, import('@dotdo/db').JsonValue> = {
        $type: 'Customer',
        name: data.name,
        email: data.email,
      }
      if (data.defaultShippingAddress) {
        customerData.defaultShippingAddress = data.defaultShippingAddress as unknown as import('@dotdo/db').JsonValue
      }
      const customer = await this.things.create(customerData as { $type: string })
      return c.json(customer, 201)
    })

    // Get customer
    app.get('/customers/:id', async (c) => {
      const customer = await this.things.get(c.req.param('id'))
      if (!customer || customer.$type !== 'Customer') {
        return c.json({ error: 'Customer not found' }, 404)
      }
      return c.json(customer)
    })
  }
}

// Export for worker binding
export { EcommerceDO as DO }
