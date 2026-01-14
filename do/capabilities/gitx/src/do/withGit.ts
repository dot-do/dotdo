/**
 * @fileoverview withGit Mixin Function for DO Composition
 *
 * This module provides a mixin function that adds git capability to any
 * Durable Object class. The mixin supports lazy initialization of the
 * GitModule for optimal performance.
 *
 * @module do/withGit
 *
 * @example
 * ```typescript
 * import { withGit } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage - adds this.git property
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   async handleRequest() {
 *     await this.git.sync()
 *     const status = await this.git.status()
 *     return new Response(JSON.stringify(status))
 *   }
 * }
 *
 * // With $.git context integration
 * class WorkflowDO extends withGit(DO, {
 *   repo: 'org/repo',
 *   contextMode: true
 * }) {
 *   async handleRequest() {
 *     // Access via $.git when contextMode is enabled
 *     await this.$.git.sync()
 *   }
 * }
 * ```
 */

import {
  GitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
} from './GitModule'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Type for a class constructor.
 * @template T - The type that the constructor creates
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Interface for DOs that have git capability.
 * This is the shape of a class after applying the withGit mixin.
 */
export interface WithGitCapability {
  /** The GitModule instance providing git operations */
  git: GitModule
}

/**
 * Interface for the extended WorkflowContext with git capability.
 * Used when contextMode is enabled.
 */
export interface WithGitContext {
  git: GitModule
  [key: string]: unknown
}

/**
 * Configuration options for the withGit mixin.
 */
export interface WithGitOptions {
  /**
   * Repository identifier (e.g., 'org/repo' or full URL)
   */
  repo: string

  /**
   * Branch to track
   * @default 'main'
   */
  branch?: string

  /**
   * Path prefix within the repository
   */
  path?: string

  /**
   * R2 binding name in env to use for object storage
   * @default 'R2_BUCKET'
   */
  r2Binding?: string

  /**
   * Custom object key prefix in R2
   * @default 'git/objects'
   */
  objectPrefix?: string

  /**
   * Whether to extend the $ WorkflowContext with git capability.
   * When true, this.$.git will be available in addition to this.git.
   * @default false
   */
  contextMode?: boolean

  /**
   * Whether to auto-initialize the GitModule on construction.
   * When false (default), GitModule is lazily initialized on first access.
   * @default false
   */
  autoInit?: boolean
}

/**
 * Internal options passed to the mixin class constructor.
 * Combines user options with resolved runtime values.
 */
interface ResolvedGitOptions extends WithGitOptions {
  r2?: R2BucketLike
  fs?: FsCapability
}

// ============================================================================
// Symbol for Lazy Initialization Cache
// ============================================================================

/**
 * Symbol key for caching the GitModule instance.
 * Using a symbol prevents property name collisions.
 */
const GIT_MODULE_CACHE = Symbol('gitModuleCache')

/**
 * Symbol key for storing resolved options.
 */
const GIT_OPTIONS = Symbol('gitOptions')

// ============================================================================
// withGit Mixin Function
// ============================================================================

/**
 * Mixin function to add git capability to a DO class.
 *
 * @description
 * Composes git functionality into a Durable Object class using the mixin pattern.
 * The resulting class will have a `git` property that provides GitModule functionality.
 *
 * Features:
 * - Lazy initialization: GitModule is only created when first accessed
 * - R2 integration: Automatically resolves R2 bucket from env bindings
 * - Context mode: Optionally extends the $ WorkflowContext with git capability
 * - Composable: Can be combined with other mixins like withBash
 *
 * @param Base - Base class to extend
 * @param options - Git configuration options
 * @returns Extended class with git capability
 *
 * @example
 * ```typescript
 * // Basic usage
 * import { withGit } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   async syncAndCommit() {
 *     await this.git.sync()
 *     await this.git.add('.')
 *     await this.git.commit('Update files')
 *     await this.git.push()
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With custom R2 binding
 * class MyDO extends withGit(DO, {
 *   repo: 'org/repo',
 *   branch: 'develop',
 *   r2Binding: 'GIT_OBJECTS'
 * }) {
 *   async handleRequest() {
 *     await this.git.sync()
 *     return new Response('Synced!')
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Composing with other mixins
 * import { withGit, withBash } from 'gitx.do/do'
 *
 * class DevDO extends withBash(withGit(DO, { repo: 'org/repo' }), {
 *   cwd: '/workspace'
 * }) {
 *   async buildAndPush() {
 *     await this.git.sync()
 *     await this.bash.exec('npm', ['run', 'build'])
 *     await this.git.add('dist/')
 *     await this.git.commit('Build: update dist')
 *     await this.git.push()
 *   }
 * }
 * ```
 */
