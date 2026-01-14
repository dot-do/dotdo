/**
 * CDN Delivery Tests - TDD RED/GREEN Phase
 *
 * Tests for the CDN delivery layer providing:
 * - Cache-Control header generation
 * - ETag generation and validation
 * - Conditional request handling (If-None-Match, If-Modified-Since)
 * - Range request support
 * - Content negotiation
 * - R2-backed content delivery optimization
 *
 * @see https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createCDNDelivery,
  type CDNDelivery,
  type CDNDeliveryConfig,
  type DeliveryRequest,
  type DeliveryResponse,
  type CacheOptions,
  type ConditionalHeaders,
  generateETag,
  generateCacheControl,
  isStaleResponse,
} from '../cdn-delivery'

// =============================================================================
// Mock R2 Objects
// =============================================================================

interface MockR2ObjectBody {
  key: string
  version: string
  size: number
  etag: string
  httpEtag: string
  uploaded: Date
  httpMetadata?: {
    contentType?: string
    contentLanguage?: string
    contentDisposition?: string
    contentEncoding?: string
    cacheControl?: string
    cacheExpiry?: Date
  }
  customMetadata?: Record<string, string>
  checksums?: {
    md5?: ArrayBuffer
  }
  body: ReadableStream
  bodyUsed: boolean
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T>(): Promise<T>
  blob(): Promise<Blob>
  writeHttpMetadata(headers: Headers): void
}

function createMockR2Object(
  key: string,
  content: string,
  options: {
    contentType?: string
    cacheControl?: string
    customMetadata?: Record<string, string>
    uploaded?: Date
    etag?: string
  } = {}
): MockR2ObjectBody {
  const data = new TextEncoder().encode(content)
  const uploaded = options.uploaded || new Date()
  const etag = options.etag || `"${crypto.randomUUID()}"`

  return {
    key,
    version: crypto.randomUUID(),
    size: data.byteLength,
    etag,
    httpEtag: etag,
    uploaded,
    httpMetadata: {
      contentType: options.contentType || 'application/octet-stream',
      cacheControl: options.cacheControl,
    },
    customMetadata: options.customMetadata,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    }),
    bodyUsed: false,
    arrayBuffer: vi.fn(async () => data.buffer as ArrayBuffer),
    text: vi.fn(async () => content),
    json: vi.fn(async () => JSON.parse(content)),
    blob: vi.fn(async () => new Blob([data])),
    writeHttpMetadata: vi.fn((headers: Headers) => {
      if (options.contentType) {
        headers.set('Content-Type', options.contentType)
      }
    }),
  }
}

function createMockR2Bucket() {
  const store = new Map<
    string,
    {
      data: Uint8Array
      contentType?: string
      cacheControl?: string
      customMetadata?: Record<string, string>
      uploaded: Date
      etag: string
    }
  >()

  return {
    get: vi.fn(async (key: string): Promise<MockR2ObjectBody | null> => {
      const entry = store.get(key)
      if (!entry) return null
      return createMockR2Object(key, new TextDecoder().decode(entry.data), {
        contentType: entry.contentType,
        cacheControl: entry.cacheControl,
        customMetadata: entry.customMetadata,
        uploaded: entry.uploaded,
        etag: entry.etag,
      })
    }),
    head: vi.fn(async (key: string) => {
      const entry = store.get(key)
      if (!entry) return null
      const obj = createMockR2Object(key, new TextDecoder().decode(entry.data), {
        contentType: entry.contentType,
        cacheControl: entry.cacheControl,
        customMetadata: entry.customMetadata,
        uploaded: entry.uploaded,
        etag: entry.etag,
      })
      // Head returns object without body
      return { ...obj, body: null }
    }),
    put: vi.fn(
      async (
        key: string,
        value: string | ArrayBuffer | ReadableStream,
        options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }
      ) => {
        let data: Uint8Array
        if (typeof value === 'string') {
          data = new TextEncoder().encode(value)
        } else if (value instanceof ArrayBuffer) {
          data = new Uint8Array(value)
        } else {
          const reader = value.getReader()
          const chunks: Uint8Array[] = []
          let result = await reader.read()
          while (!result.done) {
            chunks.push(result.value)
            result = await reader.read()
          }
          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
          data = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }
        }
        store.set(key, {
          data,
          contentType: options?.httpMetadata?.contentType,
          cacheControl: options?.httpMetadata?.cacheControl,
          customMetadata: options?.customMetadata,
          uploaded: new Date(),
          etag: `"${crypto.randomUUID()}"`,
        })
      }
    ),
    _store: store,
  }
}

// =============================================================================
// CDN Delivery Factory Tests
// =============================================================================

describe('CDNDelivery', () => {
  describe('factory', () => {
    it('should export createCDNDelivery factory function', () => {
      expect(typeof createCDNDelivery).toBe('function')
    })

    it('should create a CDN delivery instance', () => {
      const mockR2 = createMockR2Bucket()
      const cdn = createCDNDelivery({ bucket: mockR2 as unknown as R2Bucket })

      expect(cdn).toBeDefined()
      expect(typeof cdn.deliver).toBe('function')
      expect(typeof cdn.handleRequest).toBe('function')
    })

    it('should accept configuration options', () => {
      const mockR2 = createMockR2Bucket()
      const cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        defaultCacheControl: 'public, max-age=3600',
        enableRangeRequests: true,
        enableConditionalRequests: true,
      })

      expect(cdn).toBeDefined()
    })
  })

  // ===========================================================================
  // Cache-Control Header Tests
  // ===========================================================================

  describe('Cache-Control headers', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        defaultCacheControl: 'public, max-age=86400',
      })

      // Store test file
      await mockR2.put('test-image.jpg', 'fake image data', {
        httpMetadata: { contentType: 'image/jpeg' },
      })
    })

    it('should include Cache-Control header in response', async () => {
      const response = await cdn.deliver('test-image.jpg')

      expect(response.headers.get('Cache-Control')).toBeDefined()
    })

    it('should use default Cache-Control when object has none', async () => {
      const response = await cdn.deliver('test-image.jpg')

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')
    })

    it('should respect object-level Cache-Control over default', async () => {
      await mockR2.put('cached-file.txt', 'content', {
        httpMetadata: {
          contentType: 'text/plain',
          cacheControl: 'public, max-age=3600, immutable',
        },
      })

      const response = await cdn.deliver('cached-file.txt')

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600, immutable')
    })

    it('should support cache options override per request', async () => {
      const response = await cdn.deliver('test-image.jpg', {
        cacheControl: 'private, no-cache',
      })

      expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    })

    it('should support stale-while-revalidate directive', async () => {
      await mockR2.put('swr-file.txt', 'content', {
        httpMetadata: {
          contentType: 'text/plain',
          cacheControl: 'public, max-age=60, stale-while-revalidate=3600',
        },
      })

      const response = await cdn.deliver('swr-file.txt')

      expect(response.headers.get('Cache-Control')).toContain('stale-while-revalidate')
    })

    it('should support stale-if-error directive', async () => {
      await mockR2.put('sie-file.txt', 'content', {
        httpMetadata: {
          contentType: 'text/plain',
          cacheControl: 'public, max-age=60, stale-if-error=86400',
        },
      })

      const response = await cdn.deliver('sie-file.txt')

      expect(response.headers.get('Cache-Control')).toContain('stale-if-error')
    })

    it('should support immutable directive for versioned assets', async () => {
      await mockR2.put('assets/bundle.abc123.js', 'js content', {
        httpMetadata: {
          contentType: 'application/javascript',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      })

      const response = await cdn.deliver('assets/bundle.abc123.js')

      expect(response.headers.get('Cache-Control')).toContain('immutable')
    })
  })

  // ===========================================================================
  // ETag Generation Tests
  // ===========================================================================

  describe('ETag generation', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({ bucket: mockR2 as unknown as R2Bucket })

      await mockR2.put('test-file.txt', 'test content')
    })

    it('should include ETag header in response', async () => {
      const response = await cdn.deliver('test-file.txt')

      expect(response.headers.get('ETag')).toBeDefined()
    })

    it('should use R2 object httpEtag when available', async () => {
      const response = await cdn.deliver('test-file.txt')

      const etag = response.headers.get('ETag')
      expect(etag).toMatch(/^"[^"]+"$/) // Quoted string format
    })

    it('should generate strong ETags by default', async () => {
      const response = await cdn.deliver('test-file.txt')

      const etag = response.headers.get('ETag')
      // Strong ETag should not have W/ prefix
      expect(etag).not.toMatch(/^W\//)
    })

    it('should support weak ETags when configured', async () => {
      const weakCdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        weakETags: true,
      })

      const response = await weakCdn.deliver('test-file.txt')

      const etag = response.headers.get('ETag')
      expect(etag).toMatch(/^W\//)
    })

    it('should return consistent ETag for same content', async () => {
      const response1 = await cdn.deliver('test-file.txt')
      const response2 = await cdn.deliver('test-file.txt')

      expect(response1.headers.get('ETag')).toBe(response2.headers.get('ETag'))
    })
  })

  // ===========================================================================
  // Conditional Request Tests (If-None-Match)
  // ===========================================================================

  describe('If-None-Match conditional requests', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        enableConditionalRequests: true,
      })

      await mockR2.put('test-file.txt', 'test content')
    })

    it('should return 304 Not Modified when ETag matches', async () => {
      const initialResponse = await cdn.deliver('test-file.txt')
      const etag = initialResponse.headers.get('ETag')

      const conditionalResponse = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifNoneMatch: etag!,
        },
      })

      expect(conditionalResponse.status).toBe(304)
    })

    it('should return 200 with body when ETag does not match', async () => {
      const response = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifNoneMatch: '"different-etag"',
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).not.toBeNull()
    })

    it('should handle multiple ETags in If-None-Match', async () => {
      const initialResponse = await cdn.deliver('test-file.txt')
      const etag = initialResponse.headers.get('ETag')

      const conditionalResponse = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifNoneMatch: `"other-etag", ${etag}, "another-etag"`,
        },
      })

      expect(conditionalResponse.status).toBe(304)
    })

    it('should handle wildcard (*) in If-None-Match', async () => {
      const response = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifNoneMatch: '*',
        },
      })

      expect(response.status).toBe(304)
    })

    it('should not have body in 304 response', async () => {
      const initialResponse = await cdn.deliver('test-file.txt')
      const etag = initialResponse.headers.get('ETag')

      const conditionalResponse = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifNoneMatch: etag!,
        },
      })

      expect(conditionalResponse.status).toBe(304)
      expect(conditionalResponse.body).toBeNull()
    })

    it('should preserve relevant headers in 304 response', async () => {
      const initialResponse = await cdn.deliver('test-file.txt')
      const etag = initialResponse.headers.get('ETag')

      const conditionalResponse = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifNoneMatch: etag!,
        },
      })

      expect(conditionalResponse.headers.get('ETag')).toBe(etag)
      expect(conditionalResponse.headers.get('Cache-Control')).toBeDefined()
    })
  })

  // ===========================================================================
  // Conditional Request Tests (If-Modified-Since)
  // ===========================================================================

  describe('If-Modified-Since conditional requests', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery
    const fixedDate = new Date('2024-01-15T12:00:00Z')

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        enableConditionalRequests: true,
      })

      // Store file with known upload date
      mockR2._store.set('test-file.txt', {
        data: new TextEncoder().encode('test content'),
        contentType: 'text/plain',
        uploaded: fixedDate,
        etag: '"test-etag"',
      })
    })

    it('should include Last-Modified header in response', async () => {
      const response = await cdn.deliver('test-file.txt')

      expect(response.headers.get('Last-Modified')).toBeDefined()
    })

    it('should return 304 when file not modified since date', async () => {
      const futureDate = new Date('2024-01-20T12:00:00Z')

      const response = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifModifiedSince: futureDate.toUTCString(),
        },
      })

      expect(response.status).toBe(304)
    })

    it('should return 200 when file modified after date', async () => {
      const pastDate = new Date('2024-01-10T12:00:00Z')

      const response = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifModifiedSince: pastDate.toUTCString(),
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).not.toBeNull()
    })

    it('should handle invalid date in If-Modified-Since gracefully', async () => {
      const response = await cdn.deliver('test-file.txt', {
        conditionalHeaders: {
          ifModifiedSince: 'invalid-date',
        },
      })

      // Should ignore invalid date and return full response
      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // Range Request Tests
  // ===========================================================================

  describe('Range requests', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery
    const testContent = 'abcdefghijklmnopqrstuvwxyz' // 26 bytes

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        enableRangeRequests: true,
      })

      await mockR2.put('range-test.txt', testContent, {
        httpMetadata: { contentType: 'text/plain' },
      })
    })

    it('should include Accept-Ranges header', async () => {
      const response = await cdn.deliver('range-test.txt')

      expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    })

    it('should return 206 Partial Content for valid range', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'bytes=0-9',
      })

      expect(response.status).toBe(206)
    })

    it('should include Content-Range header for partial response', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'bytes=0-9',
      })

      expect(response.headers.get('Content-Range')).toMatch(/^bytes 0-9\/\d+$/)
    })

    it('should return correct byte range', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'bytes=0-4',
      })

      const body = await response.text()
      expect(body).toBe('abcde')
    })

    it('should handle suffix range (last N bytes)', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'bytes=-5',
      })

      expect(response.status).toBe(206)
      const body = await response.text()
      expect(body).toBe('vwxyz')
    })

    it('should handle open-ended range (from N to end)', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'bytes=20-',
      })

      expect(response.status).toBe(206)
      const body = await response.text()
      expect(body).toBe('uvwxyz')
    })

    it('should return 416 for invalid range', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'bytes=100-200',
      })

      expect(response.status).toBe(416)
      expect(response.headers.get('Content-Range')).toMatch(/^bytes \*\/\d+$/)
    })

    it('should ignore invalid range format', async () => {
      const response = await cdn.deliver('range-test.txt', {
        range: 'invalid-range',
      })

      // Should return full content when range is invalid
      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // Content Negotiation Tests
  // ===========================================================================

  describe('Content negotiation', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({ bucket: mockR2 as unknown as R2Bucket })

      await mockR2.put('image.jpg', 'fake jpeg', {
        httpMetadata: { contentType: 'image/jpeg' },
      })
    })

    it('should include Content-Type header', async () => {
      const response = await cdn.deliver('image.jpg')

      expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    })

    it('should include Content-Length header', async () => {
      const response = await cdn.deliver('image.jpg')

      expect(response.headers.get('Content-Length')).toBeDefined()
    })

    it('should support Content-Disposition for downloads', async () => {
      const response = await cdn.deliver('image.jpg', {
        disposition: 'attachment; filename="photo.jpg"',
      })

      expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="photo.jpg"')
    })
  })

  // ===========================================================================
  // Request Handler Tests
  // ===========================================================================

  describe('handleRequest', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        pathPrefix: '/cdn/',
        enableConditionalRequests: true,
        enableRangeRequests: true,
      })

      await mockR2.put('assets/style.css', 'body { color: red; }', {
        httpMetadata: { contentType: 'text/css' },
      })
    })

    it('should handle full Request object', async () => {
      const request = new Request('https://example.com/cdn/assets/style.css')

      const response = await cdn.handleRequest(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/css')
    })

    it('should extract path from URL with prefix', async () => {
      const request = new Request('https://example.com/cdn/assets/style.css')

      const response = await cdn.handleRequest(request)

      expect(response.status).toBe(200)
    })

    it('should handle If-None-Match header from request', async () => {
      const initialRequest = new Request('https://example.com/cdn/assets/style.css')
      const initialResponse = await cdn.handleRequest(initialRequest)
      const etag = initialResponse.headers.get('ETag')

      const conditionalRequest = new Request('https://example.com/cdn/assets/style.css', {
        headers: { 'If-None-Match': etag! },
      })

      const conditionalResponse = await cdn.handleRequest(conditionalRequest)

      expect(conditionalResponse.status).toBe(304)
    })

    it('should handle Range header from request', async () => {
      const request = new Request('https://example.com/cdn/assets/style.css', {
        headers: { Range: 'bytes=0-4' },
      })

      const response = await cdn.handleRequest(request)

      expect(response.status).toBe(206)
    })

    it('should return 404 for non-existent file', async () => {
      const request = new Request('https://example.com/cdn/not-found.txt')

      const response = await cdn.handleRequest(request)

      expect(response.status).toBe(404)
    })

    it('should handle HEAD requests', async () => {
      const request = new Request('https://example.com/cdn/assets/style.css', {
        method: 'HEAD',
      })

      const response = await cdn.handleRequest(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/css')
      // HEAD should not have body
      const body = await response.text()
      expect(body).toBe('')
    })

    it('should return 405 for non-GET/HEAD methods', async () => {
      const request = new Request('https://example.com/cdn/assets/style.css', {
        method: 'POST',
      })

      const response = await cdn.handleRequest(request)

      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, HEAD')
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    let cdn: CDNDelivery

    beforeEach(() => {
      const mockR2 = {
        get: vi.fn().mockRejectedValue(new Error('R2 error')),
        head: vi.fn().mockRejectedValue(new Error('R2 error')),
      }
      cdn = createCDNDelivery({ bucket: mockR2 as unknown as R2Bucket })
    })

    it('should return 500 for R2 errors', async () => {
      const response = await cdn.deliver('any-file.txt')

      expect(response.status).toBe(500)
    })

    it('should not expose internal error details', async () => {
      const response = await cdn.deliver('any-file.txt')

      const body = await response.text()
      expect(body).not.toContain('R2 error')
      expect(body).toContain('Internal Server Error')
    })
  })

  // ===========================================================================
  // Security Headers Tests
  // ===========================================================================

  describe('security headers', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        securityHeaders: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      })

      await mockR2.put('file.txt', 'content')
    })

    it('should include X-Content-Type-Options header', async () => {
      const response = await cdn.deliver('file.txt')

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })

    it('should include X-Frame-Options header', async () => {
      const response = await cdn.deliver('file.txt')

      expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    })

    it('should include CORP header', async () => {
      const response = await cdn.deliver('file.txt')

      expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
    })
  })

  // ===========================================================================
  // CORS Support Tests
  // ===========================================================================

  describe('CORS support', () => {
    let mockR2: ReturnType<typeof createMockR2Bucket>
    let cdn: CDNDelivery

    beforeEach(async () => {
      mockR2 = createMockR2Bucket()
      cdn = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        cors: {
          allowOrigins: ['https://example.com'],
          allowMethods: ['GET', 'HEAD'],
          exposeHeaders: ['ETag', 'Content-Length'],
        },
      })

      await mockR2.put('font.woff2', 'fake font data', {
        httpMetadata: { contentType: 'font/woff2' },
      })
    })

    it('should include Access-Control-Allow-Origin header', async () => {
      const response = await cdn.deliver('font.woff2', {
        origin: 'https://example.com',
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    })

    it('should include Access-Control-Expose-Headers', async () => {
      const response = await cdn.deliver('font.woff2', {
        origin: 'https://example.com',
      })

      expect(response.headers.get('Access-Control-Expose-Headers')).toContain('ETag')
    })

    it('should handle preflight OPTIONS request', async () => {
      const cdnWithCors = createCDNDelivery({
        bucket: mockR2 as unknown as R2Bucket,
        cors: {
          allowOrigins: ['https://example.com'],
          allowMethods: ['GET', 'HEAD'],
          maxAge: 86400,
        },
      })

      const request = new Request('https://cdn.example.com/font.woff2', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const response = await cdnWithCors.handleRequest(request)

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET')
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400')
    })

    it('should not include CORS headers for non-allowed origins', async () => {
      const response = await cdn.deliver('font.woff2', {
        origin: 'https://evil.com',
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })
  })
})

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('Utility functions', () => {
  describe('generateETag', () => {
    it('should generate consistent ETag for same input', () => {
      const etag1 = generateETag('content-hash', 1000)
      const etag2 = generateETag('content-hash', 1000)

      expect(etag1).toBe(etag2)
    })

    it('should generate different ETags for different inputs', () => {
      const etag1 = generateETag('hash1', 1000)
      const etag2 = generateETag('hash2', 1000)

      expect(etag1).not.toBe(etag2)
    })

    it('should return quoted string format', () => {
      const etag = generateETag('hash', 1000)

      expect(etag).toMatch(/^"[^"]+"$/)
    })
  })

  describe('generateCacheControl', () => {
    it('should generate public cache control', () => {
      const cc = generateCacheControl({ public: true, maxAge: 3600 })

      expect(cc).toBe('public, max-age=3600')
    })

    it('should generate private cache control', () => {
      const cc = generateCacheControl({ private: true, maxAge: 60 })

      expect(cc).toBe('private, max-age=60')
    })

    it('should include s-maxage for CDN caching', () => {
      const cc = generateCacheControl({ public: true, maxAge: 60, sMaxAge: 3600 })

      expect(cc).toContain('s-maxage=3600')
    })

    it('should include immutable directive', () => {
      const cc = generateCacheControl({ public: true, maxAge: 31536000, immutable: true })

      expect(cc).toContain('immutable')
    })

    it('should include stale-while-revalidate', () => {
      const cc = generateCacheControl({
        public: true,
        maxAge: 60,
        staleWhileRevalidate: 3600,
      })

      expect(cc).toContain('stale-while-revalidate=3600')
    })
  })

  describe('isStaleResponse', () => {
    it('should return false for fresh response', () => {
      const headers = new Headers({
        'Cache-Control': 'max-age=3600',
        Date: new Date().toUTCString(),
      })

      expect(isStaleResponse(headers)).toBe(false)
    })

    it('should return true for expired response', () => {
      const pastDate = new Date(Date.now() - 7200 * 1000) // 2 hours ago
      const headers = new Headers({
        'Cache-Control': 'max-age=3600',
        Date: pastDate.toUTCString(),
      })

      expect(isStaleResponse(headers)).toBe(true)
    })

    it('should handle missing Date header', () => {
      const headers = new Headers({
        'Cache-Control': 'max-age=3600',
      })

      // Without Date, cannot determine staleness - assume fresh
      expect(isStaleResponse(headers)).toBe(false)
    })
  })
})
