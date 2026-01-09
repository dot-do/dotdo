/**
 * Capability Lazy Loading System
 *
 * Provides lazy loading of capability modules ($.fs, $.git, $.bash, etc.)
 * Modules are loaded on first access and cached for subsequent use.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A capability module constructor
 */
export type CapabilityModule = new (...args: unknown[]) => unknown

/**
 * An async factory function for creating capability instances
 */
export type CapabilityFactory = () => Promise<unknown>

/**
 * Options for registering a capability
 */
export interface CapabilityOptions {
  /** Force re-registration even if capability already exists */
  force?: boolean
  /** Pass the registry context to the capability constructor */
  passContext?: boolean
}

/**
 * Options for creating a capability proxy
 */
export interface CapabilityProxyOptions {
  /** Property names that should return undefined instead of throwing */
  reservedNames?: string[]
}

/**
 * Result of destroying the registry
 */
export interface DestroyResult {
  /** Errors that occurred during cleanup */
  errors: Array<{ capability: string; error: Error }>
}

/**
 * A proxy object for accessing capabilities
 */
export type CapabilityProxy = Record<string, unknown>

// ============================================================================
// CAPABILITY ERROR
// ============================================================================

/**
 * Error thrown when accessing an unavailable capability
 */
export class CapabilityError extends Error {
  name = 'CapabilityError'

  constructor(
    public capability: string,
    public reason: 'not_available' | 'permission_denied' | 'load_failed',
    message?: string,
  ) {
    const defaultMessage = CapabilityError.getDefaultMessage(capability, reason)
    super(message || defaultMessage)
  }

  private static getDefaultMessage(
    capability: string,
    reason: 'not_available' | 'permission_denied' | 'load_failed',
  ): string {
    switch (reason) {
      case 'not_available':
        return `Capability '${capability}' is not registered`
      case 'permission_denied':
        return `Permission denied for capability '${capability}'`
      case 'load_failed':
        return `Failed to load capability '${capability}'`
    }
  }
}

// ============================================================================
// REGISTERED CAPABILITY
// ============================================================================

interface RegisteredCapability {
  type: 'module' | 'factory'
  module?: CapabilityModule
  factory?: CapabilityFactory
  options: CapabilityOptions
}

// ============================================================================
// CAPABILITY REGISTRY
// ============================================================================

/**
 * Registry for capability modules with lazy loading support
 */
export class CapabilityRegistry {
  /** Registered module constructors */
  private modules: Map<string, RegisteredCapability> = new Map()

  /** Cached capability instances (loaded lazily) */
  private instances: Map<string, unknown> = new Map()

  /**
   * Register a capability module (constructor)
   */
  register(name: string, module: CapabilityModule, options: CapabilityOptions = {}): void {
    if (this.modules.has(name) && !options.force) {
      throw new Error(`Capability '${name}' is already registered. Use { force: true } to override.`)
    }

    // If force re-registering, clear any cached instance
    if (options.force && this.instances.has(name)) {
      this.instances.delete(name)
    }

    this.modules.set(name, {
      type: 'module',
      module,
      options,
    })
  }

  /**
   * Register a capability factory (async function)
   */
  registerFactory(name: string, factory: CapabilityFactory, options: CapabilityOptions = {}): void {
    if (this.modules.has(name) && !options.force) {
      throw new Error(`Capability '${name}' is already registered. Use { force: true } to override.`)
    }

    // If force re-registering, clear any cached instance
    if (options.force && this.instances.has(name)) {
      this.instances.delete(name)
    }

    this.modules.set(name, {
      type: 'factory',
      factory,
      options,
    })
  }

  /**
   * Unregister a capability
   */
  unregister(name: string): boolean {
    const existed = this.modules.has(name)
    this.modules.delete(name)
    this.instances.delete(name)
    return existed
  }

  /**
   * Check if a capability is registered
   */
  has(name: string): boolean {
    return this.modules.has(name)
  }

  /**
   * List all registered capability names
   */
  list(): string[] {
    return Array.from(this.modules.keys())
  }

  /**
   * Check if a capability has been loaded (instantiated)
   */
  isLoaded(name: string): boolean {
    return this.instances.has(name)
  }

