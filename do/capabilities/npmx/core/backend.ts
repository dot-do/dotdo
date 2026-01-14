/**
 * RegistryBackend interface and types for npm registry operations.
 *
 * This module defines the core interface for interacting with npm registries,
 * along with all necessary types for package metadata, versions, and search.
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Distribution information for a package version's tarball.
 */
export interface PackageDist {
  tarball: string
  shasum: string
  integrity: string
  fileCount?: number
  unpackedSize?: number
}

/**
 * Repository information for a package.
 */
export interface Repository {
  type: string
  url: string
}

/**
 * Package maintainer information.
 */
export interface Maintainer {
  name: string
  email?: string
}

/**
 * Complete version metadata for a specific package version.
 * Contains all fields needed to install and use the package.
 */
export interface PackageVersion {
  name?: string
  version: string
  description?: string
  main?: string
  module?: string
  types?: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bin?: Record<string, string>
  scripts?: Record<string, string>
  dist: PackageDist
  engines?: Record<string, string>
  repository?: Repository
}

/**
 * Package metadata as returned by the registry.
 * Contains all versions, dist-tags, and metadata about the package.
 */
export interface PackageMetadata {
  name: string
  description?: string
  versions: Record<string, PackageVersion>
  'dist-tags': Record<string, string>
  time?: {
    created: string
    modified: string
    [version: string]: string
  }
  maintainers?: Maintainer[]
  license?: string
  readme?: string
}

/**
 * Options for package search queries.
 */
export interface SearchOptions {
  limit?: number
  offset?: number
  quality?: number
  popularity?: number
  maintenance?: number
}

/**
 * Score details for a search result.
 */
export interface SearchScore {
  final: number
  detail: {
    quality: number
    popularity: number
    maintenance: number
  }
}

/**
 * A single search result from the registry.
 */
export interface SearchResult {
  name: string
  version: string
  description?: string
  keywords?: string[]
  date?: string
  publisher?: Maintainer
  score?: SearchScore
}

/**
 * Cache configuration for registry backends.
 */
export interface CacheConfig {
  enabled: boolean
  ttl: number
  maxSize: number
  strategy: 'lru' | 'ttl' | 'none'
}

/**
 * Configuration options for MemoryRegistry.
 */
export interface MemoryRegistryOptions {
  cache?: CacheConfig
}

// =============================================================================
// RegistryBackend Interface
// =============================================================================

/**
 * Interface for npm registry backends.
 *
 * Implementations can connect to remote registries (npm, yarn, etc.)
 * or provide local/mock registries for testing.
 */
export interface RegistryBackend {
  /**
   * Fetch complete metadata for a package, including all versions.
   * @param name - Package name (can be scoped like @scope/name)
   * @returns Package metadata or null if not found
   */
  getPackageMetadata(name: string): Promise<PackageMetadata | null>

  /**
   * Fetch metadata for a specific version of a package.
   * @param name - Package name
   * @param version - Exact version string (e.g., "1.0.0")
   * @returns Version metadata or null if not found
   */
  getPackageVersion(name: string, version: string): Promise<PackageVersion | null>

  /**
   * Download the tarball for a specific package version.
   * @param name - Package name
   * @param version - Exact version string
   * @returns Tarball bytes or null if not found
   */
  getTarball(name: string, version: string): Promise<Uint8Array | null>

  /**
   * Search for packages matching a query.
   * @param query - Search text
   * @param options - Search options (limit, offset, scoring weights)
   * @returns Array of matching packages
   */
  searchPackages(query: string, options?: SearchOptions): Promise<SearchResult[]>

  /**
   * Resolve a dist-tag to a specific version.
   * @param name - Package name
   * @param tag - Dist-tag name (defaults to "latest")
   * @returns Version string or null if package/tag not found
   */
  resolveLatest(name: string, tag?: string): Promise<string | null>
}

// =============================================================================
// MemoryRegistry Implementation
// =============================================================================

/**
 * In-memory registry backend for testing.
 *
 * Stores packages in memory with full support for:
 * - Scoped packages (@scope/name)
 * - Multiple versions per package
 * - Dist-tags (latest, next, beta, etc.)
 * - Tarball storage
 * - Configurable caching behavior
 */
export class MemoryRegistry implements RegistryBackend {
  private packages: Map<string, PackageMetadata> = new Map()
  private tarballs: Map<string, Uint8Array> = new Map()
  private cacheConfig: CacheConfig

