/**
 * Tests for parseWhereClause error handling
 *
 * Issue: do-1knp.3 - Add try-catch to JSON.parse in parseWhereClause
 *
 * The parseWhereClause function uses JSON.parse without try-catch,
 * which causes errors when parsing unquoted string values like
 * `status = completed` instead of `status = "completed"`.
 */

import { describe, it, expect } from 'vitest'
import { parseWhereClause } from '../business'

describe('parseWhereClause', () => {
  describe('valid JSON values', () => {
    it('should parse quoted string values', () => {
      const result = parseWhereClause('status = "completed"')
      expect(result).toEqual({ status: 'completed' })
    })

    it('should parse numeric values', () => {
      const result = parseWhereClause('amount = 100')
      expect(result).toEqual({ amount: 100 })
    })

    it('should parse boolean values', () => {
      const result = parseWhereClause('active = true')
      expect(result).toEqual({ active: true })
    })

    it('should parse null values', () => {
      const result = parseWhereClause('deleted = null')
      expect(result).toEqual({ deleted: null })
    })

    it('should parse multiple conditions with AND', () => {
      const result = parseWhereClause('status = "completed" and amount = 100')
      expect(result).toEqual({ status: 'completed', amount: 100 })
    })
  })

  describe('unquoted string values (graceful handling)', () => {
    it('should handle unquoted string values in where clause', () => {
      // This is the key test case from the issue
      const result = parseWhereClause('status = completed')
      expect(result).toEqual({ status: 'completed' })
    })

    it('should handle unquoted string values with multiple conditions', () => {
      const result = parseWhereClause('status = completed and type = order')
      expect(result).toEqual({ status: 'completed', type: 'order' })
    })

    it('should handle mixed quoted and unquoted values', () => {
      const result = parseWhereClause('status = completed and amount = 100')
      expect(result).toEqual({ status: 'completed', amount: 100 })
    })

    it('should handle single-quoted string values', () => {
      const result = parseWhereClause("status = 'completed'")
      expect(result).toEqual({ status: 'completed' })
    })

    it('should trim whitespace from unquoted values', () => {
      const result = parseWhereClause('status =   completed  ')
      expect(result).toEqual({ status: 'completed' })
    })

    it('should handle hyphenated unquoted values', () => {
      const result = parseWhereClause('status = in-progress')
      expect(result).toEqual({ status: 'in-progress' })
    })

    it('should handle underscored unquoted values', () => {
      const result = parseWhereClause('status = in_progress')
      expect(result).toEqual({ status: 'in_progress' })
    })
  })

  describe('edge cases', () => {
    it('should return empty object for empty clause', () => {
      const result = parseWhereClause('')
      expect(result).toEqual({})
    })

    it('should ignore malformed conditions without =', () => {
      const result = parseWhereClause('status completed')
      expect(result).toEqual({})
    })

    it('should handle case-insensitive AND', () => {
      const result = parseWhereClause('status = "done" AND amount = 50')
      expect(result).toEqual({ status: 'done', amount: 50 })
    })
  })
})
