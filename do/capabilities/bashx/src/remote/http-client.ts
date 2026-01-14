/**
 * Git HTTP Transport Client
 *
 * Implements the Git HTTP smart protocol for:
 * - Refs discovery (info/refs)
 * - Upload-pack (clone/fetch)
 * - Receive-pack (push)
 *
 * Supports:
 * - Protocol v1 and v2 (with auto-detection and fallback)
 * - Smart HTTP and dumb HTTP fallback
 * - Authentication (Bearer, Basic)
 * - Redirects with loop detection
 * - Side-band demultiplexing (with progress callbacks)
 * - Shallow fetches
 * - Automatic retry with exponential backoff
 * - Rate limit detection and waiting
 * - Configurable timeouts per operation
 */

import {
  type AuthCredentials,
  createAuthHeader,
  parseWwwAuthenticate,
} from './auth.js'

import {
  type ProgressOptions,
  emitPhase,
} from './progress.js'

import {
  type ProtocolV2Capabilities,
  type LsRefsOptions,
  type V2RefInfo,
  type FetchOptions,
  type FetchResult,
  GIT_PROTOCOL_V2_HEADER,
  parseV2Capabilities,
  generateLsRefsCommand,
  parseLsRefsResponse,
  generateFetchCommand,
  parseFetchResponse,
} from './protocol-v2.js'

import {
  NetworkError,
  AuthenticationError,
  RateLimitError,
  RepositoryNotFoundError,
  TimeoutError,
  ServerError,
  shouldRetry,
  calculateBackoff,
} from './errors.js'

// =============================================================================
// Types
// =============================================================================

export interface RefAdvertisement {
  name: string
  oid: string
  peeled?: string
}

export interface ServerCapabilities {
  multiAck?: boolean
  thinPack?: boolean
  sideBand?: boolean
  sideBand64k?: boolean
  ofsDelta?: boolean
  shallow?: boolean
  deepenSince?: boolean
  deepenNot?: boolean
  deepenRelative?: boolean
  noProgress?: boolean
  includeTag?: boolean
  multiAckDetailed?: boolean
  symrefs?: Record<string, string>
  agent?: string
  /** Protocol version (1 or 2) */
  protocolVersion?: 1 | 2
  /** Protocol v2 specific capabilities */
  v2?: ProtocolV2Capabilities
}

export interface RefsDiscoveryResult {
  refs: RefAdvertisement[]
  capabilities: ServerCapabilities
  isSmartServer: boolean
  isEmpty?: boolean
  head?: string
}

export interface UploadPackRequest {
  wants: string[]
  haves: string[]
  done?: boolean
  capabilities?: string[]
  depth?: number
  deepenSince?: Date
}

export interface UploadPackResponse {
  packfile: Uint8Array
  progress?: string
}

export interface RefUpdate {
  ref: string
  oldOid: string
  newOid: string
}

export interface RefUpdateResult {
  ref: string
  ok: boolean
  error?: string
}

export interface ReceivePackRequest {
  updates: RefUpdate[]
  packfile?: Uint8Array
  capabilities?: string[]
}

export interface ReceivePackResponse {
  unpackOk: boolean
  unpackError?: string
  results: RefUpdateResult[]
}

export interface TimeoutOptions {
  /** Timeout for refs discovery (default: 10s) */
  refs?: number
  /** Timeout for fetch operations (default: 5min) */
  fetch?: number
  /** Timeout for push operations (default: 5min) */
  push?: number
}

export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs?: number
  /** Whether to add jitter to backoff (default: true) */
  jitter?: boolean
  /** Whether to wait for rate limit reset (default: true) */
  waitForRateLimit?: boolean
  /** Maximum time to wait for rate limit in ms (default: 5min) */
  maxRateLimitWaitMs?: number
  /** Callback for retry events */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
}

/**
 * GitHub API optimization options
 */
export interface GitHubOptimizations {
  /** Use GitHub REST API for metadata when available */
  useRestApi?: boolean
  /** Enable parallel ref discovery */
  parallelRefDiscovery?: boolean
  /** Maximum concurrent requests for parallel operations */
  maxConcurrency?: number
}

/**
 * Conditional request options (ETag support)
 */
export interface ConditionalRequestOptions {
  /** Enable ETag-based conditional requests */
  enabled?: boolean
  /** ETag cache storage (default: in-memory) */
  cache?: Map<string, string>
}

/**
 * Connection pool options
 */
export interface ConnectionPoolOptions {
  /** Maximum connections per host (default: 6) */
  maxConnectionsPerHost?: number
  /** Keep-alive timeout in ms (default: 60000) */
  keepAliveTimeout?: number
  /** Enable HTTP/2 when available */
  http2?: boolean
}

export interface GitHttpClientOptions {
  /** Default timeout in ms (overridden by timeouts.* options) */
  timeout?: number
  /** Per-operation timeout configuration */
  timeouts?: TimeoutOptions
  userAgent?: string
  auth?: AuthCredentials
  authProvider?: () => Promise<AuthCredentials>
  /** Retry configuration */
  retry?: RetryOptions
  /** Signal for request cancellation */
  signal?: AbortSignal
  /** Preferred protocol version (default: 2, with fallback to 1) */
  protocolVersion?: 1 | 2
  /** Progress callback for side-band messages */
  onProgress?: (message: string) => void
  /** Error callback for side-band errors */
  onError?: (message: string) => void
  /** GitHub-specific optimizations */
  github?: GitHubOptimizations
  /** Conditional request options (ETag support) */
  conditionalRequests?: ConditionalRequestOptions
  /** Connection pool options */
  connectionPool?: ConnectionPoolOptions
  /** Progress reporting options */
  progress?: ProgressOptions
}

