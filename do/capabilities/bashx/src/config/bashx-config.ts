/**
 * Centralized Configuration Schema for bashx
 *
 * This module provides a typed configuration interface for all bashx settings,
 * replacing scattered magic values with a centralized, validated configuration.
 *
 * Configuration is loaded from three sources with the following priority:
 * 1. User-provided config (highest priority)
 * 2. Environment variables (BASHX_* pattern)
 * 3. Default values (lowest priority)
 *
 * @example
 * ```typescript
 * import { getConfig, DEFAULT_CONFIG } from 'bashx/config'
 *
 * // Get config with environment variable overrides
 * const config = getConfig()
 *
 * // Get config with custom overrides
 * const customConfig = getConfig({
 *   cache: { classificationCacheSize: 2000 },
 *   timeouts: { default: 60000 },
 * })
 *
 * // Validate a config
 * const errors = validateConfig(config)
 * if (errors.length > 0) {
 *   console.error('Invalid config:', errors)
 * }
 * ```
 *
 * @module config/bashx-config
 */

// ============================================================================
// CONFIGURATION INTERFACES
// ============================================================================

/**
 * Cache configuration options.
 *
 * Controls the size of various caches used to avoid repeated computations.
 */
export interface CacheConfig {
  /**
   * Maximum number of entries in the command classification cache.
   * Caches the tier classification result for commands to avoid repeated lookups.
   * @default 1000
   */
  classificationCacheSize: number

  /**
   * Maximum number of entries in the language detection cache.
   * Caches language detection results for code snippets.
   * @default 500
   */
  languageDetectionCacheSize: number
}

/**
 * Timeout configuration options.
 *
 * Controls various timeout values in milliseconds.
 */
export interface TimeoutConfig {
  /**
   * Default timeout for command execution in milliseconds.
   * Commands will be killed if they exceed this limit.
   * @default 30000
   */
  default: number

  /**
   * Timeout for RPC calls to external services in milliseconds.
   * Used for npm, git, and other tier 2 operations.
   * @default 60000
   */
  rpc: number

  /**
   * Timeout for fetch operations in milliseconds.
   * Used for HTTP requests to external APIs.
   * @default 30000
   */
  fetch: number
}

/**
 * Limit configuration options.
 *
 * Controls various size and count limits.
 */
export interface LimitConfig {
  /**
   * Maximum output size in bytes before truncation.
   * Prevents memory issues from commands with huge output.
   * @default 1048576 (1MB)
   */
  maxOutputSize: number

  /**
   * Maximum number of lines for commands like `yes`.
   * Prevents infinite loops in non-streaming environments.
   * @default 1000
   */
  maxLines: number
}

/**
 * Execution behavior configuration.
 *
 * Controls how commands are executed.
 */
export interface ExecutionConfig {
  /**
   * Prefer faster execution tier when multiple are available.
   * When true, uses native tier 1 execution when possible.
   * @default true
   */
  preferFaster: boolean

  /**
   * Enable metrics collection for tier usage analysis.
   * When enabled, tracks classification counts, cache hits, and tier usage.
   * @default false
   */
  enableMetrics: boolean
}

/**
 * Retry configuration options.
 *
 * Controls retry behavior for failed operations.
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  maxRetries: number

  /**
   * Base delay in milliseconds for exponential backoff.
   * @default 1000
   */
  baseDelayMs: number

  /**
   * Maximum delay in milliseconds for exponential backoff.
   * @default 30000
   */
  maxDelayMs: number
}

/**
 * Complete bashx configuration interface.
 *
 * All sections are optional when passing to getConfig(),
 * but the resolved config will have all values defined.
 */
export interface BashxConfig {
  /**
   * Cache size configuration.
   */
  cache: CacheConfig

  /**
   * Timeout configuration.
   */
  timeouts: TimeoutConfig

  /**
   * Limit configuration.
   */
  limits: LimitConfig

  /**
   * Execution behavior configuration.
   */
  execution: ExecutionConfig

  /**
   * Retry configuration.
   */
  retry: RetryConfig
}

/**
 * Partial bashx configuration for user overrides.
 * All fields are optional and will be merged with defaults.
 */
