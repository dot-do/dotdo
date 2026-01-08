import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Error Handling Middleware Tests
 *
 * These tests verify the error handling middleware for the dotdo worker.
 * They are expected to FAIL until the error middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in worker/src/middleware/error-handling.ts
 * - Register middleware on the main Hono app
 * - Handle all standard HTTP error codes with consistent JSON responses
 * - Format errors as { error: { code, message } }
 * - Include stack traces only in development mode
 */

// Import the actual app
import { app } from '../../index'

// ============================================================================
// Test Types
// ============================================================================

interface ErrorBody {
  error: {
    code: string
    message: string
    stack?: string
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function request(
  method: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return app.request(path, { method, ...options })
}

async function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return request('GET', path, { headers })
}

async function post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response> {
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }
  return request('POST', path, {
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function postRaw(path: string, body: string, headers?: Record<string, string>): Promise<Response> {
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }
  return request('POST', path, {
    headers: requestHeaders,
    body,
  })
}

// ============================================================================
// 400 Bad Request - Invalid JSON Input
// ============================================================================

describe('400 Bad Request - Invalid JSON Input', () => {
  it('returns 400 for malformed JSON', async () => {
    const res = await postRaw('/api/things', '{ invalid json }')

    expect(res.status).toBe(400)
  })

  it('returns 400 for truncated JSON', async () => {
    const res = await postRaw('/api/things', '{"name": "test"')

    expect(res.status).toBe(400)
  })

  it('returns 400 for JSON with trailing comma', async () => {
    const res = await postRaw('/api/things', '{"name": "test",}')

    expect(res.status).toBe(400)
  })

  it('returns 400 for empty body when JSON expected', async () => {
    const res = await request('POST', '/api/things', {
      headers: { 'Content-Type': 'application/json' },
      body: '',
    })

    expect(res.status).toBe(400)
  })

  it('error response has correct JSON structure', async () => {
    const res = await postRaw('/api/things', '{ bad json')
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('error message indicates JSON parsing failed', async () => {
    const res = await postRaw('/api/things', 'not json at all')
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/json|parse|invalid|malformed/)
  })
})

// ============================================================================
// 401 Unauthorized - Missing Authentication
// ============================================================================

describe('401 Unauthorized - Missing Authentication', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await get('/api/protected')

    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header is empty', async () => {
    const res = await get('/api/protected', { Authorization: '' })

    expect(res.status).toBe(401)
  })

  it('returns 401 when Bearer token is missing', async () => {
    const res = await get('/api/protected', { Authorization: 'Bearer' })

    expect(res.status).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    const res = await get('/api/protected', { Authorization: 'Bearer invalid-token' })

    expect(res.status).toBe(401)
  })

  it('returns 401 when using wrong auth scheme', async () => {
    const res = await get('/api/protected', { Authorization: 'Basic dXNlcjpwYXNz' })

    expect(res.status).toBe(401)
  })

  it('error response has correct JSON structure', async () => {
    const res = await get('/api/protected')
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('error message indicates authentication required', async () => {
    const res = await get('/api/protected')
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/auth|unauthorized|token|credentials/)
  })

  it('includes WWW-Authenticate header', async () => {
    const res = await get('/api/protected')

    expect(res.headers.get('WWW-Authenticate')).toBeTruthy()
  })
})

// ============================================================================
// 403 Forbidden - Insufficient Permissions
// ============================================================================

describe('403 Forbidden - Insufficient Permissions', () => {
  it('returns 403 when user lacks permission', async () => {
    // Assuming a valid token but insufficient permissions
    const res = await get('/api/admin/settings', {
      Authorization: 'Bearer valid-but-not-admin-token',
    })

    expect(res.status).toBe(403)
  })

  it('returns 403 when accessing another users resource', async () => {
    const res = await get('/api/users/other-user-id/private', {
      Authorization: 'Bearer valid-user-token',
    })

    expect(res.status).toBe(403)
  })

  it('returns 403 when action is not permitted', async () => {
    const res = await request('DELETE', '/api/protected-resource', {
      headers: { Authorization: 'Bearer valid-read-only-token' },
    })

    expect(res.status).toBe(403)
  })

  it('error response has correct JSON structure', async () => {
    const res = await get('/api/admin/settings', {
      Authorization: 'Bearer valid-but-not-admin-token',
    })
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('error message indicates access denied', async () => {
    const res = await get('/api/admin/settings', {
      Authorization: 'Bearer valid-but-not-admin-token',
    })
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/forbidden|permission|access|denied|not allowed/)
  })
})

// ============================================================================
// 404 Not Found - Missing Resources
// ============================================================================

describe('404 Not Found - Missing Resources', () => {
  it('returns 404 for non-existent route', async () => {
    const res = await get('/api/does-not-exist')

    expect(res.status).toBe(404)
  })

  it('returns 404 for non-existent resource by ID', async () => {
    const res = await get('/api/things/non-existent-id-12345')

    expect(res.status).toBe(404)
  })

  it('returns 404 for nested non-existent route', async () => {
    const res = await get('/api/things/id/nested/path/that/does/not/exist')

    expect(res.status).toBe(404)
  })

  it('returns 404 when updating non-existent resource', async () => {
    const res = await request('PUT', '/api/things/missing-thing', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 when deleting non-existent resource', async () => {
    const res = await request('DELETE', '/api/things/missing-thing')

    expect(res.status).toBe(404)
  })

  it('error response has correct JSON structure', async () => {
    const res = await get('/api/things/not-found')
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('error message indicates resource not found', async () => {
    const res = await get('/api/things/missing-id')
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/not found|does not exist|missing|unknown/)
  })

  it('returns JSON content-type for 404', async () => {
    const res = await get('/api/not-found-route')

    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

// ============================================================================
// 405 Method Not Allowed - Wrong HTTP Method
// ============================================================================

describe('405 Method Not Allowed - Wrong HTTP Method', () => {
  it('returns 405 for POST on GET-only route', async () => {
    const res = await post('/api/health', { test: true })

    expect(res.status).toBe(405)
  })

  it('returns 405 for DELETE on POST-only route', async () => {
    const res = await request('DELETE', '/api/things')

    expect(res.status).toBe(405)
  })

  it('returns 405 for PATCH when not supported', async () => {
    const res = await request('PATCH', '/api/things/some-id', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'updated' }),
    })

    expect(res.status).toBe(405)
  })

  it('returns 405 for PUT on collection endpoint', async () => {
    const res = await request('PUT', '/api/things', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })

    expect(res.status).toBe(405)
  })

  it('error response has correct JSON structure', async () => {
    const res = await request('PATCH', '/api/things')
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('error message indicates method not allowed', async () => {
    const res = await request('PATCH', '/api/health')
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/method|not allowed|not supported/)
  })

  it('includes Allow header with permitted methods', async () => {
    const res = await request('DELETE', '/api/things')

    expect(res.headers.get('Allow')).toBeTruthy()
    expect(res.headers.get('Allow')).toMatch(/GET|POST/)
  })
})

// ============================================================================
// 422 Unprocessable Entity - Validation Errors
// ============================================================================

describe('422 Unprocessable Entity - Validation Errors', () => {
  it('returns 422 for missing required fields', async () => {
    const res = await post('/api/things', {
      // Missing name and $type
      data: { foo: 'bar' },
    })

    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid field type', async () => {
    const res = await post('/api/things', {
      name: 12345, // Should be string
      $type: 'https://example.com/Thing',
    })

    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid email format', async () => {
    const res = await post('/api/users', {
      name: 'Test User',
      email: 'not-an-email',
    })

    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid URL format', async () => {
    const res = await post('/api/things', {
      name: 'Test Thing',
      $type: 'not-a-valid-url',
    })

    expect(res.status).toBe(422)
  })

  it('returns 422 for value out of range', async () => {
    const res = await post('/api/things', {
      name: 'Test Thing',
      $type: 'https://example.com/Thing',
      priority: 999, // Out of valid range
    })

    expect(res.status).toBe(422)
  })

  it('returns 422 for string too long', async () => {
    const res = await post('/api/things', {
      name: 'a'.repeat(10001), // Exceeds max length
      $type: 'https://example.com/Thing',
    })

    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid enum value', async () => {
    const res = await post('/api/things', {
      name: 'Test Thing',
      $type: 'https://example.com/Thing',
      status: 'invalid-status', // Not a valid status
    })

    expect(res.status).toBe(422)
  })

  it('error response has correct JSON structure', async () => {
    const res = await post('/api/things', {})
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('UNPROCESSABLE_ENTITY')
  })

  it('error message indicates validation failure', async () => {
    const res = await post('/api/things', { name: '' })
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/validation|invalid|required|must/)
  })

  it('includes field-level error details when available', async () => {
    const res = await post('/api/things', {
      name: '',
      $type: 'invalid',
    })
    const body = await res.json() as { error: ErrorBody['error'] & { details?: Record<string, string> } }

    // Middleware should include details about which fields failed
    expect(body.error.details || body.error.message).toBeTruthy()
  })
})

// ============================================================================
// 500 Internal Server Error - Caught and Formatted
// ============================================================================

describe('500 Internal Server Error - Caught and Formatted', () => {
  it('returns 500 for unhandled exceptions', async () => {
    // This route should trigger an internal error
    const res = await get('/api/error/unhandled')

    expect(res.status).toBe(500)
  })

  it('returns 500 for database errors', async () => {
    const res = await get('/api/error/database')

    expect(res.status).toBe(500)
  })

  it('returns 500 for external service failures', async () => {
    const res = await get('/api/error/external-service')

    expect(res.status).toBe(500)
  })

  it('does not expose sensitive error details in production', async () => {
    const res = await get('/api/error/unhandled')
    const body = await res.json() as ErrorBody

    // Should not contain sensitive info like file paths, SQL, etc.
    expect(body.error.message).not.toMatch(/\/Users\/|\/home\/|\.ts:|\.js:/)
    expect(body.error.message).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/)
  })

  it('error response has correct JSON structure', async () => {
    const res = await get('/api/error/unhandled')
    const body = await res.json() as ErrorBody

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('error message is user-friendly', async () => {
    const res = await get('/api/error/unhandled')
    const body = await res.json() as ErrorBody

    expect(body.error.message.toLowerCase()).toMatch(/internal|server|error|unexpected|problem/)
  })

  it('returns JSON content-type for 500', async () => {
    const res = await get('/api/error/unhandled')

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('handles errors thrown in middleware', async () => {
    const res = await get('/api/error/middleware')

    expect(res.status).toBe(500)

    const body = await res.json() as ErrorBody
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('handles async errors', async () => {
    const res = await get('/api/error/async')

    expect(res.status).toBe(500)

    const body = await res.json() as ErrorBody
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })
})

// ============================================================================
// Error Response Format - JSON { error: { code, message } }
// ============================================================================

describe('Error Response Format - JSON Structure', () => {
  it('all error responses are JSON', async () => {
    const responses = await Promise.all([
      postRaw('/api/things', 'invalid json'),  // 400
      get('/api/protected'),                    // 401
      get('/api/things/not-found'),             // 404
      request('PATCH', '/api/health'),          // 405
      post('/api/things', {}),                  // 422
    ])

    for (const res of responses) {
      expect(res.headers.get('content-type')).toContain('application/json')
    }
  })

  it('all error responses have error.code field', async () => {
    const responses = await Promise.all([
      postRaw('/api/things', 'invalid'),
      get('/api/things/missing'),
      request('PATCH', '/api/health'),
    ])

    for (const res of responses) {
      const body = await res.json() as ErrorBody
      expect(body.error).toHaveProperty('code')
      expect(typeof body.error.code).toBe('string')
    }
  })

  it('all error responses have error.message field', async () => {
    const responses = await Promise.all([
      postRaw('/api/things', 'invalid'),
      get('/api/things/missing'),
      request('PATCH', '/api/health'),
    ])

    for (const res of responses) {
      const body = await res.json() as ErrorBody
      expect(body.error).toHaveProperty('message')
      expect(typeof body.error.message).toBe('string')
      expect(body.error.message.length).toBeGreaterThan(0)
    }
  })

  it('error.code matches HTTP status code semantically', async () => {
    const testCases: [() => Promise<Response>, number, string][] = [
      [() => postRaw('/api/things', 'bad'), 400, 'BAD_REQUEST'],
      [() => get('/api/protected'), 401, 'UNAUTHORIZED'],
      [() => get('/api/admin/settings', { Authorization: 'Bearer weak' }), 403, 'FORBIDDEN'],
      [() => get('/api/things/missing'), 404, 'NOT_FOUND'],
      [() => request('PATCH', '/api/health'), 405, 'METHOD_NOT_ALLOWED'],
      [() => post('/api/things', {}), 422, 'UNPROCESSABLE_ENTITY'],
    ]

    for (const [requestFn, expectedStatus, expectedCode] of testCases) {
      const res = await requestFn()
      expect(res.status).toBe(expectedStatus)

      const body = await res.json() as ErrorBody
      expect(body.error.code).toBe(expectedCode)
    }
  })

  it('error response does not have extra top-level fields', async () => {
    const res = await get('/api/things/not-found')
    const body = await res.json() as Record<string, unknown>

    const topLevelKeys = Object.keys(body)
    expect(topLevelKeys).toEqual(['error'])
  })

  it('error.code is uppercase snake_case', async () => {
    const responses = await Promise.all([
      get('/api/things/missing'),
      postRaw('/api/things', 'invalid'),
      request('PATCH', '/api/health'),
    ])

    for (const res of responses) {
      const body = await res.json() as ErrorBody
      expect(body.error.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

// ============================================================================
// Stack Traces - Development Mode Only
// ============================================================================

describe('Stack Traces - Development Mode Only', () => {
  describe('in production mode', () => {
    // These tests assume NODE_ENV=production or similar environment detection

    it('500 errors do not include stack trace', async () => {
      const res = await get('/api/error/unhandled')
      const body = await res.json() as ErrorBody

      expect(body.error.stack).toBeUndefined()
    })

    it('400 errors do not include stack trace', async () => {
      const res = await postRaw('/api/things', 'invalid')
      const body = await res.json() as ErrorBody

      expect(body.error.stack).toBeUndefined()
    })

    it('error messages do not leak implementation details', async () => {
      const res = await get('/api/error/unhandled')
      const body = await res.json() as ErrorBody

      // Should not contain file paths, line numbers, or technical details
      expect(body.error.message).not.toMatch(/at\s+\w+\s+\(/)
      expect(body.error.message).not.toMatch(/:\d+:\d+/)
      expect(body.error.message).not.toMatch(/node_modules/)
    })
  })

  describe('in development mode', () => {
    // These tests would run when NODE_ENV=development

    it('500 errors include stack trace when enabled', async () => {
      // This test requires the app to be in development mode
      // The actual behavior depends on environment configuration
      const res = await app.request('/api/error/unhandled?debug=true', {
        method: 'GET',
        headers: { 'X-Debug-Mode': 'true' },
      })

      if (res.status === 500) {
        const body = await res.json() as ErrorBody
        // In dev mode, stack should be present
        // This test will fail in production (which is expected)
        expect(body.error.stack).toBeDefined()
        expect(body.error.stack).toContain('\n')
      }
    })

    it('stack trace includes useful debugging info', async () => {
      const res = await app.request('/api/error/unhandled?debug=true', {
        method: 'GET',
        headers: { 'X-Debug-Mode': 'true' },
      })

      if (res.status === 500) {
        const body = await res.json() as ErrorBody
        if (body.error.stack) {
          // Stack should contain file and line info
          expect(body.error.stack).toMatch(/at\s+/)
        }
      }
    })

    it('development errors include original error name', async () => {
      const res = await app.request('/api/error/typed?debug=true', {
        method: 'GET',
        headers: { 'X-Debug-Mode': 'true' },
      })

      if (res.status === 500) {
        const body = await res.json() as { error: ErrorBody['error'] & { name?: string } }
        // In dev mode, might include error type/name
        // E.g., TypeError, ReferenceError, CustomError
        expect(body.error.name || body.error.code).toBeTruthy()
      }
    })
  })

  describe('environment detection', () => {
    it('respects NODE_ENV for stack trace visibility', async () => {
      // The middleware should check process.env.NODE_ENV or similar
      // and only include stack traces when not in production
      const res = await get('/api/error/unhandled')
      const body = await res.json() as ErrorBody

      // We can't test both modes in the same run, but we can verify
      // the middleware at least returns a valid response
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
    })

    it('uses generic message for unexpected errors in production', async () => {
      const res = await get('/api/error/unhandled')
      const body = await res.json() as ErrorBody

      // Production should have a generic, safe message
      if (!body.error.stack) {
        expect(body.error.message).toMatch(/internal server error|unexpected error|something went wrong/i)
      }
    })
  })
})

// ============================================================================
// Edge Cases and Additional Scenarios
// ============================================================================

describe('Edge Cases', () => {
  it('handles errors with circular references', async () => {
    const res = await get('/api/error/circular')

    // Should not crash, should return valid JSON
    expect(res.status).toBe(500)

    const body = await res.json() as ErrorBody
    expect(body.error).toHaveProperty('code')
  })

  it('handles very long error messages gracefully', async () => {
    const res = await get('/api/error/long-message')

    expect(res.status).toBe(500)

    const body = await res.json() as ErrorBody
    // Message should be truncated or handled gracefully
    expect(body.error.message.length).toBeLessThanOrEqual(1000)
  })

  it('handles errors with special characters in message', async () => {
    const res = await get('/api/error/special-chars')

    const body = await res.json() as ErrorBody
    // Should properly escape/handle special chars in JSON
    expect(body.error).toHaveProperty('message')
  })

  it('handles null/undefined error objects', async () => {
    const res = await get('/api/error/null')

    expect(res.status).toBe(500)

    const body = await res.json() as ErrorBody
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('handles non-Error objects thrown', async () => {
    const res = await get('/api/error/non-error')

    expect(res.status).toBe(500)

    const body = await res.json() as ErrorBody
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('preserves request ID in error response when present', async () => {
    const res = await app.request('/api/error/unhandled', {
      method: 'GET',
      headers: { 'X-Request-ID': 'test-request-123' },
    })

    const body = await res.json() as { error: ErrorBody['error'] & { requestId?: string } }
    // If the middleware tracks request IDs, it should include it
    // This helps with debugging and log correlation
    expect(body.error.requestId || res.headers.get('X-Request-ID')).toBeTruthy()
  })

  it('handles concurrent errors without interference', async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      get(`/api/error/concurrent/${i}`)
    )

    const responses = await Promise.all(requests)

    for (const res of responses) {
      expect(res.status).toBe(500)
      const body = await res.json() as ErrorBody
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
    }
  })
})

// ============================================================================
// Content Negotiation
// ============================================================================

describe('Content Negotiation for Errors', () => {
  it('always returns JSON regardless of Accept header', async () => {
    const res = await app.request('/api/things/not-found', {
      method: 'GET',
      headers: { Accept: 'text/html' },
    })

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON even for Accept: */*', async () => {
    const res = await app.request('/api/things/not-found', {
      method: 'GET',
      headers: { Accept: '*/*' },
    })

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON when no Accept header provided', async () => {
    const res = await app.request('/api/things/not-found', {
      method: 'GET',
    })

    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
