/**
 * @dotdo/shopify - Local Checkout Store Tests
 *
 * Tests for the LocalCheckoutStore implementation that provides
 * Durable Object-backed checkout operations.
 *
 * @module @dotdo/shopify/tests/local-checkout
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  LocalCheckoutStore,
  InMemoryCheckoutStorage,
  InMemoryPaymentStorage,
  InMemoryDiscountCodeStorage,
  InMemoryProductStorage,
  type StoredDiscountCode,
  type StoredVariant,
  type PaymentProcessor,
} from '../checkout'

// =============================================================================
// Test Setup
// =============================================================================

function createTestStore(options?: {
  discountCodes?: StoredDiscountCode[]
  variants?: StoredVariant[]
  paymentProcessor?: PaymentProcessor
  taxRate?: number
}) {
  const checkoutStorage = new InMemoryCheckoutStorage()
  const paymentStorage = new InMemoryPaymentStorage()
  const discountCodeStorage = new InMemoryDiscountCodeStorage()
  const productStorage = new InMemoryProductStorage()

  // Add test discount codes
  if (options?.discountCodes) {
    for (const code of options.discountCodes) {
      discountCodeStorage.addCode(code)
    }
  }

  // Add test variants
  if (options?.variants) {
    for (const variant of options.variants) {
      productStorage.addVariant(variant)
    }
  }

  return new LocalCheckoutStore({
    shopDomain: 'test-shop.myshopify.com',
    currency: 'USD',
    taxRate: options?.taxRate || 0,
    checkoutStorage,
    paymentStorage,
    discountCodeStorage,
    productStorage,
    paymentProcessor: options?.paymentProcessor,
  })
}

function createTestVariant(id: number, overrides?: Partial<StoredVariant>): StoredVariant {
  return {
    id,
    product_id: id * 10,
    title: `Test Product ${id}`,
    variant_title: 'Default',
    sku: `SKU-${id}`,
    vendor: 'Test Vendor',
    price: '29.99',
    compare_at_price: '39.99',
    grams: 500,
    requires_shipping: true,
    taxable: true,
    image_url: null,
    inventory_quantity: 100,
    fulfillment_service: 'manual',
    ...overrides,
  }
}

function createTestDiscountCode(code: string, overrides?: Partial<StoredDiscountCode>): StoredDiscountCode {
  return {
    code,
    type: 'percentage',
    value: '20',
    title: '20% Off',
    description: 'Save 20% on your order',
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    usage_count: 0,
    minimum_order_amount: null,
    applies_to_product_ids: null,
    enabled: true,
    ...overrides,
  }
}

// =============================================================================
// Checkout Creation Tests
// =============================================================================

describe('LocalCheckoutStore - Create', () => {
  it('should create an empty checkout', async () => {
    const store = createTestStore()
    const checkout = await store.create({})

    expect(checkout.token).toBeDefined()
    expect(checkout.token.length).toBe(32)
    expect(checkout.line_items).toHaveLength(0)
    expect(checkout.total_price).toBe('0.00')
    expect(checkout.web_url).toContain('test-shop.myshopify.com')
  })

  it('should create checkout with line items', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111), createTestVariant(222)],
    })

    const checkout = await store.create({
      line_items: [
        { variant_id: 111, quantity: 2 },
        { variant_id: 222, quantity: 1 },
      ],
    })

    expect(checkout.line_items).toHaveLength(2)
    expect(checkout.line_items[0].variant_id).toBe(111)
    expect(checkout.line_items[0].quantity).toBe(2)
    expect(checkout.line_items[0].title).toBe('Test Product 111')
    expect(checkout.line_items[1].variant_id).toBe(222)
    expect(parseFloat(checkout.subtotal_price)).toBeGreaterThan(0)
  })

  it('should create checkout with email', async () => {
    const store = createTestStore()
    const checkout = await store.create({
      email: 'customer@example.com',
    })

    expect(checkout.email).toBe('customer@example.com')
  })

  it('should create checkout with shipping address', async () => {
    const store = createTestStore()
    const checkout = await store.create({
      shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'New York',
        province: 'NY',
        country: 'US',
        zip: '10001',
      },
    })

    expect(checkout.shipping_address).toBeDefined()
    expect(checkout.shipping_address?.city).toBe('New York')
  })

  it('should create checkout with note', async () => {
    const store = createTestStore()
    const checkout = await store.create({
      note: 'Please gift wrap',
      note_attributes: [{ name: 'message', value: 'Happy Birthday!' }],
    })

    expect(checkout.note).toBe('Please gift wrap')
    expect(checkout.note_attributes).toHaveLength(1)
  })
})

// =============================================================================
// Get and Update Tests
// =============================================================================

describe('LocalCheckoutStore - Get/Update', () => {
  it('should retrieve a checkout by token', async () => {
    const store = createTestStore()
    const created = await store.create({ email: 'test@example.com' })

    const retrieved = await store.get(created.token)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.token).toBe(created.token)
    expect(retrieved?.email).toBe('test@example.com')
  })

  it('should return null for non-existent checkout', async () => {
    const store = createTestStore()
    const result = await store.get('nonexistent_token')
    expect(result).toBeNull()
  })

  it('should update checkout email', async () => {
    const store = createTestStore()
    const created = await store.create({})

    const updated = await store.update(created.token, {
      email: 'updated@example.com',
    })

    expect(updated.email).toBe('updated@example.com')
  })

  it('should update checkout shipping address', async () => {
    const store = createTestStore()
    const created = await store.create({})

    const updated = await store.update(created.token, {
      shipping_address: {
        first_name: 'Jane',
        last_name: 'Smith',
        address1: '456 Oak Ave',
        city: 'Boston',
        province: 'MA',
        country: 'US',
        zip: '02101',
      },
    })

    expect(updated.shipping_address?.city).toBe('Boston')
  })
})

// =============================================================================
// Line Item Management Tests
// =============================================================================

describe('LocalCheckoutStore - Line Items', () => {
  it('should add line items to checkout', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111), createTestVariant(222)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const updated = await store.addLineItems(checkout.token, {
      line_items: [{ variant_id: 222, quantity: 2 }],
    })

    expect(updated.line_items).toHaveLength(2)
    expect(updated.line_items[1].variant_id).toBe(222)
    expect(updated.line_items[1].quantity).toBe(2)
  })

  it('should increase quantity for existing variant', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const updated = await store.addLineItems(checkout.token, {
      line_items: [{ variant_id: 111, quantity: 2 }],
    })

    expect(updated.line_items).toHaveLength(1)
    expect(updated.line_items[0].quantity).toBe(3)
  })

  it('should update line item quantity', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const lineItemId = checkout.line_items[0].id
    const updated = await store.updateLineItems(checkout.token, [
      { id: lineItemId, quantity: 5 },
    ])

    expect(updated.line_items[0].quantity).toBe(5)
  })

  it('should remove line item when quantity is 0', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const lineItemId = checkout.line_items[0].id
    const updated = await store.updateLineItems(checkout.token, [
      { id: lineItemId, quantity: 0 },
    ])

    expect(updated.line_items).toHaveLength(0)
  })

  it('should remove line items by ID', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111), createTestVariant(222)],
    })

    const checkout = await store.create({
      line_items: [
        { variant_id: 111, quantity: 1 },
        { variant_id: 222, quantity: 1 },
      ],
    })

    const lineItemId = checkout.line_items[0].id
    const updated = await store.removeLineItems(checkout.token, [lineItemId])

    expect(updated.line_items).toHaveLength(1)
    expect(updated.line_items[0].variant_id).toBe(222)
  })
})

// =============================================================================
// Discount Code Tests
// =============================================================================

describe('LocalCheckoutStore - Discounts', () => {
  it('should apply percentage discount code', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '100.00' })],
      discountCodes: [createTestDiscountCode('SAVE20', { type: 'percentage', value: '20' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const updated = await store.applyDiscount(checkout.token, { discount_code: 'SAVE20' })

    expect(updated.discount_codes).toHaveLength(1)
    expect(updated.discount_codes[0].code).toBe('SAVE20')
    expect(parseFloat(updated.total_discounts)).toBe(20)
  })

  it('should apply fixed amount discount code', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '100.00' })],
      discountCodes: [createTestDiscountCode('FLAT10', { type: 'fixed_amount', value: '10' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const updated = await store.applyDiscount(checkout.token, { discount_code: 'FLAT10' })

    expect(parseFloat(updated.total_discounts)).toBe(10)
  })

  it('should reject invalid discount code', async () => {
    const store = createTestStore({
      discountCodes: [createTestDiscountCode('VALID')],
    })

    const checkout = await store.create({})

    await expect(
      store.applyDiscount(checkout.token, { discount_code: 'INVALID' })
    ).rejects.toThrow('not valid')
  })

  it('should reject expired discount code', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    const store = createTestStore({
      discountCodes: [
        createTestDiscountCode('EXPIRED', {
          ends_at: yesterday.toISOString(),
        }),
      ],
    })

    const checkout = await store.create({})

    await expect(
      store.applyDiscount(checkout.token, { discount_code: 'EXPIRED' })
    ).rejects.toThrow('expired')
  })

  it('should remove discount code', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '100.00' })],
      discountCodes: [createTestDiscountCode('SAVE20')],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    await store.applyDiscount(checkout.token, { discount_code: 'SAVE20' })
    const updated = await store.removeDiscount(checkout.token)

    expect(updated.discount_codes).toHaveLength(0)
    expect(updated.total_discounts).toBe('0.00')
  })
})

// =============================================================================
// Shipping Rate Tests
// =============================================================================

describe('LocalCheckoutStore - Shipping', () => {
  it('should return empty rates without shipping address', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const rates = await store.getShippingRates(checkout.token)
    expect(rates).toHaveLength(0)
  })

  it('should return shipping rates with address', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
      shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'New York',
        province: 'NY',
        country: 'US',
        zip: '10001',
      },
    })

    const rates = await store.getShippingRates(checkout.token)
    expect(rates.length).toBeGreaterThan(0)
    expect(rates[0].title).toBeDefined()
    expect(rates[0].price).toBeDefined()
  })

  it('should select shipping rate', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
      shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'New York',
        province: 'NY',
        country: 'US',
        zip: '10001',
      },
    })

    const rates = await store.getShippingRates(checkout.token)
    const updated = await store.selectShippingRate(checkout.token, {
      shipping_rate: { handle: rates[0].handle },
    })

    expect(updated.shipping_line).toBeDefined()
    expect(updated.shipping_line?.title).toBe(rates[0].title)
  })

  it('should reject invalid shipping rate', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111)],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
      shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'New York',
        province: 'NY',
        country: 'US',
        zip: '10001',
      },
    })

    await expect(
      store.selectShippingRate(checkout.token, {
        shipping_rate: { handle: 'invalid-rate' },
      })
    ).rejects.toThrow('not available')
  })
})

// =============================================================================
// Payment Tests
// =============================================================================

describe('LocalCheckoutStore - Payments', () => {
  it('should create successful payment', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const payment = await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_123',
    })

    expect(payment.id).toBeDefined()
    expect(payment.transaction).toBeDefined()
    expect(payment.transaction?.status).toBe('success')
  })

  it('should handle payment failure', async () => {
    const failingProcessor: PaymentProcessor = {
      processPayment: async () => ({
        success: false,
        errorMessage: 'Card declined',
      }),
    }

    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
      paymentProcessor: failingProcessor,
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const payment = await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_123',
    })

    expect(payment.transaction?.status).toBe('failure')
    expect(payment.payment_processing_error_message).toBe('Card declined')
  })

  it('should list payments for checkout', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_1',
    })
    await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_2',
    })

    const payments = await store.listPayments(checkout.token)
    expect(payments).toHaveLength(2)
  })

  it('should get payment by ID', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    const created = await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_123',
    })

    const retrieved = await store.getPayment(checkout.token, created.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(created.id)
  })
})

// =============================================================================
// Checkout Completion Tests
// =============================================================================

describe('LocalCheckoutStore - Completion', () => {
  it('should complete checkout after payment', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_123',
    })

    const completed = await store.complete(checkout.token)

    expect(completed.completed_at).toBeDefined()
    expect(completed.order_id).toBeDefined()
  })

  it('should reject completion without payment', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    await expect(store.complete(checkout.token)).rejects.toThrow('requires payment')
  })

  it('should reject double completion', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '50.00' })],
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    await store.createPayment(checkout.token, {
      amount: '50.00',
      unique_token: 'payment_123',
    })

    await store.complete(checkout.token)
    await expect(store.complete(checkout.token)).rejects.toThrow('already completed')
  })

  it('should close/abandon checkout', async () => {
    const store = createTestStore()
    const checkout = await store.create({})

    const closed = await store.close(checkout.token)
    expect(closed.closed_at).toBeDefined()
  })
})

// =============================================================================
// Tax Calculation Tests
// =============================================================================

describe('LocalCheckoutStore - Tax Calculation', () => {
  it('should calculate tax on checkout', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '100.00' })],
      taxRate: 0.08, // 8% tax
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    expect(checkout.tax_lines).toHaveLength(1)
    expect(checkout.tax_lines[0].rate).toBe(0.08)
    expect(parseFloat(checkout.total_tax)).toBe(8)
  })

  it('should recalculate tax after discount', async () => {
    const store = createTestStore({
      variants: [createTestVariant(111, { price: '100.00' })],
      discountCodes: [createTestDiscountCode('SAVE50', { type: 'fixed_amount', value: '50' })],
      taxRate: 0.1, // 10% tax
    })

    const checkout = await store.create({
      line_items: [{ variant_id: 111, quantity: 1 }],
    })

    // Tax on $100 = $10
    expect(parseFloat(checkout.total_tax)).toBe(10)

    const updated = await store.applyDiscount(checkout.token, { discount_code: 'SAVE50' })

    // Tax on $50 (after discount) = $5
    expect(parseFloat(updated.total_tax)).toBe(5)
  })
})
