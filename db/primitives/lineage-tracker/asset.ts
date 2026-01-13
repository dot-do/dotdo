/**
 * Asset and Edge Data Model for Lineage Tracking
 *
 * This module provides URN-based asset identification and detailed edge modeling
 * for comprehensive data lineage tracking. It extends the core LineageTracker
 * with richer metadata support for data catalogs, impact analysis, and compliance.
 *
 * @module db/primitives/lineage-tracker/asset
 */

// =============================================================================
// URN TYPES
// =============================================================================

/**
 * URN scheme for asset identification
 * Format: {scheme}://{path}
 */
export type URNScheme = 'db' | 'file' | 'api' | 'pipeline' | 'warehouse' | 's3' | 'gcs' | 'kafka' | 'custom'

/**
 * Parsed URN structure
 * Example: db://postgres/public/users/email -> { scheme: 'db', authority: 'postgres', path: ['public', 'users', 'email'] }
 */
export interface ParsedURN {
  /** URI scheme (db, file, api, etc.) */
  scheme: URNScheme
  /** Authority/host component (database name, bucket, service name) */
  authority: string
  /** Path segments (schema, table, column, etc.) */
  path: string[]
  /** Original URN string */
  raw: string
}

/**
 * URN validation result
 */
export interface URNValidation {
  valid: boolean
  error?: string
  parsed?: ParsedURN
}

// =============================================================================
// ASSET TYPES
// =============================================================================

/**
 * Type of data asset in the lineage graph
 */
export type AssetType =
  | 'database'
  | 'schema'
  | 'table'
  | 'view'
  | 'column'
  | 'file'
  | 'directory'
  | 'api'
  | 'endpoint'
  | 'pipeline'
  | 'job'
  | 'dashboard'
  | 'report'
  | 'model'
  | 'dataset'

/**
 * Asset ownership information
 */
export interface AssetOwnership {
  /** Primary owner (team or individual) */
  owner?: string
  /** Steward responsible for data quality */
  steward?: string
  /** Team or department */
  team?: string
  /** Contact email */
  email?: string
}

/**
 * Schema information for structured assets (tables, columns)
 */
export interface AssetSchema {
  /** Data type (string, integer, timestamp, etc.) */
  dataType?: string
  /** Whether null values are allowed */
  nullable?: boolean
  /** Default value */
  defaultValue?: unknown
  /** Primary key flag */
  primaryKey?: boolean
  /** Foreign key reference */
  foreignKey?: {
    asset: string // URN of referenced asset
    column: string
  }
  /** Additional constraints */
  constraints?: string[]
}

/**
 * Tags for asset categorization and discovery
 */
export interface AssetTags {
  /** PII classification level */
  pii?: 'none' | 'low' | 'medium' | 'high' | 'critical'
  /** Data sensitivity level */
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted'
  /** Custom tags */
  custom?: string[]
  /** Data domains */
  domains?: string[]
}

/**
 * Quality metrics for an asset
 */
export interface AssetQuality {
  /** Data completeness (0-1) */
  completeness?: number
  /** Data freshness - timestamp of last update */
  freshness?: number
  /** Data accuracy score (0-1) */
  accuracy?: number
  /** Schema conformance (0-1) */
  conformance?: number
  /** Last quality check timestamp */
  lastChecked?: number
}

/**
 * A data asset in the lineage graph
 */
export interface Asset {
  /** Unique identifier in URN format */
  urn: string
  /** Parsed URN components */
  parsedUrn: ParsedURN
  /** Type of asset */
  type: AssetType
  /** Human-readable name */
  name: string
  /** Optional description */
  description?: string
  /** Ownership information */
  ownership: AssetOwnership
  /** Tags for categorization */
  tags: AssetTags
  /** Schema information (for structured assets) */
  schema?: AssetSchema
  /** Quality metrics */
  quality?: AssetQuality
  /** Additional custom metadata */
  metadata: Record<string, unknown>
  /** Timestamp when asset was first discovered (epoch ms) */
  createdAt: number
  /** Timestamp when asset was last updated (epoch ms) */
  updatedAt: number
  /** Timestamp when asset was last accessed/used (epoch ms) */
  lastAccessedAt?: number
  /** External system reference (e.g., Hive metastore ID) */
  externalId?: string
}

