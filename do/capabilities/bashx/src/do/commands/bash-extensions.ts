/**
 * Bash 4+ Shell Features
 *
 * Native implementations for bash 4+ shell language features:
 * - Case modification in variable expansion (^, ^^, ,, ,,)
 * - Extended globs (?, *, +, @, !)
 * - Case statement fall-through (;& and ;;&)
 *
 * These features are added to the executor/parser for comprehensive bash support.
 *
 * @module bashx/do/commands/bash-extensions
 */

// ============================================================================
// CASE MODIFICATION IN VARIABLE EXPANSION
// ============================================================================

/**
 * Options for case modification operations
 */
export interface CaseModifyOptions {
  /** Pattern to match for modification (default: all characters) */
  pattern?: string
}

/**
 * Apply case modification to a string value based on bash ${var^}, ${var^^}, ${var,}, ${var,,} syntax
 *
 * Supported modifiers:
 * - ^ : Uppercase first character matching pattern
 * - ^^ : Uppercase all characters matching pattern
 * - , : Lowercase first character matching pattern
 * - ,, : Lowercase all characters matching pattern
 *
 * @param value - The string value to modify
 * @param modifier - The modification operator (^, ^^, ,, ,,)
 * @param pattern - Optional pattern to match (glob-like, default: matches all)
 * @returns Modified string
 *
 * @example
 * ```typescript
 * applyCaseModification('hello', '^')       // => 'Hello'
 * applyCaseModification('hello', '^^')      // => 'HELLO'
 * applyCaseModification('HELLO', ',')       // => 'hELLO'
 * applyCaseModification('HELLO', ',,')      // => 'hello'
 * applyCaseModification('hello world', '^^', '[hw]')  // => 'Hello World' (only h and w)
 * ```
 */
export function applyCaseModification(
  value: string,
  modifier: '^' | '^^' | ',' | ',,',
  pattern?: string
): string {
  if (!value) return value

  // Build a test function for whether a character matches the pattern
  const matchesPattern = pattern
    ? createPatternMatcher(pattern)
    : () => true // No pattern = match all

  switch (modifier) {
    case '^':
      // Uppercase first character (if it matches pattern)
      for (let i = 0; i < value.length; i++) {
        if (matchesPattern(value[i])) {
          return value.slice(0, i) + value[i].toUpperCase() + value.slice(i + 1)
        }
      }
      return value

    case '^^':
      // Uppercase all matching characters
      return value
        .split('')
        .map((char) => (matchesPattern(char) ? char.toUpperCase() : char))
        .join('')

    case ',':
      // Lowercase first character (if it matches pattern)
      for (let i = 0; i < value.length; i++) {
        if (matchesPattern(value[i])) {
          return value.slice(0, i) + value[i].toLowerCase() + value.slice(i + 1)
        }
      }
      return value

    case ',,':
      // Lowercase all matching characters
      return value
        .split('')
        .map((char) => (matchesPattern(char) ? char.toLowerCase() : char))
        .join('')

    default:
      return value
  }
}

/**
 * Create a character matcher from a bash pattern
 *
 * @param pattern - Bash-style pattern (can include [abc], ?, *)
 * @returns Function that tests if a character matches
 */
function createPatternMatcher(pattern: string): (char: string) => boolean {
  // Handle bracket expressions [abc], [a-z], [!abc]
  if (pattern.startsWith('[') && pattern.endsWith(']')) {
    const inner = pattern.slice(1, -1)
    const negated = inner.startsWith('!') || inner.startsWith('^')
    const chars = negated ? inner.slice(1) : inner

    // Build character set including ranges
    const charSet = new Set<string>()
    for (let i = 0; i < chars.length; i++) {
      if (i + 2 < chars.length && chars[i + 1] === '-') {
        // Character range
        const start = chars.charCodeAt(i)
        const end = chars.charCodeAt(i + 2)
        for (let c = start; c <= end; c++) {
          charSet.add(String.fromCharCode(c))
        }
        i += 2
      } else {
        charSet.add(chars[i])
      }
    }

    return negated
      ? (char: string) => !charSet.has(char)
      : (char: string) => charSet.has(char)
  }

  // Handle ? (any single character)
  if (pattern === '?') {
    return () => true
  }

  // Handle * (any characters) - in this context, matches any single char
  if (pattern === '*') {
    return () => true
  }

  // Literal pattern - match the specific character
  return (char: string) => char === pattern
}

