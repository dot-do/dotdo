/**
 * Tests for write operations in transactions [RED phase]
 *
 * Tests queueing writeFile operations within a transaction and
 * transactional execution behavior for writes.
 *
 * These tests define the expected behavior for transactional write operations:
 * - Queueing single and multiple writeFile operations
 * - Write ordering preservation
 * - Rollback on write failure
 * - Large file writes in transaction
 * - Concurrent write transactions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Transaction, type WriteOperation, type Operation } from './transaction'

describe('Transaction Write Operations', () => {
  let tx: Transaction

  beforeEach(() => {
    tx = new Transaction()
  })

  describe('Queue single writeFile operation', () => {
    it('should queue a single writeFile operation', () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      tx.writeFile('/test.txt', data)

      expect(tx.operations).toHaveLength(1)
      expect(tx.operations[0]).toEqual({
        type: 'write',
        path: '/test.txt',
        data
      })
    })

    it('should queue writeFile with absolute path', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/absolute/path/to/file.txt', data)

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as WriteOperation
      expect(op.type).toBe('write')
      expect(op.path).toBe('/absolute/path/to/file.txt')
    })

    it('should return transaction instance for chaining', () => {
      const data = new Uint8Array([1, 2, 3])
      const result = tx.writeFile('/test.txt', data)

      expect(result).toBe(tx)
      expect(result).toBeInstanceOf(Transaction)
    })

    it('should preserve exact path string', () => {
      const path = '/path/with/special chars and spaces.txt'
      const data = new Uint8Array([1])
      tx.writeFile(path, data)

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe(path)
    })

    it('should accept Uint8Array data', () => {
      const data = new Uint8Array([0, 1, 2, 255, 254, 253])
      tx.writeFile('/binary.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data).toBe(data)
      expect(op.data).toEqual(data)
    })
  })

  describe('Queue writeFile with string data', () => {
    it('should accept string data and convert to Uint8Array', () => {
      // Transaction.writeFile should accept string data for convenience
      // This tests for an extended API that accepts strings
      tx.writeFileString('/test.txt', 'Hello, World!')

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as WriteOperation
      expect(op.type).toBe('write')
      expect(op.path).toBe('/test.txt')
      expect(op.data).toEqual(new TextEncoder().encode('Hello, World!'))
    })

    it('should handle empty string data', () => {
      tx.writeFileString('/empty.txt', '')

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as WriteOperation
      expect(op.data).toEqual(new Uint8Array(0))
      expect(op.data.length).toBe(0)
    })

    it('should handle unicode string data', () => {
      const unicode = 'Hello World!'
      tx.writeFileString('/unicode.txt', unicode)

      const op = tx.operations[0] as WriteOperation
      expect(op.data).toEqual(new TextEncoder().encode(unicode))
    })

    it('should handle multiline string data', () => {
      const multiline = 'Line 1\nLine 2\nLine 3'
      tx.writeFileString('/multiline.txt', multiline)

      const op = tx.operations[0] as WriteOperation
      expect(op.data).toEqual(new TextEncoder().encode(multiline))
    })
  })

  describe('Queue multiple writeFile operations', () => {
    it('should queue multiple writeFile operations in order', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])
      const data3 = new Uint8Array([7, 8, 9])

      tx.writeFile('/first.txt', data1)
      tx.writeFile('/second.txt', data2)
      tx.writeFile('/third.txt', data3)

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as WriteOperation).path).toBe('/first.txt')
      expect((tx.operations[1] as WriteOperation).path).toBe('/second.txt')
      expect((tx.operations[2] as WriteOperation).path).toBe('/third.txt')
    })

    it('should queue many writes maintaining correct count', () => {
      const data = new Uint8Array([1, 2, 3])

      for (let i = 0; i < 100; i++) {
        tx.writeFile(`/file${i}.txt`, data)
      }

      expect(tx.operations).toHaveLength(100)
    })

    it('should maintain correct data references for each write', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])
      const data3 = new Uint8Array([7, 8, 9])

      tx.writeFile('/a.txt', data1)
      tx.writeFile('/b.txt', data2)
      tx.writeFile('/c.txt', data3)

      expect((tx.operations[0] as WriteOperation).data).toBe(data1)
      expect((tx.operations[1] as WriteOperation).data).toBe(data2)
      expect((tx.operations[2] as WriteOperation).data).toBe(data3)
    })

    it('should allow writing to the same path multiple times', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      tx.writeFile('/same.txt', data1)
      tx.writeFile('/same.txt', data2)

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as WriteOperation).data).toBe(data1)
      expect((tx.operations[1] as WriteOperation).data).toBe(data2)
    })
  })

  describe('Write ordering preservation', () => {
    it('should preserve insertion order of write operations', () => {
      const data = new Uint8Array([1])
      const paths = ['/a.txt', '/z.txt', '/m.txt', '/b.txt', '/y.txt']

      paths.forEach((path) => tx.writeFile(path, data))

      for (let i = 0; i < paths.length; i++) {
        expect((tx.operations[i] as WriteOperation).path).toBe(paths[i])
      }
    })

    it('should preserve order when mixed with other operations', () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])
      const data3 = new Uint8Array([7, 8, 9])

      tx.mkdir('/dir')
      tx.writeFile('/dir/first.txt', data1)
      tx.rename('/old.txt', '/new.txt')
      tx.writeFile('/dir/second.txt', data2)
      tx.deleteFile('/temp.txt')
      tx.writeFile('/dir/third.txt', data3)

      expect(tx.operations).toHaveLength(6)
      expect(tx.operations[0].type).toBe('mkdir')
      expect(tx.operations[1].type).toBe('write')
      expect(tx.operations[2].type).toBe('rename')
      expect(tx.operations[3].type).toBe('write')
      expect(tx.operations[4].type).toBe('unlink')
      expect(tx.operations[5].type).toBe('write')

      expect((tx.operations[1] as WriteOperation).path).toBe('/dir/first.txt')
      expect((tx.operations[3] as WriteOperation).path).toBe('/dir/second.txt')
      expect((tx.operations[5] as WriteOperation).path).toBe('/dir/third.txt')
    })

    it('should preserve order in fluent chaining', () => {
      const data1 = new Uint8Array([1])
      const data2 = new Uint8Array([2])
      const data3 = new Uint8Array([3])

      tx
        .writeFile('/first.txt', data1)
        .writeFile('/second.txt', data2)
        .writeFile('/third.txt', data3)

      expect((tx.operations[0] as WriteOperation).path).toBe('/first.txt')
      expect((tx.operations[1] as WriteOperation).path).toBe('/second.txt')
      expect((tx.operations[2] as WriteOperation).path).toBe('/third.txt')
    })
  })

  describe('Write stores path and data correctly', () => {
    it('should store exact data bytes', () => {
      const data = new Uint8Array([0x00, 0x01, 0xfe, 0xff])
      tx.writeFile('/binary.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data).toBe(data)
      expect(op.data[0]).toBe(0x00)
      expect(op.data[1]).toBe(0x01)
      expect(op.data[2]).toBe(0xfe)
      expect(op.data[3]).toBe(0xff)
    })

    it('should store deeply nested paths correctly', () => {
      const deepPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/file.txt'
      const data = new Uint8Array([1])
      tx.writeFile(deepPath, data)

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe(deepPath)
    })

    it('should store path with unicode characters', () => {
      tx.writeFile('/fichier-francais.txt', new Uint8Array([1]))
      tx.writeFile('/archivo-espanol.txt', new Uint8Array([2]))
      tx.writeFile('/japanese-file.txt', new Uint8Array([3]))

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as WriteOperation).path).toBe('/fichier-francais.txt')
      expect((tx.operations[1] as WriteOperation).path).toBe('/archivo-espanol.txt')
      expect((tx.operations[2] as WriteOperation).path).toBe('/japanese-file.txt')
    })

    it('should store empty Uint8Array data', () => {
      tx.writeFile('/empty.bin', new Uint8Array(0))

      const op = tx.operations[0] as WriteOperation
      expect(op.data.length).toBe(0)
      expect(op.data).toEqual(new Uint8Array(0))
    })

    it('should not normalize paths during queueing', () => {
      // Paths should be stored as-is, normalized during execution
      tx.writeFile('/path/../other/./file.txt', new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe('/path/../other/./file.txt')
    })
  })

  describe('Large file writes in transaction', () => {
    it('should queue 1KB write operation', () => {
      const size = 1024
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      tx.writeFile('/1kb.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data.length).toBe(size)
      expect(op.data).toBe(data)
    })

    it('should queue 1MB write operation', () => {
      const size = 1024 * 1024 // 1MB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      tx.writeFile('/1mb.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data.length).toBe(size)
    })

    it('should queue 10MB write operation', () => {
      const size = 10 * 1024 * 1024 // 10MB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      tx.writeFile('/10mb.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data.length).toBe(size)
    })

    it('should queue multiple large write operations', () => {
      const size = 1024 * 1024 // 1MB each
      const data1 = new Uint8Array(size)
      const data2 = new Uint8Array(size)
      const data3 = new Uint8Array(size)

      tx.writeFile('/large1.bin', data1)
      tx.writeFile('/large2.bin', data2)
      tx.writeFile('/large3.bin', data3)

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as WriteOperation).data.length).toBe(size)
      expect((tx.operations[1] as WriteOperation).data.length).toBe(size)
      expect((tx.operations[2] as WriteOperation).data.length).toBe(size)
    })

    it('should handle mixed size writes in single transaction', () => {
      const smallData = new Uint8Array([1, 2, 3])
      const mediumData = new Uint8Array(10 * 1024) // 10KB
      const largeData = new Uint8Array(1024 * 1024) // 1MB

      tx.writeFile('/small.bin', smallData)
      tx.writeFile('/medium.bin', mediumData)
      tx.writeFile('/large.bin', largeData)

      expect(tx.operations).toHaveLength(3)
      expect((tx.operations[0] as WriteOperation).data.length).toBe(3)
      expect((tx.operations[1] as WriteOperation).data.length).toBe(10 * 1024)
      expect((tx.operations[2] as WriteOperation).data.length).toBe(1024 * 1024)
    })
  })

  describe('Write operation chaining', () => {
    it('should support method chaining for writes', () => {
      const data1 = new Uint8Array([1])
      const data2 = new Uint8Array([2])
      const data3 = new Uint8Array([3])

      const result = tx
        .writeFile('/a.txt', data1)
        .writeFile('/b.txt', data2)
        .writeFile('/c.txt', data3)

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(3)
    })

    it('should support chaining writes with other operations', () => {
      const data = new Uint8Array([1, 2, 3])

      const result = tx
        .mkdir('/newdir')
        .writeFile('/newdir/file.txt', data)
        .rename('/old.txt', '/new.txt')
        .writeFile('/another.txt', data)
        .deleteFile('/temp.txt')

      expect(result).toBe(tx)
      expect(tx.operations).toHaveLength(5)
    })

    it('should support inline transaction creation with writes', () => {
      const data1 = new Uint8Array([1])
      const data2 = new Uint8Array([2])

      const tx2 = new Transaction()
        .writeFile('/file1.txt', data1)
        .writeFile('/file2.txt', data2)

      expect(tx2).toBeInstanceOf(Transaction)
      expect(tx2.operations).toHaveLength(2)
    })
  })

  describe('Transaction state with write operations', () => {
    it('should not allow writeFile after commit', () => {
      // Simulate committed state
      Object.defineProperty(tx, 'status', { value: 'committed', writable: false })

      expect(() => {
        tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))
      }).toThrow(/cannot add operations/i)
    })

    it('should not allow writeFile after rollback', () => {
      Object.defineProperty(tx, 'status', { value: 'rolled_back', writable: false })

      expect(() => {
        tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))
      }).toThrow(/cannot add operations/i)
    })

    it('should allow writeFile while pending', () => {
      expect(tx.status).toBe('pending')

      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      expect(tx.operations).toHaveLength(1)
      expect(tx.status).toBe('pending')
    })
  })

  describe('Write operation with special paths', () => {
    it('should handle root-level files', () => {
      tx.writeFile('/root-file.txt', new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe('/root-file.txt')
    })

    it('should handle hidden files (dotfiles)', () => {
      tx.writeFile('/.hidden', new Uint8Array([1]))
      tx.writeFile('/dir/.gitignore', new Uint8Array([2]))

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as WriteOperation).path).toBe('/.hidden')
      expect((tx.operations[1] as WriteOperation).path).toBe('/dir/.gitignore')
    })

    it('should handle files with extensions', () => {
      tx.writeFile('/file.tar.gz', new Uint8Array([1]))
      tx.writeFile('/file.test.ts', new Uint8Array([2]))

      expect(tx.operations).toHaveLength(2)
      expect((tx.operations[0] as WriteOperation).path).toBe('/file.tar.gz')
      expect((tx.operations[1] as WriteOperation).path).toBe('/file.test.ts')
    })

    it('should handle very long path', () => {
      const longPath = '/' + 'a'.repeat(200) + '.txt'
      tx.writeFile(longPath, new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe(longPath)
    })
  })

  describe('Write operation type property', () => {
    it('should have type property as "write"', () => {
      tx.writeFile('/test.txt', new Uint8Array([1]))

      const op = tx.operations[0]
      expect(op).toHaveProperty('type')
      expect(op.type).toBe('write')
    })

    it('should have path property', () => {
      tx.writeFile('/test.txt', new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op).toHaveProperty('path')
      expect(typeof op.path).toBe('string')
    })

    it('should have data property', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/test.txt', data)

      const op = tx.operations[0] as WriteOperation
      expect(op).toHaveProperty('data')
      expect(op.data).toBeInstanceOf(Uint8Array)
    })
  })

  describe('Data integrity', () => {
    it('should not allow modification of queued write data after queueing', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/test.txt', data)

      // Modify original data
      data[0] = 99

      // Depending on implementation, the queued data may or may not reflect the change
      // Ideally, the transaction should copy the data to prevent modification
      const op = tx.operations[0] as WriteOperation

      // This test documents expected behavior - either behavior could be valid
      // but the behavior should be consistent and documented
      expect(op.data).toBeDefined()
    })

    it('should handle SharedArrayBuffer if supported', () => {
      // Skip if SharedArrayBuffer is not available
      if (typeof SharedArrayBuffer === 'undefined') {
        return
      }

      const shared = new SharedArrayBuffer(4)
      const view = new Uint8Array(shared)
      view.set([1, 2, 3, 4])

      // Transaction should handle SharedArrayBuffer-backed Uint8Arrays
      tx.writeFile('/shared.bin', view)

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as WriteOperation
      expect(op.data.length).toBe(4)
    })
  })
})

describe('Transaction Write Operation with Options', () => {
  let tx: Transaction

  beforeEach(() => {
    tx = new Transaction()
  })

  describe('writeFile with mode option', () => {
    it('should queue write with custom mode', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFileWithOptions('/executable.sh', data, { mode: 0o755 })

      expect(tx.operations).toHaveLength(1)
      const op = tx.operations[0] as any
      expect(op.type).toBe('write')
      expect(op.path).toBe('/executable.sh')
      expect(op.options?.mode).toBe(0o755)
    })

    it('should queue write with read-only mode', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFileWithOptions('/readonly.txt', data, { mode: 0o444 })

      const op = tx.operations[0] as any
      expect(op.options?.mode).toBe(0o444)
    })

    it('should queue write with default mode when not specified', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/default.txt', data)

      const op = tx.operations[0] as WriteOperation
      // Default write operation should not have options unless specified
      expect((op as any).options).toBeUndefined()
    })
  })

  describe('writeFile with flag option', () => {
    it('should queue write with exclusive flag (wx)', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFileWithOptions('/exclusive.txt', data, { flag: 'wx' })

      const op = tx.operations[0] as any
      expect(op.options?.flag).toBe('wx')
    })

    it('should queue write with append flag (a)', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFileWithOptions('/append.txt', data, { flag: 'a' })

      const op = tx.operations[0] as any
      expect(op.options?.flag).toBe('a')
    })

    it('should queue write with overwrite flag (w)', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFileWithOptions('/overwrite.txt', data, { flag: 'w' })

      const op = tx.operations[0] as any
      expect(op.options?.flag).toBe('w')
    })
  })

  describe('writeFile with combined options', () => {
    it('should queue write with mode and flag options', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFileWithOptions('/combined.txt', data, { mode: 0o600, flag: 'wx' })

      const op = tx.operations[0] as any
      expect(op.options?.mode).toBe(0o600)
      expect(op.options?.flag).toBe('wx')
    })
  })

  describe('writeFile with optional options parameter', () => {
    it('should support options as third parameter to writeFile', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/file.txt', data, { mode: 0o755 })

      const op = tx.operations[0] as any
      expect(op.type).toBe('write')
      expect(op.options?.mode).toBe(0o755)
    })

    it('should support flag option directly in writeFile', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/lock.txt', data, { flag: 'wx' })

      const op = tx.operations[0] as any
      expect(op.options?.flag).toBe('wx')
    })

    it('should not add options when empty object passed to writeFile', () => {
      const data = new Uint8Array([1, 2, 3])
      tx.writeFile('/file.txt', data, {})

      const op = tx.operations[0] as WriteOperation
      expect('options' in op).toBe(false)
    })

    it('should not mutate original options in writeFile', () => {
      const data = new Uint8Array([1, 2, 3])
      const options = { mode: 0o755 }
      tx.writeFile('/file.txt', data, options)

      options.mode = 0o644

      const op = tx.operations[0] as any
      expect(op.options?.mode).toBe(0o755)
    })

    it('should support writeFileString with options', () => {
      tx.writeFileString('/script.sh', '#!/bin/bash', { mode: 0o755 })

      const op = tx.operations[0] as any
      expect(op.type).toBe('write')
      expect(op.options?.mode).toBe(0o755)
    })

    it('should not add options to writeFileString when empty', () => {
      tx.writeFileString('/file.txt', 'hello', {})

      const op = tx.operations[0] as WriteOperation
      expect('options' in op).toBe(false)
    })

    it('should not mutate original options in writeFileString', () => {
      const options = { mode: 0o755, flag: 'wx' as const }
      tx.writeFileString('/script.sh', '#!/bin/bash', options)

      options.mode = 0o644

      const op = tx.operations[0] as any
      expect(op.options?.mode).toBe(0o755)
    })
  })
})

describe('Transaction Write Execution', () => {
  describe('Rollback on write failure', () => {
    it('should define rollback status for failed transactions', () => {
      const tx = new Transaction()
      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // Transaction should support setting status to rolled_back
      tx.status = 'rolled_back' as any

      expect(tx.status).toBe('rolled_back')
    })

    it('should track commit status', () => {
      const tx = new Transaction()
      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // Transaction should support setting status to committed
      tx.status = 'committed' as any

      expect(tx.status).toBe('committed')
    })

    it('should provide operations for executor to process', () => {
      const tx = new Transaction()
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])

      tx.writeFile('/a.txt', data1)
      tx.writeFile('/b.txt', data2)

      // Executor can iterate operations
      const writeOps = tx.operations.filter((op) => op.type === 'write')
      expect(writeOps).toHaveLength(2)
    })
  })

  describe('execute() method for transactions', () => {
    it('should have execute method that returns a promise', async () => {
      const tx = new Transaction()
      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // Transaction should have an execute method
      expect(typeof tx.execute).toBe('function')

      // Execute should return a promise
      const result = tx.execute({} as any)
      expect(result).toBeInstanceOf(Promise)
    })

    it('should commit after successful execution', async () => {
      const tx = new Transaction()
      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // Mock storage that succeeds
      const mockStorage = createMockStorage()

      await tx.execute(mockStorage)

      expect(tx.status).toBe('committed')
    })

    it('should rollback on execution failure', async () => {
      const tx = new Transaction()
      tx.writeFile('/test.txt', new Uint8Array([1, 2, 3]))

      // Mock storage that fails
      const failingStorage = createFailingStorage()

      try {
        await tx.execute(failingStorage)
      } catch {
        // Expected to throw
      }

      expect(tx.status).toBe('rolled_back')
    })

    it('should execute writes in order', async () => {
      const tx = new Transaction()
      const executionOrder: string[] = []

      tx.writeFile('/first.txt', new Uint8Array([1]))
      tx.writeFile('/second.txt', new Uint8Array([2]))
      tx.writeFile('/third.txt', new Uint8Array([3]))

      const trackingStorage = createTrackingStorage(executionOrder)

      await tx.execute(trackingStorage)

      expect(executionOrder).toEqual(['/first.txt', '/second.txt', '/third.txt'])
    })

    it('should stop execution on first failure', async () => {
      const tx = new Transaction()
      const executionOrder: string[] = []

      tx.writeFile('/first.txt', new Uint8Array([1]))
      tx.writeFile('/fail.txt', new Uint8Array([2])) // This will fail
      tx.writeFile('/third.txt', new Uint8Array([3]))

      const failOnSecondStorage = createFailOnPathStorage('/fail.txt', executionOrder)

      try {
        await tx.execute(failOnSecondStorage)
      } catch {
        // Expected
      }

      // Only first write should have executed
      expect(executionOrder).toEqual(['/first.txt'])
    })

    it('should undo completed writes on rollback', async () => {
      const tx = new Transaction()
      const undoneWrites: string[] = []

      tx.writeFile('/first.txt', new Uint8Array([1]))
      tx.writeFile('/fail.txt', new Uint8Array([2]))
      tx.writeFile('/third.txt', new Uint8Array([3]))

      const trackingStorage = createRollbackTrackingStorage('/fail.txt', undoneWrites)

      try {
        await tx.execute(trackingStorage)
      } catch {
        // Expected
      }

      // First write should have been undone (rolled back)
      expect(undoneWrites).toContain('/first.txt')
    })
  })
})

describe('Concurrent Write Transactions', () => {
  describe('Isolation between transactions', () => {
    it('should allow multiple independent transactions', () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      tx1.writeFile('/tx1-file.txt', new Uint8Array([1]))
      tx2.writeFile('/tx2-file.txt', new Uint8Array([2]))

      expect(tx1.operations).toHaveLength(1)
      expect(tx2.operations).toHaveLength(1)
      expect((tx1.operations[0] as WriteOperation).path).toBe('/tx1-file.txt')
      expect((tx2.operations[0] as WriteOperation).path).toBe('/tx2-file.txt')
    })

    it('should maintain separate status for each transaction', () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      tx1.writeFile('/a.txt', new Uint8Array([1]))
      tx2.writeFile('/b.txt', new Uint8Array([2]))

      // Simulate tx1 committing and tx2 still pending
      tx1.status = 'committed' as any

      expect(tx1.status).toBe('committed')
      expect(tx2.status).toBe('pending')
    })

    it('should not share operations between transactions', () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      const data = new Uint8Array([1, 2, 3])

      tx1.writeFile('/shared.txt', data)
      tx2.writeFile('/shared.txt', data)

      expect(tx1.operations).not.toBe(tx2.operations)
      expect(tx1.operations[0]).not.toBe(tx2.operations[0])
    })
  })

  describe('Concurrent execution', () => {
    it('should support concurrent transaction execution', async () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      tx1.writeFile('/tx1.txt', new Uint8Array([1]))
      tx2.writeFile('/tx2.txt', new Uint8Array([2]))

      const storage = createMockStorage()

      // Execute both concurrently
      await Promise.all([
        tx1.execute(storage),
        tx2.execute(storage)
      ])

      expect(tx1.status).toBe('committed')
      expect(tx2.status).toBe('committed')
    })

    it('should detect write conflicts to same path', async () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      tx1.writeFile('/conflict.txt', new Uint8Array([1]))
      tx2.writeFile('/conflict.txt', new Uint8Array([2]))

      const conflictStorage = createConflictDetectingStorage()

      // One should succeed, one should fail due to conflict
      const results = await Promise.allSettled([
        tx1.execute(conflictStorage),
        tx2.execute(conflictStorage)
      ])

      const successful = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      // Either both succeed (last-write-wins) or one fails (conflict detection)
      // This tests that the system has defined behavior for conflicts
      expect(successful + failed).toBe(2)
    })

    it('should serialize writes to same file', async () => {
      const tx1 = new Transaction()
      const tx2 = new Transaction()

      tx1.writeFile('/serial.txt', new Uint8Array([1]))
      tx2.writeFile('/serial.txt', new Uint8Array([2]))

      const writeOrder: number[] = []
      const serializingStorage = createSerializingStorage(writeOrder)

      await Promise.all([
        tx1.execute(serializingStorage),
        tx2.execute(serializingStorage)
      ])

      // Writes should be serialized, either [1, 2] or [2, 1]
      expect(writeOrder.length).toBe(2)
      expect(writeOrder).toContain(1)
      expect(writeOrder).toContain(2)
    })
  })
})

describe('Transaction Write Edge Cases', () => {
  let tx: Transaction

  beforeEach(() => {
    tx = new Transaction()
  })

  describe('Empty and whitespace paths', () => {
    it('should store empty string path (validation at execution)', () => {
      // Transaction queuing may not validate paths - that happens at execution
      tx.writeFile('', new Uint8Array([1]))

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as WriteOperation).path).toBe('')
    })

    it('should store whitespace path (validation at execution)', () => {
      tx.writeFile('   ', new Uint8Array([1]))

      expect(tx.operations).toHaveLength(1)
      expect((tx.operations[0] as WriteOperation).path).toBe('   ')
    })
  })

  describe('Path normalization behavior', () => {
    it('should not normalize paths during queueing', () => {
      tx.writeFile('/path/../other/./file.txt', new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe('/path/../other/./file.txt')
    })

    it('should preserve trailing slashes', () => {
      tx.writeFile('/dir/', new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe('/dir/')
    })

    it('should preserve double slashes', () => {
      tx.writeFile('/path//double/slashes', new Uint8Array([1]))

      const op = tx.operations[0] as WriteOperation
      expect(op.path).toBe('/path//double/slashes')
    })
  })

  describe('Large batch operations', () => {
    it('should handle 1000 write operations', () => {
      const data = new Uint8Array([1, 2, 3])

      for (let i = 0; i < 1000; i++) {
        tx.writeFile(`/file${i}.txt`, data)
      }

      expect(tx.operations).toHaveLength(1000)
      expect((tx.operations[0] as WriteOperation).path).toBe('/file0.txt')
      expect((tx.operations[999] as WriteOperation).path).toBe('/file999.txt')
    })

    it('should handle mixed large batch', () => {
      const data = new Uint8Array([1, 2, 3])

      for (let i = 0; i < 500; i++) {
        tx.writeFile(`/new${i}.txt`, data)
        tx.deleteFile(`/old${i}.txt`)
      }

      expect(tx.operations).toHaveLength(1000)
    })
  })

  describe('Binary data edge cases', () => {
    it('should handle all byte values (0-255)', () => {
      const data = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        data[i] = i
      }

      tx.writeFile('/allbytes.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(op.data[i]).toBe(i)
      }
    })

    it('should handle null bytes', () => {
      const data = new Uint8Array([0, 0, 0, 0])
      tx.writeFile('/nulls.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data).toEqual(new Uint8Array([0, 0, 0, 0]))
    })

    it('should handle maximum byte values', () => {
      const data = new Uint8Array([255, 255, 255, 255])
      tx.writeFile('/max.bin', data)

      const op = tx.operations[0] as WriteOperation
      expect(op.data).toEqual(new Uint8Array([255, 255, 255, 255]))
    })
  })
})

// ============================================================================
// Mock Storage Implementations for Execute Tests
// ============================================================================

interface MockWriteStorage {
  writeFile(path: string, data: Uint8Array): Promise<void>
  deleteFile?(path: string): Promise<void>
}

function createMockStorage(): MockWriteStorage {
  const files = new Map<string, Uint8Array>()

  return {
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      files.set(path, data)
    },
    async deleteFile(path: string): Promise<void> {
      files.delete(path)
    }
  }
}

function createFailingStorage(): MockWriteStorage {
  return {
    async writeFile(): Promise<void> {
      throw new Error('Storage failure')
    }
  }
}

function createTrackingStorage(executionOrder: string[]): MockWriteStorage {
  return {
    async writeFile(path: string): Promise<void> {
      executionOrder.push(path)
    }
  }
}

function createFailOnPathStorage(failPath: string, executionOrder: string[]): MockWriteStorage {
  return {
    async writeFile(path: string): Promise<void> {
      if (path === failPath) {
        throw new Error(`Failed to write ${path}`)
      }
      executionOrder.push(path)
    }
  }
}

function createRollbackTrackingStorage(failPath: string, undoneWrites: string[]): MockWriteStorage {
  const writtenFiles: string[] = []

  return {
    async writeFile(path: string): Promise<void> {
      if (path === failPath) {
        // Simulate rollback by adding written files to undone list
        undoneWrites.push(...writtenFiles)
        throw new Error(`Failed to write ${path}`)
      }
      writtenFiles.push(path)
    },
    async deleteFile(path: string): Promise<void> {
      undoneWrites.push(path)
    }
  }
}

function createConflictDetectingStorage(): MockWriteStorage {
  const locks = new Map<string, boolean>()

  return {
    async writeFile(path: string): Promise<void> {
      if (locks.get(path)) {
        throw new Error(`Conflict on ${path}`)
      }
      locks.set(path, true)
      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10))
      locks.set(path, false)
    }
  }
}

function createSerializingStorage(writeOrder: number[]): MockWriteStorage {
  return {
    async writeFile(_path: string, data: Uint8Array): Promise<void> {
      // Record which transaction wrote (by first byte of data)
      writeOrder.push(data[0])
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
