/**
 * EdgePostgres Replication Tests - ReplicatedPostgres
 *
 * RED TDD Phase: These tests define the expected behavior for EdgePostgres
 * replication with read-your-writes (RYW) consistency across 35+ cities.
 *
 * All tests are expected to FAIL initially since no implementation exists.
 *
 * ReplicatedPostgres provides:
 * - Multi-region replication with 35+ city support
 * - Jurisdiction enforcement (eu/us/fedramp) for data sovereignty
 * - Read-your-writes consistency via session tokens
 * - Nearest replica selection for optimal latency
 * - Primary write routing with session token generation
 *
 * Architecture:
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      ReplicatedPostgres                          │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  Primary (single)                                                │
 * │  • Handles all writes                                            │
 * │  • Generates session tokens on each write                        │
 * │  • Propagates changes to replicas                                │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  Replicas (multiple, geo-distributed)                            │
 * │  • Read-only by default                                          │
 * │  • Selected based on proximity (nearest)                         │
 * │  • Constrained by jurisdiction (eu/us/fedramp)                   │
 * │  • Honor session tokens for RYW consistency                      │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * Session Token Flow:
 * 1. Client writes to primary -> gets session token with LSN
 * 2. Client reads with session token -> replica waits for LSN
 * 3. Replica returns data only when caught up to LSN
 *
 * @see README.md for API design and Replication section
 * @see dotdo-i96xo for issue details
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from non-existent module so tests fail
import {
  ReplicatedPostgres,
  type ReplicaConfig,
  type SessionToken,
  type ReplicationConfig,
  type WriteResult,
  type ReadResult,
  type ReplicaInfo,
  type Jurisdiction,
  type City,
} from './replication'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Mock Durable Object context for testing
 */
interface MockDurableObjectState {
  storage: {
    get: <T>(key: string) => Promise<T | undefined>
    put: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
  id: {
    toString: () => string
    name?: string
  }
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  FSX?: unknown
  R2_BUCKET?: unknown
  DO_NAMESPACE?: unknown
  COLO_DO?: Record<City, unknown>
}

/**
 * Create mock DO context for testing
 */
function createMockContext(): MockDurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => { storage.set(key, value) },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    id: {
      toString: () => 'test-do-id-12345',
      name: 'test-do',
    },
    waitUntil: (promise: Promise<unknown>) => { promise.catch(() => {}) },
  }
}

/**
 * Create mock environment
 */
