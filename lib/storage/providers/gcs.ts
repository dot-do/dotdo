/**
 * Google Cloud Storage Provider
 *
 * Implements the StorageProvider interface for Google Cloud Storage.
 * Uses the GCS JSON API with service account authentication.
 *
 * @module lib/storage/providers/gcs
 */

import type {
  StorageProvider,
  StorageProviderType,
  GCSProviderConfig,
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
// GCS Authentication Types
// =============================================================================

interface ServiceAccountCredentials {
  type: string
  project_id: string
  private_key_id?: string
  private_key: string
  client_email: string
  client_id?: string
  auth_uri?: string
  token_uri?: string
}

// =============================================================================
// GCS Provider Implementation
// =============================================================================

/**
 * Google Cloud Storage Provider.
 *
 * Implements the StorageProvider interface for Google Cloud Storage.
 * Supports service account authentication.
 *
 * @example
 * ```typescript
 * const provider = new GCSProvider({
 *   type: 'gcs',
 *   bucket: 'my-bucket',
 *   credentials: process.env.GCS_CREDENTIALS,
 *   projectId: 'my-project',
 * })
 *
 * await provider.put('file.txt', data)
 * const result = await provider.get('file.txt')
 * ```
 */
export class GCSProvider implements StorageProvider {
  readonly type: StorageProviderType = 'gcs'
  readonly name = 'Google Cloud Storage'

  private readonly config: GCSProviderConfig
  private readonly bucket: string
  private readonly credentials: ServiceAccountCredentials
  private readonly projectId: string

  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(config: GCSProviderConfig) {
    this.config = config
    this.bucket = config.bucket

    // Parse credentials
    if (typeof config.credentials === 'string') {
      this.credentials = JSON.parse(config.credentials)
    } else {
      this.credentials = config.credentials as ServiceAccountCredentials
    }

    this.projectId = config.projectId ?? this.credentials.project_id
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Get an OAuth2 access token using service account credentials.
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    // Create JWT
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    }

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: this.credentials.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.full_control',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    const jwt = await this.createJwt(header, payload, this.credentials.private_key)

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GCS OAuth failed: ${response.status} ${error}`)
    }

    const data = await response.json() as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000 // Refresh 1 minute early

    return this.accessToken
  }

  private async createJwt(
    header: Record<string, string>,
    payload: Record<string, unknown>,
    privateKey: string
  ): Promise<string> {
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header))
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload))
    const signatureInput = `${encodedHeader}.${encodedPayload}`

    // Import private key
    const pemContent = privateKey
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '')

    const keyData = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signatureInput)
    )

    const encodedSignature = this.base64UrlEncode(signature)
    return `${signatureInput}.${encodedSignature}`
  }

  private base64UrlEncode(data: string | ArrayBuffer): string {
    let base64: string
    if (typeof data === 'string') {
      base64 = btoa(data)
    } else {
      base64 = btoa(String.fromCharCode(...new Uint8Array(data)))
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  // -------------------------------------------------------------------------
  // API Helpers
  // -------------------------------------------------------------------------

  private getApiUrl(path: string): string {
    return `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o${path}`
  }

  private getUploadUrl(key: string): string {
    return `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`
  }

  private getDownloadUrl(key: string): string {
    return `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}?alt=media`
  }

  // -------------------------------------------------------------------------
  // StorageProvider Implementation
  // -------------------------------------------------------------------------

  async put(key: string, data: Uint8Array | ReadableStream, options?: WriteOptions): Promise<WriteResult> {
    const token = await this.getAccessToken()

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

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(body.length),
    }

    if (options?.contentType) {
      headers['Content-Type'] = options.contentType
    }
    if (options?.cacheControl) {
      headers['Cache-Control'] = options.cacheControl
    }

    // Build metadata for custom properties
    const metadata: Record<string, unknown> = {}
    if (options?.storageClass) {
      metadata.storageClass = options.storageClass
    }
    if (options?.customMetadata) {
      metadata.metadata = options.customMetadata
    }

    const url = this.getUploadUrl(key)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GCS PUT failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { md5Hash: string; size: string; generation: string }

    return {
      etag: result.md5Hash ?? result.generation,
      size: parseInt(result.size, 10),
    }
  }

  async get(key: string, options?: ReadOptions): Promise<ReadResult | null> {
    const token = await this.getAccessToken()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
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

    const url = this.getDownloadUrl(key)

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
      throw new Error(`GCS GET failed: ${response.status} ${error}`)
    }

    const data = new Uint8Array(await response.arrayBuffer())

    // Get metadata
    const metadata = await this.head(key)

    return {
      data,
      metadata: metadata ?? {
        key,
        size: data.length,
        etag: '',
      },
    }
  }

  async delete(key: string): Promise<void> {
    const token = await this.getAccessToken()

    const url = this.getApiUrl(`/${encodeURIComponent(key)}`)

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok && response.status !== 404) {
      const error = await response.text()
      throw new Error(`GCS DELETE failed: ${response.status} ${error}`)
    }
  }

  async exists(key: string): Promise<boolean> {
    const metadata = await this.head(key)
    return metadata !== null
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const token = await this.getAccessToken()

    const url = this.getApiUrl(`/${encodeURIComponent(key)}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GCS HEAD failed: ${response.status} ${error}`)
    }

    const obj = await response.json() as {
      name: string
      size: string
      md5Hash: string
      contentType: string
      updated: string
      storageClass: string
      metadata?: Record<string, string>
    }

    return {
      key: obj.name,
      size: parseInt(obj.size, 10),
      etag: obj.md5Hash,
      contentType: obj.contentType,
      lastModified: new Date(obj.updated),
      storageClass: obj.storageClass,
      customMetadata: obj.metadata,
    }
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const token = await this.getAccessToken()

    const params = new URLSearchParams()
    if (options?.prefix) {
      params.set('prefix', options.prefix)
    }
    if (options?.delimiter) {
      params.set('delimiter', options.delimiter)
    }
    if (options?.maxKeys) {
      params.set('maxResults', String(options.maxKeys))
    }
    if (options?.continuationToken) {
      params.set('pageToken', options.continuationToken)
    }

    const url = `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o?${params.toString()}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GCS LIST failed: ${response.status} ${error}`)
    }

    const result = await response.json() as {
      items?: Array<{
        name: string
        size: string
        md5Hash: string
        contentType: string
        updated: string
        storageClass: string
        metadata?: Record<string, string>
      }>
      prefixes?: string[]
      nextPageToken?: string
    }

    const objects: ObjectMetadata[] = (result.items ?? []).map((item) => ({
      key: item.name,
      size: parseInt(item.size, 10),
      etag: item.md5Hash,
      contentType: item.contentType,
      lastModified: new Date(item.updated),
      storageClass: item.storageClass,
      customMetadata: item.metadata,
    }))

    return {
      objects,
      prefixes: result.prefixes ?? [],
      isTruncated: !!result.nextPageToken,
      nextContinuationToken: result.nextPageToken,
      keyCount: objects.length,
    }
  }

  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: Error }> }> {
    if (keys.length === 0) {
      return { deleted: [], errors: [] }
    }

    const deleted: string[] = []
    const errors: Array<{ key: string; error: Error }> = []

    // GCS doesn't have batch delete, so we delete one by one
    // Could use batch API for optimization
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
    const token = await this.getAccessToken()

    const url = `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(sourceKey)}/copyTo/b/${this.bucket}/o/${encodeURIComponent(destKey)}`

    const body: Record<string, unknown> = {}
    if (options?.contentType) {
      body.contentType = options.contentType
    }
    if (options?.storageClass) {
      body.storageClass = options.storageClass
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Source object not found: ${sourceKey}`)
      }
      const error = await response.text()
      throw new Error(`GCS COPY failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { md5Hash: string; size: string }

    return {
      etag: result.md5Hash,
      size: parseInt(result.size, 10),
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const expiration = now + options.expiresIn

    const method = options.method ?? 'GET'

    // Create canonical request
    const host = 'storage.googleapis.com'
    const path = `/${this.bucket}/${encodeURIComponent(key)}`

    const credentialScope = [
      new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      'auto',
      'storage',
      'goog4_request',
    ].join('/')

    const credential = `${this.credentials.client_email}/${credentialScope}`

    const signedHeaders = 'host'
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

    const queryParams = new URLSearchParams({
      'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
      'X-Goog-Credential': credential,
      'X-Goog-Date': timestamp,
      'X-Goog-Expires': String(options.expiresIn),
      'X-Goog-SignedHeaders': signedHeaders,
    })

    if (options.queryParams) {
      for (const [k, v] of Object.entries(options.queryParams)) {
        queryParams.set(k, v)
      }
    }

    queryParams.sort()

    const canonicalRequest = [
      method,
      path,
      queryParams.toString(),
      `host:${host}`,
      '',
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const canonicalRequestHash = await this.sha256Hex(new TextEncoder().encode(canonicalRequest))

    const stringToSign = ['GOOG4-RSA-SHA256', timestamp, credentialScope, canonicalRequestHash].join('\n')

    // Sign with private key
    const signature = await this.signRsa(stringToSign)

    queryParams.set('X-Goog-Signature', signature)

    return `https://${host}${path}?${queryParams.toString()}`
  }

  private async sha256Hex(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async signRsa(data: string): Promise<string> {
    const pemContent = this.credentials.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '')

    const keyData = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(data)
    )

    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  async createMultipartUpload(key: string, options?: WriteOptions): Promise<MultipartUpload> {
    const token = await this.getAccessToken()

    // GCS uses resumable uploads for multipart
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=resumable&name=${encodeURIComponent(key)}`

    const metadata: Record<string, unknown> = {}
    if (options?.contentType) {
      metadata.contentType = options.contentType
    }
    if (options?.storageClass) {
      metadata.storageClass = options.storageClass
    }
    if (options?.customMetadata) {
      metadata.metadata = options.customMetadata
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': options?.contentType ?? 'application/octet-stream',
      },
      body: JSON.stringify(metadata),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GCS CreateMultipartUpload failed: ${response.status} ${error}`)
    }

    const uploadUri = response.headers.get('Location')
    if (!uploadUri) {
      throw new Error('GCS did not return upload URI')
    }

    return new GCSMultipartUpload(key, uploadUri, token)
  }
}

