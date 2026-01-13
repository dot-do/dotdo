/**
 * Conversation Memory Tests - [RED] Phase
 *
 * These tests define expected behavior for advanced conversation memory features:
 * - Semantic chunking and compression
 * - Multi-turn conversation continuity
 * - Context window optimization
 * - Rolling summarization
 * - Message deduplication
 * - Conversation forking
 *
 * These tests are EXPECTED TO FAIL - they define the target behavior.
 *
 * @module agents/tests/conversation-memory
 */

import { describe, it, expect, vi } from 'vitest'
import type { Message, AgentResult } from '../types'
import {
  createConversationMemory,
  withMemory,
  type ConversationMemory,
  type ConversationMemoryConfig,
} from '../memory'
import { createMockProvider } from '../testing'

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

function createToolMessage(toolCallId: string, toolName: string, content: unknown): Message {
  return { role: 'tool', toolCallId, toolName, content }
}

// ============================================================================
// Semantic Chunking Tests
// ============================================================================

describe('Semantic Chunking', () => {
  it('should chunk messages by topic boundaries', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 100,
    })

    // Add messages about different topics
    memory.addMessage(createUserMessage('Tell me about cats'))
    memory.addMessage(createAssistantMessage('Cats are domesticated feline animals...'))
    memory.addMessage(createUserMessage('What do they eat?'))
    memory.addMessage(createAssistantMessage('Cats are obligate carnivores...'))

    // Topic shift
    memory.addMessage(createUserMessage('Now tell me about the weather'))
    memory.addMessage(createAssistantMessage('The weather today is sunny with clear skies...'))
    memory.addMessage(createUserMessage('Will it rain tomorrow?'))
    memory.addMessage(createAssistantMessage('Based on the forecast, rain is expected...'))

    await memory.truncate()

    const summary = memory.getSummary()
    expect(summary).toBeDefined()
    // Summary should preserve topic boundaries
    expect(summary?.summary).toContain('cats')
    expect(summary?.summary).toContain('weather')

    // The memory should expose semantic chunks
    const chunks = (memory as any).getSemanticChunks?.()
    expect(chunks).toBeDefined()
    expect(chunks.length).toBeGreaterThanOrEqual(2) // At least 2 topic chunks
  })

  it('should preserve key facts across chunks', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })

    // Add conversation with important facts
    memory.addMessage(createUserMessage('My name is Alice and I live in NYC'))
    memory.addMessage(createAssistantMessage('Nice to meet you Alice! NYC is a great city.'))
    memory.addMessage(createUserMessage('I work as a software engineer'))
    memory.addMessage(createAssistantMessage('Software engineering is a rewarding field.'))

    // Add more messages to trigger summarization
    for (let i = 0; i < 10; i++) {
      memory.addMessage(createUserMessage(`Follow up message ${i}`))
      memory.addMessage(createAssistantMessage(`Response ${i}`))
    }

    await memory.truncate()

    // Key facts should be preserved in summary
    const summary = memory.getSummary()
    expect(summary?.summary).toContain('Alice')
    expect(summary?.summary).toContain('NYC')
    expect(summary?.summary).toContain('software engineer')
  })

  it('should extract and preserve entities across conversation', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })

    memory.addMessage(createUserMessage('I need to book a flight to Paris for John and Mary'))
    memory.addMessage(createAssistantMessage('I can help book flights to Paris. When are John and Mary traveling?'))
    memory.addMessage(createUserMessage('They want to leave on March 15th'))
    memory.addMessage(createAssistantMessage('Got it. Looking for March 15th flights to Paris for John and Mary.'))

    // Memory should track extracted entities
    const entities = (memory as any).getEntities?.()
    expect(entities).toBeDefined()
    expect(entities).toContainEqual(expect.objectContaining({ type: 'person', value: 'John' }))
    expect(entities).toContainEqual(expect.objectContaining({ type: 'person', value: 'Mary' }))
    expect(entities).toContainEqual(expect.objectContaining({ type: 'location', value: 'Paris' }))
    expect(entities).toContainEqual(expect.objectContaining({ type: 'date', value: 'March 15th' }))
  })
})

