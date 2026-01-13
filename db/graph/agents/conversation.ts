/**
 * Conversation Thing - Conversation Threads as Graph Things
 *
 * Represents conversation threads as Things in the graph model, enabling:
 * - Multi-agent conversation tracking
 * - Message history storage
 * - Conversation state management
 *
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 * @module db/graph/agents/conversation
 */

import { createThing, getThing, getThingsByType, updateThing, deleteThing } from '../things'
import type { GraphThing } from '../things'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Conversation type ID (conventional value for graph_things.typeId)
 */
export const CONVERSATION_TYPE_ID = 22

/**
 * Conversation type name (for graph_things.typeName)
 */
export const CONVERSATION_TYPE_NAME = 'Conversation'

/**
 * Conversation status values
 */
export const CONVERSATION_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Conversation status type
 */
export type ConversationStatus = typeof CONVERSATION_STATUS[keyof typeof CONVERSATION_STATUS]

/**
 * Individual message in a conversation
 */
export interface ConversationMessageData {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | unknown
  agentId?: string
  toolCallId?: string
  toolName?: string
  timestamp: number
}

/**
 * Conversation Thing data structure
 */
export interface ConversationThingData {
  /** Title/subject of the conversation */
  title?: string
  /** Current status */
  status: ConversationStatus
  /** Agent IDs participating in this conversation */
  participants: string[]
  /** Message history (stored inline for simple cases) */
  messages: ConversationMessageData[]
  /** Total message count */
  messageCount: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
  /** User ID who initiated the conversation */
  userId?: string
  /** Organization/tenant ID */
  orgId?: string
  /** Last activity timestamp */
  lastActivityAt: number
  /** Index signature for GraphStore compatibility */
  [key: string]: unknown
}

/**
 * Input for creating a new Conversation Thing
 */
export interface CreateConversationInput {
  /** Optional custom ID */
  id?: string
  /** Title/subject */
  title?: string
  /** Initial participants */
  participants?: string[]
  /** User ID */
  userId?: string
  /** Organization ID */
  orgId?: string
  /** Initial metadata */
  metadata?: Record<string, unknown>
}

/**
 * Conversation Thing - extends GraphThing with strongly-typed data
 */
export interface ConversationThing extends Omit<GraphThing, 'data'> {
  data: ConversationThingData
}

// ============================================================================
// CONVERSATION CRUD OPERATIONS
// ============================================================================

/**
 * Generate unique ID for a conversation
 */
function generateConversationId(): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  return `conversation:${suffix}`
}

/**
 * Create a new Conversation Thing.
 *
 * @param db - Database instance
 * @param input - Conversation creation input
 * @returns The created Conversation Thing
 *
 * @example
 * ```typescript
 * const conversation = await createConversation(db, {
 *   title: 'Feature Planning Session',
 *   participants: ['https://agents.do/priya', 'https://agents.do/ralph'],
 *   userId: 'user-123',
 * })
 * ```
 */
export async function createConversation(
  db: object,
  input: CreateConversationInput
): Promise<ConversationThing> {
  const conversationId = input.id ?? generateConversationId()
  const now = Date.now()

  const conversationData: ConversationThingData = {
    title: input.title,
    status: CONVERSATION_STATUS.ACTIVE,
    participants: input.participants ?? [],
    messages: [],
    messageCount: 0,
    ...(input.userId && { userId: input.userId }),
    ...(input.orgId && { orgId: input.orgId }),
    ...(input.metadata && { metadata: input.metadata }),
    lastActivityAt: now,
  }

  const thing = await createThing(db, {
    id: conversationId,
    typeId: CONVERSATION_TYPE_ID,
    typeName: CONVERSATION_TYPE_NAME,
    data: conversationData,
  })

  return thing as ConversationThing
}

/**
 * Get a Conversation Thing by ID.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @returns The Conversation Thing or null if not found
 */
export async function getConversation(
  db: object,
  conversationId: string
): Promise<ConversationThing | null> {
  const thing = await getThing(db, conversationId)

  if (!thing || thing.typeName !== CONVERSATION_TYPE_NAME || thing.deletedAt !== null) {
    return null
  }

  return thing as ConversationThing
}

/**
 * Get all conversations an agent participates in.
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param options - Query options
 * @returns Array of Conversation Things
 */
export async function getAgentConversations(
  db: object,
  agentId: string,
  options?: { status?: ConversationStatus; limit?: number }
): Promise<ConversationThing[]> {
  const allConversations = await getThingsByType(db, {
    typeName: CONVERSATION_TYPE_NAME,
    includeDeleted: false,
  })

  let conversations = allConversations.filter((c) => {
    const data = c.data as ConversationThingData
    return data.participants.includes(agentId)
  }) as ConversationThing[]

  // Filter by status
  if (options?.status) {
    conversations = conversations.filter((c) => c.data.status === options.status)
  }

  // Sort by lastActivityAt (descending)
  conversations.sort((a, b) => b.data.lastActivityAt - a.data.lastActivityAt)

  // Apply limit
  if (options?.limit) {
    conversations = conversations.slice(0, options.limit)
  }

  return conversations
}

