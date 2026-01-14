/**
 * Multi-Participant Management Tests - TDD RED Phase
 *
 * Comprehensive tests for participant management in conversations:
 * - Adding participants with roles (customer, agent, AI)
 * - Removing participants
 * - Role-based permissions
 * - Message attribution to participants
 * - Participant metadata
 * - Active/inactive status
 *
 * Following TDD, these tests are written FIRST and should FAIL until implementation is complete.
 *
 * @module db/primitives/conversation/tests/participants
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Participant role in a conversation
 */
type ParticipantRole = 'customer' | 'agent' | 'ai' | 'system' | 'observer'

/**
 * Participant status
 */
type ParticipantStatus = 'active' | 'inactive' | 'left' | 'removed'

/**
 * Permission types for participants
 */
type Permission =
  | 'send_message'
  | 'read_messages'
  | 'edit_own_messages'
  | 'delete_own_messages'
  | 'delete_any_message'
  | 'add_participant'
  | 'remove_participant'
  | 'change_participant_role'
  | 'close_conversation'
  | 'reopen_conversation'
  | 'assign_conversation'
  | 'transfer_conversation'
  | 'view_internal_notes'
  | 'add_internal_notes'
  | 'modify_metadata'

/**
 * Role configuration with default permissions
 */
interface RoleConfig {
  role: ParticipantRole
  permissions: Permission[]
  canEscalate?: boolean
  canBeAssigned?: boolean
  maxConcurrentConversations?: number
}

/**
 * Individual participant in a conversation
 */
interface Participant {
  id: string
  conversationId: string
  userId: string
  role: ParticipantRole
  status: ParticipantStatus
  displayName: string
  avatarUrl?: string
  joinedAt: Date
  leftAt?: Date
  lastSeenAt?: Date
  lastMessageAt?: Date
  messageCount: number
  metadata: Record<string, unknown>
}

/**
 * Options for adding a participant
 */
interface AddParticipantOptions {
  userId: string
  role: ParticipantRole
  displayName?: string
  avatarUrl?: string
  metadata?: Record<string, unknown>
}

/**
 * Message with participant attribution
 */
interface AttributedMessage {
  id: string
  conversationId: string
  participantId: string
  content: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  createdAt: Date
  metadata: Record<string, unknown>
}

/**
 * Participant manager interface
 */
interface ParticipantManager {
  // Participant CRUD
  addParticipant(conversationId: string, options: AddParticipantOptions): Promise<Participant>
  removeParticipant(conversationId: string, participantId: string, reason?: string): Promise<void>
  getParticipant(conversationId: string, participantId: string): Promise<Participant | null>
  getParticipantByUserId(conversationId: string, userId: string): Promise<Participant | null>
  listParticipants(conversationId: string, filter?: { status?: ParticipantStatus; role?: ParticipantRole }): Promise<Participant[]>
  updateParticipant(conversationId: string, participantId: string, updates: Partial<Pick<Participant, 'displayName' | 'avatarUrl' | 'metadata' | 'status'>>): Promise<Participant>

  // Role management
  changeRole(conversationId: string, participantId: string, newRole: ParticipantRole): Promise<Participant>
  getRoleConfig(role: ParticipantRole): RoleConfig
  setRoleConfig(config: RoleConfig): void

  // Permission checks
  hasPermission(conversationId: string, participantId: string, permission: Permission): Promise<boolean>
  getPermissions(conversationId: string, participantId: string): Promise<Permission[]>
  grantPermission(conversationId: string, participantId: string, permission: Permission): Promise<void>
  revokePermission(conversationId: string, participantId: string, permission: Permission): Promise<void>

  // Message attribution
  sendMessage(conversationId: string, participantId: string, content: string, metadata?: Record<string, unknown>): Promise<AttributedMessage>
  getMessagesByParticipant(conversationId: string, participantId: string, limit?: number): Promise<AttributedMessage[]>

  // Activity tracking
  markSeen(conversationId: string, participantId: string): Promise<void>
  setStatus(conversationId: string, participantId: string, status: ParticipantStatus): Promise<Participant>
  getActiveParticipants(conversationId: string): Promise<Participant[]>

  // Conversation assignment
  assignToAgent(conversationId: string, agentUserId: string): Promise<Participant>
  unassign(conversationId: string): Promise<void>
  getAssignedAgent(conversationId: string): Promise<Participant | null>
  transferToAgent(conversationId: string, fromAgentId: string, toAgentUserId: string): Promise<Participant>
}

/**
 * Factory function placeholder - this should be imported from implementation
 * Currently stubbed to make tests fail (RED phase)
 */