/**
 * Expand a variable reference with bash 4+ case modification support
 *
 * Supported syntax:
 * - ${var^}   : Uppercase first character
 * - ${var^^}  : Uppercase all characters
 * - ${var^pattern}  : Uppercase first character matching pattern
 * - ${var^^pattern} : Uppercase all characters matching pattern
 * - ${var,}   : Lowercase first character
 * - ${var,,}  : Lowercase all characters
 * - ${var,pattern}  : Lowercase first character matching pattern
 * - ${var,,pattern} : Lowercase all characters matching pattern
 *
 * @param expression - The parameter expansion expression (without ${...})
 * @param env - Environment variables map
 * @returns Expanded value
 *
 * @example
 * ```typescript
 * const env = { NAME: 'hello' }
 * expandWithCaseModification('NAME^', env)    // => 'Hello'
 * expandWithCaseModification('NAME^^', env)   // => 'HELLO'
 * ```
 */
export function expandWithCaseModification(
  expression: string,
  env: Record<string, string>
): string {
  // Parse case modification pattern: VAR^, VAR^^, VAR,, VAR,,, VAR^pattern, etc.
  const caseModMatch = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)(\^{1,2}|,{1,2})(.*)$/)
  if (caseModMatch) {
    const varName = caseModMatch[1]
    const modifier = caseModMatch[2] as '^' | '^^' | ',' | ',,'
    const pattern = caseModMatch[3] || undefined

    const value = env[varName] ?? ''
    return applyCaseModification(value, modifier, pattern)
  }

  // No case modification, return plain variable value
  const simpleMatch = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)
  if (simpleMatch) {
    return env[simpleMatch[1]] ?? ''
  }

  return ''
}

// ============================================================================
// EXTENDED GLOBS
// ============================================================================

/**
 * Extended glob patterns supported by bash with extglob
 */
export type ExtGlobPattern =
  | '?(' // Zero or one occurrence
  | '*(' // Zero or more occurrences
  | '+(' // One or more occurrences
  | '@(' // Exactly one occurrence
  | '!(' // Anything except

/**
 * Check if extglob is enabled (simulated)
 */
let extglobEnabled = true

/**
 * Enable or disable extglob mode
 *
 * @param enabled - Whether to enable extglob
 */
export function setExtglob(enabled: boolean): void {
  extglobEnabled = enabled
}

/**
 * Get current extglob state
 */
export function isExtglobEnabled(): boolean {
  return extglobEnabled
}

/**
 * Convert a bash extended glob pattern to a regular expression
 *
 * Extended glob patterns:
 * - ?(pattern-list) : Matches zero or one occurrence of the patterns
 * - *(pattern-list) : Matches zero or more occurrences of the patterns
 * - +(pattern-list) : Matches one or more occurrences of the patterns
 * - @(pattern-list) : Matches one of the patterns
 * - !(pattern-list) : Matches anything except one of the patterns
 *
 * @param pattern - Extended glob pattern
 * @returns Equivalent regular expression
 *
 * @example
 * ```typescript
 * extGlobToRegex('*.+(js|ts)')    // Matches *.js, *.ts, *.jsts, etc.
 * extGlobToRegex('file@(1|2).txt')  // Matches file1.txt or file2.txt
 * extGlobToRegex('!(*.txt)')        // Matches anything except *.txt
 * ```
 */
