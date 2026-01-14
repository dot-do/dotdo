/**
 * Executor Type Definitions
 *
 * This module defines the shared interfaces and types for all executors.
 * There are TWO distinct executor interfaces:
 *
 * 1. TierExecutor - For bash command execution (Tiers 1-4)
 * 2. LanguageExecutor - For polyglot language execution (Python, Ruby, etc.)
 *
 * These interfaces are intentionally SEPARATE because they have different
 * contracts (Liskov Substitution Principle):
 *
 * - TierExecutor.canExecute(command: string) - checks if command can be handled
 * - LanguageExecutor.canExecute(language: SupportedLanguage) - checks if runtime available
 *
 * Architecture Overview:
 * ---------------------
 * The tiered execution system uses a strategy pattern where each tier
 * implements a common interface. The TieredExecutor acts as an orchestrator
 * that delegates to the appropriate executor based on command analysis.
 *
 * ```
 * TieredExecutor (orchestrator)
 *   |
 *   +-- [TierExecutor implementations - for bash commands]
 *   |
 *   +-- Tier 1: NativeExecutor (in-Worker commands)
 *   |     - Filesystem operations via FsCapability
 *   |     - HTTP via fetch API
 *   |     - Data processing (jq, base64, etc.)
 *   |     - POSIX utilities
 *   |
 *   +-- Tier 2: RpcExecutor (external services)
 *   |     - jq.do for complex jq processing
 *   |     - npm.do for package management
 *   |     - git.do for git operations
 *   |
 *   +-- Tier 3: LoaderExecutor (dynamic npm modules)
 *   |     - Runtime module loading
 *   |     - esbuild, typescript, prettier, etc.
 *   |
 *   +-- Tier 4: SandboxExecutor (full Linux sandbox)
 *   |     - System commands (ps, kill, etc.)
 *   |     - Compilers and runtimes
 *   |     - Full Linux capabilities
 *   |
 *   +-- [LanguageExecutor implementation - for non-bash languages]
 *   |
 *   +-- Polyglot: PolyglotExecutor (language runtimes via RPC)
 *         - pyx.do for Python
 *         - ruby.do for Ruby
 *         - node.do for Node.js
 *         - go.do for Go
 *         - rust.do for Rust
 * ```
 *
 * Interface Separation:
 * --------------------
 * The LanguageExecutor interface is DISTINCT from TierExecutor because:
 *
 * 1. canExecute() has different semantics:
 *    - TierExecutor: "Can I handle this bash command?"
 *    - LanguageExecutor: "Do I have a binding for this language?"
 *
 * 2. execute() has different signatures:
 *    - TierExecutor: execute(command, options)
 *    - LanguageExecutor: execute(command, language, options)
 *
 * This separation ensures that:
 * - Type safety is maintained (can't pass wrong arguments)
 * - LSP (Liskov Substitution Principle) is respected
 * - Each interface has clear, single responsibility
 *
 * Dependency Rules:
 * -----------------
 * - All executors depend ONLY on types.ts (this file) and ../../types.js
 * - No circular dependencies between executor modules
 * - The index.ts re-exports all modules for external consumers
 * - TieredExecutor imports individual executors, not the other way around
 *
 * @module bashx/do/executors/types
 */

import type { BashResult, ExecOptions } from '../../types.js'

// ============================================================================
// CORE EXECUTOR INTERFACE
// ============================================================================

/**
 * Base interface for all tier-specific executors.
 *
 * Each tier executor must implement this interface to be composable
 * within the TieredExecutor orchestrator.
 *
 * @example
 * ```typescript
 * class MyExecutor implements TierExecutor {
 *   canExecute(command: string): boolean {
 *     // Return true if this executor can handle the command
 *   }
 *
 *   async execute(command: string, options?: ExecOptions): Promise<BashResult> {
 *     // Execute the command and return a BashResult
 *   }
 * }
 * ```
 */
export interface TierExecutor {
  /**
   * Check if this executor can handle a given command.
   *
   * This method is used by the TieredExecutor to determine which
   * executor should handle a command. It should be fast and not
   * perform any side effects.
   *
   * @param command - The command string to check
   * @returns true if this executor can handle the command
   */
  canExecute(command: string): boolean

  /**
   * Execute a command and return the result.
   *
   * This is the main execution method. It should:
   * - Execute the command according to the tier's capabilities
   * - Return a properly formatted BashResult
   * - Handle errors gracefully and return appropriate exit codes
   *
   * @param command - The command string to execute
   * @param options - Optional execution options (cwd, env, stdin, timeout)
   * @returns A promise resolving to a BashResult
   * @throws May throw if the command cannot be executed (but prefer returning error in result)
   */
  execute(command: string, options?: ExecOptions): Promise<BashResult>
}

// ============================================================================
// LANGUAGE EXECUTOR INTERFACE
// ============================================================================

/**
 * Supported programming languages for polyglot execution.
 *
 * This type is re-exported from core/classify/language-detector for convenience.
 * The canonical definition is in the core module.
 */
