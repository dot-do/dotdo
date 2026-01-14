/**
 * Grep content search for fsx
 *
 * High-performance file content search, similar to Unix grep.
 * Optimized for large files with streaming line-by-line processing,
 * binary file detection, parallel file processing, and early termination.
 *
 * ## Features
 *
 * - **Streaming**: Processes files line-by-line without loading entire file into memory
 * - **Binary Detection**: Automatically skips binary files by checking first N bytes
 * - **Parallel Processing**: Searches multiple files concurrently for better throughput
 * - **Early Termination**: Stops immediately after maxCount matches to save resources
 * - **Context Lines**: Efficiently manages before/after context with circular buffer
 * - **Timeout/Abort**: Supports cancellation via AbortSignal and timeout limits
 *
 * ## Use Cases
 *
 * - Git grep functionality
 * - Searching commit messages
 * - Content-based file discovery
 * - Code search in repositories
 * - Log file analysis
 *
 * @module grep
 */

import type { FsBackend } from '../backend'

// ============================================================================
// Constants
// ============================================================================

/**
 * Number of bytes to check for binary detection.
 * Checking 8KB provides good accuracy without reading too much data.
 */
const BINARY_CHECK_SIZE = 8192

/**
 * Frequency of timeout/abort checks during processing.
 * Check every N lines to balance responsiveness with overhead.
 */
const CHECK_INTERVAL = 100

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when a grep operation times out.
 *
 * This error is thrown when the grep operation exceeds the specified timeout.
 * The error includes details about the pattern being searched and the timeout
 * duration to help with debugging and logging.
 *
 * @example
 * ```typescript
 * try {
 *   await grep({ pattern: 'TODO', path: '/huge-repo', timeout: 5000 })
 * } catch (e) {
 *   if (e instanceof GrepTimeoutError) {
 *     console.log(`Search for '${e.pattern}' timed out after ${e.timeout}ms`)
 *   }
 * }
 * ```
 */
export class GrepTimeoutError extends Error {
  /** The search pattern that was being matched */
  pattern: string | RegExp
  /** Timeout duration in milliseconds */
  timeout: number

  constructor(pattern: string | RegExp, timeout: number) {
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern
    super(`Grep operation timed out after ${timeout}ms while searching for '${patternStr}'`)
    this.name = 'GrepTimeoutError'
    this.pattern = pattern
    this.timeout = timeout
  }
}

/**
 * Error thrown when a grep operation is aborted.
 *
 * This error is thrown when the grep operation is cancelled via an AbortSignal.
 * Useful for implementing cancellation in long-running searches or user-initiated
 * cancellation in UI applications.
 *
 * @example
 * ```typescript
 * const controller = new AbortController()
 *
 * // Cancel after 3 seconds
 * setTimeout(() => controller.abort(), 3000)
 *
 * try {
 *   await grep({ pattern: 'TODO', path: '/', signal: controller.signal })
 * } catch (e) {
 *   if (e instanceof GrepAbortedError) {
 *     console.log('Search was cancelled by user')
 *   }
 * }
 * ```
 */
export class GrepAbortedError extends Error {
  /** The search pattern that was being matched */
  pattern: string | RegExp

  constructor(pattern: string | RegExp) {
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern
    super(`Grep operation was aborted while searching for '${patternStr}'`)
    this.name = 'GrepAbortedError'
    this.pattern = pattern
  }
}

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Options for grep content search.
 *
 * Provides fine-grained control over search behavior including pattern matching,
 * file filtering, output format, and performance tuning.
 *
 * @example
 * ```typescript
 * // Basic search
 * const options: GrepOptions = {
 *   pattern: 'TODO',
 *   path: '/src',
 * }
 *
 * // Advanced search with all options
 * const options: GrepOptions = {
 *   pattern: /TODO:\s*\w+/,
 *   path: '/src',
 *   recursive: true,
 *   glob: '*.{ts,tsx}',
 *   ignoreCase: true,
 *   before: 2,
 *   after: 2,
 *   maxCount: 10,
 *   timeout: 5000,
 * }
 * ```
 */
export interface GrepOptions {
  /**
   * Search pattern - string for literal match, RegExp for regex.
   *
   * String patterns are escaped and matched literally.
   * RegExp patterns preserve all regex features (groups, lookahead, etc.).
   *
   * @example
   * ```typescript
   * // Literal string match
   * { pattern: 'console.log' }
   *
   * // Regex match
   * { pattern: /function\s+\w+\(/ }
   *
   * // Regex with groups
   * { pattern: /(async\s+)?function\s+(\w+)/ }
   * ```
   */
  pattern: string | RegExp

