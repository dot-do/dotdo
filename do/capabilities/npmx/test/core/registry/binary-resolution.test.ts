/**
 * RED Phase Tests for Package Binary Resolution
 *
 * Tests for finding executable binaries in npm packages.
 * This module handles resolution from:
 * - bin field as string (single binary, uses package name)
 * - bin field as object (multiple named binaries)
 * - directories.bin field (directory containing executables)
 *
 * @module npmx/test/core/registry/binary-resolution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveBinaryPath,
  resolveBinaries,
  type BinaryResolutionResult,
  type BinaryEntry,
  type ResolveBinaryOptions,
} from '../../../core/registry/binary-resolution.js'

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createPackageJson(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test-package',
    version: '1.0.0',
    ...overrides,
  }
}

// ============================================================================
// BINARY FROM BIN FIELD (STRING)
// ============================================================================

describe('Binary Resolution - bin field as string', () => {
  it('should resolve single binary from string bin field', () => {
    const pkg = createPackageJson({
      name: 'my-cli',
      bin: './bin/cli.js',
    })

    const result = resolveBinaryPath(pkg, 'my-cli')

    expect(result).toEqual<BinaryResolutionResult>({
      found: true,
      name: 'my-cli',
      path: './bin/cli.js',
      package: 'my-cli',
    })
  })

  it('should resolve binary with default command name from package name', () => {
    const pkg = createPackageJson({
      name: 'cowsay',
      bin: './lib/index.js',
    })

    // When no command name specified, use package name
    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(true)
    expect(result.name).toBe('cowsay')
    expect(result.path).toBe('./lib/index.js')
  })

  it('should normalize paths without leading ./', () => {
    const pkg = createPackageJson({
      name: 'my-tool',
      bin: 'bin/tool.js',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.path).toBe('./bin/tool.js')
  })

  it('should handle bin path with backslashes (Windows)', () => {
    const pkg = createPackageJson({
      name: 'win-tool',
      bin: 'bin\\tool.js',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.path).toBe('./bin/tool.js')
  })

  it('should fail when requesting non-existent binary name from string bin', () => {
    const pkg = createPackageJson({
      name: 'my-cli',
      bin: './cli.js',
    })

    const result = resolveBinaryPath(pkg, 'other-command')

    expect(result.found).toBe(false)
    expect(result.error).toBe('Binary "other-command" not found in package my-cli')
  })
})

// ============================================================================
// BINARY FROM BIN FIELD (OBJECT WITH MULTIPLE BINS)
// ============================================================================

describe('Binary Resolution - bin field as object', () => {
  it('should resolve specific binary from object bin field', () => {
    const pkg = createPackageJson({
      name: 'my-tools',
      bin: {
        'tool-a': './bin/tool-a.js',
        'tool-b': './bin/tool-b.js',
        'tool-c': './bin/tool-c.js',
      },
    })

    const result = resolveBinaryPath(pkg, 'tool-b')

    expect(result).toEqual<BinaryResolutionResult>({
      found: true,
      name: 'tool-b',
      path: './bin/tool-b.js',
      package: 'my-tools',
    })
  })

  it('should resolve first binary when no name specified and multiple exist', () => {
    const pkg = createPackageJson({
      name: 'multi-tool',
      bin: {
        'alpha': './bin/alpha.js',
        'beta': './bin/beta.js',
      },
    })

    const result = resolveBinaryPath(pkg)

    // Should return the first one (alphabetically or by insertion order)
    expect(result.found).toBe(true)
    expect(['alpha', 'beta']).toContain(result.name)
    expect(result.path).toBeDefined()
  })

  it('should fail when binary name not found in object', () => {
    const pkg = createPackageJson({
      name: 'my-tools',
      bin: {
        'existing-tool': './bin/tool.js',
      },
    })

    const result = resolveBinaryPath(pkg, 'non-existent')

    expect(result.found).toBe(false)
    expect(result.error).toContain('non-existent')
    expect(result.availableBinaries).toContain('existing-tool')
  })

  it('should list all available binaries on error', () => {
    const pkg = createPackageJson({
      name: 'toolbox',
      bin: {
        'hammer': './tools/hammer.js',
        'screwdriver': './tools/screwdriver.js',
        'wrench': './tools/wrench.js',
      },
    })

    const result = resolveBinaryPath(pkg, 'drill')

    expect(result.found).toBe(false)
    expect(result.availableBinaries).toEqual(
      expect.arrayContaining(['hammer', 'screwdriver', 'wrench'])
    )
  })

  it('should normalize all paths in bin object', () => {
    const pkg = createPackageJson({
      name: 'tools',
      bin: {
        'a': 'bin/a.js',
        'b': './bin/b.js',
        'c': 'bin\\c.js',
      },
    })

    const binaries = resolveBinaries(pkg)

    expect(binaries['a']).toBe('./bin/a.js')
    expect(binaries['b']).toBe('./bin/b.js')
    expect(binaries['c']).toBe('./bin/c.js')
  })
})

// ============================================================================
// BINARY FROM DIRECTORIES.BIN
// ============================================================================

describe('Binary Resolution - directories.bin', () => {
  it('should resolve binaries from directories.bin', async () => {
    const pkg = createPackageJson({
      name: 'dir-tools',
      directories: {
        bin: './bin',
      },
    })

    // Mock filesystem listing
    const mockFiles = ['cli.js', 'helper.js', 'utils.js']
    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockResolvedValue(mockFiles),
    }

    const binaries = await resolveBinaries(pkg, options)

    expect(options.listDirectory).toHaveBeenCalledWith('./bin')
    expect(binaries).toEqual({
      'cli': './bin/cli.js',
      'helper': './bin/helper.js',
      'utils': './bin/utils.js',
    })
  })

  it('should resolve specific binary from directories.bin', async () => {
    const pkg = createPackageJson({
      name: 'my-cli',
      directories: {
        bin: 'scripts',
      },
    })

    const mockFiles = ['build.js', 'test.sh', 'deploy.js']
    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockResolvedValue(mockFiles),
    }

    const result = await resolveBinaryPath(pkg, 'build', options)

    expect(result.found).toBe(true)
    expect(result.name).toBe('build')
    expect(result.path).toBe('./scripts/build.js')
  })

  it('should use filename without extension as binary name', async () => {
    const pkg = createPackageJson({
      name: 'ext-test',
      directories: {
        bin: './bin',
      },
    })

    const mockFiles = ['my-script.mjs', 'other.cjs', 'plain.js']
    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockResolvedValue(mockFiles),
    }

    const binaries = await resolveBinaries(pkg, options)

    expect(binaries['my-script']).toBe('./bin/my-script.mjs')
    expect(binaries['other']).toBe('./bin/other.cjs')
    expect(binaries['plain']).toBe('./bin/plain.js')
  })

  it('should handle empty directories.bin', async () => {
    const pkg = createPackageJson({
      name: 'empty-bin',
      directories: {
        bin: './bin',
      },
    })

    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockResolvedValue([]),
    }

    const binaries = await resolveBinaries(pkg, options)

    expect(binaries).toEqual({})
  })

  it('should handle non-existent directories.bin directory', async () => {
    const pkg = createPackageJson({
      name: 'missing-dir',
      directories: {
        bin: './missing-directory',
      },
    })

    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
    }

    const result = await resolveBinaryPath(pkg, 'any', options)

    expect(result.found).toBe(false)
    expect(result.error).toContain('directories.bin')
  })

  it('should prefer bin field over directories.bin', async () => {
    const pkg = createPackageJson({
      name: 'prefer-bin',
      bin: {
        'explicit': './explicit-bin.js',
      },
      directories: {
        bin: './bin', // This contains other files
      },
    })

    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockResolvedValue(['implicit.js']),
    }

    const result = await resolveBinaryPath(pkg, 'explicit', options)

    expect(result.found).toBe(true)
    expect(result.path).toBe('./explicit-bin.js')
    // directories.bin should not be consulted when bin field exists
    expect(options.listDirectory).not.toHaveBeenCalled()
  })
})

// ============================================================================
// HANDLE PACKAGE WITH NO BINARIES
// ============================================================================

describe('Binary Resolution - packages without binaries', () => {
  it('should return not found for package without bin or directories.bin', () => {
    const pkg = createPackageJson({
      name: 'no-bin-package',
      main: './index.js',
    })

    const result = resolveBinaryPath(pkg, 'anything')

    expect(result.found).toBe(false)
    expect(result.error).toBe('Package no-bin-package has no binaries')
    expect(result.hasBinaries).toBe(false)
  })

  it('should return empty object from resolveBinaries for no-bin package', () => {
    const pkg = createPackageJson({
      name: 'library-only',
      main: './lib/index.js',
      exports: { '.': './lib/index.js' },
    })

    const binaries = resolveBinaries(pkg)

    expect(binaries).toEqual({})
  })

  it('should handle null bin field', () => {
    const pkg = createPackageJson({
      name: 'null-bin',
      bin: null,
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.hasBinaries).toBe(false)
  })

  it('should handle empty bin object', () => {
    const pkg = createPackageJson({
      name: 'empty-bin-obj',
      bin: {},
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.error).toContain('no binaries')
  })

  it('should handle empty bin string', () => {
    const pkg = createPackageJson({
      name: 'empty-bin-str',
      bin: '',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.error).toContain('empty')
  })
})

// ============================================================================
// RESOLVE BINARY PATH FOR SCOPED PACKAGES
// ============================================================================

describe('Binary Resolution - scoped packages', () => {
  it('should use package name without scope for string bin', () => {
    const pkg = createPackageJson({
      name: '@myorg/cli-tool',
      bin: './bin/cli.js',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.name).toBe('cli-tool')
    expect(result.path).toBe('./bin/cli.js')
  })

  it('should resolve binary by scope-less name', () => {
    const pkg = createPackageJson({
      name: '@company/eslint-plugin',
      bin: './bin/lint.js',
    })

    // User should be able to run: npx eslint-plugin
    const result = resolveBinaryPath(pkg, 'eslint-plugin')

    expect(result.found).toBe(true)
    expect(result.name).toBe('eslint-plugin')
  })

  it('should preserve explicit binary names in scoped packages', () => {
    const pkg = createPackageJson({
      name: '@scope/multi-tool',
      bin: {
        'custom-name': './bin/custom.js',
        'another-tool': './bin/another.js',
      },
    })

    const result = resolveBinaryPath(pkg, 'custom-name')

    expect(result.found).toBe(true)
    expect(result.name).toBe('custom-name')
    expect(result.path).toBe('./bin/custom.js')
  })

  it('should handle deeply nested scopes', () => {
    const pkg = createPackageJson({
      name: '@org/sub/nested-cli',
      bin: './cli.js',
    })

    const result = resolveBinaryPath(pkg)

    // Should extract the last part after the scope
    expect(result.name).toBe('nested-cli')
  })

  it('should handle scoped package with directories.bin', async () => {
    const pkg = createPackageJson({
      name: '@team/dev-tools',
      directories: {
        bin: './scripts',
      },
    })

    const options: ResolveBinaryOptions = {
      listDirectory: vi.fn().mockResolvedValue(['build.js', 'test.js']),
    }

    const binaries = await resolveBinaries(pkg, options)

    expect(binaries).toEqual({
      'build': './scripts/build.js',
      'test': './scripts/test.js',
    })
  })
})

// ============================================================================
// HANDLE BIN POINTING TO NON-EXISTENT FILE
// ============================================================================

describe('Binary Resolution - file existence validation', () => {
  it('should validate binary file exists when option enabled', async () => {
    const pkg = createPackageJson({
      name: 'bad-bin',
      bin: './non-existent.js',
    })

    const options: ResolveBinaryOptions = {
      validateExists: true,
      fileExists: vi.fn().mockResolvedValue(false),
    }

    const result = await resolveBinaryPath(pkg, 'bad-bin', options)

    expect(options.fileExists).toHaveBeenCalledWith('./non-existent.js')
    expect(result.found).toBe(false)
    expect(result.error).toContain('does not exist')
    expect(result.path).toBe('./non-existent.js') // Still provide the path
  })

  it('should succeed when binary file exists', async () => {
    const pkg = createPackageJson({
      name: 'good-bin',
      bin: './cli.js',
    })

    const options: ResolveBinaryOptions = {
      validateExists: true,
      fileExists: vi.fn().mockResolvedValue(true),
    }

    const result = await resolveBinaryPath(pkg, 'good-bin', options)

    expect(result.found).toBe(true)
    expect(result.path).toBe('./cli.js')
  })

  it('should validate all binaries in object bin field', async () => {
    const pkg = createPackageJson({
      name: 'mixed-bin',
      bin: {
        'good': './bin/good.js',
        'bad': './bin/missing.js',
        'also-good': './bin/also-good.js',
      },
    })

    const options: ResolveBinaryOptions = {
      validateExists: true,
      fileExists: vi.fn().mockImplementation(async (path: string) => {
        return path !== './bin/missing.js'
      }),
    }

    // Requesting the bad one should fail
    const result = await resolveBinaryPath(pkg, 'bad', options)

    expect(result.found).toBe(false)
    expect(result.error).toContain('does not exist')
  })

  it('should collect all validation errors when validating all binaries', async () => {
    const pkg = createPackageJson({
      name: 'multi-missing',
      bin: {
        'a': './missing-a.js',
        'b': './missing-b.js',
        'c': './exists.js',
      },
    })

    const options: ResolveBinaryOptions = {
      validateExists: true,
      fileExists: vi.fn().mockImplementation(async (path: string) => {
        return path === './exists.js'
      }),
    }

    const binaries = await resolveBinaries(pkg, options)

    expect(binaries).toEqual({
      'c': './exists.js',
    })
    // Missing files should be filtered out
    expect(binaries['a']).toBeUndefined()
    expect(binaries['b']).toBeUndefined()
  })

  it('should skip validation when option disabled', () => {
    const pkg = createPackageJson({
      name: 'skip-validate',
      bin: './maybe-missing.js',
    })

    const options: ResolveBinaryOptions = {
      validateExists: false,
      fileExists: vi.fn(),
    }

    const result = resolveBinaryPath(pkg, 'skip-validate', options)

    // fileExists should not be called
    expect(options.fileExists).not.toHaveBeenCalled()
    expect(result.found).toBe(true)
  })

  it('should handle filesystem errors gracefully', async () => {
    const pkg = createPackageJson({
      name: 'fs-error',
      bin: './bin/cli.js',
    })

    const options: ResolveBinaryOptions = {
      validateExists: true,
      fileExists: vi.fn().mockRejectedValue(new Error('Permission denied')),
    }

    const result = await resolveBinaryPath(pkg, 'fs-error', options)

    expect(result.found).toBe(false)
    expect(result.error).toContain('Permission denied')
  })
})

// ============================================================================
// EDGE CASES AND INTEGRATION
// ============================================================================

describe('Binary Resolution - edge cases', () => {
  it('should handle package.json with both string and interpreted as string', () => {
    // Some tools might parse bin incorrectly
    const pkg = createPackageJson({
      name: 'weird-bin',
      bin: JSON.stringify('./cli.js'), // Accidentally stringified
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.error).toContain('invalid')
  })

  it('should reject bin paths with path traversal', () => {
    const pkg = createPackageJson({
      name: 'evil-package',
      bin: '../../../etc/passwd',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.error).toContain('path traversal')
  })

  it('should reject absolute paths in bin', () => {
    const pkg = createPackageJson({
      name: 'absolute-bin',
      bin: '/usr/bin/node',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.error).toContain('absolute')
  })

  it('should handle bin with protocol schemes', () => {
    const pkg = createPackageJson({
      name: 'scheme-bin',
      bin: 'file:///path/to/bin.js',
    })

    const result = resolveBinaryPath(pkg)

    expect(result.found).toBe(false)
    expect(result.error).toContain('invalid')
  })

  it('should handle very long binary names', () => {
    const longName = 'a'.repeat(300)
    const pkg = createPackageJson({
      name: 'long-name-pkg',
      bin: {
        [longName]: './bin.js',
      },
    })

    const result = resolveBinaryPath(pkg, longName)

    // Should work but might warn about length
    expect(result.found).toBe(true)
  })

  it('should handle binary names with special characters', () => {
    const pkg = createPackageJson({
      name: 'special-chars',
      bin: {
        'my-tool': './bin/tool.js',
        'my_tool': './bin/tool2.js',
        'my.tool': './bin/tool3.js',
      },
    })

    expect(resolveBinaryPath(pkg, 'my-tool').found).toBe(true)
    expect(resolveBinaryPath(pkg, 'my_tool').found).toBe(true)
    expect(resolveBinaryPath(pkg, 'my.tool').found).toBe(true)
  })

  it('should be case-sensitive for binary names', () => {
    const pkg = createPackageJson({
      name: 'case-sensitive',
      bin: {
        'MyTool': './bin/tool.js',
      },
    })

    expect(resolveBinaryPath(pkg, 'MyTool').found).toBe(true)
    expect(resolveBinaryPath(pkg, 'mytool').found).toBe(false)
    expect(resolveBinaryPath(pkg, 'MYTOOL').found).toBe(false)
  })
})
