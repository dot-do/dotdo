/**
 * Output Formatting Tests - TDD for console output utilities
 *
 * These utilities extract repeated console formatting patterns into shared functions
 * for consistent CLI output across commands.
 */

import { describe, it, expect } from 'vitest'
import {
  formatSectionHeader,
  formatList,
  formatKeyValue,
  formatTable,
  formatUrl,
} from '../utils/output'

describe('formatSectionHeader', () => {
  it('should format a section header with newline prefix and colon suffix', () => {
    expect(formatSectionHeader('Surfaces')).toBe('\n  Surfaces:\n')
  })

  it('should work with different titles', () => {
    expect(formatSectionHeader('State')).toBe('\n  State:\n')
  })

  it('should handle empty string', () => {
    expect(formatSectionHeader('')).toBe('\n  :\n')
  })
})

describe('formatList', () => {
  it('should format array items with bullet points and default indent', () => {
    const items = ['item1', 'item2', 'item3']
    const expected = '    \u2022 item1\n    \u2022 item2\n    \u2022 item3'
    expect(formatList(items)).toBe(expected)
  })

  it('should handle single item', () => {
    expect(formatList(['only item'])).toBe('    \u2022 only item')
  })

  it('should handle empty array', () => {
    expect(formatList([])).toBe('')
  })

  it('should allow custom indent', () => {
    const items = ['a', 'b']
    const expected = '  \u2022 a\n  \u2022 b'
    expect(formatList(items, 2)).toBe(expected)
  })

  it('should handle zero indent', () => {
    const items = ['x', 'y']
    const expected = '\u2022 x\n\u2022 y'
    expect(formatList(items, 0)).toBe(expected)
  })
})

describe('formatKeyValue', () => {
  it('should format key-value pairs with alignment and default indent', () => {
    const pairs: Array<[string, string]> = [
      ['Class', 'Worker'],
      ['Created', '2024-01-01'],
    ]
    const expected = '    Class    Worker\n    Created  2024-01-01'
    expect(formatKeyValue(pairs)).toBe(expected)
  })

  it('should handle single pair', () => {
    const pairs: Array<[string, string]> = [['Key', 'Value']]
    expect(formatKeyValue(pairs)).toBe('    Key      Value')
  })

  it('should handle empty array', () => {
    expect(formatKeyValue([])).toBe('')
  })

  it('should allow custom key width', () => {
    const pairs: Array<[string, string]> = [['Name', 'Test']]
    // Name (4 chars) padded to 7 chars = "Name   " + space + "Test"
    const expected = '    Name    Test'
    expect(formatKeyValue(pairs, 7)).toBe(expected)
  })

  it('should allow custom indent', () => {
    const pairs: Array<[string, string]> = [['A', 'B']]
    const expected = '  A        B'
    expect(formatKeyValue(pairs, 8, 2)).toBe(expected)
  })

  it('should handle keys longer than keyWidth', () => {
    const pairs: Array<[string, string]> = [['VeryLongKey', 'Value']]
    // Key should still be padded but may exceed the width
    const result = formatKeyValue(pairs, 4)
    expect(result).toBe('    VeryLongKey Value')
  })
})

describe('formatTable', () => {
  it('should format tabular data with headers', () => {
    const headers = ['ID', 'Name']
    const rows = [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]
    const result = formatTable(headers, rows)
    // Should have header row, separator, and data rows
    expect(result).toContain('ID')
    expect(result).toContain('Name')
    expect(result).toContain('Alice')
    expect(result).toContain('Bob')
  })

  it('should align columns based on content width', () => {
    const headers = ['Short', 'LongerHeader']
    const rows = [['a', 'b']]
    const result = formatTable(headers, rows)
    // Headers should be visible and aligned
    expect(result).toContain('Short')
    expect(result).toContain('LongerHeader')
  })

  it('should handle empty rows', () => {
    const headers = ['Col1', 'Col2']
    const rows: string[][] = []
    const result = formatTable(headers, rows)
    // Should still show headers
    expect(result).toContain('Col1')
    expect(result).toContain('Col2')
  })

  it('should handle empty headers', () => {
    const headers: string[] = []
    const rows = [['a', 'b']]
    const result = formatTable(headers, rows)
    expect(result).toBe('')
  })

  it('should allow custom column widths', () => {
    const headers = ['A', 'B']
    const rows = [['1', '2']]
    const result = formatTable(headers, rows, [10, 15])
    // Should respect column widths
    expect(result.split('\n')[0].length).toBeGreaterThanOrEqual(25)
  })

  it('should handle rows with missing columns', () => {
    const headers = ['A', 'B', 'C']
    const rows = [['1', '2']] // Missing third column
    const result = formatTable(headers, rows)
    expect(result).toContain('A')
    expect(result).toContain('1')
    expect(result).toContain('2')
  })
})

describe('formatUrl', () => {
  it('should format URL with label and default configured status', () => {
    expect(formatUrl('App', 'http://localhost:4000')).toBe('    App     http://localhost:4000')
  })

  it('should show "(not configured)" suffix when configured is false', () => {
    const result = formatUrl('Admin', 'http://localhost:4000/admin', false)
    expect(result).toBe('    Admin   http://localhost:4000/admin (not configured)')
  })

  it('should not show suffix when configured is true', () => {
    const result = formatUrl('Docs', 'http://localhost:4000/docs', true)
    expect(result).toBe('    Docs    http://localhost:4000/docs')
  })

  it('should pad label to 7 characters', () => {
    const shortResult = formatUrl('A', 'http://x')
    const longResult = formatUrl('VeryLong', 'http://x')

    // Short label padded
    expect(shortResult).toContain('A       ')
    // Long label not truncated
    expect(longResult).toContain('VeryLong')
  })

  it('should handle empty label', () => {
    const result = formatUrl('', 'http://test')
    expect(result).toBe('            http://test')
  })
})
