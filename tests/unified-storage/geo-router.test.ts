/**
 * GeoRouter tests - Geo-aware routing for distributed replicas
 *
 * Tests cover:
 * - Nearest replica selection
 * - Region affinity routing
 * - Failover on unhealthy replica
 * - Write routing to leader
 * - Distance calculation
 * - Metrics tracking
 *
 * @see /objects/unified-storage/geo-router.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  GeoRouter,
  createGeoRouterForLeaderFollower,
  createGeoRouterForMultiMaster,
  type GeoRouterConfig,
  type ReplicaInfo,
  type GeoInfo,
} from '../../objects/unified-storage/geo-router'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock request with Cloudflare geo headers
 */
function createGeoRequest(geo: Partial<GeoInfo>): Request {
  const headers = new Headers()

  if (geo.country) headers.set('cf-ipcountry', geo.country)
  if (geo.continent) headers.set('cf-ipcontinent', geo.continent)
  if (geo.region) headers.set('cf-region', geo.region)
  if (geo.city) headers.set('cf-city', geo.city)
  if (geo.latitude !== undefined) headers.set('cf-latitude', geo.latitude.toString())
  if (geo.longitude !== undefined) headers.set('cf-longitude', geo.longitude.toString())
  if (geo.colo) headers.set('cf-ray', `abc123-${geo.colo}`)

  return new Request('https://example.com', { headers })
}

/**
 * Test replica configurations
 */
const TEST_REPLICAS: ReplicaInfo[] = [
  { id: 'us-east-1', region: 'us-east', location: { lat: 39.0, lon: -77.0 }, role: 'leader' },
  { id: 'us-west-1', region: 'us-west', location: { lat: 37.4, lon: -122.0 }, role: 'follower' },
  { id: 'eu-west-1', region: 'eu-west', location: { lat: 53.3, lon: -6.3 }, role: 'follower' },
  { id: 'ap-southeast-1', region: 'ap-southeast', location: { lat: 1.3, lon: 103.8 }, role: 'follower' },
]

const MULTI_MASTER_REPLICAS: ReplicaInfo[] = [
  { id: 'us-master', region: 'us-east', location: { lat: 39.0, lon: -77.0 }, role: 'master' },
  { id: 'eu-master', region: 'eu-west', location: { lat: 53.3, lon: -6.3 }, role: 'master' },
  { id: 'ap-master', region: 'ap-southeast', location: { lat: 1.3, lon: 103.8 }, role: 'master' },
]

// ============================================================================
// TESTS
// ============================================================================

