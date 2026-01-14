/**
 * NPM Registry Client Tests
 *
 * Comprehensive tests for the npm registry client implementation.
 * Covers package metadata fetching, tarball downloading, version resolution,
 * and authentication with npm registries.
 *
 * RED phase: These tests are written to fail until implementation is complete.
 */

import { describe, it, expect } from 'vitest'

// Imports from modules that don't exist yet (RED phase)
import {
  NpmRegistryClient,
  type VersionDistribution,
} from './registry-client.js'

import {
  parsePackageSpec,
  resolveVersion,
  matchesRange,
  sortVersions,
  getLatestVersion,
} from './version-resolver.js'

import {
  extractTarball,
  validateIntegrity,
  computeShasum,
} from './tarball.js'

// =============================================================================
// REGISTRY CLIENT INITIALIZATION TESTS
// =============================================================================

describe('NpmRegistryClient', () => {
  describe('initialization', () => {
    it('should use default npm registry', () => {
      const client = new NpmRegistryClient()

      expect(client.registryUrl).toBe('https://registry.npmjs.org')
    })

    it('should accept custom registry URL', () => {
      const client = new NpmRegistryClient({
        registry: 'https://npm.pkg.github.com',
      })

      expect(client.registryUrl).toBe('https://npm.pkg.github.com')
    })

    it('should normalize registry URL (remove trailing slash)', () => {
      const client = new NpmRegistryClient({
        registry: 'https://registry.npmjs.org/',
      })

      expect(client.registryUrl).toBe('https://registry.npmjs.org')
    })

    it('should accept authentication credentials', () => {
      const client = new NpmRegistryClient({
        auth: {
          token: 'npm_abcdef123456',
        },
      })

      expect(client.isAuthenticated).toBe(true)
    })

    it('should accept basic auth credentials', () => {
      const client = new NpmRegistryClient({
        auth: {
          username: 'user',
          password: 'pass',
        },
      })

      expect(client.isAuthenticated).toBe(true)
    })

    it('should configure request timeout', () => {
      const client = new NpmRegistryClient({
        timeout: 30000,
      })

      expect(client.timeout).toBe(30000)
    })

    it('should use default timeout of 60 seconds', () => {
      const client = new NpmRegistryClient()

      expect(client.timeout).toBe(60000)
    })

    it('should configure retry behavior', () => {
      const client = new NpmRegistryClient({
        retries: 3,
        retryDelay: 1000,
      })

      expect(client.retries).toBe(3)
      expect(client.retryDelay).toBe(1000)
    })

    it('should configure custom user agent', () => {
      const client = new NpmRegistryClient({
        userAgent: 'bashx.do/0.1.0',
      })

      expect(client.userAgent).toContain('bashx.do')
    })
  })

  describe('getPackageMetadata', () => {
    it('should fetch full package metadata', async () => {
      const client = new NpmRegistryClient()
      const metadata = await client.getPackageMetadata('lodash')

      expect(metadata).toBeDefined()
      expect(metadata.name).toBe('lodash')
      expect(metadata.versions).toBeDefined()
      expect(Object.keys(metadata.versions).length).toBeGreaterThan(0)
    })

    it('should include dist-tags', async () => {
      const client = new NpmRegistryClient()
      const metadata = await client.getPackageMetadata('express')

      expect(metadata['dist-tags']).toBeDefined()
      expect(metadata['dist-tags'].latest).toBeDefined()
      expect(metadata['dist-tags'].latest).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('should include version-specific metadata', async () => {
      const client = new NpmRegistryClient()
      const metadata = await client.getPackageMetadata('react')
      const latestVersion = metadata['dist-tags'].latest
      const versionData = metadata.versions[latestVersion]

      expect(versionData).toBeDefined()
      expect(versionData.name).toBe('react')
      expect(versionData.version).toBe(latestVersion)
      expect(versionData.dependencies).toBeDefined()
    })

    it('should include distribution info', async () => {
      const client = new NpmRegistryClient()
      const metadata = await client.getPackageMetadata('typescript')
      const latestVersion = metadata['dist-tags'].latest
      const dist = metadata.versions[latestVersion].dist

      expect(dist).toBeDefined()
      expect(dist.tarball).toMatch(/^https:\/\//)
      expect(dist.shasum).toMatch(/^[0-9a-f]{40}$/)
      expect(dist.integrity).toMatch(/^sha512-/)
    })

    it('should fetch abbreviated metadata with Accept header', async () => {
      const client = new NpmRegistryClient()
      const metadata = await client.getPackageMetadata('chalk', {
        abbreviated: true,
      })

      expect(metadata.name).toBe('chalk')
      expect(metadata['dist-tags']).toBeDefined()
      // Abbreviated metadata has less detail
      expect(metadata.versions).toBeDefined()
    })

    it('should handle scoped packages', async () => {
      const client = new NpmRegistryClient()
      const metadata = await client.getPackageMetadata('@types/node')

      expect(metadata.name).toBe('@types/node')
      expect(metadata.versions).toBeDefined()
    })

    it('should throw for non-existent package', async () => {
      const client = new NpmRegistryClient()

      await expect(
        client.getPackageMetadata('this-package-does-not-exist-12345')
      ).rejects.toThrow(/not found/i)
    })

    it('should throw for invalid package name', async () => {
      const client = new NpmRegistryClient()

      await expect(
        client.getPackageMetadata('../malicious')
      ).rejects.toThrow(/invalid package name/i)
    })

    it('should cache metadata', async () => {
      const client = new NpmRegistryClient({
        cache: true,
      })

      // First call - fetches from network
      const metadata1 = await client.getPackageMetadata('lodash')

      // Second call - should come from cache
      const metadata2 = await client.getPackageMetadata('lodash')

      expect(metadata1).toEqual(metadata2)
      expect(client.cacheHits).toBe(1)
    })
  })

  describe('getPackageVersion', () => {
    it('should fetch specific version metadata', async () => {
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('lodash', '4.17.21')

      expect(version).toBeDefined()
      expect(version.name).toBe('lodash')
      expect(version.version).toBe('4.17.21')
    })

    it('should resolve dist-tags', async () => {
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('express', 'latest')

      expect(version).toBeDefined()
      expect(version.name).toBe('express')
      expect(version.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('should resolve semver ranges', async () => {
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('lodash', '^4.0.0')

      expect(version).toBeDefined()
      expect(version.name).toBe('lodash')
      expect(version.version).toMatch(/^4\./)
    })

    it('should include all dependencies', async () => {
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('express', 'latest')

      expect(version.dependencies).toBeDefined()
      expect(typeof version.dependencies).toBe('object')
    })

    it('should include peerDependencies', async () => {
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('react-dom', 'latest')

      expect(version.peerDependencies).toBeDefined()
      expect(version.peerDependencies?.react).toBeDefined()
    })

    it('should throw for non-existent version', async () => {
      const client = new NpmRegistryClient()

      await expect(
        client.getPackageVersion('lodash', '999.999.999')
      ).rejects.toThrow(/version not found/i)
    })
  })

  describe('downloadTarball', () => {
    it('should download tarball as ArrayBuffer', async () => {
      const client = new NpmRegistryClient()
      const tarball = await client.downloadTarball('is-odd', '3.0.1')

      expect(tarball).toBeInstanceOf(ArrayBuffer)
      expect(tarball.byteLength).toBeGreaterThan(0)
    })

    it('should verify integrity (sha512)', async () => {
      const client = new NpmRegistryClient()
      const tarball = await client.downloadTarball('is-odd', '3.0.1', {
        verifyIntegrity: true,
      })

      expect(tarball).toBeInstanceOf(ArrayBuffer)
    })

    it('should throw on integrity mismatch', async () => {
      const client = new NpmRegistryClient()

      // Mock a corrupted download
      await expect(
        client.downloadTarball('is-odd', '3.0.1', {
          expectedIntegrity: 'sha512-INVALID',
        })
      ).rejects.toThrow(/integrity check failed/i)
    })

    it('should support streaming downloads', async () => {
      const client = new NpmRegistryClient()
      const stream = await client.downloadTarballStream('lodash', '4.17.21')

      expect(stream).toBeDefined()
      // ReadableStream interface
      expect(typeof stream.getReader).toBe('function')
    })

    it('should report download progress', async () => {
      const client = new NpmRegistryClient()
      const progressUpdates: number[] = []

      await client.downloadTarball('lodash', '4.17.21', {
        onProgress: (progress) => {
          progressUpdates.push(progress.percentage)
        },
      })

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
    })

    it('should handle scoped package tarballs', async () => {
      const client = new NpmRegistryClient()
      const tarball = await client.downloadTarball('@types/node', '22.10.5')

      expect(tarball).toBeInstanceOf(ArrayBuffer)
      expect(tarball.byteLength).toBeGreaterThan(0)
    })

    it('should use registry from package dist', async () => {
      // Some packages (like from private registries) have custom tarball URLs
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('lodash', '4.17.21')

      expect(version.dist.tarball).toContain('registry.npmjs.org')
    })
  })

  describe('search', () => {
    it('should search packages by text', async () => {
      const client = new NpmRegistryClient()
      const results = await client.search('express')

      expect(results.objects).toBeDefined()
      expect(results.objects.length).toBeGreaterThan(0)
      expect(results.total).toBeGreaterThan(0)
    })

    it('should include package info in results', async () => {
      const client = new NpmRegistryClient()
      const results = await client.search('lodash')

      const firstResult = results.objects[0]
      expect(firstResult.package).toBeDefined()
      expect(firstResult.package.name).toBeDefined()
      expect(firstResult.package.version).toBeDefined()
      expect(firstResult.package.description).toBeDefined()
    })

    it('should include search score', async () => {
      const client = new NpmRegistryClient()
      const results = await client.search('react')

      const firstResult = results.objects[0]
      expect(firstResult.score).toBeDefined()
      expect(firstResult.score.final).toBeGreaterThan(0)
    })

    it('should support pagination', async () => {
      const client = new NpmRegistryClient()

      const page1 = await client.search('test', { size: 10, from: 0 })
      const page2 = await client.search('test', { size: 10, from: 10 })

      expect(page1.objects.length).toBe(10)
      expect(page2.objects.length).toBe(10)
      expect(page1.objects[0].package.name).not.toBe(page2.objects[0].package.name)
    })

    it('should filter by quality score', async () => {
      const client = new NpmRegistryClient()
      const results = await client.search('http', {
        quality: 0.5,
      })

      results.objects.forEach(obj => {
        expect(obj.score.detail.quality).toBeGreaterThanOrEqual(0.5)
      })
    })

    it('should filter by maintenance score', async () => {
      const client = new NpmRegistryClient()
      const results = await client.search('database', {
        maintenance: 0.8,
      })

      results.objects.forEach(obj => {
        expect(obj.score.detail.maintenance).toBeGreaterThanOrEqual(0.8)
      })
    })

    it('should handle no results', async () => {
      const client = new NpmRegistryClient()
      const results = await client.search('xyznonexistentpackage12345')

      expect(results.objects).toHaveLength(0)
      expect(results.total).toBe(0)
    })
  })

  describe('authentication', () => {
    it('should authenticate with bearer token', async () => {
      const client = new NpmRegistryClient({
        registry: 'https://registry.npmjs.org',
        auth: {
          token: 'npm_test_token_12345',
        },
      })

      expect(client.getAuthHeader()).toBe('Bearer npm_test_token_12345')
    })

    it('should authenticate with basic auth', async () => {
      const client = new NpmRegistryClient({
        auth: {
          username: 'testuser',
          password: 'testpass',
        },
      })

      const authHeader = client.getAuthHeader()
      expect(authHeader).toMatch(/^Basic /)

      // Decode and verify
      const decoded = atob(authHeader.replace('Basic ', ''))
      expect(decoded).toBe('testuser:testpass')
    })

    it('should handle npm auth token from env', async () => {
      const client = new NpmRegistryClient({
        auth: {
          tokenFromEnv: 'NPM_TOKEN',
        },
      })

      // Should read from environment or throw if not set
      expect(client.isAuthenticated).toBeDefined()
    })

    it('should refresh expired token', async () => {
      const client = new NpmRegistryClient({
        auth: {
          token: 'expired_token',
          refreshToken: 'refresh_token_12345',
        },
      })

      // Trigger token refresh
      await client.refreshAuth()

      expect(client.isAuthenticated).toBe(true)
    })

    it('should handle private package access', async () => {
      const client = new NpmRegistryClient({
        registry: 'https://npm.pkg.github.com',
        auth: {
          token: 'ghp_xxxxxxxxxxxxx',
        },
      })

      // Should be able to access private packages
      expect(client.isAuthenticated).toBe(true)
    })

    it('should include auth in request headers', async () => {
      const client = new NpmRegistryClient({
        auth: {
          token: 'npm_test_token',
        },
      })

      const headers = client.getRequestHeaders()

      expect(headers['Authorization']).toBe('Bearer npm_test_token')
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const client = new NpmRegistryClient({
        registry: 'https://invalid.registry.example.com.ai',
        timeout: 1000,
      })

      await expect(
        client.getPackageMetadata('lodash')
      ).rejects.toThrow(/network error|ENOTFOUND|fetch failed/i)
    })

    it('should handle rate limiting (429)', async () => {
      const client = new NpmRegistryClient()

      // When rate limited, should return proper error
      // In real scenario this would be tested with mocks
      expect(client.handleRateLimit).toBeDefined()
    })

    it('should handle server errors (5xx)', async () => {
      const client = new NpmRegistryClient()

      // Should retry on 5xx errors
      expect(client.retries).toBeGreaterThan(0)
    })

    it('should provide meaningful error messages', async () => {
      const client = new NpmRegistryClient()

      try {
        await client.getPackageMetadata('nonexistent-pkg-12345')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/not found|404/i)
      }
    })

    it('should handle timeout', async () => {
      const client = new NpmRegistryClient({
        timeout: 1,
      })

      await expect(
        client.getPackageMetadata('lodash')
      ).rejects.toThrow(/timeout|aborted/i)
    })
  })
})

// =============================================================================
// VERSION RESOLUTION TESTS
// =============================================================================

describe('Version Resolution', () => {
  describe('parsePackageSpec', () => {
    it('should parse simple package name', () => {
      const spec = parsePackageSpec('lodash')

      expect(spec.name).toBe('lodash')
      expect(spec.version).toBeUndefined()
      expect(spec.tag).toBeUndefined()
    })

    it('should parse package@version', () => {
      const spec = parsePackageSpec('lodash@4.17.21')

      expect(spec.name).toBe('lodash')
      expect(spec.version).toBe('4.17.21')
    })

    it('should parse package@range', () => {
      const spec = parsePackageSpec('lodash@^4.0.0')

      expect(spec.name).toBe('lodash')
      expect(spec.range).toBe('^4.0.0')
    })

    it('should parse package@tag', () => {
      const spec = parsePackageSpec('lodash@latest')

      expect(spec.name).toBe('lodash')
      expect(spec.tag).toBe('latest')
    })

    it('should parse scoped package', () => {
      const spec = parsePackageSpec('@types/node')

      expect(spec.name).toBe('@types/node')
      expect(spec.scope).toBe('@types')
    })

    it('should parse scoped package@version', () => {
      const spec = parsePackageSpec('@types/node@22.10.5')

      expect(spec.name).toBe('@types/node')
      expect(spec.scope).toBe('@types')
      expect(spec.version).toBe('22.10.5')
    })

    it('should parse package with npm URL', () => {
      const spec = parsePackageSpec('npm:lodash@4.17.21')

      expect(spec.protocol).toBe('npm')
      expect(spec.name).toBe('lodash')
      expect(spec.version).toBe('4.17.21')
    })

    it('should parse package alias', () => {
      const spec = parsePackageSpec('my-lodash@npm:lodash@4.17.21')

      expect(spec.alias).toBe('my-lodash')
      expect(spec.name).toBe('lodash')
      expect(spec.version).toBe('4.17.21')
    })

    it('should handle x-range versions', () => {
      const cases = [
        { input: 'pkg@1.x', expected: '>=1.0.0 <2.0.0-0' },
        { input: 'pkg@1.2.x', expected: '>=1.2.0 <1.3.0-0' },
        { input: 'pkg@*', expected: '>=0.0.0' },
      ]

      for (const { input, expected } of cases) {
        const spec = parsePackageSpec(input)
        expect(spec.normalizedRange).toBe(expected)
      }
    })

    it('should throw for invalid package name', () => {
      const invalidNames = [
        '',
        '.hidden',
        '_underscore',
        'UPPERCASE',
        'space name',
        '../path-traversal',
        'node_modules',
        'favicon.ico',
      ]

      for (const name of invalidNames) {
        expect(() => parsePackageSpec(name)).toThrow(/invalid package name/i)
      }
    })
  })

  describe('resolveVersion', () => {
    const versions = [
      '1.0.0', '1.0.1', '1.1.0', '1.2.0',
      '2.0.0', '2.0.1', '2.1.0',
      '3.0.0-alpha.1', '3.0.0-beta.1', '3.0.0',
    ]

    it('should resolve exact version', () => {
      const result = resolveVersion(versions, '2.0.1')
      expect(result).toBe('2.0.1')
    })

    it('should resolve caret range', () => {
      const result = resolveVersion(versions, '^1.0.0')
      expect(result).toBe('1.2.0') // highest matching 1.x.x
    })

    it('should resolve tilde range', () => {
      const result = resolveVersion(versions, '~1.0.0')
      expect(result).toBe('1.0.1') // highest matching 1.0.x
    })

    it('should resolve greater than or equal', () => {
      const result = resolveVersion(versions, '>=2.0.0')
      expect(result).toBe('3.0.0') // highest stable version
    })

    it('should resolve less than', () => {
      const result = resolveVersion(versions, '<2.0.0')
      expect(result).toBe('1.2.0') // highest below 2.0.0
    })

    it('should resolve range with hyphen', () => {
      const result = resolveVersion(versions, '1.0.0 - 2.0.0')
      expect(result).toBe('2.0.0')
    })

    it('should resolve OR ranges', () => {
      const result = resolveVersion(versions, '1.0.0 || 2.0.0')
      expect(result).toBe('2.0.0') // highest matching
    })

    it('should resolve AND ranges', () => {
      const result = resolveVersion(versions, '>=1.0.0 <2.0.0')
      expect(result).toBe('1.2.0')
    })

    it('should exclude prereleases by default', () => {
      const result = resolveVersion(versions, '>=3.0.0-0')
      expect(result).toBe('3.0.0')
    })

    it('should include prereleases when requested', () => {
      const result = resolveVersion(versions, '>=3.0.0-0', {
        includePrerelease: true,
      })
      expect(result).toBe('3.0.0')
    })

    it('should return null for no match', () => {
      const result = resolveVersion(versions, '>=99.0.0')
      expect(result).toBeNull()
    })
  })

  describe('matchesRange', () => {
    it('should match exact version', () => {
      expect(matchesRange('1.2.3', '1.2.3')).toBe(true)
      expect(matchesRange('1.2.3', '1.2.4')).toBe(false)
    })

    it('should match caret range', () => {
      expect(matchesRange('1.2.3', '^1.0.0')).toBe(true)
      expect(matchesRange('2.0.0', '^1.0.0')).toBe(false)
    })

    it('should match tilde range', () => {
      expect(matchesRange('1.0.5', '~1.0.0')).toBe(true)
      expect(matchesRange('1.1.0', '~1.0.0')).toBe(false)
    })

    it('should match x-ranges', () => {
      expect(matchesRange('1.5.0', '1.x')).toBe(true)
      expect(matchesRange('2.0.0', '1.x')).toBe(false)
    })

    it('should match * (any version)', () => {
      expect(matchesRange('1.0.0', '*')).toBe(true)
      expect(matchesRange('999.999.999', '*')).toBe(true)
    })
  })

  describe('sortVersions', () => {
    it('should sort versions in ascending order', () => {
      const versions = ['2.0.0', '1.0.0', '1.5.0', '3.0.0']
      const sorted = sortVersions(versions)

      expect(sorted).toEqual(['1.0.0', '1.5.0', '2.0.0', '3.0.0'])
    })

    it('should sort versions in descending order', () => {
      const versions = ['2.0.0', '1.0.0', '1.5.0', '3.0.0']
      const sorted = sortVersions(versions, 'desc')

      expect(sorted).toEqual(['3.0.0', '2.0.0', '1.5.0', '1.0.0'])
    })

    it('should handle prerelease versions', () => {
      const versions = ['1.0.0', '1.0.0-alpha', '1.0.0-beta', '1.0.0-rc.1']
      const sorted = sortVersions(versions)

      expect(sorted).toEqual(['1.0.0-alpha', '1.0.0-beta', '1.0.0-rc.1', '1.0.0'])
    })

    it('should handle build metadata', () => {
      const versions = ['1.0.0+build1', '1.0.0+build2', '1.0.0']
      const sorted = sortVersions(versions)

      // Build metadata should be ignored for comparison
      expect(sorted[0]).toBe('1.0.0')
    })
  })

  describe('getLatestVersion', () => {
    it('should return latest stable version', () => {
      const versions = ['1.0.0', '2.0.0', '3.0.0-beta']
      const latest = getLatestVersion(versions)

      expect(latest).toBe('2.0.0')
    })

    it('should return latest prerelease if no stable', () => {
      const versions = ['1.0.0-alpha', '1.0.0-beta', '1.0.0-rc']
      const latest = getLatestVersion(versions)

      expect(latest).toBe('1.0.0-rc')
    })

    it('should include prerelease when requested', () => {
      const versions = ['1.0.0', '2.0.0-beta.5']
      const latest = getLatestVersion(versions, { includePrerelease: true })

      expect(latest).toBe('2.0.0-beta.5')
    })
  })
})

// =============================================================================
// TARBALL HANDLING TESTS
// =============================================================================

describe('Tarball Handling', () => {
  describe('extractTarball', () => {
    it('should extract tarball to entries', async () => {
      // Mock tarball data - in real implementation this would be actual tarball bytes
      const tarballBytes = new ArrayBuffer(1024)

      const entries = await extractTarball(tarballBytes)

      expect(entries).toBeInstanceOf(Array)
      expect(entries.length).toBeGreaterThan(0)
    })

    it('should include file paths', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes)

      entries.forEach(entry => {
        expect(entry.path).toBeDefined()
        expect(typeof entry.path).toBe('string')
      })
    })

    it('should include file content', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes)

      entries.forEach(entry => {
        if (!entry.isDirectory) {
          expect(entry.content).toBeInstanceOf(Uint8Array)
        }
      })
    })

    it('should identify directories', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes)

      const hasDir = entries.some(e => e.isDirectory)
      expect(hasDir).toBe(true)
    })

    it('should strip package/ prefix from paths', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes, {
        stripPrefix: 'package/',
      })

      entries.forEach(entry => {
        expect(entry.path).not.toMatch(/^package\//)
      })
    })

    it('should filter entries with pattern', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes, {
        filter: (path) => path.endsWith('.js'),
      })

      entries.forEach(entry => {
        if (!entry.isDirectory) {
          expect(entry.path).toMatch(/\.js$/)
        }
      })
    })

    it('should include file metadata', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes)

      entries.forEach(entry => {
        expect(entry.mode).toBeDefined()
        expect(entry.mtime).toBeDefined()
        expect(entry.size).toBeDefined()
      })
    })

    it('should handle symlinks', async () => {
      const tarballBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(tarballBytes)

      const symlink = entries.find(e => e.isSymlink)
      if (symlink) {
        expect(symlink.linkTarget).toBeDefined()
      }
    })

    it('should throw for invalid tarball', async () => {
      const invalidBytes = new ArrayBuffer(100)

      await expect(
        extractTarball(invalidBytes)
      ).rejects.toThrow(/invalid tarball/i)
    })

    it('should handle gzip compressed tarballs', async () => {
      // .tgz files are gzip compressed
      const gzippedBytes = new ArrayBuffer(1024)
      const entries = await extractTarball(gzippedBytes, {
        gzip: true,
      })

      expect(entries.length).toBeGreaterThan(0)
    })
  })

  describe('validateIntegrity', () => {
    it('should validate sha512 integrity', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const integrity = 'sha512-vIB0QLdCnQbpL1CWpJL9XpA3D4v5YrqJ3qK7L8mN9P0Q1R2S3T4U5V6W7X8Y9Z0='

      const isValid = await validateIntegrity(data, integrity)

      expect(typeof isValid).toBe('boolean')
    })

    it('should validate sha1 shasum', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const shasum = 'abc123def456789012345678901234567890abcd'

      const isValid = await validateIntegrity(data, shasum, { algorithm: 'sha1' })

      expect(typeof isValid).toBe('boolean')
    })

    it('should return false for mismatch', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const wrongIntegrity = 'sha512-WRONGHASHWRONGHASH=='

      const isValid = await validateIntegrity(data, wrongIntegrity)

      expect(isValid).toBe(false)
    })

    it('should support multiple algorithms', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      // SRI format with multiple algorithms
      const integrity = 'sha256-xxx sha512-yyy'

      const isValid = await validateIntegrity(data, integrity)

      expect(typeof isValid).toBe('boolean')
    })
  })

  describe('computeShasum', () => {
    it('should compute sha1 hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])

      const shasum = await computeShasum(data)

      expect(shasum).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should compute sha512 integrity', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])

      const integrity = await computeShasum(data, { algorithm: 'sha512', format: 'sri' })

      expect(integrity).toMatch(/^sha512-/)
    })

    it('should produce consistent results', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])

      const hash1 = await computeShasum(data)
      const hash2 = await computeShasum(data)

      expect(hash1).toBe(hash2)
    })
  })
})

