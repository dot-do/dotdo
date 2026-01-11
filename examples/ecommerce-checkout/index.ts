/**
 * E-Commerce Checkout Example - Multi-DO Architecture
 *
 * Entry point for the complete e-commerce checkout flow.
 * Demonstrates multi-DO coordination with saga/compensation patterns.
 *
 * Architecture:
 * - CartDO: Shopping cart per customer
 * - InventoryDO: Global inventory with reservation system
 * - CheckoutDO: Checkout session orchestrator
 * - OrderDO: Order management per order
 *
 * Saga Pattern:
 * 1. Create checkout session (snapshot cart)
 * 2. Reserve inventory (try)
 * 3. Process payment (try)
 * 4. Commit inventory (confirm)
 * 5. Create order (confirm)
 *
 * Compensation on failure:
 * - Release inventory reservation
 * - Refund payment if charged
 * - Notify customer
 */

// Re-export all DO classes for Wrangler
export { CartDO } from './objects/Cart'
export { InventoryDO } from './objects/Inventory'
export { CheckoutDO } from './objects/Checkout'
export { OrderDO } from './objects/Order'

// Import and create API
import { createAPI } from './api/routes'

export default createAPI()
