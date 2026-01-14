/**
 * CommandClassifier - Pure command classification module
 *
 * This module extracts command classification logic from TieredExecutor into
 * a standalone, testable module with single responsibility. It analyzes bash
 * commands and determines which execution tier should handle them.
 *
 * The classification follows a 4-tier execution model:
 * - Tier 1: Native in-Worker via nodejs_compat_v2 (fastest, most limited)
 * - Tier 2: RPC bindings for external services (fast, specific tools)
 * - Tier 3: Worker loaders for dynamic npm modules (flexible, dynamic loading)
 * - Tier 4: Sandbox SDK for true Linux needs (slowest, full capability)
 *
 * @module bashx/do/classify/command-classifier
 */

import {
  canExecuteNativeNpm,
  extractNpmSubcommand,
} from '../commands/npm-native.js'

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
 * Contains the tier level, reason for selection, and handler information.
 */
export interface TierClassification {
  /** The tier that should handle this command */
  tier: ExecutionTier
  /** Reason for the tier selection */
  reason: string
  /** The handler that will execute the command */
  handler: 'native' | 'rpc' | 'loader' | 'sandbox' | 'polyglot'
  /** Specific capability or service that will be used */
  capability?: string
  /**
   * Sandbox strategy for non-bash languages routed to sandbox.
   * Contains resource limits, network/filesystem restrictions based on safety analysis.
   */
  sandboxStrategy?: SandboxStrategy
}

/**
 * Sandbox execution strategy with resource limits
 */
export interface SandboxStrategy {
  network?: 'none' | 'restricted' | 'full'
  filesystem?: 'none' | 'readonly' | 'full'
  timeout?: number
  memory?: number
}

/**
 * RPC service configuration
 */
export interface RpcServiceConfig {
  /** Supported commands */
  commands: string[]
  /** RPC endpoint URL */
  endpoint: string
}

/**
 * Worker loader configuration
 */
export interface WorkerLoaderConfig {
  /** Available modules */
  modules: string[]
  /** Load function */
  load: (module: string) => Promise<unknown>
}

/**
 * CommandClassifier configuration
 */
export interface ClassifierConfig {
  /** RPC service bindings (merged with defaults) */
  rpcBindings?: Record<string, RpcServiceConfig>
  /** Worker loader bindings */
  workerLoaders?: Record<string, WorkerLoaderConfig>
  /** Enable metrics tracking */
  metricsEnabled?: boolean
}

/**
 * Options for classify method
 */
export interface ClassifyOptions {
  /** Whether filesystem capability is available */
  hasFs?: boolean
}

/**
 * Classification metrics
 */
export interface ClassificationMetrics {
  totalClassifications: number
  cacheHits: number
  cacheMisses: number
  tierCounts: Record<ExecutionTier, number>
  handlerCounts: Record<string, number>
}

// ============================================================================
// TIER 1: NATIVE COMMANDS
// ============================================================================

/**
 * Commands that can be executed natively in-Worker via nodejs_compat_v2
 */
