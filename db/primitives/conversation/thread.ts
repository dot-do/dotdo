/**
 * Thread and Message Models - Conversation primitive
 *
 * Provides conversation threading with:
 * - Thread creation with ID and metadata
 * - Message append to thread
 * - Message ordering (chronological)
 * - Timestamps (created_at, updated_at)
 * - Metadata on threads and messages
 * - Message pagination
 * - Thread listing
 * - Participant tracking (customer, agent, AI)
 * - Thread hierarchy (parent/child threads)
 * - Read/unread tracking per participant
 *
 * @example
 * ```typescript
 * import { createThreadManager } from 'db/primitives/conversation/thread'
 *
 * const manager = createThreadManager()
 *
 * // Create a thread with participants
 * const thread = await manager.createThread({
 *   title: 'Customer Support',
 *   metadata: { customerId: 'cust_123' },
 *   participantIds: ['user_1', 'agent_1', 'ai_bot'],
 * })
 *
 * // Create a child thread (sub-conversation)
 * const childThread = await manager.createThread({
 *   title: 'Technical Deep Dive',
 *   parentThreadId: thread.id,
 * })
 *
 * // Append messages
 * await manager.appendMessage(thread.id, {
 *   role: 'user',
 *   content: 'Hello, I need help',
 * })
 *
 * // Track read status
 * await manager.markAsRead(thread.id, 'agent_1')
 * const unread = await manager.getUnreadCount(thread.id, 'agent_1')
 * ```
 *
 * @module db/primitives/conversation/thread
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Role of the message sender
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/**
 * Message content can be text or structured content parts
 */
export type MessageContent =
  | string
  | Array<{
      type: 'text' | 'image' | 'file' | 'tool_call' | 'tool_result'
      text?: string
      url?: string
      mimeType?: string
      toolCallId?: string
      toolName?: string
      input?: unknown
      output?: unknown
    }>

/**
 * Individual message in a thread
 */
export interface Message {
  id: string
  threadId: string
  role: MessageRole
  content: MessageContent
  createdAt: Date
  metadata: Record<string, unknown>
  parentMessageId?: string
  status?: 'pending' | 'completed' | 'failed'
}

/**
 * Thread status
 */
export type ThreadStatus = 'active' | 'archived' | 'deleted'

/**
 * Conversation thread containing messages
 */
export interface Thread {
  id: string
  title?: string
  status: ThreadStatus
  createdAt: Date
  updatedAt: Date
  metadata: Record<string, unknown>
  messageCount: number
  lastMessageAt?: Date
  participantIds?: string[]
  /** Parent thread ID for thread hierarchy (nested conversations) */
  parentThreadId?: string
  /** Read receipts: maps participantId to the last messageId they've read */
  readReceipts?: Record<string, string>
}

/**
 * Options for creating a thread
 */
export interface CreateThreadOptions {
  id?: string
  title?: string
  metadata?: Record<string, unknown>
  participantIds?: string[]
  /** Parent thread ID for creating child threads */
  parentThreadId?: string
}

/**
 * Options for creating a message
 */
export interface CreateMessageOptions {
  id?: string
  role: MessageRole
  content: MessageContent
  metadata?: Record<string, unknown>
  parentMessageId?: string
}

/**
 * Pagination options for listing
 */
export interface PaginationOptions {
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[]
  hasMore: boolean
  nextCursor?: string
  totalCount?: number
}

/**
 * Thread filter options
 */
export interface ThreadFilterOptions {
  status?: ThreadStatus
  participantId?: string
  createdAfter?: Date
  createdBefore?: Date
  hasMessages?: boolean
  /** Filter by parent thread (null for root threads, id for children) */
  parentThreadId?: string | null
}

/**
 * Thread manager interface
 */