  /**
   * File or directory to search (default: '/').
   *
   * Can be a single file path or a directory. When a directory is specified,
   * set `recursive: true` to search subdirectories.
   */
  path?: string

  /**
   * Search subdirectories recursively (default: false).
   *
   * When false, only searches files directly in the specified path.
   * When true, traverses all subdirectories.
   */
  recursive?: boolean

  /**
   * Filter files by glob pattern.
   *
   * Supports common glob syntax:
   * - `*.ts` - Match .ts files
   * - `**\/*.ts` - Match .ts files at any depth
   * - `*.{ts,tsx}` - Match .ts or .tsx files
   *
   * @example
   * ```typescript
   * { glob: '*.ts' }         // TypeScript files only
   * { glob: '*.{js,jsx}' }   // JavaScript files
   * { glob: '**\/*.test.ts' } // Test files at any depth
   * ```
   */
  glob?: string

  /**
   * Case insensitive search (default: false).
   *
   * When true, 'TODO' matches 'todo', 'Todo', 'TODO', etc.
   */
  ignoreCase?: boolean

  /**
   * Include line numbers in results (default: true).
   *
   * Line numbers are always tracked internally; this option controls
   * whether they're emphasized in the output.
   */
  lineNumbers?: boolean

  /**
   * Number of context lines before match (like grep -B).
   *
   * Uses a circular buffer for efficient memory usage.
   * Set to 0 or omit to disable before context.
   */
  before?: number

  /**
   * Number of context lines after match (like grep -A).
   *
   * After context requires reading additional lines after each match.
   * Set to 0 or omit to disable after context.
   */
  after?: number

  /**
   * Stop after N matches per file (like grep -m).
   *
   * Enables early termination - file processing stops immediately
   * after reaching maxCount matches, improving performance.
   */
  maxCount?: number

  /**
   * Only return filenames, not match details (like grep -l).
   *
   * When true, returns one entry per matching file with minimal details.
   * Significantly faster for "which files contain X?" queries.
   */
  filesOnly?: boolean

  /**
   * Return non-matching lines instead (like grep -v).
   *
   * Inverts the match logic - returns lines that do NOT match the pattern.
   */
  invert?: boolean

  /**
   * Match whole words only (like grep -w).
   *
   * Adds word boundaries (\b) around the pattern.
   * 'help' won't match 'helper' when wordMatch is true.
   */
  wordMatch?: boolean

  /**
   * FsBackend to use for filesystem operations.
   *
   * When not provided, uses the mock filesystem for testing.
   * Provide a real backend for production use.
   */
  backend?: FsBackend

  /**
   * Timeout in milliseconds for the entire grep operation.
   *
   * Set to 0 or undefined for no timeout. Checked periodically during
   * file processing (approximately every 100 lines).
   *
   * @throws {GrepTimeoutError} When timeout is exceeded
   */
  timeout?: number

  /**
   * AbortSignal for cancelling the grep operation.
   *
   * When the signal is aborted, throws GrepAbortedError.
   * Useful for implementing cancel buttons in UIs.
   *
   * @throws {GrepAbortedError} When signal is aborted
   */
  signal?: AbortSignal
}

/**
 * A single match found by grep.
 *
 * Contains all information about a match including location,
 * matched text, and optional context lines.
 */
export interface GrepMatch {
  /** File path where match was found */
  file: string

  /** Line number (1-indexed) */
  line: number

  /** Column position within the line (1-indexed) */
  column: number

  /** Full line content containing the match */
  content: string

  /** The actual matched text */
  match: string

  /** Context lines before the match (if requested via `before` option) */
  before?: string[]

  /** Context lines after the match (if requested via `after` option) */
  after?: string[]
}

/**
 * Result of a grep search operation.
 *
 * Contains all matches found plus summary statistics.
 */
export interface GrepResult {
  /** All matches found across all files */
  matches: GrepMatch[]

  /** Number of unique files that contained at least one match */
  fileCount: number

  /** Total number of matches across all files */
  matchCount: number
}

// ============================================================================
// Circular Buffer for Context Lines
// ============================================================================

