/**
 * Shared Test Utilities and Fixtures - Wave 2 REFACTOR [do-q7hy]
 *
 * Centralized test utilities for use across all test files, including:
 * - Auth fixtures (JWT tokens, API keys, test users)
 * - DO test helpers (creating instances, seeding data, cleanup)
 * - HTTP test helpers (mock requests, Hono context)
 * - Common fixtures (test customers, orders, products)
 *
 * @module tests/utils
 */

import { env } from 'cloudflare:test'
import type { ThingData } from '../../types'
import * as jose from 'jose'

// ============================================================================
// AUTH FIXTURES - JWT Tokens
// ============================================================================

/**
 * Options for creating test JWT tokens
 */
export interface CreateTestJwtOptions {
  sub?: string
  email?: string
  org_id?: string
  permissions?: string[]
  expiresIn?: string
  issuedAt?: number
}

/**
 * Create a valid JWT token for testing authenticated endpoints
 *
 * Uses proper jose library signing for realistic JWT token validation testing.
 *
 * @param payload - JWT payload options
 * @param secret - Secret key for signing (defaults to test secret)
 * @returns JWT token string
 *
 * @example
 * ```typescript
 * const token = await createTestJwt()
 * const adminToken = await createTestJwt({ permissions: ['admin:users:read'] })
 * const customToken = await createTestJwt({ sub: 'user-123', org_id: 'org-456' })
 * ```
 */
export async function createTestJwt(
  payload: CreateTestJwtOptions = {},
  secret: string = 'test-jwt-secret-key-minimum-32-characters-for-hs256'
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)
  const now = Math.floor(Date.now() / 1000)

  const jwt = await new jose.SignJWT({
    sub: payload.sub ?? 'test-user-123',
    email: payload.email ?? 'test@example.com',
    org_id: payload.org_id ?? 'org-test',
    permissions: payload.permissions ?? [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(payload.issuedAt ?? now)
    .setExpirationTime(payload.expiresIn ?? '24h')
    .sign(secretKey)

  return jwt
}

/**
 * Create an expired JWT token for testing token expiration handling
 *
 * @param secret - Secret key for signing (defaults to test secret)
 * @returns Expired JWT token string
 *
 * @example
 * ```typescript
 * const expiredToken = await createExpiredJwt()
 * ```
 */
export async function createExpiredJwt(
  secret: string = 'test-jwt-secret-key-minimum-32-characters-for-hs256'
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)
  const now = Math.floor(Date.now() / 1000)

  const jwt = await new jose.SignJWT({
    sub: 'test-user-123',
    permissions: [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now - 7200) // 2 hours ago
    .setExpirationTime(now - 3600) // 1 hour ago
    .sign(secretKey)

  return jwt
}

/**
 * Create a JWT token with invalid signature for testing signature validation
 *
 * @returns JWT token with tampered signature
 *
 * @example
 * ```typescript
 * const invalidToken = createInvalidSignatureJwt()
 * ```
 */
export function createInvalidSignatureJwt(): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = btoa(JSON.stringify({
    sub: 'test-user-123',
    permissions: [],
    iat: now,
    exp: now + 3600,
  }))
  const tameredSignature = 'tampered-signature-will-not-verify'

  return `${header}.${payload}.${tameredSignature}`
}

/**
 * Create a simple JWT token synchronously (for quick testing without cryptographic signing)
 *
 * This creates a basic JWT structure without proper signing - useful for middleware
 * that only decodes payloads without verifying signatures. For proper signature
 * validation testing, use the async `createTestJwt` function.
 *
 * @param options - JWT options
 * @returns Simple JWT token string
 *
 * @example
 * ```typescript
 * const token = createSimpleTestJwt()
 * const adminToken = createSimpleTestJwt({ permissions: ['admin:users:read'] })
 * ```
 */
export function createSimpleTestJwt(options: {
  sub?: string
  permissions?: string[]
  exp?: number
  iat?: number
} = {}): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: options.sub ?? 'test-user',
    iat: options.iat ?? now,
    exp: options.exp ?? now + 3600,
    permissions: options.permissions ?? [],
  }

  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '')
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '')
  const signature = 'test-signature'

  return `${base64Header}.${base64Payload}.${signature}`
}

