import { describe, it, expect, beforeEach } from 'vitest'
import {
  RegistryBackend,
  PackageMetadata,
  PackageVersion,
  SearchOptions,
  SearchResult,
  CacheConfig,
  MemoryRegistry,
} from '../../core/backend'

describe('RegistryBackend Interface', () => {
  describe('Interface Definition', () => {
    it('should define RegistryBackend interface with required methods', () => {
      // Type-level test: verify the interface has all required methods
      // Use MemoryRegistry as the implementation to verify methods exist at runtime
      const backend: RegistryBackend = new MemoryRegistry()

      // These should all be functions on the interface
      expect(typeof backend.getPackageMetadata).toBe('function')
      expect(typeof backend.getPackageVersion).toBe('function')
      expect(typeof backend.getTarball).toBe('function')
      expect(typeof backend.searchPackages).toBe('function')
      expect(typeof backend.resolveLatest).toBe('function')
    })

    it('should define PackageMetadata type structure', () => {
      const metadata: PackageMetadata = {
        name: 'lodash',
        description: 'Lodash modular utilities',
        versions: {
          '4.17.21': {
            version: '4.17.21',
            dependencies: {},
            devDependencies: {},
            dist: {
              tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
              shasum: 'abc123',
              integrity: 'sha512-xyz',
            },
          },
        },
        'dist-tags': {
          latest: '4.17.21',
        },
        time: {
          created: '2020-01-01T00:00:00.000Z',
          modified: '2020-01-01T00:00:00.000Z',
          '4.17.21': '2020-01-01T00:00:00.000Z',
        },
        maintainers: [{ name: 'jdalton', email: 'john@example.com.ai' }],
        license: 'MIT',
        readme: '# Lodash',
      }

      expect(metadata.name).toBe('lodash')
      expect(metadata.versions['4.17.21']).toBeDefined()
      expect(metadata['dist-tags'].latest).toBe('4.17.21')
    })

    it('should define PackageVersion type structure', () => {
      const version: PackageVersion = {
        name: 'lodash',
        version: '4.17.21',
        description: 'Lodash modular utilities',
        main: 'lodash.js',
        module: 'lodash.esm.js',
        types: 'index.d.ts',
        dependencies: { 'some-dep': '^1.0.0' },
        devDependencies: { vitest: '^2.0.0' },
        peerDependencies: {},
        optionalDependencies: {},
        bin: {},
        scripts: { test: 'vitest' },
        dist: {
          tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          shasum: 'abc123',
          integrity: 'sha512-xyz',
          fileCount: 100,
          unpackedSize: 1000000,
        },
        engines: { node: '>=14' },
        repository: { type: 'git', url: 'https://github.com/lodash/lodash' },
      }

      expect(version.name).toBe('lodash')
      expect(version.version).toBe('4.17.21')
      expect(version.dist.tarball).toContain('lodash')
    })

    it('should define SearchOptions type structure', () => {
      const options: SearchOptions = {
        limit: 20,
        offset: 0,
        quality: 0.5,
        popularity: 0.5,
        maintenance: 0.5,
      }

      expect(options.limit).toBe(20)
    })

    it('should define SearchResult type structure', () => {
      const result: SearchResult = {
        name: 'lodash',
        version: '4.17.21',
        description: 'Lodash modular utilities',
        keywords: ['util', 'functional'],
        date: '2020-01-01T00:00:00.000Z',
        publisher: { name: 'jdalton', email: 'john@example.com.ai' },
        score: {
          final: 0.9,
          detail: {
            quality: 0.9,
            popularity: 0.95,
            maintenance: 0.85,
          },
        },
      }

      expect(result.name).toBe('lodash')
      expect(result.score.final).toBe(0.9)
    })

    it('should define CacheConfig type structure', () => {
      const config: CacheConfig = {
        enabled: true,
        ttl: 3600,
        maxSize: 1000,
        strategy: 'lru',
      }

      expect(config.enabled).toBe(true)
      expect(config.strategy).toBe('lru')
    })
  })

  describe('MemoryRegistry Implementation', () => {
    let registry: MemoryRegistry

    beforeEach(() => {
      registry = new MemoryRegistry()
    })

    describe('getPackageMetadata', () => {
      it('should return null for non-existent package', async () => {
        const metadata = await registry.getPackageMetadata('non-existent-package')
        expect(metadata).toBeNull()
      })

      it('should return metadata for registered package', async () => {
        registry.addPackage({
          name: 'test-package',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: {
                tarball: 'https://example.com.ai/test-package-1.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-xyz',
              },
            },
          },
          'dist-tags': { latest: '1.0.0' },
        })

        const metadata = await registry.getPackageMetadata('test-package')
        expect(metadata).not.toBeNull()
        expect(metadata?.name).toBe('test-package')
        expect(metadata?.versions['1.0.0']).toBeDefined()
      })

      it('should handle scoped packages (@scope/name)', async () => {
        registry.addPackage({
          name: '@myorg/utils',
          versions: {
            '2.0.0': {
              version: '2.0.0',
              dependencies: {},
              devDependencies: {},
              dist: {
                tarball: 'https://example.com.ai/@myorg/utils-2.0.0.tgz',
                shasum: 'def456',
                integrity: 'sha512-abc',
              },
            },
          },
          'dist-tags': { latest: '2.0.0' },
        })

        const metadata = await registry.getPackageMetadata('@myorg/utils')
        expect(metadata).not.toBeNull()
        expect(metadata?.name).toBe('@myorg/utils')
      })
    })

    describe('getPackageVersion', () => {
      beforeEach(() => {
        registry.addPackage({
          name: 'multi-version-pkg',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: {
                tarball: 'https://example.com.ai/multi-version-pkg-1.0.0.tgz',
                shasum: 'v1hash',
                integrity: 'sha512-v1',
              },
            },
            '2.0.0': {
              version: '2.0.0',
              dependencies: { lodash: '^4.0.0' },
              devDependencies: {},
              dist: {
                tarball: 'https://example.com.ai/multi-version-pkg-2.0.0.tgz',
                shasum: 'v2hash',
                integrity: 'sha512-v2',
              },
            },
            '3.0.0-beta.1': {
              version: '3.0.0-beta.1',
              dependencies: {},
              devDependencies: {},
              dist: {
                tarball: 'https://example.com.ai/multi-version-pkg-3.0.0-beta.1.tgz',
                shasum: 'v3hash',
                integrity: 'sha512-v3',
              },
            },
          },
          'dist-tags': { latest: '2.0.0', beta: '3.0.0-beta.1', next: '3.0.0-beta.1' },
        })
      })

      it('should return null for non-existent package', async () => {
        const version = await registry.getPackageVersion('no-such-package', '1.0.0')
        expect(version).toBeNull()
      })

      it('should return null for non-existent version', async () => {
        const version = await registry.getPackageVersion('multi-version-pkg', '9.9.9')
        expect(version).toBeNull()
      })

      it('should return specific version', async () => {
        const version = await registry.getPackageVersion('multi-version-pkg', '1.0.0')
        expect(version).not.toBeNull()
        expect(version?.version).toBe('1.0.0')
      })

      it('should return version with dependencies', async () => {
        const version = await registry.getPackageVersion('multi-version-pkg', '2.0.0')
        expect(version?.dependencies).toEqual({ lodash: '^4.0.0' })
      })

      it('should handle prerelease versions', async () => {
        const version = await registry.getPackageVersion('multi-version-pkg', '3.0.0-beta.1')
        expect(version).not.toBeNull()
        expect(version?.version).toBe('3.0.0-beta.1')
      })
    })

    describe('getTarball', () => {
      beforeEach(() => {
        registry.addPackage({
          name: 'tarball-test',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: {
                tarball: 'https://example.com.ai/tarball-test-1.0.0.tgz',
                shasum: 'tarhash',
                integrity: 'sha512-tar',
              },
            },
          },
          'dist-tags': { latest: '1.0.0' },
        })
        registry.setTarball('tarball-test', '1.0.0', new Uint8Array([1, 2, 3, 4, 5]))
      })

      it('should return null for non-existent package', async () => {
        const tarball = await registry.getTarball('no-such-package', '1.0.0')
        expect(tarball).toBeNull()
      })

      it('should return null for non-existent version', async () => {
        const tarball = await registry.getTarball('tarball-test', '9.9.9')
        expect(tarball).toBeNull()
      })

      it('should return tarball data for existing package version', async () => {
        const tarball = await registry.getTarball('tarball-test', '1.0.0')
        expect(tarball).not.toBeNull()
        expect(tarball).toBeInstanceOf(Uint8Array)
        expect(tarball?.length).toBe(5)
      })

      it('should return correct tarball bytes', async () => {
        const tarball = await registry.getTarball('tarball-test', '1.0.0')
        expect(Array.from(tarball!)).toEqual([1, 2, 3, 4, 5])
      })
    })

    describe('searchPackages', () => {
      beforeEach(() => {
        registry.addPackage({
          name: 'lodash',
          description: 'Lodash modular utilities',
          versions: {
            '4.17.21': {
              version: '4.17.21',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '4.17.21' },
        })
        registry.addPackage({
          name: 'lodash-es',
          description: 'Lodash exported as ES modules',
          versions: {
            '4.17.21': {
              version: '4.17.21',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '4.17.21' },
        })
        registry.addPackage({
          name: 'underscore',
          description: 'JavaScript utility belt',
          versions: {
            '1.13.6': {
              version: '1.13.6',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '1.13.6' },
        })
      })

      it('should return empty array for no matches', async () => {
        const results = await registry.searchPackages('xyznonexistent')
        expect(results).toEqual([])
      })

      it('should find packages by name', async () => {
        const results = await registry.searchPackages('lodash')
        expect(results.length).toBe(2)
        expect(results.map((r) => r.name)).toContain('lodash')
        expect(results.map((r) => r.name)).toContain('lodash-es')
      })

      it('should find packages by description', async () => {
        const results = await registry.searchPackages('utility')
        expect(results.length).toBeGreaterThan(0)
      })

      it('should respect limit option', async () => {
        const results = await registry.searchPackages('lodash', { limit: 1 })
        expect(results.length).toBe(1)
      })

      it('should respect offset option', async () => {
        const allResults = await registry.searchPackages('lodash')
        const offsetResults = await registry.searchPackages('lodash', { offset: 1 })
        expect(offsetResults.length).toBe(allResults.length - 1)
      })

      it('should return SearchResult objects with required fields', async () => {
        const results = await registry.searchPackages('lodash')
        expect(results.length).toBeGreaterThan(0)
        const result = results[0]
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('version')
        expect(result).toHaveProperty('description')
      })
    })

    describe('resolveLatest', () => {
      beforeEach(() => {
        registry.addPackage({
          name: 'tagged-pkg',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
            '2.0.0': {
              version: '2.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
            '3.0.0-alpha.1': {
              version: '3.0.0-alpha.1',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
            '3.0.0-beta.1': {
              version: '3.0.0-beta.1',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': {
            latest: '2.0.0',
            next: '3.0.0-beta.1',
            alpha: '3.0.0-alpha.1',
            beta: '3.0.0-beta.1',
          },
        })
      })

      it('should return null for non-existent package', async () => {
        const version = await registry.resolveLatest('no-such-package')
        expect(version).toBeNull()
      })

      it('should return latest tag by default', async () => {
        const version = await registry.resolveLatest('tagged-pkg')
        expect(version).toBe('2.0.0')
      })

      it('should resolve "next" tag', async () => {
        const version = await registry.resolveLatest('tagged-pkg', 'next')
        expect(version).toBe('3.0.0-beta.1')
      })

      it('should resolve "alpha" tag', async () => {
        const version = await registry.resolveLatest('tagged-pkg', 'alpha')
        expect(version).toBe('3.0.0-alpha.1')
      })

      it('should resolve "beta" tag', async () => {
        const version = await registry.resolveLatest('tagged-pkg', 'beta')
        expect(version).toBe('3.0.0-beta.1')
      })

      it('should return null for non-existent tag', async () => {
        const version = await registry.resolveLatest('tagged-pkg', 'nonexistent-tag')
        expect(version).toBeNull()
      })
    })

    describe('Dist-tags Support', () => {
      it('should support multiple dist-tags', async () => {
        registry.addPackage({
          name: 'dist-tag-test',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
            '2.0.0-rc.1': {
              version: '2.0.0-rc.1',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': {
            latest: '1.0.0',
            next: '2.0.0-rc.1',
            canary: '2.0.0-rc.1',
          },
        })

        const metadata = await registry.getPackageMetadata('dist-tag-test')
        expect(metadata?.['dist-tags']).toEqual({
          latest: '1.0.0',
          next: '2.0.0-rc.1',
          canary: '2.0.0-rc.1',
        })
      })

      it('should allow adding new dist-tags', async () => {
        registry.addPackage({
          name: 'updatable-tags',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '1.0.0' },
        })

        registry.setDistTag('updatable-tags', 'stable', '1.0.0')
        const version = await registry.resolveLatest('updatable-tags', 'stable')
        expect(version).toBe('1.0.0')
      })

      it('should allow updating existing dist-tags', async () => {
        registry.addPackage({
          name: 'update-tag-test',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
            '1.1.0': {
              version: '1.1.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '1.0.0' },
        })

        registry.setDistTag('update-tag-test', 'latest', '1.1.0')
        const version = await registry.resolveLatest('update-tag-test')
        expect(version).toBe('1.1.0')
      })
    })

    describe('Scoped Package Handling', () => {
      it('should handle @org/package names', async () => {
        registry.addPackage({
          name: '@mycompany/utils',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '1.0.0' },
        })

        const metadata = await registry.getPackageMetadata('@mycompany/utils')
        expect(metadata?.name).toBe('@mycompany/utils')
      })

      it('should handle deeply scoped packages', async () => {
        registry.addPackage({
          name: '@babel/core',
          versions: {
            '7.24.0': {
              version: '7.24.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '7.24.0' },
        })

        const version = await registry.getPackageVersion('@babel/core', '7.24.0')
        expect(version?.version).toBe('7.24.0')
      })

      it('should search scoped packages', async () => {
        registry.addPackage({
          name: '@types/node',
          description: 'TypeScript definitions for Node.js',
          versions: {
            '20.0.0': {
              version: '20.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '20.0.0' },
        })

        const results = await registry.searchPackages('@types')
        expect(results.some((r) => r.name === '@types/node')).toBe(true)
      })

      it('should isolate scoped vs unscoped packages with same name', async () => {
        registry.addPackage({
          name: 'utils',
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '1.0.0' },
        })
        registry.addPackage({
          name: '@myorg/utils',
          versions: {
            '2.0.0': {
              version: '2.0.0',
              dependencies: {},
              devDependencies: {},
              dist: { tarball: '', shasum: '', integrity: '' },
            },
          },
          'dist-tags': { latest: '2.0.0' },
        })

        const unscopedMeta = await registry.getPackageMetadata('utils')
        const scopedMeta = await registry.getPackageMetadata('@myorg/utils')

        expect(unscopedMeta?.['dist-tags'].latest).toBe('1.0.0')
        expect(scopedMeta?.['dist-tags'].latest).toBe('2.0.0')
      })
    })
  })

  describe('Registry Isolation', () => {
    it('should not share state between instances', async () => {
      const registry1 = new MemoryRegistry()
      const registry2 = new MemoryRegistry()

      registry1.addPackage({
        name: 'isolated-pkg',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      const meta1 = await registry1.getPackageMetadata('isolated-pkg')
      const meta2 = await registry2.getPackageMetadata('isolated-pkg')

      expect(meta1).not.toBeNull()
      expect(meta2).toBeNull()
    })

    it('should maintain separate package data', async () => {
      const registry1 = new MemoryRegistry()
      const registry2 = new MemoryRegistry()

      registry1.addPackage({
        name: 'shared-name',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      registry2.addPackage({
        name: 'shared-name',
        versions: {
          '2.0.0': {
            version: '2.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '2.0.0' },
      })

      const version1 = await registry1.resolveLatest('shared-name')
      const version2 = await registry2.resolveLatest('shared-name')

      expect(version1).toBe('1.0.0')
      expect(version2).toBe('2.0.0')
    })

    it('should isolate tarballs between instances', async () => {
      const registry1 = new MemoryRegistry()
      const registry2 = new MemoryRegistry()

      registry1.addPackage({
        name: 'tarball-isolation',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })
      registry1.setTarball('tarball-isolation', '1.0.0', new Uint8Array([1, 2, 3]))

      const tarball1 = await registry1.getTarball('tarball-isolation', '1.0.0')
      const tarball2 = await registry2.getTarball('tarball-isolation', '1.0.0')

      expect(tarball1).not.toBeNull()
      expect(tarball2).toBeNull()
    })
  })

  describe('Error Handling', () => {
    let registry: MemoryRegistry

    beforeEach(() => {
      registry = new MemoryRegistry()
    })

    it('should return null for package not found in getPackageMetadata', async () => {
      const result = await registry.getPackageMetadata('definitely-does-not-exist-12345')
      expect(result).toBeNull()
    })

    it('should return null for version not found in getPackageVersion', async () => {
      registry.addPackage({
        name: 'exists-pkg',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      const result = await registry.getPackageVersion('exists-pkg', '99.99.99')
      expect(result).toBeNull()
    })

    it('should handle empty package name gracefully', async () => {
      const result = await registry.getPackageMetadata('')
      expect(result).toBeNull()
    })

    it('should handle empty version string gracefully', async () => {
      registry.addPackage({
        name: 'test-pkg',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      const result = await registry.getPackageVersion('test-pkg', '')
      expect(result).toBeNull()
    })

    it('should handle invalid scoped package names', async () => {
      const result = await registry.getPackageMetadata('@')
      expect(result).toBeNull()

      const result2 = await registry.getPackageMetadata('@/')
      expect(result2).toBeNull()

      const result3 = await registry.getPackageMetadata('@missing-slash')
      expect(result3).toBeNull()
    })

    it('should not throw on search with empty query', async () => {
      const results = await registry.searchPackages('')
      expect(Array.isArray(results)).toBe(true)
    })

    it('should handle special characters in package names', async () => {
      // These should return null, not throw
      const result1 = await registry.getPackageMetadata('package/../traversal')
      expect(result1).toBeNull()

      const result2 = await registry.getPackageMetadata('package%20with%20encoding')
      expect(result2).toBeNull()
    })
  })

  describe('Caching Behavior Interface', () => {
    let registry: MemoryRegistry

    beforeEach(() => {
      registry = new MemoryRegistry()
    })

    it('should support cache configuration', () => {
      const configuredRegistry = new MemoryRegistry({
        cache: {
          enabled: true,
          ttl: 3600,
          maxSize: 100,
          strategy: 'lru',
        },
      })

      expect(configuredRegistry.getCacheConfig()).toEqual({
        enabled: true,
        ttl: 3600,
        maxSize: 100,
        strategy: 'lru',
      })
    })

    it('should have default cache configuration', () => {
      const config = registry.getCacheConfig()
      expect(config).toHaveProperty('enabled')
      expect(config).toHaveProperty('ttl')
    })

    it('should support cache invalidation', async () => {
      registry.addPackage({
        name: 'cache-test',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      // First call (potentially cached)
      await registry.getPackageMetadata('cache-test')

      // Invalidate cache
      registry.invalidateCache('cache-test')

      // Should still work after invalidation
      const result = await registry.getPackageMetadata('cache-test')
      expect(result?.name).toBe('cache-test')
    })

    it('should support clearing entire cache', async () => {
      registry.addPackage({
        name: 'cache-clear-test',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      await registry.getPackageMetadata('cache-clear-test')

      registry.clearCache()

      // Should still work after clear
      const result = await registry.getPackageMetadata('cache-clear-test')
      expect(result?.name).toBe('cache-clear-test')
    })

    it('should allow disabling cache', () => {
      const noCacheRegistry = new MemoryRegistry({
        cache: {
          enabled: false,
          ttl: 0,
          maxSize: 0,
          strategy: 'none',
        },
      })

      expect(noCacheRegistry.getCacheConfig().enabled).toBe(false)
    })

    it('should support LRU cache strategy', () => {
      const lruRegistry = new MemoryRegistry({
        cache: {
          enabled: true,
          ttl: 3600,
          maxSize: 10,
          strategy: 'lru',
        },
      })

      expect(lruRegistry.getCacheConfig().strategy).toBe('lru')
    })

    it('should support TTL-based cache strategy', () => {
      const ttlRegistry = new MemoryRegistry({
        cache: {
          enabled: true,
          ttl: 60,
          maxSize: 1000,
          strategy: 'ttl',
        },
      })

      expect(ttlRegistry.getCacheConfig().strategy).toBe('ttl')
    })
  })

  describe('Additional Edge Cases', () => {
    let registry: MemoryRegistry

    beforeEach(() => {
      registry = new MemoryRegistry()
    })

    it('should handle package with many versions', async () => {
      const versions: Record<string, PackageVersion> = {}
      for (let i = 0; i < 100; i++) {
        versions[`1.0.${i}`] = {
          version: `1.0.${i}`,
          dependencies: {},
          devDependencies: {},
          dist: { tarball: '', shasum: '', integrity: '' },
        }
      }

      registry.addPackage({
        name: 'many-versions',
        versions,
        'dist-tags': { latest: '1.0.99' },
      })

      const metadata = await registry.getPackageMetadata('many-versions')
      expect(Object.keys(metadata?.versions || {}).length).toBe(100)
    })

    it('should handle package with complex dependencies', async () => {
      registry.addPackage({
        name: 'complex-deps',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {
              'dep-a': '^1.0.0',
              'dep-b': '~2.0.0',
              'dep-c': '>=3.0.0 <4.0.0',
              'dep-d': '1.0.0 || 2.0.0',
              'dep-e': '*',
            },
            devDependencies: {
              vitest: '^2.0.0',
              typescript: '^5.0.0',
            },
            peerDependencies: {
              react: '>=18.0.0',
            },
            optionalDependencies: {
              'optional-dep': '^1.0.0',
            },
            dist: { tarball: '', shasum: '', integrity: '' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      const version = await registry.getPackageVersion('complex-deps', '1.0.0')
      expect(version?.dependencies?.['dep-a']).toBe('^1.0.0')
      expect(version?.peerDependencies?.['react']).toBe('>=18.0.0')
    })

    it('should handle unicode package names', async () => {
      // npm allows some unicode, but typically packages use ASCII
      // This tests edge case handling
      const result = await registry.getPackageMetadata('package-with-\u00e9')
      expect(result).toBeNull()
    })

    it('should handle very long package names', async () => {
      const longName = 'a'.repeat(214) // npm limit is 214 characters
      const result = await registry.getPackageMetadata(longName)
      expect(result).toBeNull()
    })

    it('should preserve version metadata including engines and repository', async () => {
      registry.addPackage({
        name: 'full-metadata',
        versions: {
          '1.0.0': {
            name: 'full-metadata',
            version: '1.0.0',
            description: 'Test package',
            main: 'index.js',
            module: 'index.mjs',
            types: 'index.d.ts',
            dependencies: {},
            devDependencies: {},
            bin: { 'my-cli': './bin/cli.js' },
            scripts: { test: 'vitest', build: 'tsup' },
            engines: { node: '>=18', npm: '>=9' },
            repository: { type: 'git', url: 'https://github.com/test/full-metadata' },
            dist: {
              tarball: 'https://example.com.ai/full-metadata-1.0.0.tgz',
              shasum: 'abc123',
              integrity: 'sha512-xyz',
              fileCount: 50,
              unpackedSize: 500000,
            },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      })

      const version = await registry.getPackageVersion('full-metadata', '1.0.0')
      expect(version?.engines?.node).toBe('>=18')
      expect(version?.repository?.type).toBe('git')
      expect(version?.bin?.['my-cli']).toBe('./bin/cli.js')
      expect(version?.dist.fileCount).toBe(50)
    })
  })
})
