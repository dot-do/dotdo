import { describe, it, expect } from 'vitest'

// Import from packages
import type { Worker, Agent, Human } from '@dotdo/digital-workers'
import type { Tool, Integration, Capability } from '@dotdo/digital-tools'
import type { Business, Company, Org, Goal } from '@dotdo/business-as-code'

// Import registry
import { TypeRegistry, schemaUrl, typeFromUrl } from '../../types/schema-registry'

describe('schema.org.ai Type Integration', () => {
  describe('TypeRegistry', () => {
    it('contains all expected types', () => {
      expect(TypeRegistry.Worker).toBe('https://schema.org.ai/Worker')
      expect(TypeRegistry.Agent).toBe('https://schema.org.ai/Agent')
      expect(TypeRegistry.Business).toBe('https://schema.org.ai/Business')
    })

    it('schemaUrl helper works', () => {
      expect(schemaUrl('Startup')).toBe('https://schema.org.ai/Startup')
    })

    it('typeFromUrl reverse lookup works', () => {
      expect(typeFromUrl('https://schema.org.ai/Agent')).toBe('Agent')
      expect(typeFromUrl('https://schema.org.ai/Unknown')).toBeUndefined()
    })
  })

  describe('Cross-package type compatibility', () => {
    it('Worker types are properly defined', () => {
      const agent: Agent = {
        $id: 'https://test/agents/a1',
        $type: 'https://schema.org.ai/Agent',
        name: 'Test Agent',
        skills: ['testing'],
        status: 'available',
        model: 'claude-3-opus',
        tools: ['read', 'write'],
        autonomous: true
      }
      expect(agent.$type).toBe(TypeRegistry.Agent)
    })

    it('Business with Goals works', () => {
      const goal: Goal = {
        objective: 'Test objective',
        keyResults: [{ metric: 'tests', target: 100, current: 50, source: 'vitest' }]
      }
      const business: Business = {
        $id: 'https://test/businesses/b1',
        $type: 'https://schema.org.ai/Business',
        name: 'Test Business',
        goals: [goal]
      }
      expect(business.goals).toHaveLength(1)
    })
  })
})
