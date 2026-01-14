/**
 * Command Execution with Safety Gate
 *
 * Implements the execute() function that:
 * 1. Parses and validates commands
 * 2. Classifies commands for safety
 * 3. Applies safety gate rules
 * 4. Executes the command if allowed
 * 5. Handles timeout
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type {
  BashResult,
  ExecOptions,
  Intent,
  SafetyClassification,
  Program,
  Command,
  Pipeline,
  List,
  BashNode,
  Word,
} from './types.js'
import { analyze, classifyCommand } from './ast/analyze.js'
import {
  trackForUndo,
  recordUndoEntry,
  isReversible,
  type UndoEntry,
} from './undo.js'

const execAsync = promisify(exec)

/**
 * Extended result type for execute function
 */
export interface ExecuteResult extends BashResult {
  /** Whether the command timed out */
  timedOut?: boolean
  /** Whether the command was run in dry-run mode */
  dryRun?: boolean
}

// ============================================================================
// Simple Parser (lightweight, no tree-sitter dependency)
// ============================================================================

/**
 * Parse a command string into a simple AST structure
 * This is a lightweight parser for safety analysis without tree-sitter dependency
 */
function parseCommand(input: string): { ast: Program; valid: boolean; errors?: Array<{ message: string; line: number; column: number }> } {
  const trimmed = input.trim()

  // Empty or whitespace-only
  if (!trimmed) {
    return {
      ast: { type: 'Program', body: [] },
      valid: false,
      errors: [{ message: 'Empty command', line: 1, column: 1 }],
    }
  }

  // Check for unclosed quotes
  const singleQuotes = (trimmed.match(/'/g) || []).length
  const doubleQuotes = (trimmed.match(/"/g) || []).length

  // Check for balanced quotes (odd number means unclosed)
  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
    return {
      ast: { type: 'Program', body: [] },
      valid: false,
      errors: [{ message: 'Unclosed quote', line: 1, column: 1 }],
    }
  }

  // Parse the command into AST nodes
  const body = parseCommandList(trimmed)

  return {
    ast: { type: 'Program', body },
    valid: true,
  }
}

/**
 * Parse command list (handles ;, &&, ||, &)
 */
function parseCommandList(input: string): BashNode[] {
  const nodes: BashNode[] = []

  // Split by newlines first for multi-line scripts
  const lines = input.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'))

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    // Check for list operators (&&, ||, ;, &)
    const listMatch = splitByListOperators(trimmedLine)
    if (listMatch.length > 1) {
      let current = parseSimpleCommand(listMatch[0].cmd)
      for (let i = 1; i < listMatch.length; i++) {
        const next = parseSimpleCommand(listMatch[i].cmd)
        const op = listMatch[i].op as '&&' | '||' | ';' | '&'
        current = {
          type: 'List',
          operator: op,
          left: current,
          right: next,
        } as List
      }
      nodes.push(current)
    } else {
      // Check for pipeline
      const pipelineMatch = splitByPipe(trimmedLine)
      if (pipelineMatch.length > 1) {
        const commands = pipelineMatch.map(cmd => parseSimpleCommand(cmd))
        nodes.push({
          type: 'Pipeline',
          negated: false,
          commands: commands as Command[],
        } as Pipeline)
      } else {
        nodes.push(parseSimpleCommand(trimmedLine))
      }
    }
  }

  return nodes
}

/**
 * Split by list operators while respecting quotes
 */
function splitByListOperators(input: string): Array<{ cmd: string; op: string }> {
  const result: Array<{ cmd: string; op: string }> = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let i = 0

  while (i < input.length) {
    const char = input[i]
    const nextChar = input[i + 1]

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      i++
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      i++
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '&' && nextChar === '&') {
        result.push({ cmd: current.trim(), op: '' })
        current = ''
        result.push({ cmd: '', op: '&&' })
        i += 2
      } else if (char === '|' && nextChar === '|') {
        result.push({ cmd: current.trim(), op: '' })
        current = ''
        result.push({ cmd: '', op: '||' })
        i += 2
      } else if (char === ';') {
        result.push({ cmd: current.trim(), op: '' })
        current = ''
        result.push({ cmd: '', op: ';' })
        i++
      } else if (char === '&' && nextChar !== '&') {
        result.push({ cmd: current.trim(), op: '' })
        current = ''
        result.push({ cmd: '', op: '&' })
        i++
      } else {
        current += char
        i++
      }
    } else {
      current += char
      i++
    }
  }

  if (current.trim()) {
    if (result.length > 0 && result[result.length - 1].cmd === '') {
      result[result.length - 1].cmd = current.trim()
    } else {
      result.push({ cmd: current.trim(), op: '' })
    }
  }

  // Merge results properly
  const merged: Array<{ cmd: string; op: string }> = []
  for (let j = 0; j < result.length; j++) {
    if (result[j].cmd) {
      if (j + 1 < result.length && result[j + 1].op && !result[j + 1].cmd) {
        merged.push({ cmd: result[j].cmd, op: result[j + 1].op })
        j++
      } else {
        merged.push(result[j])
      }
    }
  }

  return merged.length > 0 ? merged : [{ cmd: input, op: '' }]
}

