/**
 * Agent Memory System Tests
 *
 * Comprehensive tests for the agent memory system covering:
 * - remember() function
 * - getRecentMemories()
 * - searchMemories()
 * - Memory types (short-term, long-term, episodic, semantic)
 * - Unified memory integration
 * - Both storage backends (in-memory and graph-backed)
 *
 * @module agents/tests/memory-system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Message } from '../types'
import {
  createInMemoryAgentMemory,
  createGraphMemory,
  toConversationMemory,
  toAgentMemoryBridge,
  GraphMemoryAdapter,
  InMemoryAgentMemory,
  type AgentMemory,
  type MemoryThing,
  type MemoryType,
  type MemorySearchOptions,
  type StoreMemoryOptions,
} from '../unified-memory'

// ============================================================================
// Test Utilities
// ============================================================================

function createUserMessage(content: string, id?: string): Message {
  return { role: 'user', content, id }
}

function createAssistantMessage(content: string, id?: string): Message {
  return { role: 'assistant', content, id }
}

function createSystemMessage(content: string): Message {
  return { role: 'system', content }
}

/**
 * Generate a mock embedding vector
 */
function createMockEmbedding(seed: number, dimensions: number = 384): number[] {
  return Array.from({ length: dimensions }, (_, i) => Math.sin(seed * (i + 1)) * 0.5 + 0.5)
}

/**
 * Wait for a small amount of time to ensure timestamps differ
 */
async function tick(ms: number = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Remember Function Tests
// ============================================================================

describe('remember() Function', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  describe('Basic Memory Storage', () => {
    it('stores a memory and returns the memory thing', async () => {
      const mem = await memory.remember('User prefers dark mode')

      expect(mem).toBeDefined()
      expect(mem.id).toBeDefined()
      expect(mem.id).toMatch(/^mem-/)
      expect(mem.content).toBe('User prefers dark mode')
      expect(mem.createdAt).toBeInstanceOf(Date)
      expect(mem.updatedAt).toBeInstanceOf(Date)
    })

    it('defaults to short-term memory type', async () => {
      const mem = await memory.remember('Temporary context')

      expect(mem.type).toBe('short-term')
    })

    it('stores memory with explicit type', async () => {
      const shortTerm = await memory.remember('Quick note', { type: 'short-term' })
      const longTerm = await memory.remember('Important fact', { type: 'long-term' })
      const episodic = await memory.remember('Event that happened', { type: 'episodic' })
      const semantic = await memory.remember('Knowledge item', { type: 'semantic' })

      expect(shortTerm.type).toBe('short-term')
      expect(longTerm.type).toBe('long-term')
      expect(episodic.type).toBe('episodic')
      expect(semantic.type).toBe('semantic')
    })

    it('stores memory with metadata', async () => {
      const mem = await memory.remember('Customer preference', {
        metadata: {
          source: 'conversation',
          confidence: 0.95,
          tags: ['preference', 'ui'],
        },
      })

      expect(mem.metadata).toBeDefined()
      expect(mem.metadata?.source).toBe('conversation')
      expect(mem.metadata?.confidence).toBe(0.95)
      expect(mem.metadata?.tags).toEqual(['preference', 'ui'])
    })

    it('stores memory with pre-computed embedding', async () => {
      const embedding = createMockEmbedding(42)
      const mem = await memory.remember('Fact with embedding', { embedding })

      expect(mem.embedding).toBeDefined()
      expect(mem.embedding).toEqual(embedding)
      expect(mem.embedding?.length).toBe(384)
    })

    it('generates unique IDs for each memory', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2')
      const mem3 = await memory.remember('Memory 3')

      expect(mem1.id).not.toBe(mem2.id)
      expect(mem2.id).not.toBe(mem3.id)
      expect(mem1.id).not.toBe(mem3.id)
    })

    it('handles empty content', async () => {
      const mem = await memory.remember('')

      expect(mem.content).toBe('')
      expect(mem.id).toBeDefined()
    })

    it('handles special characters in content', async () => {
      const specialContent = 'User said: "Hello! How\'s it going?" \n\t Special chars: <>&'
      const mem = await memory.remember(specialContent)

      expect(mem.content).toBe(specialContent)
    })

    it('handles unicode content', async () => {
      const unicodeContent = 'User greeted with: Hello World Test'
      const mem = await memory.remember(unicodeContent)

      expect(mem.content).toBe(unicodeContent)
    })

    it('handles very long content', async () => {
      const longContent = 'x'.repeat(100000)
      const mem = await memory.remember(longContent)

      expect(mem.content.length).toBe(100000)
    })
  })

  describe('Memory Relationships', () => {
    it('creates relationships when relatedTo option is provided', async () => {
      const mem1 = await memory.remember('First memory')
      const mem2 = await memory.remember('Related memory', { relatedTo: [mem1.id] })

      const related = await memory.getRelatedMemories(mem2.id)
      expect(related).toHaveLength(1)
      expect(related[0].id).toBe(mem1.id)
    })

    it('creates multiple relationships', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2')
      const mem3 = await memory.remember('Memory 3', { relatedTo: [mem1.id, mem2.id] })

      const related = await memory.getRelatedMemories(mem3.id)
      expect(related).toHaveLength(2)
      expect(related.map((r) => r.id)).toContain(mem1.id)
      expect(related.map((r) => r.id)).toContain(mem2.id)
    })
  })

  describe('Concurrent Operations', () => {
    it('handles rapid sequential memory storage', async () => {
      const promises = Array.from({ length: 50 }, (_, i) => memory.remember(`Rapid memory ${i}`))

      const results = await Promise.all(promises)

      expect(results).toHaveLength(50)
      // All should have unique IDs
      const ids = new Set(results.map((r) => r.id))
      expect(ids.size).toBe(50)
    })

    it('handles concurrent read and write operations', async () => {
      // Pre-populate some memories
      await memory.remember('Initial memory 1')
      await memory.remember('Initial memory 2')

      // Concurrent operations
      const operations = [
        memory.remember('Concurrent memory 1'),
        memory.remember('Concurrent memory 2'),
        memory.getRecentMemories(10),
        memory.remember('Concurrent memory 3'),
        memory.searchMemories('memory'),
        memory.getStats(),
      ]

      const results = await Promise.all(operations)

      // All operations should complete without error
      expect(results).toHaveLength(6)
    })
  })
})

