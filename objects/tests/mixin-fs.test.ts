/**
 * RED TDD: withFs Mixin and FsModule Tests
 *
 * These tests verify the withFs mixin and FsModule wrapper that integrates
 * the fsx package's FSx class with dotdo's capability system.
 *
 * Key requirements:
 * 1. withFs mixin adds $.fs to DO class
 * 2. FsModule wraps FSx with lazy initialization
 * 3. Supports FileSystemDO stub or direct R2 binding
 * 4. Type exports for FsCapability
 *
 * The FsModule acts as an adapter between fsx's FSx class and dotdo's
 * FsCapability interface, providing:
 * - Lazy initialization (only creates FSx when first accessed)
 * - Consistent interface regardless of backing storage
 * - Error handling consistent with dotdo patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the mixin and types we're testing
import {
  withFs,
  type FsCapability,
  type WithFsContext,
  type FsEntry,
  type FsStat,
} from '../mixins/fs'

// Import FsModule - the wrapper that integrates fsx
import { FsModule, type FsModuleOptions } from '../mixins/fs'

import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// MOCK FSX CLASS
// ============================================================================

/**
 * Mock FSx class to simulate fsx behavior in tests
 * This mimics the interface of FSx from fsx package
 */
class MockFSx {
  private files: Map<string, { content: string; mode: number; mtime: Date; ctime: Date }> = new Map()
  private directories: Set<string> = new Set(['/'])

