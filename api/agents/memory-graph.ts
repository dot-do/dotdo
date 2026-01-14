/**
 * Memory as Relationships - Graph-backed Agent Memory
 *
 * Implements Agent memory storage using the DO Graph model with Things and Relationships.
 * Memory is stored as Things with 'remembers' relationships from Agent Things.
 *
 * @see dotdo-705mi - [GREEN] Memory as Relationships - Implementation
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 *
 * Design:
 * - Memory Things with type, content, and optional embedding
 * - Agent creates 'remembers' Relationships to Memory Things
 * - Memory types: short-term, long-term, episodic
 * - Helper functions for retrieval, search, and sharing
 *
 * @module agents/memory-graph
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../db/graph/types'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Memory type classification
 */
export type MemoryType = 'short-term' | 'long-term' | 'episodic'

/**
 * Memory importance level
 */
export type MemoryImportance = 'low' | 'medium' | 'high' | 'critical'

/**
 * Memory Thing data structure
 */
export interface MemoryThingData {
  /** Memory type classification */
  type: MemoryType
  /** Memory content (text) */
  content: string
  /** Optional embedding vector for semantic search */
  embedding?: number[]
  /** Memory importance/priority */
  importance?: MemoryImportance
  /** Source of memory (conversation, observation, inference) */
  source?: string
  /** Optional summary (for long-term memories) */
  summary?: string
  /** Related conversation ID */
  conversationId?: string
}

/**
 * Options for storing a memory
 */
export interface StoreMemoryOptions {
  /** Memory type classification */
  type?: MemoryType
  /** Memory importance level */
  importance?: MemoryImportance
  /** Pre-computed embedding vector */
  embedding?: number[]
  /** Source of the memory */
  source?: string
  /** Related conversation ID */
  conversationId?: string
}

/**
 * Memory returned by GraphBackedMemory
 */
export interface Memory {
  id: string
  type: MemoryType
  content: string
  importance?: MemoryImportance
  embedding?: number[]
  source?: string
  conversationId?: string
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// Constants
// ============================================================================

/** Type ID for Memory Things */
export const MEMORY_TYPE_ID = 200

/** Type name for Memory Things */
export const MEMORY_TYPE_NAME = 'Memory'

/** The 'remembers' verb for Agent-Memory relationships */
export const VERB_REMEMBERS = 'remembers'

/** The 'sharedWith' verb for Agent-Agent memory sharing */
export const VERB_SHARED_WITH = 'sharedWith'

// ============================================================================
// GraphBackedMemory Class
// ============================================================================

/**
 * Configuration for GraphBackedMemory
 */
export interface GraphBackedMemoryConfig {
  /** The graph store to use */
  store: GraphStore
  /** Agent Thing ID */
  agentId: string
}

/**
 * Graph-backed memory implementation using Things and Relationships.
 *
 * This class provides the interface expected by the tests:
 * - remember(content, options): Create memory and relationship
 * - getRecentMemories(limit): Retrieve via relationship traversal
 * - searchMemories(query, options): Search by text content
 *
 * @example
 * ```typescript
 * const graphMemory = new GraphBackedMemory({
 *   store,
 *   agentId: 'agent-ralph',
 * })
 *
 * const memory = await graphMemory.remember('User asked about billing', { type: 'short-term' })
 * const recent = await graphMemory.getRecentMemories(5)
 * ```
 */
export class GraphBackedMemory {
  private store: GraphStore
  private agentId: string

  constructor(config: GraphBackedMemoryConfig) {
    this.store = config.store
    this.agentId = config.agentId
  }

  /**
   * Store a memory and create a 'remembers' relationship from the agent
   */
  async remember(content: string, options?: StoreMemoryOptions): Promise<Memory> {
    const id = `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const type = options?.type ?? 'short-term'
    const now = Date.now()

    // Create Memory Thing
    const thing = await this.store.createThing({
      id,
      typeId: MEMORY_TYPE_ID,
      typeName: MEMORY_TYPE_NAME,
      data: {
        type,
        content,
        importance: options?.importance,
        embedding: options?.embedding,
        source: options?.source,
        conversationId: options?.conversationId,
      } satisfies MemoryThingData,
    })

    // Create 'remembers' relationship from Agent to Memory
    const relId = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await this.store.createRelationship({
      id: relId,
      verb: VERB_REMEMBERS,
      from: `do://agents/${this.agentId}`,
      to: `do://memories/${id}`,
    })

