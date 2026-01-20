// Tests for StorageAdapter interface and implementations
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMemoryStorageAdapter,
  MemoryStorageAdapter,
  SharedMemoryStorage
} from '../adapters/memory'
import {
  createThingsStoreWithAdapter,
  createEventsStoreWithAdapter,
  createRelationshipsStoreWithAdapter
} from '../index'
import type { StorageAdapter } from '../storage'

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter

  beforeEach(() => {
    adapter = createMemoryStorageAdapter()
  })

  describe('basic operations', () => {
    it('should put and get a value', async () => {
      await adapter.put('key1', { name: 'test', value: 123 })
      const result = await adapter.get<{ name: string; value: number }>('key1')

      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should return undefined for non-existent key', async () => {
      const result = await adapter.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should check if key exists', async () => {
      await adapter.put('key1', 'value1')

      expect(await adapter.has('key1')).toBe(true)
      expect(await adapter.has('nonexistent')).toBe(false)
    })

    it('should delete a key', async () => {
      await adapter.put('key1', 'value1')
      await adapter.delete('key1')

      expect(await adapter.has('key1')).toBe(false)
    })

    it('should update existing key', async () => {
      await adapter.put('key1', 'first')
      await adapter.put('key1', 'second')

      const result = await adapter.get('key1')
      expect(result).toBe('second')
    })
  })

  describe('batch operations', () => {
    it('should put and get multiple values', async () => {
      const entries = new Map<string, string>([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3']
      ])

      await adapter.putMany(entries)
      const result = await adapter.getMany<string>(['key1', 'key2', 'key3'])

      expect(result.get('key1')).toBe('value1')
      expect(result.get('key2')).toBe('value2')
      expect(result.get('key3')).toBe('value3')
    })

    it('should delete multiple keys', async () => {
      await adapter.putMany(
        new Map([
          ['key1', 'value1'],
          ['key2', 'value2'],
          ['key3', 'value3']
        ])
      )

      await adapter.deleteMany(['key1', 'key3'])

      expect(await adapter.has('key1')).toBe(false)
      expect(await adapter.has('key2')).toBe(true)
      expect(await adapter.has('key3')).toBe(false)
    })
  })

  describe('list operations', () => {
    it('should list all keys', async () => {
      await adapter.putMany(
        new Map([
          ['a', 1],
          ['b', 2],
          ['c', 3]
        ])
      )

      const result = await adapter.list<number>()

      expect(result.entries.size).toBe(3)
      expect(result.hasMore).toBe(false)
    })

    it('should filter by prefix', async () => {
      await adapter.putMany(
        new Map([
          ['user:1', { id: 1 }],
          ['user:2', { id: 2 }],
          ['order:1', { id: 1 }]
        ])
      )

      const result = await adapter.list({ prefix: 'user:' })

      expect(result.entries.size).toBe(2)
    })

    it('should paginate with limit and cursor', async () => {
      await adapter.putMany(
        new Map([
          ['a', 1],
          ['b', 2],
          ['c', 3],
          ['d', 4],
          ['e', 5]
        ])
      )

      const page1 = await adapter.list<number>({ limit: 2 })
      expect(page1.entries.size).toBe(2)
      expect(page1.hasMore).toBe(true)
      expect(page1.cursor).toBeDefined()

      const page2 = await adapter.list<number>({ limit: 2, cursor: page1.cursor })
      expect(page2.entries.size).toBe(2)
      expect(page2.hasMore).toBe(true)

      const page3 = await adapter.list<number>({ limit: 2, cursor: page2.cursor })
      expect(page3.entries.size).toBe(1)
      expect(page3.hasMore).toBe(false)
    })
  })

  describe('count', () => {
    it('should count all keys', async () => {
      await adapter.putMany(
        new Map([
          ['key1', 'v1'],
          ['key2', 'v2'],
          ['key3', 'v3']
        ])
      )

      expect(await adapter.count()).toBe(3)
    })

    it('should count keys with prefix', async () => {
      await adapter.putMany(
        new Map([
          ['user:1', 'u1'],
          ['user:2', 'u2'],
          ['order:1', 'o1']
        ])
      )

      expect(await adapter.count('user:')).toBe(2)
      expect(await adapter.count('order:')).toBe(1)
    })
  })

  describe('clear', () => {
    it('should clear all keys', async () => {
      await adapter.putMany(
        new Map([
          ['key1', 'v1'],
          ['key2', 'v2']
        ])
      )

      await adapter.clear()

      expect(await adapter.count()).toBe(0)
    })
  })

  describe('transaction', () => {
    it('should roll back on error', async () => {
      await adapter.put('key1', 'original')

      try {
        await adapter.transaction(async () => {
          await adapter.put('key1', 'modified')
          await adapter.put('key2', 'new')
          throw new Error('Rollback!')
        })
      } catch {
        // Expected
      }

      expect(await adapter.get('key1')).toBe('original')
      expect(await adapter.has('key2')).toBe(false)
    })

    it('should commit on success', async () => {
      await adapter.put('key1', 'original')

      await adapter.transaction(async () => {
        await adapter.put('key1', 'modified')
        await adapter.put('key2', 'new')
      })

      expect(await adapter.get('key1')).toBe('modified')
      expect(await adapter.get('key2')).toBe('new')
    })
  })

  describe('namespace support', () => {
    it('should isolate keys by namespace', async () => {
      const ns1 = createMemoryStorageAdapter({ namespace: 'ns1' })
      const ns2 = createMemoryStorageAdapter({ namespace: 'ns2' })

      // Both adapters share the same underlying Map for testing
      ns2.setStore(ns1.getStore())

      await ns1.put('key', 'value1')
      await ns2.put('key', 'value2')

      expect(await ns1.get('key')).toBe('value1')
      expect(await ns2.get('key')).toBe('value2')
    })
  })
})

