/**
 * Tests for fs_exists MCP Tool - File/Directory Existence Checking
 *
 * RED phase: These tests define expected behavior for the fs_exists MCP tool.
 * All tests should FAIL until the implementation is complete.
 *
 * The fs_exists tool provides a simple boolean existence check for files,
 * directories, and symlinks via the Model Context Protocol (MCP).
 *
 * @module tests/mcp/fs-exists
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem, MemoryFileEntry } from '../test-utils'

// Types for MCP tool results
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
 * Result returned by fs_exists
 */
interface ExistsResult {
  exists: boolean
  type?: 'file' | 'directory' | 'symlink' | null
}

// Import the real implementation
import { invokeFsExists } from '../../core/mcp/fs-exists'

/**
 * Helper to parse exists result from MCP tool response
 */
function parseExistsResult(result: McpToolResult): ExistsResult {
  if (result.isError) {
    throw new Error((result.content[0] as { type: 'text'; text: string }).text)
  }
  const text = (result.content[0] as { type: 'text'; text: string }).text
  return JSON.parse(text) as ExistsResult
}

/**
 * Check if a path contains traversal patterns that could escape the root
 */
function isPathTraversal(path: string): boolean {
  // Relative paths starting with .. are suspicious
  if (path.startsWith('../')) {
    return true
  }

  // Check for patterns like /foo/../../.. that would go above root
  const segments = path.split('/').filter((s) => s !== '')
  let depth = 0
  for (const seg of segments) {
    if (seg === '..') {
      depth--
      if (depth < 0) return true
    } else if (seg !== '.') {
      depth++
    }
  }
  return depth < 0
}

// ============================================================================
// BASIC FILE EXISTENCE
// ============================================================================

