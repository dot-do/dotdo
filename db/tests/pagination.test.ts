// Cursor-based pagination tests - do-rljr.8
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createThingsStore,
  createEventsStore,
  createRelationshipsStore,
  encodeCursor,
  decodeCursor,
  applyCursorPagination
} from '../index'
import type { CursorPaginationOptions } from '../pagination'

describe('Cursor Encoding/Decoding', () => {
  it('should encode and decode cursor data correctly', () => {
    const cursorData = {
      sortValue: 1234567890,
      id: 'test-id-123',
      sortField: '$createdAt',
      sortDirection: 'desc' as const
    }

    const encoded = encodeCursor(cursorData)
    expect(typeof encoded).toBe('string')
    expect(encoded.length).toBeGreaterThan(0)

    const decoded = decodeCursor(encoded)
    expect(decoded).toEqual(cursorData)
  })

  it('should return null for invalid cursor', () => {
    expect(decodeCursor('invalid-cursor')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor('!!!not-base64!!!')).toBeNull()
  })

  it('should return null for cursor with missing fields', () => {
    // Base64 of just {}
    const invalidCursor = btoa('{}')
    expect(decodeCursor(invalidCursor)).toBeNull()
  })
})

describe('applyCursorPagination', () => {
  const items = [
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 200 },
    { id: 'c', createdAt: 300 },
    { id: 'd', createdAt: 400 },
    { id: 'e', createdAt: 500 }
  ]

  // Sort descending (newest first)
  const sortedItems = [...items].reverse()

  it('should return first page with no cursor', () => {
    const result = applyCursorPagination(
      sortedItems,
      { limit: 2 },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    expect(result.items).toHaveLength(2)
    expect(result.items[0].id).toBe('e')
    expect(result.items[1].id).toBe('d')
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeDefined()
    expect(result.prevCursor).toBeUndefined()
  })

  it('should return next page with cursor', () => {
    // Get first page
    const page1 = applyCursorPagination(
      sortedItems,
      { limit: 2 },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    // Get second page using cursor
    const page2 = applyCursorPagination(
      sortedItems,
      { limit: 2, cursor: page1.nextCursor },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    expect(page2.items).toHaveLength(2)
    expect(page2.items[0].id).toBe('c')
    expect(page2.items[1].id).toBe('b')
    expect(page2.hasMore).toBe(true)
    expect(page2.nextCursor).toBeDefined()
    expect(page2.prevCursor).toBeDefined()
  })

  it('should handle last page correctly', () => {
    // Get all pages
    const page1 = applyCursorPagination(
      sortedItems,
      { limit: 2 },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    const page2 = applyCursorPagination(
      sortedItems,
      { limit: 2, cursor: page1.nextCursor },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    const page3 = applyCursorPagination(
      sortedItems,
      { limit: 2, cursor: page2.nextCursor },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    expect(page3.items).toHaveLength(1)
    expect(page3.items[0].id).toBe('a')
    expect(page3.hasMore).toBe(false)
    expect(page3.nextCursor).toBeUndefined()
    expect(page3.prevCursor).toBeDefined()
  })

  it('should handle backward pagination', () => {
    // Get last page first
    const lastPage = applyCursorPagination(
      sortedItems,
      { limit: 2, direction: 'backward' },
      'createdAt',
      'desc',
      (item) => item.id,
      (item) => item.createdAt
    )

    expect(lastPage.items).toHaveLength(2)
    expect(lastPage.items[0].id).toBe('b')
    expect(lastPage.items[1].id).toBe('a')
    expect(lastPage.hasMore).toBe(true)
    expect(lastPage.prevCursor).toBeDefined()
  })

  it('should return empty result for empty array', () => {
    const result = applyCursorPagination(
      [],
      { limit: 10 },
      'createdAt',
      'desc',
      (item: { id: string; createdAt: number }) => item.id,
      (item: { id: string; createdAt: number }) => item.createdAt
    )

    expect(result.items).toHaveLength(0)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(result.prevCursor).toBeUndefined()
  })
})

describe('ThingsStore cursor pagination', () => {
  let store: ReturnType<typeof createThingsStore>

  beforeEach(() => {
    store = createThingsStore()
  })

  it('should support cursor-based pagination with listWithCursor', async () => {
    // Create 5 things with slight delays to ensure different timestamps
    const things = []
    for (let i = 0; i < 5; i++) {
      const thing = await store.create({ $type: 'Item', name: `Item ${i}` })
      things.push(thing)
    }

    // Get first page
    const page1 = await store.listWithCursor({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBeDefined()

    // Get second page
    const page2 = await store.listWithCursor({ limit: 2, cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(2)
    expect(page2.hasMore).toBe(true)

    // Collect all IDs to verify no overlap and complete coverage
    const page1Ids = new Set(page1.items.map(t => t.$id))
    const page2Ids = new Set(page2.items.map(t => t.$id))

    // Verify no overlap between pages
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false)
    }

    // Get last page
    const page3 = await store.listWithCursor({ limit: 2, cursor: page2.nextCursor })
    expect(page3.items).toHaveLength(1)
    expect(page3.hasMore).toBe(false)

    // Verify all 5 items were returned across all pages
    const allIds = new Set([
      ...page1.items.map(t => t.$id),
      ...page2.items.map(t => t.$id),
      ...page3.items.map(t => t.$id)
    ])
    expect(allIds.size).toBe(5)
  })

  it('should filter by type with cursor pagination', async () => {
    await store.create({ $type: 'Customer', name: 'Alice' })
    await store.create({ $type: 'Product', name: 'Widget' })
    await store.create({ $type: 'Customer', name: 'Bob' })
    await store.create({ $type: 'Product', name: 'Gadget' })
    await store.create({ $type: 'Customer', name: 'Charlie' })

    const result = await store.listWithCursor({ type: 'Customer', limit: 10 })
    expect(result.items).toHaveLength(3)
    expect(result.items.every(t => t.$type === 'Customer')).toBe(true)
  })
})

describe('EventsStore cursor pagination', () => {
  let store: ReturnType<typeof createEventsStore>

  beforeEach(() => {
    store = createEventsStore()
  })

  it('should support cursor-based pagination with queryWithCursor', async () => {
    // Emit 5 events
    for (let i = 0; i < 5; i++) {
      await store.emit({ type: 'test', payload: { index: i } })
    }

    // Get first page
    const page1 = await store.queryWithCursor({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBeDefined()

    // Get second page
    const page2 = await store.queryWithCursor({ limit: 2, cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(2)
    expect(page2.hasMore).toBe(true)

    // Verify no overlap
    const page1Ids = page1.items.map(e => e.$id)
    const page2Ids = page2.items.map(e => e.$id)
    expect(page1Ids).not.toEqual(page2Ids)
  })

  it('should filter by type with cursor pagination', async () => {
    await store.emit({ type: 'order.created', payload: { orderId: '1' } })
    await store.emit({ type: 'user.signup', payload: { userId: 'a' } })
    await store.emit({ type: 'order.created', payload: { orderId: '2' } })
    await store.emit({ type: 'user.signup', payload: { userId: 'b' } })
    await store.emit({ type: 'order.created', payload: { orderId: '3' } })

    const result = await store.queryWithCursor({ type: 'order.created', limit: 10 })
    expect(result.items).toHaveLength(3)
    expect(result.items.every(e => e.type === 'order.created')).toBe(true)
  })
})

describe('RelationshipsStore cursor pagination', () => {
  let store: ReturnType<typeof createRelationshipsStore>

  beforeEach(() => {
    store = createRelationshipsStore()
  })

  it('should support cursor-based pagination with findWithCursor', async () => {
    // Add 5 relationships
    for (let i = 0; i < 5; i++) {
      await store.add({ subject: 'user-1', predicate: 'follows', object: `user-${i + 10}` })
    }

    // Get first page
    const page1 = await store.findWithCursor({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBeDefined()

    // Get second page
    const page2 = await store.findWithCursor({ limit: 2, cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(2)
    expect(page2.hasMore).toBe(true)

    // Collect all objects to verify no overlap and complete coverage
    const page1Objects = new Set(page1.items.map(r => r.object))
    const page2Objects = new Set(page2.items.map(r => r.object))

    // Verify no overlap between pages
    for (const obj of page2Objects) {
      expect(page1Objects.has(obj)).toBe(false)
    }

    // Get last page
    const page3 = await store.findWithCursor({ limit: 2, cursor: page2.nextCursor })
    expect(page3.items).toHaveLength(1)
    expect(page3.hasMore).toBe(false)

    // Verify all 5 items were returned across all pages
    const allObjects = new Set([
      ...page1.items.map(r => r.object),
      ...page2.items.map(r => r.object),
      ...page3.items.map(r => r.object)
    ])
    expect(allObjects.size).toBe(5)
  })

  it('should filter by predicate with cursor pagination', async () => {
    await store.add({ subject: 'user-1', predicate: 'follows', object: 'user-2' })
    await store.add({ subject: 'user-1', predicate: 'likes', object: 'post-1' })
    await store.add({ subject: 'user-1', predicate: 'follows', object: 'user-3' })
    await store.add({ subject: 'user-1', predicate: 'likes', object: 'post-2' })
    await store.add({ subject: 'user-1', predicate: 'follows', object: 'user-4' })

    const result = await store.findWithCursor({ predicate: 'follows', limit: 10 })
    expect(result.items).toHaveLength(3)
    expect(result.items.every(r => r.predicate === 'follows')).toBe(true)
  })
})
