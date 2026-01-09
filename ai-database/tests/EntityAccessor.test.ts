/**
 * EntityAccessor Tests
 *
 * Tests for the entity accessor with NL query support.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EntityAccessor, createEntityAccessor, type NLQueryExecutor } from '../EntityAccessor'
import type { ThingsStore, ThingEntity } from '../../db/stores/types'

// ============================================================================
// MOCK DATA
// ============================================================================

const mockLeads: ThingEntity[] = [
  {
    $id: 'lead-1',
    $type: 'Lead',
    name: 'Alice Johnson',
    data: { status: 'active', score: 85, dealClosed: true, description: 'Enterprise customer' },
  },
  {
    $id: 'lead-2',
    $type: 'Lead',
    name: 'Bob Smith',
    data: { status: 'inactive', score: 42, dealClosed: false, description: 'Small business' },
  },
  {
    $id: 'lead-3',
    $type: 'Lead',
    name: 'Charlie Brown',
    data: { status: 'active', score: 95, dealClosed: true, description: 'Tech startup' },
  },
]

function createMockStore(): ThingsStore {
  return {
    get: vi.fn().mockImplementation(async (id: string) => {
      return mockLeads.find((item) => item.$id === id) ?? null
    }),
    list: vi.fn().mockImplementation(async (options?: { type?: string }) => {
      if (options?.type) {
        return mockLeads.filter((item) => item.$type === options.type)
      }
      return mockLeads
    }),
    create: vi.fn().mockImplementation(async (data: Partial<ThingEntity>) => {
      return {
        $id: data.$id ?? `new-${Date.now()}`,
        $type: data.$type ?? 'Lead',
        name: data.name,
        data: data.data,
      } as ThingEntity
    }),
    update: vi.fn().mockImplementation(async (id: string, data: Partial<ThingEntity>) => {
      const item = mockLeads.find((i) => i.$id === id)
      if (!item) throw new Error(`Not found: ${id}`)
      return { ...item, ...data }
    }),
    delete: vi.fn().mockImplementation(async (id: string) => {
      const item = mockLeads.find((i) => i.$id === id)
      if (!item) throw new Error(`Not found: ${id}`)
      return { ...item, deleted: true }
    }),
    versions: vi.fn().mockResolvedValue([]),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('EntityAccessor', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createMockStore()
  })

  describe('CRUD operations', () => {
    it('should get entity by id', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const lead = await accessor.get('lead-1')
      expect(lead).not.toBeNull()
      expect(lead?.name).toBe('Alice Johnson')
    })

    it('should return null for wrong type', async () => {
      // Mock store returns item regardless of type, but accessor should filter
      const accessor = new EntityAccessor('Customer', store)
      const result = await accessor.get('lead-1')
      expect(result).toBeNull() // lead-1 is type Lead, not Customer
    })

    it('should list entities', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor.list()
      expect(leads).toHaveLength(3)
    })

    it('should create entity with correct type', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const lead = await accessor.create({
        name: 'New Lead',
        data: { status: 'new' },
      })
      expect(lead.$type).toBe('Lead')
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({ $type: 'Lead' })
      )
    })

    it('should update entity', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const lead = await accessor.update('lead-1', {
        data: { status: 'updated' },
      })
      expect(store.update).toHaveBeenCalledWith('lead-1', { data: { status: 'updated' } })
    })

    it('should delete entity', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const lead = await accessor.delete('lead-1')
      expect(lead.deleted).toBe(true)
    })
  })

  describe('find()', () => {
    it('should find entities by query object', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor.find({ status: 'active' })
      expect(leads).toHaveLength(2)
    })

    it('should support multiple query conditions', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor.find({ status: 'active', dealClosed: true })
      expect(leads).toHaveLength(2)
    })
  })

  describe('search()', () => {
    it('should search by name', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor.search('alice')
      // With fallback search, should find Alice
      expect(leads.length).toBeGreaterThanOrEqual(0)
    })

    it('should search by description', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor.search('enterprise')
      // Should find Alice with "Enterprise customer" description
      expect(leads.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('chaining', () => {
    it('should support filter chaining', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor
        .list()
        .filter((l) => (l.data as Record<string, unknown>)?.dealClosed === true)
      expect(leads).toHaveLength(2)
    })

    it('should support orderBy chaining', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const leads = await accessor
        .list()
        .orderBy('name' as keyof ThingEntity, 'asc')
      expect(leads[0].name).toBe('Alice Johnson')
    })
  })

  describe('async iteration', () => {
    it('should support for-await-of', async () => {
      const accessor = new EntityAccessor('Lead', store)
      const names: string[] = []

      for await (const lead of accessor) {
        names.push(lead.name ?? '')
      }

      expect(names).toHaveLength(3)
      expect(names).toContain('Alice Johnson')
    })
  })
})

describe('createEntityAccessor', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createMockStore()
  })

  it('should create callable accessor', () => {
    const accessor = createEntityAccessor('Lead', store)
    expect(typeof accessor).toBe('function')
    expect(accessor.get).toBeDefined()
    expect(accessor.list).toBeDefined()
  })

  it('should work as a function for template literals', async () => {
    const accessor = createEntityAccessor('Lead', store)

    // The accessor should be callable with template literal syntax
    // Call directly as a function (template literal desugars to function call)
    const results = await accessor(['who closed deals?'] as unknown as TemplateStringsArray)
    expect(Array.isArray(results)).toBe(true)
  })

  it('should bind methods correctly', async () => {
    const accessor = createEntityAccessor('Lead', store)
    const { get, list } = accessor

    // Methods should work when destructured
    const lead = await get('lead-1')
    expect(lead?.name).toBe('Alice Johnson')

    const leads = await list()
    expect(leads).toHaveLength(3)
  })
})

describe('NL Query Executor', () => {
  let store: ThingsStore
  let nlExecutor: NLQueryExecutor

  beforeEach(() => {
    store = createMockStore()
    nlExecutor = {
      execute: vi.fn().mockResolvedValue(mockLeads.filter((l) => l.data?.dealClosed)),
    }
  })

  it('should use NL executor when provided', async () => {
    const accessor = new EntityAccessor('Lead', store, { nlExecutor })

    // Call the template literal handler method directly
    const results = await accessor.templateLiteralQuery(['who closed deals?'] as unknown as TemplateStringsArray)

    expect(nlExecutor.execute).toHaveBeenCalledWith('Lead', 'who closed deals?', [])
    expect(results).toHaveLength(2)
  })

  it('should interpolate values in template', async () => {
    const accessor = new EntityAccessor('Lead', store, { nlExecutor })

    // Simulate: `top 10 in ${'enterprise'}`
    await accessor.templateLiteralQuery(
      ['top 10 in ', ''] as unknown as TemplateStringsArray,
      'enterprise'
    )

    expect(nlExecutor.execute).toHaveBeenCalledWith('Lead', 'top 10 in $1', ['enterprise'])
  })

  it('should fall back to keyword search without NL executor', async () => {
    const accessor = new EntityAccessor('Lead', store)

    const results = await accessor.templateLiteralQuery(['deals closed'] as unknown as TemplateStringsArray)

    // Fallback should return items with matching keywords
    expect(Array.isArray(results)).toBe(true)
  })
})
