/**
 * @dotdo/shopify - Shopify Functions Compatibility Layer
 *
 * Implementation of Shopify Functions for edge-native execution.
 * Supports discount functions, payment customizations, delivery customizations,
 * and validation functions.
 *
 * @example
 * ```typescript
 * import {
 *   createDiscountFunction,
 *   createPaymentCustomization,
 *   createDeliveryCustomization,
 *   createValidationFunction,
 * } from '@dotdo/shopify'
 *
 * // Discount function
 * const discount = createDiscountFunction({
 *   run: async (input) => {
 *     if (input.cart.cost.totalAmount.amount > 100) {
 *       return {
 *         discounts: [{
 *           value: { percentage: { value: '10' } },
 *           targets: [{ orderSubtotal: { excludedVariantIds: [] } }],
 *           message: '10% off orders over $100',
 *         }]
 *       }
 *     }
 *     return { discounts: [] }
 *   }
 * })
 *
 * // Payment customization
 * const payment = createPaymentCustomization({
 *   run: async (input) => {
 *     const hidePayPal = input.cart.buyerIdentity?.countryCode === 'DE'
 *     return {
 *       operations: hidePayPal
 *         ? [{ hide: { paymentMethodId: 'paypal' } }]
 *         : []
 *     }
 *   }
 * })
 *
 * // Delivery customization
 * const delivery = createDeliveryCustomization({
 *   run: async (input) => {
 *     return {
 *       operations: [{
 *         rename: {
 *           deliveryOptionHandle: 'standard',
 *           title: 'Free Standard Shipping (5-7 days)'
 *         }
 *       }]
 *     }
 *   }
 * })
 *
 * // Cart validation
 * const validation = createValidationFunction({
 *   run: async (input) => {
 *     const errors: ValidationError[] = []
 *     for (const line of input.cart.lines) {
 *       if (line.quantity > 10) {
 *         errors.push({
 *           localizedMessage: 'Maximum 10 items per product',
 *           target: `$.cart.lines[${line.id}].quantity`
 *         })
 *       }
 *     }
 *     return { errors }
 *   }
 * })
 * ```
 *
 * @see https://shopify.dev/docs/api/functions
 * @module @dotdo/shopify/functions
 */

// =============================================================================
// Shared Types
// =============================================================================

/**
 * Money amount representation
 */
export interface FunctionMoney {
  amount: string
  currencyCode: string
}

/**
 * Metafield in function context
 */
export interface FunctionMetafield {
  namespace: string
  key: string
  value: string
  type: string
}

/**
 * Product variant in function context
 */
export interface FunctionVariant {
  id: string
  title: string
  sku?: string
  price: FunctionMoney
  product: {
    id: string
    title: string
    vendor: string
    productType: string
    tags: string[]
    metafields: FunctionMetafield[]
  }
  metafields: FunctionMetafield[]
}

/**
 * Cart line item in function context
 */
export interface FunctionCartLine {
  id: string
  quantity: number
  merchandise: FunctionVariant
  cost: {
    totalAmount: FunctionMoney
    amountPerQuantity: FunctionMoney
  }
  attribute?: { key: string; value?: string }[]
  sellingPlanAllocation?: {
    sellingPlan: { id: string; name: string }
  }
}

/**
 * Cart buyer identity
 */
export interface FunctionBuyerIdentity {
  email?: string
  phone?: string
  countryCode?: string
  customer?: {
    id: string
    email?: string
    metafields: FunctionMetafield[]
    numberOfOrders: number
    amountSpent: FunctionMoney
  }
}

/**
 * Cart cost breakdown
 */
export interface FunctionCartCost {
  totalAmount: FunctionMoney
  subtotalAmount: FunctionMoney
}

/**
 * Cart in function context
 */
export interface FunctionCart {
  id: string
  lines: FunctionCartLine[]
  buyerIdentity?: FunctionBuyerIdentity
  cost: FunctionCartCost
  attribute?: { key: string; value?: string }[]
  discountCodes: { code: string }[]
  deliveryGroups?: FunctionDeliveryGroup[]
}

/**
 * Delivery group in function context
 */
