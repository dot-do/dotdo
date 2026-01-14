/**
 * Async wrapping utilities for Python code in Pyodide
 */

/**
 * Wrap synchronous Python code in an async function for Pyodide execution.
 * The wrapper function is named __pyx_main__ and properly indents all code.
 */
export function wrapAsync(code: string): string {
  const lines = code.split('\n')
  const indentedLines = lines.map((line) => (line ? '    ' + line : line))
  const indentedCode = indentedLines.join('\n') || '    pass'

  return `async def __pyx_main__():
${indentedCode}
`
}

/**
 * Check if code has top-level await (await outside of async def)
 */
function hasTopLevelAwait(code: string): boolean {
  const lines = code.split('\n')
  let insideAsyncDef = false
  let asyncDefIndent = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Get current indentation
    const currentIndent = line.match(/^(\s*)/)?.[1].length || 0

    // Check if we're entering an async def
    if (trimmed.startsWith('async def ')) {
      insideAsyncDef = true
      asyncDefIndent = currentIndent
      continue
    }

    // Check if we've exited the async def (dedented back to or past async def level)
    if (insideAsyncDef && currentIndent <= asyncDefIndent && !trimmed.startsWith('async def ')) {
      insideAsyncDef = false
    }

    // Check for await at this level
    if (!insideAsyncDef && /\bawait\s+/.test(trimmed)) {
      return true
    }
  }

  return false
}

/**
 * Wrap code containing top-level await in an async context.
 * If no top-level await is detected, returns the code unchanged.
 */
export function wrapTopLevelAwait(code: string): string {
  if (!hasTopLevelAwait(code)) {
    return code
  }

  return wrapAsync(code)
}