export type PartialBashxConfig = {
  cache?: Partial<CacheConfig>
  timeouts?: Partial<TimeoutConfig>
  limits?: Partial<LimitConfig>
  execution?: Partial<ExecutionConfig>
  retry?: Partial<RetryConfig>
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration values.
 *
 * These values match the current magic numbers scattered throughout the codebase
 * to ensure backward compatibility.
 *
 * @example
 * ```typescript
 * import { DEFAULT_CONFIG } from 'bashx/config'
 *
 * console.log(DEFAULT_CONFIG.timeouts.default) // 30000
 * console.log(DEFAULT_CONFIG.limits.maxOutputSize) // 1048576
 * ```
 */
export const DEFAULT_CONFIG: Readonly<BashxConfig> = Object.freeze({
  cache: Object.freeze({
    classificationCacheSize: 1000,
    languageDetectionCacheSize: 500,
  }),
  timeouts: Object.freeze({
    default: 30000,
    rpc: 60000,
    fetch: 30000,
  }),
  limits: Object.freeze({
    maxOutputSize: 1048576, // 1MB
    maxLines: 1000,
  }),
  execution: Object.freeze({
    preferFaster: true,
    enableMetrics: false,
  }),
  retry: Object.freeze({
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }),
})

// ============================================================================
// ENVIRONMENT VARIABLE MAPPING
// ============================================================================

/**
 * Environment variable name to config path mapping.
 * All env vars use the BASHX_ prefix.
 */
const ENV_VAR_MAP: Record<string, { path: string; type: 'number' | 'boolean' }> = {
  BASHX_CACHE_CLASSIFICATION_SIZE: { path: 'cache.classificationCacheSize', type: 'number' },
  BASHX_CACHE_LANGUAGE_DETECTION_SIZE: { path: 'cache.languageDetectionCacheSize', type: 'number' },
  BASHX_TIMEOUT_DEFAULT: { path: 'timeouts.default', type: 'number' },
  BASHX_TIMEOUT_RPC: { path: 'timeouts.rpc', type: 'number' },
  BASHX_TIMEOUT_FETCH: { path: 'timeouts.fetch', type: 'number' },
  BASHX_LIMIT_MAX_OUTPUT_SIZE: { path: 'limits.maxOutputSize', type: 'number' },
  BASHX_LIMIT_MAX_LINES: { path: 'limits.maxLines', type: 'number' },
  BASHX_EXECUTION_PREFER_FASTER: { path: 'execution.preferFaster', type: 'boolean' },
  BASHX_EXECUTION_ENABLE_METRICS: { path: 'execution.enableMetrics', type: 'boolean' },
  BASHX_RETRY_MAX_RETRIES: { path: 'retry.maxRetries', type: 'number' },
  BASHX_RETRY_BASE_DELAY_MS: { path: 'retry.baseDelayMs', type: 'number' },
  BASHX_RETRY_MAX_DELAY_MS: { path: 'retry.maxDelayMs', type: 'number' },
}

/**
 * Parse a string as a number, returning undefined if invalid.
 */
function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

/**
 * Parse a string as a boolean, returning undefined if invalid.
 * Accepts: true, false, 1, 0, yes, no (case insensitive)
 */
function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  const lower = value.toLowerCase()
  if (lower === 'true' || lower === '1' || lower === 'yes') return true
  if (lower === 'false' || lower === '0' || lower === 'no') return false
  return undefined
}

/**
 * Set a nested property value by dot-separated path.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}


/**
 * Load configuration from environment variables.
 * Returns a partial config object with only the values that were set.
 */
function loadFromEnv(): PartialBashxConfig {
  const result: Record<string, unknown> = {}

  // Check if we're in a browser or environment without process.env
  if (typeof process === 'undefined' || !process.env) {
    return result as PartialBashxConfig
  }

  for (const [envVar, { path, type }] of Object.entries(ENV_VAR_MAP)) {
    const rawValue = process.env[envVar]
    if (rawValue === undefined || rawValue === '') continue

    let parsedValue: unknown
    if (type === 'number') {
      parsedValue = parseNumber(rawValue)
    } else {
      parsedValue = parseBoolean(rawValue)
    }

    if (parsedValue !== undefined) {
      setByPath(result, path, parsedValue)
    }
  }

  return result as PartialBashxConfig
}

// ============================================================================
// CONFIG MERGING
// ============================================================================