function createParticipantManager(): ParticipantManager {
  // RED phase: This stub will cause tests to fail
  // Implementation should be provided in db/primitives/conversation/participants.ts
  throw new Error('ParticipantManager not implemented - RED phase')
}

// =============================================================================
// TDD Cycle 1: Add Participant with Role
// =============================================================================

describe('Add participant with role', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should add a customer participant', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_customer_1',
      role: 'customer',
      displayName: 'John Doe',
    })

    expect(participant.id).toBeDefined()
    expect(participant.conversationId).toBe(conversationId)
    expect(participant.userId).toBe('user_customer_1')
    expect(participant.role).toBe('customer')
    expect(participant.displayName).toBe('John Doe')
    expect(participant.status).toBe('active')
  })

  it('should add an agent participant', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_agent_1',
      role: 'agent',
      displayName: 'Support Agent Sarah',
    })

    expect(participant.role).toBe('agent')
    expect(participant.displayName).toBe('Support Agent Sarah')
  })

  it('should add an AI participant', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'ai_bot_1',
      role: 'ai',
      displayName: 'Support Bot',
      metadata: {
        model: 'claude-3-opus',
        temperature: 0.7,
      },
    })

    expect(participant.role).toBe('ai')
    expect(participant.metadata.model).toBe('claude-3-opus')
  })

  it('should add a system participant', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'system',
      role: 'system',
      displayName: 'System',
    })

    expect(participant.role).toBe('system')
  })

  it('should add an observer participant', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'supervisor_1',
      role: 'observer',
      displayName: 'Supervisor Mike',
    })

    expect(participant.role).toBe('observer')
  })

  it('should set joinedAt timestamp on add', async () => {
    const before = new Date()

    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const after = new Date()

    expect(participant.joinedAt).toBeInstanceOf(Date)
    expect(participant.joinedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(participant.joinedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should initialize messageCount to 0', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    expect(participant.messageCount).toBe(0)
  })

  it('should initialize with empty metadata if not provided', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    expect(participant.metadata).toEqual({})
  })

  it('should store avatar URL', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      avatarUrl: 'https://example.com/avatar.png',
    })

    expect(participant.avatarUrl).toBe('https://example.com/avatar.png')
  })

  it('should reject duplicate user in same conversation', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await expect(
      manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })
    ).rejects.toThrow(/already.*participant/i)
  })

  it('should allow same user in different conversations', async () => {
    const p1 = await manager.addParticipant('conv_1', {
      userId: 'user_1',
      role: 'customer',
    })

    const p2 = await manager.addParticipant('conv_2', {
      userId: 'user_1',
      role: 'customer',
    })

    expect(p1.conversationId).toBe('conv_1')
    expect(p2.conversationId).toBe('conv_2')
  })

  it('should generate display name from userId if not provided', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_john_doe_123',
      role: 'customer',
    })

    expect(participant.displayName).toBeDefined()
    expect(participant.displayName.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// TDD Cycle 2: Remove Participant
// =============================================================================

describe('Remove participant', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should remove a participant from conversation', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await manager.removeParticipant(conversationId, participant.id)

    const result = await manager.getParticipant(conversationId, participant.id)
    expect(result?.status).toBe('removed')
  })

  it('should set leftAt timestamp on removal', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const before = new Date()
    await manager.removeParticipant(conversationId, participant.id)
    const after = new Date()

    const removed = await manager.getParticipant(conversationId, participant.id)

    expect(removed?.leftAt).toBeInstanceOf(Date)
    expect(removed?.leftAt?.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(removed?.leftAt?.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should store removal reason in metadata', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await manager.removeParticipant(conversationId, participant.id, 'Customer requested removal')

    const removed = await manager.getParticipant(conversationId, participant.id)
    expect(removed?.metadata.removalReason).toBe('Customer requested removal')
  })

  it('should throw when removing non-existent participant', async () => {
    await expect(
      manager.removeParticipant(conversationId, 'nonexistent_participant')
    ).rejects.toThrow(/participant not found/i)
  })

  it('should not list removed participants in active list by default', async () => {
    const p1 = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })
    await manager.addParticipant(conversationId, {
      userId: 'user_2',
      role: 'agent',
    })

    await manager.removeParticipant(conversationId, p1.id)

    const active = await manager.listParticipants(conversationId, { status: 'active' })
    expect(active).toHaveLength(1)
    expect(active[0].userId).toBe('user_2')
  })

  it('should list removed participants when filtering by status', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await manager.removeParticipant(conversationId, participant.id)

    const removed = await manager.listParticipants(conversationId, { status: 'removed' })
    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe(participant.id)
  })

  it('should allow rejoin after removal by adding again', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const participants = await manager.listParticipants(conversationId)
    await manager.removeParticipant(conversationId, participants[0].id)

    // Re-adding the same user should work
    const rejoined = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    expect(rejoined.status).toBe('active')
    expect(rejoined.joinedAt.getTime()).toBeGreaterThan(participants[0].joinedAt.getTime())
  })
})

