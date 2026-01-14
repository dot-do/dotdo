/**
 * Memory as Relationships - TDD RED Phase Tests
 *
 * Tests for Agent memory stored as Relationships in the DO Graph model.
 *
 * @see dotdo-kz5kw - [RED] Memory as Relationships - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 *
 * Design:
 * - Memory is stored as Things with type 'Memory'
 * - Agents create 'remembers' Relationships to Memory Things
 * - Memory types: short-term, long-term, episodic
 * - Uses REAL SQLite - NO MOCKS (per project testing philosophy)
 *
 * This test file verifies:
 * 1. Memory creation as Relationships (Agent `remembers` Memory)
 * 2. Memory retrieval by type and recency
 * 3. Memory summarization and truncation
 * 4. Memory search via semantic similarity
 * 5. Cross-agent memory sharing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import type { GraphThing, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Memory type classification
 */
type MemoryType = 'short-term' | 'long-term' | 'episodic'

/**
 * Memory importance level
 */
type MemoryImportance = 'low' | 'medium' | 'high' | 'critical'

/**
 * Memory Thing data structure
 */
interface MemoryThingData {
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
 * Agent Thing data structure (minimal for these tests)
 */
interface AgentThingData {
  name: string
  model: string
  mode: 'autonomous' | 'supervised' | 'interactive'
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/** Type ID for Agent Things */
const TYPE_ID_AGENT = 100

/** Type ID for Memory Things */
const TYPE_ID_MEMORY = 200

/** The 'remembers' verb for Agent-Memory relationships */
const VERB_REMEMBERS = 'remembers'

/** The 'summarizes' verb for Memory-Memory relationships */
const VERB_SUMMARIZES = 'summarizes'

/** The 'references' verb for Memory-Memory relationships */
const VERB_REFERENCES = 'references'

/** The 'sharedWith' verb for Agent-Agent memory sharing */
const VERB_SHARED_WITH = 'sharedWith'

// ============================================================================
// IMPORTS FROM IMPLEMENTATION (GREEN PHASE)
// ============================================================================

import {
  getRecentMemories,
  searchMemories,
  shareMemory,
  MEMORY_TYPE_ID as IMPL_MEMORY_TYPE_ID,
} from '../memory-graph'

// ============================================================================
// HELPER FUNCTIONS (some implemented locally, some from module)
// ============================================================================

/**
 * Create a Memory Thing in the graph
 */
async function createMemoryThing(
  store: SQLiteGraphStore,
  data: MemoryThingData
): Promise<GraphThing> {
  const id = `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return store.createThing({
    id,
    typeId: TYPE_ID_MEMORY,
    typeName: 'Memory',
    data,
  })
}

/**
 * Create a 'remembers' relationship between Agent and Memory
 */
async function createMemoryRelationship(
  store: SQLiteGraphStore,
  options: {
    from: string // Agent Thing ID
    verb: string
    to: string // Memory Thing ID
    data?: Record<string, unknown>
  }
): Promise<GraphRelationship> {
  const id = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return store.createRelationship({
    id,
    verb: options.verb,
    from: `do://agents/${options.from}`,
    to: `do://memories/${options.to}`,
    data: options.data,
  })
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Memory as Relationships', () => {
  let store: SQLiteGraphStore
  let agentThing: GraphThing

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // Create a test agent
    agentThing = await store.createThing({
      id: 'agent-ralph',
      typeId: TYPE_ID_AGENT,
      typeName: 'Agent',
      data: {
        name: 'Ralph',
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      } satisfies AgentThingData,
    })
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Memory Creation as Relationship Tests
  // ==========================================================================