  async readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
    const file = this.files.get(path)
    if (!file) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    }
    return file.content
  }

  async writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void> {
    const parentDir = path.substring(0, path.lastIndexOf('/')) || '/'
    if (!this.directories.has(parentDir)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    }
    this.files.set(path, {
      content: typeof data === 'string' ? data : new TextDecoder().decode(data),
      mode: options?.mode ?? 0o644,
      mtime: new Date(),
      ctime: new Date(),
    })
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path)
  }

  async unlink(path: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`)
    }
    this.files.delete(path)
  }

  async readdir(path: string): Promise<string[]> {
    if (!this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`)
    }
    const entries: string[] = []
    const prefix = path === '/' ? '/' : path + '/'

    // Find direct children
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.substring(prefix.length)
        if (!relativePath.includes('/')) {
          entries.push(relativePath)
        }
      }
    }
    for (const dirPath of this.directories) {
      if (dirPath !== path && dirPath.startsWith(prefix)) {
        const relativePath = dirPath.substring(prefix.length)
        if (!relativePath.includes('/')) {
          entries.push(relativePath)
        }
      }
    }
    return entries
  }

  async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    if (this.directories.has(path)) {
      throw new Error(`EEXIST: file already exists, mkdir '${path}'`)
    }
    const parentDir = path.substring(0, path.lastIndexOf('/')) || '/'
    if (!this.directories.has(parentDir) && !options?.recursive) {
      throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`)
    }
    if (options?.recursive) {
      // Create all parent directories
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.directories.add(current)
      }
    } else {
      this.directories.add(path)
    }
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory, rmdir '${path}'`)
    }
    this.directories.delete(path)
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    if (this.files.has(path)) {
      this.files.delete(path)
    } else if (this.directories.has(path)) {
      this.directories.delete(path)
    } else if (!options?.force) {
      throw new Error(`ENOENT: no such file or directory, rm '${path}'`)
    }
  }

  async stat(path: string): Promise<{
    size: number
    mode: number
    mtime: Date
    ctime: Date
    birthtime: Date
    isFile(): boolean
    isDirectory(): boolean
  }> {
    const file = this.files.get(path)
    if (file) {
      return {
        size: file.content.length,
        mode: file.mode,
        mtime: file.mtime,
        ctime: file.ctime,
        birthtime: file.ctime,
        isFile: () => true,
        isDirectory: () => false,
      }
    }
    if (this.directories.has(path)) {
      return {
        size: 0,
        mode: 0o755,
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
        isFile: () => false,
        isDirectory: () => true,
      }
    }
    throw new Error(`ENOENT: no such file or directory, stat '${path}'`)
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const file = this.files.get(src)
    if (!file) {
      throw new Error(`ENOENT: no such file or directory, copyfile '${src}'`)
    }
    this.files.set(dest, { ...file, mtime: new Date(), ctime: new Date() })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const file = this.files.get(oldPath)
    if (!file) {
      throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`)
    }
    this.files.set(newPath, file)
    this.files.delete(oldPath)
  }

  // Helper method for tests to seed data
  _seed(path: string, content: string): void {
    this.files.set(path, {
      content,
      mode: 0o644,
      mtime: new Date(),
      ctime: new Date(),
    })
  }

  _mkdirSync(path: string): void {
    this.directories.add(path)
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a minimal mock WorkflowContext for testing
 */
function createMockWorkflowContext(): WorkflowContext {
  return {
    send: vi.fn(),
    try: vi.fn(),
    do: vi.fn(),
    on: {} as any,
    every: {} as any,
    branch: vi.fn(),
    checkout: vi.fn(),
    merge: vi.fn(),
    log: vi.fn(),
    state: {},
  } as unknown as WorkflowContext
}

/**
 * Create a mock DO base class for mixin testing
 */
class MockDO {
  $: WorkflowContext

  constructor() {
    this.$ = createMockWorkflowContext()
  }
}

// ============================================================================
// FsModule WRAPPER TESTS
// ============================================================================

describe('FsModule', () => {
  describe('Initialization', () => {
    it('should be exported from mixins/fs', () => {
      // RED: FsModule is not yet exported
      expect(FsModule).toBeDefined()
      expect(typeof FsModule).toBe('function')
    })

    it('should accept FSx instance directly', () => {
      const mockFsx = new MockFSx()
      const fsModule = new FsModule({ fsx: mockFsx as any })

      expect(fsModule).toBeDefined()
      expect(fsModule).toBeInstanceOf(FsModule)
    })

    it('should accept DurableObjectStub for FileSystemDO', () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
      }
      const fsModule = new FsModule({ stub: mockStub as any })

      expect(fsModule).toBeDefined()
    })

    it('should accept DurableObjectNamespace and create stub on demand', () => {
      const mockNamespace = {
        idFromName: vi.fn().mockReturnValue('mock-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
        }),
      }
      const fsModule = new FsModule({ namespace: mockNamespace as any })

      expect(fsModule).toBeDefined()
    })

    it('should support lazy initialization via factory function', () => {
      let factoryCalled = false
      const fsModule = new FsModule({
        factory: () => {
          factoryCalled = true
          return new MockFSx() as any
        },
      })

      // Factory should not be called until first use
      expect(factoryCalled).toBe(false)
    })
  })

  describe('FsCapability Interface', () => {
    let fsModule: FsModule
    let mockFsx: MockFSx

    beforeEach(() => {
      mockFsx = new MockFSx()
      mockFsx._mkdirSync('/test')
      fsModule = new FsModule({ fsx: mockFsx as any })
    })

    describe('read()', () => {
      it('should read file contents as string', async () => {
        mockFsx._seed('/test/file.txt', 'Hello, World!')

        const content = await fsModule.read('/test/file.txt')

        expect(content).toBe('Hello, World!')
      })

      it('should throw on non-existent file', async () => {
        await expect(fsModule.read('/non-existent.txt')).rejects.toThrow()
      })

      it('should support encoding option', async () => {
        mockFsx._seed('/test/file.txt', 'UTF-8 content')

        const content = await fsModule.read('/test/file.txt', { encoding: 'utf8' })

        expect(content).toBe('UTF-8 content')
      })
    })

    describe('write()', () => {
      it('should write string content to file', async () => {
        await fsModule.write('/test/new.txt', 'New content')

        const content = await mockFsx.readFile('/test/new.txt')
        expect(content).toBe('New content')
      })

      it('should overwrite existing file', async () => {
        mockFsx._seed('/test/existing.txt', 'Old content')

        await fsModule.write('/test/existing.txt', 'New content')

        const content = await mockFsx.readFile('/test/existing.txt')
        expect(content).toBe('New content')
      })

      it('should throw when parent directory does not exist', async () => {
        await expect(fsModule.write('/non-existent/file.txt', 'content')).rejects.toThrow()
      })
    })

    describe('exists()', () => {
      it('should return true for existing file', async () => {
        mockFsx._seed('/test/exists.txt', 'content')

        const result = await fsModule.exists('/test/exists.txt')

        expect(result).toBe(true)
      })

      it('should return true for existing directory', async () => {
        mockFsx._mkdirSync('/test/subdir')

        const result = await fsModule.exists('/test/subdir')

        expect(result).toBe(true)
      })

      it('should return false for non-existent path', async () => {
        const result = await fsModule.exists('/non-existent')

        expect(result).toBe(false)
      })
    })

    describe('delete()', () => {
      it('should delete existing file', async () => {
        mockFsx._seed('/test/to-delete.txt', 'content')

        await fsModule.delete('/test/to-delete.txt')

        expect(await fsModule.exists('/test/to-delete.txt')).toBe(false)
      })

      it('should throw on non-existent file', async () => {
        await expect(fsModule.delete('/non-existent.txt')).rejects.toThrow()
      })
    })

    describe('list()', () => {
      it('should list directory contents', async () => {
        mockFsx._seed('/test/file1.txt', 'content1')
        mockFsx._seed('/test/file2.txt', 'content2')

        const entries = await fsModule.list('/test')

        expect(entries).toHaveLength(2)
        expect(entries.map((e) => e.name).sort()).toEqual(['file1.txt', 'file2.txt'])
      })

      it('should include isDirectory property', async () => {
        mockFsx._seed('/test/file.txt', 'content')
        mockFsx._mkdirSync('/test/subdir')

        const entries = await fsModule.list('/test')

        const file = entries.find((e) => e.name === 'file.txt')
        const dir = entries.find((e) => e.name === 'subdir')

        expect(file?.isDirectory).toBe(false)
        expect(dir?.isDirectory).toBe(true)
      })

      it('should throw on non-existent directory', async () => {
        await expect(fsModule.list('/non-existent')).rejects.toThrow()
      })
    })

    describe('mkdir()', () => {
      it('should create directory', async () => {
        await fsModule.mkdir('/test/newdir')

        expect(await fsModule.exists('/test/newdir')).toBe(true)
      })

      it('should create nested directories with recursive option', async () => {
        await fsModule.mkdir('/test/a/b/c', { recursive: true })

        expect(await fsModule.exists('/test/a/b/c')).toBe(true)
      })

      it('should throw when parent does not exist without recursive', async () => {
        await expect(fsModule.mkdir('/test/deep/nested')).rejects.toThrow()
      })
    })

    describe('stat()', () => {
      it('should return file stats', async () => {
        mockFsx._seed('/test/file.txt', 'Hello, World!')

        const stats = await fsModule.stat('/test/file.txt')

        expect(stats.size).toBe(13) // 'Hello, World!' is 13 bytes
        expect(stats.isFile).toBe(true)
        expect(stats.isDirectory).toBe(false)
        expect(stats.createdAt).toBeInstanceOf(Date)
        expect(stats.modifiedAt).toBeInstanceOf(Date)
      })

      it('should return directory stats', async () => {
        mockFsx._mkdirSync('/test/subdir')

        const stats = await fsModule.stat('/test/subdir')

        expect(stats.isFile).toBe(false)
        expect(stats.isDirectory).toBe(true)
      })

      it('should throw on non-existent path', async () => {
        await expect(fsModule.stat('/non-existent')).rejects.toThrow()
      })
    })

    describe('copy()', () => {
      it('should copy file to new location', async () => {
        mockFsx._seed('/test/original.txt', 'Original content')

        await fsModule.copy('/test/original.txt', '/test/copy.txt')

        const original = await mockFsx.readFile('/test/original.txt')
        const copy = await mockFsx.readFile('/test/copy.txt')

        expect(original).toBe('Original content')
        expect(copy).toBe('Original content')
      })

      it('should throw when source does not exist', async () => {
        await expect(fsModule.copy('/non-existent.txt', '/test/copy.txt')).rejects.toThrow()
      })
    })

    describe('move()', () => {
      it('should move file to new location', async () => {
        mockFsx._seed('/test/original.txt', 'Content to move')

        await fsModule.move('/test/original.txt', '/test/moved.txt')

        expect(await fsModule.exists('/test/original.txt')).toBe(false)
        const content = await mockFsx.readFile('/test/moved.txt')
        expect(content).toBe('Content to move')
      })

      it('should throw when source does not exist', async () => {
        await expect(fsModule.move('/non-existent.txt', '/test/moved.txt')).rejects.toThrow()
      })
    })
  })

  describe('Lazy Initialization', () => {
    it('should not create FSx until first operation', async () => {
      let fsxCreated = false
      const mockFsx = new MockFSx()

      const fsModule = new FsModule({
        factory: () => {
          fsxCreated = true
          return mockFsx as any
        },
      })

      // Not created yet
      expect(fsxCreated).toBe(false)

      // Trigger initialization
      mockFsx._mkdirSync('/test')
      mockFsx._seed('/test/file.txt', 'content')
      await fsModule.read('/test/file.txt')

      // Now it should be created
      expect(fsxCreated).toBe(true)
    })

    it('should cache FSx instance after first creation', async () => {
      let createCount = 0
      const mockFsx = new MockFSx()
      mockFsx._mkdirSync('/test')
      mockFsx._seed('/test/file.txt', 'content')

      const fsModule = new FsModule({
        factory: () => {
          createCount++
          return mockFsx as any
        },
      })

      // Multiple operations
      await fsModule.read('/test/file.txt')
      await fsModule.exists('/test/file.txt')
      await fsModule.list('/test')

      // Should only create once
      expect(createCount).toBe(1)
    })
  })

  describe('Error Handling', () => {
    let fsModule: FsModule
    let mockFsx: MockFSx

    beforeEach(() => {
      mockFsx = new MockFSx()
      fsModule = new FsModule({ fsx: mockFsx as any })
    })

    it('should preserve ENOENT errors', async () => {
      try {
        await fsModule.read('/non-existent.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('ENOENT')
      }
    })

    it('should preserve EEXIST errors', async () => {
      mockFsx._mkdirSync('/test')
      mockFsx._mkdirSync('/test/existing')

      try {
        await fsModule.mkdir('/test/existing')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('EEXIST')
      }
    })
  })
})

// ============================================================================
// withFs MIXIN INTEGRATION TESTS
// ============================================================================

describe('withFs Mixin with FsModule', () => {
  describe('Mixin Application', () => {
    it('should add $.fs to class instances', () => {
      const ExtendedClass = withFs(MockDO as any)
      const instance = new ExtendedClass()

      expect(instance.$).toBeDefined()
      expect(instance.$.fs).toBeDefined()
    })

    it('$.fs should implement FsCapability interface', () => {
      const ExtendedClass = withFs(MockDO as any)
      const instance = new ExtendedClass()

      const fs = instance.$.fs

      // Check all required methods exist
      expect(typeof fs.read).toBe('function')
      expect(typeof fs.write).toBe('function')
      expect(typeof fs.exists).toBe('function')
      expect(typeof fs.delete).toBe('function')
      expect(typeof fs.list).toBe('function')
      expect(typeof fs.mkdir).toBe('function')
      expect(typeof fs.stat).toBe('function')
      expect(typeof fs.copy).toBe('function')
      expect(typeof fs.move).toBe('function')
    })
  })

  describe('Capability Tracking', () => {
    it('should register fs in static capabilities array', () => {
      const ExtendedClass = withFs(MockDO as any)

      expect((ExtendedClass as any).capabilities).toContain('fs')
    })

    it('should have hasCapability method that returns true for fs', () => {
      const ExtendedClass = withFs(MockDO as any)
      const instance = new ExtendedClass()

      expect(instance.hasCapability('fs')).toBe(true)
      expect(instance.hasCapability('git')).toBe(false)
    })
  })

  describe('Mixin Composition', () => {
    it('should preserve base class functionality', () => {
      const ExtendedClass = withFs(MockDO as any)
      const instance = new ExtendedClass()

      // Should still have base WorkflowContext methods
      expect(typeof instance.$.send).toBe('function')
      expect(typeof instance.$.try).toBe('function')
      expect(typeof instance.$.do).toBe('function')
    })

    it('should allow applying withFs twice without error (idempotent)', () => {
      const DoubleFs = withFs(withFs(MockDO as any))
      const instance = new DoubleFs()

      expect(instance.$.fs).toBeDefined()
    })
  })
})

// ============================================================================
// TYPE EXPORT TESTS
// ============================================================================

describe('Type Exports', () => {
  it('should export FsCapability type', () => {
    // Type check - if this compiles, the type is exported correctly
    const _: FsCapability = {} as FsCapability
    expect(_).toBeDefined()
  })

  it('should export WithFsContext type', () => {
    // Type check
    const _: WithFsContext = {} as WithFsContext
    expect(_).toBeDefined()
  })

  it('should export FsEntry type', () => {
    // Type check
    const _: FsEntry = { name: 'test', isDirectory: false }
    expect(_).toBeDefined()
  })

  it('should export FsStat type', () => {
    // Type check
    const _: FsStat = {
      size: 100,
      isDirectory: false,
      isFile: true,
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    expect(_).toBeDefined()
  })

  it('should export FsModule class', () => {
    expect(FsModule).toBeDefined()
  })

  it('should export FsModuleOptions type', () => {
    // Type check
    const opts: FsModuleOptions = { fsx: {} as any }
    expect(opts).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION WITH DURABLE OBJECTS
// ============================================================================

describe('DurableObject Integration', () => {
  it('should accept FileSystemDO stub via options', () => {
    // Test that FsModule can be configured with a DO stub
    const mockStub = {
      fetch: vi.fn(),
    }

    const fsModule = new FsModule({ stub: mockStub as any })
    expect(fsModule).toBeDefined()
  })

  it('should accept DurableObjectNamespace via options', () => {
    // Test that FsModule can be configured with a DO namespace
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue('mock-id'),
      get: vi.fn().mockReturnValue({ fetch: vi.fn() }),
    }

    const fsModule = new FsModule({ namespace: mockNamespace as any })
    expect(fsModule).toBeDefined()
  })

  it('should support R2 bucket configuration for warm tier', () => {
    // Test that FsModule accepts R2 bucket for tiered storage
    const mockR2 = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    }

    const fsModule = new FsModule({
      fsx: new MockFSx() as any,
      r2: mockR2 as any,
    })

    expect(fsModule).toBeDefined()
  })
})
