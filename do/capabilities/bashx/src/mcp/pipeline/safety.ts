/**
 * analyzeSafety Pipeline Stage
 *
 * Analyzes parsed commands for safety classification and intent extraction.
 * This is an independently callable pipeline stage that can be used
 * standalone or as part of the full MCP pipeline.
 *
 * @module src/mcp/pipeline/safety
 */

import type { Program, SafetyClassification, Intent, OperationType, ImpactLevel } from '../../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Input for the analyzeSafety pipeline stage
 */
export interface SafetyInput {
  /** The bash command string to analyze */
  command: string
  /** The parsed AST, or null if not available */
  ast: Program | null
}

/**
 * Result from the analyzeSafety pipeline stage
 */
export interface SafetyResult {
  /** Safety classification of the command */
  classification: SafetyClassification
  /** Extracted intent from the command */
  intent: Intent
}

// ============================================================================
// Command Classification Data
// ============================================================================

/**
 * Commands that only read data and have no side effects
 */
const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'awk', 'sed',
  'find', 'which', 'whereis', 'type', 'file', 'stat', 'wc', 'sort',
  'uniq', 'diff', 'cmp', 'pwd', 'echo', 'printf', 'date', 'cal',
  'whoami', 'id', 'groups', 'uname', 'hostname', 'uptime', 'free',
  'df', 'du', 'ps', 'top', 'htop', 'pgrep', 'env', 'printenv',
  'test', '[', '[[', 'true', 'false', 'expr', 'bc', 'seq',
  'basename', 'dirname', 'realpath', 'readlink', 'md5sum', 'sha256sum',
  'man', 'help', 'info', 'apropos', 'whatis',
  'cd', 'pushd', 'popd', 'dirs', 'alias', 'unalias', 'export', 'set', 'unset',
])

/**
 * Commands that delete data
 */
const DELETE_COMMANDS = new Set([
  'rm', 'rmdir', 'unlink', 'shred',
])

/**
 * Commands that write/modify data
 */
const WRITE_COMMANDS = new Set([
  'cp', 'mv', 'touch', 'mkdir', 'ln',
  'chmod', 'chown', 'chgrp', 'chattr',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'xz',
  'tee', 'install', 'patch',
])

/**
 * Commands that perform network operations
 */
const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'netcat', 'ssh', 'scp', 'sftp', 'rsync',
  'ftp', 'telnet', 'ping', 'traceroute', 'nslookup', 'dig', 'host',
  'nmap', 'netstat', 'ss', 'ip', 'ifconfig', 'route',
])

/**
 * Commands that execute other code
 */
const EXECUTE_COMMANDS = new Set([
  'exec', 'eval', 'source', '.', 'bash', 'sh', 'zsh', 'fish',
  'xargs', 'parallel', 'nohup', 'timeout', 'time', 'watch',
])

/**
 * Critical system commands
 */
const SYSTEM_COMMANDS = new Set([
  'shutdown', 'reboot', 'poweroff', 'halt', 'init',
  'dd', 'mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs',
  'fdisk', 'parted', 'gdisk', 'mkswap', 'swapon', 'swapoff',
  'mount', 'umount', 'losetup',
  'iptables', 'ip6tables', 'firewall-cmd', 'ufw',
  'systemctl', 'service', 'chkconfig',
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel',
  'passwd', 'chpasswd', 'visudo',
])

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a command string to extract command names and arguments
 */
function parseCommandString(command: string): { commands: string[]; args: string[]; fullArgs: Map<string, string[]> } {
  const trimmed = command.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return { commands: [], args: [], fullArgs: new Map() }
  }

  // Split by pipes and list operators to get individual commands
  const cmdParts = trimmed.split(/\s*(?:\||\|\||&&|;)\s*/)
  const commands: string[] = []
  const allArgs: string[] = []
  const fullArgs = new Map<string, string[]>()

  for (const part of cmdParts) {
    const tokens = part.trim().split(/\s+/)
    if (tokens.length === 0 || !tokens[0]) continue

    const cmdName = tokens[0]
    const args = tokens.slice(1)

    commands.push(cmdName)
    allArgs.push(...args)
    fullArgs.set(cmdName, args)
  }

  return { commands, args: allArgs, fullArgs }
}

