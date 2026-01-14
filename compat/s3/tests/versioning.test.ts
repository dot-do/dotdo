/**
 * @dotdo/s3 - Object Versioning Tests
 *
 * Comprehensive tests for S3 object versioning functionality:
 * - Put/Get/Delete with version IDs
 * - Delete markers
 * - ListObjectVersions
 * - Version-specific operations
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  NoSuchKey,
  _clearAll,
} from '../index'

describe('@dotdo/s3 - Object Versioning', () => {
  let client: InstanceType<typeof S3Client>

  beforeEach(() => {
    _clearAll()
    client = new S3Client({ region: 'us-east-1' })
  })

  // ===========================================================================
  // Bucket Versioning Configuration
  // ===========================================================================

  describe('Bucket Versioning Configuration', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
    })

    it('should enable versioning on a bucket', async () => {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      const result = await client.send(
        new GetBucketVersioningCommand({ Bucket: 'versioned-bucket' })
      )
      expect(result.Status).toBe('Enabled')
    })

    it('should suspend versioning on a bucket', async () => {
      // First enable
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      // Then suspend
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Suspended' },
        })
      )

      const result = await client.send(
        new GetBucketVersioningCommand({ Bucket: 'versioned-bucket' })
      )
      expect(result.Status).toBe('Suspended')
    })

    it('should return undefined status for never-versioned bucket', async () => {
      const result = await client.send(
        new GetBucketVersioningCommand({ Bucket: 'versioned-bucket' })
      )
      expect(result.Status).toBeUndefined()
    })

    it('should support MFA Delete configuration', async () => {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled', MFADelete: 'Disabled' },
        })
      )

      const result = await client.send(
        new GetBucketVersioningCommand({ Bucket: 'versioned-bucket' })
      )
      expect(result.Status).toBe('Enabled')
      expect(result.MFADelete).toBe('Disabled')
    })
  })

  // ===========================================================================
  // PutObject with Versioning
  // ===========================================================================

  describe('PutObject with Versioning', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )
    })

    it('should return VersionId when putting object to versioned bucket', async () => {
      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Hello World',
        })
      )

      expect(result.VersionId).toBeDefined()
      expect(result.VersionId).not.toBe('null')
    })

    it('should generate different VersionIds for multiple puts of same key', async () => {
      const result1 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 1',
        })
      )

      const result2 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 2',
        })
      )

      expect(result1.VersionId).toBeDefined()
      expect(result2.VersionId).toBeDefined()
      expect(result1.VersionId).not.toBe(result2.VersionId)
    })

    it('should preserve all versions when overwriting', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 1',
        })
      )

      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 2',
        })
      )

      const versions = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          Prefix: 'test.txt',
        })
      )

      expect(versions.Versions).toHaveLength(2)
    })

    it('should not return VersionId for non-versioned bucket', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'non-versioned-bucket' }))

      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'non-versioned-bucket',
          Key: 'test.txt',
          Body: 'Hello',
        })
      )

      expect(result.VersionId).toBeUndefined()
    })

    it('should use null version ID when versioning is suspended', async () => {
      // First enable and put an object
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 1',
        })
      )

      // Suspend versioning
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Suspended' },
        })
      )

      // Put another object
      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 2 (suspended)',
        })
      )

      // Should get null version ID when suspended
      expect(result.VersionId).toBe('null')
    })
  })

  // ===========================================================================
  // GetObject with Versioning
  // ===========================================================================

  describe('GetObject with Versioning', () => {
    let version1Id: string
    let version2Id: string

    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      // Create two versions
      const result1 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 1 content',
        })
      )
      version1Id = result1.VersionId!

      const result2 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 2 content',
        })
      )
      version2Id = result2.VersionId!
    })

    it('should get latest version by default', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      const content = await result.Body!.transformToString()
      expect(content).toBe('Version 2 content')
      expect(result.VersionId).toBe(version2Id)
    })

    it('should get specific version by VersionId', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          VersionId: version1Id,
        })
      )

      const content = await result.Body!.transformToString()
      expect(content).toBe('Version 1 content')
      expect(result.VersionId).toBe(version1Id)
    })

    it('should get old version after key is deleted (via delete marker)', async () => {
      // Delete the object (creates delete marker)
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      // Getting without version should fail (delete marker is latest)
      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'versioned-bucket',
            Key: 'test.txt',
          })
        )
      ).rejects.toThrow(NoSuchKey)

      // But getting specific version should still work
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          VersionId: version1Id,
        })
      )

      const content = await result.Body!.transformToString()
      expect(content).toBe('Version 1 content')
    })

    it('should return VersionId in response', async () => {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      expect(result.VersionId).toBeDefined()
      expect(result.VersionId).toBe(version2Id)
    })
  })

  // ===========================================================================
  // HeadObject with Versioning
  // ===========================================================================

  describe('HeadObject with Versioning', () => {
    let version1Id: string
    let version2Id: string

    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      const result1 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 1',
          ContentType: 'text/plain',
        })
      )
      version1Id = result1.VersionId!

      const result2 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 2 is longer',
          ContentType: 'text/html',
        })
      )
      version2Id = result2.VersionId!
    })

    it('should head latest version by default', async () => {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      expect(result.ContentLength).toBe(19) // 'Version 2 is longer'
      expect(result.ContentType).toBe('text/html')
      expect(result.VersionId).toBe(version2Id)
    })

    it('should head specific version by VersionId', async () => {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          VersionId: version1Id,
        })
      )

      expect(result.ContentLength).toBe(9) // 'Version 1'
      expect(result.ContentType).toBe('text/plain')
      expect(result.VersionId).toBe(version1Id)
    })
  })

  // ===========================================================================
  // DeleteObject with Versioning
  // ===========================================================================

  describe('DeleteObject with Versioning', () => {
    let versionId: string

    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Test content',
        })
      )
      versionId = result.VersionId!
    })

    it('should create delete marker when deleting without VersionId', async () => {
      const result = await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      expect(result.DeleteMarker).toBe(true)
      expect(result.VersionId).toBeDefined()
      expect(result.VersionId).not.toBe(versionId)
    })

    it('should permanently delete specific version', async () => {
      // Delete specific version
      const result = await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          VersionId: versionId,
        })
      )

      expect(result.VersionId).toBe(versionId)
      expect(result.DeleteMarker).toBeUndefined()

      // List versions should be empty
      const versions = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          Prefix: 'test.txt',
        })
      )

      expect(versions.Versions?.length || 0).toBe(0)
    })

    it('should show delete marker in ListObjectVersions', async () => {
      // Create delete marker
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      const versions = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
        })
      )

      expect(versions.DeleteMarkers).toBeDefined()
      expect(versions.DeleteMarkers!.length).toBeGreaterThan(0)

      const deleteMarker = versions.DeleteMarkers!.find((dm) => dm.Key === 'test.txt')
      expect(deleteMarker).toBeDefined()
      expect(deleteMarker!.IsLatest).toBe(true)
    })

    it('should restore object by deleting delete marker', async () => {
      // Create delete marker
      const deleteResult = await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )
      const deleteMarkerId = deleteResult.VersionId!

      // Verify object is "deleted"
      await expect(
        client.send(
          new GetObjectCommand({
            Bucket: 'versioned-bucket',
            Key: 'test.txt',
          })
        )
      ).rejects.toThrow(NoSuchKey)

      // Delete the delete marker
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          VersionId: deleteMarkerId,
        })
      )

      // Object should be accessible again
      const result = await client.send(
        new GetObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      const content = await result.Body!.transformToString()
      expect(content).toBe('Test content')
    })

    it('should not create delete marker in non-versioned bucket', async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'non-versioned-bucket' }))
      await client.send(
        new PutObjectCommand({
          Bucket: 'non-versioned-bucket',
          Key: 'test.txt',
          Body: 'Hello',
        })
      )

      const result = await client.send(
        new DeleteObjectCommand({
          Bucket: 'non-versioned-bucket',
          Key: 'test.txt',
        })
      )

      expect(result.DeleteMarker).toBeUndefined()
      expect(result.VersionId).toBeUndefined()
    })
  })

  // ===========================================================================
  // ListObjectVersions
  // ===========================================================================

  describe('ListObjectVersionsCommand', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )
    })

    it('should list all versions of an object', async () => {
      // Create 3 versions
      for (let i = 1; i <= 3; i++) {
        await client.send(
          new PutObjectCommand({
            Bucket: 'versioned-bucket',
            Key: 'test.txt',
            Body: `Version ${i}`,
          })
        )
      }

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
        })
      )

      expect(result.Versions).toHaveLength(3)
    })

    it('should mark latest version correctly', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 1',
        })
      )

      const putResult = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Version 2',
        })
      )

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
        })
      )

      const latestVersion = result.Versions!.find((v) => v.IsLatest)
      expect(latestVersion).toBeDefined()
      expect(latestVersion!.VersionId).toBe(putResult.VersionId)
    })

    it('should filter by prefix', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'folder1/file.txt',
          Body: 'Content 1',
        })
      )

      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'folder2/file.txt',
          Body: 'Content 2',
        })
      )

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          Prefix: 'folder1/',
        })
      )

      expect(result.Versions).toHaveLength(1)
      expect(result.Versions![0].Key).toBe('folder1/file.txt')
    })

    it('should support delimiter for folder-like listing', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'folder1/file.txt',
          Body: 'Content',
        })
      )

      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'folder2/file.txt',
          Body: 'Content',
        })
      )

      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'root.txt',
          Body: 'Content',
        })
      )

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          Delimiter: '/',
        })
      )

      expect(result.Versions).toHaveLength(1) // Only root.txt
      expect(result.CommonPrefixes).toHaveLength(2) // folder1/, folder2/
    })

    it('should paginate with MaxKeys', async () => {
      // Create 5 objects
      for (let i = 1; i <= 5; i++) {
        await client.send(
          new PutObjectCommand({
            Bucket: 'versioned-bucket',
            Key: `file${i}.txt`,
            Body: `Content ${i}`,
          })
        )
      }

      const result1 = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          MaxKeys: 2,
        })
      )

      expect(result1.Versions).toHaveLength(2)
      expect(result1.IsTruncated).toBe(true)
      expect(result1.NextKeyMarker).toBeDefined()

      const result2 = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          MaxKeys: 2,
          KeyMarker: result1.NextKeyMarker,
        })
      )

      expect(result2.Versions).toHaveLength(2)
    })

    it('should include both versions and delete markers', async () => {
      // Create object
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Content',
        })
      )

      // Delete it (creates delete marker)
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
        })
      )

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
        })
      )

      expect(result.Versions).toHaveLength(1)
      expect(result.DeleteMarkers).toHaveLength(1)
    })

    it('should include version metadata', async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'test.txt',
          Body: 'Test content here',
          StorageClass: 'STANDARD',
        })
      )

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
        })
      )

      const version = result.Versions![0]
      expect(version.Key).toBe('test.txt')
      expect(version.VersionId).toBeDefined()
      expect(version.LastModified).toBeInstanceOf(Date)
      expect(version.ETag).toBeDefined()
      expect(version.Size).toBe(17) // 'Test content here'
      expect(version.StorageClass).toBe('STANDARD')
    })

    it('should return null version ID for objects created before versioning', async () => {
      // Create bucket without versioning
      await client.send(new CreateBucketCommand({ Bucket: 'unversioned-first' }))

      // Put object before enabling versioning
      await client.send(
        new PutObjectCommand({
          Bucket: 'unversioned-first',
          Key: 'pre-versioning.txt',
          Body: 'Created before versioning',
        })
      )

      // Now enable versioning
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'unversioned-first',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      const result = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'unversioned-first',
        })
      )

      // Object created before versioning should have null version ID
      expect(result.Versions).toHaveLength(1)
      expect(result.Versions![0].VersionId).toBe('null')
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Versioning Edge Cases', () => {
    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: 'versioned-bucket' }))
    })

    it('should handle rapid successive puts', async () => {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      // Rapid puts
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          client.send(
            new PutObjectCommand({
              Bucket: 'versioned-bucket',
              Key: 'rapid-test.txt',
              Body: `Version ${i}`,
            })
          )
        )
      }

      const results = await Promise.all(promises)

      // All should have unique version IDs
      const versionIds = results.map((r) => r.VersionId)
      const uniqueIds = new Set(versionIds)
      expect(uniqueIds.size).toBe(10)
    })

    it('should handle empty object versions', async () => {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      const result = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'empty.txt',
          Body: '',
        })
      )

      expect(result.VersionId).toBeDefined()

      const getResult = await client.send(
        new GetObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'empty.txt',
          VersionId: result.VersionId,
        })
      )

      const content = await getResult.Body!.transformToString()
      expect(content).toBe('')
    })

    it('should handle objects with same content but different versions', async () => {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      const result1 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'same-content.txt',
          Body: 'Same content',
        })
      )

      const result2 = await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'same-content.txt',
          Body: 'Same content',
        })
      )

      // Same content should still create different versions
      expect(result1.VersionId).not.toBe(result2.VersionId)

      const versions = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
          Prefix: 'same-content.txt',
        })
      )

      expect(versions.Versions).toHaveLength(2)
    })

    it('should handle multiple delete markers on same key', async () => {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: 'versioned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )

      // Create object
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'multi-delete.txt',
          Body: 'Content',
        })
      )

      // Delete (creates first delete marker)
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'multi-delete.txt',
        })
      )

      // Put new version
      await client.send(
        new PutObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'multi-delete.txt',
          Body: 'New Content',
        })
      )

      // Delete again (creates second delete marker)
      await client.send(
        new DeleteObjectCommand({
          Bucket: 'versioned-bucket',
          Key: 'multi-delete.txt',
        })
      )

      const versions = await client.send(
        new ListObjectVersionsCommand({
          Bucket: 'versioned-bucket',
        })
      )

      // Should have 2 object versions and 2 delete markers
      expect(versions.Versions).toHaveLength(2)
      expect(versions.DeleteMarkers).toHaveLength(2)

      // Only the most recent delete marker should be IsLatest
      const latestDeleteMarkers = versions.DeleteMarkers!.filter((dm) => dm.IsLatest)
      expect(latestDeleteMarkers).toHaveLength(1)
    })
  })
})
