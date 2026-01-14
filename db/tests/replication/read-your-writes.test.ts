/**
 * ACID Test Suite - Phase 4: Read-Your-Writes Consistency
 *
 * RED TDD: These tests define the expected behavior for read-your-writes
 * consistency across replicas. All tests are expected to FAIL initially
 * as this is the RED phase.
 *
 * Read-your-writes (RYW) consistency ensures that a client always sees
 * their own writes, even when reading from a replica that may be lagging.
 *
 * Implementation strategies:
 * - Session tokens with version hints
 * - Sticky sessions to primary
 * - Replica wait-for-version
 * - Write forwarding with read hints
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { CloneOptions } from '../../../types/Lifecycle'
import type { Thing } from '../../../db/things'

// ============================================================================
// TYPE DEFINITIONS FOR READ-YOUR-WRITES
// ============================================================================

/**
 * Session token containing version information for RYW consistency
 */
interface SessionToken {
  /** Session ID */
  sessionId: string
  /** Client ID (user or agent) */
  clientId: string
  /** Last written sequence number per namespace */
  writeMarkers: Record<string, number>
  /** Timestamp of token creation */
  createdAt: Date
  /** Timestamp of last update */
  updatedAt: Date
  /** Time-to-live in seconds */
  ttlSeconds: number
}

/**
 * Write result with version information for RYW
 */
interface WriteResult {
  /** ID of the written thing */
  id: string
  /** New sequence number after write */
  sequence: number
  /** Namespace where write occurred */
  ns: string
  /** Updated session token */
  sessionToken: string
  /** Timestamp of write */
  timestamp: Date
}

/**
 * Read options with RYW support
 */
interface ReadOptions {
  /** Session token for RYW consistency */
  sessionToken?: string
  /** Minimum sequence to wait for */
  minSequence?: number
  /** Timeout for waiting (ms) */
  waitTimeoutMs?: number
  /** Allow stale read if wait times out */
  allowStale?: boolean
  /** Prefer primary for guaranteed freshness */
  preferPrimary?: boolean
  /** Enable causal consistency (wait for causal dependencies) */
  causallyConsistent?: boolean
}

/**
 * Read result with consistency metadata
 */
interface ReadResult<T> {
  /** The data read */
  data: T | null
  /** Sequence number at time of read */
  sequence: number
  /** Whether this was a stale read */
  isStale: boolean
  /** Lag in versions if reading from replica */
  lag: number
  /** Source of read (primary or replica ns) */
  source: string
  /** Updated session token */
  sessionToken: string
}

/**
 * RYW consistency mode
 */
type RYWMode = 'strict' | 'eventual' | 'session' | 'bounded'

/**
 * Replica handle with RYW support
 */
interface ReplicaWithRYW {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Get current sequence number */
  getSequence(): Promise<number>
  /** Wait for specific sequence number */
  waitForSequence(sequence: number, timeoutMs?: number): Promise<boolean>
  /** Read with RYW options */
  read<T>(id: string, options?: ReadOptions): Promise<ReadResult<T>>
  /** Force sync with primary */
  sync(): Promise<void>
  /** Get current lag */
  getLag(): Promise<number>
}

/**
 * Session manager for RYW tokens
 */
interface SessionManager {
  /** Create a new session */
  createSession(clientId: string, options?: { ttlSeconds?: number }): Promise<SessionToken>
  /** Get session by ID */
  getSession(sessionId: string): Promise<SessionToken | null>
  /** Update write marker for a namespace */
  recordWrite(sessionToken: string, ns: string, sequence: number): Promise<string>
  /** Get minimum sequence required for namespace */
  getWriteMarker(sessionToken: string, ns: string): Promise<number>
  /** Invalidate a session */
  invalidateSession(sessionId: string): Promise<void>
}

/**
 * Extended clone options for replica with RYW
 */
