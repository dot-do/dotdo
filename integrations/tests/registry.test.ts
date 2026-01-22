// Integration Registry Tests
// Tests for the central integration registry (do-ke7g)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  IntegrationRegistry,
  IntegrationRegistryError,
  registerIntegration,
  getIntegration,
  integrationRegistry,
  successResult,
  errorResult,
  type ListIntegrationsOptions,
  type IntegrationSummary,
} from '../registry'
import type {
  Integration,
  IntegrationConfig,
  IntegrationMetadata,
  IntegrationStatus,
  IntegrationFactory,
  IntegrationResult,
} from '../types'

/**
 * Create a mock integration for testing
 * This follows NO MOCKS philosophy - we create real implementations
 */
function createTestIntegration(
  name: string,
  options: {
    category?: IntegrationMetadata['category']
    version?: string
    initThrows?: boolean
    shutdownThrows?: boolean
    healthCheckResult?: boolean | Error
  } = {}
): Integration {
  let status: IntegrationStatus = 'uninitialized'
  let config: IntegrationConfig | null = null

  return {
    name,
    version: options.version ?? '1.0.0',
    get status() {
      return status
    },
    metadata: {
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      description: `Test integration: ${name}`,
      category: options.category ?? 'other',
      requiredConfig: ['apiKey'],
      optionalConfig: ['timeout'],
    },
    async init(cfg: IntegrationConfig) {
      if (options.initThrows) {
        status = 'error'
        throw new Error(`Init failed for ${name}`)
      }
      config = cfg
      status = 'ready'
    },
    async shutdown() {
      if (options.shutdownThrows) {
        throw new Error(`Shutdown failed for ${name}`)
      }
      config = null
      status = 'uninitialized'
    },
    async healthCheck() {
      if (options.healthCheckResult instanceof Error) {
        throw options.healthCheckResult
      }
      return options.healthCheckResult ?? status === 'ready'
    },
    methods: {
      async testMethod(): Promise<IntegrationResult> {
        if (status !== 'ready') {
          return errorResult('NOT_READY', 'Integration not ready')
        }
        return successResult({ tested: true })
      },
    },
  }
}

/**
 * Create a factory function for an integration
 */
function createTestFactory(
  name: string,
  options: Parameters<typeof createTestIntegration>[1] = {}
): IntegrationFactory {
  return () => createTestIntegration(name, options)
}

