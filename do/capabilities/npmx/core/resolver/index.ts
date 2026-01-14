/**
 * Dependency Tree Resolver
 *
 * npm-compatible dependency resolution with:
 * - Flat dependency resolution
 * - Version conflict resolution
 * - Peer dependency handling
 * - Optional dependency handling
 * - Circular dependency detection
 * - Hoisting and deduplication
 * - Lock file generation
 * - Tree diffing
 *
 * This module has ZERO Cloudflare dependencies.
 */

import type { ResolvedPackage } from './types'

// Type exports
export type {
  DependencyTree,
  DependencyNode,
  ResolutionOptions,
  ResolutionWarning,
  ResolutionStats,
  PackageManifest,
  RegistryFetcher,
  LockFile,
  LockFileEntry,
  TreeDiff,
  ResolvedPackage,
} from './types'

// Tree builder
export { DependencyTreeBuilder, detectCircularDependencies } from './tree'

// Hoisting
export {
  analyzeHoisting,
  applyHoisting,
  calculateDeduplicationSavings,
  type HoistingAnalysis,
  type HoistingConflict,
  type DeduplicationStats,
} from './hoisting'

// Lockfile
export {
  generateLockFile,
  parseLockFile,
  diffTrees,
  validateLockFile,
  type LockFileValidation,
} from './lockfile'

// Legacy exports for backwards compatibility
export interface PackageMetadata {
  name: string
  versions: Record<string, VersionMetadata>
  'dist-tags': Record<string, string>
  time?: Record<string, string>
}

export interface VersionMetadata {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dist: {
    tarball: string
    shasum: string
    integrity?: string
  }
}

export interface ResolveOptions {
  registry?: string
  includePrerelease?: boolean
}

/**
 * Resolve a package name and version range to a specific version.
 * @deprecated Use DependencyTreeBuilder.resolve() instead
 */
export function resolve(
  _name: string,
  _range: string,
  _options?: ResolveOptions
): Promise<ResolvedPackage> {
  throw new Error('Deprecated: Use DependencyTreeBuilder.resolve() instead')
}

/**
 * Fetch package metadata from the registry.
 * @deprecated Use RegistryFetcher interface instead
 */
export function fetchPackageMetadata(
  _name: string,
  _options?: ResolveOptions
): Promise<PackageMetadata> {
  throw new Error('Deprecated: Use RegistryFetcher interface instead')
}

/**
 * Resolve all dependencies for a package recursively.
 * @deprecated Use DependencyTreeBuilder.resolve() instead
 */
export function resolveDependencyTree(
  _name: string,
  _range: string,
  _options?: ResolveOptions
): Promise<Map<string, ResolvedPackage>> {
  throw new Error('Deprecated: Use DependencyTreeBuilder.resolve() instead')
}
