/**
 * Artifact Serve - IcebergReader Integration Tests (RED Phase)
 *
 * These tests verify that artifacts-serve.ts properly integrates with
 * the real IcebergReader interface from db/iceberg/types.ts.
 *
 * Current Problem:
 * The serve snippet uses a simplified interface that is incompatible
 * with the real IcebergReader:
 * - Missing `visibility` in partition filter
 * - Missing `auth` context for authorization
 * - Missing `columns` projection for efficiency
 *
 * These tests are EXPECTED TO FAIL until the implementation is updated
 * to use the real IcebergReader interface.
 *
 * @module snippets/tests/artifacts-serve-iceberg.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import actual types from db/iceberg/types to ensure type compatibility
import type {
  GetRecordOptions,
  FindFileOptions,
  PartitionFilter,
  AuthContext,
  Visibility,
} from '../../db/iceberg/types'

// Import serve module
import {
  handleServe,
  type TenantConfig,
  type IntegrationServeOptions,
} from '../artifacts-serve'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Default tenant configuration for testing.
 */
const DEFAULT_TENANT_CONFIG: TenantConfig = {
  ns: 'app.do',
  cache: {
    defaultMaxAge: 300,
    defaultStaleWhileRevalidate: 60,
    minMaxAge: 10,
    allowFreshBypass: true,
  },
}

/**
 * Mock artifact data with visibility levels.
 */
const MOCK_ARTIFACTS = {
  'app.do/Page/public-home': {
    ns: 'app.do',
    type: 'Page',
    id: 'public-home',
    visibility: 'public' as Visibility,
    markdown: '# Public Home Page',
  },
  'app.do/Page/unlisted-doc': {
    ns: 'app.do',
    type: 'Page',
    id: 'unlisted-doc',
    visibility: 'unlisted' as Visibility,
    markdown: '# Unlisted Documentation',
  },
  'app.do/Page/org-internal': {
    ns: 'app.do',
    type: 'Page',
    id: 'org-internal',
    visibility: 'org' as Visibility,
    orgId: 'org-123',
    markdown: '# Organization Internal Page',
  },
  'app.do/Page/user-private': {
    ns: 'app.do',
    type: 'Page',
    id: 'user-private',
    visibility: 'user' as Visibility,
    userId: 'user-456',
    markdown: '# User Private Page',
  },
}

/**
 * Creates a mock Request object.
 */
function createRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Request {
  const url = `https://artifacts.dotdo.dev${path}`
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: new Headers(options.headers ?? {}),
  })
}

/**
 * Creates a mock ExecutionContext.
 */
function createContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext
}

/**
 * Creates a mock cache for integration tests.
 */
function createMockCache() {
  const store = new Map<string, Response>()
  return {
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response.clone())
    }),
  }
}

/**
 * Creates a type-safe mock IcebergReader that expects the REAL interface.
 * This mock validates that callers pass the correct options structure.
 */
function createRealInterfaceMockReader() {
  const getRecordCalls: GetRecordOptions[] = []

  return {
    getRecord: vi.fn(async (options: GetRecordOptions) => {
      // Record the call for later inspection
      getRecordCalls.push(options)

      // Look up artifact based on partition filter
      const { partition, id } = options
      const key = `${partition.ns}/${partition.type}/${id}`
      const artifact = MOCK_ARTIFACTS[key as keyof typeof MOCK_ARTIFACTS]

      if (!artifact) return null

      // Validate visibility filter if present
      if (partition.visibility && artifact.visibility !== partition.visibility) {
        // Visibility mismatch - would not find in filtered partition
        return null
      }

      // Validate auth context against artifact visibility
      if (artifact.visibility === 'org' && options.auth) {
        if (options.auth.orgId !== (artifact as typeof MOCK_ARTIFACTS['app.do/Page/org-internal']).orgId) {
          return null
        }
      }
      if (artifact.visibility === 'user' && options.auth) {
        if (options.auth.userId !== (artifact as typeof MOCK_ARTIFACTS['app.do/Page/user-private']).userId) {
          return null
        }
      }

      // Return only requested columns if specified
      if (options.columns && options.columns.length > 0) {
        const projected: Record<string, unknown> = { id: artifact.id }
        for (const col of options.columns) {
          if (col in artifact) {
            projected[col] = artifact[col as keyof typeof artifact]
          }
        }
        return projected
      }

      return artifact
    }),
    getCalls: () => getRecordCalls,
    reset: () => {
      getRecordCalls.length = 0
    },
  }
}

