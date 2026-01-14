/**
 * Cross-System Lineage Tracking
 *
 * Tracks lineage across multiple systems and tools:
 * - Source databases (Postgres, MySQL, MongoDB)
 * - Data warehouses (DuckDB, ClickHouse)
 * - BI tools (dashboards, reports)
 * - APIs and microservices
 * - File systems (S3, R2)
 *
 * @module db/primitives/lineage-tracker/cross-system
 */

import type { Asset, AssetType, URNScheme, ParsedURN, LineageEdgeV2 } from './asset'
import { parseURN, buildURN, validateURN, createAsset, createEdgeV2 } from './asset'

// =============================================================================
// SYSTEM TYPES
// =============================================================================

/**
 * Supported system categories
 */
export type SystemCategory =
  | 'source_database'
  | 'warehouse'
  | 'bi_tool'
  | 'api'
  | 'file_storage'
  | 'streaming'
  | 'transformation'
  | 'orchestration'
  | 'custom'

/**
 * Supported system types within each category
 */
export type SystemType =
  // Source databases
  | 'postgres'
  | 'mysql'
  | 'mongodb'
  | 'oracle'
  | 'sqlserver'
  // Warehouses
  | 'duckdb'
  | 'clickhouse'
  | 'snowflake'
  | 'bigquery'
  | 'redshift'
  // BI tools
  | 'tableau'
  | 'looker'
  | 'metabase'
  | 'superset'
  | 'powerbi'
  // APIs
  | 'rest'
  | 'graphql'
  | 'grpc'
  // File storage
  | 's3'
  | 'r2'
  | 'gcs'
  | 'local'
  // Streaming
  | 'kafka'
  | 'pulsar'
  | 'kinesis'
  // Transformation
  | 'dbt'
  | 'spark'
  | 'airflow'
  // Custom
  | 'custom'

/**
 * System registration information
 */
export interface SystemInfo {
  /** Unique identifier for this system instance */
  id: string
  /** Human-readable name */
  name: string
  /** Category of system */
  category: SystemCategory
  /** Specific system type */
  type: SystemType
  /** Connection or configuration details */
  config: Record<string, unknown>
  /** URN scheme used by this system */
  urnScheme: URNScheme
  /** Naming conventions used by this system */
  namingConvention?: NamingConvention
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Naming conventions for asset identification
 */
export interface NamingConvention {
  /** Case style: lowercase, uppercase, or mixed */
  caseStyle: 'lowercase' | 'uppercase' | 'mixed' | 'snake_case' | 'camelCase'
  /** Separator used in names */
  separator?: string
  /** Prefix applied to names */
  prefix?: string
  /** Suffix applied to names */
  suffix?: string
  /** Schema handling */
  schemaStyle?: 'explicit' | 'implicit' | 'none'
}

// =============================================================================
// CROSS-SYSTEM ASSET TYPES
// =============================================================================

/**
 * Extended asset with cross-system metadata
 */
export interface CrossSystemAsset extends Asset {
  /** System this asset belongs to */
  systemId: string
  /** System type */
  systemType: SystemType
  /** System category */
  systemCategory: SystemCategory
  /** Original identifier in the source system */
  sourceIdentifier: string
  /** Normalized URN for cross-system matching */
  normalizedUrn: string
  /** Aliases from different systems */
  aliases: AssetAlias[]
  /** When this asset was last synced from source */
  lastSyncedAt?: number
  /** Sync status */
  syncStatus: 'synced' | 'stale' | 'error' | 'unknown'
}

/**
 * Asset alias for cross-system matching
 */
export interface AssetAlias {
  /** System where this alias is used */
  systemId: string
  /** Alias URN or identifier */
  alias: string
  /** How the alias was determined */
  matchType: 'exact' | 'normalized' | 'mapped' | 'inferred'
  /** Confidence score for the alias match */
  confidence: number
}

/**
 * Cross-system lineage edge with stitching metadata
 */
export interface CrossSystemEdge extends LineageEdgeV2 {
  /** Source system ID */
  sourceSystemId: string
  /** Target system ID */
  targetSystemId: string
  /** Whether this edge crosses system boundaries */
  crossesBoundary: boolean
  /** Stitching method used */
  stitchingMethod?: StitchingMethod
  /** Stitching confidence */
  stitchingConfidence?: number
}

/**
 * Methods for stitching lineage across systems
 */
export type StitchingMethod =
  | 'exact_match'      // URNs match exactly
  | 'name_match'       // Names match after normalization
  | 'schema_match'     // Schemas match structurally
  | 'config_mapping'   // Explicit mapping in configuration
  | 'temporal_correlation' // Correlation based on timing
  | 'data_fingerprint' // Data content fingerprinting
  | 'inferred'         // Best-effort inference

// =============================================================================
// SYSTEM ADAPTER INTERFACE
// =============================================================================

/**
 * Extracted metadata from a system
 */
export interface ExtractedMetadata {
  /** Assets discovered in this system */
  assets: CrossSystemAsset[]
  /** Lineage edges within this system */
  edges: CrossSystemEdge[]
  /** Extraction timestamp */
  extractedAt: number
  /** Any errors encountered */
  errors: ExtractionError[]
}

/**
 * Extraction error details
 */
export interface ExtractionError {
  /** Error code */
  code: string
  /** Human-readable message */
  message: string
  /** Asset URN if applicable */
  assetUrn?: string
  /** Original error */
  cause?: Error
}

/**
 * System adapter for extracting metadata from different systems
 *
 * Implement this interface to add support for new system types.
 */
export interface SystemAdapter {
  /** System information */
  readonly info: SystemInfo