// =============================================================================
// TDD Cycle 3: Role-Based Permissions
// =============================================================================

describe('Role-based permissions', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  describe('Default role permissions', () => {
    it('should give customers basic messaging permissions', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'send_message')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'read_messages')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'edit_own_messages')).toBe(true)
    })

    it('should restrict customers from admin actions', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'remove_participant')).toBe(false)
      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(false)
      expect(await manager.hasPermission(conversationId, participant.id, 'view_internal_notes')).toBe(false)
    })

    it('should give agents full conversation management permissions', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'agent_1',
        role: 'agent',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'send_message')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'add_participant')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'view_internal_notes')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'add_internal_notes')).toBe(true)
    })

    it('should give AI participants messaging and tool permissions', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'ai_1',
        role: 'ai',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'send_message')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'read_messages')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'modify_metadata')).toBe(true)
    })

    it('should give AI limited admin permissions', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'ai_1',
        role: 'ai',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'remove_participant')).toBe(false)
      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(false)
    })

    it('should give observers read-only access', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'observer_1',
        role: 'observer',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'read_messages')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'view_internal_notes')).toBe(true)
      expect(await manager.hasPermission(conversationId, participant.id, 'send_message')).toBe(false)
      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(false)
    })

    it('should give system role all permissions', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'system',
        role: 'system',
      })

      const permissions = await manager.getPermissions(conversationId, participant.id)

      expect(permissions).toContain('send_message')
      expect(permissions).toContain('close_conversation')
      expect(permissions).toContain('remove_participant')
      expect(permissions).toContain('modify_metadata')
    })
  })

  describe('Custom role configuration', () => {
    it('should allow configuring role permissions', () => {
      const customConfig: RoleConfig = {
        role: 'customer',
        permissions: ['send_message', 'read_messages', 'close_conversation'],
        canEscalate: true,
      }

      manager.setRoleConfig(customConfig)
      const config = manager.getRoleConfig('customer')

      expect(config.permissions).toContain('close_conversation')
      expect(config.canEscalate).toBe(true)
    })

    it('should apply custom config to new participants', async () => {
      manager.setRoleConfig({
        role: 'customer',
        permissions: ['send_message', 'read_messages', 'close_conversation'],
      })

      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(true)
    })
  })

  describe('Permission grants and revokes', () => {
    it('should grant additional permission to participant', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      // Customer doesn't have this by default
      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(false)

      await manager.grantPermission(conversationId, participant.id, 'close_conversation')

      expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(true)
    })

    it('should revoke permission from participant', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'agent_1',
        role: 'agent',
      })

      // Agent has this by default
      expect(await manager.hasPermission(conversationId, participant.id, 'remove_participant')).toBe(true)

      await manager.revokePermission(conversationId, participant.id, 'remove_participant')

      expect(await manager.hasPermission(conversationId, participant.id, 'remove_participant')).toBe(false)
    })

    it('should get all permissions for participant', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      const permissions = await manager.getPermissions(conversationId, participant.id)

      expect(Array.isArray(permissions)).toBe(true)
      expect(permissions).toContain('send_message')
      expect(permissions).toContain('read_messages')
    })
  })
})

// =============================================================================
// TDD Cycle 4: Message Attribution to Participant
// =============================================================================

