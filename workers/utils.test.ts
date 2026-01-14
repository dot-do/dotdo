/**
 * Worker Utilities Unit Tests
 *
 * Tests for shared utility functions:
 * - DO binding discovery and stub creation
 * - Hostname utilities
 * - Request forwarding helpers
 * - Response factories
 * - Path utilities
 * - URL building utilities
 * - ENV parsing utilities
 *
 * @module workers/utils.test
 */

import { describe, it, expect, vi } from 'vitest'
import {
  findDOBinding,
  getDOStub,
  getDOStubFromEnv,
  hasSubdomain,
  extractSubdomain,
  createForwardRequest,
  buildForwardUrl,
  errorResponse,
  notFoundResponse,
  serviceUnavailableResponse,
  internalServerErrorResponse,
  jsonResponse,
  getPathSegments,
  stripPathSegments,
  normalizePath,
  stripBasepath,
  buildNamespaceUrl,
  buildContextUrl,
  parseEnvArray,
} from './utils'
import type { CloudflareEnv } from '../types/CloudflareBindings'

// =============================================================================
// findDOBinding Tests
// =============================================================================

describe('findDOBinding', () => {
  it('finds DO binding in env', () => {
    const mockDO = {
      idFromName: vi.fn(),
      get: vi.fn(),
    }
    const env = { DO: mockDO, OTHER: 'value' }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBe(mockDO)
  })

  it('returns null when no DO binding found', () => {
    const env = { OTHER: 'value', ANOTHER: 123 }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('ignores non-DO objects', () => {
    const notDO = { someMethod: vi.fn() }
    const env = { NOT_DO: notDO }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('finds DO binding when multiple bindings exist', () => {
    const mockDO = {
      idFromName: vi.fn(),
      get: vi.fn(),
    }
    const env = {
      KV: { get: vi.fn() },
      DO: mockDO,
      R2: { put: vi.fn() },
    }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBe(mockDO)
  })

  it('ignores objects with only idFromName', () => {
    const partialDO = { idFromName: vi.fn() }
    const env = { PARTIAL_DO: partialDO }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('ignores objects with only get', () => {
    const partialDO = { get: vi.fn() }
    const env = { PARTIAL_DO: partialDO }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('ignores non-function idFromName', () => {
    const fakeDO = { idFromName: 'not a function', get: vi.fn() }
    const env = { FAKE_DO: fakeDO }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('ignores non-function get', () => {
    const fakeDO = { idFromName: vi.fn(), get: 'not a function' }
    const env = { FAKE_DO: fakeDO }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('handles empty env', () => {
    const result = findDOBinding({})
    expect(result).toBeNull()
  })

  it('ignores null values in env', () => {
    const env = { NULL_VALUE: null }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('ignores undefined values in env', () => {
    const env = { UNDEFINED_VALUE: undefined }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })
})

// =============================================================================
// getDOStub Tests
// =============================================================================

describe('getDOStub', () => {
  it('returns stub from namespace', () => {
    const mockStub = { fetch: vi.fn() }
    const mockId = { toString: () => 'test-id' }
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    }

    const result = getDOStub(mockNamespace as unknown as DurableObjectNamespace, 'test')
    expect(mockNamespace.idFromName).toHaveBeenCalledWith('test')
    expect(mockNamespace.get).toHaveBeenCalledWith(mockId)
    expect(result).toBe(mockStub)
  })

  it('handles namespace names with special characters', () => {
    const mockStub = { fetch: vi.fn() }
    const mockId = { toString: () => 'special-id' }
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    }

    getDOStub(mockNamespace as unknown as DurableObjectNamespace, 'test:with:colons')
    expect(mockNamespace.idFromName).toHaveBeenCalledWith('test:with:colons')
  })

  it('handles empty namespace name', () => {
    const mockStub = { fetch: vi.fn() }
    const mockId = { toString: () => 'empty-id' }
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    }

    getDOStub(mockNamespace as unknown as DurableObjectNamespace, '')
    expect(mockNamespace.idFromName).toHaveBeenCalledWith('')
  })
})

// =============================================================================
// getDOStubFromEnv Tests
// =============================================================================

describe('getDOStubFromEnv', () => {
  it('returns stub from env.DO', () => {
    const mockStub = { fetch: vi.fn() }
    const mockId = { toString: () => 'test-id' }
    const mockDO = {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    }
    const env = { DO: mockDO } as unknown as CloudflareEnv

    const result = getDOStubFromEnv(env, 'test-ns')
    expect(result).toBe(mockStub)
    expect(mockDO.idFromName).toHaveBeenCalledWith('test-ns')
  })

  it('returns null when DO binding is missing', () => {
    const env = {} as CloudflareEnv
    const result = getDOStubFromEnv(env, 'test')
    expect(result).toBeNull()
  })

  it('returns null when env is null', () => {
    const result = getDOStubFromEnv(null as unknown as CloudflareEnv, 'test')
    expect(result).toBeNull()
  })

  it('returns null when env is undefined', () => {
    const result = getDOStubFromEnv(undefined as unknown as CloudflareEnv, 'test')
    expect(result).toBeNull()
  })
})

// =============================================================================
// hasSubdomain Tests
// =============================================================================

describe('hasSubdomain', () => {
  it('returns true for 4-part hostname', () => {
    expect(hasSubdomain('tenant.api.dotdo.dev')).toBe(true)
  })

  it('returns true for 5-part hostname', () => {
    expect(hasSubdomain('deep.tenant.api.dotdo.dev')).toBe(true)
  })

  it('returns true for 6-part hostname', () => {
    expect(hasSubdomain('very.deep.tenant.api.dotdo.dev')).toBe(true)
  })

  it('returns false for 3-part hostname', () => {
    expect(hasSubdomain('api.dotdo.dev')).toBe(false)
  })

  it('returns false for 2-part hostname', () => {
    expect(hasSubdomain('dotdo.dev')).toBe(false)
  })

  it('returns false for localhost', () => {
    expect(hasSubdomain('localhost')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasSubdomain('')).toBe(false)
  })

  it('returns false for single dot', () => {
    expect(hasSubdomain('.')).toBe(false)
  })
})

// =============================================================================
// extractSubdomain Tests
// =============================================================================

describe('extractSubdomain', () => {
  it('extracts subdomain from matching host', () => {
    const result = extractSubdomain('tenant.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('tenant')
  })

  it('extracts subdomain with hyphens', () => {
    const result = extractSubdomain('my-tenant.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('my-tenant')
  })

  it('extracts subdomain with numbers', () => {
    const result = extractSubdomain('tenant123.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('tenant123')
  })

  it('extracts multi-level subdomain', () => {
    const result = extractSubdomain('foo.bar.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('foo.bar')
  })

  it('returns null for apex domain', () => {
    const result = extractSubdomain('api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBeNull()
  })

  it('returns null for non-matching domain', () => {
    const result = extractSubdomain('tenant.other.com', 'api.dotdo.dev')
    expect(result).toBeNull()
  })

  it('returns null for partial match', () => {
    const result = extractSubdomain('dotdo.dev', 'api.dotdo.dev')
    expect(result).toBeNull()
  })

  it('handles edge case of just the dot prefix', () => {
    // When hostname is just "." + rootDomain - should return null
    const result = extractSubdomain('.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBeNull()
  })
})

// =============================================================================
// createForwardRequest Tests
// =============================================================================

describe('createForwardRequest', () => {
  it('creates request with correct URL string', () => {
    const original = new Request('https://api.dotdo.dev/original', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const result = createForwardRequest(original, 'https://api.dotdo.dev/users')
    expect(result.url).toBe('https://api.dotdo.dev/users')
  })

  it('creates request from URL object', () => {
    const original = new Request('https://api.dotdo.dev/original')
    const forwardUrl = new URL('https://api.dotdo.dev/users')

    const result = createForwardRequest(original, forwardUrl)
    expect(result.url).toBe('https://api.dotdo.dev/users')
  })

  it('preserves HTTP method', () => {
    const original = new Request('https://api.dotdo.dev/', { method: 'DELETE' })
    const result = createForwardRequest(original, 'https://api.dotdo.dev/users/123')
    expect(result.method).toBe('DELETE')
  })

  it('preserves headers', () => {
    const original = new Request('https://api.dotdo.dev/', {
      headers: {
        'Authorization': 'Bearer token',
        'X-Custom': 'value',
      },
    })
    const result = createForwardRequest(original, 'https://api.dotdo.dev/path')
    expect(result.headers.get('Authorization')).toBe('Bearer token')
    expect(result.headers.get('X-Custom')).toBe('value')
  })

  it('handles various HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    for (const method of methods) {
      const original = new Request('https://api.dotdo.dev/', { method })
      const result = createForwardRequest(original, 'https://api.dotdo.dev/test')
      expect(result.method).toBe(method)
    }
  })
})

// =============================================================================
// buildForwardUrl Tests
// =============================================================================

describe('buildForwardUrl', () => {
  it('builds URL with new path', () => {
    const request = new Request('https://api.dotdo.dev/old/path')
    const result = buildForwardUrl(request, '/new/path')
    expect(result).toBe('https://api.dotdo.dev/new/path')
  })

  it('preserves query string', () => {
    const request = new Request('https://api.dotdo.dev/old?q=test&limit=10')
    const result = buildForwardUrl(request, '/new')
    expect(result).toBe('https://api.dotdo.dev/new?q=test&limit=10')
  })

  it('handles empty query string', () => {
    const request = new Request('https://api.dotdo.dev/old')
    const result = buildForwardUrl(request, '/new')
    expect(result).toBe('https://api.dotdo.dev/new')
  })

  it('handles complex query strings', () => {
    const request = new Request('https://api.dotdo.dev/old?foo=bar&baz=qux&arr[]=1&arr[]=2')
    const result = buildForwardUrl(request, '/new/path')
    expect(result).toBe('https://api.dotdo.dev/new/path?foo=bar&baz=qux&arr[]=1&arr[]=2')
  })

  it('preserves port in URL', () => {
    const request = new Request('https://api.dotdo.dev:8443/old')
    const result = buildForwardUrl(request, '/new')
    expect(result).toBe('https://api.dotdo.dev:8443/new')
  })
})

// =============================================================================
// Response Factory Tests
// =============================================================================

describe('errorResponse', () => {
  it('creates JSON error response with correct status', async () => {
    const response = errorResponse(400, 'Bad Request')
    expect(response.status).toBe(400)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Bad Request')
  })

  it('creates 500 error response', async () => {
    const response = errorResponse(500, 'Internal Server Error')
    expect(response.status).toBe(500)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Internal Server Error')
  })

  it('creates 403 forbidden response', async () => {
    const response = errorResponse(403, 'Forbidden')
    expect(response.status).toBe(403)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Forbidden')
  })
})

describe('notFoundResponse', () => {
  it('creates 404 response with default message', async () => {
    const response = notFoundResponse()
    expect(response.status).toBe(404)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Not Found')
  })

  it('creates 404 response with custom message', async () => {
    const response = notFoundResponse('Resource not found')
    expect(response.status).toBe(404)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Resource not found')
  })
})

describe('serviceUnavailableResponse', () => {
  it('creates 503 response with default message', async () => {
    const response = serviceUnavailableResponse()
    expect(response.status).toBe(503)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Service Unavailable')
  })

  it('creates 503 response with error message', async () => {
    const error = new Error('Connection timeout')
    const response = serviceUnavailableResponse(error)
    expect(response.status).toBe(503)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Connection timeout')
  })
})

describe('internalServerErrorResponse', () => {
  it('creates 500 response with default message', async () => {
    const response = internalServerErrorResponse()
    expect(response.status).toBe(500)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Internal Server Error')
  })

  it('creates 500 response with error message', async () => {
    const error = new Error('Database connection failed')
    const response = internalServerErrorResponse(error)
    expect(response.status).toBe(500)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Database connection failed')
  })
})

describe('jsonResponse', () => {
  it('creates JSON response with data', async () => {
    const data = { name: 'test', value: 42 }
    const response = jsonResponse(data)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json()
    expect(body).toEqual(data)
  })

  it('creates JSON response with custom status', async () => {
    const data = { created: true }
    const response = jsonResponse(data, 201)

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual(data)
  })

  it('handles array data', async () => {
    const data = [1, 2, 3]
    const response = jsonResponse(data)

    const body = await response.json()
    expect(body).toEqual(data)
  })

  it('handles null data', async () => {
    const response = jsonResponse(null)

    const body = await response.json()
    expect(body).toBeNull()
  })

  it('handles nested objects', async () => {
    const data = {
      user: {
        name: 'test',
        profile: {
          email: 'test@example.com',
        },
      },
    }
    const response = jsonResponse(data)

    const body = await response.json()
    expect(body).toEqual(data)
  })
})

// =============================================================================
// Path Utilities Tests
// =============================================================================

describe('getPathSegments', () => {
  it('extracts segments from simple path', () => {
    const result = getPathSegments('/users/123')
    expect(result).toEqual(['users', '123'])
  })

  it('handles root path', () => {
    const result = getPathSegments('/')
    expect(result).toEqual([])
  })

  it('handles path with trailing slash', () => {
    const result = getPathSegments('/users/')
    expect(result).toEqual(['users'])
  })

  it('handles deeply nested path', () => {
    const result = getPathSegments('/a/b/c/d/e')
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('handles single segment', () => {
    const result = getPathSegments('/users')
    expect(result).toEqual(['users'])
  })

  it('filters empty segments from double slashes', () => {
    const result = getPathSegments('/users//123')
    expect(result).toEqual(['users', '123'])
  })
})

describe('stripPathSegments', () => {
  it('strips first segment', () => {
    const result = stripPathSegments('/ns/users/123', 1)
    expect(result).toBe('/users/123')
  })

  it('strips multiple segments', () => {
    const result = stripPathSegments('/org/project/tasks', 2)
    expect(result).toBe('/tasks')
  })

  it('returns root when stripping all segments', () => {
    const result = stripPathSegments('/ns/users', 2)
    expect(result).toBe('/')
  })

  it('returns root when stripping more than available', () => {
    const result = stripPathSegments('/ns', 5)
    expect(result).toBe('/')
  })

  it('handles stripping zero segments', () => {
    const result = stripPathSegments('/users/123', 0)
    expect(result).toBe('/users/123')
  })
})

describe('normalizePath', () => {
  it('returns root for empty string', () => {
    expect(normalizePath('')).toBe('/')
  })

  it('returns root for null-like empty', () => {
    expect(normalizePath(undefined as unknown as string)).toBe('/')
  })

  it('adds leading slash if missing', () => {
    expect(normalizePath('users')).toBe('/users')
  })

  it('preserves existing leading slash', () => {
    expect(normalizePath('/users')).toBe('/users')
  })

  it('handles path with multiple segments', () => {
    expect(normalizePath('users/123/profile')).toBe('/users/123/profile')
  })
})

describe('stripBasepath', () => {
  it('strips matching basepath', () => {
    const result = stripBasepath('/api/v1/users', '/api/v1')
    expect(result).toBe('/users')
  })

  it('returns original if basepath does not match', () => {
    const result = stripBasepath('/users', '/api/v1')
    expect(result).toBe('/users')
  })

  it('returns original if basepath is undefined', () => {
    const result = stripBasepath('/api/v1/users')
    expect(result).toBe('/api/v1/users')
  })

  it('returns root if entire path is basepath', () => {
    const result = stripBasepath('/api/v1', '/api/v1')
    expect(result).toBe('/')
  })

  it('handles empty basepath', () => {
    const result = stripBasepath('/users', '')
    expect(result).toBe('/users')
  })
})

// =============================================================================
// URL Building Tests
// =============================================================================

describe('buildNamespaceUrl', () => {
  it('returns origin from URL', () => {
    const url = new URL('https://tenant.api.dotdo.dev/users')
    const result = buildNamespaceUrl(url)
    expect(result).toBe('https://tenant.api.dotdo.dev')
  })

  it('includes port in origin', () => {
    const url = new URL('https://tenant.api.dotdo.dev:8443/users')
    const result = buildNamespaceUrl(url)
    expect(result).toBe('https://tenant.api.dotdo.dev:8443')
  })

  it('handles http protocol', () => {
    const url = new URL('http://localhost:8787/users')
    const result = buildNamespaceUrl(url)
    expect(result).toBe('http://localhost:8787')
  })
})

describe('buildContextUrl', () => {
  it('builds context URL from URL object', () => {
    const url = new URL('https://api.dotdo.dev/path')
    const result = buildContextUrl(url, 'tenant')
    expect(result).toBe('https://api.dotdo.dev/tenant')
  })

  it('builds context URL from string', () => {
    const result = buildContextUrl('https://api.dotdo.dev/path', 'tenant')
    expect(result).toBe('https://api.dotdo.dev/tenant')
  })

  it('handles URL with port', () => {
    const url = new URL('https://api.dotdo.dev:8443/path')
    const result = buildContextUrl(url, 'tenant')
    expect(result).toBe('https://api.dotdo.dev:8443/tenant')
  })

  it('handles namespace with special characters', () => {
    const url = new URL('https://api.dotdo.dev/path')
    const result = buildContextUrl(url, 'org:project')
    expect(result).toBe('https://api.dotdo.dev/org:project')
  })
})

// =============================================================================
// ENV Parsing Tests
// =============================================================================

describe('parseEnvArray', () => {
  it('parses comma-separated values', () => {
    const result = parseEnvArray('a,b,c')
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace from values', () => {
    const result = parseEnvArray('a , b , c')
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('filters empty values', () => {
    const result = parseEnvArray('a,,b,')
    expect(result).toEqual(['a', 'b'])
  })

  it('returns undefined for empty string', () => {
    const result = parseEnvArray('')
    expect(result).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    const result = parseEnvArray(undefined)
    expect(result).toBeUndefined()
  })

  it('handles single value', () => {
    const result = parseEnvArray('single')
    expect(result).toEqual(['single'])
  })

  it('handles whitespace-only values', () => {
    const result = parseEnvArray('a,   ,b')
    expect(result).toEqual(['a', 'b'])
  })
})
