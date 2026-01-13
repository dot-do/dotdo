/**
 * Versioning tests - Semantic Version Management for DataContract
 *
 * Tests cover:
 * - Semver parsing and comparison
 * - Version bumping
 * - Version range matching
 * - Schema change analysis
 * - Version bump suggestions
 * - VersionedContract class
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseSemVer,
  formatSemVer,
  compareSemVer,
  isValidSemVer,
  bumpVersion,
  bumpPrerelease,
  parseVersionRange,
  satisfies,
  maxSatisfying,
  minSatisfying,
  analyzeSchemaChanges,
  suggestVersionBump,
  analyzeCompatibility,
  generateSchemaChecksum,
  VersionedContract,
  createVersionedContract,
  type SemVer,
  type SchemaChange,
  type BumpType,
} from './versioning'
import type { JSONSchema } from './index'

// ============================================================================
// SEMVER PARSING
// ============================================================================

describe('Semantic Version Parsing', () => {
  describe('parseSemVer', () => {
    it('should parse basic semver strings', () => {
      expect(parseSemVer('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 })
      expect(parseSemVer('2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 })
      expect(parseSemVer('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 })
      expect(parseSemVer('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 })
    })

    it('should parse semver with prerelease', () => {
      expect(parseSemVer('1.0.0-alpha')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['alpha'],
      })
      expect(parseSemVer('1.0.0-alpha.1')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['alpha', '1'],
      })
      expect(parseSemVer('2.0.0-beta.2.preview')).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
        prerelease: ['beta', '2', 'preview'],
      })
    })

    it('should parse semver with build metadata', () => {
      expect(parseSemVer('1.0.0+build.123')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        build: 'build.123',
      })
      expect(parseSemVer('1.0.0+20130313144700')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        build: '20130313144700',
      })
    })

    it('should parse semver with both prerelease and build', () => {
      expect(parseSemVer('1.0.0-alpha+001')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['alpha'],
        build: '001',
      })
      expect(parseSemVer('1.0.0-alpha.1+build.123')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['alpha', '1'],
        build: 'build.123',
      })
    })

    it('should throw for invalid versions', () => {
      expect(() => parseSemVer('invalid')).toThrow()
      expect(() => parseSemVer('1.2')).toThrow()
      expect(() => parseSemVer('1.2.3.4')).toThrow()
      expect(() => parseSemVer('v1.2.3')).toThrow()
      expect(() => parseSemVer('1.2.x')).toThrow()
      expect(() => parseSemVer('')).toThrow()
    })
  })

  describe('formatSemVer', () => {
    it('should format basic semver', () => {
      expect(formatSemVer({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3')
    })

    it('should format semver with prerelease', () => {
      expect(
        formatSemVer({ major: 1, minor: 0, patch: 0, prerelease: ['alpha'] })
      ).toBe('1.0.0-alpha')
      expect(
        formatSemVer({ major: 1, minor: 0, patch: 0, prerelease: ['alpha', '1'] })
      ).toBe('1.0.0-alpha.1')
    })

    it('should format semver with build', () => {
      expect(
        formatSemVer({ major: 1, minor: 0, patch: 0, build: 'build123' })
      ).toBe('1.0.0+build123')
    })

    it('should format semver with both prerelease and build', () => {
      expect(
        formatSemVer({
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['alpha'],
          build: '001',
        })
      ).toBe('1.0.0-alpha+001')
    })
  })

  describe('isValidSemVer', () => {
    it('should validate correct semver strings', () => {
      expect(isValidSemVer('1.0.0')).toBe(true)
      expect(isValidSemVer('1.0.0-alpha')).toBe(true)
      expect(isValidSemVer('1.0.0+build')).toBe(true)
      expect(isValidSemVer('1.0.0-alpha+build')).toBe(true)
    })

    it('should reject invalid semver strings', () => {
      expect(isValidSemVer('invalid')).toBe(false)
      expect(isValidSemVer('1.2')).toBe(false)
      expect(isValidSemVer('v1.2.3')).toBe(false)
    })
  })
})

// ============================================================================
// SEMVER COMPARISON
// ============================================================================

describe('Semantic Version Comparison', () => {
  describe('compareSemVer', () => {
    it('should return 0 for equal versions', () => {
      expect(compareSemVer('1.0.0', '1.0.0')).toBe(0)
      expect(compareSemVer('2.3.4', '2.3.4')).toBe(0)
    })

    it('should compare major versions', () => {
      expect(compareSemVer('2.0.0', '1.0.0')).toBe(1)
      expect(compareSemVer('1.0.0', '2.0.0')).toBe(-1)
    })

    it('should compare minor versions', () => {
      expect(compareSemVer('1.2.0', '1.1.0')).toBe(1)
      expect(compareSemVer('1.1.0', '1.2.0')).toBe(-1)
    })

    it('should compare patch versions', () => {
      expect(compareSemVer('1.0.2', '1.0.1')).toBe(1)
      expect(compareSemVer('1.0.1', '1.0.2')).toBe(-1)
    })

    it('should compare prerelease versions correctly', () => {
      // Release > prerelease
      expect(compareSemVer('1.0.0', '1.0.0-alpha')).toBe(1)
      expect(compareSemVer('1.0.0-alpha', '1.0.0')).toBe(-1)

      // Alphabetical comparison
      expect(compareSemVer('1.0.0-beta', '1.0.0-alpha')).toBe(1)
      expect(compareSemVer('1.0.0-alpha', '1.0.0-beta')).toBe(-1)

      // Numeric comparison
      expect(compareSemVer('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(1)
      expect(compareSemVer('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1)

      // Longer prerelease > shorter if equal prefix
      expect(compareSemVer('1.0.0-alpha.1.1', '1.0.0-alpha.1')).toBe(1)
    })

    it('should work with SemVer objects', () => {
      const a: SemVer = { major: 1, minor: 2, patch: 3 }
      const b: SemVer = { major: 1, minor: 2, patch: 4 }
      expect(compareSemVer(a, b)).toBe(-1)
    })
  })
})

// ============================================================================
// VERSION BUMPING
// ============================================================================

describe('Version Bumping', () => {
  describe('bumpVersion', () => {
    it('should bump major version', () => {
      expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
      expect(bumpVersion('0.1.0', 'major')).toBe('1.0.0')
    })

    it('should bump minor version', () => {
      expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
      expect(bumpVersion('1.0.0', 'minor')).toBe('1.1.0')
    })

    it('should bump patch version', () => {
      expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
      expect(bumpVersion('1.0.0', 'patch')).toBe('1.0.1')
    })

    it('should work with SemVer objects', () => {
      const version: SemVer = { major: 1, minor: 2, patch: 3 }
      expect(bumpVersion(version, 'major')).toBe('2.0.0')
    })
  })

  describe('bumpPrerelease', () => {
    it('should add prerelease to release version', () => {
      expect(bumpPrerelease('1.0.0')).toBe('1.0.1-0')
      expect(bumpPrerelease('1.0.0', 'alpha')).toBe('1.0.1-alpha.0')
    })

    it('should increment prerelease number', () => {
      expect(bumpPrerelease('1.0.0-0')).toBe('1.0.0-1')
      expect(bumpPrerelease('1.0.0-alpha.0')).toBe('1.0.0-alpha.1')
      expect(bumpPrerelease('1.0.0-alpha.5')).toBe('1.0.0-alpha.6')
    })

    it('should handle prerelease without numbers', () => {
      expect(bumpPrerelease('1.0.0-alpha')).toBe('1.0.0-alpha.1')
    })
  })
})

// ============================================================================
// VERSION RANGE MATCHING
// ============================================================================

describe('Version Range Matching', () => {
  describe('parseVersionRange', () => {
    it('should parse exact version', () => {
      const ranges = parseVersionRange('1.2.3')
      expect(ranges).toHaveLength(1)
      expect(ranges[0]!.operator).toBe('=')
      expect(ranges[0]!.version).toEqual({ major: 1, minor: 2, patch: 3 })
    })

    it('should parse caret range', () => {
      const ranges = parseVersionRange('^1.2.3')
      expect(ranges).toHaveLength(1)
      expect(ranges[0]!.operator).toBe('^')
    })

    it('should parse tilde range', () => {
      const ranges = parseVersionRange('~1.2.3')
      expect(ranges).toHaveLength(1)
      expect(ranges[0]!.operator).toBe('~')
    })

    it('should parse comparison operators', () => {
      expect(parseVersionRange('>=1.2.3')[0]!.operator).toBe('>=')
      expect(parseVersionRange('>1.2.3')[0]!.operator).toBe('>')
      expect(parseVersionRange('<=1.2.3')[0]!.operator).toBe('<=')
      expect(parseVersionRange('<1.2.3')[0]!.operator).toBe('<')
      expect(parseVersionRange('=1.2.3')[0]!.operator).toBe('=')
    })

    it('should parse hyphen range', () => {
      const ranges = parseVersionRange('1.0.0 - 2.0.0')
      expect(ranges).toHaveLength(1)
      expect(ranges[0]!.operator).toBe('-')
      expect(ranges[0]!.version).toEqual({ major: 1, minor: 0, patch: 0 })
      expect(ranges[0]!.upperBound).toEqual({ major: 2, minor: 0, patch: 0 })
    })

    it('should parse OR ranges', () => {
      const ranges = parseVersionRange('1.0.0 || 2.0.0')
      expect(ranges).toHaveLength(2)
    })
  })

  describe('satisfies', () => {
    describe('exact version', () => {
      it('should match exact version', () => {
        expect(satisfies('1.2.3', '1.2.3')).toBe(true)
        expect(satisfies('1.2.3', '=1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '1.2.3')).toBe(false)
      })
    })

    describe('caret ranges (^)', () => {
      it('should allow minor and patch updates for major > 0', () => {
        expect(satisfies('1.2.3', '^1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '^1.2.3')).toBe(true)
        expect(satisfies('1.3.0', '^1.2.3')).toBe(true)
        expect(satisfies('1.9.9', '^1.2.3')).toBe(true)
        expect(satisfies('2.0.0', '^1.2.3')).toBe(false)
        expect(satisfies('1.2.2', '^1.2.3')).toBe(false)
      })

      it('should only allow patch updates for 0.x.x', () => {
        expect(satisfies('0.2.3', '^0.2.3')).toBe(true)
        expect(satisfies('0.2.4', '^0.2.3')).toBe(true)
        expect(satisfies('0.3.0', '^0.2.3')).toBe(false)
        expect(satisfies('0.2.2', '^0.2.3')).toBe(false)
      })

      it('should only allow exact patch for 0.0.x', () => {
        expect(satisfies('0.0.3', '^0.0.3')).toBe(true)
        expect(satisfies('0.0.4', '^0.0.3')).toBe(false)
        expect(satisfies('0.1.0', '^0.0.3')).toBe(false)
      })
    })

    describe('tilde ranges (~)', () => {
      it('should only allow patch updates', () => {
        expect(satisfies('1.2.3', '~1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '~1.2.3')).toBe(true)
        expect(satisfies('1.2.99', '~1.2.3')).toBe(true)
        expect(satisfies('1.3.0', '~1.2.3')).toBe(false)
        expect(satisfies('1.2.2', '~1.2.3')).toBe(false)
      })
    })

    describe('comparison operators', () => {
      it('should handle greater than', () => {
        expect(satisfies('1.2.4', '>1.2.3')).toBe(true)
        expect(satisfies('2.0.0', '>1.2.3')).toBe(true)
        expect(satisfies('1.2.3', '>1.2.3')).toBe(false)
        expect(satisfies('1.2.2', '>1.2.3')).toBe(false)
      })

      it('should handle greater than or equal', () => {
        expect(satisfies('1.2.3', '>=1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '>=1.2.3')).toBe(true)
        expect(satisfies('1.2.2', '>=1.2.3')).toBe(false)
      })

      it('should handle less than', () => {
        expect(satisfies('1.2.2', '<1.2.3')).toBe(true)
        expect(satisfies('1.0.0', '<1.2.3')).toBe(true)
        expect(satisfies('1.2.3', '<1.2.3')).toBe(false)
        expect(satisfies('1.2.4', '<1.2.3')).toBe(false)
      })

      it('should handle less than or equal', () => {
        expect(satisfies('1.2.3', '<=1.2.3')).toBe(true)
        expect(satisfies('1.2.2', '<=1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '<=1.2.3')).toBe(false)
      })
    })

    describe('hyphen ranges', () => {
      it('should match versions in range inclusively', () => {
        expect(satisfies('1.0.0', '1.0.0 - 2.0.0')).toBe(true)
        expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true)
        expect(satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true)
        expect(satisfies('0.9.9', '1.0.0 - 2.0.0')).toBe(false)
        expect(satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false)
      })
    })

    describe('OR ranges', () => {
      it('should match any version in OR range', () => {
        expect(satisfies('1.0.0', '1.0.0 || 2.0.0')).toBe(true)
        expect(satisfies('2.0.0', '1.0.0 || 2.0.0')).toBe(true)
        expect(satisfies('1.5.0', '1.0.0 || 2.0.0')).toBe(false)
      })
    })
  })

  describe('maxSatisfying', () => {
    it('should find maximum satisfying version', () => {
      const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0']
      expect(maxSatisfying(versions, '^1.0.0')).toBe('1.2.0')
      expect(maxSatisfying(versions, '~1.1.0')).toBe('1.1.0')
      expect(maxSatisfying(versions, '>=2.0.0')).toBe('2.1.0')
    })

    it('should return null if no version satisfies', () => {
      const versions = ['1.0.0', '1.1.0']
      expect(maxSatisfying(versions, '^2.0.0')).toBe(null)
    })
  })

  describe('minSatisfying', () => {
    it('should find minimum satisfying version', () => {
      const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0']
      expect(minSatisfying(versions, '^1.0.0')).toBe('1.0.0')
      expect(minSatisfying(versions, '>=1.1.0')).toBe('1.1.0')
      expect(minSatisfying(versions, '>1.1.0')).toBe('1.2.0')
    })

    it('should return null if no version satisfies', () => {
      const versions = ['1.0.0', '1.1.0']
      expect(minSatisfying(versions, '^2.0.0')).toBe(null)
    })
  })
})

// ============================================================================
// SCHEMA CHANGE ANALYSIS
// ============================================================================

describe('Schema Change Analysis', () => {
  describe('analyzeSchemaChanges', () => {
    it('should detect added fields', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      expect(changes.some((c) => c.category === 'field-added' && c.field === 'name')).toBe(true)
    })

    it('should detect removed fields', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      expect(changes.some((c) => c.category === 'field-removed' && c.field === 'name')).toBe(true)
    })

    it('should detect type changes', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const typeChange = changes.find((c) => c.category === 'type-changed' && c.field === 'id')
      expect(typeChange).toBeDefined()
      expect(typeChange!.type).toBe('breaking')
    })

    it('should detect required field becoming optional', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const requiredChange = changes.find(
        (c) => c.category === 'required-removed' && c.field === 'name'
      )
      expect(requiredChange).toBeDefined()
      expect(requiredChange!.type).toBe('addition') // Non-breaking
    })

    it('should detect optional field becoming required', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const requiredChange = changes.find(
        (c) => c.category === 'required-added' && c.field === 'name'
      )
      expect(requiredChange).toBeDefined()
      expect(requiredChange!.type).toBe('breaking')
    })

    it('should detect removed required field as breaking', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const removedChange = changes.find(
        (c) => c.category === 'field-removed' && c.field === 'email'
      )
      expect(removedChange).toBeDefined()
      expect(removedChange!.type).toBe('breaking')
    })

    it('should detect new required field as breaking', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const addedChange = changes.find(
        (c) => c.category === 'field-added' && c.field === 'email'
      )
      expect(addedChange).toBeDefined()
      expect(addedChange!.type).toBe('breaking')
    })

    it('should detect constraint tightening as breaking', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'integer', minimum: 0 },
        },
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'integer', minimum: 18 },
        },
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const constraintChange = changes.find(
        (c) => c.category === 'constraint-tightened' && c.field === 'age'
      )
      expect(constraintChange).toBeDefined()
      expect(constraintChange!.type).toBe('breaking')
    })

    it('should detect enum value removal as breaking', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
        },
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const enumChange = changes.find(
        (c) => c.category === 'enum-values-removed' && c.field === 'status'
      )
      expect(enumChange).toBeDefined()
      expect(enumChange!.type).toBe('breaking')
    })

    it('should detect enum value addition as non-breaking', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
        },
      }

      const changes = analyzeSchemaChanges(oldSchema, newSchema)
      const enumChange = changes.find(
        (c) => c.category === 'enum-values-added' && c.field === 'status'
      )
      expect(enumChange).toBeDefined()
      expect(enumChange!.type).toBe('addition')
    })
  })

  describe('suggestVersionBump', () => {
    it('should suggest major bump for breaking changes', () => {
      const changes: SchemaChange[] = [
        { type: 'breaking', category: 'field-removed', field: 'email', message: 'Breaking' },
      ]
      expect(suggestVersionBump(changes)).toBe('major')
    })

    it('should suggest minor bump for additions', () => {
      const changes: SchemaChange[] = [
        { type: 'addition', category: 'field-added', field: 'phone', message: 'Added' },
      ]
      expect(suggestVersionBump(changes)).toBe('minor')
    })

    it('should suggest minor bump for deprecations', () => {
      const changes: SchemaChange[] = [
        { type: 'deprecation', category: 'field-removed', field: 'legacy', message: 'Deprecated' },
      ]
      expect(suggestVersionBump(changes)).toBe('minor')
    })

    it('should suggest patch bump for no changes or patch changes', () => {
      expect(suggestVersionBump([])).toBe('patch')
      const changes: SchemaChange[] = [
        { type: 'patch', category: 'constraint-relaxed', field: 'age', message: 'Relaxed' },
      ]
      expect(suggestVersionBump(changes)).toBe('patch')
    })

    it('should prioritize major over minor', () => {
      const changes: SchemaChange[] = [
        { type: 'addition', category: 'field-added', field: 'phone', message: 'Added' },
        { type: 'breaking', category: 'type-changed', field: 'id', message: 'Breaking' },
      ]
      expect(suggestVersionBump(changes)).toBe('major')
    })
  })

  describe('analyzeCompatibility', () => {
    it('should return full compatibility analysis', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const result = analyzeCompatibility('1.0.0', oldSchema, newSchema)

      expect(result.compatible).toBe(true)
      expect(result.breakingChanges).toHaveLength(0)
      expect(result.additions.length).toBeGreaterThan(0)
      expect(result.suggestedBump).toBe('minor')
      expect(result.suggestedVersion).toBe('1.1.0')
    })

    it('should identify incompatible changes', () => {
      const oldSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      }

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
        required: ['id'],
      }

      const result = analyzeCompatibility('1.0.0', oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.length).toBeGreaterThan(0)
      expect(result.suggestedBump).toBe('major')
      expect(result.suggestedVersion).toBe('2.0.0')
    })
  })
})

// ============================================================================
// SCHEMA CHECKSUM
// ============================================================================

describe('Schema Checksum', () => {
  describe('generateSchemaChecksum', () => {
    it('should generate consistent checksums', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      }

      const checksum1 = generateSchemaChecksum(schema)
      const checksum2 = generateSchemaChecksum(schema)

      expect(checksum1).toBe(checksum2)
    })

    it('should generate different checksums for different schemas', () => {
      const schema1: JSONSchema = {
        type: 'object',
        properties: { id: { type: 'string' } },
      }

      const schema2: JSONSchema = {
        type: 'object',
        properties: { id: { type: 'integer' } },
      }

      expect(generateSchemaChecksum(schema1)).not.toBe(generateSchemaChecksum(schema2))
    })

    it('should generate same checksum regardless of property order', () => {
      const schema1: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
      }

      const schema2: JSONSchema = {
        properties: { b: { type: 'string' }, a: { type: 'string' } },
        type: 'object',
      }

      expect(generateSchemaChecksum(schema1)).toBe(generateSchemaChecksum(schema2))
    })
  })
})

// ============================================================================
// VERSIONED CONTRACT CLASS
// ============================================================================

describe('VersionedContract', () => {
  let contract: VersionedContract

  beforeEach(() => {
    contract = createVersionedContract()
  })

  describe('publish', () => {
    it('should publish initial version', () => {
      const entry = contract.publish('1.0.0', {
        type: 'object',
        properties: { id: { type: 'string' } },
      })

      expect(entry.version).toBe('1.0.0')
      expect(entry.checksum).toBeDefined()
      expect(entry.publishedAt).toBeInstanceOf(Date)
    })

    it('should publish with description', () => {
      const entry = contract.publish(
        '1.0.0',
        { type: 'object', properties: { id: { type: 'string' } } },
        { description: 'Initial release' }
      )

      expect(entry.description).toBe('Initial release')
    })

    it('should enforce version ordering', () => {
      contract.publish('1.0.0', { type: 'object', properties: {} })

      expect(() =>
        contract.publish('0.9.0', { type: 'object', properties: {} })
      ).toThrow()

      expect(() =>
        contract.publish('1.0.0', { type: 'object', properties: {} })
      ).toThrow()
    })

    it('should reject invalid version format', () => {
      expect(() =>
        contract.publish('invalid', { type: 'object', properties: {} })
      ).toThrow()
    })
  })

  describe('publishWithAnalysis', () => {
    it('should publish first version as 1.0.0', () => {
      const { entry, analysis } = contract.publishWithAnalysis({
        type: 'object',
        properties: { id: { type: 'string' } },
      })

      expect(entry.version).toBe('1.0.0')
      expect(analysis.compatible).toBe(true)
    })

    it('should auto-bump minor for additions', () => {
      contract.publish('1.0.0', {
        type: 'object',
        properties: { id: { type: 'string' } },
      })

      const { entry, analysis } = contract.publishWithAnalysis({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      })

      expect(entry.version).toBe('1.1.0')
      expect(analysis.suggestedBump).toBe('minor')
      expect(analysis.compatible).toBe(true)
    })

    it('should auto-bump major for breaking changes', () => {
      contract.publish('1.0.0', {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      })

      const { entry, analysis } = contract.publishWithAnalysis({
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      })

      expect(entry.version).toBe('2.0.0')
      expect(analysis.suggestedBump).toBe('major')
      expect(analysis.compatible).toBe(false)
    })
  })

  describe('getVersion', () => {
    it('should retrieve specific version', () => {
      contract.publish('1.0.0', { type: 'object', properties: { a: { type: 'string' } } })
      contract.publish('1.1.0', { type: 'object', properties: { b: { type: 'string' } } })

      const v1 = contract.getVersion('1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.schema.properties?.a).toBeDefined()

      const v11 = contract.getVersion('1.1.0')
      expect(v11).toBeDefined()
      expect(v11!.schema.properties?.b).toBeDefined()
    })

    it('should return undefined for non-existent version', () => {
      expect(contract.getVersion('1.0.0')).toBeUndefined()
    })
  })

  describe('getCurrentVersion', () => {
    it('should return latest published version', () => {
      contract.publish('1.0.0', { type: 'object', properties: {} })
      contract.publish('1.1.0', { type: 'object', properties: {} })
      contract.publish('2.0.0', { type: 'object', properties: {} })

      const current = contract.getCurrentVersion()
      expect(current).toBeDefined()
      expect(current!.version).toBe('2.0.0')
    })

    it('should return undefined when no versions published', () => {
      expect(contract.getCurrentVersion()).toBeUndefined()
    })
  })

  describe('getAllVersions', () => {
    it('should return all versions in order', () => {
      contract.publish('1.0.0', { type: 'object', properties: {} })
      contract.publish('1.1.0', { type: 'object', properties: {} })
      contract.publish('2.0.0', { type: 'object', properties: {} })

      const versions = contract.getAllVersions()
      expect(versions.map((v) => v.version)).toEqual(['1.0.0', '1.1.0', '2.0.0'])
    })
  })

  describe('getMatchingVersions', () => {
    it('should return versions matching range', () => {
      contract.publish('1.0.0', { type: 'object', properties: {} })
      contract.publish('1.1.0', { type: 'object', properties: {} })
      contract.publish('1.2.0', { type: 'object', properties: {} })
      contract.publish('2.0.0', { type: 'object', properties: {} })

      const matching = contract.getMatchingVersions('^1.0.0')
      expect(matching.map((v) => v.version)).toEqual(['1.0.0', '1.1.0', '1.2.0'])
    })
  })

  describe('rollback', () => {
    it('should rollback to previous version', () => {
      contract.publish('1.0.0', { type: 'object', properties: { a: { type: 'string' } } })
      contract.publish('1.1.0', { type: 'object', properties: { b: { type: 'string' } } })
      contract.publish('2.0.0', { type: 'object', properties: { c: { type: 'string' } } })

      const rolledBack = contract.rollback('1.0.0')
      expect(rolledBack.version).toBe('1.0.0')

      const current = contract.getCurrentVersion()
      expect(current!.version).toBe('1.0.0')

      // Later versions should be removed
      expect(contract.getVersion('1.1.0')).toBeUndefined()
      expect(contract.getVersion('2.0.0')).toBeUndefined()
    })

    it('should throw for non-existent version', () => {
      expect(() => contract.rollback('1.0.0')).toThrow()
    })
  })

  describe('compare', () => {
    it('should compare versions', () => {
      expect(contract.compare('1.0.0', '2.0.0')).toBe(-1)
      expect(contract.compare('2.0.0', '1.0.0')).toBe(1)
      expect(contract.compare('1.0.0', '1.0.0')).toBe(0)
    })
  })

  describe('isCompatible', () => {
    it('should check compatibility between versions', () => {
      contract.publish('1.0.0', {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      })

      contract.publish('1.1.0', {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      })

      const result = contract.isCompatible('1.0.0', '1.1.0')
      expect(result.compatible).toBe(true)
      expect(result.additions.length).toBeGreaterThan(0)
    })

    it('should throw for non-existent versions', () => {
      contract.publish('1.0.0', { type: 'object', properties: {} })

      expect(() => contract.isCompatible('1.0.0', '2.0.0')).toThrow()
      expect(() => contract.isCompatible('0.9.0', '1.0.0')).toThrow()
    })
  })
})