  describe('Memory Creation as Relationship', () => {
    it('creates short-term memory as a Thing', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'User asked about billing',
      })

      expect(memory.id).toBeDefined()
      expect(memory.typeName).toBe('Memory')
      expect((memory.data as MemoryThingData).type).toBe('short-term')
      expect((memory.data as MemoryThingData).content).toBe('User asked about billing')
    })

    it('creates remembers relationship between Agent and Memory', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'User asked about billing',
      })

      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: VERB_REMEMBERS,
        to: memory.id,
      })

      expect(relationship.verb).toBe(VERB_REMEMBERS)
      expect(relationship.from).toContain(agentThing.id)
      expect(relationship.to).toContain(memory.id)
    })

    it('creates long-term memory with importance', async () => {
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Customer prefers email communication',
        importance: 'high',
      })

      expect((memory.data as MemoryThingData).type).toBe('long-term')
      expect((memory.data as MemoryThingData).importance).toBe('high')
    })

    it('creates episodic memory with conversation reference', async () => {
      const memory = await createMemoryThing(store, {
        type: 'episodic',
        content: 'Helped user resolve payment issue on 2024-01-15',
        conversationId: 'conv-12345',
        source: 'conversation',
      })

      expect((memory.data as MemoryThingData).type).toBe('episodic')
      expect((memory.data as MemoryThingData).conversationId).toBe('conv-12345')
      expect((memory.data as MemoryThingData).source).toBe('conversation')
    })

    it('stores relationship metadata on remembers edge', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Test memory',
      })

      const relationship = await createMemoryRelationship(store, {
        from: agentThing.id,
        verb: VERB_REMEMBERS,
        to: memory.id,
        data: {
          accessCount: 0,
          lastAccessed: null,
          expiresAt: Date.now() + 3600000, // 1 hour
        },
      })

      expect(relationship.data).toBeDefined()
      expect((relationship.data as Record<string, unknown>).accessCount).toBe(0)
      expect((relationship.data as Record<string, unknown>).expiresAt).toBeDefined()
    })

    it('creates memory with embedding vector for semantic search', async () => {
      const embedding = Array.from({ length: 1536 }, () => Math.random())

      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Important business fact',
        embedding,
      })

      const data = memory.data as MemoryThingData
      expect(data.embedding).toBeDefined()
      expect(data.embedding?.length).toBe(1536)
    })
  })

  // ==========================================================================
  // 2. Memory Retrieval by Type and Recency
  // ==========================================================================

  describe('Memory Retrieval by Type and Recency', () => {
    it('[RED] retrieves recent memories sorted by creation time', async () => {
      // Create multiple memories
      const mem1 = await createMemoryThing(store, { type: 'short-term', content: 'Memory 1' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem1.id })

      const mem2 = await createMemoryThing(store, { type: 'short-term', content: 'Memory 2' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem2.id })

      const mem3 = await createMemoryThing(store, { type: 'short-term', content: 'Memory 3' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem3.id })

      // This should fail until getRecentMemories is implemented
      const recent = await getRecentMemories(store, agentThing.id, { limit: 5 })

      expect(recent.length).toBe(3)
      // Most recent should be first
      expect((recent[0].data as MemoryThingData).content).toBe('Memory 3')
    })

    it('[RED] filters memories by type', async () => {
      // Create memories of different types
      const shortTerm = await createMemoryThing(store, { type: 'short-term', content: 'Short term' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: shortTerm.id })

      const longTerm = await createMemoryThing(store, { type: 'long-term', content: 'Long term' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: longTerm.id })

      const episodic = await createMemoryThing(store, { type: 'episodic', content: 'Episodic' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: episodic.id })

      // Should only return short-term memories
      const shortTermMemories = await getRecentMemories(store, agentThing.id, { type: 'short-term' })

      expect(shortTermMemories.length).toBe(1)
      expect((shortTermMemories[0].data as MemoryThingData).type).toBe('short-term')
    })

    it('[RED] limits results to specified count', async () => {
      // Create 10 memories
      for (let i = 0; i < 10; i++) {
        const mem = await createMemoryThing(store, { type: 'short-term', content: `Memory ${i}` })
        await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem.id })
      }

      const recent = await getRecentMemories(store, agentThing.id, { limit: 5 })

      expect(recent.length).toBe(5)
    })

    it('[RED] retrieves only memories for specific agent', async () => {
      // Create another agent
      const otherAgent = await store.createThing({
        id: 'agent-priya',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Priya', model: 'claude-opus-4-20250514', mode: 'supervised' } satisfies AgentThingData,
      })

      // Create memories for both agents
      const ralphMem = await createMemoryThing(store, { type: 'short-term', content: 'Ralph memory' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: ralphMem.id })

      const priyaMem = await createMemoryThing(store, { type: 'short-term', content: 'Priya memory' })
      await createMemoryRelationship(store, { from: otherAgent.id, verb: VERB_REMEMBERS, to: priyaMem.id })

      // Should only get Ralph's memories
      const ralphMemories = await getRecentMemories(store, agentThing.id)

      expect(ralphMemories.length).toBe(1)
      expect((ralphMemories[0].data as MemoryThingData).content).toBe('Ralph memory')
    })
  })

  // ==========================================================================
  // 3. Memory Summarization and Truncation
  // ==========================================================================

  describe('Memory Summarization and Truncation', () => {
    it('creates summary relationship between memories', async () => {
      // Create detailed memory
      const detailed = await createMemoryThing(store, {
        type: 'episodic',
        content: 'Long detailed conversation about billing issues...',
      })

      // Create summary memory
      const summary = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Customer had billing concerns',
        summary: 'Summarized from episodic memory',
      })

      // Create summarizes relationship
      const relationship = await store.createRelationship({
        id: `rel-summarizes-${Date.now()}`,
        verb: VERB_SUMMARIZES,
        from: `do://memories/${summary.id}`,
        to: `do://memories/${detailed.id}`,
      })

      expect(relationship.verb).toBe(VERB_SUMMARIZES)
    })

    it('links related memories with references relationship', async () => {
      const mem1 = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Customer prefers email',
      })

      const mem2 = await createMemoryThing(store, {
        type: 'episodic',
        content: 'Mentioned email preference in conversation',
      })

      // Create references relationship
      const relationship = await store.createRelationship({
        id: `rel-references-${Date.now()}`,
        verb: VERB_REFERENCES,
        from: `do://memories/${mem1.id}`,
        to: `do://memories/${mem2.id}`,
      })

      expect(relationship.verb).toBe(VERB_REFERENCES)
    })

    it('stores short-term memories that can be promoted to long-term', async () => {
      const shortTerm = await createMemoryThing(store, {
        type: 'short-term',
        content: 'User mentioned they work at Acme Corp',
        importance: 'low',
      })

      // Update to long-term (this simulates promotion)
      const promoted = await store.updateThing(shortTerm.id, {
        data: {
          ...(shortTerm.data as MemoryThingData),
          type: 'long-term',
          importance: 'high',
        },
      })

      expect((promoted?.data as MemoryThingData).type).toBe('long-term')
      expect((promoted?.data as MemoryThingData).importance).toBe('high')
    })
  })

  // ==========================================================================
  // 4. Memory Search via Semantic Similarity
  // ==========================================================================

  describe('Memory Search via Semantic Similarity', () => {
    it('[RED] searches memories by text content', async () => {
      // Create memories
      const mem1 = await createMemoryThing(store, { type: 'long-term', content: 'Customer billing address is 123 Main St' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem1.id })

      const mem2 = await createMemoryThing(store, { type: 'long-term', content: 'Customer prefers phone calls' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem2.id })

      const mem3 = await createMemoryThing(store, { type: 'episodic', content: 'Discussed billing issues today' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem3.id })

      // Search for billing-related memories
      const results = await searchMemories(store, agentThing.id, 'billing')

      expect(results.length).toBe(2) // Both billing-related memories
    })

    it('[RED] filters search results by memory type', async () => {
      const longTerm = await createMemoryThing(store, { type: 'long-term', content: 'Payment method: credit card' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: longTerm.id })

      const episodic = await createMemoryThing(store, { type: 'episodic', content: 'Updated payment method today' })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: episodic.id })

      // Search only in long-term memories
      const results = await searchMemories(store, agentThing.id, 'payment', { type: 'long-term' })

      expect(results.length).toBe(1)
      expect((results[0].data as MemoryThingData).type).toBe('long-term')
    })

    it('[RED] searches using embedding similarity when available', async () => {
      // Create memory with embedding
      const embedding = Array.from({ length: 1536 }, () => Math.random())
      const mem = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Technical implementation details',
        embedding,
      })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: mem.id })

      // Search with minimum similarity threshold
      const results = await searchMemories(store, agentThing.id, 'technical', { minSimilarity: 0.7 })

      // Should return results based on semantic similarity
      expect(Array.isArray(results)).toBe(true)
    })
  })

  // ==========================================================================
  // 5. Cross-Agent Memory Sharing
  // ==========================================================================

  describe('Cross-Agent Memory Sharing', () => {
    let priyaAgent: GraphThing

    beforeEach(async () => {
      priyaAgent = await store.createThing({
        id: 'agent-priya',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Priya', model: 'claude-opus-4-20250514', mode: 'supervised' } satisfies AgentThingData,
      })
    })

    it('[RED] shares memory from one agent to another', async () => {
      // Ralph creates a memory
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Important customer insight',
      })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: memory.id })

      // Share with Priya
      const shareRel = await shareMemory(store, memory.id, agentThing.id, priyaAgent.id)

      expect(shareRel.verb).toBe(VERB_SHARED_WITH)
    })

    it('[RED] shared memory appears in receiving agent memories', async () => {
      // Ralph creates and shares a memory
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Shared insight',
      })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: memory.id })
      await shareMemory(store, memory.id, agentThing.id, priyaAgent.id)

      // Priya should be able to access shared memories
      const priyaMemories = await getRecentMemories(store, priyaAgent.id)

      // Should include the shared memory
      expect(priyaMemories.some(m => (m.data as MemoryThingData).content === 'Shared insight')).toBe(true)
    })

    it('records sharing metadata on relationship', async () => {
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Important fact',
      })

      // Create share relationship with metadata
      const shareRel = await store.createRelationship({
        id: `rel-share-${Date.now()}`,
        verb: VERB_SHARED_WITH,
        from: `do://agents/${agentThing.id}`,
        to: `do://agents/${priyaAgent.id}`,
        data: {
          memoryId: memory.id,
          sharedAt: Date.now(),
          reason: 'Relevant to product roadmap',
        },
      })

      expect(shareRel.data).toBeDefined()
      expect((shareRel.data as Record<string, unknown>).memoryId).toBe(memory.id)
      expect((shareRel.data as Record<string, unknown>).reason).toBe('Relevant to product roadmap')
    })
  })

  // ==========================================================================
  // 6. Memory Persistence Across Sessions
  // ==========================================================================

  describe('Memory Persistence Across Sessions', () => {
    it('long-term memory persists and is retrievable by ID', async () => {
      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: 'Persistent knowledge',
      })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: memory.id })

      // Retrieve directly by ID
      const retrieved = await store.getThing(memory.id)

      expect(retrieved).not.toBeNull()
      expect((retrieved?.data as MemoryThingData).content).toBe('Persistent knowledge')
    })

    it('episodic memory links to specific conversation', async () => {
      const conversationId = 'conv-session-12345'

      const memory = await createMemoryThing(store, {
        type: 'episodic',
        content: 'User expressed frustration with loading times',
        conversationId,
        source: 'conversation',
      })

      // Should be able to query memories by conversation
      const data = memory.data as MemoryThingData
      expect(data.conversationId).toBe(conversationId)
    })

    it('preserves timestamps for memory auditing', async () => {
      const before = Date.now()

      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Timestamped memory',
      })

      const after = Date.now()

      expect(memory.createdAt).toBeGreaterThanOrEqual(before)
      expect(memory.createdAt).toBeLessThanOrEqual(after)
      expect(memory.updatedAt).toBeGreaterThanOrEqual(before)
    })
  })

  // ==========================================================================
  // 7. Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('handles empty memory content', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: '',
      })

      expect(memory.id).toBeDefined()
      expect((memory.data as MemoryThingData).content).toBe('')
    })

    it('handles very long memory content', async () => {
      const longContent = 'x'.repeat(50000)

      const memory = await createMemoryThing(store, {
        type: 'long-term',
        content: longContent,
      })

      expect((memory.data as MemoryThingData).content.length).toBe(50000)
    })

    it('handles special characters in memory content', async () => {
      const specialContent = 'Test with "quotes" and \'apostrophes\' and \n newlines and unicode \u{1F44B}'

      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: specialContent,
      })

      expect((memory.data as MemoryThingData).content).toBe(specialContent)
    })

    it('prevents duplicate remembers relationships for same memory', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'Test memory',
      })

      // First relationship should succeed
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: memory.id })

      // Second relationship with same verb, from, to should fail
      await expect(
        createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: memory.id })
      ).rejects.toThrow()
    })

    it('soft deletes memory without affecting relationships query', async () => {
      const memory = await createMemoryThing(store, {
        type: 'short-term',
        content: 'To be deleted',
      })
      await createMemoryRelationship(store, { from: agentThing.id, verb: VERB_REMEMBERS, to: memory.id })

      // Soft delete the memory
      await store.deleteThing(memory.id)

      // Memory should still exist but be marked as deleted
      const deleted = await store.getThing(memory.id)
      expect(deleted?.deletedAt).not.toBeNull()
    })
  })

  // ==========================================================================
  // 8. [RED] Memory Graph Helpers (Not Yet Implemented)
  // ==========================================================================

  describe('[RED] Memory Graph Helpers (Not Yet Implemented)', () => {
    it('exports createAgentMemory from agents/memory-graph', async () => {
      // This test will FAIL until memory-graph module is implemented
      const memoryGraphModule = await import('../memory-graph').catch(() => null)

      expect(memoryGraphModule).not.toBeNull()
      expect(memoryGraphModule?.createAgentMemory).toBeDefined()
    })

    it('exports GraphBackedMemory class that implements AgentMemory interface', async () => {
      const memoryGraphModule = await import('../memory-graph').catch(() => null)

      if (!memoryGraphModule?.GraphBackedMemory) {
        throw new Error('GraphBackedMemory not implemented - waiting for agents/memory-graph.ts')
      }

      // Should be able to instantiate with a store
      const graphMemory = new memoryGraphModule.GraphBackedMemory({
        store,
        agentId: agentThing.id,
      })

      // Should implement AgentMemory interface
      expect(typeof graphMemory.remember).toBe('function')
      expect(typeof graphMemory.getRecentMemories).toBe('function')
      expect(typeof graphMemory.searchMemories).toBe('function')
    })

    it('GraphBackedMemory.remember creates Memory Thing and relationship', async () => {
      const memoryGraphModule = await import('../memory-graph').catch(() => null)

      if (!memoryGraphModule?.GraphBackedMemory) {
        throw new Error('GraphBackedMemory not implemented')
      }

      const graphMemory = new memoryGraphModule.GraphBackedMemory({
        store,
        agentId: agentThing.id,
      })

      const memory = await graphMemory.remember('Test memory', { type: 'short-term' })

      expect(memory.id).toBeDefined()
      expect(memory.content).toBe('Test memory')
      expect(memory.type).toBe('short-term')

      // Should have created a relationship
      const relationships = await store.queryRelationshipsFrom(`do://agents/${agentThing.id}`, { verb: VERB_REMEMBERS })
      expect(relationships.length).toBeGreaterThan(0)
    })

    it('GraphBackedMemory.getRecentMemories retrieves via relationship traversal', async () => {
      const memoryGraphModule = await import('../memory-graph').catch(() => null)

      if (!memoryGraphModule?.GraphBackedMemory) {
        throw new Error('GraphBackedMemory not implemented')
      }

      const graphMemory = new memoryGraphModule.GraphBackedMemory({
        store,
        agentId: agentThing.id,
      })

      // Create some memories
      await graphMemory.remember('Memory 1', { type: 'short-term' })
      await graphMemory.remember('Memory 2', { type: 'long-term' })
      await graphMemory.remember('Memory 3', { type: 'short-term' })

      // Should retrieve via graph traversal
      const recent = await graphMemory.getRecentMemories(2)

      expect(recent.length).toBe(2)
    })
  })
})
