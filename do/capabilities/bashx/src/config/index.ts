/**
 * Configuration module for bashx
 *
 * Provides centralized configuration management with:
 * - Typed configuration interface
 * - Sensible defaults
 * - Environment variable overrides
 * - Configuration validation
 *
 * @example
 * ```typescript
 * import { getConfig, DEFAULT_CONFIG, validateConfig } from 'bashx/config'
 *
 * // Get config with all sources merged
 * const config = getConfig()
 *
 * // Get specific values
 * const timeout = config.timeouts.default
 * const cacheSize = config.cache.classificationCacheSize
 *
 * // Validate custom config
 * const errors = validateConfig(config)
 * ```
 *
 * @module config
 */

export {
  // Types
  type BashxConfig,
  type PartialBashxConfig,
  type CacheConfig,
  type TimeoutConfig,
  type LimitConfig,
  type ExecutionConfig,
  type RetryConfig,
  type ConfigValidationError,
  type ConfigDiffEntry,
  // Constants
  DEFAULT_CONFIG,
  // Functions
  getConfig,
  validateConfig,
  mergeConfig,
  configDiff,
} from './bashx-config.js'
