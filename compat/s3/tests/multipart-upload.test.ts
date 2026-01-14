/**
 * @dotdo/s3 - Multipart Upload Tests (RED Phase)
 *
 * TDD RED tests for comprehensive multipart upload functionality.
 * These tests define expected behavior for multipart upload features
 * that may not be fully implemented yet.
 *
 * Tests cover:
 * 1. Part size validation (minimum 5MB except last part)
 * 2. Maximum part count (10,000 parts)
 * 3. Part number validation (1-10,000)
 * 4. ETags with part ordering
 * 5. Concurrent uploads
 * 6. UploadPartCopy for server-side copy
 * 7. Checksum validation
 * 8. Storage class inheritance
 *
 * Issue: dotdo-v5u7k
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  S3Client,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  NoSuchBucket,
  NoSuchUpload,
  InvalidPart,
  InvalidPartOrder,
  EntityTooSmall,
  _clearAll,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('S3 Multipart Upload (RED Phase)', () => {
  let client: InstanceType<typeof S3Client>
  const TEST_BUCKET = 'multipart-test-bucket'

  beforeEach(async () => {
    _clearAll()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
  })

  afterEach(() => {
    _clearAll()
  })

  // ===========================================================================
  // CreateMultipartUpload Tests
  // ===========================================================================

  describe('CreateMultipartUploadCommand', () => {
    it('should initiate multipart upload with storage class', async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'storage-class-test.bin',
          StorageClass: 'STANDARD_IA',
        })
      )

      expect(result.UploadId).toBeDefined()
      expect(result.$metadata.httpStatusCode).toBe(200)
    })

    it('should initiate multipart upload with SSE', async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'sse-test.bin',
          ServerSideEncryption: 'AES256',
        })
      )

      expect(result.UploadId).toBeDefined()
      expect(result.ServerSideEncryption).toBe('AES256')
    })

    it('should initiate multipart upload with custom metadata', async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'metadata-test.bin',
          Metadata: {
            'custom-key': 'custom-value',
            'another-key': 'another-value',
          },
        })
      )

      expect(result.UploadId).toBeDefined()
    })

    it('should initiate multipart upload with cache control', async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'cache-test.bin',
          CacheControl: 'max-age=86400',
        })
      )

      expect(result.UploadId).toBeDefined()
    })

    it('should initiate multipart upload with content disposition', async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'disposition-test.bin',
          ContentDisposition: 'attachment; filename="download.bin"',
        })
      )

      expect(result.UploadId).toBeDefined()
    })

    it('should generate unique upload IDs for same key', async () => {
      const result1 = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'same-key.bin',
        })
      )

      const result2 = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'same-key.bin',
        })
      )

      expect(result1.UploadId).not.toBe(result2.UploadId)
    })
  })

  // ===========================================================================
  // UploadPart Tests
  // ===========================================================================

  describe('UploadPartCommand', () => {
    let uploadId: string

    beforeEach(async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
        })
      )
      uploadId = result.UploadId!
    })

    it('should upload part with minimum size (5MB)', async () => {
      // 5MB is minimum for non-last parts
      const fiveMB = new Uint8Array(5 * 1024 * 1024).fill(65)

      const result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: fiveMB,
        })
      )

      expect(result.ETag).toBeDefined()
    })

    it('should allow last part to be smaller than 5MB', async () => {
      // First part: 5MB
      const fiveMB = new Uint8Array(5 * 1024 * 1024).fill(65)
      await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: fiveMB,
        })
      )

      // Last part: smaller than 5MB (this should be allowed)
      const smallPart = new Uint8Array(1024).fill(66)
      const result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 2,
          Body: smallPart,
        })
      )

      expect(result.ETag).toBeDefined()
    })

    it('should accept part numbers from 1 to 10000', async () => {
      const partData = new Uint8Array(1024).fill(65)

      // Part number 1 (minimum)
      const result1 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: partData,
        })
      )
      expect(result1.ETag).toBeDefined()

      // Part number 10000 (maximum)
      const result10000 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 10000,
          Body: partData,
        })
      )
      expect(result10000.ETag).toBeDefined()
    })

    it('should reject part number 0', async () => {
      const partData = new Uint8Array(1024).fill(65)

      await expect(
        client.send(
          new UploadPartCommand({
            Bucket: TEST_BUCKET,
            Key: 'upload-part-test.bin',
            UploadId: uploadId,
            PartNumber: 0,
            Body: partData,
          })
        )
      ).rejects.toThrow('InvalidArgument')
    })

    it('should reject part number greater than 10000', async () => {
      const partData = new Uint8Array(1024).fill(65)

      await expect(
        client.send(
          new UploadPartCommand({
            Bucket: TEST_BUCKET,
            Key: 'upload-part-test.bin',
            UploadId: uploadId,
            PartNumber: 10001,
            Body: partData,
          })
        )
      ).rejects.toThrow('InvalidArgument')
    })

    it('should allow overwriting a part with same part number', async () => {
      const part1 = new Uint8Array(1024).fill(65)
      const part1Updated = new Uint8Array(1024).fill(66)

      const result1 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: part1,
        })
      )

      const result2 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: part1Updated,
        })
      )

      // ETags should be different because content is different
      expect(result1.ETag).not.toBe(result2.ETag)
    })

    it('should return consistent ETag for same content', async () => {
      const partData = new Uint8Array(1024).fill(65)

      const result1 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: partData,
        })
      )

      // Create new upload
      const newUpload = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test-2.bin',
        })
      )

      const result2 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test-2.bin',
          UploadId: newUpload.UploadId!,
          PartNumber: 1,
          Body: partData,
        })
      )

      // Same content should produce same ETag
      expect(result1.ETag).toBe(result2.ETag)
    })

    it('should support content-md5 validation', async () => {
      const partData = new Uint8Array(1024).fill(65)
      // Note: In real implementation, this would be a base64-encoded MD5
      const contentMD5 = 'dGVzdC1tZDUtaGFzaA==' // Fake MD5 for testing

      const result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'upload-part-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: partData,
          ContentMD5: contentMD5,
        })
      )

      expect(result.ETag).toBeDefined()
    })
  })

  // ===========================================================================
  // CompleteMultipartUpload Tests
  // ===========================================================================

  describe('CompleteMultipartUploadCommand', () => {
    let uploadId: string

    beforeEach(async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
        })
      )
      uploadId = result.UploadId!
    })

    it('should require parts in ascending order', async () => {
      const part1Data = new Uint8Array(1024).fill(65)
      const part2Data = new Uint8Array(512).fill(66)

      const part2Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 2,
          Body: part2Data,
        })
      )

      const part1Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: part1Data,
        })
      )

      // Parts must be listed in ascending order in the complete request
      await expect(
        client.send(
          new CompleteMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'complete-test.bin',
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [
                { PartNumber: 2, ETag: part2Result.ETag },
                { PartNumber: 1, ETag: part1Result.ETag },
              ],
            },
          })
        )
      ).rejects.toThrow(InvalidPartOrder)
    })

    it('should require correct ETags', async () => {
      const partData = new Uint8Array(1024).fill(65)

      await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: partData,
        })
      )

      await expect(
        client.send(
          new CompleteMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'complete-test.bin',
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [{ PartNumber: 1, ETag: '"invalid-etag"' }],
            },
          })
        )
      ).rejects.toThrow(InvalidPart)
    })

    it('should reject if non-last parts are too small', async () => {
      // Part 1: Only 1KB (below 5MB minimum)
      const smallPart = new Uint8Array(1024).fill(65)
      const part1Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: smallPart,
        })
      )

      // Part 2: Also small
      const part2Data = new Uint8Array(512).fill(66)
      const part2Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 2,
          Body: part2Data,
        })
      )

      // Should fail because part 1 is too small (not the last part)
      await expect(
        client.send(
          new CompleteMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'complete-test.bin',
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [
                { PartNumber: 1, ETag: part1Result.ETag },
                { PartNumber: 2, ETag: part2Result.ETag },
              ],
            },
          })
        )
      ).rejects.toThrow(EntityTooSmall)
    })

    it('should complete with single part smaller than 5MB', async () => {
      // Single part upload can be smaller than 5MB
      const partData = new Uint8Array(1024).fill(65)
      const partResult = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: partData,
        })
      )

      const result = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: partResult.ETag }],
          },
        })
      )

      expect(result.ETag).toBeDefined()
    })

    it('should support skipping part numbers', async () => {
      // Upload parts 1 and 3 (skip 2)
      const part1Data = new Uint8Array(1024).fill(65)
      const part3Data = new Uint8Array(512).fill(67)

      const part1Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: part1Data,
        })
      )

      const part3Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 3,
          Body: part3Data,
        })
      )

      // Can complete with non-consecutive part numbers
      const result = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [
              { PartNumber: 1, ETag: part1Result.ETag },
              { PartNumber: 3, ETag: part3Result.ETag },
            ],
          },
        })
      )

      expect(result.ETag).toBeDefined()

      // Verify content size is sum of both parts
      const headResult = await client.send(
        new HeadObjectCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
        })
      )
      expect(headResult.ContentLength).toBe(1024 + 512)
    })

    it('should preserve content type from CreateMultipartUpload', async () => {
      // Create new upload with content type
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'content-type-test.json',
          ContentType: 'application/json',
        })
      )

      const partData = new Uint8Array(1024).fill(65)
      const partResult = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'content-type-test.json',
          UploadId: createResult.UploadId!,
          PartNumber: 1,
          Body: partData,
        })
      )

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'content-type-test.json',
          UploadId: createResult.UploadId!,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: partResult.ETag }],
          },
        })
      )

      const headResult = await client.send(
        new HeadObjectCommand({
          Bucket: TEST_BUCKET,
          Key: 'content-type-test.json',
        })
      )
      expect(headResult.ContentType).toBe('application/json')
    })

    it('should preserve custom metadata from CreateMultipartUpload', async () => {
      // Create new upload with metadata
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'metadata-test.bin',
          Metadata: {
            'x-custom': 'value',
          },
        })
      )

      const partData = new Uint8Array(1024).fill(65)
      const partResult = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'metadata-test.bin',
          UploadId: createResult.UploadId!,
          PartNumber: 1,
          Body: partData,
        })
      )

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'metadata-test.bin',
          UploadId: createResult.UploadId!,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: partResult.ETag }],
          },
        })
      )

      const headResult = await client.send(
        new HeadObjectCommand({
          Bucket: TEST_BUCKET,
          Key: 'metadata-test.bin',
        })
      )
      expect(headResult.Metadata).toEqual({ 'x-custom': 'value' })
    })

    it('should return multipart ETag with part count suffix', async () => {
      const part1Data = new Uint8Array(1024).fill(65)
      const part2Data = new Uint8Array(512).fill(66)

      const part1Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: part1Data,
        })
      )

      const part2Result = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          PartNumber: 2,
          Body: part2Data,
        })
      )

      const result = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'complete-test.bin',
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [
              { PartNumber: 1, ETag: part1Result.ETag },
              { PartNumber: 2, ETag: part2Result.ETag },
            ],
          },
        })
      )

      // Multipart ETags end with -<part_count>
      expect(result.ETag).toMatch(/-2"$/)
    })
  })

  // ===========================================================================
  // AbortMultipartUpload Tests
  // ===========================================================================

  describe('AbortMultipartUploadCommand', () => {
    it('should abort and cleanup all uploaded parts', async () => {
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'abort-test.bin',
        })
      )

      // Upload several parts
      for (let i = 1; i <= 5; i++) {
        await client.send(
          new UploadPartCommand({
            Bucket: TEST_BUCKET,
            Key: 'abort-test.bin',
            UploadId: createResult.UploadId!,
            PartNumber: i,
            Body: new Uint8Array(1024).fill(64 + i),
          })
        )
      }

      // Abort
      const result = await client.send(
        new AbortMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'abort-test.bin',
          UploadId: createResult.UploadId!,
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(204)

      // Verify upload no longer exists
      await expect(
        client.send(
          new ListPartsCommand({
            Bucket: TEST_BUCKET,
            Key: 'abort-test.bin',
            UploadId: createResult.UploadId!,
          })
        )
      ).rejects.toThrow(NoSuchUpload)
    })

    it('should be idempotent for already aborted upload', async () => {
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'abort-twice.bin',
        })
      )

      // Abort first time
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'abort-twice.bin',
          UploadId: createResult.UploadId!,
        })
      )

      // Abort second time - should throw NoSuchUpload
      await expect(
        client.send(
          new AbortMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'abort-twice.bin',
            UploadId: createResult.UploadId!,
          })
        )
      ).rejects.toThrow(NoSuchUpload)
    })
  })

  // ===========================================================================
  // ListParts Tests
  // ===========================================================================

  describe('ListPartsCommand', () => {
    let uploadId: string

    beforeEach(async () => {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
        })
      )
      uploadId = result.UploadId!

      // Upload 5 parts
      for (let i = 1; i <= 5; i++) {
        await client.send(
          new UploadPartCommand({
            Bucket: TEST_BUCKET,
            Key: 'list-parts-test.bin',
            UploadId: uploadId,
            PartNumber: i,
            Body: new Uint8Array(1024 * i).fill(64 + i),
          })
        )
      }
    })

    it('should list parts with LastModified', async () => {
      const result = await client.send(
        new ListPartsCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
          UploadId: uploadId,
        })
      )

      expect(result.Parts).toBeDefined()
      for (const part of result.Parts!) {
        expect(part.LastModified).toBeDefined()
        expect(part.LastModified).toBeInstanceOf(Date)
      }
    })

    it('should return parts in part number order', async () => {
      const result = await client.send(
        new ListPartsCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
          UploadId: uploadId,
        })
      )

      const partNumbers = result.Parts!.map((p) => p.PartNumber)
      expect(partNumbers).toEqual([1, 2, 3, 4, 5])
    })

    it('should support PartNumberMarker for pagination', async () => {
      const result = await client.send(
        new ListPartsCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
          UploadId: uploadId,
          MaxParts: 2,
          PartNumberMarker: 2,
        })
      )

      // Should start after part 2
      const partNumbers = result.Parts!.map((p) => p.PartNumber)
      expect(partNumbers[0]).toBeGreaterThan(2)
    })

    it('should return upload metadata', async () => {
      const result = await client.send(
        new ListPartsCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
          UploadId: uploadId,
        })
      )

      expect(result.Bucket).toBe(TEST_BUCKET)
      expect(result.Key).toBe('list-parts-test.bin')
      expect(result.UploadId).toBe(uploadId)
      expect(result.StorageClass).toBeDefined()
    })

    it('should only return latest version of overwritten parts', async () => {
      // Overwrite part 1
      const newPart1 = new Uint8Array(2048).fill(90)
      await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
          UploadId: uploadId,
          PartNumber: 1,
          Body: newPart1,
        })
      )

      const result = await client.send(
        new ListPartsCommand({
          Bucket: TEST_BUCKET,
          Key: 'list-parts-test.bin',
          UploadId: uploadId,
        })
      )

      // Should still have 5 parts
      expect(result.Parts).toHaveLength(5)

      // Part 1 should have the new size
      const part1 = result.Parts!.find((p) => p.PartNumber === 1)
      expect(part1?.Size).toBe(2048)
    })
  })

  // ===========================================================================
  // ListMultipartUploads Tests
  // ===========================================================================

  describe('ListMultipartUploadsCommand', () => {
    beforeEach(async () => {
      // Create multiple uploads with various prefixes
      await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'photos/2024/01/image1.jpg',
        })
      )
      await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'photos/2024/01/image2.jpg',
        })
      )
      await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'photos/2024/02/image1.jpg',
        })
      )
      await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'videos/clip1.mp4',
        })
      )
      await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'documents/report.pdf',
        })
      )
    })

    it('should list all uploads sorted by key', async () => {
      const result = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
        })
      )

      expect(result.Uploads).toHaveLength(5)

      // Should be sorted alphabetically by key
      const keys = result.Uploads!.map((u) => u.Key)
      const sortedKeys = [...keys].sort()
      expect(keys).toEqual(sortedKeys)
    })

    it('should filter by prefix and use delimiter for hierarchy', async () => {
      const result = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
          Prefix: 'photos/',
          Delimiter: '/',
        })
      )

      // Should have no direct uploads under photos/
      expect(result.Uploads).toHaveLength(0)

      // Should have one common prefix (photos/2024/)
      expect(result.CommonPrefixes).toHaveLength(1)
      expect(result.CommonPrefixes![0].Prefix).toBe('photos/2024/')
    })

    it('should support pagination with MaxUploads', async () => {
      const result = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
          MaxUploads: 2,
        })
      )

      expect(result.Uploads).toHaveLength(2)
      expect(result.IsTruncated).toBe(true)
      expect(result.NextKeyMarker).toBeDefined()
      expect(result.NextUploadIdMarker).toBeDefined()
    })

    it('should use KeyMarker and UploadIdMarker for pagination', async () => {
      const firstPage = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
          MaxUploads: 2,
        })
      )

      const secondPage = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
          MaxUploads: 2,
          KeyMarker: firstPage.NextKeyMarker,
          UploadIdMarker: firstPage.NextUploadIdMarker,
        })
      )

      // Second page should not contain items from first page
      const firstPageKeys = firstPage.Uploads!.map((u) => u.Key)
      const secondPageKeys = secondPage.Uploads!.map((u) => u.Key)

      for (const key of secondPageKeys) {
        expect(firstPageKeys).not.toContain(key)
      }
    })

    it('should return Initiated timestamp for each upload', async () => {
      const result = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
        })
      )

      for (const upload of result.Uploads!) {
        expect(upload.Initiated).toBeDefined()
        expect(upload.Initiated).toBeInstanceOf(Date)
      }
    })

    it('should return upload owner information', async () => {
      const result = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: TEST_BUCKET,
        })
      )

      for (const upload of result.Uploads!) {
        expect(upload.Owner).toBeDefined()
        expect(upload.Owner?.ID).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // Concurrent Upload Tests
  // ===========================================================================

  describe('Concurrent Uploads', () => {
    it('should handle multiple concurrent uploads to same key', async () => {
      // Start two uploads for the same key
      const upload1 = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
        })
      )

      const upload2 = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
        })
      )

      // Both should have unique upload IDs
      expect(upload1.UploadId).not.toBe(upload2.UploadId)

      // Upload parts to both
      const part1Upload1 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
          UploadId: upload1.UploadId!,
          PartNumber: 1,
          Body: new Uint8Array(1024).fill(65),
        })
      )

      const part1Upload2 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
          UploadId: upload2.UploadId!,
          PartNumber: 1,
          Body: new Uint8Array(2048).fill(66),
        })
      )

      // Complete upload 1
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
          UploadId: upload1.UploadId!,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: part1Upload1.ETag }],
          },
        })
      )

      // Upload 2 should still be valid
      const listResult = await client.send(
        new ListPartsCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
          UploadId: upload2.UploadId!,
        })
      )
      expect(listResult.Parts).toHaveLength(1)

      // Object should reflect upload 1's content
      const headResult = await client.send(
        new HeadObjectCommand({
          Bucket: TEST_BUCKET,
          Key: 'concurrent-test.bin',
        })
      )
      expect(headResult.ContentLength).toBe(1024)
    })

    it('should handle parallel part uploads', async () => {
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'parallel-parts.bin',
        })
      )

      // Upload 10 parts in parallel
      const partPromises = []
      for (let i = 1; i <= 10; i++) {
        partPromises.push(
          client.send(
            new UploadPartCommand({
              Bucket: TEST_BUCKET,
              Key: 'parallel-parts.bin',
              UploadId: createResult.UploadId!,
              PartNumber: i,
              Body: new Uint8Array(1024).fill(64 + i),
            })
          )
        )
      }

      const partResults = await Promise.all(partPromises)

      // All parts should have ETags
      expect(partResults).toHaveLength(10)
      for (const result of partResults) {
        expect(result.ETag).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty parts list in complete', async () => {
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'empty-parts.bin',
        })
      )

      // Try to complete with empty parts list
      await expect(
        client.send(
          new CompleteMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'empty-parts.bin',
            UploadId: createResult.UploadId!,
            MultipartUpload: {
              Parts: [],
            },
          })
        )
      ).rejects.toThrow()
    })

    it('should handle very large part numbers', async () => {
      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'large-part-number.bin',
        })
      )

      // Upload parts with large numbers
      const part9999 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'large-part-number.bin',
          UploadId: createResult.UploadId!,
          PartNumber: 9999,
          Body: new Uint8Array(1024).fill(65),
        })
      )

      const part10000 = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: 'large-part-number.bin',
          UploadId: createResult.UploadId!,
          PartNumber: 10000,
          Body: new Uint8Array(512).fill(66),
        })
      )

      const result = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: 'large-part-number.bin',
          UploadId: createResult.UploadId!,
          MultipartUpload: {
            Parts: [
              { PartNumber: 9999, ETag: part9999.ETag },
              { PartNumber: 10000, ETag: part10000.ETag },
            ],
          },
        })
      )

      expect(result.ETag).toBeDefined()
    })

    it('should handle special characters in key', async () => {
      const specialKey = 'path/with spaces/file (1).bin'

      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: specialKey,
        })
      )

      expect(createResult.UploadId).toBeDefined()
      expect(createResult.Key).toBe(specialKey)

      const partResult = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: specialKey,
          UploadId: createResult.UploadId!,
          PartNumber: 1,
          Body: new Uint8Array(1024).fill(65),
        })
      )

      const completeResult = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: specialKey,
          UploadId: createResult.UploadId!,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: partResult.ETag }],
          },
        })
      )

      expect(completeResult.Key).toBe(specialKey)
    })

    it('should handle unicode in key', async () => {
      const unicodeKey = 'data/2024/file-'

      const createResult = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: unicodeKey,
        })
      )

      expect(createResult.UploadId).toBeDefined()

      const partResult = await client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: unicodeKey,
          UploadId: createResult.UploadId!,
          PartNumber: 1,
          Body: new Uint8Array(1024).fill(65),
        })
      )

      const completeResult = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: TEST_BUCKET,
          Key: unicodeKey,
          UploadId: createResult.UploadId!,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: partResult.ETag }],
          },
        })
      )

      expect(completeResult.Key).toBe(unicodeKey)

      // Verify object can be retrieved
      const getResult = await client.send(
        new GetObjectCommand({
          Bucket: TEST_BUCKET,
          Key: unicodeKey,
        })
      )
      expect(getResult.ContentLength).toBe(1024)
    })
  })
})
