/**
 * R2 Presigned URL utilities for authenticated access from browser WASM
 *
 * Uses AWS SDK v3 with Cloudflare R2's S3-compatible API to generate
 * presigned URLs for secure read/write operations without exposing credentials.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Configuration for R2 access
 */
export interface R2Config {
  /** Cloudflare account ID */
  accountId: string;
  /** R2 access key ID */
  accessKeyId: string;
  /** R2 secret access key */
  secretAccessKey: string;
  /** R2 bucket name */
  bucket: string;
}

/**
 * Options for generating a presigned read URL
 */
export interface ReadUrlOptions {
  /** Time until URL expires in seconds (default: 3600, max: 604800) */
  expiresIn?: number;
  /** Range header for partial reads (e.g., 'bytes=0-1023') */
  range?: string;
  /** Response content type override */
  responseContentType?: string;
  /** Response content disposition override */
  responseContentDisposition?: string;
}

/**
 * Options for generating a presigned write URL
 */
export interface WriteUrlOptions {
  /** Time until URL expires in seconds (default: 3600, max: 604800) */
  expiresIn?: number;
  /** Content type of the file being uploaded */
  contentType?: string;
  /** Content length of the file being uploaded */
  contentLength?: number;
  /** Custom metadata to attach to the object */
  metadata?: Record<string, string>;
}

/**
 * Options for multipart upload
 */
export interface MultipartUploadOptions {
  /** Time until URLs expire in seconds (default: 3600, max: 604800) */
  expiresIn?: number;
  /** Content type of the file being uploaded */
  contentType?: string;
  /** Custom metadata to attach to the object */
  metadata?: Record<string, string>;
}

/**
 * Multipart upload initialization result
 */
export interface MultipartUploadInit {
  /** Upload ID for the multipart upload */
  uploadId: string;
  /** Presigned URLs for each part */
  partUrls: string[];
  /** URL to complete the multipart upload */
  completeUrl: string;
  /** URL to abort the multipart upload */
  abortUrl: string;
}

/** Default URL expiration: 1 hour */
const DEFAULT_EXPIRES_IN = 3600;

/** Maximum URL expiration: 7 days */
const MAX_EXPIRES_IN = 604800;

/**
 * Validates and normalizes expiration time
 */
function normalizeExpiresIn(expiresIn?: number): number {
  if (expiresIn === undefined) {
    return DEFAULT_EXPIRES_IN;
  }
  if (expiresIn < 1) {
    throw new Error('expiresIn must be at least 1 second');
  }
  if (expiresIn > MAX_EXPIRES_IN) {
    throw new Error(`expiresIn cannot exceed ${MAX_EXPIRES_IN} seconds (7 days)`);
  }
  return expiresIn;
}

/**
 * Generates presigned URLs for Cloudflare R2 bucket operations
 *
 * @example
 * ```typescript
 * const r2 = new R2PresignedUrls({
 *   accountId: 'your-account-id',
 *   accessKeyId: 'your-access-key-id',
 *   secretAccessKey: 'your-secret-access-key',
 *   bucket: 'my-bucket',
 * });
 *
 * // Generate a read URL
 * const readUrl = await r2.getReadUrl('path/to/file.parquet');
 *
 * // Generate a write URL
 * const writeUrl = await r2.getWriteUrl('path/to/new-file.parquet', {
 *   contentType: 'application/octet-stream',
 * });
 *
 * // Generate multipart upload URLs for large files
 * const multipart = await r2.initMultipartUpload('path/to/large-file.parquet', 10, {
 *   contentType: 'application/octet-stream',
 * });
 * ```
 */
export class R2PresignedUrls {
  private client: S3Client;
  private bucket: string;

