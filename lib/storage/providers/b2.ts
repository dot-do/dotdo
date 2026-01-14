/**
 * Backblaze B2 Storage Provider
 *
 * Implements the StorageProvider interface for Backblaze B2 Cloud Storage.
 * Uses the B2 API for operations.
 *
 * @module lib/storage/providers/b2
 */

import type {
  StorageProvider,
  StorageProviderType,
  B2ProviderConfig,
  ObjectMetadata,
  WriteOptions,
  ReadOptions,
  WriteResult,
  ReadResult,
  ListOptions,
  ListResult,
  CopyOptions,
  SignedUrlOptions,
  MultipartUpload,
  UploadPart,
} from './interface'

// =============================================================================
// B2 API Types
// =============================================================================

interface B2AuthResponse {
  accountId: string
  authorizationToken: string
  apiUrl: string
  downloadUrl: string
  recommendedPartSize: number
  absoluteMinimumPartSize: number
  s3ApiUrl: string
}

interface B2UploadUrlResponse {
  uploadUrl: string
  authorizationToken: string
}

interface B2FileResponse {
  fileId: string
  fileName: string
  contentLength: number
  contentType: string
  contentSha1: string
  fileInfo: Record<string, string>
  uploadTimestamp: number
}

// =============================================================================
// B2 Provider Implementation
// =============================================================================

/**
 * Backblaze B2 Storage Provider.
 *
 * Implements the StorageProvider interface for Backblaze B2.
 *
 * @example
 * ```typescript
 * const provider = new B2Provider({
 *   type: 'b2',
 *   applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
 *   applicationKey: process.env.B2_APPLICATION_KEY,
 *   bucket: 'my-bucket',
 *   bucketId: 'bucket123',
 * })
 *
 * await provider.put('file.txt', data)
 * const result = await provider.get('file.txt')
 * ```
 */
export class B2Provider implements StorageProvider {
  readonly type: StorageProviderType = 'b2'
  readonly name = 'Backblaze B2'

  private readonly config: B2ProviderConfig
  private readonly bucket: string
  private readonly bucketId: string
  private readonly applicationKeyId: string
  private readonly applicationKey: string

  private authData: B2AuthResponse | null = null
  private authExpiry: number = 0

  constructor(config: B2ProviderConfig) {
    this.config = config
    this.bucket = config.bucket
    this.bucketId = config.bucketId
    this.applicationKeyId = config.applicationKeyId
    this.applicationKey = config.applicationKey
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  private async authorize(): Promise<B2AuthResponse> {
    // Check if we have a valid cached auth
    if (this.authData && Date.now() < this.authExpiry) {
      return this.authData
    }

    const credentials = btoa(`${this.applicationKeyId}:${this.applicationKey}`)

    const response = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 authorization failed: ${response.status} ${error}`)
    }

    this.authData = await response.json() as B2AuthResponse
    // Auth tokens are valid for 24 hours, refresh at 23 hours
    this.authExpiry = Date.now() + 23 * 60 * 60 * 1000

    return this.authData
  }

  private async getUploadUrl(): Promise<B2UploadUrlResponse> {
    const auth = await this.authorize()

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: this.bucketId,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 getUploadUrl failed: ${response.status} ${error}`)
    }

