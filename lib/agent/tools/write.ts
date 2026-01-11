/**
 * Write Tool Adapter
 *
 * Maps Claude SDK Write tool to fsx.do filesystem capabilities.
 * Creates parent directories automatically and supports atomic writes.
 *
 * @module lib/agent/tools/write
 */

import type {
  ToolAdapter,
  ToolContext,
  WriteToolInput,
  WriteToolOutput,
  JSONSchema,
} from './types'
import {
  IsDirectoryError,
  PathTraversalError,
  PermissionError,
} from './types'

/**
 * Dangerous paths that should never be written to
 */
const DANGEROUS_PATHS = new Set([
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
  '/etc/sudoers',
  '/.env',
  '/.bashrc',
  '/.profile',
  '/.zshrc',
  '/.ssh/authorized_keys',
  '/.ssh/id_rsa',
  '/.ssh/id_ed25519',
])

/**
 * Patterns for credential files that should not be written
 */
const CREDENTIAL_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials\.json$/,
  /secrets\.json$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa$/,
  /id_ed25519$/,
]

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
 * Check if a path is a dangerous system path
 */
function isDangerousPath(path: string): boolean {
  if (DANGEROUS_PATHS.has(path)) {
    return true
  }

  // Check credential patterns
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(path)) {
      return true
    }
  }

  return false
}

/**
 * Get the parent directory of a path
 */
function getParentDir(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return path.slice(0, lastSlash)
}

/**
 * Write Tool Adapter
 *
 * Writes content to a file, replacing the file if it already exists.
 * Creates parent directories as needed (like mkdir -p).
 */
export class WriteToolAdapter implements ToolAdapter<WriteToolInput, WriteToolOutput> {
  readonly name = 'Write'

  readonly description = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- Only use emojis if the user explicitly requests it.`

  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write (must be absolute, not relative)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  }

  async execute(input: WriteToolInput, context: ToolContext): Promise<WriteToolOutput> {
    const { file_path, content } = input
    const { fs, readFiles } = context

    // Validate path
    const normalizedPath = validatePath(file_path)

    // Check for dangerous paths
    if (isDangerousPath(normalizedPath)) {
      throw new PermissionError(normalizedPath, 'write')
    }

    // Check if path is a directory
    const exists = await fs.exists(normalizedPath)
    if (exists) {
      const stats = await fs.stat(normalizedPath)
      if (stats.isDirectory()) {
        throw new IsDirectoryError(normalizedPath)
      }
    }

    // Create parent directories if needed
    const parentDir = getParentDir(normalizedPath)
    if (parentDir !== '/') {
      const parentExists = await fs.exists(parentDir)
      if (!parentExists) {
        await fs.mkdir(parentDir, { recursive: true })
      }
    }

    // Write the file
    await fs.writeFile(normalizedPath, content)

    // Track that we've written (and implicitly read) this file
    readFiles.add(normalizedPath)

    // Calculate bytes written
    const encoder = new TextEncoder()
    const bytes = encoder.encode(content)

    return {
      success: true,
      bytes_written: bytes.length,
    }
  }
}
