/**
 * withBash Mixin - Shell Execution Capability
 *
 * Adds $.bash to the WorkflowContext with shell operations:
 * - Tagged template execution: $.bash`command`
 * - exec, run, spawn methods
 * - parse, analyze, isDangerous utilities
 *
 * @example
 * ```typescript
 * import { withBash } from 'dotdo/mixins'
 * import { withFs } from 'dotdo/mixins'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with executor
 * class MyDO extends withBash(DO, {
 *   executor: () => ({
 *     execute: async (cmd, opts) => {
 *       // Execute via Containers, RPC, etc.
 *       return await containerExecutor.run(cmd, opts)
 *     }
 *   })
 * }) {
 *   async deploy() {
 *     const result = await this.$.bash.exec('npm', ['run', 'build'])
 *     return result.exitCode === 0
 *   }
 * }
 *
 * // With FsCapability integration for native file ops
 * class MyDO extends withBash(withFs(DO), {
 *   executor: () => containerExecutor,
 *   fs: (instance) => instance.$.fs  // 'cat' uses $.fs.read() natively
 * }) {
 *   async readConfig() {
 *     // 'cat config.json' uses $.fs.read() - Tier 1, fast!
 *     const result = await this.$.bash.exec('cat', ['config.json'])
 *     return result.stdout
 *   }
 * }
 * ```
 *
 * @module dotdo/mixins/bash
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'
import type { WithFsContext, FsCapability } from './fs'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Safety classification for a bash command.
 */
export interface SafetyClassification {
  type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system' | 'mixed'
  impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
  reversible: boolean
  reason: string
}

/**
 * Intent extracted from command analysis.
 */
export interface Intent {
  commands: string[]
  reads: string[]
  writes: string[]
  deletes: string[]
  network: boolean
  elevated: boolean
}

/**
 * Execution options for bash commands.
 */
export interface ExecOptions {
  timeout?: number
  cwd?: string
  env?: Record<string, string>
  confirm?: boolean
  dryRun?: boolean
  elevated?: boolean
  stdin?: string
  maxOutputSize?: number
}

/**
 * Spawn options extend exec options with streaming callbacks.
 */
export interface SpawnOptions extends ExecOptions {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onExit?: (exitCode: number) => void
}

/**
 * Handle for a spawned process.
 */
export interface SpawnHandle {
  pid: number
  done: Promise<BashResult>
  kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): void
  write(data: string): void
  closeStdin(): void
}

/**
 * Result from bash command execution.
 */
export interface BashResult {
  input: string
  command: string
  valid: boolean
  generated: boolean
  stdout: string
  stderr: string
  exitCode: number
  intent: Intent
  classification: SafetyClassification
  blocked?: boolean
  requiresConfirm?: boolean
  blockReason?: string
}

/**
 * AST node types for parsed commands.
 */
export interface Program {
  type: 'Program'
  body: ASTNode[]
  errors?: ParseError[]
}

export interface ASTNode {
  type: string
  [key: string]: unknown
}

export interface ParseError {
  message: string
  line: number
  column: number
  suggestion?: string
}

/**
 * Interface for external command executors.
 */
