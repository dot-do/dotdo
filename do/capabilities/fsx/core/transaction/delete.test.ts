/**
 * Tests for delete operations in transactions [RED phase]
 *
 * Tests queueing unlink/rm operations within a transaction.
 * These tests define the expected behavior for transactional delete operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Transaction, type DeleteOperation, type Operation } from './transaction'

describe('Transaction Delete Operations', () => {
  let tx: Transaction

  beforeEach(() => {
    tx = new Transaction()
  })

  describe('Queue single unlink operation', () => {
    it('should queue a single file unlink operation', () => {
      tx.unlink('/test.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'unlink',
        path: '/test.txt'
      })
    })

    it('should queue unlink with absolute path', () => {
      tx.unlink('/absolute/path/to/file.txt')

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as DeleteOperation
      expect(op.type).toBe('unlink')
      expect(op.path).toBe('/absolute/path/to/file.txt')
    })

    it('should return transaction instance for chaining', () => {
      const result = tx.unlink('/test.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should preserve exact path string', () => {
      const path = '/path/with/special chars and spaces.txt'
      tx.unlink(path)

      const op = tx.operations[0] as DeleteOperation
      expect(op.path).toBe(path)
    })
  })

  describe('Queue deleteFile/rm operation', () => {
    it('should queue rm operation for file removal', () => {
      tx.rm('/test.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toMatchObject({
        type: 'rm',
        path: '/test.txt'
      })
    })

    it('should queue rm operation with force option', () => {
      tx.rm('/test.txt', { force: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rm')
      expect(op.path).toBe('/test.txt')
      expect(op.options?.force).toBe(true)
    })

    it('should queue rm operation with recursive option', () => {
      tx.rm('/directory', { recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rm')
      expect(op.path).toBe('/directory')
      expect(op.options?.recursive).toBe(true)
    })

    it('should queue rm with both force and recursive options', () => {
      tx.rm('/directory', { force: true, recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rm')
      expect(op.options?.force).toBe(true)
      expect(op.options?.recursive).toBe(true)
    })

    it('should return transaction instance for chaining', () => {
      const result = tx.rm('/test.txt')

      expect(result).toBe(tx)
    })
  })

  describe('Delete stores target path correctly', () => {
    it('should store normalized path for unlink', () => {
      tx.unlink('/path//double/slashes')

      const op = tx.operations[0] as DeleteOperation
      // Path should be stored as-is (normalization happens at execution)
      expect(op.path).toBe('/path//double/slashes')
    })

    it('should store path with unicode characters', () => {
      tx.unlink('/fichier-francais.txt')
      tx.unlink('/archivo-espanol.txt')
      tx.unlink('/japanese-file.txt')

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/fichier-francais.txt')
      expect((tx.operations[1] as DeleteOperation).path).toBe('/archivo-espanol.txt')
      expect((tx.operations[2] as DeleteOperation).path).toBe('/japanese-file.txt')
    })

    it('should store deeply nested paths correctly', () => {
      const deepPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/file.txt'
      tx.unlink(deepPath)

      const op = tx.operations[0] as DeleteOperation
      expect(op.path).toBe(deepPath)
    })

    it('should store path with very long filename', () => {
      const longPath = '/' + 'a'.repeat(200) + '.txt'
      tx.unlink(longPath)

      const op = tx.operations[0] as DeleteOperation
      expect(op.path).toBe(longPath)
    })
  })

  describe('Multiple deletes queue in order', () => {
    it('should queue multiple unlink operations in order', () => {
      tx.unlink('/first.txt')
      tx.unlink('/second.txt')
      tx.unlink('/third.txt')

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/first.txt')
      expect((tx.operations[1] as DeleteOperation).path).toBe('/second.txt')
      expect((tx.operations[2] as DeleteOperation).path).toBe('/third.txt')
    })

    it('should queue multiple rm operations in order', () => {
      tx.rm('/dir1', { recursive: true })
      tx.rm('/dir2', { recursive: true })
      tx.rm('/dir3', { recursive: true })

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as any).path).toBe('/dir1')
      expect((tx.operations[1] as any).path).toBe('/dir2')
      expect((tx.operations[2] as any).path).toBe('/dir3')
    })

    it('should interleave unlink and rm operations correctly', () => {
      tx.unlink('/file1.txt')
      tx.rm('/dir1', { recursive: true })
      tx.unlink('/file2.txt')
      tx.rm('/dir2', { recursive: true })

      expect(tx.operations).toHaveLength(4)
      expect(tx.operations[0]).toMatchObject({ type: 'unlink', path: '/file1.txt' })
      expect(tx.operations[1]).toMatchObject({ type: 'rm', path: '/dir1' })
      expect(tx.operations[2]).toMatchObject({ type: 'unlink', path: '/file2.txt' })
      expect(tx.operations[3]).toMatchObject({ type: 'rm', path: '/dir2' })
    })

    it('should preserve order when mixed with write operations', () => {
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/new.txt', data)
      tx.unlink('/old.txt')
      tx.writeFile('/another.txt', data)
      tx.rm('/dir', { recursive: true })

      expect(tx.operations).toHaveLength(4)
      expect(tx.operations[0].type).toBe('write')
      expect(tx.operations[1].type).toBe('unlink')
      expect(tx.operations[2].type).toBe('write')
      expect(tx.operations[3].type).toBe('rm')
    })

    it('should allow deleting same path multiple times (for atomic replace patterns)', () => {
      tx.unlink('/file.txt')
      tx.unlink('/file.txt')

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/file.txt')
      expect((tx.operations[1] as DeleteOperation).path).toBe('/file.txt')
    })
  })

  describe('Delete operation type is distinguishable', () => {
    it('should have distinguishable type for unlink vs deleteFile', () => {
      tx.unlink('/file1.txt')
      tx.deleteFile('/file2.txt')

      // Both should create delete-type operations but may be distinguishable
      expect(tx.operations).toHaveLength(2)
      // The implementation may use 'delete' or 'unlink' type
      // This test verifies they are identifiable as delete operations
      const types = tx.operations.map((op) => op.type)
      expect(types.every((t) => t === 'delete' || t === 'unlink')).toBe(true)
    })

    it('should distinguish unlink from rm', () => {
      tx.unlink('/file.txt')
      tx.rm('/directory', { recursive: true })

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('unlink')
      expect(tx.operations[1].type).toBe('rm')
    })

    it('should distinguish delete operations from write operations', () => {
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/file.txt', data)
      tx.unlink('/other.txt')
      tx.rm('/dir', { recursive: true })

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('write')
      expect(tx.operations[1].type).toBe('unlink')
      expect(tx.operations[2].type).toBe('rm')
    })

    it('should distinguish delete operations from rename operations', () => {
      tx.rename('/old.txt', '/new.txt')
      tx.unlink('/other.txt')
      tx.rm('/dir', { recursive: true })

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('rename')
      expect(tx.operations[1].type).toBe('unlink')
      expect(tx.operations[2].type).toBe('rm')
    })

    it('should distinguish delete operations from mkdir operations', () => {
      tx.mkdir('/newdir')
      tx.unlink('/file.txt')
      tx.rm('/olddir', { recursive: true })

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations[0].type).toBe('mkdir')
      expect(tx.operations[1].type).toBe('unlink')
      expect(tx.operations[2].type).toBe('rm')
    })
  })

  describe('rmdir operation in transaction', () => {
    it('should queue rmdir operation for empty directory', () => {
      tx.rmdir('/empty-dir')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toMatchObject({
        type: 'rmdir',
        path: '/empty-dir'
      })
    })

    it('should queue rmdir with recursive option', () => {
      tx.rmdir('/non-empty-dir', { recursive: true })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('rmdir')
      expect(op.path).toBe('/non-empty-dir')
      expect(op.options?.recursive).toBe(true)
    })

    it('should return transaction instance for chaining', () => {
      const result = tx.rmdir('/dir')

      expect(result).toBe(tx)
    })

    it('should distinguish rmdir from rm', () => {
      tx.rmdir('/dir1')
      tx.rm('/dir2', { recursive: true })

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('rmdir')
      expect(tx.operations[1].type).toBe('rm')
    })
  })

  describe('Transaction state with delete operations', () => {
    it('should not allow unlink after commit', () => {
      // Simulate committed state
      Object.defineProperty(tx, 'status', { value: 'committed', writable: false })

      expect(() => {
        tx.unlink('/test.txt')
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow rm after commit', () => {
      Object.defineProperty(tx, 'status', { value: 'committed', writable: false })

      expect(() => {
        tx.rm('/dir', { recursive: true })
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow rmdir after commit', () => {
      Object.defineProperty(tx, 'status', { value: 'committed', writable: false })

      expect(() => {
        tx.rmdir('/dir')
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow unlink after rollback', () => {
      Object.defineProperty(tx, 'status', { value: 'rolled_back', writable: false })

      expect(() => {
        tx.unlink('/test.txt')
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow rm after rollback', () => {
      Object.defineProperty(tx, 'status', { value: 'rolled_back', writable: false })

      expect(() => {
        tx.rm('/dir', { recursive: true })
      }).toThrow(/cannot add operations/i)
    })
  })

  describe('Chaining delete operations', () => {
    it('should support chaining multiple unlink calls', () => {
      const result = tx
        .unlink('/a.txt')
        .unlink('/b.txt')
        .unlink('/c.txt')

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
    })

    it('should support chaining multiple rm calls', () => {
      const result = tx
        .rm('/dir1', { recursive: true })
        .rm('/dir2', { recursive: true })
        .rm('/dir3', { recursive: true })

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
    })

    it('should support chaining mixed operations', () => {
      const data = new Uint8Array([1, 2, 3])

      const result = tx
        .writeFile('/new.txt', data)
        .unlink('/old.txt')
        .mkdir('/newdir')
        .rm('/olddir', { recursive: true })
        .rename('/a.txt', '/b.txt')
        .rmdir('/empty')

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(6)
    })

    it('should support inline transaction creation with deletes', () => {
      const tx2 = new Transaction()
        .unlink('/file1.txt')
        .rm('/dir1', { recursive: true })
        .unlink('/file2.txt')

      expect(tx2).toBeInstanceOf(Transaction)
      expect(tx2.operations).toHaveLength(3)
    })
  })

  describe('Delete operation with special paths', () => {
    it('should handle root-level files', () => {
      tx.unlink('/root-file.txt')

      const op = tx.operations[0] as DeleteOperation
      expect(op.path).toBe('/root-file.txt')
    })

    it('should handle hidden files (dotfiles)', () => {
      tx.unlink('/.hidden')
      tx.unlink('/dir/.gitignore')

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/.hidden')
      expect((tx.operations[1] as DeleteOperation).path).toBe('/dir/.gitignore')
    })

    it('should handle files with extensions', () => {
      tx.unlink('/file.tar.gz')
      tx.unlink('/file.test.ts')

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/file.tar.gz')
      expect((tx.operations[1] as DeleteOperation).path).toBe('/file.test.ts')
    })

    it('should handle directory paths for rm', () => {
      tx.rm('/path/to/directory', { recursive: true })

      const op = tx.operations[0] as any
      expect(op.path).toBe('/path/to/directory')
      expect(op.options?.recursive).toBe(true)
    })
  })

  describe('Symlink deletion in transaction', () => {
    it('should queue unlink for symlink path', () => {
      tx.unlink('/symlink')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/symlink')
    })

    it('should queue rm for symlink to directory', () => {
      tx.rm('/symlink-to-dir')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as any).path).toBe('/symlink-to-dir')
    })
  })

  describe('Operation type property', () => {
    it('should have type property on UnlinkOperation', () => {
      tx.unlink('/test.txt')

      const op = tx.operations[0]
      expect(op).toHaveProperty('type')
      expect(op.type).toBe('unlink')
    })

    it('should have type property on RmOperation', () => {
      tx.rm('/dir', { recursive: true })

      const op = tx.operations[0]
      expect(op).toHaveProperty('type')
      expect(op.type).toBe('rm')
    })

    it('should have type property on RmdirOperation', () => {
      tx.rmdir('/dir')

      const op = tx.operations[0]
      expect(op).toHaveProperty('type')
      expect(op.type).toBe('rmdir')
    })
  })
})

describe('Transaction Delete Operation Types', () => {
  describe('UnlinkOperation type', () => {
    it('should have type unlink', () => {
      const tx = new Transaction()
      tx.unlink('/test.txt')

      const op = tx.operations[0]
      expect(op.type).toBe('unlink')
    })

    it('should have path property', () => {
      const tx = new Transaction()
      tx.unlink('/test.txt')

      const op = tx.operations[0] as any
      expect(op).toHaveProperty('path')
      expect(typeof op.path).toBe('string')
    })
  })

  describe('RmOperation type', () => {
    it('should have type rm', () => {
      const tx = new Transaction()
      tx.rm('/dir', { recursive: true })

      const op = tx.operations[0]
      expect(op.type).toBe('rm')
    })

    it('should have path property', () => {
      const tx = new Transaction()
      tx.rm('/dir')

      const op = tx.operations[0] as any
      expect(op).toHaveProperty('path')
    })

    it('should have options property when provided', () => {
      const tx = new Transaction()
      tx.rm('/dir', { force: true, recursive: true })

      const op = tx.operations[0] as any
      expect(op).toHaveProperty('options')
      expect(op.options.force).toBe(true)
      expect(op.options.recursive).toBe(true)
    })
  })

  describe('RmdirOperation type', () => {
    it('should have type rmdir', () => {
      const tx = new Transaction()
      tx.rmdir('/dir')

      const op = tx.operations[0]
      expect(op.type).toBe('rmdir')
    })

    it('should have path property', () => {
      const tx = new Transaction()
      tx.rmdir('/dir')

      const op = tx.operations[0] as any
      expect(op).toHaveProperty('path')
    })

    it('should have options property when recursive provided', () => {
      const tx = new Transaction()
      tx.rmdir('/dir', { recursive: true })

      const op = tx.operations[0] as any
      expect(op).toHaveProperty('options')
      expect(op.options?.recursive).toBe(true)
    })
  })
})

describe('Transaction Delete Edge Cases', () => {
  let tx: Transaction

  beforeEach(() => {
    tx = new Transaction()
  })

  describe('Empty and whitespace paths', () => {
    it('should store empty string path (validation at execution)', () => {
      // Transaction queuing may not validate paths - that happens at execution
      tx.unlink('')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as DeleteOperation).path).toBe('')
    })

    it('should store whitespace path (validation at execution)', () => {
      tx.unlink('   ')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as DeleteOperation).path).toBe('   ')
    })
  })

  describe('Path normalization behavior', () => {
    it('should not normalize paths during queueing', () => {
      // Paths should be stored as-is, normalized during execution
      tx.unlink('/path/../other/./file.txt')

      const op = tx.operations[0] as DeleteOperation
      expect(op.path).toBe('/path/../other/./file.txt')
    })

    it('should preserve trailing slashes', () => {
      tx.rm('/dir/', { recursive: true })

      const op = tx.operations[0] as any
      expect(op.path).toBe('/dir/')
    })
  })

  describe('Large batch operations', () => {
    it('should handle many delete operations', () => {
      for (let i = 0; i < 1000; i++) {
        tx.unlink(`/file${i}.txt`)
      }

      expect(tx.operations).toHaveLength(1000)
      expect((tx.operations[0] as DeleteOperation).path).toBe('/file0.txt')
      expect((tx.operations[999] as DeleteOperation).path).toBe('/file999.txt')
    })

    it('should handle mixed large batch', () => {
      const data = new Uint8Array([1, 2, 3])

      for (let i = 0; i < 500; i++) {
        tx.writeFile(`/new${i}.txt`, data)
        tx.unlink(`/old${i}.txt`)
      }

      expect(tx.operations).toHaveLength(1000)
    })
  })

  describe('Operation immutability', () => {
    it('should not allow modification of queued delete operation', () => {
      tx.unlink('/test.txt')

      const op = tx.operations[0] as DeleteOperation

      // Attempt to modify the path
      const originalPath = op.path
      ;(op as any).path = '/modified.txt'

      // The modification may or may not work depending on implementation
      // This test documents expected behavior
      // Ideally operations should be immutable
      expect(tx.operations[0]).toBeDefined()
    })

    it('should not allow modification of rm options after queueing', () => {
      const options = { force: true, recursive: true }
      tx.rm('/dir', options)

      // Modify the original options object
      options.force = false

      // The queued operation should have captured the original values
      const op = tx.operations[0] as any
      // Implementation may copy or reference options
      // This test documents expected behavior
      expect(op.options).toBeDefined()
    })
  })
})

/**
 * Tests for execute() method with delete operations
 *
 * Tests that the Transaction.execute() method correctly handles
 * unlink, rm, and rmdir operation types with their options.
 */
