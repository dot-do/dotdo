/**
 * Tool Provider Integration
 *
 * Integrates dotdo's compat/ layer providers (SendGrid, Slack, Stripe, etc.)
 * with the graph-based tool registry.
 *
 * @module db/graph/tool-providers
 * @see dotdo-2hiae - Digital Tools Graph Integration
 *
 * Provider model:
 * - Provider as Thing { type: 'Provider', data: { name, category, ... } }
 * - Tool -[providedBy]-> Provider
 * - Provider -[provides]-> Tool
 *
 * Supported providers from compat/:
 * - Email: SendGrid, Resend
 * - Messaging: Slack, Discord, Twilio
 * - CRM: HubSpot
 * - Finance: Stripe
 * - Storage: S3, R2
 * - Calendar: Google Calendar, Cal.com
 */

import type { GraphEngine, Node } from './graph-engine'
import type { MCPTool, MCPInputSchema, MCPSchemaProperty } from './mcp-tool-discovery'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Provider category
 */
export type ProviderCategory =
  | 'email'
  | 'messaging'
  | 'crm'
  | 'finance'
  | 'storage'
  | 'calendar'
  | 'analytics'
  | 'database'
  | 'ai'
  | 'other'

/**
 * Provider status
 */
export type ProviderStatus = 'active' | 'inactive' | 'deprecated' | 'beta'

/**
 * Provider data stored in Thing
 */
export interface ProviderData {
  name: string
  displayName: string
  category: ProviderCategory
  description?: string
  website?: string
  docsUrl?: string
  status: ProviderStatus
  authType?: 'api_key' | 'oauth' | 'basic' | 'none'
  configSchema?: MCPInputSchema
  iconUrl?: string
  tags?: string[]
}

/**
 * Provider Thing
 */
export interface ProviderThing {
  id: string
  label: 'Provider'
  properties: ProviderData
}

/**
 * Input for creating a provider
 */
export interface CreateProviderInput {
  id?: string
  name: string
  displayName?: string
  category: ProviderCategory
  description?: string
  website?: string
  docsUrl?: string
  status?: ProviderStatus
  authType?: 'api_key' | 'oauth' | 'basic' | 'none'
  iconUrl?: string
  tags?: string[]
}

/**
 * Tool template for provider registration
 */
export interface ProviderToolTemplate {
  name: string
  description: string
  operation: string
  parameters: Array<{
    name: string
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    description?: string
    required?: boolean
    enum?: unknown[]
  }>
  securityLevel?: 'public' | 'internal' | 'restricted' | 'critical'
  audience?: 'agent' | 'human' | 'both'
}

/**
 * Provider definition with tools
 */
export interface ProviderDefinition {
  provider: CreateProviderInput
  tools: ProviderToolTemplate[]
}

// ============================================================================
// BUILT-IN PROVIDER DEFINITIONS
// ============================================================================

/**
 * SendGrid email provider
 */
export const SENDGRID_PROVIDER: ProviderDefinition = {
  provider: {
    name: 'sendgrid',
    displayName: 'SendGrid',
    category: 'email',
    description: 'Email delivery service by Twilio',
    website: 'https://sendgrid.com',
    docsUrl: 'https://docs.sendgrid.com',
    authType: 'api_key',
    status: 'active',
    tags: ['email', 'transactional', 'marketing'],
  },
  tools: [
    {
      name: 'send-email',
      description: 'Send an email via SendGrid',
      operation: 'mail.send',
      parameters: [
        { name: 'to', type: 'string', description: 'Recipient email address', required: true },
        { name: 'subject', type: 'string', description: 'Email subject line', required: true },
        { name: 'body', type: 'string', description: 'Email body (HTML or text)', required: true },
        { name: 'from', type: 'string', description: 'Sender email address' },
        { name: 'cc', type: 'array', description: 'CC recipients' },
        { name: 'bcc', type: 'array', description: 'BCC recipients' },
      ],
      securityLevel: 'internal',
      audience: 'both',
    },
    {
      name: 'send-template',
      description: 'Send an email using a SendGrid template',
      operation: 'mail.send.template',
      parameters: [
        { name: 'to', type: 'string', description: 'Recipient email address', required: true },
        { name: 'templateId', type: 'string', description: 'SendGrid template ID', required: true },
        { name: 'dynamicData', type: 'object', description: 'Template variables' },
      ],
      securityLevel: 'internal',
      audience: 'agent',
    },
  ],
}

