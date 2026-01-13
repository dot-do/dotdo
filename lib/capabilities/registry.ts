/**
 * Capability Registry for Runtime Feature Discovery
 *
 * Provides a registry for discovering what features are available at runtime.
 * Unlike the module-based CapabilityRegistry in lib/capabilities.ts (which handles
 * lazy-loading of capability implementations), this registry tracks feature availability
 * for runtime checks.
 *
 * Use cases:
 * - Check if vector search is available before using it
 * - Verify workflow runtime is present
 * - Discover available graph storage backends
 * - Feature flags for optional platform capabilities
 *
 * @example
 * ```typescript
 * import { featureRegistry, registerCapability, hasCapability, getCapabilities } from './registry'
 *
 * // Register capabilities at startup
 * registerCapability({
 *   name: 'vector-search',
 *   version: '1.0.0',
 *   description: 'Vector similarity search via Cloudflare Vectorize',
 * })
 *
 * // Check at runtime
 * if (hasCapability('vector-search')) {
 *   await vectorSearch.query(embedding)
 * }
 *
 * // List all capabilities
 * const caps = getCapabilities()
 * console.log(caps.map(c => c.name))
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Semantic version string (e.g., "1.0.0", "2.1.3-beta")
 */
export type SemVer = string

/**
 * Capability status
 */
export type CapabilityStatus = 'available' | 'degraded' | 'unavailable'

/**
 * Capability definition
 */
export interface Capability {
  /**
   * Unique identifier for the capability (e.g., 'vector-search', 'graph-store')
   */
  name: string

  /**
   * Semantic version of the capability implementation
   */
  version: SemVer

  /**
   * Human-readable description of the capability
   */
  description?: string

  /**
   * Other capabilities this one depends on
   */
  dependencies?: string[]

  /**
   * Current status of the capability
   * - 'available': Fully functional
   * - 'degraded': Partially working (e.g., fallback mode)
   * - 'unavailable': Not working but registered
   */
  status?: CapabilityStatus

  /**
   * Optional metadata for capability-specific configuration
   */
  metadata?: Record<string, unknown>
}

/**
 * Options for registering a capability
 */
export interface RegisterCapabilityOptions {
  /**
   * Force re-registration if capability already exists
   * @default false
   */
  force?: boolean

  /**
   * Validate that all dependencies are registered
   * @default true
   */
  validateDependencies?: boolean
}

/**
 * Filter options for getCapabilities
 */
export interface CapabilityFilter {
  /**
   * Filter by status
   */
  status?: CapabilityStatus | CapabilityStatus[]

  /**
   * Filter by name pattern (string for includes, RegExp for match)
   */
  name?: string | RegExp

  /**
   * Filter by dependency (returns caps that depend on this)
   */
  dependsOn?: string
}

/**
 * Result of dependency check
 */
export interface DependencyCheckResult {
  /**
   * Whether all dependencies are satisfied
   */
  satisfied: boolean

  /**
   * Missing dependencies
   */
  missing: string[]

  /**
   * Dependencies that exist but are not 'available' status
   */
  degraded: string[]
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when capability operations fail
 */
export class CapabilityRegistryError extends Error {
  name = 'CapabilityRegistryError'

  constructor(
    public capability: string,
    public reason: 'already_exists' | 'not_found' | 'dependency_missing' | 'invalid',
    message?: string,
  ) {
    super(message || CapabilityRegistryError.getDefaultMessage(capability, reason))
  }

  private static getDefaultMessage(
    capability: string,
    reason: 'already_exists' | 'not_found' | 'dependency_missing' | 'invalid',
  ): string {
    switch (reason) {
      case 'already_exists':
        return `Capability '${capability}' is already registered. Use { force: true } to override.`
      case 'not_found':
        return `Capability '${capability}' is not registered.`
      case 'dependency_missing':
        return `Capability '${capability}' has missing dependencies.`
      case 'invalid':
        return `Invalid capability configuration for '${capability}'.`
    }
  }
}

// ============================================================================
// FEATURE CAPABILITY REGISTRY
// ============================================================================

/**
 * Registry for runtime feature discovery
 *
 * Tracks which features/capabilities are available at runtime, allowing
 * code to check for feature availability before attempting to use them.
 */
export class FeatureCapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map()
  private dependentsIndex: Map<string, Set<string>> = new Map()