describe('Message attribution to participant', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should attribute message to participant', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const message = await manager.sendMessage(conversationId, participant.id, 'Hello, I need help!')

    expect(message.participantId).toBe(participant.id)
    expect(message.content).toBe('Hello, I need help!')
    expect(message.conversationId).toBe(conversationId)
  })

  it('should set message role based on participant role', async () => {
    const customer = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const agent = await manager.addParticipant(conversationId, {
      userId: 'agent_1',
      role: 'agent',
    })

    const ai = await manager.addParticipant(conversationId, {
      userId: 'ai_1',
      role: 'ai',
    })

    const customerMsg = await manager.sendMessage(conversationId, customer.id, 'Customer message')
    const agentMsg = await manager.sendMessage(conversationId, agent.id, 'Agent message')
    const aiMsg = await manager.sendMessage(conversationId, ai.id, 'AI message')

    expect(customerMsg.role).toBe('user')
    expect(agentMsg.role).toBe('user') // Agents also send as 'user' role
    expect(aiMsg.role).toBe('assistant')
  })

  it('should set createdAt timestamp on message', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const before = new Date()
    const message = await manager.sendMessage(conversationId, participant.id, 'Test')
    const after = new Date()

    expect(message.createdAt).toBeInstanceOf(Date)
    expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(message.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should increment participant messageCount', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    expect(participant.messageCount).toBe(0)

    await manager.sendMessage(conversationId, participant.id, 'Message 1')
    await manager.sendMessage(conversationId, participant.id, 'Message 2')
    await manager.sendMessage(conversationId, participant.id, 'Message 3')

    const updated = await manager.getParticipant(conversationId, participant.id)
    expect(updated?.messageCount).toBe(3)
  })

  it('should update participant lastMessageAt', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    expect(participant.lastMessageAt).toBeUndefined()

    const message = await manager.sendMessage(conversationId, participant.id, 'Hello')

    const updated = await manager.getParticipant(conversationId, participant.id)
    expect(updated?.lastMessageAt?.getTime()).toBe(message.createdAt.getTime())
  })

  it('should get messages by participant', async () => {
    const customer = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const agent = await manager.addParticipant(conversationId, {
      userId: 'agent_1',
      role: 'agent',
    })

    await manager.sendMessage(conversationId, customer.id, 'Customer message 1')
    await manager.sendMessage(conversationId, agent.id, 'Agent message 1')
    await manager.sendMessage(conversationId, customer.id, 'Customer message 2')

    const customerMessages = await manager.getMessagesByParticipant(conversationId, customer.id)
    expect(customerMessages).toHaveLength(2)
    expect(customerMessages[0].content).toBe('Customer message 1')
    expect(customerMessages[1].content).toBe('Customer message 2')
  })

  it('should limit messages returned', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    for (let i = 0; i < 10; i++) {
      await manager.sendMessage(conversationId, participant.id, `Message ${i}`)
    }

    const messages = await manager.getMessagesByParticipant(conversationId, participant.id, 5)
    expect(messages).toHaveLength(5)
  })

  it('should store message metadata', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'ai_1',
      role: 'ai',
    })

    const message = await manager.sendMessage(
      conversationId,
      participant.id,
      'AI response',
      {
        model: 'claude-3-opus',
        tokens: { prompt: 100, completion: 50 },
        latencyMs: 1200,
      }
    )

    expect(message.metadata.model).toBe('claude-3-opus')
    expect((message.metadata.tokens as Record<string, number>).prompt).toBe(100)
  })

  it('should throw when sending message without permission', async () => {
    const observer = await manager.addParticipant(conversationId, {
      userId: 'observer_1',
      role: 'observer',
    })

    await expect(
      manager.sendMessage(conversationId, observer.id, 'I should not be able to send this')
    ).rejects.toThrow(/permission.*denied/i)
  })

  it('should throw when participant does not exist', async () => {
    await expect(
      manager.sendMessage(conversationId, 'nonexistent_participant', 'Hello')
    ).rejects.toThrow(/participant not found/i)
  })

  it('should throw when participant is removed', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await manager.removeParticipant(conversationId, participant.id)

    await expect(
      manager.sendMessage(conversationId, participant.id, 'Hello')
    ).rejects.toThrow(/participant.*removed/i)
  })
})

// =============================================================================
// TDD Cycle 5: Participant Metadata
// =============================================================================

