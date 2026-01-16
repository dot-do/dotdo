/**
 * withFs Mixin - Adds filesystem capability to Durable Objects
 *
 * This mixin adds the $.fs capability to a Durable Object class,
 * providing lazy-loaded filesystem operations backed by SQLite and R2.
 *
 * @example
 * ```typescript
 * import { withFs } from 'fsx/do'
 * import { DO } from 'dotdo'
 *
 * class MySite extends withFs(DO) {
 *   async loadContent() {
 *     // $.fs is now available with full filesystem API
 *     const config = await this.$.fs.read('/config.json', { encoding: 'utf-8' })
 *     const files = await this.$.fs.list('/content')
 *     await this.$.fs.write('/cache/index.html', renderedContent)
 *   }
 * }
 * ```
 */

import { FsModule, type FsModuleConfig } from './module.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Constructor type for class mixins.
 *
 * TypeScript requires `any[]` for mixin constructor patterns due to
 * TS2545: "A mixin class must have a constructor with a single rest parameter of type 'any[]'".
 * Using `unknown[]` would break mixin composition with classes that have constructor parameters.
 * This is used internally while keeping the public API type-safe.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MixinConstructor<T = object> = new (...args: any[]) => T

/**
 * Public-facing constructor type with better type safety.
 * Use this for type annotations where mixin compatibility is not required.
 */
type Constructor<T = object> = abstract new (...args: unknown[]) => T

/**
 * Interface for classes that have a static capabilities array.
 * Used for introspection of DO capabilities.
 */
interface WithCapabilities {
  capabilities?: readonly string[]
}

/**
 * Base interface for classes that have a WorkflowContext ($)
 */
interface HasWorkflowContext {
  $: {
    [key: string]: unknown
  }
}

/**
 * Base interface for classes that have a Durable Object context
 */
interface HasDurableObjectContext {
  ctx: {
    storage: {
      sql: SqlStorage
    }
  }
  env?: {
    R2?: R2Bucket
    ARCHIVE?: R2Bucket
    [key: string]: unknown
  }
}

/**
 * Extended WorkflowContext with fs capability
 */
export interface WithFsContext {
  fs: FsModule
  [key: string]: unknown
}

/**
 * Type for a class with the fs mixin applied.
 */
export type WithFsDO<TBase extends Constructor<HasWorkflowContext & HasDurableObjectContext>> = {
  $: WithFsContext
} & InstanceType<TBase>

/**
 * Options for configuring the fs mixin
 */
export interface WithFsOptions {
  /** Base path for all fs operations */
  basePath?: string
  /** Max file size for hot tier (SQLite) */
  hotMaxSize?: number
  /** Default file permissions */
  defaultMode?: number
  /** Default directory permissions */
  defaultDirMode?: number
  /** R2 bucket binding name (default: 'R2') */
  r2BindingName?: string
  /** Archive R2 bucket binding name (default: 'ARCHIVE') */
  archiveBindingName?: string
}

// WeakMap for caching the fs capability instance
// Using WeakMap instead of private class members to avoid TypeScript export issues
const fsCapabilityCache = new WeakMap<object, FsModule>()

// ============================================================================
// MIXIN FUNCTION
// ============================================================================

/**
 * withFs - Mixin that adds filesystem capability to a Durable Object
 *
 * This function creates a new class that extends the provided base class
 * with filesystem capabilities available through $.fs.
 *
 * @param Base - The base Durable Object class to extend
 * @param options - Optional configuration for the filesystem
 * @returns A new class with $.fs filesystem capability
 *
 * @example
 * ```typescript
 * // Basic usage
 * class MySite extends withFs(DO) {
 *   async readConfig() {
 *     return this.$.fs.read('/config.json', { encoding: 'utf-8' })
 *   }
 * }
 *
 * // With options
 * class MyApp extends withFs(DO, { hotMaxSize: 5 * 1024 * 1024 }) {
 *   async saveData(data: string) {
 *     await this.$.fs.write('/data.json', data)
 *   }
 * }
 * ```
 */
export function withFs<TBase extends MixinConstructor<HasWorkflowContext & HasDurableObjectContext>>(
  Base: TBase,
  options: WithFsOptions = {}
) {
  // Extract static capabilities from base class with proper typing
  const baseWithCaps = Base as TBase & WithCapabilities
  const baseCapabilities: readonly string[] = baseWithCaps.capabilities ?? []

  return class WithFs extends Base {
    /**
     * Static capabilities array for introspection
     */
    static capabilities = [...baseCapabilities, 'fs'] as const

    /**
     * Get the FsModule instance (lazy-loaded)
     * @internal
     */
    get _fsCapability(): FsModule {
      let cached = fsCapabilityCache.get(this)
      if (!cached) {
        // Get R2 bindings from env
        const r2BindingName = options.r2BindingName ?? 'R2'
        const archiveBindingName = options.archiveBindingName ?? 'ARCHIVE'

        const config: FsModuleConfig = {
          sql: this.ctx.storage.sql,
          r2: this.env?.[r2BindingName] as R2Bucket | undefined,
          archive: this.env?.[archiveBindingName] as R2Bucket | undefined,
          basePath: options.basePath,
          hotMaxSize: options.hotMaxSize,
          defaultMode: options.defaultMode,
          defaultDirMode: options.defaultDirMode,
        }

        cached = new FsModule(config)
        fsCapabilityCache.set(this, cached)
      }
      return cached
    }

    /**
     * Check if this DO has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'fs') return true
      // Check parent class
      const baseProto = Base.prototype as { hasCapability?: (name: string) => boolean }
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // TypeScript requires `any[]` for mixin constructor spread (TS2556)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extend $ to include fs capability
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with fs
      this.$ = new Proxy(originalContext as WithFsContext, {
        get(target, prop: string | symbol) {
          if (prop === 'fs') {
            return self._fsCapability
          }
          // Forward to original context
          const value = (target as unknown as Record<string | symbol, unknown>)[prop]
          if (typeof value === 'function') {
            return value.bind(target)
          }
          return value
        },
        has(target, prop) {
          if (prop === 'fs') return true
          return prop in target
        },
        ownKeys(target) {
          return [...Reflect.ownKeys(target), 'fs']
        },
        getOwnPropertyDescriptor(target, prop) {
          if (prop === 'fs') {
            return {
              configurable: true,
              enumerable: true,
              writable: false,
              value: self._fsCapability,
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, prop)
        },
      })
    }
  }
}

// ============================================================================
// TYPE HELPERS
// ============================================================================

/**
 * Check if a context has the fs capability.
 * Uses runtime property access to avoid type assertions.
 */
export function hasFs<T extends { $: Record<string, unknown> }>(
  obj: T
): obj is T & { $: WithFsContext } {
  if (obj.$ == null) return false
  const ctx = obj.$ as Record<string, unknown>
  return typeof ctx['fs'] === 'object' && ctx['fs'] !== null
}

/**
 * Get the fs capability from a context, throwing if not available
 */
export function getFs<T extends { $: Record<string, unknown> }>(obj: T): FsModule {
  if (!hasFs(obj)) {
    throw new Error("Filesystem capability is not available. Use withFs mixin to add it.")
  }
  return obj.$.fs
}
