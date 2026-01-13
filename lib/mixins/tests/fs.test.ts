/**
 * @fileoverview Tests for withFs Mixin - Filesystem Capability for DO Classes
 *
 * Tests verify:
 * - withFs mixin adds $.fs to class
 * - FsCapability operations (read, write, exists, delete, list, mkdir, stat, copy, move)
 * - Path normalization
 * - Error handling (ENOENT, EISDIR, ENOTDIR, etc.)
 * - Directory operations and recursive mkdir
 * - File content storage and retrieval
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../../../objects/DO'
import {
  withFs,
  type FsCapability,
  type FsEntry,
  type FsStat,
  type WithFsContext,
} from '../fs'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock DurableObjectStorage for testing
 * Implements the KV-like API used by the fs capability
 */
class MockStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  // Test helpers
  _clear(): void {
    this.data.clear()
  }

  _size(): number {
    return this.data.size
  }

  _keys(): string[] {
    return Array.from(this.data.keys())
  }
}

/**
 * Mock DurableObjectState for testing DO classes
 */
function createMockState(): DurableObjectState {
  const storage = new MockStorage()
  return {
    id: { toString: () => 'test-do-id' },
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

/**
 * Mock Env for testing
 */
function createMockEnv(): Env {
  return {
    DO: {
      idFromName: (name: string) => ({ toString: () => `id-${name}` }),
      get: () => ({ fetch: async () => new Response('OK') }),
    },
  } as unknown as Env
}

// ============================================================================
// Test Suites
// ============================================================================

describe('withFs Mixin', () => {
  let mockState: DurableObjectState
  let mockEnv: Env

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('Basic Mixin Application', () => {
    it('should extend DO class with $.fs capability', () => {
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      expect(instance.$).toBeDefined()
      expect(instance.$.fs).toBeDefined()
    })

    it('should have fs capability in static capabilities array', () => {
      class TestDO extends withFs(DO) {}

      expect((TestDO as unknown as { capabilities: string[] }).capabilities).toContain('fs')
    })

    it('should report hasCapability correctly for fs', () => {
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      expect(instance.hasCapability('fs')).toBe(true)
    })

    it('should preserve base DO workflow context methods', () => {
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      expect(typeof instance.$.send).toBe('function')
      expect(typeof instance.$.try).toBe('function')
      expect(typeof instance.$.do).toBe('function')
    })
  })

  describe('FsCapability Interface', () => {
    it('should expose all required methods', () => {
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)
      const fs = instance.$.fs

      expect(typeof fs.read).toBe('function')
      expect(typeof fs.write).toBe('function')
      expect(typeof fs.exists).toBe('function')
      expect(typeof fs.delete).toBe('function')
      expect(typeof fs.list).toBe('function')
      expect(typeof fs.mkdir).toBe('function')
      expect(typeof fs.stat).toBe('function')
      expect(typeof fs.copy).toBe('function')
      expect(typeof fs.move).toBe('function')
    })
  })
})

describe('FsCapability Operations', () => {
  let instance: InstanceType<ReturnType<typeof withFs>>

  beforeEach(() => {
    const mockState = createMockState()
    const mockEnv = createMockEnv()
    class TestDO extends withFs(DO) {}
    instance = new TestDO(mockState, mockEnv)
  })

  describe('write() and read()', () => {
    it('should write and read a file in root directory', async () => {
      const fs = instance.$.fs

      await fs.write('/test.txt', 'Hello, World!')
      const content = await fs.read('/test.txt')

      expect(content).toBe('Hello, World!')
    })

    it('should write and read a file without leading slash', async () => {
      const fs = instance.$.fs

      await fs.write('test.txt', 'Hello!')
      const content = await fs.read('test.txt')

      expect(content).toBe('Hello!')
    })

    it('should overwrite existing file content', async () => {
      const fs = instance.$.fs

      await fs.write('/test.txt', 'First content')
      await fs.write('/test.txt', 'Second content')
      const content = await fs.read('/test.txt')

      expect(content).toBe('Second content')
    })

    it('should preserve createdAt when overwriting', async () => {
      const fs = instance.$.fs

      await fs.write('/test.txt', 'First')
      const stat1 = await fs.stat('/test.txt')

      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10))

      await fs.write('/test.txt', 'Second')
      const stat2 = await fs.stat('/test.txt')

      expect(stat2.createdAt.getTime()).toBe(stat1.createdAt.getTime())
      expect(stat2.modifiedAt.getTime()).toBeGreaterThan(stat1.createdAt.getTime())
    })

    it('should throw ENOENT when reading non-existent file', async () => {
      const fs = instance.$.fs

      await expect(fs.read('/nonexistent.txt')).rejects.toThrow('ENOENT')
    })

    it('should throw EISDIR when reading a directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/testdir')
      await expect(fs.read('/testdir')).rejects.toThrow('EISDIR')
    })

    it('should throw ENOENT when writing to non-existent parent directory', async () => {
      const fs = instance.$.fs

      await expect(fs.write('/nonexistent/file.txt', 'content')).rejects.toThrow('ENOENT')
    })

    it('should throw ENOTDIR when writing through a file path', async () => {
      const fs = instance.$.fs

      await fs.write('/file.txt', 'content')
      await expect(fs.write('/file.txt/nested.txt', 'content')).rejects.toThrow('ENOTDIR')
    })

    it('should throw EISDIR when trying to write to a directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/testdir')
      await expect(fs.write('/testdir', 'content')).rejects.toThrow('EISDIR')
    })
  })

  describe('exists()', () => {
    it('should return false for non-existent path', async () => {
      const fs = instance.$.fs

      const exists = await fs.exists('/nonexistent')
      expect(exists).toBe(false)
    })

    it('should return true for existing file', async () => {
      const fs = instance.$.fs

      await fs.write('/test.txt', 'content')
      const exists = await fs.exists('/test.txt')

      expect(exists).toBe(true)
    })

    it('should return true for existing directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/testdir')
      const exists = await fs.exists('/testdir')

      expect(exists).toBe(true)
    })
  })

  describe('delete()', () => {
    it('should delete a file', async () => {
      const fs = instance.$.fs

      await fs.write('/test.txt', 'content')
      await fs.delete('/test.txt')

      const exists = await fs.exists('/test.txt')
      expect(exists).toBe(false)
    })

    it('should delete an empty directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/emptydir')
      await fs.delete('/emptydir')

      const exists = await fs.exists('/emptydir')
      expect(exists).toBe(false)
    })

    it('should throw ENOENT when deleting non-existent path', async () => {
      const fs = instance.$.fs

      await expect(fs.delete('/nonexistent')).rejects.toThrow('ENOENT')
    })

    it('should throw ENOTEMPTY when deleting non-empty directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/testdir')
      await fs.write('/testdir/file.txt', 'content')

      await expect(fs.delete('/testdir')).rejects.toThrow('ENOTEMPTY')
    })
  })

  describe('mkdir()', () => {
    it('should create a directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/newdir')
      const exists = await fs.exists('/newdir')

      expect(exists).toBe(true)
    })

    it('should succeed if directory already exists', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/testdir')
      await fs.mkdir('/testdir')

      const exists = await fs.exists('/testdir')
      expect(exists).toBe(true)
    })

    it('should throw EEXIST when path is a file', async () => {
      const fs = instance.$.fs

      await fs.write('/file.txt', 'content')
      await expect(fs.mkdir('/file.txt')).rejects.toThrow('EEXIST')
    })

    it('should throw ENOENT without recursive when parent does not exist', async () => {
      const fs = instance.$.fs

      await expect(fs.mkdir('/parent/child')).rejects.toThrow('ENOENT')
    })

    it('should create parent directories with recursive option', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/a/b/c', { recursive: true })

      expect(await fs.exists('/a')).toBe(true)
      expect(await fs.exists('/a/b')).toBe(true)
      expect(await fs.exists('/a/b/c')).toBe(true)
    })

    it('should mark root as existing', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/')
      // Should not throw - root always conceptually exists
    })
  })

  describe('list()', () => {
    it('should list files in root directory', async () => {
      const fs = instance.$.fs

      await fs.write('/file1.txt', 'content1')
      await fs.write('/file2.txt', 'content2')

      const entries = await fs.list('/')

      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.name).sort()).toEqual(['file1.txt', 'file2.txt'])
    })

    it('should list files in subdirectory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/subdir')
      await fs.write('/subdir/file.txt', 'content')

      const entries = await fs.list('/subdir')

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('file.txt')
      expect(entries[0].isDirectory).toBe(false)
    })

    it('should list directories', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/dir1')
      await fs.mkdir('/dir2')

      const entries = await fs.list('/')

      expect(entries).toHaveLength(2)
      expect(entries.every(e => e.isDirectory)).toBe(true)
    })

    it('should list mixed files and directories', async () => {
      const fs = instance.$.fs

      await fs.write('/file.txt', 'content')
      await fs.mkdir('/subdir')

      const entries = await fs.list('/')

      expect(entries).toHaveLength(2)
      const file = entries.find(e => e.name === 'file.txt')
      const dir = entries.find(e => e.name === 'subdir')

      expect(file?.isDirectory).toBe(false)
      expect(dir?.isDirectory).toBe(true)
    })

    it('should return empty array for empty directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/emptydir')
      const entries = await fs.list('/emptydir')

      expect(entries).toHaveLength(0)
    })

    it('should throw ENOENT for non-existent directory', async () => {
      const fs = instance.$.fs

      await expect(fs.list('/nonexistent')).rejects.toThrow('ENOENT')
    })

    it('should throw ENOTDIR when listing a file', async () => {
      const fs = instance.$.fs

      await fs.write('/file.txt', 'content')
      await expect(fs.list('/file.txt')).rejects.toThrow('ENOTDIR')
    })

    it('should apply filter option', async () => {
      const fs = instance.$.fs

      await fs.write('/file1.txt', 'content')
      await fs.write('/file2.txt', 'content')
      await fs.mkdir('/subdir')

      const entries = await fs.list('/', {
        filter: (entry) => !entry.isDirectory,
      })

      expect(entries).toHaveLength(2)
      expect(entries.every(e => !e.isDirectory)).toBe(true)
    })

    it('should only list immediate children, not nested', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/parent')
      await fs.mkdir('/parent/child')
      await fs.write('/parent/child/nested.txt', 'content')
      await fs.write('/parent/file.txt', 'content')

      const entries = await fs.list('/parent')

      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.name).sort()).toEqual(['child', 'file.txt'])
    })
  })

  describe('stat()', () => {
    it('should return stat for a file', async () => {
      const fs = instance.$.fs

      await fs.write('/test.txt', 'Hello!')
      const stat = await fs.stat('/test.txt')

      expect(stat.isFile).toBe(true)
      expect(stat.isDirectory).toBe(false)
      expect(stat.size).toBe(6) // 'Hello!' is 6 characters
      expect(stat.createdAt).toBeInstanceOf(Date)
      expect(stat.modifiedAt).toBeInstanceOf(Date)
    })

    it('should return stat for a directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/testdir')
      const stat = await fs.stat('/testdir')

      expect(stat.isFile).toBe(false)
      expect(stat.isDirectory).toBe(true)
      expect(stat.size).toBe(0)
    })

    it('should throw ENOENT for non-existent path', async () => {
      const fs = instance.$.fs

      await expect(fs.stat('/nonexistent')).rejects.toThrow('ENOENT')
    })
  })

  describe('copy()', () => {
    it('should copy a file', async () => {
      const fs = instance.$.fs

      await fs.write('/source.txt', 'Original content')
      await fs.copy('/source.txt', '/dest.txt')

      const content = await fs.read('/dest.txt')
      expect(content).toBe('Original content')

      // Source should still exist
      const sourceContent = await fs.read('/source.txt')
      expect(sourceContent).toBe('Original content')
    })

    it('should copy to subdirectory', async () => {
      const fs = instance.$.fs

      await fs.write('/source.txt', 'content')
      await fs.mkdir('/subdir')
      await fs.copy('/source.txt', '/subdir/dest.txt')

      const content = await fs.read('/subdir/dest.txt')
      expect(content).toBe('content')
    })

    it('should throw ENOENT when source does not exist', async () => {
      const fs = instance.$.fs

      await expect(fs.copy('/nonexistent.txt', '/dest.txt')).rejects.toThrow('ENOENT')
    })

    it('should throw EISDIR when copying a directory', async () => {
      const fs = instance.$.fs

      await fs.mkdir('/sourcedir')
      await expect(fs.copy('/sourcedir', '/destdir')).rejects.toThrow('EISDIR')
    })

    it('should throw ENOENT when destination parent does not exist', async () => {
      const fs = instance.$.fs

      await fs.write('/source.txt', 'content')
      await expect(fs.copy('/source.txt', '/nonexistent/dest.txt')).rejects.toThrow('ENOENT')
    })
  })

  describe('move()', () => {
    it('should move a file', async () => {
      const fs = instance.$.fs

      await fs.write('/source.txt', 'content')
      await fs.move('/source.txt', '/dest.txt')

      const content = await fs.read('/dest.txt')
      expect(content).toBe('content')

      const sourceExists = await fs.exists('/source.txt')
      expect(sourceExists).toBe(false)
    })

    it('should move to subdirectory', async () => {
      const fs = instance.$.fs

      await fs.write('/source.txt', 'content')
      await fs.mkdir('/subdir')
      await fs.move('/source.txt', '/subdir/dest.txt')

      const content = await fs.read('/subdir/dest.txt')
      expect(content).toBe('content')

      const sourceExists = await fs.exists('/source.txt')
      expect(sourceExists).toBe(false)
    })

    it('should throw ENOENT when source does not exist', async () => {
      const fs = instance.$.fs

      await expect(fs.move('/nonexistent.txt', '/dest.txt')).rejects.toThrow('ENOENT')
    })
  })
})

