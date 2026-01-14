/**
 * FsBackend Interface Tests
 *
 * Tests the FsBackend interface contract using MockBackend.
 *
 * This test file covers:
 * 1. FsBackend interface definition with all fs methods
 * 2. MockBackend implementation for testing
 * 3. FileHandle interface
 *
 * @module test/core/backend
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Stats, Dirent } from '../../core/types'
import { MockBackend } from '../../core/mock-backend'

// =============================================================================
// Test Suite: FsBackend Interface Definition
// =============================================================================

describe('FsBackend Interface Definition', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  describe('File Operations', () => {
    describe('readFile', () => {
      it('should read file contents as Uint8Array', async () => {
        const data = new TextEncoder().encode('Hello, World!')
        await backend.writeFile('/test.txt', data)
        const result = await backend.readFile('/test.txt')
        expect(result).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(result)).toBe('Hello, World!')
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(backend.readFile('/nonexistent.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when reading a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.readFile('/mydir')).rejects.toThrow('EISDIR')
      })
    })

    describe('writeFile', () => {
      it('should write data and return bytesWritten and tier', async () => {
        const data = new TextEncoder().encode('Hello!')
        const result = await backend.writeFile('/new.txt', data)
        expect(result.bytesWritten).toBe(6)
        expect(result.tier).toBe('hot')
      })

      it('should throw ENOENT when parent directory does not exist', async () => {
        await expect(
          backend.writeFile('/nonexistent/file.txt', new Uint8Array([1]))
        ).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when writing to a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(
          backend.writeFile('/mydir', new Uint8Array([1]))
        ).rejects.toThrow('EISDIR')
      })

      it('should throw ENOTDIR when path component is a file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(
          backend.writeFile('/file.txt/nested.txt', new Uint8Array([2]))
        ).rejects.toThrow('ENOTDIR')
      })
    })

    describe('appendFile', () => {
      it('should append data to existing file', async () => {
        await backend.writeFile('/log.txt', new TextEncoder().encode('Line 1\n'))
        await backend.appendFile('/log.txt', new TextEncoder().encode('Line 2\n'))
        const result = await backend.readFile('/log.txt')
        expect(new TextDecoder().decode(result)).toBe('Line 1\nLine 2\n')
      })

      it('should create file if it does not exist', async () => {
        await backend.appendFile('/new.txt', new TextEncoder().encode('Content'))
        const result = await backend.readFile('/new.txt')
        expect(new TextDecoder().decode(result)).toBe('Content')
      })
    })

    describe('unlink', () => {
      it('should delete a file', async () => {
        await backend.writeFile('/todelete.txt', new Uint8Array([1]))
        await backend.unlink('/todelete.txt')
        expect(await backend.exists('/todelete.txt')).toBe(false)
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(backend.unlink('/nonexistent.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when trying to unlink a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.unlink('/mydir')).rejects.toThrow('EISDIR')
      })
    })

    describe('rename', () => {
      it('should rename a file', async () => {
        await backend.writeFile('/old.txt', new TextEncoder().encode('Content'))
        await backend.rename('/old.txt', '/new.txt')
        expect(await backend.exists('/old.txt')).toBe(false)
        expect(await backend.exists('/new.txt')).toBe(true)
      })

      it('should throw ENOENT when source does not exist', async () => {
        await expect(backend.rename('/nonexistent.txt', '/new.txt')).rejects.toThrow('ENOENT')
      })
    })

    describe('copyFile', () => {
      it('should copy a file', async () => {
        await backend.writeFile('/original.txt', new TextEncoder().encode('Data'))
        await backend.copyFile('/original.txt', '/copy.txt')
        expect(await backend.exists('/original.txt')).toBe(true)
        expect(await backend.exists('/copy.txt')).toBe(true)
        const copy = await backend.readFile('/copy.txt')
        expect(new TextDecoder().decode(copy)).toBe('Data')
      })

      it('should throw ENOENT for non-existent source', async () => {
        await expect(backend.copyFile('/nonexistent.txt', '/dest.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when copying a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.copyFile('/mydir', '/dest')).rejects.toThrow('EISDIR')
      })
    })
  })

  describe('Directory Operations', () => {
    describe('mkdir', () => {
      it('should create a directory', async () => {
        await backend.mkdir('/newdir')
        expect(await backend.exists('/newdir')).toBe(true)
        const stats = await backend.stat('/newdir')
        expect(stats.isDirectory()).toBe(true)
      })

      it('should create nested directories with recursive option', async () => {
        await backend.mkdir('/a/b/c', { recursive: true })
        expect(await backend.exists('/a')).toBe(true)
        expect(await backend.exists('/a/b')).toBe(true)
        expect(await backend.exists('/a/b/c')).toBe(true)
      })

      it('should throw EEXIST when directory exists', async () => {
        await backend.mkdir('/existing')
        await expect(backend.mkdir('/existing')).rejects.toThrow('EEXIST')
      })

      it('should throw EEXIST when file exists at path', async () => {
        await backend.writeFile('/file', new Uint8Array([1]))
        await expect(backend.mkdir('/file')).rejects.toThrow('EEXIST')
      })

      it('should throw ENOENT when parent does not exist', async () => {
        await expect(backend.mkdir('/nonexistent/child')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOTDIR when path component is a file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(backend.mkdir('/file.txt/subdir')).rejects.toThrow('ENOTDIR')
      })
    })

    describe('rmdir', () => {
      it('should remove an empty directory', async () => {
        await backend.mkdir('/emptydir')
        await backend.rmdir('/emptydir')
        expect(await backend.exists('/emptydir')).toBe(false)
      })

      it('should remove non-empty directory with recursive option', async () => {
        await backend.mkdir('/dir')
        await backend.writeFile('/dir/file.txt', new Uint8Array([1]))
        await backend.rmdir('/dir', { recursive: true })
        expect(await backend.exists('/dir')).toBe(false)
      })

      it('should throw ENOENT when directory does not exist', async () => {
        await expect(backend.rmdir('/nonexistent')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOTEMPTY when directory is not empty', async () => {
        await backend.mkdir('/nonempty')
        await backend.writeFile('/nonempty/file.txt', new Uint8Array([1]))
        await expect(backend.rmdir('/nonempty')).rejects.toThrow('ENOTEMPTY')
      })

      it('should throw ENOTDIR when path is a file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(backend.rmdir('/file.txt')).rejects.toThrow('ENOTDIR')
      })
    })

    describe('readdir', () => {
      it('should list directory contents as strings', async () => {
        await backend.writeFile('/file1.txt', new Uint8Array([1]))
        await backend.writeFile('/file2.txt', new Uint8Array([2]))
        await backend.mkdir('/subdir')
        const entries = await backend.readdir('/') as string[]
        expect(entries).toContain('file1.txt')
        expect(entries).toContain('file2.txt')
        expect(entries).toContain('subdir')
      })

      it('should return Dirent objects when withFileTypes is true', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await backend.mkdir('/subdir')
        const entries = await backend.readdir('/', { withFileTypes: true })
        expect(entries.length).toBeGreaterThan(0)
        const firstEntry = entries[0] as Dirent
        expect(firstEntry).toHaveProperty('name')
        expect(typeof firstEntry.isFile).toBe('function')
        expect(typeof firstEntry.isDirectory).toBe('function')
      })

      it('should throw ENOENT when directory does not exist', async () => {
        await expect(backend.readdir('/nonexistent')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOTDIR when path is a file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(backend.readdir('/file.txt')).rejects.toThrow('ENOTDIR')
      })
    })
  })

  describe('Metadata Operations', () => {
    describe('stat', () => {
      it('should return correct stats for a file', async () => {
        const data = new TextEncoder().encode('Hello!')
        await backend.writeFile('/file.txt', data)
        const stats = await backend.stat('/file.txt')
        expect(stats.isFile()).toBe(true)
        expect(stats.isDirectory()).toBe(false)
        expect(stats.size).toBe(6)
      })

      it('should return correct stats for a directory', async () => {
        await backend.mkdir('/mydir')
        const stats = await backend.stat('/mydir')
        expect(stats.isDirectory()).toBe(true)
        expect(stats.isFile()).toBe(false)
      })

      it('should have timestamp properties', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        const stats = await backend.stat('/file.txt')
        expect(typeof stats.atimeMs).toBe('number')
        expect(typeof stats.mtimeMs).toBe('number')
        expect(typeof stats.ctimeMs).toBe('number')
        expect(typeof stats.birthtimeMs).toBe('number')
        expect(stats.atime).toBeInstanceOf(Date)
        expect(stats.mtime).toBeInstanceOf(Date)
        expect(stats.ctime).toBeInstanceOf(Date)
        expect(stats.birthtime).toBeInstanceOf(Date)
      })

      it('should throw ENOENT for non-existent path', async () => {
        await expect(backend.stat('/nonexistent')).rejects.toThrow('ENOENT')
      })
    })

    describe('lstat', () => {
      it('should return stats for symlink itself, not target', async () => {
        await backend.writeFile('/target.txt', new Uint8Array([1, 2, 3]))
        await backend.symlink('/target.txt', '/link')
        const lstatResult = await backend.lstat('/link')
        expect(lstatResult.isSymbolicLink()).toBe(true)
      })

      it('should behave like stat for regular files', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1, 2, 3]))
        const stat = await backend.stat('/file.txt')
        const lstat = await backend.lstat('/file.txt')
        expect(lstat.size).toBe(stat.size)
        expect(lstat.isFile()).toBe(stat.isFile())
      })
    })

    describe('access', () => {
      it('should not throw for existing file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(backend.access('/file.txt')).resolves.not.toThrow()
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(backend.access('/nonexistent')).rejects.toThrow('ENOENT')
      })
    })

    describe('exists', () => {
      it('should return true for existing file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        expect(await backend.exists('/file.txt')).toBe(true)
      })

      it('should return true for existing directory', async () => {
        await backend.mkdir('/mydir')
        expect(await backend.exists('/mydir')).toBe(true)
      })

      it('should return false for non-existent path', async () => {
        expect(await backend.exists('/nonexistent')).toBe(false)
      })
    })

    describe('chmod', () => {
      it('should change file permissions', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await backend.chmod('/file.txt', 0o755)
        const stats = await backend.stat('/file.txt')
        expect(stats.mode & 0o777).toBe(0o755)
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(backend.chmod('/nonexistent', 0o644)).rejects.toThrow('ENOENT')
      })
    })

    describe('chown', () => {
      it('should change file ownership', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await backend.chown('/file.txt', 1000, 1000)
        const stats = await backend.stat('/file.txt')
        expect(stats.uid).toBe(1000)
        expect(stats.gid).toBe(1000)
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(backend.chown('/nonexistent', 1000, 1000)).rejects.toThrow('ENOENT')
      })
    })

    describe('utimes', () => {
      it('should update file timestamps with Date objects', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        const newTime = new Date('2024-01-01T00:00:00Z')
        await backend.utimes('/file.txt', newTime, newTime)
        const stats = await backend.stat('/file.txt')
        expect(stats.atimeMs).toBe(newTime.getTime())
        expect(stats.mtimeMs).toBe(newTime.getTime())
      })

      it('should accept timestamps as numbers', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        const timestamp = 1704067200000
        await backend.utimes('/file.txt', timestamp, timestamp)
        const stats = await backend.stat('/file.txt')
        expect(stats.atimeMs).toBe(timestamp)
        expect(stats.mtimeMs).toBe(timestamp)
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(backend.utimes('/nonexistent', Date.now(), Date.now())).rejects.toThrow('ENOENT')
      })
    })
  })

  describe('Symbolic Links', () => {
    describe('readlink', () => {
      it('should return target of symbolic link', async () => {
        await backend.writeFile('/target.txt', new Uint8Array([1]))
        await backend.symlink('/target.txt', '/link')
        const target = await backend.readlink('/link')
        expect(target).toBe('/target.txt')
      })

      it('should throw ENOENT for non-existent link', async () => {
        await expect(backend.readlink('/nonexistent')).rejects.toThrow('ENOENT')
      })

      it('should throw EINVAL when path is not a symlink', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(backend.readlink('/file.txt')).rejects.toThrow('EINVAL')
      })
    })

    describe('symlink', () => {
      it('should create a symbolic link', async () => {
        await backend.writeFile('/target.txt', new Uint8Array([1]))
        await backend.symlink('/target.txt', '/link')
        expect(await backend.exists('/link')).toBe(true)
        const target = await backend.readlink('/link')
        expect(target).toBe('/target.txt')
      })

      it('should throw EEXIST when link path already exists', async () => {
        await backend.writeFile('/existing.txt', new Uint8Array([1]))
        await expect(backend.symlink('/target', '/existing.txt')).rejects.toThrow('EEXIST')
      })

      it('should throw ENOENT when parent directory does not exist', async () => {
        await expect(backend.symlink('/target', '/nonexistent/link')).rejects.toThrow('ENOENT')
      })
    })

    describe('link', () => {
      it('should create a hard link', async () => {
        await backend.writeFile('/original.txt', new TextEncoder().encode('Data'))
        await backend.link('/original.txt', '/hardlink.txt')
        expect(await backend.exists('/hardlink.txt')).toBe(true)
        const content = await backend.readFile('/hardlink.txt')
        expect(new TextDecoder().decode(content)).toBe('Data')
      })

      it('should share data between hard links', async () => {
        await backend.writeFile('/original.txt', new TextEncoder().encode('Initial'))
        await backend.link('/original.txt', '/hardlink.txt')

        // Modify through one path
        await backend.writeFile('/original.txt', new TextEncoder().encode('Modified'))

        // Check both paths
        const original = await backend.readFile('/original.txt')
        const linked = await backend.readFile('/hardlink.txt')
        expect(new TextDecoder().decode(original)).toBe('Modified')
        expect(new TextDecoder().decode(linked)).toBe('Modified')
      })

      it('should throw ENOENT for non-existent source', async () => {
        await expect(backend.link('/nonexistent.txt', '/link.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw EPERM for hard link to directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.link('/mydir', '/link')).rejects.toThrow('EPERM')
      })

      it('should throw EEXIST when destination exists', async () => {
        await backend.writeFile('/original.txt', new Uint8Array([1]))
        await backend.writeFile('/existing.txt', new Uint8Array([2]))
        await expect(backend.link('/original.txt', '/existing.txt')).rejects.toThrow('EEXIST')
      })
    })
  })

  describe('Path Operations', () => {
    describe('realpath', () => {
      it('should resolve path following symlinks', async () => {
        await backend.mkdir('/real', { recursive: true })
        await backend.writeFile('/real/file.txt', new Uint8Array([1]))
        await backend.symlink('/real/file.txt', '/link')
        const resolved = await backend.realpath('/link')
        expect(resolved).toBe('/real/file.txt')
      })

      it('should return normalized path for regular files', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        const resolved = await backend.realpath('/./file.txt')
        expect(resolved).toBe('/file.txt')
      })

      it('should throw ELOOP for circular symlinks', async () => {
        await backend.symlink('/link2', '/link1')
        await backend.symlink('/link1', '/link2')
        await expect(backend.realpath('/link1')).rejects.toThrow('ELOOP')
      })

      it('should throw ENOENT for non-existent path', async () => {
        await expect(backend.realpath('/nonexistent')).rejects.toThrow('ENOENT')
      })
    })

    describe('mkdtemp', () => {
      it('should create a temporary directory with given prefix', async () => {
        await backend.mkdir('/tmp', { recursive: true })
        const tempDir = await backend.mkdtemp('/tmp/test-')
        expect(tempDir.startsWith('/tmp/test-')).toBe(true)
        expect(await backend.exists(tempDir)).toBe(true)
        const stats = await backend.stat(tempDir)
        expect(stats.isDirectory()).toBe(true)
      })

      it('should create unique directories on multiple calls', async () => {
        await backend.mkdir('/tmp', { recursive: true })
        const dir1 = await backend.mkdtemp('/tmp/test-')
        const dir2 = await backend.mkdtemp('/tmp/test-')
        expect(dir1).not.toBe(dir2)
      })
    })
  })
})

// =============================================================================
// Test Suite: FileHandle Interface
// =============================================================================

describe('FileHandle Interface', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  describe('open', () => {
    it('should return a FileHandle with fd property', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      expect(handle.fd).toBeGreaterThan(0)
      await handle.close()
    })

    it('should throw ENOENT when opening non-existent file for reading', async () => {
      await expect(backend.open('/nonexistent.txt', 'r')).rejects.toThrow('ENOENT')
    })

    it('should create file when opening with w flag', async () => {
      const handle = await backend.open('/newfile.txt', 'w')
      expect(await backend.exists('/newfile.txt')).toBe(true)
      await handle.close()
    })

    it('should throw EEXIST when opening with x flag and file exists', async () => {
      await backend.writeFile('/existing.txt', new Uint8Array([1]))
      await expect(backend.open('/existing.txt', 'wx')).rejects.toThrow('EEXIST')
    })
  })

  describe('read', () => {
    it('should read data into buffer', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('Hello, World!'))
      const handle = await backend.open('/file.txt', 'r')
      const buffer = new Uint8Array(13)
      const { bytesRead } = await handle.read(buffer)
      expect(bytesRead).toBe(13)
      expect(new TextDecoder().decode(buffer)).toBe('Hello, World!')
      await handle.close()
    })

    it('should read from specified position', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('Hello, World!'))
      const handle = await backend.open('/file.txt', 'r')
      const buffer = new Uint8Array(5)
      const { bytesRead } = await handle.read(buffer, 0, 5, 7)
      expect(bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer)).toBe('World')
      await handle.close()
    })

    it('should throw error when file handle is closed', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      await handle.close()
      await expect(handle.read(new Uint8Array(10))).rejects.toThrow('closed')
    })
  })

  describe('write', () => {
    it('should write data to file', async () => {
      const handle = await backend.open('/file.txt', 'w')
      const { bytesWritten } = await handle.write(new TextEncoder().encode('Hello'))
      expect(bytesWritten).toBe(5)
      await handle.close()
      const content = await backend.readFile('/file.txt')
      expect(new TextDecoder().decode(content)).toBe('Hello')
    })

    it('should write string data', async () => {
      const handle = await backend.open('/file.txt', 'w')
      await handle.write('Hello, World!')
      await handle.close()
      const content = await backend.readFile('/file.txt')
      expect(new TextDecoder().decode(content)).toBe('Hello, World!')
    })

    it('should write at specified position', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('Hello, World!'))
      const handle = await backend.open('/file.txt', 'r+')
      await handle.write('XXXXX', 7)
      await handle.close()
      const content = await backend.readFile('/file.txt')
      expect(new TextDecoder().decode(content)).toBe('Hello, XXXXX!')
    })
  })

  describe('readFile', () => {
    it('should read entire file contents', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('File contents'))
      const handle = await backend.open('/file.txt', 'r')
      const content = await handle.readFile()
      expect(new TextDecoder().decode(content)).toBe('File contents')
      await handle.close()
    })
  })

  describe('writeFile', () => {
    it('should replace entire file contents', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('Old content'))
      const handle = await backend.open('/file.txt', 'w')
      await handle.writeFile('New content')
      await handle.close()
      const content = await backend.readFile('/file.txt')
      expect(new TextDecoder().decode(content)).toBe('New content')
    })
  })

  describe('stat', () => {
    it('should return file stats', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('Hello'))
      const handle = await backend.open('/file.txt', 'r')
      const stats = await handle.stat()
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBe(5)
      await handle.close()
    })
  })

  describe('chmod', () => {
    it('should change file permissions', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      await handle.chmod(0o755)
      const stats = await handle.stat()
      expect(stats.mode & 0o777).toBe(0o755)
      await handle.close()
    })
  })

  describe('chown', () => {
    it('should change file ownership', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      await handle.chown(1000, 1000)
      const stats = await handle.stat()
      expect(stats.uid).toBe(1000)
      expect(stats.gid).toBe(1000)
      await handle.close()
    })
  })

  describe('close', () => {
    it('should close the file handle', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      await handle.close()
      // Operations after close should fail
      await expect(handle.read(new Uint8Array(10))).rejects.toThrow('closed')
    })
  })

  describe('sync', () => {
    it('should not throw on sync', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      await expect(handle.sync()).resolves.not.toThrow()
      await handle.close()
    })
  })

  describe('datasync', () => {
    it('should not throw on datasync', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const handle = await backend.open('/file.txt', 'r')
      await expect(handle.datasync()).resolves.not.toThrow()
      await handle.close()
    })
  })
})

// =============================================================================
// Test Suite: Stats Object
// =============================================================================

describe('Stats Object', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  describe('type detection methods', () => {
    it('should correctly identify files', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const stats = await backend.stat('/file.txt')
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
      expect(stats.isSymbolicLink()).toBe(false)
      expect(stats.isBlockDevice()).toBe(false)
      expect(stats.isCharacterDevice()).toBe(false)
      expect(stats.isFIFO()).toBe(false)
      expect(stats.isSocket()).toBe(false)
    })

    it('should correctly identify directories', async () => {
      await backend.mkdir('/mydir')
      const stats = await backend.stat('/mydir')
      expect(stats.isFile()).toBe(false)
      expect(stats.isDirectory()).toBe(true)
    })

    it('should correctly identify symbolic links with lstat', async () => {
      await backend.writeFile('/target.txt', new Uint8Array([1]))
      await backend.symlink('/target.txt', '/link')
      const stats = await backend.lstat('/link')
      expect(stats.isSymbolicLink()).toBe(true)
    })
  })

  describe('timestamps', () => {
    it('should have all timestamp properties as numbers', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const stats = await backend.stat('/file.txt')
      expect(typeof stats.atimeMs).toBe('number')
      expect(typeof stats.mtimeMs).toBe('number')
      expect(typeof stats.ctimeMs).toBe('number')
      expect(typeof stats.birthtimeMs).toBe('number')
    })

    it('should have Date getters for timestamps', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const stats = await backend.stat('/file.txt')
      expect(stats.atime).toBeInstanceOf(Date)
      expect(stats.mtime).toBeInstanceOf(Date)
      expect(stats.ctime).toBeInstanceOf(Date)
      expect(stats.birthtime).toBeInstanceOf(Date)
    })

    it('should have matching ms and Date values', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const stats = await backend.stat('/file.txt')
      expect(stats.atime.getTime()).toBe(stats.atimeMs)
      expect(stats.mtime.getTime()).toBe(stats.mtimeMs)
      expect(stats.ctime.getTime()).toBe(stats.ctimeMs)
      expect(stats.birthtime.getTime()).toBe(stats.birthtimeMs)
    })
  })

  describe('numeric properties', () => {
    it('should have dev, ino, mode, nlink, uid, gid, rdev', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const stats = await backend.stat('/file.txt')
      expect(typeof stats.dev).toBe('number')
      expect(typeof stats.ino).toBe('number')
      expect(typeof stats.mode).toBe('number')
      expect(typeof stats.nlink).toBe('number')
      expect(typeof stats.uid).toBe('number')
      expect(typeof stats.gid).toBe('number')
      expect(typeof stats.rdev).toBe('number')
    })

    it('should have size, blksize, blocks', async () => {
      const data = new Uint8Array(1234)
      await backend.writeFile('/file.txt', data)
      const stats = await backend.stat('/file.txt')
      expect(stats.size).toBe(1234)
      expect(typeof stats.blksize).toBe('number')
      expect(typeof stats.blocks).toBe('number')
    })
  })
})

// =============================================================================
// Test Suite: Dirent Object
// =============================================================================

describe('Dirent Object', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  it('should have name property', async () => {
    await backend.writeFile('/file.txt', new Uint8Array([1]))
    const entries = await backend.readdir('/', { withFileTypes: true }) as Dirent[]
    const entry = entries.find(e => e.name === 'file.txt')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('file.txt')
  })

  it('should have parentPath property', async () => {
    await backend.mkdir('/subdir')
    await backend.writeFile('/subdir/file.txt', new Uint8Array([1]))
    const entries = await backend.readdir('/subdir', { withFileTypes: true }) as Dirent[]
    expect(entries[0].parentPath).toBe('/subdir')
  })

  it('should have type detection methods', async () => {
    await backend.writeFile('/file.txt', new Uint8Array([1]))
    await backend.mkdir('/subdir')
    const entries = await backend.readdir('/', { withFileTypes: true }) as Dirent[]

    const fileEntry = entries.find(e => e.name === 'file.txt')
    const dirEntry = entries.find(e => e.name === 'subdir')

    expect(fileEntry!.isFile()).toBe(true)
    expect(fileEntry!.isDirectory()).toBe(false)

    expect(dirEntry!.isFile()).toBe(false)
    expect(dirEntry!.isDirectory()).toBe(true)
  })

  it('should correctly identify symbolic links', async () => {
    await backend.writeFile('/target.txt', new Uint8Array([1]))
    await backend.symlink('/target.txt', '/link')
    const entries = await backend.readdir('/', { withFileTypes: true }) as Dirent[]
    const linkEntry = entries.find(e => e.name === 'link')
    expect(linkEntry!.isSymbolicLink()).toBe(true)
  })
})

// =============================================================================
// Test Suite: Error Handling
// =============================================================================

describe('Error Handling', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  describe('ENOENT errors', () => {
    it('should throw for non-existent file read', async () => {
      await expect(backend.readFile('/missing')).rejects.toThrow('ENOENT')
    })

    it('should throw for non-existent directory listing', async () => {
      await expect(backend.readdir('/missing')).rejects.toThrow('ENOENT')
    })

    it('should throw for non-existent stat', async () => {
      await expect(backend.stat('/missing')).rejects.toThrow('ENOENT')
    })
  })

  describe('EEXIST errors', () => {
    it('should throw when creating existing directory', async () => {
      await backend.mkdir('/exists')
      await expect(backend.mkdir('/exists')).rejects.toThrow('EEXIST')
    })

    it('should throw when creating symlink at existing path', async () => {
      await backend.writeFile('/exists', new Uint8Array([1]))
      await expect(backend.symlink('/target', '/exists')).rejects.toThrow('EEXIST')
    })
  })

  describe('EISDIR errors', () => {
    it('should throw when reading directory as file', async () => {
      await backend.mkdir('/dir')
      await expect(backend.readFile('/dir')).rejects.toThrow('EISDIR')
    })

    it('should throw when unlinking directory', async () => {
      await backend.mkdir('/dir')
      await expect(backend.unlink('/dir')).rejects.toThrow('EISDIR')
    })

    it('should throw when copying directory', async () => {
      await backend.mkdir('/dir')
      await expect(backend.copyFile('/dir', '/dest')).rejects.toThrow('EISDIR')
    })
  })

  describe('ENOTDIR errors', () => {
    it('should throw when reading file as directory', async () => {
      await backend.writeFile('/file', new Uint8Array([1]))
      await expect(backend.readdir('/file')).rejects.toThrow('ENOTDIR')
    })

    it('should throw when rmdir on file', async () => {
      await backend.writeFile('/file', new Uint8Array([1]))
      await expect(backend.rmdir('/file')).rejects.toThrow('ENOTDIR')
    })

    it('should throw when path component is file', async () => {
      await backend.writeFile('/file', new Uint8Array([1]))
      await expect(backend.writeFile('/file/nested', new Uint8Array([2]))).rejects.toThrow('ENOTDIR')
    })
  })

  describe('ENOTEMPTY errors', () => {
    it('should throw when removing non-empty directory without recursive', async () => {
      await backend.mkdir('/dir')
      await backend.writeFile('/dir/file', new Uint8Array([1]))
      await expect(backend.rmdir('/dir')).rejects.toThrow('ENOTEMPTY')
    })
  })

  describe('EINVAL errors', () => {
    it('should throw when readlink on non-symlink', async () => {
      await backend.writeFile('/file', new Uint8Array([1]))
      await expect(backend.readlink('/file')).rejects.toThrow('EINVAL')
    })
  })

  describe('ELOOP errors', () => {
    it('should throw for circular symlinks in realpath', async () => {
      await backend.symlink('/b', '/a')
      await backend.symlink('/a', '/b')
      await expect(backend.realpath('/a')).rejects.toThrow('ELOOP')
    })
  })

  describe('EPERM errors', () => {
    it('should throw when removing root directory', async () => {
      await expect(backend.rmdir('/')).rejects.toThrow('EPERM')
    })

    it('should throw when creating hard link to directory', async () => {
      await backend.mkdir('/dir')
      await expect(backend.link('/dir', '/link')).rejects.toThrow('EPERM')
    })
  })
})

// =============================================================================
// Test Suite: Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

  describe('empty paths', () => {
    it('should throw for empty path in readFile', async () => {
      await expect(backend.readFile('')).rejects.toThrow()
    })

    it('should throw for empty path in writeFile', async () => {
      await expect(backend.writeFile('', new Uint8Array([1]))).rejects.toThrow()
    })

    it('should throw for empty path in stat', async () => {
      await expect(backend.stat('')).rejects.toThrow()
    })
  })

  describe('path normalization', () => {
    it('should handle trailing slashes', async () => {
      await backend.mkdir('/mydir/')
      expect(await backend.exists('/mydir')).toBe(true)
      expect(await backend.exists('/mydir/')).toBe(true)
    })

    it('should handle double slashes', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const result = await backend.readFile('//file.txt')
      expect(result).toEqual(new Uint8Array([1]))
    })

    it('should handle . and .. in paths', async () => {
      await backend.mkdir('/a/b', { recursive: true })
      await backend.writeFile('/a/b/file.txt', new Uint8Array([1]))
      const result = await backend.readFile('/a/b/../b/./file.txt')
      expect(result).toEqual(new Uint8Array([1]))
    })
  })

  describe('special characters in names', () => {
    it('should handle spaces in file names', async () => {
      await backend.writeFile('/file with spaces.txt', new Uint8Array([1]))
      expect(await backend.exists('/file with spaces.txt')).toBe(true)
    })

    it('should handle unicode in file names', async () => {
      await backend.writeFile('/file-\u4e2d\u6587.txt', new Uint8Array([1]))
      expect(await backend.exists('/file-\u4e2d\u6587.txt')).toBe(true)
    })

    it('should handle emoji in file names', async () => {
      await backend.writeFile('/file-\u{1F600}.txt', new Uint8Array([1]))
      expect(await backend.exists('/file-\u{1F600}.txt')).toBe(true)
    })
  })

  describe('deep nesting', () => {
    it('should handle deeply nested directories', async () => {
      const deepPath = '/a/b/c/d/e/f/g/h/i/j'
      await backend.mkdir(deepPath, { recursive: true })
      expect(await backend.exists(deepPath)).toBe(true)
      expect((await backend.stat(deepPath)).isDirectory()).toBe(true)
    })

    it('should handle deeply nested files', async () => {
      const deepDir = '/a/b/c/d/e/f/g/h/i/j'
      await backend.mkdir(deepDir, { recursive: true })
      await backend.writeFile(`${deepDir}/file.txt`, new TextEncoder().encode('Deep!'))
      const result = await backend.readFile(`${deepDir}/file.txt`)
      expect(new TextDecoder().decode(result)).toBe('Deep!')
    })
  })

  describe('binary data', () => {
    it('should handle null bytes in binary data', async () => {
      const data = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00])
      await backend.writeFile('/binary.bin', data)
      const result = await backend.readFile('/binary.bin')
      expect(result).toEqual(data)
    })

    it('should handle large binary files', async () => {
      const data = new Uint8Array(1024 * 1024) // 1MB
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256
      }
      await backend.writeFile('/large.bin', data)
      const result = await backend.readFile('/large.bin')
      expect(result.length).toBe(data.length)
      expect(result).toEqual(data)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent writes to different files', async () => {
      const writes = Promise.all([
        backend.writeFile('/file1.txt', new Uint8Array([1])),
        backend.writeFile('/file2.txt', new Uint8Array([2])),
        backend.writeFile('/file3.txt', new Uint8Array([3])),
      ])
      await writes
      expect(await backend.exists('/file1.txt')).toBe(true)
      expect(await backend.exists('/file2.txt')).toBe(true)
      expect(await backend.exists('/file3.txt')).toBe(true)
    })

    it('should handle concurrent reads', async () => {
      await backend.writeFile('/file.txt', new TextEncoder().encode('Content'))
      const reads = Promise.all([
        backend.readFile('/file.txt'),
        backend.readFile('/file.txt'),
        backend.readFile('/file.txt'),
      ])
      const results = await reads
      for (const result of results) {
        expect(new TextDecoder().decode(result)).toBe('Content')
      }
    })
  })
})