export interface BashExecutor {
  execute(command: string, options?: ExecOptions): Promise<BashResult>
  spawn?(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
}

/**
 * Analysis result from analyze()
 */
export interface SafetyAnalysis {
  classification: SafetyClassification
  intent: Intent
}

/**
 * Danger check result from isDangerous()
 */
export interface DangerCheck {
  dangerous: boolean
  reason?: string
}

/**
 * Tagged template function type
 */
export type BashTaggedTemplate = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<BashResult>

/**
 * The full BashCapability interface - callable as tagged template AND has methods.
 */
export interface BashCapability extends BashTaggedTemplate {
  exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult>
  spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
  run(script: string, options?: ExecOptions): Promise<BashResult>
  parse(input: string): Program
  analyze(input: string): SafetyAnalysis
  isDangerous(input: string): DangerCheck
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithBashContext extends WorkflowContext {
  bash: BashCapability
}

export interface WithFsBashContext extends WithFsContext {
  bash: BashCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T

export interface WithBashDO<E extends Env = Env> extends DO<E> {
  $: WithBashContext
}

// ============================================================================
// WITHBASH CONFIG
// ============================================================================

export interface WithBashConfig<TBase> {
  executor: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => BashExecutor
  requireFs?: boolean
  fs?: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => FsCapability | undefined
  useNativeOps?: boolean
}

// ============================================================================
// NATIVE FS COMMANDS
// ============================================================================

const NATIVE_FS_COMMANDS = new Set(['cat', 'head', 'tail', 'ls', 'test'])

// ============================================================================
// DANGEROUS COMMAND PATTERNS
// ============================================================================

/**
 * Patterns that indicate critically dangerous commands.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[rfvdi]*\s+)*\/($|\s|[^\/])/, reason: 'Dangerous: rm targeting root directory is blocked' },
  { pattern: /\brm\s+(-[rfvdi]*\s+)*\/\*/, reason: 'Dangerous: rm targeting root directory contents is blocked' },
  { pattern: /\brm\s+(-[rfvdi]*\s+)*~\//, reason: 'Dangerous: rm targeting home directory is blocked' },
  { pattern: /\bchmod\s+[0-7]{3,4}\s+\/($|\s)/, reason: 'Dangerous: chmod on root directory is blocked' },
  { pattern: /\bchmod\s+-[rR]\s+[0-7]{3,4}\s+\//, reason: 'Dangerous: recursive chmod on root is blocked' },
  { pattern: /\bdd\s+.*\bof=\/dev\/[hs]d[a-z]/, reason: 'Dangerous: dd writing to disk device is blocked' },
  { pattern: /\bmkfs\b/, reason: 'Dangerous: filesystem formatting command is blocked' },
  { pattern: /\bshutdown\b/, reason: 'Dangerous: system shutdown command is blocked' },
  { pattern: /\breboot\b/, reason: 'Dangerous: system reboot command is blocked' },
  { pattern: /:\(\)\s*\{\s*:\|\:&\s*\}\s*;\s*:/, reason: 'Dangerous: fork bomb is blocked' },
  { pattern: /\bsudo\b.*\brm\s+-rf\s+\//, reason: 'Dangerous: sudo rm -rf / is blocked' },
]

/**
 * Commands that require network access.
 */
const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'netcat', 'telnet', 'ftp', 'sftp',
  'git push', 'git pull', 'git fetch', 'git clone', 'npm publish', 'pip upload',
])

/**
 * Commands that indicate elevated privileges.
 */
const ELEVATED_COMMANDS = new Set(['sudo', 'doas', 'su', 'pkexec'])

// ============================================================================
// SHELL ESCAPING
// ============================================================================

function escapeForShell(value: unknown): string {
  const str = String(value)

  if (str === '') {
    return "''"
  }

  if (/^[a-zA-Z0-9_\-./:=@]+$/.test(str)) {
    return str
  }

  return "'" + str.replace(/'/g, "'\"'\"'") + "'"
}

function buildEscapedCommand(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (values[i] !== undefined ? escapeForShell(values[i]) : ''),
    ''
  )
}

// ============================================================================
// LOCAL PARSING & ANALYSIS
// ============================================================================

/**
 * Simple parser for bash commands (returns basic AST structure).
 */
function parse(input: string): Program {
  // Extract command parts
  const trimmed = input.trim()
  const commands: string[] = []

  // Split on pipes and operators
  const parts = trimmed.split(/\s*(\||&&|\|\||;)\s*/)
  for (const part of parts) {
    const cmd = part.trim().split(/\s+/)[0]
    if (cmd && !['|', '&&', '||', ';'].includes(cmd)) {
      commands.push(cmd)
    }
  }

  return {
    type: 'Program',
    body: [{
      type: 'Command',
      name: commands[0] || '',
      commands,
      raw: trimmed,
    }],
  }
}

/**
 * Analyze a command for safety classification.
 */
function analyze(ast: Program): SafetyAnalysis {
  const raw = (ast.body[0] as { raw?: string })?.raw || ''
  const commands = (ast.body[0] as { commands?: string[] })?.commands || []

  // Determine type
  let type: SafetyClassification['type'] = 'read'
  let impact: SafetyClassification['impact'] = 'none'
  let reversible = true
  let reason = 'Command analyzed'

  // Extract info for intent
  const reads: string[] = []
  const writes: string[] = []
  const deletes: string[] = []
  let network = false
  let elevated = false

  // Check for elevated commands
  for (const cmd of commands) {
    if (ELEVATED_COMMANDS.has(cmd)) {
      elevated = true
    }
  }

  // Check for network commands
  for (const cmd of commands) {
    if (NETWORK_COMMANDS.has(cmd)) {
      network = true
      type = 'network'
    }
  }

  // Check for specific command types
  const firstCmd = commands[0]?.toLowerCase() || ''

  if (['ls', 'cat', 'head', 'tail', 'less', 'more', 'find', 'grep', 'wc', 'pwd', 'echo', 'date', 'whoami', 'id', 'env', 'printenv'].includes(firstCmd)) {
    type = 'read'
    impact = 'none'
    reason = 'Read-only command'
    // Extract read paths from arguments
    const match = raw.match(/\s+([\/~][\w\/.-]+)/g)
    if (match) {
      reads.push(...match.map(m => m.trim()))
    }
  } else if (['rm', 'rmdir', 'unlink'].includes(firstCmd)) {
    type = 'delete'
    reversible = false
    reason = 'Delete operation'

    // Check for recursive flag
    if (raw.includes('-r') || raw.includes('-R') || raw.includes('-rf') || raw.includes('-fr')) {
      impact = 'high'
      reason = 'Recursive delete operation'
    } else {
      impact = 'medium'
    }

    // Check for root path
    if (/\s+\/($|\s)/.test(raw) || raw.includes('/*')) {
      impact = 'critical'
      reason = 'Delete targeting root or all files'
    }

    // Extract delete paths
    const pathMatch = raw.match(/\s+([\/~\w][\w\/.-]*)/g)
    if (pathMatch) {
      deletes.push(...pathMatch.map(m => m.trim()).filter(p => !p.startsWith('-')))
    }
  } else if (['mv', 'cp', 'touch', 'mkdir', 'tee'].includes(firstCmd)) {
    type = 'write'
    impact = 'low'
    reversible = true
    reason = 'Write operation'

    // Extract write paths
    const pathMatch = raw.match(/\s+([\/~\w][\w\/.-]*)/g)
    if (pathMatch) {
      const paths = pathMatch.map(m => m.trim()).filter(p => !p.startsWith('-'))
      if (firstCmd === 'mv' || firstCmd === 'cp') {
        // Last path is destination
        if (paths.length >= 2) {
          reads.push(...paths.slice(0, -1))
          writes.push(paths[paths.length - 1])
        }
      } else {
        writes.push(...paths)
      }
    }
  } else if (['chmod', 'chown', 'chgrp'].includes(firstCmd)) {
    type = 'system'
    impact = 'medium'
    reversible = true
    reason = 'Permission/ownership change'

    if (raw.includes('-R') || raw.includes('-r')) {
      impact = 'high'
      reason = 'Recursive permission change'
    }

    if (/\s+\/($|\s)/.test(raw)) {
      impact = 'critical'
      reason = 'Permission change on root directory'
    }
  } else if (['curl', 'wget', 'ssh', 'scp', 'rsync'].includes(firstCmd)) {
    type = 'network'
    network = true
    impact = 'low'
    reversible = true
    reason = 'Network operation'

    if (raw.includes('-X POST') || raw.includes('--data') || raw.includes('-d ')) {
      impact = 'medium'
      reason = 'Network request with data'
    }
  } else if (['git'].includes(firstCmd)) {
    if (raw.includes('push')) {
      type = 'network'
      network = true
      impact = 'medium'
      reason = 'Git push operation'
    } else if (raw.includes('pull') || raw.includes('fetch') || raw.includes('clone')) {
      type = 'network'
      network = true
      impact = 'low'
      reason = 'Git network operation'
    } else {
      type = 'read'
      impact = 'none'
      reason = 'Git local operation'
    }
  } else if (['npm', 'yarn', 'pnpm'].includes(firstCmd)) {
    if (raw.includes('install') || raw.includes('add')) {
      type = 'write'
      impact = 'low'
      reason = 'Package installation'
    } else if (raw.includes('publish')) {
      type = 'network'
      network = true
      impact = 'high'
      reason = 'Package publish operation'
    } else {
      type = 'execute'
      impact = 'low'
      reason = 'Package manager operation'
    }
  } else if (['dd', 'mkfs', 'fdisk', 'parted'].includes(firstCmd)) {
    type = 'system'
    impact = 'critical'
    reversible = false
    reason = 'Low-level disk operation'
  } else if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(firstCmd)) {
    type = 'system'
    impact = 'critical'
    reversible = false
    reason = 'System shutdown/reboot'
  } else if (elevated) {
    type = 'system'
    impact = 'high'
    reason = 'Elevated privilege command'
  }

