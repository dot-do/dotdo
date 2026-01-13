/**
 * Tests for EmbeddedDB
 *
 * Verifies:
 * - Uses `.do/state/local.db` as default path
 * - No global fallback to home directory
 * - Creates `.do/state/` directory if missing
 * - Memory mode still works with persist: false
 * - Custom path still works with persist: string
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// Mock fs and os before importing EmbeddedDB
vi.mock('fs')
vi.mock('os')

const mockFs = vi.mocked(fs)
const mockOs = vi.mocked(os)

describe('EmbeddedDB', () => {
  let EmbeddedDB: typeof import('../runtime/embedded-db').EmbeddedDB
  let createDB: typeof import('../runtime/embedded-db').createDB

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    // Default: directory doesn't exist yet
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockReturnValue(undefined)
    mockOs.homedir.mockReturnValue('/home/user')

    // Import fresh module
    const mod = await import('../runtime/embedded-db')
    EmbeddedDB = mod.EmbeddedDB
    createDB = mod.createDB
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('default path resolution', () => {
    it('should use .do/state/local.db as default path', () => {
      const cwd = process.cwd()
      const db = new EmbeddedDB()
      const dbPath = db.getPath()

      expect(dbPath).toBe(path.join(cwd, '.do', 'state', 'local.db'))
    })

    it('should NOT fall back to home directory', () => {
      const cwd = process.cwd()
      const db = new EmbeddedDB()
      const dbPath = db.getPath()

      // Should NOT contain home directory
      expect(dbPath).not.toContain('/home/user')
      expect(dbPath).not.toContain(os.homedir())

      // Should be in project directory
      expect(dbPath).toBe(path.join(cwd, '.do', 'state', 'local.db'))
    })

    it('should create .do/state/ directory if missing', () => {
      const cwd = process.cwd()
      mockFs.existsSync.mockReturnValue(false)

      new EmbeddedDB()

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join(cwd, '.do', 'state'),
        { recursive: true }
      )
    })

    it('should not create directory if it already exists', () => {
      mockFs.existsSync.mockReturnValue(true)

      new EmbeddedDB()

      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
    })
  })

  describe('memory mode', () => {
    it('should use :memory: when persist is false', () => {
      const db = new EmbeddedDB({ persist: false })
      expect(db.getPath()).toBe(':memory:')
    })

    it('should not create directories for memory mode', () => {
      new EmbeddedDB({ persist: false })
      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
    })
  })

  describe('custom path', () => {
    it('should use custom path when persist is a string', () => {
      const customPath = '/custom/path/to/db.sqlite'
      const db = new EmbeddedDB({ persist: customPath })
      expect(db.getPath()).toBe(customPath)
    })

    it('should create parent directory for custom path', () => {
      const customPath = '/custom/path/to/db.sqlite'
      mockFs.existsSync.mockReturnValue(false)

      new EmbeddedDB({ persist: customPath })

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/custom/path/to',
        { recursive: true }
      )
    })
  })

  describe('createDB factory', () => {
    it('should create EmbeddedDB instance with default options', () => {
      const db = createDB()
      expect(db).toBeInstanceOf(EmbeddedDB)
      expect(db.getPath()).toBe(path.join(process.cwd(), '.do', 'state', 'local.db'))
    })

    it('should create EmbeddedDB instance with custom options', () => {
      const db = createDB({ persist: ':memory:' })
      expect(db).toBeInstanceOf(EmbeddedDB)
      expect(db.getPath()).toBe(':memory:')
    })
  })

  describe('type safety', () => {
    it('EmbeddedDB should export proper database interfaces for compile-time use', async () => {
      // Import types to verify they exist and are exported
      // TypeScript interfaces exist only at compile-time, so we verify by:
      // 1. Creating objects that satisfy the interfaces (compile-time check)
      // 2. Using them in type-safe ways

      // Import the module to access types
      const mod = await import('../runtime/embedded-db')

      // Create a mock PreparedStatement that satisfies the interface
      // If the interface isn't properly exported, this would fail at compile time
      const mockStatement: import('../runtime/embedded-db').PreparedStatement = {
        run: () => {},
        get: <T>() => undefined as T | undefined,
        all: <T>() => [] as T[],
      }

      // Create a mock SQLiteDatabase that satisfies the interface
      const mockDb: import('../runtime/embedded-db').SQLiteDatabase = {
        exec: () => {},
        prepare: () => mockStatement,
        close: () => {},
      }

      // Runtime assertions to prove the mocks work
      expect(typeof mockDb.exec).toBe('function')
      expect(typeof mockDb.prepare).toBe('function')
      expect(typeof mockStatement.run).toBe('function')
      expect(typeof mockStatement.get).toBe('function')
      expect(typeof mockStatement.all).toBe('function')

      // Verify module exports the class and factory
      expect(mod.EmbeddedDB).toBeDefined()
      expect(mod.createDB).toBeDefined()
    })

    it('database methods should be properly typed without assertions in calling code', async () => {
      // This test verifies the design goal: callers shouldn't need type assertions
      const db = new EmbeddedDB({ persist: false })

      // These method signatures should work without any 'as' casts in this test code
      // If they require casts, the internal typing is wrong
      const path: string = db.getPath()
      expect(typeof path).toBe('string')

      // The close method should be callable without assertions
      db.close()
    })

    it('list method should return properly typed DOState array', async () => {
      const db = new EmbeddedDB({ persist: false })

      // list() should return Promise<DOState[]> with no assertions needed
      // If the return type requires casting, internal typing is broken
      type ListReturnType = Awaited<ReturnType<typeof db.list>>
      type ExpectedType = import('../runtime/embedded-db').DOState[]

      // Type-level assertion: these should be compatible
      const _typeCheck: ExpectedType extends ListReturnType ? true : false = true
      expect(_typeCheck).toBe(true)
    })

    it('get method should return properly typed DOState or null', async () => {
      const db = new EmbeddedDB({ persist: false })

      // get() should return Promise<DOState | null> with no assertions needed
      type GetReturnType = Awaited<ReturnType<typeof db.get>>
      type ExpectedType = import('../runtime/embedded-db').DOState | null

      // Type-level assertion: these should be compatible
      const _typeCheck: ExpectedType extends GetReturnType ? true : false = true
      expect(_typeCheck).toBe(true)
    })
  })
})

/**
 * Tests for corrupted JSON handling
 *
 * These tests verify that EmbeddedDB gracefully handles corrupted JSON data
 * in the database without crashing.
 */
