/**
 * Primitives Mixin for Durable Objects
 *
 * Provides composable integration with extended primitives (fsx, gitx, bashx, npmx)
 * with minimal configuration. This mixin auto-wires all primitives to the $ context,
 * reducing 50+ lines of manual wiring to a single line.
 *
 * @example
 * ```typescript
 * // One-line integration - just extend DOWithPrimitives
 * class MyDO extends DOWithPrimitives(BaseDO, {
 *   fs: { basePath: '/app' },
 *   bash: { executor: containerExecutor },
 *   git: { repo: 'org/repo' }
 * }) {
 *   async deploy() {
 *     // All primitives available via $
 *     const config = await this.$.fs.read('/config.json', { encoding: 'utf-8' })
 *     await this.$.bash.exec('npm', ['run', 'build'])
 *     await this.$.git.commit('feat: deploy changes')
 *   }
 * }
 * ```
 *
 * @module do/mixins/primitives
 */

import type { Constructor } from './storage'

// =============================================================================
// Type Imports from Primitives Index
// =============================================================================

// Re-export from do/primitives which handles all submodule re-exports
import {
  FsModule,
  type FsModuleConfig,
  GitModule,
  type GitModuleOptions,
  BashModule,
  type BashExecutor,
  type BashModuleOptions,
} from '../primitives/index.js'

// =============================================================================
// Types
// =============================================================================

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
 * Extended WorkflowContext with all primitives
 */
export interface WithPrimitivesContext {
  fs?: FsModule
  git?: GitModule
  bash?: BashModule
  npm?: unknown // npmx module (when available)
  [key: string]: unknown
}

/**
 * Configuration for individual primitives
 */
export interface FsConfig extends Partial<FsModuleConfig> {
  /** Enable the fs primitive (default: true if sql available) */
  enabled?: boolean
  /** R2 bucket binding name (default: 'R2') */
  r2BindingName?: string
  /** Archive R2 bucket binding name (default: 'ARCHIVE') */
  archiveBindingName?: string
}

export interface GitConfig extends Partial<GitModuleOptions> {
  /** Enable the git primitive (default: false, requires explicit config) */
  enabled?: boolean
}

export interface BashConfig extends Partial<BashModuleOptions> {
  /** Enable the bash primitive (default: false, requires executor) */
  enabled?: boolean
  /** Executor factory - receives the DO instance for accessing env bindings */
  executor?: BashExecutor | ((instance: unknown) => BashExecutor)
}

export interface NpmConfig {
  /** Enable the npm primitive (default: false) */
  enabled?: boolean
  /** NPM registry URL */
  registry?: string
}

/**
 * Options for the DOWithPrimitives mixin
 */
export interface WithPrimitivesOptions {
  /** Filesystem primitive configuration */
  fs?: FsConfig | boolean
  /** Git primitive configuration */
  git?: GitConfig | boolean
  /** Bash primitive configuration */
  bash?: BashConfig | boolean
  /** NPM primitive configuration */
  npm?: NpmConfig | boolean
}

/**
 * Interface for classes that have all primitives capabilities
 */
export interface HasPrimitives {
  /** Check if a specific primitive is available */
  hasPrimitive(name: 'fs' | 'git' | 'bash' | 'npm'): boolean
  /** Get list of available primitives */
  getAvailablePrimitives(): string[]
}

// WeakMap caches for lazy initialization
const fsCache = new WeakMap<object, FsModule>()
const gitCache = new WeakMap<object, GitModule>()
const bashCache = new WeakMap<object, BashModule>()

// =============================================================================
// Mixin Implementation
// =============================================================================