// ============================================================================
// Multi-turn Conversation Continuity Tests
// ============================================================================

describe('Multi-turn Conversation Continuity', () => {
  it('should maintain reference resolution across turns', async () => {
    const provider = createMockProvider({
      responses: [
        { text: 'The Eiffel Tower is 330 meters tall.', finishReason: 'stop' },
        { text: 'It was built in 1889.', finishReason: 'stop' },
        { text: 'The Eiffel Tower was built in 1889 and is 330 meters tall.', finishReason: 'stop' },
      ],
    })

    const agent = provider.createAgent({
      id: 'test-agent',
      name: 'Test',
      instructions: 'You are helpful',
      model: 'mock',
    })

    const memory = createConversationMemory()
    const agentWithMemory = withMemory(agent, memory)

    await agentWithMemory.runWithMemory({ prompt: 'How tall is the Eiffel Tower?' })
    await agentWithMemory.runWithMemory({ prompt: 'When was it built?' })

    // Memory should resolve "it" to "Eiffel Tower"
    const resolved = (memory as any).resolveReferences?.('it')
    expect(resolved).toBe('Eiffel Tower')

    // When asking about "it", context should include the referent
    const context = memory.getContextMessages()
    const lastUserMessage = context.filter((m) => m.role === 'user').pop()
    expect(lastUserMessage?.content).toBe('When was it built?')

    // The memory should track coreference chains
    const corefs = (memory as any).getCoreferenceChains?.()
    expect(corefs).toBeDefined()
    expect(corefs['it']).toContain('Eiffel Tower')
  })

  it('should track conversation state transitions', async () => {
    const memory = createConversationMemory()

    // Greeting phase
    memory.addMessage(createUserMessage('Hello'))
    memory.addMessage(createAssistantMessage('Hello! How can I help you today?'))

    // Information gathering phase
    memory.addMessage(createUserMessage('I want to order a pizza'))
    memory.addMessage(createAssistantMessage('What size pizza would you like?'))
    memory.addMessage(createUserMessage('Large pepperoni'))
    memory.addMessage(createAssistantMessage('Would you like any drinks with that?'))

    // Confirmation phase
    memory.addMessage(createUserMessage('No thanks, that\'s all'))
    memory.addMessage(createAssistantMessage('Your order is: Large pepperoni pizza. Is that correct?'))

    // Memory should track conversation state
    const state = (memory as any).getConversationState?.()
    expect(state).toBeDefined()
    expect(state.phase).toBe('confirmation')
    expect(state.order).toContainEqual({ item: 'pizza', size: 'large', topping: 'pepperoni' })
  })

  it('should detect and handle topic changes gracefully', async () => {
    const memory = createConversationMemory()

    memory.addMessage(createUserMessage('What\'s the weather like?'))
    memory.addMessage(createAssistantMessage('It\'s sunny and 72F'))

    // Topic change
    memory.addMessage(createUserMessage('Actually, can you help me with my taxes?'))

    const topicChange = (memory as any).detectTopicChange?.()
    expect(topicChange).toBe(true)

    const currentTopic = (memory as any).getCurrentTopic?.()
    expect(currentTopic).toBe('taxes')

    const previousTopic = (memory as any).getPreviousTopic?.()
    expect(previousTopic).toBe('weather')
  })
})

// ============================================================================
// Context Window Optimization Tests
// ============================================================================

