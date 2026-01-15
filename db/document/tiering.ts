/**
 * DocumentStore Tiering
 *
 * Integrates hot/warm/cold storage tiering with DocumentStore.
 * Extends the base tiering infrastructure to work with document storage.
 *
 * Storage tiers:
 * - Hot: DO SQLite (<1ms access, ~100MB limit)
 * - Warm: R2 Parquet (~50ms access, ~10GB limit)
 * - Cold: R2 Iceberg Archive (~100ms access, unlimited)
 */

import type Database from 'better-sqlite3'
import type {
  StorageTier,
  TieringPolicy,
  TierMetadata,
  TieredData,
  R2BucketLike,
  TierOperationResult,
} from '../core/tiering/types'
import { createTierMetadata, updateAccessMetadata } from '../core/tiering/types'
import { PolicyEvaluator, ageBasedPolicy } from '../core/tiering/policy'
import type { Document, DocumentRow } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Document tier metadata stored alongside the document
 */
export interface DocumentTierMetadata extends TierMetadata {
  /** Document ID */
  $id: string
  /** Document type */
  $type: string
  /** Document version at tiering */
  $version: number
}

/**
 * Tiered document wrapper
 */
export interface TieredDocument<T> extends TieredData<T> {
  metadata: DocumentTierMetadata
}

/**
 * DocumentTieringManager options
 */
export interface DocumentTieringOptions {
  /** Document type to manage */
  type: string
  /** SQLite database */
  db: Database.Database
  /** Tiering policy */
  policy?: TieringPolicy
  /** R2 bucket for warm tier */
  r2Warm?: R2BucketLike
  /** R2 bucket for cold tier */
  r2Cold?: R2BucketLike
  /** Key prefix for R2 storage */
  keyPrefix?: string
  /** Callback when document is tiered */
  onTier?: (result: TierOperationResult) => void
}

/**
 * Tier statistics
 */
export interface TierStats {
  hot: {
    count: number
    sizeBytes: number
    avgAge: number
    avgAccessCount: number
  }
  warm: {
    count: number
    sizeBytes: number
  }
  cold: {
    count: number
    sizeBytes: number
  }
}

// ============================================================================
// DOCUMENT TIERING MANAGER
// ============================================================================

/**
 * DocumentTieringManager - Manages tiering for document storage
 *
 * Tracks access patterns and automatically tiers documents based on policy.
 * Integrates with R2 for warm/cold storage.
 *
 * @example
 * ```typescript
 * const tiering = new DocumentTieringManager({
 *   type: 'Customer',
 *   db: sqlite,
 *   policy: ageBasedPolicy(7, 90), // Warm after 7 days, cold after 90
 *   r2Warm: env.R2_WARM,
 *   r2Cold: env.R2_COLD,
 * })
 *
 * // Record access
 * tiering.recordAccess('cust_123')
 *
 * // Run tiering batch
 * const results = await tiering.runTieringBatch({ limit: 100 })
 * console.log(`Tiered ${results.tieredToWarm} to warm, ${results.tieredToCold} to cold`)
 *
 * // Get document (checks all tiers)
 * const doc = await tiering.getFromAnyTier('cust_123')
 * ```
 */
export class DocumentTieringManager<T extends Record<string, unknown>> {
  private db: Database.Database
  private type: string
  private policy: PolicyEvaluator
  private r2Warm?: R2BucketLike
  private r2Cold?: R2BucketLike
  private keyPrefix: string
  private onTier?: (result: TierOperationResult) => void

  constructor(options: DocumentTieringOptions) {
    this.db = options.db
    this.type = options.type
    this.policy = new PolicyEvaluator(options.policy ?? ageBasedPolicy(7, 90))
    this.r2Warm = options.r2Warm
    this.r2Cold = options.r2Cold
    this.keyPrefix = options.keyPrefix ?? `docs/${options.type}`
    this.onTier = options.onTier

    this.ensureMetadataTable()
  }

