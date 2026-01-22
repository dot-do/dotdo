/**
 * R2 CORS configuration utilities for browser-based WASM access to Parquet files
 *
 * This module provides utilities to configure CORS rules on Cloudflare R2 buckets,
 * enabling browser-based WASM applications to perform range requests on Parquet files.
 */

import { S3Client, PutBucketCorsCommand, type CORSRule } from '@aws-sdk/client-s3';

/**
 * CORS configuration options for R2 buckets
 */
export interface CorsConfig {
  /** Origins allowed to make cross-origin requests (e.g., ['https://app.example.com'] or ['*']) */
  allowedOrigins: string[];
  /** HTTP methods allowed for cross-origin requests (defaults to ['GET', 'HEAD']) */
  allowedMethods?: string[];
  /** Request headers allowed in cross-origin requests */
  allowedHeaders?: string[];
  /** Response headers exposed to the browser */
  exposeHeaders?: string[];
  /** How long (in seconds) browsers should cache preflight responses */
  maxAgeSeconds?: number;
}

/**
 * Default CORS configuration optimized for WASM Parquet access
 *
 * This configuration enables:
 * - Range requests for efficient partial file reads (critical for Parquet)
 * - Content-Range and Accept-Ranges headers for partial response handling
 * - ETag for cache validation
 * - 24-hour preflight cache for performance
 *
 * @example
 * ```typescript
 * import { configureR2Cors, defaultWasmCorsConfig } from '@dotdo/clickhouse/r2';
 *
 * await configureR2Cors(
 *   process.env.CF_ACCOUNT_ID!,
 *   process.env.R2_ACCESS_KEY_ID!,
 *   process.env.R2_SECRET_ACCESS_KEY!,
 *   'my-parquet-bucket',
 *   defaultWasmCorsConfig
 * );
 * ```
 */
export const defaultWasmCorsConfig: CorsConfig = {
  allowedOrigins: ['*'],
  allowedMethods: ['GET', 'HEAD'],
  allowedHeaders: ['range', 'content-type'],
  exposeHeaders: ['content-length', 'content-range', 'accept-ranges', 'etag'],
  maxAgeSeconds: 86400, // 24 hours
};

/**
 * CORS configuration for development environments
 * More permissive, allowing all methods and headers
 */
export const devCorsConfig: CorsConfig = {
  allowedOrigins: ['*'],
  allowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
  allowedHeaders: ['*'],
  exposeHeaders: ['*'],
  maxAgeSeconds: 3600, // 1 hour
};

/**
 * Creates a strict CORS configuration for specific production origins
 *
 * @param origins - List of allowed origins (e.g., ['https://app.example.com', 'https://www.example.com'])
 * @returns CorsConfig configured for the specified origins
 *
 * @example
 * ```typescript
 * const prodConfig = createProductionCorsConfig([
 *   'https://app.example.com',
 *   'https://www.example.com'
 * ]);
 *
 * await configureR2Cors(accountId, accessKeyId, secretAccessKey, bucket, prodConfig);
 * ```
 */
export function createProductionCorsConfig(origins: string[]): CorsConfig {
  return {
    allowedOrigins: origins,
    allowedMethods: ['GET', 'HEAD'],
    allowedHeaders: ['range', 'content-type', 'if-none-match', 'if-modified-since'],
    exposeHeaders: ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'],
    maxAgeSeconds: 86400,
  };
}

/**
 * Builds the R2-compatible S3 endpoint URL for a Cloudflare account
 *
 * @param accountId - Cloudflare account ID
 * @returns The S3-compatible endpoint URL for R2
 */
export function getR2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Creates an S3 client configured for Cloudflare R2
 *
 * @param accountId - Cloudflare account ID
 * @param accessKeyId - R2 API access key ID
 * @param secretAccessKey - R2 API secret access key
 * @returns Configured S3Client for R2 operations
 */
export function createR2Client(
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string
): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: getR2Endpoint(accountId),
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Converts a CorsConfig to the AWS SDK CORS rule format
 *
 * @param config - CORS configuration
 * @returns Array of CORSRule objects for the AWS SDK
 */