  constructor(options?: MemoryRegistryOptions) {
    this.cacheConfig = options?.cache ?? {
      enabled: true,
      ttl: 300,
      maxSize: 1000,
      strategy: 'lru',
    }
  }

  /**
   * Validate a package name.
   * Returns false for invalid names (empty, malformed scoped names, special chars).
   */
  private isValidPackageName(name: string): boolean {
    if (!name || name.length === 0) {
      return false
    }

    // Check for path traversal or encoding
    if (name.includes('..') || name.includes('%')) {
      return false
    }

    // Check for invalid scoped package formats
    if (name.startsWith('@')) {
      // Must have exactly one slash after @
      const slashIndex = name.indexOf('/')
      if (slashIndex === -1 || slashIndex === 1 || slashIndex === name.length - 1) {
        return false
      }
      // Check for multiple slashes
      if (name.indexOf('/', slashIndex + 1) !== -1) {
        return false
      }
    }

    return true
  }

  /**
   * Generate a key for tarball storage.
   */
  private tarballKey(name: string, version: string): string {
    return `${name}@${version}`
  }

  // =========================================================================
  // RegistryBackend Implementation
  // =========================================================================

  async getPackageMetadata(name: string): Promise<PackageMetadata | null> {
    if (!this.isValidPackageName(name)) {
      return null
    }
    return this.packages.get(name) ?? null
  }

  async getPackageVersion(name: string, version: string): Promise<PackageVersion | null> {
    if (!this.isValidPackageName(name) || !version) {
      return null
    }

    const pkg = this.packages.get(name)
    if (!pkg) {
      return null
    }

    return pkg.versions[version] ?? null
  }

  async getTarball(name: string, version: string): Promise<Uint8Array | null> {
    if (!this.isValidPackageName(name) || !version) {
      return null
    }

    const key = this.tarballKey(name, version)
    return this.tarballs.get(key) ?? null
  }

  async searchPackages(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const queryLower = query.toLowerCase()

    const results: SearchResult[] = []

    for (const [name, metadata] of this.packages) {
      // Search in name
      const nameMatches = name.toLowerCase().includes(queryLower)

      // Search in description
      const descMatches = metadata.description?.toLowerCase().includes(queryLower) ?? false

      if (nameMatches || descMatches) {
        const latestVersion = metadata['dist-tags'].latest
        results.push({
          name,
          version: latestVersion,
          description: metadata.description,
          keywords: [],
          date: metadata.time?.modified ?? metadata.time?.[latestVersion],
          publisher: metadata.maintainers?.[0],
        })
      }
    }

    // Apply offset and limit
    return results.slice(offset, offset + limit)
  }

  async resolveLatest(name: string, tag: string = 'latest'): Promise<string | null> {
    if (!this.isValidPackageName(name)) {
      return null
    }

    const pkg = this.packages.get(name)
    if (!pkg) {
      return null
    }

    return pkg['dist-tags'][tag] ?? null
  }

  // =========================================================================
  // Test Helper Methods
  // =========================================================================

  /**
   * Add a package to the registry.
   * @param metadata - Package metadata to add
   */
  addPackage(metadata: PackageMetadata): void {
    this.packages.set(metadata.name, metadata)
  }

  /**
   * Set the tarball data for a specific package version.
   * @param name - Package name
   * @param version - Version string
   * @param data - Tarball bytes
   */
  setTarball(name: string, version: string, data: Uint8Array): void {
    const key = this.tarballKey(name, version)
    this.tarballs.set(key, data)
  }

  /**
   * Set or update a dist-tag for a package.
   * @param name - Package name
   * @param tag - Tag name (e.g., "latest", "next")
   * @param version - Version the tag should point to
   */
  setDistTag(name: string, tag: string, version: string): void {
    const pkg = this.packages.get(name)
    if (pkg) {
      pkg['dist-tags'][tag] = version
    }
  }

  // =========================================================================
  // Cache Management
  // =========================================================================

  /**
   * Get the current cache configuration.
   */
  getCacheConfig(): CacheConfig {
    return this.cacheConfig
  }

  /**
   * Invalidate cache for a specific package.
   * For MemoryRegistry this is a no-op since data is always fresh.
   * @param _name - Package name to invalidate
   */
  invalidateCache(_name: string): void {
    // No-op for MemoryRegistry - data is always authoritative
  }

  /**
   * Clear the entire cache.
   * For MemoryRegistry this is a no-op since data is always fresh.
   */
  clearCache(): void {
    // No-op for MemoryRegistry - data is always authoritative
  }
}
