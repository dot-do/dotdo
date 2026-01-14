/**
 * Tier1Executor Module
 *
 * Tier 1 execution: Native in-Worker commands via nodejs_compat_v2.
 * This is the authoritative implementation for all Tier 1 command execution,
 * consolidating functionality from TieredExecutor.executeTier1 into a single module.
 *
 * Capability Categories:
 * ----------------------
 * 1. FS commands (cat, ls, head, tail, test, mkdir, rm, cp, mv, etc.)
 * 2. Compute commands (bc, expr, seq, shuf, sleep, timeout)
 * 3. Data processing (jq, yq, base64, envsubst)
 * 4. curl/wget HTTP
 * 5. Crypto (sha256sum, md5sum, sha512sum, uuidgen, etc.)
 * 6. Text processing (sed, awk, diff, patch, tee, xargs)
 * 7. POSIX utils (cut, sort, tr, uniq, wc, date, dd, od, etc.)
 * 8. System utils (yes, whoami, hostname, printenv, env, id, uname, tac)
 *
 * Interface Contract:
 * -------------------
 * Tier1Executor implements the TierExecutor interface:
 * - canExecute(command): Returns true if command is a Tier 1 command
 * - execute(command, options): Executes and returns BashResult
 *
 * Architecture:
 * -------------
 * Tier1Executor wraps the NativeExecutor implementation and provides
 * additional command handling. In the future, this module can be
 * further decomposed into capability-specific handlers.
 *
 * @module bashx/do/executors/tier1-executor
 */

import type { BashResult, ExecOptions, TypedFsCapability } from '../../types.js'
import type { TierExecutor, BaseExecutorConfig } from './types.js'
import {
  NativeExecutor,
  createNativeExecutor,
  NATIVE_COMMANDS,
  FS_COMMANDS,
  HTTP_COMMANDS,
  DATA_COMMANDS,
  CRYPTO_COMMANDS,
  TEXT_PROCESSING_COMMANDS,
  POSIX_UTILS_COMMANDS,
  SYSTEM_UTILS_COMMANDS,
  EXTENDED_UTILS_COMMANDS,
  type NativeExecutorConfig,
  type NativeCapability,
  type NativeCommandResult,
} from './native-executor.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for Tier1Executor.
 */
export interface Tier1ExecutorConfig extends BaseExecutorConfig {
  /**
   * Filesystem capability for file operations.
   * When provided, commands like cat, ls, head, tail can access the filesystem.
   */
  fs?: TypedFsCapability
}

/**
 * Capability types supported by Tier1Executor
 */
export type Tier1Capability = NativeCapability

// ============================================================================
// COMMAND SETS - Re-exported for convenience
// ============================================================================

/**
 * All commands that can be executed by Tier1Executor
 */
export const TIER1_COMMANDS = NATIVE_COMMANDS

/**
 * Filesystem commands
 */
export const TIER1_FS_COMMANDS = FS_COMMANDS

/**
 * HTTP commands
 */
export const TIER1_HTTP_COMMANDS = HTTP_COMMANDS

/**
 * Data processing commands
 */
export const TIER1_DATA_COMMANDS = DATA_COMMANDS

/**
 * Crypto commands
 */
export const TIER1_CRYPTO_COMMANDS = CRYPTO_COMMANDS

/**
 * Text processing commands
 */
export const TIER1_TEXT_COMMANDS = TEXT_PROCESSING_COMMANDS

/**
 * POSIX utility commands
 */
export const TIER1_POSIX_COMMANDS = POSIX_UTILS_COMMANDS

/**
 * System utility commands
 */
export const TIER1_SYSTEM_COMMANDS = SYSTEM_UTILS_COMMANDS

/**
 * Extended utility commands
 */
export const TIER1_EXTENDED_COMMANDS = EXTENDED_UTILS_COMMANDS

// ============================================================================
// TIER1EXECUTOR CLASS
// ============================================================================

/**
 * Tier1Executor - Native in-Worker command execution
 *
 * Provides Tier 1 execution for commands that don't require external
 * services or a sandbox environment. This is the fastest execution tier.
 *
 * The executor delegates to NativeExecutor for actual command execution,
 * acting as a facade that ensures consistent BashResult formatting and
 * provides additional command classification capabilities.
 *
 * @example
 * ```typescript
 * // Create executor with filesystem capability
 * const executor = new Tier1Executor({ fs: myFsCapability })
 *
 * // Check if command can be handled
 * if (executor.canExecute('echo hello')) {
 *   const result = await executor.execute('echo hello')
 *   console.log(result.stdout) // 'hello\n'
 * }
 *
 * // Execute filesystem commands
 * const catResult = await executor.execute('cat /path/to/file.txt')
 * ```
 *
 * @implements {TierExecutor}
 */
