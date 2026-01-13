/**
 * Memory Thing - Agent Memories as Graph Things
 *
 * Represents agent memories as Things in the graph model, enabling:
 * - Persistent memory storage across sessions
 * - Memory retrieval and search
 * - Memory relationships between agents and conversations
 *
 * Memory Types:
 * - conversation: Context from a specific conversation thread
 * - episodic: Specific events or interactions
 * - semantic: General knowledge learned over time
 * - procedural: How to perform tasks
 *
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 * @module db/graph/agents/memory
 */

import { createThing, getThing, getThingsByType, updateThing, deleteThing } from '../things'
import type { GraphThing } from '../things'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Memory type ID (conventional value for graph_things.typeId)
 */
export const MEMORY_TYPE_ID = 21

/**
 * Memory type name (for graph_things.typeName)
 */
export const MEMORY_TYPE_NAME = 'Memory'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of agent memory
 */
export type MemoryKind = 'conversation' | 'episodic' | 'semantic' | 'procedural'

/**
 * Memory Thing data structure
 */
export interface MemoryThingData {
  /** Agent ID that owns this memory */
  agentId: string
  /** Type of memory */
  kind: MemoryKind
  /** Memory content */
  content: string
  /** Optional context/source of the memory */
  context?: string
  /** Optional importance score (0-1) */
  importance?: number
  /** Optional embedding vector for semantic search */
  embedding?: number[]
  /** Optional tags for categorization */
  tags?: string[]
  /** Optional conversation ID if from a conversation */
  conversationId?: string
  /** Optional expiration timestamp */
  expiresAt?: number
  /** Last accessed timestamp */
  lastAccessedAt?: number
  /** Access count */
  accessCount?: number
  /** Index signature for GraphStore compatibility */
  [key: string]: unknown
}

/**
 * Input for creating a new Memory Thing
 */
export interface CreateMemoryInput {
  /** Optional custom ID */
  id?: string
  /** Agent ID that owns this memory */
  agentId: string
  /** Type of memory */
  kind: MemoryKind
  /** Memory content */
  content: string
  /** Optional context/source */
  context?: string
  /** Optional importance score (0-1) */
  importance?: number
  /** Optional embedding vector */
  embedding?: number[]
  /** Optional tags */
  tags?: string[]
  /** Optional conversation ID */
  conversationId?: string
  /** Optional expiration timestamp */
  expiresAt?: number
}

/**
 * Memory Thing - extends GraphThing with strongly-typed data
 */
export interface MemoryThing extends Omit<GraphThing, 'data'> {
  data: MemoryThingData
}

// ============================================================================
// MEMORY CRUD OPERATIONS
// ============================================================================

/**
 * Generate unique ID for a memory
 */
function generateMemoryId(agentId: string): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  // Extract agent name from URL if applicable
  const agentName = agentId.includes('/') ? agentId.split('/').pop() : agentId
  return `memory:${agentName}:${suffix}`
}

/**
 * Create a new Memory Thing.
 *
 * @param db - Database instance
 * @param input - Memory creation input
 * @returns The created Memory Thing
 *
 * @example
 * ```typescript
 * const memory = await createMemory(db, {
 *   agentId: 'https://agents.do/ralph',
 *   kind: 'episodic',
 *   content: 'User requested a TypeScript refactoring for the auth module.',
 *   importance: 0.8,
 *   tags: ['typescript', 'refactoring', 'auth'],
 * })
 * ```
 */
export async function createMemory(db: object, input: CreateMemoryInput): Promise<MemoryThing> {
  const memoryId = input.id ?? generateMemoryId(input.agentId)
  const now = Date.now()

  const memoryData: MemoryThingData = {
    agentId: input.agentId,
    kind: input.kind,
    content: input.content,
    ...(input.context && { context: input.context }),
    ...(input.importance !== undefined && { importance: input.importance }),
    ...(input.embedding && { embedding: input.embedding }),
    ...(input.tags && { tags: input.tags }),
    ...(input.conversationId && { conversationId: input.conversationId }),
    ...(input.expiresAt && { expiresAt: input.expiresAt }),
    lastAccessedAt: now,
    accessCount: 0,
  }

  const thing = await createThing(db, {
    id: memoryId,
    typeId: MEMORY_TYPE_ID,
    typeName: MEMORY_TYPE_NAME,
    data: memoryData,
  })

  return thing as MemoryThing
}

/**
 * Get a Memory Thing by ID.
 *
 * @param db - Database instance
 * @param memoryId - Memory ID
 * @param updateAccess - Whether to update lastAccessedAt and accessCount
 * @returns The Memory Thing or null if not found
 */
export async function getMemory(
  db: object,
  memoryId: string,
  updateAccess = true
): Promise<MemoryThing | null> {
  const thing = await getThing(db, memoryId)

  if (!thing || thing.typeName !== MEMORY_TYPE_NAME || thing.deletedAt !== null) {
    return null
  }

  // Update access metadata
  if (updateAccess) {
    const data = thing.data as MemoryThingData
    await updateThing(db, memoryId, {
      data: {
        ...data,
        lastAccessedAt: Date.now(),
        accessCount: (data.accessCount ?? 0) + 1,
      },
    })
  }

  return thing as MemoryThing
}

