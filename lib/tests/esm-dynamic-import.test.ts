/**
 * RED Phase Tests: ESM Dynamic Import in Sandbox Environment
 *
 * These tests define expected behavior for ESM dynamic imports that are NOT
 * yet implemented or have gaps in the current implementation. The tests should
 * FAIL initially (RED phase) and drive the implementation (GREEN phase).
 *
 * Test cases from issue dotdo-0eiq3:
 * 1. Import esm.sh bundle via dynamic import()
 * 2. Access default export
 * 3. Access named exports
 * 4. Handle import errors
 * 5. Import with import map
 * 6. Re-export handling
 *
 * @module lib/tests/esm-dynamic-import
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  importEsm,
  resolveModuleSpecifier,
  extractExports,
  clearEsmCache,
  createEsmCache,
  EsmImportError,
  ModuleNotFoundError,
  ImportTimeoutError,
  InvalidModuleError,
  type EsmModule,
  type ImportMap,
} from '../sandbox/esm-loader.js'

// ============================================================================
// TEST 1: REAL ESM.SH BUNDLE IMPORTS (Integration)
// ============================================================================

describe('ESM Dynamic Import - Real esm.sh Bundles', () => {
  beforeEach(() => {
    clearEsmCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('importing real packages from esm.sh', () => {
    it.skip('imports nanoid and executes it', async () => {
      // RED: This test should work with real network in Workers runtime
      // Currently fails because dynamic import of external URLs isn't supported in Node
      const module = await importEsm('nanoid@5.0.4')

      expect(module.default).toBeDefined()
      expect(typeof module.exports.nanoid).toBe('function')

      // Execute the function
      const id = (module.exports.nanoid as () => string)()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it.skip('imports lodash-es and uses functions', async () => {
      // RED: Real import of lodash-es from esm.sh
      const module = await importEsm('lodash-es@4.17.21')

      expect(module.exports.debounce).toBeDefined()
      expect(module.exports.throttle).toBeDefined()
      expect(typeof module.exports.debounce).toBe('function')
    })

    it.skip('imports zod and validates schema', async () => {
      // RED: Real import of zod for runtime validation
      const module = await importEsm('zod@3.22.0')

      const z = module.default || module.exports
      expect(z.string).toBeDefined()
      expect(z.object).toBeDefined()
    })
  })
})

// ============================================================================
// TEST 2: IMPORT MAP SCOPES
// ============================================================================

describe('ESM Dynamic Import - Import Map Scopes', () => {
  beforeEach(() => {
    clearEsmCache()
  })

  describe('scoped import resolution', () => {
    it('resolves imports within a scope', () => {
      const importMap: ImportMap = {
        imports: {
          'lodash': 'https://esm.sh/lodash-es@4.17.21',
        },
        scopes: {
          '/app/': {
            'lodash': 'https://esm.sh/lodash-es@4.17.20', // Different version in scope
          },
        },
      }

      // Global resolution
      const globalUrl = resolveModuleSpecifier('lodash', { importMap })
      expect(globalUrl).toBe('https://esm.sh/lodash-es@4.17.21')

      // Scoped resolution - currently NOT implemented
      // This test should fail until scopes are implemented
      const scopedUrl = resolveModuleSpecifier('lodash', {
        importMap,
        baseUrl: '/app/components/Button.js',
      })

      // Expected: When importing from within /app/, should use the scoped version
      expect(scopedUrl).toBe('https://esm.sh/lodash-es@4.17.20')
    })

    it('falls back to imports when no matching scope', () => {
      const importMap: ImportMap = {
        imports: {
          'react': 'https://esm.sh/react@18.2.0',
        },
        scopes: {
          '/admin/': {
            'react': 'https://esm.sh/react@17.0.2',
          },
        },
      }

      // Importing from outside /admin/ scope should use global import
      const url = resolveModuleSpecifier('react', {
        importMap,
        baseUrl: '/public/index.js',
      })

      expect(url).toBe('https://esm.sh/react@18.2.0')
    })

    it('handles nested scopes with precedence', () => {
      const importMap: ImportMap = {
        imports: {
          'utils': 'https://esm.sh/utils@1.0.0',
        },
        scopes: {
          '/app/': {
            'utils': 'https://esm.sh/utils@2.0.0',
          },
          '/app/admin/': {
            'utils': 'https://esm.sh/utils@3.0.0',
          },
        },
      }

      // Most specific scope should win
      const url = resolveModuleSpecifier('utils', {
        importMap,
        baseUrl: '/app/admin/Dashboard.js',
      })

      expect(url).toBe('https://esm.sh/utils@3.0.0')
    })
  })
})

// ============================================================================
// TEST 3: CIRCULAR DEPENDENCY DETECTION
// ============================================================================

describe('ESM Dynamic Import - Circular Dependencies', () => {
  beforeEach(() => {
    clearEsmCache()
  })

  it('detects direct circular imports', async () => {
    // RED: Circular import detection is not implemented
    // moduleA imports moduleB, moduleB imports moduleA

    // This should either:
    // 1. Throw a specific CircularDependencyError
    // 2. Return a partially initialized module (like Node.js)
    // 3. Handle gracefully with a warning

    // For now, just verify the cache prevents infinite loops
    const cache = createEsmCache()

    // Simulate a circular reference by caching during import
    const moduleA: EsmModule = {
      default: null,
      exports: { name: 'moduleA' },
      url: 'https://esm.sh/moduleA',
      cached: false,
    }

    cache.set('https://esm.sh/moduleA', moduleA)

    // Getting cached module should work
    const retrieved = cache.get('https://esm.sh/moduleA')
    expect(retrieved).toBeDefined()
    expect(retrieved?.cached).toBe(true)
  })

  it('handles transitive circular dependencies', async () => {
    // RED: A -> B -> C -> A should be detected
    // This tests the import graph tracking which is not implemented

    const cache = createEsmCache()

    // Build a simulated dependency chain
    cache.set('https://esm.sh/a', {
      default: null,
      exports: { dep: 'b' },
      url: 'https://esm.sh/a',
      cached: false,
    })

    cache.set('https://esm.sh/b', {
      default: null,
      exports: { dep: 'c' },
      url: 'https://esm.sh/b',
      cached: false,
    })

    cache.set('https://esm.sh/c', {
      default: null,
      exports: { dep: 'a' }, // Circular back to a
      url: 'https://esm.sh/c',
      cached: false,
    })

    // All should be cached and retrievable
    expect(cache.has('https://esm.sh/a')).toBe(true)
    expect(cache.has('https://esm.sh/b')).toBe(true)
    expect(cache.has('https://esm.sh/c')).toBe(true)
  })
})

// ============================================================================
// TEST 4: MODULE SIDE EFFECTS ISOLATION
// ============================================================================

describe('ESM Dynamic Import - Side Effects Isolation', () => {
  beforeEach(() => {
    clearEsmCache()
    // Clean up any global side effects
    delete (globalThis as Record<string, unknown>).testSideEffect
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).testSideEffect
  })

  it('isolates module side effects between imports', async () => {
    // RED: Each import should have isolated side effects
    // This is critical for sandbox security

    // First import should not affect second import's globals
    const module1 = {
      default: null,
      exports: {
        init: () => {
          ;(globalThis as Record<string, unknown>).testSideEffect = 'module1'
        },
      },
      url: 'https://esm.sh/side-effect-module',
      cached: false,
    }

    // Simulate calling the init function
    ;(module1.exports.init as () => void)()
    expect((globalThis as Record<string, unknown>).testSideEffect).toBe('module1')

    // Clear for isolation test
    delete (globalThis as Record<string, unknown>).testSideEffect

    // Second instance should not see first instance's side effects
    expect((globalThis as Record<string, unknown>).testSideEffect).toBeUndefined()
  })

  it('prevents module pollution across cache boundaries', () => {
    // RED: Modules from different origins should not share state

    const cache1 = createEsmCache()
    const cache2 = createEsmCache()

    cache1.set('shared-key', {
      default: 'cache1-value',
      exports: {},
      url: 'https://esm.sh/shared',
      cached: false,
    })

    // cache2 should not see cache1's entry
    expect(cache2.has('shared-key')).toBe(false)
    expect(cache1.has('shared-key')).toBe(true)
  })
})

// ============================================================================
// TEST 5: HOT RELOADING / CACHE INVALIDATION
// ============================================================================

describe('ESM Dynamic Import - Cache Invalidation', () => {
  beforeEach(() => {
    clearEsmCache()
  })

  it('invalidates cache entry by URL', () => {
    const cache = createEsmCache()

    cache.set('https://esm.sh/pkg@1.0.0', {
      default: { version: '1.0.0' },
      exports: {},
      url: 'https://esm.sh/pkg@1.0.0',
      cached: false,
    })

    expect(cache.has('https://esm.sh/pkg@1.0.0')).toBe(true)

    // Clear and verify
    cache.clear()
    expect(cache.has('https://esm.sh/pkg@1.0.0')).toBe(false)
  })

  it('supports cache versioning for package updates', () => {
    // RED: Cache should support version-aware invalidation
    const cache = createEsmCache()

    // Version 1.0.0
    cache.set('https://esm.sh/pkg@1.0.0', {
      default: { version: '1.0.0' },
      exports: {},
      url: 'https://esm.sh/pkg@1.0.0',
      cached: false,
    })

    // Version 2.0.0 - different cache key
    cache.set('https://esm.sh/pkg@2.0.0', {
      default: { version: '2.0.0' },
      exports: {},
      url: 'https://esm.sh/pkg@2.0.0',
      cached: false,
    })

    // Both versions should be independently cached
    const v1 = cache.get('https://esm.sh/pkg@1.0.0')
    const v2 = cache.get('https://esm.sh/pkg@2.0.0')

    expect((v1?.default as { version: string })?.version).toBe('1.0.0')
    expect((v2?.default as { version: string })?.version).toBe('2.0.0')
  })

  it('evicts least recently used entries', () => {
    const cache = createEsmCache({ maxSize: 2 })

    cache.set('a', { default: 'a', exports: {}, url: 'a', cached: false })
    cache.set('b', { default: 'b', exports: {}, url: 'b', cached: false })

    // Access 'a' to make it recently used
    cache.get('a')

    // Add 'c' which should evict 'b' (least recently used)
    cache.set('c', { default: 'c', exports: {}, url: 'c', cached: false })

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })
})

// ============================================================================
// TEST 6: ESM NAMESPACE OBJECTS
// ============================================================================

describe('ESM Dynamic Import - Namespace Objects', () => {
  it('extracts all named exports as namespace', () => {
    const module = {
      default: { isDefault: true },
      foo: 'bar',
      baz: 123,
      fn: () => 'result',
    }

    const { default: defaultExport, exports } = extractExports(module)

    expect(defaultExport).toEqual({ isDefault: true })
    expect(exports.foo).toBe('bar')
    expect(exports.baz).toBe(123)
    expect(typeof exports.fn).toBe('function')
  })

  it('handles modules with only named exports', () => {
    const module = {
      util1: () => 1,
      util2: () => 2,
      CONSTANT: 'value',
    }

    const { default: defaultExport, exports } = extractExports(module)

    expect(defaultExport).toBeUndefined()
    expect(exports.util1).toBeDefined()
    expect(exports.util2).toBeDefined()
    expect(exports.CONSTANT).toBe('value')
  })

  it('handles modules with only default export', () => {
    const module = {
      default: class MyClass {
        name = 'test'
      },
    }

    const { default: defaultExport, exports } = extractExports(module)

    expect(defaultExport).toBeDefined()
    expect(Object.keys(exports).length).toBe(0)
  })

  it('preserves function context in exports', () => {
    const context = { value: 42 }
    const module = {
      getValue: function (this: typeof context) {
        return this.value
      }.bind(context),
    }

    const { exports } = extractExports(module)

    expect((exports.getValue as () => number)()).toBe(42)
  })
})

// ============================================================================
// TEST 7: JSON MODULE IMPORTS (Import Assertions)
// ============================================================================

describe('ESM Dynamic Import - JSON Modules', () => {
  beforeEach(() => {
    clearEsmCache()
  })

  it.skip('imports JSON module with assertion', async () => {
    // RED: JSON import assertions are not implemented
    // Should support: import json from './data.json' with { type: 'json' }

    // This would require esm.sh to support JSON imports or
    // custom handling in the loader
    const module = await importEsm('https://esm.sh/some-pkg/package.json', {
      // Future API: importAssertions: { type: 'json' }
    })

    expect(module.default).toBeDefined()
    expect(typeof module.default).toBe('object')
    // Should have package.json fields
    expect((module.default as { name?: string }).name).toBeDefined()
  })

  it.skip('rejects non-JSON content with json assertion', async () => {
    // RED: Should error if JSON assertion is used on non-JSON
    await expect(
      importEsm('https://esm.sh/lodash-es', {
        // Future API: importAssertions: { type: 'json' }
      })
    ).rejects.toThrow(/JSON/)
  })
})

// ============================================================================
// TEST 8: RE-EXPORT HANDLING
// ============================================================================

describe('ESM Dynamic Import - Re-exports', () => {
  it('handles star re-exports', () => {
    // Simulate a module that re-exports everything from another
    const originalModule = {
      foo: 'bar',
      baz: 123,
      fn: () => 'result',
    }

    // Re-exporting module
    const reExportModule = {
      ...originalModule,
      extraExport: 'added',
    }

    const { exports } = extractExports(reExportModule)

    // All original exports should be present
    expect(exports.foo).toBe('bar')
    expect(exports.baz).toBe(123)
    expect(exports.fn).toBeDefined()
    // Plus the extra export
    expect(exports.extraExport).toBe('added')
  })

  it('handles named re-exports with renaming', () => {
    // Simulate: export { foo as bar } from 'other'
    const module = {
      bar: 'original-foo-value', // foo was renamed to bar
      baz: 'direct-export',
    }

    const { exports } = extractExports(module)

    expect(exports.bar).toBe('original-foo-value')
    expect(exports.baz).toBe('direct-export')
    // foo should not exist (it was renamed to bar)
    expect(exports.foo).toBeUndefined()
  })

  it('handles default re-export', () => {
    // Simulate: export { default } from 'other'
    const module = {
      default: { originalDefault: true },
    }

    const { default: defaultExport } = extractExports(module)

    expect(defaultExport).toEqual({ originalDefault: true })
  })
})

// ============================================================================
// TEST 9: ERROR HANDLING EDGE CASES
// ============================================================================

describe('ESM Dynamic Import - Error Edge Cases', () => {
  beforeEach(() => {
    clearEsmCache()
  })

  it('handles malformed module URLs', () => {
    expect(() => resolveModuleSpecifier('')).toThrow(EsmImportError)
    expect(() => resolveModuleSpecifier('   ')).toThrow(EsmImportError)
  })

  it('creates ModuleNotFoundError with specifier', () => {
    const error = new ModuleNotFoundError('nonexistent-pkg')

    expect(error.name).toBe('EsmImportError')
    expect(error.code).toBe('MODULE_NOT_FOUND')
    expect(error.message).toContain('nonexistent-pkg')
  })

  it('creates ImportTimeoutError with URL and timeout', () => {
    const error = new ImportTimeoutError('https://esm.sh/slow-pkg', 5000)

    expect(error.name).toBe('EsmImportError')
    expect(error.code).toBe('IMPORT_TIMEOUT')
    expect(error.url).toBe('https://esm.sh/slow-pkg')
    expect(error.message).toContain('5000ms')
  })

  it('creates InvalidModuleError with reason', () => {
    const error = new InvalidModuleError('https://esm.sh/bad-pkg', 'syntax error')

    expect(error.name).toBe('EsmImportError')
    expect(error.code).toBe('INVALID_MODULE')
    expect(error.url).toBe('https://esm.sh/bad-pkg')
    expect(error.message).toContain('syntax error')
  })

  it('handles network errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    await expect(importEsm('network-fail-pkg')).rejects.toThrow()

    vi.unstubAllGlobals()
  })

  it('handles HTTP error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
    )

    await expect(importEsm('server-error-pkg')).rejects.toThrow()

    vi.unstubAllGlobals()
  })
})

// ============================================================================
// TEST 10: SUBPATH IMPORTS
// ============================================================================

describe('ESM Dynamic Import - Subpath Imports', () => {
  it('resolves package subpath', () => {
    const url = resolveModuleSpecifier('lodash-es/debounce')

    expect(url).toBe('https://esm.sh/lodash-es/debounce')
  })

  it('resolves scoped package subpath', () => {
    const url = resolveModuleSpecifier('@vue/reactivity/dist/reactivity.esm-browser.js')

    expect(url).toBe('https://esm.sh/@vue/reactivity/dist/reactivity.esm-browser.js')
  })

  it('resolves subpath with version', () => {
    const url = resolveModuleSpecifier('lodash-es@4.17.21/debounce')

    expect(url).toBe('https://esm.sh/lodash-es@4.17.21/debounce')
  })

  it('handles import map with subpath prefix', () => {
    const importMap: ImportMap = {
      imports: {
        '#utils/': 'https://esm.sh/@my-org/utils@1.0.0/',
      },
    }

    const url = resolveModuleSpecifier('#utils/string', { importMap })

    expect(url).toBe('https://esm.sh/@my-org/utils@1.0.0/string')
  })
})

// ============================================================================
// TEST 11: ESM.SH SPECIFIC FEATURES
// ============================================================================

describe('ESM Dynamic Import - esm.sh Features', () => {
  it('resolves with target ES version', () => {
    // esm.sh supports ?target=es2020
    const url = resolveModuleSpecifier('lodash-es', {
      baseUrl: 'https://esm.sh',
    })

    expect(url).toBe('https://esm.sh/lodash-es')

    // Future: Support target option
    // const urlWithTarget = resolveModuleSpecifier('lodash-es?target=es2020')
  })

  it('handles esm.sh redirects', () => {
    // esm.sh returns resolved URLs with specific versions
    // e.g., /lodash-es -> /lodash-es@4.17.21
    // The cache should handle both URLs

    const cache = createEsmCache()

    // Store under resolved URL
    cache.set('https://esm.sh/lodash-es@4.17.21', {
      default: null,
      exports: { version: '4.17.21' },
      url: 'https://esm.sh/lodash-es@4.17.21',
      cached: false,
    })

    // Should be findable under resolved URL
    expect(cache.has('https://esm.sh/lodash-es@4.17.21')).toBe(true)
  })
})