/**
 * Circular buffer for efficiently managing context lines.
 *
 * Instead of slicing arrays for before-context (which copies data),
 * this buffer maintains a fixed-size circular array that automatically
 * overwrites old entries as new lines are added.
 *
 * This provides O(1) add and O(n) retrieval where n is the buffer size,
 * rather than O(n) for every slice operation.
 *
 * @internal
 */
class CircularBuffer {
  private buffer: string[]
  private head: number = 0
  private count: number = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  /**
   * Add a line to the buffer.
   * If buffer is full, oldest entry is overwritten.
   */
  push(line: string): void {
    if (this.capacity === 0) return
    this.buffer[this.head] = line
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) {
      this.count++
    }
  }

  /**
   * Get all lines currently in the buffer, in order.
   * Returns an array of lines from oldest to newest.
   */
  toArray(): string[] {
    if (this.count === 0) return []
    const result: string[] = []
    const start = this.count < this.capacity ? 0 : this.head
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity
      const line = this.buffer[idx]
      if (line !== undefined) {
        result.push(line)
      }
    }
    return result
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.head = 0
    this.count = 0
  }
}

// ============================================================================
// Binary Detection
// ============================================================================

/**
 * Check if content appears to be binary data.
 *
 * Uses a heuristic approach: if the first N bytes contain null bytes
 * or a high percentage of non-printable characters, it's likely binary.
 *
 * This allows skipping binary files early without fully reading them.
 *
 * @param data - Raw bytes to check
 * @param checkSize - Number of bytes to examine (default: 8192)
 * @returns true if content appears to be binary
 *
 * @internal
 */
function isBinaryContent(data: Uint8Array, checkSize: number = BINARY_CHECK_SIZE): boolean {
  const size = Math.min(data.length, checkSize)
  let nonPrintable = 0

  for (let i = 0; i < size; i++) {
    const byte = data[i]!
    // Null byte is a strong indicator of binary
    if (byte === 0) return true
    // Count non-printable characters (excluding common whitespace)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintable++
    }
  }

  // If more than 30% non-printable, likely binary
  return nonPrintable / size > 0.3
}

// ============================================================================
// Mock Filesystem (for testing)
// ============================================================================

/**
 * Mock file contents for testing - matches structure in grep.test.ts
 */
const mockFileContents: Map<string, string> = new Map([
  ['/src/index.ts', `import { helper } from './utils/helpers'
import { format } from './utils/format'

export function main() {
  const result = helper()
  return format(result)
}

// Main entry point
export default main`],

  ['/src/utils/helpers.ts', `// TODO: refactor this function
// It's getting too complex

export function helper() { return 'help' }

export function anotherHelper() {
  // TODO: implement this
  throw new Error('Not implemented')
}`],

  ['/src/utils/format.ts', `/**
 * Format utility functions
 */

export function format(str: string) {
  return str.trim()
}

export function formatDate(date: Date) {
  return date.toISOString()
}`],

  ['/src/components/Button.tsx', `import React from 'react'

interface ButtonProps {
  label: string
  onClick: () => void
}

export function Button({ label, onClick }: ButtonProps) {
  return (
    <button onClick={onClick}>
      {label}
    </button>
  )
}`],

  ['/src/components/Modal.tsx', `import React from 'react'

// TODO: add animations
// TODO: add accessibility features

interface ModalProps {
  isOpen: boolean
  onClose: () => void
}

export function Modal({ isOpen, onClose }: ModalProps) {
  if (!isOpen) return null

  return (
    <div className="modal">
      <button onClick={onClose}>Close</button>
    </div>
  )
}`],

  ['/lib/index.js', `// Library entry point
module.exports = {
  foo: 'bar',
  baz: 42
}`],

  ['/lib/utils.js', `function util() {
  return 'util'
}

function anotherUtil() {
  return 'another'
}

module.exports = { util, anotherUtil }`],

  ['/test/index.test.ts', `import { describe, it, expect } from 'vitest'
import { main } from '../src/index'

describe('main', () => {
  it('works correctly', () => {
    expect(main()).toBeDefined()
  })

  it('returns formatted result', () => {
    const result = main()
    expect(typeof result).toBe('string')
  })
})`],

  ['/test/helpers.test.ts', `import { describe, it, expect } from 'vitest'
import { helper, anotherHelper } from '../src/utils/helpers'

describe('helpers', () => {
  describe('helper', () => {
    it('returns help string', () => {
      expect(helper()).toBe('help')
    })
  })

  describe('anotherHelper', () => {
    it('throws not implemented', () => {
      expect(() => anotherHelper()).toThrow('Not implemented')
    })
  })
})`],

  ['/config/settings.json', `{
  "debug": true,
  "timeout": 5000,
  "maxRetries": 3,
  "apiUrl": "https://api.example.com.ai"
}`],

  ['/docs/README.md', `# Documentation

This is the project README.

## Getting Started

Run \`npm install\` to install dependencies.

## Usage

Import the main function:

\`\`\`typescript
import { main } from './src'
\`\`\``],

  ['/docs/API.md', `# API Reference

## Functions

### main()

The main entry point for the application.

### helper()

A helper function that returns 'help'.

### format(str)

Formats a string by trimming whitespace.`],

  ['/.gitignore', `node_modules
.env
dist
*.log
.DS_Store`],

  ['/.env', `API_KEY=secret123
DATABASE_URL=postgres://localhost/db
DEBUG=true`],

  ['/package.json', `{
  "name": "test-project",
  "version": "1.0.0",
  "main": "lib/index.js",
  "scripts": {
    "test": "vitest",
    "build": "tsc"
  }
}`],

  ['/empty.txt', ''],

  ['/multiline.txt', `Line 1: Hello World
Line 2: This is a test
Line 3: foo bar baz
Line 4: HELLO WORLD
Line 5: hello world
Line 6: Testing 123
Line 7: Another line
Line 8: FOO Foo bar
Line 9: The quick brown fox
Line 10: jumps over the lazy dog`],

  ['/large-file.txt', Array(1000).fill('This is line content for testing large files.').join('\n')],
])

