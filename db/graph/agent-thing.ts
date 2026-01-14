/**
 * Agent Thing - Agents as Graph Things
 *
 * Represents Agents as Things in the unified DO Graph data model, enabling:
 * - Agent discovery and querying
 * - Relationship tracking (agent-to-agent handoffs, tool usage, memory)
 * - Named agent registration (Priya, Ralph, Tom, etc.)
 *
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 * @see dotdo-ewo1a - [GREEN] Agent as Thing - Core Schema Tests
 *
 * Design:
 * - Agent Things use type URL: 'https://agents.do/Agent'
 * - Agent data includes: persona (role, name, description), model, mode
 * - Named agents are pre-registered Things with well-known $id URLs
 * - Uses real SQLite in production (Durable Objects), NO MOCKS
 *
 * @example
 * ```typescript
 * import { createAgentThing, getAgentThing, registerNamedAgents } from 'db/graph/agent-thing'
 *
 * // Create a custom agent
 * const agent = await createAgentThing(db, {
 *   name: 'my-engineer',
 *   persona: { role: 'engineering', name: 'My Engineer', description: 'Custom engineer' },
 *   model: 'claude-sonnet-4-20250514',
 *   mode: 'autonomous',
 * })
 *
 * // Register all named agents
 * await registerNamedAgents(db)
 *
 * // Get a named agent
 * const ralph = await getAgentThing(db, 'ralph')
 * ```
 *
 * @module db/graph/agent-thing
 */

import { createThing, getThing, getThingsByType, updateThing, deleteThing } from './things'
import type { GraphThing } from './things'

// Persona definitions for named agents
// Note: Named agents module was removed, using inline stub
const PERSONA_DEFINITIONS: Record<string, { description?: string; instructions?: string } | undefined> = {}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Agent type URL - follows W3C convention for type identification
 */
export const AGENT_TYPE = 'https://agents.do/Agent'

/**
 * Agent type ID (conventional value for graph_things.typeId)
 */
export const AGENT_TYPE_ID = 20

/**
 * Agent type name (for graph_things.typeName)
 */
export const AGENT_TYPE_NAME = 'Agent'

/**
 * Default model for agents
 */
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-20250514'

/**
 * Named agents from the persona system
 */
export const NAMED_AGENTS = ['priya', 'ralph', 'tom', 'mark', 'sally', 'quinn', 'rae', 'casey', 'finn', 'dana'] as const

export type NamedAgentName = typeof NAMED_AGENTS[number]

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Agent operation modes
 */
export type AgentMode = 'autonomous' | 'supervised' | 'manual'

/**
 * Agent roles matching the named agent system
 */
export type AgentRole =
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
 * Agent persona as stored in Thing data
 */
export interface AgentPersonaData {
  role: AgentRole
  name: string
  description: string
}

/**
 * Agent Thing data structure
 */
export interface AgentThingData {
  persona: AgentPersonaData
  model: string
  mode: AgentMode
  /** Optional: tool IDs this agent has access to */
  tools?: string[]
  /** Optional: instructions/system prompt */
  instructions?: string
  /** Index signature for GraphStore compatibility */
  [key: string]: unknown
}

/**
 * Input for creating a new Agent Thing
 */
export interface CreateAgentThingInput {
  /** Agent name (used to generate URL-based ID) */
  name: string
  /** Agent persona */
  persona: AgentPersonaData
  /** Model to use */
  model: string
  /** Operation mode */
  mode: AgentMode
  /** Optional tool IDs */
  tools?: string[]
  /** Optional instructions */
  instructions?: string
}

/**
 * Input for updating an Agent Thing
 */
export interface UpdateAgentThingInput {
  /** Update model */
  model?: string
  /** Update mode */
  mode?: AgentMode
  /** Update tools */
  tools?: string[]
  /** Update instructions */
  instructions?: string
}

/**
 * Agent Thing - extends GraphThing with strongly-typed data
 */
export interface AgentThing extends Omit<GraphThing, 'data'> {
  data: AgentThingData
}

// ============================================================================
// VALID VALUES
// ============================================================================

