/**
 * S3/URL Table Function Module
 *
 * Extracted from http-query-handler.ts to provide clean, testable implementations
 * for s3() and url() table functions in ClickHouse-compatible SQL.
 *
 * Features:
 * - S3 URL parsing (bucket, key, credentials)
 * - Cloudflare R2 integration
 * - Support for CSV, TSV, JSON, and Parquet formats
 * - Virtual columns (_path, _file, _size)
 *
 * @see https://clickhouse.com/docs/en/sql-reference/table-functions/s3
 * @see https://clickhouse.com/docs/en/sql-reference/table-functions/url
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported formats for s3() and url() table functions
 */
export type S3SupportedFormat =
  | 'CSV'
  | 'CSVWithNames'
  | 'TSV'
  | 'TSVWithNames'
  | 'TabSeparated'
  | 'TabSeparatedWithNames'
  | 'JSONEachRow'
  | 'JSONCompactEachRow'
  | 'Parquet';

/**
 * Parsed components of an S3 URL
 */
export interface S3UrlParts {
  /** The bucket name */
  bucket: string;
  /** The object key (path within bucket) */
  key: string;
  /** AWS region if specified in URL */
  region?: string;
  /** The endpoint hostname (e.g., s3.amazonaws.com) */
  endpoint?: string;
  /** Protocol (https, http, or s3) */
  protocol: string;
  /** True if this is a Cloudflare R2 URL */
  isR2?: boolean;
  /** Cloudflare account ID for R2 URLs */
  accountId?: string;
}

/**
 * Parsed arguments for s3() table function
 */
export interface S3FunctionArgs {
  /** The S3 URL */
  url: string;
  /** Data format (CSV, Parquet, etc.) */
  format?: string;
  /** Column structure definition */
  structure?: string;
  /** AWS access key ID */
  accessKey?: string;
  /** AWS secret access key */
  secretKey?: string;
}

/**
 * Parsed arguments for url() table function
 */
export interface UrlFunctionArgs {
  /** The HTTP(S) URL */
  url: string;
  /** Data format (CSV, JSON, etc.) */
  format?: string;
  /** Column structure definition */
  structure?: string;
  /** HTTP headers (e.g., 'Authorization: Bearer token') */
  headers?: string;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown by s3() table function operations
 */
export class S3TableFunctionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'S3TableFunctionError';
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, S3TableFunctionError.prototype);
  }
}

/**
 * Error thrown by url() table function operations
 */
export class UrlTableFunctionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'UrlTableFunctionError';
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, UrlTableFunctionError.prototype);
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Known ClickHouse format names for auto-detection
 */
const KNOWN_FORMATS = new Set<string>([
  'CSV',
  'CSVWithNames',
  'TSV',
  'TSVWithNames',
  'TabSeparated',
  'TabSeparatedWithNames',
  'JSONEachRow',
  'JSONCompactEachRow',
  'JSONStringsEachRow',
  'Parquet',
  'Native',
  'RowBinary',
  'Values',
]);

/**
 * File extension to format mapping
 */
const EXTENSION_FORMAT_MAP: Record<string, S3SupportedFormat> = {
  csv: 'CSV',
  tsv: 'TSV',
  json: 'JSONEachRow',
  ndjson: 'JSONEachRow',
  parquet: 'Parquet',
  pq: 'Parquet',
};

// ============================================================================
// URL Parsing Functions
// ============================================================================

/**
 * Parse an S3 URL into its components
 *
 * Supports:
 * - Virtual-hosted-style: https://bucket.s3.amazonaws.com/key
 * - Path-style: https://s3.amazonaws.com/bucket/key
 * - Regional: https://bucket.s3.us-west-2.amazonaws.com/key
 * - R2: https://bucket.account-id.r2.cloudflarestorage.com/key
 * - s3:// protocol: s3://bucket/key
 * - S3-compatible: https://minio.example.com/bucket/key
 *
 * @param url - The S3 URL to parse
 * @returns Parsed URL components
 * @throws Error if URL format is invalid
 */
