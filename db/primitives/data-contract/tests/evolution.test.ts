/**
 * SchemaEvolution tests - Schema evolution and compatibility checking
 *
 * Tests for:
 * - Backward compatibility checking
 * - Forward compatibility checking
 * - Full compatibility mode
 * - Breaking change detection
 * - Migration path suggestions
 * - Data migration
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SchemaEvolution,
  createSchemaEvolution,
  isBackwardCompatible,
  isForwardCompatible,
  isFullyCompatible,
  detectBreakingChanges,
  suggestMigration,
  DEFAULT_POLICIES,
  createSchema,
  formatSchemaDiff,
  type DataContract,
  type CompatibilityMode,
  type EvolutionPolicy,
} from '../index'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createTestContract(
  name: string,
  version: string,
  properties: Record<string, { type: string; default?: unknown; format?: string }>,
  required: string[] = []
): DataContract {
  return createSchema({
    name,
    version,
    schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          { type: value.type as any, default: value.default, format: value.format },
        ])
      ),
      required,
    },
  })
}

// ============================================================================
// COMPATIBILITY MODE TESTS
// ============================================================================

describe('SchemaEvolution', () => {
  describe('compatibility modes', () => {
    it('should have all compatibility modes defined', () => {
      expect(DEFAULT_POLICIES.backward).toBeDefined()
      expect(DEFAULT_POLICIES.forward).toBeDefined()
      expect(DEFAULT_POLICIES.full).toBeDefined()
      expect(DEFAULT_POLICIES.none).toBeDefined()
    })

    it('should create evolution with backward mode by default', () => {
      const evolution = createSchemaEvolution()
      const policy = evolution.getPolicy()
      expect(policy.mode).toBe('backward')
    })

    it('should create evolution with specified mode', () => {
      const modes: CompatibilityMode[] = ['backward', 'forward', 'full', 'none']

      for (const mode of modes) {
        const evolution = createSchemaEvolution(mode)
        expect(evolution.getPolicy().mode).toBe(mode)
      }
    })

    it('should create evolution with custom policy', () => {
      const customPolicy: EvolutionPolicy = {
        mode: 'backward',
        allowFieldRemoval: false,
        allowTypeNarrowing: true,
        requireDefaults: false,
      }

      const evolution = createSchemaEvolution(customPolicy)
      const policy = evolution.getPolicy()

      expect(policy.mode).toBe('backward')
      expect(policy.allowFieldRemoval).toBe(false)
      expect(policy.allowTypeNarrowing).toBe(true)
      expect(policy.requireDefaults).toBe(false)
    })

    it('should allow changing policy', () => {
      const evolution = createSchemaEvolution('backward')
      expect(evolution.getPolicy().mode).toBe('backward')

      evolution.setPolicy('forward')
      expect(evolution.getPolicy().mode).toBe('forward')

      evolution.setPolicy({ mode: 'full', allowFieldRemoval: true, allowTypeNarrowing: false, requireDefaults: true })
      expect(evolution.getPolicy().mode).toBe('full')
      expect(evolution.getPolicy().allowFieldRemoval).toBe(true)
    })
  })

  // ============================================================================
  // BACKWARD COMPATIBILITY TESTS
  // ============================================================================

  describe('backward compatibility', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('backward')
    })

    it('should allow adding optional fields', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' }, email: { type: 'string' } }, [
        'id',
        'email',
      ])

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' }, // new optional field
        },
        ['id', 'email']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
      expect(result.breakingChanges).toHaveLength(0)
    })

    it('should block adding required fields without defaults', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' }, // new required field without default
        },
        ['id', 'email']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
      expect(result.breakingChanges.length).toBeGreaterThan(0)
      expect(result.breakingChanges.some((c) => c.includes('email') && c.includes('required'))).toBe(true)
    })

    it('should allow adding required fields with defaults', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          email: { type: 'string', default: 'unknown@example.com' }, // new required field WITH default
        },
        ['id', 'email']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
    })

    it('should allow removing optional fields in backward mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          nickname: { type: 'string' }, // optional
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          // nickname removed
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
      expect(result.warnings.some((w) => w.includes('nickname') && w.includes('removed'))).toBe(true)
    })

    it('should block removing required fields', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id', 'email']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          // email removed
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('email') && c.includes('removed'))).toBe(true)
    })

    it('should allow widening types (integer -> number)', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          age: { type: 'integer' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          age: { type: 'number' }, // widened from integer
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
      expect(result.warnings.some((w) => w.includes('age') && w.includes('widened'))).toBe(true)
    })

    it('should block narrowing types (number -> integer)', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          score: { type: 'number' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          score: { type: 'integer' }, // narrowed from number
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('score') && c.includes('narrowed'))).toBe(true)
    })
  })

  // ============================================================================
  // FORWARD COMPATIBILITY TESTS
  // ============================================================================

  describe('forward compatibility', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('forward')
    })

    it('should block removing fields in forward mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          nickname: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          // nickname removed
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
      expect(result.violations.some((v) => v.field === 'nickname' && v.rule === 'no_field_removal')).toBe(true)
    })

    it('should allow narrowing types in forward mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          score: { type: 'number' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          score: { type: 'integer' }, // narrowed
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
    })

    it('should allow adding new fields in forward mode', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id', 'email'] // can add required without default in forward mode
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
    })
  })

  // ============================================================================
  // FULL COMPATIBILITY TESTS
  // ============================================================================

  describe('full compatibility', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('full')
    })

    it('should only allow safe changes in full mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '1.1.0',
        {
          id: { type: 'string' },
          name: { type: 'string' },
          bio: { type: 'string' }, // new optional field
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(true)
    })

    it('should block removing fields in full mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          nickname: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
    })

    it('should block narrowing types in full mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          score: { type: 'number' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          score: { type: 'integer' },
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
    })

    it('should block adding required fields without defaults', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id', 'email']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
    })
  })

  // ============================================================================
  // NONE MODE TESTS
  // ============================================================================

  describe('none compatibility mode', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('none')
    })

    it('should allow any changes in none mode', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
          age: { type: 'number' },
        },
        ['id', 'email']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          userId: { type: 'integer' }, // renamed and type changed
          // email removed
          score: { type: 'string' }, // completely different
        },
        ['userId', 'score']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      // In none mode, everything is allowed (but violations still tracked)
      expect(result.allowed).toBe(true)
    })
  })

  // ============================================================================
  // BREAKING CHANGE DETECTION TESTS
  // ============================================================================

  describe('breaking change detection', () => {
    it('should detect multiple breaking changes', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
          age: { type: 'number' },
        },
        ['id', 'email']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'integer' }, // type changed
          // email removed (breaking)
          age: { type: 'integer' }, // narrowed
          phone: { type: 'string' }, // new required without default
        },
        ['id', 'age', 'phone']
      )

      const breaking = detectBreakingChanges(oldSchema, newSchema)

      expect(breaking.length).toBeGreaterThanOrEqual(3)
      expect(breaking.some((c) => c.includes('email'))).toBe(true)
      expect(breaking.some((c) => c.includes('id'))).toBe(true)
    })

    it('should detect making optional field required as breaking', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          nickname: { type: 'string' }, // optional
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          nickname: { type: 'string' }, // now required
        },
        ['id', 'nickname']
      )

      const breaking = detectBreakingChanges(oldSchema, newSchema)

      expect(breaking.some((c) => c.includes('nickname') && c.includes('required'))).toBe(true)
    })
  })

  // ============================================================================
  // MIGRATION SUGGESTION TESTS
  // ============================================================================

  describe('migration suggestions', () => {
    it('should suggest adding default for new required field', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id', 'email']
      )

      const suggestions = suggestMigration(oldSchema, newSchema)

      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions.some((s) => s.suggestion.includes('email') && s.suggestion.includes('default'))).toBe(true)
    })

    it('should suggest making field optional before removing', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id', 'email']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
        },
        ['id']
      )

      const suggestions = suggestMigration(oldSchema, newSchema)

      expect(suggestions.some((s) => s.suggestion.includes('email') && s.suggestion.includes('optional'))).toBe(true)
    })
  })

  // ============================================================================
  // DATA MIGRATION TESTS
  // ============================================================================

  describe('data migration', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('none') // Use none to allow all changes for testing
    })

    it('should add new fields with default values', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          active: { type: 'boolean' },
          count: { type: 'number' },
        },
        ['id']
      )

      const data = { id: 'user-123' }
      const migrated = evolution.migrate(data, oldSchema, newSchema) as Record<string, unknown>

      expect(migrated.id).toBe('user-123')
      expect(migrated.active).toBe(false)
      expect(migrated.count).toBe(0)
    })

    it('should remove fields during migration', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          deprecated: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
        },
        ['id']
      )

      const data = { id: 'user-123', deprecated: 'old value' }
      const migrated = evolution.migrate(data, oldSchema, newSchema) as Record<string, unknown>

      expect(migrated.id).toBe('user-123')
      expect('deprecated' in migrated).toBe(false)
    })

    it('should coerce types during migration', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          count: { type: 'integer' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          count: { type: 'string' }, // changed to string
        },
        ['id']
      )

      const data = { id: 'user-123', count: 42 }
      const migrated = evolution.migrate(data, oldSchema, newSchema) as Record<string, unknown>

      expect(migrated.id).toBe('user-123')
      expect(migrated.count).toBe('42')
    })

    it('should handle null/undefined data gracefully', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])
      const newSchema = createTestContract('user', '2.0.0', { id: { type: 'string' } }, ['id'])

      expect(evolution.migrate(null, oldSchema, newSchema)).toBe(null)
      expect(evolution.migrate(undefined, oldSchema, newSchema)).toBe(undefined)
    })
  })

  // ============================================================================
  // MIGRATION SCRIPT GENERATION TESTS
  // ============================================================================

  describe('migration script generation', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('none')
    })

    it('should generate migration script with correct versions', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema)

      expect(script.fromVersion).toBe('1.0.0')
      expect(script.toVersion).toBe('2.0.0')
    })

    it('should include add operations for new fields', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
          count: { type: 'number' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema)

      expect(script.operations.filter((op) => op.type === 'add')).toHaveLength(2)
      expect(script.operations.some((op) => op.type === 'add' && op.field === 'email')).toBe(true)
      expect(script.operations.some((op) => op.type === 'add' && op.field === 'count')).toBe(true)
    })

    it('should include remove operations for deleted fields', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          deprecated: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema)

      expect(script.operations.some((op) => op.type === 'remove' && op.field === 'deprecated')).toBe(true)
    })

    it('should mark non-reversible migrations', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          data: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          // data removed - not reversible
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema)

      expect(script.isReversible).toBe(false)
    })
  })

  // ============================================================================
  // HELPER FUNCTION TESTS
  // ============================================================================

  describe('helper functions', () => {
    const oldSchema = createTestContract(
      'user',
      '1.0.0',
      {
        id: { type: 'string' },
        name: { type: 'string' },
      },
      ['id']
    )

    const compatibleSchema = createTestContract(
      'user',
      '1.1.0',
      {
        id: { type: 'string' },
        name: { type: 'string' },
        bio: { type: 'string' }, // optional addition
      },
      ['id']
    )

    const incompatibleSchema = createTestContract(
      'user',
      '2.0.0',
      {
        id: { type: 'integer' }, // type change
      },
      ['id']
    )

    it('isBackwardCompatible should check backward compatibility', () => {
      expect(isBackwardCompatible(oldSchema, compatibleSchema)).toBe(true)
      expect(isBackwardCompatible(oldSchema, incompatibleSchema)).toBe(false)
    })

    it('isForwardCompatible should check forward compatibility', () => {
      expect(isForwardCompatible(oldSchema, compatibleSchema)).toBe(true)
    })

    it('isFullyCompatible should check both directions', () => {
      expect(isFullyCompatible(oldSchema, compatibleSchema)).toBe(true)
      expect(isFullyCompatible(oldSchema, incompatibleSchema)).toBe(false)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('backward')
    })

    it('should handle empty schemas', () => {
      const emptyOld = createSchema({
        name: 'empty',
        version: '1.0.0',
        schema: { type: 'object' },
      })

      const emptyNew = createSchema({
        name: 'empty',
        version: '1.1.0',
        schema: { type: 'object' },
      })

      const result = evolution.checkCompatibility(emptyOld, emptyNew)
      expect(result.allowed).toBe(true)
    })

    it('should handle schemas with only optional fields', () => {
      const allOptional = createTestContract(
        'config',
        '1.0.0',
        {
          setting1: { type: 'string' },
          setting2: { type: 'number' },
        },
        [] // no required fields
      )

      const lessFields = createTestContract(
        'config',
        '1.1.0',
        {
          setting1: { type: 'string' },
        },
        []
      )

      const result = evolution.checkCompatibility(allOptional, lessFields)
      expect(result.allowed).toBe(true)
    })

    it('should handle complex type changes', () => {
      const oldSchema = createTestContract(
        'data',
        '1.0.0',
        {
          id: { type: 'string' },
          value: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'data',
        '2.0.0',
        {
          id: { type: 'string' },
          value: { type: 'boolean' }, // incompatible change
        },
        ['id']
      )

      const result = evolution.checkCompatibility(oldSchema, newSchema)

      expect(result.allowed).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('value'))).toBe(true)
    })
  })

  // ============================================================================
  // SCHEMA DIFF VISUALIZATION TESTS
  // ============================================================================

  describe('schema diff visualization', () => {
    it('should format added fields with + prefix', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        ['id']
      )

      const evolution = createSchemaEvolution('none')
      const result = evolution.checkCompatibility(oldSchema, newSchema)
      const formatted = formatSchemaDiff(result)

      expect(formatted).toContain('+ email')
      expect(formatted).toContain('+ phone')
    })

    it('should format removed fields with - prefix', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          deprecated: { type: 'string' },
          oldField: { type: 'number' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
        },
        ['id']
      )

      const evolution = createSchemaEvolution('none')
      const result = evolution.checkCompatibility(oldSchema, newSchema)
      const formatted = formatSchemaDiff(result)

      expect(formatted).toContain('- deprecated')
      expect(formatted).toContain('- oldField')
    })

    it('should format type changes with ~ prefix', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          score: { type: 'number' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          score: { type: 'string' },
        },
        ['id']
      )

      const evolution = createSchemaEvolution('none')
      const result = evolution.checkCompatibility(oldSchema, newSchema)
      const formatted = formatSchemaDiff(result)

      expect(formatted).toContain('~ score')
      expect(formatted).toContain('number')
      expect(formatted).toContain('string')
    })

    it('should show summary statistics', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          name: { type: 'string' },
          age: { type: 'number' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
          age: { type: 'string' },
        },
        ['id']
      )

      const evolution = createSchemaEvolution('none')
      const result = evolution.checkCompatibility(oldSchema, newSchema)
      const formatted = formatSchemaDiff(result)

      // Should show counts
      expect(formatted).toMatch(/added.*1/i)
      expect(formatted).toMatch(/removed.*1/i)
      expect(formatted).toMatch(/changed.*1/i)
    })

    it('should show breaking changes clearly', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        ['id', 'email']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
        },
        ['id']
      )

      const evolution = createSchemaEvolution('backward')
      const result = evolution.checkCompatibility(oldSchema, newSchema)
      const formatted = formatSchemaDiff(result)

      expect(formatted).toMatch(/breaking/i)
      expect(formatted).toContain('email')
    })

    it('should handle empty diff gracefully', () => {
      const schema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const evolution = createSchemaEvolution('backward')
      const result = evolution.checkCompatibility(schema, schema)
      const formatted = formatSchemaDiff(result)

      expect(formatted).toMatch(/no changes/i)
    })
  })

  // ============================================================================
  // FIELD RENAME DETECTION TESTS
  // ============================================================================

  describe('field rename detection', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('none')
    })

    it('should detect simple field renames with same type', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          userName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          username: { type: 'string' }, // renamed from userName
        },
        ['id']
      )

      const renames = evolution.detectRenames(oldSchema, newSchema)

      expect(renames.length).toBe(1)
      expect(renames[0]!.fromField).toBe('userName')
      expect(renames[0]!.toField).toBe('username')
      expect(renames[0]!.confidence).toBeGreaterThan(0.8)
    })

    it('should detect camelCase to snake_case renames', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          firstName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          first_name: { type: 'string' },
        },
        ['id']
      )

      const renames = evolution.detectRenames(oldSchema, newSchema)

      expect(renames.length).toBe(1)
      expect(renames[0]!.fromField).toBe('firstName')
      expect(renames[0]!.toField).toBe('first_name')
    })

    it('should detect userId to user_id renames', () => {
      const oldSchema = createTestContract(
        'order',
        '1.0.0',
        {
          id: { type: 'string' },
          userId: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'order',
        '2.0.0',
        {
          id: { type: 'string' },
          user_id: { type: 'string' },
        },
        ['id']
      )

      const renames = evolution.detectRenames(oldSchema, newSchema)

      expect(renames.length).toBe(1)
      expect(renames[0]!.fromField).toBe('userId')
      expect(renames[0]!.toField).toBe('user_id')
    })

    it('should not detect renames for incompatible types', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          count: { type: 'integer' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          counts: { type: 'boolean' }, // different type
        },
        ['id']
      )

      const renames = evolution.detectRenames(oldSchema, newSchema)

      expect(renames.length).toBe(0)
    })

    it('should prefer exact normalized name matches', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          isActive: { type: 'boolean' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          active: { type: 'boolean' },
        },
        ['id']
      )

      const renames = evolution.detectRenames(oldSchema, newSchema)

      expect(renames.length).toBe(1)
      expect(renames[0]!.fromField).toBe('isActive')
      expect(renames[0]!.toField).toBe('active')
    })
  })

  // ============================================================================
  // MIGRATION WITH RENAME DETECTION TESTS
  // ============================================================================

  describe('migration with rename detection', () => {
    let evolution: SchemaEvolution

    beforeEach(() => {
      evolution = createSchemaEvolution('none')
    })

    it('should generate rename operations when renames are detected', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          userName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          username: { type: 'string' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema)

      const renameOps = script.operations.filter((op) => op.type === 'rename')
      expect(renameOps.length).toBe(1)
      expect(renameOps[0]!.fromField).toBe('userName')
      expect(renameOps[0]!.toField).toBe('username')
    })

    it('should migrate data with detected renames', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          userName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          username: { type: 'string' },
        },
        ['id']
      )

      const data = { id: 'user-123', userName: 'johndoe' }
      const migrated = evolution.migrate(data, oldSchema, newSchema) as Record<string, unknown>

      expect(migrated.username).toBe('johndoe')
      expect('userName' in migrated).toBe(false)
    })

    it('should use explicit field mappings when provided', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          oldField: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          newField: { type: 'string' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema, {
        fieldMappings: { oldField: 'newField' },
      })

      const renameOps = script.operations.filter((op) => op.type === 'rename')
      expect(renameOps.length).toBe(1)
      expect(renameOps[0]!.fromField).toBe('oldField')
      expect(renameOps[0]!.toField).toBe('newField')
    })

    it('should disable rename detection when detectRenames is false', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          userName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          username: { type: 'string' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema, {
        detectRenames: false,
      })

      const renameOps = script.operations.filter((op) => op.type === 'rename')
      expect(renameOps.length).toBe(0)

      // Should have add and remove instead
      const addOps = script.operations.filter((op) => op.type === 'add')
      const removeOps = script.operations.filter((op) => op.type === 'remove')
      expect(addOps.length).toBe(1)
      expect(removeOps.length).toBe(1)
    })

    it('should use custom defaults for new fields', () => {
      const oldSchema = createTestContract('user', '1.0.0', { id: { type: 'string' } }, ['id'])

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          status: { type: 'string' },
        },
        ['id']
      )

      const data = { id: 'user-123' }
      const migrated = evolution.migrate(data, oldSchema, newSchema, {
        customDefaults: { status: 'active' },
      }) as Record<string, unknown>

      expect(migrated.status).toBe('active')
    })

    it('should mark renames as reversible', () => {
      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          userName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          username: { type: 'string' },
        },
        ['id']
      )

      const script = evolution.generateMigration(oldSchema, newSchema)

      expect(script.isReversible).toBe(true)
      expect(script.reverseOperations).toBeDefined()
      expect(script.reverseOperations!.length).toBe(1)
      expect(script.reverseOperations![0]!.type).toBe('rename')
      expect(script.reverseOperations![0]!.fromField).toBe('username')
      expect(script.reverseOperations![0]!.toField).toBe('userName')
    })
  })

  // ============================================================================
  // HELPER FUNCTION TESTS (NEW)
  // ============================================================================

  describe('new helper functions', () => {
    it('detectPotentialRenames should detect field renames', async () => {
      const { detectPotentialRenames } = await import('../index')

      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          firstName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          first_name: { type: 'string' },
        },
        ['id']
      )

      const renames = detectPotentialRenames(oldSchema, newSchema)

      expect(renames.length).toBe(1)
      expect(renames[0]!.fromField).toBe('firstName')
      expect(renames[0]!.toField).toBe('first_name')
    })

    it('createMigrationScript should create migration with options', async () => {
      const { createMigrationScript } = await import('../index')

      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          oldName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          newName: { type: 'string' },
        },
        ['id']
      )

      const script = createMigrationScript(oldSchema, newSchema, {
        fieldMappings: { oldName: 'newName' },
      })

      expect(script.operations.some((op) => op.type === 'rename')).toBe(true)
    })

    it('migrateData should migrate data with options', async () => {
      const { migrateData } = await import('../index')

      const oldSchema = createTestContract(
        'user',
        '1.0.0',
        {
          id: { type: 'string' },
          userName: { type: 'string' },
        },
        ['id']
      )

      const newSchema = createTestContract(
        'user',
        '2.0.0',
        {
          id: { type: 'string' },
          username: { type: 'string' },
          status: { type: 'string' },
        },
        ['id']
      )

      const data = { id: 'user-123', userName: 'johndoe' }
      const migrated = migrateData(data, oldSchema, newSchema, {
        customDefaults: { status: 'active' },
      }) as Record<string, unknown>

      expect(migrated.username).toBe('johndoe')
      expect(migrated.status).toBe('active')
      expect('userName' in migrated).toBe(false)
    })
  })
})
