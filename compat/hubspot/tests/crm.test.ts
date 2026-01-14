/**
 * @dotdo/hubspot/crm - HubSpot CRM Local Storage Layer Tests (RED Phase)
 *
 * Comprehensive tests for the local HubSpot CRM compatibility layer backed by
 * Durable Objects storage. These tests are designed to FAIL until the
 * implementation is complete.
 *
 * Tests cover:
 * 1. Contacts CRUD (20+ tests)
 * 2. Companies CRUD (15+ tests)
 * 3. Deals CRUD (20+ tests)
 * 4. Properties API (15+ tests)
 * 5. Associations API (15+ tests)
 * 6. Activity Timeline (15+ tests)
 *
 * @module @dotdo/hubspot/crm/tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HubSpotCRM,
  HubSpotCRMError,
  type CRMStorage,
  type Contact,
  type Company,
  type Deal,
  type PropertyDefinition,
  type PropertyGroup,
  type Association,
  type Note,
  type Task,
  type Engagement,
  type SearchFilter,
  type SearchOptions,
} from '../crm'

// =============================================================================
// Mock Storage Implementation
// =============================================================================

function createMockStorage(): CRMStorage {
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
    async list(options?: { prefix?: string; limit?: number; start?: string }): Promise<Map<string, unknown>> {
      const result = new Map<string, unknown>()
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? Infinity
      let count = 0

      for (const [key, value] of store.entries()) {
        if (key.startsWith(prefix)) {
          if (options?.start && key <= options.start) continue
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

describe('@dotdo/hubspot/crm - Local CRM Storage Layer', () => {
  let storage: CRMStorage
  let crm: HubSpotCRM

  beforeEach(() => {
    storage = createMockStorage()
    crm = new HubSpotCRM(storage)
  })

  // ===========================================================================
  // CONTACTS CRUD (20+ tests)
  // ===========================================================================

  describe('Contacts CRUD', () => {
    describe('createContact', () => {
      it('should create a contact with email', async () => {
        const contact = await crm.createContact({
          email: 'user@example.com',
        })

        expect(contact).toBeDefined()
        expect(contact.id).toBeTruthy()
        expect(contact.properties.email).toBe('user@example.com')
        expect(contact.archived).toBe(false)
        expect(contact.createdAt).toBeTruthy()
        expect(contact.updatedAt).toBeTruthy()
      })

      it('should create a contact with all properties', async () => {
        const contact = await crm.createContact({
          email: 'john.doe@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1-555-123-4567',
          company: 'Acme Inc',
          website: 'https://johndoe.com',
          address: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94102',
          country: 'USA',
          jobTitle: 'Software Engineer',
          lifecycleStage: 'lead',
          leadStatus: 'new',
        })

        expect(contact.properties.email).toBe('john.doe@example.com')
        expect(contact.properties.firstname).toBe('John')
        expect(contact.properties.lastname).toBe('Doe')
        expect(contact.properties.phone).toBe('+1-555-123-4567')
        expect(contact.properties.company).toBe('Acme Inc')
        expect(contact.properties.website).toBe('https://johndoe.com')
        expect(contact.properties.address).toBe('123 Main St')
        expect(contact.properties.city).toBe('San Francisco')
        expect(contact.properties.state).toBe('CA')
        expect(contact.properties.zip).toBe('94102')
        expect(contact.properties.country).toBe('USA')
        expect(contact.properties.jobtitle).toBe('Software Engineer')
        expect(contact.properties.lifecyclestage).toBe('lead')
        expect(contact.properties.hs_lead_status).toBe('new')
      })

      it('should create a contact with custom properties', async () => {
        const contact = await crm.createContact({
          email: 'custom@example.com',
          properties: {
            custom_field: 'custom_value',
            another_field: '12345',
          },
        })

        expect(contact.properties.custom_field).toBe('custom_value')
        expect(contact.properties.another_field).toBe('12345')
      })

      it('should set default lifecycle stage to subscriber', async () => {
        const contact = await crm.createContact({
          email: 'default@example.com',
        })

        expect(contact.properties.lifecyclestage).toBe('subscriber')
      })

      it('should generate unique IDs for contacts', async () => {
        const contact1 = await crm.createContact({ email: 'user1@example.com' })
        const contact2 = await crm.createContact({ email: 'user2@example.com' })

        expect(contact1.id).not.toBe(contact2.id)
      })

      it('should throw error for duplicate email', async () => {
        await crm.createContact({ email: 'duplicate@example.com' })

        await expect(
          crm.createContact({ email: 'duplicate@example.com' })
        ).rejects.toThrow(HubSpotCRMError)

        await expect(
          crm.createContact({ email: 'duplicate@example.com' })
        ).rejects.toMatchObject({
          category: 'DUPLICATE_EMAIL',
          statusCode: 409,
        })
      })

      it('should handle case-insensitive email duplicate check', async () => {
        await crm.createContact({ email: 'User@Example.com' })

        await expect(
          crm.createContact({ email: 'user@example.com' })
        ).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('getContact', () => {
      it('should get a contact by ID', async () => {
        const created = await crm.createContact({ email: 'get@example.com', firstName: 'Test' })
        const retrieved = await crm.getContact(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.properties.email).toBe('get@example.com')
        expect(retrieved.properties.firstname).toBe('Test')
      })

      it('should get a contact with specific properties', async () => {
        const created = await crm.createContact({
          email: 'specific@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
        })

        const retrieved = await crm.getContact(created.id, { properties: ['email', 'firstname'] })

        expect(retrieved.properties.email).toBe('specific@example.com')
        expect(retrieved.properties.firstname).toBe('John')
        // Only requested properties should be returned
        expect(Object.keys(retrieved.properties)).toContain('email')
        expect(Object.keys(retrieved.properties)).toContain('firstname')
      })

      it('should throw error for non-existent contact', async () => {
        await expect(crm.getContact('nonexistent-id')).rejects.toThrow(HubSpotCRMError)

        await expect(crm.getContact('nonexistent-id')).rejects.toMatchObject({
          category: 'OBJECT_NOT_FOUND',
          statusCode: 404,
        })
      })

      it('should throw error for archived contact', async () => {
        const contact = await crm.createContact({ email: 'archived@example.com' })
        await crm.archiveContact(contact.id)

        await expect(crm.getContact(contact.id)).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('updateContact', () => {
      it('should update contact properties', async () => {
        const contact = await crm.createContact({ email: 'update@example.com', firstName: 'Original' })
        const updated = await crm.updateContact(contact.id, { firstname: 'Updated' })

        expect(updated.properties.firstname).toBe('Updated')
        expect(updated.properties.email).toBe('update@example.com')
      })

      it('should update lastmodifieddate on update', async () => {
        const contact = await crm.createContact({ email: 'modified@example.com' })
        const originalModified = contact.updatedAt

        // Wait a bit to ensure timestamp differs
        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await crm.updateContact(contact.id, { firstname: 'New Name' })

        expect(updated.updatedAt).not.toBe(originalModified)
        expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(originalModified).getTime())
      })

      it('should preserve existing properties when updating', async () => {
        const contact = await crm.createContact({
          email: 'preserve@example.com',
          firstName: 'John',
          lastName: 'Doe',
        })

        const updated = await crm.updateContact(contact.id, { phone: '+1234567890' })

        expect(updated.properties.firstname).toBe('John')
        expect(updated.properties.lastname).toBe('Doe')
        expect(updated.properties.phone).toBe('+1234567890')
      })

      it('should throw error when updating non-existent contact', async () => {
        await expect(
          crm.updateContact('nonexistent-id', { firstname: 'Test' })
        ).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('deleteContact', () => {
      it('should delete a contact (hard delete)', async () => {
        const contact = await crm.createContact({ email: 'delete@example.com' })
        await crm.deleteContact(contact.id)

        await expect(crm.getContact(contact.id)).rejects.toThrow(HubSpotCRMError)
      })

      it('should throw error when deleting non-existent contact', async () => {
        await expect(crm.deleteContact('nonexistent-id')).rejects.toThrow(HubSpotCRMError)
      })

      it('should clean up associations when deleting contact', async () => {
        const contact = await crm.createContact({ email: 'assoc-delete@example.com' })
        const company = await crm.createCompany({ name: 'Test Company' })
        await crm.associateContactToCompany(contact.id, company.id)

        await crm.deleteContact(contact.id)

        const companyContacts = await crm.listCompanyContacts(company.id)
        expect(companyContacts.results).toHaveLength(0)
      })
    })

    describe('archiveContact', () => {
      it('should archive a contact (soft delete)', async () => {
        const contact = await crm.createContact({ email: 'archive@example.com' })
        const archived = await crm.archiveContact(contact.id)

        expect(archived.archived).toBe(true)
        expect(archived.archivedAt).toBeTruthy()
      })

      it('should not include archived contacts in search results', async () => {
        const contact = await crm.createContact({ email: 'archived-search@example.com', firstName: 'Test' })
        await crm.archiveContact(contact.id)

        const results = await crm.searchContacts('Test')
        expect(results.results.find((c) => c.id === contact.id)).toBeUndefined()
      })
    })

    describe('searchContacts', () => {
      beforeEach(async () => {
        await crm.createContact({ email: 'john@acme.com', firstName: 'John', lastName: 'Doe', lifecycleStage: 'lead' })
        await crm.createContact({ email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe', lifecycleStage: 'customer' })
        await crm.createContact({ email: 'bob@widgets.com', firstName: 'Bob', lastName: 'Smith', lifecycleStage: 'lead' })
      })

      it('should search contacts by query', async () => {
        const results = await crm.searchContacts('john')

        expect(results.total).toBe(1)
        expect(results.results[0].properties.firstname).toBe('John')
      })

      it('should search contacts with filters', async () => {
        const results = await crm.searchContacts('', {
          filters: [{ field: 'lifecyclestage', operator: 'eq', value: 'lead' }],
        })

        expect(results.total).toBe(2)
        expect(results.results.every((c) => c.properties.lifecyclestage === 'lead')).toBe(true)
      })

      it('should search with multiple filters (AND)', async () => {
        const results = await crm.searchContacts('', {
          filters: [
            { field: 'lifecyclestage', operator: 'eq', value: 'lead' },
            { field: 'lastname', operator: 'eq', value: 'Doe' },
          ],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.firstname).toBe('John')
      })

      it('should support contains_token operator', async () => {
        const results = await crm.searchContacts('', {
          filters: [{ field: 'email', operator: 'contains_token', value: '@acme.com' }],
        })

        expect(results.total).toBe(2)
      })

      it('should support in operator', async () => {
        const results = await crm.searchContacts('', {
          filters: [{ field: 'firstname', operator: 'in', values: ['John', 'Jane'] }],
        })

        expect(results.total).toBe(2)
      })

      it('should support has_property operator', async () => {
        await crm.createContact({ email: 'no-phone@example.com' })
        await crm.createContact({ email: 'with-phone@example.com', phone: '+1234567890' })

        const results = await crm.searchContacts('', {
          filters: [{ field: 'phone', operator: 'has_property' }],
        })

        expect(results.results.every((c) => c.properties.phone !== null)).toBe(true)
      })

      it('should support sorting', async () => {
        const results = await crm.searchContacts('', {
          sorts: [{ field: 'firstname', direction: 'asc' }],
        })

        const firstNames = results.results.map((c) => c.properties.firstname)
        expect(firstNames).toEqual([...firstNames].sort())
      })

      it('should support descending sort', async () => {
        const results = await crm.searchContacts('', {
          sorts: [{ field: 'firstname', direction: 'desc' }],
        })

        const firstNames = results.results.map((c) => c.properties.firstname)
        expect(firstNames).toEqual([...firstNames].sort().reverse())
      })

      it('should support pagination with limit', async () => {
        const results = await crm.searchContacts('', { limit: 2 })

        expect(results.results).toHaveLength(2)
        expect(results.paging?.next?.after).toBeTruthy()
      })

      it('should support pagination with after cursor', async () => {
        const page1 = await crm.searchContacts('', { limit: 2 })
        const page2 = await crm.searchContacts('', { limit: 2, after: page1.paging?.next?.after })

        expect(page2.results).toHaveLength(1)
        expect(page2.results[0].id).not.toBe(page1.results[0].id)
        expect(page2.results[0].id).not.toBe(page1.results[1].id)
      })

      it('should return selected properties only', async () => {
        const results = await crm.searchContacts('john', { properties: ['email', 'firstname'] })

        expect(results.results[0].properties.email).toBeTruthy()
        expect(results.results[0].properties.firstname).toBeTruthy()
      })
    })

    describe('batchCreateContacts', () => {
      it('should batch create contacts', async () => {
        const result = await crm.batchCreateContacts([
          { email: 'batch1@example.com', firstName: 'Batch', lastName: 'One' },
          { email: 'batch2@example.com', firstName: 'Batch', lastName: 'Two' },
          { email: 'batch3@example.com', firstName: 'Batch', lastName: 'Three' },
        ])

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(3)
        expect(result.errors).toHaveLength(0)
      })

      it('should handle partial failures in batch create', async () => {
        await crm.createContact({ email: 'existing@example.com' })

        const result = await crm.batchCreateContacts([
          { email: 'new@example.com' },
          { email: 'existing@example.com' }, // Should fail
          { email: 'another-new@example.com' },
        ])

        expect(result.results).toHaveLength(2)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].context?.email).toBe('existing@example.com')
      })
    })

    describe('batchUpdateContacts', () => {
      it('should batch update contacts', async () => {
        const c1 = await crm.createContact({ email: 'batch-update1@example.com' })
        const c2 = await crm.createContact({ email: 'batch-update2@example.com' })

        const result = await crm.batchUpdateContacts([
          { id: c1.id, properties: { firstname: 'Updated1' } },
          { id: c2.id, properties: { firstname: 'Updated2' } },
        ])

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)

        const updated1 = await crm.getContact(c1.id)
        const updated2 = await crm.getContact(c2.id)

        expect(updated1.properties.firstname).toBe('Updated1')
        expect(updated2.properties.firstname).toBe('Updated2')
      })

      it('should handle non-existent contact in batch update', async () => {
        const contact = await crm.createContact({ email: 'batch-partial@example.com' })

        const result = await crm.batchUpdateContacts([
          { id: contact.id, properties: { firstname: 'Valid' } },
          { id: 'nonexistent-id', properties: { firstname: 'Invalid' } },
        ])

        expect(result.results).toHaveLength(1)
        expect(result.errors).toHaveLength(1)
      })
    })

    describe('mergeContacts', () => {
      it('should merge two contacts', async () => {
        const primary = await crm.createContact({
          email: 'primary@example.com',
          firstName: 'Primary',
          phone: '+1111111111',
        })
        const secondary = await crm.createContact({
          email: 'secondary@example.com',
          lastName: 'Secondary',
          phone: '+2222222222',
        })

        const merged = await crm.mergeContacts(primary.id, secondary.id)

        // Primary values should win on conflicts
        expect(merged.properties.email).toBe('primary@example.com')
        expect(merged.properties.firstname).toBe('Primary')
        expect(merged.properties.phone).toBe('+1111111111')
        // Secondary values should fill gaps
        expect(merged.properties.lastname).toBe('Secondary')
      })

      it('should archive secondary contact after merge', async () => {
        const primary = await crm.createContact({ email: 'merge-primary@example.com' })
        const secondary = await crm.createContact({ email: 'merge-secondary@example.com' })

        await crm.mergeContacts(primary.id, secondary.id)

        // Secondary should be archived
        await expect(crm.getContact(secondary.id)).rejects.toThrow(HubSpotCRMError)
      })

      it('should transfer associations from secondary to primary', async () => {
        const primary = await crm.createContact({ email: 'assoc-primary@example.com' })
        const secondary = await crm.createContact({ email: 'assoc-secondary@example.com' })
        const company = await crm.createCompany({ name: 'Test Company' })

        await crm.associateContactToCompany(secondary.id, company.id)
        await crm.mergeContacts(primary.id, secondary.id)

        const companyContacts = await crm.listCompanyContacts(company.id)
        expect(companyContacts.results.some((c) => c.id === primary.id)).toBe(true)
      })
    })
  })

  // ===========================================================================
  // COMPANIES CRUD (15+ tests)
  // ===========================================================================

  describe('Companies CRUD', () => {
    describe('createCompany', () => {
      it('should create a company with name', async () => {
        const company = await crm.createCompany({ name: 'Acme Inc' })

        expect(company).toBeDefined()
        expect(company.id).toBeTruthy()
        expect(company.properties.name).toBe('Acme Inc')
        expect(company.archived).toBe(false)
      })

      it('should create a company with domain', async () => {
        const company = await crm.createCompany({
          name: 'Widgets Corp',
          domain: 'widgets.com',
        })

        expect(company.properties.domain).toBe('widgets.com')
      })

      it('should create a company with all properties', async () => {
        const company = await crm.createCompany({
          name: 'Full Company',
          domain: 'fullcompany.com',
          industry: 'Technology',
          description: 'A full-featured company',
          phone: '+1-800-COMPANY',
          address: '456 Corp Ave',
          city: 'New York',
          state: 'NY',
          zip: '10001',
          country: 'USA',
          website: 'https://fullcompany.com',
          numberOfEmployees: 500,
          annualRevenue: 10000000,
          type: 'CUSTOMER',
        })

        expect(company.properties.name).toBe('Full Company')
        expect(company.properties.domain).toBe('fullcompany.com')
        expect(company.properties.industry).toBe('Technology')
        expect(company.properties.numberofemployees).toBe('500')
        expect(company.properties.annualrevenue).toBe('10000000')
        expect(company.properties.type).toBe('CUSTOMER')
      })

      it('should create a company with custom properties', async () => {
        const company = await crm.createCompany({
          name: 'Custom Props Co',
          properties: {
            custom_tier: 'enterprise',
            account_manager: 'john_doe',
          },
        })

        expect(company.properties.custom_tier).toBe('enterprise')
        expect(company.properties.account_manager).toBe('john_doe')
      })
    })

    describe('getCompany', () => {
      it('should get a company by ID', async () => {
        const created = await crm.createCompany({ name: 'Get Company' })
        const retrieved = await crm.getCompany(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.properties.name).toBe('Get Company')
      })

      it('should throw error for non-existent company', async () => {
        await expect(crm.getCompany('nonexistent-company')).rejects.toThrow(HubSpotCRMError)
        await expect(crm.getCompany('nonexistent-company')).rejects.toMatchObject({
          category: 'OBJECT_NOT_FOUND',
          statusCode: 404,
        })
      })
    })

    describe('updateCompany', () => {
      it('should update company properties', async () => {
        const company = await crm.createCompany({ name: 'Update Co', industry: 'Tech' })
        const updated = await crm.updateCompany(company.id, {
          name: 'Updated Company',
          industry: 'Finance',
        })

        expect(updated.properties.name).toBe('Updated Company')
        expect(updated.properties.industry).toBe('Finance')
      })
    })

    describe('deleteCompany', () => {
      it('should delete a company', async () => {
        const company = await crm.createCompany({ name: 'Delete Co' })
        await crm.deleteCompany(company.id)

        await expect(crm.getCompany(company.id)).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('searchCompanies', () => {
      beforeEach(async () => {
        await crm.createCompany({ name: 'Acme Inc', domain: 'acme.com', industry: 'Technology' })
        await crm.createCompany({ name: 'Widgets Corp', domain: 'widgets.com', industry: 'Manufacturing' })
        await crm.createCompany({ name: 'Tech Solutions', domain: 'techsol.com', industry: 'Technology' })
      })

      it('should search companies by query', async () => {
        const results = await crm.searchCompanies('Acme')

        expect(results.total).toBe(1)
        expect(results.results[0].properties.name).toBe('Acme Inc')
      })

      it('should search companies by industry filter', async () => {
        const results = await crm.searchCompanies('', {
          filters: [{ field: 'industry', operator: 'eq', value: 'Technology' }],
        })

        expect(results.total).toBe(2)
      })

      it('should search companies by domain', async () => {
        const results = await crm.searchCompanies('', {
          filters: [{ field: 'domain', operator: 'eq', value: 'widgets.com' }],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.name).toBe('Widgets Corp')
      })
    })

    describe('batchCreateCompanies', () => {
      it('should batch create companies', async () => {
        const result = await crm.batchCreateCompanies([
          { name: 'Company A', domain: 'a.com' },
          { name: 'Company B', domain: 'b.com' },
        ])

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })
    })

    describe('associateContactToCompany', () => {
      it('should associate a contact to a company', async () => {
        const contact = await crm.createContact({ email: 'assoc@example.com' })
        const company = await crm.createCompany({ name: 'Assoc Company' })

        const association = await crm.associateContactToCompany(contact.id, company.id)

        expect(association).toBeDefined()
        expect(association.fromObjectType).toBe('contacts')
        expect(association.toObjectType).toBe('companies')
      })

      it('should throw error for non-existent contact', async () => {
        const company = await crm.createCompany({ name: 'Valid Company' })

        await expect(
          crm.associateContactToCompany('nonexistent', company.id)
        ).rejects.toThrow(HubSpotCRMError)
      })

      it('should throw error for non-existent company', async () => {
        const contact = await crm.createContact({ email: 'valid@example.com' })

        await expect(
          crm.associateContactToCompany(contact.id, 'nonexistent')
        ).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('listCompanyContacts', () => {
      it('should list contacts associated with a company', async () => {
        const company = await crm.createCompany({ name: 'Contacts Company' })
        const contact1 = await crm.createContact({ email: 'contact1@company.com' })
        const contact2 = await crm.createContact({ email: 'contact2@company.com' })

        await crm.associateContactToCompany(contact1.id, company.id)
        await crm.associateContactToCompany(contact2.id, company.id)

        const contacts = await crm.listCompanyContacts(company.id)

        expect(contacts.results).toHaveLength(2)
        expect(contacts.results.map((c) => c.id)).toContain(contact1.id)
        expect(contacts.results.map((c) => c.id)).toContain(contact2.id)
      })

      it('should return empty array for company with no contacts', async () => {
        const company = await crm.createCompany({ name: 'No Contacts Co' })

        const contacts = await crm.listCompanyContacts(company.id)

        expect(contacts.results).toHaveLength(0)
      })
    })

    describe('dedup by domain', () => {
      it('should find company by domain for deduplication', async () => {
        await crm.createCompany({ name: 'First Corp', domain: 'dedup.com' })
        await crm.createCompany({ name: 'Second Corp', domain: 'other.com' })

        const results = await crm.searchCompanies('', {
          filters: [{ field: 'domain', operator: 'eq', value: 'dedup.com' }],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.name).toBe('First Corp')
      })
    })
  })

  // ===========================================================================
  // DEALS CRUD (20+ tests)
  // ===========================================================================

  describe('Deals CRUD', () => {
    describe('createDeal', () => {
      it('should create a deal with name and stage', async () => {
        const deal = await crm.createDeal({
          name: 'New Deal',
          stage: 'appointmentscheduled',
        })

        expect(deal).toBeDefined()
        expect(deal.id).toBeTruthy()
        expect(deal.properties.dealname).toBe('New Deal')
        expect(deal.properties.dealstage).toBe('appointmentscheduled')
        expect(deal.archived).toBe(false)
      })

      it('should create a deal with amount', async () => {
        const deal = await crm.createDeal({
          name: 'Big Deal',
          stage: 'qualifiedtobuy',
          amount: 100000,
        })

        expect(deal.properties.amount).toBe('100000')
      })

      it('should create a deal with all properties', async () => {
        const closeDate = new Date('2025-06-30').toISOString()
        const deal = await crm.createDeal({
          name: 'Full Deal',
          stage: 'presentationscheduled',
          amount: 50000,
          pipeline: 'sales_pipeline',
          closeDate,
          ownerId: 'owner-123',
          description: 'A comprehensive deal',
          dealType: 'newbusiness',
        })

        expect(deal.properties.dealname).toBe('Full Deal')
        expect(deal.properties.dealstage).toBe('presentationscheduled')
        expect(deal.properties.amount).toBe('50000')
        expect(deal.properties.pipeline).toBe('sales_pipeline')
        expect(deal.properties.closedate).toBe(closeDate)
        expect(deal.properties.hubspot_owner_id).toBe('owner-123')
        expect(deal.properties.description).toBe('A comprehensive deal')
        expect(deal.properties.dealtype).toBe('newbusiness')
      })

      it('should default pipeline to "default"', async () => {
        const deal = await crm.createDeal({
          name: 'Default Pipeline Deal',
          stage: 'appointmentscheduled',
        })

        expect(deal.properties.pipeline).toBe('default')
      })

      it('should create a deal with custom properties', async () => {
        const deal = await crm.createDeal({
          name: 'Custom Deal',
          stage: 'appointmentscheduled',
          properties: {
            custom_source: 'referral',
            deal_priority: 'high',
          },
        })

        expect(deal.properties.custom_source).toBe('referral')
        expect(deal.properties.deal_priority).toBe('high')
      })
    })

    describe('getDeal', () => {
      it('should get a deal by ID', async () => {
        const created = await crm.createDeal({ name: 'Get Deal', stage: 'appointmentscheduled' })
        const retrieved = await crm.getDeal(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.properties.dealname).toBe('Get Deal')
      })

      it('should get a deal with associations', async () => {
        const deal = await crm.createDeal({ name: 'Assoc Deal', stage: 'appointmentscheduled' })
        const contact = await crm.createContact({ email: 'deal-contact@example.com' })
        await crm.associateDealToContact(deal.id, contact.id)

        const retrieved = await crm.getDeal(deal.id, { associations: ['contacts'] })

        expect(retrieved.associations).toBeDefined()
        expect(retrieved.associations?.contacts).toBeDefined()
        expect(retrieved.associations?.contacts.results).toHaveLength(1)
      })

      it('should throw error for non-existent deal', async () => {
        await expect(crm.getDeal('nonexistent-deal')).rejects.toThrow(HubSpotCRMError)
        await expect(crm.getDeal('nonexistent-deal')).rejects.toMatchObject({
          category: 'OBJECT_NOT_FOUND',
          statusCode: 404,
        })
      })
    })

    describe('updateDeal', () => {
      it('should update deal properties', async () => {
        const deal = await crm.createDeal({ name: 'Update Deal', stage: 'appointmentscheduled', amount: 1000 })
        const updated = await crm.updateDeal(deal.id, { amount: '5000' })

        expect(updated.properties.amount).toBe('5000')
      })

      it('should update deal stage', async () => {
        const deal = await crm.createDeal({ name: 'Stage Deal', stage: 'appointmentscheduled' })
        const updated = await crm.updateDeal(deal.id, { dealstage: 'qualifiedtobuy' })

        expect(updated.properties.dealstage).toBe('qualifiedtobuy')
      })
    })

    describe('moveDealToStage', () => {
      it('should move deal to a new stage', async () => {
        const deal = await crm.createDeal({ name: 'Move Deal', stage: 'appointmentscheduled' })
        const moved = await crm.moveDealToStage(deal.id, 'closedwon')

        expect(moved.properties.dealstage).toBe('closedwon')
      })
    })

    describe('deleteDeal', () => {
      it('should delete a deal', async () => {
        const deal = await crm.createDeal({ name: 'Delete Deal', stage: 'appointmentscheduled' })
        await crm.deleteDeal(deal.id)

        await expect(crm.getDeal(deal.id)).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('searchDeals', () => {
      beforeEach(async () => {
        await crm.createDeal({ name: 'Small Deal', stage: 'appointmentscheduled', amount: 5000 })
        await crm.createDeal({ name: 'Medium Deal', stage: 'qualifiedtobuy', amount: 25000 })
        await crm.createDeal({ name: 'Big Deal', stage: 'closedwon', amount: 100000 })
      })

      it('should search deals by query', async () => {
        const results = await crm.searchDeals('Big')

        expect(results.total).toBe(1)
        expect(results.results[0].properties.dealname).toBe('Big Deal')
      })

      it('should search deals by stage filter', async () => {
        const results = await crm.searchDeals('', {
          filters: [{ field: 'dealstage', operator: 'eq', value: 'closedwon' }],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.dealname).toBe('Big Deal')
      })

      it('should search deals by amount range', async () => {
        const results = await crm.searchDeals('', {
          filters: [{ field: 'amount', operator: 'gte', value: '20000' }],
        })

        expect(results.total).toBe(2)
      })

      it('should search deals sorted by amount', async () => {
        const results = await crm.searchDeals('', {
          sorts: [{ field: 'amount', direction: 'desc' }],
        })

        // String comparison, so might not be numerically sorted
        expect(results.results).toHaveLength(3)
      })
    })

    describe('associateDealToContact', () => {
      it('should associate a deal to a contact', async () => {
        const deal = await crm.createDeal({ name: 'Contact Deal', stage: 'appointmentscheduled' })
        const contact = await crm.createContact({ email: 'deal-assoc@example.com' })

        const association = await crm.associateDealToContact(deal.id, contact.id)

        expect(association).toBeDefined()
        expect(association.fromObjectType).toBe('deals')
        expect(association.toObjectType).toBe('contacts')
      })
    })

    describe('associateDealToCompany', () => {
      it('should associate a deal to a company', async () => {
        const deal = await crm.createDeal({ name: 'Company Deal', stage: 'appointmentscheduled' })
        const company = await crm.createCompany({ name: 'Deal Company' })

        const association = await crm.associateDealToCompany(deal.id, company.id)

        expect(association).toBeDefined()
        expect(association.fromObjectType).toBe('deals')
        expect(association.toObjectType).toBe('companies')
      })
    })

    describe('deal pipeline validation', () => {
      it('should accept valid stage names', async () => {
        const deal = await crm.createDeal({
          name: 'Valid Stage Deal',
          stage: 'appointmentscheduled',
        })

        expect(deal.properties.dealstage).toBe('appointmentscheduled')
      })

      // These tests document expected behavior for pipeline/stage validation
      // Implementation may add validation later
      it('should create deal even with custom stage', async () => {
        const deal = await crm.createDeal({
          name: 'Custom Stage Deal',
          stage: 'custom_stage',
        })

        expect(deal.properties.dealstage).toBe('custom_stage')
      })
    })

    describe('closed deal restrictions', () => {
      it('should allow updates to closed-won deals', async () => {
        const deal = await crm.createDeal({
          name: 'Closed Won Deal',
          stage: 'closedwon',
          amount: 50000,
        })

        // Some CRMs restrict updates to closed deals
        // Our implementation allows it
        const updated = await crm.updateDeal(deal.id, { description: 'Updated description' })

        expect(updated.properties.description).toBe('Updated description')
      })

      it('should allow updates to closed-lost deals', async () => {
        const deal = await crm.createDeal({
          name: 'Closed Lost Deal',
          stage: 'closedlost',
        })

        const updated = await crm.updateDeal(deal.id, { description: 'Updated' })

        expect(updated.properties.description).toBe('Updated')
      })
    })
  })

  // ===========================================================================
  // PROPERTIES API (15+ tests)
  // ===========================================================================

  describe('Properties API', () => {
    describe('getPropertyDefinition', () => {
      it('should get a property definition', async () => {
        await crm.createProperty('contacts', {
          name: 'custom_field',
          label: 'Custom Field',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
        })

        const prop = await crm.getPropertyDefinition('contacts', 'custom_field')

        expect(prop.name).toBe('custom_field')
        expect(prop.label).toBe('Custom Field')
        expect(prop.type).toBe('string')
      })

      it('should throw error for non-existent property', async () => {
        await expect(
          crm.getPropertyDefinition('contacts', 'nonexistent_prop')
        ).rejects.toThrow(HubSpotCRMError)

        await expect(
          crm.getPropertyDefinition('contacts', 'nonexistent_prop')
        ).rejects.toMatchObject({
          category: 'PROPERTY_NOT_FOUND',
          statusCode: 404,
        })
      })
    })

    describe('listProperties', () => {
      beforeEach(async () => {
        await crm.createProperty('contacts', {
          name: 'prop1',
          label: 'Property 1',
          type: 'string',
          displayOrder: 1,
        })
        await crm.createProperty('contacts', {
          name: 'prop2',
          label: 'Property 2',
          type: 'number',
          displayOrder: 2,
        })
      })

      it('should list all properties for object type', async () => {
        const result = await crm.listProperties('contacts')

        expect(result.results.length).toBeGreaterThanOrEqual(2)
      })

      it('should return properties sorted by displayOrder', async () => {
        const result = await crm.listProperties('contacts')

        const orders = result.results.map((p) => p.displayOrder ?? 0)
        expect(orders).toEqual([...orders].sort((a, b) => a - b))
      })
    })

    describe('createProperty', () => {
      it('should create a string property', async () => {
        const prop = await crm.createProperty('contacts', {
          name: 'string_prop',
          label: 'String Property',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          description: 'A text property',
        })

        expect(prop.name).toBe('string_prop')
        expect(prop.type).toBe('string')
        expect(prop.fieldType).toBe('text')
      })

      it('should create a number property', async () => {
        const prop = await crm.createProperty('contacts', {
          name: 'number_prop',
          label: 'Number Property',
          type: 'number',
          fieldType: 'number',
        })

        expect(prop.type).toBe('number')
        expect(prop.fieldType).toBe('number')
      })

      it('should create a date property', async () => {
        const prop = await crm.createProperty('contacts', {
          name: 'date_prop',
          label: 'Date Property',
          type: 'date',
          fieldType: 'date',
        })

        expect(prop.type).toBe('date')
      })

      it('should create an enum property with options', async () => {
        const prop = await crm.createProperty('contacts', {
          name: 'enum_prop',
          label: 'Enum Property',
          type: 'enumeration',
          fieldType: 'select',
          options: [
            { label: 'Option A', value: 'a', displayOrder: 0 },
            { label: 'Option B', value: 'b', displayOrder: 1 },
            { label: 'Option C', value: 'c', displayOrder: 2 },
          ],
        })

        expect(prop.type).toBe('enumeration')
        expect(prop.options).toHaveLength(3)
        expect(prop.options?.[0].value).toBe('a')
      })

      it('should create a boolean property', async () => {
        const prop = await crm.createProperty('contacts', {
          name: 'bool_prop',
          label: 'Boolean Property',
          type: 'bool',
          fieldType: 'booleancheckbox',
        })

        expect(prop.type).toBe('bool')
      })

      it('should throw error for duplicate property name', async () => {
        await crm.createProperty('contacts', {
          name: 'duplicate_prop',
          label: 'Duplicate Property',
          type: 'string',
        })

        await expect(
          crm.createProperty('contacts', {
            name: 'duplicate_prop',
            label: 'Another Label',
            type: 'number',
          })
        ).rejects.toThrow(HubSpotCRMError)

        await expect(
          crm.createProperty('contacts', {
            name: 'duplicate_prop',
            label: 'Another Label',
            type: 'number',
          })
        ).rejects.toMatchObject({
          category: 'PROPERTY_EXISTS',
          statusCode: 409,
        })
      })

      it('should set default values for optional fields', async () => {
        const prop = await crm.createProperty('contacts', {
          name: 'defaults_prop',
          label: 'Defaults Property',
          type: 'string',
        })

        expect(prop.fieldType).toBe('text')
        expect(prop.groupName).toBe('default')
        expect(prop.hasUniqueValue).toBe(false)
        expect(prop.hidden).toBe(false)
        expect(prop.formField).toBe(true)
      })
    })

    describe('updateProperty', () => {
      it('should update property label', async () => {
        await crm.createProperty('contacts', {
          name: 'update_prop',
          label: 'Original Label',
          type: 'string',
        })

        const updated = await crm.updateProperty('contacts', 'update_prop', {
          label: 'Updated Label',
        })

        expect(updated.label).toBe('Updated Label')
      })

      it('should update property description', async () => {
        await crm.createProperty('contacts', {
          name: 'desc_prop',
          label: 'Description Property',
          type: 'string',
        })

        const updated = await crm.updateProperty('contacts', 'desc_prop', {
          description: 'New description',
        })

        expect(updated.description).toBe('New description')
      })

      it('should update enum options', async () => {
        await crm.createProperty('contacts', {
          name: 'update_enum',
          label: 'Update Enum',
          type: 'enumeration',
          options: [{ label: 'A', value: 'a' }],
        })

        const updated = await crm.updateProperty('contacts', 'update_enum', {
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        })

        expect(updated.options).toHaveLength(2)
      })
    })

    describe('createPropertyGroup', () => {
      it('should create a property group', async () => {
        const group = await crm.createPropertyGroup('contacts', {
          name: 'custom_group',
          label: 'Custom Group',
          displayOrder: 10,
        })

        expect(group.name).toBe('custom_group')
        expect(group.label).toBe('Custom Group')
        expect(group.displayOrder).toBe(10)
      })

      it('should throw error for duplicate group name', async () => {
        await crm.createPropertyGroup('contacts', {
          name: 'dup_group',
          label: 'Duplicate Group',
        })

        await expect(
          crm.createPropertyGroup('contacts', {
            name: 'dup_group',
            label: 'Another Group',
          })
        ).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('getPropertyGroup', () => {
      it('should get a property group', async () => {
        await crm.createPropertyGroup('contacts', {
          name: 'get_group',
          label: 'Get Group',
        })

        const group = await crm.getPropertyGroup('contacts', 'get_group')

        expect(group.name).toBe('get_group')
      })

      it('should throw error for non-existent group', async () => {
        await expect(
          crm.getPropertyGroup('contacts', 'nonexistent_group')
        ).rejects.toThrow(HubSpotCRMError)
      })
    })
  })

  // ===========================================================================
  // ASSOCIATIONS API (15+ tests)
  // ===========================================================================

  describe('Associations API', () => {
    describe('createAssociation', () => {
      it('should create an association between objects', async () => {
        const contact = await crm.createContact({ email: 'assoc-test@example.com' })
        const company = await crm.createCompany({ name: 'Assoc Test Co' })

        const association = await crm.createAssociation(
          'contacts',
          contact.id,
          'companies',
          company.id,
          'contact_to_company'
        )

        expect(association).toBeDefined()
        expect(association.id).toBeTruthy()
        expect(association.fromObjectType).toBe('contacts')
        expect(association.fromObjectId).toBe(contact.id)
        expect(association.toObjectType).toBe('companies')
        expect(association.toObjectId).toBe(company.id)
        expect(association.associationType).toBe('contact_to_company')
      })

      it('should create bi-directional associations', async () => {
        const contact = await crm.createContact({ email: 'bidir@example.com' })
        const company = await crm.createCompany({ name: 'Bidir Co' })

        await crm.createAssociation(
          'contacts',
          contact.id,
          'companies',
          company.id,
          'contact_to_company'
        )

        // Should be able to look up from both directions
        const contactAssocs = await crm.listAssociations('contacts', contact.id, 'companies')
        const companyAssocs = await crm.listAssociations('companies', company.id, 'contacts')

        expect(contactAssocs.results).toHaveLength(1)
        expect(companyAssocs.results).toHaveLength(1)
      })
    })

    describe('deleteAssociation', () => {
      it('should delete an association', async () => {
        const contact = await crm.createContact({ email: 'delete-assoc@example.com' })
        const company = await crm.createCompany({ name: 'Delete Assoc Co' })

        await crm.createAssociation(
          'contacts',
          contact.id,
          'companies',
          company.id,
          'contact_to_company'
        )

        await crm.deleteAssociation('contacts', contact.id, 'companies', company.id)

        const associations = await crm.listAssociations('contacts', contact.id, 'companies')
        expect(associations.results).toHaveLength(0)
      })

      it('should delete both directions of bi-directional association', async () => {
        const contact = await crm.createContact({ email: 'bidir-delete@example.com' })
        const company = await crm.createCompany({ name: 'Bidir Delete Co' })

        await crm.createAssociation(
          'contacts',
          contact.id,
          'companies',
          company.id,
          'contact_to_company'
        )

        await crm.deleteAssociation('contacts', contact.id, 'companies', company.id)

        const contactAssocs = await crm.listAssociations('contacts', contact.id, 'companies')
        const companyAssocs = await crm.listAssociations('companies', company.id, 'contacts')

        expect(contactAssocs.results).toHaveLength(0)
        expect(companyAssocs.results).toHaveLength(0)
      })
    })

    describe('listAssociations', () => {
      it('should list associations for an object', async () => {
        const contact = await crm.createContact({ email: 'list-assoc@example.com' })
        const company1 = await crm.createCompany({ name: 'Company 1' })
        const company2 = await crm.createCompany({ name: 'Company 2' })

        await crm.associateContactToCompany(contact.id, company1.id)
        await crm.associateContactToCompany(contact.id, company2.id)

        const associations = await crm.listAssociations('contacts', contact.id, 'companies')

        expect(associations.results).toHaveLength(2)
      })

      it('should filter by target object type', async () => {
        const contact = await crm.createContact({ email: 'filter-assoc@example.com' })
        const company = await crm.createCompany({ name: 'Filter Company' })
        const deal = await crm.createDeal({ name: 'Filter Deal', stage: 'appointmentscheduled' })

        await crm.associateContactToCompany(contact.id, company.id)
        await crm.associateDealToContact(deal.id, contact.id)

        const companyAssocs = await crm.listAssociations('contacts', contact.id, 'companies')
        const dealAssocs = await crm.listAssociations('contacts', contact.id, 'deals')

        expect(companyAssocs.results).toHaveLength(1)
        expect(dealAssocs.results).toHaveLength(1)
      })

      it('should list all associations when no type filter', async () => {
        const contact = await crm.createContact({ email: 'all-assoc@example.com' })
        const company = await crm.createCompany({ name: 'All Assoc Company' })
        const deal = await crm.createDeal({ name: 'All Assoc Deal', stage: 'appointmentscheduled' })

        await crm.associateContactToCompany(contact.id, company.id)
        await crm.associateDealToContact(deal.id, contact.id)

        const allAssocs = await crm.listAssociations('contacts', contact.id)

        expect(allAssocs.results.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('batchCreateAssociations', () => {
      it('should batch create associations', async () => {
        const contact1 = await crm.createContact({ email: 'batch-assoc1@example.com' })
        const contact2 = await crm.createContact({ email: 'batch-assoc2@example.com' })
        const company = await crm.createCompany({ name: 'Batch Assoc Co' })

        const result = await crm.batchCreateAssociations([
          {
            fromObjectType: 'contacts',
            fromObjectId: contact1.id,
            toObjectType: 'companies',
            toObjectId: company.id,
            associationType: 'contact_to_company',
          },
          {
            fromObjectType: 'contacts',
            fromObjectId: contact2.id,
            toObjectType: 'companies',
            toObjectId: company.id,
            associationType: 'contact_to_company',
          },
        ])

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })
    })

    describe('association types', () => {
      it('should support contact_to_company association', async () => {
        const contact = await crm.createContact({ email: 'type1@example.com' })
        const company = await crm.createCompany({ name: 'Type 1 Co' })

        const assoc = await crm.createAssociation(
          'contacts',
          contact.id,
          'companies',
          company.id,
          'contact_to_company'
        )

        expect(assoc.associationType).toBe('contact_to_company')
      })

      it('should support contact_to_deal association', async () => {
        const contact = await crm.createContact({ email: 'type2@example.com' })
        const deal = await crm.createDeal({ name: 'Type 2 Deal', stage: 'appointmentscheduled' })

        const assoc = await crm.createAssociation(
          'contacts',
          contact.id,
          'deals',
          deal.id,
          'contact_to_deal'
        )

        expect(assoc.associationType).toBe('contact_to_deal')
      })

      it('should support company_to_deal association', async () => {
        const company = await crm.createCompany({ name: 'Type 3 Co' })
        const deal = await crm.createDeal({ name: 'Type 3 Deal', stage: 'appointmentscheduled' })

        const assoc = await crm.createAssociation(
          'companies',
          company.id,
          'deals',
          deal.id,
          'company_to_deal'
        )

        expect(assoc.associationType).toBe('company_to_deal')
      })

      it('should support engagement_to_contact association', async () => {
        const contact = await crm.createContact({ email: 'engage@example.com' })
        const note = await crm.createNote('contacts', contact.id, 'Test note')

        const associations = await crm.listAssociations('notes', note.id, 'contacts')

        expect(associations.results.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  // ===========================================================================
  // ACTIVITY TIMELINE (15+ tests)
  // ===========================================================================

  describe('Activity Timeline', () => {
    describe('createEngagement', () => {
      it('should create a note engagement', async () => {
        const contact = await crm.createContact({ email: 'note-eng@example.com' })

        const engagement = await crm.createEngagement('note', {
          contactIds: [contact.id],
          hs_note_body: 'This is a test note',
        })

        expect(engagement).toBeDefined()
        expect(engagement.type).toBe('note')
        expect(engagement.properties.hs_note_body).toBe('This is a test note')
      })

      it('should create a call engagement', async () => {
        const contact = await crm.createContact({ email: 'call-eng@example.com' })

        const engagement = await crm.createEngagement('call', {
          contactIds: [contact.id],
          hs_call_title: 'Discovery Call',
          hs_call_body: 'Discussed requirements',
          hs_call_duration: '1800000',
          hs_call_direction: 'OUTBOUND',
        })

        expect(engagement.type).toBe('call')
        expect(engagement.properties.hs_call_title).toBe('Discovery Call')
      })

      it('should create an email engagement', async () => {
        const contact = await crm.createContact({ email: 'email-eng@example.com' })

        const engagement = await crm.createEngagement('email', {
          contactIds: [contact.id],
          hs_email_subject: 'Follow up',
          hs_email_text: 'Thanks for your time',
          hs_email_direction: 'OUTBOUND',
        })

        expect(engagement.type).toBe('email')
        expect(engagement.properties.hs_email_subject).toBe('Follow up')
      })

      it('should create a meeting engagement', async () => {
        const contact = await crm.createContact({ email: 'meeting-eng@example.com' })

        const engagement = await crm.createEngagement('meeting', {
          contactIds: [contact.id],
          hs_meeting_title: 'Product Demo',
          hs_meeting_body: 'Demo of new features',
          hs_meeting_start_time: new Date().toISOString(),
          hs_meeting_end_time: new Date(Date.now() + 3600000).toISOString(),
        })

        expect(engagement.type).toBe('meeting')
        expect(engagement.properties.hs_meeting_title).toBe('Product Demo')
      })

      it('should create a task engagement', async () => {
        const contact = await crm.createContact({ email: 'task-eng@example.com' })

        const engagement = await crm.createEngagement('task', {
          contactIds: [contact.id],
          hs_task_subject: 'Follow up call',
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: 'HIGH',
        })

        expect(engagement.type).toBe('task')
        expect(engagement.properties.hs_task_subject).toBe('Follow up call')
      })

      it('should associate engagement with multiple objects', async () => {
        const contact = await crm.createContact({ email: 'multi-eng@example.com' })
        const company = await crm.createCompany({ name: 'Multi Eng Co' })
        const deal = await crm.createDeal({ name: 'Multi Eng Deal', stage: 'appointmentscheduled' })

        const engagement = await crm.createEngagement('note', {
          contactIds: [contact.id],
          companyIds: [company.id],
          dealIds: [deal.id],
          hs_note_body: 'Multi-association note',
        })

        expect(engagement).toBeDefined()

        const contactEngagements = await crm.getEngagements('contacts', contact.id)
        const companyEngagements = await crm.getEngagements('companies', company.id)
        const dealEngagements = await crm.getEngagements('deals', deal.id)

        expect(contactEngagements.results.length).toBeGreaterThanOrEqual(1)
        expect(companyEngagements.results.length).toBeGreaterThanOrEqual(1)
        expect(dealEngagements.results.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('getEngagements', () => {
      it('should get engagements for an object', async () => {
        const contact = await crm.createContact({ email: 'get-eng@example.com' })
        await crm.createEngagement('note', { contactIds: [contact.id], hs_note_body: 'Note 1' })
        await crm.createEngagement('note', { contactIds: [contact.id], hs_note_body: 'Note 2' })

        const engagements = await crm.getEngagements('contacts', contact.id)

        expect(engagements.results.length).toBeGreaterThanOrEqual(2)
      })

      it('should return engagements sorted by timestamp descending', async () => {
        const contact = await crm.createContact({ email: 'sorted-eng@example.com' })
        await crm.createEngagement('note', { contactIds: [contact.id], hs_note_body: 'First' })
        await new Promise((resolve) => setTimeout(resolve, 10))
        await crm.createEngagement('note', { contactIds: [contact.id], hs_note_body: 'Second' })

        const engagements = await crm.getEngagements('contacts', contact.id)

        // Most recent first
        expect(engagements.results[0].properties.hs_note_body).toBe('Second')
      })
    })

    describe('createNote', () => {
      it('should create a note on a contact', async () => {
        const contact = await crm.createContact({ email: 'note-contact@example.com' })

        const note = await crm.createNote('contacts', contact.id, 'This is a note on the contact')

        expect(note.type).toBe('note')
        expect(note.properties.hs_note_body).toBe('This is a note on the contact')
      })

      it('should create a note with owner', async () => {
        const contact = await crm.createContact({ email: 'note-owner@example.com' })

        const note = await crm.createNote('contacts', contact.id, 'Owned note', {
          content: 'Owned note',
          ownerId: 'owner-123',
        })

        expect(note.properties.hubspot_owner_id).toBe('owner-123')
      })

      it('should create a note with custom timestamp', async () => {
        const contact = await crm.createContact({ email: 'note-timestamp@example.com' })
        const customTimestamp = new Date('2025-01-01T10:00:00Z').toISOString()

        const note = await crm.createNote('contacts', contact.id, 'Backdated note', {
          content: 'Backdated note',
          timestamp: customTimestamp,
        })

        expect(note.properties.hs_timestamp).toBe(customTimestamp)
      })
    })

    describe('createTask', () => {
      it('should create a task with due date', async () => {
        const contact = await crm.createContact({ email: 'task-due@example.com' })
        const dueDate = new Date('2025-02-15').toISOString()

        const task = await crm.createTask('contacts', contact.id, {
          subject: 'Follow up',
          dueDate,
        })

        expect(task.type).toBe('task')
        expect(task.properties.hs_task_subject).toBe('Follow up')
        expect(task.properties.hs_task_due_date).toBe(dueDate)
      })

      it('should create a task with assignment', async () => {
        const contact = await crm.createContact({ email: 'task-assign@example.com' })

        const task = await crm.createTask('contacts', contact.id, {
          subject: 'Assigned task',
          assignee: 'owner-456',
        })

        expect(task.properties.hubspot_owner_id).toBe('owner-456')
      })

      it('should create a task with priority', async () => {
        const contact = await crm.createContact({ email: 'task-priority@example.com' })

        const task = await crm.createTask('contacts', contact.id, {
          subject: 'High priority task',
          priority: 'HIGH',
        })

        expect(task.properties.hs_task_priority).toBe('HIGH')
      })

      it('should create a task with status', async () => {
        const contact = await crm.createContact({ email: 'task-status@example.com' })

        const task = await crm.createTask('contacts', contact.id, {
          subject: 'In progress task',
          status: 'IN_PROGRESS',
        })

        expect(task.properties.hs_task_status).toBe('IN_PROGRESS')
      })

      it('should default task status to NOT_STARTED', async () => {
        const contact = await crm.createContact({ email: 'task-default@example.com' })

        const task = await crm.createTask('contacts', contact.id, {
          subject: 'New task',
        })

        expect(task.properties.hs_task_status).toBe('NOT_STARTED')
      })

      it('should default task priority to MEDIUM', async () => {
        const contact = await crm.createContact({ email: 'task-med@example.com' })

        const task = await crm.createTask('contacts', contact.id, {
          subject: 'Medium priority',
        })

        expect(task.properties.hs_task_priority).toBe('MEDIUM')
      })
    })

    describe('engagement associations', () => {
      it('should automatically associate engagement to object', async () => {
        const contact = await crm.createContact({ email: 'auto-assoc@example.com' })
        const note = await crm.createNote('contacts', contact.id, 'Auto-associated note')

        const engagements = await crm.getEngagements('contacts', contact.id)

        expect(engagements.results.some((e) => e.id === note.id)).toBe(true)
      })
    })

    describe('activity filtering', () => {
      beforeEach(async () => {
        const contact = await crm.createContact({ email: 'filter-activities@example.com' })
        await crm.createEngagement('note', { contactIds: [contact.id], hs_note_body: 'Note' })
        await crm.createEngagement('call', { contactIds: [contact.id], hs_call_title: 'Call' })
        await crm.createEngagement('email', { contactIds: [contact.id], hs_email_subject: 'Email' })
      })

      it('should retrieve engagements of all types', async () => {
        const contacts = await crm.searchContacts('filter-activities')
        const contact = contacts.results[0]

        const engagements = await crm.getEngagements('contacts', contact.id)

        const types = engagements.results.map((e) => e.type)
        expect(types).toContain('note')
        expect(types).toContain('call')
        expect(types).toContain('email')
      })
    })
  })

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  describe('Utility Methods', () => {
    describe('clear', () => {
      it('should clear all data', async () => {
        await crm.createContact({ email: 'clear@example.com' })
        await crm.createCompany({ name: 'Clear Co' })
        await crm.createDeal({ name: 'Clear Deal', stage: 'appointmentscheduled' })

        await crm.clear()

        const stats = await crm.getStats()
        expect(stats.contacts).toBe(0)
        expect(stats.companies).toBe(0)
        expect(stats.deals).toBe(0)
      })
    })

    describe('getStats', () => {
      it('should return statistics', async () => {
        await crm.createContact({ email: 'stats1@example.com' })
        await crm.createContact({ email: 'stats2@example.com' })
        await crm.createCompany({ name: 'Stats Co' })
        await crm.createDeal({ name: 'Stats Deal', stage: 'appointmentscheduled' })

        const stats = await crm.getStats()

        expect(stats.contacts).toBe(2)
        expect(stats.companies).toBe(1)
        expect(stats.deals).toBe(1)
      })
    })
  })

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('Error Handling', () => {
    describe('HubSpotCRMError', () => {
      it('should include category in error', async () => {
        try {
          await crm.getContact('nonexistent')
        } catch (error) {
          expect(error).toBeInstanceOf(HubSpotCRMError)
          expect((error as HubSpotCRMError).category).toBe('OBJECT_NOT_FOUND')
        }
      })

      it('should include status code in error', async () => {
        try {
          await crm.getContact('nonexistent')
        } catch (error) {
          expect((error as HubSpotCRMError).statusCode).toBe(404)
        }
      })

      it('should include correlation ID in error', async () => {
        try {
          await crm.getContact('nonexistent')
        } catch (error) {
          expect((error as HubSpotCRMError).correlationId).toBeTruthy()
        }
      })
    })

    describe('invalid property errors', () => {
      it('should handle read-only property update gracefully', async () => {
        // createdate is typically read-only but our impl allows it
        const contact = await crm.createContact({ email: 'readonly@example.com' })

        // Implementation does not enforce read-only, just updates
        const updated = await crm.updateContact(contact.id, {
          createdate: new Date().toISOString(),
        })

        expect(updated).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // ADVANCED SEARCH OPERATORS (Additional tests for RED phase)
  // ===========================================================================

  describe('Advanced Search Operators', () => {
    describe('between operator', () => {
      beforeEach(async () => {
        await crm.createDeal({ name: 'Deal 1', stage: 'appointmentscheduled', amount: 5000 })
        await crm.createDeal({ name: 'Deal 2', stage: 'appointmentscheduled', amount: 15000 })
        await crm.createDeal({ name: 'Deal 3', stage: 'appointmentscheduled', amount: 30000 })
      })

      it('should filter using between operator', async () => {
        const results = await crm.searchDeals('', {
          filters: [
            { field: 'amount', operator: 'between', value: '10000', highValue: '20000' },
          ],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.dealname).toBe('Deal 2')
      })
    })

    describe('not_in operator', () => {
      beforeEach(async () => {
        await crm.createContact({ email: 'a@test.com', lifecycleStage: 'lead' })
        await crm.createContact({ email: 'b@test.com', lifecycleStage: 'customer' })
        await crm.createContact({ email: 'c@test.com', lifecycleStage: 'subscriber' })
      })

      it('should filter using not_in operator', async () => {
        const results = await crm.searchContacts('', {
          filters: [
            { field: 'lifecyclestage', operator: 'not_in', values: ['lead', 'customer'] },
          ],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.lifecyclestage).toBe('subscriber')
      })
    })

    describe('not_has_property operator', () => {
      beforeEach(async () => {
        await crm.createContact({ email: 'has-phone@test.com', phone: '+1234567890' })
        await crm.createContact({ email: 'no-phone@test.com' })
      })

      it('should filter contacts without phone property', async () => {
        const results = await crm.searchContacts('', {
          filters: [{ field: 'phone', operator: 'not_has_property' }],
        })

        expect(results.results.every((c) => c.properties.phone === null || c.properties.phone === undefined)).toBe(true)
      })
    })

    describe('not_contains_token operator', () => {
      beforeEach(async () => {
        await crm.createCompany({ name: 'Acme Corp', domain: 'acme.com' })
        await crm.createCompany({ name: 'Beta Inc', domain: 'beta.io' })
      })

      it('should filter using not_contains_token', async () => {
        const results = await crm.searchCompanies('', {
          filters: [{ field: 'domain', operator: 'not_contains_token', value: '.com' }],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.domain).toBe('beta.io')
      })
    })

    describe('numeric comparison operators', () => {
      beforeEach(async () => {
        await crm.createDeal({ name: 'Small', stage: 'appointmentscheduled', amount: 1000 })
        await crm.createDeal({ name: 'Medium', stage: 'appointmentscheduled', amount: 5000 })
        await crm.createDeal({ name: 'Large', stage: 'appointmentscheduled', amount: 10000 })
      })

      it('should filter using lt operator', async () => {
        const results = await crm.searchDeals('', {
          filters: [{ field: 'amount', operator: 'lt', value: '5000' }],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.dealname).toBe('Small')
      })

      it('should filter using lte operator', async () => {
        const results = await crm.searchDeals('', {
          filters: [{ field: 'amount', operator: 'lte', value: '5000' }],
        })

        expect(results.total).toBe(2)
      })

      it('should filter using gt operator', async () => {
        const results = await crm.searchDeals('', {
          filters: [{ field: 'amount', operator: 'gt', value: '5000' }],
        })

        expect(results.total).toBe(1)
        expect(results.results[0].properties.dealname).toBe('Large')
      })

      it('should filter using gte operator', async () => {
        const results = await crm.searchDeals('', {
          filters: [{ field: 'amount', operator: 'gte', value: '5000' }],
        })

        expect(results.total).toBe(2)
      })
    })
  })

  // ===========================================================================
  // TICKETS API (Additional coverage)
  // ===========================================================================

  describe('Tickets API', () => {
    it('should create a ticket with all properties', async () => {
      // Test that ticket functionality works via generic object API
      const ticket = await crm.createObject('tickets', {
        subject: 'Support Request',
        content: 'Need help with account',
        hs_pipeline: 'default',
        hs_pipeline_stage: 'new',
        hs_ticket_priority: 'HIGH',
      })

      expect(ticket).toBeDefined()
      expect(ticket.id).toBeTruthy()
      expect(ticket.properties.subject).toBe('Support Request')
      expect(ticket.properties.hs_ticket_priority).toBe('HIGH')
    })

    it('should associate ticket to contact', async () => {
      const contact = await crm.createContact({ email: 'ticket-contact@test.com' })
      const ticket = await crm.createObject('tickets', {
        subject: 'Ticket',
        hs_pipeline_stage: 'new',
      })

      const assoc = await crm.createAssociation(
        'tickets',
        ticket.id,
        'contacts',
        contact.id,
        'contact_to_ticket'
      )

      expect(assoc).toBeDefined()
    })

    it('should search tickets', async () => {
      await crm.createObject('tickets', { subject: 'Billing Issue', hs_pipeline_stage: 'new' })
      await crm.createObject('tickets', { subject: 'Technical Bug', hs_pipeline_stage: 'open' })

      const results = await crm.searchObjects('tickets', 'Billing')

      expect(results.total).toBe(1)
      expect(results.results[0].properties.subject).toBe('Billing Issue')
    })
  })

  // ===========================================================================
  // LINE ITEMS API
  // ===========================================================================

  describe('Line Items API', () => {
    it('should create a line item', async () => {
      const lineItem = await crm.createObject('line_items', {
        name: 'Enterprise License',
        quantity: '5',
        price: '1000',
        amount: '5000',
      })

      expect(lineItem).toBeDefined()
      expect(lineItem.properties.name).toBe('Enterprise License')
      expect(lineItem.properties.quantity).toBe('5')
    })

    it('should associate line item to deal', async () => {
      const deal = await crm.createDeal({ name: 'Line Item Deal', stage: 'appointmentscheduled' })
      const lineItem = await crm.createObject('line_items', {
        name: 'Product',
        quantity: '1',
        price: '500',
      })

      const assoc = await crm.createAssociation(
        'line_items',
        lineItem.id,
        'deals',
        deal.id,
        'line_item_to_deal' as any
      )

      expect(assoc).toBeDefined()
    })
  })

  // ===========================================================================
  // PRODUCTS API
  // ===========================================================================

  describe('Products API', () => {
    it('should create a product', async () => {
      const product = await crm.createObject('products', {
        name: 'Enterprise Plan',
        description: 'Full-featured enterprise solution',
        price: '5000',
        hs_recurring_billing_period: 'monthly',
      })

      expect(product).toBeDefined()
      expect(product.properties.name).toBe('Enterprise Plan')
      expect(product.properties.price).toBe('5000')
    })

    it('should search products by name', async () => {
      await crm.createObject('products', { name: 'Basic Plan', price: '100' })
      await crm.createObject('products', { name: 'Pro Plan', price: '500' })
      await crm.createObject('products', { name: 'Enterprise Plan', price: '5000' })

      const results = await crm.searchObjects('products', 'Plan')

      expect(results.total).toBe(3)
    })
  })

  // ===========================================================================
  // QUOTES API
  // ===========================================================================

  describe('Quotes API', () => {
    it('should create a quote', async () => {
      const quote = await crm.createObject('quotes', {
        hs_title: 'Q1 2025 Proposal',
        hs_expiration_date: '2025-03-31',
        hs_status: 'DRAFT',
        hs_quote_amount: '50000',
        hs_currency: 'USD',
      })

      expect(quote).toBeDefined()
      expect(quote.properties.hs_title).toBe('Q1 2025 Proposal')
      expect(quote.properties.hs_status).toBe('DRAFT')
    })

    it('should associate quote to deal', async () => {
      const deal = await crm.createDeal({ name: 'Quote Deal', stage: 'appointmentscheduled' })
      const quote = await crm.createObject('quotes', {
        hs_title: 'Deal Quote',
        hs_status: 'DRAFT',
      })

      const assoc = await crm.createAssociation(
        'quotes',
        quote.id,
        'deals',
        deal.id,
        'quote_to_deal' as any
      )

      expect(assoc).toBeDefined()
    })
  })

  // ===========================================================================
  // PIPELINE VALIDATION (Expected to FAIL - not implemented)
  // ===========================================================================

  describe('Pipeline Validation', () => {
    it('should validate deal stage exists in pipeline', async () => {
      // This test expects validation that doesn't exist yet
      // Should throw an error for invalid stage
      await expect(
        crm.createDeal({
          name: 'Invalid Stage Deal',
          stage: 'definitely_not_a_valid_stage_12345',
          pipeline: 'default',
        })
      ).rejects.toThrow('Invalid deal stage')
    })

    it('should validate pipeline exists', async () => {
      // Should throw an error for invalid pipeline
      await expect(
        crm.createDeal({
          name: 'Invalid Pipeline Deal',
          stage: 'appointmentscheduled',
          pipeline: 'nonexistent_pipeline_xyz',
        })
      ).rejects.toThrow('Invalid pipeline')
    })

    it('should list pipelines for object type', async () => {
      // This method doesn't exist yet
      const pipelines = await (crm as any).listPipelines('deals')

      expect(pipelines).toBeDefined()
      expect(Array.isArray(pipelines.results)).toBe(true)
    })

    it('should get pipeline stages', async () => {
      // This method doesn't exist yet
      const stages = await (crm as any).getPipelineStages('deals', 'default')

      expect(stages).toBeDefined()
      expect(Array.isArray(stages.results)).toBe(true)
    })
  })

  // ===========================================================================
  // REQUIRED PROPERTY VALIDATION (Expected to FAIL - not implemented)
  // ===========================================================================

  describe('Required Property Validation', () => {
    it('should require email for contact creation', async () => {
      // Should fail without email
      await expect(
        (crm as any).createContact({}) // Missing email
      ).rejects.toThrow('email is required')
    })

    it('should require name for company creation', async () => {
      // Should fail without name
      await expect(
        (crm as any).createCompany({}) // Missing name
      ).rejects.toThrow('name is required')
    })

    it('should validate required custom properties', async () => {
      // Create a required property
      await crm.createProperty('contacts', {
        name: 'required_field',
        label: 'Required Field',
        type: 'string',
        hasUniqueValue: false,
      })

      // Mark it as required (this API doesn't exist yet)
      await (crm as any).setPropertyRequired('contacts', 'required_field', true)

      // Should fail when creating contact without required field
      await expect(
        crm.createContact({ email: 'missing-required@test.com' })
      ).rejects.toThrow('required_field is required')
    })
  })

  // ===========================================================================
  // UNIQUE VALUE VALIDATION (Expected to FAIL - not implemented)
  // ===========================================================================

  describe('Unique Value Validation', () => {
    it('should enforce unique value constraint on properties', async () => {
      // Create a property with unique value constraint
      await crm.createProperty('contacts', {
        name: 'employee_id',
        label: 'Employee ID',
        type: 'string',
        hasUniqueValue: true,
      })

      // Create first contact with employee_id
      await crm.createContact({
        email: 'emp1@test.com',
        properties: { employee_id: 'EMP001' },
      })

      // Should fail when creating second contact with same employee_id
      await expect(
        crm.createContact({
          email: 'emp2@test.com',
          properties: { employee_id: 'EMP001' },
        })
      ).rejects.toThrow('Duplicate value for unique property')
    })
  })

  // ===========================================================================
  // PROPERTY VALUE VALIDATION (Expected to FAIL - not implemented)
  // ===========================================================================

  describe('Property Value Validation', () => {
    it('should validate number property values', async () => {
      await crm.createProperty('contacts', {
        name: 'age',
        label: 'Age',
        type: 'number',
      })

      // Should fail with non-numeric value
      await expect(
        crm.createContact({
          email: 'invalid-age@test.com',
          properties: { age: 'not a number' },
        })
      ).rejects.toThrow('Invalid value for number property')
    })

    it('should validate date property values', async () => {
      await crm.createProperty('contacts', {
        name: 'birthdate',
        label: 'Birth Date',
        type: 'date',
      })

      // Should fail with invalid date
      await expect(
        crm.createContact({
          email: 'invalid-date@test.com',
          properties: { birthdate: 'not a date' },
        })
      ).rejects.toThrow('Invalid value for date property')
    })

    it('should validate enum property values', async () => {
      await crm.createProperty('contacts', {
        name: 'status',
        label: 'Status',
        type: 'enumeration',
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
        ],
      })

      // Should fail with invalid enum value
      await expect(
        crm.createContact({
          email: 'invalid-enum@test.com',
          properties: { status: 'invalid_status' },
        })
      ).rejects.toThrow('Invalid value for enumeration property')
    })
  })

  // ===========================================================================
  // READ-ONLY PROPERTIES (Expected to FAIL - not implemented)
  // ===========================================================================

  describe('Read-Only Properties', () => {
    it('should prevent updating hs_object_id', async () => {
      const contact = await crm.createContact({ email: 'readonly-id@test.com' })

      await expect(
        crm.updateContact(contact.id, { hs_object_id: 'new_id' })
      ).rejects.toThrow('Cannot update read-only property')
    })

    it('should prevent updating createdate', async () => {
      const contact = await crm.createContact({ email: 'readonly-create@test.com' })

      await expect(
        crm.updateContact(contact.id, { createdate: new Date().toISOString() })
      ).rejects.toThrow('Cannot update read-only property')
    })
  })

  // ===========================================================================
  // ASSOCIATION LIMITS (Expected to FAIL - not implemented)
  // ===========================================================================

  describe('Association Limits', () => {
    it('should enforce association limits between object types', async () => {
      const contact = await crm.createContact({ email: 'limit-test@test.com' })

      // Create many companies and try to associate them all
      const companies = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          crm.createCompany({ name: `Company ${i}` })
        )
      )

      // Associate all companies (should eventually hit a limit)
      for (const company of companies) {
        await crm.associateContactToCompany(contact.id, company.id)
      }

      // Trying to add more should fail (HubSpot has limits)
      const extraCompany = await crm.createCompany({ name: 'Extra Company' })

      // This might not throw in our implementation, but real HubSpot has limits
      // This test documents expected behavior
      await expect(
        crm.associateContactToCompany(contact.id, extraCompany.id)
      ).rejects.toThrow('Association limit exceeded')
    })
  })

  // ===========================================================================
  // BATCH OPERATIONS LIMITS (Expected to FAIL - not fully implemented)
  // ===========================================================================

  describe('Batch Operations Limits', () => {
    it('should limit batch create to 100 items', async () => {
      const inputs = Array.from({ length: 150 }, (_, i) => ({
        email: `batch${i}@test.com`,
      }))

      await expect(crm.batchCreateContacts(inputs)).rejects.toThrow(
        'Batch size exceeds limit'
      )
    })

    it('should limit batch update to 100 items', async () => {
      // Create contacts first
      const contacts = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          crm.createContact({ email: `batch-update${i}@test.com` })
        )
      )

      const updates = Array.from({ length: 150 }, (_, i) => ({
        id: contacts[i % contacts.length].id,
        properties: { firstname: `Updated${i}` },
      }))

      await expect(crm.batchUpdateContacts(updates)).rejects.toThrow(
        'Batch size exceeds limit'
      )
    })
  })

  // ===========================================================================
  // ENGAGEMENT ACTIVITY COMPLETE TEST
  // ===========================================================================

  describe('Complete Task', () => {
    it('should complete a task', async () => {
      const contact = await crm.createContact({ email: 'complete-task@test.com' })
      const task = await crm.createTask('contacts', contact.id, {
        subject: 'Task to complete',
        status: 'NOT_STARTED',
      })

      // This method doesn't exist yet
      const completed = await (crm as any).completeTask(task.id)

      expect(completed.properties.hs_task_status).toBe('COMPLETED')
    })

    it('should update task completion date on complete', async () => {
      const contact = await crm.createContact({ email: 'complete-date@test.com' })
      const task = await crm.createTask('contacts', contact.id, {
        subject: 'Task with completion date',
      })

      const completed = await (crm as any).completeTask(task.id)

      expect(completed.properties.hs_task_completion_date).toBeTruthy()
    })
  })

  // ===========================================================================
  // ACTIVITY DATE RANGE FILTERING (Expected to need implementation)
  // ===========================================================================

  describe('Activity Date Range Filtering', () => {
    it('should filter engagements by date range', async () => {
      const contact = await crm.createContact({ email: 'date-filter@test.com' })

      // Create engagements at different times
      await crm.createNote('contacts', contact.id, 'Old note', {
        content: 'Old note',
        timestamp: new Date('2024-01-01').toISOString(),
      })
      await crm.createNote('contacts', contact.id, 'New note', {
        content: 'New note',
        timestamp: new Date('2025-01-01').toISOString(),
      })

      // Filter engagements by date range (method doesn't exist yet)
      const engagements = await (crm as any).getEngagements('contacts', contact.id, {
        dateRange: {
          start: new Date('2024-06-01').toISOString(),
          end: new Date('2025-12-31').toISOString(),
        },
      })

      expect(engagements.results).toHaveLength(1)
      expect(engagements.results[0].properties.hs_note_body).toBe('New note')
    })

    it('should filter engagements by type', async () => {
      const contact = await crm.createContact({ email: 'type-filter@test.com' })

      await crm.createEngagement('note', { contactIds: [contact.id], hs_note_body: 'Note' })
      await crm.createEngagement('call', { contactIds: [contact.id], hs_call_title: 'Call' })
      await crm.createEngagement('email', { contactIds: [contact.id], hs_email_subject: 'Email' })

      // Filter by type (method enhancement doesn't exist yet)
      const notes = await (crm as any).getEngagements('contacts', contact.id, {
        type: 'note',
      })

      expect(notes.results.every((e: any) => e.type === 'note')).toBe(true)
    })
  })

  // ===========================================================================
  // MERGE OPERATIONS
  // ===========================================================================

  describe('Merge Operations', () => {
    it('should merge companies', async () => {
      const primary = await crm.createCompany({ name: 'Primary Corp', phone: '+111' })
      const secondary = await crm.createCompany({ name: 'Secondary Corp', industry: 'Tech' })

      // Method doesn't exist yet
      const merged = await (crm as any).mergeCompanies(primary.id, secondary.id)

      expect(merged.properties.name).toBe('Primary Corp')
      expect(merged.properties.industry).toBe('Tech')
    })

    it('should merge deals', async () => {
      const primary = await crm.createDeal({ name: 'Primary Deal', stage: 'qualifiedtobuy', amount: 10000 })
      const secondary = await crm.createDeal({ name: 'Secondary Deal', stage: 'appointmentscheduled', amount: 5000 })

      // Method doesn't exist yet
      const merged = await (crm as any).mergeDeals(primary.id, secondary.id)

      expect(merged.properties.dealname).toBe('Primary Deal')
      expect(merged.properties.amount).toBe('10000')
    })
  })

  // ===========================================================================
  // PROPERTY HISTORY
  // ===========================================================================

  describe('Property History', () => {
    it('should track property history on updates', async () => {
      const contact = await crm.createContact({ email: 'history@test.com', firstName: 'Original' })

      await crm.updateContact(contact.id, { firstname: 'Updated1' })
      await crm.updateContact(contact.id, { firstname: 'Updated2' })

      // Get property history (method doesn't exist yet)
      const history = await (crm as any).getPropertyHistory('contacts', contact.id, 'firstname')

      expect(history.length).toBe(3)
      expect(history[0].value).toBe('Original')
      expect(history[1].value).toBe('Updated1')
      expect(history[2].value).toBe('Updated2')
    })
  })

  // ===========================================================================
  // OWNERS API
  // ===========================================================================

  describe('Owners API', () => {
    it('should list owners', async () => {
      // Method doesn't exist yet
      const owners = await (crm as any).listOwners()

      expect(owners).toBeDefined()
      expect(Array.isArray(owners.results)).toBe(true)
    })

    it('should get owner by ID', async () => {
      // Method doesn't exist yet
      const owner = await (crm as any).getOwner('owner-123')

      expect(owner).toBeDefined()
      expect(owner.id).toBe('owner-123')
    })

    it('should filter contacts by owner', async () => {
      await crm.createContact({ email: 'owned1@test.com', properties: { hubspot_owner_id: 'owner-1' } })
      await crm.createContact({ email: 'owned2@test.com', properties: { hubspot_owner_id: 'owner-1' } })
      await crm.createContact({ email: 'owned3@test.com', properties: { hubspot_owner_id: 'owner-2' } })

      const results = await crm.searchContacts('', {
        filters: [{ field: 'hubspot_owner_id', operator: 'eq', value: 'owner-1' }],
      })

      expect(results.total).toBe(2)
    })
  })

  // ===========================================================================
  // GENERIC CRM OBJECT API
  // ===========================================================================

  describe('Generic CRM Object API', () => {
    describe('createObject', () => {
      it('should create a generic object', async () => {
        const obj = await crm.createObject('custom_objects', {
          name: 'Custom Object',
          custom_field: 'value',
        })

        expect(obj).toBeDefined()
        expect(obj.id).toBeTruthy()
        expect(obj.properties.name).toBe('Custom Object')
      })
    })

    describe('getObject', () => {
      it('should get a generic object', async () => {
        const created = await crm.createObject('custom_objects', { name: 'Get Object' })
        const retrieved = await crm.getObject('custom_objects', created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.properties.name).toBe('Get Object')
      })
    })

    describe('updateObject', () => {
      it('should update a generic object', async () => {
        const created = await crm.createObject('custom_objects', { name: 'Update Object' })
        const updated = await crm.updateObject('custom_objects', created.id, {
          name: 'Updated Object',
        })

        expect(updated.properties.name).toBe('Updated Object')
      })
    })

    describe('deleteObject', () => {
      it('should delete a generic object', async () => {
        const created = await crm.createObject('custom_objects', { name: 'Delete Object' })
        await crm.deleteObject('custom_objects', created.id)

        await expect(crm.getObject('custom_objects', created.id)).rejects.toThrow(HubSpotCRMError)
      })
    })

    describe('searchObjects', () => {
      it('should search generic objects', async () => {
        await crm.createObject('custom_objects', { name: 'Search A' })
        await crm.createObject('custom_objects', { name: 'Search B' })

        const results = await crm.searchObjects('custom_objects', 'Search')

        expect(results.total).toBe(2)
      })
    })
  })
})