export interface FunctionDeliveryGroup {
  id: string
  deliveryAddress?: {
    countryCode?: string
    provinceCode?: string
    city?: string
    zip?: string
  }
  deliveryOptions: FunctionDeliveryOption[]
  selectedDeliveryOption?: FunctionDeliveryOption
}

/**
 * Delivery option in function context
 */
export interface FunctionDeliveryOption {
  handle: string
  title: string
  cost: FunctionMoney
  costAfterDiscounts: FunctionMoney
  deliveryMethodType: 'SHIPPING' | 'PICK_UP' | 'NONE' | 'LOCAL' | 'RETAIL'
}

// =============================================================================
// Discount Function Types
// =============================================================================

/**
 * Discount function input
 */
export interface DiscountFunctionInput {
  cart: FunctionCart
  discountNode: {
    metafield?: FunctionMetafield
  }
}

/**
 * Discount target - order subtotal
 */
export interface OrderSubtotalTarget {
  orderSubtotal: {
    excludedVariantIds: string[]
  }
}

/**
 * Discount target - product variant
 */
export interface ProductVariantTarget {
  productVariant: {
    id: string
    quantity?: number
  }
}

/**
 * Discount value - percentage
 */
export interface PercentageValue {
  percentage: {
    value: string
  }
}

/**
 * Discount value - fixed amount
 */
export interface FixedAmountValue {
  fixedAmount: {
    amount: string
  }
}

/**
 * Discount effect
 */
export interface Discount {
  value: PercentageValue | FixedAmountValue
  targets: (OrderSubtotalTarget | ProductVariantTarget)[]
  message?: string
  conditions?: DiscountCondition[]
}

/**
 * Discount condition
 */
export interface DiscountCondition {
  orderMinimumSubtotal?: {
    minimumAmount: string
    targetType: 'ORDER_SUBTOTAL'
  }
  productMinimumQuantity?: {
    ids: string[]
    minimumQuantity: number
    targetType: 'PRODUCT_VARIANT'
  }
  productMinimumSubtotal?: {
    ids: string[]
    minimumAmount: string
    targetType: 'PRODUCT_VARIANT'
  }
}

/**
 * Discount function output
 */
export interface DiscountFunctionOutput {
  discounts: Discount[]
  discountApplicationStrategy?: 'FIRST' | 'MAXIMUM' | 'ALL'
}

/**
 * Discount function configuration
 */
export interface DiscountFunctionConfig {
  /** Function implementation */
  run: (input: DiscountFunctionInput) => Promise<DiscountFunctionOutput> | DiscountFunctionOutput
  /** Function namespace (for metafields) */
  namespace?: string
  /** Function key (for metafields) */
  key?: string
}

/**
 * Discount function instance
 */
export interface DiscountFunction {
  /** Execute the discount function */
  run: (input: DiscountFunctionInput) => Promise<DiscountFunctionOutput>
  /** Function type identifier */
  type: 'discount'
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
}

// =============================================================================
// Payment Customization Types
// =============================================================================

/**
 * Payment method in function context
 */
export interface FunctionPaymentMethod {
  id: string
  name: string
}

/**
 * Payment customization input
 */
export interface PaymentCustomizationInput {
  cart: FunctionCart
  paymentMethods: FunctionPaymentMethod[]
  paymentCustomization: {
    metafield?: FunctionMetafield
  }
}

/**
 * Hide payment method operation
 */
export interface HidePaymentOperation {
  hide: {
    paymentMethodId: string
  }
}

/**
 * Move payment method operation
 */
export interface MovePaymentOperation {
  move: {
    paymentMethodId: string
    index: number
  }
}

/**
 * Rename payment method operation
 */
export interface RenamePaymentOperation {
  rename: {
    paymentMethodId: string
    name: string
  }
}

/**
 * Payment customization operation
 */
export type PaymentOperation = HidePaymentOperation | MovePaymentOperation | RenamePaymentOperation

/**
 * Payment customization output
 */
export interface PaymentCustomizationOutput {
  operations: PaymentOperation[]
}

/**
 * Payment customization configuration
 */
export interface PaymentCustomizationConfig {
  /** Function implementation */
  run: (input: PaymentCustomizationInput) => Promise<PaymentCustomizationOutput> | PaymentCustomizationOutput
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
}

