/**
 * Text Processing Commands Implementation
 *
 * Implements sed, awk, diff, patch, tee, and xargs commands
 * for native Tier 1 execution in bashx.
 *
 * @module bashx/do/commands/text-processing
 */

import type { FsCapability } from '../../types.js'

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * LRU cache for compiled regular expressions.
 * Improves performance when the same pattern is used multiple times.
 */
class RegexCache {
  private cache = new Map<string, RegExp>()
  private maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  /**
   * Get or compile a regex pattern with caching
   * @param pattern - The regex pattern string
   * @param flags - Optional regex flags
   * @returns Compiled RegExp object
   */
  get(pattern: string, flags = ''): RegExp {
    const key = `${pattern}:${flags}`
    let regex = this.cache.get(key)
    if (!regex) {
      regex = new RegExp(pattern, flags)
      // Evict oldest entry if cache is full
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value
        if (firstKey) this.cache.delete(firstKey)
      }
      this.cache.set(key, regex)
    }
    return regex
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear()
  }
}

// Global regex cache instance
const regexCache = new RegexCache()

/**
 * Split input text into lines, handling trailing newlines consistently.
 * @param text - Input text to split
 * @returns Array of lines (without trailing empty line from split)
 */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  const hasTrailingNewline = text.endsWith('\n')
  if (hasTrailingNewline && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

/**
 * Escape special regex characters in a string.
 * @param str - String to escape
 * @returns Escaped string safe for use in regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Evaluate simple arithmetic expressions safely (Workers-compatible).
 * @param left - Left operand
 * @param op - Operator (+, -, *, /)
 * @param right - Right operand
 * @returns Result of the operation
 */
function evalArithmetic(left: number, op: string, right: number): number {
  switch (op) {
    case '+': return left + right
    case '-': return left - right
    case '*': return left * right
    case '/': return right !== 0 ? left / right : 0
    default: return left
  }
}

// ============================================================================
// SED Implementation
// ============================================================================

interface SedOptions {
  inPlace?: boolean
  inPlaceSuffix?: string
  quiet?: boolean
  extended?: boolean
  expressions?: string[]
}

/**
 * Parse sed command arguments
 */
function parseSedArgs(args: string[]): { options: SedOptions; script: string; files: string[] } {
  const options: SedOptions = {
    expressions: [],
  }
  const files: string[] = []
  let script = ''
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '-n') {
      options.quiet = true
      i++
    } else if (arg === '-E' || arg === '-r') {
      options.extended = true
      i++
    } else if (arg === '-i') {
      options.inPlace = true
      i++
    } else if (arg.startsWith('-i')) {
      options.inPlace = true
      options.inPlaceSuffix = arg.slice(2)
      i++
    } else if (arg === '-e') {
      i++
      if (i < args.length) {
        options.expressions!.push(args[i])
        i++
      }
    } else if (arg.startsWith('-')) {
      // Skip unknown options
      i++
    } else if (!script && options.expressions!.length === 0) {
      script = arg
      i++
    } else {
      files.push(arg)
      i++
    }
  }

  return { options, script, files }
}

/**
 * Parse a sed substitution command (s/pattern/replacement/flags).
 * Supports various delimiters and converts sed regex syntax to JavaScript.
 *
 * @param script - The sed substitution command (e.g., 's/foo/bar/g')
 * @returns Parsed substitution object or null if not a valid substitution
 */
function parseSedSubstitution(script: string): { pattern: RegExp; replacement: string; global: boolean } | null {
  // Match s/pattern/replacement/flags with various delimiters
  const delimMatch = script.match(/^s(.)/)
  if (!delimMatch) return null

  const delim = delimMatch[1]
  const escapedDelim = escapeRegex(delim)
  const regex = regexCache.get(`^s${escapedDelim}((?:[^${escapedDelim}\\\\]|\\\\.)*)${escapedDelim}((?:[^${escapedDelim}\\\\]|\\\\.)*)${escapedDelim}([gip]*)$`)
  const match = script.match(regex)

  if (!match) return null

  const [, pattern, replacement, flags] = match
  const global = flags.includes('g')
  const ignoreCase = flags.includes('i')

  // Convert sed regex to JavaScript regex
  // Replace sed escape sequences with JS equivalents
  // \\( -> ( (grouping in sed basic regex)
  // \\) -> ) (grouping in sed basic regex)
  // Note: In patterns, \1 stays as \1 for backreferences (JS regex uses \1 in pattern)
  // Only in replacements, \1 becomes $1 (JS uses $1 in replacement strings)
  const jsPattern = pattern
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')

  const jsReplacement = replacement
    .replace(/\\1/g, '$1')
    .replace(/\\2/g, '$2')
    .replace(/\\3/g, '$3')
    .replace(/\\4/g, '$4')
    .replace(/\\5/g, '$5')
    .replace(/\\6/g, '$6')
    .replace(/\\7/g, '$7')
    .replace(/\\8/g, '$8')
    .replace(/\\9/g, '$9')

  const regexFlags = ignoreCase ? 'i' : ''

  return {
    pattern: new RegExp(jsPattern, regexFlags),
    replacement: jsReplacement,
    global,
  }
}

/**
 * Parse sed print command (Np or N,Mp where N,M are line numbers)
 */
function parseSedPrint(script: string): { start: number | '$'; end?: number | '$' } | null {
  // Match patterns like '5p', '2,4p', '$p', '1,$p'
  const match = script.match(/^(\d+|\$)(?:,(\d+|\$))?p$/)
  if (!match) return null

  const start = match[1] === '$' ? '$' : parseInt(match[1], 10)
  const end = match[2] ? (match[2] === '$' ? '$' : parseInt(match[2], 10)) : undefined

  return { start, end }
}

/**
 * Parse sed delete command (Nd or N,Md or /pattern/d)
 */
function parseSedDelete(script: string): { start?: number; end?: number; pattern?: RegExp } | null {
  // Match pattern delete like /^a/d
  const patternMatch = script.match(/^\/(.+)\/d$/)
  if (patternMatch) {
    return { pattern: new RegExp(patternMatch[1]) }
  }

  // Match line range delete like '2d' or '1,10d'
  const rangeMatch = script.match(/^(\d+)(?:,(\d+))?d$/)
  if (rangeMatch) {
    return {
      start: parseInt(rangeMatch[1], 10),
      end: rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined,
    }
  }

  return null
}