/**
 * Slack messaging provider
 */
export const SLACK_PROVIDER: ProviderDefinition = {
  provider: {
    name: 'slack',
    displayName: 'Slack',
    category: 'messaging',
    description: 'Team communication platform',
    website: 'https://slack.com',
    docsUrl: 'https://api.slack.com',
    authType: 'oauth',
    status: 'active',
    tags: ['messaging', 'team', 'chat'],
  },
  tools: [
    {
      name: 'send-message',
      description: 'Send a message to a Slack channel',
      operation: 'chat.postMessage',
      parameters: [
        { name: 'channel', type: 'string', description: 'Channel ID or name', required: true },
        { name: 'text', type: 'string', description: 'Message text', required: true },
        { name: 'blocks', type: 'array', description: 'Block Kit blocks' },
        { name: 'threadTs', type: 'string', description: 'Thread timestamp for replies' },
      ],
      securityLevel: 'internal',
      audience: 'both',
    },
    {
      name: 'create-channel',
      description: 'Create a new Slack channel',
      operation: 'conversations.create',
      parameters: [
        { name: 'name', type: 'string', description: 'Channel name', required: true },
        { name: 'isPrivate', type: 'boolean', description: 'Create as private channel' },
      ],
      securityLevel: 'restricted',
      audience: 'human',
    },
    {
      name: 'invite-user',
      description: 'Invite a user to a channel',
      operation: 'conversations.invite',
      parameters: [
        { name: 'channel', type: 'string', description: 'Channel ID', required: true },
        { name: 'users', type: 'array', description: 'User IDs to invite', required: true },
      ],
      securityLevel: 'restricted',
      audience: 'human',
    },
  ],
}

/**
 * Stripe payment provider
 */
export const STRIPE_PROVIDER: ProviderDefinition = {
  provider: {
    name: 'stripe',
    displayName: 'Stripe',
    category: 'finance',
    description: 'Online payment processing',
    website: 'https://stripe.com',
    docsUrl: 'https://stripe.com/docs/api',
    authType: 'api_key',
    status: 'active',
    tags: ['payments', 'subscriptions', 'billing'],
  },
  tools: [
    {
      name: 'create-payment-intent',
      description: 'Create a payment intent for checkout',
      operation: 'paymentIntents.create',
      parameters: [
        { name: 'amount', type: 'number', description: 'Amount in cents', required: true },
        { name: 'currency', type: 'string', description: 'ISO currency code', required: true },
        { name: 'customerId', type: 'string', description: 'Stripe customer ID' },
        { name: 'metadata', type: 'object', description: 'Additional metadata' },
      ],
      securityLevel: 'critical',
      audience: 'agent',
    },
    {
      name: 'create-customer',
      description: 'Create a Stripe customer',
      operation: 'customers.create',
      parameters: [
        { name: 'email', type: 'string', description: 'Customer email', required: true },
        { name: 'name', type: 'string', description: 'Customer name' },
        { name: 'metadata', type: 'object', description: 'Additional metadata' },
      ],
      securityLevel: 'restricted',
      audience: 'agent',
    },
    {
      name: 'list-invoices',
      description: 'List invoices for a customer',
      operation: 'invoices.list',
      parameters: [
        { name: 'customerId', type: 'string', description: 'Customer ID' },
        { name: 'limit', type: 'number', description: 'Max results (1-100)' },
        { name: 'status', type: 'string', description: 'Filter by status', enum: ['draft', 'open', 'paid', 'void', 'uncollectible'] },
      ],
      securityLevel: 'internal',
      audience: 'both',
    },
  ],
}

/**
 * S3 storage provider
 */
