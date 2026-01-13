/**
 * Agent Relationships - Graph Relationships for Agents
 *
 * Provides relationship operations between Agents and other entities:
 * - HAS_TOOL: Agent has access to a tool
 * - HAS_MEMORY: Agent owns a memory
 * - PARTICIPATES_IN: Agent participates in a conversation
 * - HANDED_OFF_TO: Agent handed off to another agent
 * - SPAWNED: Agent spawned a subagent
 *
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 * @module db/graph/agents/relationships
 */

import type { GraphRelationship } from '../relationships'
import { AGENT_VERBS } from '../agent-thing'

// ============================================================================
// IN-MEMORY RELATIONSHIP STORE
// ============================================================================

/**
 * Simple in-memory relationship store for testing
 * In production, this would use RelationshipsStore with real SQLite
 */
interface RelationshipRecord {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: number
}

const relationshipStore = new Map<string, RelationshipRecord>()

function generateRelId(verb: string, from: string, to: string): string {
  return `${verb}:${from}:${to}:${Date.now().toString(36)}`
}

async function createRelationship(
  _db: object,
  input: { verb: string; from: string; to: string; data?: Record<string, unknown> }
): Promise<RelationshipRecord> {
  const id = generateRelId(input.verb, input.from, input.to)
  const record: RelationshipRecord = {
    id,
    verb: input.verb,
    from: input.from,
    to: input.to,
    data: input.data ?? null,
    createdAt: Date.now(),
  }
  relationshipStore.set(id, record)
  return record
}

async function queryRelationshipsFrom(
  _db: object,
  from: string,
  options?: { verb?: string }
): Promise<RelationshipRecord[]> {
  const results: RelationshipRecord[] = []
  for (const rel of relationshipStore.values()) {
    if (rel.from === from) {
      if (!options?.verb || rel.verb === options.verb) {
        results.push(rel)
      }
    }
  }
  return results
}

async function queryRelationshipsTo(
  _db: object,
  to: string,
  options?: { verb?: string }
): Promise<RelationshipRecord[]> {
  const results: RelationshipRecord[] = []
  for (const rel of relationshipStore.values()) {
    if (rel.to === to) {
      if (!options?.verb || rel.verb === options.verb) {
        results.push(rel)
      }
    }
  }
  return results
}

async function deleteRelationship(_db: object, id: string): Promise<boolean> {
  return relationshipStore.delete(id)
}

// ============================================================================
// TOOL RELATIONSHIPS
// ============================================================================

/**
 * Add a tool to an agent (HAS_TOOL relationship).
 *
 * @param db - Database instance
 * @param agentId - Agent ID (e.g., 'https://agents.do/ralph')
 * @param toolId - Tool ID
 * @param options - Optional relationship data (permission level, etc.)
 *
 * @example
 * ```typescript
 * await addToolToAgent(db, 'https://agents.do/ralph', 'tool-code-execute', {
 *   permission: 'auto',
 *   addedBy: 'user-123',
 * })
 * ```
 */
export async function addToolToAgent(
  db: object,
  agentId: string,
  toolId: string,
  options?: { permission?: 'auto' | 'confirm' | 'deny'; addedBy?: string }
): Promise<void> {
  // Check if relationship already exists
  const existing = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HAS_TOOL })
  const alreadyHasTool = existing.some((rel) => rel.to === toolId)

  if (alreadyHasTool) {
    return // Already has this tool
  }

  await createRelationship(db, {
    verb: AGENT_VERBS.HAS_TOOL,
    from: agentId,
    to: toolId,
    data: {
      addedAt: Date.now(),
      permission: options?.permission ?? 'auto',
      ...(options?.addedBy && { addedBy: options.addedBy }),
    },
  })
}

/**
 * Remove a tool from an agent.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param toolId - Tool ID
 * @returns true if removed, false if not found
 */
