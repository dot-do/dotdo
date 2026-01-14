/**
 * @dotdo/s3 - Lifecycle Policies Tests
 *
 * Comprehensive tests for S3 lifecycle policy functionality.
 * Tests cover:
 * 1. Lifecycle configuration CRUD operations
 * 2. Lifecycle rule validation
 * 3. Lifecycle evaluation (matching objects to rules)
 * 4. Lifecycle execution (expiration, transitions, abort uploads)
 * 5. Edge cases and error handling
 *
 * Issue: dotdo-c2a8i
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  DeleteBucketLifecycleCommand,
  NoSuchBucket,
  NoSuchLifecycleConfiguration,
  _clearAll,
  defaultMemoryBackend,
} from '../index'

import type {
  LifecycleRule,
  LifecycleConfiguration,
  LifecycleFilter,
  StorageClass,
} from '../types'

// =============================================================================
// Test Setup
// =============================================================================

describe('S3 Lifecycle Policies', () => {
  let client: InstanceType<typeof S3Client>
  const TEST_BUCKET = 'lifecycle-test-bucket'

  beforeEach(async () => {
    _clearAll()
    client = new S3Client({ region: 'us-east-1' })
    await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
  })

  afterEach(() => {
    _clearAll()
  })

  // ===========================================================================
  // CRUD Operations Tests
  // ===========================================================================

  describe('PutBucketLifecycleConfiguration', () => {
    describe('Basic Rules', () => {
      it('should set lifecycle with simple expiration rule', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-30-days',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with date-based expiration', async () => {
        const expirationDate = new Date('2025-12-31')
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-on-date',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Date: expirationDate },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with ExpiredObjectDeleteMarker', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'cleanup-markers',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { ExpiredObjectDeleteMarker: true },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Transition Rules', () => {
      it('should set lifecycle with single transition', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'transition-to-ia',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with multiple transitions', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'tiered-transitions',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [
                    { Days: 30, StorageClass: 'STANDARD_IA' },
                    { Days: 90, StorageClass: 'GLACIER' },
                    { Days: 180, StorageClass: 'DEEP_ARCHIVE' },
                  ],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with date-based transition', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'transition-on-date',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [
                    { Date: new Date('2025-06-01'), StorageClass: 'GLACIER' },
                  ],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with transition to INTELLIGENT_TIERING', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'intelligent-tiering',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [
                    { Days: 0, StorageClass: 'INTELLIGENT_TIERING' },
                  ],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Noncurrent Version Rules', () => {
      it('should set lifecycle with NoncurrentVersionExpiration', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-old-versions',
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

      it('should set lifecycle with NewerNoncurrentVersions', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'keep-recent-versions',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  NoncurrentVersionExpiration: {
                    NoncurrentDays: 30,
                    NewerNoncurrentVersions: 3,
                  },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with NoncurrentVersionTransitions', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'transition-old-versions',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  NoncurrentVersionTransitions: [
                    { NoncurrentDays: 30, StorageClass: 'GLACIER' },
                  ],
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Abort Incomplete Multipart Upload', () => {
      it('should set lifecycle with AbortIncompleteMultipartUpload', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-uploads',
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

      it('should set lifecycle with 1 day AbortIncompleteMultipartUpload', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-uploads-fast',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Filter Types', () => {
      it('should set lifecycle with prefix filter', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'prefix-filter',
                  Status: 'Enabled',
                  Filter: { Prefix: 'logs/' },
                  Expiration: { Days: 7 },
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
                  ID: 'tag-filter',
                  Status: 'Enabled',
                  Filter: { Tag: { Key: 'environment', Value: 'temp' } },
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
                  ID: 'and-filter',
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

      it('should set lifecycle with ObjectSizeGreaterThan filter', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'size-gt-filter',
                  Status: 'Enabled',
                  Filter: { ObjectSizeGreaterThan: 1024 * 1024 }, // 1MB
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with ObjectSizeLessThan filter', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'size-lt-filter',
                  Status: 'Enabled',
                  Filter: { ObjectSizeLessThan: 1024 }, // 1KB
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })

      it('should set lifecycle with And filter including size constraints', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'size-range-filter',
                  Status: 'Enabled',
                  Filter: {
                    And: {
                      Prefix: 'data/',
                      ObjectSizeGreaterThan: 100,
                      ObjectSizeLessThan: 1000000,
                    },
                  },
                  Expiration: { Days: 60 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Multiple Rules', () => {
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

      it('should handle 100 rules', async () => {
        const rules: LifecycleRule[] = []
        for (let i = 0; i < 100; i++) {
          rules.push({
            ID: `rule-${i}`,
            Status: 'Enabled',
            Filter: { Prefix: `folder-${i}/` },
            Expiration: { Days: i + 1 },
          })
        }

        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: { Rules: rules },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Complex Rules', () => {
      it('should set lifecycle with combined expiration and transitions', async () => {
        const result = await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'complete-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: 'data/' },
                  Transitions: [
                    { Days: 30, StorageClass: 'STANDARD_IA' },
                    { Days: 90, StorageClass: 'GLACIER' },
                  ],
                  Expiration: { Days: 365 },
                  NoncurrentVersionTransitions: [
                    { NoncurrentDays: 30, StorageClass: 'GLACIER' },
                  ],
                  NoncurrentVersionExpiration: { NoncurrentDays: 90 },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
                },
              ],
            },
          })
        )

        expect(result.$metadata.httpStatusCode).toBe(200)
      })
    })

    describe('Error Handling', () => {
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

      it('should throw error for empty rules array', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
              LifecycleConfiguration: {
                Rules: [],
              },
            })
          )
        ).rejects.toThrow()
      })

      it('should throw error for duplicate rule IDs', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: 'duplicate-id',
                    Status: 'Enabled',
                    Filter: { Prefix: 'a/' },
                    Expiration: { Days: 30 },
                  },
                  {
                    ID: 'duplicate-id',
                    Status: 'Enabled',
                    Filter: { Prefix: 'b/' },
                    Expiration: { Days: 30 },
                  },
                ],
              },
            })
          )
        ).rejects.toThrow()
      })

      it('should throw error for rule ID exceeding 255 characters', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: 'a'.repeat(256),
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: 30 },
                  },
                ],
              },
            })
          )
        ).rejects.toThrow()
      })

      it('should throw error for rule without any action', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: 'no-action',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    // No Expiration, Transitions, etc.
                  },
                ],
              },
            })
          )
        ).rejects.toThrow()
      })

      it('should throw error for negative expiration days', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: 'negative-days',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: 0 }, // Must be at least 1
                  },
                ],
              },
            })
          )
        ).rejects.toThrow()
      })

      it('should throw error for DaysAfterInitiation less than 1', async () => {
        await expect(
          client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: TEST_BUCKET,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: 'invalid-abort',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 0 },
                  },
                ],
              },
            })
          )
        ).rejects.toThrow()
      })
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

    it('should get lifecycle with multiple rules', async () => {
      await client.send(
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
                Status: 'Disabled',
                Filter: { Prefix: 'logs/' },
                Expiration: { Days: 30 },
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

      expect(result.Rules).toHaveLength(2)
    })

    it('should throw NoSuchLifecycleConfiguration when not set', async () => {
      await expect(
        client.send(
          new GetBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
          })
        )
      ).rejects.toThrow(NoSuchLifecycleConfiguration)
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
      ).rejects.toThrow(NoSuchLifecycleConfiguration)
    })

    it('should be idempotent (succeed even if lifecycle not set)', async () => {
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

  // ===========================================================================
  // Lifecycle Evaluation Tests
  // ===========================================================================

  describe('Lifecycle Evaluation', () => {
    describe('Expiration Matching', () => {
      it('should identify objects for expiration based on Days', async () => {
        // Create object with old lastModified date
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'old-file.txt',
            Body: 'old content',
          })
        )

        // Set lifecycle rule
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        // Simulate time passing and evaluate
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 31)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
        expect(evaluation.expiredObjects[0].key).toBe('old-file.txt')
        expect(evaluation.expiredObjects[0].ruleId).toBe('expire-rule')
      })

      it('should not expire objects before Days threshold', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'new-file.txt',
            Body: 'new content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        // Evaluate with current date (file just created)
        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          new Date()
        )

        expect(evaluation.expiredObjects).toHaveLength(0)
      })

      it('should identify objects for expiration based on Date', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'content',
          })
        )

        const expirationDate = new Date('2025-06-01')
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'date-expire',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Date: expirationDate },
                },
              ],
            },
          })
        )

        // Evaluate after expiration date
        const afterDate = new Date('2025-06-02')
        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          afterDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
      })
    })

    describe('Prefix Filter Matching', () => {
      it('should only match objects with specified prefix', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'logs/app.log',
            Body: 'log content',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data/file.txt',
            Body: 'data content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'logs-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: 'logs/' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
        expect(evaluation.expiredObjects[0].key).toBe('logs/app.log')
      })

      it('should match nested prefixes', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data/archive/2024/file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'archive-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: 'data/archive/' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
      })

      it('should match empty prefix (all objects)', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file1.txt',
            Body: 'content1',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'folder/file2.txt',
            Body: 'content2',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'all-objects',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(2)
      })
    })

    describe('Size Filter Matching', () => {
      it('should only match objects larger than specified size', async () => {
        // Small object
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'small.txt',
            Body: 'tiny',
          })
        )
        // Large object
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large.txt',
            Body: 'x'.repeat(2000),
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'large-objects',
                  Status: 'Enabled',
                  Filter: { ObjectSizeGreaterThan: 1000 },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
        expect(evaluation.expiredObjects[0].key).toBe('large.txt')
      })

      it('should only match objects smaller than specified size', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'small.txt',
            Body: 'tiny',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'large.txt',
            Body: 'x'.repeat(2000),
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'small-objects',
                  Status: 'Enabled',
                  Filter: { ObjectSizeLessThan: 100 },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
        expect(evaluation.expiredObjects[0].key).toBe('small.txt')
      })
    })

    describe('Tag Filter Matching', () => {
      it('should match objects with specified tag', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'temp-file.txt',
            Body: 'temporary content',
            Metadata: { environment: 'temp' },
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'prod-file.txt',
            Body: 'production content',
            Metadata: { environment: 'prod' },
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'temp-rule',
                  Status: 'Enabled',
                  Filter: { Tag: { Key: 'environment', Value: 'temp' } },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(1)
        expect(evaluation.expiredObjects[0].key).toBe('temp-file.txt')
      })
    })

    describe('Transition Matching', () => {
      it('should identify objects for storage class transition', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'transition-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [{ Days: 30, StorageClass: 'GLACIER' }],
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 31)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.transitionObjects).toHaveLength(1)
        expect(evaluation.transitionObjects[0].key).toBe('file.txt')
        expect(evaluation.transitionObjects[0].targetStorageClass).toBe('GLACIER')
      })

      it('should not transition objects already in target storage class', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'content',
            StorageClass: 'GLACIER',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'transition-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [{ Days: 30, StorageClass: 'GLACIER' }],
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 31)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.transitionObjects).toHaveLength(0)
      })
    })

    describe('Multipart Upload Abort', () => {
      it('should identify incomplete multipart uploads for abort', async () => {
        // Create incomplete multipart upload
        const createResult = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-file.zip',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 8)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.abortUploads).toHaveLength(1)
        expect(evaluation.abortUploads[0].key).toBe('large-file.zip')
        expect(evaluation.abortUploads[0].uploadId).toBe(createResult.UploadId)
      })

      it('should not abort recent multipart uploads', async () => {
        await client.send(
          new CreateMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-file.zip',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
                },
              ],
            },
          })
        )

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          new Date()
        )

        expect(evaluation.abortUploads).toHaveLength(0)
      })
    })

    describe('Disabled Rules', () => {
      it('should skip disabled rules', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'disabled-rule',
                  Status: 'Disabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        expect(evaluation.expiredObjects).toHaveLength(0)
      })
    })

    describe('Multiple Rules Evaluation', () => {
      it('should evaluate all enabled rules', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'logs/app.log',
            Body: 'log content',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'temp/cache.txt',
            Body: 'cache content',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data/file.txt',
            Body: 'data content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'logs-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: 'logs/' },
                  Expiration: { Days: 7 },
                },
                {
                  ID: 'temp-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: 'temp/' },
                  Expiration: { Days: 1 },
                },
                {
                  ID: 'data-rule',
                  Status: 'Disabled',
                  Filter: { Prefix: 'data/' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 10)

        const evaluation = await defaultMemoryBackend.evaluateLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        // Should find logs and temp files, but not data (disabled rule)
        expect(evaluation.expiredObjects).toHaveLength(2)
        const expiredKeys = evaluation.expiredObjects.map((o) => o.key)
        expect(expiredKeys).toContain('logs/app.log')
        expect(expiredKeys).toContain('temp/cache.txt')
        expect(expiredKeys).not.toContain('data/file.txt')
      })
    })
  })

  // ===========================================================================
  // Update/Replace Tests
  // ===========================================================================

  describe('Lifecycle Configuration Updates', () => {
    it('should replace existing configuration', async () => {
      // Set initial configuration
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: TEST_BUCKET,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'old-rule',
                Status: 'Enabled',
                Filter: { Prefix: 'old/' },
                Expiration: { Days: 30 },
              },
            ],
          },
        })
      )

      // Replace with new configuration
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: TEST_BUCKET,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'new-rule',
                Status: 'Enabled',
                Filter: { Prefix: 'new/' },
                Expiration: { Days: 60 },
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
      expect(result.Rules![0].ID).toBe('new-rule')
    })

    it('should allow adding more rules', async () => {
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: TEST_BUCKET,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'rule-1',
                Status: 'Enabled',
                Filter: { Prefix: 'a/' },
                Expiration: { Days: 30 },
              },
            ],
          },
        })
      )

      // Add more rules by replacing with larger configuration
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: TEST_BUCKET,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'rule-1',
                Status: 'Enabled',
                Filter: { Prefix: 'a/' },
                Expiration: { Days: 30 },
              },
              {
                ID: 'rule-2',
                Status: 'Enabled',
                Filter: { Prefix: 'b/' },
                Expiration: { Days: 60 },
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

      expect(result.Rules).toHaveLength(2)
    })

    it('should toggle rule status', async () => {
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: TEST_BUCKET,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'toggle-rule',
                Status: 'Enabled',
                Filter: { Prefix: '' },
                Expiration: { Days: 30 },
              },
            ],
          },
        })
      )

      // Disable the rule
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: TEST_BUCKET,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'toggle-rule',
                Status: 'Disabled',
                Filter: { Prefix: '' },
                Expiration: { Days: 30 },
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

      expect(result.Rules![0].Status).toBe('Disabled')
    })
  })

  // ===========================================================================
  // Lifecycle Execution Tests
  // ===========================================================================

  describe('Lifecycle Execution', () => {
    describe('Object Expiration', () => {
      it('should delete expired objects', async () => {
        // Create objects
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'temp/file1.txt',
            Body: 'content1',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'temp/file2.txt',
            Body: 'content2',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'keep/file.txt',
            Body: 'keep this',
          })
        )

        // Set lifecycle rule for temp/ prefix
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-temp',
                  Status: 'Enabled',
                  Filter: { Prefix: 'temp/' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        // Apply lifecycle rules with future date
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)
        const result = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        // Verify deletions
        expect(result.deletedObjects).toHaveLength(2)
        const deletedKeys = result.deletedObjects.map((o) => o.key)
        expect(deletedKeys).toContain('temp/file1.txt')
        expect(deletedKeys).toContain('temp/file2.txt')

        // Verify objects are actually gone
        const listResult = await client.send(
          new ListObjectsV2Command({
            Bucket: TEST_BUCKET,
          })
        )
        const remainingKeys = listResult.Contents?.map((o) => o.Key) || []
        expect(remainingKeys).not.toContain('temp/file1.txt')
        expect(remainingKeys).not.toContain('temp/file2.txt')
        expect(remainingKeys).toContain('keep/file.txt')
      })

      it('should not delete objects before expiration threshold', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 30 },
                },
              ],
            },
          })
        )

        // Apply with current date (object just created)
        const result = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          new Date()
        )

        expect(result.deletedObjects).toHaveLength(0)

        // Verify object still exists
        const getResult = await client.send(
          new GetObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
          })
        )
        expect(getResult.Body).toBeDefined()
      })
    })

    describe('Storage Class Transitions', () => {
      it('should transition objects to new storage class', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'archive/data.txt',
            Body: 'archival content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'transition-to-glacier',
                  Status: 'Enabled',
                  Filter: { Prefix: 'archive/' },
                  Transitions: [{ Days: 30, StorageClass: 'GLACIER' }],
                },
              ],
            },
          })
        )

        // Apply with future date
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 31)
        const result = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        // Verify transition
        expect(result.transitionedObjects).toHaveLength(1)
        expect(result.transitionedObjects[0].key).toBe('archive/data.txt')
        expect(result.transitionedObjects[0].newStorageClass).toBe('GLACIER')

        // Verify storage class was actually updated
        const headResult = await client.send(
          new HeadObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'archive/data.txt',
          })
        )
        expect(headResult.StorageClass).toBe('GLACIER')
      })

      it('should apply multiple transitions in order', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'data/file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'tiered-transitions',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Transitions: [
                    { Days: 30, StorageClass: 'STANDARD_IA' },
                    { Days: 90, StorageClass: 'GLACIER' },
                  ],
                },
              ],
            },
          })
        )

        // Apply at 31 days - should transition to STANDARD_IA
        const date31 = new Date()
        date31.setDate(date31.getDate() + 31)
        const result1 = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          date31
        )

        expect(result1.transitionedObjects).toHaveLength(1)
        expect(result1.transitionedObjects[0].newStorageClass).toBe('STANDARD_IA')

        // Apply at 91 days - should transition to GLACIER
        const date91 = new Date()
        date91.setDate(date91.getDate() + 91)
        const result2 = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          date91
        )

        expect(result2.transitionedObjects).toHaveLength(1)
        expect(result2.transitionedObjects[0].newStorageClass).toBe('GLACIER')
      })
    })

    describe('Multipart Upload Abort', () => {
      it('should abort expired multipart uploads', async () => {
        // Create multipart upload
        const createResult = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-file.zip',
          })
        )
        const uploadId = createResult.UploadId

        // Upload a part
        await client.send(
          new UploadPartCommand({
            Bucket: TEST_BUCKET,
            Key: 'large-file.zip',
            UploadId: uploadId,
            PartNumber: 1,
            Body: new Uint8Array(1024),
          })
        )

        // Set lifecycle rule
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-incomplete',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
                },
              ],
            },
          })
        )

        // Apply with future date
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 8)
        const result = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        // Verify abort
        expect(result.abortedUploads).toHaveLength(1)
        expect(result.abortedUploads[0].uploadId).toBe(uploadId)
        expect(result.abortedUploads[0].key).toBe('large-file.zip')

        // Verify upload is actually aborted
        const listResult = await client.send(
          new ListMultipartUploadsCommand({
            Bucket: TEST_BUCKET,
          })
        )
        expect(listResult.Uploads).toHaveLength(0)
      })
    })

    describe('Combined Actions', () => {
      it('should apply multiple rule types in single execution', async () => {
        // Create objects for different rules
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'temp/delete-me.txt',
            Body: 'temp content',
          })
        )
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'archive/transition-me.txt',
            Body: 'archive content',
          })
        )

        // Create multipart upload
        const createResult = await client.send(
          new CreateMultipartUploadCommand({
            Bucket: TEST_BUCKET,
            Key: 'uploads/incomplete.zip',
          })
        )

        // Set multiple lifecycle rules
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-temp',
                  Status: 'Enabled',
                  Filter: { Prefix: 'temp/' },
                  Expiration: { Days: 7 },
                },
                {
                  ID: 'transition-archive',
                  Status: 'Enabled',
                  Filter: { Prefix: 'archive/' },
                  Transitions: [{ Days: 30, StorageClass: 'GLACIER' }],
                },
                {
                  ID: 'abort-uploads',
                  Status: 'Enabled',
                  Filter: { Prefix: 'uploads/' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
                },
              ],
            },
          })
        )

        // Apply with sufficient time passed for all rules
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 31)
        const result = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          futureDate
        )

        // Verify all actions were taken
        expect(result.deletedObjects).toHaveLength(1)
        expect(result.deletedObjects[0].key).toBe('temp/delete-me.txt')

        expect(result.transitionedObjects).toHaveLength(1)
        expect(result.transitionedObjects[0].key).toBe('archive/transition-me.txt')

        expect(result.abortedUploads).toHaveLength(1)
        expect(result.abortedUploads[0].uploadId).toBe(createResult.UploadId)
      })
    })

    describe('Idempotency', () => {
      it('should be idempotent - running twice has same result', async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: TEST_BUCKET,
            Key: 'file.txt',
            Body: 'content',
          })
        )

        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: TEST_BUCKET,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'expire-rule',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          })
        )

        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2)

        // First execution
        const result1 = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          futureDate
        )
        expect(result1.deletedObjects).toHaveLength(1)

        // Second execution - should have no effect
        const result2 = await defaultMemoryBackend.applyLifecycleRules(
          TEST_BUCKET,
          futureDate
        )
        expect(result2.deletedObjects).toHaveLength(0)
      })
    })
  })
})