// =============================================================================
// GCS Multipart Upload Implementation
// =============================================================================

class GCSMultipartUpload implements MultipartUpload {
  readonly uploadId: string
  readonly key: string

  private uploadUri: string
  private token: string
  private uploadedParts: Map<number, { data: Uint8Array; etag: string }> = new Map()
  private totalSize = 0

  constructor(key: string, uploadUri: string, token: string) {
    this.key = key
    this.uploadUri = uploadUri
    this.uploadId = uploadUri // Use URI as upload ID
    this.token = token
  }

  async uploadPart(partNumber: number, data: Uint8Array): Promise<UploadPart> {
    // GCS resumable uploads don't have discrete parts like S3
    // We accumulate parts and upload in complete()
    const etag = `part-${partNumber}-${data.length}`
    this.uploadedParts.set(partNumber, { data, etag })
    this.totalSize += data.length

    return {
      partNumber,
      etag,
      size: data.length,
    }
  }

  async complete(parts: UploadPart[]): Promise<WriteResult> {
    // Combine all parts in order
    const sortedParts = parts.sort((a, b) => a.partNumber - b.partNumber)
    const allData = new Uint8Array(this.totalSize)
    let offset = 0

    for (const part of sortedParts) {
      const partData = this.uploadedParts.get(part.partNumber)
      if (partData) {
        allData.set(partData.data, offset)
        offset += partData.data.length
      }
    }

    // Upload the complete data
    const response = await fetch(this.uploadUri, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Length': String(allData.length),
      },
      body: allData,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GCS complete upload failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { md5Hash: string; size: string }

    return {
      etag: result.md5Hash,
      size: parseInt(result.size, 10),
    }
  }

  async abort(): Promise<void> {
    // GCS resumable uploads automatically expire
    // We can optionally send a DELETE to the upload URI
    try {
      await fetch(this.uploadUri, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      })
    } catch {
      // Ignore errors on abort
    }

    this.uploadedParts.clear()
  }
}
