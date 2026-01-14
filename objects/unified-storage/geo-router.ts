/**
 * GeoRouter - Geo-aware routing for distributed replicas
 *
 * Routes requests to the nearest replica based on Cloudflare geo headers
 * to minimize latency. Supports multiple routing strategies:
 * - `nearest` - Closest by haversine distance
 * - `region-affinity` - Prefer same region
 * - `failover` - Fall back if primary unhealthy
 *
 * Integration:
 * - Wire into LeaderFollowerManager for read routing
 * - Wire into MultiMasterManager for geo-distributed writes
 *
 * @module unified-storage/geo-router
 */

import type { DurableObjectStub } from './shard-router'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Geographic information extracted from Cloudflare headers
 */
export interface GeoInfo {
  /** ISO 3166-1 alpha-2 country code */
  country?: string
  /** Continent code (AF, AN, AS, EU, NA, OC, SA) */
  continent?: string
  /** Region/state within country */
  region?: string
  /** City name */
  city?: string
  /** Latitude coordinate */
  latitude?: number
  /** Longitude coordinate */
  longitude?: number
  /** Cloudflare colo identifier */
  colo?: string
}

/**
 * Replica information for geo-routing
 */
export interface ReplicaInfo {
  /** Unique replica identifier */
  id: string
  /** Region identifier (e.g., 'us-east', 'eu-west', 'ap-southeast') */
  region: string
  /** Geographic coordinates for distance calculation */
  location?: { lat: number; lon: number }
  /** Replication role */
  role?: 'leader' | 'follower' | 'master'
  /** Durable Object stub for RPC */
  stub?: DurableObjectStub
}

/**
 * Routing strategy
 */
export type RoutingStrategy = 'nearest' | 'region-affinity' | 'failover'

/**
 * GeoRouter configuration
 */
export interface GeoRouterConfig {
  /** Available replicas */
  replicas: ReplicaInfo[]
  /** Default replica ID if no geo info available */
  defaultReplica?: string
  /** Prefer local reads when possible (default: true) */
  preferLocalReads?: boolean
  /** Routing strategy (default: 'nearest') */
  strategy?: RoutingStrategy
  /** Region to replica mappings for region-affinity */
  regionMappings?: Record<string, string[]>
  /** Failover order for failover strategy */
  failoverOrder?: string[]
}

/**
 * Resolved config with defaults
 */
export interface ResolvedGeoRouterConfig {
  readonly replicas: ReplicaInfo[]
  readonly defaultReplica: string | undefined
  readonly preferLocalReads: boolean
  readonly strategy: RoutingStrategy
  readonly regionMappings: Record<string, string[]>
  readonly failoverOrder: string[]
}

/**
 * Geo routing metrics
 */
export interface GeoRoutingMetrics {
  /** Total routing decisions made */
  routingDecisions: number
  /** Routes by replica ID */
  routesByReplica: Map<string, number>
  /** Routes by strategy result */
  routesByStrategy: Map<string, number>
  /** Failovers triggered */
  failoverCount: number
  /** Average distance to selected replica (km) */
  averageDistanceKm: number
  /** Routes where no geo info was available */
  noGeoInfoCount: number
}

/**
 * Replica health status
 */