describe('SharedMemoryStorage', () => {
  beforeEach(() => {
    SharedMemoryStorage.clearAll()
  })

  it('should create shared storage instances', () => {
    const store1 = SharedMemoryStorage.get('test')
    const store2 = SharedMemoryStorage.get('test')

    expect(store1).toBe(store2)
  })

  it('should create adapter backed by shared storage', async () => {
    const adapter1 = SharedMemoryStorage.createAdapter('shared')
    const adapter2 = SharedMemoryStorage.createAdapter('shared')

    await adapter1.put('key', 'value')
    const result = await adapter2.get('key')

    expect(result).toBe('value')
  })
})

describe('ThingsStore with Adapter', () => {
  let adapter: StorageAdapter

  beforeEach(() => {
    adapter = createMemoryStorageAdapter()
  })

  it('should create and retrieve a thing', async () => {
    const store = createThingsStoreWithAdapter(adapter)

    const created = await store.create({ $type: 'User', name: 'Alice' })

    expect(created.$id).toBeDefined()
    expect(created.$type).toBe('User')
    expect(created.name).toBe('Alice')
    expect(created.$createdAt).toBeDefined()
    expect(created.$updatedAt).toBeDefined()

    const retrieved = await store.get(created.$id)
    expect(retrieved).toEqual(created)
  })

  it('should update a thing', async () => {
    const store = createThingsStoreWithAdapter(adapter)

    const created = await store.create({ $type: 'User', name: 'Alice' })
    const updated = await store.update(created.$id, { name: 'Bob' })

    expect(updated.name).toBe('Bob')
    expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$updatedAt)
  })

  it('should delete a thing', async () => {
    const store = createThingsStoreWithAdapter(adapter)

    const created = await store.create({ $type: 'User', name: 'Alice' })
    await store.delete(created.$id)

    const retrieved = await store.get(created.$id)
    expect(retrieved).toBeNull()
  })

  it('should list things', async () => {
    const store = createThingsStoreWithAdapter(adapter)

    await store.create({ $type: 'User', name: 'Alice' })
    await store.create({ $type: 'User', name: 'Bob' })
    await store.create({ $type: 'Order', amount: 100 })

    const allThings = await store.list()
    expect(allThings.length).toBe(3)

    const users = await store.list({ type: 'User' })
    expect(users.length).toBe(2)
  })
})