  /**
   * Register a capability
   *
   * @param capability - The capability to register
   * @param options - Registration options
   * @throws {CapabilityRegistryError} If capability already exists (without force) or has missing dependencies
   */
  registerCapability(
    capability: Capability,
    options: RegisterCapabilityOptions = {},
  ): void {
    const { force = false, validateDependencies = true } = options

    // Validate capability
    this.validateCapability(capability)

    // Check for existing registration
    if (this.capabilities.has(capability.name) && !force) {
      throw new CapabilityRegistryError(capability.name, 'already_exists')
    }

    // Validate dependencies if requested
    if (validateDependencies && capability.dependencies?.length) {
      const depCheck = this.checkDependencies(capability.dependencies)
      if (!depCheck.satisfied) {
        throw new CapabilityRegistryError(
          capability.name,
          'dependency_missing',
          `Capability '${capability.name}' has missing dependencies: ${depCheck.missing.join(', ')}`,
        )
      }
    }

    // If force re-registering, clean up old index entries
    if (force && this.capabilities.has(capability.name)) {
      this.removeFromDependentsIndex(capability.name)
    }

    // Store capability with default status
    const cap: Capability = {
      ...capability,
      status: capability.status ?? 'available',
    }
    this.capabilities.set(capability.name, cap)

    // Update dependents index
    for (const dep of capability.dependencies ?? []) {
      if (!this.dependentsIndex.has(dep)) {
        this.dependentsIndex.set(dep, new Set())
      }
      this.dependentsIndex.get(dep)!.add(capability.name)
    }
  }

  /**
   * Unregister a capability
   *
   * @param name - The capability name to unregister
   * @returns Whether the capability was found and removed
   */
  unregisterCapability(name: string): boolean {
    if (!this.capabilities.has(name)) {
      return false
    }

    this.removeFromDependentsIndex(name)
    this.capabilities.delete(name)

    // Also remove this capability from dependents index (as a dependency)
    this.dependentsIndex.delete(name)

    return true
  }

  /**
   * Check if a capability is registered
   *
   * @param name - The capability name to check
   * @returns Whether the capability exists
   */
  hasCapability(name: string): boolean {
    return this.capabilities.has(name)
  }

  /**
   * Check if a capability is available (registered and status is 'available')
   *
   * @param name - The capability name to check
   * @returns Whether the capability is available
   */
  isCapabilityAvailable(name: string): boolean {
    const cap = this.capabilities.get(name)
    return cap?.status === 'available'
  }

  /**
   * Get a specific capability by name
   *
   * @param name - The capability name
   * @returns The capability or undefined if not found
   */
  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name)
  }

  /**
   * Get all registered capabilities, optionally filtered
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching capabilities
   */
  getCapabilities(filter?: CapabilityFilter): Capability[] {
    const results: Capability[] = []

    for (const cap of Array.from(this.capabilities.values())) {
      // Apply status filter
      if (filter?.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
        if (!statuses.includes(cap.status ?? 'available')) {
          continue
        }
      }

      // Apply name filter
      if (filter?.name) {
        if (typeof filter.name === 'string') {
          if (!cap.name.includes(filter.name)) continue
        } else {
          if (!filter.name.test(cap.name)) continue
        }
      }

      // Apply dependsOn filter
      if (filter?.dependsOn) {
        if (!cap.dependencies?.includes(filter.dependsOn)) {
          continue
        }
      }

      results.push(cap)
    }

    return results
  }

  /**
   * List all registered capability names
   *
   * @returns Array of capability names
   */
  listCapabilities(): string[] {
    return Array.from(this.capabilities.keys())
  }

  /**
   * Update a capability's status
   *
   * @param name - The capability name
   * @param status - The new status
   * @returns Whether the capability was found and updated
   */
  setCapabilityStatus(name: string, status: CapabilityStatus): boolean {
    const cap = this.capabilities.get(name)
    if (!cap) {
      return false
    }

    cap.status = status
    return true
  }

  /**
   * Check if dependencies are satisfied
   *
   * @param dependencies - Array of capability names to check
   * @returns Dependency check result
   */
  checkDependencies(dependencies: string[]): DependencyCheckResult {
    const missing: string[] = []
    const degraded: string[] = []

    for (const dep of dependencies) {
      const cap = this.capabilities.get(dep)
      if (!cap) {
        missing.push(dep)
      } else if (cap.status !== 'available') {
        degraded.push(dep)
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
      degraded,
    }
  }

  /**
   * Get capabilities that depend on a given capability
   *
   * @param name - The dependency name
   * @returns Array of capability names that depend on it
   */
  getDependents(name: string): string[] {
    const dependents = this.dependentsIndex.get(name)
    return dependents ? Array.from(dependents) : []
  }

  /**
   * Clear all registered capabilities
   */
  clear(): void {
    this.capabilities.clear()
    this.dependentsIndex.clear()
  }

  /**
   * Get registry statistics
   */
  getStats(): { total: number; byStatus: Record<CapabilityStatus, number> } {
    const stats = {
      total: this.capabilities.size,
      byStatus: {
        available: 0,
        degraded: 0,
        unavailable: 0,
      },
    }

    for (const cap of Array.from(this.capabilities.values())) {
      const status = cap.status ?? 'available'
      stats.byStatus[status]++
    }

    return stats
  }

  /**
   * Export registry to JSON
   */
  toJSON(): { capabilities: Capability[] } {
    return {
      capabilities: Array.from(this.capabilities.values()),
    }
  }

  /**
   * Import capabilities from JSON
   */
  fromJSON(
    data: { capabilities: Capability[] },
    options: RegisterCapabilityOptions = {},
  ): void {
    for (const cap of data.capabilities) {
      this.registerCapability(cap, options)
    }
  }

  /**
   * Validate capability configuration
   */
  private validateCapability(capability: Capability): void {
    if (!capability.name) {
      throw new CapabilityRegistryError('', 'invalid', 'Capability name is required')
    }

    // Validate name format (kebab-case recommended)
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/.test(capability.name)) {
      throw new CapabilityRegistryError(
        capability.name,
        'invalid',
        `Invalid capability name: '${capability.name}'. Names should be lowercase kebab-case (e.g., 'vector-search').`,
      )
    }

    if (!capability.version) {
      throw new CapabilityRegistryError(
        capability.name,
        'invalid',
        'Capability version is required',
      )
    }

    // Basic semver validation
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/.test(capability.version)) {
      throw new CapabilityRegistryError(
        capability.name,
        'invalid',
        `Invalid version format: '${capability.version}'. Use semantic versioning (e.g., '1.0.0').`,
      )
    }
  }

  /**
   * Remove a capability from the dependents index
   */
  private removeFromDependentsIndex(name: string): void {
    const cap = this.capabilities.get(name)
    if (cap?.dependencies) {
      for (const dep of cap.dependencies) {
        this.dependentsIndex.get(dep)?.delete(name)
        // Clean up empty sets
        if (this.dependentsIndex.get(dep)?.size === 0) {
          this.dependentsIndex.delete(dep)
        }
      }
    }
  }
}

