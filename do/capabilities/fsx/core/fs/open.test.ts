/**
 * Tests for fs.open() with flags (RED phase - should fail)
 *
 * fs.open() returns a FileHandle for low-level file operations.
 * Flags control how the file is opened (read/write mode, create behavior).
 *
 * POSIX flag behavior:
 * - 'r': Open for reading. File must exist. (O_RDONLY)
 * - 'r+': Open for reading and writing. File must exist. (O_RDWR)
 * - 'w': Open for writing. Creates or truncates. (O_WRONLY | O_CREAT | O_TRUNC)
 * - 'w+': Open for reading and writing. Creates or truncates. (O_RDWR | O_CREAT | O_TRUNC)
 * - 'a': Open for appending. Creates if needed. (O_WRONLY | O_CREAT | O_APPEND)
 * - 'a+': Open for reading and appending. Creates if needed. (O_RDWR | O_CREAT | O_APPEND)
 * - 'x': Exclusive flag. Fails if file exists. (O_EXCL with O_CREAT)
 * - Numeric flags (O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MockBackend } from '../mock-backend'
import { constants } from '../constants'

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND } = constants

describe('fs.open() with flags', () => {
  let backend: MockBackend

  beforeEach(async () => {
    backend = new MockBackend()

    // Set up test filesystem
    await backend.mkdir('/test')

    // Regular file with content
    const testContent = new TextEncoder().encode('Hello, World!')
    await backend.writeFile('/test/file.txt', testContent)

    // Empty file
    await backend.writeFile('/test/empty.txt', new Uint8Array(0))

    // File with append data
    const appendData = new TextEncoder().encode('existing data')
    await backend.writeFile('/test/appendable.txt', appendData)

    // Symlink (MockBackend supports symlinks)
    await backend.symlink('/test/file.txt', '/test/link.txt')
  })

  // ===========================================================================
  // Flag: 'r' (read-only mode)
  // ===========================================================================

  describe("flag 'r' (read-only)", () => {
    it('should open existing file for reading', async () => {
      const handle = await backend.open('/test/file.txt', 'r')

      expect(handle).toBeDefined()
      expect(handle.fd).toBeGreaterThanOrEqual(0)

      await handle.close()
    })

    it('should throw ENOENT when file does not exist', async () => {
      await expect(backend.open('/test/nonexistent.txt', 'r')).rejects.toThrow(/ENOENT/)
    })

    it('should throw EISDIR when path is a directory', async () => {
      await expect(backend.open('/test', 'r')).rejects.toThrow(/EISDIR/)
    })

    it('should follow symlinks', async () => {
      const handle = await backend.open('/test/link.txt', 'r')

      expect(handle).toBeDefined()
      expect(handle.fd).toBeGreaterThanOrEqual(0)

      await handle.close()
    })

    it('should allow reading from file handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r')
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)

      expect(bytesRead).toBe(13) // "Hello, World!" length
      const content = new TextDecoder().decode(buffer.slice(0, bytesRead))
      expect(content).toBe('Hello, World!')

      await handle.close()
    })

    it('should throw error when writing to read-only handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r')

      await expect(handle.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(/EBADF|not permitted|read-only/)

      await handle.close()
    })

    it('should allow multiple reads without closing', async () => {
      const handle = await backend.open('/test/file.txt', 'r')
      const buffer1 = new Uint8Array(5)
      const buffer2 = new Uint8Array(5)

      await handle.read(buffer1, 0, 5, 0)
      await handle.read(buffer2, 0, 5, 5)

      expect(new TextDecoder().decode(buffer1)).toBe('Hello')
      expect(new TextDecoder().decode(buffer2)).toBe(', Wor')

      await handle.close()
    })

    it('should work with default flags (defaults to "r")', async () => {
      const handle = await backend.open('/test/file.txt')

      expect(handle).toBeDefined()
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(13)

      await handle.close()
    })
  })

  // ===========================================================================
  // Flag: 'r+' (read/write mode, file must exist)
  // ===========================================================================

  describe("flag 'r+' (read/write, must exist)", () => {
    it('should open existing file for reading and writing', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      expect(handle).toBeDefined()
      expect(handle.fd).toBeGreaterThanOrEqual(0)

      await handle.close()
    })

    it('should throw ENOENT when file does not exist', async () => {
      await expect(backend.open('/test/nonexistent.txt', 'r+')).rejects.toThrow(/ENOENT/)
    })

    it('should allow reading and writing', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Read original content
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(13)

      // Write new content
      const newData = new TextEncoder().encode('Modified')
      const { bytesWritten } = await handle.write(newData, 0)
      expect(bytesWritten).toBe(8)

      await handle.close()
    })

    it('should not truncate existing content', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Verify original content still exists
      const stats = await handle.stat()
      expect(stats.size).toBe(13) // Original content length preserved

      await handle.close()
    })

    it('should allow writing at any position', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      const newData = new TextEncoder().encode('XX')
      await handle.write(newData, 7) // Write "XX" at position 7

      // Read back to verify
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const content = new TextDecoder().decode(buffer.slice(0, bytesRead))

      expect(content).toBe('Hello, XXrld!')

      await handle.close()
    })
  })

  // ===========================================================================
  // Flag: 'w' (write-only, create or truncate)
  // ===========================================================================

  describe("flag 'w' (write-only, create/truncate)", () => {
    it('should create new file if it does not exist', async () => {
      const handle = await backend.open('/test/newfile.txt', 'w')

      expect(handle).toBeDefined()

      await handle.close()

      // Verify file was created
      const exists = await backend.exists('/test/newfile.txt')
      expect(exists).toBe(true)
    })

    it('should truncate existing file', async () => {
      const handle = await backend.open('/test/file.txt', 'w')

      expect(handle).toBeDefined()

      // Verify file was truncated
      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should allow writing but not reading', async () => {
      const handle = await backend.open('/test/newfile.txt', 'w')

      const data = new TextEncoder().encode('New content')
      const { bytesWritten } = await handle.write(data)
      expect(bytesWritten).toBe(11)

      // Reading should fail
      const buffer = new Uint8Array(1024)
      await expect(handle.read(buffer, 0, buffer.length, 0)).rejects.toThrow(/EBADF|not permitted|write-only/)

      await handle.close()
    })

    it('should create file with specified mode', async () => {
      const handle = await backend.open('/test/newfile.txt', 'w', 0o600)

      await handle.close()

      const stats = await backend.stat('/test/newfile.txt')
      expect(stats.mode & 0o777).toBe(0o600)
    })

    it('should throw ENOENT if parent directory does not exist', async () => {
      await expect(backend.open('/nonexistent/file.txt', 'w')).rejects.toThrow(/ENOENT/)
    })

    it('should throw EISDIR when path is a directory', async () => {
      await expect(backend.open('/test', 'w')).rejects.toThrow(/EISDIR/)
    })
  })

  // ===========================================================================
  // Flag: 'w+' (read/write, create or truncate)
  // ===========================================================================

  describe("flag 'w+' (read/write, create/truncate)", () => {
    it('should create new file if it does not exist', async () => {
      const handle = await backend.open('/test/newfile.txt', 'w+')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/newfile.txt')
      expect(exists).toBe(true)
    })

    it('should truncate existing file', async () => {
      const handle = await backend.open('/test/file.txt', 'w+')

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should allow both reading and writing', async () => {
      const handle = await backend.open('/test/newfile.txt', 'w+')

      // Write some data
      const data = new TextEncoder().encode('Test data')
      await handle.write(data, 0)

      // Read back
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const content = new TextDecoder().decode(buffer.slice(0, bytesRead))

      expect(content).toBe('Test data')

      await handle.close()
    })

    it('should create with default mode 0o666 (modified by umask)', async () => {
      const handle = await backend.open('/test/newfile.txt', 'w+')

      await handle.close()

      const stats = await backend.stat('/test/newfile.txt')
      // Default mode should be around 0o666 (before umask) or 0o644 (after umask)
      expect(stats.mode & 0o777).toBeGreaterThanOrEqual(0o600)
    })
  })

  // ===========================================================================
  // Flag: 'a' (append-only, create if needed)
  // ===========================================================================

  describe("flag 'a' (append-only, create if needed)", () => {
    it('should create new file if it does not exist', async () => {
      const handle = await backend.open('/test/newappend.txt', 'a')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/newappend.txt')
      expect(exists).toBe(true)
    })

    it('should preserve existing content', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a')

      // Content should NOT be truncated
      const stats = await handle.stat()
      expect(stats.size).toBe(13) // "existing data" length

      await handle.close()
    })

    it('should write at end of file regardless of position', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a')

      const appendData = new TextEncoder().encode(' + appended')
      await handle.write(appendData, 0) // Position 0 should be ignored in append mode

      await handle.close()

      // Verify content was appended
      const data = await backend.readFile('/test/appendable.txt')
      const content = new TextDecoder().decode(data)
      expect(content).toBe('existing data + appended')
    })

    it('should not allow reading', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a')

      const buffer = new Uint8Array(1024)
      await expect(handle.read(buffer, 0, buffer.length, 0)).rejects.toThrow(/EBADF|not permitted|write-only|append/)

      await handle.close()
    })
  })

  // ===========================================================================
  // Flag: 'a+' (append and read, create if needed)
  // ===========================================================================

  describe("flag 'a+' (append and read, create if needed)", () => {
    it('should create new file if it does not exist', async () => {
      const handle = await backend.open('/test/newappend.txt', 'a+')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/newappend.txt')
      expect(exists).toBe(true)
    })

    it('should allow reading existing content', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a+')

      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)

      expect(bytesRead).toBe(13) // "existing data" length
      expect(new TextDecoder().decode(buffer.slice(0, bytesRead))).toBe('existing data')

      await handle.close()
    })

    it('should append writes to end of file', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a+')

      const appendData = new TextEncoder().encode(' + more')
      await handle.write(appendData)

      await handle.close()

      // Verify appended
      const data = await backend.readFile('/test/appendable.txt')
      const content = new TextDecoder().decode(data)
      expect(content).toBe('existing data + more')
    })

    it('should allow reading after writing', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a+')

      // Write new data
      await handle.write(new TextEncoder().encode(' + new'))

      // Read from beginning
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)

      const content = new TextDecoder().decode(buffer.slice(0, bytesRead))
      expect(content).toContain('existing data')

      await handle.close()
    })
  })

  // ===========================================================================
  // Flag: 'x' (exclusive creation)
  // ===========================================================================

  describe("flag 'x' variations (exclusive creation)", () => {
    it("'wx' should create new file exclusively", async () => {
      const handle = await backend.open('/test/exclusive.txt', 'wx')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/exclusive.txt')
      expect(exists).toBe(true)
    })

    it("'wx' should throw EEXIST if file exists", async () => {
      await expect(backend.open('/test/file.txt', 'wx')).rejects.toThrow(/EEXIST/)
    })

    it("'w+x' should create new file exclusively with read/write", async () => {
      const handle = await backend.open('/test/exclusive.txt', 'w+x')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/exclusive.txt')
      expect(exists).toBe(true)
    })

    it("'w+x' should throw EEXIST if file exists", async () => {
      await expect(backend.open('/test/file.txt', 'w+x')).rejects.toThrow(/EEXIST/)
    })

    it("'ax' should create new file exclusively for append", async () => {
      const handle = await backend.open('/test/exclusive.txt', 'ax')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/exclusive.txt')
      expect(exists).toBe(true)
    })

    it("'ax' should throw EEXIST if file exists", async () => {
      await expect(backend.open('/test/file.txt', 'ax')).rejects.toThrow(/EEXIST/)
    })

    it("'a+x' should create new file exclusively for append/read", async () => {
      const handle = await backend.open('/test/exclusive.txt', 'a+x')

      expect(handle).toBeDefined()

      await handle.close()
    })

    it("'xw' should be equivalent to 'wx'", async () => {
      const handle = await backend.open('/test/exclusive.txt', 'xw')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/exclusive.txt')
      expect(exists).toBe(true)
    })
  })

  // ===========================================================================
  // Numeric flags
  // ===========================================================================

  describe('numeric flags (O_RDONLY, O_WRONLY, etc.)', () => {
    it('O_RDONLY should open for reading only', async () => {
      const handle = await backend.open('/test/file.txt', O_RDONLY.toString())

      expect(handle).toBeDefined()

      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(13)

      await handle.close()
    })

    it('O_RDONLY should throw ENOENT if file does not exist', async () => {
      await expect(backend.open('/test/nonexistent.txt', O_RDONLY.toString())).rejects.toThrow(/ENOENT/)
    })

    it('O_WRONLY should open for writing only', async () => {
      const handle = await backend.open('/test/file.txt', O_WRONLY.toString())

      expect(handle).toBeDefined()

      // Writing should work
      const data = new TextEncoder().encode('test')
      const { bytesWritten } = await handle.write(data)
      expect(bytesWritten).toBe(4)

      // Reading should fail
      const buffer = new Uint8Array(1024)
      await expect(handle.read(buffer, 0, buffer.length, 0)).rejects.toThrow(/EBADF|not permitted|write-only/)

      await handle.close()
    })

    it('O_RDWR should open for reading and writing', async () => {
      const handle = await backend.open('/test/file.txt', O_RDWR.toString())

      expect(handle).toBeDefined()

      // Reading should work
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(13)

      // Writing should work
      const data = new TextEncoder().encode('test')
      const { bytesWritten } = await handle.write(data, 0)
      expect(bytesWritten).toBe(4)

      await handle.close()
    })

    it('O_CREAT should create file if it does not exist', async () => {
      // Use combination string for flags
      const flags = 'w' // 'w' implies O_WRONLY | O_CREAT | O_TRUNC
      const handle = await backend.open('/test/newfile.txt', flags)

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/newfile.txt')
      expect(exists).toBe(true)
    })

    it('O_CREAT without O_EXCL should succeed if file exists', async () => {
      const flags = 'w' // implies O_CREAT
      const handle = await backend.open('/test/file.txt', flags)

      expect(handle).toBeDefined()

      await handle.close()
    })

    it('O_CREAT | O_EXCL should fail if file exists', async () => {
      await expect(backend.open('/test/file.txt', 'wx')).rejects.toThrow(/EEXIST/)
    })

    it('O_CREAT | O_EXCL should create new file', async () => {
      const handle = await backend.open('/test/newexcl.txt', 'wx')

      expect(handle).toBeDefined()

      await handle.close()

      const exists = await backend.exists('/test/newexcl.txt')
      expect(exists).toBe(true)
    })

    it('O_TRUNC should truncate existing file', async () => {
      const handle = await backend.open('/test/file.txt', 'w') // 'w' implies O_TRUNC

      expect(handle).toBeDefined()

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('O_APPEND should append writes to end of file', async () => {
      const handle = await backend.open('/test/appendable.txt', 'a')

      const appendData = new TextEncoder().encode(' + numeric')
      await handle.write(appendData)

      await handle.close()

      const data = await backend.readFile('/test/appendable.txt')
      const content = new TextDecoder().decode(data)
      expect(content).toBe('existing data + numeric')
    })
  })

  // ===========================================================================
  // Flag combinations
  // ===========================================================================

  describe('flag combinations', () => {
    it("'rs' should open for synchronous reading", async () => {
      const handle = await backend.open('/test/file.txt', 'rs')

      expect(handle).toBeDefined()

      await handle.close()
    })

    it("'rs+' should open for synchronous read/write", async () => {
      const handle = await backend.open('/test/file.txt', 'rs+')

      expect(handle).toBeDefined()

      await handle.close()
    })
  })

  // ===========================================================================
  // Error cases
  // ===========================================================================

  describe('error cases', () => {
    it('should throw ENOENT for non-existent path with "r"', async () => {
      await expect(backend.open('/nonexistent/path/file.txt', 'r')).rejects.toThrow(/ENOENT/)
    })

    it('should throw ENOENT for non-existent parent directory with "w"', async () => {
      await expect(backend.open('/nonexistent/dir/file.txt', 'w')).rejects.toThrow(/ENOENT/)
    })

    it('should throw EISDIR when opening directory', async () => {
      await expect(backend.open('/test', 'r')).rejects.toThrow(/EISDIR/)
      await expect(backend.open('/test', 'w')).rejects.toThrow(/EISDIR/)
      await expect(backend.open('/test', 'a')).rejects.toThrow(/EISDIR/)
    })

    it('should throw EEXIST when using exclusive flag on existing file', async () => {
      await expect(backend.open('/test/file.txt', 'wx')).rejects.toThrow(/EEXIST/)
    })

    it('should throw EINVAL for invalid flag string', async () => {
      await expect(backend.open('/test/file.txt', 'invalid')).rejects.toThrow(/EINVAL|invalid|unknown/)
    })

    it('should throw EINVAL for conflicting flags', async () => {
      // Combined 'r' and 'w' without '+' is invalid
      await expect(backend.open('/test/file.txt', 'rw')).rejects.toThrow(/EINVAL|invalid|unknown/)
    })

    it('should handle empty path', async () => {
      await expect(backend.open('', 'r')).rejects.toThrow()
    })
  })

  // ===========================================================================
  // FileHandle operations
  // ===========================================================================

  describe('FileHandle operations', () => {
    it('should throw error after closing handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r')
      await handle.close()

      const buffer = new Uint8Array(1024)
      await expect(handle.read(buffer, 0, buffer.length, 0)).rejects.toThrow(/closed|EBADF/)
    })

    it('should support stat() on file handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r')
      const stats = await handle.stat()

      expect(stats.size).toBe(13)
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)

      await handle.close()
    })

    it('should support sync() on file handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await expect(handle.sync()).resolves.toBeUndefined()

      await handle.close()
    })

    it('should support datasync() on file handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await expect(handle.datasync()).resolves.toBeUndefined()

      await handle.close()
    })

    it('should support chmod() on file handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await handle.chmod(0o600)

      await handle.close()
    })

    it('should support chown() on file handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await handle.chown(1001, 1001)

      await handle.close()
    })

    it('should return correct fd for multiple handles', async () => {
      const handle1 = await backend.open('/test/file.txt', 'r')
      const handle2 = await backend.open('/test/empty.txt', 'r')
      const handle3 = await backend.open('/test/appendable.txt', 'r')

      expect(handle1.fd).not.toBe(handle2.fd)
      expect(handle2.fd).not.toBe(handle3.fd)
      expect(handle1.fd).not.toBe(handle3.fd)

      await handle1.close()
      await handle2.close()
      await handle3.close()
    })

    it('should track file position correctly', async () => {
      const handle = await backend.open('/test/file.txt', 'r')
      const buffer = new Uint8Array(5)

      // First read: "Hello"
      let result = await handle.read(buffer, 0, 5)
      expect(new TextDecoder().decode(buffer.slice(0, result.bytesRead))).toBe('Hello')

      // Second read: ", Wor"
      result = await handle.read(buffer, 0, 5)
      expect(new TextDecoder().decode(buffer.slice(0, result.bytesRead))).toBe(', Wor')

      // Third read: "ld!"
      result = await handle.read(buffer, 0, 5)
      expect(new TextDecoder().decode(buffer.slice(0, result.bytesRead))).toBe('ld!')

      await handle.close()
    })

    it('should allow reading at specific position without advancing cursor', async () => {
      const handle = await backend.open('/test/file.txt', 'r')
      const buffer = new Uint8Array(5)

      // Read at position 7
      await handle.read(buffer, 0, 5, 7)
      expect(new TextDecoder().decode(buffer)).toBe('World')

      // Read at position 0
      await handle.read(buffer, 0, 5, 0)
      expect(new TextDecoder().decode(buffer)).toBe('Hello')

      await handle.close()
    })
  })

  // ===========================================================================
  // Mode parameter
  // ===========================================================================

  describe('mode parameter', () => {
    it('should create file with specified mode', async () => {
      const handle = await backend.open('/test/newmode.txt', 'w', 0o600)

      await handle.close()

      const stats = await backend.stat('/test/newmode.txt')
      expect(stats.mode & 0o777).toBe(0o600)
    })

    it('should use default mode when not specified', async () => {
      const handle = await backend.open('/test/defaultmode.txt', 'w')

      await handle.close()

      const stats = await backend.stat('/test/defaultmode.txt')
      // Default should be 0o666 (before umask) or 0o644 (after umask)
      expect(stats.mode & 0o777).toBeGreaterThanOrEqual(0o600)
    })

    it('should accept mode as third argument with string flags', async () => {
      const handle = await backend.open('/test/stringmode.txt', 'wx', 0o640)

      await handle.close()

      const stats = await backend.stat('/test/stringmode.txt')
      expect(stats.mode & 0o777).toBe(0o640)
    })
  })
})