describe('EventsStore with Adapter', () => {
  let adapter: StorageAdapter

  beforeEach(() => {
    adapter = createMemoryStorageAdapter()
  })

  it('should emit and retrieve an event', async () => {
    const store = createEventsStoreWithAdapter(adapter)

    const emitted = await store.emit({
      type: 'UserCreated',
      payload: { userId: '123', name: 'Alice' }
    })

    expect(emitted.$id).toBeDefined()
    expect(emitted.type).toBe('UserCreated')
    expect(emitted.$timestamp).toBeDefined()

    const retrieved = await store.get(emitted.$id)
    expect(retrieved).toEqual(emitted)
  })

  it('should query events by type', async () => {
    const store = createEventsStoreWithAdapter(adapter)

    await store.emit({ type: 'UserCreated', payload: { userId: '1' } })
    await store.emit({ type: 'UserCreated', payload: { userId: '2' } })
    await store.emit({ type: 'OrderPlaced', payload: { orderId: '1' } })

    const userEvents = await store.query({ type: 'UserCreated' })
    expect(userEvents.length).toBe(2)

    const orderEvents = await store.query({ type: 'OrderPlaced' })
    expect(orderEvents.length).toBe(1)
  })

  it('should notify subscribers', async () => {
    const store = createEventsStoreWithAdapter(adapter)
    const received: unknown[] = []

    store.subscribe((event) => {
      received.push(event)
    })

    await store.emit({ type: 'TestEvent', payload: { value: 1 } })
    await store.emit({ type: 'TestEvent', payload: { value: 2 } })

    expect(received.length).toBe(2)
  })
})

describe('RelationshipsStore with Adapter', () => {
  let adapter: StorageAdapter

  beforeEach(() => {
    adapter = createMemoryStorageAdapter()
  })

  it('should add and find a relationship', async () => {
    const store = createRelationshipsStoreWithAdapter(adapter)

    const rel = await store.add({
      subject: 'user:1',
      predicate: 'owns',
      object: 'order:1'
    })

    expect(rel.subject).toBe('user:1')
    expect(rel.predicate).toBe('owns')
    expect(rel.object).toBe('order:1')
    expect(rel.$createdAt).toBeDefined()

    const found = await store.find({ subject: 'user:1' })
    expect(found.length).toBe(1)
    expect(found[0]).toEqual(rel)
  })

  it('should remove a relationship', async () => {
    const store = createRelationshipsStoreWithAdapter(adapter)

    await store.add({
      subject: 'user:1',
      predicate: 'owns',
      object: 'order:1'
    })

    await store.remove({
      subject: 'user:1',
      predicate: 'owns',
      object: 'order:1'
    })

    const found = await store.find({ subject: 'user:1' })
    expect(found.length).toBe(0)
  })

  it('should get related objects', async () => {
    const store = createRelationshipsStoreWithAdapter(adapter)

    await store.add({ subject: 'user:1', predicate: 'owns', object: 'order:1' })
    await store.add({ subject: 'user:1', predicate: 'owns', object: 'order:2' })
    await store.add({ subject: 'user:1', predicate: 'created', object: 'post:1' })

    const owned = await store.getRelated('user:1', 'owns')
    expect(owned).toEqual(['order:1', 'order:2'])

    const created = await store.getRelated('user:1', 'created')
    expect(created).toEqual(['post:1'])
  })

  it('should get related subjects', async () => {
    const store = createRelationshipsStoreWithAdapter(adapter)

    await store.add({ subject: 'user:1', predicate: 'owns', object: 'order:1' })
    await store.add({ subject: 'user:2', predicate: 'owns', object: 'order:1' })

    const owners = await store.getRelatedTo('order:1', 'owns')
    expect(owners.sort()).toEqual(['user:1', 'user:2'])
  })

  it('should prevent duplicate relationships', async () => {
    const store = createRelationshipsStoreWithAdapter(adapter)

    await store.add({
      subject: 'user:1',
      predicate: 'owns',
      object: 'order:1'
    })

    await expect(
      store.add({
        subject: 'user:1',
        predicate: 'owns',
        object: 'order:1'
      })
    ).rejects.toThrow('Relationship already exists')
  })
})