export class Tier1Executor implements TierExecutor {
  private readonly nativeExecutor: NativeExecutor

  constructor(config: Tier1ExecutorConfig = {}) {
    this.nativeExecutor = createNativeExecutor({
      fs: config.fs,
      defaultTimeout: config.defaultTimeout,
    })
  }

  /**
   * Check if filesystem capability is available
   */
  get hasFsCapability(): boolean {
    return this.nativeExecutor.hasFsCapability
  }

  /**
   * Check if this executor can handle a command.
   *
   * Analyzes the command string to determine if it starts with a
   * Tier 1 command that can be executed natively in-Worker.
   *
   * @param command - The command string to check
   * @returns true if this executor can handle the command
   */
  canExecute(command: string): boolean {
    return this.nativeExecutor.canExecute(command)
  }

  /**
   * Check if a command requires filesystem capability
   *
   * @param command - The command to check
   * @returns true if the command needs FsCapability
   */
  requiresFsCapability(command: string): boolean {
    return this.nativeExecutor.requiresFsCapability(command)
  }

  /**
   * Get the capability type for a command
   *
   * @param command - The command to analyze
   * @returns The capability category
   */
  getCapability(command: string): Tier1Capability {
    return this.nativeExecutor.getCapability(command)
  }

  /**
   * Execute a Tier 1 command.
   *
   * Delegates to NativeExecutor for actual execution. The result
   * is already in BashResult format.
   *
   * @param command - The command string to execute
   * @param options - Optional execution options
   * @returns A promise resolving to a BashResult
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.nativeExecutor.execute(command, options)
  }

  /**
   * Get the set of all supported commands
   *
   * @returns Set of command names
   */
  getSupportedCommands(): Set<string> {
    return new Set(TIER1_COMMANDS)
  }

  /**
   * Get commands by capability category
   *
   * @param capability - The capability category
   * @returns Set of command names for that capability
   */
  getCommandsByCapability(capability: Tier1Capability): Set<string> {
    switch (capability) {
      case 'fs':
        return new Set(TIER1_FS_COMMANDS)
      case 'http':
        return new Set(TIER1_HTTP_COMMANDS)
      case 'data':
        return new Set(TIER1_DATA_COMMANDS)
      case 'crypto':
        return new Set(TIER1_CRYPTO_COMMANDS)
      case 'text':
        return new Set(TIER1_TEXT_COMMANDS)
      case 'posix':
        return new Set(TIER1_POSIX_COMMANDS)
      case 'system':
        return new Set(TIER1_SYSTEM_COMMANDS)
      case 'extended':
        return new Set(TIER1_EXTENDED_COMMANDS)
      case 'compute':
      default:
        // Compute commands are the remaining ones
        const computeCommands = new Set<string>()
        for (const cmd of TIER1_COMMANDS) {
          if (!TIER1_FS_COMMANDS.has(cmd) &&
              !TIER1_HTTP_COMMANDS.has(cmd) &&
              !TIER1_DATA_COMMANDS.has(cmd) &&
              !TIER1_CRYPTO_COMMANDS.has(cmd) &&
              !TIER1_TEXT_COMMANDS.has(cmd) &&
              !TIER1_POSIX_COMMANDS.has(cmd) &&
              !TIER1_SYSTEM_COMMANDS.has(cmd) &&
              !TIER1_EXTENDED_COMMANDS.has(cmd)) {
            computeCommands.add(cmd)
          }
        }
        return computeCommands
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a Tier1Executor with the given configuration.
 *
 * This is the recommended way to instantiate Tier1Executor as it
 * provides a clean interface for dependency injection in tests.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const executor = createTier1Executor()
 *
 * // With filesystem capability
 * const fsExecutor = createTier1Executor({ fs: myFsCapability })
 *
 * // With timeout configuration
 * const timedExecutor = createTier1Executor({
 *   fs: myFsCapability,
 *   defaultTimeout: 60000,
 * })
 * ```
 */
export function createTier1Executor(config: Tier1ExecutorConfig = {}): Tier1Executor {
  return new Tier1Executor(config)
}

// ============================================================================
// RE-EXPORTS FROM NATIVE EXECUTOR
// ============================================================================

// Re-export types for consumers who need them
export type {
  NativeExecutorConfig,
  NativeCapability,
  NativeCommandResult,
}

// Re-export the underlying NativeExecutor for advanced use cases
export {
  NativeExecutor,
  createNativeExecutor,
  // Re-export all command sets
  NATIVE_COMMANDS,
  FS_COMMANDS,
  HTTP_COMMANDS,
  DATA_COMMANDS,
  CRYPTO_COMMANDS,
  TEXT_PROCESSING_COMMANDS,
  POSIX_UTILS_COMMANDS,
  SYSTEM_UTILS_COMMANDS,
  EXTENDED_UTILS_COMMANDS,
}
