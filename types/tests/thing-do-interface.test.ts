/**
 * ThingDO Interface Tests (RED Phase)
 *
 * These tests verify the ThingDO interface for heterogeneous multi-type containers.
 * Unlike Collection<T> which holds a single type, ThingDO can hold multiple types.
 *
 * Key differences from Collection:
 * - Collection<T>: homogeneous, $id = ns/id
 * - ThingDO: heterogeneous, $id = ns/type/id
 *
 * RED TDD: These tests should FAIL because the ThingDO interface
 * with these specific methods doesn't exist yet.
 *
 * Reference: dotdo-nm37 - TDD RED Phase for ThingDO interface
 */

import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest'

// ============================================================================
// Import types under test (will fail until implemented)
// ============================================================================

// These imports will FAIL - the new ThingDO interface with heterogeneous
// container methods doesn't exist yet
import type {
  HeterogeneousThingDO,
  CollectionView,
  DOType,
} from '../ThingDO'

import {
  createThingDO,
  isHeterogeneousContainer,
} from '../ThingDO'

import type { Thing, ThingData } from '../Thing'

// ============================================================================
// Type Constants
// ============================================================================

const THING_DO_TYPE = 'https://schema.org.ai/Thing' as const
const COLLECTION_TYPE = 'https://schema.org.ai/Collection' as const

// ============================================================================
// Test Data Fixtures
// ============================================================================

interface Contact extends Thing {
  $type: 'https://example.com.ai/Contact'
  email: string
  phone?: string
}

interface Order extends Thing {
  $type: 'https://example.com.ai/Order'
  amount: number
  status: 'pending' | 'completed' | 'cancelled'
}

interface Product extends Thing {
  $type: 'https://example.com.ai/Product'
  name: string
  price: number
}

const mockContactData = {
  email: 'john@example.com.ai',
  phone: '555-1234',
}

const mockOrderData = {
  amount: 99.99,
  status: 'pending' as const,
}

const mockProductData = {
  name: 'Widget',
  price: 29.99,
}

// ============================================================================
// Mock DO State
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-thing-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
      sql: {},
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {}
}

// ============================================================================
// TESTS: ThingDO.$type Discriminator
// ============================================================================

describe('ThingDO.$type discriminator', () => {
  let thingDO: HeterogeneousThingDO
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
  })

  it('ThingDO.$type is schema.org.ai/Thing', () => {
    // ThingDO should have $type = 'https://schema.org.ai/Thing'
    // to distinguish it from Collection which has $type = 'https://schema.org.ai/Collection'
    expect(thingDO.$type).toBe(THING_DO_TYPE)
  })

  it('ThingDO.$type is typed as literal', () => {
    // Type test: $type should be a literal type, not just string
    expectTypeOf(thingDO.$type).toEqualTypeOf<'https://schema.org.ai/Thing'>()
  })

  it('DOType discriminates between Thing and Collection', () => {
    // DOType should be a union: 'https://schema.org.ai/Thing' | 'https://schema.org.ai/Collection'
    const thingType: DOType = THING_DO_TYPE
    const collectionType: DOType = COLLECTION_TYPE

    expect([THING_DO_TYPE, COLLECTION_TYPE]).toContain(thingType)
    expect([THING_DO_TYPE, COLLECTION_TYPE]).toContain(collectionType)
  })
})

// ============================================================================
// TESTS: ThingDO.itemType is undefined
// ============================================================================

describe('ThingDO.itemType', () => {
  let thingDO: HeterogeneousThingDO
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
  })

  it('ThingDO.itemType is undefined', () => {
    // ThingDO holds multiple types, so itemType should be undefined
    // This contrasts with Collection<T> which has itemType set to the type URL
    expect(thingDO.itemType).toBeUndefined()
  })

  it('ThingDO does not have itemType property set', () => {
    // TypeScript type test: itemType should not exist or be optional undefined
    // This test verifies the interface doesn't require itemType
    const doWithoutItemType: HeterogeneousThingDO = thingDO

    // Should not have itemType property
    expect('itemType' in doWithoutItemType).toBe(false)
  })

  it('isHeterogeneousContainer returns true for ThingDO', () => {
    // Helper function to check if a DO is a heterogeneous container
    expect(isHeterogeneousContainer(thingDO)).toBe(true)
  })

  it('isHeterogeneousContainer checks $type and itemType', () => {
    // A heterogeneous container has:
    // - $type = 'https://schema.org.ai/Thing'
    // - itemType = undefined
    const heterogeneous = { $type: THING_DO_TYPE, itemType: undefined }
    const homogeneous = { $type: COLLECTION_TYPE, itemType: 'https://example.com.ai/Contact' }

    expect(isHeterogeneousContainer(heterogeneous as unknown as HeterogeneousThingDO)).toBe(true)
    expect(isHeterogeneousContainer(homogeneous as unknown as HeterogeneousThingDO)).toBe(false)
  })
})

