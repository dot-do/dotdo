/**
 * Output Formatting Utilities
 *
 * Shared utilities for consistent CLI console output formatting.
 * Extracts repeated patterns from commands for DRY code.
 */

/**
 * Format a section header with consistent styling
 * @param title - The section title
 * @returns Formatted section header string
 */
export function formatSectionHeader(title: string): string {
  return `\n  ${title}:\n`
}

/**
 * Format array items as a bulleted list
 * @param items - Array of items to format
 * @param indent - Number of spaces for indentation (default: 4)
 * @returns Formatted list string
 */
export function formatList(items: string[], indent = 4): string {
  if (items.length === 0) return ''
  const prefix = ' '.repeat(indent)
  return items.map((item) => `${prefix}\u2022 ${item}`).join('\n')
}

/**
 * Format key-value pairs with aligned columns
 * @param pairs - Array of [key, value] tuples
 * @param keyWidth - Width for key column padding (default: 8)
 * @param indent - Number of spaces for indentation (default: 4)
 * @returns Formatted key-value string
 */
export function formatKeyValue(pairs: Array<[string, string]>, keyWidth = 8, indent = 4): string {
  if (pairs.length === 0) return ''
  const prefix = ' '.repeat(indent)
  return pairs.map(([key, value]) => `${prefix}${key.padEnd(keyWidth)} ${value}`).join('\n')
}

/**
 * Format tabular data with headers and aligned columns
 * @param headers - Column header names
 * @param rows - Array of row data (each row is an array of cell values)
 * @param columnWidths - Optional array of fixed column widths
 * @returns Formatted table string
 */
export function formatTable(headers: string[], rows: string[][], columnWidths?: number[]): string {
  if (headers.length === 0) return ''

  // Calculate column widths: use provided widths or calculate from content
  const widths =
    columnWidths ||
    headers.map((header, i) => {
      const maxRowWidth = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0)
      return Math.max(header.length, maxRowWidth)
    })

  // Format header row
  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join('  ')

  // Format separator
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')

  // Format data rows
  const dataRows = rows.map((row) => row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  '))

  return [headerRow, separator, ...dataRows].join('\n')
}

/**
 * Format a URL with a label, consistent padding, and optional configuration status
 * @param label - The URL label (e.g., "App", "Admin")
 * @param url - The URL string
 * @param configured - Whether the URL is configured (default: true)
 * @returns Formatted URL string
 */
export function formatUrl(label: string, url: string, configured = true): string {
  const suffix = configured ? '' : ' (not configured)'
  return `    ${label.padEnd(8)}${url}${suffix}`
}
