/**
 * parseAndFix Pipeline Stage
 *
 * Parses bash commands into AST and attempts auto-fix for syntax errors.
 * This is an independently callable pipeline stage that can be used
 * standalone or as part of the full MCP pipeline.
 *
 * @module src/mcp/pipeline/parse
 */

import type { Program, ParseError, BashNode, CompoundCommand } from '../../types.js'
import { parse } from '../../ast/parser.js'
import { autoFix, detectErrors, suggestFixes } from '../../ast/fix.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Input for the parseAndFix pipeline stage
 */
export interface ParseInput {
  /** The bash command to parse */
  command: string
}

/**
 * Result from the parseAndFix pipeline stage
 */
export interface ParseResult {
  /** The command (possibly fixed) */
  command: string
  /** The parsed AST, or null if parsing failed */
  ast: Program | null
  /** Parse errors, if any */
  errors: ParseError[]
  /** Whether a fix was applied */
  wasFix: boolean
  /** Suggestions for unfixable errors */
  suggestions: string[]
}

// ============================================================================
// Structural Validation
// ============================================================================

/**
 * Check if a node is a CompoundCommand
 */
function isCompoundCommand(node: BashNode): node is CompoundCommand {
  return node.type === 'CompoundCommand'
}

/**
 * Validate compound command structure (if, for, while, etc.)
 * Returns errors for semantically invalid structures that the parser accepts.
 */
function validateCompoundCommands(ast: Program): ParseError[] {
  const errors: ParseError[] = []

  function validate(node: BashNode): void {
    if (isCompoundCommand(node)) {
      // Check for if/elif/while/until with empty body (missing condition and/or commands)
      if (node.kind === 'if' || node.kind === 'while' || node.kind === 'until') {
        if (node.body.length === 0) {
          errors.push({
            message: `Empty ${node.kind} statement: missing condition and body`,
            line: 1,
            column: 1,
            suggestion: `Add a condition and commands to the ${node.kind} statement`,
          })
        }
      }

      // Check for for loop with empty body
      if (node.kind === 'for') {
        if (node.body.length === 0) {
          errors.push({
            message: 'Empty for loop: missing variable and body',
            line: 1,
            column: 1,
            suggestion: 'Add a variable, list, and commands to the for loop',
          })
        }
      }

      // Recursively check nested compound commands
      for (const child of node.body) {
        validate(child)
      }
    }
  }

  for (const node of ast.body) {
    validate(node)
  }

  return errors
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Parse a bash command into AST and attempt to auto-fix syntax errors.
 *
 * This function:
 * 1. Parses the command using the bash parser
 * 2. If there are errors, attempts to auto-fix them
 * 3. Returns the AST, any remaining errors, and suggestions
 *
 * @example
 * ```typescript
 * // Simple parsing
 * const result = parseAndFix({ command: 'ls -la' })
 * console.log(result.ast)  // Program node
 * console.log(result.errors)  // []
 *
 * // Auto-fix missing quote
 * const result = parseAndFix({ command: 'echo "hello' })
 * console.log(result.wasFix)  // true
 * console.log(result.command)  // 'echo "hello"'
 * ```
 */
export function parseAndFix(input: ParseInput): ParseResult {
  const { command } = input

  // Handle edge cases: empty or whitespace-only commands
  const trimmed = command.trim()
  if (trimmed === '') {
    return {
      command,
      ast: {
        type: 'Program',
        body: [],
      },
      errors: [],
      wasFix: false,
      suggestions: [],
    }
  }

  // Parse the command
  let ast = parse(command)
  let errors = detectErrors(ast)
  let wasFix = false
  let finalCommand = command

  // If there are errors, try to auto-fix
  if (errors.length > 0) {
    const fixResult = autoFix(command)

    if (fixResult) {
      // Apply the fix
      finalCommand = fixResult.command
      wasFix = true

      // Re-parse the fixed command
      ast = parse(finalCommand)
      errors = detectErrors(ast)
    }
  }

  // Perform structural validation to catch semantic errors the parser misses
  const structuralErrors = validateCompoundCommands(ast)
  errors = [...errors, ...structuralErrors]

  // Generate suggestions for any remaining errors
  const suggestions: string[] = []
  if (errors.length > 0) {
    // Get suggestions from the AST fix module
    const fixes = suggestFixes(ast)
    for (const fix of fixes) {
      if (fix.reason) {
        suggestions.push(fix.reason)
      }
    }

    // Also add suggestions from the errors themselves
    for (const error of errors) {
      if (error.suggestion && !suggestions.includes(error.suggestion)) {
        suggestions.push(error.suggestion)
      }
    }
  }

  return {
    command: finalCommand,
    ast,
    errors,
    wasFix,
    suggestions,
  }
}