    return response.json() as Promise<B2UploadUrlResponse>
  }

  // -------------------------------------------------------------------------
  // StorageProvider Implementation
  // -------------------------------------------------------------------------

  async put(key: string, data: Uint8Array | ReadableStream, options?: WriteOptions): Promise<WriteResult> {
    // Convert stream to Uint8Array if needed
    let body: Uint8Array
    if (data instanceof ReadableStream) {
      const reader = data.getReader()
      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        if (result.done) {
          done = true
        } else {
          chunks.push(result.value)
        }
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      body = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
    } else {
      body = data
    }

    const uploadUrl = await this.getUploadUrl()

    // Calculate SHA1 hash
    const sha1 = await this.sha1Hex(body)

    const headers: Record<string, string> = {
      Authorization: uploadUrl.authorizationToken,
      'Content-Type': options?.contentType ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'X-Bz-File-Name': encodeURIComponent(key),
      'X-Bz-Content-Sha1': sha1,
    }

    // Add custom metadata as X-Bz-Info-* headers
    if (options?.customMetadata) {
      for (const [k, v] of Object.entries(options.customMetadata)) {
        headers[`X-Bz-Info-${k}`] = encodeURIComponent(v)
      }
    }

    const response = await fetch(uploadUrl.uploadUrl, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 PUT failed: ${response.status} ${error}`)
    }

    const result = await response.json() as B2FileResponse

    return {
      etag: result.contentSha1,
      size: result.contentLength,
      versionId: result.fileId,
    }
  }

  private async sha1Hex(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  async get(key: string, options?: ReadOptions): Promise<ReadResult | null> {
    const auth = await this.authorize()

    const headers: Record<string, string> = {
      Authorization: auth.authorizationToken,
    }

    if (options?.ifNoneMatch) {
      headers['If-None-Match'] = options.ifNoneMatch
    }
    if (options?.ifModifiedSince) {
      headers['If-Modified-Since'] = options.ifModifiedSince.toUTCString()
    }
    if (options?.rangeStart !== undefined) {
      const rangeEnd = options.rangeEnd !== undefined ? options.rangeEnd : ''
      headers['Range'] = `bytes=${options.rangeStart}-${rangeEnd}`
    }

    const url = `${auth.downloadUrl}/file/${this.bucket}/${encodeURIComponent(key)}`

    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    if (response.status === 304) {
      return {
        data: new Uint8Array(0),
        metadata: {
          key,
          size: 0,
          etag: options?.ifNoneMatch ?? '',
        },
        status: 304,
      }
    }

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 GET failed: ${response.status} ${error}`)
    }

    const data = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('Content-Type') ?? undefined
    const contentSha1 = response.headers.get('X-Bz-Content-Sha1') ?? ''
    const fileId = response.headers.get('X-Bz-File-Id') ?? undefined
    const uploadTimestamp = response.headers.get('X-Bz-Upload-Timestamp')

    // Extract custom metadata
    const customMetadata: Record<string, string> = {}
    response.headers.forEach((value, header) => {
      if (header.toLowerCase().startsWith('x-bz-info-')) {
        const metaKey = header.slice('x-bz-info-'.length)
        customMetadata[metaKey] = decodeURIComponent(value)
      }
    })

    return {
      data,
      metadata: {
        key,
        size: data.length,
        etag: contentSha1,
        contentType,
        lastModified: uploadTimestamp ? new Date(parseInt(uploadTimestamp, 10)) : undefined,
        customMetadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
        providerMetadata: { fileId },
      },
    }
  }

  async delete(key: string): Promise<void> {
    const auth = await this.authorize()

    // First, get the file ID
    const fileInfo = await this.head(key)
    if (!fileInfo) {
      return // Already deleted
    }

    const fileId = (fileInfo.providerMetadata as Record<string, unknown>)?.fileId as string
    if (!fileId) {
      // Try to delete by name using hide
      await this.hideFile(key)
      return
    }

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: key,
        fileId,
      }),
    })

    if (!response.ok && response.status !== 404) {
      const error = await response.text()
      throw new Error(`B2 DELETE failed: ${response.status} ${error}`)
    }
  }

  private async hideFile(key: string): Promise<void> {
    const auth = await this.authorize()

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_hide_file`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: this.bucketId,
        fileName: key,
      }),
    })

    if (!response.ok && response.status !== 404) {
      const error = await response.text()
      throw new Error(`B2 hide file failed: ${response.status} ${error}`)
    }
  }

  async exists(key: string): Promise<boolean> {
    const metadata = await this.head(key)
    return metadata !== null
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const auth = await this.authorize()

    // Use list files API with exact match
    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: this.bucketId,
        prefix: key,
        maxFileCount: 1,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 HEAD failed: ${response.status} ${error}`)
    }

    const result = await response.json() as {
      files: Array<{
        fileId: string
        fileName: string
        contentLength: number
        contentType: string
        contentSha1: string
        fileInfo: Record<string, string>
        uploadTimestamp: number
        action: string
      }>
    }

    const file = result.files.find((f) => f.fileName === key && f.action === 'upload')
    if (!file) {
      return null
    }

    return {
      key: file.fileName,
      size: file.contentLength,
      etag: file.contentSha1,
      contentType: file.contentType,
      lastModified: new Date(file.uploadTimestamp),
      customMetadata: file.fileInfo,
      providerMetadata: { fileId: file.fileId },
    }
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const auth = await this.authorize()

    const body: Record<string, unknown> = {
      bucketId: this.bucketId,
      maxFileCount: options?.maxKeys ?? 100,
    }

    if (options?.prefix) {
      body.prefix = options.prefix
    }
    if (options?.delimiter) {
      body.delimiter = options.delimiter
    }
    if (options?.continuationToken) {
      body.startFileName = options.continuationToken
    }
    if (options?.startAfter) {
      body.startFileName = options.startAfter
    }

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 LIST failed: ${response.status} ${error}`)
    }

    const result = await response.json() as {
      files: Array<{
        fileId: string
        fileName: string
        contentLength: number
        contentType: string
        contentSha1: string
        fileInfo: Record<string, string>
        uploadTimestamp: number
        action: string
      }>
      nextFileName: string | null
    }

    const objects: ObjectMetadata[] = result.files
      .filter((f) => f.action === 'upload')
      .map((f) => ({
        key: f.fileName,
        size: f.contentLength,
        etag: f.contentSha1,
        contentType: f.contentType,
        lastModified: new Date(f.uploadTimestamp),
        customMetadata: f.fileInfo,
        providerMetadata: { fileId: f.fileId },
      }))

    // B2 doesn't return prefixes directly, we'd need to compute them
    const prefixes: string[] = []

    return {
      objects,
      prefixes,
      isTruncated: result.nextFileName !== null,
      nextContinuationToken: result.nextFileName ?? undefined,
      keyCount: objects.length,
    }
  }

  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: Error }> }> {
    if (keys.length === 0) {
      return { deleted: [], errors: [] }
    }

    const deleted: string[] = []
    const errors: Array<{ key: string; error: Error }> = []

    // B2 doesn't have batch delete, delete one by one
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.delete(key)
          deleted.push(key)
        } catch (e) {
          errors.push({ key, error: e as Error })
        }
      })
    )

    return { deleted, errors }
  }

  async copy(sourceKey: string, destKey: string, options?: CopyOptions): Promise<WriteResult> {
    const auth = await this.authorize()

    // Get source file info
    const sourceInfo = await this.head(sourceKey)
    if (!sourceInfo) {
      throw new Error(`Source object not found: ${sourceKey}`)
    }

    const sourceFileId = (sourceInfo.providerMetadata as Record<string, unknown>)?.fileId as string
    if (!sourceFileId) {
      throw new Error(`Source file ID not found: ${sourceKey}`)
    }

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_copy_file`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceFileId,
        fileName: destKey,
        destinationBucketId: this.bucketId,
        contentType: options?.contentType,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 COPY failed: ${response.status} ${error}`)
    }

    const result = await response.json() as B2FileResponse

    return {
      etag: result.contentSha1,
      size: result.contentLength,
      versionId: result.fileId,
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const auth = await this.authorize()

    // B2 uses authorization tokens for download URLs
    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_download_authorization`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: this.bucketId,
        fileNamePrefix: key,
        validDurationInSeconds: options.expiresIn,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 getSignedUrl failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { authorizationToken: string }

    // Construct the download URL with auth token
    const downloadUrl = `${auth.downloadUrl}/file/${this.bucket}/${encodeURIComponent(key)}?Authorization=${encodeURIComponent(result.authorizationToken)}`

    return downloadUrl
  }

  async createMultipartUpload(key: string, options?: WriteOptions): Promise<MultipartUpload> {
    const auth = await this.authorize()

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_start_large_file`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: this.bucketId,
        fileName: key,
        contentType: options?.contentType ?? 'application/octet-stream',
        fileInfo: options?.customMetadata,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 createMultipartUpload failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { fileId: string }

    return new B2MultipartUpload(this, key, result.fileId, auth)
  }

  // Internal methods for multipart upload
  async _getUploadPartUrl(fileId: string): Promise<{ uploadUrl: string; authorizationToken: string }> {
    const auth = await this.authorize()

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_part_url`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 getUploadPartUrl failed: ${response.status} ${error}`)
    }

    return response.json() as Promise<{ uploadUrl: string; authorizationToken: string }>
  }

  async _finishLargeFile(fileId: string, partSha1Array: string[]): Promise<WriteResult> {
    const auth = await this.authorize()

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_finish_large_file`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
        partSha1Array,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 finishLargeFile failed: ${response.status} ${error}`)
    }

    const result = await response.json() as B2FileResponse

    return {
      etag: result.contentSha1,
      size: result.contentLength,
      versionId: result.fileId,
    }
  }

  async _cancelLargeFile(fileId: string): Promise<void> {
    const auth = await this.authorize()

    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_cancel_large_file`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
      }),
    })

    if (!response.ok && response.status !== 404) {
      const error = await response.text()
      throw new Error(`B2 cancelLargeFile failed: ${response.status} ${error}`)
    }
  }
}

