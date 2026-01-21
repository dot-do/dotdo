import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type ThingsStore } from '../../db/things'
import { createSearchTool } from '../search'
import type { MCPTool } from '../server'

describe('Search Tool', () => {
  let store: ThingsStore
  let searchTool: MCPTool

  beforeEach(async () => {
    store = createThingsStore()
    searchTool = createSearchTool(store)

    // Seed test data
    await store.create({ $type: 'User', name: 'Alice Smith', email: 'alice@example.com', role: 'admin', age: 30 })
    await store.create({ $type: 'User', name: 'Bob Jones', email: 'bob@example.com', role: 'user', age: 25 })
    await store.create({ $type: 'User', name: 'Charlie Brown', email: 'charlie@example.com', role: 'user', age: 35 })
    await store.create({ $type: 'Order', total: 100, status: 'pending', userId: 'alice-id' })
    await store.create({ $type: 'Order', total: 200, status: 'completed', userId: 'bob-id' })
    await store.create({ $type: 'Product', name: 'Widget', price: 29.99, category: 'tools' })
    await store.create({ $type: 'Product', name: 'Gadget', price: 49.99, category: 'electronics' })
  })

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(searchTool.name).toBe('search')
    })

    it('should have description', () => {
      expect(searchTool.description).toBeTruthy()
      expect(typeof searchTool.description).toBe('string')
    })

    it('should have input schema', () => {
      expect(searchTool.inputSchema).toBeTruthy()
      expect(searchTool.inputSchema).toHaveProperty('type', 'object')
    })
  })

  describe('search by type only', () => {
    it('should search for all Things of a type', async () => {
      const result = await searchTool.execute({ $type: 'User' })
      expect(result).toHaveProperty('results')
      expect(result.results).toHaveLength(3)
      expect(result.results.every((r: any) => r.$type === 'User')).toBe(true)
    })

    it('should search for Orders', async () => {
      const result = await searchTool.execute({ $type: 'Order' })
      expect(result.results).toHaveLength(2)
      expect(result.results.every((r: any) => r.$type === 'Order')).toBe(true)
    })

    it('should return empty array for non-existent type', async () => {
      const result = await searchTool.execute({ $type: 'NonExistent' })
      expect(result.results).toHaveLength(0)
    })
  })

  describe('search by field values', () => {
    it('should search by single field', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        where: { role: 'admin' }
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Alice Smith')
    })

    it('should search by multiple fields', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        where: { role: 'user', age: 25 }
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Bob Jones')
    })

    it('should return empty when no matches', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        where: { role: 'superadmin' }
      })

      expect(result.results).toHaveLength(0)
    })
  })

  describe('full-text search', () => {
    it('should search across all text fields with query parameter', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        query: 'alice'
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Alice Smith')
    })

    it('should be case-insensitive', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        query: 'ALICE'
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Alice Smith')
    })

    it('should search in any string field', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        query: 'bob@example.com'
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Bob Jones')
    })

    it('should work with partial matches', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        query: 'example.com'
      })

      expect(result.results).toHaveLength(3)
    })
  })

  describe('pagination', () => {
    it('should respect limit parameter', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        limit: 2
      })

      expect(result.results).toHaveLength(2)
      expect(result.total).toBe(3)
      expect(result.hasMore).toBe(true)
    })

    it('should respect offset parameter', async () => {
      const page1 = await searchTool.execute({
        $type: 'User',
        limit: 2,
        offset: 0
      })

      const page2 = await searchTool.execute({
        $type: 'User',
        limit: 2,
        offset: 2
      })

      expect(page1.results).toHaveLength(2)
      expect(page2.results).toHaveLength(1)
      expect(page1.results[0].$id).not.toBe(page2.results[0].$id)
    })

    it('should default to limit of 20', async () => {
      // Create more than 20 items
      for (let i = 0; i < 25; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const result = await searchTool.execute({ $type: 'Item' })
      expect(result.results).toHaveLength(20)
      expect(result.total).toBe(25)
      expect(result.hasMore).toBe(true)
    })

    it('should calculate hasMore correctly', async () => {
      const result1 = await searchTool.execute({ $type: 'User', limit: 2 })
      expect(result1.hasMore).toBe(true)

      const result2 = await searchTool.execute({ $type: 'User', limit: 10 })
      expect(result2.hasMore).toBe(false)
    })
  })

  describe('sorting', () => {
    it('should sort by field ascending', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        orderBy: 'age',
        order: 'asc'
      })

      expect(result.results[0].age).toBe(25)
      expect(result.results[2].age).toBe(35)
    })

    it('should sort by field descending', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        orderBy: 'age',
        order: 'desc'
      })

      expect(result.results[0].age).toBe(35)
      expect(result.results[2].age).toBe(25)
    })

    it('should default to descending order', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        orderBy: 'age'
      })

      expect(result.results[0].age).toBe(35)
    })
  })

  describe('combined filters', () => {
    it('should combine type, where, and query', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        where: { role: 'user' },
        query: 'bob'
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Bob Jones')
    })

    it('should combine all parameters', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        where: { role: 'user' },
        query: 'example.com',
        orderBy: 'age',
        order: 'asc',
        limit: 1,
        offset: 0
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Bob Jones')
      expect(result.total).toBe(2)
    })
  })

  describe('field selection', () => {
    it('should select specific fields', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        select: ['name', 'email']
      })

      expect(result.results[0]).toHaveProperty('$id')
      expect(result.results[0]).toHaveProperty('$type')
      expect(result.results[0]).toHaveProperty('name')
      expect(result.results[0]).toHaveProperty('email')
      expect(result.results[0]).not.toHaveProperty('age')
      expect(result.results[0]).not.toHaveProperty('role')
    })

    it('should always include $id and $type', async () => {
      const result = await searchTool.execute({
        $type: 'User',
        select: ['name']
      })

      expect(result.results[0]).toHaveProperty('$id')
      expect(result.results[0]).toHaveProperty('$type')
    })
  })

  describe('search without type', () => {
    it('should search across all types with query', async () => {
      const result = await searchTool.execute({
        query: 'example.com'
      })

      expect(result.results).toHaveLength(3)
      expect(result.results.every((r: any) => r.$type === 'User')).toBe(true)
    })

    it('should return all Things when no filters', async () => {
      const result = await searchTool.execute({})

      expect(result.results.length).toBeGreaterThan(0)
      // Should include Users, Orders, and Products
      const types = new Set(result.results.map((r: any) => r.$type))
      expect(types.size).toBeGreaterThan(1)
    })
  })

  describe('error handling', () => {
    it('should handle invalid limit', async () => {
      await expect(
        searchTool.execute({ $type: 'User', limit: -1 })
      ).rejects.toThrow()
    })

    it('should handle invalid offset', async () => {
      await expect(
        searchTool.execute({ $type: 'User', offset: -1 })
      ).rejects.toThrow()
    })

    it('should handle invalid order', async () => {
      await expect(
        searchTool.execute({ $type: 'User', orderBy: 'age', order: 'invalid' as any })
      ).rejects.toThrow()
    })
  })
})
