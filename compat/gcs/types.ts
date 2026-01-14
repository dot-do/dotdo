/**
 * @dotdo/gcs/types - Type definitions for GCS SDK Compat Layer
 *
 * Google Cloud Storage compatible type definitions for storage operations.
 *
 * @see https://cloud.google.com/storage/docs/json_api/v1
 */

// =============================================================================
// Storage Class Types
// =============================================================================

export type StorageClass =
  | 'STANDARD'
  | 'NEARLINE'
  | 'COLDLINE'
  | 'ARCHIVE'
  | 'MULTI_REGIONAL'
  | 'REGIONAL'
  | 'DURABLE_REDUCED_AVAILABILITY'

// =============================================================================
// Client Configuration
// =============================================================================

export interface StorageOptions {
  /** GCP Project ID */
  projectId?: string
  /** Service account credentials */
  credentials?: {
    client_email?: string
    private_key?: string
    type?: string
  }
  /** Path to service account key file */
  keyFilename?: string
  /** Custom API endpoint */
  apiEndpoint?: string
  /** Use emulator for testing */
  useEmulator?: boolean
  /** Timeout for requests in milliseconds */
  timeout?: number
  /** Retry configuration */
  retryOptions?: {
    maxRetries?: number
    retryDelayMultiplier?: number
    totalTimeout?: number
    maxRetryDelay?: number
    autoRetry?: boolean
    idempotencyStrategy?: 'RetryConditional' | 'RetryAlways' | 'RetryNever'
  }
  /** User agent string */
  userAgent?: string
}

export interface ExtendedStorageOptions extends StorageOptions {
  /** R2 bucket binding for production use */
  r2Bucket?: R2Bucket
  /** Use in-memory storage (for testing) */
  useMemoryStorage?: boolean
}

// =============================================================================
// Bucket Types
// =============================================================================

export interface CreateBucketOptions {
  /** Location/region for the bucket */
  location?: string
  /** Storage class for the bucket */
  storageClass?: StorageClass
  /** Versioning configuration */
  versioning?: { enabled: boolean }
  /** Custom labels */
  labels?: Record<string, string>
  /** Predefined ACL */
  predefinedAcl?: PredefinedBucketAcl
  /** Predefined default object ACL */
  predefinedDefaultObjectAcl?: PredefinedObjectAcl
  /** Enable uniform bucket-level access */
  iamConfiguration?: {
    uniformBucketLevelAccess?: {
      enabled: boolean
      lockedTime?: string
    }
    publicAccessPrevention?: 'enforced' | 'inherited'
  }
  /** CORS configuration */
  cors?: CorsConfiguration[]
  /** Lifecycle rules */
  lifecycle?: LifecycleRule[]
  /** Website configuration */
  website?: {
    mainPageSuffix?: string
    notFoundPage?: string
  }
  /** Logging configuration */
  logging?: {
    logBucket?: string
    logObjectPrefix?: string
  }
  /** Retention policy */
  retentionPolicy?: {
    retentionPeriod: string
    effectiveTime?: string
    isLocked?: boolean
  }
  /** Autoclass configuration */
  autoclass?: {
    enabled: boolean
    toggleTime?: string
  }
  /** RPO (Recovery Point Objective) */
  rpo?: 'DEFAULT' | 'ASYNC_TURBO'
}

export interface GetBucketsOptions {
  /** Filter by name prefix */
  prefix?: string
  /** Maximum results per page */
  maxResults?: number
  /** Page token for pagination */
  pageToken?: string
  /** Whether to auto-paginate */
  autoPaginate?: boolean
  /** Project to list buckets for */
  project?: string
  /** Include user project */
  userProject?: string
}

