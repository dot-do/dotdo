// AWS S3 Integration
// Object storage capabilities for the dotdo integration registry (do-h3in)
// Hooks pattern standardized in do-07dn

import type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationResult,
  IntegrationWebhookHandler,
  IntegrationEvent,
  IntegrationHooks,
  MethodCallContext,
} from '../types'
import { successResult, errorResult } from '../registry'

/**
 * S3-specific configuration
 */
export interface S3Config extends IntegrationConfig {
  /** AWS Access Key ID */
  accessKeyId: string
  /** AWS Secret Access Key */
  secretAccessKey: string
  /** AWS Region (e.g., 'us-east-1') */
  region: string
  /** Custom endpoint for S3-compatible services (e.g., R2, MinIO) */
  endpoint?: string
  /** Force path-style URLs instead of virtual-hosted-style */
  forcePathStyle?: boolean
  /** Session token for temporary credentials */
  sessionToken?: string
}

/**
 * S3 Object metadata
 */
export interface S3Object {
  key: string
  size: number
  etag: string
  lastModified: Date
  storageClass?: string
  owner?: {
    id: string
    displayName: string
  }
}

/**
 * S3 Bucket info
 */
export interface S3Bucket {
  name: string
  creationDate: Date
}

/**
 * Put object request
 */
export interface PutObjectRequest {
  /** Bucket name */
  bucket: string
  /** Object key */
  key: string
  /** Object body (string, Buffer, or Uint8Array) */
  body: string | Uint8Array | ArrayBuffer
  /** Content type */
  contentType?: string
  /** Content encoding */
  contentEncoding?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Cache control header */
  cacheControl?: string
  /** Access control list */
  acl?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read'
  /** Storage class */
  storageClass?: 'STANDARD' | 'REDUCED_REDUNDANCY' | 'STANDARD_IA' | 'ONEZONE_IA' | 'GLACIER' | 'DEEP_ARCHIVE'
}

/**
 * Put object response
 */
export interface PutObjectResponse {
  etag: string
  key: string
  versionId?: string
}

/**
 * Get object response
 */
export interface GetObjectResponse {
  body: Uint8Array | string
  contentType: string
  contentLength: number
  etag: string
  lastModified: Date
  metadata?: Record<string, string>
  versionId?: string
}

/**
 * Head object response (metadata only)
 */
export interface HeadObjectResponse {
  contentType: string
  contentLength: number
  etag: string
  lastModified: Date
  metadata?: Record<string, string>
  versionId?: string
  storageClass?: string
}

/**
 * Copy object response
 */
export interface CopyObjectResponse {
  etag: string
  lastModified: Date
  versionId?: string
}

/**
 * List objects options
 */
export interface ListObjectsOptions {
  /** Only return keys that begin with the specified prefix */
  prefix?: string
  /** Limits the response to keys that begin after this value */
  startAfter?: string
  /** Continuation token for pagination */
  continuationToken?: string
  /** Maximum number of keys to return */
  maxKeys?: number
  /** Character used to group keys (usually '/') */
  delimiter?: string
}

/**
 * List objects response
 */
export interface ListObjectsResponse {
  objects: S3Object[]
  commonPrefixes?: string[]
  isTruncated: boolean
  nextContinuationToken?: string
  keyCount: number
}

/**
 * S3 integration methods
 */
export interface S3Methods extends Record<string, (...args: any[]) => Promise<IntegrationResult>> {
  // Object operations
  putObject: (request: PutObjectRequest) => Promise<IntegrationResult<PutObjectResponse>>
  getObject: (bucket: string, key: string) => Promise<IntegrationResult<GetObjectResponse>>
  deleteObject: (bucket: string, key: string) => Promise<IntegrationResult<boolean>>
  headObject: (bucket: string, key: string) => Promise<IntegrationResult<HeadObjectResponse>>
  copyObject: (
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ) => Promise<IntegrationResult<CopyObjectResponse>>
  listObjects: (bucket: string, options: ListObjectsOptions) => Promise<IntegrationResult<ListObjectsResponse>>

  // Presigned URLs
  getSignedUrl: (
    bucket: string,
    key: string,
    operation: 'get' | 'put',
    expiresIn: number
  ) => Promise<IntegrationResult<string>>

  // Bucket operations
  listBuckets: () => Promise<IntegrationResult<S3Bucket[]>>
}

/**
 * AWS S3 Integration
 * Provides object storage capabilities
 *
 * ## Hooks Pattern (do-07dn)
 * S3 doesn't have traditional webhooks, but supports:
 * - Event notifications via SNS/SQS (external webhook endpoint)
 * - onEvent() for internal event emission (e.g., upload completed)
 * - setHooks() for method call observability
 */
