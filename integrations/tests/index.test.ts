// Integrations Package Exports Test
// Verifies all exports from @dotdo/integrations work correctly (do-yt69)

import { describe, it, expect } from 'vitest'

// Import all exports to verify they work
import {
  // Core types
  type Integration,
  type IntegrationConfig,
  type IntegrationStatus,
  type IntegrationMetadata,
  type IntegrationCategory,
  type IntegrationResult,
  type IntegrationError,
  type IntegrationEvent,
  type IntegrationWebhookHandler,
  type IntegrationMethods,
  type IntegrationFactory,
  type RegisterIntegrationOptions,
  type RegisteredIntegration,
  // Registry
  IntegrationRegistry,
  IntegrationRegistryError,
  integrationRegistry,
  registerIntegration,
  getIntegration,
  successResult,
  errorResult,
  type ListIntegrationsOptions,
  type IntegrationSummary,
  // Stripe
  StripeIntegration,
  createStripeIntegration,
  type StripeConfig,
  type StripeCustomer,
  type StripePaymentIntent,
  type StripeSubscription,
  type StripeMethods,
  // SendGrid
  SendGridIntegration,
  createSendGridIntegration,
  type SendGridConfig,
  type EmailRecipient,
  type EmailAttachment,
  type SendEmailRequest,
  type SendEmailResponse,
  type SendGridContact,
  type EmailStats,
  type SendGridMethods,
} from '../index'

describe('@dotdo/integrations exports', () => {
  describe('Registry exports', () => {
    it('should export IntegrationRegistry class', () => {
      expect(IntegrationRegistry).toBeDefined()
      expect(typeof IntegrationRegistry).toBe('function')
    })

    it('should export IntegrationRegistryError class', () => {
      expect(IntegrationRegistryError).toBeDefined()
      expect(typeof IntegrationRegistryError).toBe('function')

      // Constructor signature: (message, code, integrationName?)
      const error = new IntegrationRegistryError('Test message', 'TEST_ERROR')
      expect(error.code).toBe('TEST_ERROR')
      expect(error.message).toBe('Test message')
    })

    it('should export singleton integrationRegistry', () => {
      expect(integrationRegistry).toBeDefined()
      expect(integrationRegistry).toBeInstanceOf(IntegrationRegistry)
    })

    it('should export registerIntegration function', () => {
      expect(registerIntegration).toBeDefined()
      expect(typeof registerIntegration).toBe('function')
    })

    it('should export getIntegration function', () => {
      expect(getIntegration).toBeDefined()
      expect(typeof getIntegration).toBe('function')
    })

    it('should export successResult helper', () => {
      expect(successResult).toBeDefined()
      expect(typeof successResult).toBe('function')

      const result = successResult({ test: 'data' }, 'req_123')
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ test: 'data' })
      expect(result.requestId).toBe('req_123')
    })

    it('should export errorResult helper', () => {
      expect(errorResult).toBeDefined()
      expect(typeof errorResult).toBe('function')

      const result = errorResult('ERR_CODE', 'Error message')
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('ERR_CODE')
      expect(result.error?.message).toBe('Error message')
    })
  })

  describe('Stripe integration exports', () => {
    it('should export StripeIntegration class', () => {
      expect(StripeIntegration).toBeDefined()
      expect(typeof StripeIntegration).toBe('function')
    })

    it('should export createStripeIntegration factory', () => {
      expect(createStripeIntegration).toBeDefined()
      expect(typeof createStripeIntegration).toBe('function')

      const stripe = createStripeIntegration()
      expect(stripe).toBeInstanceOf(StripeIntegration)
      expect(stripe.name).toBe('stripe')
    })

    it('should create working Stripe integration instance', () => {
      const stripe = new StripeIntegration()
      expect(stripe.name).toBe('stripe')
      expect(stripe.version).toBe('1.0.0')
      expect(stripe.metadata.category).toBe('payments')
      expect(stripe.status).toBe('uninitialized')
    })
  })

  describe('SendGrid integration exports', () => {
    it('should export SendGridIntegration class', () => {
      expect(SendGridIntegration).toBeDefined()
      expect(typeof SendGridIntegration).toBe('function')
    })

    it('should export createSendGridIntegration factory', () => {
      expect(createSendGridIntegration).toBeDefined()
      expect(typeof createSendGridIntegration).toBe('function')

      const sendgrid = createSendGridIntegration()
      expect(sendgrid).toBeInstanceOf(SendGridIntegration)
      expect(sendgrid.name).toBe('sendgrid')
    })

    it('should create working SendGrid integration instance', () => {
      const sendgrid = new SendGridIntegration()
      expect(sendgrid.name).toBe('sendgrid')
      expect(sendgrid.version).toBe('1.0.0')
      expect(sendgrid.metadata.category).toBe('email')
      expect(sendgrid.status).toBe('uninitialized')
    })
  })

  describe('Integration type compatibility', () => {
    it('should satisfy Integration interface with StripeIntegration', async () => {
      const integration: Integration = new StripeIntegration()

      expect(integration.name).toBe('stripe')
      expect(integration.version).toBeDefined()
      expect(integration.metadata).toBeDefined()
      expect(integration.status).toBe('uninitialized')
      expect(typeof integration.init).toBe('function')
      expect(typeof integration.methods).toBe('object')
    })

    it('should satisfy Integration interface with SendGridIntegration', async () => {
      const integration: Integration = new SendGridIntegration()

      expect(integration.name).toBe('sendgrid')
      expect(integration.version).toBeDefined()
      expect(integration.metadata).toBeDefined()
      expect(integration.status).toBe('uninitialized')
      expect(typeof integration.init).toBe('function')
      expect(typeof integration.methods).toBe('object')
    })
  })

  describe('IntegrationResult helpers', () => {
    it('should create success result with requestId', () => {
      const result = successResult({ id: '123' }, 'req_abc')

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ id: '123' })
      expect(result.requestId).toBe('req_abc')
      expect(result.error).toBeUndefined()
    })

    it('should create error result with original error', () => {
      const originalError = new Error('Original')
      const result = errorResult('ORIGINAL_ERROR', 'Wrapped error', originalError)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('ORIGINAL_ERROR')
      expect(result.error?.message).toBe('Wrapped error')
      expect(result.error?.originalError).toBe(originalError)
      expect(result.data).toBeUndefined()
    })

    it('should support retryable flag in error result', () => {
      const result = errorResult('RATE_LIMIT', 'Too many requests', undefined, true)

      expect(result.success).toBe(false)
      expect(result.error?.retryable).toBe(true)
    })
  })

  describe('Registry integration', () => {
    it('should be able to register and retrieve integrations', async () => {
      // Create a fresh registry for this test
      const registry = new IntegrationRegistry()

      const stripe = createStripeIntegration()
      registry.register(stripe)

      const retrieved = registry.get('stripe')
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('stripe')

      // Cleanup
      registry.unregister('stripe')
    })

    it('should list integrations correctly', async () => {
      const registry = new IntegrationRegistry()

      registry.register(createStripeIntegration())
      registry.register(createSendGridIntegration())

      const list = registry.list()
      expect(list.length).toBeGreaterThanOrEqual(2)

      const names = list.map(i => i.name)
      expect(names).toContain('stripe')
      expect(names).toContain('sendgrid')

      // Cleanup
      registry.unregister('stripe')
      registry.unregister('sendgrid')
    })
  })
})
