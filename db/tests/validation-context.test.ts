// Tests for context-based validation configuration - see do-bwknw
// Replaces global validation config with context-based approach
import { describe, it, expect } from 'vitest'
import {
  createValidationContext,
  withValidationContext,
  type ValidationContext,
  type ValidationConfig,
  DEFAULT_VALIDATION_CONFIG,
} from '../validation'
import { DbValidationError } from '../errors'
import { createThingsStoreWithContext } from '../things'
import { MemoryStorageAdapter } from '../adapters'

describe('Context-based Validation', () => {
  describe('createValidationContext', () => {
    it('should create a context with default config', () => {
      const ctx = createValidationContext()
      expect(ctx.config).toEqual(DEFAULT_VALIDATION_CONFIG)
    })

    it('should create a context with custom config', () => {
      const ctx = createValidationContext({
        maxStringLength: 500,
        strictIdValidation: true,
      })
      expect(ctx.config.maxStringLength).toBe(500)
      expect(ctx.config.strictIdValidation).toBe(true)
      // Defaults for unspecified values
      expect(ctx.config.maxObjectDepth).toBe(DEFAULT_VALIDATION_CONFIG.maxObjectDepth)
    })

    it('should merge custom config with defaults', () => {
      const ctx = createValidationContext({
        maxArrayLength: 50,
      })
      expect(ctx.config.maxArrayLength).toBe(50)
      expect(ctx.config.maxStringLength).toBe(DEFAULT_VALIDATION_CONFIG.maxStringLength)
      expect(ctx.config.maxObjectDepth).toBe(DEFAULT_VALIDATION_CONFIG.maxObjectDepth)
      expect(ctx.config.maxObjectKeys).toBe(DEFAULT_VALIDATION_CONFIG.maxObjectKeys)
    })
  })

  describe('ValidationContext methods', () => {
    describe('validateJsonValue', () => {
      it('should use context config for string length validation', () => {
        const ctx = createValidationContext({ maxStringLength: 10 })
        expect(() => ctx.validateJsonValue('short')).not.toThrow()
        expect(() => ctx.validateJsonValue('a'.repeat(11))).toThrow(DbValidationError)
        expect(() => ctx.validateJsonValue('a'.repeat(11))).toThrow('exceeds maximum')
      })

      it('should use context config for array length validation', () => {
        const ctx = createValidationContext({ maxArrayLength: 5 })
        expect(() => ctx.validateJsonValue([1, 2, 3])).not.toThrow()
        expect(() => ctx.validateJsonValue([1, 2, 3, 4, 5, 6])).toThrow(DbValidationError)
      })

      it('should use context config for object depth validation', () => {
        const ctx = createValidationContext({ maxObjectDepth: 2 })
        expect(() => ctx.validateJsonValue({ a: { b: 1 } })).not.toThrow()
        expect(() => ctx.validateJsonValue({ a: { b: { c: 1 } } })).toThrow(DbValidationError)
        expect(() => ctx.validateJsonValue({ a: { b: { c: 1 } } })).toThrow('nesting depth')
      })

      it('should use context config for object keys validation', () => {
        const ctx = createValidationContext({ maxObjectKeys: 3 })
        expect(() => ctx.validateJsonValue({ a: 1, b: 2, c: 3 })).not.toThrow()
        expect(() => ctx.validateJsonValue({ a: 1, b: 2, c: 3, d: 4 })).toThrow(DbValidationError)
      })
    })

    describe('validateId', () => {
      it('should enforce strict ID validation when enabled in context', () => {
        const strictCtx = createValidationContext({ strictIdValidation: true })
        // Valid ThingId format: base36-timestamp-random (e.g., luhm21-xyz123)
        expect(() => strictCtx.validateId('luhm21-xyz123')).not.toThrow()
        expect(() => strictCtx.validateId('invalid_format')).toThrow(DbValidationError)
        expect(() => strictCtx.validateId('invalid_format')).toThrow('ThingId format')
      })

      it('should not enforce strict ID validation when disabled in context', () => {
        const lenientCtx = createValidationContext({ strictIdValidation: false })
        expect(() => lenientCtx.validateId('any_string')).not.toThrow()
        expect(() => lenientCtx.validateId('invalid_format')).not.toThrow()
      })
    })

    describe('validateThingInput', () => {
      it('should validate thing input using context config', () => {
        const ctx = createValidationContext({ maxStringLength: 10 })
        expect(() => ctx.validateThingInput({ $type: 'Test', name: 'short' })).not.toThrow()
        expect(() => ctx.validateThingInput({ $type: 'Test', name: 'a'.repeat(11) })).toThrow(DbValidationError)
      })
    })

    describe('validateThingUpdate', () => {
      it('should validate thing update using context config', () => {
        const ctx = createValidationContext({ maxStringLength: 10 })
        expect(() => ctx.validateThingUpdate({ name: 'short' })).not.toThrow()
        expect(() => ctx.validateThingUpdate({ name: 'a'.repeat(11) })).toThrow(DbValidationError)
      })
    })
  })

  describe('Multiple contexts isolation', () => {
    it('should maintain separate configs for different contexts', () => {
      const ctx1 = createValidationContext({ maxStringLength: 10 })
      const ctx2 = createValidationContext({ maxStringLength: 100 })

      const longString = 'a'.repeat(50)
      expect(() => ctx1.validateJsonValue(longString)).toThrow(DbValidationError)
      expect(() => ctx2.validateJsonValue(longString)).not.toThrow()
    })

    it('should not affect other contexts when one is modified', () => {
      const ctx1 = createValidationContext({ maxStringLength: 10 })
      const ctx2 = createValidationContext({ maxStringLength: 10 })

      // Create new context from ctx1 with different config
      const ctx1Modified = createValidationContext({ maxStringLength: 100 })

      const longString = 'a'.repeat(50)
      // ctx1 still has original config
      expect(() => ctx1.validateJsonValue(longString)).toThrow(DbValidationError)
      // ctx2 unaffected
      expect(() => ctx2.validateJsonValue(longString)).toThrow(DbValidationError)
      // Modified context has new config
      expect(() => ctx1Modified.validateJsonValue(longString)).not.toThrow()
    })
  })

  describe('withValidationContext', () => {
    it('should execute callback with validation context', () => {
      const result = withValidationContext({ maxStringLength: 10 }, (ctx) => {
        expect(ctx.config.maxStringLength).toBe(10)
        return 'success'
      })
      expect(result).toBe('success')
    })

    it('should isolate validation within callback', () => {
      const defaultCtx = createValidationContext()
      const longString = 'a'.repeat(50)

      // Verify default allows longer strings
      expect(() => defaultCtx.validateJsonValue(longString)).not.toThrow()

      // Within callback, stricter config is used
      withValidationContext({ maxStringLength: 10 }, (ctx) => {
        expect(() => ctx.validateJsonValue(longString)).toThrow(DbValidationError)
      })

      // Default context unchanged
      expect(() => defaultCtx.validateJsonValue(longString)).not.toThrow()
    })

    it('should support async callbacks', async () => {
      const result = await withValidationContext({ maxStringLength: 10 }, async (ctx) => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return ctx.config.maxStringLength
      })
      expect(result).toBe(10)
    })
  })

  describe('Immutability', () => {
    it('should return frozen config object', () => {
      const ctx = createValidationContext()
      expect(Object.isFrozen(ctx.config)).toBe(true)
    })

    it('should not allow config modification', () => {
      const ctx = createValidationContext()
      expect(() => {
        (ctx.config as ValidationConfig).maxStringLength = 999
      }).toThrow(TypeError)
    })
  })

  describe('Type safety', () => {
    it('should have typed config properties', () => {
      const config: ValidationConfig = {
        maxStringLength: 100,
        maxObjectDepth: 5,
        maxObjectKeys: 50,
        maxArrayLength: 500,
        strictIdValidation: true,
      }
      const ctx = createValidationContext(config)

      // TypeScript should be happy with these
      const _str: number = ctx.config.maxStringLength
      const _depth: number = ctx.config.maxObjectDepth
      const _keys: number = ctx.config.maxObjectKeys
      const _arr: number = ctx.config.maxArrayLength
      const _strict: boolean = ctx.config.strictIdValidation

      expect(_str).toBe(100)
      expect(_depth).toBe(5)
      expect(_keys).toBe(50)
      expect(_arr).toBe(500)
      expect(_strict).toBe(true)
    })
  })
})

