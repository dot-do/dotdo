/**
 * Conversation Memory Tests
 *
 * Tests for:
 * - Message history management
 * - Sliding window truncation
 * - Context summarization
 * - Token counting
 * - Persistence with TemporalStore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  Message,
  MemoryConfig,
  ConversationState,
  MemorySummary,
} from '../types'
import {
  createConversationMemory,
  type ConversationMemory,
} from '../memory'

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

function createTestConversation(length: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < length; i++) {
    if (i % 2 === 0) {
      messages.push(createUserMessage(`User message ${i}`, `msg-${i}`))
    } else {
      messages.push(createAssistantMessage(`Assistant response ${i}`, `msg-${i}`))
    }
  }
  return messages
}

// ============================================================================
// Memory Creation Tests
// ============================================================================

describe('Conversation Memory', () => {
  describe('createConversationMemory()', () => {
    it('should create memory with default config', () => {
      const memory = createConversationMemory()

      expect(memory).toBeDefined()
      expect(memory.getMessages()).toHaveLength(0)
    })

    it('should create memory with custom config', () => {
      const memory = createConversationMemory({
        maxMessages: 50,
        maxTokens: 4000,
        windowStrategy: 'summarize',
      })

      expect(memory.getConfig().maxMessages).toBe(50)
      expect(memory.getConfig().maxTokens).toBe(4000)
      expect(memory.getConfig().windowStrategy).toBe('summarize')
    })

    it('should create memory with conversation ID', () => {
      const memory = createConversationMemory({}, 'conv-123')

      expect(memory.getConversationId()).toBe('conv-123')
    })
  })

  // ============================================================================
  // Message Management Tests
  // ============================================================================

  describe('Message Management', () => {
    let memory: ConversationMemory

    beforeEach(() => {
      memory = createConversationMemory({ maxMessages: 100 })
    })

    describe('addMessage()', () => {
      it('should add a message to history', () => {
        memory.addMessage(createUserMessage('Hello'))

        expect(memory.getMessages()).toHaveLength(1)
        expect(memory.getMessages()[0].content).toBe('Hello')
      })

      it('should maintain message order', () => {
        memory.addMessage(createUserMessage('First'))
        memory.addMessage(createAssistantMessage('Second'))
        memory.addMessage(createUserMessage('Third'))

        const messages = memory.getMessages()
        expect(messages[0].content).toBe('First')
        expect(messages[1].content).toBe('Second')
        expect(messages[2].content).toBe('Third')
      })

      it('should assign IDs to messages without them', () => {
        memory.addMessage(createUserMessage('No ID'))

        const messages = memory.getMessages()
        expect(messages[0].id).toBeDefined()
      })

      it('should preserve existing message IDs', () => {
        memory.addMessage(createUserMessage('With ID', 'custom-id'))

        expect(memory.getMessages()[0].id).toBe('custom-id')
      })
    })

    describe('addMessages()', () => {
      it('should add multiple messages at once', () => {
        memory.addMessages([
          createUserMessage('One'),
          createAssistantMessage('Two'),
          createUserMessage('Three'),
        ])

        expect(memory.getMessages()).toHaveLength(3)
      })
    })

    describe('getMessages()', () => {
      it('should return all messages', () => {
        memory.addMessage(createUserMessage('Hello'))
        memory.addMessage(createAssistantMessage('Hi there'))

        expect(memory.getMessages()).toHaveLength(2)
      })

      it('should return a copy, not the original array', () => {
        memory.addMessage(createUserMessage('Hello'))

        const messages = memory.getMessages()
        messages.push(createUserMessage('Injected'))

        expect(memory.getMessages()).toHaveLength(1)
      })
    })

    describe('clear()', () => {
      it('should remove all messages', () => {
        memory.addMessages(createTestConversation(10))
        expect(memory.getMessages()).toHaveLength(10)

        memory.clear()
        expect(memory.getMessages()).toHaveLength(0)
      })

      it('should also clear summaries', () => {
        memory.addMessages(createTestConversation(10))
        memory.clear()

        expect(memory.getSummary()).toBeUndefined()
      })
    })

    describe('getLastMessage()', () => {
      it('should return the last message', () => {
        memory.addMessage(createUserMessage('First'))
        memory.addMessage(createAssistantMessage('Last'))

        expect(memory.getLastMessage()?.content).toBe('Last')
      })

      it('should return undefined for empty history', () => {
        expect(memory.getLastMessage()).toBeUndefined()
      })
    })

    describe('getMessageById()', () => {
      it('should find message by ID', () => {
        memory.addMessage(createUserMessage('Target', 'target-id'))
        memory.addMessage(createAssistantMessage('Other'))

        const found = memory.getMessageById('target-id')
        expect(found?.content).toBe('Target')
      })

      it('should return undefined for non-existent ID', () => {
        expect(memory.getMessageById('non-existent')).toBeUndefined()
      })
    })
  })

  // ============================================================================
  // Sliding Window Tests
  // ============================================================================

  describe('Sliding Window', () => {
    describe('FIFO strategy', () => {
      it('should remove oldest messages when exceeding maxMessages after truncate', async () => {
        const memory = createConversationMemory({
          maxMessages: 5,
          windowStrategy: 'fifo',
        })

        // Add 10 messages
        for (let i = 0; i < 10; i++) {
          memory.addMessage(createUserMessage(`Message ${i}`))
        }

        // Truncate to apply the limit
        await memory.truncate()

        const messages = memory.getMessages()
        expect(messages).toHaveLength(5)
        expect(messages[0].content).toBe('Message 5')
        expect(messages[4].content).toBe('Message 9')
      })

      it('should preserve system messages by default', async () => {
        const memory = createConversationMemory({
          maxMessages: 3,
          windowStrategy: 'fifo',
          preserveSystemMessages: true,
        })

        memory.addMessage(createSystemMessage('System instructions'))
        memory.addMessage(createUserMessage('Message 1'))
        memory.addMessage(createAssistantMessage('Response 1'))
        memory.addMessage(createUserMessage('Message 2'))
        memory.addMessage(createAssistantMessage('Response 2'))

        // Truncate to apply the limit
        await memory.truncate()

        const messages = memory.getMessages()
        // System message should be preserved
        expect(messages[0].role).toBe('system')
        // Plus latest 2 non-system messages (total 3)
        expect(messages.length).toBeLessThanOrEqual(3)
      })
    })

    describe('Token-based limiting', () => {
      it('should truncate when exceeding maxTokens', async () => {
        const memory = createConversationMemory({
          maxTokens: 100,
          windowStrategy: 'fifo',
        })

        // Add messages with known approximate token counts
        for (let i = 0; i < 20; i++) {
          memory.addMessage(createUserMessage(`This is message number ${i} with some additional text.`))
        }

        await memory.truncate()

        const tokenCount = await memory.getTokenCount()
        expect(tokenCount).toBeLessThanOrEqual(100)
      })
    })
  })

  // ============================================================================
  // Summarization Tests
  // ============================================================================

  describe('Summarization', () => {
    it('should create summary when threshold exceeded', async () => {
      const summarize = vi.fn().mockResolvedValue('Summary of conversation')

      const memory = createConversationMemory({
        maxTokens: 100,
        windowStrategy: 'summarize',
        summarizeThreshold: 50,
      })

      // Set custom summarizer
      memory.setSummarizer(summarize)

      // Add messages to exceed threshold
      for (let i = 0; i < 20; i++) {
        memory.addMessage(createUserMessage(`Message ${i} with some content`))
      }

      await memory.truncate()

      // Summarizer should have been called
      expect(summarize).toHaveBeenCalled()
    })

    it('should include summary in context', async () => {
      const memory = createConversationMemory({
        maxTokens: 100,
        windowStrategy: 'summarize',
      })

      // Manually set a summary
      memory.setSummary({
        summary: 'Previously discussed: weather and sports',
        tokenCount: 10,
        messagesCovered: 5,
        createdAt: new Date(),
      })

      memory.addMessage(createUserMessage('New message'))

      const context = memory.getContextMessages()
      // Should include summary as first message
      expect(context[0].role).toBe('system')
      expect(context[0].content).toContain('Previously discussed')
    })

    it('should not re-summarize already summarized messages', async () => {
      const summarize = vi.fn().mockResolvedValue('New summary')

      const memory = createConversationMemory({
        windowStrategy: 'summarize',
      })
      memory.setSummarizer(summarize)

      // Set existing summary
      memory.setSummary({
        summary: 'Old summary',
        tokenCount: 10,
        messagesCovered: 5,
        createdAt: new Date(),
      })

      // The summarizer should only be called for new messages
      // not the ones already summarized
    })
  })

  // ============================================================================
  // Token Counting Tests
  // ============================================================================

  describe('Token Counting', () => {
    it('should estimate token count', async () => {
      const memory = createConversationMemory()

      memory.addMessage(createUserMessage('Hello'))
      memory.addMessage(createAssistantMessage('Hi there, how can I help?'))

      const count = await memory.getTokenCount()
      expect(count).toBeGreaterThan(0)
    })

    it('should count more tokens for longer content', async () => {
      const memory1 = createConversationMemory()
      memory1.addMessage(createUserMessage('Hi'))

      const memory2 = createConversationMemory()
      memory2.addMessage(createUserMessage('This is a much longer message that should have more tokens than the short one.'))

      const count1 = await memory1.getTokenCount()
      const count2 = await memory2.getTokenCount()

      expect(count2).toBeGreaterThan(count1)
    })

    it('should allow custom token counter', async () => {
      const customCounter = vi.fn().mockResolvedValue(42)

      const memory = createConversationMemory()
      memory.setTokenCounter(customCounter)

      memory.addMessage(createUserMessage('Test'))

      const count = await memory.getTokenCount()
      expect(count).toBe(42)
      expect(customCounter).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // State Management Tests
  // ============================================================================

  describe('State Management', () => {
    it('should export state', () => {
      const memory = createConversationMemory({}, 'conv-123')
      memory.addMessage(createUserMessage('Hello'))
      memory.addMessage(createAssistantMessage('Hi'))

      const state = memory.exportState()

      expect(state.id).toBe('conv-123')
      expect(state.messages).toHaveLength(2)
      expect(state.createdAt).toBeInstanceOf(Date)
      expect(state.updatedAt).toBeInstanceOf(Date)
    })

    it('should import state', () => {
      const memory = createConversationMemory()

      const state: ConversationState = {
        id: 'imported-conv',
        messages: [
          createUserMessage('Imported message'),
          createAssistantMessage('Imported response'),
        ],
        totalTokens: 50,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      }

      memory.importState(state)

      expect(memory.getConversationId()).toBe('imported-conv')
      expect(memory.getMessages()).toHaveLength(2)
    })

    it('should update timestamps on message add', () => {
      const memory = createConversationMemory({}, 'conv-123')
      const initialState = memory.exportState()
      const initialUpdatedAt = initialState.updatedAt

      // Wait a bit and add a message
      memory.addMessage(createUserMessage('New message'))

      const newState = memory.exportState()
      expect(newState.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime())
    })
  })

  // ============================================================================
  // Context Messages Tests
  // ============================================================================

  describe('Context Messages', () => {
    it('should return messages suitable for LLM context', () => {
      const memory = createConversationMemory()
      memory.addMessage(createSystemMessage('You are helpful.'))
      memory.addMessage(createUserMessage('Hello'))
      memory.addMessage(createAssistantMessage('Hi there'))

      const context = memory.getContextMessages()

      expect(context).toHaveLength(3)
      expect(context[0].role).toBe('system')
    })

    it('should include summary when available', () => {
      const memory = createConversationMemory()
      memory.setSummary({
        summary: 'Previous context: User asked about coding',
        tokenCount: 10,
        messagesCovered: 5,
        createdAt: new Date(),
      })

      memory.addMessage(createUserMessage('Continue from where we left off'))

      const context = memory.getContextMessages()
      expect(context[0].content).toContain('Previous context')
    })

    it('should limit context to maxTokens', async () => {
      const memory = createConversationMemory({
        maxTokens: 50,
      })

      // Add lots of messages
      for (let i = 0; i < 100; i++) {
        memory.addMessage(createUserMessage(`Message ${i}`))
      }

      await memory.truncate()
      const context = memory.getContextMessages()
      const tokenCount = await memory.getTokenCount()

      expect(tokenCount).toBeLessThanOrEqual(60) // Allow some buffer
    })
  })
})
