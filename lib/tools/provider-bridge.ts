/**
 * Provider Bridge - compat/ to Tool Graph Integration
 *
 * Issue: dotdo-q900r
 *
 * Bridges compat/ providers to the Tool Graph, enabling:
 * - Auto-registration of tools from compat/ providers
 * - Provider Thing creation with compat/ metadata
 * - Tool Thing creation linked to providers
 * - Unified tool execution through the graph
 *
 * @example
 * ```typescript
 * import { ProviderBridge, registerCompatProviders } from 'lib/tools/provider-bridge'
 * import { createToolProviderGraph } from 'db/compat/graph/src/tool-provider-graph'
 *
 * const graph = createToolProviderGraph({ namespace: 'main' })
 * const bridge = new ProviderBridge(graph)
 *
 * // Register all compat/ providers
 * await registerCompatProviders(bridge)
 *
 * // Or register individual providers
 * await bridge.registerProvider({
 *   name: 'SendGrid',
 *   category: 'communication',
 *   compatModule: '@dotdo/sendgrid',
 *   tools: [...],
 * })
 * ```
 *
 * @see db/compat/graph/src/tool-provider-graph.ts for graph API
 * @see lib/tools/provider-adapter.ts for adapter interface
 */

import type {
  ToolProviderGraph,
  ProviderThing,
  ToolThing,
  ProviderThingData,
  ToolThingData,
} from '../../db/compat/graph/src/tool-provider-graph'
import type {
  ProviderToolAdapter,
  ProviderMetadata,
  ToolDefinition,
  RuntimeCredentials,
  ToolContext,
  ToolCategory,
} from './provider-adapter'
import { ProviderError } from './provider-adapter'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for registering a provider
 */
export interface ProviderRegistrationConfig {
  /** Provider name */
  name: string
  /** Provider category */
  category: ToolCategory | string
  /** Base URL for API requests */
  apiBaseUrl?: string
  /** Documentation URL */
  docsUrl?: string
  /** Reference to compat/ module */
  compatModule?: string
  /** Provider capabilities */
  capabilities?: string[]
  /** Tool definitions to register */
  tools: ToolRegistrationConfig[]
}

/**
 * Configuration for registering a tool
 */
export interface ToolRegistrationConfig {
  /** Tool ID */
  id: string
  /** Tool name */
  name: string
  /** Tool description */
  description?: string
  /** Tool category */
  category?: string
  /** Reference to compat/ method */
  compatMethod?: string
  /** Tool capability */
  capability?: string
  /** Parameter schema */
  parameters?: Record<string, unknown>
  /** Handler function */
  handler?: ToolHandler
}

/**
 * Tool handler function type
 */
export type ToolHandler = (
  params: Record<string, unknown>,
  credentials: RuntimeCredentials,
  context?: ToolContext
) => Promise<unknown>

/**
 * Registered provider with its tools
 */
export interface RegisteredProvider {
  provider: ProviderThing
  tools: ToolThing[]
  handlers: Map<string, ToolHandler>
}

/**
 * Bridge options
 */
export interface ProviderBridgeOptions {
  /** Default category for tools */
  defaultCategory?: ToolCategory
  /** Whether to validate handlers */
  validateHandlers?: boolean
}

// ============================================================================
// Provider Bridge Implementation
// ============================================================================

/**
 * Bridge between compat/ providers and the Tool Graph
 */
export class ProviderBridge {
  private graph: ToolProviderGraph
  private options: ProviderBridgeOptions
  private providers: Map<string, RegisteredProvider> = new Map()
  private toolHandlers: Map<string, ToolHandler> = new Map()

  constructor(graph: ToolProviderGraph, options: ProviderBridgeOptions = {}) {
    this.graph = graph
    this.options = options
  }