describe('Participant metadata', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should store participant metadata on creation', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      metadata: {
        source: 'web_chat',
        browser: 'Chrome',
        location: 'San Francisco',
      },
    })

    expect(participant.metadata.source).toBe('web_chat')
    expect(participant.metadata.browser).toBe('Chrome')
    expect(participant.metadata.location).toBe('San Francisco')
  })

  it('should update participant metadata', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      metadata: { key1: 'value1' },
    })

    const updated = await manager.updateParticipant(conversationId, participant.id, {
      metadata: { key2: 'value2' },
    })

    expect(updated.metadata.key1).toBe('value1')
    expect(updated.metadata.key2).toBe('value2')
  })

  it('should support nested metadata objects', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'ai_1',
      role: 'ai',
      metadata: {
        config: {
          model: 'claude-3-opus',
          temperature: 0.7,
          tools: ['search', 'calculator'],
        },
        stats: {
          totalMessages: 0,
          avgResponseTime: 0,
        },
      },
    })

    expect((participant.metadata.config as Record<string, unknown>).model).toBe('claude-3-opus')
    expect((participant.metadata.config as Record<string, unknown[]>).tools).toContain('search')
  })

  it('should preserve metadata across retrieval', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      metadata: { important: 'data' },
    })

    const retrieved = await manager.getParticipant(conversationId, participant.id)

    expect(retrieved?.metadata.important).toBe('data')
  })

  it('should support various metadata value types', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      metadata: {
        stringVal: 'hello',
        numberVal: 42,
        booleanVal: true,
        nullVal: null,
        arrayVal: [1, 2, 3],
        objectVal: { nested: 'value' },
      },
    })

    expect(participant.metadata.stringVal).toBe('hello')
    expect(participant.metadata.numberVal).toBe(42)
    expect(participant.metadata.booleanVal).toBe(true)
    expect(participant.metadata.nullVal).toBeNull()
    expect(participant.metadata.arrayVal).toEqual([1, 2, 3])
    expect(participant.metadata.objectVal).toEqual({ nested: 'value' })
  })

  it('should update display name', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      displayName: 'Original Name',
    })

    const updated = await manager.updateParticipant(conversationId, participant.id, {
      displayName: 'New Name',
    })

    expect(updated.displayName).toBe('New Name')
  })

  it('should update avatar URL', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const updated = await manager.updateParticipant(conversationId, participant.id, {
      avatarUrl: 'https://example.com/new-avatar.png',
    })

    expect(updated.avatarUrl).toBe('https://example.com/new-avatar.png')
  })
})

// =============================================================================
// TDD Cycle 6: Active/Inactive Status
// =============================================================================

describe('Active/inactive status', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  describe('Status transitions', () => {
    it('should initialize participant as active', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      expect(participant.status).toBe('active')
    })

    it('should set participant status to inactive', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      const updated = await manager.setStatus(conversationId, participant.id, 'inactive')

      expect(updated.status).toBe('inactive')
    })

    it('should set participant status to left', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      const updated = await manager.setStatus(conversationId, participant.id, 'left')

      expect(updated.status).toBe('left')
      expect(updated.leftAt).toBeInstanceOf(Date)
    })

    it('should reactivate inactive participant', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      await manager.setStatus(conversationId, participant.id, 'inactive')
      const reactivated = await manager.setStatus(conversationId, participant.id, 'active')

      expect(reactivated.status).toBe('active')
    })
  })

  describe('Last seen tracking', () => {
    it('should update lastSeenAt on markSeen', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      expect(participant.lastSeenAt).toBeUndefined()

      const before = new Date()
      await manager.markSeen(conversationId, participant.id)
      const after = new Date()

      const updated = await manager.getParticipant(conversationId, participant.id)

      expect(updated?.lastSeenAt).toBeInstanceOf(Date)
      expect(updated?.lastSeenAt?.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(updated?.lastSeenAt?.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should update lastSeenAt on each markSeen call', async () => {
      const participant = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })

      await manager.markSeen(conversationId, participant.id)
      const first = await manager.getParticipant(conversationId, participant.id)

      await new Promise((resolve) => setTimeout(resolve, 10))

      await manager.markSeen(conversationId, participant.id)
      const second = await manager.getParticipant(conversationId, participant.id)

      expect(second?.lastSeenAt?.getTime()).toBeGreaterThan(first?.lastSeenAt?.getTime() ?? 0)
    })
  })

  describe('Active participant listing', () => {
    it('should list only active participants', async () => {
      await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })
      const p2 = await manager.addParticipant(conversationId, {
        userId: 'user_2',
        role: 'agent',
      })
      await manager.addParticipant(conversationId, {
        userId: 'user_3',
        role: 'ai',
      })

      await manager.setStatus(conversationId, p2.id, 'inactive')

      const active = await manager.getActiveParticipants(conversationId)

      expect(active).toHaveLength(2)
      expect(active.every((p) => p.status === 'active')).toBe(true)
    })

    it('should not include left participants in active list', async () => {
      const p1 = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })
      await manager.addParticipant(conversationId, {
        userId: 'user_2',
        role: 'agent',
      })

      await manager.setStatus(conversationId, p1.id, 'left')

      const active = await manager.getActiveParticipants(conversationId)

      expect(active).toHaveLength(1)
      expect(active[0].userId).toBe('user_2')
    })

    it('should not include removed participants in active list', async () => {
      const p1 = await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })
      await manager.addParticipant(conversationId, {
        userId: 'user_2',
        role: 'agent',
      })

      await manager.removeParticipant(conversationId, p1.id)

      const active = await manager.getActiveParticipants(conversationId)

      expect(active).toHaveLength(1)
      expect(active[0].userId).toBe('user_2')
    })
  })

  describe('Filter by role and status', () => {
    it('should filter participants by role', async () => {
      await manager.addParticipant(conversationId, {
        userId: 'user_1',
        role: 'customer',
      })
      await manager.addParticipant(conversationId, {
        userId: 'agent_1',
        role: 'agent',
      })
      await manager.addParticipant(conversationId, {
        userId: 'agent_2',
        role: 'agent',
      })
      await manager.addParticipant(conversationId, {
        userId: 'ai_1',
        role: 'ai',
      })

      const agents = await manager.listParticipants(conversationId, { role: 'agent' })

      expect(agents).toHaveLength(2)
      expect(agents.every((p) => p.role === 'agent')).toBe(true)
    })

    it('should filter by both role and status', async () => {
      const p1 = await manager.addParticipant(conversationId, {
        userId: 'agent_1',
        role: 'agent',
      })
      await manager.addParticipant(conversationId, {
        userId: 'agent_2',
        role: 'agent',
      })
      await manager.addParticipant(conversationId, {
        userId: 'customer_1',
        role: 'customer',
      })

      await manager.setStatus(conversationId, p1.id, 'inactive')

      const activeAgents = await manager.listParticipants(conversationId, {
        role: 'agent',
        status: 'active',
      })

      expect(activeAgents).toHaveLength(1)
      expect(activeAgents[0].userId).toBe('agent_2')
    })
  })
})

