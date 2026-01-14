/**
 * Test Command Tests
 *
 * Comprehensive tests for the POSIX `test` / `[` command implementation.
 * Tests file operations, string tests, numeric comparisons, and logical operations.
 *
 * @module bashx/do/commands/test-command.test
 */

import { describe, it, expect } from 'vitest'
import {
  executeTest,
  executeTestSync,
  isTestCommand,
  type FileInfo,
  type FileInfoProvider,
} from './test-command.js'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock file info provider for testing
 */
function createMockFileInfoProvider(files: Record<string, Partial<FileInfo>>): FileInfoProvider {
  return async (path: string): Promise<FileInfo | null> => {
    const info = files[path]
    if (!info) return null

    return {
      exists: true,
      isFile: info.isFile ?? false,
      isDirectory: info.isDirectory ?? false,
      isSymlink: info.isSymlink ?? false,
      isBlockDevice: info.isBlockDevice ?? false,
      isCharDevice: info.isCharDevice ?? false,
      isPipe: info.isPipe ?? false,
      isSocket: info.isSocket ?? false,
      size: info.size ?? 0,
      mode: info.mode ?? 0o644,
      mtime: info.mtime ?? new Date(),
      readable: info.readable ?? true,
      writable: info.writable ?? true,
      executable: info.executable ?? false,
    }
  }
}

// ============================================================================
// BASIC TESTS
// ============================================================================

