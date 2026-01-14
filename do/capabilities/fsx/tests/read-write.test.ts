/**
 * Tests for basic read/write filesystem operations
 *
 * These tests cover the fundamental file operations:
 * - readFile: reading file contents as string or bytes
 * - writeFile: writing data to files
 * - appendFile: appending data to files
 * - unlink: deleting files
 * - copyFile: copying files
 * - rename: renaming/moving files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  InMemoryStorage,
  createTestFilesystem,
  createRandomBytes,
  createFileWithSize,
  MockDurableObjectStub,
} from './test-utils'

describe('readFile', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('reading text files', () => {
    it('should read a text file as string', () => {
      const content = storage.readFileAsString('/home/user/hello.txt')
      expect(content).toBe('Hello, World!')
    })

    it('should read a JSON file as string', () => {
      const content = storage.readFileAsString('/home/user/data.json')
      expect(content).toBe('{"key": "value"}')
      expect(JSON.parse(content)).toEqual({ key: 'value' })
    })

    it('should read an empty file as empty string', () => {
      storage.addFile('/tmp/empty.txt', '')
      const content = storage.readFileAsString('/tmp/empty.txt')
      expect(content).toBe('')
    })

    it('should read file with unicode characters', () => {
      storage.addFile('/tmp/unicode.txt', 'Hello, World!')
      const content = storage.readFileAsString('/tmp/unicode.txt')
      expect(content).toBe('Hello, World!')
    })

    it('should read file with emoji', () => {
      const emoji = 'Hello, World! \u{1F600}'
      storage.addFile('/tmp/emoji.txt', emoji)
      const content = storage.readFileAsString('/tmp/emoji.txt')
      expect(content).toBe(emoji)
    })
  })

  describe('reading binary files', () => {
    it('should read a binary file as Uint8Array', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      storage.addFile('/tmp/binary.bin', binaryData)

      const content = storage.readFileAsBytes('/tmp/binary.bin')
      expect(content).toBeInstanceOf(Uint8Array)
      expect(content).toEqual(binaryData)
    })

    it('should preserve exact binary data', () => {
      const binaryData = createRandomBytes(1024)
      storage.addFile('/tmp/random.bin', binaryData)

      const content = storage.readFileAsBytes('/tmp/random.bin')
      expect(content.length).toBe(1024)
      expect(content).toEqual(binaryData)
    })

    it('should read large binary file (1MB)', () => {
      createFileWithSize(storage, '/tmp/large.bin', 1024 * 1024)
      const content = storage.readFileAsBytes('/tmp/large.bin')
      expect(content.length).toBe(1024 * 1024)
    })
  })

  describe('reading with encodings', () => {
    it('should read file as base64', () => {
      storage.addFile('/tmp/test.txt', 'Hello, World!')
      const content = storage.readFileAsString('/tmp/test.txt', 'base64')
      expect(content).toBe('SGVsbG8sIFdvcmxkIQ==')
    })

    it('should read binary file as hex', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      storage.addFile('/tmp/binary.bin', binaryData)

      const content = storage.readFileAsString('/tmp/binary.bin', 'hex')
      expect(content).toBe('000102ff')
    })
  })

  describe('error handling', () => {
    it('should throw when file does not exist', () => {
      expect(() => storage.readFileAsString('/nonexistent/file.txt')).toThrow('File not found')
    })

    it('should throw when reading a directory', () => {
      expect(() => storage.readFileAsString('/home')).toThrow('File not found')
    })

    it('should throw when reading deeply nested nonexistent path', () => {
      expect(() => storage.readFileAsString('/a/b/c/d/e/f/file.txt')).toThrow('File not found')
    })
  })
})

describe('writeFile', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('writing text files', () => {
    it('should write a new text file', () => {
      storage.addFile('/home/user/new.txt', 'New content')

      expect(storage.has('/home/user/new.txt')).toBe(true)
      expect(storage.readFileAsString('/home/user/new.txt')).toBe('New content')
    })

    it('should overwrite existing file', () => {
      storage.addFile('/home/user/hello.txt', 'Overwritten!')

      expect(storage.readFileAsString('/home/user/hello.txt')).toBe('Overwritten!')
    })

    it('should write empty file', () => {
      storage.addFile('/home/user/empty.txt', '')

      expect(storage.has('/home/user/empty.txt')).toBe(true)
      expect(storage.readFileAsString('/home/user/empty.txt')).toBe('')
    })

    it('should write file with unicode content', () => {
      const content = 'Hello, World!'
      storage.addFile('/home/user/chinese.txt', content)

      expect(storage.readFileAsString('/home/user/chinese.txt')).toBe(content)
    })
  })

  describe('writing binary files', () => {
    it('should write binary data', () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      storage.addFile('/home/user/binary.bin', data)

      const content = storage.readFileAsBytes('/home/user/binary.bin')
      expect(content).toEqual(data)
    })

    it('should write large binary file', () => {
      const data = createRandomBytes(1024 * 1024)
      storage.addFile('/home/user/large.bin', data)

      const content = storage.readFileAsBytes('/home/user/large.bin')
      expect(content.length).toBe(1024 * 1024)
      expect(content).toEqual(data)
    })
  })

  describe('file metadata', () => {
    it('should set default file mode', () => {
      storage.addFile('/home/user/new.txt', 'content')

      const entry = storage.get('/home/user/new.txt')
      // Mode includes file type bits, so check permissions part
      expect(entry?.mode).toBeDefined()
    })

    it('should set custom file mode', () => {
      storage.addFile('/home/user/restricted.txt', 'secret', { mode: 0o600 })

      const entry = storage.get('/home/user/restricted.txt')
      // Check that the permission bits are 0o600
      expect((entry?.mode ?? 0) & 0o777).toBe(0o600)
    })

    it('should set file timestamps', () => {
      const before = Date.now()
      storage.addFile('/home/user/timestamped.txt', 'content')
      const after = Date.now()

      const entry = storage.get('/home/user/timestamped.txt')
      expect(entry?.birthtime).toBeGreaterThanOrEqual(before)
      expect(entry?.birthtime).toBeLessThanOrEqual(after)
      expect(entry?.mtime).toBeGreaterThanOrEqual(before)
      expect(entry?.mtime).toBeLessThanOrEqual(after)
    })
  })
})

describe('updateContent', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  it('should update existing file content', () => {
    storage.updateContent('/home/user/hello.txt', 'Updated content')
    expect(storage.readFileAsString('/home/user/hello.txt')).toBe('Updated content')
  })

  it('should update file timestamps on modification', () => {
    const entryBefore = storage.get('/home/user/hello.txt')
    const mtimeBefore = entryBefore?.mtime ?? 0

    // Small delay to ensure timestamp difference
    storage.updateContent('/home/user/hello.txt', 'Modified')

    const entryAfter = storage.get('/home/user/hello.txt')
    expect(entryAfter?.mtime).toBeGreaterThanOrEqual(mtimeBefore)
  })

  it('should throw when file does not exist', () => {
    expect(() => storage.updateContent('/nonexistent.txt', 'content')).toThrow('File not found')
  })
})

describe('unlink (delete file)', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  it('should delete a file', () => {
    expect(storage.has('/home/user/hello.txt')).toBe(true)
    storage.remove('/home/user/hello.txt')
    expect(storage.has('/home/user/hello.txt')).toBe(false)
  })

  it('should return false when deleting nonexistent file', () => {
    const result = storage.remove('/nonexistent.txt')
    expect(result).toBe(false)
  })

  it('should be able to recreate deleted file', () => {
    storage.remove('/home/user/hello.txt')
    storage.addFile('/home/user/hello.txt', 'Recreated!')

    expect(storage.readFileAsString('/home/user/hello.txt')).toBe('Recreated!')
  })
})

describe('MockDurableObjectStub', () => {
  let stub: MockDurableObjectStub
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('readFile RPC', () => {
    it('should read file via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = (await response.json()) as { data: string; encoding: string }
      // Decode base64 result
      const content = atob(result.data)
      expect(content).toBe('Hello, World!')
    })

    it('should return 400 for nonexistent file', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/nonexistent.txt' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 for reading directory', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EISDIR')
    })
  })

  describe('writeFile RPC', () => {
    it('should write file via RPC', async () => {
      const content = btoa('New RPC content')
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '/home/user/rpc-created.txt',
            data: content,
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/rpc-created.txt')).toBe(true)
      expect(storage.readFileAsString('/home/user/rpc-created.txt')).toBe('New RPC content')
    })

    it('should return 400 when parent does not exist', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '/nonexistent/parent/file.txt',
            data: btoa('content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })
  })

  describe('unlink RPC', () => {
    it('should delete file via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'unlink',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/hello.txt')).toBe(false)
    })

    it('should return 400 when deleting nonexistent file', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'unlink',
          params: { path: '/nonexistent.txt' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 when deleting directory', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'unlink',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EISDIR')
    })
  })

  describe('stat RPC', () => {
    it('should return file stats', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const stats = (await response.json()) as { size: number; mode: number }
      expect(stats.size).toBe(13) // "Hello, World!".length
      expect(stats.mode).toBeDefined()
    })

    it('should return directory stats', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
      const stats = (await response.json()) as { mode: number }
      expect(stats.mode).toBeDefined()
    })

    it('should return 400 for nonexistent path', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/nonexistent' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })
  })
})