export interface BucketMetadata {
  /** Bucket ID (same as name) */
  id?: string
  /** Bucket name */
  name?: string
  /** Self link URL */
  selfLink?: string
  /** Project number */
  projectNumber?: string
  /** Metageneration */
  metageneration?: string
  /** Location */
  location?: string
  /** Location type (region, dual-region, multi-region) */
  locationType?: string
  /** Storage class */
  storageClass?: StorageClass
  /** ETag */
  etag?: string
  /** Creation timestamp */
  timeCreated?: string
  /** Last update timestamp */
  updated?: string
  /** Custom labels */
  labels?: Record<string, string>
  /** Versioning state */
  versioning?: { enabled: boolean }
  /** CORS configuration */
  cors?: CorsConfiguration[]
  /** Lifecycle configuration */
  lifecycle?: { rule: LifecycleRule[] }
  /** Website configuration */
  website?: {
    mainPageSuffix?: string
    notFoundPage?: string
  }
  /** Logging configuration */
  logging?: {
    logBucket?: string
    logObjectPrefix?: string
  }
  /** Default event-based hold */
  defaultEventBasedHold?: boolean
  /** IAM configuration */
  iamConfiguration?: {
    uniformBucketLevelAccess?: {
      enabled: boolean
      lockedTime?: string
    }
    publicAccessPrevention?: string
  }
  /** Retention policy */
  retentionPolicy?: {
    retentionPeriod: string
    effectiveTime?: string
    isLocked?: boolean
  }
  /** RPO */
  rpo?: string
  /** Owner */
  owner?: {
    entity?: string
    entityId?: string
  }
  /** ACL */
  acl?: BucketAccessControl[]
  /** Default object ACL */
  defaultObjectAcl?: ObjectAccessControl[]
}

// =============================================================================
// File/Object Types
// =============================================================================

export interface GetFilesOptions {
  /** Filter by prefix */
  prefix?: string
  /** Delimiter for "folder" simulation */
  delimiter?: string
  /** Maximum results per page */
  maxResults?: number
  /** Page token for pagination */
  pageToken?: string
  /** Whether to auto-paginate */
  autoPaginate?: boolean
  /** Include object versions */
  versions?: boolean
  /** Start offset (list objects with names >= this) */
  startOffset?: string
  /** End offset (list objects with names < this) */
  endOffset?: string
  /** Include trailing delimiters */
  includeTrailingDelimiter?: boolean
  /** Match glob pattern */
  matchGlob?: string
  /** User project for billing */
  userProject?: string
}

export interface GetFilesResponse {
  /** Prefixes (common "folders") */
  prefixes?: string[]
  /** Next page token */
  nextPageToken?: string
}

export interface FileMetadata {
  /** Object ID */
  id?: string
  /** Object name/key */
  name?: string
  /** Bucket name */
  bucket?: string
  /** Generation number */
  generation?: string
  /** Metageneration number */
  metageneration?: string
  /** Content type */
  contentType?: string
  /** Object size in bytes */
  size?: string
  /** MD5 hash (base64) */
  md5Hash?: string
  /** CRC32c checksum (base64) */
  crc32c?: string
  /** ETag */
  etag?: string
  /** Creation timestamp */
  timeCreated?: string
  /** Last update timestamp */
  updated?: string
  /** Storage class */
  storageClass?: StorageClass
  /** Time storage class was updated */
  timeStorageClassUpdated?: string
  /** Cache-Control header */
  cacheControl?: string
  /** Content-Disposition header */
  contentDisposition?: string
  /** Content-Encoding header */
  contentEncoding?: string
  /** Content-Language header */
  contentLanguage?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Media link for download */
  mediaLink?: string
  /** Self link */
  selfLink?: string
  /** Owner */
  owner?: {
    entity?: string
    entityId?: string
  }
  /** ACL */
  acl?: ObjectAccessControl[]
  /** Component count (for composite objects) */
  componentCount?: number
  /** KMS key name */
  kmsKeyName?: string
  /** Customer-supplied encryption key info */
  customerEncryption?: {
    encryptionAlgorithm: string
    keySha256: string
  }
  /** Event-based hold */
  eventBasedHold?: boolean
  /** Temporary hold */
  temporaryHold?: boolean
  /** Retention expiration time */
  retentionExpirationTime?: string
  /** Time deleted (for soft-deleted objects) */
  timeDeleted?: string
  /** Custom time */
  customTime?: string
}

