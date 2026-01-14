/**
 * Tests for exists operation (RED phase - should fail)
 *
 * exists checks if a path exists and returns a boolean.
 * Unlike access(), exists() never throws - it always returns true or false.
 *
 * POSIX behavior:
 * - Returns true for existing files
 * - Returns true for existing directories
 * - Returns false for non-existent paths
 * - Follows symbolic links (returns true if target exists)
 * - Returns false for broken symlinks (target doesn't exist)
 * - Works with absolute paths
 * - Works with relative paths
 * - Works with paths containing special characters
 * - Never throws (always returns boolean)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { exists, setStorage, type ExistsStorage } from './exists'
import { type FileEntry, type FileType } from '../types'
import { normalize } from '../path'

// Helper to create file entries with default values
function createEntry(
  path: string,
  type: FileType,
  options: Partial<FileEntry> = {}
): FileEntry {
  const now = Date.now()
  const birthtime = options.birthtime ?? now - 100000
  return {
    id: options.id ?? path,
    path,
    name: path.split('/').pop() || '',
    parentId: null,
    type,
    mode: options.mode ?? (type === 'directory' ? 0o755 : 0o644),
    uid: options.uid ?? 1000,
    gid: options.gid ?? 1000,
    size: options.size ?? 0,
    blobId: null,
    linkTarget: options.linkTarget ?? null,
    atime: options.atime ?? now,
    mtime: options.mtime ?? now,
    ctime: options.ctime ?? now,
    birthtime: birthtime,
    nlink: options.nlink ?? (type === 'directory' ? 2 : 1),
  }
}

describe('exists', () => {
  // Mock filesystem for testing
  let mockFs: Map<string, FileEntry>

  beforeEach(() => {
    mockFs = new Map()

    // Root directory
    mockFs.set('/', createEntry('/', 'directory', { id: '1', mode: 0o755, uid: 0, gid: 0 }))

    // /home directory structure
    mockFs.set('/home', createEntry('/home', 'directory', { id: '2', mode: 0o755 }))
    mockFs.set('/home/user', createEntry('/home/user', 'directory', { id: '3', mode: 0o755 }))

    // Regular file with standard permissions
    mockFs.set('/home/user/file.txt', createEntry('/home/user/file.txt', 'file', {
      id: '4',
      size: 100,
      mode: 0o644,
      uid: 1000,
      gid: 1000,
    }))

    // Empty file
    mockFs.set('/home/user/empty.txt', createEntry('/home/user/empty.txt', 'file', {
      id: '5',
      size: 0,
      mode: 0o644,
    }))

    // Read-only file
    mockFs.set('/home/user/readonly.txt', createEntry('/home/user/readonly.txt', 'file', {
      id: '6',
      size: 50,
      mode: 0o444,
    }))

    // No permissions file
    mockFs.set('/home/user/noaccess.txt', createEntry('/home/user/noaccess.txt', 'file', {
      id: '7',
      size: 30,
      mode: 0o000,
    }))

    // /data directory with files
    mockFs.set('/data', createEntry('/data', 'directory', { id: '10', mode: 0o755 }))
    mockFs.set('/data/file.txt', createEntry('/data/file.txt', 'file', {
      id: '11',
      size: 100,
      mode: 0o644,
    }))
    mockFs.set('/data/subdir', createEntry('/data/subdir', 'directory', {
      id: '12',
      mode: 0o755,
    }))
    mockFs.set('/data/subdir/nested.txt', createEntry('/data/subdir/nested.txt', 'file', {
      id: '13',
      size: 50,
      mode: 0o644,
    }))

    // File with spaces in name
    mockFs.set('/data/file with spaces.txt', createEntry('/data/file with spaces.txt', 'file', {
      id: '14',
      size: 20,
      mode: 0o644,
    }))

    // File with unicode characters in name
    mockFs.set('/data/unicode-\u00e9\u00e0\u00fc.txt', createEntry('/data/unicode-\u00e9\u00e0\u00fc.txt', 'file', {
      id: '15',
      size: 25,
      mode: 0o644,
    }))

    // File with special characters
    mockFs.set('/data/special-!@#$%.txt', createEntry('/data/special-!@#$%.txt', 'file', {
      id: '16',
      size: 30,
      mode: 0o644,
    }))

    // Hidden file (starts with dot)
    mockFs.set('/data/.hidden', createEntry('/data/.hidden', 'file', {
      id: '17',
      size: 10,
      mode: 0o644,
    }))

    // /links directory with symlinks
    mockFs.set('/links', createEntry('/links', 'directory', { id: '20', mode: 0o755 }))

    // Symlink to file
    mockFs.set('/links/file-link', createEntry('/links/file-link', 'symlink', {
      id: '21',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
    }))

    // Symlink to directory
    mockFs.set('/links/dir-link', createEntry('/links/dir-link', 'symlink', {
      id: '22',
      linkTarget: '/data/subdir',
      size: 12,
      mode: 0o777,
    }))

    // Broken symlink (target doesn't exist)
    mockFs.set('/links/broken-link', createEntry('/links/broken-link', 'symlink', {
      id: '23',
      linkTarget: '/nonexistent/target',
      size: 19,
      mode: 0o777,
    }))

    // Chain of symlinks: link1 -> link2 -> /data/file.txt
    mockFs.set('/links/link2', createEntry('/links/link2', 'symlink', {
      id: '24',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
    }))
    mockFs.set('/links/link1', createEntry('/links/link1', 'symlink', {
      id: '25',
      linkTarget: '/links/link2',
      size: 12,
      mode: 0o777,
    }))

    // Circular symlink (link3 -> link4 -> link3)
    mockFs.set('/links/link3', createEntry('/links/link3', 'symlink', {
      id: '26',
      linkTarget: '/links/link4',
      size: 12,
      mode: 0o777,
    }))
    mockFs.set('/links/link4', createEntry('/links/link4', 'symlink', {
      id: '27',
      linkTarget: '/links/link3',
      size: 12,
      mode: 0o777,
    }))

    // Symlink to file with no permissions
    mockFs.set('/links/noaccess-link', createEntry('/links/noaccess-link', 'symlink', {
      id: '28',
      linkTarget: '/home/user/noaccess.txt',
      size: 22,
      mode: 0o777,
    }))

    // Deeply nested path
    mockFs.set('/a', createEntry('/a', 'directory', { id: '30', nlink: 3 }))
    mockFs.set('/a/b', createEntry('/a/b', 'directory', { id: '31', nlink: 3 }))
    mockFs.set('/a/b/c', createEntry('/a/b/c', 'directory', { id: '32', nlink: 3 }))
    mockFs.set('/a/b/c/d', createEntry('/a/b/c/d', 'directory', { id: '33', nlink: 3 }))
    mockFs.set('/a/b/c/d/e', createEntry('/a/b/c/d/e', 'directory', { id: '34', nlink: 2 }))
    mockFs.set('/a/b/c/d/e/file.txt', createEntry('/a/b/c/d/e/file.txt', 'file', {
      id: '35',
      size: 10,
    }))

    // Create storage adapter
    const storage: ExistsStorage = {
      get: (path: string) => {
        const normalizedPath = normalize(path)
        return mockFs.get(normalizedPath)
      },
      has: (path: string) => {
        const normalizedPath = normalize(path)
        return mockFs.has(normalizedPath)
      },
      resolveSymlink: (path: string, maxDepth: number = 40) => {
        let current = mockFs.get(normalize(path))
        let depth = 0
        while (current && current.type === 'symlink' && current.linkTarget && depth < maxDepth) {
          const targetPath = normalize(current.linkTarget)
          current = mockFs.get(targetPath)
          depth++
        }
        return current
      },
    }
    setStorage(storage)
  })

  afterEach(() => {
    setStorage(null)
  })

  describe('existing files', () => {
    it('should return true for existing regular file', async () => {
      // Given: a regular file exists at /home/user/file.txt
      // When: calling exists on the file
      // Then: should return true

      const result = await exists('/home/user/file.txt')

      expect(result).toBe(true)
    })

    it('should return true for existing empty file', async () => {
      // Given: an empty file exists at /home/user/empty.txt
      // When: calling exists on the file
      // Then: should return true (size doesn't matter)

      const result = await exists('/home/user/empty.txt')

      expect(result).toBe(true)
    })

    it('should return true for file with no permissions', async () => {
      // Given: a file with mode 0o000 exists
      // When: calling exists on the file
      // Then: should return true (exists doesn't check permissions)

      const result = await exists('/home/user/noaccess.txt')

      expect(result).toBe(true)
    })

    it('should return true for read-only file', async () => {
      // Given: a read-only file exists
      // When: calling exists on the file
      // Then: should return true

      const result = await exists('/home/user/readonly.txt')

      expect(result).toBe(true)
    })

    it('should return true for hidden file', async () => {
      // Given: a hidden file (starting with .) exists
      // When: calling exists on the file
      // Then: should return true

      const result = await exists('/data/.hidden')

      expect(result).toBe(true)
    })

    it('should return true for deeply nested file', async () => {
      // Given: a file exists in a deeply nested directory
      // When: calling exists on the file
      // Then: should return true

      const result = await exists('/a/b/c/d/e/file.txt')

      expect(result).toBe(true)
    })
  })

  describe('existing directories', () => {
    it('should return true for existing directory', async () => {
      // Given: a directory exists at /home/user
      // When: calling exists on the directory
      // Then: should return true

      const result = await exists('/home/user')

      expect(result).toBe(true)
    })

    it('should return true for root directory', async () => {
      // Given: root directory exists
      // When: calling exists on root
      // Then: should return true

      const result = await exists('/')

      expect(result).toBe(true)
    })

    it('should return true for nested directory', async () => {
      // Given: a nested directory exists
      // When: calling exists on the directory
      // Then: should return true

      const result = await exists('/data/subdir')

      expect(result).toBe(true)
    })

    it('should return true for deeply nested directory', async () => {
      // Given: a deeply nested directory exists
      // When: calling exists on the directory
      // Then: should return true

      const result = await exists('/a/b/c/d/e')

      expect(result).toBe(true)
    })
  })

  describe('non-existent paths', () => {
    it('should return false for non-existent file', async () => {
      // Given: path does not exist
      // When: calling exists
      // Then: should return false

      const result = await exists('/nonexistent/file.txt')

      expect(result).toBe(false)
    })

    it('should return false for non-existent directory', async () => {
      // Given: directory does not exist
      // When: calling exists
      // Then: should return false

      const result = await exists('/nonexistent/dir')

      expect(result).toBe(false)
    })

    it('should return false when parent directory does not exist', async () => {
      // Given: parent directory does not exist
      // When: calling exists
      // Then: should return false

      const result = await exists('/nonexistent/parent/file.txt')

      expect(result).toBe(false)
    })

    it('should return false for file in existing directory that does not exist', async () => {
      // Given: directory exists but file doesn't
      // When: calling exists
      // Then: should return false

      const result = await exists('/data/nonexistent-file.txt')

      expect(result).toBe(false)
    })

    it('should return false for empty path', async () => {
      // Given: empty path
      // When: calling exists
      // Then: should return false (or handle gracefully)

      const result = await exists('')

      expect(result).toBe(false)
    })
  })

  describe('symlink handling (follows symlinks)', () => {
    it('should return true for symlink pointing to existing file', async () => {
      // Given: symlink pointing to existing file
      // When: calling exists on the symlink
      // Then: should return true (target exists)

      const result = await exists('/links/file-link')

      expect(result).toBe(true)
    })

    it('should return true for symlink pointing to existing directory', async () => {
      // Given: symlink pointing to existing directory
      // When: calling exists on the symlink
      // Then: should return true (target exists)

      const result = await exists('/links/dir-link')

      expect(result).toBe(true)
    })

    it('should return false for broken symlink', async () => {
      // Given: symlink pointing to non-existent target
      // When: calling exists on the symlink
      // Then: should return false (target doesn't exist)

      const result = await exists('/links/broken-link')

      expect(result).toBe(false)
    })

    it('should return true for chain of symlinks ending in existing file', async () => {
      // Given: link1 -> link2 -> /data/file.txt
      // When: calling exists on link1
      // Then: should return true (final target exists)

      const result = await exists('/links/link1')

      expect(result).toBe(true)
    })

    it('should return true for symlink to file with no permissions', async () => {
      // Given: symlink to file with mode 0o000
      // When: calling exists
      // Then: should return true (exists doesn't check permissions)

      const result = await exists('/links/noaccess-link')

      expect(result).toBe(true)
    })

    it('should handle circular symlinks gracefully (return false)', async () => {
      // Given: circular symlink (link3 -> link4 -> link3)
      // When: calling exists
      // Then: should return false (can't resolve) or handle without hanging

      const result = await exists('/links/link3')

      // Circular symlinks should be treated as non-existent
      // (they can't be resolved to a real file)
      expect(result).toBe(false)
    })
  })

  describe('path handling', () => {
    it('should handle absolute paths', async () => {
      // Given: an absolute path
      // When: calling exists
      // Then: should work correctly

      const result = await exists('/data/file.txt')

      expect(result).toBe(true)
    })

    it('should normalize paths with double slashes', async () => {
      // Given: path with double slashes
      // When: calling exists
      // Then: should normalize and check correctly

      const result = await exists('/data//file.txt')

      expect(result).toBe(true)
    })

    it('should normalize paths with dot segments', async () => {
      // Given: path with ./
      // When: calling exists
      // Then: should normalize and check correctly

      const result = await exists('/data/./file.txt')

      expect(result).toBe(true)
    })

    it('should normalize paths with parent directory segments', async () => {
      // Given: path with ../
      // When: calling exists
      // Then: should normalize and check correctly

      const result = await exists('/data/subdir/../file.txt')

      expect(result).toBe(true)
    })

    it('should handle trailing slashes for directories', async () => {
      // Given: directory path with trailing slash
      // When: calling exists
      // Then: should work

      const result = await exists('/data/')

      expect(result).toBe(true)
    })

    it('should handle trailing slashes for files (should return false or true depending on impl)', async () => {
      // Given: file path with trailing slash
      // When: calling exists
      // Then: should handle gracefully (typically false since files aren't directories)

      const result = await exists('/data/file.txt/')

      // POSIX typically treats trailing slash as "must be directory"
      // So file.txt/ should be false since file.txt is not a directory
      expect(result).toBe(false)
    })
  })

  describe('special characters in paths', () => {
    it('should handle paths with spaces', async () => {
      // Given: file with spaces in name
      // When: calling exists
      // Then: should return true

      const result = await exists('/data/file with spaces.txt')

      expect(result).toBe(true)
    })

    it('should handle paths with unicode characters', async () => {
      // Given: file with unicode characters
      // When: calling exists
      // Then: should return true

      const result = await exists('/data/unicode-\u00e9\u00e0\u00fc.txt')

      expect(result).toBe(true)
    })

    it('should handle paths with special characters', async () => {
      // Given: file with special characters (!@#$%)
      // When: calling exists
      // Then: should return true

      const result = await exists('/data/special-!@#$%.txt')

      expect(result).toBe(true)
    })
  })

  describe('never throws guarantee', () => {
    it('should never throw for non-existent paths', async () => {
      // Given: various non-existent paths
      // When: calling exists
      // Then: should not throw, always return boolean

      // Should not throw, just return false
      await expect(exists('/nonexistent')).resolves.toBe(false)
      await expect(exists('/also/nonexistent')).resolves.toBe(false)
      await expect(exists('/very/deep/nonexistent/path/to/file.txt')).resolves.toBe(false)
    })

    it('should never throw for invalid-looking paths', async () => {
      // Given: unusual paths
      // When: calling exists
      // Then: should not throw, return boolean

      // These should not throw
      await expect(exists('///multiple///slashes')).resolves.toBeTypeOf('boolean')
      await expect(exists('/path/with/./and/../segments')).resolves.toBeTypeOf('boolean')
    })

    it('should return boolean type, never undefined or null', async () => {
      // Given: various paths
      // When: calling exists
      // Then: should always return boolean (not undefined, null, or other)

      const existingResult = await exists('/data/file.txt')
      const nonExistingResult = await exists('/nonexistent')

      expect(typeof existingResult).toBe('boolean')
      expect(typeof nonExistingResult).toBe('boolean')
      expect(existingResult).not.toBeNull()
      expect(existingResult).not.toBeUndefined()
      expect(nonExistingResult).not.toBeNull()
      expect(nonExistingResult).not.toBeUndefined()
    })

    it('should handle storage being null gracefully', async () => {
      // Given: storage is not configured (null)
      // When: calling exists
      // Then: should return false, not throw

      setStorage(null)

      const result = await exists('/any/path')

      expect(result).toBe(false)
    })
  })

  describe('concurrent access', () => {
    it('should handle concurrent exists calls on same path', async () => {
      // Given: a file
      // When: calling exists concurrently multiple times
      // Then: all calls should succeed with same result

      const promises = [
        exists('/data/file.txt'),
        exists('/data/file.txt'),
        exists('/data/file.txt'),
      ]

      const results = await Promise.all(promises)

      expect(results).toEqual([true, true, true])
    })

    it('should handle concurrent exists calls on different paths', async () => {
      // Given: multiple paths
      // When: calling exists concurrently on different paths
      // Then: all calls should return correct results

      const promises = [
        exists('/data/file.txt'),
        exists('/nonexistent'),
        exists('/data/subdir'),
        exists('/links/broken-link'),
      ]

      const results = await Promise.all(promises)

      expect(results).toEqual([true, false, true, false])
    })

    it('should handle mixed concurrent exists calls (existing and non-existing)', async () => {
      // Given: mix of existing and non-existing paths
      // When: calling exists concurrently
      // Then: should return correct results for each

      const paths = [
        '/data/file.txt',        // exists
        '/nonexistent/a',        // doesn't exist
        '/data/subdir',          // exists
        '/nonexistent/b',        // doesn't exist
        '/links/file-link',      // exists (symlink to existing)
        '/links/broken-link',    // doesn't exist (broken symlink)
      ]

      const results = await Promise.all(paths.map(p => exists(p)))

      expect(results).toEqual([true, false, true, false, true, false])
    })
  })

  describe('edge cases', () => {
    it('should handle very long path names', async () => {
      // Given: a very long path
      // When: calling exists
      // Then: should handle without crashing

      const longPath = '/data/' + 'a'.repeat(255) // Max filename length on most systems

      const result = await exists(longPath)

      expect(typeof result).toBe('boolean')
    })

    it('should handle paths with only slashes', async () => {
      // Given: path with multiple slashes
      // When: calling exists
      // Then: should normalize to root

      const result = await exists('///')

      // Should normalize to '/' which exists
      expect(result).toBe(true)
    })

    it('should handle path going above root with ../', async () => {
      // Given: path that tries to go above root
      // When: calling exists
      // Then: should handle gracefully

      const result = await exists('/../../../etc/passwd')

      // Should normalize and handle gracefully
      expect(typeof result).toBe('boolean')
    })

    it('should be consistent with access for existing files', async () => {
      // Given: an existing file
      // When: comparing exists() with access() behavior
      // Then: exists() should return true where access(path, F_OK) succeeds

      // This test documents that exists() is essentially a wrapper around access()
      const existsResult = await exists('/data/file.txt')

      expect(existsResult).toBe(true)
    })
  })
})