describe('IntegrationRegistry', () => {
  let registry: IntegrationRegistry

  beforeEach(() => {
    registry = new IntegrationRegistry()
  })

  describe('register', () => {
    it('should register an integration instance', () => {
      const integration = createTestIntegration('test-service')
      registry.register(integration)

      expect(registry.has('test-service')).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('should register an integration factory', () => {
      const factory = createTestFactory('test-factory')
      registry.register(factory)

      expect(registry.has('test-factory')).toBe(true)
      expect(registry.get('test-factory')).toBeDefined()
    })

    it('should throw when registering duplicate integration', () => {
      const integration = createTestIntegration('duplicate')
      registry.register(integration)

      expect(() => registry.register(integration)).toThrow(IntegrationRegistryError)
      expect(() => registry.register(integration)).toThrow('already registered')
    })

    it('should set default options when not provided', () => {
      const integration = createTestIntegration('default-options')
      registry.register(integration)

      // Internal verification through list
      const summaries = registry.list()
      expect(summaries).toHaveLength(1)
    })

    it('should accept custom registration options', () => {
      const integration = createTestIntegration('custom-options')
      registry.register(integration, { autoInit: true, priority: 50 })

      expect(registry.has('custom-options')).toBe(true)
    })
  })

  describe('unregister', () => {
    it('should unregister an integration', async () => {
      const integration = createTestIntegration('to-unregister')
      registry.register(integration)
      expect(registry.has('to-unregister')).toBe(true)

      await registry.unregister('to-unregister')
      expect(registry.has('to-unregister')).toBe(false)
      expect(registry.size).toBe(0)
    })

    it('should shutdown integration before unregistering', async () => {
      const integration = createTestIntegration('with-shutdown')
      registry.register(integration)
      await registry.init('with-shutdown', { apiKey: 'test-key' })
      expect(integration.status).toBe('ready')

      await registry.unregister('with-shutdown')
      expect(integration.status).toBe('uninitialized')
    })

    it('should throw when unregistering non-existent integration', async () => {
      await expect(registry.unregister('non-existent')).rejects.toThrow(IntegrationRegistryError)
      await expect(registry.unregister('non-existent')).rejects.toThrow('not registered')

      try {
        await registry.unregister('non-existent')
      } catch (error) {
        expect(error).toBeInstanceOf(IntegrationRegistryError)
        expect((error as IntegrationRegistryError).code).toBe('NOT_REGISTERED')
      }
    })

    it('should clean up factory reference', async () => {
      const factory = createTestFactory('factory-cleanup')
      registry.register(factory)
      await registry.unregister('factory-cleanup')

      // Re-registering should work (proving the factory was cleaned up)
      registry.register(factory)
      expect(registry.has('factory-cleanup')).toBe(true)
    })
  })

  describe('get', () => {
    it('should get a registered integration', () => {
      const integration = createTestIntegration('get-test')
      registry.register(integration)

      const retrieved = registry.get('get-test')
      expect(retrieved).toBe(integration)
    })

    it('should return undefined for non-existent integration', () => {
      const retrieved = registry.get('non-existent')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('getOrThrow', () => {
    it('should get a registered integration', () => {
      const integration = createTestIntegration('get-or-throw-test')
      registry.register(integration)

      const retrieved = registry.getOrThrow('get-or-throw-test')
      expect(retrieved).toBe(integration)
    })

    it('should throw for non-existent integration', () => {
      expect(() => registry.getOrThrow('non-existent')).toThrow(IntegrationRegistryError)
      expect(() => registry.getOrThrow('non-existent')).toThrow('not registered')

      try {
        registry.getOrThrow('non-existent')
      } catch (error) {
        expect(error).toBeInstanceOf(IntegrationRegistryError)
        expect((error as IntegrationRegistryError).code).toBe('NOT_REGISTERED')
      }
    })
  })

  describe('has', () => {
    it('should return true for registered integration', () => {
      registry.register(createTestIntegration('exists'))
      expect(registry.has('exists')).toBe(true)
    })

    it('should return false for non-existent integration', () => {
      expect(registry.has('does-not-exist')).toBe(false)
    })
  })

  describe('init', () => {
    it('should initialize an integration with config', async () => {
      const integration = createTestIntegration('init-test')
      registry.register(integration)

      await registry.init('init-test', { apiKey: 'test-key' })
      expect(integration.status).toBe('ready')
    })

    it('should throw for non-existent integration', async () => {
      await expect(registry.init('non-existent', { apiKey: 'key' })).rejects.toThrow(
        IntegrationRegistryError
      )
    })

    it('should propagate init errors', async () => {
      const integration = createTestIntegration('init-fails', { initThrows: true })
      registry.register(integration)

      await expect(registry.init('init-fails', { apiKey: 'key' })).rejects.toThrow(
        'Init failed for init-fails'
      )
      expect(integration.status).toBe('error')
    })
  })

  describe('initAll', () => {
    it('should initialize multiple integrations with Map', async () => {
      registry.register(createTestIntegration('service-a'))
      registry.register(createTestIntegration('service-b'))

      const configs = new Map<string, IntegrationConfig>([
        ['service-a', { apiKey: 'key-a' }],
        ['service-b', { apiKey: 'key-b' }],
      ])

      const results = await registry.initAll(configs)
      expect(results.get('service-a')).toBeNull()
      expect(results.get('service-b')).toBeNull()
    })

    it('should initialize multiple integrations with Record', async () => {
      registry.register(createTestIntegration('service-c'))
      registry.register(createTestIntegration('service-d'))

      const configs: Record<string, IntegrationConfig> = {
        'service-c': { apiKey: 'key-c' },
        'service-d': { apiKey: 'key-d' },
      }

      const results = await registry.initAll(configs)
      expect(results.get('service-c')).toBeNull()
      expect(results.get('service-d')).toBeNull()
    })

    it('should capture errors without stopping other initializations', async () => {
      registry.register(createTestIntegration('good-service'))
      registry.register(createTestIntegration('bad-service', { initThrows: true }))

      const configs = new Map<string, IntegrationConfig>([
        ['good-service', { apiKey: 'key' }],
        ['bad-service', { apiKey: 'key' }],
      ])

      const results = await registry.initAll(configs)
      expect(results.get('good-service')).toBeNull()
      expect(results.get('bad-service')).toBeInstanceOf(Error)
    })

    it('should initialize in priority order', async () => {
      const initOrder: string[] = []

      const createTrackedIntegration = (name: string): Integration => {
        const integration = createTestIntegration(name)
        const originalInit = integration.init.bind(integration)
        integration.init = async (config: IntegrationConfig) => {
          initOrder.push(name)
          return originalInit(config)
        }
        return integration
      }

      registry.register(createTrackedIntegration('low-priority'), { priority: 100 })
      registry.register(createTrackedIntegration('high-priority'), { priority: 10 })
      registry.register(createTrackedIntegration('medium-priority'), { priority: 50 })

      const configs = new Map<string, IntegrationConfig>([
        ['low-priority', { apiKey: 'key' }],
        ['high-priority', { apiKey: 'key' }],
        ['medium-priority', { apiKey: 'key' }],
      ])

      await registry.initAll(configs)
      expect(initOrder).toEqual(['high-priority', 'medium-priority', 'low-priority'])
    })

    it('should skip autoInit integrations without config', async () => {
      const integration = createTestIntegration('auto-init-no-config')
      registry.register(integration, { autoInit: true })

      const results = await registry.initAll(new Map())
      // Should not have initialized (no config provided)
      expect(results.has('auto-init-no-config')).toBe(false)
      expect(integration.status).toBe('uninitialized')
    })
  })

  describe('list', () => {
    beforeEach(() => {
      registry.register(createTestIntegration('payments-service', { category: 'payments' }))
      registry.register(createTestIntegration('email-service', { category: 'email' }))
      registry.register(createTestIntegration('storage-service', { category: 'storage' }))
    })

    it('should list all integrations', () => {
      const summaries = registry.list()
      expect(summaries).toHaveLength(3)
    })

    it('should filter by single status', async () => {
      await registry.init('payments-service', { apiKey: 'key' })

      const readySummaries = registry.list({ status: 'ready' })
      expect(readySummaries).toHaveLength(1)
      expect(readySummaries[0].name).toBe('payments-service')

      const uninitSummaries = registry.list({ status: 'uninitialized' })
      expect(uninitSummaries).toHaveLength(2)
    })

    it('should filter by multiple statuses', async () => {
      await registry.init('payments-service', { apiKey: 'key' })

      const summaries = registry.list({ status: ['ready', 'uninitialized'] })
      expect(summaries).toHaveLength(3)
    })

    it('should filter by single category', () => {
      const summaries = registry.list({ category: 'payments' })
      expect(summaries).toHaveLength(1)
      expect(summaries[0].name).toBe('payments-service')
    })

    it('should filter by multiple categories', () => {
      const summaries = registry.list({ category: ['payments', 'email'] })
      expect(summaries).toHaveLength(2)
    })

    it('should filter by initializedOnly', async () => {
      await registry.init('email-service', { apiKey: 'key' })

      const summaries = registry.list({ initializedOnly: true })
      expect(summaries).toHaveLength(1)
      expect(summaries[0].name).toBe('email-service')
    })

    it('should return correct summary structure', () => {
      const summaries = registry.list()
      const summary = summaries.find((s) => s.name === 'payments-service')

      expect(summary).toBeDefined()
      expect(summary!.version).toBe('1.0.0')
      expect(summary!.displayName).toBe('Payments-service')
      expect(summary!.category).toBe('payments')
      expect(summary!.status).toBe('uninitialized')
      expect(summary!.description).toContain('payments-service')
    })
  })

  describe('getByCategory', () => {
    beforeEach(() => {
      registry.register(createTestIntegration('stripe', { category: 'payments' }))
      registry.register(createTestIntegration('paypal', { category: 'payments' }))
      registry.register(createTestIntegration('sendgrid', { category: 'email' }))
    })

    it('should return integrations by category', () => {
      const payments = registry.getByCategory('payments')
      expect(payments).toHaveLength(2)
      expect(payments.map((i) => i.name)).toEqual(['stripe', 'paypal'])
    })

    it('should return empty array for non-existent category', () => {
      const ai = registry.getByCategory('ai')
      expect(ai).toHaveLength(0)
    })
  })

  describe('healthCheck', () => {
    it('should return false for non-ready integrations', async () => {
      registry.register(createTestIntegration('not-ready'))

      const results = await registry.healthCheck()
      expect(results.get('not-ready')).toBe(false)
    })

    it('should return true for healthy ready integrations', async () => {
      registry.register(createTestIntegration('healthy'))
      await registry.init('healthy', { apiKey: 'key' })

      const results = await registry.healthCheck()
      expect(results.get('healthy')).toBe(true)
    })

    it('should return health check result from integration', async () => {
      registry.register(createTestIntegration('unhealthy', { healthCheckResult: false }))
      await registry.init('unhealthy', { apiKey: 'key' })

      const results = await registry.healthCheck()
      expect(results.get('unhealthy')).toBe(false)
    })

    it('should capture health check errors', async () => {
      const healthError = new Error('Health check failed')
      registry.register(createTestIntegration('error-health', { healthCheckResult: healthError }))
      await registry.init('error-health', { apiKey: 'key' })

      const results = await registry.healthCheck()
      expect(results.get('error-health')).toBeInstanceOf(Error)
      expect((results.get('error-health') as Error).message).toBe('Health check failed')
    })

    it('should assume healthy if no healthCheck method', async () => {
      const integration = createTestIntegration('no-health-check')
      // Remove healthCheck method
      delete (integration as any).healthCheck
      registry.register(integration)
      await registry.init('no-health-check', { apiKey: 'key' })

      const results = await registry.healthCheck()
      expect(results.get('no-health-check')).toBe(true)
    })
  })

  describe('shutdownAll', () => {
    it('should shutdown all integrations', async () => {
      const intA = createTestIntegration('shutdown-a')
      const intB = createTestIntegration('shutdown-b')
      registry.register(intA)
      registry.register(intB)
      await registry.init('shutdown-a', { apiKey: 'key' })
      await registry.init('shutdown-b', { apiKey: 'key' })

      const results = await registry.shutdownAll()
      expect(results.get('shutdown-a')).toBeNull()
      expect(results.get('shutdown-b')).toBeNull()
      expect(intA.status).toBe('uninitialized')
      expect(intB.status).toBe('uninitialized')
    })

    it('should shutdown in reverse priority order', async () => {
      const shutdownOrder: string[] = []

      const createTrackedIntegration = (name: string): Integration => {
        const integration = createTestIntegration(name)
        const originalShutdown = integration.shutdown!.bind(integration)
        integration.shutdown = async () => {
          shutdownOrder.push(name)
          return originalShutdown()
        }
        return integration
      }

      registry.register(createTrackedIntegration('first'), { priority: 10 })
      registry.register(createTrackedIntegration('second'), { priority: 50 })
      registry.register(createTrackedIntegration('third'), { priority: 100 })

      await registry.initAll(
        new Map([
          ['first', { apiKey: 'key' }],
          ['second', { apiKey: 'key' }],
          ['third', { apiKey: 'key' }],
        ])
      )

      await registry.shutdownAll()
      // Should shutdown in reverse order: third, second, first
      expect(shutdownOrder).toEqual(['third', 'second', 'first'])
    })

    it('should capture shutdown errors and continue', async () => {
      registry.register(createTestIntegration('good-shutdown'))
      registry.register(createTestIntegration('bad-shutdown', { shutdownThrows: true }))
      await registry.init('good-shutdown', { apiKey: 'key' })
      await registry.init('bad-shutdown', { apiKey: 'key' })

      const results = await registry.shutdownAll()
      expect(results.get('good-shutdown')).toBeNull()
      expect(results.get('bad-shutdown')).toBeInstanceOf(Error)
    })

    it('should skip integrations without shutdown method', async () => {
      const integration = createTestIntegration('no-shutdown')
      delete (integration as any).shutdown
      registry.register(integration)
      await registry.init('no-shutdown', { apiKey: 'key' })

      const results = await registry.shutdownAll()
      // Should not have an entry since there was no shutdown to perform
      expect(results.has('no-shutdown')).toBe(false)
    })
  })

  describe('size', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size).toBe(0)
    })

    it('should return correct count', () => {
      registry.register(createTestIntegration('one'))
      registry.register(createTestIntegration('two'))
      registry.register(createTestIntegration('three'))

      expect(registry.size).toBe(3)
    })
  })

  describe('names', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.names).toEqual([])
    })

    it('should return all integration names', () => {
      registry.register(createTestIntegration('alpha'))
      registry.register(createTestIntegration('beta'))

      expect(registry.names).toContain('alpha')
      expect(registry.names).toContain('beta')
    })
  })

  describe('clear', () => {
    it('should clear all registrations', () => {
      registry.register(createTestIntegration('to-clear-a'))
      registry.register(createTestFactory('to-clear-b'))
      expect(registry.size).toBe(2)

      registry.clear()
      expect(registry.size).toBe(0)
      expect(registry.names).toEqual([])
    })
  })
})

