/**
 * withBash Mixin - Shell Execution Capability
 *
 * Adds $.bash to the WorkflowContext with shell operations:
 * - exec, run, spawn
 * - parse, analyze, isDangerous
 *
 * Integrates bashx/do BashModule for AST-based safety analysis
 * and executor injection for actual command execution.
 *
 * @example
 * ```typescript
 * import { withBash } from 'dotdo/mixins'
 * import { withFs } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with executor
 * class MyDO extends withBash(DO, {
 *   executor: (instance) => ({
 *     execute: async (cmd, opts) => {
 *       // Execute via Containers, RPC, etc.
 *       return await containerExecutor.run(cmd, opts)
 *     }
 *   })
 * }) {
 *   async deploy() {
 *     const result = await this.$.bash.exec('npm', ['run', 'build'])
 *     return result.exitCode === 0
 *   }
 * }
 *
 * // With FsCapability integration for native file ops
 * class MyDO extends withBash(withFs(DO), {
 *   executor: (instance) => containerExecutor,
 *   fs: (instance) => instance.$.fs  // 'cat' uses $.fs.read() natively
 * }) {
 *   async readConfig() {
 *     // 'cat config.json' uses $.fs.read() - Tier 1, fast!
 *     const result = await this.$.bash.exec('cat', ['config.json'])
 *     return result.stdout
 *   }
 * }
 * ```
 *
 * @module dotdo/mixins/bash
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'
import type { WithFsContext, FsCapability } from './fs'

// ============================================================================
// RE-EXPORT TYPES FROM BASHX
// ============================================================================

// Import BashModule and types from bashx/do
// Note: These are imported at runtime - ensure bashx is a dependency
import {
  BashModule as BashModuleClass,
  type BashExecutor,
  type BashResult,
  type BashCapability,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
} from 'bashx/do'

// Types that are not exported from bashx/do but are used internally
// We define them locally as 'any' to avoid import errors
type Program = any
type SafetyClassification = any
type Intent = any

// Re-export for consumers
export { BashModuleClass as BashModule }
export type {
  BashExecutor,
  BashResult,
  BashCapability,
  ExecOptions,
  SpawnOptions,
  SpawnHandle,
}

// ============================================================================
// LEGACY TYPE ALIASES (for backward compatibility)
// ============================================================================

/** @deprecated Use ExecOptions instead */
export interface BashExecOptions extends ExecOptions {}

/** @deprecated Use BashResult instead */
export interface BashExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** @deprecated Use SpawnHandle instead */
export interface BashSpawnProcess {
  stdout: {
    on(event: 'data', callback: (chunk: string) => void): void
  }
  stderr: {
    on(event: 'data', callback: (chunk: string) => void): void
  }
  wait(): Promise<number>
  kill(signal?: string): void
}

// ============================================================================
// MODULE OPTIONS
// ============================================================================

/**
 * Options for configuring withBash mixin behavior.
 */
export interface BashModuleOptions {
  /**
   * Optional FsCapability for native file operations.
   * When provided, commands like `cat`, `head`, `tail`, `ls` can be
   * executed natively using $.fs instead of spawning a subprocess.
   */
  fs?: FsCapability

  /**
   * Whether to use native operations when available.
   * @default true
   */
  useNativeOps?: boolean
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithBashContext extends WorkflowContext {
  bash: BashCapability
}

export interface WithFsBashContext extends WithFsContext {
  bash: BashCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

// Note: TypeScript requires any[] for mixin constructor patterns (TS2545)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T

export interface WithBashDO<E extends Env = Env> extends DO<E> {
  $: WithBashContext
}

// ============================================================================
// WITHBASH CONFIG
// ============================================================================

/**
 * Configuration for the withBash mixin.
 */
export interface WithBashConfig<TBase> {
  /**
   * Factory function to create the executor.
   * Receives the instance as its argument, allowing access to instance
   * properties like `env` for configuring the executor.
   *
   * @example
   * ```typescript
   * const DOWithBash = withBash(DO, {
   *   executor: (instance) => ({
   *     execute: async (cmd, opts) => {
   *       return await instance.env.CONTAINER.run(cmd, opts)
   *     }
   *   })
   * })
   * ```
   */
  executor: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => BashExecutor

