/**
 * Conversation Memory for Agent SDK
 *
 * Provides sliding window and summarization-based memory management
 * for maintaining context across agent interactions.
 *
 * @deprecated This module is deprecated. Use the unified memory system instead:
 * ```ts
 * import { createInMemoryAgentMemory, toConversationMemory } from './agents'
 *
 * // Create unified memory and wrap with ConversationMemory adapter
 * const memory = createInMemoryAgentMemory()
 * const conversationMemory = toConversationMemory(memory)
 *
 * // Or for graph-backed persistence:
 * import { createGraphMemory, toConversationMemory } from './agents'
 * const graphMemory = createGraphMemory({ store, agentId })
 * const conversationMemory = toConversationMemory(graphMemory)
 * ```
 *
 * @see agents/unified-memory.ts for the new consolidated memory system
 * @see dotdo-ww5cn - [REFACTOR] Consolidate Agent Memory Systems
 *
 * @example
 * ```ts
 * import { createConversationMemory, withMemory } from './agents'
 *
 * // Create memory with sliding window
 * const memory = createConversationMemory({
 *   maxTokens: 8000,
 *   windowStrategy: 'summarize',
 *   summarizeThreshold: 4000,
 * })
 *
 * // Use with an agent
 * const agent = withMemory(provider.createAgent(config), memory)
 * ```
 *
 * @module agents/memory
 */

import type { Message, AgentConfig, Agent, AgentInput, AgentResult } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Memory configuration for conversation context management
 */
export interface ConversationMemoryConfig {
  /** Maximum number of messages to keep in context */
  maxMessages?: number
  /** Maximum total tokens in context window */
  maxTokens?: number
  /** Strategy for truncating old messages */
  windowStrategy?: 'fifo' | 'summarize'
  /** Token threshold that triggers summarization */
  summarizeThreshold?: number
  /** Whether to preserve system messages during truncation */
  preserveSystemMessages?: boolean
  /** Custom ID for the conversation */
  conversationId?: string
}

/**
 * Summary of compressed conversation history
 */
export interface MemorySummary {
  /** Text summary of the conversation */
  summary: string
  /** Approximate token count of the summary */
  tokenCount: number
  /** Number of messages that were summarized */
  messagesCovered: number
  /** When the summary was created */
  createdAt: Date
}

/**
 * Serializable state for persistence
 */
export interface ConversationState {
  id: string
  messages: Message[]
  summary?: string
  summaryMessagesCovered?: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Token counting function signature
 */
export type TokenCounter = (messages: Message[]) => number | Promise<number>

/**
 * Summarization function signature
 */
export type Summarizer = (messages: Message[]) => string | Promise<string>

// ============================================================================
// Conversation Memory Interface
// ============================================================================

export interface ConversationMemory {
  /** Get conversation ID */
  getConversationId(): string

  /** Get memory configuration */
  getConfig(): ConversationMemoryConfig

  /** Add a single message to history */
  addMessage(message: Message): void

  /** Add multiple messages to history */
  addMessages(messages: Message[]): void

  /** Get all messages in current context */
  getMessages(): Message[]

  /** Get the last message */
  getLastMessage(): Message | undefined

  /** Get a message by ID */
  getMessageById(id: string): Message | undefined

  /** Clear all messages and summary */
  clear(): void

  /** Get current summary if one exists */
  getSummary(): MemorySummary | undefined

  /** Set summary manually */
  setSummary(summary: MemorySummary): void

  /**
   * Get messages suitable for LLM context
   * If a summary exists, it's prepended as a system message
   */
  getContextMessages(): Message[]

  /**
   * Truncate messages based on config (FIFO or summarize)
   * Call this periodically or before generating to stay within limits
   */
  truncate(): Promise<void>

  /** Get estimated current token count */
  getTokenCount(): Promise<number>

  /** Set custom token counting function */
  setTokenCounter(counter: TokenCounter): void

