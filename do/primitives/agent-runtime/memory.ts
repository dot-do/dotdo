/**
 * Conversation Memory - Message history and context management
 *
 * Provides:
 * - Message history management
 * - Sliding window truncation (FIFO or summarize)
 * - Token counting and limiting
 * - Context summarization
 * - State export/import for persistence
 *
 * @module db/primitives/agent-runtime
 */

import type {
  Message,
  MemoryConfig,
  ConversationState,
  MemorySummary,
} from './types'

// ============================================================================
// Types
// ============================================================================

export type TokenCounter = (messages: Message[]) => Promise<number>
export type Summarizer = (messages: Message[]) => Promise<string>

// ============================================================================
// Conversation Memory Interface
// ============================================================================

export interface ConversationMemory {
  /** Get conversation ID */
  getConversationId(): string

  /** Get memory configuration */
  getConfig(): MemoryConfig

  /** Add a single message */
  addMessage(message: Message): void

  /** Add multiple messages */
  addMessages(messages: Message[]): void

  /** Get all messages */
  getMessages(): Message[]

  /** Get the last message */
  getLastMessage(): Message | undefined

  /** Get a message by ID */
  getMessageById(id: string): Message | undefined

  /** Clear all messages */
  clear(): void

  /** Get current summary */
  getSummary(): MemorySummary | undefined

  /** Set summary manually */
  setSummary(summary: MemorySummary): void

  /** Get messages suitable for LLM context (includes summary if available) */
  getContextMessages(): Message[]

  /** Truncate messages based on config (FIFO or summarize) */
  truncate(): Promise<void>

  /** Get current token count */
  getTokenCount(): Promise<number>

  /** Set custom token counter */
  setTokenCounter(counter: TokenCounter): void

  /** Set custom summarizer */
  setSummarizer(summarizer: Summarizer): void

  /** Export state for persistence */
  exportState(): ConversationState

  /** Import state from persistence */
  importState(state: ConversationState): void
}

// ============================================================================
// Default Token Counter
// ============================================================================

function defaultTokenCounter(messages: Message[]): Promise<number> {
  // Rough approximation: ~4 characters per token
  let total = 0
  for (const message of messages) {
    // Base tokens per message
    total += 4
    if (typeof message.content === 'string') {
      total += Math.ceil(message.content.length / 4)
    } else if (message.role === 'user' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          total += Math.ceil(part.text.length / 4)
        }
      }
    }
  }
  return Promise.resolve(total)
}

// ============================================================================
// Conversation Memory Implementation
// ============================================================================

class ConversationMemoryImpl implements ConversationMemory {
  private id: string
  private config: MemoryConfig
  private messages: Message[] = []
  private summary: MemorySummary | undefined
  private tokenCounter: TokenCounter = defaultTokenCounter
  private summarizer: Summarizer | undefined
  private createdAt: Date
  private updatedAt: Date

  constructor(config?: MemoryConfig, conversationId?: string) {
    this.id = conversationId ?? `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.config = {
      maxMessages: config?.maxMessages ?? 100,
      maxTokens: config?.maxTokens ?? 128000,
      windowStrategy: config?.windowStrategy ?? 'fifo',
      summarizeThreshold: config?.summarizeThreshold ?? 4000,
      preserveSystemMessages: config?.preserveSystemMessages ?? true,
      persist: config?.persist ?? false,
    }
    this.createdAt = new Date()
    this.updatedAt = new Date()
  }

  getConversationId(): string {
    return this.id
  }

  getConfig(): MemoryConfig {
    return { ...this.config }
  }

  addMessage(message: Message): void {
    // Assign ID if not present
    const messageWithId = {
      ...message,
      id: message.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: message.createdAt ?? new Date(),
    }

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
    return this.summary
  }

  setSummary(summary: MemorySummary): void {
    this.summary = summary
    this.updatedAt = new Date()
  }

  getContextMessages(): Message[] {
    const result: Message[] = []

    // Add summary as system message if available
    if (this.summary) {
      result.push({
        role: 'system',
        content: `[Previous conversation summary]\n${this.summary.summary}`,
        id: 'summary',
      })
    }

    // Add current messages
    result.push(...this.messages)

    return result
  }

  async truncate(): Promise<void> {
    if (this.config.windowStrategy === 'fifo') {
      await this.truncateFifo()
    } else if (this.config.windowStrategy === 'summarize') {
      await this.truncateWithSummarization()
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
      totalTokens: 0, // Will be updated on access
      metadata: {},
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
        tokenCount: 0,
        messagesCovered: 0,
        createdAt: state.updatedAt,
      }
    }
    this.createdAt = state.createdAt
    this.updatedAt = state.updatedAt
  }

  // ============================================================================
  // Private Methods
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
      const truncatedNonSystem = nonSystemMessages.slice(-maxNonSystem)

      this.messages = [...systemMessages, ...truncatedNonSystem]
    }

    // Handle maxTokens limit
    if (this.config.maxTokens) {
      while (await this.getTokenCount() > this.config.maxTokens && this.messages.length > 1) {
        // Find first non-system message to remove
        const indexToRemove = this.config.preserveSystemMessages
          ? this.messages.findIndex((m) => m.role !== 'system')
          : 0

        if (indexToRemove >= 0) {
          this.messages.splice(indexToRemove, 1)
        } else {
          break
        }
      }
    }
  }

  private async truncateWithSummarization(): Promise<void> {
    if (!this.summarizer) {
      // Fall back to FIFO if no summarizer
      await this.truncateFifo()
      return
    }

    const currentTokens = await this.getTokenCount()
    const threshold = this.config.summarizeThreshold ?? 4000

    if (currentTokens > threshold) {
      // Find messages to summarize (older ones)
      const systemMessages = this.config.preserveSystemMessages
        ? this.messages.filter((m) => m.role === 'system')
        : []

      const nonSystemMessages = this.config.preserveSystemMessages
        ? this.messages.filter((m) => m.role !== 'system')
        : this.messages

      // Keep last few messages, summarize the rest
      const keepCount = Math.min(10, Math.floor(nonSystemMessages.length / 2))
      const messagesToSummarize = nonSystemMessages.slice(0, -keepCount)
      const messagesToKeep = nonSystemMessages.slice(-keepCount)

      if (messagesToSummarize.length > 0) {
        // Generate summary
        const summaryText = await this.summarizer(messagesToSummarize)

        // Update summary
        const existingSummary = this.summary?.summary ?? ''
        const combinedSummary = existingSummary
          ? `${existingSummary}\n\n${summaryText}`
          : summaryText

        this.summary = {
          summary: combinedSummary,
          tokenCount: Math.ceil(combinedSummary.length / 4),
          messagesCovered: (this.summary?.messagesCovered ?? 0) + messagesToSummarize.length,
          createdAt: new Date(),
        }

        // Replace messages with just the kept ones
        this.messages = [...systemMessages, ...messagesToKeep]
      }
    }

    // After summarization, still apply FIFO if needed
    await this.truncateFifo()
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createConversationMemory(
  config?: MemoryConfig,
  conversationId?: string
): ConversationMemory {
  return new ConversationMemoryImpl(config, conversationId)
}