describe('Context Window Optimization', () => {
  it('should prioritize recent and relevant messages', async () => {
    const memory = createConversationMemory({
      maxTokens: 500,
      windowStrategy: 'summarize',
    })

    // Add old context
    for (let i = 0; i < 20; i++) {
      memory.addMessage(createUserMessage(`Old message about topic A: ${i}`))
      memory.addMessage(createAssistantMessage(`Response about topic A: ${i}`))
    }

    // Add relevant context (same topic as upcoming query)
    memory.addMessage(createUserMessage('Tell me about TypeScript'))
    memory.addMessage(createAssistantMessage('TypeScript is a typed superset of JavaScript'))

    // Add more old context about different topic
    for (let i = 0; i < 10; i++) {
      memory.addMessage(createUserMessage(`More about topic B: ${i}`))
      memory.addMessage(createAssistantMessage(`Response B: ${i}`))
    }

    // When optimizing for a TypeScript query, relevant messages should be prioritized
    const optimized = (memory as any).optimizeForQuery?.('What are TypeScript generics?')
    expect(optimized).toBeDefined()

    // TypeScript-related messages should be included even if older
    const contextMessages = optimized.messages || memory.getContextMessages()
    const hasTypeScriptContext = contextMessages.some(
      (m: Message) => typeof m.content === 'string' && m.content.includes('TypeScript')
    )
    expect(hasTypeScriptContext).toBe(true)
  })

  it('should compress tool call results efficiently with smart truncation', async () => {
    const memory = createConversationMemory({
      maxTokens: 200,
    })

    // Add a verbose tool result
    const verboseResult = {
      results: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        title: `Result ${i}`,
        description: `This is a detailed description for result ${i}`,
        metadata: { score: Math.random(), timestamp: Date.now() },
      })),
    }

    memory.addMessage(createUserMessage('Search for documents'))
    memory.addMessage({
      role: 'assistant',
      content: 'Searching...',
      toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'documents' } }],
    })
    memory.addMessage(createToolMessage('call-1', 'search', verboseResult))
    memory.addMessage(createAssistantMessage('Found 100 results'))

    // Memory should have tool result compression capability
    const compressToolResults = (memory as any).compressToolResults
    expect(compressToolResults).toBeDefined()

    await memory.truncate()

    // Tool results should be compressed but key info preserved
    const contextMessages = memory.getContextMessages()
    const toolMessage = contextMessages.find((m) => m.role === 'tool')

    // Compressed content should be smaller
    if (toolMessage) {
      const content = JSON.stringify(toolMessage.content)
      expect(content.length).toBeLessThan(JSON.stringify(verboseResult).length)
    }
  })

  it('should maintain conversation coherence after compression', async () => {
    const memory = createConversationMemory({
      maxMessages: 10,
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })

    // Build a coherent conversation
    const conversation = [
      { user: 'I want to plan a trip to Japan', assistant: 'Great choice! When are you thinking of going?' },
      { user: 'Next spring, maybe April', assistant: 'April is perfect for cherry blossoms!' },
      { user: 'Where should I stay in Tokyo?', assistant: 'Shinjuku and Shibuya are popular areas.' },
      { user: 'What about Kyoto?', assistant: 'Kyoto is wonderful for temples and traditional culture.' },
      { user: 'How do I get between cities?', assistant: 'The Shinkansen (bullet train) is fastest.' },
      { user: 'What\'s the total cost?', assistant: 'For 2 weeks, budget around $3000-5000.' },
    ]

    for (const turn of conversation) {
      memory.addMessage(createUserMessage(turn.user))
      memory.addMessage(createAssistantMessage(turn.assistant))
    }

    // Add more messages to trigger summarization
    for (let i = 0; i < 10; i++) {
      memory.addMessage(createUserMessage(`Follow up ${i}`))
      memory.addMessage(createAssistantMessage(`Response ${i}`))
    }

    await memory.truncate()

    // After compression, key travel details should be preserved
    const summary = memory.getSummary()
    expect(summary?.summary).toContain('Japan')
    expect(summary?.summary).toMatch(/April|spring|cherry/i)
    expect(summary?.summary).toMatch(/Tokyo|Kyoto/i)

    // Coherence score should be maintained
    const coherence = (memory as any).getCoherenceScore?.()
    expect(coherence).toBeGreaterThan(0.7) // 70%+ coherence maintained
  })
})

// ============================================================================
// Rolling Summarization Tests
// ============================================================================

