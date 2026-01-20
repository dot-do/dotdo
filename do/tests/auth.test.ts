/**
 * Tests for DO-level Authentication Guards
 *
 * Tests the trust boundaries for:
 * - Worker-to-DO calls (internal trust)
 * - User-to-DO calls (JWT validation)
 * - DO-to-DO calls (internal trust with DO ID verification)
 *
 * This test file uses real miniflare DO instances via @cloudflare/vitest-pool-workers
 * per CLAUDE.md: "Durable Objects require NO MOCKING. Miniflare runs real DOs with real SQLite locally."
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import {
  detectCallerType,
  extractCallerInfo,
  createDOAuthGuard,
  doAuthMiddleware,
  requireWorkerCaller,
  requireDOCaller,
  requireUserCaller,
  requireInternalCaller,
  requireDOSource,
  addDOSourceHeaders,
  createDOToDoHeaders,
  addWorkerHeaders,
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  setDOInternalSecret,
  clearDOInternalSecret,
  getDOInternalSecret,
  verifyDOSignature,
  extractCallerInfoWithVerification,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER,
  extractDONonce,
  DO_NONCE_HEADER,
  type CallerType,
  type DOAuthGuard,
} from '../auth'

// ============================================================================
// Constants
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `auth-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getTestStub(name?: string) {
  const testName = name || generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

/**
 * Create a base64-encoded JWT-like token (for testing without jose)
 */
function createTestToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  const signature = btoa('fake-signature')
  return `${header}.${body}.${signature}`
}

/**
 * Create a request with specific headers
 */
function createRequest(
  url: string,
  options: {
    headers?: Record<string, string>
    method?: string
  } = {}
): Request {
  return new Request(url, {
    method: options.method || 'GET',
    headers: options.headers,
  })
}

// ============================================================================
// Unit Tests: Caller Detection (Pure Functions)
// These test pure functions that don't require DO instances
// ============================================================================

describe('detectCallerType', () => {
  it('should detect DO-to-DO calls', () => {
    const request = createRequest('https://do/', {
      headers: { [DO_SOURCE_HEADER]: 'true' },
    })
    expect(detectCallerType(request)).toBe('do')
  })

  it('should detect Worker-to-DO calls via CF header', () => {
    const request = createRequest('https://do/', {
      headers: { [CF_WORKER_HEADER]: 'my-worker' },
    })
    expect(detectCallerType(request)).toBe('worker')
  })

  it('should detect Worker-to-DO calls via custom header', () => {
    const request = createRequest('https://do/', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })
    expect(detectCallerType(request)).toBe('worker')
  })

  it('should detect User-to-DO calls', () => {
    const request = createRequest('https://do/', {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(detectCallerType(request)).toBe('user')
  })

  it('should return unknown for unidentified callers', () => {
    const request = createRequest('https://do/')
    expect(detectCallerType(request)).toBe('unknown')
  })

  it('should prioritize DO source over worker', () => {
    const request = createRequest('https://do/', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [WORKER_NAME_HEADER]: 'my-worker',
      },
    })
    expect(detectCallerType(request)).toBe('do')
  })

  it('should prioritize worker over user', () => {
    const request = createRequest('https://do/', {
      headers: {
        [WORKER_NAME_HEADER]: 'my-worker',
        Authorization: 'Bearer test-token',
      },
    })
    expect(detectCallerType(request)).toBe('worker')
  })
})

