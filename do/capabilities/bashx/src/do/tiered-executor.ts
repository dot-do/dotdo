/**
 * Tiered Execution System
 *
 * Implements a 4-tier execution model for bash commands:
 *
 * - Tier 1: Native in-Worker via nodejs_compat_v2/ofetch (fastest, most limited)
 * - Tier 2: RPC bindings for jq.do/npm.do (fast, specific tools)
 * - Tier 3: worker_loaders for dynamic npm (flexible, dynamic loading)
 * - Tier 4: Sandbox SDK for true Linux needs (slowest, full capability)
 *
 * The executor auto-detects which tier to use based on command analysis
 * and available bindings.
 *
 * @module bashx/do/tiered-executor
 */

import type { BashExecutor } from './index.js'
import type { BashResult, ExecOptions, SpawnOptions, SpawnHandle, TypedFsCapability } from '../types.js'
import {
  executeNpmNative,
  canExecuteNativeNpm,
  extractNpmSubcommand,
  type NpmNativeOptions,
} from './commands/npm-native.js'
import {
  detectLanguage,
  type SupportedLanguage,
  type LanguageDetectionResult,
} from '../../core/classify/language-detector.js'
import {
  LanguageRouter,
} from '../../core/classify/language-router.js'
import {
  analyzeMultiLanguageSync,
  type SandboxStrategy,
} from '../../core/safety/multi-language.js'
import {
  PolyglotExecutor,
  type LanguageBinding,
} from './executors/polyglot-executor.js'
import { SandboxExecutor } from './executors/sandbox-executor.js'
import {
  LoaderExecutor,
  LOADABLE_MODULES,
} from './executors/loader-executor.js'
import { Tier1Executor } from './executors/tier1-executor.js'
import { Tier2Executor } from './executors/tier2-executor.js'
import type { TierExecutor, LanguageExecutor, TieredExecutorInternal } from './executors/types.js'
import {
  isTierExecutor,
  isSupportedLanguage,
  isCliModule,
} from './executors/types.js'
import { PipelineExecutor } from './pipeline/index.js'

// Import and re-export CommandClassifier module
// This provides an extracted, standalone classification module for tier determination
import {
  CommandClassifier,
  type ClassifyOptions,
  type ClassificationMetrics,
  type RpcServiceConfig,
  type WorkerLoaderConfig,
  type ClassifierConfig,
} from './classify/command-classifier.js'