// ============================================================================
// getRecentMemories() Tests
// ============================================================================

describe('getRecentMemories() Function', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  describe('Basic Retrieval', () => {
    it('retrieves memories in recency order (most recent first)', async () => {
      await memory.remember('Memory 1')
      await tick()
      await memory.remember('Memory 2')
      await tick()
      await memory.remember('Memory 3')

      const recent = await memory.getRecentMemories(3)

      expect(recent).toHaveLength(3)
      expect(recent[0].content).toBe('Memory 3')
      expect(recent[1].content).toBe('Memory 2')
      expect(recent[2].content).toBe('Memory 1')
    })

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await memory.remember(`Memory ${i}`)
      }

      const recent5 = await memory.getRecentMemories(5)
      const recent3 = await memory.getRecentMemories(3)
      const recent1 = await memory.getRecentMemories(1)

      expect(recent5).toHaveLength(5)
      expect(recent3).toHaveLength(3)
      expect(recent1).toHaveLength(1)
    })

    it('returns all memories when limit exceeds count', async () => {
      await memory.remember('Memory 1')
      await memory.remember('Memory 2')

      const recent = await memory.getRecentMemories(100)

      expect(recent).toHaveLength(2)
    })

    it('returns empty array when no memories exist', async () => {
      const recent = await memory.getRecentMemories(10)

      expect(recent).toHaveLength(0)
    })

    it('uses default limit when not specified', async () => {
      for (let i = 0; i < 15; i++) {
        await memory.remember(`Memory ${i}`)
      }

      const recent = await memory.getRecentMemories()

      // Default limit is 10
      expect(recent).toHaveLength(10)
    })
  })

  describe('Type Filtering', () => {
    beforeEach(async () => {
      // Create memories of different types
      await memory.remember('Short term 1', { type: 'short-term' })
      await tick()
      await memory.remember('Long term 1', { type: 'long-term' })
      await tick()
      await memory.remember('Short term 2', { type: 'short-term' })
      await tick()
      await memory.remember('Episodic 1', { type: 'episodic' })
      await tick()
      await memory.remember('Semantic 1', { type: 'semantic' })
      await tick()
      await memory.remember('Short term 3', { type: 'short-term' })
    })

    it('filters by short-term type', async () => {
      const shortTerm = await memory.getRecentMemories(10, 'short-term')

      expect(shortTerm).toHaveLength(3)
      expect(shortTerm.every((m) => m.type === 'short-term')).toBe(true)
    })

    it('filters by long-term type', async () => {
      const longTerm = await memory.getRecentMemories(10, 'long-term')

      expect(longTerm).toHaveLength(1)
      expect(longTerm[0].type).toBe('long-term')
    })

    it('filters by episodic type', async () => {
      const episodic = await memory.getRecentMemories(10, 'episodic')

      expect(episodic).toHaveLength(1)
      expect(episodic[0].type).toBe('episodic')
    })

    it('filters by semantic type', async () => {
      const semantic = await memory.getRecentMemories(10, 'semantic')

      expect(semantic).toHaveLength(1)
      expect(semantic[0].type).toBe('semantic')
    })

    it('returns empty when no memories match type', async () => {
      const freshMemory = createInMemoryAgentMemory()
      await freshMemory.remember('Only short-term', { type: 'short-term' })

      const longTerm = await freshMemory.getRecentMemories(10, 'long-term')

      expect(longTerm).toHaveLength(0)
    })

    it('maintains recency order within type filter', async () => {
      const shortTerm = await memory.getRecentMemories(10, 'short-term')

      expect(shortTerm[0].content).toBe('Short term 3')
      expect(shortTerm[1].content).toBe('Short term 2')
      expect(shortTerm[2].content).toBe('Short term 1')
    })

    it('applies limit after type filter', async () => {
      const shortTerm = await memory.getRecentMemories(2, 'short-term')

      expect(shortTerm).toHaveLength(2)
      expect(shortTerm[0].content).toBe('Short term 3')
      expect(shortTerm[1].content).toBe('Short term 2')
    })
  })
})

