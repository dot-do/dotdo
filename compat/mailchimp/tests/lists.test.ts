/**
 * @dotdo/mailchimp - Lists/Audiences API Tests
 *
 * Tests for Mailchimp Lists (Audiences) compatibility layer.
 * Covers CRUD operations, members, segments, and webhooks.
 *
 * @module @dotdo/mailchimp/tests/lists
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MailchimpLists,
  MailchimpError,
  type ListsStorage,
  type List,
  type Member,
  type MemberStatus,
  type Segment,
  type Tag,
} from '../lists'

// =============================================================================
// Mock Storage Implementation
// =============================================================================

function createMockStorage(): ListsStorage {
  const store = new Map<string, unknown>()

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      store.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key)
    },
    async list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> {
      const result = new Map<string, unknown>()
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? Infinity
      let count = 0

      for (const [key, value] of store.entries()) {
        if (key.startsWith(prefix)) {
          if (count >= limit) break
          result.set(key, value)
          count++
        }
      }

      return result
    },
  }
}

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/mailchimp/lists - Lists/Audiences API', () => {
  let storage: ListsStorage
  let lists: MailchimpLists

  beforeEach(() => {
    storage = createMockStorage()
    lists = new MailchimpLists(storage)
  })

  // ===========================================================================
  // LIST CRUD (15 tests)
  // ===========================================================================

  describe('List CRUD', () => {
    describe('create', () => {
      it('should create a list with required fields', async () => {
        const list = await lists.create({
          name: 'Newsletter',
          contact: {
            company: 'Acme Inc',
            address1: '123 Main St',
            city: 'San Francisco',
            state: 'CA',
            zip: '94102',
            country: 'US',
          },
          permissionReminder: 'You signed up for our newsletter',
          campaignDefaults: {
            fromName: 'Acme Inc',
            fromEmail: 'newsletter@acme.com',
            subject: 'Acme Newsletter',
            language: 'en',
          },
        })

        expect(list).toBeDefined()
        expect(list.id).toBeTruthy()
        expect(list.name).toBe('Newsletter')
        expect(list.contact.company).toBe('Acme Inc')
        expect(list.stats.memberCount).toBe(0)
      })

      it('should set default values for new list', async () => {
        const list = await lists.create({
          name: 'Simple List',
          contact: {
            company: 'Test Co',
            address1: '456 Oak Ave',
            city: 'Austin',
            state: 'TX',
            zip: '78701',
            country: 'US',
          },
          permissionReminder: 'You opted in',
          campaignDefaults: {
            fromName: 'Test Co',
            fromEmail: 'hello@test.co',
            subject: 'Updates',
            language: 'en',
          },
        })

        expect(list.doubleOptin).toBe(false)
        expect(list.marketingPermissions).toBe(false)
        expect(list.stats.memberCount).toBe(0)
        expect(list.stats.unsubscribeCount).toBe(0)
        expect(list.stats.cleanedCount).toBe(0)
        expect(list.dateCreated).toBeTruthy()
      })

      it('should generate unique IDs for lists', async () => {
        const list1 = await lists.create({
          name: 'List 1',
          contact: { company: 'Co 1', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
        })
        const list2 = await lists.create({
          name: 'List 2',
          contact: { company: 'Co 2', address1: '2 St', city: 'LA', state: 'CA', zip: '90001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'c@d.com', subject: 'Test', language: 'en' },
        })

        expect(list1.id).not.toBe(list2.id)
      })
    })

    describe('get', () => {
      it('should get a list by ID', async () => {
        const created = await lists.create({
          name: 'My List',
          contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
        })

        const retrieved = await lists.get(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.name).toBe('My List')
      })

      it('should throw error for non-existent list', async () => {
        await expect(lists.get('non-existent-id')).rejects.toThrow(MailchimpError)
        await expect(lists.get('non-existent-id')).rejects.toMatchObject({
          status: 404,
          title: 'Resource Not Found',
        })
      })
    })

    describe('update', () => {
      it('should update list name', async () => {
        const created = await lists.create({
          name: 'Original Name',
          contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
        })

        const updated = await lists.update(created.id, { name: 'New Name' })

        expect(updated.name).toBe('New Name')
        expect(updated.id).toBe(created.id)
      })

      it('should update campaign defaults', async () => {
        const created = await lists.create({
          name: 'Test List',
          contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Old Name', fromEmail: 'old@test.com', subject: 'Old', language: 'en' },
        })

        const updated = await lists.update(created.id, {
          campaignDefaults: { fromName: 'New Name', fromEmail: 'new@test.com', subject: 'New', language: 'en' },
        })

        expect(updated.campaignDefaults.fromName).toBe('New Name')
        expect(updated.campaignDefaults.fromEmail).toBe('new@test.com')
      })

      it('should throw error when updating non-existent list', async () => {
        await expect(lists.update('non-existent', { name: 'Test' })).rejects.toThrow(MailchimpError)
      })
    })

    describe('delete', () => {
      it('should delete a list', async () => {
        const created = await lists.create({
          name: 'To Delete',
          contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
        })

        await lists.delete(created.id)

        await expect(lists.get(created.id)).rejects.toThrow(MailchimpError)
      })

      it('should throw error when deleting non-existent list', async () => {
        await expect(lists.delete('non-existent')).rejects.toThrow(MailchimpError)
      })
    })

    describe('list', () => {
      it('should list all lists', async () => {
        await lists.create({
          name: 'List 1',
          contact: { company: 'Co', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
        })
        await lists.create({
          name: 'List 2',
          contact: { company: 'Co', address1: '2 St', city: 'LA', state: 'CA', zip: '90001', country: 'US' },
          permissionReminder: 'Test',
          campaignDefaults: { fromName: 'Test', fromEmail: 'c@d.com', subject: 'Test', language: 'en' },
        })

        const result = await lists.list()

        expect(result.lists.length).toBe(2)
        expect(result.totalItems).toBe(2)
      })

      it('should paginate lists', async () => {
        for (let i = 0; i < 5; i++) {
          await lists.create({
            name: `List ${i}`,
            contact: { company: 'Co', address1: `${i} St`, city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
            permissionReminder: 'Test',
            campaignDefaults: { fromName: 'Test', fromEmail: `test${i}@b.com`, subject: 'Test', language: 'en' },
          })
        }

        const page1 = await lists.list({ count: 2, offset: 0 })
        const page2 = await lists.list({ count: 2, offset: 2 })

        expect(page1.lists.length).toBe(2)
        expect(page2.lists.length).toBe(2)
        expect(page1.totalItems).toBe(5)
      })
    })
  })

  // ===========================================================================
  // MEMBERS API (20 tests)
  // ===========================================================================

  describe('Members API', () => {
    let listId: string

    beforeEach(async () => {
      const list = await lists.create({
        name: 'Test List',
        contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
        permissionReminder: 'Test',
        campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
      })
      listId = list.id
    })

    describe('addMember', () => {
      it('should add a member to a list', async () => {
        const member = await lists.members.add(listId, {
          emailAddress: 'user@example.com',
          status: 'subscribed',
        })

        expect(member).toBeDefined()
        expect(member.id).toBeTruthy()
        expect(member.emailAddress).toBe('user@example.com')
        expect(member.status).toBe('subscribed')
      })

      it('should add member with merge fields', async () => {
        const member = await lists.members.add(listId, {
          emailAddress: 'john@example.com',
          status: 'subscribed',
          mergeFields: {
            FNAME: 'John',
            LNAME: 'Doe',
            PHONE: '555-1234',
          },
        })

        expect(member.mergeFields.FNAME).toBe('John')
        expect(member.mergeFields.LNAME).toBe('Doe')
        expect(member.mergeFields.PHONE).toBe('555-1234')
      })

      it('should add member with tags', async () => {
        const member = await lists.members.add(listId, {
          emailAddress: 'tagged@example.com',
          status: 'subscribed',
          tags: ['vip', 'early-adopter'],
        })

        expect(member.tags).toContain('vip')
        expect(member.tags).toContain('early-adopter')
      })

      it('should add member as pending (double opt-in)', async () => {
        const member = await lists.members.add(listId, {
          emailAddress: 'pending@example.com',
          status: 'pending',
        })

        expect(member.status).toBe('pending')
      })

      it('should throw error for duplicate email', async () => {
        await lists.members.add(listId, {
          emailAddress: 'duplicate@example.com',
          status: 'subscribed',
        })

        await expect(
          lists.members.add(listId, {
            emailAddress: 'duplicate@example.com',
            status: 'subscribed',
          })
        ).rejects.toThrow(MailchimpError)
      })

      it('should throw error for invalid email', async () => {
        await expect(
          lists.members.add(listId, {
            emailAddress: 'not-an-email',
            status: 'subscribed',
          })
        ).rejects.toThrow(MailchimpError)
      })

      it('should update list stats after adding member', async () => {
        await lists.members.add(listId, { emailAddress: 'stats@example.com', status: 'subscribed' })

        const list = await lists.get(listId)
        expect(list.stats.memberCount).toBe(1)
      })
    })

    describe('getMember', () => {
      it('should get member by subscriber hash (MD5 of email)', async () => {
        const added = await lists.members.add(listId, {
          emailAddress: 'get@example.com',
          status: 'subscribed',
        })

        const retrieved = await lists.members.get(listId, added.id)

        expect(retrieved.emailAddress).toBe('get@example.com')
      })

      it('should get member by email address', async () => {
        await lists.members.add(listId, {
          emailAddress: 'byemail@example.com',
          status: 'subscribed',
        })

        const retrieved = await lists.members.getByEmail(listId, 'byemail@example.com')

        expect(retrieved.emailAddress).toBe('byemail@example.com')
      })

      it('should throw error for non-existent member', async () => {
        await expect(lists.members.get(listId, 'non-existent')).rejects.toThrow(MailchimpError)
      })
    })

    describe('updateMember', () => {
      it('should update member status', async () => {
        const added = await lists.members.add(listId, {
          emailAddress: 'update@example.com',
          status: 'subscribed',
        })

        const updated = await lists.members.update(listId, added.id, {
          status: 'unsubscribed',
        })

        expect(updated.status).toBe('unsubscribed')
      })

      it('should update merge fields', async () => {
        const added = await lists.members.add(listId, {
          emailAddress: 'merge@example.com',
          status: 'subscribed',
          mergeFields: { FNAME: 'Original' },
        })

        const updated = await lists.members.update(listId, added.id, {
          mergeFields: { FNAME: 'Updated', LNAME: 'Name' },
        })

        expect(updated.mergeFields.FNAME).toBe('Updated')
        expect(updated.mergeFields.LNAME).toBe('Name')
      })

      it('should track unsubscribe in stats', async () => {
        const added = await lists.members.add(listId, {
          emailAddress: 'unsub@example.com',
          status: 'subscribed',
        })

        await lists.members.update(listId, added.id, { status: 'unsubscribed' })

        const list = await lists.get(listId)
        expect(list.stats.unsubscribeCount).toBe(1)
      })
    })

    describe('deleteMember', () => {
      it('should delete (archive) a member', async () => {
        const added = await lists.members.add(listId, {
          emailAddress: 'delete@example.com',
          status: 'subscribed',
        })

        await lists.members.delete(listId, added.id)

        await expect(lists.members.get(listId, added.id)).rejects.toThrow(MailchimpError)
      })

      it('should permanently delete a member', async () => {
        const added = await lists.members.add(listId, {
          emailAddress: 'permanent@example.com',
          status: 'subscribed',
        })

        await lists.members.deletePermanently(listId, added.id)

        // Should not be able to re-add as archived
        const newMember = await lists.members.add(listId, {
          emailAddress: 'permanent@example.com',
          status: 'subscribed',
        })
        expect(newMember.emailAddress).toBe('permanent@example.com')
      })
    })

    describe('listMembers', () => {
      it('should list all members', async () => {
        await lists.members.add(listId, { emailAddress: 'user1@example.com', status: 'subscribed' })
        await lists.members.add(listId, { emailAddress: 'user2@example.com', status: 'subscribed' })
        await lists.members.add(listId, { emailAddress: 'user3@example.com', status: 'subscribed' })

        const result = await lists.members.list(listId)

        expect(result.members.length).toBe(3)
        expect(result.totalItems).toBe(3)
      })

      it('should filter members by status', async () => {
        await lists.members.add(listId, { emailAddress: 'sub1@example.com', status: 'subscribed' })
        await lists.members.add(listId, { emailAddress: 'sub2@example.com', status: 'subscribed' })
        await lists.members.add(listId, { emailAddress: 'unsub@example.com', status: 'unsubscribed' })

        const subscribed = await lists.members.list(listId, { status: 'subscribed' })
        const unsubscribed = await lists.members.list(listId, { status: 'unsubscribed' })

        expect(subscribed.members.length).toBe(2)
        expect(unsubscribed.members.length).toBe(1)
      })

      it('should paginate members', async () => {
        for (let i = 0; i < 10; i++) {
          await lists.members.add(listId, { emailAddress: `user${i}@example.com`, status: 'subscribed' })
        }

        const page1 = await lists.members.list(listId, { count: 3, offset: 0 })
        const page2 = await lists.members.list(listId, { count: 3, offset: 3 })

        expect(page1.members.length).toBe(3)
        expect(page2.members.length).toBe(3)
        expect(page1.totalItems).toBe(10)
      })
    })

    describe('batchMembers', () => {
      it('should add multiple members in batch', async () => {
        const result = await lists.members.batch(listId, {
          members: [
            { emailAddress: 'batch1@example.com', status: 'subscribed' },
            { emailAddress: 'batch2@example.com', status: 'subscribed' },
            { emailAddress: 'batch3@example.com', status: 'subscribed' },
          ],
        })

        expect(result.newMembers.length).toBe(3)
        expect(result.updatedMembers.length).toBe(0)
        expect(result.errors.length).toBe(0)
      })

      it('should update existing members in batch', async () => {
        await lists.members.add(listId, { emailAddress: 'existing@example.com', status: 'subscribed' })

        const result = await lists.members.batch(listId, {
          members: [
            { emailAddress: 'existing@example.com', status: 'subscribed', mergeFields: { FNAME: 'Updated' } },
            { emailAddress: 'new@example.com', status: 'subscribed' },
          ],
          updateExisting: true,
        })

        expect(result.newMembers.length).toBe(1)
        expect(result.updatedMembers.length).toBe(1)
      })
    })
  })

  // ===========================================================================
  // SEGMENTS API (10 tests)
  // ===========================================================================

  describe('Segments API', () => {
    let listId: string

    beforeEach(async () => {
      const list = await lists.create({
        name: 'Segment Test List',
        contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
        permissionReminder: 'Test',
        campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
      })
      listId = list.id
    })

    describe('createSegment', () => {
      it('should create a saved segment', async () => {
        const segment = await lists.segments.create(listId, {
          name: 'VIP Customers',
          staticSegment: [],
        })

        expect(segment).toBeDefined()
        expect(segment.id).toBeTruthy()
        expect(segment.name).toBe('VIP Customers')
        expect(segment.memberCount).toBe(0)
      })

      it('should create a segment with conditions', async () => {
        const segment = await lists.segments.create(listId, {
          name: 'Recent Subscribers',
          options: {
            match: 'all',
            conditions: [
              {
                conditionType: 'DateMerge',
                field: 'timestamp_opt',
                op: 'greater',
                value: '2024-01-01',
              },
            ],
          },
        })

        expect(segment.name).toBe('Recent Subscribers')
        expect(segment.options?.conditions.length).toBe(1)
      })

      it('should create a static segment with member IDs', async () => {
        const member1 = await lists.members.add(listId, { emailAddress: 'seg1@example.com', status: 'subscribed' })
        const member2 = await lists.members.add(listId, { emailAddress: 'seg2@example.com', status: 'subscribed' })

        const segment = await lists.segments.create(listId, {
          name: 'Manual Segment',
          staticSegment: [member1.emailAddress, member2.emailAddress],
        })

        expect(segment.memberCount).toBe(2)
      })
    })

    describe('getSegment', () => {
      it('should get segment by ID', async () => {
        const created = await lists.segments.create(listId, {
          name: 'Get Test',
          staticSegment: [],
        })

        const retrieved = await lists.segments.get(listId, created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.name).toBe('Get Test')
      })
    })

    describe('updateSegment', () => {
      it('should update segment name', async () => {
        const created = await lists.segments.create(listId, {
          name: 'Original',
          staticSegment: [],
        })

        const updated = await lists.segments.update(listId, created.id, {
          name: 'Updated Name',
        })

        expect(updated.name).toBe('Updated Name')
      })

      it('should add members to static segment', async () => {
        const member = await lists.members.add(listId, { emailAddress: 'add@example.com', status: 'subscribed' })
        const segment = await lists.segments.create(listId, {
          name: 'Add Test',
          staticSegment: [],
        })

        await lists.segments.addMembers(listId, segment.id, [member.emailAddress])

        const updated = await lists.segments.get(listId, segment.id)
        expect(updated.memberCount).toBe(1)
      })

      it('should remove members from static segment', async () => {
        const member = await lists.members.add(listId, { emailAddress: 'remove@example.com', status: 'subscribed' })
        const segment = await lists.segments.create(listId, {
          name: 'Remove Test',
          staticSegment: [member.emailAddress],
        })

        await lists.segments.removeMembers(listId, segment.id, [member.emailAddress])

        const updated = await lists.segments.get(listId, segment.id)
        expect(updated.memberCount).toBe(0)
      })
    })

    describe('deleteSegment', () => {
      it('should delete a segment', async () => {
        const created = await lists.segments.create(listId, {
          name: 'To Delete',
          staticSegment: [],
        })

        await lists.segments.delete(listId, created.id)

        await expect(lists.segments.get(listId, created.id)).rejects.toThrow(MailchimpError)
      })
    })

    describe('listSegments', () => {
      it('should list all segments', async () => {
        await lists.segments.create(listId, { name: 'Segment 1', staticSegment: [] })
        await lists.segments.create(listId, { name: 'Segment 2', staticSegment: [] })

        const result = await lists.segments.list(listId)

        expect(result.segments.length).toBe(2)
        expect(result.totalItems).toBe(2)
      })
    })
  })

  // ===========================================================================
  // TAGS API (5 tests)
  // ===========================================================================

  describe('Tags API', () => {
    let listId: string

    beforeEach(async () => {
      const list = await lists.create({
        name: 'Tags Test List',
        contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
        permissionReminder: 'Test',
        campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
      })
      listId = list.id
    })

    it('should create a tag', async () => {
      const tag = await lists.tags.create(listId, { name: 'VIP' })

      expect(tag).toBeDefined()
      expect(tag.id).toBeTruthy()
      expect(tag.name).toBe('VIP')
    })

    it('should list all tags', async () => {
      await lists.tags.create(listId, { name: 'Tag 1' })
      await lists.tags.create(listId, { name: 'Tag 2' })

      const result = await lists.tags.list(listId)

      expect(result.tags.length).toBe(2)
    })

    it('should add tag to member', async () => {
      const member = await lists.members.add(listId, { emailAddress: 'tag@example.com', status: 'subscribed' })
      await lists.tags.create(listId, { name: 'Special' })

      await lists.members.addTags(listId, member.id, ['Special'])

      const updated = await lists.members.get(listId, member.id)
      expect(updated.tags).toContain('Special')
    })

    it('should remove tag from member', async () => {
      const member = await lists.members.add(listId, {
        emailAddress: 'untag@example.com',
        status: 'subscribed',
        tags: ['RemoveMe'],
      })

      await lists.members.removeTags(listId, member.id, ['RemoveMe'])

      const updated = await lists.members.get(listId, member.id)
      expect(updated.tags).not.toContain('RemoveMe')
    })

    it('should delete a tag', async () => {
      const tag = await lists.tags.create(listId, { name: 'ToDelete' })

      await lists.tags.delete(listId, tag.id)

      const result = await lists.tags.list(listId)
      expect(result.tags.find((t: Tag) => t.id === tag.id)).toBeUndefined()
    })
  })

  // ===========================================================================
  // WEBHOOKS API (5 tests)
  // ===========================================================================

  describe('Webhooks API', () => {
    let listId: string

    beforeEach(async () => {
      const list = await lists.create({
        name: 'Webhook Test List',
        contact: { company: 'Test', address1: '1 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
        permissionReminder: 'Test',
        campaignDefaults: { fromName: 'Test', fromEmail: 'a@b.com', subject: 'Test', language: 'en' },
      })
      listId = list.id
    })

    it('should create a webhook', async () => {
      const webhook = await lists.webhooks.create(listId, {
        url: 'https://example.com/webhook',
        events: { subscribe: true, unsubscribe: true },
        sources: { user: true, admin: true, api: true },
      })

      expect(webhook).toBeDefined()
      expect(webhook.id).toBeTruthy()
      expect(webhook.url).toBe('https://example.com/webhook')
    })

    it('should get webhook by ID', async () => {
      const created = await lists.webhooks.create(listId, {
        url: 'https://example.com/get',
        events: { subscribe: true },
        sources: { user: true },
      })

      const retrieved = await lists.webhooks.get(listId, created.id)

      expect(retrieved.id).toBe(created.id)
    })

    it('should update webhook URL', async () => {
      const created = await lists.webhooks.create(listId, {
        url: 'https://example.com/old',
        events: { subscribe: true },
        sources: { user: true },
      })

      const updated = await lists.webhooks.update(listId, created.id, {
        url: 'https://example.com/new',
      })

      expect(updated.url).toBe('https://example.com/new')
    })

    it('should delete a webhook', async () => {
      const created = await lists.webhooks.create(listId, {
        url: 'https://example.com/delete',
        events: { subscribe: true },
        sources: { user: true },
      })

      await lists.webhooks.delete(listId, created.id)

      await expect(lists.webhooks.get(listId, created.id)).rejects.toThrow(MailchimpError)
    })

    it('should list all webhooks', async () => {
      await lists.webhooks.create(listId, {
        url: 'https://example.com/hook1',
        events: { subscribe: true },
        sources: { user: true },
      })
      await lists.webhooks.create(listId, {
        url: 'https://example.com/hook2',
        events: { unsubscribe: true },
        sources: { admin: true },
      })

      const result = await lists.webhooks.list(listId)

      expect(result.webhooks.length).toBe(2)
    })
  })
})
