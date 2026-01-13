/**
 * Tool Provider Integration Tests
 *
 * Tests for the provider registry that integrates dotdo's compat/ layer
 * providers (SendGrid, Slack, Stripe, etc.) with the graph-based tool registry.
 *
 * @module db/graph/tests/tool-providers.test
 * @see dotdo-2hiae - Digital Tools Graph Integration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine } from '../graph-engine'
import {
  ProviderRegistry,
  createProviderRegistry,
  SENDGRID_PROVIDER,
  SLACK_PROVIDER,
  STRIPE_PROVIDER,
  S3_PROVIDER,
  TWILIO_PROVIDER,
  HUBSPOT_PROVIDER,
  DISCORD_PROVIDER,
  BUILTIN_PROVIDERS,
} from '../tool-providers'

describe('Tool Provider Integration', () => {
  let graph: GraphEngine
  let registry: ProviderRegistry

  beforeEach(() => {
    graph = new GraphEngine()
    registry = createProviderRegistry(graph)
  })

  describe('Provider Registry', () => {
    it('should be exported from db/graph', async () => {
      const graphModule = await import('../index')
      expect(graphModule.ProviderRegistry).toBeDefined()
      expect(graphModule.createProviderRegistry).toBeDefined()
    })

    it('should create provider registry from graph engine', () => {
      expect(registry).toBeDefined()
    })

    it('should register a single provider', async () => {
      await registry.registerProvider(SENDGRID_PROVIDER)

      const provider = await registry.getProvider('sendgrid')
      expect(provider).not.toBeNull()
      expect(provider!.properties.name).toBe('sendgrid')
      expect(provider!.properties.displayName).toBe('SendGrid')
      expect(provider!.properties.category).toBe('email')
    })

    it('should register all built-in providers', async () => {
      await registry.registerBuiltins()

      const providers = await registry.listProviders()
      expect(providers.length).toBe(BUILTIN_PROVIDERS.length)
    })

    it('should check if provider exists', async () => {
      await registry.registerProvider(SLACK_PROVIDER)

      expect(await registry.hasProvider('slack')).toBe(true)
      expect(await registry.hasProvider('nonexistent')).toBe(false)
    })
  })

  describe('Provider Data', () => {
    it('should store provider metadata correctly', async () => {
      await registry.registerProvider(STRIPE_PROVIDER)

      const provider = await registry.getProvider('stripe')
      expect(provider).not.toBeNull()
      expect(provider!.properties.category).toBe('finance')
      expect(provider!.properties.authType).toBe('api_key')
      expect(provider!.properties.status).toBe('active')
      expect(provider!.properties.website).toBe('https://stripe.com')
    })

    it('should store provider tags', async () => {
      await registry.registerProvider(HUBSPOT_PROVIDER)

      const provider = await registry.getProvider('hubspot')
      expect(provider).not.toBeNull()
      expect(provider!.properties.tags).toContain('crm')
      expect(provider!.properties.tags).toContain('contacts')
    })

    it('should set default display name from name if not provided', async () => {
      await registry.registerProvider({
        provider: {
          name: 'custom',
          category: 'other',
        },
        tools: [],
      })

      const provider = await registry.getProvider('custom')
      expect(provider).not.toBeNull()
      expect(provider!.properties.displayName).toBe('custom')
    })
  })

  describe('Provider Tools', () => {
    it('should register tools for a provider', async () => {
      await registry.registerProvider(SENDGRID_PROVIDER)

      const result = await registry.getProviderWithTools('sendgrid')
      expect(result).not.toBeNull()
      expect(result!.tools.length).toBe(SENDGRID_PROVIDER.tools.length)
    })

    it('should create tool nodes with correct data', async () => {
      await registry.registerProvider(SLACK_PROVIDER)

      const result = await registry.getProviderWithTools('slack')
      expect(result).not.toBeNull()

      const sendMessageTool = result!.tools.find((t) => t.name.includes('send-message'))
      expect(sendMessageTool).toBeDefined()
      expect(sendMessageTool!.description).toContain('Send a message')
    })

    it('should create providedBy relationships', async () => {
      await registry.registerProvider(S3_PROVIDER)

      // Check via graph query
      const edges = await graph.queryEdges({ type: 'providedBy' })
      expect(edges.length).toBeGreaterThan(0)

      // All tools should point to the provider
      for (const edge of edges) {
        expect(edge.to).toBe('provider:s3')
      }
    })

    it('should create provides relationships', async () => {
      await registry.registerProvider(TWILIO_PROVIDER)

      // Check via graph query
      const edges = await graph.queryEdges({ type: 'provides', from: 'provider:twilio' })
      expect(edges.length).toBe(TWILIO_PROVIDER.tools.length)
    })

    it('should store tool parameters correctly', async () => {
      await registry.registerProvider(STRIPE_PROVIDER)

      const result = await registry.getProviderWithTools('stripe')
      expect(result).not.toBeNull()

      const createPaymentIntent = result!.tools.find((t) =>
        t.name.includes('create-payment-intent')
      )
      expect(createPaymentIntent).toBeDefined()
      expect(createPaymentIntent!.inputSchema.properties.amount).toBeDefined()
      expect(createPaymentIntent!.inputSchema.properties.currency).toBeDefined()
      expect(createPaymentIntent!.inputSchema.required).toContain('amount')
      expect(createPaymentIntent!.inputSchema.required).toContain('currency')
    })
  })

  describe('Provider Categories', () => {
    it('should filter providers by category', async () => {
      await registry.registerBuiltins()

      const emailProviders = await registry.getProvidersByCategory('email')
      expect(emailProviders.length).toBeGreaterThanOrEqual(1)
      expect(emailProviders.every((p) => p.properties.category === 'email')).toBe(true)
    })

    it('should list all messaging providers', async () => {
      await registry.registerBuiltins()

      const messagingProviders = await registry.getProvidersByCategory('messaging')
      expect(messagingProviders.length).toBeGreaterThanOrEqual(3) // Slack, Discord, Twilio
    })

    it('should list all finance providers', async () => {
      await registry.registerBuiltins()

      const financeProviders = await registry.getProvidersByCategory('finance')
      expect(financeProviders.length).toBeGreaterThanOrEqual(1) // Stripe
    })

    it('should list all CRM providers', async () => {
      await registry.registerBuiltins()

      const crmProviders = await registry.getProvidersByCategory('crm')
      expect(crmProviders.length).toBeGreaterThanOrEqual(1) // HubSpot
    })

    it('should list all storage providers', async () => {
      await registry.registerBuiltins()

      const storageProviders = await registry.getProvidersByCategory('storage')
      expect(storageProviders.length).toBeGreaterThanOrEqual(1) // S3
    })

    it('should return empty array for non-existent category', async () => {
      await registry.registerBuiltins()

      const unknownCategory = await registry.getProvidersByCategory('unknown' as any)
      expect(unknownCategory.length).toBe(0)
    })
  })

  describe('Built-in Provider Definitions', () => {
    it('should have correct SendGrid provider definition', () => {
      expect(SENDGRID_PROVIDER.provider.name).toBe('sendgrid')
      expect(SENDGRID_PROVIDER.provider.category).toBe('email')
      expect(SENDGRID_PROVIDER.tools.length).toBeGreaterThanOrEqual(2)
    })

    it('should have correct Slack provider definition', () => {
      expect(SLACK_PROVIDER.provider.name).toBe('slack')
      expect(SLACK_PROVIDER.provider.category).toBe('messaging')
      expect(SLACK_PROVIDER.tools.length).toBeGreaterThanOrEqual(3)
    })

    it('should have correct Stripe provider definition', () => {
      expect(STRIPE_PROVIDER.provider.name).toBe('stripe')
      expect(STRIPE_PROVIDER.provider.category).toBe('finance')
      expect(STRIPE_PROVIDER.tools.length).toBeGreaterThanOrEqual(3)
    })

    it('should have correct S3 provider definition', () => {
      expect(S3_PROVIDER.provider.name).toBe('s3')
      expect(S3_PROVIDER.provider.category).toBe('storage')
      expect(S3_PROVIDER.tools.length).toBeGreaterThanOrEqual(4)
    })

    it('should have correct Twilio provider definition', () => {
      expect(TWILIO_PROVIDER.provider.name).toBe('twilio')
      expect(TWILIO_PROVIDER.provider.category).toBe('messaging')
      expect(TWILIO_PROVIDER.tools.length).toBeGreaterThanOrEqual(2)
    })

    it('should have correct HubSpot provider definition', () => {
      expect(HUBSPOT_PROVIDER.provider.name).toBe('hubspot')
      expect(HUBSPOT_PROVIDER.provider.category).toBe('crm')
      expect(HUBSPOT_PROVIDER.tools.length).toBeGreaterThanOrEqual(3)
    })

    it('should have correct Discord provider definition', () => {
      expect(DISCORD_PROVIDER.provider.name).toBe('discord')
      expect(DISCORD_PROVIDER.provider.category).toBe('messaging')
      expect(DISCORD_PROVIDER.tools.length).toBeGreaterThanOrEqual(2)
    })

    it('should export all built-in providers in BUILTIN_PROVIDERS', () => {
      expect(BUILTIN_PROVIDERS).toBeDefined()
      expect(Array.isArray(BUILTIN_PROVIDERS)).toBe(true)
      expect(BUILTIN_PROVIDERS.length).toBe(7)

      const names = BUILTIN_PROVIDERS.map((p) => p.provider.name)
      expect(names).toContain('sendgrid')
      expect(names).toContain('slack')
      expect(names).toContain('stripe')
      expect(names).toContain('s3')
      expect(names).toContain('twilio')
      expect(names).toContain('hubspot')
      expect(names).toContain('discord')
    })
  })

  describe('Tool Security Levels', () => {
    it('should set tool security levels from provider definition', async () => {
      await registry.registerProvider(STRIPE_PROVIDER)

      const result = await registry.getProviderWithTools('stripe')
      expect(result).not.toBeNull()

      // Verify security levels are set in tool nodes via graph
      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const paymentIntentTool = toolNodes.find((n) =>
        n.id.includes('create-payment-intent')
      )
      expect(paymentIntentTool).toBeDefined()
      expect(paymentIntentTool!.properties.securityLevel).toBe('critical')
    })

    it('should default security level to internal', async () => {
      await registry.registerProvider(SENDGRID_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const sendEmailTool = toolNodes.find((n) => n.id.includes('send-email'))
      expect(sendEmailTool).toBeDefined()
      expect(sendEmailTool!.properties.securityLevel).toBe('internal')
    })

    it('should set restricted security level correctly', async () => {
      await registry.registerProvider(SLACK_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const createChannelTool = toolNodes.find((n) =>
        n.id.includes('create-channel')
      )
      expect(createChannelTool).toBeDefined()
      expect(createChannelTool!.properties.securityLevel).toBe('restricted')
    })

    it('should set public security level correctly', async () => {
      await registry.registerProvider(S3_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const downloadTool = toolNodes.find((n) => n.id.includes('download-file'))
      expect(downloadTool).toBeDefined()
      expect(downloadTool!.properties.securityLevel).toBe('public')
    })
  })

  describe('Tool Audience', () => {
    it('should set tool audience from provider definition', async () => {
      await registry.registerProvider(STRIPE_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const createCustomerTool = toolNodes.find((n) =>
        n.id.includes('create-customer')
      )
      expect(createCustomerTool).toBeDefined()
      expect(createCustomerTool!.properties.audience).toBe('agent')
    })

    it('should default audience to both', async () => {
      await registry.registerProvider(SENDGRID_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const sendEmailTool = toolNodes.find((n) => n.id.includes('send-email'))
      expect(sendEmailTool).toBeDefined()
      expect(sendEmailTool!.properties.audience).toBe('both')
    })

    it('should set human-only audience correctly', async () => {
      await registry.registerProvider(SLACK_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      const createChannelTool = toolNodes.find((n) =>
        n.id.includes('create-channel')
      )
      expect(createChannelTool).toBeDefined()
      expect(createChannelTool!.properties.audience).toBe('human')
    })
  })

  describe('Provider Status', () => {
    it('should default status to active', async () => {
      await registry.registerProvider({
        provider: {
          name: 'new-provider',
          category: 'other',
        },
        tools: [],
      })

      const provider = await registry.getProvider('new-provider')
      expect(provider).not.toBeNull()
      expect(provider!.properties.status).toBe('active')
    })

    it('should preserve explicit status', async () => {
      await registry.registerProvider({
        provider: {
          name: 'beta-provider',
          category: 'other',
          status: 'beta',
        },
        tools: [],
      })

      const provider = await registry.getProvider('beta-provider')
      expect(provider).not.toBeNull()
      expect(provider!.properties.status).toBe('beta')
    })
  })

  describe('Authentication Types', () => {
    it('should have api_key auth for SendGrid', () => {
      expect(SENDGRID_PROVIDER.provider.authType).toBe('api_key')
    })

    it('should have oauth auth for Slack', () => {
      expect(SLACK_PROVIDER.provider.authType).toBe('oauth')
    })

    it('should have api_key auth for Stripe', () => {
      expect(STRIPE_PROVIDER.provider.authType).toBe('api_key')
    })

    it('should have basic auth for Twilio', () => {
      expect(TWILIO_PROVIDER.provider.authType).toBe('basic')
    })
  })

  describe('Integration with MCP Discovery', () => {
    it('should create tools compatible with MCP discovery', async () => {
      await registry.registerBuiltins()

      // Get all tools via graph query
      const toolNodes = await graph.queryNodes({ label: 'Tool' })

      for (const tool of toolNodes) {
        // Each tool should have required MCP-compatible fields
        expect(tool.properties.name).toBeDefined()
        expect(tool.properties.description).toBeDefined()
        expect(tool.properties.parameters).toBeDefined()
      }
    })

    it('should set tool category from provider category', async () => {
      await registry.registerProvider(SENDGRID_PROVIDER)

      const toolNodes = await graph.queryNodes({ label: 'Tool' })
      for (const tool of toolNodes) {
        expect(tool.properties.category).toBe('email')
      }
    })
  })
})
