// Integration Registry - Central registry for third-party integrations
// Part of the dotdo integration registry system (do-laux)
/**
 * Error thrown by the integration registry
 */
export class IntegrationRegistryError extends Error {
    code;
    integrationName;
    constructor(message, code, integrationName) {
        super(message);
        this.code = code;
        this.integrationName = integrationName;
        this.name = 'IntegrationRegistryError';
    }
}
/**
 * Integration Registry
 * Central registry for managing third-party integrations
 */
export class IntegrationRegistry {
    integrations = new Map();
    factories = new Map();
    initializationOrder = [];
    /**
     * Register a new integration
     * @param integration - The integration instance or factory
     * @param options - Registration options
     */
    register(integration, options = {}) {
        // If it's a factory, call it to get the instance
        const instance = typeof integration === 'function' ? integration() : integration;
        if (this.integrations.has(instance.name)) {
            throw new IntegrationRegistryError(`Integration "${instance.name}" is already registered`, 'ALREADY_REGISTERED', instance.name);
        }
        // Store factory for lazy initialization if provided
        if (typeof integration === 'function') {
            this.factories.set(instance.name, integration);
        }
        const entry = {
            integration: instance,
            options: {
                autoInit: options.autoInit ?? false,
                priority: options.priority ?? 100,
            },
        };
        this.integrations.set(instance.name, entry);
        // Update initialization order based on priority
        this.updateInitializationOrder();
    }
    /**
     * Unregister an integration
     * @param name - Name of the integration to unregister
     */
    async unregister(name) {
        const entry = this.integrations.get(name);
        if (!entry) {
            throw new IntegrationRegistryError(`Integration "${name}" is not registered`, 'NOT_REGISTERED', name);
        }
        // Shutdown if the integration supports it
        if (entry.integration.shutdown) {
            await entry.integration.shutdown();
        }
        this.integrations.delete(name);
        this.factories.delete(name);
        this.updateInitializationOrder();
    }
    /**
     * Get an integration by name
     * @param name - Name of the integration
     * @returns The integration instance or undefined
     */
    get(name) {
        const entry = this.integrations.get(name);
        return entry?.integration;
    }
    /**
     * Get an integration, throwing if not found
     * @param name - Name of the integration
     * @returns The integration instance
     */
    getOrThrow(name) {
        const integration = this.get(name);
        if (!integration) {
            throw new IntegrationRegistryError(`Integration "${name}" is not registered`, 'NOT_REGISTERED', name);
        }
        return integration;
    }
    /**
     * Check if an integration is registered
     * @param name - Name of the integration
     */
    has(name) {
        return this.integrations.has(name);
    }
    /**
     * Initialize an integration with configuration
     * @param name - Name of the integration
     * @param config - Configuration for the integration
     */
    async init(name, config) {
        const entry = this.integrations.get(name);
        if (!entry) {
            throw new IntegrationRegistryError(`Integration "${name}" is not registered`, 'NOT_REGISTERED', name);
        }
        // Store config
        entry.config = config;
        // Initialize the integration
        await entry.integration.init(config);
    }
    /**
     * Initialize all integrations that have autoInit enabled and config available
     * @param configs - Map of integration names to their configs
     */
    async initAll(configs) {
        const configMap = configs instanceof Map ? configs : new Map(Object.entries(configs));
        const results = new Map();
        // Initialize in priority order
        for (const name of this.initializationOrder) {
            const entry = this.integrations.get(name);
            if (!entry)
                continue;
            const config = configMap.get(name);
            if (!config && entry.options.autoInit) {
                continue; // Skip if autoInit is true but no config provided
            }
            if (config) {
                try {
                    await this.init(name, config);
                    results.set(name, null);
                }
                catch (error) {
                    results.set(name, error instanceof Error ? error : new Error(String(error)));
                }
            }
        }
        return results;
    }
    /**
     * List all registered integrations
     * @param options - Filter options
     */
    list(options = {}) {
        const summaries = [];
        for (const [, entry] of this.integrations) {
            const integration = entry.integration;
            // Filter by status
            if (options.status) {
                const statuses = Array.isArray(options.status) ? options.status : [options.status];
                if (!statuses.includes(integration.status))
                    continue;
            }
            // Filter by category
            if (options.category) {
                const categories = Array.isArray(options.category)
                    ? options.category
                    : [options.category];
                if (!categories.includes(integration.metadata.category))
                    continue;
            }
            // Filter by initialized only
            if (options.initializedOnly && integration.status !== 'ready') {
                continue;
            }
            summaries.push({
                name: integration.name,
                version: integration.version,
                displayName: integration.metadata.displayName,
                category: integration.metadata.category,
                status: integration.status,
                description: integration.metadata.description,
            });
        }
        return summaries;
    }
    /**
     * Get integrations by category
     * @param category - Category to filter by
     */
    getByCategory(category) {
        const integrations = [];
        for (const [, entry] of this.integrations) {
            if (entry.integration.metadata.category === category) {
                integrations.push(entry.integration);
            }
        }
        return integrations;
    }
    /**
     * Perform health check on all initialized integrations
     */
    async healthCheck() {
        const results = new Map();
        for (const [name, entry] of this.integrations) {
            if (entry.integration.status !== 'ready') {
                results.set(name, false);
                continue;
            }
            if (!entry.integration.healthCheck) {
                results.set(name, true); // Assume healthy if no health check method
                continue;
            }
            try {
                const healthy = await entry.integration.healthCheck();
                results.set(name, healthy);
            }
            catch (error) {
                results.set(name, error instanceof Error ? error : new Error(String(error)));
            }
        }
        return results;
    }
    /**
     * Shutdown all integrations
     * @returns Map of integration names to errors (null if successful)
     */
    async shutdownAll() {
        const results = new Map();
        // Shutdown in reverse initialization order
        const reverseOrder = [...this.initializationOrder].reverse();
        for (const name of reverseOrder) {
            const entry = this.integrations.get(name);
            if (entry?.integration.shutdown) {
                try {
                    await entry.integration.shutdown();
                    results.set(name, null);
                }
                catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    results.set(name, err);
                    // Continue shutting down other integrations even if one fails
                }
            }
        }
        return results;
    }
    /**
     * Get the number of registered integrations
     */
    get size() {
        return this.integrations.size;
    }
    /**
     * Get all integration names
     */
    get names() {
        return Array.from(this.integrations.keys());
    }
    /**
     * Clear all registrations (mainly for testing)
     */
    clear() {
        this.integrations.clear();
        this.factories.clear();
        this.initializationOrder = [];
    }
    /**
     * Update the initialization order based on priorities
     */
    updateInitializationOrder() {
        const entries = Array.from(this.integrations.entries());
        entries.sort((a, b) => (a[1].options.priority ?? 100) - (b[1].options.priority ?? 100));
        this.initializationOrder = entries.map(([name]) => name);
    }
}
/**
 * Global integration registry instance
 */
export const integrationRegistry = new IntegrationRegistry();
/**
 * Convenience function to register an integration
 */
export function registerIntegration(integration, options) {
    integrationRegistry.register(integration, options);
}
/**
 * Convenience function to get an integration
 */
export function getIntegration(name) {
    return integrationRegistry.get(name);
}
/**
 * Create a success result
 */
export function successResult(data, requestId) {
    const result = { success: true, data };
    if (requestId !== undefined) {
        result.requestId = requestId;
    }
    return result;
}
/**
 * Create an error result
 */
export function errorResult(code, message, originalError, retryable = false) {
    return {
        success: false,
        error: { code, message, originalError, retryable },
    };
}
//# sourceMappingURL=registry.js.map