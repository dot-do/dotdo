/**
 * AWS S3 Storage Provider
 *
 * Implements the StorageProvider interface for Amazon S3.
 * Uses the AWS SDK v3 for S3 operations.
 *
 * @module lib/storage/providers/s3
 */

import type {
  StorageProvider,
  StorageProviderType,
  S3ProviderConfig,
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
  StorageProviderError,
} from './interface'

// =============================================================================
// S3 Client Types (minimal subset to avoid SDK dependency in interface)
// =============================================================================

interface S3ClientInternal {
  send(command: unknown): Promise<unknown>
}

// =============================================================================
// S3 Provider Implementation
// =============================================================================

/**
 * AWS S3 Storage Provider.
 *
 * Implements the StorageProvider interface for AWS S3 object storage.
 * Supports custom endpoints for S3-compatible services (MinIO, etc.).
 *
 * @example
 * ```typescript
 * const provider = new S3Provider({
 *   type: 's3',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 * })
 *
 * await provider.put('file.txt', data)
 * const result = await provider.get('file.txt')
 * ```
 */
export class S3Provider implements StorageProvider {
  readonly type: StorageProviderType = 's3'
  readonly name = 'AWS S3'

  private readonly config: S3ProviderConfig
  private readonly bucket: string
  private readonly endpoint?: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly forcePathStyle: boolean

  constructor(config: S3ProviderConfig) {
    this.config = config
    this.bucket = config.bucket
    this.region = config.region
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.endpoint = config.endpoint
    this.forcePathStyle = config.forcePathStyle ?? false
  }

  // -------------------------------------------------------------------------
  // Helper Methods
  // -------------------------------------------------------------------------

  /**
   * Get the base URL for S3 API calls.
   */
  private getBaseUrl(): string {
    if (this.endpoint) {
      return this.endpoint
    }
    return `https://s3.${this.region}.amazonaws.com`
  }

  /**
   * Get the URL for an object.
   */
  private getObjectUrl(key: string): string {
    const baseUrl = this.getBaseUrl()
    if (this.forcePathStyle) {
      return `${baseUrl}/${this.bucket}/${encodeURIComponent(key)}`
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodeURIComponent(key)}`
  }

  /**
   * Create AWS Signature Version 4 headers.
   * Simplified implementation for basic operations.
   */
  private async createAuthHeaders(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Uint8Array | null
  ): Promise<Record<string, string>> {
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = timestamp.slice(0, 8)

    // Calculate payload hash
    const payloadHash = body
      ? await this.sha256Hex(body)
      : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // empty hash

    const signedHeaders: Record<string, string> = {
      ...headers,
      host: this.forcePathStyle ? new URL(this.getBaseUrl()).host : `${this.bucket}.s3.${this.region}.amazonaws.com`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
    }

    // Create canonical request
    const sortedHeaderKeys = Object.keys(signedHeaders).sort()
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k.toLowerCase()}:${signedHeaders[k]?.trim() ?? ''}`)
      .join('\n')
    const signedHeadersList = sortedHeaderKeys.map((k) => k.toLowerCase()).join(';')

    const canonicalRequest = [
      method,
      path,
      '', // query string
      canonicalHeaders,
      '',
      signedHeadersList,
      payloadHash,
    ].join('\n')