export const TIER_1_NATIVE_COMMANDS = new Set([
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
  // Binary utilities
  'dd', 'od',
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
export const TIER_1_FS_COMMANDS = new Set([
  // Read operations
  'cat', 'head', 'tail', 'ls', 'test', '[', 'stat', 'readlink', 'find', 'grep',
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
export const TIER_1_HTTP_COMMANDS = new Set(['curl', 'wget'])

/**
 * Data processing commands with native implementations
 */
export const TIER_1_DATA_COMMANDS = new Set(['jq', 'yq', 'base64', 'envsubst'])

/**
 * Crypto commands with native Web Crypto API implementations
 */
export const TIER_1_CRYPTO_COMMANDS = new Set([
  'sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum',
  'uuidgen', 'uuid', 'cksum', 'sum', 'openssl',
])

/**
 * Text processing commands with native implementations
 */
export const TIER_1_TEXT_PROCESSING_COMMANDS = new Set([
  'sed', 'awk', 'diff', 'patch', 'tee', 'xargs',
])

/**
 * POSIX utility commands with native implementations
 */
export const TIER_1_POSIX_UTILS_COMMANDS = new Set([
  'cut', 'sort', 'tr', 'uniq', 'wc',
  'basename', 'dirname', 'echo', 'printf',
  'date', 'dd', 'od',
])

/**
 * System utility commands with native implementations
 */
export const TIER_1_SYSTEM_UTILS_COMMANDS = new Set([
  'yes', 'whoami', 'hostname', 'printenv',
])

/**
 * Extended utility commands with native implementations
 */
export const TIER_1_EXTENDED_UTILS_COMMANDS = new Set([
  'env', 'id', 'uname', 'tac',
])

/**
 * npm commands that can be executed natively via npmx registry client
 */
export const TIER_1_NPM_NATIVE_COMMANDS = new Set([
  'npm',  // Will check subcommand to determine if native execution is possible
])

// ============================================================================
// TIER 2: RPC COMMANDS
// ============================================================================

/**
 * Default RPC services and their commands
 */
export const DEFAULT_RPC_SERVICES: Record<string, RpcServiceConfig> = {
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
export const TIER_3_LOADABLE_MODULES = new Set([
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
export const TIER_4_SANDBOX_COMMANDS = new Set([
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
  // System utilities
  'sudo', 'su', 'chgrp',
  // Process substitution, pipes, complex shell features
  'bash', 'sh', 'zsh',
])

// ============================================================================
// COMMAND CLASSIFIER
// ============================================================================

/**
 * CommandClassifier - Pure command classification module
 *
 * Analyzes bash commands and determines which execution tier should handle them.
 * This is a stateless module with optional caching and metrics.
 *
 * @example
 * ```typescript
 * const classifier = new CommandClassifier()
 *
 * // Classify a command
 * const result = classifier.classify('cat /file.txt', { hasFs: true })
 * // { tier: 1, handler: 'native', capability: 'fs', reason: '...' }
 *
 * // Classify npm command
 * const npmResult = classifier.classify('npm install lodash')
 * // { tier: 2, handler: 'rpc', capability: 'npm', reason: '...' }
 * ```
 */
export class CommandClassifier {
  private readonly rpcBindings: Record<string, RpcServiceConfig>
  private readonly workerLoaders: Record<string, WorkerLoaderConfig>
  private readonly metricsEnabled: boolean

  // Classification cache for O(1) repeated lookups
  private readonly classificationCache = new Map<string, TierClassification>()

  // Pre-computed RPC command set for O(1) lookup
  private readonly rpcCommandSet: Set<string>

  // Metrics
  private totalClassifications = 0
  private cacheHits = 0
  private cacheMisses = 0
  private tierCounts: Record<ExecutionTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  private handlerCounts: Record<string, number> = {}

  constructor(config: ClassifierConfig = {}) {
    // Merge custom RPC bindings with defaults
    this.rpcBindings = {
      ...DEFAULT_RPC_SERVICES,
      ...config.rpcBindings,
    }

    this.workerLoaders = config.workerLoaders || {}
    this.metricsEnabled = config.metricsEnabled ?? false

    // Pre-compute RPC command set for O(1) lookups
    this.rpcCommandSet = new Set<string>()
    for (const binding of Object.values(this.rpcBindings)) {
      for (const cmd of binding.commands) {
        this.rpcCommandSet.add(cmd)
      }
    }
  }

  /**
   * Classify a command to determine which tier should execute it.
   *
   * @param command - The command to classify
   * @param options - Classification options (e.g., hasFs)
   * @returns TierClassification with tier level, handler, and capability
   */
  classify(command: string, options: ClassifyOptions = {}): TierClassification {
    // Track metrics
    if (this.metricsEnabled) {
      this.totalClassifications++
    }

    const cmd = this.extractCommandName(command)

    // Fast path: Check cache
    const cacheKey = this.getCacheKey(cmd, command, options)
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
    const classification = this.classifyInternal(cmd, command, options)

    // Track metrics
    if (this.metricsEnabled) {
      this.tierCounts[classification.tier]++
      this.handlerCounts[classification.handler] = (this.handlerCounts[classification.handler] || 0) + 1
    }

    // Cache the result (unless it involves sandboxStrategy which is command-specific)
    if (!classification.sandboxStrategy) {
      this.classificationCache.set(cacheKey, classification)
    }

    return classification
  }

  /**
   * Clear the classification cache.
   */
  clearCache(): void {
    this.classificationCache.clear()
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number } {
    return { size: this.classificationCache.size }
  }

  /**
   * Get classification metrics.
   */
  getMetrics(): ClassificationMetrics {
    return {
      totalClassifications: this.totalClassifications,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      tierCounts: { ...this.tierCounts },
      handlerCounts: { ...this.handlerCounts },
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Generate cache key for a command.
   * Most commands only need the command name, but some depend on subcommands or options.
   *
   * @internal
   */
  private getCacheKey(cmd: string, fullCommand: string, options: ClassifyOptions): string {
    const optionsSuffix = options.hasFs ? ':fs' : ':nofs'

    // Commands that need full command for cache key (subcommand-dependent)
    if (cmd === 'npm' || cmd === 'python' || cmd === 'python3') {
      return fullCommand.trim() + optionsSuffix
    }

    // FS commands need the hasFs option in cache key
    if (TIER_1_FS_COMMANDS.has(cmd)) {
      return cmd + optionsSuffix
    }

    // Most commands can be cached by name alone
    return cmd
  }

  /**
   * Internal classification logic (without caching).
   *
   * @internal
   */
  private classifyInternal(cmd: string, command: string, options: ClassifyOptions): TierClassification {
    // ========================================================================
    // FAST PATH: Tier 1 Native Commands (most common)
    // ========================================================================
    if (TIER_1_NATIVE_COMMANDS.has(cmd)) {
      return this.classifyTier1Command(cmd, command, options)
    }

    // Check if npm command can be executed natively via npmx registry client
    if (TIER_1_NPM_NATIVE_COMMANDS.has(cmd)) {
      const args = this.extractArgs(command)
      if (canExecuteNativeNpm(args)) {
        const subcommand = extractNpmSubcommand(command)
        return {
          tier: 1,
          reason: `Native npm registry operation via npmx (${subcommand})`,
          handler: 'native',
          capability: 'npm-native',
        }
      }
      // Fall through to Tier 2 RPC for complex npm operations
    }

    // ========================================================================
    // Tier 2: RPC service commands
    // ========================================================================
    if (this.rpcCommandSet.has(cmd)) {
      // Find the specific service
      for (const [serviceName, binding] of Object.entries(this.rpcBindings)) {
        if (binding.commands.includes(cmd)) {
          return {
            tier: 2,
            reason: `RPC service available (${serviceName})`,
            handler: 'rpc',
            capability: serviceName,
          }
        }
      }
    }

    // ========================================================================
    // Tier 3: Worker loaders
    // ========================================================================
    const workerLoaderMatch = this.matchWorkerLoader(cmd)
    if (workerLoaderMatch) {
      return {
        tier: 3,
        reason: `Dynamic npm module available (${workerLoaderMatch})`,
        handler: 'loader',
        capability: workerLoaderMatch,
      }
    }

    // ========================================================================
    // Tier 4: Sandbox (fallback)
    // ========================================================================
    return {
      tier: 4,
      reason: TIER_4_SANDBOX_COMMANDS.has(cmd)
        ? `Requires Linux sandbox (${cmd})`
        : 'No higher tier available for this command',
      handler: 'sandbox',
      capability: 'container',
    }
  }

  /**
   * Classify a Tier 1 native command based on its capability type.
   *
   * @internal
   */
  private classifyTier1Command(cmd: string, _command: string, options: ClassifyOptions): TierClassification {
    // Filesystem commands - need to check if fs capability is available
    if (TIER_1_FS_COMMANDS.has(cmd)) {
      if (options.hasFs) {
        return {
          tier: 1,
          reason: `Native filesystem operation via FsCapability`,
          handler: 'native',
          capability: 'fs',
        }
      }
      // Fall through to sandbox if no fs capability
      return {
        tier: 4,
        reason: 'Filesystem command requires FsCapability (not available)',
        handler: 'sandbox',
        capability: 'container',
      }
    }

    // HTTP commands via native fetch API
    if (TIER_1_HTTP_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native HTTP operation via fetch API (${cmd})`,
        handler: 'native',
        capability: 'http',
      }
    }

    // Data processing commands (jq, yq, base64, envsubst)
    if (TIER_1_DATA_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native data processing command (${cmd})`,
        handler: 'native',
        capability: cmd, // Use command name as capability
      }
    }

    // Crypto commands via Web Crypto API
    if (TIER_1_CRYPTO_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native crypto command via Web Crypto API (${cmd})`,
        handler: 'native',
        capability: 'crypto',
      }
    }

    // Text processing commands (sed, awk, diff, patch, tee, xargs)
    if (TIER_1_TEXT_PROCESSING_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native text processing command (${cmd})`,
        handler: 'native',
        capability: 'text',
      }
    }

    // POSIX utility commands
    if (TIER_1_POSIX_UTILS_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native POSIX utility command (${cmd})`,
        handler: 'native',
        capability: 'posix',
      }
    }

    // System utility commands
    if (TIER_1_SYSTEM_UTILS_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native system utility command (${cmd})`,
        handler: 'native',
        capability: 'system',
      }
    }

    // Extended utility commands
    if (TIER_1_EXTENDED_UTILS_COMMANDS.has(cmd)) {
      return {
        tier: 1,
        reason: `Native extended utility command (${cmd})`,
        handler: 'native',
        capability: 'extended',
      }
    }

    // Pure computation commands (default for Tier 1)
    return {
      tier: 1,
      reason: `Pure computation command (${cmd})`,
      handler: 'native',
      capability: 'compute',
    }
  }

  /**
   * Match command against worker loaders.
   *
   * @internal
   */
  private matchWorkerLoader(cmd: string): string | null {
    // Check if we have a loader for this command
    for (const [name, loader] of Object.entries(this.workerLoaders)) {
      if (loader.modules.includes(cmd)) {
        return name
      }
    }

    // Check if it's a known loadable module
    if (TIER_3_LOADABLE_MODULES.has(cmd)) {
      return cmd
    }

    return null
  }

  /**
   * Extract command name from a full command string.
   *
   * @internal
   */
  private extractCommandName(command: string): string {
    const trimmed = command.trim()
    // Handle env vars prefix: VAR=value cmd
    const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '')

    // Special case: [ command (test alias)
    if (withoutEnvVars.startsWith('[')) {
      return '['
    }

    // Get first word (supports alphanumeric, dash, dot, slash)
    const match = withoutEnvVars.match(/^[\w\-\.\/]+/)
    if (!match) return ''
    // Handle path: /usr/bin/cmd -> cmd
    const name = match[0].split('/').pop() || ''
    return name
  }

  /**
   * Extract arguments from a full command string.
   *
   * @internal
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
   * Tokenize command respecting quotes and escape sequences.
   *
   * @internal
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      // Handle escape sequences
      if (char === '\\' && i + 1 < input.length && !inSingleQuote) {
        current += input[i + 1]
        i++
        continue
      }

      // Handle quotes
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        continue
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        continue
      }

      // Handle whitespace
      if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
        if (current) {
          tokens.push(current)
          current = ''
        }
        continue
      }

      current += char
    }

    if (current) {
      tokens.push(current)
    }

    return tokens
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default CommandClassifier
