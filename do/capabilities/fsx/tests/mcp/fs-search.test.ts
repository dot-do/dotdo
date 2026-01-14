/**
 * Tests for fs_search MCP Tool - Glob Pattern Search
 *
 * RED phase: These tests define expected behavior for the fs_search MCP tool.
 * All tests should FAIL until the implementation is complete.
 *
 * The fs_search tool provides glob pattern file search functionality for AI-assisted
 * file operations via the Model Context Protocol (MCP).
 *
 * @module tests/mcp/fs-search
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem } from '../test-utils'

// =============================================================================
// Import refactored fs_search implementation from core/mcp
// =============================================================================

import {
  invokeFsSearch,
  type McpToolResult,
  type StorageBackend,
} from '../../core/mcp/fs-search'

/**
 * MCP tool schema type (for schema tests)
 */
interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
}

// =============================================================================
// BASIC GLOB PATTERN SEARCH
// =============================================================================

describe('fs_search MCP Tool - Basic Glob Pattern Search', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    // Add more test files
    storage.addDirectory('/home/user/src')
    storage.addFile('/home/user/src/index.ts', 'export {}')
    storage.addFile('/home/user/src/utils.ts', 'export const utils = {}')
    storage.addFile('/home/user/src/config.json', '{}')
    storage.addFile('/home/user/app.ts', 'import {}')
    storage.addFile('/home/user/readme.md', '# Readme')
  })

  describe('simple glob patterns', () => {
    it('should search with *.ts pattern', async () => {
      const result = await invokeFsSearch({ pattern: '*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('app.ts')
      expect(text).not.toContain('index.ts') // Nested file shouldn't match *.ts
      expect(text).not.toContain('config.json')
      expect(text).not.toContain('readme.md')
    })

    it('should search with **/*.ts pattern for recursive search', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('app.ts')
      expect(text).toContain('index.ts')
      expect(text).toContain('utils.ts')
      expect(text).not.toContain('config.json')
    })

    it('should search with *.json pattern', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.json', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('config.json')
      expect(text).toContain('data.json')
      expect(text).not.toContain('.ts')
    })

    it('should search with complex pattern *.{ts,json}', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.{ts,json}', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('index.ts')
      expect(text).toContain('config.json')
      expect(text).not.toContain('readme.md')
    })
  })

  describe('path prefix patterns', () => {
    it('should search with src/*.ts for specific directory', async () => {
      const result = await invokeFsSearch({ pattern: 'src/*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('index.ts')
      expect(text).toContain('utils.ts')
      expect(text).not.toContain('app.ts') // Not in src/
    })
  })
})

// =============================================================================
// EXCLUDE PATTERNS
// =============================================================================

describe('fs_search MCP Tool - Exclude Patterns', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/node_modules')
    storage.addDirectory('/home/user/node_modules/lodash')
    storage.addFile('/home/user/node_modules/lodash/index.js', 'module.exports = {}')
    storage.addDirectory('/home/user/src')
    storage.addFile('/home/user/src/app.js', 'console.log("app")')
    storage.addFile('/home/user/lib.js', 'console.log("lib")')
  })

  describe('exclude option', () => {
    it('should exclude node_modules directory', async () => {
      const result = await invokeFsSearch(
        { pattern: '**/*.js', path: '/home/user', exclude: ['node_modules'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('app.js')
      expect(text).toContain('lib.js')
      expect(text).not.toContain('lodash')
    })

    it('should exclude multiple patterns', async () => {
      const result = await invokeFsSearch(
        { pattern: '**/*.js', path: '/home/user', exclude: ['node_modules', 'src'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('lib.js')
      expect(text).not.toContain('app.js')
      expect(text).not.toContain('lodash')
    })

    it('should exclude with glob patterns', async () => {
      const result = await invokeFsSearch(
        { pattern: '**/*.js', path: '/home/user', exclude: ['**/node_modules/**'] },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).not.toContain('lodash')
      expect(text).toContain('app.js')
    })
  })
})

// =============================================================================
// LIMIT RESULTS
// =============================================================================

describe('fs_search MCP Tool - Limit Results', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    // Create many files
    storage.addDirectory('/home/user/many')
    for (let i = 0; i < 50; i++) {
      storage.addFile(`/home/user/many/file${i.toString().padStart(3, '0')}.txt`, `content ${i}`)
    }
  })

  describe('limit option', () => {
    it('should limit results to specified count', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.txt', path: '/home/user/many', limit: 10 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.includes('.txt'))
      expect(lines.length).toBeLessThanOrEqual(10)
    })

    it('should return all results when limit is not specified', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.txt', path: '/home/user/many' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('file000.txt')
      expect(text).toContain('file049.txt')
    })

    it('should handle limit of 1', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.txt', path: '/home/user/many', limit: 1 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const lines = text.split('\n').filter((l) => l.includes('.txt'))
      expect(lines.length).toBe(1)
    })
  })
})