export function extGlobToRegex(pattern: string): RegExp {
  if (!extglobEnabled) {
    // Without extglob, treat as literal pattern (escape special regex chars)
    return new RegExp('^' + escapeRegex(pattern) + '$')
  }

  let result = '^'
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]
    const nextChar = pattern[i + 1]

    // Check for extended glob patterns
    if ((char === '?' || char === '*' || char === '+' || char === '@' || char === '!') && nextChar === '(') {
      const closeIdx = findMatchingParen(pattern, i + 1)
      if (closeIdx === -1) {
        // No matching paren, treat as literal
        result += escapeRegex(char)
        i++
        continue
      }

      const alternatives = pattern.slice(i + 2, closeIdx)
      const altRegex = alternatives.split('|').map(alt => globPartToRegex(alt)).join('|')

      switch (char) {
        case '?':
          // Zero or one
          result += `(?:${altRegex})?`
          break
        case '*':
          // Zero or more
          result += `(?:${altRegex})*`
          break
        case '+':
          // One or more
          result += `(?:${altRegex})+`
          break
        case '@':
          // Exactly one
          result += `(?:${altRegex})`
          break
        case '!':
          // Anything except - negative lookahead
          result += `(?!(?:${altRegex})$).*`
          break
      }

      i = closeIdx + 1
      continue
    }

    // Regular glob patterns
    if (char === '*') {
      result += '.*'
    } else if (char === '?') {
      result += '.'
    } else if (char === '[') {
      // Bracket expression
      const closeIdx = pattern.indexOf(']', i + 1)
      if (closeIdx === -1) {
        result += '\\['
      } else {
        result += pattern.slice(i, closeIdx + 1)
        i = closeIdx
      }
    } else {
      result += escapeRegex(char)
    }

    i++
  }

  result += '$'
  return new RegExp(result)
}

/**
 * Find the matching closing parenthesis
 */
