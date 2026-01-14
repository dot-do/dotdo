/**
 * Claude Code Sandbox Approach
 *
 * This module implements sandboxing based on Claude Code's architecture:
 * - OS-level isolation via Seatbelt (macOS) and Bubblewrap (Linux)
 * - Network filtering via HTTP/SOCKS5 proxies
 * - Filesystem restrictions with allow/deny lists
 *
 * @see https://www.anthropic.com/engineering/claude-code-sandboxing
 * @see https://github.com/anthropic-experimental/sandbox-runtime
 * @see https://code.claude.com/docs/en/sandboxing
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface NetworkConfig {
  /** Domains to allow network access to (supports wildcards like *.github.com) */
  allowedDomains: string[]
  /** Domains to explicitly deny (takes precedence over allowed) */
  deniedDomains?: string[]
  /** Unix socket paths to allow (e.g., /var/run/docker.sock) */
  allowUnixSockets?: string[]
  /** Allow binding to localhost ports for local servers */
  allowLocalBinding?: boolean
}

export interface FilesystemConfig {
  /** Paths to deny read access to */
  denyRead: string[]
  /** Paths to allow write access to (sandbox defaults to deny-all writes) */
  allowWrite: string[]
  /** Paths to explicitly deny writes (exceptions to allowWrite) */
  denyWrite?: string[]
}

export interface IgnoreViolationsConfig {
  /** Global paths to ignore violations for */
  '*'?: string[]
  /** Command-specific ignore patterns */
  [command: string]: string[] | undefined
}

export interface SandboxRuntimeConfig {
  network: NetworkConfig
  filesystem: FilesystemConfig
  /** Patterns of violations to ignore (for system noise) */
  ignoreViolations?: IgnoreViolationsConfig
  /** Enable weaker nested sandbox (reduces security) */
  enableWeakerNestedSandbox?: boolean
  /** How deep to search for mandatory deny paths */
  mandatoryDenySearchDepth?: number
}

export interface SandboxViolation {
  type: 'file' | 'network'
  operation: string
  path?: string
  domain?: string
  timestamp: Date
  command?: string
}

// ============================================================================
// Auto-Protected Paths (Always Blocked from Writes)
// ============================================================================

/**
 * Paths that are always protected from writes, even if in allowWrite.
 * These protect shell configs, git hooks, and tool configurations
 * that could be used for privilege escalation.
 */
export const AUTO_PROTECTED_PATHS = [
  // Shell configs
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',

  // Git configs (prevent hook injection)
  '.gitconfig',
  '.gitmodules',
  '.git/hooks/',
  '.git/config',

  // IDE settings
  '.vscode/',
  '.idea/',

  // Claude configs
  '.claude/commands/',
  '.claude/agents/',

  // Tool configs
  '.ripgreprc',
  '.mcp.json',
] as const

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default network configuration for development use
 */
export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  allowedDomains: [
    // Package registries
    'npmjs.org',
    '*.npmjs.org',
    'registry.npmjs.org',
    'yarnpkg.com',
    '*.yarnpkg.com',
    'pypi.org',
    '*.pypi.org',

    // Version control
    'github.com',
    '*.github.com',
    'api.github.com',
    'gitlab.com',
    '*.gitlab.com',
    'bitbucket.org',
    '*.bitbucket.org',

    // Cloud providers (APIs)
    'api.cloudflare.com',
    'api.anthropic.com',
    'api.openai.com',
  ],
  deniedDomains: [],
  allowLocalBinding: true,
}

/**
 * Default filesystem configuration for development use
 */
export const DEFAULT_FILESYSTEM_CONFIG: FilesystemConfig = {
  denyRead: [
    '~/.ssh',
    '~/.aws',
    '~/.gnupg',
    '~/.config/gcloud',
    '~/.azure',
  ],
  allowWrite: [
    '.',
    'src/',
    'lib/',
    'test/',
    'tests/',
    '/tmp',
  ],
  denyWrite: [
    '.env',
    '.env.local',
    '.env.production',
    'secrets/',
    '*.pem',
    '*.key',
  ],
}

/**
 * Strict configuration for untrusted code execution
 */
export const STRICT_CONFIG: SandboxRuntimeConfig = {
  network: {
    allowedDomains: [], // No network access
    deniedDomains: ['*'],
    allowLocalBinding: false,
  },
  filesystem: {
    denyRead: ['~/', '/etc', '/var'],
    allowWrite: ['/tmp'],
    denyWrite: ['*'],
  },
}

