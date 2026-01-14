/**
 * RED Phase Tests for Node.js Polyfill Layer
 *
 * The polyfill layer provides Node.js built-in module compatibility
 * for Tier 2 packages running in V8 isolates:
 * - fs polyfill using fsx.do
 * - path polyfill (pure JavaScript)
 * - crypto polyfill using Web Crypto API
 * - buffer polyfill
 * - process polyfill
 * - events polyfill
 * - stream polyfill
 *
 * @module npmx/test/core/npx/polyfills
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createProcessPolyfill,
  type ProcessPolyfill as ImportedProcessPolyfill,
} from '../../../core/npx/process.js'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * File system polyfill interface (subset of Node.js fs)
 */
export interface FsPolyfill {
  readFile(path: string, encoding?: string): Promise<string | Buffer>
  writeFile(path: string, data: string | Buffer): Promise<void>
  readdir(path: string): Promise<string[]>
  stat(path: string): Promise<FsStats>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  exists(path: string): Promise<boolean>
  copyFile(src: string, dest: string): Promise<void>
  rename(src: string, dest: string): Promise<void>
  // Sync variants throw - not supported in Workers
  readFileSync: never
  writeFileSync: never
}

/**
 * File stats
 */
export interface FsStats {
  size: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  mtime: Date
  ctime: Date
  atime: Date
}

/**
 * Path polyfill interface (Node.js path module)
 */
export interface PathPolyfill {
  join(...paths: string[]): string
  resolve(...paths: string[]): string
  dirname(path: string): string
  basename(path: string, ext?: string): string
  extname(path: string): string
  normalize(path: string): string
  isAbsolute(path: string): boolean
  relative(from: string, to: string): string
  parse(path: string): { root: string; dir: string; base: string; ext: string; name: string }
  format(pathObject: { root?: string; dir?: string; base?: string; ext?: string; name?: string }): string
  sep: string
  delimiter: string
  posix: PathPolyfill
  win32: PathPolyfill
}

/**
 * Process polyfill interface (subset of Node.js process)
 */
export interface ProcessPolyfill {
  env: Record<string, string | undefined>
  argv: string[]
  cwd(): string
  chdir(dir: string): void
  exit(code?: number): void
  stdout: {
    write(data: string): boolean
    isTTY: boolean
  }
  stderr: {
    write(data: string): boolean
    isTTY: boolean
  }
  stdin: {
    isTTY: boolean
    read(): string | null
  }
  platform: string
  version: string
  versions: Record<string, string>
  nextTick(callback: () => void): void
}

/**
 * Buffer polyfill interface
 */
export interface BufferPolyfill {
  from(data: string | ArrayBuffer | number[], encoding?: string): BufferPolyfill
  alloc(size: number, fill?: number): BufferPolyfill
  allocUnsafe(size: number): BufferPolyfill
  concat(buffers: BufferPolyfill[]): BufferPolyfill
  isBuffer(obj: unknown): boolean
  byteLength(string: string, encoding?: string): number
  // Instance methods
  toString(encoding?: string): string
  slice(start?: number, end?: number): BufferPolyfill
  copy(target: BufferPolyfill, targetStart?: number): number
  length: number
}

// ============================================================================
// MOCK IMPLEMENTATION (to be replaced)
// ============================================================================

/**
 * Create fs polyfill backed by fsx.do
 */
function createFsPolyfill(_fsxClient?: unknown): FsPolyfill {
  throw new Error('Not implemented: createFsPolyfill')
}

/**
 * Create path polyfill
 */
function createPathPolyfill(): PathPolyfill {
  throw new Error('Not implemented: createPathPolyfill')
}

// Process polyfill is now imported from ../../../core/npx/process.js
// The createProcessPolyfill function is used directly from the import

/**
 * Create buffer polyfill
 */
function createBufferPolyfill(): typeof BufferPolyfill {
  throw new Error('Not implemented: createBufferPolyfill')
}

/**
 * Create crypto polyfill using Web Crypto
 */
function createCryptoPolyfill(): unknown {
  throw new Error('Not implemented: createCryptoPolyfill')
}

/**
 * Create events polyfill
 */
function createEventsPolyfill(): unknown {
  throw new Error('Not implemented: createEventsPolyfill')
}

/**
 * Create stream polyfill
 */