export const S3_PROVIDER: ProviderDefinition = {
  provider: {
    name: 's3',
    displayName: 'Amazon S3',
    category: 'storage',
    description: 'Object storage service',
    website: 'https://aws.amazon.com/s3',
    docsUrl: 'https://docs.aws.amazon.com/s3',
    authType: 'api_key',
    status: 'active',
    tags: ['storage', 'files', 'cloud'],
  },
  tools: [
    {
      name: 'upload-file',
      description: 'Upload a file to S3',
      operation: 'putObject',
      parameters: [
        { name: 'bucket', type: 'string', description: 'Bucket name', required: true },
        { name: 'key', type: 'string', description: 'Object key (path)', required: true },
        { name: 'body', type: 'string', description: 'File content', required: true },
        { name: 'contentType', type: 'string', description: 'MIME type' },
      ],
      securityLevel: 'internal',
      audience: 'agent',
    },
    {
      name: 'download-file',
      description: 'Download a file from S3',
      operation: 'getObject',
      parameters: [
        { name: 'bucket', type: 'string', description: 'Bucket name', required: true },
        { name: 'key', type: 'string', description: 'Object key (path)', required: true },
      ],
      securityLevel: 'public',
      audience: 'both',
    },
    {
      name: 'list-objects',
      description: 'List objects in an S3 bucket',
      operation: 'listObjects',
      parameters: [
        { name: 'bucket', type: 'string', description: 'Bucket name', required: true },
        { name: 'prefix', type: 'string', description: 'Key prefix filter' },
        { name: 'maxKeys', type: 'number', description: 'Max results' },
      ],
      securityLevel: 'public',
      audience: 'both',
    },
    {
      name: 'delete-file',
      description: 'Delete a file from S3',
      operation: 'deleteObject',
      parameters: [
        { name: 'bucket', type: 'string', description: 'Bucket name', required: true },
        { name: 'key', type: 'string', description: 'Object key (path)', required: true },
      ],
      securityLevel: 'restricted',
      audience: 'human',
    },
  ],
}

/**
 * Twilio messaging provider
 */
export const TWILIO_PROVIDER: ProviderDefinition = {
  provider: {
    name: 'twilio',
    displayName: 'Twilio',
    category: 'messaging',
    description: 'Cloud communications platform',
    website: 'https://twilio.com',
    docsUrl: 'https://www.twilio.com/docs',
    authType: 'basic',
    status: 'active',
    tags: ['sms', 'voice', 'messaging'],
  },
  tools: [
    {
      name: 'send-sms',
      description: 'Send an SMS message',
      operation: 'messages.create',
      parameters: [
        { name: 'to', type: 'string', description: 'Recipient phone number', required: true },
        { name: 'body', type: 'string', description: 'Message body', required: true },
        { name: 'from', type: 'string', description: 'Sender phone number' },
      ],
      securityLevel: 'internal',
      audience: 'both',
    },
    {
      name: 'make-call',
      description: 'Initiate a phone call',
      operation: 'calls.create',
      parameters: [
        { name: 'to', type: 'string', description: 'Recipient phone number', required: true },
        { name: 'from', type: 'string', description: 'Caller ID number', required: true },
        { name: 'url', type: 'string', description: 'TwiML URL for call handling', required: true },
      ],
      securityLevel: 'restricted',
      audience: 'human',
    },
  ],
}

/**
 * HubSpot CRM provider
 */
