/**
 * Unified Agent Memory System
 *
 * Consolidates three memory approaches into a single graph-backed system:
 * - agents/memory.ts: ConversationMemory with FIFO/summarize
 * - objects/Agent.ts: ctx.storage-based memory (remember, getRecentMemories)
 * - db/graph: Graph-backed persistence with Things + Relationships
 *
 * The unified interface provides:
 * - Single source of truth via graph storage
 * - Adapters for existing ConversationMemory and Agent.ts interfaces
 * - Migration path from ctx.storage
 * - Preserved API contracts for backwards compatibility
 *
 * @see dotdo-ww5cn - [REFACTOR] Consolidate Agent Memory Systems
 * @module agents/unified-memory
 */

import type { Message } from './types'
import type { GraphThing, GraphStore, CreateRelationshipInput } from '../../db/graph/types'

// ============================================================================
// Core Types
// ============================================================================

/**
 * Memory type classification
 * - short-term: Temporary context, may be pruned aggressively
 * - long-term: Important facts to preserve across sessions
 * - episodic: Event/action memories with temporal context
 * - semantic: Extracted facts and knowledge
 */
export type MemoryType = 'short-term' | 'long-term' | 'episodic' | 'semantic'

/**
 * A memory entry stored in the graph
 */
export interface MemoryThing {
  id: string
  type: MemoryType
  content: string
  embedding?: number[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Options for memory search/retrieval
 */
export interface MemorySearchOptions {
  /** Filter by memory type */
  type?: MemoryType
  /** Maximum results to return */
  limit?: number
  /** Minimum similarity score (0-1) for semantic search */
  minSimilarity?: number
  /** Time range filter */
  since?: Date
  before?: Date
}

/**
 * Options for storing a memory
 */
export interface StoreMemoryOptions {
  /** Memory type classification */
  type?: MemoryType
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Pre-computed embedding vector */
  embedding?: number[]
  /** Related entity IDs to link */
  relatedTo?: string[]
}

// ============================================================================
// Unified Memory Interface
// ============================================================================

/**
 * Unified AgentMemory interface that consolidates:
 * - ConversationMemory (messages, truncation, summarization)
 * - Agent.ts memory (remember, getRecentMemories, searchMemories)
 * - Graph-backed persistence
 */
export interface AgentMemory {
  // -------------------------------------------------------------------------
  // Message Operations (from ConversationMemory)
  // -------------------------------------------------------------------------

  /**
   * Add a message to conversation history
   */
  addMessage(message: Message): Promise<void>

  /**
   * Get all messages in current context
   */
  getMessages(): Message[]

  /**
   * Get messages optimized for LLM context window
   * Includes summary as system message if available
   */
  getContextMessages(): Message[]

  /**
   * Clear all messages
   */
  clearMessages(): void

  // -------------------------------------------------------------------------
  // Memory Operations (from Agent.ts)
  // -------------------------------------------------------------------------

  /**
   * Store a memory with optional type and metadata
   * Returns the created memory Thing
   */
  remember(content: string, options?: StoreMemoryOptions): Promise<MemoryThing>

  /**
   * Get recent memories, optionally filtered by type
   */
  getRecentMemories(limit?: number, type?: MemoryType): Promise<MemoryThing[]>

  /**
   * Search memories by content (text match or semantic)
   */
  searchMemories(query: string, options?: MemorySearchOptions): Promise<MemoryThing[]>

  // -------------------------------------------------------------------------
  // Graph Operations (new unified capabilities)
  // -------------------------------------------------------------------------

  /**
   * Get a specific memory by ID
   */
  getMemory(id: string): Promise<MemoryThing | null>

  /**
   * Update an existing memory
   */
  updateMemory(id: string, updates: Partial<Pick<MemoryThing, 'content' | 'type' | 'metadata'>>): Promise<MemoryThing | null>

  /**
   * Delete a memory
   */
  deleteMemory(id: string): Promise<boolean>

  /**
   * Link two memories with a relationship
   */
  linkMemories(fromId: string, toId: string, verb: string): Promise<void>

  /**
   * Get memories related to a specific memory
   */
  getRelatedMemories(id: string, verb?: string): Promise<MemoryThing[]>

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Persist current state (for adapters that batch writes)
   */
  flush(): Promise<void>

  /**
   * Get memory statistics
   */
  getStats(): Promise<MemoryStats>
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalMemories: number
  byType: Record<MemoryType, number>
  messageCount: number
  oldestMemory?: Date
  newestMemory?: Date
}

// ============================================================================
// Graph Memory Type Constants
// ============================================================================

/** Type ID for Memory things in the graph */
export const MEMORY_TYPE_ID = 100

/** Type name for Memory things in the graph */
export const MEMORY_TYPE_NAME = 'Memory'

/** Type ID for Message things in the graph */
export const MESSAGE_TYPE_ID = 101

/** Type name for Message things in the graph */
export const MESSAGE_TYPE_NAME = 'Message'

// ============================================================================
// Graph Memory Adapter
// ============================================================================

/**
 * Configuration for GraphMemoryAdapter
 */
export interface GraphMemoryAdapterConfig {
  /** The graph store to use */
  store: GraphStore
  /** Agent ID for scoping memories */
  agentId: string
  /** Session/conversation ID */
  sessionId?: string
  /** Maximum messages to keep in memory */
  maxMessages?: number
  /** Embedding function for semantic search */
  embedder?: (text: string) => Promise<number[]>
}

/**
 * Graph-backed implementation of AgentMemory
 *
 * Stores memories as Things in the graph with relationships for linking.
 * Messages are stored as a separate Thing type with sequence relationships.
 */
export class GraphMemoryAdapter implements AgentMemory {
  private store: GraphStore
  private agentId: string
  private sessionId: string
  private maxMessages: number
  private embedder?: (text: string) => Promise<number[]>

  // In-memory cache for messages (write-through to graph)
  private messages: Message[] = []

  constructor(config: GraphMemoryAdapterConfig) {
    this.store = config.store
    this.agentId = config.agentId
    this.sessionId = config.sessionId ?? `session-${Date.now()}`
    this.maxMessages = config.maxMessages ?? 100
    this.embedder = config.embedder
  }

  // -------------------------------------------------------------------------
  // Message Operations
  // -------------------------------------------------------------------------

  async addMessage(message: Message): Promise<void> {
    const id = message.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    // Store as Message Thing in graph
    await this.store.createThing({
      id,
      typeId: MESSAGE_TYPE_ID,
      typeName: MESSAGE_TYPE_NAME,
      data: {
        role: message.role,
        content: message.content,
        agentId: this.agentId,
        sessionId: this.sessionId,
        toolCalls: message.role === 'assistant' ? message.toolCalls : undefined,
        toolCallId: message.role === 'tool' ? message.toolCallId : undefined,
        toolName: message.role === 'tool' ? message.toolName : undefined,
        createdAt: message.createdAt?.toISOString() ?? new Date(now).toISOString(),
      },
    })

    // Link to previous message if exists
    if (this.messages.length > 0) {
      const prevId = this.messages[this.messages.length - 1]?.id
      if (prevId) {
        await this.store.createRelationship({
          id: `${prevId}-follows-${id}`,
          verb: 'follows',
          from: this.getMessageUrl(id),
          to: this.getMessageUrl(prevId),
        })
      }
    }

    // Add to local cache
    const messageWithId = { ...message, id, createdAt: message.createdAt ?? new Date(now) } as Message
    this.messages.push(messageWithId)

    // Trim if over limit
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages)
    }
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getContextMessages(): Message[] {
    // TODO: Add summary as system message when summarization is implemented
    return [...this.messages]
  }

  clearMessages(): void {
    this.messages = []
  }

  // -------------------------------------------------------------------------
  // Memory Operations
  // -------------------------------------------------------------------------

  async remember(content: string, options?: StoreMemoryOptions): Promise<MemoryThing> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const type = options?.type ?? 'short-term'
    const now = Date.now()

    // Compute embedding if embedder available and not provided
    let embedding = options?.embedding
    if (!embedding && this.embedder) {
      embedding = await this.embedder(content)
    }

    // Store as Memory Thing in graph
    const thing = await this.store.createThing({
      id,
      typeId: MEMORY_TYPE_ID,
      typeName: MEMORY_TYPE_NAME,
      data: {
        content,
        type,
        agentId: this.agentId,
        sessionId: this.sessionId,
        embedding,
        metadata: options?.metadata,
      },
    })

    // Create relationships to related entities
    if (options?.relatedTo) {
      for (const relatedId of options.relatedTo) {
        await this.store.createRelationship({
          id: `${id}-relates-to-${relatedId}`,
          verb: 'relates-to',
          from: this.getMemoryUrl(id),
          to: this.getMemoryUrl(relatedId),
        })
      }
    }

    return this.thingToMemory(thing)
  }

