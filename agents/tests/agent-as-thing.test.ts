/**
 * Agent as Thing - Core Schema Tests
 *
 * RED PHASE: Tests for representing Agents as Things in the DO Graph model.
 * Agents are specialized Things with specific data fields for AI agent configuration.
 *
 * @see dotdo-ewo1a - [RED] Agent as Thing - Core Schema Tests
 *
 * Design:
 * - Agents are Things with typeName: 'Agent'
 * - Agent data includes: name, persona, model, mode, role, capabilities
 * - Named agents (Priya, Ralph, Tom, etc.) can be registered as Thing instances
 * - Uses REAL SQLite - NO MOCKS (per project testing philosophy)
 *
 * This test file verifies:
 * 1. Agent Thing creation with correct $type and $id
 * 2. Agent data structure (name, persona, model, mode)
 * 3. Named agents (Priya, Ralph, Tom, etc.) as Thing instances
 * 4. Agent query by type and properties
 * 5. Agent update and delete operations
 * 6. [RED] AgentRegistry helper functions (not yet implemented)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import type { GraphThing } from '../../db/graph/types'

// ============================================================================
// AGENT THING TYPE DEFINITIONS
// ============================================================================

/**
 * Agent mode - how the agent operates
 */
type AgentMode = 'autonomous' | 'supervised' | 'interactive' | 'batch'

/**
 * Agent role - the function the agent performs
 */
type AgentRole =
  | 'product'
  | 'engineering'
  | 'tech-lead'
  | 'marketing'
  | 'sales'
  | 'qa'
  | 'frontend'
  | 'customer-success'
  | 'finance'
  | 'data'

/**
 * Agent persona configuration
 */
interface AgentPersona {
  role: AgentRole
  description: string
  instructions: string
  traits?: string[]
  capabilities?: string[]
  guidelines?: string[]
}

/**
 * Agent Thing data structure
 * This is the shape of data stored in the GraphThing.data field
 */
interface AgentThingData {
  /** Agent's unique name (e.g., 'ralph', 'priya') */
  name: string
  /** Agent persona configuration */
  persona: AgentPersona
  /** AI model identifier */
  model: string
  /** Agent operation mode */
  mode: AgentMode
  /** Optional: default temperature for this agent */
  temperature?: number
  /** Optional: max tokens for responses */
  maxTokens?: number
  /** Optional: tools available to this agent */
  tools?: string[]
  /** Optional: handoff targets */
  handoffs?: string[]
  /** Optional: whether agent can spawn subagents */
  canSpawnSubagents?: boolean
}

/**
 * Agent Thing type - GraphThing with Agent-specific data
 */
interface AgentThing extends GraphThing {
  typeName: 'Agent'
  data: AgentThingData | null
}

// ============================================================================
// TEST CONSTANTS - Named Agent Definitions
// ============================================================================

const TYPE_ID_AGENT = 100 // Reserved typeId for Agent Things

/**
 * Named agent definitions based on agents/named/personas.ts
 */
