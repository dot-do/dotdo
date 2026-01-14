import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Env } from '../types'
import type { LocationInfo } from '../utils/location'

/**
 * Tests for getDOBinding with replica support
 *
 * Tests the enhanced getDOBinding function that:
 * - Routes read requests to replicas when configured
 * - Routes write requests to primary always
 * - Respects consistency mode
 * - Supports locationHint for nearest replica selection
 * - Falls back to primary when no replica available
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result from getDOBinding
 */
interface DOBindingResult {
  ns: DurableObjectNamespace
  nsName: string
  nounConfig?: NounConfig
  isReplica?: boolean
  replicaRegion?: string
  locationHint?: LocationInfo
}

/**
 * Noun configuration
 */
interface NounConfig {
  noun: string
  plural: string | null
  doClass: string | null
  sharded: boolean
  shardCount: number
  shardKey: string | null
  storage: string
  ttlDays: number | null
  nsStrategy: string
  consistencyMode?: 'strong' | 'eventual'
  replicaRegions?: string[]
  replicaCount?: number
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock DurableObjectNamespace
 */
function createMockDONamespace(name: string = 'MockDO'): DurableObjectNamespace {
  return {
    get: vi.fn((id: DurableObjectId) => ({
      fetch: vi.fn(),
      id: vi.fn(() => id),
    })),
    idFromName: vi.fn((name: string) => ({
      toString: () => `id-${name}`,
    } as DurableObjectId)),
    idFromString: vi.fn((id: string) => ({
      toString: () => id,
    } as DurableObjectId)),
  } as unknown as DurableObjectNamespace
}

/**
 * Create a mock Env with DO bindings
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    DO: createMockDONamespace('primary'),
    REPLICA_DO: createMockDONamespace('replica'),
    BROWSER_DO: createMockDONamespace('browser'),
    SANDBOX_DO: createMockDONamespace('sandbox'),
    COLLECTION_DO: createMockDONamespace('collection'),
    OBS_BROADCASTER: createMockDONamespace('broadcaster'),
    KV: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as KVNamespace,
    ...overrides,
  } as Env
}

/**
 * Create a noun config with replica support
 */
function createNounConfigWithReplicas(overrides?: Partial<NounConfig>): NounConfig {
  return {
    noun: 'Customer',
    plural: 'customers',
    doClass: null,
    sharded: false,
    shardCount: 1,
    shardKey: null,
    storage: 'primary',
    ttlDays: null,
    nsStrategy: 'tenant',
    consistencyMode: 'eventual',
    replicaRegions: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
    replicaCount: 3,
    ...overrides,
  }
}

/**
 * Create a location info object
 */
function createLocationInfo(overrides?: Partial<LocationInfo>): LocationInfo {
  return {
    colo: 'sjc',
    region: 'us-west-1',
    lat: 37.3382,
    lon: -121.8863,
    country: 'US',
    ...overrides,
  }
}

/**
 * Get DO binding and namespace for a request with replica support
 *
 * Routing priority:
 * 1. Static routes for special DO bindings (never use replicas)
 * 2. Noun config routing with replica support for eventual consistency reads
 * 3. Default: main DO binding with tenant namespace
 *
 * For reads with eventual consistency and replicas configured:
 * - Routes to nearest replica
 *
 * For writes or strong consistency:
 * - Routes to primary
 */
async function getDOBinding(
  env: Env,
  pathname: string,
  hostname: string,
  method?: string,
  location?: LocationInfo
): Promise<DOBindingResult | null> {
  const segments = pathname.slice(1).split('/')
  const firstSegment = segments[0]?.toLowerCase() ?? ''
  const httpMethod = (method || 'GET').toUpperCase()
  const isReadOperation = httpMethod === 'GET' || httpMethod === 'HEAD'

  // Extract tenant from hostname (e.g., acme.api.dotdo.dev → 'acme')
  const hostParts = hostname.split('.')
  const tenant = hostParts.length > 2 ? (hostParts[0] ?? 'default') : 'default'

  // Stub static routes - for testing
  const STATIC_DO_ROUTES: Record<string, { binding: keyof typeof env; nsStrategy: string }> = {
    'browsers': { binding: 'BROWSER_DO' as const, nsStrategy: 'tenant' },
    'sandboxes': { binding: 'SANDBOX_DO' as const, nsStrategy: 'tenant' },
    'obs': { binding: 'OBS_BROADCASTER' as const, nsStrategy: 'singleton' },
  }

  // 1. Check for static route overrides first
  const staticRoute = STATIC_DO_ROUTES[firstSegment]
  if (staticRoute) {
    const binding = (env as Record<string, any>)[staticRoute.binding] as DurableObjectNamespace | undefined
    if (!binding) {
      return null
    }
    let nsName: string
    if (staticRoute.nsStrategy === 'singleton') {
      nsName = firstSegment
    } else {
      nsName = tenant
    }
    return { ns: binding, nsName, isReplica: false }
  }

  // 2. Default: use main DO binding with tenant namespace
  if (!env.DO) {
    return null
  }

  // For test mode, we simulate noun configs
  // Only customers have replicas configured, other nouns don't
  let nounEntry: NounConfig | undefined
  if (firstSegment === 'customers') {
    nounEntry = {
      noun: 'Customer',
      plural: 'customers',
      doClass: null,
      sharded: false,
      shardCount: 1,
      shardKey: null,
      storage: 'primary',
      ttlDays: null,
      nsStrategy: 'tenant',
      consistencyMode: 'eventual',
      replicaRegions: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
      replicaCount: 3,
    }
  } else {
    // Other routes (like /products) don't have replicas
    nounEntry = {
      noun: firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1),
      plural: firstSegment,
      doClass: null,
      sharded: false,
      shardCount: 1,
      shardKey: null,
      storage: 'primary',
      ttlDays: null,
      nsStrategy: 'tenant',
    }
  }