export class S3Integration implements Integration<S3Config, S3Methods> {
  readonly name = 'aws-s3'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'AWS S3',
    description: 'Object storage and file management',
    category: 'storage',
    docsUrl: 'https://docs.aws.amazon.com/s3',
    websiteUrl: 'https://aws.amazon.com/s3',
    requiredConfig: ['accessKeyId', 'secretAccessKey', 'region'],
    optionalConfig: ['endpoint', 'forcePathStyle', 'sessionToken'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: S3Config | null = null
  private eventHandlers: IntegrationWebhookHandler[] = []
  private hooks: IntegrationHooks = {}

  get status(): IntegrationStatus {
    return this._status
  }

  async init(config: S3Config): Promise<void> {
    this._status = 'initializing'

    try {
      // Validate required config
      if (!config.accessKeyId) {
        throw new Error('AWS Access Key ID is required')
      }
      if (!config.secretAccessKey) {
        throw new Error('AWS Secret Access Key is required')
      }
      if (!config.region) {
        throw new Error('AWS Region is required')
      }

      this.config = config

      // In a real implementation, you would:
      // 1. Initialize the AWS S3 client
      // 2. Verify credentials by making a test API call
      // 3. Validate the endpoint if custom

      this._status = 'ready'
    } catch (error) {
      this._status = 'error'
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.config = null
    this.eventHandlers = []
    this.hooks = {}
    this._status = 'uninitialized'
  }

  async healthCheck(): Promise<boolean> {
    if (this._status !== 'ready' || !this.config) {
      return false
    }

    // In a real implementation, you would make a test API call
    // For the stub, we just return true
    return true
  }

  /**
   * Methods exposed by this integration
   */
  readonly methods: S3Methods = {
    putObject: async (request) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Validate request
      if (!request.bucket) {
        return errorResult('INVALID_REQUEST', 'Bucket is required')
      }
      if (!request.key) {
        return errorResult('INVALID_REQUEST', 'Object key is required')
      }

      // Stub implementation - returns mock data
      const response: PutObjectResponse = {
        etag: `"${generateId()}"`,
        key: request.key,
        versionId: `v${generateId()}`,
      }

      return successResult(response, `req_${generateId()}`)
    },

    getObject: async (bucket, key) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns mock data
      const response: GetObjectResponse = {
        body: new Uint8Array([72, 101, 108, 108, 111]), // "Hello" in bytes
        contentType: 'application/octet-stream',
        contentLength: 5,
        etag: `"${generateId()}"`,
        lastModified: new Date(),
        metadata: {},
      }

      return successResult(response, `req_${generateId()}`)
    },

    deleteObject: async (bucket, key) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns success
      return successResult(true, `req_${generateId()}`)
    },

    headObject: async (bucket, key) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns mock data
      const response: HeadObjectResponse = {
        contentType: 'application/octet-stream',
        contentLength: 1024,
        etag: `"${generateId()}"`,
        lastModified: new Date(),
        metadata: {},
        storageClass: 'STANDARD',
      }

