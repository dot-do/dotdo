/**
 * @dotdo/shopify - Shopify Storefront API Compatibility Layer
 *
 * Drop-in replacement for Shopify Storefront API client with edge compatibility.
 * Implements GraphQL Storefront API patterns for:
 * - Product queries (by handle, collection, search)
 * - Collection queries
 * - Cart management (create, update, add/remove items)
 * - Checkout flow (create, update, complete)
 * - Customer authentication (create, login, logout)
 *
 * @example
 * ```typescript
 * import { createStorefrontClient } from '@dotdo/shopify/storefront'
 *
 * const client = createStorefrontClient({
 *   storeDomain: 'my-store.myshopify.com',
 *   publicAccessToken: 'your-storefront-access-token',
 * })
 *
 * // Product queries
 * const product = await client.product.getByHandle('classic-tee')
 * const products = await client.product.search('organic cotton')
 *
 * // Cart management
 * const cart = await client.cart.create()
 * await client.cart.addLines(cart.id, [{ merchandiseId: 'gid://...', quantity: 1 }])
 *
 * // Customer authentication
 * const { customerAccessToken } = await client.customer.login(email, password)
 * ```
 *
 * @see https://shopify.dev/docs/api/storefront
 * @module @dotdo/shopify/storefront
 */

// =============================================================================
// API Version
// =============================================================================

/**
 * Latest supported Storefront API version
 */
export const STOREFRONT_API_VERSION = '2024-10'

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Storefront client configuration
 */
export interface StorefrontConfig {
  /** Shop domain (e.g., 'my-store.myshopify.com') */
  storeDomain: string
  /** Public Storefront API access token */
  publicAccessToken: string
  /** Private Storefront API access token (for server-side) */
  privateAccessToken?: string
  /** API version (default: STOREFRONT_API_VERSION) */
  apiVersion?: string
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Content language (ISO 639-1) */
  language?: string
  /** Country code (ISO 3166-1 alpha-2) */
  country?: string
}

/**
 * Internal resolved configuration
 */
interface ResolvedStorefrontConfig {
  storeDomain: string
  publicAccessToken: string
  privateAccessToken?: string
  apiVersion: string
  fetch: typeof fetch
  language?: string
  country?: string
}

// =============================================================================
// GraphQL Types
// =============================================================================

/**
 * GraphQL response wrapper
 */
export interface StorefrontResponse<T> {
  data: T | null
  errors?: StorefrontError[]
  extensions?: {
    cost?: {
      requestedQueryCost: number
      actualQueryCost: number
      throttleStatus: {
        maximumAvailable: number
        currentlyAvailable: number
        restoreRate: number
      }
    }
  }
}

/**
 * Storefront API error
 */
export interface StorefrontError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: string[]
  extensions?: {
    code?: string
    documentation?: string
  }
}

/**
 * User error from mutations
 */
export interface UserError {
  field?: string[]
  message: string
  code?: string
}

// =============================================================================
// Money Types
// =============================================================================

/**
 * Money V2 representation
 */
export interface MoneyV2 {
  amount: string
  currencyCode: string
}

/**
 * Currency code enumeration
 */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | 'CNY' | string

// =============================================================================
// Image Types
// =============================================================================

/**
 * Shopify image
 */
export interface Image {
  id?: string
  url: string
  altText?: string | null
  width?: number
  height?: number
}

/**
 * Image connection for pagination
 */
export interface ImageConnection {
  edges: Array<{ node: Image; cursor: string }>
  pageInfo: PageInfo
}

// =============================================================================
// Pagination Types
// =============================================================================

/**
 * Page info for connections
 */
export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor?: string
  endCursor?: string
}

/**
 * Connection arguments
 */
export interface ConnectionArgs {
  first?: number
  after?: string
  last?: number
  before?: string
}

// =============================================================================
// Product Types
// =============================================================================

/**
 * Product from Storefront API
 */
export interface StorefrontProduct {
  id: string
  handle: string
  title: string
  description: string
  descriptionHtml: string
  vendor: string
  productType: string
  tags: string[]
  availableForSale: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string
  onlineStoreUrl?: string
  seo: SEO
  featuredImage?: Image
  images: ImageConnection
  variants: ProductVariantConnection
  options: ProductOption[]
  priceRange: ProductPriceRange
  compareAtPriceRange: ProductPriceRange
  metafields?: Metafield[]
}

/**
 * Product variant
 */
export interface ProductVariant {
  id: string
  title: string
  availableForSale: boolean
  quantityAvailable?: number
  sku?: string
  barcode?: string
  weight?: number
  weightUnit?: string
  price: MoneyV2
  compareAtPrice?: MoneyV2
  selectedOptions: SelectedOption[]
  image?: Image
  product: {
    id: string
    handle: string
    title: string
  }
  metafields?: Metafield[]
}

/**
 * Product variant connection
 */