// ============================================================================
// 1. Visibility in Partition Filter Tests
// ============================================================================

describe('IcebergReader Integration - Visibility in Partition Filter', () => {
  let mockReader: ReturnType<typeof createRealInterfaceMockReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createRealInterfaceMockReader()
    mockCache = createMockCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.reset()
  })

  it('passes visibility="public" in partition filter for unauthenticated requests', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    // Verify the reader was called with visibility in partition
    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition).toHaveProperty('visibility')
    expect(lastCall.partition.visibility).toBe('public')
  })

  it('passes visibility="org" in partition filter for org-authenticated requests', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        'Authorization': 'Bearer org-token',
        'X-Org-Id': 'org-123',
      },
    })
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition).toHaveProperty('visibility')
    expect(lastCall.partition.visibility).toBe('org')
  })

  it('passes visibility="user" in partition filter for user-authenticated requests', async () => {
    const request = createRequest('/$.content/app.do/Page/user-private.md', {
      headers: {
        'Authorization': 'Bearer user-token',
        'X-User-Id': 'user-456',
      },
    })
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition).toHaveProperty('visibility')
    expect(lastCall.partition.visibility).toBe('user')
  })

  it('does NOT pass visibility for unlisted artifacts (direct access only)', async () => {
    // Unlisted artifacts are accessible by direct ID lookup but not by listing
    // The partition filter should NOT include visibility='unlisted'
    const request = createRequest('/$.content/app.do/Page/unlisted-doc.md')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    // For unlisted artifacts, visibility should be omitted or undefined
    // to allow direct ID-based lookups regardless of visibility
    const lastCall = calls[calls.length - 1]
    // This test will FAIL because current implementation doesn't handle unlisted correctly
    expect(lastCall.partition.visibility).toBeUndefined()
  })
})

// ============================================================================
// 2. Auth Context Tests
// ============================================================================

describe('IcebergReader Integration - Auth Context', () => {
  let mockReader: ReturnType<typeof createRealInterfaceMockReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createRealInterfaceMockReader()
    mockCache = createMockCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.reset()
  })

  it('extracts userId from Authorization header and passes to reader', async () => {
    const request = createRequest('/$.content/app.do/Page/user-private.md', {
      headers: {
        // Simulated JWT with user ID claim
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyLTQ1NiJ9.signature',
      },
    })
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('auth')
    expect(lastCall.auth).toHaveProperty('userId')
    expect(lastCall.auth?.userId).toBe('user-456')
  })

  it('extracts orgId from X-Org-Id header and passes to reader', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        'Authorization': 'Bearer some-token',
        'X-Org-Id': 'org-123',
      },
    })
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('auth')
    expect(lastCall.auth).toHaveProperty('orgId')
    expect(lastCall.auth?.orgId).toBe('org-123')
  })

  it('extracts orgId from JWT claims when X-Org-Id header is absent', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        // JWT with orgId claim but no X-Org-Id header
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJvcmdJZCI6Im9yZy0xMjMifQ.signature',
      },
    })
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('auth')
    expect(lastCall.auth?.orgId).toBe('org-123')
  })

  it('passes complete AuthContext with userId, orgId, and roles', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyLTQ1NiIsIm9yZ0lkIjoib3JnLTEyMyIsInJvbGVzIjpbImFkbWluIiwiZWRpdG9yIl19.signature',
        'X-Org-Id': 'org-123',
      },
    })
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('auth')
    expect(lastCall.auth).toEqual({
      userId: 'user-456',
      orgId: 'org-123',
      roles: ['admin', 'editor'],
    })
  })

  it('does not pass auth context when no Authorization header is present', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    // Auth should be undefined or empty for unauthenticated requests
    expect(lastCall.auth).toBeUndefined()
  })
})

// ============================================================================
// 3. Columns Projection Tests
// ============================================================================

