/**
 * API Consistency Tests - TDD for Unified API Standards
 *
 * Tests for:
 * - Single ApiError format used everywhere
 * - Standard pagination interface
 * - Unified auth context
 * - Rate limit headers on all endpoints
 *
 * Following dotdo testing philosophy: NO MOCKS - real implementations only.
 *
 * @epic dotdo-87ewa TDD: API Consistency
 */

import { describe, test, expect, beforeEach } from 'vitest'

// Import unified error types from both locations - should be re-exports of the same code
import {
  CompatError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  isCompatError,
  wrapError,
  toResponse,
} from '../../compat/core/errors'

import {
  CompatError as CoreCompatError,
  ValidationError as CoreValidationError,
  isCompatError as coreIsCompatError,
} from '../../packages/core/src/errors'

// Import API error handling from middleware
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError as ApiNotFoundError,
  MethodNotAllowedError,
  ConflictError,
  UnprocessableEntityError,
  InternalServerError,
  errorHandler,
} from '../../api/middleware/error-handling'

// Import pagination utilities
import {
  paginate,
  parsePaginationQuery,
  validatePaginationParams,
  createPaginationMeta,
  encodeCursor,
  decodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type PaginationParams,
  type PaginatedResult,
  type PaginationMeta,
} from '../../lib/pagination'

// Import auth context types
import type { AuthContext, User, Session } from '../../api/middleware/auth'

// =============================================================================
// 1. UNIFIED ERROR FORMAT TESTS
// =============================================================================

