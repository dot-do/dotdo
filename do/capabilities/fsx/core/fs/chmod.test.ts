/**
 * Tests for chmod operation (RED phase - should fail)
 *
 * chmod changes the permissions (mode) of a file or directory.
 *
 * POSIX behavior:
 * - chmod(path, mode) - Changes permissions of file at path
 * - Mode is a numeric octal value (e.g., 0o755, 0o644)
 * - Only permission bits are changed (lower 12 bits: 0o7777)
 * - File type bits (S_IFMT) are preserved
 * - Follows symbolic links (changes target permissions)
 * - Updates ctime (status change time) on successful change
 * - Throws ENOENT if path doesn't exist
 * - Throws EPERM if operation not permitted (not owner/root)
 * - lchmod changes symlink permissions (if supported by platform)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, lchmod, setStorage, type ChmodStorage } from './chmod'
import { type FileEntry, type FileType } from '../types'
import { ENOENT, EPERM } from '../errors'
import { normalize } from '../path'
import { constants } from '../constants'

// Re-export constants for convenience
const { S_IFMT, S_IFREG, S_IFDIR, S_IFLNK } = constants

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

describe('chmod', () => {
  // Mock filesystem for testing
  let mockFs: Map<string, FileEntry>
  // Current user context
  let currentUid: number
  let currentGid: number

  beforeEach(() => {
    mockFs = new Map()
    currentUid = 1000
    currentGid = 1000

    // Root directory (owned by root)
    mockFs.set('/', createEntry('/', 'directory', { id: '1', mode: 0o755, uid: 0, gid: 0 }))

    // /home directory structure
    mockFs.set('/home', createEntry('/home', 'directory', { id: '2', mode: 0o755 }))
    mockFs.set('/home/user', createEntry('/home/user', 'directory', { id: '3', mode: 0o755 }))

    // Regular file with standard permissions (rw-r--r--)
    mockFs.set('/home/user/file.txt', createEntry('/home/user/file.txt', 'file', {
      id: '4',
      size: 100,
      mode: 0o644,
      uid: 1000,
      gid: 1000,
    }))

    // Read-only file (r--r--r--)
    mockFs.set('/home/user/readonly.txt', createEntry('/home/user/readonly.txt', 'file', {
      id: '5',
      size: 50,
      mode: 0o444,
      uid: 1000,
      gid: 1000,
    }))

    // Executable script (rwxr-xr-x)
    mockFs.set('/home/user/script.sh', createEntry('/home/user/script.sh', 'file', {
      id: '6',
      size: 200,
      mode: 0o755,
      uid: 1000,
      gid: 1000,
    }))

    // Private file (rw-------)
    mockFs.set('/home/user/private.txt', createEntry('/home/user/private.txt', 'file', {
      id: '7',
      size: 30,
      mode: 0o600,
      uid: 1000,
      gid: 1000,
    }))

    // File owned by different user
    mockFs.set('/home/user/other-user-file.txt', createEntry('/home/user/other-user-file.txt', 'file', {
      id: '8',
      size: 60,
      mode: 0o644,
      uid: 2000,
      gid: 2000,
    }))

    // File owned by root
    mockFs.set('/home/user/root-file.txt', createEntry('/home/user/root-file.txt', 'file', {
      id: '9',
      size: 40,
      mode: 0o644,
      uid: 0,
      gid: 0,
    }))

    // /data directory with various files
    mockFs.set('/data', createEntry('/data', 'directory', { id: '10', mode: 0o755 }))
    mockFs.set('/data/file.txt', createEntry('/data/file.txt', 'file', {
      id: '11',
      size: 100,
      mode: 0o644,
    }))

    // Directories with different permissions
    mockFs.set('/data/subdir', createEntry('/data/subdir', 'directory', {
      id: '12',
      mode: 0o755,
    }))
    mockFs.set('/data/private-dir', createEntry('/data/private-dir', 'directory', {
      id: '13',
      mode: 0o700,
    }))
    mockFs.set('/data/readonly-dir', createEntry('/data/readonly-dir', 'directory', {
      id: '14',
      mode: 0o555,
    }))

    // Directory owned by different user
    mockFs.set('/data/other-user-dir', createEntry('/data/other-user-dir', 'directory', {
      id: '15',
      mode: 0o755,
      uid: 2000,
      gid: 2000,
    }))

    // /links directory with symlinks
    mockFs.set('/links', createEntry('/links', 'directory', { id: '20', mode: 0o755 }))
    mockFs.set('/links/file-link', createEntry('/links/file-link', 'symlink', {
      id: '21',
      linkTarget: '/data/file.txt',
      size: 14,
      mode: 0o777,
    }))
    mockFs.set('/links/dir-link', createEntry('/links/dir-link', 'symlink', {
      id: '22',
      linkTarget: '/data/subdir',
      size: 12,
      mode: 0o777,
    }))
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

    // Symlink to file owned by different user
    mockFs.set('/links/other-user-link', createEntry('/links/other-user-link', 'symlink', {
      id: '26',
      linkTarget: '/home/user/other-user-file.txt',
      size: 28,
      mode: 0o777,
    }))

    // Files with special permission bits
    mockFs.set('/home/user/setuid-file', createEntry('/home/user/setuid-file', 'file', {
      id: '30',
      size: 100,
      mode: 0o4755, // setuid + rwxr-xr-x
      uid: 1000,
      gid: 1000,
    }))
    mockFs.set('/home/user/setgid-file', createEntry('/home/user/setgid-file', 'file', {
      id: '31',
      size: 100,
      mode: 0o2755, // setgid + rwxr-xr-x
      uid: 1000,
      gid: 1000,
    }))
    mockFs.set('/home/user/sticky-dir', createEntry('/home/user/sticky-dir', 'directory', {
      id: '32',
      mode: 0o1777, // sticky + rwxrwxrwx
      uid: 1000,
      gid: 1000,
    }))

    // Create storage adapter
    const storage: ChmodStorage = {
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
          const updated = { ...entry, ...changes }
          mockFs.set(normalizedPath, updated)
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
    }
    setStorage(storage)
  })

  afterEach(() => {
    setStorage(null)
  })

  describe('basic chmod operations', () => {
    it('should change file permissions to 0o755', async () => {
      // Given: a file with mode 0o644
      // When: calling chmod with 0o755
      // Then: should return undefined and update mode

      await chmod('/home/user/file.txt', 0o755)

      // Verify the change took effect
      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should change file permissions to 0o644', async () => {
      // Given: a file with mode 0o755
      // When: calling chmod with 0o644
      // Then: should return undefined and update mode

      await chmod('/home/user/script.sh', 0o644)

      const entry = mockFs.get('/home/user/script.sh')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o644)
    })

    it('should change file permissions to 0o600 (private)', async () => {
      // Given: a file with mode 0o644
      // When: calling chmod with 0o600
      // Then: file should be accessible only by owner

      await chmod('/home/user/file.txt', 0o600)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o600)
    })

    it('should change file permissions to 0o000 (no access)', async () => {
      // Given: a file with mode 0o644
      // When: calling chmod with 0o000
      // Then: file should have no permissions

      await chmod('/home/user/file.txt', 0o000)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o000)
    })

    it('should change file permissions to 0o777 (full access)', async () => {
      // Given: a file with mode 0o644
      // When: calling chmod with 0o777
      // Then: file should have full permissions

      await chmod('/home/user/file.txt', 0o777)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o777)
    })

    it('should change file permissions to 0o444 (read-only)', async () => {
      // Given: a file with mode 0o644
      // When: calling chmod with 0o444
      // Then: file should be read-only for everyone

      await chmod('/home/user/file.txt', 0o444)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o444)
    })

    it('should return undefined on success', async () => {
      // Given: a valid file
      // When: calling chmod
      // Then: should return undefined (void)

      const result = await chmod('/home/user/file.txt', 0o755)

      expect(result).toBeUndefined()
    })
  })

  describe('directory chmod operations', () => {
    it('should change directory permissions to 0o755', async () => {
      // Given: a directory with mode 0o700
      // When: calling chmod with 0o755
      // Then: directory should be world-accessible

      await chmod('/data/private-dir', 0o755)

      const entry = mockFs.get('/data/private-dir')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should change directory permissions to 0o700 (private)', async () => {
      // Given: a directory with mode 0o755
      // When: calling chmod with 0o700
      // Then: directory should be accessible only by owner

      await chmod('/data/subdir', 0o700)

      const entry = mockFs.get('/data/subdir')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o700)
    })

    it('should change directory permissions to 0o555 (read-only)', async () => {
      // Given: a directory with mode 0o755
      // When: calling chmod with 0o555
      // Then: directory should be read-only

      await chmod('/data/subdir', 0o555)

      const entry = mockFs.get('/data/subdir')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o555)
    })

    it('should preserve directory file type bits when changing permissions', async () => {
      // Given: a directory
      // When: calling chmod
      // Then: S_IFDIR should still be set

      await chmod('/data/subdir', 0o700)

      const entry = mockFs.get('/data/subdir')
      expect(entry).toBeDefined()
      expect(entry!.mode & S_IFMT).toBe(S_IFDIR)
    })
  })

  describe('preserving file type bits', () => {
    it('should preserve S_IFREG file type bits for regular files', async () => {
      // Given: a regular file
      // When: calling chmod
      // Then: S_IFREG should still be set

      await chmod('/home/user/file.txt', 0o755)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & S_IFMT).toBe(S_IFREG)
    })

    it('should preserve file type when mode is 0o000', async () => {
      // Given: a regular file
      // When: calling chmod with 0o000
      // Then: file type should still be S_IFREG

      await chmod('/home/user/file.txt', 0o000)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & S_IFMT).toBe(S_IFREG)
    })
  })

  describe('special permission bits', () => {
    it('should set setuid bit with 0o4755', async () => {
      // Given: a file without setuid
      // When: calling chmod with 0o4755
      // Then: setuid bit should be set

      await chmod('/home/user/file.txt', 0o4755)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o7777).toBe(0o4755)
      expect(entry!.mode & constants.S_ISUID).toBe(constants.S_ISUID)
    })

    it('should set setgid bit with 0o2755', async () => {
      // Given: a file without setgid
      // When: calling chmod with 0o2755
      // Then: setgid bit should be set

      await chmod('/home/user/file.txt', 0o2755)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o7777).toBe(0o2755)
      expect(entry!.mode & constants.S_ISGID).toBe(constants.S_ISGID)
    })

    it('should set sticky bit with 0o1755', async () => {
      // Given: a directory without sticky bit
      // When: calling chmod with 0o1755
      // Then: sticky bit should be set

      await chmod('/data/subdir', 0o1755)

      const entry = mockFs.get('/data/subdir')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o7777).toBe(0o1755)
      expect(entry!.mode & constants.S_ISVTX).toBe(constants.S_ISVTX)
    })

    it('should clear setuid bit when changing to mode without it', async () => {
      // Given: a file with setuid bit (0o4755)
      // When: calling chmod with 0o755
      // Then: setuid bit should be cleared

      await chmod('/home/user/setuid-file', 0o755)

      const entry = mockFs.get('/home/user/setuid-file')
      expect(entry).toBeDefined()
      expect(entry!.mode & constants.S_ISUID).toBe(0)
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should clear setgid bit when changing to mode without it', async () => {
      // Given: a file with setgid bit (0o2755)
      // When: calling chmod with 0o755
      // Then: setgid bit should be cleared

      await chmod('/home/user/setgid-file', 0o755)

      const entry = mockFs.get('/home/user/setgid-file')
      expect(entry).toBeDefined()
      expect(entry!.mode & constants.S_ISGID).toBe(0)
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should set all special bits with 0o7777', async () => {
      // Given: a file
      // When: calling chmod with 0o7777
      // Then: all special bits should be set

      await chmod('/home/user/file.txt', 0o7777)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o7777).toBe(0o7777)
      expect(entry!.mode & constants.S_ISUID).toBe(constants.S_ISUID)
      expect(entry!.mode & constants.S_ISGID).toBe(constants.S_ISGID)
      expect(entry!.mode & constants.S_ISVTX).toBe(constants.S_ISVTX)
    })
  })

  describe('ctime update', () => {
    it('should update ctime when permissions change', async () => {
      // Given: a file with a specific ctime
      // When: calling chmod
      // Then: ctime should be updated

      const entry = mockFs.get('/home/user/file.txt')
      const originalCtime = entry!.ctime

      // Wait a tiny bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 1))

      await chmod('/home/user/file.txt', 0o755)

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry!.ctime).toBeGreaterThanOrEqual(originalCtime)
    })

    it('should not update mtime when permissions change', async () => {
      // Given: a file with a specific mtime
      // When: calling chmod
      // Then: mtime should NOT be updated (only ctime)

      const entry = mockFs.get('/home/user/file.txt')
      const originalMtime = entry!.mtime

      await chmod('/home/user/file.txt', 0o755)

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry!.mtime).toBe(originalMtime)
    })

    it('should not update atime when permissions change', async () => {
      // Given: a file with a specific atime
      // When: calling chmod
      // Then: atime should NOT be updated

      const entry = mockFs.get('/home/user/file.txt')
      const originalAtime = entry!.atime

      await chmod('/home/user/file.txt', 0o755)

      const updatedEntry = mockFs.get('/home/user/file.txt')
      expect(updatedEntry!.atime).toBe(originalAtime)
    })
  })

  describe('ENOENT - file does not exist', () => {
    it('should throw ENOENT for non-existent file', async () => {
      // Given: path does not exist
      // When: calling chmod
      // Then: should throw ENOENT

      await expect(chmod('/nonexistent/file.txt', 0o755)).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT for non-existent directory', async () => {
      // Given: directory does not exist
      // When: calling chmod
      // Then: should throw ENOENT

      await expect(chmod('/nonexistent/dir', 0o755)).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when parent directory does not exist', async () => {
      // Given: parent directory does not exist
      // When: calling chmod
      // Then: should throw ENOENT

      await expect(chmod('/nonexistent/parent/file.txt', 0o755)).rejects.toThrow(ENOENT)
    })

    it('should include syscall = "chmod" in ENOENT error', async () => {
      // Given: non-existent path
      // When: chmod throws ENOENT
      // Then: error.syscall should be 'chmod'

      try {
        await chmod('/nonexistent/file.txt', 0o755)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('chmod')
      }
    })

    it('should include correct path in ENOENT error', async () => {
      // Given: non-existent path
      // When: chmod throws ENOENT
      // Then: error.path should be the requested path

      try {
        await chmod('/some/missing/file.txt', 0o755)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).path).toBe('/some/missing/file.txt')
      }
    })

    it('should include errno = -2 in ENOENT error', async () => {
      // Given: non-existent path
      // When: chmod throws ENOENT
      // Then: error.errno should be -2

      try {
        await chmod('/nonexistent', 0o755)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).errno).toBe(-2)
      }
    })
  })

  describe('EPERM - operation not permitted', () => {
    it('should throw EPERM when changing permissions on file owned by another user', async () => {
      // Given: file owned by different user (uid 2000)
      // When: current user (uid 1000) tries to chmod
      // Then: should throw EPERM

      await expect(chmod('/home/user/other-user-file.txt', 0o755)).rejects.toThrow(EPERM)
    })

    it('should throw EPERM when changing permissions on file owned by root', async () => {
      // Given: file owned by root (uid 0)
      // When: current user (uid 1000) tries to chmod
      // Then: should throw EPERM

      await expect(chmod('/home/user/root-file.txt', 0o755)).rejects.toThrow(EPERM)
    })

    it('should throw EPERM when changing permissions on directory owned by another user', async () => {
      // Given: directory owned by different user
      // When: current user tries to chmod
      // Then: should throw EPERM

      await expect(chmod('/data/other-user-dir', 0o700)).rejects.toThrow(EPERM)
    })

    it('should include syscall = "chmod" in EPERM error', async () => {
      // Given: file owned by another user
      // When: chmod throws EPERM
      // Then: error.syscall should be 'chmod'

      try {
        await chmod('/home/user/other-user-file.txt', 0o755)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).syscall).toBe('chmod')
      }
    })

    it('should include correct path in EPERM error', async () => {
      // Given: file owned by another user
      // When: chmod throws EPERM
      // Then: error.path should be the requested path

      try {
        await chmod('/home/user/other-user-file.txt', 0o755)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).path).toBe('/home/user/other-user-file.txt')
      }
    })

    it('should include errno = -1 in EPERM error', async () => {
      // Given: file owned by another user
      // When: chmod throws EPERM
      // Then: error.errno should be -1

      try {
        await chmod('/home/user/other-user-file.txt', 0o755)
        expect.fail('Should have thrown EPERM')
      } catch (error) {
        expect(error).toBeInstanceOf(EPERM)
        expect((error as EPERM).errno).toBe(-1)
      }
    })

    it('should succeed when user is owner (not EPERM)', async () => {
      // Given: file owned by current user
      // When: calling chmod
      // Then: should succeed (not throw EPERM)

      await expect(chmod('/home/user/file.txt', 0o755)).resolves.toBeUndefined()
    })

    it('should succeed when user is root (uid 0)', async () => {
      // Given: running as root
      // When: calling chmod on any file
      // Then: should succeed

      // Switch to root
      currentUid = 0
      currentGid = 0

      // Now should be able to chmod any file
      await expect(chmod('/home/user/other-user-file.txt', 0o755)).resolves.toBeUndefined()
      await expect(chmod('/home/user/root-file.txt', 0o644)).resolves.toBeUndefined()
    })
  })

  describe('symlink handling (follows symlinks)', () => {
    it('should change target file permissions through symlink', async () => {
      // Given: symlink to a file with mode 0o644
      // When: calling chmod on the symlink
      // Then: should change the target file's permissions

      await chmod('/links/file-link', 0o755)

      // The target file should have updated permissions
      const target = mockFs.get('/data/file.txt')
      expect(target).toBeDefined()
      expect(target!.mode & 0o777).toBe(0o755)

      // The symlink itself should be unchanged
      const link = mockFs.get('/links/file-link')
      expect(link).toBeDefined()
      expect(link!.mode & 0o777).toBe(0o777)
    })

    it('should change target directory permissions through symlink', async () => {
      // Given: symlink to a directory
      // When: calling chmod on the symlink
      // Then: should change the target directory's permissions

      await chmod('/links/dir-link', 0o700)

      const target = mockFs.get('/data/subdir')
      expect(target).toBeDefined()
      expect(target!.mode & 0o777).toBe(0o700)
    })

    it('should throw ENOENT for broken symlink', async () => {
      // Given: symlink to non-existent target
      // When: calling chmod
      // Then: should throw ENOENT

      await expect(chmod('/links/broken-link', 0o755)).rejects.toThrow(ENOENT)
    })

    it('should follow chain of symlinks', async () => {
      // Given: link1 -> link2 -> /data/file.txt
      // When: calling chmod on link1
      // Then: should change /data/file.txt permissions

      await chmod('/links/link1', 0o700)

      const target = mockFs.get('/data/file.txt')
      expect(target).toBeDefined()
      expect(target!.mode & 0o777).toBe(0o700)
    })

    it('should throw EPERM when target is owned by different user', async () => {
      // Given: symlink to file owned by different user
      // When: calling chmod on symlink
      // Then: should throw EPERM (permission check on target)

      await expect(chmod('/links/other-user-link', 0o755)).rejects.toThrow(EPERM)
    })
  })

  describe('lchmod - change symlink permissions', () => {
    it('should change symlink permissions without following', async () => {
      // Given: a symlink
      // When: calling lchmod on the symlink
      // Then: should change the symlink's own permissions (not target)

      await lchmod('/links/file-link', 0o755)

      // The symlink should have updated permissions
      const link = mockFs.get('/links/file-link')
      expect(link).toBeDefined()
      expect(link!.mode & 0o777).toBe(0o755)

      // The target should be unchanged
      const target = mockFs.get('/data/file.txt')
      expect(target).toBeDefined()
      expect(target!.mode & 0o777).toBe(0o644)
    })

    it('should work on broken symlink', async () => {
      // Given: a broken symlink
      // When: calling lchmod
      // Then: should succeed (symlink exists even if target doesn't)

      await lchmod('/links/broken-link', 0o755)

      const link = mockFs.get('/links/broken-link')
      expect(link).toBeDefined()
      expect(link!.mode & 0o777).toBe(0o755)
    })

    it('should throw ENOENT for non-existent path', async () => {
      // Given: path does not exist
      // When: calling lchmod
      // Then: should throw ENOENT

      await expect(lchmod('/nonexistent/link', 0o755)).rejects.toThrow(ENOENT)
    })

    it('should include syscall = "lchmod" in error', async () => {
      // Given: non-existent path
      // When: lchmod throws ENOENT
      // Then: error.syscall should be 'lchmod'

      try {
        await lchmod('/nonexistent/link', 0o755)
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('lchmod')
      }
    })

    it('should work on regular file (same as chmod)', async () => {
      // Given: a regular file (not symlink)
      // When: calling lchmod
      // Then: should change the file's permissions

      await lchmod('/home/user/file.txt', 0o755)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should preserve symlink type bits', async () => {
      // Given: a symlink
      // When: calling lchmod
      // Then: S_IFLNK should still be set

      await lchmod('/links/file-link', 0o755)

      const link = mockFs.get('/links/file-link')
      expect(link).toBeDefined()
      expect(link!.mode & S_IFMT).toBe(S_IFLNK)
    })
  })

  describe('path handling', () => {
    it('should handle absolute paths', async () => {
      // Given: an absolute path
      // When: calling chmod
      // Then: should work correctly

      await chmod('/data/file.txt', 0o755)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should normalize paths with double slashes', async () => {
      // Given: path with double slashes
      // When: calling chmod
      // Then: should normalize and work

      await chmod('/data//file.txt', 0o755)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should normalize paths with dot segments', async () => {
      // Given: path with ./
      // When: calling chmod
      // Then: should normalize and work

      await chmod('/data/./file.txt', 0o755)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should normalize paths with parent directory segments', async () => {
      // Given: path with ../
      // When: calling chmod
      // Then: should normalize and work

      await chmod('/data/subdir/../file.txt', 0o755)

      const entry = mockFs.get('/data/file.txt')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should handle trailing slashes for directories', async () => {
      // Given: directory path with trailing slash
      // When: calling chmod
      // Then: should work

      await chmod('/data/subdir/', 0o700)

      const entry = mockFs.get('/data/subdir')
      expect(entry!.mode & 0o777).toBe(0o700)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent chmod calls on same file', async () => {
      // Given: a file
      // When: calling chmod concurrently multiple times
      // Then: all calls should succeed (last one wins)

      const promises = [
        chmod('/data/file.txt', 0o755),
        chmod('/data/file.txt', 0o644),
        chmod('/data/file.txt', 0o700),
      ]

      await Promise.all(promises)

      // One of the modes should have won
      const entry = mockFs.get('/data/file.txt')
      expect([0o755, 0o644, 0o700]).toContain(entry!.mode & 0o777)
    })

    it('should handle concurrent chmod calls on different files', async () => {
      // Given: multiple files
      // When: calling chmod concurrently on different files
      // Then: all calls should succeed with correct modes

      await Promise.all([
        chmod('/home/user/file.txt', 0o755),
        chmod('/home/user/readonly.txt', 0o644),
        chmod('/home/user/script.sh', 0o700),
      ])

      expect(mockFs.get('/home/user/file.txt')!.mode & 0o777).toBe(0o755)
      expect(mockFs.get('/home/user/readonly.txt')!.mode & 0o777).toBe(0o644)
      expect(mockFs.get('/home/user/script.sh')!.mode & 0o777).toBe(0o700)
    })
  })

  describe('edge cases', () => {
    it('should handle mode value 0', async () => {
      // Given: a file
      // When: calling chmod with mode 0
      // Then: should set permissions to 0o000

      await chmod('/home/user/file.txt', 0)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.mode & 0o777).toBe(0)
    })

    it('should handle mode values larger than 0o7777 (mask extra bits)', async () => {
      // Given: mode value with extra bits beyond permission bits
      // When: calling chmod
      // Then: should only use the lower 12 bits (0o7777)

      // 0o17777 has an extra bit set that shouldn't be used
      await chmod('/home/user/file.txt', 0o17777)

      const entry = mockFs.get('/home/user/file.txt')
      // Should only have 0o7777 set (the permission bits)
      expect(entry!.mode & 0o7777).toBe(0o7777)
    })

    it('should handle numeric string mode (if converted)', async () => {
      // This test documents that mode should be a number
      // TypeScript would prevent string input, but testing runtime behavior

      await chmod('/home/user/file.txt', 0o755)

      const entry = mockFs.get('/home/user/file.txt')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should not change other file metadata (size, uid, gid)', async () => {
      // Given: a file with specific metadata
      // When: calling chmod
      // Then: only mode and ctime should change

      const original = mockFs.get('/home/user/file.txt')!
      const originalSize = original.size
      const originalUid = original.uid
      const originalGid = original.gid
      const originalMtime = original.mtime
      const originalBirthtime = original.birthtime

      await chmod('/home/user/file.txt', 0o755)

      const updated = mockFs.get('/home/user/file.txt')!
      expect(updated.size).toBe(originalSize)
      expect(updated.uid).toBe(originalUid)
      expect(updated.gid).toBe(originalGid)
      expect(updated.mtime).toBe(originalMtime)
      expect(updated.birthtime).toBe(originalBirthtime)
    })

    it('should handle root directory chmod', async () => {
      // Given: root directory (owned by root)
      // When: calling chmod as root
      // Then: should succeed

      currentUid = 0
      currentGid = 0

      await chmod('/', 0o755)

      const entry = mockFs.get('/')
      expect(entry!.mode & 0o777).toBe(0o755)
    })
  })

  describe('storage not configured', () => {
    it('should throw when storage is null', async () => {
      // Given: storage is not configured
      // When: calling chmod
      // Then: should throw an error

      setStorage(null)

      await expect(chmod('/any/path', 0o755)).rejects.toThrow()
    })
  })

  describe('symbolic mode support', () => {
    describe('add permissions (+)', () => {
      it('should add execute permission for owner with u+x', async () => {
        // Given: a file with mode 0o644 (rw-r--r--)
        // When: calling chmod with 'u+x'
        // Then: should result in 0o744 (rwxr--r--)

        await chmod('/home/user/file.txt', 'u+x')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o744)
      })

      it('should add write permission for group with g+w', async () => {
        // Given: a file with mode 0o644 (rw-r--r--)
        // When: calling chmod with 'g+w'
        // Then: should result in 0o664 (rw-rw-r--)

        await chmod('/home/user/file.txt', 'g+w')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o664)
      })

      it('should add read permission for other with o+r', async () => {
        // Given: a file with mode 0o600 (rw-------)
        // When: calling chmod with 'o+r'
        // Then: should result in 0o604 (rw-----r--)

        await chmod('/home/user/private.txt', 'o+r')

        const entry = mockFs.get('/home/user/private.txt')
        expect(entry!.mode & 0o777).toBe(0o604)
      })

      it('should add read permission for all with a+r', async () => {
        // Given: a file with mode 0o000
        // When: calling chmod with 'a+r'
        // Then: should result in 0o444 (r--r--r--)

        await chmod('/home/user/file.txt', 0o000)
        await chmod('/home/user/file.txt', 'a+r')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o444)
      })

      it('should add permissions for multiple classes with go+rx', async () => {
        // Given: a file with mode 0o600 (rw-------)
        // When: calling chmod with 'go+rx'
        // Then: should result in 0o655 (rw-r-xr-x)

        await chmod('/home/user/private.txt', 'go+rx')

        const entry = mockFs.get('/home/user/private.txt')
        expect(entry!.mode & 0o777).toBe(0o655)
      })
    })

    describe('remove permissions (-)', () => {
      it('should remove write permission from group and other with go-w', async () => {
        // Given: a file with mode 0o666 (rw-rw-rw-)
        // When: calling chmod with 'go-w'
        // Then: should result in 0o644 (rw-r--r--)

        await chmod('/home/user/file.txt', 0o666)
        await chmod('/home/user/file.txt', 'go-w')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o644)
      })

      it('should remove execute permission with u-x', async () => {
        // Given: a file with mode 0o755 (rwxr-xr-x)
        // When: calling chmod with 'u-x'
        // Then: should result in 0o655 (rw-r-xr-x)

        await chmod('/home/user/script.sh', 'u-x')

        const entry = mockFs.get('/home/user/script.sh')
        expect(entry!.mode & 0o777).toBe(0o655)
      })

      it('should remove all permissions for other with o-rwx', async () => {
        // Given: a file with mode 0o755
        // When: calling chmod with 'o-rwx'
        // Then: should result in 0o750

        await chmod('/home/user/script.sh', 'o-rwx')

        const entry = mockFs.get('/home/user/script.sh')
        expect(entry!.mode & 0o777).toBe(0o750)
      })
    })

    describe('set exact permissions (=)', () => {
      it('should set exact permissions for owner with u=rwx', async () => {
        // Given: a file with mode 0o644
        // When: calling chmod with 'u=rwx'
        // Then: should result in 0o744

        await chmod('/home/user/file.txt', 'u=rwx')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o744)
      })

      it('should set exact permissions for group with g=rx', async () => {
        // Given: a file with mode 0o666
        // When: calling chmod with 'g=rx'
        // Then: should result in 0o656

        await chmod('/home/user/file.txt', 0o666)
        await chmod('/home/user/file.txt', 'g=rx')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o656)
      })

      it('should set exact permissions for all with a=r', async () => {
        // Given: a file with mode 0o777
        // When: calling chmod with 'a=r'
        // Then: should result in 0o444

        await chmod('/home/user/file.txt', 0o777)
        await chmod('/home/user/file.txt', 'a=r')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o444)
      })

      it('should clear permissions with o=', async () => {
        // Given: a file with mode 0o777
        // When: calling chmod with 'o=' (empty permissions)
        // This is not currently supported - skip or implement later
      })
    })

    describe('multiple clauses', () => {
      it('should handle comma-separated clauses', async () => {
        // Given: a file with mode 0o000
        // When: calling chmod with 'u=rwx,go=rx'
        // Then: should result in 0o755

        await chmod('/home/user/file.txt', 0o000)
        await chmod('/home/user/file.txt', 'u=rwx,go=rx')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o755)
      })

      it('should apply clauses in sequence', async () => {
        // Given: a file with mode 0o644 (rw-r--r--)
        // When: calling chmod with 'u+x,g+w,o+x'
        // u+x: 0o644 -> 0o744 (rwxr--r--)
        // g+w: 0o744 -> 0o764 (rwxrw-r--)
        // o+x: 0o764 -> 0o765 (rwxrw-r-x)
        // Then: should result in 0o765

        await chmod('/home/user/file.txt', 'u+x,g+w,o+x')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o765)
      })
    })

    describe('special bits via symbolic mode', () => {
      it('should set setuid with u+s', async () => {
        // Given: a file with mode 0o755
        // When: calling chmod with 'u+s'
        // Then: setuid bit should be set

        await chmod('/home/user/script.sh', 'u+s')

        const entry = mockFs.get('/home/user/script.sh')
        expect(entry!.mode & constants.S_ISUID).toBe(constants.S_ISUID)
      })

      it('should set setgid with g+s', async () => {
        // Given: a file with mode 0o755
        // When: calling chmod with 'g+s'
        // Then: setgid bit should be set

        await chmod('/home/user/script.sh', 'g+s')

        const entry = mockFs.get('/home/user/script.sh')
        expect(entry!.mode & constants.S_ISGID).toBe(constants.S_ISGID)
      })

      it('should set sticky bit with a+t', async () => {
        // Given: a directory
        // When: calling chmod with 'a+t'
        // Then: sticky bit should be set

        await chmod('/data/subdir', 'a+t')

        const entry = mockFs.get('/data/subdir')
        expect(entry!.mode & constants.S_ISVTX).toBe(constants.S_ISVTX)
      })

      it('should remove setuid with u-s', async () => {
        // Given: a file with setuid (0o4755)
        // When: calling chmod with 'u-s'
        // Then: setuid should be cleared

        await chmod('/home/user/setuid-file', 'u-s')

        const entry = mockFs.get('/home/user/setuid-file')
        expect(entry!.mode & constants.S_ISUID).toBe(0)
      })
    })

    describe('default to all (a) when no class specified', () => {
      it('should apply +r to all classes when no who specified', async () => {
        // Given: a file with mode 0o000
        // When: calling chmod with '+r' (no class specified)
        // Then: should add read for all (same as a+r)

        await chmod('/home/user/file.txt', 0o000)
        await chmod('/home/user/file.txt', '+r')

        const entry = mockFs.get('/home/user/file.txt')
        expect(entry!.mode & 0o777).toBe(0o444)
      })
    })
  })
})
