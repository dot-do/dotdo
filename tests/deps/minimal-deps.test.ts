/**
 * Minimal Runtime Dependencies Tests
 *
 * RED phase tests that verify the project uses minimal runtime dependencies.
 * These tests should FAIL initially to demonstrate the need for dependency optimization.
 *
 * Principles enforced:
 * 1. Runtime dependencies should be minimal for edge deployment
 * 2. No large dependencies (>500KB) in runtime bundles
 * 3. No duplicate dependencies across packages
 * 4. Peer dependencies must be correctly specified
 * 5. devDependencies must not leak into production bundles
 *
 * Why minimal deps matter for edge:
 * - Cold start times directly correlate with bundle size
 * - Cloudflare Workers have 1MB compressed limit
 * - Memory constraints on edge (128MB default)
 * - Network transfer costs
 *
 * @module tests/deps/minimal-deps
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../..')

// Package.json type definition
interface PackageJson {
  name: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  bundleDependencies?: string[]
  optionalDependencies?: Record<string, string>
}

// Known large dependencies that should be avoided in runtime
// These add significant bundle size and cold start latency
const LARGE_DEPENDENCIES = [
  'lodash', // Use lodash-es or native
  'moment', // Use date-fns or dayjs
  'axios', // Use native fetch
  '@aws-sdk', // AWS SDK v3 is tree-shakeable but still large
  'aws-sdk', // AWS SDK v2 is huge
  'typescript', // Should be devDep only
  'webpack', // Build tool, not runtime
  'esbuild', // Build tool, not runtime
  'tsup', // Build tool, not runtime
  'vite', // Build tool, not runtime
  'vitest', // Test tool, not runtime
  'jest', // Test tool, not runtime
  'prettier', // Formatter, not runtime
  'eslint', // Linter, not runtime
  '@types/', // Type definitions, not runtime
  'tsc', // TypeScript compiler, not runtime
  'playwright', // Test tool, not runtime
  '@playwright', // Test tool, not runtime
  '@testing-library', // Test tool, not runtime
  'jsdom', // Test tool, not runtime
  '@babel', // Build tool, not runtime
  'rollup', // Build tool, not runtime
  'postcss', // Build tool, not runtime
  'autoprefixer', // Build tool, not runtime
  'tailwindcss', // Should be build-time only
  'sass', // Build tool, not runtime
  'less', // Build tool, not runtime
]

// Dependency size thresholds (in KB for typical bundle)
const SIZE_THRESHOLDS = {
  maxSingleDepSizeKB: 500, // No single dep should add more than 500KB
  maxTotalDepsKB: 2000, // Total runtime deps should be under 2MB
}

// Maximum number of runtime dependencies for lightweight packages
const MAX_DEPS_THRESHOLDS = {
  root: 20, // Root package can have more deps (includes app dependencies)
  packages: 5, // Published packages should have minimal deps
  core: 3, // Core package should be extremely minimal
}

// Helper to read package.json
function readPackageJson(dir: string): PackageJson | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  return JSON.parse(readFileSync(pkgPath, 'utf-8'))
}

// Helper to get all package directories
function getPackageDirectories(): string[] {
  const packagesDir = join(ROOT, 'packages')
  if (!existsSync(packagesDir)) return []
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
}

// Helper to count runtime dependencies
function countRuntimeDeps(pkg: PackageJson): number {
  return Object.keys(pkg.dependencies || {}).length
}

// Helper to get all dependencies with their sources
function getAllDependencies(): Map<string, Set<string>> {
  const depMap = new Map<string, Set<string>>()

  // Root package
  const rootPkg = readPackageJson(ROOT)
  if (rootPkg?.dependencies) {
    for (const dep of Object.keys(rootPkg.dependencies)) {
      if (!depMap.has(dep)) depMap.set(dep, new Set())
      depMap.get(dep)!.add('root')
    }
  }

  // All packages
  for (const pkgDir of getPackageDirectories()) {
    const pkg = readPackageJson(pkgDir)
    if (pkg?.dependencies) {
      for (const dep of Object.keys(pkg.dependencies)) {
        if (!depMap.has(dep)) depMap.set(dep, new Set())
        depMap.get(dep)!.add(pkg.name)
      }
    }
  }

  return depMap
}

describe('Minimal Runtime Dependencies', () => {
  let rootPkg: PackageJson
  let packageDirs: string[]

  beforeAll(() => {
    const pkg = readPackageJson(ROOT)
    if (!pkg) throw new Error('Could not read root package.json')
    rootPkg = pkg
    packageDirs = getPackageDirectories()
  })

  describe('Dependency Count Thresholds', () => {
    it('should have fewer than threshold runtime dependencies in root package', () => {
      const depCount = countRuntimeDeps(rootPkg)
      // This test should FAIL - root has many dependencies
      expect(
        depCount,
        `Root package has ${depCount} runtime dependencies, expected < ${MAX_DEPS_THRESHOLDS.root}`
      ).toBeLessThan(MAX_DEPS_THRESHOLDS.root)
    })

    it('should have fewer than threshold runtime dependencies in published packages', () => {
      const violations: Array<{ name: string; count: number }> = []

      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg) continue

        const depCount = countRuntimeDeps(pkg)
        if (depCount > MAX_DEPS_THRESHOLDS.packages) {
          violations.push({ name: pkg.name, count: depCount })
        }
      }

      const message = violations
        .map((v) => `  ${v.name}: ${v.count} deps (max: ${MAX_DEPS_THRESHOLDS.packages})`)
        .join('\n')

      // This test should FAIL if any package has too many deps
      expect(violations, `Packages with too many runtime deps:\n${message}`).toEqual([])
    })

    it('should have fewer than threshold runtime dependencies in @dotdo/core', () => {
      const corePkg = readPackageJson(join(ROOT, 'core'))
      if (!corePkg) {
        // Core package not found
        return
      }

      const depCount = countRuntimeDeps(corePkg)
      // Core should be extremely minimal
      expect(
        depCount,
        `@dotdo/core has ${depCount} runtime dependencies, expected < ${MAX_DEPS_THRESHOLDS.core}`
      ).toBeLessThan(MAX_DEPS_THRESHOLDS.core)
    })
  })

  describe('Large Dependencies Detection', () => {
    it('should not have known large dependencies in runtime', () => {
      const violations: Array<{ pkg: string; dep: string; category: string }> = []

      // Check root
      const rootDeps = Object.keys(rootPkg.dependencies || {})
      for (const dep of rootDeps) {
        for (const largeDep of LARGE_DEPENDENCIES) {
          if (dep.startsWith(largeDep) || dep === largeDep) {
            violations.push({
              pkg: 'root',
              dep,
              category: largeDep.includes('@types') ? 'type-definitions' : 'large-bundle',
            })
          }
        }
      }

      // Check packages
      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg?.dependencies) continue

        for (const dep of Object.keys(pkg.dependencies)) {
          for (const largeDep of LARGE_DEPENDENCIES) {
            if (dep.startsWith(largeDep) || dep === largeDep) {
              violations.push({
                pkg: pkg.name,
                dep,
                category: largeDep.includes('@types') ? 'type-definitions' : 'large-bundle',
              })
            }
          }
        }
      }

      const message = violations.map((v) => `  ${v.pkg} -> ${v.dep} (${v.category})`).join('\n')

      // This test should FAIL if large deps are found
      expect(violations, `Large dependencies found in runtime:\n${message}`).toEqual([])
    })

    it('should not have build tools in runtime dependencies', () => {
      const buildTools = [
        'tsup',
        'typescript',
        'vite',
        'vitest',
        'webpack',
        'esbuild',
        'rollup',
        'jest',
        'prettier',
        'eslint',
        'tsc',
      ]

      const violations: Array<{ pkg: string; dep: string }> = []

      // Check root
      for (const dep of Object.keys(rootPkg.dependencies || {})) {
        if (buildTools.some((tool) => dep === tool || dep.startsWith(`@${tool}`) || dep.startsWith(`${tool}-`))) {
          violations.push({ pkg: 'root', dep })
        }
      }

      // Check packages
      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg?.dependencies) continue

        for (const dep of Object.keys(pkg.dependencies)) {
          if (buildTools.some((tool) => dep === tool || dep.startsWith(`@${tool}`) || dep.startsWith(`${tool}-`))) {
            violations.push({ pkg: pkg.name, dep })
          }
        }
      }

      const message = violations.map((v) => `  ${v.pkg} -> ${v.dep}`).join('\n')

      expect(violations, `Build tools found in runtime dependencies:\n${message}`).toEqual([])
    })
  })

  describe('Duplicate Dependencies Detection', () => {
    it('should not have duplicate dependencies across packages', () => {
      const allDeps = getAllDependencies()
      const duplicates: Array<{ dep: string; packages: string[] }> = []

      for (const [dep, packages] of allDeps) {
        // Skip workspace dependencies
        if (dep.startsWith('workspace:') || dep.startsWith('@dotdo/')) continue
        // Skip if only in one package
        if (packages.size <= 1) continue

        const pkgList = Array.from(packages)
        // If a dep is in both root and a package, it may be intentional
        // Flag only if in multiple non-root packages
        const nonRootPkgs = pkgList.filter((p) => p !== 'root')
        if (nonRootPkgs.length > 1) {
          duplicates.push({ dep, packages: pkgList })
        }
      }

      const message = duplicates.map((d) => `  ${d.dep}: used in [${d.packages.join(', ')}]`).join('\n')

      // This test documents duplicate deps - may or may not fail
      // Duplicates aren't necessarily bad if versions match
      if (duplicates.length > 0) {
        console.log(`Note: Found ${duplicates.length} dependencies used in multiple packages:\n${message}`)
      }

      // Allow some duplication for common utilities
      expect(duplicates.length, `Too many duplicate dependencies:\n${message}`).toBeLessThan(10)
    })

    it('should have consistent dependency versions across packages', () => {
      const versionMap = new Map<string, Map<string, string>>() // dep -> pkg -> version

      // Root
      if (rootPkg.dependencies) {
        for (const [dep, version] of Object.entries(rootPkg.dependencies)) {
          if (!versionMap.has(dep)) versionMap.set(dep, new Map())
          versionMap.get(dep)!.set('root', version)
        }
      }

      // Packages
      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg?.dependencies) continue

        for (const [dep, version] of Object.entries(pkg.dependencies)) {
          if (!versionMap.has(dep)) versionMap.set(dep, new Map())
          versionMap.get(dep)!.set(pkg.name, version)
        }
      }

      const inconsistencies: Array<{ dep: string; versions: Array<{ pkg: string; version: string }> }> = []

      for (const [dep, pkgVersions] of versionMap) {
        // Skip workspace deps
        if (Array.from(pkgVersions.values()).some((v) => v.startsWith('workspace:'))) continue

        const uniqueVersions = new Set(pkgVersions.values())
        if (uniqueVersions.size > 1) {
          inconsistencies.push({
            dep,
            versions: Array.from(pkgVersions.entries()).map(([pkg, version]) => ({ pkg, version })),
          })
        }
      }

      const message = inconsistencies
        .map((i) => `  ${i.dep}:\n    ${i.versions.map((v) => `${v.pkg}: ${v.version}`).join('\n    ')}`)
        .join('\n')

      expect(inconsistencies, `Inconsistent dependency versions:\n${message}`).toEqual([])
    })
  })

  describe('Peer Dependencies Validation', () => {
    it('should have required peer dependencies correctly specified', () => {
      const issues: Array<{ pkg: string; issue: string }> = []

      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg) continue

        const deps = pkg.dependencies || {}
        const peerDeps = pkg.peerDependencies || {}

        // Packages using React should have react as peerDependency
        const usesReact = Object.keys(deps).some(
          (d) => d.includes('react') || d.includes('@tanstack/react') || d.includes('recharts')
        )
        if (usesReact && !peerDeps['react']) {
          issues.push({
            pkg: pkg.name,
            issue: 'Uses React but does not specify react as peerDependency',
          })
        }

        // Packages using zod should have zod as peerDependency (not dependency)
        // Exception: if it's a types-only package
        if (deps['zod'] && !pkg.name.includes('types')) {
          issues.push({
            pkg: pkg.name,
            issue: 'Has zod as dependency but should be peerDependency',
          })
        }
      }

      const message = issues.map((i) => `  ${i.pkg}: ${i.issue}`).join('\n')

      // This test may fail depending on package design decisions
      expect(issues, `Peer dependency issues:\n${message}`).toEqual([])
    })

    it('should not have devDependencies in production runtime', () => {
      const devDepsInProd: Array<{ pkg: string; dep: string }> = []

      // Check if any devDependencies are also in dependencies (which would be a mistake)
      const check = (pkg: PackageJson, pkgName: string) => {
        const deps = Object.keys(pkg.dependencies || {})
        const devDeps = Object.keys(pkg.devDependencies || {})

        for (const devDep of devDeps) {
          if (deps.includes(devDep)) {
            devDepsInProd.push({ pkg: pkgName, dep: devDep })
          }
        }
      }

      check(rootPkg, 'root')
      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (pkg) check(pkg, pkg.name)
      }

      const message = devDepsInProd.map((d) => `  ${d.pkg} -> ${d.dep}`).join('\n')

      expect(devDepsInProd, `Dependencies duplicated in both deps and devDeps:\n${message}`).toEqual([])
    })
  })

  describe('Edge Runtime Compatibility', () => {
    it('should not have Node.js-specific dependencies in edge packages', () => {
      // Dependencies that require Node.js APIs and won't work on edge
      const nodeOnlyDeps = [
        'fs-extra',
        'glob',
        'chokidar',
        'node-fetch', // Use native fetch
        'child_process',
        'cluster',
        'readline',
        'repl',
        'vm',
        'worker_threads',
        'better-sqlite3', // Node-only SQLite
        'sqlite3', // Node-only SQLite
        'pg', // PostgreSQL native driver
        'mysql', // MySQL native driver
        'mongodb', // MongoDB native driver
        'ioredis', // Redis native driver
        'redis', // Redis native driver
        'express', // Node-only server
        'fastify', // Node-only server
        'koa', // Node-only server
      ]

      const violations: Array<{ pkg: string; dep: string }> = []

      // Only check published packages (packages/*)
      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg?.dependencies) continue

        for (const dep of Object.keys(pkg.dependencies)) {
          if (nodeOnlyDeps.includes(dep)) {
            violations.push({ pkg: pkg.name, dep })
          }
        }
      }

      const message = violations.map((v) => `  ${v.pkg} -> ${v.dep}`).join('\n')

      expect(violations, `Node.js-only dependencies found in edge packages:\n${message}`).toEqual([])
    })

    it('should use Cloudflare-compatible alternatives', () => {
      // Map of problematic deps to their edge-compatible alternatives
      const alternatives: Record<string, string> = {
        axios: 'native fetch',
        'node-fetch': 'native fetch',
        lodash: 'lodash-es or native methods',
        moment: 'dayjs or date-fns',
        uuid: 'crypto.randomUUID()',
        'better-sqlite3': '@cloudflare/d1',
        pg: '@neon/serverless or @cloudflare/hyperdrive',
        'aws-sdk': '@aws-sdk/client-* (v3, tree-shakeable)',
      }

      const violations: Array<{ pkg: string; dep: string; alternative: string }> = []

      // Check packages
      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg?.dependencies) continue

        for (const dep of Object.keys(pkg.dependencies)) {
          if (alternatives[dep]) {
            violations.push({
              pkg: pkg.name,
              dep,
              alternative: alternatives[dep],
            })
          }
        }
      }

      const message = violations.map((v) => `  ${v.pkg}: ${v.dep} -> use ${v.alternative}`).join('\n')

      expect(violations, `Dependencies with better edge alternatives:\n${message}`).toEqual([])
    })
  })

  describe('Dependency Hygiene', () => {
    it('should not have unused workspace dependencies', () => {
      // This is a documentation test - actual unused dep detection requires bundle analysis
      // Check for dependencies that use workspace: protocol in their version
      const workspaceDeps = Object.entries(rootPkg.dependencies || {})
        .filter(([, version]) => (version as string).includes('workspace:'))
        .map(([name]) => name)

      // Workspace deps should be used somewhere
      expect(workspaceDeps.length, 'No workspace dependencies found').toBeGreaterThan(0)
    })

    it('should have sideEffects: false for tree-shakeable packages', () => {
      const missingMark: string[] = []

      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir) as PackageJson & { sideEffects?: boolean | string[] }
        if (!pkg) continue

        // Published packages should be tree-shakeable
        if (pkg.sideEffects !== false) {
          missingMark.push(pkg.name)
        }
      }

      const message = missingMark.join('\n  ')

      // This test encourages tree-shakeability
      expect(missingMark, `Packages missing sideEffects: false:\n  ${message}`).toEqual([])
    })

    it('should have explicit exports field for proper ESM support', () => {
      const missingExports: string[] = []

      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir) as PackageJson & { exports?: Record<string, unknown> }
        if (!pkg) continue

        if (!pkg.exports) {
          missingExports.push(pkg.name)
        }
      }

      const message = missingExports.join('\n  ')

      expect(missingExports, `Packages missing exports field:\n  ${message}`).toEqual([])
    })
  })

  describe('Summary Report', () => {
    it('should generate dependency health report', () => {
      const report = {
        rootDeps: countRuntimeDeps(rootPkg),
        rootDevDeps: Object.keys(rootPkg.devDependencies || {}).length,
        packages: [] as Array<{
          name: string
          deps: number
          devDeps: number
          hasPeerDeps: boolean
        }>,
      }

      for (const pkgDir of packageDirs) {
        const pkg = readPackageJson(pkgDir)
        if (!pkg) continue

        report.packages.push({
          name: pkg.name,
          deps: countRuntimeDeps(pkg),
          devDeps: Object.keys(pkg.devDependencies || {}).length,
          hasPeerDeps: Object.keys(pkg.peerDependencies || {}).length > 0,
        })
      }

      // Sort by dependency count
      report.packages.sort((a, b) => b.deps - a.deps)

      console.log('\n=== Dependency Health Report ===')
      console.log(`Root: ${report.rootDeps} runtime deps, ${report.rootDevDeps} dev deps`)
      console.log('\nPackages by dependency count:')
      for (const pkg of report.packages) {
        console.log(`  ${pkg.name}: ${pkg.deps} deps, ${pkg.devDeps} devDeps, peerDeps: ${pkg.hasPeerDeps}`)
      }

      // This test always passes but generates a report
      // Set to fail if total deps exceed threshold
      const totalPackageDeps = report.packages.reduce((sum, p) => sum + p.deps, 0)
      const threshold = 20 // Total across all packages

      expect(
        totalPackageDeps,
        `Total runtime deps across packages: ${totalPackageDeps}, expected < ${threshold}`
      ).toBeLessThan(threshold)
    })
  })
})