export {
  CommandClassifier,
  type ClassifyOptions,
  type ClassificationMetrics,
  type RpcServiceConfig,
  type WorkerLoaderConfig,
  type ClassifierConfig,
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Execution tier levels
 */
export type ExecutionTier = 1 | 2 | 3 | 4

/**
 * Tier classification result.
 *
 * Contains the tier level, reason for selection, and optionally an executor
 * instance that can be called directly for polymorphic dispatch.
 */
export interface TierClassification {
  /** The tier that should handle this command */
  tier: ExecutionTier
  /** Reason for the tier selection */
  reason: string
  /** The handler that will execute the command (kept for debugging/logging) */
  handler: 'native' | 'rpc' | 'loader' | 'sandbox' | 'polyglot'
  /** Specific capability or service that will be used */
  capability?: string
  /**
   * The executor instance that will handle this command.
   *
   * When present, enables polymorphic dispatch - the caller can invoke
   * `classification.executor.execute()` directly instead of going through
   * a switch statement on the handler type.
   *
   * This field is optional for backward compatibility. If not present,
   * the caller should fall back to switch-based dispatch using the handler field.
   */
  executor?: TierExecutor | LanguageExecutor
  /**
   * Sandbox strategy for non-bash languages routed to sandbox.
   * Contains resource limits, network/filesystem restrictions based on safety analysis.
   * Only present when a non-bash language is classified for sandbox execution.
   */
  sandboxStrategy?: SandboxStrategy
}

/**
 * RPC service binding for Tier 2 execution
 */
export interface RpcServiceBinding {
  /** Service name (e.g., 'jq', 'npm') */
  name: string
  /** RPC endpoint URL or service binding */
  endpoint: string | { fetch: typeof fetch }
  /** Supported commands */
  commands: string[]
}

/**
 * Worker loader binding for Tier 3 execution
 */
export interface WorkerLoaderBinding {
  /** Loader name */
  name: string
  /** Load function to dynamically import modules */
  load: (module: string) => Promise<unknown>
  /** Available modules */
  modules: string[]
}

/**
 * Sandbox SDK binding for Tier 4 execution
 */
export interface SandboxBinding {
  /** Execute command in sandbox */
  execute: (command: string, options?: ExecOptions) => Promise<BashResult>
  /** Spawn streaming process in sandbox */
  spawn?: (command: string, args?: string[], options?: SpawnOptions) => Promise<SpawnHandle>
}

/**
 * Configuration for the TieredExecutor
 */
export interface TieredExecutorConfig {
  /**
   * Tier 1: Native filesystem capability for in-Worker operations.
   * When provided, simple file operations (cat, ls, etc.) are executed natively.
   */
  fs?: TypedFsCapability

  /**
   * Tier 2: RPC service bindings for external services.
   * Map of service name to RPC binding configuration.
   *
   * @example
   * ```typescript
   * rpcBindings: {
   *   jq: { endpoint: 'https://jq.do', commands: ['jq'] },
   *   npm: { endpoint: env.NPM_SERVICE, commands: ['npm', 'npx', 'pnpm'] },
   * }
   * ```
   */
  rpcBindings?: Record<string, RpcServiceBinding>

  /**
   * Tier 3: Worker loader bindings for dynamic npm modules.
   * Allows loading npm packages at runtime in Workers.
   */
  workerLoaders?: Record<string, WorkerLoaderBinding>

  /**
   * Tier 4: Sandbox SDK binding for full Linux execution.
   * Used when commands require true Linux capabilities.
   */
  sandbox?: SandboxBinding

  /**
   * Default timeout for command execution in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number

  /**
   * Whether to prefer faster tiers over more capable ones.
   * When true, the executor will try Tier 1 before Tier 2, etc.
   * When false, it uses the most capable tier that can handle the command.
   * @default true
   */
  preferFaster?: boolean

  /**
   * Tier 1.5: Language runtime worker bindings for multi-language execution.
   * Routes language-specific commands to warm runtime workers.
   *
   * @example
   * ```typescript
   * languageWorkers: {
   *   python: env.PYX_SERVICE,
   *   ruby: env.RUBY_SERVICE,
   *   node: env.NODE_SERVICE,
   * }
   * ```
   */
  languageWorkers?: Partial<Record<SupportedLanguage, LanguageBinding>>
}

// ============================================================================
// TIER 1: NATIVE COMMANDS
// ============================================================================

/**
 * Commands that can be executed natively in-Worker via nodejs_compat_v2
 */
const TIER_1_NATIVE_COMMANDS = new Set([
  // Basic file operations (read)
  'cat', 'head', 'tail', 'ls', 'test', '[', 'stat', 'readlink', 'find', 'grep',
  // File operations (write)
  'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'truncate', 'ln',
  // Permission operations
  'chmod', 'chown',
  // Echo/print (pure computation)
  'echo', 'printf',
  // Path operations
  'pwd', 'dirname', 'basename',
  // String/text processing (pure)
  'wc', 'sort', 'uniq', 'tr', 'cut', 'rev',
  // Date/time (pure)
  'date',
  // True/false (pure)
  'true', 'false',
  // HTTP operations (via fetch API)
  'curl', 'wget',
  // Math & control commands
  'bc', 'expr', 'seq', 'shuf', 'sleep', 'timeout',
  // Compression commands (native via pako/fflate)
  'gzip', 'gunzip', 'zcat', 'tar', 'zip', 'unzip',
  // Data processing commands (native implementations)
  'jq', 'yq', 'base64', 'envsubst',
  // Crypto commands (native via Web Crypto API)
  'sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum',
  'uuidgen', 'uuid', 'cksum', 'sum', 'openssl',
  // Text processing commands (native implementations)
  'sed', 'awk', 'diff', 'patch', 'tee', 'xargs',
  // System utility commands (native implementations)
  'yes', 'whoami', 'hostname', 'printenv',
  // Extended utility commands (native implementations)
  'env', 'id', 'uname', 'tac',
])

/**
 * Commands that specifically require filesystem access for Tier 1
 */
const TIER_1_FS_COMMANDS = new Set([
  // Read operations
  'cat', 'head', 'tail', 'ls', 'test', 'stat', 'readlink', 'find', 'grep',
  // Write operations
  'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'truncate', 'ln',
  // Permission operations
  'chmod', 'chown',
  // Compression commands (need filesystem access)
  'gzip', 'gunzip', 'zcat', 'tar', 'zip', 'unzip',
])

/**
 * Commands that use native HTTP (fetch API) for Tier 1
 */
const TIER_1_HTTP_COMMANDS = new Set(['curl', 'wget'])

/**
 * Data processing commands with native implementations
 */
const TIER_1_DATA_COMMANDS = new Set(['jq', 'yq', 'base64', 'envsubst'])

/**
 * Crypto commands with native Web Crypto API implementations
 */
const TIER_1_CRYPTO_COMMANDS = new Set([
  'sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum',
  'uuidgen', 'uuid', 'cksum', 'sum', 'openssl',
])

/**
 * Text processing commands with native implementations
 */
const TIER_1_TEXT_PROCESSING_COMMANDS = new Set([
  'sed', 'awk', 'diff', 'patch', 'tee', 'xargs',
])

/**
 * POSIX utility commands with native implementations
 * These include: cut, sort, tr, uniq, wc, basename, dirname, echo, printf, date, dd, od
 */
const TIER_1_POSIX_UTILS_COMMANDS = new Set([
  'cut', 'sort', 'tr', 'uniq', 'wc',
  'basename', 'dirname', 'echo', 'printf',
  'date', 'dd', 'od',
])

/**
 * System utility commands with native implementations
 * These include: yes, whoami, hostname, printenv
 * (sleep, seq, pwd are already handled in other command groups)
 */
const TIER_1_SYSTEM_UTILS_COMMANDS = new Set([
  'yes', 'whoami', 'hostname', 'printenv',
])

/**
 * Extended utility commands with native implementations
 * These include: env, id, uname, timeout, tac, shuf
 * Note: timeout and shuf are also in math-control, but extended-utils provides more options
 */
const TIER_1_EXTENDED_UTILS_COMMANDS = new Set([
  'env', 'id', 'uname', 'tac',
  // Note: timeout and shuf have extended implementations but also exist in math-control
])

/**
 * npm commands that can be executed natively via npmx registry client
 * These are read-only operations that don't require file system writes:
 * - npm view/info/show: Get package metadata
 * - npm search/find/s: Search packages
 *
 * More complex npm operations (install, run, etc.) go through Tier 2 RPC
 */
const TIER_1_NPM_NATIVE_COMMANDS = new Set([
  'npm',  // Will check subcommand to determine if native execution is possible
])

// ============================================================================
// TIER 2: RPC COMMANDS
// ============================================================================

/**
 * Default RPC services and their commands
 */
const DEFAULT_RPC_SERVICES: Record<string, { commands: string[]; endpoint: string }> = {
  jq: {
    commands: ['jq'],
    endpoint: 'https://jq.do',
  },
  npm: {
    commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
    endpoint: 'https://npm.do',
  },
  git: {
    commands: ['git'],
    endpoint: 'https://git.do',
  },
  pyx: {
    commands: ['python', 'python3', 'pip', 'pip3', 'pipx', 'uvx', 'pyx'],
    endpoint: 'https://pyx.do',
  },
}

// ============================================================================
// TIER 3: WORKER LOADER MODULES
// ============================================================================

/**
 * NPM packages that can be dynamically loaded in Workers
 */
const TIER_3_LOADABLE_MODULES = new Set([
  // JavaScript/TypeScript tools
  'esbuild', 'typescript', 'prettier', 'eslint',
  // Data processing
  'zod', 'ajv', 'yaml', 'toml',
  // Crypto
  'crypto-js', 'jose',
  // Utility
  'lodash', 'date-fns', 'uuid',
])

// ============================================================================
// TIER 4: SANDBOX-ONLY COMMANDS
// ============================================================================

/**
 * Commands that require true Linux sandbox execution
 */
const TIER_4_SANDBOX_COMMANDS = new Set([
  // System/process management
  'ps', 'kill', 'killall', 'top', 'htop',
  // Network tools (curl/wget moved to Tier 1 via native fetch)
  'ping', 'ssh', 'scp', 'nc', 'netstat',
  // Package managers (when not via RPC)
  'apt', 'apt-get', 'yum', 'dnf', 'brew',
  // Containers
  'docker', 'docker-compose', 'podman', 'kubectl',
  // Compilers and runtimes (python moved to Tier 2 via pyx.do RPC)
  'gcc', 'g++', 'clang', 'rustc', 'cargo', 'go', 'ruby', 'perl',
  // System utilities (chmod/chown moved to Tier 1 via FsCapability)
  'sudo', 'su', 'chgrp',
  // Archive (gzip, tar, zip moved to Tier 1 via pako/fflate)
  // Process substitution, pipes, complex shell features
  'bash', 'sh', 'zsh',
])

// ============================================================================
// EXECUTOR ADAPTERS FOR POLYMORPHIC DISPATCH
// ============================================================================

/**
 * ExecutorAdapter - Base class for tier-specific executor adapters.
 *
 * These adapters implement TierExecutor and delegate to the TieredExecutor's
 * internal methods, enabling polymorphic dispatch from TierClassification.
 *
 * The adapters use the TieredExecutorInternal interface to access tier
 * execution methods in a type-safe manner, avoiding the need for `as any` casts.
 *
 * @internal
 */
abstract class ExecutorAdapter implements TierExecutor {
  protected readonly executor: TieredExecutorInternal
  protected readonly classification: TierClassification

  constructor(executor: TieredExecutorInternal, classification: TierClassification) {
    this.executor = executor
    this.classification = classification
  }

  abstract canExecute(command: string): boolean
  abstract execute(command: string, options?: ExecOptions): Promise<BashResult>
}

/**
 * NativeExecutorAdapter - Adapter for Tier 1 native command execution.
 * @internal
 */
class NativeExecutorAdapter extends ExecutorAdapter {
  canExecute(command: string): boolean {
    const cmd = command.split(/\s+/)[0]
    return TIER_1_NATIVE_COMMANDS.has(cmd)
  }

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.executor.executeTier1(command, this.classification, options)
  }
}

