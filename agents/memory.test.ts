/**
 * Conversation Memory Tests
 *
 * Tests for:
 * - Sliding window truncation (FIFO)
 * - Automatic summarization
 * - Token counting and management
 * - Memory persistence (export/import)
 * - Agent memory integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Message, AgentResult } from './types'
import {
  createConversationMemory,
  withMemory,
  createLLMSummarizer,
  createTiktokenCounter,
  createAPITokenCounter,
  type ConversationMemory,
  type ConversationMemoryConfig,
  type MemorySummary,
} from './memory'
import { createMockProvider } from './testing'

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

function createConversation(length: number): Message[] {
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
// createConversationMemory() Tests
// ============================================================================

describe('createConversationMemory()', () => {
  it('should create memory with default config', () => {
    const memory = createConversationMemory()

    expect(memory).toBeDefined()
    expect(memory.getMessages()).toHaveLength(0)
    expect(memory.getConversationId()).toBeDefined()
  })

  it('should create memory with custom config', () => {
    const memory = createConversationMemory({
      maxMessages: 50,
      maxTokens: 4000,
      windowStrategy: 'summarize',
      summarizeThreshold: 2000,
    })

    const config = memory.getConfig()
    expect(config.maxMessages).toBe(50)
    expect(config.maxTokens).toBe(4000)
    expect(config.windowStrategy).toBe('summarize')
    expect(config.summarizeThreshold).toBe(2000)
  })

  it('should use provided conversation ID', () => {
    const memory = createConversationMemory({ conversationId: 'test-conv-123' })

    expect(memory.getConversationId()).toBe('test-conv-123')
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

      expect(memory.getMessages()[0].id).toBeDefined()
      expect(memory.getMessages()[0].id).toMatch(/^msg-/)
    })

    it('should preserve existing message IDs', () => {
      memory.addMessage(createUserMessage('With ID', 'custom-id-123'))

      expect(memory.getMessages()[0].id).toBe('custom-id-123')
    })

    it('should assign createdAt timestamp', () => {
      const before = new Date()
      memory.addMessage(createUserMessage('Test'))
      const after = new Date()

      const msg = memory.getMessages()[0]
      expect(msg.createdAt).toBeInstanceOf(Date)
      expect(msg.createdAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(msg.createdAt!.getTime()).toBeLessThanOrEqual(after.getTime())
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
    it('should return a copy, not the original array', () => {
      memory.addMessage(createUserMessage('Original'))

      const messages = memory.getMessages()
      messages.push(createUserMessage('Injected'))

      expect(memory.getMessages()).toHaveLength(1)
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

  describe('clear()', () => {
    it('should remove all messages', () => {
      memory.addMessages(createConversation(10))
      expect(memory.getMessages()).toHaveLength(10)

      memory.clear()
      expect(memory.getMessages()).toHaveLength(0)
    })

    it('should also clear summaries', () => {
      memory.setSummary({
        summary: 'Test summary',
        tokenCount: 10,
        messagesCovered: 5,
        createdAt: new Date(),
      })
      memory.clear()

      expect(memory.getSummary()).toBeUndefined()
    })
  })
})

// ============================================================================
// Sliding Window (FIFO) Tests
// ============================================================================

describe('Sliding Window (FIFO)', () => {
  describe('Message count limiting', () => {
    it('should truncate to maxMessages', async () => {
      const memory = createConversationMemory({
        maxMessages: 5,
        windowStrategy: 'fifo',
      })

      // Add 10 messages
      for (let i = 0; i < 10; i++) {
        memory.addMessage(createUserMessage(`Message ${i}`))
      }

      await memory.truncate()

      const messages = memory.getMessages()
      expect(messages).toHaveLength(5)
      // Should keep the most recent 5
      expect(messages[0].content).toBe('Message 5')
      expect(messages[4].content).toBe('Message 9')
    })

    it('should preserve system messages by default', async () => {
      const memory = createConversationMemory({
        maxMessages: 3,
        windowStrategy: 'fifo',
        preserveSystemMessages: true,
      })

      memory.addMessage(createSystemMessage('You are a helpful assistant'))
      memory.addMessage(createUserMessage('Message 1'))
      memory.addMessage(createAssistantMessage('Response 1'))
      memory.addMessage(createUserMessage('Message 2'))
      memory.addMessage(createAssistantMessage('Response 2'))

      await memory.truncate()

      const messages = memory.getMessages()
      // System message should be preserved
      expect(messages[0].role).toBe('system')
      expect(messages.length).toBeLessThanOrEqual(3)
    })

    it('should not preserve system messages when disabled', async () => {
      const memory = createConversationMemory({
        maxMessages: 2,
        windowStrategy: 'fifo',
        preserveSystemMessages: false,
      })

      memory.addMessage(createSystemMessage('System'))
      memory.addMessage(createUserMessage('User 1'))
      memory.addMessage(createAssistantMessage('Assistant 1'))
      memory.addMessage(createUserMessage('User 2'))

      await memory.truncate()

      const messages = memory.getMessages()
      expect(messages).toHaveLength(2)
      // Should just keep the last 2 regardless of role
      expect(messages[0].content).toBe('Assistant 1')
      expect(messages[1].content).toBe('User 2')
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
        memory.addMessage(
          createUserMessage(`This is message number ${i} with some additional text to increase tokens.`)
        )
      }

      await memory.truncate()

      const tokenCount = await memory.getTokenCount()
      expect(tokenCount).toBeLessThanOrEqual(100)
    })

    it('should keep at least one message even if over limit', async () => {
      const memory = createConversationMemory({
        maxTokens: 1, // Very low limit
        windowStrategy: 'fifo',
      })

      memory.addMessage(createUserMessage('This is a long message that exceeds the token limit'))

      await memory.truncate()

      // Should keep at least 1 message
      expect(memory.getMessages().length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ============================================================================
// Summarization Tests
// ============================================================================

describe('Summarization', () => {
  it('should create summary when threshold exceeded', async () => {
    const summarize = vi.fn().mockResolvedValue('Summary of the conversation')

    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50, // Low threshold to trigger summarization
      maxTokens: 200,
    })
    memory.setSummarizer(summarize)

    // Add enough messages to exceed threshold
    for (let i = 0; i < 20; i++) {
      memory.addMessage(createUserMessage(`Message ${i} with some content to add tokens`))
    }

    await memory.truncate()

    expect(summarize).toHaveBeenCalled()
    expect(memory.getSummary()).toBeDefined()
    expect(memory.getSummary()?.summary).toBe('Summary of the conversation')
  })

  it('should include summary in context messages', () => {
    const memory = createConversationMemory()

    memory.setSummary({
      summary: 'Previously: User asked about weather and coding',
      tokenCount: 15,
      messagesCovered: 10,
      createdAt: new Date(),
    })

    memory.addMessage(createUserMessage('Continue from where we left off'))

    const context = memory.getContextMessages()
    // Summary should be first as a system message
    expect(context[0].role).toBe('system')
    expect(context[0].content).toContain('Previously:')
    expect(context[0].id).toBe('memory-summary')
    // User message should follow
    expect(context[1].content).toBe('Continue from where we left off')
  })

  it('should track messages covered by summary', async () => {
    const summarize = vi.fn().mockResolvedValue('Summary')

    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })
    memory.setSummarizer(summarize)

    // Add messages
    for (let i = 0; i < 30; i++) {
      memory.addMessage(createUserMessage(`Message ${i} with content`))
    }

    await memory.truncate()

    const summary = memory.getSummary()
    expect(summary?.messagesCovered).toBeGreaterThan(0)
  })

  it('should combine new summary with existing summary', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })

    // Set existing summary
    memory.setSummary({
      summary: 'Original summary',
      tokenCount: 5,
      messagesCovered: 5,
      createdAt: new Date(),
    })

    memory.setSummarizer(vi.fn().mockResolvedValue('New summary'))

    // Add more messages
    for (let i = 0; i < 30; i++) {
      memory.addMessage(createUserMessage(`Message ${i} with content`))
    }

    await memory.truncate()

    const summary = memory.getSummary()
    expect(summary?.summary).toContain('Original summary')
    expect(summary?.summary).toContain('New summary')
  })

  it('should fall back to FIFO when no summarizer is set', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      maxMessages: 5,
      summarizeThreshold: 10,
    })

    // Don't set a summarizer - default will be used
    for (let i = 0; i < 20; i++) {
      memory.addMessage(createUserMessage(`Message ${i}`))
    }

    await memory.truncate()

    // Should still limit messages
    expect(memory.getMessages().length).toBeLessThanOrEqual(10)
  })
})

// ============================================================================
// Token Counting Tests
// ============================================================================

describe('Token Counting', () => {
  it('should estimate token count with default counter', async () => {
    const memory = createConversationMemory()

    memory.addMessage(createUserMessage('Hello'))
    memory.addMessage(createAssistantMessage('Hi there, how can I help you today?'))

    const count = await memory.getTokenCount()
    expect(count).toBeGreaterThan(0)
  })

  it('should count more tokens for longer content', async () => {
    const memory1 = createConversationMemory()
    memory1.addMessage(createUserMessage('Hi'))

    const memory2 = createConversationMemory()
    memory2.addMessage(
      createUserMessage(
        'This is a much longer message that should definitely have more tokens than the short one above.'
      )
    )

    const count1 = await memory1.getTokenCount()
    const count2 = await memory2.getTokenCount()

    expect(count2).toBeGreaterThan(count1)
  })

  it('should use custom token counter', async () => {
    const customCounter = vi.fn().mockReturnValue(42)

    const memory = createConversationMemory()
    memory.setTokenCounter(customCounter)
    memory.addMessage(createUserMessage('Test'))

    const count = await memory.getTokenCount()
    expect(count).toBe(42)
    expect(customCounter).toHaveBeenCalled()
  })

  it('should count tool calls in assistant messages', async () => {
    const memory = createConversationMemory()

    const assistantWithTools: Message = {
      role: 'assistant',
      content: 'Let me help',
      toolCalls: [
        {
          id: 'call-1',
          name: 'search',
          arguments: { query: 'test query' },
        },
      ],
    }

    memory.addMessage(assistantWithTools)

    const count = await memory.getTokenCount()
    expect(count).toBeGreaterThan(10) // Should include tool call overhead
  })
})

// ============================================================================
// State Management Tests
// ============================================================================

describe('State Management', () => {
  describe('exportState()', () => {
    it('should export complete state', () => {
      const memory = createConversationMemory({ conversationId: 'test-export' })

      memory.addMessage(createUserMessage('Hello'))
      memory.addMessage(createAssistantMessage('Hi'))
      memory.setSummary({
        summary: 'Test summary',
        tokenCount: 5,
        messagesCovered: 2,
        createdAt: new Date(),
      })

      const state = memory.exportState()

      expect(state.id).toBe('test-export')
      expect(state.messages).toHaveLength(2)
      expect(state.summary).toBe('Test summary')
      expect(state.createdAt).toBeInstanceOf(Date)
      expect(state.updatedAt).toBeInstanceOf(Date)
    })

    it('should export state without summary', () => {
      const memory = createConversationMemory()
      memory.addMessage(createUserMessage('Test'))

      const state = memory.exportState()

      expect(state.summary).toBeUndefined()
    })
  })

  describe('importState()', () => {
    it('should import complete state', () => {
      const memory = createConversationMemory()

      const state = {
        id: 'imported-conv',
        messages: [createUserMessage('Imported message'), createAssistantMessage('Imported response')],
        summary: 'Imported summary',
        summaryMessagesCovered: 5,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      }

      memory.importState(state)

      expect(memory.getConversationId()).toBe('imported-conv')
      expect(memory.getMessages()).toHaveLength(2)
      expect(memory.getSummary()?.summary).toBe('Imported summary')
      expect(memory.getSummary()?.messagesCovered).toBe(5)
    })

    it('should import state without summary', () => {
      const memory = createConversationMemory()

      const state = {
        id: 'no-summary',
        messages: [createUserMessage('Test')],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      memory.importState(state)

      expect(memory.getSummary()).toBeUndefined()
    })

    it('should support round-trip export/import', () => {
      const original = createConversationMemory({ conversationId: 'round-trip' })
      original.addMessages(createConversation(5))
      original.setSummary({
        summary: 'Test',
        tokenCount: 5,
        messagesCovered: 3,
        createdAt: new Date(),
      })

      const state = original.exportState()

      const restored = createConversationMemory()
      restored.importState(state)

      expect(restored.getConversationId()).toBe(original.getConversationId())
      expect(restored.getMessages().length).toBe(original.getMessages().length)
      expect(restored.getSummary()?.summary).toBe(original.getSummary()?.summary)
    })
  })
})

// ============================================================================
// Agent Memory Integration Tests
// ============================================================================

describe('Agent Memory Integration', () => {
  describe('withMemory()', () => {
    it('should wrap agent with memory capabilities', () => {
      const provider = createMockProvider({
        responses: [{ text: 'Test response' }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'You are helpful',
        model: 'mock-model',
      })

      const memory = createConversationMemory()
      const agentWithMemory = withMemory(agent, memory)

      expect(agentWithMemory.getMemory).toBeDefined()
      expect(agentWithMemory.runWithMemory).toBeDefined()
      expect(agentWithMemory.getMemory()).toBe(memory)
    })

    it('should include memory context in runWithMemory', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Hello! I remember you mentioned coding.' }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: '',
        model: 'mock-model',
      })

      const memory = createConversationMemory()
      memory.addMessage(createUserMessage('I love coding'))
      memory.addMessage(createAssistantMessage('Great! What languages do you use?'))

      const agentWithMemory = withMemory(agent, memory)

      const result = await agentWithMemory.runWithMemory({
        prompt: 'What did I say I loved?',
      })

      expect(result.text).toBeDefined()
      // Memory should now include the new exchange
      const messages = memory.getMessages()
      expect(messages.length).toBeGreaterThan(2)
    })

    it('should save responses to memory after runWithMemory', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'The capital of France is Paris.' }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: '',
        model: 'mock-model',
      })

      const memory = createConversationMemory()
      const agentWithMemory = withMemory(agent, memory)

      await agentWithMemory.runWithMemory({
        prompt: 'What is the capital of France?',
      })

      const messages = memory.getMessages()
      expect(messages.some((m) => m.role === 'user' && m.content === 'What is the capital of France?')).toBe(
        true
      )
      expect(messages.some((m) => m.role === 'assistant')).toBe(true)
    })

    it('should truncate before adding new messages', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Response' }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: '',
        model: 'mock-model',
      })

      const memory = createConversationMemory({
        maxMessages: 5,
      })

      // Pre-fill memory
      for (let i = 0; i < 10; i++) {
        memory.addMessage(createUserMessage(`Old message ${i}`))
      }

      const agentWithMemory = withMemory(agent, memory)
      await agentWithMemory.runWithMemory({ prompt: 'New message' })

      // Should have truncated to 5, then added new exchange
      expect(memory.getMessages().length).toBeLessThanOrEqual(7)
    })

    it('should preserve original agent run method', async () => {
      const provider = createMockProvider({
        responses: [{ text: 'Direct response' }],
      })
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: '',
        model: 'mock-model',
      })

      const memory = createConversationMemory()
      const agentWithMemory = withMemory(agent, memory)

      // Original run should still work without memory
      const result = await agentWithMemory.run({
        prompt: 'Test',
      })

      expect(result.text).toBe('Direct response')
      // Memory should not be affected by regular run
      expect(memory.getMessages()).toHaveLength(0)
    })
  })
})

// ============================================================================
// LLM Summarizer Tests
// ============================================================================

describe('createLLMSummarizer()', () => {
  it('should create summarizer function', () => {
    const provider = createMockProvider({
      responses: [{ text: 'This is a summary' }],
    })
    const agent = provider.createAgent({
      id: 'summarizer',
      name: 'Summarizer',
      instructions: '',
      model: 'mock-model',
    })

    const summarizer = createLLMSummarizer(agent)

    expect(typeof summarizer).toBe('function')
  })

  it('should call agent with messages to summarize', async () => {
    const provider = createMockProvider({
      responses: [{ text: 'Summary: User discussed weather and travel plans.' }],
    })
    const agent = provider.createAgent({
      id: 'summarizer',
      name: 'Summarizer',
      instructions: '',
      model: 'mock-model',
    })

    const summarizer = createLLMSummarizer(agent)

    const messages: Message[] = [
      createUserMessage("What's the weather like?"),
      createAssistantMessage("It's sunny and 72F today."),
      createUserMessage("I'm planning a trip to Hawaii"),
      createAssistantMessage('Hawaii is beautiful! When are you going?'),
    ]

    const summary = await summarizer(messages)

    expect(summary).toBe('Summary: User discussed weather and travel plans.')
  })

  it('should use custom system prompt', async () => {
    const runSpy = vi.fn().mockResolvedValue({ text: 'Custom summary' })
    const mockAgent = {
      run: runSpy,
      config: {} as any,
      provider: {} as any,
      stream: vi.fn(),
    }

    const summarizer = createLLMSummarizer(mockAgent as any, {
      systemPrompt: 'You are a custom summarizer. Be brief.',
    })

    await summarizer([createUserMessage('Test')])

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: 'You are a custom summarizer. Be brief.',
          }),
        ]),
      })
    )
  })
})

// ============================================================================
// Token Counter Factory Tests
// ============================================================================

describe('Token Counter Factories', () => {
  describe('createTiktokenCounter()', () => {
    it('should create counter that uses provided encoding', () => {
      const mockEncoding = {
        encode: vi.fn().mockReturnValue([1, 2, 3, 4, 5]), // 5 tokens
      }
      const mockGetEncoding = vi.fn().mockReturnValue(mockEncoding)

      const counter = createTiktokenCounter('gpt-4o', mockGetEncoding)

      const messages: Message[] = [createUserMessage('Hello world')]
      const count = counter(messages)

      expect(mockGetEncoding).toHaveBeenCalledWith('gpt-4o')
      expect(mockEncoding.encode).toHaveBeenCalled()
      expect(count).toBeGreaterThan(0)
    })
  })

  describe('createAPITokenCounter()', () => {
    it('should create async counter that calls API', async () => {
      const mockCountFn = vi.fn().mockResolvedValue(10)

      const counter = createAPITokenCounter(mockCountFn)

      const messages: Message[] = [createUserMessage('Test message')]
      const count = await counter(messages)

      expect(mockCountFn).toHaveBeenCalled()
      expect(count).toBeGreaterThan(0)
    })

    it('should accumulate counts for all message content', async () => {
      const mockCountFn = vi.fn().mockResolvedValue(5)

      const counter = createAPITokenCounter(mockCountFn)

      const messages: Message[] = [
        createUserMessage('First'),
        createAssistantMessage('Second'),
        createUserMessage('Third'),
      ]

      const count = await counter(messages)

      // 3 messages * 5 tokens + role overhead
      expect(count).toBe(3 * 5 + 3 * 4) // 27 total
    })
  })
})

// ============================================================================
// Context Messages Tests
// ============================================================================

describe('Context Messages', () => {
  it('should return messages suitable for LLM', () => {
    const memory = createConversationMemory()

    memory.addMessage(createSystemMessage('You are helpful'))
    memory.addMessage(createUserMessage('Hello'))
    memory.addMessage(createAssistantMessage('Hi there'))

    const context = memory.getContextMessages()

    expect(context).toHaveLength(3)
    expect(context[0].role).toBe('system')
  })

  it('should prepend summary when available', () => {
    const memory = createConversationMemory()

    memory.setSummary({
      summary: 'Previous: User asked about Python',
      tokenCount: 10,
      messagesCovered: 5,
      createdAt: new Date(),
    })

    memory.addMessage(createUserMessage('Tell me more'))

    const context = memory.getContextMessages()

    expect(context[0].role).toBe('system')
    expect(context[0].content).toContain('Previous: User asked about Python')
    expect(context[1].content).toBe('Tell me more')
  })

  it('should not duplicate system message from summary', () => {
    const memory = createConversationMemory()

    memory.setSummary({
      summary: 'Summary content',
      tokenCount: 5,
      messagesCovered: 3,
      createdAt: new Date(),
    })

    memory.addMessage(createSystemMessage('Main system prompt'))
    memory.addMessage(createUserMessage('Question'))

    const context = memory.getContextMessages()

    // Should have summary system message + original system message + user
    expect(context).toHaveLength(3)
    expect(context[0].content).toContain('Summary content')
    expect(context[1].content).toBe('Main system prompt')
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty messages array', async () => {
    const memory = createConversationMemory()

    await memory.truncate()

    expect(memory.getMessages()).toHaveLength(0)
    expect(memory.getContextMessages()).toHaveLength(0)
  })

  it('should handle messages with complex content parts', async () => {
    const memory = createConversationMemory()

    const complexMessage: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'Check this image:' },
        { type: 'image', data: 'base64data...', mimeType: 'image/png' },
      ],
    }

    memory.addMessage(complexMessage)

    const count = await memory.getTokenCount()
    expect(count).toBeGreaterThan(0)
  })

  it('should handle tool messages', async () => {
    const memory = createConversationMemory()

    const toolMessage: Message = {
      role: 'tool',
      toolCallId: 'call-123',
      toolName: 'search',
      content: { results: ['item1', 'item2'] },
    }

    memory.addMessage(toolMessage)

    const count = await memory.getTokenCount()
    expect(count).toBeGreaterThan(0)
  })

  it('should handle very large messages', async () => {
    const memory = createConversationMemory({
      maxTokens: 100,
    })

    const largeContent = 'x'.repeat(10000)
    memory.addMessage(createUserMessage(largeContent))

    await memory.truncate()

    // Should handle without crashing
    expect(memory.getMessages().length).toBeGreaterThanOrEqual(1)
  })

  it('should handle concurrent truncate calls', async () => {
    const memory = createConversationMemory({
      maxMessages: 5,
    })

    for (let i = 0; i < 20; i++) {
      memory.addMessage(createUserMessage(`Message ${i}`))
    }

    // Call truncate multiple times concurrently
    await Promise.all([memory.truncate(), memory.truncate(), memory.truncate()])

    expect(memory.getMessages().length).toBeLessThanOrEqual(5)
  })
})
