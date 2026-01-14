/**
 * CommandRegistry - Centralized command metadata management
 *
 * Provides a registry pattern for command classification in the tiered execution model.
 * Commands are registered with tier, handler, and capabilities information.
 *
 * @packageDocumentation
 */

import type { ExecutionTier, TierClassification } from '../tiered-executor.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Capability types for command execution.
 * These describe what resources or APIs a command needs.
 */
export type CommandCapability =
  | 'fs'        // Filesystem access
  | 'http'      // HTTP/fetch API
  | 'compute'   // Pure computation
  | 'crypto'    // Web Crypto API
  | 'text'      // Text processing
  | 'posix'     // POSIX utilities
  | 'system'    // System utilities
  | 'extended'  // Extended utilities
  | 'npm-native' // Native npm registry client
  | 'container' // Container/sandbox execution
  | string      // Allow custom capabilities

/**
 * Handler types for command execution.
 */
export type CommandHandler = 'native' | 'rpc' | 'loader' | 'sandbox' | 'polyglot'

/**
 * Metadata for a registered command.
 */
export interface CommandMetadata {
  /** The tier that should handle this command */
  tier: ExecutionTier
  /** The handler that will execute the command */
  handler: CommandHandler
  /** Primary capability required (singular form) */
  capability?: CommandCapability
  /** Multiple capabilities required (plural form) */
  capabilities?: CommandCapability[]
  /** Human-readable reason for the tier selection */
  reason?: string
}

/**
 * Internal normalized metadata (always has capabilities array).
 */
interface NormalizedMetadata extends Omit<CommandMetadata, 'capability'> {
  capabilities: CommandCapability[]
  reason: string
}

// ============================================================================
// COMMAND REGISTRY CLASS
// ============================================================================

/**
 * CommandRegistry provides centralized command metadata management.
 *
 * Instead of scattered command sets and classification logic, the registry
 * offers a single source of truth for command -> tier/handler mapping.
 *
 * @example
 * ```ts
 * const registry = new CommandRegistry()
 *
 * // Register individual commands
 * registry.register('cat', { tier: 1, handler: 'native', capability: 'fs' })
 *
 * // Register multiple commands with same metadata
 * registry.registerAll(['head', 'tail', 'ls'], {
 *   tier: 1,
 *   handler: 'native',
 *   capability: 'fs',
 * })
 *
 * // Classify a command
 * const classification = registry.classify('cat')
 * // { tier: 1, handler: 'native', capability: 'fs', reason: '...' }
 *
 * // Get handler for a command
 * const handler = registry.getHandler('cat') // 'native'
 * ```
 */
export class CommandRegistry {
  private registry: Map<string, NormalizedMetadata> = new Map()

  /**
   * Register a command with its metadata.
   *
   * @param command - The command name to register
   * @param metadata - The metadata describing how to handle the command
   * @returns The registry instance for method chaining
   */
  register(command: string, metadata: CommandMetadata): this {
    const normalized = this.normalizeMetadata(metadata)
    this.registry.set(command, normalized)
    return this
  }

  /**
   * Register multiple commands with the same metadata.
   *
   * @param commandList - Array of command names to register
   * @param metadata - The metadata to apply to all commands
   * @returns The registry instance for method chaining
   */
  registerAll(commandList: string[], metadata: CommandMetadata): this {
    const normalized = this.normalizeMetadata(metadata)
    for (const command of commandList) {
      this.registry.set(command, normalized)
    }
    return this
  }

  /**
   * Get tier classification for a command.
   *
   * @param command - The command name to classify
   * @returns TierClassification if registered, undefined otherwise
   */
  classify(command: string): TierClassification | undefined {
    const metadata = this.registry.get(command)
    if (!metadata) {
      return undefined
    }

    return {
      tier: metadata.tier,
      handler: metadata.handler,
      capability: metadata.capabilities[0], // Use first capability as primary
      reason: metadata.reason,
    }
  }

  /**
   * Get the handler name for a command.
   *
   * @param command - The command name to look up
   * @returns The handler name if registered, undefined otherwise
   */
  getHandler(command: string): CommandHandler | undefined {
    return this.registry.get(command)?.handler
  }

  /**
   * Check if a command is registered.
   *
   * @param command - The command name to check
   * @returns true if the command is registered
   */
  has(command: string): boolean {
    return this.registry.has(command)
  }

  /**
   * Get metadata for a registered command.
   *
   * @param command - The command name to look up
   * @returns The command metadata if registered, undefined otherwise
   */
  get(command: string): CommandMetadata | undefined {
    const metadata = this.registry.get(command)
    if (!metadata) {
      return undefined
    }

    // Return denormalized form for external use
    return {
      tier: metadata.tier,
      handler: metadata.handler,
      capability: metadata.capabilities[0],
      capabilities: metadata.capabilities,
      reason: metadata.reason,
    }
  }

  /**
   * Get all commands registered for a specific tier.
   *
   * @param tier - The execution tier to filter by
   * @returns Array of command names in that tier
   */
  getCommandsByTier(tier: ExecutionTier): string[] {
    const result: string[] = []
    for (const [command, metadata] of this.registry) {
      if (metadata.tier === tier) {
        result.push(command)
      }
    }
    return result
  }

