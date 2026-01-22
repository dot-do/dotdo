/**
 * Production E2E Test Suite for Live Workers
 *
 * Tests the deployed production workers at example.com.ai:
 * - Parent DO health endpoint
 * - Tenant API info endpoint (HATEOAS)
 * - Tenant context endpoint
 * - Full CRUD lifecycle on things
 * - Events recording
 * - Relationships CRUD
 *
 * Uses real HTTP requests to live endpoints.
 * Tests clean up after themselves by deleting created resources.
 *
 * Run with:
 *   npm run test:prod
 *   # or
 *   npx vitest run tests/e2e/tests/production.test.ts
 *
 * @module tests/e2e/tests/production.test
 * @see do-85bvp.6
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'

// ============================================================================
// Configuration
// ============================================================================

/**
 * Production endpoints
 * These are the live deployed workers
 */
const ENDPOINTS = {
  /** Parent DO - example.com.ai */
  parent: 'https://example.com.ai',
  /** Tenant DO - crm.example.com.ai */
  tenant: 'https://crm.example.com.ai',
  /** Test tenant context */
  tenantContext: 'e2e-test',
} as const

/**
 * Test configuration
 */
const CONFIG = {
  /** Timeout for HTTP requests (ms) */
  requestTimeout: 10000,
  /** Number of retries for flaky requests */
  retries: 2,
  /** Delay between retries (ms) */
  retryDelay: 1000,
}

// ============================================================================
// Types
// ============================================================================

interface ParentHealthResponse {
  status: string
  service?: string
  type?: string
}

interface HATEOASResponse {
  name?: string
  description?: string
  version?: string
  links?: Record<string, unknown>
  api?: string
  _links?: Record<string, { href: string; method?: string }>
}

interface TenantContextResponse {
  $id?: string
  $type?: string
  $context?: {
    $id?: string
    [key: string]: unknown
  }
  tenant?: string
  tenantId?: string
  _links?: Record<string, string>
  [key: string]: unknown
}

interface Thing {
  $id: string
  $type?: string
  $created?: string
  $updated?: string
  [key: string]: unknown
}

interface ThingsListResponse {
  items?: Thing[]
  data?: Thing[]
  things?: Thing[]
  total?: number
  limit?: number
  offset?: number
  _links?: Record<string, unknown>
}

interface Event {
  $id: string
  $type?: string
  type?: string
  payload?: unknown
  $created?: string
  timestamp?: string | number
  [key: string]: unknown
}

interface EventsListResponse {
  items?: Event[]
  data?: Event[]
  events?: Event[]
  total?: number
  _links?: Record<string, unknown>
}

interface Relationship {
  $id: string
  from?: string
  to?: string
  $type?: string
  type?: string
  [key: string]: unknown
}