describe('Rolling Summarization', () => {
  it('should progressively summarize as conversation grows with quality metrics', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 100,
      maxTokens: 500,
    })

    const summaryVersions: string[] = []
    const originalSummarizer = (memory as any).summarizer

    // Track summary evolution
    memory.setSummarizer(async (messages) => {
      const summary = await originalSummarizer?.(messages) || `Summary of ${messages.length} messages`
      summaryVersions.push(summary)
      return summary
    })

    // Add messages in batches
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 10; i++) {
        memory.addMessage(createUserMessage(`Batch ${batch} message ${i}`))
        memory.addMessage(createAssistantMessage(`Response to batch ${batch} message ${i}`))
      }
      await memory.truncate()
    }

    // Should have multiple summary versions
    expect(summaryVersions.length).toBeGreaterThan(1)

    // Each summary should build on previous
    const summary = memory.getSummary()
    expect(summary?.messagesCovered).toBeGreaterThan(50)

    // Rolling summarization should track quality metrics
    const qualityMetrics = (memory as any).getSummarizationQuality?.()
    expect(qualityMetrics).toBeDefined()
    expect(qualityMetrics.compressionRatio).toBeGreaterThan(0)
    expect(qualityMetrics.informationRetention).toBeGreaterThan(0.8) // 80%+ retention
  })

  it('should merge summaries with semantic deduplication', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })

    // Set initial summary
    memory.setSummary({
      summary: 'User wants to learn Python programming',
      tokenCount: 10,
      messagesCovered: 5,
      createdAt: new Date(),
    })

    // Add more conversation
    memory.addMessage(createUserMessage('What about JavaScript?'))
    memory.addMessage(createAssistantMessage('JavaScript is great for web development'))
    memory.addMessage(createUserMessage('Which should I learn first?'))
    memory.addMessage(createAssistantMessage('Python is often recommended for beginners'))

    // Add enough to trigger new summarization
    for (let i = 0; i < 15; i++) {
      memory.addMessage(createUserMessage(`Question ${i}`))
      memory.addMessage(createAssistantMessage(`Answer ${i}`))
    }

    await memory.truncate()

    // Merged summary should contain info from both
    const summary = memory.getSummary()
    expect(summary?.summary).toContain('Python')
    expect(summary?.summary).toContain('JavaScript')
    expect(summary?.summary).toMatch(/beginner|first|learn/i)

    // Smart merging should use semantic deduplication
    const mergeMetadata = (memory as any).getSummaryMergeMetadata?.()
    expect(mergeMetadata).toBeDefined()
    expect(mergeMetadata.mergeCount).toBeGreaterThan(0)
    expect(mergeMetadata.deduplicatedFacts).toBeDefined()
  })

  it('should handle hierarchical summarization for very long conversations', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
      maxTokens: 200,
    })

    // Simulate a very long conversation (100+ exchanges)
    for (let i = 0; i < 100; i++) {
      memory.addMessage(createUserMessage(`Long conversation message ${i}`))
      memory.addMessage(createAssistantMessage(`Long conversation response ${i}`))

      // Truncate periodically to simulate ongoing conversation
      if (i % 20 === 0) {
        await memory.truncate()
      }
    }

    await memory.truncate()

    // Memory should handle hierarchical summarization
    const summary = memory.getSummary()
    expect(summary?.messagesCovered).toBeGreaterThan(50)

    // Token count should stay within bounds
    const tokenCount = await memory.getTokenCount()
    expect(tokenCount).toBeLessThanOrEqual(300) // Within reasonable bounds

    // Hierarchical summarization should create summary layers
    const summaryLayers = (memory as any).getSummaryLayers?.()
    expect(summaryLayers).toBeDefined()
    expect(summaryLayers.length).toBeGreaterThan(1) // Multiple summary layers
  })
})

// ============================================================================
// Message Deduplication Tests
// ============================================================================