function findMatchingParen(str: string, openIdx: number): number {
  let depth = 1
  for (let i = openIdx + 1; i < str.length; i++) {
    if (str[i] === '(') depth++
    else if (str[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Convert a glob part (inside extended glob) to regex
 */
function globPartToRegex(part: string): string {
  let result = ''
  for (let i = 0; i < part.length; i++) {
    const char = part[i]
    if (char === '*') {
      result += '.*'
    } else if (char === '?') {
      result += '.'
    } else if (char === '[') {
      const closeIdx = part.indexOf(']', i + 1)
      if (closeIdx === -1) {
        result += '\\['
      } else {
        result += part.slice(i, closeIdx + 1)
        i = closeIdx
      }
    } else {
      result += escapeRegex(char)
    }
  }
  return result
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match a string against an extended glob pattern
 *
 * @param str - String to test
 * @param pattern - Extended glob pattern
 * @returns Whether the string matches the pattern
 *
 * @example
 * ```typescript
 * matchExtGlob('file.js', '*.+(js|ts)')     // true
 * matchExtGlob('file.txt', '*.+(js|ts)')    // false
 * matchExtGlob('file1.txt', 'file@(1|2).txt')  // true
 * matchExtGlob('file3.txt', 'file@(1|2).txt')  // false
 * ```
 */
export function matchExtGlob(str: string, pattern: string): boolean {
  const regex = extGlobToRegex(pattern)
  return regex.test(str)
}

/**
 * Filter an array of strings by an extended glob pattern
 *
 * @param items - Array of strings to filter
 * @param pattern - Extended glob pattern
 * @returns Matching items
 */
export function filterExtGlob(items: string[], pattern: string): string[] {
  const regex = extGlobToRegex(pattern)
  return items.filter(item => regex.test(item))
}

// ============================================================================
// CASE STATEMENT FALL-THROUGH
// ============================================================================

/**
 * Case terminator types in bash
 */
export type CaseTerminator =
  | ';;'   // Normal termination - stop matching
  | ';&'   // Fall through - execute next clause without testing
  | ';;&'  // Continue testing - test next pattern

/**
 * Represents a single case clause
 */
export interface CaseClause {
  /** Patterns to match (OR'd together) */
  patterns: string[]
  /** Commands to execute if pattern matches */
  commands: string[]
  /** How to terminate this clause */
  terminator: CaseTerminator
}

/**
 * Represents a complete case statement
 */
export interface CaseStatement {
  /** The word being tested */
  word: string
  /** List of case clauses */
  clauses: CaseClause[]
}

/**
 * Result of executing a case statement
 */
export interface CaseResult {
  /** Index of first matched clause */
  matchedIndex: number
  /** Indices of all executed clauses */
  executedIndices: number[]
  /** Commands that would be executed */
  executedCommands: string[][]
}

/**
 * Execute a case statement with fall-through support
 *
 * Case statement terminators:
 * - ;; : Normal termination, stop executing
 * - ;& : Fall through, execute next clause without pattern test
 * - ;;& : Continue testing subsequent patterns
 *
 * @param stmt - The case statement to execute
 * @returns Execution result with matched and executed clauses
 *
 * @example
 * ```typescript
 * const stmt: CaseStatement = {
 *   word: 'yes',
 *   clauses: [
 *     { patterns: ['yes', 'y'], commands: ['echo positive'], terminator: ';&' },
 *     { patterns: ['no', 'n'], commands: ['echo negative'], terminator: ';;' },
 *     { patterns: ['*'], commands: ['echo unknown'], terminator: ';;' },
 *   ]
 * }
 *
 * executeCaseStatement(stmt)
 * // First clause matches 'yes', falls through to second
 * // => { matchedIndex: 0, executedIndices: [0, 1], executedCommands: [['echo positive'], ['echo negative']] }
 * ```
 */
export function executeCaseStatement(stmt: CaseStatement): CaseResult {
  const result: CaseResult = {
    matchedIndex: -1,
    executedIndices: [],
    executedCommands: [],
  }

  let i = 0
  let shouldExecuteNext = false

  while (i < stmt.clauses.length) {
    const clause = stmt.clauses[i]
    let matches = false

    if (shouldExecuteNext) {
      // Fall-through from previous clause - execute without testing
      matches = true
    } else {
      // Test patterns
      for (const pattern of clause.patterns) {
        if (matchCasePattern(stmt.word, pattern)) {
          matches = true
          if (result.matchedIndex === -1) {
            result.matchedIndex = i
          }
          break
        }
      }
    }

    if (matches) {
      result.executedIndices.push(i)
      result.executedCommands.push(clause.commands)

      switch (clause.terminator) {
        case ';;':
          // Normal termination - stop
          return result

        case ';&':
          // Fall through - execute next clause unconditionally
          shouldExecuteNext = true
          break

        case ';;&':
          // Continue testing - reset flag, continue loop
          shouldExecuteNext = false
          break
      }
    } else {
      // Pattern didn't match, reset fall-through flag
      shouldExecuteNext = false
    }

    i++
  }

  return result
}

/**
 * Match a word against a case pattern
 *
 * Case patterns support:
 * - Glob patterns (*, ?, [...])
 * - Extended globs if extglob is enabled
 * - Multiple patterns with | (OR)
 *
 * @param word - The word to test
 * @param pattern - The pattern to match against
 * @returns Whether the word matches the pattern
 */
export function matchCasePattern(word: string, pattern: string): boolean {
  // Handle multiple patterns with |
  if (pattern.includes('|') && !pattern.startsWith('@(')) {
    const patterns = pattern.split('|')
    return patterns.some(p => matchCasePattern(word, p.trim()))
  }

  // Use extended glob matching if enabled
  if (extglobEnabled && /[?*+@!]\(/.test(pattern)) {
    return matchExtGlob(word, pattern)
  }

  // Convert simple glob to regex
  const regex = extGlobToRegex(pattern)
  return regex.test(word)
}

/**
 * Parse a case statement from tokens
 *
 * @param word - The word being tested
 * @param clauses - Raw clause data
 * @returns Parsed case statement
 */
export function parseCaseStatement(
  word: string,
  clauses: Array<{
    patterns: string[]
    commands: string[]
    terminator: string
  }>
): CaseStatement {
  return {
    word,
    clauses: clauses.map(c => ({
      patterns: c.patterns,
      commands: c.commands,
      terminator: normalizeCaseTerminator(c.terminator),
    })),
  }
}

/**
 * Normalize a case terminator string
 */
function normalizeCaseTerminator(terminator: string): CaseTerminator {
  const normalized = terminator.trim()
  if (normalized === ';&') return ';&'
  if (normalized === ';;&') return ';;&'
  return ';;'
}

// ============================================================================
// VARIABLE EXPANSION ENGINE (combining all features)
// ============================================================================

/**
 * Full variable expansion with bash 4+ features
 *
 * Supports:
 * - Simple expansion: $VAR, ${VAR}
 * - Default values: ${VAR:-default}, ${VAR:=default}
 * - Error if unset: ${VAR:?error message}
 * - Alternate value: ${VAR:+alternate}
 * - Case modification: ${VAR^}, ${VAR^^}, ${VAR,}, ${VAR,,}
 * - Substring: ${VAR:offset}, ${VAR:offset:length}
 * - Pattern removal: ${VAR#pattern}, ${VAR##pattern}, ${VAR%pattern}, ${VAR%%pattern}
 * - Pattern replacement: ${VAR/pattern/replacement}, ${VAR//pattern/replacement}
 * - Length: ${#VAR}
 *
 * @param template - Template string with variable references
 * @param env - Environment variables
 * @returns Expanded string
 */
export function expandVariables(template: string, env: Record<string, string>): string {
  let result = template

  // Handle escaped dollar signs: $$ -> $
  result = result.replace(/\$\$/g, '\x00ESCAPED_DOLLAR\x00')

  // Handle ${...} expansions
  result = result.replace(/\$\{([^}]+)\}/g, (_match, expr) => {
    return expandBracedVariable(expr, env)
  })

  // Handle simple $VAR expansions
  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, varName) => {
    return env[varName] ?? ''
  })

  // Restore escaped dollar signs
  result = result.replace(/\x00ESCAPED_DOLLAR\x00/g, '$')

  return result
}

/**
 * Expand a braced variable expression ${...}
 */
function expandBracedVariable(expr: string, env: Record<string, string>): string {
  // Length operator: ${#VAR}
  const lengthMatch = expr.match(/^#([A-Za-z_][A-Za-z0-9_]*)$/)
  if (lengthMatch) {
    return String((env[lengthMatch[1]] ?? '').length)
  }

  // Case modification: ${VAR^}, ${VAR^^}, ${VAR,}, ${VAR,,}
  const caseModMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)(\^{1,2}|,{1,2})(.*)$/)
  if (caseModMatch) {
    const value = env[caseModMatch[1]] ?? ''
    const modifier = caseModMatch[2] as '^' | '^^' | ',' | ',,'
    const pattern = caseModMatch[3] || undefined
    return applyCaseModification(value, modifier, pattern)
  }

  // Substring: ${VAR:offset} or ${VAR:offset:length}
  const substringMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*):(-?\d+)(?::(-?\d+))?$/)
  if (substringMatch) {
    const value = env[substringMatch[1]] ?? ''
    let offset = parseInt(substringMatch[2], 10)
    const length = substringMatch[3] ? parseInt(substringMatch[3], 10) : undefined

    // Handle negative offset (from end)
    if (offset < 0) {
      offset = Math.max(0, value.length + offset)
    }

    if (length !== undefined) {
      if (length < 0) {
        // Negative length means exclude that many chars from end
        return value.slice(offset, value.length + length)
      }
      return value.slice(offset, offset + length)
    }
    return value.slice(offset)
  }

  // Pattern removal: ${VAR#pattern}, ${VAR##pattern}, ${VAR%pattern}, ${VAR%%pattern}
  const patternRemovalMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)(#{1,2}|%{1,2})(.+)$/)
  if (patternRemovalMatch) {
    const value = env[patternRemovalMatch[1]] ?? ''
    const operator = patternRemovalMatch[2]
    const pattern = patternRemovalMatch[3]
    return removePattern(value, operator, pattern)
  }

  // Pattern replacement: ${VAR/pattern/replacement} or ${VAR//pattern/replacement}
  const replaceMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)(\/\/?)(.*?)\/(.*)$/)
  if (replaceMatch) {
    const value = env[replaceMatch[1]] ?? ''
    const replaceAll = replaceMatch[2] === '//'
    const pattern = replaceMatch[3]
    const replacement = replaceMatch[4]
    return replacePattern(value, pattern, replacement, replaceAll)
  }

  // Default value operators: ${VAR:-default}, ${VAR:=default}, ${VAR:?error}, ${VAR:+alternate}
  const defaultMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*):?([-=?+])(.*)$/)
  if (defaultMatch) {
    const varName = defaultMatch[1]
    const hasColon = expr.includes(':' + defaultMatch[2])
    const operator = defaultMatch[2]
    const operand = defaultMatch[3]
    const value = env[varName]
    const isEmpty = hasColon
      ? value === undefined || value === ''
      : value === undefined

    switch (operator) {
      case '-':
        return isEmpty ? operand : (value ?? '')
      case '=':
        // In real bash, this would set the variable - we just return the value
        return isEmpty ? operand : (value ?? '')
      case '?':
        if (isEmpty) {
          throw new Error(`${varName}: ${operand || 'parameter null or not set'}`)
        }
        return value ?? ''
      case '+':
        return isEmpty ? '' : operand
    }
  }

  // Simple variable reference
  const simpleMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)
  if (simpleMatch) {
    return env[simpleMatch[1]] ?? ''
  }

  // Unknown expression, return as-is
  return '${' + expr + '}'
}

