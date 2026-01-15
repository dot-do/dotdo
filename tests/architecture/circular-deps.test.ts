/**
 * Circular Dependency Detection Tests
 *
 * These tests use madge to detect circular dependencies in the codebase.
 * Circular dependencies cause:
 * - Runtime initialization issues (undefined imports)
 * - Increased bundle size
 * - Harder-to-reason-about code
 * - Potential memory leaks
 *
 * Architecture rules enforced:
 * 1. No circular dependencies within any module
 * 2. No cross-layer dependencies (lib -> objects is forbidden)
 * 3. types/ should have no cycles (it's foundational)
 *
 * Known issues from architecture review (18 circular dependencies):
 * - db/graph/analytics.ts <-> db/graph/index.ts
 * - types/Things.ts <-> types/Thing.ts
 * - lib/executors/ParallelStepExecutor.ts <-> objects/execution/WorkflowRuntime.ts (cross-layer!)
 *
 * @module tests/architecture/circular-deps
 */

import { describe, it, expect } from 'vitest'
import madge from 'madge'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

// Helper to run madge with consistent options
async function analyzeDirectory(dir: string) {
  return madge(path.join(ROOT, dir), {
    fileExtensions: ['ts', 'tsx'],
    excludeRegExp: [
      /\.test\.ts$/,
      /\.test\.tsx$/,
      /\.spec\.ts$/,
      /\.d\.ts$/,
      /node_modules/,
      /__tests__/,
      /tests\//,
    ],
    tsConfig: path.join(ROOT, 'tsconfig.json'),
  })
}

// Helper to format circular dependencies for readable error messages
function formatCircular(circular: string[][]): string {
  if (circular.length === 0) return 'No circular dependencies'
  return circular
    .map((cycle, i) => `  ${i + 1}. ${cycle.join(' -> ')} -> ${cycle[0]}`)
    .join('\n')
}

describe('Circular Dependencies', () => {
  describe('Critical Directories (must be cycle-free)', () => {
    it('should have no circular dependencies in types/', async () => {
      const result = await analyzeDirectory('types')
      const circular = result.circular()

      // This should FAIL - we know types/Things.ts <-> types/Thing.ts exists
      expect(circular, `Found circular dependencies:\n${formatCircular(circular)}`).toEqual([])
    }, 30000)

    it('should have no circular dependencies in objects/core/', async () => {
      const result = await analyzeDirectory('objects')
      const circular = result.circular()

      expect(circular, `Found circular dependencies:\n${formatCircular(circular)}`).toEqual([])
    }, 30000)

    it('should have no circular dependencies in db/graph/', async () => {
      const result = await analyzeDirectory('db/graph')
      const circular = result.circular()

      // This should FAIL - we know db/graph/analytics.ts <-> db/graph/index.ts exists
      expect(circular, `Found circular dependencies:\n${formatCircular(circular)}`).toEqual([])
    }, 30000)
  })

  describe('Cross-Layer Dependencies', () => {
    it('should not have lib -> objects imports (lib depends on objects is forbidden)', async () => {
      const result = await analyzeDirectory('lib')
      const deps = result.obj()

      const violations: Array<{ file: string; imports: string[] }> = []

      for (const [file, imports] of Object.entries(deps)) {
        const objectsImports = (imports as string[]).filter(
          (i) => i.includes('objects/') || i.startsWith('../objects') || i.startsWith('../../objects')
        )
        if (objectsImports.length > 0) {
          violations.push({ file, imports: objectsImports })
        }
      }

      const message = violations
        .map((v) => `  ${v.file}:\n    ${v.imports.map((i) => `-> ${i}`).join('\n    ')}`)
        .join('\n')

      // This should FAIL - we know lib/executors/ParallelStepExecutor.ts -> objects/execution/WorkflowRuntime.ts
      expect(violations, `Cross-layer violations (lib -> objects):\n${message}`).toEqual([])
    }, 30000)

    it('should not have types -> objects imports (types is foundational)', async () => {
      const result = await analyzeDirectory('types')
      const deps = result.obj()

      const violations: Array<{ file: string; imports: string[] }> = []

      for (const [file, imports] of Object.entries(deps)) {
        const objectsImports = (imports as string[]).filter(
          (i) => i.includes('objects/') || i.startsWith('../objects') || i.startsWith('../../objects')
        )
        if (objectsImports.length > 0) {
          violations.push({ file, imports: objectsImports })
        }
      }

      const message = violations
        .map((v) => `  ${v.file}:\n    ${v.imports.map((i) => `-> ${i}`).join('\n    ')}`)
        .join('\n')

      expect(violations, `Cross-layer violations (types -> objects):\n${message}`).toEqual([])
    }, 30000)

    it('should not have types -> lib imports (types is foundational)', async () => {
      const result = await analyzeDirectory('types')
      const deps = result.obj()

      const violations: Array<{ file: string; imports: string[] }> = []

      for (const [file, imports] of Object.entries(deps)) {
        const libImports = (imports as string[]).filter(
          (i) => i.includes('lib/') || i.startsWith('../lib') || i.startsWith('../../lib')
        )
        if (libImports.length > 0) {
          violations.push({ file, imports: libImports })
        }
      }

      const message = violations
        .map((v) => `  ${v.file}:\n    ${v.imports.map((i) => `-> ${i}`).join('\n    ')}`)
        .join('\n')

      expect(violations, `Cross-layer violations (types -> lib):\n${message}`).toEqual([])
    }, 30000)
  })

  describe('Module-Level Cycles', () => {
    it('should have no circular dependencies in lib/executors/', async () => {
      const result = await analyzeDirectory('lib/executors')
      const circular = result.circular()

      expect(circular, `Found circular dependencies:\n${formatCircular(circular)}`).toEqual([])
    }, 30000)

    it('should have no circular dependencies in workflows/', async () => {
      const result = await analyzeDirectory('workflows')
      const circular = result.circular()

      expect(circular, `Found circular dependencies:\n${formatCircular(circular)}`).toEqual([])
    }, 30000)

    it('should have no circular dependencies in api/', async () => {
      const result = await analyzeDirectory('api')
      const circular = result.circular()

      expect(circular, `Found circular dependencies:\n${formatCircular(circular)}`).toEqual([])
    }, 30000)
  })

  describe('Summary Statistics', () => {
    it('should report total circular dependency count across critical directories', async () => {
      const directories = ['types', 'objects', 'lib', 'db/graph', 'workflows', 'api']
      const allCircular: Array<{ dir: string; cycles: string[][] }> = []

      for (const dir of directories) {
        try {
          const result = await analyzeDirectory(dir)
          const circular = result.circular()
          if (circular.length > 0) {
            allCircular.push({ dir, cycles: circular })
          }
        } catch {
          // Directory may not exist or have issues - skip
        }
      }

      const totalCycles = allCircular.reduce((sum, item) => sum + item.cycles.length, 0)

      const report = allCircular
        .map(({ dir, cycles }) => `${dir}:\n${formatCircular(cycles)}`)
        .join('\n\n')

      // This test documents the current state - it should FAIL showing all cycles
      expect(
        totalCycles,
        `Total circular dependencies found: ${totalCycles}\n\n${report}`
      ).toBe(0)
    }, 120000)
  })
})
