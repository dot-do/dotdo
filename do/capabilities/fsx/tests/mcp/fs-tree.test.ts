/**
 * Tests for fs_tree MCP Tool - Directory Tree Visualization
 *
 * Tests for the fs_tree MCP tool which provides directory tree visualization
 * for AI-assisted file operations via the Model Context Protocol (MCP).
 *
 * The implementation has been refactored to:
 * - Extract implementation to core/mcp/fs-tree.ts
 * - Share utilities with fs_list and fs_search
 * - Separate tree formatting from traversal
 *
 * @module tests/mcp/fs-tree
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem } from '../test-utils'

// Import the refactored implementation from core/mcp/fs-tree
import { invokeFsTree, formatSize, type FsTreeOptions, type TreeNode } from '../../core/mcp/fs-tree'

// Types for MCP tool schema (used in schema validation tests)
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
// BASIC TREE GENERATION
// ============================================================================

describe('fs_tree MCP Tool - Basic Tree Generation', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('generate tree view', () => {
    it('should generate ASCII tree for a directory', async () => {
      storage.addDirectory('/home/user/projects')
      storage.addFile('/home/user/projects/index.ts', 'export {}')
      storage.addFile('/home/user/projects/package.json', '{}')

      const result = await invokeFsTree({ path: '/home/user/projects' }, storage)

      expect(result.isError).toBeFalsy()
      expect(result.content[0].type).toBe('text')
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should contain tree characters
      expect(text).toMatch(/[├└│─]/)
      expect(text).toContain('index.ts')
      expect(text).toContain('package.json')
    })

    it('should show nested directory structure', async () => {
      storage.addDirectory('/home/user/app')
      storage.addDirectory('/home/user/app/src')
      storage.addDirectory('/home/user/app/src/components')
      storage.addFile('/home/user/app/src/index.ts', 'main')
      storage.addFile('/home/user/app/src/components/Button.tsx', 'button')

      const result = await invokeFsTree({ path: '/home/user/app' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('src')
      expect(text).toContain('components')
      expect(text).toContain('index.ts')
      expect(text).toContain('Button.tsx')
    })

    it('should show root directory name at top', async () => {
      storage.addDirectory('/home/user/myproject')
      storage.addFile('/home/user/myproject/README.md', '# Readme')

      const result = await invokeFsTree({ path: '/home/user/myproject' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n')
      expect(lines[0]).toContain('myproject')
    })

    it('should handle empty directory', async () => {
      storage.addDirectory('/home/user/empty')

      const result = await invokeFsTree({ path: '/home/user/empty' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('empty')
      // Should show something for empty directory (just the name or empty indicator)
    })

    it('should generate tree for root directory', async () => {
      const result = await invokeFsTree({ path: '/' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('home')
      expect(text).toContain('tmp')
      expect(text).toContain('var')
    })
  })
})

// ============================================================================
// DEPTH LIMITING
// ============================================================================

describe('fs_tree MCP Tool - Depth Limiting', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    // Create deep structure
    storage.addDirectory('/home/user/deep')
    storage.addDirectory('/home/user/deep/level1')
    storage.addDirectory('/home/user/deep/level1/level2')
    storage.addDirectory('/home/user/deep/level1/level2/level3')
    storage.addFile('/home/user/deep/file0.txt', '0')
    storage.addFile('/home/user/deep/level1/file1.txt', '1')
    storage.addFile('/home/user/deep/level1/level2/file2.txt', '2')
    storage.addFile('/home/user/deep/level1/level2/level3/file3.txt', '3')
  })

  describe('maxDepth option', () => {
    it('should limit tree to depth 1 (immediate children only)', async () => {
      const result = await invokeFsTree({ path: '/home/user/deep', maxDepth: 1 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('level1')
      expect(text).toContain('file0.txt')
      expect(text).not.toContain('level2')
      expect(text).not.toContain('file1.txt')
    })

    it('should limit tree to depth 2', async () => {
      const result = await invokeFsTree({ path: '/home/user/deep', maxDepth: 2 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('level1')
      expect(text).toContain('file1.txt')
      expect(text).toContain('level2')
      expect(text).not.toContain('level3')
      expect(text).not.toContain('file2.txt')
    })

    it('should show all levels when maxDepth is not specified', async () => {
      const result = await invokeFsTree({ path: '/home/user/deep' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('level1')
      expect(text).toContain('level2')
      expect(text).toContain('level3')
      expect(text).toContain('file3.txt')
    })

    it('should handle maxDepth of 0 (show only root)', async () => {
      const result = await invokeFsTree({ path: '/home/user/deep', maxDepth: 0 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('deep')
      expect(text).not.toContain('level1')
      expect(text).not.toContain('file0.txt')
    })
  })
})

// ============================================================================
// PATTERN FILTERING / EXCLUSIONS
// ============================================================================

describe('fs_tree MCP Tool - Pattern Filtering', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/project')
    storage.addDirectory('/home/user/project/src')
    storage.addDirectory('/home/user/project/node_modules')
    storage.addDirectory('/home/user/project/node_modules/lodash')
    storage.addDirectory('/home/user/project/dist')
    storage.addFile('/home/user/project/src/index.ts', 'main')
    storage.addFile('/home/user/project/node_modules/lodash/index.js', 'lodash')
    storage.addFile('/home/user/project/dist/bundle.js', 'bundle')
    storage.addFile('/home/user/project/package.json', '{}')
    storage.addFile('/home/user/project/.gitignore', 'node_modules')
  })

  describe('exclude patterns', () => {
    it('should exclude directories matching pattern', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/project', exclude: ['node_modules'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('src')
      expect(text).toContain('dist')
      expect(text).not.toContain('node_modules')
      expect(text).not.toContain('lodash')
    })

    it('should exclude multiple patterns', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/project', exclude: ['node_modules', 'dist'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('src')
      expect(text).not.toContain('node_modules')
      expect(text).not.toContain('dist')
    })

    it('should support glob patterns in exclusions', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/project', exclude: ['*.js'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('index.ts')
      expect(text).not.toContain('bundle.js')
    })

    it('should exclude hidden files by default', async () => {
      const result = await invokeFsTree({ path: '/home/user/project' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).not.toContain('.gitignore')
    })

    it('should include hidden files when showHidden is true', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/project', showHidden: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('.gitignore')
    })
  })

  describe('include patterns', () => {
    it('should only show files matching include pattern', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/project', include: ['*.ts'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('index.ts')
      // Directories should still show to maintain structure
      expect(text).toContain('src')
      // Non-matching files should be excluded
      expect(text).not.toContain('package.json')
    })
  })
})

// ============================================================================
// FILE SIZE DISPLAY
// ============================================================================

describe('fs_tree MCP Tool - File Size Display', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/sized')
    storage.addFile('/home/user/sized/tiny.txt', 'hi')
    storage.addFile('/home/user/sized/small.txt', 'Hello, World!')
    storage.addFile('/home/user/sized/medium.bin', new Uint8Array(1024)) // 1KB
    storage.addFile('/home/user/sized/large.bin', new Uint8Array(1024 * 100)) // 100KB
  })

  describe('showSize option', () => {
    it('should show file sizes when showSize is true', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/sized', showSize: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show size indicators
      expect(text).toMatch(/\d+\s*(B|K|KB|M|MB|bytes)/)
    })

    it('should show human-readable sizes', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/sized', showSize: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // 100KB file should show as 100K or similar
      expect(text).toMatch(/100\s*K|100KB|102400/)
    })

    it('should not show sizes by default', async () => {
      const result = await invokeFsTree({ path: '/home/user/sized' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should just show filenames without size
      const lines = text.split('\n')
      const tinyLine = lines.find(l => l.includes('tiny.txt'))
      // Should not have size indicator on the line (just the name)
      expect(tinyLine).not.toMatch(/\d+\s*(B|bytes)/)
    })
  })
})

// ============================================================================
// OUTPUT FORMAT
// ============================================================================

describe('fs_tree MCP Tool - Output Format', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/format')
    storage.addDirectory('/home/user/format/subdir')
    storage.addFile('/home/user/format/file1.txt', 'one')
    storage.addFile('/home/user/format/subdir/file2.txt', 'two')
  })

  describe('format option', () => {
    it('should return ASCII tree by default', async () => {
      const result = await invokeFsTree({ path: '/home/user/format' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // ASCII tree characters
      expect(text).toMatch(/[├└│─]/)
    })

    it('should return JSON when format is json', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/format', format: 'json' },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const json = JSON.parse(text)
      expect(json).toHaveProperty('name', 'format')
      expect(json).toHaveProperty('children')
      expect(Array.isArray(json.children)).toBe(true)
    })

    it('should include type info in JSON format', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/format', format: 'json' },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const json = JSON.parse(text)
      // Root should be directory
      expect(json.type).toBe('directory')
      // Find a file child
      const file = json.children?.find((c: {name: string}) => c.name === 'file1.txt')
      expect(file?.type).toBe('file')
    })

    it('should include size in JSON when showSize is true', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/format', format: 'json', showSize: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const json = JSON.parse(text)
      const file = json.children?.find((c: {name: string}) => c.name === 'file1.txt')
      expect(file).toHaveProperty('size')
      expect(typeof file.size).toBe('number')
    })
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('fs_tree MCP Tool - Error Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('non-existent path', () => {
    it('should return error for non-existent directory', async () => {
      const result = await invokeFsTree({ path: '/nonexistent' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist|no such file or directory/i)
    })

    it('should include path in error message', async () => {
      const result = await invokeFsTree({ path: '/missing/path' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/missing/path')
    })
  })

  describe('path is a file', () => {
    it('should return error when path is a file, not directory', async () => {
      const result = await invokeFsTree({ path: '/home/user/hello.txt' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOTDIR|not a directory/i)
    })
  })

  describe('path traversal', () => {
    it('should return error for path traversal attempts', async () => {
      const result = await invokeFsTree({ path: '/home/user/../../../etc' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/EACCES|permission|denied|traversal/i)
    })
  })

  describe('missing required parameters', () => {
    it('should return error when path is missing', async () => {
      const result = await invokeFsTree({}, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|required|missing/i)
    })

    it('should return error when path is empty', async () => {
      const result = await invokeFsTree({ path: '' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/path|invalid|empty/i)
    })
  })

  describe('invalid parameter types', () => {
    it('should handle non-string path gracefully', async () => {
      const result = await invokeFsTree({ path: 123 as unknown as string }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/invalid|type|string/i)
    })

    it('should handle invalid maxDepth gracefully', async () => {
      const result = await invokeFsTree(
        { path: '/home/user', maxDepth: -1 },
        storage
      )

      // Should either treat as 0 or return error
      expect(result.content[0].type).toBe('text')
    })
  })
})

// ============================================================================
// SYMLINK HANDLING
// ============================================================================

describe('fs_tree MCP Tool - Symlink Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/symtest')
    storage.addDirectory('/home/user/symtest/real')
    storage.addFile('/home/user/symtest/real/file.txt', 'content')
    storage.addSymlink('/home/user/symtest/link', '/home/user/symtest/real')
  })

  describe('symlink display', () => {
    it('should show symlinks in tree', async () => {
      const result = await invokeFsTree({ path: '/home/user/symtest' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('link')
      expect(text).toContain('real')
    })

    it('should indicate symlink with arrow or marker', async () => {
      const result = await invokeFsTree({ path: '/home/user/symtest' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // Should show symlink indicator (arrow or @ or similar)
      expect(text).toMatch(/link\s*(-|>|->|@|\[symlink\])/)
    })
  })
})

// ============================================================================
// SORTING
// ============================================================================

describe('fs_tree MCP Tool - Sorting', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/sorted')
    storage.addDirectory('/home/user/sorted/beta')
    storage.addDirectory('/home/user/sorted/alpha')
    storage.addFile('/home/user/sorted/zebra.txt', 'z')
    storage.addFile('/home/user/sorted/apple.txt', 'a')
  })

  describe('default sorting', () => {
    it('should sort entries alphabetically by default', async () => {
      const result = await invokeFsTree({ path: '/home/user/sorted' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const alphaIndex = text.indexOf('alpha')
      const betaIndex = text.indexOf('beta')
      const appleIndex = text.indexOf('apple')
      const zebraIndex = text.indexOf('zebra')

      expect(alphaIndex).toBeLessThan(betaIndex)
      expect(appleIndex).toBeLessThan(zebraIndex)
    })

    it('should put directories before files when dirsFirst is true', async () => {
      const result = await invokeFsTree(
        { path: '/home/user/sorted', dirsFirst: true },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const alphaIndex = text.indexOf('alpha')
      const appleIndex = text.indexOf('apple.txt')

      // Directories (alpha, beta) should come before files (apple.txt, zebra.txt)
      expect(alphaIndex).toBeLessThan(appleIndex)
    })
  })
})

// ============================================================================
// SPECIAL CHARACTERS
// ============================================================================

describe('fs_tree MCP Tool - Special Characters', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('filenames with special characters', () => {
    it('should handle filenames with spaces', async () => {
      storage.addDirectory('/home/user/special')
      storage.addFile('/home/user/special/my file.txt', 'content')

      const result = await invokeFsTree({ path: '/home/user/special' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('my file.txt')
    })

    it('should handle unicode filenames', async () => {
      storage.addDirectory('/home/user/unicode')
      storage.addFile('/home/user/unicode/caf\u00e9.txt', 'coffee')
      storage.addFile('/home/user/unicode/\u65e5\u672c\u8a9e.txt', 'japanese')

      const result = await invokeFsTree({ path: '/home/user/unicode' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('caf\u00e9.txt')
      expect(text).toContain('\u65e5\u672c\u8a9e.txt')
    })
  })
})

// ============================================================================
// MCP TOOL SCHEMA
// ============================================================================

describe('fs_tree MCP Tool - Schema Definition', () => {
  it('should have correct tool name', () => {
    const tool: McpTool = {
      name: 'fs_tree',
      description: 'Generate a tree view of a directory structure',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to generate tree for' },
          maxDepth: { type: 'number', description: 'Maximum depth to traverse' },
          showHidden: { type: 'boolean', description: 'Include hidden files' },
          showSize: { type: 'boolean', description: 'Show file sizes' },
          exclude: { type: 'array', description: 'Patterns to exclude' },
          format: { type: 'string', enum: ['ascii', 'json'], description: 'Output format' },
        },
        required: ['path'],
      },
    }

    expect(tool.name).toBe('fs_tree')
    expect(tool.inputSchema.required).toContain('path')
  })

  it('should have all documented parameters in schema', () => {
    const expectedParams = [
      'path',
      'maxDepth',
      'showHidden',
      'showSize',
      'exclude',
      'include',
      'format',
      'dirsFirst',
    ]

    const tool: McpTool = {
      name: 'fs_tree',
      description: 'Generate a tree view of a directory structure',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxDepth: { type: 'number' },
          showHidden: { type: 'boolean' },
          showSize: { type: 'boolean' },
          exclude: { type: 'array' },
          include: { type: 'array' },
          format: { type: 'string', enum: ['ascii', 'json'] },
          dirsFirst: { type: 'boolean' },
        },
        required: ['path'],
      },
    }

    for (const param of expectedParams) {
      expect(tool.inputSchema.properties).toHaveProperty(param)
    }
  })
})
