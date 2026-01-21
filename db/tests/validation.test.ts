// Tests for input validation module - see do-c8s8
import { describe, it, expect, beforeEach } from 'vitest'
import {
  validateJsonValue,
  validateId,
  validateIds,
  validateType,
  validateThingInput,
  validateThingUpdate,
  validateListOptions,
  validateBulkUpdateItems,
  safeValidateThingInput,
  safeValidateThingUpdate,
  createValidationContext,
  DEFAULT_VALIDATION_CONFIG,
} from '../validation'
import { DbValidationError } from '../errors'
import { createThingsStoreWithContext, type ThingsStore } from '../things'
import { MemoryStorageAdapter } from '../adapters'

describe('Validation Module', () => {

  describe('validateJsonValue', () => {
    it('should accept null', () => {
      expect(() => validateJsonValue(null)).not.toThrow()
    })

    it('should accept primitives', () => {
      expect(() => validateJsonValue('string')).not.toThrow()
      expect(() => validateJsonValue(123)).not.toThrow()
      expect(() => validateJsonValue(123.45)).not.toThrow()
      expect(() => validateJsonValue(true)).not.toThrow()
      expect(() => validateJsonValue(false)).not.toThrow()
    })

    it('should accept arrays', () => {
      expect(() => validateJsonValue([])).not.toThrow()
      expect(() => validateJsonValue([1, 2, 3])).not.toThrow()
      expect(() => validateJsonValue(['a', 'b', 'c'])).not.toThrow()
      expect(() => validateJsonValue([1, 'a', true, null])).not.toThrow()
    })

    it('should accept objects', () => {
      expect(() => validateJsonValue({})).not.toThrow()
      expect(() => validateJsonValue({ name: 'Alice', age: 30 })).not.toThrow()
      expect(() => validateJsonValue({ nested: { deeply: { value: 1 } } })).not.toThrow()
    })

    it('should reject undefined', () => {
      expect(() => validateJsonValue(undefined)).toThrow(DbValidationError)
      expect(() => validateJsonValue(undefined)).toThrow('undefined is not a valid JSON value')
    })

    it('should reject functions', () => {
      expect(() => validateJsonValue(() => {})).toThrow(DbValidationError)
      expect(() => validateJsonValue(() => {})).toThrow('function is not a valid JSON value')
    })

    it('should reject symbols', () => {
      expect(() => validateJsonValue(Symbol('test'))).toThrow(DbValidationError)
      expect(() => validateJsonValue(Symbol('test'))).toThrow('symbol is not a valid JSON value')
    })

    it('should reject Infinity and NaN', () => {
      expect(() => validateJsonValue(Infinity)).toThrow(DbValidationError)
      expect(() => validateJsonValue(-Infinity)).toThrow(DbValidationError)
      expect(() => validateJsonValue(NaN)).toThrow(DbValidationError)
    })

    it('should reject strings exceeding max length (context-based)', () => {
      const ctx = createValidationContext({ maxStringLength: 100 })
      const longString = 'a'.repeat(101)
      expect(() => ctx.validateJsonValue(longString)).toThrow(DbValidationError)
      expect(() => ctx.validateJsonValue(longString)).toThrow('exceeds maximum')
    })

    it('should reject arrays exceeding max length (context-based)', () => {
      const ctx = createValidationContext({ maxArrayLength: 10 })
      const longArray = Array(11).fill(1)
      expect(() => ctx.validateJsonValue(longArray)).toThrow(DbValidationError)
      expect(() => ctx.validateJsonValue(longArray)).toThrow('exceeds maximum')
    })

    it('should reject objects with too many keys (context-based)', () => {
      const ctx = createValidationContext({ maxObjectKeys: 5 })
      const bigObject: Record<string, number> = {}
      for (let i = 0; i < 10; i++) {
        bigObject[`key${i}`] = i
      }
      expect(() => ctx.validateJsonValue(bigObject)).toThrow(DbValidationError)
      expect(() => ctx.validateJsonValue(bigObject)).toThrow('exceeds maximum')
    })

    it('should reject deeply nested objects (context-based)', () => {
      const ctx = createValidationContext({ maxObjectDepth: 3 })
      const deepObject = { a: { b: { c: { d: 'too deep' } } } }
      expect(() => ctx.validateJsonValue(deepObject)).toThrow(DbValidationError)
      expect(() => ctx.validateJsonValue(deepObject)).toThrow('exceeds maximum nesting depth')
    })

    it('should include path in error for nested validation failures', () => {
      expect(() => validateJsonValue({ valid: { invalid: undefined } })).toThrow('valid.invalid')
    })
  })

  describe('validateId', () => {
    it('should accept valid string IDs', () => {
      expect(validateId('abc123')).toBe('abc123')
      expect(validateId('user-123-abc')).toBe('user-123-abc')
      expect(validateId('luhm21-xyz123')).toBe('luhm21-xyz123')
    })

    it('should reject non-string IDs', () => {
      expect(() => validateId(123)).toThrow(DbValidationError)
      expect(() => validateId(null)).toThrow(DbValidationError)
      expect(() => validateId(undefined)).toThrow(DbValidationError)
      expect(() => validateId({})).toThrow(DbValidationError)
    })

    it('should reject empty strings', () => {
      expect(() => validateId('')).toThrow(DbValidationError)
      expect(() => validateId('')).toThrow('cannot be empty')
    })

    it('should reject IDs exceeding max length', () => {
      const longId = 'a'.repeat(257)
      expect(() => validateId(longId)).toThrow(DbValidationError)
      expect(() => validateId(longId)).toThrow('exceeds maximum length')
    })

    it('should use custom field name in error', () => {
      expect(() => validateId('', 'customField')).toThrow('customField')
    })

    it('should enforce strict ID validation when enabled (context-based)', () => {
      const ctx = createValidationContext({ strictIdValidation: true })
      // Valid ThingId format: timestamp-random
      expect(() => ctx.validateId('luhm21-xyz123')).not.toThrow()
      // Invalid format
      expect(() => ctx.validateId('invalid_id')).toThrow('must match ThingId format')
    })
  })

  describe('validateIds', () => {
    it('should accept array of valid IDs', () => {
      const ids = validateIds(['id1', 'id2', 'id3'])
      expect(ids).toEqual(['id1', 'id2', 'id3'])
    })

    it('should reject non-array input', () => {
      expect(() => validateIds('not-an-array')).toThrow(DbValidationError)
      expect(() => validateIds(null)).toThrow(DbValidationError)
    })

    it('should validate each ID in array', () => {
      expect(() => validateIds(['valid', '', 'also-valid'])).toThrow('ids[1]')
    })
  })

  describe('validateType', () => {
    it('should accept valid type names', () => {
      expect(validateType('Customer')).toBe('Customer')
      expect(validateType('Order')).toBe('Order')
      expect(validateType('user_profile')).toBe('user_profile')
      expect(validateType('api-key')).toBe('api-key')
      expect(validateType('A')).toBe('A')
    })

    it('should reject non-string types', () => {
      expect(() => validateType(123)).toThrow(DbValidationError)
      expect(() => validateType(null)).toThrow(DbValidationError)
    })

    it('should reject empty strings', () => {
      expect(() => validateType('')).toThrow(DbValidationError)
      expect(() => validateType('')).toThrow('is required')
    })

    it('should reject types exceeding max length', () => {
      const longType = 'A' + 'a'.repeat(100)
      expect(() => validateType(longType)).toThrow(DbValidationError)
      expect(() => validateType(longType)).toThrow('exceeds maximum length')
    })

    it('should reject types starting with numbers', () => {
      expect(() => validateType('123Customer')).toThrow(DbValidationError)
      expect(() => validateType('123Customer')).toThrow('must start with a letter')
    })

    it('should reject types with invalid characters', () => {
      expect(() => validateType('Customer!')).toThrow(DbValidationError)
      expect(() => validateType('Order@Special')).toThrow(DbValidationError)
      expect(() => validateType('User Name')).toThrow(DbValidationError)
    })
  })

  describe('validateThingInput', () => {
    it('should accept valid input', () => {
      const input = { $type: 'Customer', name: 'Alice', age: 30 }
      const validated = validateThingInput(input)
      expect(validated).toEqual(input)
    })

    it('should reject null/undefined', () => {
      expect(() => validateThingInput(null)).toThrow(DbValidationError)
      expect(() => validateThingInput(undefined)).toThrow(DbValidationError)
    })

    it('should reject non-object input', () => {
      expect(() => validateThingInput('string')).toThrow(DbValidationError)
      expect(() => validateThingInput(123)).toThrow(DbValidationError)
    })

    it('should reject input without $type', () => {
      expect(() => validateThingInput({ name: 'Alice' })).toThrow(DbValidationError)
    })

    it('should reject input with invalid $type', () => {
      expect(() => validateThingInput({ $type: '' })).toThrow(DbValidationError)
      expect(() => validateThingInput({ $type: 123 })).toThrow(DbValidationError)
    })

    it('should reject input with system fields ($id, $createdAt, $updatedAt)', () => {
      expect(() => validateThingInput({ $type: 'Test', $id: 'custom-id' })).toThrow(DbValidationError)
      expect(() => validateThingInput({ $type: 'Test', $id: 'custom-id' })).toThrow('system field')

      expect(() => validateThingInput({ $type: 'Test', $createdAt: 123 })).toThrow(DbValidationError)
      expect(() => validateThingInput({ $type: 'Test', $updatedAt: 123 })).toThrow(DbValidationError)
    })

    it('should validate nested values', () => {
      expect(() => validateThingInput({
        $type: 'Test',
        nested: { invalid: undefined }
      })).toThrow(DbValidationError)
    })
  })

  describe('validateThingUpdate', () => {
    it('should accept valid update data', () => {
      const update = { name: 'Bob', age: 31 }
      const validated = validateThingUpdate(update)
      expect(validated).toEqual(update)
    })

    it('should accept empty update', () => {
      const validated = validateThingUpdate({})
      expect(validated).toEqual({})
    })

    it('should reject null/undefined', () => {
      expect(() => validateThingUpdate(null)).toThrow(DbValidationError)
      expect(() => validateThingUpdate(undefined)).toThrow(DbValidationError)
    })

    it('should reject updates to $id', () => {
      expect(() => validateThingUpdate({ $id: 'new-id' })).toThrow(DbValidationError)
      expect(() => validateThingUpdate({ $id: 'new-id' })).toThrow('$id')
      expect(() => validateThingUpdate({ $id: 'new-id' })).toThrow('immutable')
    })

    it('should reject updates to $type', () => {
      expect(() => validateThingUpdate({ $type: 'NewType' })).toThrow(DbValidationError)
      expect(() => validateThingUpdate({ $type: 'NewType' })).toThrow('$type')
    })

    it('should reject updates to $createdAt', () => {
      expect(() => validateThingUpdate({ $createdAt: 123 })).toThrow(DbValidationError)
    })

    it('should allow $updatedAt (system-managed but sometimes passed)', () => {
      // $updatedAt is special - it's managed by the system but sometimes needs to be passed through
      expect(() => validateThingUpdate({ $updatedAt: Date.now() })).not.toThrow()
    })
  })

  describe('safeValidateThingInput', () => {
    it('should return success for valid input', () => {
      const result = safeValidateThingInput({ $type: 'Test', name: 'Alice' })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ $type: 'Test', name: 'Alice' })
    })

    it('should return error for invalid input', () => {
      const result = safeValidateThingInput({ name: 'Alice' }) // Missing $type
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(DbValidationError)
    })
  })

  describe('safeValidateThingUpdate', () => {
    it('should return success for valid update', () => {
      const result = safeValidateThingUpdate({ name: 'Bob' })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ name: 'Bob' })
    })

    it('should return error for invalid update', () => {
      const result = safeValidateThingUpdate({ $id: 'new-id' })
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(DbValidationError)
    })
  })

  describe('validateListOptions', () => {
    it('should accept empty/undefined options', () => {
      expect(validateListOptions(undefined)).toEqual({})
      expect(validateListOptions(null)).toEqual({})
      expect(validateListOptions({})).toEqual({})
    })

    it('should accept valid options', () => {
      const result = validateListOptions({ type: 'Customer', limit: 50, offset: 10 })
      expect(result).toEqual({ type: 'Customer', limit: 50, offset: 10 })
    })

    it('should reject non-object options', () => {
      expect(() => validateListOptions('invalid')).toThrow(DbValidationError)
    })

    it('should reject invalid limit values', () => {
      expect(() => validateListOptions({ limit: -1 })).toThrow(DbValidationError)
      expect(() => validateListOptions({ limit: 0 })).toThrow(DbValidationError)
      expect(() => validateListOptions({ limit: 1.5 })).toThrow(DbValidationError)
      expect(() => validateListOptions({ limit: 'ten' })).toThrow(DbValidationError)
      expect(() => validateListOptions({ limit: 20000 })).toThrow('exceeds maximum')
    })

    it('should reject invalid offset values', () => {
      expect(() => validateListOptions({ offset: -1 })).toThrow(DbValidationError)
      expect(() => validateListOptions({ offset: 1.5 })).toThrow(DbValidationError)
      expect(() => validateListOptions({ offset: 'ten' })).toThrow(DbValidationError)
    })

    it('should accept offset of 0', () => {
      expect(validateListOptions({ offset: 0 })).toEqual({ offset: 0 })
    })
  })

  describe('validateBulkUpdateItems', () => {
    it('should accept valid bulk update items', () => {
      const items = [
        { id: 'id1', data: { name: 'Alice' } },
        { id: 'id2', data: { name: 'Bob' } }
      ]
      const result = validateBulkUpdateItems(items)
      expect(result).toEqual(items)
    })

    it('should reject non-array input', () => {
      expect(() => validateBulkUpdateItems('not-array')).toThrow(DbValidationError)
    })

    it('should reject items without id', () => {
      expect(() => validateBulkUpdateItems([{ data: { name: 'Alice' } }])).toThrow('id')
    })

    it('should reject items without data', () => {
      expect(() => validateBulkUpdateItems([{ id: 'id1' }])).toThrow('data')
    })

    it('should validate each item data', () => {
      expect(() => validateBulkUpdateItems([
        { id: 'id1', data: { $id: 'invalid' } }
      ])).toThrow(DbValidationError)
    })
  })

  describe('Configuration (Context-Based)', () => {
    it('should use default config', () => {
      const ctx = createValidationContext()
      expect(ctx.config.maxStringLength).toBe(10000)
      expect(ctx.config.maxObjectDepth).toBe(10)
      expect(ctx.config.maxObjectKeys).toBe(100)
      expect(ctx.config.maxArrayLength).toBe(1000)
      expect(ctx.config.strictIdValidation).toBe(false)
    })

    it('should allow custom configuration via context', () => {
      const ctx = createValidationContext({ maxStringLength: 500, strictIdValidation: true })
      expect(ctx.config.maxStringLength).toBe(500)
      expect(ctx.config.strictIdValidation).toBe(true)
      // Others should remain default
      expect(ctx.config.maxObjectDepth).toBe(10)
    })

    it('should have DEFAULT_VALIDATION_CONFIG export', () => {
      expect(DEFAULT_VALIDATION_CONFIG.maxStringLength).toBe(10000)
      expect(DEFAULT_VALIDATION_CONFIG.maxObjectDepth).toBe(10)
      expect(DEFAULT_VALIDATION_CONFIG.maxObjectKeys).toBe(100)
      expect(DEFAULT_VALIDATION_CONFIG.maxArrayLength).toBe(1000)
      expect(DEFAULT_VALIDATION_CONFIG.strictIdValidation).toBe(false)
    })

    it('should isolate configurations between contexts', () => {
      const ctx1 = createValidationContext({ maxStringLength: 100 })
      const ctx2 = createValidationContext({ maxStringLength: 1000 })

      expect(ctx1.config.maxStringLength).toBe(100)
      expect(ctx2.config.maxStringLength).toBe(1000)

      // ctx1 config should not affect ctx2
      const mediumString = 'a'.repeat(500)
      expect(() => ctx1.validateJsonValue(mediumString)).toThrow(DbValidationError)
      expect(() => ctx2.validateJsonValue(mediumString)).not.toThrow()
    })
  })
})

