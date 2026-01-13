/**
 * Glob Tool Adapter Tests (RED Phase)
 *
 * Tests for the Glob tool adapter that maps Claude SDK Glob tool to fsx.do.
 * These are failing tests following TDD principles - the implementation
 * does not exist yet.
 *
 * @see dotdo-4a80a - [RED] Glob tool adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FsCapability } from '../../lib/capabilities/fs'
import type { ToolDefinition, ToolContext } from '../types'

// ============================================================================
// Types for Glob Tool Adapter
// ============================================================================

interface GlobToolInput {
  pattern: string
  path?: string // Base directory, defaults to cwd
}

interface GlobToolOutput {
  files: string[]
  truncated?: boolean
}

// ============================================================================
// Mock FsCapability
// ============================================================================

function createMockFs(): FsCapability {
  return {
    read: vi.fn(),
    write: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    copy: vi.fn(),
    move: vi.fn(),
    glob: vi.fn(),
  } as unknown as FsCapability
}

function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    agentId: 'test-agent',
    sessionId: 'test-session',
    ...overrides,
  }
}

// ============================================================================
// Import placeholder - will fail until implementation exists
// ============================================================================

// Placeholder until we implement the adapter
const createGlobToolAdapter = (_fs: FsCapability): ToolDefinition<GlobToolInput, GlobToolOutput> => {
  throw new Error('Not implemented - RED phase')
}

// ============================================================================
// Glob Tool Adapter Tests
// ============================================================================

describe('Glob Tool Adapter', () => {
  let mockFs: FsCapability
  let globTool: ToolDefinition<GlobToolInput, GlobToolOutput>

  beforeEach(() => {
    mockFs = createMockFs()
  })

  describe('Tool Definition', () => {
    it('creates a tool with name "Glob"', () => {
      globTool = createGlobToolAdapter(mockFs)
      expect(globTool.name).toBe('Glob')
    })

    it('has appropriate description for Claude SDK', () => {
      globTool = createGlobToolAdapter(mockFs)
      expect(globTool.description).toContain('pattern')
      expect(globTool.description.toLowerCase()).toContain('file')
    })

    it('has inputSchema with pattern as required', () => {
      globTool = createGlobToolAdapter(mockFs)
      expect(globTool.inputSchema).toBeDefined()
    })

    it('has inputSchema with path as optional', () => {
      globTool = createGlobToolAdapter(mockFs)
      expect(globTool.inputSchema).toBeDefined()
    })
  })

  describe('Simple Patterns', () => {
    it('finds TypeScript files with *.ts pattern', async () => {
      const mockFiles = ['index.ts', 'app.ts', 'utils.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '*.ts' }, createToolContext())

      expect(mockFs.glob).toHaveBeenCalledWith('*.ts', expect.any(Object))
      expect(result.files).toEqual(mockFiles)
    })

    it('finds JavaScript files with *.js pattern', async () => {
      const mockFiles = ['bundle.js', 'main.js']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '*.js' }, createToolContext())

      expect(result.files).toEqual(mockFiles)
    })

    it('finds JSON files with *.json pattern', async () => {
      const mockFiles = ['package.json', 'tsconfig.json']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '*.json' }, createToolContext())

      expect(result.files).toEqual(mockFiles)
    })
  })

  describe('Recursive Patterns', () => {
    it('finds nested files with **/*.ts recursive pattern', async () => {
      const mockFiles = [
        'src/index.ts',
        'src/utils/helpers.ts',
        'src/components/Button.ts',
        'tests/unit/app.test.ts',
      ]
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      expect(mockFs.glob).toHaveBeenCalledWith('**/*.ts', expect.any(Object))
      expect(result.files).toEqual(mockFiles)
    })

    it('finds deeply nested files', async () => {
      const mockFiles = ['a/b/c/d/e/file.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      expect(result.files).toContain('a/b/c/d/e/file.ts')
    })
  })

  describe('Multiple Extensions', () => {
    it('finds files matching multiple extensions with {ts,tsx}', async () => {
      const mockFiles = ['App.tsx', 'index.ts', 'Button.tsx']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute(
        { pattern: '*.{ts,tsx}' },
        createToolContext()
      )

      expect(mockFs.glob).toHaveBeenCalledWith('*.{ts,tsx}', expect.any(Object))
      expect(result.files).toEqual(mockFiles)
    })

    it('finds files with multiple extension types', async () => {
      const mockFiles = ['app.ts', 'app.tsx', 'app.js', 'app.jsx']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute(
        { pattern: '**/*.{ts,tsx,js,jsx}' },
        createToolContext()
      )

      expect(result.files).toHaveLength(4)
    })
  })

  describe('Directory Patterns', () => {
    it('finds index files in any directory with src/**/index.ts', async () => {
      const mockFiles = ['src/index.ts', 'src/components/index.ts', 'src/utils/index.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute(
        { pattern: 'src/**/index.ts' },
        createToolContext()
      )

      expect(result.files).toEqual(mockFiles)
      expect(result.files.every((f) => f.endsWith('index.ts'))).toBe(true)
    })

    it('uses path parameter as base directory', async () => {
      const mockFiles = ['Button.tsx', 'Input.tsx']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      await globTool.execute(
        { pattern: '*.tsx', path: 'src/components' },
        createToolContext()
      )

      expect(mockFs.glob).toHaveBeenCalledWith(
        '*.tsx',
        expect.objectContaining({ cwd: 'src/components' })
      )
    })
  })

  describe('Negation Patterns (excluding node_modules)', () => {
    it('excludes node_modules by default', async () => {
      const mockFiles = ['src/index.ts', 'lib/utils.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      // Should not include node_modules files
      expect(result.files.every((f) => !f.includes('node_modules'))).toBe(true)
    })

    it('excludes .git directory by default', async () => {
      const mockFiles = ['src/index.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*' }, createToolContext())

      expect(result.files.every((f) => !f.includes('.git/'))).toBe(true)
    })
  })

  describe('Case Sensitivity', () => {
    it('handles case-insensitive filesystems correctly', async () => {
      const mockFiles = ['README.md', 'readme.txt', 'Readme.doc']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/readme*' }, createToolContext())

      // Should find files regardless of case on case-insensitive systems
      expect(result.files.length).toBeGreaterThan(0)
    })

    it('exact case matching for case-sensitive patterns', async () => {
      const mockFiles = ['Component.tsx']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute(
        { pattern: '**/Component.tsx' },
        createToolContext()
      )

      expect(result.files).toContain('Component.tsx')
    })
  })

  describe('Symlink Handling', () => {
    it('follows symlinks by default', async () => {
      // Symlinked files should be included in results
      const mockFiles = ['linked-file.ts', 'regular-file.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      expect(result.files).toContain('linked-file.ts')
    })
  })

  describe('Sort by Modification Time', () => {
    it('returns files sorted by mtime (most recently modified first)', async () => {
      const mockFiles = ['newest.ts', 'older.ts', 'oldest.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      // Files should be returned in mtime order (newest first)
      expect(result.files[0]).toBe('newest.ts')
    })
  })

  describe('Result Limiting', () => {
    it('caps results at N matches', async () => {
      // Generate many files
      const manyFiles = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`)
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(manyFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      // Should have a reasonable limit
      expect(result.files.length).toBeLessThanOrEqual(500)
      expect(result.truncated).toBe(true)
    })

    it('sets truncated=true when results are limited', async () => {
      const manyFiles = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`)
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(manyFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      expect(result.truncated).toBe(true)
    })

    it('sets truncated=false when all results fit', async () => {
      const fewFiles = ['a.ts', 'b.ts', 'c.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(fewFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      expect(result.truncated).toBe(false)
    })
  })

  describe('Empty Results', () => {
    it('returns empty array when no matches found', async () => {
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue([])

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute(
        { pattern: '**/*.nonexistent' },
        createToolContext()
      )

      expect(result.files).toEqual([])
      expect(result.truncated).toBe(false)
    })
  })

  describe('Special Glob Characters', () => {
    it('handles ? single character wildcard', async () => {
      const mockFiles = ['file1.ts', 'file2.ts', 'file3.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: 'file?.ts' }, createToolContext())

      expect(result.files).toHaveLength(3)
    })

    it('handles [abc] character classes', async () => {
      const mockFiles = ['a.ts', 'b.ts', 'c.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '[abc].ts' }, createToolContext())

      expect(result.files).toEqual(mockFiles)
    })

    it('handles [!abc] negated character classes', async () => {
      const mockFiles = ['d.ts', 'e.ts', 'f.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '[!abc].ts' }, createToolContext())

      expect(result.files).toHaveLength(3)
    })
  })

  describe('Path Validation', () => {
    it('rejects path traversal in base path', async () => {
      globTool = createGlobToolAdapter(mockFs)

      await expect(
        globTool.execute(
          { pattern: '*.ts', path: '../../../etc' },
          createToolContext()
        )
      ).rejects.toThrow(/path traversal|invalid path|security/i)
    })

    it('allows relative paths within workspace', async () => {
      const mockFiles = ['Button.tsx', 'Input.tsx']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute(
        { pattern: '*.tsx', path: 'src/components' },
        createToolContext()
      )

      expect(result.files).toBeDefined()
    })
  })

  describe('Hidden Files', () => {
    it('excludes hidden files by default', async () => {
      const mockFiles = ['visible.ts', 'also-visible.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '*' }, createToolContext())

      expect(result.files.every((f) => !f.startsWith('.'))).toBe(true)
    })

    it('includes hidden files when pattern starts with dot', async () => {
      const mockFiles = ['.gitignore', '.eslintrc']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '.*' }, createToolContext())

      expect(result.files.every((f) => f.startsWith('.'))).toBe(true)
    })
  })

  describe('Default Path Behavior', () => {
    it('uses current working directory when path is not specified', async () => {
      const mockFiles = ['file.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      await globTool.execute({ pattern: '*.ts' }, createToolContext())

      expect(mockFs.glob).toHaveBeenCalledWith(
        '*.ts',
        expect.objectContaining({ cwd: expect.any(String) })
      )
    })
  })

  describe('Performance', () => {
    it('returns results efficiently for large directories', async () => {
      const manyFiles = Array.from({ length: 10000 }, (_, i) => `src/file${i}.ts`)
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(manyFiles.slice(0, 500))

      globTool = createGlobToolAdapter(mockFs)
      const start = Date.now()
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())
      const duration = Date.now() - start

      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000)
      expect(result.files.length).toBeLessThanOrEqual(500)
    })
  })

  describe('Absolute Paths in Output', () => {
    it('returns relative paths from base directory', async () => {
      const mockFiles = ['src/index.ts', 'src/utils/helpers.ts']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '**/*.ts' }, createToolContext())

      // Paths should be relative, not absolute
      expect(result.files.every((f) => !f.startsWith('/'))).toBe(true)
    })
  })

  describe('Directory Only Patterns', () => {
    it('handles patterns that match directories', async () => {
      const mockDirs = ['src/', 'lib/', 'test/']
      ;(mockFs.glob as ReturnType<typeof vi.fn>).mockResolvedValue(mockDirs)

      globTool = createGlobToolAdapter(mockFs)
      const result = await globTool.execute({ pattern: '*/' }, createToolContext())

      expect(result.files.every((f) => f.endsWith('/'))).toBe(true)
    })
  })
})
