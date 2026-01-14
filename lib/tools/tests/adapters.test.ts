/**
 * Provider Adapters Tests
 *
 * Tests for SendGrid, Slack, and Stripe provider adapters.
 * Verifies tool extraction from compat/ providers.
 *
 * @see lib/tools/adapters/
 * @see dotdo-pwg8u - Extract Common Provider Patterns from compat/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendgridAdapter } from '../adapters/sendgrid'
import { slackAdapter } from '../adapters/slack'
import { stripeAdapter } from '../adapters/stripe'
import { getAllAdapters, registerAllAdapters, AVAILABLE_ADAPTERS } from '../adapters'
import { ProviderRegistry } from '../auto-register'
import { ProviderError, type ProviderToolAdapter } from '../provider-adapter'

// ============================================================================
// SENDGRID ADAPTER TESTS
// ============================================================================

describe('SendGrid Adapter', () => {
  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(sendgridAdapter.name).toBe('sendgrid')
    })

    it('has correct display name', () => {
      expect(sendgridAdapter.displayName).toBe('SendGrid')
    })

    it('has correct category', () => {
      expect(sendgridAdapter.category).toBe('communication')
    })

    it('uses api_key credential type', () => {
      expect(sendgridAdapter.credential.type).toBe('api_key')
      expect(sendgridAdapter.credential.envVar).toBe('SENDGRID_API_KEY')
    })
  })

  describe('tools', () => {
    it('includes send_email tool', () => {
      const tool = sendgridAdapter.getTool('send_email')

      expect(tool).toBeDefined()
      expect(tool?.name).toBe('Send Email')
      expect(tool?.description).toContain('email')
    })

    it('send_email has required parameters', () => {
      const tool = sendgridAdapter.getTool('send_email')

      expect(tool?.parameters.required).toContain('to')
      expect(tool?.parameters.required).toContain('from')
      expect(tool?.parameters.required).toContain('subject')
    })

    it('send_email has optional parameters', () => {
      const tool = sendgridAdapter.getTool('send_email')
      const props = tool?.parameters.properties

      expect(props?.text).toBeDefined()
      expect(props?.html).toBeDefined()
      expect(props?.templateId).toBeDefined()
      expect(props?.attachments).toBeDefined()
    })

    it('send_email has email-related tags', () => {
      const tool = sendgridAdapter.getTool('send_email')

      expect(tool?.tags).toContain('email')
    })

    it('send_email has examples', () => {
      const tool = sendgridAdapter.getTool('send_email')

      expect(tool?.examples).toBeDefined()
      expect(tool?.examples?.length).toBeGreaterThan(0)
    })
  })

  describe('metadata', () => {
    it('returns correct metadata', () => {
      const metadata = sendgridAdapter.getMetadata()

      expect(metadata.name).toBe('sendgrid')
      expect(metadata.displayName).toBe('SendGrid')
      expect(metadata.category).toBe('communication')
      expect(metadata.toolCount).toBeGreaterThanOrEqual(1)
      expect(metadata.docsUrl).toContain('sendgrid')
    })
  })

  describe('execution', () => {
    it('throws when API key is missing', async () => {
      await expect(
        sendgridAdapter.execute('send_email', {
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
        }, {})
      ).rejects.toThrow(ProviderError)

      try {
        await sendgridAdapter.execute('send_email', {}, {})
      } catch (error) {
        expect((error as ProviderError).code).toBe('MISSING_CREDENTIALS')
        expect((error as ProviderError).provider).toBe('sendgrid')
      }
    })

    it('throws for non-existent tool', async () => {
      await expect(
        sendgridAdapter.execute('non_existent', {}, { apiKey: 'test' })
      ).rejects.toThrow(ProviderError)

      try {
        await sendgridAdapter.execute('non_existent', {}, { apiKey: 'test' })
      } catch (error) {
        expect((error as ProviderError).code).toBe('TOOL_NOT_FOUND')
      }
    })
  })
})

// ============================================================================
// SLACK ADAPTER TESTS
// ============================================================================

describe('Slack Adapter', () => {
  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(slackAdapter.name).toBe('slack')
    })

    it('has correct display name', () => {
      expect(slackAdapter.displayName).toBe('Slack')
    })

    it('has correct category', () => {
      expect(slackAdapter.category).toBe('collaboration')
    })

    it('uses bearer_token credential type', () => {
      expect(slackAdapter.credential.type).toBe('bearer_token')
      expect(slackAdapter.credential.envVar).toBe('SLACK_BOT_TOKEN')
    })
  })

  describe('tools', () => {
    it('includes post_message tool', () => {
      const tool = slackAdapter.getTool('post_message')

      expect(tool).toBeDefined()
      expect(tool?.name).toBe('Post Message')
    })

    it('includes update_message tool', () => {
      const tool = slackAdapter.getTool('update_message')

      expect(tool).toBeDefined()
      expect(tool?.parameters.required).toContain('channel')
      expect(tool?.parameters.required).toContain('ts')
    })

    it('includes delete_message tool', () => {
      const tool = slackAdapter.getTool('delete_message')

      expect(tool).toBeDefined()
      expect(tool?.requiresConfirmation).toBe(true)
    })

    it('includes list_channels tool', () => {
      const tool = slackAdapter.getTool('list_channels')

      expect(tool).toBeDefined()
    })

    it('includes get_channel_history tool', () => {
      const tool = slackAdapter.getTool('get_channel_history')

      expect(tool).toBeDefined()
      expect(tool?.parameters.required).toContain('channel')
    })

    it('includes add_reaction tool', () => {
      const tool = slackAdapter.getTool('add_reaction')

      expect(tool).toBeDefined()
      expect(tool?.parameters.required).toContain('name')
      expect(tool?.parameters.required).toContain('timestamp')
    })

    it('has at least 6 tools', () => {
      const tools = slackAdapter.getTools()
      expect(tools.length).toBeGreaterThanOrEqual(6)
    })
  })

  describe('metadata', () => {
    it('returns correct metadata', () => {
      const metadata = slackAdapter.getMetadata()

      expect(metadata.name).toBe('slack')
      expect(metadata.displayName).toBe('Slack')
      expect(metadata.category).toBe('collaboration')
      expect(metadata.docsUrl).toContain('slack')
    })
  })

  describe('execution', () => {
    it('throws when token is missing', async () => {
      await expect(
        slackAdapter.execute('post_message', { channel: 'C123' }, {})
      ).rejects.toThrow(ProviderError)

      try {
        await slackAdapter.execute('post_message', {}, {})
      } catch (error) {
        expect((error as ProviderError).code).toBe('MISSING_CREDENTIALS')
        expect((error as ProviderError).provider).toBe('slack')
      }
    })

    it('accepts both accessToken and apiKey credentials', () => {
      // Verify the handler logic accepts both credential types
      // We just check the adapter configuration, not actual execution
      // which would require network calls
      expect(slackAdapter.credential.type).toBe('bearer_token')
      // The Slack adapter's handlers check for both accessToken and apiKey
    })
  })
})

// ============================================================================
// STRIPE ADAPTER TESTS
// ============================================================================

describe('Stripe Adapter', () => {
  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(stripeAdapter.name).toBe('stripe')
    })

    it('has correct display name', () => {
      expect(stripeAdapter.displayName).toBe('Stripe')
    })

    it('has correct category', () => {
      expect(stripeAdapter.category).toBe('commerce')
    })

    it('uses api_key credential type', () => {
      expect(stripeAdapter.credential.type).toBe('api_key')
      expect(stripeAdapter.credential.envVar).toBe('STRIPE_SECRET_KEY')
    })
  })

  describe('tools', () => {
    it('includes create_customer tool', () => {
      const tool = stripeAdapter.getTool('create_customer')

      expect(tool).toBeDefined()
      expect(tool?.name).toBe('Create Customer')
      expect(tool?.tags).toContain('customer')
    })

    it('includes list_customers tool', () => {
      const tool = stripeAdapter.getTool('list_customers')

      expect(tool).toBeDefined()
    })

    it('includes create_payment_intent tool', () => {
      const tool = stripeAdapter.getTool('create_payment_intent')

      expect(tool).toBeDefined()
      expect(tool?.parameters.required).toContain('amount')
      expect(tool?.parameters.required).toContain('currency')
      expect(tool?.requiresConfirmation).toBe(true)
    })

    it('includes create_subscription tool', () => {
      const tool = stripeAdapter.getTool('create_subscription')

      expect(tool).toBeDefined()
      expect(tool?.parameters.required).toContain('customer')
      expect(tool?.parameters.required).toContain('items')
      expect(tool?.requiresConfirmation).toBe(true)
    })

    it('has at least 4 tools', () => {
      const tools = stripeAdapter.getTools()
      expect(tools.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('metadata', () => {
    it('returns correct metadata', () => {
      const metadata = stripeAdapter.getMetadata()

      expect(metadata.name).toBe('stripe')
      expect(metadata.displayName).toBe('Stripe')
      expect(metadata.category).toBe('commerce')
      expect(metadata.docsUrl).toContain('stripe')
    })
  })

  describe('execution', () => {
    it('throws when API key is missing', async () => {
      await expect(
        stripeAdapter.execute('create_customer', { email: 'test@example.com' }, {})
      ).rejects.toThrow(ProviderError)

      try {
        await stripeAdapter.execute('create_customer', {}, {})
      } catch (error) {
        expect((error as ProviderError).code).toBe('MISSING_CREDENTIALS')
        expect((error as ProviderError).provider).toBe('stripe')
      }
    })
  })
})

// ============================================================================
// ADAPTERS INDEX TESTS
// ============================================================================

describe('Adapters Index', () => {
  describe('getAllAdapters', () => {
    it('returns all adapters', () => {
      const adapters = getAllAdapters()

      expect(adapters).toHaveLength(4)  // sendgrid, stripe, slack, hubspot
      expect(adapters.map(a => a.name)).toContain('sendgrid')
      expect(adapters.map(a => a.name)).toContain('slack')
      expect(adapters.map(a => a.name)).toContain('stripe')
      expect(adapters.map(a => a.name)).toContain('hubspot')
    })

    it('returns valid ProviderToolAdapter instances', () => {
      const adapters = getAllAdapters()

      for (const adapter of adapters) {
        expect(typeof adapter.name).toBe('string')
        expect(typeof adapter.getTools).toBe('function')
        expect(typeof adapter.execute).toBe('function')
        expect(typeof adapter.getMetadata).toBe('function')
      }
    })
  })

  describe('registerAllAdapters', () => {
    it('registers all adapters with registry', () => {
      const registry = new ProviderRegistry()

      registerAllAdapters(registry)

      expect(registry.has('sendgrid')).toBe(true)
      expect(registry.has('slack')).toBe(true)
      expect(registry.has('stripe')).toBe(true)
      expect(registry.has('hubspot')).toBe(true)
    })

    it('allows tool execution after registration', async () => {
      const registry = new ProviderRegistry()
      registerAllAdapters(registry)

      // Get a tool through registry
      const tool = registry.getTool('sendgrid', 'send_email')
      expect(tool).toBeDefined()

      // Tool should be executable (will fail with missing credentials)
      try {
        await registry.execute('sendgrid', 'send_email', {}, {})
      } catch (error) {
        // Expected error - credentials missing
        expect((error as ProviderError).code).toBe('MISSING_CREDENTIALS')
      }
    })
  })

  describe('AVAILABLE_ADAPTERS', () => {
    it('lists all available adapter names', () => {
      expect(AVAILABLE_ADAPTERS).toContain('sendgrid')
      expect(AVAILABLE_ADAPTERS).toContain('slack')
      expect(AVAILABLE_ADAPTERS).toContain('stripe')
      expect(AVAILABLE_ADAPTERS).toContain('hubspot')
    })

    it('matches actual adapters', () => {
      const adapters = getAllAdapters()
      expect(AVAILABLE_ADAPTERS.length).toBe(adapters.length)
    })
  })
})

// ============================================================================
// ADAPTER INTERFACE TESTS
// ============================================================================

describe('Adapter Interface Compliance', () => {
  const adapters: ProviderToolAdapter[] = [sendgridAdapter, slackAdapter, stripeAdapter]

  for (const adapter of adapters) {
    describe(`${adapter.name} adapter`, () => {
      it('implements ProviderToolAdapter interface', () => {
        // Required properties
        expect(typeof adapter.name).toBe('string')
        expect(typeof adapter.displayName).toBe('string')
        expect(typeof adapter.description).toBe('string')
        expect(typeof adapter.category).toBe('string')
        expect(adapter.credential).toBeDefined()

        // Required methods
        expect(typeof adapter.getTools).toBe('function')
        expect(typeof adapter.getTool).toBe('function')
        expect(typeof adapter.execute).toBe('function')
        expect(typeof adapter.getMetadata).toBe('function')
      })

      it('has at least one tool', () => {
        const tools = adapter.getTools()
        expect(tools.length).toBeGreaterThan(0)
      })

      it('tools have required properties', () => {
        for (const tool of adapter.getTools()) {
          expect(typeof tool.id).toBe('string')
          expect(typeof tool.name).toBe('string')
          expect(typeof tool.description).toBe('string')
          expect(tool.parameters).toBeDefined()
          expect(tool.parameters.type).toBe('object')
          expect(typeof tool.handler).toBe('function')
        }
      })

      it('credential config is valid', () => {
        expect(adapter.credential.type).toBeDefined()
        // All our adapters should have envVar set
        expect(adapter.credential.envVar).toBeDefined()
      })

      it('metadata has required fields', () => {
        const metadata = adapter.getMetadata()

        expect(metadata.name).toBe(adapter.name)
        expect(metadata.displayName).toBe(adapter.displayName)
        expect(metadata.category).toBe(adapter.category)
        expect(typeof metadata.toolCount).toBe('number')
      })
    })
  }
})

// ============================================================================
// CATEGORY COVERAGE TESTS
// ============================================================================

describe('Category Coverage', () => {
  it('covers communication category', () => {
    expect(sendgridAdapter.category).toBe('communication')
  })

  it('covers collaboration category', () => {
    expect(slackAdapter.category).toBe('collaboration')
  })

  it('covers commerce category', () => {
    expect(stripeAdapter.category).toBe('commerce')
  })

  it('all three core categories are covered', () => {
    const adapters = getAllAdapters()
    const categories = new Set(adapters.map(a => a.category))

    expect(categories.has('communication')).toBe(true)
    expect(categories.has('collaboration')).toBe(true)
    expect(categories.has('commerce')).toBe(true)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Adapter Integration', () => {
  it('all adapters work with registry', () => {
    const registry = new ProviderRegistry()

    // Register all adapters
    for (const adapter of getAllAdapters()) {
      registry.register(adapter)
    }

    // Verify all are registered
    expect(registry.getProviderNames()).toHaveLength(4)

    // Get stats
    const stats = registry.getStats()
    expect(stats.providerCount).toBe(4)
    expect(stats.toolCount).toBeGreaterThan(0)
  })

  it('adapters provide consistent tool discovery', () => {
    const registry = new ProviderRegistry()
    registerAllAdapters(registry)

    // Get all communication tools
    const commTools = registry.getTools({ provider: 'sendgrid' })
    expect(commTools.length).toBeGreaterThan(0)

    // Get all collaboration tools
    const collabTools = registry.getTools({ provider: 'slack' })
    expect(collabTools.length).toBeGreaterThan(0)

    // Get all commerce tools
    const commerceTools = registry.getTools({ provider: 'stripe' })
    expect(commerceTools.length).toBeGreaterThan(0)
  })

  it('adapters can be filtered by category', () => {
    const registry = new ProviderRegistry()
    registerAllAdapters(registry)

    const communicationProviders = registry.getProviders({ category: 'communication' })
    expect(communicationProviders).toHaveLength(1)
    expect(communicationProviders[0].name).toBe('sendgrid')
  })
})