describe('Message Deduplication', () => {
  it('should detect and handle repeated user messages', async () => {
    const memory = createConversationMemory()

    memory.addMessage(createUserMessage('What time is it?'))
    memory.addMessage(createAssistantMessage('It\'s 3:00 PM'))
    memory.addMessage(createUserMessage('What time is it?')) // Duplicate
    memory.addMessage(createAssistantMessage('Still 3:00 PM'))

    // Memory should track duplicates
    const duplicates = (memory as any).getDuplicateMessages?.()
    expect(duplicates).toBeDefined()
    expect(duplicates.length).toBeGreaterThan(0)
  })

  it('should detect semantic duplicates with different wording', async () => {
    const memory = createConversationMemory()

    memory.addMessage(createUserMessage('What\'s the weather like today?'))
    memory.addMessage(createAssistantMessage('It\'s sunny and warm'))
    memory.addMessage(createUserMessage('How\'s the weather outside?')) // Semantic duplicate
    memory.addMessage(createAssistantMessage('Still sunny and warm'))

    const semanticDuplicates = (memory as any).getSemanticDuplicates?.()
    expect(semanticDuplicates).toBeDefined()
    expect(semanticDuplicates.length).toBeGreaterThan(0)
  })

  it('should consolidate repeated information in summaries with dedup tracking', async () => {
    const memory = createConversationMemory({
      windowStrategy: 'summarize',
      summarizeThreshold: 50,
    })

    // User repeats same information multiple times
    memory.addMessage(createUserMessage('My email is alice@example.com'))
    memory.addMessage(createAssistantMessage('Got it, alice@example.com'))
    memory.addMessage(createUserMessage('Just to confirm, my email is alice@example.com'))
    memory.addMessage(createAssistantMessage('Confirmed, alice@example.com'))
    memory.addMessage(createUserMessage('Did you save my email alice@example.com?'))
    memory.addMessage(createAssistantMessage('Yes, I have alice@example.com saved'))

    // Add more to trigger summarization
    for (let i = 0; i < 10; i++) {
      memory.addMessage(createUserMessage(`Other message ${i}`))
      memory.addMessage(createAssistantMessage(`Response ${i}`))
    }

    await memory.truncate()

    // Summary should consolidate, not repeat the email multiple times
    const summary = memory.getSummary()
    const emailMatches = (summary?.summary.match(/alice@example\.com/g) || []).length
    expect(emailMatches).toBeLessThanOrEqual(2) // Should mention at most twice

    // Memory should track deduplication stats
    const dedupStats = (memory as any).getDeduplicationStats?.()
    expect(dedupStats).toBeDefined()
    expect(dedupStats.duplicatesRemoved).toBeGreaterThan(0)
  })
})

// ============================================================================
// Conversation Forking Tests
// ============================================================================

describe('Conversation Forking', () => {
  it('should support forking conversation for exploration', () => {
    const memory = createConversationMemory({ conversationId: 'main' })

    memory.addMessage(createUserMessage('Help me write a story'))
    memory.addMessage(createAssistantMessage('What kind of story would you like?'))
    memory.addMessage(createUserMessage('A mystery story'))

    // Fork the conversation
    const fork = (memory as any).fork?.('exploration-branch')
    expect(fork).toBeDefined()
    expect(fork.getConversationId()).toBe('exploration-branch')
    expect(fork.getMessages()).toHaveLength(3) // Same messages as parent

    // Changes to fork shouldn't affect original
    fork.addMessage(createUserMessage('With a detective'))
    expect(fork.getMessages()).toHaveLength(4)
    expect(memory.getMessages()).toHaveLength(3)
  })

  it('should merge forked conversations', () => {
    const memory = createConversationMemory({ conversationId: 'main' })

    memory.addMessage(createUserMessage('Plan a vacation'))
    memory.addMessage(createAssistantMessage('Where would you like to go?'))

    // Create two forks for exploring options
    const beachFork = (memory as any).fork?.('beach-option')
    const mountainFork = (memory as any).fork?.('mountain-option')

    beachFork?.addMessage(createUserMessage('Beach destinations'))
    beachFork?.addMessage(createAssistantMessage('Hawaii, Maldives, or Caribbean'))

    mountainFork?.addMessage(createUserMessage('Mountain destinations'))
    mountainFork?.addMessage(createAssistantMessage('Swiss Alps, Rocky Mountains'))

    // User decides on beach
    const merged = (memory as any).merge?.(beachFork)
    expect(merged).toBeDefined()
    expect(merged.getMessages()).toHaveLength(4) // Original 2 + beach branch 2
  })

  it('should track fork history and relationships', () => {
    const memory = createConversationMemory({ conversationId: 'root' })

    memory.addMessage(createUserMessage('Start'))

    const branch1 = (memory as any).fork?.('branch-1')
    const branch2 = (memory as any).fork?.('branch-2')
    const subbranch = branch1?.fork?.('branch-1-sub')

    // Memory should track the fork tree
    const forkTree = (memory as any).getForkTree?.()
    expect(forkTree).toBeDefined()
    expect(forkTree.children).toHaveLength(2) // branch1 and branch2
    expect(forkTree.children[0].children).toHaveLength(1) // subbranch under branch1
  })
})

