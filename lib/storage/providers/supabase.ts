/**
 * Supabase Storage Provider
 *
 * Implements the StorageProvider interface for Supabase Storage.
 * Uses the Supabase Storage API.
 *
 * @module lib/storage/providers/supabase
 */

import type {
  StorageProvider,
  StorageProviderType,
  SupabaseStorageProviderConfig,
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
// Supabase Storage Provider Implementation
// =============================================================================

/**
 * Supabase Storage Provider.
 *
 * Implements the StorageProvider interface for Supabase Storage.
 *
 * @example
 * ```typescript
 * const provider = new SupabaseStorageProvider({
 *   type: 'supabase',
 *   url: 'https://your-project.supabase.co',
 *   key: process.env.SUPABASE_SERVICE_KEY,
 *   bucket: 'my-bucket',
 * })
 *
 * await provider.put('file.txt', data)
 * const result = await provider.get('file.txt')
 * ```
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly type: StorageProviderType = 'supabase'
  readonly name = 'Supabase Storage'

  private readonly config: SupabaseStorageProviderConfig
  private readonly baseUrl: string
  private readonly bucket: string
  private readonly key: string

  constructor(config: SupabaseStorageProviderConfig) {
    this.config = config
    this.baseUrl = config.url.replace(/\/$/, '')
    this.bucket = config.bucket
    this.key = config.key
  }

  // -------------------------------------------------------------------------
  // API Helpers
  // -------------------------------------------------------------------------

  private getStorageUrl(path?: string): string {
    const base = `${this.baseUrl}/storage/v1`
    if (path) {
      return `${base}${path}`
    }
    return base
  }

  private getObjectUrl(key: string): string {
    return `${this.baseUrl}/storage/v1/object/${this.bucket}/${encodeURIComponent(key)}`
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.key}`,
      apikey: this.key,
    }
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

    const headers: Record<string, string> = {
      ...this.getAuthHeaders(),
    }

    if (options?.contentType) {
      headers['Content-Type'] = options.contentType
    }
    if (options?.cacheControl) {
      headers['Cache-Control'] = options.cacheControl
    }

    // Supabase uses upsert for uploads
    const url = `${this.baseUrl}/storage/v1/object/${this.bucket}/${encodeURIComponent(key)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'x-upsert': 'true',
      },
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Supabase PUT failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { Key?: string; Id?: string }

    // Generate a simple etag from the response
    const etag = result.Id ?? `${key}-${Date.now()}`

    return {
      etag,
      size: body.length,
    }
  }

  async get(key: string, options?: ReadOptions): Promise<ReadResult | null> {
    const headers: Record<string, string> = {
      ...this.getAuthHeaders(),
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

    const url = this.getObjectUrl(key)

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

    if (response.status === 404 || response.status === 400) {
      return null
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Supabase GET failed: ${response.status} ${error}`)
    }

    const data = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('Content-Type') ?? undefined
    const lastModified = response.headers.get('Last-Modified')
    const etag = response.headers.get('ETag')?.replace(/"/g, '') ?? `${key}-${Date.now()}`

    return {
      data,
      metadata: {
        key,
        size: data.length,
        etag,
        contentType,
        lastModified: lastModified ? new Date(lastModified) : undefined,
      },
    }
  }

  async delete(key: string): Promise<void> {
    const url = `${this.baseUrl}/storage/v1/object/${this.bucket}/${encodeURIComponent(key)}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    })

    if (!response.ok && response.status !== 404 && response.status !== 400) {
      const error = await response.text()
      throw new Error(`Supabase DELETE failed: ${response.status} ${error}`)
    }
  }

  async exists(key: string): Promise<boolean> {
    const metadata = await this.head(key)
    return metadata !== null
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    // Supabase doesn't have a dedicated HEAD endpoint
    // We use the list API to get metadata
    const url = `${this.baseUrl}/storage/v1/object/list/${this.bucket}`

    // Extract the folder path and filename
    const lastSlash = key.lastIndexOf('/')
    const prefix = lastSlash >= 0 ? key.slice(0, lastSlash + 1) : ''
    const filename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit: 100,
        offset: 0,
      }),
    })

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      const error = await response.text()
      throw new Error(`Supabase HEAD failed: ${response.status} ${error}`)
    }

    const items = await response.json() as Array<{
      name: string
      id?: string
      metadata?: Record<string, string>
      created_at?: string
      updated_at?: string
      last_accessed_at?: string
    }>

    const item = items.find((i) => i.name === filename)
    if (!item) {
      return null
    }

    return {
      key,
      size: 0, // Size not available in list response
      etag: item.id ?? key,
      customMetadata: item.metadata,
      lastModified: item.updated_at ? new Date(item.updated_at) : undefined,
    }
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const url = `${this.baseUrl}/storage/v1/object/list/${this.bucket}`

    const prefix = options?.prefix ?? ''

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit: options?.maxKeys ?? 100,
        offset: options?.continuationToken ? parseInt(options.continuationToken, 10) : 0,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Supabase LIST failed: ${response.status} ${error}`)
    }

    const items = await response.json() as Array<{
      name: string
      id?: string
      metadata?: Record<string, string>
      created_at?: string
      updated_at?: string
    }>

    const objects: ObjectMetadata[] = []
    const prefixes: string[] = []

    for (const item of items) {
      // Check if it's a folder (ends with /)
      if (item.name.endsWith('/') || item.id === null) {
        prefixes.push(prefix + item.name)
      } else {
        objects.push({
          key: prefix + item.name,
          size: 0, // Size not available
          etag: item.id ?? item.name,
          customMetadata: item.metadata,
          lastModified: item.updated_at ? new Date(item.updated_at) : undefined,
        })
      }
    }

    const limit = options?.maxKeys ?? 100
    const offset = options?.continuationToken ? parseInt(options.continuationToken, 10) : 0

    return {
      objects,
      prefixes,
      isTruncated: items.length >= limit,
      nextContinuationToken: items.length >= limit ? String(offset + limit) : undefined,
      keyCount: objects.length,
    }
  }

  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: Error }> }> {
    if (keys.length === 0) {
      return { deleted: [], errors: [] }
    }

    const deleted: string[] = []
    const errors: Array<{ key: string; error: Error }> = []

    // Supabase supports batch delete
    const url = `${this.baseUrl}/storage/v1/object/${this.bucket}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefixes: keys,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      // Fall back to individual deletes
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
    } else {
      deleted.push(...keys)
    }

    return { deleted, errors }
  }

  async copy(sourceKey: string, destKey: string, options?: CopyOptions): Promise<WriteResult> {
    const url = `${this.baseUrl}/storage/v1/object/copy`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: this.bucket,
        sourceKey,
        destinationKey: destKey,
      }),
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Source object not found: ${sourceKey}`)
      }
      const error = await response.text()
      throw new Error(`Supabase COPY failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { Key?: string }

    return {
      etag: result.Key ?? destKey,
      size: 0, // Size not returned
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const url = `${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${encodeURIComponent(key)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expiresIn: options.expiresIn,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Supabase getSignedUrl failed: ${response.status} ${error}`)
    }

    const result = await response.json() as { signedURL: string }

    // The signed URL is relative, need to add base
    if (result.signedURL.startsWith('/')) {
      return `${this.baseUrl}/storage/v1${result.signedURL}`
    }

    return result.signedURL
  }

  async createMultipartUpload(key: string, options?: WriteOptions): Promise<MultipartUpload> {
    // Supabase doesn't support true multipart uploads
    // We simulate it by accumulating parts
    return new SupabaseMultipartUpload(this, key, options)
  }

  // Internal method for completing multipart upload
  async _completeUpload(key: string, data: Uint8Array, options?: WriteOptions): Promise<WriteResult> {
    return this.put(key, data, options)
  }
}

// =============================================================================
// Supabase Multipart Upload Implementation
// =============================================================================

class SupabaseMultipartUpload implements MultipartUpload {
  readonly uploadId: string
  readonly key: string

  private provider: SupabaseStorageProvider
  private options?: WriteOptions
  private parts: Map<number, Uint8Array> = new Map()

  constructor(provider: SupabaseStorageProvider, key: string, options?: WriteOptions) {
    this.provider = provider
    this.key = key
    this.uploadId = `${key}-${Date.now()}`
    this.options = options
  }

  async uploadPart(partNumber: number, data: Uint8Array): Promise<UploadPart> {
    this.parts.set(partNumber, data)

    return {
      partNumber,
      etag: `part-${partNumber}`,
      size: data.length,
    }
  }

  async complete(parts: UploadPart[]): Promise<WriteResult> {
    // Combine all parts in order
    const sortedParts = parts.sort((a, b) => a.partNumber - b.partNumber)
    let totalSize = 0
    for (const part of sortedParts) {
      const data = this.parts.get(part.partNumber)
      if (data) {
        totalSize += data.length
      }
    }

    const combined = new Uint8Array(totalSize)
    let offset = 0
    for (const part of sortedParts) {
      const data = this.parts.get(part.partNumber)
      if (data) {
        combined.set(data, offset)
        offset += data.length
      }
    }

    return this.provider._completeUpload(this.key, combined, this.options)
  }

  async abort(): Promise<void> {
    this.parts.clear()
  }
}
