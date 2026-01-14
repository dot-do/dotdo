/**
 * Conversation Threading Tests - Agent Perspective
 *
 * TDD RED Phase: Failing tests for conversation threading as Relationships.
 *
 * This test file focuses on the agent-centric view of conversations:
 * - Agents and Humans as participants in Conversations
 * - Messages as Things linked via Relationships
 * - `conversedWith` relationship between agents/humans
 * - Session continuity across multiple interactions
 * - Multi-participant group conversations
 *
 * Uses REAL SQLite via SQLiteGraphStore - NO MOCKS (per project testing philosophy).
 *
 * @see dotdo-rs5bf - [RED] Conversation Threading - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import type { GraphThing, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Conversation Thing - represents a conversation session
 */
interface ConversationThingData {
  topic?: string
  status: 'active' | 'archived' | 'closed'
  sessionId?: string
  metadata?: Record<string, unknown>
}

/**
 * Message Thing - represents a single message in a conversation
 */
interface MessageThingData {
  content: string
  role: 'user' | 'assistant' | 'system'
  sequence: number
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * Agent Thing - simplified for conversation tests
 */
interface AgentThingData {
  name: string
  model: string
  mode: 'autonomous' | 'supervised' | 'interactive'
}

/**
 * Human Thing - represents a human participant
 */
interface HumanThingData {
  name: string
  email?: string
  role?: string
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const TYPE_ID_CONVERSATION = 300
const TYPE_ID_MESSAGE = 301
const TYPE_ID_AGENT = 100
const TYPE_ID_HUMAN = 400

const CONVERSATION_TYPE_URI = 'https://agents.do/Conversation'
const MESSAGE_TYPE_URI = 'https://agents.do/Message'
const AGENT_TYPE_URI = 'https://agents.do/Agent'
const HUMAN_TYPE_URI = 'https://agents.do/Human'

// Relationship verbs
const VERB_PARTICIPATES_IN = 'participatesIn'
const VERB_CONVERSED_WITH = 'conversedWith'
const VERB_BELONGS_TO = 'belongsTo'
const VERB_SENT_BY = 'sentBy'
const VERB_REPLIES_TO = 'repliesTo'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create an Agent Thing in the graph
 */
async function createAgentThing(
  store: SQLiteGraphStore,
  id: string,
  data: AgentThingData
): Promise<GraphThing> {
  return store.createThing({
    id,
    typeId: TYPE_ID_AGENT,
    typeName: 'Agent',
    data,
  })
}

/**
 * Create a Human Thing in the graph
 */
async function createHumanThing(
  store: SQLiteGraphStore,
  id: string,
  data: HumanThingData
): Promise<GraphThing> {
  return store.createThing({
    id,
    typeId: TYPE_ID_HUMAN,
    typeName: 'Human',
    data,
  })
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Conversation Threading (Agent Perspective)', () => {
  let store: SQLiteGraphStore
  let ralphAgent: GraphThing
  let aliceUser: GraphThing

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // Create test participants
    ralphAgent = await createAgentThing(store, 'agent-ralph', {
      name: 'Ralph',
      model: 'claude-sonnet-4-20250514',
      mode: 'autonomous',
    })

    aliceUser = await createHumanThing(store, 'user-alice', {
      name: 'Alice',
      email: 'alice@example.com',
    })
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. CONVERSATION CREATION TESTS
  // ==========================================================================

  describe('Conversation Thing Creation', () => {
    it('[RED] creates a Conversation Thing with participants', async () => {
      // This test will FAIL until createConversation is implemented
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented - waiting for agents/conversation-graph.ts')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        topic: 'Code review discussion',
      })

      expect(conversation).toBeDefined()
      expect(conversation.$type).toBe(CONVERSATION_TYPE_URI)
      expect(conversation.topic).toBe('Code review discussion')
      expect(conversation.status).toBe('active')
    })

    it('[RED] auto-generates unique conversation ID', async () => {
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conv1 = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const conv2 = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      expect(conv1.$id).not.toBe(conv2.$id)
      expect(conv1.$id).toMatch(/^conv-/)
    })

    it('[RED] stores conversation as Thing in graph', async () => {
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        topic: 'Test topic',
      })

      // Should be retrievable via GraphStore
      const retrieved = await store.getThing(conversation.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.typeName).toBe('Conversation')
      expect((retrieved?.data as ConversationThingData).topic).toBe('Test topic')
    })