// =============================================================================
// NO MATCHES HANDLING
// =============================================================================

describe('fs_search MCP Tool - No Matches', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('no matches found', () => {
    it('should return appropriate message when no matches found', async () => {
      const result = await invokeFsSearch({ pattern: '*.xyz', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/no matches|not found|0 matches/i)
    })

    it('should return no matches for non-existent extension', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.nonexistent', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/no matches|not found|0 matches/i)
    })
  })
})

// =============================================================================
// INVALID PATTERN HANDLING
// =============================================================================

describe('fs_search MCP Tool - Invalid Pattern Handling', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('invalid patterns', () => {
    it('should return error for missing pattern', async () => {
      const result = await invokeFsSearch({ path: '/home/user' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/pattern|required/i)
    })

    it('should return error for empty pattern', async () => {
      const result = await invokeFsSearch({ pattern: '', path: '/home/user' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/pattern|empty/i)
    })

    it('should return error for non-string pattern', async () => {
      const result = await invokeFsSearch({ pattern: 123 as unknown as string, path: '/home/user' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/pattern|string/i)
    })

    it('should return error for non-existent path', async () => {
      const result = await invokeFsSearch({ pattern: '*.ts', path: '/nonexistent' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOENT|not found|does not exist/i)
    })

    it('should return error when path is a file', async () => {
      const result = await invokeFsSearch({ pattern: '*.ts', path: '/home/user/hello.txt' }, storage)

      expect(result.isError).toBe(true)
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/ENOTDIR|not a directory/i)
    })
  })
})

// =============================================================================
// HIDDEN FILES
// =============================================================================

describe('fs_search MCP Tool - Hidden Files', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/.env', 'SECRET=xxx')
    storage.addFile('/home/user/.gitignore', 'node_modules')
    storage.addDirectory('/home/user/.config')
    storage.addFile('/home/user/.config/settings.json', '{}')
    storage.addFile('/home/user/visible.txt', 'visible')
  })

  describe('hidden file handling', () => {
    it('should exclude hidden files by default', async () => {
      const result = await invokeFsSearch({ pattern: '**/*', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('visible.txt')
      expect(text).not.toContain('.env')
      expect(text).not.toContain('.gitignore')
    })

    it('should include hidden files when showHidden is true', async () => {
      const result = await invokeFsSearch({ pattern: '**/*', path: '/home/user', showHidden: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('.env')
      expect(text).toContain('.gitignore')
      expect(text).toContain('.config')
      expect(text).toContain('visible.txt')
    })

    it('should include hidden directories when showHidden is true', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.json', path: '/home/user', showHidden: true }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('settings.json')
    })
  })
})

// =============================================================================
// CONTENT SEARCH (GREP-LIKE)
// =============================================================================

describe('fs_search MCP Tool - Content Search', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addFile('/home/user/foo.ts', 'function foo() { return "hello" }')
    storage.addFile('/home/user/bar.ts', 'function bar() { return "world" }')
    storage.addFile('/home/user/baz.ts', 'function baz() { return "hello world" }')
    storage.addFile('/home/user/multi.ts', 'hello hello hello')
  })

  describe('content search', () => {
    it('should filter files by content', async () => {
      const result = await invokeFsSearch(
        { pattern: '**/*.ts', path: '/home/user', contentSearch: 'hello' },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('foo.ts')
      expect(text).toContain('baz.ts')
      expect(text).toContain('multi.ts')
      expect(text).not.toContain('bar.ts')
    })

    it('should show match count for content search', async () => {
      const result = await invokeFsSearch(
        { pattern: '**/*.ts', path: '/home/user', contentSearch: 'hello' },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      // multi.ts should show multiple matches
      expect(text).toMatch(/multi\.ts.*3 match/)
    })

    it('should support case-insensitive content search', async () => {
      storage.addFile('/home/user/upper.ts', 'HELLO WORLD')

      const result = await invokeFsSearch(
        { pattern: '**/*.ts', path: '/home/user', contentSearch: 'hello', caseSensitive: false },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('upper.ts')
    })

    it('should be case-sensitive by default', async () => {
      storage.addFile('/home/user/upper.ts', 'HELLO WORLD')

      const result = await invokeFsSearch(
        { pattern: '**/*.ts', path: '/home/user', contentSearch: 'hello' },
        storage
      )

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).not.toContain('upper.ts')
    })
  })
})

// =============================================================================
// DEPTH LIMITING
// =============================================================================

describe('fs_search MCP Tool - Depth Limiting', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/a')
    storage.addDirectory('/home/user/a/b')
    storage.addDirectory('/home/user/a/b/c')
    storage.addFile('/home/user/root.ts', 'root')
    storage.addFile('/home/user/a/level1.ts', 'level1')
    storage.addFile('/home/user/a/b/level2.ts', 'level2')
    storage.addFile('/home/user/a/b/c/level3.ts', 'level3')
  })

  describe('maxDepth option', () => {
    it('should limit search depth to 0', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user', maxDepth: 0 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('root.ts')
      expect(text).not.toContain('level1.ts')
      expect(text).not.toContain('level2.ts')
    })

    it('should limit search depth to 1', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user', maxDepth: 1 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('root.ts')
      expect(text).toContain('level1.ts')
      expect(text).not.toContain('level2.ts')
    })

    it('should limit search depth to 2', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user', maxDepth: 2 }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('root.ts')
      expect(text).toContain('level1.ts')
      expect(text).toContain('level2.ts')
      expect(text).not.toContain('level3.ts')
    })

    it('should search all depths when maxDepth is not specified', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('root.ts')
      expect(text).toContain('level1.ts')
      expect(text).toContain('level2.ts')
      expect(text).toContain('level3.ts')
    })
  })
})