describe('IntegrationRegistryError', () => {
  it('should create error with all properties', () => {
    const error = new IntegrationRegistryError('Test message', 'TEST_CODE', 'test-integration')

    expect(error.message).toBe('Test message')
    expect(error.code).toBe('TEST_CODE')
    expect(error.integrationName).toBe('test-integration')
    expect(error.name).toBe('IntegrationRegistryError')
  })

  it('should create error without integration name', () => {
    const error = new IntegrationRegistryError('Test message', 'TEST_CODE')

    expect(error.message).toBe('Test message')
    expect(error.code).toBe('TEST_CODE')
    expect(error.integrationName).toBeUndefined()
  })
})

describe('Global registry convenience functions', () => {
  beforeEach(() => {
    integrationRegistry.clear()
  })

  describe('registerIntegration', () => {
    it('should register to global registry', () => {
      const integration = createTestIntegration('global-test')
      registerIntegration(integration)

      expect(integrationRegistry.has('global-test')).toBe(true)
    })

    it('should accept options', () => {
      const integration = createTestIntegration('global-with-options')
      registerIntegration(integration, { autoInit: true, priority: 25 })

      expect(integrationRegistry.has('global-with-options')).toBe(true)
    })
  })

  describe('getIntegration', () => {
    it('should get from global registry', () => {
      const integration = createTestIntegration('get-global')
      registerIntegration(integration)

      const retrieved = getIntegration('get-global')
      expect(retrieved).toBe(integration)
    })

    it('should return undefined for non-existent', () => {
      const retrieved = getIntegration('non-existent-global')
      expect(retrieved).toBeUndefined()
    })
  })
})

