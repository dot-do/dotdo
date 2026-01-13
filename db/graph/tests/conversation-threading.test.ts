/**
 * Conversation Threading Tests - Graph Model
 *
 * TDD RED Phase: Failing tests for conversation threading as graph Relationships.
 *
 * Conversations are modeled as:
 * - Conversation: Thing with type 'https://agents.do/Conversation'
 * - Messages: Things with type 'https://agents.do/Message'
 * - Participants: Relationships (participatesIn, conversedWith)
 * - Message ordering: Via sequence number in relationship data
 *
 * Key features:
 * - Conversation as Thing with metadata (topic, created, status)
 * - Messages as Things linked to Conversation via 'belongsTo' relationship
 * - Participants linked via 'participatesIn' relationship
 * - 'conversedWith' relationship between participants (Agent/Human)
 * - Message threading and ordering by sequence
 * - Session continuation support
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-rs5bf - [RED] Conversation Threading - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// EXPECTED TYPE DEFINITIONS
// ============================================================================

/**
 * Conversation Thing - represents a conversation session
 */
interface Conversation {
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
interface Message {
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
 * Participant - Agent or Human in a conversation
 */
interface Participant {
  $id: string
  $type: 'https://agents.do/Agent' | 'https://agents.do/Human'
  name: string
}

/**
 * Options for creating a conversation
 */
interface CreateConversationOptions {
  participants: string[]
  topic?: string
  sessionId?: string
}

/**
 * Options for adding a message
 */
interface AddMessageOptions {
  conversationId: string
  fromParticipantId: string
  content: string
  role?: 'user' | 'assistant' | 'system'
}

// ============================================================================
// 1. CONVERSATION THING TESTS
// ============================================================================

describe('Conversation Threading', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create tables for graph model
      sqlite.exec(`
        -- Nouns table (for type references)
        CREATE TABLE nouns (
          rowid INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );

        -- Things table (Noun instances)
        CREATE TABLE graph_things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL REFERENCES nouns(rowid),
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        -- Verbs table (for relationship types)
        CREATE TABLE verbs (
          verb TEXT PRIMARY KEY,
          action TEXT,
          activity TEXT,
          event TEXT,
          reverse TEXT,
          inverse TEXT,
          description TEXT
        );

        -- Relationships table
        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL REFERENCES verbs(verb),
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        -- Indexes
        CREATE INDEX graph_things_type_name_idx ON graph_things(type_name);
        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
      `)

      // Seed nouns for Conversation and Message types
      sqlite.exec(`
        INSERT INTO nouns (name) VALUES
        ('Conversation'),
        ('Message'),
        ('Agent'),
        ('Human');
      `)

      // Seed verbs for conversation relationships
      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('participatesIn', 'participateIn', 'participatingIn', 'participatedIn', 'hasParticipant', NULL, 'Participates in a conversation'),
        ('conversedWith', 'converseWith', 'conversingWith', 'conversedWith', 'conversedWithBy', NULL, 'Had a conversation with'),
        ('belongsTo', 'belongTo', 'belongingTo', 'belongedTo', 'contains', NULL, 'Message belongs to conversation'),
        ('sentBy', 'sendBy', 'sendingBy', 'sentBy', 'sent', NULL, 'Message sent by participant'),
        ('repliesTo', 'replyTo', 'replyingTo', 'repliedTo', 'hasReply', NULL, 'Message replies to another message');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  // ==========================================================================
  // 1.1 Conversation Creation
  // ==========================================================================

  describe('Conversation Thing Creation', () => {
    it('creates a Conversation Thing with required fields', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // This test will FAIL until createConversation is implemented
      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented - waiting for db/graph/conversations.ts')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
        topic: 'Code review discussion',
      })

      expect(conversation).toBeDefined()
      expect(conversation.$type).toBe('https://agents.do/Conversation')
      expect(conversation.topic).toBe('Code review discussion')
      expect(conversation.status).toBe('active')
    })

