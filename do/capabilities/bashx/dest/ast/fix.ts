/**
 * AST Error Detection and Fixing
 *
 * Uses AST errors to detect and suggest fixes for malformed commands.
 * Handles:
 * - Unclosed quotes (single and double)
 * - Missing terminators (fi, done, esac)
 * - Unbalanced brackets/braces
 * - Invalid pipe/redirect syntax
 */

import type { Program, ParseError, Fix } from '../types.js'
import { parse } from './parser.js'

// ============================================================================
// Error Detection
// ============================================================================

/**
 * Detect errors in a parsed AST
 */
export function detectErrors(ast: Program): ParseError[] {
  return ast.errors ?? []
}

// ============================================================================
// Fix Suggestion
// ============================================================================

/**
 * Error type classification for suggesting fixes
 */
interface ErrorClassification {
  type:
    | 'unclosed_quote'
    | 'missing_terminator'
    | 'unbalanced_brace'
    | 'unbalanced_bracket'
    | 'unbalanced_paren'
    | 'unbalanced_arithmetic'
    | 'unbalanced_subst'
    | 'incomplete_pipe'
    | 'invalid_pipe_start'
    | 'incomplete_redirect'
    | 'consecutive_pipes'
    | 'consecutive_redirects'
    | 'incomplete_list'
    | 'unexpected_token'
    | 'unknown'
  fixable: boolean
  fix?: Fix
}

/**
 * Classify an error and determine if it's fixable
 */
function classifyError(error: ParseError, input: string): ErrorClassification {
  const msg = error.message.toLowerCase()

  // Unclosed quotes
  if (msg.includes('unclosed') && msg.includes('quote')) {
    const isDouble = msg.includes('double')
    const isSingle = msg.includes('single')
    const quoteChar = isDouble ? '"' : isSingle ? "'" : '"'

    return {
      type: 'unclosed_quote',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: quoteChar,
        reason: `Close ${isDouble ? 'double' : isSingle ? 'single' : ''} quote`,
      },
    }
  }

  // Missing terminators
  if (msg.includes('missing') && msg.includes('fi')) {
    return {
      type: 'missing_terminator',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: '; fi',
        reason: "Add 'fi' to close if statement",
      },
    }
  }

  if (msg.includes('missing') && msg.includes('done')) {
    return {
      type: 'missing_terminator',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: '; done',
        reason: "Add 'done' to close loop",
      },
    }
  }

  if (msg.includes('missing') && msg.includes('esac')) {
    // Case statements need ;; before esac if missing
    const needsPatternEnd = !input.includes(';;')
    return {
      type: 'missing_terminator',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: needsPatternEnd ? ' ;; esac' : '; esac',
        reason: "Add 'esac' to close case statement",
      },
    }
  }

  // Unbalanced braces
  if (msg.includes('brace') || (msg.includes('${') && msg.includes('unclosed'))) {
    return {
      type: 'unbalanced_brace',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: '}',
        reason: 'Close brace in parameter expansion',
      },
    }
  }

  // Unbalanced subshell
  if (msg.includes('subshell') || (msg.includes('(') && msg.includes('missing') && msg.includes(')'))) {
    return {
      type: 'unbalanced_paren',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: ' )',
        reason: 'Close subshell',
      },
    }
  }

  // Unbalanced arithmetic
  if (msg.includes('arithmetic') || msg.includes('$((')) {
    return {
      type: 'unbalanced_arithmetic',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: ')',
        reason: 'Close arithmetic expansion',
      },
    }
  }

  // Unbalanced command substitution
  if (msg.includes('command substitution') || (msg.includes('$(') && !msg.includes('$(('))) {
    return {
      type: 'unbalanced_subst',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: ')',
        reason: 'Close command substitution',
      },
    }
  }

  // Unbalanced [[ test
  if (msg.includes('[[') || (msg.includes('test') && msg.includes(']]'))) {
    return {
      type: 'unbalanced_bracket',
      fixable: true,
      fix: {
        type: 'insert',
        position: 'end',
        value: ' ]]',
        reason: 'Close [[ test expression',
      },
    }
  }

  // Incomplete pipe
  if (msg.includes('pipe') && (msg.includes('incomplete') || msg.includes('missing command after'))) {
    return {
      type: 'incomplete_pipe',
      fixable: false,
    }
  }

  // Pipe at start
  if (msg.includes('pipe') && (msg.includes('start') || msg.includes('before'))) {
    return {
      type: 'invalid_pipe_start',
      fixable: false,
    }
  }

  // Incomplete redirect
  if (msg.includes('redirect') && (msg.includes('incomplete') || msg.includes('missing file'))) {
    return {
      type: 'incomplete_redirect',
      fixable: false,
    }
  }

  // Consecutive pipes
  if (msg.includes('consecutive') && msg.includes('pipe')) {
    // Find the position of the consecutive pipe
    const pipeMatch = input.match(/\|\s*\|/)
    if (pipeMatch && pipeMatch.index !== undefined) {
      return {
        type: 'consecutive_pipes',
        fixable: true,
        fix: {
          type: 'delete',
          position: pipeMatch.index + pipeMatch[0].indexOf('|', 1),
          value: '| ',
          reason: 'Remove extra pipe',
        },
      }
    }
    return {
      type: 'consecutive_pipes',
      fixable: false,
    }
  }

  // Consecutive redirects
  if (msg.includes('consecutive') && msg.includes('redirect')) {
    return {
      type: 'consecutive_redirects',
      fixable: false,
    }
  }

  // Incomplete AND/OR list
  if (msg.includes('incomplete') && (msg.includes('and') || msg.includes('or') || msg.includes('&&') || msg.includes('||'))) {
    return {
      type: 'incomplete_list',
      fixable: false,
    }
  }

  // Unexpected token (like semicolon at start)
  if (msg.includes('unexpected') && msg.includes('semicolon')) {
    return {
      type: 'unexpected_token',
      fixable: true,
      fix: {
        type: 'delete',
        position: 0,
        value: '; ',
        reason: 'Remove unexpected semicolon',
      },
    }
  }

  return {
    type: 'unknown',
    fixable: false,
  }
}