describe('Result helper functions', () => {
  describe('successResult', () => {
    it('should create success result with data', () => {
      const result = successResult({ id: 123, name: 'test' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ id: 123, name: 'test' })
      expect(result.error).toBeUndefined()
    })

    it('should include requestId when provided', () => {
      const result = successResult({ value: 'test' }, 'req_abc123')

      expect(result.success).toBe(true)
      expect(result.requestId).toBe('req_abc123')
    })

    it('should not include requestId when not provided', () => {
      const result = successResult({ value: 'test' })

      expect(result.requestId).toBeUndefined()
    })
  })

  describe('errorResult', () => {
    it('should create error result', () => {
      const result = errorResult('ERROR_CODE', 'Error message')

      expect(result.success).toBe(false)
      expect(result.error).toEqual({
        code: 'ERROR_CODE',
        message: 'Error message',
        originalError: undefined,
        retryable: false,
      })
    })

    it('should include original error', () => {
      const originalError = new Error('Original')
      const result = errorResult('ERROR_CODE', 'Error message', originalError)

      expect(result.error.originalError).toBe(originalError)
    })

    it('should set retryable flag', () => {
      const result = errorResult('RATE_LIMIT', 'Rate limited', undefined, true)

      expect(result.error.retryable).toBe(true)
    })
  })
})
