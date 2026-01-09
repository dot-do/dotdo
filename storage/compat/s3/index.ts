/**
 * @dotdo/s3 - S3 SDK compat
 *
 * Drop-in replacement for @aws-sdk/client-s3 backed by DO/R2 storage.
 * Production version routes to Durable Objects or R2 based on config.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */

// Types
export type {
  Body,
  StreamingBlobPayloadOutputTypes,
  Metadata,
  StorageClass,
  ObjectOwnership,
  ChecksumAlgorithm,
  Credentials,
  CredentialProvider,
  S3ClientConfig,
  ExtendedS3ClientConfig,
  Bucket,
  Owner,
  S3Object,
  CommonPrefix,
  ObjectIdentifier,
  DeletedObject,
  S3Error,
  ResponseMetadata,
  Command,
  GetSignedUrlOptions,
  S3RequestPresignerConfig,
  // Command inputs
  CreateBucketCommandInput,
  DeleteBucketCommandInput,
  ListBucketsCommandInput,
  HeadBucketCommandInput,
  PutObjectCommandInput,
  GetObjectCommandInput,
  DeleteObjectCommandInput,
  HeadObjectCommandInput,
  CopyObjectCommandInput,
  ListObjectsV2CommandInput,
  DeleteObjectsCommandInput,
  // Command outputs
  CreateBucketCommandOutput,
  DeleteBucketCommandOutput,
  ListBucketsCommandOutput,
  HeadBucketCommandOutput,
  PutObjectCommandOutput,
  GetObjectCommandOutput,
  DeleteObjectCommandOutput,
  HeadObjectCommandOutput,
  CopyObjectCommandOutput,
  ListObjectsV2CommandOutput,
  DeleteObjectsCommandOutput,
} from './types'

// Error classes
export {
  S3ServiceException,
  NoSuchBucket,
  NoSuchKey,
  BucketAlreadyExists,
  BucketAlreadyOwnedByYou,
  BucketNotEmpty,
  InvalidObjectState,
  NotModified,
  PreconditionFailed,
} from './types'

// Client and commands
export {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  getSignedUrl,
  clearAllBuckets,
  getBucketCount,
} from './s3'
