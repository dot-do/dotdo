/**
 * Transaction Execution Tests - TDD RED Phase
 *
 * These tests cover the execute() method of the Transaction class.
 * They verify that all queued operations are executed atomically
 * against a storage interface.
 *
 * @module core/transaction/execute.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Transaction, type TransactionStorage } from './transaction'

/**
 * Creates a mock storage interface for testing transaction execution.
 * Tracks all method calls for verification.
 */
function createMockStorage() {
  const calls: Array<{ method: string; args: unknown[] }> = []

  const storage: TransactionStorage = {
    writeFile: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
      calls.push({ method: 'writeFile', args: [path, data] })
    }),
    readFile: vi.fn().mockImplementation(async (path: string) => {
      calls.push({ method: 'readFile', args: [path] })
      return new Uint8Array([1, 2, 3])
    }),
    exists: vi.fn().mockImplementation(async (path: string) => {
      calls.push({ method: 'exists', args: [path] })
      return false
    }),
    unlink: vi.fn().mockImplementation(async (path: string) => {
      calls.push({ method: 'unlink', args: [path] })
    }),
    rm: vi.fn().mockImplementation(async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
      calls.push({ method: 'rm', args: [path, options] })
    }),
    rmdir: vi.fn().mockImplementation(async (path: string, options?: { recursive?: boolean }) => {
      calls.push({ method: 'rmdir', args: [path, options] })
    }),
    rename: vi.fn().mockImplementation(async (oldPath: string, newPath: string) => {
      calls.push({ method: 'rename', args: [oldPath, newPath] })
    }),
    mkdir: vi.fn().mockImplementation(async (path: string, options?: { recursive?: boolean; mode?: number }) => {
      calls.push({ method: 'mkdir', args: [path, options] })
    }),
  }

  return { storage, calls }
}

