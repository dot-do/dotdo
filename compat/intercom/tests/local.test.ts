/**
 * @dotdo/intercom - Local Implementation Tests
 *
 * Tests for the local/edge Intercom implementation that uses dotdo primitives:
 * - TemporalStore for conversation history
 * - InvertedIndex for article search
 * - ExactlyOnceContext for message delivery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntercomLocal } from '../local'

describe('@dotdo/intercom - IntercomLocal', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = new IntercomLocal({
      workspaceId: 'test_workspace',
    })
  })

  describe('initialization', () => {
    it('should create a local client', () => {
      expect(client).toBeDefined()
      expect(client.contacts).toBeDefined()
      expect(client.conversations).toBeDefined()
      expect(client.messages).toBeDefined()
      expect(client.events).toBeDefined()
      expect(client.articles).toBeDefined()
    })
  })

  describe('contacts', () => {
    it('should create a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'user@example.com',
        name: 'John Doe',
      })

      expect(contact.id).toBeDefined()
      expect(contact.email).toBe('user@example.com')
      expect(contact.name).toBe('John Doe')
      expect(contact.role).toBe('user')
      expect(contact.workspace_id).toBe('test_workspace')
    })

    it('should create a contact with custom attributes', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'user@example.com',
        custom_attributes: { plan: 'premium', tier: 'gold' },
      })

      expect(contact.custom_attributes.plan).toBe('premium')
      expect(contact.custom_attributes.tier).toBe('gold')
    })

    it('should create a lead contact', async () => {
      const contact = await client.contacts.create({
        role: 'lead',
        email: 'lead@example.com',
      })

      expect(contact.role).toBe('lead')
    })

    it('should find a contact by ID', async () => {
      const created = await client.contacts.create({
        role: 'user',
        email: 'find@example.com',
      })

      const found = await client.contacts.find(created.id)
      expect(found.id).toBe(created.id)
      expect(found.email).toBe('find@example.com')
    })

    it('should update a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'update@example.com',
        name: 'Original Name',
      })

      const updated = await client.contacts.update(contact.id, {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.email).toBe('update@example.com')
    })

    it('should delete a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'delete@example.com',
      })

      const result = await client.contacts.delete(contact.id)
      expect(result.deleted).toBe(true)
      expect(result.id).toBe(contact.id)

      await expect(client.contacts.find(contact.id)).rejects.toThrow()
    })

    it('should list contacts', async () => {
      await client.contacts.create({ role: 'user', email: 'user1@example.com' })
      await client.contacts.create({ role: 'user', email: 'user2@example.com' })

      const result = await client.contacts.list()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
      expect(result.type).toBe('list')
    })

    it('should search contacts', async () => {
      await client.contacts.create({
        role: 'user',
        email: 'searchme@example.com',
        custom_attributes: { plan: 'enterprise' },
      })

      const result = await client.contacts.search({
        query: {
          field: 'email',
          operator: '=',
          value: 'searchme@example.com',
        },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].email).toBe('searchme@example.com')
    })

    it('should search contacts with nested query', async () => {
      await client.contacts.create({
        role: 'user',
        email: 'nested@example.com',
        custom_attributes: { plan: 'enterprise' },
      })

      const result = await client.contacts.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'email', operator: '=', value: 'nested@example.com' },
            { field: 'custom_attributes.plan', operator: '=', value: 'enterprise' },
          ],
        },
      })

      expect(result.data.length).toBe(1)
    })

    it('should merge contacts', async () => {
      const contact1 = await client.contacts.create({
        role: 'user',
        email: 'merge1@example.com',
        custom_attributes: { attr1: 'value1' },
      })
      const contact2 = await client.contacts.create({
        role: 'user',
        email: 'merge2@example.com',
        custom_attributes: { attr2: 'value2' },
      })

      const merged = await client.contacts.merge({
        from: contact1.id,
        into: contact2.id,
      })

      expect(merged.id).toBe(contact2.id)
      expect(merged.custom_attributes.attr1).toBe('value1')
      expect(merged.custom_attributes.attr2).toBe('value2')

      await expect(client.contacts.find(contact1.id)).rejects.toThrow()
    })
  })

  describe('conversations', () => {
    let contactId: string

    beforeEach(async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'conv@example.com',
      })
      contactId = contact.id
    })

    it('should create a conversation', async () => {
      const conversation = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Hello, I need help!',
      })

      expect(conversation.id).toBeDefined()
      expect(conversation.state).toBe('open')
      expect(conversation.source.body).toBe('Hello, I need help!')
    })

    it('should find a conversation', async () => {
      const created = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Test message',
      })

      const found = await client.conversations.find(created.id)
      expect(found.id).toBe(created.id)
    })

    it('should list conversations', async () => {
      await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Message 1',
      })
      await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Message 2',
      })

      const result = await client.conversations.list()
      expect(result.conversations.length).toBeGreaterThanOrEqual(2)
    })

    it('should reply to a conversation', async () => {
      const conversation = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Initial message',
      })

      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Admin reply',
        message_type: 'comment',
      })

      expect(updated.conversation_parts.conversation_parts.length).toBe(2)
    })

    it('should close a conversation', async () => {
      const conversation = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Test',
      })

      const closed = await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      expect(closed.state).toBe('closed')
      expect(closed.open).toBe(false)
    })

    it('should reopen a conversation', async () => {
      const conversation = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Test',
      })

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

    it('should snooze a conversation', async () => {
      const conversation = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Test',
      })

      const snoozedUntil = Math.floor(Date.now() / 1000) + 3600

      const snoozed = await client.conversations.snooze({
        id: conversation.id,
        admin_id: 'admin_123',
        snoozed_until: snoozedUntil,
      })

      expect(snoozed.state).toBe('snoozed')
      expect(snoozed.snoozed_until).toBe(snoozedUntil)
    })

    it('should assign a conversation', async () => {
      const conversation = await client.conversations.create({
        from: { type: 'user', id: contactId },
        body: 'Test',
      })

      const assigned = await client.conversations.assign({
        id: conversation.id,
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      expect(assigned.admin_assignee_id).toBe('admin_456')
    })
  })

  describe('messages', () => {
    it('should create a message', async () => {
      const message = await client.messages.create({
        message_type: 'inapp',
        body: 'Welcome!',
        from: { type: 'admin', id: 'admin_123' },
        to: { type: 'user', id: 'contact_123' },
      })

      expect(message.id).toBeDefined()
      expect(message.body).toBe('Welcome!')
      expect(message.message_type).toBe('inapp')
    })

    it('should use exactly-once delivery', async () => {
      const deliveredMessages: any[] = []
      const client = new IntercomLocal({
        workspaceId: 'test',
        onMessageDelivery: async (messages) => {
          deliveredMessages.push(...messages)
        },
      })

      await client.messages.create({
        message_type: 'inapp',
        body: 'Test',
        from: { type: 'admin', id: 'admin_123' },
        to: { type: 'user', id: 'contact_123' },
      })

      await client.messages.flush()
      expect(deliveredMessages.length).toBe(1)
    })
  })

  describe('events', () => {
    it('should track an event', async () => {
      await client.events.create({
        event_name: 'order-completed',
        user_id: 'user_123',
        metadata: { order_id: '123' },
      })

      const events = await client.events.list({
        type: 'user',
        user_id: 'user_123',
      })

      expect(events.events.length).toBe(1)
      expect(events.events[0].event_name).toBe('order-completed')
    })

    it('should get event summaries', async () => {
      await client.events.create({
        event_name: 'page-viewed',
        user_id: 'user_456',
      })
      await client.events.create({
        event_name: 'page-viewed',
        user_id: 'user_456',
      })
      await client.events.create({
        event_name: 'order-completed',
        user_id: 'user_456',
      })

      const summaries = await client.events.summaries({
        user_id: 'user_456',
      })

      expect(summaries.events.length).toBe(2)
      const pageViewed = summaries.events.find((e) => e.event_name === 'page-viewed')
      expect(pageViewed?.count).toBe(2)
    })
  })

  describe('articles', () => {
    it('should create an article', async () => {
      const article = await client.articles.create({
        title: 'Getting Started',
        author_id: 'admin_123',
        body: '<p>Welcome to our guide</p>',
        state: 'published',
      })

      expect(article.id).toBeDefined()
      expect(article.title).toBe('Getting Started')
      expect(article.state).toBe('published')
    })

    it('should find an article', async () => {
      const created = await client.articles.create({
        title: 'Test Article',
        author_id: 'admin_123',
      })

      const found = await client.articles.find(created.id)
      expect(found.id).toBe(created.id)
      expect(found.title).toBe('Test Article')
    })

    it('should update an article', async () => {
      const article = await client.articles.create({
        title: 'Original',
        author_id: 'admin_123',
      })

      const updated = await client.articles.update(article.id, {
        title: 'Updated',
      })

      expect(updated.title).toBe('Updated')
    })

    it('should delete an article', async () => {
      const article = await client.articles.create({
        title: 'To Delete',
        author_id: 'admin_123',
      })

      const result = await client.articles.delete(article.id)
      expect(result.deleted).toBe(true)

      await expect(client.articles.find(article.id)).rejects.toThrow()
    })

    it('should list articles', async () => {
      await client.articles.create({
        title: 'Article 1',
        author_id: 'admin_123',
      })
      await client.articles.create({
        title: 'Article 2',
        author_id: 'admin_123',
      })

      const result = await client.articles.list()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should search articles using inverted index', async () => {
      await client.articles.create({
        title: 'Getting Started Guide',
        author_id: 'admin_123',
        body: '<p>This is a comprehensive getting started guide for new users.</p>',
        state: 'published',
      })
      await client.articles.create({
        title: 'Advanced Features',
        author_id: 'admin_123',
        body: '<p>Learn about advanced features and configurations.</p>',
        state: 'published',
      })

      const results = await client.articles.search({
        phrase: 'getting started',
      })

      expect(results.articles.data.length).toBe(1)
      expect(results.articles.data[0].title).toBe('Getting Started Guide')
    })

    it('should search articles with state filter', async () => {
      await client.articles.create({
        title: 'Published Article',
        author_id: 'admin_123',
        body: '<p>This is searchable content.</p>',
        state: 'published',
      })
      await client.articles.create({
        title: 'Draft Article',
        author_id: 'admin_123',
        body: '<p>This is also searchable content.</p>',
        state: 'draft',
      })

      const results = await client.articles.search({
        phrase: 'searchable',
        state: 'published',
      })

      expect(results.articles.data.length).toBe(1)
      expect(results.articles.data[0].state).toBe('published')
    })
  })

  describe('temporal store integration', () => {
    it('should store conversation history with timestamps', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: 'temporal@example.com',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'First message',
      })

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply 1',
      })

      await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Reply 2',
      })

      const found = await client.conversations.find(conversation.id)
      expect(found.conversation_parts.conversation_parts.length).toBe(3)

      // Verify parts are ordered by timestamp
      const parts = found.conversation_parts.conversation_parts
      for (let i = 1; i < parts.length; i++) {
        expect(parts[i].created_at).toBeGreaterThanOrEqual(parts[i - 1].created_at)
      }
    })
  })
})
