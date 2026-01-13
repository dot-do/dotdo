/**
 * @dotdo/lib/tools/auto-register.ts - Provider Tool Auto-Registration
 *
 * Orchestrates automatic registration of compat/ providers as Tool Things.
 * Provides a registry pattern for managing provider adapters.
 *
 * @example
 * ```typescript
 * import { ProviderRegistry, registerAllProviders } from 'lib/tools/auto-register'
 *
 * // Register individual providers
 * const registry = new ProviderRegistry()
 * registry.register(sendgridAdapter)
 * registry.register(stripeAdapter)
 *
 * // Or register all at once
 * await registerAllProviders(registry)
 *
 * // Execute a tool
 * const result = await registry.execute(
 *   'sendgrid',
 *   'send_email',
 *   { to: 'user@example.com', subject: 'Hello' },
 *   { apiKey: 'sg-xxx' }
 * )
 * ```
 *
 * @see lib/tools/provider-adapter.ts for adapter interface
 */

import type {
  ProviderToolAdapter,
  ProviderMetadata,
  ToolDefinition,
  RuntimeCredentials,
  ToolContext,
  ToolCategory,
} from './provider-adapter'
import { ProviderError, createToolId } from './provider-adapter'

// =============================================================================
// Provider Registry Interface
// =============================================================================

/**
 * Filter options for listing providers
 */
export interface ProviderFilter {
  /** Filter by category */
  category?: ToolCategory
  /** Filter by credential type */
  credentialType?: string
  /** Search by name or description */
  search?: string
  /** Include deprecated tools */
  includeDeprecated?: boolean
}

/**
 * Filter options for listing tools
 */
export interface ToolFilter {
  /** Filter by provider name */
  provider?: string
  /** Filter by tags */
  tags?: string[]
  /** Include deprecated tools */
  includeDeprecated?: boolean
  /** Search by name or description */
  search?: string
}

/**
 * Tool with provider context
 */
export interface ToolWithProvider {
  tool: ToolDefinition
  provider: ProviderMetadata
  fullyQualifiedId: string
}

/**
 * Registration event types
 */
export type RegistrationEventType = 'registered' | 'unregistered' | 'updated'

/**
 * Registration event
 */
export interface RegistrationEvent {
  type: RegistrationEventType
  provider: string
  timestamp: Date
}

/**
 * Event listener for registration events
 */
export type RegistrationEventListener = (event: RegistrationEvent) => void

// =============================================================================
// Provider Registry Implementation
// =============================================================================

/**
 * Registry for managing provider adapters
 */
export class ProviderRegistry {
  private adapters: Map<string, ProviderToolAdapter> = new Map()
  private listeners: Set<RegistrationEventListener> = new Set()

  /**
   * Register a provider adapter
   */
  register(adapter: ProviderToolAdapter): void {
    const existing = this.adapters.get(adapter.name)
    this.adapters.set(adapter.name, adapter)

    this.emit({
      type: existing ? 'updated' : 'registered',
      provider: adapter.name,
      timestamp: new Date(),
    })
  }

  /**
   * Unregister a provider adapter
   */
  unregister(name: string): boolean {
    const removed = this.adapters.delete(name)

    if (removed) {
      this.emit({
        type: 'unregistered',
        provider: name,
        timestamp: new Date(),
      })
    }

    return removed
  }

  /**
   * Get a provider adapter by name
   */
  get(name: string): ProviderToolAdapter | undefined {
    return this.adapters.get(name)
  }

  /**
   * Check if a provider is registered
   */
  has(name: string): boolean {
    return this.adapters.has(name)
  }

  /**
   * Get all registered provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Get all provider metadata with optional filtering
   */
  getProviders(filter?: ProviderFilter): ProviderMetadata[] {
    const providers: ProviderMetadata[] = []

    for (const adapter of this.adapters.values()) {
      const metadata = adapter.getMetadata()

      // Apply filters
      if (filter?.category && metadata.category !== filter.category) {
        continue
      }

      if (filter?.credentialType && metadata.credential.type !== filter.credentialType) {
        continue
      }

      if (filter?.search) {
        const searchLower = filter.search.toLowerCase()
        const matches =
          metadata.name.toLowerCase().includes(searchLower) ||
          metadata.displayName.toLowerCase().includes(searchLower) ||
          metadata.description.toLowerCase().includes(searchLower)
        if (!matches) {
          continue
        }
      }

      providers.push(metadata)
    }

    return providers
  }