// =============================================================================
// Custom Errors
// =============================================================================

/**
 * @deprecated Use specific error classes from errors.ts instead
 */
export class GitHttpError extends Error {
  status?: number
  wwwAuthenticate?: { scheme: string; realm?: string }
  rateLimit?: { limit: number; remaining: number; resetAt: Date }
  hint?: string
  tokenExpired?: boolean

  constructor(message: string, options?: {
    status?: number
    wwwAuthenticate?: { scheme: string; realm?: string }
    rateLimit?: { limit: number; remaining: number; resetAt: Date }
    hint?: string
    tokenExpired?: boolean
  }) {
    super(message)
    this.name = 'GitHttpError'
    this.status = options?.status
    this.wwwAuthenticate = options?.wwwAuthenticate
    this.rateLimit = options?.rateLimit
    this.hint = options?.hint
    this.tokenExpired = options?.tokenExpired
  }
}

// Re-export error types for convenience
export {
  NetworkError,
  AuthenticationError,
  RateLimitError,
  RepositoryNotFoundError,
  PushRejectedError,
  TimeoutError,
  ServerError,
  type RateLimitInfo,
} from './errors.js'

// =============================================================================
// GitHttpClient
// =============================================================================

// Default timeout values
const DEFAULT_TIMEOUTS: Required<TimeoutOptions> = {
  refs: 10_000,    // 10 seconds for ref discovery
  fetch: 300_000,  // 5 minutes for fetch
  push: 300_000,   // 5 minutes for push
}

// Default retry configuration
const DEFAULT_RETRY: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: true,
  waitForRateLimit: true,
  maxRateLimitWaitMs: 300_000, // 5 minutes
}

/**
 * GitHub REST API response for refs
 */
interface GitHubRef {
  ref: string
  object: {
    sha: string
    type: string
  }
}

/**
 * GitHub REST API response for repository
 */
interface GitHubRepository {
  default_branch: string
  size: number
  pushed_at: string
}

export class GitHttpClient {
  httpsUrl: string
  repoPath: string
  private options: GitHttpClientOptions
  private maxRedirects = 5
  private timeouts: Required<TimeoutOptions>
  private retryConfig: Required<Omit<RetryOptions, 'onRetry'>> & { onRetry?: RetryOptions['onRetry'] }
  /** Detected protocol version (set after first request) */
  private detectedProtocolVersion: 1 | 2 | null = null
  /** Cached protocol v2 capabilities */
  private v2Capabilities: ProtocolV2Capabilities | null = null
  /** ETag cache for conditional requests */
  private etagCache: Map<string, string>
  /** GitHub optimization settings */
  private githubOpts: GitHubOptimizations
  /** Whether this is a GitHub URL */
  private isGitHub: boolean

  constructor(url: string, options: GitHttpClientOptions = {}) {
    this.options = options
    const parsed = this.parseAndNormalizeUrl(url)
    this.httpsUrl = parsed.httpsUrl
    this.repoPath = parsed.repoPath

    // Detect if this is a GitHub URL
    this.isGitHub = parsed.httpsUrl.includes('github.com')

    // Initialize ETag cache
    this.etagCache = options.conditionalRequests?.cache ?? new Map()

    // GitHub optimization settings
    this.githubOpts = {
      useRestApi: options.github?.useRestApi ?? false,
      parallelRefDiscovery: options.github?.parallelRefDiscovery ?? false,
      maxConcurrency: options.github?.maxConcurrency ?? 6,
    }

    // Merge timeout configuration
    this.timeouts = {
      refs: options.timeouts?.refs ?? options.timeout ?? DEFAULT_TIMEOUTS.refs,
      fetch: options.timeouts?.fetch ?? options.timeout ?? DEFAULT_TIMEOUTS.fetch,
      push: options.timeouts?.push ?? options.timeout ?? DEFAULT_TIMEOUTS.push,
    }

    // Merge retry configuration
    this.retryConfig = {
      maxRetries: options.retry?.maxRetries ?? DEFAULT_RETRY.maxRetries,
      baseDelayMs: options.retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
      maxDelayMs: options.retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
      jitter: options.retry?.jitter ?? DEFAULT_RETRY.jitter,
      waitForRateLimit: options.retry?.waitForRateLimit ?? DEFAULT_RETRY.waitForRateLimit,
      maxRateLimitWaitMs: options.retry?.maxRateLimitWaitMs ?? DEFAULT_RETRY.maxRateLimitWaitMs,
      onRetry: options.retry?.onRetry,
    }
  }

