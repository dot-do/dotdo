/**
 * Tiering Integration Test Worker
 *
 * Test worker for R2 tiering integration tests with real storage.
 * Used by @cloudflare/vitest-pool-workers to test tier promotion/demotion
 * with actual R2 buckets (via miniflare's in-memory R2).
 *
 * @module workers/tiering-test-worker
 */

import { DurableObject, RpcTarget } from 'cloudflare:workers'
import {
  TieredStorageManager,
  type R2BucketInterface,
  type TieredStorage,
  type TieredStorageEnv,
} from '../objects/persistence/tiered-storage-manager'
import type { StorageTier, TieredStorageConfig } from '../objects/persistence/types'

// ============================================================================
// TYPES
// ============================================================================

export interface TieringTestEnv extends TieredStorageEnv {
  TIERING_TEST_DO: DurableObjectNamespace
  R2_WARM: R2Bucket
  R2_COLD: R2Bucket
}

// ============================================================================
// RPC WRAPPER
// ============================================================================

/**
 * RPC-enabled wrapper for TieredStorageManager.
 * Exposes all tiering operations for integration testing.
 */
class TieringRpc extends RpcTarget {
  constructor(private manager: TieredStorageManager) {
    super()
  }

  async put(key: string, data: unknown): Promise<void> {
    return this.manager.put(key, data)
  }

  async putToTier(key: string, data: unknown, tier: StorageTier): Promise<void> {
    return this.manager.putToTier(key, data, tier)
  }

  async get(key: string): Promise<unknown> {
    return this.manager.get(key)
  }

  async delete(key: string): Promise<void> {
    return this.manager.delete(key)
  }

  async getLocation(key: string): Promise<{
    tier: StorageTier
    path: string
    sizeBytes: number
    lastAccessAt: number
    accessCount: number
  } | null> {
    return this.manager.getLocation(key)
  }

  async existsInTier(key: string, tier: StorageTier): Promise<boolean> {
    return this.manager.existsInTier(key, tier)
  }

  async promote(key: string, targetTier: StorageTier): Promise<{
    itemsPromoted: number
    bytesTransferred: number
    fromTier: StorageTier
    toTier: StorageTier
    durationMs: number
    errors: string[]
  }> {
    return this.manager.promote(key, targetTier)
  }

  async runDemotion(): Promise<{
    itemsDemoted: number
    bytesTransferred: number
    fromTier: StorageTier
    toTier: StorageTier
    durationMs: number
    r2Paths: string[]
  }> {
    return this.manager.runDemotion()
  }

  async getStats(): Promise<{ hot: number; warm: number; cold: number; archive: number }> {
    return this.manager.getStats()
  }

  async getSizeStats(): Promise<{ hot: number; warm: number; cold: number }> {
    return this.manager.getSizeStats()
  }

  async getAccessStats(): Promise<{
    totalReads: number
    hotHits: number
    warmHits: number
    coldHits: number
  }> {
    return this.manager.getAccessStats()
  }

  async listAll(): Promise<Array<{ key: string; tier: StorageTier }>> {
    return this.manager.listAll()
  }

  async clearAll(): Promise<void> {
    return this.manager.clearAll()
  }

  async createBackup(): Promise<{ backupId: string; itemCount: number }> {
    return this.manager.createBackup()
  }

  async restoreFromBackup(backupId: string): Promise<{ itemsRestored: number }> {
    return this.manager.restoreFromBackup(backupId)
  }

  async collectGarbage(): Promise<{ orphansRemoved: number }> {
    return this.manager.collectGarbage()
  }

  configure(config: TieredStorageConfig): void {
    return this.manager.configure(config)
  }
}

// ============================================================================
// TEST DURABLE OBJECT
// ============================================================================

/**
 * Schema statements for hot tier SQLite table
 */
