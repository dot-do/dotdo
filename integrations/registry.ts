// Integration Registry - Central registry for third-party integrations
// Part of the dotdo integration registry system (do-laux)

import type {
  Integration,
  IntegrationConfig,
  IntegrationFactory,
  IntegrationStatus,
  IntegrationCategory,
  IntegrationResult,
  IntegrationError,
  RegisterIntegrationOptions,
  RegisteredIntegration,
} from './types'

/**
 * Error thrown by the integration registry
 */
export class IntegrationRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly integrationName?: string
  ) {
    super(message)
    this.name = 'IntegrationRegistryError'
  }
}

/**
 * Query options for listing integrations
 */
export interface ListIntegrationsOptions {
  /** Filter by status */
  status?: IntegrationStatus | IntegrationStatus[]
  /** Filter by category */
  category?: IntegrationCategory | IntegrationCategory[]
  /** Only return initialized integrations */
  initializedOnly?: boolean
}

/**
 * Integration summary for listing
 */
export interface IntegrationSummary {
  name: string
  version: string
  displayName: string
  category: IntegrationCategory
  status: IntegrationStatus
  description: string
}

/**
 * Integration Registry
 * Central registry for managing third-party integrations
 */
export class IntegrationRegistry {
  private integrations: Map<string, RegisteredIntegration> = new Map()
  private factories: Map<string, IntegrationFactory> = new Map()
  private initializationOrder: string[] = []

  /**
   * Register a new integration
   * @param integration - The integration instance or factory
   * @param options - Registration options
   */
  register<TConfig extends IntegrationConfig>(
    integration: Integration<TConfig> | IntegrationFactory<TConfig>,
    options: RegisterIntegrationOptions = {}
  ): void {
    // If it's a factory, call it to get the instance
    const instance = typeof integration === 'function' ? integration() : integration

    if (this.integrations.has(instance.name)) {
      throw new IntegrationRegistryError(
        `Integration "${instance.name}" is already registered`,
        'ALREADY_REGISTERED',
        instance.name
      )
    }

    // Store factory for lazy initialization if provided
    if (typeof integration === 'function') {
      this.factories.set(instance.name, integration as IntegrationFactory)
    }

    const entry: RegisteredIntegration<TConfig> = {
      integration: instance,
      options: {
        autoInit: options.autoInit ?? false,
        priority: options.priority ?? 100,
      },
    }

    this.integrations.set(instance.name, entry as RegisteredIntegration)

    // Update initialization order based on priority
    this.updateInitializationOrder()
  }

  /**
   * Unregister an integration
   * @param name - Name of the integration to unregister
   */
  async unregister(name: string): Promise<void> {
    const entry = this.integrations.get(name)
    if (!entry) {
      throw new IntegrationRegistryError(
        `Integration "${name}" is not registered`,
        'NOT_REGISTERED',
        name
      )
    }

    // Shutdown if the integration supports it
    if (entry.integration.shutdown) {
      await entry.integration.shutdown()
    }

    this.integrations.delete(name)
    this.factories.delete(name)
    this.updateInitializationOrder()
  }

  /**
   * Get an integration by name
   * @param name - Name of the integration
   * @returns The integration instance or undefined
   */
  get<TConfig extends IntegrationConfig = IntegrationConfig>(
    name: string
  ): Integration<TConfig> | undefined {
    const entry = this.integrations.get(name)
    return entry?.integration as Integration<TConfig> | undefined
  }

  /**
   * Get an integration, throwing if not found
   * @param name - Name of the integration
   * @returns The integration instance
   */
  getOrThrow<TConfig extends IntegrationConfig = IntegrationConfig>(
    name: string
  ): Integration<TConfig> {
    const integration = this.get<TConfig>(name)
    if (!integration) {
      throw new IntegrationRegistryError(
        `Integration "${name}" is not registered`,
        'NOT_REGISTERED',
        name
      )
    }
    return integration
  }

  /**
   * Check if an integration is registered
   * @param name - Name of the integration
   */
  has(name: string): boolean {
    return this.integrations.has(name)
  }

  /**
   * Initialize an integration with configuration
   * @param name - Name of the integration
   * @param config - Configuration for the integration
   */
  async init<TConfig extends IntegrationConfig>(
    name: string,
    config: TConfig
  ): Promise<void> {
    const entry = this.integrations.get(name)
    if (!entry) {
      throw new IntegrationRegistryError(
        `Integration "${name}" is not registered`,
        'NOT_REGISTERED',
        name
      )
    }

    // Store config
    entry.config = config

    // Initialize the integration
    await entry.integration.init(config)
  }

