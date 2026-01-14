/**
 * Tests for chown and lchown operations (RED phase - should fail)
 *
 * chown changes the owner (uid) and group (gid) of a file or directory.
 * lchown changes the owner/group of a symbolic link itself (doesn't follow).
 *
 * POSIX behavior:
 * - chown(path, uid, gid) follows symlinks and changes target ownership
 * - lchown(path, uid, gid) changes the symlink's ownership (not target)
 * - Use -1 to leave uid or gid unchanged
 * - Updates ctime on change
 * - Throws ENOENT if path doesn't exist
 * - Throws EPERM if operation not permitted (non-root changing ownership)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chown, lchown, setStorage, type ChownStorage } from './chown'
import { type FileEntry, type FileType } from '../types'
import { ENOENT, EPERM } from '../errors'
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

describe('chown', () => {
  // Mock filesystem for testing
  let mockFs: Map<string, FileEntry>
  // Current user context
  let currentUid: number
  let currentGid: number
  let isRoot: boolean

  beforeEach(() => {
    mockFs = new Map()
    currentUid = 1000
    currentGid = 1000
    isRoot = false

    // Root directory
    mockFs.set('/', createEntry('/', 'directory', { id: '1', mode: 0o755, uid: 0, gid: 0 }))

    // /home directory structure
    mockFs.set('/home', createEntry('/home', 'directory', { id: '2', mode: 0o755 }))
    mockFs.set('/home/user', createEntry('/home/user', 'directory', { id: '3', mode: 0o755 }))

    // Regular file owned by current user
    mockFs.set('/home/user/file.txt', createEntry('/home/user/file.txt', 'file', {
      id: '4',
      size: 100,
      mode: 0o644,
      uid: 1000,
      gid: 1000,
    }))

    // File owned by different user
    mockFs.set('/home/user/other-file.txt', createEntry('/home/user/other-file.txt', 'file', {
      id: '5',
      size: 50,
      mode: 0o644,
      uid: 2000,
      gid: 2000,
    }))

    // Directory owned by current user
    mockFs.set('/home/user/mydir', createEntry('/home/user/mydir', 'directory', {
      id: '6',
      mode: 0o755,
      uid: 1000,
      gid: 1000,
    }))

    // File owned by root
    mockFs.set('/home/user/root-file.txt', createEntry('/home/user/root-file.txt', 'file', {
      id: '7',
      size: 30,
      mode: 0o644,
      uid: 0,
      gid: 0,
    }))

    // /data directory with files
    mockFs.set('/data', createEntry('/data', 'directory', { id: '10', mode: 0o755 }))
    mockFs.set('/data/file.txt', createEntry('/data/file.txt', 'file', {
      id: '11',
      size: 100,
      mode: 0o644,
      uid: 1000,
      gid: 1000,
    }))

    // /links directory with symlinks
    mockFs.set('/links', createEntry('/links', 'directory', { id: '20', mode: 0o755 }))
    mockFs.set('/links/file-link', createEntry('/links/file-link', 'symlink', {
      id: '21',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
      uid: 1000,
      gid: 1000,
    }))
    mockFs.set('/links/dir-link', createEntry('/links/dir-link', 'symlink', {
      id: '22',
      linkTarget: '/data',
      size: 5,
      mode: 0o777,
      uid: 1000,
      gid: 1000,
    }))
    mockFs.set('/links/broken-link', createEntry('/links/broken-link', 'symlink', {
      id: '23',
      linkTarget: '/nonexistent/target',
      size: 19,
      mode: 0o777,
      uid: 1000,
      gid: 1000,
    }))

    // Chain of symlinks: link1 -> link2 -> /data/file.txt
    mockFs.set('/links/link2', createEntry('/links/link2', 'symlink', {
      id: '24',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
      uid: 1000,
      gid: 1000,
    }))
    mockFs.set('/links/link1', createEntry('/links/link1', 'symlink', {
      id: '25',
      linkTarget: '/links/link2',
      size: 12,
      mode: 0o777,
      uid: 1000,
      gid: 1000,
    }))

    // Create storage adapter
    const storage: ChownStorage = {
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
      getUid: () => currentUid,
      getGid: () => currentGid,
      isRoot: () => isRoot,
    }
    setStorage(storage)
  })

  afterEach(() => {
    setStorage(null)
  })

  describe('basic chown on files', () => {
    it('should change uid of a file', async () => {
      // Given: a file owned by uid 1000
      // When: calling chown to change uid to 2000
      // Then: the file's uid should be updated

      isRoot = true // Root can change ownership
      await chown('/home/user/file.txt', 2000, -1)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(2000)
      expect(entry?.gid).toBe(1000) // gid unchanged
    })

    it('should change gid of a file', async () => {
      // Given: a file owned by gid 1000
      // When: calling chown to change gid to 2000
      // Then: the file's gid should be updated

      isRoot = true
      await chown('/home/user/file.txt', -1, 2000)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(1000) // uid unchanged
      expect(entry?.gid).toBe(2000)
    })

    it('should change both uid and gid of a file', async () => {
      // Given: a file owned by uid 1000, gid 1000
      // When: calling chown to change both
      // Then: both uid and gid should be updated

      isRoot = true
      await chown('/home/user/file.txt', 2000, 3000)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(2000)
      expect(entry?.gid).toBe(3000)
    })

    it('should leave uid unchanged when -1 is passed', async () => {
      // Given: a file owned by uid 1000
      // When: calling chown with uid = -1
      // Then: uid should remain 1000

      isRoot = true
      await chown('/home/user/file.txt', -1, 2000)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(1000)
    })

    it('should leave gid unchanged when -1 is passed', async () => {
      // Given: a file owned by gid 1000
      // When: calling chown with gid = -1
      // Then: gid should remain 1000

      isRoot = true
      await chown('/home/user/file.txt', 2000, -1)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.gid).toBe(1000)
    })

    it('should leave both unchanged when both are -1', async () => {
      // Given: a file owned by uid 1000, gid 1000
      // When: calling chown with both = -1
      // Then: both should remain unchanged

      isRoot = true
      await chown('/home/user/file.txt', -1, -1)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(1000)
      expect(entry?.gid).toBe(1000)
    })
  })

  describe('chown on directories', () => {
    it('should change uid of a directory', async () => {
      // Given: a directory owned by uid 1000
      // When: calling chown to change uid
      // Then: the directory's uid should be updated

      isRoot = true
      await chown('/home/user/mydir', 2000, -1)

      const entry = mockFs.get('/home/user/mydir')
      expect(entry?.uid).toBe(2000)
    })

    it('should change gid of a directory', async () => {
      // Given: a directory owned by gid 1000
      // When: calling chown to change gid
      // Then: the directory's gid should be updated

      isRoot = true
      await chown('/home/user/mydir', -1, 2000)

      const entry = mockFs.get('/home/user/mydir')
      expect(entry?.gid).toBe(2000)
    })

    it('should change both uid and gid of a directory', async () => {
      // Given: a directory owned by uid 1000, gid 1000
      // When: calling chown to change both
      // Then: both uid and gid should be updated

      isRoot = true
      await chown('/home/user/mydir', 2000, 3000)

      const entry = mockFs.get('/home/user/mydir')
      expect(entry?.uid).toBe(2000)
      expect(entry?.gid).toBe(3000)
    })
  })

  describe('ctime updates', () => {
    it('should update ctime when ownership changes', async () => {
      // Given: a file with a known ctime
      // When: calling chown
      // Then: ctime should be updated to current time

      isRoot = true
      const originalEntry = mockFs.get('/home/user/file.txt')
      const originalCtime = originalEntry?.ctime

      // Wait a tiny bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10))

      await chown('/home/user/file.txt', 2000, 2000)

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry?.ctime).toBeGreaterThan(originalCtime!)
    })

    it('should not update mtime when ownership changes', async () => {
      // Given: a file with a known mtime
      // When: calling chown
      // Then: mtime should remain unchanged

      isRoot = true
      const originalEntry = mockFs.get('/home/user/file.txt')
      const originalMtime = originalEntry?.mtime

      await chown('/home/user/file.txt', 2000, 2000)

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry?.mtime).toBe(originalMtime)
    })

    it('should not update atime when ownership changes', async () => {
      // Given: a file with a known atime
      // When: calling chown
      // Then: atime should remain unchanged

      isRoot = true
      const originalEntry = mockFs.get('/home/user/file.txt')
      const originalAtime = originalEntry?.atime

      await chown('/home/user/file.txt', 2000, 2000)

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry?.atime).toBe(originalAtime)
    })
  })

  describe('symlink handling (chown follows symlinks)', () => {
    it('should change ownership of symlink target, not symlink itself', async () => {
      // Given: symlink at /links/file-link pointing to /data/file.txt
      // When: calling chown on the symlink
      // Then: the target file's ownership should change, not the symlink's

      isRoot = true
      await chown('/links/file-link', 2000, 2000)

      const targetEntry = mockFs.get('/data/file.txt')
      const linkEntry = mockFs.get('/links/file-link')

      expect(targetEntry?.uid).toBe(2000)
      expect(targetEntry?.gid).toBe(2000)
      expect(linkEntry?.uid).toBe(1000) // Link unchanged
      expect(linkEntry?.gid).toBe(1000)
    })

    it('should follow chain of symlinks', async () => {
      // Given: link1 -> link2 -> /data/file.txt
      // When: calling chown on link1
      // Then: the final target's ownership should change

      isRoot = true
      await chown('/links/link1', 2000, 2000)

      const targetEntry = mockFs.get('/data/file.txt')
      const link1Entry = mockFs.get('/links/link1')
      const link2Entry = mockFs.get('/links/link2')

      expect(targetEntry?.uid).toBe(2000)
      expect(targetEntry?.gid).toBe(2000)
      expect(link1Entry?.uid).toBe(1000) // Links unchanged
      expect(link2Entry?.uid).toBe(1000)
    })

    it('should throw ENOENT for broken symlink', async () => {
      // Given: symlink pointing to non-existent target
      // When: calling chown on the broken symlink
      // Then: should throw ENOENT

      isRoot = true
      await expect(chown('/links/broken-link', 2000, 2000)).rejects.toThrow(ENOENT)
    })

    it('should change ownership of directory through symlink', async () => {
      // Given: symlink to a directory
      // When: calling chown on the symlink
      // Then: the directory's ownership should change

      isRoot = true
      await chown('/links/dir-link', 2000, 2000)

      const targetEntry = mockFs.get('/data')
      expect(targetEntry?.uid).toBe(2000)
      expect(targetEntry?.gid).toBe(2000)
    })
  })

  describe('lchown - change symlink ownership directly', () => {
    it('should change ownership of symlink itself, not target', async () => {
      // Given: symlink at /links/file-link pointing to /data/file.txt
      // When: calling lchown on the symlink
      // Then: the symlink's ownership should change, not the target's

      isRoot = true
      await lchown('/links/file-link', 2000, 2000)

      const linkEntry = mockFs.get('/links/file-link')
      const targetEntry = mockFs.get('/data/file.txt')

      expect(linkEntry?.uid).toBe(2000)
      expect(linkEntry?.gid).toBe(2000)
      expect(targetEntry?.uid).toBe(1000) // Target unchanged
      expect(targetEntry?.gid).toBe(1000)
    })

    it('should change uid of symlink only', async () => {
      // Given: symlink owned by uid 1000
      // When: calling lchown to change uid
      // Then: symlink's uid should be updated

      isRoot = true
      await lchown('/links/file-link', 2000, -1)

      const linkEntry = mockFs.get('/links/file-link')
      expect(linkEntry?.uid).toBe(2000)
      expect(linkEntry?.gid).toBe(1000)
    })

    it('should change gid of symlink only', async () => {
      // Given: symlink owned by gid 1000
      // When: calling lchown to change gid
      // Then: symlink's gid should be updated

      isRoot = true
      await lchown('/links/file-link', -1, 2000)

      const linkEntry = mockFs.get('/links/file-link')
      expect(linkEntry?.uid).toBe(1000)
      expect(linkEntry?.gid).toBe(2000)
    })

    it('should work on broken symlink', async () => {
      // Given: symlink pointing to non-existent target
      // When: calling lchown
      // Then: should succeed (changes symlink, not target)

      isRoot = true
      await lchown('/links/broken-link', 2000, 2000)

      const linkEntry = mockFs.get('/links/broken-link')
      expect(linkEntry?.uid).toBe(2000)
      expect(linkEntry?.gid).toBe(2000)
    })

    it('should update ctime of symlink when ownership changes', async () => {
      // Given: a symlink with known ctime
      // When: calling lchown
      // Then: symlink's ctime should be updated

      isRoot = true
      const originalEntry = mockFs.get('/links/file-link')
      const originalCtime = originalEntry?.ctime

      await new Promise(resolve => setTimeout(resolve, 10))

      await lchown('/links/file-link', 2000, 2000)

      const updatedEntry = mockFs.get('/links/file-link')
      expect(updatedEntry?.ctime).toBeGreaterThan(originalCtime!)
    })

    it('should work on regular file (same as chown)', async () => {
      // Given: a regular file
      // When: calling lchown
      // Then: should change file's ownership (same behavior as chown for non-symlinks)

      isRoot = true
      await lchown('/home/user/file.txt', 2000, 2000)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(2000)
      expect(entry?.gid).toBe(2000)
    })
  })

  describe('ENOENT - file does not exist', () => {
    it('should throw ENOENT for non-existent file', async () => {
      // Given: path does not exist
      // When: calling chown
      // Then: should throw ENOENT

      isRoot = true
      await expect(chown('/nonexistent/file.txt', 2000, 2000)).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT for non-existent directory', async () => {
      // Given: directory does not exist
      // When: calling chown
      // Then: should throw ENOENT

      isRoot = true
      await expect(chown('/nonexistent/dir', 2000, 2000)).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when parent directory does not exist', async () => {
      // Given: parent directory does not exist
      // When: calling chown
      // Then: should throw ENOENT

      isRoot = true
      await expect(chown('/nonexistent/parent/file.txt', 2000, 2000)).rejects.toThrow(ENOENT)
    })

    it('should include syscall = "chown" in ENOENT error', async () => {
      // Given: non-existent path
      // When: chown throws ENOENT
      // Then: error.syscall should be 'chown'

      isRoot = true
      try {
        await chown('/nonexistent/file.txt', 2000, 2000)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('chown')
      }
    })

    it('should include correct path in ENOENT error', async () => {
      // Given: non-existent path
      // When: chown throws ENOENT
      // Then: error.path should be the requested path

      isRoot = true
      try {
        await chown('/some/missing/file.txt', 2000, 2000)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).path).toBe('/some/missing/file.txt')
      }
    })

    it('should include errno = -2 in ENOENT error', async () => {
      // Given: non-existent path
      // When: chown throws ENOENT
      // Then: error.errno should be -2

      isRoot = true
      try {
        await chown('/nonexistent', 2000, 2000)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).errno).toBe(-2)
      }
    })

    it('lchown should throw ENOENT for non-existent path', async () => {
      // Given: path does not exist
      // When: calling lchown
      // Then: should throw ENOENT

      isRoot = true
      await expect(lchown('/nonexistent/file.txt', 2000, 2000)).rejects.toThrow(ENOENT)
    })

    it('lchown should include syscall = "lchown" in ENOENT error', async () => {
      // Given: non-existent path
      // When: lchown throws ENOENT
      // Then: error.syscall should be 'lchown'

      isRoot = true
      try {
        await lchown('/nonexistent/file.txt', 2000, 2000)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('lchown')
      }
    })
  })

  describe('EPERM - operation not permitted', () => {
    it('should throw EPERM when non-root tries to change uid', async () => {
      // Given: regular user (non-root)
      // When: trying to change file uid
      // Then: should throw EPERM

      isRoot = false
      currentUid = 1000
      await expect(chown('/home/user/file.txt', 2000, -1)).rejects.toThrow(EPERM)
    })

    it('should throw EPERM when non-owner tries to change gid to non-member group', async () => {
      // Given: regular user not in target group
      // When: trying to change file gid to a group they're not in
      // Then: should throw EPERM

      isRoot = false
      currentUid = 1000
      // Trying to change to group 9999 which user is not a member of
      await expect(chown('/home/user/file.txt', -1, 9999)).rejects.toThrow(EPERM)
    })

    it('should throw EPERM when trying to chown file owned by another user', async () => {
      // Given: file owned by different user
      // When: non-root tries to chown
      // Then: should throw EPERM

      isRoot = false
      currentUid = 1000
      await expect(chown('/home/user/other-file.txt', 2000, 2000)).rejects.toThrow(EPERM)
    })

    it('should include syscall = "chown" in EPERM error', async () => {
      // Given: non-root user
      // When: chown throws EPERM
      // Then: error.syscall should be 'chown'

      isRoot = false
      try {
        await chown('/home/user/file.txt', 2000, -1)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).syscall).toBe('chown')
      }
    })

    it('should include correct path in EPERM error', async () => {
      // Given: non-root user
      // When: chown throws EPERM
      // Then: error.path should be the requested path

      isRoot = false
      try {
        await chown('/home/user/file.txt', 2000, -1)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).path).toBe('/home/user/file.txt')
      }
    })

    it('should include errno = -1 in EPERM error', async () => {
      // Given: non-root user
      // When: chown throws EPERM
      // Then: error.errno should be -1

      isRoot = false
      try {
        await chown('/home/user/file.txt', 2000, -1)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).errno).toBe(-1)
      }
    })

    it('lchown should throw EPERM for unauthorized change', async () => {
      // Given: non-root user
      // When: trying to lchown
      // Then: should throw EPERM

      isRoot = false
      await expect(lchown('/links/file-link', 2000, -1)).rejects.toThrow(EPERM)
    })

    it('lchown should include syscall = "lchown" in EPERM error', async () => {
      // Given: non-root user
      // When: lchown throws EPERM
      // Then: error.syscall should be 'lchown'

      isRoot = false
      try {
        await lchown('/links/file-link', 2000, -1)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).syscall).toBe('lchown')
      }
    })
  })

  describe('path handling', () => {
    it('should handle absolute paths', async () => {
      // Given: an absolute path
      // When: calling chown
      // Then: should work correctly

      isRoot = true
      await chown('/data/file.txt', 2000, 2000)

      const entry = mockFs.get('/data/file.txt')
      expect(entry?.uid).toBe(2000)
    })

    it('should normalize paths with double slashes', async () => {
      // Given: path with double slashes
      // When: calling chown
      // Then: should normalize and work

      isRoot = true
      await chown('/data//file.txt', 2000, 2000)

      const entry = mockFs.get('/data/file.txt')
      expect(entry?.uid).toBe(2000)
    })

    it('should normalize paths with dot segments', async () => {
      // Given: path with ./
      // When: calling chown
      // Then: should normalize and work

      isRoot = true
      await chown('/data/./file.txt', 2000, 2000)

      const entry = mockFs.get('/data/file.txt')
      expect(entry?.uid).toBe(2000)
    })

    it('should normalize paths with parent directory segments', async () => {
      // Given: path with ../
      // When: calling chown
      // Then: should normalize and work

      isRoot = true
      await chown('/data/../data/file.txt', 2000, 2000)

      const entry = mockFs.get('/data/file.txt')
      expect(entry?.uid).toBe(2000)
    })

    it('should handle trailing slashes for directories', async () => {
      // Given: directory path with trailing slash
      // When: calling chown
      // Then: should work

      isRoot = true
      await chown('/data/', 2000, 2000)

      const entry = mockFs.get('/data')
      expect(entry?.uid).toBe(2000)
    })

    it('should handle root path', async () => {
      // Given: root path
      // When: calling chown
      // Then: should work (if permitted)

      isRoot = true
      await chown('/', 2000, 2000)

      const entry = mockFs.get('/')
      expect(entry?.uid).toBe(2000)
    })
  })

  describe('numeric id handling', () => {
    it('should accept uid = 0 (root)', async () => {
      // Given: valid uid 0
      // When: calling chown
      // Then: should set uid to 0

      isRoot = true
      await chown('/home/user/file.txt', 0, -1)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(0)
    })

    it('should accept gid = 0 (root group)', async () => {
      // Given: valid gid 0
      // When: calling chown
      // Then: should set gid to 0

      isRoot = true
      await chown('/home/user/file.txt', -1, 0)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.gid).toBe(0)
    })

    it('should accept large uid values', async () => {
      // Given: large uid value (e.g., 65534 - nobody)
      // When: calling chown
      // Then: should set uid correctly

      isRoot = true
      await chown('/home/user/file.txt', 65534, -1)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.uid).toBe(65534)
    })

    it('should accept large gid values', async () => {
      // Given: large gid value
      // When: calling chown
      // Then: should set gid correctly

      isRoot = true
      await chown('/home/user/file.txt', -1, 65534)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry?.gid).toBe(65534)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent chown calls on same file', async () => {
      // Given: a file
      // When: calling chown concurrently multiple times
      // Then: all calls should succeed (last one wins)

      isRoot = true
      const promises = [
        chown('/data/file.txt', 2000, 2000),
        chown('/data/file.txt', 3000, 3000),
        chown('/data/file.txt', 4000, 4000),
      ]

      await Promise.all(promises)

      const entry = mockFs.get('/data/file.txt')
      // Final state depends on execution order
      expect(entry?.uid).toBeGreaterThanOrEqual(2000)
      expect(entry?.gid).toBeGreaterThanOrEqual(2000)
    })

    it('should handle concurrent chown calls on different files', async () => {
      // Given: multiple files
      // When: calling chown concurrently on different files
      // Then: all calls should succeed

      isRoot = true

      // Add more files for concurrent testing
      mockFs.set('/data/file2.txt', createEntry('/data/file2.txt', 'file', {
        id: '12',
        uid: 1000,
        gid: 1000,
      }))
      mockFs.set('/data/file3.txt', createEntry('/data/file3.txt', 'file', {
        id: '13',
        uid: 1000,
        gid: 1000,
      }))

      const promises = [
        chown('/data/file.txt', 2000, 2000),
        chown('/data/file2.txt', 3000, 3000),
        chown('/data/file3.txt', 4000, 4000),
      ]

      await Promise.all(promises)

      expect(mockFs.get('/data/file.txt')?.uid).toBe(2000)
      expect(mockFs.get('/data/file2.txt')?.uid).toBe(3000)
      expect(mockFs.get('/data/file3.txt')?.uid).toBe(4000)
    })
  })

  describe('edge cases', () => {
    it('should handle files with special permission bits (setuid)', async () => {
      // Given: file with setuid bit
      // When: calling chown
      // Then: should change ownership without affecting mode

      mockFs.set('/home/user/setuid-file', createEntry('/home/user/setuid-file', 'file', {
        id: '100',
        mode: 0o4755, // setuid + rwxr-xr-x
        uid: 1000,
        gid: 1000,
      }))

      isRoot = true
      await chown('/home/user/setuid-file', 2000, 2000)

      const entry = mockFs.get('/home/user/setuid-file')
      expect(entry?.uid).toBe(2000)
      expect(entry?.gid).toBe(2000)
      // Note: In real POSIX, setuid/setgid bits may be cleared on chown
      // The implementation may or may not clear them
    })

    it('should handle files with sticky bit', async () => {
      // Given: directory with sticky bit
      // When: calling chown
      // Then: should change ownership

      mockFs.set('/tmp', createEntry('/tmp', 'directory', {
        id: '101',
        mode: 0o1777, // sticky + rwxrwxrwx
        uid: 0,
        gid: 0,
      }))

      isRoot = true
      await chown('/tmp', 1000, 1000)

      const entry = mockFs.get('/tmp')
      expect(entry?.uid).toBe(1000)
      expect(entry?.gid).toBe(1000)
    })

    it('should handle empty filename component gracefully', async () => {
      // Given: path that normalizes to have empty components
      // When: calling chown
      // Then: should handle appropriately (normalize or error)

      isRoot = true
      // /data///file.txt should normalize to /data/file.txt
      await chown('/data///file.txt', 2000, 2000)

      const entry = mockFs.get('/data/file.txt')
      expect(entry?.uid).toBe(2000)
    })
  })
})
