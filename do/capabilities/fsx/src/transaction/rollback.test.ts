/**
 * @fileoverview RED phase tests for transaction rollback behavior
 *
 * Tests for rollback functionality when operations fail mid-transaction.
 * These tests verify that:
 * - Write operations are rolled back (file deleted) on subsequent failure
 * - Delete operations are rolled back (file restored) on subsequent failure
 * - Rename operations are rolled back (reversed) on subsequent failure
 * - Mkdir operations are rolled back (directory removed) on subsequent failure
 * - Filesystem state is unchanged after a failed transaction
 *
 * @module src/transaction/rollback.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Transaction, TransactionStorage } from '../../core/transaction/transaction'

// ============================================================================
// Mock Storage Implementation for Testing Rollback
// ============================================================================

/**
 * Mock storage that tracks all operations for verification.
 * Allows injecting failures at specific points to test rollback behavior.
 */
class MockStorage implements TransactionStorage {
  private files: Map<string, Uint8Array> = new Map()
  private directories: Set<string> = new Set(['/', '/home', '/tmp'])
  public operations: Array<{ type: string; path: string; data?: Uint8Array }> = []

  // Failure injection
  private failAtOperation = -1
  private operationCount = 0
  private failureTriggered = false

  constructor() {
    // Initialize with root directory
    this.directories.add('/')
  }

  setFailAtOperation(n: number): void {
    this.failAtOperation = n
    this.operationCount = 0
    this.failureTriggered = false
  }

  private checkFailure(): void {
    // Once failure has been triggered, don't fail again (allows rollback to proceed)
    if (this.failureTriggered) {
      return
    }
    this.operationCount++
    if (this.failAtOperation >= 0 && this.operationCount > this.failAtOperation) {
      this.failureTriggered = true
      throw new Error(`Injected failure at operation ${this.operationCount}`)
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.checkFailure()
    this.operations.push({ type: 'write', path, data })
    this.files.set(path, data)
  }

  async readFile(path: string): Promise<Uint8Array> {
    const content = this.files.get(path)
    if (!content) {
      throw new Error(`ENOENT: no such file: ${path}`)
    }
    return content
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path)
  }

  async unlink(path: string): Promise<void> {
    this.checkFailure()
    this.operations.push({ type: 'unlink', path })
    this.files.delete(path)
  }

  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    this.checkFailure()
    this.operations.push({ type: 'rm', path })
    if (this.directories.has(path)) {
      this.directories.delete(path)
    } else {
      this.files.delete(path)
    }
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.checkFailure()
    this.operations.push({ type: 'rmdir', path })
    this.directories.delete(path)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.checkFailure()
    this.operations.push({ type: 'rename', path: `${oldPath} -> ${newPath}` })

    const content = this.files.get(oldPath)
    if (content) {
      this.files.set(newPath, content)
      this.files.delete(oldPath)
    } else if (this.directories.has(oldPath)) {
      this.directories.add(newPath)
      this.directories.delete(oldPath)
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    this.checkFailure()
    this.operations.push({ type: 'mkdir', path })
    this.directories.add(path)
  }

  // Test helpers
  hasFile(path: string): boolean {
    return this.files.has(path)
  }

  hasDirectory(path: string): boolean {
    return this.directories.has(path)
  }

  getFileContent(path: string): Uint8Array | undefined {
    return this.files.get(path)
  }

  getFileCount(): number {
    return this.files.size
  }

  getDirectoryCount(): number {
    return this.directories.size
  }

  // Setup helpers
  seedFile(path: string, content: string | Uint8Array): void {
    const data = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content
    this.files.set(path, data)
  }

  seedDirectory(path: string): void {
    this.directories.add(path)
  }

  getSnapshot(): { files: Map<string, Uint8Array>; directories: Set<string> } {
    return {
      files: new Map(this.files),
      directories: new Set(this.directories)
    }
  }

  reset(): void {
    this.files.clear()
    this.directories.clear()
    this.directories.add('/')
    this.directories.add('/home')
    this.directories.add('/tmp')
    this.operations = []
    this.failAtOperation = -1
    this.operationCount = 0
    this.failureTriggered = false
  }
}

// ============================================================================
// Rollback on Failure - Write Operations
// ============================================================================

