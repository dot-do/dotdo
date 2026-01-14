/**
 * Tests for centralized BashxConfig configuration schema
 *
 * @module tests/config/bashx-config
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  type BashxConfig,
  type PartialBashxConfig,
  DEFAULT_CONFIG,
  getConfig,
  validateConfig,
  mergeConfig,
  configDiff,
  type ConfigValidationError,
} from '../../src/config/bashx-config.js'

describe('BashxConfig', () => {
  describe('BashxConfig interface', () => {
    it('should have cache configuration options', () => {
      const config: BashxConfig = {
        cache: {
          classificationCacheSize: 1000,
          languageDetectionCacheSize: 500,
        },
      }

      expect(config.cache?.classificationCacheSize).toBe(1000)
      expect(config.cache?.languageDetectionCacheSize).toBe(500)
    })

    it('should have timeout configuration options', () => {
      const config: BashxConfig = {
        timeouts: {
          default: 30000,
          rpc: 60000,
          fetch: 30000,
        },
      }

      expect(config.timeouts?.default).toBe(30000)
      expect(config.timeouts?.rpc).toBe(60000)
      expect(config.timeouts?.fetch).toBe(30000)
    })

    it('should have limit configuration options', () => {
      const config: BashxConfig = {
        limits: {
          maxOutputSize: 1048576,
          maxLines: 1000,
        },
      }

      expect(config.limits?.maxOutputSize).toBe(1048576)
      expect(config.limits?.maxLines).toBe(1000)
    })

    it('should have execution configuration options', () => {
      const config: BashxConfig = {
        execution: {
          preferFaster: true,
          enableMetrics: false,
        },
      }

      expect(config.execution?.preferFaster).toBe(true)
      expect(config.execution?.enableMetrics).toBe(false)
    })

    it('should have retry configuration options', () => {
      const config: BashxConfig = {
        retry: {
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
        },
      }

      expect(config.retry?.maxRetries).toBe(3)
      expect(config.retry?.baseDelayMs).toBe(1000)
      expect(config.retry?.maxDelayMs).toBe(30000)
    })
  })

  describe('DEFAULT_CONFIG', () => {
    it('should provide sensible cache defaults', () => {
      expect(DEFAULT_CONFIG.cache.classificationCacheSize).toBe(1000)
      expect(DEFAULT_CONFIG.cache.languageDetectionCacheSize).toBe(500)
    })

    it('should provide sensible timeout defaults', () => {
      expect(DEFAULT_CONFIG.timeouts.default).toBe(30000)
      expect(DEFAULT_CONFIG.timeouts.rpc).toBe(60000)
      expect(DEFAULT_CONFIG.timeouts.fetch).toBe(30000)
    })

    it('should provide sensible limit defaults', () => {
      expect(DEFAULT_CONFIG.limits.maxOutputSize).toBe(1048576)
      expect(DEFAULT_CONFIG.limits.maxLines).toBe(1000)
    })

    it('should provide sensible execution defaults', () => {
      expect(DEFAULT_CONFIG.execution.preferFaster).toBe(true)
      expect(DEFAULT_CONFIG.execution.enableMetrics).toBe(false)
    })

    it('should provide sensible retry defaults', () => {
      expect(DEFAULT_CONFIG.retry.maxRetries).toBe(3)
      expect(DEFAULT_CONFIG.retry.baseDelayMs).toBe(1000)
      expect(DEFAULT_CONFIG.retry.maxDelayMs).toBe(30000)
    })

    it('should be a const assertion (frozen object)', () => {
      expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true)
    })
  })

  describe('getConfig()', () => {
    const originalEnv = process.env

    beforeEach(() => {
      // Reset env before each test
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should return default config when no overrides provided', () => {
      const config = getConfig()
      expect(config).toEqual(DEFAULT_CONFIG)
    })

    it('should merge partial user config with defaults', () => {
      const userConfig: PartialBashxConfig = {
        cache: {
          classificationCacheSize: 2000,
        },
      }

      const config = getConfig(userConfig)

      expect(config.cache.classificationCacheSize).toBe(2000)
      expect(config.cache.languageDetectionCacheSize).toBe(500) // default preserved
      expect(config.timeouts.default).toBe(30000) // other sections preserved
    })

    // TODO: Fix env var access in vitest worker environment
    it.skip('should override with environment variables', () => {
      process.env.BASHX_CACHE_CLASSIFICATION_SIZE = '5000'
      process.env.BASHX_CACHE_LANGUAGE_DETECTION_SIZE = '1000'
      process.env.BASHX_TIMEOUT_DEFAULT = '60000'
      process.env.BASHX_TIMEOUT_RPC = '120000'
      process.env.BASHX_TIMEOUT_FETCH = '45000'
      process.env.BASHX_LIMIT_MAX_OUTPUT_SIZE = '2097152'
      process.env.BASHX_LIMIT_MAX_LINES = '2000'
      process.env.BASHX_EXECUTION_PREFER_FASTER = 'false'
      process.env.BASHX_EXECUTION_ENABLE_METRICS = 'true'
      process.env.BASHX_RETRY_MAX_RETRIES = '5'
      process.env.BASHX_RETRY_BASE_DELAY_MS = '2000'
      process.env.BASHX_RETRY_MAX_DELAY_MS = '60000'

      const config = getConfig()

      expect(config.cache.classificationCacheSize).toBe(5000)
      expect(config.cache.languageDetectionCacheSize).toBe(1000)
      expect(config.timeouts.default).toBe(60000)
      expect(config.timeouts.rpc).toBe(120000)
      expect(config.timeouts.fetch).toBe(45000)
      expect(config.limits.maxOutputSize).toBe(2097152)
      expect(config.limits.maxLines).toBe(2000)
      expect(config.execution.preferFaster).toBe(false)
      expect(config.execution.enableMetrics).toBe(true)
      expect(config.retry.maxRetries).toBe(5)
      expect(config.retry.baseDelayMs).toBe(2000)
      expect(config.retry.maxDelayMs).toBe(60000)
    })

    it('should prioritize user config over env vars', () => {
      process.env.BASHX_CACHE_CLASSIFICATION_SIZE = '5000'

      const userConfig: PartialBashxConfig = {
        cache: {
          classificationCacheSize: 3000,
        },
      }

      const config = getConfig(userConfig)

      expect(config.cache.classificationCacheSize).toBe(3000)
    })

    it('should ignore invalid environment variable values', () => {
      process.env.BASHX_CACHE_CLASSIFICATION_SIZE = 'not-a-number'
      process.env.BASHX_TIMEOUT_DEFAULT = 'invalid'

      const config = getConfig()

      // Should fall back to defaults
      expect(config.cache.classificationCacheSize).toBe(1000)
      expect(config.timeouts.default).toBe(30000)
    })

    it('should handle empty environment variable values', () => {
      process.env.BASHX_CACHE_CLASSIFICATION_SIZE = ''

      const config = getConfig()

      expect(config.cache.classificationCacheSize).toBe(1000)
    })
  })

  describe('validateConfig()', () => {
    it('should return empty errors for valid config', () => {
      const errors = validateConfig(DEFAULT_CONFIG)
      expect(errors).toEqual([])
    })

    it('should reject negative cache sizes', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        cache: { classificationCacheSize: -100 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].path).toBe('cache.classificationCacheSize')
      expect(errors[0].message).toContain('positive')
    })

    it('should reject zero cache sizes', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        cache: { classificationCacheSize: 0 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].path).toBe('cache.classificationCacheSize')
    })

    it('should reject negative timeouts', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        timeouts: { default: -1000 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].path).toBe('timeouts.default')
      expect(errors[0].message).toContain('non-negative')
    })

    it('should allow zero timeout (no timeout)', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        timeouts: { default: 0 },
      })

      const errors = validateConfig(config)
      expect(errors).toEqual([])
    })

    it('should reject negative output size limit', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        limits: { maxOutputSize: -1 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].path).toBe('limits.maxOutputSize')
    })

    it('should reject maxDelayMs less than baseDelayMs', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        retry: { baseDelayMs: 5000, maxDelayMs: 1000 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.message.includes('maxDelayMs') && e.message.includes('baseDelayMs'))).toBe(true)
    })

    it('should reject negative retry count', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        retry: { maxRetries: -1 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].path).toBe('retry.maxRetries')
    })

    it('should collect all validation errors', () => {
      const config = mergeConfig(DEFAULT_CONFIG, {
        cache: { classificationCacheSize: -100, languageDetectionCacheSize: -50 },
        timeouts: { default: -1000 },
      })

      const errors = validateConfig(config)

      expect(errors.length).toBe(3)
    })
  })

  describe('mergeConfig()', () => {
    it('should deep merge configs correctly', () => {
      const partial: PartialBashxConfig = {
        cache: { classificationCacheSize: 2000 },
        execution: { enableMetrics: true },
      }

      const merged = mergeConfig(DEFAULT_CONFIG, partial)

      expect(merged.cache.classificationCacheSize).toBe(2000)
      expect(merged.cache.languageDetectionCacheSize).toBe(500) // preserved from base
      expect(merged.execution.enableMetrics).toBe(true)
      expect(merged.execution.preferFaster).toBe(true) // preserved from base
      expect(merged.timeouts).toEqual(DEFAULT_CONFIG.timeouts) // untouched section
    })

    it('should not mutate the base config', () => {
      const base = { ...DEFAULT_CONFIG }
      const partial: PartialBashxConfig = {
        cache: { classificationCacheSize: 9999 },
      }

      mergeConfig(base, partial)

      // Original DEFAULT_CONFIG should remain unchanged
      expect(DEFAULT_CONFIG.cache.classificationCacheSize).toBe(1000)
    })

    it('should handle empty partial config', () => {
      const merged = mergeConfig(DEFAULT_CONFIG, {})
      expect(merged).toEqual(DEFAULT_CONFIG)
    })

    it('should handle undefined values in partial config', () => {
      const partial: PartialBashxConfig = {
        cache: { classificationCacheSize: undefined as unknown as number },
      }

      const merged = mergeConfig(DEFAULT_CONFIG, partial)

      // undefined should not override the base value
      expect(merged.cache.classificationCacheSize).toBe(1000)
    })
  })

  describe('configDiff()', () => {
    it('should return empty diff for identical configs', () => {
      const diff = configDiff(DEFAULT_CONFIG, DEFAULT_CONFIG)
      expect(diff).toEqual({})
    })

    it('should show changed values', () => {
      const modified = mergeConfig(DEFAULT_CONFIG, {
        cache: { classificationCacheSize: 2000 },
        timeouts: { default: 60000 },
      })

      const diff = configDiff(DEFAULT_CONFIG, modified)

      expect(diff['cache.classificationCacheSize']).toEqual({
        from: 1000,
        to: 2000,
      })
      expect(diff['timeouts.default']).toEqual({
        from: 30000,
        to: 60000,
      })
    })

    it('should not include unchanged values', () => {
      const modified = mergeConfig(DEFAULT_CONFIG, {
        cache: { classificationCacheSize: 2000 },
      })

      const diff = configDiff(DEFAULT_CONFIG, modified)

      expect(Object.keys(diff).length).toBe(1)
      expect(diff['cache.classificationCacheSize']).toBeDefined()
      expect(diff['cache.languageDetectionCacheSize']).toBeUndefined()
    })

    it('should be useful for debugging config issues', () => {
      const customConfig = getConfig({
        cache: { classificationCacheSize: 5000 },
        execution: { enableMetrics: true },
      })

      const diff = configDiff(DEFAULT_CONFIG, customConfig)

      // Should show what changed from defaults
      expect(diff['cache.classificationCacheSize']).toBeDefined()
      expect(diff['execution.enableMetrics']).toBeDefined()
    })
  })

  describe('Environment variable mapping', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    // TODO: Fix env var access in vitest worker environment
    it.skip('should use BASHX_ prefix for all env vars', () => {
      // All bashx env vars should start with BASHX_
      const envVars = [
        'BASHX_CACHE_CLASSIFICATION_SIZE',
        'BASHX_CACHE_LANGUAGE_DETECTION_SIZE',
        'BASHX_TIMEOUT_DEFAULT',
        'BASHX_TIMEOUT_RPC',
        'BASHX_TIMEOUT_FETCH',
        'BASHX_LIMIT_MAX_OUTPUT_SIZE',
        'BASHX_LIMIT_MAX_LINES',
        'BASHX_EXECUTION_PREFER_FASTER',
        'BASHX_EXECUTION_ENABLE_METRICS',
        'BASHX_RETRY_MAX_RETRIES',
        'BASHX_RETRY_BASE_DELAY_MS',
        'BASHX_RETRY_MAX_DELAY_MS',
      ]

      // Set all to known values
      process.env.BASHX_CACHE_CLASSIFICATION_SIZE = '100'
      process.env.BASHX_TIMEOUT_DEFAULT = '1000'

      const config = getConfig()

      // Should respect env vars with BASHX_ prefix
      expect(config.cache.classificationCacheSize).toBe(100)
      expect(config.timeouts.default).toBe(1000)
    })

    // TODO: Fix env var access in vitest worker environment
    it.skip('should handle boolean env vars correctly', () => {
      process.env.BASHX_EXECUTION_PREFER_FASTER = 'true'
      expect(getConfig().execution.preferFaster).toBe(true)

      process.env.BASHX_EXECUTION_PREFER_FASTER = 'false'
      expect(getConfig().execution.preferFaster).toBe(false)

      process.env.BASHX_EXECUTION_PREFER_FASTER = '1'
      expect(getConfig().execution.preferFaster).toBe(true)

      process.env.BASHX_EXECUTION_PREFER_FASTER = '0'
      expect(getConfig().execution.preferFaster).toBe(false)

      process.env.BASHX_EXECUTION_PREFER_FASTER = 'yes'
      expect(getConfig().execution.preferFaster).toBe(true)

      process.env.BASHX_EXECUTION_PREFER_FASTER = 'no'
      expect(getConfig().execution.preferFaster).toBe(false)
    })
  })

  describe('Backward compatibility', () => {
    it('should export values matching current magic numbers in codebase', () => {
      // These are the actual magic numbers currently in the codebase
      // This test ensures we don't accidentally change defaults
      expect(DEFAULT_CONFIG.cache.classificationCacheSize).toBe(1000)
      expect(DEFAULT_CONFIG.cache.languageDetectionCacheSize).toBe(500)
      expect(DEFAULT_CONFIG.timeouts.default).toBe(30000)
      expect(DEFAULT_CONFIG.limits.maxOutputSize).toBe(1048576) // 1MB
      expect(DEFAULT_CONFIG.limits.maxLines).toBe(1000)
    })
  })
})