describe('Context-based validation integration', () => {
  describe('Per-DO validation contexts', () => {
    it('should allow different DOs to have different validation configs', () => {
      // Simulate two different DOs with different validation requirements
      const strictDOContext = createValidationContext({
        maxStringLength: 100,
        maxObjectDepth: 3,
        strictIdValidation: true,
      })

      const lenientDOContext = createValidationContext({
        maxStringLength: 10000,
        maxObjectDepth: 10,
        strictIdValidation: false,
      })

      const mediumString = 'a'.repeat(500)
      const deepObject = { a: { b: { c: { d: 1 } } } }

      // Strict DO rejects
      expect(() => strictDOContext.validateJsonValue(mediumString)).toThrow(DbValidationError)
      expect(() => strictDOContext.validateJsonValue(deepObject)).toThrow(DbValidationError)

      // Lenient DO accepts
      expect(() => lenientDOContext.validateJsonValue(mediumString)).not.toThrow()
      expect(() => lenientDOContext.validateJsonValue(deepObject)).not.toThrow()
    })
  })

  describe('Context inheritance', () => {
    it('should support creating child contexts with overrides', () => {
      const parentCtx = createValidationContext({
        maxStringLength: 100,
        maxObjectDepth: 5,
      })

      // Child context can override specific values while inheriting others
      const childCtx = createValidationContext({
        ...parentCtx.config,
        maxStringLength: 50, // Override
      })

      expect(childCtx.config.maxStringLength).toBe(50) // Overridden
      expect(childCtx.config.maxObjectDepth).toBe(5) // Inherited
    })
  })
})