  /**
   * Register a provider with its tools
   */
  async registerProvider(config: ProviderRegistrationConfig): Promise<RegisteredProvider> {
    // Create Provider Thing
    const provider = await this.graph.create<ProviderThing>({
      $type: 'Provider',
      data: {
        name: config.name,
        category: config.category,
        apiBaseUrl: config.apiBaseUrl,
        docsUrl: config.docsUrl,
        compatModule: config.compatModule,
        capabilities: config.capabilities,
        healthStatus: 'healthy',
      },
    })

    // Create Tool Things and link to provider
    const tools: ToolThing[] = []
    const handlers = new Map<string, ToolHandler>()

    for (const toolConfig of config.tools) {
      const tool = await this.graph.create<ToolThing>({
        $type: 'Tool',
        data: {
          id: toolConfig.id,
          name: toolConfig.name,
          description: toolConfig.description,
          category: toolConfig.category || config.category,
          compatMethod: toolConfig.compatMethod,
          capability: toolConfig.capability,
        },
      })

      // Link tool to provider
      await this.graph.createRelationship({
        verb: 'providedBy',
        from: tool.$id,
        to: provider.$id,
      })

      tools.push(tool)

      // Store handler if provided
      if (toolConfig.handler) {
        handlers.set(tool.$id, toolConfig.handler)
        this.toolHandlers.set(tool.$id, toolConfig.handler)
      }
    }

    const registered: RegisteredProvider = {
      provider,
      tools,
      handlers,
    }

    this.providers.set(config.name, registered)

    return registered
  }

  /**
   * Register a provider from an adapter
   */
  async registerFromAdapter(adapter: ProviderToolAdapter): Promise<RegisteredProvider> {
    const metadata = adapter.getMetadata()
    const tools = adapter.getTools()

    const config: ProviderRegistrationConfig = {
      name: metadata.name,
      category: metadata.category,
      apiBaseUrl: (metadata as any).baseUrl,
      docsUrl: metadata.docsUrl,
      compatModule: `@dotdo/${metadata.name}`,
      capabilities: [],
      tools: tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: metadata.category,
        parameters: tool.parameters as Record<string, unknown>,
        handler: async (params, credentials, context) => {
          return adapter.execute(tool.id, params, credentials, context)
        },
      })),
    }

    return this.registerProvider(config)
  }

  /**
   * Get a registered provider by name
   */
  getProvider(name: string): RegisteredProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * Get all registered providers
   */
  getProviders(): RegisteredProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * Get tools for a provider
   */
  async getToolsForProvider(providerId: string): Promise<ToolThing[]> {
    const rels = await this.graph.getRelationshipsTo(providerId, 'providedBy')
    const tools: ToolThing[] = []

    for (const rel of rels) {
      const tool = await this.graph.get<ToolThing>(rel.from)
      if (tool) {
        tools.push(tool)
      }
    }

    return tools
  }

  /**
   * Get provider for a tool
   */
  async getProviderForTool(toolId: string): Promise<ProviderThing | null> {
    const rels = await this.graph.getRelationshipsFrom(toolId, 'providedBy')

    if (rels.length === 0) {
      return null
    }

    // Return primary provider (first one or marked as primary)
    const primaryRel = rels.find((r) => r.data?.isPrimary) || rels[0]
    return this.graph.get<ProviderThing>(primaryRel!.to)
  }

  /**
   * Execute a tool by ID
   */
  async executeTool(
    toolId: string,
    params: Record<string, unknown>,
    credentials: RuntimeCredentials,
    context?: ToolContext
  ): Promise<unknown> {
    const handler = this.toolHandlers.get(toolId)

    if (!handler) {
      throw new ProviderError({
        code: 'HANDLER_NOT_FOUND',
        message: `No handler registered for tool '${toolId}'`,
        provider: 'bridge',
        toolId,
      })
    }

    return handler(params, credentials, context)
  }

  /**
   * Find tools by category
   */
  async findToolsByCategory(category: string): Promise<ToolThing[]> {
    return this.graph.findByType<ToolThing>('Tool', {
      where: { category },
    })
  }

  /**
   * Find providers by category
   */
  async findProvidersByCategory(category: string): Promise<ProviderThing[]> {
    return this.graph.findByType<ProviderThing>('Provider', {
      where: { category },
    })
  }

  /**
   * Find healthy providers
   */
  async findHealthyProviders(): Promise<ProviderThing[]> {
    return this.graph.findByType<ProviderThing>('Provider', {
      where: { healthStatus: 'healthy' },
    })
  }

  /**
   * Update provider health status
   */
  async updateProviderHealth(
    providerId: string,
    healthStatus: 'healthy' | 'degraded' | 'unhealthy'
  ): Promise<ProviderThing | null> {
    return this.graph.update<ProviderThing>(providerId, {
      data: {
        healthStatus,
        lastHealthCheck: Date.now(),
      },
    })
  }

  /**
   * Get statistics about registered providers
   */
  getStats(): ProviderBridgeStats {
    let totalTools = 0
    const categoryCount: Record<string, number> = {}

    for (const registered of this.providers.values()) {
      totalTools += registered.tools.length
      const category = registered.provider.data.category
      categoryCount[category] = (categoryCount[category] || 0) + 1
    }

    return {
      providerCount: this.providers.size,
      toolCount: totalTools,
      handlerCount: this.toolHandlers.size,
      categoryCount,
    }
  }

  /**
   * Clear all registered providers
   */
  async clear(): Promise<void> {
    await this.graph.clear()
    this.providers.clear()
    this.toolHandlers.clear()
  }
}