export interface SaveOptions {
  /** Content type */
  contentType?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Whether to use resumable upload */
  resumable?: boolean
  /** Whether to gzip content */
  gzip?: boolean | 'auto'
  /** Predefined ACL */
  predefinedAcl?: PredefinedObjectAcl
  /** Make object public */
  public?: boolean
  /** Make object private */
  private?: boolean
  /** Validation strategy */
  validation?: 'md5' | 'crc32c' | false
  /** Custom user project */
  userProject?: string
  /** Cache control */
  cacheControl?: string
  /** Content disposition */
  contentDisposition?: string
  /** Content encoding */
  contentEncoding?: string
  /** Content language */
  contentLanguage?: string
  /** KMS key name */
  kmsKeyName?: string
  /** If generation match */
  ifGenerationMatch?: number
  /** If generation not match */
  ifGenerationNotMatch?: number
  /** If metageneration match */
  ifMetagenerationMatch?: number
  /** If metageneration not match */
  ifMetagenerationNotMatch?: number
  /** Content timeout */
  timeout?: number
}

export interface SetMetadataOptions {
  /** Content type */
  contentType?: string
  /** Cache-Control header */
  cacheControl?: string
  /** Content-Disposition header */
  contentDisposition?: string
  /** Content-Encoding header */
  contentEncoding?: string
  /** Content-Language header */
  contentLanguage?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Custom time */
  customTime?: string | Date
  /** Event-based hold */
  eventBasedHold?: boolean
  /** Temporary hold */
  temporaryHold?: boolean
  /** Predefined ACL */
  predefinedAcl?: PredefinedObjectAcl
  /** If generation match */
  ifGenerationMatch?: number
  /** If generation not match */
  ifGenerationNotMatch?: number
  /** If metageneration match */
  ifMetagenerationMatch?: number
  /** If metageneration not match */
  ifMetagenerationNotMatch?: number
  /** User project */
  userProject?: string
}

export interface CopyOptions {
  /** Token for resuming copy */
  token?: string
  /** Destination bucket */
  destinationBucket?: string
  /** Destination key */
  destinationKey?: string
  /** Keep original ACL */
  keepOriginalAcl?: boolean
  /** Predefined ACL for destination */
  predefinedAcl?: PredefinedObjectAcl
  /** Destination metadata */
  metadata?: Record<string, string>
  /** Content type */
  contentType?: string
  /** User project */
  userProject?: string
  /** If source generation match */
  ifSourceGenerationMatch?: number
  /** If source generation not match */
  ifSourceGenerationNotMatch?: number
  /** If source metageneration match */
  ifSourceMetagenerationMatch?: number
  /** If source metageneration not match */
  ifSourceMetagenerationNotMatch?: number
  /** If generation match */
  ifGenerationMatch?: number
  /** If generation not match */
  ifGenerationNotMatch?: number
  /** If metageneration match */
  ifMetagenerationMatch?: number
  /** If metageneration not match */
  ifMetagenerationNotMatch?: number
}

export interface DownloadOptions {
  /** File destination path */
  destination?: string
  /** Start byte for range request */
  start?: number
  /** End byte for range request */
  end?: number
  /** Whether to decompress gzip */
  decompress?: boolean
  /** If generation match */
  ifGenerationMatch?: number
  /** If generation not match */
  ifGenerationNotMatch?: number
  /** If metageneration match */
  ifMetagenerationMatch?: number
  /** If metageneration not match */
  ifMetagenerationNotMatch?: number
  /** User project */
  userProject?: string
  /** Validation strategy */
  validation?: 'md5' | 'crc32c' | false
}

// =============================================================================
// Signed URL Types
// =============================================================================

export interface SignedUrlConfig {
  /** Signature version: v2 or v4 */
  version?: 'v2' | 'v4'
  /** Action: read, write, delete, resumable */
  action: 'read' | 'write' | 'delete' | 'resumable'
  /** Expiration time (timestamp or Date) */
  expires: number | Date
  /** Content type for uploads */
  contentType?: string
  /** Response Content-Disposition header */
  responseDisposition?: string
  /** Response Content-Type header */
  responseType?: string
  /** Custom CNAME */
  cname?: string
  /** Use virtual hosted style */
  virtualHostedStyle?: boolean
  /** Extension headers to sign */
  extensionHeaders?: Record<string, string>
  /** Query string parameters */
  queryParams?: Record<string, string>
  /** Content MD5 */
  contentMd5?: string
  /** Accessible at time */
  accessibleAt?: Date
  /** Prompt save as filename */
  promptSaveAs?: string
}

