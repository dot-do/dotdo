/**
 * NPX Package Classification System
 *
 * Determines which execution tier a package should use:
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
 * @module npmx/core/npx/classification
 */

import type { PackageJson } from '../package/index.js'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Execution tier for npx packages
 */
export type ExecutionTier = 1 | 2 | 3

/**
 * Classification result for a package
 */
export interface PackageClassification {
  /** Execution tier (1 = pure ESM, 2 = Node polyfills, 3 = container) */
  tier: ExecutionTier
  /** Reason for the classification */
  reason: string
  /** Whether the package can run in V8 isolate */
  canRunInIsolate: boolean
  /** Node.js built-in modules required */
  requiredBuiltins: string[]
  /** Whether native bindings are required */
  requiresNative: boolean
  /** Confidence score (0-1) */
  confidence: number
}

/**
 * Package metadata used for classification
 */
export interface PackageMetadataForClassification {
  name: string
  version: string
  main?: string
  module?: string
  type?: 'module' | 'commonjs'
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  bin?: Record<string, string> | string
  scripts?: Record<string, string>
  engines?: { node?: string }
  files?: string[]
  gypfile?: boolean
}

// ============================================================================
// KNOWN PACKAGE CLASSIFICATIONS
// ============================================================================

/**
 * Known pure ESM packages that can run in Tier 1
 */
export const TIER_1_PACKAGES = new Set<string>([
  // Utility libraries
  'lodash-es',
  'date-fns',
  'nanoid',
  'uuid',
  'ms',
  'zod',
  'yup',
  'superstruct',
  'immer',
  'zustand',
  'jotai',
  'valtio',
  'nanostores',
  // String utilities
  'change-case',
  'camelcase',
  'decamelize',
  'escape-string-regexp',
  'indent-string',
  'strip-ansi',
  // Object utilities
  'klona',
  'fast-deep-equal',
  'deepmerge',
  'rfdc',
  // Array utilities
  'array-shuffle',
  // Validation
  'is-plain-obj',
  'is-buffer',
  'is-promise',
  // Parsing
  'json5',
  'yaml',
  'toml',
  // Semver (pure JS)
  'semver',
])

/**
 * Known Tier 2 packages (need polyfills but can run in isolate)
 */
export const TIER_2_PACKAGES = new Set<string>([
  'chalk',
  'fs-extra',
  'glob',
  'globby',
  'fast-glob',
  'chokidar',
  'node-fetch',
  'cross-fetch',
  'isomorphic-fetch',
  'got',
  'axios',
  'ora',
  'inquirer',
  'prompts',
  'execa',
  'cross-spawn',
  'dotenv',
  'debug',
  'winston',
  'pino',
  'micromatch',
  'minimatch',
  'picomatch',
])

/**
 * Known Tier 3 packages (require real Node.js)
 */
export const TIER_3_PACKAGES = new Set<string>([
  // Native compilation
  'esbuild',
  '@swc/core',
  'lightningcss',
  'oxc',
  // Image processing
  'sharp',
  'jimp',
  'imagemin',
  // Database
  'better-sqlite3',
  'sqlite3',
  'pg-native',
  // System
  'node-pty',
  'node-gyp',
  'prebuild',
  'node-addon-api',
  // Crypto
  'bcrypt',
  'argon2',
  // Compression
  'zlib-sync',
  'snappy',
])

/**
 * Node.js built-in modules that can be polyfilled for Tier 2
 */
export const POLYFILLABLE_BUILTINS = new Set<string>([
  'fs',
  'path',
  'url',
  'crypto',
  'stream',
  'buffer',
  'events',
  'util',
  'assert',
  'querystring',
  'string_decoder',
  'os',
  'timers',
  'punycode',
  'zlib',
  'http',
  'https',
])

/**
 * Node.js built-in modules that require real Node.js (Tier 3)
 */
export const UNPOLYFILLABLE_BUILTINS = new Set<string>([
  'child_process',
  'cluster',
  'worker_threads',
  'vm',
  'dgram',
  'net',
  'tls',
  'dns',
  'fs/promises', // Some implementations may need real fs
  'repl',
  'readline',
  'v8',
  'perf_hooks',
  'async_hooks',
  'trace_events',
  'inspector',
])

/**
 * Dependencies that indicate native bindings
 */
const NATIVE_INDICATORS = new Set<string>([
  'node-gyp',
  'prebuild',
  'node-addon-api',
  'nan',
  'bindings',
  'node-pre-gyp',
  '@mapbox/node-pre-gyp',
  'prebuild-install',
])

/**
 * Script patterns that indicate native compilation
 */
const NATIVE_SCRIPT_PATTERNS = [
  /node-gyp/,
  /prebuild/,
  /cmake/,
  /make\s/,
  /gcc/,
  /g\+\+/,
  /clang/,
]

