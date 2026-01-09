/**
 * Core types for the compat layer
 *
 * Defines configuration types for DO-backed database adapters:
 * - Placement: Jurisdiction, Region, City
 * - ShardConfig: DO sharding configuration
 * - ReplicaConfig: Geo-distribution and placement
 * - StreamConfig: Pipeline/analytics sink configuration
 * - TierConfig: Hot/warm/cold data tiering
 * - VectorConfig: Pluggable vector search tiers
 * - ExtendedConfig: Combined config for SDK clients
 */

// ============================================================================
// PLACEMENT TYPES
// ============================================================================

/**
 * Data sovereignty jurisdictions (guaranteed placement)
 * Cloudflare provides hard guarantees for these
 */
export type Jurisdiction = 'eu' | 'us' | 'fedramp'

/**
 * AWS-style region names (location hint)
 * Used as hints for DO placement via locationHint
 */
export type Region =
  | 'us-east-1'
  | 'us-east-2'
  | 'us-west-1'
  | 'us-west-2'
  | 'eu-west-1'
  | 'eu-west-2'
  | 'eu-west-3'
  | 'eu-central-1'
  | 'eu-north-1'
  | 'ap-northeast-1'
  | 'ap-northeast-2'
  | 'ap-northeast-3'
  | 'ap-southeast-1'
  | 'ap-southeast-2'
  | 'ap-south-1'
  | 'sa-east-1'
  | 'ca-central-1'
  | 'me-south-1'
  | 'af-south-1'
  | 'us-gov-west-1'
  | 'us-gov-east-1'

/**
 * IATA airport codes for colo-level placement (guaranteed via colo.do)
 * 3-letter codes for direct DO creation in specific cities
 */
export type City =
  | 'iad' // Washington DC
  | 'dfw' // Dallas
  | 'sea' // Seattle
  | 'lax' // Los Angeles
  | 'sfo' // San Francisco
  | 'ord' // Chicago
  | 'atl' // Atlanta
  | 'mia' // Miami
  | 'den' // Denver
  | 'bos' // Boston
  | 'ewr' // Newark
  | 'lhr' // London
  | 'cdg' // Paris
  | 'fra' // Frankfurt
  | 'ams' // Amsterdam
  | 'dub' // Dublin
  | 'mad' // Madrid
  | 'mxp' // Milan
  | 'zrh' // Zurich
  | 'arn' // Stockholm
  | 'hel' // Helsinki
  | 'waw' // Warsaw
  | 'nrt' // Tokyo
  | 'hnd' // Tokyo Haneda
  | 'sin' // Singapore
  | 'hkg' // Hong Kong
  | 'icn' // Seoul
  | 'syd' // Sydney
  | 'mel' // Melbourne
  | 'bom' // Mumbai
  | 'del' // Delhi
  | 'gru' // Sao Paulo
  | 'jnb' // Johannesburg
  | 'dxb' // Dubai
  | 'tlv' // Tel Aviv

/**
 * Map regions to their primary colo code
 */
export const REGION_TO_COLO: Record<Region, City> = {
  'us-east-1': 'iad',
  'us-east-2': 'ord',
  'us-west-1': 'sfo',
  'us-west-2': 'sea',
  'eu-west-1': 'dub',
  'eu-west-2': 'lhr',
  'eu-west-3': 'cdg',
  'eu-central-1': 'fra',
  'eu-north-1': 'arn',
  'ap-northeast-1': 'nrt',
  'ap-northeast-2': 'icn',
  'ap-northeast-3': 'nrt', // Osaka maps to Tokyo
  'ap-southeast-1': 'sin',
  'ap-southeast-2': 'syd',
  'ap-south-1': 'bom',
  'sa-east-1': 'gru',
  'ca-central-1': 'ord', // Canada maps to Chicago
  'me-south-1': 'dxb',
  'af-south-1': 'jnb',
  'us-gov-west-1': 'sea',
  'us-gov-east-1': 'iad',
}

/**
 * Map jurisdictions to allowed regions
 */
export const JURISDICTION_REGIONS: Record<Jurisdiction, Region[]> = {
  eu: [
    'eu-west-1',
    'eu-west-2',
    'eu-west-3',
    'eu-central-1',
    'eu-north-1',
  ],
  us: [
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'ca-central-1',
  ],
  fedramp: [
    'us-gov-west-1',
    'us-gov-east-1',
  ],
}

// ============================================================================
// VALIDATORS
// ============================================================================