/**
 * Execute sed (stream editor) command.
 *
 * Supports substitution (s/pattern/replacement/flags), line printing with -n and p,
 * line deletion with d, and multiple -e expressions.
 *
 * @param args - Command arguments (e.g., ['-e', 's/foo/bar/', '/path/to/file'])
 * @param input - Input text to process (used when no file is specified)
 * @param fs - Optional filesystem capability for in-place editing
 * @returns Object with stdout, stderr, and exitCode
 *
 * @example
 * // Basic substitution
 * executeSed(['s/hello/world/g'], 'hello hello')
 * // => { stdout: 'world world\n', stderr: '', exitCode: 0 }
 */
export function executeSed(args: string[], input: string, _fs?: FsCapability): { stdout: string; stderr: string; exitCode: number } {
  const { options, script, files: _files } = parseSedArgs(args)
  void _files // Reserved for future file input support
  const scripts = options.expressions!.length > 0 ? options.expressions! : [script]

  // If files provided, we'd need to read from fs - for now just use input
  const content = input

  const processLine = (line: string, lineNum: number, totalLines: number): string | null => {
    let result: string | null = line

    for (const s of scripts) {
      if (result === null) break

      // Try substitution
      const sub = parseSedSubstitution(s)
      if (sub) {
        if (sub.global) {
          result = result.replace(new RegExp(sub.pattern.source, sub.pattern.flags + 'g'), sub.replacement)
        } else {
          result = result.replace(sub.pattern, sub.replacement)
        }
        continue
      }

      // Try print (only relevant when -n is used)
      const print = parseSedPrint(s)
      if (print && options.quiet) {
        const startLine = print.start === '$' ? totalLines : print.start
        const endLine = print.end === undefined ? startLine : (print.end === '$' ? totalLines : print.end)

        if (lineNum < startLine || lineNum > endLine) {
          result = null
        }
        continue
      }

      // Try delete
      const del = parseSedDelete(s)
      if (del) {
        if (del.pattern) {
          if (del.pattern.test(result)) {
            result = null
          }
        } else if (del.start !== undefined) {
          const endLine = del.end ?? del.start
          if (lineNum >= del.start && lineNum <= endLine) {
            result = null
          }
        }
        continue
      }
    }

    return result
  }

  const lines = splitLines(content)
  const totalLines = lines.length
  const outputLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const result = processLine(lines[i], i + 1, totalLines)
    if (result !== null) {
      outputLines.push(result)
    }
  }

  let stdout = outputLines.join('\n')
  if (outputLines.length > 0) {
    stdout += '\n'
  }

  return { stdout, stderr: '', exitCode: 0 }
}

// ============================================================================
// AWK Implementation
// ============================================================================

interface AwkOptions {
  fieldSeparator: string
  outputFieldSeparator: string
  outputRecordSeparator: string
}

interface AwkProgram {
  begin?: string
  main?: { pattern?: string; action: string }
  end?: string
}

/**
 * Parse awk command arguments
 */
function parseAwkArgs(args: string[]): { options: AwkOptions; program: string; files: string[] } {
  const options: AwkOptions = {
    fieldSeparator: /\s+/.source, // Default: whitespace
    outputFieldSeparator: ' ',
    outputRecordSeparator: '\n',
  }
  const files: string[] = []
  let program = ''
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '-F') {
      i++
      if (i < args.length) {
        let sep = args[i]
        // Remove quotes if present
        if ((sep.startsWith("'") && sep.endsWith("'")) || (sep.startsWith('"') && sep.endsWith('"'))) {
          sep = sep.slice(1, -1)
        }
        options.fieldSeparator = sep.replace(/\\t/g, '\t')
        i++
      }
    } else if (arg.startsWith('-F')) {
      let sep = arg.slice(2)
      // Remove quotes if present
      if ((sep.startsWith("'") && sep.endsWith("'")) || (sep.startsWith('"') && sep.endsWith('"'))) {
        sep = sep.slice(1, -1)
      }
      options.fieldSeparator = sep.replace(/\\t/g, '\t')
      i++
    } else if (arg.startsWith('-')) {
      // Skip unknown options
      i++
    } else if (!program) {
      program = arg
      i++
    } else {
      files.push(arg)
      i++
    }
  }

  return { options, program, files }
}

/**
 * Parse an awk program into its components
 */
function parseAwkProgram(program: string): AwkProgram {
  const result: AwkProgram = {}

  // Extract BEGIN block
  const beginMatch = program.match(/BEGIN\s*\{([^}]*)\}/i)
  if (beginMatch) {
    result.begin = beginMatch[1].trim()
    program = program.replace(beginMatch[0], '')
  }

  // Extract END block
  const endMatch = program.match(/END\s*\{([^}]*)\}/i)
  if (endMatch) {
    result.end = endMatch[1].trim()
    program = program.replace(endMatch[0], '')
  }

  // Parse main pattern/action
  program = program.trim()
  if (program) {
    // Match pattern { action } or just { action } or just condition
    const patternActionMatch = program.match(/^(\/[^/]+\/|[^{]+)?\s*\{([^}]*)\}$/)
    if (patternActionMatch) {
      result.main = {
        pattern: patternActionMatch[1]?.trim(),
        action: patternActionMatch[2].trim(),
      }
    } else if (program.startsWith('{') && program.endsWith('}')) {
      result.main = {
        action: program.slice(1, -1).trim(),
      }
    } else {
      // Just a condition like NR==5 - implicit print
      result.main = {
        pattern: program,
        action: 'print',
      }
    }
  }

  return result
}

/**
 * Evaluate an awk expression
 */
function evaluateAwkExpression(
  expr: string,
  fields: string[],
  variables: Record<string, string | number>,
  options: AwkOptions
): string {
  // Replace field references $1, $2, $NF, $0
  let result = expr

  // Replace $NF with last field
  result = result.replace(/\$NF/g, fields[fields.length - 1] || '')

  // Replace $0 with full line
  result = result.replace(/\$0/g, fields.join(options.outputFieldSeparator))

  // Replace $n with nth field (1-indexed)
  result = result.replace(/\$(\d+)/g, (_, n) => fields[parseInt(n, 10) - 1] || '')

  // Replace NR, NF, FS, OFS
  result = result.replace(/\bNR\b/g, String(variables.NR))
  result = result.replace(/\bNF\b/g, String(fields.length))
  result = result.replace(/\bFS\b/g, String(variables.FS))
  result = result.replace(/\bOFS\b/g, String(variables.OFS))

  // Replace user-defined variables (after built-in ones)
  // Use word boundary to match whole variable names
  for (const [varName, varValue] of Object.entries(variables)) {
    if (!['NR', 'NF', 'FS', 'OFS'].includes(varName)) {
      // Word boundary - matches before/after word characters
      // /sum -> matches sum, sum/count -> matches both sum and count
      result = result.replace(new RegExp(`(?<![a-zA-Z_])${varName}(?![a-zA-Z0-9_])`, 'g'), String(varValue))
    }
  }

  // Handle arithmetic expressions like sum/count or 100/4
  // Use the shared evalArithmetic helper (Workers-compatible, no eval/Function)
  result = result.trim()
  const arithMatch = result.match(/^([\d.]+)\s*([+\-*/])\s*([\d.]+)$/)
  if (arithMatch) {
    const [, leftStr, op, rightStr] = arithMatch
    const left = parseFloat(leftStr)
    const right = parseFloat(rightStr)
    if (!isNaN(left) && !isNaN(right)) {
      result = String(evalArithmetic(left, op, right))
    }
  }

  return result
}

