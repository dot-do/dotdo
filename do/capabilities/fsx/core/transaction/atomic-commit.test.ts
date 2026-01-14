/**
 * Atomic Transaction Commit Tests - TDD RED Phase
 *
 * Tests for multi-operation atomic commits with all-or-nothing semantics.
 * These tests verify that transactions commit atomically - either all
 * operations succeed or all are rolled back.
 *
 * Issue: fsx-vtp7
 *
 * @module core/transaction/atomic-commit.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Transaction, type TransactionStorage } from './transaction'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Creates a mock storage with tracking capabilities for atomic commit testing
 */
function createAtomicMockStorage() {
  const files = new Map<string, Uint8Array>()
  const directories = new Set<string>(['/'])
  const operationLog: Array<{ op: string; path: string; timestamp: number }> = []
  let operationCounter = 0

  const storage: TransactionStorage & {
    getFiles: () => Map<string, Uint8Array>
    getDirectories: () => Set<string>
    getOperationLog: () => typeof operationLog
    injectFailure: (op: string, path: string, error: Error) => void
    reset: () => void
  } = {
    writeFile: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
      const failure = failures.get(`writeFile:${path}`)
      if (failure) throw failure

      operationLog.push({ op: 'writeFile', path, timestamp: operationCounter++ })
      files.set(path, data)
    }),

    readFile: vi.fn().mockImplementation(async (path: string) => {
      operationLog.push({ op: 'readFile', path, timestamp: operationCounter++ })
      const content = files.get(path)
      if (!content) throw new Error(`ENOENT: ${path}`)
      return content
    }),

    exists: vi.fn().mockImplementation(async (path: string) => {
      return files.has(path) || directories.has(path)
    }),

    unlink: vi.fn().mockImplementation(async (path: string) => {
      const failure = failures.get(`unlink:${path}`)
      if (failure) throw failure

      operationLog.push({ op: 'unlink', path, timestamp: operationCounter++ })
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`)
      files.delete(path)
    }),

    rm: vi.fn().mockImplementation(async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
      const failure = failures.get(`rm:${path}`)
      if (failure) throw failure

      operationLog.push({ op: 'rm', path, timestamp: operationCounter++ })
      if (!options?.force && !files.has(path) && !directories.has(path)) {
        throw new Error(`ENOENT: ${path}`)
      }
      files.delete(path)
      if (options?.recursive) {
        // Remove all files/dirs under this path
        for (const p of files.keys()) {
          if (p.startsWith(path + '/')) files.delete(p)
        }
        for (const p of directories) {
          if (p.startsWith(path + '/') || p === path) directories.delete(p)
        }
      }
    }),

    rmdir: vi.fn().mockImplementation(async (path: string, options?: { recursive?: boolean }) => {
      const failure = failures.get(`rmdir:${path}`)
      if (failure) throw failure

      operationLog.push({ op: 'rmdir', path, timestamp: operationCounter++ })
      if (!directories.has(path)) throw new Error(`ENOENT: ${path}`)
      directories.delete(path)
    }),

    rename: vi.fn().mockImplementation(async (oldPath: string, newPath: string) => {
      const failure = failures.get(`rename:${oldPath}`)
      if (failure) throw failure

      operationLog.push({ op: 'rename', path: `${oldPath} -> ${newPath}`, timestamp: operationCounter++ })
      const content = files.get(oldPath)
      if (!content) throw new Error(`ENOENT: ${oldPath}`)
      files.delete(oldPath)
      // Overwrite target if exists (standard rename behavior)
      files.set(newPath, content)
    }),

    mkdir: vi.fn().mockImplementation(async (path: string, options?: { recursive?: boolean; mode?: number }) => {
      const failure = failures.get(`mkdir:${path}`)
      if (failure) throw failure

      operationLog.push({ op: 'mkdir', path, timestamp: operationCounter++ })

      // Check parent exists unless recursive
      if (!options?.recursive) {
        const parent = path.substring(0, path.lastIndexOf('/')) || '/'
        if (parent !== '/' && !directories.has(parent)) {
          throw new Error(`ENOENT: ${parent}`)
        }
      }

      directories.add(path)

      // In recursive mode, create all parent directories
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          directories.add(current)
        }
      }
    }),

    getFiles: () => files,
    getDirectories: () => directories,
    getOperationLog: () => operationLog,

    injectFailure: (op: string, path: string, error: Error) => {
      failures.set(`${op}:${path}`, error)
    },

    reset: () => {
      files.clear()
      directories.clear()
      directories.add('/')
      operationLog.length = 0
      operationCounter = 0
      failures.clear()
    },
  }

  const failures = new Map<string, Error>()

  return storage
}

// ============================================================================
// ATOMIC MULTI-OPERATION COMMIT TESTS
// ============================================================================

/**
 * Creates a mock storage with database-level transaction support
 */
function createDbTransactionStorage() {
  const files = new Map<string, Uint8Array>()
  const pendingFiles = new Map<string, Uint8Array>() // Staged changes
  let inTransaction = false
  const operationLog: string[] = []

  const storage: TransactionStorage = {
    writeFile: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
      if (inTransaction) {
        pendingFiles.set(path, data)
      } else {
        files.set(path, data)
      }
      operationLog.push(`writeFile:${path}`)
    }),

    readFile: vi.fn().mockImplementation(async (path: string) => {
      const content = files.get(path)
      if (!content) throw new Error(`ENOENT: ${path}`)
      return content
    }),

    exists: vi.fn().mockImplementation(async (path: string) => {
      return files.has(path)
    }),

    rm: vi.fn().mockImplementation(async (path: string) => {
      if (inTransaction) {
        pendingFiles.set(path, new Uint8Array(0)) // Mark for deletion
      } else {
        files.delete(path)
      }
      operationLog.push(`rm:${path}`)
    }),

    beginTransaction: vi.fn().mockImplementation(async (name?: string) => {
      inTransaction = true
      pendingFiles.clear()
      operationLog.push(`BEGIN:${name || 'unnamed'}`)

      return {
        commit: async () => {
          // Apply all pending changes
          for (const [path, data] of pendingFiles) {
            if (data.length === 0) {
              files.delete(path)
            } else {
              files.set(path, data)
            }
          }
          pendingFiles.clear()
          inTransaction = false
          operationLog.push('COMMIT')
        },
        rollback: async () => {
          // Discard all pending changes
          pendingFiles.clear()
          inTransaction = false
          operationLog.push('ROLLBACK')
        },
      }
    }),
  }

  return {
    storage,
    getFiles: () => files,
    getOperationLog: () => operationLog,
    isInTransaction: () => inTransaction,
  }
}

describe('Atomic Multi-Operation Commits', () => {
  let storage: ReturnType<typeof createAtomicMockStorage>

  beforeEach(() => {
    storage = createAtomicMockStorage()
  })

  describe('All-or-nothing semantics', () => {
    it('should commit all writes atomically on success', async () => {
      const tx = new Transaction()
        .writeFile('/a.txt', 'content a')
        .writeFile('/b.txt', 'content b')
        .writeFile('/c.txt', 'content c')

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().has('/a.txt')).toBe(true)
      expect(storage.getFiles().has('/b.txt')).toBe(true)
      expect(storage.getFiles().has('/c.txt')).toBe(true)
    })

    it('should rollback all writes when any single write fails', async () => {
      storage.injectFailure('writeFile', '/b.txt', new Error('Disk full'))

      const tx = new Transaction()
        .writeFile('/a.txt', 'content a')
        .writeFile('/b.txt', 'content b')
        .writeFile('/c.txt', 'content c')

      await expect(tx.execute(storage)).rejects.toThrow('Disk full')

      expect(tx.status).toBe('rolled_back')
      // All files should be cleaned up after rollback
      expect(storage.getFiles().has('/a.txt')).toBe(false)
      expect(storage.getFiles().has('/b.txt')).toBe(false)
      expect(storage.getFiles().has('/c.txt')).toBe(false)
    })

    it('should commit write + rename + delete as single atomic unit', async () => {
      // Pre-populate file to delete
      await storage.writeFile('/old.txt', new TextEncoder().encode('old content'))

      const tx = new Transaction()
        .writeFile('/new.txt', 'new content')
        .rename('/new.txt', '/renamed.txt')
        .unlink('/old.txt')

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().has('/new.txt')).toBe(false) // Renamed away
      expect(storage.getFiles().has('/renamed.txt')).toBe(true)
      expect(storage.getFiles().has('/old.txt')).toBe(false) // Deleted
    })

    it('should rollback write + rename + delete on failure', async () => {
      // Pre-populate file to delete
      const oldContent = new TextEncoder().encode('old content')
      await storage.writeFile('/old.txt', oldContent)
      storage.reset() // Clear operation log

      // Re-add the old file after reset
      await storage.writeFile('/old.txt', oldContent)

      // Inject failure on the delete
      storage.injectFailure('unlink', '/old.txt', new Error('Permission denied'))

      const tx = new Transaction()
        .writeFile('/new.txt', 'new content')
        .rename('/new.txt', '/renamed.txt')
        .unlink('/old.txt')

      await expect(tx.execute(storage)).rejects.toThrow('Permission denied')

      expect(tx.status).toBe('rolled_back')
      // The write and rename should be rolled back
      expect(storage.getFiles().has('/new.txt')).toBe(false)
      expect(storage.getFiles().has('/renamed.txt')).toBe(false)
      // Old file should still exist (delete failed, rolled back)
      expect(storage.getFiles().has('/old.txt')).toBe(true)
    })
  })

  describe('Partial failure rollback', () => {
    it('should rollback all operations when operation 3 of 5 fails', async () => {
      // Inject failure on 3rd write
      storage.injectFailure('writeFile', '/c.txt', new Error('Third operation failed'))

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')
        .writeFile('/c.txt', 'c') // This will fail
        .writeFile('/d.txt', 'd')
        .writeFile('/e.txt', 'e')

      await expect(tx.execute(storage)).rejects.toThrow('Third operation failed')

      expect(tx.status).toBe('rolled_back')
      // All files should be cleaned up
      expect(storage.getFiles().has('/a.txt')).toBe(false)
      expect(storage.getFiles().has('/b.txt')).toBe(false)
      expect(storage.getFiles().has('/c.txt')).toBe(false)
      expect(storage.getFiles().has('/d.txt')).toBe(false)
      expect(storage.getFiles().has('/e.txt')).toBe(false)
    })

    it('should preserve previously existing files during rollback', async () => {
      // Pre-existing file
      await storage.writeFile('/existing.txt', new TextEncoder().encode('existing content'))

      // Inject failure on 2nd write
      storage.injectFailure('writeFile', '/fail.txt', new Error('Failed'))

      const tx = new Transaction()
        .writeFile('/existing.txt', 'overwritten') // Overwrite existing
        .writeFile('/fail.txt', 'will fail')

      await expect(tx.execute(storage)).rejects.toThrow('Failed')

      // Existing file should be restored to original content
      const existingContent = storage.getFiles().get('/existing.txt')
      expect(existingContent).toBeDefined()
      expect(new TextDecoder().decode(existingContent!)).toBe('existing content')
    })

    it('should record rollback summary with all operations', async () => {
      storage.injectFailure('writeFile', '/c.txt', new Error('Failed'))

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')
        .writeFile('/c.txt', 'c')

      await expect(tx.execute(storage, { transactionId: 'test-partial' })).rejects.toThrow()

      expect(tx.lastRollbackSummary).toBeDefined()
      expect(tx.lastRollbackSummary!.transactionId).toBe('test-partial')
      expect(tx.lastRollbackSummary!.totalOperations).toBe(2) // a.txt and b.txt were completed
      expect(tx.lastRollbackSummary!.results.length).toBe(2)
    })
  })

  describe('Large transaction batches', () => {
    it('should handle 100+ operations atomically', async () => {
      const tx = new Transaction()

      // Add 100 write operations
      for (let i = 0; i < 100; i++) {
        tx.writeFile(`/file${i.toString().padStart(3, '0')}.txt`, `content ${i}`)
      }

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().size).toBe(100)

      // Verify all files exist
      for (let i = 0; i < 100; i++) {
        expect(storage.getFiles().has(`/file${i.toString().padStart(3, '0')}.txt`)).toBe(true)
      }
    })

    it('should rollback all 100+ operations on late failure', async () => {
      // Fail on operation #95
      storage.injectFailure('writeFile', '/file095.txt', new Error('Late failure'))

      const tx = new Transaction()

      for (let i = 0; i < 100; i++) {
        tx.writeFile(`/file${i.toString().padStart(3, '0')}.txt`, `content ${i}`)
      }

      await expect(tx.execute(storage)).rejects.toThrow('Late failure')

      expect(tx.status).toBe('rolled_back')
      // All files should be cleaned up
      expect(storage.getFiles().size).toBe(0)
    })

    it('should handle 500 operations for stress testing', async () => {
      const tx = new Transaction()

      for (let i = 0; i < 500; i++) {
        tx.writeFile(`/stress/file${i.toString().padStart(4, '0')}.txt`, `content ${i}`)
      }

      // Create parent directory
      storage.mkdir('/stress', { recursive: true })

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      // 500 files + root + /stress directory
      expect(storage.getFiles().size).toBe(500)
    })
  })

  describe('Cross-directory atomic operations', () => {
    it('should execute cross-directory writes atomically', async () => {
      const tx = new Transaction()
        .mkdir('/dir1', { recursive: true })
        .mkdir('/dir2', { recursive: true })
        .writeFile('/dir1/a.txt', 'a')
        .writeFile('/dir2/b.txt', 'b')
        .rename('/dir1/a.txt', '/dir2/a.txt')

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().has('/dir2/a.txt')).toBe(true)
      expect(storage.getFiles().has('/dir2/b.txt')).toBe(true)
      expect(storage.getFiles().has('/dir1/a.txt')).toBe(false)
    })

    it('should rollback cross-directory operations on failure', async () => {
      storage.injectFailure('rename', '/dir1/a.txt', new Error('Cross-directory rename failed'))

      const tx = new Transaction()
        .mkdir('/dir1', { recursive: true })
        .mkdir('/dir2', { recursive: true })
        .writeFile('/dir1/a.txt', 'a')
        .writeFile('/dir2/b.txt', 'b')
        .rename('/dir1/a.txt', '/dir2/a.txt')

      await expect(tx.execute(storage)).rejects.toThrow('Cross-directory rename failed')

      expect(tx.status).toBe('rolled_back')
      // All created files and directories should be cleaned up
      expect(storage.getFiles().has('/dir1/a.txt')).toBe(false)
      expect(storage.getFiles().has('/dir2/b.txt')).toBe(false)
    })

    it('should handle atomic swap across directories', async () => {
      // Pre-populate original files
      await storage.mkdir('/source', { recursive: true })
      await storage.mkdir('/dest', { recursive: true })
      await storage.writeFile('/source/config.json', new TextEncoder().encode('{"v": 1}'))
      await storage.writeFile('/dest/config.json', new TextEncoder().encode('{"v": 0}'))

      // Note: We use atomicLockSwap which uses wx flag for exclusive create + rename
      // This pattern works better with operation reordering since it doesn't have
      // an rm operation that could conflict after reordering
      const tx = Transaction.atomicLockSwap('/dest/config.json', new TextEncoder().encode('{"v": 2}'))

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      const content = storage.getFiles().get('/dest/config.json')
      expect(content).toBeDefined()
      expect(new TextDecoder().decode(content!)).toBe('{"v": 2}')
    })
  })

  describe('Concurrent transaction isolation', () => {
    it('should execute transactions serially without interference', async () => {
      const tx1 = new Transaction()
        .writeFile('/shared/file1.txt', 'from tx1')

      const tx2 = new Transaction()
        .writeFile('/shared/file2.txt', 'from tx2')

      await storage.mkdir('/shared', { recursive: true })

      // Execute serially
      await tx1.execute(storage)
      await tx2.execute(storage)

      expect(tx1.status).toBe('committed')
      expect(tx2.status).toBe('committed')
      expect(storage.getFiles().has('/shared/file1.txt')).toBe(true)
      expect(storage.getFiles().has('/shared/file2.txt')).toBe(true)
    })

    it('should maintain isolation when first transaction fails', async () => {
      await storage.mkdir('/shared', { recursive: true })

      storage.injectFailure('writeFile', '/shared/fail.txt', new Error('TX1 failed'))

      const tx1 = new Transaction()
        .writeFile('/shared/file1.txt', 'from tx1')
        .writeFile('/shared/fail.txt', 'will fail')

      const tx2 = new Transaction()
        .writeFile('/shared/file2.txt', 'from tx2')

      // TX1 should fail
      await expect(tx1.execute(storage)).rejects.toThrow('TX1 failed')
      expect(tx1.status).toBe('rolled_back')

      // TX2 should succeed independently
      await tx2.execute(storage)
      expect(tx2.status).toBe('committed')

      // Only TX2's file should exist
      expect(storage.getFiles().has('/shared/file1.txt')).toBe(false)
      expect(storage.getFiles().has('/shared/file2.txt')).toBe(true)
    })

    it('should handle concurrent writes to same file path', async () => {
      const tx1 = new Transaction()
        .writeFile('/config.json', '{"source": "tx1"}')

      const tx2 = new Transaction()
        .writeFile('/config.json', '{"source": "tx2"}')

      // Both succeed, last one wins
      await tx1.execute(storage)
      await tx2.execute(storage)

      const content = storage.getFiles().get('/config.json')
      expect(new TextDecoder().decode(content!)).toBe('{"source": "tx2"}')
    })
  })

  describe('Nested transaction support (savepoints)', () => {
    it('should support nested transactions via composition', async () => {
      // Create inner transaction
      const innerTx = new Transaction()
        .writeFile('/inner/a.txt', 'inner a')
        .writeFile('/inner/b.txt', 'inner b')

      // Create outer transaction with inner operations
      const outerTx = new Transaction()
        .mkdir('/inner', { recursive: true })
        .mkdir('/outer', { recursive: true })
        .writeFile('/outer/c.txt', 'outer c')

      // Merge inner into outer
      for (const op of innerTx.operations) {
        outerTx.operations.push(op)
      }

      await outerTx.execute(storage)

      expect(outerTx.status).toBe('committed')
      expect(storage.getFiles().has('/inner/a.txt')).toBe(true)
      expect(storage.getFiles().has('/inner/b.txt')).toBe(true)
      expect(storage.getFiles().has('/outer/c.txt')).toBe(true)
    })

    it('should rollback entire transaction including nested operations on failure', async () => {
      await storage.mkdir('/inner', { recursive: true })
      await storage.mkdir('/outer', { recursive: true })

      storage.injectFailure('writeFile', '/inner/b.txt', new Error('Nested operation failed'))

      const innerOps = [
        { type: 'write' as const, path: '/inner/a.txt', data: new TextEncoder().encode('inner a') },
        { type: 'write' as const, path: '/inner/b.txt', data: new TextEncoder().encode('inner b') },
      ]

      const tx = new Transaction()
        .writeFile('/outer/c.txt', 'outer c')

      // Add nested operations
      for (const op of innerOps) {
        tx.operations.push(op)
      }

      await expect(tx.execute(storage)).rejects.toThrow('Nested operation failed')

      expect(tx.status).toBe('rolled_back')
      // All operations including outer should be rolled back
      expect(storage.getFiles().has('/outer/c.txt')).toBe(false)
      expect(storage.getFiles().has('/inner/a.txt')).toBe(false)
      expect(storage.getFiles().has('/inner/b.txt')).toBe(false)
    })

    it('should support savepoint-style partial commits via separate transactions', async () => {
      await storage.mkdir('/savepoint', { recursive: true })

      // Savepoint 1 - commit first batch
      const sp1 = new Transaction()
        .writeFile('/savepoint/a.txt', 'a')
        .writeFile('/savepoint/b.txt', 'b')

      await sp1.execute(storage)
      expect(sp1.status).toBe('committed')

      // Savepoint 2 - fails and rolls back
      storage.injectFailure('writeFile', '/savepoint/d.txt', new Error('SP2 failed'))

      const sp2 = new Transaction()
        .writeFile('/savepoint/c.txt', 'c')
        .writeFile('/savepoint/d.txt', 'd')

      await expect(sp2.execute(storage)).rejects.toThrow('SP2 failed')
      expect(sp2.status).toBe('rolled_back')

      // Savepoint 1's files should still exist
      expect(storage.getFiles().has('/savepoint/a.txt')).toBe(true)
      expect(storage.getFiles().has('/savepoint/b.txt')).toBe(true)
      // Savepoint 2's files should not exist
      expect(storage.getFiles().has('/savepoint/c.txt')).toBe(false)
      expect(storage.getFiles().has('/savepoint/d.txt')).toBe(false)
    })
  })

  describe('Commit result details', () => {
    it('should track operation completion order', async () => {
      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')
        .writeFile('/c.txt', 'c')

      await tx.execute(storage)

      const log = storage.getOperationLog()
      const writeOps = log.filter(l => l.op === 'writeFile')

      expect(writeOps.length).toBe(3)
      // Verify order by timestamps
      expect(writeOps[0].timestamp).toBeLessThan(writeOps[1].timestamp)
      expect(writeOps[1].timestamp).toBeLessThan(writeOps[2].timestamp)
    })

    it('should provide rollback summary with timing information', async () => {
      storage.injectFailure('writeFile', '/fail.txt', new Error('Failed'))

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/fail.txt', 'fail')

      const startTime = Date.now()
      await expect(tx.execute(storage)).rejects.toThrow('Failed')
      const endTime = Date.now()

      expect(tx.lastRollbackSummary).toBeDefined()
      expect(tx.lastRollbackSummary!.durationMs).toBeGreaterThanOrEqual(0)
      expect(tx.lastRollbackSummary!.durationMs).toBeLessThanOrEqual(endTime - startTime + 100) // Allow some slack
    })
  })

  describe('Edge cases', () => {
    it('should handle empty transaction commit', async () => {
      const tx = new Transaction()

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getOperationLog().length).toBe(0)
    })

    it('should handle single operation transaction', async () => {
      const tx = new Transaction()
        .writeFile('/single.txt', 'only one')

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().has('/single.txt')).toBe(true)
    })

    it('should handle transaction with only mkdir operations', async () => {
      const tx = new Transaction()
        .mkdir('/a', { recursive: true })
        .mkdir('/b', { recursive: true })
        .mkdir('/c', { recursive: true })

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getDirectories().has('/a')).toBe(true)
      expect(storage.getDirectories().has('/b')).toBe(true)
      expect(storage.getDirectories().has('/c')).toBe(true)
    })

    it('should handle failure on first operation', async () => {
      storage.injectFailure('writeFile', '/first.txt', new Error('First op failed'))

      const tx = new Transaction()
        .writeFile('/first.txt', 'first')
        .writeFile('/second.txt', 'second')

      await expect(tx.execute(storage)).rejects.toThrow('First op failed')

      expect(tx.status).toBe('rolled_back')
      expect(storage.getFiles().size).toBe(0)
    })

    it('should handle failure on last operation', async () => {
      storage.injectFailure('writeFile', '/last.txt', new Error('Last op failed'))

      const tx = new Transaction()
        .writeFile('/first.txt', 'first')
        .writeFile('/second.txt', 'second')
        .writeFile('/last.txt', 'last')

      await expect(tx.execute(storage)).rejects.toThrow('Last op failed')

      expect(tx.status).toBe('rolled_back')
      expect(storage.getFiles().has('/first.txt')).toBe(false)
      expect(storage.getFiles().has('/second.txt')).toBe(false)
    })

    it('should handle Unicode content in atomic commits', async () => {
      const tx = new Transaction()
        .writeFile('/unicode1.txt', 'Hello \u4e16\u754c') // Chinese characters
        .writeFile('/unicode2.txt', '\ud83d\ude80 Rocket') // Emoji
        .writeFile('/unicode3.txt', '\u0645\u0631\u062d\u0628\u0627') // Arabic

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().has('/unicode1.txt')).toBe(true)
      expect(storage.getFiles().has('/unicode2.txt')).toBe(true)
      expect(storage.getFiles().has('/unicode3.txt')).toBe(true)
    })

    it('should handle binary data in atomic commits', async () => {
      const binaryData1 = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      const binaryData2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes

      const tx = new Transaction()
        .writeFile('/binary1.bin', binaryData1)
        .writeFile('/binary2.png', binaryData2)

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      expect(storage.getFiles().get('/binary1.bin')).toEqual(binaryData1)
      expect(storage.getFiles().get('/binary2.png')).toEqual(binaryData2)
    })
  })
})

// ============================================================================
// DATABASE-LEVEL TRANSACTION TESTS
// ============================================================================

describe('Database-Level Transaction Support', () => {
  describe('When storage supports beginTransaction', () => {
    it('should use database transaction when available', async () => {
      const { storage, getOperationLog } = createDbTransactionStorage()

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      const log = getOperationLog()

      // Should have BEGIN, operations, then COMMIT
      expect(log[0]).toMatch(/^BEGIN:/)
      expect(log).toContain('writeFile:/a.txt')
      expect(log).toContain('writeFile:/b.txt')
      expect(log[log.length - 1]).toBe('COMMIT')
    })

    it('should use database rollback on failure', async () => {
      const { storage, getOperationLog, getFiles } = createDbTransactionStorage()

      // Make second write fail
      ;(storage.writeFile as any)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Write failed'))

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')

      await expect(tx.execute(storage)).rejects.toThrow('Write failed')

      expect(tx.status).toBe('rolled_back')
      const log = getOperationLog()

      // Should have BEGIN, first write, then ROLLBACK
      expect(log[0]).toMatch(/^BEGIN:/)
      expect(log).toContain('ROLLBACK')

      // Files should not be committed due to rollback
      expect(getFiles().has('/a.txt')).toBe(false)
    })

    it('should commit changes only after successful database commit', async () => {
      const { storage, getFiles } = createDbTransactionStorage()

      const tx = new Transaction()
        .writeFile('/a.txt', 'content a')
        .writeFile('/b.txt', 'content b')

      await tx.execute(storage)

      expect(tx.status).toBe('committed')
      // Files should now be committed
      expect(getFiles().has('/a.txt')).toBe(true)
      expect(getFiles().has('/b.txt')).toBe(true)
    })

    it('should pass transaction ID to beginTransaction', async () => {
      const { storage } = createDbTransactionStorage()

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')

      await tx.execute(storage, { transactionId: 'my-custom-tx-id' })

      expect(storage.beginTransaction).toHaveBeenCalledWith('my-custom-tx-id')
    })

    it('should not start database transaction in dry run mode', async () => {
      const { storage, getOperationLog } = createDbTransactionStorage()

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')

      await tx.execute(storage, { dryRun: true })

      // Should not have started a database transaction
      const log = getOperationLog()
      expect(log.some(l => l.startsWith('BEGIN'))).toBe(false)
      expect(storage.beginTransaction).not.toHaveBeenCalled()
    })
  })

  describe('useDbTransaction option', () => {
    it('should skip database transaction when useDbTransaction is false', async () => {
      const { storage, getOperationLog } = createDbTransactionStorage()

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')

      await tx.execute(storage, { useDbTransaction: false })

      expect(tx.status).toBe('committed')
      // Should not have started a database transaction
      expect(storage.beginTransaction).not.toHaveBeenCalled()
      const log = getOperationLog()
      expect(log.some(l => l.startsWith('BEGIN'))).toBe(false)
    })

    it('should use application-level rollback when useDbTransaction is false', async () => {
      const rmCalls: string[] = []
      const storage: TransactionStorage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Failed')),
        rm: vi.fn().mockImplementation(async (path: string) => {
          rmCalls.push(path)
        }),
        beginTransaction: vi.fn(),
      }

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')

      await expect(tx.execute(storage, { useDbTransaction: false })).rejects.toThrow('Failed')

      // Should have used application-level rollback (rm)
      expect(rmCalls).toContain('/a.txt')
      // Should NOT have called beginTransaction
      expect(storage.beginTransaction).not.toHaveBeenCalled()
    })
  })

  describe('Fallback behavior', () => {
    it('should use application-level rollback when storage lacks beginTransaction', async () => {
      const rmCalls: string[] = []
      const storage: TransactionStorage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Failed')),
        rm: vi.fn().mockImplementation(async (path: string) => {
          rmCalls.push(path)
        }),
        // No beginTransaction method
      }

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')

      await expect(tx.execute(storage)).rejects.toThrow('Failed')

      expect(tx.status).toBe('rolled_back')
      // Should have used application-level rollback
      expect(rmCalls).toContain('/a.txt')
    })
  })
})

// ============================================================================
// PERFORMANCE OPTIMIZATION TESTS (REFACTOR PHASE)
// ============================================================================

describe('Performance Optimizations', () => {
  describe('Transaction timeout', () => {
    it('should timeout long-running transactions', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn().mockImplementation(async () => {
          // Simulate slow operation
          await new Promise(resolve => setTimeout(resolve, 100))
        }),
      }

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')
        .writeFile('/c.txt', 'c')

      await expect(tx.execute(storage, { timeoutMs: 50 })).rejects.toThrow(/timed out/)

      expect(tx.status).toBe('rolled_back')
    })

    it('should complete successfully within timeout', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')

      await tx.execute(storage, { timeoutMs: 1000 })

      expect(tx.status).toBe('committed')
    })

    it('should not apply timeout in dry run mode', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }

      const tx = new Transaction()
        .writeFile('/a.txt', 'a')

      // Very short timeout would normally fail, but dry run doesn't execute
      await tx.execute(storage, { dryRun: true, timeoutMs: 1 })

      expect(tx.status).toBe('pending')
    })
  })

  describe('Metrics reporting', () => {
    it('should report metrics on successful commit', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }

      let capturedMetrics: any = null
      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')

      await tx.execute(storage, {
        transactionId: 'metrics-test',
        onMetrics: (m) => { capturedMetrics = m }
      })

      expect(capturedMetrics).toBeDefined()
      expect(capturedMetrics.transactionId).toBe('metrics-test')
      expect(capturedMetrics.status).toBe('committed')
      expect(capturedMetrics.operationsExecuted).toBe(2)
      expect(capturedMetrics.totalDurationMs).toBeGreaterThanOrEqual(0)
      expect(capturedMetrics.operationDurationMs).toBeGreaterThanOrEqual(0)
      expect(capturedMetrics.rollbackDurationMs).toBeUndefined()
    })

    it('should report metrics on rollback', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Failed')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      let capturedMetrics: any = null
      const tx = new Transaction()
        .writeFile('/a.txt', 'a')
        .writeFile('/b.txt', 'b')

      await expect(
        tx.execute(storage, {
          transactionId: 'rollback-metrics',
          onMetrics: (m) => { capturedMetrics = m }
        })
      ).rejects.toThrow('Failed')

      expect(capturedMetrics).toBeDefined()
      expect(capturedMetrics.transactionId).toBe('rollback-metrics')
      expect(capturedMetrics.status).toBe('rolled_back')
      expect(capturedMetrics.operationsExecuted).toBe(1)
      expect(capturedMetrics.operationsRolledBack).toBe(1)
      expect(capturedMetrics.rollbackDurationMs).toBeGreaterThanOrEqual(0)
      expect(capturedMetrics.errorMessage).toBe('Failed')
    })

    it('should report usedDbTransaction correctly', async () => {
      const { storage } = createDbTransactionStorage()

      let capturedMetrics: any = null
      const tx = new Transaction()
        .writeFile('/a.txt', 'a')

      await tx.execute(storage, {
        onMetrics: (m) => { capturedMetrics = m }
      })

      expect(capturedMetrics.usedDbTransaction).toBe(true)
    })
  })

  describe('Content capture optimization', () => {
    it('should skip content capture when captureContent is false', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      const tx = new Transaction()
        .writeFile('/existing.txt', 'new content')

      await tx.execute(storage, { captureContent: false })

      // readFile should NOT be called for capturing previous content
      expect(storage.readFile).not.toHaveBeenCalled()
    })

    it('should capture content by default (captureContent: true)', async () => {
      const storage: TransactionStorage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      const tx = new Transaction()
        .writeFile('/existing.txt', 'new content')

      await tx.execute(storage)

      // readFile SHOULD be called for capturing previous content
      expect(storage.readFile).toHaveBeenCalledWith('/existing.txt')
    })

    it('should skip content capture when using database transaction', async () => {
      const { storage } = createDbTransactionStorage()

      // Add readFile tracking
      const readFileSpy = vi.fn()
      ;(storage as any).readFile = readFileSpy

      const tx = new Transaction()
        .writeFile('/existing.txt', 'new content')

      await tx.execute(storage)

      // readFile should NOT be called because DB transaction handles rollback
      expect(readFileSpy).not.toHaveBeenCalled()
    })
  })
})