  /**
   * Optional factory function to get FsCapability from the instance.
   * When provided, native file operations will use FsCapability.
   *
   * @example
   * ```typescript
   * const DOWithBash = withBash(withFs(DO), {
   *   executor: (instance) => containerExecutor,
   *   fs: (instance) => instance.$.fs  // Use $.fs from withFs mixin
   * })
   * ```
   */
  fs?: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => FsCapability | undefined

  /**
   * Whether to use native operations when FsCapability is available.
   * @default true
   */
  useNativeOps?: boolean
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the bash module instance
const BASH_MODULE_CACHE = Symbol('bashModuleCache')

/**
 * Adds bash/shell capability to a DO class using bashx BashModule.
 *
 * The mixin provides lazy initialization - the BashModule and executor
 * are only created when $.bash is first accessed.
 *
 * @param Base - The base DO class to extend
 * @param config - Configuration with executor factory and optional FsCapability
 * @returns Extended class with bash capability
 *
 * @example Basic usage
 * ```typescript
 * import { withBash } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withBash(DO, {
 *   executor: (instance) => ({
 *     execute: async (cmd, opts) => {
 *       // Execute via Cloudflare Containers, RPC, etc.
 *       return await containerService.run(cmd, opts)
 *     }
 *   })
 * }) {
 *   async runTests() {
 *     const result = await this.$.bash.exec('npm', ['test'])
 *     if (result.exitCode !== 0) {
 *       throw new Error(`Tests failed: ${result.stderr}`)
 *     }
 *     return result.stdout
 *   }
 * }
 * ```
 *
 * @example With FsCapability integration
 * ```typescript
 * import { withBash, withFs } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * // First add fs capability, then bash with fs integration
 * class MyDO extends withBash(withFs(DO), {
 *   executor: (instance) => containerExecutor,
 *   fs: (instance) => instance.$.fs  // Native file ops use $.fs
 * }) {
 *   async readConfig() {
 *     // 'cat config.json' uses $.fs.read() natively (Tier 1, fast!)
 *     const result = await this.$.bash.exec('cat', ['config.json'])
 *     return result.stdout
 *   }
 * }
 * ```
 *
 * @example Safety analysis
 * ```typescript
 * const MyDO = withBash(DO, { executor: () => containerExecutor })
 * const instance = new MyDO(state, env)
 *
 * // Check if command is dangerous
 * const check = instance.$.bash.isDangerous('rm -rf /')
 * if (check.dangerous) {
 *   console.warn(check.reason)
 * }
 *
 * // Dangerous commands are blocked by default
 * const result = await instance.$.bash.exec('rm', ['-rf', '/'])
 * // result.blocked === true, result.requiresConfirm === true
 *
 * // Use confirm: true to execute dangerous commands
 * const result = await instance.$.bash.exec('rm', ['-rf', 'temp/'], { confirm: true })
 * ```
 */
export function withBash<TBase extends Constructor<{ $: WorkflowContext }>>(
  Base: TBase,
  config: WithBashConfig<TBase>
) {
  return class WithBash extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'bash']

    /**
     * Check if this DO class has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'bash') return true
      // Check if parent class has the hasCapability method
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // Cache for the bash module instance
    private [BASH_MODULE_CACHE]?: BashModuleClass

    /**
     * Lazy-loaded BashModule
     */
    private get bashModule(): BashModuleClass {
      if (!this[BASH_MODULE_CACHE]) {
        // Create executor using the factory
        const executor = config.executor(this as unknown as InstanceType<TBase>)

        // Get optional FsCapability
        const fs = config.fs?.(this as unknown as InstanceType<TBase>)

        // Create BashModule with executor and optional fs
        this[BASH_MODULE_CACHE] = new BashModuleClass(executor, {
          fs,
          useNativeOps: config.useNativeOps ?? true,
        })
      }
      return this[BASH_MODULE_CACHE]
    }

    // TypeScript requires any[] for mixin constructors (TS2545)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extend $ to include bash capability
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with bash
      this.$ = new Proxy(originalContext as WithBashContext, {
        get(target, prop: string | symbol) {
          if (prop === 'bash') {
            return self.bashModule
          }
          // Forward to original context
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            return value.bind(target)
          }
          return value
        },
      })
    }
  }
}
