/**
 * AST Analysis
 *
 * Analyzes parsed AST to extract safety classification and intent.
 * Implements structural safety analysis without regex-based detection.
 */

import type {
  Program,
  CommandClassification,
  Intent,
  BashNode,
  Command,
  Word,
  Pipeline,
  List,
  Redirect,
} from '../types.js'

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
  'git', 'npm', 'node', 'python', 'python3', 'ruby', 'perl',
  'man', 'help', 'info', 'apropos', 'whatis',
  // Shell builtins that don't modify filesystem
  'cd', 'pushd', 'popd', 'dirs', 'alias', 'unalias', 'export', 'set', 'unset',
  'read', 'declare', 'local', 'typeset', 'readonly', 'shift', 'wait', 'jobs',
  'fg', 'bg', 'disown', 'builtin', 'command', 'enable', 'hash', 'history',
  'let', 'logout', 'mapfile', 'readarray', 'return', 'trap', 'ulimit', 'umask',
])

/**
 * Read-only git subcommands
 */
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote',
  'stash', 'describe', 'rev-parse', 'ls-files', 'ls-tree',
  'cat-file', 'shortlog', 'blame', 'bisect', 'config',
])

/**
 * Network write git subcommands
 */
const GIT_NETWORK_SUBCOMMANDS = new Set([
  'push', 'fetch', 'pull', 'clone',
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
  'sudo', 'su', 'doas', 'runuser',
])

/**
 * Critical system commands that should always require confirmation
 */
const CRITICAL_SYSTEM_COMMANDS = new Set([
  'shutdown', 'reboot', 'poweroff', 'halt', 'init',
  'dd', 'mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs',
  'fdisk', 'parted', 'gdisk', 'mkswap', 'swapon', 'swapoff',
  'mount', 'umount', 'losetup',
  'iptables', 'ip6tables', 'firewall-cmd', 'ufw',
  'systemctl', 'service', 'chkconfig',
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel',
  'passwd', 'chpasswd', 'visudo',
])

/**
 * Critical system paths that require elevated privileges
 */
const SYSTEM_PATHS = [
  '/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64',
  '/boot', '/dev', '/sys', '/proc', '/var', '/root', '/home',
]

/**
 * Paths that indicate device access
 */
const DEVICE_PATHS = ['/dev/sd', '/dev/hd', '/dev/nvme', '/dev/vd', '/dev/loop']

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract command name from a Word node
 */
function getCommandName(nameWord: Word | null): string {
  return nameWord?.value ?? ''
}

/**
 * Extract argument values from Word array
 */
function getArgs(args: Word[]): string[] {
  return args.map(arg => arg.value)
}

/**
 * Check if a path is a system/root path
 */
function isSystemPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '') // Remove trailing slashes
  return SYSTEM_PATHS.some(sp => normalized === sp || normalized.startsWith(sp + '/'))
}

/**
 * Check if a path is a device path
 */
function isDevicePath(path: string): boolean {
  return DEVICE_PATHS.some(dp => path.startsWith(dp)) || path === '/dev/zero' || path === '/dev/null'
}

/**
 * Check if args contain recursive flag
 */
function hasRecursiveFlag(args: string[]): boolean {
  return args.some(arg => arg === '-r' || arg === '-R' || arg === '-rf' || arg === '-fr' || arg === '--recursive')
}

/**
 * Check if args contain force flag
 */
function hasForceFlag(args: string[]): boolean {
  return args.some(arg => arg === '-f' || arg === '-rf' || arg === '-fr' || arg === '--force')
}

/**
 * Extract target paths from arguments
 */
function extractPaths(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith('-') && arg.length > 0)
}

/**
 * Check if any path is root or system-critical
 */
function hasCriticalPath(paths: string[]): boolean {
  return paths.some(p => {
    const normalized = p.replace(/\/+$/, '')
    // Handle root path (/ or empty after stripping trailing slashes)
    // Also handle /* and ~/
    return normalized === '' || normalized === '/' || normalized === '/*' ||
           normalized === '~' || normalized === '~/' ||
           p === '/' || // Direct check before normalization
           isDevicePath(p)
  })
}

/**
 * Check if command targets system paths
 */
function targetsSystemPath(paths: string[]): boolean {
  return paths.some(p => isSystemPath(p))
}

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Classify a single command from AST
 */
