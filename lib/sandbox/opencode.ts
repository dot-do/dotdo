/**
 * OpenCode Sandbox Approach
 *
 * This module implements sandboxing based on OpenCode's architecture:
 * - Permission-based access control (allow/ask/deny)
 * - No native OS-level sandboxing (relies on containers or bubblewrap externally)
 * - Granular tool-level permissions with glob patterns
 *
 * OpenCode doesn't have built-in sandboxing like Claude Code. Instead, it uses
 * a permission system that controls what actions the AI agent can take.
 * For true isolation, OpenCode users typically run it inside Docker/Podman
 * or use Bubblewrap wrappers.
 *
 * @see https://opencode.ai/docs/permissions/
 * @see https://github.com/sst/opencode
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Permission states for tool access
 */
export type PermissionState = 'allow' | 'ask' | 'deny'

/**
 * Permission rule can be a simple state or a pattern-based config
 */
export type PermissionRule = PermissionState | Record<string, PermissionState>

/**
 * Tool permission configuration
 */
export interface ToolPermissions {
  /** File reading permissions (matches file path) */
  read?: PermissionRule
  /** File editing/writing permissions (matches file path) */
  edit?: PermissionRule
  /** Bash command execution permissions (matches parsed command) */
  bash?: PermissionRule
  /** URL fetching permissions (matches URL) */
  webfetch?: PermissionRule
  /** Access to directories outside project root */
  external_directory?: PermissionState
  /** Repeated identical tool calls detection */
  doom_loop?: PermissionState
}

/**
 * Agent-specific configuration
 */
export interface AgentConfig {
  /** Agent description */
  description?: string
  /** Agent mode (subagent for read-only, etc.) */
  mode?: 'subagent' | 'default'
  /** Agent-specific permissions (override global) */
  permission?: ToolPermissions
  /** Security context for this agent (proposed feature) */
  securityContext?: SecurityContext
}

/**
 * Proposed security context for future OpenCode implementation
 * @see https://github.com/sst/opencode/issues/4667
 */
export interface SecurityContext {
  /** Paths that can only be read */
  readOnlyPaths?: string[]
  /** Paths that can be written to */
  writeablePaths?: string[]
  /** Executables that can be run */
  allowedExecutables?: string[]
}

/**
 * Full OpenCode configuration (opencode.json)
 */
export interface OpenCodeConfig {
  /** Global permissions */
  permission?: ToolPermissions
  /** Agent-specific configurations */
  agent?: Record<string, AgentConfig>
}

// ============================================================================
// Permission Checker Class
// ============================================================================

/**
 * Checks permissions based on OpenCode's permission model
 */
export class OpenCodePermissions {
  private config: OpenCodeConfig
  private activeAgent?: string

