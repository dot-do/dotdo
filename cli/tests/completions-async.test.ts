/**
 * [RED] Tests for async file operations in completions.ts
 *
 * Issue: do-gtj1 - Fix sync require/fs calls in completions.ts
 *
 * The completions.ts file uses synchronous fs operations which block the event loop:
 * - fs.readFileSync (line 355)
 * - require() for dynamic imports (line 354)
 * - require.resolve() for path resolution (line 352)
 *
 * These tests verify that:
 * 1. No blocking fs calls exist in the completions module
 * 2. Completions still work correctly after conversion to async
 * 3. The module exports async-compatible APIs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CompletionEngine } from '../src/completions.js'

/**
 * Helper to detect if a function uses synchronous blocking patterns
 * by examining its string representation.
 *
 * This is a runtime-safe way to check for sync patterns without
 * needing filesystem access to read the source file.
 */
function hasSyncPattern(fn: Function, pattern: RegExp): boolean {
  const fnString = fn.toString()
  return pattern.test(fnString)
}

describe('completions.ts async compliance', () => {
  describe('sync operation detection via runtime analysis', () => {
    it('should NOT use readFileSync in createLanguageService', () => {
      // Get the CompletionEngine class and examine its methods
      const engine = new CompletionEngine()

      // Access the private createLanguageService method via the prototype
      const proto = Object.getPrototypeOf(engine)
      const createLSMethod = proto.createLanguageService

      if (createLSMethod) {
        const methodSource = createLSMethod.toString()

        // Check for sync patterns in the method
        // This test will FAIL because the current implementation uses:
        //   const fs = require('fs')
        //   fs.readFileSync(libPath, 'utf8')
        const hasReadFileSync =
          /readFileSync/.test(methodSource) || /require\s*\(\s*['"]fs['"]\s*\)/.test(methodSource)

        expect(hasReadFileSync).toBe(false)
      }

      engine.dispose()
    })

    it('should NOT use require.resolve in getScriptSnapshot logic', () => {
      const engine = new CompletionEngine()
      const proto = Object.getPrototypeOf(engine)
      const createLSMethod = proto.createLanguageService

      if (createLSMethod) {
        const methodSource = createLSMethod.toString()

        // Check for require.resolve which blocks while resolving module paths
        // This test will FAIL because the current implementation uses:
        //   require.resolve(`typescript/lib/${fileName.split('/').pop()}`)
        const hasRequireResolve = /require\.resolve/.test(methodSource)

        expect(hasRequireResolve).toBe(false)
      }

      engine.dispose()
    })

    it('should export libFileCache or preloaded lib files for async loading', () => {
      // After the fix, the module should expose a way to preload lib files
      // or cache them to avoid sync loading during completions

      const engine = new CompletionEngine()

      // Check if there's a lib cache or preload mechanism
      const hasLibCache =
        'libCache' in engine ||
        'preloadedLibs' in engine ||
        'libFiles' in engine ||
        (CompletionEngine as any).libCache !== undefined ||
        (CompletionEngine as any).preloadLibs !== undefined

      engine.dispose()

      // This test will FAIL until async conversion adds lib caching
      expect(hasLibCache).toBe(true)
    })
  })

  describe('async API requirements', () => {
    it('should export an async factory method for initialization', () => {
      // After conversion, CompletionEngine should have a static create() method
      // that returns Promise<CompletionEngine> to allow async lib loading

      const hasAsyncFactory =
        typeof (CompletionEngine as any).create === 'function' ||
        typeof (CompletionEngine as any).createAsync === 'function' ||
        typeof (CompletionEngine as any).init === 'function'

      // This test will FAIL until async conversion is complete
      expect(hasAsyncFactory).toBe(true)
    })

    it('should have async getCompletions or sync with pre-loaded libs', async () => {
      const engine = new CompletionEngine()

      // Option 1: getCompletions returns a Promise
      const completionsResult = engine.getCompletions('$.', 2)
      const isAsync = completionsResult instanceof Promise

      // Option 2: getCompletionsAsync exists
      const hasAsyncMethod = typeof (engine as any).getCompletionsAsync === 'function'

      // Option 3: libs are preloaded (check for preload method)
      const hasPreload =
        typeof (engine as any).preloadLibs === 'function' ||
        typeof (engine as any).warmup === 'function' ||
        typeof (engine as any).init === 'function'

      engine.dispose()

      // At least one async pattern should exist
      // This test will FAIL until one of these patterns is implemented
      expect(isAsync || hasAsyncMethod || hasPreload).toBe(true)
    })
  })

  describe('lib file loading behavior', () => {
    let engine: CompletionEngine

    beforeEach(() => {
      engine = new CompletionEngine()
    })

    afterEach(() => {
      engine.dispose()
    })

    it('should not block on first completion request', async () => {
      // Measure time for first completion request
      // If lib files are loaded synchronously, this will block
      const start = performance.now()

      // First completion - may trigger lib loading
      engine.getCompletions('const x: number[] = [1,2,3]; x.', 31)

      const firstDuration = performance.now() - start

      // Second completion - libs should be cached
      const secondStart = performance.now()
      engine.getCompletions('x.', 2)
      const secondDuration = performance.now() - secondStart

      // If sync loading happens, first request is significantly slower
      // After async fix, both should be fast (libs preloaded or loaded async)
      //
      // This test documents the current blocking behavior
      // It may pass intermittently but combined with other tests provides coverage
      //
      // With sync loading: first ~50-200ms, second ~1-5ms
      // With async/preload: both should be ~1-10ms

      // For the RED phase, we assert that there should be no significant
      // difference (indicating preloaded libs). This will FAIL with current sync loading.
      const ratio = firstDuration / Math.max(secondDuration, 0.1)

      // If libs are preloaded, ratio should be close to 1
      // If libs are loaded lazily+sync, ratio will be >> 1
      // Using threshold of 10 to account for CI/test environment variability
      expect(ratio).toBeLessThan(10)
    })

    it('should handle lib.es2022.d.ts without blocking getScriptSnapshot', () => {
      // This test verifies that ES2022 lib types are available
      // without synchronously reading files during getCompletions

      // Code that requires lib.es2022.d.ts for proper completions
      const code = `
const arr = [1, 2, 3];
const result = arr.at(0);
result.
`
      const position = code.indexOf('result.') + 7

      // If getScriptSnapshot blocks to load lib files, this is slow
      // After fix, libs should be preloaded or loaded async
      const completions = engine.getCompletions(code, position)

      // We should get number methods (toFixed, toString, etc.)
      // This verifies lib files were loaded successfully
      const names = completions.map((c) => c.name)

      // Even if this passes, the static analysis tests will catch the sync issue
      expect(names.length).toBeGreaterThan(0)
    })
  })

  describe('functional correctness after async conversion', () => {
    /**
     * These tests ensure completions still work correctly.
     * They should pass both before and after the async conversion.
     */

    let engine: CompletionEngine

    beforeEach(() => {
      engine = new CompletionEngine()
    })

    afterEach(() => {
      engine.dispose()
    })

    it('should provide $ context completions', () => {
      const completions = engine.getCompletions('$.', 2)

      expect(completions.length).toBeGreaterThan(0)
      const names = completions.map((c) => c.name)
      expect(names).toContain('send')
      expect(names).toContain('on')
      expect(names).toContain('every')
    })

    it('should provide console completions', () => {
      const completions = engine.getCompletions('console.', 8)

      const names = completions.map((c) => c.name)
      expect(names).toContain('log')
      expect(names).toContain('error')
    })

    it('should provide array method completions', () => {
      const completions = engine.getCompletions('[1,2,3].', 8)

      const names = completions.map((c) => c.name)
      expect(names).toContain('map')
      expect(names).toContain('filter')
      expect(names).toContain('reduce')
    })

    it('should still work after multiple rapid requests', async () => {
      // Simulate rapid completion requests that might race with async loading
      const results = await Promise.all([
        Promise.resolve(engine.getCompletions('$.', 2)),
        Promise.resolve(engine.getCompletions('console.', 8)),
        Promise.resolve(engine.getCompletions('[].', 3)),
      ])

      expect(results[0].length).toBeGreaterThan(0)
      expect(results[1].length).toBeGreaterThan(0)
      expect(results[2].length).toBeGreaterThan(0)
    })
  })
})

describe('blocking call evidence', () => {
  /**
   * These tests directly demonstrate the blocking behavior
   * by examining the CompletionEngine's internal implementation.
   */

  it('should NOT have require() calls in language service host', () => {
    const engine = new CompletionEngine()

    // The issue is in createLanguageService() which creates a host with getScriptSnapshot
    // that uses require('fs') and fs.readFileSync

    // Get the method source to examine
    const proto = Object.getPrototypeOf(engine)

    // Check all method sources for require patterns
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (name) => typeof proto[name] === 'function' && name !== 'constructor'
    )

    const methodsWithRequire: string[] = []

    for (const methodName of methodNames) {
      const methodSource = proto[methodName].toString()
      if (/require\s*\(/.test(methodSource)) {
        methodsWithRequire.push(methodName)
      }
    }

    engine.dispose()

    // This test will FAIL because createLanguageService has require('fs')
    expect(methodsWithRequire).toEqual([])
  })

  it('should document the exact blocking code location', () => {
    // This test serves as documentation of what needs to be fixed
    // It examines the actual method that contains the blocking calls

    const engine = new CompletionEngine()
    const proto = Object.getPrototypeOf(engine)
    const createLS = proto.createLanguageService

    if (createLS) {
      const source = createLS.toString()

      // Document the blocking patterns found
      const patterns = {
        hasRequireFs: /require\s*\(\s*['"]fs['"]\s*\)/.test(source),
        hasRequireResolve: /require\.resolve/.test(source),
        hasReadFileSync: /readFileSync/.test(source),
      }

      // Log for debugging (visible in test output)
      console.log('Blocking patterns in createLanguageService:', patterns)

      // This test will FAIL until all blocking patterns are removed
      expect(patterns.hasRequireFs).toBe(false)
      expect(patterns.hasRequireResolve).toBe(false)
      expect(patterns.hasReadFileSync).toBe(false)
    }

    engine.dispose()
  })
})