// ============================================================================
// CLASSIFICATION CACHE
// ============================================================================

/**
 * Cache for classification results
 */
const classificationCache = new Map<string, PackageClassification>()

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract package name without version specifier
 */
function extractPackageName(packageSpec: string): string {
  // Handle @scope/package@version
  if (packageSpec.startsWith('@')) {
    const atIndex = packageSpec.indexOf('@', 1)
    if (atIndex !== -1) {
      return packageSpec.substring(0, atIndex)
    }
  } else {
    const atIndex = packageSpec.indexOf('@')
    if (atIndex !== -1) {
      return packageSpec.substring(0, atIndex)
    }
  }
  return packageSpec
}

/**
 * Check if a dependency list contains native indicators
 */
function hasNativeDependencies(deps: Record<string, string> | undefined): boolean {
  if (!deps) return false
  return Object.keys(deps).some(dep => NATIVE_INDICATORS.has(dep))
}

/**
 * Check if scripts indicate native compilation
 */
function hasNativeScripts(scripts: Record<string, string> | undefined): boolean {
  if (!scripts) return false

  for (const script of Object.values(scripts)) {
    for (const pattern of NATIVE_SCRIPT_PATTERNS) {
      if (pattern.test(script)) {
        return true
      }
    }
  }
  return false
}

/**
 * Check if files list indicates native bindings
 */
function hasNativeFiles(files: string[] | undefined): boolean {
  if (!files) return false

  return files.some(file =>
    file === 'binding.gyp' ||
    file.endsWith('.node') ||
    file.endsWith('.cc') ||
    file.endsWith('.cpp') ||
    file.endsWith('.c') ||
    file.endsWith('.h')
  )
}

/**
 * Analyze dependencies for builtin usage
 * This is a simplified analysis - full analysis would require parsing imports
 */
function analyzeDependenciesForBuiltins(deps: Record<string, string> | undefined): string[] {
  if (!deps) return []

  const builtins: string[] = []

  // Check for packages that are known to use specific builtins
  const builtinMappings: Record<string, string[]> = {
    'fs-extra': ['fs', 'path'],
    'glob': ['fs', 'path'],
    'globby': ['fs', 'path'],
    'fast-glob': ['fs', 'path'],
    'chokidar': ['fs', 'path', 'events'],
    'node-fetch': ['http', 'https', 'stream', 'buffer'],
    'chalk': ['process'],
    'ora': ['process', 'stream'],
    'debug': ['process'],
    'dotenv': ['fs', 'path'],
    'execa': ['child_process'],
    'cross-spawn': ['child_process'],
  }

  for (const dep of Object.keys(deps)) {
    const mappedBuiltins = builtinMappings[dep]
    if (mappedBuiltins) {
      for (const builtin of mappedBuiltins) {
        if (!builtins.includes(builtin)) {
          builtins.push(builtin)
        }
      }
    }
  }

  return builtins
}

// ============================================================================
// MAIN CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Analyze package.json for Node.js built-in module usage
 */
export function analyzeBuiltinUsage(pkg: PackageJson): string[] {
  const builtins: string[] = []

  // Analyze dependencies
  const fromDeps = analyzeDependenciesForBuiltins(pkg.dependencies)
  const fromDevDeps = analyzeDependenciesForBuiltins(pkg.devDependencies)

  for (const builtin of [...fromDeps, ...fromDevDeps]) {
    if (!builtins.includes(builtin)) {
      builtins.push(builtin)
    }
  }

  return builtins
}

/**
 * Check if a package uses native bindings
 */
export function hasNativeBindings(pkg: PackageJson | PackageMetadataForClassification): boolean {
  // Check gypfile field
  if ('gypfile' in pkg && pkg.gypfile) {
    return true
  }

  // Check for binding.gyp in files
  if ('files' in pkg && hasNativeFiles(pkg.files)) {
    return true
  }

  // Check dependencies
  if (hasNativeDependencies(pkg.dependencies)) {
    return true
  }

  // Check dev dependencies (for build-time native deps)
  if ('devDependencies' in pkg && hasNativeDependencies(pkg.devDependencies)) {
    return true
  }

  // Check scripts
  if (hasNativeScripts(pkg.scripts)) {
    return true
  }

  return false
}

/**
 * Classify a package for npx execution
 * @param packageSpec - Package name (with optional version)
 * @param metadata - Package metadata (optional, will be analyzed if provided)
 */