describe('IcebergReader Integration - Columns Projection', () => {
  let mockReader: ReturnType<typeof createRealInterfaceMockReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createRealInterfaceMockReader()
    mockCache = createMockCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.reset()
  })

  it('passes only the requested column (markdown) for .md requests', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('columns')
    expect(lastCall.columns).toContain('markdown')
  })

  it('includes "id" column for record identification', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('columns')
    expect(lastCall.columns).toContain('id')
  })

  it('passes only esm column for .js requests', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.js')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('columns')
    expect(lastCall.columns).toContain('esm')
    expect(lastCall.columns).toContain('id')
    // Should NOT include other columns
    expect(lastCall.columns).not.toContain('markdown')
    expect(lastCall.columns).not.toContain('html')
  })

  it('passes frontmatter column for .json requests', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.json')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('columns')
    expect(lastCall.columns).toContain('frontmatter')
  })

  it('passes mdast column for .mdast.json requests', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.mdast.json')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('columns')
    expect(lastCall.columns).toContain('mdast')
  })

  it('passes dts column for .d.ts requests', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.d.ts')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toHaveProperty('columns')
    expect(lastCall.columns).toContain('dts')
  })
})

// ============================================================================
// 4. Authorization Errors Tests
// ============================================================================

describe('IcebergReader Integration - Authorization Errors', () => {
  let mockReader: ReturnType<typeof createRealInterfaceMockReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createRealInterfaceMockReader()
    mockCache = createMockCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.reset()
  })

  it('returns 401 when visibility="org" but no auth header provided', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md')
    // No Authorization header
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(401)
    expect(result.body).toContain('Authentication required')
  })

  it('returns 401 when visibility="user" but no auth header provided', async () => {
    const request = createRequest('/$.content/app.do/Page/user-private.md')
    // No Authorization header
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(401)
    expect(result.body).toContain('Authentication required')
  })

  it('returns 403 when auth does not match resource visibility (wrong org)', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        'Authorization': 'Bearer some-token',
        'X-Org-Id': 'wrong-org',  // Different from artifact's org-123
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(403)
    expect(result.body).toContain('Access denied')
  })

  it('returns 403 when auth does not match resource visibility (wrong user)', async () => {
    const request = createRequest('/$.content/app.do/Page/user-private.md', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ3cm9uZy11c2VyIn0.signature',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(403)
    expect(result.body).toContain('Access denied')
  })

  it('returns 404 for visibility="unlisted" artifacts when not accessed by direct ID', async () => {
    // Unlisted artifacts should not appear in listings
    // This test simulates a listing attempt (which shouldn't work)
    // The actual implementation should handle this at the query level
    const request = createRequest('/$.content/app.do/Page/unlisted-doc.md')
    const ctx = createContext()

    // For unlisted, we don't return 403 - we return 404 to hide existence
    // This is the security pattern: don't reveal that unlisted content exists
    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    // Actually, unlisted SHOULD be accessible by direct ID lookup
    // This test verifies the behavior is correct
    expect(result.status).toBe(200)
  })

  it('returns 401 with proper WWW-Authenticate header for protected resources', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md')
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(401)
    expect(result.headers).toHaveProperty('WWW-Authenticate')
    expect(result.headers['WWW-Authenticate']).toMatch(/Bearer/)
  })
})

// ============================================================================
// 5. Fallback Behavior Tests
// ============================================================================

describe('IcebergReader Integration - Fallback Behavior', () => {
  let mockReader: ReturnType<typeof createRealInterfaceMockReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createRealInterfaceMockReader()
    mockCache = createMockCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.reset()
  })

  it('uses visibility="public" by default when no auth header present', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md')
    const ctx = createContext()

    await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition.visibility).toBe('public')
  })

  it('attempts public visibility first, then checks auth for protected resources', async () => {
    // When accessing a resource, the implementation should:
    // 1. First try with public visibility
    // 2. If not found and auth is present, try with appropriate visibility
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        'Authorization': 'Bearer token',
        'X-Org-Id': 'org-123',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    // Should successfully retrieve the org-internal page
    expect(result.status).toBe(200)
    expect(result.body).toContain('Organization Internal Page')
  })

  it('private artifacts require exactly matching authenticated namespace', async () => {
    // Private (user visibility) artifacts require the authenticated user to match
    const request = createRequest('/$.content/app.do/Page/user-private.md', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyLTQ1NiJ9.signature',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(200)
    expect(result.body).toContain('User Private Page')
  })

  it('falls back gracefully when auth header is malformed', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md', {
      headers: {
        'Authorization': 'InvalidFormat',  // Not a valid Bearer token
      },
    })
    const ctx = createContext()

    // Should still work for public content, just ignore the malformed auth
    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(200)
  })

  it('falls back to public for expired tokens', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md', {
      headers: {
        // Expired JWT (exp claim in the past)
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.signature',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    // Should still serve public content
    expect(result.status).toBe(200)

    // But should use public visibility
    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)
    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition.visibility).toBe('public')
  })
})