  constructor(config: R2Config) {
    if (!config.accountId) {
      throw new Error('accountId is required');
    }
    if (!config.accessKeyId) {
      throw new Error('accessKeyId is required');
    }
    if (!config.secretAccessKey) {
      throw new Error('secretAccessKey is required');
    }
    if (!config.bucket) {
      throw new Error('bucket is required');
    }

    this.bucket = config.bucket;

    // Initialize S3 client with R2 endpoint
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Generates a presigned URL for reading (GET) an object
   *
   * @param key - The object key (path) in the bucket
   * @param options - Options for the presigned URL
   * @returns Presigned URL for GET request
   *
   * @example
   * ```typescript
   * // Basic read URL
   * const url = await r2.getReadUrl('data/file.parquet');
   *
   * // With range request for partial reads
   * const partialUrl = await r2.getReadUrl('data/large-file.parquet', {
   *   range: 'bytes=0-1048575', // First 1MB
   *   expiresIn: 7200, // 2 hours
   * });
   * ```
   */
  async getReadUrl(key: string, options: ReadUrlOptions = {}): Promise<string> {
    const expiresIn = normalizeExpiresIn(options.expiresIn);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Range: options.range,
      ResponseContentType: options.responseContentType,
      ResponseContentDisposition: options.responseContentDisposition,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Generates a presigned URL for writing (PUT) an object
   *
   * @param key - The object key (path) in the bucket
   * @param options - Options for the presigned URL
   * @returns Presigned URL for PUT request
   *
   * @example
   * ```typescript
   * const url = await r2.getWriteUrl('uploads/file.parquet', {
   *   contentType: 'application/octet-stream',
   *   expiresIn: 3600, // 1 hour
   * });
   *
   * // Client-side upload
   * await fetch(url, {
   *   method: 'PUT',
   *   body: fileData,
   *   headers: { 'Content-Type': 'application/octet-stream' },
   * });
   * ```
   */
  async getWriteUrl(key: string, options: WriteUrlOptions = {}): Promise<string> {
    const expiresIn = normalizeExpiresIn(options.expiresIn);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      Metadata: options.metadata,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Initializes a multipart upload and generates presigned URLs for each part
   *
   * Use this for large files (typically > 5MB) to upload in parallel chunks.
   *
   * @param key - The object key (path) in the bucket
   * @param parts - Number of parts to upload
   * @param options - Options for the multipart upload
   * @returns Upload ID and presigned URLs for each part
   *
   * @example
   * ```typescript
   * const { uploadId, partUrls } = await r2.initMultipartUpload(
   *   'large-files/backup.tar.gz',
   *   10,
   *   { contentType: 'application/gzip' }
   * );
   *
   * // Upload each part in parallel
   * const etags = await Promise.all(partUrls.map(async (url, i) => {
   *   const response = await fetch(url, {
   *     method: 'PUT',
   *     body: chunks[i],
   *   });
   *   return response.headers.get('ETag');
   * }));
   *
   * // Complete the upload
   * await r2.completeMultipartUpload(key, uploadId, etags);
   * ```
   */
  async initMultipartUpload(
    key: string,
    parts: number,
    options: MultipartUploadOptions = {}
  ): Promise<MultipartUploadInit> {
    if (parts < 1) {
      throw new Error('parts must be at least 1');
    }
    if (parts > 10000) {
      throw new Error('parts cannot exceed 10000');
    }

    const expiresIn = normalizeExpiresIn(options.expiresIn);

    // Create multipart upload
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      Metadata: options.metadata,
    });

    const { UploadId } = await this.client.send(createCommand);

    if (!UploadId) {
      throw new Error('Failed to create multipart upload: no UploadId returned');
    }

    // Generate presigned URLs for each part
    const partUrls = await Promise.all(
      Array.from({ length: parts }, async (_, i) => {
        const partNumber = i + 1;
        const uploadPartCommand = new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId,
          PartNumber: partNumber,
        });
        return getSignedUrl(this.client, uploadPartCommand, { expiresIn });
      })
    );

    // Generate presigned URL for completing the upload
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId,
      MultipartUpload: { Parts: [] }, // Parts will be provided in the request body
    });
    const completeUrl = await getSignedUrl(this.client, completeCommand, { expiresIn });

    // Generate presigned URL for aborting the upload
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId,
    });
    const abortUrl = await getSignedUrl(this.client, abortCommand, { expiresIn });

    return {
      uploadId: UploadId,
      partUrls,
      completeUrl,
      abortUrl,
    };
  }

  /**
   * Generates presigned URLs for multipart upload parts (legacy method)
   *
   * @deprecated Use initMultipartUpload instead for full multipart upload workflow
   * @param key - The object key (path) in the bucket
   * @param parts - Number of parts to generate URLs for
   * @param options - Options for the presigned URLs
   * @returns Array of presigned URLs for each part
   */
  async getMultipartUploadUrls(
    key: string,
    parts: number,
    options: MultipartUploadOptions = {}
  ): Promise<string[]> {
    const result = await this.initMultipartUpload(key, parts, options);
    return result.partUrls;
  }

  /**
   * Gets the bucket name
   */
  getBucket(): string {
    return this.bucket;
  }

  /**
   * Gets the S3 client for advanced operations
   */
  getClient(): S3Client {
    return this.client;
  }
}

/**
 * Creates an R2PresignedUrls instance
 *
 * @param config - R2 configuration
 * @returns R2PresignedUrls instance
 *
 * @example
 * ```typescript
 * const r2 = createR2Client({
 *   accountId: process.env.R2_ACCOUNT_ID!,
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *   bucket: 'my-bucket',
 * });
 * ```
 */
export function createR2Client(config: R2Config): R2PresignedUrls {
  return new R2PresignedUrls(config);
}

export default R2PresignedUrls;