export async function classifyPackage(
  packageSpec: string,
  metadata?: PackageMetadataForClassification
): Promise<PackageClassification> {
  const packageName = extractPackageName(packageSpec)

  // Check cache first
  const cacheKey = metadata ? `${packageName}@${metadata.version}` : packageName
  const cached = classificationCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Check known Tier 1 packages
  if (TIER_1_PACKAGES.has(packageName)) {
    const result: PackageClassification = {
      tier: 1,
      reason: `Known pure ESM package: ${packageName}`,
      canRunInIsolate: true,
      requiredBuiltins: [],
      requiresNative: false,
      confidence: 0.95,
    }
    classificationCache.set(cacheKey, result)
    return result
  }

  // Check known Tier 3 packages (native)
  if (TIER_3_PACKAGES.has(packageName)) {
    const result: PackageClassification = {
      tier: 3,
      reason: `Known native package: ${packageName}`,
      canRunInIsolate: false,
      requiredBuiltins: [],
      requiresNative: true,
      confidence: 0.95,
    }
    classificationCache.set(cacheKey, result)
    return result
  }

  // Check known Tier 2 packages
  if (TIER_2_PACKAGES.has(packageName)) {
    const result: PackageClassification = {
      tier: 2,
      reason: `Known polyfill-compatible package: ${packageName}`,
      canRunInIsolate: true,
      requiredBuiltins: analyzeDependenciesForBuiltins({ [packageName]: '*' }),
      requiresNative: false,
      confidence: 0.9,
    }
    classificationCache.set(cacheKey, result)
    return result
  }

  // If we have metadata, analyze it
  if (metadata) {
    // Check for native bindings
    if (hasNativeBindings(metadata)) {
      const result: PackageClassification = {
        tier: 3,
        reason: 'Package has native bindings',
        canRunInIsolate: false,
        requiredBuiltins: [],
        requiresNative: true,
        confidence: 0.85,
      }
      classificationCache.set(cacheKey, result)
      return result
    }

    // Analyze dependencies for builtins
    const builtins = analyzeDependenciesForBuiltins(metadata.dependencies)

    // Check for unpolyfillable builtins
    const unpolyfillable = builtins.filter(b => UNPOLYFILLABLE_BUILTINS.has(b))
    if (unpolyfillable.length > 0) {
      const result: PackageClassification = {
        tier: 3,
        reason: `Requires unpolyfillable builtins: ${unpolyfillable.join(', ')}`,
        canRunInIsolate: false,
        requiredBuiltins: builtins,
        requiresNative: false,
        confidence: 0.85,
      }
      classificationCache.set(cacheKey, result)
      return result
    }

    // Check for polyfillable builtins
    if (builtins.length > 0) {
      const result: PackageClassification = {
        tier: 2,
        reason: `Requires polyfillable builtins: ${builtins.join(', ')}`,
        canRunInIsolate: true,
        requiredBuiltins: builtins,
        requiresNative: false,
        confidence: 0.8,
      }
      classificationCache.set(cacheKey, result)
      return result
    }

    // Check for transitive native dependencies
    const deps = { ...metadata.dependencies }
    for (const depName of Object.keys(deps)) {
      if (TIER_3_PACKAGES.has(depName)) {
        const result: PackageClassification = {
          tier: 3,
          reason: `Has native dependency: ${depName}`,
          canRunInIsolate: false,
          requiredBuiltins: [],
          requiresNative: true,
          confidence: 0.8,
        }
        classificationCache.set(cacheKey, result)
        return result
      }
    }

    // Pure ESM with no Node dependencies
    if (metadata.type === 'module' && Object.keys(metadata.dependencies || {}).length === 0) {
      const result: PackageClassification = {
        tier: 1,
        reason: 'Pure ESM module with no dependencies',
        canRunInIsolate: true,
        requiredBuiltins: [],
        requiresNative: false,
        confidence: 0.85,
      }
      classificationCache.set(cacheKey, result)
      return result
    }

    // Empty package with no dependencies is Tier 1
    if (Object.keys(metadata.dependencies || {}).length === 0 && builtins.length === 0) {
      const result: PackageClassification = {
        tier: 1,
        reason: 'Package with no dependencies',
        canRunInIsolate: true,
        requiredBuiltins: [],
        requiresNative: false,
        confidence: 0.7,
      }
      classificationCache.set(cacheKey, result)
      return result
    }

    // Default to Tier 2 for packages with metadata but unknown classification
    const result: PackageClassification = {
      tier: 2,
      reason: 'Unknown package, defaulting to Tier 2',
      canRunInIsolate: true,
      requiredBuiltins: builtins,
      requiresNative: false,
      confidence: 0.6,
    }
    classificationCache.set(cacheKey, result)
    return result
  }

  // No metadata - default to Tier 3 for safety
  const result: PackageClassification = {
    tier: 3,
    reason: 'Unknown package without metadata, defaulting to safe Tier 3',
    canRunInIsolate: false,
    requiredBuiltins: [],
    requiresNative: false,
    confidence: 0.4,
  }
  classificationCache.set(cacheKey, result)
  return result
}

/**
 * Clear the classification cache
 */
export function clearClassificationCache(): void {
  classificationCache.clear()
}

/**
 * Get classification cache size
 */
export function getClassificationCacheSize(): number {
  return classificationCache.size
}