export interface ReplicaHealth {
  id: string
  healthy: boolean
  lastCheck: number
  consecutiveFailures: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Region to approximate location mapping (centroids)
 */
const REGION_LOCATIONS: Record<string, { lat: number; lon: number }> = {
  // North America
  'us-east': { lat: 39.0, lon: -77.0 }, // Virginia
  'us-west': { lat: 37.4, lon: -122.0 }, // California
  'us-central': { lat: 41.9, lon: -87.6 }, // Chicago
  'ca-central': { lat: 43.7, lon: -79.4 }, // Toronto
  // Europe
  'eu-west': { lat: 53.3, lon: -6.3 }, // Ireland
  'eu-central': { lat: 50.1, lon: 8.7 }, // Frankfurt
  'eu-north': { lat: 59.3, lon: 18.1 }, // Stockholm
  'eu-south': { lat: 45.5, lon: 9.2 }, // Milan
  // Asia Pacific
  'ap-southeast': { lat: 1.3, lon: 103.8 }, // Singapore
  'ap-northeast': { lat: 35.7, lon: 139.7 }, // Tokyo
  'ap-south': { lat: 19.1, lon: 72.9 }, // Mumbai
  'ap-east': { lat: 22.3, lon: 114.2 }, // Hong Kong
  // South America
  'sa-east': { lat: -23.5, lon: -46.6 }, // Sao Paulo
  // Africa
  'af-south': { lat: -33.9, lon: 18.4 }, // Cape Town
  // Oceania
  'oc-southeast': { lat: -33.9, lon: 151.2 }, // Sydney
}

/**
 * Continent to preferred regions mapping
 */
const CONTINENT_REGIONS: Record<string, string[]> = {
  NA: ['us-east', 'us-west', 'us-central', 'ca-central'],
  SA: ['sa-east', 'us-east'],
  EU: ['eu-west', 'eu-central', 'eu-north', 'eu-south'],
  AF: ['af-south', 'eu-west'],
  AS: ['ap-southeast', 'ap-northeast', 'ap-south', 'ap-east'],
  OC: ['oc-southeast', 'ap-southeast'],
  AN: ['oc-southeast'], // Antarctica -> closest major region
}

/**
 * Earth radius in kilometers
 */
const EARTH_RADIUS_KM = 6371

// ============================================================================
// GEO ROUTER
// ============================================================================

/**
 * GeoRouter - Routes requests to nearest replica based on geographic location
 *
 * @example
 * ```typescript
 * const router = new GeoRouter({
 *   replicas: [
 *     { id: 'us-replica', region: 'us-east', role: 'leader' },
 *     { id: 'eu-replica', region: 'eu-west', role: 'follower' },
 *   ],
 *   defaultReplica: 'us-replica',
 * })
 *
 * const nearestReplica = router.getNearestReplica(request)
 * const readReplica = await router.routeRead(request)
 * const writeReplica = await router.routeWrite(request)
 * ```
 */
export class GeoRouter {
  private readonly _config: ResolvedGeoRouterConfig
  private readonly _replicaMap: Map<string, ReplicaInfo> = new Map()
  private readonly _healthStatus: Map<string, ReplicaHealth> = new Map()

  // Metrics
  private _routingDecisions = 0
  private _routesByReplica: Map<string, number> = new Map()
  private _routesByStrategy: Map<string, number> = new Map()
  private _failoverCount = 0
  private _totalDistanceKm = 0
  private _noGeoInfoCount = 0

  constructor(config: GeoRouterConfig) {
    // Resolve config with defaults
    this._config = Object.freeze({
      replicas: [...config.replicas],
      defaultReplica: config.defaultReplica,
      preferLocalReads: config.preferLocalReads ?? true,
      strategy: config.strategy ?? 'nearest',
      regionMappings: config.regionMappings ?? {},
      failoverOrder: config.failoverOrder ?? [],
    })

    // Build replica map and initialize health
    for (const replica of this._config.replicas) {
      this._replicaMap.set(replica.id, replica)
      this._healthStatus.set(replica.id, {
        id: replica.id,
        healthy: true,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
      })
    }
  }

  // ==========================================================================
  // PUBLIC GETTERS
  // ==========================================================================

  /**
   * Get the resolved configuration
   */
  get config(): ResolvedGeoRouterConfig {
    return this._config
  }

  /**
   * Get all replicas
   */
  getReplicas(): ReplicaInfo[] {
    return [...this._config.replicas]
  }

  /**
   * Get a specific replica by ID
   */
  getReplica(id: string): ReplicaInfo | undefined {
    return this._replicaMap.get(id)
  }

  /**
   * Get the leader replica
   */
  getLeader(): ReplicaInfo | undefined {
    return this._config.replicas.find((r) => r.role === 'leader')
  }

  /**
   * Get all follower replicas
   */
  getFollowers(): ReplicaInfo[] {
    return this._config.replicas.filter((r) => r.role === 'follower')
  }

  /**
   * Get all master replicas (for multi-master)
   */
  getMasters(): ReplicaInfo[] {
    return this._config.replicas.filter((r) => r.role === 'master')
  }

  // ==========================================================================
  // GEO EXTRACTION
  // ==========================================================================

