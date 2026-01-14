import { describe, it, expect } from 'vitest'
import { truncate } from './truncate'
import { ENOENT, EISDIR, EINVAL } from '../errors'

/**
 * Tests for truncate operation
 *
 * The truncate function should:
 * - Truncate file to smaller size
 * - Truncate file to 0 (empty)
 * - Extend file with zero-fill when truncating to larger size
 * - Throw ENOENT if file does not exist
 * - Throw EISDIR if path is a directory
 * - Throw EINVAL for negative length
 * - Return undefined on success
 */

describe('truncate', () => {
  describe('truncate to smaller size', () => {
    it('should truncate file to smaller size', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/file.txt'
      const originalContent = new TextEncoder().encode('Hello, World!')
      mockStorage.addFile(path, originalContent)

      await truncate(mockStorage, path, 5)

      const result = mockStorage.getFile(path)
      expect(result).toBeDefined()
      expect(result?.content).toEqual(new TextEncoder().encode('Hello'))
      expect(result?.content.length).toBe(5)
    })

    it('should truncate large file to 1 byte', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/large.bin'
      const largeContent = new Uint8Array(10000).fill(0x41)
      mockStorage.addFile(path, largeContent)

      await truncate(mockStorage, path, 1)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(1)
      expect(result?.content[0]).toBe(0x41)
    })

    it('should truncate to half of original size', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/half.bin'
      const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path, 4)

      const result = mockStorage.getFile(path)
      expect(result?.content).toEqual(new Uint8Array([1, 2, 3, 4]))
    })
  })

  describe('truncate to zero (empty)', () => {
    it('should truncate file to 0 bytes', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/empty.txt'
      const content = new TextEncoder().encode('Content to be removed')
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path, 0)

      const result = mockStorage.getFile(path)
      expect(result).toBeDefined()
      expect(result?.content.length).toBe(0)
    })

    it('should truncate file with default length (0)', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/defaultzero.txt'
      const content = new TextEncoder().encode('Content')
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(0)
    })

    it('should truncate already empty file to 0 (no-op)', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/alreadyempty.txt'
      mockStorage.addFile(path, new Uint8Array([]))

      await truncate(mockStorage, path, 0)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(0)
    })
  })

  describe('truncate to larger size (zero-fill)', () => {
    it('should extend file with zero bytes', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/extend.bin'
      const content = new Uint8Array([1, 2, 3])
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path, 6)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(6)
      expect(result?.content).toEqual(new Uint8Array([1, 2, 3, 0, 0, 0]))
    })

    it('should extend empty file with zero bytes', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/extendempty.bin'
      mockStorage.addFile(path, new Uint8Array([]))

      await truncate(mockStorage, path, 5)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(5)
      expect(result?.content).toEqual(new Uint8Array([0, 0, 0, 0, 0]))
    })

    it('should extend file to large size', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/extendlarge.bin'
      const content = new Uint8Array([0x48, 0x69]) // "Hi"
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path, 1000)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(1000)
      expect(result?.content[0]).toBe(0x48)
      expect(result?.content[1]).toBe(0x69)
      // All extended bytes should be zero
      for (let i = 2; i < 1000; i++) {
        expect(result?.content[i]).toBe(0)
      }
    })
  })

  describe('truncate to same size (no-op)', () => {
    it('should leave file unchanged when truncating to same size', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/samesize.txt'
      const content = new TextEncoder().encode('Hello')
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path, 5)

      const result = mockStorage.getFile(path)
      expect(result?.content).toEqual(content)
    })

    it('should leave empty file unchanged when truncating to 0', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/samesizeempty.txt'
      mockStorage.addFile(path, new Uint8Array([]))

      await truncate(mockStorage, path, 0)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(0)
    })
  })

  describe('error - ENOENT', () => {
    it('should throw ENOENT when file does not exist', async () => {
      const mockStorage = createMockStorage()

      await expect(truncate(mockStorage, '/nonexistent/file.txt', 0))
        .rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT with correct syscall and path', async () => {
      const mockStorage = createMockStorage()
      const path = '/nonexistent/file.txt'

      try {
        await truncate(mockStorage, path, 0)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('truncate')
        expect((error as ENOENT).path).toBe(path)
      }
    })

    it('should throw ENOENT for deeply nested nonexistent path', async () => {
      const mockStorage = createMockStorage()

      await expect(truncate(mockStorage, '/a/b/c/d/e/file.txt', 0))
        .rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when parent directory does not exist', async () => {
      const mockStorage = createMockStorage()

      await expect(truncate(mockStorage, '/nonexistent/dir/file.txt', 10))
        .rejects.toThrow(ENOENT)
    })
  })

  describe('error - EISDIR', () => {
    it('should throw EISDIR when path is a directory', async () => {
      const mockStorage = createMockStorage()
      mockStorage.addDirectory('/test/mydir')

      await expect(truncate(mockStorage, '/test/mydir', 0))
        .rejects.toThrow(EISDIR)
    })

    it('should throw EISDIR with correct syscall and path', async () => {
      const mockStorage = createMockStorage()
      mockStorage.addDirectory('/test/mydir')
      const path = '/test/mydir'

      try {
        await truncate(mockStorage, path, 0)
        expect.fail('Should have thrown EISDIR')
      } catch (error) {
        expect(error).toBeInstanceOf(EISDIR)
        expect((error as EISDIR).syscall).toBe('truncate')
        expect((error as EISDIR).path).toBe(path)
      }
    })

    it('should throw EISDIR for root directory', async () => {
      const mockStorage = createMockStorage()

      await expect(truncate(mockStorage, '/', 0))
        .rejects.toThrow(EISDIR)
    })
  })

  describe('error - EINVAL', () => {
    it('should throw EINVAL for negative length', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/file.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'))

      await expect(truncate(mockStorage, path, -1))
        .rejects.toThrow(EINVAL)
    })

    it('should throw EINVAL for negative length with correct details', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/file.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'))

      try {
        await truncate(mockStorage, path, -100)
        expect.fail('Should have thrown EINVAL')
      } catch (error) {
        expect(error).toBeInstanceOf(EINVAL)
        expect((error as EINVAL).syscall).toBe('truncate')
        expect((error as EINVAL).path).toBe(path)
      }
    })

    it('should accept length of 0 (not negative)', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/file.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'))

      await expect(truncate(mockStorage, path, 0)).resolves.toBeUndefined()
    })
  })

  describe('file metadata preservation', () => {
    it('should update modification time after truncate', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/mtime.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'))
      const originalMtime = mockStorage.getFile(path)?.metadata.mtime

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10))

      await truncate(mockStorage, path, 3)

      const result = mockStorage.getFile(path)
      expect(result?.metadata.mtime).toBeGreaterThan(originalMtime!)
    })

    it('should preserve birthtime after truncate', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/birthtime.txt'
      const originalBirthtime = Date.now() - 10000
      mockStorage.addFile(path, new TextEncoder().encode('content'), { birthtime: originalBirthtime })

      await truncate(mockStorage, path, 3)

      const result = mockStorage.getFile(path)
      expect(result?.metadata.birthtime).toBe(originalBirthtime)
    })

    it('should preserve file mode after truncate', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/mode.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'), { mode: 0o755 })

      await truncate(mockStorage, path, 3)

      const result = mockStorage.getFile(path)
      expect(result?.metadata.mode).toBe(0o755)
    })
  })

  describe('path handling', () => {
    it('should handle paths with double slashes', async () => {
      const mockStorage = createMockStorage()
      const path = '/test//file.txt'
      mockStorage.addFile('/test/file.txt', new TextEncoder().encode('content'))

      await truncate(mockStorage, path, 3)

      const result = mockStorage.getFile('/test/file.txt')
      expect(result?.content.length).toBe(3)
    })

    it('should handle paths with dots', async () => {
      const mockStorage = createMockStorage()
      mockStorage.addFile('/test/file.txt', new TextEncoder().encode('content'))

      await truncate(mockStorage, '/test/./file.txt', 3)

      const result = mockStorage.getFile('/test/file.txt')
      expect(result?.content.length).toBe(3)
    })

    it('should handle paths with parent references', async () => {
      const mockStorage = createMockStorage()
      mockStorage.addDirectory('/test/subdir')
      mockStorage.addFile('/test/file.txt', new TextEncoder().encode('content'))

      await truncate(mockStorage, '/test/subdir/../file.txt', 3)

      const result = mockStorage.getFile('/test/file.txt')
      expect(result?.content.length).toBe(3)
    })

    it('should truncate file in root directory', async () => {
      const mockStorage = createMockStorage()
      mockStorage.addFile('/rootfile.txt', new TextEncoder().encode('content'))

      await truncate(mockStorage, '/rootfile.txt', 3)

      const result = mockStorage.getFile('/rootfile.txt')
      expect(result?.content.length).toBe(3)
    })
  })

  describe('return value', () => {
    it('should return undefined on successful truncate', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/file.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'))

      const result = await truncate(mockStorage, path, 3)

      expect(result).toBeUndefined()
    })

    it('should return undefined when extending file', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/file.txt'
      mockStorage.addFile(path, new TextEncoder().encode('content'))

      const result = await truncate(mockStorage, path, 100)

      expect(result).toBeUndefined()
    })
  })

  describe('large file operations', () => {
    it('should truncate 1MB file to 1KB', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/largetruncate.bin'
      const size = 1024 * 1024 // 1MB
      const content = new Uint8Array(size).fill(0x42)
      mockStorage.addFile(path, content)

      await truncate(mockStorage, path, 1024)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(1024)
      // Verify content is preserved up to truncation point
      for (let i = 0; i < 1024; i++) {
        expect(result?.content[i]).toBe(0x42)
      }
    })

    it('should extend file to 1MB', async () => {
      const mockStorage = createMockStorage()
      const path = '/test/largeextend.bin'
      const content = new Uint8Array([1, 2, 3])
      mockStorage.addFile(path, content)

      const targetSize = 1024 * 1024 // 1MB
      await truncate(mockStorage, path, targetSize)

      const result = mockStorage.getFile(path)
      expect(result?.content.length).toBe(targetSize)
      expect(result?.content[0]).toBe(1)
      expect(result?.content[1]).toBe(2)
      expect(result?.content[2]).toBe(3)
      // Check some zero-filled bytes
      expect(result?.content[100]).toBe(0)
      expect(result?.content[1000]).toBe(0)
    })
  })
})

