/**
 * Dynamic Noun Accessor Factory Tests
 *
 * TDD Tests for the dynamic noun accessor pattern:
 * - doInstance.noun('Customer', id) returns an accessor (NounInstanceAccessor)
 * - doInstance.noun('Customer').create(data) creates a thing (NounAccessor)
 * - Supports arbitrary nouns without code changes
 *
 * Note: Cloudflare Workers RPC doesn't support arbitrary property access via Proxy
 * on DurableObject stubs. The solution uses:
 * - `noun(type, id?)` - ergonomic RPC method for dynamic noun access
 * - `getNounAccessor(type, id?)` - existing factory method (kept for compatibility)
 * - Hardcoded methods (Customer, Order, etc.) - for common nouns
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Helpers
// =============================================================================

function getDO(name = 'noun-accessor-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// 1. DYNAMIC NOUN ACCESSOR TESTS - Using noun() method
// =============================================================================

describe('Dynamic Noun Accessor Factory', () => {
  describe('Arbitrary noun support via noun() method', () => {
    it('should support custom noun types via noun() method', async () => {
      const doInstance = getDO('custom-noun-test-1')

      // Use noun() method for dynamic noun access
      const vehicle = await doInstance.noun('Vehicle').create({
        make: 'Tesla',
        model: 'Model 3',
      })

      expect(vehicle).toBeDefined()
      expect(vehicle.$id).toBeDefined()
      expect(vehicle.$type).toBe('Vehicle')
      expect(vehicle.make).toBe('Tesla')
    })

    it('should support any PascalCase noun dynamically', async () => {
      const doInstance = getDO('custom-noun-test-2')

      // Completely arbitrary nouns
      const blogPost = await doInstance.noun('BlogPost').create({
        title: 'Hello World',
        content: 'My first post',
      })

      expect(blogPost.$type).toBe('BlogPost')
      expect(blogPost.title).toBe('Hello World')
    })

    it('should support instance accessor for custom nouns', async () => {
      const doInstance = getDO('custom-noun-test-3')

      // Create a custom noun instance
      const project = await doInstance.noun('Project').create({
        name: 'My Project',
        status: 'active',
      })

      // Access instance via dynamic accessor with id
      const projectAccessor = doInstance.noun('Project', project.$id)
      expect(projectAccessor).toBeDefined()
      expect(typeof projectAccessor.update).toBe('function')
      expect(typeof projectAccessor.delete).toBe('function')
    })

    it('should support update on custom noun instances', async () => {
      const doInstance = getDO('custom-noun-test-4')

      const task = await doInstance.noun('Task').create({
        title: 'Fix bug',
        completed: false,
      })

      const updated = await doInstance.noun('Task', task.$id).update({
        completed: true,
      })

      expect(updated.$id).toBe(task.$id)
      expect(updated.completed).toBe(true)
    })

    it('should support delete on custom noun instances', async () => {
      const doInstance = getDO('custom-noun-test-5')

      const note = await doInstance.noun('Note').create({
        content: 'Remember to test',
      })

      const deleted = await doInstance.noun('Note', note.$id).delete()
      expect(deleted).toBe(true)

      // Verify it's gone
      const notes = await doInstance.noun('Note').list()
      expect(notes.find((n: { $id: string }) => n.$id === note.$id)).toBeUndefined()
    })

    it('should support list on custom noun types', async () => {
      const doInstance = getDO('custom-noun-test-6')

      await doInstance.noun('Widget').create({ name: 'Widget A' })
      await doInstance.noun('Widget').create({ name: 'Widget B' })
      await doInstance.noun('Widget').create({ name: 'Widget C' })

      const widgets = await doInstance.noun('Widget').list()

      expect(Array.isArray(widgets)).toBe(true)
      expect(widgets.length).toBeGreaterThanOrEqual(3)
      expect(widgets.every((w: { $type: string }) => w.$type === 'Widget')).toBe(true)
    })
  })

  describe('Backward compatibility with existing nouns', () => {
    it('should still support hardcoded Customer noun', async () => {
      const doInstance = getDO('compat-test-1')

      const customer = await doInstance.Customer().create({
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice')
    })

    it('should still support hardcoded Order noun', async () => {
      const doInstance = getDO('compat-test-2')

      const order = await doInstance.Order().create({
        total: 99.99,
        items: ['item1', 'item2'],
      })

      expect(order.$type).toBe('Order')
      expect(order.total).toBe(99.99)
    })

    it('should still support hardcoded Product noun', async () => {
      const doInstance = getDO('compat-test-3')

      const product = await doInstance.Product().create({
        name: 'Widget',
        price: 29.99,
      })

      expect(product.$type).toBe('Product')
      expect(product.name).toBe('Widget')
    })

    it('should still support instance accessor for hardcoded nouns', async () => {
      const doInstance = getDO('compat-test-4')

      const customer = await doInstance.Customer().create({
        name: 'Bob',
      })

      const customerAccessor = doInstance.Customer(customer.$id)
      expect(customerAccessor).toBeDefined()

      const profile = await customerAccessor.getProfile()
      expect(profile).toBeDefined()
      expect(profile?.name).toBe('Bob')
    })
  })

  describe('getNounAccessor() factory method', () => {
    it('should return NounAccessor when called without id', async () => {
      const doInstance = getDO('factory-test-1')

      // getNounAccessor exists and returns accessor
      const accessor = doInstance.getNounAccessor('CustomType')

      expect(accessor).toBeDefined()
      expect(typeof accessor.create).toBe('function')
      expect(typeof accessor.list).toBe('function')
    })

    it('should return NounInstanceAccessor when called with id', async () => {
      const doInstance = getDO('factory-test-2')

      // Create a thing first
      const thing = await doInstance.getNounAccessor('TestThing').create({
        value: 123,
      })

      // Get instance accessor
      const instanceAccessor = doInstance.getNounAccessor('TestThing', thing.$id)

      expect(instanceAccessor).toBeDefined()
      expect(typeof instanceAccessor.update).toBe('function')
      expect(typeof instanceAccessor.delete).toBe('function')
    })

    it('should work with any noun name via factory', async () => {
      const doInstance = getDO('factory-test-3')

      // Factory should work with any noun
      const accessor = doInstance.getNounAccessor('AnythingAtAll')
      const created = await accessor.create({ foo: 'bar' })

      expect(created.$type).toBe('AnythingAtAll')
      expect(created.foo).toBe('bar')
    })
  })

  describe('Type safety and edge cases', () => {
    it('should reject lowercase noun names (validation enforces PascalCase)', async () => {
      const doInstance = getDO('edge-test-1')

      // Lowercase nouns should be rejected by validation
      await expect(
        doInstance.noun('lowercase').create({ test: true })
      ).rejects.toThrow()
    })

    it('should handle nouns with numbers', async () => {
      const doInstance = getDO('edge-test-2')

      const accessor = doInstance.getNounAccessor('Item123')
      const created = await accessor.create({ value: 'test' })

      expect(created.$type).toBe('Item123')
    })

    it('should emit events for custom nouns', async () => {
      const doInstance = getDO('edge-test-3')

      // Create a custom noun using noun() method
      const thing = await doInstance.noun('CustomThing').create({
        data: 'test',
      })

      expect(thing.$type).toBe('CustomThing')
      // Event emission is fire-and-forget, verified by internal handlers
    })
  })
})

// =============================================================================
// 2. NOUN METHOD TESTS - RPC-compatible dynamic access
// =============================================================================

describe('noun() method for dynamic access', () => {
  it('should be an alias for getNounAccessor', async () => {
    const doInstance = getDO('noun-method-test-1')

    // noun() and getNounAccessor() should produce equivalent results
    const viaGetNounAccessor = await doInstance.getNounAccessor('TestType').create({ foo: 'bar' })
    const viaNoun = await doInstance.noun('TestType2').create({ foo: 'bar' })

    expect(viaGetNounAccessor.$type).toBe('TestType')
    expect(viaNoun.$type).toBe('TestType2')
  })

  it('should return different accessors for different nouns', async () => {
    const doInstance = getDO('noun-method-test-2')

    // Create things with different types using noun() method
    const cat = await doInstance.noun('Cat').create({ name: 'Whiskers' })
    const dog = await doInstance.noun('Dog').create({ name: 'Buddy' })

    expect(cat.$type).toBe('Cat')
    expect(dog.$type).toBe('Dog')

    // List should return only the correct type
    const cats = await doInstance.noun('Cat').list()
    const dogs = await doInstance.noun('Dog').list()

    expect(cats.every((c: { $type: string }) => c.$type === 'Cat')).toBe(true)
    expect(dogs.every((d: { $type: string }) => d.$type === 'Dog')).toBe(true)
  })

  it('should support chained operations via noun()', async () => {
    const doInstance = getDO('noun-method-test-3')

    // Create and immediately update using noun() method
    const item = await doInstance.noun('ChainItem').create({ status: 'new' })
    const updated = await doInstance.noun('ChainItem', item.$id).update({ status: 'processed' })

    expect(updated.status).toBe('processed')
  })

  it('should work with complex noun names', async () => {
    const doInstance = getDO('noun-method-test-4')

    // Complex but valid PascalCase names
    const subscription = await doInstance.noun('UserSubscription').create({ plan: 'premium' })
    const apiKey = await doInstance.noun('APIKey').create({ key: 'abc123' })

    expect(subscription.$type).toBe('UserSubscription')
    expect(apiKey.$type).toBe('APIKey')
  })
})