export interface GenerateSignedPostPolicyV4Options {
  /** Expiration timestamp or Date */
  expires: number | Date
  /** Content type */
  contentType?: string
  /** Conditions for the policy */
  conditions?: PostPolicyCondition[]
  /** Fields to include */
  fields?: Record<string, string>
  /** Virtual hosted style */
  virtualHostedStyle?: boolean
}

export type PostPolicyCondition =
  | ['eq', string, string]
  | ['starts-with', string, string]
  | ['content-length-range', number, number]
  | Record<string, string>

export interface SignedPostPolicyV4 {
  /** URL to POST to */
  url: string
  /** Fields to include in form */
  fields: Record<string, string>
}

// =============================================================================
// Resumable Upload Types
// =============================================================================

export interface CreateResumableUploadOptions {
  /** Content type */
  contentType?: string
  /** Origin for CORS */
  origin?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Predefined ACL */
  predefinedAcl?: PredefinedObjectAcl
  /** User project */
  userProject?: string
  /** KMS key name */
  kmsKeyName?: string
  /** If generation match */
  ifGenerationMatch?: number
  /** If generation not match */
  ifGenerationNotMatch?: number
  /** If metageneration match */
  ifMetagenerationMatch?: number
  /** If metageneration not match */
  ifMetagenerationNotMatch?: number
  /** Chunk size */
  chunkSize?: number
}

export interface ResumableUploadOptions {
  /** Byte offset to resume from */
  offset?: number
  /** Whether this is a partial upload */
  isPartial?: boolean
  /** Last byte indicator */
  lastByte?: number
}

// =============================================================================
// ACL Types
// =============================================================================

export type PredefinedBucketAcl =
  | 'authenticatedRead'
  | 'private'
  | 'projectPrivate'
  | 'publicRead'
  | 'publicReadWrite'

export type PredefinedObjectAcl =
  | 'authenticatedRead'
  | 'bucketOwnerFullControl'
  | 'bucketOwnerRead'
  | 'private'
  | 'projectPrivate'
  | 'publicRead'

export interface BucketAccessControl {
  /** Access control entity */
  entity: string
  /** Entity ID */
  entityId?: string
  /** Role */
  role: 'OWNER' | 'READER' | 'WRITER'
  /** Bucket name */
  bucket?: string
  /** Email */
  email?: string
  /** Domain */
  domain?: string
  /** Project team */
  projectTeam?: {
    projectNumber: string
    team: 'editors' | 'owners' | 'viewers'
  }
  /** ETag */
  etag?: string
  /** ID */
  id?: string
  /** Self link */
  selfLink?: string
}

export interface ObjectAccessControl {
  /** Access control entity */
  entity: string
  /** Entity ID */
  entityId?: string
  /** Role */
  role: 'OWNER' | 'READER'
  /** Bucket name */
  bucket?: string
  /** Object name */
  object?: string
  /** Generation */
  generation?: string
  /** Email */
  email?: string
  /** Domain */
  domain?: string
  /** Project team */
  projectTeam?: {
    projectNumber: string
    team: 'editors' | 'owners' | 'viewers'
  }
  /** ETag */
  etag?: string
  /** ID */
  id?: string
  /** Self link */
  selfLink?: string
}

export interface AddAclOptions {
  /** Entity to add */
  entity: string
  /** Role to assign */
  role: 'OWNER' | 'READER' | 'WRITER'
  /** Generation (for object ACL) */
  generation?: number
  /** User project */
  userProject?: string
}

// =============================================================================
// IAM Types
// =============================================================================

export interface Policy {
  /** Policy version */
  version?: number
  /** Resource etag */
  etag?: string
  /** Bindings */
  bindings: PolicyBinding[]
}

export interface PolicyBinding {
  /** Role */
  role: string
  /** Members */
  members: string[]
  /** Condition */
  condition?: PolicyCondition
}

export interface PolicyCondition {
  /** Title */
  title?: string
  /** Description */
  description?: string
  /** Expression */
  expression: string
}

export interface TestIamPermissionsOptions {
  /** User project */
  userProject?: string
}

// =============================================================================
// CORS Types
// =============================================================================

export interface CorsConfiguration {
  /** Allowed origins */
  origin?: string[]
  /** Allowed methods */
  method?: ('GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS')[]
  /** Allowed request headers */
  requestHeader?: string[]
  /** Exposed response headers */
  responseHeader?: string[]
  /** Max age in seconds */
  maxAgeSeconds?: number
}

