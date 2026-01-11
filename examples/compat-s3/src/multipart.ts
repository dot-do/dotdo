/**
 * Multipart upload handling for S3-compatible API
 *
 * Manages multipart uploads with R2 backend storage
 */

import type {
  MultipartUpload,
  Part,
  CompletedPart,
  MultipartUploadResult,
  ListPartsRequest,
  ListPartsResponse,
  StorageClass,
  BucketOwner,
} from './types'
import { S3Errors } from './types'
import { generateMultipartETag } from './signing'

// ============================================================================
// Types
// ============================================================================

interface MultipartUploadState {
  uploadId: string
  key: string
  bucket: string
  initiated: Date
  parts: Map<number, Part>
  storageClass?: StorageClass
  metadata?: Record<string, string>
  contentType?: string
  owner?: BucketOwner
}

// ============================================================================
// Multipart Upload Manager
// ============================================================================

export class MultipartUploadManager {
  private uploads: Map<string, MultipartUploadState> = new Map()
  private r2: R2Bucket
  private maxParts: number
  private minPartSize: number

  constructor(r2: R2Bucket, options: { maxParts?: number; minPartSize?: number } = {}) {
    this.r2 = r2
    this.maxParts = options.maxParts ?? 10000
    this.minPartSize = options.minPartSize ?? 5 * 1024 * 1024 // 5MB minimum
  }

  // ==========================================================================
  // Serialization for Durable Object storage
  // ==========================================================================

  serialize(): string {
    const data: Array<[string, {
      uploadId: string
      key: string
      bucket: string
      initiated: string
      parts: Array<[number, Part]>
      storageClass?: StorageClass
      metadata?: Record<string, string>
      contentType?: string
      owner?: BucketOwner
    }]> = []

    for (const [id, upload] of this.uploads) {
      data.push([id, {
        uploadId: upload.uploadId,
        key: upload.key,
        bucket: upload.bucket,
        initiated: upload.initiated.toISOString(),
        parts: Array.from(upload.parts.entries()),
        storageClass: upload.storageClass,
        metadata: upload.metadata,
        contentType: upload.contentType,
        owner: upload.owner,
      }])
    }

    return JSON.stringify(data)
  }

  static deserialize(r2: R2Bucket, data: string, options?: { maxParts?: number; minPartSize?: number }): MultipartUploadManager {
    const manager = new MultipartUploadManager(r2, options)
    const parsed = JSON.parse(data) as Array<[string, {
      uploadId: string
      key: string
      bucket: string
      initiated: string
      parts: Array<[number, Part]>
      storageClass?: StorageClass
      metadata?: Record<string, string>
      contentType?: string
      owner?: BucketOwner
    }]>

    for (const [id, upload] of parsed) {
      manager.uploads.set(id, {
        uploadId: upload.uploadId,
        key: upload.key,
        bucket: upload.bucket,
        initiated: new Date(upload.initiated),
        parts: new Map(upload.parts),
        storageClass: upload.storageClass,
        metadata: upload.metadata,
        contentType: upload.contentType,
        owner: upload.owner,
      })
    }

    return manager
  }

  // ==========================================================================
  // Create Multipart Upload
  // ==========================================================================

  async createMultipartUpload(
    bucket: string,
    key: string,
    options: {
      storageClass?: StorageClass
      metadata?: Record<string, string>
      contentType?: string
      owner?: BucketOwner
    } = {}
  ): Promise<MultipartUpload> {
    const uploadId = crypto.randomUUID()

    const upload: MultipartUploadState = {
      uploadId,
      key,
      bucket,
      initiated: new Date(),
      parts: new Map(),
      storageClass: options.storageClass,
      metadata: options.metadata,
      contentType: options.contentType,
      owner: options.owner,
    }

    this.uploads.set(uploadId, upload)

    return {
      uploadId,
      key,
      bucket,
      initiated: upload.initiated,
      storageClass: options.storageClass,
      owner: options.owner,
    }
  }

  // ==========================================================================
  // Upload Part
  // ==========================================================================

  async uploadPart(
    uploadId: string,
    partNumber: number,
    body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
    options: {
      contentMD5?: string
      checksumCRC32?: string
      checksumCRC32C?: string
      checksumSHA1?: string
      checksumSHA256?: string
    } = {}
  ): Promise<Part> {
    const upload = this.uploads.get(uploadId)
    if (!upload) {
      throw S3Errors.NoSuchUpload(uploadId)
    }

    if (partNumber < 1 || partNumber > this.maxParts) {
      throw new Error(`Part number must be between 1 and ${this.maxParts}`)
    }

    // Store part in R2 with unique key
    const partKey = this.getPartKey(upload.bucket, upload.key, uploadId, partNumber)

    // Convert body to appropriate format
    let bodyToStore: ReadableStream<Uint8Array> | ArrayBuffer
    let size: number

    if (body instanceof ArrayBuffer) {
      bodyToStore = body
      size = body.byteLength
    } else if (body instanceof Uint8Array) {
      bodyToStore = body.buffer as ArrayBuffer
      size = body.byteLength
    } else {
      // For streams, we need to tee it to get size
      const [stream1, stream2] = body.tee()
      const chunks: Uint8Array[] = []
      const reader = stream2.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      bodyToStore = stream1
    }

    // Verify minimum part size (except for last part)
    // This validation would need context about whether this is the last part

    const r2Object = await this.r2.put(partKey, bodyToStore, {
      customMetadata: {
        uploadId,
        partNumber: partNumber.toString(),
        originalKey: upload.key,
      },
    })

    const part: Part = {
      partNumber,
      etag: r2Object.etag,
      size,
      lastModified: new Date(),
      checksumCRC32: options.checksumCRC32,
      checksumCRC32C: options.checksumCRC32C,
      checksumSHA1: options.checksumSHA1,
      checksumSHA256: options.checksumSHA256,
    }

    upload.parts.set(partNumber, part)

    return part
  }