// ============================================================================
// searchMemories() Tests
// ============================================================================

describe('searchMemories() Function', () => {
  let memory: AgentMemory

  beforeEach(async () => {
    memory = createInMemoryAgentMemory()

    // Populate with searchable content
    await memory.remember('The user prefers dark mode interface', { type: 'long-term' })
    await memory.remember('TypeScript is a typed superset of JavaScript', { type: 'semantic' })
    await memory.remember('User asked about billing issues yesterday', { type: 'episodic' })
    await memory.remember('The weather in San Francisco is sunny', { type: 'short-term' })
    await memory.remember('JavaScript ES6 introduced arrow functions', { type: 'semantic' })
    await memory.remember('User lives in San Francisco', { type: 'long-term' })
  })

  describe('Text Search', () => {
    it('finds memories containing the query string', async () => {
      const results = await memory.searchMemories('San Francisco')

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.content.toLowerCase().includes('san francisco'))).toBe(true)
    })

    it('search is case-insensitive', async () => {
      const results1 = await memory.searchMemories('typescript')
      const results2 = await memory.searchMemories('TYPESCRIPT')
      const results3 = await memory.searchMemories('TypeScript')

      expect(results1).toHaveLength(1)
      expect(results2).toHaveLength(1)
      expect(results3).toHaveLength(1)
      expect(results1[0].id).toBe(results2[0].id)
      expect(results2[0].id).toBe(results3[0].id)
    })

    it('returns empty array when no matches found', async () => {
      const results = await memory.searchMemories('nonexistent query')

      expect(results).toHaveLength(0)
    })

    it('finds partial matches', async () => {
      const results = await memory.searchMemories('JavaScript')

      // Should match both TypeScript and JavaScript memories
      expect(results.length).toBeGreaterThanOrEqual(2)
    })

    it('handles special characters in query', async () => {
      await memory.remember('User email is test@example.com')

      const results = await memory.searchMemories('test@example.com')

      expect(results).toHaveLength(1)
      expect(results[0].content).toContain('test@example.com')
    })
  })

  describe('Search Options', () => {
    it('filters search results by memory type', async () => {
      const semanticResults = await memory.searchMemories('JavaScript', { type: 'semantic' })
      const allResults = await memory.searchMemories('JavaScript')

      expect(semanticResults.every((r) => r.type === 'semantic')).toBe(true)
      expect(semanticResults.length).toBeLessThanOrEqual(allResults.length)
    })

    it('applies limit to search results', async () => {
      const limited = await memory.searchMemories('user', { limit: 2 })

      expect(limited.length).toBeLessThanOrEqual(2)
    })

    it('filters by time range - since', async () => {
      const past = new Date(Date.now() - 100000)
      const future = new Date(Date.now() + 100000)

      const sinceResults = await memory.searchMemories('user', { since: past })

      expect(sinceResults.length).toBeGreaterThan(0)

      const futureResults = await memory.searchMemories('user', { since: future })
      expect(futureResults).toHaveLength(0)
    })

    it('filters by time range - before', async () => {
      const past = new Date(Date.now() - 100000)
      const future = new Date(Date.now() + 100000)

      const beforeResults = await memory.searchMemories('user', { before: future })
      expect(beforeResults.length).toBeGreaterThan(0)

      const pastResults = await memory.searchMemories('user', { before: past })
      expect(pastResults).toHaveLength(0)
    })

    it('combines multiple filters', async () => {
      const results = await memory.searchMemories('user', {
        type: 'long-term',
        limit: 1,
      })

      expect(results.length).toBeLessThanOrEqual(1)
      if (results.length > 0) {
        expect(results[0].type).toBe('long-term')
        expect(results[0].content.toLowerCase()).toContain('user')
      }
    })
  })
})

// ============================================================================
// Memory Types Tests
// ============================================================================

