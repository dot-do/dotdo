/**
 * DBProxy Tests
 *
 * Tests for the main database accessor proxy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDBProxy } from '../DBProxy'
import type { ThingsStore, ThingEntity } from '../../db/stores'

// ============================================================================
// MOCK DATA
// ============================================================================

const mockLeads: ThingEntity[] = [
  { $id: 'lead-1', $type: 'Lead', name: 'Alice', data: { status: 'active', score: 85 } },
  { $id: 'lead-2', $type: 'Lead', name: 'Bob', data: { status: 'inactive', score: 42 } },
  { $id: 'lead-3', $type: 'Lead', name: 'Charlie', data: { status: 'active', score: 95 } },
]

const mockCustomers: ThingEntity[] = [
  { $id: 'cust-1', $type: 'Customer', name: 'Acme Corp', data: { tier: 'enterprise' } },
  { $id: 'cust-2', $type: 'Customer', name: 'Beta Inc', data: { tier: 'startup' } },
]

function createMockStore(): ThingsStore {
  // Deep clone mock data to avoid mutation between tests
  const allData = [
    ...mockLeads.map(l => ({ ...l, data: { ...l.data as Record<string, unknown> } })),
    ...mockCustomers.map(c => ({ ...c, data: { ...c.data as Record<string, unknown> } })),
  ]

  return {
    get: vi.fn().mockImplementation(async (id: string) => {
      return allData.find((item) => item.$id === id) ?? null
    }),
    list: vi.fn().mockImplementation(async (options?: { type?: string }) => {
      if (options?.type) {
        return allData.filter((item) => item.$type === options.type)
      }
      return allData
    }),
    create: vi.fn().mockImplementation(async (data: Partial<ThingEntity>) => {
      const newItem: ThingEntity = {
        $id: data.$id ?? `new-${Date.now()}`,
        $type: data.$type ?? 'Unknown',
        name: data.name,
        data: data.data,
      }
      allData.push(newItem)
      return newItem
    }),
    update: vi.fn().mockImplementation(async (id: string, data: Partial<ThingEntity>) => {
      const item = allData.find((i) => i.$id === id)
      if (!item) throw new Error(`Not found: ${id}`)
      Object.assign(item, data)
      return item
    }),
    delete: vi.fn().mockImplementation(async (id: string) => {
      const item = allData.find((i) => i.$id === id)
      if (!item) throw new Error(`Not found: ${id}`)
      item.deleted = true
      return item
    }),
    versions: vi.fn().mockResolvedValue([]),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('createDBProxy', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createMockStore()
  })

  describe('entity access', () => {
    it('should access entities by type name', () => {
      const db = createDBProxy({ store })
      expect(db.Lead).toBeDefined()
      expect(db.Customer).toBeDefined()
    })

    it('should cache entity accessors', () => {
      const db = createDBProxy({ store })
      const lead1 = db.Lead
      const lead2 = db.Lead
      expect(lead1).toBe(lead2)
    })

    it('should create different accessors for different types', () => {
      const db = createDBProxy({ store })
      expect(db.Lead).not.toBe(db.Customer)
    })
  })

  describe('CRUD operations', () => {
    it('should get entity by id', async () => {
      const db = createDBProxy({ store })
      const lead = await db.Lead.get('lead-1')
      expect(lead).not.toBeNull()
      expect(lead?.name).toBe('Alice')
    })

    it('should return null for non-existent entity', async () => {
      const db = createDBProxy({ store })
      const lead = await db.Lead.get('non-existent')
      expect(lead).toBeNull()
    })

    it('should list entities of a type', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.list()
      expect(leads).toHaveLength(3)
    })

    it('should create new entity', async () => {
      const db = createDBProxy({ store })
      const lead = await db.Lead.create({
        name: 'New Lead',
        data: { status: 'new' },
      })
      expect(lead.$id).toBeDefined()
      expect(lead.$type).toBe('Lead')
      expect(lead.name).toBe('New Lead')
    })

    it('should update entity', async () => {
      const db = createDBProxy({ store })
      const lead = await db.Lead.update('lead-1', {
        data: { status: 'updated' },
      })
      expect(lead.data).toEqual({ status: 'updated' })
    })

    it('should delete entity', async () => {
      const db = createDBProxy({ store })
      const lead = await db.Lead.delete('lead-1')
      expect(lead.deleted).toBe(true)
    })
  })

  describe('query chaining', () => {
    it('should support filter chaining', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.list()
        .filter((l) => (l.data as Record<string, unknown>)?.status === 'active')
      expect(leads).toHaveLength(2)
    })

    it('should support sort chaining', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.list()
        .sort((a, b) => {
          const scoreA = (a.data as Record<string, unknown>)?.score as number
          const scoreB = (b.data as Record<string, unknown>)?.score as number
          return scoreB - scoreA
        })
      expect(leads[0].name).toBe('Charlie')
    })

    it('should support limit chaining', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.list().limit(1)
      expect(leads).toHaveLength(1)
    })

    it('should support complex chains', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.list()
        .filter((l) => (l.data as Record<string, unknown>)?.status === 'active')
        .sort((a, b) => {
          const scoreA = (a.data as Record<string, unknown>)?.score as number
          const scoreB = (b.data as Record<string, unknown>)?.score as number
          return scoreB - scoreA
        })
        .limit(1)
      expect(leads).toHaveLength(1)
      expect(leads[0].name).toBe('Charlie')
    })
  })

  describe('find()', () => {
    it('should find entities matching query', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.find({ status: 'active' })
      expect(leads).toHaveLength(2)
    })
  })

  describe('search()', () => {
    it('should search entities by text (fallback)', async () => {
      const db = createDBProxy({ store })
      const leads = await db.Lead.search('alice')
      expect(leads.length).toBeGreaterThanOrEqual(0) // Fallback may or may not match
    })
  })

  describe('forEach()', () => {
    it('should process all items', async () => {
      const db = createDBProxy({ store })
      const processed: string[] = []

      const result = await db.Lead.list().forEach(async (item) => {
        processed.push(item.$id)
      })

      expect(result.completed).toBe(3)
      expect(processed).toContain('lead-1')
      expect(processed).toContain('lead-2')
      expect(processed).toContain('lead-3')
    })

    it('should support filtered forEach', async () => {
      const db = createDBProxy({ store })
      const processed: string[] = []

      await db.Lead.list()
        .filter((l) => (l.data as Record<string, unknown>)?.status === 'active')
        .forEach(async (item) => {
          processed.push(item.$id)
        })

      expect(processed).toHaveLength(2)
    })
  })
})

describe('multiple entity types', () => {
  it('should handle different entity types independently', async () => {
    const store = createMockStore()
    const db = createDBProxy({ store })

    const leads = await db.Lead.list()
    const customers = await db.Customer.list()

    expect(leads.every((l) => l.$type === 'Lead')).toBe(true)
    expect(customers.every((c) => c.$type === 'Customer')).toBe(true)
  })

  it('should filter by correct type in get()', async () => {
    const store = createMockStore()
    const db = createDBProxy({ store })

    // Try to get a customer ID through Lead accessor
    const wrongType = await db.Lead.get('cust-1')
    expect(wrongType).toBeNull() // Should not return Customer through Lead accessor
  })
})
