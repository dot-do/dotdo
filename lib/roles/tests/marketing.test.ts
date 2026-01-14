/**
 * TDD Tests for Marketing role
 *
 * RED phase: These tests define the expected behavior for the marketing role.
 * Tests written FIRST before implementation.
 *
 * @see dotdo-e0koz - TDD: Marketing role
 */

import { describe, it, expect } from 'vitest'
import { marketing } from '../marketing'

describe('marketing role', () => {
  describe('role definition', () => {
    it('has name "marketing"', () => {
      expect(marketing.name).toBe('marketing')
    })

    it('has correct OKRs: BrandAwareness, ContentEngagement, LeadGeneration', () => {
      expect(marketing.okrs).toEqual(['BrandAwareness', 'ContentEngagement', 'LeadGeneration'])
    })

    it('has correct capabilities: write, announce, launch', () => {
      expect(marketing.capabilities).toEqual(['write', 'announce', 'launch'])
    })
  })

  describe('callable behavior', () => {
    it('is a callable function', () => {
      expect(typeof marketing).toBe('function')
    })

    it('can be invoked as template literal tag', async () => {
      const result = marketing`write blog post about product launch`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('can interpolate values in template literal', async () => {
      const productName = 'SuperApp'
      const campaign = 'Q1 Launch'
      const result = marketing`announce ${productName} for ${campaign}`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('can be called with string argument', async () => {
      const result = marketing('launch the newsletter campaign')
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })
  })

  describe('readonly properties', () => {
    it('name is readonly', () => {
      const originalName = marketing.name
      try {
        // @ts-expect-error - testing runtime behavior
        marketing.name = 'changed'
      } catch {
        // Property might throw or silently fail
      }
      expect(marketing.name).toBe(originalName)
    })

    it('okrs is readonly and frozen', () => {
      expect(Object.isFrozen(marketing.okrs)).toBe(true)
    })

    it('capabilities is readonly and frozen', () => {
      expect(Object.isFrozen(marketing.capabilities)).toBe(true)
    })
  })
})