// ============================================================================
// Sandbox Manager (Simulated for Cloudflare Workers)
// ============================================================================

/**
 * In Cloudflare Workers, we don't have OS-level sandboxing via Seatbelt/Bubblewrap.
 * Instead, we rely on V8 isolate security and the Cloudflare Sandbox SDK.
 *
 * This class provides a compatible interface for configuration that can be
 * used to configure the Cloudflare sandbox appropriately.
 */
export class ClaudeSandboxConfig {
  private config: SandboxRuntimeConfig
  private violations: SandboxViolation[] = []

  constructor(config?: Partial<SandboxRuntimeConfig>) {
    this.config = {
      network: config?.network ?? DEFAULT_NETWORK_CONFIG,
      filesystem: config?.filesystem ?? DEFAULT_FILESYSTEM_CONFIG,
      ignoreViolations: config?.ignoreViolations ?? {},
      enableWeakerNestedSandbox: config?.enableWeakerNestedSandbox ?? false,
      mandatoryDenySearchDepth: config?.mandatoryDenySearchDepth ?? 3,
    }
  }

  // --------------------------------------------------------------------------
  // Domain Validation
  // --------------------------------------------------------------------------

  /**
   * Check if a domain is allowed for network access
   */
  isDomainAllowed(domain: string): boolean {
    // Check denied first (takes precedence)
    if (this.matchesDomainPattern(domain, this.config.network.deniedDomains ?? [])) {
      return false
    }

    // Check allowed
    return this.matchesDomainPattern(domain, this.config.network.allowedDomains)
  }

  private matchesDomainPattern(domain: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern === '*') return true
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1) // Remove *
        return domain.endsWith(suffix) || domain === pattern.slice(2)
      }
      return domain === pattern
    })
  }

  // --------------------------------------------------------------------------
  // Path Validation
  // --------------------------------------------------------------------------

  /**
   * Check if a path can be read
   */
  canReadPath(path: string): boolean {
    const normalizedPath = this.normalizePath(path)
    return !this.matchesPathPattern(normalizedPath, this.config.filesystem.denyRead)
  }

  /**
   * Check if a path can be written to
   */
  canWritePath(path: string): boolean {
    const normalizedPath = this.normalizePath(path)

    // Check auto-protected paths first
    if (AUTO_PROTECTED_PATHS.some((p) => normalizedPath.includes(p))) {
      return false
    }

    // Check explicit deny
    if (this.matchesPathPattern(normalizedPath, this.config.filesystem.denyWrite ?? [])) {
      return false
    }

    // Check allow list
    return this.matchesPathPattern(normalizedPath, this.config.filesystem.allowWrite)
  }

  private normalizePath(path: string): string {
    // Expand ~ to represent home directory intent
    return path.replace(/^~/, '/home/user')
  }

  private matchesPathPattern(path: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern === '*') return true
      if (pattern.endsWith('/')) {
        return path.startsWith(pattern) || path.startsWith(pattern.slice(0, -1))
      }
      if (pattern.startsWith('*.')) {
        return path.endsWith(pattern.slice(1))
      }
      if (pattern === '.') {
        // Current directory - allow anything in cwd
        return !path.startsWith('/') || path.startsWith('/workspace')
      }
      return path === pattern || path.startsWith(pattern + '/')
    })
  }

  // --------------------------------------------------------------------------
  // Violation Tracking
  // --------------------------------------------------------------------------

  /**
   * Record a sandbox violation
   */
  recordViolation(violation: Omit<SandboxViolation, 'timestamp'>): void {
    // Check if this violation should be ignored
    if (this.shouldIgnoreViolation(violation)) {
      return
    }

    this.violations.push({
      ...violation,
      timestamp: new Date(),
    })
  }

  private shouldIgnoreViolation(
    violation: Omit<SandboxViolation, 'timestamp'>
  ): boolean {
    const ignoreConfig = this.config.ignoreViolations ?? {}
    const path = violation.path ?? violation.domain ?? ''

    // Check global ignores
    const globalIgnores = ignoreConfig['*'] ?? []
    if (globalIgnores.some((pattern) => path.startsWith(pattern))) {
      return true
    }

    // Check command-specific ignores
    if (violation.command) {
      const commandIgnores = ignoreConfig[violation.command] ?? []
      if (commandIgnores.some((pattern) => path.startsWith(pattern))) {
        return true
      }
    }

    return false
  }

  /**
   * Get all recorded violations
   */
  getViolations(): SandboxViolation[] {
    return [...this.violations]
  }

  /**
   * Clear recorded violations
   */
  clearViolations(): void {
    this.violations = []
  }

  // --------------------------------------------------------------------------
  // Configuration Access
  // --------------------------------------------------------------------------

  /**
   * Get the current configuration
   */
  getConfig(): SandboxRuntimeConfig {
    return { ...this.config }
  }

  /**
   * Update network configuration
   */
  updateNetworkConfig(config: Partial<NetworkConfig>): void {
    this.config.network = { ...this.config.network, ...config }
  }

  /**
   * Update filesystem configuration
   */
  updateFilesystemConfig(config: Partial<FilesystemConfig>): void {
    this.config.filesystem = { ...this.config.filesystem, ...config }
  }

  /**
   * Add allowed domains
   */
  allowDomains(...domains: string[]): void {
    this.config.network.allowedDomains.push(...domains)
  }

  /**
   * Add denied domains
   */
  denyDomains(...domains: string[]): void {
    this.config.network.deniedDomains = [
      ...(this.config.network.deniedDomains ?? []),
      ...domains,
    ]
  }

  /**
   * Add writable paths
   */
  allowWritePaths(...paths: string[]): void {
    this.config.filesystem.allowWrite.push(...paths)
  }

  /**
   * Add read-denied paths
   */
  denyReadPaths(...paths: string[]): void {
    this.config.filesystem.denyRead.push(...paths)
  }
}