export const HUBSPOT_PROVIDER: ProviderDefinition = {
  provider: {
    name: 'hubspot',
    displayName: 'HubSpot',
    category: 'crm',
    description: 'CRM and marketing platform',
    website: 'https://hubspot.com',
    docsUrl: 'https://developers.hubspot.com/docs/api',
    authType: 'oauth',
    status: 'active',
    tags: ['crm', 'contacts', 'deals', 'marketing'],
  },
  tools: [
    {
      name: 'create-contact',
      description: 'Create a new contact in HubSpot',
      operation: 'contacts.create',
      parameters: [
        { name: 'email', type: 'string', description: 'Contact email', required: true },
        { name: 'firstName', type: 'string', description: 'First name' },
        { name: 'lastName', type: 'string', description: 'Last name' },
        { name: 'phone', type: 'string', description: 'Phone number' },
        { name: 'company', type: 'string', description: 'Company name' },
      ],
      securityLevel: 'internal',
      audience: 'both',
    },
    {
      name: 'create-deal',
      description: 'Create a new deal in HubSpot',
      operation: 'deals.create',
      parameters: [
        { name: 'name', type: 'string', description: 'Deal name', required: true },
        { name: 'stage', type: 'string', description: 'Deal stage', required: true },
        { name: 'amount', type: 'number', description: 'Deal amount' },
        { name: 'contactId', type: 'string', description: 'Associated contact ID' },
      ],
      securityLevel: 'internal',
      audience: 'agent',
    },
    {
      name: 'search-contacts',
      description: 'Search contacts in HubSpot',
      operation: 'contacts.search',
      parameters: [
        { name: 'query', type: 'string', description: 'Search query', required: true },
        { name: 'limit', type: 'number', description: 'Max results' },
      ],
      securityLevel: 'public',
      audience: 'both',
    },
  ],
}

/**
 * Discord messaging provider
 */
export const DISCORD_PROVIDER: ProviderDefinition = {
  provider: {
    name: 'discord',
    displayName: 'Discord',
    category: 'messaging',
    description: 'Community platform for gamers and communities',
    website: 'https://discord.com',
    docsUrl: 'https://discord.com/developers/docs',
    authType: 'oauth',
    status: 'active',
    tags: ['messaging', 'community', 'chat', 'voice'],
  },
  tools: [
    {
      name: 'send-message',
      description: 'Send a message to a Discord channel',
      operation: 'channels.messages.create',
      parameters: [
        { name: 'channelId', type: 'string', description: 'Channel ID', required: true },
        { name: 'content', type: 'string', description: 'Message content', required: true },
        { name: 'embeds', type: 'array', description: 'Embed objects' },
      ],
      securityLevel: 'internal',
      audience: 'both',
    },
    {
      name: 'create-webhook',
      description: 'Create a webhook for a channel',
      operation: 'channels.webhooks.create',
      parameters: [
        { name: 'channelId', type: 'string', description: 'Channel ID', required: true },
        { name: 'name', type: 'string', description: 'Webhook name', required: true },
        { name: 'avatar', type: 'string', description: 'Avatar URL' },
      ],
      securityLevel: 'restricted',
      audience: 'human',
    },
  ],
}

/**
 * All built-in providers
 */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  SENDGRID_PROVIDER,
  SLACK_PROVIDER,
  STRIPE_PROVIDER,
  S3_PROVIDER,
  TWILIO_PROVIDER,
  HUBSPOT_PROVIDER,
  DISCORD_PROVIDER,
]

// ============================================================================
// PROVIDER REGISTRY
// ============================================================================

/**
 * ProviderRegistry manages provider registrations and tool associations.
 *
 * @example
 * ```typescript
 * const registry = new ProviderRegistry(graph)
 *
 * // Register built-in providers
 * await registry.registerBuiltins()
 *
 * // Get provider with its tools
 * const sendgrid = await registry.getProviderWithTools('sendgrid')
 * ```
 */
export class ProviderRegistry {
  private graph: GraphEngine
  private providers: Map<string, ProviderThing> = new Map()

  constructor(graph: GraphEngine) {
    this.graph = graph
  }

  /**
   * Register all built-in providers and their tools.
   */
  async registerBuiltins(): Promise<void> {
    for (const definition of BUILTIN_PROVIDERS) {
      await this.registerProvider(definition)
    }
  }