describe('Rollback on Failure - Write Operations', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should delete newly written file when subsequent operation fails', async () => {
    const tx = new Transaction()
      .writeFile('/file1.txt', new TextEncoder().encode('content1'))
      .writeFile('/file2.txt', new TextEncoder().encode('content2'))

    // Fail on second write
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // First file should be rolled back (deleted)
    expect(storage.hasFile('/file1.txt')).toBe(false)
    expect(storage.hasFile('/file2.txt')).toBe(false)
    expect(tx.status).toBe('rolled_back')
  })

  it('should restore previous content when overwriting existing file fails', async () => {
    // Seed existing file
    const originalContent = 'original content'
    storage.seedFile('/existing.txt', originalContent)

    const tx = new Transaction()
      .writeFile('/existing.txt', new TextEncoder().encode('new content'))
      .writeFile('/another.txt', new TextEncoder().encode('another'))

    // Fail on second write
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Existing file should have original content restored
    const content = storage.getFileContent('/existing.txt')
    expect(content).toBeDefined()
    expect(new TextDecoder().decode(content!)).toBe(originalContent)
    expect(tx.status).toBe('rolled_back')
  })

  it('should rollback multiple writes in reverse order', async () => {
    const tx = new Transaction()
      .writeFile('/a.txt', new TextEncoder().encode('a'))
      .writeFile('/b.txt', new TextEncoder().encode('b'))
      .writeFile('/c.txt', new TextEncoder().encode('c'))

    // Fail on third write
    storage.setFailAtOperation(2)

    await expect(tx.execute(storage)).rejects.toThrow()

    // All files should be rolled back
    expect(storage.hasFile('/a.txt')).toBe(false)
    expect(storage.hasFile('/b.txt')).toBe(false)
    expect(storage.hasFile('/c.txt')).toBe(false)
    expect(tx.status).toBe('rolled_back')
  })

  it('should handle write rollback when storage lacks readFile', async () => {
    // Create storage without readFile (content cannot be preserved)
    const minimalStorage: TransactionStorage = {
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Write failed')),
      rm: vi.fn().mockResolvedValue(undefined),
    }

    const tx = new Transaction()
      .writeFile('/file1.txt', new TextEncoder().encode('content1'))
      .writeFile('/file2.txt', new TextEncoder().encode('content2'))

    await expect(tx.execute(minimalStorage)).rejects.toThrow('Write failed')

    // File should be deleted (rm called during rollback)
    expect(minimalStorage.rm).toHaveBeenCalledWith('/file1.txt')
    expect(tx.status).toBe('rolled_back')
  })
})

// ============================================================================
// Rollback on Failure - Delete Operations
// ============================================================================

describe('Rollback on Failure - Delete Operations', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should restore deleted file when subsequent operation fails', async () => {
    // Seed file to be deleted
    const fileContent = 'important data'
    storage.seedFile('/important.txt', fileContent)

    const tx = new Transaction()
      .unlink('/important.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write (after successful unlink)
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Deleted file should be restored
    expect(storage.hasFile('/important.txt')).toBe(true)
    const restored = storage.getFileContent('/important.txt')
    expect(new TextDecoder().decode(restored!)).toBe(fileContent)
    expect(tx.status).toBe('rolled_back')
  })

  it('should restore file deleted via rm() when subsequent operation fails', async () => {
    const fileContent = 'rm target'
    storage.seedFile('/to-remove.txt', fileContent)

    const tx = new Transaction()
      .rm('/to-remove.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // File should be restored
    expect(storage.hasFile('/to-remove.txt')).toBe(true)
    const restored = storage.getFileContent('/to-remove.txt')
    expect(new TextDecoder().decode(restored!)).toBe(fileContent)
  })

  it('should restore multiple deleted files in reverse order', async () => {
    storage.seedFile('/file1.txt', 'content1')
    storage.seedFile('/file2.txt', 'content2')
    storage.seedFile('/file3.txt', 'content3')

    const tx = new Transaction()
      .unlink('/file1.txt')
      .unlink('/file2.txt')
      .unlink('/file3.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write (after all deletes)
    storage.setFailAtOperation(3)

    await expect(tx.execute(storage)).rejects.toThrow()

    // All files should be restored
    expect(storage.hasFile('/file1.txt')).toBe(true)
    expect(storage.hasFile('/file2.txt')).toBe(true)
    expect(storage.hasFile('/file3.txt')).toBe(true)
  })

  it('should warn when deleted file cannot be restored (no content captured)', async () => {
    // Storage without readFile - cannot capture content before delete
    const deleteStorage: TransactionStorage = {
      writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
      unlink: vi.fn().mockResolvedValue(undefined),
    }

    const tx = new Transaction()
      .unlink('/no-content.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    const warnLogs: string[] = []
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: (msg: string) => warnLogs.push(msg),
      error: vi.fn(),
    }

    await expect(tx.execute(deleteStorage, { logger })).rejects.toThrow('Write failed')

    // Should have logged a warning about unable to restore
    expect(warnLogs.some(msg => msg.includes('Cannot restore') || msg.includes('no content'))).toBe(true)
  })
})

