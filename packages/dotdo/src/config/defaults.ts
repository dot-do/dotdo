/**
 * DO Config Defaults
 *
 * Provides default value application for DO configuration.
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
  return {
    ...config,
    auth: {
      provider: CONFIG_DEFAULTS.auth.provider,
      ...config.auth,
    },
    api: {
      basePath: CONFIG_DEFAULTS.api.basePath,
      ...config.api,
    },
    dashboard: {
      theme: CONFIG_DEFAULTS.dashboard.theme,
      ...config.dashboard,
    },
    cli: {
      vimMode: CONFIG_DEFAULTS.cli.vimMode,
      ...config.cli,
    },
  }
}