    it('auto-generates conversation ID', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      expect(conversation.$id).toBeDefined()
      expect(typeof conversation.$id).toBe('string')
      expect(conversation.$id.length).toBeGreaterThan(0)
    })

    it('stores conversation as Thing in database', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
        topic: 'Test topic',
      })

      // Verify stored in database
      const stored = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get(conversation.$id) as {
        id: string
        type_name: string
        data: string
      }

      expect(stored).toBeDefined()
      expect(stored.type_name).toBe('Conversation')
      expect(JSON.parse(stored.data).topic).toBe('Test topic')
    })

    it('creates timestamps on conversation creation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const before = Date.now()
      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })
      const after = Date.now()

      expect(conversation.createdAt).toBeGreaterThanOrEqual(before)
      expect(conversation.createdAt).toBeLessThanOrEqual(after)
      expect(conversation.updatedAt).toBeGreaterThanOrEqual(before)
      expect(conversation.updatedAt).toBeLessThanOrEqual(after)
    })

    it('requires at least two participants', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      await expect(
        createConversation(sqlite, {
          participants: ['agent-ralph'], // Only one participant
        })
      ).rejects.toThrow(/at least two participants/i)
    })

    it('supports optional sessionId for continuity', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
        sessionId: 'session-abc123',
      })

      expect(conversation.sessionId).toBe('session-abc123')
    })
  })

  // ==========================================================================
  // 1.2 Participant Relationships
  // ==========================================================================

  describe('Participant Relationships', () => {
    it('creates participatesIn relationships for all participants', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      // Check participatesIn relationships
      const participantRels = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ? AND "to" = ?')
        .all('participatesIn', conversation.$id) as { from: string; to: string }[]

      expect(participantRels).toHaveLength(2)
      expect(participantRels.map((r) => r.from)).toContain('agent-ralph')
      expect(participantRels.map((r) => r.from)).toContain('user-alice')
    })

    it('creates conversedWith relationships between participants', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      // Check conversedWith relationship (bidirectional)
      const conversedWith = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ?')
        .all('conversedWith') as { from: string; to: string }[]

      // Should have at least one direction (or both for bidirectional)
      expect(conversedWith.length).toBeGreaterThanOrEqual(1)

      const hasRalphToAlice = conversedWith.some(
        (r) => r.from === 'agent-ralph' && r.to === 'user-alice'
      )
      const hasAliceToRalph = conversedWith.some(
        (r) => r.from === 'user-alice' && r.to === 'agent-ralph'
      )

      // At least one direction should exist
      expect(hasRalphToAlice || hasAliceToRalph).toBe(true)
    })

    it('handles multi-participant conversations (more than 2)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'agent-tom', 'user-alice'],
      })

      const participantRels = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ? AND "to" = ?')
        .all('participatesIn', conversation.$id) as { from: string }[]

      expect(participantRels).toHaveLength(3)
    })

    it('can query participants of a conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, getParticipants } = await import('../conversations').catch(() => ({
        createConversation: null,
        getParticipants: null,
      }))

      if (!createConversation || !getParticipants) {
        throw new Error('createConversation or getParticipants not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const participants = await getParticipants(sqlite, conversation.$id)

      expect(participants).toHaveLength(2)
      expect(participants).toContain('agent-ralph')
      expect(participants).toContain('user-alice')
    })
  })

  // ==========================================================================
  // 2. MESSAGE THINGS AND RELATIONSHIPS
  // ==========================================================================

  describe('Message Things', () => {
    it('adds a message as a Thing with belongsTo relationship', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('createConversation or addMessage not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const message = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Hello, Ralph!',
        role: 'user',
      })

      expect(message).toBeDefined()
      expect(message.$type).toBe('https://agents.do/Message')
      expect(message.content).toBe('Hello, Ralph!')
      expect(message.role).toBe('user')
      expect(message.conversationId).toBe(conversation.$id)
    })

    it('auto-assigns sequence numbers to messages', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('createConversation or addMessage not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const msg1 = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Hello',
      })

      const msg2 = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'Hi there!',
      })

      const msg3 = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'How are you?',
      })

      expect(msg1.sequence).toBe(1)
      expect(msg2.sequence).toBe(2)
      expect(msg3.sequence).toBe(3)
    })

    it('creates belongsTo relationship from message to conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const message = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Test message',
      })

      const belongsToRel = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ? AND "from" = ? AND "to" = ?')
        .get('belongsTo', message.$id, conversation.$id) as { id: string } | undefined

      expect(belongsToRel).toBeDefined()
    })

    it('creates sentBy relationship from message to participant', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const message = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Test message',
      })

      const sentByRel = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ? AND "from" = ? AND "to" = ?')
        .get('sentBy', message.$id, 'user-alice') as { id: string } | undefined

      expect(sentByRel).toBeDefined()
    })

    it('retrieves messages for a conversation in order', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessages } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'First',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'Second',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Third',
      })

      const messages = await getMessages(sqlite, conversation.$id)

      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe('First')
      expect(messages[0].sequence).toBe(1)
      expect(messages[1].content).toBe('Second')
      expect(messages[1].sequence).toBe(2)
      expect(messages[2].content).toBe('Third')
      expect(messages[2].sequence).toBe(3)
    })

    it('validates message from participant is in conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      // Try to add message from non-participant
      await expect(
        addMessage(sqlite, {
          conversationId: conversation.$id,
          fromParticipantId: 'user-bob', // Not a participant
          content: 'I should not be able to send this',
        })
      ).rejects.toThrow(/not a participant/i)
    })
  })

  // ==========================================================================
  // 3. MESSAGE THREADING (REPLY CHAINS)
  // ==========================================================================

  describe('Message Threading (Reply Chains)', () => {
    it('supports repliesTo relationship between messages', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, addReply } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        addReply: null,
      }))

      if (!createConversation || !addMessage || !addReply) {
        throw new Error('addReply not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const originalMsg = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'What do you think about this code?',
      })

      const replyMsg = await addReply(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'It looks good, but consider refactoring X.',
        replyToMessageId: originalMsg.$id,
      })

      // Check repliesTo relationship
      const repliesToRel = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ? AND "from" = ? AND "to" = ?')
        .get('repliesTo', replyMsg.$id, originalMsg.$id) as { id: string } | undefined

      expect(repliesToRel).toBeDefined()
    })

    it('can retrieve reply chain for a message', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, addReply, getReplies } = await import('../conversations').catch(
        () => ({
          createConversation: null,
          addMessage: null,
          addReply: null,
          getReplies: null,
        })
      )

      if (!createConversation || !addMessage || !addReply || !getReplies) {
        throw new Error('getReplies not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const originalMsg = await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Question?',
      })

      await addReply(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'Reply 1',
        replyToMessageId: originalMsg.$id,
      })

      await addReply(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Reply 2',
        replyToMessageId: originalMsg.$id,
      })

      const replies = await getReplies(sqlite, originalMsg.$id)

      expect(replies).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 4. CONVERSATION CONTINUATION ACROSS SESSIONS
  // ==========================================================================

  describe('Conversation Continuation', () => {
    it('retrieves conversation by sessionId', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, getConversationBySession } = await import('../conversations').catch(() => ({
        createConversation: null,
        getConversationBySession: null,
      }))

      if (!createConversation || !getConversationBySession) {
        throw new Error('getConversationBySession not implemented')
      }

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
        sessionId: 'session-xyz',
        topic: 'Ongoing discussion',
      })

      const retrieved = await getConversationBySession(sqlite, 'session-xyz')

      expect(retrieved).toBeDefined()
      expect(retrieved!.sessionId).toBe('session-xyz')
      expect(retrieved!.topic).toBe('Ongoing discussion')
    })

    it('can continue adding messages to existing conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessages, getConversationBySession } = await import(
        '../conversations'
      ).catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
        getConversationBySession: null,
      }))

      if (!createConversation || !addMessage || !getMessages || !getConversationBySession) {
        throw new Error('not implemented')
      }

      // Session 1: Create conversation and add messages
      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
        sessionId: 'persistent-session',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Message from session 1',
      })

      // Session 2: Resume and continue
      const resumed = await getConversationBySession(sqlite, 'persistent-session')

      await addMessage(sqlite, {
        conversationId: resumed!.$id,
        fromParticipantId: 'agent-ralph',
        content: 'Reply from session 2',
      })

      // Verify all messages are there
      const allMessages = await getMessages(sqlite, resumed!.$id)
      expect(allMessages).toHaveLength(2)
      expect(allMessages[0].content).toBe('Message from session 1')
      expect(allMessages[1].content).toBe('Reply from session 2')
    })

    it('updates conversation updatedAt when messages are added', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getConversation } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        getConversation: null,
      }))

      if (!createConversation || !addMessage || !getConversation) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const originalUpdatedAt = conversation.updatedAt

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'New message',
      })

      const updated = await getConversation(sqlite, conversation.$id)

      expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('can archive a conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, archiveConversation, getConversation } = await import('../conversations').catch(
        () => ({
          createConversation: null,
          archiveConversation: null,
          getConversation: null,
        })
      )

      if (!createConversation || !archiveConversation || !getConversation) {
        throw new Error('archiveConversation not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      await archiveConversation(sqlite, conversation.$id)

      const archived = await getConversation(sqlite, conversation.$id)
      expect(archived!.status).toBe('archived')
    })
  })

  // ==========================================================================
  // 5. AGENT-TO-AGENT CONVERSATIONS
  // ==========================================================================

  describe('Agent-to-Agent Conversations', () => {
    it('supports conversations between two agents', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessages } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'agent-tom'],
        topic: 'Code review handoff',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'Tom, can you review this implementation?',
        role: 'assistant',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-tom',
        content: 'Sure, I will take a look at the architecture.',
        role: 'assistant',
      })

      const messages = await getMessages(sqlite, conversation.$id)
      expect(messages).toHaveLength(2)

      // Verify both agents are linked via conversedWith
      const conversedWith = sqlite
        .prepare('SELECT * FROM relationships WHERE verb = ?')
        .all('conversedWith') as { from: string; to: string }[]

      const agentPair = conversedWith.find(
        (r) =>
          (r.from === 'agent-ralph' && r.to === 'agent-tom') ||
          (r.from === 'agent-tom' && r.to === 'agent-ralph')
      )

      expect(agentPair).toBeDefined()
    })

    it('tracks handoff conversations between agents', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('not implemented')
      }

      // Ralph hands off to Tom
      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'agent-tom'],
        topic: 'Handoff: Complex refactoring task',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'I have completed the initial implementation. Handing off for architecture review.',
        role: 'assistant',
      })

      // Verify the conversation data includes handoff context
      const stored = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get(conversation.$id) as {
        data: string
      }
      const data = JSON.parse(stored.data)

      expect(data.topic).toContain('Handoff')
    })
  })

  // ==========================================================================
  // 6. GRAPH TRAVERSAL QUERIES
  // ==========================================================================

  describe('Graph Traversal Queries', () => {
    it('finds all conversations a participant is in', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, getConversationsForParticipant } = await import('../conversations').catch(
        () => ({
          createConversation: null,
          getConversationsForParticipant: null,
        })
      )

      if (!createConversation || !getConversationsForParticipant) {
        throw new Error('getConversationsForParticipant not implemented')
      }

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
        topic: 'Conversation 1',
      })

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-bob'],
        topic: 'Conversation 2',
      })

      await createConversation(sqlite, {
        participants: ['agent-tom', 'user-alice'],
        topic: 'Conversation 3',
      })

      const ralphConversations = await getConversationsForParticipant(sqlite, 'agent-ralph')

      expect(ralphConversations).toHaveLength(2)
      expect(ralphConversations.map((c: Conversation) => c.topic)).toContain('Conversation 1')
      expect(ralphConversations.map((c: Conversation) => c.topic)).toContain('Conversation 2')
    })

    it('finds all entities a participant has conversed with', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, getConversationPartners } = await import('../conversations').catch(() => ({
        createConversation: null,
        getConversationPartners: null,
      }))

      if (!createConversation || !getConversationPartners) {
        throw new Error('getConversationPartners not implemented')
      }

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-bob'],
      })

      await createConversation(sqlite, {
        participants: ['agent-ralph', 'agent-tom'],
      })

      const partners = await getConversationPartners(sqlite, 'agent-ralph')

      expect(partners).toHaveLength(3)
      expect(partners).toContain('user-alice')
      expect(partners).toContain('user-bob')
      expect(partners).toContain('agent-tom')
    })

    it('counts messages per participant in a conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessageCountByParticipant } = await import(
        '../conversations'
      ).catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessageCountByParticipant: null,
      }))

      if (!createConversation || !addMessage || !getMessageCountByParticipant) {
        throw new Error('getMessageCountByParticipant not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Message 1',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'agent-ralph',
        content: 'Message 2',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Message 3',
      })

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: 'Message 4',
      })

      const counts = await getMessageCountByParticipant(sqlite, conversation.$id)

      expect(counts['user-alice']).toBe(3)
      expect(counts['agent-ralph']).toBe(1)
    })
  })

  // ==========================================================================
  // 7. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty message content', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      // Empty content should be rejected or handled gracefully
      await expect(
        addMessage(sqlite, {
          conversationId: conversation.$id,
          fromParticipantId: 'user-alice',
          content: '',
        })
      ).rejects.toThrow(/content.*empty/i)
    })

    it('handles very long message content', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessages } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const longContent = 'x'.repeat(100000) // 100KB message

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: longContent,
      })

      const messages = await getMessages(sqlite, conversation.$id)
      expect(messages[0].content).toBe(longContent)
    })

    it('handles Unicode in messages', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessages } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      const unicodeContent = 'Hello! Emoji and Japanese text here. Chinese text.'

      await addMessage(sqlite, {
        conversationId: conversation.$id,
        fromParticipantId: 'user-alice',
        content: unicodeContent,
      })

      const messages = await getMessages(sqlite, conversation.$id)
      expect(messages[0].content).toBe(unicodeContent)
    })

    it('rejects adding message to non-existent conversation', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { addMessage } = await import('../conversations').catch(() => ({
        addMessage: null,
      }))

      if (!addMessage) {
        throw new Error('addMessage not implemented')
      }

      await expect(
        addMessage(sqlite, {
          conversationId: 'non-existent-conversation',
          fromParticipantId: 'user-alice',
          content: 'Hello',
        })
      ).rejects.toThrow(/conversation.*not found/i)
    })

    it('handles concurrent message additions correctly', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const { createConversation, addMessage, getMessages } = await import('../conversations').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('not implemented')
      }

      const conversation = await createConversation(sqlite, {
        participants: ['agent-ralph', 'user-alice'],
      })

      // Add messages concurrently
      await Promise.all([
        addMessage(sqlite, {
          conversationId: conversation.$id,
          fromParticipantId: 'user-alice',
          content: 'Message A',
        }),
        addMessage(sqlite, {
          conversationId: conversation.$id,
          fromParticipantId: 'agent-ralph',
          content: 'Message B',
        }),
        addMessage(sqlite, {
          conversationId: conversation.$id,
          fromParticipantId: 'user-alice',
          content: 'Message C',
        }),
      ])

      const messages = await getMessages(sqlite, conversation.$id)
      expect(messages).toHaveLength(3)

      // All sequence numbers should be unique
      const sequences = messages.map((m: Message) => m.sequence)
      const uniqueSequences = new Set(sequences)
      expect(uniqueSequences.size).toBe(3)
    })
  })
})