const VALID_JURISDICTIONS = new Set<string>(['eu', 'us', 'fedramp'])
const VALID_REGIONS = new Set<string>(Object.keys(REGION_TO_COLO))

/**
 * All valid IATA city codes from the City type
 * This is the single source of truth for city validation
 */
const VALID_CITIES = new Set<string>([
  // US cities
  'iad', 'dfw', 'sea', 'lax', 'sfo', 'ord', 'atl', 'mia', 'den', 'bos', 'ewr',
  // European cities
  'lhr', 'cdg', 'fra', 'ams', 'dub', 'mad', 'mxp', 'zrh', 'arn', 'hel', 'waw',
  // Asian cities
  'nrt', 'hnd', 'sin', 'hkg', 'icn',
  // Australian cities
  'syd', 'mel',
  // Indian cities
  'bom', 'del',
  // South American cities
  'gru',
  // African cities
  'jnb',
  // Middle Eastern cities
  'dxb', 'tlv',
])

/**
 * Validate jurisdiction
 */
export function isValidJurisdiction(value: unknown): value is Jurisdiction {
  return typeof value === 'string' && VALID_JURISDICTIONS.has(value)
}

/**
 * Validate region (AWS-style names only)
 */
export function isValidRegion(value: unknown): value is Region {
  return typeof value === 'string' && VALID_REGIONS.has(value)
}

/**
 * Validate city (3-letter IATA codes)
 */
export function isValidCity(value: unknown): value is City {
  return typeof value === 'string' && VALID_CITIES.has(value)
}

// ============================================================================
// SHARD CONFIG
// ============================================================================

/**
 * Sharding algorithm
 * - consistent: Consistent hashing (good for dynamic scaling)
 * - range: Range-based partitioning (good for ordered queries)
 * - hash: Simple hash modulo (good for uniform distribution)
 */
export type ShardAlgorithm = 'consistent' | 'range' | 'hash'

/**
 * Configuration for DO sharding (10GB per DO limit)
 */
export interface ShardConfig {
  /** Field to shard on (e.g., 'tenant_id', 'user_id') */
  key: string
  /** Number of shards */
  count: number
  /** Sharding algorithm */
  algorithm: ShardAlgorithm
}

/**
 * Default shard configuration
 */
export const DEFAULT_SHARD_CONFIG: ShardConfig = {
  key: 'id',
  count: 1,
  algorithm: 'consistent',
}

const VALID_SHARD_ALGORITHMS = new Set<string>(['consistent', 'range', 'hash'])

/**
 * Validate shard configuration
 */
export function isValidShardConfig(config: unknown): config is ShardConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // Key must be non-empty string
  if (typeof c.key !== 'string' || c.key === '') return false

  // Count must be positive integer
  if (typeof c.count !== 'number' || c.count <= 0 || !Number.isInteger(c.count)) return false

  // Algorithm must be valid
  if (typeof c.algorithm !== 'string' || !VALID_SHARD_ALGORITHMS.has(c.algorithm)) return false

  return true
}

// ============================================================================
// REPLICA CONFIG
// ============================================================================

/**
 * Read preference for replicated data
 * - nearest: Read from geographically closest replica
 * - primary: Always read from primary (strong consistency)
 * - secondary: Prefer secondary replicas (lower latency, eventual consistency)
 */
export type ReadPreference = 'nearest' | 'primary' | 'secondary'

/**
 * Configuration for geo-distribution and replication
 */
export interface ReplicaConfig {
  /** Data sovereignty jurisdiction (guaranteed) */
  jurisdiction?: Jurisdiction
  /** Preferred regions (location hints) */
  regions?: Region[]
  /** Specific cities (guaranteed via colo.do) */
  cities?: City[]
  /** Read routing preference */
  readFrom: ReadPreference
  /** Write to all replicas synchronously */
  writeThrough?: boolean
}

/**
 * Default replica configuration
 */
export const DEFAULT_REPLICA_CONFIG: Pick<ReplicaConfig, 'readFrom' | 'writeThrough'> = {
  readFrom: 'nearest',
  writeThrough: true,
}

const VALID_READ_PREFERENCES = new Set<string>(['nearest', 'primary', 'secondary'])

/**
 * Validate replica configuration
 */
