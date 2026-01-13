import { describe, it, expect } from 'vitest'
import { ParseError, DOError } from '../index'

/**
 * ParseError Tests
 *
 * Tests for the custom ParseError class that provides proper line/column
 * tracking, source file reference, and context extraction.
 *
 * @module lib/errors/tests/parse-error.test
 * @see https://github.com/dotdo/dotdo/issues/dotdo-b9dy5
 */

describe('ParseError', () => {
  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('construction', () => {
    it('creates an error with message and line number', () => {
      const error = new ParseError('Invalid JSON', { line: 5 })

      expect(error.message).toContain('Invalid JSON')
      expect(error.message).toContain('line 5')
      expect(error.line).toBe(5)
    })

    it('sets the error name to ParseError', () => {
      const error = new ParseError('Syntax error', { line: 10 })

      expect(error.name).toBe('ParseError')
    })

    it('sets the error code to PARSE_ERROR', () => {
      const error = new ParseError('Test', { line: 1 })

      expect(error.code).toBe('PARSE_ERROR')
    })

    it('includes column in message when provided', () => {
      const error = new ParseError('Unexpected token', { line: 3, column: 15 })

      expect(error.message).toContain('line 3')
      expect(error.message).toContain('column 15')
      expect(error.column).toBe(15)
    })

    it('includes source file in message when provided', () => {
      const error = new ParseError('Parse failed', { line: 7, source: 'config.json' })

      expect(error.message).toContain('config.json')
      expect(error.source).toBe('config.json')
    })

    it('formats message with all location info: source:line:column', () => {
      const error = new ParseError('Error', {
        line: 10,
        column: 5,
        source: 'test.ts',
      })

      expect(error.message).toContain('test.ts')
      expect(error.message).toContain('line 10')
      expect(error.message).toContain('column 5')
    })

    it('stores cause error when provided', () => {
      const cause = new Error('Original error')
      const error = new ParseError('Wrapped error', { line: 1, cause })

      expect(error.cause).toBe(cause)
    })
  })

  // ==========================================================================
  // Inheritance
  // ==========================================================================

  describe('inheritance', () => {
    it('is an instance of Error', () => {
      const error = new ParseError('Test', { line: 1 })

      expect(error).toBeInstanceOf(Error)
    })

    it('is an instance of DOError', () => {
      const error = new ParseError('Test', { line: 1 })

      expect(error).toBeInstanceOf(DOError)
    })

    it('is an instance of ParseError', () => {
      const error = new ParseError('Test', { line: 1 })

      expect(error).toBeInstanceOf(ParseError)
    })

    it('can be caught as Error', () => {
      let caught: Error | undefined

      try {
        throw new ParseError('Test', { line: 1 })
      } catch (e) {
        if (e instanceof Error) {
          caught = e
        }
      }

      expect(caught).toBeDefined()
      expect(caught?.message).toContain('Test')
    })

    it('can be caught as ParseError with line access', () => {
      let caughtLine: number | undefined

      try {
        throw new ParseError('Test', { line: 99 })
      } catch (e) {
        if (e instanceof ParseError) {
          caughtLine = e.line
        }
      }

      expect(caughtLine).toBe(99)
    })

    it('distinguishes ParseError from regular Error', () => {
      const parseError = new ParseError('Parse error', { line: 5 })
      const regularError = new Error('Regular error')

      expect(parseError instanceof ParseError).toBe(true)
      expect(regularError instanceof ParseError).toBe(false)
    })
  })

  // ==========================================================================
  // HTTP Status
  // ==========================================================================

  describe('httpStatus', () => {
    it('returns 400 Bad Request', () => {
      const error = new ParseError('Bad input', { line: 1 })

      expect(error.httpStatus).toBe(400)
    })
  })

  // ==========================================================================
  // Context Extraction
  // ==========================================================================

  describe('context extraction', () => {
    const sourceContent = `{
  "name": "test",
  "version": "1.0.0",
  "invalid": syntax here
  "valid": "value"
}`

    it('extracts context when sourceContent is provided', () => {
      const error = new ParseError('Unexpected identifier', {
        line: 4,
        column: 14,
        sourceContent,
      })

      expect(error.context).toBeDefined()
      expect(error.context).toContain('"invalid": syntax here')
    })

    it('shows error line with marker', () => {
      const error = new ParseError('Error', {
        line: 4,
        sourceContent,
      })

      expect(error.context).toMatch(/^>/m) // Line marker
    })

    it('shows caret pointing to column', () => {
      const error = new ParseError('Error', {
        line: 4,
        column: 5,
        sourceContent,
      })

      expect(error.context).toContain('^')
    })

    it('shows surrounding lines for context', () => {
      const error = new ParseError('Error', {
        line: 3,
        sourceContent,
      })

      // Should show line 2, 3, and 4
      expect(error.context).toContain('"name": "test"')
      expect(error.context).toContain('"version": "1.0.0"')
      expect(error.context).toContain('"invalid": syntax here')
    })

    it('does not include context when sourceContent is not provided', () => {
      const error = new ParseError('Error', { line: 5 })

      expect(error.context).toBeUndefined()
    })

    it('includes context in message when available', () => {
      const error = new ParseError('Parse failed', {
        line: 4,
        sourceContent,
      })

      expect(error.message).toContain('"invalid": syntax here')
    })
  })

  // ==========================================================================
  // Static extractContext
  // ==========================================================================

  describe('ParseError.extractContext', () => {
    const source = `line 1
line 2
line 3
line 4
line 5`

    it('extracts context around the error line', () => {
      const context = ParseError.extractContext(source, 3)

      expect(context).toContain('line 2')
      expect(context).toContain('line 3')
      expect(context).toContain('line 4')
    })

    it('marks the error line with >', () => {
      const context = ParseError.extractContext(source, 3)
      const lines = context.split('\n')

      // Line 3 should be marked
      const errorLine = lines.find((l) => l.includes('line 3'))
      expect(errorLine?.startsWith('>')).toBe(true)
    })

    it('adds caret for column position', () => {
      const context = ParseError.extractContext(source, 3, 3)

      expect(context).toContain('^')
    })

    it('handles first line correctly', () => {
      const context = ParseError.extractContext(source, 1)

      expect(context).toContain('line 1')
      expect(context).toContain('line 2')
      expect(context).not.toContain('line 0')
    })

    it('handles last line correctly', () => {
      const context = ParseError.extractContext(source, 5)

      expect(context).toContain('line 4')
      expect(context).toContain('line 5')
      expect(context).not.toContain('line 6')
    })

    it('returns empty string for invalid line number', () => {
      expect(ParseError.extractContext(source, 0)).toBe('')
      expect(ParseError.extractContext(source, 100)).toBe('')
      expect(ParseError.extractContext(source, -1)).toBe('')
    })

    it('handles single-line source', () => {
      const singleLine = 'just one line'
      const context = ParseError.extractContext(singleLine, 1, 5)

      expect(context).toContain('just one line')
      expect(context).toContain('^')
    })
  })

  // ==========================================================================
  // Static fromJSONError
  // ==========================================================================

  describe('ParseError.fromJSONError', () => {
    it('creates ParseError from JSON.parse error', () => {
      let jsonError: Error
      try {
        JSON.parse('{ invalid json }')
        jsonError = new Error('should not reach')
      } catch (e) {
        jsonError = e as Error
      }

      const parseError = ParseError.fromJSONError(jsonError, 5)

      expect(parseError).toBeInstanceOf(ParseError)
      expect(parseError.line).toBe(5)
      expect(parseError.cause).toBe(jsonError)
    })

    it('includes source when provided', () => {
      const error = new Error('Unexpected token')
      const parseError = ParseError.fromJSONError(error, 10, 'data.json')

      expect(parseError.source).toBe('data.json')
    })

    it('handles non-Error thrown values', () => {
      const parseError = ParseError.fromJSONError('string error', 3)

      expect(parseError.message).toContain('Invalid JSON')
      expect(parseError.line).toBe(3)
    })
  })

  // ==========================================================================
  // toJSON Serialization
  // ==========================================================================

  describe('toJSON', () => {
    it('includes line in JSON output', () => {
      const error = new ParseError('Test', { line: 42 })
      const json = error.toJSON()

      expect(json.line).toBe(42)
    })

    it('includes column in JSON output when present', () => {
      const error = new ParseError('Test', { line: 10, column: 5 })
      const json = error.toJSON()

      expect(json.column).toBe(5)
    })

    it('includes source in JSON output when present', () => {
      const error = new ParseError('Test', { line: 1, source: 'file.ts' })
      const json = error.toJSON()

      expect(json.source).toBe('file.ts')
    })

    it('includes standard DOError fields', () => {
      const error = new ParseError('Test message', { line: 1 })
      const json = error.toJSON()

      expect(json.name).toBe('ParseError')
      expect(json.code).toBe('PARSE_ERROR')
      expect(json.message).toContain('Test message')
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles line number 1 (first line)', () => {
      const error = new ParseError('First line', { line: 1 })

      expect(error.line).toBe(1)
    })

    it('handles large line numbers', () => {
      const error = new ParseError('Large file', { line: 1_000_000 })

      expect(error.line).toBe(1_000_000)
    })

    it('handles column 1 (first column)', () => {
      const error = new ParseError('Start of line', { line: 1, column: 1 })

      expect(error.column).toBe(1)
    })

    it('handles empty message', () => {
      const error = new ParseError('', { line: 5 })

      expect(error.line).toBe(5)
    })

    it('handles message with special characters', () => {
      const message = 'Unexpected token "}" at position 42\nMultiline\ttab'
      const error = new ParseError(message, { line: 7 })

      expect(error.message).toContain(message)
    })

    it('preserves stack trace', () => {
      const error = new ParseError('Stack test', { line: 3 })

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ParseError')
    })

    it('handles source content with empty lines', () => {
      const source = `line 1

line 3`
      const context = ParseError.extractContext(source, 2)

      expect(context).toBeDefined()
      expect(context.length).toBeGreaterThan(0)
    })

    it('handles source content with only whitespace lines', () => {
      const source = `line 1

line 3`
      const context = ParseError.extractContext(source, 2)

      expect(context).toBeDefined()
    })
  })
})