// =============================================================================
// REGISTRY ENDPOINT TESTS
// =============================================================================

describe('Registry Endpoints', () => {
  describe('URL construction', () => {
    it('should construct metadata URL', () => {
      const client = new NpmRegistryClient()

      expect(client.getMetadataUrl('lodash')).toBe(
        'https://registry.npmjs.org/lodash'
      )
    })

    it('should encode scoped package name', () => {
      const client = new NpmRegistryClient()

      expect(client.getMetadataUrl('@types/node')).toBe(
        'https://registry.npmjs.org/@types%2Fnode'
      )
    })

    it('should construct version URL', () => {
      const client = new NpmRegistryClient()

      expect(client.getVersionUrl('lodash', '4.17.21')).toBe(
        'https://registry.npmjs.org/lodash/4.17.21'
      )
    })

    it('should construct search URL', () => {
      const client = new NpmRegistryClient()

      expect(client.getSearchUrl('express')).toBe(
        'https://registry.npmjs.org/-/v1/search?text=express'
      )
    })

    it('should construct tarball URL from dist', () => {
      const client = new NpmRegistryClient()
      const dist: VersionDistribution = {
        tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        shasum: 'abc123',
        integrity: 'sha512-xxx',
      }

      expect(client.getTarballUrl(dist)).toBe(dist.tarball)
    })
  })

  describe('custom registries', () => {
    it('should use GitHub Package Registry URL format', () => {
      const client = new NpmRegistryClient({
        registry: 'https://npm.pkg.github.com',
      })

      expect(client.getMetadataUrl('@myorg/mypackage')).toBe(
        'https://npm.pkg.github.com/@myorg%2Fmypackage'
      )
    })

    it('should use Verdaccio URL format', () => {
      const client = new NpmRegistryClient({
        registry: 'http://localhost:4873',
      })

      expect(client.getMetadataUrl('my-private-pkg')).toBe(
        'http://localhost:4873/my-private-pkg'
      )
    })

    it('should use Artifactory URL format', () => {
      const client = new NpmRegistryClient({
        registry: 'https://mycompany.jfrog.io/artifactory/api/npm/npm-local',
      })

      expect(client.registryUrl).toContain('jfrog.io')
    })
  })
})

