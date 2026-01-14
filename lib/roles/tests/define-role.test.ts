/**
 * TDD Tests for Role types and defineRole()
 *
 * RED phase: These tests define the expected behavior for the roles system.
 * Tests written FIRST before implementation.
 *
 * @see dotdo-89132 - TDD: Role types and defineRole()
 */

import { describe, it, expect } from 'vitest'
import { defineRole, type Role, type RoleConfig } from '../define'

describe('defineRole()', () => {
  describe('returns Role object', () => {
    it('returns Role object with name property', () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
        capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
      })

      expect(product.name).toBe('product')
    })

    it('returns Role object with okrs array', () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
        capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
      })

      expect(product.okrs).toEqual(['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'])
    })

    it('returns Role object with capabilities array', () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
        capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
      })

      expect(product.capabilities).toEqual(['spec', 'roadmap', 'prioritize', 'plan'])
    })
  })

  describe('Role.okrs', () => {
    it('okrs is an array of metric names', () => {
      const engineering = defineRole({
        name: 'engineering',
        okrs: ['BuildVelocity', 'CodeQuality', 'SystemReliability'],
        capabilities: ['implement', 'refactor', 'test'],
      })

      expect(Array.isArray(engineering.okrs)).toBe(true)
      expect(engineering.okrs).toHaveLength(3)
      expect(engineering.okrs[0]).toBe('BuildVelocity')
    })

    it('okrs can be empty array', () => {
      const generic = defineRole({
        name: 'generic',
        okrs: [],
        capabilities: ['assist'],
      })

      expect(generic.okrs).toEqual([])
    })
  })

  describe('Role.capabilities', () => {
    it('capabilities is an array of capability names', () => {
      const sales = defineRole({
        name: 'sales',
        okrs: ['PipelineHealth', 'ConversionRate', 'RevenueGrowth'],
        capabilities: ['pitch', 'qualify', 'negotiate', 'close'],
      })

      expect(Array.isArray(sales.capabilities)).toBe(true)
      expect(sales.capabilities).toHaveLength(4)
      expect(sales.capabilities).toContain('pitch')
      expect(sales.capabilities).toContain('close')
    })

    it('capabilities can be empty array', () => {
      const minimal = defineRole({
        name: 'minimal',
        okrs: ['SomeMetric'],
        capabilities: [],
      })

      expect(minimal.capabilities).toEqual([])
    })
  })

  describe('template literal tag function', () => {
    it('Role has template literal tag function', () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
        capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
      })

      // Role should be callable as a template literal tag
      expect(typeof product).toBe('function')
    })

    it('Role invocation returns a promise', async () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
        capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
      })

      // Template literal invocation should return a promise
      const result = product`plan the roadmap`
      expect(result).toBeInstanceOf(Promise)

      // Wait for the promise to resolve (in mock mode, returns placeholder)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('Role can interpolate values in template literal', async () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption'],
        capabilities: ['plan'],
      })

      const feature = 'user authentication'
      const result = product`plan ${feature} for Q1`

      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })
  })

  describe('Role type structure', () => {
    it('Role is both an object and a callable function', () => {
      const qa = defineRole({
        name: 'qa',
        okrs: ['TestCoverage', 'DefectEscapeRate'],
        capabilities: ['test', 'validate', 'report'],
      })

      // Should be callable as a function
      expect(typeof qa).toBe('function')

      // Should also have properties
      expect(qa.name).toBe('qa')
      expect(qa.okrs).toBeDefined()
      expect(qa.capabilities).toBeDefined()
    })

    it('Role properties are readonly', () => {
      const support = defineRole({
        name: 'support',
        okrs: ['ResponseTime', 'ResolutionRate', 'CustomerSatisfaction'],
        capabilities: ['respond', 'resolve', 'escalate'],
      })

      // Properties should be accessible
      expect(support.name).toBe('support')

      // Attempting to modify should not change the value (readonly semantics)
      // TypeScript enforces this at compile time, but we verify behavior
      const originalName = support.name
      try {
        // @ts-expect-error - testing runtime behavior
        support.name = 'changed'
      } catch {
        // Property might throw or silently fail
      }
      // Property should remain unchanged
      expect(support.name).toBe(originalName)
    })
  })

  describe('multiple roles', () => {
    it('can define multiple distinct roles', () => {
      const product = defineRole({
        name: 'product',
        okrs: ['FeatureAdoption', 'UserSatisfaction'],
        capabilities: ['spec', 'roadmap'],
      })

      const engineering = defineRole({
        name: 'engineering',
        okrs: ['BuildVelocity', 'CodeQuality'],
        capabilities: ['implement', 'refactor'],
      })

      const marketing = defineRole({
        name: 'marketing',
        okrs: ['BrandAwareness', 'ContentEngagement'],
        capabilities: ['write', 'launch'],
      })

      expect(product.name).toBe('product')
      expect(engineering.name).toBe('engineering')
      expect(marketing.name).toBe('marketing')

      // Each role should be independently callable
      expect(typeof product).toBe('function')
      expect(typeof engineering).toBe('function')
      expect(typeof marketing).toBe('function')
    })
  })
})