  /**
   * Extract all assets from this system
   */
  extractAssets(): Promise<CrossSystemAsset[]>

  /**
   * Extract lineage edges within this system
   */
  extractLineage(): Promise<CrossSystemEdge[]>

  /**
   * Extract complete metadata (assets + lineage)
   */
  extractAll(): Promise<ExtractedMetadata>

  /**
   * Normalize an asset identifier to a standard URN
   */
  normalizeIdentifier(identifier: string): string

  /**
   * Check if an identifier belongs to this system
   */
  ownsIdentifier(identifier: string): boolean

  /**
   * Get asset by its source identifier
   */
  getAsset(identifier: string): Promise<CrossSystemAsset | null>

  /**
   * Health check for the system connection
   */
  healthCheck(): Promise<boolean>
}

// =============================================================================
// LINEAGE STITCHING
// =============================================================================

/**
 * Stitching candidate - potential match between assets
 */
export interface StitchingCandidate {
  /** Source asset */
  source: CrossSystemAsset
  /** Target asset */
  target: CrossSystemAsset
  /** Match confidence (0-1) */
  confidence: number
  /** Matching method */
  method: StitchingMethod
  /** Evidence for the match */
  evidence: MatchEvidence[]
}

/**
 * Evidence supporting a stitching match
 */
export interface MatchEvidence {
  /** Type of evidence */
  type: 'name' | 'schema' | 'data' | 'timing' | 'config' | 'alias'
  /** Detailed description */
  description: string
  /** Weight of this evidence (0-1) */
  weight: number
  /** Raw data supporting the evidence */
  data?: Record<string, unknown>
}

/**
 * Stitching result
 */
export interface StitchingResult {
  /** Successfully stitched edges */
  stitchedEdges: CrossSystemEdge[]
  /** Candidates that were rejected */
  rejectedCandidates: StitchingCandidate[]
  /** Orphan assets with no matches */
  orphanAssets: CrossSystemAsset[]
  /** Statistics about the stitching process */
  stats: StitchingStats
}

/**
 * Statistics about lineage stitching
 */
export interface StitchingStats {
  /** Total candidates evaluated */
  totalCandidates: number
  /** Successfully matched */
  matched: number
  /** Rejected due to low confidence */
  rejected: number
  /** Assets without matches */
  orphans: number
  /** Average confidence of matches */
  avgConfidence: number
  /** Processing time in ms */
  processingTimeMs: number
}

/**
 * Configuration for lineage stitching
 */
export interface StitchingConfig {
  /** Minimum confidence threshold (default: 0.7) */
  minConfidence?: number
  /** Stitching methods to use (default: all) */
  methods?: StitchingMethod[]
  /** Whether to use fuzzy matching (default: true) */
  fuzzyMatching?: boolean
  /** Maximum candidates per asset (default: 10) */
  maxCandidates?: number
  /** Custom matching rules */
  customRules?: MatchingRule[]
}

/**
 * Custom matching rule for stitching
 */
export interface MatchingRule {
  /** Rule name */
  name: string
  /** Source system pattern (regex or exact) */
  sourcePattern: string
  /** Target system pattern */
  targetPattern: string
  /** Transformation to apply */
  transform?: (source: string) => string
  /** Fixed confidence for matches */
  confidence: number
}

// =============================================================================
// END-TO-END LINEAGE
// =============================================================================

/**
 * End-to-end lineage graph across all systems
 */
export interface EndToEndLineage {
  /** All assets in the lineage */
  assets: CrossSystemAsset[]
  /** All edges including stitched edges */
  edges: CrossSystemEdge[]
  /** Systems involved */
  systems: SystemInfo[]
  /** Root asset URN */
  rootUrn: string
  /** Direction of traversal */
  direction: 'upstream' | 'downstream' | 'both'
  /** Maximum depth reached */
  maxDepth: number
  /** Stitching stats if stitching was performed */
  stitchingStats?: StitchingStats
}

/**
 * Options for end-to-end lineage query
 */
export interface EndToEndOptions {
  /** Direction to traverse */
  direction?: 'upstream' | 'downstream' | 'both'
  /** Maximum depth */
  maxDepth?: number
  /** Filter to specific systems */
  systems?: string[]
  /** Include assets with no lineage */
  includeOrphans?: boolean
  /** Minimum confidence threshold */
  minConfidence?: number
}

// =============================================================================
// CROSS-SYSTEM LINEAGE TRACKER
// =============================================================================

/**
 * CrossSystemLineageTracker - Unified lineage across multiple systems
 *
 * Manages system registration, metadata extraction, and lineage stitching
 * to provide end-to-end data lineage across diverse data infrastructure.
 *
 * @example
 * ```typescript
 * const tracker = new CrossSystemLineageTracker()
 *
 * // Register systems
 * tracker.registerSystem(new PostgresAdapter({ ... }))
 * tracker.registerSystem(new DuckDBAdapter({ ... }))
 * tracker.registerSystem(new MetabaseAdapter({ ... }))
 *
 * // Extract and stitch lineage
 * await tracker.syncAll()
 * tracker.stitchLineage()
 *
 * // Query end-to-end lineage
 * const lineage = tracker.getEndToEndLineage('db://duckdb/analytics/daily_summary')
 * ```
 */
export class CrossSystemLineageTracker {
  private systems: Map<string, SystemAdapter> = new Map()
  private assets: Map<string, CrossSystemAsset> = new Map()
  private edges: CrossSystemEdge[] = []
  private stitchedEdges: CrossSystemEdge[] = []
  private stitchingConfig: StitchingConfig

