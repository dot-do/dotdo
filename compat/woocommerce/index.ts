/**
 * @dotdo/woocommerce - WooCommerce REST API Compatibility Layer
 *
 * A complete WooCommerce REST API compatible SDK for dotdo.
 * Supports products, variations, categories, tags, attributes,
 * orders, customers, coupons, taxes, shipping, and batch operations.
 *
 * Two modes of operation:
 * 1. Remote API mode - connects to a real WooCommerce store
 * 2. Local mode - fully functional local implementation backed by DO storage
 *
 * @example Remote API mode:
 * ```typescript
 * import { wooCommerceApi } from '@dotdo/woocommerce'
 *
 * const wc = wooCommerceApi({
 *   url: 'https://mystore.com',
 *   consumerKey: 'ck_xxx',
 *   consumerSecret: 'cs_xxx',
 * })
 *
 * // List products
 * const { body: products } = await wc.products.list()
 *
 * // Create a simple product
 * const { body: product } = await wc.products.create({
 *   name: 'My Product',
 *   type: 'simple',
 *   regular_price: '19.99',
 * })
 * ```
 *
 * @example Local mode:
 * ```typescript
 * import { WooCommerceLocal } from '@dotdo/woocommerce/local'
 *
 * const wc = new WooCommerceLocal()
 *
 * // Create a customer (stored locally)
 * const customer = await wc.customers.create({
 *   email: 'user@example.com',
 *   first_name: 'John',
 *   last_name: 'Doe',
 * })
 *
 * // Create an order
 * const order = await wc.orders.create({
 *   customer_id: customer.id,
 *   line_items: [{ product_id: 1, quantity: 2 }],
 * })
 * ```
 *
 * @module @dotdo/woocommerce
 */

import { RestClient, resolveConfig } from './client'
import { ProductsResource } from './products'
import { OrdersResource } from './orders'
import { CustomersResource } from './customers'
import { CouponsResource } from './coupons'
import { TaxRatesResource, TaxClassesResource } from './taxes'
import { ShippingZonesResource, ShippingMethodsResource } from './shipping'
import type { WooCommerceConfig } from './types'

// =============================================================================
// Re-exports
// =============================================================================

export * from './types'
export * from './client'
export * from './products'
export * from './orders'
export * from './customers'
export * from './coupons'
export * from './taxes'
export * from './shipping'
export * from './local'

// =============================================================================
// WooCommerce API Factory
// =============================================================================

/**
 * WooCommerce API instance
 */
export interface WooCommerceAPI {
  /** Products resource (includes variations, categories, tags, attributes) */
  products: ProductsResource
  /** Orders resource (includes notes and refunds) */
  orders: OrdersResource
  /** Customers resource (includes downloads) */
  customers: CustomersResource
  /** Coupons resource */
  coupons: CouponsResource
  /** Tax rates resource */
  taxRates: TaxRatesResource
  /** Tax classes resource */
  taxClasses: TaxClassesResource
  /** Shipping zones resource (includes locations and methods) */
  shippingZones: ShippingZonesResource
  /** Shipping methods resource */
  shippingMethods: ShippingMethodsResource
  /** Direct access to REST client for custom requests */
  client: RestClient
}

/**
 * Create a WooCommerce API client
 *
 * @param config - WooCommerce configuration
 * @returns WooCommerce API instance
 *
 * @example
 * ```typescript
 * const wc = wooCommerceApi({
 *   url: 'https://mystore.com',
 *   consumerKey: 'ck_xxx',
 *   consumerSecret: 'cs_xxx',
 * })
 * ```
 */
export function wooCommerceApi(config: WooCommerceConfig): WooCommerceAPI {
  const resolvedConfig = resolveConfig(config)
  const client = new RestClient(resolvedConfig)

  return {
    products: new ProductsResource(client),
    orders: new OrdersResource(client),
    customers: new CustomersResource(client),
    coupons: new CouponsResource(client),
    taxRates: new TaxRatesResource(client),
    taxClasses: new TaxClassesResource(client),
    shippingZones: new ShippingZonesResource(client),
    shippingMethods: new ShippingMethodsResource(client),
    client,
  }
}

// Default export
export default wooCommerceApi