  // ==========================================================================
  // Complete Multipart Upload
  // ==========================================================================

  async completeMultipartUpload(
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<MultipartUploadResult> {
    const upload = this.uploads.get(uploadId)
    if (!upload) {
      throw S3Errors.NoSuchUpload(uploadId)
    }

    // Validate parts are in ascending order
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].partNumber <= parts[i - 1].partNumber) {
        throw S3Errors.InvalidPartOrder()
      }
    }

    // Validate all parts exist and ETags match
    const partStreams: R2ObjectBody[] = []
    const etags: string[] = []
    let totalSize = 0

    for (const completedPart of parts) {
      const storedPart = upload.parts.get(completedPart.partNumber)
      if (!storedPart) {
        throw S3Errors.InvalidPart(completedPart.partNumber)
      }

      // ETag comparison (normalize quotes)
      const normalizedCompletedEtag = completedPart.etag.replace(/"/g, '')
      const normalizedStoredEtag = storedPart.etag.replace(/"/g, '')

      if (normalizedCompletedEtag !== normalizedStoredEtag) {
        throw S3Errors.InvalidPart(completedPart.partNumber)
      }

      // Validate minimum part size for all but last part
      if (completedPart.partNumber !== parts[parts.length - 1].partNumber) {
        if (storedPart.size < this.minPartSize) {
          throw S3Errors.EntityTooSmall()
        }
      }

      const partKey = this.getPartKey(upload.bucket, upload.key, uploadId, completedPart.partNumber)
      const partObject = await this.r2.get(partKey)

      if (!partObject) {
        throw S3Errors.InvalidPart(completedPart.partNumber)
      }

      partStreams.push(partObject)
      etags.push(storedPart.etag)
      totalSize += storedPart.size
    }

    // Concatenate all parts into final object
    const finalKey = `${upload.bucket}/${upload.key}`

    // Create a combined stream from all parts
    const combinedStream = this.createCombinedStream(partStreams)

    const finalObject = await this.r2.put(finalKey, combinedStream, {
      httpMetadata: {
        contentType: upload.contentType,
      },
      customMetadata: upload.metadata,
    })

    // Generate multipart ETag
    const multipartETag = await generateMultipartETag(etags)

    // Clean up part files
    await this.cleanupParts(upload)

    // Remove from active uploads
    this.uploads.delete(uploadId)

    return {
      location: `/${upload.bucket}/${upload.key}`,
      bucket: upload.bucket,
      key: upload.key,
      etag: multipartETag,
    }
  }

  // ==========================================================================
  // Abort Multipart Upload
  // ==========================================================================

  async abortMultipartUpload(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId)
    if (!upload) {
      throw S3Errors.NoSuchUpload(uploadId)
    }

    // Clean up all part files
    await this.cleanupParts(upload)

    // Remove from active uploads
    this.uploads.delete(uploadId)
  }

  // ==========================================================================
  // List Parts
  // ==========================================================================

  async listParts(request: ListPartsRequest): Promise<ListPartsResponse> {
    const upload = this.uploads.get(request.uploadId)
    if (!upload) {
      throw S3Errors.NoSuchUpload(request.uploadId)
    }

    const maxParts = request.maxParts ?? 1000
    const partNumberMarker = request.partNumberMarker ?? 0

    // Get all parts sorted by part number
    const allParts = Array.from(upload.parts.values())
      .filter(p => p.partNumber > partNumberMarker)
      .sort((a, b) => a.partNumber - b.partNumber)

    const parts = allParts.slice(0, maxParts)
    const isTruncated = allParts.length > maxParts

    return {
      bucket: upload.bucket,
      key: upload.key,
      uploadId: request.uploadId,
      partNumberMarker: partNumberMarker || undefined,
      nextPartNumberMarker: isTruncated ? parts[parts.length - 1]?.partNumber : undefined,
      maxParts,
      isTruncated,
      parts,
      storageClass: upload.storageClass,
      owner: upload.owner,
    }
  }

  // ==========================================================================
  // List Multipart Uploads
  // ==========================================================================

  listMultipartUploads(
    bucket: string,
    options: {
      prefix?: string
      delimiter?: string
      maxUploads?: number
      keyMarker?: string
      uploadIdMarker?: string
    } = {}
  ): {
    uploads: MultipartUpload[]
    isTruncated: boolean
    nextKeyMarker?: string
    nextUploadIdMarker?: string
    commonPrefixes: { prefix: string }[]
  } {
    const maxUploads = options.maxUploads ?? 1000
    const keyMarker = options.keyMarker ?? ''
    const uploadIdMarker = options.uploadIdMarker ?? ''

    // Filter and sort uploads
    let uploads = Array.from(this.uploads.values())
      .filter(u => u.bucket === bucket)
      .filter(u => !options.prefix || u.key.startsWith(options.prefix))
      .filter(u => {
        if (!keyMarker) return true
        if (u.key > keyMarker) return true
        if (u.key === keyMarker && u.uploadId > uploadIdMarker) return true
        return false
      })
      .sort((a, b) => {
        const keyCompare = a.key.localeCompare(b.key)
        if (keyCompare !== 0) return keyCompare
        return a.uploadId.localeCompare(b.uploadId)
      })

    // Handle delimiter (common prefixes)
    const commonPrefixes: Set<string> = new Set()

    if (options.delimiter) {
      const prefixLen = (options.prefix ?? '').length

      uploads = uploads.filter(u => {
        const keyAfterPrefix = u.key.slice(prefixLen)
        const delimiterIndex = keyAfterPrefix.indexOf(options.delimiter!)

        if (delimiterIndex >= 0) {
          const commonPrefix = (options.prefix ?? '') + keyAfterPrefix.slice(0, delimiterIndex + 1)
          commonPrefixes.add(commonPrefix)
          return false
        }
        return true
      })
    }

    const isTruncated = uploads.length > maxUploads
    const resultUploads = uploads.slice(0, maxUploads)

    return {
      uploads: resultUploads.map(u => ({
        uploadId: u.uploadId,
        key: u.key,
        bucket: u.bucket,
        initiated: u.initiated,
        storageClass: u.storageClass,
        owner: u.owner,
      })),
      isTruncated,
      nextKeyMarker: isTruncated ? resultUploads[resultUploads.length - 1]?.key : undefined,
      nextUploadIdMarker: isTruncated ? resultUploads[resultUploads.length - 1]?.uploadId : undefined,
      commonPrefixes: Array.from(commonPrefixes).map(prefix => ({ prefix })),
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private getPartKey(bucket: string, key: string, uploadId: string, partNumber: number): string {
    return `__multipart__/${bucket}/${key}/${uploadId}/${partNumber.toString().padStart(5, '0')}`
  }

  private async cleanupParts(upload: MultipartUploadState): Promise<void> {
    const deletePromises: Promise<void>[] = []

    for (const partNumber of upload.parts.keys()) {
      const partKey = this.getPartKey(upload.bucket, upload.key, upload.uploadId, partNumber)
      deletePromises.push(this.r2.delete(partKey))
    }

    await Promise.all(deletePromises)
  }

  private createCombinedStream(bodies: R2ObjectBody[]): ReadableStream<Uint8Array> {
    let currentIndex = 0
    let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null

    return new ReadableStream({
      async pull(controller) {
        while (currentIndex < bodies.length) {
          if (!currentReader) {
            currentReader = bodies[currentIndex].body.getReader()
          }

          const { done, value } = await currentReader.read()

          if (done) {
            currentReader = null
            currentIndex++
            continue
          }

          controller.enqueue(value)
          return
        }

        controller.close()
      },
    })
  }

  // ==========================================================================
  // Upload Part Copy
  // ==========================================================================

  async uploadPartCopy(
    uploadId: string,
    partNumber: number,
    sourceBucket: string,
    sourceKey: string,
    options: {
      sourceRange?: { start: number; end: number }
      sourceVersionId?: string
    } = {}
  ): Promise<Part> {
    const upload = this.uploads.get(uploadId)
    if (!upload) {
      throw S3Errors.NoSuchUpload(uploadId)
    }

    if (partNumber < 1 || partNumber > this.maxParts) {
      throw new Error(`Part number must be between 1 and ${this.maxParts}`)
    }

    // Get source object
    const sourceObjectKey = `${sourceBucket}/${sourceKey}`
    const sourceObject = await this.r2.get(sourceObjectKey, {
      range: options.sourceRange
        ? { offset: options.sourceRange.start, length: options.sourceRange.end - options.sourceRange.start + 1 }
        : undefined,
    })

    if (!sourceObject) {
      throw S3Errors.NoSuchKey(sourceKey)
    }

    // Store as part
    const partKey = this.getPartKey(upload.bucket, upload.key, uploadId, partNumber)
    const data = await sourceObject.arrayBuffer()

    const r2Object = await this.r2.put(partKey, data, {
      customMetadata: {
        uploadId,
        partNumber: partNumber.toString(),
        originalKey: upload.key,
        copiedFrom: `${sourceBucket}/${sourceKey}`,
      },
    })

    const part: Part = {
      partNumber,
      etag: r2Object.etag,
      size: data.byteLength,
      lastModified: new Date(),
    }

    upload.parts.set(partNumber, part)

    return part
  }
}
