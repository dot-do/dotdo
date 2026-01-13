/**
 * DBPromise Tests
 *
 * Tests for the fluent query builder interface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DBPromise, NotImplementedError, type DBPromiseDataSource, type RelationshipDefinition } from '../DBPromise'
import type { ThingEntity } from '../../stores'

// ============================================================================
// TEST DATA
// ============================================================================

const mockLeads: ThingEntity[] = [
  { $id: 'lead-1', $type: 'Lead', name: 'Alice', data: { status: 'active', score: 85 } },
  { $id: 'lead-2', $type: 'Lead', name: 'Bob', data: { status: 'inactive', score: 42 } },
  { $id: 'lead-3', $type: 'Lead', name: 'Charlie', data: { status: 'active', score: 95 } },
  { $id: 'lead-4', $type: 'Lead', name: 'Diana', data: { status: 'pending', score: 70 } },
  { $id: 'lead-5', $type: 'Lead', name: 'Eve', data: { status: 'active', score: 60 } },
]

function createMockDataSource(data: ThingEntity[] = mockLeads): DBPromiseDataSource {
  return {
    fetchAll: vi.fn().mockResolvedValue(data),
    fetchPage: vi.fn().mockImplementation(async (opts) => {
      const start = opts.offset ?? 0
      return data.slice(start, start + opts.limit)
    }),
    count: vi.fn().mockResolvedValue(data.length),
    getEntityType: vi.fn().mockReturnValue('Lead'),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('DBPromise', () => {
  let dataSource: DBPromiseDataSource

  beforeEach(() => {
    dataSource = createMockDataSource()
  })

  describe('Promise interface', () => {
    it('should be thenable', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise
      expect(results).toEqual(mockLeads)
    })

    it('should support .then()', async () => {
      const promise = new DBPromise(dataSource)
      const names = await promise.then((results) => results.map((r) => r.name))
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'])
    })

    it('should support .catch()', async () => {
      const failingSource: DBPromiseDataSource = {
        ...dataSource,
        fetchAll: vi.fn().mockRejectedValue(new Error('Test error')),
      }
      const promise = new DBPromise(failingSource)
      const error = await promise.catch((e) => e)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Test error')
    })

    it('should support .finally()', async () => {
      const promise = new DBPromise(dataSource)
      let finallyCalled = false
      await promise.finally(() => {
        finallyCalled = true
      })
      expect(finallyCalled).toBe(true)
    })
  })

  describe('filter()', () => {
    it('should filter results by predicate', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.filter(
        (item) => (item.data as Record<string, unknown>)?.status === 'active'
      )
      expect(results).toHaveLength(3)
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Charlie', 'Eve'])
    })

    it('should chain multiple filters', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise
        .filter((item) => (item.data as Record<string, unknown>)?.status === 'active')
        .filter((item) => ((item.data as Record<string, unknown>)?.score as number) > 80)
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Charlie'])
    })
  })

  describe('where()', () => {
    it('should filter by field equality', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.where('name' as keyof ThingEntity, 'Alice' as never)
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })
  })

  describe('whereOp()', () => {
    it('should support gt operator', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.whereOp('score' as keyof ThingEntity, 'gt', 80)
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Charlie'])
    })

    it('should support in operator', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.whereOp('status' as keyof ThingEntity, 'in', ['active', 'pending'])
      expect(results).toHaveLength(4)
    })

    it('should support contains operator', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.whereOp('name' as keyof ThingEntity, 'contains', 'li')
      expect(results).toHaveLength(2) // Alice, Charlie
    })

    it('should support startsWith operator', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.whereOp('name' as keyof ThingEntity, 'startsWith', 'A')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })
  })

  describe('map()', () => {
    it('should transform results', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.map((item) => ({
        ...item,
        name: item.name?.toUpperCase(),
      }))
      expect(results[0].name).toBe('ALICE')
    })
  })

  describe('sort()', () => {
    it('should sort by comparator function', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.sort((a, b) => {
        const scoreA = (a.data as Record<string, unknown>)?.score as number
        const scoreB = (b.data as Record<string, unknown>)?.score as number
        return scoreB - scoreA
      })
      expect(results.map((r) => r.name)).toEqual(['Charlie', 'Alice', 'Diana', 'Eve', 'Bob'])
    })
  })

  describe('orderBy()', () => {
    it('should sort by field ascending', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.orderBy('name' as keyof ThingEntity, 'asc')
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'])
    })

    it('should sort by field descending', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.orderBy('name' as keyof ThingEntity, 'desc')
      expect(results.map((r) => r.name)).toEqual(['Eve', 'Diana', 'Charlie', 'Bob', 'Alice'])
    })
  })

  describe('limit()', () => {
    it('should limit results', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.limit(2)
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    })
  })

  describe('offset()', () => {
    it('should skip results', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.offset(2)
      expect(results).toHaveLength(3)
      expect(results.map((r) => r.name)).toEqual(['Charlie', 'Diana', 'Eve'])
    })
  })

  describe('pagination', () => {
    it('should combine offset and limit', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.offset(1).limit(2)
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name)).toEqual(['Bob', 'Charlie'])
    })

    it('should support cursor-based pagination with after()', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise.after('lead-2').limit(2)
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.$id)).toEqual(['lead-3', 'lead-4'])
    })
  })

  describe('aggregation', () => {
    it('should count results', async () => {
      const promise = new DBPromise(dataSource)
      const count = await promise
        .filter((item) => (item.data as Record<string, unknown>)?.status === 'active')
        .count()
      expect(count).toBe(3)
    })

    it('should get first result', async () => {
      const promise = new DBPromise(dataSource)
      const first = await promise.first()
      expect(first?.name).toBe('Alice')
    })

    it('should return null for empty first()', async () => {
      const emptySource = createMockDataSource([])
      const promise = new DBPromise(emptySource)
      const first = await promise.first()
      expect(first).toBeNull()
    })

    it('should check existence with exists()', async () => {
      const promise = new DBPromise(dataSource)
      const exists = await promise
        .filter((item) => (item.data as Record<string, unknown>)?.status === 'active')
        .exists()
      expect(exists).toBe(true)
    })

    it('should return false for empty exists()', async () => {
      const promise = new DBPromise(dataSource)
      const exists = await promise
        .filter(() => false)
        .exists()
      expect(exists).toBe(false)
    })
  })

  describe('chaining', () => {
    it('should chain multiple operations', async () => {
      const promise = new DBPromise(dataSource)
      const results = await promise
        .filter((item) => (item.data as Record<string, unknown>)?.status === 'active')
        .sort((a, b) => {
          const scoreA = (a.data as Record<string, unknown>)?.score as number
          const scoreB = (b.data as Record<string, unknown>)?.score as number
          return scoreB - scoreA
        })
        .limit(2)

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name)).toEqual(['Charlie', 'Alice'])
    })

    it('should be immutable (each chain returns new promise)', async () => {
      const base = new DBPromise(dataSource)
      const filtered = base.filter((item) => (item.data as Record<string, unknown>)?.status === 'active')
      const limited = filtered.limit(1)

      const baseResults = await base
      const filteredResults = await filtered
      const limitedResults = await limited

      expect(baseResults).toHaveLength(5)
      expect(filteredResults).toHaveLength(3)
      expect(limitedResults).toHaveLength(1)
    })
  })

  describe('forEach()', () => {
    it('should process all items', async () => {
      const promise = new DBPromise(dataSource)
      const processed: string[] = []

      const result = await promise.forEach(async (item) => {
        processed.push(item.$id)
      })

      expect(processed).toEqual(['lead-1', 'lead-2', 'lead-3', 'lead-4', 'lead-5'])
      expect(result.completed).toBe(5)
      expect(result.failed).toBe(0)
    })

    it('should respect concurrency limit', async () => {
      const promise = new DBPromise(dataSource)
      const inFlight: number[] = []
      let maxConcurrent = 0

      await promise.forEach(
        async () => {
          inFlight.push(1)
          maxConcurrent = Math.max(maxConcurrent, inFlight.length)
          await new Promise((r) => setTimeout(r, 10))
          inFlight.pop()
        },
        { concurrency: 2 }
      )

      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('should retry failed items', async () => {
      const promise = new DBPromise(dataSource)
      let attempts = 0

      const result = await promise.limit(1).forEach(
        async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
        },
        { maxRetries: 3, retryDelay: 1 }
      )

      expect(attempts).toBe(3)
      expect(result.completed).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('should skip items on error when handler returns skip', async () => {
      const promise = new DBPromise(dataSource)
      let processed = 0

      const result = await promise.forEach(
        async (item) => {
          if (item.name === 'Bob') {
            throw new Error('Skip Bob')
          }
          processed++
        },
        {
          onError: () => 'skip',
          maxRetries: 1,
        }
      )

      expect(processed).toBe(4)
      expect(result.completed).toBe(4)
      expect(result.skipped).toBe(1)
    })

    it('should abort on error when handler returns abort', async () => {
      const promise = new DBPromise(dataSource)
      let processed = 0

      await expect(
        promise.forEach(
          async (item) => {
            if (item.name === 'Charlie') {
              throw new Error('Abort')
            }
            processed++
          },
          {
            onError: () => 'abort',
            maxRetries: 1,
          }
        )
      ).rejects.toThrow('Abort')

      expect(processed).toBeLessThan(5)
    })

    it('should report progress', async () => {
      const promise = new DBPromise(dataSource)
      const progressUpdates: number[] = []

      await promise.forEach(
        async () => {
          await new Promise((r) => setTimeout(r, 1))
        },
        {
          onProgress: (p) => progressUpdates.push(p.completed),
        }
      )

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(5)
    })

    it('should include run ID for resumption', async () => {
      const promise = new DBPromise(dataSource)

      const result = await promise.forEach(async () => {})

      expect(result.runId).toBeDefined()
      expect(result.runId.length).toBeGreaterThan(0)
    })

    it('should track errors in result', async () => {
      const promise = new DBPromise(dataSource)

      const result = await promise.forEach(
        async (item) => {
          if (item.name === 'Bob') {
            throw new Error('Bob failed')
          }
        },
        { maxRetries: 2, retryDelay: 1 }
      )

      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].item).toBe('lead-2')
      expect(result.errors[0].error).toBe('Bob failed')
      expect(result.errors[0].attempts).toBe(2)
    })
  })

  describe('expand()', () => {
    // Test data for expand tests
    const companyData: ThingEntity[] = [
      { $id: 'company-1', $type: 'Company', name: 'Acme Corp', data: { industry: 'Tech' } },
      { $id: 'company-2', $type: 'Company', name: 'Beta Inc', data: { industry: 'Finance' } },
    ]

    const contactData: ThingEntity[] = [
      { $id: 'contact-1', $type: 'Contact', name: 'John Doe', data: { email: 'john@acme.com', leadId: 'lead-1' } },
      { $id: 'contact-2', $type: 'Contact', name: 'Jane Smith', data: { email: 'jane@acme.com', leadId: 'lead-1' } },
      { $id: 'contact-3', $type: 'Contact', name: 'Bob Wilson', data: { email: 'bob@beta.com', leadId: 'lead-2' } },
    ]

    const employeeData: ThingEntity[] = [
      { $id: 'employee-1', $type: 'Employee', name: 'Alice', data: { companyId: 'company-1', role: 'Engineer' } },
      { $id: 'employee-2', $type: 'Employee', name: 'Charlie', data: { companyId: 'company-1', role: 'Designer' } },
    ]

    // Data source with expand support
    const leadDataWithRelations = [
      { $id: 'lead-1', $type: 'Lead', name: 'Alice', data: { score: 100, companyId: 'company-1' } },
      { $id: 'lead-2', $type: 'Lead', name: 'Bob', data: { score: 50, companyId: 'company-2' } },
    ]

    const expandableDataSource: DBPromiseDataSource = {
      fetchAll: async () => leadDataWithRelations,
      fetchPage: async () => leadDataWithRelations,
      count: async () => leadDataWithRelations.length,
      getEntityType: () => 'Lead',
      getRelationships: () => {
        const map = new Map<string, RelationshipDefinition>()
        map.set('company', {
          name: 'company',
          targetType: 'Company',
          cardinality: 'one',
          foreignKey: 'companyId',
        })
        map.set('contacts', {
          name: 'contacts',
          targetType: 'Contact',
          cardinality: 'many',
          foreignKey: 'leadId',
        })
        return map
      },
      resolveRelationship: async (item, relationName, visited) => {
        const data = item.data as Record<string, unknown>

        if (relationName === 'company') {
          const companyId = data?.companyId as string
          const company = companyData.find((c) => c.$id === companyId)
          if (!company) return null

          // Check for circular reference
          if (visited?.has(company.$id)) {
            return null
          }

          return company
        }

        if (relationName === 'contacts') {
          const contacts = contactData.filter(
            (c) => (c.data as Record<string, unknown>)?.leadId === item.$id
          )
          // Filter out any already visited (circular) contacts
          return contacts.filter((c) => !visited?.has(c.$id))
        }

        if (relationName === 'employees') {
          // This is for nested expansion on Company
          const employees = employeeData.filter(
            (e) => (e.data as Record<string, unknown>)?.companyId === item.$id
          )
          return employees.filter((e) => !visited?.has(e.$id))
        }

        return null
      },
    }

    it('should return same promise when no relations provided', () => {
      const promise = new DBPromise(dataSource)
      const expanded = promise.expand()

      // Should be the same instance when no relations
      expect(expanded).toBe(promise)
    })

    it('should throw NotImplementedError when data source lacks resolveRelationship', async () => {
      const promise = new DBPromise(dataSource).expand('company')

      await expect(promise).rejects.toThrow(NotImplementedError)
    })

    it('should expand a single relationship', async () => {
      const promise = new DBPromise(expandableDataSource)
      const results = await promise.expand('company')

      expect(results).toHaveLength(2)

      const alice = results.find((r) => r.name === 'Alice')
      expect(alice?.data).toHaveProperty('company')
      expect((alice?.data as Record<string, unknown>)?.company).toEqual(companyData[0])

      const bob = results.find((r) => r.name === 'Bob')
      expect(bob?.data).toHaveProperty('company')
      expect((bob?.data as Record<string, unknown>)?.company).toEqual(companyData[1])
    })

    it('should expand multiple relationships', async () => {
      const promise = new DBPromise(expandableDataSource)
      const results = await promise.expand('company', 'contacts')

      expect(results).toHaveLength(2)

      const alice = results.find((r) => r.name === 'Alice')
      expect((alice?.data as Record<string, unknown>)?.company).toEqual(companyData[0])
      const aliceContacts = (alice?.data as Record<string, unknown>)?.contacts as ThingEntity[]
      expect(aliceContacts).toHaveLength(2)
      expect(aliceContacts.map((c) => c.name)).toContain('John Doe')
      expect(aliceContacts.map((c) => c.name)).toContain('Jane Smith')

      const bob = results.find((r) => r.name === 'Bob')
      expect((bob?.data as Record<string, unknown>)?.company).toEqual(companyData[1])
      const bobContacts = (bob?.data as Record<string, unknown>)?.contacts as ThingEntity[]
      expect(bobContacts).toHaveLength(1)
      expect(bobContacts[0].name).toBe('Bob Wilson')
    })

    it('should handle missing relationships gracefully', async () => {
      const dataSourceWithMissingRel: DBPromiseDataSource = {
        ...expandableDataSource,
        fetchAll: async () => [
          { $id: 'lead-3', $type: 'Lead', name: 'Charlie', data: { score: 75, companyId: 'company-999' } },
        ],
      }

      const promise = new DBPromise(dataSourceWithMissingRel)
      const results = await promise.expand('company')

      expect(results).toHaveLength(1)
      expect((results[0].data as Record<string, unknown>)?.company).toBeNull()
    })

    it('should support nested expansion via dot notation', async () => {
      // Create a data source that supports company.employees expansion
      const nestedDataSource: DBPromiseDataSource = {
        ...expandableDataSource,
        resolveRelationship: async (item, relationName, visited) => {
          const data = item.data as Record<string, unknown>

          if (relationName === 'company') {
            const companyId = data?.companyId as string
            const company = companyData.find((c) => c.$id === companyId)
            if (!company || visited?.has(company.$id)) return null
            return company
          }

          if (relationName === 'employees') {
            // Nested expansion on Company
            const employees = employeeData.filter(
              (e) => (e.data as Record<string, unknown>)?.companyId === item.$id
            )
            return employees.filter((e) => !visited?.has(e.$id))
          }

          return null
        },
      }

      const promise = new DBPromise(nestedDataSource)
      const results = await promise.expand('company.employees')

      expect(results).toHaveLength(2)

      const alice = results.find((r) => r.name === 'Alice')
      const aliceCompany = (alice?.data as Record<string, unknown>)?.company as ThingEntity
      expect(aliceCompany).toBeDefined()
      expect(aliceCompany.name).toBe('Acme Corp')

      // Check nested employees
      const employees = (aliceCompany.data as Record<string, unknown>)?.employees as ThingEntity[]
      expect(employees).toHaveLength(2)
      expect(employees.map((e) => e.name)).toContain('Alice')
      expect(employees.map((e) => e.name)).toContain('Charlie')
    })

    it('should detect and handle circular references', async () => {
      // Create data with circular reference: Lead -> Company -> Lead
      const circularCompanyData: ThingEntity[] = [
        { $id: 'company-c1', $type: 'Company', name: 'Circular Corp', data: { leadId: 'lead-c1' } },
      ]

      const circularLeadData: ThingEntity[] = [
        { $id: 'lead-c1', $type: 'Lead', name: 'Circular Lead', data: { companyId: 'company-c1' } },
      ]

      const circularDataSource: DBPromiseDataSource = {
        fetchAll: async () => circularLeadData,
        fetchPage: async () => circularLeadData,
        count: async () => 1,
        getEntityType: () => 'Lead',
        resolveRelationship: async (item, relationName, visited) => {
          const data = item.data as Record<string, unknown>

          if (relationName === 'company') {
            const companyId = data?.companyId as string
            const company = circularCompanyData.find((c) => c.$id === companyId)
            if (!company || visited?.has(company.$id)) return null
            return company
          }

          if (relationName === 'lead') {
            // This creates the circular reference
            const leadId = data?.leadId as string
            const lead = circularLeadData.find((l) => l.$id === leadId)
            if (!lead || visited?.has(lead.$id)) return null
            return lead
          }

          return null
        },
      }

      const promise = new DBPromise(circularDataSource)
      // Try to expand company.lead - this would be circular
      const results = await promise.expand('company.lead')

      expect(results).toHaveLength(1)

      const lead = results[0]
      const company = (lead.data as Record<string, unknown>)?.company as ThingEntity
      expect(company).toBeDefined()
      expect(company.name).toBe('Circular Corp')

      // The nested lead should be null due to circular reference detection
      expect((company.data as Record<string, unknown>)?.lead).toBeNull()
    })

    it('should work with filter and other operations', async () => {
      const promise = new DBPromise(expandableDataSource)
      const results = await promise
        .filter((item) => {
          const data = item.data as Record<string, unknown>
          return (data?.score as number) > 60
        })
        .expand('company')

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
      expect((results[0].data as Record<string, unknown>)?.company).toEqual(companyData[0])
    })

    it('should preserve original data fields after expansion', async () => {
      const promise = new DBPromise(expandableDataSource)
      const results = await promise.expand('company')

      const alice = results.find((r) => r.name === 'Alice')
      expect(alice?.data).toHaveProperty('score', 100)
      expect(alice?.data).toHaveProperty('companyId', 'company-1')
      expect(alice?.data).toHaveProperty('company')
    })

    it('should chain multiple expand calls', async () => {
      const promise = new DBPromise(expandableDataSource)
      const results = await promise
        .expand('company')
        .expand('contacts')

      const alice = results.find((r) => r.name === 'Alice')
      expect((alice?.data as Record<string, unknown>)?.company).toBeDefined()
      expect((alice?.data as Record<string, unknown>)?.contacts).toBeDefined()
    })
  })
})