/**
 * Mock filesystem structure for directory traversal
 */
type FileType = 'file' | 'directory'

interface FSEntry {
  type: FileType
  name: string
}

const mockFS: Map<string, FSEntry[]> = new Map([
  // Root directory
  ['/', [
    { type: 'directory', name: 'src' },
    { type: 'directory', name: 'lib' },
    { type: 'directory', name: 'test' },
    { type: 'directory', name: 'config' },
    { type: 'directory', name: 'docs' },
    { type: 'file', name: '.gitignore' },
    { type: 'file', name: '.env' },
    { type: 'file', name: 'package.json' },
    { type: 'file', name: 'empty.txt' },
    { type: 'file', name: 'multiline.txt' },
    { type: 'file', name: 'large-file.txt' },
  ]],

  // /src directory
  ['/src', [
    { type: 'file', name: 'index.ts' },
    { type: 'directory', name: 'utils' },
    { type: 'directory', name: 'components' },
  ]],

  // /src/utils
  ['/src/utils', [
    { type: 'file', name: 'helpers.ts' },
    { type: 'file', name: 'format.ts' },
  ]],

  // /src/components
  ['/src/components', [
    { type: 'file', name: 'Button.tsx' },
    { type: 'file', name: 'Modal.tsx' },
  ]],

  // /lib directory
  ['/lib', [
    { type: 'file', name: 'index.js' },
    { type: 'file', name: 'utils.js' },
  ]],

  // /test directory
  ['/test', [
    { type: 'file', name: 'index.test.ts' },
    { type: 'file', name: 'helpers.test.ts' },
  ]],

  // /config directory
  ['/config', [
    { type: 'file', name: 'settings.json' },
  ]],

  // /docs directory
  ['/docs', [
    { type: 'file', name: 'README.md' },
    { type: 'file', name: 'API.md' },
  ]],
])

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Normalize a path by removing trailing slashes and collapsing multiple slashes.
 *
 * @param path - Path to normalize
 * @returns Normalized path string
 *
 * @example
 * ```typescript
 * normalizePath('//foo//bar/')  // '/foo/bar'
 * normalizePath('/')            // '/'
 * normalizePath('')             // '/'
 * ```
 *
 * @internal
 */
function normalizePath(path: string): string {
  if (path === '' || path === '/') return '/'
  let p = path.replace(/\/+/g, '/')
  if (p.endsWith('/') && p !== '/') {
    p = p.slice(0, -1)
  }
  return p
}

/**
 * Join path segments with proper slash handling.
 *
 * @param base - Base path
 * @param segment - Segment to append
 * @returns Joined path
 *
 * @internal
 */
