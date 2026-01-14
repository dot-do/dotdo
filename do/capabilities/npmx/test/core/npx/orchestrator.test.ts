/**
 * Tests for NPX Orchestrator
 *
 * Tests the full npx execution flow:
 * 1. npx cowsay hello - fetch, bundle, execute, output
 * 2. npx -p typescript tsc --version - multi-package
 * 3. Handle package not found
 * 4. Handle execution error
 * 5. Handle timeout
 * 6. Correct exit code propagation
 *
 * @module npmx/test/core/npx/orchestrator
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  executeNpx,
  parseCommand,
  type NpxOptions,
  type NpxResult,
  type ParsedCommand,
} from '../../../core/npx/orchestrator.js'

// ============================================================================
// COMMAND PARSING
// ============================================================================

describe('NPX Orchestrator - Command Parsing', () => {
  it('parses simple command', () => {
    const parsed = parseCommand('cowsay')

    expect(parsed.package).toBe('cowsay')
    expect(parsed.args).toEqual([])
    expect(parsed.binary).toBeUndefined()
    expect(parsed.additionalPackages).toEqual([])
  })

  it('parses command with arguments', () => {
    const parsed = parseCommand('cowsay', ['hello', 'world'])

    expect(parsed.package).toBe('cowsay')
    expect(parsed.args).toEqual(['hello', 'world'])
  })

  it('parses command with version', () => {
    const parsed = parseCommand('lodash@4.17.21')

    expect(parsed.package).toBe('lodash@4.17.21')
  })

  it('parses scoped package', () => {
    const parsed = parseCommand('@scope/package')

    expect(parsed.package).toBe('@scope/package')
  })

  it('parses scoped package with version', () => {
    const parsed = parseCommand('@vue/reactivity@3.3.0')

    expect(parsed.package).toBe('@vue/reactivity@3.3.0')
  })

  it('parses -p flag for additional packages', () => {
    const parsed = parseCommand('tsc', ['-p', 'typescript', '--version'])

    expect(parsed.package).toBe('typescript')
    expect(parsed.binary).toBe('tsc')
    expect(parsed.args).toEqual(['--version'])
  })

  it('parses --package flag', () => {
    const parsed = parseCommand('tsc', ['--package', 'typescript', '--version'])

    expect(parsed.package).toBe('typescript')
    expect(parsed.binary).toBe('tsc')
  })

  it('parses multiple -p flags', () => {
    const parsed = parseCommand('eslint', ['-p', '@typescript-eslint/parser', '-p', '@typescript-eslint/eslint-plugin', '.'])

    // First -p package becomes the main package, rest are additional
    expect(parsed.package).toBe('@typescript-eslint/parser')
    expect(parsed.binary).toBe('eslint')
    expect(parsed.additionalPackages).toEqual(['@typescript-eslint/eslint-plugin'])
    expect(parsed.args).toEqual(['.'])
  })

  it('throws for empty command', () => {
    expect(() => parseCommand('')).toThrow(/empty/i)
  })

  it('throws for whitespace-only command', () => {
    expect(() => parseCommand('   ')).toThrow(/empty/i)
  })
})

// ============================================================================
// FULL EXECUTION FLOW
// ============================================================================

describe('NPX Orchestrator - Full Execution Flow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('executes simple package command', async () => {
    // Mock fetch for registry and esm.sh
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'cowsay',
          'dist-tags': { latest: '1.5.0' },
          versions: {
            '1.5.0': {
              name: 'cowsay',
              version: '1.5.0',
              dependencies: {},
              bin: 'cli.js',
              dist: {
                tarball: 'https://registry.npmjs.org/cowsay/-/cowsay-1.5.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        // Return mock ESM bundle
        return new Response('export default function(msg) { console.log(msg); }', {
          status: 200,
          headers: { 'x-esm-id': '/stable/cowsay@1.5.0/cli.js' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('cowsay', { args: ['hello'] })

    expect(result.package).toBe('cowsay')
    expect(result.exitCode).toBe(0)
    expect(result.tier).toBeLessThanOrEqual(2)
    expect(result.duration).toBeGreaterThan(0)
  })

  it('handles package with version specifier', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'lodash',
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {
              name: 'lodash',
              version: '4.17.21',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export default {}', {
          status: 200,
          headers: { 'x-esm-id': '/stable/lodash@4.17.21/index.js' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('lodash@4.17.21')

    expect(result.package).toBe('lodash')
    expect(result.version).toBe('4.17.21')
  })

  it('classifies and executes Tier 1 package', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'nanoid',
          'dist-tags': { latest: '5.0.0' },
          versions: {
            '5.0.0': {
              name: 'nanoid',
              version: '5.0.0',
              type: 'module',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/nanoid/-/nanoid-5.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export { nanoid }', {
          status: 200,
          headers: { 'x-esm-id': '/stable/nanoid@5.0.0/index.js' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('nanoid')

    expect(result.tier).toBeLessThanOrEqual(2)
    expect(result.exitCode).toBe(0)
  })

  it('classifies and handles Tier 3 package', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'esbuild',
          'dist-tags': { latest: '0.19.0' },
          versions: {
            '0.19.0': {
              name: 'esbuild',
              version: '0.19.0',
              dependencies: {},
              bin: { esbuild: 'bin/esbuild' },
              dist: {
                tarball: 'https://registry.npmjs.org/esbuild/-/esbuild-0.19.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('esbuild')

    expect(result.tier).toBe(3)
    expect(result.classification?.requiresNative).toBe(true)
    expect(result.stderr).toContain('native')
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('NPX Orchestrator - Error Handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles package not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('nonexistent-package-xyz-123')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not found')
  })

  it('handles execution timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      // Simulate timeout by never resolving
      return new Promise(() => {})
    })

    const result = await executeNpx('slow-package', {
      timeout: 100,
    })

    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  }, 10000)

  it('handles registry fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('Internal Server Error', { status: 500 })
    })

    const result = await executeNpx('failing-registry-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBeDefined()
  })

  it('propagates exit code correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'test-pkg',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'test-pkg',
              version: '1.0.0',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('throw new Error("intentional failure")', {
          status: 200,
          headers: { 'x-esm-id': '/stable/test-pkg@1.0.0/index.js' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('test-pkg')

    // Result should have appropriate exit code
    expect(typeof result.exitCode).toBe('number')
  })
})

// ============================================================================
// OPTIONS
// ============================================================================

describe('NPX Orchestrator - Options', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('respects custom registry', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('custom-registry.example.com')) {
        return new Response(JSON.stringify({
          name: 'private-pkg',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'private-pkg',
              version: '1.0.0',
              dependencies: {},
              dist: {
                tarball: 'https://custom-registry.example.com/private-pkg/-/private-pkg-1.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export default {}', {
          status: 200,
        })
      }

      return new Response('Not found', { status: 404 })
    })

    await executeNpx('private-pkg', {
      registry: 'https://custom-registry.example.com',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('custom-registry.example.com'),
      expect.any(Object)
    )
  })

  it('forces specific execution tier', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'lodash-es',
          'dist-tags': { latest: '4.17.21' },
          versions: {
            '4.17.21': {
              name: 'lodash-es',
              version: '4.17.21',
              type: 'module',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/lodash-es/-/lodash-es-4.17.21.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export {}', {
          status: 200,
          headers: { 'x-esm-id': '/stable/lodash-es@4.17.21/index.js' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('lodash-es', {
      forceTier: 2,
    })

    expect(result.tier).toBe(2)
  })

  it('passes environment variables', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'env-pkg',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'env-pkg',
              version: '1.0.0',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/env-pkg/-/env-pkg-1.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('console.log(process.env.MY_VAR)', {
          status: 200,
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('env-pkg', {
      env: {
        MY_VAR: 'test-value',
        NODE_ENV: 'production',
      },
    })

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// MULTI-PACKAGE EXECUTION
// ============================================================================

describe('NPX Orchestrator - Multi-Package', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles npx -p typescript tsc --version style', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'typescript',
          'dist-tags': { latest: '5.0.0' },
          versions: {
            '5.0.0': {
              name: 'typescript',
              version: '5.0.0',
              dependencies: {},
              bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' },
              dist: {
                tarball: 'https://registry.npmjs.org/typescript/-/typescript-5.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export {}', {
          status: 200,
        })
      }

      return new Response('Not found', { status: 404 })
    })

    // Parse and execute as would be done in CLI
    const parsed = parseCommand('tsc', ['-p', 'typescript', '--version'])

    expect(parsed.package).toBe('typescript')
    expect(parsed.binary).toBe('tsc')
    expect(parsed.args).toEqual(['--version'])

    const result = await executeNpx(parsed.package, {
      args: parsed.args,
    })

    expect(result.package).toBe('typescript')
  })
})

// ============================================================================
// CACHING
// ============================================================================

describe('NPX Orchestrator - Caching', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips cache when noCache is true', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'test-pkg',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'test-pkg',
              version: '1.0.0',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export {}', {
          status: 200,
        })
      }

      return new Response('Not found', { status: 404 })
    })

    // First call
    await executeNpx('test-pkg', { noCache: true })

    // Second call should still fetch (not use cache)
    await executeNpx('test-pkg', { noCache: true })

    // Should have made multiple fetch calls
    expect(mockFetch.mock.calls.length).toBeGreaterThan(2)
  })
})

// ============================================================================
// RESULT STRUCTURE
// ============================================================================

describe('NPX Orchestrator - Result Structure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns complete result structure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'result-test',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'result-test',
              version: '1.0.0',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/result-test/-/result-test-1.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export {}', {
          status: 200,
          headers: { 'x-esm-id': '/stable/result-test@1.0.0/index.js' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('result-test')

    // Check all required fields are present
    expect(typeof result.exitCode).toBe('number')
    expect(typeof result.stdout).toBe('string')
    expect(typeof result.stderr).toBe('string')
    expect(typeof result.duration).toBe('number')
    expect(typeof result.timedOut).toBe('boolean')
    expect([1, 2, 3]).toContain(result.tier)
    expect(typeof result.package).toBe('string')
    expect(typeof result.version).toBe('string')
  })

  it('includes classification in result when available', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({
          name: 'chalk',
          'dist-tags': { latest: '5.0.0' },
          versions: {
            '5.0.0': {
              name: 'chalk',
              version: '5.0.0',
              dependencies: {},
              dist: {
                tarball: 'https://registry.npmjs.org/chalk/-/chalk-5.0.0.tgz',
                shasum: 'abc123',
                integrity: 'sha512-...',
              },
            },
          },
        }), { status: 200 })
      }

      if (urlString.includes('esm.sh')) {
        return new Response('export {}', {
          status: 200,
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await executeNpx('chalk')

    // chalk is a known Tier 2 package
    expect(result.tier).toBe(2)
    expect(result.classification).toBeDefined()
    expect(result.classification?.tier).toBe(2)
  })
})