export interface ProductVariantConnection {
  edges: Array<{ node: ProductVariant; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Product option
 */
export interface ProductOption {
  id: string
  name: string
  values: string[]
}

/**
 * Selected option
 */
export interface SelectedOption {
  name: string
  value: string
}

/**
 * Product price range
 */
export interface ProductPriceRange {
  minVariantPrice: MoneyV2
  maxVariantPrice: MoneyV2
}

/**
 * SEO information
 */
export interface SEO {
  title?: string
  description?: string
}

/**
 * Metafield
 */
export interface Metafield {
  id: string
  namespace: string
  key: string
  value: string
  type: string
  description?: string
}

/**
 * Product connection for pagination
 */
export interface ProductConnection {
  edges: Array<{ node: StorefrontProduct; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Product filter input
 */
export interface ProductFilter {
  available?: boolean
  variantOption?: { name: string; value: string }
  productType?: string
  productVendor?: string
  tag?: string
  price?: { min?: number; max?: number }
}

/**
 * Product sort keys
 */
export type ProductSortKeys =
  | 'TITLE'
  | 'PRODUCT_TYPE'
  | 'VENDOR'
  | 'UPDATED_AT'
  | 'CREATED_AT'
  | 'BEST_SELLING'
  | 'PRICE'
  | 'ID'
  | 'RELEVANCE'

// =============================================================================
// Collection Types
// =============================================================================

/**
 * Collection from Storefront API
 */
export interface StorefrontCollection {
  id: string
  handle: string
  title: string
  description: string
  descriptionHtml: string
  updatedAt: string
  image?: Image
  seo: SEO
  products: ProductConnection
  metafields?: Metafield[]
}

/**
 * Collection connection for pagination
 */
export interface CollectionConnection {
  edges: Array<{ node: StorefrontCollection; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Collection sort keys
 */
export type CollectionSortKeys = 'TITLE' | 'UPDATED_AT' | 'ID' | 'RELEVANCE'

// =============================================================================
// Cart Types
// =============================================================================

/**
 * Cart from Storefront API
 */
export interface Cart {
  id: string
  createdAt: string
  updatedAt: string
  checkoutUrl: string
  totalQuantity: number
  note?: string
  buyerIdentity: CartBuyerIdentity
  lines: CartLineConnection
  cost: CartCost
  attributes: CartAttribute[]
  discountCodes: CartDiscountCode[]
  discountAllocations: CartDiscountAllocation[]
}

/**
 * Cart buyer identity
 */
export interface CartBuyerIdentity {
  email?: string
  phone?: string
  countryCode?: string
  customer?: {
    id: string
    email?: string
    firstName?: string
    lastName?: string
  }
  deliveryAddressPreferences?: CartDeliveryAddressPreference[]
}

/**
 * Cart buyer identity input
 */
export interface CartBuyerIdentityInput {
  email?: string
  phone?: string
  countryCode?: string
  customerAccessToken?: string
  deliveryAddressPreferences?: CartDeliveryAddressPreferenceInput[]
}

/**
 * Cart delivery address preference
 */
export interface CartDeliveryAddressPreference {
  deliveryAddress?: MailingAddress
}

/**
 * Cart delivery address preference input
 */
export interface CartDeliveryAddressPreferenceInput {
  deliveryAddress?: MailingAddressInput
}

/**
 * Cart line item
 */
export interface CartLine {
  id: string
  quantity: number
  merchandise: ProductVariant
  attributes: CartAttribute[]
  cost: CartLineCost
  discountAllocations: CartDiscountAllocation[]
  sellingPlanAllocation?: {
    sellingPlan: { id: string; name: string }
    priceAdjustments: Array<{
      price: MoneyV2
      compareAtPrice?: MoneyV2
    }>
  }
}

/**
 * Cart line connection
 */
export interface CartLineConnection {
  edges: Array<{ node: CartLine; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Cart line input for adding items
 */
export interface CartLineInput {
  merchandiseId: string
  quantity?: number
  attributes?: CartAttributeInput[]
  sellingPlanId?: string
}

/**
 * Cart line update input
 */
export interface CartLineUpdateInput {
  id: string
  merchandiseId?: string
  quantity?: number
  attributes?: CartAttributeInput[]
  sellingPlanId?: string
}

/**
 * Cart attribute
 */
export interface CartAttribute {
  key: string
  value?: string
}

/**
 * Cart attribute input
 */
export interface CartAttributeInput {
  key: string
  value: string
}

/**
 * Cart cost
 */
export interface CartCost {
  totalAmount: MoneyV2
  subtotalAmount: MoneyV2
  totalTaxAmount?: MoneyV2
  totalDutyAmount?: MoneyV2
  checkoutChargeAmount: MoneyV2
}

/**
 * Cart line cost
 */
export interface CartLineCost {
  totalAmount: MoneyV2
  subtotalAmount: MoneyV2
  amountPerQuantity: MoneyV2
  compareAtAmountPerQuantity?: MoneyV2
}

/**
 * Cart discount code
 */
export interface CartDiscountCode {
  code: string
  applicable: boolean
}

/**
 * Cart discount allocation
 */
export interface CartDiscountAllocation {
  discountedAmount: MoneyV2
  discountApplication: CartDiscountApplication
}

/**
 * Cart discount application
 */
export interface CartDiscountApplication {
  targetSelection: 'ALL' | 'ENTITLED' | 'EXPLICIT'
  targetType: 'LINE_ITEM' | 'SHIPPING_LINE'
  value: CartDiscountValue
}

/**
 * Cart discount value
 */
export type CartDiscountValue =
  | { percentage: number }
  | { amount: MoneyV2 }

/**
 * Cart input for creation
 */
export interface CartInput {
  lines?: CartLineInput[]
  attributes?: CartAttributeInput[]
  note?: string
  buyerIdentity?: CartBuyerIdentityInput
  discountCodes?: string[]
}

/**
 * Cart create payload
 */
export interface CartCreatePayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart lines add payload
 */
export interface CartLinesAddPayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart lines update payload
 */
export interface CartLinesUpdatePayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart lines remove payload
 */
export interface CartLinesRemovePayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart discount codes update payload
 */
export interface CartDiscountCodesUpdatePayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart buyer identity update payload
 */
export interface CartBuyerIdentityUpdatePayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart attributes update payload
 */
export interface CartAttributesUpdatePayload {
  cart?: Cart
  userErrors: UserError[]
}

/**
 * Cart note update payload
 */
export interface CartNoteUpdatePayload {
  cart?: Cart
  userErrors: UserError[]
}

// =============================================================================
// Checkout Types (Legacy/Headless)
// =============================================================================

/**
 * Checkout from Storefront API
 */
export interface Checkout {
  id: string
  webUrl: string
  completedAt?: string
  createdAt: string
  updatedAt: string
  email?: string
  note?: string
  ready: boolean
  requiresShipping: boolean
  taxesIncluded: boolean
  taxExempt: boolean
  currencyCode: string
  lineItems: CheckoutLineItemConnection
  lineItemsSubtotalPrice: MoneyV2
  subtotalPrice: MoneyV2
  totalPrice: MoneyV2
  totalTax: MoneyV2
  totalDuties?: MoneyV2
  shippingAddress?: MailingAddress
  shippingLine?: ShippingRate
  availableShippingRates?: AvailableShippingRates
  discountApplications: DiscountApplicationConnection
  appliedGiftCards: AppliedGiftCard[]
  order?: {
    id: string
    name: string
    statusUrl: string
  }
  orderStatusUrl?: string
  customAttributes: CartAttribute[]
  buyerIdentity: CheckoutBuyerIdentity
}

/**
 * Checkout buyer identity
 */
export interface CheckoutBuyerIdentity {
  countryCode?: string
}

/**
 * Checkout line item
 */
export interface CheckoutLineItem {
  id: string
  title: string
  quantity: number
  variant?: ProductVariant
  customAttributes: CartAttribute[]
  discountAllocations: CheckoutDiscountAllocation[]
  unitPrice?: MoneyV2
}

/**
 * Checkout line item connection
 */
export interface CheckoutLineItemConnection {
  edges: Array<{ node: CheckoutLineItem; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Checkout line item input
 */
export interface CheckoutLineItemInput {
  variantId: string
  quantity: number
  customAttributes?: CartAttributeInput[]
}

/**
 * Checkout line item update input
 */
export interface CheckoutLineItemUpdateInput {
  id?: string
  variantId?: string
  quantity?: number
  customAttributes?: CartAttributeInput[]
}

/**
 * Checkout discount allocation
 */
export interface CheckoutDiscountAllocation {
  allocatedAmount: MoneyV2
  discountApplication: DiscountApplication
}

/**
 * Discount application
 */
export interface DiscountApplication {
  allocationMethod: 'ACROSS' | 'EACH' | 'ONE'
  targetSelection: 'ALL' | 'ENTITLED' | 'EXPLICIT'
  targetType: 'LINE_ITEM' | 'SHIPPING_LINE'
  value: DiscountValue
}

/**
 * Discount application connection
 */
export interface DiscountApplicationConnection {
  edges: Array<{ node: DiscountApplication; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Discount value
 */
export type DiscountValue =
  | { percentage: number }
  | { amount: MoneyV2 }

/**
 * Applied gift card
 */
export interface AppliedGiftCard {
  id: string
  amountUsed: MoneyV2
  balance: MoneyV2
  lastCharacters: string
}

/**
 * Mailing address
 */
export interface MailingAddress {
  id?: string
  address1?: string
  address2?: string
  city?: string
  company?: string
  country?: string
  countryCode?: string
  firstName?: string
  lastName?: string
  name?: string
  phone?: string
  province?: string
  provinceCode?: string
  zip?: string
  formatted?: string[]
  formattedArea?: string
  latitude?: number
  longitude?: number
}

/**
 * Mailing address input
 */
export interface MailingAddressInput {
  address1?: string
  address2?: string
  city?: string
  company?: string
  country?: string
  firstName?: string
  lastName?: string
  phone?: string
  province?: string
  zip?: string
}

/**
 * Shipping rate
 */
export interface ShippingRate {
  handle: string
  title: string
  price: MoneyV2
}

/**
 * Available shipping rates
 */
export interface AvailableShippingRates {
  ready: boolean
  shippingRates?: ShippingRate[]
}

/**
 * Checkout create input
 */
export interface CheckoutCreateInput {
  email?: string
  lineItems?: CheckoutLineItemInput[]
  shippingAddress?: MailingAddressInput
  note?: string
  customAttributes?: CartAttributeInput[]
  allowPartialAddresses?: boolean
  buyerIdentity?: CheckoutBuyerIdentityInput
}

/**
 * Checkout buyer identity input
 */
export interface CheckoutBuyerIdentityInput {
  countryCode?: string
}

/**
 * Checkout create payload
 */
export interface CheckoutCreatePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout user error
 */
export interface CheckoutUserError extends UserError {
  code?: CheckoutErrorCode
}

/**
 * Checkout error codes
 */
export type CheckoutErrorCode =
  | 'BLANK'
  | 'INVALID'
  | 'TOO_LONG'
  | 'PRESENT'
  | 'LESS_THAN'
  | 'GREATER_THAN_OR_EQUAL_TO'
  | 'LESS_THAN_OR_EQUAL_TO'
  | 'ALREADY_COMPLETED'
  | 'LOCKED'
  | 'NOT_SUPPORTED'
  | 'BAD_DOMAIN'
  | 'INVALID_FOR_COUNTRY'
  | 'INVALID_FOR_COUNTRY_AND_PROVINCE'
  | 'INVALID_STATE_IN_COUNTRY'
  | 'INVALID_PROVINCE_IN_COUNTRY'
  | 'INVALID_REGION_IN_COUNTRY'
  | 'SHIPPING_RATE_EXPIRED'
  | 'GIFT_CARD_UNUSABLE'
  | 'GIFT_CARD_DISABLED'
  | 'GIFT_CARD_CODE_INVALID'
  | 'GIFT_CARD_ALREADY_APPLIED'
  | 'GIFT_CARD_CURRENCY_MISMATCH'
  | 'GIFT_CARD_EXPIRED'
  | 'GIFT_CARD_DEPLETED'
  | 'GIFT_CARD_NOT_FOUND'
  | 'CART_DOES_NOT_MEET_DISCOUNT_REQUIREMENTS_NOTICE'
  | 'DISCOUNT_ALREADY_APPLIED'
  | 'DISCOUNT_DISABLED'
  | 'DISCOUNT_EXPIRED'
  | 'DISCOUNT_LIMIT_REACHED'
  | 'DISCOUNT_NOT_FOUND'
  | 'CUSTOMER_ALREADY_USED_ONCE_PER_CUSTOMER_DISCOUNT_NOTICE'
  | 'EMPTY'
  | 'NOT_ENOUGH_IN_STOCK'
  | 'MISSING_PAYMENT_INPUT'
  | 'TOTAL_PRICE_MISMATCH'
  | 'LINE_ITEM_NOT_FOUND'
  | 'UNABLE_TO_APPLY'
  | 'DISCOUNT_CODE_APPLICATION_FAILED'

/**
 * Checkout line items add payload
 */
export interface CheckoutLineItemsAddPayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout line items update payload
 */
export interface CheckoutLineItemsUpdatePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout line items remove payload
 */
export interface CheckoutLineItemsRemovePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout shipping address update payload
 */
export interface CheckoutShippingAddressUpdatePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout shipping line update payload
 */
export interface CheckoutShippingLineUpdatePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout email update payload
 */
export interface CheckoutEmailUpdatePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout discount code apply payload
 */
export interface CheckoutDiscountCodeApplyPayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout discount code remove payload
 */
export interface CheckoutDiscountCodeRemovePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout gift card apply payload
 */
export interface CheckoutGiftCardApplyPayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout gift card remove payload
 */
export interface CheckoutGiftCardRemovePayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
}

/**
 * Checkout complete with credit card payload
 */
export interface CheckoutCompleteWithCreditCardPayload {
  checkout?: Checkout
  checkoutUserErrors: CheckoutUserError[]
  payment?: Payment
}

/**
 * Payment
 */
export interface Payment {
  id: string
  amountV2: MoneyV2
  checkout: Checkout
  creditCard?: CreditCard
  errorMessage?: string
  idempotencyKey?: string
  ready: boolean
  test: boolean
  transaction?: Transaction
}

/**
 * Credit card
 */
export interface CreditCard {
  brand?: string
  expiryMonth?: number
  expiryYear?: number
  firstDigits?: string
  lastDigits?: string
  maskedNumber?: string
}

/**
 * Transaction
 */
export interface Transaction {
  amount: MoneyV2
  kind: 'SALE' | 'CAPTURE' | 'AUTHORIZATION' | 'CHANGE' | 'EMV_AUTHORIZATION'
  status: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'ERROR'
  statusV2?: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'ERROR'
  test: boolean
}

/**
 * Credit card vault
 */
export interface CreditCardPaymentInputV2 {
  paymentAmount: MoneyV2
  idempotencyKey: string
  billingAddress: MailingAddressInput
  vaultId: string
  test?: boolean
}

/**
 * Tokenized payment input
 */
export interface TokenizedPaymentInputV3 {
  paymentAmount: MoneyV2
  idempotencyKey: string
  billingAddress: MailingAddressInput
  paymentData: string
  type: 'APPLE_PAY' | 'GOOGLE_PAY' | 'SHOPIFY_PAY' | 'FACEBOOK_PAY' | 'AMAZON_PAY'
  test?: boolean
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Customer from Storefront API
 */
export interface Customer {
  id: string
  email?: string
  firstName?: string
  lastName?: string
  displayName: string
  phone?: string
  acceptsMarketing: boolean
  createdAt: string
  updatedAt: string
  defaultAddress?: MailingAddress
  addresses: MailingAddressConnection
  orders: OrderConnection
  tags: string[]
  metafields?: Metafield[]
}

/**
 * Mailing address connection
 */
export interface MailingAddressConnection {
  edges: Array<{ node: MailingAddress; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Order connection
 */
export interface OrderConnection {
  edges: Array<{ node: Order; cursor: string }>
  pageInfo: PageInfo
  totalCount: number
}

/**
 * Order from Storefront API
 */
export interface Order {
  id: string
  name: string
  orderNumber: number
  processedAt: string
  financialStatus?: string
  fulfillmentStatus: string
  statusUrl: string
  currencyCode: string
  currentTotalPrice: MoneyV2
  currentSubtotalPrice: MoneyV2
  currentTotalTax: MoneyV2
  totalPrice: MoneyV2
  subtotalPrice?: MoneyV2
  totalTax?: MoneyV2
  totalShippingPrice: MoneyV2
  totalRefunded: MoneyV2
  lineItems: OrderLineItemConnection
  shippingAddress?: MailingAddress
  cancelReason?: string
  canceledAt?: string
  edited: boolean
}

/**
 * Order line item
 */
export interface OrderLineItem {
  title: string
  quantity: number
  variant?: ProductVariant
  currentQuantity: number
  originalTotalPrice: MoneyV2
  discountedTotalPrice: MoneyV2
  customAttributes: CartAttribute[]
}

/**
 * Order line item connection
 */
export interface OrderLineItemConnection {
  edges: Array<{ node: OrderLineItem; cursor: string }>
  pageInfo: PageInfo
}

/**
 * Customer access token
 */
export interface CustomerAccessToken {
  accessToken: string
  expiresAt: string
}

/**
 * Customer access token create payload
 */
export interface CustomerAccessTokenCreatePayload {
  customerAccessToken?: CustomerAccessToken
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer user error
 */
export interface CustomerUserError extends UserError {
  code?: CustomerErrorCode
}

/**
 * Customer error codes
 */
export type CustomerErrorCode =
  | 'BLANK'
  | 'INVALID'
  | 'TAKEN'
  | 'TOO_LONG'
  | 'TOO_SHORT'
  | 'UNIDENTIFIED_CUSTOMER'
  | 'CUSTOMER_DISABLED'
  | 'PASSWORD_STARTS_OR_ENDS_WITH_WHITESPACE'
  | 'CONTAINS_HTML_TAGS'
  | 'CONTAINS_URL'
  | 'TOKEN_INVALID'
  | 'ALREADY_ENABLED'
  | 'NOT_FOUND'
  | 'BAD_DOMAIN'
  | 'INVALID_MULTIPASS_REQUEST'

/**
 * Customer create input
 */
export interface CustomerCreateInput {
  email: string
  password: string
  firstName?: string
  lastName?: string
  phone?: string
  acceptsMarketing?: boolean
}

/**
 * Customer create payload
 */
export interface CustomerCreatePayload {
  customer?: Customer
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer update input
 */
export interface CustomerUpdateInput {
  email?: string
  password?: string
  firstName?: string
  lastName?: string
  phone?: string
  acceptsMarketing?: boolean
}

/**
 * Customer update payload
 */
export interface CustomerUpdatePayload {
  customer?: Customer
  customerAccessToken?: CustomerAccessToken
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer access token delete payload
 */
export interface CustomerAccessTokenDeletePayload {
  deletedAccessToken?: string
  deletedCustomerAccessTokenId?: string
  userErrors: UserError[]
}

/**
 * Customer access token renew payload
 */
export interface CustomerAccessTokenRenewPayload {
  customerAccessToken?: CustomerAccessToken
  userErrors: UserError[]
}

/**
 * Customer recover payload
 */
export interface CustomerRecoverPayload {
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer reset payload
 */
export interface CustomerResetPayload {
  customer?: Customer
  customerAccessToken?: CustomerAccessToken
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer reset input
 */
export interface CustomerResetInput {
  password: string
  resetToken: string
}

/**
 * Customer address create payload
 */
export interface CustomerAddressCreatePayload {
  customerAddress?: MailingAddress
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer address update payload
 */
export interface CustomerAddressUpdatePayload {
  customerAddress?: MailingAddress
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer address delete payload
 */
export interface CustomerAddressDeletePayload {
  deletedCustomerAddressId?: string
  customerUserErrors: CustomerUserError[]
}

/**
 * Customer default address update payload
 */
export interface CustomerDefaultAddressUpdatePayload {
  customer?: Customer
  customerUserErrors: CustomerUserError[]
}

// =============================================================================
// GraphQL Fragments
// =============================================================================

const MONEY_V2_FRAGMENT = `
  fragment MoneyV2Fields on MoneyV2 {
    amount
    currencyCode
  }
`

const IMAGE_FRAGMENT = `
  fragment ImageFields on Image {
    id
    url
    altText
    width
    height
  }
`

const PAGE_INFO_FRAGMENT = `
  fragment PageInfoFields on PageInfo {
    hasNextPage
    hasPreviousPage
    startCursor
    endCursor
  }
`

const PRODUCT_VARIANT_FRAGMENT = `
  fragment ProductVariantFields on ProductVariant {
    id
    title
    availableForSale
    quantityAvailable
    sku
    barcode
    weight
    weightUnit
    price {
      ...MoneyV2Fields
    }
    compareAtPrice {
      ...MoneyV2Fields
    }
    selectedOptions {
      name
      value
    }
    image {
      ...ImageFields
    }
    product {
      id
      handle
      title
    }
  }
  ${MONEY_V2_FRAGMENT}
  ${IMAGE_FRAGMENT}
`

const PRODUCT_FRAGMENT = `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    vendor
    productType
    tags
    availableForSale
    createdAt
    updatedAt
    publishedAt
    onlineStoreUrl
    seo {
      title
      description
    }
    featuredImage {
      ...ImageFields
    }
    priceRange {
      minVariantPrice {
        ...MoneyV2Fields
      }
      maxVariantPrice {
        ...MoneyV2Fields
      }
    }
    compareAtPriceRange {
      minVariantPrice {
        ...MoneyV2Fields
      }
      maxVariantPrice {
        ...MoneyV2Fields
      }
    }
    options {
      id
      name
      values
    }
  }
  ${MONEY_V2_FRAGMENT}
  ${IMAGE_FRAGMENT}
`

const MAILING_ADDRESS_FRAGMENT = `
  fragment MailingAddressFields on MailingAddress {
    id
    address1
    address2
    city
    company
    country
    countryCode: countryCodeV2
    firstName
    lastName
    name
    phone
    province
    provinceCode
    zip
    formatted
    formattedArea
    latitude
    longitude
  }
`

const CART_LINE_FRAGMENT = `
  fragment CartLineFields on CartLine {
    id
    quantity
    merchandise {
      ... on ProductVariant {
        ...ProductVariantFields
      }
    }
    attributes {
      key
      value
    }
    cost {
      totalAmount {
        ...MoneyV2Fields
      }
      subtotalAmount {
        ...MoneyV2Fields
      }
      amountPerQuantity {
        ...MoneyV2Fields
      }
      compareAtAmountPerQuantity {
        ...MoneyV2Fields
      }
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
  ${MONEY_V2_FRAGMENT}
`

const CART_FRAGMENT = `
  fragment CartFields on Cart {
    id
    createdAt
    updatedAt
    checkoutUrl
    totalQuantity
    note
    buyerIdentity {
      email
      phone
      countryCode
      customer {
        id
        email
        firstName
        lastName
      }
    }
    lines(first: 250) {
      edges {
        node {
          ...CartLineFields
        }
        cursor
      }
      pageInfo {
        ...PageInfoFields
      }
    }
    cost {
      totalAmount {
        ...MoneyV2Fields
      }
      subtotalAmount {
        ...MoneyV2Fields
      }
      totalTaxAmount {
        ...MoneyV2Fields
      }
      totalDutyAmount {
        ...MoneyV2Fields
      }
      checkoutChargeAmount {
        ...MoneyV2Fields
      }
    }
    attributes {
      key
      value
    }
    discountCodes {
      code
      applicable
    }
  }
  ${CART_LINE_FRAGMENT}
  ${PAGE_INFO_FRAGMENT}
  ${MONEY_V2_FRAGMENT}
`

const CHECKOUT_LINE_ITEM_FRAGMENT = `
  fragment CheckoutLineItemFields on CheckoutLineItem {
    id
    title
    quantity
    variant {
      ...ProductVariantFields
    }
    customAttributes {
      key
      value
    }
    unitPrice {
      ...MoneyV2Fields
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
  ${MONEY_V2_FRAGMENT}
`

const CHECKOUT_FRAGMENT = `
  fragment CheckoutFields on Checkout {
    id
    webUrl
    completedAt
    createdAt
    updatedAt
    email
    note
    ready
    requiresShipping
    taxesIncluded
    taxExempt
    currencyCode
    lineItemsSubtotalPrice {
      ...MoneyV2Fields
    }
    subtotalPrice: subtotalPriceV2 {
      ...MoneyV2Fields
    }
    totalPrice: totalPriceV2 {
      ...MoneyV2Fields
    }
    totalTax: totalTaxV2 {
      ...MoneyV2Fields
    }
    totalDuties {
      ...MoneyV2Fields
    }
    shippingAddress {
      ...MailingAddressFields
    }
    shippingLine {
      handle
      title
      price: priceV2 {
        ...MoneyV2Fields
      }
    }
    availableShippingRates {
      ready
      shippingRates {
        handle
        title
        price: priceV2 {
          ...MoneyV2Fields
        }
      }
    }
    appliedGiftCards {
      id
      amountUsed: amountUsedV2 {
        ...MoneyV2Fields
      }
      balance: balanceV2 {
        ...MoneyV2Fields
      }
      lastCharacters
    }
    order {
      id
      name
      statusUrl
    }
    orderStatusUrl
    customAttributes {
      key
      value
    }
    buyerIdentity {
      countryCode
    }
    lineItems(first: 250) {
      edges {
        node {
          ...CheckoutLineItemFields
        }
        cursor
      }
      pageInfo {
        ...PageInfoFields
      }
    }
  }
  ${CHECKOUT_LINE_ITEM_FRAGMENT}
  ${MAILING_ADDRESS_FRAGMENT}
  ${PAGE_INFO_FRAGMENT}
  ${MONEY_V2_FRAGMENT}
`

const CUSTOMER_FRAGMENT = `
  fragment CustomerFields on Customer {
    id
    email
    firstName
    lastName
    displayName
    phone
    acceptsMarketing
    createdAt
    updatedAt
    tags
    defaultAddress {
      ...MailingAddressFields
    }
  }
  ${MAILING_ADDRESS_FRAGMENT}
`

// =============================================================================
// Storefront API Error Class
// =============================================================================

/**
 * Storefront API Error
 */
export class StorefrontAPIError extends Error {
  errors: StorefrontError[]
  response?: Response

  constructor(message: string, errors: StorefrontError[] = [], response?: Response) {
    super(message)
    this.name = 'StorefrontAPIError'
    this.errors = errors
    this.response = response
  }
}

// =============================================================================
// GraphQL Client
// =============================================================================

/**
 * Base GraphQL client for Storefront API
 */
class StorefrontGraphQLClient {
  private config: ResolvedStorefrontConfig

  constructor(config: ResolvedStorefrontConfig) {
    this.config = config
  }

  /**
   * Execute a GraphQL query or mutation
   */
  async query<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<StorefrontResponse<T>> {
    const url = `https://${this.config.storeDomain}/api/${this.config.apiVersion}/graphql.json`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }

    // Use private token if available, otherwise public
    if (this.config.privateAccessToken) {
      headers['Shopify-Storefront-Private-Token'] = this.config.privateAccessToken
    } else {
      headers['X-Shopify-Storefront-Access-Token'] = this.config.publicAccessToken
    }

    // Add buyer IP header for proper localization
    if (this.config.language) {
      headers['Accept-Language'] = this.config.language
    }

    const body = JSON.stringify({
      query,
      variables,
    })

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers,
      body,
    })

    const result = await response.json() as StorefrontResponse<T>

    if (result.errors && result.errors.length > 0) {
      throw new StorefrontAPIError(
        result.errors[0].message,
        result.errors,
        response
      )
    }

    return result
  }
}

// =============================================================================
// Product Resource
// =============================================================================

/**
 * Product resource for Storefront API
 */
class ProductResource {
  private client: StorefrontGraphQLClient

  constructor(client: StorefrontGraphQLClient) {
    this.client = client
  }

  /**
   * Get a product by handle
   */
  async getByHandle(handle: string, options?: {
    imageCount?: number
    variantCount?: number
    metafieldIdentifiers?: Array<{ namespace: string; key: string }>
  }): Promise<StorefrontProduct | null> {
    const imageCount = options?.imageCount ?? 10
    const variantCount = options?.variantCount ?? 100

    const query = `
      query getProductByHandle($handle: String!, $imageCount: Int!, $variantCount: Int!) {
        product(handle: $handle) {
          ...ProductFields
          images(first: $imageCount) {
            edges {
              node {
                ...ImageFields
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
          variants(first: $variantCount) {
            edges {
              node {
                ...ProductVariantFields
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ product: StorefrontProduct | null }>(query, {
      handle,
      imageCount,
      variantCount,
    })

    return result.data?.product ?? null
  }

  /**
   * Get a product by ID
   */
  async getById(id: string, options?: {
    imageCount?: number
    variantCount?: number
  }): Promise<StorefrontProduct | null> {
    const imageCount = options?.imageCount ?? 10
    const variantCount = options?.variantCount ?? 100

    const query = `
      query getProductById($id: ID!, $imageCount: Int!, $variantCount: Int!) {
        product(id: $id) {
          ...ProductFields
          images(first: $imageCount) {
            edges {
              node {
                ...ImageFields
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
          variants(first: $variantCount) {
            edges {
              node {
                ...ProductVariantFields
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ product: StorefrontProduct | null }>(query, {
      id,
      imageCount,
      variantCount,
    })

    return result.data?.product ?? null
  }

  /**
   * List products with pagination
   */
  async list(options?: ConnectionArgs & {
    sortKey?: ProductSortKeys
    reverse?: boolean
    query?: string
  }): Promise<ProductConnection> {
    const query = `
      query getProducts($first: Int, $after: String, $last: Int, $before: String, $sortKey: ProductSortKeys, $reverse: Boolean, $query: String) {
        products(first: $first, after: $after, last: $last, before: $before, sortKey: $sortKey, reverse: $reverse, query: $query) {
          edges {
            node {
              ...ProductFields
              images(first: 1) {
                edges {
                  node {
                    ...ImageFields
                  }
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    ...ProductVariantFields
                  }
                }
                pageInfo {
                  ...PageInfoFields
                }
              }
            }
            cursor
          }
          pageInfo {
            ...PageInfoFields
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ products: ProductConnection }>(query, {
      first: options?.first ?? 20,
      after: options?.after,
      last: options?.last,
      before: options?.before,
      sortKey: options?.sortKey,
      reverse: options?.reverse,
      query: options?.query,
    })

    return result.data?.products ?? { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } }
  }

  /**
   * Search products
   */
  async search(searchQuery: string, options?: ConnectionArgs & {
    productFilters?: ProductFilter[]
    sortKey?: ProductSortKeys
    reverse?: boolean
  }): Promise<{ products: ProductConnection; totalCount: number }> {
    const query = `
      query searchProducts($query: String!, $first: Int, $after: String, $sortKey: ProductSortKeys, $reverse: Boolean, $productFilters: [ProductFilter!]) {
        search(query: $query, first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, productFilters: $productFilters, types: PRODUCT) {
          totalCount
          edges {
            node {
              ... on Product {
                ...ProductFields
                images(first: 1) {
                  edges {
                    node {
                      ...ImageFields
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      ...ProductVariantFields
                    }
                  }
                }
              }
            }
            cursor
          }
          pageInfo {
            ...PageInfoFields
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{
      search: {
        totalCount: number
        edges: Array<{ node: StorefrontProduct; cursor: string }>
        pageInfo: PageInfo
      }
    }>(query, {
      query: searchQuery,
      first: options?.first ?? 20,
      after: options?.after,
      sortKey: options?.sortKey,
      reverse: options?.reverse,
      productFilters: options?.productFilters,
    })

    const searchResult = result.data?.search

    return {
      products: {
        edges: searchResult?.edges ?? [],
        pageInfo: searchResult?.pageInfo ?? { hasNextPage: false, hasPreviousPage: false },
      },
      totalCount: searchResult?.totalCount ?? 0,
    }
  }

  /**
   * Get product recommendations
   */
  async getRecommendations(productId: string, options?: {
    intent?: 'RELATED' | 'COMPLEMENTARY'
  }): Promise<StorefrontProduct[]> {
    const query = `
      query getProductRecommendations($productId: ID!, $intent: ProductRecommendationIntent) {
        productRecommendations(productId: $productId, intent: $intent) {
          ...ProductFields
          images(first: 1) {
            edges {
              node {
                ...ImageFields
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                ...ProductVariantFields
              }
            }
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
    `

    const result = await this.client.query<{ productRecommendations: StorefrontProduct[] | null }>(query, {
      productId,
      intent: options?.intent,
    })

    return result.data?.productRecommendations ?? []
  }

  /**
   * Get variant by ID
   */
  async getVariant(id: string): Promise<ProductVariant | null> {
    const query = `
      query getVariant($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            ...ProductVariantFields
          }
        }
      }
      ${PRODUCT_VARIANT_FRAGMENT}
    `

    const result = await this.client.query<{ node: ProductVariant | null }>(query, { id })
    return result.data?.node ?? null
  }
}

// =============================================================================
// Collection Resource
// =============================================================================

/**
 * Collection resource for Storefront API
 */
class CollectionResource {
  private client: StorefrontGraphQLClient

  constructor(client: StorefrontGraphQLClient) {
    this.client = client
  }

  /**
   * Get a collection by handle
   */
  async getByHandle(handle: string, options?: {
    productCount?: number
    productSortKey?: ProductSortKeys
    productReverse?: boolean
    productFilters?: ProductFilter[]
  }): Promise<StorefrontCollection | null> {
    const productCount = options?.productCount ?? 20

    const query = `
      query getCollectionByHandle($handle: String!, $productCount: Int!, $productSortKey: ProductCollectionSortKeys, $productReverse: Boolean, $productFilters: [ProductFilter!]) {
        collection(handle: $handle) {
          id
          handle
          title
          description
          descriptionHtml
          updatedAt
          image {
            ...ImageFields
          }
          seo {
            title
            description
          }
          products(first: $productCount, sortKey: $productSortKey, reverse: $productReverse, filters: $productFilters) {
            edges {
              node {
                ...ProductFields
                images(first: 1) {
                  edges {
                    node {
                      ...ImageFields
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      ...ProductVariantFields
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${IMAGE_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ collection: StorefrontCollection | null }>(query, {
      handle,
      productCount,
      productSortKey: options?.productSortKey,
      productReverse: options?.productReverse,
      productFilters: options?.productFilters,
    })

    return result.data?.collection ?? null
  }

  /**
   * Get a collection by ID
   */
  async getById(id: string, options?: {
    productCount?: number
    productSortKey?: ProductSortKeys
    productReverse?: boolean
  }): Promise<StorefrontCollection | null> {
    const productCount = options?.productCount ?? 20

    const query = `
      query getCollectionById($id: ID!, $productCount: Int!, $productSortKey: ProductCollectionSortKeys, $productReverse: Boolean) {
        collection(id: $id) {
          id
          handle
          title
          description
          descriptionHtml
          updatedAt
          image {
            ...ImageFields
          }
          seo {
            title
            description
          }
          products(first: $productCount, sortKey: $productSortKey, reverse: $productReverse) {
            edges {
              node {
                ...ProductFields
                images(first: 1) {
                  edges {
                    node {
                      ...ImageFields
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      ...ProductVariantFields
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${IMAGE_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ collection: StorefrontCollection | null }>(query, {
      id,
      productCount,
      productSortKey: options?.productSortKey,
      productReverse: options?.productReverse,
    })

    return result.data?.collection ?? null
  }

  /**
   * List collections with pagination
   */
  async list(options?: ConnectionArgs & {
    sortKey?: CollectionSortKeys
    reverse?: boolean
    query?: string
  }): Promise<CollectionConnection> {
    const query = `
      query getCollections($first: Int, $after: String, $last: Int, $before: String, $sortKey: CollectionSortKeys, $reverse: Boolean, $query: String) {
        collections(first: $first, after: $after, last: $last, before: $before, sortKey: $sortKey, reverse: $reverse, query: $query) {
          edges {
            node {
              id
              handle
              title
              description
              descriptionHtml
              updatedAt
              image {
                ...ImageFields
              }
              seo {
                title
                description
              }
              products(first: 0) {
                edges {
                  node {
                    id
                  }
                }
                pageInfo {
                  ...PageInfoFields
                }
              }
            }
            cursor
          }
          pageInfo {
            ...PageInfoFields
          }
        }
      }
      ${IMAGE_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ collections: CollectionConnection }>(query, {
      first: options?.first ?? 20,
      after: options?.after,
      last: options?.last,
      before: options?.before,
      sortKey: options?.sortKey,
      reverse: options?.reverse,
      query: options?.query,
    })

    return result.data?.collections ?? { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } }
  }

  /**
   * Get products in a collection with pagination
   */
  async getProducts(
    collectionHandle: string,
    options?: ConnectionArgs & {
      sortKey?: ProductSortKeys
      reverse?: boolean
      filters?: ProductFilter[]
    }
  ): Promise<ProductConnection> {
    const query = `
      query getCollectionProducts($handle: String!, $first: Int, $after: String, $last: Int, $before: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]) {
        collection(handle: $handle) {
          products(first: $first, after: $after, last: $last, before: $before, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
            edges {
              node {
                ...ProductFields
                images(first: 1) {
                  edges {
                    node {
                      ...ImageFields
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      ...ProductVariantFields
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
        }
      }
      ${PRODUCT_FRAGMENT}
      ${PRODUCT_VARIANT_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ collection: { products: ProductConnection } | null }>(query, {
      handle: collectionHandle,
      first: options?.first ?? 20,
      after: options?.after,
      last: options?.last,
      before: options?.before,
      sortKey: options?.sortKey,
      reverse: options?.reverse,
      filters: options?.filters,
    })

    return result.data?.collection?.products ?? { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } }
  }
}

// =============================================================================
// Cart Resource
// =============================================================================

/**
 * Cart resource for Storefront API
 */
class CartResource {
  private client: StorefrontGraphQLClient

  constructor(client: StorefrontGraphQLClient) {
    this.client = client
  }

  /**
   * Create a new cart
   */
  async create(input?: CartInput): Promise<CartCreatePayload> {
    const mutation = `
      mutation createCart($input: CartInput) {
        cartCreate(input: $input) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartCreate: CartCreatePayload }>(mutation, {
      input: input ?? {},
    })

    return result.data?.cartCreate ?? { userErrors: [] }
  }

  /**
   * Get a cart by ID
   */
  async get(cartId: string): Promise<Cart | null> {
    const query = `
      query getCart($cartId: ID!) {
        cart(id: $cartId) {
          ...CartFields
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cart: Cart | null }>(query, { cartId })
    return result.data?.cart ?? null
  }

  /**
   * Add lines to a cart
   */
  async addLines(cartId: string, lines: CartLineInput[]): Promise<CartLinesAddPayload> {
    const mutation = `
      mutation addCartLines($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartLinesAdd: CartLinesAddPayload }>(mutation, {
      cartId,
      lines,
    })

    return result.data?.cartLinesAdd ?? { userErrors: [] }
  }

  /**
   * Update lines in a cart
   */
  async updateLines(cartId: string, lines: CartLineUpdateInput[]): Promise<CartLinesUpdatePayload> {
    const mutation = `
      mutation updateCartLines($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartLinesUpdate: CartLinesUpdatePayload }>(mutation, {
      cartId,
      lines,
    })

    return result.data?.cartLinesUpdate ?? { userErrors: [] }
  }

  /**
   * Remove lines from a cart
   */
  async removeLines(cartId: string, lineIds: string[]): Promise<CartLinesRemovePayload> {
    const mutation = `
      mutation removeCartLines($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartLinesRemove: CartLinesRemovePayload }>(mutation, {
      cartId,
      lineIds,
    })

    return result.data?.cartLinesRemove ?? { userErrors: [] }
  }

  /**
   * Update discount codes on a cart
   */
  async updateDiscountCodes(cartId: string, discountCodes: string[]): Promise<CartDiscountCodesUpdatePayload> {
    const mutation = `
      mutation updateCartDiscountCodes($cartId: ID!, $discountCodes: [String!]) {
        cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartDiscountCodesUpdate: CartDiscountCodesUpdatePayload }>(mutation, {
      cartId,
      discountCodes,
    })

    return result.data?.cartDiscountCodesUpdate ?? { userErrors: [] }
  }

  /**
   * Update buyer identity on a cart
   */
  async updateBuyerIdentity(cartId: string, buyerIdentity: CartBuyerIdentityInput): Promise<CartBuyerIdentityUpdatePayload> {
    const mutation = `
      mutation updateCartBuyerIdentity($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
        cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartBuyerIdentityUpdate: CartBuyerIdentityUpdatePayload }>(mutation, {
      cartId,
      buyerIdentity,
    })

    return result.data?.cartBuyerIdentityUpdate ?? { userErrors: [] }
  }

  /**
   * Update cart attributes
   */
  async updateAttributes(cartId: string, attributes: CartAttributeInput[]): Promise<CartAttributesUpdatePayload> {
    const mutation = `
      mutation updateCartAttributes($cartId: ID!, $attributes: [AttributeInput!]!) {
        cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartAttributesUpdate: CartAttributesUpdatePayload }>(mutation, {
      cartId,
      attributes,
    })

    return result.data?.cartAttributesUpdate ?? { userErrors: [] }
  }

  /**
   * Update cart note
   */
  async updateNote(cartId: string, note: string): Promise<CartNoteUpdatePayload> {
    const mutation = `
      mutation updateCartNote($cartId: ID!, $note: String) {
        cartNoteUpdate(cartId: $cartId, note: $note) {
          cart {
            ...CartFields
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      ${CART_FRAGMENT}
    `

    const result = await this.client.query<{ cartNoteUpdate: CartNoteUpdatePayload }>(mutation, {
      cartId,
      note,
    })

    return result.data?.cartNoteUpdate ?? { userErrors: [] }
  }
}

// =============================================================================
// Checkout Resource
// =============================================================================

/**
 * Checkout resource for Storefront API (legacy/headless checkout)
 */
class CheckoutResource {
  private client: StorefrontGraphQLClient

  constructor(client: StorefrontGraphQLClient) {
    this.client = client
  }

  /**
   * Create a new checkout
   */
  async create(input: CheckoutCreateInput): Promise<CheckoutCreatePayload> {
    const mutation = `
      mutation createCheckout($input: CheckoutCreateInput!) {
        checkoutCreate(input: $input) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutCreate: CheckoutCreatePayload }>(mutation, {
      input,
    })

    return result.data?.checkoutCreate ?? { checkoutUserErrors: [] }
  }

  /**
   * Get a checkout by ID
   */
  async get(checkoutId: string): Promise<Checkout | null> {
    const query = `
      query getCheckout($checkoutId: ID!) {
        node(id: $checkoutId) {
          ... on Checkout {
            ...CheckoutFields
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ node: Checkout | null }>(query, { checkoutId })
    return result.data?.node ?? null
  }

  /**
   * Add line items to a checkout
   */
  async addLineItems(checkoutId: string, lineItems: CheckoutLineItemInput[]): Promise<CheckoutLineItemsAddPayload> {
    const mutation = `
      mutation addCheckoutLineItems($checkoutId: ID!, $lineItems: [CheckoutLineItemInput!]!) {
        checkoutLineItemsAdd(checkoutId: $checkoutId, lineItems: $lineItems) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutLineItemsAdd: CheckoutLineItemsAddPayload }>(mutation, {
      checkoutId,
      lineItems,
    })

    return result.data?.checkoutLineItemsAdd ?? { checkoutUserErrors: [] }
  }

  /**
   * Update line items in a checkout
   */
  async updateLineItems(checkoutId: string, lineItems: CheckoutLineItemUpdateInput[]): Promise<CheckoutLineItemsUpdatePayload> {
    const mutation = `
      mutation updateCheckoutLineItems($checkoutId: ID!, $lineItems: [CheckoutLineItemUpdateInput!]!) {
        checkoutLineItemsUpdate(checkoutId: $checkoutId, lineItems: $lineItems) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutLineItemsUpdate: CheckoutLineItemsUpdatePayload }>(mutation, {
      checkoutId,
      lineItems,
    })

    return result.data?.checkoutLineItemsUpdate ?? { checkoutUserErrors: [] }
  }

  /**
   * Remove line items from a checkout
   */
  async removeLineItems(checkoutId: string, lineItemIds: string[]): Promise<CheckoutLineItemsRemovePayload> {
    const mutation = `
      mutation removeCheckoutLineItems($checkoutId: ID!, $lineItemIds: [ID!]!) {
        checkoutLineItemsRemove(checkoutId: $checkoutId, lineItemIds: $lineItemIds) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutLineItemsRemove: CheckoutLineItemsRemovePayload }>(mutation, {
      checkoutId,
      lineItemIds,
    })

    return result.data?.checkoutLineItemsRemove ?? { checkoutUserErrors: [] }
  }

  /**
   * Update shipping address on a checkout
   */
  async updateShippingAddress(checkoutId: string, shippingAddress: MailingAddressInput): Promise<CheckoutShippingAddressUpdatePayload> {
    const mutation = `
      mutation updateCheckoutShippingAddress($checkoutId: ID!, $shippingAddress: MailingAddressInput!) {
        checkoutShippingAddressUpdateV2(checkoutId: $checkoutId, shippingAddress: $shippingAddress) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutShippingAddressUpdateV2: CheckoutShippingAddressUpdatePayload }>(mutation, {
      checkoutId,
      shippingAddress,
    })

    return result.data?.checkoutShippingAddressUpdateV2 ?? { checkoutUserErrors: [] }
  }

  /**
   * Update shipping line on a checkout
   */
  async updateShippingLine(checkoutId: string, shippingRateHandle: string): Promise<CheckoutShippingLineUpdatePayload> {
    const mutation = `
      mutation updateCheckoutShippingLine($checkoutId: ID!, $shippingRateHandle: String!) {
        checkoutShippingLineUpdate(checkoutId: $checkoutId, shippingRateHandle: $shippingRateHandle) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutShippingLineUpdate: CheckoutShippingLineUpdatePayload }>(mutation, {
      checkoutId,
      shippingRateHandle,
    })

    return result.data?.checkoutShippingLineUpdate ?? { checkoutUserErrors: [] }
  }

  /**
   * Update email on a checkout
   */
  async updateEmail(checkoutId: string, email: string): Promise<CheckoutEmailUpdatePayload> {
    const mutation = `
      mutation updateCheckoutEmail($checkoutId: ID!, $email: String!) {
        checkoutEmailUpdateV2(checkoutId: $checkoutId, email: $email) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutEmailUpdateV2: CheckoutEmailUpdatePayload }>(mutation, {
      checkoutId,
      email,
    })

    return result.data?.checkoutEmailUpdateV2 ?? { checkoutUserErrors: [] }
  }

  /**
   * Apply discount code to a checkout
   */
  async applyDiscountCode(checkoutId: string, discountCode: string): Promise<CheckoutDiscountCodeApplyPayload> {
    const mutation = `
      mutation applyCheckoutDiscountCode($checkoutId: ID!, $discountCode: String!) {
        checkoutDiscountCodeApplyV2(checkoutId: $checkoutId, discountCode: $discountCode) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutDiscountCodeApplyV2: CheckoutDiscountCodeApplyPayload }>(mutation, {
      checkoutId,
      discountCode,
    })

    return result.data?.checkoutDiscountCodeApplyV2 ?? { checkoutUserErrors: [] }
  }

  /**
   * Remove discount code from a checkout
   */
  async removeDiscountCode(checkoutId: string): Promise<CheckoutDiscountCodeRemovePayload> {
    const mutation = `
      mutation removeCheckoutDiscountCode($checkoutId: ID!) {
        checkoutDiscountCodeRemove(checkoutId: $checkoutId) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutDiscountCodeRemove: CheckoutDiscountCodeRemovePayload }>(mutation, {
      checkoutId,
    })

    return result.data?.checkoutDiscountCodeRemove ?? { checkoutUserErrors: [] }
  }

  /**
   * Apply gift card to a checkout
   */
  async applyGiftCard(checkoutId: string, giftCardCode: string): Promise<CheckoutGiftCardApplyPayload> {
    const mutation = `
      mutation applyCheckoutGiftCard($checkoutId: ID!, $giftCardCode: String!) {
        checkoutGiftCardsAppend(checkoutId: $checkoutId, giftCardCodes: [$giftCardCode]) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutGiftCardsAppend: CheckoutGiftCardApplyPayload }>(mutation, {
      checkoutId,
      giftCardCode,
    })

    return result.data?.checkoutGiftCardsAppend ?? { checkoutUserErrors: [] }
  }

  /**
   * Remove gift card from a checkout
   */
  async removeGiftCard(checkoutId: string, appliedGiftCardId: string): Promise<CheckoutGiftCardRemovePayload> {
    const mutation = `
      mutation removeCheckoutGiftCard($checkoutId: ID!, $appliedGiftCardId: ID!) {
        checkoutGiftCardRemoveV2(checkoutId: $checkoutId, appliedGiftCardId: $appliedGiftCardId) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutGiftCardRemoveV2: CheckoutGiftCardRemovePayload }>(mutation, {
      checkoutId,
      appliedGiftCardId,
    })

    return result.data?.checkoutGiftCardRemoveV2 ?? { checkoutUserErrors: [] }
  }

  /**
   * Complete checkout with credit card
   */
  async completeWithCreditCard(
    checkoutId: string,
    payment: CreditCardPaymentInputV2
  ): Promise<CheckoutCompleteWithCreditCardPayload> {
    const mutation = `
      mutation completeCheckoutWithCreditCard($checkoutId: ID!, $payment: CreditCardPaymentInputV2!) {
        checkoutCompleteWithCreditCardV2(checkoutId: $checkoutId, payment: $payment) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
          payment {
            id
            amountV2 {
              ...MoneyV2Fields
            }
            creditCard {
              brand
              expiryMonth
              expiryYear
              firstDigits
              lastDigits
              maskedNumber
            }
            errorMessage
            idempotencyKey
            ready
            test
            transaction {
              amount {
                ...MoneyV2Fields
              }
              kind
              status
              statusV2
              test
            }
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
      ${MONEY_V2_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutCompleteWithCreditCardV2: CheckoutCompleteWithCreditCardPayload }>(mutation, {
      checkoutId,
      payment,
    })

    return result.data?.checkoutCompleteWithCreditCardV2 ?? { checkoutUserErrors: [] }
  }

  /**
   * Complete checkout with tokenized payment (Apple Pay, Google Pay, etc.)
   */
  async completeWithTokenizedPayment(
    checkoutId: string,
    payment: TokenizedPaymentInputV3
  ): Promise<CheckoutCompleteWithCreditCardPayload> {
    const mutation = `
      mutation completeCheckoutWithTokenizedPayment($checkoutId: ID!, $payment: TokenizedPaymentInputV3!) {
        checkoutCompleteWithTokenizedPaymentV3(checkoutId: $checkoutId, payment: $payment) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
          payment {
            id
            amountV2 {
              ...MoneyV2Fields
            }
            errorMessage
            idempotencyKey
            ready
            test
            transaction {
              amount {
                ...MoneyV2Fields
              }
              kind
              status
              statusV2
              test
            }
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
      ${MONEY_V2_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutCompleteWithTokenizedPaymentV3: CheckoutCompleteWithCreditCardPayload }>(mutation, {
      checkoutId,
      payment,
    })

    return result.data?.checkoutCompleteWithTokenizedPaymentV3 ?? { checkoutUserErrors: [] }
  }

  /**
   * Complete free checkout
   */
  async completeFree(checkoutId: string): Promise<CheckoutCreatePayload> {
    const mutation = `
      mutation completeCheckoutFree($checkoutId: ID!) {
        checkoutCompleteFree(checkoutId: $checkoutId) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutCompleteFree: CheckoutCreatePayload }>(mutation, {
      checkoutId,
    })

    return result.data?.checkoutCompleteFree ?? { checkoutUserErrors: [] }
  }

  /**
   * Associate customer with checkout
   */
  async associateCustomer(checkoutId: string, customerAccessToken: string): Promise<CheckoutCreatePayload> {
    const mutation = `
      mutation associateCustomerWithCheckout($checkoutId: ID!, $customerAccessToken: String!) {
        checkoutCustomerAssociateV2(checkoutId: $checkoutId, customerAccessToken: $customerAccessToken) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutCustomerAssociateV2: CheckoutCreatePayload }>(mutation, {
      checkoutId,
      customerAccessToken,
    })

    return result.data?.checkoutCustomerAssociateV2 ?? { checkoutUserErrors: [] }
  }

  /**
   * Disassociate customer from checkout
   */
  async disassociateCustomer(checkoutId: string): Promise<CheckoutCreatePayload> {
    const mutation = `
      mutation disassociateCustomerFromCheckout($checkoutId: ID!) {
        checkoutCustomerDisassociateV2(checkoutId: $checkoutId) {
          checkout {
            ...CheckoutFields
          }
          checkoutUserErrors {
            field
            message
            code
          }
        }
      }
      ${CHECKOUT_FRAGMENT}
    `

    const result = await this.client.query<{ checkoutCustomerDisassociateV2: CheckoutCreatePayload }>(mutation, {
      checkoutId,
    })

    return result.data?.checkoutCustomerDisassociateV2 ?? { checkoutUserErrors: [] }
  }
}

// =============================================================================
// Customer Resource
// =============================================================================

/**
 * Customer resource for Storefront API
 */
class CustomerResource {
  private client: StorefrontGraphQLClient

  constructor(client: StorefrontGraphQLClient) {
    this.client = client
  }

  /**
   * Create a new customer account
   */
  async create(input: CustomerCreateInput): Promise<CustomerCreatePayload> {
    const mutation = `
      mutation createCustomer($input: CustomerCreateInput!) {
        customerCreate(input: $input) {
          customer {
            ...CustomerFields
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerCreate: CustomerCreatePayload }>(mutation, {
      input,
    })

    return result.data?.customerCreate ?? { customerUserErrors: [] }
  }

  /**
   * Login customer and get access token
   */
  async login(email: string, password: string): Promise<CustomerAccessTokenCreatePayload> {
    const mutation = `
      mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
        customerAccessTokenCreate(input: $input) {
          customerAccessToken {
            accessToken
            expiresAt
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
    `

    const result = await this.client.query<{ customerAccessTokenCreate: CustomerAccessTokenCreatePayload }>(mutation, {
      input: { email, password },
    })

    return result.data?.customerAccessTokenCreate ?? { customerUserErrors: [] }
  }

  /**
   * Logout customer (delete access token)
   */
  async logout(customerAccessToken: string): Promise<CustomerAccessTokenDeletePayload> {
    const mutation = `
      mutation customerAccessTokenDelete($customerAccessToken: String!) {
        customerAccessTokenDelete(customerAccessToken: $customerAccessToken) {
          deletedAccessToken
          deletedCustomerAccessTokenId
          userErrors {
            field
            message
          }
        }
      }
    `

    const result = await this.client.query<{ customerAccessTokenDelete: CustomerAccessTokenDeletePayload }>(mutation, {
      customerAccessToken,
    })

    return result.data?.customerAccessTokenDelete ?? { userErrors: [] }
  }

  /**
   * Renew customer access token
   */
  async renewAccessToken(customerAccessToken: string): Promise<CustomerAccessTokenRenewPayload> {
    const mutation = `
      mutation customerAccessTokenRenew($customerAccessToken: String!) {
        customerAccessTokenRenew(customerAccessToken: $customerAccessToken) {
          customerAccessToken {
            accessToken
            expiresAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const result = await this.client.query<{ customerAccessTokenRenew: CustomerAccessTokenRenewPayload }>(mutation, {
      customerAccessToken,
    })

    return result.data?.customerAccessTokenRenew ?? { userErrors: [] }
  }

  /**
   * Get customer by access token
   */
  async get(customerAccessToken: string, options?: {
    addressCount?: number
    orderCount?: number
  }): Promise<Customer | null> {
    const addressCount = options?.addressCount ?? 10
    const orderCount = options?.orderCount ?? 10

    const query = `
      query getCustomer($customerAccessToken: String!, $addressCount: Int!, $orderCount: Int!) {
        customer(customerAccessToken: $customerAccessToken) {
          ...CustomerFields
          addresses(first: $addressCount) {
            edges {
              node {
                ...MailingAddressFields
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
          }
          orders(first: $orderCount) {
            edges {
              node {
                id
                name
                orderNumber
                processedAt
                financialStatus
                fulfillmentStatus
                statusUrl
                currencyCode
                currentTotalPrice {
                  ...MoneyV2Fields
                }
                currentSubtotalPrice {
                  ...MoneyV2Fields
                }
                currentTotalTax {
                  ...MoneyV2Fields
                }
                totalPrice: totalPriceV2 {
                  ...MoneyV2Fields
                }
                subtotalPrice: subtotalPriceV2 {
                  ...MoneyV2Fields
                }
                totalShippingPrice: totalShippingPriceV2 {
                  ...MoneyV2Fields
                }
                totalRefunded: totalRefundedV2 {
                  ...MoneyV2Fields
                }
                shippingAddress {
                  ...MailingAddressFields
                }
                cancelReason
                canceledAt
                edited
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
            totalCount
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
      ${MAILING_ADDRESS_FRAGMENT}
      ${MONEY_V2_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ customer: Customer | null }>(query, {
      customerAccessToken,
      addressCount,
      orderCount,
    })

    return result.data?.customer ?? null
  }

  /**
   * Update customer
   */
  async update(customerAccessToken: string, customer: CustomerUpdateInput): Promise<CustomerUpdatePayload> {
    const mutation = `
      mutation customerUpdate($customerAccessToken: String!, $customer: CustomerUpdateInput!) {
        customerUpdate(customerAccessToken: $customerAccessToken, customer: $customer) {
          customer {
            ...CustomerFields
          }
          customerAccessToken {
            accessToken
            expiresAt
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerUpdate: CustomerUpdatePayload }>(mutation, {
      customerAccessToken,
      customer,
    })

    return result.data?.customerUpdate ?? { customerUserErrors: [] }
  }

  /**
   * Request password recovery email
   */
  async recover(email: string): Promise<CustomerRecoverPayload> {
    const mutation = `
      mutation customerRecover($email: String!) {
        customerRecover(email: $email) {
          customerUserErrors {
            field
            message
            code
          }
        }
      }
    `

    const result = await this.client.query<{ customerRecover: CustomerRecoverPayload }>(mutation, {
      email,
    })

    return result.data?.customerRecover ?? { customerUserErrors: [] }
  }

  /**
   * Reset customer password with token
   */
  async reset(id: string, input: CustomerResetInput): Promise<CustomerResetPayload> {
    const mutation = `
      mutation customerReset($id: ID!, $input: CustomerResetInput!) {
        customerReset(id: $id, input: $input) {
          customer {
            ...CustomerFields
          }
          customerAccessToken {
            accessToken
            expiresAt
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerReset: CustomerResetPayload }>(mutation, {
      id,
      input,
    })

    return result.data?.customerReset ?? { customerUserErrors: [] }
  }

  /**
   * Reset customer password by URL token
   */
  async resetByUrl(resetUrl: string, password: string): Promise<CustomerResetPayload> {
    const mutation = `
      mutation customerResetByUrl($resetUrl: URL!, $password: String!) {
        customerResetByUrl(resetUrl: $resetUrl, password: $password) {
          customer {
            ...CustomerFields
          }
          customerAccessToken {
            accessToken
            expiresAt
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerResetByUrl: CustomerResetPayload }>(mutation, {
      resetUrl,
      password,
    })

    return result.data?.customerResetByUrl ?? { customerUserErrors: [] }
  }

  /**
   * Activate customer account
   */
  async activate(id: string, input: { activationToken: string; password: string }): Promise<CustomerResetPayload> {
    const mutation = `
      mutation customerActivate($id: ID!, $input: CustomerActivateInput!) {
        customerActivate(id: $id, input: $input) {
          customer {
            ...CustomerFields
          }
          customerAccessToken {
            accessToken
            expiresAt
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerActivate: CustomerResetPayload }>(mutation, {
      id,
      input,
    })

    return result.data?.customerActivate ?? { customerUserErrors: [] }
  }

  /**
   * Activate customer by URL
   */
  async activateByUrl(activationUrl: string, password: string): Promise<CustomerResetPayload> {
    const mutation = `
      mutation customerActivateByUrl($activationUrl: URL!, $password: String!) {
        customerActivateByUrl(activationUrl: $activationUrl, password: $password) {
          customer {
            ...CustomerFields
          }
          customerAccessToken {
            accessToken
            expiresAt
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerActivateByUrl: CustomerResetPayload }>(mutation, {
      activationUrl,
      password,
    })

    return result.data?.customerActivateByUrl ?? { customerUserErrors: [] }
  }

  /**
   * Create customer address
   */
  async createAddress(customerAccessToken: string, address: MailingAddressInput): Promise<CustomerAddressCreatePayload> {
    const mutation = `
      mutation customerAddressCreate($customerAccessToken: String!, $address: MailingAddressInput!) {
        customerAddressCreate(customerAccessToken: $customerAccessToken, address: $address) {
          customerAddress {
            ...MailingAddressFields
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${MAILING_ADDRESS_FRAGMENT}
    `

    const result = await this.client.query<{ customerAddressCreate: CustomerAddressCreatePayload }>(mutation, {
      customerAccessToken,
      address,
    })

    return result.data?.customerAddressCreate ?? { customerUserErrors: [] }
  }

  /**
   * Update customer address
   */
  async updateAddress(customerAccessToken: string, id: string, address: MailingAddressInput): Promise<CustomerAddressUpdatePayload> {
    const mutation = `
      mutation customerAddressUpdate($customerAccessToken: String!, $id: ID!, $address: MailingAddressInput!) {
        customerAddressUpdate(customerAccessToken: $customerAccessToken, id: $id, address: $address) {
          customerAddress {
            ...MailingAddressFields
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${MAILING_ADDRESS_FRAGMENT}
    `

    const result = await this.client.query<{ customerAddressUpdate: CustomerAddressUpdatePayload }>(mutation, {
      customerAccessToken,
      id,
      address,
    })

    return result.data?.customerAddressUpdate ?? { customerUserErrors: [] }
  }

  /**
   * Delete customer address
   */
  async deleteAddress(customerAccessToken: string, id: string): Promise<CustomerAddressDeletePayload> {
    const mutation = `
      mutation customerAddressDelete($customerAccessToken: String!, $id: ID!) {
        customerAddressDelete(customerAccessToken: $customerAccessToken, id: $id) {
          deletedCustomerAddressId
          customerUserErrors {
            field
            message
            code
          }
        }
      }
    `

    const result = await this.client.query<{ customerAddressDelete: CustomerAddressDeletePayload }>(mutation, {
      customerAccessToken,
      id,
    })

    return result.data?.customerAddressDelete ?? { customerUserErrors: [] }
  }

  /**
   * Set default address
   */
  async setDefaultAddress(customerAccessToken: string, addressId: string): Promise<CustomerDefaultAddressUpdatePayload> {
    const mutation = `
      mutation customerDefaultAddressUpdate($customerAccessToken: String!, $addressId: ID!) {
        customerDefaultAddressUpdate(customerAccessToken: $customerAccessToken, addressId: $addressId) {
          customer {
            ...CustomerFields
          }
          customerUserErrors {
            field
            message
            code
          }
        }
      }
      ${CUSTOMER_FRAGMENT}
    `

    const result = await this.client.query<{ customerDefaultAddressUpdate: CustomerDefaultAddressUpdatePayload }>(mutation, {
      customerAccessToken,
      addressId,
    })

    return result.data?.customerDefaultAddressUpdate ?? { customerUserErrors: [] }
  }

  /**
   * Get customer orders with pagination
   */
  async getOrders(customerAccessToken: string, options?: ConnectionArgs & {
    sortKey?: 'PROCESSED_AT' | 'TOTAL_PRICE' | 'ID'
    reverse?: boolean
  }): Promise<OrderConnection> {
    const query = `
      query getCustomerOrders($customerAccessToken: String!, $first: Int, $after: String, $last: Int, $before: String, $sortKey: OrderSortKeys, $reverse: Boolean) {
        customer(customerAccessToken: $customerAccessToken) {
          orders(first: $first, after: $after, last: $last, before: $before, sortKey: $sortKey, reverse: $reverse) {
            edges {
              node {
                id
                name
                orderNumber
                processedAt
                financialStatus
                fulfillmentStatus
                statusUrl
                currencyCode
                currentTotalPrice {
                  ...MoneyV2Fields
                }
                currentSubtotalPrice {
                  ...MoneyV2Fields
                }
                currentTotalTax {
                  ...MoneyV2Fields
                }
                totalPrice: totalPriceV2 {
                  ...MoneyV2Fields
                }
                subtotalPrice: subtotalPriceV2 {
                  ...MoneyV2Fields
                }
                totalShippingPrice: totalShippingPriceV2 {
                  ...MoneyV2Fields
                }
                totalRefunded: totalRefundedV2 {
                  ...MoneyV2Fields
                }
                shippingAddress {
                  ...MailingAddressFields
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      title
                      quantity
                      currentQuantity
                      originalTotalPrice {
                        ...MoneyV2Fields
                      }
                      discountedTotalPrice {
                        ...MoneyV2Fields
                      }
                      customAttributes {
                        key
                        value
                      }
                    }
                  }
                  pageInfo {
                    ...PageInfoFields
                  }
                }
                cancelReason
                canceledAt
                edited
              }
              cursor
            }
            pageInfo {
              ...PageInfoFields
            }
            totalCount
          }
        }
      }
      ${MAILING_ADDRESS_FRAGMENT}
      ${MONEY_V2_FRAGMENT}
      ${PAGE_INFO_FRAGMENT}
    `

    const result = await this.client.query<{ customer: { orders: OrderConnection } | null }>(query, {
      customerAccessToken,
      first: options?.first ?? 10,
      after: options?.after,
      last: options?.last,
      before: options?.before,
      sortKey: options?.sortKey,
      reverse: options?.reverse,
    })

    return result.data?.customer?.orders ?? { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false }, totalCount: 0 }
  }
}

// =============================================================================
// Shop Resource
// =============================================================================

/**
 * Shop resource for Storefront API
 */
class ShopResource {
  private client: StorefrontGraphQLClient

  constructor(client: StorefrontGraphQLClient) {
    this.client = client
  }

  /**
   * Get shop info
   */
  async get(): Promise<{
    name: string
    description?: string
    primaryDomain: { host: string; url: string }
    paymentSettings: {
      acceptedCardBrands: string[]
      cardVaultUrl: string
      countryCode: string
      currencyCode: string
      enabledPresentmentCurrencies: string[]
      shopifyPaymentsAccountId?: string
      supportedDigitalWallets: string[]
    }
    shipsToCountries: string[]
    moneyFormat: string
    brand?: {
      logo?: Image
      colors?: {
        primary?: Array<{ background: string; foreground: string }>
        secondary?: Array<{ background: string; foreground: string }>
      }
    }
  } | null> {
    const query = `
      query getShop {
        shop {
          name
          description
          primaryDomain {
            host
            url
          }
          paymentSettings {
            acceptedCardBrands
            cardVaultUrl
            countryCode
            currencyCode
            enabledPresentmentCurrencies
            shopifyPaymentsAccountId
            supportedDigitalWallets
          }
          shipsToCountries
          moneyFormat
          brand {
            logo {
              ...ImageFields
            }
            colors {
              primary {
                background
                foreground
              }
              secondary {
                background
                foreground
              }
            }
          }
        }
      }
      ${IMAGE_FRAGMENT}
    `

    const result = await this.client.query<{ shop: unknown }>(query)
    return result.data?.shop as Awaited<ReturnType<ShopResource['get']>>
  }

  /**
   * Get shop policies
   */
  async getPolicies(): Promise<{
    privacyPolicy?: { body: string; handle: string; title: string; url: string }
    refundPolicy?: { body: string; handle: string; title: string; url: string }
    shippingPolicy?: { body: string; handle: string; title: string; url: string }
    termsOfService?: { body: string; handle: string; title: string; url: string }
    subscriptionPolicy?: { body: string; handle: string; title: string; url: string }
  }> {
    const query = `
      query getShopPolicies {
        shop {
          privacyPolicy {
            body
            handle
            title
            url
          }
          refundPolicy {
            body
            handle
            title
            url
          }
          shippingPolicy {
            body
            handle
            title
            url
          }
          termsOfService {
            body
            handle
            title
            url
          }
          subscriptionPolicy {
            body
            handle
            title
            url
          }
        }
      }
    `

    const result = await this.client.query<{ shop: Awaited<ReturnType<ShopResource['getPolicies']>> }>(query)
    return result.data?.shop ?? {}
  }
}

// =============================================================================
// Storefront Client
// =============================================================================

/**
 * Storefront API client
 */
export interface StorefrontClient {
  /** Product resource */
  product: ProductResource
  /** Collection resource */
  collection: CollectionResource
  /** Cart resource */
  cart: CartResource
  /** Checkout resource (legacy) */
  checkout: CheckoutResource
  /** Customer resource */
  customer: CustomerResource
  /** Shop resource */
  shop: ShopResource
  /** Execute raw GraphQL query */
  query: <T>(query: string, variables?: Record<string, unknown>) => Promise<StorefrontResponse<T>>
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Storefront API client
 *
 * @example
 * ```typescript
 * const client = createStorefrontClient({
 *   storeDomain: 'my-store.myshopify.com',
 *   publicAccessToken: 'your-storefront-access-token',
 * })
 *
 * // Get product by handle
 * const product = await client.product.getByHandle('classic-tee')
 *
 * // Search products
 * const { products, totalCount } = await client.product.search('organic')
 *
 * // Create cart
 * const { cart } = await client.cart.create()
 *
 * // Add to cart
 * await client.cart.addLines(cart.id, [
 *   { merchandiseId: 'gid://shopify/ProductVariant/123', quantity: 1 }
 * ])
 *
 * // Customer login
 * const { customerAccessToken } = await client.customer.login('email@example.com', 'password')
 * ```
 */
export function createStorefrontClient(config: StorefrontConfig): StorefrontClient {
  // Validate required config
  if (!config.storeDomain) {
    throw new Error('Store domain is required')
  }
  if (!config.publicAccessToken && !config.privateAccessToken) {
    throw new Error('Either publicAccessToken or privateAccessToken is required')
  }

  // Normalize store domain
  let storeDomain = config.storeDomain
  if (storeDomain.startsWith('https://')) {
    storeDomain = storeDomain.slice(8)
  }
  if (storeDomain.startsWith('http://')) {
    storeDomain = storeDomain.slice(7)
  }
  if (storeDomain.endsWith('/')) {
    storeDomain = storeDomain.slice(0, -1)
  }

  // Resolve config
  const resolvedConfig: ResolvedStorefrontConfig = {
    storeDomain,
    publicAccessToken: config.publicAccessToken,
    privateAccessToken: config.privateAccessToken,
    apiVersion: config.apiVersion ?? STOREFRONT_API_VERSION,
    fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
    language: config.language,
    country: config.country,
  }

  // Create GraphQL client
  const graphqlClient = new StorefrontGraphQLClient(resolvedConfig)

  return {
    product: new ProductResource(graphqlClient),
    collection: new CollectionResource(graphqlClient),
    cart: new CartResource(graphqlClient),
    checkout: new CheckoutResource(graphqlClient),
    customer: new CustomerResource(graphqlClient),
    shop: new ShopResource(graphqlClient),
    query: <T>(query: string, variables?: Record<string, unknown>) => graphqlClient.query<T>(query, variables),
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default createStorefrontClient