/**
 * Result of an awk action execution
 */
interface AwkActionResult {
  output: string
  isPrintf: boolean  // printf handles its own newlines
}

/**
 * Execute an awk action
 */
function executeAwkAction(
  action: string,
  fields: string[],
  variables: Record<string, string | number>,
  options: AwkOptions
): AwkActionResult {
  const outputParts: string[] = []
  let hasPrintf = false

  // Split multiple statements by semicolon
  const statements = action.split(/;/).map(s => s.trim()).filter(Boolean)

  for (const stmt of statements) {
    // Handle print statement
    if (stmt.startsWith('print')) {
      const printArgs = stmt.slice(5).trim()
      if (!printArgs) {
        // print with no args prints $0
        outputParts.push(fields.join(options.outputFieldSeparator))
      } else {
        // Parse print arguments
        const parts: string[] = []

        // Handle printf-style
        if (stmt.startsWith('printf')) {
          hasPrintf = true
          const printfMatch = stmt.match(/printf\s+"([^"]*)"(?:\s*,\s*(.+))?/)
          if (printfMatch) {
            let format = printfMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t')
            const argsStr = printfMatch[2]
            if (argsStr) {
              const args = argsStr.split(/\s*,\s*/).map(a => evaluateAwkExpression(a.trim(), fields, variables, options))
              let argIndex = 0
              format = format.replace(/%(-?\d*\.?\d*)?([sdxef])/g, (_match, _width, type) => {
                const val = args[argIndex++] || ''
                if (type === 'd') {
                  return String(parseInt(val, 10) || 0)
                }
                return val
              })
            }
            outputParts.push(format)
          }
          continue
        }

        // Regular print with comma-separated values
        // Handle expressions like $1, $3 or $1 $3 (space = OFS, comma = OFS)
        const argParts = printArgs.split(/\s*,\s*/)
        for (const part of argParts) {
          const evaluated = evaluateAwkExpression(part, fields, variables, options)
          parts.push(evaluated)
        }
        outputParts.push(parts.join(options.outputFieldSeparator))
      }
    }
    // Handle if statements (must come before general assignment check)
    else if (stmt.startsWith('if')) {
      const ifMatch = stmt.match(/if\s*\(([^)]+)\)\s*(\w+)\s*=\s*(.+)/)
      if (ifMatch) {
        const [, condition, varName, value] = ifMatch
        const condResult = evaluateAwkCondition(condition, fields, variables, options)
        if (condResult) {
          const evaluated = evaluateAwkExpression(value, fields, variables, options)
          variables[varName] = parseFloat(evaluated) || evaluated
        }
      }
    }
    // Handle variable increment (count++)
    else if (stmt.match(/(\w+)\+\+/)) {
      const match = stmt.match(/(\w+)\+\+/)
      if (match) {
        variables[match[1]] = (Number(variables[match[1]]) || 0) + 1
      }
    }
    // Handle variable assignments (after if statement check)
    else if (stmt.includes('=') && !stmt.includes('==')) {
      const assignMatch = stmt.match(/(\w+)\s*([+\-*/]?=)\s*(.+)/)
      if (assignMatch) {
        const [, varName, op, valueExpr] = assignMatch
        const evaluated = evaluateAwkExpression(valueExpr, fields, variables, options)
        const numValue = parseFloat(evaluated) || 0

        if (op === '=') {
          variables[varName] = numValue
        } else if (op === '+=') {
          variables[varName] = (Number(variables[varName]) || 0) + numValue
        } else if (op === '-=') {
          variables[varName] = (Number(variables[varName]) || 0) - numValue
        } else if (op === '*=') {
          variables[varName] = (Number(variables[varName]) || 0) * numValue
        } else if (op === '/=') {
          variables[varName] = (Number(variables[varName]) || 0) / numValue
        }
      }
    }
  }

  // For printf, join without additional separators since printf controls its own newlines
  // For regular print, use ORS as separator
  const output = hasPrintf
    ? outputParts.join('')
    : outputParts.join(options.outputRecordSeparator)

  return { output, isPrintf: hasPrintf }
}

/**
 * Evaluate an awk condition
 */
function evaluateAwkCondition(
  condition: string,
  fields: string[],
  variables: Record<string, string | number>,
  options: AwkOptions
): boolean {
  condition = condition.trim()

  // Handle compound conditions with && first (lower precedence than comparison operators)
  if (condition.includes('&&')) {
    const parts = condition.split(/\s*&&\s*/)
    return parts.every(part => evaluateAwkCondition(part.trim(), fields, variables, options))
  }

  // Handle compound conditions with ||
  if (condition.includes('||')) {
    const parts = condition.split(/\s*\|\|\s*/)
    return parts.some(part => evaluateAwkCondition(part.trim(), fields, variables, options))
  }

  // Handle regex pattern /pattern/
  if (condition.startsWith('/') && condition.endsWith('/')) {
    const pattern = condition.slice(1, -1)
    const line = fields.join(options.outputFieldSeparator)
    return new RegExp(pattern).test(line)
  }

  // Handle negated regex !/pattern/
  if (condition.startsWith('!/') && condition.endsWith('/')) {
    const pattern = condition.slice(2, -1)
    const line = fields.join(options.outputFieldSeparator)
    return !new RegExp(pattern).test(line)
  }

  // Handle comparisons like NR==5, $1>10, etc.
  const compMatch = condition.match(/(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)/)
  if (compMatch) {
    const [, left, op, right] = compMatch
    const leftVal = evaluateAwkExpression(left.trim(), fields, variables, options)
    const rightVal = evaluateAwkExpression(right.trim(), fields, variables, options)

    const leftNum = parseFloat(leftVal)
    const rightNum = parseFloat(rightVal)
    const useNumeric = !isNaN(leftNum) && !isNaN(rightNum)

    switch (op) {
      case '==': return useNumeric ? leftNum === rightNum : leftVal === rightVal
      case '!=': return useNumeric ? leftNum !== rightNum : leftVal !== rightVal
      case '>=': return useNumeric ? leftNum >= rightNum : leftVal >= rightVal
      case '<=': return useNumeric ? leftNum <= rightNum : leftVal <= rightVal
      case '>': return useNumeric ? leftNum > rightNum : leftVal > rightVal
      case '<': return useNumeric ? leftNum < rightNum : leftVal < rightVal
    }
  }

  // Default: truthy check
  const evaluated = evaluateAwkExpression(condition, fields, variables, options)
  return Boolean(evaluated)
}

