import { describe, it, expect } from 'vitest'
import { createPipeline, withPipeline } from '../pipeline'

describe('Pipeline/Promise Chaining', () => {
  describe('createPipeline', () => {
    it('should create a pipeline from a promise', async () => {
      const pipeline = createPipeline(Promise.resolve({ name: 'Alice', age: 30 }))
      const result = await pipeline

      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('should support .pipe() for transformations', async () => {
      const pipeline = createPipeline(Promise.resolve(5))
        .pipe(x => x * 2)
        .pipe(x => x + 1)

      expect(await pipeline).toBe(11)
    })

    it('should support .get() for property access', async () => {
      const pipeline = createPipeline(Promise.resolve({ user: { name: 'Bob' } }))
        .get('user')
        .get('name')

      expect(await pipeline).toBe('Bob')
    })

    it('should support .call() for method invocation', async () => {
      const obj = {
        items: [1, 2, 3],
        getTotal() { return this.items.reduce((a, b) => a + b, 0) }
      }

      const pipeline = createPipeline(Promise.resolve(obj))
        .call('getTotal')

      expect(await pipeline).toBe(6)
    })

    it('should chain multiple operations', async () => {
      const data = {
        users: [
          { name: 'Alice', score: 10 },
          { name: 'Bob', score: 20 }
        ],
        getUser(index: number) { return this.users[index] }
      }

      const result = await createPipeline(Promise.resolve(data))
        .call('getUser', 1)
        .get('name')

      expect(result).toBe('Bob')
    })

    it('should handle async pipe functions', async () => {
      const pipeline = createPipeline(Promise.resolve(5))
        .pipe(async x => {
          await new Promise(r => setTimeout(r, 10))
          return x * 2
        })

      expect(await pipeline).toBe(10)
    })
  })

  describe('withPipeline', () => {
    it('should wrap client methods to return pipelines', async () => {
      const client = {
        async getUser(id: string) {
          return { id, name: 'Test User' }
        }
      }

      const pipelinedClient = withPipeline(client)
      const name = await pipelinedClient.getUser('123').get('name')

      expect(name).toBe('Test User')
    })

    it('should allow chaining across multiple calls', async () => {
      const client = {
        async getOrder(id: string) {
          return { id, items: [{ name: 'Widget', price: 10 }] }
        }
      }

      const pipelinedClient = withPipeline(client)
      const items = await pipelinedClient.getOrder('order-1')
        .get('items')
        .pipe(items => items.length)

      expect(items).toBe(1)
    })
  })
})
