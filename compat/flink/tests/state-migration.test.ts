/**
 * @dotdo/flink - State Migration Tests
 *
 * Tests for Flink state migration capabilities including:
 * - State schema evolution
 * - State migration between checkpoints
 * - Backward-compatible state changes
 * - State serialization versioning
 * - Migration validation
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/state_schema_evolution/
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Schema types
  Schema,
  SchemaDefinition,
  SchemaField,
  SchemaVersion,
  SchemaChange,

  // Compatibility types
  CompatibilityResult,
  SchemaCompatibilityCheckResult,

  // Migration types
  StateMigrator,
  MigrationContext,
  StateMigrationResult,
  ValidationResult,
  MigrationStep,

  // Error types
  StateMigrationError,
  MigrationErrorCode,

  // Classes
  SchemaEvolutionRules,
  SchemaComparator,
  VersionedJsonSerializer,
  StateMigrationManager,
  CheckpointMigrator,
  BackwardCompatibleState,

  // Checkpoint types
  CheckpointMigrationOptions,
  CheckpointMigrationResult,
} from '../state-migration'

// ===========================================================================
// Test Schemas
// ===========================================================================

function createUserSchemaV1(): Schema {
  return {
    id: 'user-v1',
    version: { major: 1, minor: 0, patch: 0 },
    definition: {
      type: 'object',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'int', required: true },
      ],
    },
    createdAt: Date.now(),
  }
}

function createUserSchemaV2(): Schema {
  return {
    id: 'user-v2',
    version: { major: 1, minor: 1, patch: 0 },
    definition: {
      type: 'object',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'int', required: true },
        { name: 'email', type: 'string', required: false, defaultValue: '' },
      ],
    },
    createdAt: Date.now(),
  }
}

function createUserSchemaV3(): Schema {
  return {
    id: 'user-v3',
    version: { major: 2, minor: 0, patch: 0 },
    definition: {
      type: 'object',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'long', required: true }, // Changed from int to long
        { name: 'email', type: 'string', required: true }, // Now required
      ],
    },
    createdAt: Date.now(),
  }
}

// ===========================================================================
// Schema Evolution Rules Tests
// ===========================================================================

describe('SchemaEvolutionRules', () => {
  describe('isFieldAdditionCompatible', () => {
    it('should return true for optional fields', () => {
      const field: SchemaField = {
        name: 'email',
        type: 'string',
        required: false,
      }

      expect(SchemaEvolutionRules.isFieldAdditionCompatible(field)).toBe(true)
    })

    it('should return true for required fields with defaults', () => {
      const field: SchemaField = {
        name: 'status',
        type: 'string',
        required: true,
        defaultValue: 'active',
      }

      expect(SchemaEvolutionRules.isFieldAdditionCompatible(field)).toBe(true)
    })

    it('should return false for required fields without defaults', () => {
      const field: SchemaField = {
        name: 'requiredField',
        type: 'string',
        required: true,
      }

      expect(SchemaEvolutionRules.isFieldAdditionCompatible(field)).toBe(false)
    })
  })

  describe('isFieldRemovalCompatible', () => {
    it('should return true for any field removal', () => {
      const field: SchemaField = {
        name: 'anyField',
        type: 'string',
        required: true,
      }

      expect(SchemaEvolutionRules.isFieldRemovalCompatible(field)).toBe(true)
    })
  })

  describe('isTypeChangeCompatible', () => {
    it('should allow int to long widening', () => {
      expect(SchemaEvolutionRules.isTypeChangeCompatible('int', 'long')).toBe(true)
    })

    it('should allow int to double widening', () => {
      expect(SchemaEvolutionRules.isTypeChangeCompatible('int', 'double')).toBe(true)
    })

    it('should allow float to double widening', () => {
      expect(SchemaEvolutionRules.isTypeChangeCompatible('float', 'double')).toBe(true)
    })

    it('should not allow long to int narrowing', () => {
      expect(SchemaEvolutionRules.isTypeChangeCompatible('long', 'int')).toBe(false)
    })

    it('should not allow string to int conversion', () => {
      expect(SchemaEvolutionRules.isTypeChangeCompatible('string', 'int')).toBe(false)
    })
  })

  describe('getCompatibility', () => {
    it('should return COMPATIBLE for no changes', () => {
      const result = SchemaEvolutionRules.getCompatibility([])

      expect(result).toBe(CompatibilityResult.COMPATIBLE)
    })

    it('should return COMPATIBLE_WITH_EVOLVING_MIGRATION for additions', () => {
      const changes: SchemaChange[] = [
        {
          changeType: 'ADD_FIELD',
          fieldName: 'email',
          isBackwardCompatible: true,
          isForwardCompatible: true,
        },
      ]

      const result = SchemaEvolutionRules.getCompatibility(changes)

      expect(result).toBe(CompatibilityResult.COMPATIBLE_WITH_EVOLVING_MIGRATION)
    })

    it('should return INCOMPATIBLE for incompatible changes', () => {
      const changes: SchemaChange[] = [
        {
          changeType: 'CHANGE_TYPE',
          fieldName: 'id',
          oldValue: 'string',
          newValue: 'int',
          isBackwardCompatible: false,
          isForwardCompatible: false,
        },
      ]

      const result = SchemaEvolutionRules.getCompatibility(changes)

      expect(result).toBe(CompatibilityResult.INCOMPATIBLE)
    })
  })
})

// ===========================================================================
// Schema Comparator Tests
// ===========================================================================

describe('SchemaComparator', () => {
  describe('compare', () => {
    it('should detect no changes for identical schemas', () => {
      const schema1 = createUserSchemaV1()
      const schema2 = createUserSchemaV1()

      const changes = SchemaComparator.compare(schema1, schema2)

      expect(changes).toHaveLength(0)
    })

    it('should detect added fields', () => {
      const schema1 = createUserSchemaV1()
      const schema2 = createUserSchemaV2()

      const changes = SchemaComparator.compare(schema1, schema2)

      expect(changes).toHaveLength(1)
      expect(changes[0]?.changeType).toBe('ADD_FIELD')
      expect(changes[0]?.fieldName).toBe('email')
    })

    it('should detect removed fields', () => {
      const schema1 = createUserSchemaV2()
      const schema2 = createUserSchemaV1()

      const changes = SchemaComparator.compare(schema1, schema2)

      expect(changes.some((c) => c.changeType === 'REMOVE_FIELD')).toBe(true)
    })

    it('should detect type changes', () => {
      const schema1 = createUserSchemaV2()
      const schema2 = createUserSchemaV3()

      const changes = SchemaComparator.compare(schema1, schema2)

      const typeChange = changes.find(
        (c) => c.changeType === 'CHANGE_TYPE' && c.fieldName === 'age'
      )

      expect(typeChange).toBeDefined()
      expect(typeChange?.oldValue).toBe('int')
      expect(typeChange?.newValue).toBe('long')
    })

    it('should detect root type changes', () => {
      const schema1: Schema = {
        id: 'obj-schema',
        version: { major: 1, minor: 0, patch: 0 },
        definition: { type: 'object', fields: [] },
        createdAt: Date.now(),
      }

      const schema2: Schema = {
        id: 'arr-schema',
        version: { major: 1, minor: 0, patch: 0 },
        definition: { type: 'array' },
        createdAt: Date.now(),
      }

      const changes = SchemaComparator.compare(schema1, schema2)

      expect(changes).toHaveLength(1)
      expect(changes[0]?.changeType).toBe('CHANGE_TYPE')
      expect(changes[0]?.fieldName).toBe('$root')
    })
  })

  describe('checkCompatibility', () => {
    it('should return COMPATIBLE for identical schemas', () => {
      const schema1 = createUserSchemaV1()
      const schema2 = createUserSchemaV1()

      const result = SchemaComparator.checkCompatibility(schema1, schema2)

      expect(result.result).toBe(CompatibilityResult.COMPATIBLE)
      expect(result.requiresMigration).toBe(false)
    })

    it('should return COMPATIBLE_WITH_EVOLVING_MIGRATION for field additions', () => {
      const schema1 = createUserSchemaV1()
      const schema2 = createUserSchemaV2()

      const result = SchemaComparator.checkCompatibility(schema1, schema2)

      expect(result.result).toBe(CompatibilityResult.COMPATIBLE_WITH_EVOLVING_MIGRATION)
      expect(result.requiresMigration).toBe(true)
      expect(result.migrationPath).toBeDefined()
      expect(result.migrationPath?.length).toBeGreaterThan(0)
    })

    it('should provide migration path for compatible changes', () => {
      const schema1 = createUserSchemaV1()
      const schema2 = createUserSchemaV2()

      const result = SchemaComparator.checkCompatibility(schema1, schema2)

      expect(result.migrationPath).toBeDefined()
      expect(result.migrationPath?.some((step) => step.stepId.includes('add-email'))).toBe(
        true
      )
    })

    it('should list incompatible changes', () => {
      const schema1: Schema = {
        id: 'schema1',
        version: { major: 1, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        createdAt: Date.now(),
      }

      const schema2: Schema = {
        id: 'schema2',
        version: { major: 2, minor: 0, patch: 0 },
        definition: { type: 'array' },
        createdAt: Date.now(),
      }

      const result = SchemaComparator.checkCompatibility(schema1, schema2)

      expect(result.result).toBe(CompatibilityResult.INCOMPATIBLE)
      expect(result.incompatibleChanges).toBeDefined()
      expect(result.incompatibleChanges?.length).toBeGreaterThan(0)
    })
  })
})

// ===========================================================================
// VersionedJsonSerializer Tests
// ===========================================================================

describe('VersionedJsonSerializer', () => {
  describe('serialize/deserialize', () => {
    it('should serialize and deserialize state', () => {
      const schema = createUserSchemaV1()
      const serializer = new VersionedJsonSerializer<{ id: string; name: string; age: number }>(
        schema,
        1
      )

      const state = { id: '123', name: 'Alice', age: 30 }
      const serialized = serializer.serialize(state)
      const deserialized = serializer.deserialize(serialized)

      expect(deserialized).toEqual(state)
    })

    it('should include version in serialized data', () => {
      const schema = createUserSchemaV1()
      const serializer = new VersionedJsonSerializer<{ id: string }>(schema, 5)

      const serialized = serializer.serialize({ id: '123' })
      const json = new TextDecoder().decode(serialized)
      const parsed = JSON.parse(json)

      expect(parsed.version).toBe(5)
    })

    it('should include schema ID in serialized data', () => {
      const schema = createUserSchemaV1()
      const serializer = new VersionedJsonSerializer<{ id: string }>(schema, 1)

      const serialized = serializer.serialize({ id: '123' })
      const json = new TextDecoder().decode(serialized)
      const parsed = JSON.parse(json)

      expect(parsed.schemaId).toBe('user-v1')
    })
  })

  describe('migration', () => {
    it('should migrate state from older version', () => {
      interface UserV1 {
        id: string
        name: string
      }

      interface UserV2 {
        id: string
        name: string
        email: string
      }

      const schemaV2 = createUserSchemaV2()
      const migrator: StateMigrator<UserV1, UserV2> = {
        fromVersion: 1,
        toVersion: 2,
        migrate: (state: UserV1): UserV2 => ({
          ...state,
          email: '',
        }),
      }

      const serializer = new VersionedJsonSerializer<UserV2>(schemaV2, 2, [migrator])

      // Create v1 data
      const v1Data = JSON.stringify({
        version: 1,
        schemaId: 'user-v1',
        data: { id: '123', name: 'Alice' },
        timestamp: Date.now(),
      })

      const deserialized = serializer.deserialize(new TextEncoder().encode(v1Data))

      expect(deserialized).toEqual({ id: '123', name: 'Alice', email: '' })
    })

    it('should chain migrators for multi-version migration', () => {
      interface StateV1 {
        value: number
      }

      interface StateV2 {
        value: number
        count: number
      }

      interface StateV3 {
        value: number
        count: number
        label: string
      }

      const schema: Schema = {
        id: 'state',
        version: { major: 3, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [
            { name: 'value', type: 'int', required: true },
            { name: 'count', type: 'int', required: true },
            { name: 'label', type: 'string', required: true, defaultValue: '' },
          ],
        },
        createdAt: Date.now(),
      }

      const migratorV1ToV2: StateMigrator<StateV1, StateV2> = {
        fromVersion: 1,
        toVersion: 2,
        migrate: (state) => ({ ...state, count: 0 }),
      }

      const migratorV2ToV3: StateMigrator<StateV2, StateV3> = {
        fromVersion: 2,
        toVersion: 3,
        migrate: (state) => ({ ...state, label: 'default' }),
      }

      const serializer = new VersionedJsonSerializer<StateV3>(schema, 3, [
        migratorV1ToV2 as StateMigrator<unknown, StateV3>,
        migratorV2ToV3 as StateMigrator<unknown, StateV3>,
      ])

      // Create v1 data
      const v1Data = JSON.stringify({
        version: 1,
        schemaId: 'state-v1',
        data: { value: 42 },
        timestamp: Date.now(),
      })

      const deserialized = serializer.deserialize(new TextEncoder().encode(v1Data))

      expect(deserialized).toEqual({ value: 42, count: 0, label: 'default' })
    })

    it('should throw error when migration path not found', () => {
      const schema = createUserSchemaV2()
      const serializer = new VersionedJsonSerializer<unknown>(schema, 2)

      const v1Data = JSON.stringify({
        version: 1,
        schemaId: 'user-v1',
        data: { id: '123' },
        timestamp: Date.now(),
      })

      expect(() => serializer.deserialize(new TextEncoder().encode(v1Data))).toThrow(
        StateMigrationError
      )
    })
  })

  describe('checkCompatibility', () => {
    it('should check compatibility with another schema', () => {
      const schemaV1 = createUserSchemaV1()
      const schemaV2 = createUserSchemaV2()

      const serializer = new VersionedJsonSerializer<unknown>(schemaV2, 2)
      const result = serializer.checkCompatibility(schemaV1)

      expect(result.result).toBe(CompatibilityResult.COMPATIBLE_WITH_EVOLVING_MIGRATION)
    })
  })

  describe('registerMigrator', () => {
    it('should allow registering migrators after construction', () => {
      interface StateV1 {
        x: number
      }

      interface StateV2 {
        x: number
        y: number
      }

      const schema: Schema = {
        id: 'coords',
        version: { major: 2, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [
            { name: 'x', type: 'int', required: true },
            { name: 'y', type: 'int', required: true },
          ],
        },
        createdAt: Date.now(),
      }

      const serializer = new VersionedJsonSerializer<StateV2>(schema, 2)

      // Initially no migrator
      const v1Data = JSON.stringify({
        version: 1,
        schemaId: 'coords-v1',
        data: { x: 10 },
        timestamp: Date.now(),
      })

      expect(() => serializer.deserialize(new TextEncoder().encode(v1Data))).toThrow()

      // Register migrator
      serializer.registerMigrator({
        fromVersion: 1,
        toVersion: 2,
        migrate: (state) => ({ ...(state as StateV1), y: 0 }),
      })

      // Now it works
      const result = serializer.deserialize(new TextEncoder().encode(v1Data))

      expect(result).toEqual({ x: 10, y: 0 })
    })
  })
})

// ===========================================================================
// StateMigrationManager Tests
// ===========================================================================

describe('StateMigrationManager', () => {
  let manager: StateMigrationManager

  beforeEach(() => {
    manager = new StateMigrationManager()
  })

  describe('registerSerializer', () => {
    it('should register a serializer for a state', () => {
      const schema = createUserSchemaV1()
      const serializer = new VersionedJsonSerializer<unknown>(schema, 1)

      manager.registerSerializer('userState', serializer)

      expect(manager.getSerializer('userState')).toBe(serializer)
    })

    it('should track schema history', () => {
      const schemaV1 = createUserSchemaV1()
      const serializerV1 = new VersionedJsonSerializer<unknown>(schemaV1, 1)

      const schemaV2 = createUserSchemaV2()
      const serializerV2 = new VersionedJsonSerializer<unknown>(schemaV2, 2)

      manager.registerSerializer('userState', serializerV1)
      manager.registerSerializer('userState', serializerV2)

      const history = manager.getSchemaHistory('userState')

      expect(history).toHaveLength(2)
      expect(history[0]?.id).toBe('user-v1')
      expect(history[1]?.id).toBe('user-v2')
    })
  })

  describe('migrateState', () => {
    it('should migrate state successfully', async () => {
      interface UserV1 {
        id: string
      }

      interface UserV2 {
        id: string
        email: string
      }

      const schema = createUserSchemaV2()
      const serializer = new VersionedJsonSerializer<UserV2>(schema, 2, [
        {
          fromVersion: 1,
          toVersion: 2,
          migrate: (state) => ({ ...(state as UserV1), email: '' }),
        },
      ])

      manager.registerSerializer('userState', serializer)

      const v1Data = new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          schemaId: 'user-v1',
          data: { id: '123' },
          timestamp: Date.now(),
        })
      )

      const context: MigrationContext = {
        sourceCheckpointId: 1,
        sourceVersion: 1,
        targetVersion: 2,
        stateName: 'userState',
        operatorId: 'op1',
        failOnValidationError: false,
      }

      const result = await manager.migrateState<UserV2>('userState', v1Data, context)

      expect(result.success).toBe(true)
      expect(result.state).toEqual({ id: '123', email: '' })
    })

    it('should return error for unknown state', async () => {
      const context: MigrationContext = {
        sourceCheckpointId: 1,
        sourceVersion: 1,
        targetVersion: 2,
        stateName: 'unknownState',
        operatorId: 'op1',
        failOnValidationError: false,
      }

      const result = await manager.migrateState('unknownState', new Uint8Array(), context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(MigrationErrorCode.STATE_NOT_FOUND)
    })

    it('should validate migrated state', async () => {
      interface User {
        id: string
        name: string
      }

      const schema: Schema = {
        id: 'user',
        version: { major: 1, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'name', type: 'string', required: true },
          ],
        },
        createdAt: Date.now(),
      }

      const serializer = new VersionedJsonSerializer<User>(schema, 1)
      manager.registerSerializer('userState', serializer)

      const data = serializer.serialize({ id: '123', name: 'Alice' })

      const context: MigrationContext = {
        sourceCheckpointId: 1,
        sourceVersion: 1,
        targetVersion: 1,
        stateName: 'userState',
        operatorId: 'op1',
        failOnValidationError: false,
      }

      const result = await manager.migrateState<User>('userState', data, context)

      expect(result.success).toBe(true)
      expect(result.validationResults).toBeDefined()
      expect(result.validationResults?.every((v) => v.valid)).toBe(true)
    })
  })

  describe('canMigrate', () => {
    it('should return true when migration path exists', () => {
      const schema = createUserSchemaV2()
      const serializer = new VersionedJsonSerializer<unknown>(schema, 2, [
        { fromVersion: 1, toVersion: 2, migrate: (s) => s },
      ])

      manager.registerSerializer('state', serializer)

      expect(manager.canMigrate('state', 1, 2)).toBe(true)
    })

    it('should return false when no migration path', () => {
      const schema = createUserSchemaV2()
      const serializer = new VersionedJsonSerializer<unknown>(schema, 2)

      manager.registerSerializer('state', serializer)

      expect(manager.canMigrate('state', 1, 2)).toBe(false)
    })

    it('should return false for unknown state', () => {
      expect(manager.canMigrate('unknown', 1, 2)).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all serializers and history', () => {
      const schema = createUserSchemaV1()
      const serializer = new VersionedJsonSerializer<unknown>(schema, 1)

      manager.registerSerializer('state', serializer)

      expect(manager.getSerializer('state')).toBeDefined()

      manager.clear()

      expect(manager.getSerializer('state')).toBeUndefined()
      expect(manager.getSchemaHistory('state')).toHaveLength(0)
    })
  })
})

// ===========================================================================
// CheckpointMigrator Tests
// ===========================================================================

describe('CheckpointMigrator', () => {
  let manager: StateMigrationManager
  let checkpointMigrator: CheckpointMigrator

  beforeEach(() => {
    manager = new StateMigrationManager()
    checkpointMigrator = new CheckpointMigrator(manager)
  })

  describe('migrateCheckpoint', () => {
    it('should migrate all states in a checkpoint', async () => {
      interface StateV1 {
        value: number
      }

      interface StateV2 {
        value: number
        label: string
      }

      const schema: Schema = {
        id: 'state',
        version: { major: 2, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [
            { name: 'value', type: 'int', required: true },
            { name: 'label', type: 'string', required: true, defaultValue: '' },
          ],
        },
        createdAt: Date.now(),
      }

      const serializer = new VersionedJsonSerializer<StateV2>(schema, 2, [
        {
          fromVersion: 1,
          toVersion: 2,
          migrate: (state) => ({ ...(state as StateV1), label: 'migrated' }),
        },
      ])

      manager.registerSerializer('counter', serializer)

      const v1Data = new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          schemaId: 'state-v1',
          data: { value: 42 },
          timestamp: Date.now(),
        })
      )

      const states = new Map<string, { data: Uint8Array; version: number }>()
      states.set('counter', { data: v1Data, version: 1 })

      const result = await checkpointMigrator.migrateCheckpoint(1, 2, states)

      expect(result.success).toBe(true)
      expect(result.statesMigrated).toBe(1)
      expect(result.statesSkipped).toBe(0)
      expect(result.statesFailed).toBe(0)
    })

    it('should skip states with matching versions', async () => {
      const schema = createUserSchemaV1()
      const serializer = new VersionedJsonSerializer<unknown>(schema, 1)

      manager.registerSerializer('state', serializer)

      const data = serializer.serialize({ id: '123', name: 'Alice', age: 30 })
      const states = new Map<string, { data: Uint8Array; version: number }>()
      states.set('state', { data, version: 1 })

      const result = await checkpointMigrator.migrateCheckpoint(1, 2, states)

      expect(result.statesSkipped).toBe(1)
      expect(result.statesMigrated).toBe(0)
    })

    it('should skip states without serializers', async () => {
      const states = new Map<string, { data: Uint8Array; version: number }>()
      states.set('unknownState', { data: new Uint8Array(), version: 1 })

      const result = await checkpointMigrator.migrateCheckpoint(1, 2, states)

      expect(result.statesSkipped).toBe(1)
    })

    it('should handle partial migration with allowPartialMigration', async () => {
      const goodSchema: Schema = {
        id: 'good',
        version: { major: 2, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [{ name: 'value', type: 'int', required: true }],
        },
        createdAt: Date.now(),
      }

      const goodSerializer = new VersionedJsonSerializer<unknown>(goodSchema, 2, [
        { fromVersion: 1, toVersion: 2, migrate: (s) => s },
      ])

      const badSchema: Schema = {
        id: 'bad',
        version: { major: 2, minor: 0, patch: 0 },
        definition: {
          type: 'object',
          fields: [{ name: 'value', type: 'int', required: true }],
        },
        createdAt: Date.now(),
      }

      // No migrator registered
      const badSerializer = new VersionedJsonSerializer<unknown>(badSchema, 2)

      manager.registerSerializer('goodState', goodSerializer)
      manager.registerSerializer('badState', badSerializer)

      const goodData = new TextEncoder().encode(
        JSON.stringify({ version: 1, schemaId: 'good-v1', data: { value: 1 }, timestamp: Date.now() })
      )

      const badData = new TextEncoder().encode(
        JSON.stringify({ version: 1, schemaId: 'bad-v1', data: { value: 2 }, timestamp: Date.now() })
      )

      const states = new Map<string, { data: Uint8Array; version: number }>()
      states.set('goodState', { data: goodData, version: 1 })
      states.set('badState', { data: badData, version: 1 })

      const result = await checkpointMigrator.migrateCheckpoint(1, 2, states, {
        allowPartialMigration: true,
      })

      expect(result.success).toBe(true)
      expect(result.statesMigrated).toBe(1)
      expect(result.statesFailed).toBe(1)
    })

    it('should fail fast without allowPartialMigration', async () => {
      const schema: Schema = {
        id: 'state',
        version: { major: 2, minor: 0, patch: 0 },
        definition: { type: 'object', fields: [] },
        createdAt: Date.now(),
      }

      // No migrator
      const serializer = new VersionedJsonSerializer<unknown>(schema, 2)
      manager.registerSerializer('state', serializer)

      const data = new TextEncoder().encode(
        JSON.stringify({ version: 1, schemaId: 'state-v1', data: {}, timestamp: Date.now() })
      )

      const states = new Map<string, { data: Uint8Array; version: number }>()
      states.set('state', { data, version: 1 })

      const result = await checkpointMigrator.migrateCheckpoint(1, 2, states, {
        allowPartialMigration: false,
      })

      expect(result.success).toBe(false)
    })

    it('should support dry run mode', async () => {
      const schema: Schema = {
        id: 'state',
        version: { major: 2, minor: 0, patch: 0 },
        definition: { type: 'object', fields: [] },
        createdAt: Date.now(),
      }

      const serializer = new VersionedJsonSerializer<unknown>(schema, 2, [
        { fromVersion: 1, toVersion: 2, migrate: (s) => s },
      ])

      manager.registerSerializer('state', serializer)

      const states = new Map<string, { data: Uint8Array; version: number }>()
      states.set('state', { data: new Uint8Array(), version: 1 })

      const result = await checkpointMigrator.migrateCheckpoint(1, 2, states, {
        dryRun: true,
      })

      expect(result.statesMigrated).toBe(1)
      // In dry run, we just check if migration is possible
    })
  })

  describe('validateMigration', () => {
    it('should validate migration possibilities for states', () => {
      const schema: Schema = {
        id: 'state',
        version: { major: 2, minor: 0, patch: 0 },
        definition: { type: 'object', fields: [] },
        createdAt: Date.now(),
      }

      const serializer = new VersionedJsonSerializer<unknown>(schema, 2, [
        { fromVersion: 1, toVersion: 2, migrate: (s) => s },
      ])

      manager.registerSerializer('state', serializer)

      const states = new Map<string, { version: number }>()
      states.set('state', { version: 1 })

      const results = checkpointMigrator.validateMigration(states)

      expect(results.get('state')?.result).toBe(
        CompatibilityResult.COMPATIBLE_WITH_MIGRATION
      )
    })

    it('should report COMPATIBLE for matching versions', () => {
      const schema: Schema = {
        id: 'state',
        version: { major: 1, minor: 0, patch: 0 },
        definition: { type: 'object', fields: [] },
        createdAt: Date.now(),
      }

      const serializer = new VersionedJsonSerializer<unknown>(schema, 1)
      manager.registerSerializer('state', serializer)

      const states = new Map<string, { version: number }>()
      states.set('state', { version: 1 })

      const results = checkpointMigrator.validateMigration(states)

      expect(results.get('state')?.result).toBe(CompatibilityResult.COMPATIBLE)
      expect(results.get('state')?.requiresMigration).toBe(false)
    })

    it('should report INCOMPATIBLE for missing migration path', () => {
      const schema: Schema = {
        id: 'state',
        version: { major: 3, minor: 0, patch: 0 },
        definition: { type: 'object', fields: [] },
        createdAt: Date.now(),
      }

      // No migrator from v1 to v3
      const serializer = new VersionedJsonSerializer<unknown>(schema, 3)
      manager.registerSerializer('state', serializer)

      const states = new Map<string, { version: number }>()
      states.set('state', { version: 1 })

      const results = checkpointMigrator.validateMigration(states)

      expect(results.get('state')?.result).toBe(CompatibilityResult.INCOMPATIBLE)
    })
  })
})

// ===========================================================================
// BackwardCompatibleState Tests
// ===========================================================================

describe('BackwardCompatibleState', () => {
  describe('get', () => {
    it('should return existing field value', () => {
      const data = { id: '123', name: 'Alice' }
      const state = new BackwardCompatibleState(data, 1)

      expect(state.get('id')).toBe('123')
      expect(state.get('name')).toBe('Alice')
    })

    it('should return default for missing field', () => {
      const data = { id: '123' }
      const defaults = { name: 'Unknown', age: 0 }
      const state = new BackwardCompatibleState(data, 1, defaults)

      expect(state.get('name')).toBe('Unknown')
      expect(state.get('age')).toBe(0)
    })

    it('should return undefined for missing field without default', () => {
      const data = { id: '123' }
      const state = new BackwardCompatibleState<{ id: string; name?: string }>(data, 1)

      expect(state.get('name')).toBeUndefined()
    })
  })

  describe('getData', () => {
    it('should merge data with defaults', () => {
      const data = { id: '123' }
      const defaults = { name: 'Unknown', email: '' }
      const state = new BackwardCompatibleState(data, 1, defaults)

      expect(state.getData()).toEqual({
        id: '123',
        name: 'Unknown',
        email: '',
      })
    })

    it('should prefer data over defaults', () => {
      const data = { id: '123', name: 'Alice' }
      const defaults = { name: 'Unknown' }
      const state = new BackwardCompatibleState(data, 1, defaults)

      expect(state.getData()).toEqual({ id: '123', name: 'Alice' })
    })
  })

  describe('hasField', () => {
    it('should return true for existing field', () => {
      const data = { id: '123', name: 'Alice' }
      const state = new BackwardCompatibleState(data, 1)

      expect(state.hasField('id')).toBe(true)
      expect(state.hasField('name')).toBe(true)
    })

    it('should return false for missing field', () => {
      const data = { id: '123' }
      const defaults = { name: 'Unknown' }
      const state = new BackwardCompatibleState<{ id: string; name?: string }>(data, 1, defaults)

      expect(state.hasField('name')).toBe(false)
    })
  })

  describe('getVersion', () => {
    it('should return the version', () => {
      const state = new BackwardCompatibleState({ id: '123' }, 5)

      expect(state.getVersion()).toBe(5)
    })
  })
})

// ===========================================================================
// StateMigrationError Tests
// ===========================================================================

describe('StateMigrationError', () => {
  it('should create error with all properties', () => {
    const cause = new Error('Original error')
    const error = new StateMigrationError(
      'Migration failed',
      MigrationErrorCode.MIGRATION_STEP_FAILED,
      'userState',
      1,
      2,
      cause
    )

    expect(error.message).toBe('Migration failed')
    expect(error.code).toBe(MigrationErrorCode.MIGRATION_STEP_FAILED)
    expect(error.stateName).toBe('userState')
    expect(error.sourceVersion).toBe(1)
    expect(error.targetVersion).toBe(2)
    expect(error.cause).toBe(cause)
    expect(error.name).toBe('StateMigrationError')
  })

  it('should have correct error name', () => {
    const error = new StateMigrationError(
      'Test error',
      MigrationErrorCode.SCHEMA_INCOMPATIBLE
    )

    expect(error.name).toBe('StateMigrationError')
    expect(error instanceof Error).toBe(true)
  })
})

// ===========================================================================
// Integration Tests
// ===========================================================================

describe('State Migration Integration', () => {
  it('should handle complete migration workflow', async () => {
    // Version 1 schema and data
    interface UserV1 {
      id: string
      name: string
    }

    // Version 2 schema and data (added email)
    interface UserV2 {
      id: string
      name: string
      email: string
    }

    // Version 3 schema and data (added age, removed name -> fullName)
    interface UserV3 {
      id: string
      fullName: string
      email: string
      age: number
    }

    const schemaV3: Schema = {
      id: 'user-v3',
      version: { major: 3, minor: 0, patch: 0 },
      definition: {
        type: 'object',
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'fullName', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
          { name: 'age', type: 'int', required: true, defaultValue: 0 },
        ],
      },
      createdAt: Date.now(),
    }

    const migratorV1ToV2: StateMigrator<UserV1, UserV2> = {
      fromVersion: 1,
      toVersion: 2,
      migrate: (state: UserV1): UserV2 => ({
        ...state,
        email: '',
      }),
    }

    const migratorV2ToV3: StateMigrator<UserV2, UserV3> = {
      fromVersion: 2,
      toVersion: 3,
      migrate: (state: UserV2): UserV3 => ({
        id: state.id,
        fullName: state.name,
        email: state.email,
        age: 0,
      }),
    }

    const serializer = new VersionedJsonSerializer<UserV3>(schemaV3, 3, [
      migratorV1ToV2 as StateMigrator<unknown, UserV3>,
      migratorV2ToV3 as StateMigrator<unknown, UserV3>,
    ])

    const manager = new StateMigrationManager()
    manager.registerSerializer('user', serializer)

    // Simulate checkpoint with v1 data
    const v1Data = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        schemaId: 'user-v1',
        data: { id: 'user-001', name: 'Alice' },
        timestamp: Date.now(),
      })
    )

    const checkpointMigrator = new CheckpointMigrator(manager)
    const states = new Map<string, { data: Uint8Array; version: number }>()
    states.set('user', { data: v1Data, version: 1 })

    const result = await checkpointMigrator.migrateCheckpoint(100, 101, states)

    expect(result.success).toBe(true)
    expect(result.statesMigrated).toBe(1)

    const userResult = result.stateResults.get('user')
    expect(userResult?.success).toBe(true)
    expect(userResult?.state).toEqual({
      id: 'user-001',
      fullName: 'Alice',
      email: '',
      age: 0,
    })
  })

  it('should validate migration possibilities before migration', () => {
    interface StateV1 {
      count: number
    }

    interface StateV2 {
      count: number
      label: string
    }

    const schemaV2: Schema = {
      id: 'counter-v2',
      version: { major: 2, minor: 0, patch: 0 },
      definition: {
        type: 'object',
        fields: [
          { name: 'count', type: 'int', required: true },
          { name: 'label', type: 'string', required: true, defaultValue: '' },
        ],
      },
      createdAt: Date.now(),
    }

    const serializer = new VersionedJsonSerializer<StateV2>(schemaV2, 2, [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate: (state) => ({ ...(state as StateV1), label: '' }),
      },
    ])

    const manager = new StateMigrationManager()
    manager.registerSerializer('counter', serializer)

    const checkpointMigrator = new CheckpointMigrator(manager)

    // Validate before migration
    const states = new Map<string, { version: number }>()
    states.set('counter', { version: 1 })
    states.set('unknownState', { version: 1 })

    const validationResults = checkpointMigrator.validateMigration(states)

    expect(validationResults.get('counter')?.result).toBe(
      CompatibilityResult.COMPATIBLE_WITH_MIGRATION
    )
    expect(validationResults.get('unknownState')?.result).toBe(
      CompatibilityResult.INCOMPATIBLE
    )
  })
})