// =============================================================================
// TDD Cycle 7: Role Changes
// =============================================================================

describe('Role changes', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should change participant role', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    const updated = await manager.changeRole(conversationId, participant.id, 'agent')

    expect(updated.role).toBe('agent')
  })

  it('should update permissions when role changes', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    // Customer can't close
    expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(false)

    await manager.changeRole(conversationId, participant.id, 'agent')

    // Agent can close
    expect(await manager.hasPermission(conversationId, participant.id, 'close_conversation')).toBe(true)
  })

  it('should record role change in metadata', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await manager.changeRole(conversationId, participant.id, 'agent')

    const updated = await manager.getParticipant(conversationId, participant.id)
    expect(updated?.metadata.previousRole).toBe('customer')
    expect(updated?.metadata.roleChangedAt).toBeDefined()
  })

  it('should throw when changing to invalid role', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
    })

    await expect(
      manager.changeRole(conversationId, participant.id, 'invalid_role' as ParticipantRole)
    ).rejects.toThrow(/invalid role/i)
  })
})

// =============================================================================
// TDD Cycle 8: Conversation Assignment
// =============================================================================

describe('Conversation assignment', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should assign conversation to agent', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })

    const agent = await manager.assignToAgent(conversationId, 'agent_1')

    expect(agent.userId).toBe('agent_1')
    expect(agent.role).toBe('agent')
    expect(agent.status).toBe('active')
  })

  it('should get assigned agent', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })
    await manager.assignToAgent(conversationId, 'agent_1')

    const assigned = await manager.getAssignedAgent(conversationId)

    expect(assigned?.userId).toBe('agent_1')
    expect(assigned?.role).toBe('agent')
  })

  it('should return null when no agent assigned', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })

    const assigned = await manager.getAssignedAgent(conversationId)

    expect(assigned).toBeNull()
  })

  it('should unassign agent from conversation', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })
    await manager.assignToAgent(conversationId, 'agent_1')

    await manager.unassign(conversationId)

    const assigned = await manager.getAssignedAgent(conversationId)
    expect(assigned).toBeNull()
  })

  it('should transfer conversation to another agent', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })
    const originalAgent = await manager.assignToAgent(conversationId, 'agent_1')

    const newAgent = await manager.transferToAgent(conversationId, originalAgent.id, 'agent_2')

    expect(newAgent.userId).toBe('agent_2')
    expect(newAgent.role).toBe('agent')

    // Original agent should be left/inactive
    const original = await manager.getParticipant(conversationId, originalAgent.id)
    expect(original?.status).toBe('left')
  })

  it('should record transfer in metadata', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })
    const originalAgent = await manager.assignToAgent(conversationId, 'agent_1')
    await manager.transferToAgent(conversationId, originalAgent.id, 'agent_2')

    const original = await manager.getParticipant(conversationId, originalAgent.id)
    expect(original?.metadata.transferredTo).toBe('agent_2')
    expect(original?.metadata.transferredAt).toBeDefined()
  })

  it('should throw when transferring from non-agent', async () => {
    const customer = await manager.addParticipant(conversationId, {
      userId: 'customer_1',
      role: 'customer',
    })

    await expect(
      manager.transferToAgent(conversationId, customer.id, 'agent_2')
    ).rejects.toThrow(/not an agent/i)
  })
})