  /**
   * Initialize all integrations that have autoInit enabled and config available
   * @param configs - Map of integration names to their configs
   */
  async initAll(
    configs: Map<string, IntegrationConfig> | Record<string, IntegrationConfig>
  ): Promise<Map<string, Error | null>> {
    const configMap = configs instanceof Map ? configs : new Map(Object.entries(configs))
    const results = new Map<string, Error | null>()

    // Initialize in priority order
    for (const name of this.initializationOrder) {
      const entry = this.integrations.get(name)
      if (!entry) continue

      const config = configMap.get(name)
      if (!config && entry.options.autoInit) {
        continue // Skip if autoInit is true but no config provided
      }

      if (config) {
        try {
          await this.init(name, config)
          results.set(name, null)
        } catch (error) {
          results.set(name, error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    return results
  }

  /**
   * List all registered integrations
   * @param options - Filter options
   */
  list(options: ListIntegrationsOptions = {}): IntegrationSummary[] {
    const summaries: IntegrationSummary[] = []

    for (const [, entry] of this.integrations) {
      const integration = entry.integration

      // Filter by status
      if (options.status) {
        const statuses = Array.isArray(options.status) ? options.status : [options.status]
        if (!statuses.includes(integration.status)) continue
      }

      // Filter by category
      if (options.category) {
        const categories = Array.isArray(options.category)
          ? options.category
          : [options.category]
        if (!categories.includes(integration.metadata.category)) continue
      }

      // Filter by initialized only
      if (options.initializedOnly && integration.status !== 'ready') {
        continue
      }

      summaries.push({
        name: integration.name,
        version: integration.version,
        displayName: integration.metadata.displayName,
        category: integration.metadata.category,
        status: integration.status,
        description: integration.metadata.description,
      })
    }

    return summaries
  }

  /**
   * Get integrations by category
   * @param category - Category to filter by
   */
  getByCategory(category: IntegrationCategory): Integration[] {
    const integrations: Integration[] = []

    for (const [, entry] of this.integrations) {
      if (entry.integration.metadata.category === category) {
        integrations.push(entry.integration)
      }
    }

    return integrations
  }

  /**
   * Perform health check on all initialized integrations
   */
  async healthCheck(): Promise<Map<string, boolean | Error>> {
    const results = new Map<string, boolean | Error>()

    for (const [name, entry] of this.integrations) {
      if (entry.integration.status !== 'ready') {
        results.set(name, false)
        continue
      }

      if (!entry.integration.healthCheck) {
        results.set(name, true) // Assume healthy if no health check method
        continue
      }

      try {
        const healthy = await entry.integration.healthCheck()
        results.set(name, healthy)
      } catch (error) {
        results.set(name, error instanceof Error ? error : new Error(String(error)))
      }
    }

    return results
  }

  /**
   * Shutdown all integrations
   * @returns Map of integration names to errors (null if successful)
   */
  async shutdownAll(): Promise<Map<string, Error | null>> {
    const results = new Map<string, Error | null>()
    // Shutdown in reverse initialization order
    const reverseOrder = [...this.initializationOrder].reverse()

    for (const name of reverseOrder) {
      const entry = this.integrations.get(name)
      if (entry?.integration.shutdown) {
        try {
          await entry.integration.shutdown()
          results.set(name, null)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          results.set(name, err)
          // Continue shutting down other integrations even if one fails
        }
      }
    }

    return results
  }

  /**
   * Get the number of registered integrations
   */
  get size(): number {
    return this.integrations.size
  }

  /**
   * Get all integration names
   */
  get names(): string[] {
    return Array.from(this.integrations.keys())
  }

  /**
   * Clear all registrations (mainly for testing)
   */
  clear(): void {
    this.integrations.clear()
    this.factories.clear()
    this.initializationOrder = []
  }

  /**
   * Update the initialization order based on priorities
   */
  private updateInitializationOrder(): void {
    const entries = Array.from(this.integrations.entries())
    entries.sort((a, b) => (a[1].options.priority ?? 100) - (b[1].options.priority ?? 100))
    this.initializationOrder = entries.map(([name]) => name)
  }
}

/**
 * Global integration registry instance
 */
export const integrationRegistry = new IntegrationRegistry()

/**
 * Convenience function to register an integration
 */
export function registerIntegration<TConfig extends IntegrationConfig>(
  integration: Integration<TConfig> | IntegrationFactory<TConfig>,
  options?: RegisterIntegrationOptions
): void {
  integrationRegistry.register(integration, options)
}

/**
 * Convenience function to get an integration
 */
export function getIntegration<TConfig extends IntegrationConfig = IntegrationConfig>(
  name: string
): Integration<TConfig> | undefined {
  return integrationRegistry.get<TConfig>(name)
}

/**
 * Create a success result
 */
export function successResult<T>(data: T, requestId?: string): IntegrationResult<T> {
  const result: IntegrationResult<T> = { success: true, data }
  if (requestId !== undefined) {
    result.requestId = requestId
  }
  return result
}

/**
 * Create an error result
 */
export function errorResult<T = never>(
  code: string,
  message: string,
  originalError?: unknown,
  retryable = false
): IntegrationResult<T> {
  return {
    success: false,
    error: { code, message, originalError, retryable },
  }
}
