/**
 * Schema Evolution during CDC Tests
 *
 * TDD RED phase: Tests for handling schema changes (DDL) during CDC streaming
 * without interrupting the change stream.
 *
 * Requirements:
 * - Detect schema changes from DDL events in WAL
 * - Track schema versions with timestamps
 * - Transform events to match current or historical schema
 * - Support column additions, removals, and type changes
 * - Emit schema change events for downstream consumers
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Schema Evolution types and functions
  SchemaEvolution,
  createSchemaEvolution,
  SchemaRegistry,
  createSchemaRegistry,
  SchemaTransformer,
  createSchemaTransformer,
  // Types
  type SchemaVersion,
  type SchemaField,
  type DDLEvent,
  type DDLEventType,
  type SchemaCompatibility,
  type EvolutionResult,
  type TransformResult,
  // Constants
  DDLEventTypes,
  CompatibilityModes,
} from '../schema-evolution'
import { ChangeOperation, type ChangeEvent, createInsertEvent, createUpdateEvent } from '../change-event'

// ============================================================================
// TEST DATA
// ============================================================================

interface UserV1 {
  id: string
  name: string
  email: string
}

interface UserV2 extends UserV1 {
  age?: number // Added column
}

interface UserV3 extends Omit<UserV2, 'email'> {
  email_address: string // Renamed column
}

const userSchemaV1: SchemaVersion = {
  version: 1,
  name: 'users',
  timestamp: Date.now() - 100000,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
  ],
}

const userSchemaV2: SchemaVersion = {
  version: 2,
  name: 'users',
  timestamp: Date.now() - 50000,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'age', type: 'integer', required: false, default: null },
  ],
}

const userSchemaV3: SchemaVersion = {
  version: 3,
  name: 'users',
  timestamp: Date.now(),
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'email_address', type: 'string', required: true }, // Renamed from email
    { name: 'age', type: 'integer', required: false, default: null },
  ],
}

// ============================================================================
// TEST 1: ADD COLUMN HANDLING MID-STREAM
// ============================================================================

describe('Schema Evolution - ADD COLUMN', () => {
  let evolution: SchemaEvolution

  beforeEach(() => {
    evolution = createSchemaEvolution({
      initialSchema: userSchemaV1,
    })
  })

  it('should detect ADD COLUMN DDL event from WAL', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'age',
      columnType: 'integer',
      nullable: true,
      default: null,
      timestamp: Date.now(),
      lsn: '0/1234ABCD',
    }

    const result = await evolution.processDDL(ddlEvent)

    expect(result.success).toBe(true)
    expect(result.newVersion).toBe(2)
    expect(result.schemaChange).toBeDefined()
    expect(result.schemaChange!.type).toBe('ADD_COLUMN')
  })

  it('should apply ADD COLUMN to current schema', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'age',
      columnType: 'integer',
      nullable: true,
      default: 0,
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const currentSchema = evolution.getCurrentSchema('users')
    expect(currentSchema.fields).toHaveLength(4)
    expect(currentSchema.fields.find((f) => f.name === 'age')).toBeDefined()
  })

  it('should handle events before ADD COLUMN without the new field', async () => {
    // Event created before schema change
    const oldEvent: ChangeEvent<UserV1> = createInsertEvent('users', {
      id: '1',
      name: 'John',
      email: 'john@example.com',
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'age',
      columnType: 'integer',
      nullable: true,
      default: null,
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    // Transform old event to match new schema with default value
    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect(transformed.after).toHaveProperty('age')
    expect((transformed.after as UserV2).age).toBeNull()
  })

  it('should handle events after ADD COLUMN with the new field', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'age',
      columnType: 'integer',
      nullable: true,
      default: null,
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    // Event created after schema change
    const newEvent: ChangeEvent<UserV2> = createInsertEvent('users', {
      id: '2',
      name: 'Jane',
      email: 'jane@example.com',
      age: 30,
    })

    const transformed = await evolution.transformToCurrentSchema(newEvent)

    expect((transformed.after as UserV2).age).toBe(30)
  })

  it('should emit schema change event for downstream consumers', async () => {
    const schemaChanges: any[] = []
    evolution = createSchemaEvolution({
      initialSchema: userSchemaV1,
      onSchemaChange: (change) => {
        schemaChanges.push(change)
      },
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'age',
      columnType: 'integer',
      nullable: true,
      default: null,
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    expect(schemaChanges).toHaveLength(1)
    expect(schemaChanges[0].type).toBe('ADD_COLUMN')
    expect(schemaChanges[0].column).toBe('age')
    expect(schemaChanges[0].newVersion).toBe(2)
  })

  it('should apply default value when transforming events', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'status',
      columnType: 'string',
      nullable: false,
      default: 'active',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const oldEvent = createInsertEvent('users', {
      id: '1',
      name: 'John',
      email: 'john@example.com',
    })

    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect((transformed.after as any).status).toBe('active')
  })
})

// ============================================================================
// TEST 2: DROP COLUMN HANDLING WITH PROPER DEFAULTS
// ============================================================================

describe('Schema Evolution - DROP COLUMN', () => {
  let evolution: SchemaEvolution

  beforeEach(() => {
    evolution = createSchemaEvolution({
      initialSchema: userSchemaV2, // Has id, name, email, age
    })
  })

  it('should detect DROP COLUMN DDL event from WAL', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.DROP_COLUMN,
      table: 'users',
      column: 'age',
      timestamp: Date.now(),
      lsn: '0/5678EFGH',
    }

    const result = await evolution.processDDL(ddlEvent)

    expect(result.success).toBe(true)
    expect(result.newVersion).toBe(3)
    expect(result.schemaChange!.type).toBe('DROP_COLUMN')
  })

  it('should remove column from current schema', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.DROP_COLUMN,
      table: 'users',
      column: 'age',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const currentSchema = evolution.getCurrentSchema('users')
    expect(currentSchema.fields).toHaveLength(3)
    expect(currentSchema.fields.find((f) => f.name === 'age')).toBeUndefined()
  })

  it('should handle events before DROP COLUMN by stripping the field', async () => {
    // Event with the old field
    const oldEvent: ChangeEvent<UserV2> = createInsertEvent('users', {
      id: '1',
      name: 'John',
      email: 'john@example.com',
      age: 30,
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.DROP_COLUMN,
      table: 'users',
      column: 'age',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect(transformed.after).not.toHaveProperty('age')
  })

  it('should preserve dropped column data in historical queries', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.DROP_COLUMN,
      table: 'users',
      column: 'age',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    // Old event with dropped column
    const oldEvent: ChangeEvent<UserV2> = createInsertEvent('users', {
      id: '1',
      name: 'John',
      email: 'john@example.com',
      age: 30,
    })
    oldEvent.timestamp = Date.now() - 100000 // Before the DROP

    // Transform to historical schema
    const historical = await evolution.transformToSchemaVersion(oldEvent, 2)

    expect((historical.after as UserV2).age).toBe(30)
  })

  it('should emit schema change event for DROP COLUMN', async () => {
    const schemaChanges: any[] = []
    evolution = createSchemaEvolution({
      initialSchema: userSchemaV2,
      onSchemaChange: (change) => {
        schemaChanges.push(change)
      },
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.DROP_COLUMN,
      table: 'users',
      column: 'age',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    expect(schemaChanges).toHaveLength(1)
    expect(schemaChanges[0].type).toBe('DROP_COLUMN')
    expect(schemaChanges[0].column).toBe('age')
  })

  it('should handle UPDATE events spanning DROP COLUMN', async () => {
    const beforeDrop: UserV2 = { id: '1', name: 'John', email: 'john@example.com', age: 30 }
    const afterDrop: UserV1 = { id: '1', name: 'John Updated', email: 'john@example.com' }

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.DROP_COLUMN,
      table: 'users',
      column: 'age',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const updateEvent = createUpdateEvent('users', beforeDrop, afterDrop)
    const transformed = await evolution.transformToCurrentSchema(updateEvent)

    expect(transformed.before).not.toHaveProperty('age')
    expect(transformed.after).not.toHaveProperty('age')
  })
})

// ============================================================================
// TEST 3: COLUMN TYPE CHANGES AND COERCION
// ============================================================================

describe('Schema Evolution - Type Changes', () => {
  let evolution: SchemaEvolution

  beforeEach(() => {
    evolution = createSchemaEvolution({
      initialSchema: {
        version: 1,
        name: 'products',
        timestamp: Date.now() - 100000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'price', type: 'string', required: true }, // Initially string
          { name: 'quantity', type: 'string', required: true },
        ],
      },
    })
  })

  it('should detect MODIFY COLUMN type change from WAL', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'products',
      column: 'price',
      columnType: 'float',
      previousType: 'string',
      timestamp: Date.now(),
    }

    const result = await evolution.processDDL(ddlEvent)

    expect(result.success).toBe(true)
    expect(result.schemaChange!.type).toBe('MODIFY_COLUMN')
    expect(result.schemaChange!.previousType).toBe('string')
    expect(result.schemaChange!.newType).toBe('float')
  })

  it('should coerce string to integer', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'products',
      column: 'quantity',
      columnType: 'integer',
      previousType: 'string',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const oldEvent = createInsertEvent('products', {
      id: 'p1',
      price: '19.99',
      quantity: '42',
    })

    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect((transformed.after as any).quantity).toBe(42)
    expect(typeof (transformed.after as any).quantity).toBe('number')
  })

  it('should coerce string to float', async () => {
    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'products',
      column: 'price',
      columnType: 'float',
      previousType: 'string',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const oldEvent = createInsertEvent('products', {
      id: 'p1',
      price: '19.99',
      quantity: '42',
    })

    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect((transformed.after as any).price).toBe(19.99)
    expect(typeof (transformed.after as any).price).toBe('number')
  })

  it('should coerce string to boolean', async () => {
    evolution = createSchemaEvolution({
      initialSchema: {
        version: 1,
        name: 'flags',
        timestamp: Date.now() - 100000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'enabled', type: 'string', required: true },
        ],
      },
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'flags',
      column: 'enabled',
      columnType: 'boolean',
      previousType: 'string',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const oldEvent = createInsertEvent('flags', { id: 'f1', enabled: 'true' })
    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect((transformed.after as any).enabled).toBe(true)
    expect(typeof (transformed.after as any).enabled).toBe('boolean')
  })

  it('should coerce integer to string', async () => {
    evolution = createSchemaEvolution({
      initialSchema: {
        version: 1,
        name: 'items',
        timestamp: Date.now() - 100000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'code', type: 'integer', required: true },
        ],
      },
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'items',
      column: 'code',
      columnType: 'string',
      previousType: 'integer',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const oldEvent = createInsertEvent('items', { id: 'i1', code: 12345 })
    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect((transformed.after as any).code).toBe('12345')
    expect(typeof (transformed.after as any).code).toBe('string')
  })

  it('should handle timestamp to string conversion', async () => {
    evolution = createSchemaEvolution({
      initialSchema: {
        version: 1,
        name: 'logs',
        timestamp: Date.now() - 100000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'created_at', type: 'timestamp', required: true },
        ],
      },
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'logs',
      column: 'created_at',
      columnType: 'string',
      previousType: 'timestamp',
      timestamp: Date.now(),
    }

    await evolution.processDDL(ddlEvent)

    const oldEvent = createInsertEvent('logs', { id: 'l1', created_at: 1704067200000 })
    const transformed = await evolution.transformToCurrentSchema(oldEvent)

    expect(typeof (transformed.after as any).created_at).toBe('string')
    expect((transformed.after as any).created_at).toMatch(/2024-01-01/)
  })

  it('should throw on incompatible type coercion', async () => {
    evolution = createSchemaEvolution({
      initialSchema: {
        version: 1,
        name: 'complex',
        timestamp: Date.now() - 100000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'data', type: 'object', required: true },
        ],
      },
      strictMode: true,
    })

    const ddlEvent: DDLEvent = {
      type: DDLEventTypes.MODIFY_COLUMN,
      table: 'complex',
      column: 'data',
      columnType: 'integer',
      previousType: 'object',
      timestamp: Date.now(),
    }

    const result = await evolution.processDDL(ddlEvent)

    expect(result.success).toBe(false)
    expect(result.error).toContain('incompatible')
  })
})

// ============================================================================
// TEST 4: SCHEMA REGISTRY INTEGRATION
// ============================================================================

describe('Schema Evolution - Schema Registry', () => {
  let registry: SchemaRegistry

  beforeEach(() => {
    registry = createSchemaRegistry()
  })

  it('should register and retrieve schema versions', async () => {
    await registry.register(userSchemaV1)
    await registry.register(userSchemaV2)

    const schema = await registry.getSchema('users', 1)
    expect(schema).toEqual(userSchemaV1)

    const schemaV2 = await registry.getSchema('users', 2)
    expect(schemaV2).toEqual(userSchemaV2)
  })

  it('should get latest schema version', async () => {
    await registry.register(userSchemaV1)
    await registry.register(userSchemaV2)
    await registry.register(userSchemaV3)

    const latest = await registry.getLatestSchema('users')
    expect(latest.version).toBe(3)
  })

  it('should track schema version history', async () => {
    await registry.register(userSchemaV1)
    await registry.register(userSchemaV2)
    await registry.register(userSchemaV3)

    const history = await registry.getSchemaHistory('users')

    expect(history).toHaveLength(3)
    expect(history[0].version).toBe(1)
    expect(history[1].version).toBe(2)
    expect(history[2].version).toBe(3)
  })

  it('should find schema version by timestamp', async () => {
    await registry.register(userSchemaV1)
    await registry.register(userSchemaV2)
    await registry.register(userSchemaV3)

    // Find schema valid at a specific time
    const schema = await registry.getSchemaAtTimestamp('users', userSchemaV1.timestamp + 10)
    expect(schema.version).toBe(1)

    const schemaV2 = await registry.getSchemaAtTimestamp('users', userSchemaV2.timestamp + 10)
    expect(schemaV2.version).toBe(2)
  })

  it('should check schema compatibility', async () => {
    await registry.register(userSchemaV1)

    // Compatible: adding optional column
    const compatibleResult = await registry.checkCompatibility('users', userSchemaV2, 'BACKWARD')
    expect(compatibleResult.compatible).toBe(true)

    // Incompatible: adding required column without default
    const incompatibleSchema: SchemaVersion = {
      ...userSchemaV2,
      fields: [
        ...userSchemaV1.fields,
        { name: 'required_field', type: 'string', required: true }, // No default!
      ],
    }

    const incompatibleResult = await registry.checkCompatibility('users', incompatibleSchema, 'BACKWARD')
    expect(incompatibleResult.compatible).toBe(false)
    expect(incompatibleResult.errors).toContain('Adding required field without default breaks backward compatibility')
  })

  it('should support different compatibility modes', async () => {
    await registry.register(userSchemaV1)
    await registry.register(userSchemaV2)

    // BACKWARD compatibility: new consumers can read old data
    const backwardResult = await registry.checkCompatibility('users', userSchemaV2, 'BACKWARD')
    expect(backwardResult.compatible).toBe(true)

    // FORWARD compatibility: old consumers can read new data
    const forwardResult = await registry.checkCompatibility('users', userSchemaV2, 'FORWARD')
    expect(forwardResult.compatible).toBe(true)

    // FULL compatibility: both directions
    const fullResult = await registry.checkCompatibility('users', userSchemaV2, 'FULL')
    expect(fullResult.compatible).toBe(true)
  })

  it('should detect breaking changes', async () => {
    await registry.register(userSchemaV1)

    // Breaking: removing required column
    const breakingSchema: SchemaVersion = {
      version: 2,
      name: 'users',
      timestamp: Date.now(),
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        // email removed!
      ],
    }

    const result = await registry.checkCompatibility('users', breakingSchema, 'BACKWARD')
    expect(result.compatible).toBe(false)
    expect(result.breakingChanges).toContain('Removed required field: email')
  })

  it('should support schema namespace/subject', async () => {
    const schema1: SchemaVersion = {
      ...userSchemaV1,
      namespace: 'production',
    }
    const schema2: SchemaVersion = {
      ...userSchemaV1,
      namespace: 'staging',
    }

    await registry.register(schema1)
    await registry.register(schema2)

    const prodSchema = await registry.getLatestSchema('users', 'production')
    const stagingSchema = await registry.getLatestSchema('users', 'staging')

    expect(prodSchema.namespace).toBe('production')
    expect(stagingSchema.namespace).toBe('staging')
  })
})

// ============================================================================
// TEST 5: BACKWARD/FORWARD COMPATIBILITY OF EVENTS
// ============================================================================

describe('Schema Evolution - Compatibility', () => {
  let transformer: SchemaTransformer

  beforeEach(() => {
    transformer = createSchemaTransformer({
      registry: createSchemaRegistry(),
    })
  })

  describe('backward compatibility', () => {
    it('should transform old events to new schema', async () => {
      await transformer.registerSchema(userSchemaV1)
      await transformer.registerSchema(userSchemaV2)

      // Old event without 'age' field
      const oldEvent = createInsertEvent<UserV1>('users', {
        id: '1',
        name: 'John',
        email: 'john@example.com',
      })
      oldEvent.schema = { name: 'users', version: 1, fields: userSchemaV1.fields }

      // Transform to V2
      const result = await transformer.transform(oldEvent, 2)

      expect(result.success).toBe(true)
      expect(result.event.after).toHaveProperty('age')
      expect((result.event.after as UserV2).age).toBeNull() // default
    })

    it('should add missing optional fields with defaults', async () => {
      const schemaWithDefaults: SchemaVersion = {
        version: 2,
        name: 'items',
        timestamp: Date.now(),
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'status', type: 'string', required: false, default: 'pending' },
          { name: 'priority', type: 'integer', required: false, default: 0 },
        ],
      }

      await transformer.registerSchema({
        version: 1,
        name: 'items',
        timestamp: Date.now() - 100000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      })
      await transformer.registerSchema(schemaWithDefaults)

      const oldEvent = createInsertEvent('items', { id: '1', name: 'Item1' })
      const result = await transformer.transform(oldEvent, 2)

      expect((result.event.after as any).status).toBe('pending')
      expect((result.event.after as any).priority).toBe(0)
    })
  })

  describe('forward compatibility', () => {
    it('should transform new events to old schema', async () => {
      await transformer.registerSchema(userSchemaV1)
      await transformer.registerSchema(userSchemaV2)

      // New event with 'age' field
      const newEvent = createInsertEvent<UserV2>('users', {
        id: '1',
        name: 'John',
        email: 'john@example.com',
        age: 30,
      })
      newEvent.schema = { name: 'users', version: 2, fields: userSchemaV2.fields }

      // Transform back to V1
      const result = await transformer.transform(newEvent, 1)

      expect(result.success).toBe(true)
      expect(result.event.after).not.toHaveProperty('age')
    })

    it('should strip unknown fields when downgrading', async () => {
      await transformer.registerSchema(userSchemaV1)
      await transformer.registerSchema(userSchemaV2)

      const newEvent = createInsertEvent('users', {
        id: '1',
        name: 'John',
        email: 'john@example.com',
        age: 30,
        extra_field: 'should be removed',
      })

      const result = await transformer.transform(newEvent, 1)

      expect(result.event.after).not.toHaveProperty('age')
      expect(result.event.after).not.toHaveProperty('extra_field')
    })
  })

  describe('multi-version transformation', () => {
    it('should transform across multiple versions', async () => {
      await transformer.registerSchema(userSchemaV1)
      await transformer.registerSchema(userSchemaV2)
      await transformer.registerSchema(userSchemaV3)

      // V1 event
      const v1Event = createInsertEvent<UserV1>('users', {
        id: '1',
        name: 'John',
        email: 'john@example.com',
      })

      // Transform V1 -> V3
      const result = await transformer.transform(v1Event, 3)

      expect(result.success).toBe(true)
      // age should be added with default
      expect((result.event.after as any).age).toBeNull()
      // email should be renamed to email_address
      expect(result.event.after).not.toHaveProperty('email')
      expect((result.event.after as any).email_address).toBe('john@example.com')
    })

    it('should chain transformations in correct order', async () => {
      const v1: SchemaVersion = {
        version: 1,
        name: 'data',
        timestamp: Date.now() - 30000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'value', type: 'string', required: true },
        ],
      }
      const v2: SchemaVersion = {
        version: 2,
        name: 'data',
        timestamp: Date.now() - 20000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'value', type: 'integer', required: true }, // string -> int
        ],
        migrations: [
          { column: 'value', from: 'string', to: 'integer', transformer: (v) => parseInt(v as string, 10) },
        ],
      }
      const v3: SchemaVersion = {
        version: 3,
        name: 'data',
        timestamp: Date.now() - 10000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'value', type: 'integer', required: true },
          { name: 'doubled', type: 'integer', required: true },
        ],
        migrations: [
          { column: 'doubled', computed: true, transformer: (_, row) => (row.value as number) * 2 },
        ],
      }

      await transformer.registerSchema(v1)
      await transformer.registerSchema(v2)
      await transformer.registerSchema(v3)

      const event = createInsertEvent('data', { id: '1', value: '42' })

      const result = await transformer.transform(event, 3)

      expect((result.event.after as any).value).toBe(42)
      expect((result.event.after as any).doubled).toBe(84)
    })
  })

  describe('UPDATE event compatibility', () => {
    it('should transform both before and after in UPDATE events', async () => {
      await transformer.registerSchema(userSchemaV1)
      await transformer.registerSchema(userSchemaV2)

      const updateEvent = createUpdateEvent<UserV1>(
        'users',
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '1', name: 'Jane', email: 'jane@example.com' }
      )

      const result = await transformer.transform(updateEvent, 2)

      expect((result.event.before as UserV2).age).toBeNull()
      expect((result.event.after as UserV2).age).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should report transformation errors', async () => {
      await transformer.registerSchema(userSchemaV1)

      const event = createInsertEvent('users', { id: '1', name: 'John', email: 'john@example.com' })

      // Try to transform to non-existent version
      const result = await transformer.transform(event, 99)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Schema version 99 not found')
    })

    it('should handle coercion failures gracefully', async () => {
      const v1: SchemaVersion = {
        version: 1,
        name: 'data',
        timestamp: Date.now() - 10000,
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'count', type: 'string', required: true },
        ],
      }
      const v2: SchemaVersion = {
        version: 2,
        name: 'data',
        timestamp: Date.now(),
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'count', type: 'integer', required: true },
        ],
      }

      await transformer.registerSchema(v1)
      await transformer.registerSchema(v2)

      // Invalid data that can't be coerced
      const event = createInsertEvent('data', { id: '1', count: 'not-a-number' })

      const result = await transformer.transform(event, 2)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot coerce')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Schema Evolution - Integration', () => {
  it('should handle continuous stream with schema changes', async () => {
    const registry = createSchemaRegistry()
    const evolution = createSchemaEvolution({
      initialSchema: userSchemaV1,
      registry,
    })

    const events: any[] = []
    const schemaChanges: any[] = []

    evolution.onSchemaChange((change) => schemaChanges.push(change))

    // Simulate continuous CDC stream
    events.push(createInsertEvent('users', { id: '1', name: 'User1', email: 'u1@example.com' }))
    events.push(createInsertEvent('users', { id: '2', name: 'User2', email: 'u2@example.com' }))

    // Schema change mid-stream
    await evolution.processDDL({
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'age',
      columnType: 'integer',
      nullable: true,
      default: null,
      timestamp: Date.now(),
    })

    events.push(createInsertEvent('users', { id: '3', name: 'User3', email: 'u3@example.com', age: 25 }))

    // Another schema change
    await evolution.processDDL({
      type: DDLEventTypes.ADD_COLUMN,
      table: 'users',
      column: 'verified',
      columnType: 'boolean',
      nullable: true,
      default: false,
      timestamp: Date.now(),
    })

    events.push(createInsertEvent('users', { id: '4', name: 'User4', email: 'u4@example.com', age: 30, verified: true }))

    // Transform all events to current schema
    const transformedEvents = await Promise.all(events.map((e) => evolution.transformToCurrentSchema(e)))

    // All events should have all fields
    for (const event of transformedEvents) {
      expect(event.after).toHaveProperty('age')
      expect(event.after).toHaveProperty('verified')
    }

    // Old events should have defaults
    expect((transformedEvents[0].after as any).age).toBeNull()
    expect((transformedEvents[0].after as any).verified).toBe(false)

    // New events should have actual values
    expect((transformedEvents[2].after as any).age).toBe(25)
    expect((transformedEvents[3].after as any).verified).toBe(true)

    // Schema changes should be tracked
    expect(schemaChanges).toHaveLength(2)
  })

  it('should recover schema state from WAL on restart', async () => {
    const walEvents: DDLEvent[] = [
      {
        type: DDLEventTypes.ADD_COLUMN,
        table: 'users',
        column: 'age',
        columnType: 'integer',
        nullable: true,
        default: null,
        timestamp: Date.now() - 50000,
        lsn: '0/1000',
      },
      {
        type: DDLEventTypes.ADD_COLUMN,
        table: 'users',
        column: 'status',
        columnType: 'string',
        nullable: true,
        default: 'active',
        timestamp: Date.now() - 25000,
        lsn: '0/2000',
      },
    ]

    // Simulate restart by replaying WAL
    const evolution = createSchemaEvolution({
      initialSchema: userSchemaV1,
    })

    for (const ddl of walEvents) {
      await evolution.processDDL(ddl)
    }

    const currentSchema = evolution.getCurrentSchema('users')

    expect(currentSchema.version).toBe(3)
    expect(currentSchema.fields).toHaveLength(5) // id, name, email, age, status
  })
})
