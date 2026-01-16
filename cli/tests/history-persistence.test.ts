/**
 * History Persistence Tests - RED PHASE
 *
 * Tests for persistent REPL history that survives between sessions.
 * Currently history is in-memory only - these tests should FAIL.
 *
 * Requirements:
 * 1. History saved to ~/.dotdo/repl_history on new entry
 * 2. History loaded from file on REPL startup
 * 3. ~/.dotdo/ directory created if doesn't exist
 * 4. History file location is configurable
 * 5. Sensitive commands filtered (token, password, secret, key)
 * 6. Max history size configurable (default 1000)
 * 7. FIFO removal when max size exceeded
 * 8. Malformed history file handled gracefully
 * 9. File permissions are restrictive (0600)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  statSync: vi.fn(),
}))

// The module we're testing (doesn't exist yet - RED phase)
// We define the expected interface here - tests will fail until implemented
export interface HistoryManagerOptions {
  historyPath?: string
  maxSize?: number
}

export interface IHistoryManager {
  maxSize: number
  size: number
  initialize(): void
  add(entry: string): void
  getHistory(): string[]
  getEntry(index: number): string | undefined
  clear(): void
  search(query: string): string[]
}

// Attempt to import the real module, fall back to stub that throws
let HistoryManager: new (options?: HistoryManagerOptions) => IHistoryManager

try {
  // This will fail until the module is implemented
  const module = await import('../src/history-manager.js')
  HistoryManager = module.HistoryManager
} catch {
  // Stub class that makes tests fail with clear message
  HistoryManager = class StubHistoryManager implements IHistoryManager {
    constructor(_options?: HistoryManagerOptions) {
      // Constructor works, methods will fail
    }
    get maxSize(): number {
      throw new Error('HistoryManager not implemented: maxSize getter missing')
    }
    get size(): number {
      throw new Error('HistoryManager not implemented: size getter missing')
    }
    initialize(): void {
      throw new Error('HistoryManager not implemented: initialize() missing')
    }
    add(_entry: string): void {
      throw new Error('HistoryManager not implemented: add() missing')
    }
    getHistory(): string[] {
      throw new Error('HistoryManager not implemented: getHistory() missing')
    }
    getEntry(_index: number): string | undefined {
      throw new Error('HistoryManager not implemented: getEntry() missing')
    }
    clear(): void {
      throw new Error('HistoryManager not implemented: clear() missing')
    }
    search(_query: string): string[] {
      throw new Error('HistoryManager not implemented: search() missing')
    }
  } as unknown as new (options?: HistoryManagerOptions) => IHistoryManager
}

describe('HistoryManager', () => {
  const mockFs = fs as unknown as {
    existsSync: ReturnType<typeof vi.fn>
    mkdirSync: ReturnType<typeof vi.fn>
    readFileSync: ReturnType<typeof vi.fn>
    writeFileSync: ReturnType<typeof vi.fn>
    chmodSync: ReturnType<typeof vi.fn>
    statSync: ReturnType<typeof vi.fn>
  }

  const defaultHistoryPath = path.join(os.homedir(), '.dotdo', 'repl_history')
  const defaultDotdoDir = path.join(os.homedir(), '.dotdo')

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: directory and file exist
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('')
    mockFs.statSync.mockReturnValue({ mode: 0o100600 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should create ~/.dotdo directory if it does not exist', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === defaultDotdoDir) return false
        if (p === defaultHistoryPath) return false
        return true
      })

      const manager = new HistoryManager()
      manager.initialize()

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(defaultDotdoDir, {
        recursive: true,
        mode: 0o700,
      })
    })

    it('should load history from file on startup', () => {
      const existingHistory = ['$.Customer.create({ name: "Alice" })', '$.Order.list()', '.help']
      mockFs.readFileSync.mockReturnValue(existingHistory.join('\n'))

      const manager = new HistoryManager()
      manager.initialize()

      expect(mockFs.readFileSync).toHaveBeenCalledWith(defaultHistoryPath, 'utf-8')
      expect(manager.getHistory()).toEqual(existingHistory)
    })

    it('should handle missing history file gracefully', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === defaultHistoryPath) return false
        return true
      })

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.getHistory()).toEqual([])
    })

    it('should use custom history file path when configured', () => {
      const customPath = '/custom/path/history'
      const customDir = '/custom/path'

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('custom history entry')

      const manager = new HistoryManager({ historyPath: customPath })
      manager.initialize()

      expect(mockFs.readFileSync).toHaveBeenCalledWith(customPath, 'utf-8')
    })
  })

  describe('adding entries', () => {
    it('should save history to file when new entry is added', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('$.Customer.create({ name: "Bob" })')

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        defaultHistoryPath,
        '$.Customer.create({ name: "Bob" })',
        { encoding: 'utf-8', mode: 0o600 }
      )
    })

    it('should append to existing history', () => {
      mockFs.readFileSync.mockReturnValue('first command')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('second command')

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        defaultHistoryPath,
        'first command\nsecond command',
        { encoding: 'utf-8', mode: 0o600 }
      )
    })

    it('should not add duplicate consecutive entries', () => {
      mockFs.readFileSync.mockReturnValue('duplicate command')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('duplicate command')

      // Should not write since it's a duplicate of the last entry
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(manager.getHistory()).toEqual(['duplicate command'])
    })

    it('should not add empty or whitespace-only entries', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('')
      manager.add('   ')
      manager.add('\t\n')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(manager.getHistory()).toEqual([])
    })
  })

  describe('sensitive command filtering', () => {
    it('should NOT persist commands containing "token"', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('const token = "abc123"')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should NOT persist commands containing "password"', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('login({ password: "secret123" })')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should NOT persist commands containing "secret"', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('process.env.API_SECRET')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should NOT persist commands containing "key" (API keys)', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('const apiKey = getKey()')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should filter case-insensitively', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('const TOKEN = "xxx"')
      manager.add('const PASSWORD = "yyy"')
      manager.add('const SECRET = "zzz"')
      manager.add('const ApiKey = "aaa"')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should still add sensitive commands to in-memory history for session', () => {
      mockFs.readFileSync.mockReturnValue('')

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('const token = "abc"')

      // Should be in memory for current session navigation
      expect(manager.getHistory()).toContain('const token = "abc"')
      // But not persisted to file
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('max history size', () => {
    it('should default to 1000 entries max', () => {
      const manager = new HistoryManager()
      expect(manager.maxSize).toBe(1000)
    })

    it('should allow configurable max size', () => {
      const manager = new HistoryManager({ maxSize: 500 })
      expect(manager.maxSize).toBe(500)
    })

    it('should remove oldest entries when max size exceeded (FIFO)', () => {
      // Create history with 5 entries at max size of 5
      mockFs.readFileSync.mockReturnValue('cmd1\ncmd2\ncmd3\ncmd4\ncmd5')

      const manager = new HistoryManager({ maxSize: 5 })
      manager.initialize()
      manager.add('cmd6')

      // Should have removed cmd1 (oldest)
      expect(manager.getHistory()).toEqual(['cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6'])

      // File should be written without cmd1
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        defaultHistoryPath,
        'cmd2\ncmd3\ncmd4\ncmd5\ncmd6',
        expect.any(Object)
      )
    })

    it('should handle loading file with more entries than max size', () => {
      // File has 10 entries, but max is 5
      const entries = Array.from({ length: 10 }, (_, i) => `cmd${i + 1}`)
      mockFs.readFileSync.mockReturnValue(entries.join('\n'))

      const manager = new HistoryManager({ maxSize: 5 })
      manager.initialize()

      // Should only keep the last 5 (most recent)
      expect(manager.getHistory()).toEqual(['cmd6', 'cmd7', 'cmd8', 'cmd9', 'cmd10'])
    })
  })

  describe('malformed history file handling', () => {
    it('should handle file with binary/non-UTF8 content gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Invalid UTF-8 encoding')
      })

      const manager = new HistoryManager()

      // Should not throw, should return empty history
      expect(() => manager.initialize()).not.toThrow()
      expect(manager.getHistory()).toEqual([])
    })

    it('should handle file read permission errors gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        const error = new Error('EACCES: permission denied')
        ;(error as NodeJS.ErrnoException).code = 'EACCES'
        throw error
      })

      const manager = new HistoryManager()

      expect(() => manager.initialize()).not.toThrow()
      expect(manager.getHistory()).toEqual([])
    })

    it('should handle corrupted file (no newlines) as single entry', () => {
      mockFs.readFileSync.mockReturnValue('single line without newline')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.getHistory()).toEqual(['single line without newline'])
    })

    it('should filter out empty lines from history file', () => {
      mockFs.readFileSync.mockReturnValue('cmd1\n\ncmd2\n\n\ncmd3')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.getHistory()).toEqual(['cmd1', 'cmd2', 'cmd3'])
    })

    it('should handle write errors gracefully without throwing', () => {
      mockFs.readFileSync.mockReturnValue('')
      mockFs.writeFileSync.mockImplementation(() => {
        const error = new Error('ENOSPC: no space left on device')
        ;(error as NodeJS.ErrnoException).code = 'ENOSPC'
        throw error
      })

      const manager = new HistoryManager()
      manager.initialize()

      // Should not throw, entry should still be in memory
      expect(() => manager.add('new command')).not.toThrow()
      expect(manager.getHistory()).toContain('new command')
    })
  })

  describe('file permissions', () => {
    it('should create history file with 0600 permissions', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === defaultHistoryPath) return false
        return true
      })
      mockFs.readFileSync.mockImplementation(() => {
        const error = new Error('ENOENT')
        ;(error as NodeJS.ErrnoException).code = 'ENOENT'
        throw error
      })

      const manager = new HistoryManager()
      manager.initialize()
      manager.add('first command')

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        defaultHistoryPath,
        'first command',
        { encoding: 'utf-8', mode: 0o600 }
      )
    })

    it('should create ~/.dotdo directory with 0700 permissions', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === defaultDotdoDir) return false
        if (p === defaultHistoryPath) return false
        return true
      })

      const manager = new HistoryManager()
      manager.initialize()

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(defaultDotdoDir, {
        recursive: true,
        mode: 0o700,
      })
    })

    it('should fix permissions if existing file has wrong permissions', () => {
      mockFs.statSync.mockReturnValue({ mode: 0o100644 }) // World-readable - bad!

      const manager = new HistoryManager()
      manager.initialize()

      expect(mockFs.chmodSync).toHaveBeenCalledWith(defaultHistoryPath, 0o600)
    })
  })

  describe('history navigation', () => {
    it('should provide history entries in order (oldest to newest)', () => {
      mockFs.readFileSync.mockReturnValue('old\nmiddle\nnew')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.getHistory()).toEqual(['old', 'middle', 'new'])
    })

    it('should provide entry at specific index', () => {
      mockFs.readFileSync.mockReturnValue('cmd0\ncmd1\ncmd2')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.getEntry(0)).toBe('cmd0')
      expect(manager.getEntry(1)).toBe('cmd1')
      expect(manager.getEntry(2)).toBe('cmd2')
    })

    it('should return undefined for out-of-bounds index', () => {
      mockFs.readFileSync.mockReturnValue('cmd0')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.getEntry(999)).toBeUndefined()
      expect(manager.getEntry(-1)).toBeUndefined()
    })

    it('should provide total history count', () => {
      mockFs.readFileSync.mockReturnValue('a\nb\nc')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.size).toBe(3)
    })
  })

  describe('clear history', () => {
    it('should clear all history entries', () => {
      mockFs.readFileSync.mockReturnValue('cmd1\ncmd2\ncmd3')

      const manager = new HistoryManager()
      manager.initialize()
      manager.clear()

      expect(manager.getHistory()).toEqual([])
      expect(manager.size).toBe(0)
    })

    it('should write empty file when cleared', () => {
      mockFs.readFileSync.mockReturnValue('cmd1\ncmd2')

      const manager = new HistoryManager()
      manager.initialize()
      manager.clear()

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        defaultHistoryPath,
        '',
        expect.any(Object)
      )
    })
  })

  describe('search history', () => {
    it('should search history entries by substring', () => {
      mockFs.readFileSync.mockReturnValue('$.Customer.create()\n$.Order.list()\n$.Customer.find()')

      const manager = new HistoryManager()
      manager.initialize()

      const results = manager.search('Customer')

      expect(results).toEqual(['$.Customer.create()', '$.Customer.find()'])
    })

    it('should return empty array when no matches', () => {
      mockFs.readFileSync.mockReturnValue('cmd1\ncmd2')

      const manager = new HistoryManager()
      manager.initialize()

      expect(manager.search('nonexistent')).toEqual([])
    })
  })
})