function createStreamPolyfill(): unknown {
  throw new Error('Not implemented: createStreamPolyfill')
}

// ============================================================================
// FS POLYFILL
// ============================================================================

describe('Polyfills - fs', () => {
  let fs: FsPolyfill

  beforeEach(() => {
    fs = createFsPolyfill()
  })

  describe('readFile', () => {
    it('reads file contents', async () => {
      const content = await fs.readFile('/test/file.txt', 'utf-8')

      expect(typeof content).toBe('string')
    })

    it('reads file as buffer when no encoding', async () => {
      const content = await fs.readFile('/test/file.txt')

      expect(content).toBeInstanceOf(Buffer)
    })

    it('throws for non-existent file', async () => {
      await expect(
        fs.readFile('/nonexistent/file.txt')
      ).rejects.toThrow(/ENOENT/)
    })
  })

  describe('writeFile', () => {
    it('writes string content', async () => {
      await fs.writeFile('/test/output.txt', 'hello world')

      const content = await fs.readFile('/test/output.txt', 'utf-8')
      expect(content).toBe('hello world')
    })

    it('writes buffer content', async () => {
      const buffer = Buffer.from('hello world')
      await fs.writeFile('/test/output.txt', buffer)

      const content = await fs.readFile('/test/output.txt', 'utf-8')
      expect(content).toBe('hello world')
    })

    it('creates parent directories', async () => {
      await fs.writeFile('/test/deep/nested/file.txt', 'content')

      const exists = await fs.exists('/test/deep/nested/file.txt')
      expect(exists).toBe(true)
    })
  })

  describe('readdir', () => {
    it('lists directory contents', async () => {
      const entries = await fs.readdir('/test')

      expect(Array.isArray(entries)).toBe(true)
    })

    it('throws for non-existent directory', async () => {
      await expect(
        fs.readdir('/nonexistent')
      ).rejects.toThrow(/ENOENT/)
    })
  })

  describe('stat', () => {
    it('returns file stats', async () => {
      const stats = await fs.stat('/test/file.txt')

      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
      expect(stats.size).toBeGreaterThanOrEqual(0)
    })

    it('returns directory stats', async () => {
      const stats = await fs.stat('/test')

      expect(stats.isDirectory()).toBe(true)
      expect(stats.isFile()).toBe(false)
    })

    it('includes timestamps', async () => {
      const stats = await fs.stat('/test/file.txt')

      expect(stats.mtime).toBeInstanceOf(Date)
      expect(stats.ctime).toBeInstanceOf(Date)
      expect(stats.atime).toBeInstanceOf(Date)
    })
  })

  describe('mkdir', () => {
    it('creates directory', async () => {
      await fs.mkdir('/test/newdir')

      const stats = await fs.stat('/test/newdir')
      expect(stats.isDirectory()).toBe(true)
    })

    it('creates recursive directories', async () => {
      await fs.mkdir('/test/deep/nested/dir', { recursive: true })

      const exists = await fs.exists('/test/deep/nested/dir')
      expect(exists).toBe(true)
    })

    it('throws if directory exists without recursive', async () => {
      await fs.mkdir('/test/existing')

      await expect(
        fs.mkdir('/test/existing')
      ).rejects.toThrow(/EEXIST/)
    })
  })

  describe('rm', () => {
    it('removes file', async () => {
      await fs.writeFile('/test/todelete.txt', 'content')
      await fs.rm('/test/todelete.txt')

      const exists = await fs.exists('/test/todelete.txt')
      expect(exists).toBe(false)
    })

    it('removes directory recursively', async () => {
      await fs.mkdir('/test/todelete/nested', { recursive: true })
      await fs.rm('/test/todelete', { recursive: true })

      const exists = await fs.exists('/test/todelete')
      expect(exists).toBe(false)
    })

    it('ignores non-existent with force', async () => {
      await expect(
        fs.rm('/nonexistent', { force: true })
      ).resolves.not.toThrow()
    })
  })

  describe('exists', () => {
    it('returns true for existing file', async () => {
      await fs.writeFile('/test/exists.txt', 'content')

      const exists = await fs.exists('/test/exists.txt')
      expect(exists).toBe(true)
    })

    it('returns false for non-existent file', async () => {
      const exists = await fs.exists('/nonexistent/file.txt')
      expect(exists).toBe(false)
    })
  })

  describe('copyFile', () => {
    it('copies file to destination', async () => {
      await fs.writeFile('/test/source.txt', 'content')
      await fs.copyFile('/test/source.txt', '/test/dest.txt')

      const content = await fs.readFile('/test/dest.txt', 'utf-8')
      expect(content).toBe('content')
    })
  })

  describe('rename', () => {
    it('renames file', async () => {
      await fs.writeFile('/test/old.txt', 'content')
      await fs.rename('/test/old.txt', '/test/new.txt')

      const exists = await fs.exists('/test/old.txt')
      expect(exists).toBe(false)

      const content = await fs.readFile('/test/new.txt', 'utf-8')
      expect(content).toBe('content')
    })
  })

  describe('sync methods', () => {
    it('throws for readFileSync', () => {
      expect(() => (fs as any).readFileSync('/test/file.txt')).toThrow()
    })

    it('throws for writeFileSync', () => {
      expect(() => (fs as any).writeFileSync('/test/file.txt', 'data')).toThrow()
    })
  })
})