describe('Transaction Execution', () => {
  describe('Basic execution', () => {
    it('should execute an empty transaction successfully', async () => {
      const tx = new Transaction()
      const { storage } = createMockStorage()

      // Empty transaction should succeed without calling any storage methods
      await tx.execute(storage)

      expect(tx.status).toBe('committed')
    })

    it('should return a promise from execute', () => {
      const tx = new Transaction()
      const { storage } = createMockStorage()

      const result = tx.execute(storage)

      expect(result).toBeInstanceOf(Promise)
    })

    it('should resolve void on successful execution', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const { storage } = createMockStorage()

      const result = await tx.execute(storage)

      expect(result).toBeUndefined()
    })

    it('should require storage parameter', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // Calling execute without storage should throw
      await expect(tx.execute(undefined as unknown as TransactionStorage)).rejects.toThrow()
    })

    it('should require storage with writeFile method', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const invalidStorage = {} as TransactionStorage

      await expect(tx.execute(invalidStorage)).rejects.toThrow()
    })
  })

  describe('Operation execution order', () => {
    it('should execute all operations in order', async () => {
      const { storage, calls } = createMockStorage()
      const data = new Uint8Array([1, 2, 3])

      const tx = new Transaction()
        .mkdir('/dir')
        .writeFile('/dir/file.txt', data)
        .rename('/dir/file.txt', '/dir/renamed.txt')

      await tx.execute(storage)

      // Filter to just the main operation types (excluding exists/readFile checks)
      const mainOps = calls.filter(c => ['mkdir', 'writeFile', 'rename', 'unlink', 'rm', 'rmdir'].includes(c.method))

      // Verify operations executed in correct order
      expect(mainOps).toHaveLength(3)
      expect(mainOps[0].method).toBe('mkdir')
      expect(mainOps[0].args[0]).toBe('/dir')
      expect(mainOps[1].method).toBe('writeFile')
      expect(mainOps[1].args[0]).toBe('/dir/file.txt')
      expect(mainOps[2].method).toBe('rename')
      expect(mainOps[2].args[0]).toBe('/dir/file.txt')
      expect(mainOps[2].args[1]).toBe('/dir/renamed.txt')
    })

    it('should execute mkdir before write when queued in that order', async () => {
      const { storage, calls } = createMockStorage()
      const data = new Uint8Array([1, 2, 3])

      const tx = new Transaction()
        .mkdir('/nested/path', { recursive: true })
        .writeFile('/nested/path/file.txt', data)

      await tx.execute(storage)

      // Filter to just the main operation types
      const mainOps = calls.filter(c => ['mkdir', 'writeFile'].includes(c.method))

      expect(mainOps[0].method).toBe('mkdir')
      expect(mainOps[1].method).toBe('writeFile')
    })

    it('should execute write before unlink when queued in that order', async () => {
      const { storage, calls } = createMockStorage()
      const data = new Uint8Array([1, 2, 3])

      const tx = new Transaction()
        .writeFile('/new.txt', data)
        .unlink('/old.txt')

      await tx.execute(storage)

      expect(calls.filter(c => c.method === 'writeFile').length).toBe(1)
      expect(calls.filter(c => c.method === 'unlink').length).toBe(1)

      const writeIndex = calls.findIndex(c => c.method === 'writeFile')
      const unlinkIndex = calls.findIndex(c => c.method === 'unlink')
      expect(writeIndex).toBeLessThan(unlinkIndex)
    })

    it('should pass correct data to each write operation', async () => {
      const { storage, calls } = createMockStorage()
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])
      const data3 = new Uint8Array([7, 8, 9])

      const tx = new Transaction()
        .writeFile('/a.txt', data1)
        .writeFile('/b.txt', data2)
        .writeFile('/c.txt', data3)

      await tx.execute(storage)

      const writeCalls = calls.filter(c => c.method === 'writeFile')
      expect(writeCalls[0].args[1]).toBe(data1)
      expect(writeCalls[1].args[1]).toBe(data2)
      expect(writeCalls[2].args[1]).toBe(data3)
    })
  })

  describe('Transaction status', () => {
    it('should change status to committed on successful execution', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const { storage } = createMockStorage()

      expect(tx.status).toBe('pending')
      await tx.execute(storage)
      expect(tx.status).toBe('committed')
    })

    it('should change status to rolled_back on failed execution', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const storage: TransactionStorage = {
        writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      expect(tx.status).toBe('pending')

      await expect(tx.execute(storage)).rejects.toThrow('Write failed')
      expect(tx.status).toBe('rolled_back')
    })

    it('should not change status during dry run', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const { storage } = createMockStorage()

      expect(tx.status).toBe('pending')
      await tx.execute(storage, { dryRun: true })
      expect(tx.status).toBe('pending')
    })
  })

  describe('Double execution prevention', () => {
    it('should throw error when executing already committed transaction', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const { storage } = createMockStorage()

      await tx.execute(storage)
      expect(tx.status).toBe('committed')

      await expect(tx.execute(storage)).rejects.toThrow(/cannot.*committed/i)
    })

    it('should throw error when executing already rolled back transaction', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const storage: TransactionStorage = {
        writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      await expect(tx.execute(storage)).rejects.toThrow('Write failed')
      expect(tx.status).toBe('rolled_back')

      await expect(tx.execute(storage)).rejects.toThrow(/cannot.*rolled_back/i)
    })

    it('should throw descriptive error for double execute on committed', async () => {
      const tx = new Transaction()

      const { storage } = createMockStorage()

      await tx.execute(storage)

      try {
        await tx.execute(storage)
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).toMatch(/committed/i)
      }
    })

    it('should allow only one successful execution', async () => {
      const { storage, calls } = createMockStorage()
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // First execution
      await tx.execute(storage)
      const callsAfterFirst = calls.length

      // Second execution should throw
      try {
        await tx.execute(storage)
      } catch {
        // Expected
      }

      // Should not have executed additional operations
      expect(calls.length).toBe(callsAfterFirst)
    })
  })

  describe('Error handling', () => {
    it('should throw on first failure and stop execution', async () => {
      const { calls } = createMockStorage()
      const data = new Uint8Array([1, 2, 3])

      const storage: TransactionStorage = {
        mkdir: vi.fn().mockImplementation(async (path) => {
          calls.push({ method: 'mkdir', args: [path] })
        }),
        writeFile: vi.fn()
          .mockImplementationOnce(async (path, data) => {
            calls.push({ method: 'writeFile', args: [path, data] })
            throw new Error('First write failed')
          })
          .mockImplementation(async (path, data) => {
            calls.push({ method: 'writeFile', args: [path, data] })
          }),
        rm: vi.fn().mockResolvedValue(undefined),
        rmdir: vi.fn().mockResolvedValue(undefined),
      }

      const tx = new Transaction()
        .mkdir('/dir')
        .writeFile('/dir/a.txt', data)
        .writeFile('/dir/b.txt', data)
        .writeFile('/dir/c.txt', data)

      await expect(tx.execute(storage)).rejects.toThrow('First write failed')

      // Should have executed mkdir and first write, then stopped
      const writeCount = calls.filter(c => c.method === 'writeFile').length
      expect(writeCount).toBe(1) // Only the first (failing) write
    })

    it('should propagate the original error message', async () => {
      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const storage: TransactionStorage = {
        writeFile: vi.fn().mockRejectedValue(new Error('Disk full')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      await expect(tx.execute(storage)).rejects.toThrow('Disk full')
    })

    it('should propagate error type', async () => {
      class CustomError extends Error {
        code = 'ENOSPC'
      }

      const tx = new Transaction()
        .writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      const storage: TransactionStorage = {
        writeFile: vi.fn().mockRejectedValue(new CustomError('No space left')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      try {
        await tx.execute(storage)
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CustomError)
        expect((error as CustomError).code).toBe('ENOSPC')
      }
    })
  })

  describe('Atomicity', () => {
    it('should rollback all completed operations on failure', async () => {
      const completedOps: string[] = []
      const deletedPaths: string[] = []

      const storage: TransactionStorage = {
        mkdir: vi.fn().mockImplementation(async (path) => {
          completedOps.push(`mkdir:${path}`)
        }),
        writeFile: vi.fn()
          .mockImplementationOnce(async (path) => {
            completedOps.push(`write:${path}`)
          })
          .mockRejectedValueOnce(new Error('Second write failed')),
        rm: vi.fn().mockImplementation(async (path) => {
          deletedPaths.push(path)
        }),
        rmdir: vi.fn().mockImplementation(async (path) => {
          deletedPaths.push(path)
        }),
      }

      const tx = new Transaction()
        .mkdir('/dir')
        .writeFile('/dir/a.txt', new Uint8Array([1]))
        .writeFile('/dir/b.txt', new Uint8Array([2]))

      await expect(tx.execute(storage)).rejects.toThrow('Second write failed')

      // Both mkdir and first write should have been rolled back
      expect(deletedPaths).toContain('/dir/a.txt')
      expect(deletedPaths).toContain('/dir')
    })

    it('should attempt rollback of all successful operations even if some rollbacks fail', async () => {
      const rollbackAttempts: string[] = []

      const storage: TransactionStorage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Third write failed')),
        rm: vi.fn().mockImplementation(async (path) => {
          rollbackAttempts.push(path)
          if (path === '/b.txt') {
            throw new Error('Rollback failed for b.txt')
          }
        }),
      }

      const tx = new Transaction()
        .writeFile('/a.txt', new Uint8Array([1]))
        .writeFile('/b.txt', new Uint8Array([2]))
        .writeFile('/c.txt', new Uint8Array([3]))

      // When rollback also fails, an AggregateError is thrown containing both
      // the original error and rollback errors
      await expect(tx.execute(storage)).rejects.toThrow('Transaction failed and rollback also failed')

      // Should have attempted to rollback both a.txt and b.txt
      expect(rollbackAttempts).toContain('/a.txt')
      expect(rollbackAttempts).toContain('/b.txt')
    })

    it('should rollback operations in reverse order', async () => {
      const rollbackOrder: string[] = []

      const storage: TransactionStorage = {
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Failed')),
        rm: vi.fn().mockImplementation(async (path) => {
          rollbackOrder.push(path)
        }),
        rmdir: vi.fn().mockImplementation(async (path) => {
          rollbackOrder.push(path)
        }),
      }

      const tx = new Transaction()
        .mkdir('/dir')
        .writeFile('/dir/a.txt', new Uint8Array([1]))
        .writeFile('/dir/b.txt', new Uint8Array([2]))
        .writeFile('/dir/c.txt', new Uint8Array([3]))

      await expect(tx.execute(storage)).rejects.toThrow('Failed')

      // b.txt should be rolled back before a.txt, which should be before dir
      const bIndex = rollbackOrder.indexOf('/dir/b.txt')
      const aIndex = rollbackOrder.indexOf('/dir/a.txt')
      const dirIndex = rollbackOrder.indexOf('/dir')

      expect(bIndex).toBeLessThan(aIndex)
      expect(aIndex).toBeLessThan(dirIndex)
    })
  })

  describe('All operation types', () => {
    it('should execute all queued operation types', async () => {
      const { storage, calls } = createMockStorage()
      const data = new Uint8Array([1, 2, 3])

      const tx = new Transaction()
        .mkdir('/dir')
        .writeFile('/dir/file.txt', data)
        .rename('/dir/file.txt', '/dir/renamed.txt')
        .unlink('/old-file.txt')
        .rm('/temp', { recursive: true })
        .rmdir('/empty-dir')

      await tx.execute(storage)

      // Extract just method names
      const methods = calls.map(c => c.method)
      expect(methods).toContain('mkdir')
      expect(methods).toContain('writeFile')
      expect(methods).toContain('rename')
      expect(methods).toContain('unlink')
      expect(methods).toContain('rm')
      expect(methods).toContain('rmdir')
    })

    it('should pass options to mkdir', async () => {
      const { storage, calls } = createMockStorage()

      const tx = new Transaction()
        .mkdir('/nested/path', { recursive: true, mode: 0o755 })

      await tx.execute(storage)

      const mkdirCall = calls.find(c => c.method === 'mkdir')
      expect(mkdirCall?.args[0]).toBe('/nested/path')
      expect(mkdirCall?.args[1]).toEqual({ recursive: true, mode: 0o755 })
    })

    it('should pass options to rm', async () => {
      const { storage, calls } = createMockStorage()

      const tx = new Transaction()
        .rm('/dir', { force: true, recursive: true })

      await tx.execute(storage)

      const rmCall = calls.find(c => c.method === 'rm')
      expect(rmCall?.args[0]).toBe('/dir')
      expect(rmCall?.args[1]).toEqual({ force: true, recursive: true })
    })

    it('should pass options to rmdir', async () => {
      const { storage, calls } = createMockStorage()

      const tx = new Transaction()
        .rmdir('/dir', { recursive: true })

      await tx.execute(storage)

      const rmdirCall = calls.find(c => c.method === 'rmdir')
      expect(rmdirCall?.args[0]).toBe('/dir')
      expect(rmdirCall?.args[1]).toEqual({ recursive: true })
    })
  })
})
