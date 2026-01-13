/**
 * Sam Agent Tests (TDD)
 *
 * RED phase: Write failing tests first
 *
 * Sam is the support agent implementing the support role.
 * Domain: sam.do
 *
 * @see dotdo-cdge8 - TDD: Sam agent (support)
 * @module agents/tests/sam.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { sam } from '../sam'
import { defineAgent } from '../define'
import { support } from '../../roles'

describe('Sam - Support Agent', () => {

  describe('Agent metadata', () => {
    it('sam.name equals "Sam"', () => {
      expect(sam.name).toBe('Sam')
    })

    it('sam.domain equals "sam.do"', () => {
      expect(sam.domain).toBe('sam.do')
    })

    it('sam.role equals support role', () => {
      expect(sam.role).toBe(support)
    })

    it('sam should have persona with voice and style', () => {
      expect(sam.persona).toBeDefined()
      expect(sam.persona.voice).toBe('helpful')
      expect(sam.persona.style).toBe('friendly')
    })
  })

  describe('Template literal invocation (mock)', () => {
    it('sam can be invoked with template literal', async () => {
      const result = await sam`handle this ticket`

      expect(result).toBeDefined()
      expect(typeof result.toString()).toBe('string')
      expect(result.toString().length).toBeGreaterThan(0)
    })

    it('sam can interpolate values in template literal', async () => {
      const ticketId = 'TICKET-123'
      const result = await sam`resolve ${ticketId}`

      expect(result).toBeDefined()
      expect(typeof result.toString()).toBe('string')
    })

    it('sam routes to support role capabilities', async () => {
      // Support role has: respond, resolve, escalate
      expect(sam.role.capabilities).toContain('respond')
      expect(sam.role.capabilities).toContain('resolve')
      expect(sam.role.capabilities).toContain('escalate')
    })
  })

  describe('defineAgent function', () => {
    it('defineAgent should be a function', () => {
      expect(typeof defineAgent).toBe('function')
    })

    it('defineAgent should create an agent with name, domain, role', () => {
      const testAgent = defineAgent({
        name: 'TestAgent',
        domain: 'test.do',
        role: support,
        persona: { voice: 'calm', style: 'professional' },
      })

      expect(testAgent.name).toBe('TestAgent')
      expect(testAgent.domain).toBe('test.do')
      expect(testAgent.role).toBe(support)
    })

    it('defineAgent agents should be callable with template literals', async () => {
      const testAgent = defineAgent({
        name: 'TestAgent',
        domain: 'test.do',
        role: support,
        persona: { voice: 'calm', style: 'professional' },
      })

      const result = await testAgent`test prompt`
      expect(result).toBeDefined()
    })
  })
})
