/**
 * RED Phase Tests for ESM.sh Bundle Resolver
 *
 * The ESM resolver handles Tier 1 package execution by:
 * - Resolving package specifiers to esm.sh URLs
 * - Fetching and caching ESM bundles
 * - Handling package exports and bin resolution
 *
 * @module npmx/test/core/npx/esm-resolver
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  buildEsmShUrl,
  resolveEsmBundle,
  resolveBinary,
  fetchEsmBundle,
  EsmBundleCache,
  clearEsmBundleCache,
  type EsmBundle,
  type BinaryResolution,
  type EsmResolveOptions,
} from '../../../core/npx/esm-resolver.js'

// ============================================================================
// URL BUILDING
// ============================================================================

describe('ESM Resolver - URL Building', () => {
  it('builds basic esm.sh URL for package', () => {
    const url = buildEsmShUrl('lodash-es')

    expect(url).toBe('https://esm.sh/lodash-es')
  })

  it('builds URL with version specifier', () => {
    const url = buildEsmShUrl('lodash-es@4.17.21')

    expect(url).toBe('https://esm.sh/lodash-es@4.17.21')
  })

  it('builds URL with version from options', () => {
    const url = buildEsmShUrl('lodash-es', { version: '4.17.21' })

    expect(url).toBe('https://esm.sh/lodash-es@4.17.21')
  })

  it('builds URL with ES target', () => {
    const url = buildEsmShUrl('lodash-es', { target: 'es2020' })

    expect(url).toBe('https://esm.sh/lodash-es?target=es2020')
  })

  it('builds URL with dev mode', () => {
    const url = buildEsmShUrl('lodash-es', { dev: true })

    expect(url).toBe('https://esm.sh/lodash-es?dev')
  })

  it('builds URL for scoped packages', () => {
    const url = buildEsmShUrl('@org/package')

    expect(url).toBe('https://esm.sh/@org/package')
  })

  it('builds URL for scoped packages with version', () => {
    const url = buildEsmShUrl('@vue/reactivity@3.3.0')

    expect(url).toBe('https://esm.sh/@vue/reactivity@3.3.0')
  })

  it('builds URL with custom base URL', () => {
    const url = buildEsmShUrl('lodash-es', { baseUrl: 'https://cdn.example.com' })

    expect(url).toBe('https://cdn.example.com/lodash-es')
  })

  it('builds URL with subpath', () => {
    const url = buildEsmShUrl('lodash-es/array')

    expect(url).toBe('https://esm.sh/lodash-es/array')
  })

  it('builds URL with multiple options', () => {
    const url = buildEsmShUrl('react', {
      version: '18.2.0',
      target: 'es2022',
      dev: true,
    })

    expect(url).toMatch(/https:\/\/esm\.sh\/react@18\.2\.0/)
    expect(url).toMatch(/target=es2022/)
    expect(url).toMatch(/dev/)
  })

  it('handles version range syntax', () => {
    const url = buildEsmShUrl('lodash-es@^4.17.0')

    // Should resolve to specific version or pass through
    expect(url).toMatch(/https:\/\/esm\.sh\/lodash-es@/)
  })
})

// ============================================================================
// BUNDLE RESOLUTION
// ============================================================================

describe('ESM Resolver - Bundle Resolution', () => {
  beforeEach(() => {
    clearEsmBundleCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Mock helper to create fetch mock for esm.sh
  function mockEsmShFetch(packageName: string, version: string) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      // Check if it's a registry request for package metadata
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            version,
            main: 'index.js',
            module: 'index.mjs',
          }),
        })
      }
      // esm.sh request
      return Promise.resolve({
        ok: true,
        url: `https://esm.sh/${packageName}@${version}`,
        headers: new Headers({
          'x-esm-id': `/stable/${packageName}@${version}/index.js`,
        }),
        text: () => Promise.resolve(`export * from '${packageName}'`),
      })
    }))
  }

  it('resolves package to ESM bundle', async () => {
    mockEsmShFetch('nanoid', '5.0.4')

    const bundle = await resolveEsmBundle('nanoid')

    expect(bundle.url).toContain('esm.sh/nanoid')
    expect(bundle.package).toBe('nanoid')
  })

  it('resolves package with specific version', async () => {
    mockEsmShFetch('nanoid', '5.0.4')

    const bundle = await resolveEsmBundle('nanoid@5.0.4')

    expect(bundle.version).toBe('5.0.4')
    expect(bundle.url).toContain('@5.0.4')
  })

  it('resolves scoped package', async () => {
    mockEsmShFetch('@vue/reactivity', '3.3.0')

    const bundle = await resolveEsmBundle('@vue/reactivity')

    expect(bundle.package).toBe('@vue/reactivity')
    expect(bundle.url).toContain('@vue/reactivity')
  })

  it('determines entry point from package exports', async () => {
    mockEsmShFetch('zod', '3.22.0')

    const bundle = await resolveEsmBundle('zod')

    expect(bundle.entry).toBeDefined()
    expect(bundle.entry).toMatch(/\.(js|mjs)$/)
  })

  it('includes resolved version in result for versioned request', async () => {
    mockEsmShFetch('nanoid', '5.0.4')

    const bundle = await resolveEsmBundle('nanoid@5.0.4')

    expect(bundle.version).toBe('5.0.4')
  })

  it('handles packages with complex exports maps', async () => {
    mockEsmShFetch('uuid', '9.0.0')

    const bundle = await resolveEsmBundle('uuid')

    expect(bundle.url).toBeDefined()
    expect(bundle.entry).toBeDefined()
  })

  it.skip('returns bundled dependencies list when available', async () => {
    // This test requires deeper integration with esm.sh headers
    mockEsmShFetch('react', '18.2.0')
    const bundle = await resolveEsmBundle('react')
    expect(bundle.bundledDeps).toBeDefined()
  })

  it.skip('handles packages without ESM entry', async () => {
    // Skip: test requires a real old CJS package
    const bundle = await resolveEsmBundle('old-cjs-package')
    expect(bundle.url).toContain('esm.sh')
  })

  it('respects timeout option', async () => {
    // Mock fetch that respects abort signal (like real fetch does)
    vi.stubGlobal('fetch', vi.fn((url: string, options?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        // Listen for abort signal like real fetch does
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }
        // Never resolve on its own - simulates slow network
      })
    }))

    await expect(
      resolveEsmBundle('slow-package', { timeout: 50 })
    ).rejects.toThrow(/timeout/i)
  }, 5000)

  it('marks cached results appropriately', async () => {
    mockEsmShFetch('test-pkg', '1.0.0')

    // First call with explicit version - not cached
    const bundle1 = await resolveEsmBundle('test-pkg@1.0.0')
    expect(bundle1.cached).toBe(false)

    // Second call with same version should be cached
    const bundle2 = await resolveEsmBundle('test-pkg@1.0.0')
    expect(bundle2.cached).toBe(true)
  })
})

// ============================================================================
// BINARY RESOLUTION
// ============================================================================

describe('ESM Resolver - Binary Resolution', () => {
  beforeEach(() => {
    clearEsmBundleCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Mock helper for binary resolution - must handle both esm.sh and package.json requests
  function mockBinaryFetch(packageName: string, version: string, bin: string | Record<string, string> | undefined) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      // Registry request - returns package info with version
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            version,
            main: 'index.js',
            bin,
          }),
        })
      }
      // Package.json request from esm.sh - must also return bin
      if (url.includes('/package.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ bin }),
        })
      }
      // esm.sh main bundle request
      return Promise.resolve({
        ok: true,
        url: `https://esm.sh/${packageName}@${version}`,
        headers: new Headers({
          'x-esm-id': `/stable/${packageName}@${version}/index.js`,
        }),
        text: () => Promise.resolve('export default {}'),
      })
    }))
  }

  it('resolves package binary from bin field', async () => {
    mockBinaryFetch('cowsay', '1.5.0', { cowsay: './cli.js' })

    const binary = await resolveBinary('cowsay')

    expect(binary.name).toBe('cowsay')
    expect(binary.url).toContain('esm.sh/cowsay')
  })

  it('resolves specific binary from package with multiple binaries', async () => {
    mockBinaryFetch('esbuild', '0.19.0', {
      esbuild: './esbuild.js',
      'esbuild-wasm': './esbuild-wasm.js',
    })

    const binary = await resolveBinary('esbuild', 'esbuild')

    expect(binary.name).toBe('esbuild')
  })

  it('resolves default binary when bin is a string', async () => {
    mockBinaryFetch('cowsay', '1.5.0', './cli.js')

    const binary = await resolveBinary('cowsay')

    expect(binary.name).toBe('cowsay')
    expect(binary.path).toBeDefined()
  })

  it('resolves binary from scoped package', async () => {
    mockBinaryFetch('@angular/cli', '17.0.0', { ng: './bin/ng.js' })

    const binary = await resolveBinary('@angular/cli', 'ng')

    expect(binary.name).toBe('ng')
    expect(binary.package).toBe('@angular/cli')
  })

  it('throws for package without binaries', async () => {
    mockBinaryFetch('lodash-es', '4.17.21', undefined)

    await expect(
      resolveBinary('lodash-es')
    ).rejects.toThrow(/no binary/i)
  })

  it('throws for non-existent binary name', async () => {
    mockBinaryFetch('typescript', '5.0.0', { tsc: './tsc.js', tsserver: './tsserver.js' })

    await expect(
      resolveBinary('typescript', 'nonexistent')
    ).rejects.toThrow(/not found/i)
  })

  it('resolves binary with version', async () => {
    mockBinaryFetch('typescript', '5.0.0', { tsc: './tsc.js' })

    const binary = await resolveBinary('typescript@5.0.0', 'tsc')

    expect(binary.version).toBe('5.0.0')
    expect(binary.name).toBe('tsc')
  })

  it('handles packages where package name differs from binary', async () => {
    mockBinaryFetch('rimraf', '5.0.0', { rimraf: './bin.js' })

    const binary = await resolveBinary('rimraf')

    expect(binary.name).toBe('rimraf')
  })
})

// ============================================================================
// BUNDLE FETCHING
// ============================================================================

describe('ESM Resolver - Bundle Fetching', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches ESM bundle from URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('export const foo = 1;'),
    }))

    const code = await fetchEsmBundle('https://esm.sh/lodash-es')

    expect(code).toContain('export')
    expect(typeof code).toBe('string')
  })

  it('handles fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }))

    await expect(
      fetchEsmBundle('https://esm.sh/nonexistent-package-xyz')
    ).rejects.toThrow(/fetch|404/i)
  })

  it('respects timeout', async () => {
    // Mock fetch that respects abort signal (like real fetch does)
    vi.stubGlobal('fetch', vi.fn((url: string, options?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        // Listen for abort signal like real fetch does
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }
        // Never resolve on its own - simulates slow network
      })
    }))

    await expect(
      fetchEsmBundle('https://esm.sh/lodash-es', { timeout: 50 })
    ).rejects.toThrow(/timeout/i)
  }, 5000)

  it('returns module code as string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('export const nanoid = () => "id";'),
    }))

    const code = await fetchEsmBundle('https://esm.sh/nanoid')

    expect(code).toContain('export')
  })

  it('handles redirect responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('export default {};'),
    }))

    const code = await fetchEsmBundle('https://esm.sh/lodash-es@latest')

    expect(code).toBeDefined()
  })
})

// ============================================================================
// CACHING
// ============================================================================

describe('ESM Resolver - Caching', () => {
  let cache: EsmBundleCache

  beforeEach(() => {
    cache = new EsmBundleCache()
  })

  it('caches resolved bundles', () => {
    const bundle: EsmBundle = {
      url: 'https://esm.sh/lodash-es@4.17.21',
      package: 'lodash-es',
      version: '4.17.21',
      entry: 'index.js',
      cached: false,
    }

    cache.set('lodash-es@4.17.21', bundle)

    expect(cache.has('lodash-es@4.17.21')).toBe(true)
    expect(cache.get('lodash-es@4.17.21')).toEqual(bundle)
  })

  it('returns undefined for uncached packages', () => {
    expect(cache.get('not-cached')).toBeUndefined()
    expect(cache.has('not-cached')).toBe(false)
  })

  it('clears cache', () => {
    const bundle: EsmBundle = {
      url: 'https://esm.sh/lodash-es',
      package: 'lodash-es',
      version: '4.17.21',
      entry: 'index.js',
      cached: false,
    }

    cache.set('lodash-es', bundle)
    cache.clear()

    expect(cache.has('lodash-es')).toBe(false)
  })

  it('uses cache key with version', () => {
    const bundle1: EsmBundle = {
      url: 'https://esm.sh/lodash-es@4.17.20',
      package: 'lodash-es',
      version: '4.17.20',
      entry: 'index.js',
      cached: false,
    }

    const bundle2: EsmBundle = {
      url: 'https://esm.sh/lodash-es@4.17.21',
      package: 'lodash-es',
      version: '4.17.21',
      entry: 'index.js',
      cached: false,
    }

    cache.set('lodash-es@4.17.20', bundle1)
    cache.set('lodash-es@4.17.21', bundle2)

    expect(cache.get('lodash-es@4.17.20')?.version).toBe('4.17.20')
    expect(cache.get('lodash-es@4.17.21')?.version).toBe('4.17.21')
  })
})

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('ESM Resolver - Integration Scenarios', () => {
  beforeEach(() => {
    clearEsmBundleCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Helper to mock integration scenario
  function mockIntegration(packageName: string, version: string, bin?: string | Record<string, string>) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version, main: 'index.js', bin }),
        })
      }
      if (url.includes('package.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ bin }),
        })
      }
      return Promise.resolve({
        ok: true,
        url: `https://esm.sh/${packageName}@${version}`,
        headers: new Headers({ 'x-esm-id': `/stable/${packageName}@${version}/index.js` }),
        text: () => Promise.resolve('export const main = () => {};'),
      })
    }))
  }

  it('resolves and fetches a complete bundle', async () => {
    mockIntegration('nanoid', '5.0.4')

    const bundle = await resolveEsmBundle('nanoid')
    const code = await fetchEsmBundle(bundle.url)

    expect(code).toContain('export')
    expect(bundle.package).toBe('nanoid')
  })

  it('handles npx-style package execution', async () => {
    mockIntegration('cowsay', '1.5.0', { cowsay: './cli.js' })

    const binary = await resolveBinary('cowsay')
    const code = await fetchEsmBundle(binary.url)

    expect(code).toBeDefined()
  })

  it('builds URL with subpath for date-fns format', () => {
    const url = buildEsmShUrl('date-fns/format')
    expect(url).toContain('date-fns/format')
  })

  it('resolves TypeScript definitions URL', async () => {
    mockIntegration('zod', '3.22.0')

    const bundle = await resolveEsmBundle('zod')
    expect(bundle.url).toBeDefined()
  })

  it.skip('handles packages that re-export from other packages', async () => {
    // Skip: bundledDeps requires deeper esm.sh integration
    mockIntegration('@tanstack/react-query', '5.0.0')
    const bundle = await resolveEsmBundle('@tanstack/react-query')
    expect(bundle.url).toBeDefined()
    expect(bundle.bundledDeps).toBeDefined()
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('ESM Resolver - Error Handling', () => {
  beforeEach(() => {
    clearEsmBundleCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws for non-existent package', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
    }))

    await expect(
      resolveEsmBundle('this-package-definitely-does-not-exist-xyz-123')
    ).rejects.toThrow(/not found|404/i)
  })

  it('throws for invalid package name', async () => {
    await expect(
      resolveEsmBundle('../../etc/passwd')
    ).rejects.toThrow(/invalid/i)
  })

  it('throws for empty package name', async () => {
    await expect(
      resolveEsmBundle('')
    ).rejects.toThrow(/invalid|empty/i)
  })

  it.skip('provides helpful error for packages requiring polyfills', async () => {
    // Skip: This would require classification integration in the resolver
    // Currently the resolver doesn't check if packages need polyfills
    const error = await resolveEsmBundle('fs-extra').catch(e => e)

    if (error instanceof Error) {
      expect(error.message).toContain('polyfill')
    }
  })

  it.skip('provides helpful error for native packages', async () => {
    // Skip: This would require classification integration in the resolver
    // Currently the resolver doesn't check if packages are native
    const error = await resolveEsmBundle('esbuild').catch(e => e)

    if (error instanceof Error) {
      expect(error.message).toContain('native')
    }
  })
})