// =============================================================================
// B2 Multipart Upload Implementation
// =============================================================================

class B2MultipartUpload implements MultipartUpload {
  readonly uploadId: string
  readonly key: string

  private provider: B2Provider
  private fileId: string
  private auth: B2AuthResponse
  private partSha1Array: string[] = []
  private totalSize = 0

  constructor(provider: B2Provider, key: string, fileId: string, auth: B2AuthResponse) {
    this.provider = provider
    this.key = key
    this.fileId = fileId
    this.uploadId = fileId
    this.auth = auth
  }

  async uploadPart(partNumber: number, data: Uint8Array): Promise<UploadPart> {
    const uploadPartUrl = await this.provider._getUploadPartUrl(this.fileId)

    // Calculate SHA1
    const sha1 = await this.sha1Hex(data)

    const response = await fetch(uploadPartUrl.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: uploadPartUrl.authorizationToken,
        'Content-Length': String(data.length),
        'X-Bz-Part-Number': String(partNumber),
        'X-Bz-Content-Sha1': sha1,
      },
      body: data,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`B2 uploadPart failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { contentSha1: string; contentLength: number }

    // Store SHA1 for finish call (index by part number - 1)
    this.partSha1Array[partNumber - 1] = result.contentSha1
    this.totalSize += data.length

    return {
      partNumber,
      etag: result.contentSha1,
      size: result.contentLength,
    }
  }

  private async sha1Hex(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  async complete(parts: UploadPart[]): Promise<WriteResult> {
    // Ensure we have all SHA1 hashes in order
    const sortedParts = parts.sort((a, b) => a.partNumber - b.partNumber)
    const sha1Array = sortedParts.map((p) => p.etag)

    return this.provider._finishLargeFile(this.fileId, sha1Array)
  }

  async abort(): Promise<void> {
    await this.provider._cancelLargeFile(this.fileId)
  }
}