  /**
   * Register a provider and its tools.
   *
   * @param definition - Provider definition with tools
   * @returns Provider Thing ID
   */
  async registerProvider(definition: ProviderDefinition): Promise<string> {
    const { provider, tools } = definition

    // Create provider node
    const providerId = provider.id ?? `provider:${provider.name}`
    const providerNode = await this.graph.createNode(
      'Provider',
      {
        ...provider,
        displayName: provider.displayName ?? provider.name,
        status: provider.status ?? 'active',
      } as ProviderData,
      { id: providerId }
    )

    // Create tool nodes and relationships
    for (const toolTemplate of tools) {
      const toolId = `tool:${provider.name}:${toolTemplate.name}`

      // Create tool node
      await this.graph.createNode(
        'Tool',
        {
          id: toolId,
          name: `${provider.displayName ?? provider.name}: ${toolTemplate.name}`,
          description: toolTemplate.description,
          category: provider.category,
          subcategory: toolTemplate.operation.split('.')[0],
          audience: toolTemplate.audience ?? 'both',
          securityLevel: toolTemplate.securityLevel ?? 'internal',
          parameters: toolTemplate.parameters,
          required: toolTemplate.parameters.filter((p) => p.required).map((p) => p.name),
          operation: toolTemplate.operation,
        },
        { id: toolId }
      )

      // Create bidirectional relationships
      await this.graph.createEdge(toolId, 'providedBy', providerId)
      await this.graph.createEdge(providerId, 'provides', toolId)
    }

    return providerId
  }

  /**
   * Get a provider by name.
   *
   * @param name - Provider name
   * @returns Provider Thing or null
   */
  async getProvider(name: string): Promise<ProviderThing | null> {
    const providerId = `provider:${name}`
    const node = await this.graph.getNode(providerId)
    if (!node || node.label !== 'Provider') {
      return null
    }
    return {
      id: node.id,
      label: 'Provider',
      properties: node.properties as ProviderData,
    }
  }

  /**
   * Get a provider with all its tools.
   *
   * @param name - Provider name
   * @returns Provider with tools array
   */
  async getProviderWithTools(
    name: string
  ): Promise<{ provider: ProviderThing; tools: MCPTool[] } | null> {
    const provider = await this.getProvider(name)
    if (!provider) {
      return null
    }

    // Get tools via provides relationship
    const providesEdges = await this.graph.queryEdges({
      from: provider.id,
      type: 'provides',
    })

    const tools: MCPTool[] = []
    for (const edge of providesEdges) {
      const toolNode = await this.graph.getNode(edge.to)
      if (toolNode && toolNode.label === 'Tool') {
        const props = toolNode.properties as Record<string, unknown>
        tools.push({
          name: toolNode.id,
          description: props.description as string | undefined,
          inputSchema: {
            type: 'object',
            properties: this.parametersToSchema(props.parameters as ProviderToolTemplate['parameters'] ?? []),
            required: props.required as string[] ?? [],
          },
        })
      }
    }

    return { provider, tools }
  }

  /**
   * List all providers.
   *
   * @param category - Optional category filter
   * @returns Array of providers
   */
  async listProviders(category?: ProviderCategory): Promise<ProviderThing[]> {
    const nodes = await this.graph.queryNodes({ label: 'Provider' })

    let providers = nodes.map((node) => ({
      id: node.id,
      label: 'Provider' as const,
      properties: node.properties as ProviderData,
    }))

    if (category) {
      providers = providers.filter((p) => p.properties.category === category)
    }

    return providers
  }

  /**
   * Get providers by category.
   *
   * @param category - Provider category
   * @returns Array of providers
   */
  async getProvidersByCategory(category: ProviderCategory): Promise<ProviderThing[]> {
    return this.listProviders(category)
  }

  /**
   * Check if a provider is registered.
   *
   * @param name - Provider name
   * @returns true if registered
   */
  async hasProvider(name: string): Promise<boolean> {
    const provider = await this.getProvider(name)
    return provider !== null
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Convert parameters to JSON schema properties.
   */
  private parametersToSchema(
    parameters: ProviderToolTemplate['parameters']
  ): Record<string, MCPSchemaProperty> {
    const properties: Record<string, MCPSchemaProperty> = {}

    for (const param of parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        enum: param.enum as (string | number)[] | undefined,
      }
    }

    return properties
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ProviderRegistry instance.
 *
 * @param graph - The GraphEngine to use for storage
 * @returns ProviderRegistry instance
 */
export function createProviderRegistry(graph: GraphEngine): ProviderRegistry {
  return new ProviderRegistry(graph)
}