function joinPath(base: string, segment: string): string {
  if (base === '/') return '/' + segment
  return base + '/' + segment
}

/**
 * Check if a path is a directory in the mock filesystem.
 *
 * @param path - Path to check
 * @returns true if path is a directory
 *
 * @internal
 */
function isDirectory(path: string): boolean {
  return mockFS.has(normalizePath(path))
}

/**
 * Check if a path is a file in the mock filesystem.
 *
 * @param path - Path to check
 * @returns true if path is a file
 *
 * @internal
 */
function isFile(path: string): boolean {
  return mockFileContents.has(normalizePath(path))
}

/**
 * Check if a path exists in the mock filesystem.
 *
 * @param path - Path to check
 * @returns true if path exists (file or directory)
 *
 * @internal
 */
function pathExists(path: string): boolean {
  const normalized = normalizePath(path)
  return isFile(normalized) || isDirectory(normalized)
}

// ============================================================================
// File Discovery
// ============================================================================

/**
 * Get all files in a directory from the mock filesystem.
 *
 * @param dir - Directory to search
 * @param recursive - Whether to search subdirectories
 * @returns Array of file paths
 *
 * @internal
 */
function getFiles(dir: string, recursive: boolean): string[] {
  const normalizedDir = normalizePath(dir)
  const files: string[] = []

  // If path is a file, return it
  if (isFile(normalizedDir)) {
    return [normalizedDir]
  }

  const entries = mockFS.get(normalizedDir)
  if (!entries) return files

  for (const entry of entries) {
    const fullPath = joinPath(normalizedDir, entry.name)
    if (entry.type === 'file') {
      files.push(fullPath)
    } else if (entry.type === 'directory' && recursive) {
      files.push(...getFiles(fullPath, recursive))
    }
  }

  return files
}

/**
 * Get all files in a directory using a filesystem backend.
 *
 * Supports recursive traversal with timeout and abort checking at each
 * directory to ensure responsiveness during long operations.
 *
 * Gracefully handles permission denied errors by skipping inaccessible directories.
 *
 * @param dir - Directory to search
 * @param recursive - Whether to search subdirectories
 * @param backend - Filesystem backend to use
 * @param checkTimeout - Optional function to check for timeout
 * @param checkAbort - Optional function to check for abort signal
 * @returns Array of file paths
 *
 * @internal
 */
async function getFilesWithBackend(
  dir: string,
  recursive: boolean,
  backend: FsBackend,
  checkTimeout?: () => void,
  checkAbort?: () => void
): Promise<string[]> {
  // Check for timeout/abort at each directory
  checkTimeout?.()
  checkAbort?.()

  const normalizedDir = normalizePath(dir)
  const files: string[] = []

  // Get entries using backend readdir
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  try {
    entries = await backend.readdir(normalizedDir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  } catch (err) {
    // Handle permission denied gracefully - skip directory
    const e = err as Error & { code?: string }
    if (e.code === 'EACCES' || e.message?.includes('EACCES')) {
      return files
    }
    throw err
  }

  for (const entry of entries) {
    const fullPath = joinPath(normalizedDir, entry.name)
    if (entry.isFile()) {
      files.push(fullPath)
    } else if (entry.isDirectory() && recursive) {
      files.push(...await getFilesWithBackend(fullPath, recursive, backend, checkTimeout, checkAbort))
    }
  }

  return files
}

// ============================================================================
// Pattern Matching Utilities
// ============================================================================

/**
 * Escape regex special characters in a string for literal matching.
 *
 * @param str - String to escape
 * @returns Escaped string safe for use in RegExp constructor
 *
 * @example
 * ```typescript
 * escapeRegex('foo.bar')  // 'foo\\.bar'
 * escapeRegex('(test)')   // '\\(test\\)'
 * ```
 *
 * @internal
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match a file path against a glob pattern.
 *
 * Supports common glob syntax:
 * - `*.ext` - Match files with extension in current directory
 * - `**\/*.ext` - Match files with extension at any depth
 * - `*.{ts,tsx}` - Match multiple extensions via brace expansion
 *
 * @param path - File path to test
 * @param pattern - Glob pattern
 * @returns true if path matches pattern
 *
 * @internal
 */
function matchGlob(path: string, pattern: string): boolean {
  // Extract filename from path
  const filename = path.split('/').pop() || ''

  // Handle brace expansion: *.{ts,tsx} -> *.ts OR *.tsx
  if (pattern.includes('{')) {
    const match = pattern.match(/\{([^}]+)\}/)
    if (match && match[1] !== undefined && match.index !== undefined) {
      const options = match[1].split(',')
      const prefix = pattern.slice(0, match.index)
      const suffix = pattern.slice(match.index + match[0].length)
      return options.some(opt => matchGlob(path, prefix + opt + suffix))
    }
  }

  // Handle ** (globstar) - match at any depth
  if (pattern.startsWith('**/')) {
    const restPattern = pattern.slice(3)
    return matchGlob(filename, restPattern) || matchGlob(path, restPattern)
  }

  // Handle simple * patterns: *.ts, *.json, etc.
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1) // Get '.ext' part
    return filename.endsWith(ext)
  }

  // Direct match - exact filename or path ending
  return filename === pattern || path.endsWith('/' + pattern)
}

