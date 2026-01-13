/**
 * Tests for defineAgent() and Agent types
 *
 * TDD: RED phase - these tests should fail initially
 *
 * @see dotdo-r6my2
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { defineAgent, type Agent, type AgentConfig } from '../define'
import { defineRole, type Role } from '../roles'

describe('defineAgent()', () => {
  // Create a role to use in tests
  let productRole: Role

  beforeEach(() => {
    // Define a role for testing (assuming defineRole from blocking issue)
    productRole = defineRole({
      name: 'product',
      okrs: [
        'Define MVP requirements',
        'Create product roadmaps',
        'Prioritize features',
      ],
      capabilities: [
        'Write product specs',
        'Define user stories',
        'Create acceptance criteria',
      ],
    })
  })

  describe('returns Agent object', () => {
    it('should return an Agent with name property', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(agent.name).toBe('Priya')
    })

    it('should return an Agent with domain property', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(agent.domain).toBe('priya.do')
    })

    it('should return an Agent with role reference', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(agent.role).toBe(productRole)
      expect(agent.role.name).toBe('product')
    })

    it('should return an Agent with persona', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(agent.persona).toEqual({ voice: 'professional', style: 'concise' })
    })
  })

  describe('template literal invocation', () => {
    it('should have a template literal tag function', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      // Agent should be callable as a function
      expect(typeof agent).toBe('function')
    })

    it('should return a promise when invoked with template literal', async () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      const result = agent`plan the roadmap`

      expect(result).toBeInstanceOf(Promise)
    })

    it('should interpolate values in template literals', async () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      const feature = 'user authentication'
      const result = agent`plan the roadmap for ${feature}`

      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('agent role reference', () => {
    it('Agent.role should reference the role it implements', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(agent.role).toBe(productRole)
      expect(agent.role.capabilities).toContain('Write product specs')
    })

    it('Agent.domain should be the .do domain', () => {
      const agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(agent.domain).toBe('priya.do')
      expect(agent.domain).toMatch(/\.do$/)
    })
  })

  describe('multiple agents with same role', () => {
    it('should allow multiple agents to share the same role', () => {
      const priya = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      const alex = defineAgent({
        name: 'Alex',
        domain: 'alex.do',
        role: productRole,
        persona: { voice: 'friendly', style: 'detailed' },
      })

      expect(priya.role).toBe(alex.role)
      expect(priya.name).not.toBe(alex.name)
      expect(priya.persona).not.toEqual(alex.persona)
    })
  })

  describe('agent type', () => {
    it('should satisfy the Agent interface', () => {
      const agent: Agent = defineAgent({
        name: 'Priya',
        domain: 'priya.do',
        role: productRole,
        persona: { voice: 'professional', style: 'concise' },
      })

      // Type checking - these should compile
      const _name: string = agent.name
      const _domain: string = agent.domain
      const _role: Role = agent.role
      const _persona: Record<string, unknown> = agent.persona

      expect(_name).toBeDefined()
      expect(_domain).toBeDefined()
      expect(_role).toBeDefined()
      expect(_persona).toBeDefined()
    })
  })
})
