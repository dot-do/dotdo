// lib/storage/authorized-r2.ts

/**
 * JWT-authorized R2 client that constructs paths based on claims.
 * Provides tenant-isolated storage paths using JWT claim data.
 *
 * Path structure: [pathPrefix/]orgs/{orgId}/tenants/{tenantId}/do/{doId}/{type}/
 */

// R2 Claims interface for this module
export interface R2Claims {
  orgId: string
  tenantId: string
  bucket: string
  pathPrefix: string
  region?: string
}

// R2 bucket interface matching Cloudflare R2
export interface R2Bucket {
  put(key: string, data: ArrayBuffer | string, options?: R2PutOptions): Promise<R2Object>
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string | string[]): Promise<void>
  list(options?: R2ListOptions): Promise<R2Objects>
  head(key: string): Promise<R2Object | null>
}

export interface R2PutOptions {
  httpMetadata?: {
    contentType?: string
    [key: string]: unknown
  }
  customMetadata?: Record<string, string>
  [key: string]: unknown
}

export interface R2Object {
  key: string
  size?: number
  etag?: string
  httpMetadata?: Record<string, unknown>
  customMetadata?: Record<string, string>
}

export interface R2ObjectBody extends R2Object {
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  body: ReadableStream
}

export interface R2Objects {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
  delimitedPrefixes?: string[]
}

export interface R2ListOptions {
  prefix?: string
  limit?: number
  cursor?: string
  delimiter?: string
  [key: string]: unknown
}

// Path validation regex - only allow alphanumeric, underscore, hyphen, and dots
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_\-\.]+$/
const TRAVERSAL_PATTERN = /\.\./

export class AuthorizedR2Client {
  private readonly _claims: R2Claims

  constructor(
    claims: R2Claims,
    private r2?: R2Bucket
  ) {
    // Validate required claims
    if (!claims.orgId) {
      throw new Error('Missing required claim: orgId')
    }
    if (!claims.tenantId) {
      throw new Error('Missing required claim: tenantId')
    }
    if (!claims.bucket) {
      throw new Error('Missing required claim: bucket')
    }

    this._claims = { ...claims }
  }

  /** Readonly access to claims */
  get claims(): R2Claims {
    return this._claims
  }

  /** Get the bucket name from claims */
  get bucketName(): string {
    return this._claims.bucket
  }

  /**
   * Validate and sanitize a path segment
   */
  private validateSegment(segment: string, name: string): void {
    if (TRAVERSAL_PATTERN.test(segment)) {
      throw new Error(`Path traversal detected in ${name}`)
    }
  }

  /**
   * Build a path from segments, handling pathPrefix normalization
   */
  private buildPath(...segments: (string | undefined)[]): string {
    const filtered = segments.filter((s): s is string => Boolean(s))

    // Validate segments for path traversal
    for (const segment of filtered) {
      if (TRAVERSAL_PATTERN.test(segment)) {
        throw new Error('Path traversal detected')
      }
    }

    // Join and normalize multiple slashes, but preserve meaningful leading slash
    const path = filtered.join('/').replace(/\/+/g, '/')

    return path
  }