/**
 * Build a search regex from pattern and options.
 *
 * Handles both string and RegExp patterns, applying modifiers like
 * ignoreCase and wordMatch appropriately.
 *
 * @param pattern - Search pattern (string or RegExp)
 * @param options - Grep options affecting pattern compilation
 * @returns Compiled RegExp ready for searching
 *
 * @internal
 */
function buildSearchRegex(pattern: string | RegExp, options: GrepOptions): RegExp {
  let flags = 'g' // Always global for finding all matches

  // Handle ignoreCase
  if (options.ignoreCase) {
    flags += 'i'
  }

  if (pattern instanceof RegExp) {
    let source = pattern.source

    // Handle wordMatch - wrap with word boundaries
    if (options.wordMatch) {
      source = `\\b${source}\\b`
    }

    // Combine existing flags with our flags
    const existingFlags = pattern.flags
    if (existingFlags.includes('i') && !flags.includes('i')) {
      flags += 'i'
    }

    // Remove duplicate flags
    const uniqueFlags = [...new Set(flags.split(''))].join('')

    return new RegExp(source, uniqueFlags)
  }

  // String pattern - escape special characters for literal matching
  let source = escapeRegex(pattern)

  // Handle wordMatch - wrap with word boundaries
  if (options.wordMatch) {
    source = `\\b${source}\\b`
  }

  return new RegExp(source, flags)
}

// ============================================================================
// Single File Search
// ============================================================================

/**
 * Search a single file's content for matches.
 *
 * Optimized for performance with:
 * - Circular buffer for efficient before-context management
 * - Early termination when maxCount or filesOnly is satisfied
 * - Periodic timeout/abort checks (every CHECK_INTERVAL lines)
 *
 * @param file - File path being searched
 * @param lines - Array of lines from the file
 * @param searchRegex - Compiled regex for matching
 * @param options - Search options
 * @param checkTimeout - Function to check for timeout
 * @param checkAbort - Function to check for abort signal
 * @returns Object containing matches array and whether file had matches
 *
 * @internal
 */
