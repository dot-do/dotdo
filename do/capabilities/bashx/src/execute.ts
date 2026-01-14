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
  SafetyClassification,
  Program,
  Command,
  Pipeline,
  List,
  BashNode,
  Word,
} from './types.js'
import { analyze } from './ast/analyze.js'
import {
  trackForUndo,
  recordUndoEntry,
  isReversible,
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

/**
 * Error type for child_process exec errors.
 * Extends the standard Error with process-specific fields.
 *
 * @remarks
 * When child_process.exec() fails, it throws an Error with additional properties:
 * - `code`: The exit code of the process (number or undefined if killed)
 * - `killed`: Whether the process was terminated by a signal
 * - `stdout`: Standard output captured before the error occurred
 * - `stderr`: Standard error output
 */
export interface ExecError extends Error {
  /** Exit code from the process (undefined if process was killed by signal) */
  code?: number
  /** Whether the process was killed by a signal (e.g., SIGTERM, SIGKILL) */
  killed?: boolean
  /** Standard output captured before error (may be Buffer or string depending on encoding option) */
  stdout?: Buffer | string
  /** Standard error captured (may be Buffer or string depending on encoding option) */
  stderr?: Buffer | string
}

/**
 * Type guard to check if an error is an ExecError from child_process.
 *
 * An ExecError is an Error instance that has at least one of the exec-specific
 * properties (code, killed, stdout, stderr) with the correct type.
 *
 * @param error - The value to check
 * @returns True if the error is an ExecError with proper exec properties
 *
 * @example
 * ```typescript
 * try {
 *   await execAsync('invalid-command')
 * } catch (error) {
 *   if (isExecError(error)) {
 *     console.log(`Exit code: ${error.code}`)
 *     console.log(`Stderr: ${error.stderr}`)
 *   }
 * }
 * ```
 */
export function isExecError(error: unknown): error is ExecError {
  // Must be an Error instance
  if (!(error instanceof Error)) {
    return false
  }

  // Cast to check properties (Error + additional properties)
  const err = error as unknown as Record<string, unknown>

  // Check for at least one exec-specific property with correct type
  const hasValidCode = 'code' in err && (typeof err.code === 'number' || err.code === undefined)
  const hasValidKilled = 'killed' in err && typeof err.killed === 'boolean'
  const hasValidStdout = 'stdout' in err && (typeof err.stdout === 'string' || Buffer.isBuffer(err.stdout))
  const hasValidStderr = 'stderr' in err && (typeof err.stderr === 'string' || Buffer.isBuffer(err.stderr))

  // Must have at least one exec-specific property
  return hasValidCode || hasValidKilled || hasValidStdout || hasValidStderr
}

// ============================================================================
// Simple Parser (lightweight, no tree-sitter dependency)
// ============================================================================

/**
 * Quote state for tracking quote context during parsing
 */
type QuoteState = 'none' | 'single' | 'double'

/**
 * Result of quote validation
 */
interface QuoteValidationResult {
  valid: boolean
  error?: {
    message: string
    line: number
    column: number
  }
}

/**
 * Validates shell quotes using proper stateful parsing.
 *
 * This function handles:
 * - Nested quotes: `echo "it's a 'test'"` (single quotes inside double are literal)
 * - Escaped quotes: `echo "he said \"hello\""` (backslash escapes in double quotes)
 * - Mixed quotes: `echo 'single' "double"` (alternating quote types)
 * - POSIX escaping: `echo 'it'"'"'s'` (end quote, add escaped quote, restart)
 * - ANSI-C quoting: `echo $'hello\n'` ($'...' with escape sequences)
 * - Command substitution: `echo $(echo "hello")` (quotes reset in subshell)
 * - Parameter expansion: `echo ${VAR:-"default"}` (quotes inside ${...})
 *
 * POSIX Shell Quoting Rules:
 * - Single quotes preserve ALL characters literally (no escape sequences)
 * - Double quotes allow: $, `, \, !, " (only these are special)
 * - Backslash outside quotes escapes the next character
 * - $'...' allows C-style escape sequences
 *
 * @param input - The shell command string to validate
 * @returns Object with valid boolean and optional error details
 *
 * @example
 * ```typescript
 * validateQuotes('echo "hello"')           // { valid: true }
 * validateQuotes('echo "it\'s fine"')      // { valid: true } - single quote in double
 * validateQuotes('echo "unclosed')         // { valid: false, error: {...} }
 * validateQuotes('echo "say \\"hi\\""')    // { valid: true } - escaped quotes
 * ```
 */
function validateQuotes(input: string): QuoteValidationResult {
  let state: QuoteState = 'none'
  let quoteStartLine = 1
  let quoteStartColumn = 1
  let line = 1
  let column = 1

  // Stack for tracking nested structures like $() and ${}
  // Each entry contains: type ('subst' | 'param' | 'arith'), saved state, and quote state within the structure
  const nestingStack: Array<{ type: string; savedState: QuoteState; innerQuoteState: QuoteState; innerQuoteStartLine: number; innerQuoteStartColumn: number }> = []

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const nextCh = input[i + 1]

    // Track position
    if (ch === '\n') {
      line++
      column = 1
    } else {
      column++
    }

    // Handle escape sequences outside of single quotes
    if (ch === '\\' && state !== 'single') {
      // In double quotes, backslash only escapes: $, `, ", \, newline
      // Outside quotes, backslash escapes the next character
      if (i + 1 < input.length) {
        i++ // Skip the escaped character
        if (input[i] === '\n') {
          line++
          column = 1
        } else {
          column++
        }
      }
      continue
    }

    // Handle $'...' ANSI-C quoting (outside of quotes)
    if (state === 'none' && ch === '$' && nextCh === "'") {
      // ANSI-C quoting: $'...' - allows escape sequences like \n, \t
      i++ // Skip the $
      column++
      state = 'single' // Treat as single quoted for parsing purposes
      quoteStartLine = line
      quoteStartColumn = column
      // Note: ANSI-C quotes DO allow escape sequences, but for validation
      // purposes we still need to find the closing quote
      // We need special handling for \' inside $'...'
      i++ // Skip the opening '
      column++

      // Parse the ANSI-C quoted string
      while (i < input.length) {
        const c = input[i]
        if (c === '\\' && i + 1 < input.length) {
          // ANSI-C strings DO process backslash escapes
          i++ // Skip the backslash
          column++
          const escaped = input[i]
          if (escaped === '\n') {
            line++
            column = 1
          } else {
            column++
          }
          i++
          continue
        }
        if (c === "'") {
          // End of ANSI-C string
          state = 'none'
          column++
          break
        }
        if (c === '\n') {
          line++
          column = 1
        } else {
          column++
        }
        i++
      }

      if (state !== 'none') {
        return {
          valid: false,
          error: {
            message: "Unclosed ANSI-C quote ($'...')",
            line: quoteStartLine,
            column: quoteStartColumn,
          },
        }
      }
      continue
    }

    // Handle command substitution $() - quotes reset inside
    if (state === 'none' && ch === '$' && nextCh === '(') {
      nestingStack.push({ type: 'subst', savedState: state, innerQuoteState: 'none', innerQuoteStartLine: line, innerQuoteStartColumn: column })
      i++ // Skip the (
      column++

      // Check for arithmetic expansion $((
      if (input[i + 1] === '(') {
        nestingStack[nestingStack.length - 1].type = 'arith'
        i++ // Skip the second (
        column++
      }
      continue
    }

    // Handle parameter expansion ${...}
    if (state === 'none' && ch === '$' && nextCh === '{') {
      nestingStack.push({ type: 'param', savedState: state, innerQuoteState: 'none', innerQuoteStartLine: line, innerQuoteStartColumn: column })
      i++ // Skip the {
      column++
      continue
    }

    // Handle command substitution inside double quotes
    if (state === 'double' && ch === '$' && nextCh === '(') {
      nestingStack.push({ type: 'subst', savedState: state, innerQuoteState: 'none', innerQuoteStartLine: line, innerQuoteStartColumn: column })
      state = 'none' // Reset quote state inside substitution
      i++ // Skip the (
      column++

      // Check for arithmetic expansion $((
      if (input[i + 1] === '(') {
        nestingStack[nestingStack.length - 1].type = 'arith'
        i++ // Skip the second (
        column++
      }
      continue
    }

    // Handle parameter expansion inside double quotes
    if (state === 'double' && ch === '$' && nextCh === '{') {
      nestingStack.push({ type: 'param', savedState: state, innerQuoteState: 'none', innerQuoteStartLine: line, innerQuoteStartColumn: column })
      // Note: Inside ${} within double quotes, quote state continues
      // but we need to track the brace nesting
      i++ // Skip the {
      column++
      continue
    }

    // Handle closing ) for command substitution
    if (ch === ')' && nestingStack.length > 0 && state === 'none') {
      const top = nestingStack[nestingStack.length - 1]
      if (top.type === 'arith') {
        // Need two closing parens for $((...))
        if (nextCh === ')') {
          // Check that quotes are balanced inside the arithmetic expansion
          if (top.innerQuoteState !== 'none') {
            const quoteType = top.innerQuoteState === 'single' ? 'single' : 'double'
            return {
              valid: false,
              error: {
                message: `Unclosed ${quoteType} quote inside arithmetic expansion`,
                line: top.innerQuoteStartLine,
                column: top.innerQuoteStartColumn,
              },
            }
          }
          nestingStack.pop()
          state = top.savedState
          i++ // Skip the second )
          column++
        }
      } else if (top.type === 'subst') {
        // Check that quotes are balanced inside the command substitution
        if (top.innerQuoteState !== 'none') {
          const quoteType = top.innerQuoteState === 'single' ? 'single' : 'double'
          return {
            valid: false,
            error: {
              message: `Unclosed ${quoteType} quote inside command substitution`,
              line: top.innerQuoteStartLine,
              column: top.innerQuoteStartColumn,
            },
          }
        }
        nestingStack.pop()
        state = top.savedState
      }
      continue
    }

    // Handle closing } for parameter expansion
    if (ch === '}' && nestingStack.length > 0 && state === 'none') {
      const top = nestingStack[nestingStack.length - 1]
      if (top.type === 'param') {
        // Check that quotes are balanced inside the parameter expansion
        if (top.innerQuoteState !== 'none') {
          const quoteType = top.innerQuoteState === 'single' ? 'single' : 'double'
          return {
            valid: false,
            error: {
              message: `Unclosed ${quoteType} quote inside parameter expansion`,
              line: top.innerQuoteStartLine,
              column: top.innerQuoteStartColumn,
            },
          }
        }
        nestingStack.pop()
        state = top.savedState
      }
      continue
    }

    // Handle backtick command substitution
    if (ch === '`') {
      if (state === 'none' || state === 'double') {
        // Inside backticks, quotes have their own context
        // For simplicity, we'll scan for the closing backtick
        const savedState: QuoteState = state
        i++ // Move past the opening backtick
        column++

        let depth = 1
        while (i < input.length && depth > 0) {
          const c = input[i]
          if (c === '\\' && i + 1 < input.length) {
            i += 2 // Skip escape sequence
            column += 2
            continue
          }
          if (c === '`') {
            depth--
          }
          if (c === '\n') {
            line++
            column = 1
          } else {
            column++
          }
          i++
        }

        if (depth > 0) {
          return {
            valid: false,
            error: {
              message: 'Unclosed backtick command substitution',
              line,
              column,
            },
          }
        }
        state = savedState
        i-- // Adjust for the loop increment
        continue
      }
    }

    // Handle quote characters
    if (ch === "'") {
      if (state === 'none') {
        state = 'single'
        quoteStartLine = line
        quoteStartColumn = column
        // Track inner quote state if we're inside a nested structure
        if (nestingStack.length > 0) {
          const top = nestingStack[nestingStack.length - 1]
          top.innerQuoteState = 'single'
          top.innerQuoteStartLine = line
          top.innerQuoteStartColumn = column
        }
      } else if (state === 'single') {
        state = 'none'
        // Clear inner quote state if we're inside a nested structure
        if (nestingStack.length > 0) {
          nestingStack[nestingStack.length - 1].innerQuoteState = 'none'
        }
      }
      // Single quote inside double quote is literal, no state change
      continue
    }

    if (ch === '"') {
      if (state === 'none') {
        state = 'double'
        quoteStartLine = line
        quoteStartColumn = column
        // Track inner quote state if we're inside a nested structure
        if (nestingStack.length > 0) {
          const top = nestingStack[nestingStack.length - 1]
          top.innerQuoteState = 'double'
          top.innerQuoteStartLine = line
          top.innerQuoteStartColumn = column
        }
      } else if (state === 'double') {
        state = 'none'
        // Clear inner quote state if we're inside a nested structure
        if (nestingStack.length > 0) {
          nestingStack[nestingStack.length - 1].innerQuoteState = 'none'
        }
      }
      // Double quote inside single quote is literal, no state change
      continue
    }
  }

  // Check for unclosed quotes at end
  if (state !== 'none') {
    const quoteType = state === 'single' ? 'single' : 'double'
    return {
      valid: false,
      error: {
        message: `Unclosed ${quoteType} quote`,
        line: quoteStartLine,
        column: quoteStartColumn,
      },
    }
  }

  // Check for unclosed nesting (shouldn't happen if quotes are balanced)
  if (nestingStack.length > 0) {
    const unclosed = nestingStack[nestingStack.length - 1]
    const typeMsg =
      unclosed.type === 'subst'
        ? 'command substitution $('
        : unclosed.type === 'arith'
          ? 'arithmetic expansion $(('
          : 'parameter expansion ${'
    return {
      valid: false,
      error: {
        message: `Unclosed ${typeMsg}`,
        line,
        column,
      },
    }
  }

  return { valid: true }
}

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

  // Validate quotes using proper stateful parsing
  const quoteValidation = validateQuotes(trimmed)
  if (!quoteValidation.valid && quoteValidation.error) {
    return {
      ast: { type: 'Program', body: [] },
      valid: false,
      errors: [quoteValidation.error],
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
      let current: BashNode = parseSimpleCommand(listMatch[0].cmd)
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
          op: part,
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
    redirects,
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
  }

  // Check for dangerous patterns - but only outside of quotes
  const dangerousPatterns = [
    { pattern: /\brm\b/, name: 'rm' },
    { pattern: /\bmv\b/, name: 'mv' },
    { pattern: /\bsudo\b/, name: 'sudo' },
    { pattern: /\bchmod\b/, name: 'chmod' },
    { pattern: /\bchown\b/, name: 'chown' },
    { pattern: /\bgit\s+push\b/, name: 'git push' },
    { pattern: /\bcurl\s+.*-X\s+(POST|PUT|DELETE|PATCH)\b/i, name: 'curl write' },
  ]

  for (const { pattern } of dangerousPatterns) {
    if (pattern.test(command) && !isPatternInQuotes(command, pattern)) {
      return true
    }
  }

  return false
}

// extractIntent is unused - analysis is done inline in execute function
// Keeping for future API enhancements

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
  } catch (error: unknown) {
    const execError = isExecError(error) ? error : null

    // Handle timeout
    if (execError?.message === 'Command timed out' || execError?.killed) {
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
        // Don't include undo for timed out commands
      }
    }

    // Handle execution errors - don't record undo for failed commands
    // Also don't include undo command in result for failed operations
    return {
      input: command,
      valid: true,
      intent,
      classification: finalClassification,
      command,
      generated: false,
      stdout: execError?.stdout?.toString() || '',
      stderr: execError?.stderr?.toString() || execError?.message || 'Execution error',
      exitCode: execError?.code || 1,
      // No undo for failed commands
    }
  }
}

export default execute
