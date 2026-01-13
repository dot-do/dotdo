/**
 * Read Tool Adapter Tests (RED Phase)
 *
 * Tests for the Read tool adapter that maps Claude SDK Read tool to fsx.do.
 * These are failing tests following TDD principles - the implementation
 * does not exist yet.
 *
 * @see dotdo-7fqvc - [RED] Read tool adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FsCapability } from '../../lib/mixins/fs'
import type { ToolDefinition, ToolContext } from '../types'

// ============================================================================
// Types for Read Tool Adapter
// ============================================================================

interface ReadToolInput {
  file_path: string
  offset?: number
  limit?: number
}

interface ReadToolOutput {
  content: string | { type: 'base64'; data: string; media_type: string }
  truncated?: boolean
  total_lines?: number
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

// This import will fail - that's expected in RED phase
// import { createReadToolAdapter } from './read-adapter'

// Placeholder until we implement the adapter
const createReadToolAdapter = (_fs: FsCapability): ToolDefinition<ReadToolInput, ReadToolOutput> => {
  throw new Error('Not implemented - RED phase')
}

// ============================================================================
// Read Tool Adapter Tests
// ============================================================================

describe('Read Tool Adapter', () => {
  let mockFs: FsCapability
  let readTool: ToolDefinition<ReadToolInput, ReadToolOutput>

  beforeEach(() => {
    mockFs = createMockFs()
  })

  describe('Tool Definition', () => {
    it('creates a tool with name "Read"', () => {
      readTool = createReadToolAdapter(mockFs)
      expect(readTool.name).toBe('Read')
    })

    it('has appropriate description for Claude SDK', () => {
      readTool = createReadToolAdapter(mockFs)
      expect(readTool.description).toContain('file')
      expect(readTool.description).toContain('read')
    })

    it('has inputSchema with file_path as required', () => {
      readTool = createReadToolAdapter(mockFs)
      // Should validate that file_path is required
      expect(readTool.inputSchema).toBeDefined()
    })

    it('has inputSchema with optional offset and limit', () => {
      readTool = createReadToolAdapter(mockFs)
      // offset and limit should be optional number parameters
      expect(readTool.inputSchema).toBeDefined()
    })
  })

  describe('Basic File Reading', () => {
    it('reads text file and returns content as string', async () => {
      const fileContent = 'Hello, World!\nThis is a test file.'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt' },
        createToolContext()
      )

      expect(mockFs.read).toHaveBeenCalledWith('/path/to/file.txt', expect.any(Object))
      expect(result.content).toBe(fileContent)
    })

    it('reads empty file and returns empty string', async () => {
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue('')

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/empty.txt' },
        createToolContext()
      )

      expect(result.content).toBe('')
    })

    it('includes total_lines count in output', async () => {
      const fileContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt' },
        createToolContext()
      )

      expect(result.total_lines).toBe(5)
    })
  })

  describe('Partial File Reading (offset/limit)', () => {
    it('reads with offset - skips first N lines', async () => {
      const fullContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fullContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt', offset: 2 },
        createToolContext()
      )

      // Should start from line 3 (0-indexed offset of 2)
      expect(result.content).toBe('Line 3\nLine 4\nLine 5')
    })

    it('reads with limit - returns only N lines', async () => {
      const fullContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fullContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt', limit: 2 },
        createToolContext()
      )

      expect(result.content).toBe('Line 1\nLine 2')
      expect(result.truncated).toBe(true)
    })

    it('reads with offset and limit combined', async () => {
      const fullContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fullContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt', offset: 1, limit: 2 },
        createToolContext()
      )

      // Start from line 2 (offset 1), take 2 lines
      expect(result.content).toBe('Line 2\nLine 3')
      expect(result.truncated).toBe(true)
    })

    it('sets truncated=true when content is limited', async () => {
      const fullContent = 'Line 1\nLine 2\nLine 3'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fullContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt', limit: 2 },
        createToolContext()
      )

      expect(result.truncated).toBe(true)
    })

    it('sets truncated=false when all content is returned', async () => {
      const fullContent = 'Line 1\nLine 2\nLine 3'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fullContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt' },
        createToolContext()
      )

      expect(result.truncated).toBe(false)
    })

    it('handles offset beyond file length', async () => {
      const fullContent = 'Line 1\nLine 2\nLine 3'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fullContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt', offset: 100 },
        createToolContext()
      )

      expect(result.content).toBe('')
      expect(result.truncated).toBe(false)
    })
  })

  describe('Binary File Reading', () => {
    it('reads binary file and returns Uint8Array content', async () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(binaryData)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/image.bin' },
        createToolContext()
      )

      expect(result.content).toEqual(binaryData)
    })
  })

  describe('Image File Reading (Multimodal)', () => {
    it('reads PNG file and returns base64 encoded content', async () => {
      const imageBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(imageBuffer)
      ;(mockFs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 8, isFile: true })

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/image.png' },
        createToolContext()
      )

      expect(result.content).toEqual({
        type: 'base64',
        data: expect.any(String),
        media_type: 'image/png',
      })
    })

    it('reads JPG file and returns base64 with correct media_type', async () => {
      const jpgHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(jpgHeader)
      ;(mockFs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 4, isFile: true })

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/photo.jpg' },
        createToolContext()
      )

      const content = result.content as { type: 'base64'; data: string; media_type: string }
      expect(content.type).toBe('base64')
      expect(content.media_type).toBe('image/jpeg')
    })

    it('reads GIF file with correct media_type', async () => {
      const gifHeader = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(gifHeader)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/animation.gif' },
        createToolContext()
      )

      const content = result.content as { type: 'base64'; data: string; media_type: string }
      expect(content.media_type).toBe('image/gif')
    })

    it('reads WebP file with correct media_type', async () => {
      const webpHeader = new Uint8Array([0x52, 0x49, 0x46, 0x46]) // RIFF
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(webpHeader)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/image.webp' },
        createToolContext()
      )

      const content = result.content as { type: 'base64'; data: string; media_type: string }
      expect(content.media_type).toBe('image/webp')
    })
  })

  describe('PDF File Reading', () => {
    it('reads PDF file and extracts text content', async () => {
      // PDF files should return extracted text, not raw binary
      const pdfContent = 'Extracted text from PDF document'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(pdfContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/document.pdf' },
        createToolContext()
      )

      expect(typeof result.content).toBe('string')
      expect(result.content).toBe(pdfContent)
    })

    it('handles multi-page PDF and returns all pages', async () => {
      const multiPagePdf = 'Page 1 content\n\n--- Page 2 ---\n\nPage 2 content'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(multiPagePdf)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/multi-page.pdf' },
        createToolContext()
      )

      expect(result.content).toContain('Page 1 content')
      expect(result.content).toContain('Page 2 content')
    })
  })

  describe('Jupyter Notebook Reading', () => {
    it('reads .ipynb file and returns cells with outputs', async () => {
      const notebookJson = JSON.stringify({
        cells: [
          {
            cell_type: 'markdown',
            source: ['# Notebook Title'],
          },
          {
            cell_type: 'code',
            source: ['print("Hello")'],
            outputs: [{ output_type: 'stream', text: ['Hello\n'] }],
          },
        ],
      })
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(notebookJson)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/notebook.ipynb' },
        createToolContext()
      )

      // Should return formatted notebook content
      expect(typeof result.content).toBe('string')
      expect(result.content).toContain('# Notebook Title')
      expect(result.content).toContain('print("Hello")')
    })

    it('includes code cell outputs in notebook rendering', async () => {
      const notebookJson = JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            source: ['2 + 2'],
            outputs: [
              {
                output_type: 'execute_result',
                data: { 'text/plain': ['4'] },
              },
            ],
          },
        ],
      })
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(notebookJson)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/notebook.ipynb' },
        createToolContext()
      )

      expect(result.content).toContain('4')
    })
  })

  describe('Error Handling', () => {
    it('returns appropriate error for non-existent file', async () => {
      const error = new Error('ENOENT: no such file or directory')
      ;(error as any).code = 'ENOENT'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      readTool = createReadToolAdapter(mockFs)

      await expect(
        readTool.execute({ file_path: '/path/to/nonexistent.txt' }, createToolContext())
      ).rejects.toThrow('ENOENT')
    })

    it('returns error when reading a directory', async () => {
      const error = new Error('EISDIR: illegal operation on a directory')
      ;(error as any).code = 'EISDIR'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      readTool = createReadToolAdapter(mockFs)

      await expect(
        readTool.execute({ file_path: '/path/to/directory' }, createToolContext())
      ).rejects.toThrow('EISDIR')
    })

    it('returns error for permission denied', async () => {
      const error = new Error('EACCES: permission denied')
      ;(error as any).code = 'EACCES'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      readTool = createReadToolAdapter(mockFs)

      await expect(
        readTool.execute({ file_path: '/path/to/protected.txt' }, createToolContext())
      ).rejects.toThrow('EACCES')
    })
  })

  describe('Security - Path Traversal Prevention', () => {
    it('blocks path traversal attempts with ../', async () => {
      readTool = createReadToolAdapter(mockFs)

      await expect(
        readTool.execute({ file_path: '../../../etc/passwd' }, createToolContext())
      ).rejects.toThrow(/path traversal|invalid path|security/i)
    })

    it('blocks absolute paths outside workspace', async () => {
      readTool = createReadToolAdapter(mockFs)

      await expect(
        readTool.execute({ file_path: '/etc/passwd' }, createToolContext())
      ).rejects.toThrow(/invalid path|outside workspace|security/i)
    })

    it('blocks encoded path traversal attempts', async () => {
      readTool = createReadToolAdapter(mockFs)

      await expect(
        readTool.execute({ file_path: '..%2F..%2F..%2Fetc%2Fpasswd' }, createToolContext())
      ).rejects.toThrow(/path traversal|invalid path|security/i)
    })

    it('allows relative paths within workspace', async () => {
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue('file content')

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: 'src/index.ts' },
        createToolContext()
      )

      expect(mockFs.read).toHaveBeenCalled()
      expect(result.content).toBe('file content')
    })
  })

  describe('Large File Handling', () => {
    it('handles files larger than 1MB with chunked reads', async () => {
      const largeLine = 'x'.repeat(1000) + '\n'
      const largeContent = largeLine.repeat(2000) // ~2MB
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(largeContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/large-file.txt' },
        createToolContext()
      )

      expect(result.content).toBeDefined()
      expect(result.truncated).toBe(true)
    })

    it('default limit is applied to very large files', async () => {
      const veryLargeContent = 'line\n'.repeat(10000)
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(veryLargeContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/very-large.txt' },
        createToolContext()
      )

      // Default limit should be 2000 lines per Claude SDK behavior
      expect(result.total_lines).toBe(10000)
      expect(result.truncated).toBe(true)
    })

    it('truncates lines longer than 2000 characters', async () => {
      const longLine = 'x'.repeat(5000)
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(longLine)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/long-line.txt' },
        createToolContext()
      )

      // Lines should be truncated at 2000 chars per Claude SDK
      expect((result.content as string).length).toBeLessThanOrEqual(2000 + 50) // Allow for truncation marker
    })
  })

  describe('Line Number Formatting', () => {
    it('returns content with line numbers in cat -n format', async () => {
      const fileContent = 'Line 1\nLine 2\nLine 3'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt' },
        createToolContext()
      )

      // Claude SDK returns files in cat -n format: "     1\tLine content"
      expect(result.content).toMatch(/^\s+1\t/)
      expect(result.content).toContain('\t')
    })

    it('line numbers start at 1', async () => {
      const fileContent = 'First line'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt' },
        createToolContext()
      )

      // First line should be numbered 1, not 0
      expect(result.content).toMatch(/1\t/)
      expect(result.content).not.toMatch(/0\t/)
    })

    it('respects offset when numbering lines', async () => {
      const fileContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt', offset: 2 },
        createToolContext()
      )

      // When offset=2, first displayed line should be numbered 3
      expect(result.content).toMatch(/3\t/)
    })
  })

  describe('File Type Detection', () => {
    it('detects text files by extension', async () => {
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue('text content')

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.txt' },
        createToolContext()
      )

      expect(typeof result.content).toBe('string')
    })

    it('detects code files as text', async () => {
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue('const x = 1;')

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/file.ts' },
        createToolContext()
      )

      expect(typeof result.content).toBe('string')
      expect(result.content).toContain('const x = 1;')
    })

    it('detects JSON files as text', async () => {
      const jsonContent = '{"key": "value"}'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(jsonContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/data.json' },
        createToolContext()
      )

      expect(typeof result.content).toBe('string')
    })

    it('detects SVG files as text', async () => {
      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
      ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(svgContent)

      readTool = createReadToolAdapter(mockFs)
      const result = await readTool.execute(
        { file_path: '/path/to/image.svg' },
        createToolContext()
      )

      expect(typeof result.content).toBe('string')
      expect(result.content).toContain('<svg')
    })
  })
})