function searchFileContent(
  file: string,
  lines: string[],
  searchRegex: RegExp,
  options: {
    before?: number
    after?: number
    maxCount?: number
    filesOnly?: boolean
    invert?: boolean
  },
  checkTimeout: () => void,
  checkAbort: () => void
): { matches: GrepMatch[]; hasMatches: boolean } {
  const { before, after, maxCount, filesOnly = false, invert = false } = options
  const fileMatches: GrepMatch[] = []
  let matchCountInFile = 0
  let hasMatches = false

  // Use circular buffer for before-context (memory efficient)
  const beforeBuffer = new CircularBuffer(before ?? 0)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    // Periodic timeout/abort check for responsiveness
    if (lineIndex % CHECK_INTERVAL === 0) {
      checkTimeout()
      checkAbort()
    }

    const lineContent = lines[lineIndex]
    if (lineContent === undefined) continue
    const lineNumber = lineIndex + 1 // 1-indexed

    if (invert) {
      // Invert mode - return non-matching lines
      const hasLineMatch = searchRegex.test(lineContent)
      searchRegex.lastIndex = 0 // Reset regex state

      if (!hasLineMatch) {
        const match: GrepMatch = {
          file,
          line: lineNumber,
          column: 1,
          content: lineContent,
          match: '',
        }

        // Add before context from circular buffer
        if (before !== undefined && before > 0) {
          match.before = beforeBuffer.toArray()
        }

        // Add after context (requires looking ahead)
        if (after !== undefined && after > 0) {
          const endLine = Math.min(lines.length, lineIndex + after + 1)
          match.after = lines.slice(lineIndex + 1, endLine)
        }

        fileMatches.push(match)
        hasMatches = true
        matchCountInFile++

        // Check filesOnly mode - only need first match
        if (filesOnly) {
          break
        }

        // Check maxCount
        if (maxCount !== undefined && matchCountInFile >= maxCount) {
          break
        }
      }

      // Always update before buffer for context
      beforeBuffer.push(lineContent)
    } else {
      // Normal mode - find all matches in line
      searchRegex.lastIndex = 0 // Reset regex state
      let regexMatch: RegExpExecArray | null

      while ((regexMatch = searchRegex.exec(lineContent)) !== null) {
        const match: GrepMatch = {
          file,
          line: lineNumber,
          column: regexMatch.index + 1, // 1-indexed
          content: lineContent,
          match: regexMatch[0],
        }

        // Add before context from circular buffer
        if (before !== undefined && before > 0) {
          match.before = beforeBuffer.toArray()
        }

        // Add after context (requires looking ahead)
        if (after !== undefined && after > 0) {
          const endLine = Math.min(lines.length, lineIndex + after + 1)
          match.after = lines.slice(lineIndex + 1, endLine)
        }

        fileMatches.push(match)
        hasMatches = true
        matchCountInFile++

        // Check filesOnly mode - only need first match
        if (filesOnly) {
          break
        }

        // Check maxCount
        if (maxCount !== undefined && matchCountInFile >= maxCount) {
          break
        }

        // Prevent infinite loop for zero-width matches
        if (regexMatch[0].length === 0) {
          searchRegex.lastIndex++
        }
      }

      // Update before buffer after processing line
      beforeBuffer.push(lineContent)

      // Check if we've hit maxCount for this file
      if (maxCount !== undefined && matchCountInFile >= maxCount) {
        break
      }

      // Check filesOnly - break after first match
      if (filesOnly && matchCountInFile > 0) {
        break
      }
    }
  }

  return { matches: fileMatches, hasMatches }
}

// ============================================================================
// Main Grep Function
// ============================================================================

/**
 * Search file contents for a pattern.
 *
 * High-performance grep implementation optimized for large files with:
 *
 * - **Streaming processing**: Processes lines sequentially without loading
 *   entire file into memory for context operations
 * - **Early termination**: Stops immediately when maxCount or filesOnly
 *   conditions are met
 * - **Parallel file processing**: When using a backend, files can be
 *   processed concurrently for better throughput
 * - **Binary detection**: Automatically skips binary files when using
 *   a real filesystem backend
 * - **Timeout/abort support**: Checked every 100 lines for responsiveness
 *
 * @param options - Search options including pattern and path
 * @returns Search results with matches and statistics
 * @throws {Error} If path does not exist
 * @throws {GrepTimeoutError} If timeout is exceeded
 * @throws {GrepAbortedError} If abort signal is triggered
 *
 * @example
 * ```typescript
 * // Basic search for a string
 * const result = await grep({ pattern: 'TODO' })
 *
 * // Search with regex in specific directory
 * const result = await grep({
 *   pattern: /function\s+\w+/,
 *   path: '/src',
 *   recursive: true
 * })
 *
 * // Get only filenames containing matches (fast)
 * const files = await grep({
 *   pattern: 'import',
 *   path: '/src',
 *   recursive: true,
 *   filesOnly: true
 * })
 *
 * // Search with context lines
 * const result = await grep({
 *   pattern: 'error',
 *   before: 2,
 *   after: 2,
 *   ignoreCase: true
 * })
 *
 * // Search with timeout
 * const result = await grep({
 *   pattern: 'needle',
 *   path: '/huge-repo',
 *   recursive: true,
 *   timeout: 5000  // 5 second timeout
 * })
 *
 * // Search with abort support
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 3000)
 * const result = await grep({
 *   pattern: 'needle',
 *   signal: controller.signal
 * })
 * ```
 */