describe('GeoRouter', () => {
  let router: GeoRouter

  afterEach(() => {
    router?.resetMetrics()
  })

  // ==========================================================================
  // CONSTRUCTOR AND CONFIG
  // ==========================================================================

  describe('constructor and config', () => {
    it('should create router with default config', () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
      })

      expect(router).toBeInstanceOf(GeoRouter)
      expect(router.config.preferLocalReads).toBe(true)
      expect(router.config.strategy).toBe('nearest')
    })

    it('should accept custom config', () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        defaultReplica: 'us-east-1',
        preferLocalReads: false,
        strategy: 'region-affinity',
      })

      expect(router.config.defaultReplica).toBe('us-east-1')
      expect(router.config.preferLocalReads).toBe(false)
      expect(router.config.strategy).toBe('region-affinity')
    })

    it('should expose replicas', () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      const replicas = router.getReplicas()
      expect(replicas).toHaveLength(4)
      expect(replicas.map((r) => r.id)).toEqual(['us-east-1', 'us-west-1', 'eu-west-1', 'ap-southeast-1'])
    })

    it('should get replica by ID', () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      const replica = router.getReplica('eu-west-1')
      expect(replica).toBeDefined()
      expect(replica?.region).toBe('eu-west')
    })

    it('should return undefined for unknown replica ID', () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      const replica = router.getReplica('unknown')
      expect(replica).toBeUndefined()
    })

    it('should get leader replica', () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      const leader = router.getLeader()
      expect(leader).toBeDefined()
      expect(leader?.id).toBe('us-east-1')
      expect(leader?.role).toBe('leader')
    })

    it('should get follower replicas', () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      const followers = router.getFollowers()
      expect(followers).toHaveLength(3)
      expect(followers.every((f) => f.role === 'follower')).toBe(true)
    })

    it('should get master replicas for multi-master', () => {
      router = new GeoRouter({ replicas: MULTI_MASTER_REPLICAS })

      const masters = router.getMasters()
      expect(masters).toHaveLength(3)
      expect(masters.every((m) => m.role === 'master')).toBe(true)
    })
  })

  // ==========================================================================
  // GEO EXTRACTION
  // ==========================================================================

  describe('geo extraction', () => {
    beforeEach(() => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })
    })

    it('should extract all geo info from Cloudflare headers', () => {
      const request = createGeoRequest({
        country: 'US',
        continent: 'NA',
        region: 'Virginia',
        city: 'Ashburn',
        latitude: 39.0481,
        longitude: -77.4728,
        colo: 'IAD',
      })

      const geo = router.extractGeo(request)

      expect(geo.country).toBe('US')
      expect(geo.continent).toBe('NA')
      expect(geo.region).toBe('Virginia')
      expect(geo.city).toBe('Ashburn')
      expect(geo.latitude).toBeCloseTo(39.0481, 4)
      expect(geo.longitude).toBeCloseTo(-77.4728, 4)
      expect(geo.colo).toBe('IAD')
    })

    it('should handle missing geo info', () => {
      const request = new Request('https://example.com')

      const geo = router.extractGeo(request)

      expect(geo.country).toBeUndefined()
      expect(geo.continent).toBeUndefined()
      expect(geo.latitude).toBeUndefined()
      expect(geo.longitude).toBeUndefined()
    })

    it('should handle partial geo info', () => {
      const request = createGeoRequest({
        country: 'DE',
        continent: 'EU',
      })

      const geo = router.extractGeo(request)

      expect(geo.country).toBe('DE')
      expect(geo.continent).toBe('EU')
      expect(geo.latitude).toBeUndefined()
      expect(geo.longitude).toBeUndefined()
    })
  })

  // ==========================================================================
  // DISTANCE CALCULATION
  // ==========================================================================

  describe('distance calculation', () => {
    beforeEach(() => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })
    })

    it('should calculate distance using haversine formula', () => {
      // New York to London is approximately 5,570 km
      const clientGeo: GeoInfo = {
        latitude: 40.7128,
        longitude: -74.006,
      }

      const londonReplica: ReplicaInfo = {
        id: 'london',
        region: 'eu-west',
        location: { lat: 51.5074, lon: -0.1278 },
      }

      const distance = router.calculateDistance(clientGeo, londonReplica)

      // Should be approximately 5,570 km (allow 50km margin for approximation)
      expect(distance).toBeGreaterThan(5500)
      expect(distance).toBeLessThan(5650)
    })

    it('should return 0 for same location', () => {
      const clientGeo: GeoInfo = {
        latitude: 39.0,
        longitude: -77.0,
      }

      // US-East replica is at same location
      const distance = router.calculateDistance(clientGeo, TEST_REPLICAS[0])

      expect(distance).toBe(0)
    })

    it('should calculate distance to antipodal points', () => {
      // Points on opposite sides of Earth should be ~20,000 km apart
      const clientGeo: GeoInfo = {
        latitude: 0,
        longitude: 0,
      }

      const antipodalReplica: ReplicaInfo = {
        id: 'antipodal',
        region: 'unknown',
        location: { lat: 0, lon: 180 },
      }

      const distance = router.calculateDistance(clientGeo, antipodalReplica)

      // Half Earth circumference is ~20,015 km
      expect(distance).toBeGreaterThan(19900)
      expect(distance).toBeLessThan(20100)
    })

    it('should estimate distance by region when no coordinates', () => {
      const clientGeo: GeoInfo = {
        continent: 'EU',
      }

      // Should prefer EU region
      const euDistance = router.calculateDistance(clientGeo, TEST_REPLICAS[2]) // eu-west
      const usDistance = router.calculateDistance(clientGeo, TEST_REPLICAS[0]) // us-east

      expect(euDistance).toBeLessThan(usDistance)
    })

    it('should return MAX_SAFE_INTEGER for unknown region without coords', () => {
      const clientGeo: GeoInfo = {}

      const unknownReplica: ReplicaInfo = {
        id: 'unknown',
        region: 'moon-base-alpha',
      }

      const distance = router.calculateDistance(clientGeo, unknownReplica)

      expect(distance).toBe(Number.MAX_SAFE_INTEGER)
    })
  })

  // ==========================================================================
  // NEAREST REPLICA SELECTION
  // ==========================================================================

  describe('nearest replica selection', () => {
    beforeEach(() => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'nearest',
      })
    })

    it('should select nearest replica by coordinates', () => {
      // Client in Virginia (near US-East)
      const request = createGeoRequest({
        latitude: 38.9,
        longitude: -77.0,
      })

      const nearest = router.getNearestReplica(request)

      expect(nearest.id).toBe('us-east-1')
    })

    it('should select EU replica for European client', () => {
      // Client in Dublin, Ireland
      const request = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      const nearest = router.getNearestReplica(request)

      expect(nearest.id).toBe('eu-west-1')
    })

    it('should select AP replica for Asian client', () => {
      // Client in Singapore
      const request = createGeoRequest({
        latitude: 1.35,
        longitude: 103.82,
      })

      const nearest = router.getNearestReplica(request)

      expect(nearest.id).toBe('ap-southeast-1')
    })

    it('should select US-West for California client', () => {
      // Client in San Francisco
      const request = createGeoRequest({
        latitude: 37.77,
        longitude: -122.42,
      })

      const nearest = router.getNearestReplica(request)

      expect(nearest.id).toBe('us-west-1')
    })

    it('should use continent fallback when no coordinates', () => {
      // European client without coordinates
      const request = createGeoRequest({
        continent: 'EU',
        country: 'DE',
      })

      const nearest = router.getNearestReplica(request)

      expect(nearest.id).toBe('eu-west-1')
    })

    it('should return first replica when no geo info', () => {
      const request = new Request('https://example.com')

      // Should still return something (uses MAX distance for all)
      const nearest = router.getNearestReplica(request)

      expect(nearest).toBeDefined()
      expect(TEST_REPLICAS.map((r) => r.id)).toContain(nearest.id)
    })
  })

  // ==========================================================================
  // REGION AFFINITY ROUTING
  // ==========================================================================

  describe('region affinity routing', () => {
    beforeEach(() => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'region-affinity',
      })
    })

    it('should prefer same continent replica', () => {
      // European client
      const request = createGeoRequest({
        continent: 'EU',
        country: 'FR',
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('eu-west-1')
    })

    it('should use custom region mappings', () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'region-affinity',
        regionMappings: {
          EU: ['us-east'], // Force EU to use US-East
        },
      })

      const request = createGeoRequest({
        continent: 'EU',
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('us-east-1')
    })

    it('should fall back to nearest if no region match', () => {
      // Client from Antarctica (no replicas in that region)
      const request = createGeoRequest({
        continent: 'AN',
        latitude: -75.0,
        longitude: 0.0,
      })

      const replica = router.getNearestReplica(request)

      // Should fall back to nearest by distance
      expect(replica).toBeDefined()
    })

    it('should handle South American clients', () => {
      const request = createGeoRequest({
        continent: 'SA',
        country: 'BR',
      })

      const replica = router.getNearestReplica(request)

      // South America prefers sa-east, us-east
      // Since we don't have sa-east, should get us-east
      expect(replica.id).toBe('us-east-1')
    })
  })

  // ==========================================================================
  // FAILOVER ROUTING
  // ==========================================================================

  describe('failover routing', () => {
    beforeEach(() => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'failover',
        failoverOrder: ['us-east-1', 'us-west-1', 'eu-west-1', 'ap-southeast-1'],
      })
    })

    it('should use first healthy replica in failover order', () => {
      const request = createGeoRequest({
        continent: 'EU', // Ignored in failover mode
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('us-east-1')
    })

    it('should skip unhealthy replicas', () => {
      // Mark first replica as unhealthy
      router.updateReplicaHealth('us-east-1', false)

      const request = createGeoRequest({})

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('us-west-1')
    })

    it('should skip multiple unhealthy replicas', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-west-1', false)

      const request = createGeoRequest({})

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('eu-west-1')
    })

    it('should return first replica if all unhealthy', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-west-1', false)
      router.updateReplicaHealth('eu-west-1', false)
      router.updateReplicaHealth('ap-southeast-1', false)

      const request = createGeoRequest({})

      const replica = router.getNearestReplica(request)

      // Should return first in failover order even if unhealthy
      expect(replica.id).toBe('us-east-1')
    })

    it('should track failover count in metrics', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-west-1', false)
      router.updateReplicaHealth('eu-west-1', false)
      router.updateReplicaHealth('ap-southeast-1', false)

      const request = createGeoRequest({})
      router.getNearestReplica(request)

      const metrics = router.getMetrics()
      expect(metrics.failoverCount).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // WRITE ROUTING
  // ==========================================================================

  describe('write routing', () => {
    it('should route writes to leader in leader-follower mode', async () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      // Even from Europe, writes go to leader
      const request = createGeoRequest({
        continent: 'EU',
        latitude: 53.35,
        longitude: -6.26,
      })

      const replica = await router.routeWrite(request)

      expect(replica.id).toBe('us-east-1')
      expect(replica.role).toBe('leader')
    })

    it('should route writes to nearest master in multi-master mode', async () => {
      router = new GeoRouter({ replicas: MULTI_MASTER_REPLICAS })

      // European client
      const request = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      const replica = await router.routeWrite(request)

      expect(replica.id).toBe('eu-master')
      expect(replica.role).toBe('master')
    })

    it('should skip unhealthy masters in multi-master', async () => {
      router = new GeoRouter({ replicas: MULTI_MASTER_REPLICAS })
      router.updateReplicaHealth('eu-master', false)

      // European client - should get US or AP master since EU is unhealthy
      const request = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      const replica = await router.routeWrite(request)

      expect(replica.id).not.toBe('eu-master')
      expect(replica.role).toBe('master')
    })
  })

  // ==========================================================================
  // READ ROUTING
  // ==========================================================================

  describe('read routing', () => {
    it('should route reads to nearest replica when preferLocalReads', async () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        preferLocalReads: true,
      })

      // European client
      const request = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      const replica = await router.routeRead(request)

      expect(replica.id).toBe('eu-west-1')
    })

    it('should exclude unhealthy replicas for reads', async () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        preferLocalReads: true,
      })

      router.updateReplicaHealth('eu-west-1', false)

      // European client - should get next nearest since EU is unhealthy
      const request = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      const replica = await router.routeRead(request)

      expect(replica.id).not.toBe('eu-west-1')
    })

    it('should route reads to nearest in multi-master mode', async () => {
      router = new GeoRouter({
        replicas: MULTI_MASTER_REPLICAS,
        preferLocalReads: true,
      })

      // Asian client
      const request = createGeoRequest({
        latitude: 1.35,
        longitude: 103.82,
      })

      const replica = await router.routeRead(request)

      expect(replica.id).toBe('ap-master')
    })
  })

  // ==========================================================================
  // HEALTH MANAGEMENT
  // ==========================================================================

  describe('health management', () => {
    beforeEach(() => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })
    })

    it('should initialize all replicas as healthy', () => {
      const health = router.getReplicaHealth('us-east-1')

      expect(health).toBeDefined()
      expect(health?.healthy).toBe(true)
      expect(health?.consecutiveFailures).toBe(0)
    })

    it('should update replica health status', () => {
      router.updateReplicaHealth('us-east-1', false)

      const health = router.getReplicaHealth('us-east-1')

      expect(health?.healthy).toBe(false)
      expect(health?.consecutiveFailures).toBe(1)
    })

    it('should track consecutive failures', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-east-1', false)

      const health = router.getReplicaHealth('us-east-1')

      expect(health?.consecutiveFailures).toBe(3)
    })

    it('should reset failures on recovery', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('us-east-1', true)

      const health = router.getReplicaHealth('us-east-1')

      expect(health?.healthy).toBe(true)
      expect(health?.consecutiveFailures).toBe(0)
    })

    it('should get healthy replicas', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('eu-west-1', false)

      const healthy = router.getHealthyReplicas()

      expect(healthy).toHaveLength(2)
      expect(healthy.map((r) => r.id)).toEqual(['us-west-1', 'ap-southeast-1'])
    })

    it('should get unhealthy replicas', () => {
      router.updateReplicaHealth('us-east-1', false)
      router.updateReplicaHealth('eu-west-1', false)

      const unhealthy = router.getUnhealthyReplicas()

      expect(unhealthy).toHaveLength(2)
      expect(unhealthy.map((r) => r.id)).toEqual(['us-east-1', 'eu-west-1'])
    })

    it('should return undefined for unknown replica health', () => {
      const health = router.getReplicaHealth('unknown-replica')

      expect(health).toBeUndefined()
    })
  })

  // ==========================================================================
  // METRICS
  // ==========================================================================

  describe('metrics tracking', () => {
    beforeEach(() => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'nearest',
      })
    })

    it('should track routing decisions', () => {
      const request = createGeoRequest({
        latitude: 39.0,
        longitude: -77.0,
      })

      router.getNearestReplica(request)
      router.getNearestReplica(request)
      router.getNearestReplica(request)

      const metrics = router.getMetrics()

      expect(metrics.routingDecisions).toBe(3)
    })

    it('should track routes by replica', () => {
      // US client
      const usRequest = createGeoRequest({
        latitude: 39.0,
        longitude: -77.0,
      })

      // EU client
      const euRequest = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      router.getNearestReplica(usRequest)
      router.getNearestReplica(usRequest)
      router.getNearestReplica(euRequest)

      const metrics = router.getMetrics()

      expect(metrics.routesByReplica.get('us-east-1')).toBe(2)
      expect(metrics.routesByReplica.get('eu-west-1')).toBe(1)
    })

    it('should track routes by strategy', () => {
      const request = createGeoRequest({
        latitude: 39.0,
        longitude: -77.0,
      })

      router.getNearestReplica(request)

      const metrics = router.getMetrics()

      expect(metrics.routesByStrategy.get('nearest')).toBe(1)
    })

    it('should track average distance', () => {
      // Client at exact replica location
      const request = createGeoRequest({
        latitude: 39.0,
        longitude: -77.0,
      })

      router.getNearestReplica(request)

      const metrics = router.getMetrics()

      expect(metrics.averageDistanceKm).toBe(0)
    })

    it('should track no geo info count', () => {
      const request = new Request('https://example.com')

      router.getNearestReplica(request)
      router.getNearestReplica(request)

      const metrics = router.getMetrics()

      expect(metrics.noGeoInfoCount).toBe(2)
    })

    it('should reset metrics', () => {
      const request = createGeoRequest({
        latitude: 39.0,
        longitude: -77.0,
      })

      router.getNearestReplica(request)
      router.getNearestReplica(request)

      router.resetMetrics()

      const metrics = router.getMetrics()

      expect(metrics.routingDecisions).toBe(0)
      expect(metrics.routesByReplica.size).toBe(0)
      expect(metrics.failoverCount).toBe(0)
    })
  })

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================

  describe('helper functions', () => {
    describe('createGeoRouterForLeaderFollower', () => {
      it('should create router with leader and followers', () => {
        const leader: ReplicaInfo = {
          id: 'leader',
          region: 'us-east',
          role: 'leader',
        }

        const followers: ReplicaInfo[] = [
          { id: 'follower-1', region: 'eu-west', role: 'follower' },
          { id: 'follower-2', region: 'ap-southeast', role: 'follower' },
        ]

        const router = createGeoRouterForLeaderFollower(leader, followers)

        expect(router.getReplicas()).toHaveLength(3)
        expect(router.getLeader()?.id).toBe('leader')
        expect(router.config.defaultReplica).toBe('leader')
        expect(router.config.preferLocalReads).toBe(true)
      })

      it('should accept custom options', () => {
        const leader: ReplicaInfo = {
          id: 'leader',
          region: 'us-east',
          role: 'leader',
        }

        const router = createGeoRouterForLeaderFollower(leader, [], {
          strategy: 'region-affinity',
        })

        expect(router.config.strategy).toBe('region-affinity')
      })
    })

    describe('createGeoRouterForMultiMaster', () => {
      it('should create router with masters', () => {
        const masters: ReplicaInfo[] = [
          { id: 'master-1', region: 'us-east', role: 'master' },
          { id: 'master-2', region: 'eu-west', role: 'master' },
        ]

        const router = createGeoRouterForMultiMaster(masters)

        expect(router.getReplicas()).toHaveLength(2)
        expect(router.getMasters()).toHaveLength(2)
        expect(router.config.defaultReplica).toBe('master-1')
      })

      it('should handle empty masters array', () => {
        const router = createGeoRouterForMultiMaster([])

        expect(router.getReplicas()).toHaveLength(0)
        expect(router.config.defaultReplica).toBeUndefined()
      })
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should throw when no replicas available', () => {
      router = new GeoRouter({ replicas: [] })

      const request = createGeoRequest({
        latitude: 39.0,
        longitude: -77.0,
      })

      expect(() => router.getNearestReplica(request)).toThrow('No replicas available')
    })

    it('should handle single replica', () => {
      router = new GeoRouter({
        replicas: [{ id: 'only-one', region: 'us-east' }],
      })

      const request = createGeoRequest({
        continent: 'EU',
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('only-one')
    })

    it('should handle replicas without location', () => {
      router = new GeoRouter({
        replicas: [
          { id: 'no-loc-1', region: 'us-east' },
          { id: 'no-loc-2', region: 'eu-west' },
        ],
      })

      // Uses default region locations
      const request = createGeoRequest({
        latitude: 53.35,
        longitude: -6.26,
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('no-loc-2')
    })

    it('should handle extreme latitudes', () => {
      router = new GeoRouter({
        replicas: [
          { id: 'north', region: 'eu-north', location: { lat: 90, lon: 0 } },
          { id: 'south', region: 'oc-southeast', location: { lat: -90, lon: 0 } },
        ],
      })

      // Client near north pole
      const request = createGeoRequest({
        latitude: 85,
        longitude: 0,
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('north')
    })

    it('should handle date line crossing', () => {
      router = new GeoRouter({
        replicas: [
          { id: 'east', region: 'ap-northeast', location: { lat: 35.7, lon: 139.7 } }, // Tokyo
          { id: 'west', region: 'us-west', location: { lat: 37.4, lon: -122.0 } }, // SF
        ],
      })

      // Client in New Zealand (near date line)
      const request = createGeoRequest({
        latitude: -41.3,
        longitude: 174.8,
      })

      const replica = router.getNearestReplica(request)

      // Should be closer to Tokyo
      expect(replica.id).toBe('east')
    })
  })

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle realistic global traffic pattern', async () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'nearest',
        preferLocalReads: true,
      })

      // Simulate traffic from different regions
      const regions = [
        { lat: 40.7, lon: -74.0, expected: 'us-east-1' }, // NYC
        { lat: 34.1, lon: -118.2, expected: 'us-west-1' }, // LA
        { lat: 51.5, lon: -0.1, expected: 'eu-west-1' }, // London
        { lat: 35.7, lon: 139.7, expected: 'ap-southeast-1' }, // Tokyo (closest to Singapore)
        { lat: 1.3, lon: 103.8, expected: 'ap-southeast-1' }, // Singapore
      ]

      for (const { lat, lon, expected } of regions) {
        const request = createGeoRequest({ latitude: lat, longitude: lon })
        const replica = await router.routeRead(request)
        expect(replica.id).toBe(expected)
      }
    })

    it('should handle failover during outage', async () => {
      router = new GeoRouter({
        replicas: TEST_REPLICAS,
        strategy: 'failover',
        failoverOrder: ['us-east-1', 'us-west-1', 'eu-west-1', 'ap-southeast-1'],
      })

      // Simulate US-East outage
      router.updateReplicaHealth('us-east-1', false)

      // All traffic should failover to US-West
      const request = createGeoRequest({
        latitude: 40.7,
        longitude: -74.0,
      })

      const replica = router.getNearestReplica(request)

      expect(replica.id).toBe('us-west-1')

      // Metrics should show failover
      const metrics = router.getMetrics()
      expect(metrics.failoverCount).toBeGreaterThanOrEqual(1)
    })

    it('should maintain write consistency in leader-follower', async () => {
      router = new GeoRouter({ replicas: TEST_REPLICAS })

      // Writes always go to leader regardless of location
      const locations = [
        { lat: 40.7, lon: -74.0 }, // NYC
        { lat: 51.5, lon: -0.1 }, // London
        { lat: 1.3, lon: 103.8 }, // Singapore
      ]

      for (const { lat, lon } of locations) {
        const request = createGeoRequest({ latitude: lat, longitude: lon })
        const replica = await router.routeWrite(request)
        expect(replica.id).toBe('us-east-1')
        expect(replica.role).toBe('leader')
      }
    })
  })
})