interface ReplicaCloneOptions extends CloneOptions {
  asReplica: true
  /** RYW consistency mode */
  rywMode?: RYWMode
  /** Max wait time for sequence catch-up */
  rywWaitTimeoutMs?: number
  /** Max acceptable lag for bounded staleness mode */
  maxLag?: number
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Read-Your-Writes Consistency', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    result = createMockDO(DO, {
      ns: 'https://primary.test.do',
      sqlData: new Map([
        ['things', Array.from({ length: 10 }, (_, i) => ({
          id: `thing-${i}`,
          type: 1,
          data: { index: i, name: `Item ${i}` },
          version: i + 1,
          branch: null,
          deleted: false,
        }))],
        ['objects', [{
          ns: 'https://primary.test.do',
          class: 'DO',
          primary: true,
          sequence: 10,
          region: 'us-east',
          createdAt: new Date().toISOString(),
        }]],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // BASIC RYW
  // ==========================================================================

  describe('Basic Read-Your-Writes', () => {
    it('should return write result with sequence number', async () => {
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'new-thing',
        type: 1,
        data: { name: 'New Item' },
      }) as WriteResult

      expect(writeResult.id).toBe('new-thing')
      expect(writeResult.sequence).toBeGreaterThan(0)
      expect(writeResult.ns).toBe('https://primary.test.do')
    })

    it('should include session token in write result', async () => {
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'token-thing',
        type: 1,
        data: { name: 'Token Item' },
      }, { sessionToken: 'initial-token' }) as WriteResult

      expect(writeResult.sessionToken).toBeDefined()
      expect(typeof writeResult.sessionToken).toBe('string')
    })

    it('should read own writes immediately on primary', async () => {
      // Write
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'immediate-thing',
        type: 1,
        data: { name: 'Immediate Item' },
      }) as WriteResult

      // Read immediately
      // @ts-expect-error - accessing internal method
      const readResult = await result.instance.readThing?.('immediate-thing') as ReadResult<Thing>

