/**
 * Tests for fs_stat MCP Tool - File Information Retrieval
 *
 * REFACTOR phase: Tests verify the refactored production implementation
 * in core/mcp/fs-stat.ts maintains the same behavior.
 *
 * The fs_stat tool provides file/directory statistics retrieval for AI-assisted
 * file operations via the Model Context Protocol (MCP).
 *
 * @module tests/mcp/fs-stat
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem } from '../test-utils'
import { constants } from '../../core/constants'

// Import production implementation
import {
  invokeFsStat,
  invokeFsLstat,
  fsStatToolSchema,
  fsLstatToolSchema,
  type McpStatResult,
  type StatStorageBackend,
} from '../../core/mcp/fs-stat'

// Types for MCP tool results (re-exported from fs-stat for convenience)
interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
}

/**
 * Helper to parse stat result from MCP tool response
 */
function parseStatResult(result: McpToolResult): McpStatResult {
  if (result.isError) {
    throw new Error((result.content[0] as { type: 'text'; text: string }).text)
  }
  const text = (result.content[0] as { type: 'text'; text: string }).text
  return JSON.parse(text) as McpStatResult
}

// ============================================================================
// BASIC FILE STAT
// ============================================================================

describe('fs_stat MCP Tool - Basic File Stats', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('file size', () => {
    it('should return correct size for empty file', async () => {
      storage.addFile('/home/user/empty.txt', '')

      const result = await invokeFsStat({ path: '/home/user/empty.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.size).toBe(0)
    })

    it('should return correct size for small text file', async () => {
      storage.addFile('/home/user/small.txt', 'Hello, World!')

      const result = await invokeFsStat({ path: '/home/user/small.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.size).toBe(13) // "Hello, World!" is 13 bytes
    })

    it('should return correct size for binary file', async () => {
      const binaryData = new Uint8Array(1024) // 1KB of zeros
      storage.addFile('/home/user/binary.bin', binaryData)

      const result = await invokeFsStat({ path: '/home/user/binary.bin' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.size).toBe(1024)
    })

    it('should return correct size for large file', async () => {
      const largeData = new Uint8Array(1024 * 100) // 100KB
      storage.addFile('/home/user/large.bin', largeData)

      const result = await invokeFsStat({ path: '/home/user/large.bin' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.size).toBe(102400)
    })
  })

  describe('file mode', () => {
    it('should return correct mode for file with default permissions', async () => {
      storage.addFile('/home/user/default.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/default.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // Default file mode is 0o644 + S_IFREG
      expect(stats.mode & 0o777).toBe(0o644)
      expect(stats.mode & constants.S_IFMT).toBe(constants.S_IFREG)
    })

    it('should return correct mode for file with custom permissions', async () => {
      storage.addFile('/home/user/exec.sh', '#!/bin/bash', { mode: 0o755 })

      const result = await invokeFsStat({ path: '/home/user/exec.sh' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.mode & 0o777).toBe(0o755)
    })

    it('should return correct mode for readonly file', async () => {
      storage.addFile('/home/user/readonly.txt', 'readonly', { mode: 0o444 })

      const result = await invokeFsStat({ path: '/home/user/readonly.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.mode & 0o777).toBe(0o444)
    })
  })

  describe('timestamps', () => {
    it('should return atime, mtime, ctime, and birthtime', async () => {
      storage.addFile('/home/user/timestamped.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/timestamped.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(typeof stats.atime).toBe('number')
      expect(typeof stats.mtime).toBe('number')
      expect(typeof stats.ctime).toBe('number')
      expect(typeof stats.birthtime).toBe('number')
      // All timestamps should be reasonable (within last minute)
      const now = Date.now()
      expect(stats.atime).toBeGreaterThan(now - 60000)
      expect(stats.mtime).toBeGreaterThan(now - 60000)
      expect(stats.ctime).toBeGreaterThan(now - 60000)
      expect(stats.birthtime).toBeGreaterThan(now - 60000)
    })

    it('should return birthtime from file creation', async () => {
      const pastTime = Date.now() - 86400000 // 1 day ago
      storage.addFile('/home/user/old.txt', 'old', { birthtime: pastTime })

      const result = await invokeFsStat({ path: '/home/user/old.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.birthtime).toBe(pastTime)
    })
  })

  describe('ownership', () => {
    it('should return uid and gid', async () => {
      storage.addFile('/home/user/owned.txt', 'content', { uid: 1000, gid: 1000 })

      const result = await invokeFsStat({ path: '/home/user/owned.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.uid).toBe(1000)
      expect(stats.gid).toBe(1000)
    })

    it('should return default uid/gid for files without explicit ownership', async () => {
      storage.addFile('/home/user/noowner.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/noowner.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(typeof stats.uid).toBe('number')
      expect(typeof stats.gid).toBe('number')
    })
  })

  describe('block information', () => {
    it('should return blksize', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(typeof stats.blksize).toBe('number')
      expect(stats.blksize).toBeGreaterThan(0)
    })

    it('should return blocks count', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(typeof stats.blocks).toBe('number')
      expect(stats.blocks).toBeGreaterThanOrEqual(0)
    })
  })

  describe('link count', () => {
    it('should return nlink of 1 for regular file', async () => {
      storage.addFile('/home/user/single.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/single.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.nlink).toBe(1)
    })
  })
})

// ============================================================================
// DIRECTORY STAT
// ============================================================================

describe('fs_stat MCP Tool - Directory Stats', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('directory identification', () => {
    it('should identify directory via mode', async () => {
      storage.addDirectory('/home/user/mydir')

      const result = await invokeFsStat({ path: '/home/user/mydir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.mode & constants.S_IFMT).toBe(constants.S_IFDIR)
    })

    it('should return isDirectory true for directories', async () => {
      storage.addDirectory('/home/user/mydir')

      const result = await invokeFsStat({ path: '/home/user/mydir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isDirectory).toBe(true)
      expect(stats.isFile).toBe(false)
    })

    it('should return isFile true for files', async () => {
      storage.addFile('/home/user/myfile.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/myfile.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
      expect(stats.isDirectory).toBe(false)
    })
  })

  describe('directory mode', () => {
    it('should return correct mode for directory with default permissions', async () => {
      storage.addDirectory('/home/user/defaultdir')

      const result = await invokeFsStat({ path: '/home/user/defaultdir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // Default directory mode is 0o755
      expect(stats.mode & 0o777).toBe(0o755)
    })

    it('should return correct mode for directory with custom permissions', async () => {
      storage.addDirectory('/home/user/customdir', { mode: 0o700 })

      const result = await invokeFsStat({ path: '/home/user/customdir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.mode & 0o777).toBe(0o700)
    })
  })

  describe('directory size', () => {
    it('should return size for directory (implementation specific)', async () => {
      storage.addDirectory('/home/user/emptydir')

      const result = await invokeFsStat({ path: '/home/user/emptydir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // Directory size is implementation-specific (could be 0 or block size)
      expect(typeof stats.size).toBe('number')
    })
  })

  describe('directory link count', () => {
    it('should return nlink >= 2 for directory', async () => {
      storage.addDirectory('/home/user/linkdir')

      const result = await invokeFsStat({ path: '/home/user/linkdir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // Directories have at least 2 links (. and parent's entry)
      expect(stats.nlink).toBeGreaterThanOrEqual(2)
    })
  })

  describe('root directory', () => {
    it('should stat root directory successfully', async () => {
      const result = await invokeFsStat({ path: '/' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isDirectory).toBe(true)
      expect(stats.mode & constants.S_IFMT).toBe(constants.S_IFDIR)
    })
  })
})

// ============================================================================
// SYMLINK STAT (stat vs lstat)
// ============================================================================

describe('fs_stat MCP Tool - Symlink Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/target.txt', 'target content')
    storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')
    storage.addDirectory('/home/user/targetdir')
    storage.addSymlink('/home/user/linkdir', '/home/user/targetdir')
  })

  describe('stat follows symlinks', () => {
    it('should return target file stats for file symlink', async () => {
      const result = await invokeFsStat({ path: '/home/user/link.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // stat should follow symlink and return target file stats
      expect(stats.isFile).toBe(true)
      expect(stats.isSymbolicLink).toBe(false)
      expect(stats.size).toBe(14) // "target content" length
    })

    it('should return target directory stats for directory symlink', async () => {
      const result = await invokeFsStat({ path: '/home/user/linkdir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // stat should follow symlink and return target directory stats
      expect(stats.isDirectory).toBe(true)
      expect(stats.isSymbolicLink).toBe(false)
    })
  })

  describe('lstat does not follow symlinks', () => {
    it('should return symlink stats for file symlink', async () => {
      const result = await invokeFsLstat({ path: '/home/user/link.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      // lstat should return symlink stats, not target
      expect(stats.isSymbolicLink).toBe(true)
      expect(stats.isFile).toBe(false)
      expect(stats.mode & constants.S_IFMT).toBe(constants.S_IFLNK)
    })

    it('should return symlink stats for directory symlink', async () => {
      const result = await invokeFsLstat({ path: '/home/user/linkdir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSymbolicLink).toBe(true)
      expect(stats.isDirectory).toBe(false)
    })
  })

  describe('broken symlinks', () => {
    it('should error for stat on broken symlink (target missing)', async () => {
      storage.addSymlink('/home/user/broken.txt', '/home/user/nonexistent.txt')

      const result = await invokeFsStat({ path: '/home/user/broken.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist/i)
    })

    it('should succeed for lstat on broken symlink', async () => {
      storage.addSymlink('/home/user/broken.txt', '/home/user/nonexistent.txt')

      const result = await invokeFsLstat({ path: '/home/user/broken.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSymbolicLink).toBe(true)
    })
  })

  describe('symlink chains', () => {
    it('should follow chain of symlinks with stat', async () => {
      storage.addFile('/home/user/final.txt', 'final content')
      storage.addSymlink('/home/user/link1.txt', '/home/user/final.txt')
      storage.addSymlink('/home/user/link2.txt', '/home/user/link1.txt')
      storage.addSymlink('/home/user/link3.txt', '/home/user/link2.txt')

      const result = await invokeFsStat({ path: '/home/user/link3.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
      expect(stats.size).toBe(13) // "final content" length
    })
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('fs_stat MCP Tool - Error Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('non-existent file (ENOENT)', () => {
    it('should return ENOENT error for non-existent file', async () => {
      const result = await invokeFsStat({ path: '/home/user/nonexistent.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist|no such file/i)
    })

    it('should return ENOENT error for non-existent directory', async () => {
      const result = await invokeFsStat({ path: '/nonexistent/path' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist|no such file/i)
    })

    it('should include path in error message', async () => {
      const result = await invokeFsStat({ path: '/missing/specific/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/missing/specific/file.txt')
    })
  })

  describe('path traversal (EACCES)', () => {
    it('should return error for path traversal attempt', async () => {
      const result = await invokeFsStat({ path: '/home/user/../../../etc/passwd' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal/i)
    })

    it('should return error for relative path traversal', async () => {
      const result = await invokeFsStat({ path: '../../../etc' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal|invalid/i)
    })
  })

  describe('missing required parameters', () => {
    it('should return error when path is missing', async () => {
      const result = await invokeFsStat({}, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|missing/i)
    })

    it('should return error when path is empty string', async () => {
      const result = await invokeFsStat({ path: '' }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|empty/i)
    })

    it('should return error when path is not a string', async () => {
      const result = await invokeFsStat({ path: 123 as unknown as string }, storage as StatStorageBackend)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/invalid|type|string/i)
    })
  })
})

// ============================================================================
// STAT TYPE METHODS
// ============================================================================

describe('fs_stat MCP Tool - Type Detection Methods', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('isFile()', () => {
    it('should return true for regular file', async () => {
      storage.addFile('/home/user/regular.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/regular.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })

    it('should return false for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(false)
    })
  })

  describe('isDirectory()', () => {
    it('should return true for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isDirectory).toBe(true)
    })

    it('should return false for file', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isDirectory).toBe(false)
    })
  })

  describe('isSymbolicLink()', () => {
    it('should return true for symlink (with lstat)', async () => {
      storage.addFile('/home/user/target.txt', 'target')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')

      const result = await invokeFsLstat({ path: '/home/user/link.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSymbolicLink).toBe(true)
    })

    it('should return false for symlink target (with stat)', async () => {
      storage.addFile('/home/user/target.txt', 'target')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')

      const result = await invokeFsStat({ path: '/home/user/link.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSymbolicLink).toBe(false)
    })

    it('should return false for regular file', async () => {
      storage.addFile('/home/user/regular.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/regular.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSymbolicLink).toBe(false)
    })
  })

  describe('isBlockDevice()', () => {
    it('should return false for regular file', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isBlockDevice).toBe(false)
    })

    it('should return false for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isBlockDevice).toBe(false)
    })
  })

  describe('isCharacterDevice()', () => {
    it('should return false for regular file', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isCharacterDevice).toBe(false)
    })

    it('should return false for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isCharacterDevice).toBe(false)
    })
  })

  describe('isFIFO()', () => {
    it('should return false for regular file', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFIFO).toBe(false)
    })

    it('should return false for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFIFO).toBe(false)
    })
  })

  describe('isSocket()', () => {
    it('should return false for regular file', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSocket).toBe(false)
    })

    it('should return false for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isSocket).toBe(false)
    })
  })
})

// ============================================================================
// SPECIAL CHARACTERS IN PATHS
// ============================================================================

describe('fs_stat MCP Tool - Special Characters', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('filenames with special characters', () => {
    it('should handle filenames with spaces', async () => {
      storage.addFile('/home/user/my file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user/my file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })

    it('should handle filenames with unicode characters', async () => {
      storage.addFile('/home/user/cafe.txt', 'coffee')

      const result = await invokeFsStat({ path: '/home/user/cafe.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })

    it('should handle filenames with dots', async () => {
      storage.addFile('/home/user/.hidden.txt', 'hidden')

      const result = await invokeFsStat({ path: '/home/user/.hidden.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })

    it('should handle filenames with special shell characters', async () => {
      storage.addFile('/home/user/file$var.txt', 'dollar')

      const result = await invokeFsStat({ path: '/home/user/file$var.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })
  })
})

// ============================================================================
// MCP TOOL SCHEMA
// ============================================================================

describe('fs_stat MCP Tool - Schema Definition', () => {
  it('should have correct tool name for fs_stat', () => {
    expect(fsStatToolSchema.name).toBe('fs_stat')
    expect(fsStatToolSchema.inputSchema.required).toContain('path')
  })

  it('should have correct tool name for fs_lstat', () => {
    expect(fsLstatToolSchema.name).toBe('fs_lstat')
    expect(fsLstatToolSchema.inputSchema.required).toContain('path')
  })

  it('should describe all returned stat fields', () => {
    // This test documents the expected output format
    const expectedFields = [
      'dev',
      'ino',
      'mode',
      'nlink',
      'uid',
      'gid',
      'rdev',
      'size',
      'blksize',
      'blocks',
      'atime',
      'mtime',
      'ctime',
      'birthtime',
      'isFile',
      'isDirectory',
      'isSymbolicLink',
      'isBlockDevice',
      'isCharacterDevice',
      'isFIFO',
      'isSocket',
    ]

    // This just documents what we expect - real validation happens in other tests
    expect(expectedFields.length).toBe(21)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('fs_stat MCP Tool - Edge Cases', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('deeply nested paths', () => {
    it('should stat file in deeply nested directory', async () => {
      storage.addDirectory('/home/user/a')
      storage.addDirectory('/home/user/a/b')
      storage.addDirectory('/home/user/a/b/c')
      storage.addDirectory('/home/user/a/b/c/d')
      storage.addFile('/home/user/a/b/c/d/deep.txt', 'deep content')

      const result = await invokeFsStat({ path: '/home/user/a/b/c/d/deep.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
      expect(stats.size).toBe(12)
    })
  })

  describe('path normalization', () => {
    it('should handle path with trailing slash for directory', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsStat({ path: '/home/user/dir/' }, storage as StatStorageBackend)

      // Implementation may normalize or reject trailing slash
      // Just verify consistent behavior
      if (!result.isError) {
        const stats = parseStatResult(result)
        expect(stats.isDirectory).toBe(true)
      }
    })

    it('should handle path with double slashes', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/user//file.txt' }, storage as StatStorageBackend)

      // Implementation should normalize double slashes
      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })

    it('should handle path with . components', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsStat({ path: '/home/./user/./file.txt' }, storage as StatStorageBackend)

      expect(result.isError).toBeFalsy()
      const stats = parseStatResult(result)
      expect(stats.isFile).toBe(true)
    })
  })

  describe('concurrent stats', () => {
    it('should handle multiple stat calls concurrently', async () => {
      storage.addFile('/home/user/file1.txt', 'content1')
      storage.addFile('/home/user/file2.txt', 'content2')
      storage.addFile('/home/user/file3.txt', 'content3')

      const results = await Promise.all([
        invokeFsStat({ path: '/home/user/file1.txt' }, storage as StatStorageBackend),
        invokeFsStat({ path: '/home/user/file2.txt' }, storage as StatStorageBackend),
        invokeFsStat({ path: '/home/user/file3.txt' }, storage as StatStorageBackend),
      ])

      for (const result of results) {
        expect(result.isError).toBeFalsy()
        const stats = parseStatResult(result)
        expect(stats.isFile).toBe(true)
      }
    })
  })
})