describe('Path Normalization', () => {
  let instance: InstanceType<ReturnType<typeof withFs>>

  beforeEach(() => {
    const mockState = createMockState()
    const mockEnv = createMockEnv()
    class TestDO extends withFs(DO) {}
    instance = new TestDO(mockState, mockEnv)
  })

  it('should normalize paths without leading slash', async () => {
    const fs = instance.$.fs

    await fs.write('test.txt', 'content')
    const content = await fs.read('/test.txt')

    expect(content).toBe('content')
  })

  it('should normalize paths with trailing slash', async () => {
    const fs = instance.$.fs

    await fs.mkdir('/testdir/')
    const exists = await fs.exists('/testdir')

    expect(exists).toBe(true)
  })

  it('should normalize paths with double slashes', async () => {
    const fs = instance.$.fs

    await fs.write('//test.txt', 'content')
    const content = await fs.read('/test.txt')

    expect(content).toBe('content')
  })

  it('should handle paths consistently across operations', async () => {
    const fs = instance.$.fs

    await fs.mkdir('subdir/')
    await fs.write('subdir//file.txt', 'content')
    const entries = await fs.list('/subdir')

    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('file.txt')
  })
})

describe('Edge Cases', () => {
  let instance: InstanceType<ReturnType<typeof withFs>>

  beforeEach(() => {
    const mockState = createMockState()
    const mockEnv = createMockEnv()
    class TestDO extends withFs(DO) {}
    instance = new TestDO(mockState, mockEnv)
  })

  it('should handle empty file content', async () => {
    const fs = instance.$.fs

    await fs.write('/empty.txt', '')
    const content = await fs.read('/empty.txt')

    expect(content).toBe('')
  })

  it('should handle large file content', async () => {
    const fs = instance.$.fs
    const largeContent = 'x'.repeat(1_000_000)

    await fs.write('/large.txt', largeContent)
    const content = await fs.read('/large.txt')

    expect(content).toBe(largeContent)
    expect(content.length).toBe(1_000_000)
  })

  it('should handle special characters in file names', async () => {
    const fs = instance.$.fs

    await fs.write('/file with spaces.txt', 'content')
    await fs.write('/file-with-dashes.txt', 'content')
    await fs.write('/file_with_underscores.txt', 'content')

    expect(await fs.exists('/file with spaces.txt')).toBe(true)
    expect(await fs.exists('/file-with-dashes.txt')).toBe(true)
    expect(await fs.exists('/file_with_underscores.txt')).toBe(true)
  })

  it('should handle unicode in file content', async () => {
    const fs = instance.$.fs
    const unicodeContent = 'Hello, 世界! 🌍 Привет мир!'

    await fs.write('/unicode.txt', unicodeContent)
    const content = await fs.read('/unicode.txt')

    expect(content).toBe(unicodeContent)
  })

  it('should handle deeply nested directories', async () => {
    const fs = instance.$.fs

    await fs.mkdir('/a/b/c/d/e', { recursive: true })
    await fs.write('/a/b/c/d/e/file.txt', 'deep')

    const content = await fs.read('/a/b/c/d/e/file.txt')
    expect(content).toBe('deep')
  })
})

describe('Type Exports', () => {
  it('should export FsCapability type', () => {
    // Type-only test - if this compiles, the types are exported correctly
    const _capability: FsCapability = {} as FsCapability
    expect(true).toBe(true)
  })

  it('should export FsEntry type', () => {
    const _entry: FsEntry = { name: 'test', isDirectory: false }
    expect(_entry).toBeDefined()
  })

  it('should export FsStat type', () => {
    const _stat: FsStat = {
      size: 0,
      isFile: true,
      isDirectory: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    expect(_stat).toBeDefined()
  })

  it('should export WithFsContext type', () => {
    const _context: WithFsContext = {} as WithFsContext
    expect(_context).toBeDefined()
  })
})

describe('Lazy Initialization', () => {
  it('should lazily initialize FsCapability on first access', () => {
    const mockState = createMockState()
    const mockEnv = createMockEnv()
    class TestDO extends withFs(DO) {}
    const instance = new TestDO(mockState, mockEnv)

    // First access
    const fs1 = instance.$.fs
    // Second access
    const fs2 = instance.$.fs

    // Should return the same cached instance
    expect(fs1).toBe(fs2)
  })
})