/**
 * Suggest fixes for detected errors
 */
export function suggestFixes(ast: Program): Fix[] {
  const errors = detectErrors(ast)
  const fixes: Fix[] = []

  // Get the original input from the AST (we need to reconstruct it for position calculation)
  // For now, we'll work with error messages and suggestions

  for (const error of errors) {
    // Try to get fix from error suggestion
    if (error.suggestion) {
      // Parse the suggestion to create a fix
      const suggestion = error.suggestion.toLowerCase()

      if (suggestion.includes('add') && suggestion.includes('closing')) {
        // Determine what to close based on the message
        let value = ''

        if (suggestion.includes('"') || error.message.toLowerCase().includes('double')) {
          value = '"'
        } else if (suggestion.includes("'") || error.message.toLowerCase().includes('single')) {
          value = "'"
        } else if (suggestion.includes('}')) {
          value = '}'
        } else if (suggestion.includes(')')) {
          value = ')'
        } else if (suggestion.includes(']]')) {
          value = ' ]]'
        } else if (suggestion.includes('fi')) {
          value = '; fi'
        } else if (suggestion.includes('done')) {
          value = '; done'
        } else if (suggestion.includes('esac')) {
          value = ' ;; esac'
        }

        if (value) {
          fixes.push({
            type: 'insert',
            position: 'end',
            value,
            reason: error.suggestion,
          })
        }
      } else if (suggestion.includes('remove')) {
        fixes.push({
          type: 'delete',
          position: error.column - 1, // Convert 1-based to 0-based
          value: '',
          reason: error.suggestion,
        })
      }
    }
  }

  return fixes
}

// ============================================================================
// Fix Application
// ============================================================================

/**
 * Apply fixes to generate corrected command
 */
export function applyFixes(input: string, fixes: Fix[]): string {
  if (fixes.length === 0) {
    return input
  }

  let result = input

  // Sort fixes by position (reverse order for numeric positions to avoid offset issues)
  const sortedFixes = [...fixes].sort((a, b) => {
    const posA = typeof a.position === 'number' ? a.position : (a.position === 'end' ? Infinity : -Infinity)
    const posB = typeof b.position === 'number' ? b.position : (b.position === 'end' ? Infinity : -Infinity)
    return posB - posA // Reverse order
  })

  for (const fix of sortedFixes) {
    switch (fix.type) {
      case 'insert': {
        if (fix.position === 'end') {
          result = result + fix.value
        } else if (fix.position === 'start') {
          result = fix.value + result
        } else if (typeof fix.position === 'number') {
          result = result.slice(0, fix.position) + fix.value + result.slice(fix.position)
        }
        break
      }

      case 'delete': {
        if (typeof fix.position === 'number' && fix.value) {
          const deleteLength = fix.value.length
          result = result.slice(0, fix.position) + result.slice(fix.position + deleteLength)
        }
        break
      }

      case 'replace': {
        if (typeof fix.position === 'number' && fix.value) {
          // Find the text to replace around the position
          // For consecutive pipes: "echo | | cat" -> "echo | cat"
          const before = result.slice(0, fix.position)
          const after = result.slice(fix.position)

          // Find the duplicate operator
          const match = after.match(/^(\|\s*\||\>\s*\>)/)
          if (match) {
            result = before + fix.value + after.slice(match[0].length)
          } else {
            // Simple replacement at position
            result = before + fix.value + after.slice(fix.value.length)
          }
        }
        break
      }
    }
  }

  return result
}

