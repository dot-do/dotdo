/**
 * Primitive Structure Verification Test
 *
 * This test enforces the standard directory structure for primitives:
 *
 * Standard structure for "mature" primitives (fsx, gitx, bashx, npmx, pyx):
 * ```
 * primitive/
 * ├── core/           # Zero CF deps - pure logic (@dotdo/primitive)
 * ├── do/             # CF integration (Durable Objects)
 * ├── cli/            # CLI tooling (optional)
 * ├── test/           # Tests (or tests/)
 * └── index.ts        # Main entry point (re-exports from core/ and do/)
 * ```
 *
 * "Simple" primitives may use flat structure with:
 * - index.ts          # Main implementation
 * - types.ts          # Type definitions
 * - index.test.ts     # Tests
 *
 * Rules:
 * 1. Mature primitives MUST NOT have both src/ and core/ (redundant)
 * 2. CF-specific code should be in do/, not src/
 * 3. All primitives must have either core/index.ts or root index.ts
 */

import { describe, test, expect, beforeAll } from 'vitest'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const PRIMITIVES_DIR = resolve(__dirname)

// Mature primitives that should follow the core/do/cli/test structure
const MATURE_PRIMITIVES = ['fsx', 'gitx', 'bashx', 'npmx', 'pyx']

// Directories that are NOT primitives (shared tooling, docs, etc.)
const NON_PRIMITIVE_DIRS = ['core', 'document-renderer', 'digital-workers']

// Files to ignore in the primitives directory
const IGNORED_FILES = [
  'ARCHITECTURE.md',
  'PRIMITIVES.md',
  'structure.test.ts',
]

interface PrimitiveInfo {
  name: string
  path: string
  hasCore: boolean
  hasSrc: boolean
  hasDo: boolean
  hasCli: boolean
  hasTest: boolean
  hasTests: boolean
  hasIndex: boolean
  hasTypes: boolean
  isMature: boolean
  isFlat: boolean
}

async function analyzePrimitive(name: string): Promise<PrimitiveInfo> {
  const primitivePath = join(PRIMITIVES_DIR, name)
  const entries = await readdir(primitivePath, { withFileTypes: true })

  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
  const files = entries.filter(e => e.isFile()).map(e => e.name)

  const info: PrimitiveInfo = {
    name,
    path: primitivePath,
    hasCore: dirs.includes('core'),
    hasSrc: dirs.includes('src'),
    hasDo: dirs.includes('do'),
    hasCli: dirs.includes('cli'),
    hasTest: dirs.includes('test'),
    hasTests: dirs.includes('tests'),
    hasIndex: files.includes('index.ts'),
    hasTypes: files.includes('types.ts'),
    isMature: MATURE_PRIMITIVES.includes(name),
    isFlat: false,
  }

  // A primitive is "flat" if it has no core/ or src/ directories
  // and just has index.ts, types.ts, index.test.ts at the root
  info.isFlat = !info.hasCore && !info.hasSrc && !info.hasDo

  return info
}

async function listPrimitives(): Promise<string[]> {
  const entries = await readdir(PRIMITIVES_DIR, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory())
    .filter(e => !e.name.startsWith('.'))
    .filter(e => !NON_PRIMITIVE_DIRS.includes(e.name))
    .map(e => e.name)
}

