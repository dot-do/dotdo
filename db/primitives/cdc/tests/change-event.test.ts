/**
 * ChangeEvent Schema and Serialization Tests
 *
 * TDD RED phase: These tests define the expected behavior of ChangeEvent schema
 * and serialization. Tests verify:
 * - Schema definition (type, before, after, timestamp)
 * - JSON serialization roundtrip
 * - Schema validation and type coercion
 * - Metadata extraction and enrichment
 */
import { describe, it, expect } from 'vitest'
import {
  // Types
  type ChangeEvent,
  type ChangeEventMetadata,
  type ChangeEventSchema as ChangeEventSchemaType,
  ChangeOperation,
  // Schema validation
  ChangeEventSchema,
  validateChangeEvent,
  parseChangeEvent,
  // Serialization
  serializeChangeEvent,
  deserializeChangeEvent,
  // Factory
  createChangeEvent,
  createInsertEvent,
  createUpdateEvent,
  createDeleteEvent,
  // Schema embedding
  embedSchema,
  extractSchema,
  // Utilities
  getChangedFields,
  isValidChangeEvent,
} from '../change-event'

// ============================================================================
// TEST DATA
// ============================================================================

interface UserRecord {
  id: string
  name: string
  email: string
  age: number
  active: boolean
  tags: string[]
  metadata?: Record<string, unknown>
}

const sampleUser: UserRecord = {
  id: 'user-123',
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
  active: true,
  tags: ['admin', 'verified'],
  metadata: { source: 'signup' },
}

const updatedUser: UserRecord = {
  ...sampleUser,
  name: 'Jane Doe',
  email: 'jane@example.com',
  age: 31,
}

// ============================================================================
// SCHEMA DEFINITION TESTS
// ============================================================================

describe('ChangeEvent Schema Definition', () => {
  describe('operation types', () => {
    it('should support INSERT operation', () => {
      const event = createInsertEvent('users', sampleUser)

      expect(event.operation).toBe(ChangeOperation.INSERT)
      expect(event.before).toBeNull()
      expect(event.after).toEqual(sampleUser)
    })

    it('should support UPDATE operation with before/after states', () => {
      const event = createUpdateEvent('users', sampleUser, updatedUser)

      expect(event.operation).toBe(ChangeOperation.UPDATE)
      expect(event.before).toEqual(sampleUser)
      expect(event.after).toEqual(updatedUser)
    })

    it('should support DELETE operation', () => {
      const event = createDeleteEvent('users', sampleUser)

      expect(event.operation).toBe(ChangeOperation.DELETE)
      expect(event.before).toEqual(sampleUser)
      expect(event.after).toBeNull()
    })
  })

  describe('required fields', () => {
    it('should have unique event ID', () => {
      const event1 = createInsertEvent('users', sampleUser)
      const event2 = createInsertEvent('users', sampleUser)

      expect(event1.id).toBeDefined()
      expect(event2.id).toBeDefined()
      expect(event1.id).not.toBe(event2.id)
    })

    it('should have timestamp', () => {
      const beforeTs = Date.now()
      const event = createInsertEvent('users', sampleUser)
      const afterTs = Date.now()

      expect(event.timestamp).toBeGreaterThanOrEqual(beforeTs)
      expect(event.timestamp).toBeLessThanOrEqual(afterTs)
    })

    it('should have source table name', () => {
      const event = createInsertEvent('users', sampleUser)

      expect(event.table).toBe('users')
    })

    it('should have sequence number', () => {
      const event = createInsertEvent('users', sampleUser, { sequence: 42 })

      expect(event.sequence).toBe(42)
    })
  })

  describe('optional metadata', () => {
    it('should support transaction ID', () => {
      const event = createInsertEvent('users', sampleUser, {
        transactionId: 'tx-abc123',
      })

      expect(event.metadata?.transactionId).toBe('tx-abc123')
    })

    it('should support source system identifier', () => {
      const event = createInsertEvent('users', sampleUser, {
        source: 'postgres-primary',
      })

      expect(event.metadata?.source).toBe('postgres-primary')
    })

    it('should support LSN (Log Sequence Number)', () => {
      const event = createInsertEvent('users', sampleUser, {
        lsn: '0/1234ABC',
      })

      expect(event.metadata?.lsn).toBe('0/1234ABC')
    })

    it('should support partition identifier', () => {
      const event = createInsertEvent('users', sampleUser, {
        partition: 'partition-0',
      })

      expect(event.metadata?.partition).toBe('partition-0')
    })

    it('should support custom metadata', () => {
      const event = createInsertEvent('users', sampleUser, {
        custom: { environment: 'production', region: 'us-east-1' },
      })

      expect(event.metadata?.custom).toEqual({ environment: 'production', region: 'us-east-1' })
    })
  })
})