// ============================================================================
// Rollback on Failure - Rename Operations
// ============================================================================

describe('Rollback on Failure - Rename Operations', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should reverse rename when subsequent operation fails', async () => {
    storage.seedFile('/original.txt', 'content')

    const tx = new Transaction()
      .rename('/original.txt', '/renamed.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write (after successful rename)
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // File should be back at original path
    expect(storage.hasFile('/original.txt')).toBe(true)
    expect(storage.hasFile('/renamed.txt')).toBe(false)
    expect(tx.status).toBe('rolled_back')
  })

  it('should reverse move (rename alias) when subsequent operation fails', async () => {
    storage.seedFile('/source/file.txt', 'moved content')
    storage.seedDirectory('/source')
    storage.seedDirectory('/dest')

    const tx = new Transaction()
      .move('/source/file.txt', '/dest/file.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // File should be back at source
    expect(storage.hasFile('/source/file.txt')).toBe(true)
    expect(storage.hasFile('/dest/file.txt')).toBe(false)
  })

  it('should reverse multiple renames in correct order', async () => {
    storage.seedFile('/a.txt', 'a')
    storage.seedFile('/b.txt', 'b')

    const tx = new Transaction()
      .rename('/a.txt', '/a-new.txt')
      .rename('/b.txt', '/b-new.txt')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write
    storage.setFailAtOperation(2)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Both files should be at original paths
    expect(storage.hasFile('/a.txt')).toBe(true)
    expect(storage.hasFile('/a-new.txt')).toBe(false)
    expect(storage.hasFile('/b.txt')).toBe(true)
    expect(storage.hasFile('/b-new.txt')).toBe(false)
  })

  it('should handle directory rename rollback', async () => {
    storage.seedDirectory('/old-dir')
    storage.seedFile('/old-dir/file.txt', 'nested content')

    const tx = new Transaction()
      .rename('/old-dir', '/new-dir')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Directory should be at original path
    expect(storage.hasDirectory('/old-dir')).toBe(true)
    expect(storage.hasDirectory('/new-dir')).toBe(false)
  })
})

// ============================================================================
// Rollback on Failure - Mkdir Operations
// ============================================================================

describe('Rollback on Failure - Mkdir Operations', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should remove created directory when subsequent operation fails', async () => {
    const initialDirCount = storage.getDirectoryCount()

    const tx = new Transaction()
      .mkdir('/new-dir')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write (after successful mkdir)
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Directory should not exist
    expect(storage.hasDirectory('/new-dir')).toBe(false)
    expect(storage.getDirectoryCount()).toBe(initialDirCount)
    expect(tx.status).toBe('rolled_back')
  })

  it('should remove nested directories created with recursive option', async () => {
    const tx = new Transaction()
      .mkdir('/a/b/c', { recursive: true })
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write
    storage.setFailAtOperation(1)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Nested directory should be removed
    expect(storage.hasDirectory('/a/b/c')).toBe(false)
  })

  it('should remove multiple directories in reverse creation order', async () => {
    const tx = new Transaction()
      .mkdir('/dir1')
      .mkdir('/dir2')
      .mkdir('/dir3')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    // Fail on write (after all mkdirs)
    storage.setFailAtOperation(3)

    await expect(tx.execute(storage)).rejects.toThrow()

    // All directories should be removed
    expect(storage.hasDirectory('/dir1')).toBe(false)
    expect(storage.hasDirectory('/dir2')).toBe(false)
    expect(storage.hasDirectory('/dir3')).toBe(false)
  })

  it('should use rmdir for rollback when available', async () => {
    const rmdirMock = vi.fn().mockResolvedValue(undefined)
    const rmMock = vi.fn().mockResolvedValue(undefined)

    const mockStorage: TransactionStorage = {
      writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rmdir: rmdirMock,
      rm: rmMock,
    }

    const tx = new Transaction()
      .mkdir('/new-dir')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    await expect(tx.execute(mockStorage)).rejects.toThrow('Write failed')

    // Should prefer rmdir over rm for directory removal
    expect(rmdirMock).toHaveBeenCalledWith('/new-dir')
    expect(rmMock).not.toHaveBeenCalled()
  })

  it('should fallback to rm for mkdir rollback when rmdir unavailable', async () => {
    const rmMock = vi.fn().mockResolvedValue(undefined)

    const mockStorage: TransactionStorage = {
      writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: rmMock,
      // No rmdir
    }

    const tx = new Transaction()
      .mkdir('/new-dir')
      .writeFile('/fail.txt', new TextEncoder().encode('will fail'))

    await expect(tx.execute(mockStorage)).rejects.toThrow('Write failed')

    // Should use rm as fallback
    expect(rmMock).toHaveBeenCalledWith('/new-dir')
  })
})

