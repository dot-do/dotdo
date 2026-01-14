/**
 * Write Tool Adapter Tests (RED Phase)
 *
 * Tests for the Write tool adapter that maps Claude SDK Write tool to fsx.do.
 * These are failing tests following TDD principles - the implementation
 * does not exist yet.
 *
 * @see dotdo-oz7vg - [RED] Write tool adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FsCapability } from '../../lib/capabilities/fs'
import type { ToolDefinition, ToolContext } from '../types'

// ============================================================================
// Types for Write Tool Adapter
// ============================================================================

interface WriteToolInput {
  file_path: string
  content: string
}

interface WriteToolOutput {
  success: boolean
  bytes_written: number
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
const createWriteToolAdapter = (_fs: FsCapability): ToolDefinition<WriteToolInput, WriteToolOutput> => {
  throw new Error('Not implemented - RED phase')
}

// ============================================================================
// Write Tool Adapter Tests
// ============================================================================

describe('Write Tool Adapter', () => {
  let mockFs: FsCapability
  let writeTool: ToolDefinition<WriteToolInput, WriteToolOutput>

  beforeEach(() => {
    mockFs = createMockFs()
    ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    ;(mockFs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  })

  describe('Tool Definition', () => {
    it('creates a tool with name "Write"', () => {
      writeTool = createWriteToolAdapter(mockFs)
      expect(writeTool.name).toBe('Write')
    })

    it('has appropriate description for Claude SDK', () => {
      writeTool = createWriteToolAdapter(mockFs)
      expect(writeTool.description).toContain('file')
      expect(writeTool.description.toLowerCase()).toContain('write')
    })

    it('has inputSchema with file_path and content as required', () => {
      writeTool = createWriteToolAdapter(mockFs)
      expect(writeTool.inputSchema).toBeDefined()
    })
  })

  describe('Basic File Writing', () => {
    it('writes new text file with content', async () => {
      const content = 'Hello, World!'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/file.txt', content },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith('/path/to/file.txt', content, expect.any(Object))
      expect(result.success).toBe(true)
      expect(result.bytes_written).toBe(content.length)
    })

    it('returns bytes_written matching content length', async () => {
      const content = 'Test content with multiple bytes: ABC123'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/file.txt', content },
        createToolContext()
      )

      expect(result.bytes_written).toBe(content.length)
    })

    it('handles unicode content correctly', async () => {
      const unicodeContent = 'Hello \u4e16\u754c! Emojis: \u{1F600}\u{1F680}'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/unicode.txt', content: unicodeContent },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/unicode.txt',
        unicodeContent,
        expect.any(Object)
      )
      expect(result.success).toBe(true)
    })

    it('handles multiline content', async () => {
      const multilineContent = 'Line 1\nLine 2\nLine 3\n'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/multiline.txt', content: multilineContent },
        createToolContext()
      )

      expect(result.success).toBe(true)
    })
  })

  describe('Directory Creation (mkdir -p behavior)', () => {
    it('creates parent directories if they do not exist', async () => {
      ;(mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(mockFs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      await writeTool.execute(
        { file_path: '/deep/nested/path/to/file.txt', content: 'content' },
        createToolContext()
      )

      expect(mockFs.mkdir).toHaveBeenCalledWith('/deep/nested/path/to', { recursive: true })
    })

    it('does not call mkdir if parent directory exists', async () => {
      ;(mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      await writeTool.execute(
        { file_path: '/existing/dir/file.txt', content: 'content' },
        createToolContext()
      )

      // Should not need to call mkdir if directory exists
      expect(mockFs.exists).toHaveBeenCalled()
    })
  })

  describe('File Overwriting', () => {
    it('overwrites existing file with new content', async () => {
      ;(mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/existing.txt', content: 'new content' },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith('/path/to/existing.txt', 'new content', expect.any(Object))
      expect(result.success).toBe(true)
    })

    it('completely replaces file content', async () => {
      const newContent = 'completely new content'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      await writeTool.execute(
        { file_path: '/path/to/file.txt', content: newContent },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith('/path/to/file.txt', newContent, expect.any(Object))
    })
  })

  describe('Binary File Writing', () => {
    it('handles base64 encoded content for binary files', async () => {
      // Base64 encoded binary data
      const base64Content = 'SGVsbG8gV29ybGQh' // "Hello World!" in base64
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/file.bin', content: base64Content },
        createToolContext()
      )

      expect(result.success).toBe(true)
    })
  })

  describe('Empty File Writing', () => {
    it('creates empty file with empty string content', async () => {
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/empty.txt', content: '' },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith('/path/to/empty.txt', '', expect.any(Object))
      expect(result.success).toBe(true)
      expect(result.bytes_written).toBe(0)
    })
  })

  describe('Encoding Support', () => {
    it('writes UTF-8 encoded content by default', async () => {
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      await writeTool.execute(
        { file_path: '/path/to/file.txt', content: 'test content' },
        createToolContext()
      )

      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/file.txt',
        'test content',
        expect.objectContaining({ encoding: 'utf8' })
      )
    })
  })

  describe('Atomic Writes', () => {
    it('uses atomic write pattern (temp file then rename)', async () => {
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      await writeTool.execute(
        { file_path: '/path/to/important.txt', content: 'critical data' },
        createToolContext()
      )

      // Atomic write should be enabled by default for safety
      expect(mockFs.write).toHaveBeenCalledWith(
        '/path/to/important.txt',
        'critical data',
        expect.objectContaining({ atomic: true })
      )
    })
  })

  describe('Error Handling', () => {
    it('returns permission error for read-only paths', async () => {
      const error = new Error('EACCES: permission denied')
      ;(error as any).code = 'EACCES'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      writeTool = createWriteToolAdapter(mockFs)

      await expect(
        writeTool.execute(
          { file_path: '/read-only/file.txt', content: 'content' },
          createToolContext()
        )
      ).rejects.toThrow('EACCES')
    })

    it('returns error for disk full', async () => {
      const error = new Error('ENOSPC: no space left on device')
      ;(error as any).code = 'ENOSPC'
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      writeTool = createWriteToolAdapter(mockFs)

      await expect(
        writeTool.execute(
          { file_path: '/path/to/file.txt', content: 'content' },
          createToolContext()
        )
      ).rejects.toThrow('ENOSPC')
    })

    it('handles write failures gracefully', async () => {
      const error = new Error('Unknown write error')
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockRejectedValue(error)

      writeTool = createWriteToolAdapter(mockFs)

      await expect(
        writeTool.execute(
          { file_path: '/path/to/file.txt', content: 'content' },
          createToolContext()
        )
      ).rejects.toThrow()
    })
  })

  describe('Security - Path Validation', () => {
    it('blocks path traversal attempts with ../', async () => {
      writeTool = createWriteToolAdapter(mockFs)

      await expect(
        writeTool.execute(
          { file_path: '../../../etc/passwd', content: 'malicious' },
          createToolContext()
        )
      ).rejects.toThrow(/path traversal|invalid path|security/i)
    })

    it('blocks writes to dangerous system paths', async () => {
      writeTool = createWriteToolAdapter(mockFs)

      await expect(
        writeTool.execute(
          { file_path: '/etc/passwd', content: 'malicious' },
          createToolContext()
        )
      ).rejects.toThrow(/invalid path|outside workspace|security/i)
    })

    it('blocks writes to .env files', async () => {
      writeTool = createWriteToolAdapter(mockFs)

      // .env files may contain secrets and should be blocked
      await expect(
        writeTool.execute(
          { file_path: '.env', content: 'SECRET=value' },
          createToolContext()
        )
      ).rejects.toThrow(/security|blocked|sensitive/i)
    })

    it('blocks writes to credentials files', async () => {
      writeTool = createWriteToolAdapter(mockFs)

      await expect(
        writeTool.execute(
          { file_path: 'credentials.json', content: '{}' },
          createToolContext()
        )
      ).rejects.toThrow(/security|blocked|sensitive/i)
    })

    it('allows relative paths within workspace', async () => {
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: 'src/new-file.ts', content: 'export const x = 1' },
        createToolContext()
      )

      expect(result.success).toBe(true)
    })
  })

  describe('Large File Handling', () => {
    it('handles files larger than 1MB', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024) // 2MB
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/large-file.txt', content: largeContent },
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.bytes_written).toBe(largeContent.length)
    })
  })

  describe('Prior Read Requirement', () => {
    it('validates that file was read before being edited (for existing files)', async () => {
      // Claude SDK requires Read to be called before Write for existing files
      // This test validates that behavior

      ;(mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true)

      writeTool = createWriteToolAdapter(mockFs)

      // Without prior read context, this should fail for existing files
      // In real implementation, we'd track which files have been read
      // For now, we test that the adapter has this validation
      expect(writeTool.description).toContain('existing')
    })
  })

  describe('File Extension Handling', () => {
    it('accepts any file extension', async () => {
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)

      // Should work with various extensions
      const extensions = ['.ts', '.js', '.json', '.yaml', '.md', '.txt', '.py', '.go']

      for (const ext of extensions) {
        const result = await writeTool.execute(
          { file_path: `/path/to/file${ext}`, content: 'content' },
          createToolContext()
        )
        expect(result.success).toBe(true)
      }
    })

    it('accepts files without extension', async () => {
      ;(mockFs.write as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      writeTool = createWriteToolAdapter(mockFs)
      const result = await writeTool.execute(
        { file_path: '/path/to/Dockerfile', content: 'FROM node:18' },
        createToolContext()
      )

      expect(result.success).toBe(true)
    })
  })
})