/**
 * Execute awk (pattern scanning and processing) command.
 *
 * Supports field extraction ($1, $2, $NF), pattern matching, BEGIN/END blocks,
 * custom field separators (-F), variables, arithmetic, and control flow.
 *
 * @param args - Command arguments (e.g., ['-F:', '{print $1}', '/path/to/file'])
 * @param input - Input text to process
 * @returns Object with stdout, stderr, and exitCode
 *
 * @example
 * // Print first field
 * executeAwk(['{print $1}'], 'hello world')
 * // => { stdout: 'hello\n', stderr: '', exitCode: 0 }
 *
 * @example
 * // Sum a column
 * executeAwk(['{sum+=$1} END {print sum}'], '10\n20\n30')
 * // => { stdout: '60\n', stderr: '', exitCode: 0 }
 */
export function executeAwk(args: string[], input: string): { stdout: string; stderr: string; exitCode: number } {
  const { options, program } = parseAwkArgs(args)
  const parsed = parseAwkProgram(program)

  const variables: Record<string, string | number> = {
    NR: 0,
    NF: 0,
    FS: options.fieldSeparator,
    OFS: options.outputFieldSeparator,
  }

  const output: AwkActionResult[] = []

  // Execute BEGIN block
  if (parsed.begin) {
    // Parse OFS/ORS assignments in BEGIN
    const ofsMatch = parsed.begin.match(/OFS\s*=\s*"([^"]*)"/)
    if (ofsMatch) {
      options.outputFieldSeparator = ofsMatch[1]
      variables.OFS = ofsMatch[1]
    }
    const orsMatch = parsed.begin.match(/ORS\s*=\s*"([^"]*)"/)
    if (orsMatch) {
      options.outputRecordSeparator = orsMatch[1]
    }
    // Initialize variables
    const varMatches = parsed.begin.matchAll(/(\w+)\s*=\s*(\d+)/g)
    for (const match of varMatches) {
      variables[match[1]] = parseInt(match[2], 10)
    }
  }

  // Process input lines
  const lines = splitLines(input)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    variables.NR = i + 1

    // Split into fields using cached regex
    const fieldSep = options.fieldSeparator === /\s+/.source
      ? /\s+/
      : regexCache.get(escapeRegex(options.fieldSeparator))
    const fields = ['', ...line.split(fieldSep)] // $0 is handled specially, but fields[1] = $1
    fields[0] = line // $0 is the whole line
    variables.NF = fields.length - 1

    if (parsed.main) {
      // Check pattern if present
      let shouldExecute = true
      if (parsed.main.pattern) {
        shouldExecute = evaluateAwkCondition(parsed.main.pattern, fields.slice(1), variables, options)
      }

      if (shouldExecute) {
        const result = executeAwkAction(parsed.main.action, fields.slice(1), variables, options)
        if (result.output) {
          output.push(result)
        }
      }
    }
  }

  // Execute END block
  if (parsed.end) {
    const fields = ['']
    const result = executeAwkAction(parsed.end, fields, variables, options)
    if (result.output) {
      output.push(result)
    }
  }

  // Build final output - printf handles its own newlines, print uses ORS
  let stdout = ''
  for (let i = 0; i < output.length; i++) {
    const item = output[i]
    stdout += item.output
    // Only add ORS after non-printf outputs that don't already end with newline
    if (!item.isPrintf && !item.output.endsWith('\n')) {
      stdout += options.outputRecordSeparator
    }
  }
  // Add final ORS if needed (for non-empty output not ending in newline)
  if (stdout.length > 0 && !stdout.endsWith('\n') && options.outputRecordSeparator === '\n') {
    stdout += '\n'
  }

  return { stdout, stderr: '', exitCode: 0 }
}

// ============================================================================
// DIFF Implementation (Myers algorithm)
// ============================================================================

interface DiffOptions {
  unified?: boolean
  context?: boolean
  contextLines?: number
}

interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: Array<{ type: 'context' | 'delete' | 'add'; line: string }>
}

/**
 * Myers diff algorithm - find shortest edit script
 */
