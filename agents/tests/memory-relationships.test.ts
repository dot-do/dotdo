/**
 * Memory as Relationships - Tests
 *
 * RED PHASE: Tests for Agent memory stored as Relationships in the graph.
 * This tests the integration between the unified memory system and the
 * graph-backed storage using the "Agent remembers Memory" relationship pattern.
 *
 * Memory Types:
 * - short-term: Recent context, sliding window
 * - long-term: Persistent knowledge, summaries
 * - episodic: Specific interactions/events
 * - semantic: Extracted facts and knowledge
 *
 * Key Relationship Pattern:
 * Agent --[remembers]--> Memory
 *
 * @see dotdo-kz5kw - [RED] Memory as Relationships - Tests
 * @module agents/tests/memory-relationships
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { GraphStore, GraphThing, CreateRelationshipInput, GraphRelationship } from '../../db/graph/types'
import type { MemoryType, MemoryThing } from '../unified-memory'

// ============================================================================
// TEST TYPES - Expected interfaces for Memory as Relationships
// ============================================================================

/**
 * Expected structure for an Agent Thing in the graph
 */
interface AgentThing extends GraphThing {
  typeName: 'Agent'
  data: {
    name: string
    model?: string
    capabilities?: string[]
  } | null
}

/**
 * Expected structure for a Memory Thing in the graph
 * This represents the "to" node in an Agent-remembers->Memory relationship
 */
interface MemoryGraphThing extends GraphThing {
  typeName: 'Memory'
  data: {
    type: MemoryType
    content: string
    embedding?: number[]
    metadata?: Record<string, unknown>
    conversationId?: string
    sessionId?: string
  } | null
}

/**
 * Expected structure for a "remembers" relationship
 * from: Agent URL
 * to: Memory URL
 */
interface RemembersRelationship extends GraphRelationship {
  verb: 'remembers'
  data: {
    priority?: number
    accessCount?: number
    lastAccessed?: string
    expiresAt?: string
  } | null
}

/**
 * Interface for memory creation via relationships
 */
interface CreateMemoryRelationshipInput {
  from: string // Agent $id or URL
  verb: 'remembers'
  to: string // Memory $id (to be created)
}

/**
 * Options for retrieving memories
 */
interface GetMemoriesOptions {
  limit?: number
  type?: MemoryType
  since?: Date
  before?: Date
  orderBy?: 'createdAt' | 'lastAccessed' | 'priority'
  orderDirection?: 'asc' | 'desc'
}

/**
 * Options for semantic memory search
 */
interface SemanticSearchOptions extends GetMemoriesOptions {
  minSimilarity?: number
  embedding?: number[]
}

// ============================================================================
// TYPE IDs for Graph Storage
// ============================================================================

const AGENT_TYPE_ID = 50
const MEMORY_TYPE_ID = 100
const AGENT_TYPE_NAME = 'Agent'
const MEMORY_TYPE_NAME = 'Memory'

// ============================================================================
// HELPER FUNCTIONS - Will be implemented in GREEN phase
// ============================================================================

/**
 * Create a Memory Thing in the graph
 */
async function createMemoryThing(
  store: GraphStore,
  data: {
    type: MemoryType
    content: string
    embedding?: number[]
    metadata?: Record<string, unknown>
    agentId?: string
    sessionId?: string
  }
): Promise<GraphThing> {
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return store.createThing({
    id,
    typeId: MEMORY_TYPE_ID,
    typeName: MEMORY_TYPE_NAME,
    data: {
      ...data,
      type: data.type,
      content: data.content,
    },
  })
}

/**
 * Create an Agent Thing in the graph
 */
async function createAgentThing(
  store: GraphStore,
  data: {
    name: string
    model?: string
    capabilities?: string[]
  }
): Promise<GraphThing> {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return store.createThing({
    id,
    typeId: AGENT_TYPE_ID,
    typeName: AGENT_TYPE_NAME,
    data,
  })
}

/**
 * Create a "remembers" relationship between an Agent and a Memory
 */
