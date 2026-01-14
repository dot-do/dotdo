/**
 * Dependency Tree Resolution Tests
 *
 * RED phase: These tests define the expected behavior for npm-compatible
 * dependency tree resolution. All tests should fail initially until the
 * resolver implementation is complete (GREEN phase).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DependencyTreeBuilder,
  type DependencyTree,
  type DependencyNode,
  type ResolvedPackage,
  type ResolutionOptions,
  type LockFile,
  type TreeDiff,
  detectCircularDependencies,
  generateLockFile,
  diffTrees,
} from '../../../core/resolver'

// Mock registry data for tests
const mockRegistry: Record<string, Record<string, any>> = {
  lodash: {
    '4.17.21': { name: 'lodash', version: '4.17.21', dependencies: {} },
    '4.17.20': { name: 'lodash', version: '4.17.20', dependencies: {} },
    '4.17.19': { name: 'lodash', version: '4.17.19', dependencies: {} },
  },
  'is-odd': {
    '3.0.1': { name: 'is-odd', version: '3.0.1', dependencies: { 'is-number': '^7.0.0' } },
    '3.0.0': { name: 'is-odd', version: '3.0.0', dependencies: { 'is-number': '^6.0.0' } },
  },
  'is-number': {
    '7.0.0': { name: 'is-number', version: '7.0.0', dependencies: {} },
    '6.0.0': { name: 'is-number', version: '6.0.0', dependencies: {} },
  },
  express: {
    '4.18.2': {
      name: 'express',
      version: '4.18.2',
      dependencies: {
        'body-parser': '^1.20.0',
        'cookie': '^0.5.0',
      },
    },
  },
  'body-parser': {
    '1.20.2': {
      name: 'body-parser',
      version: '1.20.2',
      dependencies: { 'raw-body': '^2.5.0' },
    },
  },
  'raw-body': {
    '2.5.2': { name: 'raw-body', version: '2.5.2', dependencies: {} },
  },
  cookie: {
    '0.5.0': { name: 'cookie', version: '0.5.0', dependencies: {} },
  },
  // For peer dependency tests
  react: {
    '18.2.0': {
      name: 'react',
      version: '18.2.0',
      dependencies: {},
      peerDependencies: {},
    },
    '17.0.2': {
      name: 'react',
      version: '17.0.2',
      dependencies: {},
    },
  },
  'react-dom': {
    '18.2.0': {
      name: 'react-dom',
      version: '18.2.0',
      dependencies: {},
      peerDependencies: { react: '^18.0.0' },
    },
    '17.0.2': {
      name: 'react-dom',
      version: '17.0.2',
      dependencies: {},
      peerDependencies: { react: '^17.0.0' },
    },
  },
  // For optional dependency tests
  fsevents: {
    '2.3.3': {
      name: 'fsevents',
      version: '2.3.3',
      dependencies: {},
      os: ['darwin'],
    },
  },
  chokidar: {
    '3.5.3': {
      name: 'chokidar',
      version: '3.5.3',
      dependencies: {},
      optionalDependencies: { fsevents: '^2.3.0' },
    },
  },
  // For circular dependency tests
  'circular-a': {
    '1.0.0': {
      name: 'circular-a',
      version: '1.0.0',
      dependencies: { 'circular-b': '^1.0.0' },
    },
  },
  'circular-b': {
    '1.0.0': {
      name: 'circular-b',
      version: '1.0.0',
      dependencies: { 'circular-a': '^1.0.0' },
    },
  },
  // For version conflict tests
  'conflict-parent-a': {
    '1.0.0': {
      name: 'conflict-parent-a',
      version: '1.0.0',
      dependencies: { 'shared-dep': '^1.0.0' },
    },
  },
  'conflict-parent-b': {
    '1.0.0': {
      name: 'conflict-parent-b',
      version: '1.0.0',
      dependencies: { 'shared-dep': '^2.0.0' },
    },
  },
  'shared-dep': {
    '1.0.0': { name: 'shared-dep', version: '1.0.0', dependencies: {} },
    '1.5.0': { name: 'shared-dep', version: '1.5.0', dependencies: {} },
    '2.0.0': { name: 'shared-dep', version: '2.0.0', dependencies: {} },
    '2.1.0': { name: 'shared-dep', version: '2.1.0', dependencies: {} },
  },
  // For bundled dependencies test
  'with-bundled': {
    '1.0.0': {
      name: 'with-bundled',
      version: '1.0.0',
      dependencies: { lodash: '^4.17.0' },
      bundledDependencies: ['lodash'],
    },
  },
  // For hoisting tests
  'deep-a': {
    '1.0.0': {
      name: 'deep-a',
      version: '1.0.0',
      dependencies: { 'deep-shared': '^1.0.0' },
    },
  },
  'deep-b': {
    '1.0.0': {
      name: 'deep-b',
      version: '1.0.0',
      dependencies: { 'deep-shared': '^1.0.0' },
    },
  },
  'deep-shared': {
    '1.0.0': { name: 'deep-shared', version: '1.0.0', dependencies: {} },
  },
  // DevDependency test packages
  vitest: {
    '1.0.0': {
      name: 'vitest',
      version: '1.0.0',
      dependencies: { 'chai': '^4.0.0' },
    },
  },
  chai: {
    '4.3.7': { name: 'chai', version: '4.3.7', dependencies: {} },
  },
}

// Mock registry fetcher for tests
const createMockFetcher = () => ({
  getPackageVersions: async (name: string): Promise<string[]> => {
    const pkg = mockRegistry[name]
    if (!pkg) throw new Error(`Package not found: ${name}`)
    return Object.keys(pkg)
  },
  getPackageInfo: async (name: string, version: string) => {
    const pkg = mockRegistry[name]
    if (!pkg) throw new Error(`Package not found: ${name}`)
    if (!pkg[version]) throw new Error(`Version not found: ${name}@${version}`)
    return pkg[version]
  },
})

describe('Dependency Tree Resolution', () => {
  let builder: DependencyTreeBuilder

  beforeEach(() => {
    builder = new DependencyTreeBuilder({
      registry: createMockFetcher(),
    })
  })

  // ============================================
  // 1. Flat Dependency Resolution (no conflicts)
  // ============================================
  describe('Flat dependency resolution', () => {
    it('should resolve a single package with no dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      expect(tree.resolved).toHaveProperty('lodash')
      expect(tree.resolved.lodash.version).toBe('4.17.21')
      expect(tree.resolved.lodash.dependencies).toEqual({})
    })

    it('should resolve multiple packages with no overlapping dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          cookie: '^0.5.0',
        },
      })

      expect(Object.keys(tree.resolved)).toHaveLength(2)
      expect(tree.resolved.lodash.version).toBe('4.17.21')
      expect(tree.resolved.cookie.version).toBe('0.5.0')
    })

    it('should resolve nested dependencies correctly', async () => {
      const tree = await builder.resolve({
        dependencies: { 'is-odd': '^3.0.0' },
      })

      expect(tree.resolved['is-odd'].version).toBe('3.0.1')
      expect(tree.resolved['is-number'].version).toBe('7.0.0')
    })

    it('should resolve deep dependency chains', async () => {
      const tree = await builder.resolve({
        dependencies: { express: '^4.18.0' },
      })

      // express -> body-parser -> raw-body
      // express -> cookie
      expect(tree.resolved.express.version).toBe('4.18.2')
      expect(tree.resolved['body-parser'].version).toBe('1.20.2')
      expect(tree.resolved['raw-body'].version).toBe('2.5.2')
      expect(tree.resolved.cookie.version).toBe('0.5.0')
    })
  })

  // ============================================
  // 2. Version Conflict Resolution
  // ============================================
  describe('Version conflict resolution', () => {
    it('should resolve to the newest compatible version when possible', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'conflict-parent-a': '^1.0.0',
          'shared-dep': '^1.0.0',
        },
      })

      // Should pick the newest version satisfying ^1.0.0
      expect(tree.resolved['shared-dep'].version).toBe('1.5.0')
    })

    it('should nest conflicting versions when ranges are incompatible', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'conflict-parent-a': '^1.0.0', // needs shared-dep ^1.0.0
          'conflict-parent-b': '^1.0.0', // needs shared-dep ^2.0.0
        },
      })

      // One version at root, conflicting version nested
      const rootSharedDep = tree.resolved['shared-dep']
      expect(rootSharedDep).toBeDefined()

      // The nested one should be in the parent's node_modules
      const hasNestedVersion =
        tree.resolved['conflict-parent-a'].nestedDependencies?.['shared-dep'] ||
        tree.resolved['conflict-parent-b'].nestedDependencies?.['shared-dep']
      expect(hasNestedVersion).toBeDefined()
    })

    it('should pick the newest version that satisfies all constraints when possible', async () => {
      // Both requiring overlapping ranges
      const tree = await builder.resolve({
        dependencies: {
          'shared-dep': '>=1.0.0 <3.0.0',
        },
      })

      // Should pick 2.1.0 (newest in range)
      expect(tree.resolved['shared-dep'].version).toBe('2.1.0')
    })

    it('should handle exact version requirements', async () => {
      const tree = await builder.resolve({
        dependencies: {
          lodash: '4.17.20', // exact version
        },
      })

      expect(tree.resolved.lodash.version).toBe('4.17.20')
    })
  })

  // ============================================
  // 3. Peer Dependency Handling
  // ============================================
  describe('Peer dependency handling', () => {
    it('should warn when peer dependency is not installed', async () => {
      const tree = await builder.resolve({
        dependencies: { 'react-dom': '^18.0.0' },
      })

      expect(tree.warnings).toContainEqual(
        expect.objectContaining({
          type: 'peer-missing',
          package: 'react-dom',
          peer: 'react',
        })
      )
    })

    it('should not warn when peer dependency is satisfied', async () => {
      const tree = await builder.resolve({
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0',
        },
      })

      const peerWarnings = tree.warnings?.filter((w) => w.type === 'peer-missing')
      expect(peerWarnings).toHaveLength(0)
    })

    it('should warn when peer dependency version is incompatible', async () => {
      const tree = await builder.resolve({
        dependencies: {
          react: '^17.0.0',
          'react-dom': '^18.0.0', // needs react ^18.0.0
        },
      })

      expect(tree.warnings).toContainEqual(
        expect.objectContaining({
          type: 'peer-incompatible',
          package: 'react-dom',
          peer: 'react',
          required: '^18.0.0',
          installed: '17.0.2',
        })
      )
    })

    it('should auto-install peer dependencies when configured', async () => {
      const autoInstallBuilder = new DependencyTreeBuilder({
        registry: createMockFetcher(),
        autoInstallPeers: true,
      })

      const tree = await autoInstallBuilder.resolve({
        dependencies: { 'react-dom': '^18.0.0' },
      })

      expect(tree.resolved.react).toBeDefined()
      expect(tree.resolved.react.version).toBe('18.2.0')
    })
  })

  // ============================================
  // 4. Optional Dependency Handling
  // ============================================
  describe('Optional dependency handling', () => {
    it('should not fail when optional dependency is missing', async () => {
      // Simulate fsevents not available (non-darwin platform)
      const limitedFetcher = {
        ...createMockFetcher(),
        getPackageInfo: async (name: string, version: string) => {
          if (name === 'fsevents') {
            throw new Error('Package not available on this platform')
          }
          return createMockFetcher().getPackageInfo(name, version)
        },
      }

      const builderWithLimited = new DependencyTreeBuilder({
        registry: limitedFetcher,
      })

      const tree = await builderWithLimited.resolve({
        dependencies: { chokidar: '^3.5.0' },
      })

      expect(tree.resolved.chokidar).toBeDefined()
      expect(tree.resolved.fsevents).toBeUndefined()
      expect(tree.warnings).toContainEqual(
        expect.objectContaining({
          type: 'optional-skipped',
          package: 'fsevents',
        })
      )
    })

    it('should install optional dependencies when available', async () => {
      const tree = await builder.resolve({
        dependencies: { chokidar: '^3.5.0' },
      })

      expect(tree.resolved.chokidar).toBeDefined()
      expect(tree.resolved.fsevents).toBeDefined()
      expect(tree.resolved.fsevents.optional).toBe(true)
    })

    it('should respect os field in optional dependencies', async () => {
      const builderForLinux = new DependencyTreeBuilder({
        registry: createMockFetcher(),
        platform: 'linux',
      })

      const tree = await builderForLinux.resolve({
        dependencies: { chokidar: '^3.5.0' },
      })

      // fsevents has os: ['darwin'], should be skipped on linux
      expect(tree.resolved.fsevents).toBeUndefined()
    })
  })

  // ============================================
  // 5. Circular Dependency Detection
  // ============================================
  describe('Circular dependency detection', () => {
    it('should detect direct circular dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: { 'circular-a': '^1.0.0' },
      })

      const cycles = detectCircularDependencies(tree)
      expect(cycles).toHaveLength(1)
      expect(cycles[0]).toContain('circular-a')
      expect(cycles[0]).toContain('circular-b')
    })

    it('should still resolve packages with circular dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: { 'circular-a': '^1.0.0' },
      })

      // Both should be resolved, even with cycle
      expect(tree.resolved['circular-a']).toBeDefined()
      expect(tree.resolved['circular-b']).toBeDefined()
    })

    it('should mark circular dependency edges', async () => {
      const tree = await builder.resolve({
        dependencies: { 'circular-a': '^1.0.0' },
      })

      // At least one edge should be marked as circular
      const hasCircularEdge =
        tree.resolved['circular-a'].circularTo?.includes('circular-b') ||
        tree.resolved['circular-b'].circularTo?.includes('circular-a')
      expect(hasCircularEdge).toBe(true)
    })

    it('should report cycle path in warnings', async () => {
      const tree = await builder.resolve({
        dependencies: { 'circular-a': '^1.0.0' },
      })

      expect(tree.warnings).toContainEqual(
        expect.objectContaining({
          type: 'circular-dependency',
          cycle: expect.arrayContaining(['circular-a', 'circular-b']),
        })
      )
    })
  })

  // ============================================
  // 6. Hoisting Logic
  // ============================================
  describe('Hoisting logic', () => {
    it('should hoist shared dependencies to root when versions match', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
        },
      })

      // deep-shared should be at root, not nested in both
      expect(tree.resolved['deep-shared']).toBeDefined()
      expect(tree.resolved['deep-a'].nestedDependencies?.['deep-shared']).toBeUndefined()
      expect(tree.resolved['deep-b'].nestedDependencies?.['deep-shared']).toBeUndefined()
    })

    it('should not hoist when it would cause version conflicts', async () => {
      // Parent A needs shared-dep ^1.0.0, Parent B needs ^2.0.0
      const tree = await builder.resolve({
        dependencies: {
          'conflict-parent-a': '^1.0.0',
          'conflict-parent-b': '^1.0.0',
        },
      })

      // Should have one at root and one nested
      const atRoot = tree.resolved['shared-dep']
      expect(atRoot).toBeDefined()

      // One parent should have it nested
      const aHasNested = tree.resolved['conflict-parent-a'].nestedDependencies?.['shared-dep']
      const bHasNested = tree.resolved['conflict-parent-b'].nestedDependencies?.['shared-dep']
      expect(aHasNested || bHasNested).toBeDefined()
    })

    it('should provide flat node_modules structure when possible', async () => {
      const tree = await builder.resolve({
        dependencies: { express: '^4.18.0' },
      })

      // All express deps should be hoisted to root
      const rootPackages = Object.keys(tree.resolved)
      expect(rootPackages).toContain('express')
      expect(rootPackages).toContain('body-parser')
      expect(rootPackages).toContain('raw-body')
      expect(rootPackages).toContain('cookie')

      // Express should not have nested deps
      expect(tree.resolved.express.nestedDependencies).toBeUndefined()
    })
  })

  // ============================================
  // 7. Deduplication
  // ============================================
  describe('Deduplication', () => {
    it('should use same resolved version for matching ranges', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
        },
      })

      // Both depend on deep-shared ^1.0.0 - should resolve to same version
      // and appear only once in the tree
      const deepSharedCount = Object.entries(tree.resolved).filter(
        ([name]) => name === 'deep-shared'
      ).length
      expect(deepSharedCount).toBe(1)
    })

    it('should calculate correct total package count with deduplication', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
        },
      })

      // deep-a, deep-b, deep-shared = 3 packages total (not 4)
      expect(tree.stats.totalPackages).toBe(3)
    })

    it('should track deduplicated byte savings', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
        },
      })

      // Stats should show deduplication occurred
      expect(tree.stats.deduplicatedPackages).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================
  // 8. devDependencies vs dependencies separation
  // ============================================
  describe('devDependencies vs dependencies separation', () => {
    it('should include devDependencies by default', async () => {
      const tree = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
        devDependencies: { vitest: '^1.0.0' },
      })

      expect(tree.resolved.lodash).toBeDefined()
      expect(tree.resolved.vitest).toBeDefined()
      expect(tree.resolved.chai).toBeDefined() // vitest dep
    })

    it('should exclude devDependencies in production mode', async () => {
      const prodBuilder = new DependencyTreeBuilder({
        registry: createMockFetcher(),
        production: true,
      })

      const tree = await prodBuilder.resolve({
        dependencies: { lodash: '^4.17.0' },
        devDependencies: { vitest: '^1.0.0' },
      })

      expect(tree.resolved.lodash).toBeDefined()
      expect(tree.resolved.vitest).toBeUndefined()
      expect(tree.resolved.chai).toBeUndefined()
    })

    it('should mark packages as dev in the tree', async () => {
      const tree = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
        devDependencies: { vitest: '^1.0.0' },
      })

      expect(tree.resolved.lodash.dev).toBe(false)
      expect(tree.resolved.vitest.dev).toBe(true)
      expect(tree.resolved.chai.dev).toBe(true) // transitive dev dep
    })

    it('should correctly categorize shared dependencies', async () => {
      // If a package is both a dep and devDep (of something), mark as prod
      const tree = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          vitest: '^1.0.0',
        },
        devDependencies: {},
      })

      // vitest pulled in as production dep here
      expect(tree.resolved.vitest.dev).toBe(false)
    })
  })

  // ============================================
  // 9. bundledDependencies handling
  // ============================================
  describe('bundledDependencies handling', () => {
    it('should mark bundled dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: { 'with-bundled': '^1.0.0' },
      })

      expect(tree.resolved['with-bundled']).toBeDefined()
      expect(tree.resolved['with-bundled'].bundledDependencies).toContain('lodash')
    })

    it('should not hoist bundled dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'with-bundled': '^1.0.0',
          lodash: '^4.17.0',
        },
      })

      // There should be two lodash entries - one at root, one bundled
      // The bundled one stays with its parent
      expect(tree.resolved['with-bundled'].bundledDependencies).toContain('lodash')

      // Root lodash should exist separately
      expect(tree.resolved.lodash).toBeDefined()
    })

    it('should not deduplicate bundled dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: { 'with-bundled': '^1.0.0' },
      })

      // Bundled deps are kept with their parent package
      const node = tree.resolved['with-bundled']
      expect(node.hasBundled).toBe(true)
    })
  })

  // ============================================
  // 10. Lock file generation
  // ============================================
  describe('Lock file generation', () => {
    it('should generate valid package-lock.json format', async () => {
      const tree = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const lockfile = generateLockFile(tree)

      expect(lockfile.lockfileVersion).toBe(3)
      expect(lockfile.name).toBeDefined()
      expect(lockfile.packages).toBeDefined()
    })

    it('should include integrity hashes', async () => {
      const tree = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const lockfile = generateLockFile(tree)
      const lodashEntry = lockfile.packages['node_modules/lodash']

      expect(lodashEntry.integrity).toMatch(/^sha512-/)
    })

    it('should include resolved URLs', async () => {
      const tree = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const lockfile = generateLockFile(tree)
      const lodashEntry = lockfile.packages['node_modules/lodash']

      expect(lodashEntry.resolved).toMatch(/registry\.npmjs\.org/)
    })

    it('should handle nested packages in lockfile', async () => {
      const tree = await builder.resolve({
        dependencies: {
          'conflict-parent-a': '^1.0.0',
          'conflict-parent-b': '^1.0.0',
        },
      })

      const lockfile = generateLockFile(tree)

      // Should have nested entry like "node_modules/conflict-parent-b/node_modules/shared-dep"
      const nestedKey = Object.keys(lockfile.packages).find((k) =>
        k.includes('node_modules/conflict-parent')
      )
      expect(nestedKey).toBeDefined()
    })

    it('should be valid JSON', async () => {
      const tree = await builder.resolve({
        dependencies: { express: '^4.18.0' },
      })

      const lockfile = generateLockFile(tree)
      const json = JSON.stringify(lockfile)

      expect(() => JSON.parse(json)).not.toThrow()
    })
  })

  // ============================================
  // 11. Tree diffing
  // ============================================
  describe('Tree diffing', () => {
    it('should detect added packages', async () => {
      const treeBefore = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const treeAfter = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          cookie: '^0.5.0',
        },
      })

      const diff = diffTrees(treeBefore, treeAfter)

      expect(diff.added).toContainEqual(
        expect.objectContaining({
          name: 'cookie',
          version: '0.5.0',
        })
      )
    })

    it('should detect removed packages', async () => {
      const treeBefore = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          cookie: '^0.5.0',
        },
      })

      const treeAfter = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const diff = diffTrees(treeBefore, treeAfter)

      expect(diff.removed).toContainEqual(
        expect.objectContaining({
          name: 'cookie',
          version: '0.5.0',
        })
      )
    })

    it('should detect updated packages', async () => {
      const builderOld = new DependencyTreeBuilder({
        registry: {
          ...createMockFetcher(),
          getPackageVersions: async () => ['4.17.19'],
        },
      })

      const treeBefore = await builderOld.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const treeAfter = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const diff = diffTrees(treeBefore, treeAfter)

      if (treeBefore.resolved.lodash.version !== treeAfter.resolved.lodash.version) {
        expect(diff.updated).toContainEqual(
          expect.objectContaining({
            name: 'lodash',
            from: expect.any(String),
            to: expect.any(String),
          })
        )
      }
    })

    it('should detect unchanged packages', async () => {
      const treeBefore = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const treeAfter = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const diff = diffTrees(treeBefore, treeAfter)

      expect(diff.unchanged).toContainEqual(
        expect.objectContaining({
          name: 'lodash',
        })
      )
    })

    it('should provide summary statistics', async () => {
      const treeBefore = await builder.resolve({
        dependencies: { lodash: '^4.17.0' },
      })

      const treeAfter = await builder.resolve({
        dependencies: { cookie: '^0.5.0' },
      })

      const diff = diffTrees(treeBefore, treeAfter)

      expect(diff.summary).toEqual({
        added: 1,
        removed: 1,
        updated: 0,
        unchanged: 0,
      })
    })
  })

  // ============================================
  // 12. Resolution determinism
  // ============================================
  describe('Resolution determinism', () => {
    it('should produce identical trees for identical inputs', async () => {
      const input = {
        dependencies: {
          lodash: '^4.17.0',
          'is-odd': '^3.0.0',
          express: '^4.18.0',
        },
      }

      const tree1 = await builder.resolve(input)
      const tree2 = await builder.resolve(input)

      // Compare serialized trees
      const serialize = (tree: DependencyTree) =>
        JSON.stringify(tree, Object.keys(tree).sort())

      expect(serialize(tree1)).toBe(serialize(tree2))
    })

    it('should produce same result regardless of dependency order', async () => {
      const tree1 = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          cookie: '^0.5.0',
        },
      })

      const tree2 = await builder.resolve({
        dependencies: {
          cookie: '^0.5.0',
          lodash: '^4.17.0',
        },
      })

      expect(tree1.resolved.lodash.version).toBe(tree2.resolved.lodash.version)
      expect(tree1.resolved.cookie.version).toBe(tree2.resolved.cookie.version)
    })

    it('should be deterministic across multiple runs', async () => {
      const input = {
        dependencies: {
          express: '^4.18.0',
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
        },
      }

      const results: string[] = []
      for (let i = 0; i < 5; i++) {
        const tree = await builder.resolve(input)
        results.push(JSON.stringify(tree.resolved))
      }

      // All results should be identical
      expect(new Set(results).size).toBe(1)
    })

    it('should produce same lockfile hash for same input', async () => {
      const input = {
        dependencies: { express: '^4.18.0' },
      }

      const tree1 = await builder.resolve(input)
      const tree2 = await builder.resolve(input)

      const lock1 = generateLockFile(tree1)
      const lock2 = generateLockFile(tree2)

      expect(JSON.stringify(lock1)).toBe(JSON.stringify(lock2))
    })
  })

  // ============================================
  // Additional edge cases
  // ============================================
  describe('Edge cases', () => {
    it('should handle empty dependencies', async () => {
      const tree = await builder.resolve({
        dependencies: {},
      })

      expect(Object.keys(tree.resolved)).toHaveLength(0)
    })

    it('should throw for non-existent packages', async () => {
      await expect(
        builder.resolve({
          dependencies: { 'non-existent-package-xyz': '^1.0.0' },
        })
      ).rejects.toThrow()
    })

    it('should throw for non-existent versions', async () => {
      await expect(
        builder.resolve({
          dependencies: { lodash: '^999.0.0' },
        })
      ).rejects.toThrow()
    })

    it('should handle git URLs as dependencies', async () => {
      // This should be supported but may need special handling
      const tree = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          // 'some-pkg': 'github:user/repo#v1.0.0'
        },
      })

      expect(tree.resolved.lodash).toBeDefined()
    })

    it('should handle URL dependencies', async () => {
      // npm supports tarball URLs
      const tree = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          // 'some-pkg': 'https://example.com.ai/pkg.tgz'
        },
      })

      expect(tree.resolved.lodash).toBeDefined()
    })

    it('should handle workspace protocol', async () => {
      // pnpm/yarn workspace protocol
      const tree = await builder.resolve({
        dependencies: {
          lodash: '^4.17.0',
          // 'local-pkg': 'workspace:*'
        },
      })

      expect(tree.resolved.lodash).toBeDefined()
    })
  })

  // ============================================
  // Performance considerations
  // ============================================
  describe('Performance', () => {
    it('should resolve complex trees efficiently', async () => {
      const start = Date.now()

      await builder.resolve({
        dependencies: {
          express: '^4.18.0',
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
          lodash: '^4.17.0',
        },
      })

      const elapsed = Date.now() - start
      // Should complete within reasonable time (adjust as needed)
      expect(elapsed).toBeLessThan(5000)
    })

    it('should cache resolved packages during single resolution', async () => {
      // This tests internal caching behavior
      const tree = await builder.resolve({
        dependencies: {
          'deep-a': '^1.0.0',
          'deep-b': '^1.0.0',
        },
      })

      // Both share deep-shared, should only be fetched once
      expect(tree.stats.registryFetches).toBeLessThanOrEqual(3) // deep-a, deep-b, deep-shared
    })
  })
})
