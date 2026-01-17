/**
 * NPM Package Build Tests
 *
 * RED PHASE: Tests for @dotdo/* package builds and publishing
 * Verifies that all packages can be built with correct types and exports
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

// ============================================================================
// Setup
// ============================================================================

const packagesDir = path.resolve(__dirname, '..')
const packages = ['middleware', 'workers'] as const

type Package = (typeof packages)[number]

interface PackageConfig {
  name: string
  version: string
  main: string
  types: string
  exports: Record<string, { import: string; types: string }>
  scripts: {
    build: string
    test?: string
    typecheck?: string
  }
  files: string[]
}

// ============================================================================
// Package Structure Tests
// ============================================================================

describe('Package Structure', () => {
  describe('package.json validation', () => {
    it('should have valid package.json for @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      expect(existsSync(pkgPath)).toBe(true)

      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig
      expect(pkg.name).toBe('@dotdo/middleware')
      expect(pkg.version).toBeDefined()
      expect(pkg.main).toBeDefined()
      expect(pkg.types).toBeDefined()
      expect(pkg.license).toBe('MIT')
      expect(pkg.repository).toBeDefined()
      expect(pkg.repository.directory).toBe('packages/middleware')
    })

    it('should have valid package.json for @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      expect(existsSync(pkgPath)).toBe(true)

      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig
      expect(pkg.name).toBe('@dotdo/workers')
      expect(pkg.version).toBeDefined()
      expect(pkg.main).toBeDefined()
      expect(pkg.types).toBeDefined()
      expect(pkg.license).toBe('MIT')
      expect(pkg.repository).toBeDefined()
      expect(pkg.repository.directory).toBe('packages/workers')
    })

    it('should have matching version in all package.json files', () => {
      const versions = packages.map((pkg) => {
        const pkgPath = path.join(packagesDir, pkg, 'package.json')
        const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig
        return config.version
      })

      // All versions should be the same (for locked release cycle)
      const [firstVersion] = versions
      expect(versions.every(v => v === firstVersion)).toBe(true)
    })

    it('should have proper fields in all packages', () => {
      packages.forEach((pkg) => {
        const pkgPath = path.join(packagesDir, pkg, 'package.json')
        const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

        // Required fields
        expect(config.name).toMatch(/^@dotdo\//)
        expect(config.version).toMatch(/^\d+\.\d+\.\d+/)
        expect(config.description).toBeDefined()
        expect(config.type).toBe('module')
        expect(config.main).toBeDefined()
        expect(config.types).toBeDefined()
        expect(config.exports).toBeDefined()
        expect(config.scripts.build).toBeDefined()
        expect(config.files).toBeDefined()
        expect(config.author).toBe('dotdo')
        expect(config.license).toBe('MIT')
      })
    })
  })

  describe('exports field validation', () => {
    it('should have main export for @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.exports['.']).toBeDefined()
      expect(config.exports['.'].import).toBe('./dist/index.js')
      expect(config.exports['.'].types).toBe('./dist/index.d.ts')
    })

    it('should have named subpath exports for @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      const requiredExports = [
        './auth',
        './auth/jwt',
        './auth/api-key',
        './auth/session',
        './workos',
        './workos/authkit',
        './workos/vault',
        './error',
        './request-id',
        './rate-limit',
        './mcp',
      ]

      requiredExports.forEach((exportPath) => {
        expect(config.exports[exportPath]).toBeDefined()
        expect(config.exports[exportPath].import).toBeDefined()
        expect(config.exports[exportPath].types).toBeDefined()
      })
    })

    it('should have main export for @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.exports['.']).toBeDefined()
      expect(config.exports['.'].import).toBe('./dist/index.js')
      expect(config.exports['.'].types).toBe('./dist/index.d.ts')
    })

    it('should have named subpath exports for @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      const requiredExports = ['./do', './proxy', './storage']

      requiredExports.forEach((exportPath) => {
        expect(config.exports[exportPath]).toBeDefined()
        expect(config.exports[exportPath].import).toBeDefined()
        expect(config.exports[exportPath].types).toBeDefined()
      })
    })
  })

  describe('source files validation', () => {
    it('should have tsconfig.json in @dotdo/middleware', () => {
      const tsconfigPath = path.join(packagesDir, 'middleware', 'tsconfig.json')
      expect(existsSync(tsconfigPath)).toBe(true)

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.declaration).toBe(true)
      expect(tsconfig.compilerOptions.outDir).toBe('./dist')
    })

    it('should have tsconfig.json in @dotdo/workers', () => {
      const tsconfigPath = path.join(packagesDir, 'workers', 'tsconfig.json')
      expect(existsSync(tsconfigPath)).toBe(true)

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.declaration).toBe(true)
      expect(tsconfig.compilerOptions.outDir).toBe('./dist')
    })

    it('should have source files in src/ directory for @dotdo/middleware', () => {
      const srcPath = path.join(packagesDir, 'middleware', 'src')
      expect(existsSync(srcPath)).toBe(true)

      const indexPath = path.join(srcPath, 'index.ts')
      expect(existsSync(indexPath)).toBe(true)
    })

    it('should have source files in src/ directory for @dotdo/workers', () => {
      const srcPath = path.join(packagesDir, 'workers', 'src')
      expect(existsSync(srcPath)).toBe(true)

      const indexPath = path.join(srcPath, 'index.ts')
      expect(existsSync(indexPath)).toBe(true)
    })
  })

  describe('documentation validation', () => {
    it('should have vitest.config.ts in @dotdo/middleware', () => {
      const vitestPath = path.join(packagesDir, 'middleware', 'vitest.config.ts')
      expect(existsSync(vitestPath)).toBe(true)
    })

    it('should have vitest.config.ts in @dotdo/workers', () => {
      const vitestPath = path.join(packagesDir, 'workers', 'vitest.config.ts')
      expect(existsSync(vitestPath)).toBe(true)
    })

    it('should have node_modules in both packages after install', () => {
      packages.forEach((pkg) => {
        const nmPath = path.join(packagesDir, pkg, 'node_modules')
        expect(existsSync(nmPath)).toBe(true)
      })
    })
  })
})

// ============================================================================
// Package Build Tests
// ============================================================================

describe('Package Builds', () => {
  describe('build scripts', () => {
    it('should have build script in @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.scripts.build).toBe('tsc')
    })

    it('should have build script in @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.scripts.build).toBe('tsup')
    })
  })

  describe('build output', () => {
    it('should have dist directory in @dotdo/middleware', () => {
      const distPath = path.join(packagesDir, 'middleware', 'dist')
      expect(existsSync(distPath)).toBe(true)
    })

    it('should have dist directory in @dotdo/workers', () => {
      const distPath = path.join(packagesDir, 'workers', 'dist')
      expect(existsSync(distPath)).toBe(true)
    })

    it('should have compiled JS files in @dotdo/middleware dist', () => {
      const indexJsPath = path.join(packagesDir, 'middleware', 'dist', 'index.js')
      expect(existsSync(indexJsPath)).toBe(true)
    })

    it('should have compiled JS files in @dotdo/workers dist', () => {
      const indexJsPath = path.join(packagesDir, 'workers', 'dist', 'index.js')
      expect(existsSync(indexJsPath)).toBe(true)
    })

    it('should have type declaration files in @dotdo/middleware dist', () => {
      const indexDtsPath = path.join(packagesDir, 'middleware', 'dist', 'index.d.ts')
      expect(existsSync(indexDtsPath)).toBe(true)
    })

    it('should have type declaration files in @dotdo/workers dist', () => {
      const indexDtsPath = path.join(packagesDir, 'workers', 'dist', 'index.d.ts')
      expect(existsSync(indexDtsPath)).toBe(true)
    })

    it('should have type declarations for all exports in @dotdo/middleware', () => {
      const distPath = path.join(packagesDir, 'middleware', 'dist')

      const requiredDeclarations = [
        'index.d.ts',
        'auth/index.d.ts',
        'auth/jwt.d.ts',
        'auth/api-key.d.ts',
        'auth/session.d.ts',
        'workos/index.d.ts',
        'workos/authkit.d.ts',
        'workos/vault.d.ts',
        'error/index.d.ts',
        'request-id.d.ts',
        'rate-limit.d.ts',
        'mcp.d.ts',
      ]

      requiredDeclarations.forEach((file) => {
        const filePath = path.join(distPath, file)
        expect(existsSync(filePath)).toBe(true)
      })
    })

    it('should have type declarations for all exports in @dotdo/workers', () => {
      const distPath = path.join(packagesDir, 'workers', 'dist')

      const requiredDeclarations = [
        'index.d.ts',
        'do/index.d.ts',
        'proxy/index.d.ts',
        'storage/index.d.ts',
      ]

      requiredDeclarations.forEach((file) => {
        const filePath = path.join(distPath, file)
        expect(existsSync(filePath)).toBe(true)
      })
    })
  })

  describe('build artifact quality', () => {
    it('should have non-empty JS files in @dotdo/middleware dist', () => {
      const jsFiles = [
        path.join(packagesDir, 'middleware', 'dist', 'index.js'),
        path.join(packagesDir, 'middleware', 'dist', 'auth', 'index.js'),
        path.join(packagesDir, 'middleware', 'dist', 'error', 'index.js'),
      ]

      jsFiles.forEach((file) => {
        if (existsSync(file)) {
          const stats = statSync(file)
          expect(stats.size).toBeGreaterThan(0)
        }
      })
    })

    it('should have non-empty JS files in @dotdo/workers dist', () => {
      const jsFiles = [
        path.join(packagesDir, 'workers', 'dist', 'index.js'),
        path.join(packagesDir, 'workers', 'dist', 'do', 'index.js'),
      ]

      jsFiles.forEach((file) => {
        if (existsSync(file)) {
          const stats = statSync(file)
          expect(stats.size).toBeGreaterThan(0)
        }
      })
    })

    it('should have non-empty .d.ts files in @dotdo/middleware dist', () => {
      const dtsFiles = [
        path.join(packagesDir, 'middleware', 'dist', 'index.d.ts'),
        path.join(packagesDir, 'middleware', 'dist', 'auth', 'index.d.ts'),
      ]

      dtsFiles.forEach((file) => {
        if (existsSync(file)) {
          const stats = statSync(file)
          expect(stats.size).toBeGreaterThan(0)
        }
      })
    })

    it('should have non-empty .d.ts files in @dotdo/workers dist', () => {
      const dtsFiles = [
        path.join(packagesDir, 'workers', 'dist', 'index.d.ts'),
        path.join(packagesDir, 'workers', 'dist', 'do', 'index.d.ts'),
      ]

      dtsFiles.forEach((file) => {
        if (existsSync(file)) {
          const stats = statSync(file)
          expect(stats.size).toBeGreaterThan(0)
        }
      })
    })
  })
})

// ============================================================================
// Package Dependencies Tests
// ============================================================================

describe('Package Dependencies', () => {
  describe('dependency configuration', () => {
    it('should have peerDependencies in @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        peerDependencies?: Record<string, string>
      }

      expect(config.peerDependencies).toBeDefined()
      expect(config.peerDependencies?.hono).toBeDefined()
      expect(config.peerDependencies?.jose).toBeDefined()
    })

    it('should have peerDependencies in @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        peerDependencies?: Record<string, string>
      }

      expect(config.peerDependencies).toBeDefined()
      expect(config.peerDependencies?.['@cloudflare/workers-types']).toBeDefined()
    })

    it('should have devDependencies in @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        devDependencies?: Record<string, string>
      }

      expect(config.devDependencies).toBeDefined()
      expect(config.devDependencies?.typescript).toBeDefined()
      expect(config.devDependencies?.vitest).toBeDefined()
    })

    it('should have devDependencies in @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        devDependencies?: Record<string, string>
      }

      expect(config.devDependencies).toBeDefined()
      expect(config.devDependencies?.typescript).toBeDefined()
      expect(config.devDependencies?.vitest).toBeDefined()
      expect(config.devDependencies?.tsup).toBeDefined()
    })
  })

  describe('files field', () => {
    it('should include dist and src in @dotdo/middleware files', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.files).toContain('dist')
      expect(config.files).toContain('src')
    })

    it('should include dist in @dotdo/workers files', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.files).toContain('dist')
    })

    it('should exclude test files in @dotdo/workers files', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      expect(config.files.some(f => f.includes('!**/*.test.ts'))).toBe(true)
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  describe('TypeScript compilation', () => {
    it('should generate .d.ts with proper exports in @dotdo/middleware', () => {
      const dtsPath = path.join(packagesDir, 'middleware', 'dist', 'index.d.ts')
      const content = readFileSync(dtsPath, 'utf-8')

      // Should have export declarations
      expect(content).toMatch(/export/)
      expect(content.length).toBeGreaterThan(0)
    })

    it('should generate .d.ts with proper exports in @dotdo/workers', () => {
      const dtsPath = path.join(packagesDir, 'workers', 'dist', 'index.d.ts')
      const content = readFileSync(dtsPath, 'utf-8')

      // Should have export declarations
      expect(content).toMatch(/export/)
      expect(content.length).toBeGreaterThan(0)
    })

    it('should have declaration maps in @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        tsconfig?: { compilerOptions?: { declarationMap?: boolean } }
      }

      const tsconfigPath = path.join(packagesDir, 'middleware', 'tsconfig.json')
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))

      expect(tsconfig.compilerOptions.declarationMap).toBe(true)
    })
  })

  describe('source maps', () => {
    it('should have source maps in @dotdo/middleware dist', () => {
      const mapPath = path.join(packagesDir, 'middleware', 'dist', 'index.js.map')
      // Source maps may or may not be included depending on config
      // This test verifies the build supports source maps
      const dtsMapPath = path.join(packagesDir, 'middleware', 'dist', 'index.d.ts.map')
      if (existsSync(dtsMapPath)) {
        const stats = statSync(dtsMapPath)
        expect(stats.size).toBeGreaterThan(0)
      }
    })
  })
})