// ============================================================================
// State Unchanged After Failed Transaction
// ============================================================================

describe('State Unchanged After Failed Transaction', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('should leave filesystem unchanged after complete rollback', async () => {
    // Setup initial state
    storage.seedFile('/existing1.txt', 'existing1')
    storage.seedFile('/existing2.txt', 'existing2')
    storage.seedDirectory('/existing-dir')

    const snapshot = storage.getSnapshot()

    const tx = new Transaction()
      .writeFile('/new.txt', new TextEncoder().encode('new'))
      .unlink('/existing1.txt')
      .rename('/existing2.txt', '/moved.txt')
      .mkdir('/new-dir')

    // Fail on mkdir (last operation)
    storage.setFailAtOperation(3)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Verify state matches original snapshot
    expect(storage.hasFile('/existing1.txt')).toBe(true)
    expect(storage.hasFile('/existing2.txt')).toBe(true)
    expect(storage.hasFile('/new.txt')).toBe(false)
    expect(storage.hasFile('/moved.txt')).toBe(false)
    expect(storage.hasDirectory('/existing-dir')).toBe(true)
    expect(storage.hasDirectory('/new-dir')).toBe(false)

    // Verify file content is unchanged
    expect(new TextDecoder().decode(storage.getFileContent('/existing1.txt')!)).toBe('existing1')
    expect(new TextDecoder().decode(storage.getFileContent('/existing2.txt')!)).toBe('existing2')
  })

  it('should preserve file counts after failed transaction', async () => {
    storage.seedFile('/a.txt', 'a')
    storage.seedFile('/b.txt', 'b')
    storage.seedFile('/c.txt', 'c')

    const initialFileCount = storage.getFileCount()
    const initialDirCount = storage.getDirectoryCount()

    const tx = new Transaction()
      .writeFile('/new1.txt', new TextEncoder().encode('new1'))
      .writeFile('/new2.txt', new TextEncoder().encode('new2'))
      .unlink('/a.txt')
      .mkdir('/new-dir')

    // Fail on mkdir
    storage.setFailAtOperation(3)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Counts should match original
    expect(storage.getFileCount()).toBe(initialFileCount)
    expect(storage.getDirectoryCount()).toBe(initialDirCount)
  })

  it('should handle mixed operations with partial failures correctly', async () => {
    storage.seedFile('/file.txt', 'original')

    const tx = new Transaction()
      .writeFile('/file.txt', new TextEncoder().encode('modified')) // Overwrite
      .mkdir('/dir1')
      .rename('/file.txt', '/renamed.txt')
      .mkdir('/dir2')
      .writeFile('/new.txt', new TextEncoder().encode('new'))

    // Fail on last write
    storage.setFailAtOperation(4)

    await expect(tx.execute(storage)).rejects.toThrow()

    // Original file should be at original path with original content
    expect(storage.hasFile('/file.txt')).toBe(true)
    expect(new TextDecoder().decode(storage.getFileContent('/file.txt')!)).toBe('original')
    expect(storage.hasFile('/renamed.txt')).toBe(false)
    expect(storage.hasFile('/new.txt')).toBe(false)
    expect(storage.hasDirectory('/dir1')).toBe(false)
    expect(storage.hasDirectory('/dir2')).toBe(false)
  })

  it('should not leave partial state on first operation failure', async () => {
    storage.seedFile('/existing.txt', 'existing')

    const initialFileCount = storage.getFileCount()

    const tx = new Transaction()
      .writeFile('/fail-immediately.txt', new TextEncoder().encode('will fail'))

    // Fail on first operation
    storage.setFailAtOperation(0)

    await expect(tx.execute(storage)).rejects.toThrow()

    // No changes should have occurred
    expect(storage.getFileCount()).toBe(initialFileCount)
    expect(storage.hasFile('/fail-immediately.txt')).toBe(false)
    expect(storage.hasFile('/existing.txt')).toBe(true)
  })

  it('should track rollback summary with correct counts', async () => {
    storage.seedFile('/a.txt', 'a')
    storage.seedFile('/b.txt', 'b')

    const tx = new Transaction()
      .writeFile('/new1.txt', new TextEncoder().encode('new1'))
      .unlink('/a.txt')
      .rename('/b.txt', '/b-renamed.txt')
      .mkdir('/dir')
      .writeFile('/fail.txt', new TextEncoder().encode('fail'))

    // Fail on last write
    storage.setFailAtOperation(4)

    await expect(tx.execute(storage)).rejects.toThrow()

    expect(tx.lastRollbackSummary).toBeDefined()
    expect(tx.lastRollbackSummary!.totalOperations).toBe(4) // 4 completed before failure
    expect(tx.lastRollbackSummary!.successCount + tx.lastRollbackSummary!.failureCount).toBe(4)
  })
})