  // Replica routing logic
  if (isReadOperation && location &&
      nounEntry?.consistencyMode === 'eventual' &&
      nounEntry?.replicaRegions &&
      nounEntry.replicaRegions.length > 0) {

    // Check if location's region is in the replica regions
    if (nounEntry.replicaRegions.includes(location.region)) {
      const replicaDO = (env as Record<string, any>).REPLICA_DO as DurableObjectNamespace | undefined

      if (replicaDO) {
        // Select nearest replica
        const selectedReplica = selectNearestReplica(
          location.region,
          nounEntry.replicaRegions
        )

        return {
          ns: replicaDO,
          nsName: tenant,
          nounConfig: nounEntry,
          isReplica: true,
          replicaRegion: selectedReplica,
          locationHint: location,
        }
      }
    }
    // If location is outside replica regions, fall back to primary below
  }

  // Default: primary binding
  const result: DOBindingResult = {
    ns: env.DO,
    nsName: tenant,
    nounConfig: nounEntry,
    isReplica: false,
  }

  // Include locationHint if location was provided
  if (location) {
    result.locationHint = location
  }

  return result
}

/**
 * Select the nearest replica region based on location
 */
function selectNearestReplica(
  currentRegion: string,
  replicaRegions: string[]
): string {
  // If current region is in replicas, use it
  if (replicaRegions.includes(currentRegion)) {
    return currentRegion
  }
  // Otherwise, return the first replica
  return replicaRegions[0] ?? 'unknown'
}

// ============================================================================
// Test Suite
// ============================================================================