// ============================================================================
// Command Wrapper (Conceptual - for reference)
// ============================================================================

/**
 * Wrap a command for sandboxed execution.
 *
 * In Claude Code's actual implementation, this generates:
 * - macOS: sandbox-exec with a Seatbelt profile
 * - Linux: bwrap (bubblewrap) with namespace isolation
 *
 * For Cloudflare Workers, we use the Cloudflare Sandbox SDK instead,
 * but this type shows the conceptual interface.
 */
export interface CommandWrapper {
  /**
   * Original command to execute
   */
  command: string

  /**
   * Wrapped command with sandbox restrictions
   */
  wrappedCommand: string

  /**
   * Environment variables to set (proxy configuration)
   */
  env: Record<string, string>
}

/**
 * Generate environment variables for proxy-based network isolation
 * (Conceptual - shows what Claude Code does on macOS/Linux)
 */
export function getProxyEnv(httpProxyPort: number, socksProxyPort: number): Record<string, string> {
  return {
    HTTP_PROXY: `http://localhost:${httpProxyPort}`,
    HTTPS_PROXY: `http://localhost:${httpProxyPort}`,
    ALL_PROXY: `socks5://localhost:${socksProxyPort}`,
    NO_PROXY: 'localhost,127.0.0.1',
  }
}

// ============================================================================
// Settings File Format (for reference)
// ============================================================================

/**
 * Format of ~/.srt-settings.json (Claude Code sandbox settings)
 */
export interface SandboxSettingsFile {
  network: {
    allowedDomains: string[]
    deniedDomains?: string[]
    allowUnixSockets?: string[]
    allowLocalBinding?: boolean
  }
  filesystem: {
    denyRead: string[]
    allowWrite: string[]
    denyWrite?: string[]
  }
  ignoreViolations?: {
    '*'?: string[]
    [command: string]: string[] | undefined
  }
  enableWeakerNestedSandbox?: boolean
  mandatoryDenySearchDepth?: number
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a sandbox configuration for development use
 */
export function createDevConfig(
  additionalDomains?: string[],
  additionalWritePaths?: string[]
): ClaudeSandboxConfig {
  const config = new ClaudeSandboxConfig()

  if (additionalDomains) {
    config.allowDomains(...additionalDomains)
  }

  if (additionalWritePaths) {
    config.allowWritePaths(...additionalWritePaths)
  }

  return config
}

/**
 * Create a strict sandbox configuration for untrusted code
 */
export function createStrictConfig(): ClaudeSandboxConfig {
  return new ClaudeSandboxConfig(STRICT_CONFIG)
}

/**
 * Create a sandbox configuration from a settings object
 */
export function createConfigFromSettings(
  settings: SandboxSettingsFile
): ClaudeSandboxConfig {
  return new ClaudeSandboxConfig({
    network: settings.network,
    filesystem: settings.filesystem,
    ignoreViolations: settings.ignoreViolations,
    enableWeakerNestedSandbox: settings.enableWeakerNestedSandbox,
    mandatoryDenySearchDepth: settings.mandatoryDenySearchDepth,
  })
}

// ============================================================================
// Export Default Config
// ============================================================================

export const defaultConfig = new ClaudeSandboxConfig()
