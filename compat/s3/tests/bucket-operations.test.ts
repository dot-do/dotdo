/**
 * @dotdo/s3 - Bucket Operations Tests (RED Phase)
 *
 * TDD RED tests for comprehensive S3 bucket operations.
 * These tests define expected behavior for bucket management features
 * that may not be fully implemented yet.
 *
 * Tests cover:
 * 1. CreateBucket - various configurations (region, ACL, object ownership)
 * 2. DeleteBucket - empty and non-empty buckets
 * 3. HeadBucket - existence check and region detection
 * 4. ListBuckets - pagination and filtering
 * 5. Bucket CORS configuration
 * 6. Bucket lifecycle policies
 * 7. Bucket versioning
 *
 * Issue: dotdo-cdljk
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  // CORS commands
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  DeleteBucketCorsCommand,
  // Lifecycle commands
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  DeleteBucketLifecycleCommand,
  // Versioning commands
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  // Error classes
  NoSuchBucket,
  BucketAlreadyExists,
  BucketAlreadyOwnedByYou,
  BucketNotEmpty,
  InvalidBucketName,
  _clearAll,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('S3 Bucket Operations (RED Phase)', () => {
  let client: InstanceType<typeof S3Client>

  beforeEach(() => {
    _clearAll()
    client = new S3Client({ region: 'us-east-1' })
  })

  afterEach(() => {
    _clearAll()
  })

  // ===========================================================================
  // CreateBucket Tests
  // ===========================================================================

  describe('CreateBucketCommand', () => {
    describe('Basic Creation', () => {
      it('should create a bucket with minimal configuration', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'my-test-bucket',
          })
        )

        expect(result.Location).toBeDefined()
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should return location in response', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'bucket-with-location',
          })
        )

        expect(result.Location).toContain('bucket-with-location')
      })

      it('should create bucket with hyphenated name', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'my-hyphenated-bucket-name',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with numeric suffix', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'bucket-123',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket starting with number', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: '123-bucket',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Region Configuration', () => {
      it('should create bucket in specific region', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'eu-regional-bucket',
            CreateBucketConfiguration: {
              LocationConstraint: 'eu-west-1',
            },
          })
        )

        expect(result.Location).toBeDefined()
        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket in us-east-1 without LocationConstraint', async () => {
        // us-east-1 is the default and doesn't need LocationConstraint
        const usEast1Client = new S3Client({ region: 'us-east-1' })
        const result = await usEast1Client.send(
          new CreateBucketCommand({
            Bucket: 'us-east-bucket',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket in ap-southeast-1 region', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'ap-southeast-bucket',
            CreateBucketConfiguration: {
              LocationConstraint: 'ap-southeast-1',
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should preserve region constraint after creation', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'regional-bucket',
            CreateBucketConfiguration: {
              LocationConstraint: 'eu-central-1',
            },
          })
        )

        const headResult = await client.send(
          new HeadBucketCommand({
            Bucket: 'regional-bucket',
          })
        )

        expect(headResult.BucketRegion).toBe('eu-central-1')
      })
    })

    describe('ACL Configuration', () => {
      it('should create private bucket (default)', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'private-bucket',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with private ACL', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'explicit-private-bucket',
            ACL: 'private',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with public-read ACL', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'public-read-bucket',
            ACL: 'public-read',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with public-read-write ACL', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'public-read-write-bucket',
            ACL: 'public-read-write',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with authenticated-read ACL', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'authenticated-read-bucket',
            ACL: 'authenticated-read',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Error Handling', () => {
      it('should throw BucketAlreadyExists for duplicate bucket name', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'existing-bucket',
          })
        )

        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'existing-bucket',
            })
          )
        ).rejects.toThrow(BucketAlreadyExists)
      })

      it('should throw BucketAlreadyOwnedByYou when recreating owned bucket', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'owned-bucket',
          })
        )

        // Same owner trying to create same bucket should get specific error
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'owned-bucket',
            })
          )
        ).rejects.toThrow(BucketAlreadyOwnedByYou)
      })

      it('should throw InvalidBucketName for too short name', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'ab', // Less than 3 characters
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for too long name', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'a'.repeat(64), // More than 63 characters
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for uppercase characters', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'MyBucket',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for underscores', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'my_bucket',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for bucket starting with hyphen', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: '-my-bucket',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for bucket ending with hyphen', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'my-bucket-',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for consecutive periods', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'my..bucket',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for IP address format', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: '192.168.1.1',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for xn-- prefix (IDN)', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'xn--bucket',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })

      it('should throw InvalidBucketName for -s3alias suffix', async () => {
        await expect(
          client.send(
            new CreateBucketCommand({
              Bucket: 'bucket-s3alias',
            })
          )
        ).rejects.toThrow(InvalidBucketName)
      })
    })

    describe('Object Ownership Configuration', () => {
      it('should create bucket with BucketOwnerEnforced ownership', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'owner-enforced-bucket',
            ObjectOwnership: 'BucketOwnerEnforced',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with BucketOwnerPreferred ownership', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'owner-preferred-bucket',
            ObjectOwnership: 'BucketOwnerPreferred',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should create bucket with ObjectWriter ownership', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'object-writer-bucket',
            ObjectOwnership: 'ObjectWriter',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Object Lock Configuration', () => {
      it('should create bucket with object lock enabled', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'object-lock-bucket',
            ObjectLockEnabledForBucket: true,
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should default to object lock disabled', async () => {
        const result = await client.send(
          new CreateBucketCommand({
            Bucket: 'default-bucket',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
        // Object lock is not enabled by default
      })
    })
  })

  // ===========================================================================
  // DeleteBucket Tests
  // ===========================================================================

  describe('DeleteBucketCommand', () => {
    describe('Empty Bucket Deletion', () => {
      it('should delete an empty bucket', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'bucket-to-delete',
          })
        )

        const result = await client.send(
          new DeleteBucketCommand({
            Bucket: 'bucket-to-delete',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)
      })

      it('should verify bucket no longer exists after deletion', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'verify-deletion',
          })
        )

        await client.send(
          new DeleteBucketCommand({
            Bucket: 'verify-deletion',
          })
        )

        await expect(
          client.send(
            new HeadBucketCommand({
              Bucket: 'verify-deletion',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should remove bucket from ListBuckets after deletion', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'list-deletion-test',
          })
        )

        await client.send(
          new DeleteBucketCommand({
            Bucket: 'list-deletion-test',
          })
        )

        const result = await client.send(new ListBucketsCommand({}))
        const bucketNames = result.Buckets?.map((b) => b.Name) || []
        expect(bucketNames).not.toContain('list-deletion-test')
      })

      it('should delete newly created bucket immediately', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'immediate-delete',
          })
        )

        const result = await client.send(
          new DeleteBucketCommand({
            Bucket: 'immediate-delete',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)
      })
    })

    describe('Non-Empty Bucket Deletion', () => {
      it('should throw BucketNotEmpty for bucket with objects', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'non-empty-bucket',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: 'non-empty-bucket',
            Key: 'test-file.txt',
            Body: 'test content',
          })
        )

        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'non-empty-bucket',
            })
          )
        ).rejects.toThrow(BucketNotEmpty)
      })

      it('should throw BucketNotEmpty for bucket with single object', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'single-object-bucket',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: 'single-object-bucket',
            Key: 'only-file.txt',
            Body: 'content',
          })
        )

        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'single-object-bucket',
            })
          )
        ).rejects.toThrow(BucketNotEmpty)
      })

      it('should throw BucketNotEmpty for bucket with many objects', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'many-objects-bucket',
          })
        )

        // Create multiple objects
        for (let i = 0; i < 10; i++) {
          await client.send(
            new PutObjectCommand({
              Bucket: 'many-objects-bucket',
              Key: `file-${i}.txt`,
              Body: `content ${i}`,
            })
          )
        }

        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'many-objects-bucket',
            })
          )
        ).rejects.toThrow(BucketNotEmpty)
      })

      it('should throw BucketNotEmpty for bucket with nested objects', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'nested-objects-bucket',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: 'nested-objects-bucket',
            Key: 'folder/subfolder/file.txt',
            Body: 'nested content',
          })
        )

        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'nested-objects-bucket',
            })
          )
        ).rejects.toThrow(BucketNotEmpty)
      })

      it('should throw BucketNotEmpty for bucket with zero-byte objects', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'zero-byte-bucket',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: 'zero-byte-bucket',
            Key: 'empty-file.txt',
            Body: '',
          })
        )

        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'zero-byte-bucket',
            })
          )
        ).rejects.toThrow(BucketNotEmpty)
      })
    })

    describe('Error Handling', () => {
      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should throw NoSuchBucket for already deleted bucket', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'delete-twice',
          })
        )

        await client.send(
          new DeleteBucketCommand({
            Bucket: 'delete-twice',
          })
        )

        await expect(
          client.send(
            new DeleteBucketCommand({
              Bucket: 'delete-twice',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('Idempotency', () => {
      it('should not affect other buckets when deleting', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'keep-bucket',
          })
        )
        await client.send(
          new CreateBucketCommand({
            Bucket: 'delete-bucket',
          })
        )

        await client.send(
          new DeleteBucketCommand({
            Bucket: 'delete-bucket',
          })
        )

        // Other bucket should still exist
        const headResult = await client.send(
          new HeadBucketCommand({
            Bucket: 'keep-bucket',
          })
        )
        expect(headResult.$metadata.httpStatusCode).toBe(200)
      })
    })
  })

  // ===========================================================================
  // HeadBucket Tests
  // ===========================================================================

  describe('HeadBucketCommand', () => {
    describe('Existence Check', () => {
      it('should return 200 for existing bucket', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'existing-bucket',
          })
        )

        const result = await client.send(
          new HeadBucketCommand({
            Bucket: 'existing-bucket',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new HeadBucketCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should check bucket immediately after creation', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'immediate-check',
          })
        )

        const result = await client.send(
          new HeadBucketCommand({
            Bucket: 'immediate-check',
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Region Detection', () => {
      it('should return BucketRegion for bucket', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'regional-head-bucket',
            CreateBucketConfiguration: {
              LocationConstraint: 'eu-west-1',
            },
          })
        )

        const result = await client.send(
          new HeadBucketCommand({
            Bucket: 'regional-head-bucket',
          })
        )

        expect(result.BucketRegion).toBe('eu-west-1')
      })

      it('should return us-east-1 for bucket without LocationConstraint', async () => {
        const usEast1Client = new S3Client({ region: 'us-east-1' })
        await usEast1Client.send(
          new CreateBucketCommand({
            Bucket: 'us-east-bucket',
          })
        )

        const result = await usEast1Client.send(
          new HeadBucketCommand({
            Bucket: 'us-east-bucket',
          })
        )

        // us-east-1 buckets may return null or 'us-east-1' for BucketRegion
        expect(result.BucketRegion === null || result.BucketRegion === 'us-east-1').toBe(true)
      })

      it('should detect region from different client region', async () => {
        // Create bucket in eu-west-1
        await client.send(
          new CreateBucketCommand({
            Bucket: 'cross-region-bucket',
            CreateBucketConfiguration: {
              LocationConstraint: 'eu-west-1',
            },
          })
        )

        // Query from different region client
        const apClient = new S3Client({ region: 'ap-southeast-1' })
        const result = await apClient.send(
          new HeadBucketCommand({
            Bucket: 'cross-region-bucket',
          })
        )

        expect(result.BucketRegion).toBe('eu-west-1')
      })
    })

    describe('Access Level Information', () => {
      it('should return AccessPointAlias when applicable', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'access-point-bucket',
          })
        )

        const result = await client.send(
          new HeadBucketCommand({
            Bucket: 'access-point-bucket',
          })
        )

        // AccessPointAlias is optional
        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })
  })

  // ===========================================================================
  // ListBuckets Tests
  // ===========================================================================

  describe('ListBucketsCommand', () => {
    describe('Basic Listing', () => {
      it('should list all buckets', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'list-bucket-1' }))
        await client.send(new CreateBucketCommand({ Bucket: 'list-bucket-2' }))
        await client.send(new CreateBucketCommand({ Bucket: 'list-bucket-3' }))

        const result = await client.send(new ListBucketsCommand({}))

        expect(result.Buckets).toHaveLength(3)
        const bucketNames = result.Buckets!.map((b) => b.Name)
        expect(bucketNames).toContain('list-bucket-1')
        expect(bucketNames).toContain('list-bucket-2')
        expect(bucketNames).toContain('list-bucket-3')
      })

      it('should return empty array when no buckets exist', async () => {
        const result = await client.send(new ListBucketsCommand({}))

        expect(result.Buckets).toEqual([])
      })

      it('should return Owner information', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'owner-test-bucket' }))

        const result = await client.send(new ListBucketsCommand({}))

        expect(result.Owner).toBeDefined()
        expect(result.Owner?.ID).toBeDefined()
        expect(result.Owner?.DisplayName).toBeDefined()
      })

      it('should include CreationDate for each bucket', async () => {
        const beforeCreate = new Date()
        await client.send(new CreateBucketCommand({ Bucket: 'date-test-bucket' }))
        const afterCreate = new Date()

        const result = await client.send(new ListBucketsCommand({}))

        const bucket = result.Buckets!.find((b) => b.Name === 'date-test-bucket')
        expect(bucket).toBeDefined()
        expect(bucket!.CreationDate).toBeInstanceOf(Date)
        expect(bucket!.CreationDate!.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
        expect(bucket!.CreationDate!.getTime()).toBeLessThanOrEqual(afterCreate.getTime())
      })

      it('should list single bucket', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'single-bucket' }))

        const result = await client.send(new ListBucketsCommand({}))

        expect(result.Buckets).toHaveLength(1)
        expect(result.Buckets![0].Name).toBe('single-bucket')
      })
    })

    describe('Pagination', () => {
      it('should support MaxBuckets parameter', async () => {
        // Create multiple buckets
        for (let i = 0; i < 10; i++) {
          await client.send(
            new CreateBucketCommand({
              Bucket: `paginated-bucket-${i.toString().padStart(2, '0')}`,
            })
          )
        }

        const result = await client.send(
          new ListBucketsCommand({
            MaxBuckets: 5,
          })
        )

        expect(result.Buckets).toHaveLength(5)
      })

      it('should return ContinuationToken when more buckets exist', async () => {
        // Create multiple buckets
        for (let i = 0; i < 10; i++) {
          await client.send(
            new CreateBucketCommand({
              Bucket: `continuation-bucket-${i.toString().padStart(2, '0')}`,
            })
          )
        }

        const result = await client.send(
          new ListBucketsCommand({
            MaxBuckets: 5,
          })
        )

        expect(result.ContinuationToken).toBeDefined()
      })

      it('should use ContinuationToken to get next page', async () => {
        // Create multiple buckets
        for (let i = 0; i < 10; i++) {
          await client.send(
            new CreateBucketCommand({
              Bucket: `page-bucket-${i.toString().padStart(2, '0')}`,
            })
          )
        }

        const page1 = await client.send(
          new ListBucketsCommand({
            MaxBuckets: 5,
          })
        )

        const page2 = await client.send(
          new ListBucketsCommand({
            MaxBuckets: 5,
            ContinuationToken: page1.ContinuationToken,
          })
        )

        expect(page2.Buckets).toHaveLength(5)

        // Ensure no overlap
        const page1Names = new Set(page1.Buckets!.map((b) => b.Name))
        const page2Names = page2.Buckets!.map((b) => b.Name)
        for (const name of page2Names) {
          expect(page1Names.has(name)).toBe(false)
        }
      })

      it('should return null ContinuationToken on last page', async () => {
        // Create exactly 3 buckets
        for (let i = 0; i < 3; i++) {
          await client.send(
            new CreateBucketCommand({
              Bucket: `last-page-bucket-${i}`,
            })
          )
        }

        const result = await client.send(
          new ListBucketsCommand({
            MaxBuckets: 5,
          })
        )

        expect(result.ContinuationToken).toBeUndefined()
      })
    })

    describe('Filtering', () => {
      it('should support Prefix filter', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'prod-bucket-1' }))
        await client.send(new CreateBucketCommand({ Bucket: 'prod-bucket-2' }))
        await client.send(new CreateBucketCommand({ Bucket: 'dev-bucket-1' }))
        await client.send(new CreateBucketCommand({ Bucket: 'staging-bucket-1' }))

        const result = await client.send(
          new ListBucketsCommand({
            BucketRegion: undefined,
            Prefix: 'prod-',
          })
        )

        expect(result.Buckets).toHaveLength(2)
        expect(result.Buckets!.every((b) => b.Name!.startsWith('prod-'))).toBe(true)
      })

      it('should return empty when no buckets match prefix', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'bucket-1' }))
        await client.send(new CreateBucketCommand({ Bucket: 'bucket-2' }))

        const result = await client.send(
          new ListBucketsCommand({
            Prefix: 'nonexistent-',
          })
        )

        expect(result.Buckets).toHaveLength(0)
      })

      it('should filter by BucketRegion', async () => {
        await client.send(
          new CreateBucketCommand({
            Bucket: 'eu-bucket-1',
            CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
          })
        )
        await client.send(
          new CreateBucketCommand({
            Bucket: 'eu-bucket-2',
            CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
          })
        )
        await client.send(
          new CreateBucketCommand({
            Bucket: 'ap-bucket-1',
            CreateBucketConfiguration: { LocationConstraint: 'ap-southeast-1' },
          })
        )

        const result = await client.send(
          new ListBucketsCommand({
            BucketRegion: 'eu-west-1',
          })
        )

        expect(result.Buckets).toHaveLength(2)
        expect(result.Buckets!.every((b) => b.Name!.startsWith('eu-'))).toBe(true)
      })
    })

    describe('Sorting', () => {
      it('should return buckets sorted alphabetically', async () => {
        await client.send(new CreateBucketCommand({ Bucket: 'charlie-bucket' }))
        await client.send(new CreateBucketCommand({ Bucket: 'alpha-bucket' }))
        await client.send(new CreateBucketCommand({ Bucket: 'bravo-bucket' }))

        const result = await client.send(new ListBucketsCommand({}))

        const names = result.Buckets!.map((b) => b.Name)
        expect(names).toEqual(['alpha-bucket', 'bravo-bucket', 'charlie-bucket'])
      })
    })
  })

  // ===========================================================================
  // Bucket CORS Configuration Tests
  // ===========================================================================

  describe('Bucket CORS Configuration', () => {
    const TEST_BUCKET = 'cors-test-bucket'

    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
    })

    describe('PutBucketCors', () => {
      it('should set CORS configuration with single rule', async () => {
        const result = await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://example.com'],
                  AllowedMethods: ['GET', 'PUT'],
                  AllowedHeaders: ['*'],
                  MaxAgeSeconds: 3600,
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set CORS configuration with multiple rules', async () => {
        const result = await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://example.com'],
                  AllowedMethods: ['GET'],
                  AllowedHeaders: ['Content-Type'],
                },
                {
                  AllowedOrigins: ['https://app.example.com'],
                  AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE'],
                  AllowedHeaders: ['*'],
                  ExposeHeaders: ['x-amz-server-side-encryption'],
                  MaxAgeSeconds: 7200,
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set CORS configuration with wildcard origin', async () => {
        const result = await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['*'],
                  AllowedMethods: ['GET'],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set CORS configuration with all HTTP methods', async () => {
        const result = await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://example.com'],
                  AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                  AllowedHeaders: ['*'],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set CORS configuration with ExposeHeaders', async () => {
        const result = await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://example.com'],
                  AllowedMethods: ['GET'],
                  ExposeHeaders: ['ETag', 'x-amz-meta-custom'],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new PutBucketCorsCommand({
              Bucket: 'non-existent-bucket',
              CORSConfiguration: {
                CORSRules: [
                  {
                    AllowedOrigins: ['*'],
                    AllowedMethods: ['GET'],
                  },
                ],
              },
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should replace existing CORS configuration', async () => {
        // Set initial CORS
        await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://old.example.com'],
                  AllowedMethods: ['GET'],
                },
              ],
            },
          })
        )

        // Replace with new CORS
        await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://new.example.com'],
                  AllowedMethods: ['PUT'],
                },
              ],
            },
          })
        )

        const result = await client.send(
          new GetBucketCorsCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.CORSRules).toHaveLength(1)
        expect(result.CORSRules![0].AllowedOrigins).toEqual(['https://new.example.com'])
      })
    })

    describe('GetBucketCors', () => {
      it('should get CORS configuration', async () => {
        await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['https://example.com'],
                  AllowedMethods: ['GET', 'PUT'],
                  AllowedHeaders: ['Content-Type'],
                  ExposeHeaders: ['ETag'],
                  MaxAgeSeconds: 3600,
                },
              ],
            },
          })
        )

        const result = await client.send(
          new GetBucketCorsCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.CORSRules).toHaveLength(1)
        expect(result.CORSRules![0].AllowedOrigins).toEqual(['https://example.com'])
        expect(result.CORSRules![0].AllowedMethods).toEqual(['GET', 'PUT'])
        expect(result.CORSRules![0].AllowedHeaders).toEqual(['Content-Type'])
        expect(result.CORSRules![0].ExposeHeaders).toEqual(['ETag'])
        expect(result.CORSRules![0].MaxAgeSeconds).toBe(3600)
      })

      it('should throw NoSuchCORSConfiguration when CORS not set', async () => {
        await expect(
          client.send(
            new GetBucketCorsCommand({
              Bucket: TEST_BUCKET,
            })
          )
        ).rejects.toThrow('NoSuchCORSConfiguration')
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new GetBucketCorsCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('DeleteBucketCors', () => {
      it('should delete CORS configuration', async () => {
        await client.send(
          new PutBucketCorsCommand({
            Bucket: TEST_BUCKET,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ['*'],
                  AllowedMethods: ['GET'],
                },
              ],
            },
          })
        )

        const result = await client.send(
          new DeleteBucketCorsCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)

        // Verify CORS is deleted
        await expect(
          client.send(
            new GetBucketCorsCommand({
              Bucket: TEST_BUCKET,
            })
          )
        ).rejects.toThrow('NoSuchCORSConfiguration')
      })

      it('should succeed even if CORS not set (idempotent)', async () => {
        const result = await client.send(
          new DeleteBucketCorsCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new DeleteBucketCorsCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })
  })

  // ===========================================================================
  // Bucket Lifecycle Configuration Tests
  // ===========================================================================

  describe('Bucket Lifecycle Configuration', () => {
    const TEST_BUCKET = 'lifecycle-test-bucket'

    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
    })

    describe('PutBucketLifecycleConfiguration', () => {
      it('should set lifecycle with expiration rule', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-old-files',
                  Status: 'Enabled',
                  Filter: { Prefix: 'logs/' },
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with transition rule', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'archive-old-files',
                  Status: 'Enabled',
                  Filter: { Prefix: 'archive/' },
                  Transitions: [
                    { Days: 30, StorageClass: 'STANDARD_IA' },
                    { Days: 90, StorageClass: 'GLACIER' },
                  ],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with multiple rules', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'rule-1',
                  Status: 'Enabled',
                  Filter: { Prefix: 'temp/' },
                  Expiration: { Days: 7 },
                },
                {
                  ID: 'rule-2',
                  Status: 'Enabled',
                  Filter: { Prefix: 'logs/' },
                  Expiration: { Days: 30 },
                },
                {
                  ID: 'rule-3',
                  Status: 'Disabled',
                  Filter: { Prefix: 'archive/' },
                  Transitions: [{ Days: 90, StorageClass: 'GLACIER' }],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with expiration date', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-on-date',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Date: new Date('2025-12-31') },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with NoncurrentVersionExpiration', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'cleanup-old-versions',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  NoncurrentVersionExpiration: { NoncurrentDays: 30 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with AbortIncompleteMultipartUpload', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'cleanup-multipart',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with tag filter', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'filter-by-tag',
                  Status: 'Enabled',
                  Filter: {
                    Tag: { Key: 'environment', Value: 'temp' },
                  },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with And filter (prefix + tags)', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'complex-filter',
                  Status: 'Enabled',
                  Filter: {
                    And: {
                      Prefix: 'logs/',
                      Tags: [
                        { Key: 'environment', Value: 'development' },
                        { Key: 'team', Value: 'engineering' },
                      ],
                    },
                  },
                  Expiration: { Days: 14 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: 'non-existent-bucket',
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: 'test',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: 30 },
                  },
                ],
              },
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('GetBucketLifecycleConfiguration', () => {
      it('should get lifecycle configuration', async () => {
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'test-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: 'data/' },
                  Expiration: { Days: 60 },
                  Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }],
                },
              ],
            },
          })
        )

        const result = await client.send(
          new GetBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.Rules).toHaveLength(1)
        expect(result.Rules![0].ID).toBe('test-rule')
        expect(result.Rules![0].Status).toBe('Enabled')
        expect(result.Rules![0].Filter?.Prefix).toBe('data/')
        expect(result.Rules![0].Expiration?.Days).toBe(60)
        expect(result.Rules![0].Transitions).toHaveLength(1)
        expect(result.Rules![0].Transitions![0].Days).toBe(30)
        expect(result.Rules![0].Transitions![0].StorageClass).toBe('STANDARD_IA')
      })

      it('should throw NoSuchLifecycleConfiguration when not set', async () => {
        await expect(
          client.send(
            new GetBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
            })
          )
        ).rejects.toThrow('NoSuchLifecycleConfiguration')
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new GetBucketLifecycleConfigurationCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('DeleteBucketLifecycle', () => {
      it('should delete lifecycle configuration', async () => {
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'test',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        const result = await client.send(
          new DeleteBucketLifecycleCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)

        // Verify lifecycle is deleted
        await expect(
          client.send(
            new GetBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
            })
          )
        ).rejects.toThrow('NoSuchLifecycleConfiguration')
      })

      it('should succeed even if lifecycle not set (idempotent)', async () => {
        const result = await client.send(
          new DeleteBucketLifecycleCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new DeleteBucketLifecycleCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })
  })

  // ===========================================================================
  // Bucket Versioning Tests
  // ===========================================================================

  describe('Bucket Versioning', () => {
    const TEST_BUCKET = 'versioning-test-bucket'

    beforeEach(async () => {
      await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
    })

    describe('GetBucketVersioning', () => {
      it('should return empty status for unversioned bucket', async () => {
        const result = await client.send(
          new GetBucketVersioningCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.Status).toBeUndefined()
        expect(result.MFADelete).toBeUndefined()
      })

      it('should return Enabled status after enabling versioning', async () => {
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )

        const result = await client.send(
          new GetBucketVersioningCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.Status).toBe('Enabled')
      })

      it('should return Suspended status after suspending versioning', async () => {
        // First enable
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )

        // Then suspend
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Suspended',
            },
          })
        )

        const result = await client.send(
          new GetBucketVersioningCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.Status).toBe('Suspended')
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new GetBucketVersioningCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })

    describe('PutBucketVersioning', () => {
      it('should enable versioning', async () => {
        const result = await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should suspend versioning', async () => {
        // First enable
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )

        // Then suspend
        const result = await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Suspended',
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should enable MFA delete when enabling versioning', async () => {
        const result = await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
              MFADelete: 'Enabled',
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)

        const getResult = await client.send(
          new GetBucketVersioningCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(getResult.MFADelete).toBe('Enabled')
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new PutBucketVersioningCommand({
              Bucket: 'non-existent-bucket',
              VersioningConfiguration: {
                Status: 'Enabled',
              },
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })

      it('should re-enable versioning after suspension', async () => {
        // Enable
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )

        // Suspend
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Suspended',
            },
          })
        )

        // Re-enable
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )

        const result = await client.send(
          new GetBucketVersioningCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.Status).toBe('Enabled')
      })
    })

    describe('Versioned Object Operations', () => {
      beforeEach(async () => {
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )
      })

      it('should create version when putting object', async () => {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 1',
          })
        )

        expect(result.VersionId).toBeDefined()
        expect(result.VersionId).not.toBe('null')
      })

      it('should create new version when overwriting object', async () => {
        const result1 = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 1',
          })
        )

        const result2 = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 2',
          })
        )

        expect(result1.VersionId).toBeDefined()
        expect(result2.VersionId).toBeDefined()
        expect(result1.VersionId).not.toBe(result2.VersionId)
      })

      it('should get specific version of object', async () => {
        const put1 = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 1 content',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 2 content',
          })
        )

        // Get first version
        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            VersionId: put1.VersionId,
          })
        )

        const text = await result.Body!.transformToString()
        expect(text).toBe('version 1 content')
      })

      it('should get latest version by default', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 1 content',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
            Body: 'version 2 content',
          })
        )

        const result = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'versioned-file.txt',
          })
        )

        const text = await result.Body!.transformToString()
        expect(text).toBe('version 2 content')
      })

      it('should create delete marker when deleting versioned object', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'delete-me.txt',
            Body: 'content',
          })
        )

        const result = await client.send(
          new DeleteObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'delete-me.txt',
          })
        )

        expect(result.DeleteMarker).toBe(true)
        expect(result.VersionId).toBeDefined()
      })

      it('should permanently delete specific version', async () => {
        const put1 = await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'permanent-delete.txt',
            Body: 'version 1',
          })
        )

        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'permanent-delete.txt',
            Body: 'version 2',
          })
        )

        // Delete specific version
        const result = await client.send(
          new DeleteObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'permanent-delete.txt',
            VersionId: put1.VersionId,
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(204)

        // Verify version is gone
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: TEST_BUCKET,
              Key: 'permanent-delete.txt',
              VersionId: put1.VersionId,
            })
          )
        ).rejects.toThrow()
      })
    })

    describe('ListObjectVersions', () => {
      beforeEach(async () => {
        await client.send(
          new PutBucketVersioningCommand({
            Bucket: TEST_BUCKET,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        )
      })

      it('should list all versions of objects', async () => {
        // Create multiple versions
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'v1',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'v2',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'v3',
          })
        )

        const result = await client.send(
          new ListObjectVersionsCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.Versions).toBeDefined()
        expect(result.Versions!.length).toBeGreaterThanOrEqual(3)
      })

      it('should list delete markers', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'deleted-file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new DeleteObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'deleted-file.txt',
          })
        )

        const result = await client.send(
          new ListObjectVersionsCommand({
            Bucket: TEST_BUCKET,
          })
        )

        expect(result.DeleteMarkers).toBeDefined()
        expect(result.DeleteMarkers!.length).toBeGreaterThanOrEqual(1)
      })

      it('should filter by prefix', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'folder/file1.txt',
            Body: 'content',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'folder/file2.txt',
            Body: 'content',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'other/file.txt',
            Body: 'content',
          })
        )

        const result = await client.send(
          new ListObjectVersionsCommand({
            Bucket: TEST_BUCKET,
            Prefix: 'folder/',
          })
        )

        expect(result.Versions!.every((v) => v.Key!.startsWith('folder/'))).toBe(true)
      })

      it('should paginate with MaxKeys', async () => {
        // Create multiple objects/versions
        for (let i = 0; i < 10; i++) {
          await client.send(
            new PutObjectCommand({
              Bucket: TEST_BUCKET,
              Key: `paginate-${i}.txt`,
              Body: `content ${i}`,
            })
          )
        }

        const result = await client.send(
          new ListObjectVersionsCommand({
            Bucket: TEST_BUCKET,
            MaxKeys: 5,
          })
        )

        expect(result.Versions).toHaveLength(5)
        expect(result.IsTruncated).toBe(true)
        expect(result.NextKeyMarker).toBeDefined()
      })

      it('should throw NoSuchBucket for non-existent bucket', async () => {
        await expect(
          client.send(
            new ListObjectVersionsCommand({
              Bucket: 'non-existent-bucket',
            })
          )
        ).rejects.toThrow(NoSuchBucket)
      })
    })
  })
})

