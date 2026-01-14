/**
 * Casey Agent Tests
 *
 * TDD tests for Casey - Customer Success agent
 * RED phase: These tests should fail until Casey is implemented
 *
 * @see dotdo-mrbuh - Casey agent implementation
 * @module agents/tests/casey
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('Casey - Customer Success Agent', () => {
  describe('exports and configuration', () => {
    it('should export casey from agents/named', async () => {
      const { casey } = await import('../named')
      expect(casey).toBeDefined()
    })

    it('should have correct name', async () => {
      const { casey } = await import('../named')
      expect(casey.name).toBe('Casey')
    })

    it('should have customer-success role', async () => {
      const { casey } = await import('../named')
      expect(casey.role).toBe('customer-success')
    })

    it('should have description mentioning customer success', async () => {
      const { casey } = await import('../named')
      expect(casey.description.toLowerCase()).toMatch(/customer success|onboarding|retention/)
    })
  })

  describe('persona traits', () => {
    it('should be callable as template literal', async () => {
      const { casey, enableMockMode, disableMockMode } = await import('../named')

      enableMockMode()
      try {
        const result = await casey`help onboard a new customer`
        expect(result).toBeDefined()
        expect(typeof result === 'string' || typeof result.toString === 'function').toBe(true)
      } finally {
        disableMockMode()
      }
    })

    it('should be callable as function', async () => {
      const { casey, enableMockMode, disableMockMode } = await import('../named')

      enableMockMode()
      try {
        const result = await casey('create onboarding plan')
        expect(result).toBeDefined()
      } finally {
        disableMockMode()
      }
    })

    it('should have withConfig method', async () => {
      const { casey } = await import('../named')
      expect(casey.withConfig).toBeDefined()
      expect(typeof casey.withConfig).toBe('function')
    })

    it('should have reset method', async () => {
      const { casey } = await import('../named')
      expect(casey.reset).toBeDefined()
      expect(typeof casey.reset).toBe('function')
    })

    it('should have stream method', async () => {
      const { casey } = await import('../named')
      expect(casey.stream).toBeDefined()
      expect(typeof casey.stream).toBe('function')
    })

    it('should have tools array', async () => {
      const { casey } = await import('../named')
      expect(casey.tools).toBeDefined()
      expect(Array.isArray(casey.tools)).toBe(true)
    })
  })

  describe('customer-success role definition', () => {
    it('should have customer-success in ROLE_DEFINITIONS', async () => {
      const { ROLE_DEFINITIONS } = await import('../named/personas')
      expect(ROLE_DEFINITIONS['customer-success']).toBeDefined()
    })

    it('should have appropriate capabilities for customer success', async () => {
      const { ROLE_DEFINITIONS } = await import('../named/personas')
      const role = ROLE_DEFINITIONS['customer-success']

      // Customer success should be able to handle onboarding, retention, etc.
      const capabilities = role.capabilities.join(' ').toLowerCase()
      expect(capabilities).toMatch(/onboard|customer|success|retention|support/i)
    })

    it('should have empathetic traits', async () => {
      const { ROLE_DEFINITIONS } = await import('../named/personas')
      const role = ROLE_DEFINITIONS['customer-success']

      // Should have communicative or similar traits
      expect(role.traits.some(t => ['communicative', 'strategic', 'analytical'].includes(t))).toBe(true)
    })
  })

  describe('PERSONAS export', () => {
    it('should include casey in PERSONAS', async () => {
      const { PERSONAS } = await import('../named')
      expect(PERSONAS.casey).toBeDefined()
    })

    it('casey persona should have correct role', async () => {
      const { PERSONAS } = await import('../named')
      expect(PERSONAS.casey.role).toBe('customer-success')
    })

    it('casey persona should have instructions', async () => {
      const { PERSONAS } = await import('../named')
      expect(PERSONAS.casey.instructions).toBeDefined()
      expect(PERSONAS.casey.instructions.length).toBeGreaterThan(100)
    })
  })
})
