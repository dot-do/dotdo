/**
 * Security Policy Module
 *
 * Provides hardened security boundaries for Tier 4 sandbox execution.
 * Implements command injection prevention, path traversal protection,
 * resource access control, and environment variable isolation.
 *
 * Key Features:
 * - Command injection prevention (shell metacharacters: ;, |, &, $(), etc.)
 * - Path traversal prevention (../, encoded sequences, null bytes)
 * - Resource access control (sensitive files, /proc, /sys, devices)
 * - Environment variable isolation (blocks credentials, tokens, keys)
 * - Network access control (host whitelisting, port blocking)
 * - Security audit logging for violation tracking
 *
 * @module bashx/do/security/security-policy
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of security violations that can be detected.
 */
export type ViolationType =
  | 'injection'         // Shell metacharacter injection
  | 'path_traversal'    // ../ or encoded path traversal
  | 'path_access'       // Access outside allowed paths
  | 'sensitive_resource' // Access to sensitive files/directories
  | 'env_sensitive'     // Sensitive environment variables
  | 'network'           // Network access violations
  | 'dangerous_command' // Commands in the blocklist
  | 'command_not_allowed' // Command not in allowlist (allowlist mode)

/**
 * Severity levels for security violations.
 */
export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Detailed information about a security violation.
 */
export interface SecurityViolation {
  /** Type of violation */
  type: ViolationType
  /** Human-readable message describing the violation */
  message: string
  /** Severity level */
  severity: ViolationSeverity
  /** The pattern or resource that triggered the violation */
  pattern?: string
  /** The resource being accessed (for path/resource violations) */
  resource?: string
  /** The command being validated (for command violations) */
  command?: string
  /** The path being validated (for path violations) */
  path?: string
  /** Blocked port number (for network violations) */
  blockedPort?: number
  /** Timestamp when violation occurred */
  timestamp: Date
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  /** Whether the input is valid (no violations) */
  valid: boolean
  /** Details of the violation if not valid */
  violation?: SecurityViolation
  /** Suggested safe alternative if available */
  suggestion?: string
}

/**
 * Result of environment validation with sanitized output.
 */
export interface EnvironmentValidationResult extends ValidationResult {
  /** List of environment variable names that were blocked */
  blockedVars?: string[]
  /** Sanitized environment with sensitive variables removed */
  sanitizedEnv?: Record<string, string>
}

/**
 * Network policy configuration.
 */
export interface NetworkPolicy {
  /** Whether outbound network access is allowed at all */
  allowOutbound?: boolean
  /** List of allowed hosts (when allowOutbound is true but restricted) */
  allowedHosts?: string[]
  /** List of explicitly blocked hosts */
  blockedHosts?: string[]
  /** List of blocked ports */
  blockedPorts?: number[]
}

/**
 * Security policy configuration.
 */
export interface SecurityPolicyConfig {
  /** Policy mode: blocklist (default) or allowlist */
  mode?: 'blocklist' | 'allowlist'
  /** List of allowed paths (restricts access to these roots) */
  allowedPaths?: string[]
  /** List of blocked paths (added to defaults) */
  blockedPaths?: string[]
  /** Additional blocked paths (merged with defaults) */
  additionalBlockedPaths?: string[]
  /** List of allowed commands (for allowlist mode) */
  allowedCommands?: string[]
  /** Custom blocked command patterns */
  blockedPatterns?: RegExp[]
  /** Whether to check symlinks point within allowed paths */
  checkSymlinks?: boolean
  /** Network policy configuration */
  networkPolicy?: NetworkPolicy
  /** Callback for violation notifications */
  onViolation?: (violation: SecurityViolation) => void
}

/**
 * Security policy interface.
 */
export interface SecurityPolicy {
  /** Validate a command for security issues */
  validateCommand(command: string): ValidationResult
  /** Validate a path for access violations */
  validatePath(path: string): ValidationResult
  /** Validate environment variables */
  validateEnvironment(env: Record<string, string>): EnvironmentValidationResult
  /** Get the current policy configuration */
  getConfig(): SecurityPolicyConfig & { checkSymlinks: boolean }
  /** Get audit log of violations */
  audit(): SecurityViolation[]
}

// ============================================================================
// DEFAULT SECURITY RULES
// ============================================================================

/**
 * Default blocked paths - sensitive system files and directories.
 */
