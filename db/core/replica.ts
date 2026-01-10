/**
 * ReplicaManager - Geo-distribution and replication for the compat layer
 *
 * Handles DO placement and replication across:
 * - Jurisdictions: eu/us/fedramp (guaranteed data sovereignty)
 * - Regions: AWS-style names as location hints
 * - Cities: IATA codes via colo.do for precise placement
 *
 * @example
 * ```typescript
 * const manager = new ReplicaManager(env.DO, {
 *   jurisdiction: 'eu',           // GDPR compliance
 *   regions: ['eu-west-1', 'eu-central-1'],
 *   readFrom: 'nearest',
 *   writeThrough: true,
 * })
 *
 * // Read from nearest replica
 * const readStub = await manager.getReadStub('my-db')
 *
 * // Write through to all replicas
 * await manager.writeThroughAll('my-db', '/write', { body: data })
 * ```
 */
import type {
  ReplicaConfig,
  Region,
  City,
  Jurisdiction,
  ReadPreference,
} from './types'
import { DEFAULT_REPLICA_CONFIG, REGION_TO_COLO, JURISDICTION_REGIONS } from './types'

// ============================================================================
// REGION/COLO MAPPING
// ============================================================================

/**
 * Cloudflare location hint type (from workers types)
 */
type DurableObjectLocationHint = 'wnam' | 'enam' | 'sam' | 'weur' | 'eeur' | 'apac' | 'oc' | 'afr' | 'me'

const REGION_TO_LOCATION_HINT: Record<string, string> = {
  'us-east-1': 'enam',
  'us-east-2': 'enam',
  'us-west-1': 'wnam',
  'us-west-2': 'wnam',
  'ca-central-1': 'enam',
  'eu-west-1': 'weur',
  'eu-west-2': 'weur',
  'eu-west-3': 'weur',
  'eu-central-1': 'weur',
  'eu-north-1': 'eeur',
  'ap-northeast-1': 'apac',
  'ap-northeast-2': 'apac',
  'ap-northeast-3': 'apac',
  'ap-southeast-1': 'apac',
  'ap-southeast-2': 'oc',
  'ap-south-1': 'apac',
  'sa-east-1': 'sam',
  'me-south-1': 'weur', // Middle East - closest hint
  'af-south-1': 'weur', // Africa - closest hint
  'us-gov-west-1': 'wnam',
  'us-gov-east-1': 'enam',
}

/**
 * Resolve colo code from AWS-style region
 */
export function resolveColoFromRegion(region: Region): City {
  return REGION_TO_COLO[region]
}

/**
 * Get the jurisdiction for a region
 */
export function getJurisdictionForRegion(region: Region): Jurisdiction | undefined {
  for (const [jurisdiction, regions] of Object.entries(JURISDICTION_REGIONS)) {
    if (regions.includes(region)) {
      return jurisdiction as Jurisdiction
    }
  }
  return undefined
}

/**
 * Check if a region is in a jurisdiction
 */
export function isRegionInJurisdiction(region: Region, jurisdiction: Jurisdiction): boolean {
  const regions = JURISDICTION_REGIONS[jurisdiction]
  return regions?.includes(region) ?? false
}

// ============================================================================
// PLACEMENT OPTIONS
// ============================================================================

/**
 * Options for DO placement
 */
export interface PlacementOptions {
  /** Data sovereignty jurisdiction (guaranteed) */
  jurisdiction?: Jurisdiction
  /** Cloudflare location hint */
  locationHint?: string
  /** City for colo.do placement */
  coloDo?: City
}

/**
 * Create placement options from replica config
 * Priority: city > region > jurisdiction
 */
