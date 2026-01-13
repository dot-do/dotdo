/**
 * TDD Tests for Finance role
 *
 * RED phase: These tests define the expected behavior for the finance role.
 * Tests written FIRST before implementation.
 *
 * @see dotdo-ysru5 - TDD: Finance role
 */

import { describe, it, expect } from 'vitest'
import { finance } from '../finance'

describe('finance role', () => {
  describe('role definition', () => {
    it('has name "finance"', () => {
      expect(finance.name).toBe('finance')
    })

    it('has correct OKRs: BurnEfficiency, UnitEconomics', () => {
      expect(finance.okrs).toEqual(['BurnEfficiency', 'UnitEconomics'])
    })

    it('has correct capabilities: budget, forecast, invoice, analyze', () => {
      expect(finance.capabilities).toEqual(['budget', 'forecast', 'invoice', 'analyze'])
    })
  })

  describe('callable behavior', () => {
    it('is a callable function', () => {
      expect(typeof finance).toBe('function')
    })

    it('can be invoked as template literal tag', async () => {
      const result = finance`create quarterly budget`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('can interpolate values in template literal', async () => {
      const quarter = 'Q1'
      const year = 2026
      const result = finance`forecast revenue for ${quarter} ${year}`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('can be called with string argument', async () => {
      const result = finance('analyze burn rate')
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })
  })

  describe('readonly properties', () => {
    it('name is readonly', () => {
      const originalName = finance.name
      try {
        // @ts-expect-error - testing runtime behavior
        finance.name = 'changed'
      } catch {
        // Property might throw or silently fail
      }
      expect(finance.name).toBe(originalName)
    })

    it('okrs is readonly and frozen', () => {
      expect(Object.isFrozen(finance.okrs)).toBe(true)
    })

    it('capabilities is readonly and frozen', () => {
      expect(Object.isFrozen(finance.capabilities)).toBe(true)
    })
  })
})