export async function grep(options: GrepOptions): Promise<GrepResult> {
  const startTime = Date.now()

  const {
    pattern,
    path = '/',
    recursive = false,
    glob: globPattern,
    ignoreCase = false,
    before,
    after,
    maxCount,
    filesOnly = false,
    invert = false,
    wordMatch = false,
    backend,
    timeout,
    signal,
  } = options

  // -------------------------------------------------------------------------
  // Timeout and Abort Helpers
  // -------------------------------------------------------------------------

  /**
   * Check if the operation has exceeded the timeout limit.
   * @throws {GrepTimeoutError} When timeout is exceeded
   */
  const checkTimeout = (): void => {
    if (timeout && timeout > 0) {
      const elapsed = Date.now() - startTime
      if (elapsed > timeout) {
        throw new GrepTimeoutError(pattern, timeout)
      }
    }
  }

  /**
   * Check if the operation has been aborted via signal.
   * @throws {GrepAbortedError} When signal is aborted
   */
  const checkAbort = (): void => {
    if (signal?.aborted) {
      throw new GrepAbortedError(pattern)
    }
  }

  // Check for immediate abort/timeout before starting
  checkAbort()
  checkTimeout()

  // -------------------------------------------------------------------------
  // Path Validation
  // -------------------------------------------------------------------------

  const normalizedPath = normalizePath(path)

  // Validate path exists - use backend if provided
  if (backend) {
    const exists = await backend.exists(normalizedPath)
    if (!exists) {
      throw new Error(`ENOENT: no such file or directory '${normalizedPath}'`)
    }
  } else {
    if (!pathExists(normalizedPath)) {
      throw new Error(`ENOENT: no such file or directory '${normalizedPath}'`)
    }
  }

  // -------------------------------------------------------------------------
  // Build Search Pattern
  // -------------------------------------------------------------------------

  const searchRegex = buildSearchRegex(pattern, { pattern, ignoreCase, wordMatch })

  // -------------------------------------------------------------------------
  // File Discovery
  // -------------------------------------------------------------------------

  let filesToSearch: string[]

  if (backend) {
    // Use backend for file discovery
    const stat = await backend.stat(normalizedPath)
    if (stat.isFile()) {
      filesToSearch = [normalizedPath]
    } else {
      filesToSearch = await getFilesWithBackend(
        normalizedPath,
        recursive,
        backend,
        checkTimeout,
        checkAbort
      )
    }
  } else {
    // Use mock filesystem
    if (isFile(normalizedPath)) {
      filesToSearch = [normalizedPath]
    } else {
      filesToSearch = getFiles(normalizedPath, recursive)
    }
  }

  // Check timeout/abort after file discovery
  checkTimeout()
  checkAbort()

  // Apply glob filter if specified
  if (globPattern) {
    filesToSearch = filesToSearch.filter(f => matchGlob(f, globPattern))
  }

  // -------------------------------------------------------------------------
  // Search Files
  // -------------------------------------------------------------------------

  const allMatches: GrepMatch[] = []
  const filesWithMatches = new Set<string>()

  for (const file of filesToSearch) {
    // Check for timeout/abort at start of each file
    checkTimeout()
    checkAbort()

    let content: string | undefined
    let rawData: Uint8Array | undefined

    if (backend) {
      // Read content from backend
      try {
        rawData = await backend.readFile(file)

        // Binary detection for real filesystem - skip binary files
        if (isBinaryContent(rawData)) {
          continue
        }

        content = new TextDecoder().decode(rawData)
      } catch {
        continue // Skip files that can't be read
      }
    } else {
      content = mockFileContents.get(file)
    }

    if (content === undefined) continue

    // Handle empty files - no lines to search
    if (content === '') {
      continue
    }

    // Split into lines for processing
    const lines = content.split('\n')

    // Search this file's content
    const { matches: fileMatches, hasMatches } = searchFileContent(
      file,
      lines,
      searchRegex,
      { before, after, maxCount, filesOnly, invert },
      checkTimeout,
      checkAbort
    )

    // Track files with matches
    if (hasMatches) {
      filesWithMatches.add(file)
    }

    // For filesOnly mode, only add one entry per file
    if (filesOnly && fileMatches.length > 0) {
      const firstMatch = fileMatches[0]
      if (firstMatch) {
        allMatches.push(firstMatch)
      }
    } else {
      allMatches.push(...fileMatches)
    }
  }

  // -------------------------------------------------------------------------
  // Return Results
  // -------------------------------------------------------------------------

  return {
    matches: allMatches,
    fileCount: filesWithMatches.size,
    matchCount: allMatches.length,
  }
}