// =============================================================================
// MCP TOOL SCHEMA
// =============================================================================

describe('fs_search MCP Tool - Schema Definition', () => {
  it('should have correct tool name', () => {
    const tool: McpTool = {
      name: 'fs_search',
      description: 'Search for files matching a glob pattern',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match files' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
      },
    }

    expect(tool.name).toBe('fs_search')
    expect(tool.inputSchema.required).toContain('pattern')
  })

  it('should have all documented parameters in schema', () => {
    const expectedParams = [
      'pattern',
      'path',
      'exclude',
      'maxDepth',
      'showHidden',
      'limit',
      'contentSearch',
      'caseSensitive',
    ]

    const tool: McpTool = {
      name: 'fs_search',
      description: 'Search for files matching a glob pattern',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match files' },
          path: { type: 'string', description: 'Directory to search in' },
          exclude: { type: 'array', description: 'Patterns to exclude' },
          maxDepth: { type: 'number', description: 'Maximum search depth' },
          showHidden: { type: 'boolean', description: 'Include hidden files' },
          limit: { type: 'number', description: 'Maximum number of results' },
          contentSearch: { type: 'string', description: 'Search within file contents' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive content search' },
        },
        required: ['pattern'],
      },
    }

    for (const param of expectedParams) {
      expect(tool.inputSchema.properties).toHaveProperty(param)
    }
  })
})

// =============================================================================
// RESULT FORMAT
// =============================================================================

describe('fs_search MCP Tool - Result Format', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    storage.addDirectory('/home/user/src')
    storage.addFile('/home/user/src/index.ts', 'export {}')
  })

  describe('result formatting', () => {
    it('should return results as text content', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      expect(result.content[0].type).toBe('text')
    })

    it('should include full paths in results', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('/home/user/src/index.ts')
    })

    it('should show match count summary', async () => {
      const result = await invokeFsSearch({ pattern: '**/*.ts', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/found \d+ match/i)
    })
  })
})