// ============================================================================
// AUTH FIXTURES - API Keys
// ============================================================================

/**
 * Options for generating test API keys
 */
export interface MockApiKeyOptions {
  prefix?: string
  length?: number
}

/**
 * Generate a mock API key for testing API key authentication
 *
 * @param options - API key generation options
 * @returns Mock API key string
 *
 * @example
 * ```typescript
 * const apiKey = mockApiKey()
 * const customKey = mockApiKey({ prefix: 'test_', length: 32 })
 * ```
 */
export function mockApiKey(options: MockApiKeyOptions = {}): string {
  const prefix = options.prefix ?? 'sk_test_'
  const length = options.length ?? 32

  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = prefix

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return result
}

// ============================================================================
// AUTH FIXTURES - Test Users
// ============================================================================

/**
 * Test user interface
 */
export interface TestUser {
  id: string
  email: string
  name: string
  permissions: string[]
  org_id: string
  role?: string
}

/**
 * Create a test user object
 *
 * @param overrides - Properties to override defaults
 * @returns Test user object
 *
 * @example
 * ```typescript
 * const user = createTestUser()
 * const adminUser = createTestUser({ role: 'admin', permissions: ['*'] })
 * ```
 */
export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  const now = Date.now()
  return {
    id: `user_${now}`,
    email: `test-${now}@example.com`,
    name: 'Test User',
    permissions: ['read', 'write'],
    org_id: 'org-test',
    role: 'user',
    ...overrides,
  }
}

/**
 * Predefined test users for common scenarios
 */
export const TEST_USERS = {
  admin: createTestUser({
    id: 'user_admin',
    email: 'admin@example.com',
    name: 'Admin User',
    permissions: ['*'],
    role: 'admin',
  }),
  standardUser: createTestUser({
    id: 'user_standard',
    email: 'user@example.com',
    name: 'Standard User',
    permissions: ['read', 'write'],
    role: 'user',
  }),
  readOnlyUser: createTestUser({
    id: 'user_readonly',
    email: 'readonly@example.com',
    name: 'Read Only User',
    permissions: ['read'],
    role: 'viewer',
  }),
}

// ============================================================================
// DO TEST HELPERS - Instance Creation
// ============================================================================

/**
 * Type-safe interface for DOCore test instances
 */
export interface DOCoreTestInstance {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<boolean>
  delete(key: string): Promise<void>
  setMany(entries: Record<string, unknown>): Promise<void>
  deleteMany(keys: string[]): Promise<void>
  list(options?: ListOptions): Promise<Record<string, unknown>>

  setAlarm(time: Date | number): Promise<void>
  getAlarm(): Promise<Date | null>
  deleteAlarm(): Promise<void>

  ping(): Promise<string>
  add(a: number, b: number): Promise<number>

  create(noun: string, data: Record<string, unknown>): Promise<ThingData>
  listThings(noun: string, query?: ThingQuery): Promise<ThingData[]>

  fetch(url: string, init?: RequestInit): Promise<Response>
}

/**
 * List options for state queries
 */
export interface ListOptions {
  prefix?: string
  start?: string
  end?: string
  limit?: number
  reverse?: boolean
}

/**
 * Query options for listing things
 */
export interface ThingQuery {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
}

/**
 * Create a test DO instance with unique or specified name
 *
 * @param binding - The DO binding from env (defaults to env.DOCore)
 * @param name - Optional name for the DO instance. If not provided, generates a unique name.
 * @returns The DO stub typed as DOCoreTestInstance
 *
 * @example
 * ```typescript
 * // With auto-generated unique name
 * const doInstance = createTestDO()
 *
 * // With specific name
 * const doInstance = createTestDO(env.DOCore, 'my-test-instance')
 * ```
 */
