import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Transaction } from './transaction'

/**
 * RED Phase: Tests for rename/move operations in Transaction
 *
 * These tests verify that rename operations are correctly queued
 * in transactions and that the move() alias works as expected.
 *
 * Test coverage includes:
 * - Single rename operation queuing
 * - Path storage (oldPath and newPath)
 * - Multiple renames in sequence
 * - move() alias for rename()
 * - Cross-directory moves
 * - Rename then write to new path
 * - Chaining behavior
 */
describe('Transaction Rename Operations', () => {
  let tx: Transaction

  beforeEach(() => {
    tx = new Transaction()
  })

  describe('tx.rename() queues operation', () => {
    it('should queue a single rename operation', () => {
      tx.rename('/old.txt', '/new.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0].type).toBe('rename')
    })

    it('should store oldPath correctly', () => {
      tx.rename('/source/file.txt', '/dest/file.txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/source/file.txt')
    })

    it('should store newPath correctly', () => {
      tx.rename('/source/file.txt', '/dest/file.txt')

      const op = tx.operations[0] as any
      expect(op.newPath).toBe('/dest/file.txt')
    })

    it('should store both paths for same-directory rename', () => {
      tx.rename('/dir/old-name.txt', '/dir/new-name.txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/dir/old-name.txt')
      expect(op.newPath).toBe('/dir/new-name.txt')
    })

    it('should return transaction instance for chaining', () => {
      const result = tx.rename('/old.txt', '/new.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should preserve exact path strings', () => {
      const oldPath = '/path/with spaces/file.txt'
      const newPath = '/new path/with unicode/\u00e9\u00e8\u00ea.txt'

      tx.rename(oldPath, newPath)

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe(oldPath)
      expect(op.newPath).toBe(newPath)
    })
  })

  describe('tx.move() as alias for rename', () => {
    it('should queue a rename operation when move() is called', () => {
      tx.move('/old.txt', '/new.txt')

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0].type).toBe('rename')
    })

    it('should store paths correctly via move()', () => {
      tx.move('/source.txt', '/dest.txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/source.txt')
      expect(op.newPath).toBe('/dest.txt')
    })

    it('should return transaction instance from move()', () => {
      const result = tx.move('/old.txt', '/new.txt')

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should be semantically identical to rename()', () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      tx1.rename('/old.txt', '/new.txt')
      tx2.move('/old.txt', '/new.txt')

      expect(tx1.operations).toEqual(tx2.operations)
    })

    it('should chain with other move() calls', () => {
      tx.move('/a.txt', '/b.txt')
        .move('/b.txt', '/c.txt')
        .move('/c.txt', '/d.txt')

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations.every(op => op.type === 'rename')).toBe(true)
    })
  })

  describe('Multiple renames in single transaction', () => {
    it('should queue multiple rename operations in order', () => {
      tx.rename('/file1.txt', '/new1.txt')
        .rename('/file2.txt', '/new2.txt')
        .rename('/file3.txt', '/new3.txt')

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as any).oldPath).toBe('/file1.txt')
      expect((tx.operations[1] as any).oldPath).toBe('/file2.txt')
      expect((tx.operations[2] as any).oldPath).toBe('/file3.txt')
    })

    it('should maintain insertion order for renames', () => {
      tx.rename('/z.txt', '/a.txt')
        .rename('/a.txt', '/b.txt')
        .rename('/b.txt', '/c.txt')

      // Operations should be in insertion order, not sorted
      const paths = tx.operations.map(op => (op as any).oldPath)
      expect(paths).toEqual(['/z.txt', '/a.txt', '/b.txt'])
    })

    it('should allow renaming same file multiple times', () => {
      // Chain rename: a -> b -> c -> d
      tx.rename('/file.txt', '/temp.txt')
        .rename('/temp.txt', '/final.txt')

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as any).oldPath).toBe('/file.txt')
      expect((tx.operations[0] as any).newPath).toBe('/temp.txt')
      expect((tx.operations[1] as any).oldPath).toBe('/temp.txt')
      expect((tx.operations[1] as any).newPath).toBe('/final.txt')
    })

    it('should handle rename and move mixed', () => {
      tx.rename('/a.txt', '/b.txt')
        .move('/c.txt', '/d.txt')
        .rename('/e.txt', '/f.txt')

      expect(tx.operations).toHaveLength(3)
      expect(tx.operations.every(op => op.type === 'rename')).toBe(true)
    })
  })

  describe('Rename then write to new path', () => {
    it('should allow write after rename to new path', () => {
      const data = new Uint8Array([1, 2, 3])

      tx.rename('/old.txt', '/backup.txt')
        .writeFile('/old.txt', data)

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('rename')
      expect(tx.operations[1].type).toBe('write')
      expect((tx.operations[1] as any).path).toBe('/old.txt')
    })

    it('should support atomic file update pattern', () => {
      // Common pattern: rename current to backup, write new content
      const newContent = new Uint8Array([1, 2, 3, 4, 5])

      tx.rename('/config.json', '/config.json.bak')
        .writeFile('/config.json', newContent)

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as any).oldPath).toBe('/config.json')
      expect((tx.operations[0] as any).newPath).toBe('/config.json.bak')
      expect((tx.operations[1] as any).path).toBe('/config.json')
    })

    it('should support git ref update pattern (write lock, rename)', () => {
      const sha = new TextEncoder().encode('abc123def456')

      tx.writeFile('/refs/heads/main.lock', sha)
        .rename('/refs/heads/main.lock', '/refs/heads/main')

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('write')
      expect((tx.operations[0] as any).path).toBe('/refs/heads/main.lock')
      expect(tx.operations[1].type).toBe('rename')
      expect((tx.operations[1] as any).oldPath).toBe('/refs/heads/main.lock')
      expect((tx.operations[1] as any).newPath).toBe('/refs/heads/main')
    })
  })

  describe('Cross-directory moves', () => {
    it('should move file between directories', () => {
      tx.move('/source/dir/file.txt', '/dest/dir/file.txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/source/dir/file.txt')
      expect(op.newPath).toBe('/dest/dir/file.txt')
    })

    it('should move file from root to nested directory', () => {
      tx.move('/file.txt', '/deep/nested/path/file.txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/file.txt')
      expect(op.newPath).toBe('/deep/nested/path/file.txt')
    })

    it('should move file from nested to root', () => {
      tx.move('/deep/nested/path/file.txt', '/file.txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/deep/nested/path/file.txt')
      expect(op.newPath).toBe('/file.txt')
    })

    it('should support mkdir then move pattern', () => {
      tx.mkdir('/new-dir', { recursive: true })
        .move('/source/file.txt', '/new-dir/file.txt')

      expect(tx.operations).toHaveLength(2)
      expect(tx.operations[0].type).toBe('mkdir')
      expect(tx.operations[1].type).toBe('rename')
    })

    it('should support move multiple files to same directory', () => {
      tx.mkdir('/dest')
        .move('/source/a.txt', '/dest/a.txt')
        .move('/source/b.txt', '/dest/b.txt')
        .move('/source/c.txt', '/dest/c.txt')

      expect(tx.operations).toHaveLength(4)
      expect(tx.operations[0].type).toBe('mkdir')
      expect(tx.operations.slice(1).every(op => op.type === 'rename')).toBe(true)
    })
  })

  describe('Rename operation type is distinguishable', () => {
    it('should have distinct type property', () => {
      tx.rename('/old.txt', '/new.txt')

      expect(tx.operations[0].type).toBe('rename')
      expect(tx.operations[0].type).not.toBe('write')
      expect(tx.operations[0].type).not.toBe('unlink')
      expect(tx.operations[0].type).not.toBe('mkdir')
    })

    it('should be filterable by type', () => {
      const data = new Uint8Array([1, 2, 3])

      tx.writeFile('/a.txt', data)
        .rename('/b.txt', '/c.txt')
        .mkdir('/dir')
        .rename('/d.txt', '/e.txt')
        .unlink('/f.txt')

      const renames = tx.operations.filter(op => op.type === 'rename')
      expect(renames).toHaveLength(2)
      expect((renames[0] as any).oldPath).toBe('/b.txt')
      expect((renames[1] as any).oldPath).toBe('/d.txt')
    })

    it('should have oldPath and newPath properties (not just path)', () => {
      tx.rename('/old.txt', '/new.txt')

      const op = tx.operations[0] as any
      expect(op).toHaveProperty('oldPath')
      expect(op).toHaveProperty('newPath')
      expect(op).not.toHaveProperty('path') // rename uses oldPath/newPath, not path
    })
  })

  describe('Transaction state after rename operations', () => {
    it('should remain pending after queueing renames', () => {
      tx.rename('/a.txt', '/b.txt')
        .rename('/c.txt', '/d.txt')

      expect(tx.status).toBe('pending')
    })

    it('should not allow renames after commit', () => {
      // Manually set status to simulate committed state
      Object.defineProperty(tx, 'status', { value: 'committed', writable: false })

      expect(() => {
        tx.rename('/old.txt', '/new.txt')
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow moves after rollback', () => {
      // Manually set status to simulate rolled_back state
      Object.defineProperty(tx, 'status', { value: 'rolled_back', writable: false })

      expect(() => {
        tx.move('/old.txt', '/new.txt')
      }).toThrow(/cannot add operations/i)
    })
  })

  describe('Rename with other operations', () => {
    it('should integrate with complete transaction workflow', () => {
      const data = new Uint8Array([1, 2, 3])

      tx.mkdir('/backup')
        .rename('/config.json', '/backup/config.json.bak')
        .writeFile('/config.json', data)
        .unlink('/temp.txt')

      expect(tx.operations).toHaveLength(4)
      expect(tx.operations.map(op => op.type)).toEqual([
        'mkdir',
        'rename',
        'write',
        'unlink'
      ])
    })

    it('should support complex file reorganization', () => {
      tx.mkdir('/archive', { recursive: true })
        .move('/docs/old1.txt', '/archive/old1.txt')
        .move('/docs/old2.txt', '/archive/old2.txt')
        .rmdir('/docs', { recursive: true })

      expect(tx.operations).toHaveLength(4)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string paths', () => {
      // Empty paths should still be queued (validation is storage concern)
      tx.rename('', '/new.txt')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as any).oldPath).toBe('')
    })

    it('should handle identical oldPath and newPath', () => {
      // No-op rename, but should still be queued
      tx.rename('/same.txt', '/same.txt')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as any).oldPath).toBe('/same.txt')
      expect((tx.operations[0] as any).newPath).toBe('/same.txt')
    })

    it('should handle very long paths', () => {
      const longPath = '/a'.repeat(1000)
      tx.rename(longPath, longPath + '/b')

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as any).oldPath).toBe(longPath)
    })

    it('should handle special characters in paths', () => {
      tx.rename('/file (1).txt', '/file [copy].txt')

      const op = tx.operations[0] as any
      expect(op.oldPath).toBe('/file (1).txt')
      expect(op.newPath).toBe('/file [copy].txt')
    })
  })

  describe('Execute rename operations', () => {
    it('should execute rename via storage.rename()', async () => {
      tx.rename('/old.txt', '/new.txt')

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
      }

      await tx.execute(storage)

      expect(storage.rename).toHaveBeenCalledWith('/old.txt', '/new.txt')
      expect(tx.status).toBe('committed')
    })

    it('should execute multiple renames in order', async () => {
      const renames: Array<{from: string, to: string}> = []

      tx.rename('/a.txt', '/b.txt')
        .rename('/c.txt', '/d.txt')

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockImplementation(async (from: string, to: string) => {
          renames.push({ from, to })
        }),
      }

      await tx.execute(storage)

      expect(renames).toEqual([
        { from: '/a.txt', to: '/b.txt' },
        { from: '/c.txt', to: '/d.txt' },
      ])
    })

    it('should rollback rename on subsequent failure', async () => {
      const renames: Array<{from: string, to: string}> = []

      // Note: With optimal operation ordering, operations execute in this order:
      // mkdir -> write -> rename -> delete
      // So we need a rename followed by an operation that executes AFTER rename
      tx.rename('/old.txt', '/new.txt')
        .rm('/fail.txt')  // rm executes after rename in optimal order

      const storage = {
        rename: vi.fn().mockImplementation(async (from: string, to: string) => {
          renames.push({ from, to })
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockRejectedValue(new Error('Delete failed')),
      }

      await expect(tx.execute(storage)).rejects.toThrow('Delete failed')

      // Should have forward rename then rollback reverse
      expect(renames).toContainEqual({ from: '/old.txt', to: '/new.txt' })
      expect(renames).toContainEqual({ from: '/new.txt', to: '/old.txt' })
    })
  })

  describe('Cross-directory move detection', () => {
    describe('Transaction.isCrossDirectoryMove() static method', () => {
      it('should detect move between different directories', () => {
        expect(Transaction.isCrossDirectoryMove('/a/file.txt', '/b/file.txt')).toBe(true)
      })

      it('should return false for same-directory rename', () => {
        expect(Transaction.isCrossDirectoryMove('/dir/old.txt', '/dir/new.txt')).toBe(false)
      })

      it('should detect move from root to nested directory', () => {
        expect(Transaction.isCrossDirectoryMove('/file.txt', '/deep/nested/file.txt')).toBe(true)
      })

      it('should detect move from nested to root', () => {
        expect(Transaction.isCrossDirectoryMove('/deep/nested/file.txt', '/file.txt')).toBe(true)
      })

      it('should handle root level files (same parent)', () => {
        expect(Transaction.isCrossDirectoryMove('/old.txt', '/new.txt')).toBe(false)
      })

      it('should handle deeply nested paths in same directory', () => {
        expect(Transaction.isCrossDirectoryMove('/a/b/c/d/old.txt', '/a/b/c/d/new.txt')).toBe(false)
      })

      it('should handle moves to sibling directories', () => {
        expect(Transaction.isCrossDirectoryMove('/parent/a/file.txt', '/parent/b/file.txt')).toBe(true)
      })
    })

    describe('tx.isCrossDirectoryRename() instance method', () => {
      it('should return true for cross-directory rename operation', () => {
        tx.rename('/source/file.txt', '/dest/file.txt')
        expect(tx.isCrossDirectoryRename(0)).toBe(true)
      })

      it('should return false for same-directory rename operation', () => {
        tx.rename('/dir/old.txt', '/dir/new.txt')
        expect(tx.isCrossDirectoryRename(0)).toBe(false)
      })

      it('should return false for non-rename operation', () => {
        tx.writeFile('/file.txt', new Uint8Array([1, 2, 3]))
        expect(tx.isCrossDirectoryRename(0)).toBe(false)
      })

      it('should return false for out of bounds index', () => {
        tx.rename('/old.txt', '/new.txt')
        expect(tx.isCrossDirectoryRename(5)).toBe(false)
      })

      it('should check correct operation when multiple are queued', () => {
        tx.rename('/dir/a.txt', '/dir/b.txt')  // same directory
          .rename('/source/file.txt', '/dest/file.txt')  // cross-directory

        expect(tx.isCrossDirectoryRename(0)).toBe(false)
        expect(tx.isCrossDirectoryRename(1)).toBe(true)
      })
    })

    describe('tx.getCrossDirectoryRenames() method', () => {
      it('should return empty array when no renames', () => {
        tx.writeFile('/file.txt', new Uint8Array([1, 2, 3]))
        expect(tx.getCrossDirectoryRenames()).toEqual([])
      })

      it('should return empty array when no cross-directory renames', () => {
        tx.rename('/dir/a.txt', '/dir/b.txt')
          .rename('/other/x.txt', '/other/y.txt')

        expect(tx.getCrossDirectoryRenames()).toEqual([])
      })

      it('should return only cross-directory rename operations', () => {
        tx.rename('/dir/a.txt', '/dir/b.txt')  // same directory
          .rename('/source/file.txt', '/dest/file.txt')  // cross-directory
          .rename('/x.txt', '/y.txt')  // same directory (root)

        const crossDirMoves = tx.getCrossDirectoryRenames()
        expect(crossDirMoves).toHaveLength(1)
        expect(crossDirMoves[0].oldPath).toBe('/source/file.txt')
        expect(crossDirMoves[0].newPath).toBe('/dest/file.txt')
      })

      it('should return all cross-directory renames when multiple', () => {
        tx.rename('/a/file1.txt', '/b/file1.txt')  // cross
          .rename('/c/file2.txt', '/d/file2.txt')  // cross
          .rename('/dir/old.txt', '/dir/new.txt')  // same directory

        const crossDirMoves = tx.getCrossDirectoryRenames()
        expect(crossDirMoves).toHaveLength(2)
        expect(crossDirMoves[0].oldPath).toBe('/a/file1.txt')
        expect(crossDirMoves[1].oldPath).toBe('/c/file2.txt')
      })
    })
  })

  describe('Optimal operation ordering', () => {
    it('should execute mkdir before rename (directories exist for moves)', async () => {
      const executionOrder: string[] = []

      // Queue in "wrong" order - rename before mkdir
      tx.rename('/source/file.txt', '/dest/file.txt')
        .mkdir('/dest')

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockImplementation(async () => {
          executionOrder.push('mkdir')
        }),
        rename: vi.fn().mockImplementation(async () => {
          executionOrder.push('rename')
        }),
      }

      await tx.execute(storage)

      // mkdir should execute before rename due to optimal ordering
      expect(executionOrder).toEqual(['mkdir', 'rename'])
    })

    it('should execute write before rename (files exist for atomic swap)', async () => {
      const executionOrder: string[] = []

      // Queue rename before write
      tx.rename('/file.lock', '/file.txt')
        .writeFile('/file.lock', new Uint8Array([1, 2, 3]))

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

    it('should execute rename before delete (preserve swap semantics)', async () => {
      const executionOrder: string[] = []

      // Queue delete before rename
      tx.rm('/old-file.txt')
        .rename('/temp.txt', '/new-file.txt')

      const storage = {
        writeFile: vi.fn().mockResolvedValue(undefined),
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
  })

  describe('Rename options', () => {
    describe('mkdirp option', () => {
      it('should queue rename with mkdirp option', () => {
        tx.rename('/source/file.txt', '/dest/file.txt', { mkdirp: true })

        expect(tx.operations).toHaveLength(1)
        const op = tx.operations[0] as any
        expect(op.type).toBe('rename')
        expect(op.options).toBeDefined()
        expect(op.options.mkdirp).toBe(true)
      })

      it('should not add options property when options is empty', () => {
        tx.rename('/old.txt', '/new.txt', {})

        expect(tx.operations).toHaveLength(1)
        expect('options' in tx.operations[0]).toBe(false)
      })

      it('should not add options property when options is undefined', () => {
        tx.rename('/old.txt', '/new.txt')

        expect(tx.operations).toHaveLength(1)
        expect('options' in tx.operations[0]).toBe(false)
      })

      it('should call mkdir for parent directory when mkdirp is true', async () => {
        tx.rename('/source/file.txt', '/new/deep/path/file.txt', { mkdirp: true })

        const mkdirCalls: Array<{path: string, options: any}> = []
        const storage = {
          writeFile: vi.fn().mockResolvedValue(undefined),
          mkdir: vi.fn().mockImplementation(async (path: string, options: any) => {
            mkdirCalls.push({ path, options })
          }),
          rename: vi.fn().mockResolvedValue(undefined),
        }

        await tx.execute(storage)

        // Should have called mkdir for parent directory
        expect(mkdirCalls).toHaveLength(1)
        expect(mkdirCalls[0].path).toBe('/new/deep/path')
        expect(mkdirCalls[0].options.recursive).toBe(true)
      })

      it('should not call mkdir when mkdirp is false', async () => {
        tx.rename('/source/file.txt', '/dest/file.txt')

        const storage = {
          writeFile: vi.fn().mockResolvedValue(undefined),
          mkdir: vi.fn().mockResolvedValue(undefined),
          rename: vi.fn().mockResolvedValue(undefined),
        }

        await tx.execute(storage)

        expect(storage.mkdir).not.toHaveBeenCalled()
      })

      it('should work with move() alias and mkdirp option', async () => {
        tx.move('/source/file.txt', '/dest/subdir/file.txt', { mkdirp: true })

        const mkdirCalls: string[] = []
        const storage = {
          writeFile: vi.fn().mockResolvedValue(undefined),
          mkdir: vi.fn().mockImplementation(async (path: string) => {
            mkdirCalls.push(path)
          }),
          rename: vi.fn().mockResolvedValue(undefined),
        }

        await tx.execute(storage)

        expect(mkdirCalls).toContain('/dest/subdir')
      })

      it('should not create mkdir for root-level destinations', async () => {
        tx.rename('/source/file.txt', '/file.txt', { mkdirp: true })

        const storage = {
          writeFile: vi.fn().mockResolvedValue(undefined),
          mkdir: vi.fn().mockResolvedValue(undefined),
          rename: vi.fn().mockResolvedValue(undefined),
        }

        await tx.execute(storage)

        // No mkdir should be called for root-level file
        expect(storage.mkdir).not.toHaveBeenCalled()
      })
    })

    describe('overwrite option', () => {
      it('should queue rename with overwrite option', () => {
        tx.rename('/old.txt', '/new.txt', { overwrite: false })

        expect(tx.operations).toHaveLength(1)
        const op = tx.operations[0] as any
        expect(op.options).toBeDefined()
        expect(op.options.overwrite).toBe(false)
      })

      it('should support both mkdirp and overwrite options together', () => {
        tx.move('/source/file.txt', '/dest/file.txt', { mkdirp: true, overwrite: false })

        expect(tx.operations).toHaveLength(1)
        const op = tx.operations[0] as any
        expect(op.options.mkdirp).toBe(true)
        expect(op.options.overwrite).toBe(false)
      })
    })

    describe('options immutability', () => {
      it('should not mutate original options object', () => {
        const options = { mkdirp: true, overwrite: false }
        tx.rename('/old.txt', '/new.txt', options)

        // Modify original options
        options.mkdirp = false

        const op = tx.operations[0] as any
        expect(op.options.mkdirp).toBe(true) // Should still be true
      })
    })
  })
})