  // Check for dangerous patterns (strip quoted content first to avoid false positives)
  const unquotedForPatterns = stripQuotedContent(raw)
  for (const { pattern, reason: dangerReason } of DANGEROUS_PATTERNS) {
    if (pattern.test(unquotedForPatterns)) {
      impact = 'critical'
      reason = dangerReason
      reversible = false
      break
    }
  }

  return {
    classification: { type, impact, reversible, reason },
    intent: { commands, reads, writes, deletes, network, elevated },
  }
}

/**
 * Strip quoted content from a command for safety analysis.
 * This removes content within single/double quotes to avoid false positives
 * when dangerous patterns appear as literal strings (e.g., echo '; rm -rf /').
 */
function stripQuotedContent(cmd: string): string {
  // Replace single-quoted strings with placeholder
  let result = cmd.replace(/'[^']*'/g, "'QUOTED'")
  // Replace double-quoted strings with placeholder
  result = result.replace(/"[^"]*"/g, '"QUOTED"')
  return result
}

/**
 * Check if a command is dangerous.
 */
function isDangerous(ast: Program): DangerCheck {
  const raw = (ast.body[0] as { raw?: string })?.raw || ''

  // Strip quoted content before checking patterns
  // This prevents false positives when dangerous patterns appear as arguments
  const unquoted = stripQuotedContent(raw)

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(unquoted)) {
      return { dangerous: true, reason }
    }
  }

  const analysis = analyze(ast)
  if (analysis.classification.impact === 'critical') {
    return { dangerous: true, reason: analysis.classification.reason }
  }

  return { dangerous: false }
}