/**
 * Mock storage interface for testing
 */
interface MockFile {
  content: Uint8Array
  metadata: {
    mode: number
    mtime: number
    birthtime: number
    ctime: number
  }
}

interface MockStorage {
  getFile(path: string): MockFile | undefined
  addDirectory(path: string): void
  addFile(path: string, content: Uint8Array, metadata?: { mode?: number; birthtime?: number }): void
  isDirectory(path: string): boolean
  updateFile(path: string, content: Uint8Array): void
}

/**
 * Create mock storage for tests
 */
function createMockStorage(): MockStorage {
  const files = new Map<string, MockFile>()
  const directories = new Set<string>(['/test', '/'])

  function normalizePath(path: string): string {
    const segments = path.split('/').filter(s => s !== '' && s !== '.')
    const result: string[] = []
    for (const segment of segments) {
      if (segment === '..') {
        result.pop()
      } else {
        result.push(segment)
      }
    }
    return '/' + result.join('/')
  }

  return {
    getFile(path: string): MockFile | undefined {
      return files.get(normalizePath(path))
    },

    addDirectory(path: string): void {
      directories.add(normalizePath(path))
    },

    addFile(path: string, content: Uint8Array, metadata?: { mode?: number; birthtime?: number }): void {
      const normalized = normalizePath(path)
      const now = Date.now()
      files.set(normalized, {
        content,
        metadata: {
          mode: metadata?.mode ?? 0o644,
          mtime: now,
          birthtime: metadata?.birthtime ?? now,
          ctime: now,
        },
      })
    },

    isDirectory(path: string): boolean {
      const normalized = normalizePath(path)
      return directories.has(normalized) && !files.has(normalized)
    },

    updateFile(path: string, content: Uint8Array): void {
      const normalized = normalizePath(path)
      const existing = files.get(normalized)
      if (existing) {
        files.set(normalized, {
          content,
          metadata: {
            ...existing.metadata,
            mtime: Date.now(),
            ctime: Date.now(),
          },
        })
      }
    },
  }
}
