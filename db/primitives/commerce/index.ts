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
  type ProductOption,
  type ProductVariant,
  type Product,
  type Category,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateVariantInput,
  type CreateCategoryInput,
  type ProductQuery,
  type QueryOptions,

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
// Cart Engine - Cart with session handling
// =============================================================================

export {
  // Types
  type Session,
  type CartEngineOptions,
  type AddToCartInput,
  type CartWithReservations,
  type MergeResult,
  type LoginResult,

  // Class
  CartEngine,

  // Factory
  createCartEngine,
} from './cart-engine'

// =============================================================================
// Orders - Order lifecycle management
// =============================================================================

export {
  // Types
  type OrderStatus,
  type FulfillmentStatus,
  type Address,
  type OrderLineItem,
  type PaymentInfo,
  type Refund,
  type Shipment,
  type Order,
  type CreateOrderInput,
  type OrderQuery,

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
  type MovementType,
  type StockMovement,
  type InventoryLevel,
  type Reservation,
  type InventoryOptions,
  type LowStockAlert,
  type InventoryLocation,
  type LocationType,
  type FulfillmentStrategy,
  type WarehouseAllocation,
  type FulfillmentPlan,
  type AggregatedStock,
  type TransferStatus,
  type TransferRequest,
  type CreateTransferRequestInput,
  type FulfillmentOptions,

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
  type DiscountType,
  type PriceRule,
  type DiscountCode,
  type BulkDiscount,
  type PricingContext,
  type CustomerSegment,

  // Interface
  type PricingEngine,

  // Factory
  createPricingEngine,
} from './pricing'

// =============================================================================
// Revenue Recognition - ASC 606 compliant revenue recognition
// =============================================================================

export {
  // Types
  type RecognitionMethod,
  type ObligationStatus,
  type ContractStatus,
  type PerformanceObligation,
  type Milestone,
  type Contract,
  type ContractModification,
  type DeferredRevenueEntry,
  type RecognitionSchedule,
  type RecognitionScheduleEntry,
  type RecognitionPeriod,
  type PeriodRecognitionSummary,
  type CreateContractInput,
  type CreateObligationInput,
  type UpdateObligationProgressInput,
  type RecognitionQuery,
  type AllocationResult,

  // Accounting Export Types
  type RevenueAccountCodes,
  type JournalEntryLine,
  type AccountingJournalEntry,
  type AccountingExportOptions,
  type AccountingExportResult,
  DEFAULT_REVENUE_ACCOUNT_CODES,

  // Interface
  type RevenueRecognitionManager,

  // Factory
  createRevenueRecognitionManager,

  // ASC 606 Compliance Helpers
  allocateTransactionPrice,
  applyVariableConsiderationConstraint,
  determineRecognitionTiming,
  calculateStraightLineAmount,
  calculateUsageBasedAmount,
  calculatePercentageOfCompletionAmount,
  calculateMilestoneAmount,

  // Accounting Export Helpers
  createDeferredRevenueEntry,
  createRevenueRecognitionEntry,
  createUnbilledRevenueEntry,
  createBatchRecognitionEntries,
  createAccountingExportSummary,
  validateJournalEntries,
  formatJournalEntriesAsCSV,
} from './revenue-recognition'

// =============================================================================
// Fulfillment - Fulfillment orchestration
// =============================================================================

export {
  // Status Types
  type FulfillmentStatus as FulfillmentOrchestrationStatus,
  type ShipmentStatus,
  type ReturnStatus,
  type ExchangeStatus,
  type CarrierType,
  type ServiceLevel,

  // Provider Types
  type FulfillmentProviderCapabilities,
  type FulfillmentProvider,

  // Shipping Types
  type ShippingRate,
  type PackageDimensions,
  type Package,
  type ShippingAddress,

  // Fulfillment Types
  type FulfillmentLineItem,
  type FulfillmentOrder,
  type TrackingEvent,
  type Shipment as FulfillmentShipment,
  type FulfillmentStatusEntry,
  type DeliveryNotification,

  // Return/Exchange Types
  type ReturnRequest,
  type ExchangeRequest,

  // Input Types
  type CreateProviderInput,
  type UpdateProviderInput,
  type CreateFulfillmentOrderInput,
  type GetRatesInput,
  type CreateShipmentInput,
  type CreateReturnInput,
  type CreateExchangeInput,
  type SplitShipmentOptions,
  type CarrierSelectionCriteria,
  type NotificationInput,

  // Metrics
  type FulfillmentMetrics,

  // Interface
  type FulfillmentOrchestrator,

  // Factory
  createFulfillmentOrchestrator,
} from './fulfillment'

// =============================================================================
// Commerce Engine - Unified interface
// =============================================================================

import { createCatalog as _createCatalog } from './catalog'
import { createCartManager as _createCartManager } from './cart'
import { createOrderManager as _createOrderManager } from './orders'
import { createInventoryManager as _createInventoryManager } from './inventory'
import { createPricingEngine as _createPricingEngine } from './pricing'
import { createFulfillmentOrchestrator as _createFulfillmentOrchestrator } from './fulfillment'

export interface CommerceEngine {
  catalog: import('./catalog').Catalog
  cart: import('./cart').CartManager
  orders: import('./orders').OrderManager
  inventory: import('./inventory').InventoryManager
  pricing: import('./pricing').PricingEngine
  fulfillment: import('./fulfillment').FulfillmentOrchestrator
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
    catalog: _createCatalog(),
    cart: _createCartManager(options?.cart),
    orders: _createOrderManager(),
    inventory: _createInventoryManager(options?.inventory),
    pricing: _createPricingEngine(),
    fulfillment: _createFulfillmentOrchestrator(),
  }
}