export type SupportedLanguage = 'bash' | 'python' | 'ruby' | 'node' | 'go' | 'rust'

/**
 * Interface for language-specific executors (polyglot execution).
 *
 * This interface is DISTINCT from TierExecutor because it has different semantics:
 *
 * TierExecutor (command-based):
 * - canExecute(command: string) - checks if a command string can be handled
 * - execute(command, options) - executes a bash-style command
 *
 * LanguageExecutor (language-based):
 * - canExecute(language: SupportedLanguage) - checks if a language runtime is available
 * - execute(command, language, options) - executes code in a specific language
 *
 * The key difference is that LanguageExecutor requires explicit language specification,
 * as it routes to different language runtimes (Python, Ruby, Node.js, etc.) via RPC.
 *
 * Architecture:
 * ```
 * TieredExecutor (orchestrator)
 *   |
 *   +-- Tier 1-4: TierExecutor implementations (bash commands)
 *   |
 *   +-- Polyglot: LanguageExecutor implementation (non-bash languages)
 *         |
 *         +-- pyx.do (Python runtime)
 *         +-- ruby.do (Ruby runtime)
 *         +-- node.do (Node.js runtime)
 *         +-- go.do (Go runtime)
 *         +-- rust.do (Rust runtime)
 * ```
 *
 * This separation follows the Liskov Substitution Principle - LanguageExecutor
 * cannot be substituted for TierExecutor because their contracts differ.
 *
 * @example
 * ```typescript
 * class MyLanguageExecutor implements LanguageExecutor {
 *   canExecute(language: SupportedLanguage): boolean {
 *     // Return true if this language runtime is available
 *     return language === 'python'
 *   }
 *
 *   async execute(
 *     command: string,
 *     language: SupportedLanguage,
 *     options?: ExecOptions
 *   ): Promise<BashResult> {
 *     // Execute code in the specified language runtime
 *   }
 * }
 * ```
 */
export interface LanguageExecutor {
  /**
   * Check if this executor can handle a given language.
   *
   * This method checks if a language runtime binding is available.
   * It should be fast and not perform any side effects.
   *
   * @param language - The language to check
   * @returns true if this executor has a binding for the language
   */
  canExecute(language: SupportedLanguage): boolean

  /**
   * Execute code in a specific language runtime.
   *
   * This method routes execution to the appropriate language runtime
   * service (e.g., pyx.do for Python, ruby.do for Ruby).
   *
   * @param command - The code or command to execute
   * @param language - The target language runtime
   * @param options - Optional execution options (cwd, env, stdin, timeout)
   * @returns A promise resolving to a BashResult
   */
  execute(command: string, language: SupportedLanguage, options?: ExecOptions): Promise<BashResult>

  /**
   * Get list of available language runtimes.
   *
   * @returns Array of language names with available bindings
   */
  getAvailableLanguages(): SupportedLanguage[]
}

// ============================================================================
// EXECUTOR METADATA
// ============================================================================

/**
 * Execution tier levels.
 *
 * Each tier represents a different execution environment with
 * different capabilities and performance characteristics:
 *
 * - Tier 1: Fastest, runs in-Worker with limited capabilities
 * - Tier 2: Fast, RPC calls to external services
 * - Tier 3: Flexible, dynamic npm module loading
 * - Tier 4: Full capability, Linux sandbox (slowest)
 */
export type ExecutionTier = 1 | 2 | 3 | 4

/**
 * Tier classification result.
 *
 * Describes which tier should handle a command and why.
 */
export interface TierClassification {
  /** The tier that should handle this command */
  tier: ExecutionTier
  /** Human-readable reason for the tier selection */
  reason: string
  /** The handler type that will execute the command */
  handler: 'native' | 'rpc' | 'loader' | 'sandbox' | 'polyglot'
  /** Optional: specific capability or service name */
  capability?: string
}

// ============================================================================
// COMMON RESULT TYPES
// ============================================================================

/**
 * Basic command result without full BashResult metadata.
 *
 * This is used internally by executors before they wrap
 * the result in a full BashResult structure.
 */
export interface CommandResult {
  /** Standard output from the command */
  stdout: string
  /** Standard error from the command */
  stderr: string
  /** Exit code (0 for success, non-zero for failure) */
  exitCode: number
}

/**
 * Extended result with optional execution metadata.
 */
export interface ExtendedCommandResult extends CommandResult {
  /** Execution duration in milliseconds */
  duration?: number
  /** Memory usage in bytes */
  memoryUsage?: number
  /** CPU time in milliseconds */
  cpuTime?: number
}

// ============================================================================
// CAPABILITY DETECTION
// ============================================================================

/**
 * Interface for executors that can report their capabilities.
 *
 * Implementing this interface allows the TieredExecutor to make
 * better decisions about which executor to use.
 */
export interface CapabilityAware {
  /**
   * Get the list of capabilities this executor provides.
   *
   * @returns Array of capability names
   */
  getCapabilities(): string[]

  /**
   * Check if this executor has a specific capability.
   *
   * @param capability - The capability to check for
   * @returns true if the executor has the capability
   */
  hasCapability(capability: string): boolean
}