// =============================================================================
// TDD Cycle 9: Participant Lookup
// =============================================================================

describe('Participant lookup', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_test_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should get participant by ID', async () => {
    const participant = await manager.addParticipant(conversationId, {
      userId: 'user_1',
      role: 'customer',
      displayName: 'John Doe',
    })

    const retrieved = await manager.getParticipant(conversationId, participant.id)

    expect(retrieved?.id).toBe(participant.id)
    expect(retrieved?.displayName).toBe('John Doe')
  })

  it('should get participant by user ID', async () => {
    await manager.addParticipant(conversationId, {
      userId: 'user_john_123',
      role: 'customer',
      displayName: 'John Doe',
    })

    const retrieved = await manager.getParticipantByUserId(conversationId, 'user_john_123')

    expect(retrieved?.userId).toBe('user_john_123')
    expect(retrieved?.displayName).toBe('John Doe')
  })

  it('should return null for non-existent participant', async () => {
    const result = await manager.getParticipant(conversationId, 'nonexistent')

    expect(result).toBeNull()
  })

  it('should return null for non-existent user ID', async () => {
    const result = await manager.getParticipantByUserId(conversationId, 'nonexistent_user')

    expect(result).toBeNull()
  })

  it('should list all participants in conversation', async () => {
    await manager.addParticipant(conversationId, { userId: 'user_1', role: 'customer' })
    await manager.addParticipant(conversationId, { userId: 'agent_1', role: 'agent' })
    await manager.addParticipant(conversationId, { userId: 'ai_1', role: 'ai' })

    const all = await manager.listParticipants(conversationId)

    expect(all).toHaveLength(3)
  })

  it('should return empty array for conversation with no participants', async () => {
    const result = await manager.listParticipants(conversationId)

    expect(result).toEqual([])
  })
})

// =============================================================================
// TDD Cycle 10: Integration Tests
// =============================================================================