/**
 * RpcExecutorAdapter - Adapter for Tier 2 RPC command execution.
 * @internal
 */
class RpcExecutorAdapter extends ExecutorAdapter {
  canExecute(_command: string): boolean {
    return this.classification.handler === 'rpc'
  }

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.executor.executeTier2(command, this.classification, options)
  }
}

/**
 * LoaderExecutorAdapter - Adapter for Tier 3 loader command execution.
 * @internal
 */
class LoaderExecutorAdapter extends ExecutorAdapter {
  canExecute(_command: string): boolean {
    return this.classification.handler === 'loader'
  }

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.executor.executeTier3(command, this.classification, options)
  }
}

/**
 * SandboxExecutorAdapter - Adapter for Tier 4 sandbox command execution.
 * @internal
 */
class SandboxExecutorAdapter extends ExecutorAdapter {
  canExecute(_command: string): boolean {
    return true // Sandbox can execute any command
  }

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.executor.executeTier4(command, this.classification, options)
  }
}

/**
 * PolyglotExecutorAdapter - Adapter for polyglot (language runtime) execution.
 * @internal
 */
class PolyglotExecutorAdapter extends ExecutorAdapter {
  canExecute(_command: string): boolean {
    return this.classification.handler === 'polyglot'
  }

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    return this.executor.executePolyglot(command, this.classification, options)
  }
}

// ============================================================================
// TIERED EXECUTOR CLASS
// ============================================================================

/**
 * TieredExecutor - Smart executor that routes commands to the appropriate tier.
 *
 * The executor analyzes each command and determines the optimal execution tier:
 * - Tier 1: Fast, in-Worker native operations (cat, ls, echo, etc.)
 * - Tier 2: RPC calls to external services (jq.do, npm.do, git.do)
 * - Tier 3: Dynamic npm module loading (esbuild, prettier, etc.)
 * - Tier 4: Full sandbox execution for Linux-specific commands
 *
 * @example
 * ```typescript
 * const executor = new TieredExecutor({
 *   fs: fsCapability,
 *   rpcBindings: {
 *     jq: { endpoint: 'https://jq.do', commands: ['jq'] },
 *   },
 *   sandbox: sandboxBinding,
 * })
 *
 * // Auto-routed to Tier 1 (native)
 * await executor.execute('cat file.txt')
 *
 * // Auto-routed to Tier 2 (RPC)
 * await executor.execute('jq .name package.json')
 *
 * // Auto-routed to Tier 4 (sandbox)
 * await executor.execute('docker ps')
 * ```
 */
/**
 * LRU cache for tier classification results.
 * Caches command-name-based classifications to avoid repeated lookups.
 *
 * @internal
 */
class ClassificationCache {
  private readonly cache = new Map<string, TierClassification>()
  private readonly maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  get(key: string): TierClassification | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end for LRU behavior
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: string, value: TierClassification): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

/**
 * Metrics for tier usage tracking.
 *
 * Tracks execution counts and timing per tier to help with
 * performance analysis and optimization decisions.
 */
export interface TierMetrics {
  /** Total classifications performed */
  totalClassifications: number
  /** Classifications served from cache */
  cacheHits: number
  /** Classifications computed fresh */
  cacheMisses: number
  /** Execution counts per tier */
  tierCounts: Record<ExecutionTier, number>
  /** Execution counts per handler type */
  handlerCounts: Record<string, number>
  /** Cache hit ratio (0-1) */
  cacheHitRatio: number
}

export class TieredExecutor implements BashExecutor {
  private readonly fs?: TypedFsCapability
  private readonly rpcBindings: Record<string, RpcServiceBinding>
  private readonly workerLoaders: Record<string, WorkerLoaderBinding>
  private readonly sandbox?: SandboxBinding
  private readonly defaultTimeout: number
  /** @internal Reserved for future optimization strategy selection */
  public readonly preferFaster: boolean
  private readonly languageWorkers: Partial<Record<SupportedLanguage, LanguageBinding>>
  private readonly polyglotExecutor?: PolyglotExecutor
  private readonly sandboxExecutor?: SandboxExecutor
  private readonly loaderExecutor?: LoaderExecutor
  private readonly tier1Executor: Tier1Executor
  private readonly tier2Executor: Tier2Executor
  private readonly pipelineExecutor: PipelineExecutor
  private readonly languageRouter: LanguageRouter

  // Caching infrastructure
  private readonly classificationCache: ClassificationCache
  private readonly languageDetectionCache = new Map<string, LanguageDetectionResult>()
  private readonly languageDetectionCacheMaxSize = 500

  // Metrics tracking
  private metricsEnabled = false
  private totalClassifications = 0
  private cacheHits = 0
  private cacheMisses = 0
  private readonly tierCounts: Record<ExecutionTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  private readonly handlerCounts: Record<string, number> = {}

  // Pre-computed lookup sets for fast-path optimization
  private readonly rpcCommandSet: Set<string>

