/**
 * Agent as Thing - Core Schema Tests
 *
 * TDD RED phase: Failing tests for representing Agents as Things in the graph model.
 *
 * Agents are AI workers with personas, tools, and memory. When stored as Things,
 * they become first-class citizens in the unified graph model, enabling:
 * - Agent discovery and querying
 * - Relationship tracking (agent-to-agent handoffs, tool usage, memory)
 * - Named agent registration (Priya, Ralph, Tom, etc.)
 *
 * @see dotdo-ewo1a - [RED] Agent as Thing - Core Schema Tests
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 *
 * Design:
 * - Agent Things use $type URL: 'https://agents.do/Agent'
 * - Agent data includes: persona (role, name, description), model, mode
 * - Named agents are pre-registered Things with well-known $id URLs
 * - Uses real SQLite in production (Durable Objects), NO MOCKS
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// EXPECTED TYPE DEFINITIONS - Document the API Contract
// ============================================================================

/**
 * Agent Thing type URL - follows W3C convention for type identification
 */
const AGENT_TYPE_URL = 'https://agents.do/Agent'

/**
 * Agent operation modes
 */
type AgentMode = 'autonomous' | 'supervised' | 'manual'

/**
 * Agent roles matching the named agent system
 */
type AgentRole = 'product' | 'engineering' | 'tech-lead' | 'marketing' | 'sales' | 'qa' | 'frontend' | 'customer-success' | 'finance' | 'data'

/**
 * Agent persona as stored in Thing data
 */
interface AgentPersonaData {
  role: AgentRole
  name: string
  description: string
}

/**
 * Agent Thing data structure
 */
interface AgentThingData {
  persona: AgentPersonaData
  model: string
  mode: AgentMode
  /** Optional: tool IDs this agent has access to */
  tools?: string[]
  /** Optional: instructions/system prompt */
  instructions?: string
}

/**
 * Expected shape of an Agent Thing
 */
interface ExpectedAgentThing {
  /** Unique identifier - URL format: https://agents.do/{name} */
  id: string
  /** Type ID (FK to nouns table) */
  typeId: number
  /** Type name - always 'Agent' for agent things */
  typeName: string
  /** Agent-specific data */
  data: AgentThingData
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
  /** Soft delete timestamp */
  deletedAt: number | null
}

/**
 * Named agents from the persona system
 */
const NAMED_AGENTS = ['priya', 'ralph', 'tom', 'mark', 'sally', 'quinn', 'rae', 'casey', 'finn', 'dana'] as const

// ============================================================================
// AGENT TYPE REGISTRATION TESTS
// ============================================================================