describe('Memory Types', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  describe('Short-term Memory', () => {
    it('stores recent context for current session', async () => {
      const mem = await memory.remember('User just asked about the weather', {
        type: 'short-term',
      })

      expect(mem.type).toBe('short-term')
    })

    it('is the default memory type', async () => {
      const mem = await memory.remember('Some context')
      expect(mem.type).toBe('short-term')
    })

    it('can be retrieved and filtered specifically', async () => {
      await memory.remember('Short-term 1', { type: 'short-term' })
      await memory.remember('Long-term 1', { type: 'long-term' })
      await memory.remember('Short-term 2', { type: 'short-term' })

      const shortTerm = await memory.getRecentMemories(10, 'short-term')
      expect(shortTerm).toHaveLength(2)
    })
  })

  describe('Long-term Memory', () => {
    it('stores persistent facts and preferences', async () => {
      const mem = await memory.remember('User prefers email communication', {
        type: 'long-term',
        metadata: { category: 'preference', confidence: 0.95 },
      })

      expect(mem.type).toBe('long-term')
      expect(mem.metadata?.category).toBe('preference')
    })

    it('persists across conversation sessions', async () => {
      const mem = await memory.remember('Important fact to remember', { type: 'long-term' })
      const id = mem.id

      // Retrieve by ID later
      const retrieved = await memory.getMemory(id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.type).toBe('long-term')
    })
  })

  describe('Episodic Memory', () => {
    it('stores specific events with temporal context', async () => {
      const mem = await memory.remember('Had a support call about order #12345', {
        type: 'episodic',
        metadata: {
          eventType: 'support_call',
          orderId: '12345',
          duration: 300,
          timestamp: new Date().toISOString(),
        },
      })

      expect(mem.type).toBe('episodic')
      expect(mem.metadata?.eventType).toBe('support_call')
    })

    it('can track conversation milestones', async () => {
      const events = [
        { content: 'Conversation started', event: 'start' },
        { content: 'User provided payment details', event: 'payment_info' },
        { content: 'Order confirmed', event: 'order_confirmed' },
      ]

      for (const event of events) {
        await memory.remember(event.content, {
          type: 'episodic',
          metadata: { eventType: event.event },
        })
        await tick()
      }

      const episodic = await memory.getRecentMemories(10, 'episodic')
      expect(episodic).toHaveLength(3)
      // Most recent first
      expect((episodic[0].metadata as any)?.eventType).toBe('order_confirmed')
    })
  })

  describe('Semantic Memory', () => {
    it('stores extracted facts and knowledge', async () => {
      const mem = await memory.remember('The company headquarters is in San Francisco', {
        type: 'semantic',
        metadata: {
          entity: 'company',
          property: 'location',
          value: 'San Francisco',
        },
      })

      expect(mem.type).toBe('semantic')
      expect(mem.metadata?.entity).toBe('company')
    })

    it('can be used for knowledge retrieval', async () => {
      await memory.remember('TypeScript was developed by Microsoft', {
        type: 'semantic',
        metadata: { subject: 'TypeScript', relation: 'developed_by', object: 'Microsoft' },
      })

      const results = await memory.searchMemories('TypeScript', { type: 'semantic' })
      expect(results).toHaveLength(1)
      expect(results[0].metadata?.relation).toBe('developed_by')
    })
  })

  describe('Type Statistics', () => {
    it('tracks memory counts by type', async () => {
      await memory.remember('ST 1', { type: 'short-term' })
      await memory.remember('ST 2', { type: 'short-term' })
      await memory.remember('LT 1', { type: 'long-term' })
      await memory.remember('EP 1', { type: 'episodic' })
      await memory.remember('EP 2', { type: 'episodic' })
      await memory.remember('EP 3', { type: 'episodic' })
      await memory.remember('SE 1', { type: 'semantic' })

      const stats = await memory.getStats()

      expect(stats.totalMemories).toBe(7)
      expect(stats.byType['short-term']).toBe(2)
      expect(stats.byType['long-term']).toBe(1)
      expect(stats.byType['episodic']).toBe(3)
      expect(stats.byType['semantic']).toBe(1)
    })
  })
})

// ============================================================================
// Unified Memory Integration Tests
// ============================================================================