  /**
   * Get all commands with a specific capability.
   *
   * @param capability - The capability to filter by
   * @returns Array of command names with that capability
   */
  getCommandsByCapability(capability: CommandCapability): string[] {
    const result: string[] = []
    for (const [command, metadata] of this.registry) {
      if (metadata.capabilities.includes(capability)) {
        result.push(command)
      }
    }
    return result
  }

  /**
   * Get the number of registered commands.
   */
  get size(): number {
    return this.registry.size
  }

  /**
   * Clear all registered commands.
   */
  clear(): void {
    this.registry.clear()
  }

  /**
   * Get all registered command names.
   *
   * @returns Array of all registered command names
   */
  commands(): string[] {
    return Array.from(this.registry.keys())
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Normalize metadata to internal format.
   */
  private normalizeMetadata(metadata: CommandMetadata): NormalizedMetadata {
    // Build capabilities array from either capability or capabilities
    let capabilities: CommandCapability[]
    if (metadata.capabilities && metadata.capabilities.length > 0) {
      capabilities = metadata.capabilities
    } else if (metadata.capability) {
      capabilities = [metadata.capability]
    } else {
      capabilities = []
    }

    // Generate default reason if not provided
    const reason = metadata.reason || this.generateDefaultReason(metadata, capabilities)

    return {
      tier: metadata.tier,
      handler: metadata.handler,
      capabilities,
      reason,
    }
  }

  /**
   * Generate a default reason string based on metadata.
   */
  private generateDefaultReason(metadata: CommandMetadata, capabilities: CommandCapability[]): string {
    const capability = capabilities[0] || 'unknown'

    switch (capability) {
      case 'fs':
        return 'Native filesystem operation via FsCapability'
      case 'http':
        return 'Native HTTP operation via fetch API'
      case 'compute':
        return 'Pure computation command'
      case 'crypto':
        return 'Native crypto command via Web Crypto API'
      case 'text':
        return 'Native text processing command'
      case 'posix':
        return 'Native POSIX utility command'
      case 'system':
        return 'Native system utility command'
      case 'extended':
        return 'Native extended utility command'
      case 'npm-native':
        return 'Native npm registry operation via npmx'
      case 'container':
        return 'Requires Linux sandbox'
      default:
        return `Tier ${metadata.tier} ${metadata.handler} handler`
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a CommandRegistry pre-populated with default Tier 1 commands.
 *
 * This provides all native commands that can be executed in Tier 1
 * (Cloudflare Workers) without external dependencies.
 *
 * @example
 * ```ts
 * const registry = createDefaultRegistry()
 * const classification = registry.classify('cat')
 * // { tier: 1, handler: 'native', capability: 'fs', reason: '...' }
 * ```
 */
export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry()

  // Filesystem commands
  registry.registerAll(
    [
      // Read operations
      'cat', 'head', 'tail', 'ls', 'test', '[', 'stat', 'readlink', 'find', 'grep',
      // Write operations
      'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'truncate', 'ln',
      // Permission operations
      'chmod', 'chown',
      // Compression commands (need filesystem access)
      'gzip', 'gunzip', 'zcat', 'tar', 'zip', 'unzip',
    ],
    { tier: 1, handler: 'native', capability: 'fs' }
  )

  // HTTP commands (via fetch API)
  registry.registerAll(
    ['curl', 'wget'],
    { tier: 1, handler: 'native', capability: 'http' }
  )

  // Data processing commands
  registry.registerAll(
    ['jq', 'yq', 'base64', 'envsubst'],
    { tier: 1, handler: 'native', capability: 'text', reason: 'Native data processing' }
  )

  // Crypto commands (via Web Crypto API)
  registry.registerAll(
    [
      'sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum',
      'uuidgen', 'uuid', 'cksum', 'sum', 'openssl',
    ],
    { tier: 1, handler: 'native', capability: 'crypto' }
  )

  // Text processing commands
  registry.registerAll(
    ['sed', 'awk', 'diff', 'patch', 'tee', 'xargs'],
    { tier: 1, handler: 'native', capability: 'text' }
  )

  // POSIX utility commands
  registry.registerAll(
    [
      'cut', 'sort', 'tr', 'uniq', 'wc',
      'basename', 'dirname', 'echo', 'printf',
      'date', 'dd', 'od', 'rev',
    ],
    { tier: 1, handler: 'native', capability: 'posix' }
  )

  // System utility commands
  registry.registerAll(
    ['yes', 'whoami', 'hostname', 'printenv', 'pwd'],
    { tier: 1, handler: 'native', capability: 'system' }
  )

  // Extended utility commands
  registry.registerAll(
    ['env', 'id', 'uname', 'tac'],
    { tier: 1, handler: 'native', capability: 'extended' }
  )

  // Math & control commands (pure computation)
  registry.registerAll(
    ['bc', 'expr', 'seq', 'shuf', 'sleep', 'timeout', 'true', 'false'],
    { tier: 1, handler: 'native', capability: 'compute' }
  )

  // npm native commands (read-only registry operations)
  registry.register('npm', {
    tier: 1,
    handler: 'native',
    capability: 'npm-native',
    reason: 'Native npm registry client for read-only operations',
  })

  return registry
}
