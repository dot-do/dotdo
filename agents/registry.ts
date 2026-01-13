/**
 * AgentRegistry - Type-safe Agent Thing management
 *
 * Provides a high-level API for registering and managing Agents as Things
 * in the DO Graph data model.
 *
 * @see dotdo-zxc9x - [GREEN] Agent as Thing - Implementation
 * @module agents/registry
 */

import type { SQLiteGraphStore } from '../db/graph/stores/sqlite'
import type { GraphThing } from '../db/graph/types'
import { PERSONAS, type AgentRole, type AgentPersona } from './named/factory'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Reserved typeId for Agent Things */
export const TYPE_ID_AGENT = 100

/** Agent type name for graph queries */
export const AGENT_TYPE_NAME = 'Agent'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Agent mode - how the agent operates
 */
export type AgentMode = 'autonomous' | 'supervised' | 'interactive' | 'batch'

/**
 * Agent persona configuration (stored in Thing.data)
 */
export interface AgentPersonaData {
  role: AgentRole
  description: string
  instructions: string
  traits?: string[]
  capabilities?: string[]
  guidelines?: string[]
}

/**
 * Agent Thing data structure - stored in GraphThing.data
 */
export interface AgentThingData {
  /** Agent's unique name (e.g., 'ralph', 'priya') */
  name: string
  /** Agent persona configuration */
  persona: AgentPersonaData
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
 * Agent Thing with $ prefixed properties (Thing-like interface)
 */
export interface Agent {
  /** Unique identifier */
  $id: string
  /** Type name ('Agent') */
  $type: string
  /** Created timestamp */
  $createdAt: number
  /** Updated timestamp */
  $updatedAt: number
  /** Deleted timestamp (null if active) */
  $deletedAt: number | null
  /** Agent name */
  name: string
  /** Agent role */
  role: AgentRole
  /** Agent model */
  model: string
  /** Agent mode */
  mode: AgentMode
  /** Agent persona */
  persona: AgentPersonaData
  /** Optional temperature */
  temperature?: number
  /** Optional max tokens */
  maxTokens?: number
  /** Optional tools */
  tools?: string[]
  /** Optional handoffs */
  handoffs?: string[]
  /** Optional subagent spawning */
  canSpawnSubagents?: boolean
}

/**
 * Input for registering a new agent
 */
export interface RegisterAgentInput {
  /** Agent name */
  name: string
  /** Agent role */
  role: AgentRole
  /** AI model */
  model: string
  /** Operation mode */
  mode: AgentMode
  /** Optional description override */
  description?: string
  /** Optional instructions override */
  instructions?: string
  /** Optional temperature */
  temperature?: number
  /** Optional max tokens */
  maxTokens?: number
  /** Optional tools */
  tools?: string[]
  /** Optional handoffs */
  handoffs?: string[]
  /** Optional subagent spawning */
  canSpawnSubagents?: boolean
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert a GraphThing to an Agent with $ prefixed properties
 */
function thingToAgent(thing: GraphThing): Agent {
  const data = thing.data as AgentThingData
  return {
    $id: thing.id,
    $type: thing.typeName,
    $createdAt: thing.createdAt,
    $updatedAt: thing.updatedAt,
    $deletedAt: thing.deletedAt,
    name: data.name,
    role: data.persona.role,
    model: data.model,
    mode: data.mode,
    persona: data.persona,
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    tools: data.tools,
    handoffs: data.handoffs,
    canSpawnSubagents: data.canSpawnSubagents,
  }
}

/**
 * Generate agent ID from name
 */
function agentId(name: string): string {
  return `agent-${name.toLowerCase()}`
}

/**
 * Get default description for a role
 */
function getDefaultDescription(role: AgentRole): string {
  const descriptions: Record<AgentRole, string> = {
    product: 'Product manager - specs, roadmaps, MVP definition',
    engineering: 'Engineering lead - builds code, implements features',
    'tech-lead': 'Tech Lead - architecture, code review, technical decisions',
    marketing: 'Marketing lead - content, launches, announcements',
    sales: 'Sales lead - outreach, pitches, closing deals',
    qa: 'QA lead - testing, quality assurance, bug finding',
    frontend: 'Frontend engineer - React, components, design systems',
    'customer-success': 'Customer success - onboarding, retention, customer advocacy',
    finance: 'Finance lead - budgets, forecasting, financial analysis',
    data: 'Data analyst - analytics, metrics, data-driven insights',
  }
  return descriptions[role]
}

/**
 * Get default instructions for a role
 */
function getDefaultInstructions(role: AgentRole): string {
  const instructions: Record<AgentRole, string> = {
    product: 'Your role is to define products, create specifications, and plan roadmaps.',
    engineering: 'Your role is to build, implement, and improve code based on specifications.',
    'tech-lead': 'Your role is to review code, make architectural decisions, and ensure quality.',
    marketing: 'Your role is to create content, plan launches, and communicate value.',
    sales: 'Your role is to identify opportunities, pitch solutions, and close deals.',
    qa: 'Your role is to ensure quality, find bugs, and validate features.',
    frontend: 'Your role is to build beautiful, accessible, and performant user interfaces.',
    'customer-success': 'Your role is to ensure customer success by guiding onboarding and building relationships.',
    finance: 'Your role is to manage finances, create forecasts, and provide financial analysis.',
    data: 'Your role is to analyze data, extract insights, and drive data-informed decisions.',
  }
  return instructions[role]
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

/**
 * AgentRegistry provides type-safe Agent Thing management.
 *
 * @example
 * ```typescript
 * const registry = new AgentRegistry(store)
 *
 * // Register a new agent
 * const agent = await registry.register({
 *   name: 'ralph',
 *   role: 'engineering',
 *   model: 'claude-sonnet-4-20250514',
 *   mode: 'autonomous',
 * })
 *
 * // Get agent by name
 * const ralph = await registry.get('ralph')
 *
 * // List agents by role
 * const engineers = await registry.listByRole('engineering')
 *
 * // Register all named agents from personas
 * await registry.registerNamedAgents()
 * ```
 */
export class AgentRegistry {
  private store: SQLiteGraphStore

  constructor(store: SQLiteGraphStore) {
    this.store = store
  }

  /**
   * Register a new agent as a Thing
   */
  async register(input: RegisterAgentInput): Promise<Agent> {
    const id = agentId(input.name)
    const description = input.description || getDefaultDescription(input.role)
    const instructions = input.instructions || getDefaultInstructions(input.role)

    const agentData: AgentThingData = {
      name: input.name,
      persona: {
        role: input.role,
        description,
        instructions,
      },
      model: input.model,
      mode: input.mode,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      tools: input.tools,
      handoffs: input.handoffs,
      canSpawnSubagents: input.canSpawnSubagents,
    }

    const thing = await this.store.createThing({
      id,
      typeId: TYPE_ID_AGENT,
      typeName: AGENT_TYPE_NAME,
      data: agentData,
    })

    return thingToAgent(thing)
  }

  /**
   * Get an agent by name
   */
  async get(name: string): Promise<Agent | null> {
    const id = agentId(name)
    const thing = await this.store.getThing(id)

    if (!thing || thing.deletedAt !== null) {
      return null
    }

    return thingToAgent(thing)
  }

  /**
   * List all agents
   */
  async listAll(): Promise<Agent[]> {
    const things = await this.store.getThingsByType({
      typeName: AGENT_TYPE_NAME,
    })

    return things.map(thingToAgent)
  }

  /**
   * List agents by role
   */
  async listByRole(role: AgentRole): Promise<Agent[]> {
    const things = await this.store.getThingsByType({
      typeName: AGENT_TYPE_NAME,
    })

    return things
      .filter(thing => {
        const data = thing.data as AgentThingData
        return data.persona.role === role
      })
      .map(thingToAgent)
  }

  /**
   * List agents by mode
   */
  async listByMode(mode: AgentMode): Promise<Agent[]> {
    const things = await this.store.getThingsByType({
      typeName: AGENT_TYPE_NAME,
    })

    return things
      .filter(thing => {
        const data = thing.data as AgentThingData
        return data.mode === mode
      })
      .map(thingToAgent)
  }

  /**
   * Register all named agents from the PERSONAS definitions
   */
  async registerNamedAgents(): Promise<void> {
    const namedAgents = [
      { name: 'priya', role: 'product' as AgentRole, model: 'claude-opus-4-20250514', mode: 'supervised' as AgentMode },
      { name: 'ralph', role: 'engineering' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'autonomous' as AgentMode },
      { name: 'tom', role: 'tech-lead' as AgentRole, model: 'claude-opus-4-20250514', mode: 'supervised' as AgentMode },
      { name: 'mark', role: 'marketing' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'autonomous' as AgentMode },
      { name: 'sally', role: 'sales' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'interactive' as AgentMode },
      { name: 'quinn', role: 'qa' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'batch' as AgentMode },
      { name: 'rae', role: 'frontend' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'autonomous' as AgentMode },
      { name: 'casey', role: 'customer-success' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'interactive' as AgentMode },
      { name: 'finn', role: 'finance' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'supervised' as AgentMode },
      { name: 'dana', role: 'data' as AgentRole, model: 'claude-sonnet-4-20250514', mode: 'autonomous' as AgentMode },
    ]

    for (const agent of namedAgents) {
      // Get persona from PERSONAS if available for richer instructions
      const persona = PERSONAS[agent.name]
      await this.register({
        name: agent.name,
        role: agent.role,
        model: agent.model,
        mode: agent.mode,
        description: persona?.description,
        instructions: persona?.instructions,
      })
    }
  }

  /**
   * Update an agent's model
   */
  async updateModel(name: string, model: string): Promise<Agent | null> {
    const id = agentId(name)
    const existing = await this.store.getThing(id)

    if (!existing) {
      return null
    }

    const data = existing.data as AgentThingData
    const updatedData: AgentThingData = {
      ...data,
      model,
    }

    const updated = await this.store.updateThing(id, { data: updatedData })

    if (!updated) {
      return null
    }

    return thingToAgent(updated)
  }

  /**
   * Deactivate (soft delete) an agent
   */
  async deactivate(name: string): Promise<Agent | null> {
    const id = agentId(name)
    const deleted = await this.store.deleteThing(id)

    if (!deleted) {
      return null
    }

    return thingToAgent(deleted)
  }

  // =========================================================================
  // RELATIONSHIP HELPERS
  // =========================================================================

  /**
   * Add a handoff relationship between agents
   */
  async addHandoff(fromAgentId: string, toAgentId: string): Promise<void> {
    await this.store.createRelationship({
      id: `handoff-${fromAgentId}-${toAgentId}`,
      verb: 'handoffTo',
      from: `do://agents/${fromAgentId}`,
      to: `do://agents/${toAgentId}`,
    })
  }

  /**
   * Get handoff targets for an agent
   */
  async getHandoffs(name: string): Promise<Agent[]> {
    const id = agentId(name)
    const relationships = await this.store.queryRelationshipsFrom(
      `do://agents/${id}`,
      { verb: 'handoffTo' }
    )

    const agents: Agent[] = []
    for (const rel of relationships) {
      // Extract agent ID from URL
      const targetId = rel.to.replace('do://agents/', '')
      const thing = await this.store.getThing(targetId)
      if (thing && thing.deletedAt === null) {
        agents.push(thingToAgent(thing))
      }
    }

    return agents
  }

  /**
   * Add a supervisor relationship between agents
   */
  async addSupervisor(agentId: string, supervisorId: string): Promise<void> {
    await this.store.createRelationship({
      id: `supervisor-${agentId}-${supervisorId}`,
      verb: 'supervisedBy',
      from: `do://agents/${agentId}`,
      to: `do://agents/${supervisorId}`,
    })
  }

  /**
   * Get supervisor for an agent
   */
  async getSupervisor(name: string): Promise<Agent | null> {
    const id = agentId(name)
    const relationships = await this.store.queryRelationshipsFrom(
      `do://agents/${id}`,
      { verb: 'supervisedBy' }
    )

    if (relationships.length === 0) {
      return null
    }

    const supervisorId = relationships[0].to.replace('do://agents/', '')
    const thing = await this.store.getThing(supervisorId)

    if (!thing || thing.deletedAt !== null) {
      return null
    }

    return thingToAgent(thing)
  }

  /**
   * Add tools to an agent
   */
  async addTools(agentIdOrName: string, tools: string[]): Promise<void> {
    // Normalize to agent ID
    const id = agentIdOrName.startsWith('agent-') ? agentIdOrName : agentId(agentIdOrName)
    const existing = await this.store.getThing(id)

    if (!existing) {
      return
    }

    const data = existing.data as AgentThingData
    const updatedData: AgentThingData = {
      ...data,
      tools: [...(data.tools || []), ...tools],
    }

    await this.store.updateThing(id, { data: updatedData })
  }

  /**
   * Get tools for an agent
   */
  async getTools(name: string): Promise<string[]> {
    const id = agentId(name)
    const thing = await this.store.getThing(id)

    if (!thing) {
      return []
    }

    const data = thing.data as AgentThingData
    return data.tools || []
  }
}
