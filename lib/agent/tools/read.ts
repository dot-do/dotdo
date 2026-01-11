/**
 * Read Tool Adapter
 *
 * Maps Claude SDK Read tool to fsx.do filesystem capabilities.
 * Supports text files, binary files (base64), images (multimodal),
 * and partial reads with offset/limit.
 *
 * @module lib/agent/tools/read
 */

import type {
  ToolAdapter,
  ToolContext,
  ReadToolInput,
  ReadToolOutput,
  JSONSchema,
} from './types'
import {
  FileNotFoundError,
  IsDirectoryError,
  PathTraversalError,
  BINARY_MIME_TYPES,
  IMAGE_EXTENSIONS,
} from './types'

/**
 * Maximum file size for direct reading (1MB)
 * Files larger than this will be chunked
 */
const MAX_DIRECT_READ_SIZE = 1024 * 1024

/**
 * Default line limit if file is too large
 */
const DEFAULT_LINE_LIMIT = 2000

/**
 * Maximum line length before truncation
 */
const MAX_LINE_LENGTH = 2000

/**
 * Validate and normalize a file path
 * Prevents path traversal attacks
 */
function validatePath(path: string): string {
  // Must be absolute
  if (!path.startsWith('/')) {
    throw new PathTraversalError(path)
  }

  // Normalize the path
  const parts = path.split('/').filter(Boolean)
  const resolved: string[] = []

  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) {
        // Trying to go above root
        throw new PathTraversalError(path)
      }
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }

  return '/' + resolved.join('/')
}

/**
 * Get the file extension from a path
 */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.')
  const lastSlash = path.lastIndexOf('/')
  if (lastDot === -1 || lastDot < lastSlash) return ''
  return path.slice(lastDot).toLowerCase()
}

/**
 * Check if a file is binary based on extension
 */
function isBinaryFile(path: string): boolean {
  const ext = getExtension(path)
  return ext in BINARY_MIME_TYPES
}

/**
 * Check if a file is an image
 */
function isImageFile(path: string): boolean {
  const ext = getExtension(path)
  return IMAGE_EXTENSIONS.has(ext)
}

/**
 * Get MIME type for a file
 */
function getMimeType(path: string): string {
  const ext = getExtension(path)
  return BINARY_MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Convert Uint8Array to base64
 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/**
 * Apply line numbering in cat -n format
 */
function formatWithLineNumbers(
  content: string,
  startLine: number = 1
): string {
  const lines = content.split('\n')
  const maxLineNum = startLine + lines.length - 1
  const numWidth = String(maxLineNum).length

  return lines.map((line, i) => {
    const lineNum = startLine + i
    const paddedNum = String(lineNum).padStart(numWidth, ' ')
    // Truncate long lines
    const truncatedLine = line.length > MAX_LINE_LENGTH
      ? line.slice(0, MAX_LINE_LENGTH) + '...'
      : line
    return `${paddedNum}\t${truncatedLine}`
  }).join('\n')
}

/**
 * Read Tool Adapter
 *
 * Reads file contents from the filesystem. Supports:
 * - Text files (returns string with line numbers)
 * - Binary files (returns base64-encoded)
 * - Images (returns base64 for multimodal)
 * - Partial reads with offset/limit
 */
export class ReadToolAdapter implements ToolAdapter<ReadToolInput, ReadToolOutput> {
  readonly name = 'Read'

  readonly description = `Reads a file from the local filesystem. You can access any file directly by using this tool.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${DEFAULT_LINE_LIMIT} lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files)
- Any lines longer than ${MAX_LINE_LENGTH} characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows reading images (PNG, JPG, etc) for multimodal analysis
- This tool can read PDF files and Jupyter notebooks`

  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed). Only provide if the file is too large to read at once',
      },
      limit: {
        type: 'number',
        description: 'The number of lines to read. Only provide if the file is too large to read at once',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  }

  async execute(input: ReadToolInput, context: ToolContext): Promise<ReadToolOutput> {
    const { file_path, offset, limit } = input
    const { fs, readFiles } = context

    // Validate path
    const normalizedPath = validatePath(file_path)

    // Check if file exists and get stats
    const exists = await fs.exists(normalizedPath)
    if (!exists) {
      throw new FileNotFoundError(normalizedPath)
    }

    const stats = await fs.stat(normalizedPath)
    if (stats.isDirectory()) {
      throw new IsDirectoryError(normalizedPath)
    }

    // Track that we've read this file (for Edit validation)
    readFiles.add(normalizedPath)

    // Handle binary/image files
    if (isBinaryFile(normalizedPath)) {
      const bytes = await fs.readFile(normalizedPath, undefined) as Uint8Array
      const base64 = toBase64(bytes)
      const mimeType = getMimeType(normalizedPath)

      // For images, return in multimodal format
      if (isImageFile(normalizedPath)) {
        return {
          content: {
            type: 'base64',
            data: base64,
            media_type: mimeType,
          },
        }
      }

      // For other binary files, return base64 string
      return {
        content: {
          type: 'base64',
          data: base64,
          media_type: mimeType,
        },
      }
    }

    // Read text content
    const rawContent = await fs.readFile(normalizedPath) as string

    // Split into lines
    const allLines = rawContent.split('\n')
    const totalLines = allLines.length

    // Apply offset and limit
    const startLine = offset ?? 1
    const lineLimit = limit ?? DEFAULT_LINE_LIMIT
    const startIndex = Math.max(0, startLine - 1) // Convert to 0-indexed
    const endIndex = Math.min(totalLines, startIndex + lineLimit)
    const selectedLines = allLines.slice(startIndex, endIndex)

    // Check if truncated
    const truncated = endIndex < totalLines

    // Format with line numbers
    const formattedContent = formatWithLineNumbers(
      selectedLines.join('\n'),
      startLine
    )

    return {
      content: formattedContent,
      truncated,
      total_lines: totalLines,
    }
  }
}