function myersDiff(oldLines: string[], newLines: string[]): Array<{ type: 'equal' | 'delete' | 'insert'; oldIdx?: number; newIdx?: number }> {
  const n = oldLines.length
  const m = newLines.length
  const max = n + m

  const v: Record<number, number> = { 1: 0 }
  const trace: Array<Record<number, number>> = []

  // Find the shortest edit script
  outer:
  for (let d = 0; d <= max; d++) {
    trace.push({ ...v })

    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[k - 1] < v[k + 1])) {
        x = v[k + 1]
      } else {
        x = v[k - 1] + 1
      }

      let y = x - k

      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++
        y++
      }

      v[k] = x

      if (x >= n && y >= m) {
        break outer
      }
    }
  }

  // Backtrack to find the path
  const edits: Array<{ type: 'equal' | 'delete' | 'insert'; oldIdx?: number; newIdx?: number }> = []
  let x = n
  let y = m

  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d]
    const k = x - y

    let prevK: number
    if (k === -d || (k !== d && vPrev[k - 1] < vPrev[k + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = vPrev[prevK]
    const prevY = prevX - prevK

    // Add equal lines (diagonal moves)
    while (x > prevX && y > prevY) {
      x--
      y--
      edits.unshift({ type: 'equal', oldIdx: x, newIdx: y })
    }

    if (d > 0) {
      if (x === prevX) {
        // Insert
        y--
        edits.unshift({ type: 'insert', newIdx: y })
      } else {
        // Delete
        x--
        edits.unshift({ type: 'delete', oldIdx: x })
      }
    }
  }

  return edits
}

/**
 * Format diff in normal format
 */
function formatNormalDiff(oldLines: string[], newLines: string[], edits: Array<{ type: 'equal' | 'delete' | 'insert'; oldIdx?: number; newIdx?: number }>): string {
  const output: string[] = []
  let i = 0

  while (i < edits.length) {
    const edit = edits[i]

    if (edit.type === 'equal') {
      i++
      continue
    }

    // Collect consecutive changes
    const changes: Array<{ type: 'delete' | 'insert'; oldIdx?: number; newIdx?: number }> = []
    while (i < edits.length && edits[i].type !== 'equal') {
      changes.push(edits[i] as { type: 'delete' | 'insert'; oldIdx?: number; newIdx?: number })
      i++
    }

    const deletes = changes.filter(c => c.type === 'delete')
    const inserts = changes.filter(c => c.type === 'insert')

    if (deletes.length > 0 && inserts.length > 0) {
      // Change
      const oldStart = deletes[0].oldIdx! + 1
      const oldEnd = deletes[deletes.length - 1].oldIdx! + 1
      const newStart = inserts[0].newIdx! + 1
      const newEnd = inserts[inserts.length - 1].newIdx! + 1

      const oldRange = oldStart === oldEnd ? `${oldStart}` : `${oldStart},${oldEnd}`
      const newRange = newStart === newEnd ? `${newStart}` : `${newStart},${newEnd}`

      output.push(`${oldRange}c${newRange}`)
      for (const d of deletes) {
        output.push(`< ${oldLines[d.oldIdx!]}`)
      }
      output.push('---')
      for (const ins of inserts) {
        output.push(`> ${newLines[ins.newIdx!]}`)
      }
    } else if (deletes.length > 0) {
      // Delete
      const oldStart = deletes[0].oldIdx! + 1
      const oldEnd = deletes[deletes.length - 1].oldIdx! + 1
      const newPos = (deletes[0].oldIdx || 0)

      const oldRange = oldStart === oldEnd ? `${oldStart}` : `${oldStart},${oldEnd}`

      output.push(`${oldRange}d${newPos}`)
      for (const d of deletes) {
        output.push(`< ${oldLines[d.oldIdx!]}`)
      }
    } else if (inserts.length > 0) {
      // Add
      const oldPos = inserts[0].newIdx!
      const newStart = inserts[0].newIdx! + 1
      const newEnd = inserts[inserts.length - 1].newIdx! + 1

      const newRange = newStart === newEnd ? `${newStart}` : `${newStart},${newEnd}`

      output.push(`${oldPos}a${newRange}`)
      for (const ins of inserts) {
        output.push(`> ${newLines[ins.newIdx!]}`)
      }
    }
  }

  return output.length > 0 ? output.join('\n') + '\n' : ''
}

/**
 * Format diff in unified format
 */
function formatUnifiedDiff(
  file1Path: string,
  file2Path: string,
  oldLines: string[],
  newLines: string[],
  edits: Array<{ type: 'equal' | 'delete' | 'insert'; oldIdx?: number; newIdx?: number }>,
  contextLines = 3
): string {
  const output: string[] = []

  output.push(`--- ${file1Path}`)
  output.push(`+++ ${file2Path}`)

  // Group edits into hunks
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let contextBuffer: string[] = []
  let oldLineNum = 0
  let newLineNum = 0

  for (const edit of edits) {
    if (edit.type === 'equal') {
      const line = oldLines[edit.oldIdx!]

      if (currentHunk) {
        currentHunk.lines.push({ type: 'context', line })
        currentHunk.oldCount++
        currentHunk.newCount++
        contextBuffer.push(line)

        if (contextBuffer.length > contextLines * 2) {
          // End current hunk
          // Remove trailing context beyond limit
          while (currentHunk.lines.length > 0 &&
                 currentHunk.lines[currentHunk.lines.length - 1].type === 'context' &&
                 contextBuffer.length > contextLines) {
            currentHunk.lines.pop()
            currentHunk.oldCount--
            currentHunk.newCount--
            contextBuffer.shift()
          }
          hunks.push(currentHunk)
          currentHunk = null
          contextBuffer = [line]
        }
      } else {
        contextBuffer.push(line)
        if (contextBuffer.length > contextLines) {
          contextBuffer.shift()
        }
      }

      oldLineNum++
      newLineNum++
    } else {
      if (!currentHunk) {
        // Start new hunk with leading context
        currentHunk = {
          oldStart: Math.max(1, oldLineNum - contextBuffer.length + 1),
          oldCount: contextBuffer.length,
          newStart: Math.max(1, newLineNum - contextBuffer.length + 1),
          newCount: contextBuffer.length,
          lines: contextBuffer.map(l => ({ type: 'context' as const, line: l })),
        }
        contextBuffer = []
      }

      if (edit.type === 'delete') {
        currentHunk.lines.push({ type: 'delete', line: oldLines[edit.oldIdx!] })
        currentHunk.oldCount++
        oldLineNum++
      } else {
        currentHunk.lines.push({ type: 'add', line: newLines[edit.newIdx!] })
        currentHunk.newCount++
        newLineNum++
      }
    }
  }

  if (currentHunk) {
    // Remove trailing context beyond limit
    while (currentHunk.lines.length > 0 &&
           currentHunk.lines[currentHunk.lines.length - 1].type === 'context') {
      const lastNonContext = currentHunk.lines.slice().reverse().findIndex(l => l.type !== 'context')
      if (lastNonContext === -1) break

      const contextAfter = lastNonContext
      if (contextAfter > contextLines) {
        currentHunk.lines.pop()
        currentHunk.oldCount--
        currentHunk.newCount--
      } else {
        break
      }
    }
    hunks.push(currentHunk)
  }

  // Format hunks
  for (const hunk of hunks) {
    output.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        output.push(` ${line.line}`)
      } else if (line.type === 'delete') {
        output.push(`-${line.line}`)
      } else {
        output.push(`+${line.line}`)
      }
    }
  }

  return output.join('\n') + '\n'
}

/**
 * Format diff in context format
 */