// =============================================================================
// EDGE CASES AND ERROR SCENARIOS
// =============================================================================

describe('Edge Cases', () => {
  describe('package name edge cases', () => {
    it('should handle very long package names', () => {
      const longName = 'a'.repeat(214) // npm max length
      const spec = parsePackageSpec(longName)

      expect(spec.name).toBe(longName)
    })

    it('should handle package names with dots', () => {
      const spec = parsePackageSpec('lodash.get')

      expect(spec.name).toBe('lodash.get')
    })

    it('should handle package names with numbers', () => {
      const spec = parsePackageSpec('is-odd')

      expect(spec.name).toBe('is-odd')
    })

    it('should handle deeply scoped packages', () => {
      const spec = parsePackageSpec('@org/scope/deep')

      expect(spec.scope).toBe('@org')
      expect(spec.name).toBe('@org/scope/deep')
    })
  })

  describe('version edge cases', () => {
    it('should handle 0.x.x versions', () => {
      const result = resolveVersion(['0.0.1', '0.1.0', '0.2.0'], '^0.1.0')

      // For 0.x, caret matches 0.1.x (minor is treated as major)
      expect(result).toBe('0.1.0')
    })

    it('should handle versions with build metadata', () => {
      const versions = ['1.0.0', '1.0.0+build.123']
      const result = resolveVersion(versions, '1.0.0')

      expect(result).toBe('1.0.0')
    })

    it('should handle very long prerelease identifiers', () => {
      const versions = ['1.0.0-alpha.beta.gamma.delta.epsilon.1.2.3']
      const result = resolveVersion(versions, '>=1.0.0-alpha')

      expect(result).toBeDefined()
    })
  })

  describe('network edge cases', () => {
    it('should handle redirect responses', async () => {
      const client = new NpmRegistryClient({
        followRedirects: true,
        maxRedirects: 3,
      })

      expect(client.maxRedirects).toBe(3)
    })

    it('should handle connection reuse', async () => {
      const client = new NpmRegistryClient({
        keepAlive: true,
      })

      expect(client.keepAlive).toBe(true)
    })

    it('should handle concurrent requests', async () => {
      const client = new NpmRegistryClient({
        maxConcurrentRequests: 10,
      })

      expect(client.maxConcurrentRequests).toBe(10)
    })
  })
})