const HOT_TIER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS hot_tier (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    access_count INTEGER DEFAULT 1,
    last_access_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`

/**
 * Test DO class for tiering integration tests.
 * Provides TieredStorageManager with real R2 bucket bindings.
 */
export class TieringTestDO extends DurableObject<TieringTestEnv> {
  private tieredManager: TieredStorageManager
  private tieringRpc?: TieringRpc
  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: TieringTestEnv) {
    super(ctx, env)

    // Create storage wrapper for TieredStorageManager
    const storage: TieredStorage = {
      sql: ctx.storage.sql,
    }

    // Create tiered storage manager with R2 bindings
    this.tieredManager = new TieredStorageManager(storage, env, {
      config: {
        warmBucket: 'R2_WARM',
        coldBucket: 'R2_COLD',
        hotRetentionMs: 1000, // 1 second for testing
        hotAccessThreshold: 3,
        autoPromote: true,
        compressCold: true,
      },
    })

    // Initialize schema
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      this.ctx.storage.sql.exec(HOT_TIER_SCHEMA)
      this.schemaInitialized = true
    } catch (error) {
      // Schema might already exist
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes('already exists')) {
        console.error('[TieringTestDO] Schema init error:', error)
      }
      this.schemaInitialized = true
    }
  }

  /**
   * Get the tiering RPC interface
   */
  getTiering(): TieringRpc {
    if (!this.tieringRpc) {
      this.tieringRpc = new TieringRpc(this.tieredManager)
    }
    return this.tieringRpc
  }

  // Flat methods for direct RPC access
  async tieringPut(key: string, data: unknown): Promise<void> {
    return this.tieredManager.put(key, data)
  }

  async tieringPutToTier(key: string, data: unknown, tier: StorageTier): Promise<void> {
    return this.tieredManager.putToTier(key, data, tier)
  }

  async tieringGet(key: string): Promise<unknown> {
    return this.tieredManager.get(key)
  }

  async tieringDelete(key: string): Promise<void> {
    return this.tieredManager.delete(key)
  }

  async tieringGetLocation(key: string): Promise<{
    tier: StorageTier
    path: string
    sizeBytes: number
    lastAccessAt: number
    accessCount: number
  } | null> {
    return this.tieredManager.getLocation(key)
  }

  async tieringExistsInTier(key: string, tier: StorageTier): Promise<boolean> {
    return this.tieredManager.existsInTier(key, tier)
  }

  async tieringPromote(key: string, targetTier: StorageTier): Promise<{
    itemsPromoted: number
    bytesTransferred: number
    fromTier: StorageTier
    toTier: StorageTier
    durationMs: number
    errors: string[]
  }> {
    return this.tieredManager.promote(key, targetTier)
  }

  async tieringRunDemotion(): Promise<{
    itemsDemoted: number
    bytesTransferred: number
    fromTier: StorageTier
    toTier: StorageTier
    durationMs: number
    r2Paths: string[]
  }> {
    return this.tieredManager.runDemotion()
  }

  async tieringGetStats(): Promise<{ hot: number; warm: number; cold: number; archive: number }> {
    return this.tieredManager.getStats()
  }

  async tieringGetSizeStats(): Promise<{ hot: number; warm: number; cold: number }> {
    return this.tieredManager.getSizeStats()
  }

  async tieringGetAccessStats(): Promise<{
    totalReads: number
    hotHits: number
    warmHits: number
    coldHits: number
  }> {
    return this.tieredManager.getAccessStats()
  }

  async tieringListAll(): Promise<Array<{ key: string; tier: StorageTier }>> {
    return this.tieredManager.listAll()
  }

  async tieringClearAll(): Promise<void> {
    return this.tieredManager.clearAll()
  }

  async tieringConfigure(config: TieredStorageConfig): Promise<void> {
    return this.tieredManager.configure(config)
  }

  async tieringCreateBackup(): Promise<{ backupId: string; itemCount: number }> {
    return this.tieredManager.createBackup()
  }

  async tieringRestoreFromBackup(backupId: string): Promise<{ itemsRestored: number }> {
    return this.tieredManager.restoreFromBackup(backupId)
  }

  async tieringCollectGarbage(): Promise<{ orphansRemoved: number }> {
    return this.tieredManager.collectGarbage()
  }

  /**
   * Handle fetch requests (for basic health checks)
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Tiering Test DO', { status: 200 })
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

/**
 * Worker entry point for tiering integration tests.
 */
export default {
  async fetch(request: Request, env: TieringTestEnv): Promise<Response> {
    const ns = request.headers.get('X-DO-NS') || 'test'
    const id = env.TIERING_TEST_DO.idFromName(ns)
    const stub = env.TIERING_TEST_DO.get(id)
    return stub.fetch(request)
  },
}