/**
 * Remove pattern from value (for # ## % %% operators)
 */
function removePattern(value: string, operator: string, pattern: string): string {
  // Create anchored regex for full match testing
  const regex = globToRegex(pattern, '', true)

  switch (operator) {
    case '#':
      // Remove shortest match from start
      for (let i = 1; i <= value.length; i++) {
        const prefix = value.slice(0, i)
        if (regex.test(prefix)) {
          return value.slice(i)
        }
      }
      return value

    case '##':
      // Remove longest match from start
      for (let i = value.length; i >= 1; i--) {
        const prefix = value.slice(0, i)
        if (regex.test(prefix)) {
          return value.slice(i)
        }
      }
      return value

    case '%':
      // Remove shortest match from end
      for (let i = value.length - 1; i >= 0; i--) {
        const suffix = value.slice(i)
        if (regex.test(suffix)) {
          return value.slice(0, i)
        }
      }
      return value

    case '%%':
      // Remove longest match from end
      for (let i = 0; i < value.length; i++) {
        const suffix = value.slice(i)
        if (regex.test(suffix)) {
          return value.slice(0, i)
        }
      }
      return value

    default:
      return value
  }
}

/**
 * Replace pattern in value
 */
function replacePattern(value: string, pattern: string, replacement: string, replaceAll: boolean): string {
  const regex = globToRegex(pattern, replaceAll ? 'g' : '')

  // Handle special replacement patterns
  const processedReplacement = replacement
    .replace(/&/g, '$&')  // & means matched text in bash

  return value.replace(regex, processedReplacement)
}

/**
 * Convert a simple glob pattern to regex (for pattern operations)
 *
 * @param pattern - Glob pattern to convert
 * @param flags - Regex flags
 * @param anchored - Whether to anchor with ^ and $ for full match
 */
function globToRegex(pattern: string, flags = '', anchored = false): RegExp {
  let result = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      result += '.*'
    } else if (char === '?') {
      result += '.'
    } else if (char === '[') {
      const closeIdx = pattern.indexOf(']', i + 1)
      if (closeIdx === -1) {
        result += '\\['
      } else {
        result += pattern.slice(i, closeIdx + 1)
        i = closeIdx
      }
    } else {
      result += escapeRegex(char)
    }
  }

  if (anchored) {
    result = '^' + result + '$'
  }

  return new RegExp(result, flags)
}

