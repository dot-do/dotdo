import { describe, it, expect, beforeEach } from 'vitest'
import { Transaction } from './transaction'

describe('Transaction Builder', () => {
  describe('Transaction creation', () => {
    it('should create a new Transaction instance', () => {
      const tx = new Transaction()
      expect(tx).toBeInstanceOf(Transaction)
    })

    it('should start with empty operation queue', () => {
      const tx = new Transaction()
      expect(tx.operations).toEqual([])
      expect(tx.operations).toHaveLength(0)
    })

    it('should have pending status until executed', () => {
      const tx = new Transaction()
      expect(tx.status).toBe('pending')
    })
  })

  describe('Operation queuing', () => {
    let tx: Transaction

    beforeEach(() => {
      tx = new Transaction()
    })

    it('should queue a write operation', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/test.txt', data)

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'write',
        path: '/test.txt',
        data
      })
    })

    it('should queue a delete operation', () => {
      tx.deleteFile('/test.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'unlink',
        path: '/test.txt'
      })
    })

    it('should queue a rename operation', () => {
      tx.rename('/old.txt', '/new.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'rename',
        oldPath: '/old.txt',
        newPath: '/new.txt'
      })
    })

    it('should queue a move operation (alias for rename)', () => {
      tx.move('/source.txt', '/dest.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'rename',
        oldPath: '/source.txt',
        newPath: '/dest.txt'
      })
    })

    it('should queue a mkdir operation', () => {
      tx.mkdir('/newdir')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'mkdir',
        path: '/newdir'
      })
    })

    it('should store operations in order', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      tx.writeFile('/a.txt', data1)
      tx.mkdir('/dir')
      tx.writeFile('/b.txt', data2)
      tx.deleteFile('/c.txt')
      tx.rename('/old.txt', '/new.txt')

      expect(tx.operations).toHaveLength(5)
      expect(tx.operations[0].type).toBe('write')
      expect(tx.operations[1].type).toBe('mkdir')
      expect(tx.operations[2].type).toBe('write')
      expect(tx.operations[3].type).toBe('unlink')
      expect(tx.operations[4].type).toBe('rename')
    })
  })

  describe('Chainable API', () => {
    it('should return transaction instance from writeFile', () => {
      const tx = new Transaction()
      const result = tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should return transaction instance from deleteFile', () => {
      const tx = new Transaction()
      const result = tx.deleteFile('/test.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should return transaction instance from rename', () => {
      const tx = new Transaction()
      const result = tx.rename('/old.txt', '/new.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should return transaction instance from move', () => {
      const tx = new Transaction()
      const result = tx.move('/source.txt', '/dest.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should return transaction instance from mkdir', () => {
      const tx = new Transaction()
      const result = tx.mkdir('/dir')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should support method chaining', () => {
      const tx = new Transaction()
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      const result = tx
        .writeFile('/a.txt', data1)
        .mkdir('/dir')
        .writeFile('/b.txt', data2)
        .deleteFile('/c.txt')
        .rename('/old.txt', '/new.txt')

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(5)
    })

    it('should support method chaining with move', () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      const result = tx
        .mkdir('/dest')
        .writeFile('/source/file.txt', data)
        .move('/source/file.txt', '/dest/file.txt')

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('mkdir')
      expect(tx.operations[1].type).toBe('write')
      expect(tx.operations[2].type).toBe('rename')
    })

    it('should allow inline transaction creation and chaining', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      const tx = new Transaction()
        .writeFile('/a.txt', data1)
        .writeFile('/b.txt', data2)
        .deleteFile('/c.txt')

      expect(tx).toBeInstanceOf(Transaction)
      expect(tx.operations).toHaveLength(3)
    })
  })

  describe('Transaction state', () => {
    it('should start with pending status', () => {
      const tx = new Transaction()
      expect(tx.status).toBe('pending')
    })

    it('should not allow operations after execution (committed)', () => {
      const tx = new Transaction()

      // Manually set status to committed to test state check
      // This will be properly tested in the execute tests
      Object.defineProperty(tx, 'status', { value: 'committed', writable: false })

      expect(() => {
        tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow operations after rollback', () => {
      const tx = new Transaction()

      // Manually set status to rolled_back to test state check
      Object.defineProperty(tx, 'status', { value: 'rolled_back', writable: false })

      expect(() => {
        tx.deleteFile('/test.txt')
      }).toThrow(/cannot add operations/i)
    })
  })

  describe('Operation types', () => {
    it('should store correct operation type for writeFile', () => {
      const tx = new Transaction()
      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      expect(tx.operations[0]).toHaveProperty('type', 'write')
      expect(tx.operations[0]).toHaveProperty('path')
      expect(tx.operations[0]).toHaveProperty('data')
    })

    it('should store correct operation type for deleteFile', () => {
      const tx = new Transaction()
      tx.deleteFile('/test.txt')

      expect(tx.operations[0]).toHaveProperty('type', 'unlink')
      expect(tx.operations[0]).toHaveProperty('path')
    })

    it('should store correct operation type for rename', () => {
      const tx = new Transaction()
      tx.rename('/old.txt', '/new.txt')

      expect(tx.operations[0]).toHaveProperty('type', 'rename')
      expect(tx.operations[0]).toHaveProperty('oldPath')
      expect(tx.operations[0]).toHaveProperty('newPath')
    })

    it('should store correct operation type for mkdir', () => {
      const tx = new Transaction()
      tx.mkdir('/dir')

      expect(tx.operations[0]).toHaveProperty('type', 'mkdir')
      expect(tx.operations[0]).toHaveProperty('path')
    })
  })

  describe('Data integrity', () => {
    it('should preserve exact data bytes in write operations', () => {
      const tx = new Transaction()
      const data = new Uint8Array([0, 1, 2, 255, 254, 253])

      tx.writeFile('/test.txt', data)

      const storedOp = tx.operations[0] as any
      expect(storedOp.data).toBe(data) // Same reference
      expect(storedOp.data).toEqual(data) // Same content
    })

    it('should preserve path strings exactly', () => {
      const tx = new Transaction()
      const path = '/some/deep/path/file.txt'

      tx.writeFile(path, new Uint8Array([1]))

      expect(tx.operations[0]).toHaveProperty('path', path)
    })

    it('should handle multiple operations with same path', () => {
      const tx = new Transaction()
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      tx.writeFile('/test.txt', data1)
      tx.writeFile('/test.txt', data2)

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as any).data).toBe(data1)
      expect((tx.operations[1] as any).data).toBe(data2)
    })
  })

  describe('Mkdir options', () => {
    it('should queue mkdir without options', () => {
      const tx = new Transaction()
      tx.mkdir('/newdir')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'mkdir',
        path: '/newdir'
      })
      expect((tx.operations[0] as any).options).toBeUndefined()
    })

    it('should queue mkdir with recursive option', () => {
      const tx = new Transaction()
      tx.mkdir('/a/b/c', { recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('mkdir')
      expect(op.path).toBe('/a/b/c')
      expect(op.options).toBeDefined()
      expect(op.options.recursive).toBe(true)
    })

    it('should queue mkdir with mode option', () => {
      const tx = new Transaction()
      tx.mkdir('/restricted', { mode: 0o700 })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('mkdir')
      expect(op.path).toBe('/restricted')
      expect(op.options).toBeDefined()
      expect(op.options.mode).toBe(0o700)
    })

    it('should queue mkdir with both recursive and mode options', () => {
      const tx = new Transaction()
      tx.mkdir('/nested/dir', { recursive: true, mode: 0o755 })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('mkdir')
      expect(op.path).toBe('/nested/dir')
      expect(op.options.recursive).toBe(true)
      expect(op.options.mode).toBe(0o755)
    })

    it('should queue multiple mkdir operations with different options', () => {
      const tx = new Transaction()
      tx.mkdir('/dir1')
      tx.mkdir('/dir2', { recursive: true })
      tx.mkdir('/dir3', { mode: 0o700 })

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as any).options).toBeUndefined()
      expect((tx.operations[1] as any).options.recursive).toBe(true)
      expect((tx.operations[2] as any).options.mode).toBe(0o700)
    })

    it('should support method chaining with mkdir options', () => {
      const tx = new Transaction()
      const result = tx
        .mkdir('/a', { recursive: true })
        .mkdir('/b', { mode: 0o700 })
        .mkdir('/c')

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
    })

    it('should not add options property when options is undefined', () => {
      const tx = new Transaction()
      tx.mkdir('/dir', undefined)

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0]
      expect('options' in op).toBe(false)
    })

    it('should not add options property when options is empty object', () => {
      const tx = new Transaction()
      tx.mkdir('/dir', {})

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0]
      // Empty object should not be stored
      expect('options' in op).toBe(false)
    })
  })

  describe('Delete operations (unlink)', () => {
    it('should queue an unlink operation', () => {
      const tx = new Transaction()
      tx.unlink('/file.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'unlink',
        path: '/file.txt'
      })
    })

    it('should return transaction instance for chaining', () => {
      const tx = new Transaction()
      const result = tx.unlink('/file.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should support multiple unlink operations', () => {
      const tx = new Transaction()
      tx.unlink('/a.txt')
        .unlink('/b.txt')
        .unlink('/c.txt')

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations.every(op => op.type === 'unlink')).toBe(true)
    })
  })

  describe('Delete operations (rm)', () => {
    it('should queue an rm operation without options', () => {
      const tx = new Transaction()
      tx.rm('/file.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'rm',
        path: '/file.txt'
      })
      expect('options' in tx.operations[0]).toBe(false)
    })

    it('should queue rm with force option', () => {
      const tx = new Transaction()
      tx.rm('/maybe-exists.txt', { force: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rm')
      expect(op.path).toBe('/maybe-exists.txt')
      expect(op.options).toBeDefined()
      expect(op.options.force).toBe(true)
    })

    it('should queue rm with recursive option', () => {
      const tx = new Transaction()
      tx.rm('/mydir', { recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rm')
      expect(op.path).toBe('/mydir')
      expect(op.options).toBeDefined()
      expect(op.options.recursive).toBe(true)
    })

    it('should queue rm with both force and recursive options (rm -rf)', () => {
      const tx = new Transaction()
      tx.rm('/dir', { force: true, recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rm')
      expect(op.path).toBe('/dir')
      expect(op.options.force).toBe(true)
      expect(op.options.recursive).toBe(true)
    })

    it('should return transaction instance for chaining', () => {
      const tx = new Transaction()
      const result = tx.rm('/file.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should support chaining with options', () => {
      const tx = new Transaction()
      const result = tx
        .rm('/a.txt', { force: true })
        .rm('/b', { recursive: true })
        .rm('/c', { force: true, recursive: true })

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
    })

    it('should not include options property when undefined', () => {
      const tx = new Transaction()
      tx.rm('/file.txt', undefined)

      expect(tx.operations).toHaveLength(1)
      expect('options' in tx.operations[0]).toBe(false)
    })

    it('should not mutate original options object', () => {
      const tx = new Transaction()
      const options = { force: true, recursive: true }
      tx.rm('/file.txt', options)

      // Modify original options after queueing
      options.force = false

      const op = tx.operations[0] as any
      expect(op.options.force).toBe(true) // Should still be true
    })
  })

  describe('Delete operations (rmdir)', () => {
    it('should queue an rmdir operation without options', () => {
      const tx = new Transaction()
      tx.rmdir('/empty-dir')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'rmdir',
        path: '/empty-dir'
      })
      expect('options' in tx.operations[0]).toBe(false)
    })

    it('should queue rmdir with recursive option', () => {
      const tx = new Transaction()
      tx.rmdir('/non-empty-dir', { recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rmdir')
      expect(op.path).toBe('/non-empty-dir')
      expect(op.options).toBeDefined()
      expect(op.options.recursive).toBe(true)
    })

    it('should return transaction instance for chaining', () => {
      const tx = new Transaction()
      const result = tx.rmdir('/dir')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should support chaining rmdir operations', () => {
      const tx = new Transaction()
      const result = tx
        .rmdir('/empty1')
        .rmdir('/empty2')
        .rmdir('/non-empty', { recursive: true })

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
    })

    it('should not include options property when undefined', () => {
      const tx = new Transaction()
      tx.rmdir('/dir', undefined)

      expect(tx.operations).toHaveLength(1)
      expect('options' in tx.operations[0]).toBe(false)
    })

    it('should not mutate original options object', () => {
      const tx = new Transaction()
      const options = { recursive: true }
      tx.rmdir('/dir', options)

      // Modify original options after queueing
      options.recursive = false

      const op = tx.operations[0] as any
      expect(op.options.recursive).toBe(true) // Should still be true
    })
  })

  describe('Delete operations - combined workflows', () => {
    it('should support cleanup workflow (rm multiple files, then rmdir)', () => {
      const tx = new Transaction()
      tx.rm('/dir/file1.txt')
        .rm('/dir/file2.txt')
        .rmdir('/dir')

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('rm')
      expect(tx.operations[1].type).toBe('rm')
      expect(tx.operations[2].type).toBe('rmdir')
    })

    it('should support force cleanup (ignore missing files)', () => {
      const tx = new Transaction()
      tx.rm('/maybe1.txt', { force: true })
        .rm('/maybe2.txt', { force: true })
        .rmdir('/maybe-dir', { recursive: true })

      expect(tx.operations).toHaveLength(3)
      const op0 = tx.operations[0] as any
      const op1 = tx.operations[1] as any
      expect(op0.options.force).toBe(true)
      expect(op1.options.force).toBe(true)
    })

    it('should support mixed operations (write, then delete old)', () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/new-file.txt', data)
        .unlink('/old-file.txt')

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('write')
      expect(tx.operations[1].type).toBe('unlink')
    })

    it('should support atomic swap (write temp, delete old, rename temp)', () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/file.tmp', data)
        .rm('/file.txt', { force: true })
        .rename('/file.tmp', '/file.txt')

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('write')
      expect(tx.operations[1].type).toBe('rm')
      expect(tx.operations[2].type).toBe('rename')
    })
  })

  describe('Execute with options', () => {
    it('should accept execute options', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/test.txt', data)

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }

      await tx.execute(storage, {
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        transactionId: 'test-tx-123'
      })

      expect(tx.status).toBe('committed')
      expect(storage.writeFile).toHaveBeenCalledWith('/test.txt', data)
    })

    it('should support dry run mode', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/test.txt', data)

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }

      const infoLogs: string[] = []
      await tx.execute(storage, {
        dryRun: true,
        logger: {
          debug: vi.fn(),
          info: (msg: string) => infoLogs.push(msg),
          warn: vi.fn(),
          error: vi.fn(),
        },
      })

      // In dry run, status should remain pending
      expect(tx.status).toBe('pending')
      // Storage should not be called
      expect(storage.writeFile).not.toHaveBeenCalled()
      // Should log dry run message
      expect(infoLogs.some(msg => msg.includes('DRY RUN'))).toBe(true)
    })

    it('should use provided transaction ID in logs', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/test.txt', data)

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }

      const infoLogs: string[] = []
      await tx.execute(storage, {
        transactionId: 'my-custom-tx-id',
        logger: {
          debug: vi.fn(),
          info: (msg: string) => infoLogs.push(msg),
          warn: vi.fn(),
          error: vi.fn(),
        },
      })

      expect(infoLogs.some(msg => msg.includes('my-custom-tx-id'))).toBe(true)
    })
  })

  describe('Rollback error aggregation', () => {
    it('should preserve original error when rollback succeeds', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)

      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Write failed')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      // Original error should be preserved
      expect(caughtError).toBeDefined()
      expect(caughtError?.message).toBe('Write failed')
      // Should NOT be an AggregateError when rollback succeeds
      expect(caughtError).not.toBeInstanceOf(AggregateError)
    })

    it('should throw AggregateError when rollback fails', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)

      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Write failed')),
        rm: vi.fn().mockRejectedValue(new Error('Delete failed')),
      }

      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      // Should be an AggregateError containing both errors
      expect(caughtError).toBeInstanceOf(AggregateError)
      const aggregateError = caughtError as AggregateError
      expect(aggregateError.errors.length).toBe(2)

      // First error should be the original
      expect(aggregateError.errors[0]).toBeInstanceOf(Error)
      expect((aggregateError.errors[0] as Error).message).toBe('Write failed')

      // Second error should be from rollback
      expect(aggregateError.errors[1]).toBeInstanceOf(Error)
      expect((aggregateError.errors[1] as Error).message).toContain('Delete failed')
    })

    it('should collect all rollback errors into AggregateError', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)
        .writeFile('/c.txt', data)

      let writeCount = 0
      const storage = {
        writeFile: vi.fn().mockImplementation(async () => {
          writeCount++
          if (writeCount === 3) {
            throw new Error('Third write failed')
          }
        }),
        rm: vi.fn()
          .mockRejectedValueOnce(new Error('First delete failed'))
          .mockRejectedValueOnce(new Error('Second delete failed')),
      }

      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      // Should be an AggregateError containing original + all rollback errors
      expect(caughtError).toBeInstanceOf(AggregateError)
      const aggregateError = caughtError as AggregateError

      // Original error + 2 rollback errors = 3 total
      expect(aggregateError.errors.length).toBe(3)
      expect((aggregateError.errors[0] as Error).message).toBe('Third write failed')
      expect((aggregateError.errors[1] as Error).message).toContain('First delete failed')
      expect((aggregateError.errors[2] as Error).message).toContain('Second delete failed')
    })

    it('should include descriptive message in AggregateError', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)

      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Write failed')),
        rm: vi.fn().mockRejectedValue(new Error('Delete failed')),
      }

      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      expect(caughtError).toBeInstanceOf(AggregateError)
      const aggregateError = caughtError as AggregateError

      // Message should indicate both transaction failure and rollback failure
      expect(aggregateError.message).toMatch(/transaction.*failed.*rollback/i)
    })

    it('should include rollback errors with operation context', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/path/to/file.txt', data)
        .writeFile('/another/file.txt', data)

      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Original error')),
        rm: vi.fn().mockRejectedValue(new Error('Rollback error')),
      }

      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      expect(caughtError).toBeInstanceOf(AggregateError)
      const aggregateError = caughtError as AggregateError

      // Rollback errors should include path context
      const rollbackError = aggregateError.errors[1] as Error
      expect(rollbackError.message).toContain('/path/to/file.txt')
    })
  })

  describe('Rollback functionality', () => {
    it('should rollback writes on failure', async () => {
      const tx = new Transaction()
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      tx.writeFile('/a.txt', data1)
        .writeFile('/b.txt', data2)

      const deletedFiles: string[] = []
      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Write failed')),
        rm: vi.fn().mockImplementation(async (path: string) => {
          deletedFiles.push(path)
        }),
      }

      await expect(tx.execute(storage)).rejects.toThrow('Write failed')
      expect(tx.status).toBe('rolled_back')
      expect(deletedFiles).toContain('/a.txt')
    })

    it('should restore previous content on rollback when readFile is available', async () => {
      const tx = new Transaction()
      const originalContent = new Uint8Array([1, 2, 3])
      const newContent = new Uint8Array([4, 5, 6])

      tx.writeFile('/existing.txt', newContent)

      const writtenFiles: Map<string, Uint8Array> = new Map()
      const storage = {
        exists: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue(originalContent),
        writeFile: vi.fn()
          .mockImplementationOnce(async (path: string, data: Uint8Array) => {
            writtenFiles.set(path, data)
          })
          .mockRejectedValueOnce(new Error('Subsequent op failed'))
          .mockImplementation(async (path: string, data: Uint8Array) => {
            writtenFiles.set(path, data)
          }),
      }

      // Add a second operation to fail
      tx.writeFile('/b.txt', new Uint8Array([7, 8, 9]))

      await expect(tx.execute(storage)).rejects.toThrow('Subsequent op failed')

      // Should have captured and restored original content
      expect(storage.readFile).toHaveBeenCalledWith('/existing.txt')
      // Last write to /existing.txt should be the original content (restored)
      expect(writtenFiles.get('/existing.txt')).toEqual(originalContent)
    })

    it('should capture content before delete operations', async () => {
      const tx = new Transaction()
      const fileContent = new Uint8Array([1, 2, 3])

      // With optimal ordering: write executes before unlink
      // So we write first, then unlink, then have unlink fail
      tx.writeFile('/b.txt', new Uint8Array([4, 5, 6]))
        .unlink('/file.txt')

      let restoredContent: Uint8Array | undefined
      const storage = {
        readFile: vi.fn().mockResolvedValue(fileContent),
        // Unlink fails after capturing content
        unlink: vi.fn().mockRejectedValue(new Error('Unlink failed')),
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined) // First write succeeds
          .mockImplementation(async (path: string, data: Uint8Array) => {
            if (path === '/file.txt') {
              restoredContent = data
            }
          }),
        rm: vi.fn().mockResolvedValue(undefined), // For rollback of write
      }

      await expect(tx.execute(storage)).rejects.toThrow('Unlink failed')

      // Should have captured content before unlink attempt (for potential restore)
      expect(storage.readFile).toHaveBeenCalledWith('/file.txt')
    })

    it('should reverse rename operations on rollback', async () => {
      const tx = new Transaction()

      // With optimal ordering: write executes before rename
      // So write succeeds, then rename succeeds, then we need something after rename to fail
      // Add an rm operation that will fail (rm executes after rename in optimal order)
      tx.writeFile('/success.txt', new Uint8Array([1, 2, 3]))
        .rename('/old.txt', '/new.txt')
        .rm('/fail.txt')

      const renames: Array<{from: string, to: string}> = []
      const storage = {
        rename: vi.fn().mockImplementation(async (from: string, to: string) => {
          renames.push({ from, to })
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockRejectedValue(new Error('Rm failed')),
      }

      // When rollback also fails (because reverse rename fails), we get AggregateError
      // When rollback succeeds, we get the original error
      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      expect(caughtError).toBeDefined()
      // Original error should be accessible (either directly or in AggregateError)
      if (caughtError instanceof AggregateError) {
        expect((caughtError.errors[0] as Error).message).toBe('Rm failed')
      } else {
        expect(caughtError!.message).toBe('Rm failed')
      }

      // Should have renamed and then reversed
      expect(renames).toHaveLength(2)
      expect(renames[0]).toEqual({ from: '/old.txt', to: '/new.txt' })
      expect(renames[1]).toEqual({ from: '/new.txt', to: '/old.txt' })
    })

    it('should remove created directories on rollback', async () => {
      const tx = new Transaction()

      tx.mkdir('/new-dir')
        .writeFile('/fail.txt', new Uint8Array([1, 2, 3]))

      const removedDirs: string[] = []
      const storage = {
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
        rmdir: vi.fn().mockImplementation(async (path: string) => {
          removedDirs.push(path)
        }),
      }

      await expect(tx.execute(storage)).rejects.toThrow('Write failed')

      // Should have removed the created directory
      expect(removedDirs).toContain('/new-dir')
    })

    it('should populate lastRollbackSummary on failure', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)

      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Write failed')),
        rm: vi.fn().mockResolvedValue(undefined),
      }

      await expect(tx.execute(storage, { transactionId: 'test-rollback' })).rejects.toThrow('Write failed')

      expect(tx.lastRollbackSummary).toBeDefined()
      expect(tx.lastRollbackSummary!.transactionId).toBe('test-rollback')
      expect(tx.lastRollbackSummary!.totalOperations).toBe(1)
      expect(tx.lastRollbackSummary!.successCount).toBe(1)
      expect(tx.lastRollbackSummary!.failureCount).toBe(0)
      expect(tx.lastRollbackSummary!.results).toHaveLength(1)
      expect(tx.lastRollbackSummary!.results[0].success).toBe(true)
    })

    it('should track rollback failures in summary', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)

      const storage = {
        writeFile: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Write failed')),
        rm: vi.fn().mockRejectedValue(new Error('Delete failed')),
      }

      // When rollback fails, we get AggregateError with original + rollback errors
      let caughtError: Error | undefined
      try {
        await tx.execute(storage)
      } catch (error) {
        caughtError = error as Error
      }

      expect(caughtError).toBeDefined()
      expect(caughtError).toBeInstanceOf(AggregateError)
      const aggregateError = caughtError as AggregateError
      // First error in aggregate is the original
      expect((aggregateError.errors[0] as Error).message).toBe('Write failed')

      expect(tx.lastRollbackSummary).toBeDefined()
      expect(tx.lastRollbackSummary!.failureCount).toBe(1)
      expect(tx.lastRollbackSummary!.results[0].success).toBe(false)
      expect(tx.lastRollbackSummary!.results[0].error).toBe('Delete failed')
    })
  })

  describe('Type-safe operation accessors', () => {
    it('should return correct size', () => {
      const tx = new Transaction()
      expect(tx.size).toBe(0)

      tx.writeFile('/a.txt', new Uint8Array([1, 2, 3]))
      expect(tx.size).toBe(1)

      tx.mkdir('/dir')
      expect(tx.size).toBe(2)
    })

    it('should detect empty transactions', () => {
      const tx = new Transaction()
      expect(tx.isEmpty).toBe(true)

      tx.writeFile('/a.txt', new Uint8Array([1, 2, 3]))
      expect(tx.isEmpty).toBe(false)
    })

    it('should have correct status predicates', () => {
      const tx = new Transaction()
      expect(tx.isPending).toBe(true)
      expect(tx.isCommitted).toBe(false)
      expect(tx.isRolledBack).toBe(false)
    })

    it('should filter operations by type', () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)
        .mkdir('/dir')
        .rename('/old.txt', '/new.txt')

      const writes = tx.getOperationsByType('write')
      expect(writes).toHaveLength(2)
      expect(writes[0].path).toBe('/a.txt')
      expect(writes[0].data).toBe(data)

      const mkdirs = tx.getOperationsByType('mkdir')
      expect(mkdirs).toHaveLength(1)
      expect(mkdirs[0].path).toBe('/dir')

      const renames = tx.getOperationsByType('rename')
      expect(renames).toHaveLength(1)
      expect(renames[0].oldPath).toBe('/old.txt')
      expect(renames[0].newPath).toBe('/new.txt')
    })

    it('should check for operation types', () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .mkdir('/dir')

      expect(tx.hasOperationType('write')).toBe(true)
      expect(tx.hasOperationType('mkdir')).toBe(true)
      expect(tx.hasOperationType('rename')).toBe(false)
      expect(tx.hasOperationType('unlink')).toBe(false)
    })

    it('should collect affected paths', () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .rename('/b.txt', '/c.txt')
        .mkdir('/dir')

      const paths = tx.affectedPaths
      expect(paths.size).toBe(4)
      expect(paths.has('/a.txt')).toBe(true)
      expect(paths.has('/b.txt')).toBe(true)
      expect(paths.has('/c.txt')).toBe(true)
      expect(paths.has('/dir')).toBe(true)
    })
  })

  describe('Static factory methods', () => {
    it('should create atomic swap transaction', () => {
      const data = new Uint8Array([1, 2, 3])
      const tx = Transaction.atomicSwap('/config.json', data)

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('write')
      expect((tx.operations[0] as any).path).toBe('/config.json.tmp')
      expect(tx.operations[1].type).toBe('rm')
      expect(tx.operations[2].type).toBe('rename')
    })

    it('should create atomic lock swap transaction', () => {
      const data = new Uint8Array([1, 2, 3])
      const tx = Transaction.atomicLockSwap('/refs/heads/main', data)

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('write')
      expect((tx.operations[0] as any).path).toBe('/refs/heads/main.lock')
      expect((tx.operations[0] as any).options.flag).toBe('wx')
      expect(tx.operations[1].type).toBe('rename')
    })

    it('should create transaction from writeAll', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      const tx = Transaction.writeAll([
        ['/a.txt', data1],
        ['/b.txt', data2],
      ])

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('write')
      expect((tx.operations[0] as any).path).toBe('/a.txt')
      expect(tx.operations[1].type).toBe('write')
      expect((tx.operations[1] as any).path).toBe('/b.txt')
    })

    it('should create transaction from deleteAll', () => {
      const tx = Transaction.deleteAll(['/a.txt', '/b.txt'], { force: true })

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('rm')
      expect((tx.operations[0] as any).path).toBe('/a.txt')
      expect((tx.operations[0] as any).options.force).toBe(true)
      expect(tx.operations[1].type).toBe('rm')
      expect((tx.operations[1] as any).path).toBe('/b.txt')
    })

    it('should create transaction from operations array', () => {
      const operations = [
        { type: 'write' as const, path: '/a.txt', data: new Uint8Array([1, 2, 3]) },
        { type: 'mkdir' as const, path: '/dir' },
      ]

      const tx = Transaction.from(operations)

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations).toEqual(operations)
    })
  })

  describe('String data support in writeFile', () => {
    it('should accept string data in writeFile', () => {
      const tx = new Transaction()
      tx.writeFile('/hello.txt', 'Hello, World!')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0].type).toBe('write')

      const op = tx.operations[0] as any
      const decoder = new TextDecoder()
      expect(decoder.decode(op.data)).toBe('Hello, World!')
    })

    it('should support string data with options', () => {
      const tx = new Transaction()
      tx.writeFile('/script.sh', '#!/bin/bash\necho hello', { mode: 0o755 })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.options.mode).toBe(0o755)

      const decoder = new TextDecoder()
      expect(decoder.decode(op.data)).toBe('#!/bin/bash\necho hello')
    })

    it('should still work with Uint8Array data', () => {
      const tx = new Transaction()
      const data = new Uint8Array([0x89, 0x50, 0x4E, 0x47])
      tx.writeFile('/image.png', data)

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.data).toBe(data)
    })

    it('should support method chaining with string data', () => {
      const tx = new Transaction()
        .writeFile('/a.txt', 'File A')
        .writeFile('/b.txt', 'File B')
        .writeFile('/c.txt', new Uint8Array([1, 2, 3]))

      expect(tx.operations).toHaveLength(3)
    })
  })

  describe('Operation ordering optimization', () => {
    it('should execute mkdir before write operations', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      // Queue write before mkdir (wrong order for dependency)
      tx.writeFile('/dir/file.txt', data)
        .mkdir('/dir', { recursive: true })

      const executionOrder: string[] = []
      const storage = {
        writeFile: vi.fn().mockImplementation(async () => {
          executionOrder.push('write')
        }),
        mkdir: vi.fn().mockImplementation(async () => {
          executionOrder.push('mkdir')
        }),
      }

      await tx.execute(storage)

      // mkdir should execute before write due to optimal ordering
      expect(executionOrder).toEqual(['mkdir', 'write'])
    })

    it('should execute write before rename operations', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      // Queue rename before write
      tx.rename('/temp.txt', '/final.txt')
        .writeFile('/temp.txt', data)

      const executionOrder: string[] = []
      const storage = {
        writeFile: vi.fn().mockImplementation(async () => {
          executionOrder.push('write')
        }),
        rename: vi.fn().mockImplementation(async () => {
          executionOrder.push('rename')
        }),
      }

      await tx.execute(storage)

      // write should execute before rename due to optimal ordering
      expect(executionOrder).toEqual(['write', 'rename'])
    })

    it('should execute rename before delete operations', async () => {
      const tx = new Transaction()

      // Queue rm before rename
      tx.rm('/old-backup.txt')
        .rename('/current.txt', '/backup.txt')

      const executionOrder: string[] = []
      const storage = {
        rm: vi.fn().mockImplementation(async () => {
          executionOrder.push('rm')
        }),
        rename: vi.fn().mockImplementation(async () => {
          executionOrder.push('rename')
        }),
      }

      await tx.execute(storage)

      // rename should execute before rm due to optimal ordering
      expect(executionOrder).toEqual(['rename', 'rm'])
    })

    it('should execute rmdir after other delete operations', async () => {
      const tx = new Transaction()

      // Queue rmdir before unlink
      tx.rmdir('/empty-dir')
        .unlink('/file.txt')

      const executionOrder: string[] = []
      const storage = {
        rmdir: vi.fn().mockImplementation(async () => {
          executionOrder.push('rmdir')
        }),
        unlink: vi.fn().mockImplementation(async () => {
          executionOrder.push('unlink')
        }),
      }

      await tx.execute(storage)

      // unlink should execute before rmdir
      expect(executionOrder).toEqual(['unlink', 'rmdir'])
    })

    it('should maintain order within same operation type', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      // Queue multiple writes in specific order
      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)
        .writeFile('/c.txt', data)

      const writeOrder: string[] = []
      const storage = {
        writeFile: vi.fn().mockImplementation(async (path: string) => {
          writeOrder.push(path)
        }),
      }

      await tx.execute(storage)

      // Same-type operations should maintain insertion order
      expect(writeOrder).toEqual(['/a.txt', '/b.txt', '/c.txt'])
    })

    it('should handle complete operation ordering scenario', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      // Queue operations in intentionally wrong order
      tx.rm('/old.txt')           // Should be 4th
        .rename('/temp', '/final') // Should be 3rd
        .writeFile('/a.txt', data) // Should be 2nd
        .mkdir('/dir')            // Should be 1st
        .rmdir('/empty')          // Should be 5th (last)

      const executionOrder: string[] = []
      const storage = {
        mkdir: vi.fn().mockImplementation(async () => {
          executionOrder.push('mkdir')
        }),
        writeFile: vi.fn().mockImplementation(async () => {
          executionOrder.push('write')
        }),
        rename: vi.fn().mockImplementation(async () => {
          executionOrder.push('rename')
        }),
        rm: vi.fn().mockImplementation(async () => {
          executionOrder.push('rm')
        }),
        rmdir: vi.fn().mockImplementation(async () => {
          executionOrder.push('rmdir')
        }),
      }

      await tx.execute(storage)

      // Optimal order: mkdir -> write -> rename -> rm -> rmdir
      expect(executionOrder).toEqual(['mkdir', 'write', 'rename', 'rm', 'rmdir'])
    })

    it('should handle mixed operations with stable sort', async () => {
      const tx = new Transaction()
      const data = new Uint8Array([1, 2, 3])

      // Mix of operations to verify stable sorting
      tx.mkdir('/dir1')
        .writeFile('/a.txt', data)
        .mkdir('/dir2')
        .writeFile('/b.txt', data)
        .unlink('/old.txt')
        .rm('/another.txt')

      const executionOrder: string[] = []
      const storage = {
        mkdir: vi.fn().mockImplementation(async (path: string) => {
          executionOrder.push(`mkdir:${path}`)
        }),
        writeFile: vi.fn().mockImplementation(async (path: string) => {
          executionOrder.push(`write:${path}`)
        }),
        unlink: vi.fn().mockImplementation(async (path: string) => {
          executionOrder.push(`unlink:${path}`)
        }),
        rm: vi.fn().mockImplementation(async (path: string) => {
          executionOrder.push(`rm:${path}`)
        }),
      }

      await tx.execute(storage)

      // mkdirs first (in order), then writes (in order), then deletes (in order)
      expect(executionOrder).toEqual([
        'mkdir:/dir1',
        'mkdir:/dir2',
        'write:/a.txt',
        'write:/b.txt',
        'unlink:/old.txt',
        'rm:/another.txt',
      ])
    })
  })
})