  /**
   * Get all tools with optional filtering
   */
  getTools(filter?: ToolFilter): ToolWithProvider[] {
    const tools: ToolWithProvider[] = []

    for (const adapter of this.adapters.values()) {
      // Skip if filtering by provider
      if (filter?.provider && adapter.name !== filter.provider) {
        continue
      }

      const metadata = adapter.getMetadata()

      for (const tool of adapter.getTools()) {
        // Skip deprecated tools unless requested
        if (tool.deprecated && !filter?.includeDeprecated) {
          continue
        }

        // Filter by tags
        if (filter?.tags && filter.tags.length > 0) {
          const hasMatchingTag = tool.tags?.some(tag => filter.tags!.includes(tag))
          if (!hasMatchingTag) {
            continue
          }
        }

        // Search filter
        if (filter?.search) {
          const searchLower = filter.search.toLowerCase()
          const matches =
            tool.id.toLowerCase().includes(searchLower) ||
            tool.name.toLowerCase().includes(searchLower) ||
            tool.description.toLowerCase().includes(searchLower)
          if (!matches) {
            continue
          }
        }

        tools.push({
          tool,
          provider: metadata,
          fullyQualifiedId: createToolId(metadata.category, adapter.name, tool.id),
        })
      }
    }

    return tools
  }

  /**
   * Get a specific tool by provider and tool ID
   */
  getTool(providerName: string, toolId: string): ToolDefinition | undefined {
    const adapter = this.adapters.get(providerName)
    return adapter?.getTool(toolId)
  }

  /**
   * Execute a tool
   */
  async execute<TResult = unknown>(
    providerName: string,
    toolId: string,
    params: Record<string, unknown>,
    credentials: RuntimeCredentials,
    context?: ToolContext
  ): Promise<TResult> {
    const adapter = this.adapters.get(providerName)

    if (!adapter) {
      throw new ProviderError({
        code: 'PROVIDER_NOT_FOUND',
        message: `Provider '${providerName}' not found in registry`,
        provider: providerName,
      })
    }

    return adapter.execute<TResult>(toolId, params, credentials, context)
  }

  /**
   * Execute a tool by fully qualified ID
   */
  async executeByFullId<TResult = unknown>(
    fullyQualifiedId: string,
    params: Record<string, unknown>,
    credentials: RuntimeCredentials,
    context?: ToolContext
  ): Promise<TResult> {
    const parts = fullyQualifiedId.split('.')

    if (parts.length !== 3) {
      throw new ProviderError({
        code: 'INVALID_TOOL_ID',
        message: `Invalid fully qualified tool ID: ${fullyQualifiedId}. Expected format: category.provider.operation`,
        provider: 'registry',
      })
    }

    const [, providerName, toolId] = parts
    return this.execute<TResult>(providerName, toolId, params, credentials, context)
  }

  /**
   * Validate credentials for a provider
   */
  async validateCredentials(
    providerName: string,
    credentials: RuntimeCredentials
  ): Promise<boolean> {
    const adapter = this.adapters.get(providerName)

    if (!adapter) {
      throw new ProviderError({
        code: 'PROVIDER_NOT_FOUND',
        message: `Provider '${providerName}' not found in registry`,
        provider: providerName,
      })
    }

    if (adapter.validateCredentials) {
      return adapter.validateCredentials(credentials)
    }

    // Default: assume valid if no validator
    return true
  }

  /**
   * Get statistics about the registry
   */
  getStats(): RegistryStats {
    let totalTools = 0
    const categoryCount: Record<string, number> = {}

    for (const adapter of this.adapters.values()) {
      const metadata = adapter.getMetadata()
      totalTools += metadata.toolCount

      categoryCount[metadata.category] = (categoryCount[metadata.category] ?? 0) + 1
    }

    return {
      providerCount: this.adapters.size,
      toolCount: totalTools,
      categoryCount,
    }
  }

  /**
   * Subscribe to registration events
   */
  subscribe(listener: RegistrationEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    const providers = Array.from(this.adapters.keys())
    this.adapters.clear()

    for (const provider of providers) {
      this.emit({
        type: 'unregistered',
        provider,
        timestamp: new Date(),
      })
    }
  }