  /** Set custom summarization function */
  setSummarizer(summarizer: Summarizer): void

  /** Export state for persistence */
  exportState(): ConversationState

  /** Import state from persistence */
  importState(state: ConversationState): void
}

// ============================================================================
// Default Token Counter
// ============================================================================

/**
 * Default token estimation: ~4 characters per token
 * Override with setTokenCounter for accurate counting
 */
function defaultTokenCounter(messages: Message[]): number {
  let total = 0
  for (const message of messages) {
    // Base overhead per message (~4 tokens for role, formatting)
    total += 4

    if (message.role === 'assistant' && message.toolCalls) {
      // Tool calls have JSON overhead
      for (const tc of message.toolCalls) {
        total += Math.ceil(JSON.stringify(tc).length / 4)
      }
    }

    if ('content' in message) {
      if (typeof message.content === 'string') {
        total += Math.ceil(message.content.length / 4)
      } else if (message.role === 'user' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            total += Math.ceil(part.text.length / 4)
          }
        }
      } else if (message.content !== undefined) {
        // Tool messages with object content
        total += Math.ceil(JSON.stringify(message.content).length / 4)
      }
    }
  }
  return total
}

// ============================================================================
// Default Summarizer (placeholder)
// ============================================================================

function defaultSummarizer(messages: Message[]): string {
  // Simple extractive summary - just pull key info
  const userMessages = messages.filter((m) => m.role === 'user')
  const assistantMessages = messages.filter((m) => m.role === 'assistant')

  let summary = 'Previous conversation context:\n'

  // Include first and last user message topics
  if (userMessages.length > 0) {
    const first = userMessages[0]!
    const last = userMessages[userMessages.length - 1]!
    const firstContent = typeof first.content === 'string' ? first.content : '[complex content]'
    const lastContent = typeof last.content === 'string' ? last.content : '[complex content]'

    summary += `- User started by asking about: ${firstContent.slice(0, 100)}...\n`
    if (userMessages.length > 1) {
      summary += `- Most recently discussed: ${lastContent.slice(0, 100)}...\n`
    }
  }

  // Note assistant actions
  const toolCalls = assistantMessages.flatMap((m) => m.toolCalls ?? [])
  if (toolCalls.length > 0) {
    const toolNames = [...new Set(toolCalls.map((tc) => tc.name))]
    summary += `- Tools used: ${toolNames.join(', ')}\n`
  }

  summary += `- Total messages summarized: ${messages.length}`

  return summary
}

// ============================================================================
// Implementation
// ============================================================================

class ConversationMemoryImpl implements ConversationMemory {
  private id: string
  private config: Required<ConversationMemoryConfig>
  private messages: Message[] = []
  private summary: MemorySummary | undefined
  private tokenCounter: TokenCounter = defaultTokenCounter
  private summarizer: Summarizer = defaultSummarizer
  private createdAt: Date
  private updatedAt: Date

