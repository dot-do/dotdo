/**
 * DO Config Defaults
 *
 * Provides default value application for DO configuration.
 *
 * This is a STUB file for TDD RED phase - implementation pending.
 *
 * @see docs/plans/2026-01-10-do-dashboard-design.md for specification
 */

import type { DoConfig } from './index'

/**
 * Default configuration values
 */
export const CONFIG_DEFAULTS = {
  auth: {
    provider: 'oauth.do' as const,
  },
  api: {
    basePath: '/api',
  },
  dashboard: {
    theme: 'auto' as const,
  },
  cli: {
    vimMode: true,
  },
}

/**
 * Apply default values to a configuration.
 *
 * This function merges default values with the provided configuration,
 * ensuring all optional fields have sensible defaults while preserving
 * explicitly set values.
 *
 * @param config - The input configuration
 * @returns A new configuration with defaults applied
 *
 * @example
 * ```ts
 * const config = applyDefaults({ ns: 'myapp.com' })
 * console.log(config.auth.provider) // 'oauth.do'
 * console.log(config.api.basePath) // '/api'
 * console.log(config.dashboard.theme) // 'auto'
 * console.log(config.cli.vimMode) // true
 * ```
 */
export function applyDefaults(config: DoConfig): DoConfig {
  // STUB: Will be implemented in GREEN phase
  throw new Error('Not implemented: applyDefaults()')
}