  /**
   * Get a capability instance, lazily loading if needed
   * Handles both sync modules and async factories
   */
  get(name: string): unknown {
    // Return cached instance if available
    if (this.instances.has(name)) {
      return this.instances.get(name)
    }

    const registered = this.modules.get(name)
    if (!registered) {
      const available = this.list()
      const availableStr =
        available.length > 0 ? `Available capabilities: ${available.join(', ')}` : 'No capabilities registered'
      throw new CapabilityError(name, 'not_available', `Capability '${name}' is not registered. ${availableStr}`)
    }

    // Handle async factory - return a promise-like proxy
    if (registered.type === 'factory' && registered.factory) {
      return this.loadFactory(name, registered)
    }

    // Handle sync module constructor
    if (registered.type === 'module' && registered.module) {
      return this.loadModule(name, registered)
    }

    throw new CapabilityError(name, 'load_failed', `Invalid capability registration for '${name}'`)
  }

  /**
   * Load a module constructor synchronously
   */
  private loadModule(name: string, registered: RegisteredCapability): unknown {
    const Module = registered.module!
    let instance: unknown

    if (registered.options.passContext) {
      instance = new Module({ registry: this })
    } else {
      instance = new Module()
    }

    this.instances.set(name, instance)
    return instance
  }

  /**
   * Load an async factory
   * Returns a proxy that awaits the factory on method calls
   */
  private loadFactory(name: string, registered: RegisteredCapability): unknown {
    const factory = registered.factory!
    const registry = this

    // Create a lazy-loading proxy for async factory
    let instancePromise: Promise<unknown> | null = null
    let resolvedInstance: unknown = undefined
    let isResolved = false

    const getOrCreateInstance = async (): Promise<unknown> => {
      if (isResolved) return resolvedInstance
      if (!instancePromise) {
        instancePromise = factory().then((inst) => {
          resolvedInstance = inst
          isResolved = true
          registry.instances.set(name, inst)
          return inst
        })
      }
      return instancePromise
    }

    // Return a proxy that handles method calls
    return new Proxy(
      {},
      {
        get(_, prop) {
          if (typeof prop !== 'string') return undefined

          // Return an async function that awaits the instance and calls the method
          return async (...args: unknown[]) => {
            const instance = await getOrCreateInstance()
            const method = (instance as Record<string, unknown>)[prop]
            if (typeof method === 'function') {
              return method.apply(instance, args)
            }
            return method
          }
        },
      },
    )
  }

  /**
   * Destroy the registry, cleaning up all loaded capabilities
   */
  async destroy(): Promise<DestroyResult> {
    const errors: Array<{ capability: string; error: Error }> = []

    for (const [name, instance] of this.instances) {
      try {
        await this.disposeInstance(instance)
      } catch (error) {
        errors.push({
          capability: name,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }

    // Clear all cached instances
    this.instances.clear()

    return { errors }
  }

  /**
   * Dispose a single instance, checking for dispose methods
   */
  private async disposeInstance(instance: unknown): Promise<void> {
    if (!instance || typeof instance !== 'object') return

    const obj = instance as Record<string | symbol, unknown>

    // Check for Symbol.dispose first (explicit cleanup)
    if (typeof obj[Symbol.dispose] === 'function') {
      ;(obj[Symbol.dispose] as () => void)()
      return
    }

    // Check for dispose method
    if (typeof obj.dispose === 'function') {
      await (obj.dispose as () => Promise<void> | void)()
      return
    }
  }
}

// ============================================================================
// CAPABILITY PROXY
// ============================================================================

/**
 * Create a proxy for accessing capabilities on the workflow context
 */
export function createCapabilityProxy(
  registry: CapabilityRegistry,
  options: CapabilityProxyOptions = {},
): CapabilityProxy {
  const { reservedNames = [] } = options

  return new Proxy({} as CapabilityProxy, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined

      // Reserved names return undefined instead of throwing
      if (reservedNames.includes(prop)) {
        return undefined
      }

      return registry.get(prop)
    },

    has(_target, prop) {
      if (typeof prop !== 'string') return false
      return registry.has(prop)
    },

    ownKeys() {
      return registry.list()
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (registry.has(prop)) {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: registry.get(prop),
        }
      }
      return undefined
    },
  })
}
