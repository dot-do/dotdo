/**
 * Package Exports Tests (RED Phase - TDD)
 *
 * Issue: dotdo-gjezd
 *
 * These tests verify that the npm package is correctly configured for:
 * - import { use$, useCollection, useSyncForm } from 'dotdo/client'
 * - import type { Thing, Collection } from 'dotdo/types'
 *
 * Tests will FAIL initially because:
 * - 'dotdo/client' export doesn't exist in package.json
 * - Client hooks don't exist yet
 * - Peer dependencies may be missing
 *
 * This is intentional - RED phase of TDD.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile, access } from 'fs/promises'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

// ============================================================================
// Test Setup
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const PACKAGE_JSON_PATH = resolve(PROJECT_ROOT, 'package.json')

interface PackageJson {
  name: string
  version: string
  main?: string
  module?: string
  types?: string
  type?: string
  exports?: Record<string, unknown>
  files?: string[]
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  sideEffects?: boolean | string[]
}

let packageJson: PackageJson

beforeAll(async () => {
  const content = await readFile(PACKAGE_JSON_PATH, 'utf-8')
  packageJson = JSON.parse(content) as PackageJson
})

// ============================================================================
// 1. Package exports dotdo/client entry point
// ============================================================================

describe('dotdo/client export', () => {
  it('should have ./client in exports map', () => {
    expect(packageJson.exports).toBeDefined()
    expect(packageJson.exports!['./client']).toBeDefined()
  })

  it('should have types condition for ./client', () => {
    const clientExport = packageJson.exports!['./client']
    expect(clientExport).toBeDefined()

    if (typeof clientExport === 'object' && clientExport !== null) {
      expect((clientExport as Record<string, unknown>)['types']).toBeDefined()
    } else {
      // If it's a string, it should still have a types entry
      expect(clientExport).toBeDefined()
    }
  })

  it('should have default/import condition for ./client', () => {
    const clientExport = packageJson.exports!['./client']
    expect(clientExport).toBeDefined()

    if (typeof clientExport === 'object' && clientExport !== null) {
      // Should have either 'default' or 'import' condition
      const exportObj = clientExport as Record<string, unknown>
      expect(exportObj['default'] || exportObj['import']).toBeDefined()
    }
  })

  it('client export file should exist', async () => {
    const clientExport = packageJson.exports!['./client']
    expect(clientExport).toBeDefined()

    let filePath: string | undefined

    if (typeof clientExport === 'object' && clientExport !== null) {
      const exportObj = clientExport as Record<string, unknown>
      filePath = (exportObj['default'] || exportObj['import']) as string
    } else if (typeof clientExport === 'string') {
      filePath = clientExport
    }

    expect(filePath).toBeDefined()

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      await expect(access(fullPath)).resolves.toBeUndefined()
    }
  })

  it('should export use$ hook', async () => {
    // This test verifies the hook exists in the client module
    // Will fail because use$ doesn't exist yet
    const clientExport = packageJson.exports!['./client']
    expect(clientExport).toBeDefined()

    let filePath: string | undefined
    if (typeof clientExport === 'object' && clientExport !== null) {
      const exportObj = clientExport as Record<string, unknown>
      filePath = (exportObj['default'] || exportObj['import']) as string
    }

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      const content = await readFile(fullPath, 'utf-8')
      // Check that use$ is exported
      expect(content).toMatch(/export\s+(?:const|function|{[^}]*\buse\$\b[^}]*})/)
    }
  })

  it('should export useCollection hook', async () => {
    // This test verifies the hook exists in the client module
    // Will fail because useCollection doesn't exist yet
    const clientExport = packageJson.exports!['./client']
    expect(clientExport).toBeDefined()

    let filePath: string | undefined
    if (typeof clientExport === 'object' && clientExport !== null) {
      const exportObj = clientExport as Record<string, unknown>
      filePath = (exportObj['default'] || exportObj['import']) as string
    }

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      const content = await readFile(fullPath, 'utf-8')
      // Check that useCollection is exported
      expect(content).toMatch(/export\s+(?:const|function|{[^}]*\buseCollection\b[^}]*})/)
    }
  })

  it('should export useSyncForm hook', async () => {
    // This test verifies the hook exists in the client module
    // Will fail because useSyncForm doesn't exist yet
    const clientExport = packageJson.exports!['./client']
    expect(clientExport).toBeDefined()

    let filePath: string | undefined
    if (typeof clientExport === 'object' && clientExport !== null) {
      const exportObj = clientExport as Record<string, unknown>
      filePath = (exportObj['default'] || exportObj['import']) as string
    }

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      const content = await readFile(fullPath, 'utf-8')
      // Check that useSyncForm is exported
      expect(content).toMatch(/export\s+(?:const|function|{[^}]*\buseSyncForm\b[^}]*})/)
    }
  })
})

// ============================================================================
// 2. Package exports dotdo/types entry point
// ============================================================================

describe('dotdo/types export', () => {
  it('should have ./types in exports map', () => {
    expect(packageJson.exports).toBeDefined()
    expect(packageJson.exports!['./types']).toBeDefined()
  })

  it('should have types condition for ./types', () => {
    const typesExport = packageJson.exports!['./types']
    expect(typesExport).toBeDefined()

    if (typeof typesExport === 'object' && typesExport !== null) {
      expect((typesExport as Record<string, unknown>)['types']).toBeDefined()
    }
  })

  it('types export file should exist', async () => {
    const typesExport = packageJson.exports!['./types']
    expect(typesExport).toBeDefined()

    let filePath: string | undefined

    if (typeof typesExport === 'object' && typesExport !== null) {
      const exportObj = typesExport as Record<string, unknown>
      filePath = (exportObj['types'] || exportObj['default']) as string
    } else if (typeof typesExport === 'string') {
      filePath = typesExport
    }

    expect(filePath).toBeDefined()

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      await expect(access(fullPath)).resolves.toBeUndefined()
    }
  })

  it('should export Thing type', async () => {
    const typesExport = packageJson.exports!['./types']
    expect(typesExport).toBeDefined()

    let filePath: string | undefined
    if (typeof typesExport === 'object' && typesExport !== null) {
      const exportObj = typesExport as Record<string, unknown>
      filePath = (exportObj['types'] || exportObj['default']) as string
    }

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      const content = await readFile(fullPath, 'utf-8')
      // Check that Thing is exported (type or interface or re-export)
      expect(content).toMatch(/(?:export\s+(?:type|interface)\s+Thing|export\s+\*\s+from\s+['"]\.[^'"]*Thing[^'"]*['"]|export\s+type\s+\{[^}]*\bThing\b[^}]*\})/)
    }
  })

  it('should export Collection type', async () => {
    const typesExport = packageJson.exports!['./types']
    expect(typesExport).toBeDefined()

    let filePath: string | undefined
    if (typeof typesExport === 'object' && typesExport !== null) {
      const exportObj = typesExport as Record<string, unknown>
      filePath = (exportObj['types'] || exportObj['default']) as string
    }

    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      const content = await readFile(fullPath, 'utf-8')
      // Check that Collection is exported
      expect(content).toMatch(/(?:export\s+(?:type|interface)\s+Collection|export\s+\*\s+from\s+['"]\.[^'"]*Collection[^'"]*['"]|export\s+type\s+\{[^}]*\bCollection\b[^}]*\})/)
    }
  })
})

// ============================================================================
// 3. Package has correct main/module/types fields
// ============================================================================

describe('Package main/module/types fields', () => {
  it('should have main field defined', () => {
    expect(packageJson.main).toBeDefined()
  })

  it('main field should point to existing file', async () => {
    expect(packageJson.main).toBeDefined()
    const fullPath = resolve(PROJECT_ROOT, packageJson.main!)
    await expect(access(fullPath)).resolves.toBeUndefined()
  })

  it('should have types field defined', () => {
    expect(packageJson.types).toBeDefined()
  })

  it('types field should point to existing file', async () => {
    expect(packageJson.types).toBeDefined()
    const fullPath = resolve(PROJECT_ROOT, packageJson.types!)
    await expect(access(fullPath)).resolves.toBeUndefined()
  })

  it('should be type: module for ESM', () => {
    expect(packageJson.type).toBe('module')
  })

  it('should have module field for ESM bundlers', () => {
    // Modern packages should have a module field for ESM-aware bundlers
    // This test may fail if module field is intentionally omitted
    expect(packageJson.module).toBeDefined()
  })

  it('module field should point to existing file', async () => {
    if (packageJson.module) {
      const fullPath = resolve(PROJECT_ROOT, packageJson.module)
      await expect(access(fullPath)).resolves.toBeUndefined()
    }
  })
})

// ============================================================================
// 4. Tree-shaking works (unused exports eliminated)
// ============================================================================

describe('Tree-shaking support', () => {
  it('should have sideEffects field defined', () => {
    // sideEffects: false or array enables tree-shaking
    expect(packageJson.sideEffects !== undefined).toBe(true)
  })

  it('sideEffects should be false or limited array', () => {
    // For optimal tree-shaking, sideEffects should be false
    // or a minimal array of files with side effects
    if (typeof packageJson.sideEffects === 'boolean') {
      expect(packageJson.sideEffects).toBe(false)
    } else if (Array.isArray(packageJson.sideEffects)) {
      // Should be a small list
      expect(packageJson.sideEffects.length).toBeLessThan(10)
    }
  })

  it('client export should not have side effects at module level', async () => {
    // This test would ideally check for pure ES modules
    // For now, verify the export uses named exports (not just default)
    const clientExport = packageJson.exports?.['./client']
    if (clientExport) {
      let filePath: string | undefined
      if (typeof clientExport === 'object' && clientExport !== null) {
        const exportObj = clientExport as Record<string, unknown>
        filePath = (exportObj['default'] || exportObj['import']) as string
      }

      if (filePath) {
        const fullPath = resolve(PROJECT_ROOT, filePath)
        try {
          const content = await readFile(fullPath, 'utf-8')
          // Should have named exports for tree-shaking
          expect(content).toMatch(/export\s+\{/)
        } catch {
          // File doesn't exist yet - that's expected in RED phase
          expect(filePath).toBeDefined()
        }
      }
    }
  })
})

// ============================================================================
// 5. Version follows semver
// ============================================================================

describe('Version follows semver', () => {
  it('should have version field', () => {
    expect(packageJson.version).toBeDefined()
  })

  it('version should follow semver format', () => {
    const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
    expect(packageJson.version).toMatch(semverRegex)
  })

  it('version should be >= 0.0.1 for pre-release', () => {
    const parts = packageJson.version.split('.')
    const major = parseInt(parts[0], 10)
    const minor = parseInt(parts[1], 10)
    const patch = parseInt(parts[2]?.split('-')[0] || '0', 10)

    // At least 0.0.1 should exist
    const versionNum = major * 10000 + minor * 100 + patch
    expect(versionNum).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// 6. Peer dependencies declared correctly (react ^18 || ^19)
// ============================================================================

describe('Peer dependencies', () => {
  it('should have peerDependencies field', () => {
    // Client hooks using React need peer dependencies
    expect(packageJson.peerDependencies).toBeDefined()
  })

  it('should declare react as peer dependency', () => {
    expect(packageJson.peerDependencies).toBeDefined()
    expect(packageJson.peerDependencies!['react']).toBeDefined()
  })

  it('react peer dependency should support React 18 and 19', () => {
    expect(packageJson.peerDependencies).toBeDefined()
    const reactVersion = packageJson.peerDependencies!['react']
    expect(reactVersion).toBeDefined()

    // Should support both React 18 and 19
    // Acceptable formats: "^18 || ^19", ">=18", "^18.0.0 || ^19.0.0", etc.
    const supportsMultipleVersions =
      reactVersion.includes('||') ||
      reactVersion.includes('>=18') ||
      reactVersion.includes('>18')

    // At minimum should support React 18 or 19
    const supports18or19 =
      reactVersion.includes('18') ||
      reactVersion.includes('19') ||
      reactVersion.includes('>=')

    expect(supports18or19).toBe(true)
    expect(supportsMultipleVersions).toBe(true)
  })

  it('should declare react-dom as peer dependency', () => {
    expect(packageJson.peerDependencies).toBeDefined()
    expect(packageJson.peerDependencies!['react-dom']).toBeDefined()
  })

  it('peerDependenciesMeta should mark react as optional if needed', () => {
    // If peerDependenciesMeta exists, check configuration
    const pkg = packageJson as PackageJson & {
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }

    if (pkg.peerDependenciesMeta) {
      // If react is marked optional, it should be explicit
      if (pkg.peerDependenciesMeta['react']) {
        expect(typeof pkg.peerDependenciesMeta['react'].optional).toBe('boolean')
      }
    }
  })
})

// ============================================================================
// 7. No accidental bundling of devDependencies
// ============================================================================

describe('No accidental bundling of devDependencies', () => {
  it('should not have vitest in dependencies', () => {
    expect(packageJson.dependencies?.['vitest']).toBeUndefined()
  })

  it('should not have typescript in dependencies', () => {
    expect(packageJson.dependencies?.['typescript']).toBeUndefined()
  })

  it('should not have eslint in dependencies', () => {
    expect(packageJson.dependencies?.['eslint']).toBeUndefined()
  })

  it('should not have prettier in dependencies', () => {
    expect(packageJson.dependencies?.['prettier']).toBeUndefined()
  })

  it('should not have @types/* in dependencies', () => {
    if (packageJson.dependencies) {
      const typePackages = Object.keys(packageJson.dependencies).filter((key) =>
        key.startsWith('@types/')
      )
      expect(typePackages).toEqual([])
    }
  })

  it('should have vitest in devDependencies', () => {
    expect(packageJson.devDependencies?.['vitest']).toBeDefined()
  })

  it('should have typescript in devDependencies', () => {
    expect(packageJson.devDependencies?.['typescript']).toBeDefined()
  })

  it('client module should not import dev-only packages', async () => {
    const clientExport = packageJson.exports?.['./client']
    if (clientExport) {
      let filePath: string | undefined
      if (typeof clientExport === 'object' && clientExport !== null) {
        const exportObj = clientExport as Record<string, unknown>
        filePath = (exportObj['default'] || exportObj['import']) as string
      }

      if (filePath) {
        const fullPath = resolve(PROJECT_ROOT, filePath)
        try {
          const content = await readFile(fullPath, 'utf-8')
          // Should not import vitest, jest, or test utilities
          expect(content).not.toMatch(/from\s+['"]vitest['"]/)
          expect(content).not.toMatch(/from\s+['"]jest['"]/)
          expect(content).not.toMatch(/from\s+['"]@testing-library/)
        } catch {
          // File doesn't exist yet - that's expected in RED phase
          expect(filePath).toBeDefined()
        }
      }
    }
  })
})

// ============================================================================
// 8. Files field includes client directory
// ============================================================================

describe('Files field configuration', () => {
  it('should have files field', () => {
    expect(packageJson.files).toBeDefined()
    expect(Array.isArray(packageJson.files)).toBe(true)
  })

  it('should include client directory in files', () => {
    expect(packageJson.files).toBeDefined()
    // Check if 'client' is in the files array
    const hasClient = packageJson.files!.some(
      (f) => f === 'client' || f.startsWith('client/')
    )
    expect(hasClient).toBe(true)
  })

  it('should include types directory in files', () => {
    expect(packageJson.files).toBeDefined()
    const hasTypes = packageJson.files!.some(
      (f) => f === 'types' || f.startsWith('types/')
    )
    expect(hasTypes).toBe(true)
  })

  it('should not include test directories in files', () => {
    expect(packageJson.files).toBeDefined()
    const hasTests = packageJson.files!.some(
      (f) =>
        f.includes('test') ||
        f.includes('spec') ||
        f.includes('__tests__') ||
        f === 'tests'
    )
    expect(hasTests).toBe(false)
  })

  it('should not include .env files in files', () => {
    expect(packageJson.files).toBeDefined()
    const hasEnv = packageJson.files!.some(
      (f) => f.includes('.env') || f === '.env'
    )
    expect(hasEnv).toBe(false)
  })
})

// ============================================================================
// 9. Export map has proper TypeScript resolution
// ============================================================================

describe('TypeScript export resolution', () => {
  it('./client export should have types before default', () => {
    const clientExport = packageJson.exports?.['./client']
    if (typeof clientExport === 'object' && clientExport !== null) {
      const keys = Object.keys(clientExport)
      const typesIndex = keys.indexOf('types')
      const defaultIndex = keys.indexOf('default')

      if (typesIndex !== -1 && defaultIndex !== -1) {
        // types should come before default for proper TypeScript resolution
        expect(typesIndex).toBeLessThan(defaultIndex)
      }
    }
  })

  it('./types export should have types condition', () => {
    const typesExport = packageJson.exports?.['./types']
    if (typeof typesExport === 'object' && typesExport !== null) {
      expect((typesExport as Record<string, unknown>)['types']).toBeDefined()
    }
  })

  it('exports should use .ts or .d.ts for types condition', () => {
    const exports = packageJson.exports
    if (exports) {
      for (const [key, value] of Object.entries(exports)) {
        if (typeof value === 'object' && value !== null) {
          const exportObj = value as Record<string, unknown>
          if (exportObj['types']) {
            const typesPath = exportObj['types'] as string
            // Types should point to .ts, .d.ts, or /index.ts
            expect(
              typesPath.endsWith('.ts') ||
              typesPath.endsWith('.d.ts') ||
              typesPath.endsWith('/index.ts')
            ).toBe(true)
          }
        }
      }
    }
  })
})

// ============================================================================
// 10. Import verification (dynamic imports to test resolution)
// ============================================================================

describe('Import verification', () => {
  it('should be able to import from dotdo/types path', async () => {
    // This test verifies the export map resolves correctly
    // Note: In actual runtime, this would use the package name
    // Here we're testing the file exists at the mapped path

    const typesExport = packageJson.exports?.['./types']
    expect(typesExport).toBeDefined()

    let filePath: string | undefined
    if (typeof typesExport === 'object' && typesExport !== null) {
      const exportObj = typesExport as Record<string, unknown>
      filePath = (exportObj['default'] || exportObj['types']) as string
    } else if (typeof typesExport === 'string') {
      filePath = typesExport
    }

    expect(filePath).toBeDefined()

    // Try to dynamically import the module
    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      // Using dynamic import to test the module loads
      const module = await import(fullPath)
      // Should have Thing exported
      expect(module.Thing || module.default).toBeDefined()
    }
  })

  it('should be able to import from dotdo/client path', async () => {
    // This test verifies the client export map resolves correctly
    // Will fail in RED phase because ./client doesn't exist

    const clientExport = packageJson.exports?.['./client']
    expect(clientExport).toBeDefined()

    let filePath: string | undefined
    if (typeof clientExport === 'object' && clientExport !== null) {
      const exportObj = clientExport as Record<string, unknown>
      filePath = (exportObj['default'] || exportObj['import']) as string
    } else if (typeof clientExport === 'string') {
      filePath = clientExport
    }

    expect(filePath).toBeDefined()

    // Try to dynamically import the module
    if (filePath) {
      const fullPath = resolve(PROJECT_ROOT, filePath)
      // Using dynamic import to test the module loads
      const module = await import(fullPath)
      // Should have use$ exported
      expect(module.use$).toBeDefined()
    }
  })
})