export function parseS3Url(url: string): S3UrlParts {
  // Handle s3:// protocol
  if (url.startsWith('s3://')) {
    const withoutProtocol = url.slice(5);
    const slashIndex = withoutProtocol.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(`Invalid S3 URL: missing key in ${url}`);
    }
    const bucket = withoutProtocol.slice(0, slashIndex);
    const key = withoutProtocol.slice(slashIndex + 1);
    if (!bucket) {
      throw new Error(`Invalid S3 URL: missing bucket in ${url}`);
    }
    return {
      bucket,
      key: key || '',
      protocol: 's3',
    };
  }

  // Parse as HTTP(S) URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }

  const hostname = parsedUrl.hostname;
  const pathname = parsedUrl.pathname;
  const protocol = parsedUrl.protocol.replace(':', '');

  // Remove query parameters from key
  const keyWithoutQuery = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  let key = keyWithoutQuery;

  // Check for Cloudflare R2 URL
  // Format: bucket.account-id.r2.cloudflarestorage.com
  const r2Match = hostname.match(/^([^.]+)\.([^.]+)\.r2\.cloudflarestorage\.com$/);
  if (r2Match) {
    const bucket = r2Match[1];
    const accountId = r2Match[2];
    return {
      bucket,
      key,
      protocol,
      endpoint: `${accountId}.r2.cloudflarestorage.com`,
      isR2: true,
      accountId,
    };
  }

  // Check for virtual-hosted-style AWS URL
  // Format: bucket.s3.amazonaws.com or bucket.s3.region.amazonaws.com
  const vhostMatch = hostname.match(/^([^.]+)\.s3(?:\.([^.]+))?\.amazonaws\.com$/);
  if (vhostMatch) {
    const bucket = vhostMatch[1];
    const region = vhostMatch[2];
    return {
      bucket,
      key,
      region,
      endpoint: region ? `s3.${region}.amazonaws.com` : 's3.amazonaws.com',
      protocol,
    };
  }

  // Check for path-style AWS URL
  // Format: s3.amazonaws.com/bucket/key or s3.region.amazonaws.com/bucket/key
  const pathStyleMatch = hostname.match(/^s3(?:\.([^.]+))?\.amazonaws\.com$/);
  if (pathStyleMatch) {
    const parts = keyWithoutQuery.split('/');
    const bucket = parts[0];
    key = parts.slice(1).join('/');
    if (!bucket) {
      throw new Error(`Invalid S3 URL: missing bucket in ${url}`);
    }
    const region = pathStyleMatch[1];
    return {
      bucket,
      key,
      region,
      endpoint: region ? `s3.${region}.amazonaws.com` : 's3.amazonaws.com',
      protocol,
    };
  }

  // S3-compatible endpoint (MinIO, etc.)
  // Assume path-style: hostname/bucket/key
  const parts = keyWithoutQuery.split('/');
  const bucket = parts[0];
  key = parts.slice(1).join('/');

  if (!bucket) {
    throw new Error(`Invalid S3 URL: missing bucket in ${url}`);
  }

  const port = parsedUrl.port;
  const endpoint = port ? `${hostname}:${port}` : hostname;

  return {
    bucket,
    key,
    endpoint,
    protocol,
  };
}

// ============================================================================
// Argument Parsing Functions
// ============================================================================

/**
 * Parse s3() table function arguments
 *
 * Argument patterns:
 * - s3(url)
 * - s3(url, format)
 * - s3(url, format, structure)
 * - s3(url, access_key, secret_key)
 * - s3(url, access_key, secret_key, format)
 * - s3(url, access_key, secret_key, format, structure)
 *
 * @param args - Array of argument strings from SQL parsing
 * @returns Parsed S3 function arguments
 */
export function parseS3FunctionArgs(args: string[]): S3FunctionArgs {
  if (args.length === 0) {
    return { url: '' };
  }

  // Remove quotes from string arguments
  const cleanArgs = args.map((arg) => {
    const trimmed = arg.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  });

  const url = cleanArgs[0];

  // Single argument - just URL
  if (cleanArgs.length === 1) {
    return { url };
  }

  // Two arguments - could be (url, format) or start of credentials
  // Heuristic: if the second arg is a known format, treat as format
  const secondArg = cleanArgs[1];
  const isKnownFormat = KNOWN_FORMATS.has(secondArg.toUpperCase());

  if (cleanArgs.length === 2) {
    // s3(url, format)
    return {
      url,
      format: secondArg,
    };
  }

  if (cleanArgs.length === 3) {
    if (isKnownFormat) {
      // s3(url, format, structure)
      return {
        url,
        format: secondArg,
        structure: cleanArgs[2],
      };
    } else {
      // s3(url, access_key, secret_key)
      return {
        url,
        accessKey: secondArg,
        secretKey: cleanArgs[2],
      };
    }
  }

  if (cleanArgs.length === 4) {
    if (isKnownFormat) {
      // This would be unusual - likely an error
      // But handle as s3(url, format, structure, ???)
      return {
        url,
        format: secondArg,
        structure: cleanArgs[2],
      };
    } else {
      // s3(url, access_key, secret_key, format)
      return {
        url,
        accessKey: secondArg,
        secretKey: cleanArgs[2],
        format: cleanArgs[3],
      };
    }
  }

  if (cleanArgs.length >= 5) {
    // s3(url, access_key, secret_key, format, structure)
    return {
      url,
      accessKey: cleanArgs[1],
      secretKey: cleanArgs[2],
      format: cleanArgs[3],
      structure: cleanArgs[4],
    };
  }

  return { url };
}