      expect(readResult.data).toBeDefined()
      expect(readResult.data?.id).toBe('immediate-thing')
      expect(readResult.sequence).toBeGreaterThanOrEqual(writeResult.sequence)
    })

    it('should read own writes on replica with session token', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write to primary
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'ryw-thing',
        type: 1,
        data: { name: 'RYW Item' },
      }) as WriteResult

      // Read from replica with session token
      const readResult = await replica.read<Thing>('ryw-thing', {
        sessionToken: writeResult.sessionToken,
      })

      expect(readResult.data).toBeDefined()
      expect(readResult.data?.id).toBe('ryw-thing')
      expect(readResult.isStale).toBe(false)
    })

    it('should wait for replica to catch up when reading with minSequence', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Write to primary
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'wait-thing',
        type: 1,
        data: { name: 'Wait Item' },
      }) as WriteResult

      // Start read with minSequence (will wait for sync)
      const readPromise = replica.read<Thing>('wait-thing', {
        minSequence: writeResult.sequence,
        waitTimeoutMs: 5000,
      })

      // Simulate sync
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const readResult = await readPromise

      expect(readResult.data).toBeDefined()
      expect(readResult.sequence).toBeGreaterThanOrEqual(writeResult.sequence)
    })
  })

  // ==========================================================================
  // SESSION TOKENS
  // ==========================================================================

  describe('Session Token Management', () => {
    it('should create session with unique ID', async () => {
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('client-1')

      expect(session.sessionId).toBeDefined()
      expect(session.clientId).toBe('client-1')
      expect(session.writeMarkers).toEqual({})
    })

    it('should record write markers in session', async () => {
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('client-1')
      const updatedToken = await sessionManager.recordWrite(
        session.sessionId,
        'https://primary.test.do',
        100
      )

      const marker = await sessionManager.getWriteMarker(
        session.sessionId,
        'https://primary.test.do'
      )

      expect(marker).toBe(100)
    })

    it('should track write markers per namespace', async () => {
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('client-1')

      await sessionManager.recordWrite(session.sessionId, 'https://ns1.test.do', 50)
      await sessionManager.recordWrite(session.sessionId, 'https://ns2.test.do', 75)

      const marker1 = await sessionManager.getWriteMarker(session.sessionId, 'https://ns1.test.do')
      const marker2 = await sessionManager.getWriteMarker(session.sessionId, 'https://ns2.test.do')

      expect(marker1).toBe(50)
      expect(marker2).toBe(75)
    })

    it('should update write marker to latest value', async () => {
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('client-1')

      await sessionManager.recordWrite(session.sessionId, 'https://primary.test.do', 50)
      await sessionManager.recordWrite(session.sessionId, 'https://primary.test.do', 100)

      const marker = await sessionManager.getWriteMarker(
        session.sessionId,
        'https://primary.test.do'
      )

      expect(marker).toBe(100)
    })

    it('should support session TTL', async () => {
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('client-1', {
        ttlSeconds: 60, // 1 minute
      })

      expect(session.ttlSeconds).toBe(60)

      // Advance time past TTL
      await vi.advanceTimersByTimeAsync(120000)

      const expiredSession = await sessionManager.getSession(session.sessionId)
      expect(expiredSession).toBeNull()
    })

    it('should invalidate session explicitly', async () => {
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('client-1')
      await sessionManager.invalidateSession(session.sessionId)

      const invalidSession = await sessionManager.getSession(session.sessionId)
      expect(invalidSession).toBeNull()
    })

    it('should encode session token as string', async () => {
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'token-encode-thing',
        type: 1,
        data: {},
      }) as WriteResult

      expect(typeof writeResult.sessionToken).toBe('string')
      // Token should be base64 or similar encoding
      expect(writeResult.sessionToken.length).toBeGreaterThan(0)
    })

    it('should decode session token from string', async () => {
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'token-decode-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // @ts-expect-error - accessing internal method
      const decoded = await result.instance.decodeSessionToken?.(writeResult.sessionToken)

      expect(decoded).toBeDefined()
      expect(decoded.writeMarkers).toBeDefined()
    })
  })

  // ==========================================================================
  // RYW MODES
  // ==========================================================================

  describe('RYW Consistency Modes', () => {
    describe('Strict Mode', () => {
      it('should always read from primary in strict mode', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'strict',
        }) as unknown as ReplicaWithRYW

        // Write to primary
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: 'strict-thing',
          type: 1,
          data: { name: 'Strict Item' },
        })

        // Read from replica in strict mode should forward to primary
        const readResult = await replica.read<Thing>('strict-thing')

        expect(readResult.source).toBe('https://primary.test.do')
        expect(readResult.isStale).toBe(false)
      })

      it('should have zero lag in strict mode reads', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'strict',
        }) as unknown as ReplicaWithRYW

        // Write multiple items
        for (let i = 0; i < 10; i++) {
          // @ts-expect-error - accessing internal method
          await result.instance.writeThing?.({
            id: `strict-item-${i}`,
            type: 1,
            data: { index: i },
          })
        }

        // Read any item
        const readResult = await replica.read<Thing>('strict-item-5')

        expect(readResult.lag).toBe(0)
      })
    })

    describe('Eventual Mode', () => {
      it('should read from replica without waiting in eventual mode', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'eventual',
        }) as unknown as ReplicaWithRYW

        // Don't sync the replica

        // Read should return immediately (possibly stale)
        const startTime = Date.now()
        const readResult = await replica.read<Thing>('thing-0')
        const elapsed = Date.now() - startTime

        expect(elapsed).toBeLessThan(100)
        expect(readResult.source).toBe('https://replica.test.do')
      })

      it('should return stale flag when behind in eventual mode', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'eventual',
        }) as unknown as ReplicaWithRYW

        // Write to primary
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: 'eventual-thing',
          type: 1,
          data: {},
        })

        // Read from lagging replica
        const readResult = await replica.read<Thing>('thing-0')

        // Should indicate staleness
        expect(readResult.isStale).toBe(true)
      })

      it('should report lag in eventual mode', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'eventual',
        }) as unknown as ReplicaWithRYW

        // Write multiple items to primary
        for (let i = 0; i < 20; i++) {
          // @ts-expect-error - accessing internal method
          await result.instance.writeThing?.({
            id: `lag-thing-${i}`,
            type: 1,
            data: {},
          })
        }

        const readResult = await replica.read<Thing>('thing-0')

        expect(readResult.lag).toBeGreaterThan(0)
      })
    })

    describe('Session Mode', () => {
      it('should wait for session write marker in session mode', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'session',
        }) as unknown as ReplicaWithRYW

        // Write to primary with session
        // @ts-expect-error - accessing internal method
        const writeResult = await result.instance.writeThing?.({
          id: 'session-thing',
          type: 1,
          data: {},
        }) as WriteResult

        // Read from replica with session token
        const readPromise = replica.read<Thing>('session-thing', {
          sessionToken: writeResult.sessionToken,
          waitTimeoutMs: 5000,
        })

        // Sync replica
        await replica.sync()
        await vi.advanceTimersByTimeAsync(1000)

        const readResult = await readPromise

        expect(readResult.data).toBeDefined()
        expect(readResult.isStale).toBe(false)
      })

      it('should not wait if no session token provided', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'session',
        }) as unknown as ReplicaWithRYW

        // Write to primary
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: 'no-token-thing',
          type: 1,
          data: {},
        })

        // Read without session token
        const startTime = Date.now()
        const readResult = await replica.read<Thing>('thing-0')
        const elapsed = Date.now() - startTime

        // Should return immediately without waiting
        expect(elapsed).toBeLessThan(100)
      })

      it('should only wait for writes from same session', async () => {
        const replica = await result.instance.clone('https://replica.test.do', {
          asReplica: true,
          rywMode: 'session',
        }) as unknown as ReplicaWithRYW

        // Write with session A
        // @ts-expect-error - accessing internal method
        const writeA = await result.instance.writeThing?.({
          id: 'session-a-thing',
          type: 1,
          data: {},
        }, { sessionId: 'session-a' }) as WriteResult

        // Write with session B
        // @ts-expect-error - accessing internal method
        const writeB = await result.instance.writeThing?.({
          id: 'session-b-thing',
          type: 1,
          data: {},
        }, { sessionId: 'session-b' }) as WriteResult

        // Sync to sequence between A and B
        await vi.advanceTimersByTimeAsync(500)

        // Read with session A's token should wait for A's write
        const readResult = await replica.read<Thing>('session-a-thing', {
          sessionToken: writeA.sessionToken,
        })

        expect(readResult.data?.id).toBe('session-a-thing')
      })
    })
  })

  // ==========================================================================
  // WAIT FOR SEQUENCE
  // ==========================================================================

  describe('Wait for Sequence', () => {
    it('should wait until replica reaches sequence', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Write to get sequence
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'wait-seq-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Start waiting
      const waitPromise = replica.waitForSequence(writeResult.sequence, 5000)

      // Sync
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const reached = await waitPromise

      expect(reached).toBe(true)
    })

    it('should timeout if sequence not reached', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Wait for very high sequence
      const waitPromise = replica.waitForSequence(999999, 1000)

      await vi.advanceTimersByTimeAsync(2000)

      const reached = await waitPromise

      expect(reached).toBe(false)
    })

    it('should return immediately if already at sequence', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Sync first
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const currentSequence = await replica.getSequence()

      // Wait for current sequence
      const startTime = Date.now()
      const reached = await replica.waitForSequence(currentSequence)
      const elapsed = Date.now() - startTime

      expect(reached).toBe(true)
      expect(elapsed).toBeLessThan(100)
    })

    it('should poll at reasonable intervals while waiting', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      let checkCount = 0
      const originalGetSequence = replica.getSequence.bind(replica)
      replica.getSequence = async () => {
        checkCount++
        return originalGetSequence()
      }

      // Wait for high sequence with timeout
      replica.waitForSequence(999, 5000)
      await vi.advanceTimersByTimeAsync(5000)

      // Should check multiple times but not too often
      expect(checkCount).toBeGreaterThan(1)
      expect(checkCount).toBeLessThan(500) // Not every 10ms
    })
  })

  // ==========================================================================
  // READ OPTIONS
  // ==========================================================================

  describe('Read Options', () => {
    it('should allow stale read on timeout when allowStale is true', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Write to primary
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'stale-ok-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Read with short timeout and allowStale
      const readPromise = replica.read<Thing>('thing-0', {
        minSequence: writeResult.sequence,
        waitTimeoutMs: 100,
        allowStale: true,
      })

      await vi.advanceTimersByTimeAsync(200)

      const readResult = await readPromise

      // Should return stale data instead of throwing
      expect(readResult.data).toBeDefined()
      expect(readResult.isStale).toBe(true)
    })

    it('should throw error on timeout when allowStale is false', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Write to primary
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'stale-reject-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Read with short timeout and no allowStale
      const readPromise = replica.read<Thing>('thing-0', {
        minSequence: writeResult.sequence,
        waitTimeoutMs: 100,
        allowStale: false,
      })

      await vi.advanceTimersByTimeAsync(200)

      await expect(readPromise).rejects.toThrow(/timeout|sequence not reached/i)
    })

    it('should forward to primary when preferPrimary is true', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      const readResult = await replica.read<Thing>('thing-0', {
        preferPrimary: true,
      })

      expect(readResult.source).toBe('https://primary.test.do')
      expect(readResult.isStale).toBe(false)
    })

    it('should use default timeout when not specified', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywWaitTimeoutMs: 5000, // Default timeout
      }) as unknown as ReplicaWithRYW

      // Write to primary
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'default-timeout-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Read without explicit timeout
      const readPromise = replica.read<Thing>('thing-0', {
        minSequence: writeResult.sequence,
      })

      // Default timeout should apply
      await vi.advanceTimersByTimeAsync(6000)

      // Should have timed out using default
      await expect(readPromise).rejects.toThrow()
    })
  })

  // ==========================================================================
  // WRITE FORWARDING
  // ==========================================================================

  describe('Write Forwarding', () => {
    it('should forward writes from replica to primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Attempt write on replica
      // @ts-expect-error - accessing internal method
      const writeResult = await replica.writeThing?.({
        id: 'forwarded-thing',
        type: 1,
        data: { name: 'Forwarded Item' },
      }) as WriteResult

      // Write should have occurred on primary
      expect(writeResult.ns).toBe('https://primary.test.do')
    })

    it('should return session token from forwarded write', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // @ts-expect-error - accessing internal method
      const writeResult = await replica.writeThing?.({
        id: 'forwarded-token-thing',
        type: 1,
        data: {},
      }) as WriteResult

      expect(writeResult.sessionToken).toBeDefined()
    })

    it('should be able to read forwarded write immediately on same replica', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write via replica (forwarded to primary)
      // @ts-expect-error - accessing internal method
      const writeResult = await replica.writeThing?.({
        id: 'read-after-forward-thing',
        type: 1,
        data: { name: 'Read After Forward' },
      }) as WriteResult

      // Read with session token
      const readResult = await replica.read<Thing>('read-after-forward-thing', {
        sessionToken: writeResult.sessionToken,
      })

      expect(readResult.data).toBeDefined()
      expect(readResult.data?.id).toBe('read-after-forward-thing')
    })
  })

  // ==========================================================================
  // MULTIPLE REPLICAS
  // ==========================================================================

  describe('Multiple Replicas', () => {
    it('should maintain RYW across different replicas with same session', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write to primary
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'multi-replica-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Sync both replicas
      await replica1.sync()
      await replica2.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Read from both with same session token
      const read1 = await replica1.read<Thing>('multi-replica-thing', {
        sessionToken: writeResult.sessionToken,
      })
      const read2 = await replica2.read<Thing>('multi-replica-thing', {
        sessionToken: writeResult.sessionToken,
      })

      expect(read1.data?.id).toBe('multi-replica-thing')
      expect(read2.data?.id).toBe('multi-replica-thing')
      expect(read1.isStale).toBe(false)
      expect(read2.isStale).toBe(false)
    })

    it('should handle different lag on different replicas', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Write
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'lag-diff-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Sync only replica1
      await replica1.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const lag1 = await replica1.getLag()
      const lag2 = await replica2.getLag()

      expect(lag1).toBeLessThan(lag2)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle expired session token gracefully', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Create and expire a session
      // @ts-expect-error - accessing internal session manager
      const sessionManager = result.instance.sessions as SessionManager
      const session = await sessionManager.createSession('client-1', { ttlSeconds: 1 })

      // Wait for expiration
      await vi.advanceTimersByTimeAsync(5000)

      // Read with expired token should not fail, just not guarantee RYW
      const readResult = await replica.read<Thing>('thing-0', {
        sessionToken: session.sessionId,
      })

      expect(readResult.data).toBeDefined()
    })

    it('should handle reading non-existent thing', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      const readResult = await replica.read<Thing>('non-existent-thing')

      expect(readResult.data).toBeNull()
    })

    it('should handle concurrent writes with same session', async () => {
      // Write multiple items concurrently
      const writePromises = Array.from({ length: 5 }, (_, i) =>
        // @ts-expect-error - accessing internal method
        result.instance.writeThing?.({
          id: `concurrent-thing-${i}`,
          type: 1,
          data: { index: i },
        }, { sessionId: 'concurrent-session' })
      )

      const writeResults = await Promise.all(writePromises) as WriteResult[]

      // All should have valid sequence numbers
      for (const result of writeResults) {
        expect(result.sequence).toBeGreaterThan(0)
      }

      // Sequences should be unique
      const sequences = writeResults.map((r) => r.sequence)
      expect(new Set(sequences).size).toBe(sequences.length)
    })

    it('should handle replica restart (sequence reset)', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Sync
      await replica.sync()
      const seq1 = await replica.getSequence()

      // Simulate restart (sequence might be lost)
      // This would be implementation specific

      // After restart, should recover via sync
      await replica.sync()
      const seq2 = await replica.getSequence()

      expect(seq2).toBeGreaterThanOrEqual(seq1)
    })

    it('should handle primary failover mid-write', async () => {
      // This test documents behavior when primary changes during write
      // Actual implementation may vary

      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'failover-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Session token should reference the namespace where write occurred
      expect(writeResult.ns).toBe('https://primary.test.do')
    })
  })

  // ==========================================================================
  // CONSISTENCY LEVELS (EXTENDED)
  // ==========================================================================

  describe('Bounded Staleness Consistency', () => {
    it('should support bounded staleness with maxLag threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'bounded' as RYWMode,
        maxLag: 10, // Max 10 versions behind
      }) as unknown as ReplicaWithRYW

      // Write to primary within bounds
      for (let i = 0; i < 5; i++) {
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: `bounded-thing-${i}`,
          type: 1,
          data: { index: i },
        })
      }

      // Read from replica - should succeed (within bounds)
      const readResult = await replica.read<Thing>('thing-0')

      // Should allow read when within bounded staleness
      expect(readResult.data).toBeDefined()
      expect(readResult.lag).toBeLessThanOrEqual(10)
    })

    it('should wait for sync when lag exceeds bounded staleness threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'bounded' as RYWMode,
        maxLag: 5,
      }) as unknown as ReplicaWithRYW

      // Write many items to exceed threshold
      for (let i = 0; i < 20; i++) {
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: `exceed-bounded-thing-${i}`,
          type: 1,
          data: { index: i },
        })
      }

      // Start read (should wait for sync)
      const readPromise = replica.read<Thing>('thing-0', {
        waitTimeoutMs: 5000,
      })

      // Sync replica
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const readResult = await readPromise

      // Should have waited for sync
      expect(readResult.lag).toBeLessThanOrEqual(5)
    })

    it('should return stale read if bounded wait times out with allowStale', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'bounded' as RYWMode,
        maxLag: 2,
      }) as unknown as ReplicaWithRYW

      // Write to exceed bounds
      for (let i = 0; i < 10; i++) {
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: `stale-bounded-thing-${i}`,
          type: 1,
          data: {},
        })
      }

      const readPromise = replica.read<Thing>('thing-0', {
        waitTimeoutMs: 100,
        allowStale: true,
      })

      await vi.advanceTimersByTimeAsync(200)

      const readResult = await readPromise

      expect(readResult.isStale).toBe(true)
    })

    it('should reject read if bounded wait times out without allowStale', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'bounded' as RYWMode,
        maxLag: 2,
      }) as unknown as ReplicaWithRYW

      // Write to exceed bounds
      for (let i = 0; i < 10; i++) {
        // @ts-expect-error - accessing internal method
        await result.instance.writeThing?.({
          id: `reject-bounded-thing-${i}`,
          type: 1,
          data: {},
        })
      }

      const readPromise = replica.read<Thing>('thing-0', {
        waitTimeoutMs: 100,
        allowStale: false,
      })

      await vi.advanceTimersByTimeAsync(200)

      await expect(readPromise).rejects.toThrow(/bounded staleness|lag exceeded|timeout/i)
    })

    it('should combine bounded staleness with session token', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'bounded' as RYWMode,
        maxLag: 5,
      }) as unknown as ReplicaWithRYW

      // Write with session
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'combined-bounded-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Session token should still work with bounded mode
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const readResult = await replica.read<Thing>('combined-bounded-thing', {
        sessionToken: writeResult.sessionToken,
      })

      expect(readResult.data).toBeDefined()
      expect(readResult.isStale).toBe(false)
    })
  })

  // ==========================================================================
  // CAUSAL CONSISTENCY
  // ==========================================================================

  describe('Causal Consistency', () => {
    it('should respect causal ordering within a session', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write A depends on nothing
      // @ts-expect-error - accessing internal method
      const writeA = await result.instance.writeThing?.({
        id: 'causal-a',
        type: 1,
        data: { value: 'A' },
      }) as WriteResult

      // Write B causally depends on A
      // @ts-expect-error - accessing internal method
      const writeB = await result.instance.writeThing?.({
        id: 'causal-b',
        type: 1,
        data: { value: 'B', dependsOn: 'causal-a' },
      }, { causalDependency: writeA.sequence }) as WriteResult

      expect(writeB.sequence).toBeGreaterThan(writeA.sequence)

      // Sync replica
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Reading B should imply A is also available
      const readB = await replica.read<Thing>('causal-b', {
        sessionToken: writeB.sessionToken,
      })

      expect(readB.data).toBeDefined()

      // A should be readable if B is readable (causal ordering)
      const readA = await replica.read<Thing>('causal-a')
      expect(readA.data).toBeDefined()
    })

    it('should track causal dependencies between operations', async () => {
      // @ts-expect-error - accessing internal method
      const sessionManager = result.instance.sessions as SessionManager

      const session = await sessionManager.createSession('causal-client')

      // Track dependencies in session
      // @ts-expect-error - accessing internal method
      const write1 = await result.instance.writeThing?.({
        id: 'dep-1',
        type: 1,
        data: {},
      }, { sessionId: session.sessionId }) as WriteResult

      // @ts-expect-error - accessing internal method
      const write2 = await result.instance.writeThing?.({
        id: 'dep-2',
        type: 1,
        data: { ref: 'dep-1' },
      }, {
        sessionId: session.sessionId,
        causalDependency: write1.sequence,
      }) as WriteResult

      // The session should track that write2 depends on write1
      // @ts-expect-error - accessing internal method
      const causalDeps = await result.instance.getCausalDependencies?.(
        session.sessionId,
        write2.sequence
      ) ?? []

      expect(causalDeps).toContain(write1.sequence)
    })

    it('should wait for dependencies before returning reads', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write with causal dependency
      // @ts-expect-error - accessing internal method
      const write1 = await result.instance.writeThing?.({
        id: 'wait-dep-1',
        type: 1,
        data: {},
      }) as WriteResult

      // @ts-expect-error - accessing internal method
      const write2 = await result.instance.writeThing?.({
        id: 'wait-dep-2',
        type: 1,
        data: { dependsOn: 'wait-dep-1' },
      }, { causalDependency: write1.sequence }) as WriteResult

      // Request read with causal guarantee
      const readPromise = replica.read<Thing>('wait-dep-2', {
        sessionToken: write2.sessionToken,
        causallyConsistent: true,
        waitTimeoutMs: 5000,
      })

      // Sync replica
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const readResult = await readPromise

      // Should have waited for both dependencies
      expect(readResult.data).toBeDefined()
      expect(readResult.sequence).toBeGreaterThanOrEqual(write2.sequence)
    })

    it('should handle cross-session causal relationships', async () => {
      // @ts-expect-error - accessing internal method
      const sessionManager = result.instance.sessions as SessionManager

      // Session A writes something
      const sessionA = await sessionManager.createSession('client-a')
      // @ts-expect-error - accessing internal method
      const writeA = await result.instance.writeThing?.({
        id: 'cross-session-a',
        type: 1,
        data: { origin: 'session-a' },
      }, { sessionId: sessionA.sessionId }) as WriteResult

      // Session B reads A's write and writes a response
      const sessionB = await sessionManager.createSession('client-b')

      // @ts-expect-error - accessing internal method
      const writeB = await result.instance.writeThing?.({
        id: 'cross-session-b',
        type: 1,
        data: { responseTo: 'cross-session-a' },
      }, {
        sessionId: sessionB.sessionId,
        causalDependency: writeA.sequence, // Cross-session dependency
      }) as WriteResult

      // Write B should have a higher sequence than A
      expect(writeB.sequence).toBeGreaterThan(writeA.sequence)

      // Reading B should guarantee A is also visible
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const readB = await replica.read<Thing>('cross-session-b', {
        sessionToken: writeB.sessionToken,
        causallyConsistent: true,
      })

      const readA = await replica.read<Thing>('cross-session-a')

      expect(readB.data).toBeDefined()
      expect(readA.data).toBeDefined()
    })

    it('should timeout if causal dependencies cannot be satisfied', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // @ts-expect-error - accessing internal method
      const write = await result.instance.writeThing?.({
        id: 'causal-timeout-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Request read with high causal dependency that won't be met
      const readPromise = replica.read<Thing>('causal-timeout-thing', {
        minSequence: write.sequence + 100, // Higher than exists
        causallyConsistent: true,
        waitTimeoutMs: 100,
        allowStale: false,
      })

      await vi.advanceTimersByTimeAsync(200)

      await expect(readPromise).rejects.toThrow(/causal.*timeout|dependency.*not.*satisfied|timeout|sequence not reached/i)
    })

    it('should emit causal.wait event when waiting for dependencies', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // @ts-expect-error - accessing internal method
      const write = await result.instance.writeThing?.({
        id: 'causal-wait-event-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Request with causal dependency
      replica.read<Thing>('causal-wait-event-thing', {
        sessionToken: write.sessionToken,
        causallyConsistent: true,
        waitTimeoutMs: 5000,
      })

      await vi.advanceTimersByTimeAsync(500)

      const causalEvent = events.find((e) =>
        (e as Record<string, string>).type === 'causal.wait'
      )
      expect(causalEvent).toBeDefined()
    })

    it('should preserve causal ordering during batch writes', async () => {
      // Write a batch where each item depends on the previous
      const results: WriteResult[] = []

      for (let i = 0; i < 5; i++) {
        // @ts-expect-error - accessing internal method
        const write = await result.instance.writeThing?.({
          id: `batch-causal-${i}`,
          type: 1,
          data: { index: i, prev: i > 0 ? `batch-causal-${i - 1}` : null },
        }, {
          causalDependency: i > 0 ? results[i - 1].sequence : undefined,
        }) as WriteResult
        results.push(write)
      }

      // Each sequence should be strictly greater than the previous
      for (let i = 1; i < results.length; i++) {
        expect(results[i].sequence).toBeGreaterThan(results[i - 1].sequence)
      }

      // Reading the last should imply all previous are available
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const lastResult = results[results.length - 1]
      const readLast = await replica.read<Thing>('batch-causal-4', {
        sessionToken: lastResult.sessionToken,
        causallyConsistent: true,
      })

      expect(readLast.data).toBeDefined()

      // All items should be readable
      for (let i = 0; i < 5; i++) {
        const read = await replica.read<Thing>(`batch-causal-${i}`)
        expect(read.data).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  describe('RYW Events', () => {
    it('should emit ryw.wait event when waiting for sequence', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write and read with session
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'wait-event-thing',
        type: 1,
        data: {},
      }) as WriteResult

      replica.read<Thing>('wait-event-thing', {
        sessionToken: writeResult.sessionToken,
        waitTimeoutMs: 1000,
      })

      await vi.advanceTimersByTimeAsync(500)

      const waitEvent = events.find((e) =>
        (e as Record<string, string>).type === 'ryw.wait'
      )
      expect(waitEvent).toBeDefined()
    })

    it('should emit ryw.timeout event when wait times out', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithRYW

      // Read with high minSequence that will timeout
      try {
        await replica.read<Thing>('thing-0', {
          minSequence: 999999,
          waitTimeoutMs: 100,
          allowStale: false,
        })
      } catch {
        // Expected timeout
      }

      await vi.advanceTimersByTimeAsync(200)

      const timeoutEvent = events.find((e) =>
        (e as Record<string, string>).type === 'ryw.timeout'
      )
      expect(timeoutEvent).toBeDefined()
    })

    it('should emit ryw.satisfied event when sequence reached', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        rywMode: 'session',
      }) as unknown as ReplicaWithRYW

      // Write
      // @ts-expect-error - accessing internal method
      const writeResult = await result.instance.writeThing?.({
        id: 'satisfied-thing',
        type: 1,
        data: {},
      }) as WriteResult

      // Read with session
      const readPromise = replica.read<Thing>('satisfied-thing', {
        sessionToken: writeResult.sessionToken,
      })

      // Sync
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)
      await readPromise

      const satisfiedEvent = events.find((e) =>
        (e as Record<string, string>).type === 'ryw.satisfied'
      )
      expect(satisfiedEvent).toBeDefined()
    })
  })
})
