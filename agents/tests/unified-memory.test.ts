/**
 * Unified Memory System Tests
 *
 * Tests for the consolidated memory system that unifies:
 * - ConversationMemory (agents/memory.ts)
 * - Agent.ts memory (objects/Agent.ts)
 * - Graph-backed persistence
 *
 * @see dotdo-ww5cn - [REFACTOR] Consolidate Agent Memory Systems
 * @module agents/tests/unified-memory
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message } from '../types'
import {
  createInMemoryAgentMemory,
  toConversationMemory,
  toAgentMemoryBridge,
  type AgentMemory,
  type MemoryThing,
  type MemoryType,
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

// ============================================================================
// InMemoryAgentMemory Tests
// ============================================================================

describe('InMemoryAgentMemory', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
  })

  describe('Message Operations', () => {
    it('should add and retrieve messages', async () => {
      await memory.addMessage(createUserMessage('Hello'))
      await memory.addMessage(createAssistantMessage('Hi there!'))

      const messages = memory.getMessages()
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('Hello')
      expect(messages[1].content).toBe('Hi there!')
    })

    it('should assign IDs to messages without IDs', async () => {
      await memory.addMessage(createUserMessage('Hello'))

      const messages = memory.getMessages()
      expect(messages[0].id).toBeDefined()
      expect(messages[0].id).toMatch(/^msg-/)
    })

    it('should preserve provided message IDs', async () => {
      await memory.addMessage(createUserMessage('Hello', 'custom-id'))

      const messages = memory.getMessages()
      expect(messages[0].id).toBe('custom-id')
    })

    it('should respect maxMessages limit', async () => {
      const limitedMemory = createInMemoryAgentMemory(5)

      for (let i = 0; i < 10; i++) {
        await limitedMemory.addMessage(createUserMessage(`Message ${i}`))
      }

      const messages = limitedMemory.getMessages()
      expect(messages).toHaveLength(5)
      expect(messages[0].content).toBe('Message 5') // Should keep last 5
    })

    it('should clear messages', async () => {
      await memory.addMessage(createUserMessage('Hello'))
      await memory.addMessage(createAssistantMessage('Hi'))

      memory.clearMessages()

      expect(memory.getMessages()).toHaveLength(0)
    })

    it('should return context messages', async () => {
      await memory.addMessage(createSystemMessage('You are helpful'))
      await memory.addMessage(createUserMessage('Hello'))

      const context = memory.getContextMessages()
      expect(context).toHaveLength(2)
      expect(context[0].role).toBe('system')
    })
  })

  describe('Memory Operations', () => {
    it('should store and retrieve memories', async () => {
      const mem = await memory.remember('Important fact')

      expect(mem.id).toBeDefined()
      expect(mem.content).toBe('Important fact')
      expect(mem.type).toBe('short-term')
      expect(mem.createdAt).toBeInstanceOf(Date)
    })

    it('should store memories with custom type', async () => {
      const mem = await memory.remember('Long term fact', { type: 'long-term' })

      expect(mem.type).toBe('long-term')
    })

    it('should store memories with metadata', async () => {
      const mem = await memory.remember('Fact with metadata', {
        metadata: { source: 'user', confidence: 0.9 },
      })

      expect(mem.metadata).toEqual({ source: 'user', confidence: 0.9 })
    })

    it('should get recent memories', async () => {
      await memory.remember('Memory 1')
      await memory.remember('Memory 2')
      await memory.remember('Memory 3')

      const recent = await memory.getRecentMemories(2)
      expect(recent).toHaveLength(2)
      expect(recent[0].content).toBe('Memory 3') // Most recent first
    })

    it('should filter recent memories by type', async () => {
      await memory.remember('Short term', { type: 'short-term' })
      await memory.remember('Long term', { type: 'long-term' })
      await memory.remember('Episodic', { type: 'episodic' })

      const longTerm = await memory.getRecentMemories(10, 'long-term')
      expect(longTerm).toHaveLength(1)
      expect(longTerm[0].content).toBe('Long term')
    })

    it('should search memories by content', async () => {
      await memory.remember('The weather is sunny')
      await memory.remember('TypeScript is great')
      await memory.remember('The weather forecast')

      const results = await memory.searchMemories('weather')
      expect(results).toHaveLength(2)
      expect(results.every((m) => m.content.toLowerCase().includes('weather'))).toBe(true)
    })

    it('should search memories with type filter', async () => {
      await memory.remember('Important weather', { type: 'long-term' })
      await memory.remember('Temporary weather note', { type: 'short-term' })

      const results = await memory.searchMemories('weather', { type: 'long-term' })
      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Important weather')
    })

    it('should search memories with time filters', async () => {
      const past = new Date(Date.now() - 100000)
      const future = new Date(Date.now() + 100000)

      await memory.remember('Recent memory')

      const sinceResults = await memory.searchMemories('memory', { since: past })
      expect(sinceResults).toHaveLength(1)

      const beforeResults = await memory.searchMemories('memory', { before: past })
      expect(beforeResults).toHaveLength(0)
    })
  })

  describe('Memory CRUD Operations', () => {
    it('should get a specific memory by ID', async () => {
      const created = await memory.remember('Test memory')

      const retrieved = await memory.getMemory(created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.content).toBe('Test memory')
    })

    it('should return null for non-existent memory', async () => {
      const result = await memory.getMemory('non-existent-id')
      expect(result).toBeNull()
    })

    it('should update a memory', async () => {
      const created = await memory.remember('Original content')

      const updated = await memory.updateMemory(created.id, {
        content: 'Updated content',
        type: 'long-term',
      })

      expect(updated).not.toBeNull()
      expect(updated?.content).toBe('Updated content')
      expect(updated?.type).toBe('long-term')
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime())
    })

    it('should return null when updating non-existent memory', async () => {
      const result = await memory.updateMemory('non-existent', { content: 'New' })
      expect(result).toBeNull()
    })

    it('should delete a memory', async () => {
      const created = await memory.remember('To be deleted')

      const deleted = await memory.deleteMemory(created.id)
      expect(deleted).toBe(true)

      const retrieved = await memory.getMemory(created.id)
      expect(retrieved).toBeNull()
    })

    it('should return false when deleting non-existent memory', async () => {
      const result = await memory.deleteMemory('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('Memory Relationships', () => {
    it('should link memories with relationships', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2')

      await memory.linkMemories(mem1.id, mem2.id, 'related-to')

      const related = await memory.getRelatedMemories(mem1.id)
      expect(related).toHaveLength(1)
      expect(related[0].id).toBe(mem2.id)
    })

    it('should filter related memories by verb', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2')
      const mem3 = await memory.remember('Memory 3')

      await memory.linkMemories(mem1.id, mem2.id, 'causes')
      await memory.linkMemories(mem1.id, mem3.id, 'relates-to')

      const causes = await memory.getRelatedMemories(mem1.id, 'causes')
      expect(causes).toHaveLength(1)
      expect(causes[0].id).toBe(mem2.id)
    })

    it('should create relationships via relatedTo option', async () => {
      const mem1 = await memory.remember('Memory 1')
      const mem2 = await memory.remember('Memory 2', { relatedTo: [mem1.id] })

      const related = await memory.getRelatedMemories(mem2.id)
      expect(related).toHaveLength(1)
      expect(related[0].id).toBe(mem1.id)
    })
  })

  describe('Statistics', () => {
    it('should return memory statistics', async () => {
      await memory.remember('Short term 1', { type: 'short-term' })
      await memory.remember('Short term 2', { type: 'short-term' })
      await memory.remember('Long term', { type: 'long-term' })
      await memory.addMessage(createUserMessage('Hello'))
      await memory.addMessage(createAssistantMessage('Hi'))

      const stats = await memory.getStats()

      expect(stats.totalMemories).toBe(3)
      expect(stats.byType['short-term']).toBe(2)
      expect(stats.byType['long-term']).toBe(1)
      expect(stats.messageCount).toBe(2)
      expect(stats.oldestMemory).toBeDefined()
      expect(stats.newestMemory).toBeDefined()
    })

    it('should return empty stats for fresh memory', async () => {
      const stats = await memory.getStats()

      expect(stats.totalMemories).toBe(0)
      expect(stats.messageCount).toBe(0)
      expect(stats.oldestMemory).toBeUndefined()
    })
  })
})

// ============================================================================
// ConversationMemoryAdapter Tests
// ============================================================================

describe('ConversationMemoryAdapter', () => {
  let memory: AgentMemory
  let conversationMemory: ReturnType<typeof toConversationMemory>

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
    conversationMemory = toConversationMemory(memory, 'test-conversation')
  })

  it('should provide conversation ID', () => {
    expect(conversationMemory.getConversationId()).toBe('test-conversation')
  })

  it('should add messages (sync interface)', async () => {
    conversationMemory.addMessage(createUserMessage('Hello'))

    // Wait for async write
    await new Promise((resolve) => setTimeout(resolve, 10))

    const messages = conversationMemory.getMessages()
    expect(messages.length).toBeGreaterThanOrEqual(1)
  })

  it('should add multiple messages', async () => {
    conversationMemory.addMessages([
      createUserMessage('Hello'),
      createAssistantMessage('Hi'),
    ])

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(conversationMemory.getMessages().length).toBeGreaterThanOrEqual(2)
  })

  it('should get last message', async () => {
    await memory.addMessage(createUserMessage('First'))
    await memory.addMessage(createAssistantMessage('Last'))

    const last = conversationMemory.getLastMessage()
    expect(last?.content).toBe('Last')
  })

  it('should get message by ID', async () => {
    await memory.addMessage(createUserMessage('Find me', 'findable'))

    const found = conversationMemory.getMessageById('findable')
    expect(found?.content).toBe('Find me')
  })

  it('should clear messages', async () => {
    await memory.addMessage(createUserMessage('Hello'))

    conversationMemory.clear()

    expect(conversationMemory.getMessages()).toHaveLength(0)
  })

  it('should estimate token count', async () => {
    await memory.addMessage(createUserMessage('Hello world'))
    await memory.addMessage(createAssistantMessage('Hi there'))

    const count = await conversationMemory.getTokenCount()
    expect(count).toBeGreaterThan(0)
  })

  it('should export and import state', async () => {
    await memory.addMessage(createUserMessage('Hello'))
    await memory.addMessage(createAssistantMessage('Hi'))

    const state = conversationMemory.exportState()
    expect(state.id).toBe('test-conversation')
    expect(state.messages).toHaveLength(2)

    // Create new adapter and import
    const newMemory = createInMemoryAgentMemory()
    const newAdapter = toConversationMemory(newMemory, 'new-conv')
    newAdapter.importState(state)

    expect(newAdapter.getConversationId()).toBe('test-conversation')
  })
})

// ============================================================================
// AgentMemoryBridge Tests
// ============================================================================

describe('AgentMemoryBridge', () => {
  let memory: AgentMemory
  let bridge: ReturnType<typeof toAgentMemoryBridge>

  beforeEach(() => {
    memory = createInMemoryAgentMemory()
    bridge = toAgentMemoryBridge(memory)
  })

  it('should remember with default type', async () => {
    const mem = await bridge.remember('Test memory')

    expect(mem.content).toBe('Test memory')
    expect(mem.type).toBe('short-term')
  })

  it('should remember with custom type', async () => {
    const mem = await bridge.remember('Long term memory', 'long-term')

    expect(mem.type).toBe('long-term')
  })

  it('should get recent memories', async () => {
    await bridge.remember('Memory 1')
    await bridge.remember('Memory 2')
    await bridge.remember('Memory 3')

    const recent = await bridge.getRecentMemories(2)
    expect(recent).toHaveLength(2)
  })

  it('should search memories', async () => {
    await bridge.remember('TypeScript is typed')
    await bridge.remember('JavaScript is dynamic')
    await bridge.remember('TypeScript compiles to JavaScript')

    const results = await bridge.searchMemories('TypeScript')
    expect(results).toHaveLength(2)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Unified Memory Integration', () => {
  it('should maintain consistency across adapters', async () => {
    const memory = createInMemoryAgentMemory()
    const conversationAdapter = toConversationMemory(memory)
    const agentBridge = toAgentMemoryBridge(memory)

    // Add message via conversation adapter
    await memory.addMessage(createUserMessage('Hello'))

    // Remember via agent bridge
    await agentBridge.remember('Important fact')

    // Both should see messages
    expect(memory.getMessages()).toHaveLength(1)
    expect(conversationAdapter.getMessages()).toHaveLength(1)

    // Stats should reflect both
    const stats = await memory.getStats()
    expect(stats.messageCount).toBe(1)
    expect(stats.totalMemories).toBe(1)
  })

  it('should support mixed message and memory operations', async () => {
    const memory = createInMemoryAgentMemory()

    // Interleave messages and memories
    await memory.addMessage(createUserMessage('What is the weather?'))
    await memory.remember('User asked about weather', { type: 'episodic' })
    await memory.addMessage(createAssistantMessage('It is sunny'))
    await memory.remember('Weather is sunny', { type: 'semantic' })

    const stats = await memory.getStats()
    expect(stats.messageCount).toBe(2)
    expect(stats.totalMemories).toBe(2)
    expect(stats.byType['episodic']).toBe(1)
    expect(stats.byType['semantic']).toBe(1)
  })

  it('should preserve message order', async () => {
    const memory = createInMemoryAgentMemory()

    const conversation = [
      createUserMessage('Hello', 'msg-1'),
      createAssistantMessage('Hi!', 'msg-2'),
      createUserMessage('How are you?', 'msg-3'),
      createAssistantMessage('Great!', 'msg-4'),
    ]

    for (const msg of conversation) {
      await memory.addMessage(msg)
    }

    const messages = memory.getMessages()
    expect(messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4'])
  })

  it('should handle empty states gracefully', async () => {
    const memory = createInMemoryAgentMemory()

    expect(memory.getMessages()).toHaveLength(0)
    expect(memory.getContextMessages()).toHaveLength(0)
    expect(await memory.getRecentMemories()).toHaveLength(0)
    expect(await memory.searchMemories('anything')).toHaveLength(0)
    expect(await memory.getMemory('non-existent')).toBeNull()

    const stats = await memory.getStats()
    expect(stats.totalMemories).toBe(0)
    expect(stats.messageCount).toBe(0)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle special characters in content', async () => {
    const memory = createInMemoryAgentMemory()

    const specialContent = 'Test with "quotes" and \'apostrophes\' and \n newlines'
    const mem = await memory.remember(specialContent)

    const retrieved = await memory.getMemory(mem.id)
    expect(retrieved?.content).toBe(specialContent)
  })

  it('should handle empty content', async () => {
    const memory = createInMemoryAgentMemory()

    const mem = await memory.remember('')

    expect(mem.content).toBe('')
    expect(await memory.getMemory(mem.id)).not.toBeNull()
  })

  it('should handle unicode content', async () => {
    const memory = createInMemoryAgentMemory()

    const unicodeContent = 'Hello \u{1F44B} World \u{1F30D} Test \u{2764}'
    await memory.addMessage(createUserMessage(unicodeContent))

    const messages = memory.getMessages()
    expect(messages[0].content).toBe(unicodeContent)
  })

  it('should handle large content', async () => {
    const memory = createInMemoryAgentMemory()

    const largeContent = 'x'.repeat(100000)
    const mem = await memory.remember(largeContent)

    expect(mem.content.length).toBe(100000)
  })

  it('should handle rapid sequential operations', async () => {
    const memory = createInMemoryAgentMemory()

    // Add many messages rapidly
    const promises = Array.from({ length: 100 }, (_, i) =>
      memory.addMessage(createUserMessage(`Message ${i}`))
    )

    await Promise.all(promises)

    expect(memory.getMessages().length).toBe(100)
  })

  it('should handle concurrent read/write', async () => {
    const memory = createInMemoryAgentMemory()

    // Concurrent operations
    const operations = [
      memory.addMessage(createUserMessage('Message 1')),
      memory.remember('Memory 1'),
      memory.addMessage(createUserMessage('Message 2')),
      memory.remember('Memory 2'),
      memory.getStats(),
    ]

    const results = await Promise.all(operations)

    // Should complete without errors
    expect(results[4]).toBeDefined() // Stats result
  })
})

// ============================================================================
// Backwards Compatibility
// ============================================================================

describe('Backwards Compatibility', () => {
  describe('Agent.ts Memory API', () => {
    it('should match Agent.ts remember signature', async () => {
      const memory = createInMemoryAgentMemory()
      const bridge = toAgentMemoryBridge(memory)

      // Agent.ts: remember(content: string, type?: MemoryType): Promise<Memory>
      const mem = await bridge.remember('Test', 'long-term')

      expect(mem.id).toBeDefined()
      expect(mem.content).toBe('Test')
      expect(mem.type).toBe('long-term')
      expect(mem.createdAt).toBeInstanceOf(Date)
    })

    it('should match Agent.ts getRecentMemories signature', async () => {
      const memory = createInMemoryAgentMemory()
      const bridge = toAgentMemoryBridge(memory)

      await bridge.remember('Mem 1')
      await bridge.remember('Mem 2')

      // Agent.ts: getRecentMemories(limit?: number): Promise<Memory[]>
      const recent = await bridge.getRecentMemories(1)

      expect(recent).toHaveLength(1)
      expect(recent[0].content).toBe('Mem 2')
    })

    it('should match Agent.ts searchMemories signature', async () => {
      const memory = createInMemoryAgentMemory()
      const bridge = toAgentMemoryBridge(memory)

      await bridge.remember('TypeScript code')
      await bridge.remember('Python code')

      // Agent.ts: searchMemories(query: string): Promise<Memory[]>
      const results = await bridge.searchMemories('TypeScript')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('TypeScript code')
    })
  })

  describe('ConversationMemory API', () => {
    it('should match ConversationMemory interface', async () => {
      const memory = createInMemoryAgentMemory()
      const adapter = toConversationMemory(memory)

      // Core methods
      expect(typeof adapter.getConversationId).toBe('function')
      expect(typeof adapter.addMessage).toBe('function')
      expect(typeof adapter.addMessages).toBe('function')
      expect(typeof adapter.getMessages).toBe('function')
      expect(typeof adapter.getContextMessages).toBe('function')
      expect(typeof adapter.clear).toBe('function')
      expect(typeof adapter.getLastMessage).toBe('function')
      expect(typeof adapter.getMessageById).toBe('function')
      expect(typeof adapter.truncate).toBe('function')
      expect(typeof adapter.getTokenCount).toBe('function')
      expect(typeof adapter.exportState).toBe('function')
      expect(typeof adapter.importState).toBe('function')
    })
  })
})