// ============================================================================
// Importance Scoring Tests
// ============================================================================

describe('Message Importance Scoring', () => {
  it('should assign higher importance to messages with key information', () => {
    const memory = createConversationMemory()

    memory.addMessage(createUserMessage('Hi there'))
    memory.addMessage(createAssistantMessage('Hello!'))
    memory.addMessage(createUserMessage('My budget is $5000 and deadline is December 1st'))
    memory.addMessage(createAssistantMessage('Got it, $5000 budget with Dec 1 deadline'))
    memory.addMessage(createUserMessage('Thanks'))

    // Get importance scores
    const scores = (memory as any).getImportanceScores?.()
    expect(scores).toBeDefined()

    // Messages with numbers, dates, constraints should score higher
    const budgetMessageScore = scores.find((s: any) =>
      s.content?.includes('$5000')
    )?.score
    const greetingScore = scores.find((s: any) =>
      s.content === 'Hi there'
    )?.score

    expect(budgetMessageScore).toBeGreaterThan(greetingScore)
  })

  it('should use importance scores during truncation', async () => {
    const memory = createConversationMemory({
      maxMessages: 5,
      windowStrategy: 'fifo',
    })

    // Mix of important and unimportant messages
    memory.addMessage(createUserMessage('Hi'))
    memory.addMessage(createAssistantMessage('Hello'))
    memory.addMessage(createUserMessage('My API key is sk-12345')) // Important!
    memory.addMessage(createAssistantMessage('I\'ll keep that secure'))
    memory.addMessage(createUserMessage('How are you?'))
    memory.addMessage(createAssistantMessage('I\'m doing well'))
    memory.addMessage(createUserMessage('Bye'))
    memory.addMessage(createAssistantMessage('Goodbye'))

    // With importance-aware truncation, important messages should be preserved
    const truncateWithImportance = (memory as any).truncateWithImportance
    expect(truncateWithImportance).toBeDefined()

    await truncateWithImportance?.()

    const messages = memory.getMessages()
    const hasApiKeyMessage = messages.some(
      (m) => typeof m.content === 'string' && m.content.includes('API key')
    )
    expect(hasApiKeyMessage).toBe(true)
  })
})

// ============================================================================
// Async Memory Operations Tests
// ============================================================================

