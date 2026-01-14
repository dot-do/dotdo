/**
 * AST Safety Analysis
 *
 * Canonical implementation of safety classification and intent extraction.
 * This is the pure library version with zero platform dependencies.
 *
 * Analyzes parsed AST to extract safety classification and intent.
 * Implements structural safety analysis without regex-based detection.
 *
 * NOTE: src/ast/analyze.ts contains a parallel implementation with
 * platform-specific extensions for Cloudflare Workers. Both files import
 * command classification data from core/safety/command-sets.ts.
 *
 * @packageDocumentation
 */

import type {
  Program,
  CommandClassification,
  Intent,
  BashNode,
  Command,
  Word,
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
} from './command-sets.js'

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
    return normalized === '' || normalized === '/' || normalized === '/*' ||
           normalized === '~' || normalized === '~/' ||
           p === '/' ||
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
 * Classify a single command based on its name and arguments.
 *
 * Performs structural analysis to determine the command's operation type,
 * impact level, and reversibility. Handles special cases like sudo, git
 * subcommands, and recursive operations.
 *
 * @param commandName - The name of the command (e.g., 'rm', 'git', 'curl')
 * @param args - Array of command arguments
 * @returns Classification with type, impact, reversibility, and reason
 *
 * @example
 * ```typescript
 * classifyCommand('rm', ['-rf', '/'])
 * // { type: 'delete', impact: 'critical', reversible: false, reason: '...' }
 *
 * classifyCommand('ls', ['-la'])
 * // { type: 'read', impact: 'none', reversible: true, reason: '...' }
 * ```
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
    if (args.length > 0) {
      const subCommand = args[0]
      const subArgs = args.slice(1)
      const subClassification = classifyCommand(subCommand, subArgs)

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
    if (hasCriticalPath(paths) && (recursive || force)) {
      return {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: recursive ? 'Recursively deletes critical path' : 'Deletes critical path',
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
    reversible: redirect.op === '>>' ? true : false,
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

  const nonReadTypes = new Set<string>()

  for (const classification of classifications) {
    if (impactOrder.indexOf(classification.impact) > impactOrder.indexOf(maxImpact)) {
      maxImpact = classification.impact
      mainReason = classification.reason
    }

    if (classification.type !== 'read') {
      nonReadTypes.add(classification.type)
    }

    if (typeOrder.indexOf(classification.type) > typeOrder.indexOf(mainType)) {
      mainType = classification.type
    }

    if (!classification.reversible) {
      anyIrreversible = true
    }
  }

  const hasMultipleTypes = nonReadTypes.size > 1

  return {
    type: hasMultipleTypes ? 'mixed' : mainType,
    impact: maxImpact as CommandClassification['impact'],
    reversible: !anyIrreversible,
    reason: mainReason,
  }
}

// ============================================================================
// Intent Extraction
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
 * Extract semantic intent from an array of Command AST nodes.
 *
 * Analyzes commands to determine what files are read, written, or deleted,
 * whether network operations are performed, and if elevated privileges
 * are required.
 *
 * @param commands - Array of Command AST nodes to analyze
 * @returns Intent object describing the semantic actions
 *
 * @example
 * ```typescript
 * const commands = [createCommand('rm', ['-rf', 'node_modules'])]
 * const intent = extractIntent(commands)
 * // { commands: ['rm'], deletes: ['node_modules'], ... }
 * ```
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
      if (paths.length >= 2) {
        const sources = paths.slice(0, -1)
        const dest = paths[paths.length - 1]
        intent.reads.push(...sources)
        intent.writes.push(dest)
        intent.deletes.push(...sources)
      } else if (paths.length === 1) {
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

/**
 * Extract extended intent from a parsed AST Program node.
 *
 * Traverses the entire AST to extract all commands and builds an ExtendedIntent
 * with rich semantic information about the intended operations.
 *
 * @param ast - Parsed Program AST node
 * @returns ExtendedIntent with action, object, description, and semantic metadata
 */
export function extractIntentFromAST(ast: Program): ExtendedIntent {
  const allCommands = extractAllCommands(ast)
  const basicIntent = extractIntent(allCommands)

  return {
    ...basicIntent,
    action: 'execute',
    object: 'command',
    description: 'execute command',
    modifiers: [],
    actionType: 'read',
  }
}

/**
 * Generate a human-readable description from an Intent object.
 *
 * Creates a natural language summary of what the command intends to do,
 * suitable for display to users or for AI context.
 *
 * @param intent - Intent object to describe
 * @returns Human-readable description string
 *
 * @example
 * ```typescript
 * const intent = { commands: ['rm'], deletes: ['file.txt'], ... }
 * describeIntent(intent)  // => 'delete file.txt'
 *
 * const intent2 = { commands: ['mv'], reads: ['a.txt'], writes: ['b.txt'], ... }
 * describeIntent(intent2)  // => 'move a.txt to b.txt'
 * ```
 */
export function describeIntent(intent: Intent): string {
  const parts: string[] = []

  if (intent.elevated) {
    parts.push('(elevated/privileged)')
  }

  const isMoveOperation = intent.commands.includes('mv') ||
    (intent.writes.length > 0 && intent.reads.length > 0 &&
     intent.deletes.length > 0 && intent.reads.some(r => intent.deletes.includes(r)))

  if (isMoveOperation && intent.reads.length > 0 && intent.writes.length > 0) {
    parts.push(`move ${intent.reads[0]} to ${intent.writes[0]}`)
  } else if (intent.deletes.length > 0) {
    parts.push(`delete ${intent.deletes.join(', ')}`)
  } else if (intent.writes.length > 0) {
    parts.push(`write to ${intent.writes.join(', ')}`)
  } else if (intent.reads.length > 0) {
    parts.push(`read ${intent.reads.join(', ')}`)
  }

  if (intent.network) {
    if (intent.commands.includes('curl')) {
      parts.push('fetch from network')
    } else if (intent.commands.includes('wget')) {
      parts.push('download from network')
    } else {
      parts.push('perform network operation')
    }
  }

  if (parts.length === 0 && intent.commands.length > 0) {
    parts.push(`execute ${intent.commands.join(', ')}`)
  }

  return parts.join('; ')
}

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Analyze a parsed AST Program for safety classification and intent extraction.
 *
 * This is the main entry point for safety analysis. It extracts all commands
 * from the AST, classifies each one, combines the classifications, and
 * extracts the overall intent.
 *
 * @param ast - Parsed Program AST node
 * @returns Object containing combined classification and extracted intent
 *
 * @example
 * ```typescript
 * const ast = createProgram([createCommand('rm', ['-rf', 'temp'])])
 * const { classification, intent } = analyze(ast)
 * // classification: { type: 'delete', impact: 'high', reversible: false, ... }
 * // intent: { commands: ['rm'], deletes: ['temp'], ... }
 * ```
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

    classifications.push(classifyCommand(name, args))

    for (const redirect of cmd.redirects) {
      classifications.push(classifyRedirect(redirect))
    }
  }

  const classification = combineClassifications(classifications)
  const intent = extractIntent(commands)

  return { classification, intent }
}

/**
 * Check if a command is dangerous based on AST structure.
 *
 * A command is considered dangerous if its impact is 'critical' or if
 * it has 'high' impact and is irreversible.
 *
 * @param ast - Parsed Program AST node to check
 * @returns Object with `dangerous` boolean and optional `reason` explanation
 *
 * @example
 * ```typescript
 * const ast = createProgram([createCommand('rm', ['-rf', '/'])])
 * isDangerous(ast)  // => { dangerous: true, reason: 'Recursively deletes critical path' }
 *
 * const ast2 = createProgram([createCommand('ls', ['-la'])])
 * isDangerous(ast2)  // => { dangerous: false }
 * ```
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
