/**
 * @dotdo/shopify - Shopify API Compatibility Layer
 *
 * Drop-in replacement for @shopify/shopify-api with edge compatibility.
 * Provides both a real API client and a local implementation for testing.
 *
 * @example
 * ```typescript
 * // Real API client
 * import { shopifyApi, LATEST_API_VERSION } from '@dotdo/shopify'
 *
 * const shopify = shopifyApi({
 *   apiKey: 'your-api-key',
 *   apiSecretKey: 'your-api-secret',
 *   scopes: ['read_products', 'write_orders'],
 *   hostName: 'my-store.myshopify.com',
 * })
 *
 * // Local implementation for testing
 * import { ShopifyLocal } from '@dotdo/shopify/local'
 *
 * const shopify = new ShopifyLocal({
 *   shop: 'test-shop.myshopify.com',
 *   accessToken: 'test-token',
 * })
 * ```
 *
 * @module @dotdo/shopify
 */

// Re-export types
export * from './types'

// Re-export local implementation
export { ShopifyLocal } from './local'