/**
 * Input for creating a new asset
 */
export interface CreateAssetInput {
  /** Unique identifier in URN format (required) */
  urn: string
  /** Type of asset */
  type: AssetType
  /** Human-readable name (derived from URN if not provided) */
  name?: string
  /** Optional description */
  description?: string
  /** Ownership information */
  ownership?: AssetOwnership
  /** Tags for categorization */
  tags?: AssetTags
  /** Schema information */
  schema?: AssetSchema
  /** Quality metrics */
  quality?: AssetQuality
  /** Additional custom metadata */
  metadata?: Record<string, unknown>
  /** External system reference */
  externalId?: string
}

/**
 * Options for querying assets
 */
export interface AssetQuery {
  /** Filter by asset type */
  type?: AssetType
  /** Filter by URN scheme */
  scheme?: URNScheme
  /** Filter by authority (database, bucket, etc.) */
  authority?: string
  /** Filter by owner */
  owner?: string
  /** Filter by team */
  team?: string
  /** Filter by PII level */
  pii?: AssetTags['pii']
  /** Filter by tags (any match) */
  tags?: string[]
  /** Filter by domain */
  domain?: string
  /** Search by name (partial match) */
  nameContains?: string
  /** Search by URN (partial match) */
  urnContains?: string
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// =============================================================================
// EDGE / TRANSFORMATION TYPES
// =============================================================================

/**
 * Type of transformation between assets
 */
export type TransformationType =
  /** Direct copy/passthrough with no transformation */
  | 'direct'
  /** Derived value from computation or transformation */
  | 'derived'
  /** Aggregated value from multiple sources */
  | 'aggregated'
  /** Filtered subset of source data */
  | 'filtered'
  /** Joined data from multiple sources */
  | 'joined'
  /** Enriched with additional data */
  | 'enriched'
  /** Masked or anonymized data */
  | 'masked'
  /** Custom/unknown transformation */
  | 'custom'

/**
 * How the lineage was determined
 */
export type LineageSource =
  /** Explicitly declared by developer */
  | 'declared'
  /** Parsed from SQL or code */
  | 'parsed'
  /** Inferred from runtime observation */
  | 'inferred'
  /** Imported from external catalog */
  | 'imported'

/**
 * Transformation metadata
 */
export interface TransformationMetadata {
  /** SQL query that performed the transformation */
  sql?: string
  /** Code snippet (for non-SQL transformations) */
  code?: string
  /** Pipeline/job configuration */
  config?: Record<string, unknown>
  /** Expression or formula */
  expression?: string
  /** Column mappings (source column -> target column) */
  columnMappings?: Array<{
    source: string
    target: string
    expression?: string
  }>
}

/**
 * An edge representing data flow between assets
 */
export interface LineageEdgeV2 {
  /** Unique identifier */
  id: string
  /** Source asset URN */
  sourceUrn: string
  /** Target asset URN */
  targetUrn: string
  /** Type of transformation */
  transformationType: TransformationType
  /** How the lineage was determined */
  lineageSource: LineageSource
  /** Confidence score (0-1) for inferred lineage */
  confidence: number
  /** Transformation details */
  transformation: TransformationMetadata
  /** Operation name/label */
  operation?: string
  /** Job/pipeline that created this edge */
  jobId?: string
  /** Run/execution ID */
  runId?: string
  /** Additional metadata */
  metadata: Record<string, unknown>
  /** Timestamp when edge was created (epoch ms) */
  createdAt: number
  /** Timestamp when edge was last observed (epoch ms) */
  lastObservedAt: number
  /** Whether this edge is currently active */
  active: boolean
}

/**
 * Input for creating a new lineage edge
 */
export interface CreateEdgeV2Input {
  /** Source asset URN */
  sourceUrn: string
  /** Target asset URN */
  targetUrn: string
  /** Type of transformation */
  transformationType: TransformationType
  /** How the lineage was determined (default: 'declared') */
  lineageSource?: LineageSource
  /** Confidence score (0-1, default: 1 for declared, 0.8 for parsed, 0.5 for inferred) */
  confidence?: number
  /** Transformation details */
  transformation?: TransformationMetadata
  /** Operation name/label */
  operation?: string
  /** Job/pipeline that created this edge */
  jobId?: string
  /** Run/execution ID */
  runId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for querying lineage edges
 */
export interface EdgeV2Query {
  /** Filter by source URN */
  sourceUrn?: string
  /** Filter by target URN */
  targetUrn?: string
  /** Filter by transformation type */
  transformationType?: TransformationType
  /** Filter by lineage source */
  lineageSource?: LineageSource
  /** Minimum confidence threshold */
  minConfidence?: number
  /** Filter by job ID */
  jobId?: string
  /** Include only active edges */
  activeOnly?: boolean
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// =============================================================================
// URN UTILITIES
// =============================================================================

/** Valid URN pattern: scheme://authority/path/segments */
const URN_PATTERN = /^([a-z][a-z0-9+.-]*):\/{2}([^\/]+)(\/.*)?$/i

/**
 * Parse a URN string into its components
 */
export function parseURN(urn: string): ParsedURN | null {
  const match = urn.match(URN_PATTERN)
  if (!match) {
    return null
  }

  const [, scheme, authority, pathPart] = match
  const normalizedScheme = scheme.toLowerCase() as URNScheme
  const pathSegments = pathPart ? pathPart.split('/').filter((s) => s.length > 0) : []

  return {
    scheme: normalizedScheme,
    authority,
    path: pathSegments,
    raw: urn,
  }
}

/**
 * Build a URN from components
 */
export function buildURN(scheme: URNScheme, authority: string, path: string[]): string {
  const pathPart = path.length > 0 ? '/' + path.join('/') : ''
  return `${scheme}://${authority}${pathPart}`
}

/**
 * Validate a URN string
 */
export function validateURN(urn: string): URNValidation {
  if (!urn || typeof urn !== 'string') {
    return { valid: false, error: 'URN must be a non-empty string' }
  }

  if (urn.length > 2048) {
    return { valid: false, error: 'URN exceeds maximum length of 2048 characters' }
  }

  const parsed = parseURN(urn)
  if (!parsed) {
    return { valid: false, error: 'Invalid URN format. Expected: scheme://authority/path' }
  }

  // Validate scheme
  const validSchemes: URNScheme[] = ['db', 'file', 'api', 'pipeline', 'warehouse', 's3', 'gcs', 'kafka', 'custom']
  if (!validSchemes.includes(parsed.scheme)) {
    return {
      valid: false,
      error: `Invalid scheme "${parsed.scheme}". Valid schemes: ${validSchemes.join(', ')}`,
    }
  }

  // Validate authority
  if (!parsed.authority || parsed.authority.length === 0) {
    return { valid: false, error: 'URN authority cannot be empty' }
  }

  return { valid: true, parsed }
}

/**
 * Check if two URNs represent related assets (one is ancestor/descendant of other)
 */
export function areRelatedURNs(urn1: string, urn2: string): boolean {
  const parsed1 = parseURN(urn1)
  const parsed2 = parseURN(urn2)

  if (!parsed1 || !parsed2) {
    return false
  }

  // Different schemes or authorities = not related
  if (parsed1.scheme !== parsed2.scheme || parsed1.authority !== parsed2.authority) {
    return false
  }

  // Check if one path is prefix of the other
  const shorter = parsed1.path.length <= parsed2.path.length ? parsed1.path : parsed2.path
  const longer = parsed1.path.length > parsed2.path.length ? parsed1.path : parsed2.path

  return shorter.every((segment, index) => longer[index] === segment)
}

/**
 * Get the parent URN (one level up in hierarchy)
 */
export function getParentURN(urn: string): string | null {
  const parsed = parseURN(urn)
  if (!parsed || parsed.path.length === 0) {
    return null
  }

  return buildURN(parsed.scheme, parsed.authority, parsed.path.slice(0, -1))
}

/**
 * Infer asset type from URN
 */
export function inferAssetType(urn: string): AssetType | null {
  const parsed = parseURN(urn)
  if (!parsed) {
    return null
  }

  switch (parsed.scheme) {
    case 'db':
    case 'warehouse':
      // db://postgres -> database
      // db://postgres/public -> schema
      // db://postgres/public/users -> table
      // db://postgres/public/users/email -> column
      switch (parsed.path.length) {
        case 0:
          return 'database'
        case 1:
          return 'schema'
        case 2:
          return 'table'
        case 3:
          return 'column'
        default:
          return 'column' // nested column reference
      }

    case 'file':
    case 's3':
    case 'gcs':
      // Assume file unless path ends with /
      if (parsed.raw.endsWith('/')) {
        return 'directory'
      }
      return 'file'

    case 'api':
      if (parsed.path.length === 0) {
        return 'api'
      }
      return 'endpoint'

    case 'pipeline':
      if (parsed.path.length === 0) {
        return 'pipeline'
      }
      return 'job'

    case 'kafka':
      return 'dataset' // Kafka topics as datasets

    default:
      return 'dataset'
  }
}

/**
 * Extract name from URN (last path segment or authority)
 */
export function extractNameFromURN(urn: string): string {
  const parsed = parseURN(urn)
  if (!parsed) {
    return urn
  }

  if (parsed.path.length > 0) {
    return parsed.path[parsed.path.length - 1]
  }

  return parsed.authority
}

// =============================================================================
// ASSET FACTORY
// =============================================================================

/**
 * Create an Asset from input, validating URN and inferring defaults
 */
export function createAsset(input: CreateAssetInput): Asset {
  // Validate URN
  const validation = validateURN(input.urn)
  if (!validation.valid || !validation.parsed) {
    throw new Error(`Invalid URN: ${validation.error}`)
  }

  const now = Date.now()

  return {
    urn: input.urn,
    parsedUrn: validation.parsed,
    type: input.type || inferAssetType(input.urn) || 'dataset',
    name: input.name || extractNameFromURN(input.urn),
    description: input.description,
    ownership: input.ownership || {},
    tags: input.tags || {},
    schema: input.schema,
    quality: input.quality,
    metadata: input.metadata || {},
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: undefined,
    externalId: input.externalId,
  }
}

// =============================================================================
// EDGE FACTORY
// =============================================================================

let edgeIdCounter = 0

/**
 * Generate a unique edge ID
 */
function generateEdgeId(): string {
  return `edge_${Date.now()}_${++edgeIdCounter}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Get default confidence based on lineage source
 */
function getDefaultConfidence(source: LineageSource): number {
  switch (source) {
    case 'declared':
      return 1.0
    case 'parsed':
      return 0.9
    case 'imported':
      return 0.85
    case 'inferred':
      return 0.5
  }
}

/**
 * Create a LineageEdgeV2 from input
 */
export function createEdgeV2(input: CreateEdgeV2Input): LineageEdgeV2 {
  // Validate source URN
  const sourceValidation = validateURN(input.sourceUrn)
  if (!sourceValidation.valid) {
    throw new Error(`Invalid source URN: ${sourceValidation.error}`)
  }

  // Validate target URN
  const targetValidation = validateURN(input.targetUrn)
  if (!targetValidation.valid) {
    throw new Error(`Invalid target URN: ${targetValidation.error}`)
  }

  const lineageSource = input.lineageSource || 'declared'
  const now = Date.now()

  return {
    id: generateEdgeId(),
    sourceUrn: input.sourceUrn,
    targetUrn: input.targetUrn,
    transformationType: input.transformationType,
    lineageSource,
    confidence: input.confidence ?? getDefaultConfidence(lineageSource),
    transformation: input.transformation || {},
    operation: input.operation,
    jobId: input.jobId,
    runId: input.runId,
    metadata: input.metadata || {},
    createdAt: now,
    lastObservedAt: now,
    active: true,
  }
}

/**
 * Validate edge confidence score
 */
export function validateConfidence(confidence: number): boolean {
  return typeof confidence === 'number' && confidence >= 0 && confidence <= 1 && !isNaN(confidence)
}

/**
 * Validate transformation type
 */
export function isValidTransformationType(type: string): type is TransformationType {
  const validTypes: TransformationType[] = [
    'direct',
    'derived',
    'aggregated',
    'filtered',
    'joined',
    'enriched',
    'masked',
    'custom',
  ]
  return validTypes.includes(type as TransformationType)
}