export function createPlacementOptions(config: ReplicaConfig): PlacementOptions {
  const options: PlacementOptions = {}

  // Set jurisdiction if specified
  if (config.jurisdiction) {
    options.jurisdiction = config.jurisdiction
  }

  // Set location hint from first region
  if (config.regions && config.regions.length > 0) {
    const firstRegion = config.regions[0]
    options.locationHint = REGION_TO_LOCATION_HINT[firstRegion]
  }

  // Set colo.do city (highest priority)
  if (config.cities && config.cities.length > 0) {
    options.coloDo = config.cities[0]
  }

  return options
}

// ============================================================================
// WRITE RESULT
// ============================================================================

/**
 * Result from a write operation to a replica
 */
export interface WriteResult<T = unknown> {
  region?: Region
  city?: City
  primary: boolean
  data?: T
  error?: Error
}

// ============================================================================
// COLO BINDINGS TYPE
// ============================================================================

/**
 * Map of city codes to their DO namespaces
 * Used for colo.do pattern - precise city placement
 */
export type ColoBindings = Partial<Record<City, DurableObjectNamespace>>

// ============================================================================
// REPLICA MANAGER CLASS
// ============================================================================

/**
 * ReplicaManager - Manages geo-distributed DO replicas
 */
export class ReplicaManager {
  private namespace: DurableObjectNamespace
  private _config: ReplicaConfig
  private coloBindings?: ColoBindings

  constructor(
    namespace: DurableObjectNamespace,
    config?: Partial<ReplicaConfig>,
    coloBindings?: ColoBindings
  ) {
    this.namespace = namespace
    this._config = {
      ...DEFAULT_REPLICA_CONFIG,
      ...config,
    } as ReplicaConfig
    this.coloBindings = coloBindings
  }

  /**
   * Get the replica configuration
   */
  get config(): ReplicaConfig {
    return this._config
  }

  /**
   * Get number of replicas (regions or cities)
   */
  get replicaCount(): number {
    if (this._config.cities && this._config.cities.length > 0) {
      return this._config.cities.length
    }
    if (this._config.regions && this._config.regions.length > 0) {
      return this._config.regions.length
    }
    return 1 // Primary only
  }

  /**
   * Check if a region is valid for the configured jurisdiction
   */
  isValidRegion(region: Region): boolean {
    if (!this._config.jurisdiction) {
      return true // No jurisdiction constraint
    }
    return isRegionInJurisdiction(region, this._config.jurisdiction)
  }

  /**
   * Get DO options for placement
   */
  private getPlacementOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {}

    // Set jurisdiction constraint
    if (this._config.jurisdiction) {
      options.jurisdiction = this._config.jurisdiction
    }

    // Set location hint from first region
    if (this._config.regions && this._config.regions.length > 0) {
      const hint = REGION_TO_LOCATION_HINT[this._config.regions[0]]
      if (hint) {
        options.locationHint = hint
      }
    }