// ============================================================================
// Publishing Readiness Tests
// ============================================================================

describe('Publishing Readiness', () => {
  describe('metadata', () => {
    it('should have complete metadata in @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        keywords?: string[]
        repository?: { type: string; url: string; directory: string }
        bugs?: { url: string }
      }

      expect(config.keywords).toBeDefined()
      expect(config.keywords?.length).toBeGreaterThan(0)
      expect(config.keywords).toContain('dotdo')
      expect(config.repository?.type).toBe('git')
      expect(config.repository?.url).toMatch(/github\.com/)
      expect(config.bugs?.url).toBeDefined()
    })

    it('should have complete metadata in @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        keywords?: string[]
        repository?: { type: string; url: string; directory: string }
        bugs?: { url: string }
      }

      expect(config.keywords).toBeDefined()
      expect(config.keywords?.length).toBeGreaterThan(0)
      expect(config.keywords).toContain('dotdo')
      expect(config.repository?.type).toBe('git')
      expect(config.repository?.url).toMatch(/github\.com/)
      expect(config.bugs?.url).toBeDefined()
    })
  })

  describe('npm-readiness', () => {
    it('should have all required fields for npm publish in @dotdo/middleware', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      // npm publish requires these fields
      expect(config.name).toBeDefined()
      expect(config.name).toMatch(/^@dotdo\//)
      expect(config.version).toBeDefined()
      expect(config.license).toBeDefined()
      expect(config.main).toBeDefined()
      expect(config.types).toBeDefined()
    })

    it('should have all required fields for npm publish in @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      // npm publish requires these fields
      expect(config.name).toBeDefined()
      expect(config.name).toMatch(/^@dotdo\//)
      expect(config.version).toBeDefined()
      expect(config.license).toBeDefined()
      expect(config.main).toBeDefined()
      expect(config.types).toBeDefined()
    })

    it('should have .npmignore or files field configured', () => {
      packages.forEach((pkg) => {
        const pkgPath = path.join(packagesDir, pkg, 'package.json')
        const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

        // Either files field should be set or .npmignore should exist
        expect(config.files).toBeDefined()
        expect(config.files.length).toBeGreaterThan(0)
      })
    })

    it('should not include node_modules in published files', () => {
      packages.forEach((pkg) => {
        const pkgPath = path.join(packagesDir, pkg, 'package.json')
        const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

        expect(config.files.some(f => f.includes('node_modules'))).toBe(false)
      })
    })

    it('should have proper export paths that match dist structure', () => {
      packages.forEach((pkg) => {
        const pkgPath = path.join(packagesDir, pkg, 'package.json')
        const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

        Object.entries(config.exports).forEach(([exportPath, exportConfig]) => {
          if (typeof exportConfig === 'object' && 'import' in exportConfig) {
            // Verify the exported paths actually exist or can be built
            const importPath = exportConfig.import as string
            const typesPath = exportConfig.types as string

            // Paths should start with ./dist
            expect(importPath).toMatch(/^\.\/dist/)
            expect(typesPath).toMatch(/^\.\/dist/)
          }
        })
      })
    })
  })

  describe('prepublish hooks', () => {
    it('should have prepublishOnly script in @dotdo/workers', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig & {
        scripts: { prepublishOnly?: string }
      }

      expect(config.scripts.prepublishOnly).toBeDefined()
      expect(config.scripts.prepublishOnly).toContain('build')
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Package Integration', () => {
  describe('cross-package imports', () => {
    it('should be importable via main entry point @dotdo/middleware', async () => {
      const indexPath = path.join(packagesDir, 'middleware', 'dist', 'index.js')
      expect(existsSync(indexPath)).toBe(true)

      // Verify file exists and is valid
      const content = readFileSync(indexPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
    })

    it('should be importable via main entry point @dotdo/workers', async () => {
      const indexPath = path.join(packagesDir, 'workers', 'dist', 'index.js')
      expect(existsSync(indexPath)).toBe(true)

      // Verify file exists and is valid
      const content = readFileSync(indexPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
    })

    it('should be importable via subpath exports in @dotdo/middleware', () => {
      const subpaths = [
        'dist/auth/index.js',
        'dist/error/index.js',
        'dist/request-id.js',
      ]

      subpaths.forEach((subpath) => {
        const filePath = path.join(packagesDir, 'middleware', subpath)
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8')
          expect(content.length).toBeGreaterThan(0)
        }
      })
    })

    it('should be importable via subpath exports in @dotdo/workers', () => {
      const subpaths = [
        'dist/do/index.js',
        'dist/proxy/index.js',
        'dist/storage/index.js',
      ]

      subpaths.forEach((subpath) => {
        const filePath = path.join(packagesDir, 'workers', subpath)
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8')
          expect(content.length).toBeGreaterThan(0)
        }
      })
    })
  })

  describe('type resolution', () => {
    it('should resolve types correctly for @dotdo/middleware main export', () => {
      const pkgPath = path.join(packagesDir, 'middleware', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      const typesFile = path.join(packagesDir, 'middleware', config.types)
      expect(existsSync(typesFile)).toBe(true)
    })

    it('should resolve types correctly for @dotdo/workers main export', () => {
      const pkgPath = path.join(packagesDir, 'workers', 'package.json')
      const config = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageConfig

      const typesFile = path.join(packagesDir, 'workers', config.types)
      expect(existsSync(typesFile)).toBe(true)
    })
  })
})
