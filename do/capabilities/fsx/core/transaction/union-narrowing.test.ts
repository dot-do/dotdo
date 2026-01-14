/**
 * @fileoverview Tests for TypeScript union narrowing in Transaction operations.
 *
 * These tests verify that the Operation discriminated union is properly narrowed
 * when using switch statements and type guards, enabling type-safe access to
 * operation-specific properties.
 *
 * TDD RED Phase: fsx-si37
 */

import { describe, it, expect } from 'vitest'
import type {
  Operation,
  OperationType,
  OperationByType,
  WriteOperation,
  DeleteOperation,
  UnlinkOperation,
  RmOperation,
  RmdirOperation,
  RenameOperation,
  MkdirOperation,
} from './transaction'
import { Transaction } from './transaction'

describe('Operation Union Narrowing', () => {
  describe('Discriminated union type checks', () => {
    it('should narrow WriteOperation with switch statement', () => {
      const op: Operation = {
        type: 'write',
        path: '/test.txt',
        data: new Uint8Array([1, 2, 3]),
      }

      // Type narrowing via switch
      switch (op.type) {
        case 'write':
          // After narrowing, we should be able to access WriteOperation properties
          expect(op.path).toBe('/test.txt')
          expect(op.data).toEqual(new Uint8Array([1, 2, 3]))
          expect(op.options).toBeUndefined()
          break
        default:
          throw new Error('Should have matched write case')
      }
    })

    it('should narrow DeleteOperation with switch statement', () => {
      const op: Operation = {
        type: 'delete',
        path: '/test.txt',
      }

      switch (op.type) {
        case 'delete':
          expect(op.path).toBe('/test.txt')
          break
        default:
          throw new Error('Should have matched delete case')
      }
    })

    it('should narrow UnlinkOperation with switch statement', () => {
      const op: Operation = {
        type: 'unlink',
        path: '/test.txt',
      }

      switch (op.type) {
        case 'unlink':
          expect(op.path).toBe('/test.txt')
          break
        default:
          throw new Error('Should have matched unlink case')
      }
    })

    it('should narrow RmOperation with switch statement', () => {
      const op: Operation = {
        type: 'rm',
        path: '/test.txt',
        options: { force: true, recursive: true },
      }

      switch (op.type) {
        case 'rm':
          expect(op.path).toBe('/test.txt')
          expect(op.options?.force).toBe(true)
          expect(op.options?.recursive).toBe(true)
          break
        default:
          throw new Error('Should have matched rm case')
      }
    })

    it('should narrow RmdirOperation with switch statement', () => {
      const op: Operation = {
        type: 'rmdir',
        path: '/test-dir',
        options: { recursive: true },
      }

      switch (op.type) {
        case 'rmdir':
          expect(op.path).toBe('/test-dir')
          expect(op.options?.recursive).toBe(true)
          break
        default:
          throw new Error('Should have matched rmdir case')
      }
    })

    it('should narrow RenameOperation with switch statement', () => {
      const op: Operation = {
        type: 'rename',
        oldPath: '/old.txt',
        newPath: '/new.txt',
      }

      switch (op.type) {
        case 'rename':
          // RenameOperation uses oldPath/newPath instead of path
          expect(op.oldPath).toBe('/old.txt')
          expect(op.newPath).toBe('/new.txt')
          break
        default:
          throw new Error('Should have matched rename case')
      }
    })

    it('should narrow MkdirOperation with switch statement', () => {
      const op: Operation = {
        type: 'mkdir',
        path: '/new-dir',
        options: { recursive: true, mode: 0o755 },
      }

      switch (op.type) {
        case 'mkdir':
          expect(op.path).toBe('/new-dir')
          expect(op.options?.recursive).toBe(true)
          expect(op.options?.mode).toBe(0o755)
          break
        default:
          throw new Error('Should have matched mkdir case')
      }
    })
  })

  describe('OperationByType helper type', () => {
    it('should extract WriteOperation type', () => {
      const write: OperationByType<'write'> = {
        type: 'write',
        path: '/test.txt',
        data: new Uint8Array([1, 2, 3]),
      }
      expect(write.type).toBe('write')
      expect(write.path).toBe('/test.txt')
      expect(write.data).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('should extract RenameOperation type', () => {
      const rename: OperationByType<'rename'> = {
        type: 'rename',
        oldPath: '/old.txt',
        newPath: '/new.txt',
      }
      expect(rename.type).toBe('rename')
      expect(rename.oldPath).toBe('/old.txt')
      expect(rename.newPath).toBe('/new.txt')
    })

    it('should extract RmOperation type', () => {
      const rm: OperationByType<'rm'> = {
        type: 'rm',
        path: '/file.txt',
        options: { force: true },
      }
      expect(rm.type).toBe('rm')
      expect(rm.path).toBe('/file.txt')
      expect(rm.options?.force).toBe(true)
    })
  })

  describe('Type guard functions for operations', () => {
    // Type guard for WriteOperation
    function isWriteOperation(op: Operation): op is WriteOperation {
      return op.type === 'write'
    }

    // Type guard for RenameOperation
    function isRenameOperation(op: Operation): op is RenameOperation {
      return op.type === 'rename'
    }

    // Type guard for operations with 'path' property
    function hasPath(op: Operation): op is Exclude<Operation, RenameOperation> {
      return 'path' in op
    }

    it('should narrow using isWriteOperation type guard', () => {
      const op: Operation = {
        type: 'write',
        path: '/test.txt',
        data: new Uint8Array([1, 2, 3]),
      }

      if (isWriteOperation(op)) {
        // TypeScript should know op is WriteOperation here
        expect(op.path).toBe('/test.txt')
        expect(op.data).toEqual(new Uint8Array([1, 2, 3]))
      } else {
        throw new Error('Type guard should have returned true')
      }
    })

    it('should narrow using isRenameOperation type guard', () => {
      const op: Operation = {
        type: 'rename',
        oldPath: '/old.txt',
        newPath: '/new.txt',
      }

      if (isRenameOperation(op)) {
        // TypeScript should know op is RenameOperation here
        expect(op.oldPath).toBe('/old.txt')
        expect(op.newPath).toBe('/new.txt')
      } else {
        throw new Error('Type guard should have returned true')
      }
    })

    it('should narrow using hasPath type guard', () => {
      const writeOp: Operation = {
        type: 'write',
        path: '/test.txt',
        data: new Uint8Array([1, 2, 3]),
      }

      const renameOp: Operation = {
        type: 'rename',
        oldPath: '/old.txt',
        newPath: '/new.txt',
      }

      expect(hasPath(writeOp)).toBe(true)
      expect(hasPath(renameOp)).toBe(false)

      if (hasPath(writeOp)) {
        expect(writeOp.path).toBe('/test.txt')
      }
    })
  })

  describe('Transaction.getOperationsByType type safety', () => {
    it('should return properly typed WriteOperation[]', () => {
      const tx = new Transaction()
        .writeFile('/a.txt', new Uint8Array([1, 2, 3]))
        .writeFile('/b.txt', 'hello')

      const writes = tx.getOperationsByType('write')

      // TypeScript should know these are WriteOperation[]
      expect(writes).toHaveLength(2)
      expect(writes[0].path).toBe('/a.txt')
      expect(writes[0].data).toBeInstanceOf(Uint8Array)
      expect(writes[1].path).toBe('/b.txt')
    })

    it('should return properly typed RenameOperation[]', () => {
      const tx = new Transaction()
        .rename('/old1.txt', '/new1.txt')
        .rename('/old2.txt', '/new2.txt', { mkdirp: true })

      const renames = tx.getOperationsByType('rename')

      // TypeScript should know these are RenameOperation[]
      expect(renames).toHaveLength(2)
      expect(renames[0].oldPath).toBe('/old1.txt')
      expect(renames[0].newPath).toBe('/new1.txt')
      expect(renames[1].options?.mkdirp).toBe(true)
    })

    it('should return properly typed MkdirOperation[]', () => {
      const tx = new Transaction()
        .mkdir('/dir1')
        .mkdir('/dir2', { recursive: true })

      const mkdirs = tx.getOperationsByType('mkdir')

      // TypeScript should know these are MkdirOperation[]
      expect(mkdirs).toHaveLength(2)
      expect(mkdirs[0].path).toBe('/dir1')
      expect(mkdirs[1].path).toBe('/dir2')
      expect(mkdirs[1].options?.recursive).toBe(true)
    })

    it('should return properly typed RmOperation[]', () => {
      const tx = new Transaction()
        .rm('/file1.txt')
        .rm('/dir', { recursive: true, force: true })

      const rms = tx.getOperationsByType('rm')

      // TypeScript should know these are RmOperation[]
      expect(rms).toHaveLength(2)
      expect(rms[0].path).toBe('/file1.txt')
      expect(rms[1].path).toBe('/dir')
      expect(rms[1].options?.recursive).toBe(true)
      expect(rms[1].options?.force).toBe(true)
    })
  })

  describe('Exhaustive switch handling', () => {
    /**
     * Helper function that demonstrates exhaustive type checking.
     * The never type in the default case ensures all operation types are handled.
     */
    function getOperationDescription(op: Operation): string {
      switch (op.type) {
        case 'write':
          return `Write ${op.data.length} bytes to ${op.path}`
        case 'delete':
          return `Delete (legacy) ${op.path}`
        case 'unlink':
          return `Unlink ${op.path}`
        case 'rm':
          return `Remove ${op.path}${op.options?.recursive ? ' (recursive)' : ''}`
        case 'rmdir':
          return `Remove directory ${op.path}`
        case 'rename':
          return `Rename ${op.oldPath} to ${op.newPath}`
        case 'mkdir':
          return `Create directory ${op.path}${op.options?.recursive ? ' (recursive)' : ''}`
        default: {
          // This should be unreachable if all cases are handled
          const _exhaustiveCheck: never = op
          return _exhaustiveCheck
        }
      }
    }

    it('should describe write operations', () => {
      const op: Operation = {
        type: 'write',
        path: '/test.txt',
        data: new Uint8Array([1, 2, 3]),
      }
      expect(getOperationDescription(op)).toBe('Write 3 bytes to /test.txt')
    })

    it('should describe delete operations', () => {
      const op: Operation = {
        type: 'delete',
        path: '/test.txt',
      }
      expect(getOperationDescription(op)).toBe('Delete (legacy) /test.txt')
    })

    it('should describe unlink operations', () => {
      const op: Operation = {
        type: 'unlink',
        path: '/test.txt',
      }
      expect(getOperationDescription(op)).toBe('Unlink /test.txt')
    })

    it('should describe rm operations', () => {
      const op: Operation = {
        type: 'rm',
        path: '/dir',
        options: { recursive: true },
      }
      expect(getOperationDescription(op)).toBe('Remove /dir (recursive)')
    })

    it('should describe rmdir operations', () => {
      const op: Operation = {
        type: 'rmdir',
        path: '/dir',
      }
      expect(getOperationDescription(op)).toBe('Remove directory /dir')
    })

    it('should describe rename operations', () => {
      const op: Operation = {
        type: 'rename',
        oldPath: '/old.txt',
        newPath: '/new.txt',
      }
      expect(getOperationDescription(op)).toBe('Rename /old.txt to /new.txt')
    })

    it('should describe mkdir operations', () => {
      const op: Operation = {
        type: 'mkdir',
        path: '/new-dir',
        options: { recursive: true },
      }
      expect(getOperationDescription(op)).toBe('Create directory /new-dir (recursive)')
    })

    it('should handle all operation types from a Transaction', () => {
      const tx = new Transaction()
        .writeFile('/a.txt', new Uint8Array([1, 2, 3]))
        .mkdir('/dir', { recursive: true })
        .rename('/b.txt', '/c.txt')
        .rm('/old.txt', { force: true })
        .rmdir('/empty-dir')
        .unlink('/temp.txt')

      const descriptions = tx.operations.map(getOperationDescription)

      expect(descriptions).toHaveLength(6)
      expect(descriptions[0]).toContain('Write')
      expect(descriptions[1]).toContain('Create directory')
      expect(descriptions[2]).toContain('Rename')
      expect(descriptions[3]).toContain('Remove')
      expect(descriptions[4]).toContain('Remove directory')
      expect(descriptions[5]).toContain('Unlink')
    })
  })

  describe('Path extraction with proper narrowing', () => {
    /**
     * Helper function that extracts the primary path from an operation.
     * Uses proper union narrowing to handle RenameOperation which has oldPath instead of path.
     */
    function getPrimaryPath(op: Operation): string {
      switch (op.type) {
        case 'rename':
          return op.oldPath
        case 'write':
        case 'delete':
        case 'unlink':
        case 'rm':
        case 'rmdir':
        case 'mkdir':
          return op.path
        default: {
          const _exhaustiveCheck: never = op
          return _exhaustiveCheck
        }
      }
    }

    /**
     * Helper function that extracts all paths from an operation.
     * RenameOperation contributes both oldPath and newPath.
     */
    function getAllPaths(op: Operation): string[] {
      switch (op.type) {
        case 'rename':
          return [op.oldPath, op.newPath]
        case 'write':
        case 'delete':
        case 'unlink':
        case 'rm':
        case 'rmdir':
        case 'mkdir':
          return [op.path]
        default: {
          const _exhaustiveCheck: never = op
          return _exhaustiveCheck
        }
      }
    }

    it('should extract primary path from write operation', () => {
      const op: Operation = { type: 'write', path: '/test.txt', data: new Uint8Array([]) }
      expect(getPrimaryPath(op)).toBe('/test.txt')
    })

    it('should extract primary path (oldPath) from rename operation', () => {
      const op: Operation = { type: 'rename', oldPath: '/old.txt', newPath: '/new.txt' }
      expect(getPrimaryPath(op)).toBe('/old.txt')
    })

    it('should extract all paths from rename operation', () => {
      const op: Operation = { type: 'rename', oldPath: '/old.txt', newPath: '/new.txt' }
      expect(getAllPaths(op)).toEqual(['/old.txt', '/new.txt'])
    })

    it('should extract single path from non-rename operations', () => {
      const mkdirOp: Operation = { type: 'mkdir', path: '/dir' }
      expect(getAllPaths(mkdirOp)).toEqual(['/dir'])

      const rmOp: Operation = { type: 'rm', path: '/file.txt' }
      expect(getAllPaths(rmOp)).toEqual(['/file.txt'])
    })
  })

  describe('Safe array iteration with defined checks', () => {
    it('should safely iterate operations with explicit undefined check', () => {
      const tx = new Transaction()
        .writeFile('/a.txt', 'content a')
        .mkdir('/dir')
        .rename('/b.txt', '/c.txt')

      const paths: string[] = []

      for (let i = 0; i < tx.operations.length; i++) {
        const op = tx.operations[i]
        // Explicit undefined check
        if (op === undefined) continue

        switch (op.type) {
          case 'write':
          case 'delete':
          case 'unlink':
          case 'rm':
          case 'rmdir':
          case 'mkdir':
            paths.push(op.path)
            break
          case 'rename':
            paths.push(op.oldPath)
            paths.push(op.newPath)
            break
        }
      }

      expect(paths).toEqual(['/a.txt', '/dir', '/b.txt', '/c.txt'])
    })

    it('should safely iterate using for-of loop', () => {
      const tx = new Transaction()
        .writeFile('/a.txt', 'content')
        .rename('/old.txt', '/new.txt')

      const types: OperationType[] = []

      for (const op of tx.operations) {
        types.push(op.type)
      }

      expect(types).toEqual(['write', 'rename'])
    })
  })
})