  constructor(config: TieredExecutorConfig) {
    this.fs = config.fs
    this.rpcBindings = config.rpcBindings ?? {}
    this.workerLoaders = config.workerLoaders ?? {}
    this.sandbox = config.sandbox
    this.defaultTimeout = config.defaultTimeout ?? 30000
    this.preferFaster = config.preferFaster ?? true
    this.languageWorkers = config.languageWorkers ?? {}
    this.languageRouter = new LanguageRouter()

    // Initialize PolyglotExecutor if language workers are configured
    if (Object.keys(this.languageWorkers).length > 0) {
      this.polyglotExecutor = new PolyglotExecutor({
        bindings: this.languageWorkers,
        defaultTimeout: this.defaultTimeout,
      })
    }

    // Initialize SandboxExecutor if sandbox binding is configured
    if (this.sandbox) {
      this.sandboxExecutor = new SandboxExecutor({
        sandbox: this.sandbox,
        defaultTimeout: this.defaultTimeout,
      })
    }

    // Initialize LoaderExecutor if worker loaders are configured
    // LoaderExecutor handles Tier 3 dynamic npm module loading
    if (Object.keys(this.workerLoaders).length > 0) {
      this.loaderExecutor = new LoaderExecutor({
        workerLoaders: this.workerLoaders,
        defaultTimeout: this.defaultTimeout,
      })
    }

    // Initialize Tier1Executor for native in-Worker execution
    // Tier1Executor wraps NativeExecutor with consistent BashResult formatting
    this.tier1Executor = new Tier1Executor({
      fs: config.fs,
      defaultTimeout: this.defaultTimeout,
    })

    // Merge default RPC services with provided bindings BEFORE creating Tier2Executor
    for (const [name, service] of Object.entries(DEFAULT_RPC_SERVICES)) {
      if (!this.rpcBindings[name]) {
        this.rpcBindings[name] = {
          name,
          endpoint: service.endpoint,
          commands: service.commands,
        }
      }
    }

    // Initialize Tier2Executor for RPC service execution
    // Tier2Executor wraps RpcExecutor for external service calls
    // Pass the merged rpcBindings for RPC routing
    this.tier2Executor = new Tier2Executor({
      bindings: this.rpcBindings,
      defaultTimeout: this.defaultTimeout,
    })

    // Initialize PipelineExecutor with a bound executor function
    // This allows pipeline orchestration to be separated from command execution
    this.pipelineExecutor = new PipelineExecutor(
      (cmd, opts) => this.executeSingleCommand(cmd, opts)
    )

    // Initialize classification cache
    this.classificationCache = new ClassificationCache(1000)

    // Pre-compute RPC command set for O(1) lookups in hot path
    this.rpcCommandSet = new Set<string>()
    for (const binding of Object.values(this.rpcBindings)) {
      for (const cmd of binding.commands) {
        this.rpcCommandSet.add(cmd)
      }
    }
  }

  // ============================================================================
  // METRICS AND CACHE MANAGEMENT
  // ============================================================================

  /**
   * Enable metrics collection for tier usage analysis.
   * When enabled, tracks classification counts, cache hits, and tier usage.
   */
  enableMetrics(): void {
    this.metricsEnabled = true
  }

  /**
   * Disable metrics collection.
   */
  disableMetrics(): void {
    this.metricsEnabled = false
  }

  /**
   * Get current tier usage metrics.
   *
   * @returns TierMetrics with counts and cache statistics
   *
   * @example
   * ```typescript
   * executor.enableMetrics()
   * await executor.execute('echo hello')
   * await executor.execute('echo world')
   * const metrics = executor.getMetrics()
   * console.log(metrics.cacheHitRatio) // 0.5 (second call hit cache)
   * ```
   */
  getMetrics(): TierMetrics {
    const total = this.cacheHits + this.cacheMisses
    return {
      totalClassifications: this.totalClassifications,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      tierCounts: { ...this.tierCounts },
      handlerCounts: { ...this.handlerCounts },
      cacheHitRatio: total > 0 ? this.cacheHits / total : 0,
    }
  }

  /**
   * Reset all metrics to zero.
   */
  resetMetrics(): void {
    this.totalClassifications = 0
    this.cacheHits = 0
    this.cacheMisses = 0
    this.tierCounts[1] = 0
    this.tierCounts[2] = 0
    this.tierCounts[3] = 0
    this.tierCounts[4] = 0
    for (const key of Object.keys(this.handlerCounts)) {
      delete this.handlerCounts[key]
    }
  }

  /**
   * Clear all caches (classification and language detection).
   * Useful for testing or when configuration changes.
   */
  clearCaches(): void {
    this.classificationCache.clear()
    this.languageDetectionCache.clear()
  }

  /**
   * Get cache statistics for debugging.
   */
  getCacheStats(): { classificationCacheSize: number; languageDetectionCacheSize: number } {
    return {
      classificationCacheSize: this.classificationCache.size,
      languageDetectionCacheSize: this.languageDetectionCache.size,
    }
  }

  /**
   * Detect the language of a command or code input.
   * Results are cached for performance.
   *
   * @param input - The command or code to analyze
   * @returns Language detection result with language, confidence, and method
   */
  detectLanguage(input: string): LanguageDetectionResult {
    // Check cache first
    const cached = this.languageDetectionCache.get(input)
    if (cached !== undefined) {
      return cached
    }

    // Compute and cache result
    const result = detectLanguage(input)

    // LRU eviction for language detection cache
    if (this.languageDetectionCache.size >= this.languageDetectionCacheMaxSize) {
      const firstKey = this.languageDetectionCache.keys().next().value
      if (firstKey !== undefined) {
        this.languageDetectionCache.delete(firstKey)
      }
    }
    this.languageDetectionCache.set(input, result)

    return result
  }

  /**
   * Check if a language worker is available.
   *
   * @param language - The language to check
   * @returns true if a worker is configured for the language
   */
  hasLanguageWorker(language: SupportedLanguage): boolean {
    return this.languageWorkers[language] !== undefined
  }

  /**
   * Get list of languages with configured workers.
   *
   * @returns Array of language names with workers
   */
  getAvailableLanguages(): SupportedLanguage[] {
    return Object.keys(this.languageWorkers).filter(
      (key) => this.languageWorkers[key as SupportedLanguage] !== undefined
    ) as SupportedLanguage[]
  }

  /**
   * Create an executor adapter for a classification.
   *
   * This method attaches the appropriate executor instance to the classification,
   * enabling polymorphic dispatch. The executor can be called directly via
   * `classification.executor.execute()` instead of using a switch statement.
   *
   * @param classification - The base classification without executor
   * @returns The classification with executor attached
   * @internal
   */
  private withExecutor(classification: Omit<TierClassification, 'executor'>): TierClassification {
    let executor: TierExecutor | LanguageExecutor | undefined

    // Cast this to TieredExecutorInternal for type-safe access to tier methods.
    // This is safe because TieredExecutor implements all required methods.
    const internal = this.asInternal()

    switch (classification.handler) {
      case 'native':
        executor = new NativeExecutorAdapter(internal, classification as TierClassification)
        break
      case 'rpc':
        executor = new RpcExecutorAdapter(internal, classification as TierClassification)
        break
      case 'loader':
        executor = new LoaderExecutorAdapter(internal, classification as TierClassification)
        break
      case 'sandbox':
        executor = new SandboxExecutorAdapter(internal, classification as TierClassification)
        break
      case 'polyglot':
        executor = new PolyglotExecutorAdapter(internal, classification as TierClassification)
        break
    }

    return {
      ...classification,
      executor,
    }
  }

