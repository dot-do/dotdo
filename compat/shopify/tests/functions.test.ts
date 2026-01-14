/**
 * @dotdo/shopify - Shopify Functions Tests
 *
 * Comprehensive tests for Shopify Functions compatibility layer including:
 * - Discount functions (percentage, fixed amount, conditions)
 * - Payment customizations (hide, move, rename)
 * - Delivery customizations (hide, move, rename)
 * - Validation functions (quantity limits, minimum order)
 *
 * @module @dotdo/shopify/tests/functions
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createDiscountFunction,
  createPaymentCustomization,
  createDeliveryCustomization,
  createValidationFunction,
  percentageDiscount,
  fixedAmountDiscount,
  orderSubtotalTarget,
  productVariantTarget,
  getCartTotal,
  getCartSubtotal,
  getCartQuantity,
  cartHasProduct,
  cartHasVariant,
  isReturningCustomer,
  isFromCountry,
  getProductQuantity,
  getVariantQuantity,
  isDiscountFunction,
  isPaymentCustomization,
  isDeliveryCustomization,
  isValidationFunction,
  ShopifyFunctionError,
  type FunctionCart,
  type FunctionCartLine,
  type DiscountFunctionInput,
  type PaymentCustomizationInput,
  type DeliveryCustomizationInput,
  type ValidationFunctionInput,
  type ValidationError,
  type DeliveryOperation,
  type PaymentOperation,
} from '../functions'

// =============================================================================
// Test Helpers
// =============================================================================

function mockCart(overrides: Partial<FunctionCart> = {}): FunctionCart {
  return {
    id: 'gid://shopify/Cart/test-cart',
    lines: [
      mockCartLine({ id: 'line-1', quantity: 2 }),
      mockCartLine({ id: 'line-2', quantity: 1, merchandiseId: 'variant-2', productId: 'product-2' }),
    ],
    buyerIdentity: {
      email: 'customer@example.com',
      countryCode: 'US',
      customer: {
        id: 'gid://shopify/Customer/123',
        email: 'customer@example.com',
        metafields: [],
        numberOfOrders: 5,
        amountSpent: { amount: '500.00', currencyCode: 'USD' },
      },
    },
    cost: {
      totalAmount: { amount: '150.00', currencyCode: 'USD' },
      subtotalAmount: { amount: '140.00', currencyCode: 'USD' },
    },
    discountCodes: [],
    ...overrides,
  }
}

function mockCartLine(
  overrides: Partial<FunctionCartLine> & {
    id?: string
    quantity?: number
    merchandiseId?: string
    productId?: string
  } = {}
): FunctionCartLine {
  const {
    id = 'line-1',
    quantity = 1,
    merchandiseId = 'variant-1',
    productId = 'product-1',
    ...rest
  } = overrides
  return {
    id,
    quantity,
    merchandise: {
      id: `gid://shopify/ProductVariant/${merchandiseId}`,
      title: 'Default Title',
      sku: 'SKU-001',
      price: { amount: '29.99', currencyCode: 'USD' },
      product: {
        id: `gid://shopify/Product/${productId}`,
        title: 'Test Product',
        vendor: 'Test Vendor',
        productType: 'Test Type',
        tags: ['sale', 'new'],
        metafields: [],
      },
      metafields: [],
    },
    cost: {
      totalAmount: { amount: String(29.99 * quantity), currencyCode: 'USD' },
      amountPerQuantity: { amount: '29.99', currencyCode: 'USD' },
    },
    ...rest,
  }
}

function mockDiscountInput(cartOverrides: Partial<FunctionCart> = {}): DiscountFunctionInput {
  return {
    cart: mockCart(cartOverrides),
    discountNode: {
      metafield: {
        namespace: 'discount',
        key: 'config',
        value: '{}',
        type: 'json',
      },
    },
  }
}

function mockPaymentInput(
  cartOverrides: Partial<FunctionCart> = {}
): PaymentCustomizationInput {
  return {
    cart: mockCart(cartOverrides),
    paymentMethods: [
      { id: 'credit-card', name: 'Credit Card' },
      { id: 'paypal', name: 'PayPal' },
      { id: 'apple-pay', name: 'Apple Pay' },
      { id: 'google-pay', name: 'Google Pay' },
    ],
    paymentCustomization: {
      metafield: {
        namespace: 'payment',
        key: 'config',
        value: '{}',
        type: 'json',
      },
    },
  }
}

function mockDeliveryInput(
  cartOverrides: Partial<FunctionCart> = {}
): DeliveryCustomizationInput {
  return {
    cart: {
      ...mockCart(cartOverrides),
      deliveryGroups: [
        {
          id: 'delivery-group-1',
          deliveryAddress: {
            countryCode: 'US',
            provinceCode: 'CA',
            city: 'Los Angeles',
            zip: '90001',
          },
          deliveryOptions: [
            {
              handle: 'standard',
              title: 'Standard Shipping',
              cost: { amount: '5.99', currencyCode: 'USD' },
              costAfterDiscounts: { amount: '5.99', currencyCode: 'USD' },
              deliveryMethodType: 'SHIPPING',
            },
            {
              handle: 'express',
              title: 'Express Shipping',
              cost: { amount: '15.99', currencyCode: 'USD' },
              costAfterDiscounts: { amount: '15.99', currencyCode: 'USD' },
              deliveryMethodType: 'SHIPPING',
            },
          ],
          selectedDeliveryOption: {
            handle: 'standard',
            title: 'Standard Shipping',
            cost: { amount: '5.99', currencyCode: 'USD' },
            costAfterDiscounts: { amount: '5.99', currencyCode: 'USD' },
            deliveryMethodType: 'SHIPPING',
          },
        },
      ],
    },
    deliveryCustomization: {
      metafield: {
        namespace: 'delivery',
        key: 'config',
        value: '{}',
        type: 'json',
      },
    },
  }
}

function mockValidationInput(
  cartOverrides: Partial<FunctionCart> = {}
): ValidationFunctionInput {
  return {
    cart: mockCart(cartOverrides),
    validation: {
      metafield: {
        namespace: 'validation',
        key: 'config',
        value: '{}',
        type: 'json',
      },
    },
  }
}

// =============================================================================
// Discount Function Tests
// =============================================================================

describe('@dotdo/shopify - Discount Functions', () => {
  describe('createDiscountFunction', () => {
    it('should create a discount function with correct type', () => {
      const discount = createDiscountFunction({
        run: () => ({ discounts: [] }),
      })

      expect(discount.type).toBe('discount')
      expect(typeof discount.run).toBe('function')
    })

    it('should apply percentage discount for orders over threshold', async () => {
      const discount = createDiscountFunction({
        run: (input) => {
          const total = parseFloat(input.cart.cost.totalAmount.amount)
          if (total > 100) {
            return {
              discounts: [
                {
                  value: percentageDiscount(10),
                  targets: [orderSubtotalTarget()],
                  message: '10% off orders over $100',
                },
              ],
            }
          }
          return { discounts: [] }
        },
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discounts).toHaveLength(1)
      expect(result.discounts[0].value).toEqual({ percentage: { value: '10' } })
      expect(result.discounts[0].message).toBe('10% off orders over $100')
    })

    it('should apply fixed amount discount', async () => {
      const discount = createDiscountFunction({
        run: () => ({
          discounts: [
            {
              value: fixedAmountDiscount(25),
              targets: [orderSubtotalTarget()],
              message: '$25 off your order',
            },
          ],
        }),
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discounts[0].value).toEqual({ fixedAmount: { amount: '25' } })
    })

    it('should apply discount to specific product variants', async () => {
      const discount = createDiscountFunction({
        run: (input) => {
          const discounts = []
          for (const line of input.cart.lines) {
            if (line.merchandise.product.tags.includes('sale')) {
              discounts.push({
                value: percentageDiscount(15),
                targets: [productVariantTarget(line.merchandise.id)],
                message: '15% off sale items',
              })
            }
          }
          return { discounts }
        },
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discounts.length).toBeGreaterThan(0)
      expect(result.discounts[0].targets[0]).toHaveProperty('productVariant')
    })

    it('should not apply discount when conditions are not met', async () => {
      const discount = createDiscountFunction({
        run: (input) => {
          const total = parseFloat(input.cart.cost.totalAmount.amount)
          if (total > 200) {
            return {
              discounts: [
                {
                  value: percentageDiscount(20),
                  targets: [orderSubtotalTarget()],
                },
              ],
            }
          }
          return { discounts: [] }
        },
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discounts).toHaveLength(0)
    })

    it('should support returning customer discounts', async () => {
      const discount = createDiscountFunction({
        run: (input) => {
          if (isReturningCustomer(input.cart, 3)) {
            return {
              discounts: [
                {
                  value: percentageDiscount(5),
                  targets: [orderSubtotalTarget()],
                  message: 'Loyalty discount',
                },
              ],
            }
          }
          return { discounts: [] }
        },
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discounts).toHaveLength(1)
      expect(result.discounts[0].message).toBe('Loyalty discount')
    })

    it('should validate discount output - reject invalid percentage', async () => {
      const discount = createDiscountFunction({
        run: () => ({
          discounts: [
            {
              value: { percentage: { value: '150' } }, // Invalid: > 100
              targets: [orderSubtotalTarget()],
            },
          ],
        }),
      })

      await expect(discount.run(mockDiscountInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate discount output - reject negative fixed amount', async () => {
      const discount = createDiscountFunction({
        run: () => ({
          discounts: [
            {
              value: { fixedAmount: { amount: '-10' } },
              targets: [orderSubtotalTarget()],
            },
          ],
        }),
      })

      await expect(discount.run(mockDiscountInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate discount output - require targets', async () => {
      const discount = createDiscountFunction({
        run: () => ({
          discounts: [
            {
              value: percentageDiscount(10),
              targets: [],
            },
          ],
        }),
      })

      await expect(discount.run(mockDiscountInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should handle async run function', async () => {
      const discount = createDiscountFunction({
        run: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return {
            discounts: [
              {
                value: percentageDiscount(10),
                targets: [orderSubtotalTarget()],
              },
            ],
          }
        },
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discounts).toHaveLength(1)
    })

    it('should wrap run errors in ShopifyFunctionError', async () => {
      const discount = createDiscountFunction({
        run: () => {
          throw new Error('Custom error')
        },
      })

      await expect(discount.run(mockDiscountInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should support discount application strategy', async () => {
      const discount = createDiscountFunction({
        run: () => ({
          discounts: [
            {
              value: percentageDiscount(10),
              targets: [orderSubtotalTarget()],
            },
          ],
          discountApplicationStrategy: 'FIRST',
        }),
      })

      const result = await discount.run(mockDiscountInput())

      expect(result.discountApplicationStrategy).toBe('FIRST')
    })
  })
})

// =============================================================================
// Payment Customization Tests
// =============================================================================

describe('@dotdo/shopify - Payment Customizations', () => {
  describe('createPaymentCustomization', () => {
    it('should create a payment customization with correct type', () => {
      const payment = createPaymentCustomization({
        run: () => ({ operations: [] }),
      })

      expect(payment.type).toBe('payment_customization')
      expect(typeof payment.run).toBe('function')
    })

    it('should hide payment method for specific country', async () => {
      const payment = createPaymentCustomization({
        run: (input) => {
          if (isFromCountry(input.cart, 'DE')) {
            const paypal = input.paymentMethods.find((m) => m.name === 'PayPal')
            if (paypal) {
              return {
                operations: [{ hide: { paymentMethodId: paypal.id } }],
              }
            }
          }
          return { operations: [] }
        },
      })

      const result = await payment.run(
        mockPaymentInput({
          buyerIdentity: { countryCode: 'DE', email: 'test@example.com' },
        })
      )

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0]).toHaveProperty('hide')
      expect((result.operations[0] as { hide: { paymentMethodId: string } }).hide.paymentMethodId).toBe('paypal')
    })

    it('should move payment method to different position', async () => {
      const payment = createPaymentCustomization({
        run: (input) => {
          // Move credit card to top
          const creditCard = input.paymentMethods.find((m) => m.name === 'Credit Card')
          if (creditCard) {
            return {
              operations: [{ move: { paymentMethodId: creditCard.id, index: 0 } }],
            }
          }
          return { operations: [] }
        },
      })

      const result = await payment.run(mockPaymentInput())

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0]).toHaveProperty('move')
      expect((result.operations[0] as { move: { paymentMethodId: string; index: number } }).move.index).toBe(0)
    })

    it('should rename payment method', async () => {
      const payment = createPaymentCustomization({
        run: (input) => {
          const applePay = input.paymentMethods.find((m) => m.name === 'Apple Pay')
          if (applePay) {
            return {
              operations: [
                {
                  rename: {
                    paymentMethodId: applePay.id,
                    name: 'Apple Pay - Recommended',
                  },
                },
              ],
            }
          }
          return { operations: [] }
        },
      })

      const result = await payment.run(mockPaymentInput())

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0]).toHaveProperty('rename')
    })

    it('should apply multiple operations', async () => {
      const payment = createPaymentCustomization({
        run: (input) => {
          const operations: PaymentOperation[] = []

          // Hide Google Pay
          const googlePay = input.paymentMethods.find((m) => m.name === 'Google Pay')
          if (googlePay) {
            operations.push({ hide: { paymentMethodId: googlePay.id } })
          }

          // Move Apple Pay to top
          const applePay = input.paymentMethods.find((m) => m.name === 'Apple Pay')
          if (applePay) {
            operations.push({ move: { paymentMethodId: applePay.id, index: 0 } })
          }

          return { operations }
        },
      })

      const result = await payment.run(mockPaymentInput())

      expect(result.operations).toHaveLength(2)
    })

    it('should validate operation - reject invalid hide operation', async () => {
      const payment = createPaymentCustomization({
        run: () => ({
          operations: [{ hide: { paymentMethodId: '' } }],
        }),
      })

      await expect(payment.run(mockPaymentInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate operation - reject negative index in move', async () => {
      const payment = createPaymentCustomization({
        run: () => ({
          operations: [{ move: { paymentMethodId: 'credit-card', index: -1 } }],
        }),
      })

      await expect(payment.run(mockPaymentInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate operation - reject rename without name', async () => {
      const payment = createPaymentCustomization({
        run: () => ({
          operations: [{ rename: { paymentMethodId: 'credit-card', name: '' } }],
        }),
      })

      await expect(payment.run(mockPaymentInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should return empty operations when no customization needed', async () => {
      const payment = createPaymentCustomization({
        run: () => ({ operations: [] }),
      })

      const result = await payment.run(mockPaymentInput())

      expect(result.operations).toHaveLength(0)
    })

    it('should hide payment for cart total below threshold', async () => {
      const payment = createPaymentCustomization({
        run: (input) => {
          const total = getCartTotal(input.cart)
          // Hide PayPal for orders under $20
          if (total < 20) {
            const paypal = input.paymentMethods.find((m) => m.name === 'PayPal')
            if (paypal) {
              return { operations: [{ hide: { paymentMethodId: paypal.id } }] }
            }
          }
          return { operations: [] }
        },
      })

      const result = await payment.run(
        mockPaymentInput({
          cost: {
            totalAmount: { amount: '15.00', currencyCode: 'USD' },
            subtotalAmount: { amount: '15.00', currencyCode: 'USD' },
          },
        })
      )

      expect(result.operations).toHaveLength(1)
    })
  })
})

// =============================================================================
// Delivery Customization Tests
// =============================================================================

describe('@dotdo/shopify - Delivery Customizations', () => {
  describe('createDeliveryCustomization', () => {
    it('should create a delivery customization with correct type', () => {
      const delivery = createDeliveryCustomization({
        run: () => ({ operations: [] }),
      })

      expect(delivery.type).toBe('delivery_customization')
      expect(typeof delivery.run).toBe('function')
    })

    it('should hide delivery option', async () => {
      const delivery = createDeliveryCustomization({
        run: () => ({
          operations: [{ hide: { deliveryOptionHandle: 'express' } }],
        }),
      })

      const result = await delivery.run(mockDeliveryInput())

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0]).toHaveProperty('hide')
      expect((result.operations[0] as { hide: { deliveryOptionHandle: string } }).hide.deliveryOptionHandle).toBe(
        'express'
      )
    })

    it('should rename delivery option for free shipping threshold', async () => {
      const delivery = createDeliveryCustomization({
        run: (input) => {
          const total = getCartTotal(input.cart)
          if (total > 50) {
            return {
              operations: [
                {
                  rename: {
                    deliveryOptionHandle: 'standard',
                    title: 'FREE Standard Shipping (5-7 days)',
                  },
                },
              ],
            }
          }
          return { operations: [] }
        },
      })

      const result = await delivery.run(mockDeliveryInput())

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0]).toHaveProperty('rename')
      expect(
        (result.operations[0] as { rename: { title: string } }).rename.title
      ).toBe('FREE Standard Shipping (5-7 days)')
    })

    it('should move delivery option to different position', async () => {
      const delivery = createDeliveryCustomization({
        run: () => ({
          operations: [{ move: { deliveryOptionHandle: 'express', index: 0 } }],
        }),
      })

      const result = await delivery.run(mockDeliveryInput())

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0]).toHaveProperty('move')
    })

    it('should apply multiple operations', async () => {
      const delivery = createDeliveryCustomization({
        run: () => ({
          operations: [
            { rename: { deliveryOptionHandle: 'standard', title: 'Economy Shipping' } },
            { move: { deliveryOptionHandle: 'express', index: 0 } },
          ],
        }),
      })

      const result = await delivery.run(mockDeliveryInput())

      expect(result.operations).toHaveLength(2)
    })

    it('should validate operation - reject empty handle in hide', async () => {
      const delivery = createDeliveryCustomization({
        run: () => ({
          operations: [{ hide: { deliveryOptionHandle: '' } }],
        }),
      })

      await expect(delivery.run(mockDeliveryInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate operation - reject negative index in move', async () => {
      const delivery = createDeliveryCustomization({
        run: () => ({
          operations: [{ move: { deliveryOptionHandle: 'standard', index: -1 } }],
        }),
      })

      await expect(delivery.run(mockDeliveryInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate operation - reject rename without title', async () => {
      const delivery = createDeliveryCustomization({
        run: () => ({
          operations: [{ rename: { deliveryOptionHandle: 'standard', title: '' } }],
        }),
      })

      await expect(delivery.run(mockDeliveryInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should hide expensive shipping for low value carts', async () => {
      const delivery = createDeliveryCustomization({
        run: (input) => {
          const total = getCartTotal(input.cart)
          if (total < 30) {
            return {
              operations: [{ hide: { deliveryOptionHandle: 'express' } }],
            }
          }
          return { operations: [] }
        },
      })

      const result = await delivery.run(
        mockDeliveryInput({
          cost: {
            totalAmount: { amount: '25.00', currencyCode: 'USD' },
            subtotalAmount: { amount: '25.00', currencyCode: 'USD' },
          },
        })
      )

      expect(result.operations).toHaveLength(1)
    })
  })
})

// =============================================================================
// Validation Function Tests
// =============================================================================

describe('@dotdo/shopify - Validation Functions', () => {
  describe('createValidationFunction', () => {
    it('should create a validation function with correct type', () => {
      const validation = createValidationFunction({
        run: () => ({ errors: [] }),
      })

      expect(validation.type).toBe('validation')
      expect(typeof validation.run).toBe('function')
      expect(validation.blockOnFailure).toBe(true)
    })

    it('should allow configuring blockOnFailure', () => {
      const validation = createValidationFunction({
        blockOnFailure: false,
        run: () => ({ errors: [] }),
      })

      expect(validation.blockOnFailure).toBe(false)
    })

    it('should validate maximum quantity per line', async () => {
      const validation = createValidationFunction({
        run: (input) => {
          const errors: ValidationError[] = []
          for (const line of input.cart.lines) {
            if (line.quantity > 5) {
              errors.push({
                localizedMessage: 'Maximum 5 items per product allowed',
                target: `$.cart.lines[${line.id}].quantity`,
              })
            }
          }
          return { errors }
        },
      })

      const result = await validation.run(
        mockValidationInput({
          lines: [mockCartLine({ id: 'line-1', quantity: 10 })],
        })
      )

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].localizedMessage).toBe('Maximum 5 items per product allowed')
    })

    it('should validate minimum order value', async () => {
      const validation = createValidationFunction({
        run: (input) => {
          const total = getCartTotal(input.cart)
          if (total < 10) {
            return {
              errors: [
                {
                  localizedMessage: 'Minimum order value is $10',
                  target: '$.cart',
                },
              ],
            }
          }
          return { errors: [] }
        },
      })

      const result = await validation.run(
        mockValidationInput({
          cost: {
            totalAmount: { amount: '5.00', currencyCode: 'USD' },
            subtotalAmount: { amount: '5.00', currencyCode: 'USD' },
          },
        })
      )

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].localizedMessage).toBe('Minimum order value is $10')
    })

    it('should validate total cart quantity', async () => {
      const validation = createValidationFunction({
        run: (input) => {
          const totalQuantity = getCartQuantity(input.cart)
          if (totalQuantity > 20) {
            return {
              errors: [
                {
                  localizedMessage: 'Maximum 20 items per order',
                  target: '$.cart',
                },
              ],
            }
          }
          return { errors: [] }
        },
      })

      const result = await validation.run(
        mockValidationInput({
          lines: [
            mockCartLine({ id: 'line-1', quantity: 15 }),
            mockCartLine({ id: 'line-2', quantity: 10 }),
          ],
        })
      )

      expect(result.errors).toHaveLength(1)
    })

    it('should validate product restrictions', async () => {
      const restrictedProductId = 'gid://shopify/Product/restricted-123'

      const validation = createValidationFunction({
        run: (input) => {
          const errors: ValidationError[] = []
          for (const line of input.cart.lines) {
            if (line.merchandise.product.id === restrictedProductId) {
              // Require account for restricted products
              if (!input.cart.buyerIdentity?.customer) {
                errors.push({
                  localizedMessage: 'You must be logged in to purchase this product',
                  target: `$.cart.lines[${line.id}]`,
                })
              }
            }
          }
          return { errors }
        },
      })

      const result = await validation.run(
        mockValidationInput({
          buyerIdentity: { email: 'guest@example.com', countryCode: 'US' },
          lines: [
            mockCartLine({
              id: 'line-1',
              productId: 'restricted-123',
            }),
          ],
        })
      )

      expect(result.errors).toHaveLength(1)
    })

    it('should return empty errors when validation passes', async () => {
      const validation = createValidationFunction({
        run: () => ({ errors: [] }),
      })

      const result = await validation.run(mockValidationInput())

      expect(result.errors).toHaveLength(0)
    })

    it('should return multiple errors', async () => {
      const validation = createValidationFunction({
        run: (input) => {
          const errors: ValidationError[] = []

          // Check minimum order
          const total = getCartTotal(input.cart)
          if (total < 100) {
            errors.push({
              localizedMessage: 'Minimum order is $100',
              target: '$.cart',
            })
          }

          // Check quantity limits
          for (const line of input.cart.lines) {
            if (line.quantity > 3) {
              errors.push({
                localizedMessage: 'Max 3 per item',
                target: `$.cart.lines[${line.id}].quantity`,
              })
            }
          }

          return { errors }
        },
      })

      const result = await validation.run(
        mockValidationInput({
          cost: {
            totalAmount: { amount: '50.00', currencyCode: 'USD' },
            subtotalAmount: { amount: '50.00', currencyCode: 'USD' },
          },
          lines: [mockCartLine({ id: 'line-1', quantity: 5 })],
        })
      )

      expect(result.errors).toHaveLength(2)
    })

    it('should validate error output - reject missing localizedMessage', async () => {
      const validation = createValidationFunction({
        run: () => ({
          errors: [
            {
              localizedMessage: '',
              target: '$.cart',
            },
          ],
        }),
      })

      await expect(validation.run(mockValidationInput())).rejects.toThrow(ShopifyFunctionError)
    })

    it('should validate error output - reject invalid target format', async () => {
      const validation = createValidationFunction({
        run: () => ({
          errors: [
            {
              localizedMessage: 'Error',
              target: 'invalid-path', // Must start with $.
            },
          ],
        }),
      })

      await expect(validation.run(mockValidationInput())).rejects.toThrow(ShopifyFunctionError)
    })
  })
})

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe('@dotdo/shopify - Utility Functions', () => {
  describe('percentageDiscount', () => {
    it('should create percentage discount value', () => {
      expect(percentageDiscount(10)).toEqual({ percentage: { value: '10' } })
      expect(percentageDiscount('15.5')).toEqual({ percentage: { value: '15.5' } })
    })
  })

  describe('fixedAmountDiscount', () => {
    it('should create fixed amount discount value', () => {
      expect(fixedAmountDiscount(25)).toEqual({ fixedAmount: { amount: '25' } })
      expect(fixedAmountDiscount('30.50')).toEqual({ fixedAmount: { amount: '30.50' } })
    })
  })

  describe('orderSubtotalTarget', () => {
    it('should create order subtotal target', () => {
      expect(orderSubtotalTarget()).toEqual({
        orderSubtotal: { excludedVariantIds: [] },
      })
      expect(orderSubtotalTarget(['variant-1', 'variant-2'])).toEqual({
        orderSubtotal: { excludedVariantIds: ['variant-1', 'variant-2'] },
      })
    })
  })

  describe('productVariantTarget', () => {
    it('should create product variant target', () => {
      expect(productVariantTarget('variant-1')).toEqual({
        productVariant: { id: 'variant-1', quantity: undefined },
      })
      expect(productVariantTarget('variant-1', 2)).toEqual({
        productVariant: { id: 'variant-1', quantity: 2 },
      })
    })
  })

  describe('getCartTotal', () => {
    it('should return cart total as number', () => {
      const cart = mockCart()
      expect(getCartTotal(cart)).toBe(150)
    })
  })

  describe('getCartSubtotal', () => {
    it('should return cart subtotal as number', () => {
      const cart = mockCart()
      expect(getCartSubtotal(cart)).toBe(140)
    })
  })

  describe('getCartQuantity', () => {
    it('should return total quantity of items in cart', () => {
      const cart = mockCart()
      expect(getCartQuantity(cart)).toBe(3) // 2 + 1
    })
  })

  describe('cartHasProduct', () => {
    it('should check if cart has specific product', () => {
      const cart = mockCart()
      expect(cartHasProduct(cart, 'gid://shopify/Product/product-1')).toBe(true)
      expect(cartHasProduct(cart, 'gid://shopify/Product/nonexistent')).toBe(false)
    })
  })

  describe('cartHasVariant', () => {
    it('should check if cart has specific variant', () => {
      const cart = mockCart()
      expect(cartHasVariant(cart, 'gid://shopify/ProductVariant/variant-1')).toBe(true)
      expect(cartHasVariant(cart, 'gid://shopify/ProductVariant/nonexistent')).toBe(false)
    })
  })

  describe('isReturningCustomer', () => {
    it('should check if customer is returning', () => {
      const cart = mockCart()
      expect(isReturningCustomer(cart)).toBe(true) // Default has 5 orders
      expect(isReturningCustomer(cart, 10)).toBe(false)
    })

    it('should handle missing customer', () => {
      const cart = mockCart({ buyerIdentity: undefined })
      expect(isReturningCustomer(cart)).toBe(false)
    })
  })

  describe('isFromCountry', () => {
    it('should check customer country', () => {
      const cart = mockCart()
      expect(isFromCountry(cart, 'US')).toBe(true)
      expect(isFromCountry(cart, 'DE')).toBe(false)
    })
  })

  describe('getProductQuantity', () => {
    it('should get total quantity of specific product', () => {
      const cart = mockCart()
      expect(getProductQuantity(cart, 'gid://shopify/Product/product-1')).toBe(2)
      expect(getProductQuantity(cart, 'gid://shopify/Product/nonexistent')).toBe(0)
    })
  })

  describe('getVariantQuantity', () => {
    it('should get quantity of specific variant', () => {
      const cart = mockCart()
      expect(getVariantQuantity(cart, 'gid://shopify/ProductVariant/variant-1')).toBe(2)
      expect(getVariantQuantity(cart, 'gid://shopify/ProductVariant/nonexistent')).toBe(0)
    })
  })
})

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('@dotdo/shopify - Type Guards', () => {
  describe('isDiscountFunction', () => {
    it('should identify discount functions', () => {
      const discount = createDiscountFunction({ run: () => ({ discounts: [] }) })
      expect(isDiscountFunction(discount)).toBe(true)
      expect(isDiscountFunction({})).toBe(false)
      expect(isDiscountFunction(null)).toBe(false)
    })
  })

  describe('isPaymentCustomization', () => {
    it('should identify payment customizations', () => {
      const payment = createPaymentCustomization({ run: () => ({ operations: [] }) })
      expect(isPaymentCustomization(payment)).toBe(true)
      expect(isPaymentCustomization({})).toBe(false)
    })
  })

  describe('isDeliveryCustomization', () => {
    it('should identify delivery customizations', () => {
      const delivery = createDeliveryCustomization({ run: () => ({ operations: [] }) })
      expect(isDeliveryCustomization(delivery)).toBe(true)
      expect(isDeliveryCustomization({})).toBe(false)
    })
  })

  describe('isValidationFunction', () => {
    it('should identify validation functions', () => {
      const validation = createValidationFunction({ run: () => ({ errors: [] }) })
      expect(isValidationFunction(validation)).toBe(true)
      expect(isValidationFunction({})).toBe(false)
    })
  })
})

// =============================================================================
// ShopifyFunctionError Tests
// =============================================================================

describe('@dotdo/shopify - ShopifyFunctionError', () => {
  it('should create error with code and message', () => {
    const error = new ShopifyFunctionError('Test error', 'TEST_ERROR')
    expect(error.message).toBe('Test error')
    expect(error.code).toBe('TEST_ERROR')
    expect(error.name).toBe('ShopifyFunctionError')
  })

  it('should support optional target', () => {
    const error = new ShopifyFunctionError('Test error', 'TEST_ERROR', '$.cart')
    expect(error.target).toBe('$.cart')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('@dotdo/shopify - Functions Integration', () => {
  it('should combine discount and validation functions', async () => {
    const cart = mockCart({
      cost: {
        totalAmount: { amount: '200.00', currencyCode: 'USD' },
        subtotalAmount: { amount: '200.00', currencyCode: 'USD' },
      },
      lines: [mockCartLine({ quantity: 3 })],
    })

    // Create discount function
    const discount = createDiscountFunction({
      run: (input) => {
        const total = getCartTotal(input.cart)
        if (total > 100) {
          return {
            discounts: [
              {
                value: percentageDiscount(10),
                targets: [orderSubtotalTarget()],
              },
            ],
          }
        }
        return { discounts: [] }
      },
    })

    // Create validation function
    const validation = createValidationFunction({
      run: (input) => {
        const errors: ValidationError[] = []
        const quantity = getCartQuantity(input.cart)
        if (quantity > 10) {
          errors.push({
            localizedMessage: 'Maximum 10 items per order',
            target: '$.cart',
          })
        }
        return { errors }
      },
    })

    // Run both
    const discountResult = await discount.run({ cart, discountNode: {} })
    const validationResult = await validation.run({ cart, validation: {} })

    expect(discountResult.discounts).toHaveLength(1)
    expect(validationResult.errors).toHaveLength(0)
  })

  it('should run complex multi-function scenario', async () => {
    const cart = mockCart({
      buyerIdentity: {
        countryCode: 'DE',
        email: 'german@example.com',
        customer: {
          id: 'cust-1',
          email: 'german@example.com',
          metafields: [],
          numberOfOrders: 10,
          amountSpent: { amount: '1000.00', currencyCode: 'EUR' },
        },
      },
      cost: {
        totalAmount: { amount: '75.00', currencyCode: 'EUR' },
        subtotalAmount: { amount: '75.00', currencyCode: 'EUR' },
      },
    })

    // Discount for loyal customers in Germany
    const discount = createDiscountFunction({
      run: (input) => {
        if (isFromCountry(input.cart, 'DE') && isReturningCustomer(input.cart, 5)) {
          return {
            discounts: [
              {
                value: percentageDiscount(15),
                targets: [orderSubtotalTarget()],
                message: 'Loyal customer discount',
              },
            ],
          }
        }
        return { discounts: [] }
      },
    })

    // Hide PayPal for German customers
    const payment = createPaymentCustomization({
      run: (input) => {
        if (isFromCountry(input.cart, 'DE')) {
          return {
            operations: [{ hide: { paymentMethodId: 'paypal' } }],
          }
        }
        return { operations: [] }
      },
    })

    // Free shipping for orders over 50 EUR
    const delivery = createDeliveryCustomization({
      run: (input) => {
        const total = getCartTotal(input.cart)
        if (total > 50) {
          return {
            operations: [
              {
                rename: {
                  deliveryOptionHandle: 'standard',
                  title: 'Kostenloser Standardversand',
                },
              },
            ],
          }
        }
        return { operations: [] }
      },
    })

    // Run all functions
    const discountResult = await discount.run({ cart, discountNode: {} })
    const paymentResult = await payment.run({
      cart,
      paymentMethods: [{ id: 'paypal', name: 'PayPal' }],
      paymentCustomization: {},
    })
    const deliveryResult = await delivery.run({ cart, deliveryCustomization: {} })

    expect(discountResult.discounts).toHaveLength(1)
    expect(discountResult.discounts[0].message).toBe('Loyal customer discount')
    expect(paymentResult.operations).toHaveLength(1)
    expect(deliveryResult.operations).toHaveLength(1)
    expect((deliveryResult.operations[0] as { rename: { title: string } }).rename.title).toBe(
      'Kostenloser Standardversand'
    )
  })
})