      return successResult(response, `req_${generateId()}`)
    },

    copyObject: async (sourceBucket, sourceKey, destBucket, destKey) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns mock data
      const response: CopyObjectResponse = {
        etag: `"${generateId()}"`,
        lastModified: new Date(),
      }

      return successResult(response, `req_${generateId()}`)
    },

    listObjects: async (bucket, options) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns mock data
      const objects: S3Object[] = [
        {
          key: `${options.prefix || ''}file1.txt`,
          size: 1024,
          etag: `"${generateId()}"`,
          lastModified: new Date(),
          storageClass: 'STANDARD',
        },
        {
          key: `${options.prefix || ''}file2.txt`,
          size: 2048,
          etag: `"${generateId()}"`,
          lastModified: new Date(),
          storageClass: 'STANDARD',
        },
      ]

      // Apply maxKeys limit
      const maxKeys = options.maxKeys || 1000
      const limitedObjects = objects.slice(0, maxKeys)

      const response: ListObjectsResponse = {
        objects: limitedObjects,
        isTruncated: objects.length > maxKeys,
        keyCount: limitedObjects.length,
      }

      // Only set commonPrefixes if delimiter is provided
      if (options.delimiter) {
        response.commonPrefixes = [`${options.prefix || ''}subfolder/`]
      }

      return successResult(response, `req_${generateId()}`)
    },

    getSignedUrl: async (bucket, key, operation, expiresIn) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns mock signed URL
      const baseUrl = this.config.endpoint || `https://${bucket}.s3.${this.config.region}.amazonaws.com`
      const timestamp = Date.now()
      const signature = generateId()

      const signedUrl = `${baseUrl}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${this.config.accessKeyId}%2F${new Date().toISOString().slice(0, 10).replace(/-/g, '')}%2F${this.config.region}%2Fs3%2Faws4_request&X-Amz-Date=${timestamp}&X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=host&X-Amz-Signature=${signature}`

      return successResult(signedUrl, `req_${generateId()}`)
    },

    listBuckets: async () => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'S3 integration is not initialized')
      }

      // Stub implementation - returns mock data
      const buckets: S3Bucket[] = [
        {
          name: 'my-bucket-1',
          creationDate: new Date('2024-01-01'),
        },
        {
          name: 'my-bucket-2',
          creationDate: new Date('2024-06-15'),
        },
      ]

      return successResult(buckets, `req_${generateId()}`)
    },
  }

  // ============================================================================
  // EVENT HOOKS (do-07dn)
  // S3 event notifications are typically delivered via SNS/SQS.
  // This handleWebhook processes SNS-wrapped S3 events.
  // ============================================================================

  /**
   * Handle incoming S3 event notifications via SNS webhook.
   * AWS S3 sends events to SNS, which can be configured to POST to this endpoint.
   */
  async handleWebhook(request: Request): Promise<Response> {
    if (this._status !== 'ready' || !this.config) {
      return new Response('Integration not initialized', { status: 503 })
    }

    try {
      const body = await request.text()
      const snsMessage = JSON.parse(body) as {
        Type: string
        Message: string
        MessageId: string
        TopicArn?: string
        SubscribeURL?: string
      }

      // Handle SNS subscription confirmation
      if (snsMessage.Type === 'SubscriptionConfirmation' && snsMessage.SubscribeURL) {
        // In production, you would fetch the SubscribeURL to confirm
        return new Response(JSON.stringify({ status: 'subscription_pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Handle S3 event notification
      if (snsMessage.Type === 'Notification') {
        const s3Event = JSON.parse(snsMessage.Message) as {
          Records?: Array<{
            eventName: string
            s3: {
              bucket: { name: string }
              object: { key: string; size?: number }
            }
          }>
        }

        if (s3Event.Records) {
          for (const record of s3Event.Records) {
            const integrationEvent: IntegrationEvent = {
              integration: this.name,
              type: record.eventName, // e.g., 's3:ObjectCreated:Put'
              payload: record,
              timestamp: new Date(),
              webhookId: snsMessage.MessageId,
            }

            // Call all registered handlers
            for (const handler of this.eventHandlers) {
              await handler(integrationEvent)
            }
          }
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('S3 webhook error:', error)
      return new Response('Webhook error', { status: 400 })
    }
  }

  /**
   * Register a handler for S3 events.
   * Events include object created, deleted, etc.
   */
  onEvent(handler: IntegrationWebhookHandler): void {
    this.eventHandlers.push(handler)
  }

  /**
   * Emit an internal event (e.g., after an upload completes).
   * This allows method implementations to notify listeners.
   */
  private async emitEvent(type: string, payload: unknown): Promise<void> {
    const event: IntegrationEvent = {
      integration: this.name,
      type,
      payload,
      timestamp: new Date(),
    }

    for (const handler of this.eventHandlers) {
      try {
        await handler(event)
      } catch (error) {
        // Call error hook if configured
        if (this.hooks.onError) {
          await this.hooks.onError(
            { code: 'EVENT_HANDLER_ERROR', message: String(error), originalError: error },
            { integration: this.name, method: 'emitEvent' }
          )
        }
      }
    }
  }

  // ============================================================================
  // OBSERVABILITY HOOKS (do-07dn)
  // ============================================================================

  /**
   * Configure observability hooks for method calls and errors.
   */
  setHooks(hooks: IntegrationHooks): void {
    this.hooks = hooks
  }

  /**
   * Helper to wrap method calls with hooks.
   * Call this at the start and end of method implementations for full observability.
   */
  private async invokeWithHooks<T>(
    method: string,
    args: unknown[],
    fn: () => Promise<IntegrationResult<T>>
  ): Promise<IntegrationResult<T>> {
    const context: MethodCallContext = {
      method,
      args,
      timestamp: new Date(),
    }

    // Call before hook
    if (this.hooks.onMethodCall?.before) {
      await this.hooks.onMethodCall.before(context)
    }

    let result: IntegrationResult<T>
    try {
      result = await fn()
    } catch (error) {
      result = errorResult('UNEXPECTED_ERROR', String(error), error)
    }

    // Call after hook
    if (this.hooks.onMethodCall?.after) {
      await this.hooks.onMethodCall.after(context, result as IntegrationResult)
    }

    // Call error hook on failure
    if (!result.success && this.hooks.onError) {
      await this.hooks.onError(result.error!, { integration: this.name, method, args })
    }

    return result
  }
}

/**
 * Generate a random ID for stub responses
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

/**
 * Factory function for creating S3 integration
 */
export function createS3Integration(): S3Integration {
  return new S3Integration()
}

/**
 * Default export
 */
export default S3Integration
