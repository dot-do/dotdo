/**
 * npm Registry Client
 *
 * Fetch-based HTTP client for npm registries.
 * Implements the RegistryBackend interface with:
 * - Timeout/retry support
 * - LRU caching for metadata
 * - Scoped package handling
 * - Custom registry support
 *
 * @module core/registry/client
 */

import type {
  RegistryBackend,
  PackageMetadata,
  PackageVersion,
  SearchOptions,
  SearchResult,
  CacheConfig,
} from '../backend.js'
import { LRUCache } from '../cache/lru.js'
import { FetchError, PackageNotFoundError, TimeoutError } from '../errors/index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration options for RegistryClient.
 */
export interface RegistryClientOptions {
  /**
   * Base URL of the npm registry.
   * @default 'https://registry.npmjs.org'
   */
  registry?: string

  /**
   * Request timeout in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeout?: number

  /**
   * Number of retry attempts for failed requests.
   * @default 3
   */
  retries?: number

  /**
   * Base delay between retries in milliseconds.
   * Actual delay is baseDelay * attemptNumber for exponential backoff.
   * @default 1000
   */
  retryDelay?: number

  /**
   * Cache configuration for metadata caching.
   */
  cache?: Partial<CacheConfig>

  /**
   * User agent string for HTTP requests.
   * @default 'npmx/1.0.0'
   */
  userAgent?: string

  /**
   * Custom fetch function (useful for testing or custom implementations).
   * @default globalThis.fetch
   */
  fetch?: typeof fetch
}

/**
 * npm search API response format.
 */
interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string
      version: string
      description?: string
      keywords?: string[]
      date: string
      publisher?: {
        username: string
        email?: string
      }
    }
    score: {
      final: number
      detail: {
        quality: number
        popularity: number
        maintenance: number
      }
    }
  }>
  total: number
  time: string
}

// =============================================================================
// RegistryClient Implementation
// =============================================================================

/**
 * HTTP client for npm registries.
 *
 * Features:
 * - Fetch package metadata from registry.npmjs.org or custom registries
 * - Download tarballs with integrity verification
 * - Search packages
 * - Handle scoped packages (@org/name)
 * - LRU caching for metadata (configurable TTL)
 * - Timeout and retry with exponential backoff
 *
 * @example
 * ```typescript
 * const client = new RegistryClient()
 *
 * // Fetch package metadata
 * const metadata = await client.getPackageMetadata('lodash')
 *
 * // Get specific version
 * const version = await client.getPackageVersion('lodash', '4.17.21')
 *
 * // Download tarball
 * const tarball = await client.getTarball('lodash', '4.17.21')
 *
 * // Search packages
 * const results = await client.searchPackages('utility library')
 * ```
 */
export class RegistryClient implements RegistryBackend {
  private readonly registry: string
  private readonly timeout: number
  private readonly retries: number
  private readonly retryDelay: number
  private readonly userAgent: string
  private readonly _fetch: typeof fetch
  private readonly metadataCache: LRUCache<string, PackageMetadata>
  private readonly cacheConfig: CacheConfig

  constructor(options?: RegistryClientOptions) {
    this.registry = (options?.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '')
    this.timeout = options?.timeout ?? 30000
    this.retries = options?.retries ?? 3
    this.retryDelay = options?.retryDelay ?? 1000
    this.userAgent = options?.userAgent ?? 'npmx/1.0.0'
    this._fetch = options?.fetch ?? globalThis.fetch.bind(globalThis)

    this.cacheConfig = {
      enabled: options?.cache?.enabled ?? true,
      ttl: options?.cache?.ttl ?? 300, // 5 minutes default
      maxSize: options?.cache?.maxSize ?? 100,
      strategy: options?.cache?.strategy ?? 'lru',
    }

    this.metadataCache = new LRUCache<string, PackageMetadata>({
      maxSize: this.cacheConfig.maxSize,
    })
  }

  // =========================================================================
  // RegistryBackend Implementation
  // =========================================================================