/**
 * Statistics about the provider bridge
 */
export interface ProviderBridgeStats {
  providerCount: number
  toolCount: number
  handlerCount: number
  categoryCount: Record<string, number>
}

// ============================================================================
// Compat Provider Metadata
// ============================================================================

/**
 * Known compat/ provider metadata
 * This maps compat/ module names to their configuration
 */
export const COMPAT_PROVIDERS: Record<string, Partial<ProviderRegistrationConfig>> = {
  // AI Providers
  openai: {
    name: 'OpenAI',
    category: 'ai',
    apiBaseUrl: 'https://api.openai.com/v1',
    capabilities: ['chat', 'completions', 'embeddings', 'images', 'audio'],
  },
  anthropic: {
    name: 'Anthropic',
    category: 'ai',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    capabilities: ['messages', 'completions'],
  },
  cohere: {
    name: 'Cohere',
    category: 'ai',
    apiBaseUrl: 'https://api.cohere.ai/v1',
    capabilities: ['generate', 'embed', 'classify', 'rerank'],
  },
  'google-ai': {
    name: 'Google AI',
    category: 'ai',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1',
    capabilities: ['generateContent', 'embedContent'],
  },

  // Communication
  sendgrid: {
    name: 'SendGrid',
    category: 'communication',
    apiBaseUrl: 'https://api.sendgrid.com/v3',
    capabilities: ['send', 'sendMultiple', 'templates', 'contacts'],
  },
  twilio: {
    name: 'Twilio',
    category: 'communication',
    apiBaseUrl: 'https://api.twilio.com',
    capabilities: ['sms', 'voice', 'video', 'chat'],
  },

  // Collaboration
  slack: {
    name: 'Slack',
    category: 'collaboration',
    apiBaseUrl: 'https://slack.com/api',
    capabilities: ['chat', 'conversations', 'users', 'reactions', 'files'],
  },
  discord: {
    name: 'Discord',
    category: 'collaboration',
    apiBaseUrl: 'https://discord.com/api/v10',
    capabilities: ['messages', 'channels', 'guilds', 'webhooks'],
  },

  // Commerce
  stripe: {
    name: 'Stripe',
    category: 'commerce',
    apiBaseUrl: 'https://api.stripe.com/v1',
    capabilities: ['customers', 'subscriptions', 'paymentIntents', 'charges', 'refunds', 'webhooks'],
  },
  shopify: {
    name: 'Shopify',
    category: 'commerce',
    apiBaseUrl: 'https://myshopify.com/admin/api',
    capabilities: ['products', 'orders', 'customers', 'inventory'],
  },

  // DevOps
  github: {
    name: 'GitHub',
    category: 'devops',
    apiBaseUrl: 'https://api.github.com',
    capabilities: ['repos', 'issues', 'pulls', 'actions', 'webhooks'],
  },
  sentry: {
    name: 'Sentry',
    category: 'devops',
    apiBaseUrl: 'https://sentry.io/api/0',
    capabilities: ['events', 'issues', 'projects', 'releases'],
  },
  linear: {
    name: 'Linear',
    category: 'project',
    apiBaseUrl: 'https://api.linear.app/graphql',
    capabilities: ['issues', 'projects', 'teams', 'cycles'],
  },

  // Database
  supabase: {
    name: 'Supabase',
    category: 'database',
    capabilities: ['database', 'auth', 'storage', 'functions', 'realtime'],
  },

  // Search
  algolia: {
    name: 'Algolia',
    category: 'search',
    capabilities: ['search', 'indexing', 'analytics'],
  },

  // Storage
  s3: {
    name: 'S3',
    category: 'storage',
    capabilities: ['putObject', 'getObject', 'deleteObject', 'listObjects'],
  },
  gcs: {
    name: 'Google Cloud Storage',
    category: 'storage',
    capabilities: ['upload', 'download', 'delete', 'list'],
  },

  // CRM
  salesforce: {
    name: 'Salesforce',
    category: 'crm',
    apiBaseUrl: 'https://login.salesforce.com',
    capabilities: ['accounts', 'contacts', 'leads', 'opportunities'],
  },
  hubspot: {
    name: 'HubSpot',
    category: 'crm',
    apiBaseUrl: 'https://api.hubapi.com',
    capabilities: ['contacts', 'companies', 'deals', 'tickets'],
  },

  // Helpdesk
  zendesk: {
    name: 'Zendesk',
    category: 'helpdesk',
    capabilities: ['tickets', 'users', 'organizations', 'macros'],
  },
  intercom: {
    name: 'Intercom',
    category: 'helpdesk',
    apiBaseUrl: 'https://api.intercom.io',
    capabilities: ['conversations', 'contacts', 'articles', 'messages'],
  },

  // Queue
  sqs: {
    name: 'SQS',
    category: 'queue',
    capabilities: ['sendMessage', 'receiveMessage', 'deleteMessage'],
  },

  // Auth
  auth0: {
    name: 'Auth0',
    category: 'auth',
    capabilities: ['users', 'roles', 'permissions', 'connections'],
  },
  clerk: {
    name: 'Clerk',
    category: 'auth',
    capabilities: ['users', 'sessions', 'organizations'],
  },

  // Analytics
  segment: {
    name: 'Segment',
    category: 'analytics',
    apiBaseUrl: 'https://api.segment.io/v1',
    capabilities: ['track', 'identify', 'page', 'group'],
  },

  // Automation
  zapier: {
    name: 'Zapier',
    category: 'automation',
    capabilities: ['triggers', 'actions', 'searches'],
  },
  n8n: {
    name: 'n8n',
    category: 'automation',
    capabilities: ['workflows', 'triggers', 'actions'],
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get compat provider metadata by name
 */
export function getCompatProviderMetadata(
  name: string
): Partial<ProviderRegistrationConfig> | undefined {
  return COMPAT_PROVIDERS[name.toLowerCase()]
}

/**
 * List all known compat provider names
 */
export function listCompatProviders(): string[] {
  return Object.keys(COMPAT_PROVIDERS)
}

/**
 * Create a provider bridge with a new graph
 */
export function createProviderBridge(
  graph: ToolProviderGraph,
  options?: ProviderBridgeOptions
): ProviderBridge {
  return new ProviderBridge(graph, options)
}