  /**
   * Extract geo information from Cloudflare headers
   *
   * Cloudflare geo headers:
   * - cf-ipcountry: ISO 3166-1 alpha-2 country code
   * - cf-ipcontinent: Continent code
   * - cf-region: Region/state code
   * - cf-city: City name
   * - cf-latitude: Latitude
   * - cf-longitude: Longitude
   */
  extractGeo(request: Request): GeoInfo {
    const headers = request.headers

    const latitude = headers.get('cf-latitude')
    const longitude = headers.get('cf-longitude')

    return {
      country: headers.get('cf-ipcountry') ?? undefined,
      continent: headers.get('cf-ipcontinent') ?? undefined,
      region: headers.get('cf-region') ?? undefined,
      city: headers.get('cf-city') ?? undefined,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      colo: headers.get('cf-ray')?.split('-')[1] ?? undefined,
    }
  }

  // ==========================================================================
  // DISTANCE CALCULATION
  // ==========================================================================

  /**
   * Calculate haversine distance between client and replica in kilometers
   *
   * Uses the Haversine formula for great-circle distance
   */
  calculateDistance(clientGeo: GeoInfo, replica: ReplicaInfo): number {
    // Get client coordinates
    const clientLat = clientGeo.latitude
    const clientLon = clientGeo.longitude

    if (clientLat === undefined || clientLon === undefined) {
      // No client coordinates - use region-based estimation
      return this.estimateDistanceByRegion(clientGeo, replica)
    }

    // Get replica coordinates
    const replicaLocation = replica.location ?? REGION_LOCATIONS[replica.region]
    if (!replicaLocation) {
      // Unknown region - return max distance
      return Number.MAX_SAFE_INTEGER
    }

    // Haversine formula
    const lat1 = this.toRadians(clientLat)
    const lat2 = this.toRadians(replicaLocation.lat)
    const deltaLat = this.toRadians(replicaLocation.lat - clientLat)
    const deltaLon = this.toRadians(replicaLocation.lon - clientLon)

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return EARTH_RADIUS_KM * c
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180
  }

  /**
   * Estimate distance when client has no coordinates
   */
  private estimateDistanceByRegion(clientGeo: GeoInfo, replica: ReplicaInfo): number {
    // Try to find client region from continent
    const continent = clientGeo.continent
    if (!continent) {
      return Number.MAX_SAFE_INTEGER
    }

    // Get preferred regions for this continent
    const preferredRegions = CONTINENT_REGIONS[continent] ?? []

    // Check if replica is in a preferred region
    const replicaRegionIndex = preferredRegions.indexOf(replica.region)
    if (replicaRegionIndex >= 0) {
      // Return a pseudo-distance based on preference order
      // Lower index = closer (preferred)
      return replicaRegionIndex * 1000
    }

    // Replica not in preferred regions - estimate based on region centroids
    const clientCentroid = preferredRegions.length > 0 ? REGION_LOCATIONS[preferredRegions[0]] : undefined
    const replicaCentroid = REGION_LOCATIONS[replica.region]

    if (clientCentroid && replicaCentroid) {
      return this.calculateDistance(
        { latitude: clientCentroid.lat, longitude: clientCentroid.lon },
        { ...replica, location: replicaCentroid }
      )
    }

    return Number.MAX_SAFE_INTEGER
  }

  // ==========================================================================
  // ROUTING - CORE
  // ==========================================================================

  /**
   * Get the nearest replica for a request
   */
  getNearestReplica(request: Request): ReplicaInfo {
    const geo = this.extractGeo(request)
    return this.findNearestReplica(geo)
  }