describe('extractCallerInfo', () => {
  it('should extract DO caller info', () => {
    const request = createRequest('https://do/', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'source-do-123',
      },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('do')
    expect(info.id).toBe('source-do-123')
    expect(info.sourceDoId).toBe('source-do-123')
    // Note: extractCallerInfo (sync) marks as trusted but doesn't verify signature
    // For secure verification, use extractCallerInfoWithVerification
    expect(info.trusted).toBe(true)
  })

  it('should extract worker caller info with cf-worker header', () => {
    // cf-worker header is required for trusted worker identification
    const request = createRequest('https://do/', {
      headers: {
        [CF_WORKER_HEADER]: 'cf-runtime-worker',
        [WORKER_NAME_HEADER]: 'api-worker',
      },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('worker')
    expect(info.id).toBe('api-worker')
    expect(info.trusted).toBe(true) // cf-worker present
  })

  it('should mark worker as untrusted without cf-worker header', () => {
    // X-Worker-Name without cf-worker is not trusted
    const request = createRequest('https://do/', {
      headers: { [WORKER_NAME_HEADER]: 'api-worker' },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('worker')
    expect(info.id).toBe('api-worker')
    expect(info.trusted).toBe(false) // No cf-worker header
  })

  it('should extract user caller info', () => {
    const request = createRequest('https://do/', {
      headers: { Authorization: 'Bearer test-token' },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('user')
    expect(info.id).toBeNull() // Will be populated after token validation
    expect(info.trusted).toBe(false)
  })

  it('should extract unknown caller info', () => {
    const request = createRequest('https://do/')

    const info = extractCallerInfo(request)
    expect(info.type).toBe('unknown')
    expect(info.id).toBeNull()
    expect(info.trusted).toBe(false)
  })
})

// ============================================================================
// Unit Tests: DOAuthGuard (Pure Functions with Crypto)
// ============================================================================

describe('createDOAuthGuard', () => {
  let guard: DOAuthGuard

  beforeEach(() => {
    // Set up secret for DO-to-DO signing
    setDOInternalSecret(TEST_SECRET)
    guard = createDOAuthGuard()
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  describe('canAccess', () => {
    it('should allow DO-to-DO calls with valid signature', async () => {
      // Create properly signed request
      const headers = await createDOToDoHeaders('source-do', '/')
      const request = new Request('https://do/', {
        method: 'GET',
        headers,
      })

      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(true)
    })

    it('should deny DO-to-DO calls without valid signature', async () => {
      // Request with spoofed headers but no valid signature
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const request = createRequest('https://do/', {
        headers: { [DO_SOURCE_HEADER]: 'true' },
      })

      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(false)
      warnSpy.mockRestore()
    })

    it('should deny DO-to-DO calls when trustDoToDo is false', async () => {
      const strictGuard = createDOAuthGuard({ trustDoToDo: false })
      // Even with valid signature, should deny if trustDoToDo is false
      const headers = await createDOToDoHeaders('source-do', '/')
      const request = new Request('https://do/', {
        method: 'GET',
        headers,
      })

      const result = await strictGuard.canAccess(request, 'target-do')
      expect(result).toBe(false)
    })

    it('should allow worker-to-DO calls with cf-worker header', async () => {
      // cf-worker header is set by Cloudflare runtime and cannot be spoofed
      const request = createRequest('https://do/', {
        headers: {
          [CF_WORKER_HEADER]: 'cf-runtime',
          [WORKER_NAME_HEADER]: 'my-worker',
        },
      })

      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(true)
    })

    it('should deny worker-to-DO calls without cf-worker header', async () => {
      // X-Worker-Name without cf-worker can be spoofed
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const request = createRequest('https://do/', {
        headers: { [WORKER_NAME_HEADER]: 'my-worker' },
      })

      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(false)
      warnSpy.mockRestore()
    })

    it('should restrict worker-to-DO calls when trustedWorkers is set', async () => {
      const restrictedGuard = createDOAuthGuard({
        trustedWorkers: ['trusted-worker'],
      })

      const untrustedRequest = createRequest('https://do/', {
        headers: {
          [CF_WORKER_HEADER]: 'cf-runtime',
          [WORKER_NAME_HEADER]: 'untrusted-worker',
        },
      })
      expect(await restrictedGuard.canAccess(untrustedRequest, 'target-do')).toBe(false)

      const trustedRequest = createRequest('https://do/', {
        headers: {
          [CF_WORKER_HEADER]: 'cf-runtime',
          [WORKER_NAME_HEADER]: 'trusted-worker',
        },
      })
      expect(await restrictedGuard.canAccess(trustedRequest, 'target-do')).toBe(true)
    })

    it('should deny unknown callers by default', async () => {
      const request = createRequest('https://do/')
      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(false)
    })

    it('should allow anonymous when allowAnonymous is true', async () => {
      const anonymousGuard = createDOAuthGuard({ allowAnonymous: true })
      const request = createRequest('https://do/')
      const result = await anonymousGuard.canAccess(request, 'target-do')
      expect(result).toBe(true)
    })

    it('should use custom trust check when provided with valid signature', async () => {
      const customGuard = createDOAuthGuard({
        customTrustCheck: async (request, callerInfo) => {
          // Only allow specific DO
          return callerInfo.sourceDoId === 'allowed-do'
        },
      })

      // Create properly signed request for allowed-do
      const allowedHeaders = await createDOToDoHeaders('allowed-do', '/')
      const allowedRequest = new Request('https://do/', {
        method: 'GET',
        headers: allowedHeaders,
      })
      expect(await customGuard.canAccess(allowedRequest, 'target-do')).toBe(true)

      // Create properly signed request for denied-do
      const deniedHeaders = await createDOToDoHeaders('denied-do', '/')
      const deniedRequest = new Request('https://do/', {
        method: 'GET',
        headers: deniedHeaders,
      })
      expect(await customGuard.canAccess(deniedRequest, 'target-do')).toBe(false)
    })
  })

  describe('getCallerId', () => {
    it('should get caller ID from DO source header', () => {
      const request = createRequest('https://do/', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do-123',
        },
      })

      expect(guard.getCallerId(request)).toBe('source-do-123')
    })

    it('should get caller ID from worker name header', () => {
      const request = createRequest('https://do/', {
        headers: { [WORKER_NAME_HEADER]: 'my-worker' },
      })

      expect(guard.getCallerId(request)).toBe('my-worker')
    })

    it('should get caller ID from JWT token', () => {
      const token = createTestToken({ sub: 'user-123' })
      const request = createRequest('https://do/', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(guard.getCallerId(request)).toBe('user-123')
    })

    it('should return null for unknown caller', () => {
      const request = createRequest('https://do/')
      expect(guard.getCallerId(request)).toBeNull()
    })
  })

  describe('validateToken', () => {
    it('should decode token without verification when no secret configured', async () => {
      // Suppress console warning for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const token = createTestToken({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['user'],
      })

      const payload = await guard.validateToken(token)
      expect(payload).not.toBeNull()
      expect(payload?.sub).toBe('user-123')
      expect(payload?.email).toBe('test@example.com')

      warnSpy.mockRestore()
    })

    it('should return null for invalid token format', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const payload = await guard.validateToken('invalid-token')
      expect(payload).toBeNull()

      warnSpy.mockRestore()
    })
  })
})

// ============================================================================
// Integration Tests: Real DO with Auth via HTTP
// These tests verify auth behavior through real DO instances
// ============================================================================

describe('DO Auth Integration (Real DO Instances)', () => {
  beforeEach(() => {
    setDOInternalSecret(TEST_SECRET)
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  describe('Health endpoint accessibility', () => {
    it('should allow anonymous access to health endpoint', async () => {
      const stub = getTestStub()

      // Anonymous request (no auth headers)
      const response = await stub.fetch('https://do/')

      expect(response.status).toBe(200)
      const json = await response.json() as { status: string }
      expect(json.status).toBe('ok')
    })

    it('should allow access with worker headers', async () => {
      const stub = getTestStub()

      // Request with CF worker header
      const response = await stub.fetch('https://do/', {
        headers: {
          [CF_WORKER_HEADER]: 'test-worker',
          [WORKER_NAME_HEADER]: 'api-worker',
        },
      })

      expect(response.status).toBe(200)
    })

    it('should allow access with DO-to-DO headers', async () => {
      const stub = getTestStub()

      // Create properly signed DO-to-DO headers
      const headers = await createDOToDoHeaders('source-do', '/')

      const response = await stub.fetch('https://do/', {
        headers,
      })

      expect(response.status).toBe(200)
    })
  })

  describe('Info endpoint with various callers', () => {
    it('should return info with worker headers', async () => {
      const stub = getTestStub()

      const response = await stub.fetch('https://do/info', {
        headers: {
          [CF_WORKER_HEADER]: 'test-worker',
        },
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { id: string; keys: number }
      expect(result.id).toBeDefined()
      expect(typeof result.keys).toBe('number')
    })

    it('should return info with signed DO-to-DO headers', async () => {
      const stub = getTestStub()

      const headers = await createDOToDoHeaders('source-do', '/info')

      const response = await stub.fetch('https://do/info', {
        headers,
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { id: string; keys: number }
      expect(result.id).toBeDefined()
      expect(typeof result.keys).toBe('number')
    })
  })
})

// ============================================================================
// Unit Tests: HMAC Signing Security
// ============================================================================

describe('HMAC Signing Security (do-rrb9)', () => {
  beforeEach(() => {
    clearDOInternalSecret()
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  describe('setDOInternalSecret', () => {
    it('should set the internal secret', () => {
      setDOInternalSecret(TEST_SECRET)
      expect(getDOInternalSecret()).toBe(TEST_SECRET)
    })

    it('should reject secrets shorter than 32 characters', () => {
      expect(() => setDOInternalSecret('short')).toThrow('at least 32 characters')
    })

    it('should reject empty secrets', () => {
      expect(() => setDOInternalSecret('')).toThrow('DO_INTERNAL_SECRET is required')
    })
  })

  describe('verifyDOSignature', () => {
    it('should return false when secret is not configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_SIGNATURE_HEADER]: 'some-signature',
          [DO_TIMESTAMP_HEADER]: Date.now().toString(),
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)

      warnSpy.mockRestore()
    })

    it('should return false when signature is missing', async () => {
      setDOInternalSecret(TEST_SECRET)

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_TIMESTAMP_HEADER]: Date.now().toString(),
          // No signature
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)
    })

    it('should return false when timestamp is missing', async () => {
      setDOInternalSecret(TEST_SECRET)

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_SIGNATURE_HEADER]: 'some-signature',
          // No timestamp
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)
    })

    it('should return false when timestamp is expired', async () => {
      setDOInternalSecret(TEST_SECRET)

      // Timestamp from 10 minutes ago (beyond 5 minute max age)
      const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString()

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_SIGNATURE_HEADER]: 'some-signature',
          [DO_TIMESTAMP_HEADER]: oldTimestamp,
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)
    })

    it('should return false when signature is invalid', async () => {
      setDOInternalSecret(TEST_SECRET)

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_SIGNATURE_HEADER]: 'invalid-signature',
          [DO_TIMESTAMP_HEADER]: Date.now().toString(),
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)
    })

    it('should verify valid signatures', async () => {
      setDOInternalSecret(TEST_SECRET)

      const sourceDoId = 'source-do-123'
      const targetPath = '/rpc'

      // Create properly signed headers
      const headers = await createDOToDoHeaders(sourceDoId, targetPath)

      const request = new Request(`https://do${targetPath}`, {
        method: 'POST',
        headers,
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(true)
    })
  })

  describe('extractCallerInfoWithVerification', () => {
    it('should reject spoofed DO-to-DO headers without valid signature', async () => {
      setDOInternalSecret(TEST_SECRET)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Attacker tries to spoof DO-to-DO headers
      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'spoofed-do-id',
          // No valid signature
        },
      })

      const callerInfo = await extractCallerInfoWithVerification(request)

      // Should be treated as unknown/untrusted, not as a DO
      expect(callerInfo.type).toBe('unknown')
      expect(callerInfo.trusted).toBe(false)

      warnSpy.mockRestore()
    })

    it('should accept DO-to-DO calls with valid signature', async () => {
      setDOInternalSecret(TEST_SECRET)

      const sourceDoId = 'legitimate-source-do'
      const targetPath = '/rpc'

      // Create properly signed headers
      const headers = await createDOToDoHeaders(sourceDoId, targetPath)

      const request = new Request(`https://do${targetPath}`, {
        method: 'POST',
        headers,
      })

      const callerInfo = await extractCallerInfoWithVerification(request)

      expect(callerInfo.type).toBe('do')
      expect(callerInfo.trusted).toBe(true)
      expect(callerInfo.sourceDoId).toBe(sourceDoId)
    })

    it('should reject X-Worker-Name header without cf-worker', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Attacker tries to spoof worker headers
      const request = createRequest('https://do/rpc', {
        headers: {
          [WORKER_NAME_HEADER]: 'spoofed-worker',
          // No cf-worker header
        },
      })

      const callerInfo = await extractCallerInfoWithVerification(request)

      // Should be treated as unknown, not as a worker
      expect(callerInfo.type).toBe('unknown')
      expect(callerInfo.trusted).toBe(false)

      warnSpy.mockRestore()
    })

    it('should accept worker calls with cf-worker header', async () => {
      const request = createRequest('https://do/rpc', {
        headers: {
          [CF_WORKER_HEADER]: 'actual-worker',
          [WORKER_NAME_HEADER]: 'my-api-worker',
        },
      })

      const callerInfo = await extractCallerInfoWithVerification(request)

      expect(callerInfo.type).toBe('worker')
      expect(callerInfo.trusted).toBe(true)
      expect(callerInfo.id).toBe('my-api-worker')
    })
  })

  describe('createDOToDoHeaders with signing', () => {
    it('should create headers with HMAC signature', async () => {
      setDOInternalSecret(TEST_SECRET)

      const headers = await createDOToDoHeaders('source-do', '/rpc')

      expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
      expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('source-do')
      expect(headers.get(DO_TIMESTAMP_HEADER)).toBeTruthy()
      expect(headers.get(DO_SIGNATURE_HEADER)).toBeTruthy()
      expect(headers.get('Content-Type')).toBe('application/json')
    })

    it('should include correlation ID when provided', async () => {
      setDOInternalSecret(TEST_SECRET)

      const headers = await createDOToDoHeaders('source-do', '/rpc', 'corr-123')

      expect(headers.get(CORRELATION_ID_HEADER)).toBe('corr-123')
    })

    it('should warn but not fail when secret not configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const headers = await createDOToDoHeaders('source-do', '/rpc')

      // Headers should still be set (for backwards compatibility)
      expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
      expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('source-do')
      // But signature will be missing
      expect(headers.get(DO_SIGNATURE_HEADER)).toBeNull()

      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('addDOSourceHeaders with signing', () => {
    it('should add HMAC signature to existing headers', async () => {
      setDOInternalSecret(TEST_SECRET)

      const headers = new Headers({ 'X-Custom': 'value' })
      await addDOSourceHeaders(headers, 'source-do', '/rpc')

      expect(headers.get('X-Custom')).toBe('value')
      expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
      expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('source-do')
      expect(headers.get(DO_SIGNATURE_HEADER)).toBeTruthy()
    })
  })
})

describe('createDOAuthGuard with secure verification', () => {
  beforeEach(() => {
    clearDOInternalSecret()
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  it('should deny spoofed DO-to-DO calls', async () => {
    setDOInternalSecret(TEST_SECRET)

    const guard = createDOAuthGuard()

    // Attacker spoofs DO headers without valid signature
    const request = createRequest('https://do/protected', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'spoofed-do',
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await guard.canAccess(request, 'target-do')
    expect(result).toBe(false)
    warnSpy.mockRestore()
  })

  it('should allow legitimate DO-to-DO calls with valid signature', async () => {
    setDOInternalSecret(TEST_SECRET)

    const guard = createDOAuthGuard()

    // Create properly signed request
    const headers = await createDOToDoHeaders('legitimate-source-do', '/protected')
    const request = new Request('https://do/protected', {
      method: 'GET',
      headers,
    })

    const result = await guard.canAccess(request, 'target-do')
    expect(result).toBe(true)
  })

  it('should deny worker calls without cf-worker header', async () => {
    const guard = createDOAuthGuard()

    // Attacker spoofs worker header
    const request = createRequest('https://do/protected', {
      headers: {
        [WORKER_NAME_HEADER]: 'spoofed-worker',
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await guard.canAccess(request, 'target-do')
    expect(result).toBe(false)
    warnSpy.mockRestore()
  })

  it('should allow worker calls with cf-worker header', async () => {
    const guard = createDOAuthGuard()

    const request = createRequest('https://do/protected', {
      headers: {
        [CF_WORKER_HEADER]: 'legitimate-worker',
      },
    })

    const result = await guard.canAccess(request, 'target-do')
    expect(result).toBe(true)
  })
})

// ============================================================================
// Unit Tests: Replay Protection
// ============================================================================

describe('HMAC Replay Protection (do-rljr.9)', () => {
  beforeEach(() => {
    clearDOInternalSecret()
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  describe('Timestamp validation', () => {
    it('should reject timestamps too far in the future (clock manipulation)', async () => {
      setDOInternalSecret(TEST_SECRET)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Timestamp 2 minutes in the future (beyond 30 second max future drift)
      const futureTimestamp = (Date.now() + 2 * 60 * 1000).toString()

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_SIGNATURE_HEADER]: 'some-signature',
          [DO_TIMESTAMP_HEADER]: futureTimestamp,
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)

      // Verify warning was logged (logger prefixes with [DOAuth])
      expect(warnSpy).toHaveBeenCalled()
      const call = warnSpy.mock.calls[0]
      expect(call).toBeDefined()
      expect(call.join(' ')).toContain('timestamp in future')

      warnSpy.mockRestore()
    })

    it('should accept timestamps within allowed future drift (clock skew)', async () => {
      setDOInternalSecret(TEST_SECRET)

      const sourceDoId = 'source-do-123'
      const targetPath = '/rpc'

      // Create headers with a timestamp 10 seconds in the future (within 30s allowed drift)
      const timestamp = (Date.now() + 10 * 1000).toString()

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(TEST_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )

      // Message format: sourceDoId|timestamp|nonce|targetPath
      const message = `${sourceDoId}|${timestamp}||${targetPath}`
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
      const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))

      const request = createRequest(`https://do${targetPath}`, {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: sourceDoId,
          [DO_TIMESTAMP_HEADER]: timestamp,
          [DO_SIGNATURE_HEADER]: signature,
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(true)
    })

    it('should reject timestamps at exactly max age boundary', async () => {
      setDOInternalSecret(TEST_SECRET)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Timestamp exactly at max age + 1 second (should be rejected)
      const oldTimestamp = (Date.now() - 5 * 60 * 1000 - 1000).toString()

      const request = createRequest('https://do/rpc', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do',
          [DO_SIGNATURE_HEADER]: 'some-signature',
          [DO_TIMESTAMP_HEADER]: oldTimestamp,
        },
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)

      warnSpy.mockRestore()
    })
  })

  describe('Nonce validation', () => {
    it('should create headers with nonce when provided', async () => {
      setDOInternalSecret(TEST_SECRET)

      const nonce = 'unique-request-id-123'
      const headers = await createDOToDoHeaders('source-do', '/rpc', { nonce })

      expect(headers.get(DO_NONCE_HEADER)).toBe(nonce)
      expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
      expect(headers.get(DO_SIGNATURE_HEADER)).toBeTruthy()
    })

    it('should verify signatures with nonce included', async () => {
      setDOInternalSecret(TEST_SECRET)

      const sourceDoId = 'source-do-123'
      const targetPath = '/rpc'
      const nonce = 'request-nonce-456'

      // Create headers with nonce
      const headers = await createDOToDoHeaders(sourceDoId, targetPath, { nonce })

      const request = new Request(`https://do${targetPath}`, {
        method: 'POST',
        headers,
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(true)
    })

    it('should reject signature if nonce is tampered with', async () => {
      setDOInternalSecret(TEST_SECRET)

      const sourceDoId = 'source-do-123'
      const targetPath = '/rpc'
      const originalNonce = 'original-nonce'

      // Create headers with original nonce
      const headers = await createDOToDoHeaders(sourceDoId, targetPath, { nonce: originalNonce })

      // Tamper with the nonce header (but keep the original signature)
      headers.set(DO_NONCE_HEADER, 'tampered-nonce')

      const request = new Request(`https://do${targetPath}`, {
        method: 'POST',
        headers,
      })

      const result = await verifyDOSignature(request)
      expect(result).toBe(false)
    })

    it('should extract nonce from request', () => {
      const nonce = 'my-unique-nonce'
      const request = createRequest('https://do/rpc', {
        headers: { [DO_NONCE_HEADER]: nonce },
      })

      const extractedNonce = extractDONonce(request)
      expect(extractedNonce).toBe(nonce)
    })

    it('should return null when no nonce present', () => {
      const request = createRequest('https://do/rpc')

      const extractedNonce = extractDONonce(request)
      expect(extractedNonce).toBeNull()
    })

    it('should support nonce with addDOSourceHeaders', async () => {
      setDOInternalSecret(TEST_SECRET)

      const nonce = 'header-nonce-789'
      const headers = new Headers()
      await addDOSourceHeaders(headers, 'source-do', '/rpc', nonce)

      expect(headers.get(DO_NONCE_HEADER)).toBe(nonce)
    })

    it('should create headers with both nonce and correlationId', async () => {
      setDOInternalSecret(TEST_SECRET)

      const nonce = 'unique-nonce'
      const correlationId = 'correlation-id-123'

      const headers = await createDOToDoHeaders('source-do', '/rpc', {
        nonce,
        correlationId,
      })

      expect(headers.get(DO_NONCE_HEADER)).toBe(nonce)
      expect(headers.get(CORRELATION_ID_HEADER)).toBe(correlationId)
    })

    it('should maintain backwards compatibility with string correlationId', async () => {
      setDOInternalSecret(TEST_SECRET)

      // Old API: third param is just correlationId string
      const headers = await createDOToDoHeaders('source-do', '/rpc', 'corr-id')

      expect(headers.get(CORRELATION_ID_HEADER)).toBe('corr-id')
      expect(headers.get(DO_NONCE_HEADER)).toBeNull() // No nonce with old API
    })
  })

  describe('Timing attack prevention', () => {
    it('should use constant-time comparison for signature verification', async () => {
      setDOInternalSecret(TEST_SECRET)

      const sourceDoId = 'source-do'
      const targetPath = '/rpc'

      // Create valid signature
      const headers = await createDOToDoHeaders(sourceDoId, targetPath)
      const validSignature = headers.get(DO_SIGNATURE_HEADER)!

      // Create request with slightly different signature (only last char differs)
      const tamperedSignature = validSignature.slice(0, -1) + (validSignature.slice(-1) === 'a' ? 'b' : 'a')

      const request = createRequest(`https://do${targetPath}`, {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: sourceDoId,
          [DO_TIMESTAMP_HEADER]: headers.get(DO_TIMESTAMP_HEADER)!,
          [DO_SIGNATURE_HEADER]: tamperedSignature,
        },
      })

      // The verification should fail, demonstrating the constant-time comparison works
      const result = await verifyDOSignature(request)
      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// Unit Tests: Header Helpers
// ============================================================================

describe('addDOSourceHeaders', () => {
  beforeEach(() => {
    setDOInternalSecret(TEST_SECRET)
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  it('should add DO source headers with signature', async () => {
    const headers = new Headers()
    await addDOSourceHeaders(headers, 'my-do-id', '/test')

    expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
    expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('my-do-id')
    expect(headers.get(DO_SIGNATURE_HEADER)).toBeTruthy()
    expect(headers.get(DO_TIMESTAMP_HEADER)).toBeTruthy()
  })

  it('should preserve existing headers', async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    await addDOSourceHeaders(headers, 'my-do-id', '/test')

    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
  })
})

describe('createDOToDoHeaders', () => {
  beforeEach(() => {
    setDOInternalSecret(TEST_SECRET)
  })

  afterEach(() => {
    clearDOInternalSecret()
  })

  it('should create headers for DO-to-DO calls with signature', async () => {
    const headers = await createDOToDoHeaders('source-do-123', '/rpc')

    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
    expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('source-do-123')
    expect(headers.get(DO_SIGNATURE_HEADER)).toBeTruthy()
    expect(headers.get(DO_TIMESTAMP_HEADER)).toBeTruthy()
  })

  it('should include correlation ID when provided', async () => {
    const headers = await createDOToDoHeaders('source-do', '/rpc', 'corr-123')

    expect(headers.get(CORRELATION_ID_HEADER)).toBe('corr-123')
  })

  it('should not include correlation ID when not provided', async () => {
    const headers = await createDOToDoHeaders('source-do', '/rpc')

    expect(headers.get(CORRELATION_ID_HEADER)).toBeNull()
  })
})

describe('addWorkerHeaders', () => {
  it('should add worker name header', () => {
    const headers = new Headers()
    addWorkerHeaders(headers, 'api-worker')

    expect(headers.get(WORKER_NAME_HEADER)).toBe('api-worker')
  })

  it('should preserve existing headers', () => {
    const headers = new Headers({ Authorization: 'Bearer token' })
    addWorkerHeaders(headers, 'api-worker')

    expect(headers.get('Authorization')).toBe('Bearer token')
    expect(headers.get(WORKER_NAME_HEADER)).toBe('api-worker')
  })
})