// ============================================================================
// DEFAULT REGISTRY & CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Global default feature registry
 */
export const featureRegistry = new FeatureCapabilityRegistry()

/**
 * Register a capability to the default registry
 *
 * @param capability - The capability to register
 * @param options - Registration options
 */
export function registerCapability(
  capability: Capability,
  options?: RegisterCapabilityOptions,
): void {
  featureRegistry.registerCapability(capability, options)
}

/**
 * Check if a capability is registered in the default registry
 *
 * @param name - The capability name to check
 * @returns Whether the capability exists
 */
export function hasCapability(name: string): boolean {
  return featureRegistry.hasCapability(name)
}

/**
 * Get all capabilities from the default registry
 *
 * @param filter - Optional filter criteria
 * @returns Array of matching capabilities
 */
export function getCapabilities(filter?: CapabilityFilter): Capability[] {
  return featureRegistry.getCapabilities(filter)
}

/**
 * Get a specific capability from the default registry
 *
 * @param name - The capability name
 * @returns The capability or undefined
 */
export function getCapability(name: string): Capability | undefined {
  return featureRegistry.getCapability(name)
}

/**
 * Check if a capability is available in the default registry
 *
 * @param name - The capability name
 * @returns Whether the capability is available
 */
export function isCapabilityAvailable(name: string): boolean {
  return featureRegistry.isCapabilityAvailable(name)
}

// ============================================================================
// WELL-KNOWN CAPABILITIES
// ============================================================================

/**
 * Well-known capability names used in the dotdo platform
 */
export const WellKnownCapabilities = {
  // Storage
  VECTOR_SEARCH: 'vector-search',
  GRAPH_STORE: 'graph-store',
  OBJECT_STORAGE: 'object-storage',
  KV_STORAGE: 'kv-storage',

  // Runtime
  WORKFLOW_RUNTIME: 'workflow-runtime',
  AGENT_RUNTIME: 'agent-runtime',
  FUNCTION_RUNTIME: 'function-runtime',

  // AI
  AI_GATEWAY: 'ai-gateway',
  EMBEDDINGS: 'embeddings',
  LLM_INFERENCE: 'llm-inference',

  // Platform
  DURABLE_OBJECTS: 'durable-objects',
  QUEUES: 'queues',
  CRON: 'cron',
  ANALYTICS: 'analytics',

  // Extensions
  BROWSER_RENDERING: 'browser-rendering',
  EMAIL_SENDING: 'email-sending',
  SMS_SENDING: 'sms-sending',
} as const

export type WellKnownCapability = (typeof WellKnownCapabilities)[keyof typeof WellKnownCapabilities]

/**
 * Create a standard capability definition for a well-known capability
 */
export function createWellKnownCapability(
  name: WellKnownCapability,
  version: SemVer,
  options?: Partial<Omit<Capability, 'name' | 'version'>>,
): Capability {
  return {
    name,
    version,
    ...options,
  }
}
