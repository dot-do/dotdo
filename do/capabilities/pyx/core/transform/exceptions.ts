/**
 * Exception handling utilities for Python code execution
 */

/**
 * Wrap code in try/except to capture and serialize exceptions.
 * Captures exception type, message, and traceback in __pyx_error__.
 */
export function wrapExceptions(code: string): string {
  const lines = code.split('\n')
  const indentedLines = lines.map((line) => (line ? '    ' + line : line))
  const indentedCode = indentedLines.join('\n')

  return `import traceback
__pyx_error__ = None
try:
${indentedCode}
except Exception as __pyx_exc__:
    __pyx_error__ = {
        'type': type(__pyx_exc__).__name__,
        'message': str(__pyx_exc__),
        'traceback': traceback.format_exc()
    }
`
}