    return this.thingToMemory(thing)
  }

  /**
   * Get recent memories via relationship traversal
   */
  async getRecentMemories(limit: number = 10): Promise<Memory[]> {
    // Get all 'remembers' relationships from this agent
    const relationships = await this.store.queryRelationshipsFrom(
      `do://agents/${this.agentId}`,
      { verb: VERB_REMEMBERS }
    )

    // Also check for shared memories (from other agents)
    const sharedRels = await this.store.queryRelationshipsTo(
      `do://agents/${this.agentId}`,
      { verb: VERB_SHARED_WITH }
    )

    // Collect memory IDs from owned relationships
    const ownedMemoryIds = relationships.map((rel) => {
      // Extract memory ID from URL like "do://memories/memory-123"
      const parts = rel.to.split('/')
      return parts[parts.length - 1]
    })

    // Collect memory IDs from shared relationships (need to look up original memory)
    const sharedMemoryIds: string[] = []
    for (const rel of sharedRels) {
      const data = rel.data as { memoryId?: string } | null
      if (data?.memoryId) {
        sharedMemoryIds.push(data.memoryId)
      }
    }

    // Combine and deduplicate
    const allMemoryIds = [...new Set([...ownedMemoryIds, ...sharedMemoryIds])]

    // Fetch memory Things
    const memories: Memory[] = []
    for (const memoryId of allMemoryIds) {
      const thing = await this.store.getThing(memoryId)
      if (thing && thing.typeName === MEMORY_TYPE_NAME && !thing.deletedAt) {
        memories.push(this.thingToMemory(thing))
      }
    }

    // Sort by createdAt descending (most recent first)
    memories.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Limit results
    return memories.slice(0, limit)
  }

  /**
   * Search memories by text content
   */
  async searchMemories(query: string, options?: { type?: MemoryType; minSimilarity?: number }): Promise<Memory[]> {
    const lowerQuery = query.toLowerCase()

    // Get all memories for this agent
    const allMemories = await this.getRecentMemories(1000)

    // Filter by text content
    let filtered = allMemories.filter((memory) => {
      return memory.content.toLowerCase().includes(lowerQuery)
    })

    // Filter by type if specified
    if (options?.type) {
      filtered = filtered.filter((memory) => memory.type === options.type)
    }

    // TODO: Implement semantic similarity search using embeddings
    // For now, return text matches

    return filtered
  }

  /**
   * Convert a GraphThing to a Memory object
   */
  private thingToMemory(thing: GraphThing): Memory {
    const data = thing.data as MemoryThingData | null
    return {
      id: thing.id,
      type: data?.type ?? 'short-term',
      content: data?.content ?? '',
      importance: data?.importance,
      embedding: data?.embedding,
      source: data?.source,
      conversationId: data?.conversationId,
      createdAt: new Date(thing.createdAt),
      updatedAt: new Date(thing.updatedAt),
    }
  }
}

// ============================================================================
// Standalone Helper Functions
// ============================================================================

/**
 * Get recent memories for an agent via relationship traversal
 *
 * This is the standalone function used by the tests.
 */
