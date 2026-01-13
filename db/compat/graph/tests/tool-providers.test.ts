/**
 * [RED] Tool → Provider Relationship Tests
 *
 * Tests for Tool → Provider relationships in the graph.
 * Each tool should link to its provider (Slack, Stripe, SendGrid) via graph relationships.
 *
 * Test Categories:
 * 1. Provider Relationships - links tool via providedBy, queries tools by provider
 * 2. Multi-provider Support - failover, health tracking
 * 3. Credential Linking - authenticatedBy relationship, credential rotation
 * 4. compat/ Integration - tests with real compat/ providers
 *
 * This uses the Thing-based graph API pattern:
 * - graph.create({ $type: 'Provider', data: {...} }) - creates a Thing
 * - graph.createRelationship({ verb: 'providedBy', from: toolId, to: providerId })
 * - graph.getRelationshipsFrom(thingId, verb) - query outgoing relationships
 * - graph.getRelationshipsTo(thingId, verb) - query incoming relationships
 *
 * @see dotdo-t9zlk
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Import the Thing-based graph API (does not exist yet - RED phase)
import {
  createToolProviderGraph,
  type ToolProviderGraph,
  type ToolThing,
  type ProviderThing,
  type CredentialThing,
} from '../src/tool-provider-graph'

// ============================================================================
// 1. PROVIDER RELATIONSHIPS
// ============================================================================

describe('Tool Provider Relationships', () => {
  let graph: ToolProviderGraph

  beforeEach(async () => {
    graph = await createToolProviderGraph({ namespace: 'test-tools' })
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('providedBy relationship', () => {
    it('links tool to provider via providedBy', async () => {
      // Create SendGrid provider Thing
      const provider = await graph.create({
        $type: 'Provider',
        data: {
          name: 'SendGrid',
          category: 'email',
          apiBaseUrl: 'https://api.sendgrid.com/v3',
        },
      })

      // Create tool Thing
      const tool = await graph.create({
        $type: 'Tool',
        data: {
          id: 'communication.email.send',
          name: 'Send Email',
          description: 'Sends an email via SendGrid',
        },
      })

      // Create providedBy relationship
      await graph.createRelationship({
        verb: 'providedBy',
        from: tool.$id,
        to: provider.$id,
      })

      // Query tool's provider
      const providers = await graph.getRelationshipsFrom(tool.$id, 'providedBy')
      expect(providers).toHaveLength(1)
      expect(providers[0].to).toBe(provider.$id)
    })

    it('queries all tools by provider', async () => {
      // Create Slack provider
      const slackProvider = await graph.create({
        $type: 'Provider',
        data: {
          name: 'Slack',
          category: 'messaging',
          apiBaseUrl: 'https://slack.com/api',
        },
      })

      // Create multiple Slack tools
      const postMessage = await graph.create({
        $type: 'Tool',
        data: { id: 'slack.chat.postMessage', name: 'Post Message' },
      })

      const createChannel = await graph.create({
        $type: 'Tool',
        data: { id: 'slack.conversations.create', name: 'Create Channel' },
      })

      const uploadFile = await graph.create({
        $type: 'Tool',
        data: { id: 'slack.files.upload', name: 'Upload File' },
      })

      // Link all tools to Slack
      await graph.createRelationship({ verb: 'providedBy', from: postMessage.$id, to: slackProvider.$id })
      await graph.createRelationship({ verb: 'providedBy', from: createChannel.$id, to: slackProvider.$id })
      await graph.createRelationship({ verb: 'providedBy', from: uploadFile.$id, to: slackProvider.$id })

      // Query tools by provider (via incoming relationships)
      const tools = await graph.getRelationshipsTo(slackProvider.$id, 'providedBy')

      expect(tools).toHaveLength(3)
      const toolIds = tools.map(r => r.from)
      expect(toolIds).toContain(postMessage.$id)
      expect(toolIds).toContain(createChannel.$id)
      expect(toolIds).toContain(uploadFile.$id)
    })

    it('gets provider details from tool', async () => {
      // Create Stripe provider
      const stripeProvider = await graph.create({
        $type: 'Provider',
        data: {
          name: 'Stripe',
          category: 'payments',
          apiBaseUrl: 'https://api.stripe.com/v1',
        },
      })

      // Create payment tool
      const createPaymentIntent = await graph.create({
        $type: 'Tool',
        data: {
          id: 'stripe.paymentIntents.create',
          name: 'Create Payment Intent',
          category: 'payments.charge',
        },
      })

      await graph.createRelationship({
        verb: 'providedBy',
        from: createPaymentIntent.$id,
        to: stripeProvider.$id,
      })

      // Get provider details from tool
      const providerRels = await graph.getRelationshipsFrom(createPaymentIntent.$id, 'providedBy')
      expect(providerRels).toHaveLength(1)

      const providerThing = await graph.get(providerRels[0].to)
      expect(providerThing).toBeDefined()
      expect(providerThing?.data.name).toBe('Stripe')
      expect(providerThing?.data.category).toBe('payments')
      expect(providerThing?.data.apiBaseUrl).toBe('https://api.stripe.com/v1')
    })
  })
})

// ============================================================================
// 2. MULTI-PROVIDER SUPPORT
// ============================================================================

describe('Multi-provider Support', () => {
  let graph: ToolProviderGraph

  beforeEach(async () => {
    graph = await createToolProviderGraph({ namespace: 'test-failover' })
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('failover configuration', () => {
    it('supports multiple providers per tool for failover', async () => {
      // Create primary and secondary email providers
      const sendgrid = await graph.create({
        $type: 'Provider',
        data: {
          name: 'SendGrid',
          category: 'email',
          apiBaseUrl: 'https://api.sendgrid.com/v3',
          failoverPriority: 1,
        },
      })

      const resend = await graph.create({
        $type: 'Provider',
        data: {
          name: 'Resend',
          category: 'email',
          apiBaseUrl: 'https://api.resend.com',
          failoverPriority: 2,
        },
      })

      const mailgun = await graph.create({
        $type: 'Provider',
        data: {
          name: 'Mailgun',
          category: 'email',
          apiBaseUrl: 'https://api.mailgun.net/v3',
          failoverPriority: 3,
        },
      })

      // Create email tool with multiple providers
      const sendEmail = await graph.create({
        $type: 'Tool',
        data: { id: 'communication.email.send', name: 'Send Email' },
      })

      // Link tool to all providers with priority metadata on relationships
      await graph.createRelationship({
        verb: 'providedBy',
        from: sendEmail.$id,
        to: sendgrid.$id,
        data: { priority: 1, isPrimary: true },
      })
      await graph.createRelationship({
        verb: 'providedBy',
        from: sendEmail.$id,
        to: resend.$id,
        data: { priority: 2, isPrimary: false },
      })
      await graph.createRelationship({
        verb: 'providedBy',
        from: sendEmail.$id,
        to: mailgun.$id,
        data: { priority: 3, isPrimary: false },
      })

      // Query all providers for the tool
      const providers = await graph.getRelationshipsFrom(sendEmail.$id, 'providedBy')
      expect(providers).toHaveLength(3)

      // Verify priority metadata
      const primaryProvider = providers.find(p => p.data?.isPrimary === true)
      expect(primaryProvider).toBeDefined()
      expect(primaryProvider?.to).toBe(sendgrid.$id)

      // Verify priority ordering
      const sortedByPriority = [...providers].sort((a, b) =>
        (a.data?.priority as number) - (b.data?.priority as number)
      )
      expect(sortedByPriority[0].to).toBe(sendgrid.$id)
      expect(sortedByPriority[1].to).toBe(resend.$id)
      expect(sortedByPriority[2].to).toBe(mailgun.$id)
    })

    it('tracks provider health status', async () => {
      const now = Date.now()

      // Create provider with health status
      const provider = await graph.create({
        $type: 'Provider',
        data: {
          name: 'SendGrid',
          category: 'email',
          healthStatus: 'healthy',
          lastHealthCheck: now,
        },
      })

      expect(provider.data.healthStatus).toBe('healthy')
      expect(provider.data.lastHealthCheck).toBe(now)

      // Update health status (simulating health check failure)
      const updatedProvider = await graph.update(provider.$id, {
        data: {
          healthStatus: 'degraded',
          lastHealthCheck: now + 60000,
        },
      })

      expect(updatedProvider?.data.healthStatus).toBe('degraded')
      expect(updatedProvider?.data.lastHealthCheck).toBe(now + 60000)
    })

    it('queries providers by health status', async () => {
      // Create multiple providers with different health statuses
      await graph.create({
        $type: 'Provider',
        data: { name: 'SendGrid', category: 'email', healthStatus: 'healthy' },
      })

      await graph.create({
        $type: 'Provider',
        data: { name: 'Resend', category: 'email', healthStatus: 'degraded' },
      })

      await graph.create({
        $type: 'Provider',
        data: { name: 'Mailgun', category: 'email', healthStatus: 'unhealthy' },
      })

      // Query healthy providers only
      const healthyProviders = await graph.findByType('Provider', {
        where: { healthStatus: 'healthy' },
      })

      expect(healthyProviders).toHaveLength(1)
      expect(healthyProviders[0].data.name).toBe('SendGrid')

      // Query available providers (healthy or degraded)
      const allProviders = await graph.findByType('Provider')
      const availableProviders = allProviders.filter(
        p => p.data.healthStatus !== 'unhealthy'
      )
      expect(availableProviders).toHaveLength(2)
    })

    it('selects failover provider when primary is unhealthy', async () => {
      // Create providers with health status
      const sendgrid = await graph.create({
        $type: 'Provider',
        data: {
          name: 'SendGrid',
          category: 'email',
          healthStatus: 'unhealthy',
          failoverPriority: 1,
        },
      })

      const resend = await graph.create({
        $type: 'Provider',
        data: {
          name: 'Resend',
          category: 'email',
          healthStatus: 'healthy',
          failoverPriority: 2,
        },
      })

      // Create tool
      const sendEmail = await graph.create({
        $type: 'Tool',
        data: { id: 'communication.email.send', name: 'Send Email' },
      })

      // Link to both providers
      await graph.createRelationship({
        verb: 'providedBy',
        from: sendEmail.$id,
        to: sendgrid.$id,
        data: { priority: 1 },
      })
      await graph.createRelationship({
        verb: 'providedBy',
        from: sendEmail.$id,
        to: resend.$id,
        data: { priority: 2 },
      })

      // Get all provider relationships for the tool
      const providerRels = await graph.getRelationshipsFrom(sendEmail.$id, 'providedBy')

      // Sort by priority
      const sortedRels = [...providerRels].sort((a, b) =>
        (a.data?.priority as number) - (b.data?.priority as number)
      )

      // Find first healthy provider
      let selectedProvider = null
      for (const rel of sortedRels) {
        const provider = await graph.get(rel.to)
        if (provider?.data.healthStatus === 'healthy') {
          selectedProvider = provider
          break
        }
      }

      expect(selectedProvider).toBeDefined()
      expect(selectedProvider?.$id).toBe(resend.$id)
      expect(selectedProvider?.data.name).toBe('Resend')
    })
  })
})

// ============================================================================
// 3. CREDENTIAL LINKING
// ============================================================================

describe('Provider Credentials', () => {
  let graph: ToolProviderGraph

  beforeEach(async () => {
    graph = await createToolProviderGraph({ namespace: 'test-credentials' })
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('authenticatedBy relationship', () => {
    it('links provider to credential via authenticatedBy', async () => {
      const now = Date.now()

      // Create provider Thing
      const sendgridProvider = await graph.create({
        $type: 'Provider',
        data: {
          name: 'SendGrid',
          category: 'email',
          apiBaseUrl: 'https://api.sendgrid.com/v3',
        },
      })

      // Create credential Thing (key stored in secrets manager, not directly)
      const credential = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'sendgrid',
          secretRef: 'secrets://sendgrid-api-key',
          createdAt: now,
        },
      })

      // Link provider to credential
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: sendgridProvider.$id,
        to: credential.$id,
        data: { isActive: true },
      })

      // Query provider's credentials
      const credentials = await graph.getRelationshipsFrom(sendgridProvider.$id, 'authenticatedBy')
      expect(credentials).toHaveLength(1)
      expect(credentials[0].data?.isActive).toBe(true)
      expect(credentials[0].to).toBe(credential.$id)
    })

    it('supports OAuth credentials with expiration', async () => {
      const now = Date.now()
      const expiresAt = now + 3600000 // 1 hour from now

      // Create provider
      const slackProvider = await graph.create({
        $type: 'Provider',
        data: { name: 'Slack', category: 'messaging' },
      })

      // Create OAuth credential with expiration
      const oauthCredential = await graph.create({
        $type: 'Credential',
        data: {
          type: 'oauth',
          provider: 'slack',
          secretRef: 'secrets://slack-oauth-token',
          createdAt: now,
          expiresAt,
        },
      })

      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: slackProvider.$id,
        to: oauthCredential.$id,
        data: { isActive: true, grantType: 'authorization_code' },
      })

      // Query credential details
      const credRels = await graph.getRelationshipsFrom(slackProvider.$id, 'authenticatedBy')
      expect(credRels).toHaveLength(1)

      const credThing = await graph.get(credRels[0].to)
      expect(credThing?.data.type).toBe('oauth')
      expect(credThing?.data.expiresAt).toBe(expiresAt)

      // Check if credential is expired
      const isExpired = (credThing?.data.expiresAt as number) < Date.now()
      expect(isExpired).toBe(false)
    })
  })

  describe('credential rotation', () => {
    it('rotates credentials via new relationship', async () => {
      const now = Date.now()

      // Create provider
      const stripeProvider = await graph.create({
        $type: 'Provider',
        data: { name: 'Stripe', category: 'payments' },
      })

      // Create old credential
      const oldCredential = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'stripe',
          secretRef: 'secrets://stripe-api-key-v1',
          createdAt: now - 86400000, // 1 day ago
        },
      })

      // Link old credential
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: stripeProvider.$id,
        to: oldCredential.$id,
        data: { isActive: true },
      })

      // Create new credential for rotation
      const newCredential = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'stripe',
          secretRef: 'secrets://stripe-api-key-v2',
          createdAt: now,
          rotatedAt: now,
        },
      })

      // Deactivate old credential relationship
      const oldCredRels = await graph.getRelationshipsFrom(stripeProvider.$id, 'authenticatedBy')
      const oldRel = oldCredRels.find(r => r.to === oldCredential.$id)
      if (oldRel) {
        await graph.updateRelationship(oldRel.id, {
          data: { isActive: false, deactivatedAt: now },
        })
      }

      // Create new active credential relationship
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: stripeProvider.$id,
        to: newCredential.$id,
        data: { isActive: true },
      })

      // Query active credentials only
      const allCredRels = await graph.getRelationshipsFrom(stripeProvider.$id, 'authenticatedBy')
      expect(allCredRels).toHaveLength(2)

      const activeCredRels = allCredRels.filter(r => r.data?.isActive === true)
      expect(activeCredRels).toHaveLength(1)
      expect(activeCredRels[0].to).toBe(newCredential.$id)
    })

    it('tracks credential rotation history', async () => {
      const now = Date.now()

      // Create provider
      const provider = await graph.create({
        $type: 'Provider',
        data: { name: 'GitHub', category: 'devtools' },
      })

      // Create credentials over time
      const cred1 = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'github',
          secretRef: 'secrets://github-token-v1',
          createdAt: now - 172800000, // 2 days ago
        },
      })

      const cred2 = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'github',
          secretRef: 'secrets://github-token-v2',
          createdAt: now - 86400000, // 1 day ago
          rotatedAt: now - 86400000,
        },
      })

      const cred3 = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'github',
          secretRef: 'secrets://github-token-v3',
          createdAt: now,
          rotatedAt: now,
        },
      })

      // Create rotation chain with rotatedFrom relationships
      await graph.createRelationship({ verb: 'rotatedFrom', from: cred2.$id, to: cred1.$id })
      await graph.createRelationship({ verb: 'rotatedFrom', from: cred3.$id, to: cred2.$id })

      // Link all credentials to provider with activation metadata
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: provider.$id,
        to: cred1.$id,
        data: { isActive: false, activatedAt: now - 172800000, deactivatedAt: now - 86400000 },
      })
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: provider.$id,
        to: cred2.$id,
        data: { isActive: false, activatedAt: now - 86400000, deactivatedAt: now },
      })
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: provider.$id,
        to: cred3.$id,
        data: { isActive: true, activatedAt: now },
      })

      // Query rotation history
      const rotationHistory = await graph.getRelationshipsFrom(cred3.$id, 'rotatedFrom')
      expect(rotationHistory).toHaveLength(1)
      expect(rotationHistory[0].to).toBe(cred2.$id)

      // Traverse full rotation chain
      const previousCred = await graph.getRelationshipsFrom(cred2.$id, 'rotatedFrom')
      expect(previousCred).toHaveLength(1)
      expect(previousCred[0].to).toBe(cred1.$id)
    })

    it('revokes old credentials on rotation', async () => {
      const now = Date.now()

      // Create provider
      const provider = await graph.create({
        $type: 'Provider',
        data: { name: 'AWS', category: 'cloud' },
      })

      // Create old and new credentials
      const oldCred = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'aws',
          secretRef: 'secrets://aws-key-old',
          createdAt: now - 86400000,
        },
      })

      const newCred = await graph.create({
        $type: 'Credential',
        data: {
          type: 'api_key',
          provider: 'aws',
          secretRef: 'secrets://aws-key-new',
          createdAt: now,
          rotatedAt: now,
        },
      })

      // Initial setup with old credential active
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: provider.$id,
        to: oldCred.$id,
        data: { isActive: true },
      })

      // Perform rotation: deactivate old, activate new, mark as revoked
      const credRels = await graph.getRelationshipsFrom(provider.$id, 'authenticatedBy')
      const activeRel = credRels.find(r => r.data?.isActive === true)

      if (activeRel) {
        // Mark old credential as revoked in the relationship
        await graph.updateRelationship(activeRel.id, {
          data: {
            isActive: false,
            revokedAt: now,
            revocationReason: 'credential_rotation',
          },
        })

        // Update the credential Thing itself to mark as revoked
        await graph.update(activeRel.to, {
          data: {
            revokedAt: now,
            revocationReason: 'credential_rotation',
          },
        })
      }

      // Add new credential
      await graph.createRelationship({
        verb: 'authenticatedBy',
        from: provider.$id,
        to: newCred.$id,
        data: { isActive: true },
      })

      // Verify old credential is marked as revoked
      const oldCredThing = await graph.get(oldCred.$id)
      expect(oldCredThing?.data.revokedAt).toBe(now)
      expect(oldCredThing?.data.revocationReason).toBe('credential_rotation')

      // Verify new credential is active
      const allCredRels = await graph.getRelationshipsFrom(provider.$id, 'authenticatedBy')
      const activeCredRels = allCredRels.filter(r => r.data?.isActive === true)
      expect(activeCredRels).toHaveLength(1)
      expect(activeCredRels[0].to).toBe(newCred.$id)
    })
  })
})

// ============================================================================
// 4. COMPAT/ PROVIDER INTEGRATION
// ============================================================================

describe('compat/ Provider Integration', () => {
  let graph: GraphStorage

  beforeEach(() => {
    graph = createGraphStorage()
  })

  afterEach(async () => {
    await graph.clear()
  })

  describe('real compat/ provider registration', () => {
    it('creates SendGrid provider from compat/sendgrid', async () => {
      // Import from compat/sendgrid
      const { MailService } = await import('../../../../compat/sendgrid')

      expect(MailService).toBeDefined()

      // Create provider node with SendGrid metadata
      const sendgridProvider = await graph.createNode(['Provider'], {
        name: 'SendGrid',
        category: 'email',
        apiBaseUrl: 'https://api.sendgrid.com/v3',
        compatModule: '@dotdo/sendgrid',
        sdkVersion: '1.0.0',
        capabilities: ['send', 'sendMultiple', 'templates'],
      })

      expect(sendgridProvider).toBeDefined()
      expect(sendgridProvider.properties.name).toBe('SendGrid')
      expect(sendgridProvider.properties.compatModule).toBe('@dotdo/sendgrid')

      // Create tool Things for sendgrid operations
      const sendEmailTool = await graph.createNode(['Tool'], {
        name: 'sendgrid.send',
        description: 'Send email via SendGrid',
        category: 'communication.email.send',
        compatMethod: 'send',
      })

      const sendMultipleTool = await graph.createNode(['Tool'], {
        name: 'sendgrid.sendMultiple',
        description: 'Send email to multiple recipients',
        category: 'communication.email.batch',
        compatMethod: 'sendMultiple',
      })

      // Link tools to provider
      await graph.createRelationship('providedBy', sendEmailTool.id, sendgridProvider.id)
      await graph.createRelationship('providedBy', sendMultipleTool.id, sendgridProvider.id)

      // Verify tools are linked
      const tools = await graph.findIncomingRelationships(sendgridProvider.id, 'providedBy')
      expect(tools).toHaveLength(2)
    })

    it('creates Slack provider from compat/slack', async () => {
      // Import from compat/slack
      const { WebClient, App } = await import('../../../../compat/slack')

      expect(WebClient).toBeDefined()
      expect(App).toBeDefined()

      // Create provider node with Slack metadata
      const slackProvider = await graph.createNode(['Provider'], {
        name: 'Slack',
        category: 'messaging',
        apiBaseUrl: 'https://slack.com/api',
        compatModule: '@dotdo/slack',
        capabilities: ['chat', 'conversations', 'users', 'reactions', 'files'],
      })

      // Create tool Things for slack operations
      const postMessageTool = await graph.createNode(['Tool'], {
        name: 'slack.chat.postMessage',
        description: 'Post a message to a Slack channel',
        category: 'communication.chat.send',
        compatMethod: 'chat.postMessage',
      })

      const conversationsTool = await graph.createNode(['Tool'], {
        name: 'slack.conversations.list',
        description: 'List Slack channels',
        category: 'communication.chat.list',
        compatMethod: 'conversations.list',
      })

      // Link tools to provider
      await graph.createRelationship('providedBy', postMessageTool.id, slackProvider.id)
      await graph.createRelationship('providedBy', conversationsTool.id, slackProvider.id)

      // Verify provider has tools
      const tools = await graph.findIncomingRelationships(slackProvider.id, 'providedBy')
      expect(tools).toHaveLength(2)
      expect(slackProvider.properties.capabilities).toContain('chat')
    })

    it('creates Stripe provider from compat/stripe', async () => {
      // Import from compat/stripe
      const { Stripe, Webhooks } = await import('../../../../compat/stripe')

      expect(Stripe).toBeDefined()
      expect(Webhooks).toBeDefined()

      // Create provider node with Stripe metadata
      const stripeProvider = await graph.createNode(['Provider'], {
        name: 'Stripe',
        category: 'payments',
        apiBaseUrl: 'https://api.stripe.com/v1',
        compatModule: '@dotdo/stripe',
        capabilities: ['customers', 'subscriptions', 'paymentIntents', 'charges', 'refunds', 'webhooks'],
      })

      // Create tool Things for stripe operations
      const createCustomerTool = await graph.createNode(['Tool'], {
        name: 'stripe.customers.create',
        description: 'Create a Stripe customer',
        category: 'payments.customers.create',
        compatMethod: 'customers.create',
      })

      const createPaymentIntentTool = await graph.createNode(['Tool'], {
        name: 'stripe.paymentIntents.create',
        description: 'Create a payment intent',
        category: 'payments.charge.create',
        compatMethod: 'paymentIntents.create',
      })

      const createSubscriptionTool = await graph.createNode(['Tool'], {
        name: 'stripe.subscriptions.create',
        description: 'Create a subscription',
        category: 'payments.subscription.create',
        compatMethod: 'subscriptions.create',
      })

      // Link tools to provider
      await graph.createRelationship('providedBy', createCustomerTool.id, stripeProvider.id)
      await graph.createRelationship('providedBy', createPaymentIntentTool.id, stripeProvider.id)
      await graph.createRelationship('providedBy', createSubscriptionTool.id, stripeProvider.id)

      // Verify provider has all tools
      const tools = await graph.findIncomingRelationships(stripeProvider.id, 'providedBy')
      expect(tools).toHaveLength(3)
    })
  })

  describe('cross-provider tool organization', () => {
    it('organizes tools by category across providers', async () => {
      // Create multiple providers
      const sendgrid = await graph.createNode(['Provider'], {
        name: 'SendGrid',
        category: 'email',
      })

      const twilio = await graph.createNode(['Provider'], {
        name: 'Twilio',
        category: 'communications',
      })

      // Create email tools from different providers
      const sendgridSend = await graph.createNode(['Tool'], {
        name: 'sendgrid.send',
        category: 'communication.email.send',
      })

      const twilioSend = await graph.createNode(['Tool'], {
        name: 'twilio.email.send',
        category: 'communication.email.send',
      })

      // Link to providers
      await graph.createRelationship('providedBy', sendgridSend.id, sendgrid.id)
      await graph.createRelationship('providedBy', twilioSend.id, twilio.id)

      // Query all email tools by category
      const emailTools = await graph.findNodesByLabelAndProperties('Tool', {
        category: 'communication.email.send',
      })

      expect(emailTools).toHaveLength(2)

      // Get providers for each tool
      for (const tool of emailTools) {
        const providerRels = await graph.findOutgoingRelationships(tool.id, 'providedBy')
        expect(providerRels).toHaveLength(1)
      }
    })

    it('discovers tools by provider capability', async () => {
      // Create provider with capabilities
      const stripe = await graph.createNode(['Provider'], {
        name: 'Stripe',
        category: 'payments',
        capabilities: ['subscriptions', 'invoices', 'paymentIntents'],
      })

      // Create tools for different capabilities
      const createSubscription = await graph.createNode(['Tool'], {
        name: 'stripe.subscriptions.create',
        capability: 'subscriptions',
      })

      const listSubscriptions = await graph.createNode(['Tool'], {
        name: 'stripe.subscriptions.list',
        capability: 'subscriptions',
      })

      const createInvoice = await graph.createNode(['Tool'], {
        name: 'stripe.invoices.create',
        capability: 'invoices',
      })

      // Link to provider
      await graph.createRelationship('providedBy', createSubscription.id, stripe.id)
      await graph.createRelationship('providedBy', listSubscriptions.id, stripe.id)
      await graph.createRelationship('providedBy', createInvoice.id, stripe.id)

      // Query tools by capability
      const subscriptionTools = await graph.findNodesByLabelAndProperties('Tool', {
        capability: 'subscriptions',
      })

      expect(subscriptionTools).toHaveLength(2)
      expect(subscriptionTools.map(t => t.properties.name)).toContain('stripe.subscriptions.create')
      expect(subscriptionTools.map(t => t.properties.name)).toContain('stripe.subscriptions.list')
    })
  })
})