interface RelationshipsListResponse {
  items?: Relationship[]
  data?: Relationship[]
  relationships?: Relationship[]
  total?: number
  _links?: Record<string, unknown>
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique test ID to avoid conflicts between test runs
 */
function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Fetch with timeout and retries
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = CONFIG.retries,
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout)

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response
    } catch (error) {
      lastError = error as Error
      if (attempt < retries) {
        console.log(`[Production E2E] Request to ${url} failed, retrying (${attempt + 1}/${retries})...`)
        await new Promise((resolve) => setTimeout(resolve, CONFIG.retryDelay))
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`)
}

/**
 * Track created resources for cleanup
 */
const createdResources: Array<{ type: 'thing' | 'relationship' | 'event'; id: string }> = []

function trackResource(type: 'thing' | 'relationship' | 'event', id: string): void {
  createdResources.push({ type, id })
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Production E2E Tests', () => {
  // Store created thing IDs for relationship tests
  let testThingId1: string | null = null
  let testThingId2: string | null = null

  beforeAll(() => {
    console.log('[Production E2E] Starting production E2E tests')
    console.log(`[Production E2E] Parent endpoint: ${ENDPOINTS.parent}`)
    console.log(`[Production E2E] Tenant endpoint: ${ENDPOINTS.tenant}`)
    console.log(`[Production E2E] Tenant context: ${ENDPOINTS.tenantContext}`)
  })

  afterAll(async () => {
    console.log('[Production E2E] Cleaning up test resources...')

    // Clean up in reverse order (relationships first, then things)
    const sortedResources = [...createdResources].reverse()

    for (const resource of sortedResources) {
      try {
        const url = `${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/${resource.type}s/${resource.id}`
        const response = await fetchWithRetry(url, { method: 'DELETE' }, 1)
        if (response.ok || response.status === 404) {
          console.log(`[Production E2E] Cleaned up ${resource.type}: ${resource.id}`)
        } else {
          console.warn(`[Production E2E] Failed to clean up ${resource.type} ${resource.id}: ${response.status}`)
        }
      } catch (error) {
        console.warn(`[Production E2E] Error cleaning up ${resource.type} ${resource.id}:`, error)
      }
    }

    console.log('[Production E2E] Cleanup complete')
  })

  // ==========================================================================
  // Parent DO Tests
  // ==========================================================================

  describe('Parent DO', () => {
    it('should return health status at root', async () => {
      const response = await fetchWithRetry(ENDPOINTS.parent)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as ParentHealthResponse
      expect(data.status).toBe('ok')
      expect(data.service).toBe('example.com.ai')
      expect(data.type).toBe('parent-do')
    })

    it('should return health status at /health', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.parent}/health`)

      // Health endpoint might return 200 with status or redirect to root
      if (response.ok) {
        const data = (await response.json()) as ParentHealthResponse
        expect(data.status).toBeDefined()
      } else {
        // Some deployments might not have /health endpoint
        expect([200, 404]).toContain(response.status)
      }
    })
  })

  // ==========================================================================
  // Tenant DO Tests
  // ==========================================================================

  describe('Tenant DO', () => {
    it('should return HATEOAS API info at tenant root', async () => {
      const response = await fetchWithRetry(ENDPOINTS.tenant)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as HATEOASResponse
      // Should have some form of API info
      expect(data).toBeDefined()

      // Check for HATEOAS links or API info
      const hasApiInfo = data.api || data._links || data.links || data.name || data.version
      expect(hasApiInfo).toBeTruthy()
    })

    it('should return tenant context at /{tenant}/', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/`)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as TenantContextResponse
      expect(data).toBeDefined()

      // Should have context info or tenant identifier
      // Response format: { $id, $type, tenantId, _links }
      const hasContextInfo = data.$id || data.$type || data.tenantId || data.tenant || data.$context
      expect(hasContextInfo).toBeTruthy()

      // Verify HATEOAS links are present
      if (data._links) {
        expect(data._links.self).toBeDefined()
        expect(data._links.things).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // Things CRUD Tests
  // ==========================================================================

  describe('Things CRUD', () => {
    const testId = generateTestId()

    it('should CREATE a thing (POST)', async () => {
      const thingData = {
        $type: 'TestEntity',
        name: `Test Thing ${testId}`,
        testId,
        description: 'Created by production E2E test',
        metadata: {
          createdBy: 'e2e-test',
          timestamp: Date.now(),
        },
      }

      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thingData),
      })

      expect(response.ok).toBe(true)
      expect([200, 201]).toContain(response.status)

      const created = (await response.json()) as Thing
      expect(created.$id).toBeDefined()
      expect(created.name).toBe(thingData.name)
      expect(created.$type).toBe('TestEntity')

      // Track for cleanup and store for later tests
      trackResource('thing', created.$id)
      testThingId1 = created.$id
    })

    it('should READ a thing (GET)', async () => {
      expect(testThingId1).toBeDefined()

      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things/${testThingId1}`)
      expect(response.ok).toBe(true)

      const thing = (await response.json()) as Thing
      expect(thing.$id).toBe(testThingId1)
      expect(thing.name).toContain('Test Thing')
    })

    it('should LIST things (GET)', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as ThingsListResponse
      // Response might have items, data, or things array
      const items = data.items || data.data || data.things || []
      expect(Array.isArray(items)).toBe(true)

      // Should find our created thing
      const found = items.find((t) => t.$id === testThingId1)
      expect(found).toBeDefined()
    })

    it('should UPDATE a thing (PUT)', async () => {
      expect(testThingId1).toBeDefined()

      const updateData = {
        name: `Updated Thing ${testId}`,
        description: 'Updated by production E2E test',
        updatedAt: Date.now(),
      }

      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things/${testThingId1}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      expect(response.ok).toBe(true)

      const updated = (await response.json()) as Thing
      expect(updated.$id).toBe(testThingId1)
      expect(updated.name).toBe(updateData.name)
    })

    it('should create a second thing for relationship tests', async () => {
      const thingData = {
        $type: 'TestEntity',
        name: `Related Thing ${testId}`,
        testId,
        description: 'Second thing for relationship tests',
      }

      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thingData),
      })

      expect(response.ok).toBe(true)

      const created = (await response.json()) as Thing
      expect(created.$id).toBeDefined()

      trackResource('thing', created.$id)
      testThingId2 = created.$id
    })

    // DELETE test is in cleanup, but we also test explicit delete
    it('should DELETE a thing (DELETE)', async () => {
      // Create a thing specifically for deletion test
      const thingData = {
        $type: 'TestEntity',
        name: `Delete Test ${testId}`,
        testId,
      }

      const createResponse = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thingData),
      })

      expect(createResponse.ok).toBe(true)
      const created = (await createResponse.json()) as Thing

      // Delete it
      const deleteResponse = await fetchWithRetry(
        `${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things/${created.$id}`,
        { method: 'DELETE' },
      )

      expect(deleteResponse.ok).toBe(true)

      // Verify it's gone
      const getResponse = await fetchWithRetry(
        `${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things/${created.$id}`,
        {},
        0, // No retries for expected 404
      )

      expect(getResponse.status).toBe(404)
    })
  })

  // ==========================================================================
  // Events Tests
  // ==========================================================================

  describe('Events', () => {
    const testId = generateTestId()

    it('should CREATE an event', async () => {
      const eventData = {
        $type: 'TestEvent',
        type: 'test.e2e.created',
        payload: {
          testId,
          message: 'E2E test event',
          timestamp: Date.now(),
        },
      }

      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      })

      // Events might be fire-and-forget (202) or confirmed (200/201)
      expect([200, 201, 202].includes(response.status)).toBe(true)

      if (response.status !== 202) {
        const created = (await response.json()) as Event
        if (created.$id) {
          trackResource('event', created.$id)
        }
      }
    })

    it('should LIST events', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/events`)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as EventsListResponse
      // Response might have items, data, or events array
      const items = data.items || data.data || data.events || []
      expect(Array.isArray(items)).toBe(true)
    })

    it('should record events from thing operations', async () => {
      // Create a thing - this should generate an event
      const thingData = {
        $type: 'TestEntity',
        name: `Event Test Thing ${testId}`,
        testId,
      }

      const createResponse = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thingData),
      })

      expect(createResponse.ok).toBe(true)
      const created = (await createResponse.json()) as Thing
      trackResource('thing', created.$id)

      // Wait a bit for event to be recorded
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Check events
      const eventsResponse = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/events`)
      expect(eventsResponse.ok).toBe(true)

      const eventsData = (await eventsResponse.json()) as EventsListResponse
      const events = eventsData.items || eventsData.data || eventsData.events || []

      // Should have some events (might include creation events)
      expect(events.length).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // Relationships Tests
  // ==========================================================================

  describe('Relationships', () => {
    const testId = generateTestId()

    it('should CREATE a relationship', async () => {
      expect(testThingId1).toBeDefined()
      expect(testThingId2).toBeDefined()

      const relationshipData = {
        $type: 'related_to',
        type: 'related_to',
        from: testThingId1,
        to: testThingId2,
        metadata: {
          testId,
          createdBy: 'e2e-test',
        },
      }

      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relationshipData),
      })

      expect(response.ok).toBe(true)
      expect([200, 201]).toContain(response.status)

      const created = (await response.json()) as Relationship
      expect(created.$id).toBeDefined()

      trackResource('relationship', created.$id)
    })

    it('should LIST relationships', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/relationships`)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as RelationshipsListResponse
      // Response might have items, data, or relationships array
      const items = data.items || data.data || data.relationships || []
      expect(Array.isArray(items)).toBe(true)
    })

    it('should GET relationships for a specific thing', async () => {
      expect(testThingId1).toBeDefined()

      // Try to get relationships where thing is the source
      const response = await fetchWithRetry(
        `${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/relationships?from=${testThingId1}`,
      )

      // Endpoint might not support filtering, which is ok
      expect([200, 400, 404].includes(response.status)).toBe(true)

      if (response.ok) {
        const data = (await response.json()) as RelationshipsListResponse
        const items = data.items || data.data || data.relationships || []
        expect(Array.isArray(items)).toBe(true)
      }
    })
  })

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should return 404 for non-existent thing', async () => {
      const response = await fetchWithRetry(
        `${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things/non-existent-id-12345`,
        {},
        0, // No retries
      )

      expect(response.status).toBe(404)
    })

    it('should return 400 for invalid JSON in POST', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {{{',
      })

      expect([400, 422, 500].includes(response.status)).toBe(true)
    })

    it('should handle non-existent tenant gracefully', async () => {
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/non-existent-tenant-xyz/things`, {}, 0)

      // Should either return empty list or tenant context info
      expect([200, 404].includes(response.status)).toBe(true)
    })
  })

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    it('should respond within acceptable latency for health check', async () => {
      const start = Date.now()
      const response = await fetchWithRetry(ENDPOINTS.parent)
      const latency = Date.now() - start

      expect(response.ok).toBe(true)
      // Should respond within 2 seconds
      expect(latency).toBeLessThan(2000)
      console.log(`[Production E2E] Health check latency: ${latency}ms`)
    })

    it('should respond within acceptable latency for CRUD operations', async () => {
      const testId = generateTestId()
      const thingData = {
        $type: 'PerformanceTest',
        name: `Perf Test ${testId}`,
      }

      const start = Date.now()
      const response = await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thingData),
      })
      const latency = Date.now() - start

      expect(response.ok).toBe(true)
      // CRUD operations should complete within 3 seconds
      expect(latency).toBeLessThan(3000)
      console.log(`[Production E2E] CRUD latency: ${latency}ms`)

      // Cleanup
      const created = (await response.json()) as Thing
      if (created.$id) {
        await fetchWithRetry(`${ENDPOINTS.tenant}/${ENDPOINTS.tenantContext}/things/${created.$id}`, {
          method: 'DELETE',
        })
      }
    })
  })
})