describe('Unified Memory Integration', () => {
  describe('Agent.ts Memory Bridge', () => {
    let memory: AgentMemory
    let bridge: ReturnType<typeof toAgentMemoryBridge>

    beforeEach(() => {
      memory = createInMemoryAgentMemory()
      bridge = toAgentMemoryBridge(memory)
    })

    it('provides Agent.ts compatible remember() API', async () => {
      // Agent.ts signature: remember(content: string, type?: MemoryType): Promise<Memory>
      const mem = await bridge.remember('Test content', 'long-term')

      expect(mem.id).toBeDefined()
      expect(mem.content).toBe('Test content')
      expect(mem.type).toBe('long-term')
      expect(mem.createdAt).toBeInstanceOf(Date)
    })

    it('provides Agent.ts compatible getRecentMemories() API', async () => {
      await bridge.remember('Memory 1')
      await bridge.remember('Memory 2')
      await bridge.remember('Memory 3')

      // Agent.ts signature: getRecentMemories(limit?: number): Promise<Memory[]>
      const recent = await bridge.getRecentMemories(2)

      expect(recent).toHaveLength(2)
    })

    it('provides Agent.ts compatible searchMemories() API', async () => {
      await bridge.remember('TypeScript is great')
      await bridge.remember('Python is also great')

      // Agent.ts signature: searchMemories(query: string): Promise<Memory[]>
      const results = await bridge.searchMemories('TypeScript')

      expect(results).toHaveLength(1)
      expect(results[0].content).toContain('TypeScript')
    })

    it('shares state with underlying AgentMemory', async () => {
      // Write via bridge
      await bridge.remember('Written via bridge')

      // Read via AgentMemory directly
      const memories = await memory.getRecentMemories()
      expect(memories).toHaveLength(1)
      expect(memories[0].content).toBe('Written via bridge')
    })
  })

  describe('ConversationMemory Adapter', () => {
    let memory: AgentMemory
    let conversationMemory: ReturnType<typeof toConversationMemory>

    beforeEach(() => {
      memory = createInMemoryAgentMemory()
      conversationMemory = toConversationMemory(memory, 'test-conv')
    })

    it('provides conversation ID', () => {
      expect(conversationMemory.getConversationId()).toBe('test-conv')
    })

    it('adds messages synchronously', async () => {
      conversationMemory.addMessage(createUserMessage('Hello'))
      await tick(20) // Wait for async write

      const messages = conversationMemory.getMessages()
      expect(messages.length).toBeGreaterThanOrEqual(1)
    })

    it('retrieves messages in order', async () => {
      await memory.addMessage(createUserMessage('First'))
      await memory.addMessage(createAssistantMessage('Second'))
      await memory.addMessage(createUserMessage('Third'))

      const messages = conversationMemory.getMessages()
      expect(messages[0].content).toBe('First')
      expect(messages[1].content).toBe('Second')
      expect(messages[2].content).toBe('Third')
    })

    it('clears messages', async () => {
      await memory.addMessage(createUserMessage('Hello'))
      conversationMemory.clear()

      expect(conversationMemory.getMessages()).toHaveLength(0)
    })

    it('exports and imports state', async () => {
      await memory.addMessage(createUserMessage('Message 1'))
      await memory.addMessage(createAssistantMessage('Message 2'))

      const state = conversationMemory.exportState()
      expect(state.id).toBe('test-conv')
      expect(state.messages).toHaveLength(2)

      // Import into new adapter
      const newMemory = createInMemoryAgentMemory()
      const newAdapter = toConversationMemory(newMemory, 'new-conv')
      newAdapter.importState(state)

      expect(newAdapter.getConversationId()).toBe('test-conv')
    })
  })

  describe('Message and Memory Coexistence', () => {
    let memory: AgentMemory

    beforeEach(() => {
      memory = createInMemoryAgentMemory()
    })

    it('supports interleaved message and memory operations', async () => {
      await memory.addMessage(createUserMessage('What is the weather?'))
      await memory.remember('User asked about weather', { type: 'episodic' })
      await memory.addMessage(createAssistantMessage('It is sunny today'))
      await memory.remember('Weather is sunny', { type: 'semantic' })

      const stats = await memory.getStats()
      expect(stats.messageCount).toBe(2)
      expect(stats.totalMemories).toBe(2)
    })

    it('maintains separate counts for messages and memories', async () => {
      for (let i = 0; i < 5; i++) {
        await memory.addMessage(createUserMessage(`Message ${i}`))
      }
      for (let i = 0; i < 3; i++) {
        await memory.remember(`Memory ${i}`)
      }

      const stats = await memory.getStats()
      expect(stats.messageCount).toBe(5)
      expect(stats.totalMemories).toBe(3)
    })
  })
})

// ============================================================================
// Storage Backend Tests
// ============================================================================

