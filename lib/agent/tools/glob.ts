/**
 * Glob Tool Adapter
 *
 * Maps Claude SDK Glob tool to fsx.do glob capabilities.
 * Supports glob patterns like "**\/*.ts" with results sorted by mtime.
 *
 * @module lib/agent/tools/glob
 */

import type {
  ToolAdapter,
  ToolContext,
  GlobToolInput,
  GlobToolOutput,
  JSONSchema,
} from './types'
import { PathTraversalError, NotDirectoryError } from './types'
import { glob as fsxGlob } from '../../../do/capabilities/fsx/core/glob'

/**
 * Maximum number of results to return
 */
const MAX_RESULTS = 1000

/**
 * Validate and normalize a path
 */
function validatePath(path: string): string {
  if (!path.startsWith('/')) {
    throw new PathTraversalError(path)
  }

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
 * Get file modification times for sorting
 */
async function getFileMtimes(
  fs: ToolContext['fs'],
  files: string[]
): Promise<Map<string, number>> {
  const mtimes = new Map<string, number>()

  // Process in batches to avoid overwhelming the filesystem
  const BATCH_SIZE = 50
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const promises = batch.map(async (file) => {
      try {
        const stats = await fs.stat(file)
        mtimes.set(file, stats.mtime?.getTime?.() ?? stats.mtimeMs ?? 0)
      } catch {
        // If we can't stat, use 0 for mtime
        mtimes.set(file, 0)
      }
    })
    await Promise.all(promises)
  }

  return mtimes
}

/**
 * Glob Tool Adapter
 *
 * Fast file pattern matching tool that works with any codebase size.
 * Returns matching file paths sorted by modification time (most recent first).
 */
export class GlobToolAdapter implements ToolAdapter<GlobToolInput, GlobToolOutput> {
  readonly name = 'Glob'

  readonly description = `Fast file pattern matching tool that works with any codebase size.
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns`

  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against',
      },
      path: {
        type: 'string',
        description: 'The directory to search in. If not specified, the current working directory will be used.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  }

  async execute(input: GlobToolInput, context: ToolContext): Promise<GlobToolOutput> {
    const { pattern, path } = input
    const { fs, cwd } = context

    // Determine the base path
    const basePath = path ? validatePath(path) : cwd

    // Check if base path exists and is a directory
    const exists = await fs.exists(basePath)
    if (!exists) {
      // Return empty results for non-existent paths
      return { files: [], truncated: false }
    }

    const stats = await fs.stat(basePath)
    if (!stats.isDirectory()) {
      throw new NotDirectoryError(basePath)
    }

    // Use fsx glob function with backend from context
    // Get the backend from FSx instance - it's a private property but we need it
    // For now, we'll use a workaround by implementing glob directly
    const results = await fsxGlob(pattern, {
      cwd: basePath,
      absolute: true,
      onlyFiles: true,
      // Pass the backend from the FSx instance
      // Note: FSx stores backend as private, so we access it through the glob function's backend option
      // The FSx class internally uses this backend, but we can also pass it to glob
      // For simplicity, we use the glob function which can work with mock FS or backend
    })

    // If no results, return early
    if (results.length === 0) {
      return { files: [], truncated: false }
    }

    // Get modification times for sorting
    const mtimes = await getFileMtimes(fs, results)

    // Sort by mtime (most recent first)
    const sorted = [...results].sort((a, b) => {
      const mtimeA = mtimes.get(a) ?? 0
      const mtimeB = mtimes.get(b) ?? 0
      return mtimeB - mtimeA // Descending (newest first)
    })

    // Truncate if too many results
    const truncated = sorted.length > MAX_RESULTS
    const files = truncated ? sorted.slice(0, MAX_RESULTS) : sorted

    return {
      files,
      truncated,
    }
  }
}
