/**
 * Code vs Natural Language Detection
 *
 * Uses heuristics to detect whether user input is code or natural language.
 */

export function looksLikeCode(input: string): boolean {
  const trimmed = input.trim()

  // Empty or whitespace-only is not code
  if (!trimmed) {
    return false
  }

  // Natural language indicators - check these FIRST
  // If input starts with common NL patterns, treat as natural language
  const nlStarters =
    /^(please|help|what|how|why|when|where|who|which|can|could|would|should|explain|create|list|deploy|run the)\b/i

  if (nlStarters.test(trimmed)) {
    return false
  }

  // Code patterns
  const codePatterns = [
    /=>/, // arrow function
    /\breturn\s/, // return statement
    /^\w+\.\w+\(/, // method call at start (Math.sqrt, console.log)
    /^const\s|^let\s|^var\s/, // variable declaration
    /^function\s/, // function declaration
    /^async\s+function\s/, // async function declaration
    /^class\s/, // class declaration
    /^import\s|^export\s/, // module syntax
    /^await\s/, // await expression
    /`[^`]*\$\{[^}]*\}[^`]*`/, // template literal with interpolation
    /\?\s*[^:]+\s*:/, // ternary expression
    /===|!==|&&|\|\|/, // comparison/logical operators
    /\.\.\./, // spread operator
    /^\{[^}]*:[^}]*\}$/, // object literal (simple)
    /^\[[^\]]*\]$/, // array literal
    /^\[[^\]]*\]\.\w+\(/, // array with method call
    /\.\w+\([^)]*\)\.\w+\(/, // chained method calls
  ]

  if (codePatterns.some((pattern) => pattern.test(trimmed))) {
    return true
  }

  // Arithmetic expression pattern - more specific
  // Must be primarily operators, digits, parens, and single-letter variables
  if (/^[\w\d\s+\-*/()%^.]+$/.test(trimmed)) {
    // Check if it has arithmetic operators
    if (/[+\-*/]/.test(trimmed)) {
      // Make sure it's not natural language by checking word patterns
      const words = trimmed.split(/\s+/)
      // If all "words" are short (1-2 chars after removing parens) or numbers, it's likely arithmetic
      const looksArithmetic = words.every((w) => {
        // Strip parentheses for length check
        const stripped = w.replace(/[()]/g, '')
        return (
          stripped.length <= 2 ||
          /^[\d.]+$/.test(stripped) ||
          /^[+\-*/()%^]+$/.test(w)
        )
      })
      if (looksArithmetic) {
        return true
      }
    }
  }

  return false
}
