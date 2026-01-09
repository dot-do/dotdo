import { describe, it, expect } from 'vitest'
import {
  applyRequestTransforms,
  applyResponseTransforms,
  resolveVar,
  type ProxyContext,
  type RequestTransform,
  type ResponseTransform,
} from '../../proxy'

/**
 * Transform Tests (GREEN Phase)
 *
 * Tests for request and response transformations.
 */

describe('Request Transforms', () => {
  const baseContext: ProxyContext = {
    requestId: 'test-uuid-123',
    timestamp: 1704825600000,
    ip: '1.2.3.4',
    cf: { colo: 'DFW', country: 'US', botScore: 95 },
    jwt: null,
    config: { domain: 'example.com' },
  }

  it('setHeader adds new header', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-New-Header', value: 'test-value' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-New-Header')).toBe('test-value')
  })

  it('setHeader overwrites existing header', () => {
    const request = new Request('https://example.com/api/test', {
      headers: { 'X-Existing': 'old-value' },
    })
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Existing', value: 'new-value' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Existing')).toBe('new-value')
  })

  it('removeHeader removes header', () => {
    const request = new Request('https://example.com/api/test', {
      headers: { 'X-Remove-Me': 'value' },
    })
    const transforms: RequestTransform[] = [{ op: 'removeHeader', name: 'X-Remove-Me' }]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.has('X-Remove-Me')).toBe(false)
  })

  it('rewritePath applies regex replacement', () => {
    const request = new Request('https://example.com/v1/api/users')
    const transforms: RequestTransform[] = [
      { op: 'rewritePath', pattern: '^/v1', replacement: '/v2' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(new URL(result.url).pathname).toBe('/v2/api/users')
  })

  it('setQuery adds query parameter', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setQuery', name: 'new-param', value: 'test-value' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(new URL(result.url).searchParams.get('new-param')).toBe('test-value')
  })

  it('removeQuery removes query parameter', () => {
    const request = new Request('https://example.com/api/test?remove-me=value&keep=true')
    const transforms: RequestTransform[] = [{ op: 'removeQuery', name: 'remove-me' }]

    const result = applyRequestTransforms(request, transforms, baseContext)
    const url = new URL(result.url)

    expect(url.searchParams.has('remove-me')).toBe(false)
    expect(url.searchParams.get('keep')).toBe('true')
  })

  it('resolves $requestId variable', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Request-Id', value: '$requestId' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Request-Id')).toBe('test-uuid-123')
  })

  it('resolves $timestamp variable', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Timestamp', value: '$timestamp' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Timestamp')).toBe('1704825600000')
  })

  it('resolves $cf.* variables from request.cf', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Colo', value: '$cf.colo' },
      { op: 'setHeader', name: 'X-Country', value: '$cf.country' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Colo')).toBe('DFW')
    expect(result.headers.get('X-Country')).toBe('US')
  })

  it('resolves $jwt.* variables after auth policy', () => {
    const contextWithJwt: ProxyContext = {
      ...baseContext,
      jwt: { sub: 'user_123', email: 'test@example.com' },
    }
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-User-Id', value: '$jwt.sub' },
      { op: 'setHeader', name: 'X-User-Email', value: '$jwt.email' },
    ]

    const result = applyRequestTransforms(request, transforms, contextWithJwt)

    expect(result.headers.get('X-User-Id')).toBe('user_123')
    expect(result.headers.get('X-User-Email')).toBe('test@example.com')
  })

  it('resolves $header.* from request headers', () => {
    const request = new Request('https://example.com/api/test', {
      headers: { 'X-Original': 'original-value' },
    })
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Copied', value: '$header.X-Original' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Copied')).toBe('original-value')
  })

  it('resolves $query.* from URL search params', () => {
    const request = new Request('https://example.com/api/test?limit=10&offset=20')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Limit', value: '$query.limit' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Limit')).toBe('10')
  })

  it('resolves $config.* from config.variables', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Domain', value: '$config.domain' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Domain')).toBe('example.com')
  })

  it('resolves $method variable', () => {
    const request = new Request('https://example.com/api/test', { method: 'POST' })
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Method', value: '$method' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Method')).toBe('POST')
  })

  it('resolves $path variable', () => {
    const request = new Request('https://example.com/api/users/123')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Path', value: '$path' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Path')).toBe('/api/users/123')
  })

  it('preserves non-variable values as-is', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Static', value: 'static-value' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Static')).toBe('static-value')
  })

  it('handles missing variable values gracefully', () => {
    const request = new Request('https://example.com/api/test')
    const transforms: RequestTransform[] = [
      { op: 'setHeader', name: 'X-Missing', value: '$jwt.missing' },
    ]

    const result = applyRequestTransforms(request, transforms, baseContext)

    expect(result.headers.get('X-Missing')).toBe('')
  })
})