describe('Agent as Thing', () => {
  describe('Agent Type URL', () => {
    it('uses https://agents.do/Agent as the type URL', async () => {
      // Agent type should follow the W3C convention with a URL-based type
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule).not.toBeNull()
      expect(agentModule?.AGENT_TYPE).toBe(AGENT_TYPE_URL)
    })

    it('exports AGENT_TYPE constant', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.AGENT_TYPE).toBeDefined()
      expect(typeof agentModule?.AGENT_TYPE).toBe('string')
    })
  })

  // ============================================================================
  // AGENT THING CREATION TESTS
  // ============================================================================

  describe('Agent Thing Creation', () => {
    it('creates an Agent Thing with required fields', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented - waiting for db/graph/agent-thing.ts')
      }

      const mockDb = {}
      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'test-agent',
        persona: {
          role: 'engineering',
          name: 'Test Agent',
          description: 'A test engineering agent',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(agent).toBeDefined()
      expect(agent.typeName).toBe('Agent')
      expect(agent.data.persona.role).toBe('engineering')
      expect(agent.data.model).toBe('claude-sonnet-4-20250514')
      expect(agent.data.mode).toBe('autonomous')
    })

    it('generates URL-based $id for agent things', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'custom-agent',
        persona: {
          role: 'product',
          name: 'Custom Agent',
          description: 'A custom product agent',
        },
        model: 'gpt-4',
        mode: 'supervised',
      })

      // ID should be a URL following the agents.do convention
      expect(agent.id).toMatch(/^https:\/\/agents\.do\//)
      expect(agent.id).toContain('custom-agent')
    })

    it('validates agent mode is one of: autonomous, supervised, manual', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}

      // Valid modes should work
      const autonomousAgent = await agentModule.createAgentThing(mockDb, {
        name: 'auto-agent',
        persona: { role: 'engineering', name: 'Auto', description: 'Autonomous agent' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      expect(autonomousAgent.data.mode).toBe('autonomous')

      const supervisedAgent = await agentModule.createAgentThing(mockDb, {
        name: 'supervised-agent',
        persona: { role: 'engineering', name: 'Supervised', description: 'Supervised agent' },
        model: 'claude-sonnet-4-20250514',
        mode: 'supervised',
      })
      expect(supervisedAgent.data.mode).toBe('supervised')

      const manualAgent = await agentModule.createAgentThing(mockDb, {
        name: 'manual-agent',
        persona: { role: 'engineering', name: 'Manual', description: 'Manual agent' },
        model: 'claude-sonnet-4-20250514',
        mode: 'manual',
      })
      expect(manualAgent.data.mode).toBe('manual')
    })

    it('validates agent role is a known role type', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const validRoles: AgentRole[] = ['product', 'engineering', 'tech-lead', 'marketing', 'sales', 'qa', 'frontend', 'customer-success', 'finance', 'data']

      for (const role of validRoles) {
        const agent = await agentModule.createAgentThing(mockDb, {
          name: `${role}-agent`,
          persona: { role, name: `${role} Agent`, description: `A ${role} agent` },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        })
        expect(agent.data.persona.role).toBe(role)
      }
    })

    it('stores optional tool IDs in agent data', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'tooled-agent',
        persona: {
          role: 'engineering',
          name: 'Tooled Agent',
          description: 'Agent with tools',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
        tools: ['tool-1', 'tool-2', 'tool-3'],
      })

      expect(agent.data.tools).toEqual(['tool-1', 'tool-2', 'tool-3'])
    })

    it('stores optional instructions in agent data', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const instructions = 'You are a specialized engineering agent focused on TypeScript development.'

      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'instructed-agent',
        persona: {
          role: 'engineering',
          name: 'Instructed Agent',
          description: 'Agent with custom instructions',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
        instructions,
      })

      expect(agent.data.instructions).toBe(instructions)
    })

    it('auto-generates timestamps on creation', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const before = Date.now()

      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'timestamp-agent',
        persona: {
          role: 'engineering',
          name: 'Timestamp Agent',
          description: 'Agent for testing timestamps',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const after = Date.now()

      expect(agent.createdAt).toBeGreaterThanOrEqual(before)
      expect(agent.createdAt).toBeLessThanOrEqual(after)
      expect(agent.updatedAt).toBeGreaterThanOrEqual(before)
      expect(agent.updatedAt).toBeLessThanOrEqual(after)
      expect(agent.deletedAt).toBeNull()
    })

    it('rejects duplicate agent names', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}

      // First creation should succeed
      await agentModule.createAgentThing(mockDb, {
        name: 'unique-agent',
        persona: {
          role: 'engineering',
          name: 'Unique Agent',
          description: 'First agent with this name',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      // Second creation with same name should fail
      await expect(
        agentModule.createAgentThing(mockDb, {
          name: 'unique-agent',
          persona: {
            role: 'product',
            name: 'Duplicate Agent',
            description: 'Second agent with same name',
          },
          model: 'gpt-4',
          mode: 'supervised',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // NAMED AGENTS AS THINGS TESTS
  // ============================================================================

  describe('Named Agents as Things', () => {
    it('exports registerNamedAgents function', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.registerNamedAgents).toBeDefined()
      expect(typeof agentModule?.registerNamedAgents).toBe('function')
    })

    it('registers all named agents as Things', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('registerNamedAgents or getAgentThing not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      // All named agents should be registered
      for (const name of NAMED_AGENTS) {
        const agent = await agentModule.getAgentThing(mockDb, name)
        expect(agent).not.toBeNull()
        expect(agent?.data.persona.name.toLowerCase()).toBe(name.toLowerCase())
      }
    })

    it('priya is registered as a product agent', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      const priya = await agentModule.getAgentThing(mockDb, 'priya')
      expect(priya).not.toBeNull()
      expect(priya?.data.persona.role).toBe('product')
      expect(priya?.data.persona.name).toBe('Priya')
    })

    it('ralph is registered as an engineering agent', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      const ralph = await agentModule.getAgentThing(mockDb, 'ralph')
      expect(ralph).not.toBeNull()
      expect(ralph?.data.persona.role).toBe('engineering')
      expect(ralph?.data.persona.name).toBe('Ralph')
    })

    it('tom is registered as a tech-lead agent', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      const tom = await agentModule.getAgentThing(mockDb, 'tom')
      expect(tom).not.toBeNull()
      expect(tom?.data.persona.role).toBe('tech-lead')
      expect(tom?.data.persona.name).toBe('Tom')
    })

    it('named agents have well-known URL-based IDs', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      const ralph = await agentModule.getAgentThing(mockDb, 'ralph')
      expect(ralph?.id).toBe('https://agents.do/ralph')

      const priya = await agentModule.getAgentThing(mockDb, 'priya')
      expect(priya?.id).toBe('https://agents.do/priya')
    })

    it('named agents use default model claude-sonnet-4-20250514', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      for (const name of NAMED_AGENTS) {
        const agent = await agentModule.getAgentThing(mockDb, name)
        expect(agent?.data.model).toBe('claude-sonnet-4-20250514')
      }
    })

    it('named agents default to autonomous mode', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.registerNamedAgents || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.registerNamedAgents(mockDb)

      for (const name of NAMED_AGENTS) {
        const agent = await agentModule.getAgentThing(mockDb, name)
        expect(agent?.data.mode).toBe('autonomous')
      }
    })
  })

  // ============================================================================
  // AGENT THING QUERY TESTS
  // ============================================================================

  describe('Agent Thing Queries', () => {
    it('exports getAgentThing function', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.getAgentThing).toBeDefined()
      expect(typeof agentModule?.getAgentThing).toBe('function')
    })

    it('retrieves agent by name', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'query-test-agent',
        persona: {
          role: 'qa',
          name: 'Query Test Agent',
          description: 'Agent for testing queries',
        },
        model: 'claude-sonnet-4-20250514',
        mode: 'supervised',
      })

      const retrieved = await agentModule.getAgentThing(mockDb, 'query-test-agent')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.data.persona.name).toBe('Query Test Agent')
    })

    it('returns null for non-existent agent', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.getAgentThing) {
        throw new Error('getAgentThing not implemented')
      }

      const mockDb = {}
      const result = await agentModule.getAgentThing(mockDb, 'non-existent-agent')
      expect(result).toBeNull()
    })

    it('exports getAgentsByRole function', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.getAgentsByRole).toBeDefined()
      expect(typeof agentModule?.getAgentsByRole).toBe('function')
    })

    it('queries agents by role', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.getAgentsByRole) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}

      // Use unique agent names with timestamp to avoid collisions with shared store
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Create multiple engineering agents
      await agentModule.createAgentThing(mockDb, {
        name: `eng-role-test-1-${suffix}`,
        persona: { role: 'engineering', name: 'Engineer 1', description: 'First engineer' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      await agentModule.createAgentThing(mockDb, {
        name: `eng-role-test-2-${suffix}`,
        persona: { role: 'engineering', name: 'Engineer 2', description: 'Second engineer' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      // Create a product agent (should not be included)
      await agentModule.createAgentThing(mockDb, {
        name: `product-role-test-${suffix}`,
        persona: { role: 'product', name: 'Product Agent', description: 'Product manager' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const engineeringAgents = await agentModule.getAgentsByRole(mockDb, 'engineering')
      expect(engineeringAgents.length).toBeGreaterThanOrEqual(2)
      expect(engineeringAgents.every((a: ExpectedAgentThing) => a.data.persona.role === 'engineering')).toBe(true)
    })

    it('exports getAllAgents function', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.getAllAgents).toBeDefined()
      expect(typeof agentModule?.getAllAgents).toBe('function')
    })

    it('returns all agent things', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.getAllAgents) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}

      // Create a few agents
      await agentModule.createAgentThing(mockDb, {
        name: 'all-test-1',
        persona: { role: 'engineering', name: 'All Test 1', description: 'Test agent 1' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })
      await agentModule.createAgentThing(mockDb, {
        name: 'all-test-2',
        persona: { role: 'product', name: 'All Test 2', description: 'Test agent 2' },
        model: 'gpt-4',
        mode: 'supervised',
      })

      const allAgents = await agentModule.getAllAgents(mockDb)
      expect(allAgents.length).toBeGreaterThanOrEqual(2)
      expect(allAgents.every((a: ExpectedAgentThing) => a.typeName === 'Agent')).toBe(true)
    })
  })

  // ============================================================================
  // AGENT THING UPDATE TESTS
  // ============================================================================

  describe('Agent Thing Updates', () => {
    it('exports updateAgentThing function', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.updateAgentThing).toBeDefined()
      expect(typeof agentModule?.updateAgentThing).toBe('function')
    })

    it('updates agent model', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.updateAgentThing || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'update-test-agent',
        persona: { role: 'engineering', name: 'Update Test', description: 'For testing updates' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const updated = await agentModule.updateAgentThing(mockDb, 'update-test-agent', {
        model: 'gpt-4-turbo',
      })

      expect(updated?.data.model).toBe('gpt-4-turbo')

      // Verify the update persisted
      const retrieved = await agentModule.getAgentThing(mockDb, 'update-test-agent')
      expect(retrieved?.data.model).toBe('gpt-4-turbo')
    })

    it('updates agent mode', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.updateAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'mode-update-agent',
        persona: { role: 'engineering', name: 'Mode Test', description: 'For testing mode updates' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const updated = await agentModule.updateAgentThing(mockDb, 'mode-update-agent', {
        mode: 'supervised',
      })

      expect(updated?.data.mode).toBe('supervised')
    })

    it('updates agent tools', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.updateAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'tools-update-agent',
        persona: { role: 'engineering', name: 'Tools Test', description: 'For testing tool updates' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
        tools: ['tool-1'],
      })

      const updated = await agentModule.updateAgentThing(mockDb, 'tools-update-agent', {
        tools: ['tool-1', 'tool-2', 'tool-3'],
      })

      expect(updated?.data.tools).toEqual(['tool-1', 'tool-2', 'tool-3'])
    })

    it('updates updatedAt timestamp', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.updateAgentThing || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'timestamp-update-agent',
        persona: { role: 'engineering', name: 'Timestamp Test', description: 'For testing timestamp updates' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const before = await agentModule.getAgentThing(mockDb, 'timestamp-update-agent')
      const beforeUpdatedAt = before?.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await agentModule.updateAgentThing(mockDb, 'timestamp-update-agent', {
        mode: 'supervised',
      })

      expect(updated?.updatedAt).toBeGreaterThan(beforeUpdatedAt!)
      expect(updated?.createdAt).toBe(before?.createdAt) // createdAt should not change
    })

    it('returns null for non-existent agent update', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.updateAgentThing) {
        throw new Error('updateAgentThing not implemented')
      }

      const mockDb = {}
      const result = await agentModule.updateAgentThing(mockDb, 'non-existent', {
        mode: 'manual',
      })

      expect(result).toBeNull()
    })
  })

  // ============================================================================
  // AGENT THING DELETE TESTS
  // ============================================================================

  describe('Agent Thing Deletion', () => {
    it('exports deleteAgentThing function', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)

      expect(agentModule?.deleteAgentThing).toBeDefined()
      expect(typeof agentModule?.deleteAgentThing).toBe('function')
    })

    it('soft deletes an agent by setting deletedAt', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.deleteAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'delete-test-agent',
        persona: { role: 'qa', name: 'Delete Test', description: 'For testing deletion' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const deleted = await agentModule.deleteAgentThing(mockDb, 'delete-test-agent')

      expect(deleted?.deletedAt).toBeDefined()
      expect(deleted?.deletedAt).not.toBeNull()
    })

    it('soft deleted agent is still retrievable', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing || !agentModule?.deleteAgentThing || !agentModule?.getAgentThing) {
        throw new Error('Agent module not implemented')
      }

      const mockDb = {}
      await agentModule.createAgentThing(mockDb, {
        name: 'soft-delete-agent',
        persona: { role: 'qa', name: 'Soft Delete Test', description: 'For testing soft deletion' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      await agentModule.deleteAgentThing(mockDb, 'soft-delete-agent')

      const retrieved = await agentModule.getAgentThing(mockDb, 'soft-delete-agent')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.deletedAt).not.toBeNull()
    })

    it('returns null for non-existent agent deletion', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.deleteAgentThing) {
        throw new Error('deleteAgentThing not implemented')
      }

      const mockDb = {}
      const result = await agentModule.deleteAgentThing(mockDb, 'non-existent')
      expect(result).toBeNull()
    })
  })

  // ============================================================================
  // TYPE INTEGRATION TESTS
  // ============================================================================

  describe('Type Integration', () => {
    it('Agent typeId references the Agent noun in nouns table', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'type-test-agent',
        persona: { role: 'engineering', name: 'Type Test', description: 'For testing types' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      // typeId should be a positive integer (FK to nouns.rowid)
      expect(typeof agent.typeId).toBe('number')
      expect(agent.typeId).toBeGreaterThan(0)
    })

    it('Agent typeName is always "Agent"', async () => {
      const agentModule = await import('../agent-thing').catch(() => null)
      if (!agentModule?.createAgentThing) {
        throw new Error('createAgentThing not implemented')
      }

      const mockDb = {}
      const agent = await agentModule.createAgentThing(mockDb, {
        name: 'typename-test-agent',
        persona: { role: 'product', name: 'TypeName Test', description: 'For testing typeName' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(agent.typeName).toBe('Agent')
    })
  })
})