  async getRecentMemories(limit: number = 10, type?: MemoryType): Promise<MemoryThing[]> {
    const things = await this.store.getThingsByType({
      typeName: MEMORY_TYPE_NAME,
      limit,
      orderBy: 'createdAt',
      orderDirection: 'desc',
    })

    // Filter by agent and optionally type
    let filtered = things.filter((t) => {
      const data = t.data as Record<string, unknown> | null
      return data?.agentId === this.agentId
    })

    if (type) {
      filtered = filtered.filter((t) => {
        const data = t.data as Record<string, unknown> | null
        return data?.type === type
      })
    }

    return filtered.slice(0, limit).map(this.thingToMemory)
  }

  async searchMemories(query: string, options?: MemorySearchOptions): Promise<MemoryThing[]> {
    const limit = options?.limit ?? 10
    const lowerQuery = query.toLowerCase()

    // Get all memories for this agent
    const things = await this.store.getThingsByType({
      typeName: MEMORY_TYPE_NAME,
      limit: 100, // Get more for filtering
      orderBy: 'createdAt',
      orderDirection: 'desc',
    })

    let filtered = things.filter((t) => {
      const data = t.data as Record<string, unknown> | null
      if (data?.agentId !== this.agentId) return false

      // Type filter
      if (options?.type && data?.type !== options.type) return false

      // Time filters
      if (options?.since && t.createdAt < options.since.getTime()) return false
      if (options?.before && t.createdAt > options.before.getTime()) return false

      // Text search
      const content = (data?.content as string) ?? ''
      return content.toLowerCase().includes(lowerQuery)
    })

    // TODO: Add semantic search using embeddings when embedder is available

    return filtered.slice(0, limit).map(this.thingToMemory)
  }