export function classifyCommand(commandName: string, args: string[]): CommandClassification {
  const name = commandName.toLowerCase()
  const paths = extractPaths(args)
  const recursive = hasRecursiveFlag(args)
  const force = hasForceFlag(args)

  // Handle empty command (assignment only)
  if (!name) {
    return {
      type: 'write',
      impact: 'low',
      reversible: true,
      reason: 'Variable assignment',
    }
  }

  // Critical system commands always critical
  if (CRITICAL_SYSTEM_COMMANDS.has(name)) {
    return {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: `${name} is a critical system command`,
    }
  }

  // Elevated commands (sudo, su, doas)
  if (name === 'sudo' || name === 'su' || name === 'doas') {
    // Re-classify the actual command being run
    if (args.length > 0) {
      const subCommand = args[0]
      const subArgs = args.slice(1)
      const subClassification = classifyCommand(subCommand, subArgs)

      // Elevate impact for sudo commands
      const impact = subClassification.impact === 'none' ? 'low' :
                    subClassification.impact === 'low' ? 'medium' :
                    subClassification.impact === 'medium' ? 'high' : 'critical'

      return {
        ...subClassification,
        impact,
        reason: `Elevated: ${subClassification.reason}`,
      }
    }
    return {
      type: 'execute',
      impact: 'high',
      reversible: false,
      reason: 'Elevated privilege command',
    }
  }

  // Git command classification
  if (name === 'git' && args.length > 0) {
    const subCommand = args[0]
    if (GIT_READ_ONLY_SUBCOMMANDS.has(subCommand)) {
      return {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only git command',
      }
    }
    if (GIT_NETWORK_SUBCOMMANDS.has(subCommand)) {
      return {
        type: 'network',
        impact: 'medium',
        reversible: true,
        reason: 'Git network operation',
      }
    }
    // Git write commands (commit, add, etc.)
    return {
      type: 'write',
      impact: 'low',
      reversible: true,
      reason: 'Git local write operation',
    }
  }

  // npm command classification
  if (name === 'npm' && args.length > 0) {
    const subCommand = args[0]
    if (subCommand === 'publish') {
      return {
        type: 'network',
        impact: 'high',
        reversible: false,
        reason: 'Publishes package to public registry',
      }
    }
    if (['list', 'ls', 'view', 'info', 'search', 'audit', 'outdated'].includes(subCommand)) {
      return {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only npm command',
      }
    }
    return {
      type: 'write',
      impact: 'low',
      reversible: true,
      reason: 'npm local operation',
    }
  }

  // Delete commands (rm, rmdir)
  if (DELETE_COMMANDS.has(name)) {
    // Critical: rm -rf / or rm -rf /*
    if (hasCriticalPath(paths) && (recursive || force)) {
      return {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: recursive ? 'Recursively deletes critical path' : 'Deletes critical path',
      }
    }

    // High: recursive delete
    if (recursive) {
      return {
        type: 'delete',
        impact: 'high',
        reversible: false,
        reason: 'Recursively deletes directory and contents',
      }
    }

    // Medium: single file delete
    return {
      type: 'delete',
      impact: 'medium',
      reversible: false,
      reason: 'Deletes file permanently',
    }
  }

  // Write commands (chmod, chown, etc.) with recursive and system paths
  if (name === 'chmod' || name === 'chown' || name === 'chgrp') {
    if (recursive && hasCriticalPath(paths)) {
      return {
        type: 'system',
        impact: 'critical',
        reversible: false,
        reason: `Recursively modifies permissions/ownership on critical path`,
      }
    }
    if (targetsSystemPath(paths)) {
      return {
        type: 'write',
        impact: 'high',
        reversible: false,
        reason: 'Modifies system file permissions/ownership',
      }
    }
    return {
      type: 'write',
      impact: 'medium',
      reversible: true,
      reason: `Modifies file ${name === 'chmod' ? 'permissions' : 'ownership'}`,
    }
  }

  // dd command - always dangerous for device targets
  if (name === 'dd') {
    const ofArg = args.find(a => a.startsWith('of='))
    const target = ofArg?.slice(3) ?? ''
    if (isDevicePath(target) || target.startsWith('/dev/')) {
      return {
        type: 'system',
        impact: 'critical',
        reversible: false,
        reason: 'Overwrites disk device',
      }
    }
    return {
      type: 'write',
      impact: 'high',
      reversible: false,
      reason: 'Low-level data copy operation',
    }
  }

  // Network commands
  if (NETWORK_COMMANDS.has(name)) {
    // POST/PUT requests are higher impact
    if (name === 'curl' && (args.includes('-X') || args.includes('--request'))) {
      const methodIndex = args.indexOf('-X') !== -1 ? args.indexOf('-X') : args.indexOf('--request')
      const method = args[methodIndex + 1]?.toUpperCase()
      if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
        return {
          type: 'network',
          impact: 'medium',
          reversible: false,
          reason: `Sends ${method} request to remote server`,
        }
      }
    }
    return {
      type: 'network',
      impact: 'low',
      reversible: true,
      reason: 'Network operation',
    }
  }

  // Execute commands
  if (EXECUTE_COMMANDS.has(name)) {
    return {
      type: 'execute',
      impact: 'medium',
      reversible: false,
      reason: 'Executes external code',
    }
  }

  // Write commands
  if (WRITE_COMMANDS.has(name)) {
    if (targetsSystemPath(paths)) {
      return {
        type: 'write',
        impact: 'high',
        reversible: false,
        reason: 'Writes to system path',
      }
    }
    return {
      type: 'write',
      impact: 'low',
      reversible: true,
      reason: 'File write operation',
    }
  }

  // Kill command
  if (name === 'kill' || name === 'killall' || name === 'pkill') {
    const hasSignal9 = args.includes('-9') || args.includes('-KILL') || args.includes('SIGKILL')
    return {
      type: 'system',
      impact: hasSignal9 ? 'high' : 'medium',
      reversible: false,
      reason: hasSignal9 ? 'Force terminates a running process' : 'Terminates a process',
    }
  }

  // Read-only commands
  if (READ_ONLY_COMMANDS.has(name)) {
    return {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command',
    }
  }

  // Unknown command - be conservative
  return {
    type: 'execute',
    impact: 'low',
    reversible: false,
    reason: 'Unknown command - classified conservatively',
  }
}