/**
 * Split by pipe while respecting quotes
 */
function splitByPipe(input: string): string[] {
  const result: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let inParens = 0

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const nextChar = input[i + 1]

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
    } else if (char === '(' && !inSingleQuote && !inDoubleQuote) {
      inParens++
      current += char
    } else if (char === ')' && !inSingleQuote && !inDoubleQuote) {
      inParens--
      current += char
    } else if (char === '|' && nextChar !== '|' && !inSingleQuote && !inDoubleQuote && inParens === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    result.push(current.trim())
  }

  return result
}

/**
 * Parse a simple command (no pipes or lists)
 */
function parseSimpleCommand(input: string): Command {
  const trimmed = input.trim()

  // Handle subshell $(...)
  if (trimmed.startsWith('$(') || trimmed.includes('$(')) {
    // Extract commands inside substitution
    const match = trimmed.match(/\$\(([^)]+)\)/)
    if (match) {
      // Parse inner command for analysis
      const innerParsed = parseSimpleCommand(match[1])
      // Return a command that includes the substitution
      return parseCommandParts(trimmed)
    }
  }

  return parseCommandParts(trimmed)
}

/**
 * Parse command into name and args
 */
function parseCommandParts(input: string): Command {
  const parts = tokenize(input)

  if (parts.length === 0) {
    return {
      type: 'Command',
      name: null,
      prefix: [],
      args: [],
      redirects: [],
    }
  }

  // Check for variable assignment
  const firstPart = parts[0]
  if (firstPart.includes('=') && !firstPart.startsWith('-')) {
    const [varName, ...rest] = firstPart.split('=')
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      // It's an assignment
      if (parts.length === 1) {
        // Just assignment, no command
        return {
          type: 'Command',
          name: null,
          prefix: [{
            type: 'Assignment',
            name: varName,
            value: rest.length > 0 ? { type: 'Word', value: rest.join('=') } : null,
            operator: '=',
          }],
          args: [],
          redirects: [],
        }
      }
    }
  }

  // Parse redirects
  const redirects: Array<{ type: 'Redirect'; op: '>' | '>>' | '<' | '<<' | '<<<' | '>&' | '<&' | '<>' | '>|'; target: Word }> = []
  const nonRedirectParts: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '>' || part === '>>' || part === '<' || part === '>|') {
      if (i + 1 < parts.length) {
        redirects.push({
          type: 'Redirect',
          op: part as any,
          target: { type: 'Word', value: parts[i + 1] },
        })
        i++ // Skip the target
      }
    } else if (part.startsWith('>')) {
      const target = part.slice(1)
      redirects.push({
        type: 'Redirect',
        op: '>',
        target: { type: 'Word', value: target },
      })
    } else if (part.startsWith('>>')) {
      const target = part.slice(2)
      redirects.push({
        type: 'Redirect',
        op: '>>',
        target: { type: 'Word', value: target },
      })
    } else {
      nonRedirectParts.push(part)
    }
  }

  const name = nonRedirectParts[0] || null
  const args = nonRedirectParts.slice(1)

  return {
    type: 'Command',
    name: name ? { type: 'Word', value: name } : null,
    prefix: [],
    args: args.map(arg => ({ type: 'Word', value: arg })),
    redirects: redirects as any,
  }
}

/**
 * Tokenize command respecting quotes
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      // Don't include quote in token for processing
      current += char
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
    } else if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(stripQuotes(current))
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(stripQuotes(current))
  }

  return tokens
}

/**
 * Strip outer quotes from a string
 */
function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1)
  }
  return s
}

// ============================================================================
// Safety Gate Logic
// ============================================================================

/**
 * Check if the command is purely echoing/printing a string
 */