  /**
   * Emit a registration event
   */
  private emit(event: RegistrationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Registry statistics
 */
export interface RegistryStats {
  providerCount: number
  toolCount: number
  categoryCount: Record<string, number>
}

// =============================================================================
// Global Registry
// =============================================================================

/**
 * Global provider registry instance
 */
export const globalRegistry = new ProviderRegistry()

// =============================================================================
// Auto-Registration Functions
// =============================================================================

/**
 * Provider adapter factory function type
 */
export type AdapterFactory = () => ProviderToolAdapter | Promise<ProviderToolAdapter>

/**
 * Registry of adapter factories for lazy loading
 */
const adapterFactories: Map<string, AdapterFactory> = new Map()

/**
 * Register an adapter factory for lazy loading
 */
export function registerAdapterFactory(name: string, factory: AdapterFactory): void {
  adapterFactories.set(name, factory)
}

/**
 * Get all registered adapter factory names
 */
export function getAdapterFactoryNames(): string[] {
  return Array.from(adapterFactories.keys())
}

/**
 * Load and register a single provider by name
 */
export async function loadProvider(
  registry: ProviderRegistry,
  name: string
): Promise<ProviderToolAdapter | null> {
  const factory = adapterFactories.get(name)

  if (!factory) {
    return null
  }

  try {
    const adapter = await factory()
    registry.register(adapter)
    return adapter
  } catch (error) {
    console.error(`Failed to load provider '${name}':`, error)
    return null
  }
}

/**
 * Load and register all providers from factories
 */
export async function loadAllProviders(
  registry: ProviderRegistry = globalRegistry
): Promise<LoadResult> {
  const results: LoadResult = {
    loaded: [],
    failed: [],
    total: adapterFactories.size,
  }

  const promises = Array.from(adapterFactories.entries()).map(async ([name, factory]) => {
    try {
      const adapter = await factory()
      registry.register(adapter)
      results.loaded.push(name)
    } catch (error) {
      results.failed.push({
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  await Promise.all(promises)

  return results
}

/**
 * Result of loading providers
 */
export interface LoadResult {
  loaded: string[]
  failed: Array<{ name: string; error: string }>
  total: number
}

// =============================================================================
// Tool Conversion for Thing Graph
// =============================================================================

/**
 * Thing representation for graph storage
 */
export interface ToolThing {
  $type: 'Tool'
  $id: string
  data: {
    id: string
    name: string
    description: string
    provider: string
    category: ToolCategory
    parameters: Record<string, unknown>
    tags?: string[]
    deprecated?: boolean
    rateLimitTier?: string
  }
}

/**
 * Provider Thing representation
 */
export interface ProviderThing {
  $type: 'Provider'
  $id: string
  data: ProviderMetadata
}

/**
 * Convert registry to Thing representations
 */
export function registryToThings(registry: ProviderRegistry): {
  providers: ProviderThing[]
  tools: ToolThing[]
  relationships: Array<{ verb: string; from: string; to: string }>
} {
  const providers: ProviderThing[] = []
  const tools: ToolThing[] = []
  const relationships: Array<{ verb: string; from: string; to: string }> = []

  for (const providerName of registry.getProviderNames()) {
    const adapter = registry.get(providerName)
    if (!adapter) continue

    const metadata = adapter.getMetadata()

    // Create Provider Thing
    const providerId = `provider:${metadata.name}`
    providers.push({
      $type: 'Provider',
      $id: providerId,
      data: metadata,
    })

    // Create Tool Things and relationships
    for (const tool of adapter.getTools()) {
      const toolId = createToolId(metadata.category, metadata.name, tool.id)

      tools.push({
        $type: 'Tool',
        $id: `tool:${toolId}`,
        data: {
          id: tool.id,
          name: tool.name,
          description: tool.description,
          provider: metadata.name,
          category: metadata.category,
          parameters: tool.parameters,
          tags: tool.tags,
          deprecated: tool.deprecated,
          rateLimitTier: tool.rateLimitTier,
        },
      })

      // Tool is provided by Provider
      relationships.push({
        verb: 'providedBy',
        from: `tool:${toolId}`,
        to: providerId,
      })
    }
  }

  return { providers, tools, relationships }
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Create a minimal registry for testing
 */
export function createTestRegistry(): ProviderRegistry {
  return new ProviderRegistry()
}