/**
 * Payment customization instance
 */
export interface PaymentCustomization {
  /** Execute the payment customization */
  run: (input: PaymentCustomizationInput) => Promise<PaymentCustomizationOutput>
  /** Function type identifier */
  type: 'payment_customization'
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
}

// =============================================================================
// Delivery Customization Types
// =============================================================================

/**
 * Delivery customization input
 */
export interface DeliveryCustomizationInput {
  cart: FunctionCart
  deliveryCustomization: {
    metafield?: FunctionMetafield
  }
}

/**
 * Hide delivery option operation
 */
export interface HideDeliveryOperation {
  hide: {
    deliveryOptionHandle: string
  }
}

/**
 * Move delivery option operation
 */
export interface MoveDeliveryOperation {
  move: {
    deliveryOptionHandle: string
    index: number
  }
}

/**
 * Rename delivery option operation
 */
export interface RenameDeliveryOperation {
  rename: {
    deliveryOptionHandle: string
    title: string
  }
}

/**
 * Delivery customization operation
 */
export type DeliveryOperation = HideDeliveryOperation | MoveDeliveryOperation | RenameDeliveryOperation

/**
 * Delivery customization output
 */
export interface DeliveryCustomizationOutput {
  operations: DeliveryOperation[]
}

/**
 * Delivery customization configuration
 */
export interface DeliveryCustomizationConfig {
  /** Function implementation */
  run: (input: DeliveryCustomizationInput) => Promise<DeliveryCustomizationOutput> | DeliveryCustomizationOutput
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
}

/**
 * Delivery customization instance
 */
export interface DeliveryCustomization {
  /** Execute the delivery customization */
  run: (input: DeliveryCustomizationInput) => Promise<DeliveryCustomizationOutput>
  /** Function type identifier */
  type: 'delivery_customization'
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
}

// =============================================================================
// Validation Function Types
// =============================================================================

/**
 * Validation function input
 */
export interface ValidationFunctionInput {
  cart: FunctionCart
  validation: {
    metafield?: FunctionMetafield
  }
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Localized error message shown to customer */
  localizedMessage: string
  /** JSON path to the target of the error (e.g., "$.cart.lines[0].quantity") */
  target: string
}

/**
 * Validation function output
 */
export interface ValidationFunctionOutput {
  errors: ValidationError[]
}

/**
 * Validation function configuration
 */
export interface ValidationFunctionConfig {
  /** Function implementation */
  run: (input: ValidationFunctionInput) => Promise<ValidationFunctionOutput> | ValidationFunctionOutput
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
  /** Block checkout if validation fails */
  blockOnFailure?: boolean
}

/**
 * Validation function instance
 */
export interface ValidationFunction {
  /** Execute the validation function */
  run: (input: ValidationFunctionInput) => Promise<ValidationFunctionOutput>
  /** Function type identifier */
  type: 'validation'
  /** Function namespace */
  namespace?: string
  /** Function key */
  key?: string
  /** Block checkout if validation fails */
  blockOnFailure: boolean
}

// =============================================================================
// Order Discount Types (Additional discount function types)
// =============================================================================

/**
 * Order discount function - applies discounts to the entire order
 */
export interface OrderDiscountFunctionInput extends DiscountFunctionInput {
  presentmentCurrencyRate: string
  localization: {
    country: { isoCode: string }
    language: { isoCode: string }
  }
}

/**
 * Product discount function - applies discounts to specific products
 */
export interface ProductDiscountFunctionInput extends DiscountFunctionInput {
  presentmentCurrencyRate: string
}

/**
 * Shipping discount function - applies discounts to shipping
 */
export interface ShippingDiscountFunctionInput {
  cart: FunctionCart
  discountNode: {
    metafield?: FunctionMetafield
  }
}

/**
 * Shipping discount target
 */
export interface ShippingLineTarget {
  deliveryGroup: {
    id: string
  }
}

/**
 * Shipping discount output
 */
export interface ShippingDiscountFunctionOutput {
  discounts: Array<{
    value: PercentageValue | FixedAmountValue
    targets: ShippingLineTarget[]
    message?: string
  }>
}