  constructor(config: ConversationMemoryConfig = {}) {
    this.id = config.conversationId ?? `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.config = {
      maxMessages: config.maxMessages ?? 100,
      maxTokens: config.maxTokens ?? 128000,
      windowStrategy: config.windowStrategy ?? 'fifo',
      summarizeThreshold: config.summarizeThreshold ?? 4000,
      preserveSystemMessages: config.preserveSystemMessages ?? true,
      conversationId: this.id,
    }
    this.createdAt = new Date()
    this.updatedAt = new Date()
  }

  getConversationId(): string {
    return this.id
  }

  getConfig(): ConversationMemoryConfig {
    return { ...this.config }
  }

  addMessage(message: Message): void {
    const messageWithId: Message = {
      ...message,
      id: message.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: message.createdAt ?? new Date(),
    } as Message

    this.messages.push(messageWithId)
    this.updatedAt = new Date()
  }

  addMessages(messages: Message[]): void {
    for (const message of messages) {
      this.addMessage(message)
    }
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getLastMessage(): Message | undefined {
    return this.messages[this.messages.length - 1]
  }

  getMessageById(id: string): Message | undefined {
    return this.messages.find((m) => m.id === id)
  }

  clear(): void {
    this.messages = []
    this.summary = undefined
    this.updatedAt = new Date()
  }

  getSummary(): MemorySummary | undefined {
    return this.summary ? { ...this.summary } : undefined
  }

  setSummary(summary: MemorySummary): void {
    this.summary = { ...summary }
    this.updatedAt = new Date()
  }

  getContextMessages(): Message[] {
    const result: Message[] = []

    // Add summary as system message if available
    if (this.summary) {
      result.push({
        role: 'system',
        content: `[Previous conversation summary]\n${this.summary.summary}`,
        id: 'memory-summary',
      })
    }

    // Add current messages
    result.push(...this.messages)

    return result
  }

  async truncate(): Promise<void> {
    if (this.config.windowStrategy === 'summarize') {
      await this.truncateWithSummarization()
    } else {
      await this.truncateFifo()
    }
  }

  async getTokenCount(): Promise<number> {
    return this.tokenCounter(this.messages)
  }

  setTokenCounter(counter: TokenCounter): void {
    this.tokenCounter = counter
  }

  setSummarizer(summarizer: Summarizer): void {
    this.summarizer = summarizer
  }

  exportState(): ConversationState {
    return {
      id: this.id,
      messages: [...this.messages],
      summary: this.summary?.summary,
      summaryMessagesCovered: this.summary?.messagesCovered,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }

  importState(state: ConversationState): void {
    this.id = state.id
    this.messages = [...state.messages]
    if (state.summary) {
      this.summary = {
        summary: state.summary,
        tokenCount: Math.ceil(state.summary.length / 4),
        messagesCovered: state.summaryMessagesCovered ?? 0,
        createdAt: state.updatedAt,
      }
    } else {
      this.summary = undefined
    }
    this.createdAt = state.createdAt
    this.updatedAt = state.updatedAt
  }

  // ============================================================================
  // Private Truncation Methods
  // ============================================================================

  private async truncateFifo(): Promise<void> {
    // Handle maxMessages limit
    if (this.config.maxMessages && this.messages.length > this.config.maxMessages) {
      const systemMessages = this.config.preserveSystemMessages
        ? this.messages.filter((m) => m.role === 'system')
        : []

      const nonSystemMessages = this.config.preserveSystemMessages
        ? this.messages.filter((m) => m.role !== 'system')
        : this.messages

      // Calculate how many non-system messages to keep
      const maxNonSystem = this.config.maxMessages - systemMessages.length
      const truncatedNonSystem = nonSystemMessages.slice(-Math.max(0, maxNonSystem))

      this.messages = [...systemMessages, ...truncatedNonSystem]
    }

    // Handle maxTokens limit
    if (this.config.maxTokens) {
      let currentTokens = await this.getTokenCount()

      while (currentTokens > this.config.maxTokens && this.messages.length > 1) {
        // Find first non-system message to remove
        const indexToRemove = this.config.preserveSystemMessages
          ? this.messages.findIndex((m) => m.role !== 'system')
          : 0

        if (indexToRemove >= 0) {
          this.messages.splice(indexToRemove, 1)
          currentTokens = await this.getTokenCount()
        } else {
          break
        }
      }
    }
  }

  private async truncateWithSummarization(): Promise<void> {
    const currentTokens = await this.getTokenCount()
    const threshold = this.config.summarizeThreshold

    if (currentTokens > threshold) {
      // Separate system messages
      const systemMessages = this.config.preserveSystemMessages
        ? this.messages.filter((m) => m.role === 'system')
        : []

      const nonSystemMessages = this.config.preserveSystemMessages
        ? this.messages.filter((m) => m.role !== 'system')
        : this.messages

      // Keep recent messages, summarize older ones
      // Keep at least 25% of messages or 10, whichever is larger
      const keepCount = Math.max(10, Math.floor(nonSystemMessages.length * 0.25))
      const messagesToSummarize = nonSystemMessages.slice(0, -keepCount)
      const messagesToKeep = nonSystemMessages.slice(-keepCount)

      if (messagesToSummarize.length > 0) {
        // Generate summary for old messages
        const summaryText = await this.summarizer(messagesToSummarize)

        // Combine with existing summary if present
        const existingSummary = this.summary?.summary ?? ''
        const combinedSummary = existingSummary
          ? `${existingSummary}\n\n---\n\n${summaryText}`
          : summaryText

        this.summary = {
          summary: combinedSummary,
          tokenCount: Math.ceil(combinedSummary.length / 4),
          messagesCovered: (this.summary?.messagesCovered ?? 0) + messagesToSummarize.length,
          createdAt: new Date(),
        }

        // Replace messages with just the recent ones
        this.messages = [...systemMessages, ...messagesToKeep]
      }
    }

    // After summarization, still apply FIFO if needed
    await this.truncateFifo()
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a conversation memory instance
 *
 * @deprecated Use `createInMemoryAgentMemory` with `toConversationMemory` instead:
 * ```ts
 * import { createInMemoryAgentMemory, toConversationMemory } from './agents'
 * const memory = createInMemoryAgentMemory()
 * const conversationMemory = toConversationMemory(memory)
 * ```
 *
 * @example
 * ```ts
 * // Basic FIFO memory
 * const memory = createConversationMemory({
 *   maxMessages: 50,
 *   maxTokens: 8000,
 * })
 *
 * // Summarization-based memory
 * const memory = createConversationMemory({
 *   windowStrategy: 'summarize',
 *   summarizeThreshold: 4000,
 *   maxTokens: 8000,
 * })
 * ```
 */
export function createConversationMemory(config?: ConversationMemoryConfig): ConversationMemory {
  return new ConversationMemoryImpl(config)
}

// ============================================================================
// Agent Memory Integration
// ============================================================================

/**
 * Wrapper that adds memory capabilities to an agent
 */
export interface AgentWithMemory extends Agent {
  /** Get the memory instance */
  getMemory(): ConversationMemory

  /** Run with automatic memory management */
  runWithMemory(input: AgentInput): Promise<AgentResult>
}

/**
 * Wrap an agent with conversation memory
 *
 * @deprecated Consider using the unified AgentMemory system instead.
 * The unified system provides better integration with graph-backed storage
 * and consistent APIs across conversation and long-term memory.
 *
 * @example
 * ```ts
 * const memory = createConversationMemory({ windowStrategy: 'summarize' })
 * const agentWithMemory = withMemory(agent, memory)
 *
 * // First interaction
 * await agentWithMemory.runWithMemory({ prompt: 'Hello!' })
 *
 * // Subsequent interactions include previous context
 * await agentWithMemory.runWithMemory({ prompt: 'What did I just say?' })
 * ```
 */
export function withMemory(agent: Agent, memory: ConversationMemory): AgentWithMemory {
  return {
    ...agent,
    config: agent.config,
    provider: agent.provider,

    getMemory(): ConversationMemory {
      return memory
    },

    async run(input: AgentInput): Promise<AgentResult> {
      return agent.run(input)
    },

    stream(input: AgentInput) {
      return agent.stream(input)
    },

    async runWithMemory(input: AgentInput): Promise<AgentResult> {
      // Truncate memory before adding new messages
      await memory.truncate()

      // Build messages with memory context
      const contextMessages = memory.getContextMessages()
      const inputMessages = input.messages ?? (input.prompt ? [{ role: 'user' as const, content: input.prompt }] : [])

      // Run agent with full context
      const result = await agent.run({
        ...input,
        messages: [...contextMessages, ...inputMessages],
        prompt: undefined, // Use messages instead
      })

      // Save new messages to memory
      for (const msg of inputMessages) {
        memory.addMessage(msg)
      }

      // Save assistant response
      if (result.messages.length > 0) {
        const lastAssistant = result.messages.filter((m) => m.role === 'assistant').pop()
        if (lastAssistant) {
          memory.addMessage(lastAssistant)
        }
      }

      return result
    },
  }
}

// ============================================================================
// LLM-Based Summarizer Factory
// ============================================================================

/**
 * Create a summarizer that uses an LLM to generate summaries
 *
 * @example
 * ```ts
 * const summarizer = createLLMSummarizer(agent, {
 *   maxSummaryTokens: 500,
 * })
 * memory.setSummarizer(summarizer)
 * ```
 */
export interface LLMSummarizerOptions {
  /** Maximum tokens for the generated summary */
  maxSummaryTokens?: number
  /** Custom system prompt for summarization */
  systemPrompt?: string
}

export function createLLMSummarizer(
  agent: Agent,
  options: LLMSummarizerOptions = {}
): Summarizer {
  const {
    maxSummaryTokens = 500,
    systemPrompt = `You are a conversation summarizer. Your task is to create a concise summary of the conversation that captures the key points, decisions made, and important context that would help continue the conversation. Keep the summary focused and under ${maxSummaryTokens} tokens.`,
  } = options

  return async (messages: Message[]): Promise<string> => {
    // Format messages for summarization
    const formattedMessages = messages
      .map((m) => {
        const role = m.role.charAt(0).toUpperCase() + m.role.slice(1)
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `${role}: ${content}`
      })
      .join('\n\n')

    const result = await agent.run({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Please summarize the following conversation:\n\n${formattedMessages}`,
        },
      ],
    })

    return result.text
  }
}