/**
 * Interface for executors that can report supported commands.
 */
export interface CommandAware {
  /**
   * Get the set of commands this executor supports.
   *
   * @returns Set of command names
   */
  getSupportedCommands(): Set<string>
}

// ============================================================================
// CONFIGURATION BASE TYPES
// ============================================================================

/**
 * Base configuration interface for all executors.
 *
 * Individual executors extend this with their specific configuration.
 */
export interface BaseExecutorConfig {
  /**
   * Default timeout for command execution in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number
}

// ============================================================================
// FACTORY FUNCTION TYPE
// ============================================================================

/**
 * Factory function type for creating executor instances.
 *
 * All executor modules should export a factory function
 * that follows this pattern for consistent instantiation.
 *
 * @example
 * ```typescript
 * export const createNativeExecutor: ExecutorFactory<NativeExecutorConfig, NativeExecutor> =
 *   (config) => new NativeExecutor(config)
 * ```
 */
export type ExecutorFactory<TConfig extends BaseExecutorConfig, TExecutor extends TierExecutor> = (
  config?: TConfig
) => TExecutor

// ============================================================================
// TIER EXECUTION METHOD TYPES
// ============================================================================

/**
 * Type signature for tier execution methods.
 *
 * All tier execution methods (executeTier1, executeTier2, executeTier3,
 * executeTier4, executePolyglot) share this signature. This type enables
 * type-safe access from executor adapters without using `as any` casts.
 *
 * @param command - The command string to execute
 * @param classification - The tier classification for routing decisions
 * @param options - Optional execution options
 * @returns Promise resolving to a BashResult
 *
 * @internal
 */
export type TierExecutionMethod = (
  command: string,
  classification: TierClassification,
  options?: ExecOptions
) => Promise<BashResult>

/**
 * Internal interface exposing tier execution methods.
 *
 * This interface is implemented by TieredExecutor and used by executor
 * adapters to access tier-specific execution methods in a type-safe manner.
 *
 * The interface enables the adapter pattern without requiring `as any` casts
 * to access private methods. Instead, adapters receive a reference to this
 * interface and call the appropriate method directly.
 *
 * Architecture:
 * ```
 * TieredExecutor implements TieredExecutorInternal
 *   |
 *   +-- executeTier1() - Tier 1 native execution
 *   +-- executeTier2() - Tier 2 RPC execution
 *   +-- executeTier3() - Tier 3 loader execution
 *   +-- executeTier4() - Tier 4 sandbox execution
 *   +-- executePolyglot() - Polyglot language execution
 *
 * ExecutorAdapter receives TieredExecutorInternal reference
 *   |
 *   +-- Calls appropriate tier method via typed interface
 * ```
 *
 * @internal
 */
export interface TieredExecutorInternal {
  /**
   * Execute command via Tier 1 (native in-Worker).
   * @internal
   */
  executeTier1: TierExecutionMethod

  /**
   * Execute command via Tier 2 (RPC to external services).
   * @internal
   */
  executeTier2: TierExecutionMethod

  /**
   * Execute command via Tier 3 (dynamic loader).
   * @internal
   */
  executeTier3: TierExecutionMethod

  /**
   * Execute command via Tier 4 (sandbox).
   * @internal
   */
  executeTier4: TierExecutionMethod

  /**
   * Execute command via polyglot runtime.
   * @internal
   */
  executePolyglot: TierExecutionMethod
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Set of valid supported language names for runtime validation.
 */
const SUPPORTED_LANGUAGES = new Set<string>(['bash', 'python', 'ruby', 'node', 'go', 'rust'])

/**
 * Type guard to check if a string is a valid SupportedLanguage.
 */
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.has(value)
}

/**
 * Type guard to check if an executor is a TierExecutor (not a LanguageExecutor).
 */
export function isTierExecutor(executor: TierExecutor | LanguageExecutor): executor is TierExecutor {
  return !('getAvailableLanguages' in executor)
}

/**
 * Type guard to check if an executor is a LanguageExecutor (not a TierExecutor).
 */
export function isLanguageExecutor(executor: TierExecutor | LanguageExecutor): executor is LanguageExecutor {
  return 'getAvailableLanguages' in executor
}

/**
 * Type guard for fetcher objects that have a fetch method.
 */
export function isFetcherBinding(value: unknown): value is { fetch: typeof fetch } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fetch' in value &&
    typeof (value as { fetch: unknown }).fetch === 'function'
  )
}

/**
 * Interface for CLI-like module with optional entry points.
 */
export interface CliModule {
  run?: (args: string[]) => unknown
  main?: (args: string[]) => unknown
  default?: (args: string[]) => unknown
}

/**
 * Type guard to check if a module has a CLI-like interface.
 */
export function isCliModule(module: unknown): module is CliModule {
  if (typeof module !== 'object' || module === null) {
    return false
  }
  const mod = module as Record<string, unknown>
  return (
    typeof mod.run === 'function' ||
    typeof mod.main === 'function' ||
    typeof mod.default === 'function'
  )
}
