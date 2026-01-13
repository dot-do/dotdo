/**
 * @dotdo/lib/tools/adapters - Provider Adapters
 *
 * Pre-built adapters for common compat/ providers.
 *
 * @example
 * ```typescript
 * import { sendgridAdapter, stripeAdapter, slackAdapter } from 'lib/tools/adapters'
 * import { globalRegistry } from 'lib/tools'
 *
 * // Register individual adapters
 * globalRegistry.register(sendgridAdapter)
 * globalRegistry.register(stripeAdapter)
 * globalRegistry.register(slackAdapter)
 *
 * // Or register all at once
 * import { registerAllAdapters } from 'lib/tools/adapters'
 * registerAllAdapters(globalRegistry)
 * ```
 *
 * @module lib/tools/adapters
 */

import type { ProviderRegistry } from '../auto-register'
import type { ProviderToolAdapter } from '../provider-adapter'

// =============================================================================
// Adapter Exports
// =============================================================================

export { sendgridAdapter } from './sendgrid'
export { stripeAdapter } from './stripe'
export { slackAdapter } from './slack'

// =============================================================================
// All Adapters
// =============================================================================

/**
 * Get all available adapters
 */
export function getAllAdapters(): ProviderToolAdapter[] {
  // Using dynamic imports to avoid circular dependencies and allow tree-shaking
  const adapters: ProviderToolAdapter[] = []

  // Import adapters lazily
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  adapters.push(require('./sendgrid').sendgridAdapter)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  adapters.push(require('./stripe').stripeAdapter)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  adapters.push(require('./slack').slackAdapter)

  return adapters
}

/**
 * Register all adapters with a registry
 */
export function registerAllAdapters(registry: ProviderRegistry): void {
  for (const adapter of getAllAdapters()) {
    registry.register(adapter)
  }
}

/**
 * Adapter names for discovery
 */
export const AVAILABLE_ADAPTERS = [
  'sendgrid',
  'stripe',
  'slack',
] as const

export type AvailableAdapter = typeof AVAILABLE_ADAPTERS[number]
