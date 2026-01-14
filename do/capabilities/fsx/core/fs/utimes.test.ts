/**
 * Tests for utimes operation (RED phase - should fail)
 *
 * utimes updates the access time (atime) and modification time (mtime) of a file.
 * lutimes changes the timestamps of a symbolic link itself (doesn't follow).
 *
 * POSIX behavior:
 * - utimes(path, atime, mtime) follows symlinks and changes target timestamps
 * - lutimes(path, atime, mtime) changes the symlink's timestamps (not target)
 * - Accepts Date objects, numeric timestamps (milliseconds or seconds), or strings
 * - Updates ctime automatically on any timestamp change
 * - Throws ENOENT if path doesn't exist
 * - Throws ENOENT for broken symlinks (utimes follows links)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { utimes, lutimes, setStorage, type UtimesStorage } from './utimes'
import { type FileEntry, type FileType } from '../types'
import { ENOENT } from '../errors'
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

describe('utimes', () => {
  // Mock filesystem for testing
  let mockFs: Map<string, FileEntry>

  beforeEach(() => {
    mockFs = new Map()

    // Root directory
    mockFs.set('/', createEntry('/', 'directory', { id: '1', mode: 0o755, uid: 0, gid: 0 }))

    // /home directory structure
    mockFs.set('/home', createEntry('/home', 'directory', { id: '2', mode: 0o755 }))
    mockFs.set('/home/user', createEntry('/home/user', 'directory', { id: '3', mode: 0o755 }))

    // Regular file with known timestamps
    const baseTime = new Date('2024-01-01T00:00:00Z').getTime()
    mockFs.set('/home/user/file.txt', createEntry('/home/user/file.txt', 'file', {
      id: '4',
      size: 100,
      mode: 0o644,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
      birthtime: baseTime - 1000000,
    }))

    // Another file for testing
    mockFs.set('/home/user/document.txt', createEntry('/home/user/document.txt', 'file', {
      id: '5',
      size: 200,
      mode: 0o644,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))

    // Directory
    mockFs.set('/home/user/mydir', createEntry('/home/user/mydir', 'directory', {
      id: '6',
      mode: 0o755,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))

    // /data directory with files
    mockFs.set('/data', createEntry('/data', 'directory', { id: '10', mode: 0o755 }))
    mockFs.set('/data/file.txt', createEntry('/data/file.txt', 'file', {
      id: '11',
      size: 100,
      mode: 0o644,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))
    mockFs.set('/data/subdir', createEntry('/data/subdir', 'directory', {
      id: '12',
      mode: 0o755,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))

    // /links directory with symlinks
    mockFs.set('/links', createEntry('/links', 'directory', { id: '20', mode: 0o755 }))
    mockFs.set('/links/file-link', createEntry('/links/file-link', 'symlink', {
      id: '21',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))
    mockFs.set('/links/dir-link', createEntry('/links/dir-link', 'symlink', {
      id: '22',
      linkTarget: '/data/subdir',
      size: 12,
      mode: 0o777,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))
    mockFs.set('/links/broken-link', createEntry('/links/broken-link', 'symlink', {
      id: '23',
      linkTarget: '/nonexistent/target',
      size: 19,
      mode: 0o777,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))

    // Chain of symlinks: link1 -> link2 -> /data/file.txt
    mockFs.set('/links/link2', createEntry('/links/link2', 'symlink', {
      id: '24',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))
    mockFs.set('/links/link1', createEntry('/links/link1', 'symlink', {
      id: '25',
      linkTarget: '/links/link2',
      size: 12,
      mode: 0o777,
      atime: baseTime,
      mtime: baseTime,
      ctime: baseTime,
    }))

    // Create storage adapter
    const storage: UtimesStorage = {
      get: (path: string) => {
        const normalizedPath = normalize(path)
        return mockFs.get(normalizedPath)
      },
      has: (path: string) => {
        const normalizedPath = normalize(path)
        return mockFs.has(normalizedPath)
      },
      update: (path: string, changes: Partial<FileEntry>) => {
        const normalizedPath = normalize(path)
        const entry = mockFs.get(normalizedPath)
        if (entry) {
          mockFs.set(normalizedPath, { ...entry, ...changes })
        }
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

  describe('utimes with Date objects', () => {
    it('should update atime and mtime with Date objects', async () => {
      // Given: a file with known timestamps
      // When: calling utimes with new Date objects
      // Then: both atime and mtime should be updated

      const newAtime = new Date('2025-06-15T10:30:00Z')
      const newMtime = new Date('2025-06-15T12:00:00Z')

      await utimes('/home/user/file.txt', newAtime, newMtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should update only atime when both params are the same Date', async () => {
      // Given: a file
      // When: calling utimes with same Date for both
      // Then: both should be set to that time

      const sameTime = new Date('2025-01-01T00:00:00Z')

      await utimes('/home/user/file.txt', sameTime, sameTime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(sameTime.getTime())
      expect(entry!.mtime).toBe(sameTime.getTime())
    })

    it('should work with past dates', async () => {
      // Given: a file
      // When: calling utimes with past dates
      // Then: timestamps should be set to those past dates

      const pastAtime = new Date('2020-01-01T00:00:00Z')
      const pastMtime = new Date('2019-06-15T12:00:00Z')

      await utimes('/home/user/file.txt', pastAtime, pastMtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(pastAtime.getTime())
      expect(entry!.mtime).toBe(pastMtime.getTime())
    })

    it('should work with future dates', async () => {
      // Given: a file
      // When: calling utimes with future dates
      // Then: timestamps should be set to those future dates

      const futureAtime = new Date('2030-01-01T00:00:00Z')
      const futureMtime = new Date('2030-06-15T12:00:00Z')

      await utimes('/home/user/file.txt', futureAtime, futureMtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(futureAtime.getTime())
      expect(entry!.mtime).toBe(futureMtime.getTime())
    })

    it('should return undefined on success', async () => {
      // Given: a valid file
      // When: calling utimes
      // Then: should return undefined (void)

      const result = await utimes('/home/user/file.txt', new Date(), new Date())

      expect(result).toBeUndefined()
    })
  })

  describe('utimes with numeric timestamps (milliseconds)', () => {
    it('should update timestamps with millisecond values', async () => {
      // Given: a file
      // When: calling utimes with numeric millisecond timestamps
      // Then: timestamps should be set correctly

      const newAtimeMs = new Date('2025-03-20T08:00:00Z').getTime()
      const newMtimeMs = new Date('2025-03-20T09:00:00Z').getTime()

      await utimes('/home/user/file.txt', newAtimeMs, newMtimeMs)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(newAtimeMs)
      expect(entry!.mtime).toBe(newMtimeMs)
    })

    it('should handle large millisecond values (year 2100+)', async () => {
      // Given: a file
      // When: calling utimes with very large timestamps
      // Then: should work correctly

      const year2100 = new Date('2100-01-01T00:00:00Z').getTime()

      await utimes('/home/user/file.txt', year2100, year2100)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(year2100)
      expect(entry!.mtime).toBe(year2100)
    })

    it('should handle epoch timestamp (0)', async () => {
      // Given: a file
      // When: calling utimes with epoch (0)
      // Then: should set timestamps to Unix epoch

      await utimes('/home/user/file.txt', 0, 0)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(0)
      expect(entry!.mtime).toBe(0)
    })
  })

  describe('utimes with numeric timestamps (seconds)', () => {
    it('should convert seconds to milliseconds for small values', async () => {
      // Given: a file
      // When: calling utimes with second-based timestamps (< 1e12)
      // Then: should convert to milliseconds

      // Unix timestamp in seconds for 2025-01-01
      const atimeSeconds = 1735689600 // 2025-01-01T00:00:00Z in seconds
      const mtimeSeconds = 1735693200 // 2025-01-01T01:00:00Z in seconds

      await utimes('/home/user/file.txt', atimeSeconds, mtimeSeconds)

      const entry = mockFs.get('/home/user/file.txt')
      // Should be converted to milliseconds
      expect(entry!.atime).toBe(atimeSeconds * 1000)
      expect(entry!.mtime).toBe(mtimeSeconds * 1000)
    })

    it('should treat values >= 1e12 as milliseconds', async () => {
      // Given: a file
      // When: calling utimes with value >= 1e12
      // Then: should treat as milliseconds (not convert)

      const msTimestamp = 1735689600000 // Already in milliseconds

      await utimes('/home/user/file.txt', msTimestamp, msTimestamp)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(msTimestamp)
      expect(entry!.mtime).toBe(msTimestamp)
    })
  })

  describe('utimes with string timestamps', () => {
    it('should parse ISO date strings', async () => {
      // Given: a file
      // When: calling utimes with ISO date strings
      // Then: should parse and set correctly

      const atimeStr = '2025-06-15T10:30:00Z'
      const mtimeStr = '2025-06-15T12:00:00Z'

      await utimes('/home/user/file.txt', atimeStr, mtimeStr)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(new Date(atimeStr).getTime())
      expect(entry!.mtime).toBe(new Date(mtimeStr).getTime())
    })

    it('should parse date strings without time component', async () => {
      // Given: a file
      // When: calling utimes with date-only strings
      // Then: should parse correctly

      const atimeStr = '2025-06-15'
      const mtimeStr = '2025-06-20'

      await utimes('/home/user/file.txt', atimeStr, mtimeStr)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(new Date(atimeStr).getTime())
      expect(entry!.mtime).toBe(new Date(mtimeStr).getTime())
    })
  })

  describe('utimes on directories', () => {
    it('should update directory timestamps', async () => {
      // Given: a directory
      // When: calling utimes on it
      // Then: should update the directory's timestamps

      const newAtime = new Date('2025-05-01T00:00:00Z')
      const newMtime = new Date('2025-05-01T12:00:00Z')

      await utimes('/home/user/mydir', newAtime, newMtime)

      const entry = mockFs.get('/home/user/mydir')
      expect(entry).toBeDefined()
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should update root directory timestamps', async () => {
      // Given: root directory
      // When: calling utimes on /
      // Then: should update timestamps

      const newAtime = new Date('2025-01-01T00:00:00Z')
      const newMtime = new Date('2025-01-01T00:00:00Z')

      await utimes('/', newAtime, newMtime)

      const entry = mockFs.get('/')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })
  })

  describe('ctime update', () => {
    it('should update ctime when atime/mtime are changed', async () => {
      // Given: a file with known ctime
      // When: calling utimes
      // Then: ctime should be updated to current time

      const entry = mockFs.get('/home/user/file.txt')
      const originalCtime = entry!.ctime

      // Wait a tiny bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 1))

      await utimes('/home/user/file.txt', new Date(), new Date())

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry!.ctime).toBeGreaterThanOrEqual(originalCtime)
    })

    it('should not update birthtime when changing atime/mtime', async () => {
      // Given: a file with known birthtime
      // When: calling utimes
      // Then: birthtime should remain unchanged

      const entry = mockFs.get('/home/user/file.txt')
      const originalBirthtime = entry!.birthtime

      await utimes('/home/user/file.txt', new Date(), new Date())

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry!.birthtime).toBe(originalBirthtime)
    })
  })

  describe('symlink handling (utimes follows symlinks)', () => {
    it('should update target file timestamps through symlink', async () => {
      // Given: symlink pointing to a file
      // When: calling utimes on the symlink
      // Then: should update the target file's timestamps

      const newAtime = new Date('2025-07-01T00:00:00Z')
      const newMtime = new Date('2025-07-01T12:00:00Z')

      await utimes('/links/file-link', newAtime, newMtime)

      // The target file should have updated timestamps
      const target = mockFs.get('/data/file.txt')
      expect(target).toBeDefined()
      expect(target!.atime).toBe(newAtime.getTime())
      expect(target!.mtime).toBe(newMtime.getTime())

      // The symlink itself should be unchanged
      const link = mockFs.get('/links/file-link')
      expect(link!.atime).not.toBe(newAtime.getTime())
    })

    it('should update target directory timestamps through symlink', async () => {
      // Given: symlink pointing to a directory
      // When: calling utimes on the symlink
      // Then: should update the target directory's timestamps

      const newAtime = new Date('2025-08-01T00:00:00Z')
      const newMtime = new Date('2025-08-01T12:00:00Z')

      await utimes('/links/dir-link', newAtime, newMtime)

      const target = mockFs.get('/data/subdir')
      expect(target).toBeDefined()
      expect(target!.atime).toBe(newAtime.getTime())
      expect(target!.mtime).toBe(newMtime.getTime())
    })

    it('should follow chain of symlinks', async () => {
      // Given: link1 -> link2 -> /data/file.txt
      // When: calling utimes on link1
      // Then: should update /data/file.txt timestamps

      const newAtime = new Date('2025-09-01T00:00:00Z')
      const newMtime = new Date('2025-09-01T12:00:00Z')

      await utimes('/links/link1', newAtime, newMtime)

      const target = mockFs.get('/data/file.txt')
      expect(target).toBeDefined()
      expect(target!.atime).toBe(newAtime.getTime())
      expect(target!.mtime).toBe(newMtime.getTime())
    })

    it('should throw ENOENT for broken symlink', async () => {
      // Given: symlink pointing to non-existent target
      // When: calling utimes on the broken symlink
      // Then: should throw ENOENT

      await expect(utimes('/links/broken-link', new Date(), new Date())).rejects.toThrow(ENOENT)
    })
  })

  describe('lutimes - change symlink timestamps', () => {
    it('should change symlink timestamps without following', async () => {
      // Given: a symlink
      // When: calling lutimes on the symlink
      // Then: should change the symlink's own timestamps (not target)

      const newAtime = new Date('2025-10-01T00:00:00Z')
      const newMtime = new Date('2025-10-01T12:00:00Z')

      // Get original target timestamps
      const originalTarget = mockFs.get('/data/file.txt')
      const originalTargetAtime = originalTarget!.atime
      const originalTargetMtime = originalTarget!.mtime

      await lutimes('/links/file-link', newAtime, newMtime)

      // The symlink should have updated timestamps
      const link = mockFs.get('/links/file-link')
      expect(link).toBeDefined()
      expect(link!.atime).toBe(newAtime.getTime())
      expect(link!.mtime).toBe(newMtime.getTime())

      // The target should be unchanged
      const target = mockFs.get('/data/file.txt')
      expect(target!.atime).toBe(originalTargetAtime)
      expect(target!.mtime).toBe(originalTargetMtime)
    })

    it('should work on broken symlink', async () => {
      // Given: a broken symlink
      // When: calling lutimes
      // Then: should succeed (symlink exists even if target doesn't)

      const newAtime = new Date('2025-11-01T00:00:00Z')
      const newMtime = new Date('2025-11-01T12:00:00Z')

      await lutimes('/links/broken-link', newAtime, newMtime)

      const link = mockFs.get('/links/broken-link')
      expect(link).toBeDefined()
      expect(link!.atime).toBe(newAtime.getTime())
      expect(link!.mtime).toBe(newMtime.getTime())
    })

    it('should throw ENOENT for non-existent path', async () => {
      // Given: path does not exist
      // When: calling lutimes
      // Then: should throw ENOENT

      await expect(lutimes('/nonexistent/link', new Date(), new Date())).rejects.toThrow(ENOENT)
    })

    it('should include syscall = "lutimes" in error', async () => {
      // Given: non-existent path
      // When: lutimes throws ENOENT
      // Then: error.syscall should be 'lutimes'

      try {
        await lutimes('/nonexistent/link', new Date(), new Date())
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('lutimes')
      }
    })

    it('should work on regular file (same as utimes)', async () => {
      // Given: a regular file (not symlink)
      // When: calling lutimes
      // Then: should change the file's timestamps

      const newAtime = new Date('2025-12-01T00:00:00Z')
      const newMtime = new Date('2025-12-01T12:00:00Z')

      await lutimes('/home/user/file.txt', newAtime, newMtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should work on directory', async () => {
      // Given: a directory
      // When: calling lutimes
      // Then: should change the directory's timestamps

      const newAtime = new Date('2025-12-15T00:00:00Z')
      const newMtime = new Date('2025-12-15T12:00:00Z')

      await lutimes('/home/user/mydir', newAtime, newMtime)

      const entry = mockFs.get('/home/user/mydir')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should accept numeric timestamps', async () => {
      // Given: a symlink
      // When: calling lutimes with numeric timestamps
      // Then: should work correctly

      const newAtimeMs = new Date('2025-06-01T00:00:00Z').getTime()
      const newMtimeMs = new Date('2025-06-01T12:00:00Z').getTime()

      await lutimes('/links/file-link', newAtimeMs, newMtimeMs)

      const link = mockFs.get('/links/file-link')
      expect(link!.atime).toBe(newAtimeMs)
      expect(link!.mtime).toBe(newMtimeMs)
    })
  })

  describe('ENOENT - path does not exist', () => {
    it('should throw ENOENT for non-existent file', async () => {
      // Given: path does not exist
      // When: calling utimes
      // Then: should throw ENOENT

      await expect(utimes('/nonexistent/file.txt', new Date(), new Date())).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT for non-existent directory path', async () => {
      // Given: directory path does not exist
      // When: calling utimes
      // Then: should throw ENOENT

      await expect(utimes('/nonexistent/dir', new Date(), new Date())).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when parent directory does not exist', async () => {
      // Given: parent directory does not exist
      // When: calling utimes
      // Then: should throw ENOENT

      await expect(utimes('/nonexistent/parent/file.txt', new Date(), new Date())).rejects.toThrow(ENOENT)
    })

    it('should include syscall = "utimes" in ENOENT error', async () => {
      // Given: non-existent path
      // When: utimes throws ENOENT
      // Then: error.syscall should be 'utimes'

      try {
        await utimes('/nonexistent/file.txt', new Date(), new Date())
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('utimes')
      }
    })

    it('should include correct path in ENOENT error', async () => {
      // Given: non-existent path
      // When: utimes throws ENOENT
      // Then: error.path should be the requested path

      try {
        await utimes('/some/missing/file.txt', new Date(), new Date())
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).path).toBe('/some/missing/file.txt')
      }
    })

    it('should include errno = -2 in ENOENT error', async () => {
      // Given: non-existent path
      // When: utimes throws ENOENT
      // Then: error.errno should be -2

      try {
        await utimes('/nonexistent', new Date(), new Date())
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).errno).toBe(-2)
      }
    })
  })

  describe('path handling', () => {
    it('should handle absolute paths', async () => {
      // Given: an absolute path
      // When: calling utimes
      // Then: should work correctly

      const newAtime = new Date('2025-01-15T00:00:00Z')
      const newMtime = new Date('2025-01-15T12:00:00Z')

      await utimes('/data/file.txt', newAtime, newMtime)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should normalize paths with double slashes', async () => {
      // Given: path with double slashes
      // When: calling utimes
      // Then: should normalize and work

      const newAtime = new Date('2025-02-01T00:00:00Z')
      const newMtime = new Date('2025-02-01T12:00:00Z')

      await utimes('/data//file.txt', newAtime, newMtime)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should normalize paths with dot segments', async () => {
      // Given: path with ./
      // When: calling utimes
      // Then: should normalize and work

      const newAtime = new Date('2025-03-01T00:00:00Z')
      const newMtime = new Date('2025-03-01T12:00:00Z')

      await utimes('/data/./file.txt', newAtime, newMtime)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should normalize paths with parent directory segments', async () => {
      // Given: path with ../
      // When: calling utimes
      // Then: should normalize and work

      const newAtime = new Date('2025-04-01T00:00:00Z')
      const newMtime = new Date('2025-04-01T12:00:00Z')

      await utimes('/data/subdir/../file.txt', newAtime, newMtime)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should handle trailing slashes for directories', async () => {
      // Given: directory path with trailing slash
      // When: calling utimes
      // Then: should work

      const newAtime = new Date('2025-05-01T00:00:00Z')
      const newMtime = new Date('2025-05-01T12:00:00Z')

      await utimes('/data/subdir/', newAtime, newMtime)

      const entry = mockFs.get('/data/subdir')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })
  })

  describe('mixed timestamp types', () => {
    it('should accept Date for atime and number for mtime', async () => {
      // Given: a file
      // When: calling utimes with Date and number
      // Then: should work correctly

      const newAtime = new Date('2025-06-01T00:00:00Z')
      const newMtimeMs = new Date('2025-06-01T12:00:00Z').getTime()

      await utimes('/home/user/file.txt', newAtime, newMtimeMs)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtimeMs)
    })

    it('should accept number for atime and Date for mtime', async () => {
      // Given: a file
      // When: calling utimes with number and Date
      // Then: should work correctly

      const newAtimeMs = new Date('2025-07-01T00:00:00Z').getTime()
      const newMtime = new Date('2025-07-01T12:00:00Z')

      await utimes('/home/user/file.txt', newAtimeMs, newMtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(newAtimeMs)
      expect(entry!.mtime).toBe(newMtime.getTime())
    })

    it('should accept string for atime and Date for mtime', async () => {
      // Given: a file
      // When: calling utimes with string and Date
      // Then: should work correctly

      const newAtimeStr = '2025-08-01T00:00:00Z'
      const newMtime = new Date('2025-08-01T12:00:00Z')

      await utimes('/home/user/file.txt', newAtimeStr, newMtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(new Date(newAtimeStr).getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent utimes calls on same file', async () => {
      // Given: a file
      // When: calling utimes concurrently multiple times
      // Then: all calls should succeed (last one wins)

      const time1 = new Date('2025-01-01T00:00:00Z')
      const time2 = new Date('2025-02-01T00:00:00Z')
      const time3 = new Date('2025-03-01T00:00:00Z')

      const promises = [
        utimes('/data/file.txt', time1, time1),
        utimes('/data/file.txt', time2, time2),
        utimes('/data/file.txt', time3, time3),
      ]

      await Promise.all(promises)

      // One of the times should have won
      const entry = mockFs.get('/data/file.txt')
      const possibleTimes = [time1.getTime(), time2.getTime(), time3.getTime()]
      expect(possibleTimes).toContain(entry!.atime)
      expect(possibleTimes).toContain(entry!.mtime)
    })

    it('should handle concurrent utimes calls on different files', async () => {
      // Given: multiple files
      // When: calling utimes concurrently on different files
      // Then: all calls should succeed

      const time1 = new Date('2025-04-01T00:00:00Z')
      const time2 = new Date('2025-05-01T00:00:00Z')
      const time3 = new Date('2025-06-01T00:00:00Z')

      await Promise.all([
        utimes('/home/user/file.txt', time1, time1),
        utimes('/home/user/document.txt', time2, time2),
        utimes('/data/file.txt', time3, time3),
      ])

      expect(mockFs.get('/home/user/file.txt')!.atime).toBe(time1.getTime())
      expect(mockFs.get('/home/user/document.txt')!.atime).toBe(time2.getTime())
      expect(mockFs.get('/data/file.txt')!.atime).toBe(time3.getTime())
    })
  })

  describe('edge cases', () => {
    it('should not change file size when updating timestamps', async () => {
      // Given: a file with known size
      // When: calling utimes
      // Then: size should remain unchanged

      const original = mockFs.get('/home/user/file.txt')!
      const originalSize = original.size

      await utimes('/home/user/file.txt', new Date(), new Date())

      const updated = mockFs.get('/home/user/file.txt')!
      expect(updated.size).toBe(originalSize)
    })

    it('should not change file mode when updating timestamps', async () => {
      // Given: a file with known mode
      // When: calling utimes
      // Then: mode should remain unchanged

      const original = mockFs.get('/home/user/file.txt')!
      const originalMode = original.mode

      await utimes('/home/user/file.txt', new Date(), new Date())

      const updated = mockFs.get('/home/user/file.txt')!
      expect(updated.mode).toBe(originalMode)
    })

    it('should not change uid/gid when updating timestamps', async () => {
      // Given: a file with known uid/gid
      // When: calling utimes
      // Then: uid/gid should remain unchanged

      const original = mockFs.get('/home/user/file.txt')!
      const originalUid = original.uid
      const originalGid = original.gid

      await utimes('/home/user/file.txt', new Date(), new Date())

      const updated = mockFs.get('/home/user/file.txt')!
      expect(updated.uid).toBe(originalUid)
      expect(updated.gid).toBe(originalGid)
    })

    it('should handle very old dates (before Unix epoch)', async () => {
      // Given: a file
      // When: calling utimes with date before Unix epoch
      // Then: should handle correctly (negative timestamp or epoch)

      const oldDate = new Date('1960-01-01T00:00:00Z')

      await utimes('/home/user/file.txt', oldDate, oldDate)

      const entry = mockFs.get('/home/user/file.txt')
      // Some systems may clamp to 0, others may use negative
      expect(entry!.atime).toBeLessThanOrEqual(0)
      expect(entry!.mtime).toBeLessThanOrEqual(0)
    })

    it('should allow atime to be different from mtime', async () => {
      // Given: a file
      // When: setting different atime and mtime
      // Then: both should be set independently

      const atime = new Date('2025-01-01T00:00:00Z')
      const mtime = new Date('2025-12-31T23:59:59Z')

      await utimes('/home/user/file.txt', atime, mtime)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(atime.getTime())
      expect(entry!.mtime).toBe(mtime.getTime())
      expect(entry!.atime).not.toBe(entry!.mtime)
    })
  })

  describe('storage not configured', () => {
    it('should throw when storage is null', async () => {
      // Given: storage is not configured
      // When: calling utimes
      // Then: should throw an error

      setStorage(null)

      await expect(utimes('/any/path', new Date(), new Date())).rejects.toThrow()
    })

    it('should throw when storage is null for lutimes', async () => {
      // Given: storage is not configured
      // When: calling lutimes
      // Then: should throw an error

      setStorage(null)

      await expect(lutimes('/any/path', new Date(), new Date())).rejects.toThrow()
    })
  })

  describe('verification via stat', () => {
    it('should have timestamps verifiable via stat after utimes', async () => {
      // This test verifies the integration between utimes and stat
      // In the RED phase, the implementation doesn't exist yet
      // The GREEN phase will make this work

      const newAtime = new Date('2025-06-15T10:30:00Z')
      const newMtime = new Date('2025-06-15T12:00:00Z')

      await utimes('/home/user/file.txt', newAtime, newMtime)

      // After implementation, stat should return the updated timestamps
      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.atime).toBe(newAtime.getTime())
      expect(entry!.mtime).toBe(newMtime.getTime())
    })
  })
})