/**
 * Get all memories for an agent.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param options - Query options
 * @returns Array of Memory Things
 */
export async function getMemoriesByAgent(
  db: object,
  agentId: string,
  options?: { kind?: MemoryKind; limit?: number; includeExpired?: boolean }
): Promise<MemoryThing[]> {
  const allMemories = await getThingsByType(db, {
    typeName: MEMORY_TYPE_NAME,
    includeDeleted: false,
  })

  const now = Date.now()
  let memories = allMemories.filter((m) => {
    const data = m.data as MemoryThingData
    return data.agentId === agentId
  }) as MemoryThing[]

  // Filter by kind
  if (options?.kind) {
    memories = memories.filter((m) => m.data.kind === options.kind)
  }

  // Filter expired
  if (!options?.includeExpired) {
    memories = memories.filter((m) => !m.data.expiresAt || m.data.expiresAt > now)
  }

  // Sort by importance (descending) then by lastAccessedAt (descending)
  memories.sort((a, b) => {
    const importanceA = a.data.importance ?? 0.5
    const importanceB = b.data.importance ?? 0.5
    if (importanceB !== importanceA) {
      return importanceB - importanceA
    }
    return (b.data.lastAccessedAt ?? 0) - (a.data.lastAccessedAt ?? 0)
  })

  // Apply limit
  if (options?.limit) {
    memories = memories.slice(0, options.limit)
  }

  return memories
}

/**
 * Get memories by kind across all agents.
 *
 * @param db - Database instance
 * @param kind - Memory kind
 * @param options - Query options
 * @returns Array of Memory Things
 */
export async function getMemoriesByKind(
  db: object,
  kind: MemoryKind,
  options?: { limit?: number }
): Promise<MemoryThing[]> {
  const allMemories = await getThingsByType(db, {
    typeName: MEMORY_TYPE_NAME,
    includeDeleted: false,
  })

  let memories = allMemories.filter((m) => {
    const data = m.data as MemoryThingData
    return data.kind === kind
  }) as MemoryThing[]

  if (options?.limit) {
    memories = memories.slice(0, options.limit)
  }

  return memories
}

/**
 * Search memories by content or tags.
 *
 * @param db - Database instance
 * @param query - Search query (matches content or tags)
 * @param options - Search options
 * @returns Array of matching Memory Things
 */
export async function searchMemories(
  db: object,
  query: string,
  options?: { agentId?: string; kind?: MemoryKind; limit?: number }
): Promise<MemoryThing[]> {
  const allMemories = await getThingsByType(db, {
    typeName: MEMORY_TYPE_NAME,
    includeDeleted: false,
  })

  const queryLower = query.toLowerCase()

  let memories = allMemories.filter((m) => {
    const data = m.data as MemoryThingData

    // Apply filters
    if (options?.agentId && data.agentId !== options.agentId) {
      return false
    }
    if (options?.kind && data.kind !== options.kind) {
      return false
    }

    // Search in content
    if (data.content.toLowerCase().includes(queryLower)) {
      return true
    }

    // Search in tags
    if (data.tags?.some((tag) => tag.toLowerCase().includes(queryLower))) {
      return true
    }

    // Search in context
    if (data.context?.toLowerCase().includes(queryLower)) {
      return true
    }

    return false
  }) as MemoryThing[]

  if (options?.limit) {
    memories = memories.slice(0, options.limit)
  }

  return memories
}

/**
 * Update a Memory Thing.
 *
 * @param db - Database instance
 * @param memoryId - Memory ID
 * @param updates - Fields to update
 * @returns The updated Memory Thing or null if not found
 */
export async function updateMemory(
  db: object,
  memoryId: string,
  updates: Partial<Omit<MemoryThingData, 'agentId'>>
): Promise<MemoryThing | null> {
  const existing = await getThing(db, memoryId)
  if (!existing || existing.typeName !== MEMORY_TYPE_NAME) {
    return null
  }

  const existingData = existing.data as MemoryThingData
  const newData: MemoryThingData = {
    ...existingData,
    ...updates,
    // Ensure agentId cannot be changed
    agentId: existingData.agentId,
  }

  const updated = await updateThing(db, memoryId, { data: newData })
  return updated as MemoryThing | null
}

/**
 * Delete (soft-delete) a Memory Thing.
 *
 * @param db - Database instance
 * @param memoryId - Memory ID
 * @returns The deleted Memory Thing or null if not found
 */
export async function deleteMemory(db: object, memoryId: string): Promise<MemoryThing | null> {
  const deleted = await deleteThing(db, memoryId)
  return deleted as MemoryThing | null
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if data is MemoryThingData
 */
export function isMemoryThingData(data: unknown): data is MemoryThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.agentId === 'string' &&
    typeof d.kind === 'string' &&
    typeof d.content === 'string'
  )
}

/**
 * Type guard to check if a Thing is a Memory Thing
 */
export function isMemoryThing(thing: GraphThing): thing is MemoryThing {
  return thing.typeName === MEMORY_TYPE_NAME && isMemoryThingData(thing.data)
}
