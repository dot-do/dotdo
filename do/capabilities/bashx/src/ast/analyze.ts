/**
 * AST Analysis
 *
 * Analyzes parsed AST to extract safety classification and intent.
 * Implements structural safety analysis without regex-based detection.
 *
 * NOTE: This module contains platform-specific extensions to the core safety
 * analysis in core/safety/analyze.ts. The core module provides the pure library
 * implementation, while this module adds Worker-specific features.
 *
 * Key differences from core/safety/analyze.ts:
 * - Extended intent extraction with semantic descriptions
 * - Additional type imports for Pipeline and List nodes
 * - Platform-specific comments and documentation
 *
 * Both files import command classification data from core/safety/command-sets.ts
 * to ensure consistent behavior.
 *
 * @module bashx/ast/analyze
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

import {
  READ_ONLY_COMMANDS,
  GIT_READ_ONLY_SUBCOMMANDS,
  GIT_NETWORK_SUBCOMMANDS,
  DELETE_COMMANDS,
  WRITE_COMMANDS,
  NETWORK_COMMANDS,
  EXECUTE_COMMANDS,
  CRITICAL_SYSTEM_COMMANDS,
  SYSTEM_PATHS,
  DEVICE_PATHS,
} from '../../core/safety/command-sets.js'

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

// ============================================================================
// Intent Extraction from AST
// ============================================================================

/**
 * Extended intent with rich semantic information
 */
export interface ExtendedIntent extends Intent {
  /** Primary action verb (list, read, delete, create, etc.) */
  action: string
  /** Object being acted upon (files, directory, etc.) */
  object: string
  /** Human-readable description */
  description: string
  /** Primary target path/file */
  target?: string
  /** Multiple targets */
  targets?: string[]
  /** Source path for copy/move operations */
  source?: string
  /** Search path for find operations */
  searchPath?: string
  /** Pattern for search/find operations */
  pattern?: string
  /** Message (e.g., commit message) */
  message?: string
  /** URL for network operations */
  url?: string
  /** HTTP method for network operations */
  method?: string
  /** Remote name for git operations */
  remote?: string
  /** Branch name for git operations */
  branch?: string
  /** Modifiers extracted from flags */
  modifiers: string[]
  /** High-level action type classification */
  actionType: 'read' | 'write' | 'delete' | 'network' | 'execute' | 'system'
  /** Object type classification */
  objectType?: 'file' | 'directory' | 'process' | 'url' | 'pattern'
}

/**
 * Partial extended intent type that properly includes base Intent fields.
 * TypeScript's Partial<ExtendedIntent> doesn't properly handle inherited fields
 * when crossing module boundaries, so we explicitly define the partial type.
 */
type PartialExtendedIntent = Partial<Intent> & Partial<Omit<ExtendedIntent, keyof Intent>>

/**
 * Maps file extensions to human-readable descriptions
 */
const FILE_TYPE_DESCRIPTIONS: Record<string, string> = {
  '.js': 'JavaScript files',
  '.ts': 'TypeScript files',
  '.py': 'Python files',
  '.md': 'Markdown files',
  '.json': 'JSON files',
  '.log': 'log files',
  '.txt': 'text files',
  '.tmp': 'temporary files',
  '.sh': 'shell scripts',
  '.yaml': 'YAML files',
  '.yml': 'YAML files',
  '.css': 'CSS files',
  '.html': 'HTML files',
  '.xml': 'XML files',
}

/**
 * Extract file type description from a pattern like "*.js"
 */
function getFileTypeDescription(pattern: string): string {
  // Extract extension from pattern like "*.js" or "*.log"
  const extMatch = pattern.match(/\*(\.[a-zA-Z0-9]+)$/)
  if (extMatch) {
    const ext = extMatch[1]
    return FILE_TYPE_DESCRIPTIONS[ext] || `${ext.slice(1)} files`
  }
  return 'files'
}

/**
 * Extract modifiers from command flags
 */
function extractModifiers(args: string[]): string[] {
  const modifiers: string[] = []

  for (const arg of args) {
    if (!arg.startsWith('-')) continue

    // Handle combined flags like -rfv
    const flags = arg.startsWith('--') ? [arg] : arg.slice(1).split('')

    for (const flag of flags) {
      switch (flag) {
        case 'r':
        case 'R':
        case 'recursive':
        case '-recursive':
          modifiers.push('recursive')
          break
        case 'f':
        case '-force':
          modifiers.push('force')
          break
        case 'v':
        case '-verbose':
          modifiers.push('verbose')
          break
        case 'a':
          modifiers.push('all')
          break
        case 'l':
          modifiers.push('long')
          break
        case 'i':
        case '-ignore-case':
          modifiers.push('case-insensitive')
          break
        case 'n':
        case '-dry-run':
          if (arg === '-n' || arg === '--dry-run') {
            modifiers.push('dry-run')
          }
          break
      }
    }
  }

  return [...new Set(modifiers)] // Remove duplicates
}