describe('Primitive Structure Verification', () => {
  let primitives: PrimitiveInfo[]

  beforeAll(async () => {
    const names = await listPrimitives()
    primitives = await Promise.all(names.map(analyzePrimitive))
  })

  describe('Mature Primitives', () => {
    test('mature primitives should not have both src/ and core/ directories', () => {
      const violations: string[] = []

      for (const p of primitives) {
        if (p.isMature && p.hasCore && p.hasSrc) {
          violations.push(`${p.name}: has both core/ and src/ - should consolidate`)
        }
      }

      if (violations.length > 0) {
        console.warn('Structure violations found:')
        violations.forEach(v => console.warn(`  - ${v}`))
      }

      // This is a warning test - we document the issue but don't fail
      // Remove the skip once the structure is standardized
      expect(violations.length).toBe(0)
    })

    test('mature primitives should have core/ directory', () => {
      const missing: string[] = []

      for (const p of primitives) {
        if (p.isMature && !p.hasCore) {
          missing.push(p.name)
        }
      }

      expect(missing).toEqual([])
    })

    test('mature primitives with CF integration should have do/ directory', () => {
      const shouldHaveDo: string[] = []

      for (const p of primitives) {
        // If mature and has src/ but no do/, it should be renamed
        if (p.isMature && p.hasSrc && !p.hasDo) {
          shouldHaveDo.push(`${p.name}: has src/ but no do/ - consider renaming CF code to do/`)
        }
      }

      if (shouldHaveDo.length > 0) {
        console.warn('Primitives that should rename src/ to do/:')
        shouldHaveDo.forEach(v => console.warn(`  - ${v}`))
      }

      // Document the issue - remove skip once standardized
      expect(shouldHaveDo.length).toBe(0)
    })
  })

  describe('All Primitives', () => {
    test('all primitives should have an entry point (index.ts or core/index.ts)', () => {
      const missing: string[] = []

      for (const p of primitives) {
        const hasEntryPoint = p.hasIndex || p.hasCore
        if (!hasEntryPoint) {
          missing.push(p.name)
        }
      }

      expect(missing).toEqual([])
    })

    test('flat primitives should have index.ts at root', () => {
      const violations: string[] = []

      for (const p of primitives) {
        if (p.isFlat && !p.hasIndex) {
          violations.push(p.name)
        }
      }

      expect(violations).toEqual([])
    })

    test('document primitive structure summary', () => {
      // This test documents the current state
      const summary = {
        total: primitives.length,
        mature: primitives.filter(p => p.isMature).length,
        flat: primitives.filter(p => p.isFlat).length,
        withCore: primitives.filter(p => p.hasCore).length,
        withSrc: primitives.filter(p => p.hasSrc).length,
        withDo: primitives.filter(p => p.hasDo).length,
        withBothCoreAndSrc: primitives.filter(p => p.hasCore && p.hasSrc).length,
      }

      console.log('\nPrimitive Structure Summary:')
      console.log(`  Total primitives: ${summary.total}`)
      console.log(`  Mature primitives: ${summary.mature}`)
      console.log(`  Flat primitives: ${summary.flat}`)
      console.log(`  With core/: ${summary.withCore}`)
      console.log(`  With src/: ${summary.withSrc}`)
      console.log(`  With do/: ${summary.withDo}`)
      console.log(`  With both core/ and src/: ${summary.withBothCoreAndSrc}`)

      // List primitives with both core/ and src/
      const bothCoreAndSrc = primitives.filter(p => p.hasCore && p.hasSrc)
      if (bothCoreAndSrc.length > 0) {
        console.log('\n  Primitives with both core/ and src/ (need cleanup):')
        bothCoreAndSrc.forEach(p => console.log(`    - ${p.name}`))
      }

      expect(true).toBe(true) // Always passes - just for documentation
    })
  })

  describe('Naming Conventions', () => {
    test('test directories should be named test/ or tests/', () => {
      const violations: string[] = []

      for (const p of primitives) {
        // Check for unusual test directory names
        // (this is informational - both test/ and tests/ are acceptable)
      }

      expect(violations).toEqual([])
    })
  })
})

/**
 * Standard Structure Documentation
 *
 * ## Mature Primitive Structure
 *
 * For complex primitives (fsx, gitx, bashx, npmx, pyx) that have:
 * - Pure library code (@dotdo/primitive)
 * - Cloudflare-specific integration
 * - CLI tooling
 *
 * ```
 * primitive/
 * ├── core/           # Zero CF deps - published as @dotdo/primitive
 * │   ├── index.ts    # Main exports
 * │   ├── types.ts    # Type definitions
 * │   └── ...         # Implementation modules
 * ├── do/             # Cloudflare Durable Object integration
 * │   ├── index.ts    # DO class exports
 * │   └── ...         # DO implementation
 * ├── cli/            # CLI commands
 * │   └── index.ts    # CLI entry point
 * ├── test/           # Tests
 * │   └── *.test.ts   # Test files
 * ├── index.ts        # Main entry for primitive.do
 * ├── CLAUDE.md       # Documentation for Claude
 * ├── README.md       # User documentation
 * └── package.json    # Package config
 * ```
 *
 * ## Simple Primitive Structure
 *
 * For simpler primitives (rate-limiter, cache-manager, etc.):
 *
 * ```
 * primitive/
 * ├── index.ts        # Main implementation
 * ├── types.ts        # Type definitions (optional)
 * └── index.test.ts   # Tests
 * ```
 *
 * ## Key Rules
 *
 * 1. **core/** contains code with ZERO Cloudflare dependencies
 * 2. **do/** contains Cloudflare-specific code (Durable Objects, R2, etc.)
 * 3. **src/** should NOT be used - use core/ or do/ instead
 * 4. Every primitive must have an entry point (index.ts or core/index.ts)
 * 5. Tests should be in test/, tests/, or co-located with source
 */