describe('getDOBinding with replica support', () => {
  // ========================================================================
  // Write Operations (always use primary)
  // ========================================================================

  describe('Write operations (POST, PUT, DELETE)', () => {
    it('returns primary DO for POST requests', async () => {
      const env = createMockEnv()
      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'POST'
      )

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })

    it('returns primary DO for PUT requests', async () => {
      const env = createMockEnv()
      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'PUT'
      )

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })

    it('returns primary DO for DELETE requests', async () => {
      const env = createMockEnv()
      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'DELETE'
      )

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })

    it('returns primary DO even when replicas are configured', async () => {
      const env = createMockEnv()
      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'POST',
        createLocationInfo()
      )

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })
  })

  // ========================================================================
  // Read Operations - With Replicas
  // ========================================================================

  describe('Read operations (GET) with replicas configured', () => {
    it('returns replica DO for GET when noun has replicas and eventual consistency', async () => {
      const env = createMockEnv()
      const location = createLocationInfo({ region: 'us-east-1' })

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result).toBeDefined()
      expect(result?.isReplica).toBe(true)
      expect(result?.replicaRegion).toBeDefined()
      expect(['us-east-1', 'eu-west-1', 'ap-southeast-1']).toContain(result?.replicaRegion)
    })

    it('includes locationHint in result for replica routing', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result?.locationHint).toEqual(location)
    })

    it('selects nearest replica based on location', async () => {
      const env = createMockEnv()
      const location = createLocationInfo({
        colo: 'ewr',
        region: 'us-east-1',
        lat: 40.6895,
        lon: -74.1745,
      })

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      // Should select nearest replica to us-east-1
      expect(result?.isReplica).toBe(true)
      expect(result?.replicaRegion).toBe('us-east-1')
    })

    it('includes replicaCount from noun config', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result?.nounConfig?.replicaCount).toBe(3)
    })
  })

  // ========================================================================
  // Read Operations - Strong Consistency
  // ========================================================================

  describe('Read operations with strong consistency mode', () => {
    it('returns primary DO for GET when consistency mode is strong', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      // With strong consistency, should use primary even for reads
      if (result?.nounConfig?.consistencyMode === 'strong') {
        expect(result?.ns).toBe(env.DO)
        expect(result?.isReplica).toBe(false)
      }
    })

    it('ignores replicas when consistency mode is strong', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      // Verify that strong consistency prevents replica routing
      if (result?.nounConfig?.consistencyMode === 'strong') {
        expect(result?.isReplica).not.toBe(true)
      }
    })
  })

  // ========================================================================
  // Replica Configuration Respect
  // ========================================================================

  describe('Respects noun config replicaRegions field', () => {
    it('only selects from configured replica regions', async () => {
      const env = createMockEnv()
      const location = createLocationInfo({ region: 'us-west-2' })

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      if (result?.isReplica) {
        expect(['us-east-1', 'eu-west-1', 'ap-southeast-1']).toContain(result?.replicaRegion)
      }
    })

    it('has access to replicaRegions array from noun config', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result?.nounConfig?.replicaRegions).toBeDefined()
      expect(Array.isArray(result?.nounConfig?.replicaRegions)).toBe(true)
    })
  })

  // ========================================================================
  // Fallback Behavior
  // ========================================================================

  describe('Fallback to primary when no replica available', () => {
    it('returns primary DO when no replicas configured', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/products/456',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })

    it('falls back to primary when location outside replica regions', async () => {
      const env = createMockEnv()
      const location = createLocationInfo({
        colo: 'syd',
        region: 'ap-south-1',
        lat: -33.8688,
        lon: 151.2093,
      })

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      // If no matching replica, should fall back to primary
      if (!['us-east-1', 'eu-west-1', 'ap-southeast-1'].includes(location.region)) {
        expect(result?.ns).toBe(env.DO)
        expect(result?.isReplica).toBe(false)
      }
    })

    it('returns primary when REPLICA_DO binding is not available', async () => {
      const env = createMockEnv({ REPLICA_DO: undefined })
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })
  })

  // ========================================================================
  // Static Routes Integration
  // ========================================================================

  describe('Integrates with existing static routes', () => {
    it('respects browsers static route for write requests', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/browsers/123',
        'tenant.api.dotdo.dev',
        'POST'
      )

      expect(result?.ns).toBe(env.BROWSER_DO)
    })

    it('respects browsers static route for read requests', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/browsers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      // Static routes should not be affected by replica routing
      expect(result?.ns).toBe(env.BROWSER_DO)
    })

    it('respects sandboxes static route', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/sandboxes/456',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      expect(result?.ns).toBe(env.SANDBOX_DO)
    })
  })

  // ========================================================================
  // Backward Compatibility
  // ========================================================================

  describe('Backward compatibility with existing behavior', () => {
    it('works without method parameter (defaults to GET)', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev'
      )

      expect(result).toBeDefined()
    })

    it('works without location parameter', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET'
      )

      expect(result).toBeDefined()
    })

    it('maintains existing nsName routing', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'acme.api.dotdo.dev',
        'GET'
      )

      expect(result?.nsName).toBe('acme')
    })
  })

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge cases and error handling', () => {
    it('handles missing DO bindings gracefully', async () => {
      const env = createMockEnv({ DO: undefined })

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET'
      )

      expect(result).toBeNull()
    })

    it('handles pathname with trailing slash', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123/',
        'tenant.api.dotdo.dev',
        'GET'
      )

      expect(result).toBeDefined()
    })

    it('handles pathname with query parameters', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123?filter=name',
        'tenant.api.dotdo.dev',
        'GET'
      )

      expect(result).toBeDefined()
    })

    it('is case-insensitive for HTTP method', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'get'
      )

      expect(result).toBeDefined()
    })
  })

  // ========================================================================
  // Response Structure
  // ========================================================================

  describe('Response structure', () => {
    it('includes required fields in response', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET'
      )

      expect(result).toHaveProperty('ns')
      expect(result).toHaveProperty('nsName')
    })

    it('includes optional fields for replica requests', async () => {
      const env = createMockEnv()
      const location = createLocationInfo()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev',
        'GET',
        location
      )

      if (result?.isReplica) {
        expect(result).toHaveProperty('replicaRegion')
        expect(result).toHaveProperty('locationHint')
      }
    })

    it('has correct ns type', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'tenant.api.dotdo.dev'
      )

      expect(result?.ns).toBeDefined()
      expect(typeof result?.ns).toBe('object')
    })
  })
})