/**
 * Get all active conversations.
 *
 * @param db - Database instance
 * @param options - Query options
 * @returns Array of active Conversation Things
 */
export async function getActiveConversations(
  db: object,
  options?: { limit?: number; userId?: string; orgId?: string }
): Promise<ConversationThing[]> {
  const allConversations = await getThingsByType(db, {
    typeName: CONVERSATION_TYPE_NAME,
    includeDeleted: false,
  })

  let conversations = allConversations.filter((c) => {
    const data = c.data as ConversationThingData
    if (data.status !== CONVERSATION_STATUS.ACTIVE) return false
    if (options?.userId && data.userId !== options.userId) return false
    if (options?.orgId && data.orgId !== options.orgId) return false
    return true
  }) as ConversationThing[]

  // Sort by lastActivityAt (descending)
  conversations.sort((a, b) => b.data.lastActivityAt - a.data.lastActivityAt)

  // Apply limit
  if (options?.limit) {
    conversations = conversations.slice(0, options.limit)
  }

  return conversations
}

/**
 * Add an agent to a conversation.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @param agentId - Agent ID to add
 * @returns The updated Conversation Thing or null if not found
 */
export async function addAgentToConversation(
  db: object,
  conversationId: string,
  agentId: string
): Promise<ConversationThing | null> {
  const existing = await getConversation(db, conversationId)
  if (!existing) {
    return null
  }

  // Don't add if already a participant
  if (existing.data.participants.includes(agentId)) {
    return existing
  }

  const newData: ConversationThingData = {
    ...existing.data,
    participants: [...existing.data.participants, agentId],
    lastActivityAt: Date.now(),
  }

  const updated = await updateThing(db, conversationId, { data: newData })
  return updated as ConversationThing | null
}

/**
 * Remove an agent from a conversation.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @param agentId - Agent ID to remove
 * @returns The updated Conversation Thing or null if not found
 */
export async function removeAgentFromConversation(
  db: object,
  conversationId: string,
  agentId: string
): Promise<ConversationThing | null> {
  const existing = await getConversation(db, conversationId)
  if (!existing) {
    return null
  }

  const newData: ConversationThingData = {
    ...existing.data,
    participants: existing.data.participants.filter((p) => p !== agentId),
    lastActivityAt: Date.now(),
  }

  const updated = await updateThing(db, conversationId, { data: newData })
  return updated as ConversationThing | null
}

/**
 * Add a message to a conversation.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @param message - Message to add (without id and timestamp)
 * @returns The updated Conversation Thing or null if not found
 */
export async function addMessageToConversation(
  db: object,
  conversationId: string,
  message: Omit<ConversationMessageData, 'id' | 'timestamp'>
): Promise<ConversationThing | null> {
  const existing = await getConversation(db, conversationId)
  if (!existing) {
    return null
  }

  const now = Date.now()
  const messageId = `msg-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const fullMessage: ConversationMessageData = {
    ...message,
    id: messageId,
    timestamp: now,
  }

  const newData: ConversationThingData = {
    ...existing.data,
    messages: [...existing.data.messages, fullMessage],
    messageCount: existing.data.messageCount + 1,
    lastActivityAt: now,
  }

  const updated = await updateThing(db, conversationId, { data: newData })
  return updated as ConversationThing | null
}

/**
 * Update conversation status.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @param status - New status
 * @returns The updated Conversation Thing or null if not found
 */
export async function updateConversationStatus(
  db: object,
  conversationId: string,
  status: ConversationStatus
): Promise<ConversationThing | null> {
  const existing = await getConversation(db, conversationId)
  if (!existing) {
    return null
  }

  const newData: ConversationThingData = {
    ...existing.data,
    status,
    lastActivityAt: Date.now(),
  }

  const updated = await updateThing(db, conversationId, { data: newData })
  return updated as ConversationThing | null
}

/**
 * Delete (soft-delete) a Conversation Thing.
 *
 * @param db - Database instance
 * @param conversationId - Conversation ID
 * @returns The deleted Conversation Thing or null if not found
 */
export async function deleteConversation(
  db: object,
  conversationId: string
): Promise<ConversationThing | null> {
  const deleted = await deleteThing(db, conversationId)
  return deleted as ConversationThing | null
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if data is ConversationThingData
 */
export function isConversationThingData(data: unknown): data is ConversationThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.status === 'string' &&
    Array.isArray(d.participants) &&
    Array.isArray(d.messages)
  )
}

/**
 * Type guard to check if a Thing is a Conversation Thing
 */
export function isConversationThing(thing: GraphThing): thing is ConversationThing {
  return thing.typeName === CONVERSATION_TYPE_NAME && isConversationThingData(thing.data)
}