describe('test command', () => {
  describe('basic operations', () => {
    it('returns true for non-empty string', async () => {
      const result = await executeTest(['hello'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for empty string', async () => {
      const result = await executeTest([''])
      expect(result.exitCode).toBe(1)
    })

    it('returns false for empty expression', async () => {
      const result = await executeTest([])
      expect(result.exitCode).toBe(1)
    })

    it('handles bracket form [ ]', async () => {
      const result = await executeTest(['[', '-n', 'hello', ']'])
      expect(result.exitCode).toBe(0)
    })

    it('returns error for missing ]', async () => {
      const result = await executeTest(['[', '-n', 'hello'])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('missing ]')
    })
  })
})

// ============================================================================
// STRING TESTS
// ============================================================================

describe('string tests', () => {
  describe('-n (non-zero length)', () => {
    it('returns true for non-empty string', async () => {
      const result = await executeTest(['-n', 'hello'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for empty string', async () => {
      const result = await executeTest(['-n', ''])
      expect(result.exitCode).toBe(1)
    })

    it('returns true for whitespace string', async () => {
      const result = await executeTest(['-n', '   '])
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-z (zero length)', () => {
    it('returns true for empty string', async () => {
      const result = await executeTest(['-z', ''])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for non-empty string', async () => {
      const result = await executeTest(['-z', 'hello'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('= (string equality)', () => {
    it('returns true for equal strings', async () => {
      const result = await executeTest(['hello', '=', 'hello'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for different strings', async () => {
      const result = await executeTest(['hello', '=', 'world'])
      expect(result.exitCode).toBe(1)
    })

    it('handles == as alias', async () => {
      const result = await executeTest(['hello', '==', 'hello'])
      expect(result.exitCode).toBe(0)
    })
  })

  describe('!= (string inequality)', () => {
    it('returns true for different strings', async () => {
      const result = await executeTest(['hello', '!=', 'world'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for equal strings', async () => {
      const result = await executeTest(['hello', '!=', 'hello'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('< (string less than)', () => {
    it('returns true when left is less', async () => {
      const result = await executeTest(['abc', '<', 'xyz'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left is greater', async () => {
      const result = await executeTest(['xyz', '<', 'abc'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('> (string greater than)', () => {
    it('returns true when left is greater', async () => {
      const result = await executeTest(['xyz', '>', 'abc'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left is less', async () => {
      const result = await executeTest(['abc', '>', 'xyz'])
      expect(result.exitCode).toBe(1)
    })
  })
})

// ============================================================================
// NUMERIC TESTS
// ============================================================================

describe('numeric tests', () => {
  describe('-eq (equal)', () => {
    it('returns true for equal numbers', async () => {
      const result = await executeTest(['5', '-eq', '5'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for different numbers', async () => {
      const result = await executeTest(['5', '-eq', '3'])
      expect(result.exitCode).toBe(1)
    })

    it('handles negative numbers', async () => {
      const result = await executeTest(['-5', '-eq', '-5'])
      expect(result.exitCode).toBe(0)
    })

    it('returns error for non-numeric arguments', async () => {
      const result = await executeTest(['abc', '-eq', '5'])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('integer expression expected')
    })
  })

  describe('-ne (not equal)', () => {
    it('returns true for different numbers', async () => {
      const result = await executeTest(['5', '-ne', '3'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false for equal numbers', async () => {
      const result = await executeTest(['5', '-ne', '5'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-lt (less than)', () => {
    it('returns true when left is less', async () => {
      const result = await executeTest(['3', '-lt', '5'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left is greater or equal', async () => {
      const result = await executeTest(['5', '-lt', '3'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-le (less than or equal)', () => {
    it('returns true when left is less', async () => {
      const result = await executeTest(['3', '-le', '5'])
      expect(result.exitCode).toBe(0)
    })

    it('returns true when equal', async () => {
      const result = await executeTest(['5', '-le', '5'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left is greater', async () => {
      const result = await executeTest(['7', '-le', '5'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-gt (greater than)', () => {
    it('returns true when left is greater', async () => {
      const result = await executeTest(['5', '-gt', '3'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left is less or equal', async () => {
      const result = await executeTest(['3', '-gt', '5'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-ge (greater than or equal)', () => {
    it('returns true when left is greater', async () => {
      const result = await executeTest(['5', '-ge', '3'])
      expect(result.exitCode).toBe(0)
    })

    it('returns true when equal', async () => {
      const result = await executeTest(['5', '-ge', '5'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left is less', async () => {
      const result = await executeTest(['3', '-ge', '5'])
      expect(result.exitCode).toBe(1)
    })
  })
})

// ============================================================================
// FILE TESTS
// ============================================================================

describe('file tests', () => {
  const mockFiles = createMockFileInfoProvider({
    '/existing/file.txt': { isFile: true, size: 100 },
    '/existing/empty.txt': { isFile: true, size: 0 },
    '/existing/dir': { isDirectory: true },
    '/existing/link': { isSymlink: true },
    '/existing/readable.txt': { isFile: true, readable: true, writable: false },
    '/existing/writable.txt': { isFile: true, readable: false, writable: true },
    '/existing/executable': { isFile: true, executable: true },
    '/existing/block': { isBlockDevice: true },
    '/existing/char': { isCharDevice: true },
    '/existing/pipe': { isPipe: true },
    '/existing/socket': { isSocket: true },
    '/existing/setuid': { isFile: true, mode: 0o4755 },
    '/existing/setgid': { isFile: true, mode: 0o2755 },
    '/existing/sticky': { isFile: true, mode: 0o1755 },
    '/existing/old.txt': { isFile: true, mtime: new Date('2020-01-01') },
    '/existing/new.txt': { isFile: true, mtime: new Date('2024-01-01') },
  })

  describe('-e (exists)', () => {
    it('returns true for existing file', async () => {
      const result = await executeTest(['-e', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for non-existing file', async () => {
      const result = await executeTest(['-e', '/nonexistent'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-f (regular file)', () => {
    it('returns true for regular file', async () => {
      const result = await executeTest(['-f', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for directory', async () => {
      const result = await executeTest(['-f', '/existing/dir'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-d (directory)', () => {
    it('returns true for directory', async () => {
      const result = await executeTest(['-d', '/existing/dir'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for regular file', async () => {
      const result = await executeTest(['-d', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-r (readable)', () => {
    it('returns true for readable file', async () => {
      const result = await executeTest(['-r', '/existing/readable.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for non-readable file', async () => {
      const result = await executeTest(['-r', '/existing/writable.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-w (writable)', () => {
    it('returns true for writable file', async () => {
      const result = await executeTest(['-w', '/existing/writable.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for non-writable file', async () => {
      const result = await executeTest(['-w', '/existing/readable.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-x (executable)', () => {
    it('returns true for executable file', async () => {
      const result = await executeTest(['-x', '/existing/executable'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for non-executable file', async () => {
      const result = await executeTest(['-x', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-s (size > 0)', () => {
    it('returns true for non-empty file', async () => {
      const result = await executeTest(['-s', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for empty file', async () => {
      const result = await executeTest(['-s', '/existing/empty.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-L / -h (symlink)', () => {
    it('returns true for symlink with -L', async () => {
      const result = await executeTest(['-L', '/existing/link'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns true for symlink with -h', async () => {
      const result = await executeTest(['-h', '/existing/link'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for regular file', async () => {
      const result = await executeTest(['-L', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-b (block device)', () => {
    it('returns true for block device', async () => {
      const result = await executeTest(['-b', '/existing/block'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for regular file', async () => {
      const result = await executeTest(['-b', '/existing/file.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-c (character device)', () => {
    it('returns true for character device', async () => {
      const result = await executeTest(['-c', '/existing/char'], mockFiles)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-p (named pipe)', () => {
    it('returns true for pipe', async () => {
      const result = await executeTest(['-p', '/existing/pipe'], mockFiles)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-S (socket)', () => {
    it('returns true for socket', async () => {
      const result = await executeTest(['-S', '/existing/socket'], mockFiles)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-u (setuid)', () => {
    it('returns true for setuid file', async () => {
      const result = await executeTest(['-u', '/existing/setuid'], mockFiles)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-g (setgid)', () => {
    it('returns true for setgid file', async () => {
      const result = await executeTest(['-g', '/existing/setgid'], mockFiles)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-k (sticky)', () => {
    it('returns true for sticky bit file', async () => {
      const result = await executeTest(['-k', '/existing/sticky'], mockFiles)
      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// FILE COMPARISONS
// ============================================================================

describe('file comparisons', () => {
  const mockFiles = createMockFileInfoProvider({
    '/old.txt': { isFile: true, mtime: new Date('2020-01-01') },
    '/new.txt': { isFile: true, mtime: new Date('2024-01-01') },
    '/same.txt': { isFile: true, mtime: new Date('2022-01-01') },
  })

  describe('-nt (newer than)', () => {
    it('returns true when file1 is newer', async () => {
      const result = await executeTest(['/new.txt', '-nt', '/old.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false when file1 is older', async () => {
      const result = await executeTest(['/old.txt', '-nt', '/new.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-ot (older than)', () => {
    it('returns true when file1 is older', async () => {
      const result = await executeTest(['/old.txt', '-ot', '/new.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false when file1 is newer', async () => {
      const result = await executeTest(['/new.txt', '-ot', '/old.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-ef (same file)', () => {
    it('returns true for same path', async () => {
      const result = await executeTest(['/same.txt', '-ef', '/same.txt'], mockFiles)
      expect(result.exitCode).toBe(0)
    })

    it('returns false for different paths', async () => {
      const result = await executeTest(['/old.txt', '-ef', '/new.txt'], mockFiles)
      expect(result.exitCode).toBe(1)
    })
  })
})

// ============================================================================
// LOGICAL OPERATIONS
// ============================================================================

describe('logical operations', () => {
  describe('! (negation)', () => {
    it('negates true to false', async () => {
      const result = await executeTest(['!', '-n', 'hello'])
      expect(result.exitCode).toBe(1)
    })

    it('negates false to true', async () => {
      const result = await executeTest(['!', '-z', 'hello'])
      expect(result.exitCode).toBe(0)
    })

    it('handles double negation', async () => {
      const result = await executeTest(['!', '!', '-n', 'hello'])
      expect(result.exitCode).toBe(0)
    })
  })

  describe('-a (AND)', () => {
    it('returns true when both sides are true', async () => {
      const result = await executeTest(['-n', 'hello', '-a', '-n', 'world'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when left side is false', async () => {
      const result = await executeTest(['-z', 'hello', '-a', '-n', 'world'])
      expect(result.exitCode).toBe(1)
    })

    it('returns false when right side is false', async () => {
      const result = await executeTest(['-n', 'hello', '-a', '-z', 'world'])
      expect(result.exitCode).toBe(1)
    })

    it('returns false when both sides are false', async () => {
      const result = await executeTest(['-z', 'hello', '-a', '-z', 'world'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('-o (OR)', () => {
    it('returns true when both sides are true', async () => {
      const result = await executeTest(['-n', 'hello', '-o', '-n', 'world'])
      expect(result.exitCode).toBe(0)
    })

    it('returns true when left side is true', async () => {
      const result = await executeTest(['-n', 'hello', '-o', '-z', 'world'])
      expect(result.exitCode).toBe(0)
    })

    it('returns true when right side is true', async () => {
      const result = await executeTest(['-z', 'hello', '-o', '-n', 'world'])
      expect(result.exitCode).toBe(0)
    })

    it('returns false when both sides are false', async () => {
      const result = await executeTest(['-z', 'hello', '-o', '-z', 'world'])
      expect(result.exitCode).toBe(1)
    })
  })

  describe('( ) (grouping)', () => {
    it('groups expressions correctly', async () => {
      // (-z "" -o -n hello) -a -n world
      // (true -o true) -a true = true
      const result = await executeTest([
        '(', '-z', '', '-o', '-n', 'hello', ')', '-a', '-n', 'world'
      ])
      expect(result.exitCode).toBe(0)
    })

    it('handles nested parentheses', async () => {
      const result = await executeTest([
        '(', '(', '-n', 'a', ')', '-a', '-n', 'b', ')'
      ])
      expect(result.exitCode).toBe(0)
    })

    it('returns error for unmatched parentheses', async () => {
      const result = await executeTest(['(', '-n', 'hello'])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('unmatched')
    })
  })

  describe('precedence', () => {
    it('applies -a before -o', async () => {
      // -z hello -o -n foo -a -n bar
      // false -o (true -a true) = false -o true = true
      const result = await executeTest(['-z', 'hello', '-o', '-n', 'foo', '-a', '-n', 'bar'])
      expect(result.exitCode).toBe(0)
    })

    it('applies ! before binary operators', async () => {
      // ! -z hello -a -n world
      // true -a true = true
      const result = await executeTest(['!', '-z', 'hello', '-a', '-n', 'world'])
      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// SYNCHRONOUS VERSION TESTS
// ============================================================================

describe('executeTestSync', () => {
  it('handles string tests', () => {
    const result = executeTestSync(['-n', 'hello'])
    expect(result.exitCode).toBe(0)
  })

  it('handles numeric tests', () => {
    const result = executeTestSync(['5', '-gt', '3'])
    expect(result.exitCode).toBe(0)
  })

  it('handles logical operations', () => {
    const result = executeTestSync(['-n', 'a', '-a', '-n', 'b'])
    expect(result.exitCode).toBe(0)
  })

  it('file tests return false without filesystem', () => {
    const result = executeTestSync(['-f', '/some/file'])
    expect(result.exitCode).toBe(1)
  })

  it('handles bracket form', () => {
    const result = executeTestSync(['[', '-n', 'hello', ']'])
    expect(result.exitCode).toBe(0)
  })

  it('returns error for missing ]', () => {
    const result = executeTestSync(['[', '-n', 'hello'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('missing ]')
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('isTestCommand', () => {
  it('returns true for "test"', () => {
    expect(isTestCommand('test')).toBe(true)
  })

  it('returns true for "["', () => {
    expect(isTestCommand('[')).toBe(true)
  })

  it('returns false for other commands', () => {
    expect(isTestCommand('echo')).toBe(false)
    expect(isTestCommand('ls')).toBe(false)
    expect(isTestCommand(']')).toBe(false)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  it('handles too many arguments', async () => {
    const result = await executeTest(['a', 'b', 'c', 'd'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('too many arguments')
  })

  it('handles unknown unary operator', async () => {
    const result = await executeTest(['-X', 'arg'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unknown operator')
  })

  it('handles unknown binary operator', async () => {
    const result = await executeTest(['a', '-XX', 'b'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unknown operator')
  })

  it('handles -t (terminal) test', async () => {
    const result = await executeTest(['-t', '0'])
    expect(result.exitCode).toBe(0) // fd 0 is considered a terminal
  })

  it('handles -t with invalid fd', async () => {
    const result = await executeTest(['-t', '99'])
    expect(result.exitCode).toBe(1)
  })
})