describe('Async Memory Operations', () => {
  it('should support async loading from persistent storage', async () => {
    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        id: 'stored-conv',
        messages: [
          createUserMessage('Stored message'),
          createAssistantMessage('Stored response'),
        ],
        summary: 'Previous conversation about stored data',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      }),
      set: vi.fn().mockResolvedValue(undefined),
    }

    const memory = createConversationMemory()
    await (memory as any).loadFromStorage?.(mockStorage, 'stored-conv')

    expect(memory.getConversationId()).toBe('stored-conv')
    expect(memory.getMessages()).toHaveLength(2)
  })

  it('should support async saving to persistent storage', async () => {
    const mockStorage = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    }

    const memory = createConversationMemory({ conversationId: 'save-test' })
    memory.addMessage(createUserMessage('Save me'))
    memory.addMessage(createAssistantMessage('Saved!'))

    await (memory as any).saveToStorage?.(mockStorage)

    expect(mockStorage.set).toHaveBeenCalledWith(
      'save-test',
      expect.objectContaining({
        id: 'save-test',
        messages: expect.any(Array),
      })
    )
  })

  it('should handle concurrent memory operations safely with locking', async () => {
    const memory = createConversationMemory({
      maxMessages: 10,
    })

    // Memory should support concurrency control
    const acquireLock = (memory as any).acquireLock
    const releaseLock = (memory as any).releaseLock
    expect(acquireLock).toBeDefined()
    expect(releaseLock).toBeDefined()

    // Concurrent writes
    await Promise.all([
      (async () => {
        for (let i = 0; i < 20; i++) {
          memory.addMessage(createUserMessage(`Concurrent A ${i}`))
        }
      })(),
      (async () => {
        for (let i = 0; i < 20; i++) {
          memory.addMessage(createUserMessage(`Concurrent B ${i}`))
        }
      })(),
      memory.truncate(),
      memory.truncate(),
    ])

    // Memory should be in consistent state
    const messages = memory.getMessages()
    expect(messages.length).toBeLessThanOrEqual(40) // May have truncated
    expect(messages.length).toBeGreaterThan(0)

    // Memory should report concurrency stats
    const concurrencyStats = (memory as any).getConcurrencyStats?.()
    expect(concurrencyStats).toBeDefined()
  })
})

// ============================================================================
// Context Retrieval Tests
// ============================================================================

describe('Smart Context Retrieval', () => {
  it('should retrieve relevant context for a query', async () => {
    const memory = createConversationMemory()

    // Add diverse conversation history
    memory.addMessage(createUserMessage('Set my name to Bob'))
    memory.addMessage(createAssistantMessage('Done, your name is Bob'))
    memory.addMessage(createUserMessage('What\'s the weather?'))
    memory.addMessage(createAssistantMessage('It\'s sunny'))
    memory.addMessage(createUserMessage('Set my email to bob@test.com'))
    memory.addMessage(createAssistantMessage('Email set to bob@test.com'))
    memory.addMessage(createUserMessage('Tell me a joke'))
    memory.addMessage(createAssistantMessage('Why did the chicken cross the road?'))

    // Query for user profile info
    const relevantContext = await (memory as any).getRelevantContext?.(
      'What are my account settings?'
    )

    expect(relevantContext).toBeDefined()
    expect(relevantContext.some((m: Message) =>
      typeof m.content === 'string' && m.content.includes('Bob')
    )).toBe(true)
    expect(relevantContext.some((m: Message) =>
      typeof m.content === 'string' && m.content.includes('bob@test.com')
    )).toBe(true)
  })

  it('should use vector similarity for semantic retrieval', async () => {
    const memory = createConversationMemory()

    // Mock embedding function
    const mockEmbedder = vi.fn().mockImplementation((text: string) => {
      // Simple mock: return different vectors for different topics
      if (text.includes('code') || text.includes('programming')) {
        return [1, 0, 0]
      }
      if (text.includes('music') || text.includes('song')) {
        return [0, 1, 0]
      }
      return [0, 0, 1]
    })

    ;(memory as any).setEmbedder?.(mockEmbedder)

    memory.addMessage(createUserMessage('I love writing code'))
    memory.addMessage(createAssistantMessage('Programming is great!'))
    memory.addMessage(createUserMessage('What\'s your favorite song?'))
    memory.addMessage(createAssistantMessage('I enjoy classical music'))

    // Query about programming should retrieve code-related messages
    const retrieved = await (memory as any).semanticSearch?.('Help me with my code')
    expect(retrieved).toBeDefined()
    expect(retrieved[0].content).toMatch(/code|programming/i)
  })
})