const VALID_MODES: AgentMode[] = ['autonomous', 'supervised', 'manual']
const VALID_ROLES: AgentRole[] = [
  'product',
  'engineering',
  'tech-lead',
  'marketing',
  'sales',
  'qa',
  'frontend',
  'customer-success',
  'finance',
  'data',
]

// ============================================================================
// AGENT CRUD OPERATIONS
// ============================================================================

/**
 * Generate URL-based ID for an agent
 */
function generateAgentId(name: string): string {
  return `https://agents.do/${name}`
}

/**
 * Create a new Agent Thing.
 *
 * @param db - Database instance
 * @param input - Agent creation input
 * @returns The created Agent Thing
 * @throws Error if agent with same name already exists or invalid mode/role
 *
 * @example
 * ```typescript
 * const agent = await createAgentThing(db, {
 *   name: 'my-engineer',
 *   persona: { role: 'engineering', name: 'My Engineer', description: 'Custom engineer' },
 *   model: 'claude-sonnet-4-20250514',
 *   mode: 'autonomous',
 * })
 * ```
 */
export async function createAgentThing(
  db: object,
  input: CreateAgentThingInput
): Promise<AgentThing> {
  // Validate mode
  if (!VALID_MODES.includes(input.mode)) {
    throw new Error(`Invalid agent mode: ${input.mode}. Valid modes are: ${VALID_MODES.join(', ')}`)
  }

  // Validate role
  if (!VALID_ROLES.includes(input.persona.role)) {
    throw new Error(`Invalid agent role: ${input.persona.role}. Valid roles are: ${VALID_ROLES.join(', ')}`)
  }

  const agentId = generateAgentId(input.name)

  // Check for duplicate
  const existing = await getThing(db, agentId)
  if (existing) {
    throw new Error(`Agent with name '${input.name}' already exists (ID: ${agentId})`)
  }

  const agentData: AgentThingData = {
    persona: input.persona,
    model: input.model,
    mode: input.mode,
    ...(input.tools && { tools: input.tools }),
    ...(input.instructions && { instructions: input.instructions }),
  }

  const thing = await createThing(db, {
    id: agentId,
    typeId: AGENT_TYPE_ID,
    typeName: AGENT_TYPE_NAME,
    data: agentData,
  })

  return thing as AgentThing
}

/**
 * Get an Agent Thing by name.
 *
 * @param db - Database instance
 * @param name - Agent name (e.g., 'ralph', 'priya')
 * @returns The Agent Thing or null if not found
 */
export async function getAgentThing(db: object, name: string): Promise<AgentThing | null> {
  const agentId = generateAgentId(name)
  const thing = await getThing(db, agentId)

  if (!thing || thing.typeName !== AGENT_TYPE_NAME) {
    return null
  }

  return thing as AgentThing
}

/**
 * Get all Agent Things.
 *
 * @param db - Database instance
 * @returns Array of Agent Things
 */
export async function getAllAgents(db: object): Promise<AgentThing[]> {
  const things = await getThingsByType(db, {
    typeName: AGENT_TYPE_NAME,
    includeDeleted: false,
  })

  return things as AgentThing[]
}

/**
 * Get Agent Things by role.
 *
 * @param db - Database instance
 * @param role - Agent role to filter by
 * @returns Array of Agent Things with the given role
 */
export async function getAgentsByRole(db: object, role: AgentRole): Promise<AgentThing[]> {
  const allAgents = await getAllAgents(db)
  return allAgents.filter((agent) => agent.data.persona.role === role)
}

/**
 * Update an Agent Thing.
 *
 * @param db - Database instance
 * @param name - Agent name
 * @param updates - Fields to update
 * @returns The updated Agent Thing or null if not found
 */
export async function updateAgentThing(
  db: object,
  name: string,
  updates: UpdateAgentThingInput
): Promise<AgentThing | null> {
  const existing = await getAgentThing(db, name)
  if (!existing) {
    return null
  }

  // Validate mode if updating
  if (updates.mode && !VALID_MODES.includes(updates.mode)) {
    throw new Error(`Invalid agent mode: ${updates.mode}. Valid modes are: ${VALID_MODES.join(', ')}`)
  }

  const agentId = generateAgentId(name)

  // Build new data by merging
  const newData: AgentThingData = {
    ...existing.data,
    ...(updates.model !== undefined && { model: updates.model }),
    ...(updates.mode !== undefined && { mode: updates.mode }),
    ...(updates.tools !== undefined && { tools: updates.tools }),
    ...(updates.instructions !== undefined && { instructions: updates.instructions }),
  }

  const updated = await updateThing(db, agentId, { data: newData })
  return updated as AgentThing | null
}