  /**
   * Find nearest replica by geo info
   */
  private findNearestReplica(geo: GeoInfo, options?: { excludeUnhealthy?: boolean }): ReplicaInfo {
    this._routingDecisions++

    // Check if we have any geo info
    const hasGeoInfo = geo.latitude !== undefined || geo.longitude !== undefined || geo.continent !== undefined
    if (!hasGeoInfo) {
      this._noGeoInfoCount++
    }

    // Get available replicas
    let candidates = [...this._config.replicas]

    // Filter unhealthy if requested
    if (options?.excludeUnhealthy) {
      candidates = candidates.filter((r) => {
        const health = this._healthStatus.get(r.id)
        return health?.healthy !== false
      })
    }

    // If no candidates, fall back to all replicas
    if (candidates.length === 0) {
      candidates = [...this._config.replicas]
    }

    // If still no replicas, throw
    if (candidates.length === 0) {
      throw new Error('No replicas available')
    }

    // Route based on strategy
    let selected: ReplicaInfo

    switch (this._config.strategy) {
      case 'region-affinity':
        selected = this.routeByRegionAffinity(geo, candidates)
        break
      case 'failover':
        selected = this.routeByFailover(candidates)
        break
      case 'nearest':
      default:
        selected = this.routeByNearest(geo, candidates)
        break
    }

    // Update metrics
    this.updateMetrics(selected.id, this._config.strategy, geo)

    return selected
  }

  /**
   * Route by nearest distance
   */
  private routeByNearest(geo: GeoInfo, candidates: ReplicaInfo[]): ReplicaInfo {
    let nearest = candidates[0]
    let minDistance = this.calculateDistance(geo, nearest)

    for (let i = 1; i < candidates.length; i++) {
      const distance = this.calculateDistance(geo, candidates[i])
      if (distance < minDistance) {
        minDistance = distance
        nearest = candidates[i]
      }
    }

    // Track distance for metrics
    if (minDistance < Number.MAX_SAFE_INTEGER) {
      this._totalDistanceKm += minDistance
    }

    return nearest
  }

  /**
   * Route by region affinity
   */
  private routeByRegionAffinity(geo: GeoInfo, candidates: ReplicaInfo[]): ReplicaInfo {
    // Try to match by continent first
    const continent = geo.continent
    if (continent) {
      // Check custom region mappings
      const customRegions = this._config.regionMappings[continent]
      if (customRegions) {
        for (const region of customRegions) {
          const match = candidates.find((c) => c.region === region)
          if (match) return match
        }
      }

      // Use default continent->region mapping
      const defaultRegions = CONTINENT_REGIONS[continent]
      if (defaultRegions) {
        for (const region of defaultRegions) {
          const match = candidates.find((c) => c.region === region)
          if (match) return match
        }
      }
    }

    // Fall back to nearest
    return this.routeByNearest(geo, candidates)
  }

  /**
   * Route by failover order
   */
  private routeByFailover(candidates: ReplicaInfo[]): ReplicaInfo {
    // Use explicit failover order if provided
    const failoverOrder = this._config.failoverOrder

    for (const replicaId of failoverOrder) {
      const replica = candidates.find((c) => c.id === replicaId)
      if (replica) {
        const health = this._healthStatus.get(replica.id)
        if (health?.healthy !== false) {
          return replica
        }
      }
    }

    // Fall back to first healthy candidate
    for (const candidate of candidates) {
      const health = this._healthStatus.get(candidate.id)
      if (health?.healthy !== false) {
        return candidate
      }
    }

    // All unhealthy - return first candidate (let it fail)
    this._failoverCount++
    return candidates[0]
  }

  // ==========================================================================
  // ROUTING - READ/WRITE
  // ==========================================================================

  /**
   * Route a read request to the nearest healthy replica
   *
   * For leader-follower: Routes to nearest follower if preferLocalReads
   * For multi-master: Routes to nearest master
   */
  async routeRead(request: Request): Promise<ReplicaInfo> {
    const geo = this.extractGeo(request)

    if (this._config.preferLocalReads) {
      // For leader-follower, prefer followers for reads
      const followers = this.getFollowers()
      if (followers.length > 0) {
        return this.findNearestReplica(geo, { excludeUnhealthy: true })
      }

      // For multi-master, any master works
      const masters = this.getMasters()
      if (masters.length > 0) {
        return this.findNearestReplica(geo, { excludeUnhealthy: true })
      }
    }

    // Fall back to nearest replica
    return this.findNearestReplica(geo, { excludeUnhealthy: true })
  }