describe('EmbeddedDB corrupted JSON handling', () => {
  let EmbeddedDB: typeof import('../runtime/embedded-db').EmbeddedDB

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    // Mock fs to allow directory creation
    mockFs.existsSync.mockReturnValue(true)

    // Import fresh module
    const mod = await import('../runtime/embedded-db')
    EmbeddedDB = mod.EmbeddedDB
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('list() with corrupted data', () => {
    it('should handle corrupted state JSON gracefully', async () => {
      const db = new EmbeddedDB({ persist: false })

      // Mock the database to return corrupted state JSON
      const mockPrepare = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          {
            id: 'test-1',
            class_name: 'TestDO',
            state: '{invalid json',  // Corrupted
            storage: '{}',
            created_at: 1000,
            updated_at: 2000,
          },
        ]),
        run: vi.fn(),
        get: vi.fn(),
      })

      // Inject mock db
      ;(db as unknown as { db: unknown }).db = {
        exec: vi.fn(),
        prepare: mockPrepare,
      }

      const results = await db.list()

      expect(results).toHaveLength(1)
      expect(results[0].state).toEqual({})  // Should fallback to empty object
      expect(results[0].storage).toEqual({})
    })

    it('should handle corrupted storage JSON gracefully', async () => {
      const db = new EmbeddedDB({ persist: false })

      const mockPrepare = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          {
            id: 'test-1',
            class_name: 'TestDO',
            state: '{"valid": true}',
            storage: 'not valid json at all',  // Corrupted
            created_at: 1000,
            updated_at: 2000,
          },
        ]),
        run: vi.fn(),
        get: vi.fn(),
      })

      ;(db as unknown as { db: unknown }).db = {
        exec: vi.fn(),
        prepare: mockPrepare,
      }

      const results = await db.list()

      expect(results).toHaveLength(1)
      expect(results[0].state).toEqual({ valid: true })
      expect(results[0].storage).toEqual({})  // Should fallback to empty object
    })
  })

  describe('get() with corrupted data', () => {
    it('should handle corrupted JSON gracefully', async () => {
      const db = new EmbeddedDB({ persist: false })

      const mockPrepare = vi.fn().mockReturnValue({
        all: vi.fn(),
        run: vi.fn(),
        get: vi.fn().mockReturnValue({
          id: 'test-1',
          class_name: 'TestDO',
          state: '{{{{',  // Corrupted
          storage: '[[[[',  // Corrupted
          created_at: 1000,
          updated_at: 2000,
        }),
      })

      ;(db as unknown as { db: unknown }).db = {
        exec: vi.fn(),
        prepare: mockPrepare,
      }

      const result = await db.get('test-1')

      expect(result).not.toBeNull()
      expect(result!.state).toEqual({})  // Should fallback to empty object
      expect(result!.storage).toEqual({})  // Should fallback to empty object
    })
  })

  describe('listSnapshots() with corrupted data', () => {
    it('should handle corrupted JSON gracefully', async () => {
      const db = new EmbeddedDB({ persist: false })

      const mockPrepare = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          {
            id: 'snap-1',
            do_id: 'test-1',
            state: 'corrupted snapshot state',  // Corrupted
            label: 'test snapshot',
            created_at: 1000,
          },
        ]),
        run: vi.fn(),
        get: vi.fn(),
      })

      ;(db as unknown as { db: unknown }).db = {
        exec: vi.fn(),
        prepare: mockPrepare,
      }

      const results = await db.listSnapshots('test-1')

      expect(results).toHaveLength(1)
      expect(results[0].state).toEqual({})  // Should fallback to empty object
    })
  })

  describe('restore() with corrupted data', () => {
    it('should handle corrupted JSON gracefully', async () => {
      const db = new EmbeddedDB({ persist: false })

      const mockPrepare = vi.fn().mockReturnValue({
        all: vi.fn(),
        run: vi.fn(),
        get: vi.fn().mockReturnValue({
          id: 'snap-1',
          do_id: 'test-1',
          state: 'totally broken json }{',  // Corrupted
          label: null,
          created_at: 1000,
        }),
      })

      ;(db as unknown as { db: unknown }).db = {
        exec: vi.fn(),
        prepare: mockPrepare,
      }

      // Should not throw, should use fallback
      await expect(db.restore('test-1', 'snap-1')).resolves.not.toThrow()
    })
  })
})
