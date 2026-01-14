/**
 * @dotdo/intercom - Conversations API Tests (RED Phase)
 *
 * TDD RED phase tests for Intercom Conversations API:
 * - List/search conversations with filtering
 * - Reply handling (admin, user, attachments)
 * - Assignment (admin, team, unassignment)
 * - Snooze/close operations
 * - Tags and notes management
 * - Parts iteration and pagination
 *
 * These tests define the expected behavior before implementation.
 *
 * @see https://developers.intercom.com/docs/references/rest-api/api.intercom.io/Conversations/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntercomLocal, type IntercomLocalConfig } from '../local'
import type {
  Conversation,
  ConversationPart,
  ConversationListResponse,
  TagRef,
} from '../types'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestClient(config?: Partial<IntercomLocalConfig>): IntercomLocal {
  return new IntercomLocal({
    workspaceId: 'test_workspace',
    ...config,
  })
}

async function createTestConversation(
  client: IntercomLocal,
  body = 'Test message'
): Promise<{ conversation: Conversation; contactId: string }> {
  const contact = await client.contacts.create({
    role: 'user',
    email: `user_${Date.now()}@example.com`,
  })

  const conversation = await client.conversations.create({
    from: { type: 'user', id: contact.id },
    body,
  })

  return { conversation, contactId: contact.id }
}

// =============================================================================
// List/Search Conversations Tests
// =============================================================================

describe('@dotdo/intercom - Conversations List/Search', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('list', () => {
    it('should list conversations with pagination', async () => {
      // Create multiple conversations
      for (let i = 0; i < 25; i++) {
        await createTestConversation(client, `Message ${i}`)
      }

      const firstPage = await client.conversations.list({ per_page: 10 })
      expect(firstPage.conversations).toHaveLength(10)
      expect(firstPage.total_count).toBe(25)
      expect(firstPage.pages.total_pages).toBe(3)
      expect(firstPage.pages.next).toBeDefined()

      // TODO: Implement starting_after pagination
      const secondPage = await client.conversations.list({
        per_page: 10,
        starting_after: firstPage.conversations[9].id,
      })
      expect(secondPage.conversations).toHaveLength(10)
      expect(secondPage.conversations[0].id).not.toBe(firstPage.conversations[0].id)
    })

    it('should list only open conversations when filtered', async () => {
      const { conversation: conv1 } = await createTestConversation(client)
      const { conversation: conv2 } = await createTestConversation(client)

      await client.conversations.close({
        id: conv1.id,
        admin_id: 'admin_123',
      })

      // TODO: Implement state filter in list
      const result = await client.conversations.list({ state: 'open' } as any)
      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].id).toBe(conv2.id)
    })

    it('should list conversations assigned to specific admin', async () => {
      const { conversation: conv1 } = await createTestConversation(client)
      const { conversation: conv2 } = await createTestConversation(client)

      await client.conversations.assign({
        id: conv1.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      // TODO: Implement assigned_to filter
      const result = await client.conversations.list({ assigned_to: 'admin_456' } as any)
      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].admin_assignee_id).toBe('admin_456')
    })

    it('should list unassigned conversations', async () => {
      const { conversation: conv1 } = await createTestConversation(client)
      const { conversation: conv2 } = await createTestConversation(client)

      await client.conversations.assign({
        id: conv1.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      // TODO: Implement unassigned filter
      const result = await client.conversations.list({ unassigned: true } as any)
      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].id).toBe(conv2.id)
    })
  })

  describe('search', () => {
    it('should search conversations by state', async () => {
      const { conversation: conv1 } = await createTestConversation(client)
      const { conversation: conv2 } = await createTestConversation(client)

      await client.conversations.close({
        id: conv1.id,
        admin_id: 'admin_123',
      })

      const result = await client.conversations.search({
        query: {
          field: 'state',
          operator: '=',
          value: 'open',
        },
      })

      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].state).toBe('open')
    })

    it('should search conversations by contact ID', async () => {
      const { conversation, contactId } = await createTestConversation(client)
      await createTestConversation(client)

      // TODO: Implement contact_ids search
      const result = await client.conversations.search({
        query: {
          field: 'contact_ids',
          operator: '=',
          value: contactId,
        },
      })

      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].id).toBe(conversation.id)
    })

    it('should search conversations by admin assignee', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      // TODO: Implement admin_assignee_id search
      const result = await client.conversations.search({
        query: {
          field: 'admin_assignee_id',
          operator: '=',
          value: 'admin_456',
        },
      })

      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].admin_assignee_id).toBe('admin_456')
    })

    it('should search with nested AND query', async () => {
      const { conversation: conv1 } = await createTestConversation(client)
      const { conversation: conv2 } = await createTestConversation(client)

      await client.conversations.assign({
        id: conv1.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      await client.conversations.close({
        id: conv2.id,
        admin_id: 'admin_123',
      })

      // Find open AND assigned to admin_456
      const result = await client.conversations.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'state', operator: '=', value: 'open' },
            { field: 'admin_assignee_id', operator: '=', value: 'admin_456' },
          ],
        },
      })

      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].id).toBe(conv1.id)
    })

    it('should search with nested OR query', async () => {
      const { conversation: conv1 } = await createTestConversation(client)
      const { conversation: conv2 } = await createTestConversation(client)
      const { conversation: conv3 } = await createTestConversation(client)

      await client.conversations.close({
        id: conv1.id,
        admin_id: 'admin_123',
      })

      await client.conversations.snooze({
        id: conv2.id,
        admin_id: 'admin_123',
        snoozed_until: Math.floor(Date.now() / 1000) + 3600,
      })

      // Find closed OR snoozed
      const result = await client.conversations.search({
        query: {
          operator: 'OR',
          value: [
            { field: 'state', operator: '=', value: 'closed' },
            { field: 'state', operator: '=', value: 'snoozed' },
          ],
        },
      })

      expect(result.conversations).toHaveLength(2)
    })

    it('should search conversations created within date range', async () => {
      const { conversation } = await createTestConversation(client)

      const now = Math.floor(Date.now() / 1000)
      const hourAgo = now - 3600

      // TODO: Implement created_at range search
      const result = await client.conversations.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'created_at', operator: '>', value: hourAgo },
            { field: 'created_at', operator: '<', value: now + 60 },
          ],
        },
      })

      expect(result.conversations.length).toBeGreaterThanOrEqual(1)
    })

    it('should sort search results', async () => {
      await createTestConversation(client, 'First')
      await new Promise((r) => setTimeout(r, 10))
      await createTestConversation(client, 'Second')

      // TODO: Implement sort in search
      const descResult = await client.conversations.search({
        query: { field: 'state', operator: '=', value: 'open' },
        sort: { field: 'created_at', order: 'descending' },
      })

      expect(descResult.conversations[0].source.body).toBe('Second')

      const ascResult = await client.conversations.search({
        query: { field: 'state', operator: '=', value: 'open' },
        sort: { field: 'created_at', order: 'ascending' },
      })

      expect(ascResult.conversations[0].source.body).toBe('First')
    })
  })
})

// =============================================================================
// Reply Handling Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Reply Handling', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('admin reply', () => {
    it('should add admin reply with comment type', async () => {
      const { conversation } = await createTestConversation(client)

      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Admin reply',
        message_type: 'comment',
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.part_type).toBe('comment')
      expect(lastPart?.body).toBe('Admin reply')
      expect(lastPart?.author.type).toBe('admin')
      expect(lastPart?.author.id).toBe('admin_123')
    })

    it('should track reply timestamp', async () => {
      const { conversation } = await createTestConversation(client)
      const beforeReply = Math.floor(Date.now() / 1000)

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply',
        message_type: 'comment',
      })

      const updated = await client.conversations.find(conversation.id)
      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.created_at).toBeGreaterThanOrEqual(beforeReply)
    })

    it('should update conversation waiting_since on admin reply', async () => {
      const { conversation } = await createTestConversation(client)

      // User reply sets waiting_since
      await client.conversations.reply({
        id: conversation.id,
        type: 'user',
        intercom_user_id: conversation.contacts.contacts[0].id,
        body: 'User needs help',
      })

      const waitingConv = await client.conversations.find(conversation.id)
      expect(waitingConv.waiting_since).toBeDefined()

      // Admin reply clears waiting_since
      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Admin replied',
        message_type: 'comment',
      })

      const repliedConv = await client.conversations.find(conversation.id)
      expect(repliedConv.waiting_since).toBeNull()
    })
  })

  describe('user reply', () => {
    it('should add user reply', async () => {
      const { conversation, contactId } = await createTestConversation(client)

      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'user',
        intercom_user_id: contactId,
        body: 'User follow-up',
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.body).toBe('User follow-up')
      expect(lastPart?.author.type).toBe('user')
    })

    it('should identify user by email', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'reply@example.com',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Initial',
      })

      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'user',
        email: 'reply@example.com',
        body: 'Reply by email',
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.author.id).toBe(contact.id)
    })

    it('should identify user by external user_id', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'ext@example.com',
        external_id: 'ext_user_123',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Initial',
      })

      // TODO: Implement user_id lookup
      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'user',
        user_id: 'ext_user_123',
        body: 'Reply by external ID',
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.author.id).toBe(contact.id)
    })

    it('should set waiting_since on user reply', async () => {
      const { conversation } = await createTestConversation(client)

      // Initial message doesn't count, need explicit user reply
      const contact = await client.contacts.create({
        role: 'user',
        email: 'waiting@example.com',
      })

      const conv = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Need help',
      })

      // Admin replies
      await client.conversations.reply({
        id: conv.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'How can I help?',
        message_type: 'comment',
      })

      // User replies again - this should set waiting_since
      const beforeReply = Math.floor(Date.now() / 1000)
      await client.conversations.reply({
        id: conv.id,
        type: 'user',
        intercom_user_id: contact.id,
        body: 'Still waiting',
      })

      const updated = await client.conversations.find(conv.id)
      expect(updated.waiting_since).toBeGreaterThanOrEqual(beforeReply)
    })
  })

  describe('attachments', () => {
    it('should add reply with attachment URLs', async () => {
      const { conversation } = await createTestConversation(client)

      // TODO: Implement attachment_urls
      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Here is the file',
        message_type: 'comment',
        attachment_urls: ['https://example.com/file.pdf'],
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.attachments).toBeDefined()
      expect(lastPart?.attachments?.length).toBe(1)
      expect(lastPart?.attachments?.[0].url).toBe('https://example.com/file.pdf')
    })

    it('should add reply with inline attachment files', async () => {
      const { conversation } = await createTestConversation(client)

      // TODO: Implement attachment_files
      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Inline attachment',
        message_type: 'comment',
        attachment_files: [
          {
            content_type: 'text/plain',
            data: btoa('Hello World'),
            name: 'test.txt',
          },
        ],
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.attachments).toBeDefined()
      expect(lastPart?.attachments?.[0].name).toBe('test.txt')
    })

    it('should add reply with multiple attachments', async () => {
      const { conversation } = await createTestConversation(client)

      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Multiple files',
        message_type: 'comment',
        attachment_urls: [
          'https://example.com/doc.pdf',
          'https://example.com/image.png',
        ],
      })

      const lastPart = updated.conversation_parts.conversation_parts.at(-1)
      expect(lastPart?.attachments?.length).toBe(2)
    })
  })

  describe('reopening on reply', () => {
    it('should reopen closed conversation on user reply', async () => {
      const { conversation, contactId } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      const closed = await client.conversations.find(conversation.id)
      expect(closed.state).toBe('closed')

      // TODO: Implement auto-reopen on user reply
      await client.conversations.reply({
        id: conversation.id,
        type: 'user',
        intercom_user_id: contactId,
        body: 'Actually, I have another question',
      })

      const reopened = await client.conversations.find(conversation.id)
      expect(reopened.state).toBe('open')
    })

    it('should NOT reopen closed conversation on admin reply', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Follow-up note',
        message_type: 'comment',
      })

      const stillClosed = await client.conversations.find(conversation.id)
      expect(stillClosed.state).toBe('closed')
    })
  })
})

// =============================================================================
// Assignment Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Assignment', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('admin assignment', () => {
    it('should assign conversation to admin', async () => {
      const { conversation } = await createTestConversation(client)

      const assigned = await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      expect(assigned.admin_assignee_id).toBe('admin_456')
    })

    it('should record assignment in conversation parts', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      const updated = await client.conversations.find(conversation.id)
      const assignmentPart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'assignment'
      )

      expect(assignmentPart).toBeDefined()
      expect(assignmentPart?.assigned_to?.id).toBe('admin_456')
      expect(assignmentPart?.author.id).toBe('admin_123')
    })

    it('should include assignment body/note', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
        body: 'Escalating to specialist',
      })

      const updated = await client.conversations.find(conversation.id)
      const assignmentPart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'assignment'
      )

      expect(assignmentPart?.body).toBe('Escalating to specialist')
    })

    it('should reassign conversation from one admin to another', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_456',
        assignee_id: 'admin_789',
        type: 'admin',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.admin_assignee_id).toBe('admin_789')

      // Should have two assignment parts
      const assignments = updated.conversation_parts.conversation_parts.filter(
        (p) => p.part_type === 'assignment'
      )
      expect(assignments.length).toBe(2)
    })
  })

  describe('team assignment', () => {
    it('should assign conversation to team', async () => {
      const { conversation } = await createTestConversation(client)

      const assigned = await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'team_support',
        type: 'team',
      })

      expect(assigned.team_assignee_id).toBe('team_support')
    })

    it('should record team assignment in parts', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'team_support',
        type: 'team',
      })

      const updated = await client.conversations.find(conversation.id)
      const assignmentPart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'assignment'
      )

      expect(assignmentPart?.assigned_to?.type).toBe('team')
      expect(assignmentPart?.assigned_to?.id).toBe('team_support')
    })
  })

  describe('unassignment', () => {
    it('should unassign conversation from admin', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      // TODO: Implement unassign (assign to nobody/0)
      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_456',
        assignee_id: '0',
        type: 'admin',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.admin_assignee_id).toBeNull()
    })

    it('should unassign conversation from team', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'team_support',
        type: 'team',
      })

      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: '0',
        type: 'team',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.team_assignee_id).toBeNull()
    })
  })

  describe('run assignment rules', () => {
    it('should run automatic assignment rules', async () => {
      const { conversation } = await createTestConversation(client)

      // TODO: Implement runAssignmentRules in local
      const result = await client.conversations.runAssignmentRules(conversation.id)
      expect(result.id).toBe(conversation.id)
    })
  })
})

// =============================================================================
// Snooze/Close Operations Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Snooze/Close', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('close', () => {
    it('should close an open conversation', async () => {
      const { conversation } = await createTestConversation(client)

      const closed = await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      expect(closed.state).toBe('closed')
      expect(closed.open).toBe(false)
    })

    it('should record close in conversation parts', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      const updated = await client.conversations.find(conversation.id)
      const closePart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'close'
      )

      expect(closePart).toBeDefined()
      expect(closePart?.author.id).toBe('admin_123')
    })

    it('should include close body/note', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
        body: 'Issue resolved',
      })

      const updated = await client.conversations.find(conversation.id)
      const closePart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'close'
      )

      expect(closePart?.body).toBe('Issue resolved')
    })

    it('should be idempotent - closing already closed conversation', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      // Should not throw, should remain closed
      const reclosed = await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_456',
      })

      expect(reclosed.state).toBe('closed')
    })
  })

  describe('open/reopen', () => {
    it('should reopen a closed conversation', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      const reopened = await client.conversations.open({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      expect(reopened.state).toBe('open')
      expect(reopened.open).toBe(true)
    })

    it('should record reopen in conversation parts', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      await client.conversations.open({
        id: conversation.id,
        admin_id: 'admin_456',
      })

      const updated = await client.conversations.find(conversation.id)
      const openPart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'open'
      )

      expect(openPart).toBeDefined()
      expect(openPart?.author.id).toBe('admin_456')
    })

    it('should wake up from snooze when reopened', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: Math.floor(Date.now() / 1000) + 3600,
      })

      const reopened = await client.conversations.open({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      expect(reopened.state).toBe('open')
      expect(reopened.snoozed_until).toBeNull()
    })
  })

  describe('snooze', () => {
    it('should snooze a conversation', async () => {
      const { conversation } = await createTestConversation(client)
      const snoozedUntil = Math.floor(Date.now() / 1000) + 3600

      const snoozed = await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: snoozedUntil,
      })

      expect(snoozed.state).toBe('snoozed')
      expect(snoozed.snoozed_until).toBe(snoozedUntil)
    })

    it('should record snooze in conversation parts', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: Math.floor(Date.now() / 1000) + 3600,
      })

      const updated = await client.conversations.find(conversation.id)
      const snoozePart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'snoozed'
      )

      expect(snoozePart).toBeDefined()
      expect(snoozePart?.author.id).toBe('admin_123')
    })

    it('should update snooze time when re-snoozed', async () => {
      const { conversation } = await createTestConversation(client)
      const firstSnooze = Math.floor(Date.now() / 1000) + 3600
      const secondSnooze = Math.floor(Date.now() / 1000) + 7200

      await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: firstSnooze,
      })

      const reSnoozed = await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: secondSnooze,
      })

      expect(reSnoozed.snoozed_until).toBe(secondSnooze)
    })

    it('should auto-reopen when snooze expires', async () => {
      const { conversation } = await createTestConversation(client)

      // Snooze for 1 second
      const snoozedUntil = Math.floor(Date.now() / 1000) + 1

      await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: snoozedUntil,
      })

      // Wait for snooze to expire
      await new Promise((r) => setTimeout(r, 1100))

      // TODO: Implement snooze expiry check
      const updated = await client.conversations.find(conversation.id)
      expect(updated.state).toBe('open')
      expect(updated.snoozed_until).toBeNull()
    })
  })
})

// =============================================================================
// Tags and Notes Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Tags and Notes', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('addTag', () => {
    it('should add a tag to a conversation', async () => {
      const { conversation } = await createTestConversation(client)

      // TODO: Implement addTag in local
      const result = await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      expect(result.id).toBe('tag_vip')
      expect(result.type).toBe('tag')
    })

    it('should reflect tag in conversation tags list', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_urgent',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.tags.tags).toContainEqual(
        expect.objectContaining({ id: 'tag_urgent' })
      )
    })

    it('should add multiple tags', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_urgent',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.tags.tags.length).toBe(2)
    })

    it('should be idempotent - adding same tag twice', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.tags.tags.filter((t) => t.id === 'tag_vip').length).toBe(1)
    })
  })

  describe('removeTag', () => {
    it('should remove a tag from a conversation', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      // TODO: Implement removeTag in local
      const result = await client.conversations.removeTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      expect(result.id).toBe('tag_vip')
    })

    it('should no longer show removed tag', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.addTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      await client.conversations.removeTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_vip',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.tags.tags).not.toContainEqual(
        expect.objectContaining({ id: 'tag_vip' })
      )
    })

    it('should be idempotent - removing non-existent tag', async () => {
      const { conversation } = await createTestConversation(client)

      // Should not throw
      const result = await client.conversations.removeTag({
        id: conversation.id,
        admin_id: 'admin_123',
        tag_id: 'tag_nonexistent',
      })

      expect(result.id).toBe('tag_nonexistent')
    })
  })

  describe('addNote', () => {
    it('should add an internal note to a conversation', async () => {
      const { conversation } = await createTestConversation(client)

      // TODO: Implement addNote in local
      const updated = await client.conversations.addNote({
        id: conversation.id,
        admin_id: 'admin_123',
        body: 'VIP customer - handle with care',
      })

      const notePart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'note'
      )

      expect(notePart).toBeDefined()
      expect(notePart?.body).toBe('VIP customer - handle with care')
    })

    it('should mark note as internal (not visible to user)', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.addNote({
        id: conversation.id,
        admin_id: 'admin_123',
        body: 'Internal note',
      })

      const updated = await client.conversations.find(conversation.id)
      const notePart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'note'
      )

      expect(notePart?.part_type).toBe('note')
      // Notes should be distinguishable from comments
      expect(notePart?.author.type).toBe('admin')
    })

    it('should support HTML in note body', async () => {
      const { conversation } = await createTestConversation(client)

      const htmlBody = '<p>Note with <strong>HTML</strong></p>'
      await client.conversations.addNote({
        id: conversation.id,
        admin_id: 'admin_123',
        body: htmlBody,
      })

      const updated = await client.conversations.find(conversation.id)
      const notePart = updated.conversation_parts.conversation_parts.find(
        (p) => p.part_type === 'note'
      )

      expect(notePart?.body).toBe(htmlBody)
    })
  })
})

// =============================================================================
// Parts Iteration Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Parts Iteration', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('parts pagination', () => {
    it('should include total_count in conversation_parts', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply 1',
        message_type: 'comment',
      })

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply 2',
        message_type: 'comment',
      })

      const updated = await client.conversations.find(conversation.id)
      expect(updated.conversation_parts.total_count).toBe(3)
    })

    it('should paginate parts for large conversations', async () => {
      const { conversation } = await createTestConversation(client)

      // Add many replies
      for (let i = 0; i < 30; i++) {
        await client.conversations.reply({
          id: conversation.id,
          type: 'admin',
          admin_id: 'admin_123',
          body: `Reply ${i}`,
          message_type: 'comment',
        })
      }

      // TODO: Implement parts pagination
      const firstPage = await client.conversations.find(conversation.id)
      expect(firstPage.conversation_parts.total_count).toBe(31) // initial + 30 replies
    })
  })

  describe('parts ordering', () => {
    it('should return parts in chronological order', async () => {
      const { conversation } = await createTestConversation(client)

      await new Promise((r) => setTimeout(r, 10))
      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'First reply',
        message_type: 'comment',
      })

      await new Promise((r) => setTimeout(r, 10))
      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Second reply',
        message_type: 'comment',
      })

      const updated = await client.conversations.find(conversation.id)
      const parts = updated.conversation_parts.conversation_parts

      for (let i = 1; i < parts.length; i++) {
        expect(parts[i].created_at).toBeGreaterThanOrEqual(parts[i - 1].created_at)
      }
    })
  })

  describe('parts types', () => {
    it('should return all part types in conversation history', async () => {
      const { conversation } = await createTestConversation(client)

      // Reply
      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Admin reply',
        message_type: 'comment',
      })

      // Note
      await client.conversations.addNote({
        id: conversation.id,
        admin_id: 'admin_123',
        body: 'Internal note',
      })

      // Assignment
      await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      // Close
      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      // Open
      await client.conversations.open({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      // Snooze
      await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: Math.floor(Date.now() / 1000) + 3600,
      })

      const updated = await client.conversations.find(conversation.id)
      const partTypes = updated.conversation_parts.conversation_parts.map((p) => p.part_type)

      expect(partTypes).toContain('comment')
      expect(partTypes).toContain('note')
      expect(partTypes).toContain('assignment')
      expect(partTypes).toContain('close')
      expect(partTypes).toContain('open')
      expect(partTypes).toContain('snoozed')
    })
  })

  describe('time-travel queries', () => {
    it('should get conversation state as of specific timestamp', async () => {
      const { conversation } = await createTestConversation(client)

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply 1',
        message_type: 'comment',
      })

      const midpoint = Math.floor(Date.now() / 1000)
      await new Promise((r) => setTimeout(r, 100))

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply 2',
        message_type: 'comment',
      })

      // Get state as of midpoint
      const historical = await client.conversations.getAsOf(conversation.id, midpoint)

      expect(historical).toBeDefined()
      expect(historical?.conversation_parts.total_count).toBe(2) // initial + Reply 1
    })
  })
})

// =============================================================================
// Redaction Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Redaction', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should redact a conversation part', async () => {
    const { conversation } = await createTestConversation(client, 'Sensitive info: SSN 123-45-6789')

    const parts = conversation.conversation_parts.conversation_parts
    const partToRedact = parts[0]

    // TODO: Implement redact in local
    await client.conversations.redact({
      type: 'conversation_part',
      conversation_id: conversation.id,
      conversation_part_id: partToRedact.id,
    })

    const updated = await client.conversations.find(conversation.id)
    const redactedPart = updated.conversation_parts.conversation_parts.find(
      (p) => p.id === partToRedact.id
    )

    expect(redactedPart?.redacted).toBe(true)
    expect(redactedPart?.body).not.toContain('123-45-6789')
  })

  it('should redact the conversation source', async () => {
    const { conversation } = await createTestConversation(
      client,
      'Initial message with PII: credit card 1234-5678-9012-3456'
    )

    await client.conversations.redact({
      type: 'source',
      conversation_id: conversation.id,
      source_id: conversation.source.id,
    })

    const updated = await client.conversations.find(conversation.id)
    expect(updated.source.redacted).toBe(true)
    expect(updated.source.body).not.toContain('1234-5678-9012-3456')
  })
})

// =============================================================================
// Priority Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Priority', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should set conversation as priority', async () => {
    const { conversation } = await createTestConversation(client)

    // TODO: Implement setPriority in local
    const updated = await client.conversations.setPriority({
      id: conversation.id,
      admin_id: 'admin_123',
      priority: 'priority',
    })

    expect(updated.priority).toBe('priority')
  })

  it('should remove priority from conversation', async () => {
    const { conversation } = await createTestConversation(client)

    await client.conversations.setPriority({
      id: conversation.id,
      admin_id: 'admin_123',
      priority: 'priority',
    })

    const updated = await client.conversations.setPriority({
      id: conversation.id,
      admin_id: 'admin_123',
      priority: 'not_priority',
    })

    expect(updated.priority).toBe('not_priority')
  })
})

// =============================================================================
// Contact Management Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Contact Management', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('attachContact', () => {
    it('should attach additional contact to conversation', async () => {
      const { conversation } = await createTestConversation(client)

      const secondContact = await client.contacts.create({
        role: 'user',
        email: 'second@example.com',
      })

      // TODO: Implement attachContact in local
      const updated = await client.conversations.attachContact({
        id: conversation.id,
        admin_id: 'admin_123',
        customer: { intercom_user_id: secondContact.id },
      })

      expect(updated.contacts.contacts.length).toBe(2)
      expect(updated.contacts.contacts).toContainEqual(
        expect.objectContaining({ id: secondContact.id })
      )
    })

    it('should attach contact by email', async () => {
      const { conversation } = await createTestConversation(client)

      const secondContact = await client.contacts.create({
        role: 'user',
        email: 'attach-by-email@example.com',
      })

      const updated = await client.conversations.attachContact({
        id: conversation.id,
        admin_id: 'admin_123',
        customer: { email: 'attach-by-email@example.com' },
      })

      expect(updated.contacts.contacts).toContainEqual(
        expect.objectContaining({ id: secondContact.id })
      )
    })
  })

  describe('detachContact', () => {
    it('should detach contact from conversation', async () => {
      const { conversation, contactId } = await createTestConversation(client)

      const secondContact = await client.contacts.create({
        role: 'user',
        email: 'to-detach@example.com',
      })

      await client.conversations.attachContact({
        id: conversation.id,
        admin_id: 'admin_123',
        customer: { intercom_user_id: secondContact.id },
      })

      // TODO: Implement detachContact in local
      const updated = await client.conversations.detachContact({
        id: conversation.id,
        admin_id: 'admin_123',
        contact_id: secondContact.id,
      })

      expect(updated.contacts.contacts.length).toBe(1)
      expect(updated.contacts.contacts[0].id).toBe(contactId)
    })

    it('should not allow detaching the last contact', async () => {
      const { conversation, contactId } = await createTestConversation(client)

      // TODO: Should throw or handle gracefully
      await expect(
        client.conversations.detachContact({
          id: conversation.id,
          admin_id: 'admin_123',
          contact_id: contactId,
        })
      ).rejects.toThrow()
    })
  })
})

// =============================================================================
// Statistics Tests
// =============================================================================

describe('@dotdo/intercom - Conversations Statistics', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should track time_to_admin_reply', async () => {
    const { conversation, contactId } = await createTestConversation(client)

    // Wait a bit before admin reply
    await new Promise((r) => setTimeout(r, 100))

    await client.conversations.reply({
      id: conversation.id,
      type: 'admin',
      admin_id: 'admin_123',
      body: 'Admin reply',
      message_type: 'comment',
    })

    const updated = await client.conversations.find(conversation.id)
    expect(updated.statistics?.time_to_admin_reply).toBeGreaterThan(0)
  })

  it('should track time_to_first_close', async () => {
    const { conversation } = await createTestConversation(client)

    await new Promise((r) => setTimeout(r, 100))

    await client.conversations.close({
      id: conversation.id,
      admin_id: 'admin_123',
    })

    const updated = await client.conversations.find(conversation.id)
    expect(updated.statistics?.time_to_first_close).toBeGreaterThan(0)
  })

  it('should track count_reopens', async () => {
    const { conversation } = await createTestConversation(client)

    await client.conversations.close({ id: conversation.id, admin_id: 'admin_123' })
    await client.conversations.open({ id: conversation.id, admin_id: 'admin_123' })
    await client.conversations.close({ id: conversation.id, admin_id: 'admin_123' })
    await client.conversations.open({ id: conversation.id, admin_id: 'admin_123' })

    const updated = await client.conversations.find(conversation.id)
    expect(updated.statistics?.count_reopens).toBe(2)
  })

  it('should track count_assignments', async () => {
    const { conversation } = await createTestConversation(client)

    await client.conversations.assign({
      id: conversation.id,
      admin_id: 'admin_123',
      assignee_id: 'admin_456',
      type: 'admin',
    })

    await client.conversations.assign({
      id: conversation.id,
      admin_id: 'admin_456',
      assignee_id: 'admin_789',
      type: 'admin',
    })

    const updated = await client.conversations.find(conversation.id)
    expect(updated.statistics?.count_assignments).toBe(2)
  })

  it('should track count_conversation_parts', async () => {
    const { conversation } = await createTestConversation(client)

    await client.conversations.reply({
      id: conversation.id,
      type: 'admin',
      admin_id: 'admin_123',
      body: 'Reply 1',
      message_type: 'comment',
    })

    await client.conversations.reply({
      id: conversation.id,
      type: 'admin',
      admin_id: 'admin_123',
      body: 'Reply 2',
      message_type: 'comment',
    })

    const updated = await client.conversations.find(conversation.id)
    expect(updated.statistics?.count_conversation_parts).toBe(3)
  })
})
