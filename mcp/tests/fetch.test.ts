import { describe, it, expect, beforeEach } from 'vitest'
import { createFetchTool, isFetchParams } from '../tools/fetch'
import { createThingsStore } from '../../db/things'
import { createRelationshipsStore } from '../../db/relationships'
import { createEventsStore } from '../../db/events'

describe('isFetchParams type guard', () => {
  it('should return true for valid params with $id only', () => {
    expect(isFetchParams({ $id: 'test-id' })).toBe(true)
  })

  it('should return true for valid params with $id and empty include', () => {
    expect(isFetchParams({ $id: 'test-id', include: [] })).toBe(true)
  })

  it('should return true for valid params with relationships include', () => {
    expect(isFetchParams({ $id: 'test-id', include: ['relationships'] })).toBe(true)
  })

  it('should return true for valid params with events include', () => {
    expect(isFetchParams({ $id: 'test-id', include: ['events'] })).toBe(true)
  })

  it('should return true for valid params with both includes', () => {
    expect(isFetchParams({ $id: 'test-id', include: ['relationships', 'events'] })).toBe(true)
  })

  it('should return false for null', () => {
    expect(isFetchParams(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isFetchParams(undefined)).toBe(false)
  })

  it('should return false for non-object types', () => {
    expect(isFetchParams('string')).toBe(false)
    expect(isFetchParams(123)).toBe(false)
    expect(isFetchParams(true)).toBe(false)
  })

  it('should return false for missing $id', () => {
    expect(isFetchParams({})).toBe(false)
    expect(isFetchParams({ include: ['events'] })).toBe(false)
  })

  it('should return false for non-string $id', () => {
    expect(isFetchParams({ $id: 123 })).toBe(false)
    expect(isFetchParams({ $id: null })).toBe(false)
    expect(isFetchParams({ $id: undefined })).toBe(false)
    expect(isFetchParams({ $id: {} })).toBe(false)
  })

  it('should return false for empty string $id', () => {
    expect(isFetchParams({ $id: '' })).toBe(false)
  })

  it('should return false for invalid include type', () => {
    expect(isFetchParams({ $id: 'test-id', include: 'relationships' })).toBe(false)
    expect(isFetchParams({ $id: 'test-id', include: 123 })).toBe(false)
  })

  it('should return false for invalid include values', () => {
    expect(isFetchParams({ $id: 'test-id', include: ['invalid'] })).toBe(false)
    expect(isFetchParams({ $id: 'test-id', include: ['relationships', 'invalid'] })).toBe(false)
    expect(isFetchParams({ $id: 'test-id', include: [123] })).toBe(false)
  })

  it('should allow extra properties (non-strict)', () => {
    expect(isFetchParams({ $id: 'test-id', extra: 'property' })).toBe(true)
  })
})

describe('Fetch Tool', () => {
  let things: ReturnType<typeof createThingsStore>
  let relationships: ReturnType<typeof createRelationshipsStore>
  let events: ReturnType<typeof createEventsStore>
  let fetchTool: ReturnType<typeof createFetchTool>

  beforeEach(() => {
    things = createThingsStore()
    relationships = createRelationshipsStore()
    events = createEventsStore()
    fetchTool = createFetchTool({ things, relationships, events })
  })

  describe('schema validation', () => {
    it('should have correct MCP tool schema', () => {
      expect(fetchTool.name).toBe('fetch')
      expect(fetchTool.description).toBeDefined()
      expect(fetchTool.inputSchema).toBeDefined()
      expect(fetchTool.inputSchema.type).toBe('object')
      expect(fetchTool.inputSchema.properties).toBeDefined()
      expect(fetchTool.inputSchema.properties.$id).toBeDefined()
      expect(fetchTool.inputSchema.required).toContain('$id')
    })

    it('should have optional include parameter', () => {
      expect(fetchTool.inputSchema.properties.include).toBeDefined()
      expect(fetchTool.inputSchema.properties.include.type).toBe('array')
    })
  })

  describe('fetch by $id', () => {
    it('should fetch a Thing by $id', async () => {
      const thing = await things.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com'
      })

      const result = await fetchTool.execute({ $id: thing.$id })

      expect(result).toBeDefined()
      expect(result.$id).toBe(thing.$id)
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
    })

    it('should return 404 for non-existent Thing', async () => {
      await expect(
        fetchTool.execute({ $id: 'non-existent-id' })
      ).rejects.toThrow('Thing not found')
    })

    it('should include basic _links for the Thing', async () => {
      const thing = await things.create({
        $type: 'Customer',
        name: 'Bob'
      })

      const result = await fetchTool.execute({ $id: thing.$id })

      expect(result._links).toBeDefined()
      expect(result._links.self).toBeDefined()
      expect(result._links.self).toContain(thing.$id)
    })
  })

  describe('include relationships', () => {
    it('should include relationships when requested', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })
      const order1 = await things.create({ $type: 'Order', total: 100 })
      const order2 = await things.create({ $type: 'Order', total: 200 })

      await relationships.add({ subject: customer.$id, predicate: 'placed', object: order1.$id })
      await relationships.add({ subject: customer.$id, predicate: 'placed', object: order2.$id })

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: ['relationships']
      })

      expect(result._relationships).toBeDefined()
      expect(result._relationships.length).toBe(2)
      expect(result._relationships[0].predicate).toBe('placed')
    })

    it('should not include relationships when not requested', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })
      const order = await things.create({ $type: 'Order', total: 100 })
      await relationships.add({ subject: customer.$id, predicate: 'placed', object: order.$id })

      const result = await fetchTool.execute({ $id: customer.$id })

      expect(result._relationships).toBeUndefined()
    })

    it('should include both outbound and inbound relationships', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })
      const order = await things.create({ $type: 'Order', total: 100 })
      const company = await things.create({ $type: 'Company', name: 'Acme' })

      // Outbound: customer -> order
      await relationships.add({ subject: customer.$id, predicate: 'placed', object: order.$id })
      // Inbound: company -> customer
      await relationships.add({ subject: company.$id, predicate: 'employs', object: customer.$id })

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: ['relationships']
      })

      expect(result._relationships.length).toBe(2)

      const placedRel = result._relationships.find((r: unknown) => (r as { predicate: string }).predicate === 'placed')
      expect(placedRel.subject).toBe(customer.$id)

      const employsRel = result._relationships.find((r: unknown) => (r as { predicate: string }).predicate === 'employs')
      expect(employsRel.object).toBe(customer.$id)
    })
  })

  describe('include events', () => {
    it('should include recent events when requested', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })

      await events.emit({ type: 'Customer.created', source: customer.$id, payload: { name: 'Alice' } })
      await events.emit({ type: 'Customer.updated', source: customer.$id, payload: { name: 'Alice Updated' } })

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: ['events']
      })

      expect(result._events).toBeDefined()
      expect(result._events.length).toBe(2)
      expect(result._events[0].type).toMatch(/^Customer\./)
    })

    it('should not include events when not requested', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })
      await events.emit({ type: 'Customer.created', source: customer.$id, payload: {} })

      const result = await fetchTool.execute({ $id: customer.$id })

      expect(result._events).toBeUndefined()
    })

    it('should limit events to recent entries', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })

      // Create many events
      for (let i = 0; i < 150; i++) {
        await events.emit({ type: `Customer.event${i}`, source: customer.$id, payload: { index: i } })
      }

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: ['events']
      })

      expect(result._events).toBeDefined()
      expect(result._events.length).toBeLessThanOrEqual(100)
    })
  })

  describe('include multiple enrichments', () => {
    it('should include both relationships and events', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })
      const order = await things.create({ $type: 'Order', total: 100 })

      await relationships.add({ subject: customer.$id, predicate: 'placed', object: order.$id })
      await events.emit({ type: 'Customer.created', source: customer.$id, payload: {} })

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: ['relationships', 'events']
      })

      expect(result._relationships).toBeDefined()
      expect(result._relationships.length).toBe(1)
      expect(result._events).toBeDefined()
      expect(result._events.length).toBe(1)
    })

    it('should handle empty include array', async () => {
      const customer = await things.create({ $type: 'Customer', name: 'Alice' })

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: []
      })

      expect(result._relationships).toBeUndefined()
      expect(result._events).toBeUndefined()
      expect(result._links).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw error for missing $id', async () => {
      await expect(
        fetchTool.execute({})
      ).rejects.toThrow()
    })

    it('should throw error for invalid $id type', async () => {
      await expect(
        fetchTool.execute({ $id: 123 })
      ).rejects.toThrow()
    })

    it('should handle store errors gracefully', async () => {
      // Create a fetch tool with a broken things store
      const brokenThings = {
        ...things,
        get: async () => {
          throw new Error('Database error')
        }
      }

      const brokenFetchTool = createFetchTool({
        things: brokenThings as any,
        relationships,
        events
      })

      await expect(
        brokenFetchTool.execute({ $id: 'test-id' })
      ).rejects.toThrow('Database error')
    })
  })

  describe('output format', () => {
    it('should return enriched Thing with all metadata', async () => {
      const customer = await things.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com'
      })

      const order = await things.create({ $type: 'Order', total: 100 })
      await relationships.add({ subject: customer.$id, predicate: 'placed', object: order.$id })
      await events.emit({ type: 'Customer.created', source: customer.$id, payload: {} })

      const result = await fetchTool.execute({
        $id: customer.$id,
        include: ['relationships', 'events']
      })

      // Original Thing properties
      expect(result.$id).toBe(customer.$id)
      expect(result.$type).toBe('Customer')
      expect(result.$createdAt).toBe(customer.$createdAt)
      expect(result.$updatedAt).toBe(customer.$updatedAt)
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')

      // Enrichments
      expect(result._links).toBeDefined()
      expect(result._relationships).toBeDefined()
      expect(result._events).toBeDefined()
    })

    it('should preserve all custom fields on the Thing', async () => {
      const product = await things.create({
        $type: 'Product',
        sku: 'PROD-123',
        name: 'Widget',
        price: 29.99,
        inStock: true,
        tags: ['electronics', 'gadget'],
        metadata: { color: 'blue', size: 'medium' }
      })

      const result = await fetchTool.execute({ $id: product.$id })

      expect(result.sku).toBe('PROD-123')
      expect(result.name).toBe('Widget')
      expect(result.price).toBe(29.99)
      expect(result.inStock).toBe(true)
      expect(result.tags).toEqual(['electronics', 'gadget'])
      expect(result.metadata).toEqual({ color: 'blue', size: 'medium' })
    })
  })
})