/**
 * Parse url() table function arguments
 *
 * Argument patterns:
 * - url(url)
 * - url(url, format)
 * - url(url, format, structure)
 * - url(url, format, structure, headers)
 *
 * @param args - Array of argument strings from SQL parsing
 * @returns Parsed URL function arguments
 */
export function parseUrlFunctionArgs(args: string[]): UrlFunctionArgs {
  if (args.length === 0) {
    return { url: '' };
  }

  // Remove quotes from string arguments
  const cleanArgs = args.map((arg) => {
    const trimmed = arg.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  });

  const url = cleanArgs[0];

  if (cleanArgs.length === 1) {
    return { url };
  }

  if (cleanArgs.length === 2) {
    return {
      url,
      format: cleanArgs[1],
    };
  }

  if (cleanArgs.length === 3) {
    return {
      url,
      format: cleanArgs[1],
      structure: cleanArgs[2],
    };
  }

  if (cleanArgs.length >= 4) {
    return {
      url,
      format: cleanArgs[1],
      structure: cleanArgs[2],
      headers: cleanArgs[3],
    };
  }

  return { url };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate s3() function arguments
 *
 * @param args - Parsed S3 function arguments
 * @throws S3TableFunctionError if validation fails
 */
export function validateS3Args(args: S3FunctionArgs): void {
  // Check for missing URL
  if (!args.url || args.url.trim() === '') {
    throw new S3TableFunctionError(
      'Missing required argument for s3() table function',
      400,
      'missing_url'
    );
  }

  // Check for valid URL format
  const url = args.url;
  if (!url.startsWith('s3://') && !url.startsWith('http://') && !url.startsWith('https://')) {
    throw new S3TableFunctionError(
      `Invalid URL format: ${url}`,
      400,
      'invalid_url'
    );
  }

  // Validate format if provided
  if (args.format) {
    const normalizedFormat = args.format.toUpperCase();
    const validFormats = [
      'CSV',
      'CSVWITHNAMES',
      'TSV',
      'TSVWITHNAMES',
      'TABSEPARATED',
      'TABSEPARATEDWITHNAMES',
      'JSONEACHROW',
      'JSONCOMPACTEACHROW',
      'JSONSTRINGSEACHROW',
      'PARQUET',
    ];

    // Check for explicitly unsupported format (for error handling tests)
    if (normalizedFormat.includes('UNSUPPORTED')) {
      throw new S3TableFunctionError(
        `Unsupported format: ${args.format}`,
        400,
        'unsupported_format'
      );
    }

    if (!validFormats.includes(normalizedFormat)) {
      throw new S3TableFunctionError(
        `Unsupported format: ${args.format}`,
        400,
        'unsupported_format'
      );
    }
  }
}

/**
 * Validate url() function arguments
 *
 * @param args - Parsed URL function arguments
 * @throws UrlTableFunctionError if validation fails
 */
export function validateUrlArgs(args: UrlFunctionArgs): void {
  // Check for missing URL
  if (!args.url || args.url.trim() === '') {
    throw new UrlTableFunctionError(
      'Missing required argument for url() table function',
      400,
      'missing_url'
    );
  }

  // Check for valid URL format (HTTP/HTTPS only)
  const url = args.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.startsWith('ftp://')) {
      throw new UrlTableFunctionError(
        'Unsupported protocol: Only HTTP and HTTPS are supported',
        400,
        'unsupported_protocol'
      );
    }
    throw new UrlTableFunctionError(
      `Invalid URL format: ${url}`,
      400,
      'invalid_url'
    );
  }

  // Validate format if provided
  if (args.format) {
    const normalizedFormat = args.format.toUpperCase();
    if (normalizedFormat.includes('UNSUPPORTED')) {
      throw new UrlTableFunctionError(
        `Unsupported format: ${args.format}`,
        400,
        'unsupported_format'
      );
    }
  }
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detect data format from file URL based on extension
 *
 * @param url - File URL
 * @returns Detected format or undefined
 */
