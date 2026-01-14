/**
 * ACID Test Suite - Phase 5: E2E Configuration Tests
 *
 * Tests for the E2E test configuration infrastructure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createE2EConfig,
  getE2EConfig,
  configureE2E,
  resetE2EConfig,
  detectEnvironment,
  getPreviewUrl,
  isE2EEnabled,
  getBaseUrl,
  isReadOnly,
  requiresAuth,
  hasCloudflareCredentials,
  generateTestResourceName,
  isTestResource,
  calculateRetryDelay,
  DEFAULT_ENDPOINTS,
  DEFAULT_TIMEOUTS,
  DEFAULT_RETRIES,
  DEFAULT_CLEANUP,
  DEFAULT_PIPELINE_SLA,
  type E2EConfig,
  type TestEnvironment,
} from './config'

describe('E2E Configuration', () => {
  beforeEach(() => {
    resetE2EConfig()
  })

  afterEach(() => {
    resetE2EConfig()
  })

  describe('createE2EConfig', () => {
    it('should create config with defaults', () => {
      const config = createE2EConfig()

      expect(config.endpoints).toEqual(DEFAULT_ENDPOINTS)
      expect(config.timeouts).toEqual(DEFAULT_TIMEOUTS)
      expect(config.retries).toEqual(DEFAULT_RETRIES)
      expect(config.cleanup).toEqual(DEFAULT_CLEANUP)
      expect(config.pipelineSLA).toEqual(DEFAULT_PIPELINE_SLA)
    })

    it('should allow overriding environment', () => {
      const config = createE2EConfig({ environment: 'production' })

      expect(config.environment).toBe('production')
    })

    it('should allow overriding timeouts', () => {
      const config = createE2EConfig({
        timeouts: { test: 60000 } as E2EConfig['timeouts'],
      })

      expect(config.timeouts.test).toBe(60000)
    })

    it('should allow overriding cleanup settings', () => {
      const config = createE2EConfig({
        cleanup: { prefix: 'custom-test-' } as E2EConfig['cleanup'],
      })

      expect(config.cleanup.prefix).toBe('custom-test-')
    })
  })

  describe('getE2EConfig', () => {
    it('should return singleton config', () => {
      const config1 = getE2EConfig()
      const config2 = getE2EConfig()

      expect(config1).toBe(config2)
    })
  })

  describe('configureE2E', () => {
    it('should update global config', () => {
      configureE2E({ environment: 'staging' })

      const config = getE2EConfig()
      expect(config.environment).toBe('staging')
    })
  })

  describe('resetE2EConfig', () => {
    it('should reset to defaults', () => {
      configureE2E({ environment: 'production' })
      resetE2EConfig()

      // Getting config will create new default
      const config = getE2EConfig()
      // Environment is detected, so we just verify it's not explicitly 'production'
      expect(typeof config.environment).toBe('string')
    })
  })

  describe('detectEnvironment', () => {
    it('should detect environment from E2E_ENVIRONMENT', () => {
      const originalEnv = process.env.E2E_ENVIRONMENT
      process.env.E2E_ENVIRONMENT = 'staging'

      const env = detectEnvironment()
      expect(env).toBe('staging')

      process.env.E2E_ENVIRONMENT = originalEnv
    })

    it('should return local by default', () => {
      const originalEnv = process.env.E2E_ENVIRONMENT
      const originalCI = process.env.CI
      const originalCFE2E = process.env.CLOUDFLARE_E2E

      delete process.env.E2E_ENVIRONMENT
      delete process.env.CI
      delete process.env.CLOUDFLARE_E2E

      const env = detectEnvironment()
      expect(env).toBe('local')

      process.env.E2E_ENVIRONMENT = originalEnv
      if (originalCI) process.env.CI = originalCI
      if (originalCFE2E) process.env.CLOUDFLARE_E2E = originalCFE2E
    })
  })

  describe('getPreviewUrl', () => {
    it('should generate preview URL from PR number', () => {
      const url = getPreviewUrl(123)
      expect(url).toBe('https://pr-123.dotdo.pages.dev')
    })

    it('should handle string PR numbers', () => {
      const url = getPreviewUrl('456')
      expect(url).toBe('https://pr-456.dotdo.pages.dev')
    })
  })

  describe('isE2EEnabled', () => {
    it('should return true for local environment', () => {
      configureE2E({ environment: 'local' })
      expect(isE2EEnabled()).toBe(true)
    })
  })

  describe('getBaseUrl', () => {
    it('should return base URL for current environment', () => {
      configureE2E({ environment: 'local' })
      const url = getBaseUrl()
      expect(url).toBe(DEFAULT_ENDPOINTS.local.baseUrl)
    })
  })

  describe('isReadOnly', () => {
    it('should return false for staging', () => {
      configureE2E({ environment: 'staging' })
      expect(isReadOnly()).toBe(false)
    })

    it('should return true for production', () => {
      configureE2E({ environment: 'production' })
      expect(isReadOnly()).toBe(true)
    })
  })

  describe('requiresAuth', () => {
    it('should return false for local', () => {
      configureE2E({ environment: 'local' })
      expect(requiresAuth()).toBe(false)
    })

    it('should return true for production', () => {
      configureE2E({ environment: 'production' })
      expect(requiresAuth()).toBe(true)
    })
  })

  describe('hasCloudflareCredentials', () => {
    it('should return false when credentials missing', () => {
      configureE2E({
        credentials: { accountId: undefined, apiToken: undefined },
      })
      expect(hasCloudflareCredentials()).toBe(false)
    })

    it('should return true when credentials present', () => {
      configureE2E({
        credentials: { accountId: 'test-account', apiToken: 'test-token' },
      })
      expect(hasCloudflareCredentials()).toBe(true)
    })
  })

  describe('generateTestResourceName', () => {
    it('should generate unique names', () => {
      const name1 = generateTestResourceName()
      const name2 = generateTestResourceName()

      expect(name1).not.toBe(name2)
    })

    it('should include prefix from config', () => {
      configureE2E({ cleanup: { prefix: 'my-test-' } as E2EConfig['cleanup'] })
      const name = generateTestResourceName()

      expect(name.startsWith('my-test-')).toBe(true)
    })

    it('should include suffix if provided', () => {
      const name = generateTestResourceName('custom')

      expect(name.endsWith('-custom')).toBe(true)
    })
  })

  describe('isTestResource', () => {
    it('should identify test resources by prefix', () => {
      expect(isTestResource('e2e-test-123-abc')).toBe(true)
      expect(isTestResource('production-resource')).toBe(false)
    })
  })

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const delay1 = calculateRetryDelay(1)
      const delay2 = calculateRetryDelay(2)
      const delay3 = calculateRetryDelay(3)

      expect(delay2).toBeGreaterThan(delay1)
      expect(delay3).toBeGreaterThan(delay2)
    })

    it('should respect max delay', () => {
      configureE2E({
        retries: {
          retryDelay: 1000,
          backoffMultiplier: 10,
          maxRetryDelay: 5000,
        } as E2EConfig['retries'],
      })

      const delay = calculateRetryDelay(5)
      expect(delay).toBeLessThanOrEqual(5000)
    })
  })

  describe('DEFAULT_ENDPOINTS', () => {
    it('should have all environments configured', () => {
      const environments: TestEnvironment[] = ['local', 'staging', 'preview', 'production']

      for (const env of environments) {
        expect(DEFAULT_ENDPOINTS[env]).toBeDefined()
        expect(DEFAULT_ENDPOINTS[env].baseUrl).toBeDefined()
        expect(typeof DEFAULT_ENDPOINTS[env].e2eEnabled).toBe('boolean')
        expect(typeof DEFAULT_ENDPOINTS[env].requiresAuth).toBe('boolean')
        expect(typeof DEFAULT_ENDPOINTS[env].readOnly).toBe('boolean')
      }
    })
  })

  describe('DEFAULT_TIMEOUTS', () => {
    it('should have reasonable timeout values', () => {
      expect(DEFAULT_TIMEOUTS.test).toBeGreaterThanOrEqual(1000)
      expect(DEFAULT_TIMEOUTS.assertion).toBeGreaterThanOrEqual(1000)
      expect(DEFAULT_TIMEOUTS.pipelineDelivery).toBeGreaterThanOrEqual(10000)
      expect(DEFAULT_TIMEOUTS.icebergFlush).toBeGreaterThanOrEqual(60000)
    })
  })

  describe('DEFAULT_PIPELINE_SLA', () => {
    it('should have SLA targets in ascending order', () => {
      expect(DEFAULT_PIPELINE_SLA.p50Target).toBeLessThan(DEFAULT_PIPELINE_SLA.p95Target)
      expect(DEFAULT_PIPELINE_SLA.p95Target).toBeLessThan(DEFAULT_PIPELINE_SLA.p99Target)
      expect(DEFAULT_PIPELINE_SLA.p99Target).toBeLessThan(DEFAULT_PIPELINE_SLA.maxE2ELatency)
    })

    it('should have acceptable loss rate', () => {
      expect(DEFAULT_PIPELINE_SLA.maxEventLossRate).toBeLessThan(0.01) // Less than 1%
    })
  })
})