/**
 * DOWithPrimitives - Mixin that adds all extended primitives to a Durable Object.
 *
 * This mixin provides auto-wiring of:
 * - $.fs - File system operations via fsx
 * - $.git - Git operations via gitx
 * - $.bash - Bash/shell execution via bashx
 * - $.npm - NPM/NPX operations via npmx (planned)
 *
 * Primitives are lazily initialized on first access and cached for efficiency.
 *
 * @template TBase - The base class constructor type
 * @param Base - The base class to extend
 * @param options - Configuration for each primitive
 * @returns A new class with all primitive capabilities
 *
 * @example
 * ```typescript
 * // Basic usage - fs is auto-enabled when sql storage is available
 * class FileDO extends DOWithPrimitives(BaseDO) {
 *   async saveFile(path: string, content: string) {
 *     await this.$.fs.write(path, content)
 *   }
 * }
 *
 * // With explicit primitive configuration
 * class DevEnvDO extends DOWithPrimitives(BaseDO, {
 *   fs: { basePath: '/workspace' },
 *   bash: { executor: containerExecutor },
 *   git: { repo: 'org/repo', branch: 'main' }
 * }) {
 *   async setupProject() {
 *     await this.$.git.sync()
 *     await this.$.bash.exec('npm', ['install'])
 *   }
 * }
 *
 * // Disable specific primitives
 * class MinimalDO extends DOWithPrimitives(BaseDO, {
 *   fs: true,
 *   git: false,
 *   bash: false,
 *   npm: false
 * }) {
 *   // Only fs is available
 * }
 *
 * // Composing with other mixins
 * class FullDO extends DOWithPrimitives(
 *   WithAuth(WithStorage(BaseDO)),
 *   { fs: true, bash: { executor: myExecutor } }
 * ) {
 *   // Has auth, storage, and primitives
 * }
 * ```
 */