export const DEFAULT_BLOCKED_PATHS: readonly string[] = [
  // Password and authentication
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  // SSH keys and config
  '.ssh',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'authorized_keys',
  'known_hosts',
  // Proc filesystem
  '/proc',
  // Sys filesystem
  '/sys',
  // Sensitive device files
  '/dev/mem',
  '/dev/kmem',
  '/dev/port',
  // Config files
  '/etc/master.passwd',
  '/etc/security',
  // Private directories
  '.gnupg',
  '.aws',
  '.kube',
]

/**
 * Safe device files that can be accessed.
 */
export const SAFE_DEVICE_FILES: readonly string[] = [
  '/dev/null',
  '/dev/zero',
  '/dev/urandom',
  '/dev/random',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
  '/dev/fd',
]

/**
 * Default blocked command patterns (regex).
 */
export const DEFAULT_BLOCKED_PATTERNS: readonly RegExp[] = [
  // Shell metacharacters for command injection
  /;/,                          // Command separator
  /&&/,                         // AND chaining (check before single &)
  /\|\|/,                       // OR chaining (check before single |)
  /\|(?!\|)/,                   // Pipe (but allow ||)
  /&(?!&)/,                     // Background (but allow &&)
  /`/,                          // Backtick command substitution
  /\$\(/,                       // $() command substitution
  /\$\{[^}]*![^}]*\}/,          // Indirect variable expansion ${!var}
  /<\(/,                        // Process substitution <()
  />\(/,                        // Process substitution >()
  /<<<\s*\$'/,                  // Here-string with escape sequences
  // Redirection to sensitive paths (handled separately in path validation)
]

/**
 * Default allowed commands for restrictive allowlist mode.
 */
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  // Basic info
  'ls', 'cat', 'head', 'tail', 'less', 'more',
  'pwd', 'cd', 'echo', 'printf',
  'date', 'time', 'cal',
  'wc', 'sort', 'uniq', 'cut', 'tr',
  'grep', 'egrep', 'fgrep',
  'find', 'which', 'whereis', 'type',
  'file', 'stat', 'basename', 'dirname',
  // Text processing
  'sed', 'awk', 'diff', 'comm',
  'tee', 'xargs',
  // Compression (read-only)
  'zcat', 'bzcat', 'xzcat',
  'gunzip', 'bunzip2', 'unxz',
  // Environment
  'env', 'printenv', 'export', 'set',
  'id', 'whoami', 'groups',
  // Process info (read-only)
  'ps', 'uptime',
]

/**
 * Dangerous command patterns that should always be blocked.
 */
const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  // Destructive root operations
  /\brm\s+(-[^\s]*\s+)*-[^\s]*r[^\s]*\s+(-[^\s]*\s+)*\//,  // rm -rf /
  /\bchmod\s+(-[^\s]*\s+)*-[^\s]*R[^\s]*\s+(-[^\s]*\s+)*777\s+(-[^\s]*\s+)*\//,  // chmod -R 777 /
  /\bchown\s+(-[^\s]*\s+)*-[^\s]*R[^\s]*\s+[^\s]+\s+\/etc\b/,  // chown -R ... /etc
  // Disk operations
  /\bdd\b[^|;]*\bof=\/dev\/(sd|hd|nvme|vd)[a-z]/,  // dd to disk devices
  /\bmkfs\b/,  // Filesystem formatting
  // Network exfiltration commands (handled via network policy)
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bnetcat\b/,
  /\btelnet\b/,
]

/**
 * Patterns for sensitive environment variables.
 */
const SENSITIVE_ENV_PATTERNS: readonly RegExp[] = [
  // AWS credentials
  /^AWS_/i,
  // API keys and tokens
  /API[_-]?KEY/i,
  /SECRET[_-]?KEY/i,
  /ACCESS[_-]?KEY/i,
  /AUTH[_-]?TOKEN/i,
  /TOKEN$/i,
  /^GITHUB_TOKEN$/i,
  /^NPM_TOKEN$/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  // Database credentials
  /DATABASE[_-]?URL/i,
  /DB[_-]?PASSWORD/i,
  /REDIS[_-]?URL/i,
  /MONGO[_-]?URI/i,
  // Private keys
  /PRIVATE[_-]?KEY/i,
  // Passwords
  /PASSWORD/i,
  /PASSWD/i,
]

/**
 * Patterns that indicate sensitive values (even in non-matching variable names).
 */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  // Private key headers
  /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/,
  // URLs with credentials
  /:\/\/[^:]+:[^@]+@/,
  // Common secret prefixes
  /^sk-[a-zA-Z0-9-_]+$/,  // OpenAI/Anthropic style keys
  /^ghp_[a-zA-Z0-9]+$/,   // GitHub personal access tokens
  /^npm_[a-zA-Z0-9]+$/,   // npm tokens
]

/**
 * Safe environment variables that are always allowed.
 */
const SAFE_ENV_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'PWD',
  'OLDPWD',
  'HOSTNAME',
  'NODE_ENV',
  'DEBUG',
  'VERBOSE',
  'LOG_LEVEL',
  'CI',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'TMPDIR',
  'TEMP',
  'TMP',
])

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Create a security policy with the given configuration.
 *
 * @param config - Policy configuration options
 * @returns A SecurityPolicy instance
 *
 * @example
 * ```typescript
 * const policy = createSecurityPolicy({
 *   allowedPaths: ['/home/user', '/tmp'],
 *   networkPolicy: {
 *     allowOutbound: false,
 *     allowedHosts: ['api.example.com'],
 *   },
 * })
 *
 * const result = policy.validateCommand('curl https://evil.com')
 * if (!result.valid) {
 *   console.log('Blocked:', result.violation?.message)
 * }
 * ```
 */
export function createSecurityPolicy(config: SecurityPolicyConfig = {}): SecurityPolicy {
  const auditLog: SecurityViolation[] = []
  const mode = config.mode ?? 'blocklist'
  const allowedPaths = config.allowedPaths ?? ['/home', '/tmp', '/var/tmp']
  const blockedPaths = new Set([
    ...DEFAULT_BLOCKED_PATHS,
    ...(config.blockedPaths ?? []),
    ...(config.additionalBlockedPaths ?? []),
  ])
  const allowedCommands = new Set(config.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS)
  const blockedPatterns = [
    ...DEFAULT_BLOCKED_PATTERNS,
    ...(config.blockedPatterns ?? []),
  ]
  const checkSymlinks = config.checkSymlinks ?? true
  // Default blocked ports for security
  const DEFAULT_BLOCKED_PORTS = [22, 23, 3389, 5900, 5901, 5902, 5903] // SSH, Telnet, RDP, VNC
  const networkPolicy = config.networkPolicy ?? {
    allowOutbound: true,
    blockedHosts: [],
    blockedPorts: DEFAULT_BLOCKED_PORTS,
  }

  /**
   * Log a violation and notify via callback if configured.
   */
  function logViolation(violation: SecurityViolation): void {
    auditLog.push(violation)
    config.onViolation?.(violation)
  }

  /**
   * Create a violation object.
   */
  function createViolation(
    type: ViolationType,
    message: string,
    severity: ViolationSeverity,
    extra: Partial<SecurityViolation> = {}
  ): SecurityViolation {
    return {
      type,
      message,
      severity,
      timestamp: new Date(),
      ...extra,
    }
  }

  /**
   * Validate a command for injection and dangerous patterns.
   */
  function validateCommand(command: string): ValidationResult {
    // Check for command injection patterns
    for (const pattern of blockedPatterns) {
      if (pattern.test(command)) {
        const violation = createViolation(
          'injection',
          `Command contains blocked pattern: ${pattern.toString()}`,
          'critical',
          { command, pattern: pattern.toString() }
        )
        logViolation(violation)
        return { valid: false, violation }
      }
    }

    // Extract base command name
    const baseCommand = extractCommandName(command)

    // Check allowlist mode
    if (mode === 'allowlist') {
      if (!allowedCommands.has(baseCommand)) {
        const violation = createViolation(
          'command_not_allowed',
          `Command "${baseCommand}" is not in the allowlist`,
          'high',
          { command }
        )
        logViolation(violation)
        return { valid: false, violation }
      }
    }

    // Check dangerous command patterns
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        // For network commands, delegate to network policy
        if (/\b(curl|wget|nc|netcat|telnet)\b/.test(command)) {
          return validateNetworkCommand(command)
        }

        const violation = createViolation(
          'dangerous_command',
          `Command matches dangerous pattern: ${pattern.toString()}`,
          'critical',
          { command, pattern: pattern.toString() }
        )
        logViolation(violation)
        return {
          valid: false,
          violation,
          suggestion: 'Consider using a safer alternative or restricting the scope of the operation.',
        }
      }
    }

    // Check for redirection to sensitive paths (both > and >>)
    const redirectMatch = command.match(/>>?\s*(\S+)/)
    if (redirectMatch) {
      const targetPath = redirectMatch[1]
      const pathResult = validatePath(targetPath)
      if (!pathResult.valid) {
        const violation = createViolation(
          'injection',
          `Redirection to blocked path: ${targetPath}`,
          'critical',
          { command, path: targetPath }
        )
        logViolation(violation)
        return { valid: false, violation }
      }
    }

    // Check input redirection from sensitive paths
    const inputRedirectMatch = command.match(/<\s*(\S+)/)
    if (inputRedirectMatch) {
      const sourcePath = inputRedirectMatch[1]
      const pathResult = validatePath(sourcePath)
      if (!pathResult.valid) {
        return pathResult
      }
    }

    return { valid: true }
  }

  /**
   * Validate network-related commands.
   */
  function validateNetworkCommand(command: string): ValidationResult {
    // Check blocked ports first (always check regardless of outbound setting)
    if (networkPolicy.blockedPorts?.length) {
      const portMatch = command.match(/(?:\s|:)(\d{2,5})(?:\s|$)/)
      if (portMatch) {
        const port = parseInt(portMatch[1], 10)
        if (networkPolicy.blockedPorts.includes(port)) {
          const violation = createViolation(
            'network',
            `Access to blocked port: ${port}`,
            'high',
            { command, blockedPort: port }
          )
          logViolation(violation)
          return { valid: false, violation }
        }
      }
    }

    // Check blocked hosts
    if (networkPolicy.blockedHosts?.length) {
      for (const host of networkPolicy.blockedHosts) {
        if (command.includes(host)) {
          const violation = createViolation(
            'network',
            `Access to blocked host: ${host}`,
            'high',
            { command }
          )
          logViolation(violation)
          return { valid: false, violation }
        }
      }
    }

    // If outbound is completely disabled, block all network commands
    if (!networkPolicy.allowOutbound) {
      // Check if target is in allowed hosts - extract host from URL properly
      const urlMatch = command.match(/https?:\/\/([a-zA-Z0-9.-]+)/)
      if (urlMatch) {
        const host = urlMatch[1]
        if (networkPolicy.allowedHosts?.includes(host)) {
          return { valid: true }
        }
      }

      const violation = createViolation(
        'network',
        'Outbound network access is disabled',
        'high',
        { command }
      )
      logViolation(violation)
      return { valid: false, violation }
    }

    return { valid: true }
  }

  /**
   * Validate a path for traversal and access violations.
   */
  function validatePath(path: string): ValidationResult {
    // Check for null byte injection
    if (path.includes('\0')) {
      const violation = createViolation(
        'path_traversal',
        'Path contains null byte',
        'critical',
        { path }
      )
      logViolation(violation)
      return { valid: false, violation }
    }

    // Decode URL-encoded sequences for validation
    let decodedPath = path
    try {
      // Decode multiple times to catch double-encoding
      let prevPath = ''
      while (decodedPath !== prevPath) {
        prevPath = decodedPath
        decodedPath = decodeURIComponent(decodedPath)
      }
    } catch {
      // Invalid encoding - continue with original
      decodedPath = path
    }

    // Check for path traversal patterns
    if (decodedPath.includes('..')) {
      // Normalize the path to see where it actually points
      const normalizedPath = normalizePath(decodedPath)

      // Check if normalized path escapes allowed roots
      const escapesAllowed = !allowedPaths.some(allowed =>
        normalizedPath.startsWith(allowed) || normalizedPath === allowed
      )

      if (escapesAllowed) {
        const violation = createViolation(
          'path_traversal',
          `Path traversal detected: ${path} normalizes to ${normalizedPath}`,
          'critical',
          { path }
        )
        logViolation(violation)
        return { valid: false, violation }
      }
    }

    // Check for sensitive resource access
    for (const blocked of blockedPaths) {
      // Check if path contains the blocked pattern
      if (decodedPath.includes(blocked) || path.includes(blocked)) {
        // Allow safe device files
        if (SAFE_DEVICE_FILES.some(safe => decodedPath === safe || decodedPath.startsWith(safe + '/'))) {
          continue
        }

        const violation = createViolation(
          'sensitive_resource',
          `Access to sensitive resource: ${blocked}`,
          'critical',
          { path, resource: blocked }
        )
        logViolation(violation)
        return { valid: false, violation }
      }
    }

    // For absolute paths, check if within allowed roots
    if (decodedPath.startsWith('/')) {
      const normalizedPath = normalizePath(decodedPath)

      // Allow safe device files
      if (SAFE_DEVICE_FILES.some(safe => normalizedPath === safe || normalizedPath.startsWith(safe + '/'))) {
        return { valid: true }
      }

      const isAllowed = allowedPaths.some(allowed =>
        normalizedPath.startsWith(allowed) || normalizedPath === allowed
      )

      if (!isAllowed) {
        const violation = createViolation(
          'path_access',
          `Path outside allowed directories: ${normalizedPath}`,
          'high',
          { path }
        )
        logViolation(violation)
        return { valid: false, violation }
      }
    }

    return { valid: true }
  }

  /**
   * Validate environment variables for sensitive data.
   */
  function validateEnvironment(env: Record<string, string>): EnvironmentValidationResult {
    const blockedVars: string[] = []
    const sanitizedEnv: Record<string, string> = {}
    let hasViolation = false
    let violation: SecurityViolation | undefined

    for (const [key, value] of Object.entries(env)) {
      // Check if it's a known safe variable
      if (SAFE_ENV_VARS.has(key)) {
        sanitizedEnv[key] = value
        continue
      }

      // Check variable name patterns
      let isSensitive = false
      for (const pattern of SENSITIVE_ENV_PATTERNS) {
        if (pattern.test(key)) {
          isSensitive = true
          break
        }
      }

      // Check value patterns
      if (!isSensitive) {
        for (const pattern of SENSITIVE_VALUE_PATTERNS) {
          if (pattern.test(value)) {
            isSensitive = true
            break
          }
        }
      }

      if (isSensitive) {
        blockedVars.push(key)
        hasViolation = true
        if (!violation) {
          violation = createViolation(
            'env_sensitive',
            `Sensitive environment variable detected: ${key}`,
            'high'
          )
          logViolation(violation)
        }
      } else {
        sanitizedEnv[key] = value
      }
    }

    return {
      valid: !hasViolation,
      violation,
      blockedVars: blockedVars.length > 0 ? blockedVars : undefined,
      sanitizedEnv,
    }
  }

  /**
   * Get the current policy configuration.
   */
  function getConfig(): SecurityPolicyConfig & { checkSymlinks: boolean } {
    return {
      mode,
      allowedPaths,
      blockedPaths: Array.from(blockedPaths),
      allowedCommands: Array.from(allowedCommands),
      blockedPatterns,
      checkSymlinks,
      networkPolicy,
    }
  }

  /**
   * Get audit log of violations.
   */
  function audit(): SecurityViolation[] {
    return [...auditLog]
  }

  return {
    validateCommand,
    validatePath,
    validateEnvironment,
    getConfig,
    audit,
  }
}

// ============================================================================
// STANDALONE VALIDATION FUNCTIONS
// ============================================================================

// Default policy instance for standalone functions
let defaultPolicy: SecurityPolicy | null = null

function getDefaultPolicy(): SecurityPolicy {
  if (!defaultPolicy) {
    defaultPolicy = createSecurityPolicy()
  }
  return defaultPolicy
}

/**
 * Validate a command using the default security policy.
 *
 * @param command - The command to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateCommand('echo $(whoami)')
 * if (!result.valid) {
 *   console.log('Blocked:', result.violation?.type)
 * }
 * ```
 */
export function validateCommand(command: string): ValidationResult {
  return getDefaultPolicy().validateCommand(command)
}

/**
 * Validate a path using the default security policy.
 *
 * @param path - The path to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validatePath('/etc/passwd')
 * if (!result.valid) {
 *   console.log('Blocked:', result.violation?.resource)
 * }
 * ```
 */
export function validatePath(path: string): ValidationResult {
  return getDefaultPolicy().validatePath(path)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract the base command name from a command string.
 */
function extractCommandName(command: string): string {
  const trimmed = command.trim()
  // Skip env var assignments at the start
  const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '')
  // Match the first word (command name)
  const match = withoutEnvVars.match(/^[\w\-./]+/)
  if (!match) return ''
  // Return just the command name (last part if it's a path)
  return match[0].split('/').pop() || ''
}

/**
 * Normalize a path by resolving . and .. components.
 */
function normalizePath(path: string): string {
  const parts = path.split('/')
  const normalized: string[] = []

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop()
      } else if (!path.startsWith('/')) {
        normalized.push('..')
      }
    } else {
      normalized.push(part)
    }
  }

  const result = normalized.join('/')
  return path.startsWith('/') ? '/' + result : result
}