// ============================================================================
// SCHEMA VALIDATION TESTS
// ============================================================================

describe('ChangeEvent Schema Validation', () => {
  describe('Zod schema validation', () => {
    it('should validate correct INSERT event', () => {
      const event = createInsertEvent('users', sampleUser)
      const result = ChangeEventSchema.safeParse(event)

      expect(result.success).toBe(true)
    })

    it('should validate correct UPDATE event', () => {
      const event = createUpdateEvent('users', sampleUser, updatedUser)
      const result = ChangeEventSchema.safeParse(event)

      expect(result.success).toBe(true)
    })

    it('should validate correct DELETE event', () => {
      const event = createDeleteEvent('users', sampleUser)
      const result = ChangeEventSchema.safeParse(event)

      expect(result.success).toBe(true)
    })

    it('should reject event without required id', () => {
      const invalidEvent = {
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: sampleUser,
        timestamp: Date.now(),
        // missing id
      }

      const result = ChangeEventSchema.safeParse(invalidEvent)
      expect(result.success).toBe(false)
    })

    it('should reject event without required operation', () => {
      const invalidEvent = {
        id: 'evt-123',
        table: 'users',
        before: null,
        after: sampleUser,
        timestamp: Date.now(),
        // missing operation
      }

      const result = ChangeEventSchema.safeParse(invalidEvent)
      expect(result.success).toBe(false)
    })

    it('should reject event with invalid operation type', () => {
      const invalidEvent = {
        id: 'evt-123',
        operation: 'INVALID',
        table: 'users',
        before: null,
        after: sampleUser,
        timestamp: Date.now(),
      }

      const result = ChangeEventSchema.safeParse(invalidEvent)
      expect(result.success).toBe(false)
    })

    it('should reject event without timestamp', () => {
      const invalidEvent = {
        id: 'evt-123',
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: sampleUser,
        // missing timestamp
      }

      const result = ChangeEventSchema.safeParse(invalidEvent)
      expect(result.success).toBe(false)
    })
  })

  describe('semantic validation', () => {
    it('should reject INSERT with non-null before', () => {
      const result = validateChangeEvent({
        id: 'evt-123',
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: sampleUser, // Invalid: INSERT should have null before
        after: sampleUser,
        timestamp: Date.now(),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('INSERT event must have null before state')
    })

    it('should reject INSERT with null after', () => {
      const result = validateChangeEvent({
        id: 'evt-123',
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: null, // Invalid: INSERT should have non-null after
        timestamp: Date.now(),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('INSERT event must have non-null after state')
    })

    it('should reject DELETE with non-null after', () => {
      const result = validateChangeEvent({
        id: 'evt-123',
        operation: ChangeOperation.DELETE,
        table: 'users',
        before: sampleUser,
        after: sampleUser, // Invalid: DELETE should have null after
        timestamp: Date.now(),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('DELETE event must have null after state')
    })

    it('should reject DELETE with null before', () => {
      const result = validateChangeEvent({
        id: 'evt-123',
        operation: ChangeOperation.DELETE,
        table: 'users',
        before: null, // Invalid: DELETE should have non-null before
        after: null,
        timestamp: Date.now(),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('DELETE event must have non-null before state')
    })

    it('should reject UPDATE with null before', () => {
      const result = validateChangeEvent({
        id: 'evt-123',
        operation: ChangeOperation.UPDATE,
        table: 'users',
        before: null, // Invalid: UPDATE should have non-null before
        after: updatedUser,
        timestamp: Date.now(),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('UPDATE event must have non-null before state')
    })

    it('should reject UPDATE with null after', () => {
      const result = validateChangeEvent({
        id: 'evt-123',
        operation: ChangeOperation.UPDATE,
        table: 'users',
        before: sampleUser,
        after: null, // Invalid: UPDATE should have non-null after
        timestamp: Date.now(),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('UPDATE event must have non-null after state')
    })
  })

  describe('parseChangeEvent utility', () => {
    it('should parse valid JSON string to ChangeEvent', () => {
      const event = createInsertEvent('users', sampleUser)
      const json = JSON.stringify(event)

      const parsed = parseChangeEvent(json)

      expect(parsed.id).toBe(event.id)
      expect(parsed.operation).toBe(event.operation)
      expect(parsed.after).toEqual(event.after)
    })

    it('should throw on invalid JSON', () => {
      expect(() => parseChangeEvent('invalid json')).toThrow()
    })

    it('should throw on invalid event structure', () => {
      expect(() => parseChangeEvent('{}')).toThrow()
    })
  })

  describe('isValidChangeEvent utility', () => {
    it('should return true for valid event', () => {
      const event = createInsertEvent('users', sampleUser)
      expect(isValidChangeEvent(event)).toBe(true)
    })

    it('should return false for invalid event', () => {
      expect(isValidChangeEvent({ invalid: 'data' })).toBe(false)
    })

    it('should return false for null', () => {
      expect(isValidChangeEvent(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isValidChangeEvent(undefined)).toBe(false)
    })
  })
})

// ============================================================================
// JSON SERIALIZATION TESTS
// ============================================================================

describe('ChangeEvent JSON Serialization', () => {
  describe('serializeChangeEvent', () => {
    it('should serialize INSERT event to JSON string', () => {
      const event = createInsertEvent('users', sampleUser)
      const json = serializeChangeEvent(event)

      expect(typeof json).toBe('string')
      const parsed = JSON.parse(json)
      expect(parsed.operation).toBe(ChangeOperation.INSERT)
    })

    it('should serialize UPDATE event preserving before/after', () => {
      const event = createUpdateEvent('users', sampleUser, updatedUser)
      const json = serializeChangeEvent(event)

      const parsed = JSON.parse(json)
      expect(parsed.before).toEqual(sampleUser)
      expect(parsed.after).toEqual(updatedUser)
    })

    it('should serialize DELETE event with null after', () => {
      const event = createDeleteEvent('users', sampleUser)
      const json = serializeChangeEvent(event)

      const parsed = JSON.parse(json)
      expect(parsed.before).toEqual(sampleUser)
      expect(parsed.after).toBeNull()
    })

    it('should preserve nested object structures', () => {
      const userWithNested = {
        ...sampleUser,
        address: {
          street: '123 Main St',
          city: 'Springfield',
          coordinates: { lat: 40.7128, lng: -74.0060 },
        },
      }
      const event = createInsertEvent('users', userWithNested)
      const json = serializeChangeEvent(event)

      const parsed = JSON.parse(json)
      expect(parsed.after.address.coordinates.lat).toBe(40.7128)
    })

    it('should preserve array fields', () => {
      const event = createInsertEvent('users', sampleUser)
      const json = serializeChangeEvent(event)

      const parsed = JSON.parse(json)
      expect(parsed.after.tags).toEqual(['admin', 'verified'])
    })

    it('should serialize Date objects as ISO strings', () => {
      const userWithDate = {
        ...sampleUser,
        createdAt: new Date('2024-01-15T10:30:00Z'),
      }
      const event = createInsertEvent('users', userWithDate)
      const json = serializeChangeEvent(event)

      const parsed = JSON.parse(json)
      expect(parsed.after.createdAt).toBe('2024-01-15T10:30:00.000Z')
    })

    it('should handle undefined values by omitting them', () => {
      const userWithUndefined = {
        ...sampleUser,
        optionalField: undefined,
      }
      const event = createInsertEvent('users', userWithUndefined)
      const json = serializeChangeEvent(event)

      const parsed = JSON.parse(json)
      expect('optionalField' in parsed.after).toBe(false)
    })
  })

  describe('deserializeChangeEvent', () => {
    it('should deserialize JSON string to ChangeEvent', () => {
      const original = createInsertEvent('users', sampleUser)
      const json = serializeChangeEvent(original)

      const deserialized = deserializeChangeEvent<UserRecord>(json)

      expect(deserialized.id).toBe(original.id)
      expect(deserialized.operation).toBe(original.operation)
      expect(deserialized.table).toBe(original.table)
      expect(deserialized.after).toEqual(original.after)
    })

    it('should restore timestamp as number', () => {
      const original = createInsertEvent('users', sampleUser)
      const json = serializeChangeEvent(original)

      const deserialized = deserializeChangeEvent<UserRecord>(json)

      expect(typeof deserialized.timestamp).toBe('number')
      expect(deserialized.timestamp).toBe(original.timestamp)
    })

    it('should preserve metadata through roundtrip', () => {
      const original = createInsertEvent('users', sampleUser, {
        transactionId: 'tx-123',
        source: 'postgres',
        lsn: '0/1234ABC',
      })
      const json = serializeChangeEvent(original)

      const deserialized = deserializeChangeEvent<UserRecord>(json)

      expect(deserialized.metadata?.transactionId).toBe('tx-123')
      expect(deserialized.metadata?.source).toBe('postgres')
      expect(deserialized.metadata?.lsn).toBe('0/1234ABC')
    })

    it('should throw on invalid JSON', () => {
      expect(() => deserializeChangeEvent('not valid json')).toThrow()
    })

    it('should throw on invalid event structure', () => {
      expect(() => deserializeChangeEvent(JSON.stringify({ foo: 'bar' }))).toThrow()
    })
  })

  describe('roundtrip serialization', () => {
    it('should maintain equality through serialize/deserialize roundtrip', () => {
      const original = createUpdateEvent('users', sampleUser, updatedUser, {
        transactionId: 'tx-456',
        sequence: 100,
      })

      const json = serializeChangeEvent(original)
      const restored = deserializeChangeEvent<UserRecord>(json)

      expect(restored.id).toBe(original.id)
      expect(restored.operation).toBe(original.operation)
      expect(restored.table).toBe(original.table)
      expect(restored.before).toEqual(original.before)
      expect(restored.after).toEqual(original.after)
      expect(restored.timestamp).toBe(original.timestamp)
      expect(restored.sequence).toBe(original.sequence)
    })

    it('should handle large payloads', () => {
      const largeRecord = {
        id: 'large-1',
        name: 'Large Record',
        data: Array(1000).fill(0).map((_, i) => ({ index: i, value: `item-${i}` })),
      }
      const event = createInsertEvent('large_table', largeRecord)

      const json = serializeChangeEvent(event)
      const restored = deserializeChangeEvent(json)

      expect(restored.after).toEqual(largeRecord)
    })

    it('should handle special characters in strings', () => {
      const userWithSpecialChars = {
        ...sampleUser,
        name: 'John "The Boss" Doe\nLine2\tTabbed',
        bio: 'Contains emoji: \u{1F600} and unicode: \u00E9',
      }
      const event = createInsertEvent('users', userWithSpecialChars)

      const json = serializeChangeEvent(event)
      const restored = deserializeChangeEvent<typeof userWithSpecialChars>(json)

      expect(restored.after?.name).toBe(userWithSpecialChars.name)
      expect(restored.after?.bio).toBe(userWithSpecialChars.bio)
    })
  })
})

// ============================================================================
// SCHEMA EMBEDDING TESTS
// ============================================================================

describe('ChangeEvent Schema Embedding', () => {
  describe('embedSchema', () => {
    it('should embed schema definition in event', () => {
      const event = createInsertEvent('users', sampleUser)
      const schema: ChangeEventSchemaType = {
        name: 'User',
        version: 1,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
          { name: 'age', type: 'integer', required: true },
          { name: 'active', type: 'boolean', required: true },
          { name: 'tags', type: 'array', items: 'string', required: true },
        ],
      }

      const eventWithSchema = embedSchema(event, schema)

      expect(eventWithSchema.schema).toEqual(schema)
      // Original event properties preserved
      expect(eventWithSchema.id).toBe(event.id)
      expect(eventWithSchema.after).toEqual(event.after)
    })

    it('should support schema versioning', () => {
      const event = createInsertEvent('users', sampleUser)
      const schemaV2: ChangeEventSchemaType = {
        name: 'User',
        version: 2,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
          { name: 'age', type: 'integer', required: true },
          { name: 'active', type: 'boolean', required: true },
          { name: 'tags', type: 'array', items: 'string', required: true },
          { name: 'createdAt', type: 'timestamp', required: false },
        ],
      }

      const eventWithSchema = embedSchema(event, schemaV2)

      expect(eventWithSchema.schema?.version).toBe(2)
    })
  })

  describe('extractSchema', () => {
    it('should extract embedded schema from event', () => {
      const event = createInsertEvent('users', sampleUser)
      const schema: ChangeEventSchemaType = {
        name: 'User',
        version: 1,
        fields: [{ name: 'id', type: 'string', required: true }],
      }
      const eventWithSchema = embedSchema(event, schema)

      const extracted = extractSchema(eventWithSchema)

      expect(extracted).toEqual(schema)
    })

    it('should return undefined if no schema embedded', () => {
      const event = createInsertEvent('users', sampleUser)

      const extracted = extractSchema(event)

      expect(extracted).toBeUndefined()
    })
  })

  describe('self-describing events', () => {
    it('should serialize schema with event', () => {
      const event = createInsertEvent('users', sampleUser)
      const schema: ChangeEventSchemaType = {
        name: 'User',
        version: 1,
        fields: [{ name: 'id', type: 'string', required: true }],
      }
      const eventWithSchema = embedSchema(event, schema)

      const json = serializeChangeEvent(eventWithSchema)
      const restored = deserializeChangeEvent(json)

      expect(restored.schema).toEqual(schema)
    })
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('ChangeEvent Utilities', () => {
  describe('getChangedFields', () => {
    it('should return empty array for INSERT events', () => {
      const event = createInsertEvent('users', sampleUser)

      const changed = getChangedFields(event)

      expect(changed).toEqual([])
    })

    it('should return empty array for DELETE events', () => {
      const event = createDeleteEvent('users', sampleUser)

      const changed = getChangedFields(event)

      expect(changed).toEqual([])
    })

    it('should return changed field names for UPDATE events', () => {
      const event = createUpdateEvent('users', sampleUser, updatedUser)

      const changed = getChangedFields(event)

      expect(changed).toContain('name')
      expect(changed).toContain('email')
      expect(changed).toContain('age')
      expect(changed).not.toContain('id')
      expect(changed).not.toContain('active')
    })

    it('should detect nested field changes', () => {
      const before = { id: '1', profile: { name: 'John', age: 30 } }
      const after = { id: '1', profile: { name: 'Jane', age: 30 } }
      const event = createUpdateEvent('users', before, after)

      const changed = getChangedFields(event)

      expect(changed).toContain('profile')
    })

    it('should detect array field changes', () => {
      const before = { id: '1', tags: ['a', 'b'] }
      const after = { id: '1', tags: ['a', 'b', 'c'] }
      const event = createUpdateEvent('items', before, after)

      const changed = getChangedFields(event)

      expect(changed).toContain('tags')
    })
  })

  describe('createChangeEvent factory', () => {
    it('should create event with all required fields', () => {
      const event = createChangeEvent({
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: sampleUser,
      })

      expect(event.id).toBeDefined()
      expect(event.operation).toBe(ChangeOperation.INSERT)
      expect(event.table).toBe('users')
      expect(event.before).toBeNull()
      expect(event.after).toEqual(sampleUser)
      expect(event.timestamp).toBeDefined()
    })

    it('should allow overriding auto-generated fields', () => {
      const customId = 'custom-event-id-123'
      const customTimestamp = 1704067200000 // 2024-01-01T00:00:00Z

      const event = createChangeEvent({
        id: customId,
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: sampleUser,
        timestamp: customTimestamp,
      })

      expect(event.id).toBe(customId)
      expect(event.timestamp).toBe(customTimestamp)
    })

    it('should accept metadata options', () => {
      const event = createChangeEvent({
        operation: ChangeOperation.INSERT,
        table: 'users',
        before: null,
        after: sampleUser,
        metadata: {
          transactionId: 'tx-789',
          source: 'mysql-primary',
          lsn: 'binlog.000001:12345',
        },
      })

      expect(event.metadata?.transactionId).toBe('tx-789')
      expect(event.metadata?.source).toBe('mysql-primary')
      expect(event.metadata?.lsn).toBe('binlog.000001:12345')
    })
  })
})

// ============================================================================
// TYPE COERCION TESTS
// ============================================================================

describe('ChangeEvent Type Coercion', () => {
  it('should coerce string timestamp to number', () => {
    const rawEvent = {
      id: 'evt-123',
      operation: ChangeOperation.INSERT,
      table: 'users',
      before: null,
      after: sampleUser,
      timestamp: '1704067200000', // string
    }

    const parsed = parseChangeEvent(JSON.stringify(rawEvent))

    expect(typeof parsed.timestamp).toBe('number')
    expect(parsed.timestamp).toBe(1704067200000)
  })

  it('should coerce ISO date string to timestamp number', () => {
    const rawEvent = {
      id: 'evt-123',
      operation: ChangeOperation.INSERT,
      table: 'users',
      before: null,
      after: sampleUser,
      timestamp: '2024-01-01T00:00:00.000Z', // ISO string
    }

    const parsed = parseChangeEvent(JSON.stringify(rawEvent))

    expect(typeof parsed.timestamp).toBe('number')
    expect(parsed.timestamp).toBe(1704067200000)
  })

  it('should handle numeric sequence from JSON', () => {
    const rawEvent = {
      id: 'evt-123',
      operation: ChangeOperation.INSERT,
      table: 'users',
      before: null,
      after: sampleUser,
      timestamp: Date.now(),
      sequence: 42,
    }

    const parsed = parseChangeEvent(JSON.stringify(rawEvent))

    expect(typeof parsed.sequence).toBe('number')
    expect(parsed.sequence).toBe(42)
  })
})