export function isValidReplicaConfig(config: unknown): config is ReplicaConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // readFrom must be valid
  if (typeof c.readFrom !== 'string' || !VALID_READ_PREFERENCES.has(c.readFrom)) return false

  // Validate jurisdiction if provided
  if (c.jurisdiction !== undefined && !isValidJurisdiction(c.jurisdiction)) return false

  // Validate regions if provided
  if (c.regions !== undefined) {
    if (!Array.isArray(c.regions)) return false
    for (const region of c.regions) {
      if (!isValidRegion(region)) return false
    }
  }

  // Validate cities if provided
  if (c.cities !== undefined) {
    if (!Array.isArray(c.cities)) return false
    for (const city of c.cities) {
      if (!isValidCity(city)) return false
    }
  }

  return true
}

// ============================================================================
// STREAM CONFIG
// ============================================================================

/**
 * Analytics sink format
 * - iceberg: Apache Iceberg tables
 * - parquet: Parquet files
 * - json: JSON lines
 */
export type StreamSink = 'iceberg' | 'parquet' | 'json'

/**
 * Configuration for Cloudflare Pipelines integration
 */
export interface StreamConfig {
  /** Pipeline binding name */
  pipeline?: string
  /** Output format/sink */
  sink: StreamSink
  /** Transform function applied before sending */
  transform?: (event: unknown) => unknown
  /** Batch size before flush */
  batchSize?: number
  /** Flush interval in ms */
  flushInterval?: number
}

/**
 * Default stream configuration
 */
export const DEFAULT_STREAM_CONFIG: Pick<StreamConfig, 'sink' | 'batchSize' | 'flushInterval'> = {
  sink: 'iceberg',
  batchSize: 1000,
  flushInterval: 60000,
}

const VALID_SINKS = new Set<string>(['iceberg', 'parquet', 'json'])

/**
 * Validate stream configuration
 */
export function isValidStreamConfig(config: unknown): config is StreamConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // Sink must be valid if provided
  if (c.sink !== undefined && (typeof c.sink !== 'string' || !VALID_SINKS.has(c.sink))) return false

  // Pipeline must be non-empty string if provided
  if (c.pipeline !== undefined && (typeof c.pipeline !== 'string' || c.pipeline === '')) return false

  // Batch size must be positive if provided
  if (c.batchSize !== undefined && (typeof c.batchSize !== 'number' || c.batchSize <= 0)) return false

  // Flush interval must be positive if provided
  if (c.flushInterval !== undefined && (typeof c.flushInterval !== 'number' || c.flushInterval <= 0)) return false

  return true
}

// ============================================================================
// TIER CONFIG
// ============================================================================

/**
 * Storage tier
 * - sqlite: DO SQLite (hot, fast, limited)
 * - r2: R2 object storage (warm, larger)
 * - archive: R2 Archive (cold, cheapest)
 */
export type StorageTier = 'sqlite' | 'r2' | 'archive'

/**
 * Size threshold format (e.g., '1GB', '500MB', '100KB')
 */
const SIZE_PATTERN = /^\d+(?:\.\d+)?(KB|MB|GB|TB)$/i

/**
 * Duration format (e.g., '30d', '24h', '60m')
 */
const DURATION_PATTERN = /^\d+[dhms]$/i

/**
 * Configuration for tiered data storage
 */
export interface TierConfig {
  /** Hot tier storage */
  hot?: StorageTier
  /** Warm tier storage */
  warm?: StorageTier
  /** Cold tier storage */
  cold?: StorageTier
  /** Size threshold to move from hot to warm */
  hotThreshold?: string
  /** Time after which data moves to cold */
  coldAfter?: string
}

/**
 * Default tier configuration
 */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  hot: 'sqlite',
  warm: 'r2',
  cold: 'archive',
  hotThreshold: '1GB',
  coldAfter: '90d',
}

const VALID_TIERS = new Set<string>(['sqlite', 'r2', 'archive'])

/**
 * Validate tier configuration
 */
export function isValidTierConfig(config: unknown): config is TierConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // Validate storage tiers if provided
  if (c.hot !== undefined && (typeof c.hot !== 'string' || !VALID_TIERS.has(c.hot))) return false
  if (c.warm !== undefined && (typeof c.warm !== 'string' || !VALID_TIERS.has(c.warm))) return false
  if (c.cold !== undefined && (typeof c.cold !== 'string' || !VALID_TIERS.has(c.cold))) return false

  // Validate hotThreshold format if provided
  if (c.hotThreshold !== undefined) {
    if (typeof c.hotThreshold !== 'string' || !SIZE_PATTERN.test(c.hotThreshold)) return false
  }

  // Validate coldAfter format if provided
  if (c.coldAfter !== undefined) {
    if (typeof c.coldAfter !== 'string' || !DURATION_PATTERN.test(c.coldAfter)) return false
  }

  return true
}