// ============================================================================
// Auto-Fix
// ============================================================================

/**
 * Analyze input and generate fixes based on error patterns
 */
function analyzeAndGenerateFixes(input: string, errors: ParseError[]): Fix[] {
  const fixes: Fix[] = []

  for (const error of errors) {
    const classification = classifyError(error, input)

    if (classification.fixable && classification.fix) {
      fixes.push(classification.fix)
    }
  }

  // Handle special cases that need input analysis

  // Check for unclosed quotes in parameter expansion
  if (input.includes('${') && input.includes(':-"') && !input.match(/\$\{[^}]*:-"[^"]*"\}/)) {
    // Parameter expansion with unclosed quote inside
    const existingQuoteFix = fixes.find(f => f.value === '"')
    if (!existingQuoteFix) {
      // Add close for inner quote + brace
      fixes.push({
        type: 'insert',
        position: 'end',
        value: '"}',
        reason: 'Close quote and brace in parameter expansion',
      })
      // Remove any existing brace-only fix
      const braceFixIndex = fixes.findIndex(f => f.value === '}')
      if (braceFixIndex !== -1) {
        fixes.splice(braceFixIndex, 1)
      }
    }
  }

  // Check for arithmetic inside quotes
  if (input.includes('"') && input.includes('$((') && !input.includes('))')) {
    // Check if quote is not closed around arithmetic
    const match = input.match(/"[^"]*\$\(\([^)]*\)?$/)
    if (match) {
      // Need to close arithmetic AND quote
      const existingFixes = fixes.filter(f => f.value === ')' || f.value === '"')
      if (existingFixes.length < 2) {
        // Replace with combined fix
        const fixIndex = fixes.findIndex(f => f.value === ')' || f.value === '"')
        if (fixIndex !== -1) {
          fixes.splice(fixIndex, 1)
        }
        fixes.push({
          type: 'insert',
          position: 'end',
          value: '))"',
          reason: 'Close arithmetic expansion and quote',
        })
      }
    }
  }

  // Handle [ without ] (test command)
  if (input.match(/\[\s+[^\]]*$/) && !input.includes('[[')) {
    // Single bracket test without closing
    const hasBracketFix = fixes.some(f => f.value?.includes(']'))
    if (!hasBracketFix) {
      fixes.push({
        type: 'insert',
        position: 'end',
        value: ' ]',
        reason: 'Close [ test bracket',
      })
    }
  }

  return fixes
}

/**
 * Attempt to auto-fix a malformed command
 */
export function autoFix(input: string): { command: string; changes: Fix[] } | null {
  const ast = parse(input)
  const errors = detectErrors(ast)

  // If no errors, nothing to fix
  if (errors.length === 0) {
    return null
  }

  // Generate fixes based on errors
  const fixes = analyzeAndGenerateFixes(input, errors)

  // If no fixable errors, return null
  if (fixes.length === 0) {
    return null
  }

  // Apply fixes
  const fixed = applyFixes(input, fixes)

  // Verify the fix worked
  const fixedAst = parse(fixed)
  const remainingErrors = detectErrors(fixedAst)

  // If still has errors, check if we reduced them or made progress
  if (remainingErrors.length >= errors.length) {
    // Fix didn't help, might be unfixable
    // But still return the attempt for some cases
    const unfixableTypes = [
      'incomplete_pipe',
      'invalid_pipe_start',
      'incomplete_redirect',
      'incomplete_list',
    ]

    const hasOnlyUnfixable = errors.every(e => {
      const classification = classifyError(e, input)
      return unfixableTypes.includes(classification.type)
    })

    if (hasOnlyUnfixable) {
      return null
    }
  }

  // Return the fix result even if not perfect
  if (fixed !== input) {
    return {
      command: fixed,
      changes: fixes,
    }
  }

  return null
}