/**
 * Delete (soft-delete) an Agent Thing.
 *
 * @param db - Database instance
 * @param name - Agent name
 * @returns The deleted Agent Thing or null if not found
 */
export async function deleteAgentThing(db: object, name: string): Promise<AgentThing | null> {
  const agentId = generateAgentId(name)
  const deleted = await deleteThing(db, agentId)
  return deleted as AgentThing | null
}

// ============================================================================
// NAMED AGENT REGISTRATION
// ============================================================================

/**
 * Role mapping for named agents
 */
const NAMED_AGENT_ROLES: Record<NamedAgentName, AgentRole> = {
  priya: 'product',
  ralph: 'engineering',
  tom: 'tech-lead',
  mark: 'marketing',
  sally: 'sales',
  quinn: 'qa',
  rae: 'frontend',
  casey: 'customer-success',
  finn: 'finance',
  dana: 'data',
}

/**
 * Register all named agents as Things.
 *
 * This function registers the well-known named agents (Priya, Ralph, Tom, etc.)
 * as Agent Things in the graph. It's idempotent - calling it multiple times
 * won't create duplicates.
 *
 * @param db - Database instance
 *
 * @example
 * ```typescript
 * await registerNamedAgents(db)
 *
 * const ralph = await getAgentThing(db, 'ralph')
 * console.log(ralph?.data.persona.role) // 'engineering'
 * ```
 */
export async function registerNamedAgents(db: object): Promise<void> {
  for (const name of NAMED_AGENTS) {
    // Check if already registered
    const existing = await getAgentThing(db, name)
    if (existing) {
      continue
    }

    // Get persona from the agent SDK if available
    const personaDef = PERSONA_DEFINITIONS[name]
    const role = NAMED_AGENT_ROLES[name]

    // Capitalize first letter of name
    const displayName = name.charAt(0).toUpperCase() + name.slice(1)

    await createAgentThing(db, {
      name,
      persona: {
        role,
        name: displayName,
        description: personaDef?.description ?? `${displayName} - ${role} agent`,
      },
      model: DEFAULT_AGENT_MODEL,
      mode: 'autonomous',
      instructions: personaDef?.instructions,
    })
  }
}

// ============================================================================
// RELATIONSHIP VERBS FOR AGENTS
// ============================================================================

/**
 * Verbs for agent relationships in the graph
 */
export const AGENT_VERBS = {
  /** Agent has a memory (long-term or conversation) */
  HAS_MEMORY: 'hasMemory',
  /** Agent has access to a tool */
  HAS_TOOL: 'hasTool',
  /** Agent can use a tool (with permission level) */
  CAN_USE: 'canUse',
  /** Agent participates in a conversation */
  PARTICIPATES_IN: 'participatesIn',
  /** Agent handed off to another agent */
  HANDED_OFF_TO: 'handedOffTo',
  /** Agent spawned a subagent */
  SPAWNED: 'spawned',
  /** Agent created a resource */
  CREATED: 'created',
  /** Agent is managed by another agent/human */
  MANAGED_BY: 'managedBy',
  /** Agent belongs to an organization/team */
  BELONGS_TO: 'belongsTo',
} as const

export type AgentVerb = typeof AGENT_VERBS[keyof typeof AGENT_VERBS]

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if data is AgentThingData
 */
export function isAgentThingData(data: unknown): data is AgentThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.model === 'string' &&
    typeof d.mode === 'string' &&
    d.persona !== null &&
    typeof d.persona === 'object'
  )
}

/**
 * Type guard to check if a Thing is an Agent Thing
 */
export function isAgentThing(thing: GraphThing): thing is AgentThing {
  return thing.typeName === AGENT_TYPE_NAME && isAgentThingData(thing.data)
}