/**
 * Extract paths from arguments (non-flag arguments)
 */
function extractPaths(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith('-') && arg.length > 0)
}

/**
 * Check for recursive flag
 */
function hasRecursiveFlag(args: string[]): boolean {
  return args.some(arg =>
    arg === '-r' || arg === '-R' || arg === '-rf' || arg === '-fr' || arg === '--recursive'
  )
}

/**
 * Check if path is root or critical
 */
function isCriticalPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '')
  return normalized === '' || normalized === '/' || normalized === '/*' ||
    normalized === '~' || normalized === '~/'
}

/**
 * Extract read paths from command
 */
function extractReadPaths(command: string, cmdName: string, args: string[]): string[] {
  const reads: string[] = []
  const paths = extractPaths(args)

  // Handle input redirection
  const redirectMatch = command.match(/<\s*(\S+)/)
  if (redirectMatch) {
    reads.push(redirectMatch[1])
  }

  // Handle read commands
  if (READ_ONLY_COMMANDS.has(cmdName) && paths.length > 0) {
    reads.push(...paths)
  }

  // Handle cat specifically
  if (cmdName === 'cat') {
    reads.push(...paths)
  }

  return reads
}

/**
 * Extract write paths from command
 */
function extractWritePaths(command: string, cmdName: string, args: string[]): string[] {
  const writes: string[] = []
  const paths = extractPaths(args)

  // Handle output redirection (> or >>)
  const redirectMatch = command.match(/>{1,2}\s*(\S+)/)
  if (redirectMatch) {
    writes.push(redirectMatch[1])
  }

  // Handle write commands
  if (WRITE_COMMANDS.has(cmdName)) {
    writes.push(...paths)
  }

  return writes
}

/**
 * Extract delete paths from command
 */
function extractDeletePaths(cmdName: string, args: string[]): string[] {
  if (!DELETE_COMMANDS.has(cmdName)) {
    return []
  }
  return extractPaths(args)
}

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Classify a single command
 */
function classifyCommand(
  cmdName: string,
  args: string[],
  command: string
): { type: OperationType; impact: ImpactLevel; reversible: boolean; reason: string } {
  const paths = extractPaths(args)
  const recursive = hasRecursiveFlag(args)
  const hasCritical = paths.some(isCriticalPath)

  // Empty command
  if (!cmdName) {
    return {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Empty command',
    }
  }

  // System commands
  if (SYSTEM_COMMANDS.has(cmdName)) {
    return {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: `${cmdName} is a critical system command`,
    }
  }

  // Delete commands
  if (DELETE_COMMANDS.has(cmdName)) {
    if (hasCritical && (recursive || paths.some(p => p === '/'))) {
      return {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Recursively deletes critical path',
      }
    }
    if (recursive) {
      return {
        type: 'delete',
        impact: 'high',
        reversible: false,
        reason: 'Recursively deletes directory and contents',
      }
    }
    return {
      type: 'delete',
      impact: 'medium',
      reversible: false,
      reason: 'Deletes file permanently',
    }
  }

  // Network commands
  if (NETWORK_COMMANDS.has(cmdName)) {
    return {
      type: 'network',
      impact: 'low',
      reversible: true,
      reason: 'Network operation',
    }
  }

  // Execute commands (eval, exec, etc.)
  if (EXECUTE_COMMANDS.has(cmdName)) {
    return {
      type: 'execute',
      impact: 'medium',
      reversible: false,
      reason: 'Executes external code',
    }
  }

  // Write commands
  if (WRITE_COMMANDS.has(cmdName)) {
    // mv is reversible (can be moved back)
    if (cmdName === 'mv') {
      return {
        type: 'write',
        impact: 'low',
        reversible: true,
        reason: 'File move operation',
      }
    }
    return {
      type: 'write',
      impact: 'low',
      reversible: true,
      reason: 'File write operation',
    }
  }

  // Check for output redirection (indicates write)
  if (command.includes('>')) {
    return {
      type: 'write',
      impact: 'low',
      reversible: false,
      reason: 'Writes to file via redirection',
    }
  }

  // Read-only commands
  if (READ_ONLY_COMMANDS.has(cmdName)) {
    return {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command',
    }
  }

  // Unknown command - default to execute with low impact
  return {
    type: 'execute',
    impact: 'low',
    reversible: false,
    reason: 'Unknown command',
  }
}

