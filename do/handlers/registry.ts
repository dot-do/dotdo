/**
 * DO Handler Registry
 *
 * Central registry for managing handler instances in a DO.
 * Provides lifecycle management and dependency injection for handlers.
 *
 * @module do/handlers/registry
 */

import { createScopedLogger, LogLevel } from '../../utils/logger'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[DOHandlerRegistry]' })

/**
 * Base interface for all DO handlers
 */
export interface DOHandler {
  /** Handler name for identification */
  readonly name: string

  /**
   * Initialize the handler. Called once during DO construction.
   * Handlers can perform async setup here.
   */
  initialize?(): Promise<void>

  /**
   * Cleanup handler resources. Called when DO is being disposed.
   */
  dispose?(): Promise<void>
}

/**
 * Options for creating a DOHandlerRegistry
 */
export interface DOHandlerRegistryOptions {
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Registry for managing DO handlers.
 *
 * Provides:
 * - Handler registration and retrieval by name
 * - Lifecycle management (initialize/dispose)
 * - Type-safe handler access
 *
 * @example
 * ```typescript
 * const registry = new DOHandlerRegistry()
 *
 * registry.register(new StorageHandler(state))
 * registry.register(new RPCHandler(app))
 *
 * // Get handler by name
 * const storage = registry.get<StorageHandler>('storage')
 *
 * // Initialize all handlers
 * await registry.initializeAll()
 * ```
 */
export class DOHandlerRegistry {
  private handlers: Map<string, DOHandler> = new Map()
  private initialized = false
  private debug: boolean

  constructor(options: DOHandlerRegistryOptions = {}) {
    this.debug = options.debug ?? false
  }

  /**
   * Register a handler with the registry
   *
   * @param handler - The handler to register
   * @throws Error if a handler with the same name is already registered
   */
  register(handler: DOHandler): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(`Handler "${handler.name}" is already registered`)
    }

    if (this.debug) {
      logger.debug(`Registering handler: ${handler.name}`)
    }

    this.handlers.set(handler.name, handler)
  }

  /**
   * Get a handler by name
   *
   * @param name - The handler name
   * @returns The handler instance or undefined if not found
   */
  get<T extends DOHandler>(name: string): T | undefined {
    return this.handlers.get(name) as T | undefined
  }

  /**
   * Get a handler by name, throwing if not found
   *
   * @param name - The handler name
   * @returns The handler instance
   * @throws Error if handler is not found
   */
  getRequired<T extends DOHandler>(name: string): T {
    const handler = this.get<T>(name)
    if (!handler) {
      throw new Error(`Handler "${name}" not found`)
    }
    return handler
  }

  /**
   * Check if a handler is registered
   *
   * @param name - The handler name
   * @returns true if the handler is registered
   */
  has(name: string): boolean {
    return this.handlers.has(name)
  }

  /**
   * Get all registered handlers
   *
   * @returns Array of all registered handlers
   */
  getAll(): DOHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * Get handler names
   *
   * @returns Array of handler names
   */
  getNames(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Initialize all registered handlers
   *
   * Calls initialize() on each handler that implements it.
   * Handlers are initialized in registration order.
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      return
    }

    if (this.debug) {
      logger.debug('Initializing all handlers...')
    }

    for (const handler of this.handlers.values()) {
      if (handler.initialize) {
        if (this.debug) {
          logger.debug(`Initializing handler: ${handler.name}`)
        }
        await handler.initialize()
      }
    }

    this.initialized = true
  }

  /**
   * Dispose all registered handlers
   *
   * Calls dispose() on each handler that implements it.
   * Handlers are disposed in reverse registration order.
   */
  async disposeAll(): Promise<void> {
    if (this.debug) {
      logger.debug('Disposing all handlers...')
    }

    const handlers = Array.from(this.handlers.values()).reverse()

    for (const handler of handlers) {
      if (handler.dispose) {
        if (this.debug) {
          logger.debug(`Disposing handler: ${handler.name}`)
        }
        try {
          await handler.dispose()
        } catch (error) {
          logger.error(`Error disposing handler ${handler.name}:`, error)
        }
      }
    }

    this.handlers.clear()
    this.initialized = false
  }

  /**
   * Check if handlers have been initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get the number of registered handlers
   */
  get size(): number {
    return this.handlers.size
  }
}
