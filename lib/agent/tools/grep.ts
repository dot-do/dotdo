/**
 * Grep Tool Adapter
 *
 * Maps Claude SDK Grep tool to fsx.do search capabilities.
 * Supports regex patterns, context lines, and multiple output modes.
 *
 * @module lib/agent/tools/grep
 */

import type {
  ToolAdapter,
  ToolContext,
  GrepToolInput,
  GrepToolOutput,
  GrepMatch,
  JSONSchema,
} from './types'
import { PathTraversalError, FILE_TYPE_GLOBS } from './types'
import { glob } from '../../../primitives/fsx/core/glob'

/**
 * Maximum number of results to return
 */
const MAX_RESULTS = 1000

/**
 * Default output mode
 */
const DEFAULT_OUTPUT_MODE = 'files_with_matches'

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
 * Create a regex from pattern with flags
 */
function createRegex(pattern: string, flags: { ignoreCase?: boolean; multiline?: boolean }): RegExp {
  let regexFlags = 'g' // Always global
  if (flags.ignoreCase) regexFlags += 'i'
  if (flags.multiline) regexFlags += 's' // dotall for multiline

  return new RegExp(pattern, regexFlags)
}

/**
 * Get file extension globs for a type
 */
function getTypeGlobs(type: string): string[] {
  const normalized = type.toLowerCase()
  return FILE_TYPE_GLOBS[normalized] || [`*.${type}`]
}

/**
 * Get surrounding context lines
 */
function getContextLines(
  lines: string[],
  matchLineIndex: number,
  before: number,
  after: number
): { before: string[]; after: string[] } {
  const beforeLines: string[] = []
  const afterLines: string[] = []

  // Get lines before
  for (let i = Math.max(0, matchLineIndex - before); i < matchLineIndex; i++) {
    beforeLines.push(lines[i]!)
  }

  // Get lines after
  for (let i = matchLineIndex + 1; i <= Math.min(lines.length - 1, matchLineIndex + after); i++) {
    afterLines.push(lines[i]!)
  }

  return { before: beforeLines, after: afterLines }
}

/**
 * Search a single file for pattern matches
 */
async function searchFile(
  fs: ToolContext['fs'],
  filePath: string,
  regex: RegExp,
  options: {
    outputMode: 'content' | 'files_with_matches' | 'count'
    showLineNumbers: boolean
    beforeContext: number
    afterContext: number
    headLimit: number
    offset: number
  }
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = []

  try {
    const content = await fs.readFile(filePath) as string
    const lines = content.split('\n')

    if (options.outputMode === 'count') {
      // Count total matches in file
      let count = 0
      for (const line of lines) {
        // Reset regex lastIndex for each line
        regex.lastIndex = 0
        while (regex.exec(line)) {
          count++
        }
      }
      if (count > 0) {
        matches.push({ file: filePath, count })
      }
    } else if (options.outputMode === 'files_with_matches') {
      // Just check if file has any match
      for (const line of lines) {
        regex.lastIndex = 0
        if (regex.test(line)) {
          matches.push({ file: filePath })
          break
        }
      }
    } else {
      // Output mode is 'content' - return matching lines with context
      const seenLines = new Set<number>() // Track lines already added (for context overlap)

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex]!
        regex.lastIndex = 0

        if (regex.test(line)) {
          // Get context if not already added
          if (!seenLines.has(lineIndex)) {
            const context = getContextLines(
              lines,
              lineIndex,
              options.beforeContext,
              options.afterContext
            )

            // Mark context lines as seen
            for (let i = lineIndex - options.beforeContext; i <= lineIndex + options.afterContext; i++) {
              seenLines.add(i)
            }

            // Build content with context
            let contentStr = ''
            if (context.before.length > 0 && options.beforeContext > 0) {
              for (let i = 0; i < context.before.length; i++) {
                const ctxLineNum = lineIndex - context.before.length + i + 1
                contentStr += options.showLineNumbers
                  ? `${ctxLineNum}-${context.before[i]}\n`
                  : `${context.before[i]}\n`
              }
            }

            contentStr += options.showLineNumbers
              ? `${lineIndex + 1}:${line}`
              : line

            if (context.after.length > 0 && options.afterContext > 0) {
              for (let i = 0; i < context.after.length; i++) {
                const ctxLineNum = lineIndex + 2 + i
                contentStr += options.showLineNumbers
                  ? `\n${ctxLineNum}-${context.after[i]}`
                  : `\n${context.after[i]}`
              }
            }

            matches.push({
              file: filePath,
              line: options.showLineNumbers ? lineIndex + 1 : undefined,
              content: contentStr,
            })
          }
        }
      }
    }
  } catch {
    // Skip files that can't be read (permission issues, binary files, etc.)
  }

  return matches
}