export interface ThreadManager {
  // Thread operations
  createThread(options?: CreateThreadOptions): Promise<Thread>
  getThread(threadId: string): Promise<Thread | null>
  updateThread(
    threadId: string,
    updates: Partial<Pick<Thread, 'title' | 'metadata' | 'status'>>
  ): Promise<Thread>
  deleteThread(threadId: string): Promise<void>
  listThreads(
    filter?: ThreadFilterOptions,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Thread>>
  archiveThread(threadId: string): Promise<Thread>

  // Message operations
  appendMessage(threadId: string, options: CreateMessageOptions): Promise<Message>
  getMessage(threadId: string, messageId: string): Promise<Message | null>
  getMessages(
    threadId: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Message>>
  updateMessage(
    threadId: string,
    messageId: string,
    updates: Partial<Pick<Message, 'content' | 'metadata' | 'status'>>
  ): Promise<Message>
  deleteMessage(threadId: string, messageId: string): Promise<void>

  // Bulk operations
  getMessageCount(threadId: string): Promise<number>
  clearMessages(threadId: string): Promise<void>
  getLatestMessage(threadId: string): Promise<Message | null>
  getMessagesBefore(threadId: string, messageId: string, limit?: number): Promise<Message[]>
  getMessagesAfter(threadId: string, messageId: string, limit?: number): Promise<Message[]>

  // Thread hierarchy operations
  getChildThreads(threadId: string): Promise<Thread[]>
  getParentThread(threadId: string): Promise<Thread | null>

  // Read tracking operations
  markAsRead(threadId: string, participantId: string, messageId?: string): Promise<void>
  getUnreadCount(threadId: string, participantId: string): Promise<number>
  getLastReadMessageId(threadId: string, participantId: string): Promise<string | null>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

// =============================================================================
// Internal Types
// =============================================================================

interface InternalMessage extends Message {
  sequence: number // For ordering concurrent messages
}

// =============================================================================
// Implementation
// =============================================================================

class InMemoryThreadManager implements ThreadManager {
  private threads: Map<string, Thread> = new Map()
  private messages: Map<string, InternalMessage[]> = new Map() // threadId -> messages
  private messageIndex: Map<string, InternalMessage> = new Map() // messageId -> message
  private sequenceCounter: Map<string, number> = new Map() // threadId -> sequence

  private readonly DEFAULT_LIMIT = 20

  // ---------------------------------------------------------------------------
  // Thread Operations
  // ---------------------------------------------------------------------------

  async createThread(options?: CreateThreadOptions): Promise<Thread> {
    const id = options?.id ?? generateId('thread')

    // Check for duplicate ID
    if (this.threads.has(id)) {
      throw new Error(`Thread with ID "${id}" already exists`)
    }

    const now = new Date()
    const thread: Thread = {
      id,
      title: options?.title,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata ?? {},
      messageCount: 0,
      participantIds: options?.participantIds,
      parentThreadId: options?.parentThreadId,
      readReceipts: {},
    }

    this.threads.set(id, thread)
    this.messages.set(id, [])
    this.sequenceCounter.set(id, 0)

    return thread
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return this.threads.get(threadId) ?? null
  }

  async updateThread(
    threadId: string,
    updates: Partial<Pick<Thread, 'title' | 'metadata' | 'status'>>
  ): Promise<Thread> {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`Thread with ID "${threadId}" not found`)
    }

    const now = new Date()
    const updated: Thread = {
      ...thread,
      title: updates.title !== undefined ? updates.title : thread.title,
      status: updates.status !== undefined ? updates.status : thread.status,
      metadata:
        updates.metadata !== undefined
          ? { ...thread.metadata, ...updates.metadata }
          : thread.metadata,
      updatedAt: now,
    }

    this.threads.set(threadId, updated)
    return updated
  }

  async deleteThread(threadId: string): Promise<void> {
    // Delete all messages in the thread
    const threadMessages = this.messages.get(threadId) ?? []
    for (const msg of threadMessages) {
      this.messageIndex.delete(msg.id)
    }

    // Delete thread data
    this.threads.delete(threadId)
    this.messages.delete(threadId)
    this.sequenceCounter.delete(threadId)
  }

  async listThreads(
    filter?: ThreadFilterOptions,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Thread>> {
    const limit = pagination?.limit ?? this.DEFAULT_LIMIT
    const order = pagination?.order ?? 'desc'

    // Get all threads and apply filters
    let threads = Array.from(this.threads.values())

    // Apply filters
    if (filter) {
      if (filter.status !== undefined) {
        threads = threads.filter((t) => t.status === filter.status)
      }

      if (filter.participantId !== undefined) {
        threads = threads.filter(
          (t) => t.participantIds?.includes(filter.participantId!) ?? false
        )
      }

      if (filter.createdAfter !== undefined) {
        threads = threads.filter(
          (t) => t.createdAt.getTime() >= filter.createdAfter!.getTime()
        )
      }

      if (filter.createdBefore !== undefined) {
        threads = threads.filter(
          (t) => t.createdAt.getTime() <= filter.createdBefore!.getTime()
        )
      }

      if (filter.hasMessages !== undefined) {
        if (filter.hasMessages) {
          threads = threads.filter((t) => t.messageCount > 0)
        } else {
          threads = threads.filter((t) => t.messageCount === 0)
        }
      }

      // Filter by parent thread
      if (filter.parentThreadId !== undefined) {
        if (filter.parentThreadId === null) {
          // Get root threads only (no parent)
          threads = threads.filter((t) => !t.parentThreadId)
        } else {
          // Get children of specific parent
          threads = threads.filter((t) => t.parentThreadId === filter.parentThreadId)
        }
      }
    }

    // Sort by createdAt
    threads.sort((a, b) => {
      const diff = a.createdAt.getTime() - b.createdAt.getTime()
      return order === 'asc' ? diff : -diff
    })

    // Apply cursor
    if (pagination?.cursor) {
      const cursorIndex = threads.findIndex((t) => t.id === pagination.cursor)
      if (cursorIndex >= 0) {
        threads = threads.slice(cursorIndex + 1)
      }
    }

    // Apply limit
    const hasMore = threads.length > limit
    const items = threads.slice(0, limit)
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : undefined

    return {
      items,
      hasMore,
      nextCursor,
    }
  }

  async archiveThread(threadId: string): Promise<Thread> {
    return this.updateThread(threadId, { status: 'archived' })
  }

  // ---------------------------------------------------------------------------
  // Message Operations
  // ---------------------------------------------------------------------------

  async appendMessage(
    threadId: string,
    options: CreateMessageOptions
  ): Promise<Message> {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`)
    }

    const id = options.id ?? generateId('msg')
    const now = new Date()

    // Get next sequence number (for ordering concurrent messages)
    const sequence = (this.sequenceCounter.get(threadId) ?? 0) + 1
    this.sequenceCounter.set(threadId, sequence)

    const message: InternalMessage = {
      id,
      threadId,
      role: options.role,
      content: options.content,
      createdAt: now,
      metadata: options.metadata ?? {},
      parentMessageId: options.parentMessageId,
      status: 'pending',
      sequence,
    }

    // Store message
    const threadMessages = this.messages.get(threadId) ?? []
    threadMessages.push(message)
    this.messages.set(threadId, threadMessages)
    this.messageIndex.set(id, message)

    // Update thread
    const updatedThread: Thread = {
      ...thread,
      messageCount: thread.messageCount + 1,
      lastMessageAt: now,
      updatedAt: now,
    }
    this.threads.set(threadId, updatedThread)

    // Return without internal sequence field
    const { sequence: _, ...publicMessage } = message
    return publicMessage
  }

  async getMessage(threadId: string, messageId: string): Promise<Message | null> {
    const message = this.messageIndex.get(messageId)
    if (!message || message.threadId !== threadId) {
      return null
    }

    const { sequence: _, ...publicMessage } = message
    return publicMessage
  }

  async getMessages(
    threadId: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Message>> {
    const limit = pagination?.limit ?? this.DEFAULT_LIMIT
    const order = pagination?.order ?? 'asc'

    let messages = [...(this.messages.get(threadId) ?? [])]

    // Sort by sequence (and timestamp as fallback) for consistent ordering
    messages.sort((a, b) => {
      // First by timestamp
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) {
        return order === 'asc' ? timeDiff : -timeDiff
      }
      // Then by sequence for concurrent messages
      const seqDiff = a.sequence - b.sequence
      return order === 'asc' ? seqDiff : -seqDiff
    })

    const totalCount = messages.length

    // Apply cursor
    if (pagination?.cursor) {
      const cursorIndex = messages.findIndex((m) => m.id === pagination.cursor)
      if (cursorIndex >= 0) {
        messages = messages.slice(cursorIndex + 1)
      }
    }

    // Apply limit
    const hasMore = messages.length > limit
    const items = messages.slice(0, limit)
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : undefined

    // Remove internal fields
    const publicItems: Message[] = items.map(({ sequence: _, ...msg }) => msg)

    return {
      items: publicItems,
      hasMore,
      nextCursor,
      totalCount,
    }
  }

  async updateMessage(
    threadId: string,
    messageId: string,
    updates: Partial<Pick<Message, 'content' | 'metadata' | 'status'>>
  ): Promise<Message> {
    const message = this.messageIndex.get(messageId)
    if (!message || message.threadId !== threadId) {
      throw new Error(`Message not found: ${messageId}`)
    }

    const updated: InternalMessage = {
      ...message,
      content: updates.content !== undefined ? updates.content : message.content,
      status: updates.status !== undefined ? updates.status : message.status,
      metadata:
        updates.metadata !== undefined
          ? { ...message.metadata, ...updates.metadata }
          : message.metadata,
    }

    // Update in index
    this.messageIndex.set(messageId, updated)

    // Update in thread messages array
    const threadMessages = this.messages.get(threadId) ?? []
    const msgIndex = threadMessages.findIndex((m) => m.id === messageId)
    if (msgIndex >= 0) {
      threadMessages[msgIndex] = updated
    }

    const { sequence: _, ...publicMessage } = updated
    return publicMessage
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const message = this.messageIndex.get(messageId)
    if (!message || message.threadId !== threadId) {
      throw new Error(`Message not found: ${messageId}`)
    }

    // Remove from index
    this.messageIndex.delete(messageId)

    // Remove from thread messages
    const threadMessages = this.messages.get(threadId) ?? []
    const msgIndex = threadMessages.findIndex((m) => m.id === messageId)
    if (msgIndex >= 0) {
      threadMessages.splice(msgIndex, 1)
    }

    // Update thread count
    const thread = this.threads.get(threadId)
    if (thread) {
      const remaining = threadMessages.length
      const lastMsg = remaining > 0 ? threadMessages[remaining - 1] : undefined
      const updatedThread: Thread = {
        ...thread,
        messageCount: remaining,
        lastMessageAt: lastMsg?.createdAt,
        updatedAt: new Date(),
      }
      this.threads.set(threadId, updatedThread)
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk Operations
  // ---------------------------------------------------------------------------

  async getMessageCount(threadId: string): Promise<number> {
    const thread = this.threads.get(threadId)
    return thread?.messageCount ?? 0
  }

  async clearMessages(threadId: string): Promise<void> {
    const threadMessages = this.messages.get(threadId) ?? []

    // Remove from index
    for (const msg of threadMessages) {
      this.messageIndex.delete(msg.id)
    }

    // Clear messages array
    this.messages.set(threadId, [])
    this.sequenceCounter.set(threadId, 0)

    // Update thread
    const thread = this.threads.get(threadId)
    if (thread) {
      const updatedThread: Thread = {
        ...thread,
        messageCount: 0,
        lastMessageAt: undefined,
        updatedAt: new Date(),
      }
      this.threads.set(threadId, updatedThread)
    }
  }

  async getLatestMessage(threadId: string): Promise<Message | null> {
    const messages = this.messages.get(threadId) ?? []
    if (messages.length === 0) {
      return null
    }

    // Sort to find latest
    const sorted = [...messages].sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return b.sequence - a.sequence
    })

    const latest = sorted[0]!
    const { sequence: _, ...publicMessage } = latest
    return publicMessage
  }

  async getMessagesBefore(
    threadId: string,
    messageId: string,
    limit: number = 10
  ): Promise<Message[]> {
    const targetMessage = this.messageIndex.get(messageId)
    if (!targetMessage || targetMessage.threadId !== threadId) {
      return []
    }

    const messages = this.messages.get(threadId) ?? []

    // Sort chronologically
    const sorted = [...messages].sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.sequence - b.sequence
    })

    // Find messages before target
    const targetIndex = sorted.findIndex((m) => m.id === messageId)
    if (targetIndex <= 0) {
      return []
    }

    const before = sorted.slice(Math.max(0, targetIndex - limit), targetIndex)
    return before.map(({ sequence: _, ...msg }) => msg)
  }

  async getMessagesAfter(
    threadId: string,
    messageId: string,
    limit: number = 10
  ): Promise<Message[]> {
    const targetMessage = this.messageIndex.get(messageId)
    if (!targetMessage || targetMessage.threadId !== threadId) {
      return []
    }

    const messages = this.messages.get(threadId) ?? []

    // Sort chronologically
    const sorted = [...messages].sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.sequence - b.sequence
    })

    // Find messages after target
    const targetIndex = sorted.findIndex((m) => m.id === messageId)
    if (targetIndex < 0 || targetIndex >= sorted.length - 1) {
      return []
    }

    const after = sorted.slice(targetIndex + 1, targetIndex + 1 + limit)
    return after.map(({ sequence: _, ...msg }) => msg)
  }

  // ---------------------------------------------------------------------------
  // Thread Hierarchy Operations
  // ---------------------------------------------------------------------------

  async getChildThreads(threadId: string): Promise<Thread[]> {
    const children = Array.from(this.threads.values()).filter(
      (t) => t.parentThreadId === threadId
    )
    // Sort by createdAt ascending
    children.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    return children
  }

  async getParentThread(threadId: string): Promise<Thread | null> {
    const thread = this.threads.get(threadId)
    if (!thread?.parentThreadId) {
      return null
    }
    return this.threads.get(thread.parentThreadId) ?? null
  }

  // ---------------------------------------------------------------------------
  // Read Tracking Operations
  // ---------------------------------------------------------------------------

  async markAsRead(
    threadId: string,
    participantId: string,
    messageId?: string
  ): Promise<void> {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`)
    }

    // If no messageId provided, mark all messages as read (use latest)
    let readUpToId = messageId
    if (!readUpToId) {
      const latestMessage = await this.getLatestMessage(threadId)
      if (!latestMessage) {
        return // No messages to mark as read
      }
      readUpToId = latestMessage.id
    }

    // Validate message exists in thread
    const message = this.messageIndex.get(readUpToId)
    if (!message || message.threadId !== threadId) {
      throw new Error(`Message not found: ${readUpToId}`)
    }

    // Update read receipt
    thread.readReceipts = thread.readReceipts ?? {}
    thread.readReceipts[participantId] = readUpToId
  }

  async getUnreadCount(threadId: string, participantId: string): Promise<number> {
    const thread = this.threads.get(threadId)
    if (!thread) {
      return 0
    }

    const messages = this.messages.get(threadId) ?? []
    if (messages.length === 0) {
      return 0
    }

    const lastReadMessageId = thread.readReceipts?.[participantId]
    if (!lastReadMessageId) {
      // No read receipt, all messages are unread
      return messages.length
    }

    const lastReadMessage = this.messageIndex.get(lastReadMessageId)
    if (!lastReadMessage) {
      // Read receipt points to deleted message, all are unread
      return messages.length
    }

    // Count messages after the last read message
    // Sort to find position of last read message
    const sorted = [...messages].sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.sequence - b.sequence
    })

    const lastReadIndex = sorted.findIndex((m) => m.id === lastReadMessageId)
    if (lastReadIndex < 0) {
      return messages.length
    }

    return sorted.length - lastReadIndex - 1
  }

  async getLastReadMessageId(
    threadId: string,
    participantId: string
  ): Promise<string | null> {
    const thread = this.threads.get(threadId)
    return thread?.readReceipts?.[participantId] ?? null
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createThreadManager(): ThreadManager {
  return new InMemoryThreadManager()
}
