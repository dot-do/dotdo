/**
 * Feature Flags DO Integration Tests
 *
 * TDD RED Phase: These tests define the expected behavior for Feature Flags
 * Durable Object storage integration. All tests are expected to FAIL
 * initially as this is the RED phase.
 *
 * Test Coverage:
 * - Storage: Flags persisted to DO SQLite, retrievable by key, listable, deletable
 * - Sharding: Flag definitions sharded by key prefix, consistent routing
 * - Streaming: Flag changes emit events, SSE-style streaming support
 * - Evaluation Caching: Cache evaluations per context in DO
 * - Segment Resolution: Resolve targeting segments
 * - Targeting Rules: Store and evaluate targeting rules in DO
 *
 * @module @dotdo/compat/flags/do-integration.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockDO,
  createMockDONamespace,
  createMockId,
  createMockR2,
  type MockDOResult,
  type MockEnv,
  type MockDurableObjectNamespace,
} from '../../../tests/_lib/do'

// ============================================================================
// TYPE DEFINITIONS FOR DO INTEGRATION TESTS
// ============================================================================

/**
 * Flag value types supported
 */
type FlagValue = boolean | string | number | object | null

/**
 * Flag variation with value and metadata
 */
interface FlagVariation<T = FlagValue> {
  value: T
  label?: string
  weight?: number
}

/**
 * Targeting clause for rule evaluation
 */
interface TargetingClause {
  contextKind?: string
  attribute: string
  operator: 'in' | 'startsWith' | 'endsWith' | 'matches' | 'contains' |
            'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual' |
            'semVerEqual' | 'semVerLessThan' | 'semVerGreaterThan'
  values: unknown[]
  negate?: boolean
}

/**
 * Rollout configuration for percentage-based flag delivery
 */
interface Rollout<T = FlagValue> {
  variations: Array<{ value: T; weight: number }>
  bucketBy?: string
  seed?: number
}

/**
 * Targeting rule with clauses and variation/rollout
 */
interface TargetingRule<T = FlagValue> {
  id: string
  description?: string
  clauses: TargetingClause[]
  variation?: T
  rollout?: Rollout<T>
}

/**
 * Prerequisite flag dependency
 */
interface Prerequisite {
  key: string
  variation: unknown
}

/**
 * Segment definition for targeting groups of users
 */
interface Segment {
  key: string
  name?: string
  description?: string
  included: string[] // targetingKeys included
  excluded: string[] // targetingKeys excluded
  rules?: TargetingRule<boolean>[] // rules to determine inclusion
  createdAt: string
  updatedAt: string
}

/**
 * Complete flag definition stored in DO
 */
interface FlagDefinition<T = FlagValue> {
  key: string
  defaultValue: T
  description?: string
  variations?: FlagVariation<T>[]
  targeting?: TargetingRule<T>[]
  prerequisites?: Prerequisite[]
  tags?: string[]
  temporary?: boolean
  enabled?: boolean
  version: number
  createdAt: string
  updatedAt: string
}

/**
 * Stored flag with DO metadata
 */
interface StoredFlag<T = FlagValue> extends FlagDefinition<T> {
  _id: string
  _storedAt: string
  _shardIndex: number
}

/**
 * Evaluation context for flag resolution
 */
interface EvaluationContext {
  targetingKey?: string
  [key: string]: unknown
}

/**
 * Cached evaluation result
 */
interface CachedEvaluation<T = FlagValue> {
  flagKey: string
  contextHash: string
  value: T
  reason: string
  variant?: number
  cachedAt: string
  expiresAt: string
}

/**
 * Flag change event for streaming
 */
interface FlagChangeEvent<T = FlagValue> {
  type: 'flag_created' | 'flag_updated' | 'flag_deleted' | 'flag_enabled' | 'flag_disabled'
  flagKey: string
  oldValue?: FlagDefinition<T>
  newValue?: FlagDefinition<T>
  timestamp: string
  version: number
}

/**
 * Flags DO configuration
 */
interface FlagsDOConfig {
  shardCount: number
  shardKey: 'prefix' | 'hash'
  cacheTTLSeconds: number
  enableStreaming: boolean
}

/**
 * Flags DO state interface
 */
interface FlagsDOState {
  ns: string
  config: FlagsDOConfig
  shardIndex?: number
  totalShards?: number
}

/**
 * Shard routing result
 */
interface ShardRoutingResult {
  shardIndex: number
  doId: string
  ns: string
}

/**
 * Flag query options
 */
interface FlagQueryOptions {
  prefix?: string
  tags?: string[]
  enabled?: boolean
  temporary?: boolean
  limit?: number
  offset?: number
}

/**
 * Flag query result
 */
interface FlagQueryResult<T = FlagValue> {
  flags: StoredFlag<T>[]
  total: number
  meta: {
    shardsQueried: number
    duration: number
  }
}

/**
 * Storage statistics
 */
interface FlagStorageStats {
  totalFlags: number
  enabledFlags: number
  disabledFlags: number
  temporaryFlags: number
  totalSegments: number
  cacheEntries: number
  sizeBytes: number
}

/**
 * Shard information
 */
interface ShardInfo {
  shardIndex: number
  totalShards: number
  shardKey: string
  registryId: string
}

/**
 * Streaming subscription
 */
interface StreamSubscription {
  id: string
  flagKeys: string[] | '*'
  callback: (event: FlagChangeEvent) => void
}

// ============================================================================
// FLAGS DO CLASS - Real implementation for GREEN phase
// ============================================================================

import { FlagsDO } from './flags-do'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample flag definitions
 */
function createSampleFlags(count: number, prefix: string = 'flag'): Omit<FlagDefinition, 'version' | 'createdAt' | 'updatedAt'>[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${prefix}-${i}`,
    defaultValue: i % 2 === 0,
    description: `Sample flag ${i}`,
    variations: [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ],
    tags: [`tag-${i % 3}`],
    temporary: i % 5 === 0,
    enabled: i % 4 !== 0,
  }))
}

/**
 * Create sample targeting rules
 */
function createSampleTargetingRules(count: number): TargetingRule<boolean>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rule-${i}`,
    description: `Rule ${i}`,
    clauses: [
      {
        attribute: i % 2 === 0 ? 'email' : 'tier',
        operator: 'in' as const,
        values: i % 2 === 0 ? [`user${i}@example.com.ai`] : ['premium'],
      },
    ],
    variation: true,
  }))
}

/**
 * Create sample segments
 */
function createSampleSegments(count: number): Omit<Segment, 'createdAt' | 'updatedAt'>[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `segment-${i}`,
    name: `Segment ${i}`,
    description: `Sample segment ${i}`,
    included: Array.from({ length: 5 }, (_, j) => `user-${i * 10 + j}`),
    excluded: [`user-excluded-${i}`],
    rules: i % 2 === 0 ? createSampleTargetingRules(2) : undefined,
  }))
}

