/**
 * Dependency Tree Resolution Types
 *
 * Type definitions for npm-compatible dependency tree resolution.
 */

/**
 * Represents a resolved package in the dependency tree
 */
export interface DependencyNode {
  /** Package name */
  name: string
  /** Resolved version */
  version: string
  /** Dependencies of this package (name -> version range as specified) */
  dependencies: Record<string, string>
  /** Nested dependencies that couldn't be hoisted due to conflicts */
  nestedDependencies?: Record<string, DependencyNode>
  /** Whether this is a dev dependency */
  dev: boolean
  /** Whether this is an optional dependency */
  optional?: boolean
  /** Peer dependencies that were found in the tree */
  peerDependencies?: Record<string, string>
  /** Bundled dependency names */
  bundledDependencies?: string[]
  /** Whether this package has bundled dependencies */
  hasBundled?: boolean
  /** Packages this node has circular references to */
  circularTo?: string[]
  /** Integrity hash (e.g., sha512-xxx) */
  integrity?: string
  /** Resolved URL for this package */
  resolved?: string
}

/**
 * Full dependency tree with resolved packages
 */
export interface DependencyTree {
  /** Name of the root package */
  name?: string
  /** Version of the root package */
  version?: string
  /** All resolved packages (flat, hoisted where possible) */
  resolved: Record<string, DependencyNode>
  /** Warnings generated during resolution */
  warnings: ResolutionWarning[]
  /** Statistics about the resolution */
  stats: ResolutionStats
}

/**
 * Warning generated during dependency resolution
 */
export interface ResolutionWarning {
  /** Type of warning */
  type:
    | 'peer-missing'
    | 'peer-incompatible'
    | 'optional-skipped'
    | 'circular-dependency'
    | 'deprecated'
    | 'unsupported-engine'
  /** Package that triggered the warning */
  package: string
  /** Additional context */
  message?: string
  /** For peer warnings: the peer package name */
  peer?: string
  /** For peer-incompatible: required version range */
  required?: string
  /** For peer-incompatible: actually installed version */
  installed?: string
  /** For circular: the cycle path */
  cycle?: string[]
}

/**
 * Statistics about the resolution process
 */
export interface ResolutionStats {
  /** Total number of unique packages */
  totalPackages: number
  /** Number of packages that were deduplicated */
  deduplicatedPackages: number
  /** Number of registry fetches made */
  registryFetches: number
  /** Time taken for resolution (ms) */
  resolutionTime?: number
}

/**
 * Package information from the registry
 */
export interface ResolvedPackage {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: string[]
  bundleDependencies?: string[] // Alternative spelling
  os?: string[]
  cpu?: string[]
  engines?: Record<string, string>
  deprecated?: string
  integrity?: string
  dist?: {
    tarball?: string
    shasum?: string
    integrity?: string
  }
}

/**
 * Registry fetcher interface for abstracting registry access
 */
export interface RegistryFetcher {
  /** Get all available versions for a package */
  getPackageVersions(name: string): Promise<string[]>
  /** Get package info for a specific version */
  getPackageInfo(name: string, version: string): Promise<ResolvedPackage>
}

/**
 * Options for dependency resolution
 */
export interface ResolutionOptions {
  /** Whether to exclude devDependencies */
  production?: boolean
  /** Whether to auto-install peer dependencies */
  autoInstallPeers?: boolean
  /** Target platform (darwin, linux, win32) */
  platform?: string
  /** Target CPU architecture */
  arch?: string
  /** Registry to use */
  registry?: RegistryFetcher
}

/**
 * Input for resolve() - represents package.json structure
 */
export interface PackageManifest {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: string[]
}

/**
 * Lock file format (npm v3 package-lock.json)
 */
export interface LockFile {
  name?: string
  version?: string
  lockfileVersion: number
  requires?: boolean
  packages: Record<string, LockFileEntry>
}

/**
 * Entry in the lock file packages section
 */
export interface LockFileEntry {
  version: string
  resolved?: string
  integrity?: string
  dev?: boolean
  optional?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  engines?: Record<string, string>
  os?: string[]
  cpu?: string[]
  bundleDependencies?: string[]
}

/**
 * Diff between two dependency trees
 */
export interface TreeDiff {
  /** Packages that were added */
  added: Array<{ name: string; version: string }>
  /** Packages that were removed */
  removed: Array<{ name: string; version: string }>
  /** Packages that changed version */
  updated: Array<{ name: string; from: string; to: string }>
  /** Packages that stayed the same */
  unchanged: Array<{ name: string; version: string }>
  /** Summary counts */
  summary: {
    added: number
    removed: number
    updated: number
    unchanged: number
  }
}