export function DOWithPrimitives<TBase extends Constructor<HasWorkflowContext & HasDurableObjectContext>>(
  Base: TBase,
  options: WithPrimitivesOptions = {}
): TBase & Constructor<HasPrimitives> {
  // Normalize options
  const fsConfig = normalizeConfig(options.fs, true) as FsConfig | undefined
  const gitConfig = normalizeConfig(options.git, false) as GitConfig | undefined
  const bashConfig = normalizeConfig(options.bash, false) as BashConfig | undefined
  const npmConfig = normalizeConfig(options.npm, false) as NpmConfig | undefined

  return class PrimitivesMixin extends Base implements HasPrimitives {
    /**
     * Static capabilities array for introspection
     */
    static capabilities = [
      ...((Base as unknown as { capabilities?: string[] }).capabilities || []),
      ...(fsConfig?.enabled !== false ? ['fs'] : []),
      ...(gitConfig?.enabled ? ['git'] : []),
      ...(bashConfig?.enabled ? ['bash'] : []),
      ...(npmConfig?.enabled ? ['npm'] : []),
    ]

    /**
     * Get the FsModule instance (lazy-loaded)
     */
    private get _fsCapability(): FsModule | undefined {
      if (fsConfig?.enabled === false) return undefined

      let cached = fsCache.get(this)
      if (!cached) {
        const r2BindingName = fsConfig?.r2BindingName ?? 'R2'
        const archiveBindingName = fsConfig?.archiveBindingName ?? 'ARCHIVE'

        const config: FsModuleConfig = {
          sql: this.ctx.storage.sql,
          r2: this.env?.[r2BindingName] as R2Bucket | undefined,
          archive: this.env?.[archiveBindingName] as R2Bucket | undefined,
          ...fsConfig,
        }

        cached = new FsModule(config)
        fsCache.set(this, cached)
      }
      return cached
    }

    /**
     * Get the GitModule instance (lazy-loaded)
     */
    private get _gitCapability(): GitModule | undefined {
      if (!gitConfig?.enabled) return undefined

      let cached = gitCache.get(this)
      if (!cached) {
        const moduleOptions: GitModuleOptions = {
          repo: gitConfig.repo ?? '',
          branch: gitConfig.branch,
          r2: this.env?.R2 as R2Bucket | undefined,
          ...gitConfig,
        }

        cached = new GitModule(moduleOptions)
        gitCache.set(this, cached)
      }
      return cached
    }

    /**
     * Get the BashModule instance (lazy-loaded)
     */
    private get _bashCapability(): BashModule | undefined {
      if (!bashConfig?.enabled) return undefined

      let cached = bashCache.get(this)
      if (!cached) {
        // Get executor - either directly provided or via factory function
        let executor: BashExecutor | undefined
        if (typeof bashConfig.executor === 'function') {
          executor = bashConfig.executor(this)
        } else {
          executor = bashConfig.executor
        }

        if (!executor) {
          // Return undefined if no executor provided
          return undefined
        }

        const moduleOptions: BashModuleOptions = {
          // Wire fs capability to bash for native file operations
          fs: this._fsCapability,
          useNativeOps: bashConfig.useNativeOps ?? true,
        }

        cached = new BashModule(executor, moduleOptions)
        bashCache.set(this, cached)
      }
      return cached
    }

    /**
     * Check if this DO has a specific primitive
     */
    hasPrimitive(name: 'fs' | 'git' | 'bash' | 'npm'): boolean {
      switch (name) {
        case 'fs':
          return this._fsCapability !== undefined
        case 'git':
          return this._gitCapability !== undefined
        case 'bash':
          return this._bashCapability !== undefined
        case 'npm':
          return npmConfig?.enabled === true
        default:
          return false
      }
    }

    /**
     * Get list of available primitives
     */
    getAvailablePrimitives(): string[] {
      const available: string[] = []
      if (this._fsCapability) available.push('fs')
      if (this._gitCapability) available.push('git')
      if (this._bashCapability) available.push('bash')
      if (npmConfig?.enabled) available.push('npm')
      return available
    }

    // Mixin constructors must use `any[]` to accept arbitrary base class constructor args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extend $ to include all primitives
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with primitives
      this.$ = new Proxy(originalContext as WithPrimitivesContext, {
        get(target, prop: string | symbol) {
          // Handle primitive accessors
          if (prop === 'fs') {
            return self._fsCapability
          }
          if (prop === 'git') {
            return self._gitCapability
          }
          if (prop === 'bash') {
            return self._bashCapability
          }
          if (prop === 'npm') {
            // npmx integration placeholder
            return undefined
          }

          // Forward to original context
          const value = (target as unknown as Record<string | symbol, unknown>)[prop]
          if (typeof value === 'function') {
            return value.bind(target)
          }
          return value
        },
        has(target, prop) {
          if (prop === 'fs' || prop === 'git' || prop === 'bash' || prop === 'npm') {
            return true
          }
          return prop in target
        },
        ownKeys(target) {
          return [...Reflect.ownKeys(target), 'fs', 'git', 'bash', 'npm']
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
          if (prop === 'git') {
            return {
              configurable: true,
              enumerable: true,
              writable: false,
              value: self._gitCapability,
            }
          }
          if (prop === 'bash') {
            return {
              configurable: true,
              enumerable: true,
              writable: false,
              value: self._bashCapability,
            }
          }
          if (prop === 'npm') {
            return {
              configurable: true,
              enumerable: true,
              writable: false,
              value: undefined,
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, prop)
        },
      })
    }
  } as TBase & Constructor<HasPrimitives>
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize config from boolean or object to config object
 */
function normalizeConfig<T extends { enabled?: boolean }>(
  config: T | boolean | undefined,
  defaultEnabled: boolean
): T | undefined {
  if (config === undefined) {
    return defaultEnabled ? { enabled: true } as T : undefined
  }
  if (typeof config === 'boolean') {
    return config ? { enabled: true } as T : undefined
  }
  return { ...config, enabled: config.enabled ?? true }
}

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Check if a context has the fs primitive
 */
export function hasFs<T extends { $: { [key: string]: unknown } }>(
  obj: T
): obj is T & { $: { fs: FsModule } } {
  return obj.$ != null && typeof (obj.$ as Record<string, unknown>).fs === 'object' && (obj.$ as Record<string, unknown>).fs !== null
}

/**
 * Check if a context has the git primitive
 */
export function hasGit<T extends { $: { [key: string]: unknown } }>(
  obj: T
): obj is T & { $: { git: GitModule } } {
  return obj.$ != null && typeof (obj.$ as Record<string, unknown>).git === 'object' && (obj.$ as Record<string, unknown>).git !== null
}

/**
 * Check if a context has the bash primitive
 */
export function hasBash<T extends { $: { [key: string]: unknown } }>(
  obj: T
): obj is T & { $: { bash: BashModule } } {
  return obj.$ != null && typeof (obj.$ as Record<string, unknown>).bash === 'object' && (obj.$ as Record<string, unknown>).bash !== null
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { FsModule, FsModuleConfig, GitModule, GitModuleOptions, BashModule, BashExecutor, BashModuleOptions } from '../primitives/index.js'
