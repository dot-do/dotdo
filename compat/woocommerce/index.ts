/**
 * @dotdo/woocommerce - WooCommerce REST API Compatibility Layer
 *
 * A complete WooCommerce REST API compatible SDK for dotdo.
 * Supports products, variations, categories, tags, attributes,
 * and batch operations.
 *
 * @example
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
 *
 * // Create a variable product with variations
 * const { body: variableProduct } = await wc.products.create({
 *   name: 'T-Shirt',
 *   type: 'variable',
 *   attributes: [
 *     { name: 'Size', variation: true, options: ['S', 'M', 'L'] },
 *     { name: 'Color', variation: true, options: ['Red', 'Blue'] },
 *   ],
 * })
 *
 * // Create variations
 * await wc.products.variations.create(variableProduct.id, {
 *   regular_price: '24.99',
 *   attributes: [
 *     { name: 'Size', option: 'M' },
 *     { name: 'Color', option: 'Blue' },
 *   ],
 * })
 * ```
 *
 * @module @dotdo/woocommerce
 */

import { RestClient, resolveConfig } from './client'
import { ProductsResource } from './products'
import type { WooCommerceConfig } from './types'

// =============================================================================
// Re-exports
// =============================================================================

export * from './types'
export * from './client'
export * from './products'

// =============================================================================
// WooCommerce API Factory
// =============================================================================

/**
 * WooCommerce API instance
 */
export interface WooCommerceAPI {
  /** Products resource (includes variations, categories, tags, attributes) */
  products: ProductsResource
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
    client,
  }
}

// Default export
export default wooCommerceApi