export async function removeToolFromAgent(
  db: object,
  agentId: string,
  toolId: string
): Promise<boolean> {
  const relationships = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HAS_TOOL })
  const toRemove = relationships.find((rel) => rel.to === toolId)

  if (!toRemove) {
    return false
  }

  return deleteRelationship(db, toRemove.id)
}

/**
 * Get all tools an agent has access to.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @returns Array of tool IDs with relationship data
 */
export async function getAgentTools(
  db: object,
  agentId: string
): Promise<Array<{ toolId: string; permission: string; addedAt?: number }>> {
  const relationships = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HAS_TOOL })

  return relationships.map((rel) => ({
    toolId: rel.to,
    permission: (rel.data?.permission as string) ?? 'auto',
    addedAt: rel.data?.addedAt as number | undefined,
  }))
}

/**
 * Check if an agent has a specific tool.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param toolId - Tool ID
 * @returns true if agent has the tool
 */
export async function agentHasTool(db: object, agentId: string, toolId: string): Promise<boolean> {
  const relationships = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HAS_TOOL })
  return relationships.some((rel) => rel.to === toolId)
}

// ============================================================================
// MEMORY RELATIONSHIPS
// ============================================================================

/**
 * Link a memory to an agent (HAS_MEMORY relationship).
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param memoryId - Memory ID
 */
export async function linkMemoryToAgent(
  db: object,
  agentId: string,
  memoryId: string
): Promise<void> {
  // Check if relationship already exists
  const existing = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HAS_MEMORY })
  const alreadyLinked = existing.some((rel) => rel.to === memoryId)

  if (alreadyLinked) {
    return
  }

  await createRelationship(db, {
    verb: AGENT_VERBS.HAS_MEMORY,
    from: agentId,
    to: memoryId,
    data: { linkedAt: Date.now() },
  })
}

/**
 * Unlink a memory from an agent.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param memoryId - Memory ID
 * @returns true if unlinked, false if not found
 */
export async function unlinkMemoryFromAgent(
  db: object,
  agentId: string,
  memoryId: string
): Promise<boolean> {
  const relationships = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HAS_MEMORY })
  const toRemove = relationships.find((rel) => rel.to === memoryId)

  if (!toRemove) {
    return false
  }

  return deleteRelationship(db, toRemove.id)
}

// ============================================================================
// CONVERSATION RELATIONSHIPS
// ============================================================================

/**
 * Link a conversation to an agent (PARTICIPATES_IN relationship).
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param conversationId - Conversation ID
 * @param options - Optional relationship data
 */
export async function linkConversationToAgent(
  db: object,
  agentId: string,
  conversationId: string,
  options?: { role?: string; joinedAt?: number }
): Promise<void> {
  // Check if relationship already exists
  const existing = await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.PARTICIPATES_IN })
  const alreadyLinked = existing.some((rel) => rel.to === conversationId)

  if (alreadyLinked) {
    return
  }

  await createRelationship(db, {
    verb: AGENT_VERBS.PARTICIPATES_IN,
    from: agentId,
    to: conversationId,
    data: {
      joinedAt: options?.joinedAt ?? Date.now(),
      ...(options?.role && { role: options.role }),
    },
  })
}

/**
 * Get all participants in a conversation.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @returns Array of agent IDs with participation data
 */
export async function getConversationParticipants(
  db: object,
  conversationId: string
): Promise<Array<{ agentId: string; role?: string; joinedAt?: number }>> {
  const relationships = await queryRelationshipsTo(db, conversationId, {
    verb: AGENT_VERBS.PARTICIPATES_IN,
  })

  return relationships.map((rel) => ({
    agentId: rel.from,
    role: rel.data?.role as string | undefined,
    joinedAt: rel.data?.joinedAt as number | undefined,
  }))
}

// ============================================================================
// HANDOFF RELATIONSHIPS
// ============================================================================