function formatContextDiff(
  file1Path: string,
  file2Path: string,
  oldLines: string[],
  newLines: string[],
  edits: Array<{ type: 'equal' | 'delete' | 'insert'; oldIdx?: number; newIdx?: number }>
): string {
  const output: string[] = []

  output.push(`*** ${file1Path}`)
  output.push(`--- ${file2Path}`)
  output.push('***************')

  // For simplicity, output entire file as one hunk
  output.push(`*** 1,${oldLines.length} ****`)

  for (let i = 0; i < oldLines.length; i++) {
    const edit = edits.find(e => e.oldIdx === i && (e.type === 'equal' || e.type === 'delete'))
    if (edit?.type === 'delete') {
      output.push(`! ${oldLines[i]}`)
    } else if (edit?.type === 'equal') {
      // Check if there's a change at this position
      const hasChange = edits.some(e => e.type === 'insert' && e.newIdx === edit.newIdx)
      if (hasChange) {
        output.push(`! ${oldLines[i]}`)
      } else {
        output.push(`  ${oldLines[i]}`)
      }
    }
  }

  output.push(`--- 1,${newLines.length} ----`)

  for (let i = 0; i < newLines.length; i++) {
    const edit = edits.find(e => e.newIdx === i && (e.type === 'equal' || e.type === 'insert'))
    if (edit?.type === 'insert') {
      output.push(`! ${newLines[i]}`)
    } else if (edit?.type === 'equal') {
      // Check if there's a change at this position
      const hasChange = edits.some(e => e.type === 'delete' && e.oldIdx === edit.oldIdx)
      if (hasChange) {
        output.push(`! ${newLines[i]}`)
      } else {
        output.push(`  ${newLines[i]}`)
      }
    }
  }

  return output.join('\n') + '\n'
}

/**
 * Parse diff command arguments
 * @internal Reserved for future CLI diff support
 */
export function parseDiffArgs(args: string[]): { options: DiffOptions; files: string[] } {
  const options: DiffOptions = {}
  const files: string[] = []

  for (const arg of args) {
    if (arg === '-u' || arg === '--unified') {
      options.unified = true
    } else if (arg === '-c' || arg === '--context') {
      options.context = true
    } else if (arg.startsWith('-U')) {
      options.unified = true
      options.contextLines = parseInt(arg.slice(2), 10)
    } else if (arg.startsWith('-C')) {
      options.context = true
      options.contextLines = parseInt(arg.slice(2), 10)
    } else if (!arg.startsWith('-')) {
      files.push(arg)
    }
  }

  return { options, files }
}

/**
 * Execute diff (file comparison) command.
 *
 * Compares two text files and outputs the differences. Implements Myers diff
 * algorithm for efficient comparison. Supports normal, unified (-u), and
 * context (-c) output formats.
 *
 * @param file1Content - Content of the first (original) file
 * @param file2Content - Content of the second (new) file
 * @param file1Path - Path of the first file (for output headers)
 * @param file2Path - Path of the second file (for output headers)
 * @param options - Diff options (unified, context, contextLines)
 * @returns Object with stdout (diff output), stderr, and exitCode (0 if same, 1 if different)
 *
 * @example
 * // Unified diff format
 * executeDiff('line1\n', 'line1\nline2\n', 'a.txt', 'b.txt', { unified: true })
 */
export function executeDiff(
  file1Content: string,
  file2Content: string,
  file1Path: string,
  file2Path: string,
  options: DiffOptions = {}
): { stdout: string; stderr: string; exitCode: number } {
  const oldLines = file1Content.split('\n')
  const newLines = file2Content.split('\n')

  // Remove trailing empty lines from split
  if (file1Content.endsWith('\n') && oldLines[oldLines.length - 1] === '') {
    oldLines.pop()
  }
  if (file2Content.endsWith('\n') && newLines[newLines.length - 1] === '') {
    newLines.pop()
  }

  // Check if files are identical
  if (file1Content === file2Content) {
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  const edits = myersDiff(oldLines, newLines)

  let stdout: string
  if (options.unified) {
    stdout = formatUnifiedDiff(file1Path, file2Path, oldLines, newLines, edits, options.contextLines)
  } else if (options.context) {
    stdout = formatContextDiff(file1Path, file2Path, oldLines, newLines, edits)
  } else {
    stdout = formatNormalDiff(oldLines, newLines, edits)
  }

  return { stdout, stderr: '', exitCode: stdout ? 1 : 0 }
}

// ============================================================================
// PATCH Implementation
// ============================================================================

interface PatchOptions {
  reverse?: boolean
  stripLevel?: number
  dryRun?: boolean
}

interface PatchHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: Array<{ type: 'context' | 'delete' | 'add'; content: string }>
}

interface ParsedPatch {
  oldFile: string
  newFile: string
  hunks: PatchHunk[]
}

/**
 * Parse a unified diff patch
 */
function parseUnifiedPatch(patchContent: string): ParsedPatch[] {
  const patches: ParsedPatch[] = []
  const lines = patchContent.split('\n')

  let current: ParsedPatch | null = null
  let currentHunk: PatchHunk | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // File header
    if (line.startsWith('--- ')) {
      if (current) {
        if (currentHunk) {
          current.hunks.push(currentHunk)
        }
        patches.push(current)
      }
      current = { oldFile: line.slice(4).split('\t')[0], newFile: '', hunks: [] }
      currentHunk = null
    } else if (line.startsWith('+++ ') && current) {
      current.newFile = line.slice(4).split('\t')[0]
    }
    // Hunk header
    else if (line.startsWith('@@') && current) {
      if (currentHunk) {
        current.hunks.push(currentHunk)
      }

      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldCount: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newCount: parseInt(match[4] || '1', 10),
          lines: [],
        }
      }
    }
    // Hunk content
    else if (currentHunk) {
      if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) })
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'delete', content: line.slice(1) })
      } else if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1) })
      }
    }
  }

  if (current) {
    if (currentHunk) {
      current.hunks.push(currentHunk)
    }
    patches.push(current)
  }

  return patches
}

/**
 * Apply a patch to content
 */