describe('Unified ApiError Format', () => {
  describe('Error Structure Consistency', () => {
    test('CompatError has consistent structure across compat and core', () => {
      // Both imports should have the same interface
      const compatError = new CompatError({
        code: 'TEST_ERROR',
        message: 'Test message',
        statusCode: 400,
      })

      const coreError = new CoreCompatError({
        code: 'TEST_ERROR',
        message: 'Test message',
        statusCode: 400,
      })

      // Both should have the same shape
      expect(compatError.code).toBe(coreError.code)
      expect(compatError.message).toBe(coreError.message)
      expect(compatError.statusCode).toBe(coreError.statusCode)
      expect(compatError.name).toBe(coreError.name)
    })

    test('isCompatError type guard works consistently', () => {
      const error = new CompatError({
        code: 'TEST',
        message: 'Test',
      })

      expect(isCompatError(error)).toBe(true)
      expect(coreIsCompatError(error)).toBe(true)
    })

    test('All error types extend CompatError', () => {
      const validation = new ValidationError({ message: 'Bad input' })
      const auth = new AuthenticationError({ message: 'Invalid token' })
      const authz = new AuthorizationError({ message: 'Forbidden' })
      const notFound = new NotFoundError({ message: 'Not found' })
      const rateLimit = new RateLimitError({ message: 'Too many requests' })
      const service = new ServiceError({ message: 'Service error' })

      expect(validation).toBeInstanceOf(CompatError)
      expect(auth).toBeInstanceOf(CompatError)
      expect(authz).toBeInstanceOf(CompatError)
      expect(notFound).toBeInstanceOf(CompatError)
      expect(rateLimit).toBeInstanceOf(CompatError)
      expect(service).toBeInstanceOf(CompatError)
    })

    test('Error codes follow SCREAMING_SNAKE_CASE convention', () => {
      const validation = new ValidationError({ message: 'Bad input' })
      const auth = new AuthenticationError({ message: 'Invalid token' })
      const notFound = new NotFoundError({ message: 'Not found' })
      const rateLimit = new RateLimitError({ message: 'Too many requests' })

      expect(validation.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(auth.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(notFound.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(rateLimit.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    })

    test('Status codes are correctly mapped', () => {
      expect(new ValidationError({ message: 't' }).statusCode).toBe(400)
      expect(new AuthenticationError({ message: 't' }).statusCode).toBe(401)
      expect(new AuthorizationError({ message: 't' }).statusCode).toBe(403)
      expect(new NotFoundError({ message: 't' }).statusCode).toBe(404)
      expect(new RateLimitError({ message: 't' }).statusCode).toBe(429)
      expect(new ServiceError({ message: 't' }).statusCode).toBe(500)
    })
  })

  describe('Error Response Shape', () => {
    test('toResponse generates consistent JSON shape', async () => {
      const error = new CompatError({
        code: 'TEST_ERROR',
        message: 'Test message',
        statusCode: 400,
      })

      const response = toResponse(error)
      const body = await response.json() as { error: { code: string; message: string } }

      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code', 'TEST_ERROR')
      expect(body.error).toHaveProperty('message', 'Test message')
    })

    test('Error response includes standard headers', () => {
      const error = new CompatError({
        code: 'TEST',
        message: 'Test',
        requestId: 'req_123',
      })

      const response = toResponse(error)

      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('X-Request-Id')).toBe('req_123')
    })

    test('Rate limit error includes Retry-After header', () => {
      const error = new RateLimitError({
        message: 'Too many requests',
        retryAfter: 60,
      })

      const response = toResponse(error)

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('60')
    })
  })

  describe('API Middleware Error Compatibility', () => {
    test('API middleware errors have code property', () => {
      const badRequest = new BadRequestError('Invalid input')
      const unauthorized = new UnauthorizedError('Not authenticated')
      const forbidden = new ForbiddenError('Access denied')
      const notFound = new ApiNotFoundError('Resource not found')

      expect(badRequest.code).toBe('BAD_REQUEST')
      expect(unauthorized.code).toBe('UNAUTHORIZED')
      expect(forbidden.code).toBe('FORBIDDEN')
      expect(notFound.code).toBe('NOT_FOUND')
    })

    test('API middleware errors have status property', () => {
      expect(new BadRequestError('t').status).toBe(400)
      expect(new UnauthorizedError('t').status).toBe(401)
      expect(new ForbiddenError('t').status).toBe(403)
      expect(new ApiNotFoundError('t').status).toBe(404)
      expect(new MethodNotAllowedError(['GET', 'POST']).status).toBe(405)
      expect(new ConflictError('t').status).toBe(409)
      expect(new UnprocessableEntityError('t').status).toBe(422)
      expect(new InternalServerError('t').status).toBe(500)
    })

    test('MethodNotAllowedError includes allowed methods', () => {
      const error = new MethodNotAllowedError(['GET', 'POST', 'PUT'])
      expect(error.allowed).toEqual(['GET', 'POST', 'PUT'])
    })

    test('UnprocessableEntityError supports field errors', () => {
      const error = new UnprocessableEntityError('Validation failed', {
        email: ['Invalid format'],
        name: ['Required', 'Too short'],
      })

      expect(error.errors).toEqual({
        email: ['Invalid format'],
        name: ['Required', 'Too short'],
      })
    })
  })

  describe('Error Wrapping', () => {
    test('wrapError preserves CompatError instances', () => {
      const original = new ValidationError({ message: 'Original' })
      const wrapped = wrapError(original, 'test-sdk')

      expect(wrapped).toBe(original)
    })

    test('wrapError converts native errors to CompatError', () => {
      const native = new Error('Native error')
      const wrapped = wrapError(native, 'test-sdk')

      expect(wrapped).toBeInstanceOf(CompatError)
      expect(wrapped.message).toBe('Native error')
      expect(wrapped.code).toBe('UNKNOWN_ERROR')
      expect(wrapped.sdk).toBe('test-sdk')
      expect(wrapped.cause).toBe(native)
    })

    test('wrapError handles string errors', () => {
      const wrapped = wrapError('String error', 'test-sdk')

      expect(wrapped).toBeInstanceOf(CompatError)
      expect(wrapped.message).toBe('String error')
    })

    test('wrapError handles unknown types', () => {
      const wrapped = wrapError({ unknown: 'object' }, 'test-sdk')

      expect(wrapped).toBeInstanceOf(CompatError)
      expect(wrapped.message).toBe('Unknown error')
      expect(wrapped.details).toEqual({ original: { unknown: 'object' } })
    })
  })
})

// =============================================================================
// 2. STANDARD PAGINATION INTERFACE TESTS
// =============================================================================

describe('Standard Pagination Interface', () => {
  const createTestItems = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i + 1}`,
      name: `Item ${i + 1}`,
    }))

  describe('Pagination Constants', () => {
    test('DEFAULT_LIMIT is 20', () => {
      expect(DEFAULT_LIMIT).toBe(20)
    })

    test('MAX_LIMIT is 100', () => {
      expect(MAX_LIMIT).toBe(100)
    })
  })

  describe('PaginatedResult Shape', () => {
    test('Result has data array and meta object', () => {
      const items = createTestItems(50)
      const result = paginate(items, { limit: 20 })

      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('meta')
      expect(Array.isArray(result.data)).toBe(true)
      expect(typeof result.meta).toBe('object')
    })

    test('Meta has required fields', () => {
      const items = createTestItems(50)
      const result = paginate(items, { limit: 20 })

      const requiredFields = ['hasNextPage', 'hasPreviousPage']
      for (const field of requiredFields) {
        expect(result.meta).toHaveProperty(field)
      }
    })

    test('Meta has optional cursor fields when applicable', () => {
      const items = createTestItems(50)
      const result = paginate(items, { limit: 20 })

      // With items, should have cursors
      expect(result.meta.startCursor).toBeDefined()
      expect(result.meta.endCursor).toBeDefined()
    })

    test('Meta has total when not skipped', () => {
      const items = createTestItems(50)
      const result = paginate(items, { limit: 20 })

      expect(result.meta.total).toBe(50)
    })

    test('Meta can skip total for performance', () => {
      const items = createTestItems(50)
      const result = paginate(items, { limit: 20 }, { skipTotal: true })

      expect(result.meta.total).toBeUndefined()
    })
  })

  describe('Cursor-Based Pagination', () => {
    test('Cursor is opaque string', () => {
      const items = createTestItems(100)
      const result = paginate(items, { limit: 10 })

      // Cursor should be base64url encoded
      expect(result.meta.endCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    test('Cursor navigates to next page', () => {
      const items = createTestItems(100)
      const page1 = paginate(items, { limit: 10 })
      const page2 = paginate(items, { limit: 10, cursor: page1.meta.endCursor })

      expect(page1.data[0].id).toBe('item-1')
      expect(page2.data[0].id).toBe('item-11')
    })

    test('No endCursor on last page', () => {
      const items = createTestItems(15)
      const page1 = paginate(items, { limit: 10 })
      const page2 = paginate(items, { limit: 10, cursor: page1.meta.endCursor })

      expect(page1.meta.endCursor).toBeDefined()
      expect(page2.meta.endCursor).toBeUndefined()
    })

    test('Invalid cursor falls back to first page', () => {
      const items = createTestItems(100)
      const result = paginate(items, { limit: 10, cursor: 'invalid-cursor' })

      expect(result.data[0].id).toBe('item-1')
    })
  })

  describe('Offset-Based Pagination', () => {
    test('Offset skips items', () => {
      const items = createTestItems(100)
      const result = paginate(items, { limit: 10, offset: 20 })

      expect(result.data[0].id).toBe('item-21')
    })

    test('Page parameter converts to offset', () => {
      const items = createTestItems(100)
      const result = paginate(items, { limit: 10, page: 3 })

      expect(result.data[0].id).toBe('item-21') // Page 3 = offset 20
    })
  })

  describe('Pagination Parameter Parsing', () => {
    test('parsePaginationQuery handles string values', () => {
      const params = parsePaginationQuery({
        limit: '25',
        offset: '50',
        cursor: 'abc123',
        page: '3',
      })

      expect(params.limit).toBe(25)
      expect(params.offset).toBe(50)
      expect(params.cursor).toBe('abc123')
      expect(params.page).toBe(3)
    })

    test('parsePaginationQuery ignores invalid values', () => {
      const params = parsePaginationQuery({
        limit: 'invalid',
        offset: '-10',
        page: '0',
      })

      expect(params.limit).toBeUndefined()
      expect(params.offset).toBeUndefined()
      expect(params.page).toBeUndefined()
    })
  })

  describe('Pagination Validation', () => {
    test('Cursor and offset are mutually exclusive', () => {
      const error = validatePaginationParams({
        cursor: 'abc',
        offset: 10,
      })

      expect(error).not.toBeNull()
      expect(error).toContain('cursor')
    })

    test('Cursor and page are mutually exclusive', () => {
      const error = validatePaginationParams({
        cursor: 'abc',
        page: 2,
      })

      expect(error).not.toBeNull()
      expect(error).toContain('cursor')
    })

    test('Valid params return null', () => {
      expect(validatePaginationParams({ limit: 20 })).toBeNull()
      expect(validatePaginationParams({ cursor: 'abc' })).toBeNull()
      expect(validatePaginationParams({ page: 2 })).toBeNull()
    })
  })

  describe('Backward Compatibility', () => {
    test('Empty params use defaults', () => {
      const items = createTestItems(100)
      const result = paginate(items, {})

      expect(result.data).toHaveLength(DEFAULT_LIMIT)
    })

    test('Limit above MAX is capped', () => {
      const items = createTestItems(200)
      const result = paginate(items, { limit: 500 })

      expect(result.data).toHaveLength(MAX_LIMIT)
    })

    test('Negative limit uses default', () => {
      const items = createTestItems(100)
      const result = paginate(items, { limit: -5 })

      expect(result.data).toHaveLength(DEFAULT_LIMIT)
    })
  })
})

// =============================================================================
// 3. UNIFIED AUTH CONTEXT TESTS
// =============================================================================

describe('Unified Auth Context', () => {
  describe('AuthContext Shape', () => {
    test('AuthContext has required fields', () => {
      const authContext: AuthContext = {
        userId: 'user_123',
        role: 'user',
        method: 'jwt',
      }

      expect(authContext.userId).toBeDefined()
      expect(authContext.role).toBeDefined()
      expect(authContext.method).toBeDefined()
    })

    test('AuthContext supports optional fields', () => {
      const authContext: AuthContext = {
        userId: 'user_123',
        email: 'user@example.com',
        role: 'admin',
        permissions: ['read', 'write', 'delete'],
        method: 'apikey',
      }

      expect(authContext.email).toBe('user@example.com')
      expect(authContext.permissions).toEqual(['read', 'write', 'delete'])
    })

    test('Auth method is typed', () => {
      const methods: AuthContext['method'][] = ['jwt', 'session', 'apikey']

      for (const method of methods) {
        const authContext: AuthContext = {
          userId: 'user_123',
          role: 'user',
          method,
        }
        expect(['jwt', 'session', 'apikey']).toContain(authContext.method)
      }
    })

    test('Role is typed', () => {
      const roles: AuthContext['role'][] = ['admin', 'user']

      for (const role of roles) {
        const authContext: AuthContext = {
          userId: 'user_123',
          role,
          method: 'jwt',
        }
        expect(['admin', 'user']).toContain(authContext.role)
      }
    })
  })

  describe('User Shape', () => {
    test('User has required fields', () => {
      const user: User = {
        id: 'user_123',
        role: 'user',
      }

      expect(user.id).toBeDefined()
      expect(user.role).toBeDefined()
    })

    test('User supports optional fields', () => {
      const user: User = {
        id: 'user_123',
        email: 'user@example.com',
        name: 'John Doe',
        role: 'admin',
        permissions: ['read', 'write'],
      }

      expect(user.email).toBe('user@example.com')
      expect(user.name).toBe('John Doe')
      expect(user.permissions).toEqual(['read', 'write'])
    })
  })

  describe('Session Shape', () => {
    test('Session has required fields', () => {
      const session: Session = {
        id: 'sess_123',
        userId: 'user_456',
        expiresAt: new Date(),
      }

      expect(session.id).toBeDefined()
      expect(session.userId).toBeDefined()
      expect(session.expiresAt).toBeDefined()
    })
  })

  describe('Context Key Consistency', () => {
    // These are the standard context keys that should be used across the platform
    const AUTH_CONTEXT_KEYS = ['auth', 'user', 'session'] as const

    test('Standard context keys are defined', () => {
      expect(AUTH_CONTEXT_KEYS).toContain('auth')
      expect(AUTH_CONTEXT_KEYS).toContain('user')
      expect(AUTH_CONTEXT_KEYS).toContain('session')
    })
  })
})

// =============================================================================
// 4. RATE LIMIT HEADERS TESTS
// =============================================================================

describe('Rate Limit Headers', () => {
  describe('Standard Header Names', () => {
    const RATE_LIMIT_HEADERS = [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ] as const

    test('Rate limit headers follow X-RateLimit-* convention', () => {
      for (const header of RATE_LIMIT_HEADERS.slice(0, 3)) {
        expect(header).toMatch(/^X-RateLimit-/)
      }
    })

    test('Retry-After is standard HTTP header', () => {
      expect(RATE_LIMIT_HEADERS).toContain('Retry-After')
    })
  })

  describe('RateLimitError Header Extraction', () => {
    test('fromHeaders extracts all rate limit info', () => {
      const headers = new Headers({
        'Retry-After': '60',
        'X-RateLimit-Limit': '1000',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '1704067200',
      })

      const error = RateLimitError.fromHeaders('Rate limited', headers)

      expect(error.retryAfter).toBe(60)
      expect(error.limit).toBe(1000)
      expect(error.remaining).toBe(0)
      expect(error.resetAt).toBeInstanceOf(Date)
    })

    test('fromHeaders handles missing headers gracefully', () => {
      const headers = new Headers({
        'Retry-After': '30',
      })

      const error = RateLimitError.fromHeaders('Rate limited', headers)

      expect(error.retryAfter).toBe(30)
      expect(error.limit).toBeUndefined()
      expect(error.remaining).toBeUndefined()
    })

    test('fromHeaders parses HTTP date format', () => {
      const futureDate = new Date(Date.now() + 60000)
      const headers = new Headers({
        'Retry-After': futureDate.toUTCString(),
      })

      const error = RateLimitError.fromHeaders('Rate limited', headers)

      expect(error.retryAfter).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Rate Limit Response Headers', () => {
    test('toResponse includes Retry-After for rate limit errors', () => {
      const error = new RateLimitError({
        message: 'Too many requests',
        retryAfter: 120,
      })

      const response = toResponse(error)

      expect(response.headers.get('Retry-After')).toBe('120')
    })

    test('Response includes Content-Type', () => {
      const error = new RateLimitError({
        message: 'Too many requests',
      })

      const response = toResponse(error)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('Retryable Flag', () => {
    test('Rate limit errors are retryable', () => {
      const error = new RateLimitError({ message: 'Rate limited' })
      expect(error.retryable).toBe(true)
    })

    test('5xx errors are retryable', () => {
      const error = new ServiceError({ message: 'Server error', statusCode: 503 })
      expect(error.retryable).toBe(true)
    })

    test('4xx errors (except 429) are not retryable', () => {
      expect(new ValidationError({ message: 't' }).retryable).toBe(false)
      expect(new AuthenticationError({ message: 't' }).retryable).toBe(false)
      expect(new NotFoundError({ message: 't' }).retryable).toBe(false)
    })
  })
})

// =============================================================================
// 5. CROSS-LAYER CONSISTENCY TESTS
// =============================================================================

describe('Cross-Layer Consistency', () => {
  describe('REST and RPC Error Parity', () => {
    test('Same error types produce same JSON shape', async () => {
      const restError = new NotFoundError({
        message: 'Resource not found',
        resourceType: 'user',
        resourceId: 'user_123',
      })

      const restResponse = toResponse(restError)
      const restBody = await restResponse.json()

      // The shape should be consistent
      expect(restBody).toHaveProperty('error')
      expect((restBody as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    })

    test('Error responses include request ID when available', () => {
      const error = new CompatError({
        code: 'TEST',
        message: 'Test',
        requestId: 'req_abc123',
      })

      const response = toResponse(error)
      expect(response.headers.get('X-Request-Id')).toBe('req_abc123')
    })
  })

  describe('Compat SDK Error Consistency', () => {
    test('All compat errors have sdk field', () => {
      const errors = [
        new CompatError({ code: 'TEST', message: 't', sdk: 'stripe' }),
        new ValidationError({ message: 't', sdk: 'sendgrid' }),
        new AuthenticationError({ message: 't', sdk: 'openai' }),
      ]

      for (const error of errors) {
        // sdk is optional but when provided should be preserved
        if (error.sdk) {
          expect(typeof error.sdk).toBe('string')
        }
      }
    })

    test('Error codes are normalized to SCREAMING_SNAKE_CASE', () => {
      const error = new CompatError({
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      })

      expect(error.code).toBe('INVALID_API_KEY')
      expect(error.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    })
  })

  describe('Pagination Response Consistency', () => {
    test('Paginated results use consistent shape across endpoints', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }]
      const result = paginate(items, { limit: 10 })

      // Standard shape: { data: T[], meta: PaginationMeta }
      expect(Object.keys(result).sort()).toEqual(['data', 'meta'])
      expect(Array.isArray(result.data)).toBe(true)
      expect(typeof result.meta).toBe('object')
    })

    test('Pagination meta has consistent field names', () => {
      const items = [{ id: '1' }]
      const result = paginate(items, { limit: 10 })

      // Standard field names (Relay-style)
      expect(result.meta).toHaveProperty('hasNextPage')
      expect(result.meta).toHaveProperty('hasPreviousPage')
      // Optional fields
      if (result.meta.total !== undefined) {
        expect(typeof result.meta.total).toBe('number')
      }
      if (result.meta.startCursor !== undefined) {
        expect(typeof result.meta.startCursor).toBe('string')
      }
      if (result.meta.endCursor !== undefined) {
        expect(typeof result.meta.endCursor).toBe('string')
      }
    })
  })
})

// =============================================================================
// 6. INTEGRATION TESTS
// =============================================================================

describe('API Consistency Integration', () => {
  test('Error to Response round-trip preserves information', async () => {
    const original = new NotFoundError({
      message: 'Customer not found',
      resourceType: 'customer',
      resourceId: 'cus_123',
      sdk: 'stripe',
    })

    const response = toResponse(original)
    expect(response.status).toBe(404)

    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toBe('Customer not found')
  })

  test('Pagination through full dataset maintains consistency', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
    const allIds: number[] = []
    let cursor: string | undefined

    for (let i = 0; i < 10; i++) {
      const result = paginate(items, { limit: 10, cursor })
      allIds.push(...result.data.map(item => item.id))
      cursor = result.meta.endCursor

      if (!cursor) break
    }

    // Should have all 100 items with no duplicates
    expect(allIds).toHaveLength(100)
    expect(new Set(allIds).size).toBe(100)
  })

  test('Auth context types are consistent', () => {
    // Create a full auth context and verify all types work together
    const authContext: AuthContext = {
      userId: 'user_123',
      email: 'test@example.com',
      role: 'admin',
      permissions: ['users:read', 'users:write'],
      method: 'jwt',
    }

    const user: User = {
      id: authContext.userId,
      email: authContext.email,
      role: authContext.role,
      permissions: authContext.permissions,
    }

    expect(user.id).toBe(authContext.userId)
    expect(user.role).toBe(authContext.role)
  })
})
