/**
 * Commerce Primitives - E-commerce functionality
 *
 * Comprehensive commerce engine providing:
 * - Product catalog with variants and categories
 * - Shopping cart with TTL and abandoned cart tracking
 * - Order lifecycle management with state machine
 * - Inventory tracking with reservations
 * - Dynamic pricing with discounts and promotions
 *
 * @module db/primitives/commerce
 */

// =============================================================================
// Catalog - Product management
// =============================================================================

export {
  // Types
  type ProductStatus,
  type OptionType,
  type ProductOption,
  type ProductOptionValue,
  type ProductVariant,
  type Product,
  type Category,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateVariantInput,
  type CreateCategoryInput,
  type ProductSearchOptions,

  // Interface
  type Catalog,

  // Factory
  createCatalog,
} from './catalog'

// =============================================================================
// Cart - Shopping cart management
// =============================================================================

export {
  // Types
  type CartStatus,
  type CartItem,
  type Cart,
  type AddItemInput,
  type CreateCartInput,
  type CartOptions,
  type CartSnapshot,

  // Interface
  type CartManager,

  // Factory
  createCartManager,
} from './cart'

// =============================================================================
// Orders - Order lifecycle management
// =============================================================================

export {
  // Types
  type OrderStatus,
  type PaymentStatus,
  type FulfillmentStatus,
  type Address,
  type OrderLineItem,
  type Payment,
  type Refund,
  type Shipment,
  type Order,
  type CreateOrderInput,
  type OrderSearchOptions,

  // Interface
  type OrderManager,

  // Factory
  createOrderManager,
} from './orders'

// =============================================================================
// Inventory - Stock management
// =============================================================================

export {
  // Types
  type StockMovementType,
  type StockMovement,
  type StockLevel,
  type Reservation,
  type InventoryOptions,
  type LowStockAlert,
  type LocationInventory,

  // Interface
  type InventoryManager,

  // Factory
  createInventoryManager,
} from './inventory'

// =============================================================================
// Pricing - Dynamic pricing engine
// =============================================================================

export {
  // Types
  type PriceRuleType,
  type DiscountType,
  type PriceRule,
  type DiscountCode,
  type BulkDiscount,
  type PriceRequest,
  type PriceResult,
  type AppliedDiscount,
  type CustomerSegment,

  // Interface
  type PricingEngine,

  // Factory
  createPricingEngine,
} from './pricing'

// =============================================================================
// Commerce Engine - Unified interface
// =============================================================================

export interface CommerceEngine {
  catalog: import('./catalog').Catalog
  cart: import('./cart').CartManager
  orders: import('./orders').OrderManager
  inventory: import('./inventory').InventoryManager
  pricing: import('./pricing').PricingEngine
}

export interface CommerceEngineOptions {
  cart?: import('./cart').CartOptions
  inventory?: import('./inventory').InventoryOptions
}

/**
 * Create a complete commerce engine with all subsystems
 */
export function createCommerceEngine(options?: CommerceEngineOptions): CommerceEngine {
  return {
    catalog: createCatalog(),
    cart: createCartManager(options?.cart),
    orders: createOrderManager(),
    inventory: createInventoryManager(options?.inventory),
    pricing: createPricingEngine(),
  }
}
