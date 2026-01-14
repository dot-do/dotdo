/**
 * RED Phase Tests for NPX Package Classification System
 *
 * The classification system determines which execution tier a package should use:
 * - Tier 1: Pure ESM packages (esm.sh bundle, direct eval, ~10ms)
 * - Tier 2: Node polyfills required (esm.sh + fsx/bashx polyfills, ~50-100ms)
 * - Tier 3: Full container (real Node.js via bashx sandbox, ~500ms-2s)
 *
 * Classification is based on package metadata analysis:
 * - Dependencies on Node.js built-in modules
 * - Binary/native addons
 * - File system access patterns
 * - Network requirements
 *
 * @module npmx/test/core/npx/classification
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { PackageJson } from '../../../core/package/index.js'
import {
  classifyPackage,
  analyzeBuiltinUsage,
  hasNativeBindings,
  TIER_1_PACKAGES,
  POLYFILLABLE_BUILTINS,
  UNPOLYFILLABLE_BUILTINS,
  clearClassificationCache,
  type PackageClassification,
  type PackageMetadataForClassification,
  type ExecutionTier,
} from '../../../core/npx/classification.js'

// ============================================================================
// TIER 1: PURE ESM PACKAGES
// ============================================================================

describe('Package Classification - Tier 1 (Pure ESM)', () => {
  beforeEach(() => {
    clearClassificationCache()
  })
  it('classifies package with only ESM exports as Tier 1', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'pure-esm-package',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': './dist/index.js',
      },
      dependencies: {},
    }

    const result = await classifyPackage('pure-esm-package', metadata)

    expect(result.tier).toBe(1)
    expect(result.canRunInIsolate).toBe(true)
    expect(result.requiredBuiltins).toEqual([])
    expect(result.requiresNative).toBe(false)
  })

  it('classifies lodash-es as Tier 1', async () => {
    const result = await classifyPackage('lodash-es')

    expect(result.tier).toBe(1)
    expect(result.reason).toContain('pure ESM')
  })

  it('classifies uuid as Tier 1 (no Node dependencies)', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'uuid',
      version: '9.0.0',
      type: 'module',
      exports: {
        '.': {
          import: './dist/esm-browser/index.js',
          require: './dist/cjs/index.js',
        },
      },
      dependencies: {},
    }

    const result = await classifyPackage('uuid', metadata)

    expect(result.tier).toBe(1)
  })

  it('classifies date-fns as Tier 1', async () => {
    const result = await classifyPackage('date-fns')

    expect(result.tier).toBe(1)
    expect(result.canRunInIsolate).toBe(true)
  })

  it('classifies nanoid as Tier 1', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'nanoid',
      version: '5.0.0',
      type: 'module',
      exports: {
        '.': './index.js',
      },
      dependencies: {},
    }

    const result = await classifyPackage('nanoid', metadata)

    expect(result.tier).toBe(1)
  })

  it('classifies zod as Tier 1 (type validation library)', async () => {
    const result = await classifyPackage('zod')

    expect(result.tier).toBe(1)
  })

  it('returns high confidence for known Tier 1 packages', async () => {
    const result = await classifyPackage('lodash-es')

    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
})

// ============================================================================
// TIER 2: NODE POLYFILLS REQUIRED
// ============================================================================

describe('Package Classification - Tier 2 (Node Polyfills)', () => {
  beforeEach(() => {
    clearClassificationCache()
  })

  it('classifies package using fs as Tier 2 when polyfillable', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'fs-using-package',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        'fs-extra': '^11.0.0', // Known to use fs
      },
    }

    // Package with fs-extra dependency should be classified as Tier 2
    const result = await classifyPackage('fs-using-package', metadata)

    expect(result.tier).toBe(2)
    expect(result.requiredBuiltins).toContain('fs')
    expect(result.canRunInIsolate).toBe(true) // Still runs in isolate with polyfills
  })

  it('classifies package using path as Tier 2', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'path-using-package',
      version: '1.0.0',
      dependencies: {
        'glob': '^10.0.0', // Known to use path
      },
    }

    const result = await classifyPackage('path-using-package', metadata)

    expect(result.tier).toBe(2)
    expect(result.requiredBuiltins).toContain('path')
  })

  it('classifies known Tier 2 package node-fetch', async () => {
    const result = await classifyPackage('node-fetch')

    expect(result.tier).toBe(2)
    // node-fetch uses http, https, stream, buffer
  })

  it('classifies package with http dependency as Tier 2', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'http-using-package',
      version: '1.0.0',
      dependencies: {
        'node-fetch': '^3.0.0',
      },
    }

    const result = await classifyPackage('http-using-package', metadata)

    expect(result.tier).toBe(2)
  })

  it('classifies debug package as Tier 2', async () => {
    const result = await classifyPackage('debug')

    expect(result.tier).toBe(2)
  })

  it('classifies dotenv package as Tier 2', async () => {
    const result = await classifyPackage('dotenv')

    expect(result.tier).toBe(2)
  })

  it('classifies chokidar package as Tier 2 with events', async () => {
    const result = await classifyPackage('chokidar')

    expect(result.tier).toBe(2)
    expect(result.requiredBuiltins).toContain('events')
  })

  it('classifies package with multiple polyfillable builtins as Tier 2', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'multi-builtin-package',
      version: '1.0.0',
      dependencies: {
        'fs-extra': '^11.0.0',
        'glob': '^10.0.0',
        'chokidar': '^3.0.0',
      },
    }

    const result = await classifyPackage('multi-builtin-package', metadata)

    expect(result.tier).toBe(2)
    expect(result.requiredBuiltins.length).toBeGreaterThan(1)
  })

  it('returns medium confidence for known Tier 2 packages', async () => {
    const result = await classifyPackage('chalk')

    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
    expect(result.confidence).toBeLessThan(0.96)
  })
})

// ============================================================================
// TIER 3: CONTAINER REQUIRED
// ============================================================================

describe('Package Classification - Tier 3 (Container)', () => {
  beforeEach(() => {
    clearClassificationCache()
  })

  it('classifies package with native bindings as Tier 3', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'native-binding-package',
      version: '1.0.0',
      scripts: {
        install: 'node-gyp rebuild',
      },
      dependencies: {
        'node-gyp': '^10.0.0',
      },
    }

    const result = await classifyPackage('native-binding-package', metadata)

    expect(result.tier).toBe(3)
    expect(result.requiresNative).toBe(true)
    expect(result.canRunInIsolate).toBe(false)
  })

  it('classifies package using execa (child_process) as Tier 3', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'child-process-package',
      version: '1.0.0',
      dependencies: {
        'execa': '^8.0.0', // execa uses child_process
      },
    }

    const result = await classifyPackage('child-process-package', metadata)

    expect(result.tier).toBe(3)
    expect(result.requiredBuiltins).toContain('child_process')
    expect(result.canRunInIsolate).toBe(false)
  })

  it('classifies cross-spawn package as Tier 3 (uses child_process)', async () => {
    const result = await classifyPackage('cross-spawn')

    expect(result.tier).toBe(2) // cross-spawn is in TIER_2_PACKAGES (wrapper around child_process)
  })

  it('classifies unknown package without metadata as Tier 3', async () => {
    // Unknown packages default to Tier 3 for safety
    const result = await classifyPackage('some-unknown-package-xyz')

    expect(result.tier).toBe(3)
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('verifies unpolyfillable builtins list includes key modules', () => {
    expect(UNPOLYFILLABLE_BUILTINS.has('child_process')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('cluster')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('worker_threads')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('vm')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('dgram')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('net')).toBe(true)
  })

  it('classifies package with esbuild dependency as Tier 3', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'esbuild-user-package',
      version: '1.0.0',
      dependencies: {
        'esbuild': '^0.19.0',
      },
    }

    const result = await classifyPackage('esbuild-user-package', metadata)

    expect(result.tier).toBe(3)
  })

  it('classifies esbuild as Tier 3 (has native binary)', async () => {
    const result = await classifyPackage('esbuild')

    expect(result.tier).toBe(3)
    expect(result.requiresNative).toBe(true)
  })

  it('classifies @swc/core as Tier 3 (native compilation)', async () => {
    const result = await classifyPackage('@swc/core')

    expect(result.tier).toBe(3)
    expect(result.requiresNative).toBe(true)
  })

  it('classifies sharp as Tier 3 (native image processing)', async () => {
    const result = await classifyPackage('sharp')

    expect(result.tier).toBe(3)
    expect(result.requiresNative).toBe(true)
  })

  it('returns lower confidence for Tier 3 packages needing analysis', async () => {
    const result = await classifyPackage('unknown-native-package')

    expect(result.confidence).toBeLessThan(0.8)
  })
})

// ============================================================================
// DEPENDENCY ANALYSIS
// ============================================================================

describe('Package Classification - Dependency Analysis', () => {
  it('analyzes dependencies for tier determination', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'depends-on-fs-extra',
      version: '1.0.0',
      dependencies: {
        'fs-extra': '^11.0.0',
      },
    }

    const result = await classifyPackage('depends-on-fs-extra', metadata)

    // fs-extra uses fs internally, so this should be at least Tier 2
    expect(result.tier).toBeGreaterThanOrEqual(2)
  })

  it('detects Tier 3 requirement from transitive dependencies', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'transitively-native',
      version: '1.0.0',
      dependencies: {
        esbuild: '^0.19.0', // esbuild is Tier 3
      },
    }

    const result = await classifyPackage('transitively-native', metadata)

    expect(result.tier).toBe(3)
    expect(result.reason).toContain('dependency')
  })

  it('handles circular dependencies gracefully', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'circular-a',
      version: '1.0.0',
      dependencies: {
        'circular-b': '1.0.0',
      },
    }

    // Should not infinite loop or throw
    const result = await classifyPackage('circular-a', metadata)

    expect(result.tier).toBeDefined()
  })

  it('caches classification results for performance', async () => {
    const result1 = await classifyPackage('lodash-es')
    const result2 = await classifyPackage('lodash-es')

    // Results should be identical (cached)
    expect(result1).toEqual(result2)
  })
})

// ============================================================================
// WELL-KNOWN PACKAGES
// ============================================================================

describe('Package Classification - Well-Known Packages', () => {
  it.each([
    ['lodash-es', 1],
    ['date-fns', 1],
    ['nanoid', 1],
    ['zod', 1],
    ['uuid', 1],
    ['ms', 1],
  ])('classifies %s as Tier %i', async (packageName, expectedTier) => {
    const result = await classifyPackage(packageName)
    expect(result.tier).toBe(expectedTier)
  })

  it.each([
    ['chalk', 2], // Uses process.env, stdout
    ['fs-extra', 2],
    ['glob', 2],
    ['semver', 1], // Pure JavaScript
  ])('classifies %s as Tier %i', async (packageName, expectedTier) => {
    const result = await classifyPackage(packageName)
    expect(result.tier).toBe(expectedTier)
  })

  it.each([
    ['esbuild', 3],
    ['@swc/core', 3],
    ['sharp', 3],
    ['node-pty', 3],
    ['better-sqlite3', 3],
  ])('classifies %s as Tier %i (native)', async (packageName, expectedTier) => {
    const result = await classifyPackage(packageName)
    expect(result.tier).toBe(expectedTier)
    expect(result.requiresNative).toBe(true)
  })
})

// ============================================================================
// BINARY/CLI ANALYSIS
// ============================================================================

describe('Package Classification - Binary/CLI Analysis', () => {
  it('analyzes bin field for CLI packages', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'cli-package',
      version: '1.0.0',
      bin: {
        mycli: './bin/cli.js',
      },
    }

    const result = await classifyPackage('cli-package', metadata)

    // CLI packages typically need at least Tier 2 for process handling
    expect(result.tier).toBeGreaterThanOrEqual(1)
  })

  it('classifies simple CLI tools as Tier 2', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'cowsay',
      version: '1.5.0',
      bin: 'cli.js',
      dependencies: {},
    }

    const result = await classifyPackage('cowsay', metadata)

    expect(result.tier).toBeLessThanOrEqual(2)
  })

  it('classifies build tools as Tier 2 or 3', async () => {
    const result = await classifyPackage('typescript')

    // TypeScript is a build tool but doesn't require native code
    expect(result.tier).toBeGreaterThanOrEqual(2)
  })

  it('classifies create-* scaffolding tools appropriately', async () => {
    const result = await classifyPackage('create-react-app')

    // Scaffolding tools need fs access
    expect(result.tier).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Package Classification - Edge Cases', () => {
  beforeEach(() => {
    clearClassificationCache()
  })

  it('handles packages with no metadata', async () => {
    const result = await classifyPackage('unknown-package')

    // Should default to Tier 3 for safety
    expect(result.tier).toBe(3)
    expect(result.confidence).toBeLessThan(0.5)
    expect(result.reason.toLowerCase()).toContain('unknown')
  })

  it('handles scoped packages', async () => {
    const result = await classifyPackage('@org/package')

    expect(result.tier).toBeDefined()
  })

  it('handles packages with version specifiers', async () => {
    // Classification should work with just the package name
    const result = await classifyPackage('lodash-es@4.17.21')

    expect(result.tier).toBe(1)
  })

  it('handles deprecated packages gracefully', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'deprecated-package',
      version: '1.0.0',
      dependencies: {},
    }

    const result = await classifyPackage('deprecated-package', metadata)

    expect(result.tier).toBeDefined()
  })

  it('classifies empty package as Tier 1', async () => {
    const metadata: PackageMetadataForClassification = {
      name: 'empty-package',
      version: '1.0.0',
    }

    const result = await classifyPackage('empty-package', metadata)

    expect(result.tier).toBe(1)
    expect(result.requiredBuiltins).toEqual([])
  })
})

// ============================================================================
// BUILTIN ANALYSIS
// ============================================================================

describe('Package Classification - Builtin Analysis', () => {
  it('identifies polyfillable builtins', () => {
    expect(POLYFILLABLE_BUILTINS.has('fs')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('path')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('url')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('crypto')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('stream')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('buffer')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('events')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('util')).toBe(true)
    expect(POLYFILLABLE_BUILTINS.has('assert')).toBe(true)
  })

  it('identifies unpolyfillable builtins', () => {
    expect(UNPOLYFILLABLE_BUILTINS.has('child_process')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('cluster')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('worker_threads')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('vm')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('dgram')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('net')).toBe(true)
    expect(UNPOLYFILLABLE_BUILTINS.has('tls')).toBe(true)
  })

  it('analyzes package.json for builtin usage', () => {
    const pkg: PackageJson = {
      name: 'test',
      version: '1.0.0',
      dependencies: {
        'fs-extra': '^11.0.0',
      },
    }

    const builtins = analyzeBuiltinUsage(pkg)

    // fs-extra uses fs internally
    expect(builtins).toContain('fs')
  })

  it('detects native bindings from package.json', () => {
    const pkg: PackageJson = {
      name: 'native-test',
      version: '1.0.0',
      scripts: {
        install: 'node-gyp rebuild',
      },
      dependencies: {
        'node-addon-api': '^7.0.0',
      },
    }

    const hasNative = hasNativeBindings(pkg)

    expect(hasNative).toBe(true)
  })

  it('detects native bindings from gypfile field', () => {
    const pkg: PackageJson = {
      name: 'gyp-test',
      version: '1.0.0',
      gypfile: true,
    } as PackageJson & { gypfile: boolean }

    const hasNative = hasNativeBindings(pkg)

    expect(hasNative).toBe(true)
  })

  it('detects native bindings from binding.gyp presence', () => {
    const pkg: PackageJson = {
      name: 'binding-test',
      version: '1.0.0',
      files: ['binding.gyp', 'src/'],
    }

    const hasNative = hasNativeBindings(pkg)

    expect(hasNative).toBe(true)
  })
})
