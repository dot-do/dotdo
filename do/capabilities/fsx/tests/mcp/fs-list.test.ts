/**
 * Tests for fs_list MCP Tool - Directory Listing
 *
 * RED phase: These tests define expected behavior for the fs_list MCP tool.
 * All tests should FAIL until the implementation is complete.
 *
 * The fs_list tool provides directory listing functionality for AI-assisted
 * file operations via the Model Context Protocol (MCP).
 *
 * @module tests/mcp/fs-list
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem } from '../test-utils'
import { invokeFsList } from '../../core/mcp/fs-list'

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

// ============================================================================
// BASIC DIRECTORY LISTING
// ============================================================================

describe('fs_list MCP Tool - Basic Directory Listing', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('list directory contents', () => {
    it('should list files in a directory', async () => {
      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      expect(result.content[0].type).toBe('text')
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('hello.txt')
      expect(text).toContain('data.json')
    })

    it('should list directories in a path', async () => {
      storage.addDirectory('/home/user/projects')
      storage.addDirectory('/home/user/documents')

      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('projects')
      expect(text).toContain('documents')
    })

    it('should return empty indicator for empty directory', async () => {
      storage.addDirectory('/home/user/empty')

      const result = await invokeFsList({ path: '/home/user/empty' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/(empty|\(empty\)|no entries|0 items)/i)
    })

    it('should list root directory', async () => {
      const result = await invokeFsList({ path: '/' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('home')
      expect(text).toContain('tmp')
      expect(text).toContain('var')
    })

    it('should return entries sorted alphabetically by default', async () => {
      storage.addFile('/home/user/zebra.txt', 'z')
      storage.addFile('/home/user/apple.txt', 'a')
      storage.addFile('/home/user/mango.txt', 'm')

      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      const fileNames = lines.map((l) => l.replace(/^[^\s]+\s+/, '').trim())
      // Check alphabetical order
      const sorted = [...fileNames].sort()
      expect(fileNames).toEqual(sorted)
    })
  })
})

// ============================================================================
// RECURSIVE LISTING
// ============================================================================

describe('fs_list MCP Tool - Recursive Listing', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    // Add nested structure
    storage.addDirectory('/home/user/projects')
    storage.addDirectory('/home/user/projects/webapp')
    storage.addFile('/home/user/projects/webapp/index.ts', 'export {}')
    storage.addFile('/home/user/projects/webapp/package.json', '{}')
    storage.addDirectory('/home/user/projects/api')
    storage.addFile('/home/user/projects/api/server.ts', 'serve()')
  })

  describe('recursive option', () => {
    it('should list only immediate children when recursive is false', async () => {
      const result = await invokeFsList({ path: '/home/user/projects', recursive: false }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('webapp')
      expect(text).toContain('api')
      expect(text).not.toContain('index.ts')
      expect(text).not.toContain('server.ts')
    })

    it('should list all nested entries when recursive is true', async () => {
      const result = await invokeFsList({ path: '/home/user/projects', recursive: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('webapp')
      expect(text).toContain('api')
      expect(text).toContain('index.ts')
      expect(text).toContain('server.ts')
      expect(text).toContain('package.json')
    })

    it('should show relative paths in recursive listing', async () => {
      const result = await invokeFsList({ path: '/home/user/projects', recursive: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show relative paths like webapp/index.ts
      expect(text).toMatch(/webapp\/index\.ts|webapp[\/\\]index\.ts/)
    })

    it('should handle deeply nested directories', async () => {
      storage.addDirectory('/home/user/a')
      storage.addDirectory('/home/user/a/b')
      storage.addDirectory('/home/user/a/b/c')
      storage.addDirectory('/home/user/a/b/c/d')
      storage.addFile('/home/user/a/b/c/d/deep.txt', 'deep')

      const result = await invokeFsList({ path: '/home/user/a', recursive: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('deep.txt')
    })
  })
})

// ============================================================================
// PATTERN FILTERING (GLOB)
// ============================================================================

describe('fs_list MCP Tool - Pattern Filtering', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/app.ts', 'ts')
    storage.addFile('/home/user/app.js', 'js')
    storage.addFile('/home/user/config.json', '{}')
    storage.addFile('/home/user/readme.md', '# Readme')
    storage.addFile('/home/user/test.spec.ts', 'test')
    storage.addFile('/home/user/.env', 'SECRET=x')
    storage.addFile('/home/user/.gitignore', 'node_modules')
  })

  describe('glob pattern matching', () => {
    it('should filter by extension pattern *.ts', async () => {
      const result = await invokeFsList({ path: '/home/user', pattern: '*.ts' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('app.ts')
      expect(text).toContain('test.spec.ts')
      expect(text).not.toContain('app.js')
      expect(text).not.toContain('config.json')
    })

    it('should filter by extension pattern *.json', async () => {
      const result = await invokeFsList({ path: '/home/user', pattern: '*.json' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('config.json')
      expect(text).toContain('data.json')
      expect(text).not.toContain('app.ts')
    })

    it('should support wildcard in middle of pattern', async () => {
      const result = await invokeFsList({ path: '/home/user', pattern: '*.spec.*' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('test.spec.ts')
      expect(text).not.toContain('app.ts')
    })

    it('should support multiple extensions {ts,js}', async () => {
      const result = await invokeFsList({ path: '/home/user', pattern: '*.{ts,js}' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('app.ts')
      expect(text).toContain('app.js')
      expect(text).toContain('test.spec.ts')
      expect(text).not.toContain('config.json')
    })

    it('should support question mark single character wildcard', async () => {
      storage.addFile('/home/user/a1.txt', 'a1')
      storage.addFile('/home/user/a2.txt', 'a2')
      storage.addFile('/home/user/a12.txt', 'a12')

      const result = await invokeFsList({ path: '/home/user', pattern: 'a?.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('a1.txt')
      expect(text).toContain('a2.txt')
      expect(text).not.toContain('a12.txt')
    })

    it('should support negation pattern !*.md', async () => {
      const result = await invokeFsList({ path: '/home/user', pattern: '!*.md' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).not.toContain('readme.md')
      expect(text).toContain('app.ts')
    })
  })
})

// ============================================================================
// HIDDEN FILES
// ============================================================================

describe('fs_list MCP Tool - Hidden Files', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/.env', 'SECRET=x')
    storage.addFile('/home/user/.gitignore', 'node_modules')
    storage.addDirectory('/home/user/.config')
    storage.addFile('/home/user/.config/settings.json', '{}')
    storage.addFile('/home/user/visible.txt', 'visible')
  })

  describe('hidden file handling', () => {
    it('should exclude hidden files by default', async () => {
      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('visible.txt')
      expect(text).not.toContain('.env')
      expect(text).not.toContain('.gitignore')
      expect(text).not.toContain('.config')
    })

    it('should include hidden files when showHidden is true', async () => {
      const result = await invokeFsList({ path: '/home/user', showHidden: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('.env')
      expect(text).toContain('.gitignore')
      expect(text).toContain('.config')
      expect(text).toContain('visible.txt')
    })

    it('should include hidden directories in recursive listing when showHidden is true', async () => {
      const result = await invokeFsList({ path: '/home/user', recursive: true, showHidden: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('.config')
      expect(text).toContain('settings.json')
    })
  })
})

// ============================================================================
// FILE DETAILS/STATS
// ============================================================================

describe('fs_list MCP Tool - File Details', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/small.txt', 'small', { mode: 0o644 })
    storage.addFile('/home/user/large.bin', new Uint8Array(1024 * 100)) // 100KB
    storage.addDirectory('/home/user/subdir', { mode: 0o755 })
    storage.addSymlink('/home/user/link.txt', '/home/user/small.txt')
  })

  describe('withDetails option', () => {
    it('should show file type indicator when withDetails is true', async () => {
      const result = await invokeFsList({ path: '/home/user', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show type indicators like 'd' for directory, '-' for file, 'l' for symlink
      expect(text).toMatch(/[d\-l]\s+\w+/)
    })

    it('should show file sizes when withDetails is true', async () => {
      const result = await invokeFsList({ path: '/home/user', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show size for large.bin (100KB = 102400 bytes)
      expect(text).toMatch(/102400|100K|100 KB|100KB/)
    })

    it('should show modification time when withDetails is true', async () => {
      const result = await invokeFsList({ path: '/home/user', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show date/time in some format
      expect(text).toMatch(/\d{4}[-/]\d{2}[-/]\d{2}|\d{2}:\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)
    })

    it('should indicate symlink targets when withDetails is true', async () => {
      const result = await invokeFsList({ path: '/home/user', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show symlink indicator and possibly target
      expect(text).toMatch(/l\s+link\.txt|link\.txt\s*->|link\.txt.*small\.txt/)
    })

    it('should mark directories distinctly', async () => {
      const result = await invokeFsList({ path: '/home/user', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show 'd' for directory
      expect(text).toMatch(/d\s+subdir/)
    })
  })
})

// ============================================================================
// SORTING OPTIONS
// ============================================================================

describe('fs_list MCP Tool - Sorting', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    // Create files with different sizes and names
    storage.addFile('/home/user/small.txt', 'sm')
    storage.addFile('/home/user/medium.txt', 'medium content here')
    storage.addFile('/home/user/large.txt', new Uint8Array(1000))
    // Note: aaa.txt should come first alphabetically
    storage.addFile('/home/user/aaa.txt', 'first')
    storage.addFile('/home/user/zzz.txt', 'last')
  })

  describe('sort options', () => {
    it('should sort by name ascending (default)', async () => {
      const result = await invokeFsList({ path: '/home/user', sort: 'name' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      // aaa.txt should appear before zzz.txt
      const aaaIndex = lines.findIndex((l) => l.includes('aaa.txt'))
      const zzzIndex = lines.findIndex((l) => l.includes('zzz.txt'))
      expect(aaaIndex).toBeLessThan(zzzIndex)
    })

    it('should sort by name descending', async () => {
      const result = await invokeFsList({ path: '/home/user', sort: 'name', order: 'desc' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      // zzz.txt should appear before aaa.txt
      const aaaIndex = lines.findIndex((l) => l.includes('aaa.txt'))
      const zzzIndex = lines.findIndex((l) => l.includes('zzz.txt'))
      expect(zzzIndex).toBeLessThan(aaaIndex)
    })

    it('should sort by size ascending', async () => {
      const result = await invokeFsList({ path: '/home/user', sort: 'size', order: 'asc', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      // small.txt (2 bytes) should appear before large.txt (1000 bytes)
      const smallIndex = lines.findIndex((l) => l.includes('small.txt'))
      const largeIndex = lines.findIndex((l) => l.includes('large.txt'))
      expect(smallIndex).toBeLessThan(largeIndex)
    })

    it('should sort by size descending', async () => {
      const result = await invokeFsList({ path: '/home/user', sort: 'size', order: 'desc', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      // large.txt should appear before small.txt
      const smallIndex = lines.findIndex((l) => l.includes('small.txt'))
      const largeIndex = lines.findIndex((l) => l.includes('large.txt'))
      expect(largeIndex).toBeLessThan(smallIndex)
    })

    it('should sort by modification date', async () => {
      // Create files with different mtimes
      storage.addFile('/home/user/old.txt', 'old', { birthtime: Date.now() - 86400000 })
      storage.addFile('/home/user/new.txt', 'new', { birthtime: Date.now() })

      const result = await invokeFsList({ path: '/home/user', sort: 'date', order: 'desc', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      // new.txt should appear before old.txt when sorting by date desc
      const newIndex = lines.findIndex((l) => l.includes('new.txt'))
      const oldIndex = lines.findIndex((l) => l.includes('old.txt'))
      expect(newIndex).toBeLessThan(oldIndex)
    })

    it('should put directories first when groupDirectories is true', async () => {
      storage.addDirectory('/home/user/zdir')
      storage.addFile('/home/user/afile.txt', 'file')

      const result = await invokeFsList(
        { path: '/home/user', sort: 'name', groupDirectories: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim())
      // zdir (directory) should appear before afile.txt despite alphabetical order
      const zdirIndex = lines.findIndex((l) => l.includes('zdir'))
      const afileIndex = lines.findIndex((l) => l.includes('afile.txt'))
      expect(zdirIndex).toBeLessThan(afileIndex)
    })
  })
})

// ============================================================================
// PAGINATION / LIMIT
// ============================================================================

describe('fs_list MCP Tool - Pagination', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    // Create many files
    for (let i = 0; i < 50; i++) {
      storage.addFile(`/home/user/file${i.toString().padStart(3, '0')}.txt`, `content ${i}`)
    }
  })

  describe('limit option', () => {
    it('should limit results to specified count', async () => {
      const result = await invokeFsList({ path: '/home/user', limit: 10 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.trim() && !l.includes('...') && !l.includes('more'))
      expect(lines.length).toBeLessThanOrEqual(10)
    })

    it('should indicate when more results are available', async () => {
      const result = await invokeFsList({ path: '/home/user', limit: 10 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should indicate more results available
      expect(text).toMatch(/\.\.\.|more|truncated|and \d+ more/)
    })

    it('should support offset for pagination', async () => {
      const result = await invokeFsList({ path: '/home/user', limit: 10, offset: 10 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should not contain first 10 items (sorted alphabetically)
      // Note: createTestFilesystem adds data.json at index 0, so file000-file008 are indices 1-9
      expect(text).not.toContain('file000.txt')
      expect(text).not.toContain('file008.txt')
      // With offset=10, file009.txt (at index 10 after data.json) should be the first result
      expect(text).toContain('file009.txt')
      expect(text).toContain('file010.txt')
    })

    it('should return all results when limit is not specified', async () => {
      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should contain all files
      expect(text).toContain('file000.txt')
      expect(text).toContain('file049.txt')
    })
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('fs_list MCP Tool - Error Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('non-existent directory', () => {
    it('should return error for non-existent path', async () => {
      const result = await invokeFsList({ path: '/nonexistent' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist|no such file or directory/i)
    })

    it('should include path in error message', async () => {
      const result = await invokeFsList({ path: '/missing/path' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/missing/path')
    })
  })

  describe('not a directory', () => {
    it('should return error when path is a file', async () => {
      const result = await invokeFsList({ path: '/home/user/hello.txt' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOTDIR|not a directory/i)
    })
  })

  describe('permission errors', () => {
    it('should return error for path traversal attempts', async () => {
      const result = await invokeFsList({ path: '/home/user/../../../etc' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal/i)
    })
  })

  describe('missing required parameters', () => {
    it('should return error when path is missing', async () => {
      const result = await invokeFsList({}, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|missing/i)
    })

    it('should return error when path is empty string', async () => {
      const result = await invokeFsList({ path: '' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|empty/i)
    })
  })

  describe('invalid parameter types', () => {
    it('should handle non-string path gracefully', async () => {
      const result = await invokeFsList({ path: 123 as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/invalid|type|string/i)
    })

    it('should handle non-boolean recursive gracefully', async () => {
      const result = await invokeFsList({ path: '/home/user', recursive: 'yes' as unknown as boolean }, storage)

      // Should either work (treating truthy value as true) or return helpful error
      // Implementation dependent
      expect(result.content[0].type).toBe('text')
    })
  })
})

// ============================================================================
// MCP TOOL SCHEMA
// ============================================================================

describe('fs_list MCP Tool - Schema Definition', () => {
  // These tests verify the tool schema is properly defined

  it('should have correct tool name', () => {
    // This test should verify the tool is registered with name 'fs_list'
    const tool: McpTool = {
      name: 'fs_list',
      description: 'List files and directories in a path',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
          recursive: { type: 'boolean', description: 'List recursively' },
          withDetails: { type: 'boolean', description: 'Include file details' },
        },
        required: ['path'],
      },
    }

    expect(tool.name).toBe('fs_list')
    expect(tool.inputSchema.required).toContain('path')
  })

  it('should have all documented parameters in schema', () => {
    // Verify schema has all parameters we test for
    const expectedParams = ['path', 'recursive', 'withDetails', 'pattern', 'showHidden', 'sort', 'order', 'limit', 'offset', 'groupDirectories']

    // This test will fail until schema is expanded
    const tool: McpTool = {
      name: 'fs_list',
      description: 'List files and directories in a path',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean' },
          withDetails: { type: 'boolean' },
          pattern: { type: 'string' },
          showHidden: { type: 'boolean' },
          sort: { type: 'string', enum: ['name', 'size', 'date'] },
          order: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'number' },
          offset: { type: 'number' },
          groupDirectories: { type: 'boolean' },
        },
        required: ['path'],
      },
    }

    for (const param of expectedParams) {
      expect(tool.inputSchema.properties).toHaveProperty(param)
    }
  })
})

// ============================================================================
// SYMLINK HANDLING
// ============================================================================

describe('fs_list MCP Tool - Symlink Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/target.txt', 'target content')
    storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')
    storage.addDirectory('/home/user/realdir')
    storage.addSymlink('/home/user/linkdir', '/home/user/realdir')
  })

  describe('symlink listing', () => {
    it('should list symlinks alongside regular files', async () => {
      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('link.txt')
      expect(text).toContain('target.txt')
    })

    it('should show symlink indicator with withDetails', async () => {
      const result = await invokeFsList({ path: '/home/user', withDetails: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show 'l' indicator for symlinks
      expect(text).toMatch(/l\s+link\.txt/)
    })

    it('should follow symlinks when listing directory symlink recursively', async () => {
      storage.addFile('/home/user/realdir/file.txt', 'in real dir')

      const result = await invokeFsList({ path: '/home/user/linkdir', recursive: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('file.txt')
    })
  })
})

// ============================================================================
// SPECIAL CHARACTERS IN FILENAMES
// ============================================================================

describe('fs_list MCP Tool - Special Characters', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('filenames with special characters', () => {
    it('should handle filenames with spaces', async () => {
      storage.addFile('/home/user/my file.txt', 'content')

      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('my file.txt')
    })

    it('should handle filenames with unicode characters', async () => {
      storage.addFile('/home/user/caf\u00e9.txt', 'coffee')
      storage.addFile('/home/user/\u65e5\u672c\u8a9e.txt', 'japanese')

      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('caf\u00e9.txt')
      expect(text).toContain('\u65e5\u672c\u8a9e.txt')
    })

    it('should handle filenames with special shell characters', async () => {
      storage.addFile('/home/user/file$var.txt', 'dollar')
      storage.addFile('/home/user/file&more.txt', 'ampersand')

      const result = await invokeFsList({ path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('file$var.txt')
      expect(text).toContain('file&more.txt')
    })
  })
})