/**
 * Deep merge two configuration objects.
 *
 * Values from `partial` override values from `base`, but only if they are defined.
 * Undefined values in partial are ignored, preserving the base value.
 *
 * @param base - Base configuration (all fields required)
 * @param partial - Partial configuration to merge in
 * @returns Merged configuration with all fields defined
 *
 * @example
 * ```typescript
 * const merged = mergeConfig(DEFAULT_CONFIG, {
 *   cache: { classificationCacheSize: 2000 },
 * })
 * // merged.cache.classificationCacheSize === 2000
 * // merged.cache.languageDetectionCacheSize === 500 (from default)
 * ```
 */
export function mergeConfig(base: BashxConfig, partial: PartialBashxConfig): BashxConfig {
  return {
    cache: {
      classificationCacheSize:
        partial.cache?.classificationCacheSize ?? base.cache.classificationCacheSize,
      languageDetectionCacheSize:
        partial.cache?.languageDetectionCacheSize ?? base.cache.languageDetectionCacheSize,
    },
    timeouts: {
      default: partial.timeouts?.default ?? base.timeouts.default,
      rpc: partial.timeouts?.rpc ?? base.timeouts.rpc,
      fetch: partial.timeouts?.fetch ?? base.timeouts.fetch,
    },
    limits: {
      maxOutputSize: partial.limits?.maxOutputSize ?? base.limits.maxOutputSize,
      maxLines: partial.limits?.maxLines ?? base.limits.maxLines,
    },
    execution: {
      preferFaster: partial.execution?.preferFaster ?? base.execution.preferFaster,
      enableMetrics: partial.execution?.enableMetrics ?? base.execution.enableMetrics,
    },
    retry: {
      maxRetries: partial.retry?.maxRetries ?? base.retry.maxRetries,
      baseDelayMs: partial.retry?.baseDelayMs ?? base.retry.baseDelayMs,
      maxDelayMs: partial.retry?.maxDelayMs ?? base.retry.maxDelayMs,
    },
  }
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

/**
 * Get the resolved configuration.
 *
 * Merges configuration from three sources with the following priority:
 * 1. User-provided config (highest priority)
 * 2. Environment variables (BASHX_* pattern)
 * 3. Default values (lowest priority)
 *
 * @param userConfig - Optional user-provided configuration overrides
 * @returns Complete resolved configuration
 *
 * @example
 * ```typescript
 * // With default config
 * const config = getConfig()
 *
 * // With overrides
 * const config = getConfig({
 *   cache: { classificationCacheSize: 5000 },
 *   timeouts: { default: 60000 },
 * })
 *
 * // Environment variables are automatically applied
 * // BASHX_TIMEOUT_DEFAULT=45000 will be used unless overridden
 * ```
 */
export function getConfig(userConfig?: PartialBashxConfig): BashxConfig {
  // Start with defaults
  let config = DEFAULT_CONFIG

  // Apply environment variables
  const envConfig = loadFromEnv()
  config = mergeConfig(config, envConfig)

  // Apply user config (highest priority)
  if (userConfig) {
    config = mergeConfig(config, userConfig)
  }

  return config
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

/**
 * Configuration validation error.
 */
export interface ConfigValidationError {
  /**
   * Dot-separated path to the invalid field.
   */
  path: string

  /**
   * Human-readable error message.
   */
  message: string

  /**
   * The invalid value.
   */
  value: unknown
}

/**
 * Validate a configuration object.
 *
 * Checks all values for validity and returns an array of errors.
 * An empty array means the configuration is valid.
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors (empty if valid)
 *
 * @example
 * ```typescript
 * const errors = validateConfig(config)
 * if (errors.length > 0) {
 *   for (const error of errors) {
 *     console.error(`${error.path}: ${error.message}`)
 *   }
 * }
 * ```
 */
export function validateConfig(config: BashxConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = []

  // Cache validation - all sizes must be positive
  if (config.cache.classificationCacheSize <= 0) {
    errors.push({
      path: 'cache.classificationCacheSize',
      message: 'Cache size must be a positive integer',
      value: config.cache.classificationCacheSize,
    })
  }
  if (config.cache.languageDetectionCacheSize <= 0) {
    errors.push({
      path: 'cache.languageDetectionCacheSize',
      message: 'Cache size must be a positive integer',
      value: config.cache.languageDetectionCacheSize,
    })
  }

  // Timeout validation - must be non-negative (0 = no timeout)
  if (config.timeouts.default < 0) {
    errors.push({
      path: 'timeouts.default',
      message: 'Timeout must be non-negative (0 for no timeout)',
      value: config.timeouts.default,
    })
  }
  if (config.timeouts.rpc < 0) {
    errors.push({
      path: 'timeouts.rpc',
      message: 'Timeout must be non-negative (0 for no timeout)',
      value: config.timeouts.rpc,
    })
  }
  if (config.timeouts.fetch < 0) {
    errors.push({
      path: 'timeouts.fetch',
      message: 'Timeout must be non-negative (0 for no timeout)',
      value: config.timeouts.fetch,
    })
  }

  // Limit validation - must be positive
  if (config.limits.maxOutputSize < 0) {
    errors.push({
      path: 'limits.maxOutputSize',
      message: 'Max output size must be non-negative',
      value: config.limits.maxOutputSize,
    })
  }
  if (config.limits.maxLines < 0) {
    errors.push({
      path: 'limits.maxLines',
      message: 'Max lines must be non-negative',
      value: config.limits.maxLines,
    })
  }

  // Retry validation
  if (config.retry.maxRetries < 0) {
    errors.push({
      path: 'retry.maxRetries',
      message: 'Max retries must be non-negative',
      value: config.retry.maxRetries,
    })
  }
  if (config.retry.baseDelayMs < 0) {
    errors.push({
      path: 'retry.baseDelayMs',
      message: 'Base delay must be non-negative',
      value: config.retry.baseDelayMs,
    })
  }
  if (config.retry.maxDelayMs < 0) {
    errors.push({
      path: 'retry.maxDelayMs',
      message: 'Max delay must be non-negative',
      value: config.retry.maxDelayMs,
    })
  }
  if (config.retry.maxDelayMs < config.retry.baseDelayMs) {
    errors.push({
      path: 'retry.maxDelayMs',
      message: 'maxDelayMs must be greater than or equal to baseDelayMs',
      value: config.retry.maxDelayMs,
    })
  }

  return errors
}

// ============================================================================
// CONFIG DIFF (FOR DEBUGGING)
// ============================================================================

/**
 * Configuration difference entry.
 */
export interface ConfigDiffEntry {
  from: unknown
  to: unknown
}

/**
 * Get the differences between two configuration objects.
 *
 * Useful for debugging to see what values differ from defaults.
 *
 * @param base - Base configuration to compare from
 * @param modified - Modified configuration to compare to
 * @returns Object mapping paths to their changed values
 *
 * @example
 * ```typescript
 * const diff = configDiff(DEFAULT_CONFIG, customConfig)
 * // {
 * //   'cache.classificationCacheSize': { from: 1000, to: 2000 },
 * //   'timeouts.default': { from: 30000, to: 60000 }
 * // }
 * ```
 */
export function configDiff(
  base: BashxConfig,
  modified: BashxConfig
): Record<string, ConfigDiffEntry> {
  const diff: Record<string, ConfigDiffEntry> = {}

  // Helper to compare and record differences
  function compare(path: string, baseVal: unknown, modVal: unknown): void {
    if (baseVal !== modVal) {
      diff[path] = { from: baseVal, to: modVal }
    }
  }

  // Cache
  compare('cache.classificationCacheSize', base.cache.classificationCacheSize, modified.cache.classificationCacheSize)
  compare('cache.languageDetectionCacheSize', base.cache.languageDetectionCacheSize, modified.cache.languageDetectionCacheSize)

  // Timeouts
  compare('timeouts.default', base.timeouts.default, modified.timeouts.default)
  compare('timeouts.rpc', base.timeouts.rpc, modified.timeouts.rpc)
  compare('timeouts.fetch', base.timeouts.fetch, modified.timeouts.fetch)

  // Limits
  compare('limits.maxOutputSize', base.limits.maxOutputSize, modified.limits.maxOutputSize)
  compare('limits.maxLines', base.limits.maxLines, modified.limits.maxLines)

  // Execution
  compare('execution.preferFaster', base.execution.preferFaster, modified.execution.preferFaster)
  compare('execution.enableMetrics', base.execution.enableMetrics, modified.execution.enableMetrics)

  // Retry
  compare('retry.maxRetries', base.retry.maxRetries, modified.retry.maxRetries)
  compare('retry.baseDelayMs', base.retry.baseDelayMs, modified.retry.baseDelayMs)
  compare('retry.maxDelayMs', base.retry.maxDelayMs, modified.retry.maxDelayMs)

  return diff
}