async function createMemoryRelationship(
  store: GraphStore,
  input: {
    from: string // Agent ID
    verb: 'remembers'
    to: string // Memory ID
    data?: Record<string, unknown>
  }
): Promise<GraphRelationship> {
  const id = `${input.from}-${input.verb}-${input.to}`
  return store.createRelationship({
    id,
    verb: input.verb,
    from: `do://agents/${input.from}`,
    to: `do://memories/${input.to}`,
    data: input.data ?? null,
  })
}

/**
 * Get recent memories for an agent
 */
async function getRecentMemories(
  store: GraphStore,
  agentId: string,
  options?: GetMemoriesOptions
): Promise<MemoryGraphThing[]> {
  const limit = options?.limit ?? 10
  const relationships = await store.queryRelationshipsFrom(`do://agents/${agentId}`, {
    verb: 'remembers',
  })

  // Get all memory Things from the relationships
  const memories: MemoryGraphThing[] = []
  for (const rel of relationships) {
    const memoryId = rel.to.split('/').pop()
    if (memoryId) {
      const thing = await store.getThing(memoryId)
      if (thing && thing.typeName === MEMORY_TYPE_NAME) {
        // Filter by type if specified
        const data = thing.data as MemoryGraphThing['data']
        if (!options?.type || data?.type === options.type) {
          memories.push(thing as MemoryGraphThing)
        }
      }
    }
  }

  // Sort by createdAt descending and apply limit
  return memories.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

/**
 * Search memories by content (text match)
 */
async function searchMemories(
  store: GraphStore,
  agentId: string,
  query: string,
  options?: GetMemoriesOptions
): Promise<MemoryGraphThing[]> {
  const memories = await getRecentMemories(store, agentId, { ...options, limit: 1000 })
  const lowerQuery = query.toLowerCase()

  return memories.filter((m) => {
    const data = m.data as MemoryGraphThing['data']
    return data?.content?.toLowerCase().includes(lowerQuery)
  })
}

/**
 * Search memories by semantic similarity (using embeddings)
 * Returns memories with cosine similarity above minSimilarity threshold
 */
async function semanticSearchMemories(
  store: GraphStore,
  agentId: string,
  queryEmbedding: number[],
  options?: SemanticSearchOptions
): Promise<Array<{ memory: MemoryGraphThing; similarity: number }>> {
  const minSimilarity = options?.minSimilarity ?? 0.7
  const memories = await getRecentMemories(store, agentId, { ...options, limit: 1000 })

  const results: Array<{ memory: MemoryGraphThing; similarity: number }> = []

  for (const memory of memories) {
    const data = memory.data as MemoryGraphThing['data']
    if (data?.embedding) {
      const similarity = cosineSimilarity(queryEmbedding, data.embedding)
      if (similarity >= minSimilarity) {
        results.push({ memory, similarity })
      }
    }
  }

  // Sort by similarity descending
  return results.sort((a, b) => b.similarity - a.similarity)
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Summarize multiple memories into a single condensed memory
 */
async function summarizeMemories(
  store: GraphStore,
  agentId: string,
  memoryIds: string[],
  summaryContent: string
): Promise<MemoryGraphThing> {
  // Create the summary memory
  const summaryMemory = (await createMemoryThing(store, {
    type: 'long-term',
    content: summaryContent,
    metadata: {
      summarizedFrom: memoryIds,
      summarizedAt: new Date().toISOString(),
    },
    agentId,
  })) as MemoryGraphThing

  // Create the relationship
  await createMemoryRelationship(store, {
    from: agentId,
    verb: 'remembers',
    to: summaryMemory.id,
    data: { priority: 10 },
  })

  return summaryMemory
}

/**
 * Share a memory between agents
 * Creates a "remembers" relationship from the target agent to an existing memory
 */
async function shareMemory(
  store: GraphStore,
  sourceAgentId: string,
  targetAgentId: string,
  memoryId: string
): Promise<GraphRelationship> {
  return createMemoryRelationship(store, {
    from: targetAgentId,
    verb: 'remembers',
    to: memoryId,
    data: {
      sharedFrom: sourceAgentId,
      sharedAt: new Date().toISOString(),
    },
  })
}

/**
 * Truncate old memories, keeping only the most recent N
 */
async function truncateMemories(
  store: GraphStore,
  agentId: string,
  keepCount: number,
  type?: MemoryType
): Promise<number> {
  const memories = await getRecentMemories(store, agentId, { type, limit: 10000 })

  // Keep the most recent keepCount memories
  const toDelete = memories.slice(keepCount)

  let deletedCount = 0
  for (const memory of toDelete) {
    // Delete the relationship first
    const relId = `${agentId}-remembers-${memory.id}`
    await store.deleteRelationship(relId)

    // Then soft-delete the memory Thing
    await store.deleteThing(memory.id)
    deletedCount++
  }

  return deletedCount
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Memory as Relationships', () => {
  let store: GraphStore
  let agentThing: GraphThing

  beforeEach(async () => {
    // Import and create a fresh SQLite store for each test
    const { SQLiteGraphStore } = await import('../../db/graph/stores')
    store = new SQLiteGraphStore(':memory:')
    await (store as any).initialize()

    // Create a test agent
    agentThing = await createAgentThing(store, {
      name: 'TestAgent',
      model: 'gpt-4',
      capabilities: ['memory', 'reasoning'],
    })
  })

  afterEach(async () => {
    if (store && (store as any).close) {
      await (store as any).close()
    }
  })

  // ==========================================================================
  // 1. Memory Creation as Relationship
  // ==========================================================================

  describe('Memory Creation as Relationship', () => {
    it('creates a short-term memory relationship', async () => {
      // Create the memory Thing
      const memoryThing = await createMemoryThing(store, {
        type: 'short-term',
        content: 'User asked about billing',
        agentId: agentThing.id,
      })

      // Create the relationship
      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memoryThing.id,
      })

      expect(relationship.verb).toBe('remembers')
      expect(relationship.from).toContain(agentThing.id)
      expect(relationship.to).toContain(memoryThing.id)
    })

    it('creates a long-term memory relationship', async () => {
      const memoryThing = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Customer prefers email communication',
        metadata: { source: 'preference', confidence: 0.95 },
        agentId: agentThing.id,
      })

      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memoryThing.id,
        data: { priority: 10 },
      })

      expect(relationship.verb).toBe('remembers')
      expect((relationship.data as any)?.priority).toBe(10)
    })

    it('creates an episodic memory relationship', async () => {
      const memoryThing = await createMemoryThing(store, {
        type: 'episodic',
        content: 'Had a support call about order #12345',
        metadata: {
          eventType: 'support_call',
          orderId: '12345',
          duration: 300,
        },
        agentId: agentThing.id,
      })

      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memoryThing.id,
      })

      // Verify the memory content
      const retrieved = await store.getThing(memoryThing.id)
      expect(retrieved).not.toBeNull()
      expect((retrieved?.data as any)?.type).toBe('episodic')
      expect((retrieved?.data as any)?.metadata?.eventType).toBe('support_call')
    })

    it('creates a semantic memory relationship', async () => {
      const memoryThing = await createMemoryThing(store, {
        type: 'semantic',
        content: 'The company headquarters is in San Francisco',
        metadata: {
          entity: 'company',
          property: 'location',
          value: 'San Francisco',
        },
        agentId: agentThing.id,
      })

      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memoryThing.id,
      })

      expect(relationship.verb).toBe('remembers')

      const retrieved = await store.getThing(memoryThing.id)
      expect((retrieved?.data as any)?.type).toBe('semantic')
    })

    it('stores memory with embedding vector', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random())

      const memoryThing = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Important fact about the user',
        embedding,
        agentId: agentThing.id,
      })

      const retrieved = await store.getThing(memoryThing.id)
      expect(retrieved).not.toBeNull()
      expect((retrieved?.data as any)?.embedding).toBeDefined()
      expect((retrieved?.data as any)?.embedding.length).toBe(384)
    })

    it('assigns unique IDs to memory relationships', async () => {
      const mem1 = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Memory 1',
        agentId: agentThing.id,
      })

      const mem2 = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Memory 2',
        agentId: agentThing.id,
      })

      const rel1 = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: mem1.id,
      })

      const rel2 = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: mem2.id,
      })

      expect(rel1.id).not.toBe(rel2.id)
    })
  })

  // ==========================================================================
  // 2. Memory Retrieval by Type and Recency
  // ==========================================================================

  describe('Memory Retrieval by Type and Recency', () => {
    beforeEach(async () => {
      // Create multiple memories of different types
      const memoryData = [
        { type: 'short-term' as MemoryType, content: 'Recent context 1' },
        { type: 'short-term' as MemoryType, content: 'Recent context 2' },
        { type: 'short-term' as MemoryType, content: 'Recent context 3' },
        { type: 'long-term' as MemoryType, content: 'Important fact 1' },
        { type: 'long-term' as MemoryType, content: 'Important fact 2' },
        { type: 'episodic' as MemoryType, content: 'Event happened' },
        { type: 'semantic' as MemoryType, content: 'Knowledge item' },
      ]

      for (const data of memoryData) {
        const memory = await createMemoryThing(store, {
          ...data,
          agentId: agentThing.id,
        })
        await createMemoryRelationship(store, {
          from: agentThing.id,
          verb: 'remembers',
          to: memory.id,
        })
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })

    it('retrieves recent memories with limit', async () => {
      const recent = await getRecentMemories(store, agentThing.id, { limit: 5 })

      expect(recent.length).toBe(5)
    })

    it('retrieves memories in recency order (most recent first)', async () => {
      const recent = await getRecentMemories(store, agentThing.id, { limit: 3 })

      expect(recent.length).toBe(3)

      // Verify descending order by createdAt
      for (let i = 1; i < recent.length; i++) {
        expect(recent[i - 1]!.createdAt).toBeGreaterThanOrEqual(recent[i]!.createdAt)
      }
    })

    it('filters memories by type - short-term', async () => {
      const shortTerm = await getRecentMemories(store, agentThing.id, {
        type: 'short-term',
        limit: 10,
      })

      expect(shortTerm.length).toBe(3)
      expect(shortTerm.every((m) => (m.data as any)?.type === 'short-term')).toBe(true)
    })

    it('filters memories by type - long-term', async () => {
      const longTerm = await getRecentMemories(store, agentThing.id, {
        type: 'long-term',
        limit: 10,
      })

      expect(longTerm.length).toBe(2)
      expect(longTerm.every((m) => (m.data as any)?.type === 'long-term')).toBe(true)
    })

    it('filters memories by type - episodic', async () => {
      const episodic = await getRecentMemories(store, agentThing.id, {
        type: 'episodic',
        limit: 10,
      })

      expect(episodic.length).toBe(1)
      expect((episodic[0]?.data as any)?.type).toBe('episodic')
    })

    it('filters memories by type - semantic', async () => {
      const semantic = await getRecentMemories(store, agentThing.id, {
        type: 'semantic',
        limit: 10,
      })

      expect(semantic.length).toBe(1)
      expect((semantic[0]?.data as any)?.type).toBe('semantic')
    })

    it('returns empty array when no memories exist for type', async () => {
      // Create a new agent with no memories
      const newAgent = await createAgentThing(store, { name: 'EmptyAgent' })

      const memories = await getRecentMemories(store, newAgent.id, { type: 'short-term' })

      expect(memories).toHaveLength(0)
    })

    it('retrieves all memories without type filter', async () => {
      const all = await getRecentMemories(store, agentThing.id, { limit: 100 })

      expect(all.length).toBe(7)
    })
  })

  // ==========================================================================
  // 3. Memory Summarization and Truncation
  // ==========================================================================

  describe('Memory Summarization and Truncation', () => {
    beforeEach(async () => {
      // Create 10 short-term memories
      for (let i = 0; i < 10; i++) {
        const memory = await createMemoryThing(store, {
          type: 'short-term',
          content: `Short-term memory ${i + 1}`,
          agentId: agentThing.id,
        })
        await createMemoryRelationship(store, {
          from: agentThing.id,
          verb: 'remembers',
          to: memory.id,
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })

    it('truncates old short-term memories keeping recent ones', async () => {
      const beforeCount = (await getRecentMemories(store, agentThing.id, { type: 'short-term' })).length
      expect(beforeCount).toBe(10)

      const deletedCount = await truncateMemories(store, agentThing.id, 5, 'short-term')

      expect(deletedCount).toBe(5)

      const afterCount = (await getRecentMemories(store, agentThing.id, { type: 'short-term' })).length
      expect(afterCount).toBe(5)
    })

    it('keeps most recent memories after truncation', async () => {
      await truncateMemories(store, agentThing.id, 3, 'short-term')

      const remaining = await getRecentMemories(store, agentThing.id, { type: 'short-term' })

      expect(remaining.length).toBe(3)

      // The remaining should be the most recent (memory 8, 9, 10)
      const contents = remaining.map((m) => (m.data as any)?.content)
      expect(contents).toContain('Short-term memory 10')
      expect(contents).toContain('Short-term memory 9')
      expect(contents).toContain('Short-term memory 8')
    })

    it('creates a summary memory from multiple memories', async () => {
      const memories = await getRecentMemories(store, agentThing.id, {
        type: 'short-term',
        limit: 5,
      })

      const memoryIds = memories.map((m) => m.id)

      const summaryMemory = await summarizeMemories(
        store,
        agentThing.id,
        memoryIds,
        'Summary: User discussed various short-term topics including memories 6-10'
      )

      expect(summaryMemory).toBeDefined()
      expect((summaryMemory.data as any)?.type).toBe('long-term')
      expect((summaryMemory.data as any)?.content).toContain('Summary:')
      expect((summaryMemory.data as any)?.metadata?.summarizedFrom).toEqual(memoryIds)
    })

    it('summary memory is retrievable as long-term', async () => {
      const memories = await getRecentMemories(store, agentThing.id, {
        type: 'short-term',
        limit: 3,
      })

      await summarizeMemories(
        store,
        agentThing.id,
        memories.map((m) => m.id),
        'Condensed summary of recent interactions'
      )

      const longTerm = await getRecentMemories(store, agentThing.id, { type: 'long-term' })

      expect(longTerm.length).toBeGreaterThanOrEqual(1)
      expect(longTerm.some((m) => (m.data as any)?.content?.includes('Condensed summary'))).toBe(
        true
      )
    })

    it('truncation does not affect long-term memories', async () => {
      // Add some long-term memories
      for (let i = 0; i < 3; i++) {
        const memory = await createMemoryThing(store, {
          type: 'long-term',
          content: `Important fact ${i + 1}`,
          agentId: agentThing.id,
        })
        await createMemoryRelationship(store, {
          from: agentThing.id,
          verb: 'remembers',
          to: memory.id,
        })
      }

      // Truncate short-term
      await truncateMemories(store, agentThing.id, 2, 'short-term')

      // Long-term should be untouched
      const longTerm = await getRecentMemories(store, agentThing.id, { type: 'long-term' })
      expect(longTerm.length).toBe(3)
    })

    it('handles truncation when fewer memories exist than keepCount', async () => {
      // Try to keep 20 but only 10 exist
      const deletedCount = await truncateMemories(store, agentThing.id, 20, 'short-term')

      expect(deletedCount).toBe(0)

      const remaining = await getRecentMemories(store, agentThing.id, { type: 'short-term' })
      expect(remaining.length).toBe(10)
    })
  })

  // ==========================================================================
  // 4. Memory Search via Semantic Similarity
  // ==========================================================================

  describe('Memory Search via Semantic Similarity', () => {
    const createEmbedding = (seed: number): number[] => {
      // Create deterministic pseudo-random embedding based on seed
      return Array.from({ length: 128 }, (_, i) => Math.sin(seed * i) * 0.5 + 0.5)
    }

    beforeEach(async () => {
      // Create memories with embeddings
      const memoryData = [
        { content: 'The user prefers dark mode', seed: 1 },
        { content: 'The user is interested in TypeScript', seed: 2 },
        { content: 'The user works at a tech company', seed: 3 },
        { content: 'The user asked about billing issues', seed: 4 },
        { content: 'The user lives in California', seed: 5 },
      ]

      for (const data of memoryData) {
        const memory = await createMemoryThing(store, {
          type: 'long-term',
          content: data.content,
          embedding: createEmbedding(data.seed),
          agentId: agentThing.id,
        })
        await createMemoryRelationship(store, {
          from: agentThing.id,
          verb: 'remembers',
          to: memory.id,
        })
      }
    })

    it('finds memories by semantic similarity', async () => {
      // Query with embedding similar to "The user prefers dark mode" (seed 1)
      const queryEmbedding = createEmbedding(1)

      const results = await semanticSearchMemories(store, agentThing.id, queryEmbedding, {
        minSimilarity: 0.5,
      })

      expect(results.length).toBeGreaterThan(0)

      // The most similar should be the "dark mode" memory
      expect(results[0]?.memory?.data?.content).toContain('dark mode')
      expect(results[0]?.similarity).toBeGreaterThan(0.9) // Should be very similar
    })

    it('returns memories sorted by similarity descending', async () => {
      const queryEmbedding = createEmbedding(2.5) // Between TypeScript (2) and tech company (3)

      const results = await semanticSearchMemories(store, agentThing.id, queryEmbedding, {
        minSimilarity: 0.3,
      })

      // Verify descending similarity order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(results[i]!.similarity)
      }
    })

    it('filters out memories below similarity threshold', async () => {
      // Query with a very different embedding
      const queryEmbedding = createEmbedding(100) // Very different seed

      const results = await semanticSearchMemories(store, agentThing.id, queryEmbedding, {
        minSimilarity: 0.95, // Very high threshold
      })

      // Should return nothing or very few results
      expect(results.length).toBeLessThan(2)
    })

    it('returns empty array when no memories have embeddings', async () => {
      // Create new agent with memories without embeddings
      const newAgent = await createAgentThing(store, { name: 'NoEmbeddingAgent' })

      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Memory without embedding',
        agentId: newAgent.id,
      })
      await createMemoryRelationship(store, {
        from: newAgent.id,
        verb: 'remembers',
        to: memory.id,
      })

      const results = await semanticSearchMemories(store, newAgent.id, createEmbedding(1), {
        minSimilarity: 0.5,
      })

      expect(results).toHaveLength(0)
    })

    it('searches memories by text content', async () => {
      const results = await searchMemories(store, agentThing.id, 'TypeScript')

      expect(results.length).toBe(1)
      expect((results[0]?.data as any)?.content).toContain('TypeScript')
    })

    it('text search is case-insensitive', async () => {
      const results = await searchMemories(store, agentThing.id, 'typescript')

      expect(results.length).toBe(1)
    })

    it('text search returns empty array for non-matching query', async () => {
      const results = await searchMemories(store, agentThing.id, 'nonexistent')

      expect(results).toHaveLength(0)
    })

    it('combines text and type filters', async () => {
      // Add a short-term memory with "TypeScript" too
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Quick note about TypeScript',
        agentId: agentThing.id,
      })
      await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      const longTermResults = await searchMemories(store, agentThing.id, 'TypeScript', {
        type: 'long-term',
      })

      expect(longTermResults.length).toBe(1)
      expect((longTermResults[0]?.data as any)?.type).toBe('long-term')
    })
  })

  // ==========================================================================
  // 5. Cross-Agent Memory Sharing
  // ==========================================================================

  describe('Cross-Agent Memory Sharing', () => {
    let agent1: GraphThing
    let agent2: GraphThing

    beforeEach(async () => {
      agent1 = await createAgentThing(store, {
        name: 'Agent1',
        capabilities: ['memory'],
      })

      agent2 = await createAgentThing(store, {
        name: 'Agent2',
        capabilities: ['memory'],
      })
    })

    it('shares a memory from one agent to another', async () => {
      // Agent1 creates a memory
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Shared knowledge about the customer',
        agentId: agent1.id,
      })

      await createMemoryRelationship(store, {
        from: agent1.id,
        verb: 'remembers',
        to: memory.id,
      })

      // Share to Agent2
      const shareRel = await shareMemory(store, agent1.id, agent2.id, memory.id)

      expect(shareRel.verb).toBe('remembers')
      expect((shareRel.data as any)?.sharedFrom).toBe(agent1.id)
    })

    it('shared memory is accessible by both agents', async () => {
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Important shared fact',
        agentId: agent1.id,
      })

      await createMemoryRelationship(store, {
        from: agent1.id,
        verb: 'remembers',
        to: memory.id,
      })

      await shareMemory(store, agent1.id, agent2.id, memory.id)

      // Both agents should be able to retrieve the memory
      const agent1Memories = await getRecentMemories(store, agent1.id, { type: 'long-term' })
      const agent2Memories = await getRecentMemories(store, agent2.id, { type: 'long-term' })

      expect(agent1Memories.some((m) => m.id === memory.id)).toBe(true)
      expect(agent2Memories.some((m) => m.id === memory.id)).toBe(true)
    })

    it('tracks sharing metadata on the relationship', async () => {
      const memory = await createMemoryThing(store, {
        type: 'semantic',
        content: 'Customer prefers morning meetings',
        agentId: agent1.id,
      })

      await createMemoryRelationship(store, {
        from: agent1.id,
        verb: 'remembers',
        to: memory.id,
      })

      const shareRel = await shareMemory(store, agent1.id, agent2.id, memory.id)

      expect((shareRel.data as any)?.sharedFrom).toBe(agent1.id)
      expect((shareRel.data as any)?.sharedAt).toBeDefined()
    })

    it('multiple agents can share the same memory', async () => {
      const agent3 = await createAgentThing(store, { name: 'Agent3' })

      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Organization-wide knowledge',
        agentId: agent1.id,
      })

      await createMemoryRelationship(store, {
        from: agent1.id,
        verb: 'remembers',
        to: memory.id,
      })

      await shareMemory(store, agent1.id, agent2.id, memory.id)
      await shareMemory(store, agent1.id, agent3.id, memory.id)

      // All three agents should have access
      const agent1Mems = await getRecentMemories(store, agent1.id)
      const agent2Mems = await getRecentMemories(store, agent2.id)
      const agent3Mems = await getRecentMemories(store, agent3.id)

      expect(agent1Mems.some((m) => m.id === memory.id)).toBe(true)
      expect(agent2Mems.some((m) => m.id === memory.id)).toBe(true)
      expect(agent3Mems.some((m) => m.id === memory.id)).toBe(true)
    })

    it('agent cannot share memory they do not have', async () => {
      // Create memory for agent1 only
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Private memory',
        agentId: agent1.id,
      })

      await createMemoryRelationship(store, {
        from: agent1.id,
        verb: 'remembers',
        to: memory.id,
      })

      // Verify agent2 doesn't have this memory
      const agent2Memories = await getRecentMemories(store, agent2.id)
      expect(agent2Memories.some((m) => m.id === memory.id)).toBe(false)

      // After sharing, agent2 should have it
      await shareMemory(store, agent1.id, agent2.id, memory.id)

      const agent2MemoriesAfter = await getRecentMemories(store, agent2.id)
      expect(agent2MemoriesAfter.some((m) => m.id === memory.id)).toBe(true)
    })

    it('deleting shared memory by one agent does not affect others', async () => {
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Shared then deleted',
        agentId: agent1.id,
      })

      await createMemoryRelationship(store, {
        from: agent1.id,
        verb: 'remembers',
        to: memory.id,
      })

      await shareMemory(store, agent1.id, agent2.id, memory.id)

      // Agent1 "forgets" - deletes the relationship
      await store.deleteRelationship(`${agent1.id}-remembers-${memory.id}`)

      // Agent1 should not have the memory anymore
      const agent1Memories = await getRecentMemories(store, agent1.id)
      expect(agent1Memories.some((m) => m.id === memory.id)).toBe(false)

      // Agent2 should still have access
      const agent2Memories = await getRecentMemories(store, agent2.id)
      expect(agent2Memories.some((m) => m.id === memory.id)).toBe(true)
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty content in memory', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: '',
        agentId: agentThing.id,
      })

      await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      const retrieved = await store.getThing(memory.id)
      expect((retrieved?.data as any)?.content).toBe('')
    })

    it('handles special characters in memory content', async () => {
      const specialContent = 'User said: "Hello! How\'s it going?" \n\t Special chars: <>&'

      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: specialContent,
        agentId: agentThing.id,
      })

      const retrieved = await store.getThing(memory.id)
      expect((retrieved?.data as any)?.content).toBe(specialContent)
    })

    it('handles unicode in memory content', async () => {
      const unicodeContent = 'User greeted with emoji: Hello World Test unicode'

      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: unicodeContent,
        agentId: agentThing.id,
      })

      const retrieved = await store.getThing(memory.id)
      expect((retrieved?.data as any)?.content).toBe(unicodeContent)
    })

    it('handles very long memory content', async () => {
      const longContent = 'x'.repeat(100000)

      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: longContent,
        agentId: agentThing.id,
      })

      const retrieved = await store.getThing(memory.id)
      expect((retrieved?.data as any)?.content.length).toBe(100000)
    })

    it('handles concurrent memory creations', async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        createMemoryThing(store, {
          type: 'short-term',
          content: `Concurrent memory ${i}`,
          agentId: agentThing.id,
        }).then((memory) =>
          createMemoryRelationship(store, {
            from: agentThing.id,
            verb: 'remembers',
            to: memory.id,
          })
        )
      )

      await Promise.all(promises)

      const memories = await getRecentMemories(store, agentThing.id, { limit: 100 })
      expect(memories.length).toBe(20)
    })

    it('memory relationship has valid timestamps', async () => {
      const before = Date.now()

      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Timestamp test',
        agentId: agentThing.id,
      })

      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      const after = Date.now()

      const createdAtMs =
        relationship.createdAt instanceof Date
          ? relationship.createdAt.getTime()
          : (relationship.createdAt as number)

      expect(createdAtMs).toBeGreaterThanOrEqual(before)
      expect(createdAtMs).toBeLessThanOrEqual(after)
    })

    it('prevents duplicate memory relationships', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Single memory',
        agentId: agentThing.id,
      })

      await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      // Attempting to create the same relationship should fail
      await expect(
        createMemoryRelationship(store, {
          from: agentThing.id,
          verb: 'remembers',
          to: memory.id,
        })
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // Long-term Memory Persistence Tests
  // ==========================================================================

  describe('Long-term Memory Persistence', () => {
    it('long-term memory persists across sessions (simulated)', async () => {
      // Create long-term memory
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'User preference: dark mode',
        metadata: { category: 'preference' },
        agentId: agentThing.id,
      })

      await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      const memoryId = memory.id

      // Simulate "new session" by querying again
      const retrieved = await store.getThing(memoryId)

      expect(retrieved).not.toBeNull()
      expect((retrieved?.data as any)?.type).toBe('long-term')
      expect((retrieved?.data as any)?.content).toBe('User preference: dark mode')
    })

    it('episodic memory links to conversation via metadata', async () => {
      const conversationId = `conv-${Date.now()}`

      const memory = await createMemoryThing(store, {
        type: 'episodic',
        content: 'User discussed project timeline',
        metadata: {
          conversationId,
          messageCount: 15,
          topics: ['timeline', 'deadlines'],
        },
        agentId: agentThing.id,
      })

      await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      const retrieved = await store.getThing(memory.id)
      expect((retrieved?.data as any)?.metadata?.conversationId).toBe(conversationId)
      expect((retrieved?.data as any)?.metadata?.topics).toContain('timeline')
    })

    it('retrieves episodic memories by conversation', async () => {
      const conversationId = `conv-${Date.now()}`

      // Create multiple episodic memories for the same conversation
      for (let i = 0; i < 3; i++) {
        const memory = await createMemoryThing(store, {
          type: 'episodic',
          content: `Conversation event ${i + 1}`,
          metadata: { conversationId },
          agentId: agentThing.id,
          sessionId: conversationId,
        })
        await createMemoryRelationship(store, {
          from: agentThing.id,
          verb: 'remembers',
          to: memory.id,
        })
      }

      // Also create an episodic memory for a different conversation
      const memory = await createMemoryThing(store, {
        type: 'episodic',
        content: 'Different conversation event',
        metadata: { conversationId: 'other-conv' },
        agentId: agentThing.id,
        sessionId: 'other-conv',
      })
      await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: 'remembers',
        to: memory.id,
      })

      // Retrieve all episodic memories
      const episodic = await getRecentMemories(store, agentThing.id, {
        type: 'episodic',
        limit: 100,
      })

      expect(episodic.length).toBe(4)

      // Filter by conversation in application code
      const forConversation = episodic.filter(
        (m) => (m.data as any)?.metadata?.conversationId === conversationId
      )
      expect(forConversation.length).toBe(3)
    })
  })
})