  /**
   * Ensure the tier metadata table exists
   */
  private ensureMetadataTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_tier_metadata (
        "$id" TEXT PRIMARY KEY,
        "$type" TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'hot',
        last_access INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        modified_at INTEGER,
        size_bytes INTEGER,
        "$version" INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY ("$id") REFERENCES documents("$id") ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tier_metadata_type ON document_tier_metadata("$type");
      CREATE INDEX IF NOT EXISTS idx_tier_metadata_tier ON document_tier_metadata(tier);
      CREATE INDEX IF NOT EXISTS idx_tier_metadata_last_access ON document_tier_metadata(last_access);
      CREATE INDEX IF NOT EXISTS idx_tier_metadata_created ON document_tier_metadata(created_at);
    `)
  }

  /**
   * Get R2 key for a document
   */
  private getR2Key(docId: string): string {
    return `${this.keyPrefix}/${docId}.json`
  }

  /**
   * Initialize tier metadata for a new document
   */
  initializeMetadata($id: string, $version: number, sizeBytes?: number): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT OR REPLACE INTO document_tier_metadata
      ("$id", "$type", tier, last_access, access_count, created_at, "$version", size_bytes)
      VALUES (?, ?, 'hot', ?, 0, ?, ?, ?)
    `).run($id, this.type, now, now, $version, sizeBytes ?? null)
  }

  /**
   * Record document access
   */
  recordAccess($id: string): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE document_tier_metadata
      SET last_access = ?, access_count = access_count + 1
      WHERE "$id" = ?
    `).run(now, $id)
  }

  /**
   * Get tier metadata for a document
   */
  getMetadata($id: string): DocumentTierMetadata | null {
    const row = this.db.prepare(`
      SELECT * FROM document_tier_metadata WHERE "$id" = ?
    `).get($id) as {
      $id: string
      $type: string
      tier: StorageTier
      last_access: number
      access_count: number
      created_at: number
      modified_at: number | null
      size_bytes: number | null
      $version: number
    } | undefined

    if (!row) return null

    return {
      $id: row.$id,
      $type: row.$type,
      $version: row.$version,
      tier: row.tier,
      lastAccess: row.last_access,
      accessCount: row.access_count,
      createdAt: row.created_at,
      modifiedAt: row.modified_at ?? undefined,
      sizeBytes: row.size_bytes ?? undefined,
    }
  }

  /**
   * Update tier in metadata
   */
  private updateTier($id: string, tier: StorageTier): void {
    this.db.prepare(`
      UPDATE document_tier_metadata SET tier = ? WHERE "$id" = ?
    `).run(tier, $id)
  }

  /**
   * Get documents that should be tiered
   */
  findTieringCandidates(options: {
    limit?: number
    targetTier?: StorageTier
  } = {}): Array<{ $id: string; targetTier: StorageTier; metadata: DocumentTierMetadata }> {
    const limit = options.limit ?? 100

    const rows = this.db.prepare(`
      SELECT * FROM document_tier_metadata
      WHERE "$type" = ? AND tier = 'hot'
      ORDER BY last_access ASC
      LIMIT ?
    `).all(this.type, limit * 2) as Array<{
      $id: string
      $type: string
      tier: StorageTier
      last_access: number
      access_count: number
      created_at: number
      modified_at: number | null
      size_bytes: number | null
      $version: number
    }>

    const candidates: Array<{ $id: string; targetTier: StorageTier; metadata: DocumentTierMetadata }> = []

    for (const row of rows) {
      const metadata: DocumentTierMetadata = {
        $id: row.$id,
        $type: row.$type,
        $version: row.$version,
        tier: row.tier,
        lastAccess: row.last_access,
        accessCount: row.access_count,
        createdAt: row.created_at,
        modifiedAt: row.modified_at ?? undefined,
        sizeBytes: row.size_bytes ?? undefined,
      }

      const targetTier = this.policy.evaluate(metadata)

      if (targetTier !== null) {
        if (!options.targetTier || options.targetTier === targetTier) {
          candidates.push({ $id: row.$id, targetTier, metadata })
        }
      }

      if (candidates.length >= (options.limit ?? 100)) {
        break
      }
    }

    return candidates
  }

  /**
   * Tier a document to warm storage
   */
  async tierToWarm($id: string): Promise<TierOperationResult> {
    if (!this.r2Warm) {
      return {
        success: false,
        key: $id,
        error: 'Warm tier (R2) not configured',
      }
    }

    const startTime = Date.now()

    try {
      // Get document from hot tier
      const row = this.db.prepare(`
        SELECT * FROM documents WHERE "$id" = ? AND "$type" = ?
      `).get($id, this.type) as DocumentRow | undefined

      if (!row) {
        return {
          success: false,
          key: $id,
          error: 'Document not found in hot tier',
        }
      }

      // Get metadata
      const metadata = this.getMetadata($id)

      // Prepare tiered document
      const tieredDoc: TieredDocument<DocumentRow> = {
        data: row,
        metadata: metadata ?? {
          $id,
          $type: this.type,
          $version: row.$version,
          tier: 'warm',
          lastAccess: Date.now(),
          accessCount: 0,
          createdAt: row.$createdAt,
        },
      }
      tieredDoc.metadata.tier = 'warm'

      // Write to R2
      const key = this.getR2Key($id)
      await this.r2Warm.put(key, JSON.stringify(tieredDoc), {
        customMetadata: {
          type: this.type,
          version: String(row.$version),
          tieredAt: new Date().toISOString(),
        },
      })

      // Delete from hot tier
      this.db.prepare(`DELETE FROM documents WHERE "$id" = ?`).run($id)

      // Update metadata
      this.updateTier($id, 'warm')

      const result: TierOperationResult = {
        success: true,
        fromTier: 'hot',
        toTier: 'warm',
        key: $id,
        durationMs: Date.now() - startTime,
      }

      this.onTier?.(result)
      return result

    } catch (error) {
      return {
        success: false,
        key: $id,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Tier a document from warm to cold storage
   */
  async tierToCold($id: string): Promise<TierOperationResult> {
    if (!this.r2Warm || !this.r2Cold) {
      return {
        success: false,
        key: $id,
        error: 'Warm or cold tier (R2) not configured',
      }
    }

    const startTime = Date.now()

    try {
      const key = this.getR2Key($id)

      // Get from warm tier
      const warmObj = await this.r2Warm.get(key)
      if (!warmObj) {
        return {
          success: false,
          key: $id,
          error: 'Document not found in warm tier',
        }
      }

      // Copy to cold tier
      const content = await warmObj.text()
      const tieredDoc = JSON.parse(content) as TieredDocument<DocumentRow>
      tieredDoc.metadata.tier = 'cold'

      await this.r2Cold.put(key, JSON.stringify(tieredDoc), {
        customMetadata: {
          ...warmObj.customMetadata,
          tier: 'cold',
          tieredAt: new Date().toISOString(),
        },
      })

      // Delete from warm tier
      await this.r2Warm.delete(key)

      // Update metadata
      this.updateTier($id, 'cold')

      const result: TierOperationResult = {
        success: true,
        fromTier: 'warm',
        toTier: 'cold',
        key: $id,
        durationMs: Date.now() - startTime,
      }

      this.onTier?.(result)
      return result

    } catch (error) {
      return {
        success: false,
        key: $id,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Promote a document from warm back to hot
   */
  async promoteToHot($id: string): Promise<TierOperationResult> {
    if (!this.r2Warm) {
      return {
        success: false,
        key: $id,
        error: 'Warm tier (R2) not configured',
      }
    }

    const startTime = Date.now()

    try {
      const key = this.getR2Key($id)

      // Get from warm tier
      const warmObj = await this.r2Warm.get(key)
      if (!warmObj) {
        return {
          success: false,
          key: $id,
          error: 'Document not found in warm tier',
        }
      }

      const content = await warmObj.text()
      const tieredDoc = JSON.parse(content) as TieredDocument<DocumentRow>
      const row = tieredDoc.data

      // Insert back into hot tier
      this.db.prepare(`
        INSERT OR REPLACE INTO documents ("$id", "$type", data, "$createdAt", "$updatedAt", "$version")
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(row.$id, row.$type, row.data, row.$createdAt, row.$updatedAt, row.$version)

      // Delete from warm tier
      await this.r2Warm.delete(key)

      // Update metadata
      this.updateTier($id, 'hot')
      this.recordAccess($id)

      const result: TierOperationResult = {
        success: true,
        fromTier: 'warm',
        toTier: 'hot',
        key: $id,
        durationMs: Date.now() - startTime,
      }

      this.onTier?.(result)
      return result

    } catch (error) {
      return {
        success: false,
        key: $id,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Get a document from any tier
   */
  async getFromAnyTier($id: string): Promise<{ data: Document<T>; tier: StorageTier } | null> {
    // Check metadata first
    const metadata = this.getMetadata($id)

    if (!metadata) {
      return null
    }

    // Try hot tier
    if (metadata.tier === 'hot') {
      const row = this.db.prepare(`
        SELECT * FROM documents WHERE "$id" = ? AND "$type" = ?
      `).get($id, this.type) as DocumentRow | undefined

      if (row) {
        this.recordAccess($id)
        const data = JSON.parse(row.data) as T
        return {
          data: {
            ...data,
            $id: row.$id,
            $type: row.$type,
            $createdAt: row.$createdAt,
            $updatedAt: row.$updatedAt,
            $version: row.$version,
          } as Document<T>,
          tier: 'hot',
        }
      }
    }

    // Try warm tier
    if (metadata.tier === 'warm' && this.r2Warm) {
      const key = this.getR2Key($id)
      const warmObj = await this.r2Warm.get(key)

      if (warmObj) {
        const content = await warmObj.text()
        const tieredDoc = JSON.parse(content) as TieredDocument<DocumentRow>
        const row = tieredDoc.data
        const data = JSON.parse(row.data) as T

        return {
          data: {
            ...data,
            $id: row.$id,
            $type: row.$type,
            $createdAt: row.$createdAt,
            $updatedAt: row.$updatedAt,
            $version: row.$version,
          } as Document<T>,
          tier: 'warm',
        }
      }
    }

    // Try cold tier
    if (metadata.tier === 'cold' && this.r2Cold) {
      const key = this.getR2Key($id)
      const coldObj = await this.r2Cold.get(key)

      if (coldObj) {
        const content = await coldObj.text()
        const tieredDoc = JSON.parse(content) as TieredDocument<DocumentRow>
        const row = tieredDoc.data
        const data = JSON.parse(row.data) as T

        return {
          data: {
            ...data,
            $id: row.$id,
            $type: row.$type,
            $createdAt: row.$createdAt,
            $updatedAt: row.$updatedAt,
            $version: row.$version,
          } as Document<T>,
          tier: 'cold',
        }
      }
    }

    return null
  }

  /**
   * Run tiering batch operation
   */
  async runTieringBatch(options: {
    limit?: number
    dryRun?: boolean
  } = {}): Promise<{
    evaluated: number
    tieredToWarm: number
    tieredToCold: number
    errors: number
    results: TierOperationResult[]
  }> {
    const candidates = this.findTieringCandidates({ limit: options.limit })

    const results: TierOperationResult[] = []
    let tieredToWarm = 0
    let tieredToCold = 0
    let errors = 0

    for (const { $id, targetTier, metadata } of candidates) {
      if (options.dryRun) {
        results.push({
          success: true,
          fromTier: metadata.tier,
          toTier: targetTier,
          key: $id,
        })
        if (targetTier === 'warm') tieredToWarm++
        if (targetTier === 'cold') tieredToCold++
        continue
      }

      let result: TierOperationResult

      if (targetTier === 'warm' && metadata.tier === 'hot') {
        result = await this.tierToWarm($id)
        if (result.success) tieredToWarm++
      } else if (targetTier === 'cold') {
        if (metadata.tier === 'hot') {
          // First tier to warm, then to cold
          const warmResult = await this.tierToWarm($id)
          if (warmResult.success) {
            result = await this.tierToCold($id)
            if (result.success) tieredToCold++
          } else {
            result = warmResult
          }
        } else {
          result = await this.tierToCold($id)
          if (result.success) tieredToCold++
        }
      } else {
        continue
      }

      if (!result!.success) errors++
      results.push(result!)
    }

    return {
      evaluated: candidates.length,
      tieredToWarm,
      tieredToCold,
      errors,
      results,
    }
  }

  /**
   * Get tier statistics
   */
  async getStats(): Promise<TierStats> {
    // Hot tier stats
    const hotStats = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(size_bytes), 0) as size_bytes,
        COALESCE(AVG(? - created_at), 0) as avg_age,
        COALESCE(AVG(access_count), 0) as avg_access_count
      FROM document_tier_metadata
      WHERE "$type" = ? AND tier = 'hot'
    `).get(Date.now(), this.type) as {
      count: number
      size_bytes: number
      avg_age: number
      avg_access_count: number
    }

    // Warm tier stats (from R2)
    let warmStats = { count: 0, sizeBytes: 0 }
    if (this.r2Warm) {
      try {
        const list = await this.r2Warm.list({ prefix: this.keyPrefix })
        warmStats = {
          count: list.objects.length,
          sizeBytes: list.objects.reduce((sum, obj) => sum + obj.size, 0),
        }
      } catch {
        // R2 not available
      }
    }

    // Cold tier stats (from R2)
    let coldStats = { count: 0, sizeBytes: 0 }
    if (this.r2Cold) {
      try {
        const list = await this.r2Cold.list({ prefix: this.keyPrefix })
        coldStats = {
          count: list.objects.length,
          sizeBytes: list.objects.reduce((sum, obj) => sum + obj.size, 0),
        }
      } catch {
        // R2 not available
      }
    }

    return {
      hot: {
        count: hotStats.count,
        sizeBytes: hotStats.size_bytes,
        avgAge: hotStats.avg_age,
        avgAccessCount: hotStats.avg_access_count,
      },
      warm: warmStats,
      cold: coldStats,
    }
  }

  /**
   * Clean up metadata for deleted documents
   */
  cleanupOrphanedMetadata(): number {
    const result = this.db.prepare(`
      DELETE FROM document_tier_metadata
      WHERE "$id" NOT IN (SELECT "$id" FROM documents)
      AND tier = 'hot'
    `).run()

    return result.changes
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { ageBasedPolicy } from '../core/tiering/policy'
