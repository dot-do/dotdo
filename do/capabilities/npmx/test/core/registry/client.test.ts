/**
 * RegistryClient Tests
 *
 * Tests for the npm registry HTTP client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RegistryClient } from '../../../core/registry/client.js'
import { FetchError, TimeoutError } from '../../../core/errors/index.js'

// =============================================================================
// Mock Response Helpers
// =============================================================================

function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

function createMockPackageMetadata(name: string, versions: string[]) {
  const versionsObj: Record<string, unknown> = {}
  const timeObj: Record<string, string> = {
    created: '2020-01-01T00:00:00.000Z',
    modified: '2020-06-01T00:00:00.000Z',
  }

  versions.forEach((v, i) => {
    versionsObj[v] = {
      name,
      version: v,
      description: `${name} version ${v}`,
      dependencies: {},
      devDependencies: {},
      dist: {
        tarball: `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`,
        shasum: `sha${i}`,
        integrity: `sha512-${i}`,
      },
    }
    timeObj[v] = `2020-0${i + 1}-01T00:00:00.000Z`
  })

  return {
    name,
    description: `${name} package`,
    versions: versionsObj,
    'dist-tags': {
      latest: versions[versions.length - 1],
      next: versions[versions.length - 1],
    },
    time: timeObj,
    maintainers: [{ name: 'testuser', email: 'test@example.com' }],
    license: 'MIT',
    readme: `# ${name}`,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('RegistryClient', () => {
  describe('constructor', () => {
    it('should use default registry URL', () => {
      const client = new RegistryClient()
      expect(client.getCacheConfig()).toBeDefined()
    })

    it('should accept custom registry URL', () => {
      const client = new RegistryClient({
        registry: 'https://npm.pkg.github.com',
      })
      expect(client.getCacheConfig()).toBeDefined()
    })

    it('should strip trailing slash from registry URL', () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 404))
      const client = new RegistryClient({
        registry: 'https://registry.example.com/',
        fetch: mockFetch,
      })

      // Make a request to verify URL formatting
      client.getPackageMetadata('test-pkg')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.example.com/test-pkg',
        expect.any(Object)
      )
    })

    it('should accept custom cache configuration', () => {
      const client = new RegistryClient({
        cache: {
          enabled: false,
          ttl: 600,
          maxSize: 50,
        },
      })
      const config = client.getCacheConfig()
      expect(config.enabled).toBe(false)
      expect(config.ttl).toBe(600)
      expect(config.maxSize).toBe(50)
    })
  })

  describe('getPackageMetadata', () => {
    it('should fetch package metadata from registry', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.20', '4.17.21'])
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

      const client = new RegistryClient({ fetch: mockFetch })
      const metadata = await client.getPackageMetadata('lodash')

      expect(metadata).not.toBeNull()
      expect(metadata?.name).toBe('lodash')
      expect(metadata?.versions['4.17.21']).toBeDefined()
      expect(metadata?.['dist-tags'].latest).toBe('4.17.21')
    })

    it('should return null for 404 response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 404))

      const client = new RegistryClient({ fetch: mockFetch })
      const metadata = await client.getPackageMetadata('nonexistent-pkg-xyz')

      expect(metadata).toBeNull()
    })

    it('should handle scoped packages', async () => {
      const mockData = createMockPackageMetadata('@babel/core', ['7.23.0', '7.24.0'])
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

      const client = new RegistryClient({ fetch: mockFetch })
      const metadata = await client.getPackageMetadata('@babel/core')

      expect(metadata).not.toBeNull()
      expect(metadata?.name).toBe('@babel/core')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('@babel%2Fcore'),
        expect.any(Object)
      )
    })

    it('should throw FetchError for non-404 errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 500))

      const client = new RegistryClient({ fetch: mockFetch })

      await expect(client.getPackageMetadata('some-pkg')).rejects.toThrow(FetchError)
    })

    it('should cache metadata', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

      const client = new RegistryClient({ fetch: mockFetch })

      // First call - should fetch
      await client.getPackageMetadata('lodash')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      await client.getPackageMetadata('lodash')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should bypass cache when disabled', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(createMockResponse(mockData))
      )

      const client = new RegistryClient({
        fetch: mockFetch,
        cache: { enabled: false },
      })

      await client.getPackageMetadata('lodash')
      await client.getPackageMetadata('lodash')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should return null for empty package name', async () => {
      const client = new RegistryClient()
      const metadata = await client.getPackageMetadata('')
      expect(metadata).toBeNull()
    })

    it('should return null for invalid scoped package names', async () => {
      const client = new RegistryClient()

      expect(await client.getPackageMetadata('@')).toBeNull()
      expect(await client.getPackageMetadata('@/')).toBeNull()
      expect(await client.getPackageMetadata('@missing-slash')).toBeNull()
    })

    it('should return null for path traversal attempts', async () => {
      const client = new RegistryClient()

      expect(await client.getPackageMetadata('../etc/passwd')).toBeNull()
      expect(await client.getPackageMetadata('pkg%2F..%2Fetc')).toBeNull()
    })
  })

  describe('getPackageVersion', () => {
    let client: RegistryClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.20', '4.17.21'])
      mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))
      client = new RegistryClient({ fetch: mockFetch })
    })

    it('should return specific version metadata', async () => {
      const version = await client.getPackageVersion('lodash', '4.17.21')

      expect(version).not.toBeNull()
      expect(version?.version).toBe('4.17.21')
      expect(version?.dist.tarball).toContain('lodash-4.17.21.tgz')
    })

    it('should return null for non-existent version', async () => {
      const version = await client.getPackageVersion('lodash', '1.0.0')
      expect(version).toBeNull()
    })

    it('should return null for non-existent package', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, 404))
      const version = await client.getPackageVersion('nonexistent', '1.0.0')
      expect(version).toBeNull()
    })

    it('should return null for empty version string', async () => {
      const version = await client.getPackageVersion('lodash', '')
      expect(version).toBeNull()
    })
  })

  describe('getTarball', () => {
    it('should download tarball bytes', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const tarballBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]) // gzip magic bytes

      const mockFetch = vi.fn()
        .mockResolvedValueOnce(createMockResponse(mockData)) // metadata
        .mockResolvedValueOnce(new Response(tarballBytes, { status: 200 })) // tarball

      const client = new RegistryClient({ fetch: mockFetch })
      const tarball = await client.getTarball('lodash', '4.17.21')

      expect(tarball).not.toBeNull()
      expect(tarball).toBeInstanceOf(Uint8Array)
      expect(tarball?.length).toBe(4)
    })

    it('should return null for non-existent package', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 404))

      const client = new RegistryClient({ fetch: mockFetch })
      const tarball = await client.getTarball('nonexistent', '1.0.0')

      expect(tarball).toBeNull()
    })

    it('should return null for non-existent version', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

      const client = new RegistryClient({ fetch: mockFetch })
      const tarball = await client.getTarball('lodash', '1.0.0')

      expect(tarball).toBeNull()
    })
  })

  describe('searchPackages', () => {
    it('should search packages', async () => {
      const searchResponse = {
        objects: [
          {
            package: {
              name: 'lodash',
              version: '4.17.21',
              description: 'Lodash modular utilities',
              keywords: ['util', 'functional'],
              date: '2020-01-01T00:00:00.000Z',
              publisher: { username: 'jdalton' },
            },
            score: {
              final: 0.9,
              detail: { quality: 0.9, popularity: 0.95, maintenance: 0.85 },
            },
          },
        ],
        total: 1,
        time: '2020-01-01T00:00:00.000Z',
      }

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(searchResponse))
      const client = new RegistryClient({ fetch: mockFetch })

      const results = await client.searchPackages('lodash')

      expect(results).toHaveLength(1)
      expect(results[0]?.name).toBe('lodash')
      expect(results[0]?.version).toBe('4.17.21')
      expect(results[0]?.score?.final).toBe(0.9)
    })

    it('should return empty array for empty query', async () => {
      const client = new RegistryClient()
      const results = await client.searchPackages('')
      expect(results).toEqual([])
    })

    it('should pass search options to API', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse({ objects: [], total: 0 }))
      const client = new RegistryClient({ fetch: mockFetch })

      await client.searchPackages('test', {
        limit: 10,
        offset: 5,
        quality: 0.8,
        popularity: 0.7,
        maintenance: 0.6,
      })

      const url = mockFetch.mock.calls[0]?.[0] as string
      expect(url).toContain('text=test')
      expect(url).toContain('size=10')
      expect(url).toContain('from=5')
      expect(url).toContain('quality=0.8')
      expect(url).toContain('popularity=0.7')
      expect(url).toContain('maintenance=0.6')
    })
  })

  describe('resolveLatest', () => {
    let client: RegistryClient

    beforeEach(() => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.20', '4.17.21'])
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))
      client = new RegistryClient({ fetch: mockFetch })
    })

    it('should resolve latest tag by default', async () => {
      const version = await client.resolveLatest('lodash')
      expect(version).toBe('4.17.21')
    })

    it('should resolve next tag', async () => {
      const version = await client.resolveLatest('lodash', 'next')
      expect(version).toBe('4.17.21')
    })

    it('should return null for non-existent tag', async () => {
      const version = await client.resolveLatest('lodash', 'nonexistent-tag')
      expect(version).toBeNull()
    })

    it('should return null for non-existent package', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 404))
      const client = new RegistryClient({ fetch: mockFetch })

      const version = await client.resolveLatest('nonexistent')
      expect(version).toBeNull()
    })
  })

  describe('cache management', () => {
    it('should invalidate cache for specific package', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(createMockResponse(mockData))
      )

      const client = new RegistryClient({ fetch: mockFetch })

      await client.getPackageMetadata('lodash')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      client.invalidateCache('lodash')

      await client.getPackageMetadata('lodash')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should clear entire cache', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(createMockResponse(mockData))
      )

      const client = new RegistryClient({ fetch: mockFetch })

      await client.getPackageMetadata('lodash')
      client.clearCache()
      await client.getPackageMetadata('lodash')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should track cache statistics', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

      const client = new RegistryClient({ fetch: mockFetch })

      // Miss
      await client.getPackageMetadata('lodash')

      // Hit
      await client.getPackageMetadata('lodash')

      const stats = client.getCacheStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.hitRate).toBe(50)
    })
  })

  describe('retry behavior', () => {
    it('should retry on 5xx errors', async () => {
      const mockData = createMockPackageMetadata('lodash', ['4.17.21'])
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(createMockResponse(null, 500))
        .mockResolvedValueOnce(createMockResponse(null, 503))
        .mockResolvedValueOnce(createMockResponse(mockData))

      const client = new RegistryClient({
        fetch: mockFetch,
        retries: 3,
        retryDelay: 1, // Fast retries for tests
      })

      const metadata = await client.getPackageMetadata('lodash')

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(metadata?.name).toBe('lodash')
    })

    it('should give up after max retries', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 500))

      const client = new RegistryClient({
        fetch: mockFetch,
        retries: 2,
        retryDelay: 1,
      })

      await expect(client.getPackageMetadata('lodash')).rejects.toThrow(FetchError)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not retry on 4xx errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(null, 403))

      const client = new RegistryClient({
        fetch: mockFetch,
        retries: 3,
        retryDelay: 1,
      })

      await expect(client.getPackageMetadata('lodash')).rejects.toThrow(FetchError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('timeout behavior', () => {
    it('should throw TimeoutError on timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        // Simulate a slow request that gets aborted
        return new Promise((_resolve, reject) => {
          const abortHandler = () => {
            const error = new Error('Aborted')
            error.name = 'AbortError'
            reject(error)
          }
          options?.signal?.addEventListener('abort', abortHandler)
        })
      })

      const client = new RegistryClient({
        fetch: mockFetch,
        timeout: 10, // Very short timeout
        retries: 1,
        retryDelay: 1,
      })

      await expect(client.getPackageMetadata('lodash')).rejects.toThrow(TimeoutError)
    })
  })

  describe('RegistryBackend interface compliance', () => {
    it('should implement all required methods', () => {
      const client = new RegistryClient()

      expect(typeof client.getPackageMetadata).toBe('function')
      expect(typeof client.getPackageVersion).toBe('function')
      expect(typeof client.getTarball).toBe('function')
      expect(typeof client.searchPackages).toBe('function')
      expect(typeof client.resolveLatest).toBe('function')
    })
  })
})