/**
 * Classify redirect operations
 */
function classifyRedirect(redirect: Redirect): CommandClassification {
  const target = redirect.target.value
  const isWrite = redirect.op === '>' || redirect.op === '>>' || redirect.op === '>|'

  if (!isWrite) {
    return {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Input redirection',
    }
  }

  if (isSystemPath(target)) {
    return {
      type: 'write',
      impact: 'high',
      reversible: false,
      reason: 'Writes to system configuration file',
    }
  }

  return {
    type: 'write',
    impact: 'low',
    reversible: redirect.op === '>>' ? true : false, // Append is somewhat reversible
    reason: redirect.op === '>>' ? 'Appends to file' : 'Overwrites file',
  }
}

/**
 * Extract commands from AST nodes recursively
 */
function extractAllCommands(node: BashNode): Command[] {
  const commands: Command[] = []

  switch (node.type) {
    case 'Program':
      for (const child of node.body) {
        commands.push(...extractAllCommands(child))
      }
      break
    case 'Command':
      commands.push(node)
      break
    case 'Pipeline':
      for (const cmd of node.commands) {
        commands.push(...extractAllCommands(cmd))
      }
      break
    case 'List':
      commands.push(...extractAllCommands(node.left))
      commands.push(...extractAllCommands(node.right))
      break
    case 'Subshell':
      for (const child of node.body) {
        commands.push(...extractAllCommands(child))
      }
      break
    case 'CompoundCommand':
      for (const child of node.body) {
        commands.push(...extractAllCommands(child))
      }
      break
    case 'FunctionDef':
      commands.push(...extractAllCommands(node.body))
      break
  }

  return commands
}

/**
 * Combine classifications, taking the most dangerous
 */
function combineClassifications(classifications: CommandClassification[]): CommandClassification {
  if (classifications.length === 0) {
    return {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Empty command',
    }
  }

  const impactOrder = ['none', 'low', 'medium', 'high', 'critical']
  const typeOrder = ['read', 'write', 'delete', 'execute', 'network', 'system', 'mixed']

  let maxImpact = 'none'
  let mainType = classifications[0].type
  let mainReason = classifications[0].reason
  let anyIrreversible = false

  // Collect all non-read types to determine if truly mixed
  const nonReadTypes = new Set<string>()

  for (const classification of classifications) {
    // Track maximum impact
    if (impactOrder.indexOf(classification.impact) > impactOrder.indexOf(maxImpact)) {
      maxImpact = classification.impact
      mainReason = classification.reason
    }

    // Track non-read types
    if (classification.type !== 'read') {
      nonReadTypes.add(classification.type)
    }

    // Update main type if this one is more severe
    if (typeOrder.indexOf(classification.type) > typeOrder.indexOf(mainType)) {
      mainType = classification.type
    }

    // Track reversibility
    if (!classification.reversible) {
      anyIrreversible = true
    }
  }

  // Only return 'mixed' if there are truly multiple different non-read types
  // (e.g., write + network, delete + system)
  // Don't count read as it's semantically included in other operations
  const hasMultipleTypes = nonReadTypes.size > 1

  return {
    type: hasMultipleTypes ? 'mixed' : mainType,
    impact: maxImpact as CommandClassification['impact'],
    reversible: !anyIrreversible,
    reason: mainReason,
  }
}