function applyPatch(original: string, patch: ParsedPatch, options: PatchOptions): { result: string; success: boolean; message: string } {
  const lines = original.split('\n')
  if (original.endsWith('\n') && lines[lines.length - 1] === '') {
    lines.pop()
  }

  let offset = 0

  for (const hunk of patch.hunks) {
    const startLine = hunk.oldStart - 1 + offset

    // Verify context matches (simple check)
    let contextMatches = true
    let lineIdx = startLine

    for (const hunkLine of hunk.lines) {
      if (options.reverse) {
        if (hunkLine.type === 'add') {
          if (lines[lineIdx] !== hunkLine.content) {
            contextMatches = false
            break
          }
          lineIdx++
        } else if (hunkLine.type === 'context') {
          if (lines[lineIdx] !== hunkLine.content) {
            contextMatches = false
            break
          }
          lineIdx++
        }
      } else {
        if (hunkLine.type === 'delete' || hunkLine.type === 'context') {
          if (lines[lineIdx] !== hunkLine.content) {
            contextMatches = false
            break
          }
          lineIdx++
        }
      }
    }

    if (!contextMatches) {
      // Check if already applied (for forward patch) or already reversed
      let alreadyApplied = true
      lineIdx = startLine

      for (const hunkLine of hunk.lines) {
        if (options.reverse) {
          if (hunkLine.type === 'delete') {
            if (lines[lineIdx] !== hunkLine.content) {
              alreadyApplied = false
              break
            }
            lineIdx++
          } else if (hunkLine.type === 'context') {
            if (lines[lineIdx] !== hunkLine.content) {
              alreadyApplied = false
              break
            }
            lineIdx++
          }
        } else {
          if (hunkLine.type === 'add' || hunkLine.type === 'context') {
            if (lines[lineIdx] !== hunkLine.content) {
              alreadyApplied = false
              break
            }
            lineIdx++
          }
        }
      }

      if (alreadyApplied) {
        return { result: original, success: false, message: 'Reversed (or previously applied) patch detected!' }
      }

      return { result: original, success: false, message: 'Hunk failed to apply' }
    }

    if (options.dryRun) {
      continue
    }

    // Apply the hunk
    const newLines: string[] = []
    let deleteCount = 0
    let addCount = 0

    for (const hunkLine of hunk.lines) {
      if (options.reverse) {
        if (hunkLine.type === 'delete') {
          newLines.push(hunkLine.content)
          addCount++
        } else if (hunkLine.type === 'add') {
          deleteCount++
        } else {
          newLines.push(hunkLine.content)
        }
      } else {
        if (hunkLine.type === 'add') {
          newLines.push(hunkLine.content)
          addCount++
        } else if (hunkLine.type === 'delete') {
          deleteCount++
        } else {
          newLines.push(hunkLine.content)
        }
      }
    }

    const contextAndDelete = hunk.lines.filter(l =>
      options.reverse ? (l.type === 'context' || l.type === 'add') : (l.type === 'context' || l.type === 'delete')
    ).length

    lines.splice(startLine, contextAndDelete, ...newLines)
    offset += addCount - deleteCount
  }

  let result = lines.join('\n')
  if (lines.length > 0) {
    result += '\n'
  }

  return { result, success: true, message: `patching file ${patch.newFile}` }
}

/**
 * Strip path prefix
 */
function stripPathPrefix(path: string, level: number): string {
  if (level === 0) return path

  const parts = path.split('/')
  return parts.slice(level).join('/')
}

/**
 * Parse patch command arguments
 * @internal Reserved for future CLI patch support
 */
export function parsePatchArgs(args: string[]): { options: PatchOptions; patchFile?: string } {
  const options: PatchOptions = { stripLevel: 0 }
  let patchFile: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '-R' || arg === '--reverse') {
      options.reverse = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('-p')) {
      options.stripLevel = parseInt(arg.slice(2), 10)
    } else if (arg === '-i') {
      i++
      if (i < args.length) {
        patchFile = args[i]
      }
    } else if (!arg.startsWith('-')) {
      patchFile = arg
    }
  }

  return { options, patchFile }
}

/**
 * Execute patch (apply diffs) command.
 *
 * Applies a unified diff patch to content. Supports reverse patching (-R),
 * dry-run mode (--dry-run), and path stripping (-p).
 *
 * @param original - Original file content to patch
 * @param patchContent - The patch content (unified diff format)
 * @param options - Patch options (reverse, dryRun, stripLevel)
 * @returns Object with stdout, stderr, exitCode, and optionally result (patched content)
 *
 * @example
 * // Apply a patch
 * const patch = '--- a.txt\n+++ b.txt\n@@ -1,1 +1,2 @@\n line1\n+line2\n'
 * executePatch('line1\n', patch, { dryRun: true })
 */
export function executePatch(
  original: string,
  patchContent: string,
  options: PatchOptions = {}
): { stdout: string; stderr: string; exitCode: number; result?: string } {
  const patches = parseUnifiedPatch(patchContent)

  if (patches.length === 0) {
    return { stdout: '', stderr: 'No valid patches found', exitCode: 1 }
  }

  const patch = patches[0]
  const targetFile = stripPathPrefix(patch.newFile, options.stripLevel || 0)

  const { result, success, message } = applyPatch(original, patch, options)

  if (!success) {
    return { stdout: '', stderr: message, exitCode: 1 }
  }

  const action = options.dryRun ? 'checking' : 'patching'
  return {
    stdout: `${action} file ${targetFile}\n`,
    stderr: '',
    exitCode: 0,
    result: options.dryRun ? original : result,
  }
}

// ============================================================================
// TEE Implementation
// ============================================================================

interface TeeOptions {
  append: boolean
}

/**
 * Parse tee command arguments
 */
function parseTeeArgs(args: string[]): { options: TeeOptions; files: string[] } {
  const options: TeeOptions = { append: false }
  const files: string[] = []

  for (const arg of args) {
    if (arg === '-a' || arg === '--append') {
      options.append = true
    } else if (!arg.startsWith('-')) {
      files.push(arg)
    }
  }

  return { options, files }
}

/**
 * Execute tee (write to multiple outputs) command.
 *
 * Reads from input and writes to both stdout and specified files.
 * Supports append mode (-a).
 *
 * @param input - Input text to process
 * @param args - Command arguments (e.g., ['-a', 'file1.txt', 'file2.txt'])
 * @param fs - Optional filesystem capability for file writing
 * @returns Promise resolving to object with stdout, stderr, and exitCode
 *
 * @example
 * // Write to files while passing through
 * await executeTee('hello\n', ['output.txt'], fs)
 * // => { stdout: 'hello\n', stderr: '', exitCode: 0 }
 */
export async function executeTee(
  input: string,
  args: string[],
  fs?: FsCapability
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { options, files } = parseTeeArgs(args)

  // Write to files if fs is available
  if (fs && files.length > 0) {
    for (const file of files) {
      try {
        if (options.append) {
          const existing = await fs.exists(file) ? await fs.read(file, { encoding: 'utf-8' }) as string : ''
          await fs.write(file, existing + input)
        } else {
          await fs.write(file, input)
        }
      } catch (_error) {
        // Continue with other files
      }
    }
  }

  // Always output to stdout
  return { stdout: input, stderr: '', exitCode: 0 }
}

// ============================================================================
// XARGS Implementation
// ============================================================================

interface XargsOptions {
  maxArgs?: number
  delimiter?: string
  placeholder?: string
  parallel?: number
  prompt?: boolean
  maxChars?: number
}