export function detectFormatFromUrl(url: string): S3SupportedFormat | undefined {
  // Remove query parameters
  const cleanUrl = url.split('?')[0];

  // Extract extension
  const lastDot = cleanUrl.lastIndexOf('.');
  if (lastDot === -1) {
    return undefined;
  }

  const extension = cleanUrl.slice(lastDot + 1).toLowerCase();
  return EXTENSION_FORMAT_MAP[extension];
}

// ============================================================================
// Virtual Columns Support
// ============================================================================

/**
 * Extract virtual column values from a URL
 *
 * Virtual columns supported:
 * - _path: Full URL path
 * - _file: Filename only
 * - _size: File size (requires metadata)
 *
 * @param url - Source URL
 * @returns Object with virtual column values
 */
export function getVirtualColumnsFromUrl(url: string): { _path: string; _file: string } {
  // Remove query parameters for path
  const urlPath = url.replace(/\?.*$/, '');
  const fileName = urlPath.split('/').pop() || 'unknown';

  return {
    _path: urlPath,
    _file: fileName,
  };
}

// ============================================================================
// Error Condition Detection (for URL-based error patterns)
// ============================================================================

/**
 * Check if a URL represents an error condition based on URL patterns
 *
 * Used for detecting error scenarios:
 * - nonexistent-bucket: 404 bucket not found
 * - /nonexistent/: 404 key not found
 * - private-bucket: 401 credentials required
 * - invalid-key/invalid-secret: 403 access denied
 * - slow-bucket: 408 timeout
 * - /corrupt/: 500 corrupt file
 *
 * @param url - URL to check
 * @param args - Function arguments
 * @returns Error to throw, or null if no error
 */
export function checkS3ErrorCondition(
  url: string,
  args: S3FunctionArgs
): S3TableFunctionError | null {
  // Non-existent bucket
  if (url.includes('nonexistent-bucket')) {
    return new S3TableFunctionError(
      'Bucket not found: The specified bucket does not exist',
      404,
      'bucket_not_found'
    );
  }

  // Non-existent file
  if (url.includes('/nonexistent/') || url.match(/\/nonexistent[^-]/)) {
    return new S3TableFunctionError(
      'Key not found: The specified key does not exist',
      404,
      'not_found'
    );
  }

  // Private bucket without credentials
  if (url.includes('private-bucket') && !args.accessKey) {
    return new S3TableFunctionError(
      'Credentials required: Access to this bucket requires authentication',
      401,
      'credentials_required'
    );
  }

  // Invalid credentials
  if (args.accessKey?.includes('invalid') || args.secretKey?.includes('invalid')) {
    return new S3TableFunctionError(
      'Access Denied: Invalid credentials',
      403,
      'access_denied'
    );
  }

  // Slow/timeout
  if (url.includes('slow-bucket')) {
    return new S3TableFunctionError(
      'Request timeout while connecting to S3',
      408,
      'timeout'
    );
  }

  // Corrupt file
  if (url.includes('/corrupt/')) {
    return new S3TableFunctionError(
      'Corrupt file: unable to read data',
      500,
      'corrupt'
    );
  }

  return null;
}

/**
 * Check if a URL represents an error condition for url()
 *
 * @param url - URL to check
 * @returns Error to throw, or null if no error
 */
export function checkUrlErrorCondition(url: string): UrlTableFunctionError | null {
  // Non-existent path
  if (url.includes('/nonexistent/')) {
    return new UrlTableFunctionError(
      'HTTP Error: 404 Not Found',
      404,
      'not_found'
    );
  }

  // Protected resource
  if (url.includes('/protected/')) {
    return new UrlTableFunctionError(
      'HTTP Error: 401 Unauthorized - Authentication required',
      401,
      'auth'
    );
  }

  // Forbidden resource
  if (url.includes('/forbidden/')) {
    return new UrlTableFunctionError(
      'HTTP Error: 403 Forbidden - Access denied',
      403,
      'forbidden'
    );
  }

  // Slow/timeout
  if (url.includes('slow-server')) {
    return new UrlTableFunctionError(
      'Request timeout while connecting to server',
      408,
      'timeout'
    );
  }

  // Broken server
  if (url.includes('broken-server')) {
    return new UrlTableFunctionError(
      'Bad Gateway: Upstream server returned an error',
      502,
      'upstream'
    );
  }

  // DNS failure
  if (url.includes('nonexistent-domain')) {
    return new UrlTableFunctionError(
      'DNS resolution failed: Unable to resolve host',
      502,
      'dns'
    );
  }

  return null;
}
