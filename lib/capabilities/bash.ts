/**
 * withBash Capability - Shell Execution Capability
 *
 * Adds $.bash to the WorkflowContext with shell operations:
 * - Tagged template execution: $.bash`command`
 * - exec, run, spawn methods
 * - parse, analyze, isDangerous utilities
 *
 * This module wraps bashx to provide bash capabilities for Durable Objects.
 * All AST parsing, safety analysis, and command execution is delegated to bashx.
 *
 * @example
 * ```typescript
 * import { withBash } from 'dotdo/capabilities'
 * import { withFs } from 'dotdo/capabilities'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with executor
 * class MyDO extends withBash(DO, {
 *   executor: () => ({
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
 *   executor: () => containerExecutor,
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
 * @module dotdo/capabilities/bash
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'
import type { FsCapability } from './fs'

// ============================================================================
// IMPORT FROM BASHX - The Real Implementation
// ============================================================================

// Import types from bashx.do - the service layer
import type {
  BashResult,
  BashCapability,
  ExecOptions,
  SpawnOptions,
  SpawnHandle,
  Program,
  SafetyClassification,
  Intent,
  SafetyAnalysis,
  DangerCheck,
} from 'bashx.do'

// Import the BashModule class and executor from bashx.do/do
import {
  BashModule,
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSessionContainerExecutor,
} from 'bashx.do/do'

import type {
  BashExecutor,
  BashModuleOptions,
  WithBashConfig as BashxWithBashConfig,
  ContainerExecutorConfig,
  ContainerStub,
  GetContainerFn,
} from 'bashx.do/do'

// ============================================================================
// RE-EXPORT TYPES FOR CONSUMERS
// ============================================================================

export type {
  // Core types
  BashResult,
  BashCapability,
  ExecOptions,
  SpawnOptions,
  SpawnHandle,
  Program,
  SafetyClassification,
  Intent,
  SafetyAnalysis,
  DangerCheck,
  // Executor types
  BashExecutor,
  BashModuleOptions,
  ContainerExecutorConfig,
  ContainerStub,
  GetContainerFn,
}

// Re-export the executor classes for convenience
export {
  BashModule,
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSessionContainerExecutor,
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithBashContext extends WorkflowContext {
  bash: BashCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

import { Constructor } from './types'

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
   * executor: (instance) => new CloudflareContainerExecutor({
   *   containerBinding: instance.env.BASH_CONTAINER
   * })
   * ```
   */
  executor: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => BashExecutor

  /**
   * Whether withFs capability is required.
   * If true, an error will be thrown if withFs is not applied to the base class.
   */
  requireFs?: boolean

  /**
   * Optional factory function to get FsCapability from the instance.
   * When provided, native file operations will use FsCapability.
   *
   * @example
   * ```typescript
   * fs: (instance) => instance.$.fs  // Native file ops use $.fs
   * ```
   */
  fs?: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => FsCapability | undefined

  /**
   * Whether to use native operations when FsCapability is available.
   * When true and fs is provided, file operations like `cat`, `ls`, `head`, `tail`
   * will use FsCapability instead of spawning a subprocess.
   *
   * @default true
   */
  useNativeOps?: boolean
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

/** @internal */
export const BASH_CAPABILITY_CACHE: unique symbol = Symbol('bashCapabilityCache')

/**
 * Mixin function to add bash capability to a Durable Object class.
 *
 * This mixin provides lazy initialization of the BashModule from bashx,
 * meaning the executor is only created when the `bash` property is first accessed.
 * The BashModule instance is then cached for subsequent accesses.
 *
 * @param Base - The base DO class to extend
 * @param config - Configuration object for the executor and options
 * @returns Extended class with bash capability via $.bash
 *
 * @example Basic usage with CloudflareContainerExecutor
 * ```typescript
 * import { withBash, CloudflareContainerExecutor } from 'dotdo/capabilities'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withBash(DO, {
 *   executor: (instance) => new CloudflareContainerExecutor({
 *     containerBinding: instance.env.BASH_CONTAINER
 *   })
 * }) {
 *   async deploy() {
 *     const result = await this.$.bash.exec('npm', ['run', 'build'])
 *     return result.exitCode === 0
 *   }
 * }
 * ```
 *
 * @example With FsCapability integration
 * ```typescript
 * import { withBash, withFs, CloudflareContainerExecutor } from 'dotdo/capabilities'
 * import { DO } from 'dotdo'
 *
 * // First add fs capability, then bash with fs integration
 * class MyDO extends withBash(withFs(DO), {
 *   executor: (instance) => new CloudflareContainerExecutor({
 *     containerBinding: instance.env.BASH_CONTAINER
 *   }),
 *   fs: (instance) => instance.$.fs  // Native file ops use $.fs
 * }) {
 *   async readConfig() {
 *     // 'cat config.json' uses $.fs.read() natively (Tier 1, fast!)
 *     const result = await this.$.bash.exec('cat', ['config.json'])
 *     return result.stdout
 *   }
 * }
 * ```
 */
export function withBash<TBase extends Constructor<{ $: WorkflowContext }>>(
  Base: TBase,
  config: WithBashConfig<TBase>
) {
  return class WithBash extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'bash']

    hasCapability(name: string): boolean {
      if (name === 'bash') return true
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    /** @internal */ declare _bashModule: BashModule | undefined

    /** @internal */ get bashCapability(): BashCapability {
      if (!this._bashModule) {
        const executor = config.executor(this as unknown as InstanceType<TBase>)
        const fs = config.fs?.(this as unknown as InstanceType<TBase>)

        // Use bashx's BashModule - the real implementation
        this._bashModule = new BashModule(executor, {
          fs: fs as any, // FsCapability types are compatible
          useNativeOps: config.useNativeOps ?? true,
        })
      }
      return this._bashModule as unknown as BashCapability
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      if (config.requireFs) {
        const hasFs = (Base as any).capabilities?.includes('fs') ||
                      (this as any).hasCapability?.('fs')
        if (!hasFs) {
          throw new Error('withBash requires withFs capability when requireFs is true. Apply withFs(Base) first.')
        }
      }

      const originalContext = this.$
      const self = this

      this.$ = new Proxy(originalContext as WithBashContext, {
        get(target, prop: string | symbol) {
          if (prop === 'bash') {
            return self.bashCapability
          }
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            // Only bind if it has a bind method (not a Proxy or capability object)
            if (typeof value.bind === 'function') {
              // Don't bind capability functions that have custom properties
              const customProps = Object.getOwnPropertyNames(value).filter(
                (p) => p !== 'length' && p !== 'name' && p !== 'prototype'
              )
              if (customProps.length > 0) {
                return value
              }
              return value.bind(target)
            }
          }
          return value
        },
      })
    }
  }
}
