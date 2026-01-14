/**
 * Tier2Executor Module
 *
 * Tier 2 execution: RPC bindings for external services.
 *
 * This module provides a facade over RpcExecutor specifically for Tier 2
 * execution within the TieredExecutor architecture. It delegates all
 * functionality to RpcExecutor while providing a consistent interface
 * for tier-specific execution.
 *
 * Interface Contract:
 * -------------------
 * Tier2Executor implements the TierExecutor interface:
 * - canExecute(command): Returns true if an RPC service binding exists
 * - execute(command, options): Makes RPC call and returns BashResult
 *
 * Delegation Pattern:
 * -------------------
 * Tier2Executor wraps RpcExecutor and delegates all operations to it.
 * This follows the facade pattern, providing a simplified interface
 * for TieredExecutor while keeping RpcExecutor as the single source
 * of truth for RPC execution logic.
 *
 * Service Bindings:
 * -----------------
 * - jq.do for jq processing
 * - npm.do for npm/npx/yarn/pnpm/bun commands
 * - git.do for git operations
 * - pyx.do for python/pip/pipx/uvx commands
 * - esm.do for ESM module execution
 * - Custom RPC service bindings
 *
 * @module bashx/do/executors/tier2-executor
 */

import type { BashResult, ExecOptions } from '../../types.js'
import type { TierExecutor } from './types.js'
import {
  RpcExecutor,
  type RpcExecutorConfig,
  type RpcServiceBinding,
  type RpcEndpoint,
} from './rpc-executor.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for Tier2Executor.
 *
 * Extends RpcExecutorConfig since Tier2Executor delegates to RpcExecutor.
 *
 * @example
 * ```typescript
 * const config: Tier2ExecutorConfig = {
 *   bindings: {
 *     custom: {
 *       name: 'custom',
 *       endpoint: 'https://custom.do',
 *       commands: ['custom-cmd'],
 *     },
 *   },
 *   defaultTimeout: 30000,
 * }
 * const executor = new Tier2Executor(config)
 * ```
 */
export interface Tier2ExecutorConfig extends RpcExecutorConfig {}

// ============================================================================
// TIER2EXECUTOR CLASS
// ============================================================================

/**
 * Tier2Executor - Execute commands via RPC to external services
 *
 * Provides Tier 2 execution for commands that require specialized
 * external services. This is a facade over RpcExecutor that provides
 * a consistent interface for the TieredExecutor architecture.
 *
 * Implements the TierExecutor interface for composition with TieredExecutor.
 *
 * @example
 * ```typescript
 * // Create with default services (jq.do, npm.do, git.do, pyx.do)
 * const executor = new Tier2Executor()
 *
 * // Check if command can be handled
 * if (executor.canExecute('git status')) {
 *   const result = await executor.execute('git status')
 * }
 *
 * // Create with custom service bindings
 * const customExecutor = new Tier2Executor({
 *   bindings: {
 *     myService: {
 *       name: 'myService',
 *       endpoint: 'https://my-service.example.com',
 *       commands: ['my-cmd'],
 *     },
 *   },
 * })
 * ```
 *
 * @implements {TierExecutor}
 */
export class Tier2Executor implements TierExecutor {
  private readonly rpcExecutor: RpcExecutor

  constructor(config: Tier2ExecutorConfig = {}) {
    this.rpcExecutor = new RpcExecutor(config)
  }

  /**
   * Check if this executor can handle a command.
   *
   * Delegates to RpcExecutor.canExecute() to determine if an RPC
   * service binding exists for the command.
   *
   * @param command - The command string to check
   * @returns true if this executor can handle the command
   */
  canExecute(command: string): boolean {
    return this.rpcExecutor.canExecute(command)
  }

  /**
   * Execute a command via RPC.
   *
   * Delegates to RpcExecutor.execute() which:
   * - Routes to the correct RPC endpoint based on command
   * - Uses parseRpcResponse() for response validation
   * - Returns a properly formatted BashResult
   *
   * @param command - The command string to execute
   * @param options - Optional execution options (cwd, env, stdin, timeout)
   * @returns A promise resolving to a BashResult
   * @throws Error if no RPC service available for command
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.rpcExecutor.execute(command, options)
  }

  // ============================================================================
  // CONVENIENCE METHODS (delegated to RpcExecutor)
  // ============================================================================

  /**
   * Get the service name for a command.
   *
   * @param command - The command to analyze
   * @returns The service name or null if not found
   */
  getServiceForCommand(command: string): string | null {
    return this.rpcExecutor.getServiceForCommand(command)
  }

  /**
   * Check if a binding exists.
   *
   * @param name - The service name
   * @returns true if the binding exists
   */
  hasBinding(name: string): boolean {
    return this.rpcExecutor.hasBinding(name)
  }

  /**
   * Get a binding by name.
   *
   * @param name - The service name
   * @returns The binding or undefined
   */
  getBinding(name: string): RpcServiceBinding | undefined {
    return this.rpcExecutor.getBinding(name)
  }

  /**
   * Get list of available services.
   *
   * @returns Array of service names
   */
  getAvailableServices(): string[] {
    return this.rpcExecutor.getAvailableServices()
  }

  /**
   * Get commands handled by a service.
   *
   * @param serviceName - The service name
   * @returns Array of command names
   */
  getCommandsForService(serviceName: string): string[] {
    return this.rpcExecutor.getCommandsForService(serviceName)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a Tier2Executor with the given configuration.
 *
 * This is the recommended way to instantiate Tier2Executor as it
 * provides a clean interface for dependency injection in tests.
 *
 * @example
 * ```typescript
 * // Basic usage with default services
 * const executor = createTier2Executor()
 *
 * // With custom bindings
 * const customExecutor = createTier2Executor({
 *   bindings: {
 *     custom: {
 *       name: 'custom',
 *       endpoint: 'https://custom.do',
 *       commands: ['custom-cmd'],
 *     },
 *   },
 * })
 *
 * // With timeout configuration
 * const timedExecutor = createTier2Executor({
 *   defaultTimeout: 60000,
 * })
 * ```
 */
export function createTier2Executor(config: Tier2ExecutorConfig = {}): Tier2Executor {
  return new Tier2Executor(config)
}

// ============================================================================
// RE-EXPORTS FROM RPC EXECUTOR
// ============================================================================

// Re-export types for consumers who need them
export type {
  RpcExecutorConfig,
  RpcServiceBinding,
  RpcEndpoint,
}

// Re-export the underlying RpcExecutor for advanced use cases
export { RpcExecutor }