/**
 * Extract intent from commands
 */
function extractIntent(commands: Command[]): Intent {
  const intent: Intent = {
    commands: [],
    reads: [],
    writes: [],
    deletes: [],
    network: false,
    elevated: false,
  }

  for (const cmd of commands) {
    const name = getCommandName(cmd.name)
    const args = getArgs(cmd.args)
    const paths = extractPaths(args)

    if (name) {
      intent.commands.push(name)
    }

    // Check for elevated
    if (name === 'sudo' || name === 'su' || name === 'doas') {
      intent.elevated = true
      if (args.length > 0) {
        intent.commands.push(args[0])
      }
    }

    // Check for network
    if (NETWORK_COMMANDS.has(name) || GIT_NETWORK_SUBCOMMANDS.has(args[0])) {
      intent.network = true
    }

    // Categorize paths
    if (DELETE_COMMANDS.has(name)) {
      intent.deletes.push(...paths)
    } else if (name === 'mv') {
      // mv reads source, writes to destination, and deletes source
      if (paths.length >= 2) {
        // All but last are sources (reads and deletes)
        const sources = paths.slice(0, -1)
        const dest = paths[paths.length - 1]
        intent.reads.push(...sources)
        intent.writes.push(dest)
        intent.deletes.push(...sources) // mv removes from source
      } else if (paths.length === 1) {
        // Single arg mv (unusual, but handle it)
        intent.reads.push(paths[0])
        intent.deletes.push(paths[0])
      }
    } else if (WRITE_COMMANDS.has(name) || name === 'chmod' || name === 'chown') {
      intent.writes.push(...paths)
    } else if (READ_ONLY_COMMANDS.has(name)) {
      if (paths.length > 0) {
        intent.reads.push(...paths)
      } else if (name === 'ls' || name === 'pwd') {
        intent.reads.push('.')
      }
    }

    // Handle redirects
    for (const redirect of cmd.redirects) {
      const target = redirect.target.value
      if (redirect.op === '>' || redirect.op === '>>' || redirect.op === '>|') {
        intent.writes.push(target)
        if (isSystemPath(target)) {
          intent.elevated = true
        }
      } else if (redirect.op === '<') {
        intent.reads.push(target)
      }
    }

    // Check if targeting system paths elevates privileges
    if (hasCriticalPath(paths) || targetsSystemPath(paths)) {
      if (DELETE_COMMANDS.has(name) || WRITE_COMMANDS.has(name) ||
          name === 'chmod' || name === 'chown') {
        intent.elevated = true
      }
    }
  }

  return intent
}

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Analyze an AST for safety classification
 */
export function analyze(ast: Program): { classification: CommandClassification; intent: Intent } {
  const commands = extractAllCommands(ast)

  if (commands.length === 0) {
    return {
      classification: {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Empty command or no executable commands',
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

  const classifications: CommandClassification[] = []

  for (const cmd of commands) {
    const name = getCommandName(cmd.name)
    const args = getArgs(cmd.args)

    // Classify the command itself
    classifications.push(classifyCommand(name, args))

    // Classify redirects
    for (const redirect of cmd.redirects) {
      classifications.push(classifyRedirect(redirect))
    }
  }

  const classification = combineClassifications(classifications)
  const intent = extractIntent(commands)

  return { classification, intent }
}

/**
 * Check if command is dangerous based on AST structure
 */
export function isDangerous(ast: Program): { dangerous: boolean; reason?: string } {
  const { classification } = analyze(ast)

  if (classification.impact === 'critical') {
    return { dangerous: true, reason: classification.reason }
  }

  if (classification.impact === 'high' && !classification.reversible) {
    return { dangerous: true, reason: classification.reason }
  }

  return { dangerous: false }
}