// ============================================================================
// BASH CAPABILITY IMPLEMENTATION
// ============================================================================

function createBashCapability(
  executor: BashExecutor,
  fsCapability?: FsCapability,
  useNativeOps: boolean = true
): BashCapability {
  function performSafetyAnalysis(command: string, options?: ExecOptions): BashResult | null {
    const ast = parse(command)
    const { classification, intent } = analyze(ast)
    const dangerCheck = isDangerous(ast)

    const requiresConfirm = classification.impact === 'critical' || classification.impact === 'high'

    if (requiresConfirm && !options?.confirm) {
      return createBlockedResult(command, classification, intent, dangerCheck.reason)
    }

    return null
  }

  function createBlockedResult(
    command: string,
    classification: SafetyClassification,
    intent: Intent,
    reason?: string
  ): BashResult {
    const blockReason = reason || classification.reason || 'Command blocked due to safety concerns'

    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      intent,
      classification,
      blocked: true,
      requiresConfirm: true,
      blockReason,
    }
  }

  function createNativeResult(
    command: string,
    stdout: string,
    stderr: string = '',
    exitCode: number = 0
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
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Native filesystem operation',
      },
    }
  }

  async function nativeCat(args: string[]): Promise<BashResult | null> {
    if (!fsCapability || args.length === 0) return null

    const files = args.filter((arg) => !arg.startsWith('-'))
    if (files.length === 0) return null

    try {
      const contents = await Promise.all(
        files.map((file) => fsCapability.read(file))
      )
      const stdout = contents.join('')
      return createNativeResult(`cat ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return createNativeResult(`cat ${args.join(' ')}`, '', stderr, 1)
    }
  }

  async function nativeLs(args: string[]): Promise<BashResult | null> {
    if (!fsCapability) return null

    const paths = args.filter((arg) => !arg.startsWith('-'))
    const path = paths[0] || '.'

    try {
      const entries = await fsCapability.list(path)
      const stdout = entries
        .map((e: any) => (e.isDirectory ? `${e.name}/` : e.name))
        .join('\n') + '\n'
      return createNativeResult(`ls ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return createNativeResult(`ls ${args.join(' ')}`, '', stderr, 1)
    }
  }

  async function nativeHead(args: string[]): Promise<BashResult | null> {
    if (!fsCapability) return null

    let lines = 10
    let file: string | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        lines = parseInt(args[i + 1], 10)
        i++
      } else if (/^-\d+$/.test(args[i])) {
        lines = parseInt(args[i].slice(1), 10)
      } else if (!args[i].startsWith('-')) {
        file = args[i]
      }
    }

    if (!file) return null

    try {
      const content = await fsCapability.read(file)
      const allLines = content.split('\n')
      const stdout = allLines.slice(0, lines).join('\n')
      return createNativeResult(`head ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return createNativeResult(`head ${args.join(' ')}`, '', stderr, 1)
    }
  }

  async function nativeTail(args: string[]): Promise<BashResult | null> {
    if (!fsCapability) return null

    let lines = 10
    let file: string | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        lines = parseInt(args[i + 1], 10)
        i++
      } else if (/^-\d+$/.test(args[i])) {
        lines = parseInt(args[i].slice(1), 10)
      } else if (!args[i].startsWith('-')) {
        file = args[i]
      }
    }

    if (!file) return null

    try {
      const content = await fsCapability.read(file)
      const allLines = content.split('\n')
      const effectiveLines = allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines
      const stdout = effectiveLines.slice(-lines).join('\n') + '\n'
      return createNativeResult(`tail ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return createNativeResult(`tail ${args.join(' ')}`, '', stderr, 1)
    }
  }

  async function tryNativeExec(command: string, args: string[]): Promise<BashResult | null> {
    if (!fsCapability || !useNativeOps) return null

    switch (command) {
      case 'cat':
        return nativeCat(args)
      case 'ls':
        return nativeLs(args)
      case 'head':
        return nativeHead(args)
      case 'tail':
        return nativeTail(args)
      default:
        return null
    }
  }

  async function exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command

    if (options?.dryRun) {
      const ast = parse(fullCommand)
      const { classification, intent } = analyze(ast)
      return {
        input: fullCommand,
        command: fullCommand,
        valid: true,
        generated: false,
        stdout: `[DRY RUN] Would execute: ${fullCommand}`,
        stderr: '',
        exitCode: 0,
        intent,
        classification,
      }
    }

    const safetyResult = performSafetyAnalysis(fullCommand, options)
    if (safetyResult) {
      return safetyResult
    }

    const ast = parse(fullCommand)
    const { classification, intent } = analyze(ast)

    if (useNativeOps && fsCapability && NATIVE_FS_COMMANDS.has(command)) {
      const nativeResult = await tryNativeExec(command, args || [])
      if (nativeResult) {
        return nativeResult
      }
    }

    const result = await executor.execute(fullCommand, options)

    // Always use our local analysis, overriding the executor's default classification
    // This ensures consistent behavior regardless of the executor implementation
    result.classification = classification
    result.intent = intent

    return result
  }

  async function spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    if (!executor.spawn) {
      throw new Error('Spawn not supported by this executor')
    }
    return executor.spawn(command, args, options)
  }

  async function run(script: string, options?: ExecOptions): Promise<BashResult> {
    const safetyResult = performSafetyAnalysis(script, options)
    if (safetyResult) {
      throw new Error(safetyResult.blockReason || 'Command blocked due to safety concerns')
    }

    const result = await executor.execute(script, options)

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Command failed with exit code ${result.exitCode}`)
    }

    return result
  }

  function bashParse(input: string): Program {
    return parse(input)
  }

  function bashAnalyze(input: string): SafetyAnalysis {
    const ast = parse(input)
    return analyze(ast)
  }

  function bashIsDangerous(input: string): DangerCheck {
    const ast = parse(input)
    return isDangerous(ast)
  }

  /**
   * Handle output redirection natively using fs capability.
   * Matches patterns like: echo "content" > /path/to/file
   * Returns null if no redirection or fs not available.
   */
  async function handleNativeRedirection(command: string): Promise<BashResult | null> {
    if (!fsCapability || !useNativeOps) return null

    // Match echo "content" > /path or echo 'content' > /path
    const redirectMatch = command.match(/^echo\s+["'](.*)["']\s*>\s*(.+)$/)
    if (redirectMatch) {
      const content = redirectMatch[1]
      const filePath = redirectMatch[2].trim()

      try {
        await fsCapability.write(filePath, content)
        return {
          input: command,
          command,
          valid: true,
          generated: false,
          stdout: '',
          stderr: '',
          exitCode: 0,
          intent: {
            commands: ['echo'],
            reads: [],
            writes: [filePath],
            deletes: [],
            network: false,
            elevated: false,
          },
          classification: {
            type: 'write',
            impact: 'low',
            reversible: true,
            reason: 'Native filesystem write via redirection',
          },
        }
      } catch (error) {
        const stderr = error instanceof Error ? error.message : String(error)
        return {
          input: command,
          command,
          valid: true,
          generated: false,
          stdout: '',
          stderr,
          exitCode: 1,
          intent: {
            commands: ['echo'],
            reads: [],
            writes: [filePath],
            deletes: [],
            network: false,
            elevated: false,
          },
          classification: {
            type: 'write',
            impact: 'low',
            reversible: true,
            reason: 'Native filesystem write failed',
          },
        }
      }
    }

    return null
  }

  const taggedTemplate: BashTaggedTemplate = async function (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<BashResult> {
    const command = buildEscapedCommand(strings, values)

    const ast = parse(command)
    const dangerCheck = isDangerous(ast)
    const { classification, intent } = analyze(ast)

    if (dangerCheck.dangerous) {
      throw new Error(dangerCheck.reason || 'Dangerous command blocked')
    }

    if (classification.impact === 'critical' || classification.impact === 'high') {
      throw new Error(classification.reason || 'Critical/high impact command blocked')
    }

    // Try native redirection handling first
    const nativeRedirectResult = await handleNativeRedirection(command)
    if (nativeRedirectResult) {
      return nativeRedirectResult
    }

    // Pass empty object when no options to satisfy expect.anything() in tests
    const result = await executor.execute(command, {})

    // Always use our local analysis for consistency
    result.classification = classification
    result.intent = intent

    return result
  }

  const capability = taggedTemplate as BashCapability

  capability.exec = exec
  capability.spawn = spawn
  capability.run = run
  capability.parse = bashParse
  capability.analyze = bashAnalyze
  capability.isDangerous = bashIsDangerous

  return capability
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

const BASH_CAPABILITY_CACHE = Symbol('bashCapabilityCache')

export function withBash<TBase extends Constructor<{ $: WorkflowContext }>>(
  Base: TBase,
  config: WithBashConfig<TBase>
) {
  return class WithBash extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'bash']

    hasCapability(name: string): boolean {
      if (name === 'bash') return true
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    private [BASH_CAPABILITY_CACHE]?: BashCapability

    private get bashCapability(): BashCapability {
      if (!this[BASH_CAPABILITY_CACHE]) {
        const executor = config.executor(this as unknown as InstanceType<TBase>)
        const fs = config.fs?.(this as unknown as InstanceType<TBase>)

        this[BASH_CAPABILITY_CACHE] = createBashCapability(
          executor,
          fs,
          config.useNativeOps ?? true
        )
      }
      return this[BASH_CAPABILITY_CACHE]
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      if (config.requireFs) {
        const hasFs = (Base as any).capabilities?.includes('fs') ||
                      (this as any).hasCapability?.('fs')
        if (!hasFs) {
          throw new Error('withBash requires withFs capability when requireFs is true. Apply withFs(Base) first.')
        }
      }

      const originalContext = this.$
      const self = this

      this.$ = new Proxy(originalContext as WithBashContext, {
        get(target, prop: string | symbol) {
          if (prop === 'bash') {
            return self.bashCapability
          }
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            // Only bind if it has a bind method (not a Proxy or capability object)
            if (typeof value.bind === 'function') {
              // Don't bind capability functions that have custom properties
              const customProps = Object.getOwnPropertyNames(value).filter(
                (p) => p !== 'length' && p !== 'name' && p !== 'prototype'
              )
              if (customProps.length > 0) {
                return value
              }
              return value.bind(target)
            }
          }
          return value
        },
      })
    }
  }
}

// ============================================================================
// LEGACY EXPORTS (for backward compatibility)
// ============================================================================

/** @deprecated Use createBashCapability instead */
export class BashModule {
  private capability: BashCapability

  constructor(executor: BashExecutor, options?: { fs?: FsCapability; useNativeOps?: boolean }) {
    this.capability = createBashCapability(executor, options?.fs, options?.useNativeOps ?? true)
  }

  async exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult> {
    return this.capability.exec(command, args, options)
  }

  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    return this.capability.spawn(command, args, options)
  }

  async run(script: string, options?: ExecOptions): Promise<BashResult> {
    return this.capability.run(script, options)
  }

  parse(input: string): Program {
    return this.capability.parse(input)
  }

  analyze(input: string): SafetyAnalysis {
    return this.capability.analyze(input)
  }

  isDangerous(input: string): DangerCheck {
    return this.capability.isDangerous(input)
  }
}
