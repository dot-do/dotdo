// Integration Types Tests
// Verifies type definitions have correct runtime behavior (do-yt69)

import { describe, it, expect } from 'vitest'
import type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationCategory,
  IntegrationResult,
  IntegrationError,
  IntegrationEvent,
  IntegrationWebhookHandler,
  IntegrationMethods,
  IntegrationFactory,
  RegisterIntegrationOptions,
  RegisteredIntegration,
} from '../types'
import { successResult, errorResult } from '../registry'

describe('Integration Types Runtime Behavior', () => {
  describe('IntegrationConfig', () => {
    it('should accept all standard config properties', () => {
      const config: IntegrationConfig = {
        apiKey: 'test-api-key',
        secretKey: 'test-secret',
        apiVersion: '2024-01-01',
        baseUrl: 'https://api.example.com',
        environment: 'sandbox',
        timeout: 30000,
      }

      expect(config.apiKey).toBe('test-api-key')
      expect(config.secretKey).toBe('test-secret')
      expect(config.apiVersion).toBe('2024-01-01')
      expect(config.environment).toBe('sandbox')
      expect(config.timeout).toBe(30000)
    })

    it('should allow additional service-specific properties', () => {
      const config: IntegrationConfig = {
        apiKey: 'test-key',
        customProperty: 'custom-value',
        numericSetting: 42,
        nestedConfig: { nested: true },
      }

      expect(config.customProperty).toBe('custom-value')
      expect(config.numericSetting).toBe(42)
      expect(config.nestedConfig).toEqual({ nested: true })
    })

    it('should support all environment types', () => {
      const environments: IntegrationConfig['environment'][] = [
        'production',
        'sandbox',
        'test',
      ]

      environments.forEach(env => {
        const config: IntegrationConfig = { environment: env }
        expect(['production', 'sandbox', 'test']).toContain(config.environment)
      })
    })
  })

  describe('IntegrationStatus', () => {
    it('should include all valid status values', () => {
      const statuses: IntegrationStatus[] = [
        'uninitialized',
        'initializing',
        'ready',
        'error',
        'disabled',
      ]

      expect(statuses).toContain('uninitialized')
      expect(statuses).toContain('initializing')
      expect(statuses).toContain('ready')
      expect(statuses).toContain('error')
      expect(statuses).toContain('disabled')
    })
  })

  describe('IntegrationCategory', () => {
    it('should include all defined categories', () => {
      const categories: IntegrationCategory[] = [
        'payments',
        'email',
        'sms',
        'storage',
        'database',
        'analytics',
        'auth',
        'ai',
        'messaging',
        'crm',
        'logging',
        'monitoring',
        'other',
      ]

      expect(categories.length).toBe(13)
      expect(categories).toContain('payments')
      expect(categories).toContain('email')
      expect(categories).toContain('storage')
      expect(categories).toContain('ai')
    })
  })

  describe('IntegrationMetadata', () => {
    it('should require all mandatory fields', () => {
      const metadata: IntegrationMetadata = {
        displayName: 'Test Integration',
        description: 'A test integration for validation',
        category: 'other',
        requiredConfig: ['apiKey'],
      }

      expect(metadata.displayName).toBe('Test Integration')
      expect(metadata.description).toBeDefined()
      expect(metadata.category).toBe('other')
      expect(metadata.requiredConfig).toContain('apiKey')
    })

    it('should accept optional fields', () => {
      const metadata: IntegrationMetadata = {
        displayName: 'Full Integration',
        description: 'With all optional fields',
        category: 'payments',
        docsUrl: 'https://docs.example.com',
        websiteUrl: 'https://example.com',
        requiredConfig: ['apiKey', 'secretKey'],
        optionalConfig: ['webhookSecret', 'environment'],
      }

      expect(metadata.docsUrl).toBe('https://docs.example.com')
      expect(metadata.websiteUrl).toBe('https://example.com')
      expect(metadata.optionalConfig).toContain('webhookSecret')
    })
  })

  describe('IntegrationResult', () => {
    it('should create valid success result', () => {
      const result: IntegrationResult<{ id: string }> = successResult(
        { id: 'test-123' },
        'req_abc'
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('test-123')
      }
      expect(result.requestId).toBe('req_abc')
      expect(result.error).toBeUndefined()
    })

    it('should create valid error result', () => {
      const result: IntegrationResult<string> = errorResult(
        'NOT_FOUND',
        'Resource not found'
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toBe('Resource not found')
      }
      expect(result.data).toBeUndefined()
    })

    it('should handle generic types correctly', () => {
      interface CustomData {
        items: string[]
        count: number
      }

      const result: IntegrationResult<CustomData> = successResult({
        items: ['a', 'b', 'c'],
        count: 3,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.items).toHaveLength(3)
        expect(result.data.count).toBe(3)
      }
    })

    it('should create result with requestId', () => {
      const result = successResult({ test: true }, 'req_123')

      expect(result.requestId).toBe('req_123')
    })
  })

  describe('IntegrationError', () => {
    it('should have required error fields', () => {
      const error: IntegrationError = {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      }

      expect(error.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(error.message).toBeDefined()
    })

    it('should accept optional error fields', () => {
      const originalError = new Error('Network timeout')
      const error: IntegrationError = {
        code: 'NETWORK_ERROR',
        message: 'Request failed due to network issues',
        originalError,
        retryable: true,
      }

      expect(error.originalError).toBe(originalError)
      expect(error.retryable).toBe(true)
    })
  })

  describe('IntegrationEvent', () => {
    it('should have all required event fields', () => {
      const event: IntegrationEvent = {
        integration: 'stripe',
        type: 'payment.succeeded',
        payload: { paymentId: 'pi_123', amount: 1000 },
        timestamp: new Date(),
      }

      expect(event.integration).toBe('stripe')
      expect(event.type).toBe('payment.succeeded')
      expect(event.payload).toHaveProperty('paymentId')
      expect(event.timestamp).toBeInstanceOf(Date)
    })

    it('should accept optional webhookId', () => {
      const event: IntegrationEvent = {
        integration: 'sendgrid',
        type: 'email.delivered',
        payload: { messageId: 'msg_123' },
        timestamp: new Date(),
        webhookId: 'wh_event_456',
      }

      expect(event.webhookId).toBe('wh_event_456')
    })

    it('should accept typed payload', () => {
      interface PaymentPayload {
        id: string
        amount: number
        currency: string
      }

      const event: IntegrationEvent<PaymentPayload> = {
        integration: 'stripe',
        type: 'payment.created',
        payload: { id: 'pi_123', amount: 5000, currency: 'usd' },
        timestamp: new Date(),
      }

      expect(event.payload.id).toBe('pi_123')
      expect(event.payload.amount).toBe(5000)
      expect(event.payload.currency).toBe('usd')
    })
  })

  describe('IntegrationWebhookHandler', () => {
    it('should be callable with IntegrationEvent', async () => {
      const receivedEvents: IntegrationEvent[] = []

      const handler: IntegrationWebhookHandler = async (event) => {
        receivedEvents.push(event)
      }

      const testEvent: IntegrationEvent = {
        integration: 'test',
        type: 'test.event',
        payload: { test: true },
        timestamp: new Date(),
      }

      await handler(testEvent)

      expect(receivedEvents).toHaveLength(1)
      expect(receivedEvents[0]).toBe(testEvent)
    })

    it('should support synchronous handlers', () => {
      let handlerCalled = false

      const handler: IntegrationWebhookHandler = (event) => {
        handlerCalled = true
      }

      handler({
        integration: 'test',
        type: 'sync.event',
        payload: null,
        timestamp: new Date(),
      })

      expect(handlerCalled).toBe(true)
    })
  })

  describe('RegisterIntegrationOptions', () => {
    it('should accept all option fields', () => {
      const options: RegisterIntegrationOptions = {
        autoInit: true,
        priority: 10,
      }

      expect(options.autoInit).toBe(true)
      expect(options.priority).toBe(10)
    })

    it('should allow partial options', () => {
      const optionsAutoInitOnly: RegisterIntegrationOptions = {
        autoInit: false,
      }

      const optionsPriorityOnly: RegisterIntegrationOptions = {
        priority: 5,
      }

      const emptyOptions: RegisterIntegrationOptions = {}

      expect(optionsAutoInitOnly.autoInit).toBe(false)
      expect(optionsPriorityOnly.priority).toBe(5)
      expect(Object.keys(emptyOptions)).toHaveLength(0)
    })
  })

  describe('Mock Integration implementation', () => {
    it('should be possible to create a minimal integration', () => {
      // Minimal mock implementation to verify interface completeness
      class MockIntegration implements Integration {
        readonly name = 'mock'
        readonly version = '0.0.1'
        readonly metadata: IntegrationMetadata = {
          displayName: 'Mock',
          description: 'A mock integration for testing',
          category: 'other',
          requiredConfig: [],
        }

        private _status: IntegrationStatus = 'uninitialized'

        get status(): IntegrationStatus {
          return this._status
        }

        async init(config: IntegrationConfig): Promise<void> {
          this._status = 'ready'
        }

        readonly methods: IntegrationMethods = {
          testMethod: async () => successResult({ test: true }),
        }
      }

      const mock = new MockIntegration()
      expect(mock.name).toBe('mock')
      expect(mock.status).toBe('uninitialized')
      expect(typeof mock.methods.testMethod).toBe('function')
    })

    it('should support optional interface methods', async () => {
      class FullIntegration implements Integration {
        readonly name = 'full'
        readonly version = '1.0.0'
        readonly metadata: IntegrationMetadata = {
          displayName: 'Full',
          description: 'Integration with all optional methods',
          category: 'other',
          requiredConfig: [],
        }

        private _status: IntegrationStatus = 'uninitialized'

        get status(): IntegrationStatus {
          return this._status
        }

        async init(config: IntegrationConfig): Promise<void> {
          this._status = 'ready'
        }

        async shutdown(): Promise<void> {
          this._status = 'uninitialized'
        }

        async healthCheck(): Promise<boolean> {
          return this._status === 'ready'
        }

        readonly methods: IntegrationMethods = {}

        async handleWebhook(request: Request): Promise<Response> {
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        private handlers: IntegrationWebhookHandler[] = []

        onEvent(handler: IntegrationWebhookHandler): void {
          this.handlers.push(handler)
        }
      }

      const full = new FullIntegration()
      await full.init({})
      expect(full.status).toBe('ready')
      expect(await full.healthCheck!()).toBe(true)

      await full.shutdown!()
      expect(full.status).toBe('uninitialized')
    })
  })
})
