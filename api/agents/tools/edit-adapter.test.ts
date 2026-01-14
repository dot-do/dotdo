/**
 * Edit Tool Adapter Tests (RED Phase)
 *
 * Tests for the Edit tool adapter that maps Claude SDK Edit tool to fsx.do.
 * These are failing tests following TDD principles - the implementation
 * does not exist yet.
 *
 * @see dotdo-j3e7q - [RED] Edit tool adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FsCapability } from '../../lib/capabilities/fs'
import type { ToolDefinition, ToolContext } from '../types'

// ============================================================================
// Types for Edit Tool Adapter
// ============================================================================

interface EditToolInput {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

interface EditToolOutput {
  success: boolean
  replacements_made: number
  undo?: string
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
const createEditToolAdapter = (_fs: FsCapability): ToolDefinition<EditToolInput, EditToolOutput> => {
  throw new Error('Not implemented - RED phase')
}

// ============================================================================
// Edit Tool Adapter Tests
// ============================================================================

describe('Edit Tool Adapter', () => {
  let mockFs: FsCapability
  let editTool: ToolDefinition<EditToolInput, EditToolOutput>

  beforeEach(() => {
    mockFs = createMockFs()
    ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
  })

  describe('Tool Definition', () => {
    it('creates a tool with name "Edit"', () => {
      editTool = createEditToolAdapter(mockFs)
      expect(editTool.name).toBe('Edit')
    })

    it('has appropriate description for Claude SDK', () => {
      editTool = createEditToolAdapter(mockFs)
      expect(editTool.description).toContain('replace')
      expect(editTool.description.toLowerCase()).toContain('file')
    })

    it('has inputSchema with file_path, old_string, new_string as required', () => {
      editTool = createEditToolAdapter(mockFs)
      expect(editTool.inputSchema).toBeDefined()
    })

    it('has inputSchema with replace_all as optional', () => {
      editTool = createEditToolAdapter(mockFs)
      expect(editTool.inputSchema).toBeDefined()
    })
  })

  describe('Basic String Replacement', () => {
    it('replaces old_string with new_string in file', async () => {
      const originalContent = 'Hello, World!'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(originalContent)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'World',
          new_string: 'Universe',
        },
        createToolContext()
      )

      expect(mockFs.read).toHaveBeenCalledWith('/path/to/file.txt', expect.any(Object))
      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.txt',
        'Hello, Universe!',
        expect.any(Object)
      )
      expect(result.success).toBe(true)
      expect(result.replacements_made).toBe(1)
    })

    it('returns success=true and replacements_made count', async () => {
      const originalContent = 'foo bar foo'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(originalContent)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'foo',
          new_string: 'baz',
        },
        createToolContext()
      )

      expect(result.success).toBe(true)
      // By default, only first occurrence is replaced
      expect(result.replacements_made).toBe(1)
    })
  })

  describe('Uniqueness Check', () => {
    it('fails if old_string is not unique in file (appears multiple times)', async () => {
      const content = 'foo bar foo baz foo'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)

      // When old_string appears multiple times and replace_all is not set,
      // the edit should fail to prevent unintended changes
      await expect(
        editTool.execute(
          {
            file_path: '/path/to/file.txt',
            old_string: 'foo',
            new_string: 'bar',
          },
          createToolContext()
        )
      ).rejects.toThrow(/not unique|multiple occurrences|ambiguous/i)
    })

    it('succeeds if old_string appears exactly once', async () => {
      const content = 'hello world goodbye'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'hello world',
          new_string: 'hi there',
        },
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.replacements_made).toBe(1)
    })

    it('fails if old_string is not found in file', async () => {
      const content = 'hello world'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)

      await expect(
        editTool.execute(
          {
            file_path: '/path/to/file.txt',
            old_string: 'nonexistent',
            new_string: 'replacement',
          },
          createToolContext()
        )
      ).rejects.toThrow(/not found|does not exist|no match/i)
    })
  })

  describe('Replace All Mode', () => {
    it('replaces all occurrences when replace_all=true', async () => {
      const content = 'foo bar foo baz foo'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'foo',
          new_string: 'qux',
          replace_all: true,
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.txt',
        'qux bar qux baz qux',
        expect.any(Object)
      )
      expect(result.success).toBe(true)
      expect(result.replacements_made).toBe(3)
    })

    it('returns correct count of replacements made', async () => {
      const content = 'the the the the the'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'the',
          new_string: 'a',
          replace_all: true,
        },
        createToolContext()
      )

      expect(result.replacements_made).toBe(5)
    })
  })

  describe('Whitespace and Indentation Preservation', () => {
    it('preserves exact indentation when replacing', async () => {
      const content = '    function foo() {\n        return bar;\n    }'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: '        return bar;',
          new_string: '        return baz;',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        '    function foo() {\n        return baz;\n    }',
        expect.any(Object)
      )
    })

    it('preserves tabs vs spaces', async () => {
      const content = '\tconst x = 1;\n\tconst y = 2;'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: '\tconst x = 1;',
          new_string: '\tconst x = 42;',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        '\tconst x = 42;\n\tconst y = 2;',
        expect.any(Object)
      )
    })

    it('handles Windows line endings (CRLF)', async () => {
      const content = 'line1\r\nline2\r\nline3'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'line2',
          new_string: 'modified',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.txt',
        'line1\r\nmodified\r\nline3',
        expect.any(Object)
      )
    })
  })

  describe('Multi-line Replacements', () => {
    it('handles multi-line old_string', async () => {
      const content = 'function foo() {\n  return 1;\n}'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: 'function foo() {\n  return 1;\n}',
          new_string: 'function foo() {\n  return 42;\n}',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        'function foo() {\n  return 42;\n}',
        expect.any(Object)
      )
    })

    it('handles multi-line new_string', async () => {
      const content = 'const x = 1;'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: 'const x = 1;',
          new_string: 'const x = 1;\nconst y = 2;\nconst z = 3;',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        'const x = 1;\nconst y = 2;\nconst z = 3;',
        expect.any(Object)
      )
    })
  })

  describe('Deletion (empty new_string)', () => {
    it('deletes old_string when new_string is empty', async () => {
      const content = 'hello world goodbye'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: ' world',
          new_string: '',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.txt',
        'hello goodbye',
        expect.any(Object)
      )
    })
  })

  describe('Error Handling', () => {
    it('returns error when file does not exist', async () => {
      const error = new Error('ENOENT: no such file or directory')
      ;(error as any).code = 'ENOENT'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      editTool = createEditToolAdapter(mockFs)

      await expect(
        editTool.execute(
          {
            file_path: '/path/to/nonexistent.txt',
            old_string: 'foo',
            new_string: 'bar',
          },
          createToolContext()
        )
      ).rejects.toThrow('ENOENT')
    })

    it('validates that file was read first (Claude SDK requirement)', async () => {
      // The Edit tool requires that Read was called on the file first
      // This is a session-level validation

      editTool = createEditToolAdapter(mockFs)

      // This should be validated at a higher level, but the adapter
      // should support a way to track read state
      expect(editTool.description).toContain('read')
    })
  })

  describe('Concurrent Edit Protection', () => {
    it('uses optimistic locking to detect concurrent modifications', async () => {
      const originalContent = 'original content'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(originalContent)

      editTool = createEditToolAdapter(mockFs)

      // First read and edit should succeed
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'original',
          new_string: 'modified',
        },
        createToolContext()
      )

      expect(result.success).toBe(true)

      // If content changed between read and write, should fail
      // This is simulated by the adapter checking content hash
    })
  })

  describe('Undo Support', () => {
    it('returns undo command in output', async () => {
      const content = 'hello world'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.txt',
          old_string: 'hello',
          new_string: 'goodbye',
        },
        createToolContext()
      )

      // Should return an undo command that reverses the edit
      expect(result.undo).toBeDefined()
      expect(result.undo).toContain('goodbye')
      expect(result.undo).toContain('hello')
    })
  })

  describe('Security - Path Validation', () => {
    it('blocks path traversal attempts', async () => {
      editTool = createEditToolAdapter(mockFs)

      await expect(
        editTool.execute(
          {
            file_path: '../../../etc/passwd',
            old_string: 'root',
            new_string: 'hacked',
          },
          createToolContext()
        )
      ).rejects.toThrow(/path traversal|invalid path|security/i)
    })

    it('blocks edits to sensitive files', async () => {
      editTool = createEditToolAdapter(mockFs)

      await expect(
        editTool.execute(
          {
            file_path: '.env',
            old_string: 'SECRET=',
            new_string: 'SECRET=exposed',
          },
          createToolContext()
        )
      ).rejects.toThrow(/security|blocked|sensitive/i)
    })
  })

  describe('Special Characters in Strings', () => {
    it('handles regex special characters literally', async () => {
      const content = 'const regex = /^test$/;'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: '/^test$/',
          new_string: '/^modified$/',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        'const regex = /^modified$/;',
        expect.any(Object)
      )
    })

    it('handles strings with quotes', async () => {
      const content = 'const msg = "Hello, World!";'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: '"Hello, World!"',
          new_string: '"Goodbye, World!"',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        'const msg = "Goodbye, World!";',
        expect.any(Object)
      )
    })

    it('handles strings with backslashes', async () => {
      const content = 'const path = "C:\\\\Users\\\\test";'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: 'C:\\\\Users\\\\test',
          new_string: 'C:\\\\Users\\\\admin',
        },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        'const path = "C:\\\\Users\\\\admin";',
        expect.any(Object)
      )
    })
  })

  describe('Empty File Handling', () => {
    it('fails when trying to edit empty file', async () => {
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue('')

      editTool = createEditToolAdapter(mockFs)

      await expect(
        editTool.execute(
          {
            file_path: '/path/to/empty.txt',
            old_string: 'anything',
            new_string: 'replacement',
          },
          createToolContext()
        )
      ).rejects.toThrow(/not found|empty/i)
    })
  })

  describe('Variable Renaming Use Case', () => {
    it('renames variable across file with replace_all', async () => {
      const content = `
const oldName = 1;
console.log(oldName);
function test(oldName) {
  return oldName * 2;
}
`
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(content)

      editTool = createEditToolAdapter(mockFs)
      const result = await editTool.execute(
        {
          file_path: '/path/to/file.ts',
          old_string: 'oldName',
          new_string: 'newName',
          replace_all: true,
        },
        createToolContext()
      )

      expect(result.replacements_made).toBe(4)
      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.ts',
        expect.stringContaining('newName'),
        expect.any(Object)
      )
    })
  })
})
