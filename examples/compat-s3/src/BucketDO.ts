/**
 * BucketDO - Durable Object for S3 bucket metadata and ACLs
 *
 * Each bucket gets its own DO instance for:
 * - Metadata storage (creation date, region, owner)
 * - Access control (ACLs, bucket policies)
 * - Versioning configuration
 * - Object listing and indexing
 */

import { DO } from 'dotdo'
import type {
  Bucket,
  BucketOwner,
  AccessControlPolicy,
  Grant,
  Permission,
  CannedACL,
  S3Object,
  BucketVersioningConfiguration,
  ListObjectsV2Request,
  ListObjectsV2Response,
  Env,
} from './types'
import { S3Errors } from './types'

// ============================================================================
// Types
// ============================================================================

interface BucketMetadata extends Bucket {
  acl: AccessControlPolicy
  versioning?: BucketVersioningConfiguration
  policy?: string // JSON bucket policy
  cors?: CorsRule[]
  lifecycle?: LifecycleRule[]
  logging?: LoggingConfiguration
  website?: WebsiteConfiguration
  tags?: Record<string, string>
}

interface CorsRule {
  id?: string
  allowedHeaders?: string[]
  allowedMethods: string[]
  allowedOrigins: string[]
  exposeHeaders?: string[]
  maxAgeSeconds?: number
}

interface LifecycleRule {
  id?: string
  prefix?: string
  status: 'Enabled' | 'Disabled'
  expiration?: { days?: number; date?: string }
  transitions?: Array<{ days?: number; date?: string; storageClass: string }>
  abortIncompleteMultipartUpload?: { daysAfterInitiation: number }
}

interface LoggingConfiguration {
  targetBucket: string
  targetPrefix?: string
}

interface WebsiteConfiguration {
  indexDocument?: string
  errorDocument?: string
  redirectAllRequestsTo?: { hostName: string; protocol?: string }
  routingRules?: Array<{
    condition?: { keyPrefixEquals?: string; httpErrorCodeReturnedEquals?: string }
    redirect: { hostName?: string; protocol?: string; replaceKeyPrefixWith?: string; replaceKeyWith?: string; httpRedirectCode?: string }
  }>
}

interface ObjectMetadataIndex {
  key: string
  size: number
  etag: string
  lastModified: string
  contentType?: string
  storageClass?: string
  owner?: BucketOwner
  versionId?: string
  isLatest?: boolean
  isDeleteMarker?: boolean
}

// ============================================================================
// BucketDO Class
// ============================================================================

export class BucketDO extends DO {
  static readonly $type = 'BucketDO'

  private metadata: BucketMetadata | null = null
  private objectIndex: Map<string, ObjectMetadataIndex> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async onStart() {
    // Load metadata from storage
    const storedMetadata = await this.ctx.storage.get<BucketMetadata>('metadata')
    if (storedMetadata) {
      this.metadata = storedMetadata
    }

    // Load object index
    const storedIndex = await this.ctx.storage.get<Array<[string, ObjectMetadataIndex]>>('objectIndex')
    if (storedIndex) {
      this.objectIndex = new Map(storedIndex)
    }
  }

  private async saveMetadata() {
    if (this.metadata) {
      await this.ctx.storage.put('metadata', this.metadata)
    }
  }

  private async saveObjectIndex() {
    await this.ctx.storage.put('objectIndex', Array.from(this.objectIndex.entries()))
  }

  // ==========================================================================
  // Bucket Operations
  // ==========================================================================

  async createBucket(
    name: string,
    options: {
      region?: string
      owner?: BucketOwner
      acl?: CannedACL
    } = {}
  ): Promise<Bucket> {
    if (this.metadata) {
      throw S3Errors.BucketAlreadyExists(name)
    }

    // Validate bucket name
    if (!this.isValidBucketName(name)) {
      throw S3Errors.InvalidBucketName(name)
    }

    const owner: BucketOwner = options.owner ?? {
      id: crypto.randomUUID(),
      displayName: 'default-owner',
    }

    this.metadata = {
      name,
      creationDate: new Date(),
      region: options.region ?? 'us-east-1',
      owner,
      acl: this.cannedACLToPolicy(options.acl ?? 'private', owner),
    }

    await this.saveMetadata()

    return {
      name: this.metadata.name,
      creationDate: this.metadata.creationDate,
      region: this.metadata.region,
      owner: this.metadata.owner,
    }
  }

  async deleteBucket(): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    // Check if bucket is empty
    if (this.objectIndex.size > 0) {
      throw S3Errors.BucketNotEmpty(this.metadata.name)
    }