  /**
   * Get a type-safe internal interface for adapter access.
   *
   * This method provides a typed reference to the tier execution methods,
   * enabling adapters to call them without using `as any` casts.
   *
   * @returns TieredExecutorInternal interface for type-safe method access
   * @internal
   */
  private asInternal(): TieredExecutorInternal {
    return {
      executeTier1: this.executeTier1.bind(this),
      executeTier2: this.executeTier2.bind(this),
      executeTier3: this.executeTier3.bind(this),
      executeTier4: this.executeTier4.bind(this),
      executePolyglot: this.executePolyglot.bind(this),
    }
  }

  /**
   * Classify a command to determine which tier should execute it.
   *
   * For non-bash languages that route to sandbox (Tier 4), this method
   * performs safety analysis to determine appropriate resource limits
   * via the sandboxStrategy field.
   *
   * Results are cached based on the command name for fast repeated lookups.
   * Commands that depend on arguments (like `npm`) bypass the cache.
   *
   * @param command - The command to classify
   * @returns TierClassification with tier level, handler info, and optional sandboxStrategy
   *
   * @example
   * ```typescript
   * // Bash command - no sandboxStrategy
   * const bashClass = executor.classifyCommand('ls -la')
   * // bashClass.sandboxStrategy === undefined
   *
   * // Python command without worker - includes sandboxStrategy
   * const pyClass = executor.classifyCommand('python -c "eval(input())"')
   * // pyClass.sandboxStrategy.network === 'none' (dangerous pattern detected)
   * ```
   */
  classifyCommand(command: string): TierClassification {
    // Track metrics
    if (this.metricsEnabled) {
      this.totalClassifications++
    }

    const cmd = this.extractCommandName(command)

    // Fast path: Check cache for command-name-based classifications
    // Note: Some commands (like npm) depend on args, so they use full command as key
    const cacheKey = this.getCacheKey(cmd, command)
    const cached = this.classificationCache.get(cacheKey)
    if (cached !== undefined) {
      if (this.metricsEnabled) {
        this.cacheHits++
        this.tierCounts[cached.tier]++
        this.handlerCounts[cached.handler] = (this.handlerCounts[cached.handler] || 0) + 1
      }
      return cached
    }

    if (this.metricsEnabled) {
      this.cacheMisses++
    }

    // Compute classification
    const classification = this.classifyCommandInternal(cmd, command)

    // Track metrics
    if (this.metricsEnabled) {
      this.tierCounts[classification.tier]++
      this.handlerCounts[classification.handler] = (this.handlerCounts[classification.handler] || 0) + 1
    }

    // Cache the result (unless it involves safety analysis which is command-specific)
    if (!classification.sandboxStrategy) {
      this.classificationCache.set(cacheKey, classification)
    }

    return classification
  }

  /**
   * Generate cache key for a command.
   * Most commands only need the command name, but some (like npm) depend on subcommands.
   *
   * @internal
   */
  private getCacheKey(cmd: string, fullCommand: string): string {
    // Commands that need full command for cache key (subcommand-dependent)
    if (cmd === 'npm' || cmd === 'python' || cmd === 'python3') {
      return fullCommand.trim()
    }
    // Most commands can be cached by name alone
    return cmd
  }

  /**
   * Internal classification logic (without caching).
   *
   * @internal
   */
  private classifyCommandInternal(cmd: string, command: string): TierClassification {
    // ========================================================================
    // FAST PATH: Tier 1 Native Commands (most common)
    // ========================================================================
    // Use Set.has() for O(1) lookup - this is the hot path
    if (TIER_1_NATIVE_COMMANDS.has(cmd)) {
      return this.classifyTier1Command(cmd, command)
    }

    // Check if npm command can be executed natively via npmx registry client
    // This handles simple read-only operations like npm view, npm search
    if (TIER_1_NPM_NATIVE_COMMANDS.has(cmd)) {
      const args = this.extractArgs(command)
      if (canExecuteNativeNpm(args)) {
        const subcommand = extractNpmSubcommand(command)
        return this.withExecutor({
          tier: 1,
          reason: `Native npm registry operation via npmx (${subcommand})`,
          handler: 'native',
          capability: 'npm-native',
        })
      }
      // Fall through to Tier 2 RPC for complex npm operations
    }

    // ========================================================================
    // Tier 1.5: Polyglot (language workers)
    // ========================================================================
    // Use LanguageRouter for unified language detection and routing
    const availableWorkers = this.getAvailableLanguages()
    const routingResult = this.languageRouter.route(command, availableWorkers)

    // Route non-bash languages based on worker availability
    if (routingResult.language !== 'bash') {
      if (routingResult.routeTo === 'polyglot' && routingResult.worker) {
        const reason = routingResult.packageManager
          ? `polyglot execution via ${routingResult.language} worker (${routingResult.packageManager})`
          : `polyglot execution via ${routingResult.language} worker`
        return this.withExecutor({
          tier: 2, // Using tier 2 slot since there's no 1.5 in ExecutionTier type
          reason,
          handler: 'polyglot',
          capability: routingResult.language,
        })
      } else {
        // No language worker configured for this language - skip RPC and go to sandbox
        // Perform safety analysis to determine sandbox resource limits
        return this.classifyForSandboxWithSafetyAnalysis(
          command,
          routingResult.language
        )
      }
    }

    // Handle package managers that route to polyglot (e.g., pip -> python worker)
    if (routingResult.packageManager && routingResult.routeTo === 'polyglot' && routingResult.worker) {
      return this.withExecutor({
        tier: 2,
        reason: `polyglot execution via ${routingResult.language} worker (${routingResult.packageManager})`,
        handler: 'polyglot',
        capability: routingResult.language,
      })
    }

    // ========================================================================
    // Tier 2: RPC service commands
    // ========================================================================
    // Use pre-computed Set for O(1) lookup instead of iterating bindings
    if (this.rpcCommandSet.has(cmd)) {
      // Find the specific service (still need to iterate for service name)
      for (const [serviceName, binding] of Object.entries(this.rpcBindings)) {
        if (binding.commands.includes(cmd)) {
          return this.withExecutor({
            tier: 2,
            reason: `RPC service available (${serviceName})`,
            handler: 'rpc',
            capability: serviceName,
          })
        }
      }
    }

    // ========================================================================
    // Tier 3: Worker loaders
    // ========================================================================
    const workerLoaderMatch = this.matchWorkerLoader(command)
    if (workerLoaderMatch) {
      return this.withExecutor({
        tier: 3,
        reason: `Dynamic npm module available (${workerLoaderMatch})`,
        handler: 'loader',
        capability: workerLoaderMatch,
      })
    }

    // ========================================================================
    // Tier 4: Sandbox (fallback)
    // ========================================================================
    return this.withExecutor({
      tier: 4,
      reason: TIER_4_SANDBOX_COMMANDS.has(cmd)
        ? `Requires Linux sandbox (${cmd})`
        : 'No higher tier available for this command',
      handler: 'sandbox',
      capability: 'container',
    })
  }

