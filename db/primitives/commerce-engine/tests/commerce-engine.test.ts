/**
 * CommerceEngine Tests - TDD RED Phase
 *
 * E-commerce primitives for products, carts, orders, pricing, and inventory.
 * Following the pattern from the ticket:
 *
 * ```typescript
 * import { CommerceEngine, Product, Cart, Order } from './commerce-engine'
 *
 * const commerce = new CommerceEngine()
 *
 * // Products
 * const product = await commerce.products.create({
 *   name: 'Widget Pro',
 *   slug: 'widget-pro',
 *   price: { amount: 9999, currency: 'USD' },
 *   variants: [
 *     { sku: 'WP-SM', name: 'Small', inventory: 100 },
 *     { sku: 'WP-LG', name: 'Large', inventory: 50 },
 *   ],
 * })
 *
 * // Carts
 * const cart = await commerce.carts.create({ customerId: 'cust_123' })
 * await commerce.carts.addItem(cart.id, { productId: product.id, variantId: 'WP-SM', quantity: 2 })
 * await commerce.carts.applyDiscount(cart.id, 'SAVE10')
 *
 * // Checkout
 * const order = await commerce.checkout(cart.id, {
 *   shippingAddress: { ... },
 *   paymentMethod: 'pm_xxx',
 * })
 *
 * // Order lifecycle
 * await commerce.orders.fulfill(order.id, { trackingNumber: '1Z999...' })
 * await commerce.orders.refund(order.id, { amount: 1000, reason: 'damaged' })
 *
 * // Inventory
 * await commerce.inventory.reserve('WP-SM', 5, { orderId: order.id })
 * await commerce.inventory.adjust('WP-SM', -2, { reason: 'shrinkage' })
 * ```
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createCommerceEngine,
  CommerceEngine,
  type Product,
  type ProductVariant,
  type Cart,
  type CartItem,
  type Order,
  type OrderStatus,
  type Price,
  type Discount,
  type Address,
  type InventoryLevel,
  type InventoryReservation,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEngine(): CommerceEngine {
  return createCommerceEngine()
}

function createTestProduct(engine: CommerceEngine) {
  return engine.products.create({
    name: 'Widget Pro',
    slug: 'widget-pro',
    price: { amount: 9999, currency: 'USD' },
  })
}

function createTestProductWithVariants(engine: CommerceEngine) {
  return engine.products.create({
    name: 'Widget Pro',
    slug: 'widget-pro',
    price: { amount: 9999, currency: 'USD' },
    variants: [
      { sku: 'WP-SM', name: 'Small', inventory: 100 },
      { sku: 'WP-LG', name: 'Large', inventory: 50 },
    ],
  })
}

const testAddress: Address = {
  line1: '123 Main St',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  country: 'US',
}

// =============================================================================
// Products Tests
// =============================================================================

describe('CommerceEngine', () => {
  describe('products', () => {
    let engine: CommerceEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should create a product', async () => {
      const product = await engine.products.create({
        name: 'Widget Pro',
        slug: 'widget-pro',
        price: { amount: 9999, currency: 'USD' },
      })

      expect(product.id).toBeDefined()
      expect(product.name).toBe('Widget Pro')
      expect(product.slug).toBe('widget-pro')
      expect(product.price.amount).toBe(9999)
      expect(product.price.currency).toBe('USD')
      expect(product.status).toBe('draft')
      expect(product.createdAt).toBeInstanceOf(Date)
    })

    it('should create a product with variants', async () => {
      const product = await engine.products.create({
        name: 'Widget Pro',
        slug: 'widget-pro',
        price: { amount: 9999, currency: 'USD' },
        variants: [
          { sku: 'WP-SM', name: 'Small', inventory: 100 },
          { sku: 'WP-LG', name: 'Large', inventory: 50 },
        ],
      })

      expect(product.variants).toHaveLength(2)
      expect(product.variants![0].sku).toBe('WP-SM')
      expect(product.variants![0].name).toBe('Small')
      expect(product.variants![1].sku).toBe('WP-LG')
    })

    it('should get a product by id', async () => {
      const created = await createTestProduct(engine)
      const retrieved = await engine.products.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent product', async () => {
      const result = await engine.products.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should get a product by slug', async () => {
      await engine.products.create({
        name: 'Widget',
        slug: 'my-widget',
        price: { amount: 1000, currency: 'USD' },
      })

      const product = await engine.products.getBySlug('my-widget')
      expect(product?.name).toBe('Widget')
    })

    it('should update a product', async () => {
      const product = await createTestProduct(engine)

      const updated = await engine.products.update(product.id, {
        name: 'Widget Pro Plus',
        price: { amount: 12999, currency: 'USD' },
      })

      expect(updated.name).toBe('Widget Pro Plus')
      expect(updated.price.amount).toBe(12999)
      expect(updated.updatedAt).toBeInstanceOf(Date)
    })

    it('should throw when updating non-existent product', async () => {
      await expect(
        engine.products.update('nonexistent', { name: 'Test' })
      ).rejects.toThrow('Product not found')
    })

    it('should delete a product', async () => {
      const product = await createTestProduct(engine)
      await engine.products.delete(product.id)

      const result = await engine.products.get(product.id)
      expect(result).toBeNull()
    })

    it('should list all products', async () => {
      await createTestProduct(engine)
      await engine.products.create({
        name: 'Widget Basic',
        slug: 'widget-basic',
        price: { amount: 4999, currency: 'USD' },
      })

      const products = await engine.products.list()
      expect(products).toHaveLength(2)
    })

    it('should publish a product', async () => {
      const product = await createTestProduct(engine)
      expect(product.status).toBe('draft')

      const published = await engine.products.publish(product.id)
      expect(published.status).toBe('active')
      expect(published.publishedAt).toBeInstanceOf(Date)
    })

    it('should archive a product', async () => {
      const product = await createTestProduct(engine)
      await engine.products.publish(product.id)

      const archived = await engine.products.archive(product.id)
      expect(archived.status).toBe('archived')
    })

    // Variant management
    describe('variants', () => {
      it('should add a variant to existing product', async () => {
        const product = await createTestProduct(engine)

        const variant = await engine.products.addVariant(product.id, {
          sku: 'WP-XL',
          name: 'Extra Large',
          inventory: 25,
        })

        expect(variant.sku).toBe('WP-XL')
        expect(variant.productId).toBe(product.id)
      })

      it('should update a variant', async () => {
        const product = await createTestProductWithVariants(engine)
        const variant = product.variants![0]

        const updated = await engine.products.updateVariant(variant.id, {
          name: 'Small (Updated)',
          priceOverride: { amount: 8999, currency: 'USD' },
        })

        expect(updated.name).toBe('Small (Updated)')
        expect(updated.priceOverride?.amount).toBe(8999)
      })

      it('should delete a variant', async () => {
        const product = await createTestProductWithVariants(engine)
        const variantId = product.variants![0].id

        await engine.products.deleteVariant(variantId)

        const updated = await engine.products.get(product.id)
        expect(updated?.variants).toHaveLength(1)
      })

      it('should find variant by SKU', async () => {
        await createTestProductWithVariants(engine)

        const variant = await engine.products.findVariantBySku('WP-SM')
        expect(variant).not.toBeNull()
        expect(variant?.name).toBe('Small')
      })

      it('should enforce unique SKUs', async () => {
        const product = await createTestProductWithVariants(engine)

        await expect(
          engine.products.addVariant(product.id, {
            sku: 'WP-SM', // Already exists
            name: 'Duplicate',
          })
        ).rejects.toThrow('SKU already exists')
      })
    })

    // Inventory tracking on products
    describe('inventory on products', () => {
      it('should track inventory for simple product', async () => {
        const product = await engine.products.create({
          name: 'Simple Product',
          slug: 'simple',
          price: { amount: 1000, currency: 'USD' },
          inventory: 50,
        })

        expect(product.inventory).toBe(50)
      })

      it('should track inventory per variant', async () => {
        const product = await createTestProductWithVariants(engine)

        expect(product.variants![0].inventory).toBe(100)
        expect(product.variants![1].inventory).toBe(50)
      })
    })
  })

  // =============================================================================
  // Carts Tests
  // =============================================================================

  describe('carts', () => {
    let engine: CommerceEngine
    let product: Product

    beforeEach(async () => {
      engine = createTestEngine()
      product = await createTestProductWithVariants(engine)
      await engine.products.publish(product.id)
    })

    it('should create an empty cart', async () => {
      const cart = await engine.carts.create()

      expect(cart.id).toBeDefined()
      expect(cart.items).toEqual([])
      expect(cart.subtotal).toBe(0)
      expect(cart.total).toBe(0)
      expect(cart.status).toBe('active')
    })

    it('should create a cart with customer id', async () => {
      const cart = await engine.carts.create({ customerId: 'cust_123' })
      expect(cart.customerId).toBe('cust_123')
    })

    it('should get a cart by id', async () => {
      const cart = await engine.carts.create()
      const retrieved = await engine.carts.get(cart.id)

      expect(retrieved?.id).toBe(cart.id)
    })

    it('should add item to cart', async () => {
      const cart = await engine.carts.create()

      const item = await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 2,
      })

      expect(item.productId).toBe(product.id)
      expect(item.quantity).toBe(2)
      expect(item.price).toBe(9999) // Uses product price

      const updatedCart = await engine.carts.get(cart.id)
      expect(updatedCart?.items).toHaveLength(1)
      expect(updatedCart?.subtotal).toBe(19998) // 9999 * 2
    })

    it('should update item quantity', async () => {
      const cart = await engine.carts.create()
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 1,
      })

      await engine.carts.updateItemQuantity(cart.id, product.variants![0].id, 5)

      const updatedCart = await engine.carts.get(cart.id)
      expect(updatedCart?.items[0].quantity).toBe(5)
      expect(updatedCart?.subtotal).toBe(49995)
    })

    it('should remove item from cart', async () => {
      const cart = await engine.carts.create()
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 1,
      })

      await engine.carts.removeItem(cart.id, product.variants![0].id)

      const updatedCart = await engine.carts.get(cart.id)
      expect(updatedCart?.items).toHaveLength(0)
    })

    it('should clear cart', async () => {
      const cart = await engine.carts.create()
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 1,
      })

      await engine.carts.clear(cart.id)

      const cleared = await engine.carts.get(cart.id)
      expect(cleared?.items).toHaveLength(0)
      expect(cleared?.subtotal).toBe(0)
    })

    // Discount application
    describe('discounts', () => {
      it('should apply percentage discount code', async () => {
        // Create a discount
        await engine.pricing.createDiscount({
          code: 'SAVE10',
          type: 'percentage',
          value: 10, // 10% off
        })

        const cart = await engine.carts.create()
        await engine.carts.addItem(cart.id, {
          productId: product.id,
          variantId: product.variants![0].id,
          quantity: 1,
        })

        await engine.carts.applyDiscount(cart.id, 'SAVE10')

        const updatedCart = await engine.carts.get(cart.id)
        expect(updatedCart?.discounts).toHaveLength(1)
        expect(updatedCart?.discountTotal).toBe(999) // 10% of 9999
        expect(updatedCart?.total).toBe(9000) // 9999 - 999
      })

      it('should apply fixed amount discount', async () => {
        await engine.pricing.createDiscount({
          code: 'FLAT1000',
          type: 'fixed',
          value: 1000, // $10.00 off
        })

        const cart = await engine.carts.create()
        await engine.carts.addItem(cart.id, {
          productId: product.id,
          variantId: product.variants![0].id,
          quantity: 1,
        })

        await engine.carts.applyDiscount(cart.id, 'FLAT1000')

        const updatedCart = await engine.carts.get(cart.id)
        expect(updatedCart?.discountTotal).toBe(1000)
        expect(updatedCart?.total).toBe(8999)
      })

      it('should remove discount from cart', async () => {
        await engine.pricing.createDiscount({
          code: 'SAVE10',
          type: 'percentage',
          value: 10,
        })

        const cart = await engine.carts.create()
        await engine.carts.addItem(cart.id, {
          productId: product.id,
          variantId: product.variants![0].id,
          quantity: 1,
        })
        await engine.carts.applyDiscount(cart.id, 'SAVE10')
        await engine.carts.removeDiscount(cart.id, 'SAVE10')

        const updatedCart = await engine.carts.get(cart.id)
        expect(updatedCart?.discounts).toHaveLength(0)
        expect(updatedCart?.discountTotal).toBe(0)
      })

      it('should throw for invalid discount code', async () => {
        const cart = await engine.carts.create()

        await expect(
          engine.carts.applyDiscount(cart.id, 'INVALID')
        ).rejects.toThrow('Invalid discount code')
      })

      it('should not allow expired discount', async () => {
        await engine.pricing.createDiscount({
          code: 'EXPIRED',
          type: 'percentage',
          value: 10,
          expiresAt: new Date(Date.now() - 86400000), // Yesterday
        })

        const cart = await engine.carts.create()

        await expect(
          engine.carts.applyDiscount(cart.id, 'EXPIRED')
        ).rejects.toThrow('Discount has expired')
      })
    })
  })

  // =============================================================================
  // Checkout Tests
  // =============================================================================

  describe('checkout', () => {
    let engine: CommerceEngine
    let product: Product
    let cart: Cart

    beforeEach(async () => {
      engine = createTestEngine()
      product = await createTestProductWithVariants(engine)
      await engine.products.publish(product.id)
      cart = await engine.carts.create({ customerId: 'cust_123' })
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 2,
      })
    })

    it('should checkout cart and create order', async () => {
      const order = await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        paymentMethod: 'pm_test_xxx',
      })

      expect(order.id).toBeDefined()
      expect(order.customerId).toBe('cust_123')
      expect(order.status).toBe('pending')
      expect(order.items).toHaveLength(1)
      expect(order.items[0].quantity).toBe(2)
      expect(order.subtotal).toBe(19998)
      expect(order.shippingAddress).toEqual(testAddress)
    })

    it('should mark cart as converted after checkout', async () => {
      await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        paymentMethod: 'pm_test_xxx',
      })

      const updatedCart = await engine.carts.get(cart.id)
      expect(updatedCart?.status).toBe('converted')
    })

    it('should throw when checking out empty cart', async () => {
      const emptyCart = await engine.carts.create()

      await expect(
        engine.checkout(emptyCart.id, {
          shippingAddress: testAddress,
          paymentMethod: 'pm_test_xxx',
        })
      ).rejects.toThrow('Cart is empty')
    })

    it('should throw when checking out already converted cart', async () => {
      await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        paymentMethod: 'pm_test_xxx',
      })

      await expect(
        engine.checkout(cart.id, {
          shippingAddress: testAddress,
          paymentMethod: 'pm_test_xxx',
        })
      ).rejects.toThrow('Cart has already been converted')
    })

    it('should include billing address when provided', async () => {
      const billingAddress = { ...testAddress, line1: '456 Billing St' }

      const order = await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        billingAddress,
        paymentMethod: 'pm_test_xxx',
      })

      expect(order.billingAddress?.line1).toBe('456 Billing St')
    })

    it('should reserve inventory on checkout', async () => {
      const order = await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        paymentMethod: 'pm_test_xxx',
      })

      const level = await engine.inventory.getLevel('WP-SM')
      expect(level?.reserved).toBe(2)
      expect(level?.available).toBe(98) // 100 - 2
    })
  })

  // =============================================================================
  // Orders Tests
  // =============================================================================

  describe('orders', () => {
    let engine: CommerceEngine
    let product: Product
    let order: Order

    beforeEach(async () => {
      engine = createTestEngine()
      product = await createTestProductWithVariants(engine)
      await engine.products.publish(product.id)

      const cart = await engine.carts.create({ customerId: 'cust_123' })
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 2,
      })

      order = await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        paymentMethod: 'pm_test_xxx',
      })
    })

    it('should get an order by id', async () => {
      const retrieved = await engine.orders.get(order.id)
      expect(retrieved?.id).toBe(order.id)
    })

    it('should list orders', async () => {
      const orders = await engine.orders.list()
      expect(orders).toHaveLength(1)
    })

    it('should list orders by customer', async () => {
      const orders = await engine.orders.listByCustomer('cust_123')
      expect(orders).toHaveLength(1)
      expect(orders[0].customerId).toBe('cust_123')
    })

    // Order state machine
    describe('order state machine', () => {
      it('should confirm order (pending -> confirmed)', async () => {
        const confirmed = await engine.orders.confirm(order.id)
        expect(confirmed.status).toBe('confirmed')
      })

      it('should process payment (confirmed -> paid)', async () => {
        await engine.orders.confirm(order.id)
        const paid = await engine.orders.markPaid(order.id, {
          transactionId: 'txn_xxx',
        })

        expect(paid.status).toBe('paid')
        expect(paid.paymentDetails?.transactionId).toBe('txn_xxx')
      })

      it('should ship order (paid -> shipped)', async () => {
        await engine.orders.confirm(order.id)
        await engine.orders.markPaid(order.id, { transactionId: 'txn_xxx' })

        const shipped = await engine.orders.ship(order.id, {
          carrier: 'UPS',
          trackingNumber: '1Z999AA10123456784',
        })

        expect(shipped.status).toBe('shipped')
        expect(shipped.shipping?.trackingNumber).toBe('1Z999AA10123456784')
      })

      it('should deliver order (shipped -> delivered)', async () => {
        await engine.orders.confirm(order.id)
        await engine.orders.markPaid(order.id, { transactionId: 'txn_xxx' })
        await engine.orders.ship(order.id, {
          carrier: 'UPS',
          trackingNumber: '1Z999',
        })

        const delivered = await engine.orders.markDelivered(order.id)
        expect(delivered.status).toBe('delivered')
        expect(delivered.deliveredAt).toBeInstanceOf(Date)
      })

      it('should complete order (delivered -> completed)', async () => {
        await engine.orders.confirm(order.id)
        await engine.orders.markPaid(order.id, { transactionId: 'txn_xxx' })
        await engine.orders.ship(order.id, { carrier: 'UPS', trackingNumber: '1Z999' })
        await engine.orders.markDelivered(order.id)

        const completed = await engine.orders.complete(order.id)
        expect(completed.status).toBe('completed')
      })

      it('should cancel pending order', async () => {
        const cancelled = await engine.orders.cancel(order.id, {
          reason: 'Customer request',
        })

        expect(cancelled.status).toBe('cancelled')
        expect(cancelled.cancellation?.reason).toBe('Customer request')
      })

      it('should throw when transitioning to invalid state', async () => {
        // Cannot ship a pending order
        await expect(
          engine.orders.ship(order.id, { carrier: 'UPS', trackingNumber: '1Z999' })
        ).rejects.toThrow('Invalid order state transition')
      })

      it('should release inventory on cancellation', async () => {
        await engine.orders.cancel(order.id, { reason: 'Cancelled' })

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.reserved).toBe(0)
        expect(level?.available).toBe(100)
      })
    })

    // Fulfillment
    describe('fulfillment', () => {
      beforeEach(async () => {
        await engine.orders.confirm(order.id)
        await engine.orders.markPaid(order.id, { transactionId: 'txn_xxx' })
      })

      it('should fulfill order with tracking', async () => {
        const fulfilled = await engine.orders.fulfill(order.id, {
          trackingNumber: '1Z999AA10123456784',
          carrier: 'UPS',
        })

        expect(fulfilled.status).toBe('shipped')
        expect(fulfilled.shipping?.trackingNumber).toBe('1Z999AA10123456784')
      })

      it('should support partial fulfillment', async () => {
        // Create order with multiple items
        const cart = await engine.carts.create()
        await engine.carts.addItem(cart.id, {
          productId: product.id,
          variantId: product.variants![0].id,
          quantity: 2,
        })
        await engine.carts.addItem(cart.id, {
          productId: product.id,
          variantId: product.variants![1].id,
          quantity: 1,
        })

        const multiOrder = await engine.checkout(cart.id, {
          shippingAddress: testAddress,
          paymentMethod: 'pm_xxx',
        })
        await engine.orders.confirm(multiOrder.id)
        await engine.orders.markPaid(multiOrder.id, { transactionId: 'txn_yyy' })

        // Fulfill first item only
        const partiallyFulfilled = await engine.orders.fulfill(multiOrder.id, {
          trackingNumber: '1Z111',
          items: [{ variantId: product.variants![0].id, quantity: 2 }],
        })

        expect(partiallyFulfilled.status).toBe('partially_fulfilled')
        expect(partiallyFulfilled.fulfillments).toHaveLength(1)
      })

      it('should commit inventory on fulfillment', async () => {
        await engine.orders.fulfill(order.id, {
          trackingNumber: '1Z999',
          carrier: 'UPS',
        })

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.committed).toBe(2)
        expect(level?.reserved).toBe(0)
        expect(level?.onHand).toBe(98)
      })
    })

    // Refunds
    describe('refunds', () => {
      beforeEach(async () => {
        await engine.orders.confirm(order.id)
        await engine.orders.markPaid(order.id, { transactionId: 'txn_xxx' })
      })

      it('should refund full order amount', async () => {
        const refunded = await engine.orders.refund(order.id, {
          reason: 'Customer not satisfied',
        })

        expect(refunded.refunds).toHaveLength(1)
        expect(refunded.refunds![0].amount).toBe(order.total)
        expect(refunded.refunds![0].reason).toBe('Customer not satisfied')
      })

      it('should refund partial amount', async () => {
        const refunded = await engine.orders.refund(order.id, {
          amount: 1000,
          reason: 'Damaged item',
        })

        expect(refunded.refunds![0].amount).toBe(1000)
      })

      it('should track multiple refunds', async () => {
        await engine.orders.refund(order.id, { amount: 500, reason: 'First refund' })
        await engine.orders.refund(order.id, { amount: 300, reason: 'Second refund' })

        const updated = await engine.orders.get(order.id)
        expect(updated?.refunds).toHaveLength(2)
        expect(updated?.refundedAmount).toBe(800)
      })

      it('should not allow refund exceeding total', async () => {
        await expect(
          engine.orders.refund(order.id, {
            amount: order.total + 1000,
            reason: 'Too much',
          })
        ).rejects.toThrow('Refund amount exceeds order total')
      })

      it('should mark order as refunded when fully refunded', async () => {
        await engine.orders.refund(order.id, { reason: 'Full refund' })

        const updated = await engine.orders.get(order.id)
        expect(updated?.status).toBe('refunded')
      })
    })

    // Order notes and metadata
    describe('notes and metadata', () => {
      it('should add note to order', async () => {
        await engine.orders.addNote(order.id, 'Customer requested gift wrapping')

        const updated = await engine.orders.get(order.id)
        expect(updated?.notes).toHaveLength(1)
        expect(updated?.notes![0].content).toBe('Customer requested gift wrapping')
      })

      it('should update order metadata', async () => {
        await engine.orders.updateMetadata(order.id, {
          source: 'mobile_app',
          campaign: 'summer_sale',
        })

        const updated = await engine.orders.get(order.id)
        expect(updated?.metadata?.source).toBe('mobile_app')
      })
    })
  })

  // =============================================================================
  // Pricing Tests
  // =============================================================================

  describe('pricing', () => {
    let engine: CommerceEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    // Discount management
    describe('discounts', () => {
      it('should create a percentage discount', async () => {
        const discount = await engine.pricing.createDiscount({
          code: 'SAVE20',
          type: 'percentage',
          value: 20,
        })

        expect(discount.id).toBeDefined()
        expect(discount.code).toBe('SAVE20')
        expect(discount.type).toBe('percentage')
        expect(discount.value).toBe(20)
        expect(discount.active).toBe(true)
      })

      it('should create a fixed amount discount', async () => {
        const discount = await engine.pricing.createDiscount({
          code: 'FLAT10',
          type: 'fixed',
          value: 1000,
          currency: 'USD',
        })

        expect(discount.type).toBe('fixed')
        expect(discount.currency).toBe('USD')
      })

      it('should create a discount with usage limits', async () => {
        const discount = await engine.pricing.createDiscount({
          code: 'LIMITED',
          type: 'percentage',
          value: 50,
          usageLimit: 100,
        })

        expect(discount.usageLimit).toBe(100)
        expect(discount.usageCount).toBe(0)
      })

      it('should create a discount with date restrictions', async () => {
        const startsAt = new Date()
        const expiresAt = new Date(Date.now() + 86400000)

        const discount = await engine.pricing.createDiscount({
          code: 'TIMED',
          type: 'percentage',
          value: 15,
          startsAt,
          expiresAt,
        })

        expect(discount.startsAt).toEqual(startsAt)
        expect(discount.expiresAt).toEqual(expiresAt)
      })

      it('should create discount with minimum purchase', async () => {
        const discount = await engine.pricing.createDiscount({
          code: 'MINPURCHASE',
          type: 'percentage',
          value: 10,
          minimumPurchase: 5000, // $50.00
        })

        expect(discount.minimumPurchase).toBe(5000)
      })

      it('should get a discount by code', async () => {
        await engine.pricing.createDiscount({
          code: 'FINDME',
          type: 'percentage',
          value: 10,
        })

        const discount = await engine.pricing.getDiscount('FINDME')
        expect(discount?.code).toBe('FINDME')
      })

      it('should validate discount', async () => {
        await engine.pricing.createDiscount({
          code: 'VALID',
          type: 'percentage',
          value: 10,
        })

        const result = await engine.pricing.validateDiscount('VALID', {
          subtotal: 10000,
        })

        expect(result.valid).toBe(true)
        expect(result.discountAmount).toBe(1000)
      })

      it('should fail validation for minimum purchase not met', async () => {
        await engine.pricing.createDiscount({
          code: 'MINREQ',
          type: 'percentage',
          value: 10,
          minimumPurchase: 10000,
        })

        const result = await engine.pricing.validateDiscount('MINREQ', {
          subtotal: 5000,
        })

        expect(result.valid).toBe(false)
        expect(result.reason).toBe('Minimum purchase not met')
      })

      it('should deactivate a discount', async () => {
        const discount = await engine.pricing.createDiscount({
          code: 'TODEACTIVATE',
          type: 'percentage',
          value: 10,
        })

        await engine.pricing.deactivateDiscount(discount.id)

        const updated = await engine.pricing.getDiscount('TODEACTIVATE')
        expect(updated?.active).toBe(false)
      })

      it('should increment usage count', async () => {
        const discount = await engine.pricing.createDiscount({
          code: 'COUNTME',
          type: 'percentage',
          value: 10,
          usageLimit: 10,
        })

        await engine.pricing.recordUsage(discount.id)
        await engine.pricing.recordUsage(discount.id)

        const updated = await engine.pricing.getDiscount('COUNTME')
        expect(updated?.usageCount).toBe(2)
      })

      it('should fail validation when usage limit exceeded', async () => {
        await engine.pricing.createDiscount({
          code: 'LIMITEDUSE',
          type: 'percentage',
          value: 10,
          usageLimit: 1,
        })
        const discount = await engine.pricing.getDiscount('LIMITEDUSE')
        await engine.pricing.recordUsage(discount!.id)

        const result = await engine.pricing.validateDiscount('LIMITEDUSE', {
          subtotal: 10000,
        })

        expect(result.valid).toBe(false)
        expect(result.reason).toBe('Discount usage limit exceeded')
      })
    })

    // Tax calculation
    describe('taxes', () => {
      it('should create tax rate', async () => {
        const taxRate = await engine.pricing.createTaxRate({
          name: 'CA Sales Tax',
          rate: 0.0875, // 8.75%
          country: 'US',
          state: 'CA',
        })

        expect(taxRate.id).toBeDefined()
        expect(taxRate.rate).toBe(0.0875)
      })

      it('should calculate tax for order', async () => {
        await engine.pricing.createTaxRate({
          name: 'CA Sales Tax',
          rate: 0.0875,
          country: 'US',
          state: 'CA',
        })

        const tax = await engine.pricing.calculateTax({
          subtotal: 10000,
          shippingAddress: { ...testAddress, state: 'CA' },
        })

        expect(tax.amount).toBe(875) // 8.75% of $100.00
        expect(tax.rate).toBe(0.0875)
      })

      it('should return zero tax for tax-exempt address', async () => {
        const tax = await engine.pricing.calculateTax({
          subtotal: 10000,
          shippingAddress: { ...testAddress, state: 'MT' }, // Montana has no sales tax
        })

        expect(tax.amount).toBe(0)
      })
    })

    // Currency handling
    describe('currencies', () => {
      it('should convert price between currencies', async () => {
        // Set exchange rate
        await engine.pricing.setExchangeRate('EUR', 'USD', 1.1)

        const converted = await engine.pricing.convertPrice(
          { amount: 1000, currency: 'EUR' },
          'USD'
        )

        expect(converted.amount).toBe(1100)
        expect(converted.currency).toBe('USD')
      })

      it('should format price', () => {
        const formatted = engine.pricing.formatPrice({ amount: 9999, currency: 'USD' })
        expect(formatted).toBe('$99.99')
      })

      it('should format price in different locales', () => {
        const formatted = engine.pricing.formatPrice(
          { amount: 9999, currency: 'EUR' },
          'de-DE'
        )
        expect(formatted).toMatch(/99,99/)
      })
    })

    // Price rules
    describe('price rules', () => {
      it('should create volume discount rule', async () => {
        const rule = await engine.pricing.createPriceRule({
          name: 'Bulk Discount',
          type: 'volume',
          tiers: [
            { minQuantity: 10, discount: 0.05 },
            { minQuantity: 25, discount: 0.1 },
            { minQuantity: 50, discount: 0.15 },
          ],
        })

        expect(rule.id).toBeDefined()
        expect(rule.tiers).toHaveLength(3)
      })

      it('should apply volume pricing', async () => {
        await engine.pricing.createPriceRule({
          name: 'Bulk Discount',
          type: 'volume',
          tiers: [
            { minQuantity: 10, discount: 0.1 },
          ],
        })

        const price = await engine.pricing.calculatePrice({
          basePrice: { amount: 1000, currency: 'USD' },
          quantity: 15,
        })

        expect(price.amount).toBe(900) // 10% off
      })

      it('should create customer-specific pricing', async () => {
        const rule = await engine.pricing.createPriceRule({
          name: 'VIP Pricing',
          type: 'customer_group',
          customerGroups: ['vip'],
          discount: 0.2,
        })

        expect(rule.customerGroups).toContain('vip')
      })
    })
  })

  // =============================================================================
  // Inventory Tests
  // =============================================================================

  describe('inventory', () => {
    let engine: CommerceEngine
    let product: Product

    beforeEach(async () => {
      engine = createTestEngine()
      product = await createTestProductWithVariants(engine)
    })

    it('should get inventory level by SKU', async () => {
      const level = await engine.inventory.getLevel('WP-SM')

      expect(level?.sku).toBe('WP-SM')
      expect(level?.onHand).toBe(100)
      expect(level?.available).toBe(100)
      expect(level?.reserved).toBe(0)
      expect(level?.committed).toBe(0)
    })

    it('should return null for non-existent SKU', async () => {
      const level = await engine.inventory.getLevel('NONEXISTENT')
      expect(level).toBeNull()
    })

    // Stock reservations
    describe('reservations', () => {
      it('should reserve stock', async () => {
        const reservation = await engine.inventory.reserve('WP-SM', 5, {
          orderId: 'order_123',
        })

        expect(reservation.id).toBeDefined()
        expect(reservation.sku).toBe('WP-SM')
        expect(reservation.quantity).toBe(5)
        expect(reservation.orderId).toBe('order_123')

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.reserved).toBe(5)
        expect(level?.available).toBe(95)
      })

      it('should release reservation', async () => {
        const reservation = await engine.inventory.reserve('WP-SM', 5, {
          orderId: 'order_123',
        })

        await engine.inventory.releaseReservation(reservation.id)

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.reserved).toBe(0)
        expect(level?.available).toBe(100)
      })

      it('should commit reservation', async () => {
        const reservation = await engine.inventory.reserve('WP-SM', 5, {
          orderId: 'order_123',
        })

        await engine.inventory.commitReservation(reservation.id)

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.reserved).toBe(0)
        expect(level?.committed).toBe(5)
        expect(level?.onHand).toBe(95)
      })

      it('should throw when reserving more than available', async () => {
        await expect(
          engine.inventory.reserve('WP-SM', 150, { orderId: 'order_xxx' })
        ).rejects.toThrow('Insufficient inventory')
      })

      it('should support reservation expiry', async () => {
        vi.useFakeTimers()

        const reservation = await engine.inventory.reserve('WP-SM', 5, {
          orderId: 'order_123',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        })

        expect(reservation.expiresAt).toBeDefined()

        // Advance time past expiry
        vi.advanceTimersByTime(31 * 60 * 1000)

        // Cleanup expired reservations
        await engine.inventory.cleanupExpiredReservations()

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.reserved).toBe(0)
        expect(level?.available).toBe(100)

        vi.useRealTimers()
      })
    })

    // Stock adjustments
    describe('adjustments', () => {
      it('should adjust inventory positively', async () => {
        await engine.inventory.adjust('WP-SM', 10, {
          reason: 'Received shipment',
        })

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.onHand).toBe(110)
      })

      it('should adjust inventory negatively', async () => {
        await engine.inventory.adjust('WP-SM', -5, {
          reason: 'shrinkage',
        })

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.onHand).toBe(95)
      })

      it('should track adjustment history', async () => {
        await engine.inventory.adjust('WP-SM', 10, { reason: 'Received' })
        await engine.inventory.adjust('WP-SM', -2, { reason: 'Damaged' })

        const history = await engine.inventory.getAdjustmentHistory('WP-SM')
        expect(history).toHaveLength(2)
        expect(history[0].quantity).toBe(10)
        expect(history[1].quantity).toBe(-2)
      })

      it('should throw when adjustment would go negative', async () => {
        await expect(
          engine.inventory.adjust('WP-SM', -150, { reason: 'Too much' })
        ).rejects.toThrow('Adjustment would result in negative inventory')
      })
    })

    // Backorders
    describe('backorders', () => {
      it('should allow backorder when enabled', async () => {
        await engine.inventory.setBackorderPolicy('WP-SM', {
          allowBackorder: true,
          maxBackorderQuantity: 50,
        })

        const reservation = await engine.inventory.reserve('WP-SM', 120, {
          orderId: 'order_backorder',
          allowBackorder: true,
        })

        expect(reservation.backordered).toBe(20)

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.backordered).toBe(20)
      })

      it('should track backorder fulfillment', async () => {
        await engine.inventory.setBackorderPolicy('WP-SM', {
          allowBackorder: true,
        })

        await engine.inventory.reserve('WP-SM', 120, {
          orderId: 'order_backorder',
          allowBackorder: true,
        })

        // Receive new inventory
        await engine.inventory.adjust('WP-SM', 50, { reason: 'Received shipment' })

        // Check that backorder can be fulfilled
        // onHand increased by 50 (was 100), reserve doesn't affect onHand
        // backordered items can now be fulfilled from the new inventory
        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.onHand).toBe(150) // 100 original + 50 adjustment
        expect(level?.backordered).toBe(20)
        expect(level?.available).toBe(50) // 50 new inventory available
      })
    })

    // Inventory locations
    describe('multi-location inventory', () => {
      it('should track inventory by location', async () => {
        await engine.inventory.setLevel('WP-SM', {
          locationId: 'warehouse-east',
          onHand: 60,
        })
        await engine.inventory.setLevel('WP-SM', {
          locationId: 'warehouse-west',
          onHand: 40,
        })

        const eastLevel = await engine.inventory.getLevel('WP-SM', 'warehouse-east')
        const westLevel = await engine.inventory.getLevel('WP-SM', 'warehouse-west')

        expect(eastLevel?.onHand).toBe(60)
        expect(westLevel?.onHand).toBe(40)
      })

      it('should get total inventory across locations', async () => {
        await engine.inventory.setLevel('WP-SM', {
          locationId: 'warehouse-east',
          onHand: 60,
        })
        await engine.inventory.setLevel('WP-SM', {
          locationId: 'warehouse-west',
          onHand: 40,
        })

        const total = await engine.inventory.getTotalLevel('WP-SM')
        expect(total?.onHand).toBe(100)
      })

      it('should transfer between locations', async () => {
        await engine.inventory.setLevel('WP-SM', {
          locationId: 'warehouse-east',
          onHand: 60,
        })
        await engine.inventory.setLevel('WP-SM', {
          locationId: 'warehouse-west',
          onHand: 40,
        })

        await engine.inventory.transfer('WP-SM', 20, {
          fromLocation: 'warehouse-east',
          toLocation: 'warehouse-west',
        })

        const eastLevel = await engine.inventory.getLevel('WP-SM', 'warehouse-east')
        const westLevel = await engine.inventory.getLevel('WP-SM', 'warehouse-west')

        expect(eastLevel?.onHand).toBe(40)
        expect(westLevel?.onHand).toBe(60)
      })
    })

    // Low stock alerts
    describe('low stock alerts', () => {
      it('should set low stock threshold', async () => {
        await engine.inventory.setLowStockThreshold('WP-SM', 20)

        const level = await engine.inventory.getLevel('WP-SM')
        expect(level?.lowStockThreshold).toBe(20)
      })

      it('should identify low stock items', async () => {
        await engine.inventory.setLowStockThreshold('WP-SM', 20)
        await engine.inventory.adjust('WP-SM', -85, { reason: 'Sales' })

        const lowStock = await engine.inventory.getLowStockItems()
        expect(lowStock.find((i) => i.sku === 'WP-SM')).toBeDefined()
      })

      it('should trigger low stock callback', async () => {
        const onLowStock = vi.fn()
        const engineWithCallback = createCommerceEngine({
          onLowStock,
        })

        const product = await engineWithCallback.products.create({
          name: 'Test',
          slug: 'test',
          price: { amount: 1000, currency: 'USD' },
          variants: [{ sku: 'TEST-SKU', name: 'Default', inventory: 25 }],
        })
        await engineWithCallback.inventory.setLowStockThreshold('TEST-SKU', 20)

        // Reduce inventory below threshold
        await engineWithCallback.inventory.adjust('TEST-SKU', -10, { reason: 'Sales' })

        expect(onLowStock).toHaveBeenCalledWith(
          expect.objectContaining({ sku: 'TEST-SKU' })
        )
      })
    })
  })

  // =============================================================================
  // Integration Tests
  // =============================================================================

  describe('integration', () => {
    let engine: CommerceEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should handle complete purchase flow', async () => {
      // 1. Create product
      const product = await engine.products.create({
        name: 'Premium Widget',
        slug: 'premium-widget',
        price: { amount: 4999, currency: 'USD' },
        variants: [
          { sku: 'PW-BLK', name: 'Black', inventory: 10 },
          { sku: 'PW-WHT', name: 'White', inventory: 5 },
        ],
      })
      await engine.products.publish(product.id)

      // 2. Create discount
      await engine.pricing.createDiscount({
        code: 'WELCOME10',
        type: 'percentage',
        value: 10,
      })

      // 3. Create tax rate
      await engine.pricing.createTaxRate({
        name: 'CA Tax',
        rate: 0.0875,
        country: 'US',
        state: 'CA',
      })

      // 4. Create cart and add items
      const cart = await engine.carts.create({ customerId: 'cust_premium' })
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 2,
      })

      // 5. Apply discount
      await engine.carts.applyDiscount(cart.id, 'WELCOME10')

      // 6. Get cart with totals
      const updatedCart = await engine.carts.get(cart.id)
      expect(updatedCart?.subtotal).toBe(9998) // 4999 * 2
      expect(updatedCart?.discountTotal).toBe(999) // 10% of 9998

      // 7. Checkout
      const order = await engine.checkout(cart.id, {
        shippingAddress: { ...testAddress, state: 'CA' },
        paymentMethod: 'pm_test_premium',
      })

      expect(order.subtotal).toBe(9998)
      expect(order.discountTotal).toBe(999)
      // Tax on (9998 - 999) = 8999 at 8.75%
      expect(order.taxTotal).toBeCloseTo(787, -1)

      // 8. Verify inventory reserved
      const level = await engine.inventory.getLevel('PW-BLK')
      expect(level?.reserved).toBe(2)
      expect(level?.available).toBe(8)

      // 9. Confirm and process order
      await engine.orders.confirm(order.id)
      await engine.orders.markPaid(order.id, { transactionId: 'txn_premium' })

      // 10. Fulfill order
      await engine.orders.fulfill(order.id, {
        trackingNumber: '1Z999PREMIUM',
        carrier: 'FedEx',
      })

      // 11. Verify inventory committed
      const finalLevel = await engine.inventory.getLevel('PW-BLK')
      expect(finalLevel?.reserved).toBe(0)
      expect(finalLevel?.committed).toBe(2)
      expect(finalLevel?.onHand).toBe(8)

      // 12. Mark delivered and complete
      await engine.orders.markDelivered(order.id)
      const completedOrder = await engine.orders.complete(order.id)

      expect(completedOrder.status).toBe('completed')
    })

    it('should handle order cancellation and refund flow', async () => {
      // Setup
      const product = await engine.products.create({
        name: 'Refundable Item',
        slug: 'refundable',
        price: { amount: 2500, currency: 'USD' },
        variants: [{ sku: 'REF-001', name: 'Default', inventory: 20 }],
      })
      await engine.products.publish(product.id)

      const cart = await engine.carts.create({ customerId: 'cust_refund' })
      await engine.carts.addItem(cart.id, {
        productId: product.id,
        variantId: product.variants![0].id,
        quantity: 3,
      })

      const order = await engine.checkout(cart.id, {
        shippingAddress: testAddress,
        paymentMethod: 'pm_refund',
      })
      await engine.orders.confirm(order.id)
      await engine.orders.markPaid(order.id, { transactionId: 'txn_refund' })

      // Inventory should be reserved
      let level = await engine.inventory.getLevel('REF-001')
      expect(level?.reserved).toBe(3)
      expect(level?.available).toBe(17)

      // Issue partial refund
      await engine.orders.refund(order.id, {
        amount: 2500,
        reason: 'One item damaged',
        restockItems: [{ sku: 'REF-001', quantity: 1 }],
      })

      // Check refund recorded
      let updated = await engine.orders.get(order.id)
      expect(updated?.refunds).toHaveLength(1)
      expect(updated?.refundedAmount).toBe(2500)

      // Check inventory restored for restocked item
      level = await engine.inventory.getLevel('REF-001')
      expect(level?.reserved).toBe(2) // 3 - 1 restocked
      expect(level?.available).toBe(18) // 17 + 1 restocked

      // Cancel remaining order
      await engine.orders.cancel(order.id, { reason: 'Customer request' })

      // All remaining inventory should be released
      level = await engine.inventory.getLevel('REF-001')
      expect(level?.reserved).toBe(0)
      expect(level?.available).toBe(20)

      // Order should be cancelled
      updated = await engine.orders.get(order.id)
      expect(updated?.status).toBe('cancelled')
    })
  })
})
