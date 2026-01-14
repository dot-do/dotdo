/**
 * Resource Abstraction Tests
 *
 * TDD test suite for the unified CRUD + Query interface.
 * Following strict red-green-refactor cycles.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Resource, InMemoryResource } from '../index'
import type { Query, ChangeEvent, ResourceSchema } from '../types'

// Test entity type
interface User {
  id: string
  name: string
  email: string
  age: number
  status: 'active' | 'inactive'
  createdAt: Date
}

describe('Resource', () => {
  let resource: Resource<User>

  beforeEach(() => {
    resource = new InMemoryResource<User>()
  })

  // =============================================================================
  // TDD Cycle 1: Basic CRUD Operations
  // =============================================================================

  describe('CRUD Operations', () => {
    it('should create a new resource and return it with an id', async () => {
      const userData = {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        status: 'active' as const,
        createdAt: new Date('2024-01-01'),
      }

      const user = await resource.create(userData)

      expect(user).toBeDefined()
      expect(user.id).toBeDefined()
      expect(typeof user.id).toBe('string')
      expect(user.id.length).toBeGreaterThan(0)
      expect(user.name).toBe('Alice')
      expect(user.email).toBe('alice@example.com')
      expect(user.age).toBe(30)
      expect(user.status).toBe('active')
    })

    it('should get a resource by id', async () => {
      const created = await resource.create({
        name: 'Bob',
        email: 'bob@example.com',
        age: 25,
        status: 'active',
        createdAt: new Date(),
      })

      const retrieved = await resource.get(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.name).toBe('Bob')
    })

    it('should return null when getting a non-existent resource', async () => {
      const retrieved = await resource.get('non-existent-id')

      expect(retrieved).toBeNull()
    })

    it('should update a resource and return the updated version', async () => {
      const created = await resource.create({
        name: 'Charlie',
        email: 'charlie@example.com',
        age: 35,
        status: 'active',
        createdAt: new Date(),
      })

      const updated = await resource.update(created.id, { age: 36, status: 'inactive' })

      expect(updated.id).toBe(created.id)
      expect(updated.name).toBe('Charlie') // unchanged
      expect(updated.age).toBe(36) // updated
      expect(updated.status).toBe('inactive') // updated
    })

    it('should throw when updating a non-existent resource', async () => {
      await expect(
        resource.update('non-existent-id', { name: 'Updated' })
      ).rejects.toThrow('Resource not found')
    })

    it('should delete a resource', async () => {
      const created = await resource.create({
        name: 'Dave',
        email: 'dave@example.com',
        age: 40,
        status: 'active',
        createdAt: new Date(),
      })

      await resource.delete(created.id)

      const retrieved = await resource.get(created.id)
      expect(retrieved).toBeNull()
    })

    it('should throw when deleting a non-existent resource', async () => {
      await expect(resource.delete('non-existent-id')).rejects.toThrow('Resource not found')
    })
  })

  // =============================================================================
  // TDD Cycle 3: Query Operations (find, findOne, count)
  // =============================================================================

  describe('Query Operations', () => {
    // Helper to create test data
    async function seedUsers() {
      await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date('2024-01-01') })
      await resource.create({ name: 'Bob', email: 'bob@example.com', age: 30, status: 'active', createdAt: new Date('2024-01-02') })
      await resource.create({ name: 'Charlie', email: 'charlie@example.com', age: 35, status: 'inactive', createdAt: new Date('2024-01-03') })
      await resource.create({ name: 'Dave', email: 'dave@example.com', age: 40, status: 'active', createdAt: new Date('2024-01-04') })
      await resource.create({ name: 'Eve', email: 'eve@example.com', age: 25, status: 'inactive', createdAt: new Date('2024-01-05') })
    }

    describe('find()', () => {
      it('should return all resources when no query is provided', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find()) {
          results.push(user)
        }

        expect(results).toHaveLength(5)
      })

      it('should filter with eq operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ status: { eq: 'active' } })) {
          results.push(user)
        }

        expect(results).toHaveLength(3)
        expect(results.every(u => u.status === 'active')).toBe(true)
      })

      it('should filter with ne operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ status: { ne: 'active' } })) {
          results.push(user)
        }

        expect(results).toHaveLength(2)
        expect(results.every(u => u.status !== 'active')).toBe(true)
      })

      it('should filter with gt operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ age: { gt: 30 } })) {
          results.push(user)
        }

        expect(results).toHaveLength(2) // Charlie (35) and Dave (40)
        expect(results.every(u => u.age > 30)).toBe(true)
      })

      it('should filter with lt operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ age: { lt: 30 } })) {
          results.push(user)
        }

        expect(results).toHaveLength(2) // Alice (25) and Eve (25)
        expect(results.every(u => u.age < 30)).toBe(true)
      })

      it('should filter with gte operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ age: { gte: 35 } })) {
          results.push(user)
        }

        expect(results).toHaveLength(2) // Charlie (35) and Dave (40)
        expect(results.every(u => u.age >= 35)).toBe(true)
      })

      it('should filter with lte operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ age: { lte: 30 } })) {
          results.push(user)
        }

        expect(results).toHaveLength(3) // Alice, Bob, Eve
        expect(results.every(u => u.age <= 30)).toBe(true)
      })

      it('should filter with in operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ age: { in: [25, 40] } })) {
          results.push(user)
        }

        expect(results).toHaveLength(3) // Alice, Dave, Eve
        expect(results.every(u => [25, 40].includes(u.age))).toBe(true)
      })

      it('should filter with nin operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ age: { nin: [25, 40] } })) {
          results.push(user)
        }

        expect(results).toHaveLength(2) // Bob, Charlie
        expect(results.every(u => ![25, 40].includes(u.age))).toBe(true)
      })

      it('should filter with contains operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ email: { contains: 'example.com' } })) {
          results.push(user)
        }

        expect(results).toHaveLength(5) // All have example.com
      })

      it('should filter with startsWith operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ name: { startsWith: 'A' } })) {
          results.push(user)
        }

        expect(results).toHaveLength(1) // Alice
        expect(results[0].name).toBe('Alice')
      })

      it('should filter with endsWith operator', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ name: { endsWith: 'e' } })) {
          results.push(user)
        }

        expect(results).toHaveLength(4) // Alice, Charlie, Dave, Eve
        expect(results.every(u => u.name.endsWith('e'))).toBe(true)
      })

      it('should support direct value equality (shorthand for eq)', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ status: 'active' })) {
          results.push(user)
        }

        expect(results).toHaveLength(3)
        expect(results.every(u => u.status === 'active')).toBe(true)
      })

      it('should support multiple query conditions (AND)', async () => {
        await seedUsers()

        const results: User[] = []
        for await (const user of resource.find({ status: { eq: 'active' }, age: { gt: 25 } })) {
          results.push(user)
        }

        expect(results).toHaveLength(2) // Bob (30, active) and Dave (40, active)
        expect(results.every(u => u.status === 'active' && u.age > 25)).toBe(true)
      })
    })

    describe('findOne()', () => {
      it('should return first matching resource', async () => {
        await seedUsers()

        const user = await resource.findOne({ status: { eq: 'inactive' } })

        expect(user).toBeDefined()
        expect(user!.status).toBe('inactive')
      })

      it('should return null when no match found', async () => {
        await seedUsers()

        const user = await resource.findOne({ age: { gt: 100 } })

        expect(user).toBeNull()
      })
    })

    describe('count()', () => {
      it('should return total count when no query provided', async () => {
        await seedUsers()

        const total = await resource.count()

        expect(total).toBe(5)
      })

      it('should return count of matching resources', async () => {
        await seedUsers()

        const activeCount = await resource.count({ status: { eq: 'active' } })

        expect(activeCount).toBe(3)
      })

      it('should return 0 when no matches', async () => {
        await seedUsers()

        const count = await resource.count({ age: { gt: 100 } })

        expect(count).toBe(0)
      })
    })
  })

  // =============================================================================
  // TDD Cycle 5: Bulk Operations
  // =============================================================================

  describe('Bulk Operations', () => {
    describe('bulkCreate()', () => {
      it('should create multiple resources at once', async () => {
        const items = [
          { name: 'Alice', email: 'alice@example.com', age: 25, status: 'active' as const, createdAt: new Date() },
          { name: 'Bob', email: 'bob@example.com', age: 30, status: 'active' as const, createdAt: new Date() },
          { name: 'Charlie', email: 'charlie@example.com', age: 35, status: 'inactive' as const, createdAt: new Date() },
        ]

        const created = await resource.bulkCreate(items)

        expect(created).toHaveLength(3)
        expect(created[0].id).toBeDefined()
        expect(created[1].id).toBeDefined()
        expect(created[2].id).toBeDefined()
        expect(created[0].name).toBe('Alice')
        expect(created[1].name).toBe('Bob')
        expect(created[2].name).toBe('Charlie')
      })

      it('should have all created resources retrievable', async () => {
        const items = [
          { name: 'Alice', email: 'alice@example.com', age: 25, status: 'active' as const, createdAt: new Date() },
          { name: 'Bob', email: 'bob@example.com', age: 30, status: 'active' as const, createdAt: new Date() },
        ]

        const created = await resource.bulkCreate(items)

        const alice = await resource.get(created[0].id)
        const bob = await resource.get(created[1].id)

        expect(alice).toBeDefined()
        expect(bob).toBeDefined()
        expect(alice!.name).toBe('Alice')
        expect(bob!.name).toBe('Bob')
      })

      it('should return empty array when given empty array', async () => {
        const created = await resource.bulkCreate([])

        expect(created).toHaveLength(0)
      })
    })

    describe('bulkUpdate()', () => {
      it('should update all matching resources', async () => {
        await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date() })
        await resource.create({ name: 'Bob', email: 'bob@example.com', age: 30, status: 'active', createdAt: new Date() })
        await resource.create({ name: 'Charlie', email: 'charlie@example.com', age: 35, status: 'inactive', createdAt: new Date() })

        const updated = await resource.bulkUpdate({ status: { eq: 'active' } }, { status: 'inactive' })

        expect(updated).toBe(2) // Alice and Bob were active

        const results: User[] = []
        for await (const user of resource.find({ status: { eq: 'active' } })) {
          results.push(user)
        }
        expect(results).toHaveLength(0)
      })

      it('should return 0 when no matches', async () => {
        await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date() })

        const updated = await resource.bulkUpdate({ status: { eq: 'inactive' } }, { age: 100 })

        expect(updated).toBe(0)
      })

      it('should update all when no filter provided', async () => {
        await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date() })
        await resource.create({ name: 'Bob', email: 'bob@example.com', age: 30, status: 'inactive', createdAt: new Date() })

        const updated = await resource.bulkUpdate({}, { age: 50 })

        expect(updated).toBe(2)

        const results: User[] = []
        for await (const user of resource.find({ age: { eq: 50 } })) {
          results.push(user)
        }
        expect(results).toHaveLength(2)
      })
    })

    describe('bulkDelete()', () => {
      it('should delete all matching resources', async () => {
        await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date() })
        await resource.create({ name: 'Bob', email: 'bob@example.com', age: 30, status: 'active', createdAt: new Date() })
        await resource.create({ name: 'Charlie', email: 'charlie@example.com', age: 35, status: 'inactive', createdAt: new Date() })

        const deleted = await resource.bulkDelete({ status: { eq: 'active' } })

        expect(deleted).toBe(2)

        const total = await resource.count()
        expect(total).toBe(1) // Only Charlie remains
      })

      it('should return 0 when no matches', async () => {
        await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date() })

        const deleted = await resource.bulkDelete({ status: { eq: 'inactive' } })

        expect(deleted).toBe(0)

        const total = await resource.count()
        expect(total).toBe(1)
      })

      it('should delete all when no filter provided', async () => {
        await resource.create({ name: 'Alice', email: 'alice@example.com', age: 25, status: 'active', createdAt: new Date() })
        await resource.create({ name: 'Bob', email: 'bob@example.com', age: 30, status: 'inactive', createdAt: new Date() })

        const deleted = await resource.bulkDelete({})

        expect(deleted).toBe(2)

        const total = await resource.count()
        expect(total).toBe(0)
      })
    })
  })

  // =============================================================================
  // TDD Cycle 7: Watch/Change Streams
  // =============================================================================

  describe('Watch/Change Streams', () => {
    it('should emit create event when resource is created', async () => {
      const events: ChangeEvent<User>[] = []
      const watcher = resource.watch()

      // Start watching in background
      const watchPromise = (async () => {
        for await (const event of watcher) {
          events.push(event)
          if (events.length >= 1) break
        }
      })()

      // Wait a tick for the watcher to be ready
      await new Promise(r => setTimeout(r, 10))

      // Create a resource
      await resource.create({
        name: 'Alice',
        email: 'alice@example.com',
        age: 25,
        status: 'active',
        createdAt: new Date(),
      })

      // Wait for the event
      await watchPromise

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('create')
      expect(events[0].data?.name).toBe('Alice')
      expect(events[0].timestamp).toBeInstanceOf(Date)
    })

    it('should emit update event when resource is updated', async () => {
      const created = await resource.create({
        name: 'Bob',
        email: 'bob@example.com',
        age: 30,
        status: 'active',
        createdAt: new Date(),
      })

      const events: ChangeEvent<User>[] = []
      const watcher = resource.watch()

      // Start watching in background
      const watchPromise = (async () => {
        for await (const event of watcher) {
          events.push(event)
          if (events.length >= 1) break
        }
      })()

      // Wait a tick for the watcher to be ready
      await new Promise(r => setTimeout(r, 10))

      // Update the resource
      await resource.update(created.id, { age: 31 })

      // Wait for the event
      await watchPromise

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('update')
      expect(events[0].id).toBe(created.id)
      expect(events[0].data?.age).toBe(31)
      expect(events[0].previousData?.age).toBe(30)
    })

    it('should emit delete event when resource is deleted', async () => {
      const created = await resource.create({
        name: 'Charlie',
        email: 'charlie@example.com',
        age: 35,
        status: 'active',
        createdAt: new Date(),
      })

      const events: ChangeEvent<User>[] = []
      const watcher = resource.watch()

      // Start watching in background
      const watchPromise = (async () => {
        for await (const event of watcher) {
          events.push(event)
          if (events.length >= 1) break
        }
      })()

      // Wait a tick for the watcher to be ready
      await new Promise(r => setTimeout(r, 10))

      // Delete the resource
      await resource.delete(created.id)

      // Wait for the event
      await watchPromise

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('delete')
      expect(events[0].id).toBe(created.id)
      expect(events[0].previousData?.name).toBe('Charlie')
    })

    it('should filter watch events by query', async () => {
      const events: ChangeEvent<User>[] = []
      const watcher = resource.watch({ status: { eq: 'active' } })

      // Start watching in background
      const watchPromise = (async () => {
        for await (const event of watcher) {
          events.push(event)
          if (events.length >= 1) break
        }
      })()

      // Wait a tick for the watcher to be ready
      await new Promise(r => setTimeout(r, 10))

      // Create inactive user - should NOT trigger event
      await resource.create({
        name: 'Inactive',
        email: 'inactive@example.com',
        age: 20,
        status: 'inactive',
        createdAt: new Date(),
      })

      // Create active user - SHOULD trigger event
      await resource.create({
        name: 'Active',
        email: 'active@example.com',
        age: 25,
        status: 'active',
        createdAt: new Date(),
      })

      // Wait for the event
      await watchPromise

      expect(events).toHaveLength(1)
      expect(events[0].data?.name).toBe('Active')
      expect(events[0].data?.status).toBe('active')
    })

    it('should emit events for bulk operations', async () => {
      const events: ChangeEvent<User>[] = []
      const watcher = resource.watch()

      // Start watching in background
      const watchPromise = (async () => {
        for await (const event of watcher) {
          events.push(event)
          if (events.length >= 2) break
        }
      })()

      // Wait a tick for the watcher to be ready
      await new Promise(r => setTimeout(r, 10))

      // Bulk create
      await resource.bulkCreate([
        { name: 'User1', email: 'user1@example.com', age: 20, status: 'active', createdAt: new Date() },
        { name: 'User2', email: 'user2@example.com', age: 25, status: 'active', createdAt: new Date() },
      ])

      // Wait for events
      await watchPromise

      expect(events).toHaveLength(2)
      expect(events.every(e => e.type === 'create')).toBe(true)
    })
  })

  // =============================================================================
  // TDD Cycle 9: Schema Introspection
  // =============================================================================

  describe('Schema Introspection', () => {
    it('should return schema with field definitions', () => {
      // Create a resource with schema defined
      const userResource = new InMemoryResource<User>({
        schema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          email: { type: 'string', required: true, unique: true },
          age: { type: 'number', required: false },
          status: { type: 'string', required: true },
          createdAt: { type: 'date', required: true },
        },
      })

      const schema = userResource.schema()

      expect(schema.id).toBeDefined()
      expect(schema.id.type).toBe('string')
      expect(schema.id.required).toBe(true)

      expect(schema.email).toBeDefined()
      expect(schema.email.unique).toBe(true)

      expect(schema.age).toBeDefined()
      expect(schema.age.type).toBe('number')
      expect(schema.age.required).toBe(false)

      expect(schema.createdAt).toBeDefined()
      expect(schema.createdAt.type).toBe('date')
    })

    it('should return empty schema when no schema defined', () => {
      const schema = resource.schema()

      // When no schema is defined, return an empty object
      expect(schema).toBeDefined()
      expect(typeof schema).toBe('object')
    })

    it('should support indexed fields in schema', () => {
      const indexedResource = new InMemoryResource<User>({
        schema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true, indexed: true },
          email: { type: 'string', required: true, unique: true, indexed: true },
          age: { type: 'number', required: false },
          status: { type: 'string', required: true, indexed: true },
          createdAt: { type: 'date', required: true },
        },
      })

      const schema = indexedResource.schema()

      expect(schema.name.indexed).toBe(true)
      expect(schema.email.indexed).toBe(true)
      expect(schema.status.indexed).toBe(true)
      expect(schema.age.indexed).toBeUndefined()
    })

    it('should support default values in schema', () => {
      const defaultResource = new InMemoryResource<User>({
        schema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
          age: { type: 'number', required: false, default: 0 },
          status: { type: 'string', required: true, default: 'active' },
          createdAt: { type: 'date', required: true },
        },
      })

      const schema = defaultResource.schema()

      expect(schema.age.default).toBe(0)
      expect(schema.status.default).toBe('active')
    })
  })

  // =============================================================================
  // TDD Cycle 11: Custom Storage Backend
  // =============================================================================

  describe('Custom Storage Backend', () => {
    it('should work with a custom storage backend', async () => {
      // Import the storage backend types
      const { MemoryStorageBackend } = await import('../types')

      // Create a custom storage backend
      const customStorage = new MemoryStorageBackend<User>()

      // Create resource with custom storage
      const customResource = new InMemoryResource<User>({
        storage: customStorage,
      })

      // Test CRUD operations work with custom storage
      const created = await customResource.create({
        name: 'CustomUser',
        email: 'custom@example.com',
        age: 30,
        status: 'active',
        createdAt: new Date(),
      })

      expect(created.name).toBe('CustomUser')

      const retrieved = await customResource.get(created.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.name).toBe('CustomUser')

      // Verify storage backend has the data
      const storageValue = await customStorage.get(created.id)
      expect(storageValue).toBeDefined()
      expect(storageValue!.name).toBe('CustomUser')
    })

    it('should expose matchesQuery for custom implementations', async () => {
      const { matchesQuery } = await import('../index')

      const user = {
        id: '1',
        name: 'Test',
        email: 'test@example.com',
        age: 25,
        status: 'active' as const,
        createdAt: new Date(),
      }

      // Test direct usage of matchesQuery
      expect(matchesQuery(user, { status: { eq: 'active' } })).toBe(true)
      expect(matchesQuery(user, { status: { eq: 'inactive' } })).toBe(false)
      expect(matchesQuery(user, { age: { gt: 20 } })).toBe(true)
      expect(matchesQuery(user, { age: { gt: 30 } })).toBe(false)
    })
  })
})