// =============================================================================
// Lifecycle Types
// =============================================================================

export interface LifecycleRule {
  /** Action to take */
  action: LifecycleAction
  /** Condition for the rule */
  condition: LifecycleCondition
}

export interface LifecycleAction {
  /** Action type */
  type: 'Delete' | 'SetStorageClass' | 'AbortIncompleteMultipartUpload'
  /** Storage class for SetStorageClass action */
  storageClass?: StorageClass
}

export interface LifecycleCondition {
  /** Age in days */
  age?: number
  /** Created before date */
  createdBefore?: string
  /** Custom time before */
  customTimeBefore?: string
  /** Days since custom time */
  daysSinceCustomTime?: number
  /** Days since noncurrent time */
  daysSinceNoncurrentTime?: number
  /** Is live */
  isLive?: boolean
  /** Matches pattern */
  matchesPattern?: string
  /** Matches prefix */
  matchesPrefix?: string[]
  /** Matches storage class */
  matchesStorageClass?: StorageClass[]
  /** Matches suffix */
  matchesSuffix?: string[]
  /** Noncurrent time before */
  noncurrentTimeBefore?: string
  /** Number of newer versions */
  numNewerVersions?: number
}

// =============================================================================
// Notification Types
// =============================================================================

export interface NotificationConfig {
  /** Topic name */
  topic: string
  /** Event types to trigger */
  eventTypes?: NotificationEventType[]
  /** Object name prefix filter */
  objectNamePrefix?: string
  /** Custom attributes */
  customAttributes?: Record<string, string>
  /** Payload format */
  payloadFormat?: 'JSON_API_V1' | 'NONE'
}

export type NotificationEventType =
  | 'OBJECT_FINALIZE'
  | 'OBJECT_METADATA_UPDATE'
  | 'OBJECT_DELETE'
  | 'OBJECT_ARCHIVE'

export interface NotificationMetadata {
  /** Notification ID */
  id?: string
  /** Topic */
  topic?: string
  /** Event types */
  eventTypes?: NotificationEventType[]
  /** Object name prefix */
  objectNamePrefix?: string
  /** Custom attributes */
  customAttributes?: Record<string, string>
  /** Payload format */
  payloadFormat?: string
  /** ETag */
  etag?: string
  /** Self link */
  selfLink?: string
}

// =============================================================================
// HmacKey Types
// =============================================================================

export interface HmacKeyMetadata {
  /** Access ID */
  accessId?: string
  /** ETag */
  etag?: string
  /** ID */
  id?: string
  /** Project ID */
  projectId?: string
  /** Service account email */
  serviceAccountEmail?: string
  /** State */
  state?: 'ACTIVE' | 'INACTIVE' | 'DELETED'
  /** Creation time */
  timeCreated?: string
  /** Last update time */
  updated?: string
}

export interface CreateHmacKeyOptions {
  /** Project ID */
  projectId?: string
  /** Service account email */
  serviceAccountEmail: string
  /** User project */
  userProject?: string
}

// =============================================================================
// Internal Types
// =============================================================================

export interface InternalBucket {
  name: string
  metadata: BucketMetadata
  files: Map<string, InternalFile>
  notifications: Map<string, NotificationMetadata>
}

export interface InternalFile {
  name: string
  bucket: string
  body: Uint8Array
  metadata: FileMetadata
  versions?: InternalFileVersion[]
}

export interface InternalFileVersion {
  generation: string
  body: Uint8Array
  metadata: FileMetadata
  isLive: boolean
  deletedTime?: Date
}

export interface InternalResumableUpload {
  uri: string
  bucket: string
  key: string
  contentType?: string
  customMetadata?: Record<string, string>
  chunks: Uint8Array[]
  totalSize: number
  cancelled: boolean
  createdAt: Date
  expiresAt: Date
}

// =============================================================================
// Response Types
// =============================================================================

export type GetMetadataResponse<T = FileMetadata | BucketMetadata> = [T]

export interface MakeFilePublicResponse {
  /** Whether the operation succeeded */
  success: boolean
  /** URL to access the public file */
  url?: string
}
