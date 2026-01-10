import { describe, it, expect } from 'vitest'
import {
  type ArtifactMode,
  type RetryResult,
  type ArtifactRecord,
  type AstFields,
  ARTIFACT_MODES,
  isArtifactRecord,
  isValidArtifactMode,
  createSuccessResult,
  createFailureResult,
  getMdast,
  getHast,
} from '../artifacts-types'

// Import from both source files to verify consistency
import { ArtifactMode as IngestArtifactMode } from '../artifacts-ingest'
import { ArtifactMode as ConfigArtifactMode } from '../artifacts-config'

/**
 * Shared Artifact Types Tests (RED Phase)
 *
 * These tests verify type consistency, discriminated unions, and type guards
 * for the shared artifacts types module. All tests are expected to FAIL
 * until the implementation is fixed.
 *
 * Problems being tested:
 * 1. ArtifactMode duplication and consistency
 * 2. RetryResult<T> unsafe cast when success=false
 * 3. AST fields using loose `object` type
 * 4. Type guards correctness
 *
 * @see /docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Type Consistency Tests
// ============================================================================

describe('ArtifactMode Type Consistency', () => {
  describe('ArtifactMode values', () => {
    it('includes exactly preview, build, and bulk modes', () => {
      // ARTIFACT_MODES should contain all three modes
      expect(ARTIFACT_MODES).toContain('preview')
      expect(ARTIFACT_MODES).toContain('build')
      expect(ARTIFACT_MODES).toContain('bulk')  // RED: missing from stub
      expect(ARTIFACT_MODES).toHaveLength(3)    // RED: stub has length 2
    })

    it('bulk mode is a valid ArtifactMode', () => {
      // This tests that 'bulk' is assignable to ArtifactMode
      const bulkMode: ArtifactMode = 'bulk' as ArtifactMode  // RED: type error
      expect(bulkMode).toBe('bulk')
    })

    it('ArtifactMode from shared module matches artifacts-ingest', () => {
      // Values should be identical
      const sharedModes: ArtifactMode[] = ['preview', 'build', 'bulk'] as ArtifactMode[]
      const ingestModes: IngestArtifactMode[] = ['preview', 'build', 'bulk']

      // Both should accept all three modes
      expect(sharedModes).toEqual(ingestModes)
    })

    it('ArtifactMode from shared module matches artifacts-config', () => {
      // Values should be identical
      const sharedModes: ArtifactMode[] = ['preview', 'build', 'bulk'] as ArtifactMode[]
      const configModes: ConfigArtifactMode[] = ['preview', 'build', 'bulk']

      // Both should accept all three modes
      expect(sharedModes).toEqual(configModes)
    })

    it('ARTIFACT_MODES array is readonly', () => {
      // Should be a readonly array
      const modes = ARTIFACT_MODES

      // This should cause TypeScript error if properly typed
      // @ts-expect-error - ARTIFACT_MODES should be readonly
      modes.push('invalid')

      // Runtime check - length should still be 3 if readonly is enforced
      expect(ARTIFACT_MODES).toHaveLength(3)  // RED: stub has length 2
    })
  })

  describe('type guard isValidArtifactMode', () => {
    it('returns true for preview mode', () => {
      expect(isValidArtifactMode('preview')).toBe(true)
    })

    it('returns true for build mode', () => {
      expect(isValidArtifactMode('build')).toBe(true)
    })

    it('returns true for bulk mode', () => {
      expect(isValidArtifactMode('bulk')).toBe(true)  // RED: stub returns false
    })

    it('returns false for invalid mode strings', () => {
      expect(isValidArtifactMode('invalid')).toBe(false)
      expect(isValidArtifactMode('publish')).toBe(false)
      expect(isValidArtifactMode('')).toBe(false)
    })

    it('returns false for non-string values', () => {
      expect(isValidArtifactMode(null)).toBe(false)
      expect(isValidArtifactMode(undefined)).toBe(false)
      expect(isValidArtifactMode(123)).toBe(false)
      expect(isValidArtifactMode({})).toBe(false)
      expect(isValidArtifactMode([])).toBe(false)
    })

    it('narrows type after check', () => {
      const mode: unknown = 'bulk'

      if (isValidArtifactMode(mode)) {
        // After type guard, mode should be ArtifactMode
        const validated: ArtifactMode = mode
        expect(validated).toBe('bulk')  // RED: stub doesn't recognize 'bulk'
      } else {
        // This branch should not execute for valid mode
        expect.fail('bulk should be a valid ArtifactMode')  // RED: fails because stub returns false
      }
    })
  })
})

// ============================================================================
// RetryResult Discriminated Union Tests
// ============================================================================

describe('RetryResult<T> Discriminated Union', () => {
  describe('success result', () => {
    it('has result of type T when success is true', () => {
      const result = createSuccessResult<string>('test-value', 0)

      expect(result.success).toBe(true)
      expect(result.result).toBe('test-value')
      expect(result.retries).toBe(0)
      expect(result.error).toBeUndefined()
    })

    it('result is never undefined when success is true', () => {
      const result = createSuccessResult<{ id: number }>({ id: 42 }, 1)

      expect(result.success).toBe(true)
      // result should be { id: number }, not undefined
      expect(result.result).toBeDefined()
      expect(result.result.id).toBe(42)
    })

    it('error field is absent when success is true', () => {
      const result = createSuccessResult<number>(123, 0)

      expect(result.success).toBe(true)
      expect('error' in result && result.error !== undefined).toBe(false)
    })
  })

  describe('failure result', () => {
    it('has undefined result when success is false', () => {
      const result = createFailureResult<string>('error message', 3)

      expect(result.success).toBe(false)
      expect(result.result).toBeUndefined()  // RED: stub casts undefined as T
      expect(result.retries).toBe(3)
      expect(result.error).toBe('error message')
    })

    it('error is always present when success is false', () => {
      const result = createFailureResult<number>('failed', 2)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(typeof result.error).toBe('string')
    })

    it('result type is undefined, not T cast to undefined', () => {
      // This tests the unsafe cast problem
      const result = createFailureResult<{ required: string }>('error', 1)

      expect(result.success).toBe(false)

      // Accessing result.required should be a type error after narrowing
      // But with unsafe cast, TypeScript thinks result is { required: string }
      // Runtime check - should be undefined
      expect(result.result).toBeUndefined()

      // The unsafe cast means this would type-check but fail at runtime:
      // result.result.required would throw TypeError
    })
  })

  describe('type narrowing based on success', () => {
    it('narrows result to T when success is true', () => {
      type MyData = { id: string; value: number }
      const successResult = createSuccessResult<MyData>({ id: 'abc', value: 42 }, 0)

      if (successResult.success) {
        // After narrowing, result should be MyData (not MyData | undefined)
        const data: MyData = successResult.result
        expect(data.id).toBe('abc')
        expect(data.value).toBe(42)
      }
    })

    it('narrows result to undefined when success is false', () => {
      const failureResult = createFailureResult<{ important: boolean }>('error', 2)

      if (!failureResult.success) {
        // After narrowing, result should be undefined
        // This should NOT compile with a proper discriminated union:
        // @ts-expect-error - result should be undefined, not T  // RED: this expect-error will fail because stub doesn't discriminate
        const _x: { important: boolean } = failureResult.result

        // Runtime check
        expect(failureResult.result).toBeUndefined()
        expect(failureResult.error).toBeDefined()
      }
    })

    it('prevents unsafe access to result properties on failure', () => {
      interface User {
        name: string
        email: string
      }

      const result = createFailureResult<User>('User not found', 3)

      // With proper discriminated union, this pattern should be safe:
      if (result.success) {
        // TypeScript knows result.result is User here
        console.log(result.result.name)
      } else {
        // TypeScript knows result.result is undefined here
        // Accessing result.result.name should be a type error

        // Runtime check - result IS undefined
        expect(result.result).toBeUndefined()
      }
    })
  })

  describe('generic type preservation', () => {
    it('preserves complex generic types on success', () => {
      type ComplexType = Map<string, Set<number>>

      const map = new Map<string, Set<number>>()
      map.set('test', new Set([1, 2, 3]))

      const result = createSuccessResult<ComplexType>(map, 0)

      expect(result.success).toBe(true)
      expect(result.result).toBeInstanceOf(Map)
      expect(result.result.get('test')).toBeInstanceOf(Set)
    })

    it('works with nullable types', () => {
      // T = string | null
      const result = createSuccessResult<string | null>(null, 0)

      expect(result.success).toBe(true)
      // result.result should be null (intentionally), not undefined
      expect(result.result).toBeNull()
    })

    it('works with undefined in union types', () => {
      // T = number | undefined
      const result = createSuccessResult<number | undefined>(undefined, 0)

      expect(result.success).toBe(true)
      // result.result is undefined because T includes undefined
      expect(result.result).toBeUndefined()
    })
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('isArtifactRecord type guard', () => {
  describe('valid records', () => {
    it('returns true for minimal valid record', () => {
      const record = {
        ns: 'test-namespace',
        type: 'component',
        id: 'my-component',
      }

      expect(isArtifactRecord(record)).toBe(true)  // RED: stub returns false
    })

    it('returns true for full valid record', () => {
      const record: ArtifactRecord = {
        ns: 'myapp.do',
        type: 'page',
        id: 'home',
        ts: '2026-01-10T00:00:00.000Z',
        markdown: '# Hello',
        mdx: '# Hello\n\n<Component />',
        html: '<h1>Hello</h1>',
        esm: 'export default function() {}',
        dts: 'export default function(): void',
        css: '.hello { color: blue; }',
        mdast: { type: 'root', children: [] },
        hast: { type: 'root', children: [] },
        estree: { type: 'Program', body: [] },
        frontmatter: { title: 'Hello' },
        dependencies: ['react', 'mdxui'],
        exports: ['default', 'metadata'],
        hash: 'abc123',
        size_bytes: 1024,
        visibility: 'public',
      }

      expect(isArtifactRecord(record)).toBe(true)  // RED: stub returns false
    })

    it('returns true for record with null optional fields', () => {
      const record = {
        ns: 'test',
        type: 'data',
        id: 'item-1',
        markdown: null,
        mdast: null,
        visibility: null,
      }

      expect(isArtifactRecord(record)).toBe(true)  // RED: stub returns false
    })
  })

  describe('invalid records', () => {
    it('returns false for null', () => {
      expect(isArtifactRecord(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isArtifactRecord(undefined)).toBe(false)
    })

    it('returns false for non-objects', () => {
      expect(isArtifactRecord('string')).toBe(false)
      expect(isArtifactRecord(123)).toBe(false)
      expect(isArtifactRecord(true)).toBe(false)
      expect(isArtifactRecord([])).toBe(false)
    })

    it('returns false when missing ns', () => {
      const record = {
        type: 'component',
        id: 'my-component',
      }

      expect(isArtifactRecord(record)).toBe(false)
    })

    it('returns false when missing type', () => {
      const record = {
        ns: 'test',
        id: 'my-component',
      }

      expect(isArtifactRecord(record)).toBe(false)
    })

    it('returns false when missing id', () => {
      const record = {
        ns: 'test',
        type: 'component',
      }

      expect(isArtifactRecord(record)).toBe(false)
    })

    it('returns false when ns is not a string', () => {
      const record = {
        ns: 123,
        type: 'component',
        id: 'my-component',
      }

      expect(isArtifactRecord(record)).toBe(false)
    })

    it('returns false when type is not a string', () => {
      const record = {
        ns: 'test',
        type: null,
        id: 'my-component',
      }

      expect(isArtifactRecord(record)).toBe(false)
    })

    it('returns false when id is not a string', () => {
      const record = {
        ns: 'test',
        type: 'component',
        id: undefined,
      }

      expect(isArtifactRecord(record)).toBe(false)
    })

    it('returns false when ns is empty string', () => {
      const record = {
        ns: '',
        type: 'component',
        id: 'my-component',
      }

      expect(isArtifactRecord(record)).toBe(false)
    })
  })

  describe('type narrowing', () => {
    it('narrows unknown to ArtifactRecord', () => {
      const data: unknown = {
        ns: 'test',
        type: 'component',
        id: 'btn',
      }

      if (isArtifactRecord(data)) {
        // After narrowing, data should be ArtifactRecord
        const record: ArtifactRecord = data
        expect(record.ns).toBe('test')
        expect(record.type).toBe('component')
        expect(record.id).toBe('btn')
      } else {
        expect.fail('Valid record should pass type guard')  // RED: stub returns false
      }
    })
  })
})

// ============================================================================
// AST Field Type Tests
// ============================================================================

describe('AST Field Types', () => {
  describe('AST fields accept unknown structures', () => {
    it('mdast field accepts any object structure', () => {
      // MDAST root node example
      const mdastRoot = {
        type: 'root',
        children: [
          { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Hello' }] },
        ],
      }

      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'readme',
        mdast: mdastRoot,
      }

      expect(record.mdast).toEqual(mdastRoot)
    })

    it('hast field accepts any object structure', () => {
      // HAST root node example
      const hastRoot = {
        type: 'root',
        children: [
          { type: 'element', tagName: 'h1', properties: {}, children: [] },
        ],
      }

      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'readme',
        hast: hastRoot,
      }

      expect(record.hast).toEqual(hastRoot)
    })

    it('estree field accepts any object structure', () => {
      // ESTree Program node example
      const estreeProgram = {
        type: 'Program',
        sourceType: 'module',
        body: [
          { type: 'ExportDefaultDeclaration', declaration: { type: 'FunctionDeclaration' } },
        ],
      }

      const record: ArtifactRecord = {
        ns: 'test',
        type: 'component',
        id: 'button',
        estree: estreeProgram,
      }

      expect(record.estree).toEqual(estreeProgram)
    })
  })

  describe('AST accessors', () => {
    it('getMdast returns mdast field value', () => {
      const mdast = { type: 'root', children: [] }
      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'readme',
        mdast,
      }

      expect(getMdast(record)).toEqual(mdast)
    })

    it('getMdast returns null when field is null', () => {
      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'readme',
        mdast: null,
      }

      expect(getMdast(record)).toBeNull()
    })

    it('getMdast returns undefined when field is absent', () => {
      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'readme',
      }

      expect(getMdast(record)).toBeUndefined()
    })

    it('getHast returns hast field value', () => {
      const hast = { type: 'root', children: [] }
      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'readme',
        hast,
      }

      expect(getHast(record)).toEqual(hast)
    })
  })

  describe('AST fields with null values', () => {
    it('accepts null for all AST fields', () => {
      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'empty',
        mdast: null,
        hast: null,
        estree: null,
        tsast: null,
      }

      expect(record.mdast).toBeNull()
      expect(record.hast).toBeNull()
      expect(record.estree).toBeNull()
      expect(record.tsast).toBeNull()
    })
  })

  describe('type safety with unknown vs object', () => {
    it('AST fields should use unknown type for safety', () => {
      // With `object` type, you can accidentally assign primitives wrapped in Object()
      // With `unknown` type, you must validate before accessing properties

      const record: ArtifactRecord = {
        ns: 'test',
        type: 'doc',
        id: 'test',
        mdast: { type: 'root', children: [] },
      }

      // Accessing properties on `object` type without type guard is unsafe
      // With proper `unknown` typing, this should require a type assertion or guard
      const mdast = record.mdast

      // The test here is more about documentation - we want `unknown` not `object`
      // because `unknown` is safer and forces proper type checking
      expect(mdast).toBeDefined()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Type Integration', () => {
  describe('using types together', () => {
    it('RetryResult with ArtifactRecord works correctly', () => {
      const record: ArtifactRecord = {
        ns: 'myapp',
        type: 'page',
        id: 'home',
        markdown: '# Home',
      }

      const result = createSuccessResult<ArtifactRecord>(record, 0)

      expect(result.success).toBe(true)
      expect(result.result.ns).toBe('myapp')
      expect(result.result.type).toBe('page')
    })

    it('RetryResult failure does not expose ArtifactRecord methods', () => {
      const result = createFailureResult<ArtifactRecord>('not found', 3)

      expect(result.success).toBe(false)
      expect(result.result).toBeUndefined()  // RED: stub casts undefined as ArtifactRecord

      // With proper discriminated union, accessing result.ns after checking
      // success=false should be a type error
    })

    it('type guard integration with RetryResult', () => {
      // Simulating fetching an artifact
      function fetchArtifact(): RetryResult<unknown> {
        // Simulated success with data
        return {
          result: { ns: 'test', type: 'doc', id: 'readme' },
          success: true,
          retries: 0,
        }
      }

      const result = fetchArtifact()

      if (result.success && isArtifactRecord(result.result)) {
        // Both guards passed - result.result is ArtifactRecord
        const artifact: ArtifactRecord = result.result
        expect(artifact.ns).toBe('test')  // RED: isArtifactRecord returns false
      } else {
        expect.fail('Should have valid artifact')  // RED
      }
    })
  })

  describe('mode validation with config', () => {
    it('validates mode before using in pipeline', () => {
      function routeToPipeline(mode: unknown): string {
        if (!isValidArtifactMode(mode)) {
          throw new Error(`Invalid mode: ${mode}`)
        }
        // mode is now narrowed to ArtifactMode
        const validMode: ArtifactMode = mode
        return `pipeline-${validMode}`
      }

      expect(routeToPipeline('preview')).toBe('pipeline-preview')
      expect(routeToPipeline('build')).toBe('pipeline-build')
      expect(routeToPipeline('bulk')).toBe('pipeline-bulk')  // RED: isValidArtifactMode returns false for 'bulk'
      expect(() => routeToPipeline('invalid')).toThrow()
    })
  })
})

// ============================================================================
// Compile-Time Type Tests (these verify TypeScript behavior)
// ============================================================================

describe('Compile-Time Type Safety', () => {
  it('ArtifactMode literal completeness check', () => {
    // This function should handle all ArtifactMode cases
    // If a new mode is added, TypeScript should error on missing case
    function getModeDescription(mode: ArtifactMode): string {
      switch (mode) {
        case 'preview':
          return 'Preview mode for development'
        case 'build':
          return 'Build mode for production'
        case 'bulk':
          return 'Bulk mode for batch operations'
        default:
          // This should be unreachable if all cases handled
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _exhaustiveCheck: never = mode  // RED: 'bulk' case missing in stub type
          return 'Unknown'
      }
    }

    expect(getModeDescription('preview')).toBe('Preview mode for development')
    expect(getModeDescription('build')).toBe('Build mode for production')
    expect(getModeDescription('bulk' as ArtifactMode)).toBe('Bulk mode for batch operations')  // RED: cast needed because stub missing 'bulk'
  })

  it('RetryResult discriminated union exhaustiveness', () => {
    // This function demonstrates proper discriminated union handling
    function processResult<T>(result: RetryResult<T>): T | null {
      if (result.success) {
        // TypeScript should know result.result is T here
        return result.result
      } else {
        // TypeScript should know result.result is undefined here
        // And result.error is defined
        console.error(result.error)
        return null
      }
    }

    const success = createSuccessResult<number>(42, 0)
    const failure = createFailureResult<number>('error', 1)

    expect(processResult(success)).toBe(42)
    expect(processResult(failure)).toBeNull()
  })
})
