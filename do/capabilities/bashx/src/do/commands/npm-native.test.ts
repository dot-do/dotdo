/**
 * Tests for npm-native command execution via npmx registry client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseNpmViewArgs,
  parseNpmSearchArgs,
  executeNpmView,
  executeNpmSearch,
  executeNpmPack,
  executeNpmNative,
  canExecuteNativeNpm,
  extractNpmSubcommand,
  NATIVE_NPM_COMMANDS,
  RPC_ONLY_NPM_COMMANDS,
} from './npm-native.js'

// ============================================================================
// ARGUMENT PARSING TESTS
// ============================================================================

describe('npm-native argument parsing', () => {
  describe('parseNpmViewArgs', () => {
    it('should parse package name', () => {
      const result = parseNpmViewArgs(['lodash'])
      expect(result.packageSpec).toBe('lodash')
      expect(result.field).toBeUndefined()
      expect(result.json).toBe(false)
    })

    it('should parse package with version', () => {
      const result = parseNpmViewArgs(['lodash@4.17.21'])
      expect(result.packageSpec).toBe('lodash@4.17.21')
    })

    it('should parse package with field selector', () => {
      const result = parseNpmViewArgs(['lodash', 'version'])
      expect(result.packageSpec).toBe('lodash')
      expect(result.field).toBe('version')
    })

    it('should parse --json flag', () => {
      const result = parseNpmViewArgs(['lodash', '--json'])
      expect(result.json).toBe(true)
    })

    it('should parse -j shorthand', () => {
      const result = parseNpmViewArgs(['lodash', '-j'])
      expect(result.json).toBe(true)
    })

    it('should parse scoped package', () => {
      const result = parseNpmViewArgs(['@types/node'])
      expect(result.packageSpec).toBe('@types/node')
    })

    it('should parse scoped package with version', () => {
      const result = parseNpmViewArgs(['@types/node@18.0.0'])
      expect(result.packageSpec).toBe('@types/node@18.0.0')
    })
  })

  describe('parseNpmSearchArgs', () => {
    it('should parse search query', () => {
      const result = parseNpmSearchArgs(['lodash'])
      expect(result.query).toBe('lodash')
      expect(result.long).toBe(false)
      expect(result.json).toBe(false)
    })

    it('should parse multi-word query', () => {
      const result = parseNpmSearchArgs(['react', 'hooks'])
      expect(result.query).toBe('react hooks')
    })

    it('should parse --long flag', () => {
      const result = parseNpmSearchArgs(['lodash', '--long'])
      expect(result.long).toBe(true)
    })

    it('should parse -l shorthand', () => {
      const result = parseNpmSearchArgs(['lodash', '-l'])
      expect(result.long).toBe(true)
    })

    it('should parse --json flag', () => {
      const result = parseNpmSearchArgs(['lodash', '--json'])
      expect(result.json).toBe(true)
    })

    it('should parse --limit flag', () => {
      const result = parseNpmSearchArgs(['lodash', '--limit=10'])
      expect(result.limit).toBe(10)
    })

    it('should parse --searchlimit flag', () => {
      const result = parseNpmSearchArgs(['lodash', '--searchlimit', '5'])
      expect(result.limit).toBe(5)
    })
  })
})

// ============================================================================
// COMMAND EXECUTION TESTS
// ============================================================================

describe('npm-native command execution', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('executeNpmView', () => {
    it('should fetch and format package metadata', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          _id: 'lodash',
          name: 'lodash',
          description: 'A modern JavaScript utility library',
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {
              name: 'lodash',
              version: '4.17.21',
              description: 'A modern JavaScript utility library',
              license: 'MIT',
              dependencies: {},
              keywords: ['utility', 'lodash'],
              dist: {
                tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
                shasum: 'abc123',
                integrity: 'sha512-abc123',
              },
              maintainers: [{ name: 'jdalton' }],
            },
          },
          time: { '4.17.21': '2021-01-01T00:00:00.000Z' },
        }),
      })

      const result = await executeNpmView(['lodash'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('lodash')
      expect(result.stdout).toContain('4.17.21')
      expect(result.stdout).toContain('MIT')
      expect(result.stderr).toBe('')
    })

    it('should return JSON when --json flag is used', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'lodash',
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {
              name: 'lodash',
              version: '4.17.21',
              dist: { tarball: 'url', shasum: 'abc', integrity: 'sha512-xxx' },
            },
          },
        }),
      })

      const result = await executeNpmView(['lodash', '--json'])

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.name).toBe('lodash')
      expect(parsed.version).toBe('4.17.21')
    })

    it('should extract specific field', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'lodash',
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {
              name: 'lodash',
              version: '4.17.21',
              license: 'MIT',
              dist: { tarball: 'url', shasum: 'abc', integrity: 'sha512-xxx' },
            },
          },
        }),
      })

      const result = await executeNpmView(['lodash', 'version'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('4.17.21')
    })

    it('should handle package not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await executeNpmView(['nonexistent-package-xyz'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('404')
    })

    it('should return error for missing package spec', async () => {
      const result = await executeNpmView([])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage')
    })
  })

  describe('executeNpmSearch', () => {
    it('should search and format results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          objects: [
            {
              package: {
                name: 'lodash',
                version: '4.17.21',
                description: 'A modern JavaScript utility library',
                author: { name: 'jdalton' },
                keywords: ['utility'],
              },
              score: { final: 0.95, detail: {} },
            },
          ],
          total: 1,
        }),
      })

      const result = await executeNpmSearch(['lodash'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('lodash')
      expect(result.stdout).toContain('4.17.21')
    })

    it('should return JSON when --json flag is used', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          objects: [
            {
              package: {
                name: 'lodash',
                version: '4.17.21',
                description: 'utility library',
              },
              score: { final: 0.95, detail: {} },
            },
          ],
          total: 1,
        }),
      })

      const result = await executeNpmSearch(['lodash', '--json'])

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].package.name).toBe('lodash')
    })

    it('should handle no results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ objects: [], total: 0 }),
      })

      const result = await executeNpmSearch(['zzz-nonexistent-package-xyz'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No results')
    })

    it('should return error for empty query', async () => {
      const result = await executeNpmSearch([])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage')
    })
  })

  describe('executeNpmPack', () => {
    it('should return error for missing package spec', async () => {
      const result = await executeNpmPack([])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage')
    })

    // Note: Full npm pack test with tarball download requires more complex mocking
    // of the NpmRegistryClient which uses its own fetch wrapper. The integration
    // is verified via the TieredExecutor tests.
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('npm-native utility functions', () => {
  describe('canExecuteNativeNpm', () => {
    it('should return true for npm view', () => {
      expect(canExecuteNativeNpm(['view', 'lodash'])).toBe(true)
    })

    it('should return true for npm info', () => {
      expect(canExecuteNativeNpm(['info', 'lodash'])).toBe(true)
    })

    it('should return true for npm show', () => {
      expect(canExecuteNativeNpm(['show', 'lodash'])).toBe(true)
    })

    it('should return true for npm search', () => {
      expect(canExecuteNativeNpm(['search', 'lodash'])).toBe(true)
    })

    it('should return true for npm find', () => {
      expect(canExecuteNativeNpm(['find', 'lodash'])).toBe(true)
    })

    it('should return true for npm s (search alias)', () => {
      expect(canExecuteNativeNpm(['s', 'lodash'])).toBe(true)
    })

    it('should return false for npm install', () => {
      expect(canExecuteNativeNpm(['install', 'lodash'])).toBe(false)
    })

    it('should return false for npm run', () => {
      expect(canExecuteNativeNpm(['run', 'test'])).toBe(false)
    })

    it('should return false for npm test', () => {
      expect(canExecuteNativeNpm(['test'])).toBe(false)
    })

    it('should return false for npm pack without --json', () => {
      expect(canExecuteNativeNpm(['pack', 'lodash'])).toBe(false)
    })

    it('should return true for npm pack with --json', () => {
      expect(canExecuteNativeNpm(['pack', 'lodash', '--json'])).toBe(true)
    })

    it('should return true for npm pack with --dry-run', () => {
      expect(canExecuteNativeNpm(['pack', '--dry-run'])).toBe(true)
    })
  })

  describe('extractNpmSubcommand', () => {
    it('should extract view from npm view lodash', () => {
      expect(extractNpmSubcommand('npm view lodash')).toBe('view')
    })

    it('should extract install from npm install', () => {
      expect(extractNpmSubcommand('npm install')).toBe('install')
    })

    it('should extract search from npm search react', () => {
      expect(extractNpmSubcommand('npm search react')).toBe('search')
    })

    it('should return empty for non-npm command', () => {
      expect(extractNpmSubcommand('yarn install')).toBe('')
    })

    it('should return empty for npm without subcommand', () => {
      expect(extractNpmSubcommand('npm')).toBe('')
    })
  })

  describe('command sets', () => {
    it('should include view commands in NATIVE_NPM_COMMANDS', () => {
      expect(NATIVE_NPM_COMMANDS.has('view')).toBe(true)
      expect(NATIVE_NPM_COMMANDS.has('info')).toBe(true)
      expect(NATIVE_NPM_COMMANDS.has('show')).toBe(true)
    })

    it('should include search commands in NATIVE_NPM_COMMANDS', () => {
      expect(NATIVE_NPM_COMMANDS.has('search')).toBe(true)
      expect(NATIVE_NPM_COMMANDS.has('find')).toBe(true)
      expect(NATIVE_NPM_COMMANDS.has('s')).toBe(true)
    })

    it('should include install commands in RPC_ONLY_NPM_COMMANDS', () => {
      expect(RPC_ONLY_NPM_COMMANDS.has('install')).toBe(true)
      expect(RPC_ONLY_NPM_COMMANDS.has('i')).toBe(true)
      expect(RPC_ONLY_NPM_COMMANDS.has('ci')).toBe(true)
    })

    it('should include run commands in RPC_ONLY_NPM_COMMANDS', () => {
      expect(RPC_ONLY_NPM_COMMANDS.has('run')).toBe(true)
      expect(RPC_ONLY_NPM_COMMANDS.has('run-script')).toBe(true)
      expect(RPC_ONLY_NPM_COMMANDS.has('test')).toBe(true)
      expect(RPC_ONLY_NPM_COMMANDS.has('start')).toBe(true)
      expect(RPC_ONLY_NPM_COMMANDS.has('build')).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('npm-native integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('executeNpmNative routing', () => {
    it('should route view command to executeNpmView', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'lodash',
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {
              name: 'lodash',
              version: '4.17.21',
              dist: { tarball: 'url', shasum: 'abc', integrity: 'sha512-xxx' },
            },
          },
        }),
      })

      const result = await executeNpmNative('npm view lodash', ['view', 'lodash'])

      expect(result).not.toBeNull()
      expect(result!.exitCode).toBe(0)
      expect(result!.stdout).toContain('lodash')
    })

    it('should route search command to executeNpmSearch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          objects: [{ package: { name: 'lodash', version: '4.17.21' }, score: { final: 0.9 } }],
          total: 1,
        }),
      })

      const result = await executeNpmNative('npm search lodash', ['search', 'lodash'])

      expect(result).not.toBeNull()
      expect(result!.exitCode).toBe(0)
      expect(result!.stdout).toContain('lodash')
    })

    it('should return null for unsupported commands', async () => {
      const result = await executeNpmNative('npm install', ['install', 'lodash'])

      expect(result).toBeNull()
    })

    it('should return null for npm pack without --json or --dry-run', async () => {
      const result = await executeNpmNative('npm pack lodash', ['pack', 'lodash'])

      expect(result).toBeNull()
    })
  })
})
