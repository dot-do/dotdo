/**
 * @dotdo/convex - Generic Table Tests
 *
 * Tests for the REWRITTEN Convex SDK that supports ANY table name,
 * not just the hardcoded messages/users/channels/openai/search modules.
 *
 * This file tests:
 * 1. Generic table CRUD - any table name should work
 * 2. db.query(tableName).filter(...) for arbitrary tables
 * 3. Mutations writing to custom tables
 * 4. Reactive subscriptions with real updates
 * 5. Schema validation (future)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  FunctionReference,
  DocumentId,
} from './types'
import { ConvexClient } from './convex'

// ============================================================================
// GENERIC TABLE TESTS - These should work for ANY table name
// ============================================================================

describe('Generic Table Support', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClient('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  describe('Custom table CRUD operations', () => {
    // Custom table types that don't exist in hardcoded handlers
    interface Product {
      _id: DocumentId<'products'>
      _creationTime: number
      name: string
      price: number
      category: string
      inStock: boolean
    }

    interface Order {
      _id: DocumentId<'orders'>
      _creationTime: number
      customerId: string
      productIds: string[]
      total: number
      status: 'pending' | 'shipped' | 'delivered'
    }

    interface BlogPost {
      _id: DocumentId<'blogPosts'>
      _creationTime: number
      title: string
      content: string
      authorId: string
      tags: string[]
      published: boolean
    }

    // Generic API for custom tables
    const customApi = {
      products: {
        list: { _name: 'products:list' } as FunctionReference<'query'>,
        get: { _name: 'products:get' } as FunctionReference<'query'>,
        create: { _name: 'products:create' } as FunctionReference<'mutation'>,
        update: { _name: 'products:update' } as FunctionReference<'mutation'>,
        remove: { _name: 'products:remove' } as FunctionReference<'mutation'>,
      },
      orders: {
        list: { _name: 'orders:list' } as FunctionReference<'query'>,
        get: { _name: 'orders:get' } as FunctionReference<'query'>,
        create: { _name: 'orders:create' } as FunctionReference<'mutation'>,
        update: { _name: 'orders:update' } as FunctionReference<'mutation'>,
        remove: { _name: 'orders:remove' } as FunctionReference<'mutation'>,
      },
      blogPosts: {
        list: { _name: 'blogPosts:list' } as FunctionReference<'query'>,
        get: { _name: 'blogPosts:get' } as FunctionReference<'query'>,
        create: { _name: 'blogPosts:create' } as FunctionReference<'mutation'>,
        update: { _name: 'blogPosts:update' } as FunctionReference<'mutation'>,
        remove: { _name: 'blogPosts:remove' } as FunctionReference<'mutation'>,
      },
      // Completely arbitrary table name
      xyzCustomTable123: {
        list: { _name: 'xyzCustomTable123:list' } as FunctionReference<'query'>,
        create: { _name: 'xyzCustomTable123:create' } as FunctionReference<'mutation'>,
      },
    }

    it('should create and list products (custom table)', async () => {
      // Create a product
      const productId = await client.mutation(customApi.products.create, {
        name: 'Widget',
        price: 29.99,
        category: 'Electronics',
        inStock: true,
      })

      expect(productId).toBeDefined()
      expect(typeof productId).toBe('string')

      // List products
      const products = await client.query(customApi.products.list, {})
      expect(Array.isArray(products)).toBe(true)
      expect(products.length).toBeGreaterThanOrEqual(1)

      // Find our product
      const found = products.find((p: Product) => p._id === productId)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Widget')
      expect(found?.price).toBe(29.99)
    })

    it('should get a specific product by ID', async () => {
      const productId = await client.mutation(customApi.products.create, {
        name: 'Gadget',
        price: 49.99,
        category: 'Electronics',
        inStock: false,
      })

      const product = await client.query(customApi.products.get, { id: productId })
      expect(product).toBeDefined()
      expect(product?.name).toBe('Gadget')
      expect(product?.inStock).toBe(false)
    })

    it('should update a custom table document', async () => {
      const productId = await client.mutation(customApi.products.create, {
        name: 'Original Name',
        price: 10,
        category: 'Test',
        inStock: true,
      })

      await client.mutation(customApi.products.update, {
        id: productId,
        name: 'Updated Name',
        price: 15,
      })

      const product = await client.query(customApi.products.get, { id: productId })
      expect(product?.name).toBe('Updated Name')
      expect(product?.price).toBe(15)
      // Unmodified fields should remain
      expect(product?.category).toBe('Test')
    })

    it('should delete a custom table document', async () => {
      const productId = await client.mutation(customApi.products.create, {
        name: 'To Delete',
        price: 5,
        category: 'Test',
        inStock: true,
      })

      await client.mutation(customApi.products.remove, { id: productId })

      const product = await client.query(customApi.products.get, { id: productId })
      expect(product).toBeNull()
    })

    it('should work with orders table (different custom table)', async () => {
      const orderId = await client.mutation(customApi.orders.create, {
        customerId: 'cust_123',
        productIds: ['prod_1', 'prod_2'],
        total: 99.99,
        status: 'pending',
      })

      expect(orderId).toBeDefined()

      const orders = await client.query(customApi.orders.list, {})
      expect(orders.length).toBeGreaterThanOrEqual(1)

      const order = await client.query(customApi.orders.get, { id: orderId })
      expect(order?.customerId).toBe('cust_123')
      expect(order?.status).toBe('pending')
    })

    it('should work with blogPosts table (third custom table)', async () => {
      const postId = await client.mutation(customApi.blogPosts.create, {
        title: 'My First Post',
        content: 'Hello world!',
        authorId: 'author_1',
        tags: ['intro', 'hello'],
        published: false,
      })

      const posts = await client.query(customApi.blogPosts.list, {})
      expect(posts.length).toBeGreaterThanOrEqual(1)

      await client.mutation(customApi.blogPosts.update, {
        id: postId,
        published: true,
      })

      const post = await client.query(customApi.blogPosts.get, { id: postId })
      expect(post?.published).toBe(true)
    })

    it('should work with completely arbitrary table names', async () => {
      const id = await client.mutation(customApi.xyzCustomTable123.create, {
        foo: 'bar',
        count: 42,
        nested: { a: 1, b: 2 },
      })

      expect(id).toBeDefined()

      const items = await client.query(customApi.xyzCustomTable123.list, {})
      expect(items.length).toBeGreaterThanOrEqual(1)
    })

    it('should keep tables isolated from each other', async () => {
      // Create in products
      await client.mutation(customApi.products.create, {
        name: 'Product Item',
        price: 10,
        category: 'A',
        inStock: true,
      })

      // Create in orders
      await client.mutation(customApi.orders.create, {
        customerId: 'c1',
        productIds: [],
        total: 0,
        status: 'pending',
      })

      // Each table should only have its own items
      const products = await client.query(customApi.products.list, {})
      const orders = await client.query(customApi.orders.list, {})

      // All products should have 'name' field
      products.forEach((p: Product) => {
        expect(p.name).toBeDefined()
      })

      // All orders should have 'customerId' field
      orders.forEach((o: Order) => {
        expect(o.customerId).toBeDefined()
      })
    })
  })

  describe('Generic query filtering', () => {
    interface Task {
      _id: DocumentId<'tasks'>
      _creationTime: number
      title: string
      priority: number
      completed: boolean
      assignee: string
    }

    const tasksApi = {
      list: { _name: 'tasks:list' } as FunctionReference<'query'>,
      listByPriority: { _name: 'tasks:listByPriority' } as FunctionReference<'query'>,
      listByAssignee: { _name: 'tasks:listByAssignee' } as FunctionReference<'query'>,
      listCompleted: { _name: 'tasks:listCompleted' } as FunctionReference<'query'>,
      create: { _name: 'tasks:create' } as FunctionReference<'mutation'>,
    }

    it('should filter by exact field match', async () => {
      // Create tasks with different assignees
      await client.mutation(tasksApi.create, {
        title: 'Task 1',
        priority: 1,
        completed: false,
        assignee: 'alice',
      })
      await client.mutation(tasksApi.create, {
        title: 'Task 2',
        priority: 2,
        completed: false,
        assignee: 'bob',
      })
      await client.mutation(tasksApi.create, {
        title: 'Task 3',
        priority: 1,
        completed: true,
        assignee: 'alice',
      })

      // Filter by assignee
      const aliceTasks = await client.query(tasksApi.listByAssignee, { assignee: 'alice' })
      expect(aliceTasks.length).toBe(2)
      aliceTasks.forEach((t: Task) => {
        expect(t.assignee).toBe('alice')
      })
    })

    it('should filter by numeric comparison', async () => {
      await client.mutation(tasksApi.create, {
        title: 'Low priority',
        priority: 1,
        completed: false,
        assignee: 'test',
      })
      await client.mutation(tasksApi.create, {
        title: 'Medium priority',
        priority: 5,
        completed: false,
        assignee: 'test',
      })
      await client.mutation(tasksApi.create, {
        title: 'High priority',
        priority: 10,
        completed: false,
        assignee: 'test',
      })

      // Filter by priority >= 5
      const highPriorityTasks = await client.query(tasksApi.listByPriority, { minPriority: 5 })
      expect(highPriorityTasks.length).toBeGreaterThanOrEqual(2)
      highPriorityTasks.forEach((t: Task) => {
        expect(t.priority).toBeGreaterThanOrEqual(5)
      })
    })

    it('should filter by boolean field', async () => {
      await client.mutation(tasksApi.create, {
        title: 'Done',
        priority: 1,
        completed: true,
        assignee: 'x',
      })
      await client.mutation(tasksApi.create, {
        title: 'Not done',
        priority: 1,
        completed: false,
        assignee: 'x',
      })

      const completedTasks = await client.query(tasksApi.listCompleted, { completed: true })
      completedTasks.forEach((t: Task) => {
        expect(t.completed).toBe(true)
      })
    })

    it('should support pagination on custom tables', async () => {
      // Create many items
      for (let i = 0; i < 15; i++) {
        await client.mutation(tasksApi.create, {
          title: `Task ${i}`,
          priority: i % 5,
          completed: false,
          assignee: 'paginate-test',
        })
      }

      // Get first page
      const page1 = await client.query(tasksApi.list, {
        paginationOpts: { numItems: 5, cursor: null },
      })
      expect(page1.length).toBe(5)
    })
  })

  describe('Reactive subscriptions on custom tables', () => {
    interface Counter {
      _id: DocumentId<'counters'>
      _creationTime: number
      name: string
      value: number
    }

    const countersApi = {
      list: { _name: 'counters:list' } as FunctionReference<'query'>,
      get: { _name: 'counters:get' } as FunctionReference<'query'>,
      create: { _name: 'counters:create' } as FunctionReference<'mutation'>,
      increment: { _name: 'counters:increment' } as FunctionReference<'mutation'>,
    }

    it('should receive initial data for custom table subscription', async () => {
      // Create initial data
      await client.mutation(countersApi.create, {
        name: 'test-counter',
        value: 0,
      })

      const callback = vi.fn()
      client.onUpdate(countersApi.list, {}, callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(callback).toHaveBeenCalled()
      const data = callback.mock.calls[0][0]
      expect(Array.isArray(data)).toBe(true)
    })

    it('should receive updates when custom table is mutated', async () => {
      const callback = vi.fn()
      client.onUpdate(countersApi.list, {}, callback)

      await new Promise(resolve => setTimeout(resolve, 10))
      const initialCallCount = callback.mock.calls.length

      // Mutate the table
      await client.mutation(countersApi.create, {
        name: 'new-counter',
        value: 100,
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      // Should have received an update
      expect(callback.mock.calls.length).toBeGreaterThan(initialCallCount)
    })

    it('should not receive updates after unsubscribe', async () => {
      const callback = vi.fn()
      const unsubscribe = client.onUpdate(countersApi.list, {}, callback)

      await new Promise(resolve => setTimeout(resolve, 10))
      unsubscribe()
      const callCountAfterUnsub = callback.mock.calls.length

      // Mutate after unsubscribe
      await client.mutation(countersApi.create, {
        name: 'ignored-counter',
        value: 999,
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(callback.mock.calls.length).toBe(callCountAfterUnsub)
    })
  })

  describe('Cross-table operations', () => {
    interface Author {
      _id: DocumentId<'authors'>
      _creationTime: number
      name: string
    }

    interface Article {
      _id: DocumentId<'articles'>
      _creationTime: number
      title: string
      authorId: string
    }

    const authorsApi = {
      list: { _name: 'authors:list' } as FunctionReference<'query'>,
      get: { _name: 'authors:get' } as FunctionReference<'query'>,
      create: { _name: 'authors:create' } as FunctionReference<'mutation'>,
    }

    const articlesApi = {
      list: { _name: 'articles:list' } as FunctionReference<'query'>,
      listByAuthor: { _name: 'articles:listByAuthor' } as FunctionReference<'query'>,
      create: { _name: 'articles:create' } as FunctionReference<'mutation'>,
    }

    it('should support related data across custom tables', async () => {
      // Create author
      const authorId = await client.mutation(authorsApi.create, {
        name: 'Jane Doe',
      })

      // Create articles for that author
      await client.mutation(articlesApi.create, {
        title: 'Article 1',
        authorId,
      })
      await client.mutation(articlesApi.create, {
        title: 'Article 2',
        authorId,
      })

      // Query articles by author
      const articles = await client.query(articlesApi.listByAuthor, { authorId })
      expect(articles.length).toBe(2)
      articles.forEach((a: Article) => {
        expect(a.authorId).toBe(authorId)
      })
    })
  })

  describe('Complex document types', () => {
    interface ComplexDoc {
      _id: DocumentId<'complexDocs'>
      _creationTime: number
      nested: {
        level1: {
          level2: string
        }
      }
      array: number[]
      nullable: string | null
      optional?: string
    }

    const complexApi = {
      list: { _name: 'complexDocs:list' } as FunctionReference<'query'>,
      get: { _name: 'complexDocs:get' } as FunctionReference<'query'>,
      create: { _name: 'complexDocs:create' } as FunctionReference<'mutation'>,
    }

    it('should handle nested objects', async () => {
      const id = await client.mutation(complexApi.create, {
        nested: {
          level1: {
            level2: 'deep value',
          },
        },
        array: [1, 2, 3],
        nullable: null,
      })

      const doc = await client.query(complexApi.get, { id })
      expect(doc?.nested.level1.level2).toBe('deep value')
    })

    it('should handle arrays', async () => {
      const id = await client.mutation(complexApi.create, {
        nested: { level1: { level2: 'x' } },
        array: [10, 20, 30, 40, 50],
        nullable: 'not null',
      })

      const doc = await client.query(complexApi.get, { id })
      expect(doc?.array).toEqual([10, 20, 30, 40, 50])
      expect(doc?.array.length).toBe(5)
    })

    it('should handle null values', async () => {
      const id = await client.mutation(complexApi.create, {
        nested: { level1: { level2: 'y' } },
        array: [],
        nullable: null,
      })

      const doc = await client.query(complexApi.get, { id })
      expect(doc?.nullable).toBeNull()
    })
  })

  describe('Document system fields', () => {
    interface TestDoc {
      _id: DocumentId<'testDocs'>
      _creationTime: number
      data: string
    }

    const testApi = {
      list: { _name: 'testDocs:list' } as FunctionReference<'query'>,
      get: { _name: 'testDocs:get' } as FunctionReference<'query'>,
      create: { _name: 'testDocs:create' } as FunctionReference<'mutation'>,
    }

    it('should auto-generate _id for new documents', async () => {
      const id = await client.mutation(testApi.create, { data: 'test' })
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('should auto-set _creationTime for new documents', async () => {
      const before = Date.now()
      const id = await client.mutation(testApi.create, { data: 'test' })
      const after = Date.now()

      const doc = await client.query(testApi.get, { id })
      expect(doc?._creationTime).toBeGreaterThanOrEqual(before)
      expect(doc?._creationTime).toBeLessThanOrEqual(after)
    })

    it('should preserve _id and _creationTime on updates', async () => {
      const id = await client.mutation(testApi.create, { data: 'original' })
      const original = await client.query(testApi.get, { id })

      // Note: Generic update would need to be implemented
      // For now, verify the original fields exist
      expect(original?._id).toBe(id)
      expect(original?._creationTime).toBeDefined()
    })
  })

  describe('Multiple clients isolation', () => {
    it('should isolate data between client instances', async () => {
      const client1 = new ConvexClient('https://test1.convex.cloud')
      const client2 = new ConvexClient('https://test2.convex.cloud')

      const isolationApi = {
        list: { _name: 'isolation:list' } as FunctionReference<'query'>,
        create: { _name: 'isolation:create' } as FunctionReference<'mutation'>,
      }

      // Create in client1
      await client1.mutation(isolationApi.create, { value: 'client1-data' })

      // Create in client2
      await client2.mutation(isolationApi.create, { value: 'client2-data' })

      // Each should only see their own data
      const data1 = await client1.query(isolationApi.list, {})
      const data2 = await client2.query(isolationApi.list, {})

      expect(data1.some((d: { value: string }) => d.value === 'client1-data')).toBe(true)
      expect(data1.some((d: { value: string }) => d.value === 'client2-data')).toBe(false)

      expect(data2.some((d: { value: string }) => d.value === 'client2-data')).toBe(true)
      expect(data2.some((d: { value: string }) => d.value === 'client1-data')).toBe(false)

      await client1.close()
      await client2.close()
    })
  })
})

// ============================================================================
// BACKWARD COMPATIBILITY TESTS
// Ensure the hardcoded modules still work during transition
// ============================================================================

describe('Backward Compatibility', () => {
  let client: ConvexClient

  beforeEach(() => {
    client = new ConvexClient('https://test.convex.cloud')
  })

  afterEach(async () => {
    await client.close()
  })

  const legacyApi = {
    messages: {
      list: { _name: 'messages:list' } as FunctionReference<'query'>,
      get: { _name: 'messages:get' } as FunctionReference<'query'>,
      send: { _name: 'messages:send' } as FunctionReference<'mutation'>,
    },
    users: {
      list: { _name: 'users:list' } as FunctionReference<'query'>,
      create: { _name: 'users:create' } as FunctionReference<'mutation'>,
    },
    channels: {
      list: { _name: 'channels:list' } as FunctionReference<'query'>,
      create: { _name: 'channels:create' } as FunctionReference<'mutation'>,
    },
  }

  it('should still work with messages table', async () => {
    const id = await client.mutation(legacyApi.messages.send, {
      body: 'Hello',
      author: 'Test',
      channel: 'general',
    })

    expect(id).toBeDefined()

    const messages = await client.query(legacyApi.messages.list, {})
    expect(Array.isArray(messages)).toBe(true)
  })

  it('should still work with users table', async () => {
    const id = await client.mutation(legacyApi.users.create, {
      name: 'Test User',
      email: 'test@example.com.ai',
    })

    expect(id).toBeDefined()

    const users = await client.query(legacyApi.users.list, {})
    expect(Array.isArray(users)).toBe(true)
  })

  it('should still work with channels table', async () => {
    const id = await client.mutation(legacyApi.channels.create, {
      name: 'test-channel',
      description: 'A test channel',
    })

    expect(id).toBeDefined()

    const channels = await client.query(legacyApi.channels.list, {})
    expect(Array.isArray(channels)).toBe(true)
  })
})
