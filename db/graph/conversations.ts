/**
 * Conversation Threading Module
 *
 * Implements conversation threading as graph Relationships.
 *
 * Design:
 * - Conversations are Things with type 'https://agents.do/Conversation'
 * - Messages are Things with type 'https://agents.do/Message'
 * - Participants linked via 'participatesIn' relationship
 * - 'conversedWith' relationship between participants
 * - Messages linked via 'belongsTo' and 'sentBy' relationships
 * - Reply chains via 'repliesTo' relationship
 *
 * @see dotdo-gim4z - [GREEN] Conversation Threading - Implementation
 * @see dotdo-rs5bf - [RED] Conversation Threading - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 */

import type Database from 'better-sqlite3'

// ============================================================================
// CONSTANTS
// ============================================================================

export const CONVERSATION_TYPE = 'https://agents.do/Conversation'
export const MESSAGE_TYPE = 'https://agents.do/Message'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Conversation Thing - represents a conversation session
 */
export interface Conversation {
  $id: string
  $type: 'https://agents.do/Conversation'
  topic?: string
  status: 'active' | 'archived' | 'closed'
  sessionId?: string
  createdAt: number
  updatedAt: number
}

/**
 * Message Thing - represents a single message in a conversation
 */
export interface Message {
  $id: string
  $type: 'https://agents.do/Message'
  content: string
  role: 'user' | 'assistant' | 'system'
  sequence: number
  conversationId: string
  fromParticipantId: string
  createdAt: number
}

/**
 * Options for creating a conversation
 */
export interface CreateConversationOptions {
  participants: string[]
  topic?: string
  sessionId?: string
}

/**
 * Options for adding a message
 */
export interface AddMessageOptions {
  conversationId: string
  fromParticipantId: string
  content: string
  role?: 'user' | 'assistant' | 'system'
}

/**
 * Options for adding a reply
 */
