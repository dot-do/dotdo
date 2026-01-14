/**
 * TDD Tests for Sales role
 *
 * RED phase: These tests define the expected behavior for the sales role.
 * Tests written FIRST before implementation.
 *
 * @see dotdo-vl3v3 - TDD: Sales role
 */

import { describe, it, expect } from 'vitest'
import { sales } from '../sales'

describe('sales role', () => {
  describe('role definition', () => {
    it('has name "sales"', () => {
      expect(sales.name).toBe('sales')
    })

    it('has correct OKRs: PipelineHealth, ConversionRate, RevenueGrowth', () => {
      expect(sales.okrs).toEqual(['PipelineHealth', 'ConversionRate', 'RevenueGrowth'])
    })

    it('has correct capabilities: outreach, demo, close, handoff', () => {
      expect(sales.capabilities).toEqual(['outreach', 'demo', 'close', 'handoff'])
    })
  })

  describe('callable behavior', () => {
    it('is a callable function', () => {
      expect(typeof sales).toBe('function')
    })

    it('can be invoked as template literal tag', async () => {
      const result = sales`reach out to prospect`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('can interpolate values in template literal', async () => {
      const prospectName = 'Acme Corp'
      const product = 'Enterprise Plan'
      const result = sales`close deal with ${prospectName} for ${product}`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('can be called with string argument', async () => {
      const result = sales('schedule demo for qualified lead')
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })
  })

  describe('readonly properties', () => {
    it('name is readonly', () => {
      const originalName = sales.name
      try {
        // @ts-expect-error - testing runtime behavior
        sales.name = 'changed'
      } catch {
        // Property might throw or silently fail
      }
      expect(sales.name).toBe(originalName)
    })

    it('okrs is readonly and frozen', () => {
      expect(Object.isFrozen(sales.okrs)).toBe(true)
    })

    it('capabilities is readonly and frozen', () => {
      expect(Object.isFrozen(sales.capabilities)).toBe(true)
    })
  })
})