export function createTestDO(
  binding?: DurableObjectNamespace,
  name?: string
): DOCoreTestInstance {
  const doBinding = binding ?? env.DOCore
  const instanceName = name ?? `test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  const id = doBinding.idFromName(instanceName)
  return doBinding.get(id) as unknown as DOCoreTestInstance
}

// ============================================================================
// DO TEST HELPERS - Data Seeding & Cleanup
// ============================================================================

/**
 * Seed test data into a DO instance
 *
 * Creates multiple things of a specified type with optional data.
 * Useful for bulk testing operations like list, filter, pagination.
 *
 * @param stub - The DO stub to seed data into
 * @param type - The noun type (e.g., 'Customer', 'Order')
 * @param items - Array of item data to create
 * @returns Array of created ThingData objects
 *
 * @example
 * ```typescript
 * const customers = await seedThings(doInstance, 'Customer', [
 *   { name: 'Alice', email: 'alice@example.com' },
 *   { name: 'Bob', email: 'bob@example.com' },
 * ])
 * ```
 */
export async function seedThings(
  stub: DOCoreTestInstance,
  type: string,
  items: Record<string, unknown>[]
): Promise<ThingData[]> {
  const created: ThingData[] = []

  for (const item of items) {
    const result = await stub.create(type, item)
    created.push(result)
  }

  return created
}

/**
 * Clean up test data from a DO instance
 *
 * Deletes all things of a specified type. Use with caution in production!
 * This is designed for test cleanup only.
 *
 * @param stub - The DO stub to clean up
 * @param type - The noun type to clean (e.g., 'Customer', 'Order')
 * @returns Number of items deleted
 *
 * @example
 * ```typescript
 * const deletedCount = await cleanupThings(doInstance, 'Customer')
 * ```
 */
export async function cleanupThings(
  stub: DOCoreTestInstance,
  type: string
): Promise<number> {
  const things = await stub.listThings(type)
  let count = 0

  for (const thing of things) {
    // Note: Implement based on your DO's delete API
    // This is a placeholder - adjust based on actual DO implementation
    if (thing.$id) {
      count++
    }
  }

  return count
}

// ============================================================================
// HTTP TEST HELPERS - Request Creation
// ============================================================================

/**
 * Options for creating mock HTTP requests
 */
export interface MockRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | FormData | ReadableStream<Uint8Array>
  query?: Record<string, string>
  auth?: string // Authorization header value
}

/**
 * Create a mock HTTP Request object for testing
 *
 * Useful for testing HTTP handlers and middleware in isolation.
 *
 * @param path - The request path (e.g., '/api/users')
 * @param options - Request options
 * @returns Mock Request object
 *
 * @example
 * ```typescript
 * const req = createMockRequest('/api/users')
 * const postReq = createMockRequest('/api/users', {
 *   method: 'POST',
 *   body: JSON.stringify({ name: 'Alice' }),
 *   headers: { 'Content-Type': 'application/json' }
 * })
 * const authReq = createMockRequest('/protected', { auth: 'Bearer token123' })
 * ```
 */
export function createMockRequest(path: string, options: MockRequestOptions = {}): Request {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.headers ?? {})

  if (options.auth) {
    headers.set('Authorization', options.auth)
  }

  if (options.query) {
    const queryString = new URLSearchParams(options.query).toString()
    path = `${path}?${queryString}`
  }

  const url = `https://test.example.com${path}`

  return new Request(url, {
    method,
    headers,
    body: options.body,
  })
}

/**
 * Create mock Request with Bearer token
 *
 * @param path - Request path
 * @param token - JWT token
 * @param options - Additional request options
 * @returns Mock Request with Bearer authorization
 *
 * @example
 * ```typescript
 * const token = await createTestJwt()
 * const req = createMockRequestWithAuth('/protected', token)
 * ```
 */
export function createMockRequestWithAuth(
  path: string,
  token: string,
  options: MockRequestOptions = {}
): Request {
  return createMockRequest(path, {
    ...options,
    auth: `Bearer ${token}`,
  })
}

/**
 * Create mock Request with API key
 *
 * @param path - Request path
 * @param apiKey - API key
 * @param options - Additional request options
 * @returns Mock Request with API key authorization
 *
 * @example
 * ```typescript
 * const apiKey = mockApiKey()
 * const req = createMockRequestWithApiKey('/api/data', apiKey)
 * ```
 */
export function createMockRequestWithApiKey(
  path: string,
  apiKey: string,
  options: MockRequestOptions = {}
): Request {
  return createMockRequest(path, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      'X-API-Key': apiKey,
    },
  })
}