/**
 * Parse xargs command arguments
 */
function parseXargsArgs(args: string[]): { options: XargsOptions; command: string[] } {
  const options: XargsOptions = {}
  const command: string[] = []
  let foundCommand = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (foundCommand) {
      command.push(arg)
      continue
    }

    if (arg === '-n') {
      i++
      if (i < args.length) {
        options.maxArgs = parseInt(args[i], 10)
      }
    } else if (arg.startsWith('-n')) {
      options.maxArgs = parseInt(arg.slice(2), 10)
    } else if (arg === '-d') {
      i++
      if (i < args.length) {
        options.delimiter = args[i]
      }
    } else if (arg === '-0') {
      options.delimiter = '\0'
    } else if (arg === '-I') {
      i++
      if (i < args.length) {
        options.placeholder = args[i]
      }
    } else if (arg.startsWith('-I')) {
      options.placeholder = arg.slice(2)
    } else if (arg === '-P') {
      i++
      if (i < args.length) {
        options.parallel = parseInt(args[i], 10)
      }
    } else if (arg === '-p') {
      options.prompt = true
    } else if (arg === '-s') {
      i++
      if (i < args.length) {
        options.maxChars = parseInt(args[i], 10)
      }
    } else if (!arg.startsWith('-')) {
      foundCommand = true
      command.push(arg)
    }
  }

  return { options, command }
}

/**
 * Split input into arguments for xargs
 */
function splitXargsInput(input: string, delimiter?: string): string[] {
  if (delimiter === '\0') {
    return input.split('\0').filter(Boolean)
  }
  if (delimiter) {
    return input.split(delimiter).filter(Boolean)
  }
  // Default: split on whitespace and newlines
  return input.split(/[\s\n]+/).filter(Boolean)
}

/**
 * Execute xargs (build and execute command lines) command.
 *
 * Builds and executes command lines from standard input. Supports:
 * - -n (max arguments per command)
 * - -I (placeholder replacement)
 * - -0 (null delimiter for filenames with spaces)
 * - -P (parallel execution)
 * - -s (max command length)
 *
 * @param input - Input containing arguments (one per line or whitespace-separated)
 * @param args - Command arguments (e.g., ['-n', '1', 'echo'])
 * @param executor - Function to execute subcommands
 * @returns Promise resolving to object with stdout, stderr, and exitCode
 *
 * @example
 * // Process one argument at a time
 * await executeXargs('a\nb\nc', ['-n', '1', 'echo'], cmd => exec(cmd))
 * // => { stdout: 'a\nb\nc\n', stderr: '', exitCode: 0 }
 */
export async function executeXargs(
  input: string,
  args: string[],
  executor: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { options, command } = parseXargsArgs(args)

  // Default command is echo
  const baseCommand = command.length > 0 ? command : ['echo']

  // Parse input into arguments
  const inputArgs = splitXargsInput(input, options.delimiter)

  if (inputArgs.length === 0) {
    // Run once with no args
    const cmd = baseCommand.join(' ')
    return executor(cmd)
  }

  const outputs: string[] = []
  const errors: string[] = []
  let exitCode = 0

  if (options.placeholder) {
    // -I mode: run command once per input line, replacing placeholder
    for (const arg of inputArgs) {
      const cmdWithArg = baseCommand.map(c => c.replace(new RegExp(options.placeholder!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), arg)).join(' ')

      if (options.prompt) {
        outputs.push(`${baseCommand[0]} ${arg}?...`)
      }

      const result = await executor(cmdWithArg)
      if (result.stdout) outputs.push(result.stdout.replace(/\n$/, ''))
      if (result.stderr) errors.push(result.stderr)
      if (result.exitCode !== 0) exitCode = 123
    }
  } else if (options.maxArgs) {
    // -n mode: run command with maxArgs arguments at a time
    for (let i = 0; i < inputArgs.length; i += options.maxArgs) {
      const batch = inputArgs.slice(i, i + options.maxArgs)
      const cmd = [...baseCommand, ...batch].join(' ')
      const result = await executor(cmd)
      if (result.stdout) outputs.push(result.stdout.replace(/\n$/, ''))
      if (result.stderr) errors.push(result.stderr)
      if (result.exitCode !== 0) exitCode = 123
    }
  } else if (options.maxChars) {
    // -s mode: limit total command line length
    let currentBatch: string[] = []
    let currentLen = baseCommand.join(' ').length

    for (const arg of inputArgs) {
      if (currentLen + arg.length + 1 > options.maxChars && currentBatch.length > 0) {
        const cmd = [...baseCommand, ...currentBatch].join(' ')
        const result = await executor(cmd)
        if (result.stdout) outputs.push(result.stdout.replace(/\n$/, ''))
        if (result.stderr) errors.push(result.stderr)
        if (result.exitCode !== 0) exitCode = 123
        currentBatch = []
        currentLen = baseCommand.join(' ').length
      }
      currentBatch.push(arg)
      currentLen += arg.length + 1
    }

    if (currentBatch.length > 0) {
      const cmd = [...baseCommand, ...currentBatch].join(' ')
      const result = await executor(cmd)
      if (result.stdout) outputs.push(result.stdout.replace(/\n$/, ''))
      if (result.stderr) errors.push(result.stderr)
      if (result.exitCode !== 0) exitCode = 123
    }
  } else {
    // Default: all args in one command
    const cmd = [...baseCommand, ...inputArgs].join(' ')

    if (options.prompt) {
      outputs.push(`${baseCommand[0]} ${inputArgs.join(' ')}?...`)
    }

    const result = await executor(cmd)
    if (result.stdout) outputs.push(result.stdout.replace(/\n$/, ''))
    if (result.stderr) errors.push(result.stderr)
    exitCode = result.exitCode
  }

  let stdout = outputs.join('\n')
  if (outputs.length > 0) stdout += '\n'

  return { stdout, stderr: errors.join('\n'), exitCode }
}

// ============================================================================
// Exports for TieredExecutor integration
// ============================================================================

export const TEXT_PROCESSING_COMMANDS = new Set(['sed', 'awk', 'diff', 'patch', 'tee', 'xargs'])

/**
 * Check if a command is a text processing command handled by this module.
 *
 * @param cmd - Command name to check
 * @returns True if the command is handled by this module
 *
 * @example
 * isTextProcessingCommand('sed')  // => true
 * isTextProcessingCommand('ls')   // => false
 */
export function isTextProcessingCommand(cmd: string): boolean {
  return TEXT_PROCESSING_COMMANDS.has(cmd)
}
