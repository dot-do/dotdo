/**
 * Grep Tool Adapter Tests (RED Phase)
 *
 * Tests for the Grep tool adapter that maps Claude SDK Grep tool to fsx.do.
 * These are failing tests following TDD principles - the implementation
 * does not exist yet.
 *
 * @see dotdo-cleeq - [RED] Grep tool adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FsCapability } from '../../lib/mixins/fs'
import type { ToolDefinition, ToolContext } from '../types'

// ============================================================================
// Types for Grep Tool Adapter
// ============================================================================

interface GrepToolInput {
  pattern: string
  path?: string
  glob?: string
  type?: string // File type like 'ts', 'py', 'rust'
  output_mode?: 'content' | 'files_with_matches' | 'count'
  '-i'?: boolean // Case insensitive
  '-n'?: boolean // Line numbers
  '-A'?: number // Lines after
  '-B'?: number // Lines before
  '-C'?: number // Context lines (both before and after)
  multiline?: boolean
  head_limit?: number
  offset?: number
}

interface GrepMatch {
  file: string
  line?: number
  content?: string
}

interface GrepToolOutput {
  matches: GrepMatch[]
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
    grep: vi.fn(), // Extended for search capability
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
const createGrepToolAdapter = (_fs: FsCapability): ToolDefinition<GrepToolInput, GrepToolOutput> => {
  throw new Error('Not implemented - RED phase')
}

// ============================================================================
// Grep Tool Adapter Tests
// ============================================================================

describe('Grep Tool Adapter', () => {
  let mockFs: FsCapability
  let grepTool: ToolDefinition<GrepToolInput, GrepToolOutput>

  beforeEach(() => {
    mockFs = createMockFs()
  })

  describe('Tool Definition', () => {
    it('creates a tool with name "Grep"', () => {
      grepTool = createGrepToolAdapter(mockFs)
      expect(grepTool.name).toBe('Grep')
    })

    it('has appropriate description mentioning ripgrep compatibility', () => {
      grepTool = createGrepToolAdapter(mockFs)
      expect(grepTool.description.toLowerCase()).toContain('search')
      expect(grepTool.description.toLowerCase()).toContain('pattern')
    })

    it('has inputSchema with pattern as required', () => {
      grepTool = createGrepToolAdapter(mockFs)
      expect(grepTool.inputSchema).toBeDefined()
    })
  })

  describe('Simple Pattern Search', () => {
    it('finds literal string matches', async () => {
      const mockMatches = [
        { file: 'src/index.ts', line: 10, content: 'const errorMessage = "Something went wrong"' },
        { file: 'src/utils.ts', line: 25, content: 'throw new Error("error occurred")' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute({ pattern: 'error' }, createToolContext())

      expect(result.matches).toHaveLength(2)
      expect(result.matches[0].content).toContain('error')
    })

    it('searches in current directory by default', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute({ pattern: 'test' }, createToolContext())

      expect(mockFs.grep).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ path: expect.any(String) })
      )
    })
  })

  describe('Regex Pattern Search', () => {
    it('supports full regex syntax', async () => {
      const mockMatches = [
        { file: 'src/app.ts', line: 5, content: 'function handleError(err: Error) {' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'log.*Error' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith('log.*Error', expect.any(Object))
    })

    it('handles function\\s+\\w+ pattern', async () => {
      const mockMatches = [
        { file: 'src/utils.ts', line: 1, content: 'function myFunction() {}' },
        { file: 'src/utils.ts', line: 10, content: 'function anotherFunc() {}' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'function\\s+\\w+' },
        createToolContext()
      )

      expect(result.matches).toHaveLength(2)
    })

    it('escapes literal braces when searching for interface{}', async () => {
      const mockMatches = [
        { file: 'main.go', line: 5, content: 'func process(data interface{}) {}' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'interface\\{\\}' },
        createToolContext()
      )

      expect(result.matches[0].content).toContain('interface{}')
    })
  })

  describe('Case Insensitive Search (-i)', () => {
    it('finds matches regardless of case when -i is true', async () => {
      const mockMatches = [
        { file: 'README.md', line: 1, content: 'ERROR handling guide' },
        { file: 'docs/guide.md', line: 5, content: 'Error messages' },
        { file: 'src/app.ts', line: 10, content: 'error occurred' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'error', '-i': true },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ caseInsensitive: true })
      )
      expect(result.matches).toHaveLength(3)
    })

    it('is case sensitive by default', async () => {
      const mockMatches = [{ file: 'src/app.ts', line: 10, content: 'error occurred' }]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute({ pattern: 'error' }, createToolContext())

      // Should NOT match ERROR or Error when case sensitive
      expect(mockFs.grep).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ caseInsensitive: false })
      )
    })
  })

  describe('Context Lines (-A/-B/-C)', () => {
    it('includes lines after match with -A', async () => {
      const mockMatches = [
        {
          file: 'src/app.ts',
          line: 10,
          content: 'error occurred\n  console.log("debug")\n  return false',
        },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'error', '-A': 2, output_mode: 'content' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ linesAfter: 2 })
      )
    })

    it('includes lines before match with -B', async () => {
      const mockMatches = [
        {
          file: 'src/app.ts',
          line: 10,
          content: 'function handler() {\n  try {\nerror occurred',
        },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'error', '-B': 2, output_mode: 'content' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ linesBefore: 2 })
      )
    })

    it('includes context lines both before and after with -C', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'error', '-C': 3, output_mode: 'content' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ linesBefore: 3, linesAfter: 3 })
      )
    })
  })

  describe('File Type Filter (--type)', () => {
    it('filters by TypeScript files with type="ts"', async () => {
      const mockMatches = [{ file: 'src/app.ts', line: 5, content: 'const x = 1' }]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'const', type: 'ts' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'const',
        expect.objectContaining({ type: 'ts' })
      )
    })

    it('filters by Python files with type="py"', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'def', type: 'py' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'def',
        expect.objectContaining({ type: 'py' })
      )
    })

    it('supports common file types (js, rust, go, java)', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)

      const types = ['js', 'rust', 'go', 'java']
      for (const type of types) {
        await grepTool.execute({ pattern: 'test', type }, createToolContext())
        expect(mockFs.grep).toHaveBeenCalledWith(
          'test',
          expect.objectContaining({ type })
        )
      }
    })
  })

  describe('Glob Filter', () => {
    it('filters files with glob pattern "*.js"', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'require', glob: '*.js' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'require',
        expect.objectContaining({ glob: '*.js' })
      )
    })

    it('filters with multiple extension glob "*.{ts,tsx}"', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'useState', glob: '*.{ts,tsx}' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'useState',
        expect.objectContaining({ glob: '*.{ts,tsx}' })
      )
    })
  })

  describe('Output Modes', () => {
    describe('content mode (default)', () => {
      it('shows matching lines with content', async () => {
        const mockMatches = [
          { file: 'src/app.ts', line: 10, content: 'const error = new Error()' },
        ]
        ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

        grepTool = createGrepToolAdapter(mockFs)
        const result = await grepTool.execute(
          { pattern: 'error', output_mode: 'content' },
          createToolContext()
        )

        expect(result.matches[0].content).toBeDefined()
        expect(result.matches[0].line).toBeDefined()
      })
    })

    describe('files_with_matches mode', () => {
      it('shows only file paths', async () => {
        const mockMatches = [
          { file: 'src/app.ts' },
          { file: 'src/utils.ts' },
        ]
        ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

        grepTool = createGrepToolAdapter(mockFs)
        const result = await grepTool.execute(
          { pattern: 'error', output_mode: 'files_with_matches' },
          createToolContext()
        )

        expect(result.matches.every((m) => m.file && !m.content)).toBe(true)
      })

      it('is the default output mode', async () => {
        const mockMatches = [{ file: 'src/app.ts' }]
        ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

        grepTool = createGrepToolAdapter(mockFs)
        const result = await grepTool.execute({ pattern: 'error' }, createToolContext())

        // Default should be files_with_matches
        expect(mockFs.grep).toHaveBeenCalledWith(
          'error',
          expect.objectContaining({ outputMode: 'files_with_matches' })
        )
      })
    })

    describe('count mode', () => {
      it('shows match counts per file', async () => {
        const mockMatches = [
          { file: 'src/app.ts', count: 5 },
          { file: 'src/utils.ts', count: 3 },
        ]
        ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

        grepTool = createGrepToolAdapter(mockFs)
        const result = await grepTool.execute(
          { pattern: 'error', output_mode: 'count' },
          createToolContext()
        )

        expect(mockFs.grep).toHaveBeenCalledWith(
          'error',
          expect.objectContaining({ outputMode: 'count' })
        )
      })
    })
  })

  describe('Line Numbers (-n)', () => {
    it('includes line numbers when -n is true', async () => {
      const mockMatches = [
        { file: 'src/app.ts', line: 10, content: 'const x = 1' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'const', '-n': true, output_mode: 'content' },
        createToolContext()
      )

      expect(result.matches[0].line).toBe(10)
    })

    it('line numbers default to true for content mode', async () => {
      const mockMatches = [
        { file: 'src/app.ts', line: 5, content: 'let y = 2' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'let', output_mode: 'content' },
        createToolContext()
      )

      expect(result.matches[0].line).toBeDefined()
    })
  })

  describe('Multiline Mode', () => {
    it('matches patterns spanning multiple lines when multiline=true', async () => {
      const mockMatches = [
        {
          file: 'src/app.ts',
          line: 1,
          content: 'struct {\n  field: string\n}',
        },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'struct \\{[\\s\\S]*?field', multiline: true },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'struct \\{[\\s\\S]*?field',
        expect.objectContaining({ multiline: true })
      )
    })

    it('defaults to single-line matching', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute({ pattern: 'test' }, createToolContext())

      expect(mockFs.grep).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ multiline: false })
      )
    })
  })

  describe('Head Limit', () => {
    it('limits output to first N entries', async () => {
      const manyMatches = Array.from({ length: 100 }, (_, i) => ({
        file: `file${i}.ts`,
        line: i,
        content: `match ${i}`,
      }))
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(manyMatches.slice(0, 10))

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'match', head_limit: 10, output_mode: 'content' },
        createToolContext()
      )

      expect(result.matches.length).toBeLessThanOrEqual(10)
    })

    it('sets truncated=true when limit is applied', async () => {
      const manyMatches = Array.from({ length: 100 }, (_, i) => ({
        file: `file${i}.ts`,
      }))
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(manyMatches.slice(0, 10))

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'match', head_limit: 10 },
        createToolContext()
      )

      expect(result.truncated).toBe(true)
    })
  })

  describe('Offset', () => {
    it('skips first N entries before applying head_limit', async () => {
      const matches = Array.from({ length: 20 }, (_, i) => ({
        file: `file${i}.ts`,
        line: i + 1,
      }))
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(matches.slice(5, 15))

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'test', offset: 5, head_limit: 10 },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ offset: 5, limit: 10 })
      )
    })
  })

  describe('Path Parameter', () => {
    it('searches in specified directory', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      await grepTool.execute(
        { pattern: 'import', path: 'src/components' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith(
        'import',
        expect.objectContaining({ path: 'src/components' })
      )
    })

    it('blocks path traversal attempts', async () => {
      grepTool = createGrepToolAdapter(mockFs)

      await expect(
        grepTool.execute(
          { pattern: 'secret', path: '../../../etc' },
          createToolContext()
        )
      ).rejects.toThrow(/path traversal|invalid path|security/i)
    })
  })

  describe('Empty Results', () => {
    it('returns empty matches array when no results found', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'nonexistent_pattern_xyz' },
        createToolContext()
      )

      expect(result.matches).toEqual([])
      expect(result.truncated).toBe(false)
    })
  })

  describe('Special Characters in Patterns', () => {
    it('handles regex special characters', async () => {
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      grepTool = createGrepToolAdapter(mockFs)

      // Should handle patterns with special regex characters
      await grepTool.execute(
        { pattern: '\\$[a-zA-Z]+' },
        createToolContext()
      )

      expect(mockFs.grep).toHaveBeenCalledWith('\\$[a-zA-Z]+', expect.any(Object))
    })

    it('handles patterns with parentheses', async () => {
      const mockMatches = [
        { file: 'src/app.ts', line: 1, content: 'function(arg) {}' },
      ]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute(
        { pattern: 'function\\([^)]*\\)' },
        createToolContext()
      )

      expect(result.matches).toHaveLength(1)
    })
  })

  describe('Exclusion of Common Directories', () => {
    it('excludes node_modules by default', async () => {
      const mockMatches = [{ file: 'src/app.ts' }]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute({ pattern: 'import' }, createToolContext())

      expect(result.matches.every((m) => !m.file.includes('node_modules'))).toBe(true)
    })

    it('excludes .git directory by default', async () => {
      const mockMatches = [{ file: 'src/app.ts' }]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute({ pattern: 'commit' }, createToolContext())

      expect(result.matches.every((m) => !m.file.includes('.git/'))).toBe(true)
    })
  })

  describe('Binary File Handling', () => {
    it('skips binary files by default', async () => {
      // Binary files should be excluded from search results
      const mockMatches = [{ file: 'src/app.ts', line: 1, content: 'const x = 1' }]
      ;(mockFs.grep as ReturnType<typeof vi.fn>).mockResolvedValue(mockMatches)

      grepTool = createGrepToolAdapter(mockFs)
      const result = await grepTool.execute({ pattern: 'const' }, createToolContext())

      // Should not include files like .png, .jpg, .exe, etc.
      expect(
        result.matches.every(
          (m) =>
            !m.file.endsWith('.png') &&
            !m.file.endsWith('.jpg') &&
            !m.file.endsWith('.exe')
        )
      ).toBe(true)
    })
  })
})