/**
 * Get action type classification
 */
function getActionType(commandName: string, args: string[]): ExtendedIntent['actionType'] {
  const name = commandName.toLowerCase()

  if (DELETE_COMMANDS.has(name)) return 'delete'
  if (NETWORK_COMMANDS.has(name)) return 'network'
  if (name === 'git' && args.length > 0 && GIT_NETWORK_SUBCOMMANDS.has(args[0])) return 'network'
  if (WRITE_COMMANDS.has(name) || name === 'chmod' || name === 'chown' || name === 'touch' || name === 'mkdir') return 'write'
  if (READ_ONLY_COMMANDS.has(name)) return 'read'
  if (EXECUTE_COMMANDS.has(name)) return 'execute'
  if (CRITICAL_SYSTEM_COMMANDS.has(name) || name === 'kill' || name === 'killall' || name === 'pkill') return 'system'

  return 'execute'
}

/**
 * Extract intent from a single command
 */
function extractCommandIntent(cmd: Command): PartialExtendedIntent {
  const name = getCommandName(cmd.name)
  const args = getArgs(cmd.args)
  const paths = extractPaths(args)
  const modifiers = extractModifiers(args)

  const intent: PartialExtendedIntent = {
    modifiers,
    actionType: getActionType(name, args),
  }

  // Basic file operations
  switch (name.toLowerCase()) {
    case 'ls': {
      intent.action = 'list'
      intent.object = 'files'
      intent.objectType = 'directory'
      if (paths.length > 0) {
        intent.target = paths[0]
        intent.description = `list files in ${paths[0]}`
      } else {
        intent.description = 'list files'
      }
      if (modifiers.includes('all') && modifiers.includes('long')) {
        intent.description = 'list files: all with details'
      }
      break
    }

    case 'cat': {
      intent.action = 'read'
      intent.objectType = 'file'
      if (paths.length === 1) {
        intent.object = 'file'
        intent.target = paths[0]
        intent.description = `read file ${paths[0]}`
      } else if (paths.length > 1) {
        intent.object = 'files'
        intent.targets = paths
        intent.description = `read files ${paths.join(', ')}`
      } else {
        intent.object = 'stdin'
        intent.description = 'read from stdin'
      }
      break
    }

    case 'head':
    case 'tail':
    case 'less':
    case 'more': {
      intent.action = 'read'
      intent.object = 'file'
      intent.objectType = 'file'
      if (paths.length > 0) {
        intent.target = paths[0]
        intent.description = `read file ${paths[0]}`
      }
      break
    }

    case 'pwd': {
      intent.action = 'show'
      intent.object = 'working directory'
      intent.description = 'show working directory'
      break
    }

    case 'echo':
    case 'printf': {
      intent.action = 'print'
      intent.object = 'text'
      intent.description = 'print text'
      break
    }

    case 'rm': {
      intent.action = 'delete'
      intent.objectType = 'file'
      if (paths.length > 0) {
        intent.target = paths[0]
        // Detect directory from -r flag or trailing slash
        if (modifiers.includes('recursive') || paths[0].endsWith('/')) {
          intent.object = 'directory'
          if (modifiers.includes('recursive') && modifiers.includes('force')) {
            intent.description = `recursively delete directory ${paths[0]}`
          } else {
            intent.description = `delete directory ${paths[0]}`
          }
        } else {
          intent.object = 'file'
          intent.description = `delete file ${paths[0]}`
        }
      }
      break
    }

    case 'rmdir': {
      intent.action = 'delete'
      intent.object = 'directory'
      intent.objectType = 'directory'
      if (paths.length > 0) {
        intent.target = paths[0]
        intent.description = `delete directory ${paths[0]}`
      }
      break
    }

    case 'mkdir': {
      intent.action = 'create'
      intent.object = 'directory'
      intent.objectType = 'directory'
      if (paths.length > 0) {
        intent.target = paths[0]
        intent.description = `create directory ${paths[0]}`
      }
      break
    }

    case 'touch': {
      intent.action = 'create'
      intent.object = 'file'
      intent.objectType = 'file'
      if (paths.length > 0) {
        intent.target = paths[0]
        intent.description = `create file ${paths[0]}`
      }
      break
    }

    case 'cp': {
      intent.action = 'copy'
      intent.object = 'file'
      intent.objectType = 'file'
      if (paths.length >= 2) {
        intent.source = paths[0]
        intent.target = paths[paths.length - 1]
        intent.description = `copy file from ${paths[0]} to ${paths[paths.length - 1]}`
      }
      break
    }

    case 'mv': {
      intent.action = 'move'
      intent.object = 'file'
      intent.objectType = 'file'
      if (paths.length >= 2) {
        intent.source = paths[0]
        intent.target = paths[paths.length - 1]
        intent.description = `move file from ${paths[0]} to ${paths[paths.length - 1]}`
      }
      break
    }

    case 'chmod': {
      intent.action = 'modify'
      intent.object = 'permissions'
      intent.objectType = 'file'
      if (paths.length > 0) {
        intent.target = paths[paths.length - 1]
        intent.description = `modify permissions of ${paths[paths.length - 1]}`
      }
      break
    }

    case 'chown':
    case 'chgrp': {
      intent.action = 'modify'
      intent.object = 'ownership'
      intent.objectType = 'file'
      if (paths.length > 0) {
        intent.target = paths[paths.length - 1]
        intent.description = `modify ownership of ${paths[paths.length - 1]}`
      }
      break
    }

    case 'find': {
      intent.action = 'find'
      intent.objectType = 'file'

      // Extract search path (first non-flag argument)
      intent.searchPath = paths[0] || '.'

      // Extract -name pattern
      const nameIdx = args.indexOf('-name')
      if (nameIdx !== -1 && args[nameIdx + 1]) {
        const pattern = args[nameIdx + 1].replace(/^["']|["']$/g, '')
        intent.pattern = pattern
        intent.object = getFileTypeDescription(pattern)
      } else {
        intent.object = 'files'
      }

      // Check for -exec with delete
      const execIdx = args.indexOf('-exec')
      if (execIdx !== -1) {
        const execCmd = args[execIdx + 1]
        if (execCmd === 'rm') {
          intent.action = 'find and delete'
          intent.description = `find and delete ${intent.object}`
        }
      }

      // Check for -delete flag
      if (args.includes('-delete')) {
        intent.action = 'delete'
        intent.actionType = 'delete'
      }

      // Check for -mtime
      const mtimeIdx = args.indexOf('-mtime')
      if (mtimeIdx !== -1 && args[mtimeIdx + 1]) {
        const mtimeVal = args[mtimeIdx + 1]
        if (mtimeVal.startsWith('+')) {
          const days = mtimeVal.slice(1)
          if (intent.modifiers) {
            intent.modifiers.push(`older than ${days} days`)
          }
          intent.object = 'old files'
        }
      }

      if (!intent.description) {
        if (intent.searchPath !== '.' && intent.searchPath !== './') {
          intent.description = `find ${intent.object} in ${intent.searchPath}`
        } else {
          intent.description = `find ${intent.object}`
        }
      }

      if (intent.action === 'delete' && intent.object === 'old files') {
        intent.description = `delete old files`
      }

      break
    }

    case 'grep': {
      intent.action = 'search'
      intent.object = 'pattern'
      intent.objectType = 'pattern'

      // Extract pattern (first non-flag argument)
      const nonFlags = args.filter(a => !a.startsWith('-'))
      if (nonFlags.length > 0) {
        intent.pattern = nonFlags[0].replace(/^["']|["']$/g, '')
      }
      if (nonFlags.length > 1) {
        intent.target = nonFlags[1]
      }

      if (modifiers.includes('recursive')) {
        intent.description = `recursively search for "${intent.pattern}" in ${intent.target || '.'}`
      } else if (modifiers.includes('case-insensitive')) {
        intent.description = `case-insensitive search for "${intent.pattern}" in ${intent.target || 'files'}`
      } else if (intent.target) {
        intent.description = `search for "${intent.pattern}" in ${intent.target}`
      } else {
        intent.description = `search for "${intent.pattern}"`
      }
      break
    }

    case 'git': {
      const subCommand = args[0]?.toLowerCase()

      switch (subCommand) {
        case 'status': {
          intent.action = 'show'
          intent.object = 'repository status'
          intent.description = 'show repository status'
          break
        }
        case 'commit': {
          intent.action = 'create'
          intent.object = 'commit'
          const mIdx = args.indexOf('-m')
          if (mIdx !== -1 && args[mIdx + 1]) {
            intent.message = args[mIdx + 1].replace(/^["']|["']$/g, '')
            intent.description = `create commit with message "${intent.message}"`
          } else {
            intent.description = 'create commit'
          }
          break
        }
        case 'push': {
          intent.action = 'push'
          intent.object = 'commits'
          intent.actionType = 'network'
          if (args[1]) intent.remote = args[1]
          if (args[2]) intent.branch = args[2]
          if (intent.remote && intent.branch) {
            intent.description = `push commits to ${intent.remote}/${intent.branch}`
          } else {
            intent.description = 'push commits'
          }
          break
        }
        case 'pull': {
          intent.action = 'pull'
          intent.object = 'changes'
          intent.actionType = 'network'
          if (args[1]) intent.remote = args[1]
          if (args[2]) intent.branch = args[2]
          if (intent.remote && intent.branch) {
            intent.description = `pull changes from ${intent.remote}/${intent.branch}`
          } else {
            intent.description = 'pull changes'
          }
          break
        }
        case 'checkout': {
          intent.action = 'switch'
          intent.object = 'branch'
          if (args[1]) {
            intent.target = args[1]
            intent.description = `switch to branch ${args[1]}`
          } else {
            intent.description = 'switch branch'
          }
          break
        }
        default: {
          intent.action = subCommand || 'git'
          intent.object = 'repository'
          intent.description = `git ${subCommand || ''}`
        }
      }
      break
    }

    case 'curl': {
      intent.action = 'fetch'
      intent.object = 'URL'
      intent.objectType = 'url'
      intent.method = 'GET'

      // Check for explicit method
      const xIdx = args.findIndex(a => a === '-X' || a === '--request')
      if (xIdx !== -1 && args[xIdx + 1]) {
        intent.method = args[xIdx + 1].toUpperCase()
        if (intent.method === 'POST' || intent.method === 'PUT' || intent.method === 'PATCH') {
          intent.action = 'send'
        }
      }

      // Extract URL (first non-flag argument that looks like a URL)
      for (const arg of args) {
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
          intent.url = arg
          break
        }
      }

      if (intent.action === 'send') {
        intent.description = `send ${intent.method} request to ${intent.url || 'URL'}`
      } else {
        intent.description = `fetch data from ${intent.url || 'URL'}`
      }
      break
    }

    case 'wget': {
      intent.action = 'download'
      intent.object = 'file'
      intent.objectType = 'url'

      // Extract URL
      for (const arg of args) {
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
          intent.url = arg
          break
        }
      }

      intent.description = `download file from ${intent.url || 'URL'}`
      break
    }

    case 'ssh': {
      intent.action = 'connect'
      intent.object = 'remote server'
      intent.objectType = 'url'

      // Get target (user@host)
      const target = paths[0]
      if (target) {
        intent.target = target
        intent.description = `connect to remote server ${target}`
      } else {
        intent.description = 'connect to remote server'
      }
      break
    }

    case 'scp': {
      intent.action = 'copy'
      intent.object = 'file'
      intent.objectType = 'file'
      intent.actionType = 'network'
      intent.description = 'copy file over SSH'
      break
    }

    case 'rsync': {
      intent.action = 'sync'
      intent.object = 'files'
      intent.objectType = 'file'
      if (paths.length >= 2) {
        intent.source = paths[0]
        intent.target = paths[1]
        intent.description = `sync files from ${paths[0]} to ${paths[1]}`
      }
      break
    }

    case 'kill':
    case 'killall':
    case 'pkill': {
      intent.action = 'terminate'
      intent.object = 'process'
      intent.objectType = 'process'
      if (paths.length > 0) {
        intent.target = paths[0]
      }
      intent.description = `terminate process`
      break
    }

    case 'cd': {
      intent.action = 'change'
      intent.object = 'directory'
      intent.objectType = 'directory'
      if (paths.length > 0) {
        intent.target = paths[0]
        intent.description = `change to directory ${paths[0]}`
      }
      break
    }

    case 'test': {
      intent.action = 'test'
      intent.object = 'condition'
      intent.description = 'test condition'
      break
    }

    case 'sort': {
      intent.action = 'sort'
      intent.object = 'lines'
      intent.description = 'sort lines'
      break
    }

    case 'uniq': {
      intent.action = 'filter'
      intent.object = 'unique lines'
      intent.description = 'filter unique lines'
      break
    }

    case 'wc': {
      intent.action = 'count'
      intent.object = 'lines'
      intent.description = 'count lines'
      break
    }

    case 'jq': {
      intent.action = 'parse'
      intent.object = 'JSON'
      intent.description = 'parse JSON data'
      break
    }

    default: {
      intent.action = name
      intent.object = paths[0] || 'output'
      intent.description = `${name}${paths.length > 0 ? ' ' + paths[0] : ''}`
    }
  }

  return intent
}

/**
 * Extract intent from pipeline
 */
function extractPipelineIntent(pipeline: Pipeline): PartialExtendedIntent {
  const commands = pipeline.commands.map((cmd: Command) => ({
    name: getCommandName(cmd.name),
    args: getArgs(cmd.args),
    intent: extractCommandIntent(cmd),
  }))

  const commandNames = commands.map((c: { name: string }) => c.name)
  const firstCmd = commands[0]
  const lastCmd = commands[commands.length - 1]

  // Determine overall action based on pipeline structure
  let action = firstCmd.intent.action || firstCmd.name
  let description = ''

  // Common patterns
  if (commandNames.includes('grep')) {
    const grepIdx = commandNames.indexOf('grep')
    const grepCmd = commands[grepIdx]
    const pattern = grepCmd.intent.pattern

    if (commandNames.includes('wc')) {
      action = 'count'
      description = `count lines matching "${pattern}"`
      if (firstCmd.name === 'cat' && firstCmd.intent.target) {
        description = `count "${pattern}" lines in ${firstCmd.intent.target}`
      }
    } else {
      action = 'filter'
      if (firstCmd.name === 'cat' && firstCmd.intent.target) {
        description = `filter "${pattern}" from ${firstCmd.intent.target}`
      } else {
        description = `filter for pattern "${pattern}"`
      }
    }
  } else if (commandNames.includes('sort') && commandNames.includes('uniq')) {
    action = 'sort and deduplicate'
    description = 'sort and get unique lines'
    if (firstCmd.intent.target) {
      description = `sort ${firstCmd.intent.target} and get unique lines`
    }
  }

  // Get reads/writes from pipeline
  const reads: string[] = []
  const writes: string[] = []

  // First command reads
  if (firstCmd.intent.target) {
    reads.push(firstCmd.intent.target)
  }

  // Last command redirects write
  const lastCmdAst = pipeline.commands[pipeline.commands.length - 1]
  for (const redirect of lastCmdAst.redirects) {
    if (redirect.op === '>' || redirect.op === '>>') {
      writes.push(redirect.target.value)
    }
  }

  return {
    action,
    description: description || `${action} via pipeline`,
    commands: commandNames,
    modifiers: firstCmd.intent.modifiers || [],
    actionType: lastCmd.intent.actionType || 'read',
    reads,
    writes,
  }
}

/**
 * Extract intent from List (&&, ||)
 */
function extractListIntent(list: List): PartialExtendedIntent {
  const leftIntent = extractNodeIntent(list.left)
  const rightIntent = extractNodeIntent(list.right)

  const commands = [
    ...(leftIntent.commands || []),
    ...(rightIntent.commands || []),
  ]

  let description = ''

  if (list.operator === '&&') {
    // Sequential execution
    if (leftIntent.action === 'create' && rightIntent.action === 'change') {
      description = `create directory and change into it`
    } else if (leftIntent.action === 'test' && rightIntent.action === 'create') {
      description = `create ${rightIntent.object} if not exists`
    } else {
      description = `${leftIntent.description || leftIntent.action} then ${rightIntent.description || rightIntent.action}`
    }
  } else if (list.operator === '||') {
    // Conditional execution
    if (leftIntent.action === 'test') {
      description = `${rightIntent.description || rightIntent.action} if not exists`
    } else {
      description = `${leftIntent.description || leftIntent.action} or ${rightIntent.description || rightIntent.action}`
    }
  }

  return {
    action: leftIntent.action,
    object: leftIntent.object,
    description,
    commands,
    reads: [...(leftIntent.reads || []), ...(rightIntent.reads || [])],
    writes: [...(leftIntent.writes || []), ...(rightIntent.writes || [])],
    deletes: [...(leftIntent.deletes || []), ...(rightIntent.deletes || [])],
    modifiers: [...(leftIntent.modifiers || []), ...(rightIntent.modifiers || [])],
    actionType: rightIntent.actionType || leftIntent.actionType || 'execute',
    network: leftIntent.network || rightIntent.network,
    elevated: leftIntent.elevated || rightIntent.elevated,
  }
}

/**
 * Extract intent from any AST node
 */
function extractNodeIntent(node: BashNode): PartialExtendedIntent {
  switch (node.type) {
    case 'Command':
      return extractCommandIntent(node)
    case 'Pipeline':
      return extractPipelineIntent(node)
    case 'List':
      return extractListIntent(node)
    default:
      return {
        action: 'execute',
        object: 'command',
        description: 'execute command',
        modifiers: [],
        actionType: 'execute',
      }
  }
}

/**
 * Extract intent from a parsed AST Program
 *
 * @param ast - The parsed Program AST
 * @returns Extended intent with semantic information
 */
export function extractIntentFromAST(ast: Program): ExtendedIntent {
  // Get all commands for basic intent
  const allCommands = extractAllCommands(ast)
  const basicIntent = extractIntent(allCommands)

  // Get semantic intent from first statement
  const firstNode = ast.body[0]
  let semanticIntent: PartialExtendedIntent = {
    action: 'execute',
    object: 'command',
    description: 'execute command',
    modifiers: [],
    actionType: 'read',
  }

  if (firstNode) {
    semanticIntent = extractNodeIntent(firstNode)

    // Aggregate from all nodes for compound commands
    if (ast.body.length > 1) {
      for (let i = 1; i < ast.body.length; i++) {
        const nodeIntent = extractNodeIntent(ast.body[i])
        semanticIntent.commands = [
          ...(semanticIntent.commands || []),
          ...(nodeIntent.commands || []),
        ]
      }
    }
  }

  // Merge basic and semantic intent
  return {
    ...basicIntent,
    action: semanticIntent.action || 'execute',
    object: semanticIntent.object || 'command',
    description: semanticIntent.description || 'execute command',
    target: semanticIntent.target,
    targets: semanticIntent.targets,
    source: semanticIntent.source,
    searchPath: semanticIntent.searchPath,
    pattern: semanticIntent.pattern,
    message: semanticIntent.message,
    url: semanticIntent.url,
    method: semanticIntent.method,
    remote: semanticIntent.remote,
    branch: semanticIntent.branch,
    modifiers: semanticIntent.modifiers || [],
    actionType: semanticIntent.actionType || 'read',
    objectType: semanticIntent.objectType,
    // Override with aggregated values from semantic analysis
    commands: semanticIntent.commands?.length ? semanticIntent.commands : basicIntent.commands,
    reads: semanticIntent.reads?.length ? semanticIntent.reads : basicIntent.reads,
    writes: semanticIntent.writes?.length ? semanticIntent.writes : basicIntent.writes,
  }
}

/**
 * Generate a human-readable description from an Intent object
 *
 * @param intent - The Intent to describe
 * @returns Human-readable description string
 */
export function describeIntent(intent: Intent): string {
  const parts: string[] = []

  // Describe elevated operations
  if (intent.elevated) {
    parts.push('(elevated/privileged)')
  }

  // Detect move operation: when reads, writes, and deletes overlap (source is read, deleted, dest is written)
  const isMoveOperation = intent.commands.includes('mv') ||
    (intent.writes.length > 0 && intent.reads.length > 0 &&
     intent.deletes.length > 0 && intent.reads.some((r: string) => intent.deletes.includes(r)))

  // Describe main operation
  if (isMoveOperation && intent.reads.length > 0 && intent.writes.length > 0) {
    // Move operation
    parts.push(`move ${intent.reads[0]} to ${intent.writes[0]}`)
  } else if (intent.deletes.length > 0) {
    parts.push(`delete ${intent.deletes.join(', ')}`)
  } else if (intent.writes.length > 0) {
    parts.push(`write to ${intent.writes.join(', ')}`)
  } else if (intent.reads.length > 0) {
    parts.push(`read ${intent.reads.join(', ')}`)
  }

  // Describe network operations
  if (intent.network) {
    if (intent.commands.includes('curl')) {
      parts.push('fetch from network')
    } else if (intent.commands.includes('wget')) {
      parts.push('download from network')
    } else {
      parts.push('perform network operation')
    }
  }

  // Fallback to command names
  if (parts.length === 0 && intent.commands.length > 0) {
    parts.push(`execute ${intent.commands.join(', ')}`)
  }

  return parts.join('; ')
}

/**
 * Extract intent from commands
 */
export function extractIntent(commands: Command[]): Intent {
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