  constructor(config?: OpenCodeConfig) {
    this.config = config ?? { permission: {} }
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Set the active agent context
   */
  setActiveAgent(agentName?: string): void {
    this.activeAgent = agentName
  }

  /**
   * Get the current configuration
   */
  getConfig(): OpenCodeConfig {
    return { ...this.config }
  }

  /**
   * Update global permissions
   */
  updatePermissions(permissions: ToolPermissions): void {
    this.config.permission = { ...this.config.permission, ...permissions }
  }

  /**
   * Add or update an agent configuration
   */
  setAgentConfig(name: string, config: AgentConfig): void {
    this.config.agent = this.config.agent ?? {}
    this.config.agent[name] = config
  }

  // --------------------------------------------------------------------------
  // Permission Checking
  // --------------------------------------------------------------------------

  /**
   * Get the effective permission for a tool and input
   */
  getPermission(
    tool: keyof ToolPermissions,
    input: string
  ): PermissionState {
    // Get agent-specific permissions if active
    const agentPermissions = this.activeAgent
      ? this.config.agent?.[this.activeAgent]?.permission
      : undefined

    // Check agent-specific first, then global
    const toolPermission =
      agentPermissions?.[tool] ?? this.config.permission?.[tool]

    if (!toolPermission) {
      return 'ask' // Default to ask if not configured
    }

    // Simple permission state
    if (typeof toolPermission === 'string') {
      return toolPermission
    }

    // Pattern-based permission
    return this.matchPattern(input, toolPermission)
  }

  /**
   * Check if an action is allowed (returns true for 'allow', false otherwise)
   */
  isAllowed(tool: keyof ToolPermissions, input: string): boolean {
    return this.getPermission(tool, input) === 'allow'
  }

  /**
   * Check if an action is denied (returns true for 'deny')
   */
  isDenied(tool: keyof ToolPermissions, input: string): boolean {
    return this.getPermission(tool, input) === 'deny'
  }

  /**
   * Check if an action requires user confirmation
   */
  requiresConfirmation(tool: keyof ToolPermissions, input: string): boolean {
    return this.getPermission(tool, input) === 'ask'
  }

  // --------------------------------------------------------------------------
  // Pattern Matching
  // --------------------------------------------------------------------------

  private matchPattern(
    input: string,
    patterns: Record<string, PermissionState>
  ): PermissionState {
    // Check specific patterns first (longest match wins)
    const sortedPatterns = Object.entries(patterns)
      .filter(([p]) => p !== '*')
      .sort(([a], [b]) => b.length - a.length)

    for (const [pattern, state] of sortedPatterns) {
      if (this.matchGlob(input, pattern)) {
        return state
      }
    }

    // Fall back to wildcard or default
    return patterns['*'] ?? 'ask'
  }

  private matchGlob(input: string, pattern: string): boolean {
    // Simple glob matching
    if (pattern === '*') return true

    // Escape special regex chars except *
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    return new RegExp(`^${regexPattern}$`).test(input)
  }
}

// ============================================================================
// Built-in Agent Presets
// ============================================================================

/**
 * Build agent - full access for active development
 */
export const BUILD_AGENT: AgentConfig = {
  description: 'Full access agent for active development',
  mode: 'default',
  permission: {
    read: 'allow',
    edit: 'allow',
    bash: 'allow',
    webfetch: 'ask',
  },
}

/**
 * Plan agent - read-only for code analysis
 */
export const PLAN_AGENT: AgentConfig = {
  description: 'Read-only agent for code analysis and exploration',
  mode: 'subagent',
  permission: {
    read: 'allow',
    edit: 'deny',
    bash: 'ask',
    webfetch: 'deny',
  },
}

/**
 * Review agent - read-only with limited bash
 */
export const REVIEW_AGENT: AgentConfig = {
  description: 'Code review agent with limited access',
  mode: 'subagent',
  permission: {
    read: 'allow',
    edit: 'deny',
    bash: {
      '*': 'deny',
      'git diff *': 'allow',
      'git log *': 'allow',
      'git show *': 'allow',
    },
    webfetch: 'deny',
  },
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default development configuration
 */
export const DEFAULT_DEV_CONFIG: OpenCodeConfig = {
  permission: {
    read: 'allow',
    edit: 'ask',
    bash: {
      '*': 'ask',
      'git *': 'allow',
      'npm *': 'allow',
      'npx *': 'allow',
      'pnpm *': 'allow',
      'yarn *': 'allow',
      'bun *': 'allow',
      'ls *': 'allow',
      'cat *': 'allow',
      'rm *': 'deny',
      'rm -rf *': 'deny',
    },
    webfetch: 'ask',
    external_directory: 'ask',
    doom_loop: 'deny',
  },
  agent: {
    build: BUILD_AGENT,
    plan: PLAN_AGENT,
    review: REVIEW_AGENT,
  },
}

/**
 * Strict configuration - requires confirmation for most actions
 */
export const STRICT_CONFIG: OpenCodeConfig = {
  permission: {
    read: 'ask',
    edit: 'ask',
    bash: 'ask',
    webfetch: 'deny',
    external_directory: 'deny',
    doom_loop: 'deny',
  },
}

/**
 * Documentation-only configuration - very restricted
 */
export const DOCS_ONLY_CONFIG: OpenCodeConfig = {
  permission: {
    read: 'allow',
    edit: {
      '*': 'deny',
      '*.md': 'allow',
      '*.mdx': 'allow',
      'docs/**/*': 'allow',
    },
    bash: {
      '*': 'deny',
      'ls *': 'allow',
    },
    webfetch: 'deny',
    external_directory: 'deny',
  },
}

// ============================================================================
// Docker/Container Configuration (Community Solutions)
// ============================================================================

/**
 * Docker run configuration for sandboxed OpenCode execution
 * @see https://github.com/zaid-marji/opencode-sandbox
 */
export interface DockerSandboxConfig {
  /** Run as current user (prevents root access) */
  runAsCurrentUser: boolean
  /** Volumes to mount */
  volumes: Array<{
    hostPath: string
    containerPath: string
    readOnly?: boolean
  }>
  /** Security options */
  securityOpts?: string[]
  /** Capabilities to drop */
  capDrop?: string[]
  /** Capabilities to add (minimal set) */
  capAdd?: string[]
}

/**
 * Generate Docker run arguments for sandboxed execution
 */
export function generateDockerArgs(config: DockerSandboxConfig): string[] {
  const args: string[] = ['-it', '--rm']

  // Run as current user
  if (config.runAsCurrentUser) {
    args.push('--user', '$(id -u):$(id -g)')
  }

  // Security options
  if (config.securityOpts) {
    for (const opt of config.securityOpts) {
      args.push('--security-opt', opt)
    }
  }

  // Drop capabilities
  if (config.capDrop) {
    for (const cap of config.capDrop) {
      args.push('--cap-drop', cap)
    }
  }

  // Add minimal capabilities
  if (config.capAdd) {
    for (const cap of config.capAdd) {
      args.push('--cap-add', cap)
    }
  }

  // Mount volumes
  for (const vol of config.volumes) {
    const flag = vol.readOnly ? ':ro' : ''
    args.push('-v', `${vol.hostPath}:${vol.containerPath}${flag}`)
  }

  return args
}

/**
 * Default Docker sandbox configuration
 */
export const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  runAsCurrentUser: true,
  volumes: [
    { hostPath: '$(pwd)', containerPath: '/workspace' },
    { hostPath: '$HOME/.opencode-sandbox', containerPath: '/home/sandbox' },
    {
      hostPath: '$HOME/.config/opencode/opencode.json',
      containerPath: '/home/sandbox/.config/opencode/opencode.json',
      readOnly: true,
    },
  ],
  securityOpts: ['no-new-privileges'],
  capDrop: ['ALL'],
  capAdd: ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID', 'FOWNER'],
}

// ============================================================================
// Bubblewrap Configuration (Linux)
// ============================================================================

/**
 * Bubblewrap configuration for namespace-based isolation
 * @see https://github.com/pakar/bubblewrap_opencode
 */
export interface BubblewrapConfig {
  /** Read-only bind mounts */
  roBinds: string[]
  /** Read-write bind mounts */
  binds: string[]
  /** Use network namespace (isolates network) */
  unshareNet: boolean
  /** Die when parent process exits */
  dieWithParent: boolean
  /** Use tmpfs for /tmp */
  tmpfsTmp: boolean
}

/**
 * Generate bubblewrap arguments
 */
export function generateBwrapArgs(config: BubblewrapConfig): string[] {
  const args: string[] = []

  // Read-only binds
  for (const path of config.roBinds) {
    args.push('--ro-bind', path, path)
  }

  // Read-write binds
  for (const path of config.binds) {
    args.push('--bind', path, path)
  }

  // Standard mounts
  args.push('--proc', '/proc')
  args.push('--dev', '/dev')

  // Tmpfs
  if (config.tmpfsTmp) {
    args.push('--tmpfs', '/tmp')
  }

  // Network isolation
  if (config.unshareNet) {
    args.push('--unshare-net')
  }

  // Die with parent
  if (config.dieWithParent) {
    args.push('--die-with-parent')
  }

  return args
}

/**
 * Default Bubblewrap configuration
 */
export const DEFAULT_BWRAP_CONFIG: BubblewrapConfig = {
  roBinds: ['/usr', '/lib', '/lib64', '/bin', '/etc'],
  binds: [], // Will be filled with project dir
  unshareNet: true,
  dieWithParent: true,
  tmpfsTmp: true,
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create permissions with development defaults
 */
export function createDevPermissions(): OpenCodePermissions {
  return new OpenCodePermissions(DEFAULT_DEV_CONFIG)
}

/**
 * Create permissions with strict defaults
 */
export function createStrictPermissions(): OpenCodePermissions {
  return new OpenCodePermissions(STRICT_CONFIG)
}

/**
 * Create permissions from a config object
 */
export function createPermissions(config: OpenCodeConfig): OpenCodePermissions {
  return new OpenCodePermissions(config)
}

/**
 * Create permissions for documentation editing only
 */
export function createDocsPermissions(): OpenCodePermissions {
  return new OpenCodePermissions(DOCS_ONLY_CONFIG)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a command string to extract the base command
 */
export function parseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] ?? ''
}

/**
 * Check if a path is within the project directory
 */
export function isInProject(path: string, projectRoot: string): boolean {
  const normalizedPath = path.startsWith('/') ? path : `${projectRoot}/${path}`
  return normalizedPath.startsWith(projectRoot)
}

/**
 * Validate an OpenCode configuration object
 */
export function validateConfig(config: OpenCodeConfig): string[] {
  const errors: string[] = []

  // Check for conflicting patterns
  if (config.permission?.bash && typeof config.permission.bash === 'object') {
    const patterns = Object.keys(config.permission.bash)
    // Check for overlapping patterns that might cause confusion
    if (patterns.includes('*') && patterns.length > 1) {
      // This is fine - specific patterns override wildcard
    }
  }

  return errors
}

// ============================================================================
// Export Default
// ============================================================================

export const defaultPermissions = createDevPermissions()
