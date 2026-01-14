/**
 * Tests for MemoryBackend
 *
 * RED phase: These tests validate the FsBackend interface implementation.
 * Tests cover all interface methods, error conditions, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryBackend } from './backend'

describe('MemoryBackend', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = new MemoryBackend()
  })

  // ===========================================================================
  // File Operations
  // ===========================================================================

  describe('readFile', () => {
    describe('basic operations', () => {
      it('should read a file that was written', async () => {
        const data = new TextEncoder().encode('Hello, World!')
        await backend.writeFile('/test.txt', data)

        const result = await backend.readFile('/test.txt')
        expect(result).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(result)).toBe('Hello, World!')
      })

      it('should read empty file', async () => {
        await backend.writeFile('/empty.txt', new Uint8Array(0))

        const result = await backend.readFile('/empty.txt')
        expect(result.length).toBe(0)
      })

      it('should read binary data correctly', async () => {
        const data = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
        await backend.writeFile('/binary.bin', data)

        const result = await backend.readFile('/binary.bin')
        expect(result).toEqual(data)
      })

      it('should read large file', async () => {
        const data = new Uint8Array(1024 * 1024) // 1MB
        for (let i = 0; i < data.length; i++) {
          data[i] = i % 256
        }
        await backend.writeFile('/large.bin', data)

        const result = await backend.readFile('/large.bin')
        expect(result.length).toBe(1024 * 1024)
        expect(result).toEqual(data)
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when file does not exist', async () => {
        await expect(backend.readFile('/nonexistent.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOENT for deeply nested nonexistent path', async () => {
        await expect(backend.readFile('/a/b/c/d/e/file.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when path is a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.readFile('/mydir')).rejects.toThrow('EISDIR')
      })

      it('should throw EISDIR when reading root directory', async () => {
        await expect(backend.readFile('/')).rejects.toThrow('EISDIR')
      })
    })
  })

  describe('writeFile', () => {
    describe('basic operations', () => {
      it('should write a new file', async () => {
        const data = new TextEncoder().encode('Hello!')
        const result = await backend.writeFile('/new.txt', data)

        expect(result.bytesWritten).toBe(6)
        expect(result.tier).toBe('hot')
      })

      it('should overwrite existing file', async () => {
        await backend.writeFile('/file.txt', new TextEncoder().encode('Old content'))
        await backend.writeFile('/file.txt', new TextEncoder().encode('New content'))

        const result = await backend.readFile('/file.txt')
        expect(new TextDecoder().decode(result)).toBe('New content')
      })

      it('should write empty file', async () => {
        const result = await backend.writeFile('/empty.txt', new Uint8Array(0))

        expect(result.bytesWritten).toBe(0)
        expect(await backend.exists('/empty.txt')).toBe(true)
      })

      it('should respect custom file mode', async () => {
        await backend.writeFile('/restricted.txt', new Uint8Array([1, 2, 3]), { mode: 0o600 })

        const stats = await backend.stat('/restricted.txt')
        // Check permission bits (lower 9 bits)
        expect(stats.mode & 0o777).toBe(0o600)
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when parent directory does not exist', async () => {
        await expect(
          backend.writeFile('/nonexistent/file.txt', new Uint8Array([1, 2, 3]))
        ).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when writing to a directory path', async () => {
        await backend.mkdir('/mydir')
        await expect(
          backend.writeFile('/mydir', new Uint8Array([1, 2, 3]))
        ).rejects.toThrow('EISDIR')
      })

      it('should throw ENOTDIR when path component is a file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(
          backend.writeFile('/file.txt/nested.txt', new Uint8Array([2]))
        ).rejects.toThrow('ENOTDIR')
      })
    })
  })

  describe('unlink', () => {
    describe('basic operations', () => {
      it('should delete an existing file', async () => {
        await backend.writeFile('/todelete.txt', new Uint8Array([1, 2, 3]))
        expect(await backend.exists('/todelete.txt')).toBe(true)

        await backend.unlink('/todelete.txt')
        expect(await backend.exists('/todelete.txt')).toBe(false)
      })

      it('should allow recreating deleted file', async () => {
        await backend.writeFile('/file.txt', new TextEncoder().encode('Original'))
        await backend.unlink('/file.txt')
        await backend.writeFile('/file.txt', new TextEncoder().encode('Recreated'))

        const result = await backend.readFile('/file.txt')
        expect(new TextDecoder().decode(result)).toBe('Recreated')
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when file does not exist', async () => {
        await expect(backend.unlink('/nonexistent.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when path is a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.unlink('/mydir')).rejects.toThrow('EISDIR')
      })
    })
  })

  describe('rename', () => {
    describe('basic operations', () => {
      it('should rename a file', async () => {
        await backend.writeFile('/old.txt', new TextEncoder().encode('Content'))
        await backend.rename('/old.txt', '/new.txt')

        expect(await backend.exists('/old.txt')).toBe(false)
        expect(await backend.exists('/new.txt')).toBe(true)
        const result = await backend.readFile('/new.txt')
        expect(new TextDecoder().decode(result)).toBe('Content')
      })

      it('should move a file to different directory', async () => {
        await backend.mkdir('/src')
        await backend.mkdir('/dest')
        await backend.writeFile('/src/file.txt', new TextEncoder().encode('Moving'))

        await backend.rename('/src/file.txt', '/dest/file.txt')

        expect(await backend.exists('/src/file.txt')).toBe(false)
        expect(await backend.exists('/dest/file.txt')).toBe(true)
      })

      it('should rename a directory', async () => {
        await backend.mkdir('/olddir')
        await backend.writeFile('/olddir/file.txt', new Uint8Array([1]))

        await backend.rename('/olddir', '/newdir')

        expect(await backend.exists('/olddir')).toBe(false)
        expect(await backend.exists('/newdir')).toBe(true)
        expect(await backend.exists('/newdir/file.txt')).toBe(true)
      })

      it('should overwrite destination if it exists', async () => {
        await backend.writeFile('/src.txt', new TextEncoder().encode('Source'))
        await backend.writeFile('/dest.txt', new TextEncoder().encode('Dest'))

        await backend.rename('/src.txt', '/dest.txt')

        const result = await backend.readFile('/dest.txt')
        expect(new TextDecoder().decode(result)).toBe('Source')
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when source does not exist', async () => {
        await expect(backend.rename('/nonexistent.txt', '/new.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOENT when destination parent does not exist', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(
          backend.rename('/file.txt', '/nonexistent/file.txt')
        ).rejects.toThrow('ENOENT')
      })
    })
  })

  describe('copyFile', () => {
    describe('basic operations', () => {
      it('should copy a file', async () => {
        const data = new TextEncoder().encode('To be copied')
        await backend.writeFile('/original.txt', data)

        await backend.copyFile('/original.txt', '/copy.txt')

        expect(await backend.exists('/original.txt')).toBe(true)
        expect(await backend.exists('/copy.txt')).toBe(true)
        const result = await backend.readFile('/copy.txt')
        expect(new TextDecoder().decode(result)).toBe('To be copied')
      })

      it('should create an independent copy', async () => {
        await backend.writeFile('/original.txt', new TextEncoder().encode('Original'))
        await backend.copyFile('/original.txt', '/copy.txt')

        // Modify original
        await backend.writeFile('/original.txt', new TextEncoder().encode('Modified'))

        // Copy should remain unchanged
        const copy = await backend.readFile('/copy.txt')
        expect(new TextDecoder().decode(copy)).toBe('Original')
      })

      it('should copy to different directory', async () => {
        await backend.mkdir('/dest')
        await backend.writeFile('/src.txt', new TextEncoder().encode('Content'))

        await backend.copyFile('/src.txt', '/dest/copied.txt')

        expect(await backend.exists('/dest/copied.txt')).toBe(true)
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when source does not exist', async () => {
        await expect(backend.copyFile('/nonexistent.txt', '/dest.txt')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOENT when destination parent does not exist', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(
          backend.copyFile('/file.txt', '/nonexistent/copy.txt')
        ).rejects.toThrow('ENOENT')
      })

      it('should throw EISDIR when source is a directory', async () => {
        await backend.mkdir('/mydir')
        await expect(backend.copyFile('/mydir', '/dest')).rejects.toThrow('EISDIR')
      })
    })
  })

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  describe('mkdir', () => {
    describe('basic operations', () => {
      it('should create a directory', async () => {
        await backend.mkdir('/newdir')
        expect(await backend.exists('/newdir')).toBe(true)

        const stats = await backend.stat('/newdir')
        expect(stats.isDirectory()).toBe(true)
      })

      it('should create nested directories with recursive option', async () => {
        await backend.mkdir('/a/b/c/d', { recursive: true })

        expect(await backend.exists('/a')).toBe(true)
        expect(await backend.exists('/a/b')).toBe(true)
        expect(await backend.exists('/a/b/c')).toBe(true)
        expect(await backend.exists('/a/b/c/d')).toBe(true)
      })

      it('should do nothing if directory exists with recursive option', async () => {
        await backend.mkdir('/existingdir')
        await backend.mkdir('/existingdir', { recursive: true }) // Should not throw
        expect(await backend.exists('/existingdir')).toBe(true)
      })

      it('should respect custom mode', async () => {
        await backend.mkdir('/restricted', { mode: 0o700 })

        const stats = await backend.stat('/restricted')
        expect(stats.mode & 0o777).toBe(0o755) // Directory default mode
      })
    })

    describe('error conditions', () => {
      it('should throw EEXIST when directory already exists', async () => {
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
  })

  describe('rmdir', () => {
    describe('basic operations', () => {
      it('should remove an empty directory', async () => {
        await backend.mkdir('/emptydir')
        await backend.rmdir('/emptydir')
        expect(await backend.exists('/emptydir')).toBe(false)
      })

      it('should remove non-empty directory with recursive option', async () => {
        await backend.mkdir('/dir')
        await backend.writeFile('/dir/file.txt', new Uint8Array([1]))
        await backend.mkdir('/dir/subdir')
        await backend.writeFile('/dir/subdir/nested.txt', new Uint8Array([2]))

        await backend.rmdir('/dir', { recursive: true })

        expect(await backend.exists('/dir')).toBe(false)
        expect(await backend.exists('/dir/file.txt')).toBe(false)
        expect(await backend.exists('/dir/subdir')).toBe(false)
      })
    })

    describe('error conditions', () => {
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

      it('should throw error when trying to remove root', async () => {
        await expect(backend.rmdir('/')).rejects.toThrow()
      })
    })
  })

  describe('readdir', () => {
    describe('basic operations', () => {
      it('should list files in a directory', async () => {
        await backend.writeFile('/file1.txt', new Uint8Array([1]))
        await backend.writeFile('/file2.txt', new Uint8Array([2]))
        await backend.mkdir('/subdir')

        const entries = await backend.readdir('/') as string[]

        expect(entries).toContain('file1.txt')
        expect(entries).toContain('file2.txt')
        expect(entries).toContain('subdir')
      })

      it('should return empty array for empty directory', async () => {
        await backend.mkdir('/emptydir')
        const entries = await backend.readdir('/emptydir')
        expect(entries).toEqual([])
      })

      it('should list only direct children', async () => {
        await backend.mkdir('/parent', { recursive: true })
        await backend.mkdir('/parent/child')
        await backend.writeFile('/parent/child/grandchild.txt', new Uint8Array([1]))

        const entries = await backend.readdir('/parent') as string[]

        expect(entries).toContain('child')
        expect(entries).not.toContain('grandchild.txt')
      })

      it('should return Dirent objects when withFileTypes is true', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await backend.mkdir('/subdir')

        const entries = await backend.readdir('/', { withFileTypes: true })

        expect(entries.length).toBeGreaterThan(0)
        if (typeof entries[0] !== 'string') {
          // First entry should be a Dirent
          expect(entries[0]).toHaveProperty('name')
          expect(typeof entries[0].isFile).toBe('function')
          expect(typeof entries[0].isDirectory).toBe('function')
        }
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when directory does not exist', async () => {
        await expect(backend.readdir('/nonexistent')).rejects.toThrow('ENOENT')
      })

      it('should throw ENOTDIR when path is a file', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        await expect(backend.readdir('/file.txt')).rejects.toThrow('ENOTDIR')
      })
    })
  })

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  describe('stat', () => {
    describe('file stats', () => {
      it('should return correct stats for a file', async () => {
        const data = new TextEncoder().encode('Hello, World!')
        await backend.writeFile('/file.txt', data)

        const stats = await backend.stat('/file.txt')

        expect(stats.isFile()).toBe(true)
        expect(stats.isDirectory()).toBe(false)
        expect(stats.size).toBe(13)
      })

      it('should return correct size for empty file', async () => {
        await backend.writeFile('/empty.txt', new Uint8Array(0))
        const stats = await backend.stat('/empty.txt')
        expect(stats.size).toBe(0)
      })

      it('should have valid timestamps', async () => {
        const before = Date.now()
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        const after = Date.now()

        const stats = await backend.stat('/file.txt')

        expect(stats.atimeMs).toBeGreaterThanOrEqual(before)
        expect(stats.atimeMs).toBeLessThanOrEqual(after)
        expect(stats.mtimeMs).toBeGreaterThanOrEqual(before)
        expect(stats.mtimeMs).toBeLessThanOrEqual(after)
        expect(stats.ctimeMs).toBeGreaterThanOrEqual(before)
        expect(stats.ctimeMs).toBeLessThanOrEqual(after)
        expect(stats.birthtimeMs).toBeGreaterThanOrEqual(before)
        expect(stats.birthtimeMs).toBeLessThanOrEqual(after)
      })

      it('should have Date accessors', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))
        const stats = await backend.stat('/file.txt')

        expect(stats.atime).toBeInstanceOf(Date)
        expect(stats.mtime).toBeInstanceOf(Date)
        expect(stats.ctime).toBeInstanceOf(Date)
        expect(stats.birthtime).toBeInstanceOf(Date)
      })
    })

    describe('directory stats', () => {
      it('should return correct stats for a directory', async () => {
        await backend.mkdir('/mydir')

        const stats = await backend.stat('/mydir')

        expect(stats.isDirectory()).toBe(true)
        expect(stats.isFile()).toBe(false)
      })

      it('should return correct stats for root directory', async () => {
        const stats = await backend.stat('/')

        expect(stats.isDirectory()).toBe(true)
      })
    })

    describe('error conditions', () => {
      it('should throw ENOENT when path does not exist', async () => {
        await expect(backend.stat('/nonexistent')).rejects.toThrow('ENOENT')
      })
    })
  })

  describe('lstat', () => {
    it('should behave like stat for regular files', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1, 2, 3]))

      const stat = await backend.stat('/file.txt')
      const lstat = await backend.lstat('/file.txt')

      expect(lstat.size).toBe(stat.size)
      expect(lstat.isFile()).toBe(stat.isFile())
    })

    it('should throw ENOENT when path does not exist', async () => {
      await expect(backend.lstat('/nonexistent')).rejects.toThrow('ENOENT')
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

    it('should return true for root directory', async () => {
      expect(await backend.exists('/')).toBe(true)
    })

    it('should return false for nonexistent path', async () => {
      expect(await backend.exists('/nonexistent')).toBe(false)
    })

    it('should return false after file is deleted', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      await backend.unlink('/file.txt')
      expect(await backend.exists('/file.txt')).toBe(false)
    })
  })

  describe('chmod', () => {
    it('should change file permissions', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      await backend.chmod('/file.txt', 0o755)

      const stats = await backend.stat('/file.txt')
      expect(stats.mode & 0o777).toBe(0o755)
    })

    it('should throw ENOENT when file does not exist', async () => {
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

    it('should throw ENOENT when file does not exist', async () => {
      await expect(backend.chown('/nonexistent', 1000, 1000)).rejects.toThrow('ENOENT')
    })
  })

  describe('utimes', () => {
    it('should update file timestamps', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const newTime = new Date('2024-01-01T00:00:00Z')

      await backend.utimes('/file.txt', newTime, newTime)

      const stats = await backend.stat('/file.txt')
      expect(stats.atimeMs).toBe(newTime.getTime())
      expect(stats.mtimeMs).toBe(newTime.getTime())
    })

    it('should accept timestamps as numbers', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      const timestamp = 1704067200000 // 2024-01-01T00:00:00Z

      await backend.utimes('/file.txt', timestamp, timestamp)

      const stats = await backend.stat('/file.txt')
      expect(stats.atimeMs).toBe(timestamp)
      expect(stats.mtimeMs).toBe(timestamp)
    })

    it('should throw ENOENT when file does not exist', async () => {
      await expect(backend.utimes('/nonexistent', Date.now(), Date.now())).rejects.toThrow('ENOENT')
    })
  })

  // ===========================================================================
  // Symbolic Links
  // ===========================================================================

  describe('symlink', () => {
    it('should throw not supported error', async () => {
      await expect(backend.symlink('/target', '/link')).rejects.toThrow('not supported')
    })
  })

  describe('link', () => {
    it('should throw not supported error', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))
      await expect(backend.link('/file.txt', '/link')).rejects.toThrow('not supported')
    })
  })

  describe('readlink', () => {
    it('should throw not supported error', async () => {
      await expect(backend.readlink('/link')).rejects.toThrow('not supported')
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    describe('empty paths', () => {
      it('should handle empty path in readFile', async () => {
        await expect(backend.readFile('')).rejects.toThrow()
      })

      it('should handle empty path in writeFile', async () => {
        await expect(backend.writeFile('', new Uint8Array([1]))).rejects.toThrow()
      })

      it('should handle empty path in stat', async () => {
        await expect(backend.stat('')).rejects.toThrow()
      })
    })

    describe('path normalization', () => {
      it('should handle paths with trailing slashes', async () => {
        await backend.mkdir('/mydir/')

        expect(await backend.exists('/mydir')).toBe(true)
        expect(await backend.exists('/mydir/')).toBe(true)
      })

      it('should handle paths with double slashes', async () => {
        await backend.writeFile('/file.txt', new Uint8Array([1]))

        const result = await backend.readFile('//file.txt')
        expect(result).toEqual(new Uint8Array([1]))
      })

      it('should handle paths with . and ..', async () => {
        await backend.mkdir('/a/b', { recursive: true })
        await backend.writeFile('/a/b/file.txt', new Uint8Array([1]))

        const result = await backend.readFile('/a/b/../b/./file.txt')
        expect(result).toEqual(new Uint8Array([1]))
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

    describe('root directory operations', () => {
      it('should not allow deleting root directory', async () => {
        await expect(backend.rmdir('/')).rejects.toThrow()
      })

      it('should list files in root directory', async () => {
        await backend.writeFile('/root-file.txt', new Uint8Array([1]))
        const entries = await backend.readdir('/') as string[]
        expect(entries).toContain('root-file.txt')
      })

      it('should stat root directory', async () => {
        const stats = await backend.stat('/')
        expect(stats.isDirectory()).toBe(true)
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

    describe('file/directory collisions', () => {
      it('should not allow creating file where directory exists', async () => {
        await backend.mkdir('/name')
        await expect(
          backend.writeFile('/name', new Uint8Array([1]))
        ).rejects.toThrow('EISDIR')
      })

      it('should not allow creating directory where file exists', async () => {
        await backend.writeFile('/name', new Uint8Array([1]))
        await expect(backend.mkdir('/name')).rejects.toThrow('EEXIST')
      })
    })
  })

  // ===========================================================================
  // Stats Type Checking Methods
  // ===========================================================================

  describe('Stats type methods', () => {
    it('should correctly identify file types', async () => {
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

    it('should correctly identify directory types', async () => {
      await backend.mkdir('/mydir')
      const stats = await backend.stat('/mydir')

      expect(stats.isFile()).toBe(false)
      expect(stats.isDirectory()).toBe(true)
      expect(stats.isSymbolicLink()).toBe(false)
    })
  })

  // ===========================================================================
  // Tiering Operations (Optional)
  // ===========================================================================

  describe('tiering operations', () => {
    it('should return hot tier for getTier if implemented', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))

      if (backend.getTier) {
        const tier = await backend.getTier('/file.txt')
        expect(tier).toBe('hot')
      }
    })

    it('should support promote operation if implemented', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))

      if (backend.promote) {
        await expect(backend.promote('/file.txt', 'hot')).resolves.not.toThrow()
      }
    })

    it('should support demote operation if implemented', async () => {
      await backend.writeFile('/file.txt', new Uint8Array([1]))

      if (backend.demote) {
        await expect(backend.demote('/file.txt', 'warm')).resolves.not.toThrow()
      }
    })
  })
})