describe('ThingsStore with ValidationContext', () => {
  describe('createThingsStoreWithContext', () => {
    it('should create store with explicit validation context', async () => {
      const adapter = new MemoryStorageAdapter()
      const ctx = createValidationContext({ maxStringLength: 50 })
      const store = createThingsStoreWithContext(adapter, ctx)

      // Should accept short strings
      const thing = await store.create({ $type: 'Test', name: 'short' })
      expect(thing.name).toBe('short')

      // Should reject long strings based on context config
      await expect(
        store.create({ $type: 'Test', name: 'a'.repeat(51) })
      ).rejects.toThrow(DbValidationError)
    })

    it('should isolate validation config between stores', async () => {
      const adapter1 = new MemoryStorageAdapter()
      const adapter2 = new MemoryStorageAdapter()

      const strictCtx = createValidationContext({ maxStringLength: 10 })
      const lenientCtx = createValidationContext({ maxStringLength: 1000 })

      const strictStore = createThingsStoreWithContext(adapter1, strictCtx)
      const lenientStore = createThingsStoreWithContext(adapter2, lenientCtx)

      const mediumString = 'a'.repeat(50)

      // Strict store rejects
      await expect(
        strictStore.create({ $type: 'Test', value: mediumString })
      ).rejects.toThrow(DbValidationError)

      // Lenient store accepts
      const thing = await lenientStore.create({ $type: 'Test', value: mediumString })
      expect(thing.value).toBe(mediumString)
    })

    it('should use default config when no context provided', async () => {
      const adapter = new MemoryStorageAdapter()
      const store = createThingsStoreWithContext(adapter)

      // Default maxStringLength is 10000, so this should work
      const thing = await store.create({
        $type: 'Test',
        longString: 'a'.repeat(5000)
      })
      expect(thing.longString).toHaveLength(5000)
    })
  })

  describe('Test isolation (no global state leaks)', () => {
    it('should not be affected by other test configurations - test A', async () => {
      const adapter = new MemoryStorageAdapter()
      // This test uses strict config
      const ctx = createValidationContext({ maxStringLength: 10 })
      const store = createThingsStoreWithContext(adapter, ctx)

      await expect(
        store.create({ $type: 'Test', value: 'a'.repeat(20) })
      ).rejects.toThrow(DbValidationError)
    })

    it('should not be affected by other test configurations - test B', async () => {
      const adapter = new MemoryStorageAdapter()
      // This test uses lenient config - should not be affected by test A
      const ctx = createValidationContext({ maxStringLength: 100 })
      const store = createThingsStoreWithContext(adapter, ctx)

      // This should work despite test A having stricter limits
      const thing = await store.create({ $type: 'Test', value: 'a'.repeat(20) })
      expect(thing.value).toHaveLength(20)
    })

    it('should support concurrent stores with different configs', async () => {
      // Simulate concurrent requests to different DOs
      const adapter1 = new MemoryStorageAdapter()
      const adapter2 = new MemoryStorageAdapter()

      const store1 = createThingsStoreWithContext(
        adapter1,
        createValidationContext({ maxStringLength: 10 })
      )
      const store2 = createThingsStoreWithContext(
        adapter2,
        createValidationContext({ maxStringLength: 100 })
      )

      // Run operations concurrently
      const results = await Promise.allSettled([
        store1.create({ $type: 'Test', value: 'a'.repeat(20) }), // Should fail
        store2.create({ $type: 'Test', value: 'a'.repeat(20) }), // Should succeed
      ])

      expect(results[0].status).toBe('rejected')
      expect(results[1].status).toBe('fulfilled')
      if (results[1].status === 'fulfilled') {
        expect(results[1].value.value).toHaveLength(20)
      }
    })
  })

  describe('Context-based validation for all operations', () => {
    it('should use context for update validation', async () => {
      const adapter = new MemoryStorageAdapter()
      const ctx = createValidationContext({ maxStringLength: 20 })
      const store = createThingsStoreWithContext(adapter, ctx)

      // Create with short name
      const thing = await store.create({ $type: 'Test', name: 'short' })

      // Update with long name should fail based on context
      await expect(
        store.update(thing.$id, { name: 'a'.repeat(25) })
      ).rejects.toThrow(DbValidationError)

      // Update with acceptable name should succeed
      const updated = await store.update(thing.$id, { name: 'a'.repeat(15) })
      expect(updated.name).toHaveLength(15)
    })

    it('should use context for bulk operations', async () => {
      const adapter = new MemoryStorageAdapter()
      const ctx = createValidationContext({ maxStringLength: 20 })
      const store = createThingsStoreWithContext(adapter, ctx)

      // Bulk create should fail if any item exceeds context limits
      await expect(
        store.bulkCreate([
          { $type: 'Test', name: 'ok' },
          { $type: 'Test', name: 'a'.repeat(25) }, // Too long
        ])
      ).rejects.toThrow(DbValidationError)

      // Nothing should be created (atomic behavior)
      const all = await store.list({ type: 'Test' })
      expect(all).toHaveLength(0)
    })

    it('should use context for strict ID validation', async () => {
      const adapter = new MemoryStorageAdapter()
      const ctx = createValidationContext({ strictIdValidation: true })
      const store = createThingsStoreWithContext(adapter, ctx)

      // Create a thing first
      const thing = await store.create({ $type: 'Test', name: 'test' })

      // Getting with valid ThingId format should work
      const retrieved = await store.get(thing.$id)
      expect(retrieved?.$id).toBe(thing.$id)

      // Getting with invalid ID format should fail with strict validation
      await expect(
        store.get('invalid_format_id')
      ).rejects.toThrow(DbValidationError)
    })
  })
})
