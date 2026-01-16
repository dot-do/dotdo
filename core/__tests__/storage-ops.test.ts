/**
 * ThingStore TDD Tests - RED Phase
 *
 * Comprehensive tests for the storage operations covering:
 * - create() validation
 * - update() validation
 * - Query optimization paths
 * - Error handling for invalid data
 * - Type validation ($type required, PascalCase)
 * - $id generation
 *
 * Issue: do-xpmi
 *
 * These tests are designed to FAIL initially (TDD RED phase).
 * Some tests will pass because the implementation exists, but many
 * will fail to validate edge cases and missing functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Helpers
// =============================================================================

function getDO(name = 'storage-ops-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// 1. Thing Create Validation Tests
// =============================================================================

describe('Thing Create Validation', () => {
  describe('$type validation', () => {
    it('should reject lowercase $type (must be PascalCase)', async () => {
      const doInstance = getDO('create-lowercase-type-1')

      // Using noun() with lowercase should fail validation
      await expect(
        doInstance.noun('customer').create({ name: 'Alice' })
      ).rejects.toThrow('PascalCase')
    })

    it('should reject $type starting with number', async () => {
      const doInstance = getDO('create-number-type-1')

      await expect(
        doInstance.noun('123Customer').create({ name: 'Alice' })
      ).rejects.toThrow('PascalCase')
    })

    it('should reject $type with special characters', async () => {
      const doInstance = getDO('create-special-type-1')

      await expect(
        doInstance.noun('Customer-Type').create({ name: 'Alice' })
      ).rejects.toThrow('PascalCase')
    })

    it('should reject $type with underscore', async () => {
      const doInstance = getDO('create-underscore-type-1')

      await expect(
        doInstance.noun('Customer_Type').create({ name: 'Alice' })
      ).rejects.toThrow('PascalCase')
    })

    it('should accept valid PascalCase $type', async () => {
      const doInstance = getDO('create-valid-type-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    it('should accept $type with numbers after first letter', async () => {
      const doInstance = getDO('create-type-numbers-1')

      const thing = await doInstance.noun('Customer123').create({
        code: 'C001',
      })

      expect(thing.$type).toBe('Customer123')
    })

    it('should accept multi-word PascalCase types', async () => {
      const doInstance = getDO('create-multiword-type-1')

      const thing = await doInstance.noun('CustomerAccount').create({
        balance: 100,
      })

      expect(thing.$type).toBe('CustomerAccount')
    })

    it('should accept single letter uppercase type', async () => {
      const doInstance = getDO('create-single-letter-1')

      const thing = await doInstance.noun('A').create({
        value: 1,
      })

      expect(thing.$type).toBe('A')
    })
  })

  describe('$id validation and generation', () => {
    it('should auto-generate $id when not provided', async () => {
      const doInstance = getDO('create-no-id-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      expect(thing.$id).toBeDefined()
      expect(typeof thing.$id).toBe('string')
      expect(thing.$id.length).toBeGreaterThan(0)
    })

    it('should use provided $id when specified', async () => {
      const doInstance = getDO('create-custom-id-1')

      const thing = await doInstance.noun('Customer').create({
        $id: 'custom-customer-123',
        name: 'Bob',
      })

      expect(thing.$id).toBe('custom-customer-123')
    })

    it('should reject empty $id string', async () => {
      const doInstance = getDO('create-empty-id-1')

      await expect(
        doInstance.noun('Customer').create({
          $id: '',
          name: 'Alice',
        })
      ).rejects.toThrow('$id')
    })

    it('should generate unique $ids for multiple creates', async () => {
      const doInstance = getDO('create-unique-ids-1')

      const thing1 = await doInstance.noun('Customer').create({ name: 'Alice' })
      const thing2 = await doInstance.noun('Customer').create({ name: 'Bob' })
      const thing3 = await doInstance.noun('Customer').create({ name: 'Carol' })

      expect(thing1.$id).not.toBe(thing2.$id)
      expect(thing2.$id).not.toBe(thing3.$id)
      expect(thing1.$id).not.toBe(thing3.$id)
    })

    it('should generate $id with thing_ prefix', async () => {
      const doInstance = getDO('create-id-prefix-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      expect(thing.$id).toMatch(/^thing_/)
    })
  })

  describe('Metadata generation', () => {
    it('should set $createdAt timestamp', async () => {
      const doInstance = getDO('create-timestamp-1')
      const before = new Date().toISOString()

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      const after = new Date().toISOString()
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$createdAt >= before).toBe(true)
      expect(thing.$createdAt <= after).toBe(true)
    })

    it('should set $updatedAt equal to $createdAt on creation', async () => {
      const doInstance = getDO('create-updated-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      expect(thing.$updatedAt).toBe(thing.$createdAt)
    })

    it('should set $version to 1 on creation', async () => {
      const doInstance = getDO('create-version-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      expect(thing.$version).toBe(1)
    })
  })

  describe('Data validation', () => {
    it('should preserve all provided data fields', async () => {
      const doInstance = getDO('create-data-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        active: true,
        tags: ['vip', 'premium'],
        metadata: { source: 'web' },
      })

      expect(thing.name).toBe('Alice')
      expect(thing.email).toBe('alice@example.com')
      expect(thing.age).toBe(30)
      expect(thing.active).toBe(true)
      expect(thing.tags).toEqual(['vip', 'premium'])
      expect(thing.metadata).toEqual({ source: 'web' })
    })

    it('should handle null values in data', async () => {
      const doInstance = getDO('create-null-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
        middleName: null,
      })

      expect(thing.middleName).toBeNull()
    })

    it('should handle nested objects in data', async () => {
      const doInstance = getDO('create-nested-1')

      const thing = await doInstance.noun('Customer').create({
        name: 'Alice',
        address: {
          street: '123 Main St',
          city: 'Boston',
          zip: '02101',
        },
      })

      expect(thing.address).toEqual({
        street: '123 Main St',
        city: 'Boston',
        zip: '02101',
      })
    })
  })
})

// =============================================================================
// 2. Thing Update Validation Tests
// =============================================================================

describe('Thing Update Validation', () => {
  describe('Existence validation', () => {
    it('should throw error when updating non-existent thing', async () => {
      const doInstance = getDO('update-not-found-1')

      await expect(
        doInstance.updateThingById('non-existent-id', { name: 'Updated' })
      ).rejects.toThrow('not found')
    })

    it('should throw descriptive error with the ID', async () => {
      const doInstance = getDO('update-error-id-1')

      await expect(
        doInstance.updateThingById('specific-missing-id-123', { name: 'Updated' })
      ).rejects.toThrow('specific-missing-id-123')
    })
  })

  describe('Update behavior', () => {
    it('should update existing thing and return updated data', async () => {
      const doInstance = getDO('update-basic-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
        status: 'active',
      })

      const updated = await doInstance.noun('Customer', created.$id).update({
        status: 'inactive',
      })

      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Alice')
      expect(updated.status).toBe('inactive')
    })

    it('should increment $version on update', async () => {
      const doInstance = getDO('update-version-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      expect(created.$version).toBe(1)

      const updated = await doInstance.noun('Customer', created.$id).update({
        name: 'Alice Updated',
      })

      expect(updated.$version).toBe(2)
    })

    it('should update $updatedAt timestamp', async () => {
      const doInstance = getDO('update-timestamp-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      // Wait a tiny bit to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10))

      const updated = await doInstance.noun('Customer', created.$id).update({
        name: 'Alice Updated',
      })

      expect(updated.$updatedAt).not.toBe(created.$updatedAt)
      expect(new Date(updated.$updatedAt!).getTime()).toBeGreaterThan(
        new Date(created.$updatedAt!).getTime()
      )
    })

    it('should preserve $createdAt on update', async () => {
      const doInstance = getDO('update-preserve-created-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      const updated = await doInstance.noun('Customer', created.$id).update({
        name: 'Alice Updated',
      })

      expect(updated.$createdAt).toBe(created.$createdAt)
    })

    it('should preserve $type on update (immutable)', async () => {
      const doInstance = getDO('update-preserve-type-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      const updated = await doInstance.noun('Customer', created.$id).update({
        $type: 'DifferentType', // Attempting to change type
        name: 'Alice Updated',
      })

      // $type should be preserved as original
      expect(updated.$type).toBe('Customer')
    })

    it('should preserve $id on update (immutable)', async () => {
      const doInstance = getDO('update-preserve-id-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      const updated = await doInstance.noun('Customer', created.$id).update({
        $id: 'different-id', // Attempting to change id
        name: 'Alice Updated',
      })

      // $id should be preserved as original
      expect(updated.$id).toBe(created.$id)
    })

    it('should support partial updates (merge semantics)', async () => {
      const doInstance = getDO('update-partial-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
        email: 'alice@example.com',
        phone: '555-1234',
      })

      const updated = await doInstance.noun('Customer', created.$id).update({
        email: 'alice.new@example.com',
      })

      expect(updated.name).toBe('Alice')
      expect(updated.email).toBe('alice.new@example.com')
      expect(updated.phone).toBe('555-1234')
    })

    it('should allow setting fields to null', async () => {
      const doInstance = getDO('update-null-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
        middleName: 'Marie',
      })

      const updated = await doInstance.noun('Customer', created.$id).update({
        middleName: null,
      })

      expect(updated.middleName).toBeNull()
    })
  })

  describe('Multiple updates', () => {
    it('should correctly increment version across multiple updates', async () => {
      const doInstance = getDO('update-multi-version-1')

      const created = await doInstance.noun('Counter').create({
        value: 0,
      })

      expect(created.$version).toBe(1)

      let thing = await doInstance.noun('Counter', created.$id).update({ value: 1 })
      expect(thing.$version).toBe(2)

      thing = await doInstance.noun('Counter', created.$id).update({ value: 2 })
      expect(thing.$version).toBe(3)

      thing = await doInstance.noun('Counter', created.$id).update({ value: 3 })
      expect(thing.$version).toBe(4)
    })
  })
})

// =============================================================================
// 3. Query Optimization Tests
// =============================================================================

describe('Thing Query Operations', () => {
  describe('Basic list operations', () => {
    it('should list things by type', async () => {
      const doInstance = getDO('query-list-type-1')

      await doInstance.noun('Product').create({ name: 'Widget' })
      await doInstance.noun('Product').create({ name: 'Gadget' })
      await doInstance.noun('Category').create({ name: 'Electronics' })

      const products = await doInstance.noun('Product').list()

      expect(Array.isArray(products)).toBe(true)
      expect(products.length).toBe(2)
      expect(products.every((p: { $type: string }) => p.$type === 'Product')).toBe(true)
    })

    it('should return empty array for non-existent type', async () => {
      const doInstance = getDO('query-empty-type-1')

      const results = await doInstance.noun('NonExistentType').list()

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBe(0)
    })
  })

  describe('Where clause filtering', () => {
    it('should filter by simple equality', async () => {
      const doInstance = getDO('query-where-eq-1')

      await doInstance.noun('Customer').create({ name: 'Alice', status: 'active' })
      await doInstance.noun('Customer').create({ name: 'Bob', status: 'inactive' })
      await doInstance.noun('Customer').create({ name: 'Carol', status: 'active' })

      const activeCustomers = await doInstance.noun('Customer').list({
        where: { status: 'active' },
      })

      expect(activeCustomers.length).toBe(2)
      expect(activeCustomers.every((c: { status: string }) => c.status === 'active')).toBe(true)
    })

    it('should filter with $gt operator', async () => {
      const doInstance = getDO('query-where-gt-1')

      await doInstance.noun('Order').create({ amount: 50 })
      await doInstance.noun('Order').create({ amount: 100 })
      await doInstance.noun('Order').create({ amount: 150 })
      await doInstance.noun('Order').create({ amount: 200 })

      const largeOrders = await doInstance.noun('Order').list({
        where: { amount: { $gt: 100 } },
      })

      expect(largeOrders.length).toBe(2)
      expect(largeOrders.every((o: { amount: number }) => o.amount > 100)).toBe(true)
    })

    it('should filter with $lt operator', async () => {
      const doInstance = getDO('query-where-lt-1')

      await doInstance.noun('Order').create({ amount: 50 })
      await doInstance.noun('Order').create({ amount: 100 })
      await doInstance.noun('Order').create({ amount: 150 })

      const smallOrders = await doInstance.noun('Order').list({
        where: { amount: { $lt: 100 } },
      })

      expect(smallOrders.length).toBe(1)
      expect(smallOrders[0].amount).toBe(50)
    })

    it('should filter with $gte operator', async () => {
      const doInstance = getDO('query-where-gte-1')

      await doInstance.noun('Order').create({ amount: 50 })
      await doInstance.noun('Order').create({ amount: 100 })
      await doInstance.noun('Order').create({ amount: 150 })

      const orders = await doInstance.noun('Order').list({
        where: { amount: { $gte: 100 } },
      })

      expect(orders.length).toBe(2)
      expect(orders.every((o: { amount: number }) => o.amount >= 100)).toBe(true)
    })

    it('should filter with $lte operator', async () => {
      const doInstance = getDO('query-where-lte-1')

      await doInstance.noun('Order').create({ amount: 50 })
      await doInstance.noun('Order').create({ amount: 100 })
      await doInstance.noun('Order').create({ amount: 150 })

      const orders = await doInstance.noun('Order').list({
        where: { amount: { $lte: 100 } },
      })

      expect(orders.length).toBe(2)
      expect(orders.every((o: { amount: number }) => o.amount <= 100)).toBe(true)
    })

    it('should filter with $in operator', async () => {
      const doInstance = getDO('query-where-in-1')

      await doInstance.noun('Customer').create({ status: 'active' })
      await doInstance.noun('Customer').create({ status: 'inactive' })
      await doInstance.noun('Customer').create({ status: 'pending' })
      await doInstance.noun('Customer').create({ status: 'suspended' })

      const customers = await doInstance.noun('Customer').list({
        where: { status: { $in: ['active', 'pending'] } },
      })

      expect(customers.length).toBe(2)
      expect(
        customers.every((c: { status: string }) =>
          ['active', 'pending'].includes(c.status)
        )
      ).toBe(true)
    })

    it('should filter with $ne operator', async () => {
      const doInstance = getDO('query-where-ne-1')

      await doInstance.noun('Customer').create({ status: 'active' })
      await doInstance.noun('Customer').create({ status: 'inactive' })
      await doInstance.noun('Customer').create({ status: 'active' })

      const customers = await doInstance.noun('Customer').list({
        where: { status: { $ne: 'inactive' } },
      })

      expect(customers.length).toBe(2)
      expect(customers.every((c: { status: string }) => c.status !== 'inactive')).toBe(true)
    })

    it('should filter with $exists operator', async () => {
      const doInstance = getDO('query-where-exists-1')

      await doInstance.noun('Customer').create({ name: 'Alice', email: 'alice@test.com' })
      await doInstance.noun('Customer').create({ name: 'Bob' }) // no email

      const withEmail = await doInstance.noun('Customer').list({
        where: { email: { $exists: true } },
      })

      expect(withEmail.length).toBe(1)
      expect(withEmail[0].name).toBe('Alice')
    })

    it('should filter with multiple conditions (AND)', async () => {
      const doInstance = getDO('query-where-multi-1')

      await doInstance.noun('Product').create({ price: 50, inStock: true })
      await doInstance.noun('Product').create({ price: 150, inStock: true })
      await doInstance.noun('Product').create({ price: 75, inStock: false })

      const affordable = await doInstance.noun('Product').list({
        where: { price: { $lt: 100 }, inStock: true },
      })

      expect(affordable.length).toBe(1)
      expect(affordable[0].price).toBe(50)
    })

    it('should filter with $regex operator', async () => {
      const doInstance = getDO('query-where-regex-1')

      await doInstance.noun('Customer').create({ email: 'alice@gmail.com' })
      await doInstance.noun('Customer').create({ email: 'bob@yahoo.com' })
      await doInstance.noun('Customer').create({ email: 'carol@gmail.com' })

      const gmailUsers = await doInstance.noun('Customer').list({
        where: { email: { $regex: '@gmail\\.com$' } },
      })

      expect(gmailUsers.length).toBe(2)
      expect(gmailUsers.every((c: { email: string }) => c.email.endsWith('@gmail.com'))).toBe(true)
    })
  })

  describe('Pagination', () => {
    it('should support limit option', async () => {
      const doInstance = getDO('query-limit-1')

      for (let i = 0; i < 10; i++) {
        await doInstance.noun('Item').create({ index: i })
      }

      const items = await doInstance.noun('Item').list({ limit: 5 })

      expect(items.length).toBe(5)
    })

    it('should support offset option', async () => {
      const doInstance = getDO('query-offset-1')

      for (let i = 0; i < 10; i++) {
        await doInstance.noun('Item').create({ index: i })
      }

      const items = await doInstance.noun('Item').list({ limit: 5, offset: 5 })

      expect(items.length).toBe(5)
    })
  })
})

// =============================================================================
// 4. Error Handling Tests
// =============================================================================

describe('Thing Error Handling', () => {
  describe('Invalid query operators', () => {
    it('should throw QueryValidationError for unknown operator', async () => {
      const doInstance = getDO('error-unknown-op-1')

      await doInstance.noun('Item').create({ value: 10 })

      await expect(
        doInstance.noun('Item').list({
          where: { value: { $unknown: 5 } },
        })
      ).rejects.toThrow('Unknown operator')
    })

    it('should throw error for invalid $in value (not array)', async () => {
      const doInstance = getDO('error-invalid-in-1')

      await doInstance.noun('Item').create({ status: 'active' })

      await expect(
        doInstance.noun('Item').list({
          // @ts-expect-error - testing runtime validation
          where: { status: { $in: 'not-an-array' } },
        })
      ).rejects.toThrow()
    })

    it('should throw error for empty operator object', async () => {
      const doInstance = getDO('error-empty-op-1')

      await doInstance.noun('Item').create({ value: 10 })

      await expect(
        doInstance.noun('Item').list({
          where: { value: {} },
        })
      ).rejects.toThrow()
    })
  })

  describe('ThingValidationError details', () => {
    it('should include field name in validation error', async () => {
      const doInstance = getDO('error-field-1')

      try {
        await doInstance.noun('lowercase').create({ name: 'test' })
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message).toContain('$type')
      }
    })

    it('should provide helpful error message for PascalCase requirement', async () => {
      const doInstance = getDO('error-pascalcase-1')

      try {
        await doInstance.noun('customer').create({ name: 'test' })
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message.toLowerCase()).toContain('pascalcase')
      }
    })
  })

  describe('Database errors', () => {
    it('should handle getById for non-existent ID gracefully', async () => {
      const doInstance = getDO('error-get-missing-1')

      const result = await doInstance.getThingById('non-existent-id')

      expect(result).toBeNull()
    })

    it('should handle delete for non-existent ID gracefully', async () => {
      const doInstance = getDO('error-delete-missing-1')

      const result = await doInstance.deleteThingById('non-existent-id')

      expect(result).toBe(false)
    })
  })
})

// =============================================================================
// 5. Event Emission Tests
// =============================================================================

describe('Thing Event Emission', () => {
  it('should emit created event on thing creation', async () => {
    const doInstance = getDO('event-created-1')

    // Create a thing - event should be emitted
    const thing = await doInstance.noun('Customer').create({
      name: 'Alice',
    })

    // Events are fire-and-forget, but we can verify the thing was created
    expect(thing.$id).toBeDefined()
    expect(thing.$type).toBe('Customer')
  })

  it('should emit updated event on thing update', async () => {
    const doInstance = getDO('event-updated-1')

    const created = await doInstance.noun('Customer').create({
      name: 'Alice',
    })

    const updated = await doInstance.noun('Customer', created.$id).update({
      name: 'Alice Updated',
    })

    expect(updated.$version).toBe(2)
  })

  it('should emit deleted event on thing deletion', async () => {
    const doInstance = getDO('event-deleted-1')

    const created = await doInstance.noun('Customer').create({
      name: 'Alice',
    })

    const deleted = await doInstance.noun('Customer', created.$id).delete()

    expect(deleted).toBe(true)
  })
})

// =============================================================================
// 6. Delete Operations Tests
// =============================================================================

describe('Thing Delete Operations', () => {
  it('should delete existing thing and return true', async () => {
    const doInstance = getDO('delete-success-1')

    const created = await doInstance.noun('Customer').create({
      name: 'Alice',
    })

    const result = await doInstance.noun('Customer', created.$id).delete()

    expect(result).toBe(true)
  })

  it('should return false when deleting non-existent thing', async () => {
    const doInstance = getDO('delete-not-found-1')

    const result = await doInstance.deleteThingById('non-existent-id')

    expect(result).toBe(false)
  })

  it('should remove thing from subsequent queries', async () => {
    const doInstance = getDO('delete-verify-1')

    const created = await doInstance.noun('Customer').create({
      name: 'ToDelete',
    })

    await doInstance.noun('Customer', created.$id).delete()

    // Verify it's gone
    const result = await doInstance.getThingById(created.$id)
    expect(result).toBeNull()

    // Verify not in list
    const list = await doInstance.noun('Customer').list()
    expect(list.find((c: { $id: string }) => c.$id === created.$id)).toBeUndefined()
  })

  it('should only delete the specified thing', async () => {
    const doInstance = getDO('delete-specific-1')

    const alice = await doInstance.noun('Customer').create({ name: 'Alice' })
    const bob = await doInstance.noun('Customer').create({ name: 'Bob' })
    const carol = await doInstance.noun('Customer').create({ name: 'Carol' })

    await doInstance.noun('Customer', bob.$id).delete()

    const remaining = await doInstance.noun('Customer').list()
    expect(remaining.length).toBe(2)
    expect(remaining.find((c: { $id: string }) => c.$id === alice.$id)).toBeDefined()
    expect(remaining.find((c: { $id: string }) => c.$id === bob.$id)).toBeUndefined()
    expect(remaining.find((c: { $id: string }) => c.$id === carol.$id)).toBeDefined()
  })
})

// =============================================================================
// 7. Edge Cases and Concurrency Tests
// =============================================================================

describe('Thing Edge Cases', () => {
  it('should handle very long field values', async () => {
    const doInstance = getDO('edge-long-value-1')

    const longValue = 'a'.repeat(10000)
    const thing = await doInstance.noun('Document').create({
      content: longValue,
    })

    expect(thing.content).toBe(longValue)
  })

  it('should handle unicode characters in values', async () => {
    const doInstance = getDO('edge-unicode-1')

    const thing = await doInstance.noun('Customer').create({
      name: 'Alice Smith',
      city: 'Tokyo',
      emoji: 'Test',
    })

    expect(thing.name).toBe('Alice Smith')
    expect(thing.city).toBe('Tokyo')
    expect(thing.emoji).toBe('Test')
  })

  it('should handle arrays with many elements', async () => {
    const doInstance = getDO('edge-large-array-1')

    const largeArray = Array.from({ length: 1000 }, (_, i) => i)
    const thing = await doInstance.noun('Data').create({
      numbers: largeArray,
    })

    expect(thing.numbers).toEqual(largeArray)
  })

  it('should handle deeply nested objects', async () => {
    const doInstance = getDO('edge-deep-nest-1')

    const deepObject = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 'deep',
              },
            },
          },
        },
      },
    }

    const thing = await doInstance.noun('Config').create({
      settings: deepObject,
    })

    expect(thing.settings).toEqual(deepObject)
  })

  it('should handle numeric field names', async () => {
    const doInstance = getDO('edge-numeric-field-1')

    const thing = await doInstance.noun('Data').create({
      123: 'numeric key',
      'field-2': 'dash key',
    })

    expect(thing['123']).toBe('numeric key')
    expect(thing['field-2']).toBe('dash key')
  })
})

// =============================================================================
// 8. TDD RED PHASE - Tests designed to FAIL
// These test expected behaviors that may not yet be implemented
// =============================================================================

describe('TDD RED Phase - Unimplemented Features', () => {
  describe('Optimistic Concurrency Control', () => {
    it('should reject update with stale version (optimistic locking)', async () => {
      const doInstance = getDO('occ-stale-version-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      // First update should succeed
      const updated1 = await doInstance.noun('Customer', created.$id).update({
        name: 'Alice v2',
        $expectedVersion: 1,
      })
      expect(updated1.$version).toBe(2)

      // Update with stale version should fail
      await expect(
        doInstance.noun('Customer', created.$id).update({
          name: 'Alice v3 from stale',
          $expectedVersion: 1, // Stale! Current version is 2
        })
      ).rejects.toThrow('version')
    })

    it('should support conditional update with $ifMatch', async () => {
      const doInstance = getDO('occ-if-match-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
        balance: 100,
      })

      // Conditional update should only apply if current balance matches
      const result = await doInstance.noun('Customer', created.$id).update({
        balance: 150,
        $ifMatch: { balance: 100 },
      })

      expect(result.balance).toBe(150)

      // Second conditional update should fail because balance changed
      await expect(
        doInstance.noun('Customer', created.$id).update({
          balance: 200,
          $ifMatch: { balance: 100 }, // No longer matches
        })
      ).rejects.toThrow('condition')
    })
  })

  describe('Batch Operations', () => {
    it('should support batch create with createMany', async () => {
      const doInstance = getDO('batch-create-1')

      const customers = await doInstance.noun('Customer').createMany([
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Carol' },
      ])

      expect(customers.length).toBe(3)
      expect(customers[0].name).toBe('Alice')
      expect(customers[1].name).toBe('Bob')
      expect(customers[2].name).toBe('Carol')
    })

    it('should support batch update with updateMany', async () => {
      const doInstance = getDO('batch-update-1')

      await doInstance.noun('Customer').create({ name: 'Alice', status: 'active' })
      await doInstance.noun('Customer').create({ name: 'Bob', status: 'active' })
      await doInstance.noun('Customer').create({ name: 'Carol', status: 'inactive' })

      const count = await doInstance.noun('Customer').updateMany(
        { where: { status: 'active' } },
        { status: 'processed' }
      )

      expect(count).toBe(2)

      const processed = await doInstance.noun('Customer').list({
        where: { status: 'processed' },
      })
      expect(processed.length).toBe(2)
    })

    it('should support batch delete with deleteMany', async () => {
      const doInstance = getDO('batch-delete-1')

      await doInstance.noun('Customer').create({ name: 'Alice', status: 'active' })
      await doInstance.noun('Customer').create({ name: 'Bob', status: 'inactive' })
      await doInstance.noun('Customer').create({ name: 'Carol', status: 'inactive' })

      const count = await doInstance.noun('Customer').deleteMany({
        where: { status: 'inactive' },
      })

      expect(count).toBe(2)

      const remaining = await doInstance.noun('Customer').list()
      expect(remaining.length).toBe(1)
      expect(remaining[0].name).toBe('Alice')
    })
  })

  describe('Upsert Operations', () => {
    it('should support upsert (create if not exists, update if exists)', async () => {
      const doInstance = getDO('upsert-1')

      // First upsert should create
      const created = await doInstance.noun('Customer').upsert({
        $id: 'customer-001',
        name: 'Alice',
        visits: 1,
      })

      expect(created.name).toBe('Alice')
      expect(created.visits).toBe(1)

      // Second upsert should update
      const updated = await doInstance.noun('Customer').upsert({
        $id: 'customer-001',
        name: 'Alice',
        visits: 2,
      })

      expect(updated.$id).toBe('customer-001')
      expect(updated.visits).toBe(2)
      expect(updated.$version).toBe(2)
    })
  })

  describe('Atomic Increment/Decrement', () => {
    it('should support atomic increment with $inc', async () => {
      const doInstance = getDO('atomic-inc-1')

      const created = await doInstance.noun('Counter').create({
        value: 10,
      })

      const updated = await doInstance.noun('Counter', created.$id).update({
        $inc: { value: 5 },
      })

      expect(updated.value).toBe(15)
    })

    it('should support atomic decrement with negative $inc', async () => {
      const doInstance = getDO('atomic-dec-1')

      const created = await doInstance.noun('Counter').create({
        value: 10,
      })

      const updated = await doInstance.noun('Counter', created.$id).update({
        $inc: { value: -3 },
      })

      expect(updated.value).toBe(7)
    })
  })

  describe('Field Selection', () => {
    it('should support selecting specific fields with select option', async () => {
      const doInstance = getDO('select-fields-1')

      await doInstance.noun('Customer').create({
        name: 'Alice',
        email: 'alice@test.com',
        phone: '555-1234',
        ssn: '123-45-6789', // Sensitive field
      })

      const customers = await doInstance.noun('Customer').list({
        select: ['name', 'email'],
      })

      expect(customers[0].name).toBe('Alice')
      expect(customers[0].email).toBe('alice@test.com')
      expect(customers[0].phone).toBeUndefined()
      expect(customers[0].ssn).toBeUndefined()
    })

    it('should support excluding fields with exclude option', async () => {
      const doInstance = getDO('exclude-fields-1')

      await doInstance.noun('Customer').create({
        name: 'Alice',
        email: 'alice@test.com',
        ssn: '123-45-6789',
      })

      const customers = await doInstance.noun('Customer').list({
        exclude: ['ssn'],
      })

      expect(customers[0].name).toBe('Alice')
      expect(customers[0].email).toBe('alice@test.com')
      expect(customers[0].ssn).toBeUndefined()
    })
  })

  describe('Sorting', () => {
    it('should support orderBy ascending', async () => {
      const doInstance = getDO('sort-asc-1')

      await doInstance.noun('Product').create({ name: 'Zebra', price: 30 })
      await doInstance.noun('Product').create({ name: 'Apple', price: 10 })
      await doInstance.noun('Product').create({ name: 'Mango', price: 20 })

      const products = await doInstance.noun('Product').list({
        orderBy: { price: 'asc' },
      })

      expect(products[0].name).toBe('Apple')
      expect(products[1].name).toBe('Mango')
      expect(products[2].name).toBe('Zebra')
    })

    it('should support orderBy descending', async () => {
      const doInstance = getDO('sort-desc-1')

      await doInstance.noun('Product').create({ name: 'Zebra', price: 30 })
      await doInstance.noun('Product').create({ name: 'Apple', price: 10 })
      await doInstance.noun('Product').create({ name: 'Mango', price: 20 })

      const products = await doInstance.noun('Product').list({
        orderBy: { price: 'desc' },
      })

      expect(products[0].name).toBe('Zebra')
      expect(products[1].name).toBe('Mango')
      expect(products[2].name).toBe('Apple')
    })

    it('should support multi-field sorting', async () => {
      const doInstance = getDO('sort-multi-1')

      await doInstance.noun('Product').create({ category: 'A', name: 'Zebra' })
      await doInstance.noun('Product').create({ category: 'A', name: 'Apple' })
      await doInstance.noun('Product').create({ category: 'B', name: 'Mango' })

      const products = await doInstance.noun('Product').list({
        orderBy: [
          { category: 'asc' },
          { name: 'asc' },
        ],
      })

      expect(products[0].name).toBe('Apple')
      expect(products[1].name).toBe('Zebra')
      expect(products[2].name).toBe('Mango')
    })
  })

  describe('Count and Aggregation', () => {
    it('should support count operation', async () => {
      const doInstance = getDO('count-1')

      await doInstance.noun('Item').create({ status: 'active' })
      await doInstance.noun('Item').create({ status: 'active' })
      await doInstance.noun('Item').create({ status: 'inactive' })

      const count = await doInstance.noun('Item').count()
      expect(count).toBe(3)

      const activeCount = await doInstance.noun('Item').count({
        where: { status: 'active' },
      })
      expect(activeCount).toBe(2)
    })

    it('should support findFirst to get single result', async () => {
      const doInstance = getDO('find-first-1')

      await doInstance.noun('Customer').create({ name: 'Alice', age: 30 })
      await doInstance.noun('Customer').create({ name: 'Bob', age: 25 })

      const youngest = await doInstance.noun('Customer').findFirst({
        orderBy: { age: 'asc' },
      })

      expect(youngest?.name).toBe('Bob')
    })
  })

  describe('Transactions', () => {
    it('should support transactional operations with rollback on error', async () => {
      const doInstance = getDO('transaction-rollback-1')

      // Create initial customer
      await doInstance.noun('Customer').create({
        $id: 'customer-tx-1',
        name: 'Alice',
        balance: 100,
      })

      // Transaction that should fail and rollback
      await expect(
        doInstance.transaction(async (tx) => {
          // This should succeed
          await tx.noun('Customer', 'customer-tx-1').update({ balance: 50 })

          // This should fail and cause rollback
          throw new Error('Intentional failure')
        })
      ).rejects.toThrow('Intentional failure')

      // Verify rollback - balance should still be 100
      const customer = await doInstance.getThingById('customer-tx-1')
      expect(customer?.balance).toBe(100)
    })
  })

  describe('Soft Delete', () => {
    it('should support soft delete with $deletedAt timestamp', async () => {
      const doInstance = getDO('soft-delete-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      // Soft delete
      await doInstance.noun('Customer', created.$id).softDelete()

      // Should not appear in regular list
      const list = await doInstance.noun('Customer').list()
      expect(list.find((c: { $id: string }) => c.$id === created.$id)).toBeUndefined()

      // Should appear when including deleted
      const listWithDeleted = await doInstance.noun('Customer').list({
        includeDeleted: true,
      })
      const found = listWithDeleted.find((c: { $id: string }) => c.$id === created.$id)
      expect(found).toBeDefined()
      expect(found.$deletedAt).toBeDefined()
    })

    it('should support restore of soft deleted items', async () => {
      const doInstance = getDO('soft-restore-1')

      const created = await doInstance.noun('Customer').create({
        name: 'Alice',
      })

      await doInstance.noun('Customer', created.$id).softDelete()
      await doInstance.noun('Customer', created.$id).restore()

      // Should appear in regular list again
      const list = await doInstance.noun('Customer').list()
      const found = list.find((c: { $id: string }) => c.$id === created.$id)
      expect(found).toBeDefined()
      expect(found.$deletedAt).toBeUndefined()
    })
  })

  describe('Schema Validation', () => {
    it('should validate against registered schema', async () => {
      const doInstance = getDO('schema-validation-1')

      // Register schema for Customer type
      await doInstance.registerSchema('Customer', {
        name: { type: 'string', required: true },
        email: { type: 'string', format: 'email' },
        age: { type: 'number', min: 0, max: 150 },
      })

      // Valid create should succeed
      const valid = await doInstance.noun('Customer').create({
        name: 'Alice',
        email: 'alice@test.com',
        age: 30,
      })
      expect(valid.name).toBe('Alice')

      // Invalid email should fail
      await expect(
        doInstance.noun('Customer').create({
          name: 'Bob',
          email: 'not-an-email',
        })
      ).rejects.toThrow('email')

      // Invalid age should fail
      await expect(
        doInstance.noun('Customer').create({
          name: 'Carol',
          age: -5,
        })
      ).rejects.toThrow('age')
    })
  })
})

// =============================================================================
// 9. Type Coercion Tests
// =============================================================================

describe('Thing Type Handling', () => {
  it('should preserve number types', async () => {
    const doInstance = getDO('type-number-1')

    const thing = await doInstance.noun('Data').create({
      integer: 42,
      float: 3.14,
      negative: -100,
      zero: 0,
    })

    expect(typeof thing.integer).toBe('number')
    expect(typeof thing.float).toBe('number')
    expect(thing.integer).toBe(42)
    expect(thing.float).toBeCloseTo(3.14)
    expect(thing.negative).toBe(-100)
    expect(thing.zero).toBe(0)
  })

  it('should preserve boolean types', async () => {
    const doInstance = getDO('type-boolean-1')

    const thing = await doInstance.noun('Data').create({
      trueValue: true,
      falseValue: false,
    })

    expect(typeof thing.trueValue).toBe('boolean')
    expect(typeof thing.falseValue).toBe('boolean')
    expect(thing.trueValue).toBe(true)
    expect(thing.falseValue).toBe(false)
  })

  it('should preserve array types', async () => {
    const doInstance = getDO('type-array-1')

    const thing = await doInstance.noun('Data').create({
      stringArray: ['a', 'b', 'c'],
      numberArray: [1, 2, 3],
      mixedArray: [1, 'two', true, null],
    })

    expect(Array.isArray(thing.stringArray)).toBe(true)
    expect(thing.stringArray).toEqual(['a', 'b', 'c'])
    expect(thing.numberArray).toEqual([1, 2, 3])
    expect(thing.mixedArray).toEqual([1, 'two', true, null])
  })

  it('should preserve object types', async () => {
    const doInstance = getDO('type-object-1')

    const thing = await doInstance.noun('Data').create({
      obj: { key: 'value', nested: { a: 1 } },
    })

    expect(typeof thing.obj).toBe('object')
    expect(thing.obj).toEqual({ key: 'value', nested: { a: 1 } })
  })
})