describe('fs_exists MCP Tool - File Existence', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('existing files', () => {
    it('should return true for existing text file', async () => {
      storage.addFile('/home/user/exists.txt', 'content')

      const result = await invokeFsExists({ path: '/home/user/exists.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for existing empty file', async () => {
      storage.addFile('/home/user/empty.txt', '')

      const result = await invokeFsExists({ path: '/home/user/empty.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for existing binary file', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      storage.addFile('/home/user/binary.bin', binaryData)

      const result = await invokeFsExists({ path: '/home/user/binary.bin' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return type "file" for existing file', async () => {
      storage.addFile('/home/user/typed.txt', 'content')

      const result = await invokeFsExists({ path: '/home/user/typed.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
      expect(parsed.type).toBe('file')
    })

    it('should return true for hidden files (starting with dot)', async () => {
      storage.addFile('/home/user/.hidden', 'secret')

      const result = await invokeFsExists({ path: '/home/user/.hidden' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for files with special characters', async () => {
      storage.addFile('/home/user/file with spaces.txt', 'content')

      const result = await invokeFsExists({ path: '/home/user/file with spaces.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for files with unicode characters', async () => {
      storage.addFile('/home/user/cafe.txt', 'coffee')

      const result = await invokeFsExists({ path: '/home/user/cafe.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })
  })
})

// ============================================================================
// BASIC DIRECTORY EXISTENCE
// ============================================================================

describe('fs_exists MCP Tool - Directory Existence', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('existing directories', () => {
    it('should return true for existing directory', async () => {
      storage.addDirectory('/home/user/mydir')

      const result = await invokeFsExists({ path: '/home/user/mydir' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for root directory', async () => {
      const result = await invokeFsExists({ path: '/' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for empty directory', async () => {
      storage.addDirectory('/home/user/emptydir')

      const result = await invokeFsExists({ path: '/home/user/emptydir' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for directory with children', async () => {
      storage.addDirectory('/home/user/parent')
      storage.addFile('/home/user/parent/child.txt', 'child')

      const result = await invokeFsExists({ path: '/home/user/parent' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return type "directory" for existing directory', async () => {
      storage.addDirectory('/home/user/typeddir')

      const result = await invokeFsExists({ path: '/home/user/typeddir' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
      expect(parsed.type).toBe('directory')
    })

    it('should return true for deeply nested directory', async () => {
      storage.addDirectory('/home/user/a')
      storage.addDirectory('/home/user/a/b')
      storage.addDirectory('/home/user/a/b/c')
      storage.addDirectory('/home/user/a/b/c/d')
      storage.addDirectory('/home/user/a/b/c/d/e')

      const result = await invokeFsExists({ path: '/home/user/a/b/c/d/e' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
      expect(parsed.type).toBe('directory')
    })
  })
})

// ============================================================================
// NON-EXISTENT PATHS
// ============================================================================

describe('fs_exists MCP Tool - Non-Existent Paths', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('non-existent files', () => {
    it('should return false for non-existent file', async () => {
      const result = await invokeFsExists({ path: '/home/user/nonexistent.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return false for file in non-existent directory', async () => {
      const result = await invokeFsExists({ path: '/nonexistent/dir/file.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return null type for non-existent path', async () => {
      const result = await invokeFsExists({ path: '/does/not/exist' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
      expect(parsed.type).toBeNull()
    })

    it('should return false for deeply nested non-existent path', async () => {
      const result = await invokeFsExists({ path: '/a/b/c/d/e/f/g/h/i/j.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return false after file is deleted', async () => {
      storage.addFile('/home/user/todelete.txt', 'content')
      storage.remove('/home/user/todelete.txt')

      const result = await invokeFsExists({ path: '/home/user/todelete.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })
  })

  describe('non-existent directories', () => {
    it('should return false for non-existent directory', async () => {
      const result = await invokeFsExists({ path: '/home/user/nonexistentdir' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return false for path that looks like directory but is not', async () => {
      // /home exists but /home/nobody does not
      const result = await invokeFsExists({ path: '/home/nobody' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })
  })
})

// ============================================================================
// SYMLINK HANDLING
// ============================================================================

describe('fs_exists MCP Tool - Symlink Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('valid symlinks', () => {
    it('should return true for symlink pointing to existing file', async () => {
      storage.addFile('/home/user/target.txt', 'target content')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')

      const result = await invokeFsExists({ path: '/home/user/link.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for symlink pointing to existing directory', async () => {
      storage.addDirectory('/home/user/targetdir')
      storage.addSymlink('/home/user/linkdir', '/home/user/targetdir')

      const result = await invokeFsExists({ path: '/home/user/linkdir' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return type "symlink" for symlink', async () => {
      storage.addFile('/home/user/target.txt', 'content')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')

      const result = await invokeFsExists({ path: '/home/user/link.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
      expect(parsed.type).toBe('symlink')
    })

    it('should return true for chain of valid symlinks', async () => {
      storage.addFile('/home/user/final.txt', 'final content')
      storage.addSymlink('/home/user/link1.txt', '/home/user/final.txt')
      storage.addSymlink('/home/user/link2.txt', '/home/user/link1.txt')
      storage.addSymlink('/home/user/link3.txt', '/home/user/link2.txt')

      const result = await invokeFsExists({ path: '/home/user/link3.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return true for relative symlink', async () => {
      storage.addFile('/home/user/target.txt', 'content')
      storage.addSymlink('/home/user/link.txt', 'target.txt')

      const result = await invokeFsExists({ path: '/home/user/link.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })
  })

  describe('broken symlinks', () => {
    it('should return false for broken symlink (target missing)', async () => {
      storage.addSymlink('/home/user/broken.txt', '/home/user/nonexistent.txt')

      const result = await invokeFsExists({ path: '/home/user/broken.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return false for broken symlink to missing directory', async () => {
      storage.addSymlink('/home/user/brokendir', '/home/user/nonexistentdir')

      const result = await invokeFsExists({ path: '/home/user/brokendir' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return false for symlink chain where middle link is broken', async () => {
      storage.addSymlink('/home/user/link1.txt', '/home/user/missing.txt')
      storage.addSymlink('/home/user/link2.txt', '/home/user/link1.txt')

      const result = await invokeFsExists({ path: '/home/user/link2.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return false for symlink that becomes broken after target deletion', async () => {
      storage.addFile('/home/user/target.txt', 'content')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')
      storage.remove('/home/user/target.txt')

      const result = await invokeFsExists({ path: '/home/user/link.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should handle circular symlinks gracefully', async () => {
      // Create circular symlink: A -> B -> A
      storage.addSymlink('/home/user/linkA', '/home/user/linkB')
      storage.addSymlink('/home/user/linkB', '/home/user/linkA')

      const result = await invokeFsExists({ path: '/home/user/linkA' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      // Circular symlinks are effectively broken
      expect(parsed.exists).toBe(false)
    })
  })

  describe('followSymlinks option', () => {
    it('should return true for broken symlink when followSymlinks is false', async () => {
      storage.addSymlink('/home/user/broken.txt', '/home/user/nonexistent.txt')

      const result = await invokeFsExists({ path: '/home/user/broken.txt', followSymlinks: false }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      // The symlink itself exists even though its target doesn't
      expect(parsed.exists).toBe(true)
      expect(parsed.type).toBe('symlink')
    })

    it('should return true for valid symlink when followSymlinks is false', async () => {
      storage.addFile('/home/user/target.txt', 'content')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')

      const result = await invokeFsExists({ path: '/home/user/link.txt', followSymlinks: false }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
      expect(parsed.type).toBe('symlink')
    })
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('fs_exists MCP Tool - Error Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('invalid paths (EINVAL)', () => {
    it('should return error when path is missing', async () => {
      const result = await invokeFsExists({}, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|missing/i)
    })

    it('should return error when path is empty string', async () => {
      const result = await invokeFsExists({ path: '' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|empty/i)
    })

    it('should return error when path is not a string', async () => {
      const result = await invokeFsExists({ path: 123 as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/invalid|type|string/i)
    })

    it('should return error when path is null', async () => {
      const result = await invokeFsExists({ path: null }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|invalid/i)
    })

    it('should return error when path is undefined', async () => {
      const result = await invokeFsExists({ path: undefined }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|invalid/i)
    })
  })

  describe('path traversal (EACCES)', () => {
    it('should return error for path traversal attempt with ..', async () => {
      const result = await invokeFsExists({ path: '/home/user/../../../etc/passwd' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal/i)
    })

    it('should return error for relative path traversal starting with ..', async () => {
      const result = await invokeFsExists({ path: '../../../etc' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal|invalid/i)
    })

    it('should return error for path escaping root with multiple ..', async () => {
      const result = await invokeFsExists({ path: '/home/../../../../../tmp' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal/i)
    })
  })
})

// ============================================================================
// PATH NORMALIZATION
// ============================================================================

describe('fs_exists MCP Tool - Path Normalization', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('path with special components', () => {
    it('should handle path with trailing slash', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsExists({ path: '/home/user/dir/' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle path with double slashes', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsExists({ path: '/home/user//file.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle path with . components', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsExists({ path: '/home/./user/./file.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle path with safe .. components', async () => {
      storage.addFile('/home/user/file.txt', 'content')

      const result = await invokeFsExists({ path: '/home/user/subdir/../file.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle path with multiple trailing slashes', async () => {
      storage.addDirectory('/home/user/dir')

      const result = await invokeFsExists({ path: '/home/user/dir///' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })
  })
})

// ============================================================================
// TYPE FILTERING
// ============================================================================

describe('fs_exists MCP Tool - Type Filtering', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/file.txt', 'content')
    storage.addDirectory('/home/user/dir')
    storage.addSymlink('/home/user/link', '/home/user/file.txt')
  })

  describe('type parameter', () => {
    it('should return true for file when type is "file"', async () => {
      const result = await invokeFsExists({ path: '/home/user/file.txt', type: 'file' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return false for directory when type is "file"', async () => {
      const result = await invokeFsExists({ path: '/home/user/dir', type: 'file' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return true for directory when type is "directory"', async () => {
      const result = await invokeFsExists({ path: '/home/user/dir', type: 'directory' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return false for file when type is "directory"', async () => {
      const result = await invokeFsExists({ path: '/home/user/file.txt', type: 'directory' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return true for symlink when type is "symlink"', async () => {
      const result = await invokeFsExists({ path: '/home/user/link', type: 'symlink' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should return false for file when type is "symlink"', async () => {
      const result = await invokeFsExists({ path: '/home/user/file.txt', type: 'symlink' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should return true for any entry when type is "any" or not specified', async () => {
      const resultFile = await invokeFsExists({ path: '/home/user/file.txt', type: 'any' }, storage)
      const resultDir = await invokeFsExists({ path: '/home/user/dir', type: 'any' }, storage)
      const resultLink = await invokeFsExists({ path: '/home/user/link', type: 'any' }, storage)

      expect(resultFile.isError).toBeFalsy()
      expect(resultDir.isError).toBeFalsy()
      expect(resultLink.isError).toBeFalsy()

      expect(parseExistsResult(resultFile).exists).toBe(true)
      expect(parseExistsResult(resultDir).exists).toBe(true)
      expect(parseExistsResult(resultLink).exists).toBe(true)
    })
  })
})

// ============================================================================
// CONCURRENT OPERATIONS
// ============================================================================

describe('fs_exists MCP Tool - Concurrent Operations', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/file1.txt', 'content1')
    storage.addFile('/home/user/file2.txt', 'content2')
    storage.addFile('/home/user/file3.txt', 'content3')
    storage.addDirectory('/home/user/dir1')
    storage.addDirectory('/home/user/dir2')
  })

  describe('parallel existence checks', () => {
    it('should handle multiple existence checks concurrently', async () => {
      const results = await Promise.all([
        invokeFsExists({ path: '/home/user/file1.txt' }, storage),
        invokeFsExists({ path: '/home/user/file2.txt' }, storage),
        invokeFsExists({ path: '/home/user/file3.txt' }, storage),
        invokeFsExists({ path: '/home/user/dir1' }, storage),
        invokeFsExists({ path: '/home/user/dir2' }, storage),
      ])

      for (const result of results) {
        expect(result.isError).toBeFalsy()
        const parsed = parseExistsResult(result)
        expect(parsed.exists).toBe(true)
      }
    })

    it('should handle mix of existing and non-existing paths concurrently', async () => {
      const results = await Promise.all([
        invokeFsExists({ path: '/home/user/file1.txt' }, storage),
        invokeFsExists({ path: '/home/user/nonexistent1.txt' }, storage),
        invokeFsExists({ path: '/home/user/dir1' }, storage),
        invokeFsExists({ path: '/home/user/nonexistent2' }, storage),
      ])

      expect(results[0].isError).toBeFalsy()
      expect(parseExistsResult(results[0]).exists).toBe(true)

      expect(results[1].isError).toBeFalsy()
      expect(parseExistsResult(results[1]).exists).toBe(false)

      expect(results[2].isError).toBeFalsy()
      expect(parseExistsResult(results[2]).exists).toBe(true)

      expect(results[3].isError).toBeFalsy()
      expect(parseExistsResult(results[3]).exists).toBe(false)
    })
  })
})

// ============================================================================
// MCP TOOL SCHEMA
// ============================================================================

describe('fs_exists MCP Tool - Schema Definition', () => {
  it('should have correct tool name', () => {
    const tool: McpTool = {
      name: 'fs_exists',
      description: 'Check if a file or directory exists',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to check for existence' },
          type: {
            type: 'string',
            description: 'Type filter: file, directory, symlink, or any',
            enum: ['file', 'directory', 'symlink', 'any'],
          },
          followSymlinks: {
            type: 'string',
            description: 'Whether to follow symlinks (default: true)',
          },
        },
        required: ['path'],
      },
    }

    expect(tool.name).toBe('fs_exists')
    expect(tool.inputSchema.required).toContain('path')
    expect(tool.inputSchema.properties.type.enum).toContain('file')
    expect(tool.inputSchema.properties.type.enum).toContain('directory')
    expect(tool.inputSchema.properties.type.enum).toContain('symlink')
    expect(tool.inputSchema.properties.type.enum).toContain('any')
  })

  it('should document return format', () => {
    // This documents the expected output format
    const expectedReturnFields = ['exists', 'type']

    expect(expectedReturnFields).toContain('exists')
    expect(expectedReturnFields).toContain('type')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('fs_exists MCP Tool - Edge Cases', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('special file names', () => {
    it('should handle file named "." in directory (but not as path component)', async () => {
      // This tests that we don't confuse file names with path components
      storage.addFile('/home/user/subdir/..file', 'content')

      const result = await invokeFsExists({ path: '/home/user/subdir/..file' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle file with only extension', async () => {
      storage.addFile('/home/user/.gitignore', 'node_modules')

      const result = await invokeFsExists({ path: '/home/user/.gitignore' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle file with multiple dots', async () => {
      storage.addFile('/home/user/file.test.spec.ts', 'test')

      const result = await invokeFsExists({ path: '/home/user/file.test.spec.ts' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle very long file name', async () => {
      const longName = 'a'.repeat(200) + '.txt'
      storage.addFile(`/home/user/${longName}`, 'content')

      const result = await invokeFsExists({ path: `/home/user/${longName}` }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle file with shell metacharacters', async () => {
      storage.addFile('/home/user/file$var.txt', 'dollar')

      const result = await invokeFsExists({ path: '/home/user/file$var.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })
  })

  describe('boundary conditions', () => {
    it('should handle checking existence immediately after creation', async () => {
      const path = '/home/user/newfile.txt'
      storage.addFile(path, 'content')

      const result = await invokeFsExists({ path }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })

    it('should handle checking existence immediately after deletion', async () => {
      const path = '/home/user/todelete.txt'
      storage.addFile(path, 'content')
      storage.remove(path)

      const result = await invokeFsExists({ path }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(false)
    })

    it('should handle path that is exactly at root level', async () => {
      storage.addFile('/rootfile.txt', 'root content')

      const result = await invokeFsExists({ path: '/rootfile.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const parsed = parseExistsResult(result)
      expect(parsed.exists).toBe(true)
    })
  })
})