/**
 * Determine the overall operation type from multiple commands
 */
function determineOverallType(types: Set<OperationType>): OperationType {
  // If there's more than one distinct significant type, it's mixed
  // Read + another type = mixed (e.g., cat file | curl is mixed)
  const hasRead = types.has('read')
  const nonReadTypes = new Set([...types].filter(t => t !== 'read'))

  // Multiple non-read types = mixed
  if (nonReadTypes.size > 1) {
    return 'mixed'
  }

  // Read + one non-read type = mixed
  if (hasRead && nonReadTypes.size === 1) {
    return 'mixed'
  }

  // Priority order for single type
  if (types.has('system')) return 'system'
  if (types.has('delete')) return 'delete'
  if (types.has('network')) return 'network'
  if (types.has('execute')) return 'execute'
  if (types.has('write')) return 'write'
  return 'read'
}

// ============================================================================
// Main Implementation
// ============================================================================

/**
 * Analyze a command for safety classification and intent extraction.
 *
 * This function:
 * 1. Parses the command string to extract commands and arguments
 * 2. Classifies each command for safety (type, impact, reversibility)
 * 3. Extracts intent (reads, writes, deletes, network, elevated)
 *
 * @example
 * ```typescript
 * // Analyze a simple command
 * const result = analyzeSafety({ command: 'ls -la', ast: null })
 * console.log(result.classification.impact)  // 'none'
 * console.log(result.classification.type)    // 'read'
 *
 * // Analyze a dangerous command
 * const result = analyzeSafety({ command: 'rm -rf /', ast: null })
 * console.log(result.classification.impact)  // 'critical'
 * console.log(result.classification.reversible)  // false
 * ```
 */
export function analyzeSafety(input: SafetyInput): SafetyResult {
  const { command } = input

  // Handle empty/comment-only commands
  const trimmed = command.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return {
      classification: {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Empty or comment-only command',
      },
      intent: {
        commands: [],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
    }
  }

  // Parse command string
  const { commands, fullArgs } = parseCommandString(command)

  // Initialize intent
  const intent: Intent = {
    commands: [...commands],
    reads: [],
    writes: [],
    deletes: [],
    network: false,
    elevated: false,
  }

  // Track classification components
  let maxImpact: ImpactLevel = 'none'
  let anyIrreversible = false
  const types = new Set<OperationType>()
  let mainReason = 'No commands'

  const impactOrder: ImpactLevel[] = ['none', 'low', 'medium', 'high', 'critical']

  // Analyze each command
  for (const cmdName of commands) {
    const cmdArgs = fullArgs.get(cmdName) || []

    // Classify this command
    const classification = classifyCommand(cmdName, cmdArgs, command)

    // Update max impact
    if (impactOrder.indexOf(classification.impact) > impactOrder.indexOf(maxImpact)) {
      maxImpact = classification.impact
      mainReason = classification.reason
    }

    // Track types
    types.add(classification.type)

    // Track reversibility
    if (!classification.reversible) {
      anyIrreversible = true
    }

    // Extract intent paths
    intent.reads.push(...extractReadPaths(command, cmdName, cmdArgs))
    intent.writes.push(...extractWritePaths(command, cmdName, cmdArgs))
    intent.deletes.push(...extractDeletePaths(cmdName, cmdArgs))

    // Check for network
    if (NETWORK_COMMANDS.has(cmdName)) {
      intent.network = true
    }

    // Check for elevated (sudo, doas, su)
    if (cmdName === 'sudo' || cmdName === 'su' || cmdName === 'doas') {
      intent.elevated = true
    }
  }

  // Determine overall type
  const overallType = determineOverallType(types)

  return {
    classification: {
      type: overallType,
      impact: maxImpact,
      reversible: !anyIrreversible,
      reason: mainReason,
    },
    intent,
  }
}
