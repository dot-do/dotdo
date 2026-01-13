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
})