export function withGit<TBase extends Constructor>(
  Base: TBase,
  options: WithGitOptions
): TBase & Constructor<WithGitCapability> {
  // Validate required options
  if (!options.repo) {
    throw new Error('withGit: repo option is required')
  }

  return class WithGitMixin extends Base implements WithGitCapability {
    /**
     * Static list of capabilities for introspection.
     */
    static capabilities = [...((Base as Record<string, unknown>).capabilities as string[] || []), 'git']

    /**
     * Cached GitModule instance (lazy initialized).
     */
    private [GIT_MODULE_CACHE]?: GitModule

    /**
     * Resolved options for GitModule creation.
     */
    private [GIT_OPTIONS]: ResolvedGitOptions

    /**
     * Whether the git module has been initialized.
     */
    private gitInitialized = false

    /**
     * The git property provides access to the GitModule.
     * Implements lazy initialization - the module is only created
     * when this property is first accessed.
     */
    get git(): GitModule {
      if (!this[GIT_MODULE_CACHE]) {
        this[GIT_MODULE_CACHE] = this.createGitModule()
      }
      return this[GIT_MODULE_CACHE]
    }

    /**
     * Check if this DO class has a specific capability.
     * @param name - Capability name to check
     * @returns True if the capability is available
     */
    hasCapability(name: string): boolean {
      if (name === 'git') return true
      // Check if parent class has the hasCapability method
      const baseProto = Base.prototype as Record<string, unknown>
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return (baseProto.hasCapability as (name: string) => boolean).call(this, name)
      }
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Resolve R2 bucket from env if available
      const env = (this as Record<string, unknown>).env as Record<string, unknown> | undefined
      const r2BindingName = options.r2Binding ?? 'R2_BUCKET'
      const r2 = env?.[r2BindingName] as R2BucketLike | undefined

      // Get filesystem capability if available from $ context
      const dollarContext = (this as Record<string, unknown>).$ as Record<string, unknown> | undefined
      const fs = dollarContext?.fs as FsCapability | undefined

      // Store resolved options
      this[GIT_OPTIONS] = {
        ...options,
        r2,
        fs,
      }

      // Extend $ context if contextMode is enabled
      if (options.contextMode && dollarContext) {
        const self = this
        const original$ = dollarContext

        // Create a proxy that adds git to the $ context
        ;(this as Record<string, unknown>).$ = new Proxy(original$ as WithGitContext, {
          get(target, prop: string | symbol) {
            if (prop === 'git') {
              return self.git
            }
            // Forward to original context
            const value = (target as unknown as Record<string | symbol, unknown>)[prop]
            if (typeof value === 'function') {
              return (value as (...args: unknown[]) => unknown).bind(target)
            }
            return value
          },
        })
      }

      // Auto-initialize if requested
      if (options.autoInit) {
        // Access git to trigger lazy initialization
        void this.git.initialize()
        this.gitInitialized = true
      }
    }

    /**
     * Creates the GitModule instance with resolved options.
     * @returns A new GitModule instance
     */
    private createGitModule(): GitModule {
      const opts = this[GIT_OPTIONS]

      return new GitModule({
        repo: opts.repo,
        branch: opts.branch,
        path: opts.path,
        r2: opts.r2,
        fs: opts.fs,
        objectPrefix: opts.objectPrefix,
      })
    }

    /**
     * Initialize the git module explicitly.
     * This is useful when you need to ensure the module is ready
     * before performing operations.
     */
    async initializeGit(): Promise<void> {
      if (!this.gitInitialized) {
        await this.git.initialize()
        this.gitInitialized = true
      }
    }

    /**
     * Dispose the git module and clean up resources.
     */
    async disposeGit(): Promise<void> {
      if (this[GIT_MODULE_CACHE]) {
        await this[GIT_MODULE_CACHE].dispose()
        this[GIT_MODULE_CACHE] = undefined
        this.gitInitialized = false
      }
    }
  } as TBase & Constructor<WithGitCapability>
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value has git capability.
 *
 * @param value - Value to check
 * @returns True if value has the git property and it's a GitModule
 *
 * @example
 * ```typescript
 * if (hasGitCapability(instance)) {
 *   await instance.git.sync()
 * }
 * ```
 */
export function hasGitCapability(value: unknown): value is WithGitCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    'git' in value &&
    value.git instanceof GitModule
  )
}

// ============================================================================
// Re-exports for Convenience
// ============================================================================

export {
  GitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
}