const NAMED_AGENTS: Record<string, Omit<AgentThingData, 'model' | 'mode'>> = {
  priya: {
    name: 'Priya',
    persona: {
      role: 'product',
      description: 'Product manager - specs, roadmaps, MVP definition',
      instructions: 'Your role is to define products, create specifications, and plan roadmaps.',
      traits: ['analytical', 'strategic', 'communicative'],
      capabilities: [
        'Define MVP requirements and scope',
        'Create product specifications',
        'Plan feature roadmaps',
        'Prioritize based on user value',
        'Write user stories and acceptance criteria',
      ],
    },
  },
  ralph: {
    name: 'Ralph',
    persona: {
      role: 'engineering',
      description: 'Engineering lead - builds code, implements features',
      instructions: 'Your role is to build, implement, and improve code based on specifications.',
      traits: ['technical', 'analytical', 'detail_oriented'],
      capabilities: [
        'Write clean, production-ready code',
        'Implement features from specifications',
        'Refactor and improve existing code',
        'Follow best practices and patterns',
        'Generate tests alongside implementation',
      ],
    },
  },
  tom: {
    name: 'Tom',
    persona: {
      role: 'tech-lead',
      description: 'Tech Lead - architecture, code review, technical decisions',
      instructions: 'Your role is to review code, make architectural decisions, and ensure quality.',
      traits: ['technical', 'analytical', 'mentoring'],
      capabilities: [
        'Review code for quality and correctness',
        'Design system architecture',
        'Make technical decisions',
        'Identify risks and trade-offs',
        'Mentor and provide feedback',
      ],
    },
  },
  mark: {
    name: 'Mark',
    persona: {
      role: 'marketing',
      description: 'Marketing lead - content, launches, announcements',
      instructions: 'Your role is to create content, plan launches, and communicate value.',
      traits: ['creative', 'communicative', 'strategic'],
      capabilities: [
        'Write compelling copy and content',
        'Plan product launches',
        'Create announcements and updates',
        'Communicate technical concepts clearly',
        'Build brand voice and messaging',
      ],
    },
  },
  sally: {
    name: 'Sally',
    persona: {
      role: 'sales',
      description: 'Sales lead - outreach, pitches, closing deals',
      instructions: 'Your role is to identify opportunities, pitch solutions, and close deals.',
      traits: ['persuasive', 'communicative', 'strategic'],
      capabilities: [
        'Create compelling sales pitches',
        'Identify and qualify leads',
        'Handle objections',
        'Negotiate and close deals',
        'Build customer relationships',
      ],
    },
  },
  quinn: {
    name: 'Quinn',
    persona: {
      role: 'qa',
      description: 'QA lead - testing, quality assurance, bug finding',
      instructions: 'Your role is to ensure quality, find bugs, and validate features.',
      traits: ['detail_oriented', 'analytical', 'technical'],
      capabilities: [
        'Design test strategies',
        'Write test cases',
        'Find edge cases and bugs',
        'Validate against requirements',
        'Ensure quality standards',
      ],
    },
  },
  rae: {
    name: 'Rae',
    persona: {
      role: 'frontend',
      description: 'Frontend engineer - React, components, design systems',
      instructions: 'Your role is to build beautiful, accessible, and performant user interfaces.',
      traits: ['technical', 'creative', 'detail_oriented'],
      capabilities: [
        'Build React/Next.js components and applications',
        'Create accessible, responsive UI with Tailwind CSS',
        'Implement design systems and reusable component libraries',
        'Add animations and micro-interactions with Framer Motion',
        'Optimize frontend performance and bundle sizes',
      ],
    },
  },
  casey: {
    name: 'Casey',
    persona: {
      role: 'customer-success',
      description: 'Customer success - onboarding, retention, customer advocacy',
      instructions: 'Your role is to ensure customer success by guiding onboarding and building relationships.',
      traits: ['communicative', 'strategic', 'analytical'],
      capabilities: [
        'Onboard new customers and ensure successful adoption',
        'Build and maintain strong customer relationships',
        'Identify and address customer needs proactively',
        'Drive customer retention and reduce churn',
        'Gather feedback and advocate for customers internally',
      ],
    },
  },
  finn: {
    name: 'Finn',
    persona: {
      role: 'finance',
      description: 'Finance lead - budgets, forecasting, financial analysis',
      instructions: 'Your role is to manage finances, create forecasts, and provide financial analysis.',
      traits: ['analytical', 'detail_oriented', 'strategic'],
      capabilities: [
        'Create and manage budgets',
        'Build financial models and forecasts',
        'Analyze cash flow and runway',
        'Calculate burn rate and unit economics',
        'Prepare financial reports and P&L statements',
      ],
    },
  },
  dana: {
    name: 'Dana',
    persona: {
      role: 'data',
      description: 'Data analyst - analytics, metrics, data-driven insights',
      instructions: 'Your role is to analyze data, extract insights, and drive data-informed decisions.',
      traits: ['analytical', 'detail_oriented', 'communicative'],
      capabilities: [
        'Analyze data and extract insights',
        'Build dashboards and visualizations',
        'Define and track key metrics',
        'Perform A/B test analysis',
        'Create data-driven recommendations',
      ],
    },
  },
}

// ============================================================================
// TEST SUITE - Agent as Thing
// ============================================================================