  constructor(config?: StitchingConfig) {
    this.stitchingConfig = {
      minConfidence: 0.7,
      fuzzyMatching: true,
      maxCandidates: 10,
      ...config,
    }
  }

  // ===========================================================================
  // SYSTEM MANAGEMENT
  // ===========================================================================

  /**
   * Register a system adapter
   */
  registerSystem(adapter: SystemAdapter): void {
    if (this.systems.has(adapter.info.id)) {
      throw new Error(`System "${adapter.info.id}" is already registered`)
    }
    this.systems.set(adapter.info.id, adapter)
  }

  /**
   * Unregister a system
   */
  unregisterSystem(systemId: string): boolean {
    return this.systems.delete(systemId)
  }

  /**
   * Get a registered system
   */
  getSystem(systemId: string): SystemAdapter | undefined {
    return this.systems.get(systemId)
  }

  /**
   * Get all registered systems
   */
  getSystems(): SystemInfo[] {
    return Array.from(this.systems.values()).map((s) => s.info)
  }

  // ===========================================================================
  // METADATA EXTRACTION
  // ===========================================================================

  /**
   * Sync metadata from a specific system
   */
  async syncSystem(systemId: string): Promise<ExtractedMetadata> {
    const adapter = this.systems.get(systemId)
    if (!adapter) {
      throw new Error(`System "${systemId}" not found`)
    }

    const metadata = await adapter.extractAll()

    // Add assets to registry
    for (const asset of metadata.assets) {
      this.assets.set(asset.urn, asset)
      // Also index by normalized URN
      if (asset.normalizedUrn !== asset.urn) {
        this.assets.set(asset.normalizedUrn, asset)
      }
    }

    // Add edges
    this.edges.push(...metadata.edges)

    return metadata
  }