    return options
  }

  /**
   * Get the primary DO stub
   */
  async getPrimaryStub(name: string): Promise<DurableObjectStub> {
    const id = this.namespace.idFromName(`primary-${name}`)
    const options = this.getPlacementOptions()
    return this.namespace.get(id, options)
  }

  /**
   * Get a DO stub in a specific city (using colo.do pattern)
   */
  async getStubInCity(name: string, city: City): Promise<DurableObjectStub> {
    // If we have colo bindings, use them for precise placement
    if (this.coloBindings && this.coloBindings[city]) {
      const ns = this.coloBindings[city]!
      const id = ns.idFromName(`replica-${city}-${name}`)
      return ns.get(id)
    }

    // Fall back to regular namespace with location hint
    const colo = city
    const hint = Object.entries(REGION_TO_LOCATION_HINT).find(
      ([region]) => REGION_TO_COLO[region as Region] === colo
    )?.[1]

    const id = this.namespace.idFromName(`replica-${city}-${name}`)
    return this.namespace.get(id, hint ? { locationHint: hint as DurableObjectLocationHint } : undefined)
  }

  /**
   * Get a DO stub in a specific region
   */
  async getStubInRegion(name: string, region: Region): Promise<DurableObjectStub> {
    // Validate region against jurisdiction
    if (!this.isValidRegion(region)) {
      throw new Error(
        `Region ${region} is not allowed in jurisdiction ${this._config.jurisdiction}`
      )
    }

    const hint = REGION_TO_LOCATION_HINT[region]
    const id = this.namespace.idFromName(`replica-${region}-${name}`)
    return this.namespace.get(id, hint ? { locationHint: hint as DurableObjectLocationHint } : undefined)
  }

  /**
   * Get a read stub based on read preference
   */
  async getReadStub(name: string): Promise<DurableObjectStub> {
    switch (this._config.readFrom) {
      case 'primary':
        return this.getPrimaryStub(name)

      case 'secondary':
        // Prefer a secondary replica if available
        if (this._config.cities && this._config.cities.length > 1) {
          // Use second city as secondary
          return this.getStubInCity(name, this._config.cities[1])
        }
        if (this._config.regions && this._config.regions.length > 1) {
          // Use second region as secondary
          return this.getStubInRegion(name, this._config.regions[1])
        }
        // Fall back to primary
        return this.getPrimaryStub(name)

      case 'nearest':
      default:
        // For "nearest", we'd ideally use the request's cf.colo
        // For now, return primary (in production, use request context)
        return this.getPrimaryStub(name)
    }
  }

  /**
   * Get a write stub (always primary)
   */
  async getWriteStub(name: string): Promise<DurableObjectStub> {
    return this.getPrimaryStub(name)
  }

  /**
   * Get all replica stubs
   */
  async getAllReplicaStubs(name: string): Promise<DurableObjectStub[]> {
    const stubs: DurableObjectStub[] = []

    // Primary
    stubs.push(await this.getPrimaryStub(name))

    // Cities
    if (this._config.cities) {
      for (const city of this._config.cities) {
        try {
          stubs.push(await this.getStubInCity(name, city))
        } catch {
          // Skip cities we can't access
        }
      }
    }

    // Regions
    if (this._config.regions) {
      for (const region of this._config.regions) {
        try {
          stubs.push(await this.getStubInRegion(name, region))
        } catch {
          // Skip regions we can't access
        }
      }
    }

    return stubs
  }

  /**
   * Write through to all replicas (if enabled)
   *
   * @param name - DO name
   * @param path - Request path
   * @param init - Fetch init options
   * @returns Array of write results
   */
  async writeThroughAll<T = unknown>(
    name: string,
    path: string,
    init?: RequestInit
  ): Promise<WriteResult<T>[]> {
    const results: WriteResult<T>[] = []

    // Always write to primary
    const primaryStub = await this.getPrimaryStub(name)
    try {
      const response = await primaryStub.fetch(`http://replica${path}`, init)
      const data = await response.json() as T
      results.push({ primary: true, data })
    } catch (error) {
      results.push({
        primary: true,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }

    // If writeThrough is disabled, return just primary result
    if (!this._config.writeThrough) {
      return results
    }

    // Write to all replicas in parallel
    const replicaPromises: Promise<WriteResult<T>>[] = []

    // Cities
    if (this._config.cities) {
      for (const city of this._config.cities) {
        const promise = this.getStubInCity(name, city)
          .then((stub) => stub.fetch(`http://replica${path}`, init))
          .then(async (response) => {
            const data = await response.json() as T
            return { city, primary: false, data }
          })
          .catch((error) => ({
            city,
            primary: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }))
        replicaPromises.push(promise)
      }
    }

    // Regions
    if (this._config.regions) {
      for (const region of this._config.regions) {
        const promise = this.getStubInRegion(name, region)
          .then((stub) => stub.fetch(`http://replica${path}`, init))
          .then(async (response) => {
            const data = await response.json() as T
            return { region, primary: false, data }
          })
          .catch((error) => ({
            region,
            primary: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }))
        replicaPromises.push(promise)
      }
    }

    const replicaResults = await Promise.all(replicaPromises)
    results.push(...replicaResults)

    return results
  }
}