// =============================================================================
// INTEGRATION SCENARIOS
// =============================================================================

describe('Integration Scenarios', () => {
  describe('install workflow', () => {
    it('should resolve and download package for install', async () => {
      const client = new NpmRegistryClient()

      // 1. Get package metadata
      const metadata = await client.getPackageMetadata('is-odd')
      expect(metadata).toBeDefined()

      // 2. Resolve version
      const version = await client.getPackageVersion('is-odd', '^3.0.0')
      expect(version).toBeDefined()

      // 3. Download tarball
      const tarball = await client.downloadTarball('is-odd', version.version)
      expect(tarball).toBeInstanceOf(ArrayBuffer)

      // 4. Extract files
      const entries = await extractTarball(tarball)
      expect(entries.length).toBeGreaterThan(0)
    })

    it('should resolve dependency tree', async () => {
      const client = new NpmRegistryClient()
      const version = await client.getPackageVersion('express', 'latest')

      // Get all dependencies
      const deps = version.dependencies || {}
      expect(Object.keys(deps).length).toBeGreaterThan(0)

      // Each dependency should be resolvable
      const firstDep = Object.keys(deps)[0]
      const depVersion = await client.getPackageVersion(firstDep, deps[firstDep])
      expect(depVersion).toBeDefined()
    })
  })

  describe('publish workflow', () => {
    it('should have publish endpoint', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      expect(client.getPublishUrl('my-package')).toBe(
        'https://registry.npmjs.org/my-package'
      )
    })

    it('should prepare package for publish', () => {
      // This would be used to create the tarball for publish
      const client = new NpmRegistryClient()

      expect(typeof client.preparePackage).toBe('function')
    })
  })
})