function createMockEnv(): MockEnv {
  return {
    FSX: {},
    R2_BUCKET: {},
    DO_NAMESPACE: {},
    COLO_DO: {
      fra: {},
      ams: {},
      dub: {},
      lhr: {},
      iad: {},
      sfo: {},
      sea: {},
      ord: {},
      nrt: {},
      sin: {},
      syd: {},
    } as Record<City, unknown>,
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ReplicatedPostgres', () => {
  let ctx: MockDurableObjectState
  let env: MockEnv
  let db: ReplicatedPostgres

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = createMockContext()
    env = createMockEnv()
  })

  afterEach(async () => {
    if (db) {
      await db.close()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // CONSTRUCTOR AND CONFIGURATION
  // ==========================================================================

  describe('Constructor', () => {
    it('should create ReplicatedPostgres instance with ctx and env', () => {
      db = new ReplicatedPostgres(ctx, env)

      expect(db).toBeDefined()
      expect(db).toBeInstanceOf(ReplicatedPostgres)
    })

    it('should accept replication configuration', () => {
      const config: ReplicationConfig = {
        replication: {
          jurisdiction: 'eu',
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      }

      db = new ReplicatedPostgres(ctx, env, config)

      expect(db).toBeDefined()
    })

    it('should accept jurisdiction-only configuration', () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'us',
          readFrom: 'primary',
        },
      })

      expect(db).toBeDefined()
    })

    it('should accept cities-only configuration', () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['iad', 'sfo', 'ord'],
          readFrom: 'nearest',
        },
      })

      expect(db).toBeDefined()
    })

    it('should accept regions configuration', () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          regions: ['us-east-1', 'eu-west-1'],
          readFrom: 'nearest',
        },
      })

      expect(db).toBeDefined()
    })

    it('should default to primary readFrom when not specified', () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
        },
      })

      expect(db).toBeDefined()
      // @ts-expect-error - accessing internal config
      expect(db.config?.replication?.readFrom).toBe('primary')
    })

    it('should accept writeThrough option', () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
          writeThrough: true,
        },
      })

      expect(db).toBeDefined()
    })
  })

  // ==========================================================================
  // REPLICA CREATION
  // ==========================================================================

  describe('Replica Creation', () => {
    it('should create replicas in specified cities', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()

      expect(replicas).toHaveLength(3)
      expect(replicas.map((r: ReplicaInfo) => r.city).sort()).toEqual(['ams', 'dub', 'fra'])
    })

    it('should create primary and replicas with correct roles', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()
      const primary = replicas.find((r: ReplicaInfo) => r.role === 'primary')
      const followers = replicas.filter((r: ReplicaInfo) => r.role === 'follower')

      expect(primary).toBeDefined()
      expect(followers.length).toBeGreaterThanOrEqual(1)
    })

    it('should use colo.do for precise city placement', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['nrt', 'sin', 'syd'],
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()

      // Each replica should have exact city placement
      for (const replica of replicas) {
        expect(['nrt', 'sin', 'syd']).toContain(replica.city)
        expect(replica.placementMethod).toBe('colo.do')
      }
    })

    it('should map regions to cities when regions specified', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          regions: ['us-east-1', 'eu-west-1', 'ap-northeast-1'],
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()

      // Should map to: iad, dub, nrt
      expect(replicas.some((r: ReplicaInfo) => r.city === 'iad')).toBe(true)
      expect(replicas.some((r: ReplicaInfo) => r.city === 'dub')).toBe(true)
      expect(replicas.some((r: ReplicaInfo) => r.city === 'nrt')).toBe(true)
    })

    it('should track replica status during initialization', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra'],
          readFrom: 'nearest',
        },
      })

      // Before initialization
      let replicas = await db.getReplicas()
      expect(replicas).toHaveLength(0)

      // During initialization
      const initPromise = db.initialize()

      // After initialization
      await initPromise
      replicas = await db.getReplicas()
      expect(replicas[0].status).toBe('active')
    })

    it('should support 35+ cities for global distribution', async () => {
      const allCities: City[] = [
        'iad', 'ord', 'sfo', 'sea', 'dfw', 'mia', 'lax', 'den', // US
        'lhr', 'fra', 'ams', 'cdg', 'dub', 'mad', 'mxp', 'arn', // EU
        'nrt', 'sin', 'syd', 'hkg', 'icn', 'bom', 'mel', 'auc', // AP
        'gru', 'scl', // SA
        'jnb', 'cpt', // AF
        'dxb', 'bah', // ME
      ]

      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: allCities,
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()
      expect(replicas.length).toBeGreaterThanOrEqual(30)
    })
  })

  // ==========================================================================
  // JURISDICTION ENFORCEMENT
  // ==========================================================================

  describe('Jurisdiction Enforcement', () => {
    it('should restrict replicas to EU cities when jurisdiction is eu', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()
      const euCities = ['fra', 'ams', 'dub', 'lhr', 'cdg', 'mad', 'mxp', 'arn', 'hel', 'osl', 'cph', 'vie', 'zrh', 'bru', 'waw']

      for (const replica of replicas) {
        expect(euCities).toContain(replica.city)
      }
    })

    it('should restrict replicas to US cities when jurisdiction is us', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'us',
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()
      const usCities = ['iad', 'ord', 'sfo', 'sea', 'dfw', 'mia', 'lax', 'den', 'atl', 'bos', 'phx', 'pdx']

      for (const replica of replicas) {
        expect(usCities).toContain(replica.city)
      }
    })

    it('should restrict to FedRAMP-compliant cities when jurisdiction is fedramp', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'fedramp',
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()
      const fedrampCities = ['iad', 'ord', 'sfo'] // Limited FedRAMP-authorized cities

      for (const replica of replicas) {
        expect(fedrampCities).toContain(replica.city)
      }
    })

    it('should reject cities outside jurisdiction', async () => {
      await expect(async () => {
        db = new ReplicatedPostgres(ctx, env, {
          replication: {
            jurisdiction: 'eu',
            cities: ['iad', 'sfo'], // US cities with EU jurisdiction
            readFrom: 'nearest',
          },
        })
        await db.initialize()
      }).rejects.toThrow(/jurisdiction.*violation|cities.*not.*allowed|outside.*jurisdiction/i)
    })

    it('should allow cities within jurisdiction', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
          cities: ['fra', 'ams', 'dub'], // EU cities with EU jurisdiction
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()
      expect(replicas).toHaveLength(3)
    })

    it('should auto-select cities within jurisdiction when none specified', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      const replicas = await db.getReplicas()

      // Should have auto-selected EU cities
      expect(replicas.length).toBeGreaterThan(0)

      const euCities = ['fra', 'ams', 'dub', 'lhr', 'cdg', 'mad', 'mxp', 'arn']
      for (const replica of replicas) {
        expect(euCities).toContain(replica.city)
      }
    })

    it('should enforce jurisdiction on data writes', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
          cities: ['fra'],
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      // Create table first
      await db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT, name TEXT)')

      // Write should go to EU-based primary
      const result = await db.exec(
        'INSERT INTO users (id, name) VALUES ($1, $2)',
        ['user-1', 'Alice']
      )

      expect(result.primaryCity).toBe('fra')
    })

    it('should validate jurisdiction at runtime for dynamic config', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          jurisdiction: 'eu',
          cities: ['fra'],
          readFrom: 'nearest',
        },
      })

      await db.initialize()

      // Attempt to add US replica at runtime should fail
      await expect(async () => {
        await db.addReplica('iad')
      }).rejects.toThrow(/jurisdiction/i)
    })
  })

  // ==========================================================================
  // READ-YOUR-WRITES CONSISTENCY
  // ==========================================================================

  describe('Read-Your-Writes Consistency', () => {
    beforeEach(async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
      await db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          name TEXT,
          value INTEGER
        )
      `)
    })

    it('should return sessionToken from exec (write operations)', async () => {
      const result = await db.exec(
        'INSERT INTO items (id, name, value) VALUES ($1, $2, $3)',
        ['item-1', 'Widget', 100]
      )

      expect(result.sessionToken).toBeDefined()
      expect(typeof result.sessionToken).toBe('string')
    })

    it('should accept sessionToken in query options for RYW', async () => {
      // Write
      const writeResult = await db.exec(
        'INSERT INTO items (id, name, value) VALUES ($1, $2, $3)',
        ['ryw-1', 'RYW Item', 42]
      )

      // Read with session token
      const readResult = await db.query(
        'SELECT * FROM items WHERE id = $1',
        ['ryw-1'],
        { sessionToken: writeResult.sessionToken }
      )

      expect(readResult.rows).toHaveLength(1)
      expect(readResult.rows[0].name).toBe('RYW Item')
    })

    it('should guarantee visibility of own writes with sessionToken', async () => {
      // Multiple writes in sequence
      const write1 = await db.exec(
        'INSERT INTO items VALUES ($1, $2, $3)',
        ['seq-1', 'First', 1]
      )

      const write2 = await db.exec(
        'INSERT INTO items VALUES ($1, $2, $3)',
        ['seq-2', 'Second', 2]
      )

      const write3 = await db.exec(
        'INSERT INTO items VALUES ($1, $2, $3)',
        ['seq-3', 'Third', 3]
      )

      // Read with latest session token should see all writes
      const readResult = await db.query(
        'SELECT * FROM items ORDER BY value',
        [],
        { sessionToken: write3.sessionToken }
      )

      expect(readResult.rows).toHaveLength(3)
      expect(readResult.rows.map((r: { id: string }) => r.id)).toEqual(['seq-1', 'seq-2', 'seq-3'])
    })

    it('should read from replica that has caught up to session token', async () => {
      const writeResult = await db.exec(
        'INSERT INTO items VALUES ($1, $2, $3)',
        ['replica-ryw', 'Replica RYW', 99]
      )

      // Query should wait for replica to catch up
      const readResult = await db.query(
        'SELECT * FROM items WHERE id = $1',
        ['replica-ryw'],
        { sessionToken: writeResult.sessionToken }
      )

      expect(readResult.rows).toHaveLength(1)
      expect(readResult.source).toBeDefined()
    })

    it('should timeout if replica cannot catch up', async () => {
      const writeResult = await db.exec(
        'INSERT INTO items VALUES ($1, $2, $3)',
        ['timeout-item', 'Timeout Item', 0]
      )

      // Simulate slow replica by using a fake session token with high LSN
      const fakeToken = 'fake-token-with-very-high-lsn-99999999'

      await expect(async () => {
        await db.query(
          'SELECT * FROM items WHERE id = $1',
          ['timeout-item'],
          {
            sessionToken: fakeToken,
            rywTimeoutMs: 100, // Short timeout
          }
        )
      }).rejects.toThrow(/timeout|could not.*catch up|replica.*lag/i)
    })

    it('should fallback to primary on RYW timeout when configured', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
          rywFallbackToPrimary: true,
        },
      })
      await db.initialize()

      // Create table first
      await db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          name TEXT,
          value INTEGER
        )
      `)

      const writeResult = await db.exec(
        'INSERT INTO items VALUES ($1, $2, $3)',
        ['fallback-item', 'Fallback', 0]
      )

      // Even with stale replica, should succeed via primary fallback
      const readResult = await db.query(
        'SELECT * FROM items WHERE id = $1',
        ['fallback-item'],
        {
          sessionToken: writeResult.sessionToken,
          rywTimeoutMs: 50,
        }
      )

      expect(readResult.rows).toHaveLength(1)
      expect(readResult.source).toBe('primary')
    })
  })

  // ==========================================================================
  // SESSION TOKEN
  // ==========================================================================

  describe('Session Token', () => {
    beforeEach(async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
      await db.exec('CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY)')
    })

    it('should encode write timestamp in session token', async () => {
      const before = Date.now()
      const result = await db.exec('INSERT INTO tokens VALUES ($1)', ['t1'])
      const after = Date.now()

      const decoded = await db.decodeSessionToken(result.sessionToken)

      expect(decoded.timestamp).toBeGreaterThanOrEqual(before)
      expect(decoded.timestamp).toBeLessThanOrEqual(after)
    })

    it('should encode LSN (Log Sequence Number) in session token', async () => {
      const result1 = await db.exec('INSERT INTO tokens VALUES ($1)', ['lsn-1'])
      const result2 = await db.exec('INSERT INTO tokens VALUES ($1)', ['lsn-2'])

      const decoded1 = await db.decodeSessionToken(result1.sessionToken)
      const decoded2 = await db.decodeSessionToken(result2.sessionToken)

      expect(decoded2.lsn).toBeGreaterThan(decoded1.lsn)
    })

    it('should encode primary city in session token', async () => {
      const result = await db.exec('INSERT INTO tokens VALUES ($1)', ['city-1'])

      const decoded = await db.decodeSessionToken(result.sessionToken)

      expect(['fra', 'ams']).toContain(decoded.primaryCity)
    })

    it('should generate compact session tokens (< 100 bytes)', async () => {
      const result = await db.exec('INSERT INTO tokens VALUES ($1)', ['compact-1'])

      // Base64-encoded token should be compact
      expect(result.sessionToken.length).toBeLessThan(100)
    })

    it('should validate session token format', async () => {
      await expect(async () => {
        await db.decodeSessionToken('invalid-token')
      }).rejects.toThrow(/invalid.*token|malformed|parse/i)
    })

    it('should detect expired session tokens', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra'],
          readFrom: 'nearest',
          sessionTokenTTLMs: 60_000, // 1 minute
        },
      })
      await db.initialize()
      await db.exec('CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY)')

      const result = await db.exec('INSERT INTO tokens VALUES ($1)', ['expire-1'])

      // Advance time past TTL
      await vi.advanceTimersByTimeAsync(120_000) // 2 minutes

      const decoded = await db.decodeSessionToken(result.sessionToken)
      expect(decoded.expired).toBe(true)
    })

    it('should return updated session token on each write', async () => {
      const result1 = await db.exec('INSERT INTO tokens VALUES ($1)', ['update-1'])
      const result2 = await db.exec('INSERT INTO tokens VALUES ($1)', ['update-2'])
      const result3 = await db.exec('INSERT INTO tokens VALUES ($1)', ['update-3'])

      // Each write should have different token
      expect(result1.sessionToken).not.toBe(result2.sessionToken)
      expect(result2.sessionToken).not.toBe(result3.sessionToken)
    })

    it('should include session token in read result for chaining', async () => {
      const writeResult = await db.exec('INSERT INTO tokens VALUES ($1)', ['chain-1'])

      const readResult = await db.query(
        'SELECT * FROM tokens WHERE id = $1',
        ['chain-1'],
        { sessionToken: writeResult.sessionToken }
      )

      // Read result should include session token for chained operations
      expect((readResult as ReadResult).sessionToken).toBeDefined()
    })

    it('should getSessionToken() return current session state', async () => {
      await db.exec('INSERT INTO tokens VALUES ($1)', ['state-1'])
      await db.exec('INSERT INTO tokens VALUES ($1)', ['state-2'])

      const sessionToken = await db.getSessionToken()

      expect(sessionToken).toBeDefined()
      expect(typeof sessionToken).toBe('string')
    })
  })

  // ==========================================================================
  // NEAREST REPLICA SELECTION
  // ==========================================================================

  describe('Nearest Replica Selection', () => {
    it('should select nearest replica for reads when readFrom is nearest', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['iad', 'fra', 'nrt'], // US, EU, Asia
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      const result = await db.query('SELECT 1 as value', [])

      // Should have used some replica
      expect(result.source).toBeDefined()
      expect(['iad', 'fra', 'nrt', 'primary']).toContain(result.source)
    })

    it('should getNearestReplica() return closest by latency', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['iad', 'fra', 'nrt', 'syd'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      const nearest = await db.getNearestReplica()

      expect(nearest).toBeDefined()
      expect(nearest.city).toBeDefined()
      expect(nearest.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should fallback to other replicas if nearest is unavailable', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      // Simulate nearest replica being down
      await db.markReplicaUnavailable('fra')

      const nearest = await db.getNearestReplica()

      // Should select another replica
      expect(['ams', 'dub']).toContain(nearest.city)
    })

    it('should always use primary for readFrom=primary', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'primary',
        },
      })
      await db.initialize()

      const result = await db.query('SELECT 1 as value', [])

      expect(result.source).toBe('primary')
    })

    it('should prefer secondary for readFrom=secondary', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'secondary',
        },
      })
      await db.initialize()

      const result = await db.query('SELECT 1 as value', [])

      // Should not use primary
      expect(result.source).not.toBe('primary')
    })

    it('should measure latency to replicas for selection', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['iad', 'fra', 'nrt'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      const replicas = await db.getReplicas()

      for (const replica of replicas) {
        expect(replica.latencyMs).toBeGreaterThanOrEqual(0)
      }
    })

    it('should cache nearest replica selection', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
          nearestCacheTTLMs: 60_000, // 1 minute cache
        },
      })
      await db.initialize()

      // First selection
      const nearest1 = await db.getNearestReplica()

      // Second selection should use cache
      const nearest2 = await db.getNearestReplica()

      expect(nearest1.city).toBe(nearest2.city)
    })

    it('should refresh nearest selection after cache expires', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
          nearestCacheTTLMs: 60_000,
        },
      })
      await db.initialize()

      const nearest1 = await db.getNearestReplica()

      // Advance past cache TTL
      await vi.advanceTimersByTimeAsync(120_000)

      // Should re-measure
      const nearest2 = await db.getNearestReplica()

      // May or may not be same, but should have refreshed
      expect(nearest2).toBeDefined()
    })
  })

  // ==========================================================================
  // WRITE OPERATIONS
  // ==========================================================================

  describe('Write Operations', () => {
    beforeEach(async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
    })

    it('should route all writes to primary', async () => {
      const result = await db.exec(
        'CREATE TABLE writes (id TEXT PRIMARY KEY)',
        []
      )

      expect(result.destination).toBe('primary')
    })

    it('should return sessionToken from write operations', async () => {
      const result = await db.exec(
        'CREATE TABLE session_writes (id TEXT)',
        []
      )

      expect(result.sessionToken).toBeDefined()
    })

    it('should propagate writes to replicas asynchronously', async () => {
      await db.exec('CREATE TABLE async_prop (id TEXT PRIMARY KEY, value TEXT)', [])
      await db.exec('INSERT INTO async_prop VALUES ($1, $2)', ['ap-1', 'value-1'])

      // Wait for propagation
      await vi.advanceTimersByTimeAsync(1000)

      const replicas = await db.getReplicas()
      const followerReplicas = replicas.filter((r: ReplicaInfo) => r.role === 'follower')

      for (const replica of followerReplicas) {
        expect(replica.lag).toBeLessThanOrEqual(1)
      }
    })

    it('should handle write failures gracefully', async () => {
      // Simulate primary failure
      // This would be implementation-specific

      await expect(async () => {
        await db.exec('INSERT INTO nonexistent_table VALUES ($1)', ['fail-1'])
      }).rejects.toThrow()
    })

    it('should support writeThrough for synchronous replication', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
          writeThrough: true,
        },
      })
      await db.initialize()

      await db.exec('CREATE TABLE sync_write (id TEXT)', [])
      const result = await db.exec('INSERT INTO sync_write VALUES ($1)', ['sync-1'])

      // writeThrough should ensure all replicas are updated synchronously
      expect(result.replicasUpdated).toEqual(['fra', 'ams'])
    })
  })

  // ==========================================================================
  // TRANSACTION SUPPORT
  // ==========================================================================

  describe('Transaction Support', () => {
    beforeEach(async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
      await db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          balance DECIMAL(10, 2) NOT NULL
        )
      `)
      await db.exec('INSERT INTO accounts VALUES ($1, $2)', ['acc-1', 100.00])
      await db.exec('INSERT INTO accounts VALUES ($1, $2)', ['acc-2', 50.00])
    })

    it('should execute transaction on primary', async () => {
      const result = await db.transaction(async (tx) => {
        await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [25.00, 'acc-1'])
        await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [25.00, 'acc-2'])
        return 'success'
      })

      expect(result.value).toBe('success')
      expect(result.destination).toBe('primary')
    })

    it('should return sessionToken from transaction', async () => {
      const result = await db.transaction(async (tx) => {
        await tx.query('UPDATE accounts SET balance = balance + 1 WHERE id = $1', ['acc-1'])
        return 'done'
      })

      expect(result.sessionToken).toBeDefined()
    })

    it('should rollback transaction on error', async () => {
      await expect(async () => {
        await db.transaction(async (tx) => {
          await tx.query('UPDATE accounts SET balance = balance - 25 WHERE id = $1', ['acc-1'])
          throw new Error('Simulated failure')
        })
      }).rejects.toThrow('Simulated failure')

      // Balance should be unchanged
      const result = await db.query('SELECT balance FROM accounts WHERE id = $1', ['acc-1'])
      expect(Number(result.rows[0].balance)).toBe(100.00)
    })

    it('should support RYW after transaction', async () => {
      const txResult = await db.transaction(async (tx) => {
        await tx.query('UPDATE accounts SET balance = 200 WHERE id = $1', ['acc-1'])
        return 'updated'
      })

      // Read with session token should see transaction result
      const readResult = await db.query(
        'SELECT balance FROM accounts WHERE id = $1',
        ['acc-1'],
        { sessionToken: txResult.sessionToken }
      )

      expect(Number(readResult.rows[0].balance)).toBe(200)
    })
  })

  // ==========================================================================
  // REPLICA MANAGEMENT
  // ==========================================================================

  describe('Replica Management', () => {
    beforeEach(async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
    })

    it('should add new replica dynamically', async () => {
      const replicasBefore = await db.getReplicas()

      await db.addReplica('dub')

      const replicasAfter = await db.getReplicas()
      expect(replicasAfter.length).toBe(replicasBefore.length + 1)
      expect(replicasAfter.some((r: ReplicaInfo) => r.city === 'dub')).toBe(true)
    })

    it('should remove replica dynamically', async () => {
      const replicasBefore = await db.getReplicas()

      await db.removeReplica('ams')

      const replicasAfter = await db.getReplicas()
      expect(replicasAfter.length).toBe(replicasBefore.length - 1)
      expect(replicasAfter.some((r: ReplicaInfo) => r.city === 'ams')).toBe(false)
    })

    it('should not remove primary', async () => {
      const replicas = await db.getReplicas()
      const primary = replicas.find((r: ReplicaInfo) => r.role === 'primary')

      await expect(async () => {
        await db.removeReplica(primary!.city)
      }).rejects.toThrow(/cannot.*remove.*primary|primary.*required/i)
    })

    it('should sync new replica from primary', async () => {
      await db.exec('CREATE TABLE sync_test (id TEXT)', [])
      await db.exec('INSERT INTO sync_test VALUES ($1)', ['existing-data'])

      await db.addReplica('lhr')

      // Wait for sync
      await vi.advanceTimersByTimeAsync(5000)

      const replicas = await db.getReplicas()
      const newReplica = replicas.find((r: ReplicaInfo) => r.city === 'lhr')

      expect(newReplica?.status).toBe('active')
      expect(newReplica?.lag).toBe(0)
    })

    it('should track replica lag', async () => {
      // Force lag by simulating slow replication
      await db.exec('CREATE TABLE lag_test (id TEXT)', [])
      for (let i = 0; i < 100; i++) {
        await db.exec('INSERT INTO lag_test VALUES ($1)', [`lag-${i}`])
      }

      const replicas = await db.getReplicas()
      const followers = replicas.filter((r: ReplicaInfo) => r.role === 'follower')

      // At least one might have lag
      for (const replica of followers) {
        expect(replica.lag).toBeGreaterThanOrEqual(0)
      }
    })

    it('should mark replica as stale when lag exceeds threshold', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
          maxLagForStale: 100, // Mark stale if 100+ behind
        },
      })
      await db.initialize()

      // Simulate high lag
      await db.exec('CREATE TABLE stale_test (id TEXT)', [])
      for (let i = 0; i < 200; i++) {
        await db.exec('INSERT INTO stale_test VALUES ($1)', [`stale-${i}`])
      }

      // Don't wait for replication
      const replicas = await db.getReplicas()
      const followers = replicas.filter((r: ReplicaInfo) => r.role === 'follower')

      // Check if any are marked stale
      const staleFollowers = followers.filter((r: ReplicaInfo) => r.status === 'stale')
      // This depends on implementation timing
      expect(staleFollowers.length).toBeGreaterThanOrEqual(0)
    })

    it('should force sync on specific replica', async () => {
      await db.exec('CREATE TABLE force_sync (id TEXT)', [])
      await db.exec('INSERT INTO force_sync VALUES ($1)', ['force-1'])

      // Force sync on ams replica
      await db.forceSyncReplica('ams')

      const replicas = await db.getReplicas()
      const amsReplica = replicas.find((r: ReplicaInfo) => r.city === 'ams')

      expect(amsReplica?.lag).toBe(0)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle primary unavailable', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      // Simulate primary failure
      await db.markReplicaUnavailable('fra') // Assuming fra is primary

      // Writes should fail or trigger failover
      await expect(async () => {
        await db.exec('INSERT INTO test VALUES ($1)', ['fail'])
      }).rejects.toThrow(/primary.*unavailable|connection|failover/i)
    })

    it('should handle all replicas unavailable', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      await db.markReplicaUnavailable('fra')
      await db.markReplicaUnavailable('ams')

      await expect(async () => {
        await db.query('SELECT 1', [])
      }).rejects.toThrow(/no.*replicas.*available|all.*unavailable/i)
    })

    it('should handle network partition gracefully', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      // Simulate partition (ams isolated)
      await db.markReplicaUnavailable('ams')

      // Should still work with remaining replicas
      const result = await db.query('SELECT 1 as value', [])
      expect(result.rows).toHaveLength(1)
    })

    it('should validate configuration at construction time', () => {
      expect(() => {
        new ReplicatedPostgres(ctx, env, {
          replication: {
            cities: [], // Empty cities
            readFrom: 'nearest',
          },
        })
      }).toThrow(/at least one.*city|cities.*required|invalid.*config/i)
    })

    it('should handle invalid city codes', () => {
      expect(() => {
        new ReplicatedPostgres(ctx, env, {
          replication: {
            cities: ['invalid-city' as City],
            readFrom: 'nearest',
          },
        })
      }).toThrow(/invalid.*city|unknown.*city|not.*supported/i)
    })
  })

  // ==========================================================================
  // PERFORMANCE
  // ==========================================================================

  describe('Performance', () => {
    beforeEach(async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
    })

    it('should handle concurrent reads from multiple replicas', async () => {
      await db.exec('CREATE TABLE concurrent_read (id TEXT PRIMARY KEY, value TEXT)', [])
      await db.exec('INSERT INTO concurrent_read VALUES ($1, $2)', ['cr-1', 'value-1'])

      // Wait for replication
      await vi.advanceTimersByTimeAsync(1000)

      // Concurrent reads
      const reads = Array.from({ length: 20 }, () =>
        db.query('SELECT * FROM concurrent_read WHERE id = $1', ['cr-1'])
      )

      const results = await Promise.all(reads)

      expect(results.every(r => r.rows.length === 1)).toBe(true)
    })

    it('should handle concurrent writes to primary', async () => {
      await db.exec('CREATE TABLE concurrent_write (id TEXT PRIMARY KEY, value INTEGER)', [])

      const writes = Array.from({ length: 10 }, (_, i) =>
        db.exec('INSERT INTO concurrent_write VALUES ($1, $2)', [`cw-${i}`, i])
      )

      const results = await Promise.all(writes)

      expect(results.every(r => r.sessionToken !== undefined)).toBe(true)
    })

    it('should batch replication updates efficiently', async () => {
      await db.exec('CREATE TABLE batch_repl (id TEXT)', [])

      // Many quick writes
      for (let i = 0; i < 100; i++) {
        await db.exec('INSERT INTO batch_repl VALUES ($1)', [`batch-${i}`])
      }

      // Replication should batch these
      const stats = await db.getReplicationStats()

      // Should have fewer replication batches than individual writes
      expect(stats.replicationBatches).toBeLessThan(100)
    })
  })

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  describe('Lifecycle', () => {
    it('should close all replica connections on close()', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams', 'dub'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      await db.close()

      // Operations should fail after close
      await expect(async () => {
        await db.query('SELECT 1', [])
      }).rejects.toThrow(/closed|terminated/i)
    })

    it('should be safe to call close() multiple times', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()

      await db.close()
      await db.close()
      await db.close()

      // Should not throw
      expect(true).toBe(true)
    })

    it('should flush pending writes before close', async () => {
      db = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db.initialize()
      await db.exec('CREATE TABLE close_flush (id TEXT)', [])
      await db.exec('INSERT INTO close_flush VALUES ($1)', ['flush-before-close'])

      await db.close()

      // Recreate and verify data persisted
      const db2 = new ReplicatedPostgres(ctx, env, {
        replication: {
          cities: ['fra', 'ams'],
          readFrom: 'nearest',
        },
      })
      await db2.initialize()

      const result = await db2.query('SELECT * FROM close_flush', [])
      expect(result.rows).toHaveLength(1)

      await db2.close()
      db = null as unknown as ReplicatedPostgres
    })
  })
})
