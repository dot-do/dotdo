/**
 * R2 Range Request Handler
 *
 * Handles HTTP Range requests for R2 objects, enabling efficient
 * partial content retrieval for Parquet files and other large objects.
 *
 * Features:
 * - Parse HTTP Range headers (bytes=start-end, bytes=-suffix, bytes=start-)
 * - Build 206 Partial Content responses with correct headers
 * - Handle conditional requests (If-Range)
 * - Handle 416 Range Not Satisfiable errors
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
 * @see https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 */

/**
 * R2 Range specification for R2 bucket get options
 */
export interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

/**
 * R2 Bucket interface (subset needed for range requests)
 */
export interface R2BucketLike {
  get(key: string, options?: { range?: R2Range; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectHeadLike | null>;
}

/**
 * R2 Object with body (for range request responses)
 */
export interface R2ObjectBodyLike {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  range?: { offset: number; length: number };
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  writeHttpMetadata(headers: Headers): void;
}

/**
 * R2 Object head (metadata only)
 */
export interface R2ObjectHeadLike {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
}

/**
 * Parse an HTTP Range header into R2 Range format.
 *
 * Supports the following formats:
 * - bytes=0-1023 (specific range)
 * - bytes=-500 (suffix/last N bytes)
 * - bytes=1000- (from offset to end)
 * - bytes=0-100,200-300 (multipart - returns first range only)
 *
 * @param rangeHeader - The HTTP Range header value
 * @returns R2Range object or null if invalid
 */
export function parseRangeHeader(rangeHeader: string): R2Range | null {
  // Range header format: bytes=start-end or bytes=-suffix or bytes=start-
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const rangeSpec = rangeHeader.slice(6); // Remove "bytes="

  // Handle multipart ranges - for simplicity, use the first range
  const ranges = rangeSpec.split(',');
  const firstRange = ranges[0].trim();

  // Check for suffix range: bytes=-500
  if (firstRange.startsWith('-')) {
    const suffix = parseInt(firstRange.slice(1), 10);
    if (isNaN(suffix) || suffix < 0) {
      return null;
    }
    return { suffix };
  }

  // Check for open-ended or specific range
  const parts = firstRange.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const [startStr, endStr] = parts;

  // Must have a start value
  if (startStr === '') {
    return null;
  }

  const start = parseInt(startStr, 10);
  if (isNaN(start) || start < 0) {
    return null;
  }

  // Open-ended range: bytes=1000-
  if (endStr === '') {
    return { offset: start };
  }

  // Specific range: bytes=0-1023
  const end = parseInt(endStr, 10);
  if (isNaN(end) || end < start) {
    return null;
  }

  // R2 uses offset + length, HTTP Range uses start-end (inclusive)
  // bytes=0-1023 means bytes 0 through 1023 inclusive = 1024 bytes
  return {
    offset: start,
    length: end - start + 1,
  };
}

/**
 * Build a 206 Partial Content response with correct headers.
 *
 * @param data - The partial content data
 * @param range - The range that was requested (with offset and length)
 * @param totalSize - The total size of the complete resource
 * @returns A Response object with 206 status and correct headers
 */
export async function buildRangeResponse(
  data: ArrayBuffer,
  range: { offset: number; length: number },
  totalSize: number
): Promise<Response> {
  const headers = new Headers();

  // Content-Range: bytes start-end/total
  // Note: end is inclusive in HTTP Range header (so offset + length - 1)
  const rangeEnd = range.offset + range.length - 1;
  headers.set('Content-Range', `bytes ${range.offset}-${rangeEnd}/${totalSize}`);
  headers.set('Content-Length', String(data.byteLength));
  headers.set('Accept-Ranges', 'bytes');

  return new Response(data, {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}

/**
 * Build a 416 Range Not Satisfiable response.
 *
 * @param totalSize - The total size of the resource
 * @returns A Response object with 416 status
 */
function buildRangeNotSatisfiableResponse(totalSize: number): Response {
  const headers = new Headers();
  headers.set('Content-Range', `bytes */${totalSize}`);
  return new Response('Range Not Satisfiable', {
    status: 416,
    statusText: 'Range Not Satisfiable',
    headers,
  });
}

/**
 * Build a 404 Not Found response.
 *
 * @returns A Response object with 404 status
 */
function buildNotFoundResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    statusText: 'Not Found',
  });
}

/**
 * Handle a complete range request flow.
 *
 * This function:
 * 1. Parses the Range header from the request
 * 2. Handles If-Range conditional requests
 * 3. Fetches the object from R2 with range options
 * 4. Returns appropriate response (206 Partial, 200 Full, 404 Not Found, 416 Range Not Satisfiable)
 *
 * @param request - The incoming HTTP request
 * @param bucket - The R2 bucket to fetch from
 * @param key - The object key in the bucket
 * @returns A Response object
 */
export async function handleRangeRequest(
  request: Request,
  bucket: R2BucketLike,
  key: string
): Promise<Response> {
  // Get file metadata first to check if it exists and get size
  const headResult = await bucket.head(key);
  if (!headResult) {
    return buildNotFoundResponse();
  }

  const totalSize = headResult.size;
  const etag = headResult.httpEtag;

  // Parse Range header
  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader ? parseRangeHeader(rangeHeader) : null;

  // Handle If-Range header
  const ifRange = request.headers.get('If-Range');
  if (ifRange && range) {
    // If-Range can be an ETag or a date
    // If ETag doesn't match, ignore Range and return full content
    if (ifRange !== etag) {
      // ETag doesn't match - return full content
      const fullObject = await bucket.get(key);
      if (!fullObject) {
        return buildNotFoundResponse();
      }
      const data = await fullObject.arrayBuffer();
      const headers = new Headers();
      headers.set('Content-Length', String(data.byteLength));
      headers.set('Accept-Ranges', 'bytes');
      headers.set('ETag', etag);
      return new Response(data, {
        status: 200,
        headers,
      });
    }
  }

  // If no range requested, return full content
  if (!range) {
    const fullObject = await bucket.get(key);
    if (!fullObject) {
      return buildNotFoundResponse();
    }
    const data = await fullObject.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Length', String(data.byteLength));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('ETag', etag);
    return new Response(data, {
      status: 200,
      headers,
    });
  }

  // Convert parsed range to R2Range format
  let r2Range: R2Range;

  if (range.suffix !== undefined) {
    // Suffix range
    r2Range = { suffix: range.suffix };
  } else if (range.offset !== undefined && range.length !== undefined) {
    // Check if range is satisfiable
    if (range.offset >= totalSize) {
      return buildRangeNotSatisfiableResponse(totalSize);
    }
    r2Range = { offset: range.offset, length: range.length };
  } else if (range.offset !== undefined) {
    // Open-ended range
    if (range.offset >= totalSize) {
      return buildRangeNotSatisfiableResponse(totalSize);
    }
    r2Range = { offset: range.offset };
  } else {
    // Invalid range state - shouldn't happen but handle gracefully
    return buildRangeNotSatisfiableResponse(totalSize);
  }

  // Fetch with range
  const rangeObject = await bucket.get(key, { range: r2Range });
  if (!rangeObject) {
    return buildNotFoundResponse();
  }

  const data = await rangeObject.arrayBuffer();

  // Build response with correct range info
  const responseRange = rangeObject.range;
  if (!responseRange) {
    // Full content returned (shouldn't happen with range request but handle it)
    const headers = new Headers();
    headers.set('Content-Length', String(data.byteLength));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('ETag', etag);
    return new Response(data, {
      status: 200,
      headers,
    });
  }

  return buildRangeResponse(data, responseRange, totalSize);
}