// =============================================================================
// PUBLISH FUNCTIONALITY TESTS
// =============================================================================

describe('Publish Functionality', () => {
  describe('preparePackage', () => {
    it('should prepare package manifest with required fields', () => {
      const client = new NpmRegistryClient()

      const packageJson = {
        name: 'my-test-package',
        version: '1.0.0',
        description: 'A test package',
        main: 'index.js',
      }

      const tarball = new Uint8Array([1, 2, 3, 4, 5])
      const manifest = client.preparePackage(packageJson, tarball)

      expect(manifest._id).toBe('my-test-package@1.0.0')
      expect(manifest.name).toBe('my-test-package')
      expect(manifest['dist-tags']).toEqual({ latest: '1.0.0' })
      expect(manifest.versions).toBeDefined()
      expect(manifest.versions['1.0.0']).toBeDefined()
    })

    it('should include version distribution info', async () => {
      const client = new NpmRegistryClient()

      const packageJson = {
        name: 'my-test-package',
        version: '1.0.0',
      }

      const tarball = new Uint8Array([1, 2, 3, 4, 5])
      const manifest = client.preparePackage(packageJson, tarball)

      const versionInfo = manifest.versions['1.0.0']
      expect(versionInfo.dist).toBeDefined()
      expect(versionInfo.dist.tarball).toBeDefined()
      expect(versionInfo.dist.shasum).toMatch(/^[0-9a-f]{40}$/)
      expect(versionInfo.dist.integrity).toMatch(/^sha512-/)
    })

    it('should include _attachments with base64 tarball', () => {
      const client = new NpmRegistryClient()

      const packageJson = {
        name: 'my-test-package',
        version: '1.0.0',
      }

      const tarball = new Uint8Array([1, 2, 3, 4, 5])
      const manifest = client.preparePackage(packageJson, tarball)

      expect(manifest._attachments).toBeDefined()
      const attachmentKey = `my-test-package-1.0.0.tgz`
      expect(manifest._attachments[attachmentKey]).toBeDefined()
      expect(manifest._attachments[attachmentKey].content_type).toBe('application/octet-stream')
      expect(manifest._attachments[attachmentKey].data).toBeDefined()
      expect(manifest._attachments[attachmentKey].length).toBe(5)
    })

    it('should preserve optional package.json fields', () => {
      const client = new NpmRegistryClient()

      const packageJson = {
        name: 'my-test-package',
        version: '1.0.0',
        description: 'Test package',
        keywords: ['test', 'example'],
        author: { name: 'Test Author', email: 'test@example.com' },
        license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/test/repo' },
        dependencies: { lodash: '^4.0.0' },
        devDependencies: { vitest: '^1.0.0' },
        peerDependencies: { react: '>=16' },
      }

      const tarball = new Uint8Array([1, 2, 3])
      const manifest = client.preparePackage(packageJson, tarball)

      const versionInfo = manifest.versions['1.0.0']
      expect(versionInfo.description).toBe('Test package')
      expect(versionInfo.keywords).toEqual(['test', 'example'])
      expect(versionInfo.author).toEqual({ name: 'Test Author', email: 'test@example.com' })
      expect(versionInfo.license).toBe('MIT')
      expect(versionInfo.dependencies).toEqual({ lodash: '^4.0.0' })
      expect(versionInfo.devDependencies).toEqual({ vitest: '^1.0.0' })
      expect(versionInfo.peerDependencies).toEqual({ react: '>=16' })
    })

    it('should use custom dist-tag when specified', () => {
      const client = new NpmRegistryClient()

      const packageJson = {
        name: 'my-test-package',
        version: '2.0.0-beta.1',
      }

      const tarball = new Uint8Array([1, 2, 3])
      const manifest = client.preparePackage(packageJson, tarball, { tag: 'beta' })

      expect(manifest['dist-tags']).toEqual({ beta: '2.0.0-beta.1' })
    })
  })

  describe('validatePackageForPublish', () => {
    it('should validate package has required fields', () => {
      const client = new NpmRegistryClient()

      const validPackage = { name: 'test-pkg', version: '1.0.0' }
      const result = client.validatePackageForPublish(validPackage)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should require name field', () => {
      const client = new NpmRegistryClient()

      const invalidPackage = { version: '1.0.0' }
      const result = client.validatePackageForPublish(invalidPackage)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required field: name')
    })

    it('should require version field', () => {
      const client = new NpmRegistryClient()

      const invalidPackage = { name: 'test-pkg' }
      const result = client.validatePackageForPublish(invalidPackage)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required field: version')
    })

    it('should validate version is valid semver', () => {
      const client = new NpmRegistryClient()

      const invalidPackage = { name: 'test-pkg', version: 'not-a-version' }
      const result = client.validatePackageForPublish(invalidPackage)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid version'))).toBe(true)
    })

    it('should validate package name format', () => {
      const client = new NpmRegistryClient()

      const invalidPackage = { name: '../malicious', version: '1.0.0' }
      const result = client.validatePackageForPublish(invalidPackage)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid package name'))).toBe(true)
    })

    it('should allow scoped packages', () => {
      const client = new NpmRegistryClient()

      const validPackage = { name: '@myorg/my-package', version: '1.0.0' }
      const result = client.validatePackageForPublish(validPackage)

      expect(result.valid).toBe(true)
    })
  })

  describe('checkVersionExists', () => {
    it('should return true if version exists', async () => {
      const client = new NpmRegistryClient()

      // lodash 4.17.21 definitely exists
      const exists = await client.checkVersionExists('lodash', '4.17.21')

      expect(exists).toBe(true)
    })

    it('should return false if version does not exist', async () => {
      const client = new NpmRegistryClient()

      const exists = await client.checkVersionExists('lodash', '999.999.999')

      expect(exists).toBe(false)
    })

    it('should return false for non-existent package', async () => {
      const client = new NpmRegistryClient()

      const exists = await client.checkVersionExists('this-package-definitely-does-not-exist-xyz', '1.0.0')

      expect(exists).toBe(false)
    })
  })

  describe('publishPackage', () => {
    it('should require authentication', async () => {
      const client = new NpmRegistryClient() // No auth

      const packageJson = { name: 'test-pkg', version: '1.0.0' }
      const tarball = new Uint8Array([1, 2, 3])

      await expect(
        client.publishPackage(packageJson, tarball)
      ).rejects.toThrow(/authentication required/i)
    })

    it('should validate package before publishing', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      const invalidPackage = { name: '../bad', version: '1.0.0' }
      const tarball = new Uint8Array([1, 2, 3])

      await expect(
        client.publishPackage(invalidPackage, tarball)
      ).rejects.toThrow(/invalid package/i)
    })

    it('should include OTP header when provided', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      // We can't actually publish, but we can verify the method accepts OTP
      const headers = client.getPublishHeaders({ otp: '123456' })

      expect(headers['npm-otp']).toBe('123456')
    })

    it('should use correct content-type for publish', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      const headers = client.getPublishHeaders({})

      expect(headers['Content-Type']).toBe('application/json')
    })

    it('should handle publish access options', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      const packageJson = {
        name: '@myorg/my-package',
        version: '1.0.0',
        publishConfig: { access: 'public' },
      }

      const tarball = new Uint8Array([1, 2, 3])
      const manifest = client.preparePackage(packageJson, tarball)

      expect(manifest.access).toBe('public')
    })

    it('should support dry-run mode', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      const packageJson = { name: 'test-pkg', version: '1.0.0' }
      const tarball = new Uint8Array([1, 2, 3])

      // Dry run should not make network request
      const result = await client.publishPackage(packageJson, tarball, { dryRun: true })

      expect(result.dryRun).toBe(true)
      expect(result.manifest).toBeDefined()
      expect(result.manifest._id).toBe('test-pkg@1.0.0')
    })
  })

  describe('publish error handling', () => {
    it('should handle version already exists error', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      // Version conflict error (403 or 409)
      // This would be returned when trying to publish an existing version
      const error = client.parsePublishError({
        status: 403,
        body: { error: 'forbidden', reason: 'cannot modify pre-existing version' },
      })

      expect(error.code).toBe('E403')
      expect(error.message).toMatch(/pre-existing|version.*exists|forbidden/i)
    })

    it('should handle OTP required error', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      const error = client.parsePublishError({
        status: 401,
        headers: { 'npm-notice': 'one-time password required' },
        body: { error: 'unauthorized', reason: 'OTP required' },
      })

      expect(error.code).toBe('EOTP')
      expect(error.otpRequired).toBe(true)
    })

    it('should handle unauthorized error', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'invalid-token' },
      })

      const error = client.parsePublishError({
        status: 401,
        body: { error: 'unauthorized' },
      })

      expect(error.code).toBe('E401')
      expect(error.message).toMatch(/unauthorized|authentication/i)
    })

    it('should handle forbidden for scoped packages', async () => {
      const client = new NpmRegistryClient({
        auth: { token: 'test-token' },
      })

      const error = client.parsePublishError({
        status: 402,
        body: { error: 'payment required', reason: 'private package requires paid account' },
      })

      expect(error.code).toBe('E402')
      expect(error.message).toMatch(/private|payment|paid/i)
    })
  })
})