  /**
   * Build the base path for this tenant
   */
  getBasePath(): string {
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId
    ) + '/'
  }

  /**
   * Build the base path for a specific DO
   */
  getDOBasePath(doId: string): string {
    this.validateSegment(doId, 'doId')
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId
    ) + '/'
  }

  /**
   * Get the state path for a DO
   */
  getStatePath(doId: string): string {
    this.validateSegment(doId, 'doId')
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'state'
    ) + '/'
  }

  /**
   * Get the snapshot path for a DO
   */
  getSnapshotPath(doId: string, snapshotId: string): string {
    this.validateSegment(doId, 'doId')
    this.validateSegment(snapshotId, 'snapshotId')
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'snapshots',
      snapshotId
    ) + '/'
  }

  /**
   * Get the iceberg metadata path for a DO
   */
  getIcebergMetadataPath(doId: string): string {
    this.validateSegment(doId, 'doId')
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'iceberg',
      'metadata'
    ) + '/'
  }

  /**
   * Get the iceberg data path for a DO
   */
  getIcebergDataPath(doId: string): string {
    this.validateSegment(doId, 'doId')
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'iceberg',
      'data'
    ) + '/'
  }

  // ============================================================================
  // R2 Operations
  // ============================================================================

  private ensureR2(): R2Bucket {
    if (!this.r2) {
      throw new Error('R2 bucket not configured')
    }
    return this.r2
  }

  private buildStatePath(doId: string, key: string): string {
    this.validateSegment(doId, 'doId')
    if (TRAVERSAL_PATTERN.test(key)) {
      throw new Error('Path traversal detected in key')
    }
    return this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'state',
      key
    )
  }

  /**
   * Put an object to the state directory
   */
  async put(doId: string, key: string, data: ArrayBuffer | string, options?: R2PutOptions): Promise<void> {
    const r2 = this.ensureR2()
    const path = this.buildStatePath(doId, key)
    if (options) {
      await r2.put(path, data, options)
    } else {
      await r2.put(path, data)
    }
  }

  /**
   * Get an object from the state directory
   */
  async get(doId: string, key: string): Promise<R2ObjectBody | null> {
    const r2 = this.ensureR2()
    const path = this.buildStatePath(doId, key)
    return r2.get(path)
  }

  /**
   * List objects with a given prefix
   */
  async list(doId: string, prefix: string, options?: Omit<R2ListOptions, 'prefix'>): Promise<R2Objects> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    const path = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      prefix
    )
    return r2.list({ prefix: path, ...options })
  }

  /**
   * Delete an object from the state directory
   */
  async delete(doId: string, key: string): Promise<void> {
    const r2 = this.ensureR2()
    const path = this.buildStatePath(doId, key)
    await r2.delete(path)
  }

  /**
   * Check if an object exists
   */
  async exists(doId: string, key: string): Promise<boolean> {
    const r2 = this.ensureR2()
    const path = this.buildStatePath(doId, key)
    const result = await r2.head(path)
    return result !== null
  }

  // ============================================================================
  // Conditional Operations
  // ============================================================================

  /**
   * Put an object with conditional write semantics.
   * Supports onlyIfNotExists for single-writer semantics (fencing token acquisition).
   *
   * @param doId - The Durable Object ID
   * @param key - The key within the DO's state directory
   * @param data - The data to write
   * @param options - Conditional options
   * @returns The R2Object result
   * @throws Error if condition is not met (e.g., lock already exists)
   */
  async putWithCondition(
    doId: string,
    key: string,
    data: ArrayBuffer | string,
    options: { onlyIfNotExists?: boolean; ifMatch?: string; ifNoneMatch?: string }
  ): Promise<R2Object> {
    const r2 = this.ensureR2()
    const path = this.buildStatePath(doId, key)

    // Build R2 put options with conditional semantics
    const putOptions: R2PutOptions = {}

    if (options.onlyIfNotExists || options.ifNoneMatch === '*') {
      // R2 uses onlyIf with etagDoesNotMatch: '*' to only create if not exists
      putOptions.onlyIf = { etagDoesNotMatch: '*' }
    } else if (options.ifMatch) {
      putOptions.onlyIf = { etagMatches: options.ifMatch }
    } else if (options.ifNoneMatch) {
      putOptions.onlyIf = { etagDoesNotMatch: options.ifNoneMatch }
    }

    return r2.put(path, data, putOptions)
  }

  // ============================================================================
  // Snapshot Operations
  // ============================================================================

  /**
   * Put snapshot data
   */
  async putSnapshot(doId: string, snapshotId: string, filename: string, data: ArrayBuffer | string): Promise<void> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    this.validateSegment(snapshotId, 'snapshotId')
    const path = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'snapshots',
      snapshotId,
      filename
    )
    await r2.put(path, data)
  }

  /**
   * Get snapshot data
   */
  async getSnapshot(doId: string, snapshotId: string, filename: string): Promise<R2ObjectBody | null> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    this.validateSegment(snapshotId, 'snapshotId')
    const path = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'snapshots',
      snapshotId,
      filename
    )
    return r2.get(path)
  }

  /**
   * List snapshots for a DO
   */
  async listSnapshots(doId: string): Promise<R2Objects> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    const prefix = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'snapshots'
    ) + '/'
    return r2.list({ prefix, delimiter: '/' })
  }

  // ============================================================================
  // Iceberg Operations
  // ============================================================================

  /**
   * Put iceberg metadata
   */
  async putIcebergMetadata(doId: string, filename: string, data: string): Promise<void> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    const path = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'iceberg',
      'metadata',
      filename
    )
    await r2.put(path, data)
  }

  /**
   * Get iceberg metadata
   */
  async getIcebergMetadata(doId: string, filename: string): Promise<R2ObjectBody | null> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    const path = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'iceberg',
      'metadata',
      filename
    )
    return r2.get(path)
  }

  /**
   * Put iceberg data file
   */
  async putIcebergData(doId: string, filename: string, data: ArrayBuffer): Promise<void> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    const path = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'iceberg',
      'data',
      filename
    )
    await r2.put(path, data)
  }

  /**
   * List iceberg metadata files
   */
  async listIcebergMetadata(doId: string): Promise<R2Objects> {
    const r2 = this.ensureR2()
    this.validateSegment(doId, 'doId')
    const prefix = this.buildPath(
      this._claims.pathPrefix,
      'orgs',
      this._claims.orgId,
      'tenants',
      this._claims.tenantId,
      'do',
      doId,
      'iceberg',
      'metadata'
    ) + '/'
    return r2.list({ prefix })
  }
}