  /**
   * Sync metadata from all registered systems
   */
  async syncAll(): Promise<Map<string, ExtractedMetadata>> {
    const results = new Map<string, ExtractedMetadata>()

    for (const [systemId] of this.systems) {
      try {
        const metadata = await this.syncSystem(systemId)
        results.set(systemId, metadata)
      } catch (error) {
        results.set(systemId, {
          assets: [],
          edges: [],
          extractedAt: Date.now(),
          errors: [
            {
              code: 'SYNC_ERROR',
              message: `Failed to sync system: ${error instanceof Error ? error.message : String(error)}`,
              cause: error instanceof Error ? error : undefined,
            },
          ],
        })
      }
    }

    return results
  }

  // ===========================================================================
  // LINEAGE STITCHING
  // ===========================================================================

  /**
   * Find potential stitching candidates between systems
   */
  findStitchingCandidates(): StitchingCandidate[] {
    const candidates: StitchingCandidate[] = []
    const assetsArray = Array.from(this.assets.values())

    // Group assets by system
    const bySystem = new Map<string, CrossSystemAsset[]>()
    for (const asset of assetsArray) {
      const systemAssets = bySystem.get(asset.systemId) || []
      systemAssets.push(asset)
      bySystem.set(asset.systemId, systemAssets)
    }

    // Find cross-system matches
    const systemIds = Array.from(bySystem.keys())
    for (let i = 0; i < systemIds.length; i++) {
      for (let j = i + 1; j < systemIds.length; j++) {
        const sourceAssets = bySystem.get(systemIds[i]) || []
        const targetAssets = bySystem.get(systemIds[j]) || []

        for (const source of sourceAssets) {
          for (const target of targetAssets) {
            const candidate = this.evaluateMatch(source, target)
            if (candidate && candidate.confidence >= (this.stitchingConfig.minConfidence || 0.7)) {
              candidates.push(candidate)
            }
          }
        }
      }
    }

    // Sort by confidence (highest first)
    return candidates.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Evaluate if two assets should be stitched
   */
  private evaluateMatch(source: CrossSystemAsset, target: CrossSystemAsset): StitchingCandidate | null {
    const evidence: MatchEvidence[] = []
    let totalWeight = 0
    let weightedConfidence = 0

    // 1. Check exact name match
    if (this.normalizeForMatching(source.name) === this.normalizeForMatching(target.name)) {
      evidence.push({
        type: 'name',
        description: 'Exact name match after normalization',
        weight: 0.4,
      })
      totalWeight += 0.4
      weightedConfidence += 0.4 * 1.0
    }
    // 2. Check fuzzy name match
    else if (this.stitchingConfig.fuzzyMatching && this.fuzzyMatch(source.name, target.name) > 0.8) {
      const similarity = this.fuzzyMatch(source.name, target.name)
      evidence.push({
        type: 'name',
        description: `Fuzzy name match with ${(similarity * 100).toFixed(1)}% similarity`,
        weight: 0.3,
        data: { similarity },
      })
      totalWeight += 0.3
      weightedConfidence += 0.3 * similarity
    }

    // 3. Check aliases
    for (const alias of source.aliases) {
      if (alias.alias === target.urn || alias.alias === target.normalizedUrn) {
        evidence.push({
          type: 'alias',
          description: `Source has alias matching target`,
          weight: 0.5,
          data: { alias: alias.alias, matchType: alias.matchType },
        })
        totalWeight += 0.5
        weightedConfidence += 0.5 * alias.confidence
        break
      }
    }

    // 4. Check config mappings (custom rules)
    for (const rule of this.stitchingConfig.customRules || []) {
      if (this.matchesRule(source, target, rule)) {
        evidence.push({
          type: 'config',
          description: `Matched by custom rule: ${rule.name}`,
          weight: 0.6,
          data: { ruleName: rule.name },
        })
        totalWeight += 0.6
        weightedConfidence += 0.6 * rule.confidence
        break
      }
    }

    // 5. Check schema similarity for structured assets
    if (source.schema && target.schema) {
      if (source.schema.dataType === target.schema.dataType) {
        evidence.push({
          type: 'schema',
          description: 'Same data type',
          weight: 0.2,
        })
        totalWeight += 0.2
        weightedConfidence += 0.2 * 0.9
      }
    }

    // Calculate final confidence
    if (evidence.length === 0) {
      return null
    }

    const confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0

    // Determine stitching method based on strongest evidence
    let method: StitchingMethod = 'inferred'
    const strongestEvidence = evidence.reduce((a, b) => (a.weight > b.weight ? a : b))
    switch (strongestEvidence.type) {
      case 'name':
        method = 'name_match'
        break
      case 'alias':
        method = 'exact_match'
        break
      case 'config':
        method = 'config_mapping'
        break
      case 'schema':
        method = 'schema_match'
        break
    }

    return {
      source,
      target,
      confidence,
      method,
      evidence,
    }
  }

  /**
   * Normalize a string for matching
   */
  private normalizeForMatching(str: string): string {
    return str
      .toLowerCase()
      .replace(/[_-]/g, '')
      .replace(/\s+/g, '')
  }

  /**
   * Compute fuzzy match similarity (Levenshtein-based)
   */
  private fuzzyMatch(a: string, b: string): number {
    const normA = this.normalizeForMatching(a)
    const normB = this.normalizeForMatching(b)

    if (normA === normB) return 1.0
    if (normA.length === 0 || normB.length === 0) return 0.0

    // Simple Levenshtein distance
    const matrix: number[][] = []
    for (let i = 0; i <= normA.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= normB.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= normA.length; i++) {
      for (let j = 1; j <= normB.length; j++) {
        const cost = normA[i - 1] === normB[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
      }
    }

    const distance = matrix[normA.length][normB.length]
    const maxLen = Math.max(normA.length, normB.length)
    return 1 - distance / maxLen
  }

  /**
   * Check if assets match a custom rule
   */
  private matchesRule(source: CrossSystemAsset, target: CrossSystemAsset, rule: MatchingRule): boolean {
    const sourcePattern = new RegExp(rule.sourcePattern)
    const targetPattern = new RegExp(rule.targetPattern)

    if (!sourcePattern.test(source.urn) && !sourcePattern.test(source.name)) {
      return false
    }

    if (!targetPattern.test(target.urn) && !targetPattern.test(target.name)) {
      return false
    }

    // If transform is provided, check if transformed source matches target
    if (rule.transform) {
      const transformed = rule.transform(source.name)
      if (this.normalizeForMatching(transformed) !== this.normalizeForMatching(target.name)) {
        return false
      }
    }

    return true
  }

  /**
   * Perform lineage stitching across all systems
   */
  stitchLineage(config?: StitchingConfig): StitchingResult {
    const startTime = Date.now()
    const mergedConfig = { ...this.stitchingConfig, ...config }

    const candidates = this.findStitchingCandidates()
    const stitchedEdges: CrossSystemEdge[] = []
    const rejectedCandidates: StitchingCandidate[] = []
    const matchedAssets = new Set<string>()

    // Process candidates by confidence (highest first)
    for (const candidate of candidates) {
      // Skip if already matched
      if (matchedAssets.has(candidate.source.urn) || matchedAssets.has(candidate.target.urn)) {
        continue
      }

      if (candidate.confidence >= (mergedConfig.minConfidence || 0.7)) {
        // Create stitched edge
        const edge: CrossSystemEdge = {
          id: `stitch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          sourceUrn: candidate.source.urn,
          targetUrn: candidate.target.urn,
          transformationType: 'direct',
          lineageSource: 'inferred',
          confidence: candidate.confidence,
          transformation: {},
          metadata: {
            stitchingEvidence: candidate.evidence,
          },
          createdAt: Date.now(),
          lastObservedAt: Date.now(),
          active: true,
          sourceSystemId: candidate.source.systemId,
          targetSystemId: candidate.target.systemId,
          crossesBoundary: true,
          stitchingMethod: candidate.method,
          stitchingConfidence: candidate.confidence,
        }

        stitchedEdges.push(edge)
        matchedAssets.add(candidate.source.urn)
        matchedAssets.add(candidate.target.urn)
      } else {
        rejectedCandidates.push(candidate)
      }
    }

    // Find orphan assets
    const orphanAssets = Array.from(this.assets.values()).filter((asset) => !matchedAssets.has(asset.urn))

    // Store stitched edges
    this.stitchedEdges = stitchedEdges

    const stats: StitchingStats = {
      totalCandidates: candidates.length,
      matched: stitchedEdges.length,
      rejected: rejectedCandidates.length,
      orphans: orphanAssets.length,
      avgConfidence: stitchedEdges.length > 0 ? stitchedEdges.reduce((sum, e) => sum + (e.confidence || 0), 0) / stitchedEdges.length : 0,
      processingTimeMs: Date.now() - startTime,
    }

    return {
      stitchedEdges,
      rejectedCandidates,
      orphanAssets,
      stats,
    }
  }

  // ===========================================================================
  // LINEAGE QUERIES
  // ===========================================================================

  /**
   * Get end-to-end lineage for an asset
   */
  getEndToEndLineage(assetUrn: string, options?: EndToEndOptions): EndToEndLineage {
    const opts: Required<EndToEndOptions> = {
      direction: options?.direction || 'both',
      maxDepth: options?.maxDepth || 100,
      systems: options?.systems || [],
      includeOrphans: options?.includeOrphans || false,
      minConfidence: options?.minConfidence || 0,
    }

    const visitedAssets = new Map<string, CrossSystemAsset>()
    const visitedEdges: CrossSystemEdge[] = []
    const allEdges = [...this.edges, ...this.stitchedEdges]

    // BFS traversal
    const queue: Array<{ urn: string; depth: number; direction: 'upstream' | 'downstream' }> = []

    if (opts.direction === 'both' || opts.direction === 'upstream') {
      queue.push({ urn: assetUrn, depth: 0, direction: 'upstream' })
    }
    if (opts.direction === 'both' || opts.direction === 'downstream') {
      queue.push({ urn: assetUrn, depth: 0, direction: 'downstream' })
    }

    while (queue.length > 0) {
      const { urn, depth, direction } = queue.shift()!

      if (depth > opts.maxDepth) continue

      const asset = this.assets.get(urn)
      if (!asset) continue

      // Filter by systems if specified
      if (opts.systems.length > 0 && !opts.systems.includes(asset.systemId)) continue

      visitedAssets.set(urn, asset)

      // Find connected edges
      const connectedEdges =
        direction === 'upstream'
          ? allEdges.filter((e) => e.targetUrn === urn && e.confidence >= opts.minConfidence)
          : allEdges.filter((e) => e.sourceUrn === urn && e.confidence >= opts.minConfidence)

      for (const edge of connectedEdges) {
        const edgeKey = `${edge.sourceUrn}->${edge.targetUrn}`
        if (!visitedEdges.some((e) => `${e.sourceUrn}->${e.targetUrn}` === edgeKey)) {
          visitedEdges.push(edge)

          const nextUrn = direction === 'upstream' ? edge.sourceUrn : edge.targetUrn
          if (!visitedAssets.has(nextUrn)) {
            queue.push({ urn: nextUrn, depth: depth + 1, direction })
          }
        }
      }
    }

    // Calculate max depth
    let maxDepthReached = 0
    for (const edge of visitedEdges) {
      const sourceAsset = visitedAssets.get(edge.sourceUrn)
      const targetAsset = visitedAssets.get(edge.targetUrn)
      if (sourceAsset && targetAsset) {
        maxDepthReached = Math.max(maxDepthReached, visitedAssets.size)
      }
    }

    return {
      assets: Array.from(visitedAssets.values()),
      edges: visitedEdges,
      systems: this.getSystems().filter((s) => Array.from(visitedAssets.values()).some((a) => a.systemId === s.id)),
      rootUrn: assetUrn,
      direction: opts.direction,
      maxDepth: maxDepthReached,
    }
  }

  // ===========================================================================
  // ASSET MANAGEMENT
  // ===========================================================================

  /**
   * Get an asset by URN
   */
  getAsset(urn: string): CrossSystemAsset | undefined {
    return this.assets.get(urn)
  }

  /**
   * Get all assets
   */
  getAssets(): CrossSystemAsset[] {
    return Array.from(this.assets.values())
  }

  /**
   * Get assets by system
   */
  getAssetsBySystem(systemId: string): CrossSystemAsset[] {
    return Array.from(this.assets.values()).filter((a) => a.systemId === systemId)
  }

  /**
   * Get all edges (including stitched)
   */
  getAllEdges(): CrossSystemEdge[] {
    return [...this.edges, ...this.stitchedEdges]
  }

  /**
   * Get only stitched edges
   */
  getStitchedEdges(): CrossSystemEdge[] {
    return this.stitchedEdges
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.assets.clear()
    this.edges = []
    this.stitchedEdges = []
  }
}

// =============================================================================
// BASE SYSTEM ADAPTER
// =============================================================================

/**
 * Base implementation for system adapters
 *
 * Extend this class to implement adapters for specific system types.
 */
export abstract class BaseSystemAdapter implements SystemAdapter {
  readonly info: SystemInfo

  constructor(info: SystemInfo) {
    this.info = info
  }

  /**
   * Extract all assets from this system
   * Override in subclasses
   */
  abstract extractAssets(): Promise<CrossSystemAsset[]>

  /**
   * Extract lineage edges within this system
   * Override in subclasses
   */
  abstract extractLineage(): Promise<CrossSystemEdge[]>

  /**
   * Extract complete metadata
   */
  async extractAll(): Promise<ExtractedMetadata> {
    const errors: ExtractionError[] = []
    let assets: CrossSystemAsset[] = []
    let edges: CrossSystemEdge[] = []

    try {
      assets = await this.extractAssets()
    } catch (error) {
      errors.push({
        code: 'ASSET_EXTRACTION_ERROR',
        message: `Failed to extract assets: ${error instanceof Error ? error.message : String(error)}`,
        cause: error instanceof Error ? error : undefined,
      })
    }

    try {
      edges = await this.extractLineage()
    } catch (error) {
      errors.push({
        code: 'LINEAGE_EXTRACTION_ERROR',
        message: `Failed to extract lineage: ${error instanceof Error ? error.message : String(error)}`,
        cause: error instanceof Error ? error : undefined,
      })
    }

    return {
      assets,
      edges,
      extractedAt: Date.now(),
      errors,
    }
  }

  /**
   * Normalize an identifier to a standard URN
   */
  normalizeIdentifier(identifier: string): string {
    // Default implementation: lowercase and build URN
    const normalized = identifier.toLowerCase().replace(/\s+/g, '_')
    return buildURN(this.info.urnScheme, this.info.id, normalized.split('.'))
  }

  /**
   * Check if an identifier belongs to this system
   */
  ownsIdentifier(identifier: string): boolean {
    const parsed = parseURN(identifier)
    if (!parsed) return false
    return parsed.scheme === this.info.urnScheme && parsed.authority === this.info.id
  }

  /**
   * Get asset by identifier
   * Override in subclasses for actual retrieval
   */
  abstract getAsset(identifier: string): Promise<CrossSystemAsset | null>

  /**
   * Health check
   * Override in subclasses for actual health check
   */
  abstract healthCheck(): Promise<boolean>

  /**
   * Helper to create a CrossSystemAsset
   */
  protected createCrossSystemAsset(
    urn: string,
    type: AssetType,
    name: string,
    sourceIdentifier: string,
    options?: Partial<Omit<CrossSystemAsset, 'urn' | 'type' | 'name' | 'sourceIdentifier' | 'systemId' | 'systemType' | 'systemCategory'>>
  ): CrossSystemAsset {
    const validation = validateURN(urn)
    if (!validation.valid || !validation.parsed) {
      throw new Error(`Invalid URN: ${validation.error}`)
    }

    const now = Date.now()

    return {
      urn,
      parsedUrn: validation.parsed,
      type,
      name,
      sourceIdentifier,
      normalizedUrn: this.normalizeIdentifier(sourceIdentifier),
      systemId: this.info.id,
      systemType: this.info.type,
      systemCategory: this.info.category,
      aliases: options?.aliases || [],
      syncStatus: 'synced',
      lastSyncedAt: now,
      ownership: options?.ownership || {},
      tags: options?.tags || {},
      metadata: options?.metadata || {},
      createdAt: now,
      updatedAt: now,
      ...options,
    }
  }

  /**
   * Helper to create a CrossSystemEdge
   */
  protected createCrossSystemEdge(
    sourceUrn: string,
    targetUrn: string,
    options?: Partial<Omit<CrossSystemEdge, 'sourceUrn' | 'targetUrn' | 'sourceSystemId' | 'targetSystemId' | 'crossesBoundary'>>
  ): CrossSystemEdge {
    const now = Date.now()

    return {
      id: `edge_${now}_${Math.random().toString(36).substring(2, 8)}`,
      sourceUrn,
      targetUrn,
      transformationType: options?.transformationType || 'direct',
      lineageSource: options?.lineageSource || 'parsed',
      confidence: options?.confidence ?? 0.9,
      transformation: options?.transformation || {},
      metadata: options?.metadata || {},
      createdAt: now,
      lastObservedAt: now,
      active: true,
      sourceSystemId: this.info.id,
      targetSystemId: this.info.id,
      crossesBoundary: false,
      ...options,
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new CrossSystemLineageTracker
 */
export function createCrossSystemLineageTracker(config?: StitchingConfig): CrossSystemLineageTracker {
  return new CrossSystemLineageTracker(config)
}

/**
 * Calculate confidence score based on multiple factors
 */
export function calculateConfidence(factors: Array<{ score: number; weight: number }>): number {
  let totalWeight = 0
  let weightedSum = 0

  for (const factor of factors) {
    totalWeight += factor.weight
    weightedSum += factor.score * factor.weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

/**
 * Normalize asset name for cross-system matching
 */
export function normalizeAssetName(name: string, convention?: NamingConvention): string {
  let normalized = name

  // Apply case style
  switch (convention?.caseStyle) {
    case 'lowercase':
      normalized = normalized.toLowerCase()
      break
    case 'uppercase':
      normalized = normalized.toUpperCase()
      break
    case 'snake_case':
      normalized = normalized.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
      break
    case 'camelCase':
      normalized = normalized.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      break
  }

  // Remove prefix/suffix
  if (convention?.prefix && normalized.startsWith(convention.prefix)) {
    normalized = normalized.substring(convention.prefix.length)
  }
  if (convention?.suffix && normalized.endsWith(convention.suffix)) {
    normalized = normalized.substring(0, normalized.length - convention.suffix.length)
  }

  // Normalize separators
  normalized = normalized.replace(/[-_\s]+/g, '_')

  return normalized
}