describe('Response Transforms', () => {
  const baseContext: ProxyContext = {
    requestId: 'test-uuid-123',
    timestamp: 1704825600000,
    ip: '1.2.3.4',
    cf: {},
    jwt: null,
    config: {},
  }

  it('setHeader adds header to response', () => {
    const response = new Response('OK', { status: 200 })
    const transforms: ResponseTransform[] = [
      { op: 'setHeader', name: 'X-Proxied', value: 'true' },
    ]

    const result = applyResponseTransforms(response, transforms, baseContext)

    expect(result.headers.get('X-Proxied')).toBe('true')
  })

  it('removeHeader removes response header', () => {
    const response = new Response('OK', {
      status: 200,
      headers: { 'X-Remove-Me': 'value' },
    })
    const transforms: ResponseTransform[] = [{ op: 'removeHeader', name: 'X-Remove-Me' }]

    const result = applyResponseTransforms(response, transforms, baseContext)

    expect(result.headers.has('X-Remove-Me')).toBe(false)
  })

  it('setStatus overrides response status', () => {
    const response = new Response('OK', { status: 200 })
    const transforms: ResponseTransform[] = [{ op: 'setStatus', value: '201' }]

    const result = applyResponseTransforms(response, transforms, baseContext)

    expect(result.status).toBe(201)
  })

  it('resolves variables in response header values', () => {
    const response = new Response('OK', { status: 200 })
    const transforms: ResponseTransform[] = [
      { op: 'setHeader', name: 'X-Request-Id', value: '$requestId' },
    ]

    const result = applyResponseTransforms(response, transforms, baseContext)

    expect(result.headers.get('X-Request-Id')).toBe('test-uuid-123')
  })

  it('preserves response body', async () => {
    const response = new Response('test body', { status: 200 })
    const transforms: ResponseTransform[] = [
      { op: 'setHeader', name: 'X-Test', value: 'test' },
    ]

    const result = applyResponseTransforms(response, transforms, baseContext)
    const body = await result.text()

    expect(body).toBe('test body')
  })
})

describe('Variable Resolution', () => {
  const baseContext: ProxyContext = {
    requestId: 'uuid-abc',
    timestamp: 1704825600000,
    ip: '1.2.3.4',
    cf: { colo: 'DFW', country: 'US' },
    jwt: { sub: 'user_1', nested: { value: 'deep' } },
    config: { apiKey: 'secret' },
  }

  it('returns non-variable strings unchanged', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('static', baseContext, request)).toBe('static')
  })

  it('resolves $requestId', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$requestId', baseContext, request)).toBe('uuid-abc')
  })

  it('resolves $timestamp', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$timestamp', baseContext, request)).toBe('1704825600000')
  })

  it('resolves $method', () => {
    const request = new Request('https://example.com/test', { method: 'DELETE' })
    expect(resolveVar('$method', baseContext, request)).toBe('DELETE')
  })

  it('resolves $path', () => {
    const request = new Request('https://example.com/api/users')
    expect(resolveVar('$path', baseContext, request)).toBe('/api/users')
  })

  it('resolves $query.param', () => {
    const request = new Request('https://example.com/test?foo=bar')
    expect(resolveVar('$query.foo', baseContext, request)).toBe('bar')
  })

  it('resolves $header.name (case-insensitive)', () => {
    const request = new Request('https://example.com/test', {
      headers: { 'X-Custom': 'value' },
    })
    expect(resolveVar('$header.X-Custom', baseContext, request)).toBe('value')
  })

  it('resolves $cf.colo', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$cf.colo', baseContext, request)).toBe('DFW')
  })

  it('resolves $jwt.sub', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$jwt.sub', baseContext, request)).toBe('user_1')
  })

  it('resolves $config.key', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$config.apiKey', baseContext, request)).toBe('secret')
  })

  it('returns empty string for missing values', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$jwt.missing', baseContext, request)).toBe('')
    expect(resolveVar('$query.missing', baseContext, request)).toBe('')
    expect(resolveVar('$config.missing', baseContext, request)).toBe('')
  })

  it('handles unknown variable prefix', () => {
    const request = new Request('https://example.com/test')
    expect(resolveVar('$unknown.value', baseContext, request)).toBe('$unknown.value')
  })
})