// ============================================================================
// TESTS: buildItemId(type, id)
// ============================================================================

describe('ThingDO.buildItemId(type, id)', () => {
  let thingDO: HeterogeneousThingDO
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
    // Set namespace for testing
    ;(thingDO as unknown as { ns: string }).ns = 'https://example.com.ai'
  })

  it('buildItemId returns ns/type/id format', () => {
    // buildItemId should construct the full $id with type in path
    const result = thingDO.buildItemId('Contact', 'john')

    expect(result).toBe('https://example.com.ai/Contact/john')
  })

  it('buildItemId handles different types', () => {
    const contactId = thingDO.buildItemId('Contact', 'john')
    const orderId = thingDO.buildItemId('Order', 'ord-123')
    const productId = thingDO.buildItemId('Product', 'widget-1')

    expect(contactId).toBe('https://example.com.ai/Contact/john')
    expect(orderId).toBe('https://example.com.ai/Order/ord-123')
    expect(productId).toBe('https://example.com.ai/Product/widget-1')
  })

  it('buildItemId handles IDs with special characters', () => {
    const result = thingDO.buildItemId('Contact', 'john-doe-123')

    expect(result).toBe('https://example.com.ai/Contact/john-doe-123')
  })

  it('buildItemId returns type-safe string', () => {
    const result = thingDO.buildItemId('Contact', 'john')

    expectTypeOf(result).toEqualTypeOf<string>()
  })

  it('buildItemId with different namespace', () => {
    ;(thingDO as unknown as { ns: string }).ns = 'https://crm.example.com.ai'

    const result = thingDO.buildItemId('Contact', 'jane')

    expect(result).toBe('https://crm.example.com.ai/Contact/jane')
  })
})

// ============================================================================
// TESTS: CRUD methods require type parameter
// ============================================================================

describe('ThingDO CRUD with type parameter', () => {
  let thingDO: HeterogeneousThingDO
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
    ;(thingDO as unknown as { ns: string }).ns = 'https://example.com.ai'
  })

  describe('create(type, id, data)', () => {
    it('create requires type parameter', async () => {
      const result = await thingDO.create('Contact', 'john', mockContactData)

      expect(result).toBeDefined()
      expect(result.$type).toBe('https://example.com.ai/Contact')
    })

    it('create generates correct $id with type in path', async () => {
      const result = await thingDO.create('Contact', 'john', mockContactData)

      expect(result.$id).toBe('https://example.com.ai/Contact/john')
    })

    it('create sets data correctly', async () => {
      const result = await thingDO.create('Contact', 'john', mockContactData) as Contact

      expect(result.email).toBe(mockContactData.email)
      expect(result.phone).toBe(mockContactData.phone)
    })

    it('create with different types', async () => {
      const contact = await thingDO.create('Contact', 'john', mockContactData)
      const order = await thingDO.create('Order', 'ord-1', mockOrderData)
      const product = await thingDO.create('Product', 'widget', mockProductData)

      expect(contact.$id).toBe('https://example.com.ai/Contact/john')
      expect(order.$id).toBe('https://example.com.ai/Order/ord-1')
      expect(product.$id).toBe('https://example.com.ai/Product/widget')

      expect(contact.$type).toBe('https://example.com.ai/Contact')
      expect(order.$type).toBe('https://example.com.ai/Order')
      expect(product.$type).toBe('https://example.com.ai/Product')
    })
  })

  describe('get(type, id)', () => {
    it('get requires type parameter', async () => {
      await thingDO.create('Contact', 'john', mockContactData)

      const result = await thingDO.get('Contact', 'john')

      expect(result).toBeDefined()
    })

    it('get resolves by type and id', async () => {
      await thingDO.create('Contact', 'john', mockContactData)
      await thingDO.create('Order', 'john', mockOrderData) // Same id, different type

      const contact = await thingDO.get('Contact', 'john')
      const order = await thingDO.get('Order', 'john')

      expect(contact?.$type).toBe('https://example.com.ai/Contact')
      expect(order?.$type).toBe('https://example.com.ai/Order')
    })

    it('get returns null for non-existent item', async () => {
      const result = await thingDO.get('Contact', 'non-existent')

      expect(result).toBeNull()
    })

    it('get returns Thing with correct $id format', async () => {
      await thingDO.create('Contact', 'john', mockContactData)

      const result = await thingDO.get('Contact', 'john')

      expect(result?.$id).toBe('https://example.com.ai/Contact/john')
    })
  })

  describe('update(type, id, data)', () => {
    it('update requires type parameter', async () => {
      await thingDO.create('Contact', 'john', mockContactData)

      const result = await thingDO.update('Contact', 'john', { phone: '555-9999' })

      expect(result).toBeDefined()
    })

    it('update modifies correct item by type and id', async () => {
      await thingDO.create('Contact', 'john', mockContactData)

      const result = await thingDO.update('Contact', 'john', { phone: '555-9999' }) as Contact

      expect(result.phone).toBe('555-9999')
      expect(result.email).toBe(mockContactData.email) // Original data preserved
    })

    it('update preserves $id format', async () => {
      await thingDO.create('Contact', 'john', mockContactData)

      const result = await thingDO.update('Contact', 'john', { phone: '555-9999' })

      expect(result?.$id).toBe('https://example.com.ai/Contact/john')
    })
  })

  describe('delete(type, id)', () => {
    it('delete requires type parameter', async () => {
      await thingDO.create('Contact', 'john', mockContactData)

      await expect(thingDO.delete('Contact', 'john')).resolves.toBeUndefined()
    })

    it('delete removes correct item by type and id', async () => {
      await thingDO.create('Contact', 'john', mockContactData)
      await thingDO.create('Order', 'john', mockOrderData)

      await thingDO.delete('Contact', 'john')

      const contact = await thingDO.get('Contact', 'john')
      const order = await thingDO.get('Order', 'john')

      expect(contact).toBeNull()
      expect(order).not.toBeNull() // Different type not affected
    })
  })
})