/**
 * Grep Tool Adapter
 *
 * A powerful search tool built on ripgrep-style patterns.
 * Supports regex, context lines, and multiple output modes.
 */
export class GrepToolAdapter implements ToolAdapter<GrepToolInput, GrepToolOutput> {
  readonly name = 'Grep'

  readonly description = `A powerful search tool built on ripgrep.

Usage:
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
- Use -A/-B/-C for context lines around matches`

  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regular expression pattern to search for in file contents',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in. Defaults to current working directory.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")',
      },
      type: {
        type: 'string',
        description: 'File type to search (e.g., "js", "py", "rust")',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'Output mode. Defaults to "files_with_matches".',
      },
      '-i': {
        type: 'boolean',
        description: 'Case insensitive search',
      },
      '-n': {
        type: 'boolean',
        description: 'Show line numbers in output. Defaults to true.',
      },
      '-A': {
        type: 'number',
        description: 'Number of lines to show after each match',
      },
      '-B': {
        type: 'number',
        description: 'Number of lines to show before each match',
      },
      '-C': {
        type: 'number',
        description: 'Number of lines to show before and after each match',
      },
      multiline: {
        type: 'boolean',
        description: 'Enable multiline mode where patterns can span lines',
      },
      head_limit: {
        type: 'number',
        description: 'Limit output to first N entries',
      },
      offset: {
        type: 'number',
        description: 'Skip first N entries before applying head_limit',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  }

  async execute(input: GrepToolInput, context: ToolContext): Promise<GrepToolOutput> {
    const {
      pattern,
      path,
      glob: globPattern,
      type,
      output_mode = DEFAULT_OUTPUT_MODE,
      '-i': ignoreCase = false,
      '-n': showLineNumbers = true,
      '-A': afterContext = 0,
      '-B': beforeContext = 0,
      '-C': aroundContext = 0,
      multiline = false,
      head_limit = 0,
      offset = 0,
    } = input
    const { fs, cwd } = context

    // Determine search path
    const searchPath = path ? validatePath(path) : cwd

    // Create regex
    const regex = createRegex(pattern, { ignoreCase, multiline })

    // Determine which files to search
    let filesToSearch: string[] = []

    // Check if searchPath is a file or directory
    const pathExists = await fs.exists(searchPath)
    if (!pathExists) {
      return { matches: [], truncated: false }
    }

    const stats = await fs.stat(searchPath)

    if (stats.isDirectory()) {
      // Build glob patterns
      let patterns: string[] = ['**/*']

      if (globPattern) {
        patterns = [globPattern]
      } else if (type) {
        patterns = getTypeGlobs(type).map(p => `**/${p}`)
      }

      // Find files matching the pattern
      for (const p of patterns) {
        const matches = await glob(p, {
          cwd: searchPath,
          absolute: true,
          onlyFiles: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
        })
        filesToSearch.push(...matches)
      }

      // Remove duplicates
      filesToSearch = [...new Set(filesToSearch)]
    } else {
      // Search single file
      filesToSearch = [searchPath]
    }

    // Calculate actual context (C overrides A and B)
    const actualBeforeContext = aroundContext > 0 ? aroundContext : beforeContext
    const actualAfterContext = aroundContext > 0 ? aroundContext : afterContext

    // Search files
    const allMatches: GrepMatch[] = []

    for (const file of filesToSearch) {
      const fileMatches = await searchFile(fs, file, regex, {
        outputMode: output_mode,
        showLineNumbers,
        beforeContext: actualBeforeContext,
        afterContext: actualAfterContext,
        headLimit: head_limit,
        offset,
      })
      allMatches.push(...fileMatches)

      // Early termination if we have enough matches
      if (head_limit > 0 && allMatches.length >= offset + head_limit + 100) {
        break
      }
    }

    // Apply offset and limit
    let results = allMatches
    if (offset > 0) {
      results = results.slice(offset)
    }

    let truncated = false
    if (head_limit > 0 && results.length > head_limit) {
      results = results.slice(0, head_limit)
      truncated = true
    } else if (results.length > MAX_RESULTS) {
      results = results.slice(0, MAX_RESULTS)
      truncated = true
    }

    return {
      matches: results,
      truncated,
    }
  }
}