/**
 * Record a handoff from one agent to another.
 *
 * @param db - Database instance
 * @param fromAgentId - Source agent ID
 * @param toAgentId - Target agent ID
 * @param options - Handoff metadata
 */
export async function recordHandoff(
  db: object,
  fromAgentId: string,
  toAgentId: string,
  options?: { reason?: string; conversationId?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await createRelationship(db, {
    verb: AGENT_VERBS.HANDED_OFF_TO,
    from: fromAgentId,
    to: toAgentId,
    data: {
      handoffAt: Date.now(),
      ...(options?.reason && { reason: options.reason }),
      ...(options?.conversationId && { conversationId: options.conversationId }),
      ...(options?.metadata && { metadata: options.metadata }),
    },
  })
}

/**
 * Get handoff history for an agent.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param direction - 'from' (handoffs this agent made) or 'to' (handoffs to this agent)
 * @returns Array of handoff records
 */
export async function getHandoffHistory(
  db: object,
  agentId: string,
  direction: 'from' | 'to' = 'from'
): Promise<
  Array<{
    fromAgentId: string
    toAgentId: string
    reason?: string
    conversationId?: string
    handoffAt?: number
  }>
> {
  const relationships =
    direction === 'from'
      ? await queryRelationshipsFrom(db, agentId, { verb: AGENT_VERBS.HANDED_OFF_TO })
      : await queryRelationshipsTo(db, agentId, { verb: AGENT_VERBS.HANDED_OFF_TO })

  return relationships.map((rel) => ({
    fromAgentId: rel.from,
    toAgentId: rel.to,
    reason: rel.data?.reason as string | undefined,
    conversationId: rel.data?.conversationId as string | undefined,
    handoffAt: rel.data?.handoffAt as number | undefined,
  }))
}

// ============================================================================
// SPAWN RELATIONSHIPS
// ============================================================================

/**
 * Record that an agent spawned a subagent.
 *
 * @param db - Database instance
 * @param parentAgentId - Parent agent ID
 * @param childAgentId - Spawned child agent ID
 * @param options - Spawn metadata
 */
export async function recordSpawn(
  db: object,
  parentAgentId: string,
  childAgentId: string,
  options?: { task?: string; conversationId?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await createRelationship(db, {
    verb: AGENT_VERBS.SPAWNED,
    from: parentAgentId,
    to: childAgentId,
    data: {
      spawnedAt: Date.now(),
      ...(options?.task && { task: options.task }),
      ...(options?.conversationId && { conversationId: options.conversationId }),
      ...(options?.metadata && { metadata: options.metadata }),
    },
  })
}

/**
 * Get all agents spawned by a parent agent.
 *
 * @param db - Database instance
 * @param parentAgentId - Parent agent ID
 * @returns Array of spawned agent records
 */
export async function getSpawnedAgents(
  db: object,
  parentAgentId: string
): Promise<Array<{ childAgentId: string; task?: string; spawnedAt?: number }>> {
  const relationships = await queryRelationshipsFrom(db, parentAgentId, {
    verb: AGENT_VERBS.SPAWNED,
  })

  return relationships.map((rel) => ({
    childAgentId: rel.to,
    task: rel.data?.task as string | undefined,
    spawnedAt: rel.data?.spawnedAt as number | undefined,
  }))
}

/**
 * Get the parent agent that spawned a child agent.
 *
 * @param db - Database instance
 * @param childAgentId - Child agent ID
 * @returns Parent agent ID or null if not spawned
 */
export async function getParentAgent(db: object, childAgentId: string): Promise<string | null> {
  const relationships = await queryRelationshipsTo(db, childAgentId, { verb: AGENT_VERBS.SPAWNED })

  if (relationships.length === 0) {
    return null
  }

  // Return the most recent parent (in case of multiple spawns)
  relationships.sort((a, b) => (b.data?.spawnedAt as number ?? 0) - (a.data?.spawnedAt as number ?? 0))
  return relationships[0]!.from
}