describe('Storage Backends', () => {
  describe('InMemoryAgentMemory', () => {
    let memory: InMemoryAgentMemory

    beforeEach(() => {
      memory = new InMemoryAgentMemory()
    })

    it('stores and retrieves memories', async () => {
      const stored = await memory.remember('Test memory')
      const retrieved = await memory.getMemory(stored.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.content).toBe('Test memory')
    })

    it('updates memories', async () => {
      const stored = await memory.remember('Original content', { type: 'short-term' })

      const updated = await memory.updateMemory(stored.id, {
        content: 'Updated content',
        type: 'long-term',
      })

      expect(updated?.content).toBe('Updated content')
      expect(updated?.type).toBe('long-term')
    })

    it('deletes memories', async () => {
      const stored = await memory.remember('To be deleted')

      const deleted = await memory.deleteMemory(stored.id)
      expect(deleted).toBe(true)

      const retrieved = await memory.getMemory(stored.id)
      expect(retrieved).toBeNull()
    })

    it('links and retrieves related memories', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2')

      await memory.linkMemories(mem1.id, mem2.id, 'related-to')

      const related = await memory.getRelatedMemories(mem1.id)
      expect(related).toHaveLength(1)
      expect(related[0].id).toBe(mem2.id)
    })

    it('filters related memories by verb', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2')
      const mem3 = await memory.remember('Memory 3')

      await memory.linkMemories(mem1.id, mem2.id, 'causes')
      await memory.linkMemories(mem1.id, mem3.id, 'relates-to')

      const causes = await memory.getRelatedMemories(mem1.id, 'causes')
      expect(causes).toHaveLength(1)
      expect(causes[0].id).toBe(mem2.id)
    })

    it('respects maxMessages limit', async () => {
      const limitedMemory = new InMemoryAgentMemory(5)

      for (let i = 0; i < 10; i++) {
        await limitedMemory.addMessage(createUserMessage(`Message ${i}`))
      }

      const messages = limitedMemory.getMessages()
      expect(messages).toHaveLength(5)
    })

    it('flush is a no-op for in-memory storage', async () => {
      await memory.remember('Test')
      await expect(memory.flush()).resolves.toBeUndefined()
    })
  })

  describe('GraphMemoryAdapter', () => {
    // Note: These tests require a mock GraphStore since the real SQLiteGraphStore
    // may not be available in all test environments

    const createMockGraphStore = () => {
      const things = new Map<string, any>()
      const relationships: any[] = []

      return {
        async createThing(input: any) {
          const now = Date.now()
          const thing = {
            ...input,
            createdAt: now,
            updatedAt: now,
          }
          things.set(input.id, thing)
          return thing
        },
        async getThing(id: string) {
          return things.get(id) || null
        },
        async getThingsByType(options: any) {
          return Array.from(things.values())
            .filter((t) => t.typeName === options.typeName)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, options.limit || 100)
        },
        async updateThing(id: string, updates: any) {
          const existing = things.get(id)
          if (!existing) return null
          const updated = { ...existing, ...updates, updatedAt: Date.now() }
          things.set(id, updated)
          return updated
        },
        async deleteThing(id: string) {
          const thing = things.get(id)
          if (thing) {
            things.delete(id)
            return thing
          }
          return null
        },
        async createRelationship(input: any) {
          const rel = { ...input, createdAt: Date.now() }
          relationships.push(rel)
          return rel
        },
        async queryRelationshipsFrom(url: string, options?: any) {
          return relationships.filter((r) => r.from === url && (!options?.verb || r.verb === options.verb))
        },
        async queryRelationshipsTo(url: string, options?: any) {
          return relationships.filter((r) => r.to === url && (!options?.verb || r.verb === options.verb))
        },
        async queryRelationshipsByVerb(verb: string) {
          return relationships.filter((r) => r.verb === verb)
        },
        async deleteRelationship(id: string) {
          const idx = relationships.findIndex((r) => r.id === id)
          if (idx >= 0) {
            relationships.splice(idx, 1)
            return true
          }
          return false
        },
      }
    }

    it('creates GraphMemoryAdapter with configuration', () => {
      const mockStore = createMockGraphStore()
      const adapter = new GraphMemoryAdapter({
        store: mockStore as any,
        agentId: 'test-agent',
        sessionId: 'test-session',
      })

      expect(adapter).toBeDefined()
    })

    it('stores and retrieves memories via graph', async () => {
      const mockStore = createMockGraphStore()
      const adapter = new GraphMemoryAdapter({
        store: mockStore as any,
        agentId: 'test-agent',
      })

      const stored = await adapter.remember('Graph memory test')

      expect(stored.content).toBe('Graph memory test')
      expect(stored.id).toMatch(/^mem-/)
    })

    it('supports custom embedder function', async () => {
      const mockEmbedder = vi.fn().mockResolvedValue(createMockEmbedding(42))
      const mockStore = createMockGraphStore()
      const adapter = new GraphMemoryAdapter({
        store: mockStore as any,
        agentId: 'test-agent',
        embedder: mockEmbedder,
      })

      const stored = await adapter.remember('Memory to embed')

      expect(mockEmbedder).toHaveBeenCalledWith('Memory to embed')
      expect(stored.embedding).toBeDefined()
    })

    it('handles message operations', async () => {
      const mockStore = createMockGraphStore()
      const adapter = new GraphMemoryAdapter({
        store: mockStore as any,
        agentId: 'test-agent',
      })

      await adapter.addMessage(createUserMessage('Hello'))
      await adapter.addMessage(createAssistantMessage('Hi!'))

      const messages = adapter.getMessages()
      expect(messages).toHaveLength(2)
    })

    it('respects maxMessages configuration', async () => {
      const mockStore = createMockGraphStore()
      const adapter = new GraphMemoryAdapter({
        store: mockStore as any,
        agentId: 'test-agent',
        maxMessages: 5,
      })

      for (let i = 0; i < 10; i++) {
        await adapter.addMessage(createUserMessage(`Message ${i}`))
      }

      const messages = adapter.getMessages()
      expect(messages).toHaveLength(5)
    })
  })
})

