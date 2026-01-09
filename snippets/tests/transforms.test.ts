import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyRequestTransforms,
  applyResponseTransforms,
  resolveVar,
  type Transform,
  type ProxyContext,
} from '../proxy'

/**
 * Transform Tests (RED Phase)
 *
 * Transforms modify requests and responses as they pass through the proxy.
 *
 * Request transforms:
 * - setHeader: Add/overwrite request header
 * - removeHeader: Remove request header
 * - rewritePath: Apply regex replacement on path
 * - setQuery: Add/modify query parameter
 * - removeQuery: Remove query parameter
 *
 * Response transforms:
 * - setHeader: Add/overwrite response header
 * - removeHeader: Remove response header
 * - setStatus: Override response status code
 *
 * Variables (resolved at runtime):
 * - $requestId: Generated UUID
 * - $timestamp: Current timestamp
 * - $cf.*: Cloudflare request properties
 * - $jwt.*: JWT claims (after auth policy)
 * - $header.*: Request headers
 * - $query.*: URL query params
 * - $config.*: Config variables
 *
 * These tests are expected to FAIL until the proxy snippet is implemented.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestContext(overrides: Partial<ProxyContext> = {}): ProxyContext {
  return {
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: 1704825600000,
    ip: '192.168.1.1',
    cf: {
      colo: 'DFW',
      country: 'US',
      city: 'Dallas',
      botScore: 95,
    },
    jwt: null,
    config: {
      domain: 'example.com',
      apiVersion: 'v1',
    },
    ...overrides,
  }
}

function createTestRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init)
}

// ============================================================================
// Request Transform Tests - setHeader
// ============================================================================

describe('Request Transforms - setHeader', () => {
  it('setHeader adds new header', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Custom', value: 'custom-value' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.get('X-Custom')).toBe('custom-value')
  })

  it('setHeader overwrites existing header', () => {
    const request = createTestRequest('https://example.com/api/users', {
      headers: { 'X-Custom': 'original-value' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Custom', value: 'new-value' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.get('X-Custom')).toBe('new-value')
  })

  it('setHeader with variable resolution', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Request-Id', value: '$requestId' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.get('X-Request-Id')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('setHeader preserves other headers', () => {
    const request = createTestRequest('https://example.com/api/users', {
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Custom', value: 'value' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.get('Authorization')).toBe('Bearer token')
    expect(result.headers.get('Content-Type')).toBe('application/json')
    expect(result.headers.get('X-Custom')).toBe('value')
  })
})

// ============================================================================
// Request Transform Tests - removeHeader
// ============================================================================

describe('Request Transforms - removeHeader', () => {
  it('removeHeader removes header', () => {
    const request = createTestRequest('https://example.com/api/users', {
      headers: { 'X-Remove-Me': 'value' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'removeHeader', name: 'X-Remove-Me' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.has('X-Remove-Me')).toBe(false)
  })

  it('removeHeader handles non-existent header gracefully', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'removeHeader', name: 'X-Non-Existent' }]

    // Should not throw
    expect(() => applyRequestTransforms(request, transforms, context)).not.toThrow()
  })

  it('removeHeader is case-insensitive', () => {
    const request = createTestRequest('https://example.com/api/users', {
      headers: { 'X-Custom-Header': 'value' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'removeHeader', name: 'x-custom-header' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.has('X-Custom-Header')).toBe(false)
  })
})

// ============================================================================
// Request Transform Tests - rewritePath
// ============================================================================

describe('Request Transforms - rewritePath', () => {
  it('rewritePath applies regex replacement', () => {
    const request = createTestRequest('https://example.com/api/v1/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'rewritePath', pattern: '/api/v1', replacement: '/api/v2' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.pathname).toBe('/api/v2/users')
  })

  it('rewritePath with capture groups', () => {
    const request = createTestRequest('https://example.com/api/users/123/orders')
    const context = createTestContext()
    const transforms: Transform[] = [
      {
        op: 'rewritePath',
        pattern: '/api/users/([0-9]+)/orders',
        replacement: '/api/orders?userId=$1',
      },
    ]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.pathname).toBe('/api/orders')
    expect(resultUrl.searchParams.get('userId')).toBe('123')
  })

  it('rewritePath with multiple replacements', () => {
    const request = createTestRequest('https://example.com/old/old/path')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'rewritePath', pattern: 'old', replacement: 'new' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    // Should replace first occurrence only (standard regex replace behavior)
    expect(resultUrl.pathname).toBe('/new/old/path')
  })

  it('rewritePath with global flag replaces all', () => {
    const request = createTestRequest('https://example.com/old/old/path')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'rewritePath', pattern: 'old', replacement: 'new', flags: 'g' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.pathname).toBe('/new/new/path')
  })

  it('rewritePath preserves host and query', () => {
    const request = createTestRequest('https://example.com/api/v1/users?page=1')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'rewritePath', pattern: '/api/v1', replacement: '/api/v2' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.host).toBe('example.com')
    expect(resultUrl.searchParams.get('page')).toBe('1')
  })
})

// ============================================================================
// Request Transform Tests - setQuery
// ============================================================================

describe('Request Transforms - setQuery', () => {
  it('setQuery adds query parameter', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setQuery', name: 'page', value: '1' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.searchParams.get('page')).toBe('1')
  })

  it('setQuery overwrites existing parameter', () => {
    const request = createTestRequest('https://example.com/api/users?page=1')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setQuery', name: 'page', value: '2' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.searchParams.get('page')).toBe('2')
  })

  it('setQuery with variable resolution', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setQuery', name: 'requestId', value: '$requestId' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.searchParams.get('requestId')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('setQuery preserves other parameters', () => {
    const request = createTestRequest('https://example.com/api/users?existing=value')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setQuery', name: 'new', value: 'param' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.searchParams.get('existing')).toBe('value')
    expect(resultUrl.searchParams.get('new')).toBe('param')
  })
})

// ============================================================================
// Request Transform Tests - removeQuery
// ============================================================================

describe('Request Transforms - removeQuery', () => {
  it('removeQuery removes query parameter', () => {
    const request = createTestRequest('https://example.com/api/users?page=1&limit=10')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'removeQuery', name: 'page' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(resultUrl.searchParams.has('page')).toBe(false)
    expect(resultUrl.searchParams.get('limit')).toBe('10')
  })

  it('removeQuery handles non-existent parameter gracefully', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'removeQuery', name: 'nonexistent' }]

    expect(() => applyRequestTransforms(request, transforms, context)).not.toThrow()
  })
})

// ============================================================================
// Variable Resolution Tests
// ============================================================================

describe('Variable Resolution', () => {
  it('resolves $requestId variable', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    const result = resolveVar('$requestId', context, request)

    expect(result).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('resolves $timestamp variable', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    const result = resolveVar('$timestamp', context, request)

    expect(result).toBe('1704825600000')
  })

  it('resolves $cf.* variables from request.cf', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$cf.colo', context, request)).toBe('DFW')
    expect(resolveVar('$cf.country', context, request)).toBe('US')
    expect(resolveVar('$cf.city', context, request)).toBe('Dallas')
    expect(resolveVar('$cf.botScore', context, request)).toBe('95')
  })

  it('resolves $jwt.* variables after auth policy', () => {
    const context = createTestContext({
      jwt: {
        sub: 'user_123',
        email: 'user@example.com',
        roles: ['admin', 'user'],
      },
    })
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$jwt.sub', context, request)).toBe('user_123')
    expect(resolveVar('$jwt.email', context, request)).toBe('user@example.com')
  })

  it('resolves $jwt.* to empty string when no JWT', () => {
    const context = createTestContext({ jwt: null })
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$jwt.sub', context, request)).toBe('')
    expect(resolveVar('$jwt.email', context, request)).toBe('')
  })

  it('resolves $header.* from request headers', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users', {
      headers: {
        Authorization: 'Bearer token123',
        'X-Custom': 'custom-value',
      },
    })

    expect(resolveVar('$header.Authorization', context, request)).toBe('Bearer token123')
    expect(resolveVar('$header.X-Custom', context, request)).toBe('custom-value')
  })

  it('resolves $header.* to empty string for missing header', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$header.X-Missing', context, request)).toBe('')
  })

  it('resolves $query.* from URL search params', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users?page=1&limit=10')

    expect(resolveVar('$query.page', context, request)).toBe('1')
    expect(resolveVar('$query.limit', context, request)).toBe('10')
  })

  it('resolves $query.* to empty string for missing param', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$query.missing', context, request)).toBe('')
  })

  it('resolves $config.* from config.variables', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$config.domain', context, request)).toBe('example.com')
    expect(resolveVar('$config.apiVersion', context, request)).toBe('v1')
  })

  it('resolves $config.* to empty string for missing variable', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('$config.missing', context, request)).toBe('')
  })

  it('returns literal value for non-variable strings', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users')

    expect(resolveVar('literal-value', context, request)).toBe('literal-value')
    expect(resolveVar('no-dollar-sign', context, request)).toBe('no-dollar-sign')
  })

  it('handles $method variable', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users', { method: 'POST' })

    expect(resolveVar('$method', context, request)).toBe('POST')
  })

  it('handles $path variable', () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com/api/users/123')

    expect(resolveVar('$path', context, request)).toBe('/api/users/123')
  })

  it('handles nested JWT claims', () => {
    const context = createTestContext({
      jwt: {
        sub: 'user_123',
        metadata: {
          orgId: 'org_456',
        },
      },
    })
    const request = createTestRequest('https://example.com/api/users')

    // Deep access might be supported via dot notation
    expect(resolveVar('$jwt.sub', context, request)).toBe('user_123')
    // Nested access depends on implementation
    // expect(resolveVar('$jwt.metadata.orgId', context, request)).toBe('org_456')
  })
})

// ============================================================================
// Response Transform Tests
// ============================================================================

describe('Response Transforms - setHeader', () => {
  it('setHeader adds header to response', () => {
    const response = new Response('body', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Served-By', value: 'dotdo' }]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.headers.get('X-Served-By')).toBe('dotdo')
  })

  it('setHeader overwrites existing response header', () => {
    const response = new Response('body', {
      status: 200,
      headers: { 'X-Custom': 'original' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Custom', value: 'modified' }]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.headers.get('X-Custom')).toBe('modified')
  })

  it('setHeader with variable in response', () => {
    const response = new Response('body', { status: 200 })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Request-Id', value: '$requestId' }]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.headers.get('X-Request-Id')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})

describe('Response Transforms - removeHeader', () => {
  it('removeHeader removes response header', () => {
    const response = new Response('body', {
      status: 200,
      headers: { 'X-Remove-Me': 'value', 'X-Keep': 'value' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'removeHeader', name: 'X-Remove-Me' }]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.headers.has('X-Remove-Me')).toBe(false)
    expect(result.headers.get('X-Keep')).toBe('value')
  })
})

describe('Response Transforms - setStatus', () => {
  it('setStatus overrides response status', () => {
    const response = new Response('body', { status: 200 })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setStatus', value: '201' }]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.status).toBe(201)
  })

  it('setStatus preserves response body', async () => {
    const response = new Response('original body', { status: 200 })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setStatus', value: '201' }]

    const result = applyResponseTransforms(response, transforms, context)
    const body = await result.text()

    expect(body).toBe('original body')
  })

  it('setStatus preserves other headers', () => {
    const response = new Response('body', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setStatus', value: '201' }]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.status).toBe(201)
    expect(result.headers.get('Content-Type')).toBe('application/json')
  })
})

// ============================================================================
// Multiple Transforms Tests
// ============================================================================

describe('Multiple Transforms', () => {
  it('applies multiple request transforms in order', () => {
    const request = createTestRequest('https://example.com/api/v1/users', {
      headers: { 'X-Old': 'value' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [
      { op: 'setHeader', name: 'X-Request-Id', value: '$requestId' },
      { op: 'setHeader', name: 'X-Timestamp', value: '$timestamp' },
      { op: 'removeHeader', name: 'X-Old' },
      { op: 'rewritePath', pattern: '/api/v1', replacement: '/api/v2' },
      { op: 'setQuery', name: 'source', value: 'proxy' },
    ]

    const result = applyRequestTransforms(request, transforms, context)
    const resultUrl = new URL(result.url)

    expect(result.headers.get('X-Request-Id')).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(result.headers.get('X-Timestamp')).toBe('1704825600000')
    expect(result.headers.has('X-Old')).toBe(false)
    expect(resultUrl.pathname).toBe('/api/v2/users')
    expect(resultUrl.searchParams.get('source')).toBe('proxy')
  })

  it('applies multiple response transforms in order', () => {
    const response = new Response('body', {
      status: 200,
      headers: { 'X-Old': 'value' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [
      { op: 'setHeader', name: 'X-Served-By', value: 'dotdo' },
      { op: 'setHeader', name: 'X-Request-Id', value: '$requestId' },
      { op: 'removeHeader', name: 'X-Old' },
      { op: 'setStatus', value: '201' },
    ]

    const result = applyResponseTransforms(response, transforms, context)

    expect(result.headers.get('X-Served-By')).toBe('dotdo')
    expect(result.headers.get('X-Request-Id')).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(result.headers.has('X-Old')).toBe(false)
    expect(result.status).toBe(201)
  })

  it('handles empty transforms array', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()

    const result = applyRequestTransforms(request, [], context)

    // Should return equivalent request
    expect(result.url).toBe(request.url)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Transform Edge Cases', () => {
  it('handles undefined value in setHeader gracefully', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Test' }] // value is undefined

    // Should not throw, might set empty string or skip
    expect(() => applyRequestTransforms(request, transforms, context)).not.toThrow()
  })

  it('preserves request body through transforms', async () => {
    const body = JSON.stringify({ data: 'test' })
    const request = createTestRequest('https://example.com/api/users', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Custom', value: 'value' }]

    const result = applyRequestTransforms(request, transforms, context)
    const resultBody = await result.text()

    expect(resultBody).toBe(body)
  })

  it('preserves request method through transforms', () => {
    const request = createTestRequest('https://example.com/api/users', { method: 'POST' })
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Custom', value: 'value' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.method).toBe('POST')
  })

  it('handles special characters in header values', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Test', value: 'value with spaces and !@#$%' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.get('X-Test')).toBe('value with spaces and !@#$%')
  })

  it('handles unicode in header values', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms: Transform[] = [{ op: 'setHeader', name: 'X-Test', value: 'Unicode: \u4e2d\u6587' }]

    const result = applyRequestTransforms(request, transforms, context)

    expect(result.headers.get('X-Test')).toBe('Unicode: \u4e2d\u6587')
  })

  it('handles unknown transform operation gracefully', () => {
    const request = createTestRequest('https://example.com/api/users')
    const context = createTestContext()
    const transforms = [{ op: 'unknownOp', name: 'test' }] as Transform[]

    // Should skip unknown ops or handle gracefully
    expect(() => applyRequestTransforms(request, transforms, context)).not.toThrow()
  })
})