// ============================================================================
// TESTS: list(type) filters by type
// ============================================================================

describe('ThingDO.list(type)', () => {
  let thingDO: HeterogeneousThingDO
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
    ;(thingDO as unknown as { ns: string }).ns = 'https://example.com.ai'

    // Populate with mixed types
    await thingDO.create('Contact', 'john', mockContactData)
    await thingDO.create('Contact', 'jane', { email: 'jane@example.com.ai' })
    await thingDO.create('Order', 'ord-1', mockOrderData)
    await thingDO.create('Product', 'widget', mockProductData)
  })

  it('list(type) returns only items of that type', async () => {
    const contacts = await thingDO.list('Contact')

    expect(contacts).toHaveLength(2)
    expect(contacts.every((c) => c.$type === 'https://example.com.ai/Contact')).toBe(true)
  })

  it('list returns different counts for different types', async () => {
    const contacts = await thingDO.list('Contact')
    const orders = await thingDO.list('Order')
    const products = await thingDO.list('Product')

    expect(contacts).toHaveLength(2)
    expect(orders).toHaveLength(1)
    expect(products).toHaveLength(1)
  })

  it('list returns empty array for type with no items', async () => {
    const invoices = await thingDO.list('Invoice')

    expect(invoices).toEqual([])
  })

  it('list items have correct $id format', async () => {
    const contacts = await thingDO.list('Contact')

    expect(contacts[0].$id).toMatch(/^https:\/\/example\.com\/Contact\//)
    expect(contacts[1].$id).toMatch(/^https:\/\/example\.com\/Contact\//)
  })
})

// ============================================================================
// TESTS: collection<T>(type) returns typed view
// ============================================================================