    it('[RED] creates timestamps on conversation creation', async () => {
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const before = Date.now()
      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })
      const after = Date.now()

      expect(conversation.$createdAt).toBeGreaterThanOrEqual(before)
      expect(conversation.$createdAt).toBeLessThanOrEqual(after)
      expect(conversation.$updatedAt).toBeGreaterThanOrEqual(before)
    })

    it('[RED] requires at least two participants', async () => {
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      await expect(
        createConversation(store, {
          participants: [ralphAgent.id], // Only one participant
        })
      ).rejects.toThrow(/at least two participants/i)
    })

    it('[RED] supports optional sessionId for continuity', async () => {
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        sessionId: 'session-abc123',
      })

      expect(conversation.sessionId).toBe('session-abc123')
    })
  })

  // ==========================================================================
  // 2. PARTICIPANT RELATIONSHIPS TESTS
  // ==========================================================================

  describe('Participant Relationships', () => {
    it('[RED] creates participatesIn relationships for all participants', async () => {
      const { createConversation, getParticipants } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        getParticipants: null,
      }))

      if (!createConversation || !getParticipants) {
        throw new Error('conversation-graph functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      // Query relationships
      const rels = await store.queryRelationshipsTo(`do://conversations/${conversation.$id}`, {
        verb: VERB_PARTICIPATES_IN,
      })

      expect(rels.length).toBe(2)
    })

    it('[RED] creates conversedWith relationship between participants', async () => {
      const { createConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
      }))

      if (!createConversation) {
        throw new Error('createConversation not implemented')
      }

      await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      // Check for conversedWith relationship
      const rels = await store.queryRelationshipsByVerb(VERB_CONVERSED_WITH)

      expect(rels.length).toBeGreaterThanOrEqual(1)

      const hasConversedWith = rels.some(
        (r) =>
          (r.from.includes(ralphAgent.id) && r.to.includes(aliceUser.id)) ||
          (r.from.includes(aliceUser.id) && r.to.includes(ralphAgent.id))
      )

      expect(hasConversedWith).toBe(true)
    })

    it('[RED] handles multi-participant conversations (more than 2)', async () => {
      const { createConversation, getParticipants } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        getParticipants: null,
      }))

      if (!createConversation || !getParticipants) {
        throw new Error('functions not implemented')
      }

      // Create another agent
      const tomAgent = await createAgentThing(store, 'agent-tom', {
        name: 'Tom',
        model: 'claude-opus-4-20250514',
        mode: 'supervised',
      })

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, tomAgent.id, aliceUser.id],
        topic: 'Group discussion',
      })

      const participants = await getParticipants(store, conversation.$id)

      expect(participants.length).toBe(3)
      expect(participants).toContain(ralphAgent.id)
      expect(participants).toContain(tomAgent.id)
      expect(participants).toContain(aliceUser.id)
    })

    it('[RED] can query participants of a conversation', async () => {
      const { createConversation, getParticipants } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        getParticipants: null,
      }))

      if (!createConversation || !getParticipants) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const participants = await getParticipants(store, conversation.$id)

      expect(participants).toHaveLength(2)
      expect(participants).toContain(ralphAgent.id)
      expect(participants).toContain(aliceUser.id)
    })
  })

  // ==========================================================================
  // 3. MESSAGE THINGS AND RELATIONSHIPS TESTS
  // ==========================================================================

  describe('Message Things', () => {
    it('[RED] adds a message as a Thing with belongsTo relationship', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const message = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Hello, Ralph!',
        role: 'user',
      })

      expect(message).toBeDefined()
      expect(message.$type).toBe(MESSAGE_TYPE_URI)
      expect(message.content).toBe('Hello, Ralph!')
      expect(message.role).toBe('user')
    })

    it('[RED] auto-assigns sequence numbers to messages', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const msg1 = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Hello',
      })

      const msg2 = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Hi there!',
      })

      const msg3 = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'How are you?',
      })

      expect(msg1.sequence).toBe(1)
      expect(msg2.sequence).toBe(2)
      expect(msg3.sequence).toBe(3)
    })

    it('[RED] creates belongsTo relationship from message to conversation', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const message = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Test message',
      })

      // Check belongsTo relationship
      const rels = await store.queryRelationshipsFrom(`do://messages/${message.$id}`, {
        verb: VERB_BELONGS_TO,
      })

      expect(rels.length).toBe(1)
      expect(rels[0].to).toContain(conversation.$id)
    })

    it('[RED] creates sentBy relationship from message to participant', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const message = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Test message',
      })

      // Check sentBy relationship
      const rels = await store.queryRelationshipsFrom(`do://messages/${message.$id}`, {
        verb: VERB_SENT_BY,
      })

      expect(rels.length).toBe(1)
      expect(rels[0].to).toContain(aliceUser.id)
    })

    it('[RED] retrieves messages for a conversation in order', async () => {
      const { createConversation, addMessage, getMessages } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'First',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Second',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Third',
      })

      const messages = await getMessages(store, conversation.$id)

      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe('First')
      expect(messages[0].sequence).toBe(1)
      expect(messages[1].content).toBe('Second')
      expect(messages[1].sequence).toBe(2)
      expect(messages[2].content).toBe('Third')
      expect(messages[2].sequence).toBe(3)
    })

    it('[RED] validates message sender is a participant', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      // Try to add message from non-participant
      await expect(
        addMessage(store, {
          conversationId: conversation.$id,
          fromParticipantId: 'user-bob', // Not a participant
          content: 'I should not be able to send this',
        })
      ).rejects.toThrow(/not a participant/i)
    })
  })

  // ==========================================================================
  // 4. MESSAGE THREADING (REPLY CHAINS) TESTS
  // ==========================================================================

  describe('Message Threading (Reply Chains)', () => {
    it('[RED] supports repliesTo relationship between messages', async () => {
      const { createConversation, addMessage, addReply } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        addReply: null,
      }))

      if (!createConversation || !addMessage || !addReply) {
        throw new Error('addReply not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const originalMsg = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'What do you think about this code?',
      })

      const replyMsg = await addReply(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'It looks good, but consider refactoring X.',
        replyToMessageId: originalMsg.$id,
      })

      // Check repliesTo relationship
      const rels = await store.queryRelationshipsFrom(`do://messages/${replyMsg.$id}`, {
        verb: VERB_REPLIES_TO,
      })

      expect(rels.length).toBe(1)
      expect(rels[0].to).toContain(originalMsg.$id)
    })

    it('[RED] can retrieve reply chain for a message', async () => {
      const { createConversation, addMessage, addReply, getReplies } = await import('../conversation-graph').catch(
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

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const originalMsg = await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Question?',
      })

      await addReply(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Reply 1',
        replyToMessageId: originalMsg.$id,
      })

      await addReply(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Reply 2',
        replyToMessageId: originalMsg.$id,
      })

      const replies = await getReplies(store, originalMsg.$id)

      expect(replies).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 5. CONVERSATION CONTINUATION ACROSS SESSIONS TESTS
  // ==========================================================================

  describe('Conversation Continuation', () => {
    it('[RED] retrieves conversation by sessionId', async () => {
      const { createConversation, getConversationBySession } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        getConversationBySession: null,
      }))

      if (!createConversation || !getConversationBySession) {
        throw new Error('getConversationBySession not implemented')
      }

      await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        sessionId: 'session-xyz',
        topic: 'Ongoing discussion',
      })

      const retrieved = await getConversationBySession(store, 'session-xyz')

      expect(retrieved).toBeDefined()
      expect(retrieved!.sessionId).toBe('session-xyz')
      expect(retrieved!.topic).toBe('Ongoing discussion')
    })

    it('[RED] can continue adding messages to existing conversation', async () => {
      const { createConversation, addMessage, getMessages, getConversationBySession } = await import(
        '../conversation-graph'
      ).catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
        getConversationBySession: null,
      }))

      if (!createConversation || !addMessage || !getMessages || !getConversationBySession) {
        throw new Error('functions not implemented')
      }

      // Session 1: Create conversation and add messages
      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        sessionId: 'persistent-session',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Message from session 1',
      })

      // Session 2: Resume and continue
      const resumed = await getConversationBySession(store, 'persistent-session')

      await addMessage(store, {
        conversationId: resumed!.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Reply from session 2',
      })

      // Verify all messages are there
      const allMessages = await getMessages(store, resumed!.$id)
      expect(allMessages).toHaveLength(2)
      expect(allMessages[0].content).toBe('Message from session 1')
      expect(allMessages[1].content).toBe('Reply from session 2')
    })

    it('[RED] updates conversation updatedAt when messages are added', async () => {
      const { createConversation, addMessage, getConversation } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getConversation: null,
      }))

      if (!createConversation || !addMessage || !getConversation) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const originalUpdatedAt = conversation.$updatedAt

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'New message',
      })

      const updated = await getConversation(store, conversation.$id)

      expect(updated!.$updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('[RED] can archive a conversation', async () => {
      const { createConversation, archiveConversation, getConversation } = await import('../conversation-graph').catch(
        () => ({
          createConversation: null,
          archiveConversation: null,
          getConversation: null,
        })
      )

      if (!createConversation || !archiveConversation || !getConversation) {
        throw new Error('archiveConversation not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      await archiveConversation(store, conversation.$id)

      const archived = await getConversation(store, conversation.$id)
      expect(archived!.status).toBe('archived')
    })
  })

  // ==========================================================================
  // 6. AGENT-TO-AGENT CONVERSATIONS TESTS
  // ==========================================================================

  describe('Agent-to-Agent Conversations', () => {
    let tomAgent: GraphThing

    beforeEach(async () => {
      tomAgent = await createAgentThing(store, 'agent-tom', {
        name: 'Tom',
        model: 'claude-opus-4-20250514',
        mode: 'supervised',
      })
    })

    it('[RED] supports conversations between two agents', async () => {
      const { createConversation, addMessage, getMessages } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, tomAgent.id],
        topic: 'Code review handoff',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Tom, can you review this implementation?',
        role: 'assistant',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: tomAgent.id,
        content: 'Sure, I will take a look at the architecture.',
        role: 'assistant',
      })

      const messages = await getMessages(store, conversation.$id)
      expect(messages).toHaveLength(2)

      // Verify both agents are linked via conversedWith
      const conversedWithRels = await store.queryRelationshipsByVerb(VERB_CONVERSED_WITH)

      const agentPair = conversedWithRels.find(
        (r) =>
          (r.from.includes(ralphAgent.id) && r.to.includes(tomAgent.id)) ||
          (r.from.includes(tomAgent.id) && r.to.includes(ralphAgent.id))
      )

      expect(agentPair).toBeDefined()
    })

    it('[RED] tracks handoff conversations between agents', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      // Ralph hands off to Tom
      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, tomAgent.id],
        topic: 'Handoff: Complex refactoring task',
        metadata: { isHandoff: true, fromAgent: ralphAgent.id, toAgent: tomAgent.id },
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'I have completed the initial implementation. Handing off for architecture review.',
        role: 'assistant',
      })

      // Verify the conversation metadata includes handoff context
      const retrieved = await store.getThing(conversation.$id)
      const data = retrieved?.data as ConversationThingData

      expect(data.topic).toContain('Handoff')
      expect(data.metadata?.isHandoff).toBe(true)
    })

    it('[RED] supports three-way agent conversations', async () => {
      const { createConversation, addMessage, getMessages } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('functions not implemented')
      }

      const priyaAgent = await createAgentThing(store, 'agent-priya', {
        name: 'Priya',
        model: 'claude-opus-4-20250514',
        mode: 'supervised',
      })

      const conversation = await createConversation(store, {
        participants: [priyaAgent.id, ralphAgent.id, tomAgent.id],
        topic: 'Product planning meeting',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: priyaAgent.id,
        content: 'Here is the spec for the new feature.',
        role: 'assistant',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'I can implement this in 3 days.',
        role: 'assistant',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: tomAgent.id,
        content: 'Let me review the architecture implications.',
        role: 'assistant',
      })

      const messages = await getMessages(store, conversation.$id)
      expect(messages).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 7. GRAPH TRAVERSAL QUERIES TESTS
  // ==========================================================================

  describe('Graph Traversal Queries', () => {
    it('[RED] finds all conversations a participant is in', async () => {
      const { createConversation, getConversationsForParticipant } = await import('../conversation-graph').catch(
        () => ({
          createConversation: null,
          getConversationsForParticipant: null,
        })
      )

      if (!createConversation || !getConversationsForParticipant) {
        throw new Error('getConversationsForParticipant not implemented')
      }

      const bobUser = await createHumanThing(store, 'user-bob', { name: 'Bob' })

      await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        topic: 'Conversation 1',
      })

      await createConversation(store, {
        participants: [ralphAgent.id, bobUser.id],
        topic: 'Conversation 2',
      })

      await createConversation(store, {
        participants: [aliceUser.id, bobUser.id],
        topic: 'Conversation 3 (no Ralph)',
      })

      const ralphConversations = await getConversationsForParticipant(store, ralphAgent.id)

      expect(ralphConversations).toHaveLength(2)
      expect(ralphConversations.map((c: { topic: string }) => c.topic)).toContain('Conversation 1')
      expect(ralphConversations.map((c: { topic: string }) => c.topic)).toContain('Conversation 2')
    })

    it('[RED] finds all entities a participant has conversed with', async () => {
      const { createConversation, getConversationPartners } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        getConversationPartners: null,
      }))

      if (!createConversation || !getConversationPartners) {
        throw new Error('getConversationPartners not implemented')
      }

      const bobUser = await createHumanThing(store, 'user-bob', { name: 'Bob' })
      const tomAgent = await createAgentThing(store, 'agent-tom', {
        name: 'Tom',
        model: 'claude-opus-4-20250514',
        mode: 'supervised',
      })

      await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      await createConversation(store, {
        participants: [ralphAgent.id, bobUser.id],
      })

      await createConversation(store, {
        participants: [ralphAgent.id, tomAgent.id],
      })

      const partners = await getConversationPartners(store, ralphAgent.id)

      expect(partners).toHaveLength(3)
      expect(partners).toContain(aliceUser.id)
      expect(partners).toContain(bobUser.id)
      expect(partners).toContain(tomAgent.id)
    })

    it('[RED] counts messages per participant in a conversation', async () => {
      const { createConversation, addMessage, getMessageCountByParticipant } = await import(
        '../conversation-graph'
      ).catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessageCountByParticipant: null,
      }))

      if (!createConversation || !addMessage || !getMessageCountByParticipant) {
        throw new Error('getMessageCountByParticipant not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Message 1',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Message 2',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Message 3',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Message 4',
      })

      const counts = await getMessageCountByParticipant(store, conversation.$id)

      expect(counts[aliceUser.id]).toBe(3)
      expect(counts[ralphAgent.id]).toBe(1)
    })
  })

  // ==========================================================================
  // 8. EDGE CASES TESTS
  // ==========================================================================

  describe('Edge Cases', () => {
    it('[RED] handles empty message content', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      // Empty content should be rejected
      await expect(
        addMessage(store, {
          conversationId: conversation.$id,
          fromParticipantId: aliceUser.id,
          content: '',
        })
      ).rejects.toThrow(/content.*empty/i)
    })

    it('[RED] handles very long message content', async () => {
      const { createConversation, addMessage, getMessages } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const longContent = 'x'.repeat(100000) // 100KB message

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: longContent,
      })

      const messages = await getMessages(store, conversation.$id)
      expect(messages[0].content).toBe(longContent)
    })

    it('[RED] handles Unicode in messages', async () => {
      const { createConversation, addMessage, getMessages } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      const unicodeContent = 'Hello! Japanese text. Chinese text. Arabic text.'

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: unicodeContent,
      })

      const messages = await getMessages(store, conversation.$id)
      expect(messages[0].content).toBe(unicodeContent)
    })

    it('[RED] rejects adding message to non-existent conversation', async () => {
      const { addMessage } = await import('../conversation-graph').catch(() => ({
        addMessage: null,
      }))

      if (!addMessage) {
        throw new Error('addMessage not implemented')
      }

      await expect(
        addMessage(store, {
          conversationId: 'non-existent-conversation',
          fromParticipantId: aliceUser.id,
          content: 'Hello',
        })
      ).rejects.toThrow(/conversation.*not found/i)
    })

    it('[RED] handles concurrent message additions correctly', async () => {
      const { createConversation, addMessage, getMessages } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
        getMessages: null,
      }))

      if (!createConversation || !addMessage || !getMessages) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      // Add messages concurrently
      await Promise.all([
        addMessage(store, {
          conversationId: conversation.$id,
          fromParticipantId: aliceUser.id,
          content: 'Message A',
        }),
        addMessage(store, {
          conversationId: conversation.$id,
          fromParticipantId: ralphAgent.id,
          content: 'Message B',
        }),
        addMessage(store, {
          conversationId: conversation.$id,
          fromParticipantId: aliceUser.id,
          content: 'Message C',
        }),
      ])

      const messages = await getMessages(store, conversation.$id)
      expect(messages).toHaveLength(3)

      // All sequence numbers should be unique
      const sequences = messages.map((m: { sequence: number }) => m.sequence)
      const uniqueSequences = new Set(sequences)
      expect(uniqueSequences.size).toBe(3)
    })
  })

  // ==========================================================================
  // 9. [RED] CONVERSATION-GRAPH MODULE API TESTS
  // ==========================================================================

  describe('[RED] conversation-graph Module API (Not Yet Implemented)', () => {
    it('exports createConversation function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module).not.toBeNull()
      expect(module?.createConversation).toBeDefined()
      expect(typeof module?.createConversation).toBe('function')
    })

    it('exports addMessage function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.addMessage).toBeDefined()
      expect(typeof module?.addMessage).toBe('function')
    })

    it('exports getMessages function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getMessages).toBeDefined()
      expect(typeof module?.getMessages).toBe('function')
    })

    it('exports getParticipants function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getParticipants).toBeDefined()
      expect(typeof module?.getParticipants).toBe('function')
    })

    it('exports getConversation function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getConversation).toBeDefined()
      expect(typeof module?.getConversation).toBe('function')
    })

    it('exports getConversationBySession function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getConversationBySession).toBeDefined()
      expect(typeof module?.getConversationBySession).toBe('function')
    })

    it('exports archiveConversation function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.archiveConversation).toBeDefined()
      expect(typeof module?.archiveConversation).toBe('function')
    })

    it('exports getConversationsForParticipant function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getConversationsForParticipant).toBeDefined()
      expect(typeof module?.getConversationsForParticipant).toBe('function')
    })

    it('exports getConversationPartners function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getConversationPartners).toBeDefined()
      expect(typeof module?.getConversationPartners).toBe('function')
    })

    it('exports addReply function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.addReply).toBeDefined()
      expect(typeof module?.addReply).toBe('function')
    })

    it('exports getReplies function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getReplies).toBeDefined()
      expect(typeof module?.getReplies).toBe('function')
    })

    it('exports getMessageCountByParticipant function', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.getMessageCountByParticipant).toBeDefined()
      expect(typeof module?.getMessageCountByParticipant).toBe('function')
    })

    it('exports CONVERSATION_TYPE_URI constant', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.CONVERSATION_TYPE_URI).toBe('https://agents.do/Conversation')
    })

    it('exports MESSAGE_TYPE_URI constant', async () => {
      const module = await import('../conversation-graph').catch(() => null)

      expect(module?.MESSAGE_TYPE_URI).toBe('https://agents.do/Message')
    })
  })

  // ==========================================================================
  // 10. INTEGRATION WITH EXISTING MEMORY SYSTEM TESTS
  // ==========================================================================

  describe('Integration with Memory System', () => {
    it('[RED] conversation messages can be linked to episodic memory', async () => {
      const { createConversation, addMessage } = await import('../conversation-graph').catch(() => ({
        createConversation: null,
        addMessage: null,
      }))

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
        topic: 'Customer support interaction',
      })

      // Add a message that should create an episodic memory
      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'I am having trouble with my account login',
        metadata: { createEpisodicMemory: true },
      })

      // The episodic memory should reference this conversation
      // This test documents the expected integration pattern
      const things = await store.getThingsByType({ typeName: 'Memory', limit: 10 })
      // In the GREEN phase, we expect the memory system to link conversations
      expect(things).toBeDefined() // Placeholder until integration is implemented
    })

    it('[RED] conversation context available for agent memory retrieval', async () => {
      const { createConversation, addMessage, getConversationContext } = await import('../conversation-graph').catch(
        () => ({
          createConversation: null,
          addMessage: null,
          getConversationContext: null,
        })
      )

      if (!createConversation || !addMessage) {
        throw new Error('functions not implemented')
      }

      if (!getConversationContext) {
        throw new Error('getConversationContext not implemented - needed for memory integration')
      }

      const conversation = await createConversation(store, {
        participants: [ralphAgent.id, aliceUser.id],
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: aliceUser.id,
        content: 'Question 1',
      })

      await addMessage(store, {
        conversationId: conversation.$id,
        fromParticipantId: ralphAgent.id,
        content: 'Answer 1',
      })

      // getConversationContext should return messages formatted for agent context
      const context = await getConversationContext(store, conversation.$id)

      expect(context).toBeDefined()
      expect(Array.isArray(context.messages)).toBe(true)
      expect(context.messages.length).toBe(2)
    })
  })
})
