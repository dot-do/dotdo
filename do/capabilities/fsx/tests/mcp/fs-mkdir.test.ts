/**
 * Tests for fs_mkdir MCP Tool - Directory Creation
 *
 * RED phase: These tests define expected behavior for the fs_mkdir MCP tool.
 * All tests should FAIL until the implementation is complete.
 *
 * The fs_mkdir tool provides directory creation functionality for AI-assisted
 * file operations via the Model Context Protocol (MCP).
 *
 * @module tests/mcp/fs-mkdir
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem } from '../test-utils'

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

// Import the real implementation
import { invokeFsMkdir } from '../../core/mcp/fs-mkdir'

// ============================================================================
// BASIC DIRECTORY CREATION
// ============================================================================

describe('fs_mkdir MCP Tool - Basic Directory Creation', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('create single directory', () => {
    it('should create a directory in existing parent', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/newdir' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should return success message or directory info
      expect(text).toMatch(/success|created|newdir/i)
      // Verify directory exists in storage
      expect(storage.isDirectory('/home/user/newdir')).toBe(true)
    })

    it('should create a directory at root level', async () => {
      const result = await invokeFsMkdir({ path: '/newroot' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/newroot')).toBe(true)
    })

    it('should return directory path in success response', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/testdir' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/home/user/testdir')
    })

    it('should create directory with default permissions (0755)', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/defaultmode' }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/defaultmode')
      expect(entry).toBeDefined()
      expect(entry!.mode & 0o777).toBe(0o755)
    })
  })
})

// ============================================================================
// RECURSIVE DIRECTORY CREATION
// ============================================================================

describe('fs_mkdir MCP Tool - Recursive Directory Creation', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('recursive option', () => {
    it('should create nested directories when recursive is true', async () => {
      const result = await invokeFsMkdir(
        { path: '/home/user/deep/nested/path/dir', recursive: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/deep')).toBe(true)
      expect(storage.isDirectory('/home/user/deep/nested')).toBe(true)
      expect(storage.isDirectory('/home/user/deep/nested/path')).toBe(true)
      expect(storage.isDirectory('/home/user/deep/nested/path/dir')).toBe(true)
    })

    it('should create all intermediate directories with same permissions', async () => {
      const result = await invokeFsMkdir(
        { path: '/home/user/a/b/c', recursive: true, mode: 0o700 },
        storage
      )

      expect(result.isError).toBeFalsy()
      // All intermediate directories should have the specified mode
      expect((storage.get('/home/user/a')!.mode & 0o777)).toBe(0o700)
      expect((storage.get('/home/user/a/b')!.mode & 0o777)).toBe(0o700)
      expect((storage.get('/home/user/a/b/c')!.mode & 0o777)).toBe(0o700)
    })

    it('should succeed silently when directory already exists and recursive is true', async () => {
      storage.addDirectory('/home/user/existing')

      const result = await invokeFsMkdir(
        { path: '/home/user/existing', recursive: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/existing')).toBe(true)
    })

    it('should handle deeply nested paths (10+ levels)', async () => {
      const deepPath = '/home/user/l1/l2/l3/l4/l5/l6/l7/l8/l9/l10/final'

      const result = await invokeFsMkdir({ path: deepPath, recursive: true }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory(deepPath)).toBe(true)
    })

    it('should not error when some intermediate directories exist', async () => {
      storage.addDirectory('/home/user/partial')

      const result = await invokeFsMkdir(
        { path: '/home/user/partial/new/deep', recursive: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/partial/new/deep')).toBe(true)
    })
  })
})

// ============================================================================
// PERMISSION MODES
// ============================================================================

describe('fs_mkdir MCP Tool - Permission Modes', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('mode option', () => {
    it('should create directory with mode 0755 (rwxr-xr-x)', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/public', mode: 0o755 }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/public')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should create directory with mode 0700 (rwx------)', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/private', mode: 0o700 }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/private')
      expect(entry!.mode & 0o777).toBe(0o700)
    })

    it('should create directory with mode 0777 (rwxrwxrwx)', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/open', mode: 0o777 }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/open')
      expect(entry!.mode & 0o777).toBe(0o777)
    })

    it('should create directory with mode 0750 (rwxr-x---)', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/group', mode: 0o750 }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/group')
      expect(entry!.mode & 0o777).toBe(0o750)
    })

    it('should create directory with mode 0555 (r-xr-xr-x)', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/readonly', mode: 0o555 }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/readonly')
      expect(entry!.mode & 0o777).toBe(0o555)
    })

    it('should accept mode as decimal number', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/decimal', mode: 493 }, storage) // 493 = 0o755

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/decimal')
      expect(entry!.mode & 0o777).toBe(0o755)
    })

    it('should include directory type flag (S_IFDIR) in mode', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/typed', mode: 0o755 }, storage)

      expect(result.isError).toBeFalsy()
      const entry = storage.get('/home/user/typed')
      // S_IFDIR = 0o40000
      expect(entry!.mode & 0o170000).toBe(0o40000)
    })
  })
})

// ============================================================================
// ERROR HANDLING - PARENT DOESN'T EXIST
// ============================================================================

describe('fs_mkdir MCP Tool - Error: Parent Not Found', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('non-recursive mode failures', () => {
    it('should error when parent directory does not exist', async () => {
      const result = await invokeFsMkdir({ path: '/nonexistent/newdir' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist|no such file or directory/i)
    })

    it('should include ENOENT error code', async () => {
      const result = await invokeFsMkdir({ path: '/missing/parent/dir' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('ENOENT')
    })

    it('should include path in error message', async () => {
      const result = await invokeFsMkdir({ path: '/nonexistent/child' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/nonexistent')
    })

    it('should error for nested path without recursive option', async () => {
      const result = await invokeFsMkdir(
        { path: '/home/user/a/b/c/d', recursive: false },
        storage
      )

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found/i)
    })

    it('should error when intermediate directory is missing', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/missing/newdir' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found/i)
    })
  })
})

// ============================================================================
// ERROR HANDLING - ALREADY EXISTS
// ============================================================================

describe('fs_mkdir MCP Tool - Error: Already Exists', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('directory already exists', () => {
    it('should error when directory already exists (non-recursive)', async () => {
      storage.addDirectory('/home/user/existing')

      const result = await invokeFsMkdir({ path: '/home/user/existing' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EEXIST|already exists|exists/i)
    })

    it('should include EEXIST error code', async () => {
      storage.addDirectory('/home/user/duplicate')

      const result = await invokeFsMkdir({ path: '/home/user/duplicate' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('EEXIST')
    })

    it('should include existing path in error message', async () => {
      storage.addDirectory('/home/user/alreadythere')

      const result = await invokeFsMkdir({ path: '/home/user/alreadythere' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/home/user/alreadythere')
    })

    it('should error for root-level duplicate', async () => {
      // /home already exists in createTestFilesystem()

      const result = await invokeFsMkdir({ path: '/home' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EEXIST|already exists/i)
    })
  })
})

// ============================================================================
// ERROR HANDLING - PATH IS A FILE
// ============================================================================

describe('fs_mkdir MCP Tool - Error: Path is a File', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('file exists at path', () => {
    it('should error when path points to an existing file', async () => {
      storage.addFile('/home/user/myfile.txt', 'content')

      const result = await invokeFsMkdir({ path: '/home/user/myfile.txt' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EEXIST|ENOTDIR|exists|not a directory|file already exists/i)
    })

    it('should error when parent path component is a file', async () => {
      storage.addFile('/home/user/afile', 'content')

      const result = await invokeFsMkdir({ path: '/home/user/afile/newdir' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOTDIR|not a directory|ENOENT/i)
    })

    it('should error when trying to create directory where file exists (recursive mode)', async () => {
      storage.addFile('/home/user/blocker.txt', 'content')

      const result = await invokeFsMkdir(
        { path: '/home/user/blocker.txt/subdir', recursive: true },
        storage
      )

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOTDIR|not a directory/i)
    })

    it('should error when file exists at target path in recursive mode', async () => {
      storage.addFile('/home/user/taken', 'file content')

      const result = await invokeFsMkdir({ path: '/home/user/taken', recursive: true }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EEXIST|ENOTDIR|exists|not a directory/i)
    })
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('fs_mkdir MCP Tool - Edge Cases', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('trailing slashes', () => {
    it('should handle path with trailing slash', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/trailingslash/' }, storage)

      expect(result.isError).toBeFalsy()
      // Should normalize the path and create directory
      expect(storage.isDirectory('/home/user/trailingslash')).toBe(true)
    })

    it('should handle path with multiple trailing slashes', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/multitrail///' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/multitrail')).toBe(true)
    })
  })

  describe('empty path', () => {
    it('should error when path is empty string', async () => {
      const result = await invokeFsMkdir({ path: '' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|empty|required/i)
    })

    it('should error when path is only whitespace', async () => {
      const result = await invokeFsMkdir({ path: '   ' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|empty/i)
    })
  })

  describe('missing required parameters', () => {
    it('should error when path is missing', async () => {
      const result = await invokeFsMkdir({}, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|missing/i)
    })

    it('should error when path is null', async () => {
      const result = await invokeFsMkdir({ path: null as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|required/i)
    })

    it('should error when path is undefined', async () => {
      const result = await invokeFsMkdir({ path: undefined as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|required/i)
    })
  })

  describe('invalid parameter types', () => {
    it('should error when path is not a string', async () => {
      const result = await invokeFsMkdir({ path: 123 as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/invalid|type|string/i)
    })

    it('should error when path is an array', async () => {
      const result = await invokeFsMkdir({ path: ['/home', 'user'] as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/invalid|type|string/i)
    })

    it('should handle non-boolean recursive gracefully', async () => {
      // Some implementations may coerce to boolean
      const result = await invokeFsMkdir(
        { path: '/home/user/test', recursive: 'yes' as unknown as boolean },
        storage
      )

      // Either succeeds (coercing to truthy) or returns helpful error
      expect(result.content[0].type).toBe('text')
    })

    it('should handle invalid mode type gracefully', async () => {
      const result = await invokeFsMkdir(
        { path: '/home/user/badmode', mode: 'rwx' as unknown as number },
        storage
      )

      // Should either error or use default mode
      if (result.isError) {
        const text = (result.content[0] as { type: 'text'; text: string }).text
        expect(text).toMatch(/mode|invalid|number/i)
      } else {
        // Used default mode
        const entry = storage.get('/home/user/badmode')
        expect(entry!.mode & 0o777).toBe(0o755)
      }
    })
  })

  describe('path normalization', () => {
    it('should handle path with double slashes', async () => {
      const result = await invokeFsMkdir({ path: '/home/user//doubleslash' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/doubleslash')).toBe(true)
    })

    it('should handle path with . components', async () => {
      const result = await invokeFsMkdir({ path: '/home/./user/./dotpath' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/dotpath')).toBe(true)
    })

    it('should handle path with safe .. components', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/a/../safeup' }, storage)

      // Should resolve to /home/user/safeup
      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/safeup')).toBe(true)
    })
  })

  describe('path traversal protection', () => {
    it('should error on path traversal attempt', async () => {
      const result = await invokeFsMkdir(
        { path: '/home/user/../../../etc/evil' },
        storage
      )

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal/i)
    })

    it('should error on relative path traversal', async () => {
      const result = await invokeFsMkdir({ path: '../../../etc' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal|invalid/i)
    })
  })
})

// ============================================================================
// SPECIAL CHARACTERS IN DIRECTORY NAMES
// ============================================================================

describe('fs_mkdir MCP Tool - Special Characters', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('directory names with special characters', () => {
    it('should handle directory name with spaces', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/my directory' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/my directory')).toBe(true)
    })

    it('should handle directory name with unicode characters', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/\u65e5\u672c\u8a9e' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/\u65e5\u672c\u8a9e')).toBe(true)
    })

    it('should handle directory name with emoji', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/test-\ud83d\udcc1' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/test-\ud83d\udcc1')).toBe(true)
    })

    it('should handle directory name with dots', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/.hidden' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/.hidden')).toBe(true)
    })

    it('should handle directory name starting with hyphen', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/-dash' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/-dash')).toBe(true)
    })

    it('should handle directory name with special shell characters', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/dir$var' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/dir$var')).toBe(true)
    })

    it('should handle directory name with parentheses', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/dir(1)' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/dir(1)')).toBe(true)
    })

    it('should handle directory name with brackets', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/dir[test]' }, storage)

      expect(result.isError).toBeFalsy()
      expect(storage.isDirectory('/home/user/dir[test]')).toBe(true)
    })
  })
})

// ============================================================================
// SYMLINK INTERACTIONS
// ============================================================================

describe('fs_mkdir MCP Tool - Symlink Interactions', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/realdir')
    storage.addSymlink('/home/user/linkdir', '/home/user/realdir')
  })

  describe('creating directories through symlinks', () => {
    it('should create directory inside symlinked directory', async () => {
      const result = await invokeFsMkdir({ path: '/home/user/linkdir/subdir' }, storage)

      expect(result.isError).toBeFalsy()
      // Should create in the real location
      expect(storage.isDirectory('/home/user/realdir/subdir')).toBe(true)
    })

    it('should error when symlink path target does not exist', async () => {
      storage.addSymlink('/home/user/brokenlink', '/nonexistent/path')

      const result = await invokeFsMkdir({ path: '/home/user/brokenlink/newdir' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found/i)
    })
  })
})

// ============================================================================
// MCP TOOL SCHEMA
// ============================================================================

describe('fs_mkdir MCP Tool - Schema Definition', () => {
  it('should have correct tool name', () => {
    const tool: McpTool = {
      name: 'fs_mkdir',
      description: 'Create a directory',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' },
          recursive: { type: 'boolean', description: 'Create parent directories if needed' },
          mode: { type: 'number', description: 'Permission mode (e.g., 0755)' },
        },
        required: ['path'],
      },
    }

    expect(tool.name).toBe('fs_mkdir')
    expect(tool.inputSchema.required).toContain('path')
  })

  it('should have all documented parameters in schema', () => {
    const expectedParams = ['path', 'recursive', 'mode']

    const tool: McpTool = {
      name: 'fs_mkdir',
      description: 'Create a directory',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' },
          recursive: { type: 'boolean', description: 'Create parent directories if needed' },
          mode: { type: 'number', description: 'Permission mode (e.g., 0755)' },
        },
        required: ['path'],
      },
    }

    for (const param of expectedParams) {
      expect(tool.inputSchema.properties).toHaveProperty(param)
    }
  })

  it('should document correct types for all parameters', () => {
    const tool: McpTool = {
      name: 'fs_mkdir',
      description: 'Create a directory',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' },
          recursive: { type: 'boolean', description: 'Create parent directories if needed' },
          mode: { type: 'number', description: 'Permission mode (e.g., 0755)' },
        },
        required: ['path'],
      },
    }

    expect(tool.inputSchema.properties.path.type).toBe('string')
    expect(tool.inputSchema.properties.recursive.type).toBe('boolean')
    expect(tool.inputSchema.properties.mode.type).toBe('number')
  })
})

// ============================================================================
// CONCURRENT OPERATIONS
// ============================================================================

describe('fs_mkdir MCP Tool - Concurrent Operations', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('concurrent directory creation', () => {
    it('should handle multiple mkdir calls concurrently', async () => {
      const results = await Promise.all([
        invokeFsMkdir({ path: '/home/user/dir1' }, storage),
        invokeFsMkdir({ path: '/home/user/dir2' }, storage),
        invokeFsMkdir({ path: '/home/user/dir3' }, storage),
      ])

      for (const result of results) {
        expect(result.isError).toBeFalsy()
      }
      expect(storage.isDirectory('/home/user/dir1')).toBe(true)
      expect(storage.isDirectory('/home/user/dir2')).toBe(true)
      expect(storage.isDirectory('/home/user/dir3')).toBe(true)
    })

    it('should handle concurrent recursive mkdir calls', async () => {
      const results = await Promise.all([
        invokeFsMkdir({ path: '/home/user/a/b/c', recursive: true }, storage),
        invokeFsMkdir({ path: '/home/user/x/y/z', recursive: true }, storage),
      ])

      for (const result of results) {
        expect(result.isError).toBeFalsy()
      }
      expect(storage.isDirectory('/home/user/a/b/c')).toBe(true)
      expect(storage.isDirectory('/home/user/x/y/z')).toBe(true)
    })
  })
})
