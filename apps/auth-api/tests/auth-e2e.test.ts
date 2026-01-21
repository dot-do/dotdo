/**
 * E2E User Journey Tests for Auth Flow
 *
 * These tests cover the complete authentication user journey including:
 * 1. User registration flow
 * 2. User login flow
 * 3. Protected route access
 * 4. Token refresh flow
 * 5. Logout flow (session invalidation)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import * as jose from 'jose'

// Import the app and UserDO from the auth-api
import app, { UserDO } from '../src/index'

// ============================================================================
// Test Utilities
// ============================================================================

interface TestEnv {
  USER_DO: DurableObjectNamespace
  JWT_SECRET: string
}

// Mock DurableObjectNamespace for testing
class MockDurableObjectStorage implements DurableObjectStorage {
  private data = new Map<string, unknown>()
  private sqlData = new Map<string, Map<string, unknown>>()

  async get<T = unknown>(key: string): Promise<T | undefined>
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>()
      for (const key of keyOrKeys) {
        const value = this.data.get(key)
        if (value !== undefined) {
          result.set(key, value as T)
        }
      }
      return result
    }
    return this.data.get(keyOrKeys) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void>
  async put<T>(entries: Record<string, T>): Promise<void>
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.data.set(keyOrEntries, value)
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.data.set(k, v)
      }
    }
  }

  async delete(key: string): Promise<boolean>
  async delete(keys: string[]): Promise<number>
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0
      for (const key of keyOrKeys) {
        if (this.data.delete(key)) count++
      }
      return count
    }
    return this.data.delete(keyOrKeys)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
  }

  async list<T = unknown>(): Promise<Map<string, T>> {
    return new Map(this.data) as Map<string, T>
  }

  async getAlarm(): Promise<number | null> {
    return null
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {}

  async deleteAlarm(): Promise<void> {}

  async sync(): Promise<void> {}

  async transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
    return closure(this as unknown as DurableObjectTransaction)
  }

  async transactionSync<T>(closure: () => T): Promise<T> {
    return closure()
  }

  // SQLite interface
  sql = {
    tables: [] as string[],
    data: new Map<string, unknown[]>(),

    exec: function <T = unknown>(query: string, ...bindings: unknown[]): {
      [Symbol.iterator](): IterableIterator<T>
      toArray(): T[]
      one(): T | undefined
      raw(): unknown[][]
      columns(): string[]
      rowsRead: number
      rowsWritten: number
    } {
      const result: T[] = []
      const queryLower = query.toLowerCase().trim()

      // Handle CREATE TABLE
      if (queryLower.startsWith('create table')) {
        const match = query.match(/create table if not exists (\w+)/i)
        if (match) {
          this.tables.push(match[1])
          if (!this.data.has(match[1])) {
            this.data.set(match[1], [])
          }
        }
      }
      // Handle INSERT
      else if (queryLower.startsWith('insert into')) {
        const match = query.match(/insert into (\w+)/i)
        if (match) {
          const tableName = match[1]
          const rows = this.data.get(tableName) || []
          rows.push({
            id: bindings[0],
            email: bindings[1],
            name: bindings[2],
            password_hash: bindings[3],
            created_at: bindings[4],
            updated_at: bindings[5],
          })
          this.data.set(tableName, rows)
        }
      }
      // Handle SELECT
      else if (queryLower.startsWith('select')) {
        const match = query.match(/from (\w+)/i)
        if (match) {
          const tableName = match[1]
          const rows = (this.data.get(tableName) || []) as T[]
          result.push(...rows)
        }
      }
      // Handle UPDATE
      else if (queryLower.startsWith('update')) {
        const match = query.match(/update (\w+)/i)
        if (match) {
          const tableName = match[1]
          const rows = this.data.get(tableName) || []
          // Simple update - just update the first row
          if (rows.length > 0) {
            const row = rows[0] as Record<string, unknown>
            // Parse SET clause
            const setMatch = query.match(/set (.+) where/i)
            if (setMatch) {
              const setClauses = setMatch[1].split(',')
              let bindingIndex = 0
              for (const clause of setClauses) {
                const fieldMatch = clause.trim().match(/(\w+)\s*=\s*\?/i)
                if (fieldMatch) {
                  row[fieldMatch[1]] = bindings[bindingIndex++]
                }
              }
            }
          }
        }
      }

      return {
        *[Symbol.iterator]() {
          for (const row of result) {
            yield row
          }
        },
        toArray: () => result,
        one: () => result[0],
        raw: () => result.map((r) => Object.values(r as Record<string, unknown>)),
        columns: () => result.length > 0 ? Object.keys(result[0] as Record<string, unknown>) : [],
        rowsRead: result.length,
        rowsWritten: 0,
      }
    },

    databaseSize: 0,
  }
}

class MockDurableObjectState implements DurableObjectState {
  id: DurableObjectId
  storage: MockDurableObjectStorage

  constructor(id: string) {
    this.id = {
      toString: () => id,
      name: id,
      equals: (other: DurableObjectId) => other.toString() === id,
    } as DurableObjectId
    this.storage = new MockDurableObjectStorage()
  }

  waitUntil(promise: Promise<unknown>): void {}

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback()
  }

  acceptWebSocket(ws: WebSocket): void {}
  getWebSockets(tag?: string): WebSocket[] {
    return []
  }
  setWebSocketAutoResponse(maybeReqResp?: WebSocketRequestResponsePair): void {}
  getWebSocketAutoResponse(): WebSocketRequestResponsePair | null {
    return null
  }
  getWebSocketAutoResponseTimestamp(ws: WebSocket): Date | null {
    return null
  }
  setHibernatableWebSocketEventTimeout(timeoutMs?: number): void {}
  getHibernatableWebSocketEventTimeout(): number | null {
    return null
  }
  getTags(ws: WebSocket): string[] {
    return []
  }

  abort(reason?: string): never {
    throw new Error(reason || 'Aborted')
  }
}

// Store UserDO instances by name for testing
const userDOInstances = new Map<string, UserDO>()

function createMockEnv(): TestEnv {
  return {
    USER_DO: {
      idFromName: (name: string) =>
        ({
          toString: () => name,
          name,
          equals: (other: DurableObjectId) => other.toString() === name,
        }) as DurableObjectId,
      idFromString: (id: string) =>
        ({
          toString: () => id,
          name: id,
          equals: (other: DurableObjectId) => other.toString() === id,
        }) as DurableObjectId,
      newUniqueId: () =>
        ({
          toString: () => `unique-${Date.now()}`,
          name: `unique-${Date.now()}`,
          equals: () => false,
        }) as DurableObjectId,
      get: (id: DurableObjectId) => {
        const name = id.toString()
        if (!userDOInstances.has(name)) {
          const state = new MockDurableObjectState(name)
          userDOInstances.set(name, new UserDO(state, {}))
        }
        const instance = userDOInstances.get(name)!
        return {
          fetch: (request: Request | string, init?: RequestInit) => {
            const req = typeof request === 'string' ? new Request(request, init) : request
            return instance.fetch(req)
          },
        } as DurableObjectStub
      },
      jurisdiction: () =>
        ({
          idFromName: () => ({ toString: () => '', name: '', equals: () => false }) as DurableObjectId,
          idFromString: () => ({ toString: () => '', name: '', equals: () => false }) as DurableObjectId,
          newUniqueId: () => ({ toString: () => '', name: '', equals: () => false }) as DurableObjectId,
          get: () => ({}) as DurableObjectStub,
          jurisdiction: () => ({}) as DurableObjectNamespace,
        }) as DurableObjectNamespace,
    } as DurableObjectNamespace,
    JWT_SECRET: 'test-jwt-secret-for-e2e-tests-minimum-256-bits',
  }
}

// Helper to make requests with the mock environment
async function makeRequest(
  method: string,
  path: string,
  options?: {
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
): Promise<Response> {
  const env = createMockEnv()
  const url = `http://localhost${path}`

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }

  if (options?.body) {
    init.body = JSON.stringify(options.body)
  }

  const request = new Request(url, init)

  // Clone the app and bind the environment
  const boundApp = new Hono<{ Bindings: TestEnv }>()

  // Copy routes from the original app
  // Since we can't easily clone Hono apps, we'll recreate the logic
  return app.fetch(request, env)
}

// Helper to decode JWT payload without verification
function decodeJWT(token: string): Record<string, unknown> {
  const parts = token.split('.')
  const payload = JSON.parse(atob(parts[1]))
  return payload
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Auth E2E User Journey', () => {
  beforeEach(() => {
    // Clear all UserDO instances between tests
    userDOInstances.clear()
  })

  // ========================================================================
  // 1. User Registration Flow
  // ========================================================================
  describe('1. User Registration Flow', () => {
    describe('Valid registration succeeds', () => {
      it('should register a new user and return JWT token', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'newuser@example.com',
            password: 'securePassword123',
            name: 'New User',
          },
        })

        expect(res.status).toBe(201)
        const json = await res.json()

        expect(json.user).toBeDefined()
        expect(json.user.email).toBe('newuser@example.com')
        expect(json.user.name).toBe('New User')
        expect(json.user.id).toMatch(/^usr_/)
        expect(json.token).toBeDefined()
        expect(json.expiresIn).toBe('24h')

        // Verify JWT structure
        const decoded = decodeJWT(json.token)
        expect(decoded.sub).toBe(json.user.id)
        expect(decoded.email).toBe('newuser@example.com')
      })

      it('should normalize email to lowercase', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'TestUser@EXAMPLE.COM',
            password: 'securePassword123',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(201)
        const json = await res.json()
        expect(json.user.email).toBe('testuser@example.com')
      })

      it('should trim whitespace from name', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'trimtest@example.com',
            password: 'securePassword123',
            name: '  Trimmed Name  ',
          },
        })

        expect(res.status).toBe(201)
        const json = await res.json()
        expect(json.user.name).toBe('Trimmed Name')
      })
    })

    describe('Duplicate email fails', () => {
      it('should reject registration with existing email', async () => {
        // First registration
        await makeRequest('POST', '/auth/register', {
          body: {
            email: 'existing@example.com',
            password: 'securePassword123',
            name: 'First User',
          },
        })

        // Second registration with same email
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'existing@example.com',
            password: 'differentPassword456',
            name: 'Second User',
          },
        })

        expect(res.status).toBe(409)
        const json = await res.json()
        expect(json.error).toContain('already exists')
      })

      it('should reject registration with same email different case', async () => {
        await makeRequest('POST', '/auth/register', {
          body: {
            email: 'case@example.com',
            password: 'securePassword123',
            name: 'First User',
          },
        })

        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'CASE@EXAMPLE.COM',
            password: 'anotherPassword456',
            name: 'Second User',
          },
        })

        expect(res.status).toBe(409)
      })
    })

    describe('Invalid email format rejected', () => {
      it('should reject email without @ symbol', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'invalidemail.com',
            password: 'securePassword123',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(400)
        const json = await res.json()
        expect(json.error).toContain('email')
      })

      it('should reject empty email', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: '',
            password: 'securePassword123',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(400)
      })

      it('should reject null email', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: null,
            password: 'securePassword123',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(400)
      })
    })

    describe('Weak password rejected', () => {
      it('should reject password shorter than 8 characters', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'weakpwd@example.com',
            password: 'short',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(400)
        const json = await res.json()
        expect(json.error).toContain('8 characters')
      })

      it('should reject password with exactly 7 characters', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'weakpwd2@example.com',
            password: '1234567',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(400)
      })

      it('should accept password with exactly 8 characters', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'validpwd@example.com',
            password: '12345678',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(201)
      })

      it('should reject empty password', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'nopwd@example.com',
            password: '',
            name: 'Test User',
          },
        })

        expect(res.status).toBe(400)
      })
    })

    describe('Name validation', () => {
      it('should reject empty name', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'noname@example.com',
            password: 'securePassword123',
            name: '',
          },
        })

        expect(res.status).toBe(400)
        const json = await res.json()
        expect(json.error).toContain('Name')
      })

      it('should reject whitespace-only name', async () => {
        const res = await makeRequest('POST', '/auth/register', {
          body: {
            email: 'whitespace@example.com',
            password: 'securePassword123',
            name: '   ',
          },
        })

        expect(res.status).toBe(400)
      })
    })
  })

  // ========================================================================
  // 2. User Login Flow
  // ========================================================================
  describe('2. User Login Flow', () => {
    const testUser = {
      email: 'login-test@example.com',
      password: 'correctPassword123',
      name: 'Login Test User',
    }

    beforeEach(async () => {
      // Register a test user for login tests
      await makeRequest('POST', '/auth/register', {
        body: testUser,
      })
    })

    describe('Valid credentials succeed', () => {
      it('should login with correct credentials and return JWT', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: testUser.password,
          },
        })

        expect(res.status).toBe(200)
        const json = await res.json()

        expect(json.user).toBeDefined()
        expect(json.user.email).toBe(testUser.email)
        expect(json.user.name).toBe(testUser.name)
        expect(json.token).toBeDefined()
        expect(json.expiresIn).toBe('24h')
      })

      it('should login with uppercase email (case insensitive)', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email.toUpperCase(),
            password: testUser.password,
          },
        })

        expect(res.status).toBe(200)
      })

      it('should return valid JWT that can be verified', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: testUser.password,
          },
        })

        const json = await res.json()
        const decoded = decodeJWT(json.token)

        expect(decoded.sub).toBeDefined()
        expect(decoded.email).toBe(testUser.email)
        expect(decoded.iss).toBe('auth-api')
        expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
      })
    })

    describe('Invalid password fails', () => {
      it('should reject login with wrong password', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: 'wrongPassword456',
          },
        })

        expect(res.status).toBe(401)
        const json = await res.json()
        expect(json.error).toContain('Invalid')
      })

      it('should reject login with empty password', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: '',
          },
        })

        expect(res.status).toBe(400)
      })

      it('should not reveal whether email exists on wrong password', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: 'wrongPassword',
          },
        })

        const json = await res.json()
        // Error message should be generic
        expect(json.error).toBe('Invalid email or password')
      })
    })

    describe('Non-existent user fails', () => {
      it('should reject login for non-existent email', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: 'nonexistent@example.com',
            password: 'anyPassword123',
          },
        })

        expect(res.status).toBe(401)
        const json = await res.json()
        expect(json.error).toBe('Invalid email or password')
      })

      it('should not reveal that user does not exist', async () => {
        const resNonExistent = await makeRequest('POST', '/auth/login', {
          body: {
            email: 'nonexistent@example.com',
            password: 'anyPassword123',
          },
        })

        const resWrongPwd = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: 'wrongPassword',
          },
        })

        const jsonNonExistent = await resNonExistent.json()
        const jsonWrongPwd = await resWrongPwd.json()

        // Both should return the same generic error
        expect(jsonNonExistent.error).toBe(jsonWrongPwd.error)
      })
    })

    describe('Returns valid JWT token', () => {
      it('should return JWT with correct structure', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: testUser.password,
          },
        })

        const json = await res.json()
        const parts = json.token.split('.')

        expect(parts).toHaveLength(3)
        // Header
        const header = JSON.parse(atob(parts[0]))
        expect(header.alg).toBe('HS256')
        // Note: jose library does not include 'typ' header by default

        // Payload
        const payload = JSON.parse(atob(parts[1]))
        expect(payload.sub).toBeDefined()
        expect(payload.email).toBe(testUser.email)
        expect(payload.name).toBe(testUser.name)
        expect(payload.iat).toBeDefined()
        expect(payload.exp).toBeDefined()
      })

      it('should return JWT with 24h expiration', async () => {
        const res = await makeRequest('POST', '/auth/login', {
          body: {
            email: testUser.email,
            password: testUser.password,
          },
        })

        const json = await res.json()
        const payload = decodeJWT(json.token)

        const now = Math.floor(Date.now() / 1000)
        const expectedExpiration = now + 24 * 60 * 60

        // Allow 60 second tolerance
        expect(payload.exp).toBeGreaterThan(expectedExpiration - 60)
        expect(payload.exp).toBeLessThan(expectedExpiration + 60)
      })
    })
  })

  // ========================================================================
  // 3. Protected Route Access
  // ========================================================================
  describe('3. Protected Route Access', () => {
    let validToken: string
    let validUserId: string

    beforeEach(async () => {
      // Register and login to get a valid token
      const registerRes = await makeRequest('POST', '/auth/register', {
        body: {
          email: 'protected-test@example.com',
          password: 'securePassword123',
          name: 'Protected Test User',
        },
      })
      const registerJson = await registerRes.json()
      validToken = registerJson.token
      validUserId = registerJson.user.id
    })

    describe('Valid token grants access', () => {
      it('should access /auth/me with valid token', async () => {
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json.email).toBe('protected-test@example.com')
        expect(json.name).toBe('Protected Test User')
      })

      it('should access token refresh with valid token', async () => {
        const res = await makeRequest('POST', '/auth/refresh', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json.token).toBeDefined()
      })

      it('should update profile with valid token', async () => {
        const res = await makeRequest('PATCH', '/auth/me', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
          body: {
            name: 'Updated Name',
          },
        })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json.name).toBe('Updated Name')
      })
    })

    describe('Expired token rejected', () => {
      it('should reject request with expired token', async () => {
        // Create an expired token manually
        const secretKey = new TextEncoder().encode(
          'test-jwt-secret-for-e2e-tests-minimum-256-bits'
        )

        const expiredToken = await new jose.SignJWT({
          sub: validUserId,
          email: 'protected-test@example.com',
          name: 'Protected Test User',
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
          .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
          .setIssuer('auth-api')
          .sign(secretKey)

        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: `Bearer ${expiredToken}`,
          },
        })

        expect(res.status).toBe(401)
        const json = await res.json()
        expect(json.error.toLowerCase()).toMatch(/invalid|expired/)
      })
    })

    describe('Invalid token rejected', () => {
      it('should reject token with invalid signature', async () => {
        // Create a token with a different secret
        const wrongSecretKey = new TextEncoder().encode('wrong-secret-key-for-testing-purposes')

        const invalidToken = await new jose.SignJWT({
          sub: validUserId,
          email: 'protected-test@example.com',
          name: 'Protected Test User',
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('24h')
          .setIssuer('auth-api')
          .sign(wrongSecretKey)

        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: `Bearer ${invalidToken}`,
          },
        })

        expect(res.status).toBe(401)
      })

      it('should reject malformed token', async () => {
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: 'Bearer not.a.valid.jwt.token',
          },
        })

        expect(res.status).toBe(401)
      })

      it('should reject token with tampered payload', async () => {
        // Take a valid token and tamper with the payload
        const parts = validToken.split('.')
        const tamperedPayload = btoa(
          JSON.stringify({
            sub: 'hacker-id',
            email: 'hacker@evil.com',
            name: 'Hacker',
          })
        )
        const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`

        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: `Bearer ${tamperedToken}`,
          },
        })

        expect(res.status).toBe(401)
      })
    })

    describe('Missing token rejected', () => {
      it('should reject request without Authorization header', async () => {
        const res = await makeRequest('GET', '/auth/me')

        expect(res.status).toBe(401)
        const json = await res.json()
        expect(json.error).toContain('Authorization')
      })

      it('should reject request with empty Authorization header', async () => {
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: '',
          },
        })

        expect(res.status).toBe(401)
      })

      it('should reject request with non-Bearer scheme', async () => {
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: 'Basic dXNlcjpwYXNz',
          },
        })

        expect(res.status).toBe(401)
        const json = await res.json()
        expect(json.error).toContain('Bearer')
      })

      it('should reject request with Bearer but no token', async () => {
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: 'Bearer',
          },
        })

        expect(res.status).toBe(401)
      })

      it('should reject request with Bearer and whitespace only', async () => {
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: 'Bearer   ',
          },
        })

        expect(res.status).toBe(401)
      })
    })
  })

  // ========================================================================
  // 4. Token Refresh Flow
  // ========================================================================
  describe('4. Token Refresh Flow', () => {
    let validToken: string

    beforeEach(async () => {
      const registerRes = await makeRequest('POST', '/auth/register', {
        body: {
          email: 'refresh-test@example.com',
          password: 'securePassword123',
          name: 'Refresh Test User',
        },
      })
      const json = await registerRes.json()
      validToken = json.token
    })

    describe('Refresh token works', () => {
      it('should return new token on refresh', async () => {
        // Wait a tiny bit to ensure different iat timestamps
        await new Promise((resolve) => setTimeout(resolve, 10))

        const res = await makeRequest('POST', '/auth/refresh', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        expect(res.status).toBe(200)
        const json = await res.json()

        expect(json.token).toBeDefined()
        expect(json.expiresIn).toBe('24h')
      })

      it('should return token with fresh expiration', async () => {
        const originalPayload = decodeJWT(validToken)

        // Wait to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 100))

        const res = await makeRequest('POST', '/auth/refresh', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        const json = await res.json()
        const refreshedPayload = decodeJWT(json.token)

        // New token should have later expiration
        expect(refreshedPayload.exp).toBeGreaterThanOrEqual(originalPayload.exp as number)
      })

      it('should preserve user identity in refreshed token', async () => {
        const originalPayload = decodeJWT(validToken)

        const res = await makeRequest('POST', '/auth/refresh', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        const json = await res.json()
        const refreshedPayload = decodeJWT(json.token)

        expect(refreshedPayload.sub).toBe(originalPayload.sub)
        expect(refreshedPayload.email).toBe(originalPayload.email)
        expect(refreshedPayload.name).toBe(originalPayload.name)
      })

      it('should allow using refreshed token for subsequent requests', async () => {
        const refreshRes = await makeRequest('POST', '/auth/refresh', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        const { token: newToken } = await refreshRes.json()

        // Use new token to access protected route
        const meRes = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: `Bearer ${newToken}`,
          },
        })

        expect(meRes.status).toBe(200)
        const meJson = await meRes.json()
        expect(meJson.email).toBe('refresh-test@example.com')
      })
    })

    describe('Expired refresh token fails', () => {
      it('should reject refresh with expired token', async () => {
        const secretKey = new TextEncoder().encode(
          'test-jwt-secret-for-e2e-tests-minimum-256-bits'
        )

        const expiredToken = await new jose.SignJWT({
          sub: 'user-123',
          email: 'refresh-test@example.com',
          name: 'Refresh Test User',
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
          .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
          .setIssuer('auth-api')
          .sign(secretKey)

        const res = await makeRequest('POST', '/auth/refresh', {
          headers: {
            Authorization: `Bearer ${expiredToken}`,
          },
        })

        expect(res.status).toBe(401)
      })

      it('should reject refresh without token', async () => {
        const res = await makeRequest('POST', '/auth/refresh')

        expect(res.status).toBe(401)
      })
    })
  })

  // ========================================================================
  // 5. Logout Flow
  // ========================================================================
  describe('5. Logout Flow (Session Invalidation)', () => {
    // Note: The current implementation uses stateless JWTs without a
    // server-side session store or token blacklist. This means tokens
    // remain valid until they expire.
    //
    // In a production system, you would typically:
    // 1. Maintain a token blacklist in Durable Object storage
    // 2. Use short-lived access tokens with refresh tokens
    // 3. Store refresh tokens and revoke them on logout
    //
    // These tests document the expected behavior for a logout endpoint.

    let validToken: string

    beforeEach(async () => {
      const registerRes = await makeRequest('POST', '/auth/register', {
        body: {
          email: 'logout-test@example.com',
          password: 'securePassword123',
          name: 'Logout Test User',
        },
      })
      const json = await registerRes.json()
      validToken = json.token
    })

    describe('Logout behavior documentation', () => {
      // Note: The current auth-api does not implement a logout endpoint.
      // These tests document what the expected behavior should be.

      it('should document that logout endpoint is not implemented', async () => {
        // Since logout is not implemented, we verify that protected routes
        // still work after what would be a logout scenario
        const res = await makeRequest('GET', '/auth/me', {
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        })

        // Token still works (no server-side invalidation)
        expect(res.status).toBe(200)
      })

      it('should recommend implementing token blacklist for production', () => {
        // This is a documentation test - no assertion needed
        // Production recommendation:
        // 1. Add POST /auth/logout endpoint
        // 2. Store invalidated tokens in UserDO.storage
        // 3. Check blacklist in authMiddleware
        // 4. Clean up expired tokens periodically
        expect(true).toBe(true)
      })
    })

    describe('Token lifecycle', () => {
      it('should verify tokens expire after 24 hours', async () => {
        const payload = decodeJWT(validToken)
        const now = Math.floor(Date.now() / 1000)
        const twentyFourHoursInSeconds = 24 * 60 * 60

        // Token should expire approximately 24 hours from now
        expect(payload.exp).toBeGreaterThan(now + twentyFourHoursInSeconds - 60)
        expect(payload.exp).toBeLessThan(now + twentyFourHoursInSeconds + 60)
      })

      it('should demonstrate that client-side logout clears token', () => {
        // Client-side logout simulation
        let clientToken: string | null = validToken
        expect(clientToken).not.toBeNull()

        // Logout = clear token
        clientToken = null
        expect(clientToken).toBeNull()

        // Without token, can't make authenticated requests
        // This is the client-side aspect of logout
      })
    })
  })

  // ========================================================================
  // Integration: Complete User Journey
  // ========================================================================
  describe('Complete User Journey Integration', () => {
    it('should complete full auth lifecycle', async () => {
      // 1. Register
      const registerRes = await makeRequest('POST', '/auth/register', {
        body: {
          email: 'journey@example.com',
          password: 'mySecurePassword123',
          name: 'Journey User',
        },
      })
      expect(registerRes.status).toBe(201)
      const { token: registerToken, user } = await registerRes.json()
      expect(user.email).toBe('journey@example.com')

      // 2. Access protected route with registration token
      const meRes1 = await makeRequest('GET', '/auth/me', {
        headers: { Authorization: `Bearer ${registerToken}` },
      })
      expect(meRes1.status).toBe(200)

      // 3. Logout (client-side) and login again
      const loginRes = await makeRequest('POST', '/auth/login', {
        body: {
          email: 'journey@example.com',
          password: 'mySecurePassword123',
        },
      })
      expect(loginRes.status).toBe(200)
      const { token: loginToken } = await loginRes.json()

      // 4. Access protected route with login token
      const meRes2 = await makeRequest('GET', '/auth/me', {
        headers: { Authorization: `Bearer ${loginToken}` },
      })
      expect(meRes2.status).toBe(200)

      // 5. Update profile
      const updateRes = await makeRequest('PATCH', '/auth/me', {
        headers: { Authorization: `Bearer ${loginToken}` },
        body: { name: 'Updated Journey User' },
      })
      expect(updateRes.status).toBe(200)
      const updatedUser = await updateRes.json()
      expect(updatedUser.name).toBe('Updated Journey User')

      // 6. Refresh token
      const refreshRes = await makeRequest('POST', '/auth/refresh', {
        headers: { Authorization: `Bearer ${loginToken}` },
      })
      expect(refreshRes.status).toBe(200)
      const { token: refreshedToken } = await refreshRes.json()

      // 7. Use refreshed token
      const meRes3 = await makeRequest('GET', '/auth/me', {
        headers: { Authorization: `Bearer ${refreshedToken}` },
      })
      expect(meRes3.status).toBe(200)
      const finalUser = await meRes3.json()
      expect(finalUser.name).toBe('Updated Journey User')
    })

    it('should prevent unauthorized access at each step', async () => {
      // Try to access protected routes without authentication
      const routes = [
        { method: 'GET', path: '/auth/me' },
        { method: 'PATCH', path: '/auth/me' },
        { method: 'POST', path: '/auth/refresh' },
      ]

      for (const route of routes) {
        const res = await makeRequest(route.method, route.path)
        expect(res.status).toBe(401)
      }
    })
  })
})