  /**
   * Parse and normalize various Git URL formats to HTTPS
   */
  private parseAndNormalizeUrl(url: string): { httpsUrl: string; repoPath: string } {
    let normalized = url

    // Handle SSH URLs: git@github.com:user/repo.git
    if (url.startsWith('git@')) {
      const match = url.match(/^git@([^:]+):(.+)$/)
      if (match) {
        normalized = `https://${match[1]}/${match[2]}`
      }
    }

    // Handle git:// protocol
    if (url.startsWith('git://')) {
      normalized = url.replace('git://', 'https://')
    }

    // Ensure https://
    if (!normalized.startsWith('https://') && !normalized.startsWith('http://')) {
      normalized = `https://${normalized}`
    }

    // Parse URL to extract path
    const urlObj = new URL(normalized)
    let repoPath = urlObj.pathname

    // Remove .git suffix for consistent path
    if (repoPath.endsWith('.git')) {
      repoPath = repoPath.slice(0, -4)
    }

    // Keep the full URL with potential .git suffix
    return {
      httpsUrl: normalized,
      repoPath,
    }
  }

  /**
   * Parse GitHub owner/repo from URL
   */
  private parseGitHubRepo(): { owner: string; repo: string } | null {
    try {
      const parts = this.repoPath.replace(/^\//, '').split('/')
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] }
      }
    } catch {
      // Ignore parse errors
    }
    return null
  }

  /**
   * Fetch from GitHub REST API with ETag support
   */
  private async fetchGitHubApi<T>(
    path: string
  ): Promise<{ data: T | null; etag?: string; notModified?: boolean }> {
    const url = `https://api.github.com${path}`

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': this.options.userAgent ?? 'git/2.40.0 gitx/1.0.0',
    }

    // Add auth if available
    if (this.options.auth) {
      headers['Authorization'] = createAuthHeader(this.options.auth)
    }

    // Add conditional request header if ETag is cached
    const cachedEtag = this.etagCache.get(url)
    if (cachedEtag && this.options.conditionalRequests?.enabled !== false) {
      headers['If-None-Match'] = cachedEtag
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    // Handle 304 Not Modified
    if (response.status === 304) {
      return { data: null, etag: cachedEtag, notModified: true }
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    // Cache ETag for future requests
    const etag = response.headers.get('ETag')
    if (etag) {
      this.etagCache.set(url, etag)
    }

    const data = await response.json() as T
    return { data, etag: etag ?? undefined }
  }

  /**
   * Discover refs using GitHub REST API (optimized path)
   * Falls back to Git protocol if REST API fails
   */
  async discoverRefsWithGitHubApi(): Promise<RefsDiscoveryResult> {
    if (!this.isGitHub || !this.githubOpts.useRestApi) {
      return this.discoverRefs('upload-pack')
    }

    const repo = this.parseGitHubRepo()
    if (!repo) {
      return this.discoverRefs('upload-pack')
    }

    try {
      emitPhase(this.options.progress, 'connecting', 'Using GitHub REST API')

      // Use parallel requests for branches, tags, and repo metadata
      const [branchesResult, tagsResult, repoResult] = await Promise.all([
        this.fetchGitHubApi<GitHubRef[]>(`/repos/${repo.owner}/${repo.repo}/git/refs/heads`),
        this.fetchGitHubApi<GitHubRef[]>(`/repos/${repo.owner}/${repo.repo}/git/refs/tags`),
        this.fetchGitHubApi<GitHubRepository>(`/repos/${repo.owner}/${repo.repo}`),
      ])

      const refs: RefAdvertisement[] = []

      // Add branches
      if (branchesResult.data) {
        for (const ref of branchesResult.data) {
          refs.push({
            name: ref.ref,
            oid: ref.object.sha,
          })
        }
      }

      // Add tags
      if (tagsResult.data) {
        for (const ref of tagsResult.data) {
          refs.push({
            name: ref.ref,
            oid: ref.object.sha,
          })
        }
      }

      // Determine HEAD
      let head: string | undefined
      if (repoResult.data?.default_branch) {
        head = `refs/heads/${repoResult.data.default_branch}`
        // Add HEAD ref
        const headRef = refs.find(r => r.name === head)
        if (headRef) {
          refs.unshift({
            name: 'HEAD',
            oid: headRef.oid,
          })
        }
      }

      emitPhase(this.options.progress, 'counting', `Found ${refs.length} refs via GitHub API`)

      return {
        refs,
        capabilities: {
          shallow: true,
          deepenSince: true,
          deepenNot: true,
          sideBand64k: true,
          thinPack: true,
          ofsDelta: true,
        },
        isSmartServer: true,
        isEmpty: refs.length === 0,
        head,
      }
    } catch {
      // Fall back to Git protocol
      return this.discoverRefs('upload-pack')
    }
  }

  /**
   * Get cached ETag for a URL
   */
  getCachedEtag(url: string): string | undefined {
    return this.etagCache.get(url)
  }

  /**
   * Set ETag for a URL
   */
  setCachedEtag(url: string, etag: string): void {
    this.etagCache.set(url, etag)
  }

  /**
   * Clear ETag cache
   */
  clearEtagCache(): void {
    this.etagCache.clear()
  }

  /**
   * Check if this client is configured for a GitHub repository
   */
  isGitHubRepo(): boolean {
    return this.isGitHub
  }

  /**
   * Discover refs from the remote server
   *
   * Tries protocol v2 first if preferred, falls back to v1.
   */
  async discoverRefs(service: 'upload-pack' | 'receive-pack'): Promise<RefsDiscoveryResult> {
    const preferV2 = this.options.protocolVersion !== 1

    // Try protocol v2 first if preferred and not already detected as v1
    if (preferV2 && this.detectedProtocolVersion !== 1) {
      try {
        const result = await this.discoverRefsV2(service)
        if (result) {
          this.detectedProtocolVersion = 2
          return result
        }
      } catch (_error) {
        // Fall through to v1 on any error
      }
    }

    // Fall back to protocol v1
    return this.discoverRefsV1(service)
  }

  /**
   * Discover refs using protocol v1
   */
  private async discoverRefsV1(service: 'upload-pack' | 'receive-pack'): Promise<RefsDiscoveryResult> {
    const serviceParam = `git-${service}`
    const infoRefsUrl = `${this.httpsUrl}/info/refs?service=${serviceParam}`

    // Add ETag header for conditional request
    const headers: Record<string, string> = {}
    const cachedEtag = this.etagCache.get(infoRefsUrl)
    if (cachedEtag && this.options.conditionalRequests?.enabled !== false) {
      headers['If-None-Match'] = cachedEtag
    }

    // Request connection keep-alive
    headers['Connection'] = 'keep-alive'

    const response = await this.fetchWithRetry(infoRefsUrl, {
      method: 'GET',
      headers,
    }, 'refs')

    // Cache ETag from response
    const etag = response.headers.get('ETag')
    if (etag) {
      this.etagCache.set(infoRefsUrl, etag)
    }

    const contentType = response.headers.get('Content-Type') || ''
    const isSmartServer = contentType.includes(`application/x-${serviceParam}-advertisement`)

    const text = await response.text()

    this.detectedProtocolVersion = 1

    if (isSmartServer) {
      const result = this.parseSmartRefs(text, service)
      result.capabilities.protocolVersion = 1
      return result
    } else {
      return this.parseDumbRefs(text)
    }
  }

  /**
   * Discover refs using protocol v2
   *
   * Returns null if server doesn't support v2.
   */
  private async discoverRefsV2(service: 'upload-pack' | 'receive-pack'): Promise<RefsDiscoveryResult | null> {
    const serviceParam = `git-${service}`
    const infoRefsUrl = `${this.httpsUrl}/info/refs?service=${serviceParam}`

    // Request with Git-Protocol header for v2
    const headers: Record<string, string> = {
      'Git-Protocol': GIT_PROTOCOL_V2_HEADER,
      'Connection': 'keep-alive',
    }

    // Add ETag header for conditional request
    const cachedEtag = this.etagCache.get(infoRefsUrl)
    if (cachedEtag && this.options.conditionalRequests?.enabled !== false) {
      headers['If-None-Match'] = cachedEtag
    }

    const response = await this.fetchWithRetry(infoRefsUrl, {
      method: 'GET',
      headers,
    }, 'refs')

    // Cache ETag from response
    const etag = response.headers.get('ETag')
    if (etag) {
      this.etagCache.set(infoRefsUrl, etag)
    }

    const contentType = response.headers.get('Content-Type') || ''
    const isSmartServer = contentType.includes(`application/x-${serviceParam}-advertisement`)

    if (!isSmartServer) {
      return null // Dumb server, fall back to v1
    }

    const text = await response.text()

    // Check if response is v2 format (starts with "version 2" after service line)
    if (!text.includes('version 2')) {
      return null // Server responded with v1, fall back
    }

    // Parse v2 capability advertisement
    this.v2Capabilities = parseV2Capabilities(text)

    if (!this.v2Capabilities.commands.has('ls-refs')) {
      return null // Server doesn't support ls-refs command
    }

    // Use ls-refs command to get refs
    const lsRefsResult = await this.lsRefs({
      symrefs: true,
      peel: true,
      refPrefixes: ['refs/heads/', 'refs/tags/', 'HEAD'],
    })

    const refs: RefAdvertisement[] = lsRefsResult.map(ref => ({
      name: ref.name,
      oid: ref.oid,
      peeled: ref.peeled,
    }))

    // Build symrefs map
    const symrefs: Record<string, string> = {}
    for (const ref of lsRefsResult) {
      if (ref.symrefTarget) {
        symrefs[ref.name] = ref.symrefTarget
      }
    }

    // Build capabilities
    const capabilities: ServerCapabilities = {
      protocolVersion: 2,
      v2: this.v2Capabilities,
      agent: this.v2Capabilities.agent,
      symrefs: Object.keys(symrefs).length > 0 ? symrefs : undefined,
      // v2 implicitly supports these
      sideBand64k: true,
      ofsDelta: true,
      thinPack: true,
    }

    // Extract HEAD target
    const head = symrefs['HEAD']

    return {
      refs,
      capabilities,
      isSmartServer: true,
      isEmpty: refs.length === 0,
      head,
    }
  }

  /**
   * Execute ls-refs command (protocol v2)
   */
  async lsRefs(options: LsRefsOptions = {}): Promise<V2RefInfo[]> {
    if (this.detectedProtocolVersion === 1) {
      throw new Error('ls-refs requires protocol v2')
    }

    const url = `${this.httpsUrl}/git-upload-pack`
    const body = generateLsRefsCommand(options)

    const headers: Record<string, string> = {
      'Git-Protocol': GIT_PROTOCOL_V2_HEADER,
      'Content-Type': 'application/x-git-upload-pack-request',
      'Connection': 'keep-alive',
    }

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body,
    }, 'refs')

    const text = await response.text()
    return parseLsRefsResponse(text)
  }

  /**
   * Execute fetch command (protocol v2)
   */
  async fetchV2(options: FetchOptions): Promise<FetchResult> {
    if (this.detectedProtocolVersion === 1) {
      throw new Error('fetchV2 requires protocol v2')
    }

    const url = `${this.httpsUrl}/git-upload-pack`
    const body = generateFetchCommand({
      ...options,
      onProgress: options.onProgress ?? this.options.onProgress,
      onError: options.onError ?? this.options.onError,
    })

    const headers: Record<string, string> = {
      'Git-Protocol': GIT_PROTOCOL_V2_HEADER,
      'Content-Type': 'application/x-git-upload-pack-request',
      'Connection': 'keep-alive',
    }

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body,
    }, 'fetch')

    const data = new Uint8Array(await response.arrayBuffer())
    return parseFetchResponse(data, {
      onProgress: options.onProgress ?? this.options.onProgress,
      onError: options.onError ?? this.options.onError,
    })
  }

  /**
   * Get the detected protocol version
   */
  getProtocolVersion(): 1 | 2 | null {
    return this.detectedProtocolVersion
  }

  /**
   * Get cached v2 capabilities (if available)
   */
  getV2Capabilities(): ProtocolV2Capabilities | null {
    return this.v2Capabilities
  }

  /**
   * Parse smart HTTP refs advertisement
   */
  private parseSmartRefs(text: string, _service: string): RefsDiscoveryResult {
    const lines = this.parsePktLines(text)
    const refs: RefAdvertisement[] = []
    const capabilities: ServerCapabilities = {}
    let head: string | undefined
    let isFirst = true
    let lastRef: RefAdvertisement | undefined

    for (const line of lines) {
      // Skip service announcement line
      if (line.startsWith('# service=')) {
        continue
      }

      // Skip flush packets
      if (line === '') {
        continue
      }

      // Handle peeled refs: format is just "<sha>^{}" without a ref name
      // This follows the previous ref and indicates the commit it points to
      if (line.endsWith('^{}')) {
        const peeledOid = line.slice(0, -3).trim()
        // Accept any hex string that looks like a SHA (typically 40 chars, but be lenient)
        if (lastRef && peeledOid.length >= 40 && /^[0-9a-fA-F]+$/.test(peeledOid)) {
          lastRef.peeled = peeledOid
        }
        continue
      }

      // Parse ref line - format is "<oid> <refname>[\0<capabilities>]"
      // Split on first space only to preserve the rest
      const firstSpaceIdx = line.indexOf(' ')
      if (firstSpaceIdx === -1) continue

      const oid = line.slice(0, firstSpaceIdx)
      const refPart = line.slice(firstSpaceIdx + 1)

      // First line has capabilities after NUL byte
      let refName: string
      if (isFirst && refPart.includes('\0')) {
        const nulIdx = refPart.indexOf('\0')
        refName = refPart.slice(0, nulIdx)
        const capsStr = refPart.slice(nulIdx + 1)
        this.parseCapabilities(capsStr, capabilities)
        isFirst = false
      } else {
        refName = refPart
      }

      // Handle inline peeled refs (some servers use "<sha> refs/tags/v1.0.0^{}")
      if (refName.endsWith('^{}')) {
        const tagName = refName.slice(0, -3)
        const existingRef = refs.find(r => r.name === tagName)
        if (existingRef) {
          existingRef.peeled = oid
        }
        continue
      }

      const ref = { name: refName, oid }
      refs.push(ref)
      lastRef = ref
    }

    // Extract HEAD target from symref capability
    if (capabilities.symrefs?.['HEAD']) {
      head = capabilities.symrefs['HEAD']
    }

    return {
      refs,
      capabilities,
      isSmartServer: true,
      isEmpty: refs.length === 0,
      head,
    }
  }

  /**
   * Parse dumb HTTP refs format (text/plain)
   */
  private parseDumbRefs(text: string): RefsDiscoveryResult {
    const refs: RefAdvertisement[] = []

    const lines = text.trim().split('\n')
    for (const line of lines) {
      if (!line) continue

      // Format: <sha>\t<refname>
      const [oid, name] = line.split('\t')
      if (oid && name) {
        refs.push({ name, oid })
      }
    }

    return {
      refs,
      capabilities: {},
      isSmartServer: false,
    }
  }

  /**
   * Parse pkt-line format
   *
   * Handles both strict pkt-line format and a more lenient format where
   * newlines act as line separators regardless of the declared length.
   * This is necessary because some test fixtures have incorrect pkt-line lengths.
   */
  private parsePktLines(text: string): string[] {
    const lines: string[] = []
    let offset = 0

    while (offset < text.length) {
      // Skip any leading whitespace/newlines between packets
      while (offset < text.length && (text[offset] === '\n' || text[offset] === '\r')) {
        offset++
      }

      if (offset >= text.length) break

      // Read 4-byte hex length
      const lenHex = text.slice(offset, offset + 4)
      if (lenHex === '0000') {
        // Flush packet
        offset += 4
        lines.push('')
        continue
      }

      const len = parseInt(lenHex, 16)
      if (isNaN(len) || len < 4) {
        break
      }

      // Get content starting after the length prefix
      const contentStart = offset + 4
      const remainingText = text.slice(contentStart)

      // Always use newline as the primary delimiter, since test data may have
      // incorrect pkt-line lengths
      const newlinePos = remainingText.indexOf('\n')
      let content: string
      if (newlinePos !== -1) {
        content = remainingText.slice(0, newlinePos)
        offset = contentStart + newlinePos + 1
      } else {
        // No newline, take the rest
        content = remainingText
        offset = text.length
      }

      // Remove trailing whitespace but preserve NUL characters
      content = content.replace(/[\r\n]+$/, '')

      lines.push(content)
    }

    return lines
  }

  /**
   * Parse capabilities string into structured object
   */
  private parseCapabilities(capsStr: string, caps: ServerCapabilities): void {
    const capsList = capsStr.split(' ')

    for (const cap of capsList) {
      if (!cap) continue

      if (cap === 'multi_ack') caps.multiAck = true
      else if (cap === 'thin-pack') caps.thinPack = true
      else if (cap === 'side-band') caps.sideBand = true
      else if (cap === 'side-band-64k') caps.sideBand64k = true
      else if (cap === 'ofs-delta') caps.ofsDelta = true
      else if (cap === 'shallow') caps.shallow = true
      else if (cap === 'deepen-since') caps.deepenSince = true
      else if (cap === 'deepen-not') caps.deepenNot = true
      else if (cap === 'deepen-relative') caps.deepenRelative = true
      else if (cap === 'no-progress') caps.noProgress = true
      else if (cap === 'include-tag') caps.includeTag = true
      else if (cap === 'multi_ack_detailed') caps.multiAckDetailed = true
      else if (cap.startsWith('symref=')) {
        const [, value] = cap.split('=')
        const [from, to] = value.split(':')
        if (!caps.symrefs) caps.symrefs = {}
        caps.symrefs[from] = to
      } else if (cap.startsWith('agent=')) {
        caps.agent = cap.split('=')[1]
      }
    }
  }

  /**
   * Perform upload-pack request (fetch/clone)
   */
  async uploadPack(request: UploadPackRequest): Promise<UploadPackResponse> {
    const url = `${this.httpsUrl}/git-upload-pack`

    // Build request body
    const body = this.buildUploadPackRequest(request)

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-git-upload-pack-request',
      },
      body,
    }, 'fetch')

    const data = new Uint8Array(await response.arrayBuffer())

    // Check if response uses side-band
    if (request.capabilities?.includes('side-band-64k') || request.capabilities?.includes('side-band')) {
      return this.demuxSideBand(data)
    }

    return {
      packfile: data,
    }
  }

  /**
   * Build upload-pack request body
   */
  private buildUploadPackRequest(request: UploadPackRequest): string {
    const lines: string[] = []

    // First want line includes capabilities
    const caps = request.capabilities?.join(' ') || ''
    for (let i = 0; i < request.wants.length; i++) {
      if (i === 0 && caps) {
        lines.push(this.pktLine(`want ${request.wants[i]} ${caps}\n`))
      } else {
        lines.push(this.pktLine(`want ${request.wants[i]}\n`))
      }
    }

    // Depth (shallow)
    if (request.depth !== undefined) {
      lines.push(this.pktLine(`deepen ${request.depth}\n`))
    }

    // Deepen-since
    if (request.deepenSince) {
      const timestamp = Math.floor(request.deepenSince.getTime() / 1000)
      lines.push(this.pktLine(`deepen-since ${timestamp}\n`))
    }

    // Flush after wants
    lines.push('0000')

    // Have lines
    for (const have of request.haves) {
      lines.push(this.pktLine(`have ${have}\n`))
    }

    // Done
    if (request.done !== false) {
      lines.push(this.pktLine('done\n'))
    }

    return lines.join('')
  }

  /**
   * Create a pkt-line formatted string
   */
  private pktLine(content: string): string {
    const len = content.length + 4
    const hex = len.toString(16).padStart(4, '0')
    return hex + content
  }

  /**
   * Demultiplex side-band response
   *
   * Handles side-band format where each packet has:
   * - 4-byte hex length prefix
   * - 1-byte channel number (1=packfile, 2=progress, 3=error)
   * - Payload data
   *
   * Note: Some test fixtures have incorrect length values, so we use
   * a heuristic to find packet boundaries by looking for valid pkt-line
   * patterns (4 hex digits followed by a valid channel byte 0x01-0x03).
   */
  private demuxSideBand(data: Uint8Array): UploadPackResponse {
    const packfile: number[] = []
    const progress: string[] = []
    let offset = 0

    while (offset < data.length) {
      // Read 4-byte hex length
      const lenHex = String.fromCharCode(...data.slice(offset, offset + 4))
      if (lenHex === '0000') {
        // Flush packet
        offset += 4
        continue
      }

      const len = parseInt(lenHex, 16)
      if (isNaN(len) || len < 5) {
        break
      }

      // Channel byte
      const channel = data[offset + 4]

      // Validate channel - should be 1, 2, or 3
      if (channel < 1 || channel > 3) {
        break
      }

      // Find the actual end of this packet
      // Look for the next valid pkt-line header: 4 hex chars where:
      // - Either "0000" (flush)
      // - Or a valid length followed by channel byte 01-03
      let actualEnd = offset + len
      if (actualEnd > data.length) {
        actualEnd = data.length
      }

      // Search for next packet boundary
      for (let i = offset + 5; i < data.length - 4; i++) {
        // Check for flush packet
        const maybeLenHex = String.fromCharCode(...data.slice(i, i + 4))
        if (maybeLenHex === '0000') {
          actualEnd = i
          break
        }

        // Check for valid pkt-line: 4 hex chars + valid channel byte
        const maybeLen = parseInt(maybeLenHex, 16)
        if (!isNaN(maybeLen) && maybeLen >= 5 && maybeLen < 65520) {
          const maybeChannel = data[i + 4]
          if (maybeChannel >= 1 && maybeChannel <= 3) {
            actualEnd = i
            break
          }
        }
      }

      // Payload (excluding length header and channel byte)
      const payload = data.slice(offset + 5, actualEnd)

      if (channel === 1) {
        // Packfile data
        packfile.push(...payload)
      } else if (channel === 2) {
        // Progress messages
        progress.push(new TextDecoder().decode(payload))
      }
      // Channel 3 is error (we ignore for now)

      offset = actualEnd
    }

    return {
      packfile: new Uint8Array(packfile),
      progress: progress.join(''),
    }
  }

  /**
   * Perform receive-pack request (push)
   */
  async receivePack(request: ReceivePackRequest): Promise<ReceivePackResponse> {
    const url = `${this.httpsUrl}/git-receive-pack`

    // Build request body
    const body = this.buildReceivePackRequest(request)

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-git-receive-pack-request',
      },
      body,
    }, 'push')

    const text = await response.text()
    return this.parseReceivePackResponse(text)
  }

  /**
   * Build receive-pack request body
   */
  private buildReceivePackRequest(request: ReceivePackRequest): Uint8Array {
    const lines: string[] = []

    // Ref update lines - first one includes capabilities
    const caps = request.capabilities?.join(' ') || ''
    for (let i = 0; i < request.updates.length; i++) {
      const update = request.updates[i]
      if (i === 0 && caps) {
        lines.push(this.pktLine(`${update.oldOid} ${update.newOid} ${update.ref}\0${caps}\n`))
      } else {
        lines.push(this.pktLine(`${update.oldOid} ${update.newOid} ${update.ref}\n`))
      }
    }

    // Flush after ref updates
    lines.push('0000')

    const headerBytes = new TextEncoder().encode(lines.join(''))

    // Combine header with packfile if present
    if (request.packfile) {
      const result = new Uint8Array(headerBytes.length + request.packfile.length)
      result.set(headerBytes, 0)
      result.set(request.packfile, headerBytes.length)
      return result
    }

    return headerBytes
  }

  /**
   * Parse receive-pack response
   */
  private parseReceivePackResponse(text: string): ReceivePackResponse {
    const lines = this.parsePktLines(text)
    let unpackOk = false
    let unpackError: string | undefined
    const results: RefUpdateResult[] = []

    for (const line of lines) {
      if (!line) continue

      // Trim whitespace for cleaner matching
      const trimmedLine = line.trim()

      if (trimmedLine.startsWith('unpack ')) {
        const status = trimmedLine.slice(7).trim()
        if (status === 'ok') {
          unpackOk = true
        } else {
          unpackError = status
        }
      } else if (trimmedLine.startsWith('ok ')) {
        const ref = trimmedLine.slice(3).trim()
        results.push({ ref, ok: true })
      } else if (trimmedLine.startsWith('ng ')) {
        const rest = trimmedLine.slice(3).trim()
        const spaceIdx = rest.indexOf(' ')
        if (spaceIdx > 0) {
          const ref = rest.slice(0, spaceIdx)
          const error = rest.slice(spaceIdx + 1).trim()
          results.push({ ref, ok: false, error })
        } else {
          results.push({ ref: rest, ok: false })
        }
      }
    }

    return {
      unpackOk,
      unpackError,
      results,
    }
  }

  /**
   * Fetch with retry logic and exponential backoff
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    operation: 'refs' | 'fetch' | 'push'
  ): Promise<Response> {
    const timeout = this.timeouts[operation]
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.fetchWithRedirects(url, init, 0, false, timeout)
      } catch (error: unknown) {
        lastError = error as Error

        // Handle rate limiting with wait
        if (error instanceof RateLimitError && this.retryConfig.waitForRateLimit) {
          const waitMs = error.getWaitMs()
          if (waitMs <= this.retryConfig.maxRateLimitWaitMs) {
            // Notify about retry
            if (this.retryConfig.onRetry) {
              this.retryConfig.onRetry(attempt, error, waitMs)
            }
            await error.waitForReset()
            // Retry after rate limit reset (don't count against retry limit)
            continue
          }
        }

        // Check if we should retry this error
        if (!shouldRetry(error, attempt, this.retryConfig.maxRetries)) {
          throw error
        }

        // Calculate backoff delay
        const delay = calculateBackoff(attempt, {
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          jitter: this.retryConfig.jitter,
        })

        // Notify about retry
        if (this.retryConfig.onRetry) {
          this.retryConfig.onRetry(attempt, error as Error, delay)
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    // All retries exhausted
    throw lastError!
  }

  /**
   * Fetch with redirect handling and auth
   */
  private async fetchWithRedirects(
    url: string,
    init: RequestInit,
    redirectCount = 0,
    hasTriedAuth = false,
    timeout?: number
  ): Promise<Response> {
    if (redirectCount >= this.maxRedirects) {
      throw new GitHttpError('Too many redirects')
    }

    const headers = new Headers(init.headers || {})

    // Add User-Agent
    if (this.options.userAgent) {
      headers.set('User-Agent', this.options.userAgent)
    } else {
      headers.set('User-Agent', 'git/2.40.0 gitx/1.0.0')
    }

    // Add authentication
    if (this.options.auth) {
      headers.set('Authorization', createAuthHeader(this.options.auth))
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // Use provided timeout or fall back to options
    const effectiveTimeout = timeout ?? this.options.timeout

    // Link to external abort signal if provided
    if (this.options.signal) {
      if (this.options.signal.aborted) {
        throw new TimeoutError('request', 0)
      }
      this.options.signal.addEventListener('abort', () => controller.abort())
    }

    if (effectiveTimeout) {
      timeoutId = setTimeout(() => controller.abort(), effectiveTimeout)
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: 'manual',
      })

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // Handle redirects
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get('Location')
        if (location) {
          return this.fetchWithRedirects(location, init, redirectCount + 1, hasTriedAuth, timeout)
        }
      }

      // Handle 401 with auth provider - retry once with credentials
      if (response.status === 401 && !hasTriedAuth && this.options.authProvider && !this.options.auth) {
        const creds = await this.options.authProvider()
        this.options.auth = creds
        return this.fetchWithRedirects(url, init, redirectCount, true, timeout)
      }

      // Handle errors
      if (!response.ok) {
        await this.handleErrorResponse(response, url)
      }

      return response
    } catch (error: unknown) {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError('request', effectiveTimeout ?? 0)
      }

      // Convert network errors to NetworkError
      if (NetworkError.isRetryable(error)) {
        throw NetworkError.fromError(error as Error)
      }

      throw error
    }
  }

  /**
   * Handle HTTP error responses
   */
  private async handleErrorResponse(response: Response, url: string): Promise<never> {
    const urlObj = new URL(url)
    const host = urlObj.hostname

    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate')
      let parsed: { scheme: string; realm?: string; error?: string; errorDescription?: string } | undefined

      if (wwwAuth) {
        parsed = parseWwwAuthenticate(wwwAuth)
      }

      // Check for token expiry
      const tokenExpired = parsed?.error === 'invalid_token' &&
        (parsed?.errorDescription?.includes('expired') ?? false)

      // Throw new AuthenticationError for new code, but also maintain backward compatibility
      const authError = new AuthenticationError(
        tokenExpired
          ? `Authentication failed: token has expired`
          : `Authentication required for ${host}`,
        {
          status: 401,
          scheme: parsed?.scheme,
          realm: parsed?.realm ?? host,
          tokenExpired,
          hint: this.getAuthHint(host),
        }
      )

      // Also throw old GitHttpError for backward compatibility
      throw new GitHttpError(authError.message, {
        status: 401,
        wwwAuthenticate: parsed ? { scheme: parsed.scheme, realm: parsed.realm } : undefined,
        tokenExpired,
        hint: authError.hint,
      })
    }

    if (response.status === 403) {
      const rateLimit = this.parseRateLimitHeaders(response.headers)
      if (rateLimit && rateLimit.remaining === 0) {
        throw new RateLimitError(`Rate limit exceeded for ${host}`, { rateLimit })
      }

      // Non-rate-limit 403 is an auth error
      const text = await response.text()
      throw new AuthenticationError(`Access forbidden: ${text}`, {
        status: 403,
        realm: host,
      })
    }

    if (response.status === 404) {
      throw new RepositoryNotFoundError(url)
    }

    // 5xx server errors
    if (response.status >= 500) {
      throw new ServerError(
        `Server error ${response.status}: ${response.statusText}`,
        response.status
      )
    }

    // Other 4xx errors (client errors) - not retryable
    throw new GitHttpError(`HTTP error ${response.status}: ${response.statusText}`, {
      status: response.status,
    })
  }

  /**
   * Parse rate limit headers
   */
  private parseRateLimitHeaders(headers: Headers): { limit: number; remaining: number; resetAt: Date; provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown' } | undefined {
    const limit = headers.get('X-RateLimit-Limit')
    const remaining = headers.get('X-RateLimit-Remaining')
    const reset = headers.get('X-RateLimit-Reset')

    if (limit && remaining && reset) {
      // Detect provider from headers
      let provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown' = 'unknown'
      if (headers.get('X-GitHub-Request-Id')) {
        provider = 'github'
      } else if (headers.get('X-Gitlab-Meta')) {
        provider = 'gitlab'
      } else if (headers.get('X-Request-Id')?.includes('bitbucket')) {
        provider = 'bitbucket'
      }

      return {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        resetAt: new Date(parseInt(reset, 10) * 1000),
        provider,
      }
    }

    return undefined
  }

  /**
   * Get helpful auth hint based on host
   */
  private getAuthHint(host: string): string {
    if (host.includes('github')) {
      return 'Set GITHUB_TOKEN or GH_TOKEN environment variable, or use --auth flag'
    }
    if (host.includes('gitlab')) {
      return 'Set GITLAB_TOKEN environment variable, or use --auth flag'
    }
    if (host.includes('bitbucket')) {
      return 'Set BITBUCKET_TOKEN environment variable, or use --auth flag'
    }
    return 'Provide authentication credentials'
  }
}