export async function getRecentMemories(
  store: GraphStore,
  agentId: string,
  options: { limit?: number; type?: MemoryType } = {}
): Promise<GraphThing[]> {
  const limit = options.limit ?? 10

  // Get all 'remembers' relationships from this agent
  const relationships = await store.queryRelationshipsFrom(
    `do://agents/${agentId}`,
    { verb: VERB_REMEMBERS }
  )

  // Also check for shared memories (from other agents)
  const sharedRels = await store.queryRelationshipsTo(
    `do://agents/${agentId}`,
    { verb: VERB_SHARED_WITH }
  )

  // Sort relationships by createdAt descending (most recent first)
  // Use relationship timestamp for ordering since it captures when the memory was "remembered"
  const sortedRels = [...relationships].sort((a, b) => {
    const timeDiff = b.createdAt - a.createdAt
    if (timeDiff !== 0) return timeDiff
    // Secondary sort by ID for stability
    return b.id.localeCompare(a.id)
  })

  // Collect memory IDs in sorted order from owned relationships
  const ownedMemoryIds = sortedRels.map((rel) => {
    const parts = rel.to.split('/')
    return parts[parts.length - 1]
  })

  // Collect memory IDs from shared relationships
  const sharedMemoryIds: string[] = []
  for (const rel of sharedRels) {
    const data = rel.data as { memoryId?: string } | null
    if (data?.memoryId) {
      sharedMemoryIds.push(data.memoryId)
    }
  }

  // Track seen IDs and preserve order from sorted relationships
  const seen = new Set<string>()
  const orderedMemoryIds: string[] = []

  for (const id of ownedMemoryIds) {
    if (!seen.has(id)) {
      seen.add(id)
      orderedMemoryIds.push(id)
    }
  }

  for (const id of sharedMemoryIds) {
    if (!seen.has(id)) {
      seen.add(id)
      orderedMemoryIds.push(id)
    }
  }

  // Fetch memory Things in the relationship order
  const memories: GraphThing[] = []
  for (const memoryId of orderedMemoryIds) {
    const thing = await store.getThing(memoryId)
    if (thing && thing.typeName === MEMORY_TYPE_NAME && !thing.deletedAt) {
      // Filter by type if specified
      if (options.type) {
        const data = thing.data as MemoryThingData | null
        if (data?.type !== options.type) {
          continue
        }
      }
      memories.push(thing)
    }
  }

  // Limit results
  return memories.slice(0, limit)
}

/**
 * Search memories by text content
 */
export async function searchMemories(
  store: GraphStore,
  agentId: string,
  query: string,
  options: { type?: MemoryType; minSimilarity?: number } = {}
): Promise<GraphThing[]> {
  const lowerQuery = query.toLowerCase()

  // Get all memories for this agent (without type filter initially)
  const allMemories = await getRecentMemories(store, agentId, { limit: 1000 })

  // Filter by text content
  let filtered = allMemories.filter((thing) => {
    const data = thing.data as MemoryThingData | null
    const content = data?.content ?? ''
    return content.toLowerCase().includes(lowerQuery)
  })

  // Filter by type if specified
  if (options.type) {
    filtered = filtered.filter((thing) => {
      const data = thing.data as MemoryThingData | null
      return data?.type === options.type
    })
  }

  return filtered
}

/**
 * Share a memory from one agent to another
 */
export async function shareMemory(
  store: GraphStore,
  memoryId: string,
  fromAgentId: string,
  toAgentId: string
): Promise<GraphRelationship> {
  const relId = `rel-share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Create sharedWith relationship between agents
  // Include the memory ID in the relationship data
  const relationship = await store.createRelationship({
    id: relId,
    verb: VERB_SHARED_WITH,
    from: `do://agents/${fromAgentId}`,
    to: `do://agents/${toAgentId}`,
    data: {
      memoryId,
      sharedAt: Date.now(),
    },
  })

  // Also create a 'remembers' relationship from the receiving agent to the memory
  // This makes the shared memory appear in getRecentMemories for the receiver
  const rememberRelId = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await store.createRelationship({
    id: rememberRelId,
    verb: VERB_REMEMBERS,
    from: `do://agents/${toAgentId}`,
    to: `do://memories/${memoryId}`,
    data: {
      sharedFrom: fromAgentId,
    },
  })

  return relationship
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a graph-backed agent memory instance
 *
 * @example
 * ```typescript
 * const memory = createAgentMemory({
 *   store,
 *   agentId: 'agent-ralph',
 * })
 *
 * await memory.remember('Important fact', { type: 'long-term' })
 * ```
 */
export function createAgentMemory(config: GraphBackedMemoryConfig): GraphBackedMemory {
  return new GraphBackedMemory(config)
}

// ============================================================================
// Exports
// ============================================================================

export default {
  GraphBackedMemory,
  createAgentMemory,
  getRecentMemories,
  searchMemories,
  shareMemory,
  MEMORY_TYPE_ID,
  MEMORY_TYPE_NAME,
  VERB_REMEMBERS,
  VERB_SHARED_WITH,
}
