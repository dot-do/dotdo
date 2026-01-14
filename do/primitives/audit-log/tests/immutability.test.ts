/**
 * Audit Log Immutability Tests
 *
 * RED phase: These tests define the expected behavior of immutable audit logs.
 * All tests should FAIL until implementation is complete.
 *
 * Immutability guarantees:
 * - Append-only: entries can only be added, never modified or deleted
 * - Sequential ordering: entries maintain strict chronological order
 * - Tamper detection: any modification to existing entries is detectable
 * - Recovery safety: all committed entries survive crashes
 *
 * @see dotdo-sdp2v - [RED] Immutability tests (append-only, no delete)
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createAuditLog,
  type AuditLog,
  type AuditEntry,
  type AppendResult,
  type BatchAppendResult,
  ImmutabilityViolationError,
  UpdateNotAllowedError,
  DeleteNotAllowedError,
  ConcurrencyError,
  RecoveryError,
} from '../audit-log'
import type { CreateAuditEntryInput } from './audit-entry'

// =============================================================================
// TEST DATA AND HELPERS
// =============================================================================

interface TestPayload {
  userId: string
  action: string
  resourceId: string
  details?: Record<string, unknown>
}

function createTestEntry(overrides: Partial<CreateAuditEntryInput> = {}): CreateAuditEntryInput {
  return {
    actor: { userId: `user-${Math.random().toString(36).slice(2, 8)}` },
    action: 'create',
    resource: {
      type: 'Document',
      id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function createTestLog(): AuditLog {
  return createAuditLog()
}

function createTestLogWithEntries(count: number): { log: AuditLog; entries: AuditEntry[] } {
  const log = createTestLog()
  const entries: AuditEntry[] = []
  for (let i = 0; i < count; i++) {
    const result = log.append(createTestEntry({
      actor: { userId: `user-${i}` },
      resource: { type: 'Document', id: `doc-${i}` },
    }))
    entries.push(result.entry)
  }
  return { log, entries }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// 1. APPEND OPERATION SUCCEEDS
// =============================================================================

describe('AuditLog Immutability', () => {
  describe('1. append operation succeeds', () => {
    it('should successfully append a new entry', () => {
      const log = createTestLog()
      const input = createTestEntry()

      const result = log.append(input)

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
      expect(result.entry).toBeDefined()
      expect(result.entry.id).toBeDefined()
    })

    it('should return the created entry with assigned id', () => {
      const log = createTestLog()
      const input = createTestEntry({
        actor: { userId: 'test-user' },
        action: 'update',
        resource: { type: 'Order', id: 'order-123' },
      })

      const result = log.append(input)

      expect(result.entry.id).toMatch(/^[a-zA-Z0-9-_]+$/)
      expect(result.entry.actor.userId).toBe('test-user')
      expect(result.entry.action.type).toBe('update')
      expect(result.entry.resource.id).toBe('order-123')
    })

    it('should assign monotonically increasing index to entries', () => {
      const log = createTestLog()

      const result1 = log.append(createTestEntry())
      const result2 = log.append(createTestEntry())
      const result3 = log.append(createTestEntry())

      expect(result1.index).toBe(0)
      expect(result2.index).toBe(1)
      expect(result3.index).toBe(2)
    })

    it('should preserve all entry fields after append', () => {
      const log = createTestLog()
      const input = createTestEntry({
        actor: { userId: 'alice', displayName: 'Alice Smith' },
        action: 'delete',
        resource: { type: 'File', id: 'file-456', path: '/docs/report.pdf' },
        before: { name: 'report.pdf', size: 1024 },
        metadata: { ipAddress: '192.168.1.1', userAgent: 'TestClient/1.0' },
      })

      const result = log.append(input)
      const retrieved = log.get(result.entry.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.actor.userId).toBe('alice')
      expect(retrieved!.actor.displayName).toBe('Alice Smith')
      expect(retrieved!.resource.path).toBe('/docs/report.pdf')
      expect(retrieved!.state?.before).toEqual({ name: 'report.pdf', size: 1024 })
      expect(retrieved!.metadata?.ipAddress).toBe('192.168.1.1')
    })

    it('should set createdAt timestamp on append', () => {
      const log = createTestLog()
      const beforeAppend = Date.now()

      const result = log.append(createTestEntry())

      const afterAppend = Date.now()
      const createdAt = new Date(result.entry.createdAt).getTime()

      expect(createdAt).toBeGreaterThanOrEqual(beforeAppend)
      expect(createdAt).toBeLessThanOrEqual(afterAppend)
    })
  })

  // =============================================================================
  // 2. UPDATE OPERATION THROWS/FAILS
  // =============================================================================

  describe('2. update operation throws/fails', () => {
    it('should throw UpdateNotAllowedError when attempting to update an entry', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.update(entry.id, { action: 'modified-action' })
      }).toThrow(UpdateNotAllowedError)
    })

    it('should throw with entry id in error', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      try {
        log.update(entry.id, { action: 'modified' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(UpdateNotAllowedError)
        expect((error as UpdateNotAllowedError).entryId).toBe(entry.id)
      }
    })

    it('should not modify entry when update is attempted', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!
      const originalAction = entry.action.type

      try {
        log.update(entry.id, { action: 'modified-action' })
      } catch {
        // Expected
      }

      const retrieved = log.get(entry.id)
      expect(retrieved!.action.type).toBe(originalAction)
    })

    it('should throw when attempting to modify actor', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.update(entry.id, { actor: { userId: 'different-user' } })
      }).toThrow(UpdateNotAllowedError)
    })

    it('should throw when attempting to modify resource', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.update(entry.id, { resource: { type: 'Different', id: 'other' } })
      }).toThrow(UpdateNotAllowedError)
    })

    it('should throw when attempting to modify state', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.update(entry.id, { before: { tampered: true }, after: { tampered: true } })
      }).toThrow(UpdateNotAllowedError)
    })

    it('should throw when attempting to modify metadata', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.update(entry.id, { metadata: { ipAddress: 'spoofed' } })
      }).toThrow(UpdateNotAllowedError)
    })
  })

  // =============================================================================
  // 3. DELETE OPERATION THROWS/FAILS
  // =============================================================================

  describe('3. delete operation throws/fails', () => {
    it('should throw DeleteNotAllowedError when attempting to delete an entry', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.delete(entry.id)
      }).toThrow(DeleteNotAllowedError)
    })

    it('should throw with entry id in error', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      try {
        log.delete(entry.id)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DeleteNotAllowedError)
        expect((error as DeleteNotAllowedError).entryId).toBe(entry.id)
      }
    })

    it('should preserve entry after delete attempt', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      try {
        log.delete(entry.id)
      } catch {
        // Expected
      }

      const retrieved = log.get(entry.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(entry.id)
    })

    it('should throw when attempting bulk delete', () => {
      const { log, entries } = createTestLogWithEntries(3)
      const ids = entries.map((e) => e.id)

      expect(() => {
        log.deleteMany(ids)
      }).toThrow(DeleteNotAllowedError)
    })

    it('should throw when attempting to clear the log', () => {
      const { log } = createTestLogWithEntries(5)

      expect(() => {
        log.clear()
      }).toThrow(DeleteNotAllowedError)
    })

    it('should throw when attempting to truncate the log', () => {
      const { log } = createTestLogWithEntries(5)

      expect(() => {
        log.truncate(2) // Attempt to keep only first 2 entries
      }).toThrow(DeleteNotAllowedError)
    })

    it('should maintain count after failed delete', () => {
      const { log, entries } = createTestLogWithEntries(3)

      try {
        log.delete(entries[0]!.id)
      } catch {
        // Expected
      }

      expect(log.count()).toBe(3)
    })
  })

  // =============================================================================
  // 4. SEQUENTIAL ORDERING PRESERVED
  // =============================================================================

  describe('4. sequential ordering preserved', () => {
    it('should return entries in append order', () => {
      const log = createTestLog()
      const inputs = [
        createTestEntry({ actor: { userId: 'first' } }),
        createTestEntry({ actor: { userId: 'second' } }),
        createTestEntry({ actor: { userId: 'third' } }),
      ]

      inputs.forEach((input) => log.append(input))

      const all = log.list()
      expect(all[0]!.actor.userId).toBe('first')
      expect(all[1]!.actor.userId).toBe('second')
      expect(all[2]!.actor.userId).toBe('third')
    })

    it('should preserve order in range queries', () => {
      const log = createTestLog()
      for (let i = 0; i < 10; i++) {
        log.append(createTestEntry({ actor: { userId: `user-${i}` } }))
      }

      const range = log.range(3, 7) // entries 3, 4, 5, 6

      expect(range).toHaveLength(4)
      expect(range[0]!.actor.userId).toBe('user-3')
      expect(range[1]!.actor.userId).toBe('user-4')
      expect(range[2]!.actor.userId).toBe('user-5')
      expect(range[3]!.actor.userId).toBe('user-6')
    })

    it('should preserve order when iterating', async () => {
      const log = createTestLog()
      for (let i = 0; i < 5; i++) {
        log.append(createTestEntry({ actor: { userId: `user-${i}` } }))
      }

      const collected: AuditEntry[] = []
      for await (const entry of log.iterate()) {
        collected.push(entry)
      }

      expect(collected).toHaveLength(5)
      for (let i = 0; i < 5; i++) {
        expect(collected[i]!.actor.userId).toBe(`user-${i}`)
      }
    })

    it('should not allow reordering of entries', () => {
      const { log, entries } = createTestLogWithEntries(3)

      expect(() => {
        log.reorder([entries[2]!.id, entries[0]!.id, entries[1]!.id])
      }).toThrow(ImmutabilityViolationError)
    })

    it('should maintain order across pagination', () => {
      const log = createTestLog()
      for (let i = 0; i < 25; i++) {
        log.append(createTestEntry({ actor: { userId: `user-${i}` } }))
      }

      const page1 = log.list({ limit: 10, offset: 0 })
      const page2 = log.list({ limit: 10, offset: 10 })
      const page3 = log.list({ limit: 10, offset: 20 })

      expect(page1[0]!.actor.userId).toBe('user-0')
      expect(page1[9]!.actor.userId).toBe('user-9')
      expect(page2[0]!.actor.userId).toBe('user-10')
      expect(page2[9]!.actor.userId).toBe('user-19')
      expect(page3[0]!.actor.userId).toBe('user-20')
      expect(page3[4]!.actor.userId).toBe('user-24')
    })
  })

  // =============================================================================
  // 5. ENTRY INDICES ARE MONOTONICALLY INCREASING
  // =============================================================================

  describe('5. entry indices are monotonically increasing', () => {
    it('should assign indices starting from 0', () => {
      const log = createTestLog()

      const result = log.append(createTestEntry())

      expect(result.index).toBe(0)
    })

    it('should increment index for each append', () => {
      const log = createTestLog()
      const indices: number[] = []

      for (let i = 0; i < 5; i++) {
        const result = log.append(createTestEntry())
        indices.push(result.index)
      }

      expect(indices).toEqual([0, 1, 2, 3, 4])
    })

    it('should never reuse indices', () => {
      const log = createTestLog()
      const seenIndices = new Set<number>()

      for (let i = 0; i < 100; i++) {
        const result = log.append(createTestEntry())
        expect(seenIndices.has(result.index)).toBe(false)
        seenIndices.add(result.index)
      }
    })

    it('should have no gaps in indices', () => {
      const log = createTestLog()

      for (let i = 0; i < 10; i++) {
        log.append(createTestEntry())
      }

      const entries = log.list()
      for (let i = 0; i < entries.length; i++) {
        expect(log.getByIndex(i)).not.toBeNull()
      }
    })

    it('should expose index on retrieved entries', () => {
      const log = createTestLog()

      for (let i = 0; i < 5; i++) {
        log.append(createTestEntry({ actor: { userId: `user-${i}` } }))
      }

      const entry = log.getByIndex(3)
      expect(entry).not.toBeNull()
      expect(entry!.actor.userId).toBe('user-3')
    })

    it('should track highest index correctly', () => {
      const log = createTestLog()

      expect(log.highestIndex()).toBe(-1) // Empty log

      log.append(createTestEntry())
      expect(log.highestIndex()).toBe(0)

      log.append(createTestEntry())
      log.append(createTestEntry())
      expect(log.highestIndex()).toBe(2)
    })
  })

  // =============================================================================
  // 6. CANNOT MODIFY EXISTING ENTRY DATA
  // =============================================================================

  describe('6. cannot modify existing entry data', () => {
    it('should return frozen/immutable entry objects', () => {
      const log = createTestLog()
      const result = log.append(createTestEntry({ actor: { userId: 'original' } }))
      const entry = result.entry

      expect(() => {
        ;(entry as any).actor.userId = 'modified'
      }).toThrow()
    })

    it('should not allow direct property assignment on retrieved entries', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const retrieved = log.get(entries[0]!.id)!

      expect(() => {
        ;(retrieved as any).action = { type: 'tampered' }
      }).toThrow()
    })

    it('should not allow nested object modification', () => {
      const log = createTestLog()
      log.append(createTestEntry({
        before: { name: 'original', nested: { value: 1 } },
      }))
      const entry = log.list()[0]!

      expect(() => {
        ;(entry.state!.before as any).name = 'modified'
      }).toThrow()

      expect(() => {
        ;(entry.state!.before as any).nested.value = 999
      }).toThrow()
    })

    it('should not allow array modification in entry data', () => {
      const log = createTestLog()
      log.append(createTestEntry({
        metadata: { custom: { tags: ['a', 'b', 'c'] } },
      }))
      const entry = log.list()[0]!

      expect(() => {
        ;(entry.metadata!.custom as any).tags.push('tampered')
      }).toThrow()
    })

    it('should create defensive copies on get', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry1 = log.get(entries[0]!.id)
      const entry2 = log.get(entries[0]!.id)

      // Different object references
      expect(entry1).not.toBe(entry2)
      // But same data
      expect(entry1).toEqual(entry2)
    })

    it('should not allow modification via list results', () => {
      const log = createTestLog()
      log.append(createTestEntry({ actor: { userId: 'original' } }))

      const list = log.list()

      expect(() => {
        ;(list[0] as any).actor.userId = 'modified'
      }).toThrow()
    })
  })

  // =============================================================================
  // 7. CANNOT CHANGE ENTRY TIMESTAMPS AFTER CREATION
  // =============================================================================

  describe('7. cannot change entry timestamps after creation', () => {
    it('should preserve original timestamp from input', () => {
      const log = createTestLog()
      const originalTimestamp = '2024-01-15T12:00:00.000Z'

      const result = log.append(createTestEntry({ timestamp: originalTimestamp }))

      expect(result.entry.timestamp.iso).toBe(originalTimestamp)
    })

    it('should not allow modification of timestamp.iso', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = log.get(entries[0]!.id)!

      expect(() => {
        ;(entry.timestamp as any).iso = '2099-12-31T23:59:59.999Z'
      }).toThrow()
    })

    it('should not allow modification of timestamp.epochMs', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = log.get(entries[0]!.id)!

      expect(() => {
        ;(entry.timestamp as any).epochMs = 9999999999999
      }).toThrow()
    })

    it('should not allow modification of createdAt', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = log.get(entries[0]!.id)!

      expect(() => {
        ;(entry as any).createdAt = '2099-12-31T23:59:59.999Z'
      }).toThrow()
    })

    it('should throw when attempting to backdate via update', () => {
      const { log, entries } = createTestLogWithEntries(1)
      const entry = entries[0]!

      expect(() => {
        log.update(entry.id, { timestamp: '2000-01-01T00:00:00.000Z' })
      }).toThrow(UpdateNotAllowedError)
    })

    it('should maintain timestamp consistency across reads', () => {
      const log = createTestLog()
      const timestamp = '2024-06-15T10:30:00.000Z'
      const result = log.append(createTestEntry({ timestamp }))

      // Multiple reads should return same timestamp
      const read1 = log.get(result.entry.id)
      const read2 = log.get(result.entry.id)
      const read3 = log.getByIndex(0)

      expect(read1!.timestamp.iso).toBe(timestamp)
      expect(read2!.timestamp.iso).toBe(timestamp)
      expect(read3!.timestamp.iso).toBe(timestamp)
    })
  })

  // =============================================================================
  // 8. BATCH APPEND MAINTAINS ORDERING
  // =============================================================================

  describe('8. batch append maintains ordering', () => {
    it('should append batch entries in provided order', () => {
      const log = createTestLog()
      const inputs = [
        createTestEntry({ actor: { userId: 'batch-first' } }),
        createTestEntry({ actor: { userId: 'batch-second' } }),
        createTestEntry({ actor: { userId: 'batch-third' } }),
      ]

      const result = log.appendBatch(inputs)

      expect(result.entries).toHaveLength(3)
      expect(result.entries[0]!.actor.userId).toBe('batch-first')
      expect(result.entries[1]!.actor.userId).toBe('batch-second')
      expect(result.entries[2]!.actor.userId).toBe('batch-third')
    })

    it('should assign sequential indices within batch', () => {
      const log = createTestLog()
      const inputs = Array.from({ length: 5 }, (_, i) =>
        createTestEntry({ actor: { userId: `batch-${i}` } })
      )

      const result = log.appendBatch(inputs)

      expect(result.indices).toEqual([0, 1, 2, 3, 4])
    })

    it('should continue indices from previous entries', () => {
      const log = createTestLog()

      // First append some individual entries
      log.append(createTestEntry())
      log.append(createTestEntry())
      log.append(createTestEntry())

      // Then batch append
      const batchInputs = [createTestEntry(), createTestEntry()]
      const result = log.appendBatch(batchInputs)

      expect(result.indices).toEqual([3, 4])
    })

    it('should maintain batch order in list after append', () => {
      const log = createTestLog()
      const batchInputs = Array.from({ length: 10 }, (_, i) =>
        createTestEntry({ actor: { userId: `ordered-${i}` } })
      )

      log.appendBatch(batchInputs)

      const all = log.list()
      for (let i = 0; i < 10; i++) {
        expect(all[i]!.actor.userId).toBe(`ordered-${i}`)
      }
    })

    it('should atomically append all entries or none', () => {
      const log = createTestLog()
      const inputs = [
        createTestEntry({ actor: { userId: 'valid-1' } }),
        { invalid: 'entry' } as any, // Invalid entry
        createTestEntry({ actor: { userId: 'valid-2' } }),
      ]

      expect(() => {
        log.appendBatch(inputs, { atomic: true })
      }).toThrow()

      // None should be appended
      expect(log.count()).toBe(0)
    })

    it('should support partial batch append with failures', () => {
      const log = createTestLog()
      const inputs = [
        createTestEntry({ actor: { userId: 'valid-1' } }),
        { invalid: 'entry' } as any, // Invalid entry
        createTestEntry({ actor: { userId: 'valid-2' } }),
      ]

      const result = log.appendBatch(inputs, { atomic: false })

      expect(result.entries).toHaveLength(2)
      expect(result.failed).toHaveLength(1)
      expect(log.count()).toBe(2)
    })
  })

  // =============================================================================
  // 9. CONCURRENT APPENDS SERIALIZE CORRECTLY
  // =============================================================================

  describe('9. concurrent appends serialize correctly', () => {
    it('should handle concurrent appends without data loss', async () => {
      const log = createTestLog()
      const appendCount = 100

      const promises = Array.from({ length: appendCount }, (_, i) =>
        Promise.resolve().then(() =>
          log.append(createTestEntry({ actor: { userId: `concurrent-${i}` } }))
        )
      )

      await Promise.all(promises)

      expect(log.count()).toBe(appendCount)
    })

    it('should assign unique indices to concurrent appends', async () => {
      const log = createTestLog()
      const appendCount = 50

      const results = await Promise.all(
        Array.from({ length: appendCount }, () =>
          Promise.resolve().then(() => log.append(createTestEntry()))
        )
      )

      const indices = results.map((r) => r.index)
      const uniqueIndices = new Set(indices)

      expect(uniqueIndices.size).toBe(appendCount)
    })

    it('should maintain sequential indices under concurrency', async () => {
      const log = createTestLog()
      const appendCount = 100

      await Promise.all(
        Array.from({ length: appendCount }, () =>
          Promise.resolve().then(() => log.append(createTestEntry()))
        )
      )

      const all = log.list()
      for (let i = 0; i < appendCount; i++) {
        expect(log.getByIndex(i)).not.toBeNull()
      }
    })

    it('should handle concurrent batch appends', async () => {
      const log = createTestLog()
      const batchCount = 10
      const entriesPerBatch = 10

      const batches = Array.from({ length: batchCount }, (_, batchIdx) =>
        Array.from({ length: entriesPerBatch }, (_, entryIdx) =>
          createTestEntry({ actor: { userId: `batch-${batchIdx}-entry-${entryIdx}` } })
        )
      )

      await Promise.all(batches.map((batch) => Promise.resolve().then(() => log.appendBatch(batch))))

      expect(log.count()).toBe(batchCount * entriesPerBatch)
    })

    it('should serialize mixed single and batch appends', async () => {
      const log = createTestLog()

      const operations = [
        () => log.append(createTestEntry({ actor: { userId: 'single-1' } })),
        () => log.appendBatch([
          createTestEntry({ actor: { userId: 'batch1-a' } }),
          createTestEntry({ actor: { userId: 'batch1-b' } }),
        ]),
        () => log.append(createTestEntry({ actor: { userId: 'single-2' } })),
        () => log.appendBatch([
          createTestEntry({ actor: { userId: 'batch2-a' } }),
          createTestEntry({ actor: { userId: 'batch2-b' } }),
          createTestEntry({ actor: { userId: 'batch2-c' } }),
        ]),
        () => log.append(createTestEntry({ actor: { userId: 'single-3' } })),
      ]

      await Promise.all(operations.map((op) => Promise.resolve().then(op)))

      expect(log.count()).toBe(8)

      // All indices should be unique and sequential
      const indices = log.list().map((_, i) => log.getByIndex(i)?.id)
      const uniqueIds = new Set(indices.filter(Boolean))
      expect(uniqueIds.size).toBe(8)
    })

    it('should detect concurrent modification conflicts', async () => {
      const log = createTestLog()

      // Simulate a scenario where optimistic locking would detect conflict
      const entry = log.append(createTestEntry())

      // Two concurrent "read-modify-write" operations should conflict
      // (In an immutable log, this manifests as the log rejecting modifications)
      const version = entry.entry.schemaVersion

      await expect(async () => {
        await Promise.all([
          log.appendWithVersion(createTestEntry(), version),
          log.appendWithVersion(createTestEntry(), version),
        ])
      }).rejects.toThrow(ConcurrencyError)
    })
  })

  // =============================================================================
  // 10. RECOVERY AFTER CRASH PRESERVES ALL ENTRIES
  // =============================================================================

  describe('10. recovery after crash preserves all entries', () => {
    it('should persist entries durably', async () => {
      const log = createTestLog()

      for (let i = 0; i < 10; i++) {
        log.append(createTestEntry({ actor: { userId: `persist-${i}` } }))
      }

      // Force flush to durable storage
      await log.flush()

      // Simulate recovery by creating new log instance with same storage
      const recoveredLog = createAuditLog({ storage: log.getStorage() })

      expect(recoveredLog.count()).toBe(10)
    })

    it('should preserve entry order after recovery', async () => {
      const log = createTestLog()

      for (let i = 0; i < 5; i++) {
        log.append(createTestEntry({ actor: { userId: `order-${i}` } }))
      }

      await log.flush()
      const recoveredLog = createAuditLog({ storage: log.getStorage() })

      const entries = recoveredLog.list()
      for (let i = 0; i < 5; i++) {
        expect(entries[i]!.actor.userId).toBe(`order-${i}`)
      }
    })

    it('should preserve entry data integrity after recovery', async () => {
      const log = createTestLog()

      log.append(createTestEntry({
        actor: { userId: 'integrity-test', displayName: 'Test User' },
        action: 'update',
        resource: { type: 'Account', id: 'acc-123', path: '/accounts/acc-123' },
        before: { balance: 100 },
        after: { balance: 150 },
        metadata: { ipAddress: '10.0.0.1', requestId: 'req-xyz' },
      }))

      await log.flush()
      const recoveredLog = createAuditLog({ storage: log.getStorage() })

      const entry = recoveredLog.getByIndex(0)!
      expect(entry.actor.userId).toBe('integrity-test')
      expect(entry.actor.displayName).toBe('Test User')
      expect(entry.action.type).toBe('update')
      expect(entry.resource.path).toBe('/accounts/acc-123')
      expect(entry.state!.before).toEqual({ balance: 100 })
      expect(entry.state!.after).toEqual({ balance: 150 })
      expect(entry.metadata!.ipAddress).toBe('10.0.0.1')
    })

    it('should recover with correct highest index', async () => {
      const log = createTestLog()

      for (let i = 0; i < 7; i++) {
        log.append(createTestEntry())
      }

      await log.flush()
      const recoveredLog = createAuditLog({ storage: log.getStorage() })

      expect(recoveredLog.highestIndex()).toBe(6)

      // New appends should continue from correct index
      const newResult = recoveredLog.append(createTestEntry())
      expect(newResult.index).toBe(7)
    })

    it('should handle recovery of empty log', async () => {
      const log = createTestLog()

      await log.flush()
      const recoveredLog = createAuditLog({ storage: log.getStorage() })

      expect(recoveredLog.count()).toBe(0)
      expect(recoveredLog.highestIndex()).toBe(-1)
    })

    it('should detect corrupted entries during recovery', async () => {
      const log = createTestLog()

      for (let i = 0; i < 5; i++) {
        log.append(createTestEntry())
      }

      await log.flush()

      // Corrupt the storage
      const storage = log.getStorage()
      storage.corrupt(2) // Corrupt entry at index 2

      expect(() => {
        createAuditLog({ storage, validateOnRecovery: true })
      }).toThrow(RecoveryError)
    })

    it('should support write-ahead log for crash safety', async () => {
      const log = createAuditLog({ walEnabled: true })

      // Start a transaction
      const tx = log.beginTransaction()

      tx.append(createTestEntry({ actor: { userId: 'wal-1' } }))
      tx.append(createTestEntry({ actor: { userId: 'wal-2' } }))

      // Simulate crash before commit (don't call tx.commit())

      // Recovery should not include uncommitted entries
      const recoveredLog = createAuditLog({
        storage: log.getStorage(),
        walEnabled: true,
      })

      expect(recoveredLog.count()).toBe(0)
    })

    it('should recover committed transactions after crash', async () => {
      const log = createAuditLog({ walEnabled: true })

      const tx = log.beginTransaction()
      tx.append(createTestEntry({ actor: { userId: 'committed-1' } }))
      tx.append(createTestEntry({ actor: { userId: 'committed-2' } }))
      await tx.commit()

      // Simulate crash and recovery
      const recoveredLog = createAuditLog({
        storage: log.getStorage(),
        walEnabled: true,
      })

      expect(recoveredLog.count()).toBe(2)
      expect(recoveredLog.getByIndex(0)!.actor.userId).toBe('committed-1')
      expect(recoveredLog.getByIndex(1)!.actor.userId).toBe('committed-2')
    })

    it('should maintain immutability guarantees after recovery', async () => {
      const log = createTestLog()

      log.append(createTestEntry({ actor: { userId: 'immutable-test' } }))
      await log.flush()

      const recoveredLog = createAuditLog({ storage: log.getStorage() })
      const entry = recoveredLog.getByIndex(0)!

      // Should still be immutable after recovery
      expect(() => {
        recoveredLog.update(entry.id, { action: 'tampered' })
      }).toThrow(UpdateNotAllowedError)

      expect(() => {
        recoveredLog.delete(entry.id)
      }).toThrow(DeleteNotAllowedError)
    })
  })
})