    // Clear all storage
    await this.ctx.storage.deleteAll()
    this.metadata = null
    this.objectIndex.clear()
  }

  async headBucket(): Promise<Bucket> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    return {
      name: this.metadata.name,
      creationDate: this.metadata.creationDate,
      region: this.metadata.region,
      owner: this.metadata.owner,
    }
  }

  getBucketMetadata(): BucketMetadata | null {
    return this.metadata
  }

  // ==========================================================================
  // ACL Operations
  // ==========================================================================

  async getBucketAcl(): Promise<AccessControlPolicy> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }
    return this.metadata.acl
  }

  async putBucketAcl(acl: AccessControlPolicy | CannedACL): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    if (typeof acl === 'string') {
      this.metadata.acl = this.cannedACLToPolicy(acl, this.metadata.owner!)
    } else {
      this.metadata.acl = acl
    }

    await this.saveMetadata()
  }

  async getObjectAcl(key: string): Promise<AccessControlPolicy> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    const objectMeta = this.objectIndex.get(key)
    if (!objectMeta) {
      throw S3Errors.NoSuchKey(key)
    }

    // Get object-specific ACL or inherit from bucket
    const objectAcl = await this.ctx.storage.get<AccessControlPolicy>(`acl:${key}`)
    return objectAcl ?? this.metadata.acl
  }

  async putObjectAcl(key: string, acl: AccessControlPolicy | CannedACL): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    const objectMeta = this.objectIndex.get(key)
    if (!objectMeta) {
      throw S3Errors.NoSuchKey(key)
    }

    const owner = objectMeta.owner ?? this.metadata.owner!

    if (typeof acl === 'string') {
      await this.ctx.storage.put(`acl:${key}`, this.cannedACLToPolicy(acl, owner))
    } else {
      await this.ctx.storage.put(`acl:${key}`, acl)
    }
  }

  // ==========================================================================
  // Object Index Operations
  // ==========================================================================

  async indexObject(object: S3Object & { owner?: BucketOwner }): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    this.objectIndex.set(object.key, {
      key: object.key,
      size: object.size,
      etag: object.etag,
      lastModified: object.lastModified.toISOString(),
      contentType: object.contentType,
      storageClass: object.storageClass,
      owner: object.owner,
    })

    await this.saveObjectIndex()
  }

  async removeFromIndex(key: string): Promise<void> {
    this.objectIndex.delete(key)
    await this.ctx.storage.delete(`acl:${key}`)
    await this.saveObjectIndex()
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadataIndex | null> {
    return this.objectIndex.get(key) ?? null
  }

  // ==========================================================================
  // List Objects
  // ==========================================================================

  async listObjectsV2(request: ListObjectsV2Request): Promise<ListObjectsV2Response> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket(request.bucket)
    }

    const prefix = request.prefix ?? ''
    const delimiter = request.delimiter
    const maxKeys = Math.min(request.maxKeys ?? 1000, 1000)
    const startAfter = request.continuationToken
      ? this.decodeContinuationToken(request.continuationToken)
      : request.startAfter ?? ''

    // Get all keys, filter by prefix, sort alphabetically
    let keys = Array.from(this.objectIndex.keys())
      .filter(key => key.startsWith(prefix))
      .filter(key => key > startAfter)
      .sort()

    const commonPrefixes: Set<string> = new Set()
    const contents: S3Object[] = []

    // Process keys
    for (const key of keys) {
      if (delimiter) {
        const keyAfterPrefix = key.slice(prefix.length)
        const delimiterIndex = keyAfterPrefix.indexOf(delimiter)

        if (delimiterIndex >= 0) {
          // This key has a delimiter, add common prefix
          const commonPrefix = prefix + keyAfterPrefix.slice(0, delimiterIndex + 1)
          commonPrefixes.add(commonPrefix)
          continue
        }
      }

      if (contents.length >= maxKeys) {
        break
      }

      const meta = this.objectIndex.get(key)!
      contents.push({
        key: meta.key,
        size: meta.size,
        etag: meta.etag,
        lastModified: new Date(meta.lastModified),
        contentType: meta.contentType,
        storageClass: meta.storageClass as S3Object['storageClass'],
      })
    }

    const isTruncated = keys.length > contents.length + commonPrefixes.size

    return {
      name: this.metadata.name,
      prefix: prefix || undefined,
      delimiter: delimiter || undefined,
      maxKeys,
      isTruncated,
      contents,
      commonPrefixes: Array.from(commonPrefixes).sort().map(p => ({ prefix: p })),
      continuationToken: request.continuationToken,
      nextContinuationToken: isTruncated
        ? this.encodeContinuationToken(contents[contents.length - 1]?.key ?? '')
        : undefined,
      startAfter: request.startAfter,
      keyCount: contents.length,
      encodingType: request.encodingType,
    }
  }

  // ==========================================================================
  // Versioning
  // ==========================================================================

  async getBucketVersioning(): Promise<BucketVersioningConfiguration | null> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }
    return this.metadata.versioning ?? null
  }

  async putBucketVersioning(config: BucketVersioningConfiguration): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    this.metadata.versioning = config
    await this.saveMetadata()
  }

  // ==========================================================================
  // Bucket Policy
  // ==========================================================================

  async getBucketPolicy(): Promise<string | null> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }
    return this.metadata.policy ?? null
  }

  async putBucketPolicy(policy: string): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    // Validate JSON
    try {
      JSON.parse(policy)
    } catch {
      throw new Error('Invalid policy JSON')
    }

    this.metadata.policy = policy
    await this.saveMetadata()
  }

  async deleteBucketPolicy(): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    delete this.metadata.policy
    await this.saveMetadata()
  }

  // ==========================================================================
  // CORS Configuration
  // ==========================================================================

  async getBucketCors(): Promise<CorsRule[] | null> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }
    return this.metadata.cors ?? null
  }

  async putBucketCors(rules: CorsRule[]): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    this.metadata.cors = rules
    await this.saveMetadata()
  }

  async deleteBucketCors(): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    delete this.metadata.cors
    await this.saveMetadata()
  }

  // ==========================================================================
  // Website Configuration
  // ==========================================================================

  async getBucketWebsite(): Promise<WebsiteConfiguration | null> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }
    return this.metadata.website ?? null
  }

  async putBucketWebsite(config: WebsiteConfiguration): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    this.metadata.website = config
    await this.saveMetadata()
  }

  async deleteBucketWebsite(): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    delete this.metadata.website
    await this.saveMetadata()
  }

  // ==========================================================================
  // Tags
  // ==========================================================================

  async getBucketTagging(): Promise<Record<string, string> | null> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }
    return this.metadata.tags ?? null
  }

  async putBucketTagging(tags: Record<string, string>): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    this.metadata.tags = tags
    await this.saveMetadata()
  }

  async deleteBucketTagging(): Promise<void> {
    if (!this.metadata) {
      throw S3Errors.NoSuchBucket('unknown')
    }

    delete this.metadata.tags
    await this.saveMetadata()
  }

  // ==========================================================================
  // Permission Checking
  // ==========================================================================

  checkPermission(
    requesterId: string,
    permission: Permission,
    objectKey?: string
  ): boolean {
    if (!this.metadata) return false

    const acl = this.metadata.acl

    // Owner always has full control
    if (requesterId === acl.owner.id) {
      return true
    }

    // Check grants
    for (const grant of acl.grants) {
      if (this.grantMatchesRequester(grant, requesterId)) {
        if (grant.permission === 'FULL_CONTROL') return true
        if (grant.permission === permission) return true

        // READ includes READ_ACP for objects
        if (permission === 'READ_ACP' && grant.permission === 'READ') return true
      }
    }

    return false
  }

  private grantMatchesRequester(grant: Grant, requesterId: string): boolean {
    const { grantee } = grant

    switch (grantee.type) {
      case 'CanonicalUser':
        return grantee.id === requesterId
      case 'Group':
        // Handle well-known groups
        if (grantee.uri === 'http://acs.amazonaws.com/groups/global/AllUsers') {
          return true
        }
        if (grantee.uri === 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers') {
          return requesterId !== 'anonymous'
        }
        return false
      case 'AmazonCustomerByEmail':
        // Would need email-to-id mapping
        return false
      default:
        return false
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private isValidBucketName(name: string): boolean {
    // S3 bucket naming rules
    if (name.length < 3 || name.length > 63) return false
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false
    if (name.includes('..')) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false // No IP addresses
    return true
  }

  private cannedACLToPolicy(acl: CannedACL, owner: BucketOwner): AccessControlPolicy {
    const grants: Grant[] = []

    switch (acl) {
      case 'private':
        grants.push({
          grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
          permission: 'FULL_CONTROL',
        })
        break

      case 'public-read':
        grants.push(
          {
            grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
            permission: 'FULL_CONTROL',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            permission: 'READ',
          }
        )
        break

      case 'public-read-write':
        grants.push(
          {
            grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
            permission: 'FULL_CONTROL',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            permission: 'READ',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            permission: 'WRITE',
          }
        )
        break

      case 'authenticated-read':
        grants.push(
          {
            grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
            permission: 'FULL_CONTROL',
          },
          {
            grantee: { type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers' },
            permission: 'READ',
          }
        )
        break

      case 'bucket-owner-read':
      case 'bucket-owner-full-control':
        grants.push({
          grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
          permission: 'FULL_CONTROL',
        })
        break

      default:
        grants.push({
          grantee: { type: 'CanonicalUser', id: owner.id, displayName: owner.displayName },
          permission: 'FULL_CONTROL',
        })
    }

    return { owner, grants }
  }

  private encodeContinuationToken(key: string): string {
    return btoa(key)
  }

  private decodeContinuationToken(token: string): string {
    return atob(token)
  }
}