// ============================================================================
// VECTOR CONFIG
// ============================================================================

/**
 * Vector search engine
 * - libsql: libSQL native F32_BLOB vectors
 * - edgevec: EdgeVec WASM HNSW via Workers RPC
 * - vectorize: Cloudflare Vectorize
 * - clickhouse: ClickHouse ANN indexes
 * - iceberg: Iceberg Parquet with vector columns
 */
export type VectorEngineType = 'libsql' | 'edgevec' | 'vectorize' | 'clickhouse' | 'iceberg'

/**
 * ClickHouse ANN index type
 */
export type ClickHouseIndex = 'usearch' | 'annoy' | 'hnsw'

/**
 * Vector routing strategy
 * - cascade: Try hot first, fall back to colder tiers
 * - parallel: Query all tiers simultaneously, merge results
 * - smart: Use query characteristics to pick best tier
 */
export type VectorRoutingStrategy = 'cascade' | 'parallel' | 'smart'

/**
 * Configuration for a single vector tier
 */
export interface VectorTierConfig {
  /** Engine to use */
  engine: VectorEngineType
  /** Vector dimensions */
  dimensions: number
  /** ClickHouse-specific index type */
  index?: ClickHouseIndex
  /** Metric type (default: cosine) */
  metric?: 'cosine' | 'euclidean' | 'dot'
}

/**
 * Vector routing configuration
 */
export interface VectorRoutingConfig {
  /** Routing strategy */
  strategy: VectorRoutingStrategy
  /** Fall back to next tier on no results */
  fallback?: boolean
  /** Rerank results from parallel queries */
  rerank?: boolean
}

/**
 * Configuration for pluggable vector search
 */
export interface VectorConfig {
  /** Tiered vector engines */
  tiers: {
    hot?: VectorTierConfig
    warm?: VectorTierConfig
    cold?: VectorTierConfig
  }
  /** Routing configuration */
  routing: VectorRoutingConfig
}

/**
 * Default vector configuration
 */
export const DEFAULT_VECTOR_CONFIG: VectorConfig = {
  tiers: {
    hot: { engine: 'libsql', dimensions: 128 },
  },
  routing: { strategy: 'cascade' },
}

const VALID_ENGINES = new Set<string>(['libsql', 'edgevec', 'vectorize', 'clickhouse', 'iceberg'])
const VALID_STRATEGIES = new Set<string>(['cascade', 'parallel', 'smart'])
const VALID_CLICKHOUSE_INDEXES = new Set<string>(['usearch', 'annoy', 'hnsw'])

/**
 * Validate vector tier configuration
 */
function isValidVectorTierConfig(config: unknown): config is VectorTierConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // Engine must be valid
  if (typeof c.engine !== 'string' || !VALID_ENGINES.has(c.engine)) return false

  // Dimensions must be positive
  if (typeof c.dimensions !== 'number' || c.dimensions <= 0) return false

  // ClickHouse index must be valid if provided
  if (c.index !== undefined && (typeof c.index !== 'string' || !VALID_CLICKHOUSE_INDEXES.has(c.index))) return false

  return true
}

/**
 * Validate vector configuration
 */
export function isValidVectorConfig(config: unknown): config is VectorConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // Tiers must exist and have at least one tier
  if (!c.tiers || typeof c.tiers !== 'object') return false
  const tiers = c.tiers as Record<string, unknown>
  const tierKeys = ['hot', 'warm', 'cold'].filter((k) => tiers[k] !== undefined)
  if (tierKeys.length === 0) return false

  // Validate each tier
  for (const key of tierKeys) {
    if (!isValidVectorTierConfig(tiers[key])) return false
  }

  // Routing must exist and have valid strategy
  if (!c.routing || typeof c.routing !== 'object') return false
  const routing = c.routing as Record<string, unknown>
  if (typeof routing.strategy !== 'string' || !VALID_STRATEGIES.has(routing.strategy)) return false

  return true
}

// ============================================================================
// EXTENDED CONFIG
// ============================================================================

/**
 * Extended configuration for SDK clients
 * Combines all DO-specific options that extend standard SDK configs
 */
export interface ExtendedConfig {
  /** Sharding configuration */
  shard?: ShardConfig
  /** Replication configuration */
  replica?: ReplicaConfig
  /** Stream/pipeline configuration */
  stream?: StreamConfig
  /** Tiered storage configuration */
  tier?: TierConfig
  /** Vector search configuration */
  vector?: VectorConfig
}
