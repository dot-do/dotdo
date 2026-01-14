/**
 * Output capture utilities for Python code execution
 */

/**
 * Redirect print() calls to a stdout buffer for capture.
 * Adds the __pyx_stdout__ buffer setup and redirects sys.stdout.
 */
export function capturePrint(code: string): string {
  const setup = `import sys
import io
__pyx_stdout__ = io.StringIO()
_original_stdout = sys.stdout
sys.stdout = __pyx_stdout__
`

  return setup + code
}

/**
 * Capture the last expression value as the return value.
 * Assigns the last expression (if it's not an assignment) to __pyx_result__.
 */
export function extractReturnValue(code: string): string {
  const lines = code.split('\n')

  // Find the last non-empty, non-comment line
  let lastExprIndex = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    // Skip empty lines and pure comment lines
    if (!line || line.startsWith('#')) {
      continue
    }

    // Check if this line is an expression (not an assignment, def, class, etc.)
    // Remove trailing comments for analysis
    const codeOnly = line.split('#')[0].trim()

    // Skip if it's a statement keyword
    if (
      codeOnly.startsWith('def ') ||
      codeOnly.startsWith('class ') ||
      codeOnly.startsWith('if ') ||
      codeOnly.startsWith('elif ') ||
      codeOnly.startsWith('else:') ||
      codeOnly.startsWith('for ') ||
      codeOnly.startsWith('while ') ||
      codeOnly.startsWith('try:') ||
      codeOnly.startsWith('except') ||
      codeOnly.startsWith('finally:') ||
      codeOnly.startsWith('with ') ||
      codeOnly.startsWith('return ') ||
      codeOnly.startsWith('raise ') ||
      codeOnly.startsWith('import ') ||
      codeOnly.startsWith('from ') ||
      codeOnly.startsWith('pass') ||
      codeOnly.startsWith('break') ||
      codeOnly.startsWith('continue') ||
      codeOnly.startsWith('@')
    ) {
      break
    }

    // Check if it's an assignment (but not comparison ==, !=, <=, >=)
    // Assignment: contains = but not ==, !=, <=, >=, and not inside a function call
    const isAssignment =
      /^[^=]*(?<![=!<>])=(?!=)/.test(codeOnly) && !codeOnly.includes('==') && !codeOnly.includes('lambda')

    if (!isAssignment) {
      lastExprIndex = i
    }
    break
  }

  if (lastExprIndex === -1) {
    return code
  }

  // Extract the expression (may have trailing comment)
  const originalLine = lines[lastExprIndex]
  const indent = originalLine.match(/^(\s*)/)?.[1] || ''
  const trimmedLine = originalLine.trim()

  // Preserve trailing comment if present
  const commentMatch = trimmedLine.match(/^(.+?)\s*(#.*)$/)
  if (commentMatch) {
    const [, expr, comment] = commentMatch
    lines[lastExprIndex] = `${indent}__pyx_result__ = ${expr}  ${comment}`
  } else {
    lines[lastExprIndex] = `${indent}__pyx_result__ = ${trimmedLine}`
  }

  return lines.join('\n')
}