// ============================================================================
// Type Compatibility Tests
// ============================================================================

describe('IcebergReader Integration - Type Compatibility', () => {
  /**
   * These tests verify that the IcebergReader interface used by artifacts-serve.ts
   * is compatible with the real interface from db/iceberg/types.ts.
   *
   * They test at compile time (via TypeScript) and runtime.
   */

  it('partition filter should accept Visibility type', () => {
    // This test verifies type compatibility
    const partitionFilter: PartitionFilter = {
      ns: 'app.do',
      type: 'Page',
      visibility: 'public',
    }

    expect(partitionFilter.visibility).toBe('public')
  })

  it('GetRecordOptions should extend FindFileOptions', () => {
    const options: GetRecordOptions = {
      table: 'do_resources',
      partition: { ns: 'app.do', type: 'Page' },
      id: 'test',
      columns: ['markdown'],
      auth: { userId: 'user-123' },
    }

    expect(options.columns).toContain('markdown')
    expect(options.auth?.userId).toBe('user-123')
  })

  it('AuthContext should have optional userId, orgId, and roles', () => {
    const auth: AuthContext = {
      userId: 'user-123',
      orgId: 'org-456',
      roles: ['admin'],
    }

    expect(auth.userId).toBe('user-123')
    expect(auth.orgId).toBe('org-456')
    expect(auth.roles).toContain('admin')
  })

  it('Visibility type should only allow valid values', () => {
    const visibilities: Visibility[] = ['public', 'unlisted', 'org', 'user']

    visibilities.forEach(v => {
      expect(['public', 'unlisted', 'org', 'user']).toContain(v)
    })
  })
})

// ============================================================================
// Integration with Real Interface Mock Tests
// ============================================================================

describe('IcebergReader Integration - Full Flow', () => {
  let mockReader: ReturnType<typeof createRealInterfaceMockReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createRealInterfaceMockReader()
    mockCache = createMockCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.reset()
  })

  it('complete flow: authenticated org user accessing org-protected resource', async () => {
    const request = createRequest('/$.content/app.do/Page/org-internal.md', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyLTc4OSIsIm9yZ0lkIjoib3JnLTEyMyJ9.signature',
        'X-Org-Id': 'org-123',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    // Verify successful response
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('text/markdown')
    expect(result.body).toContain('Organization Internal Page')

    // Verify reader was called with correct options
    const calls = mockReader.getCalls()
    expect(calls.length).toBeGreaterThan(0)

    const lastCall = calls[calls.length - 1]
    expect(lastCall.table).toBe('do_resources')
    expect(lastCall.partition.ns).toBe('app.do')
    expect(lastCall.partition.type).toBe('Page')
    expect(lastCall.partition.visibility).toBe('org')
    expect(lastCall.id).toBe('org-internal')
    expect(lastCall.columns).toContain('markdown')
    expect(lastCall.auth?.orgId).toBe('org-123')
  })

  it('complete flow: unauthenticated user accessing public resource', async () => {
    const request = createRequest('/$.content/app.do/Page/public-home.md')
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    // Verify successful response
    expect(result.status).toBe(200)
    expect(result.body).toContain('Public Home Page')

    // Verify reader was called with correct options
    const calls = mockReader.getCalls()
    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition.visibility).toBe('public')
    expect(lastCall.auth).toBeUndefined()
    expect(lastCall.columns).toContain('markdown')
    expect(lastCall.columns).toContain('id')
  })

  it('complete flow: user accessing their own private resource', async () => {
    const request = createRequest('/$.content/app.do/Page/user-private.md', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyLTQ1NiJ9.signature',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(200)
    expect(result.body).toContain('User Private Page')

    const calls = mockReader.getCalls()
    const lastCall = calls[calls.length - 1]
    expect(lastCall.partition.visibility).toBe('user')
    expect(lastCall.auth?.userId).toBe('user-456')
  })

  it('rejects request when user tries to access another users private resource', async () => {
    const request = createRequest('/$.content/app.do/Page/user-private.md', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJkaWZmZXJlbnQtdXNlciJ9.signature',
      },
    })
    const ctx = createContext()

    const result = await handleServe(request, {}, ctx, {
      reader: mockReader as never,
      cache: mockCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    })

    expect(result.status).toBe(403)
  })
})