// ============================================================================
// Token Counter Factories
// ============================================================================

/**
 * Create a tiktoken-based token counter (requires tiktoken package)
 *
 * @example
 * ```ts
 * import { encoding_for_model } from 'tiktoken'
 *
 * const counter = createTiktokenCounter('gpt-4o')
 * memory.setTokenCounter(counter)
 * ```
 */
export function createTiktokenCounter(
  model: string,
  getEncoding: (model: string) => { encode: (text: string) => number[] }
): TokenCounter {
  return (messages: Message[]): number => {
    const encoding = getEncoding(model)
    let total = 0

    for (const message of messages) {
      // Role overhead
      total += 4

      if ('content' in message) {
        if (typeof message.content === 'string') {
          total += encoding.encode(message.content).length
        } else if (message.content !== undefined) {
          total += encoding.encode(JSON.stringify(message.content)).length
        }
      }

      if (message.role === 'assistant' && message.toolCalls) {
        total += encoding.encode(JSON.stringify(message.toolCalls)).length
      }
    }

    return total
  }
}

/**
 * Create a provider-based token counter that calls the model's tokenizer
 *
 * @example
 * ```ts
 * const counter = createAPITokenCounter(async (text) => {
 *   const response = await fetch('/api/tokenize', { body: text })
 *   return response.json().tokenCount
 * })
 * memory.setTokenCounter(counter)
 * ```
 */
export function createAPITokenCounter(
  countFn: (text: string) => Promise<number>
): TokenCounter {
  return async (messages: Message[]): Promise<number> => {
    let total = 0

    for (const message of messages) {
      // Role overhead
      total += 4

      if ('content' in message) {
        if (typeof message.content === 'string') {
          total += await countFn(message.content)
        } else if (message.content !== undefined) {
          total += await countFn(JSON.stringify(message.content))
        }
      }

      if (message.role === 'assistant' && message.toolCalls) {
        total += await countFn(JSON.stringify(message.toolCalls))
      }
    }

    return total
  }
}

export default createConversationMemory
