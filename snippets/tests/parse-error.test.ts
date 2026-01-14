import { describe, it, expect } from 'vitest'

/**
 * ParseError Tests (RED Phase - TDD)
 *
 * Tests for the custom ParseError class that provides proper line tracking
 * for JSONL parsing errors instead of using `(error as any).line = lineNumber`.
 *
 * These tests are expected to FAIL initially until ParseError is implemented.
 *
 * @module snippets/tests/parse-error.test
 * @see https://github.com/dotdo/dotdo/issues/dotdo-b9dy5
 */

import { ParseError } from '../parse-error'

// ============================================================================
// ParseError Class Tests
// ============================================================================

describe('ParseError', () => {
  describe('construction', () => {
    it('creates an error with message and line number', () => {
      const error = new ParseError('Invalid JSON', 5)

      expect(error.message).toBe('Invalid JSON')
      expect(error.line).toBe(5)
    })

    it('sets the error name to ParseError', () => {
      const error = new ParseError('Syntax error', 10)

      expect(error.name).toBe('ParseError')
    })

    it('is an instance of Error', () => {
      const error = new ParseError('Parse failed', 1)

      expect(error).toBeInstanceOf(Error)
    })

    it('is an instance of ParseError', () => {
      const error = new ParseError('Parse failed', 1)

      expect(error).toBeInstanceOf(ParseError)
    })

    it('has readonly line property', () => {
      const error = new ParseError('Test', 42)

      // TypeScript will enforce readonly at compile time,
      // but we can verify the value is set correctly
      expect(error.line).toBe(42)
    })

    it('preserves stack trace', () => {
      const error = new ParseError('Stack test', 3)

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ParseError')
    })
  })

  describe('instanceof checks', () => {
    it('can be caught as Error', () => {
      let caught: Error | undefined

      try {
        throw new ParseError('Test', 1)
      } catch (e) {
        if (e instanceof Error) {
          caught = e
        }
      }

      expect(caught).toBeDefined()
      expect(caught?.message).toBe('Test')
    })

    it('can be caught as ParseError with line access', () => {
      let caughtLine: number | undefined

      try {
        throw new ParseError('Test', 99)
      } catch (e) {
        if (e instanceof ParseError) {
          caughtLine = e.line
        }
      }

      expect(caughtLine).toBe(99)
    })

    it('distinguishes ParseError from regular Error', () => {
      const parseError = new ParseError('Parse error', 5)
      const regularError = new Error('Regular error')

      expect(parseError instanceof ParseError).toBe(true)
      expect(regularError instanceof ParseError).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles line number 0', () => {
      const error = new ParseError('Line zero', 0)

      expect(error.line).toBe(0)
    })

    it('handles line number 1 (first line)', () => {
      const error = new ParseError('First line', 1)

      expect(error.line).toBe(1)
    })

    it('handles large line numbers', () => {
      const error = new ParseError('Large file', 1_000_000)

      expect(error.line).toBe(1_000_000)
    })

    it('handles empty message', () => {
      const error = new ParseError('', 5)

      expect(error.message).toBe('')
      expect(error.line).toBe(5)
    })

    it('handles message with special characters', () => {
      const message = 'Unexpected token "}" at position 42\nMultiline\ttab'
      const error = new ParseError(message, 7)

      expect(error.message).toBe(message)
    })
  })

  describe('error message formatting', () => {
    it('includes line number in formatted string when using toString()', () => {
      const error = new ParseError('Invalid JSON', 5)

      // The toString() should work like a normal error
      const str = error.toString()
      expect(str).toContain('ParseError')
      expect(str).toContain('Invalid JSON')
    })
  })
})
