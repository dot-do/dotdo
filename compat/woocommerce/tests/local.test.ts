/**
 * @dotdo/woocommerce - Local Implementation Tests
 *
 * Tests for WooCommerceLocal - the DO-backed local implementation
 * of WooCommerce REST API.
 *
 * @module @dotdo/woocommerce/tests/local
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WooCommerceLocal } from '../local'

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/woocommerce/local - WooCommerceLocal', () => {
  let wc: WooCommerceLocal

  beforeEach(async () => {
    wc = new WooCommerceLocal()
    await wc.clear()
  })

  // ===========================================================================
  // Orders Resource Tests
  // ===========================================================================

  describe('orders', () => {
    describe('create()', () => {
      it('should create an order with default values', async () => {
        const order = await wc.orders.create({})

        expect(order.id).toBeGreaterThan(0)
        expect(order.status).toBe('pending')
        expect(order.currency).toBe('USD')
        expect(order.order_key).toMatch(/^wc_order_/)
        expect(order.date_created).toBeDefined()
      })

      it('should create an order with line items', async () => {
        const order = await wc.orders.create({
          line_items: [
            { product_id: 1, quantity: 2, total: '20.00' },
            { product_id: 2, quantity: 1, total: '15.00' },
          ],
        })

        expect(order.line_items).toHaveLength(2)
        expect(order.line_items[0].product_id).toBe(1)
        expect(order.line_items[0].quantity).toBe(2)
        expect(order.line_items[1].product_id).toBe(2)
      })

      it('should create an order with billing address', async () => {
        const order = await wc.orders.create({
          billing: {
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
            city: 'San Francisco',
            state: 'CA',
            country: 'US',
          },
        })

        expect(order.billing.first_name).toBe('John')
        expect(order.billing.last_name).toBe('Doe')
        expect(order.billing.email).toBe('john@example.com')
        expect(order.billing.city).toBe('San Francisco')
      })

      it('should set date_paid when set_paid is true', async () => {
        const order = await wc.orders.create({
          set_paid: true,
        })

        expect(order.date_paid).toBeDefined()
        expect(order.date_paid).not.toBeNull()
      })

      it('should calculate total from line items', async () => {
        const order = await wc.orders.create({
          line_items: [
            { product_id: 1, quantity: 1, total: '25.00' },
            { product_id: 2, quantity: 1, total: '15.00' },
          ],
        })

        expect(parseFloat(order.total)).toBe(40.0)
      })
    })

    describe('get()', () => {
      it('should retrieve an existing order', async () => {
        const created = await wc.orders.create({
          status: 'processing',
        })

        const retrieved = await wc.orders.get(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.status).toBe('processing')
      })

      it('should throw error for non-existent order', async () => {
        await expect(wc.orders.get(99999)).rejects.toThrow('Order not found')
      })
    })

    describe('update()', () => {
      it('should update order status', async () => {
        const order = await wc.orders.create({ status: 'pending' })

        const updated = await wc.orders.update(order.id, { status: 'processing' })

        expect(updated.status).toBe('processing')
      })

      it('should update billing address', async () => {
        const order = await wc.orders.create({})

        const updated = await wc.orders.update(order.id, {
          billing: { first_name: 'Jane', email: 'jane@example.com' },
        })

        expect(updated.billing.first_name).toBe('Jane')
        expect(updated.billing.email).toBe('jane@example.com')
      })

      it('should set date_completed when status changes to completed', async () => {
        const order = await wc.orders.create({ status: 'processing' })

        const updated = await wc.orders.update(order.id, { status: 'completed' })

        expect(updated.date_completed).toBeDefined()
        expect(updated.date_completed).not.toBeNull()
      })
    })

    describe('delete()', () => {
      it('should move order to trash by default', async () => {
        const order = await wc.orders.create({})

        const deleted = await wc.orders.delete(order.id)

        expect(deleted.status).toBe('trash')
      })

      it('should permanently delete with force=true', async () => {
        const order = await wc.orders.create({})

        await wc.orders.delete(order.id, { force: true })

        await expect(wc.orders.get(order.id)).rejects.toThrow('Order not found')
      })
    })

    describe('list()', () => {
      it('should list all orders', async () => {
        await wc.orders.create({})
        await wc.orders.create({})
        await wc.orders.create({})

        const { data, total } = await wc.orders.list()

        expect(data).toHaveLength(3)
        expect(total).toBe(3)
      })

      it('should filter by status', async () => {
        await wc.orders.create({ status: 'pending' })
        await wc.orders.create({ status: 'processing' })
        await wc.orders.create({ status: 'completed' })

        const { data } = await wc.orders.list({ status: 'processing' })

        expect(data).toHaveLength(1)
        expect(data[0].status).toBe('processing')
      })

      it('should paginate results', async () => {
        for (let i = 0; i < 5; i++) {
          await wc.orders.create({})
        }

        const { data, total } = await wc.orders.list({ page: 1, per_page: 2 })

        expect(data).toHaveLength(2)
        expect(total).toBe(5)
      })

      it('should sort by date descending by default', async () => {
        const order1 = await wc.orders.create({})
        const order2 = await wc.orders.create({})

        const { data } = await wc.orders.list()

        // Default sort is by date desc, which for same timestamps falls back to id desc
        // So the order with higher ID should come first
        expect(data[0].id).toBeGreaterThan(data[1].id)
        expect(data).toHaveLength(2)
      })
    })

    describe('batch()', () => {
      it('should batch create orders', async () => {
        const result = await wc.orders.batch({
          create: [{ status: 'pending' }, { status: 'processing' }],
        })

        expect(result.create).toHaveLength(2)
        expect(result.create![0].status).toBe('pending')
        expect(result.create![1].status).toBe('processing')
      })

      it('should batch update orders', async () => {
        const order1 = await wc.orders.create({ status: 'pending' })
        const order2 = await wc.orders.create({ status: 'pending' })

        const result = await wc.orders.batch({
          update: [
            { id: order1.id, status: 'processing' },
            { id: order2.id, status: 'completed' },
          ],
        })

        expect(result.update).toHaveLength(2)
        expect(result.update![0].status).toBe('processing')
        expect(result.update![1].status).toBe('completed')
      })

      it('should batch delete orders', async () => {
        const order1 = await wc.orders.create({})
        const order2 = await wc.orders.create({})

        const result = await wc.orders.batch({
          delete: [order1.id, order2.id],
        })

        expect(result.delete).toHaveLength(2)
      })
    })

    describe('notes', () => {
      it('should create an order note', async () => {
        const order = await wc.orders.create({})

        const note = await wc.orders.notes.create(order.id, {
          note: 'Test note',
          customer_note: false,
        })

        expect(note.note).toBe('Test note')
        expect(note.customer_note).toBe(false)
      })

      it('should list order notes', async () => {
        const order = await wc.orders.create({})
        await wc.orders.notes.create(order.id, { note: 'Note 1' })
        await wc.orders.notes.create(order.id, { note: 'Note 2' })

        const { data } = await wc.orders.notes.list(order.id)

        expect(data).toHaveLength(2)
      })

      it('should filter customer notes', async () => {
        const order = await wc.orders.create({})
        await wc.orders.notes.create(order.id, { note: 'Internal', customer_note: false })
        await wc.orders.notes.create(order.id, { note: 'Customer', customer_note: true })

        const { data } = await wc.orders.notes.list(order.id, { type: 'customer' })

        expect(data).toHaveLength(1)
        expect(data[0].note).toBe('Customer')
      })
    })

    describe('refunds', () => {
      it('should create a refund', async () => {
        const order = await wc.orders.create({})

        const refund = await wc.orders.refunds.create(order.id, {
          amount: '10.00',
          reason: 'Customer request',
        })

        expect(refund.amount).toBe('10.00')
        expect(refund.reason).toBe('Customer request')
      })

      it('should add refund to order', async () => {
        const order = await wc.orders.create({})

        await wc.orders.refunds.create(order.id, {
          amount: '10.00',
          reason: 'Refund test',
        })

        const updatedOrder = await wc.orders.get(order.id)
        expect(updatedOrder.refunds).toHaveLength(1)
        expect(updatedOrder.refunds[0].total).toBe('-10.00')
      })
    })
  })

  // ===========================================================================
  // Customers Resource Tests
  // ===========================================================================

  describe('customers', () => {
    describe('create()', () => {
      it('should create a customer with email', async () => {
        const customer = await wc.customers.create({
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe',
        })

        expect(customer.id).toBeGreaterThan(0)
        expect(customer.email).toBe('test@example.com')
        expect(customer.first_name).toBe('John')
        expect(customer.last_name).toBe('Doe')
        expect(customer.role).toBe('customer')
      })

      it('should create customer with billing address', async () => {
        const customer = await wc.customers.create({
          email: 'test@example.com',
          billing: {
            city: 'New York',
            state: 'NY',
            country: 'US',
          },
        })

        expect(customer.billing.city).toBe('New York')
        expect(customer.billing.state).toBe('NY')
        expect(customer.billing.country).toBe('US')
      })

      it('should reject duplicate email', async () => {
        await wc.customers.create({ email: 'duplicate@example.com' })

        await expect(wc.customers.create({ email: 'duplicate@example.com' })).rejects.toThrow(
          'already exists'
        )
      })
    })

    describe('get()', () => {
      it('should retrieve existing customer', async () => {
        const created = await wc.customers.create({
          email: 'retrieve@example.com',
          first_name: 'Jane',
        })

        const retrieved = await wc.customers.get(created.id)

        expect(retrieved.email).toBe('retrieve@example.com')
        expect(retrieved.first_name).toBe('Jane')
      })

      it('should throw error for non-existent customer', async () => {
        await expect(wc.customers.get(99999)).rejects.toThrow('Customer not found')
      })
    })

    describe('update()', () => {
      it('should update customer details', async () => {
        const customer = await wc.customers.create({
          email: 'update@example.com',
          first_name: 'Original',
        })

        const updated = await wc.customers.update(customer.id, {
          first_name: 'Updated',
        })

        expect(updated.first_name).toBe('Updated')
        expect(updated.email).toBe('update@example.com')
      })
    })

    describe('list()', () => {
      it('should list all customers', async () => {
        await wc.customers.create({ email: 'c1@example.com' })
        await wc.customers.create({ email: 'c2@example.com' })

        const { data, total } = await wc.customers.list()

        expect(data).toHaveLength(2)
        expect(total).toBe(2)
      })

      it('should filter by email', async () => {
        await wc.customers.create({ email: 'find@example.com' })
        await wc.customers.create({ email: 'other@example.com' })

        const { data } = await wc.customers.list({ email: 'find@example.com' })

        expect(data).toHaveLength(1)
        expect(data[0].email).toBe('find@example.com')
      })

      it('should search customers', async () => {
        await wc.customers.create({ email: 'a@example.com', first_name: 'Alice' })
        await wc.customers.create({ email: 'b@example.com', first_name: 'Bob' })

        const { data } = await wc.customers.list({ search: 'Alice' })

        expect(data).toHaveLength(1)
        expect(data[0].first_name).toBe('Alice')
      })
    })

    describe('delete()', () => {
      it('should delete customer', async () => {
        const customer = await wc.customers.create({ email: 'delete@example.com' })

        await wc.customers.delete(customer.id)

        await expect(wc.customers.get(customer.id)).rejects.toThrow('Customer not found')
      })
    })

    describe('batch()', () => {
      it('should batch create customers', async () => {
        const result = await wc.customers.batch({
          create: [{ email: 'batch1@example.com' }, { email: 'batch2@example.com' }],
        })

        expect(result.create).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Coupons Resource Tests
  // ===========================================================================

  describe('coupons', () => {
    describe('create()', () => {
      it('should create a percentage coupon', async () => {
        const coupon = await wc.coupons.create({
          code: 'SAVE10',
          discount_type: 'percent',
          amount: '10',
        })

        expect(coupon.code).toBe('SAVE10')
        expect(coupon.discount_type).toBe('percent')
        expect(coupon.amount).toBe('10')
      })

      it('should create a fixed cart coupon', async () => {
        const coupon = await wc.coupons.create({
          code: 'FLAT20',
          discount_type: 'fixed_cart',
          amount: '20.00',
        })

        expect(coupon.code).toBe('FLAT20')
        expect(coupon.discount_type).toBe('fixed_cart')
      })

      it('should reject duplicate code', async () => {
        await wc.coupons.create({ code: 'DUPE' })

        await expect(wc.coupons.create({ code: 'DUPE' })).rejects.toThrow('already exists')
      })

      it('should create coupon with restrictions', async () => {
        const coupon = await wc.coupons.create({
          code: 'RESTRICTED',
          individual_use: true,
          usage_limit: 100,
          usage_limit_per_user: 1,
          minimum_amount: '50.00',
          product_ids: [1, 2, 3],
        })

        expect(coupon.individual_use).toBe(true)
        expect(coupon.usage_limit).toBe(100)
        expect(coupon.usage_limit_per_user).toBe(1)
        expect(coupon.minimum_amount).toBe('50.00')
        expect(coupon.product_ids).toEqual([1, 2, 3])
      })
    })

    describe('get()', () => {
      it('should retrieve existing coupon', async () => {
        const created = await wc.coupons.create({ code: 'RETRIEVE' })

        const retrieved = await wc.coupons.get(created.id)

        expect(retrieved.code).toBe('RETRIEVE')
      })
    })

    describe('getByCode()', () => {
      it('should find coupon by code', async () => {
        await wc.coupons.create({ code: 'FINDME' })

        const coupon = await wc.coupons.getByCode('FINDME')

        expect(coupon).not.toBeNull()
        expect(coupon!.code).toBe('FINDME')
      })

      it('should return null for non-existent code', async () => {
        const coupon = await wc.coupons.getByCode('NOTEXIST')

        expect(coupon).toBeNull()
      })
    })

    describe('update()', () => {
      it('should update coupon amount', async () => {
        const coupon = await wc.coupons.create({ code: 'UPDATE', amount: '10' })

        const updated = await wc.coupons.update(coupon.id, { amount: '20' })

        expect(updated.amount).toBe('20')
      })
    })

    describe('list()', () => {
      it('should list all coupons', async () => {
        await wc.coupons.create({ code: 'A' })
        await wc.coupons.create({ code: 'B' })

        const { data, total } = await wc.coupons.list()

        expect(data).toHaveLength(2)
        expect(total).toBe(2)
      })

      it('should filter by code', async () => {
        await wc.coupons.create({ code: 'FILTER' })
        await wc.coupons.create({ code: 'OTHER' })

        const { data } = await wc.coupons.list({ code: 'FILTER' })

        expect(data).toHaveLength(1)
        expect(data[0].code).toBe('FILTER')
      })
    })

    describe('batch()', () => {
      it('should batch create coupons', async () => {
        const result = await wc.coupons.batch({
          create: [{ code: 'BATCH1' }, { code: 'BATCH2' }],
        })

        expect(result.create).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Tax Rates Resource Tests
  // ===========================================================================

  describe('taxRates', () => {
    describe('create()', () => {
      it('should create a tax rate', async () => {
        const rate = await wc.taxRates.create({
          country: 'US',
          state: 'CA',
          rate: '7.5',
          name: 'CA Tax',
        })

        expect(rate.country).toBe('US')
        expect(rate.state).toBe('CA')
        expect(rate.rate).toBe('7.5')
        expect(rate.name).toBe('CA Tax')
      })
    })

    describe('list()', () => {
      it('should list tax rates', async () => {
        await wc.taxRates.create({ country: 'US', rate: '5' })
        await wc.taxRates.create({ country: 'CA', rate: '13' })

        const { data } = await wc.taxRates.list()

        expect(data).toHaveLength(2)
      })

      it('should filter by class', async () => {
        await wc.taxRates.create({ country: 'US', rate: '5', class: 'standard' })
        await wc.taxRates.create({ country: 'US', rate: '0', class: 'zero-rate' })

        const { data } = await wc.taxRates.list({ class: 'zero-rate' })

        expect(data).toHaveLength(1)
        expect(data[0].class).toBe('zero-rate')
      })
    })

    describe('update()', () => {
      it('should update tax rate', async () => {
        const rate = await wc.taxRates.create({ country: 'US', rate: '5' })

        const updated = await wc.taxRates.update(rate.id, { rate: '7' })

        expect(updated.rate).toBe('7')
      })
    })
  })

  // ===========================================================================
  // Tax Classes Resource Tests
  // ===========================================================================

  describe('taxClasses', () => {
    describe('list()', () => {
      it('should list default tax classes', async () => {
        const { data } = await wc.taxClasses.list()

        expect(data.length).toBeGreaterThanOrEqual(3)
        const slugs = data.map((c) => c.slug)
        expect(slugs).toContain('standard')
        expect(slugs).toContain('reduced-rate')
        expect(slugs).toContain('zero-rate')
      })
    })

    describe('create()', () => {
      it('should create a tax class', async () => {
        const taxClass = await wc.taxClasses.create({ name: 'Custom Rate' })

        expect(taxClass.name).toBe('Custom Rate')
        expect(taxClass.slug).toBe('custom-rate')
      })
    })

    describe('delete()', () => {
      it('should delete a tax class', async () => {
        const taxClass = await wc.taxClasses.create({ name: 'Delete Me' })

        const deleted = await wc.taxClasses.delete(taxClass.slug)

        expect(deleted.slug).toBe('delete-me')
      })
    })
  })

  // ===========================================================================
  // Shipping Zones Resource Tests
  // ===========================================================================

  describe('shippingZones', () => {
    describe('list()', () => {
      it('should include default zone', async () => {
        const { data } = await wc.shippingZones.list()

        expect(data.length).toBeGreaterThanOrEqual(1)
        const defaultZone = data.find((z) => z.id === 0)
        expect(defaultZone).toBeDefined()
      })
    })

    describe('create()', () => {
      it('should create a shipping zone', async () => {
        const zone = await wc.shippingZones.create({
          name: 'US Zone',
          order: 1,
        })

        expect(zone.name).toBe('US Zone')
        expect(zone.order).toBe(1)
      })
    })

    describe('locations', () => {
      it('should update zone locations', async () => {
        const zone = await wc.shippingZones.create({ name: 'Test Zone' })

        const { data } = await wc.shippingZones.locations.update(zone.id, [
          { code: 'US', type: 'country' },
          { code: 'CA:ON', type: 'state' },
        ])

        expect(data).toHaveLength(2)
        expect(data[0].code).toBe('US')
        expect(data[1].code).toBe('CA:ON')
      })
    })

    describe('methods', () => {
      it('should add method to zone', async () => {
        const zone = await wc.shippingZones.create({ name: 'Method Zone' })

        const method = await wc.shippingZones.methods.create(zone.id, {
          method_id: 'flat_rate',
          title: 'Flat Rate',
        })

        expect(method.method_id).toBe('flat_rate')
        expect(method.title).toBe('Flat Rate')
      })

      it('should list methods in zone', async () => {
        const zone = await wc.shippingZones.create({ name: 'List Methods' })
        await wc.shippingZones.methods.create(zone.id, { method_id: 'flat_rate' })
        await wc.shippingZones.methods.create(zone.id, { method_id: 'free_shipping' })

        const { data } = await wc.shippingZones.methods.list(zone.id)

        expect(data).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Shipping Methods Resource Tests
  // ===========================================================================

  describe('shippingMethods', () => {
    describe('list()', () => {
      it('should list default shipping methods', async () => {
        const { data } = await wc.shippingMethods.list()

        expect(data.length).toBeGreaterThanOrEqual(3)
        const ids = data.map((m) => m.id)
        expect(ids).toContain('flat_rate')
        expect(ids).toContain('free_shipping')
        expect(ids).toContain('local_pickup')
      })
    })

    describe('get()', () => {
      it('should get shipping method by id', async () => {
        const method = await wc.shippingMethods.get('flat_rate')

        expect(method.id).toBe('flat_rate')
        expect(method.title).toBe('Flat rate')
      })
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('should create order with customer', async () => {
      const customer = await wc.customers.create({
        email: 'customer@example.com',
        first_name: 'John',
        last_name: 'Doe',
      })

      const order = await wc.orders.create({
        customer_id: customer.id,
        billing: {
          first_name: 'John',
          last_name: 'Doe',
          email: 'customer@example.com',
        },
        line_items: [{ product_id: 1, quantity: 1, total: '50.00' }],
      })

      expect(order.customer_id).toBe(customer.id)
      expect(order.billing.first_name).toBe('John')
    })

    it('should apply coupon discount calculation', async () => {
      const coupon = await wc.coupons.create({
        code: 'DISCOUNT',
        discount_type: 'percent',
        amount: '10',
      })

      const order = await wc.orders.create({
        coupon_lines: [{ code: coupon.code }],
        line_items: [{ product_id: 1, quantity: 1, total: '100.00' }],
      })

      expect(order.coupon_lines[0].code).toBe('DISCOUNT')
    })

    it('should create order with shipping', async () => {
      const zone = await wc.shippingZones.create({ name: 'US Zone' })
      await wc.shippingZones.methods.create(zone.id, {
        method_id: 'flat_rate',
        title: 'Standard Shipping',
      })

      const order = await wc.orders.create({
        shipping_lines: [
          {
            method_title: 'Standard Shipping',
            method_id: 'flat_rate',
            total: '10.00',
          },
        ],
        line_items: [{ product_id: 1, quantity: 1, total: '50.00' }],
      })

      expect(order.shipping_lines).toHaveLength(1)
      expect(order.shipping_lines[0].method_title).toBe('Standard Shipping')
      expect(order.shipping_total).toBe('10.00')
    })
  })
})
