/**
 * Tests for core filesystem types - RED phase
 *
 * These tests define the expected API for type definitions and error classes.
 * They serve as a specification for what the implementation should provide.
 *
 * @module test/core/types
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Stats, Dirent, FileHandle, StatsInit, StatsLike } from '../../core/types'
import {
  FSError,
  ENOENT,
  EEXIST,
  EISDIR,
  ENOTDIR,
  EACCES,
  ENOTEMPTY,
  EINVAL,
  EBADF,
  EPERM,
  ELOOP,
  ENAMETOOLONG,
  ENOSPC,
  EROFS,
  EBUSY,
  EMFILE,
  ENFILE,
  EXDEV,
} from '../../core/errors'
import {
  constants,
  isFile,
  isDirectory,
  isSymlink,
  isBlockDevice,
  isCharacterDevice,
  isFIFO,
  isSocket,
  hasReadPermission,
  hasWritePermission,
  hasExecutePermission,
} from '../../core/constants'

// =============================================================================
// Stats Class Tests
// =============================================================================

describe('Stats class', () => {
  let stats: Stats
  const now = Date.now()

  const defaultInit: StatsInit = {
    dev: 2114,
    ino: 48064969,
    mode: 0o100644, // Regular file with rw-r--r--
    nlink: 1,
    uid: 1000,
    gid: 1000,
    rdev: 0,
    size: 1024,
    blksize: 4096,
    blocks: 8,
    atimeMs: now,
    mtimeMs: now - 1000,
    ctimeMs: now - 2000,
    birthtimeMs: now - 10000,
  }

  beforeEach(() => {
    stats = new Stats(defaultInit)
  })

  describe('basic properties', () => {
    it('should have mode property', () => {
      expect(stats.mode).toBe(0o100644)
    })

    it('should have uid property', () => {
      expect(stats.uid).toBe(1000)
    })

    it('should have gid property', () => {
      expect(stats.gid).toBe(1000)
    })

    it('should have size property', () => {
      expect(stats.size).toBe(1024)
    })

    it('should have dev property', () => {
      expect(stats.dev).toBe(2114)
    })

    it('should have ino property', () => {
      expect(stats.ino).toBe(48064969)
    })

    it('should have nlink property', () => {
      expect(stats.nlink).toBe(1)
    })

    it('should have rdev property', () => {
      expect(stats.rdev).toBe(0)
    })

    it('should have blksize property', () => {
      expect(stats.blksize).toBe(4096)
    })

    it('should have blocks property', () => {
      expect(stats.blocks).toBe(8)
    })
  })

  describe('Date timestamp properties', () => {
    it('should have atime as Date', () => {
      expect(stats.atime).toBeInstanceOf(Date)
      expect(stats.atime.getTime()).toBe(now)
    })

    it('should have mtime as Date', () => {
      expect(stats.mtime).toBeInstanceOf(Date)
      expect(stats.mtime.getTime()).toBe(now - 1000)
    })

    it('should have ctime as Date', () => {
      expect(stats.ctime).toBeInstanceOf(Date)
      expect(stats.ctime.getTime()).toBe(now - 2000)
    })

    it('should have birthtime as Date', () => {
      expect(stats.birthtime).toBeInstanceOf(Date)
      expect(stats.birthtime.getTime()).toBe(now - 10000)
    })
  })

  describe('millisecond timestamp properties', () => {
    it('should have atimeMs property', () => {
      expect(stats.atimeMs).toBe(now)
    })

    it('should have mtimeMs property', () => {
      expect(stats.mtimeMs).toBe(now - 1000)
    })

    it('should have ctimeMs property', () => {
      expect(stats.ctimeMs).toBe(now - 2000)
    })

    it('should have birthtimeMs property', () => {
      expect(stats.birthtimeMs).toBe(now - 10000)
    })
  })

  describe('type check methods - regular file', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFREG | 0o644, // Regular file
      })
    })

    it('should return true for isFile()', () => {
      expect(stats.isFile()).toBe(true)
    })

    it('should return false for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(stats.isSocket()).toBe(false)
    })
  })

  describe('type check methods - directory', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFDIR | 0o755, // Directory
      })
    })

    it('should return false for isFile()', () => {
      expect(stats.isFile()).toBe(false)
    })

    it('should return true for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(true)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(stats.isSocket()).toBe(false)
    })
  })

  describe('type check methods - symbolic link', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFLNK | 0o777, // Symbolic link
      })
    })

    it('should return false for isFile()', () => {
      expect(stats.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(false)
    })

    it('should return true for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(true)
    })

    it('should return false for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(stats.isSocket()).toBe(false)
    })
  })

  describe('type check methods - block device', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFBLK | 0o660, // Block device
      })
    })

    it('should return false for isFile()', () => {
      expect(stats.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return true for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(true)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(stats.isSocket()).toBe(false)
    })
  })

  describe('type check methods - character device', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFCHR | 0o666, // Character device
      })
    })

    it('should return false for isFile()', () => {
      expect(stats.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(false)
    })

    it('should return true for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(true)
    })

    it('should return false for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(stats.isSocket()).toBe(false)
    })
  })

  describe('type check methods - FIFO', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFIFO | 0o644, // FIFO (named pipe)
      })
    })

    it('should return false for isFile()', () => {
      expect(stats.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(false)
    })

    it('should return true for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(true)
    })

    it('should return false for isSocket()', () => {
      expect(stats.isSocket()).toBe(false)
    })
  })

  describe('type check methods - socket', () => {
    beforeEach(() => {
      stats = new Stats({
        ...defaultInit,
        mode: constants.S_IFSOCK | 0o755, // Socket
      })
    })

    it('should return false for isFile()', () => {
      expect(stats.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(stats.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(stats.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(stats.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(stats.isFIFO()).toBe(false)
    })

    it('should return true for isSocket()', () => {
      expect(stats.isSocket()).toBe(true)
    })
  })

  describe('readonly properties', () => {
    it('should have readonly properties', () => {
      // TypeScript will enforce this at compile time
      // At runtime, we verify the values don't change after construction
      const originalMode = stats.mode
      const originalSize = stats.size

      // These should remain unchanged
      expect(stats.mode).toBe(originalMode)
      expect(stats.size).toBe(originalSize)
    })
  })
})

// =============================================================================
// Dirent Class Tests
// =============================================================================

describe('Dirent class', () => {
  let dirent: Dirent

  describe('properties', () => {
    beforeEach(() => {
      dirent = new Dirent('test.txt', '/home/user', 'file')
    })

    it('should have name property', () => {
      expect(dirent.name).toBe('test.txt')
    })

    it('should have parentPath property', () => {
      expect(dirent.parentPath).toBe('/home/user')
    })

    it('should have path property combining parentPath and name', () => {
      expect(dirent.path).toBe('/home/user/test.txt')
    })

    it('should handle parentPath with trailing slash', () => {
      dirent = new Dirent('test.txt', '/home/user/', 'file')
      expect(dirent.path).toBe('/home/user/test.txt')
    })

    it('should handle root parentPath', () => {
      dirent = new Dirent('test.txt', '/', 'file')
      expect(dirent.path).toBe('/test.txt')
    })
  })

  describe('type check methods - file', () => {
    beforeEach(() => {
      dirent = new Dirent('file.txt', '/home', 'file')
    })

    it('should return true for isFile()', () => {
      expect(dirent.isFile()).toBe(true)
    })

    it('should return false for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(dirent.isSocket()).toBe(false)
    })
  })

  describe('type check methods - directory', () => {
    beforeEach(() => {
      dirent = new Dirent('mydir', '/home', 'directory')
    })

    it('should return false for isFile()', () => {
      expect(dirent.isFile()).toBe(false)
    })

    it('should return true for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(true)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(dirent.isSocket()).toBe(false)
    })
  })

  describe('type check methods - symbolic link', () => {
    beforeEach(() => {
      dirent = new Dirent('mylink', '/home', 'symlink')
    })

    it('should return false for isFile()', () => {
      expect(dirent.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should return true for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(true)
    })

    it('should return false for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(dirent.isSocket()).toBe(false)
    })
  })

  describe('type check methods - block device', () => {
    beforeEach(() => {
      dirent = new Dirent('sda', '/dev', 'block')
    })

    it('should return false for isFile()', () => {
      expect(dirent.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(false)
    })

    it('should return true for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(true)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(dirent.isSocket()).toBe(false)
    })
  })

  describe('type check methods - character device', () => {
    beforeEach(() => {
      dirent = new Dirent('null', '/dev', 'character')
    })

    it('should return false for isFile()', () => {
      expect(dirent.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(false)
    })

    it('should return true for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(true)
    })

    it('should return false for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(false)
    })

    it('should return false for isSocket()', () => {
      expect(dirent.isSocket()).toBe(false)
    })
  })

  describe('type check methods - FIFO', () => {
    beforeEach(() => {
      dirent = new Dirent('mypipe', '/var/run', 'fifo')
    })

    it('should return false for isFile()', () => {
      expect(dirent.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(false)
    })

    it('should return true for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(true)
    })

    it('should return false for isSocket()', () => {
      expect(dirent.isSocket()).toBe(false)
    })
  })

  describe('type check methods - socket', () => {
    beforeEach(() => {
      dirent = new Dirent('mysql.sock', '/var/run', 'socket')
    })

    it('should return false for isFile()', () => {
      expect(dirent.isFile()).toBe(false)
    })

    it('should return false for isDirectory()', () => {
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should return false for isSymbolicLink()', () => {
      expect(dirent.isSymbolicLink()).toBe(false)
    })

    it('should return false for isBlockDevice()', () => {
      expect(dirent.isBlockDevice()).toBe(false)
    })

    it('should return false for isCharacterDevice()', () => {
      expect(dirent.isCharacterDevice()).toBe(false)
    })

    it('should return false for isFIFO()', () => {
      expect(dirent.isFIFO()).toBe(false)
    })

    it('should return true for isSocket()', () => {
      expect(dirent.isSocket()).toBe(true)
    })
  })
})

// =============================================================================
// FileHandle Interface Tests
// =============================================================================

describe('FileHandle class', () => {
  let handle: FileHandle
  let mockData: Uint8Array
  let mockStats: StatsLike

  beforeEach(() => {
    mockData = new TextEncoder().encode('Hello, World!')
    const now = Date.now()

    mockStats = {
      dev: 2114,
      ino: 48064969,
      mode: constants.S_IFREG | 0o644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: mockData.length,
      blksize: 4096,
      blocks: 1,
      atime: new Date(now),
      mtime: new Date(now),
      ctime: new Date(now),
      birthtime: new Date(now),
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    }

    handle = new FileHandle(42, mockData, mockStats)
  })

  describe('fd property', () => {
    it('should have fd property as number', () => {
      expect(handle.fd).toBe(42)
      expect(typeof handle.fd).toBe('number')
    })

    it('should be readonly', () => {
      const originalFd = handle.fd
      expect(handle.fd).toBe(originalFd)
    })
  })

  describe('read method', () => {
    it('should read data into buffer', async () => {
      const buffer = new Uint8Array(20)
      const result = await handle.read(buffer)

      expect(result.bytesRead).toBe(13)
      expect(result.buffer).toBe(buffer)
    })

    it('should read with offset parameter', async () => {
      const buffer = new Uint8Array(20)
      const result = await handle.read(buffer, 5)

      expect(result.bytesRead).toBe(13)
      const decoded = new TextDecoder().decode(buffer.slice(5, 5 + result.bytesRead))
      expect(decoded).toBe('Hello, World!')
    })

    it('should read with length limit', async () => {
      const buffer = new Uint8Array(20)
      const result = await handle.read(buffer, 0, 5)

      expect(result.bytesRead).toBe(5)
    })

    it('should read from position', async () => {
      const buffer = new Uint8Array(20)
      const result = await handle.read(buffer, 0, 5, 7)

      expect(result.bytesRead).toBe(5)
      const decoded = new TextDecoder().decode(buffer.slice(0, result.bytesRead))
      expect(decoded).toBe('World')
    })

    it('should return bytesRead and buffer in result', async () => {
      const buffer = new Uint8Array(20)
      const result = await handle.read(buffer)

      expect(result).toHaveProperty('bytesRead')
      expect(result).toHaveProperty('buffer')
      expect(typeof result.bytesRead).toBe('number')
      expect(result.buffer).toBeInstanceOf(Uint8Array)
    })
  })

  describe('write method', () => {
    it('should write Uint8Array data', async () => {
      const data = new TextEncoder().encode('Test')
      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(4)
    })

    it('should write string data', async () => {
      const result = await handle.write('Test string')

      expect(result.bytesWritten).toBe(11)
    })

    it('should write at specified position', async () => {
      const data = new TextEncoder().encode('XXX')
      const result = await handle.write(data, 0)

      expect(result.bytesWritten).toBe(3)
    })

    it('should return bytesWritten in result', async () => {
      const result = await handle.write('data')

      expect(result).toHaveProperty('bytesWritten')
      expect(typeof result.bytesWritten).toBe('number')
    })
  })

  describe('stat method', () => {
    it('should return Stats object', async () => {
      const stats = await handle.stat()

      expect(stats).toBeInstanceOf(Stats)
    })

    it('should return correct size', async () => {
      const stats = await handle.stat()

      expect(stats.size).toBe(13)
    })

    it('should identify as file', async () => {
      const stats = await handle.stat()

      expect(stats.isFile()).toBe(true)
    })
  })

  describe('truncate method', () => {
    it('should truncate to specified length', async () => {
      await handle.truncate(5)
      const stats = await handle.stat()

      expect(stats.size).toBe(5)
    })

    it('should truncate to zero by default', async () => {
      await handle.truncate()
      const stats = await handle.stat()

      expect(stats.size).toBe(0)
    })

    it('should extend file if length is greater than current size', async () => {
      await handle.truncate(20)
      const stats = await handle.stat()

      expect(stats.size).toBe(20)
    })
  })

  describe('sync method', () => {
    it('should return void promise', async () => {
      const result = await handle.sync()

      expect(result).toBeUndefined()
    })
  })

  describe('close method', () => {
    it('should close the handle', async () => {
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should throw when using closed handle for read', async () => {
      await handle.close()

      await expect(handle.read(new Uint8Array(10))).rejects.toThrow()
    })

    it('should throw when using closed handle for write', async () => {
      await handle.close()

      await expect(handle.write('data')).rejects.toThrow()
    })

    it('should throw when using closed handle for stat', async () => {
      await handle.close()

      await expect(handle.stat()).rejects.toThrow()
    })

    it('should throw when using closed handle for truncate', async () => {
      await handle.close()

      await expect(handle.truncate(5)).rejects.toThrow()
    })

    it('should throw when using closed handle for sync', async () => {
      await handle.close()

      await expect(handle.sync()).rejects.toThrow()
    })
  })

  describe('createReadStream method', () => {
    it('should return ReadableStream', () => {
      const stream = handle.createReadStream()

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should accept start option', () => {
      const stream = handle.createReadStream({ start: 5 })

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should accept end option', () => {
      const stream = handle.createReadStream({ end: 10 })

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should accept highWaterMark option', () => {
      const stream = handle.createReadStream({ highWaterMark: 1024 })

      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should throw when handle is closed', async () => {
      await handle.close()

      expect(() => handle.createReadStream()).toThrow()
    })
  })

  describe('createWriteStream method', () => {
    it('should return WritableStream', () => {
      const stream = handle.createWriteStream()

      expect(stream).toBeInstanceOf(WritableStream)
    })

    it('should accept start option', () => {
      const stream = handle.createWriteStream({ start: 10 })

      expect(stream).toBeInstanceOf(WritableStream)
    })

    it('should throw when handle is closed', async () => {
      await handle.close()

      expect(() => handle.createWriteStream()).toThrow()
    })
  })
})

// =============================================================================
// Error Classes Tests
// =============================================================================

describe('FSError base class', () => {
  it('should extend Error', () => {
    const error = new FSError('ETEST', -99, 'test error', 'test', '/path')

    expect(error).toBeInstanceOf(Error)
  })

  it('should have code property', () => {
    const error = new FSError('ETEST', -99, 'test error', 'test', '/path')

    expect(error.code).toBe('ETEST')
  })

  it('should have errno property', () => {
    const error = new FSError('ETEST', -99, 'test error', 'test', '/path')

    expect(error.errno).toBe(-99)
  })

  it('should have syscall property', () => {
    const error = new FSError('ETEST', -99, 'test error', 'test', '/path')

    expect(error.syscall).toBe('test')
  })

  it('should have path property', () => {
    const error = new FSError('ETEST', -99, 'test error', 'test', '/path')

    expect(error.path).toBe('/path')
  })

  it('should have dest property for rename operations', () => {
    const error = new FSError('ETEST', -99, 'test error', 'rename', '/src', '/dest')

    expect(error.dest).toBe('/dest')
  })

  it('should format message correctly', () => {
    const error = new FSError('ETEST', -99, 'test error', 'open', '/path')

    expect(error.message).toContain('ETEST')
    expect(error.message).toContain('test error')
    expect(error.message).toContain('open')
    expect(error.message).toContain('/path')
  })
})

describe('ENOENT error', () => {
  it('should extend FSError', () => {
    const error = new ENOENT('open', '/nonexistent')

    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(Error)
  })

  it('should have code ENOENT', () => {
    const error = new ENOENT('open', '/nonexistent')

    expect(error.code).toBe('ENOENT')
  })

  it('should have errno -2', () => {
    const error = new ENOENT('open', '/nonexistent')

    expect(error.errno).toBe(-2)
  })

  it('should have syscall property', () => {
    const error = new ENOENT('stat', '/path')

    expect(error.syscall).toBe('stat')
  })

  it('should have path property', () => {
    const error = new ENOENT('open', '/nonexistent')

    expect(error.path).toBe('/nonexistent')
  })

  it('should have name ENOENT', () => {
    const error = new ENOENT()

    expect(error.name).toBe('ENOENT')
  })

  it('should include "no such file or directory" in message', () => {
    const error = new ENOENT('open', '/nonexistent')

    expect(error.message).toContain('no such file or directory')
  })
})

describe('EEXIST error', () => {
  it('should extend FSError', () => {
    const error = new EEXIST('mkdir', '/exists')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EEXIST', () => {
    const error = new EEXIST('mkdir', '/exists')

    expect(error.code).toBe('EEXIST')
  })

  it('should have errno -17', () => {
    const error = new EEXIST('mkdir', '/exists')

    expect(error.errno).toBe(-17)
  })

  it('should have name EEXIST', () => {
    const error = new EEXIST()

    expect(error.name).toBe('EEXIST')
  })

  it('should include "file already exists" in message', () => {
    const error = new EEXIST('mkdir', '/exists')

    expect(error.message).toContain('file already exists')
  })
})

describe('EISDIR error', () => {
  it('should extend FSError', () => {
    const error = new EISDIR('read', '/directory')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EISDIR', () => {
    const error = new EISDIR('read', '/directory')

    expect(error.code).toBe('EISDIR')
  })

  it('should have errno -21', () => {
    const error = new EISDIR('read', '/directory')

    expect(error.errno).toBe(-21)
  })

  it('should have name EISDIR', () => {
    const error = new EISDIR()

    expect(error.name).toBe('EISDIR')
  })

  it('should include "directory" in message', () => {
    const error = new EISDIR('read', '/directory')

    expect(error.message.toLowerCase()).toContain('directory')
  })
})

describe('ENOTDIR error', () => {
  it('should extend FSError', () => {
    const error = new ENOTDIR('readdir', '/file.txt')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code ENOTDIR', () => {
    const error = new ENOTDIR('readdir', '/file.txt')

    expect(error.code).toBe('ENOTDIR')
  })

  it('should have errno -20', () => {
    const error = new ENOTDIR('readdir', '/file.txt')

    expect(error.errno).toBe(-20)
  })

  it('should have name ENOTDIR', () => {
    const error = new ENOTDIR()

    expect(error.name).toBe('ENOTDIR')
  })

  it('should include "not a directory" in message', () => {
    const error = new ENOTDIR('readdir', '/file.txt')

    expect(error.message).toContain('not a directory')
  })
})

describe('EACCES error', () => {
  it('should extend FSError', () => {
    const error = new EACCES('open', '/protected')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EACCES', () => {
    const error = new EACCES('open', '/protected')

    expect(error.code).toBe('EACCES')
  })

  it('should have errno -13', () => {
    const error = new EACCES('open', '/protected')

    expect(error.errno).toBe(-13)
  })

  it('should have name EACCES', () => {
    const error = new EACCES()

    expect(error.name).toBe('EACCES')
  })

  it('should include "permission denied" in message', () => {
    const error = new EACCES('open', '/protected')

    expect(error.message).toContain('permission denied')
  })
})

describe('ENOTEMPTY error', () => {
  it('should extend FSError', () => {
    const error = new ENOTEMPTY('rmdir', '/nonempty')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code ENOTEMPTY', () => {
    const error = new ENOTEMPTY('rmdir', '/nonempty')

    expect(error.code).toBe('ENOTEMPTY')
  })

  it('should have errno -39', () => {
    const error = new ENOTEMPTY('rmdir', '/nonempty')

    expect(error.errno).toBe(-39)
  })

  it('should have name ENOTEMPTY', () => {
    const error = new ENOTEMPTY()

    expect(error.name).toBe('ENOTEMPTY')
  })

  it('should include "directory not empty" in message', () => {
    const error = new ENOTEMPTY('rmdir', '/nonempty')

    expect(error.message).toContain('directory not empty')
  })
})

describe('EINVAL error', () => {
  it('should extend FSError', () => {
    const error = new EINVAL('open', '/path')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EINVAL', () => {
    const error = new EINVAL('open', '/path')

    expect(error.code).toBe('EINVAL')
  })

  it('should have errno -22', () => {
    const error = new EINVAL('open', '/path')

    expect(error.errno).toBe(-22)
  })

  it('should have name EINVAL', () => {
    const error = new EINVAL()

    expect(error.name).toBe('EINVAL')
  })

  it('should include "invalid argument" in message', () => {
    const error = new EINVAL('open', '/path')

    expect(error.message).toContain('invalid argument')
  })
})

describe('EBADF error', () => {
  it('should extend FSError', () => {
    const error = new EBADF('read')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EBADF', () => {
    const error = new EBADF('read')

    expect(error.code).toBe('EBADF')
  })

  it('should have errno -9', () => {
    const error = new EBADF('read')

    expect(error.errno).toBe(-9)
  })

  it('should have name EBADF', () => {
    const error = new EBADF()

    expect(error.name).toBe('EBADF')
  })

  it('should include "bad file descriptor" in message', () => {
    const error = new EBADF('read')

    expect(error.message).toContain('bad file descriptor')
  })
})

describe('EPERM error', () => {
  it('should extend FSError', () => {
    const error = new EPERM('unlink', '/path')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EPERM', () => {
    const error = new EPERM('unlink', '/path')

    expect(error.code).toBe('EPERM')
  })

  it('should have errno -1', () => {
    const error = new EPERM('unlink', '/path')

    expect(error.errno).toBe(-1)
  })

  it('should have name EPERM', () => {
    const error = new EPERM()

    expect(error.name).toBe('EPERM')
  })
})

describe('ELOOP error', () => {
  it('should extend FSError', () => {
    const error = new ELOOP('stat', '/link')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code ELOOP', () => {
    const error = new ELOOP('stat', '/link')

    expect(error.code).toBe('ELOOP')
  })

  it('should have errno -40', () => {
    const error = new ELOOP('stat', '/link')

    expect(error.errno).toBe(-40)
  })
})

describe('ENAMETOOLONG error', () => {
  it('should extend FSError', () => {
    const error = new ENAMETOOLONG('open', '/very/long/path')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code ENAMETOOLONG', () => {
    const error = new ENAMETOOLONG('open', '/path')

    expect(error.code).toBe('ENAMETOOLONG')
  })

  it('should have errno -36', () => {
    const error = new ENAMETOOLONG('open', '/path')

    expect(error.errno).toBe(-36)
  })
})

describe('ENOSPC error', () => {
  it('should extend FSError', () => {
    const error = new ENOSPC('write', '/file')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code ENOSPC', () => {
    const error = new ENOSPC('write', '/file')

    expect(error.code).toBe('ENOSPC')
  })

  it('should have errno -28', () => {
    const error = new ENOSPC('write', '/file')

    expect(error.errno).toBe(-28)
  })
})

describe('EROFS error', () => {
  it('should extend FSError', () => {
    const error = new EROFS('write', '/readonly')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EROFS', () => {
    const error = new EROFS('write', '/readonly')

    expect(error.code).toBe('EROFS')
  })

  it('should have errno -30', () => {
    const error = new EROFS('write', '/readonly')

    expect(error.errno).toBe(-30)
  })
})

describe('EBUSY error', () => {
  it('should extend FSError', () => {
    const error = new EBUSY('unlink', '/busy')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EBUSY', () => {
    const error = new EBUSY('unlink', '/busy')

    expect(error.code).toBe('EBUSY')
  })

  it('should have errno -16', () => {
    const error = new EBUSY('unlink', '/busy')

    expect(error.errno).toBe(-16)
  })
})

describe('EMFILE error', () => {
  it('should extend FSError', () => {
    const error = new EMFILE('open', '/file')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EMFILE', () => {
    const error = new EMFILE('open', '/file')

    expect(error.code).toBe('EMFILE')
  })

  it('should have errno -24', () => {
    const error = new EMFILE('open', '/file')

    expect(error.errno).toBe(-24)
  })
})

describe('ENFILE error', () => {
  it('should extend FSError', () => {
    const error = new ENFILE('open', '/file')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code ENFILE', () => {
    const error = new ENFILE('open', '/file')

    expect(error.code).toBe('ENFILE')
  })

  it('should have errno -23', () => {
    const error = new ENFILE('open', '/file')

    expect(error.errno).toBe(-23)
  })
})

describe('EXDEV error', () => {
  it('should extend FSError', () => {
    const error = new EXDEV('rename', '/src', '/dest')

    expect(error).toBeInstanceOf(FSError)
  })

  it('should have code EXDEV', () => {
    const error = new EXDEV('rename', '/src', '/dest')

    expect(error.code).toBe('EXDEV')
  })

  it('should have errno -18', () => {
    const error = new EXDEV('rename', '/src', '/dest')

    expect(error.errno).toBe(-18)
  })

  it('should have dest property', () => {
    const error = new EXDEV('rename', '/src', '/dest')

    expect(error.dest).toBe('/dest')
  })
})

// =============================================================================
// Constants Tests
// =============================================================================

describe('constants', () => {
  describe('file type constants', () => {
    it('should have S_IFMT (file type mask)', () => {
      expect(constants.S_IFMT).toBe(0o170000)
    })

    it('should have S_IFREG (regular file)', () => {
      expect(constants.S_IFREG).toBe(0o100000)
    })

    it('should have S_IFDIR (directory)', () => {
      expect(constants.S_IFDIR).toBe(0o040000)
    })

    it('should have S_IFLNK (symbolic link)', () => {
      expect(constants.S_IFLNK).toBe(0o120000)
    })

    it('should have S_IFBLK (block device)', () => {
      expect(constants.S_IFBLK).toBe(0o060000)
    })

    it('should have S_IFCHR (character device)', () => {
      expect(constants.S_IFCHR).toBe(0o020000)
    })

    it('should have S_IFIFO (FIFO)', () => {
      expect(constants.S_IFIFO).toBe(0o010000)
    })

    it('should have S_IFSOCK (socket)', () => {
      expect(constants.S_IFSOCK).toBe(0o140000)
    })
  })

  describe('permission constants - owner', () => {
    it('should have S_IRWXU (owner rwx)', () => {
      expect(constants.S_IRWXU).toBe(0o700)
    })

    it('should have S_IRUSR (owner read)', () => {
      expect(constants.S_IRUSR).toBe(0o400)
    })

    it('should have S_IWUSR (owner write)', () => {
      expect(constants.S_IWUSR).toBe(0o200)
    })

    it('should have S_IXUSR (owner execute)', () => {
      expect(constants.S_IXUSR).toBe(0o100)
    })
  })

  describe('permission constants - group', () => {
    it('should have S_IRWXG (group rwx)', () => {
      expect(constants.S_IRWXG).toBe(0o070)
    })

    it('should have S_IRGRP (group read)', () => {
      expect(constants.S_IRGRP).toBe(0o040)
    })

    it('should have S_IWGRP (group write)', () => {
      expect(constants.S_IWGRP).toBe(0o020)
    })

    it('should have S_IXGRP (group execute)', () => {
      expect(constants.S_IXGRP).toBe(0o010)
    })
  })

  describe('permission constants - other', () => {
    it('should have S_IRWXO (other rwx)', () => {
      expect(constants.S_IRWXO).toBe(0o007)
    })

    it('should have S_IROTH (other read)', () => {
      expect(constants.S_IROTH).toBe(0o004)
    })

    it('should have S_IWOTH (other write)', () => {
      expect(constants.S_IWOTH).toBe(0o002)
    })

    it('should have S_IXOTH (other execute)', () => {
      expect(constants.S_IXOTH).toBe(0o001)
    })
  })

  describe('special permission bits', () => {
    it('should have S_ISUID (set user ID)', () => {
      expect(constants.S_ISUID).toBe(0o4000)
    })

    it('should have S_ISGID (set group ID)', () => {
      expect(constants.S_ISGID).toBe(0o2000)
    })

    it('should have S_ISVTX (sticky bit)', () => {
      expect(constants.S_ISVTX).toBe(0o1000)
    })
  })

  describe('access constants', () => {
    it('should have F_OK (file exists)', () => {
      expect(constants.F_OK).toBe(0)
    })

    it('should have R_OK (read permission)', () => {
      expect(constants.R_OK).toBe(4)
    })

    it('should have W_OK (write permission)', () => {
      expect(constants.W_OK).toBe(2)
    })

    it('should have X_OK (execute permission)', () => {
      expect(constants.X_OK).toBe(1)
    })
  })

  describe('open flags', () => {
    it('should have O_RDONLY (read only)', () => {
      expect(constants.O_RDONLY).toBe(0)
    })

    it('should have O_WRONLY (write only)', () => {
      expect(constants.O_WRONLY).toBe(1)
    })

    it('should have O_RDWR (read/write)', () => {
      expect(constants.O_RDWR).toBe(2)
    })

    it('should have O_CREAT (create)', () => {
      expect(constants.O_CREAT).toBe(64)
    })

    it('should have O_EXCL (exclusive)', () => {
      expect(constants.O_EXCL).toBe(128)
    })

    it('should have O_TRUNC (truncate)', () => {
      expect(constants.O_TRUNC).toBe(512)
    })

    it('should have O_APPEND (append)', () => {
      expect(constants.O_APPEND).toBe(1024)
    })

    it('should have O_SYNC (synchronous)', () => {
      expect(constants.O_SYNC).toBe(4096)
    })

    it('should have O_DIRECTORY (directory)', () => {
      expect(constants.O_DIRECTORY).toBe(65536)
    })

    it('should have O_NOFOLLOW (no follow symlinks)', () => {
      expect(constants.O_NOFOLLOW).toBe(131072)
    })
  })

  describe('copy flags', () => {
    it('should have COPYFILE_EXCL', () => {
      expect(constants.COPYFILE_EXCL).toBe(1)
    })

    it('should have COPYFILE_FICLONE', () => {
      expect(constants.COPYFILE_FICLONE).toBe(2)
    })

    it('should have COPYFILE_FICLONE_FORCE', () => {
      expect(constants.COPYFILE_FICLONE_FORCE).toBe(4)
    })
  })

  describe('seek modes', () => {
    it('should have SEEK_SET', () => {
      expect(constants.SEEK_SET).toBe(0)
    })

    it('should have SEEK_CUR', () => {
      expect(constants.SEEK_CUR).toBe(1)
    })

    it('should have SEEK_END', () => {
      expect(constants.SEEK_END).toBe(2)
    })
  })
})

// =============================================================================
// Mode Detection Helper Tests
// =============================================================================

describe('mode detection helpers', () => {
  describe('isFile', () => {
    it('should return true for regular file mode', () => {
      expect(isFile(constants.S_IFREG | 0o644)).toBe(true)
    })

    it('should return false for directory mode', () => {
      expect(isFile(constants.S_IFDIR | 0o755)).toBe(false)
    })

    it('should return false for symlink mode', () => {
      expect(isFile(constants.S_IFLNK | 0o777)).toBe(false)
    })
  })

  describe('isDirectory', () => {
    it('should return true for directory mode', () => {
      expect(isDirectory(constants.S_IFDIR | 0o755)).toBe(true)
    })

    it('should return false for file mode', () => {
      expect(isDirectory(constants.S_IFREG | 0o644)).toBe(false)
    })
  })

  describe('isSymlink', () => {
    it('should return true for symlink mode', () => {
      expect(isSymlink(constants.S_IFLNK | 0o777)).toBe(true)
    })

    it('should return false for file mode', () => {
      expect(isSymlink(constants.S_IFREG | 0o644)).toBe(false)
    })
  })

  describe('isBlockDevice', () => {
    it('should return true for block device mode', () => {
      expect(isBlockDevice(constants.S_IFBLK | 0o660)).toBe(true)
    })

    it('should return false for file mode', () => {
      expect(isBlockDevice(constants.S_IFREG | 0o644)).toBe(false)
    })
  })

  describe('isCharacterDevice', () => {
    it('should return true for character device mode', () => {
      expect(isCharacterDevice(constants.S_IFCHR | 0o666)).toBe(true)
    })

    it('should return false for file mode', () => {
      expect(isCharacterDevice(constants.S_IFREG | 0o644)).toBe(false)
    })
  })

  describe('isFIFO', () => {
    it('should return true for FIFO mode', () => {
      expect(isFIFO(constants.S_IFIFO | 0o644)).toBe(true)
    })

    it('should return false for file mode', () => {
      expect(isFIFO(constants.S_IFREG | 0o644)).toBe(false)
    })
  })

  describe('isSocket', () => {
    it('should return true for socket mode', () => {
      expect(isSocket(constants.S_IFSOCK | 0o755)).toBe(true)
    })

    it('should return false for file mode', () => {
      expect(isSocket(constants.S_IFREG | 0o644)).toBe(false)
    })
  })
})

// =============================================================================
// Permission Checking Helper Tests
// =============================================================================

describe('permission checking helpers', () => {
  describe('hasReadPermission', () => {
    it('should detect user read permission', () => {
      expect(hasReadPermission(0o400, 'user')).toBe(true)
      expect(hasReadPermission(0o000, 'user')).toBe(false)
    })

    it('should detect group read permission', () => {
      expect(hasReadPermission(0o040, 'group')).toBe(true)
      expect(hasReadPermission(0o000, 'group')).toBe(false)
    })

    it('should detect other read permission', () => {
      expect(hasReadPermission(0o004, 'other')).toBe(true)
      expect(hasReadPermission(0o000, 'other')).toBe(false)
    })
  })

  describe('hasWritePermission', () => {
    it('should detect user write permission', () => {
      expect(hasWritePermission(0o200, 'user')).toBe(true)
      expect(hasWritePermission(0o000, 'user')).toBe(false)
    })

    it('should detect group write permission', () => {
      expect(hasWritePermission(0o020, 'group')).toBe(true)
      expect(hasWritePermission(0o000, 'group')).toBe(false)
    })

    it('should detect other write permission', () => {
      expect(hasWritePermission(0o002, 'other')).toBe(true)
      expect(hasWritePermission(0o000, 'other')).toBe(false)
    })
  })

  describe('hasExecutePermission', () => {
    it('should detect user execute permission', () => {
      expect(hasExecutePermission(0o100, 'user')).toBe(true)
      expect(hasExecutePermission(0o000, 'user')).toBe(false)
    })

    it('should detect group execute permission', () => {
      expect(hasExecutePermission(0o010, 'group')).toBe(true)
      expect(hasExecutePermission(0o000, 'group')).toBe(false)
    })

    it('should detect other execute permission', () => {
      expect(hasExecutePermission(0o001, 'other')).toBe(true)
      expect(hasExecutePermission(0o000, 'other')).toBe(false)
    })
  })

  describe('combined permission checks', () => {
    it('should handle typical file permissions (644)', () => {
      const mode = 0o644

      expect(hasReadPermission(mode, 'user')).toBe(true)
      expect(hasWritePermission(mode, 'user')).toBe(true)
      expect(hasExecutePermission(mode, 'user')).toBe(false)

      expect(hasReadPermission(mode, 'group')).toBe(true)
      expect(hasWritePermission(mode, 'group')).toBe(false)
      expect(hasExecutePermission(mode, 'group')).toBe(false)

      expect(hasReadPermission(mode, 'other')).toBe(true)
      expect(hasWritePermission(mode, 'other')).toBe(false)
      expect(hasExecutePermission(mode, 'other')).toBe(false)
    })

    it('should handle typical directory permissions (755)', () => {
      const mode = 0o755

      expect(hasReadPermission(mode, 'user')).toBe(true)
      expect(hasWritePermission(mode, 'user')).toBe(true)
      expect(hasExecutePermission(mode, 'user')).toBe(true)

      expect(hasReadPermission(mode, 'group')).toBe(true)
      expect(hasWritePermission(mode, 'group')).toBe(false)
      expect(hasExecutePermission(mode, 'group')).toBe(true)

      expect(hasReadPermission(mode, 'other')).toBe(true)
      expect(hasWritePermission(mode, 'other')).toBe(false)
      expect(hasExecutePermission(mode, 'other')).toBe(true)
    })

    it('should handle private file permissions (600)', () => {
      const mode = 0o600

      expect(hasReadPermission(mode, 'user')).toBe(true)
      expect(hasWritePermission(mode, 'user')).toBe(true)
      expect(hasExecutePermission(mode, 'user')).toBe(false)

      expect(hasReadPermission(mode, 'group')).toBe(false)
      expect(hasWritePermission(mode, 'group')).toBe(false)
      expect(hasExecutePermission(mode, 'group')).toBe(false)

      expect(hasReadPermission(mode, 'other')).toBe(false)
      expect(hasWritePermission(mode, 'other')).toBe(false)
      expect(hasExecutePermission(mode, 'other')).toBe(false)
    })
  })
})