// ============================================================================
// Rollback Error Handling
// ============================================================================

describe('Rollback Error Handling', () => {
  it('should continue rollback even when some rollback operations fail', async () => {
    const rollbackResults: string[] = []

    const storage: TransactionStorage = {
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined) // First write succeeds
        .mockResolvedValueOnce(undefined) // Second write succeeds
        .mockRejectedValueOnce(new Error('Third write failed')) // Fails
        .mockResolvedValue(undefined), // Rollback writes succeed
      rm: vi.fn()
        .mockRejectedValueOnce(new Error('Rollback rm failed')) // First rollback fails
        .mockImplementation(async (path: string) => {
          rollbackResults.push(`rm:${path}`)
        }),
    }

    const tx = new Transaction()
      .writeFile('/a.txt', new TextEncoder().encode('a'))
      .writeFile('/b.txt', new TextEncoder().encode('b'))
      .writeFile('/c.txt', new TextEncoder().encode('c'))

    await expect(tx.execute(storage)).rejects.toThrow('Third write failed')

    expect(tx.status).toBe('rolled_back')
    expect(tx.lastRollbackSummary).toBeDefined()
    expect(tx.lastRollbackSummary!.failureCount).toBeGreaterThan(0)

    // Should have attempted to rollback both files despite first failure
    expect(storage.rm).toHaveBeenCalledTimes(2)
  })

  it('should report rollback failure in summary', async () => {
    const storage: TransactionStorage = {
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Write failed')),
      rm: vi.fn().mockRejectedValue(new Error('Rollback failed')),
    }

    const tx = new Transaction()
      .writeFile('/a.txt', new TextEncoder().encode('a'))
      .writeFile('/b.txt', new TextEncoder().encode('b'))

    await expect(tx.execute(storage)).rejects.toThrow('Write failed')

    expect(tx.lastRollbackSummary).toBeDefined()
    expect(tx.lastRollbackSummary!.results.some(r => !r.success)).toBe(true)
    expect(tx.lastRollbackSummary!.results.some(r => r.error === 'Rollback failed')).toBe(true)
  })
})

// ============================================================================
// Rmdir Rollback (Cannot Restore)
// ============================================================================

describe('Rmdir Rollback Limitations', () => {
  it('should warn when rmdir cannot be rolled back', async () => {
    const storage: TransactionStorage = {
      writeFile: vi.fn().mockRejectedValue(new Error('Write failed')),
      rmdir: vi.fn().mockResolvedValue(undefined),
    }

    const warnLogs: string[] = []
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: (msg: string) => warnLogs.push(msg),
      error: vi.fn(),
    }

    const tx = new Transaction()
      .rmdir('/some-dir', { recursive: true })
      .writeFile('/fail.txt', new TextEncoder().encode('fail'))

    await expect(tx.execute(storage, { logger })).rejects.toThrow('Write failed')

    // Should have logged warning about inability to restore directory
    expect(warnLogs.some(msg => msg.includes('Cannot restore') && msg.includes('directory'))).toBe(true)
  })
})