// =============================================================================
// Function Error Types
// =============================================================================

/**
 * Shopify Functions error
 */
export class ShopifyFunctionError extends Error {
  code: string
  target?: string

  constructor(message: string, code: string, target?: string) {
    super(message)
    this.name = 'ShopifyFunctionError'
    this.code = code
    this.target = target
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a discount function
 *
 * @example
 * ```typescript
 * const discount = createDiscountFunction({
 *   run: async (input) => {
 *     const total = parseFloat(input.cart.cost.totalAmount.amount)
 *     if (total > 100) {
 *       return {
 *         discounts: [{
 *           value: { percentage: { value: '10' } },
 *           targets: [{ orderSubtotal: { excludedVariantIds: [] } }],
 *           message: '10% off orders over $100',
 *         }]
 *       }
 *     }
 *     return { discounts: [] }
 *   }
 * })
 * ```
 */
export function createDiscountFunction(config: DiscountFunctionConfig): DiscountFunction {
  return {
    type: 'discount',
    namespace: config.namespace,
    key: config.key,
    run: async (input: DiscountFunctionInput): Promise<DiscountFunctionOutput> => {
      try {
        const result = await config.run(input)
        return validateDiscountOutput(result)
      } catch (error) {
        if (error instanceof ShopifyFunctionError) {
          throw error
        }
        throw new ShopifyFunctionError(
          `Discount function failed: ${(error as Error).message}`,
          'FUNCTION_EXECUTION_ERROR'
        )
      }
    },
  }
}

/**
 * Create a payment customization function
 *
 * @example
 * ```typescript
 * const payment = createPaymentCustomization({
 *   run: async (input) => {
 *     // Hide PayPal for German customers
 *     if (input.cart.buyerIdentity?.countryCode === 'DE') {
 *       const paypal = input.paymentMethods.find(m => m.name.includes('PayPal'))
 *       if (paypal) {
 *         return { operations: [{ hide: { paymentMethodId: paypal.id } }] }
 *       }
 *     }
 *     return { operations: [] }
 *   }
 * })
 * ```
 */
export function createPaymentCustomization(config: PaymentCustomizationConfig): PaymentCustomization {
  return {
    type: 'payment_customization',
    namespace: config.namespace,
    key: config.key,
    run: async (input: PaymentCustomizationInput): Promise<PaymentCustomizationOutput> => {
      try {
        const result = await config.run(input)
        return validatePaymentOutput(result)
      } catch (error) {
        if (error instanceof ShopifyFunctionError) {
          throw error
        }
        throw new ShopifyFunctionError(
          `Payment customization failed: ${(error as Error).message}`,
          'FUNCTION_EXECUTION_ERROR'
        )
      }
    },
  }
}

/**
 * Create a delivery customization function
 *
 * @example
 * ```typescript
 * const delivery = createDeliveryCustomization({
 *   run: async (input) => {
 *     const operations: DeliveryOperation[] = []
 *
 *     // Rename standard shipping for free shipping threshold
 *     const total = parseFloat(input.cart.cost.totalAmount.amount)
 *     if (total > 50) {
 *       operations.push({
 *         rename: {
 *           deliveryOptionHandle: 'standard',
 *           title: 'FREE Standard Shipping'
 *         }
 *       })
 *     }
 *
 *     return { operations }
 *   }
 * })
 * ```
 */
export function createDeliveryCustomization(config: DeliveryCustomizationConfig): DeliveryCustomization {
  return {
    type: 'delivery_customization',
    namespace: config.namespace,
    key: config.key,
    run: async (input: DeliveryCustomizationInput): Promise<DeliveryCustomizationOutput> => {
      try {
        const result = await config.run(input)
        return validateDeliveryOutput(result)
      } catch (error) {
        if (error instanceof ShopifyFunctionError) {
          throw error
        }
        throw new ShopifyFunctionError(
          `Delivery customization failed: ${(error as Error).message}`,
          'FUNCTION_EXECUTION_ERROR'
        )
      }
    },
  }
}

/**
 * Create a validation function
 *
 * @example
 * ```typescript
 * const validation = createValidationFunction({
 *   blockOnFailure: true,
 *   run: async (input) => {
 *     const errors: ValidationError[] = []
 *
 *     // Check maximum quantity per line
 *     for (const line of input.cart.lines) {
 *       if (line.quantity > 10) {
 *         errors.push({
 *           localizedMessage: 'Maximum 10 items per product allowed',
 *           target: `$.cart.lines[${line.id}].quantity`
 *         })
 *       }
 *     }
 *
 *     // Check minimum order value
 *     const total = parseFloat(input.cart.cost.totalAmount.amount)
 *     if (total < 10) {
 *       errors.push({
 *         localizedMessage: 'Minimum order value is $10',
 *         target: '$.cart'
 *       })
 *     }
 *
 *     return { errors }
 *   }
 * })
 * ```
 */
export function createValidationFunction(config: ValidationFunctionConfig): ValidationFunction {
  return {
    type: 'validation',
    namespace: config.namespace,
    key: config.key,
    blockOnFailure: config.blockOnFailure ?? true,
    run: async (input: ValidationFunctionInput): Promise<ValidationFunctionOutput> => {
      try {
        const result = await config.run(input)
        return validateValidationOutput(result)
      } catch (error) {
        if (error instanceof ShopifyFunctionError) {
          throw error
        }
        throw new ShopifyFunctionError(
          `Validation function failed: ${(error as Error).message}`,
          'FUNCTION_EXECUTION_ERROR'
        )
      }
    },
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate discount function output
 */
function validateDiscountOutput(output: DiscountFunctionOutput): DiscountFunctionOutput {
  if (!output || typeof output !== 'object') {
    throw new ShopifyFunctionError('Invalid discount output: must be an object', 'INVALID_OUTPUT')
  }

  if (!Array.isArray(output.discounts)) {
    throw new ShopifyFunctionError('Invalid discount output: discounts must be an array', 'INVALID_OUTPUT')
  }

  for (const discount of output.discounts) {
    if (!discount.value) {
      throw new ShopifyFunctionError('Invalid discount: value is required', 'INVALID_DISCOUNT')
    }

    if (!discount.targets || !Array.isArray(discount.targets) || discount.targets.length === 0) {
      throw new ShopifyFunctionError('Invalid discount: at least one target is required', 'INVALID_DISCOUNT')
    }

    // Validate value type
    const hasPercentage = 'percentage' in discount.value
    const hasFixedAmount = 'fixedAmount' in discount.value
    if (!hasPercentage && !hasFixedAmount) {
      throw new ShopifyFunctionError(
        'Invalid discount value: must have percentage or fixedAmount',
        'INVALID_DISCOUNT_VALUE'
      )
    }

    // Validate percentage value
    if (hasPercentage) {
      const percentageValue = (discount.value as PercentageValue).percentage.value
      const numValue = parseFloat(percentageValue)
      if (isNaN(numValue) || numValue < 0 || numValue > 100) {
        throw new ShopifyFunctionError(
          'Invalid percentage value: must be between 0 and 100',
          'INVALID_PERCENTAGE'
        )
      }
    }

    // Validate fixed amount value
    if (hasFixedAmount) {
      const amountValue = (discount.value as FixedAmountValue).fixedAmount.amount
      const numValue = parseFloat(amountValue)
      if (isNaN(numValue) || numValue < 0) {
        throw new ShopifyFunctionError(
          'Invalid fixed amount value: must be a non-negative number',
          'INVALID_AMOUNT'
        )
      }
    }
  }

  return output
}

/**
 * Validate payment customization output
 */
function validatePaymentOutput(output: PaymentCustomizationOutput): PaymentCustomizationOutput {
  if (!output || typeof output !== 'object') {
    throw new ShopifyFunctionError('Invalid payment output: must be an object', 'INVALID_OUTPUT')
  }

  if (!Array.isArray(output.operations)) {
    throw new ShopifyFunctionError('Invalid payment output: operations must be an array', 'INVALID_OUTPUT')
  }

  for (const operation of output.operations) {
    const hasHide = 'hide' in operation
    const hasMove = 'move' in operation
    const hasRename = 'rename' in operation

    const operationCount = [hasHide, hasMove, hasRename].filter(Boolean).length
    if (operationCount !== 1) {
      throw new ShopifyFunctionError(
        'Invalid payment operation: must have exactly one of hide, move, or rename',
        'INVALID_OPERATION'
      )
    }

    if (hasHide && !(operation as HidePaymentOperation).hide.paymentMethodId) {
      throw new ShopifyFunctionError(
        'Invalid hide operation: paymentMethodId is required',
        'INVALID_OPERATION'
      )
    }

    if (hasMove) {
      const moveOp = operation as MovePaymentOperation
      if (!moveOp.move.paymentMethodId) {
        throw new ShopifyFunctionError(
          'Invalid move operation: paymentMethodId is required',
          'INVALID_OPERATION'
        )
      }
      if (typeof moveOp.move.index !== 'number' || moveOp.move.index < 0) {
        throw new ShopifyFunctionError(
          'Invalid move operation: index must be a non-negative number',
          'INVALID_OPERATION'
        )
      }
    }

    if (hasRename) {
      const renameOp = operation as RenamePaymentOperation
      if (!renameOp.rename.paymentMethodId || !renameOp.rename.name) {
        throw new ShopifyFunctionError(
          'Invalid rename operation: paymentMethodId and name are required',
          'INVALID_OPERATION'
        )
      }
    }
  }

  return output
}

/**
 * Validate delivery customization output
 */
function validateDeliveryOutput(output: DeliveryCustomizationOutput): DeliveryCustomizationOutput {
  if (!output || typeof output !== 'object') {
    throw new ShopifyFunctionError('Invalid delivery output: must be an object', 'INVALID_OUTPUT')
  }

  if (!Array.isArray(output.operations)) {
    throw new ShopifyFunctionError('Invalid delivery output: operations must be an array', 'INVALID_OUTPUT')
  }

  for (const operation of output.operations) {
    const hasHide = 'hide' in operation
    const hasMove = 'move' in operation
    const hasRename = 'rename' in operation

    const operationCount = [hasHide, hasMove, hasRename].filter(Boolean).length
    if (operationCount !== 1) {
      throw new ShopifyFunctionError(
        'Invalid delivery operation: must have exactly one of hide, move, or rename',
        'INVALID_OPERATION'
      )
    }

    if (hasHide && !(operation as HideDeliveryOperation).hide.deliveryOptionHandle) {
      throw new ShopifyFunctionError(
        'Invalid hide operation: deliveryOptionHandle is required',
        'INVALID_OPERATION'
      )
    }

    if (hasMove) {
      const moveOp = operation as MoveDeliveryOperation
      if (!moveOp.move.deliveryOptionHandle) {
        throw new ShopifyFunctionError(
          'Invalid move operation: deliveryOptionHandle is required',
          'INVALID_OPERATION'
        )
      }
      if (typeof moveOp.move.index !== 'number' || moveOp.move.index < 0) {
        throw new ShopifyFunctionError(
          'Invalid move operation: index must be a non-negative number',
          'INVALID_OPERATION'
        )
      }
    }

    if (hasRename) {
      const renameOp = operation as RenameDeliveryOperation
      if (!renameOp.rename.deliveryOptionHandle || !renameOp.rename.title) {
        throw new ShopifyFunctionError(
          'Invalid rename operation: deliveryOptionHandle and title are required',
          'INVALID_OPERATION'
        )
      }
    }
  }

  return output
}

/**
 * Validate validation function output
 */
function validateValidationOutput(output: ValidationFunctionOutput): ValidationFunctionOutput {
  if (!output || typeof output !== 'object') {
    throw new ShopifyFunctionError('Invalid validation output: must be an object', 'INVALID_OUTPUT')
  }

  if (!Array.isArray(output.errors)) {
    throw new ShopifyFunctionError('Invalid validation output: errors must be an array', 'INVALID_OUTPUT')
  }

  for (const error of output.errors) {
    if (!error.localizedMessage || typeof error.localizedMessage !== 'string') {
      throw new ShopifyFunctionError(
        'Invalid validation error: localizedMessage is required and must be a string',
        'INVALID_ERROR'
      )
    }

    if (!error.target || typeof error.target !== 'string') {
      throw new ShopifyFunctionError(
        'Invalid validation error: target is required and must be a string',
        'INVALID_ERROR'
      )
    }

    // Validate JSON path format
    if (!error.target.startsWith('$.')) {
      throw new ShopifyFunctionError(
        'Invalid validation error target: must be a valid JSON path starting with $.',
        'INVALID_ERROR_TARGET'
      )
    }
  }

  return output
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Helper to create a percentage discount value
 */
export function percentageDiscount(value: number | string): PercentageValue {
  return {
    percentage: {
      value: String(value),
    },
  }
}

/**
 * Helper to create a fixed amount discount value
 */
export function fixedAmountDiscount(amount: number | string): FixedAmountValue {
  return {
    fixedAmount: {
      amount: String(amount),
    },
  }
}

/**
 * Helper to create an order subtotal target
 */
export function orderSubtotalTarget(excludedVariantIds: string[] = []): OrderSubtotalTarget {
  return {
    orderSubtotal: {
      excludedVariantIds,
    },
  }
}

/**
 * Helper to create a product variant target
 */
export function productVariantTarget(id: string, quantity?: number): ProductVariantTarget {
  return {
    productVariant: {
      id,
      quantity,
    },
  }
}

/**
 * Helper to calculate cart total
 */
export function getCartTotal(cart: FunctionCart): number {
  return parseFloat(cart.cost.totalAmount.amount)
}

/**
 * Helper to calculate cart subtotal
 */
export function getCartSubtotal(cart: FunctionCart): number {
  return parseFloat(cart.cost.subtotalAmount.amount)
}

/**
 * Helper to get total quantity in cart
 */
export function getCartQuantity(cart: FunctionCart): number {
  return cart.lines.reduce((total, line) => total + line.quantity, 0)
}

/**
 * Helper to check if cart has specific product
 */
export function cartHasProduct(cart: FunctionCart, productId: string): boolean {
  return cart.lines.some((line) => line.merchandise.product.id === productId)
}

/**
 * Helper to check if cart has specific variant
 */
export function cartHasVariant(cart: FunctionCart, variantId: string): boolean {
  return cart.lines.some((line) => line.merchandise.id === variantId)
}

/**
 * Helper to check if customer has made a minimum number of orders
 */
export function isReturningCustomer(cart: FunctionCart, minimumOrders: number = 1): boolean {
  return (cart.buyerIdentity?.customer?.numberOfOrders ?? 0) >= minimumOrders
}

/**
 * Helper to check if customer is from a specific country
 */
export function isFromCountry(cart: FunctionCart, countryCode: string): boolean {
  return cart.buyerIdentity?.countryCode === countryCode
}

/**
 * Helper to get product quantity by ID
 */
export function getProductQuantity(cart: FunctionCart, productId: string): number {
  return cart.lines
    .filter((line) => line.merchandise.product.id === productId)
    .reduce((total, line) => total + line.quantity, 0)
}

/**
 * Helper to get variant quantity by ID
 */
export function getVariantQuantity(cart: FunctionCart, variantId: string): number {
  const line = cart.lines.find((l) => l.merchandise.id === variantId)
  return line?.quantity ?? 0
}

/**
 * Type guard for discount function
 */
export function isDiscountFunction(fn: unknown): fn is DiscountFunction {
  return fn !== null && typeof fn === 'object' && (fn as DiscountFunction).type === 'discount'
}

/**
 * Type guard for payment customization
 */
export function isPaymentCustomization(fn: unknown): fn is PaymentCustomization {
  return fn !== null && typeof fn === 'object' && (fn as PaymentCustomization).type === 'payment_customization'
}

/**
 * Type guard for delivery customization
 */
export function isDeliveryCustomization(fn: unknown): fn is DeliveryCustomization {
  return fn !== null && typeof fn === 'object' && (fn as DeliveryCustomization).type === 'delivery_customization'
}

/**
 * Type guard for validation function
 */
export function isValidationFunction(fn: unknown): fn is ValidationFunction {
  return fn !== null && typeof fn === 'object' && (fn as ValidationFunction).type === 'validation'
}