describe('ThingsStore with Validation', () => {
  let store: ThingsStore
  let adapter: MemoryStorageAdapter

  beforeEach(() => {
    adapter = new MemoryStorageAdapter()
    store = createThingsStoreWithContext(adapter)
  })

  describe('create', () => {
    it('should create with valid input', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$id).toBeDefined()
    })

    it('should reject input without $type', async () => {
      await expect(
        store.create({ name: 'Alice' } as unknown as { $type: string })
      ).rejects.toThrow(DbValidationError)
    })

    it('should reject input with invalid $type', async () => {
      await expect(
        store.create({ $type: '123Invalid', name: 'Alice' })
      ).rejects.toThrow(DbValidationError)
    })

    it('should reject input with undefined values', async () => {
      await expect(
        store.create({ $type: 'Test', value: undefined } as unknown as { $type: string })
      ).rejects.toThrow(DbValidationError)
    })

    it('should reject input trying to set $id', async () => {
      await expect(
        store.create({ $type: 'Test', $id: 'custom-id' } as unknown as { $type: string })
      ).rejects.toThrow(DbValidationError)
    })
  })

  describe('get', () => {
    it('should get with valid ID', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const retrieved = await store.get(created.$id)
      expect(retrieved).toEqual(created)
    })

    it('should reject empty ID', async () => {
      await expect(store.get('')).rejects.toThrow(DbValidationError)
    })

    it('should reject non-string ID', async () => {
      await expect(store.get(123 as unknown as string)).rejects.toThrow(DbValidationError)
    })
  })

  describe('update', () => {
    it('should update with valid data', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, { name: 'Bob' })
      expect(updated.name).toBe('Bob')
    })

    it('should reject update with $id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      await expect(
        store.update(created.$id, { $id: 'new-id' } as unknown as Record<string, unknown>)
      ).rejects.toThrow(DbValidationError)
    })

    it('should reject update with $type', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      await expect(
        store.update(created.$id, { $type: 'Order' } as unknown as Record<string, unknown>)
      ).rejects.toThrow(DbValidationError)
    })

    it('should reject empty ID', async () => {
      await expect(store.update('', { name: 'Bob' })).rejects.toThrow(DbValidationError)
    })
  })

  describe('delete', () => {
    it('should delete with valid ID', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      await store.delete(created.$id)
      const retrieved = await store.get(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should reject empty ID', async () => {
      await expect(store.delete('')).rejects.toThrow(DbValidationError)
    })
  })

  describe('list', () => {
    it('should list with valid options', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Customer', name: 'Bob' })
      const results = await store.list({ type: 'Customer', limit: 10 })
      expect(results).toHaveLength(2)
    })

    it('should reject invalid limit', async () => {
      await expect(store.list({ limit: -1 })).rejects.toThrow(DbValidationError)
    })

    it('should reject invalid offset', async () => {
      await expect(store.list({ offset: -1 })).rejects.toThrow(DbValidationError)
    })
  })

  describe('bulkCreate', () => {
    it('should create multiple with valid input', async () => {
      const things = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' }
      ])
      expect(things).toHaveLength(2)
    })

    it('should reject if any item is invalid', async () => {
      await expect(
        store.bulkCreate([
          { $type: 'Customer', name: 'Alice' },
          { name: 'Bob' } as unknown as { $type: string } // Missing $type
        ])
      ).rejects.toThrow(DbValidationError)

      // Verify atomic behavior - nothing should have been created
      const results = await store.list({ type: 'Customer' })
      expect(results).toHaveLength(0)
    })
  })

  describe('bulkUpdate', () => {
    it('should update multiple with valid input', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' }
      ])

      const updated = await store.bulkUpdate([
        { id: created[0].$id, data: { name: 'Alice Updated' } },
        { id: created[1].$id, data: { name: 'Bob Updated' } }
      ])

      expect(updated[0].name).toBe('Alice Updated')
      expect(updated[1].name).toBe('Bob Updated')
    })

    it('should reject if any item has invalid data', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' }
      ])

      await expect(
        store.bulkUpdate([
          { id: created[0].$id, data: { $id: 'invalid' } }
        ])
      ).rejects.toThrow(DbValidationError)
    })
  })

  describe('bulkDelete', () => {
    it('should delete multiple with valid IDs', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' }
      ])

      await store.bulkDelete([created[0].$id, created[1].$id])

      const results = await store.list({ type: 'Customer' })
      expect(results).toHaveLength(0)
    })

    it('should reject if any ID is invalid', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' }
      ])

      await expect(
        store.bulkDelete([created[0].$id, '']) // Empty ID is invalid
      ).rejects.toThrow(DbValidationError)
    })
  })
})