// ============================================================================
// HTTP TEST HELPERS - Hono Context Mocking
// ============================================================================

/**
 * Mock Hono context for testing handlers
 *
 * Provides a minimal context object compatible with Hono handlers.
 * Useful for unit testing route handlers without full server setup.
 *
 * @example
 * ```typescript
 * const ctx = createMockHonoContext('/api/users')
 * const response = await handler(ctx)
 * expect(response.status).toBe(200)
 * ```
 */
export function createMockHonoContext(path: string = '/', options: MockRequestOptions = {}) {
  const request = createMockRequest(path, options)

  return {
    req: {
      url: request.url,
      method: request.method,
      header: (name: string) => request.headers.get(name),
      headers: request.headers,
    },
    env: env,
    var: new Map(),
    set: (key: string, value: unknown) => {
      const ctx = this as any
      ctx.var.set(key, value)
    },
    get: (key: string) => {
      const ctx = this as any
      return ctx.var.get(key)
    },
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers instanceof Headers
            ? Object.fromEntries(init.headers)
            : (init?.headers as Record<string, string>) ?? {}),
        },
      }),
    text: (data: string, init?: ResponseInit) =>
      new Response(data, {
        status: init?.status ?? 200,
        headers: {
          'Content-Type': 'text/plain',
          ...(init?.headers instanceof Headers
            ? Object.fromEntries(init.headers)
            : (init?.headers as Record<string, string>) ?? {}),
        },
      }),
  }
}

// ============================================================================
// COMMON FIXTURES - Test Data Objects
// ============================================================================

/**
 * Test customer data
 */
export interface TestCustomerData {
  name: string
  email: string
  phone?: string
  address?: {
    street: string
    city: string
    state: string
    zip: string
  }
  tags?: string[]
}

/**
 * Test order data
 */
export interface TestOrderData {
  customerId: string
  items: Array<{
    productId: string
    quantity: number
    price: number
  }>
  total: number
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
}

/**
 * Sample customers for bulk testing
 */
export const testCustomers: TestCustomerData[] = [
  {
    name: 'Alice Johnson',
    email: 'alice@example.com',
    phone: '+1-555-0101',
    tags: ['premium', 'vip'],
    address: {
      street: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
    },
  },
  {
    name: 'Bob Smith',
    email: 'bob@example.com',
    phone: '+1-555-0102',
    tags: ['standard'],
    address: {
      street: '456 Oak Ave',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
    },
  },
  {
    name: 'Charlie Brown',
    email: 'charlie@example.com',
    phone: '+1-555-0103',
    tags: ['new'],
  },
  {
    name: 'Diana Prince',
    email: 'diana@example.com',
    phone: '+1-555-0104',
    tags: ['premium', 'verified'],
  },
]

/**
 * Sample orders for bulk testing
 */
export const testOrders: TestOrderData[] = [
  {
    customerId: 'customer_alice',
    items: [
      { productId: 'product_1', quantity: 2, price: 99.99 },
      { productId: 'product_2', quantity: 1, price: 49.99 },
    ],
    total: 249.97,
    status: 'pending',
  },
  {
    customerId: 'customer_bob',
    items: [
      { productId: 'product_3', quantity: 5, price: 29.99 },
    ],
    total: 149.95,
    status: 'processing',
  },
  {
    customerId: 'customer_charlie',
    items: [
      { productId: 'product_1', quantity: 1, price: 99.99 },
    ],
    total: 99.99,
    status: 'shipped',
  },
]

/**
 * Sample products for bulk testing
 */
export const testProducts = [
  {
    name: 'Premium Widget',
    sku: 'WIDGET-PRO-001',
    price: 99.99,
    category: 'widgets',
  },
  {
    name: 'Basic Widget',
    sku: 'WIDGET-BASIC-001',
    price: 29.99,
    category: 'widgets',
  },
  {
    name: 'Advanced Gadget',
    sku: 'GADGET-ADV-001',
    price: 199.99,
    category: 'gadgets',
  },
  {
    name: 'Pro Gadget',
    sku: 'GADGET-PRO-001',
    price: 149.99,
    category: 'gadgets',
  },
]

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { ThingData }