// ============================================================================
// Memory CRUD Operations Tests
// ============================================================================

describe('Memory CRUD Operations', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  describe('Create', () => {
    it('creates memory with all fields populated', async () => {
      const mem = await memory.remember('Test content', {
        type: 'long-term',
        metadata: { key: 'value' },
        embedding: createMockEmbedding(1),
      })

      expect(mem.id).toBeDefined()
      expect(mem.content).toBe('Test content')
      expect(mem.type).toBe('long-term')
      expect(mem.metadata).toEqual({ key: 'value' })
      expect(mem.embedding).toBeDefined()
      expect(mem.createdAt).toBeInstanceOf(Date)
      expect(mem.updatedAt).toBeInstanceOf(Date)
    })
  })

  describe('Read', () => {
    it('retrieves memory by ID', async () => {
      const created = await memory.remember('Find me')

      const found = await memory.getMemory(created.id)

      expect(found).not.toBeNull()
      expect(found?.content).toBe('Find me')
    })

    it('returns null for non-existent ID', async () => {
      const result = await memory.getMemory('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('Update', () => {
    it('updates memory content', async () => {
      const created = await memory.remember('Original')

      const updated = await memory.updateMemory(created.id, {
        content: 'Modified',
      })

      expect(updated?.content).toBe('Modified')
    })

    it('updates memory type', async () => {
      const created = await memory.remember('To promote', { type: 'short-term' })

      const updated = await memory.updateMemory(created.id, {
        type: 'long-term',
      })

      expect(updated?.type).toBe('long-term')
    })

    it('updates memory metadata', async () => {
      const created = await memory.remember('With metadata', {
        metadata: { old: 'value' },
      })

      const updated = await memory.updateMemory(created.id, {
        metadata: { new: 'value', extra: 123 },
      })

      expect(updated?.metadata).toEqual({ new: 'value', extra: 123 })
    })

    it('preserves unchanged fields', async () => {
      const created = await memory.remember('Partial update', {
        type: 'long-term',
        metadata: { preserved: true },
      })

      const updated = await memory.updateMemory(created.id, {
        content: 'Updated content only',
      })

      expect(updated?.content).toBe('Updated content only')
      expect(updated?.type).toBe('long-term')
      // Note: In the actual implementation, metadata update replaces entirely
    })

    it('updates updatedAt timestamp', async () => {
      const created = await memory.remember('Timestamp test')
      const originalUpdatedAt = created.updatedAt

      await tick(50)

      const updated = await memory.updateMemory(created.id, { content: 'New' })

      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })

    it('returns null for non-existent ID', async () => {
      const result = await memory.updateMemory('non-existent', { content: 'New' })
      expect(result).toBeNull()
    })
  })

  describe('Delete', () => {
    it('deletes existing memory', async () => {
      const created = await memory.remember('To delete')

      const deleted = await memory.deleteMemory(created.id)
      expect(deleted).toBe(true)

      const retrieved = await memory.getMemory(created.id)
      expect(retrieved).toBeNull()
    })

    it('returns false for non-existent ID', async () => {
      const result = await memory.deleteMemory('non-existent')
      expect(result).toBe(false)
    })

    it('removes from recent memories list', async () => {
      await memory.remember('Memory 1')
      const toDelete = await memory.remember('Memory 2')
      await memory.remember('Memory 3')

      await memory.deleteMemory(toDelete.id)

      const recent = await memory.getRecentMemories(10)
      expect(recent).toHaveLength(2)
      expect(recent.find((m) => m.id === toDelete.id)).toBeUndefined()
    })

    it('removes from search results', async () => {
      await memory.remember('Keep me TypeScript')
      const toDelete = await memory.remember('Delete me TypeScript')

      await memory.deleteMemory(toDelete.id)

      const results = await memory.searchMemories('TypeScript')
      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Keep me TypeScript')
    })
  })
})

// ============================================================================
// Memory Statistics Tests
// ============================================================================

describe('Memory Statistics', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  it('returns zero stats for empty memory', async () => {
    const stats = await memory.getStats()

    expect(stats.totalMemories).toBe(0)
    expect(stats.messageCount).toBe(0)
    expect(stats.byType['short-term']).toBe(0)
    expect(stats.byType['long-term']).toBe(0)
    expect(stats.byType['episodic']).toBe(0)
    expect(stats.byType['semantic']).toBe(0)
    expect(stats.oldestMemory).toBeUndefined()
    expect(stats.newestMemory).toBeUndefined()
  })

  it('tracks total memory count', async () => {
    await memory.remember('Memory 1')
    await memory.remember('Memory 2')
    await memory.remember('Memory 3')

    const stats = await memory.getStats()
    expect(stats.totalMemories).toBe(3)
  })

  it('tracks message count separately', async () => {
    await memory.addMessage(createUserMessage('Hello'))
    await memory.addMessage(createAssistantMessage('Hi'))
    await memory.remember('Memory 1')

    const stats = await memory.getStats()
    expect(stats.messageCount).toBe(2)
    expect(stats.totalMemories).toBe(1)
  })

  it('tracks counts by memory type', async () => {
    await memory.remember('ST 1', { type: 'short-term' })
    await memory.remember('ST 2', { type: 'short-term' })
    await memory.remember('LT 1', { type: 'long-term' })
    await memory.remember('EP 1', { type: 'episodic' })
    await memory.remember('EP 2', { type: 'episodic' })
    await memory.remember('EP 3', { type: 'episodic' })

    const stats = await memory.getStats()
    expect(stats.byType['short-term']).toBe(2)
    expect(stats.byType['long-term']).toBe(1)
    expect(stats.byType['episodic']).toBe(3)
    expect(stats.byType['semantic']).toBe(0)
  })

  it('tracks oldest and newest memory timestamps', async () => {
    const first = await memory.remember('First')
    await tick(50)
    await memory.remember('Middle')
    await tick(50)
    const last = await memory.remember('Last')

    const stats = await memory.getStats()

    expect(stats.oldestMemory).toBeDefined()
    expect(stats.newestMemory).toBeDefined()
    expect(stats.oldestMemory!.getTime()).toBeLessThanOrEqual(stats.newestMemory!.getTime())
    expect(stats.oldestMemory!.getTime()).toBe(first.createdAt.getTime())
    expect(stats.newestMemory!.getTime()).toBe(last.createdAt.getTime())
  })

  it('updates stats after deletion', async () => {
    const mem1 = await memory.remember('Memory 1', { type: 'short-term' })
    await memory.remember('Memory 2', { type: 'short-term' })

    let stats = await memory.getStats()
    expect(stats.totalMemories).toBe(2)
    expect(stats.byType['short-term']).toBe(2)

    await memory.deleteMemory(mem1.id)

    stats = await memory.getStats()
    expect(stats.totalMemories).toBe(1)
    expect(stats.byType['short-term']).toBe(1)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  describe('Empty and Null Handling', () => {
    it('handles empty search query', async () => {
      await memory.remember('Some content')
      const results = await memory.searchMemories('')
      expect(results).toBeDefined()
    })

    it('handles undefined metadata gracefully', async () => {
      const mem = await memory.remember('No metadata')
      expect(mem.metadata).toBeUndefined()
    })
  })

  describe('Large Scale Operations', () => {
    it('handles 1000 memories', async () => {
      const memories: MemoryThing[] = []
      for (let i = 0; i < 1000; i++) {
        memories.push(await memory.remember(`Memory ${i}`))
      }

      const stats = await memory.getStats()
      expect(stats.totalMemories).toBe(1000)

      const recent = await memory.getRecentMemories(10)
      expect(recent).toHaveLength(10)

      const search = await memory.searchMemories('Memory 500')
      expect(search.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Timestamp Handling', () => {
    it('memories created in sequence have increasing timestamps', async () => {
      const mem1 = await memory.remember('First')
      await tick(10)
      const mem2 = await memory.remember('Second')
      await tick(10)
      const mem3 = await memory.remember('Third')

      expect(mem1.createdAt.getTime()).toBeLessThan(mem2.createdAt.getTime())
      expect(mem2.createdAt.getTime()).toBeLessThan(mem3.createdAt.getTime())
    })
  })

  describe('Type Safety', () => {
    it('rejects invalid memory types at compile time', async () => {
      // This would be a compile-time error if using invalid type
      const validTypes: MemoryType[] = ['short-term', 'long-term', 'episodic', 'semantic']

      for (const type of validTypes) {
        const mem = await memory.remember('Test', { type })
        expect(mem.type).toBe(type)
      }
    })
  })
})