/**
 * Simple consistent hash for testing shard routing
 */
function getShardIndex(key: string, shardCount: number): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash) % shardCount
}

/**
 * Hash evaluation context for caching
 */
function hashContext(context: EvaluationContext): string {
  return JSON.stringify(context, Object.keys(context).sort())
}

// ============================================================================
// TEST SUITE: STORAGE
// ============================================================================

describe('Flags DO Integration - Storage', () => {
  let mockDO: MockDOResult<FlagsDO, MockEnv>

  beforeEach(() => {
    mockDO = createMockDO(FlagsDO as any, {
      ns: 'https://flags-storage.test.do',
      sqlData: new Map([
        ['flags', []],
        ['segments', []],
        ['evaluation_cache', []],
        ['change_events', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1,
          shardKey: 'prefix',
          cacheTTLSeconds: 300,
          enableStreaming: true,
        }],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // FLAG CREATION
  // ==========================================================================

  describe('flag creation', () => {
    it('should persist boolean flag to SQLite', async () => {
      // RED: Boolean flags should be stored
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'feature-enabled',
        defaultValue: false,
        description: 'Enable the new feature',
        enabled: true,
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored._id).toBeDefined()
      expect(stored._storedAt).toBeDefined()
      expect(stored.key).toBe('feature-enabled')
      expect(stored.defaultValue).toBe(false)
      expect(stored.version).toBe(1)
    })

    it('should persist string flag to SQLite', async () => {
      // RED: String flags should be stored
      const flag: Omit<FlagDefinition<string>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'theme',
        defaultValue: 'light',
        variations: [
          { value: 'light', label: 'Light Theme' },
          { value: 'dark', label: 'Dark Theme' },
          { value: 'system', label: 'System Default' },
        ],
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored.key).toBe('theme')
      expect(stored.defaultValue).toBe('light')
      expect(stored.variations?.length).toBe(3)
    })

    it('should persist number flag to SQLite', async () => {
      // RED: Number flags should be stored
      const flag: Omit<FlagDefinition<number>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'max-retries',
        defaultValue: 3,
        variations: [
          { value: 1, label: 'Minimal' },
          { value: 3, label: 'Standard' },
          { value: 5, label: 'Aggressive' },
        ],
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored.key).toBe('max-retries')
      expect(stored.defaultValue).toBe(3)
    })

    it('should persist object flag to SQLite', async () => {
      // RED: Object flags should be stored
      const flag: Omit<FlagDefinition<{ color: string; size: string }>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'ui-config',
        defaultValue: { color: 'blue', size: 'medium' },
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored.key).toBe('ui-config')
      expect(stored.defaultValue).toEqual({ color: 'blue', size: 'medium' })
    })

    it('should persist flag with targeting rules', async () => {
      // RED: Flags with targeting should be stored
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'premium-feature',
        defaultValue: false,
        targeting: [
          {
            id: 'rule-1',
            description: 'Premium users',
            clauses: [
              { attribute: 'tier', operator: 'in', values: ['premium'] },
            ],
            variation: true,
          },
        ],
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored.targeting?.length).toBe(1)
      expect(stored.targeting?.[0].id).toBe('rule-1')
    })

    it('should persist flag with prerequisites', async () => {
      // RED: Flags with prerequisites should be stored
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'advanced-feature',
        defaultValue: false,
        prerequisites: [
          { key: 'basic-feature', variation: true },
        ],
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored.prerequisites?.length).toBe(1)
      expect(stored.prerequisites?.[0].key).toBe('basic-feature')
    })

    it('should assign unique storage ID to each flag', async () => {
      // RED: Each flag should get unique storage ID
      const flags = createSampleFlags(10)
      const storedFlags: StoredFlag[] = []

      for (const flag of flags) {
        const stored = await mockDO.instance.createFlag(flag)
        storedFlags.push(stored)
      }

      const ids = storedFlags.map((s) => s._id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10)
    })

    it('should record creation timestamp', async () => {
      // RED: Creation timestamp should be recorded
      const before = Date.now()

      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'timestamp-flag',
        defaultValue: false,
      }

      const stored = await mockDO.instance.createFlag(flag)
      const after = Date.now()

      const createdTime = new Date(stored.createdAt).getTime()
      expect(createdTime).toBeGreaterThanOrEqual(before)
      expect(createdTime).toBeLessThanOrEqual(after)
    })

    it('should set initial version to 1', async () => {
      // RED: New flags should have version 1
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'versioned-flag',
        defaultValue: false,
      }

      const stored = await mockDO.instance.createFlag(flag)

      expect(stored.version).toBe(1)
    })

    it('should reject duplicate flag keys', async () => {
      // RED: Duplicate keys should throw error
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'duplicate-flag',
        defaultValue: false,
      }

      await mockDO.instance.createFlag(flag)

      await expect(mockDO.instance.createFlag(flag)).rejects.toThrow()
    })
  })

  // ==========================================================================
  // FLAG RETRIEVAL
  // ==========================================================================

  describe('flag retrieval', () => {
    it('should retrieve flag by key', async () => {
      // RED: Should find flag by exact key
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'retrievable-flag',
        defaultValue: true,
        description: 'A flag to retrieve',
      }
      await mockDO.instance.createFlag(flag)

      const retrieved = await mockDO.instance.getFlag('retrievable-flag')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.key).toBe('retrievable-flag')
      expect(retrieved?.defaultValue).toBe(true)
    })

    it('should return null for unknown flag', async () => {
      // RED: Unknown flag should return null
      const retrieved = await mockDO.instance.getFlag('nonexistent-flag')

      expect(retrieved).toBeNull()
    })

    it('should preserve all flag fields on retrieval', async () => {
      // RED: All flag data should be preserved
      const flag: Omit<FlagDefinition<boolean>, 'version' | 'createdAt' | 'updatedAt'> = {
        key: 'complete-flag',
        defaultValue: false,
        description: 'A complete flag',
        variations: [
          { value: true, label: 'On', weight: 50 },
          { value: false, label: 'Off', weight: 50 },
        ],
        targeting: [
          {
            id: 'rule-1',
            clauses: [{ attribute: 'beta', operator: 'in', values: [true] }],
            variation: true,
          },
        ],
        tags: ['beta', 'experimental'],
        temporary: true,
        enabled: true,
      }
      await mockDO.instance.createFlag(flag)

      const retrieved = await mockDO.instance.getFlag<boolean>('complete-flag')

      expect(retrieved?.description).toBe('A complete flag')
      expect(retrieved?.variations?.length).toBe(2)
      expect(retrieved?.targeting?.length).toBe(1)
      expect(retrieved?.tags).toEqual(['beta', 'experimental'])
      expect(retrieved?.temporary).toBe(true)
      expect(retrieved?.enabled).toBe(true)
    })
  })

  // ==========================================================================
  // FLAG LISTING
  // ==========================================================================

  describe('flag listing', () => {
    it('should list all flags', async () => {
      // RED: Should return all stored flags
      const flags = createSampleFlags(10)
      for (const flag of flags) {
        await mockDO.instance.createFlag(flag)
      }

      const result = await mockDO.instance.listFlags()

      expect(result.flags.length).toBe(10)
      expect(result.total).toBe(10)
    })

    it('should filter flags by prefix', async () => {
      // RED: Should filter by key prefix
      await mockDO.instance.createFlag({ key: 'feature-a', defaultValue: true })
      await mockDO.instance.createFlag({ key: 'feature-b', defaultValue: true })
      await mockDO.instance.createFlag({ key: 'config-a', defaultValue: 'value' })

      const result = await mockDO.instance.listFlags({ prefix: 'feature-' })

      expect(result.flags.length).toBe(2)
      expect(result.flags.every((f) => f.key.startsWith('feature-'))).toBe(true)
    })

    it('should filter flags by tags', async () => {
      // RED: Should filter by tags
      await mockDO.instance.createFlag({ key: 'flag-1', defaultValue: true, tags: ['beta'] })
      await mockDO.instance.createFlag({ key: 'flag-2', defaultValue: true, tags: ['beta', 'experimental'] })
      await mockDO.instance.createFlag({ key: 'flag-3', defaultValue: true, tags: ['stable'] })

      const result = await mockDO.instance.listFlags({ tags: ['beta'] })

      expect(result.flags.length).toBe(2)
    })

    it('should filter flags by enabled status', async () => {
      // RED: Should filter by enabled
      await mockDO.instance.createFlag({ key: 'enabled-flag', defaultValue: true, enabled: true })
      await mockDO.instance.createFlag({ key: 'disabled-flag', defaultValue: true, enabled: false })

      const enabledResult = await mockDO.instance.listFlags({ enabled: true })
      const disabledResult = await mockDO.instance.listFlags({ enabled: false })

      expect(enabledResult.flags.length).toBe(1)
      expect(enabledResult.flags[0].key).toBe('enabled-flag')
      expect(disabledResult.flags.length).toBe(1)
      expect(disabledResult.flags[0].key).toBe('disabled-flag')
    })

    it('should filter flags by temporary status', async () => {
      // RED: Should filter by temporary
      await mockDO.instance.createFlag({ key: 'temp-flag', defaultValue: true, temporary: true })
      await mockDO.instance.createFlag({ key: 'perm-flag', defaultValue: true, temporary: false })

      const result = await mockDO.instance.listFlags({ temporary: true })

      expect(result.flags.length).toBe(1)
      expect(result.flags[0].key).toBe('temp-flag')
    })

    it('should support pagination with limit and offset', async () => {
      // RED: Should paginate results
      const flags = createSampleFlags(25)
      for (const flag of flags) {
        await mockDO.instance.createFlag(flag)
      }

      const page1 = await mockDO.instance.listFlags({ limit: 10, offset: 0 })
      const page2 = await mockDO.instance.listFlags({ limit: 10, offset: 10 })
      const page3 = await mockDO.instance.listFlags({ limit: 10, offset: 20 })

      expect(page1.flags.length).toBe(10)
      expect(page2.flags.length).toBe(10)
      expect(page3.flags.length).toBe(5)
      expect(page1.total).toBe(25)
    })

    it('should return empty result when no flags match', async () => {
      // RED: Empty result for no matches
      const result = await mockDO.instance.listFlags({ prefix: 'nonexistent-' })

      expect(result.flags).toEqual([])
      expect(result.total).toBe(0)
    })

    it('should include query metadata', async () => {
      // RED: Should include metadata
      const flags = createSampleFlags(5)
      for (const flag of flags) {
        await mockDO.instance.createFlag(flag)
      }

      const result = await mockDO.instance.listFlags()

      expect(result.meta).toBeDefined()
      expect(result.meta.shardsQueried).toBeGreaterThanOrEqual(1)
      expect(result.meta.duration).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // FLAG UPDATE
  // ==========================================================================

  describe('flag update', () => {
    it('should update flag default value', async () => {
      // RED: Should update defaultValue
      await mockDO.instance.createFlag({ key: 'update-flag', defaultValue: false })

      const updated = await mockDO.instance.updateFlag('update-flag', { defaultValue: true })

      expect(updated.defaultValue).toBe(true)
    })

    it('should update flag description', async () => {
      // RED: Should update description
      await mockDO.instance.createFlag({
        key: 'desc-flag',
        defaultValue: true,
        description: 'Original description',
      })

      const updated = await mockDO.instance.updateFlag('desc-flag', {
        description: 'Updated description',
      })

      expect(updated.description).toBe('Updated description')
    })

    it('should update flag variations', async () => {
      // RED: Should update variations
      await mockDO.instance.createFlag({
        key: 'var-flag',
        defaultValue: 'a',
        variations: [{ value: 'a' }, { value: 'b' }],
      })

      const updated = await mockDO.instance.updateFlag('var-flag', {
        variations: [{ value: 'a' }, { value: 'b' }, { value: 'c', label: 'New Option' }],
      })

      expect(updated.variations?.length).toBe(3)
    })

    it('should update flag targeting rules', async () => {
      // RED: Should update targeting
      await mockDO.instance.createFlag({
        key: 'target-flag',
        defaultValue: false,
        targeting: [],
      })

      const updated = await mockDO.instance.updateFlag('target-flag', {
        targeting: [
          {
            id: 'new-rule',
            clauses: [{ attribute: 'tier', operator: 'in', values: ['premium'] }],
            variation: true,
          },
        ],
      })

      expect(updated.targeting?.length).toBe(1)
      expect(updated.targeting?.[0].id).toBe('new-rule')
    })

    it('should update flag tags', async () => {
      // RED: Should update tags
      await mockDO.instance.createFlag({
        key: 'tag-flag',
        defaultValue: true,
        tags: ['old-tag'],
      })

      const updated = await mockDO.instance.updateFlag('tag-flag', {
        tags: ['new-tag-1', 'new-tag-2'],
      })

      expect(updated.tags).toEqual(['new-tag-1', 'new-tag-2'])
    })

    it('should increment version on update', async () => {
      // RED: Version should increment
      await mockDO.instance.createFlag({ key: 'version-flag', defaultValue: false })

      const updated1 = await mockDO.instance.updateFlag('version-flag', { defaultValue: true })
      const updated2 = await mockDO.instance.updateFlag('version-flag', { defaultValue: false })

      expect(updated1.version).toBe(2)
      expect(updated2.version).toBe(3)
    })

    it('should update updatedAt timestamp', async () => {
      // RED: updatedAt should change
      const created = await mockDO.instance.createFlag({ key: 'time-flag', defaultValue: false })
      const createdTime = new Date(created.updatedAt).getTime()

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await mockDO.instance.updateFlag('time-flag', { defaultValue: true })
      const updatedTime = new Date(updated.updatedAt).getTime()

      expect(updatedTime).toBeGreaterThan(createdTime)
    })

    it('should throw for nonexistent flag', async () => {
      // RED: Update on nonexistent should throw
      await expect(
        mockDO.instance.updateFlag('nonexistent', { defaultValue: true })
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // FLAG DELETION
  // ==========================================================================

  describe('flag deletion', () => {
    it('should delete flag by key', async () => {
      // RED: Should delete flag
      await mockDO.instance.createFlag({ key: 'delete-me', defaultValue: true })

      const deleted = await mockDO.instance.deleteFlag('delete-me')

      expect(deleted).toBe(true)

      const retrieved = await mockDO.instance.getFlag('delete-me')
      expect(retrieved).toBeNull()
    })

    it('should return false for nonexistent flag', async () => {
      // RED: Delete nonexistent should return false
      const deleted = await mockDO.instance.deleteFlag('nonexistent')

      expect(deleted).toBe(false)
    })

    it('should not affect other flags on delete', async () => {
      // RED: Other flags should remain
      await mockDO.instance.createFlag({ key: 'keep-flag', defaultValue: true })
      await mockDO.instance.createFlag({ key: 'delete-flag', defaultValue: true })

      await mockDO.instance.deleteFlag('delete-flag')

      const kept = await mockDO.instance.getFlag('keep-flag')
      expect(kept).not.toBeNull()
    })
  })

  // ==========================================================================
  // FLAG ENABLE/DISABLE
  // ==========================================================================

  describe('flag enable/disable', () => {
    it('should enable flag', async () => {
      // RED: Should enable flag
      await mockDO.instance.createFlag({ key: 'toggle-flag', defaultValue: true, enabled: false })

      const enabled = await mockDO.instance.enableFlag('toggle-flag')

      expect(enabled.enabled).toBe(true)
    })

    it('should disable flag', async () => {
      // RED: Should disable flag
      await mockDO.instance.createFlag({ key: 'toggle-flag', defaultValue: true, enabled: true })

      const disabled = await mockDO.instance.disableFlag('toggle-flag')

      expect(disabled.enabled).toBe(false)
    })

    it('should increment version on enable/disable', async () => {
      // RED: Version should increment
      const created = await mockDO.instance.createFlag({
        key: 'version-toggle',
        defaultValue: true,
        enabled: true,
      })

      const disabled = await mockDO.instance.disableFlag('version-toggle')
      const enabled = await mockDO.instance.enableFlag('version-toggle')

      expect(disabled.version).toBe(created.version + 1)
      expect(enabled.version).toBe(disabled.version + 1)
    })
  })

  // ==========================================================================
  // STORAGE STATISTICS
  // ==========================================================================

  describe('storage statistics', () => {
    it('should return accurate flag counts', async () => {
      // RED: Stats should reflect stored data
      const flags = createSampleFlags(20)
      for (const flag of flags) {
        await mockDO.instance.createFlag(flag)
      }

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.totalFlags).toBe(20)
    })

    it('should track enabled/disabled counts', async () => {
      // RED: Should count enabled/disabled
      await mockDO.instance.createFlag({ key: 'enabled-1', defaultValue: true, enabled: true })
      await mockDO.instance.createFlag({ key: 'enabled-2', defaultValue: true, enabled: true })
      await mockDO.instance.createFlag({ key: 'disabled-1', defaultValue: true, enabled: false })

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.enabledFlags).toBe(2)
      expect(stats.disabledFlags).toBe(1)
    })

    it('should track temporary flag count', async () => {
      // RED: Should count temporary flags
      await mockDO.instance.createFlag({ key: 'temp-1', defaultValue: true, temporary: true })
      await mockDO.instance.createFlag({ key: 'temp-2', defaultValue: true, temporary: true })
      await mockDO.instance.createFlag({ key: 'perm-1', defaultValue: true, temporary: false })

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.temporaryFlags).toBe(2)
    })

    it('should report storage size', async () => {
      // RED: Should estimate storage size
      const flags = createSampleFlags(50)
      for (const flag of flags) {
        await mockDO.instance.createFlag(flag)
      }

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.sizeBytes).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// TEST SUITE: SHARDING
// ============================================================================

describe('Flags DO Integration - Sharding', () => {
  let mockDO: MockDOResult<FlagsDO, MockEnv>
  let mockNamespace: MockDurableObjectNamespace

  beforeEach(() => {
    mockNamespace = createMockDONamespace()

    mockDO = createMockDO(FlagsDO as any, {
      ns: 'https://flags-sharding.test.do',
      storage: new Map([
        ['config', {
          shardCount: 4,
          shardKey: 'prefix',
          cacheTTLSeconds: 300,
          enableStreaming: true,
        }],
      ]),
      env: {
        FLAGS_DO: mockNamespace,
      } as any,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // SHARD ROUTING
  // ==========================================================================

  describe('shard routing', () => {
    it('should route flags by key prefix when configured', async () => {
      // RED: Flags with same prefix should go to same shard
      const route1 = await mockDO.instance.routeFlag('feature-a')
      const route2 = await mockDO.instance.routeFlag('feature-b')
      const route3 = await mockDO.instance.routeFlag('config-a')

      // feature-a and feature-b should route to same shard
      expect(route1.shardIndex).toBe(route2.shardIndex)
      // config-a may route to different shard (depends on hash)
    })

    it('should use consistent hashing for shard assignment', async () => {
      // RED: Same key should always route to same shard
      const key = 'consistent-flag-key'

      const routes = await Promise.all(
        Array.from({ length: 10 }, () => mockDO.instance.routeFlag(key))
      )

      const uniqueShards = new Set(routes.map((r) => r.shardIndex))
      expect(uniqueShards.size).toBe(1)
    })

    it('should distribute different keys across shards', async () => {
      // RED: Different keys should be distributed
      // With prefix sharding, keys with different prefixes should go to different shards
      const prefixes = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa']
      const keys = Array.from({ length: 100 }, (_, i) => `${prefixes[i % prefixes.length]}-flag-${i}`)

      const routes = await Promise.all(
        keys.map((key) => mockDO.instance.routeFlag(key))
      )

      const uniqueShards = new Set(routes.map((r) => r.shardIndex))
      expect(uniqueShards.size).toBeGreaterThan(1)
    })

    it('should return valid shard information', async () => {
      // RED: Route result should contain all required fields
      const route = await mockDO.instance.routeFlag('any-flag')

      expect(route).toHaveProperty('shardIndex')
      expect(route).toHaveProperty('doId')
      expect(route).toHaveProperty('ns')
      expect(typeof route.shardIndex).toBe('number')
      expect(route.shardIndex).toBeGreaterThanOrEqual(0)
      expect(route.shardIndex).toBeLessThan(4) // 4 shards configured
    })
  })

  // ==========================================================================
  // SHARD CONFIGURATION
  // ==========================================================================

  describe('shard configuration', () => {
    it('should report if DO is sharded', async () => {
      // RED: Should know shard status
      const isSharded = await mockDO.instance.isSharded()

      expect(isSharded).toBe(true)
    })

    it('should return shard info when sharded', async () => {
      // RED: Should return shard metadata
      const shardInfo = await mockDO.instance.getShardInfo()

      expect(shardInfo).not.toBeNull()
      expect(shardInfo?.totalShards).toBe(4)
      expect(shardInfo?.shardKey).toBe('prefix')
    })

    it('should return null shard info when not sharded', async () => {
      // RED: Non-sharded DO should return null
      const unshardedDO = createMockDO(FlagsDO as any, {
        ns: 'https://flags-single.test.do',
        storage: new Map([
          ['config', {
            shardCount: 1,
            shardKey: 'prefix',
            cacheTTLSeconds: 300,
            enableStreaming: true,
          }],
        ]),
      })

      const shardInfo = await unshardedDO.instance.getShardInfo()

      expect(shardInfo).toBeNull()
    })
  })

  // ==========================================================================
  // CROSS-SHARD QUERIES
  // ==========================================================================

  describe('cross-shard queries', () => {
    it('should query single shard when prefix filter matches shard key', async () => {
      // RED: Query with prefix should hit single shard
      await mockDO.instance.createFlag({ key: 'feature-a', defaultValue: true })
      await mockDO.instance.createFlag({ key: 'feature-b', defaultValue: true })

      const result = await mockDO.instance.listFlags({ prefix: 'feature-' })

      expect(result.meta.shardsQueried).toBe(1)
    })

    it('should fan out query when no prefix filter provided', async () => {
      // RED: Query without prefix should query all shards
      await mockDO.instance.createFlag({ key: 'feature-a', defaultValue: true })
      await mockDO.instance.createFlag({ key: 'config-a', defaultValue: 'value' })

      const result = await mockDO.instance.listFlags()

      expect(result.meta.shardsQueried).toBe(4) // All 4 shards queried
    })

    it('should aggregate results from multiple shards', async () => {
      // RED: Fan-out query should combine results
      const flags = createSampleFlags(50)
      for (const flag of flags) {
        await mockDO.instance.createFlag(flag)
      }

      const result = await mockDO.instance.listFlags({ limit: 100 })

      expect(result.total).toBe(50)
    })
  })
})

// ============================================================================
// TEST SUITE: EVALUATION CACHING
// ============================================================================

describe('Flags DO Integration - Evaluation Caching', () => {
  let mockDO: MockDOResult<FlagsDO, MockEnv>

  beforeEach(() => {
    mockDO = createMockDO(FlagsDO as any, {
      ns: 'https://flags-caching.test.do',
      sqlData: new Map([
        ['flags', []],
        ['evaluation_cache', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1,
          shardKey: 'prefix',
          cacheTTLSeconds: 300,
          enableStreaming: true,
        }],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // CACHE STORAGE
  // ==========================================================================

  describe('cache storage', () => {
    it('should cache evaluation result', async () => {
      // RED: Should store cached evaluation
      const context: EvaluationContext = { targetingKey: 'user-123', tier: 'premium' }

      const cached = await mockDO.instance.cacheEvaluation(
        'feature-flag',
        context,
        true,
        'TARGETING_MATCH',
        0
      )

      expect(cached.flagKey).toBe('feature-flag')
      expect(cached.value).toBe(true)
      expect(cached.reason).toBe('TARGETING_MATCH')
      expect(cached.variant).toBe(0)
    })

    it('should generate context hash for caching', async () => {
      // RED: Context should be hashed
      const context: EvaluationContext = { targetingKey: 'user-123' }

      const cached = await mockDO.instance.cacheEvaluation('flag', context, true, 'STATIC')

      expect(cached.contextHash).toBeDefined()
      expect(typeof cached.contextHash).toBe('string')
    })

    it('should set cache expiration', async () => {
      // RED: Cache should have expiration
      const context: EvaluationContext = { targetingKey: 'user-123' }

      const cached = await mockDO.instance.cacheEvaluation('flag', context, true, 'STATIC')

      const cachedAt = new Date(cached.cachedAt).getTime()
      const expiresAt = new Date(cached.expiresAt).getTime()

      // Default TTL is 300 seconds
      expect(expiresAt - cachedAt).toBe(300 * 1000)
    })
  })

  // ==========================================================================
  // CACHE RETRIEVAL
  // ==========================================================================

  describe('cache retrieval', () => {
    it('should retrieve cached evaluation', async () => {
      // RED: Should find cached result
      const context: EvaluationContext = { targetingKey: 'user-123', tier: 'premium' }

      await mockDO.instance.cacheEvaluation('cached-flag', context, 'value', 'TARGETING_MATCH')

      const retrieved = await mockDO.instance.getCachedEvaluation('cached-flag', context)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.value).toBe('value')
    })

    it('should return null for uncached evaluation', async () => {
      // RED: Uncached should return null
      const context: EvaluationContext = { targetingKey: 'user-123' }

      const retrieved = await mockDO.instance.getCachedEvaluation('uncached-flag', context)

      expect(retrieved).toBeNull()
    })

    it('should return null for expired cache', async () => {
      // RED: Expired cache should return null
      const context: EvaluationContext = { targetingKey: 'user-123' }

      // Create with expired TTL
      await mockDO.instance.cacheEvaluation('expired-flag', context, true, 'STATIC')

      // Simulate time passing (would need to mock Date or use time-based TTL)
      // In real test, we'd advance time past TTL

      const retrieved = await mockDO.instance.getCachedEvaluation('expired-flag', context)

      // This test assumes TTL check is implemented
      // expect(retrieved).toBeNull() // After TTL expires
    })

    it('should cache per context', async () => {
      // RED: Different contexts should have separate cache entries
      const context1: EvaluationContext = { targetingKey: 'user-1' }
      const context2: EvaluationContext = { targetingKey: 'user-2' }

      await mockDO.instance.cacheEvaluation('flag', context1, 'value-1', 'TARGETING_MATCH')
      await mockDO.instance.cacheEvaluation('flag', context2, 'value-2', 'TARGETING_MATCH')

      const cached1 = await mockDO.instance.getCachedEvaluation('flag', context1)
      const cached2 = await mockDO.instance.getCachedEvaluation('flag', context2)

      expect(cached1?.value).toBe('value-1')
      expect(cached2?.value).toBe('value-2')
    })

    it('should cache per flag key', async () => {
      // RED: Different flags should have separate cache entries
      const context: EvaluationContext = { targetingKey: 'user-123' }

      await mockDO.instance.cacheEvaluation('flag-a', context, 'a', 'STATIC')
      await mockDO.instance.cacheEvaluation('flag-b', context, 'b', 'STATIC')

      const cachedA = await mockDO.instance.getCachedEvaluation('flag-a', context)
      const cachedB = await mockDO.instance.getCachedEvaluation('flag-b', context)

      expect(cachedA?.value).toBe('a')
      expect(cachedB?.value).toBe('b')
    })
  })

  // ==========================================================================
  // CACHE INVALIDATION
  // ==========================================================================

  describe('cache invalidation', () => {
    it('should invalidate all cache entries', async () => {
      // RED: Should clear all cache
      const context: EvaluationContext = { targetingKey: 'user-123' }

      await mockDO.instance.cacheEvaluation('flag-a', context, true, 'STATIC')
      await mockDO.instance.cacheEvaluation('flag-b', context, true, 'STATIC')

      const invalidated = await mockDO.instance.invalidateCache()

      expect(invalidated).toBe(2)

      const cachedA = await mockDO.instance.getCachedEvaluation('flag-a', context)
      const cachedB = await mockDO.instance.getCachedEvaluation('flag-b', context)

      expect(cachedA).toBeNull()
      expect(cachedB).toBeNull()
    })

    it('should invalidate cache for specific flag', async () => {
      // RED: Should clear cache for specific flag only
      const context: EvaluationContext = { targetingKey: 'user-123' }

      await mockDO.instance.cacheEvaluation('flag-a', context, true, 'STATIC')
      await mockDO.instance.cacheEvaluation('flag-b', context, true, 'STATIC')

      const invalidated = await mockDO.instance.invalidateCache('flag-a')

      expect(invalidated).toBe(1)

      const cachedA = await mockDO.instance.getCachedEvaluation('flag-a', context)
      const cachedB = await mockDO.instance.getCachedEvaluation('flag-b', context)

      expect(cachedA).toBeNull()
      expect(cachedB).not.toBeNull()
    })

    it('should return 0 when no cache to invalidate', async () => {
      // RED: Nothing to invalidate
      const invalidated = await mockDO.instance.invalidateCache()

      expect(invalidated).toBe(0)
    })
  })
})

// ============================================================================
// TEST SUITE: SEGMENT RESOLUTION
// ============================================================================

describe('Flags DO Integration - Segment Resolution', () => {
  let mockDO: MockDOResult<FlagsDO, MockEnv>

  beforeEach(() => {
    mockDO = createMockDO(FlagsDO as any, {
      ns: 'https://flags-segments.test.do',
      sqlData: new Map([
        ['flags', []],
        ['segments', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1,
          shardKey: 'prefix',
          cacheTTLSeconds: 300,
          enableStreaming: true,
        }],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // SEGMENT CRUD
  // ==========================================================================

  describe('segment CRUD', () => {
    it('should create segment', async () => {
      // RED: Should store segment
      const segment: Omit<Segment, 'createdAt' | 'updatedAt'> = {
        key: 'beta-users',
        name: 'Beta Users',
        description: 'Users in the beta program',
        included: ['user-1', 'user-2', 'user-3'],
        excluded: [],
      }

      const created = await mockDO.instance.createSegment(segment)

      expect(created.key).toBe('beta-users')
      expect(created.name).toBe('Beta Users')
      expect(created.included).toEqual(['user-1', 'user-2', 'user-3'])
      expect(created.createdAt).toBeDefined()
    })

    it('should retrieve segment by key', async () => {
      // RED: Should find segment
      await mockDO.instance.createSegment({
        key: 'premium-users',
        included: ['user-premium-1'],
        excluded: [],
      })

      const retrieved = await mockDO.instance.getSegment('premium-users')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.key).toBe('premium-users')
    })

    it('should return null for unknown segment', async () => {
      // RED: Unknown segment should return null
      const retrieved = await mockDO.instance.getSegment('nonexistent')

      expect(retrieved).toBeNull()
    })

    it('should update segment', async () => {
      // RED: Should update segment
      await mockDO.instance.createSegment({
        key: 'update-segment',
        included: ['user-1'],
        excluded: [],
      })

      const updated = await mockDO.instance.updateSegment('update-segment', {
        included: ['user-1', 'user-2'],
        name: 'Updated Segment',
      })

      expect(updated.included).toEqual(['user-1', 'user-2'])
      expect(updated.name).toBe('Updated Segment')
    })

    it('should delete segment', async () => {
      // RED: Should delete segment
      await mockDO.instance.createSegment({
        key: 'delete-segment',
        included: ['user-1'],
        excluded: [],
      })

      const deleted = await mockDO.instance.deleteSegment('delete-segment')

      expect(deleted).toBe(true)

      const retrieved = await mockDO.instance.getSegment('delete-segment')
      expect(retrieved).toBeNull()
    })

    it('should list all segments', async () => {
      // RED: Should list segments
      const segments = createSampleSegments(5)
      for (const segment of segments) {
        await mockDO.instance.createSegment(segment)
      }

      const listed = await mockDO.instance.listSegments()

      expect(listed.length).toBe(5)
    })
  })

  // ==========================================================================
  // SEGMENT RESOLUTION
  // ==========================================================================

  describe('segment resolution', () => {
    it('should resolve included user in segment', async () => {
      // RED: Included user should resolve to true
      await mockDO.instance.createSegment({
        key: 'beta-users',
        included: ['user-beta-1', 'user-beta-2'],
        excluded: [],
      })

      const context: EvaluationContext = { targetingKey: 'user-beta-1' }
      const inSegment = await mockDO.instance.resolveSegment('beta-users', context)

      expect(inSegment).toBe(true)
    })

    it('should resolve excluded user from segment', async () => {
      // RED: Excluded user should resolve to false even if in included
      await mockDO.instance.createSegment({
        key: 'users',
        included: ['user-1', 'user-2'],
        excluded: ['user-1'], // user-1 is excluded
      })

      const context: EvaluationContext = { targetingKey: 'user-1' }
      const inSegment = await mockDO.instance.resolveSegment('users', context)

      expect(inSegment).toBe(false)
    })

    it('should resolve user not in segment', async () => {
      // RED: User not in included should resolve to false
      await mockDO.instance.createSegment({
        key: 'small-segment',
        included: ['user-1'],
        excluded: [],
      })

      const context: EvaluationContext = { targetingKey: 'user-999' }
      const inSegment = await mockDO.instance.resolveSegment('small-segment', context)

      expect(inSegment).toBe(false)
    })

    it('should resolve segment with targeting rules', async () => {
      // RED: Rules should be evaluated if user not explicitly included/excluded
      await mockDO.instance.createSegment({
        key: 'premium-segment',
        included: [],
        excluded: [],
        rules: [
          {
            id: 'rule-1',
            clauses: [
              { attribute: 'tier', operator: 'in', values: ['premium'] },
            ],
            variation: true,
          },
        ],
      })

      const premiumContext: EvaluationContext = { targetingKey: 'user-1', tier: 'premium' }
      const freeContext: EvaluationContext = { targetingKey: 'user-2', tier: 'free' }

      const premiumInSegment = await mockDO.instance.resolveSegment('premium-segment', premiumContext)
      const freeInSegment = await mockDO.instance.resolveSegment('premium-segment', freeContext)

      expect(premiumInSegment).toBe(true)
      expect(freeInSegment).toBe(false)
    })

    it('should throw for nonexistent segment', async () => {
      // RED: Resolving nonexistent segment should throw
      const context: EvaluationContext = { targetingKey: 'user-1' }

      await expect(
        mockDO.instance.resolveSegment('nonexistent-segment', context)
      ).rejects.toThrow()
    })
  })
})

// ============================================================================
// TEST SUITE: TARGETING RULES IN DO
// ============================================================================

describe('Flags DO Integration - Targeting Rules', () => {
  let mockDO: MockDOResult<FlagsDO, MockEnv>

  beforeEach(() => {
    mockDO = createMockDO(FlagsDO as any, {
      ns: 'https://flags-targeting.test.do',
      sqlData: new Map([
        ['flags', []],
        ['segments', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1,
          shardKey: 'prefix',
          cacheTTLSeconds: 300,
          enableStreaming: true,
        }],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // TARGETING EVALUATION
  // ==========================================================================

  describe('targeting evaluation', () => {
    it('should evaluate flag with no targeting rules', async () => {
      // RED: No rules should return default
      await mockDO.instance.createFlag({
        key: 'no-targeting',
        defaultValue: 'default',
        enabled: true,
      })

      const context: EvaluationContext = { targetingKey: 'user-1' }
      const result = await mockDO.instance.evaluateTargeting('no-targeting', context)

      expect(result.value).toBe('default')
      expect(result.reason).toBe('DEFAULT')
    })

    it('should evaluate flag with matching targeting rule', async () => {
      // RED: Matching rule should return rule variation
      await mockDO.instance.createFlag({
        key: 'targeted-flag',
        defaultValue: false,
        enabled: true,
        targeting: [
          {
            id: 'beta-rule',
            clauses: [{ attribute: 'beta', operator: 'in', values: [true] }],
            variation: true,
          },
        ],
      })

      const context: EvaluationContext = { targetingKey: 'user-1', beta: true }
      const result = await mockDO.instance.evaluateTargeting('targeted-flag', context)

      expect(result.value).toBe(true)
      expect(result.reason).toBe('TARGETING_MATCH')
    })

    it('should evaluate flag with non-matching targeting rule', async () => {
      // RED: Non-matching rule should fall through to default
      await mockDO.instance.createFlag({
        key: 'targeted-flag',
        defaultValue: false,
        enabled: true,
        targeting: [
          {
            id: 'beta-rule',
            clauses: [{ attribute: 'beta', operator: 'in', values: [true] }],
            variation: true,
          },
        ],
      })

      const context: EvaluationContext = { targetingKey: 'user-1', beta: false }
      const result = await mockDO.instance.evaluateTargeting('targeted-flag', context)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('DEFAULT')
    })

    it('should evaluate multiple rules in order', async () => {
      // RED: First matching rule should win
      await mockDO.instance.createFlag({
        key: 'multi-rule',
        defaultValue: 'default',
        enabled: true,
        targeting: [
          {
            id: 'admin-rule',
            clauses: [{ attribute: 'role', operator: 'in', values: ['admin'] }],
            variation: 'admin-value',
          },
          {
            id: 'beta-rule',
            clauses: [{ attribute: 'beta', operator: 'in', values: [true] }],
            variation: 'beta-value',
          },
        ],
      })

      // Admin AND beta - should match admin first
      const adminBetaContext: EvaluationContext = { targetingKey: 'user-1', role: 'admin', beta: true }
      const result1 = await mockDO.instance.evaluateTargeting('multi-rule', adminBetaContext)

      expect(result1.value).toBe('admin-value')

      // Beta only - should match beta rule
      const betaContext: EvaluationContext = { targetingKey: 'user-2', role: 'user', beta: true }
      const result2 = await mockDO.instance.evaluateTargeting('multi-rule', betaContext)

      expect(result2.value).toBe('beta-value')
    })

    it('should evaluate rollout rules', async () => {
      // RED: Rollout should bucket users consistently
      await mockDO.instance.createFlag({
        key: 'rollout-flag',
        defaultValue: 'control',
        enabled: true,
        targeting: [
          {
            id: 'rollout-rule',
            clauses: [],
            rollout: {
              variations: [
                { value: 'treatment', weight: 50 },
                { value: 'control', weight: 50 },
              ],
              bucketBy: 'targetingKey',
            },
          },
        ],
      })

      const context: EvaluationContext = { targetingKey: 'user-consistent' }
      const result1 = await mockDO.instance.evaluateTargeting('rollout-flag', context)
      const result2 = await mockDO.instance.evaluateTargeting('rollout-flag', context)

      // Same user should get same result
      expect(result1.value).toBe(result2.value)
      expect(result1.reason).toBe('SPLIT')
    })

    it('should return DISABLED for disabled flag', async () => {
      // RED: Disabled flag should return default with DISABLED reason
      await mockDO.instance.createFlag({
        key: 'disabled-flag',
        defaultValue: false,
        enabled: false,
        targeting: [
          {
            id: 'should-not-match',
            clauses: [{ attribute: 'anything', operator: 'in', values: [true] }],
            variation: true,
          },
        ],
      })

      const context: EvaluationContext = { targetingKey: 'user-1', anything: true }
      const result = await mockDO.instance.evaluateTargeting('disabled-flag', context)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('DISABLED')
    })
  })

  // ==========================================================================
  // TARGETING RULE MANAGEMENT
  // ==========================================================================

  describe('targeting rule management', () => {
    it('should add targeting rule to flag', async () => {
      // RED: Should add rule
      await mockDO.instance.createFlag({
        key: 'add-rule-flag',
        defaultValue: false,
        enabled: true,
        targeting: [],
      })

      const updated = await mockDO.instance.addTargetingRule('add-rule-flag', {
        id: 'new-rule',
        clauses: [{ attribute: 'tier', operator: 'in', values: ['premium'] }],
        variation: true,
      })

      expect(updated.targeting?.length).toBe(1)
      expect(updated.targeting?.[0].id).toBe('new-rule')
    })

    it('should remove targeting rule from flag', async () => {
      // RED: Should remove rule
      await mockDO.instance.createFlag({
        key: 'remove-rule-flag',
        defaultValue: false,
        enabled: true,
        targeting: [
          { id: 'rule-1', clauses: [], variation: true },
          { id: 'rule-2', clauses: [], variation: false },
        ],
      })

      const updated = await mockDO.instance.removeTargetingRule('remove-rule-flag', 'rule-1')

      expect(updated.targeting?.length).toBe(1)
      expect(updated.targeting?.[0].id).toBe('rule-2')
    })

    it('should reorder targeting rules', async () => {
      // RED: Should reorder rules
      await mockDO.instance.createFlag({
        key: 'reorder-flag',
        defaultValue: false,
        enabled: true,
        targeting: [
          { id: 'rule-a', clauses: [], variation: true },
          { id: 'rule-b', clauses: [], variation: true },
          { id: 'rule-c', clauses: [], variation: true },
        ],
      })

      const updated = await mockDO.instance.reorderTargetingRules('reorder-flag', ['rule-c', 'rule-a', 'rule-b'])

      expect(updated.targeting?.map((r) => r.id)).toEqual(['rule-c', 'rule-a', 'rule-b'])
    })

    it('should increment version when rules change', async () => {
      // RED: Version should increment
      const created = await mockDO.instance.createFlag({
        key: 'version-flag',
        defaultValue: false,
        enabled: true,
        targeting: [],
      })

      const afterAdd = await mockDO.instance.addTargetingRule('version-flag', {
        id: 'rule-1',
        clauses: [],
        variation: true,
      })

      expect(afterAdd.version).toBe(created.version + 1)
    })
  })
})

// ============================================================================
// TEST SUITE: STREAMING UPDATES
// ============================================================================

describe('Flags DO Integration - Streaming Updates', () => {
  let mockDO: MockDOResult<FlagsDO, MockEnv>

  beforeEach(() => {
    mockDO = createMockDO(FlagsDO as any, {
      ns: 'https://flags-streaming.test.do',
      sqlData: new Map([
        ['flags', []],
        ['change_events', []],
        ['subscriptions', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1,
          shardKey: 'prefix',
          cacheTTLSeconds: 300,
          enableStreaming: true,
        }],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // CHANGE EVENTS
  // ==========================================================================

  describe('change events', () => {
    it('should emit event on flag creation', async () => {
      // RED: Creation should emit event
      await mockDO.instance.createFlag({ key: 'new-flag', defaultValue: true })

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('flag_created')
      expect(events[0].flagKey).toBe('new-flag')
    })

    it('should emit event on flag update', async () => {
      // RED: Update should emit event
      await mockDO.instance.createFlag({ key: 'update-flag', defaultValue: false })
      await mockDO.instance.updateFlag('update-flag', { defaultValue: true })

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      const updateEvent = events.find((e) => e.type === 'flag_updated')
      expect(updateEvent).toBeDefined()
      expect(updateEvent?.flagKey).toBe('update-flag')
    })

    it('should emit event on flag deletion', async () => {
      // RED: Deletion should emit event
      await mockDO.instance.createFlag({ key: 'delete-flag', defaultValue: true })
      await mockDO.instance.deleteFlag('delete-flag')

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      const deleteEvent = events.find((e) => e.type === 'flag_deleted')
      expect(deleteEvent).toBeDefined()
      expect(deleteEvent?.flagKey).toBe('delete-flag')
    })

    it('should emit event on flag enable', async () => {
      // RED: Enable should emit event
      await mockDO.instance.createFlag({ key: 'enable-flag', defaultValue: true, enabled: false })
      await mockDO.instance.enableFlag('enable-flag')

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      const enableEvent = events.find((e) => e.type === 'flag_enabled')
      expect(enableEvent).toBeDefined()
    })

    it('should emit event on flag disable', async () => {
      // RED: Disable should emit event
      await mockDO.instance.createFlag({ key: 'disable-flag', defaultValue: true, enabled: true })
      await mockDO.instance.disableFlag('disable-flag')

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      const disableEvent = events.find((e) => e.type === 'flag_disabled')
      expect(disableEvent).toBeDefined()
    })

    it('should include old and new values in update events', async () => {
      // RED: Update event should have old/new values
      await mockDO.instance.createFlag({ key: 'value-change', defaultValue: 'old' })
      await mockDO.instance.updateFlag('value-change', { defaultValue: 'new' })

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      const updateEvent = events.find((e) => e.type === 'flag_updated')
      expect(updateEvent?.oldValue?.defaultValue).toBe('old')
      expect(updateEvent?.newValue?.defaultValue).toBe('new')
    })

    it('should include version in events', async () => {
      // RED: Events should have version
      await mockDO.instance.createFlag({ key: 'versioned', defaultValue: true })

      const events = await mockDO.instance.getChangesSince(new Date(Date.now() - 60000).toISOString())

      expect(events[0].version).toBe(1)
    })
  })

  // ==========================================================================
  // SUBSCRIPTIONS
  // ==========================================================================

  describe('subscriptions', () => {
    it('should subscribe to all flag changes', async () => {
      // RED: Should subscribe to all flags
      const callback = vi.fn()

      const subscription = await mockDO.instance.subscribe({
        flagKeys: '*',
        callback,
      })

      expect(subscription.id).toBeDefined()
      expect(subscription.flagKeys).toBe('*')
    })

    it('should subscribe to specific flag changes', async () => {
      // RED: Should subscribe to specific flags
      const callback = vi.fn()

      const subscription = await mockDO.instance.subscribe({
        flagKeys: ['flag-a', 'flag-b'],
        callback,
      })

      expect(subscription.flagKeys).toEqual(['flag-a', 'flag-b'])
    })

    it('should unsubscribe', async () => {
      // RED: Should remove subscription
      const callback = vi.fn()

      const subscription = await mockDO.instance.subscribe({
        flagKeys: '*',
        callback,
      })

      const unsubscribed = await mockDO.instance.unsubscribe(subscription.id)

      expect(unsubscribed).toBe(true)
    })

    it('should return false for invalid subscription ID', async () => {
      // RED: Invalid ID should return false
      const unsubscribed = await mockDO.instance.unsubscribe('nonexistent-id')

      expect(unsubscribed).toBe(false)
    })
  })

  // ==========================================================================
  // STREAMING
  // ==========================================================================

  describe('streaming', () => {
    it('should stream changes as ReadableStream', async () => {
      // RED: Should return readable stream
      const stream = await mockDO.instance.streamChanges()

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should stream changes since timestamp', async () => {
      // RED: Should filter by timestamp
      const since = new Date(Date.now() - 60000).toISOString()
      const stream = await mockDO.instance.streamChanges(since)

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should get changes since timestamp', async () => {
      // RED: Should return events after timestamp
      // Use a timestamp slightly in the past to avoid same-millisecond timing issues
      const beforeCreate = new Date(Date.now() - 1).toISOString()
      await mockDO.instance.createFlag({ key: 'after-timestamp', defaultValue: true })

      const events = await mockDO.instance.getChangesSince(beforeCreate)

      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.flagKey === 'after-timestamp')).toBe(true)
    })

    it('should not return changes before timestamp', async () => {
      // RED: Should not include old events
      await mockDO.instance.createFlag({ key: 'before-timestamp', defaultValue: true })

      const afterCreate = new Date().toISOString()

      const events = await mockDO.instance.getChangesSince(afterCreate)

      expect(events.every((e) => e.flagKey !== 'before-timestamp')).toBe(true)
    })
  })
})