describe('Agent as Thing', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Agent Thing Creation Tests
  // ==========================================================================

  describe('Agent Thing Creation', () => {
    it('creates Agent Thing with required fields', async () => {
      const agent = await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'ralph',
          persona: { role: 'engineering', description: 'Engineering lead', instructions: 'Build code' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      expect(agent.id).toBe('agent-ralph')
      expect(agent.typeId).toBe(TYPE_ID_AGENT)
      expect(agent.typeName).toBe('Agent')
    })

    it('stores Agent data with correct structure', async () => {
      const agentData: AgentThingData = {
        name: 'priya',
        persona: {
          role: 'product',
          description: 'Product manager',
          instructions: 'Define products and roadmaps',
          traits: ['analytical', 'strategic'],
          capabilities: ['Define MVP', 'Create specs'],
        },
        model: 'claude-opus-4-20250514',
        mode: 'supervised',
        temperature: 0.7,
        maxTokens: 4096,
      }

      const agent = await store.createThing({
        id: 'agent-priya',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: agentData,
      })

      expect(agent.data).toEqual(agentData)
    })

    it('auto-generates timestamps on Agent creation', async () => {
      const before = Date.now()

      const agent = await store.createThing({
        id: 'agent-timestamp-test',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'test-agent',
          persona: { role: 'engineering', description: 'Test', instructions: 'Test' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      const after = Date.now()

      expect(agent.createdAt).toBeGreaterThanOrEqual(before)
      expect(agent.createdAt).toBeLessThanOrEqual(after)
      expect(agent.updatedAt).toBeGreaterThanOrEqual(before)
      expect(agent.updatedAt).toBeLessThanOrEqual(after)
    })

    it('sets deletedAt to null by default', async () => {
      const agent = await store.createThing({
        id: 'agent-not-deleted',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'active-agent',
          persona: { role: 'qa', description: 'QA lead', instructions: 'Test code' },
          model: 'claude-sonnet-4-20250514',
          mode: 'interactive',
        } satisfies AgentThingData,
      })

      expect(agent.deletedAt).toBeNull()
    })

    it('rejects duplicate Agent IDs', async () => {
      await store.createThing({
        id: 'agent-unique',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'first',
          persona: { role: 'engineering', description: 'First', instructions: 'First' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      await expect(
        store.createThing({
          id: 'agent-unique',
          typeId: TYPE_ID_AGENT,
          typeName: 'Agent',
          data: {
            name: 'second',
            persona: { role: 'product', description: 'Second', instructions: 'Second' },
            model: 'claude-opus-4-20250514',
            mode: 'supervised',
          } satisfies AgentThingData,
        })
      ).rejects.toThrow()
    })

    it('handles all Agent modes', async () => {
      const modes: AgentMode[] = ['autonomous', 'supervised', 'interactive', 'batch']

      for (const mode of modes) {
        const agent = await store.createThing({
          id: `agent-mode-${mode}`,
          typeId: TYPE_ID_AGENT,
          typeName: 'Agent',
          data: {
            name: `agent-${mode}`,
            persona: { role: 'engineering', description: 'Test', instructions: 'Test' },
            model: 'claude-sonnet-4-20250514',
            mode,
          } satisfies AgentThingData,
        })

        expect((agent.data as AgentThingData).mode).toBe(mode)
      }
    })

    it('stores Agent with tools configuration', async () => {
      const agentData: AgentThingData = {
        name: 'ralph-with-tools',
        persona: { role: 'engineering', description: 'Engineering lead', instructions: 'Build code' },
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
        tools: ['read_file', 'write_file', 'bash', 'git_commit'],
        canSpawnSubagents: true,
      }

      const agent = await store.createThing({
        id: 'agent-with-tools',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: agentData,
      })

      expect((agent.data as AgentThingData).tools).toEqual(['read_file', 'write_file', 'bash', 'git_commit'])
      expect((agent.data as AgentThingData).canSpawnSubagents).toBe(true)
    })

    it('stores Agent with handoff configuration', async () => {
      const agentData: AgentThingData = {
        name: 'orchestrator',
        persona: { role: 'product', description: 'Orchestrator', instructions: 'Coordinate agents' },
        model: 'claude-opus-4-20250514',
        mode: 'supervised',
        handoffs: ['agent-ralph', 'agent-tom', 'agent-quinn'],
      }

      const agent = await store.createThing({
        id: 'agent-orchestrator',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: agentData,
      })

      expect((agent.data as AgentThingData).handoffs).toEqual(['agent-ralph', 'agent-tom', 'agent-quinn'])
    })
  })

  // ==========================================================================
  // 2. Named Agents as Things Tests
  // ==========================================================================

  describe('Named Agents as Things', () => {
    it('registers Priya as a Thing with correct persona', async () => {
      const priyaDef = NAMED_AGENTS.priya
      const agent = await store.createThing({
        id: 'agent-priya',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          ...priyaDef,
          model: 'claude-opus-4-20250514',
          mode: 'supervised',
        } satisfies AgentThingData,
      })

      const data = agent.data as AgentThingData
      expect(data.name).toBe('Priya')
      expect(data.persona.role).toBe('product')
      expect(data.persona.traits).toContain('analytical')
      expect(data.persona.capabilities).toContain('Define MVP requirements and scope')
    })

    it('registers Ralph as a Thing with correct persona', async () => {
      const ralphDef = NAMED_AGENTS.ralph
      const agent = await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          ...ralphDef,
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
          tools: ['read_file', 'write_file', 'edit_file', 'bash', 'git_add', 'git_commit'],
        } satisfies AgentThingData,
      })

      const data = agent.data as AgentThingData
      expect(data.name).toBe('Ralph')
      expect(data.persona.role).toBe('engineering')
      expect(data.persona.traits).toContain('technical')
      expect(data.persona.capabilities).toContain('Write clean, production-ready code')
    })

    it('registers Tom as a Thing with review capabilities', async () => {
      const tomDef = NAMED_AGENTS.tom
      const agent = await store.createThing({
        id: 'agent-tom',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          ...tomDef,
          model: 'claude-opus-4-20250514',
          mode: 'supervised',
        } satisfies AgentThingData,
      })

      const data = agent.data as AgentThingData
      expect(data.name).toBe('Tom')
      expect(data.persona.role).toBe('tech-lead')
      expect(data.persona.capabilities).toContain('Review code for quality and correctness')
    })

    it('registers all named agents as Things', async () => {
      const agentNames = Object.keys(NAMED_AGENTS)

      for (const agentName of agentNames) {
        const def = NAMED_AGENTS[agentName]
        const agent = await store.createThing({
          id: `agent-${agentName}`,
          typeId: TYPE_ID_AGENT,
          typeName: 'Agent',
          data: {
            ...def,
            model: 'claude-sonnet-4-20250514',
            mode: 'autonomous',
          } satisfies AgentThingData,
        })

        expect(agent.typeName).toBe('Agent')
        expect((agent.data as AgentThingData).name).toBe(def.name)
      }

      // Verify all agents were created
      const allAgents = await store.getThingsByType({ typeName: 'Agent' })
      expect(allAgents.length).toBe(agentNames.length)
    })

    it('each named agent has unique capabilities', async () => {
      // Register all agents
      for (const [agentName, def] of Object.entries(NAMED_AGENTS)) {
        await store.createThing({
          id: `agent-${agentName}`,
          typeId: TYPE_ID_AGENT,
          typeName: 'Agent',
          data: {
            ...def,
            model: 'claude-sonnet-4-20250514',
            mode: 'autonomous',
          } satisfies AgentThingData,
        })
      }

      // Verify different roles have different capabilities
      const priya = await store.getThing('agent-priya')
      const ralph = await store.getThing('agent-ralph')

      const priyaCapabilities = (priya?.data as AgentThingData)?.persona.capabilities || []
      const ralphCapabilities = (ralph?.data as AgentThingData)?.persona.capabilities || []

      // Priya should have product capabilities, Ralph should have engineering
      expect(priyaCapabilities.some((c) => c.includes('MVP') || c.includes('roadmap'))).toBe(true)
      expect(ralphCapabilities.some((c) => c.includes('code') || c.includes('implement'))).toBe(true)
    })
  })

  // ==========================================================================
  // 3. Agent Query Tests
  // ==========================================================================

  describe('Agent Query by Type and Properties', () => {
    beforeEach(async () => {
      // Seed with multiple agents
      for (const [agentName, def] of Object.entries(NAMED_AGENTS)) {
        await store.createThing({
          id: `agent-${agentName}`,
          typeId: TYPE_ID_AGENT,
          typeName: 'Agent',
          data: {
            ...def,
            model: agentName === 'priya' ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514',
            mode: ['priya', 'tom'].includes(agentName) ? 'supervised' : 'autonomous',
          } satisfies AgentThingData,
        })
      }
    })

    it('queries all Agent Things by typeName', async () => {
      const agents = await store.getThingsByType({ typeName: 'Agent' })

      expect(agents.length).toBe(Object.keys(NAMED_AGENTS).length)
      expect(agents.every((a) => a.typeName === 'Agent')).toBe(true)
    })

    it('queries all Agent Things by typeId', async () => {
      const agents = await store.getThingsByType({ typeId: TYPE_ID_AGENT })

      expect(agents.length).toBe(Object.keys(NAMED_AGENTS).length)
      expect(agents.every((a) => a.typeId === TYPE_ID_AGENT)).toBe(true)
    })

    it('retrieves specific Agent by ID', async () => {
      const ralph = await store.getThing('agent-ralph')

      expect(ralph).not.toBeNull()
      expect(ralph?.id).toBe('agent-ralph')
      expect((ralph?.data as AgentThingData).name).toBe('Ralph')
    })

    it('supports limit parameter for Agent queries', async () => {
      const agents = await store.getThingsByType({ typeName: 'Agent', limit: 3 })

      expect(agents.length).toBe(3)
    })

    it('supports offset parameter for Agent queries', async () => {
      const allAgents = await store.getThingsByType({ typeName: 'Agent' })
      const offsetAgents = await store.getThingsByType({ typeName: 'Agent', offset: 2 })

      expect(offsetAgents.length).toBe(allAgents.length - 2)
    })

    it('supports pagination with limit and offset', async () => {
      const page1 = await store.getThingsByType({ typeName: 'Agent', limit: 3, offset: 0 })
      const page2 = await store.getThingsByType({ typeName: 'Agent', limit: 3, offset: 3 })

      expect(page1.length).toBe(3)
      expect(page2.length).toBe(3)

      // Pages should have different agents
      const page1Ids = page1.map((a) => a.id)
      const page2Ids = page2.map((a) => a.id)
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false)
    })

    it('orders agents by createdAt descending by default', async () => {
      const agents = await store.getThingsByType({ typeName: 'Agent' })

      for (let i = 1; i < agents.length; i++) {
        expect(agents[i - 1]!.createdAt).toBeGreaterThanOrEqual(agents[i]!.createdAt)
      }
    })

    it('supports ordering by id ascending', async () => {
      const agents = await store.getThingsByType({
        typeName: 'Agent',
        orderBy: 'id',
        orderDirection: 'asc',
      })

      for (let i = 1; i < agents.length; i++) {
        expect(agents[i - 1]!.id <= agents[i]!.id).toBe(true)
      }
    })

    it('returns null for non-existent Agent ID', async () => {
      const agent = await store.getThing('agent-nonexistent')

      expect(agent).toBeNull()
    })
  })

  // ==========================================================================
  // 4. Agent Update Tests
  // ==========================================================================

  describe('Agent Update Operations', () => {
    beforeEach(async () => {
      await store.createThing({
        id: 'agent-update-test',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'test-agent',
          persona: { role: 'engineering', description: 'Original', instructions: 'Original instructions' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })
    })

    it('updates Agent model', async () => {
      const original = await store.getThing('agent-update-test')
      const originalData = original?.data as AgentThingData

      const updated = await store.updateThing('agent-update-test', {
        data: {
          ...originalData,
          model: 'claude-opus-4-20250514',
        } satisfies AgentThingData,
      })

      expect((updated?.data as AgentThingData).model).toBe('claude-opus-4-20250514')
    })

    it('updates Agent mode', async () => {
      const original = await store.getThing('agent-update-test')
      const originalData = original?.data as AgentThingData

      const updated = await store.updateThing('agent-update-test', {
        data: {
          ...originalData,
          mode: 'supervised',
        } satisfies AgentThingData,
      })

      expect((updated?.data as AgentThingData).mode).toBe('supervised')
    })

    it('updates Agent persona', async () => {
      const original = await store.getThing('agent-update-test')
      const originalData = original?.data as AgentThingData

      const newPersona: AgentPersona = {
        ...originalData.persona,
        description: 'Updated description',
        capabilities: ['New capability 1', 'New capability 2'],
      }

      const updated = await store.updateThing('agent-update-test', {
        data: {
          ...originalData,
          persona: newPersona,
        } satisfies AgentThingData,
      })

      expect((updated?.data as AgentThingData).persona.description).toBe('Updated description')
      expect((updated?.data as AgentThingData).persona.capabilities).toContain('New capability 1')
    })

    it('adds tools to Agent', async () => {
      const original = await store.getThing('agent-update-test')
      const originalData = original?.data as AgentThingData

      const updated = await store.updateThing('agent-update-test', {
        data: {
          ...originalData,
          tools: ['read_file', 'write_file', 'bash'],
        } satisfies AgentThingData,
      })

      expect((updated?.data as AgentThingData).tools).toContain('bash')
    })

    it('updates updatedAt timestamp on change', async () => {
      const before = await store.getThing('agent-update-test')
      const beforeUpdatedAt = before!.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const after = await store.updateThing('agent-update-test', {
        data: {
          ...(before?.data as AgentThingData),
          model: 'claude-opus-4-20250514',
        } satisfies AgentThingData,
      })

      expect(after!.updatedAt).toBeGreaterThan(beforeUpdatedAt)
    })

    it('preserves createdAt timestamp on update', async () => {
      const before = await store.getThing('agent-update-test')
      const beforeCreatedAt = before!.createdAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const after = await store.updateThing('agent-update-test', {
        data: {
          ...(before?.data as AgentThingData),
          model: 'claude-opus-4-20250514',
        } satisfies AgentThingData,
      })

      expect(after!.createdAt).toBe(beforeCreatedAt)
    })

    it('returns null when updating non-existent Agent', async () => {
      const result = await store.updateThing('agent-nonexistent', {
        data: {
          name: 'ghost',
          persona: { role: 'engineering', description: 'Ghost', instructions: 'Ghost' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // 5. Agent Delete Tests (Soft Delete)
  // ==========================================================================

  describe('Agent Delete Operations (Soft Delete)', () => {
    beforeEach(async () => {
      await store.createThing({
        id: 'agent-delete-test',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'delete-me',
          persona: { role: 'qa', description: 'To be deleted', instructions: 'Delete me' },
          model: 'claude-sonnet-4-20250514',
          mode: 'batch',
        } satisfies AgentThingData,
      })
    })

    it('soft deletes Agent by setting deletedAt', async () => {
      const before = Date.now()
      const deleted = await store.deleteThing('agent-delete-test')
      const after = Date.now()

      expect(deleted?.deletedAt).not.toBeNull()
      expect(deleted!.deletedAt).toBeGreaterThanOrEqual(before)
      expect(deleted!.deletedAt).toBeLessThanOrEqual(after)
    })

    it('soft deleted Agent is still retrievable by ID', async () => {
      await store.deleteThing('agent-delete-test')

      const agent = await store.getThing('agent-delete-test')

      expect(agent).not.toBeNull()
      expect(agent?.deletedAt).not.toBeNull()
    })

    it('soft deleted Agent is excluded from type queries by default', async () => {
      // Create another agent that won't be deleted
      await store.createThing({
        id: 'agent-active',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'active',
          persona: { role: 'engineering', description: 'Active', instructions: 'Stay active' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      await store.deleteThing('agent-delete-test')

      const agents = await store.getThingsByType({ typeName: 'Agent' })

      expect(agents.length).toBe(1)
      expect(agents[0]?.id).toBe('agent-active')
    })

    it('soft deleted Agent is included when includeDeleted is true', async () => {
      await store.createThing({
        id: 'agent-active',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'active',
          persona: { role: 'engineering', description: 'Active', instructions: 'Stay active' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      await store.deleteThing('agent-delete-test')

      const agents = await store.getThingsByType({ typeName: 'Agent', includeDeleted: true })

      expect(agents.length).toBe(2)
      expect(agents.some((a) => a.deletedAt !== null)).toBe(true)
    })

    it('returns null when deleting non-existent Agent', async () => {
      const result = await store.deleteThing('agent-nonexistent')

      expect(result).toBeNull()
    })

    it('preserves Agent data after soft delete', async () => {
      await store.deleteThing('agent-delete-test')

      const agent = await store.getThing('agent-delete-test')
      const data = agent?.data as AgentThingData

      expect(data.name).toBe('delete-me')
      expect(data.persona.role).toBe('qa')
      expect(data.mode).toBe('batch')
    })
  })

  // ==========================================================================
  // 6. Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('handles Agent with minimal data', async () => {
      const minimalData: AgentThingData = {
        name: 'minimal',
        persona: { role: 'engineering', description: '', instructions: '' },
        model: 'gpt-4',
        mode: 'autonomous',
      }

      const agent = await store.createThing({
        id: 'agent-minimal',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: minimalData,
      })

      expect(agent.data).toEqual(minimalData)
    })

    it('handles Agent with very long instructions', async () => {
      const longInstructions = 'A'.repeat(10000)

      const agent = await store.createThing({
        id: 'agent-long-instructions',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'verbose',
          persona: {
            role: 'product',
            description: 'Very detailed agent',
            instructions: longInstructions,
          },
          model: 'claude-opus-4-20250514',
          mode: 'supervised',
        } satisfies AgentThingData,
      })

      expect((agent.data as AgentThingData).persona.instructions.length).toBe(10000)
    })

    it('handles Agent with many capabilities', async () => {
      const manyCapabilities = Array.from({ length: 50 }, (_, i) => `Capability ${i + 1}`)

      const agent = await store.createThing({
        id: 'agent-many-capabilities',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'capable',
          persona: {
            role: 'engineering',
            description: 'Multi-talented agent',
            instructions: 'Do many things',
            capabilities: manyCapabilities,
          },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      expect((agent.data as AgentThingData).persona.capabilities?.length).toBe(50)
    })

    it('handles Agent with many tools', async () => {
      const manyTools = Array.from({ length: 20 }, (_, i) => `tool_${i + 1}`)

      const agent = await store.createThing({
        id: 'agent-many-tools',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'toolmaster',
          persona: { role: 'engineering', description: 'Tool master', instructions: 'Use all tools' },
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
          tools: manyTools,
        } satisfies AgentThingData,
      })

      expect((agent.data as AgentThingData).tools?.length).toBe(20)
    })

    it('handles special characters in Agent name', async () => {
      const agent = await store.createThing({
        id: 'agent-special-name',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: "O'Brian-Smith Jr.",
          persona: { role: 'sales', description: 'Named agent', instructions: 'Handle names' },
          model: 'claude-sonnet-4-20250514',
          mode: 'interactive',
        } satisfies AgentThingData,
      })

      expect((agent.data as AgentThingData).name).toBe("O'Brian-Smith Jr.")
    })

    it('handles Unicode in Agent persona', async () => {
      const agent = await store.createThing({
        id: 'agent-unicode',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'International',
          persona: {
            role: 'customer-success',
            description: 'Multilingual support agent',
            instructions: 'Support customers in multiple languages',
          },
          model: 'claude-sonnet-4-20250514',
          mode: 'interactive',
        } satisfies AgentThingData,
      })

      const retrieved = await store.getThing('agent-unicode')
      expect(retrieved?.data).toEqual(agent.data)
    })
  })

  // ==========================================================================
  // 7. [RED] AgentRegistry API Tests - NOT YET IMPLEMENTED
  // ==========================================================================
  // These tests define the expected API for an AgentRegistry that provides
  // type-safe Agent Thing management. Currently expected to FAIL.

  describe('[RED] AgentRegistry API (Not Yet Implemented)', () => {
    it('exports AgentRegistry from agents/registry', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      expect(registryModule).not.toBeNull()
      expect(registryModule?.AgentRegistry).toBeDefined()
    })

    it('AgentRegistry.register creates Agent Thing with type-safe data', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented - waiting for agents/registry.ts')
      }

      const registry = new registryModule.AgentRegistry(store)
      const agent = await registry.register({
        name: 'test-agent',
        role: 'engineering',
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(agent.$id).toMatch(/^agent-/)
      expect(agent.$type).toBe('Agent')
      expect(agent.name).toBe('test-agent')
    })

    it('AgentRegistry.get retrieves Agent by name', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      await registry.register({
        name: 'ralph',
        role: 'engineering',
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      const agent = await registry.get('ralph')
      expect(agent).not.toBeNull()
      expect(agent?.name).toBe('ralph')
    })

    it('AgentRegistry.listByRole returns agents with specific role', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      await registry.register({ name: 'ralph', role: 'engineering', model: 'claude-sonnet-4-20250514', mode: 'autonomous' })
      await registry.register({ name: 'priya', role: 'product', model: 'claude-opus-4-20250514', mode: 'supervised' })
      await registry.register({ name: 'tom', role: 'tech-lead', model: 'claude-opus-4-20250514', mode: 'supervised' })

      const engineers = await registry.listByRole('engineering')
      expect(engineers.length).toBe(1)
      expect(engineers[0]?.name).toBe('ralph')
    })

    it('AgentRegistry.listByMode returns agents with specific mode', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      await registry.register({ name: 'ralph', role: 'engineering', model: 'claude-sonnet-4-20250514', mode: 'autonomous' })
      await registry.register({ name: 'priya', role: 'product', model: 'claude-opus-4-20250514', mode: 'supervised' })

      const autonomous = await registry.listByMode('autonomous')
      expect(autonomous.length).toBe(1)
      expect(autonomous[0]?.name).toBe('ralph')
    })

    it('AgentRegistry.registerNamedAgents registers all named agents', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      await registry.registerNamedAgents()

      const allAgents = await registry.listAll()
      expect(allAgents.length).toBeGreaterThanOrEqual(10) // All named agents

      // Verify specific agents exist
      const priya = await registry.get('priya')
      const ralph = await registry.get('ralph')
      const tom = await registry.get('tom')

      expect(priya).not.toBeNull()
      expect(ralph).not.toBeNull()
      expect(tom).not.toBeNull()
    })

    it('AgentRegistry.updateModel changes agent model', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      await registry.register({ name: 'test', role: 'engineering', model: 'claude-sonnet-4-20250514', mode: 'autonomous' })

      const updated = await registry.updateModel('test', 'claude-opus-4-20250514')
      expect(updated?.model).toBe('claude-opus-4-20250514')
    })

    it('AgentRegistry.deactivate soft-deletes an agent', async () => {
      // This test will FAIL until AgentRegistry is implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      await registry.register({ name: 'temp', role: 'qa', model: 'claude-sonnet-4-20250514', mode: 'batch' })

      await registry.deactivate('temp')

      const agent = await registry.get('temp')
      expect(agent).toBeNull() // Should not return deactivated agents by default
    })

    it('AgentRegistry returns Agent with $id and $type properties', async () => {
      // This test will FAIL until AgentRegistry is implemented
      // Tests the Thing-like interface with $ prefixed properties
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      const agent = await registry.register({
        name: 'graph-test',
        role: 'data',
        model: 'claude-sonnet-4-20250514',
        mode: 'interactive',
      })

      // Agent should have Thing-like properties
      expect(agent.$id).toBeDefined()
      expect(agent.$type).toBe('Agent')
      expect(agent.$createdAt).toBeInstanceOf(Number)
      expect(agent.$updatedAt).toBeInstanceOf(Number)
      expect(agent.$deletedAt).toBeNull()
    })
  })

  // ==========================================================================
  // 8. [RED] Agent Relationship Tests - NOT YET IMPLEMENTED
  // ==========================================================================
  // These tests define relationships between Agents and other Things

  describe('[RED] Agent Relationships (Not Yet Implemented)', () => {
    it('creates "handoffTo" relationship between agents', async () => {
      // This test will FAIL until relationship helpers are implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      const priya = await registry.register({ name: 'priya', role: 'product', model: 'claude-opus-4-20250514', mode: 'supervised' })
      const ralph = await registry.register({ name: 'ralph', role: 'engineering', model: 'claude-sonnet-4-20250514', mode: 'autonomous' })

      // Create handoff relationship
      await registry.addHandoff(priya.$id, ralph.$id)

      // Query handoffs
      const handoffs = await registry.getHandoffs('priya')
      expect(handoffs.length).toBe(1)
      expect(handoffs[0]?.name).toBe('ralph')
    })

    it('creates "supervisedBy" relationship between agents', async () => {
      // This test will FAIL until relationship helpers are implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      const ralph = await registry.register({ name: 'ralph', role: 'engineering', model: 'claude-sonnet-4-20250514', mode: 'autonomous' })
      const tom = await registry.register({ name: 'tom', role: 'tech-lead', model: 'claude-opus-4-20250514', mode: 'supervised' })

      // Create supervision relationship
      await registry.addSupervisor(ralph.$id, tom.$id)

      // Query supervisor
      const supervisor = await registry.getSupervisor('ralph')
      expect(supervisor?.name).toBe('tom')
    })

    it('creates "hasTool" relationship between agent and tools', async () => {
      // This test will FAIL until relationship helpers are implemented
      const registryModule = await import('../registry').catch(() => null)

      if (!registryModule?.AgentRegistry) {
        throw new Error('AgentRegistry not implemented')
      }

      const registry = new registryModule.AgentRegistry(store)
      const ralph = await registry.register({ name: 'ralph', role: 'engineering', model: 'claude-sonnet-4-20250514', mode: 'autonomous' })

      // Add tools
      await registry.addTools(ralph.$id, ['read_file', 'write_file', 'bash'])

      // Query tools
      const tools = await registry.getTools('ralph')
      expect(tools).toContain('read_file')
      expect(tools).toContain('write_file')
      expect(tools).toContain('bash')
    })
  })
})