  /**
   * Route a write request to the appropriate replica
   *
   * For leader-follower: Routes to leader
   * For multi-master: Routes to nearest master
   */
  async routeWrite(request: Request): Promise<ReplicaInfo> {
    // Check for leader (leader-follower mode)
    const leader = this.getLeader()
    if (leader) {
      // Writes must go to leader
      return leader
    }

    // Multi-master mode - route to nearest healthy master
    const geo = this.extractGeo(request)
    const masters = this.getMasters()

    if (masters.length > 0) {
      // Find nearest healthy master
      let nearestMaster = masters[0]
      let minDistance = this.calculateDistance(geo, nearestMaster)

      for (let i = 1; i < masters.length; i++) {
        const health = this._healthStatus.get(masters[i].id)
        if (health?.healthy === false) continue

        const distance = this.calculateDistance(geo, masters[i])
        if (distance < minDistance) {
          minDistance = distance
          nearestMaster = masters[i]
        }
      }

      return nearestMaster
    }

    // No leader or masters - fall back to nearest
    return this.findNearestReplica(geo, { excludeUnhealthy: true })
  }

  // ==========================================================================
  // HEALTH MANAGEMENT
  // ==========================================================================

  /**
   * Update replica health status
   */
  updateReplicaHealth(id: string, healthy: boolean): void {
    const health = this._healthStatus.get(id)
    if (!health) return

    const previousHealthy = health.healthy

    health.healthy = healthy
    health.lastCheck = Date.now()

    if (healthy) {
      health.consecutiveFailures = 0
    } else {
      health.consecutiveFailures++
    }

    // Track failover if health changed from healthy to unhealthy
    if (previousHealthy && !healthy) {
      this._failoverCount++
    }
  }

  /**
   * Get replica health status
   */
  getReplicaHealth(id: string): ReplicaHealth | undefined {
    return this._healthStatus.get(id)
  }

  /**
   * Get all healthy replicas
   */
  getHealthyReplicas(): ReplicaInfo[] {
    return this._config.replicas.filter((r) => {
      const health = this._healthStatus.get(r.id)
      return health?.healthy !== false
    })
  }

  /**
   * Get all unhealthy replicas
   */
  getUnhealthyReplicas(): ReplicaInfo[] {
    return this._config.replicas.filter((r) => {
      const health = this._healthStatus.get(r.id)
      return health?.healthy === false
    })
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  /**
   * Update metrics after routing decision
   */
  private updateMetrics(replicaId: string, strategy: string, geo: GeoInfo): void {
    // Routes by replica
    const replicaCount = this._routesByReplica.get(replicaId) ?? 0
    this._routesByReplica.set(replicaId, replicaCount + 1)

    // Routes by strategy
    const strategyCount = this._routesByStrategy.get(strategy) ?? 0
    this._routesByStrategy.set(strategy, strategyCount + 1)

    // No geo info count tracked in findNearestReplica
  }

  /**
   * Get routing metrics
   */
  getMetrics(): GeoRoutingMetrics {
    const decisionsWithDistance = this._routingDecisions - this._noGeoInfoCount
    const avgDistance = decisionsWithDistance > 0 ? this._totalDistanceKm / decisionsWithDistance : 0

    return {
      routingDecisions: this._routingDecisions,
      routesByReplica: new Map(this._routesByReplica),
      routesByStrategy: new Map(this._routesByStrategy),
      failoverCount: this._failoverCount,
      averageDistanceKm: avgDistance,
      noGeoInfoCount: this._noGeoInfoCount,
    }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this._routingDecisions = 0
    this._routesByReplica.clear()
    this._routesByStrategy.clear()
    this._failoverCount = 0
    this._totalDistanceKm = 0
    this._noGeoInfoCount = 0
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a GeoRouter from LeaderFollowerManager configuration
 */
export function createGeoRouterForLeaderFollower(
  leader: ReplicaInfo,
  followers: ReplicaInfo[],
  options?: Partial<GeoRouterConfig>
): GeoRouter {
  return new GeoRouter({
    replicas: [leader, ...followers],
    defaultReplica: leader.id,
    preferLocalReads: true,
    strategy: 'nearest',
    ...options,
  })
}

/**
 * Create a GeoRouter from MultiMasterManager configuration
 */
export function createGeoRouterForMultiMaster(
  masters: ReplicaInfo[],
  options?: Partial<GeoRouterConfig>
): GeoRouter {
  return new GeoRouter({
    replicas: masters,
    defaultReplica: masters[0]?.id,
    preferLocalReads: true,
    strategy: 'nearest',
    ...options,
  })
}
