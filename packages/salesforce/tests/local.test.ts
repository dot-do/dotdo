/**
 * @dotdo/salesforce - Local In-Memory Backend Tests
 *
 * Tests for the local Salesforce implementation that uses in-memory storage
 * for testing and edge deployment without a live Salesforce instance.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SalesforceLocal, type SalesforceLocalConfig } from '../src/local'

// =============================================================================
// Local Implementation Tests
// =============================================================================

describe('@dotdo/salesforce - Local Implementation', () => {
  let sf: SalesforceLocal

  beforeEach(() => {
    sf = new SalesforceLocal()
  })

  describe('initialization', () => {
    it('should create a SalesforceLocal instance', () => {
      expect(sf).toBeDefined()
      expect(sf.instanceUrl).toBe('https://local.salesforce.dotdo.dev')
    })

    it('should accept custom config', () => {
      const config: SalesforceLocalConfig = {
        instanceUrl: 'https://custom.salesforce.local',
        version: '58.0',
      }
      const customSf = new SalesforceLocal(config)
      expect(customSf.instanceUrl).toBe('https://custom.salesforce.local')
      expect(customSf.version).toBe('58.0')
    })
  })

  describe('SObject CRUD', () => {
    describe('create', () => {
      it('should create a single record with generated ID', async () => {
        const result = await sf.sobject('Account').create({
          Name: 'Acme Inc',
          Industry: 'Technology',
        })

        expect(result.success).toBe(true)
        expect(result.id).toBeDefined()
        expect(result.id.length).toBe(18)
        expect(result.errors).toHaveLength(0)
      })

      it('should create multiple records', async () => {
        const results = await sf.sobject('Account').create([
          { Name: 'Acme Inc' },
          { Name: 'Globex Corp' },
        ])

        expect(results).toHaveLength(2)
        expect(results[0].success).toBe(true)
        expect(results[1].success).toBe(true)
        expect(results[0].id).not.toBe(results[1].id)
      })

      it('should generate Salesforce-style 18-character IDs', async () => {
        const result = await sf.sobject('Account').create({ Name: 'Test' })

        // Salesforce IDs are 18 characters
        expect(result.id.length).toBe(18)
        // Should start with standard prefix (001 for Account)
        expect(result.id.startsWith('001')).toBe(true)
      })
    })

    describe('retrieve', () => {
      it('should retrieve a record by ID', async () => {
        const createResult = await sf.sobject('Account').create({
          Name: 'Acme Inc',
          Industry: 'Technology',
        })

        const account = await sf.sobject('Account').retrieve(createResult.id)

        expect(account.Id).toBe(createResult.id)
        expect(account.Name).toBe('Acme Inc')
        expect(account.Industry).toBe('Technology')
      })

      it('should retrieve multiple records', async () => {
        const result1 = await sf.sobject('Account').create({ Name: 'Account 1' })
        const result2 = await sf.sobject('Account').create({ Name: 'Account 2' })

        const accounts = await sf.sobject('Account').retrieve([result1.id, result2.id])

        expect(accounts).toHaveLength(2)
      })

      it('should throw error for non-existent record', async () => {
        await expect(
          sf.sobject('Account').retrieve('001000000000000000')
        ).rejects.toThrow()
      })
    })

    describe('update', () => {
      it('should update a single record', async () => {
        const createResult = await sf.sobject('Account').create({
          Name: 'Acme Inc',
        })

        const updateResult = await sf.sobject('Account').update({
          Id: createResult.id,
          Name: 'Acme Corporation',
          Website: 'https://acme.com',
        })

        expect(updateResult.success).toBe(true)

        const account = await sf.sobject('Account').retrieve(createResult.id)
        expect(account.Name).toBe('Acme Corporation')
        expect(account.Website).toBe('https://acme.com')
      })

      it('should update multiple records', async () => {
        const result1 = await sf.sobject('Account').create({ Name: 'Account 1' })
        const result2 = await sf.sobject('Account').create({ Name: 'Account 2' })

        const results = await sf.sobject('Account').update([
          { Id: result1.id, Website: 'https://account1.com' },
          { Id: result2.id, Website: 'https://account2.com' },
        ])

        expect(results).toHaveLength(2)
        expect(results[0].success).toBe(true)
        expect(results[1].success).toBe(true)
      })
    })

    describe('delete', () => {
      it('should delete a single record', async () => {
        const createResult = await sf.sobject('Account').create({ Name: 'Acme Inc' })

        const deleteResult = await sf.sobject('Account').destroy(createResult.id)

        expect(deleteResult.success).toBe(true)

        await expect(
          sf.sobject('Account').retrieve(createResult.id)
        ).rejects.toThrow()
      })

      it('should delete multiple records', async () => {
        const result1 = await sf.sobject('Account').create({ Name: 'Account 1' })
        const result2 = await sf.sobject('Account').create({ Name: 'Account 2' })

        const results = await sf.sobject('Account').destroy([result1.id, result2.id])

        expect(results).toHaveLength(2)
        expect(results[0].success).toBe(true)
        expect(results[1].success).toBe(true)
      })
    })

    describe('upsert', () => {
      it('should insert when record does not exist', async () => {
        const result = await sf.sobject('Account').upsert(
          { External_ID__c: 'EXT-001', Name: 'New Account' },
          'External_ID__c'
        )

        expect(result.success).toBe(true)
        expect(result.created).toBe(true)
      })

      it('should update when record exists', async () => {
        // First upsert (insert)
        await sf.sobject('Account').upsert(
          { External_ID__c: 'EXT-001', Name: 'Original Name' },
          'External_ID__c'
        )

        // Second upsert (update)
        const result = await sf.sobject('Account').upsert(
          { External_ID__c: 'EXT-001', Name: 'Updated Name' },
          'External_ID__c'
        )

        expect(result.success).toBe(true)
        expect(result.created).toBe(false)

        // Verify the update
        const queryResult = await sf.query("SELECT Id, Name FROM Account WHERE External_ID__c = 'EXT-001'")
        expect(queryResult.records[0].Name).toBe('Updated Name')
      })
    })
  })

  describe('SOQL Query', () => {
    beforeEach(async () => {
      // Seed test data
      await sf.sobject('Account').create([
        { Name: 'Acme Inc', Industry: 'Technology', Type: 'Customer' },
        { Name: 'Globex Corp', Industry: 'Manufacturing', Type: 'Partner' },
        { Name: 'TechCo', Industry: 'Technology', Type: 'Customer' },
      ])
    })

    it('should execute a basic query', async () => {
      const result = await sf.query('SELECT Id, Name FROM Account')

      expect(result.totalSize).toBe(3)
      expect(result.done).toBe(true)
      expect(result.records).toHaveLength(3)
    })

    it('should execute a query with WHERE clause', async () => {
      const result = await sf.query("SELECT Id, Name FROM Account WHERE Industry = 'Technology'")

      expect(result.totalSize).toBe(2)
      expect(result.records).toHaveLength(2)
      expect(result.records.every((r) => r.Industry === 'Technology' || !r.Industry)).toBe(true)
    })

    it('should execute a query with ORDER BY', async () => {
      const result = await sf.query('SELECT Id, Name FROM Account ORDER BY Name ASC')

      expect(result.records[0].Name).toBe('Acme Inc')
      expect(result.records[1].Name).toBe('Globex Corp')
      expect(result.records[2].Name).toBe('TechCo')
    })

    it('should execute a query with LIMIT', async () => {
      const result = await sf.query('SELECT Id, Name FROM Account LIMIT 2')

      expect(result.totalSize).toBe(2)
      expect(result.records).toHaveLength(2)
    })

    it('should execute a query with OFFSET', async () => {
      const result = await sf.query('SELECT Id, Name FROM Account ORDER BY Name ASC LIMIT 2 OFFSET 1')

      expect(result.records).toHaveLength(2)
      expect(result.records[0].Name).toBe('Globex Corp')
    })

    it('should support query builder API', async () => {
      const result = await sf
        .sobject('Account')
        .find({ Industry: 'Technology' })
        .select(['Id', 'Name', 'Industry'])
        .limit(10)
        .execute()

      expect(result.totalSize).toBe(2)
    })
  })

  describe('ID Generation', () => {
    it('should generate unique IDs for different object types', async () => {
      const account = await sf.sobject('Account').create({ Name: 'Test Account' })
      const contact = await sf.sobject('Contact').create({ LastName: 'Doe' })
      const opportunity = await sf.sobject('Opportunity').create({ Name: 'Deal', StageName: 'New' })

      // Different prefixes for different object types
      expect(account.id.substring(0, 3)).toBe('001') // Account
      expect(contact.id.substring(0, 3)).toBe('003') // Contact
      expect(opportunity.id.substring(0, 3)).toBe('006') // Opportunity
    })

    it('should handle custom objects', async () => {
      const result = await sf.sobject('Custom__c').create({ Name: 'Custom Record' })

      // Custom objects get 'a0' prefix
      expect(result.id.substring(0, 2)).toBe('a0')
    })
  })

  describe('Cross-Object Queries', () => {
    it('should support relationship queries', async () => {
      const accountResult = await sf.sobject('Account').create({ Name: 'Acme Inc' })

      await sf.sobject('Contact').create({
        FirstName: 'John',
        LastName: 'Doe',
        AccountId: accountResult.id,
      })

      const result = await sf.query(`SELECT Id, LastName, Account.Name FROM Contact WHERE AccountId = '${accountResult.id}'`)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].LastName).toBe('Doe')
    })
  })

  describe('Limits', () => {
    it('should return mock organization limits', async () => {
      const limits = await sf.limits()

      expect(limits.DailyApiRequests).toBeDefined()
      expect(limits.DailyApiRequests.Max).toBeGreaterThan(0)
      expect(limits.DailyApiRequests.Remaining).toBeGreaterThan(0)
    })
  })

  describe('Describe', () => {
    it('should describe global objects', async () => {
      const result = await sf.describeGlobal()

      expect(result.encoding).toBe('UTF-8')
      expect(result.sobjects).toBeDefined()
      expect(result.sobjects.length).toBeGreaterThan(0)
    })

    it('should describe a specific object', async () => {
      const result = await sf.sobject('Account').describe()

      expect(result.name).toBe('Account')
      expect(result.label).toBe('Account')
      expect(result.fields).toBeDefined()
      expect(result.fields.length).toBeGreaterThan(0)
    })
  })
})