  /**
   * Classify a Tier 1 native command based on its capability type.
   * This is extracted for readability and to keep the hot path lean.
   *
   * @internal
   */
  private classifyTier1Command(cmd: string, _command: string): TierClassification {
    // Filesystem commands - need to check if fs capability is available
    if (TIER_1_FS_COMMANDS.has(cmd)) {
      if (this.fs) {
        return this.withExecutor({
          tier: 1,
          reason: `Native filesystem operation via FsCapability`,
          handler: 'native',
          capability: 'fs',
        })
      }
      // Fall through to sandbox if no fs capability
      return this.withExecutor({
        tier: 4,
        reason: 'Filesystem command requires FsCapability (not available)',
        handler: 'sandbox',
        capability: 'container',
      })
    }

    // HTTP commands via native fetch API
    if (TIER_1_HTTP_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native HTTP operation via fetch API (${cmd})`,
        handler: 'native',
        capability: 'http',
      })
    }

    // Data processing commands (jq, yq, base64, envsubst)
    if (TIER_1_DATA_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native data processing command (${cmd})`,
        handler: 'native',
        capability: cmd, // Use command name as capability
      })
    }

    // Crypto commands via Web Crypto API
    if (TIER_1_CRYPTO_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native crypto command via Web Crypto API (${cmd})`,
        handler: 'native',
        capability: 'crypto',
      })
    }

    // Text processing commands (sed, awk, diff, patch, tee, xargs)
    if (TIER_1_TEXT_PROCESSING_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native text processing command (${cmd})`,
        handler: 'native',
        capability: 'text',
      })
    }

    // POSIX utility commands
    if (TIER_1_POSIX_UTILS_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native POSIX utility command (${cmd})`,
        handler: 'native',
        capability: 'posix',
      })
    }

    // System utility commands
    if (TIER_1_SYSTEM_UTILS_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native system utility command (${cmd})`,
        handler: 'native',
        capability: 'system',
      })
    }

    // Extended utility commands
    if (TIER_1_EXTENDED_UTILS_COMMANDS.has(cmd)) {
      return this.withExecutor({
        tier: 1,
        reason: `Native extended utility command (${cmd})`,
        handler: 'native',
        capability: 'extended',
      })
    }

    // Pure computation commands (default for Tier 1)
    return this.withExecutor({
      tier: 1,
      reason: `Pure computation command (${cmd})`,
      handler: 'native',
      capability: 'compute',
    })
  }

  /**
   * Create a Tier 4 (sandbox) classification with multi-language safety analysis.
   *
   * This helper performs safety analysis for non-bash languages to determine
   * appropriate sandbox resource limits based on detected dangerous patterns.
   *
   * @param command - The command being classified
   * @param language - The detected programming language
   * @returns TierClassification with sandboxStrategy included
   */
  private classifyForSandboxWithSafetyAnalysis(
    command: string,
    language: SupportedLanguage
  ): TierClassification {
    const safetyAnalysis = analyzeMultiLanguageSync(command)
    return this.withExecutor({
      tier: 4,
      reason: `No language worker for ${language}, using sandbox`,
      handler: 'sandbox',
      capability: 'container',
      sandboxStrategy: safetyAnalysis.sandboxStrategy,
    })
  }

  /**
   * Execute a command, automatically routing to the appropriate tier.
   *
   * @param command - The command to execute
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    // Handle input redirection (< filename)
    const redirectMatch = command.match(/^(.+?)\s*<\s*(\S+)\s*$/)
    if (redirectMatch && this.fs) {
      const actualCommand = redirectMatch[1].trim()
      const inputFile = redirectMatch[2]
      try {
        const inputContent = await this.fs.read(inputFile, { encoding: 'utf-8' })
        return this.execute(actualCommand, { ...options, stdin: inputContent })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return this.createResult(command, '', message, 1, 1)
      }
    }

    // Delegate to PipelineExecutor for all commands (handles both pipelines and single commands)
    return this.pipelineExecutor.execute(command, options)
  }

  /**
   * Execute a single command (no pipeline handling).
   * This is called by the PipelineExecutor for each segment.
   *
   * Uses polymorphic dispatch when an executor is present in the classification,
   * falling back to switch-based dispatch for backward compatibility.
   */
  private async executeSingleCommand(command: string, options?: ExecOptions): Promise<BashResult> {
    const classification = this.classifyCommand(command)

    try {
      // Polymorphic dispatch: use the executor instance if present
      // This is the preferred execution path - no switch statement needed
      if (classification.executor) {
        // Handle LanguageExecutor (polyglot) separately since it has a different signature
        if (classification.handler === 'polyglot') {
          return await this.executePolyglot(command, classification, options)
        }
        // Use type guard to safely narrow executor type
        // isTierExecutor checks for absence of getAvailableLanguages method
        if (isTierExecutor(classification.executor)) {
          return await classification.executor.execute(command, options)
        }
        // Fallback for edge case where executor is LanguageExecutor but handler isn't polyglot
        return await this.executePolyglot(command, classification, options)
      }

      // Fallback: switch-based dispatch for backward compatibility
      // This path is kept for cases where executor might not be set
      if (classification.handler === 'polyglot') {
        return await this.executePolyglot(command, classification, options)
      }

      switch (classification.tier) {
        case 1:
          return await this.executeTier1(command, classification, options)
        case 2:
          return await this.executeTier2(command, classification, options)
        case 3:
          return await this.executeTier3(command, classification, options)
        case 4:
          return await this.executeTier4(command, classification, options)
        default:
          throw new Error(`Unknown tier: ${classification.tier}`)
      }
    } catch (error) {
      // If a higher tier fails, try falling back to a lower tier
      if (classification.tier < 4 && this.sandbox) {
        console.warn(
          `Tier ${classification.tier} failed for "${command}", falling back to sandbox:`,
          error
        )
        return this.executeTier4(command, { ...classification, tier: 4 }, options)
      }
      throw error
    }
  }

  /**
   * Execute a command via the PolyglotExecutor (Tier 1.5).
   * Routes to language-specific warm runtime workers.
   * Falls back to sandbox on RPC failure.
   */
  private async executePolyglot(
    command: string,
    classification: TierClassification,
    options?: ExecOptions
  ): Promise<BashResult> {
    // Use type guard to safely narrow capability to SupportedLanguage
    if (!isSupportedLanguage(classification.capability)) {
      throw new Error('No valid language specified for polyglot execution')
    }
    const language = classification.capability

    if (!this.polyglotExecutor) {
      throw new Error('PolyglotExecutor not initialized')
    }

    try {
      const result = await this.polyglotExecutor.execute(command, language, options)

      // Check if the result indicates an RPC failure that should trigger fallback
      if (result.exitCode !== 0 && result.stderr?.includes('Network error')) {
        // RPC failed - throw to trigger fallback to sandbox
        throw new Error(`Polyglot RPC failed: ${result.stderr}`)
      }

      // Enhance result with polyglot-specific classification info
      return {
        ...result,
        classification: {
          ...result.classification,
          handler: 'polyglot',
          language,
          reason: `polyglot execution via ${language} worker`,
        } as typeof result.classification & { handler: string; language: string },
      }
    } catch (error) {
      // If sandbox is available, fall back to it
      if (this.sandbox) {
        console.warn(
          `Polyglot execution failed for "${command}", falling back to sandbox:`,
          error
        )
        return this.executeTier4(command, { ...classification, tier: 4, handler: 'sandbox' }, options)
      }
      throw error
    }
  }

  /**
   * Spawn a streaming process. Routes to sandbox for full streaming support.
   */
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    if (!this.sandbox?.spawn) {
      throw new Error('Spawn requires sandbox with spawn support')
    }
    return this.sandbox.spawn(command, args, options)
  }

  // ============================================================================
  // TIER EXECUTION METHODS
  // ============================================================================

  /**
   * Tier 1: Execute command natively in-Worker
   *
   * Delegates to Tier1Executor for standard native commands.
   * npm-native commands are handled specially via the npmx registry client.
   */
  private async executeTier1(
    command: string,
    classification: TierClassification,
    options?: ExecOptions
  ): Promise<BashResult> {
    // Handle npm native commands specially (not yet in Tier1Executor)
    if (classification.capability === 'npm-native') {
      const args = this.extractArgs(command)
      return this.executeNpmNative(this.extractCommandName(command), args, command, options)
    }

    // Delegate all other Tier 1 commands to Tier1Executor
    // Tier1Executor wraps NativeExecutor which handles:
    // - Filesystem operations (cat, ls, head, tail, test, mkdir, rm, cp, mv, etc.)
    // - HTTP operations (curl, wget)
    // - Data processing (jq, yq, base64, envsubst)
    // - Crypto operations (sha256sum, md5sum, uuidgen, etc.)
    // - Text processing (sed, awk, diff, patch, tee, xargs)
    // - POSIX utilities (cut, sort, tr, uniq, wc, date, dd, od, etc.)
    // - System utilities (yes, whoami, hostname, printenv)
    // - Extended utilities (env, id, uname, tac)
    // - Pure computation (true, false, pwd, echo, printf, bc, expr, seq, etc.)
    return this.tier1Executor.execute(command, options)
  }

  /**
   * Execute npm commands natively via npmx registry client
   *
   * Handles simple read-only npm operations that only need registry access:
   * - npm view/info/show: Get package metadata
   * - npm search/find/s: Search packages
   *
   * For complex operations (install, run, etc.), returns null to fall through
   * to Tier 2 RPC execution.
   */
  private async executeNpmNative(
    _cmd: string,
    args: string[],
    fullCommand: string,
    options?: ExecOptions
  ): Promise<BashResult> {
    try {
      // Build npm native options from exec options
      const npmOptions: NpmNativeOptions = {
        timeout: options?.timeout,
        cache: true,
      }

      // Check for registry override in environment
      const env = options?.env as Record<string, string> | undefined
      if (env?.npm_config_registry) {
        npmOptions.registry = env.npm_config_registry
      }
      if (env?.NPM_CONFIG_REGISTRY) {
        npmOptions.registry = env.NPM_CONFIG_REGISTRY
      }

      // Check for auth token
      if (env?.npm_config_token) {
        npmOptions.token = env.npm_config_token
      }
      if (env?.NPM_TOKEN) {
        npmOptions.token = env.NPM_TOKEN
      }

      // Execute the npm command natively
      const result = await executeNpmNative(fullCommand, args, npmOptions)

      if (result === null) {
        // Command not supported natively, this shouldn't happen if classification
        // worked correctly, but throw to fall back to RPC
        throw new Error('npm command not supported natively')
      }

      return this.createResult(fullCommand, result.stdout, result.stderr, result.exitCode, 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.createResult(fullCommand, '', `npm: ${message}`, 1, 1)
    }
  }

  /**
   * Tier 2: Execute command via RPC service
   *
   * Delegates to Tier2Executor which wraps RpcExecutor for external service calls.
   * Services include jq.do, npm.do, git.do, pyx.do, and custom RPC bindings.
   */
  private async executeTier2(
    command: string,
    _classification: TierClassification,
    options?: ExecOptions
  ): Promise<BashResult> {
    // Delegate to Tier2Executor which handles:
    // - Service routing based on command
    // - HTTP/Fetcher endpoint handling
    // - Response parsing and validation
    return this.tier2Executor.execute(command, options)
  }

  /**
   * Tier 3: Execute via worker_loaders (dynamic npm modules)
   *
   * Delegates to LoaderExecutor for proper module-specific handling
   * of esbuild, typescript, prettier, eslint, yaml, lodash, etc.
   */
  private async executeTier3(
    command: string,
    classification: TierClassification,
    options?: ExecOptions
  ): Promise<BashResult> {
    // Delegate to LoaderExecutor if available
    if (this.loaderExecutor) {
      try {
        return await this.loaderExecutor.execute(command, options)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Tier 3 loader execution failed: ${message}`)
      }
    }

    // Fallback to inline implementation for backward compatibility
    // when loaderExecutor is not initialized
    const moduleName = classification.capability
    if (!moduleName) {
      throw new Error('No module specified for Tier 3 execution')
    }

    const loader = this.workerLoaders[moduleName]
    if (!loader) {
      throw new Error(`Worker loader not found: ${moduleName}`)
    }

    try {
      // Load the module dynamically
      const module = await loader.load(moduleName)

      // Execute command based on module type using inline fallback
      const result = await this.executeLoadedModuleFallback(module, command)
      return this.createResult(command, result.stdout, result.stderr, result.exitCode, 3)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Tier 3 worker loader execution failed: ${message}`)
    }
  }

  /**
   * Fallback for executing dynamically loaded modules when LoaderExecutor not available.
   * This is a simplified implementation - LoaderExecutor has full module-specific handling.
   * @internal
   */
  private async executeLoadedModuleFallback(
    module: unknown,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cmd = this.extractCommandName(command)
    const args = this.extractArgs(command)

    // Check if module has a CLI-like interface using type guard
    if (!isCliModule(module)) {
      throw new Error(`Module ${cmd} does not have a callable interface`)
    }

    // Try common patterns for CLI modules
    if (module.run) {
      const result = await module.run(args)
      return { stdout: String(result), stderr: '', exitCode: 0 }
    }

    if (module.main) {
      const result = await module.main(args)
      return { stdout: String(result), stderr: '', exitCode: 0 }
    }

    if (module.default) {
      const result = await module.default(args)
      return { stdout: String(result), stderr: '', exitCode: 0 }
    }

    // This shouldn't be reachable since isCliModule ensures at least one method exists
    throw new Error(`Module ${cmd} does not have a callable interface`)
  }

  /**
   * Tier 4: Execute via Sandbox SDK
   *
   * Delegates to SandboxExecutor for full Linux sandbox execution.
   * The SandboxExecutor handles tier metadata enhancement and error handling.
   */
  private async executeTier4(
    command: string,
    _classification: TierClassification,
    options?: ExecOptions
  ): Promise<BashResult> {
    if (!this.sandboxExecutor) {
      throw new Error('Sandbox not configured. Tier 4 execution requires a sandbox binding.')
    }

    // Delegate to SandboxExecutor - it handles tier metadata enhancement
    return this.sandboxExecutor.execute(command, options)
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Extract command name from a full command string
   */
  private extractCommandName(command: string): string {
    const trimmed = command.trim()
    // Handle env vars prefix: VAR=value cmd
    const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '')
    // Get first word
    const match = withoutEnvVars.match(/^[\w\-\.\/]+/)
    if (!match) return ''
    // Handle path: /usr/bin/cmd -> cmd
    const name = match[0].split('/').pop() || ''
    return name
  }

  /**
   * Extract arguments from a full command string
   */
  private extractArgs(command: string): string[] {
    const trimmed = command.trim()
    // Remove env vars prefix
    const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '')
    // Split by whitespace, respecting quotes
    const parts = this.tokenize(withoutEnvVars)
    // Skip the command name
    return parts.slice(1)
  }

  /**
   * Tokenize command respecting quotes and escape sequences
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      // Handle escape sequences in double quotes
      if (char === '\\' && inDoubleQuote && i + 1 < input.length) {
        const nextChar = input[i + 1]
        // Keep the escape sequence for later processing
        current += char + nextChar
        i++ // Skip the escaped character
        continue
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        current += char
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        current += char
      } else if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
        if (current) {
          tokens.push(this.stripQuotes(current))
          current = ''
        }
      } else {
        current += char
      }
    }

    if (current) {
      tokens.push(this.stripQuotes(current))
    }

    return tokens
  }

  /**
   * Strip outer quotes from a string and unescape inner quotes
   */
  private stripQuotes(s: string): string {
    if (s.startsWith('"') && s.endsWith('"')) {
      // Remove outer double quotes and unescape inner escaped quotes
      return s.slice(1, -1).replace(/\\"/g, '"')
    }
    if (s.startsWith("'") && s.endsWith("'")) {
      // Remove outer single quotes (no escaping in single quotes)
      return s.slice(1, -1)
    }
    return s
  }

  /**
   * Check if a command can use a worker loader.
   *
   * Uses LOADABLE_MODULES from LoaderExecutor for consistency.
   */
  private matchWorkerLoader(command: string): string | null {
    const cmd = this.extractCommandName(command)

    // Check if we have a loader for this command in configured worker loaders
    for (const [name, loader] of Object.entries(this.workerLoaders)) {
      if (loader.modules.includes(cmd)) {
        return name
      }
    }

    // Check if it's a known loadable module (use imported LOADABLE_MODULES)
    // Also check TIER_3_LOADABLE_MODULES for backward compatibility
    if (LOADABLE_MODULES.has(cmd) || TIER_3_LOADABLE_MODULES.has(cmd)) {
      return cmd
    }

    return null
  }

  /**
   * Create a BashResult with tier information
   */
  private createResult(
    command: string,
    stdout: string,
    stderr: string,
    exitCode: number,
    tier: ExecutionTier
  ): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout,
      stderr,
      exitCode,
      intent: {
        commands: [this.extractCommandName(command)],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: `Executed via Tier ${tier}`,
      },
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get tier capabilities summary
   */
  getCapabilities(): {
    tier1: { available: boolean; commands: string[] }
    tier2: { available: boolean; services: string[] }
    tier3: { available: boolean; loaders: string[] }
    tier4: { available: boolean }
  } {
    return {
      tier1: {
        available: true, // Always available for pure compute
        commands: Array.from(TIER_1_NATIVE_COMMANDS),
      },
      tier2: {
        available: Object.keys(this.rpcBindings).length > 0,
        services: Object.keys(this.rpcBindings),
      },
      tier3: {
        available: Object.keys(this.workerLoaders).length > 0,
        loaders: Object.keys(this.workerLoaders),
      },
      tier4: {
        available: this.sandbox !== undefined,
      },
    }
  }

  /**
   * Check if a specific tier is available for a command
   */
  isTierAvailable(tier: ExecutionTier, command?: string): boolean {
    switch (tier) {
      case 1:
        if (!command) return true
        const cmd1 = this.extractCommandName(command)
        if (TIER_1_FS_COMMANDS.has(cmd1)) return this.fs !== undefined
        return TIER_1_NATIVE_COMMANDS.has(cmd1)
      case 2:
        if (!command) return Object.keys(this.rpcBindings).length > 0
        const cmd2 = this.extractCommandName(command)
        return Object.values(this.rpcBindings).some(b => b.commands.includes(cmd2))
      case 3:
        if (!command) return Object.keys(this.workerLoaders).length > 0
        return this.matchWorkerLoader(command) !== null
      case 4:
        return this.sandbox !== undefined
      default:
        return false
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a TieredExecutor from environment bindings.
 *
 * @param env - Worker environment with bindings
 * @param options - Additional configuration options
 * @returns Configured TieredExecutor
 *
 * @example
 * ```typescript
 * // In your Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const executor = createTieredExecutor(env, {
 *       rpcBindings: {
 *         jq: { endpoint: env.JQ_SERVICE, commands: ['jq'] },
 *       },
 *       sandbox: {
 *         execute: async (cmd, opts) => containerExecutor.run(cmd, opts),
 *       },
 *     })
 *
 *     // Commands are auto-routed to the best tier
 *     const result = await executor.execute('echo hello')
 *     return new Response(result.stdout)
 *   }
 * }
 * ```
 */
export function createTieredExecutor(
  _env: Record<string, unknown>,
  options?: Partial<TieredExecutorConfig>
): TieredExecutor {
  return new TieredExecutor({
    fs: options?.fs,
    rpcBindings: options?.rpcBindings,
    workerLoaders: options?.workerLoaders,
    sandbox: options?.sandbox,
    defaultTimeout: options?.defaultTimeout,
    preferFaster: options?.preferFaster,
  })
}