describe('ThingDO.collection<T>(type)', () => {
  let thingDO: HeterogeneousThingDO
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
    ;(thingDO as unknown as { ns: string }).ns = 'https://example.com.ai'

    await thingDO.create('Contact', 'john', mockContactData)
    await thingDO.create('Contact', 'jane', { email: 'jane@example.com.ai' })
  })

  it('collection<T>(type) returns CollectionView', () => {
    const contacts = thingDO.collection<Contact>('Contact')

    expect(contacts).toBeDefined()
  })

  it('CollectionView.get(id) returns typed Thing', async () => {
    const contacts = thingDO.collection<Contact>('Contact')

    const john = await contacts.get('john')

    expect(john).toBeDefined()
    expectTypeOf(john).toEqualTypeOf<Contact | null>()
  })

  it('CollectionView.list() returns typed array', async () => {
    const contacts = thingDO.collection<Contact>('Contact')

    const all = await contacts.list()

    expect(all).toHaveLength(2)
    expectTypeOf(all).toEqualTypeOf<Contact[]>()
  })

  it('CollectionView.find(query) filters within type', async () => {
    const contacts = thingDO.collection<Contact>('Contact')

    const found = await contacts.find({ email: 'john@example.com.ai' })

    expect(found).toHaveLength(1)
    expect(found[0].email).toBe('john@example.com.ai')
  })

  it('CollectionView get/list use simplified $id (no type prefix)', async () => {
    // Within a CollectionView, IDs are simplified (just the id part)
    // since the type is already known from the collection context
    const contacts = thingDO.collection<Contact>('Contact')

    const john = await contacts.get('john')

    // The returned $id should still be fully qualified
    expect(john?.$id).toBe('https://example.com.ai/Contact/john')
  })

  it('CollectionView is type-safe', () => {
    // Type test: collection<Contact> should not accept Order methods
    const contacts = thingDO.collection<Contact>('Contact')
    const orders = thingDO.collection<Order>('Order')

    // These should have different types
    expectTypeOf(contacts).not.toEqualTypeOf(orders)
  })
})

// ============================================================================
// TESTS: Interface Type Definitions
// ============================================================================

describe('ThingDO interface types', () => {
  it('HeterogeneousThingDO interface has required methods', () => {
    // Type test: verify interface shape
    type RequiredMethods = {
      $type: 'https://schema.org.ai/Thing'
      buildItemId: (type: string, id: string) => string
      get: (type: string, id: string) => Promise<Thing | null>
      create: (type: string, id: string, data: Partial<ThingData>) => Promise<Thing>
      update: (type: string, id: string, data: Partial<ThingData>) => Promise<Thing | null>
      delete: (type: string, id: string) => Promise<void>
      list: (type: string) => Promise<Thing[]>
      collection: <T extends Thing>(type: string) => CollectionView<T>
    }

    // This should compile if HeterogeneousThingDO has all required methods
    const _typeCheck: RequiredMethods = {} as HeterogeneousThingDO
    expect(_typeCheck).toBeDefined()
  })

  it('CollectionView interface has required methods', () => {
    type RequiredCollectionMethods = {
      get: (id: string) => Promise<Thing | null>
      list: () => Promise<Thing[]>
      find: (query: Record<string, unknown>) => Promise<Thing[]>
    }

    // This should compile if CollectionView has all required methods
    const _typeCheck: RequiredCollectionMethods = {} as CollectionView<Thing>
    expect(_typeCheck).toBeDefined()
  })
})

// ============================================================================
// TESTS: Contrast with Collection<T>
// ============================================================================

describe('ThingDO vs Collection contrast', () => {
  let thingDO: HeterogeneousThingDO

  beforeEach(() => {
    const mockState = createMockState()
    const mockEnv = createMockEnv()
    thingDO = createThingDO(mockState, mockEnv)
    ;(thingDO as unknown as { ns: string }).ns = 'https://example.com.ai'
  })

  it('ThingDO items have ns/type/id format', async () => {
    // ThingDO (heterogeneous): $id = ns/type/id
    const contact = await thingDO.create('Contact', 'john', mockContactData)

    expect(contact.$id).toBe('https://example.com.ai/Contact/john')
  })

  it('ThingDO $type is schema.org.ai/Thing not Collection', () => {
    // ThingDO uses Thing type, not Collection
    expect(thingDO.$type).toBe(THING_DO_TYPE)
    expect(thingDO.$type).not.toBe(COLLECTION_TYPE)
  })

  it('ThingDO can store multiple types', async () => {
    // Unlike Collection<T>, ThingDO can hold different types
    const contact = await thingDO.create('Contact', 'john', mockContactData)
    const order = await thingDO.create('Order', 'ord-1', mockOrderData)
    const product = await thingDO.create('Product', 'widget', mockProductData)

    expect(contact.$type).not.toBe(order.$type)
    expect(order.$type).not.toBe(product.$type)

    // All stored in same DO
    const contacts = await thingDO.list('Contact')
    const orders = await thingDO.list('Order')
    const products = await thingDO.list('Product')

    expect(contacts).toHaveLength(1)
    expect(orders).toHaveLength(1)
    expect(products).toHaveLength(1)
  })
})