describe('Integration: Multi-participant conversation flow', () => {
  let manager: ParticipantManager
  const conversationId = 'conv_support_123'

  beforeEach(() => {
    manager = createParticipantManager()
  })

  it('should handle complete support conversation with handoff', async () => {
    // Customer initiates conversation
    const customer = await manager.addParticipant(conversationId, {
      userId: 'cust_john',
      role: 'customer',
      displayName: 'John Customer',
      metadata: { source: 'web_chat' },
    })

    expect(customer.status).toBe('active')
    expect(customer.role).toBe('customer')

    // AI bot joins to provide initial assistance
    const aiBot = await manager.addParticipant(conversationId, {
      userId: 'ai_support_bot',
      role: 'ai',
      displayName: 'Support Bot',
      metadata: { model: 'claude-3-opus' },
    })

    // Customer and bot exchange messages
    await manager.sendMessage(conversationId, customer.id, 'Hi, I need help with billing')
    await manager.sendMessage(conversationId, aiBot.id, 'Hello! I can help with billing questions.')
    await manager.sendMessage(conversationId, customer.id, 'I was charged twice for my subscription')

    // AI escalates to human agent
    const agent = await manager.assignToAgent(conversationId, 'agent_sarah')

    expect(agent.role).toBe('agent')
    expect(await manager.hasPermission(conversationId, agent.id, 'close_conversation')).toBe(true)

    // Agent takes over
    await manager.sendMessage(conversationId, agent.id, 'Hi John, I\'m Sarah. Let me look into this.')

    // Verify participant states
    const participants = await manager.getActiveParticipants(conversationId)
    expect(participants).toHaveLength(3) // customer, ai, agent all active

    // Agent resolves and transfer to another agent for follow-up
    await manager.transferToAgent(conversationId, agent.id, 'agent_mike')

    // Verify transfer
    const originalAgent = await manager.getParticipant(conversationId, agent.id)
    expect(originalAgent?.status).toBe('left')

    const newAgent = await manager.getAssignedAgent(conversationId)
    expect(newAgent?.userId).toBe('agent_mike')

    // Verify message counts
    const customerUpdated = await manager.getParticipant(conversationId, customer.id)
    expect(customerUpdated?.messageCount).toBe(2)
  })

  it('should handle multi-agent collaboration', async () => {
    // Customer
    const customer = await manager.addParticipant(conversationId, {
      userId: 'cust_1',
      role: 'customer',
    })

    // Primary support agent
    const agent1 = await manager.assignToAgent(conversationId, 'agent_1')

    // Agent adds specialist for technical help
    const specialist = await manager.addParticipant(conversationId, {
      userId: 'specialist_1',
      role: 'agent',
      displayName: 'Tech Specialist',
      metadata: { specialty: 'technical' },
    })

    // Add supervisor as observer
    const supervisor = await manager.addParticipant(conversationId, {
      userId: 'supervisor_1',
      role: 'observer',
      displayName: 'Supervisor',
    })

    // All active
    const active = await manager.getActiveParticipants(conversationId)
    expect(active).toHaveLength(4)

    // Supervisor can read but not write
    expect(await manager.hasPermission(conversationId, supervisor.id, 'read_messages')).toBe(true)
    expect(await manager.hasPermission(conversationId, supervisor.id, 'send_message')).toBe(false)

    // Both agents can write
    expect(await manager.hasPermission(conversationId, agent1.id, 'send_message')).toBe(true)
    expect(await manager.hasPermission(conversationId, specialist.id, 'send_message')).toBe(true)

    // Messages from each participant
    await manager.sendMessage(conversationId, customer.id, 'I have a technical issue')
    await manager.sendMessage(conversationId, agent1.id, 'Let me bring in our specialist')
    await manager.sendMessage(conversationId, specialist.id, 'Hi, I can help with technical issues')

    // Verify attribution
    const specialistMessages = await manager.getMessagesByParticipant(conversationId, specialist.id)
    expect(specialistMessages).toHaveLength(1)
    expect(specialistMessages[0].content).toContain('technical issues')
  })

  it('should handle AI handoff to human', async () => {
    const customer = await manager.addParticipant(conversationId, {
      userId: 'cust_1',
      role: 'customer',
    })

    const ai = await manager.addParticipant(conversationId, {
      userId: 'ai_1',
      role: 'ai',
    })

    // AI handles initial conversation
    await manager.sendMessage(conversationId, customer.id, 'Hello')
    await manager.sendMessage(conversationId, ai.id, 'Hi! How can I help?')
    await manager.sendMessage(conversationId, customer.id, 'I want to speak to a human')
    await manager.sendMessage(conversationId, ai.id, 'Connecting you to an agent...')

    // Human agent joins
    const agent = await manager.assignToAgent(conversationId, 'agent_1')

    // AI becomes inactive
    await manager.setStatus(conversationId, ai.id, 'inactive')

    // Verify only customer and agent are active
    const active = await manager.getActiveParticipants(conversationId)
    expect(active).toHaveLength(2)
    expect(active.find((p) => p.role === 'ai')).toBeUndefined()

    // Agent continues conversation
    await manager.sendMessage(conversationId, agent.id, 'Hi, I\'m here to help!')

    // Verify message counts
    const aiUpdated = await manager.getParticipant(conversationId, ai.id)
    expect(aiUpdated?.messageCount).toBe(2)
    expect(aiUpdated?.status).toBe('inactive')
  })

  it('should track participant activity correctly', async () => {
    const customer = await manager.addParticipant(conversationId, {
      userId: 'cust_1',
      role: 'customer',
    })

    const agent = await manager.assignToAgent(conversationId, 'agent_1')

    // Initial state - no lastSeen, no lastMessage
    expect(customer.lastSeenAt).toBeUndefined()
    expect(customer.lastMessageAt).toBeUndefined()

    // Customer views conversation
    await manager.markSeen(conversationId, customer.id)
    let customerState = await manager.getParticipant(conversationId, customer.id)
    expect(customerState?.lastSeenAt).toBeInstanceOf(Date)

    // Customer sends message
    await manager.sendMessage(conversationId, customer.id, 'Hello')
    customerState = await manager.getParticipant(conversationId, customer.id)
    expect(customerState?.lastMessageAt).toBeInstanceOf(Date)
    expect(customerState?.messageCount).toBe(1)

    // Agent responds
    await manager.sendMessage(conversationId, agent.id, 'Hi there')
    const agentState = await manager.getParticipant(conversationId, agent.id)
    expect(agentState?.messageCount).toBe(1)

    // More messages
    await manager.sendMessage(conversationId, customer.id, 'I need help')
    await manager.sendMessage(conversationId, agent.id, 'Sure, what do you need?')
    await manager.sendMessage(conversationId, customer.id, 'Billing question')

    customerState = await manager.getParticipant(conversationId, customer.id)
    expect(customerState?.messageCount).toBe(3)
  })
})