  /**
   * Fetch complete metadata for a package, including all versions.
   * Results are cached according to cache configuration.
   *
   * @param name - Package name (can be scoped like @scope/name)
   * @returns Package metadata or null if not found
   */
  async getPackageMetadata(name: string): Promise<PackageMetadata | null> {
    if (!this.isValidPackageName(name)) {
      return null
    }

    // Check cache first
    if (this.cacheConfig.enabled) {
      const cached = this.metadataCache.get(name)
      if (cached) {
        return cached
      }
    }

    try {
      const url = this.buildPackageUrl(name)
      const response = await this.fetchWithRetry(url)

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new FetchError(
          `Registry returned ${response.status}: ${response.statusText}`,
          { status: response.status, registry: this.registry }
        )
      }

      const data = await response.json() as PackageMetadata

      // Normalize the metadata
      const metadata = this.normalizeMetadata(data)

      // Cache the result
      if (this.cacheConfig.enabled) {
        this.metadataCache.set(name, metadata)
      }

      return metadata
    } catch (error) {
      if (error instanceof FetchError || error instanceof TimeoutError) {
        throw error
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(`Request timed out after ${this.timeout}ms`, this.timeout)
      }
      throw new FetchError(
        `Failed to fetch package metadata: ${error instanceof Error ? error.message : String(error)}`,
        { registry: this.registry }
      )
    }
  }

  /**
   * Fetch metadata for a specific version of a package.
   *
   * @param name - Package name
   * @param version - Exact version string (e.g., "1.0.0")
   * @returns Version metadata or null if not found
   */
  async getPackageVersion(name: string, version: string): Promise<PackageVersion | null> {
    if (!this.isValidPackageName(name) || !version) {
      return null
    }

    const metadata = await this.getPackageMetadata(name)
    if (!metadata) {
      return null
    }

    return metadata.versions[version] ?? null
  }

  /**
   * Download the tarball for a specific package version.
   *
   * @param name - Package name
   * @param version - Exact version string
   * @returns Tarball bytes or null if not found
   */
  async getTarball(name: string, version: string): Promise<Uint8Array | null> {
    if (!this.isValidPackageName(name) || !version) {
      return null
    }

    const versionMeta = await this.getPackageVersion(name, version)
    if (!versionMeta) {
      return null
    }

    const tarballUrl = versionMeta.dist.tarball
    if (!tarballUrl) {
      throw new FetchError(
        `No tarball URL for ${name}@${version}`,
        { registry: this.registry }
      )
    }

    try {
      const response = await this.fetchWithRetry(tarballUrl)

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new FetchError(
          `Failed to download tarball: ${response.status} ${response.statusText}`,
          { status: response.status, registry: this.registry }
        )
      }

      const arrayBuffer = await response.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } catch (error) {
      if (error instanceof FetchError || error instanceof TimeoutError) {
        throw error
      }
      throw new FetchError(
        `Failed to download tarball: ${error instanceof Error ? error.message : String(error)}`,
        { registry: this.registry }
      )
    }
  }

  /**
   * Search for packages matching a query.
   *
   * @param query - Search text
   * @param options - Search options (limit, offset, scoring weights)
   * @returns Array of matching packages
   */
  async searchPackages(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!query) {
      return []
    }

    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0

    // Build search URL
    const searchUrl = new URL('/-/v1/search', this.registry)
    searchUrl.searchParams.set('text', query)
    searchUrl.searchParams.set('size', String(limit))
    searchUrl.searchParams.set('from', String(offset))

    if (options?.quality !== undefined) {
      searchUrl.searchParams.set('quality', String(options.quality))
    }
    if (options?.popularity !== undefined) {
      searchUrl.searchParams.set('popularity', String(options.popularity))
    }
    if (options?.maintenance !== undefined) {
      searchUrl.searchParams.set('maintenance', String(options.maintenance))
    }

    try {
      const response = await this.fetchWithRetry(searchUrl.toString())

      if (!response.ok) {
        throw new FetchError(
          `Search failed: ${response.status} ${response.statusText}`,
          { status: response.status, registry: this.registry }
        )
      }

      const data = await response.json() as NpmSearchResponse

      return data.objects.map((obj) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        keywords: obj.package.keywords,
        date: obj.package.date,
        publisher: obj.package.publisher
          ? { name: obj.package.publisher.username, email: obj.package.publisher.email }
          : undefined,
        score: {
          final: obj.score.final,
          detail: obj.score.detail,
        },
      }))
    } catch (error) {
      if (error instanceof FetchError || error instanceof TimeoutError) {
        throw error
      }
      throw new FetchError(
        `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        { registry: this.registry }
      )
    }
  }

  /**
   * Resolve a dist-tag to a specific version.
   *
   * @param name - Package name
   * @param tag - Dist-tag name (defaults to "latest")
   * @returns Version string or null if package/tag not found
   */
  async resolveLatest(name: string, tag: string = 'latest'): Promise<string | null> {
    if (!this.isValidPackageName(name)) {
      return null
    }

    const metadata = await this.getPackageMetadata(name)
    if (!metadata) {
      return null
    }

    return metadata['dist-tags'][tag] ?? null
  }

  // =========================================================================
  // Cache Management
  // =========================================================================

  /**
   * Get the current cache configuration.
   */
  getCacheConfig(): CacheConfig {
    return { ...this.cacheConfig }
  }

  /**
   * Invalidate cache for a specific package.
   */
  invalidateCache(name: string): void {
    this.metadataCache.delete(name)
  }

  /**
   * Clear the entire cache.
   */
  clearCache(): void {
    this.metadataCache.clear()
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.metadataCache.getStats()
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Validate a package name.
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
   * Build the URL for a package.
   * Handles scoped packages by URL-encoding the package name.
   */
  private buildPackageUrl(name: string): string {
    // For scoped packages, we need to encode the @ and /
    const encodedName = name.startsWith('@')
      ? `@${encodeURIComponent(name.slice(1))}`
      : encodeURIComponent(name)

    return `${this.registry}/${encodedName}`
  }

  /**
   * Fetch with timeout and retry support.
   */
  private async fetchWithRetry(url: string, attempt: number = 1): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': this.userAgent,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Retry on 5xx errors if we have retries left
      if (response.status >= 500 && attempt < this.retries) {
        await this.delay(this.retryDelay * attempt)
        return this.fetchWithRetry(url, attempt + 1)
      }

      return response
    } catch (error) {
      clearTimeout(timeoutId)

      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        if (attempt < this.retries) {
          await this.delay(this.retryDelay * attempt)
          return this.fetchWithRetry(url, attempt + 1)
        }
        throw new TimeoutError(`Request timed out after ${this.timeout}ms`, this.timeout)
      }

      // Retry on network errors if we have retries left
      if (attempt < this.retries) {
        await this.delay(this.retryDelay * attempt)
        return this.fetchWithRetry(url, attempt + 1)
      }

      throw error
    }
  }

  /**
   * Delay for a given number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Normalize package metadata from the registry response.
   * Ensures all required fields are present and properly typed.
   */
  private normalizeMetadata(data: unknown): PackageMetadata {
    const raw = data as Record<string, unknown>

    const name = raw.name as string
    const versions = raw.versions as Record<string, unknown> ?? {}
    const distTags = raw['dist-tags'] as Record<string, string> ?? { latest: '0.0.0' }

    // Normalize each version
    const normalizedVersions: Record<string, PackageVersion> = {}
    for (const [ver, versionData] of Object.entries(versions)) {
      const v = versionData as Record<string, unknown>
      normalizedVersions[ver] = {
        name: v.name as string | undefined,
        version: v.version as string ?? ver,
        description: v.description as string | undefined,
        main: v.main as string | undefined,
        module: v.module as string | undefined,
        types: v.types as string | undefined,
        dependencies: (v.dependencies as Record<string, string>) ?? {},
        devDependencies: (v.devDependencies as Record<string, string>) ?? {},
        peerDependencies: v.peerDependencies as Record<string, string> | undefined,
        optionalDependencies: v.optionalDependencies as Record<string, string> | undefined,
        bin: v.bin as Record<string, string> | undefined,
        scripts: v.scripts as Record<string, string> | undefined,
        dist: v.dist as PackageVersion['dist'] ?? {
          tarball: '',
          shasum: '',
          integrity: '',
        },
        engines: v.engines as Record<string, string> | undefined,
        repository: v.repository as PackageVersion['repository'] | undefined,
      }
    }

    return {
      name,
      description: raw.description as string | undefined,
      versions: normalizedVersions,
      'dist-tags': distTags,
      time: raw.time as PackageMetadata['time'] | undefined,
      maintainers: raw.maintainers as PackageMetadata['maintainers'] | undefined,
      license: raw.license as string | undefined,
      readme: raw.readme as string | undefined,
    }
  }
}