function toCorsRules(config: CorsConfig): CORSRule[] {
  return [
    {
      AllowedOrigins: config.allowedOrigins,
      AllowedMethods: config.allowedMethods ?? ['GET', 'HEAD'],
      AllowedHeaders: config.allowedHeaders ?? ['*'],
      ExposeHeaders: config.exposeHeaders ?? [],
      MaxAgeSeconds: config.maxAgeSeconds ?? 86400,
    },
  ];
}

/**
 * Configures CORS rules on an R2 bucket for browser-based access
 *
 * This function uses the S3-compatible API to set CORS configuration on an R2 bucket.
 * CORS rules are essential for browser-based WASM applications that need to make
 * range requests to load Parquet file metadata and data chunks.
 *
 * @param accountId - Cloudflare account ID
 * @param accessKeyId - R2 API access key ID (create in Cloudflare dashboard under R2 > Manage R2 API Tokens)
 * @param secretAccessKey - R2 API secret access key
 * @param bucket - Name of the R2 bucket to configure
 * @param config - CORS configuration to apply
 *
 * @throws Error if the CORS configuration fails (e.g., invalid credentials, bucket not found)
 *
 * @example
 * ```typescript
 * import { configureR2Cors, defaultWasmCorsConfig } from '@dotdo/clickhouse/r2';
 *
 * // Configure CORS with default WASM settings
 * await configureR2Cors(
 *   process.env.CF_ACCOUNT_ID!,
 *   process.env.R2_ACCESS_KEY_ID!,
 *   process.env.R2_SECRET_ACCESS_KEY!,
 *   'my-parquet-bucket',
 *   defaultWasmCorsConfig
 * );
 *
 * // Or with custom origins for production
 * await configureR2Cors(
 *   process.env.CF_ACCOUNT_ID!,
 *   process.env.R2_ACCESS_KEY_ID!,
 *   process.env.R2_SECRET_ACCESS_KEY!,
 *   'my-parquet-bucket',
 *   {
 *     allowedOrigins: ['https://app.example.com'],
 *     allowedMethods: ['GET', 'HEAD'],
 *     allowedHeaders: ['range', 'content-type'],
 *     exposeHeaders: ['content-length', 'content-range', 'accept-ranges', 'etag'],
 *     maxAgeSeconds: 86400,
 *   }
 * );
 * ```
 */
export async function configureR2Cors(
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  config: CorsConfig
): Promise<void> {
  const client = createR2Client(accountId, accessKeyId, secretAccessKey);

  const command = new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: toCorsRules(config),
    },
  });

  await client.send(command);
}

/**
 * Generates CORS XML configuration string for manual configuration or wrangler
 *
 * This is useful when you need to configure CORS through the Cloudflare dashboard
 * or via wrangler CLI instead of programmatically.
 *
 * @param config - CORS configuration to convert to XML
 * @returns XML string representation of the CORS configuration
 *
 * @example
 * ```typescript
 * import { generateCorsXml, defaultWasmCorsConfig } from '@dotdo/clickhouse/r2';
 *
 * const xml = generateCorsXml(defaultWasmCorsConfig);
 * console.log(xml);
 * // Use with: wrangler r2 bucket cors put my-bucket --rules cors.xml
 * ```
 */
export function generateCorsXml(config: CorsConfig): string {
  const origins = config.allowedOrigins.map((o) => `    <AllowedOrigin>${escapeXml(o)}</AllowedOrigin>`).join('\n');
  const methods = (config.allowedMethods ?? ['GET', 'HEAD']).map((m) => `    <AllowedMethod>${escapeXml(m)}</AllowedMethod>`).join('\n');
  const headers = (config.allowedHeaders ?? []).map((h) => `    <AllowedHeader>${escapeXml(h)}</AllowedHeader>`).join('\n');
  const exposeHeaders = (config.exposeHeaders ?? []).map((h) => `    <ExposeHeader>${escapeXml(h)}</ExposeHeader>`).join('\n');
  const maxAge = config.maxAgeSeconds ?? 86400;

  return `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
${origins}
${methods}
${headers ? headers + '\n' : ''}${exposeHeaders ? exposeHeaders + '\n' : ''}    <MaxAgeSeconds>${maxAge}</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;
}

/**
 * Escapes special XML characters in a string
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
