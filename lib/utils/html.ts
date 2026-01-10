/**
 * HTML Utilities
 *
 * Server-side utilities for safe HTML manipulation and XSS prevention.
 */

/**
 * Escapes HTML special characters in a string to prevent XSS attacks.
 *
 * Converts the following characters to their HTML entity equivalents:
 * - `&` -> `&amp;`
 * - `<` -> `&lt;`
 * - `>` -> `&gt;`
 * - `"` -> `&quot;`
 * - `'` -> `&#039;`
 *
 * Use this function when interpolating user-controlled data into HTML
 * to prevent script injection and other XSS vulnerabilities.
 *
 * @param unsafe - The raw string that may contain HTML special characters
 * @returns The escaped string safe for HTML interpolation
 *
 * @example
 * ```typescript
 * const userInput = '<script>alert("xss")</script>'
 * const safe = escapeHtml(userInput)
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 *
 * // Safe to use in HTML templates
 * const html = `<div>User said: ${safe}</div>`
 * ```
 *
 * @example
 * ```typescript
 * // Safe characters are preserved
 * escapeHtml('Hello, World!') // Returns: 'Hello, World!'
 * escapeHtml('Agent-123')     // Returns: 'Agent-123'
 * ```
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