export interface AddReplyOptions extends AddMessageOptions {
  replyToMessageId: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique ID using crypto.randomUUID() if available, else fallback
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Get the type ID for a given type name from the nouns table
 */
function getTypeId(db: Database.Database, typeName: string): number {
  const noun = db.prepare('SELECT rowid FROM nouns WHERE name = ?').get(typeName) as { rowid: number } | undefined
  if (!noun) {
    throw new Error(`Type '${typeName}' not found in nouns table`)
  }
  return noun.rowid
}

// ============================================================================
// CONVERSATION CRUD
// ============================================================================

/**
 * Create a new Conversation Thing with participant relationships
 *
 * @param db - better-sqlite3 database instance
 * @param options - Conversation creation options
 * @returns The created Conversation
 * @throws Error if less than 2 participants provided
 */
export async function createConversation(
  db: Database.Database,
  options: CreateConversationOptions
): Promise<Conversation> {
  const { participants, topic, sessionId } = options

  // Validate at least 2 participants
  if (participants.length < 2) {
    throw new Error('Conversation requires at least two participants')
  }

  const now = Date.now()
  const id = generateId()
  const typeId = getTypeId(db, 'Conversation')

  const data = JSON.stringify({
    topic: topic ?? null,
    status: 'active',
    sessionId: sessionId ?? null,
  })

  // Insert conversation Thing
  db.prepare(
    `INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, typeId, 'Conversation', data, now, now)

  // Create participatesIn relationships for each participant
  for (const participantId of participants) {
    const relId = generateId()
    db.prepare(
      `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(relId, 'participatesIn', participantId, id, null, now)
  }

  // Create conversedWith relationships between all pairs of participants
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const relId = generateId()
      // Create relationship from participant[i] to participant[j]
      try {
        db.prepare(
          `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(relId, 'conversedWith', participants[i], participants[j], JSON.stringify({ conversationId: id }), now)
      } catch {
        // Ignore if relationship already exists (unique constraint)
      }
    }
  }

  return {
    $id: id,
    $type: CONVERSATION_TYPE,
    topic,
    status: 'active',
    sessionId,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Get a Conversation by ID
 *
 * @param db - better-sqlite3 database instance
 * @param conversationId - The conversation ID
 * @returns The Conversation or null if not found
 */
export async function getConversation(
  db: Database.Database,
  conversationId: string
): Promise<Conversation | null> {
  const row = db
    .prepare('SELECT * FROM graph_things WHERE id = ? AND type_name = ?')
    .get(conversationId, 'Conversation') as {
    id: string
    data: string
    created_at: number
    updated_at: number
  } | undefined

  if (!row) {
    return null
  }

  const data = JSON.parse(row.data)

  return {
    $id: row.id,
    $type: CONVERSATION_TYPE,
    topic: data.topic,
    status: data.status,
    sessionId: data.sessionId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Get a Conversation by sessionId
 *
 * @param db - better-sqlite3 database instance
 * @param sessionId - The session ID
 * @returns The Conversation or null if not found
 */
export async function getConversationBySession(
  db: Database.Database,
  sessionId: string
): Promise<Conversation | null> {
  const rows = db
    .prepare('SELECT * FROM graph_things WHERE type_name = ?')
    .all('Conversation') as Array<{
    id: string
    data: string
    created_at: number
    updated_at: number
  }>

  for (const row of rows) {
    const data = JSON.parse(row.data)
    if (data.sessionId === sessionId) {
      return {
        $id: row.id,
        $type: CONVERSATION_TYPE,
        topic: data.topic,
        status: data.status,
        sessionId: data.sessionId,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    }
  }

  return null
}

/**
 * Archive a conversation (set status to 'archived')
 *
 * @param db - better-sqlite3 database instance
 * @param conversationId - The conversation ID
 */
export async function archiveConversation(
  db: Database.Database,
  conversationId: string
): Promise<void> {
  const now = Date.now()

  // Get current data
  const row = db
    .prepare('SELECT data FROM graph_things WHERE id = ?')
    .get(conversationId) as { data: string } | undefined

  if (!row) {
    throw new Error(`Conversation '${conversationId}' not found`)
  }

  const data = JSON.parse(row.data)
  data.status = 'archived'

  db.prepare('UPDATE graph_things SET data = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(data),
    now,
    conversationId
  )
}

// ============================================================================
// PARTICIPANT OPERATIONS
// ============================================================================

/**
 * Get all participants of a conversation
 *
 * @param db - better-sqlite3 database instance
 * @param conversationId - The conversation ID
 * @returns Array of participant IDs
 */
export async function getParticipants(
  db: Database.Database,
  conversationId: string
): Promise<string[]> {
  const rows = db
    .prepare('SELECT "from" FROM relationships WHERE verb = ? AND "to" = ?')
    .all('participatesIn', conversationId) as Array<{ from: string }>

  return rows.map((r) => r.from)
}

/**
 * Get all conversations a participant is in
 *
 * @param db - better-sqlite3 database instance
 * @param participantId - The participant ID
 * @returns Array of Conversations
 */
export async function getConversationsForParticipant(
  db: Database.Database,
  participantId: string
): Promise<Conversation[]> {
  const rels = db
    .prepare('SELECT "to" FROM relationships WHERE verb = ? AND "from" = ?')
    .all('participatesIn', participantId) as Array<{ to: string }>

  const conversations: Conversation[] = []
  for (const rel of rels) {
    const conv = await getConversation(db, rel.to)
    if (conv) {
      conversations.push(conv)
    }
  }

  return conversations
}

/**
 * Get all entities a participant has conversed with
 *
 * @param db - better-sqlite3 database instance
 * @param participantId - The participant ID
 * @returns Array of partner IDs
 */
export async function getConversationPartners(
  db: Database.Database,
  participantId: string
): Promise<string[]> {
  const partners = new Set<string>()

  // Get outgoing conversedWith relationships
  const outgoing = db
    .prepare('SELECT "to" FROM relationships WHERE verb = ? AND "from" = ?')
    .all('conversedWith', participantId) as Array<{ to: string }>

  for (const r of outgoing) {
    partners.add(r.to)
  }

  // Get incoming conversedWith relationships
  const incoming = db
    .prepare('SELECT "from" FROM relationships WHERE verb = ? AND "to" = ?')
    .all('conversedWith', participantId) as Array<{ from: string }>

  for (const r of incoming) {
    partners.add(r.from)
  }

  return Array.from(partners)
}

// ============================================================================
// MESSAGE OPERATIONS
// ============================================================================

/**
 * Add a message to a conversation
 *
 * @param db - better-sqlite3 database instance
 * @param options - Message options
 * @returns The created Message
 * @throws Error if conversation not found or participant not in conversation
 */
export async function addMessage(
  db: Database.Database,
  options: AddMessageOptions
): Promise<Message> {
  const { conversationId, fromParticipantId, content, role = 'user' } = options

  // Validate content is not empty
  if (!content || content.trim() === '') {
    throw new Error('Message content cannot be empty')
  }

  // Verify conversation exists
  const conversation = await getConversation(db, conversationId)
  if (!conversation) {
    throw new Error(`Conversation '${conversationId}' not found`)
  }

  // Verify participant is in conversation
  const participants = await getParticipants(db, conversationId)
  if (!participants.includes(fromParticipantId)) {
    throw new Error(`'${fromParticipantId}' is not a participant in this conversation`)
  }

  const now = Date.now()
  const id = generateId()
  const typeId = getTypeId(db, 'Message')

  // Get next sequence number
  const sequenceRow = db
    .prepare(
      `SELECT MAX(json_extract(data, '$.sequence')) as maxSeq
       FROM graph_things
       WHERE type_name = 'Message'
       AND json_extract(data, '$.conversationId') = ?`
    )
    .get(conversationId) as { maxSeq: number | null }

  const sequence = (sequenceRow?.maxSeq ?? 0) + 1

  const data = JSON.stringify({
    content,
    role,
    sequence,
    conversationId,
    fromParticipantId,
  })

  // Insert message Thing
  db.prepare(
    `INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, typeId, 'Message', data, now, now)

  // Create belongsTo relationship (message -> conversation)
  const belongsToRelId = generateId()
  db.prepare(
    `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(belongsToRelId, 'belongsTo', id, conversationId, null, now)

  // Create sentBy relationship (message -> participant)
  const sentByRelId = generateId()
  db.prepare(
    `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sentByRelId, 'sentBy', id, fromParticipantId, null, now)

  // Update conversation updatedAt
  db.prepare('UPDATE graph_things SET updated_at = ? WHERE id = ?').run(now, conversationId)

  return {
    $id: id,
    $type: MESSAGE_TYPE,
    content,
    role,
    sequence,
    conversationId,
    fromParticipantId,
    createdAt: now,
  }
}

/**
 * Add a reply to an existing message
 *
 * @param db - better-sqlite3 database instance
 * @param options - Reply options
 * @returns The created Message
 */
export async function addReply(
  db: Database.Database,
  options: AddReplyOptions
): Promise<Message> {
  const { replyToMessageId, ...messageOptions } = options

  // Create the message first
  const message = await addMessage(db, messageOptions)

  // Create repliesTo relationship
  const now = Date.now()
  const repliesToRelId = generateId()
  db.prepare(
    `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(repliesToRelId, 'repliesTo', message.$id, replyToMessageId, null, now)

  return message
}

/**
 * Get all messages in a conversation ordered by sequence
 *
 * @param db - better-sqlite3 database instance
 * @param conversationId - The conversation ID
 * @returns Array of Messages ordered by sequence
 */
export async function getMessages(
  db: Database.Database,
  conversationId: string
): Promise<Message[]> {
  const rows = db
    .prepare(
      `SELECT * FROM graph_things
       WHERE type_name = 'Message'
       AND json_extract(data, '$.conversationId') = ?
       ORDER BY json_extract(data, '$.sequence') ASC`
    )
    .all(conversationId) as Array<{
    id: string
    data: string
    created_at: number
  }>

  return rows.map((row) => {
    const data = JSON.parse(row.data)
    return {
      $id: row.id,
      $type: MESSAGE_TYPE as const,
      content: data.content,
      role: data.role,
      sequence: data.sequence,
      conversationId: data.conversationId,
      fromParticipantId: data.fromParticipantId,
      createdAt: row.created_at,
    }
  })
}

/**
 * Get replies to a specific message
 *
 * @param db - better-sqlite3 database instance
 * @param messageId - The message ID to get replies for
 * @returns Array of Messages that reply to the given message
 */
export async function getReplies(
  db: Database.Database,
  messageId: string
): Promise<Message[]> {
  // Get all message IDs that reply to this message
  const replyRels = db
    .prepare('SELECT "from" FROM relationships WHERE verb = ? AND "to" = ?')
    .all('repliesTo', messageId) as Array<{ from: string }>

  const messages: Message[] = []

  for (const rel of replyRels) {
    const row = db
      .prepare('SELECT * FROM graph_things WHERE id = ?')
      .get(rel.from) as {
      id: string
      data: string
      created_at: number
    } | undefined

    if (row) {
      const data = JSON.parse(row.data)
      messages.push({
        $id: row.id,
        $type: MESSAGE_TYPE,
        content: data.content,
        role: data.role,
        sequence: data.sequence,
        conversationId: data.conversationId,
        fromParticipantId: data.fromParticipantId,
        createdAt: row.created_at,
      })
    }
  }

  return messages
}

/**
 * Get message count by participant in a conversation
 *
 * @param db - better-sqlite3 database instance
 * @param conversationId - The conversation ID
 * @returns Object mapping participant ID to message count
 */
export async function getMessageCountByParticipant(
  db: Database.Database,
  conversationId: string
): Promise<Record<string, number>> {
  const messages = await getMessages(db, conversationId)

  const counts: Record<string, number> = {}
  for (const message of messages) {
    counts[message.fromParticipantId] = (counts[message.fromParticipantId] ?? 0) + 1
  }

  return counts
}
