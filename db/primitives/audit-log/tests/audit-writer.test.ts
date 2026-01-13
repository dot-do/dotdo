/**
 * AuditWriter Tests
 *
 * TDD tests for AuditWriter - audit entry writer with schema validation,
 * automatic timestamps, state diffing, and sensitive field masking.
 *
 * @module db/primitives/audit-log
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AuditWriter,
  createAuditWriter,
  type AuditEntry,
  type AuditWriterOptions,
  type ActorType,
  type AuditAction,
} from '../audit-writer'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface MockStore {
  entries: AuditEntry[]
  batchCalls: AuditEntry[][]
}

function createMockStore(): MockStore {
  return {
    entries: [],
    batchCalls: [],
  }
}

function createTestWriter(
  store: MockStore,
  options?: Partial<AuditWriterOptions>
): AuditWriter {
  return createAuditWriter({
    store: {
      async write(entry: AuditEntry): Promise<void> {
        store.entries.push(entry)
      },
      async writeBatch(entries: AuditEntry[]): Promise<void> {
        store.batchCalls.push([...entries])
        store.entries.push(...entries)
      },
    },
    ...options,
  })
}

// ============================================================================
// AUDIT WRITER - CREATION AND CONFIGURATION
// ============================================================================

describe('AuditWriter', () => {
  describe('creation', () => {
    it('should create with required options', () => {
      const store = createMockStore()
      const writer = createTestWriter(store)
      expect(writer).toBeDefined()
    })

    it('should create with all options', () => {
      const store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 50,
        flushInterval: 5000,
        defaultMaskedFields: ['password', 'token'],
      })
      expect(writer).toBeDefined()
    })

    it('should work with new keyword', () => {
      const store = createMockStore()
      const writer = new AuditWriter({
        store: {
          async write(entry: AuditEntry): Promise<void> {
            store.entries.push(entry)
          },
          async writeBatch(entries: AuditEntry[]): Promise<void> {
            store.entries.push(...entries)
          },
        },
      })
      expect(writer).toBeInstanceOf(AuditWriter)
    })
  })
})

// ============================================================================
// SCHEMA VALIDATION
// ============================================================================

describe('Schema Validation', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store)
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('required fields', () => {
    it('should require action field', async () => {
      await expect(
        writer.write({
          resource: 'users/123',
          actor: { type: 'user', id: 'user-1' },
        } as AuditEntry)
      ).rejects.toThrow(/action/i)
    })

    it('should require resource field', async () => {
      await expect(
        writer.write({
          action: 'create',
          actor: { type: 'user', id: 'user-1' },
        } as AuditEntry)
      ).rejects.toThrow(/resource/i)
    })

    it('should require actor field', async () => {
      await expect(
        writer.write({
          action: 'create',
          resource: 'users/123',
        } as AuditEntry)
      ).rejects.toThrow(/actor/i)
    })
  })

  describe('action validation', () => {
    it('should accept valid action types', async () => {
      const validActions: AuditAction[] = [
        'create',
        'read',
        'update',
        'delete',
        'login',
        'logout',
        'grant',
        'revoke',
      ]

      for (const action of validActions) {
        await writer.write({
          action,
          resource: `test/${action}`,
          actor: { type: 'user', id: 'user-1' },
        })
      }

      await writer.flush()
      expect(store.entries.length).toBe(validActions.length)
    })

    it('should accept custom action types', async () => {
      await writer.write({
        action: 'custom_action',
        resource: 'test/custom',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()
      expect(store.entries[0].action).toBe('custom_action')
    })

    it('should reject empty action', async () => {
      await expect(
        writer.write({
          action: '',
          resource: 'users/123',
          actor: { type: 'user', id: 'user-1' },
        })
      ).rejects.toThrow(/action/i)
    })
  })

  describe('resource validation', () => {
    it('should accept valid resource identifiers', async () => {
      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'organizations/acme/projects/alpha',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'urn:service:resource:id',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()
      expect(store.entries.length).toBe(3)
    })

    it('should reject empty resource', async () => {
      await expect(
        writer.write({
          action: 'read',
          resource: '',
          actor: { type: 'user', id: 'user-1' },
        })
      ).rejects.toThrow(/resource/i)
    })
  })
})

// ============================================================================
// ACTOR VALIDATION
// ============================================================================

describe('Actor Validation', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store)
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('actor types', () => {
    it('should accept user actor type', async () => {
      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-456' },
      })

      await writer.flush()
      expect(store.entries[0].actor.type).toBe('user')
    })

    it('should accept service actor type', async () => {
      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: { type: 'service', id: 'api-gateway' },
      })

      await writer.flush()
      expect(store.entries[0].actor.type).toBe('service')
    })

    it('should accept system actor type', async () => {
      await writer.write({
        action: 'cleanup',
        resource: 'sessions/*',
        actor: { type: 'system', id: 'cron-job' },
      })

      await writer.flush()
      expect(store.entries[0].actor.type).toBe('system')
    })

    it('should reject invalid actor type', async () => {
      await expect(
        writer.write({
          action: 'read',
          resource: 'users/123',
          actor: { type: 'invalid' as ActorType, id: 'test' },
        })
      ).rejects.toThrow(/actor.*type/i)
    })

    it('should reject empty actor id', async () => {
      await expect(
        writer.write({
          action: 'read',
          resource: 'users/123',
          actor: { type: 'user', id: '' },
        })
      ).rejects.toThrow(/actor.*id/i)
    })
  })

  describe('actor metadata', () => {
    it('should accept actor metadata', async () => {
      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: {
          type: 'user',
          id: 'user-456',
          email: 'user@example.com',
          name: 'Test User',
        },
      })

      await writer.flush()
      expect(store.entries[0].actor.email).toBe('user@example.com')
      expect(store.entries[0].actor.name).toBe('Test User')
    })
  })
})

// ============================================================================
// AUTOMATIC TIMESTAMP GENERATION
// ============================================================================

describe('Automatic Timestamp Generation', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store)
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('timestamp', () => {
    it('should auto-generate timestamp when not provided', async () => {
      const before = new Date()

      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()
      const after = new Date()

      expect(store.entries[0].timestamp).toBeDefined()
      expect(store.entries[0].timestamp).toBeInstanceOf(Date)
      expect(store.entries[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(store.entries[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should use provided timestamp when given', async () => {
      const customTimestamp = new Date('2024-01-15T10:30:00Z')

      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        timestamp: customTimestamp,
      })

      await writer.flush()
      expect(store.entries[0].timestamp.getTime()).toBe(customTimestamp.getTime())
    })
  })

  describe('entry ID', () => {
    it('should auto-generate unique entry ID', async () => {
      await writer.write({
        action: 'read',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'users/456',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()

      expect(store.entries[0].id).toBeDefined()
      expect(store.entries[1].id).toBeDefined()
      expect(store.entries[0].id).not.toBe(store.entries[1].id)
    })

    it('should preserve provided entry ID', async () => {
      await writer.write({
        id: 'custom-id-123',
        action: 'read',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()
      expect(store.entries[0].id).toBe('custom-id-123')
    })
  })
})

// ============================================================================
// BEFORE/AFTER STATE DIFF CALCULATION
// ============================================================================

describe('Before/After State Diff', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store)
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('state capture', () => {
    it('should capture before state', async () => {
      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { name: 'Old Name', email: 'old@example.com' },
      })

      await writer.flush()
      expect(store.entries[0].before).toEqual({
        name: 'Old Name',
        email: 'old@example.com',
      })
    })

    it('should capture after state', async () => {
      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        after: { name: 'New Name', email: 'new@example.com' },
      })

      await writer.flush()
      expect(store.entries[0].after).toEqual({
        name: 'New Name',
        email: 'new@example.com',
      })
    })

    it('should capture both before and after', async () => {
      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { name: 'Old Name' },
        after: { name: 'New Name' },
      })

      await writer.flush()
      expect(store.entries[0].before).toEqual({ name: 'Old Name' })
      expect(store.entries[0].after).toEqual({ name: 'New Name' })
    })
  })

  describe('diff calculation', () => {
    it('should calculate diff when both before and after provided', async () => {
      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { name: 'Old Name', email: 'same@example.com', role: 'user' },
        after: { name: 'New Name', email: 'same@example.com', status: 'active' },
      })

      await writer.flush()

      expect(store.entries[0].diff).toBeDefined()
      expect(store.entries[0].diff?.changed).toContain('name')
      expect(store.entries[0].diff?.added).toContain('status')
      expect(store.entries[0].diff?.removed).toContain('role')
      expect(store.entries[0].diff?.changed).not.toContain('email')
    })

    it('should not calculate diff when only before provided', async () => {
      await writer.write({
        action: 'delete',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { name: 'User' },
      })

      await writer.flush()
      expect(store.entries[0].diff).toBeUndefined()
    })

    it('should not calculate diff when only after provided', async () => {
      await writer.write({
        action: 'create',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        after: { name: 'User' },
      })

      await writer.flush()
      expect(store.entries[0].diff).toBeUndefined()
    })

    it('should handle nested object changes', async () => {
      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { settings: { theme: 'light' } },
        after: { settings: { theme: 'dark' } },
      })

      await writer.flush()
      expect(store.entries[0].diff?.changed).toContain('settings')
    })

    it('should handle array changes', async () => {
      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { tags: ['a', 'b'] },
        after: { tags: ['a', 'c'] },
      })

      await writer.flush()
      expect(store.entries[0].diff?.changed).toContain('tags')
    })
  })
})

// ============================================================================
// SENSITIVE FIELD MASKING
// ============================================================================

describe('Sensitive Field Masking', () => {
  let store: MockStore

  afterEach(async () => {
    // Writers are closed in individual tests
  })

  describe('default masked fields', () => {
    it('should mask password fields', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        defaultMaskedFields: ['password'],
      })

      await writer.write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        before: { password: 'oldSecret123' },
        after: { password: 'newSecret456' },
      })

      await writer.flush()

      expect(store.entries[0].before?.password).toBe('[REDACTED]')
      expect(store.entries[0].after?.password).toBe('[REDACTED]')

      await writer.close()
    })

    it('should mask token fields', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        defaultMaskedFields: ['token', 'apiKey'],
      })

      await writer.write({
        action: 'create',
        resource: 'tokens/123',
        actor: { type: 'service', id: 'auth-service' },
        after: { token: 'secret-token-value', apiKey: 'api-key-123' },
      })

      await writer.flush()

      expect(store.entries[0].after?.token).toBe('[REDACTED]')
      expect(store.entries[0].after?.apiKey).toBe('[REDACTED]')

      await writer.close()
    })
  })

  describe('per-write field masking', () => {
    it('should mask fields using withMaskFields', async () => {
      store = createMockStore()
      const writer = createTestWriter(store)

      await writer.maskFields(['creditCard', 'ssn']).write({
        action: 'update',
        resource: 'users/123',
        actor: { type: 'user', id: 'user-1' },
        after: {
          name: 'John Doe',
          creditCard: '4111-1111-1111-1111',
          ssn: '123-45-6789',
        },
      })

      await writer.flush()

      expect(store.entries[0].after?.name).toBe('John Doe')
      expect(store.entries[0].after?.creditCard).toBe('[REDACTED]')
      expect(store.entries[0].after?.ssn).toBe('[REDACTED]')

      await writer.close()
    })

    it('should combine default and per-write masked fields', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        defaultMaskedFields: ['password'],
      })

      await writer.maskFields(['secret']).write({
        action: 'update',
        resource: 'config/123',
        actor: { type: 'service', id: 'config-service' },
        after: {
          password: 'admin123',
          secret: 'mysecret',
          name: 'config',
        },
      })

      await writer.flush()

      expect(store.entries[0].after?.password).toBe('[REDACTED]')
      expect(store.entries[0].after?.secret).toBe('[REDACTED]')
      expect(store.entries[0].after?.name).toBe('config')

      await writer.close()
    })
  })

  describe('nested field masking', () => {
    it('should mask nested fields with dot notation', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        defaultMaskedFields: ['credentials.password', 'auth.token'],
      })

      await writer.write({
        action: 'update',
        resource: 'connections/123',
        actor: { type: 'service', id: 'connector' },
        after: {
          credentials: { username: 'admin', password: 'secret' },
          auth: { token: 'jwt-token', type: 'bearer' },
        },
      })

      await writer.flush()

      expect(store.entries[0].after?.credentials?.username).toBe('admin')
      expect(store.entries[0].after?.credentials?.password).toBe('[REDACTED]')
      expect(store.entries[0].after?.auth?.token).toBe('[REDACTED]')
      expect(store.entries[0].after?.auth?.type).toBe('bearer')

      await writer.close()
    })
  })
})

// ============================================================================
// BATCH WRITING SUPPORT
// ============================================================================

describe('Batch Writing', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store, {
      bufferSize: 100,
      flushInterval: 60000, // Long interval for manual control
    })
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('writeBatch', () => {
    it('should write multiple entries at once', async () => {
      const entries: AuditEntry[] = [
        {
          action: 'read',
          resource: 'users/1',
          actor: { type: 'user', id: 'user-1' },
        },
        {
          action: 'read',
          resource: 'users/2',
          actor: { type: 'user', id: 'user-1' },
        },
        {
          action: 'read',
          resource: 'users/3',
          actor: { type: 'user', id: 'user-1' },
        },
      ]

      await writer.writeBatch(entries)
      await writer.flush()

      expect(store.entries.length).toBe(3)
    })

    it('should validate all entries in batch', async () => {
      const entries: AuditEntry[] = [
        {
          action: 'read',
          resource: 'users/1',
          actor: { type: 'user', id: 'user-1' },
        },
        {
          action: '',
          resource: 'users/2',
          actor: { type: 'user', id: 'user-1' },
        } as AuditEntry,
      ]

      await expect(writer.writeBatch(entries)).rejects.toThrow(/action/i)
    })

    it('should generate timestamps for all entries', async () => {
      const entries: AuditEntry[] = [
        {
          action: 'read',
          resource: 'users/1',
          actor: { type: 'user', id: 'user-1' },
        },
        {
          action: 'read',
          resource: 'users/2',
          actor: { type: 'user', id: 'user-1' },
        },
      ]

      await writer.writeBatch(entries)
      await writer.flush()

      expect(store.entries[0].timestamp).toBeDefined()
      expect(store.entries[1].timestamp).toBeDefined()
    })

    it('should mask sensitive fields in batch', async () => {
      store = createMockStore()
      writer = createTestWriter(store, {
        defaultMaskedFields: ['password'],
      })

      const entries: AuditEntry[] = [
        {
          action: 'create',
          resource: 'users/1',
          actor: { type: 'service', id: 'auth' },
          after: { password: 'secret1' },
        },
        {
          action: 'create',
          resource: 'users/2',
          actor: { type: 'service', id: 'auth' },
          after: { password: 'secret2' },
        },
      ]

      await writer.writeBatch(entries)
      await writer.flush()

      expect(store.entries[0].after?.password).toBe('[REDACTED]')
      expect(store.entries[1].after?.password).toBe('[REDACTED]')
    })
  })
})

// ============================================================================
// ENTRY CORRELATION WITH REQUEST IDS
// ============================================================================

describe('Entry Correlation', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store)
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('withCorrelation', () => {
    it('should add correlation ID to entries', async () => {
      const correlatedWriter = writer.withCorrelation('req-123-abc')

      await correlatedWriter.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()
      expect(store.entries[0].correlationId).toBe('req-123-abc')
    })

    it('should add correlation ID to multiple entries', async () => {
      const correlatedWriter = writer.withCorrelation('req-456')

      await correlatedWriter.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      await correlatedWriter.write({
        action: 'read',
        resource: 'users/2',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()

      expect(store.entries[0].correlationId).toBe('req-456')
      expect(store.entries[1].correlationId).toBe('req-456')
    })

    it('should not affect entries from original writer', async () => {
      const correlatedWriter = writer.withCorrelation('req-789')

      await correlatedWriter.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'users/2',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.flush()

      expect(store.entries[0].correlationId).toBe('req-789')
      expect(store.entries[1].correlationId).toBeUndefined()
    })

    it('should allow chaining with maskFields', async () => {
      store = createMockStore()
      writer = createTestWriter(store)

      await writer
        .withCorrelation('req-chain')
        .maskFields(['secret'])
        .write({
          action: 'update',
          resource: 'config/1',
          actor: { type: 'service', id: 'config' },
          after: { secret: 'hidden', name: 'visible' },
        })

      await writer.flush()

      expect(store.entries[0].correlationId).toBe('req-chain')
      expect(store.entries[0].after?.secret).toBe('[REDACTED]')
      expect(store.entries[0].after?.name).toBe('visible')
    })
  })
})

// ============================================================================
// ASYNC WRITE WITH BUFFERING
// ============================================================================

describe('Async Write with Buffering', () => {
  let store: MockStore

  describe('buffering', () => {
    it('should buffer entries before flush', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 100,
        flushInterval: 60000,
      })

      await writer.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'users/2',
        actor: { type: 'user', id: 'user-1' },
      })

      // Entries should be buffered, not yet in store
      expect(store.entries.length).toBe(0)
      expect(writer.bufferSize).toBe(2)

      await writer.flush()

      expect(store.entries.length).toBe(2)
      expect(writer.bufferSize).toBe(0)

      await writer.close()
    })

    it('should auto-flush when buffer is full', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 3,
        flushInterval: 60000,
      })

      await writer.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'users/2',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'users/3',
        actor: { type: 'user', id: 'user-1' },
      })

      // Should have auto-flushed
      await delay(50)
      expect(store.batchCalls.length).toBeGreaterThanOrEqual(1)

      await writer.close()
    })

    it('should auto-flush on interval', async () => {
      vi.useFakeTimers()

      store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 100,
        flushInterval: 1000,
      })

      await writer.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      expect(store.entries.length).toBe(0)

      vi.advanceTimersByTime(1100)
      await Promise.resolve()

      expect(store.entries.length).toBe(1)

      await writer.close()
      vi.useRealTimers()
    })
  })

  describe('flush', () => {
    it('should flush all buffered entries', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 100,
        flushInterval: 60000,
      })

      for (let i = 0; i < 10; i++) {
        await writer.write({
          action: 'read',
          resource: `users/${i}`,
          actor: { type: 'user', id: 'user-1' },
        })
      }

      await writer.flush()

      expect(store.entries.length).toBe(10)

      await writer.close()
    })

    it('should use batch write for multiple entries', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 100,
        flushInterval: 60000,
      })

      for (let i = 0; i < 5; i++) {
        await writer.write({
          action: 'read',
          resource: `users/${i}`,
          actor: { type: 'user', id: 'user-1' },
        })
      }

      await writer.flush()

      // Should have made one batch call
      expect(store.batchCalls.length).toBe(1)
      expect(store.batchCalls[0].length).toBe(5)

      await writer.close()
    })

    it('should handle empty buffer flush gracefully', async () => {
      store = createMockStore()
      const writer = createTestWriter(store)

      await writer.flush()

      expect(store.entries.length).toBe(0)
      expect(store.batchCalls.length).toBe(0)

      await writer.close()
    })
  })

  describe('close', () => {
    it('should flush remaining entries on close', async () => {
      store = createMockStore()
      const writer = createTestWriter(store, {
        bufferSize: 100,
        flushInterval: 60000,
      })

      await writer.write({
        action: 'read',
        resource: 'users/1',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.write({
        action: 'read',
        resource: 'users/2',
        actor: { type: 'user', id: 'user-1' },
      })

      await writer.close()

      expect(store.entries.length).toBe(2)
    })

    it('should reject writes after close', async () => {
      store = createMockStore()
      const writer = createTestWriter(store)

      await writer.close()

      await expect(
        writer.write({
          action: 'read',
          resource: 'users/1',
          actor: { type: 'user', id: 'user-1' },
        })
      ).rejects.toThrow(/closed/i)
    })
  })
})

// ============================================================================
// METADATA AND CONTEXT
// ============================================================================

describe('Metadata and Context', () => {
  let store: MockStore
  let writer: AuditWriter

  beforeEach(() => {
    store = createMockStore()
    writer = createTestWriter(store)
  })

  afterEach(async () => {
    await writer.close()
  })

  describe('metadata', () => {
    it('should accept custom metadata', async () => {
      await writer.write({
        action: 'login',
        resource: 'sessions/123',
        actor: { type: 'user', id: 'user-1' },
        metadata: {
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          country: 'US',
        },
      })

      await writer.flush()

      expect(store.entries[0].metadata?.ipAddress).toBe('192.168.1.1')
      expect(store.entries[0].metadata?.userAgent).toBe('Mozilla/5.0')
      expect(store.entries[0].metadata?.country).toBe('US')
    })
  })

  describe('reason', () => {
    it('should accept reason field', async () => {
      await writer.write({
        action: 'delete',
        resource: 'users/123',
        actor: { type: 'user', id: 'admin-1' },
        reason: 'User requested account deletion',
      })

      await writer.flush()

      expect(store.entries[0].reason).toBe('User requested account deletion')
    })
  })

  describe('outcome', () => {
    it('should accept success outcome', async () => {
      await writer.write({
        action: 'login',
        resource: 'sessions/123',
        actor: { type: 'user', id: 'user-1' },
        outcome: 'success',
      })

      await writer.flush()

      expect(store.entries[0].outcome).toBe('success')
    })

    it('should accept failure outcome', async () => {
      await writer.write({
        action: 'login',
        resource: 'sessions/failed',
        actor: { type: 'user', id: 'user-1' },
        outcome: 'failure',
        reason: 'Invalid credentials',
      })

      await writer.flush()

      expect(store.entries[0].outcome).toBe('failure')
      expect(store.entries[0].reason).toBe('Invalid credentials')
    })
  })
})
