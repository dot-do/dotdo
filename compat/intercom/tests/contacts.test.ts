/**
 * @dotdo/intercom - Contacts & Companies API Tests (RED Phase)
 *
 * TDD RED phase tests for Intercom Contacts and Companies API:
 * - Contact CRUD operations
 * - Contact search with various operators
 * - Contact merge functionality
 * - Contact tags management
 * - Company associations
 * - Custom attributes
 * - Company CRUD operations
 *
 * These tests define the expected behavior before implementation.
 *
 * @see https://developers.intercom.com/docs/references/rest-api/api.intercom.io/Contacts/
 * @see https://developers.intercom.com/docs/references/rest-api/api.intercom.io/Companies/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntercomLocal, type IntercomLocalConfig } from '../local'
import type {
  Contact,
  Company,
  Tag,
  ListResponse,
  SearchResponse,
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

function uniqueEmail(): string {
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`
}

function uniqueExternalId(): string {
  return `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// =============================================================================
// 1. Contact CRUD (20+ tests)
// =============================================================================

describe('@dotdo/intercom - Contact CRUD', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('create', () => {
    it('should create a contact with email only', async () => {
      const email = uniqueEmail()
      const contact = await client.contacts.create({
        role: 'user',
        email,
      })

      expect(contact.type).toBe('contact')
      expect(contact.id).toBeDefined()
      expect(contact.email).toBe(email)
      expect(contact.role).toBe('user')
      expect(contact.created_at).toBeDefined()
      expect(contact.updated_at).toBeDefined()
    })

    it('should create a contact with all fields', async () => {
      const email = uniqueEmail()
      const externalId = uniqueExternalId()
      const now = Math.floor(Date.now() / 1000)

      const contact = await client.contacts.create({
        role: 'user',
        email,
        external_id: externalId,
        name: 'John Doe',
        phone: '+1-555-123-4567',
        avatar: 'https://example.com/avatar.jpg',
        signed_up_at: now - 86400,
        last_seen_at: now,
        owner_id: 'admin_123',
        unsubscribed_from_emails: false,
        custom_attributes: {
          plan: 'premium',
          company_size: 50,
          is_vip: true,
        },
      })

      expect(contact.email).toBe(email)
      expect(contact.external_id).toBe(externalId)
      expect(contact.name).toBe('John Doe')
      expect(contact.phone).toBe('+1-555-123-4567')
      expect(contact.avatar).toBe('https://example.com/avatar.jpg')
      expect(contact.signed_up_at).toBe(now - 86400)
      expect(contact.last_seen_at).toBe(now)
      expect(contact.owner_id).toBe('admin_123')
      expect(contact.unsubscribed_from_emails).toBe(false)
      expect(contact.custom_attributes.plan).toBe('premium')
      expect(contact.custom_attributes.company_size).toBe(50)
      expect(contact.custom_attributes.is_vip).toBe(true)
    })

    it('should create a lead (visitor without required email)', async () => {
      // Leads don't require email
      const contact = await client.contacts.create({
        role: 'lead',
      })

      expect(contact.type).toBe('contact')
      expect(contact.role).toBe('lead')
      expect(contact.email).toBeNull()
    })

    it('should create a lead with email', async () => {
      const email = uniqueEmail()
      const contact = await client.contacts.create({
        role: 'lead',
        email,
        name: 'Anonymous Visitor',
      })

      expect(contact.role).toBe('lead')
      expect(contact.email).toBe(email)
      expect(contact.name).toBe('Anonymous Visitor')
    })

    it('should auto-assign workspace_id', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      expect(contact.workspace_id).toBe('test_workspace')
    })

    it('should initialize empty tags, notes, and companies lists', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      expect(contact.tags.type).toBe('list')
      expect(contact.tags.data).toEqual([])
      expect(contact.notes.type).toBe('list')
      expect(contact.notes.data).toEqual([])
      expect(contact.companies.type).toBe('list')
      expect(contact.companies.data).toEqual([])
    })

    it('should reject duplicate email for users', async () => {
      const email = uniqueEmail()

      await client.contacts.create({
        role: 'user',
        email,
      })

      // TODO: Implement duplicate email rejection
      await expect(
        client.contacts.create({
          role: 'user',
          email, // Same email
        })
      ).rejects.toThrow()
    })

    it('should reject duplicate external_id', async () => {
      const externalId = uniqueExternalId()

      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        external_id: externalId,
      })

      // TODO: Implement duplicate external_id rejection
      await expect(
        client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          external_id: externalId, // Same external_id
        })
      ).rejects.toThrow()
    })
  })

  describe('find (get by ID)', () => {
    it('should get contact by ID', async () => {
      const email = uniqueEmail()
      const created = await client.contacts.create({
        role: 'user',
        email,
        name: 'Test User',
      })

      const found = await client.contacts.find(created.id)

      expect(found.id).toBe(created.id)
      expect(found.email).toBe(email)
      expect(found.name).toBe('Test User')
    })

    it('should throw error for non-existent contact', async () => {
      await expect(client.contacts.find('nonexistent_id')).rejects.toThrow()
    })

    it('should include nested company data', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      // TODO: Implement companies resource and attach
      const company = await client.companies.create({
        company_id: 'acme_inc',
        name: 'Acme Inc',
      })

      await client.contacts.companies.attach(contact.id, { id: company.id })

      const found = await client.contacts.find(contact.id)

      expect(found.companies.data.length).toBeGreaterThan(0)
      expect(found.companies.data[0].id).toBe(company.id)
    })
  })

  describe('findByExternalId', () => {
    it('should get contact by external_id', async () => {
      const externalId = uniqueExternalId()
      const created = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        external_id: externalId,
      })

      const found = await client.contacts.findByExternalId(externalId)

      expect(found?.id).toBe(created.id)
      expect(found?.external_id).toBe(externalId)
    })

    it('should return null for non-existent external_id', async () => {
      const found = await client.contacts.findByExternalId('nonexistent_ext_id')
      expect(found).toBeNull()
    })
  })

  describe('update', () => {
    it('should update contact properties', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: 'Original Name',
      })

      const updated = await client.contacts.update(contact.id, {
        name: 'Updated Name',
        phone: '+1-555-987-6543',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.phone).toBe('+1-555-987-6543')
      expect(updated.updated_at).toBeGreaterThanOrEqual(contact.updated_at)
    })

    it('should merge custom attributes', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: {
          plan: 'free',
          signup_source: 'website',
        },
      })

      const updated = await client.contacts.update(contact.id, {
        custom_attributes: {
          plan: 'premium',
          upgraded_at: Math.floor(Date.now() / 1000),
        },
      })

      expect(updated.custom_attributes.plan).toBe('premium')
      expect(updated.custom_attributes.signup_source).toBe('website') // Preserved
      expect(updated.custom_attributes.upgraded_at).toBeDefined()
    })

    it('should update email and update index', async () => {
      const oldEmail = uniqueEmail()
      const newEmail = uniqueEmail()

      const contact = await client.contacts.create({
        role: 'user',
        email: oldEmail,
      })

      await client.contacts.update(contact.id, { email: newEmail })

      // Old email should not find the contact
      const oldSearch = await client.contacts.findByEmail(oldEmail)
      expect(oldSearch).toBeNull()

      // New email should find the contact
      const newSearch = await client.contacts.findByEmail(newEmail)
      expect(newSearch?.id).toBe(contact.id)
    })

    it('should throw error for non-existent contact', async () => {
      await expect(
        client.contacts.update('nonexistent_id', { name: 'Test' })
      ).rejects.toThrow()
    })
  })

  describe('delete (archive)', () => {
    it('should delete (archive) a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const result = await client.contacts.delete(contact.id)

      expect(result.type).toBe('contact')
      expect(result.id).toBe(contact.id)
      expect(result.deleted).toBe(true)
    })

    it('should remove contact from email index after delete', async () => {
      const email = uniqueEmail()
      const contact = await client.contacts.create({
        role: 'user',
        email,
      })

      await client.contacts.delete(contact.id)

      const found = await client.contacts.findByEmail(email)
      expect(found).toBeNull()
    })

    it('should throw error for non-existent contact', async () => {
      await expect(client.contacts.delete('nonexistent_id')).rejects.toThrow()
    })
  })

  describe('permanentlyDelete', () => {
    it('should permanently delete a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      // TODO: Implement permanentlyDelete
      const result = await client.contacts.permanentlyDelete(contact.id)

      expect(result.deleted).toBe(true)

      // Should not be recoverable
      await expect(client.contacts.find(contact.id)).rejects.toThrow()
    })

    it('should cascade delete related data', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      // Add notes, tags, etc
      await client.contacts.notes.create(contact.id, {
        body: 'Test note',
        admin_id: 'admin_123',
      })

      await client.contacts.permanentlyDelete(contact.id)

      // Notes should also be deleted
      await expect(client.contacts.notes.list(contact.id)).rejects.toThrow()
    })
  })

  describe('list', () => {
    it('should list contacts with pagination', async () => {
      // Create multiple contacts
      for (let i = 0; i < 25; i++) {
        await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
        })
      }

      const firstPage = await client.contacts.list({ per_page: 10 })

      expect(firstPage.type).toBe('list')
      expect(firstPage.data.length).toBe(10)
      expect(firstPage.total_count).toBeGreaterThanOrEqual(25)
      expect(firstPage.pages.total_pages).toBeGreaterThanOrEqual(3)
    })

    it('should support starting_after cursor', async () => {
      const contacts: Contact[] = []
      for (let i = 0; i < 15; i++) {
        contacts.push(
          await client.contacts.create({
            role: 'user',
            email: uniqueEmail(),
          })
        )
      }

      const firstPage = await client.contacts.list({ per_page: 10 })
      const lastContactOfFirstPage = firstPage.data[firstPage.data.length - 1]

      const secondPage = await client.contacts.list({
        per_page: 10,
        starting_after: lastContactOfFirstPage.id,
      })

      expect(secondPage.data.length).toBeGreaterThan(0)
      // Should not include contacts from first page
      const firstPageIds = new Set(firstPage.data.map((c) => c.id))
      for (const contact of secondPage.data) {
        expect(firstPageIds.has(contact.id)).toBe(false)
      }
    })

    it('should return empty list when no contacts exist', async () => {
      const freshClient = createTestClient({ workspaceId: 'empty_workspace' })
      const result = await freshClient.contacts.list()

      expect(result.data).toEqual([])
      expect(result.total_count).toBe(0)
    })
  })

  describe('archive and unarchive', () => {
    it('should archive a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const result = await client.contacts.archive(contact.id)

      expect(result.id).toBe(contact.id)
      expect(result.archived).toBe(true)
    })

    it('should unarchive a contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      await client.contacts.archive(contact.id)
      const result = await client.contacts.unarchive(contact.id)

      expect(result.id).toBe(contact.id)
      expect(result.archived).toBe(false)
    })

    it('should exclude archived contacts from list by default', async () => {
      const contact1 = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })
      const contact2 = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      await client.contacts.archive(contact1.id)

      // TODO: Implement archived filter in list
      const result = await client.contacts.list()

      const ids = result.data.map((c) => c.id)
      expect(ids).not.toContain(contact1.id)
      expect(ids).toContain(contact2.id)
    })
  })
})

// =============================================================================
// 2. Contact Search (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Contact Search', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('exact match', () => {
    it('should search by email exact match', async () => {
      const email = uniqueEmail()
      const contact = await client.contacts.create({
        role: 'user',
        email,
        name: 'Search Test',
      })

      const result = await client.contacts.search({
        query: { field: 'email', operator: '=', value: email },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].id).toBe(contact.id)
    })

    it('should search by name', async () => {
      const name = `Test User ${Date.now()}`
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name,
      })

      const result = await client.contacts.search({
        query: { field: 'name', operator: '=', value: name },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe(name)
    })

    it('should search by role', async () => {
      await client.contacts.create({ role: 'user', email: uniqueEmail() })
      await client.contacts.create({ role: 'lead', email: uniqueEmail() })
      await client.contacts.create({ role: 'user', email: uniqueEmail() })

      const result = await client.contacts.search({
        query: { field: 'role', operator: '=', value: 'lead' },
      })

      expect(result.data.every((c) => c.role === 'lead')).toBe(true)
    })
  })

  describe('contains/like', () => {
    it('should search by email contains', async () => {
      const domain = `searchtest${Date.now()}.com`
      await client.contacts.create({
        role: 'user',
        email: `alice@${domain}`,
      })
      await client.contacts.create({
        role: 'user',
        email: `bob@${domain}`,
      })
      await client.contacts.create({
        role: 'user',
        email: 'other@example.com',
      })

      const result = await client.contacts.search({
        query: { field: 'email', operator: '~', value: domain },
      })

      expect(result.data.length).toBe(2)
      expect(result.data.every((c) => c.email?.includes(domain))).toBe(true)
    })

    it('should search by email starts_with', async () => {
      const prefix = `startstest_${Date.now()}`
      await client.contacts.create({
        role: 'user',
        email: `${prefix}_alice@example.com`,
      })
      await client.contacts.create({
        role: 'user',
        email: `${prefix}_bob@example.com`,
      })
      await client.contacts.create({
        role: 'user',
        email: 'other@example.com',
      })

      const result = await client.contacts.search({
        query: { field: 'email', operator: 'starts_with', value: prefix },
      })

      expect(result.data.length).toBe(2)
    })
  })

  describe('custom attributes', () => {
    it('should search by custom string attribute', async () => {
      const planId = `plan_${Date.now()}`
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { plan: planId },
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { plan: 'other' },
      })

      const result = await client.contacts.search({
        query: {
          field: 'custom_attributes.plan',
          operator: '=',
          value: planId,
        },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].custom_attributes.plan).toBe(planId)
    })

    it('should search by custom number attribute with comparison', async () => {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { monthly_spend: 500 },
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { monthly_spend: 1500 },
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { monthly_spend: 2500 },
      })

      const result = await client.contacts.search({
        query: {
          field: 'custom_attributes.monthly_spend',
          operator: '>',
          value: 1000,
        },
      })

      expect(result.data.length).toBe(2)
      expect(result.data.every((c) => (c.custom_attributes.monthly_spend as number) > 1000)).toBe(true)
    })

    it('should search by custom boolean attribute', async () => {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { is_vip: true },
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { is_vip: false },
      })

      const result = await client.contacts.search({
        query: {
          field: 'custom_attributes.is_vip',
          operator: '=',
          value: true,
        },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].custom_attributes.is_vip).toBe(true)
    })
  })

  describe('compound queries (AND/OR)', () => {
    it('should search with multiple filters (AND)', async () => {
      const domain = `andtest${Date.now()}.com`
      await client.contacts.create({
        role: 'user',
        email: `user@${domain}`,
        custom_attributes: { plan: 'premium' },
      })
      await client.contacts.create({
        role: 'user',
        email: `other@${domain}`,
        custom_attributes: { plan: 'free' },
      })
      await client.contacts.create({
        role: 'lead',
        email: `lead@${domain}`,
        custom_attributes: { plan: 'premium' },
      })

      const result = await client.contacts.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'role', operator: '=', value: 'user' },
            { field: 'custom_attributes.plan', operator: '=', value: 'premium' },
          ],
        },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].role).toBe('user')
      expect(result.data[0].custom_attributes.plan).toBe('premium')
    })

    it('should search with OR conditions', async () => {
      const marker = `ortest_${Date.now()}`
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { plan: 'enterprise', marker },
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { monthly_spend: 15000, marker },
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { plan: 'free', monthly_spend: 100, marker },
      })

      const result = await client.contacts.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'custom_attributes.marker', operator: '=', value: marker },
            {
              operator: 'OR',
              value: [
                { field: 'custom_attributes.plan', operator: '=', value: 'enterprise' },
                { field: 'custom_attributes.monthly_spend', operator: '>', value: 10000 },
              ],
            },
          ],
        },
      })

      expect(result.data.length).toBe(2)
    })
  })

  describe('date range', () => {
    it('should search by created_at date range', async () => {
      const now = Math.floor(Date.now() / 1000)
      const hourAgo = now - 3600

      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const result = await client.contacts.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'created_at', operator: '>', value: hourAgo },
            { field: 'created_at', operator: '<', value: now + 60 },
          ],
        },
      })

      expect(result.data.length).toBeGreaterThanOrEqual(1)
      expect(result.data.some((c) => c.id === contact.id)).toBe(true)
    })

    it('should search by last_seen_at', async () => {
      const now = Math.floor(Date.now() / 1000)
      const dayAgo = now - 86400

      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        last_seen_at: now, // Active today
      })
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        last_seen_at: now - 86400 * 30, // Inactive for 30 days
      })

      const result = await client.contacts.search({
        query: {
          field: 'last_seen_at',
          operator: '>',
          value: dayAgo,
        },
      })

      expect(result.data.every((c) => c.last_seen_at && c.last_seen_at > dayAgo)).toBe(true)
    })
  })

  describe('pagination and sorting', () => {
    it('should support search pagination', async () => {
      const marker = `paginationtest_${Date.now()}`
      for (let i = 0; i < 25; i++) {
        await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          custom_attributes: { marker },
        })
      }

      const firstPage = await client.contacts.search({
        query: { field: 'custom_attributes.marker', operator: '=', value: marker },
        pagination: { per_page: 10 },
      })

      expect(firstPage.data.length).toBe(10)
      expect(firstPage.total_count).toBe(25)
      expect(firstPage.pages.next).toBeDefined()
    })

    it('should support search with sorting', async () => {
      const marker = `sorttest_${Date.now()}`
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: 'Alice',
        custom_attributes: { marker },
      })
      await new Promise((r) => setTimeout(r, 10))
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: 'Bob',
        custom_attributes: { marker },
      })

      // TODO: Implement sort in search
      const descResult = await client.contacts.search({
        query: { field: 'custom_attributes.marker', operator: '=', value: marker },
        sort: { field: 'created_at', order: 'descending' },
      })

      expect(descResult.data[0].name).toBe('Bob')

      const ascResult = await client.contacts.search({
        query: { field: 'custom_attributes.marker', operator: '=', value: marker },
        sort: { field: 'created_at', order: 'ascending' },
      })

      expect(ascResult.data[0].name).toBe('Alice')
    })
  })

  describe('segment membership', () => {
    it('should search by segment membership', async () => {
      // TODO: Implement segments
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      // Add contact to segment
      await client.segments.addContact('segment_vip', contact.id)

      const result = await client.contacts.search({
        query: {
          field: 'segment_id',
          operator: '=',
          value: 'segment_vip',
        },
      })

      expect(result.data.some((c) => c.id === contact.id)).toBe(true)
    })
  })

  describe('empty results', () => {
    it('should handle empty results gracefully', async () => {
      const result = await client.contacts.search({
        query: { field: 'email', operator: '=', value: 'nonexistent@nowhere.com' },
      })

      expect(result.data).toEqual([])
      expect(result.total_count).toBe(0)
    })
  })
})

// =============================================================================
// 3. Contact Merge (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Contact Merge', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should merge two contacts', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      name: 'Contact A',
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      name: 'Contact B',
    })

    const merged = await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    expect(merged.id).toBe(contactA.id)

    // Contact B should no longer exist
    await expect(client.contacts.find(contactB.id)).rejects.toThrow()
  })

  it('should preserve primary contact data', async () => {
    const emailA = uniqueEmail()
    const contactA = await client.contacts.create({
      role: 'user',
      email: emailA,
      name: 'Primary Name',
      phone: '+1-111-111-1111',
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      name: 'Secondary Name',
      phone: '+1-222-222-2222',
    })

    const merged = await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    // Primary contact's data takes precedence
    expect(merged.name).toBe('Primary Name')
    expect(merged.email).toBe(emailA)
    expect(merged.phone).toBe('+1-111-111-1111')
  })

  it('should merge custom attributes', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: {
        plan: 'premium',
        source: 'organic',
      },
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: {
        plan: 'free', // Will be overwritten
        referrer: 'partner_123',
      },
    })

    const merged = await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    expect(merged.custom_attributes.plan).toBe('premium') // Primary wins
    expect(merged.custom_attributes.source).toBe('organic')
    expect(merged.custom_attributes.referrer).toBe('partner_123') // Added from secondary
  })

  it('should combine tags', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Add different tags to each
    await client.contacts.tags.add(contactA.id, { id: 'tag_vip' })
    await client.contacts.tags.add(contactB.id, { id: 'tag_enterprise' })
    await client.contacts.tags.add(contactB.id, { id: 'tag_beta_user' })

    const merged = await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    expect(merged.tags.data.length).toBe(3)
    const tagIds = merged.tags.data.map((t) => t.id)
    expect(tagIds).toContain('tag_vip')
    expect(tagIds).toContain('tag_enterprise')
    expect(tagIds).toContain('tag_beta_user')
  })

  it('should combine company associations', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement companies
    const company1 = await client.companies.create({
      company_id: 'company_1',
      name: 'Company One',
    })
    const company2 = await client.companies.create({
      company_id: 'company_2',
      name: 'Company Two',
    })

    await client.contacts.companies.attach(contactA.id, { id: company1.id })
    await client.contacts.companies.attach(contactB.id, { id: company2.id })

    const merged = await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    expect(merged.companies.data.length).toBe(2)
  })

  it('should combine notes', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.notes.create(contactA.id, {
      body: 'Note on A',
      admin_id: 'admin_123',
    })
    await client.contacts.notes.create(contactB.id, {
      body: 'Note on B',
      admin_id: 'admin_123',
    })

    const merged = await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    const notes = await client.contacts.notes.list(merged.id)
    expect(notes.data.length).toBe(2)
  })

  it('should combine conversation history', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Create conversations for each contact
    await client.conversations.create({
      from: { type: 'user', id: contactA.id },
      body: 'Conversation from A',
    })
    await client.conversations.create({
      from: { type: 'user', id: contactB.id },
      body: 'Conversation from B',
    })

    await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    // TODO: Implement conversation search by contact
    const conversations = await client.conversations.search({
      query: { field: 'contact_ids', operator: '=', value: contactA.id },
    })

    expect(conversations.conversations.length).toBe(2)
  })

  it('should not allow merging same contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await expect(
      client.contacts.merge({
        from: contact.id,
        into: contact.id,
      })
    ).rejects.toThrow()
  })

  it('should record merge in audit trail', async () => {
    const contactA = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const contactB = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.merge({
      from: contactB.id,
      into: contactA.id,
    })

    // TODO: Implement merge audit log
    const auditLog = await client.contacts.getMergeHistory(contactA.id)
    expect(auditLog.length).toBeGreaterThan(0)
    expect(auditLog[0].merged_from).toBe(contactB.id)
  })

  it('should fail when merging user into lead', async () => {
    const user = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const lead = await client.contacts.create({
      role: 'lead',
      email: uniqueEmail(),
    })

    // TODO: Validate role compatibility
    await expect(
      client.contacts.merge({
        from: user.id,
        into: lead.id,
      })
    ).rejects.toThrow()
  })
})

// =============================================================================
// 4. Contact Tags (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Contact Tags', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should add tag to contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const tag = await client.contacts.tags.add(contact.id, { id: 'tag_vip' })

    expect(tag.type).toBe('tag')
    expect(tag.id).toBe('tag_vip')
  })

  it('should add multiple tags', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.tags.add(contact.id, { id: 'tag_vip' })
    await client.contacts.tags.add(contact.id, { id: 'tag_enterprise' })
    await client.contacts.tags.add(contact.id, { id: 'tag_beta_user' })

    const tags = await client.contacts.tags.list(contact.id)

    expect(tags.data.length).toBe(3)
  })

  it('should remove tag from contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.tags.add(contact.id, { id: 'tag_vip' })
    await client.contacts.tags.add(contact.id, { id: 'tag_enterprise' })

    const removed = await client.contacts.tags.remove(contact.id, 'tag_vip')

    expect(removed.id).toBe('tag_vip')

    const tags = await client.contacts.tags.list(contact.id)
    expect(tags.data.length).toBe(1)
    expect(tags.data[0].id).toBe('tag_enterprise')
  })

  it('should list contact tags', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.tags.add(contact.id, { id: 'tag_a' })
    await client.contacts.tags.add(contact.id, { id: 'tag_b' })

    const result = await client.contacts.tags.list(contact.id)

    expect(result.type).toBe('list')
    expect(result.data.length).toBe(2)
    expect(result.data.every((t) => t.type === 'tag')).toBe(true)
  })

  it('should include tag name in response', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement tags resource with name
    await client.tags.create({ name: 'VIP Customer' })
    await client.contacts.tags.add(contact.id, { id: 'tag_vip' })

    const tags = await client.contacts.tags.list(contact.id)

    expect(tags.data[0].name).toBe('VIP Customer')
  })

  it('should create new tag via contact if not exists', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Support creating tag by name
    const tag = await client.contacts.tags.add(contact.id, { name: 'New Tag' })

    expect(tag.id).toBeDefined()
    expect(tag.name).toBe('New Tag')
  })

  it('should be idempotent - adding same tag twice', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.tags.add(contact.id, { id: 'tag_vip' })
    await client.contacts.tags.add(contact.id, { id: 'tag_vip' })

    const tags = await client.contacts.tags.list(contact.id)

    expect(tags.data.length).toBe(1)
  })

  it('should support tag autocomplete', async () => {
    // TODO: Implement tag autocomplete
    await client.tags.create({ name: 'Premium Customer' })
    await client.tags.create({ name: 'Premium Plus' })
    await client.tags.create({ name: 'Basic Customer' })

    const suggestions = await client.tags.autocomplete('Premium')

    expect(suggestions.data.length).toBe(2)
    expect(suggestions.data.every((t) => t.name.includes('Premium'))).toBe(true)
  })

  it('should support bulk tag operations', async () => {
    const contacts: Contact[] = []
    for (let i = 0; i < 5; i++) {
      contacts.push(
        await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
        })
      )
    }

    // TODO: Implement bulk tag
    await client.contacts.tags.bulkAdd(
      contacts.map((c) => c.id),
      { id: 'tag_batch' }
    )

    for (const contact of contacts) {
      const tags = await client.contacts.tags.list(contact.id)
      expect(tags.data.some((t) => t.id === 'tag_batch')).toBe(true)
    }
  })

  it('should not throw when removing non-existent tag', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Should not throw, should be idempotent
    const result = await client.contacts.tags.remove(contact.id, 'nonexistent_tag')

    expect(result.id).toBe('nonexistent_tag')
  })
})

// =============================================================================
// 5. Company Association (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Company Association', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('attach/detach', () => {
    it('should associate contact with company', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      // TODO: Implement companies resource
      const company = await client.companies.create({
        company_id: 'acme_inc',
        name: 'Acme Inc',
      })

      const result = await client.contacts.companies.attach(contact.id, { id: company.id })

      expect(result.id).toBe(company.id)
      expect(result.name).toBe('Acme Inc')
    })

    it('should remove contact from company', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const company = await client.companies.create({
        company_id: 'acme_inc',
        name: 'Acme Inc',
      })

      await client.contacts.companies.attach(contact.id, { id: company.id })
      const result = await client.contacts.companies.detach(contact.id, company.id)

      expect(result.deleted).toBe(true)

      const companies = await client.contacts.companies.list(contact.id)
      expect(companies.data.length).toBe(0)
    })

    it("should get contact's companies", async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const company1 = await client.companies.create({
        company_id: 'company_1',
        name: 'Company One',
      })
      const company2 = await client.companies.create({
        company_id: 'company_2',
        name: 'Company Two',
      })

      await client.contacts.companies.attach(contact.id, { id: company1.id })
      await client.contacts.companies.attach(contact.id, { id: company2.id })

      const companies = await client.contacts.companies.list(contact.id)

      expect(companies.data.length).toBe(2)
    })

    it("should get company's contacts", async () => {
      const company = await client.companies.create({
        company_id: 'acme_inc',
        name: 'Acme Inc',
      })

      const contact1 = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })
      const contact2 = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      await client.contacts.companies.attach(contact1.id, { id: company.id })
      await client.contacts.companies.attach(contact2.id, { id: company.id })

      // TODO: Implement company contacts list
      const contacts = await client.companies.contacts.list(company.id)

      expect(contacts.data.length).toBe(2)
    })
  })

  describe('multiple associations', () => {
    it('should support multiple company associations per contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      for (let i = 0; i < 5; i++) {
        const company = await client.companies.create({
          company_id: `company_${i}`,
          name: `Company ${i}`,
        })
        await client.contacts.companies.attach(contact.id, { id: company.id })
      }

      const companies = await client.contacts.companies.list(contact.id)
      expect(companies.data.length).toBe(5)
    })

    it('should support multiple contact associations per company', async () => {
      const company = await client.companies.create({
        company_id: 'shared_company',
        name: 'Shared Company',
      })

      for (let i = 0; i < 10; i++) {
        const contact = await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
        })
        await client.contacts.companies.attach(contact.id, { id: company.id })
      }

      const contacts = await client.companies.contacts.list(company.id)
      expect(contacts.data.length).toBe(10)
    })
  })

  describe('role within company', () => {
    it('should set role within company', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const company = await client.companies.create({
        company_id: 'acme_inc',
        name: 'Acme Inc',
      })

      // TODO: Support role in attach params
      await client.contacts.companies.attach(contact.id, {
        id: company.id,
        role: 'CEO',
      })

      const companies = await client.contacts.companies.list(contact.id)
      expect(companies.data[0].role).toBe('CEO')
    })
  })

  describe('company creation from contact', () => {
    it('should create company when attaching by company_id', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      // Attach by company_id (should create if not exists)
      // TODO: Support creating company via attach
      await client.contacts.companies.attach(contact.id, {
        company_id: 'new_company_from_contact',
        name: 'New Company',
      })

      // Company should be created
      const company = await client.companies.findByCompanyId('new_company_from_contact')
      expect(company).toBeDefined()
      expect(company?.name).toBe('New Company')
    })
  })

  describe('primary company', () => {
    it('should designate primary company', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      const company1 = await client.companies.create({
        company_id: 'company_1',
        name: 'Company One',
      })
      const company2 = await client.companies.create({
        company_id: 'company_2',
        name: 'Company Two',
      })

      await client.contacts.companies.attach(contact.id, { id: company1.id })
      await client.contacts.companies.attach(contact.id, { id: company2.id })

      // TODO: Implement primary company
      await client.contacts.companies.setPrimary(contact.id, company2.id)

      const contactData = await client.contacts.find(contact.id)
      // Primary company should be first or have a flag
      expect(contactData.companies.data[0].id).toBe(company2.id)
    })
  })

  describe('bidirectional sync', () => {
    it('should update company user_count when contacts are added/removed', async () => {
      const company = await client.companies.create({
        company_id: 'count_test',
        name: 'Count Test',
      })

      const contact1 = await client.contacts.create({ role: 'user', email: uniqueEmail() })
      const contact2 = await client.contacts.create({ role: 'user', email: uniqueEmail() })

      await client.contacts.companies.attach(contact1.id, { id: company.id })
      await client.contacts.companies.attach(contact2.id, { id: company.id })

      let updatedCompany = await client.companies.find(company.id)
      expect(updatedCompany.user_count).toBe(2)

      await client.contacts.companies.detach(contact1.id, company.id)

      updatedCompany = await client.companies.find(company.id)
      expect(updatedCompany.user_count).toBe(1)
    })
  })
})

// =============================================================================
// 6. Custom Attributes (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Custom Attributes', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should set custom string attribute', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { plan: 'premium' },
    })

    expect(contact.custom_attributes.plan).toBe('premium')
  })

  it('should set custom number attribute', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { monthly_spend: 9999.99 },
    })

    expect(contact.custom_attributes.monthly_spend).toBe(9999.99)
  })

  it('should set custom boolean attribute', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { is_active: true, has_verified_email: false },
    })

    expect(contact.custom_attributes.is_active).toBe(true)
    expect(contact.custom_attributes.has_verified_email).toBe(false)
  })

  it('should set custom date attribute (Unix timestamp)', async () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { trial_ends_at: timestamp },
    })

    expect(contact.custom_attributes.trial_ends_at).toBe(timestamp)
  })

  it('should update custom attributes via update', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { plan: 'free' },
    })

    const updated = await client.contacts.update(contact.id, {
      custom_attributes: { plan: 'premium', upgraded_at: Math.floor(Date.now() / 1000) },
    })

    expect(updated.custom_attributes.plan).toBe('premium')
    expect(updated.custom_attributes.upgraded_at).toBeDefined()
  })

  it('should delete custom attribute by setting null', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { plan: 'premium', temp_field: 'value' },
    })

    const updated = await client.contacts.update(contact.id, {
      custom_attributes: { temp_field: null },
    })

    expect(updated.custom_attributes.plan).toBe('premium')
    expect(updated.custom_attributes.temp_field).toBeNull()
  })

  it('should preserve existing attributes when updating', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: {
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      },
    })

    const updated = await client.contacts.update(contact.id, {
      custom_attributes: { field2: 'updated' },
    })

    expect(updated.custom_attributes.field1).toBe('value1')
    expect(updated.custom_attributes.field2).toBe('updated')
    expect(updated.custom_attributes.field3).toBe('value3')
  })

  it('should handle nested attribute paths in search', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: {
        subscription_tier: 'enterprise',
        subscription_seats: 100,
      },
    })

    const result = await client.contacts.search({
      query: {
        operator: 'AND',
        value: [
          { field: 'custom_attributes.subscription_tier', operator: '=', value: 'enterprise' },
          { field: 'custom_attributes.subscription_seats', operator: '>', value: 50 },
        ],
      },
    })

    expect(result.data.some((c) => c.id === contact.id)).toBe(true)
  })

  it('should validate attribute types match schema', async () => {
    // TODO: Implement attribute schema validation
    // First, define the schema
    await client.dataAttributes.create({
      name: 'verified_score',
      data_type: 'integer',
      model: 'contact',
    })

    // Should reject non-integer value
    await expect(
      client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { verified_score: 'not_a_number' },
      })
    ).rejects.toThrow()
  })

  it('should support list/array custom attributes', async () => {
    // TODO: Implement list attribute support
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: {
        purchased_products: ['product_a', 'product_b', 'product_c'],
      },
    })

    expect(Array.isArray(contact.custom_attributes.purchased_products)).toBe(true)
    expect(contact.custom_attributes.purchased_products).toContain('product_b')
  })
})

// =============================================================================
// 7. Company CRUD (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Company CRUD', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('create', () => {
    it('should create company with name', async () => {
      // TODO: Implement companies resource
      const company = await client.companies.create({
        company_id: 'acme_inc',
        name: 'Acme Inc',
      })

      expect(company.type).toBe('company')
      expect(company.id).toBeDefined()
      expect(company.company_id).toBe('acme_inc')
      expect(company.name).toBe('Acme Inc')
    })

    it('should create company with all fields', async () => {
      const now = Math.floor(Date.now() / 1000)

      const company = await client.companies.create({
        company_id: 'full_company',
        name: 'Full Company',
        remote_created_at: now - 86400 * 365,
        plan: 'Enterprise',
        size: 500,
        website: 'https://fullcompany.com',
        industry: 'Technology',
        monthly_spend: 50000,
        custom_attributes: {
          tier: 'platinum',
          account_manager: 'admin_123',
        },
      })

      expect(company.company_id).toBe('full_company')
      expect(company.name).toBe('Full Company')
      expect(company.size).toBe(500)
      expect(company.website).toBe('https://fullcompany.com')
      expect(company.industry).toBe('Technology')
      expect(company.monthly_spend).toBe(50000)
      expect(company.custom_attributes.tier).toBe('platinum')
    })

    it('should auto-generate timestamps', async () => {
      const company = await client.companies.create({
        company_id: 'timestamp_test',
        name: 'Timestamp Test',
      })

      expect(company.created_at).toBeDefined()
      expect(company.updated_at).toBeDefined()
    })

    it('should initialize user_count to 0', async () => {
      const company = await client.companies.create({
        company_id: 'new_company',
        name: 'New Company',
      })

      expect(company.user_count).toBe(0)
    })

    it('should reject duplicate company_id', async () => {
      await client.companies.create({
        company_id: 'unique_company',
        name: 'First Company',
      })

      await expect(
        client.companies.create({
          company_id: 'unique_company',
          name: 'Duplicate Company',
        })
      ).rejects.toThrow()
    })
  })

  describe('find', () => {
    it('should get company by ID', async () => {
      const created = await client.companies.create({
        company_id: 'find_test',
        name: 'Find Test Company',
      })

      const found = await client.companies.find(created.id)

      expect(found.id).toBe(created.id)
      expect(found.name).toBe('Find Test Company')
    })

    it('should get company by company_id (external ID)', async () => {
      const created = await client.companies.create({
        company_id: 'external_id_test',
        name: 'External ID Test',
      })

      const found = await client.companies.findByCompanyId('external_id_test')

      expect(found?.id).toBe(created.id)
    })

    it('should throw error for non-existent company', async () => {
      await expect(client.companies.find('nonexistent_id')).rejects.toThrow()
    })

    it('should return null for non-existent company_id', async () => {
      const found = await client.companies.findByCompanyId('nonexistent_company_id')
      expect(found).toBeNull()
    })
  })

  describe('update', () => {
    it('should update company fields', async () => {
      const company = await client.companies.create({
        company_id: 'update_test',
        name: 'Original Name',
        size: 10,
      })

      const updated = await client.companies.update(company.id, {
        name: 'Updated Name',
        size: 50,
        website: 'https://updated.com',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.size).toBe(50)
      expect(updated.website).toBe('https://updated.com')
    })

    it('should merge custom attributes', async () => {
      const company = await client.companies.create({
        company_id: 'attr_test',
        name: 'Attr Test',
        custom_attributes: { field1: 'value1' },
      })

      const updated = await client.companies.update(company.id, {
        custom_attributes: { field2: 'value2' },
      })

      expect(updated.custom_attributes.field1).toBe('value1')
      expect(updated.custom_attributes.field2).toBe('value2')
    })
  })

  describe('delete', () => {
    it('should delete a company', async () => {
      const company = await client.companies.create({
        company_id: 'delete_test',
        name: 'Delete Test',
      })

      const result = await client.companies.delete(company.id)

      expect(result.type).toBe('company')
      expect(result.id).toBe(company.id)
      expect(result.deleted).toBe(true)
    })

    it('should remove company associations from contacts when deleted', async () => {
      const company = await client.companies.create({
        company_id: 'cascade_delete',
        name: 'Cascade Delete',
      })

      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })

      await client.contacts.companies.attach(contact.id, { id: company.id })

      await client.companies.delete(company.id)

      const contactCompanies = await client.contacts.companies.list(contact.id)
      expect(contactCompanies.data.length).toBe(0)
    })
  })

  describe('list', () => {
    it('should list companies with pagination', async () => {
      for (let i = 0; i < 15; i++) {
        await client.companies.create({
          company_id: `list_test_${i}`,
          name: `List Test Company ${i}`,
        })
      }

      const result = await client.companies.list({ per_page: 10 })

      expect(result.data.length).toBe(10)
      expect(result.total_count).toBeGreaterThanOrEqual(15)
    })

    it('should support cursor-based pagination', async () => {
      for (let i = 0; i < 15; i++) {
        await client.companies.create({
          company_id: `cursor_test_${i}`,
          name: `Cursor Test ${i}`,
        })
      }

      const firstPage = await client.companies.list({ per_page: 10 })
      const lastId = firstPage.data[firstPage.data.length - 1].id

      const secondPage = await client.companies.scroll({ scroll_param: lastId })

      expect(secondPage.data.length).toBeGreaterThan(0)
      // Should not include items from first page
      const firstPageIds = new Set(firstPage.data.map((c) => c.id))
      expect(secondPage.data.every((c) => !firstPageIds.has(c.id))).toBe(true)
    })
  })

  describe('search', () => {
    it('should search companies by name', async () => {
      const uniqueName = `SearchCompany_${Date.now()}`
      await client.companies.create({
        company_id: 'search_name_test',
        name: uniqueName,
      })

      const result = await client.companies.search({
        query: { field: 'name', operator: '=', value: uniqueName },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe(uniqueName)
    })

    it('should search companies by industry', async () => {
      const marker = `ind_${Date.now()}`
      await client.companies.create({
        company_id: `tech_${marker}`,
        name: `Tech Company ${marker}`,
        industry: 'Technology',
      })
      await client.companies.create({
        company_id: `fin_${marker}`,
        name: `Finance Company ${marker}`,
        industry: 'Finance',
      })

      const result = await client.companies.search({
        query: { field: 'industry', operator: '=', value: 'Technology' },
      })

      expect(result.data.every((c) => c.industry === 'Technology')).toBe(true)
    })

    it('should search companies by size range', async () => {
      await client.companies.create({
        company_id: 'small_co',
        name: 'Small Company',
        size: 10,
      })
      await client.companies.create({
        company_id: 'medium_co',
        name: 'Medium Company',
        size: 100,
      })
      await client.companies.create({
        company_id: 'large_co',
        name: 'Large Company',
        size: 1000,
      })

      const result = await client.companies.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'size', operator: '>', value: 50 },
            { field: 'size', operator: '<', value: 500 },
          ],
        },
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('Medium Company')
    })
  })

  describe('custom attributes', () => {
    it('should set company custom attributes', async () => {
      const company = await client.companies.create({
        company_id: 'custom_attrs',
        name: 'Custom Attrs Company',
        custom_attributes: {
          contract_value: 100000,
          renewal_date: Math.floor(Date.now() / 1000) + 86400 * 365,
          is_partner: true,
        },
      })

      expect(company.custom_attributes.contract_value).toBe(100000)
      expect(company.custom_attributes.is_partner).toBe(true)
    })
  })

  describe('segments', () => {
    it('should list company segments', async () => {
      const company = await client.companies.create({
        company_id: 'segment_test',
        name: 'Segment Test',
      })

      // TODO: Implement company segments
      const segments = await client.companies.segments.list(company.id)

      expect(segments.type).toBe('list')
      expect(Array.isArray(segments.data)).toBe(true)
    })
  })

  describe('tags', () => {
    it('should add tag to company', async () => {
      const company = await client.companies.create({
        company_id: 'tag_test',
        name: 'Tag Test Company',
      })

      // TODO: Implement company tags
      const tag = await client.companies.tags.add(company.id, { id: 'tag_enterprise' })

      expect(tag.id).toBe('tag_enterprise')
    })

    it('should list company tags', async () => {
      const company = await client.companies.create({
        company_id: 'tags_list',
        name: 'Tags List Company',
      })

      await client.companies.tags.add(company.id, { id: 'tag_a' })
      await client.companies.tags.add(company.id, { id: 'tag_b' })

      const tags = await client.companies.tags.list(company.id)

      expect(tags.data.length).toBe(2)
    })
  })
})

// =============================================================================
// 8. Lead Conversion (5 tests)
// =============================================================================

describe('@dotdo/intercom - Lead Conversion', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should convert lead to user', async () => {
    const lead = await client.contacts.create({
      role: 'lead',
      email: uniqueEmail(),
      name: 'Lead User',
    })

    expect(lead.role).toBe('lead')

    const user = await client.contacts.convertToUser(lead.id, {})

    expect(user.id).toBe(lead.id)
    expect(user.role).toBe('user')
  })

  it('should convert lead and merge with existing user', async () => {
    const existingUser = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      name: 'Existing User',
      custom_attributes: { existing_attr: 'value' },
    })

    const lead = await client.contacts.create({
      role: 'lead',
      email: uniqueEmail(),
      custom_attributes: { lead_attr: 'lead_value' },
    })

    const converted = await client.contacts.convertToUser(lead.id, {
      user: { id: existingUser.id },
    })

    expect(converted.id).toBe(existingUser.id)
    expect(converted.custom_attributes.existing_attr).toBe('value')
    expect(converted.custom_attributes.lead_attr).toBe('lead_value')

    // Lead should no longer exist
    await expect(client.contacts.find(lead.id)).rejects.toThrow()
  })

  it('should convert lead and merge by email', async () => {
    const sharedEmail = uniqueEmail()

    const existingUser = await client.contacts.create({
      role: 'user',
      email: sharedEmail,
    })

    const lead = await client.contacts.create({
      role: 'lead',
      // Lead has different email
    })

    const converted = await client.contacts.convertToUser(lead.id, {
      user: { email: sharedEmail },
    })

    expect(converted.id).toBe(existingUser.id)
  })

  it('should fail to convert user to user', async () => {
    const user = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await expect(client.contacts.convertToUser(user.id, {})).rejects.toThrow()
  })

  it('should preserve lead data during conversion', async () => {
    const lead = await client.contacts.create({
      role: 'lead',
      email: uniqueEmail(),
      name: 'Convert Test',
      phone: '+1-555-999-9999',
      custom_attributes: { source: 'widget' },
    })

    // Add tags and notes before conversion
    await client.contacts.tags.add(lead.id, { id: 'tag_potential' })
    await client.contacts.notes.create(lead.id, {
      body: 'Showed interest in premium plan',
      admin_id: 'admin_123',
    })

    const user = await client.contacts.convertToUser(lead.id, {})

    expect(user.name).toBe('Convert Test')
    expect(user.phone).toBe('+1-555-999-9999')
    expect(user.custom_attributes.source).toBe('widget')

    const tags = await client.contacts.tags.list(user.id)
    expect(tags.data.some((t) => t.id === 'tag_potential')).toBe(true)

    const notes = await client.contacts.notes.list(user.id)
    expect(notes.data.length).toBe(1)
  })
})

// =============================================================================
// 9. Contact Notes (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Contact Notes', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should create a note on a contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const note = await client.contacts.notes.create(contact.id, {
      body: 'Customer called about billing issue',
      admin_id: 'admin_123',
    })

    expect(note.type).toBe('note')
    expect(note.id).toBeDefined()
    expect(note.body).toBe('Customer called about billing issue')
    expect(note.author.id).toBe('admin_123')
    expect(note.created_at).toBeDefined()
  })

  it('should list notes on a contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.notes.create(contact.id, {
      body: 'First note',
      admin_id: 'admin_123',
    })
    await client.contacts.notes.create(contact.id, {
      body: 'Second note',
      admin_id: 'admin_456',
    })

    const notes = await client.contacts.notes.list(contact.id)

    expect(notes.type).toBe('list')
    expect(notes.data.length).toBe(2)
  })

  it('should support HTML in note body', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const htmlBody = '<p>This is a <strong>formatted</strong> note with <a href="https://example.com">link</a>.</p>'
    const note = await client.contacts.notes.create(contact.id, {
      body: htmlBody,
      admin_id: 'admin_123',
    })

    expect(note.body).toBe(htmlBody)
  })

  it('should include admin details in note response', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const note = await client.contacts.notes.create(contact.id, {
      body: 'Test note',
      admin_id: 'admin_123',
    })

    expect(note.author.type).toBe('admin')
    expect(note.author.id).toBe('admin_123')
  })

  it('should return notes sorted by creation time (descending)', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.notes.create(contact.id, {
      body: 'First note',
      admin_id: 'admin_123',
    })
    await new Promise((r) => setTimeout(r, 10))
    await client.contacts.notes.create(contact.id, {
      body: 'Second note',
      admin_id: 'admin_123',
    })
    await new Promise((r) => setTimeout(r, 10))
    await client.contacts.notes.create(contact.id, {
      body: 'Third note',
      admin_id: 'admin_123',
    })

    const notes = await client.contacts.notes.list(contact.id)

    // Most recent first
    expect(notes.data[0].body).toBe('Third note')
    expect(notes.data[2].body).toBe('First note')
  })

  it('should throw error for non-existent contact', async () => {
    await expect(
      client.contacts.notes.create('nonexistent_id', {
        body: 'Test',
        admin_id: 'admin_123',
      })
    ).rejects.toThrow()
  })

  it('should require body in note creation', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // @ts-expect-error - testing runtime validation
    await expect(
      client.contacts.notes.create(contact.id, {
        admin_id: 'admin_123',
      })
    ).rejects.toThrow()
  })

  it('should require admin_id in note creation', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // @ts-expect-error - testing runtime validation
    await expect(
      client.contacts.notes.create(contact.id, {
        body: 'Test note',
      })
    ).rejects.toThrow()
  })

  it('should reflect notes in contact object', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.notes.create(contact.id, {
      body: 'Note 1',
      admin_id: 'admin_123',
    })
    await client.contacts.notes.create(contact.id, {
      body: 'Note 2',
      admin_id: 'admin_123',
    })

    const updatedContact = await client.contacts.find(contact.id)

    expect(updatedContact.notes.data.length).toBe(2)
    expect(updatedContact.notes.data.every((n) => n.type === 'note')).toBe(true)
  })

  it('should support pagination for notes', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    for (let i = 0; i < 25; i++) {
      await client.contacts.notes.create(contact.id, {
        body: `Note ${i}`,
        admin_id: 'admin_123',
      })
    }

    // TODO: Implement pagination params in notes.list
    const notes = await client.contacts.notes.list(contact.id)

    expect(notes.data.length).toBe(25)
  })
})

// =============================================================================
// 10. Contact Segments (5 tests)
// =============================================================================

describe('@dotdo/intercom - Contact Segments', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should list segments for a contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement segments resource
    const segments = await client.contacts.segments.list(contact.id)

    expect(segments.type).toBe('list')
    expect(Array.isArray(segments.data)).toBe(true)
  })

  it('should auto-assign contact to segments based on criteria', async () => {
    // TODO: Implement segment auto-assignment
    // Create a segment that matches contacts with plan=premium
    await client.segments.create({
      name: 'Premium Users',
      person_type: 'user',
      filter: {
        field: 'custom_attributes.plan',
        operator: '=',
        value: 'premium',
      },
    })

    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { plan: 'premium' },
    })

    const segments = await client.contacts.segments.list(contact.id)

    expect(segments.data.some((s) => s.name === 'Premium Users')).toBe(true)
  })

  it('should update segment membership when contact is updated', async () => {
    await client.segments.create({
      name: 'Premium Users',
      person_type: 'user',
      filter: {
        field: 'custom_attributes.plan',
        operator: '=',
        value: 'premium',
      },
    })

    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { plan: 'free' },
    })

    // Initially not in segment
    let segments = await client.contacts.segments.list(contact.id)
    expect(segments.data.some((s) => s.name === 'Premium Users')).toBe(false)

    // Upgrade to premium
    await client.contacts.update(contact.id, {
      custom_attributes: { plan: 'premium' },
    })

    // Now in segment
    segments = await client.contacts.segments.list(contact.id)
    expect(segments.data.some((s) => s.name === 'Premium Users')).toBe(true)
  })

  it('should return segment count in response', async () => {
    await client.segments.create({
      name: 'All Users',
      person_type: 'user',
      filter: { field: 'role', operator: '=', value: 'user' },
    })

    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const segment = await client.segments.find('All Users')

    expect(segment.count).toBe(2)
  })

  it('should handle user and lead segments separately', async () => {
    await client.segments.create({
      name: 'All Leads',
      person_type: 'lead',
      filter: { field: 'role', operator: '=', value: 'lead' },
    })

    const user = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })
    const lead = await client.contacts.create({
      role: 'lead',
    })

    const userSegments = await client.contacts.segments.list(user.id)
    const leadSegments = await client.contacts.segments.list(lead.id)

    expect(userSegments.data.some((s) => s.name === 'All Leads')).toBe(false)
    expect(leadSegments.data.some((s) => s.name === 'All Leads')).toBe(true)
  })
})

// =============================================================================
// 11. Contact Subscriptions (5 tests)
// =============================================================================

describe('@dotdo/intercom - Contact Subscriptions', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should list subscription preferences for a contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement subscriptions resource
    const subscriptions = await client.contacts.subscriptions.list(contact.id)

    expect(subscriptions.type).toBe('list')
    expect(Array.isArray(subscriptions.data)).toBe(true)
  })

  it('should update subscription preference', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Create subscription type first
    await client.subscriptionTypes.create({
      name: 'Product Updates',
      consent_type: 'opt_in',
    })

    await client.contacts.subscriptions.update(contact.id, 'product_updates', {
      consent_type: 'opt_out',
    })

    const subscriptions = await client.contacts.subscriptions.list(contact.id)
    const productUpdates = subscriptions.data.find((s) => s.id === 'product_updates')

    expect(productUpdates?.consent_type).toBe('opt_out')
  })

  it('should respect unsubscribed_from_emails flag', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      unsubscribed_from_emails: true,
    })

    const subscriptions = await client.contacts.subscriptions.list(contact.id)

    // All subscriptions should show as unsubscribed
    expect(subscriptions.data.every((s) => s.status === 'unsubscribed')).toBe(true)
  })

  it('should bulk update subscriptions', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement bulk subscription update
    await client.contacts.subscriptions.bulkUpdate(contact.id, [
      { id: 'marketing', consent_type: 'opt_out' },
      { id: 'product_updates', consent_type: 'opt_in' },
    ])

    const subscriptions = await client.contacts.subscriptions.list(contact.id)

    expect(subscriptions.data.find((s) => s.id === 'marketing')?.consent_type).toBe('opt_out')
    expect(subscriptions.data.find((s) => s.id === 'product_updates')?.consent_type).toBe('opt_in')
  })

  it('should inherit default subscription preferences', async () => {
    // Create subscription type with default opt-in
    await client.subscriptionTypes.create({
      name: 'Newsletter',
      consent_type: 'opt_in',
      default: true,
    })

    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const subscriptions = await client.contacts.subscriptions.list(contact.id)
    const newsletter = subscriptions.data.find((s) => s.id === 'newsletter')

    expect(newsletter?.status).toBe('subscribed')
  })
})

// =============================================================================
// 12. Contact Location (5 tests)
// =============================================================================

describe('@dotdo/intercom - Contact Location', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should auto-detect location from IP', async () => {
    // TODO: Implement IP geolocation
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // When last_seen_at is updated with IP context
    await client.contacts.update(contact.id, {
      last_seen_at: Math.floor(Date.now() / 1000),
      // Additional context that would typically come from SDK
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.location).toBeDefined()
    expect(updated.location.type).toBe('location')
  })

  it('should return location fields', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Manually set location for testing
    // TODO: Implement location update
    await client.contacts.updateLocation(contact.id, {
      country: 'United States',
      region: 'California',
      city: 'San Francisco',
      country_code: 'US',
      continent_code: 'NA',
      timezone: 'America/Los_Angeles',
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.location.country).toBe('United States')
    expect(updated.location.region).toBe('California')
    expect(updated.location.city).toBe('San Francisco')
    expect(updated.location.country_code).toBe('US')
    expect(updated.location.timezone).toBe('America/Los_Angeles')
  })

  it('should search by location', async () => {
    const marker = `loc_${Date.now()}`

    // Create contacts in different locations
    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { marker },
    })
    await client.contacts.updateLocation('last_id', { country_code: 'US' })

    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { marker },
    })
    await client.contacts.updateLocation('last_id', { country_code: 'GB' })

    // TODO: Implement location search
    const result = await client.contacts.search({
      query: {
        operator: 'AND',
        value: [
          { field: 'custom_attributes.marker', operator: '=', value: marker },
          { field: 'location.country_code', operator: '=', value: 'US' },
        ],
      },
    })

    expect(result.data.length).toBe(1)
    expect(result.data[0].location.country_code).toBe('US')
  })

  it('should handle null location gracefully', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    expect(contact.location).toBeDefined()
    expect(contact.location.country).toBeNull()
    expect(contact.location.city).toBeNull()
  })

  it('should update location on subsequent visits', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.updateLocation(contact.id, {
      country_code: 'US',
      city: 'New York',
    })

    // Visit from different location
    await client.contacts.updateLocation(contact.id, {
      country_code: 'GB',
      city: 'London',
    })

    const updated = await client.contacts.find(contact.id)

    // Should reflect most recent location
    expect(updated.location.country_code).toBe('GB')
    expect(updated.location.city).toBe('London')
  })
})

// =============================================================================
// 13. Browser and Device Data (5 tests)
// =============================================================================

describe('@dotdo/intercom - Browser and Device Data', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should track web browser information', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement browser tracking
    await client.contacts.updateBrowserInfo(contact.id, {
      browser: 'Chrome',
      browser_version: '120.0.0',
      browser_language: 'en-US',
      os: 'macOS',
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.browser).toBe('Chrome')
    expect(updated.browser_version).toBe('120.0.0')
    expect(updated.browser_language).toBe('en-US')
    expect(updated.os).toBe('macOS')
  })

  it('should track Android device information', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement Android tracking
    await client.contacts.updateAndroidInfo(contact.id, {
      android_app_name: 'MyApp',
      android_app_version: '2.0.1',
      android_device: 'Pixel 7',
      android_os_version: '14',
      android_sdk_version: '34',
      android_last_seen_at: Math.floor(Date.now() / 1000),
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.android_app_name).toBe('MyApp')
    expect(updated.android_device).toBe('Pixel 7')
    expect(updated.android_os_version).toBe('14')
  })

  it('should track iOS device information', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement iOS tracking
    await client.contacts.updateiOSInfo(contact.id, {
      ios_app_name: 'MyApp',
      ios_app_version: '3.0.0',
      ios_device: 'iPhone 15',
      ios_os_version: '17.0',
      ios_sdk_version: '12.0',
      ios_last_seen_at: Math.floor(Date.now() / 1000),
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.ios_app_name).toBe('MyApp')
    expect(updated.ios_device).toBe('iPhone 15')
    expect(updated.ios_os_version).toBe('17.0')
  })

  it('should track multiple platforms for same contact', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Web visit
    await client.contacts.updateBrowserInfo(contact.id, {
      browser: 'Safari',
      os: 'macOS',
    })

    // iOS visit
    await client.contacts.updateiOSInfo(contact.id, {
      ios_app_name: 'MyApp',
      ios_device: 'iPhone',
    })

    const updated = await client.contacts.find(contact.id)

    // Both should be present
    expect(updated.browser).toBe('Safari')
    expect(updated.ios_app_name).toBe('MyApp')
  })

  it('should search by device/browser', async () => {
    const marker = `device_${Date.now()}`

    const c1 = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { marker },
    })
    await client.contacts.updateBrowserInfo(c1.id, { browser: 'Chrome' })

    const c2 = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      custom_attributes: { marker },
    })
    await client.contacts.updateBrowserInfo(c2.id, { browser: 'Firefox' })

    // TODO: Implement device/browser search
    const result = await client.contacts.search({
      query: {
        operator: 'AND',
        value: [
          { field: 'custom_attributes.marker', operator: '=', value: marker },
          { field: 'browser', operator: '=', value: 'Chrome' },
        ],
      },
    })

    expect(result.data.length).toBe(1)
    expect(result.data[0].browser).toBe('Chrome')
  })
})

// =============================================================================
// 14. Email Engagement Tracking (5 tests)
// =============================================================================

describe('@dotdo/intercom - Email Engagement', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should track email bounces', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Simulate hard bounce
    // TODO: Implement email bounce tracking
    await client.contacts.recordEmailBounce(contact.id, { type: 'hard' })

    const updated = await client.contacts.find(contact.id)

    expect(updated.has_hard_bounced).toBe(true)
  })

  it('should track spam reports', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // Simulate spam report
    await client.contacts.recordSpamReport(contact.id)

    const updated = await client.contacts.find(contact.id)

    expect(updated.marked_email_as_spam).toBe(true)
  })

  it('should track email opens', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const now = Math.floor(Date.now() / 1000)
    await client.contacts.recordEmailOpen(contact.id, now)

    const updated = await client.contacts.find(contact.id)

    expect(updated.last_email_opened_at).toBe(now)
  })

  it('should track email clicks', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const now = Math.floor(Date.now() / 1000)
    await client.contacts.recordEmailClick(contact.id, now)

    const updated = await client.contacts.find(contact.id)

    expect(updated.last_email_clicked_at).toBe(now)
  })

  it('should track last contacted timestamp', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    const now = Math.floor(Date.now() / 1000)
    await client.contacts.recordContact(contact.id, now)

    const updated = await client.contacts.find(contact.id)

    expect(updated.last_contacted_at).toBe(now)
    expect(updated.last_replied_at).toBeNull() // Not replied yet
  })
})

// =============================================================================
// 15. Social Profiles (5 tests)
// =============================================================================

describe('@dotdo/intercom - Social Profiles', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should store social profiles', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    // TODO: Implement social profiles
    await client.contacts.addSocialProfile(contact.id, {
      type: 'twitter',
      name: 'Twitter',
      url: 'https://twitter.com/johndoe',
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.social_profiles.data.length).toBe(1)
    expect(updated.social_profiles.data[0].type).toBe('twitter')
    expect(updated.social_profiles.data[0].url).toBe('https://twitter.com/johndoe')
  })

  it('should support multiple social profiles', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.addSocialProfile(contact.id, {
      type: 'twitter',
      name: 'Twitter',
      url: 'https://twitter.com/johndoe',
    })
    await client.contacts.addSocialProfile(contact.id, {
      type: 'linkedin',
      name: 'LinkedIn',
      url: 'https://linkedin.com/in/johndoe',
    })
    await client.contacts.addSocialProfile(contact.id, {
      type: 'facebook',
      name: 'Facebook',
      url: 'https://facebook.com/johndoe',
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.social_profiles.data.length).toBe(3)
  })

  it('should remove social profile', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.addSocialProfile(contact.id, {
      type: 'twitter',
      name: 'Twitter',
      url: 'https://twitter.com/johndoe',
    })
    await client.contacts.addSocialProfile(contact.id, {
      type: 'linkedin',
      name: 'LinkedIn',
      url: 'https://linkedin.com/in/johndoe',
    })

    await client.contacts.removeSocialProfile(contact.id, 'twitter')

    const updated = await client.contacts.find(contact.id)

    expect(updated.social_profiles.data.length).toBe(1)
    expect(updated.social_profiles.data[0].type).toBe('linkedin')
  })

  it('should update existing social profile', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    await client.contacts.addSocialProfile(contact.id, {
      type: 'twitter',
      name: 'Twitter',
      url: 'https://twitter.com/oldhandle',
    })

    // Update with new URL
    await client.contacts.addSocialProfile(contact.id, {
      type: 'twitter',
      name: 'Twitter',
      url: 'https://twitter.com/newhandle',
    })

    const updated = await client.contacts.find(contact.id)

    expect(updated.social_profiles.data.length).toBe(1)
    expect(updated.social_profiles.data[0].url).toBe('https://twitter.com/newhandle')
  })

  it('should initialize with empty social profiles', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
    })

    expect(contact.social_profiles.type).toBe('list')
    expect(contact.social_profiles.data).toEqual([])
  })
})

// =============================================================================
// 16. Data Attributes (5 tests)
// =============================================================================

describe('@dotdo/intercom - Data Attributes', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should define custom data attribute', async () => {
    // TODO: Implement data attributes
    const attr = await client.dataAttributes.create({
      name: 'monthly_revenue',
      data_type: 'float',
      model: 'contact',
      description: 'Monthly revenue from this customer',
    })

    expect(attr.id).toBeDefined()
    expect(attr.name).toBe('monthly_revenue')
    expect(attr.data_type).toBe('float')
    expect(attr.model).toBe('contact')
  })

  it('should list all data attributes', async () => {
    await client.dataAttributes.create({
      name: 'attr1',
      data_type: 'string',
      model: 'contact',
    })
    await client.dataAttributes.create({
      name: 'attr2',
      data_type: 'integer',
      model: 'contact',
    })

    const attrs = await client.dataAttributes.list({ model: 'contact' })

    expect(attrs.data.length).toBeGreaterThanOrEqual(2)
  })

  it('should update data attribute', async () => {
    const attr = await client.dataAttributes.create({
      name: 'old_name',
      data_type: 'string',
      model: 'contact',
    })

    const updated = await client.dataAttributes.update(attr.id, {
      description: 'Updated description',
    })

    expect(updated.description).toBe('Updated description')
  })

  it('should archive data attribute', async () => {
    const attr = await client.dataAttributes.create({
      name: 'to_archive',
      data_type: 'string',
      model: 'contact',
    })

    await client.dataAttributes.archive(attr.id)

    const attrs = await client.dataAttributes.list({ model: 'contact' })

    // Archived attributes should not be in active list
    expect(attrs.data.find((a) => a.id === attr.id)).toBeUndefined()
  })

  it('should support different data types', async () => {
    const types = ['string', 'integer', 'float', 'boolean', 'date'] as const

    for (const dataType of types) {
      const attr = await client.dataAttributes.create({
        name: `test_${dataType}`,
        data_type: dataType,
        model: 'contact',
      })

      expect(attr.data_type).toBe(dataType)
    }
  })
})

// =============================================================================
// 17. Contact Owner (5 tests)
// =============================================================================

describe('@dotdo/intercom - Contact Owner', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should set owner on create', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      owner_id: 'admin_123',
    })

    expect(contact.owner_id).toBe('admin_123')
  })

  it('should update owner', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      owner_id: 'admin_123',
    })

    const updated = await client.contacts.update(contact.id, {
      owner_id: 'admin_456',
    })

    expect(updated.owner_id).toBe('admin_456')
  })

  it('should remove owner by setting null', async () => {
    const contact = await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      owner_id: 'admin_123',
    })

    const updated = await client.contacts.update(contact.id, {
      owner_id: null,
    })

    expect(updated.owner_id).toBeNull()
  })

  it('should search by owner', async () => {
    const marker = `owner_${Date.now()}`

    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      owner_id: 'admin_123',
      custom_attributes: { marker },
    })
    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      owner_id: 'admin_456',
      custom_attributes: { marker },
    })
    await client.contacts.create({
      role: 'user',
      email: uniqueEmail(),
      owner_id: 'admin_123',
      custom_attributes: { marker },
    })

    const result = await client.contacts.search({
      query: {
        operator: 'AND',
        value: [
          { field: 'custom_attributes.marker', operator: '=', value: marker },
          { field: 'owner_id', operator: '=', value: 'admin_123' },
        ],
      },
    })

    expect(result.data.length).toBe(2)
    expect(result.data.every((c) => c.owner_id === 'admin_123')).toBe(true)
  })

  it('should transfer ownership in bulk', async () => {
    const contacts: Contact[] = []
    for (let i = 0; i < 5; i++) {
      contacts.push(
        await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          owner_id: 'admin_old',
        })
      )
    }

    // TODO: Implement bulk transfer
    await client.contacts.bulkTransferOwner({
      from: 'admin_old',
      to: 'admin_new',
    })

    for (const contact of contacts) {
      const updated = await client.contacts.find(contact.id)
      expect(updated.owner_id).toBe('admin_new')
    }
  })
})

// =============================================================================
// 18. Edge Cases and Validation (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Edge Cases and Validation', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('email validation', () => {
    it('should accept valid email formats', async () => {
      const validEmails = [
        'simple@example.com',
        'user.name@example.com',
        'user+tag@example.com',
        'user@subdomain.example.com',
        'user@example.co.uk',
      ]

      for (const email of validEmails) {
        const contact = await client.contacts.create({ role: 'user', email })
        expect(contact.email).toBe(email)
      }
    })

    it('should reject invalid email formats', async () => {
      const invalidEmails = [
        'not-an-email',
        '@missinglocal.com',
        'missing@.com',
        'spaces in@email.com',
        'double@@at.com',
      ]

      for (const email of invalidEmails) {
        // TODO: Implement email validation
        await expect(
          client.contacts.create({ role: 'user', email })
        ).rejects.toThrow()
      }
    })
  })

  describe('phone validation', () => {
    it('should accept various phone formats', async () => {
      const validPhones = [
        '+1-555-123-4567',
        '+44 20 7946 0958',
        '+61 2 1234 5678',
        '15551234567',
      ]

      for (const phone of validPhones) {
        const contact = await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          phone,
        })
        expect(contact.phone).toBe(phone)
      }
    })
  })

  describe('special characters', () => {
    it('should handle Unicode in name', async () => {
      const names = [
        '山田太郎', // Japanese
        'Müller', // German
        'François', // French
        'Алексей', // Russian
        'عمر', // Arabic
        'Developer', // Emoji removed for safety
      ]

      for (const name of names) {
        const contact = await client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          name,
        })
        expect(contact.name).toBe(name)
      }
    })

    it('should handle special characters in custom attributes', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: {
          description: 'Contains "quotes" and \'apostrophes\'',
          json_like: '{"key": "value"}',
          newlines: 'line1\nline2',
        },
      })

      expect(contact.custom_attributes.description).toBe('Contains "quotes" and \'apostrophes\'')
      expect(contact.custom_attributes.json_like).toBe('{"key": "value"}')
    })
  })

  describe('timestamp handling', () => {
    it('should handle Unix timestamps correctly', async () => {
      const now = Math.floor(Date.now() / 1000)
      const pastTimestamp = now - 86400 * 365 // 1 year ago

      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        signed_up_at: pastTimestamp,
      })

      expect(contact.signed_up_at).toBe(pastTimestamp)
      expect(contact.created_at).toBeGreaterThanOrEqual(now - 5)
    })

    it('should handle milliseconds if provided (convert to seconds)', async () => {
      const nowMs = Date.now()
      const nowSeconds = Math.floor(nowMs / 1000)

      // TODO: Implement automatic milliseconds conversion
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        signed_up_at: nowMs, // Milliseconds
      })

      // Should be converted to seconds
      expect(contact.signed_up_at).toBe(nowSeconds)
    })

    it('should reject future timestamps for signed_up_at', async () => {
      const future = Math.floor(Date.now() / 1000) + 86400 * 365 // 1 year in future

      // TODO: Implement timestamp validation
      await expect(
        client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          signed_up_at: future,
        })
      ).rejects.toThrow()
    })
  })

  describe('large data handling', () => {
    it('should handle large custom attributes object', async () => {
      const largeAttributes: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        largeAttributes[`attr_${i}`] = `value_${i}_${'x'.repeat(100)}`
      }

      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: largeAttributes,
      })

      expect(Object.keys(contact.custom_attributes).length).toBe(100)
    })

    it('should handle very long name', async () => {
      const longName = 'A'.repeat(255)

      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: longName,
      })

      expect(contact.name?.length).toBe(255)
    })

    it('should reject name exceeding max length', async () => {
      const tooLongName = 'A'.repeat(256)

      // TODO: Implement length validation
      await expect(
        client.contacts.create({
          role: 'user',
          email: uniqueEmail(),
          name: tooLongName,
        })
      ).rejects.toThrow()
    })
  })

  describe('null and undefined handling', () => {
    it('should handle null values in update', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: 'Original Name',
        phone: '+1-555-123-4567',
      })

      const updated = await client.contacts.update(contact.id, {
        name: null as any, // Clear name
        phone: null as any, // Clear phone
      })

      expect(updated.name).toBeNull()
      expect(updated.phone).toBeNull()
    })

    it('should not change fields when undefined in update', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: 'Original Name',
        phone: '+1-555-123-4567',
      })

      const updated = await client.contacts.update(contact.id, {
        name: 'New Name',
        // phone is undefined, should remain unchanged
      })

      expect(updated.name).toBe('New Name')
      expect(updated.phone).toBe('+1-555-123-4567')
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent creates', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        client.contacts.create({
          role: 'user',
          email: `concurrent_${Date.now()}_${i}@example.com`,
        })
      )

      const contacts = await Promise.all(promises)

      expect(contacts.length).toBe(10)
      const ids = new Set(contacts.map((c) => c.id))
      expect(ids.size).toBe(10) // All IDs should be unique
    })

    it('should handle concurrent updates to same contact', async () => {
      const contact = await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        custom_attributes: { counter: 0 },
      })

      // Concurrent updates (last write wins)
      const promises = Array.from({ length: 5 }, (_, i) =>
        client.contacts.update(contact.id, {
          custom_attributes: { counter: i + 1 },
        })
      )

      await Promise.all(promises)

      const final = await client.contacts.find(contact.id)
      expect(typeof final.custom_attributes.counter).toBe('number')
    })
  })
})

// =============================================================================
// 19. Contact Scroll API (5 tests)
// =============================================================================

describe('@dotdo/intercom - Contact Scroll API', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should scroll through all contacts', async () => {
    // Create contacts
    for (let i = 0; i < 25; i++) {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })
    }

    // TODO: Implement scroll API
    const allContacts: Contact[] = []
    let scrollParam: string | undefined

    do {
      const result = await client.contacts.scroll({ scroll_param: scrollParam })
      allContacts.push(...result.data)
      scrollParam = result.scroll_param
    } while (scrollParam)

    expect(allContacts.length).toBe(25)
  })

  it('should return scroll_param for continuation', async () => {
    for (let i = 0; i < 15; i++) {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })
    }

    const result = await client.contacts.scroll({})

    expect(result.scroll_param).toBeDefined()
  })

  it('should return null scroll_param when done', async () => {
    for (let i = 0; i < 3; i++) {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })
    }

    // Scroll to get all contacts
    let result = await client.contacts.scroll({})
    while (result.scroll_param) {
      result = await client.contacts.scroll({ scroll_param: result.scroll_param })
    }

    expect(result.scroll_param).toBeUndefined()
  })

  it('should respect scroll timeout', async () => {
    for (let i = 0; i < 5; i++) {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
      })
    }

    const result = await client.contacts.scroll({})
    const scrollParam = result.scroll_param

    // Wait for scroll to expire (in real API this is 1 minute)
    // For local implementation, we might have a shorter timeout for testing
    // await new Promise((r) => setTimeout(r, 2000))

    // TODO: Implement scroll expiration
    // await expect(
    //   client.contacts.scroll({ scroll_param: scrollParam })
    // ).rejects.toThrow()
  })

  it('should not include deleted contacts in scroll', async () => {
    const c1 = await client.contacts.create({ role: 'user', email: uniqueEmail() })
    const c2 = await client.contacts.create({ role: 'user', email: uniqueEmail() })
    const c3 = await client.contacts.create({ role: 'user', email: uniqueEmail() })

    await client.contacts.delete(c2.id)

    const result = await client.contacts.scroll({})
    const ids = result.data.map((c) => c.id)

    expect(ids).toContain(c1.id)
    expect(ids).not.toContain(c2.id)
    expect(ids).toContain(c3.id)
  })
})

// =============================================================================
// 20. Contact Export (5 tests)
// =============================================================================

describe('@dotdo/intercom - Contact Export', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  it('should create export job', async () => {
    // TODO: Implement contact export
    const job = await client.contacts.export.create({
      created_at_after: Math.floor(Date.now() / 1000) - 86400 * 30,
    })

    expect(job.type).toBe('contact_export')
    expect(job.id).toBeDefined()
    expect(job.status).toBe('pending')
  })

  it('should get export job status', async () => {
    const job = await client.contacts.export.create({})
    const status = await client.contacts.export.find(job.id)

    expect(['pending', 'in_progress', 'completed'].includes(status.status)).toBe(true)
  })

  it('should download completed export', async () => {
    // Create some contacts first
    for (let i = 0; i < 5; i++) {
      await client.contacts.create({
        role: 'user',
        email: uniqueEmail(),
        name: `Export Test ${i}`,
      })
    }

    const job = await client.contacts.export.create({})

    // Wait for completion (in real API this is async)
    let status = await client.contacts.export.find(job.id)
    while (status.status !== 'completed') {
      await new Promise((r) => setTimeout(r, 100))
      status = await client.contacts.export.find(job.id)
    }

    expect(status.download_url).toBeDefined()
  })

  it('should filter export by date range', async () => {
    const now = Math.floor(Date.now() / 1000)
    const dayAgo = now - 86400

    const job = await client.contacts.export.create({
      created_at_after: dayAgo,
      created_at_before: now,
    })

    expect(job.created_at_after).toBe(dayAgo)
    expect(job.created_at_before).toBe(now)
  })

  it('should cancel export job', async () => {
    const job = await client.contacts.export.create({})
    await client.contacts.export.cancel(job.id)

    const status = await client.contacts.export.find(job.id)
    expect(status.status).toBe('cancelled')
  })
})