// ============================================================================
// PATH POLYFILL
// ============================================================================

describe('Polyfills - path', () => {
  let path: PathPolyfill

  beforeEach(() => {
    path = createPathPolyfill()
  })

  describe('join', () => {
    it('joins path segments', () => {
      expect(path.join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz')
    })

    it('handles trailing slashes', () => {
      expect(path.join('/foo/', 'bar/')).toBe('/foo/bar/')
    })

    it('handles . and ..', () => {
      expect(path.join('/foo', './bar', '../baz')).toBe('/foo/baz')
    })
  })

  describe('resolve', () => {
    it('resolves absolute path', () => {
      expect(path.resolve('/foo', 'bar')).toBe('/foo/bar')
    })

    it('returns absolute path', () => {
      const result = path.resolve('/foo', 'bar')
      expect(path.isAbsolute(result)).toBe(true)
    })
  })

  describe('dirname', () => {
    it('returns directory name', () => {
      expect(path.dirname('/foo/bar/baz.js')).toBe('/foo/bar')
    })

    it('handles root path', () => {
      expect(path.dirname('/')).toBe('/')
    })
  })

  describe('basename', () => {
    it('returns base name', () => {
      expect(path.basename('/foo/bar/baz.js')).toBe('baz.js')
    })

    it('removes extension when specified', () => {
      expect(path.basename('/foo/bar/baz.js', '.js')).toBe('baz')
    })
  })

  describe('extname', () => {
    it('returns extension', () => {
      expect(path.extname('file.txt')).toBe('.txt')
    })

    it('returns empty for no extension', () => {
      expect(path.extname('file')).toBe('')
    })

    it('handles multiple dots', () => {
      expect(path.extname('file.tar.gz')).toBe('.gz')
    })
  })

  describe('normalize', () => {
    it('normalizes path', () => {
      expect(path.normalize('/foo//bar/../baz')).toBe('/foo/baz')
    })

    it('removes trailing slash', () => {
      expect(path.normalize('/foo/bar/')).toBe('/foo/bar')
    })
  })

  describe('isAbsolute', () => {
    it('returns true for absolute path', () => {
      expect(path.isAbsolute('/foo/bar')).toBe(true)
    })

    it('returns false for relative path', () => {
      expect(path.isAbsolute('foo/bar')).toBe(false)
    })
  })

  describe('relative', () => {
    it('computes relative path', () => {
      expect(path.relative('/foo/bar', '/foo/baz')).toBe('../baz')
    })

    it('returns empty for same path', () => {
      expect(path.relative('/foo/bar', '/foo/bar')).toBe('')
    })
  })

  describe('parse', () => {
    it('parses path components', () => {
      const parsed = path.parse('/home/user/file.txt')

      expect(parsed.root).toBe('/')
      expect(parsed.dir).toBe('/home/user')
      expect(parsed.base).toBe('file.txt')
      expect(parsed.ext).toBe('.txt')
      expect(parsed.name).toBe('file')
    })
  })

  describe('format', () => {
    it('formats path object', () => {
      const formatted = path.format({
        dir: '/home/user',
        base: 'file.txt',
      })

      expect(formatted).toBe('/home/user/file.txt')
    })
  })

  describe('constants', () => {
    it('provides sep', () => {
      expect(path.sep).toBe('/')
    })

    it('provides delimiter', () => {
      expect(path.delimiter).toBe(':')
    })
  })
})

// ============================================================================
// PROCESS POLYFILL
// ============================================================================

describe('Polyfills - process', () => {
  let process: ProcessPolyfill

  beforeEach(() => {
    process = createProcessPolyfill({
      env: { NODE_ENV: 'test', MY_VAR: 'value' },
      cwd: '/workspace',
      argv: ['node', 'script.js', '--flag', 'arg'],
    })
  })

  describe('env', () => {
    it('provides environment variables', () => {
      expect(process.env.NODE_ENV).toBe('test')
      expect(process.env.MY_VAR).toBe('value')
    })

    it('returns undefined for missing vars', () => {
      expect(process.env.NONEXISTENT).toBeUndefined()
    })
  })

  describe('argv', () => {
    it('provides command line arguments', () => {
      expect(process.argv).toEqual(['node', 'script.js', '--flag', 'arg'])
    })
  })

  describe('cwd', () => {
    it('returns current working directory', () => {
      expect(process.cwd()).toBe('/workspace')
    })
  })

  describe('chdir', () => {
    it('changes working directory', () => {
      process.chdir('/new/path')
      expect(process.cwd()).toBe('/new/path')
    })
  })

  describe('exit', () => {
    it('throws to signal exit', () => {
      expect(() => process.exit(1)).toThrow()
    })
  })

  describe('stdout', () => {
    it('provides write method', () => {
      expect(typeof process.stdout.write).toBe('function')
    })

    it('captures written output', () => {
      process.stdout.write('hello')
      // Output should be captured
    })

    it('provides isTTY', () => {
      expect(typeof process.stdout.isTTY).toBe('boolean')
    })
  })

  describe('stderr', () => {
    it('provides write method', () => {
      expect(typeof process.stderr.write).toBe('function')
    })
  })

  describe('platform', () => {
    it('returns platform string', () => {
      expect(process.platform).toBe('linux') // or appropriate for Workers
    })
  })

  describe('version', () => {
    it('returns version string', () => {
      expect(process.version).toMatch(/^v\d+\.\d+\.\d+/)
    })
  })

  describe('nextTick', () => {
    it('schedules callback', async () => {
      let called = false
      process.nextTick(() => { called = true })

      await new Promise(resolve => setTimeout(resolve, 0))
      expect(called).toBe(true)
    })
  })
})

// ============================================================================
// BUFFER POLYFILL
// ============================================================================

describe('Polyfills - Buffer', () => {
  let BufferClass: typeof BufferPolyfill

  beforeEach(() => {
    BufferClass = createBufferPolyfill()
  })

  describe('from', () => {
    it('creates buffer from string', () => {
      const buf = BufferClass.from('hello', 'utf-8')

      expect(buf.length).toBe(5)
      expect(buf.toString()).toBe('hello')
    })

    it('creates buffer from array', () => {
      const buf = BufferClass.from([72, 101, 108, 108, 111])

      expect(buf.toString()).toBe('Hello')
    })

    it('creates buffer from ArrayBuffer', () => {
      const ab = new ArrayBuffer(5)
      const view = new Uint8Array(ab)
      view.set([72, 101, 108, 108, 111])

      const buf = BufferClass.from(ab)

      expect(buf.toString()).toBe('Hello')
    })
  })

  describe('alloc', () => {
    it('allocates zero-filled buffer', () => {
      const buf = BufferClass.alloc(10)

      expect(buf.length).toBe(10)
      expect(buf[0]).toBe(0)
    })

    it('allocates filled buffer', () => {
      const buf = BufferClass.alloc(10, 1)

      expect(buf[0]).toBe(1)
      expect(buf[9]).toBe(1)
    })
  })

  describe('allocUnsafe', () => {
    it('allocates buffer', () => {
      const buf = BufferClass.allocUnsafe(10)

      expect(buf.length).toBe(10)
    })
  })

  describe('concat', () => {
    it('concatenates buffers', () => {
      const buf1 = BufferClass.from('Hello')
      const buf2 = BufferClass.from(' World')
      const result = BufferClass.concat([buf1, buf2])

      expect(result.toString()).toBe('Hello World')
    })
  })

  describe('isBuffer', () => {
    it('returns true for buffer', () => {
      const buf = BufferClass.from('test')

      expect(BufferClass.isBuffer(buf)).toBe(true)
    })

    it('returns false for non-buffer', () => {
      expect(BufferClass.isBuffer('string')).toBe(false)
      expect(BufferClass.isBuffer(123)).toBe(false)
    })
  })

  describe('byteLength', () => {
    it('returns byte length of string', () => {
      expect(BufferClass.byteLength('hello')).toBe(5)
    })

    it('handles UTF-8 encoding', () => {
      expect(BufferClass.byteLength('hello')).toBe(5)
    })
  })

  describe('instance methods', () => {
    it('toString converts to string', () => {
      const buf = BufferClass.from('hello')

      expect(buf.toString()).toBe('hello')
    })

    it('slice creates subview', () => {
      const buf = BufferClass.from('hello')
      const slice = buf.slice(1, 4)

      expect(slice.toString()).toBe('ell')
    })

    it('copy copies to target', () => {
      const source = BufferClass.from('hello')
      const target = BufferClass.alloc(5)

      source.copy(target)

      expect(target.toString()).toBe('hello')
    })
  })
})

// ============================================================================
// CRYPTO POLYFILL
// ============================================================================

describe('Polyfills - crypto', () => {
  let crypto: any

  beforeEach(() => {
    crypto = createCryptoPolyfill()
  })

  describe('createHash', () => {
    it('creates SHA-256 hash', async () => {
      const hash = crypto.createHash('sha256')
      hash.update('hello')
      const digest = await hash.digest('hex')

      expect(digest).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('creates SHA-512 hash', async () => {
      const hash = crypto.createHash('sha512')
      hash.update('hello')
      const digest = await hash.digest('hex')

      expect(typeof digest).toBe('string')
      expect(digest.length).toBe(128)
    })

    it('creates MD5 hash', async () => {
      const hash = crypto.createHash('md5')
      hash.update('hello')
      const digest = await hash.digest('hex')

      expect(digest).toBe('5d41402abc4b2a76b9719d911017c592')
    })
  })

  describe('randomBytes', () => {
    it('generates random bytes', () => {
      const bytes = crypto.randomBytes(32)

      expect(bytes.length).toBe(32)
    })

    it('generates different values', () => {
      const bytes1 = crypto.randomBytes(32)
      const bytes2 = crypto.randomBytes(32)

      expect(bytes1).not.toEqual(bytes2)
    })
  })

  describe('randomUUID', () => {
    it('generates valid UUID', () => {
      const uuid = crypto.randomUUID()

      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })
  })

  describe('createHmac', () => {
    it('creates HMAC', async () => {
      const hmac = crypto.createHmac('sha256', 'secret')
      hmac.update('message')
      const digest = await hmac.digest('hex')

      expect(typeof digest).toBe('string')
    })
  })
})

// ============================================================================
// EVENTS POLYFILL
// ============================================================================

describe('Polyfills - events', () => {
  let EventEmitter: any

  beforeEach(() => {
    const events = createEventsPolyfill()
    EventEmitter = events.EventEmitter
  })

  describe('EventEmitter', () => {
    it('emits and listens to events', () => {
      const emitter = new EventEmitter()
      const handler = vi.fn()

      emitter.on('test', handler)
      emitter.emit('test', 'arg1', 'arg2')

      expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
    })

    it('removes listener', () => {
      const emitter = new EventEmitter()
      const handler = vi.fn()

      emitter.on('test', handler)
      emitter.off('test', handler)
      emitter.emit('test')

      expect(handler).not.toHaveBeenCalled()
    })

    it('once listener fires once', () => {
      const emitter = new EventEmitter()
      const handler = vi.fn()

      emitter.once('test', handler)
      emitter.emit('test')
      emitter.emit('test')

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('supports multiple listeners', () => {
      const emitter = new EventEmitter()
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('test', handler1)
      emitter.on('test', handler2)
      emitter.emit('test')

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('removeAllListeners removes all', () => {
      const emitter = new EventEmitter()
      const handler = vi.fn()

      emitter.on('test', handler)
      emitter.removeAllListeners('test')
      emitter.emit('test')

      expect(handler).not.toHaveBeenCalled()
    })

    it('listenerCount returns count', () => {
      const emitter = new EventEmitter()

      emitter.on('test', () => {})
      emitter.on('test', () => {})

      expect(emitter.listenerCount('test')).toBe(2)
    })
  })
})

// ============================================================================
// STREAM POLYFILL
// ============================================================================

describe('Polyfills - stream', () => {
  let stream: any

  beforeEach(() => {
    stream = createStreamPolyfill()
  })

  describe('Readable', () => {
    it('creates readable stream', () => {
      const readable = new stream.Readable({
        read() {
          this.push('hello')
          this.push(null)
        }
      })

      expect(readable).toBeDefined()
    })

    it('emits data events', async () => {
      const readable = new stream.Readable({
        read() {
          this.push('hello')
          this.push(null)
        }
      })

      const chunks: string[] = []
      for await (const chunk of readable) {
        chunks.push(chunk.toString())
      }

      expect(chunks).toContain('hello')
    })
  })

  describe('Writable', () => {
    it('creates writable stream', () => {
      const writable = new stream.Writable({
        write(_chunk: any, _encoding: string, callback: () => void) {
          callback()
        }
      })

      expect(writable).toBeDefined()
    })

    it('receives written data', (done) => {
      const received: string[] = []
      const writable = new stream.Writable({
        write(chunk: any, _encoding: string, callback: () => void) {
          received.push(chunk.toString())
          callback()
        }
      })

      writable.write('hello')
      writable.end(() => {
        expect(received).toContain('hello')
        done()
      })
    })
  })

  describe('Transform', () => {
    it('creates transform stream', () => {
      const transform = new stream.Transform({
        transform(chunk: any, _encoding: string, callback: (err: null, data: string) => void) {
          callback(null, chunk.toString().toUpperCase())
        }
      })

      expect(transform).toBeDefined()
    })

    it('transforms data', async () => {
      const transform = new stream.Transform({
        transform(chunk: any, _encoding: string, callback: (err: null, data: string) => void) {
          callback(null, chunk.toString().toUpperCase())
        }
      })

      transform.write('hello')
      transform.end()

      const chunks: string[] = []
      for await (const chunk of transform) {
        chunks.push(chunk.toString())
      }

      expect(chunks).toContain('HELLO')
    })
  })

  describe('PassThrough', () => {
    it('creates passthrough stream', () => {
      const passthrough = new stream.PassThrough()

      expect(passthrough).toBeDefined()
    })

    it('passes data through unchanged', async () => {
      const passthrough = new stream.PassThrough()

      passthrough.write('hello')
      passthrough.end()

      const chunks: string[] = []
      for await (const chunk of passthrough) {
        chunks.push(chunk.toString())
      }

      expect(chunks).toContain('hello')
    })
  })

  describe('pipeline', () => {
    it('pipes streams together', async () => {
      const source = new stream.Readable({
        read() {
          this.push('hello')
          this.push(null)
        }
      })

      const transform = new stream.Transform({
        transform(chunk: any, _encoding: string, callback: (err: null, data: string) => void) {
          callback(null, chunk.toString().toUpperCase())
        }
      })

      const result: string[] = []
      const dest = new stream.Writable({
        write(chunk: any, _encoding: string, callback: () => void) {
          result.push(chunk.toString())
          callback()
        }
      })

      await stream.pipeline(source, transform, dest)

      expect(result).toContain('HELLO')
    })
  })
})

// ============================================================================
// INTEGRATION
// ============================================================================

describe('Polyfills - Integration', () => {
  it('works together in realistic scenario', async () => {
    const fs = createFsPolyfill()
    const path = createPathPolyfill()
    const Buffer = createBufferPolyfill()

    // Simulate reading a file and processing it
    await fs.writeFile('/test/data.txt', 'hello world')
    const content = await fs.readFile('/test/data.txt', 'utf-8')
    const dir = path.dirname('/test/data.txt')
    const base = path.basename('/test/data.txt')

    expect(content).toBe('hello world')
    expect(dir).toBe('/test')
    expect(base).toBe('data.txt')
  })

  it('process env works with fs operations', async () => {
    const fs = createFsPolyfill()
    const process = createProcessPolyfill({
      env: { HOME: '/home/user' },
    })

    const homePath = process.env.HOME
    await fs.writeFile(`${homePath}/config.json`, '{}')

    const exists = await fs.exists('/home/user/config.json')
    expect(exists).toBe(true)
  })
})