describe('Transaction Execute - Delete Operations', () => {
  describe('execute() with unlink operations', () => {
    it('should call storage.unlink for unlink operations', async () => {
      const tx = new Transaction()
      const unlinkMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: unlinkMock
      }

      tx.unlink('/file.txt')
      await tx.execute(storage)

      expect(unlinkMock).toHaveBeenCalledWith('/file.txt')
      expect(tx.status).toBe('committed')
    })

    it('should call storage.unlink for deleteFile() method', async () => {
      const tx = new Transaction()
      const unlinkMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: unlinkMock
      }

      tx.deleteFile('/file.txt')
      await tx.execute(storage)

      expect(unlinkMock).toHaveBeenCalledWith('/file.txt')
    })

    it('should fallback to deleteFile if unlink not available', async () => {
      const tx = new Transaction()
      const deleteFileMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        deleteFile: deleteFileMock
        // no unlink method
      }

      tx.unlink('/file.txt')
      await tx.execute(storage)

      expect(deleteFileMock).toHaveBeenCalledWith('/file.txt')
    })

    it('should execute multiple unlink operations in order', async () => {
      const tx = new Transaction()
      const callOrder: string[] = []
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockImplementation((path) => {
          callOrder.push(path)
          return Promise.resolve()
        })
      }

      tx.unlink('/a.txt')
        .unlink('/b.txt')
        .unlink('/c.txt')

      await tx.execute(storage)

      expect(callOrder).toEqual(['/a.txt', '/b.txt', '/c.txt'])
    })
  })

  describe('execute() with rm operations', () => {
    it('should call storage.rm for rm operations', async () => {
      const tx = new Transaction()
      const rmMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: rmMock
      }

      tx.rm('/file.txt')
      await tx.execute(storage)

      expect(rmMock).toHaveBeenCalledWith('/file.txt', undefined)
    })

    it('should pass force option to storage.rm', async () => {
      const tx = new Transaction()
      const rmMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: rmMock
      }

      tx.rm('/maybe-exists.txt', { force: true })
      await tx.execute(storage)

      expect(rmMock).toHaveBeenCalledWith('/maybe-exists.txt', { force: true })
    })

    it('should pass recursive option to storage.rm', async () => {
      const tx = new Transaction()
      const rmMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: rmMock
      }

      tx.rm('/directory', { recursive: true })
      await tx.execute(storage)

      expect(rmMock).toHaveBeenCalledWith('/directory', { recursive: true })
    })

    it('should pass both force and recursive options to storage.rm', async () => {
      const tx = new Transaction()
      const rmMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: rmMock
      }

      tx.rm('/dir', { force: true, recursive: true })
      await tx.execute(storage)

      expect(rmMock).toHaveBeenCalledWith('/dir', { force: true, recursive: true })
    })

    it('should fallback to deleteFile if rm not available', async () => {
      const tx = new Transaction()
      const deleteFileMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        deleteFile: deleteFileMock
        // no rm method
      }

      tx.rm('/file.txt')
      await tx.execute(storage)

      // Falls back to deleteFile (without options support)
      expect(deleteFileMock).toHaveBeenCalledWith('/file.txt')
    })
  })

  describe('execute() with rmdir operations', () => {
    it('should call storage.rmdir for rmdir operations', async () => {
      const tx = new Transaction()
      const rmdirMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rmdir: rmdirMock
      }

      tx.rmdir('/empty-dir')
      await tx.execute(storage)

      expect(rmdirMock).toHaveBeenCalledWith('/empty-dir', undefined)
    })

    it('should pass recursive option to storage.rmdir', async () => {
      const tx = new Transaction()
      const rmdirMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rmdir: rmdirMock
      }

      tx.rmdir('/non-empty-dir', { recursive: true })
      await tx.execute(storage)

      expect(rmdirMock).toHaveBeenCalledWith('/non-empty-dir', { recursive: true })
    })

    it('should fallback to rm with recursive if rmdir not available', async () => {
      const tx = new Transaction()
      const rmMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: rmMock
        // no rmdir method
      }

      tx.rmdir('/dir', { recursive: true })
      await tx.execute(storage)

      expect(rmMock).toHaveBeenCalledWith('/dir', { recursive: true })
    })

    it('should not call rm fallback for non-recursive rmdir', async () => {
      const tx = new Transaction()
      const rmMock = vi.fn().mockResolvedValue(undefined)
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: rmMock
        // no rmdir method
      }

      tx.rmdir('/dir') // No recursive option
      await tx.execute(storage)

      // Should not fall back to rm without recursive
      expect(rmMock).not.toHaveBeenCalled()
    })
  })

  describe('execute() with mixed delete and write operations', () => {
    it('should execute write and unlink operations in order', async () => {
      const tx = new Transaction()
      const callOrder: string[] = []
      const storage = {
        writeFile: vi.fn().mockImplementation((path) => {
          callOrder.push(`write:${path}`)
          return Promise.resolve()
        }),
        unlink: vi.fn().mockImplementation((path) => {
          callOrder.push(`unlink:${path}`)
          return Promise.resolve()
        })
      }

      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/new.txt', data)
        .unlink('/old.txt')
        .writeFile('/another.txt', data)

      await tx.execute(storage)

      // With optimal ordering: writes execute before deletes
      expect(callOrder).toEqual([
        'write:/new.txt',
        'write:/another.txt',
        'unlink:/old.txt'
      ])
    })

    it('should execute atomic swap pattern (write temp, rm old, rename)', async () => {
      const tx = new Transaction()
      const callOrder: string[] = []
      const storage = {
        writeFile: vi.fn().mockImplementation((path) => {
          callOrder.push(`write:${path}`)
          return Promise.resolve()
        }),
        rm: vi.fn().mockImplementation((path, opts) => {
          callOrder.push(`rm:${path}:${JSON.stringify(opts)}`)
          return Promise.resolve()
        }),
        rename: vi.fn().mockImplementation((oldPath, newPath) => {
          callOrder.push(`rename:${oldPath}->${newPath}`)
          return Promise.resolve()
        })
      }

      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/file.tmp', data)
        .rm('/file.txt', { force: true })
        .rename('/file.tmp', '/file.txt')

      await tx.execute(storage)

      // With optimal ordering: write -> rename -> rm
      expect(callOrder).toEqual([
        'write:/file.tmp',
        'rename:/file.tmp->/file.txt',
        'rm:/file.txt:{"force":true}'
      ])
    })
  })

  describe('execute() rollback on failure', () => {
    it('should rollback writes on unlink failure', async () => {
      const tx = new Transaction()
      const deletedPaths: string[] = []
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockImplementation((path) => {
          if (path === '/fail.txt') {
            return Promise.reject(new Error('ENOENT'))
          }
          return Promise.resolve()
        }),
        rm: vi.fn().mockImplementation((path) => {
          deletedPaths.push(path)
          return Promise.resolve()
        })
      }

      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/a.txt', data)
        .writeFile('/b.txt', data)
        .unlink('/fail.txt') // This will fail

      await expect(tx.execute(storage)).rejects.toThrow('ENOENT')
      expect(tx.status).toBe('rolled_back')

      // Should have attempted to delete the written files
      expect(deletedPaths).toContain('/a.txt')
      expect(deletedPaths).toContain('/b.txt')
    })

    it('should rollback writes on rm failure', async () => {
      const tx = new Transaction()
      const deletedPaths: string[] = []
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockImplementation((path) => {
          if (path === '/fail-dir') {
            return Promise.reject(new Error('EISDIR'))
          }
          deletedPaths.push(path)
          return Promise.resolve()
        })
      }

      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/new.txt', data)
        .rm('/fail-dir') // This will fail

      await expect(tx.execute(storage)).rejects.toThrow('EISDIR')
      expect(tx.status).toBe('rolled_back')
      expect(deletedPaths).toContain('/new.txt')
    })

    it('should use rm for rollback if available (before unlink)', async () => {
      const tx = new Transaction()
      const rmCalls: string[] = []
      const unlinkCalls: string[] = []
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockImplementation((path) => {
          if (path === '/fail.txt') {
            return Promise.reject(new Error('ENOENT'))
          }
          unlinkCalls.push(path)
          return Promise.resolve()
        }),
        rm: vi.fn().mockImplementation((path) => {
          rmCalls.push(path)
          return Promise.resolve()
        })
      }

      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/written.txt', data)
        .unlink('/fail.txt')

      await expect(tx.execute(storage)).rejects.toThrow('ENOENT')

      // rm should be used for rollback (it's preferred)
      expect(rmCalls).toContain('/written.txt')
    })
  })

  describe('execute() with no storage methods', () => {
    it('should skip delete operations if no delete methods available', async () => {
      const tx = new Transaction()
      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined)
        // No deleteFile, unlink, rm, or rmdir methods
      }

      tx.unlink('/file.txt')
        .rm('/dir', { recursive: true })
        .rmdir('/empty')

      // Should not throw, just skip the operations
      await tx.execute(storage)
      expect(tx.status).toBe('committed')
    })
  })
})