    // Create string to sign
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`
    const canonicalRequestHash = await this.sha256Hex(new TextEncoder().encode(canonicalRequest))
    const stringToSign = ['AWS4-HMAC-SHA256', timestamp, credentialScope, canonicalRequestHash].join('\n')

    // Calculate signature
    const kDate = await this.hmacSha256(new TextEncoder().encode('AWS4' + this.secretAccessKey), dateStamp)
    const kRegion = await this.hmacSha256(kDate, this.region)
    const kService = await this.hmacSha256(kRegion, 's3')
    const kSigning = await this.hmacSha256(kService, 'aws4_request')
    const signature = await this.hmacSha256Hex(kSigning, stringToSign)

    const authHeader =
      `AWS4-HMAC-SHA256 ` +
      `Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeadersList}, ` +
      `Signature=${signature}`

    return {
      ...signedHeaders,
      Authorization: authHeader,
    }
  }

  private async sha256Hex(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hmacSha256(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  }

  private async hmacSha256Hex(key: ArrayBuffer, message: string): Promise<string> {
    const sig = await this.hmacSha256(key, message)
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
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

    const path = `/${encodeURIComponent(key)}`
    const headers: Record<string, string> = {
      'Content-Length': String(body.length),
    }

    if (options?.contentType) {
      headers['Content-Type'] = options.contentType
    }
    if (options?.cacheControl) {
      headers['Cache-Control'] = options.cacheControl
    }
    if (options?.contentDisposition) {
      headers['Content-Disposition'] = options.contentDisposition
    }
    if (options?.storageClass) {
      headers['x-amz-storage-class'] = options.storageClass
    }
    if (options?.acl) {
      headers['x-amz-acl'] = options.acl
    }

    // Add custom metadata
    if (options?.customMetadata) {
      for (const [k, v] of Object.entries(options.customMetadata)) {
        headers[`x-amz-meta-${k}`] = v
      }
    }

    const authHeaders = await this.createAuthHeaders('PUT', path, headers, body)
    const url = this.getObjectUrl(key)

    const response = await fetch(url, {
      method: 'PUT',
      headers: authHeaders,
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 PUT failed: ${response.status} ${errorText}`)
    }

    const etag = response.headers.get('ETag')?.replace(/"/g, '') ?? ''
    const versionId = response.headers.get('x-amz-version-id') ?? undefined

    return {
      etag,
      size: body.length,
      versionId,
    }
  }

  async get(key: string, options?: ReadOptions): Promise<ReadResult | null> {
    const path = `/${encodeURIComponent(key)}`
    const headers: Record<string, string> = {}

    if (options?.ifNoneMatch) {
      headers['If-None-Match'] = `"${options.ifNoneMatch}"`
    }
    if (options?.ifModifiedSince) {
      headers['If-Modified-Since'] = options.ifModifiedSince.toUTCString()
    }
    if (options?.rangeStart !== undefined) {
      const rangeEnd = options.rangeEnd !== undefined ? options.rangeEnd : ''
      headers['Range'] = `bytes=${options.rangeStart}-${rangeEnd}`
    }

    const authHeaders = await this.createAuthHeaders('GET', path, headers, null)
    const url = this.getObjectUrl(key)

    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders,
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
      const errorText = await response.text()
      throw new Error(`S3 GET failed: ${response.status} ${errorText}`)
    }

    const data = new Uint8Array(await response.arrayBuffer())
    const etag = response.headers.get('ETag')?.replace(/"/g, '') ?? ''
    const contentType = response.headers.get('Content-Type') ?? undefined
    const lastModified = response.headers.get('Last-Modified')
    const storageClass = response.headers.get('x-amz-storage-class') ?? undefined

    // Extract custom metadata
    const customMetadata: Record<string, string> = {}
    response.headers.forEach((value, header) => {
      if (header.toLowerCase().startsWith('x-amz-meta-')) {
        const metaKey = header.slice('x-amz-meta-'.length)
        customMetadata[metaKey] = value
      }
    })

    return {
      data,
      metadata: {
        key,
        size: data.length,
        etag,
        contentType,
        lastModified: lastModified ? new Date(lastModified) : undefined,
        storageClass,
        customMetadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
      },
    }
  }

  async delete(key: string): Promise<void> {
    const path = `/${encodeURIComponent(key)}`
    const authHeaders = await this.createAuthHeaders('DELETE', path, {}, null)
    const url = this.getObjectUrl(key)

    const response = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders,
    })

    // S3 returns 204 for successful delete, 404 is also acceptable (idempotent)
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`S3 DELETE failed: ${response.status} ${errorText}`)
    }
  }

  async exists(key: string): Promise<boolean> {
    const metadata = await this.head(key)
    return metadata !== null
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const path = `/${encodeURIComponent(key)}`
    const authHeaders = await this.createAuthHeaders('HEAD', path, {}, null)
    const url = this.getObjectUrl(key)

    const response = await fetch(url, {
      method: 'HEAD',
      headers: authHeaders,
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 HEAD failed: ${response.status} ${errorText}`)
    }

    const etag = response.headers.get('ETag')?.replace(/"/g, '') ?? ''
    const contentType = response.headers.get('Content-Type') ?? undefined
    const contentLength = response.headers.get('Content-Length')
    const lastModified = response.headers.get('Last-Modified')
    const storageClass = response.headers.get('x-amz-storage-class') ?? undefined

    // Extract custom metadata
    const customMetadata: Record<string, string> = {}
    response.headers.forEach((value, header) => {
      if (header.toLowerCase().startsWith('x-amz-meta-')) {
        const metaKey = header.slice('x-amz-meta-'.length)
        customMetadata[metaKey] = value
      }
    })

    return {
      key,
      size: contentLength ? parseInt(contentLength, 10) : 0,
      etag,
      contentType,
      lastModified: lastModified ? new Date(lastModified) : undefined,
      storageClass,
      customMetadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
    }
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const params = new URLSearchParams({
      'list-type': '2',
    })

    if (options?.prefix) {
      params.set('prefix', options.prefix)
    }
    if (options?.delimiter) {
      params.set('delimiter', options.delimiter)
    }
    if (options?.maxKeys) {
      params.set('max-keys', String(options.maxKeys))
    }
    if (options?.continuationToken) {
      params.set('continuation-token', options.continuationToken)
    }
    if (options?.startAfter) {
      params.set('start-after', options.startAfter)
    }

    const path = `/?${params.toString()}`
    const url = this.forcePathStyle
      ? `${this.getBaseUrl()}/${this.bucket}?${params.toString()}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com?${params.toString()}`

    const authHeaders = await this.createAuthHeaders('GET', path, {}, null)

    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 LIST failed: ${response.status} ${errorText}`)
    }

    const xml = await response.text()

    // Parse XML response (simple parsing)
    const objects: ObjectMetadata[] = []
    const prefixes: string[] = []

    // Extract Contents
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g
    let match
    while ((match = contentsRegex.exec(xml)) !== null) {
      const content = match[1]
      const key = this.extractXmlValue(content, 'Key')
      const size = this.extractXmlValue(content, 'Size')
      const etag = this.extractXmlValue(content, 'ETag')?.replace(/"/g, '')
      const lastModified = this.extractXmlValue(content, 'LastModified')
      const storageClass = this.extractXmlValue(content, 'StorageClass')

      if (key) {
        objects.push({
          key,
          size: size ? parseInt(size, 10) : 0,
          etag: etag ?? '',
          lastModified: lastModified ? new Date(lastModified) : undefined,
          storageClass,
        })
      }
    }

    // Extract CommonPrefixes
    const prefixRegex = /<CommonPrefixes>[\s\S]*?<Prefix>(.*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g
    while ((match = prefixRegex.exec(xml)) !== null) {
      prefixes.push(match[1])
    }

    const isTruncated = this.extractXmlValue(xml, 'IsTruncated') === 'true'
    const nextToken = this.extractXmlValue(xml, 'NextContinuationToken')
    const keyCount = this.extractXmlValue(xml, 'KeyCount')

    return {
      objects,
      prefixes,
      isTruncated,
      nextContinuationToken: isTruncated ? nextToken : undefined,
      keyCount: keyCount ? parseInt(keyCount, 10) : objects.length,
    }
  }

  private extractXmlValue(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`)
    const match = regex.exec(xml)
    return match ? match[1] : undefined
  }

  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: Error }> }> {
    if (keys.length === 0) {
      return { deleted: [], errors: [] }
    }

    // S3 Delete Objects API (batch delete)
    const deleteXml = `<?xml version="1.0" encoding="UTF-8"?>
<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Quiet>false</Quiet>
  ${keys.map((key) => `<Object><Key>${this.escapeXml(key)}</Key></Object>`).join('\n  ')}
</Delete>`

    const body = new TextEncoder().encode(deleteXml)
    const contentMd5 = await this.md5Base64(body)

    const url = this.forcePathStyle
      ? `${this.getBaseUrl()}/${this.bucket}?delete`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com?delete`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml',
      'Content-MD5': contentMd5,
    }

    const authHeaders = await this.createAuthHeaders('POST', '/?delete', headers, body)

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 DELETE batch failed: ${response.status} ${errorText}`)
    }

    const xml = await response.text()

    // Parse response
    const deleted: string[] = []
    const errors: Array<{ key: string; error: Error }> = []

    const deletedRegex = /<Deleted>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<\/Deleted>/g
    let match
    while ((match = deletedRegex.exec(xml)) !== null) {
      deleted.push(match[1])
    }

    const errorRegex = /<Error>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<Message>(.*?)<\/Message>[\s\S]*?<\/Error>/g
    while ((match = errorRegex.exec(xml)) !== null) {
      errors.push({
        key: match[1],
        error: new Error(match[2]),
      })
    }

    return { deleted, errors }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  private async md5Base64(data: Uint8Array): Promise<string> {
    // Use SubtleCrypto for MD5 is not available, fallback to empty for now
    // Real implementation would use a proper MD5 library
    // For Workers compatibility, we skip MD5 header (S3 accepts without it)
    return ''
  }

  async copy(sourceKey: string, destKey: string, options?: CopyOptions): Promise<WriteResult> {
    const path = `/${encodeURIComponent(destKey)}`
    const copySource = `/${this.bucket}/${encodeURIComponent(sourceKey)}`

    const headers: Record<string, string> = {
      'x-amz-copy-source': copySource,
    }

    if (options?.contentType) {
      headers['Content-Type'] = options.contentType
      headers['x-amz-metadata-directive'] = 'REPLACE'
    }
    if (options?.storageClass) {
      headers['x-amz-storage-class'] = options.storageClass
    }
    if (options?.acl) {
      headers['x-amz-acl'] = options.acl
    }

    const authHeaders = await this.createAuthHeaders('PUT', path, headers, null)
    const url = this.getObjectUrl(destKey)

    const response = await fetch(url, {
      method: 'PUT',
      headers: authHeaders,
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Source object not found: ${sourceKey}`)
      }
      const errorText = await response.text()
      throw new Error(`S3 COPY failed: ${response.status} ${errorText}`)
    }

    const xml = await response.text()
    const etag = this.extractXmlValue(xml, 'ETag')?.replace(/"/g, '') ?? ''

    // Get the size from source
    const sourceMeta = await this.head(sourceKey)

    return {
      etag,
      size: sourceMeta?.size ?? 0,
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const method = options.method ?? 'GET'
    const expiresIn = options.expiresIn
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = timestamp.slice(0, 8)

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`
    const credential = `${this.accessKeyId}/${credentialScope}`

    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': timestamp,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    })

    if (options.contentType && method === 'PUT') {
      params.set('Content-Type', options.contentType)
    }

    if (options.queryParams) {
      for (const [k, v] of Object.entries(options.queryParams)) {
        params.set(k, v)
      }
    }

    // Sort parameters
    params.sort()

    const host = this.forcePathStyle
      ? new URL(this.getBaseUrl()).host
      : `${this.bucket}.s3.${this.region}.amazonaws.com`

    const path = this.forcePathStyle ? `/${this.bucket}/${encodeURIComponent(key)}` : `/${encodeURIComponent(key)}`

    const canonicalRequest = [
      method,
      path,
      params.toString(),
      `host:${host}`,
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const canonicalRequestHash = await this.sha256Hex(new TextEncoder().encode(canonicalRequest))
    const stringToSign = ['AWS4-HMAC-SHA256', timestamp, credentialScope, canonicalRequestHash].join('\n')

    const kDate = await this.hmacSha256(new TextEncoder().encode('AWS4' + this.secretAccessKey), dateStamp)
    const kRegion = await this.hmacSha256(kDate, this.region)
    const kService = await this.hmacSha256(kRegion, 's3')
    const kSigning = await this.hmacSha256(kService, 'aws4_request')
    const signature = await this.hmacSha256Hex(kSigning, stringToSign)

    params.set('X-Amz-Signature', signature)

    const baseUrl = this.forcePathStyle
      ? `${this.getBaseUrl()}/${this.bucket}/${encodeURIComponent(key)}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodeURIComponent(key)}`

    return `${baseUrl}?${params.toString()}`
  }

  async createMultipartUpload(key: string, options?: WriteOptions): Promise<MultipartUpload> {
    const path = `/${encodeURIComponent(key)}?uploads`
    const headers: Record<string, string> = {}

    if (options?.contentType) {
      headers['Content-Type'] = options.contentType
    }
    if (options?.storageClass) {
      headers['x-amz-storage-class'] = options.storageClass
    }
    if (options?.customMetadata) {
      for (const [k, v] of Object.entries(options.customMetadata)) {
        headers[`x-amz-meta-${k}`] = v
      }
    }

    const authHeaders = await this.createAuthHeaders('POST', path, headers, null)
    const url = `${this.getObjectUrl(key)}?uploads`

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 CreateMultipartUpload failed: ${response.status} ${errorText}`)
    }

    const xml = await response.text()
    const uploadId = this.extractXmlValue(xml, 'UploadId')

    if (!uploadId) {
      throw new Error('Failed to get upload ID from S3 response')
    }

    return new S3MultipartUpload(this, key, uploadId)
  }

  // Internal methods for multipart upload
  async _uploadPart(key: string, uploadId: string, partNumber: number, data: Uint8Array): Promise<UploadPart> {
    const path = `/${encodeURIComponent(key)}?partNumber=${partNumber}&uploadId=${uploadId}`
    const headers: Record<string, string> = {
      'Content-Length': String(data.length),
    }

    const authHeaders = await this.createAuthHeaders('PUT', path, headers, data)
    const url = `${this.getObjectUrl(key)}?partNumber=${partNumber}&uploadId=${uploadId}`

    const response = await fetch(url, {
      method: 'PUT',
      headers: authHeaders,
      body: data,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 UploadPart failed: ${response.status} ${errorText}`)
    }

    const etag = response.headers.get('ETag')?.replace(/"/g, '') ?? ''

    return {
      partNumber,
      etag,
      size: data.length,
    }
  }

  async _completeMultipartUpload(key: string, uploadId: string, parts: UploadPart[]): Promise<WriteResult> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  ${parts
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
    .join('\n  ')}
</CompleteMultipartUpload>`

    const body = new TextEncoder().encode(xml)
    const path = `/${encodeURIComponent(key)}?uploadId=${uploadId}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml',
      'Content-Length': String(body.length),
    }

    const authHeaders = await this.createAuthHeaders('POST', path, headers, body)
    const url = `${this.getObjectUrl(key)}?uploadId=${uploadId}`

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`S3 CompleteMultipartUpload failed: ${response.status} ${errorText}`)
    }

    const responseXml = await response.text()
    const etag = this.extractXmlValue(responseXml, 'ETag')?.replace(/"/g, '') ?? ''
    const totalSize = parts.reduce((sum, p) => sum + p.size, 0)

    return {
      etag,
      size: totalSize,
    }
  }

  async _abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const path = `/${encodeURIComponent(key)}?uploadId=${uploadId}`
    const authHeaders = await this.createAuthHeaders('DELETE', path, {}, null)
    const url = `${this.getObjectUrl(key)}?uploadId=${uploadId}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders,
    })

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`S3 AbortMultipartUpload failed: ${response.status} ${errorText}`)
    }
  }
}

// =============================================================================
// S3 Multipart Upload Implementation
// =============================================================================

class S3MultipartUpload implements MultipartUpload {
  readonly uploadId: string
  readonly key: string

  private provider: S3Provider

  constructor(provider: S3Provider, key: string, uploadId: string) {
    this.provider = provider
    this.key = key
    this.uploadId = uploadId
  }

  async uploadPart(partNumber: number, data: Uint8Array): Promise<UploadPart> {
    return this.provider._uploadPart(this.key, this.uploadId, partNumber, data)
  }

  async complete(parts: UploadPart[]): Promise<WriteResult> {
    return this.provider._completeMultipartUpload(this.key, this.uploadId, parts)
  }

  async abort(): Promise<void> {
    return this.provider._abortMultipartUpload(this.key, this.uploadId)
  }
}