  // -------------------------------------------------------------------------
  // Graph Operations
  // -------------------------------------------------------------------------

  async getMemory(id: string): Promise<MemoryThing | null> {
    const thing = await this.store.getThing(id)
    if (!thing || thing.typeName !== MEMORY_TYPE_NAME) return null
    return this.thingToMemory(thing)
  }

  async updateMemory(
    id: string,
    updates: Partial<Pick<MemoryThing, 'content' | 'type' | 'metadata'>>
  ): Promise<MemoryThing | null> {
    const existing = await this.store.getThing(id)
    if (!existing || existing.typeName !== MEMORY_TYPE_NAME) return null

    const existingData = existing.data as Record<string, unknown> | null
    const updatedData = {
      ...existingData,
      ...(updates.content !== undefined && { content: updates.content }),
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.metadata !== undefined && { metadata: updates.metadata }),
    }

    const updated = await this.store.updateThing(id, { data: updatedData })
    return updated ? this.thingToMemory(updated) : null
  }

  async deleteMemory(id: string): Promise<boolean> {
    const deleted = await this.store.deleteThing(id)
    return deleted !== null
  }

  async linkMemories(fromId: string, toId: string, verb: string): Promise<void> {
    await this.store.createRelationship({
      id: `${fromId}-${verb}-${toId}`,
      verb,
      from: this.getMemoryUrl(fromId),
      to: this.getMemoryUrl(toId),
    })
  }

  async getRelatedMemories(id: string, verb?: string): Promise<MemoryThing[]> {
    const relationships = await this.store.queryRelationshipsFrom(
      this.getMemoryUrl(id),
      verb ? { verb } : undefined
    )

    const memories: MemoryThing[] = []
    for (const rel of relationships) {
      // Extract ID from URL
      const toId = rel.to.split('/').pop()
      if (toId) {
        const thing = await this.store.getThing(toId)
        if (thing && thing.typeName === MEMORY_TYPE_NAME) {
          memories.push(this.thingToMemory(thing))
        }
      }
    }

    return memories
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async flush(): Promise<void> {
    // GraphStore writes are immediate, nothing to flush
  }

  async getStats(): Promise<MemoryStats> {
    const things = await this.store.getThingsByType({
      typeName: MEMORY_TYPE_NAME,
      limit: 1000,
    })

    const agentThings = things.filter((t) => {
      const data = t.data as Record<string, unknown> | null
      return data?.agentId === this.agentId
    })

    const byType: Record<MemoryType, number> = {
      'short-term': 0,
      'long-term': 0,
      episodic: 0,
      semantic: 0,
    }

    let oldest: number | undefined
    let newest: number | undefined

    for (const thing of agentThings) {
      const data = thing.data as Record<string, unknown> | null
      const type = (data?.type as MemoryType) ?? 'short-term'
      byType[type]++

      if (!oldest || thing.createdAt < oldest) oldest = thing.createdAt
      if (!newest || thing.createdAt > newest) newest = thing.createdAt
    }

    return {
      totalMemories: agentThings.length,
      byType,
      messageCount: this.messages.length,
      oldestMemory: oldest ? new Date(oldest) : undefined,
      newestMemory: newest ? new Date(newest) : undefined,
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getMemoryUrl(id: string): string {
    return `do://${this.agentId}/memories/${id}`
  }

  private getMessageUrl(id: string): string {
    return `do://${this.agentId}/messages/${id}`
  }

  private thingToMemory = (thing: GraphThing): MemoryThing => {
    const data = thing.data as Record<string, unknown> | null
    return {
      id: thing.id,
      type: (data?.type as MemoryType) ?? 'short-term',
      content: (data?.content as string) ?? '',
      embedding: data?.embedding as number[] | undefined,
      metadata: data?.metadata as Record<string, unknown> | undefined,
      createdAt: new Date(thing.createdAt),
      updatedAt: new Date(thing.updatedAt),
    }
  }
}

// ============================================================================
// ConversationMemory Adapter
// ============================================================================

/**
 * Adapter that wraps AgentMemory to provide ConversationMemory interface
 * for backwards compatibility with existing code.
 */
export class ConversationMemoryAdapter {
  private memory: AgentMemory
  private id: string

  constructor(memory: AgentMemory, conversationId?: string) {
    this.memory = memory
    this.id = conversationId ?? `conv-${Date.now()}`
  }

  getConversationId(): string {
    return this.id
  }

  addMessage(message: Message): void {
    // Fire and forget - ConversationMemory.addMessage is sync
    this.memory.addMessage(message).catch(console.error)
  }

  addMessages(messages: Message[]): void {
    for (const message of messages) {
      this.addMessage(message)
    }
  }

  getMessages(): Message[] {
    return this.memory.getMessages()
  }

  getContextMessages(): Message[] {
    return this.memory.getContextMessages()
  }

  clear(): void {
    this.memory.clearMessages()
  }

  getLastMessage(): Message | undefined {
    const messages = this.memory.getMessages()
    return messages[messages.length - 1]
  }

  getMessageById(id: string): Message | undefined {
    return this.memory.getMessages().find((m) => m.id === id)
  }

  // Summarization methods - delegate to underlying memory or no-op
  getSummary() {
    return undefined // TODO: Implement when summarization is added to AgentMemory
  }

  setSummary() {
    // TODO: Implement when summarization is added to AgentMemory
  }

  async truncate(): Promise<void> {
    // TODO: Implement truncation strategy in AgentMemory
  }

  async getTokenCount(): Promise<number> {
    // Simple estimation
    const messages = this.memory.getMessages()
    let total = 0
    for (const message of messages) {
      total += 4 // Role overhead
      if (typeof message.content === 'string') {
        total += Math.ceil(message.content.length / 4)
      }
    }
    return total
  }

  setTokenCounter() {
    // TODO: Implement when needed
  }

  setSummarizer() {
    // TODO: Implement when needed
  }

  exportState() {
    return {
      id: this.id,
      messages: this.memory.getMessages(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  importState(state: { id: string; messages: Message[] }): void {
    this.id = state.id
    this.memory.clearMessages()
    for (const message of state.messages) {
      this.addMessage(message)
    }
  }
}

// ============================================================================
// Agent.ts Memory Adapter
// ============================================================================

/**
 * Adapter that provides Agent.ts-compatible memory interface
 * backed by unified AgentMemory.
 *
 * This allows migrating from ctx.storage-based memory to graph-backed memory
 * while preserving the existing API.
 */
export class AgentMemoryBridge {
  private memory: AgentMemory

  constructor(memory: AgentMemory) {
    this.memory = memory
  }

  /**
   * Store a memory (Agent.ts API)
   */
  async remember(content: string, type: MemoryType = 'short-term'): Promise<MemoryThing> {
    return this.memory.remember(content, { type })
  }

  /**
   * Get recent memories (Agent.ts API)
   */
  async getRecentMemories(limit: number = 10): Promise<MemoryThing[]> {
    return this.memory.getRecentMemories(limit)
  }

  /**
   * Search memories by content (Agent.ts API)
   */
  async searchMemories(query: string): Promise<MemoryThing[]> {
    return this.memory.searchMemories(query)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a graph-backed AgentMemory instance
 */
export function createGraphMemory(config: GraphMemoryAdapterConfig): AgentMemory {
  return new GraphMemoryAdapter(config)
}

/**
 * Create a ConversationMemory adapter from an AgentMemory
 */
export function toConversationMemory(memory: AgentMemory, conversationId?: string): ConversationMemoryAdapter {
  return new ConversationMemoryAdapter(memory, conversationId)
}

/**
 * Create an Agent.ts-compatible memory bridge from an AgentMemory
 */
export function toAgentMemoryBridge(memory: AgentMemory): AgentMemoryBridge {
  return new AgentMemoryBridge(memory)
}

// ============================================================================
// In-Memory Implementation (for testing and non-DO contexts)
// ============================================================================

/**
 * Simple in-memory implementation of AgentMemory for testing
 * and contexts where graph storage is not available.
 */
export class InMemoryAgentMemory implements AgentMemory {
  private messages: Message[] = []
  private memories: Map<string, MemoryThing & { _seq: number }> = new Map()
  private relationships: Map<string, { from: string; to: string; verb: string }[]> = new Map()
  private maxMessages: number
  private memorySequence: number = 0

  constructor(maxMessages: number = 100) {
    this.maxMessages = maxMessages
  }

  async addMessage(message: Message): Promise<void> {
    const id = message.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.messages.push({
      ...message,
      id,
      createdAt: message.createdAt ?? new Date(),
    } as Message)

    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages)
    }
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getContextMessages(): Message[] {
    return [...this.messages]
  }

  clearMessages(): void {
    this.messages = []
  }

  async remember(content: string, options?: StoreMemoryOptions): Promise<MemoryThing> {
    const seq = ++this.memorySequence
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date()
    const memoryWithSeq: MemoryThing & { _seq: number } = {
      id,
      type: options?.type ?? 'short-term',
      content,
      embedding: options?.embedding,
      metadata: options?.metadata,
      createdAt: now,
      updatedAt: now,
      _seq: seq,
    }
    this.memories.set(id, memoryWithSeq)

    if (options?.relatedTo) {
      for (const relatedId of options.relatedTo) {
        await this.linkMemories(id, relatedId, 'relates-to')
      }
    }

    // Return without the internal _seq property
    const { _seq, ...memory } = memoryWithSeq
    return memory
  }

  async getRecentMemories(limit: number = 10, type?: MemoryType): Promise<MemoryThing[]> {
    let memories = Array.from(this.memories.values())

    if (type) {
      memories = memories.filter((m) => m.type === type)
    }

    // Sort by sequence number descending (most recent first)
    // This ensures stable ordering even for memories created in the same millisecond
    return memories
      .sort((a, b) => b._seq - a._seq)
      .slice(0, limit)
      .map(({ _seq, ...memory }) => memory)
  }

  async searchMemories(query: string, options?: MemorySearchOptions): Promise<MemoryThing[]> {
    const lowerQuery = query.toLowerCase()
    const limit = options?.limit ?? 10

    let memoriesWithSeq = Array.from(this.memories.values())

    memoriesWithSeq = memoriesWithSeq.filter((m) => {
      if (options?.type && m.type !== options.type) return false
      if (options?.since && m.createdAt < options.since) return false
      if (options?.before && m.createdAt > options.before) return false
      return m.content.toLowerCase().includes(lowerQuery)
    })

    return memoriesWithSeq.slice(0, limit).map(({ _seq, ...memory }) => memory)
  }

  async getMemory(id: string): Promise<MemoryThing | null> {
    const memoryWithSeq = this.memories.get(id)
    if (!memoryWithSeq) return null
    const { _seq, ...memory } = memoryWithSeq
    return memory
  }

  async updateMemory(
    id: string,
    updates: Partial<Pick<MemoryThing, 'content' | 'type' | 'metadata'>>
  ): Promise<MemoryThing | null> {
    const existing = this.memories.get(id)
    if (!existing) return null

    const updated: MemoryThing & { _seq: number } = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }
    this.memories.set(id, updated)
    const { _seq, ...memory } = updated
    return memory
  }

  async deleteMemory(id: string): Promise<boolean> {
    return this.memories.delete(id)
  }

  async linkMemories(fromId: string, toId: string, verb: string): Promise<void> {
    const key = fromId
    const existing = this.relationships.get(key) ?? []
    existing.push({ from: fromId, to: toId, verb })
    this.relationships.set(key, existing)
  }

  async getRelatedMemories(id: string, verb?: string): Promise<MemoryThing[]> {
    const rels = this.relationships.get(id) ?? []
    const filtered = verb ? rels.filter((r) => r.verb === verb) : rels

    const memories: MemoryThing[] = []
    for (const rel of filtered) {
      const memoryWithSeq = this.memories.get(rel.to)
      if (memoryWithSeq) {
        const { _seq, ...memory } = memoryWithSeq
        memories.push(memory)
      }
    }
    return memories
  }

  async flush(): Promise<void> {
    // No-op for in-memory
  }

  async getStats(): Promise<MemoryStats> {
    const memories = Array.from(this.memories.values())
    const byType: Record<MemoryType, number> = {
      'short-term': 0,
      'long-term': 0,
      episodic: 0,
      semantic: 0,
    }

    let oldest: Date | undefined
    let newest: Date | undefined

    for (const memory of memories) {
      byType[memory.type]++
      if (!oldest || memory.createdAt < oldest) oldest = memory.createdAt
      if (!newest || memory.createdAt > newest) newest = memory.createdAt
    }

    return {
      totalMemories: memories.length,
      byType,
      messageCount: this.messages.length,
      oldestMemory: oldest,
      newestMemory: newest,
    }
  }
}

/**
 * Create an in-memory AgentMemory for testing
 */
export function createInMemoryAgentMemory(maxMessages?: number): AgentMemory {
  return new InMemoryAgentMemory(maxMessages)
}

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Legacy memory type from Agent.ts ctx.storage
 */
interface LegacyMemory {
  id: string
  type: 'short-term' | 'long-term' | 'episodic'
  content: string
  embedding?: number[]
  createdAt: Date
}

/**
 * Migration statistics returned after migration completes
 */
export interface MigrationResult {
  /** Number of memories successfully migrated */
  migratedCount: number
  /** Number of memories that failed to migrate */
  failedCount: number
  /** IDs of successfully migrated memories */
  migratedIds: string[]
  /** Errors encountered during migration */
  errors: Array<{ id: string; error: string }>
}

/**
 * Options for memory migration
 */
export interface MigrationOptions {
  /** Whether to delete source memories after successful migration */
  deleteAfterMigration?: boolean
  /** Batch size for migration (default: 50) */
  batchSize?: number
  /** Callback for progress updates */
  onProgress?: (migrated: number, total: number) => void
}

/**
 * Migrate memories from DurableObjectStorage (ctx.storage) to GraphBackedAgentMemory.
 *
 * This function reads all memories stored with the `memory:` prefix in ctx.storage
 * and migrates them to the unified graph-backed memory system.
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * const graphMemory = createGraphMemory({ store, agentId: this.ctx.id.toString() })
 * const result = await migrateMemory(this.ctx.storage, graphMemory)
 * console.log(`Migrated ${result.migratedCount} memories`)
 * ```
 *
 * @param source - The DurableObjectStorage to read memories from
 * @param target - The AgentMemory to migrate memories to
 * @param options - Migration options
 * @returns Migration result with counts and any errors
 */
export async function migrateMemory(
  source: DurableObjectStorage,
  target: AgentMemory,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const { deleteAfterMigration = false, batchSize = 50, onProgress } = options

  const result: MigrationResult = {
    migratedCount: 0,
    failedCount: 0,
    migratedIds: [],
    errors: [],
  }

  // Get all memories from ctx.storage
  const memoryMap = await source.list({ prefix: 'memory:' })
  const memories = Array.from(memoryMap.entries())
  const total = memories.length

  // Process in batches
  for (let i = 0; i < memories.length; i += batchSize) {
    const batch = memories.slice(i, i + batchSize)

    for (const [key, value] of batch) {
      try {
        const legacyMemory = value as LegacyMemory

        // Map legacy type to unified type
        const memoryType: MemoryType =
          legacyMemory.type === 'short-term'
            ? 'short-term'
            : legacyMemory.type === 'long-term'
              ? 'long-term'
              : legacyMemory.type === 'episodic'
                ? 'episodic'
                : 'short-term'

        // Migrate to new memory system
        await target.remember(legacyMemory.content, {
          type: memoryType,
          embedding: legacyMemory.embedding,
          metadata: {
            migratedFrom: 'ctx.storage',
            originalId: legacyMemory.id,
            originalCreatedAt: legacyMemory.createdAt.toISOString(),
          },
        })

        result.migratedCount++
        result.migratedIds.push(legacyMemory.id)

        // Delete from source if requested
        if (deleteAfterMigration) {
          await source.delete(key)
        }
      } catch (error) {
        result.failedCount++
        result.errors.push({
          id: key.replace('memory:', ''),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total)
    }
  }

  return result
}

/**
 * Check if a DurableObjectStorage has legacy memories that need migration.
 *
 * @param storage - The DurableObjectStorage to check
 * @returns true if there are memories with the legacy `memory:` prefix
 */
export async function hasLegacyMemories(storage: DurableObjectStorage): Promise<boolean> {
  const memoryMap = await storage.list({ prefix: 'memory:', limit: 1 })
  return memoryMap.size > 0
}

/**
 * Count the number of legacy memories in DurableObjectStorage.
 *
 * @param storage - The DurableObjectStorage to check
 * @returns The number of memories stored with the `memory:` prefix
 */
export async function countLegacyMemories(storage: DurableObjectStorage): Promise<number> {
  const memoryMap = await storage.list({ prefix: 'memory:' })
  return memoryMap.size
}

// ============================================================================
// Re-exports from memory-graph.ts for backwards compatibility
// ============================================================================

// Re-export the standalone graph helper functions from memory-graph.ts
// These are used directly with GraphStore instances
export {
  GraphBackedMemory,
  createAgentMemory as createGraphBackedMemory,
  getRecentMemories as getGraphRecentMemories,
  searchMemories as searchGraphMemories,
  shareMemory,
  MEMORY_TYPE_ID as GRAPH_MEMORY_TYPE_ID,
  MEMORY_TYPE_NAME as GRAPH_MEMORY_TYPE_NAME,
  VERB_REMEMBERS,
  VERB_SHARED_WITH,
  type GraphBackedMemoryConfig,
  type MemoryThingData,
  type MemoryImportance,
  type Memory as GraphMemory,
} from './memory-graph'

export default {
  createGraphMemory,
  createInMemoryAgentMemory,
  toConversationMemory,
  toAgentMemoryBridge,
  migrateMemory,
  hasLegacyMemories,
  countLegacyMemories,
}