function isSafeEchoOrPrint(command: string): boolean {
  const trimmed = command.trim()
  // Check if it's echo or printf with quoted content
  if (/^(echo|printf)\s+["']/.test(trimmed)) {
    return true
  }
  return false
}

/**
 * Check if a dangerous pattern is inside quotes (safe context)
 */
function isPatternInQuotes(command: string, pattern: RegExp): boolean {
  // If the pattern doesn't match at all, return false
  const match = command.match(pattern)
  if (!match) return false

  // Find where the pattern starts in the command
  const matchIndex = command.indexOf(match[0])
  if (matchIndex === -1) return false

  // Count quotes before the match
  const beforeMatch = command.substring(0, matchIndex)
  const doubleQuotes = (beforeMatch.match(/"/g) || []).length
  const singleQuotes = (beforeMatch.match(/'/g) || []).length

  // If we're inside quotes (odd number of quotes before), pattern is in a safe context
  return (doubleQuotes % 2 === 1) || (singleQuotes % 2 === 1)
}

/**
 * Critical patterns that should ALWAYS be blocked
 */
const CRITICAL_PATTERNS = [
  // Root filesystem deletion
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\/\s*$/,
  /rm\s+-rf\s+\/\*?\s*$/,
  /rm\s+-fr\s+\/\*?\s*$/,
  // Home directory deletion
  /rm\s+-rf\s+~\/?/,
  /rm\s+-fr\s+~\/?/,
  // Fork bomb
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/,
  // Disk overwrite
  /dd\s+.*of=\/dev\/[hs]d[a-z]/,
  /dd\s+.*of=\/dev\/nvme/,
  // Filesystem format
  /mkfs\.[a-z0-9]+\s+\/dev\//,
  // System control
  /shutdown\s+/,
  /reboot\s*/,
  /poweroff/,
  /halt/,
  // Root permission changes
  /chmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+\//,
  /chown\s+-R\s+.*\s+\//,
  // Pipeline to rm -rf (xargs rm -rf)
  /\|\s*xargs\s+rm\s+-rf/,
  /\|\s*xargs\s+rm\s+-fr/,
]

/**
 * Check for dangerous variable expansion patterns
 * e.g., cmd="rm -rf /"; $cmd
 */
function hasDangerousVariableExpansion(command: string): boolean {
  // Look for patterns like: var="dangerous"; $var
  // or var='dangerous'; $var
  // Pattern: variable assignment with dangerous content, followed by variable expansion

  // Check for variable assignment containing critical patterns
  const assignmentMatch = command.match(/([a-zA-Z_][a-zA-Z0-9_]*)=["']([^"']+)["']/g)
  if (!assignmentMatch) return false

  for (const assignment of assignmentMatch) {
    const valueMatch = assignment.match(/=["']([^"']+)["']/)
    if (valueMatch) {
      const value = valueMatch[1]
      // Check if the assigned value is dangerous
      for (const pattern of CRITICAL_PATTERNS) {
        if (pattern.test(value)) {
          // Now check if the variable is expanded later
          const varNameMatch = assignment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=/)
          if (varNameMatch) {
            const varName = varNameMatch[1]
            // Check for $varName or ${varName} later in the command
            if (new RegExp(`\\$${varName}\\b|\\$\\{${varName}\\}`).test(command)) {
              return true
            }
          }
        }
      }
      // Also check for general dangerous patterns
      if (/rm\s+-rf/.test(value) || /rm\s+-fr/.test(value)) {
        const varNameMatch = assignment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=/)
        if (varNameMatch) {
          const varName = varNameMatch[1]
          if (new RegExp(`\\$${varName}\\b|\\$\\{${varName}\\}`).test(command)) {
            return true
          }
        }
      }
    }
  }

  return false
}

/**
 * Check if a command matches any critical pattern
 */
function isCriticalCommand(command: string): { critical: boolean; reason?: string } {
  const normalized = command.trim()

  // If it's a safe echo command, never block as critical
  if (isSafeEchoOrPrint(command)) {
    return { critical: false }
  }

  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(normalized) && !isPatternInQuotes(normalized, pattern)) {
      return { critical: true, reason: 'Command matches critical safety pattern' }
    }
  }

  // Also check via AST analysis
  const { ast } = parseCommand(command)
  if (ast.body.length > 0) {
    const { classification } = analyze(ast)
    if (classification.impact === 'critical') {
      return { critical: true, reason: classification.reason }
    }
  }

  return { critical: false }
}

/**
 * Check if a command requires confirmation
 */
function requiresConfirmation(command: string, classification: SafetyClassification): boolean {
  // If it's a safe echo/print, don't require confirmation
  if (isSafeEchoOrPrint(command)) {
    return false
  }

  // Check for dangerous variable expansion
  if (hasDangerousVariableExpansion(command)) {
    return true
  }

  // Critical commands always blocked (not just requiring confirmation)
  if (classification.impact === 'critical') {
    return true
  }

  // High impact commands require confirmation
  if (classification.impact === 'high' || classification.impact === 'medium') {
    // Delete, write to system paths, network writes
    if (classification.type === 'delete' || classification.type === 'system') {
      return true
    }
    if (classification.type === 'network' && !classification.reversible) {
      return true
    }
    if (classification.type === 'write' && !classification.reversible) {
      return true
    }
    // mv command is medium impact write
    if (classification.type === 'write') {
      return true
    }
  }

  // Check for dangerous patterns - but only outside of quotes
  const dangerousPatterns = [
    { pattern: /\brm\b/, name: 'rm' },
    { pattern: /\bsudo\b/, name: 'sudo' },
    { pattern: /\bchmod\b/, name: 'chmod' },
    { pattern: /\bchown\b/, name: 'chown' },
    { pattern: /\bgit\s+push\b/, name: 'git push' },
    { pattern: /\bcurl\s+.*-X\s+(POST|PUT|DELETE|PATCH)\b/i, name: 'curl write' },
    { pattern: /\bmv\b/, name: 'mv' },
  ]

  for (const { pattern } of dangerousPatterns) {
    if (pattern.test(command) && !isPatternInQuotes(command, pattern)) {
      return true
    }
  }

  return false
}

/**
 * Extract intent from parsed AST
 */
function extractIntent(ast: Program): Intent {
  const { intent } = analyze(ast)
  return intent
}

// ============================================================================
// Main Execute Function
// ============================================================================

/**
 * Execute a bash command with safety gate
 *
 * @param command - The command to execute
 * @param options - Execution options
 * @returns Promise resolving to ExecuteResult
 */
export async function execute(command: string, options?: ExecOptions): Promise<ExecuteResult> {
  const timeout = options?.timeout ?? 30000
  const cwd = options?.cwd ?? process.cwd()
  const dryRun = options?.dryRun ?? false
  const confirm = options?.confirm ?? false

  // Parse the command
  const { ast, valid, errors } = parseCommand(command)

  // Handle invalid commands
  if (!valid) {
    return {
      input: command,
      valid: false,
      errors,
      intent: {
        commands: [],
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
        reason: 'Invalid command',
      },
      command,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
    }
  }

  // Analyze for safety
  const { classification, intent } = analyze(ast)

  // Check for critical commands - always blocked even with confirm
  const criticalCheck = isCriticalCommand(command)
  if (criticalCheck.critical || classification.impact === 'critical') {
    const reason = criticalCheck.reason || classification.reason || 'Critical command blocked for safety'

    // In dry run mode, still show classification but mark as critical
    if (dryRun) {
      return {
        input: command,
        valid: true,
        intent,
        classification: {
          ...classification,
          impact: 'critical',
        },
        command,
        generated: false,
        stdout: `[DRY RUN] Would execute: ${command}`,
        stderr: '',
        exitCode: 0,
        dryRun: true,
      }
    }

    return {
      input: command,
      valid: true,
      intent,
      classification: {
        ...classification,
        impact: 'critical',
      },
      command,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      blocked: true,
      requiresConfirm: true,
      blockReason: `Command blocked: critical impact - ${reason}`,
    }
  }

  // Check if confirmation is required
  const needsConfirm = requiresConfirmation(command, classification)

  // Dry run mode - return analysis without execution
  if (dryRun) {
    return {
      input: command,
      valid: true,
      intent,
      classification,
      command,
      generated: false,
      stdout: `[DRY RUN] Would execute: ${command}`,
      stderr: '',
      exitCode: 0,
      dryRun: true,
    }
  }

  // Block dangerous commands without confirmation
  if (needsConfirm && !confirm) {
    return {
      input: command,
      valid: true,
      intent,
      classification,
      command,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      blocked: true,
      requiresConfirm: true,
      blockReason: `Command requires confirmation: ${classification.reason}`,
    }
  }

  // Track for undo BEFORE execution (to capture original state)
  const undoInfo = trackForUndo(command, classification)

  // Determine reversibility based on undo tracking capability
  const commandIsReversible = undoInfo !== null || isReversible(command, classification)

  // Update classification with reversibility info
  const finalClassification: SafetyClassification = {
    ...classification,
    reversible: commandIsReversible,
  }

  // Execute the command
  try {
    const { stdout, stderr } = await Promise.race([
      execAsync(command, { cwd, timeout }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Command timed out')), timeout)
      ),
    ])

    // Record successful execution for undo
    if (undoInfo) {
      recordUndoEntry(command, undoInfo)
    }

    return {
      input: command,
      valid: true,
      intent,
      classification: finalClassification,
      command,
      generated: false,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
      undo: undoInfo?.undoCommand,
    }
  } catch (error: any) {
    // Handle timeout
    if (error.message === 'Command timed out' || error.killed) {
      return {
        input: command,
        valid: true,
        intent,
        classification: finalClassification,
        command,
        generated: false,
        stdout: '',
        stderr: 'Command timed out: timeout exceeded',
        exitCode: 124,
        timedOut: true,
      }
    }

    // Handle execution errors - don't record undo for failed commands
    return {
      input: command,
      valid: true,
      intent,
      classification: finalClassification,
      command,
      generated: false,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || 'Execution error',
      exitCode: error.code || 1,
    }
  }
}

export default execute
