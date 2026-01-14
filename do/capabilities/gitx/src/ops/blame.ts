/**
 * @fileoverview Git Blame Algorithm
 *
 * This module provides functionality for attributing each line of a file
 * to the commit that last modified it. It implements a blame algorithm
 * similar to Git's native blame command.
 *
 * ## Features
 *
 * - Line-by-line commit attribution
 * - Rename tracking across commits
 * - Line range filtering
 * - Whitespace-insensitive comparison
 * - Date range filtering
 * - Commit exclusion (ignore revisions)
 * - Binary file detection
 * - Porcelain and human-readable output formats
 *
 * ## Usage Example
 *
 * ```typescript
 * import { blame, formatBlame } from './ops/blame'
 *
 * // Get blame information for a file
 * const result = await blame(storage, 'src/main.ts', 'HEAD', {
 *   followRenames: true,
 *   ignoreWhitespace: true
 * })
 *
 * // Format for display
 * const output = formatBlame(result, { showLineNumbers: true })
 * console.log(output)
 * ```
 *
 * @module ops/blame
 */

import { CommitObject, TreeObject } from '../types/objects'

// ============================================================================
// Types
// ============================================================================

/**
 * Storage interface for blame operations.
 *
 * Provides the necessary methods for accessing Git objects and
 * tracking file renames during blame traversal.
 *
 * @interface BlameStorage
 */
export interface BlameStorage {
  /**
   * Retrieves a commit object by its SHA.
   * @param sha - The 40-character hexadecimal commit SHA
   * @returns The commit object, or null if not found
   */
  getCommit(sha: string): Promise<CommitObject | null>

  /**
   * Retrieves a tree object by its SHA.
   * @param sha - The 40-character hexadecimal tree SHA
   * @returns The tree object, or null if not found
   */
  getTree(sha: string): Promise<TreeObject | null>

  /**
   * Retrieves blob content by its SHA.
   * @param sha - The 40-character hexadecimal blob SHA
   * @returns The blob content as bytes, or null if not found
   */
  getBlob(sha: string): Promise<Uint8Array | null>

  /**
   * Resolves a reference name to its SHA.
   * @param ref - The reference name (e.g., 'HEAD', 'refs/heads/main')
   * @returns The resolved SHA, or null if ref doesn't exist
   */
  resolveRef(ref: string): Promise<string | null>

  /**
   * Retrieves file content at a specific commit.
   * @param sha - The tree SHA to search in
   * @param path - The file path relative to the tree root
   * @returns The file content as bytes, or null if not found
   */
  getFileAtCommit(sha: string, path: string): Promise<Uint8Array | null>

  /**
   * Gets rename mappings for a specific commit.
   * @param sha - The commit SHA to check for renames
   * @returns Map of old paths to new paths for renames in this commit
   */
  getRenamesInCommit(sha: string): Promise<Map<string, string>>

  /**
   * Gets the first parent of a commit.
   * @param sha - The commit SHA
   * @returns The parent SHA, or null if this is the root commit
   */
  getParentCommit(sha: string): Promise<string | null>
}

/**
 * Options for controlling blame operation behavior.
 *
 * @interface BlameOptions
 *
 * @example
 * ```typescript
 * const options: BlameOptions = {
 *   followRenames: true,
 *   maxCommits: 1000,
 *   ignoreWhitespace: true,
 *   lineRange: '10,20'
 * }
 * ```
 */
export interface BlameOptions {
  /**
   * Whether to track file renames through history.
   * When true, blame will follow the file even if it was renamed.
   * @default false
   */
  followRenames?: boolean

  /**
   * Whether to follow symbolic links.
   * @default false
   */
  followSymlinks?: boolean

  /**
   * Maximum number of commits to traverse.
   * Useful for limiting blame on files with long histories.
   * @default Infinity
   */
  maxCommits?: number

  /**
   * Reverse blame direction - show which commit introduced removal.
   * @default false
   */
  reverse?: boolean

  /**
   * Only consider commits after this date.
   */
  since?: Date

  /**
   * Only consider commits before this date.
   */
  until?: Date

  /**
   * Ignore whitespace changes when comparing lines.
   * @default false
   */
  ignoreWhitespace?: boolean

  /**
   * List of commit SHAs to skip during blame traversal.
   * Useful for ignoring bulk formatting commits.
   */
  ignoreRevisions?: string[]

  /**
   * Line range specification (git-style -L option).
   * Formats: "start,end", "start,+offset", or "/pattern1/,/pattern2/"
   *
   * @example
   * - "10,20" - lines 10 through 20
   * - "10,+5" - lines 10 through 15
   * - "/^function/,/^}/" - from pattern match to pattern match
   */
  lineRange?: string

  /**
   * Whether to use caching for performance.
   * @default true
   */
  useCache?: boolean
}

/**
 * Information about a single blamed line.
 *
 * Contains all attribution data for a specific line in the file,
 * including the commit that last modified it.
 *
 * @interface BlameLineInfo
 */
export interface BlameLineInfo {
  /** SHA of the commit that last modified this line */
  commitSha: string

  /** Name of the author who made the change */
  author: string

  /** Email of the author (optional for compatibility) */
  email?: string

  /** Unix timestamp of the commit in seconds */
  timestamp: number

  /** The actual text content of the line */
  content: string

  /** Current line number in the file (1-indexed) */
  lineNumber: number

  /** Original line number when the line was introduced (1-indexed) */
  originalLineNumber: number

  /** Original file path if the file was renamed */
  originalPath?: string
}

/**
 * Commit information in the context of blame results.
 *
 * Provides summary information about commits that appear in blame output.
 *
 * @interface BlameCommitInfo
 */
export interface BlameCommitInfo {
  /** The commit SHA */
  sha: string

  /** Author name */
  author: string

  /** Author email */
  email: string

  /** Unix timestamp in seconds */
  timestamp: number

  /** First line of the commit message */
  summary: string

  /** Whether this commit is a boundary (has no parent) */
  boundary?: boolean
}

/**
 * A single entry in blame output (simplified format).
 *
 * @interface BlameEntry
 */
export interface BlameEntry {
  /** SHA of the commit */
  commitSha: string

  /** Author name */
  author: string

  /** Unix timestamp in seconds */
  timestamp: number

  /** Current line number (1-indexed) */
  lineNumber: number

  /** Original line number when introduced (1-indexed) */
  originalLineNumber: number

  /** Line content */
  content: string

  /** Original path if file was renamed */
  originalPath?: string
}

/**
 * Complete result of a blame operation.
 *
 * @interface BlameResult
 *
 * @example
 * ```typescript
 * const result = await blame(storage, 'file.ts', 'HEAD')
 *
 * // Access individual lines
 * for (const line of result.lines) {
 *   console.log(`${line.commitSha.slice(0,8)} ${line.author}: ${line.content}`)
 * }
 *
 * // Look up commit details
 * const commitInfo = result.commits.get(result.lines[0].commitSha)
 * ```
 */
export interface BlameResult {
  /** The file path that was blamed */
  path: string

  /** Array of blame information for each line */
  lines: BlameLineInfo[]

  /** Map of commit SHA to commit information */
  commits: Map<string, BlameCommitInfo>

  /** Options used for this blame operation */
  options?: BlameOptions
}

/**
 * Options for formatting blame output.
 *
 * @interface BlameFormatOptions
 */
export interface BlameFormatOptions {
  /**
   * Output format style.
   * - 'default': Human-readable format
   * - 'porcelain': Machine-parseable format
   * @default 'default'
   */
  format?: 'default' | 'porcelain'

  /**
   * Whether to show line numbers.
   * @default false
   */
  showLineNumbers?: boolean

  /**
   * Whether to show commit dates.
   * @default false
   */
  showDate?: boolean

  /**
   * Whether to show email instead of author name.
   * @default false
   */
  showEmail?: boolean
}

/**
 * Entry tracking file path through rename history.
 *
 * @interface PathHistoryEntry
 */
export interface PathHistoryEntry {
  /** Commit SHA at this point in history */
  commit: string

  /** File path at this point in history */
  path: string
}

/**
 * Blame history entry for tracking a single line through history.
 *
 * @interface BlameHistoryEntry
 */
export interface BlameHistoryEntry {
  /** Commit SHA where this version appeared */
  commitSha: string

  /** Line content at this version */
  content: string

  /** Line number at this version */
  lineNumber: number

  /** Author of this version */
  author: string

  /** Timestamp of this version */
  timestamp: number
}

// ============================================================================
// Helper Functions
// ============================================================================

const decoder = new TextDecoder()

/**
 * Checks if content is likely binary (contains null bytes).
 *
 * Uses a heuristic similar to Git's binary detection:
 * checks the first 8000 bytes for null characters.
 *
 * @param data - The content to check
 * @returns True if the content appears to be binary
 *
 * @internal
 */
function isBinaryContent(data: Uint8Array): boolean {
  // Check first 8000 bytes or entire file if smaller
  const checkLength = Math.min(data.length, 8000)
  for (let i = 0; i < checkLength; i++) {
    // Null byte is a strong indicator of binary
    if (data[i] === 0) return true
  }
  return false
}

/**
 * Splits content into lines, handling various line ending styles.
 *
 * Handles both Unix (\n) and Windows (\r\n) line endings,
 * normalizing output to not include trailing carriage returns.
 *
 * @param content - The string content to split
 * @returns Array of lines (without line terminators)
 *
 * @internal
 */
function splitLines(content: string): string[] {
  if (content === '') return []
  // Split by \n but handle \r\n as well
  const lines = content.split('\n')
  // If there's a trailing newline, the split will create an empty final element
  // which we should remove to match expected behavior
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.map(line => line.replace(/\r$/, ''))
}

/**
 * Normalizes a line for comparison (optionally ignoring whitespace).
 *
 * @param line - The line to normalize
 * @param ignoreWhitespace - Whether to normalize whitespace
 * @returns The normalized line
 *
 * @internal
 */
function normalizeLine(line: string, ignoreWhitespace: boolean): string {
  if (ignoreWhitespace) {
    return line.trim().replace(/\s+/g, ' ')
  }
  return line
}

/**
 * Gets file content at a specific path within a commit.
 *
 * Handles nested paths by traversing the tree structure.
 *
 * @param storage - The storage interface
 * @param commit - The commit object
 * @param path - The file path to retrieve
 * @returns The file content, or null if not found
 *
 * @internal
 */
async function getFileAtPath(
  storage: BlameStorage,
  commit: CommitObject,
  path: string
): Promise<Uint8Array | null> {
  // Try the direct storage method first
  const directResult = await storage.getFileAtCommit(commit.tree, path)
  if (directResult) return directResult

  // Handle nested paths manually
  const parts = path.split('/')
  let currentTreeSha = commit.tree

  for (let i = 0; i < parts.length; i++) {
    const tree = await storage.getTree(currentTreeSha)
    if (!tree) return null

    const entry = tree.entries.find(e => e.name === parts[i])
    if (!entry) return null

    if (i === parts.length - 1) {
      // Final part - should be a file
      return storage.getBlob(entry.sha)
    } else {
      // Intermediate part - should be a directory
      if (entry.mode !== '040000') return null
      currentTreeSha = entry.sha
    }
  }

  return null
}

/**
 * Computes line mapping between two file versions using LCS algorithm.
 *
 * Returns a mapping of (oldLineIndex -> newLineIndex) for unchanged lines,
 * enabling tracking of line movements between versions.
 *
 * @param oldLines - Lines from the older version
 * @param newLines - Lines from the newer version
 * @param ignoreWhitespace - Whether to ignore whitespace differences
 * @returns Map of old line indices to new line indices
 *
 * @internal
 */
function computeLineMapping(
  oldLines: string[],
  newLines: string[],
  ignoreWhitespace: boolean = false
): Map<number, number> {
  // Build a map of unchanged line positions
  const mapping = new Map<number, number>()

  // Normalize lines for comparison if needed
  const normalizedOld = oldLines.map(l => normalizeLine(l, ignoreWhitespace))
  const normalizedNew = newLines.map(l => normalizeLine(l, ignoreWhitespace))

  // Use a simple greedy LCS approach for line matching
  // Build LCS table
  const m = oldLines.length
  const n = newLines.length

  if (m === 0 || n === 0) return mapping

  // Create LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (normalizedOld[i - 1] === normalizedNew[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find the matching lines
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (normalizedOld[i - 1] === normalizedNew[j - 1]) {
      mapping.set(i - 1, j - 1) // 0-indexed
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return mapping
}

/**
 * Parses a line range specification (git-style -L option).
 *
 * Supports multiple formats:
 * - "start,end": Explicit line range
 * - "start,+offset": Relative offset from start
 * - "/pattern1/,/pattern2/": Regex-based range
 *
 * @param lineRange - The range specification string
 * @param lines - The file content lines (for pattern matching)
 * @returns Object with start and end line numbers (1-indexed)
 *
 * @internal
 */
function parseLineRange(
  lineRange: string,
  lines: string[]
): { start: number; end: number } {
  const totalLines = lines.length

  // Handle regex patterns like /pattern1/,/pattern2/
  if (lineRange.startsWith('/')) {
    const parts = lineRange.match(/^\/(.+)\/,\/(.+)\/$/)
    if (parts) {
      const startPattern = new RegExp(parts[1])
      const endPattern = new RegExp(parts[2])

      let start = -1
      let end = -1

      for (let i = 0; i < lines.length; i++) {
        if (start === -1 && startPattern.test(lines[i])) {
          start = i + 1 // 1-indexed
        }
        if (start !== -1 && endPattern.test(lines[i])) {
          end = i + 1 // 1-indexed
          break
        }
      }

      if (start === -1) start = 1
      if (end === -1) end = totalLines

      return { start, end }
    }
  }

  // Handle numeric ranges like "2,4" or "2,+3"
  const [startStr, endStr] = lineRange.split(',')
  const start = parseInt(startStr, 10)

  let end: number
  if (endStr.startsWith('+')) {
    // Relative offset: start + offset lines
    end = start + parseInt(endStr.slice(1), 10)
  } else {
    end = parseInt(endStr, 10)
  }

  return { start, end }
}

/**
 * Calculates similarity between two strings (0-1).
 *
 * Uses line-based comparison with the LCS algorithm to determine
 * what percentage of lines are shared between the two versions.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score from 0 to 1
 *
 * @internal
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const aLines = splitLines(a)
  const bLines = splitLines(b)

  if (aLines.length === 0 && bLines.length === 0) return 1
  if (aLines.length === 0 || bLines.length === 0) return 0

  // Count matching lines
  const mapping = computeLineMapping(aLines, bLines, false)
  const matchCount = mapping.size
  const maxLines = Math.max(aLines.length, bLines.length)

  return matchCount / maxLines
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Computes blame for a file at a specific commit.
 *
 * Traverses commit history to attribute each line of the file to the
 * commit that last modified it. Supports various options for filtering
 * and tracking behavior.
 *
 * @description
 * The blame algorithm works by:
 * 1. Starting at the specified commit and getting the file content
 * 2. Initially attributing all lines to the starting commit
 * 3. Walking backwards through commit history
 * 4. For each parent commit, computing line mappings using LCS
 * 5. Re-attributing lines that exist unchanged in the parent
 * 6. Continuing until all lines are attributed or history is exhausted
 *
 * @param storage - The storage interface for accessing Git objects
 * @param path - The file path to blame
 * @param commit - The commit SHA to start from
 * @param options - Optional blame configuration
 * @returns The blame result with line attributions
 *
 * @throws {Error} If the commit is not found
 * @throws {Error} If the file is not found at the specified commit
 * @throws {Error} If the file is binary
 *
 * @example
 * ```typescript
 * // Basic blame
 * const result = await blame(storage, 'src/main.ts', 'abc123')
 *
 * // Blame with options
 * const result = await blame(storage, 'README.md', 'HEAD', {
 *   followRenames: true,
 *   maxCommits: 500,
 *   ignoreWhitespace: true
 * })
 *
 * // Blame specific line range
 * const result = await blame(storage, 'config.json', 'main', {
 *   lineRange: '10,20'
 * })
 * ```
 */
export async function blame(
  storage: BlameStorage,
  path: string,
  commit: string,
  options?: BlameOptions
): Promise<BlameResult> {
  const opts = options ?? {}

  // Get the commit object
  const commitObj = await storage.getCommit(commit)
  if (!commitObj) {
    throw new Error(`Commit not found: ${commit}`)
  }

  // Get the file content at this commit
  const fileContent = await getFileAtPath(storage, commitObj, path)
  if (fileContent === null) {
    throw new Error(`File not found: ${path} at commit ${commit}`)
  }

  // Check for binary file
  if (isBinaryContent(fileContent)) {
    throw new Error(`Cannot blame binary file: ${path}`)
  }

  const contentStr = decoder.decode(fileContent)
  let lines = splitLines(contentStr)

  // Handle empty file
  if (lines.length === 0) {
    return {
      path,
      lines: [],
      commits: new Map(),
      options: opts
    }
  }

  // Parse line range if specified
  let startLine = 1
  let endLine = lines.length
  if (opts.lineRange) {
    const range = parseLineRange(opts.lineRange, lines)
    startLine = range.start
    endLine = range.end
  }

  // Initialize blame info for each line (all attributed to current commit initially)
  const blameInfo: BlameLineInfo[] = lines.map((content, idx) => ({
    commitSha: commit,
    author: commitObj.author.name,
    email: commitObj.author.email,
    timestamp: commitObj.author.timestamp,
    content,
    lineNumber: idx + 1,
    originalLineNumber: idx + 1,
    originalPath: path
  }))

  // Track which lines still need attribution
  const lineNeedsAttribution = new Array(lines.length).fill(true)

  // Track the current path (for rename following)
  let currentPath = path

  // Track commits for the result
  const commitsMap = new Map<string, BlameCommitInfo>()

  // Add current commit info
  commitsMap.set(commit, {
    sha: commit,
    author: commitObj.author.name,
    email: commitObj.author.email,
    timestamp: commitObj.author.timestamp,
    summary: commitObj.message.split('\n')[0],
    boundary: commitObj.parents.length === 0
  })

  // Walk through commit history
  let currentCommit = commit
  let currentLines = lines
  let commitCount = 0
  const maxCommits = opts.maxCommits ?? Infinity

  // Handle the followRenames option
  const followRenames = opts.followRenames ?? false

  // For merge commits, we need to explore both parents
  const commitQueue: Array<{
    sha: string
    lines: string[]
    path: string
    lineMapping: Map<number, number> // Maps from original line indices to this commit's line indices
    childCommitSha: string // The commit we're coming from (to look up renames)
  }> = []

  // Initialize with current commit's parents
  const currentCommitObj = await storage.getCommit(currentCommit)
  if (currentCommitObj && currentCommitObj.parents.length > 0) {
    for (const parentSha of currentCommitObj.parents) {
      // Identity mapping for first level
      const identityMapping = new Map<number, number>()
      for (let i = 0; i < currentLines.length; i++) {
        identityMapping.set(i, i)
      }
      commitQueue.push({
        sha: parentSha,
        lines: currentLines,
        path: currentPath,
        lineMapping: identityMapping,
        childCommitSha: currentCommit
      })
    }
  }

  // Process commit queue (BFS through history)
  while (commitQueue.length > 0 && commitCount < maxCommits) {
    const item = commitQueue.shift()!
    const { sha: parentSha, lines: childLines, path: childPath, lineMapping: childToOriginal, childCommitSha } = item

    // Check if this commit should be ignored
    if (opts.ignoreRevisions?.includes(parentSha)) {
      // Skip this commit but continue to its parents
      const parentCommitObj = await storage.getCommit(parentSha)
      if (parentCommitObj && parentCommitObj.parents.length > 0) {
        for (const grandparentSha of parentCommitObj.parents) {
          commitQueue.push({
            sha: grandparentSha,
            lines: childLines,
            path: childPath,
            lineMapping: childToOriginal,
            childCommitSha: parentSha
          })
        }
      }
      continue
    }

    commitCount++

    // Check date filters
    const parentCommitObj = await storage.getCommit(parentSha)
    if (!parentCommitObj) continue

    if (opts.since && parentCommitObj.author.timestamp * 1000 < opts.since.getTime()) {
      continue
    }
    if (opts.until && parentCommitObj.author.timestamp * 1000 > opts.until.getTime()) {
      continue
    }

    // Track path through renames
    // Renames are stored in the child commit (the one that did the rename)
    // So we check the childCommitSha to find what the file was called in the parent
    let pathInParent = childPath
    if (followRenames) {
      // Check renames in the child commit (where the rename happened)
      const childRenames = await storage.getRenamesInCommit(childCommitSha)
      // Find reverse rename: oldPath -> newPath means in parent it was oldPath
      for (const [oldPath, newPath] of childRenames) {
        if (newPath === childPath) {
          pathInParent = oldPath
          break
        }
      }
    }

    // Get file content in parent
    const parentContent = await getFileAtPath(storage, parentCommitObj, pathInParent)

    // If file doesn't exist in parent, all remaining lines are from the first commit that has them
    if (!parentContent) {
      continue
    }

    const parentContentStr = decoder.decode(parentContent)
    const parentLines = splitLines(parentContentStr)

    // Compute line mapping between parent and child
    const mapping = computeLineMapping(parentLines, childLines, opts.ignoreWhitespace ?? false)

    // Add commit info
    if (!commitsMap.has(parentSha)) {
      commitsMap.set(parentSha, {
        sha: parentSha,
        author: parentCommitObj.author.name,
        email: parentCommitObj.author.email,
        timestamp: parentCommitObj.author.timestamp,
        summary: parentCommitObj.message.split('\n')[0],
        boundary: parentCommitObj.parents.length === 0
      })
    }

    // Update blame for lines that came from parent
    // mapping: parentLineIdx -> childLineIdx
    for (const [parentIdx, childIdx] of mapping) {
      // Convert childIdx to original index
      for (const [origIdx, mappedChildIdx] of childToOriginal) {
        if (mappedChildIdx === childIdx && lineNeedsAttribution[origIdx]) {
          // This line exists in parent - attribute to parent
          blameInfo[origIdx].commitSha = parentSha
          blameInfo[origIdx].author = parentCommitObj.author.name
          blameInfo[origIdx].email = parentCommitObj.author.email
          blameInfo[origIdx].timestamp = parentCommitObj.author.timestamp
          blameInfo[origIdx].originalLineNumber = parentIdx + 1
          if (pathInParent !== childPath) {
            blameInfo[origIdx].originalPath = pathInParent
          }
        }
      }
    }

    // Build new mapping from original indices to parent indices
    const newMapping = new Map<number, number>()
    for (const [origIdx, childIdx] of childToOriginal) {
      // Find if this child line maps to a parent line
      for (const [parentIdx, mappedChildIdx] of mapping) {
        if (mappedChildIdx === childIdx) {
          newMapping.set(origIdx, parentIdx)
          break
        }
      }
    }

    // Add parent's parents to queue if there are still lines to attribute
    if (parentCommitObj.parents.length > 0 && newMapping.size > 0) {
      for (const grandparentSha of parentCommitObj.parents) {
        commitQueue.push({
          sha: grandparentSha,
          lines: parentLines,
          path: pathInParent,
          lineMapping: newMapping,
          childCommitSha: parentSha
        })
      }
    }
  }

  // Filter to requested line range
  let resultLines = blameInfo
  if (opts.lineRange) {
    resultLines = blameInfo.filter(l => l.lineNumber >= startLine && l.lineNumber <= endLine)
  }

  return {
    path,
    lines: resultLines,
    commits: commitsMap,
    options: opts
  }
}

/**
 * Alias for blame - get full file blame.
 *
 * This function is identical to `blame` and exists for API compatibility.
 *
 * @param storage - The storage interface
 * @param path - The file path to blame
 * @param commit - The commit SHA to start from
 * @param options - Optional blame configuration
 * @returns The blame result
 *
 * @see {@link blame} for full documentation
 */
export async function blameFile(
  storage: BlameStorage,
  path: string,
  commit: string,
  options?: BlameOptions
): Promise<BlameResult> {
  return blame(storage, path, commit, options)
}

/**
 * Gets blame information for a specific line.
 *
 * Convenience function that performs a full blame and extracts
 * the information for a single line.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param lineNumber - The line number (1-indexed)
 * @param commit - The commit SHA
 * @param options - Optional blame configuration
 * @returns Blame information for the specified line
 *
 * @throws {Error} If lineNumber is less than 1
 * @throws {Error} If lineNumber exceeds file length
 *
 * @example
 * ```typescript
 * const lineInfo = await blameLine(storage, 'src/main.ts', 42, 'HEAD')
 * console.log(`Line 42 was last modified by ${lineInfo.author}`)
 * ```
 */
export async function blameLine(
  storage: BlameStorage,
  path: string,
  lineNumber: number,
  commit: string,
  options?: BlameOptions
): Promise<BlameLineInfo> {
  if (lineNumber < 1) {
    throw new Error(`Invalid line number: ${lineNumber}. Line numbers start at 1.`)
  }

  const result = await blame(storage, path, commit, options)

  if (lineNumber > result.lines.length) {
    throw new Error(`Invalid line number: ${lineNumber}. File has ${result.lines.length} lines.`)
  }

  return result.lines[lineNumber - 1]
}

/**
 * Gets blame for a specific line range.
 *
 * More efficient than using the lineRange option when you know
 * the exact numeric range you want.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param startLine - Starting line number (1-indexed, inclusive)
 * @param endLine - Ending line number (1-indexed, inclusive)
 * @param commit - The commit SHA
 * @param options - Optional blame configuration
 * @returns Blame result for the specified range
 *
 * @throws {Error} If startLine is less than 1
 * @throws {Error} If endLine is less than startLine
 * @throws {Error} If endLine exceeds file length
 *
 * @example
 * ```typescript
 * // Get blame for lines 10-20
 * const result = await blameRange(storage, 'file.ts', 10, 20, 'HEAD')
 * ```
 */
export async function blameRange(
  storage: BlameStorage,
  path: string,
  startLine: number,
  endLine: number,
  commit: string,
  options?: BlameOptions
): Promise<BlameResult> {
  if (startLine < 1) {
    throw new Error(`Invalid start line: ${startLine}. Line numbers start at 1.`)
  }
  if (endLine < startLine) {
    throw new Error(`Invalid range: end (${endLine}) is before start (${startLine}).`)
  }

  const fullResult = await blame(storage, path, commit, options)

  if (endLine > fullResult.lines.length) {
    throw new Error(`Invalid end line: ${endLine}. File has ${fullResult.lines.length} lines.`)
  }

  return {
    path: fullResult.path,
    lines: fullResult.lines.slice(startLine - 1, endLine),
    commits: fullResult.commits,
    options: fullResult.options
  }
}

/**
 * Gets blame at a specific historical commit.
 *
 * Alias for `blame` - provided for semantic clarity when you want
 * to emphasize you're looking at a specific point in history.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param commit - The commit SHA
 * @param options - Optional blame configuration
 * @returns The blame result
 *
 * @see {@link blame} for full documentation
 */
export async function getBlameForCommit(
  storage: BlameStorage,
  path: string,
  commit: string,
  options?: BlameOptions
): Promise<BlameResult> {
  return blame(storage, path, commit, options)
}

/**
 * Tracks file path across renames through history.
 *
 * Walks through commit history and records each path the file
 * had at different points in time.
 *
 * @param storage - The storage interface
 * @param path - Current file path
 * @param commit - Starting commit SHA
 * @param _options - Unused options parameter (reserved for future use)
 * @returns Array of path history entries, newest first
 *
 * @example
 * ```typescript
 * const history = await trackContentAcrossRenames(storage, 'src/new-name.ts', 'HEAD')
 * // history might contain:
 * // [
 * //   { commit: 'abc123', path: 'src/new-name.ts' },
 * //   { commit: 'def456', path: 'src/old-name.ts' }
 * // ]
 * ```
 */
export async function trackContentAcrossRenames(
  storage: BlameStorage,
  path: string,
  commit: string,
  _options?: BlameOptions
): Promise<PathHistoryEntry[]> {
  const history: PathHistoryEntry[] = []
  let currentPath = path
  let currentCommitSha = commit

  while (currentCommitSha) {
    history.push({ commit: currentCommitSha, path: currentPath })

    const commitObj = await storage.getCommit(currentCommitSha)
    if (!commitObj || commitObj.parents.length === 0) break

    // Check for renames in this commit
    const renames = await storage.getRenamesInCommit(currentCommitSha)

    // Find if our current path was renamed from something
    for (const [oldPath, newPath] of renames) {
      if (newPath === currentPath) {
        currentPath = oldPath
        break
      }
    }

    currentCommitSha = commitObj.parents[0]
  }

  return history
}

/**
 * Detects file renames between two commits.
 *
 * Compares two commits to find files that were renamed based on
 * SHA matching (exact renames) and content similarity (renames with modifications).
 *
 * @param storage - The storage interface
 * @param fromCommit - The older commit SHA
 * @param toCommit - The newer commit SHA
 * @param options - Configuration options
 * @param options.threshold - Similarity threshold (0-1) for content-based detection
 * @returns Map of old paths to new paths for detected renames
 *
 * @example
 * ```typescript
 * const renames = await detectRenames(storage, 'abc123', 'def456', {
 *   threshold: 0.5
 * })
 *
 * for (const [oldPath, newPath] of renames) {
 *   console.log(`${oldPath} -> ${newPath}`)
 * }
 * ```
 */
export async function detectRenames(
  storage: BlameStorage,
  fromCommit: string,
  toCommit: string,
  options?: { threshold?: number }
): Promise<Map<string, string>> {
  const threshold = options?.threshold ?? 0.5
  const renames = new Map<string, string>()

  const fromCommitObj = await storage.getCommit(fromCommit)
  const toCommitObj = await storage.getCommit(toCommit)

  if (!fromCommitObj || !toCommitObj) return renames

  const fromTree = await storage.getTree(fromCommitObj.tree)
  const toTree = await storage.getTree(toCommitObj.tree)

  if (!fromTree || !toTree) return renames

  // Find files that were deleted in 'from' and added in 'to'
  const fromFiles = new Map<string, string>() // name -> sha
  const toFiles = new Map<string, string>()

  for (const entry of fromTree.entries) {
    if (entry.mode !== '040000') { // Skip directories
      fromFiles.set(entry.name, entry.sha)
    }
  }

  for (const entry of toTree.entries) {
    if (entry.mode !== '040000') {
      toFiles.set(entry.name, entry.sha)
    }
  }

  // Find deleted files (in from but not in to)
  const deletedFiles: string[] = []
  for (const name of fromFiles.keys()) {
    if (!toFiles.has(name)) {
      deletedFiles.push(name)
    }
  }

  // Find added files (in to but not in from)
  const addedFiles: string[] = []
  for (const name of toFiles.keys()) {
    if (!fromFiles.has(name)) {
      addedFiles.push(name)
    }
  }

  // Check for exact SHA matches (pure renames)
  for (const deleted of deletedFiles) {
    const deletedSha = fromFiles.get(deleted)!
    for (const added of addedFiles) {
      const addedSha = toFiles.get(added)!
      if (deletedSha === addedSha) {
        renames.set(deleted, added)
        break
      }
    }
  }

  // Check for content similarity (renames with modifications)
  for (const deleted of deletedFiles) {
    if (renames.has(deleted)) continue

    const deletedSha = fromFiles.get(deleted)!
    const deletedContent = await storage.getBlob(deletedSha)
    if (!deletedContent || isBinaryContent(deletedContent)) continue

    const deletedStr = decoder.decode(deletedContent)

    for (const added of addedFiles) {
      // Check if already matched
      let alreadyMatched = false
      for (const [, v] of renames) {
        if (v === added) {
          alreadyMatched = true
          break
        }
      }
      if (alreadyMatched) continue

      const addedSha = toFiles.get(added)!
      const addedContent = await storage.getBlob(addedSha)
      if (!addedContent || isBinaryContent(addedContent)) continue

      const addedStr = decoder.decode(addedContent)
      const similarity = calculateSimilarity(deletedStr, addedStr)

      if (similarity >= threshold) {
        renames.set(deleted, added)
        break
      }
    }
  }

  return renames
}

/**
 * Builds complete blame history for a specific line.
 *
 * Tracks a single line through history, recording its content
 * at each commit where it existed.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param lineNumber - The line number to track (1-indexed)
 * @param commit - Starting commit SHA
 * @param options - Optional blame configuration
 * @returns Array of history entries, newest first
 *
 * @example
 * ```typescript
 * const history = await buildBlameHistory(storage, 'main.ts', 10, 'HEAD')
 *
 * for (const entry of history) {
 *   console.log(`${entry.commitSha}: ${entry.content}`)
 * }
 * ```
 */
export async function buildBlameHistory(
  storage: BlameStorage,
  path: string,
  lineNumber: number,
  commit: string,
  options?: BlameOptions
): Promise<BlameHistoryEntry[]> {
  const history: BlameHistoryEntry[] = []
  let currentCommitSha = commit
  let currentPath = path
  let currentLineNumber = lineNumber

  while (currentCommitSha) {
    const commitObj = await storage.getCommit(currentCommitSha)
    if (!commitObj) break

    const fileContent = await getFileAtPath(storage, commitObj, currentPath)
    if (!fileContent) break

    const contentStr = decoder.decode(fileContent)
    const lines = splitLines(contentStr)

    if (currentLineNumber > lines.length || currentLineNumber < 1) break

    history.push({
      commitSha: currentCommitSha,
      content: lines[currentLineNumber - 1],
      lineNumber: currentLineNumber,
      author: commitObj.author.name,
      timestamp: commitObj.author.timestamp
    })

    // Move to parent
    if (commitObj.parents.length === 0) break

    const parentSha = commitObj.parents[0]
    const parentCommitObj = await storage.getCommit(parentSha)
    if (!parentCommitObj) break

    // Check for renames
    const renames = await storage.getRenamesInCommit(currentCommitSha)
    for (const [oldPath, newPath] of renames) {
      if (newPath === currentPath) {
        currentPath = oldPath
        break
      }
    }

    // Get parent content and find corresponding line
    const parentContent = await getFileAtPath(storage, parentCommitObj, currentPath)
    if (!parentContent) break

    const parentContentStr = decoder.decode(parentContent)
    const parentLines = splitLines(parentContentStr)

    // Find which line in parent corresponds to our current line
    const mapping = computeLineMapping(parentLines, lines, options?.ignoreWhitespace ?? false)

    let foundParentLine = false
    for (const [parentIdx, childIdx] of mapping) {
      if (childIdx === currentLineNumber - 1) {
        currentLineNumber = parentIdx + 1
        foundParentLine = true
        break
      }
    }

    // If we didn't find a content match but the parent has the line at the same position,
    // assume it's the same line (content was modified). This is important for tracking
    // history of lines that change content in every commit.
    if (!foundParentLine) {
      if (currentLineNumber <= parentLines.length) {
        // Line exists at same position in parent - assume it's the same logical line
        foundParentLine = true
        // currentLineNumber stays the same
      } else {
        break
      }
    }

    currentCommitSha = parentSha
  }

  return history
}

/**
 * Formats blame result for display.
 *
 * Converts a BlameResult into a human-readable or machine-parseable string format.
 *
 * @param result - The blame result to format
 * @param options - Formatting options
 * @returns Formatted string output
 *
 * @example
 * ```typescript
 * const result = await blame(storage, 'main.ts', 'HEAD')
 *
 * // Human-readable format
 * const output = formatBlame(result, {
 *   showLineNumbers: true,
 *   showDate: true
 * })
 *
 * // Machine-readable format
 * const porcelain = formatBlame(result, { format: 'porcelain' })
 * ```
 */
export function formatBlame(
  result: BlameResult,
  options?: BlameFormatOptions
): string {
  const opts = options ?? {}
  const lines: string[] = []

  if (opts.format === 'porcelain') {
    // Porcelain format - machine readable
    for (const line of result.lines) {
      const commitInfo = result.commits.get(line.commitSha)
      lines.push(`${line.commitSha} ${line.originalLineNumber} ${line.lineNumber} 1`)
      lines.push(`author ${line.author}`)
      lines.push(`author-mail <${line.email || commitInfo?.email || ''}>`)
      lines.push(`author-time ${line.timestamp}`)
      lines.push(`author-tz +0000`)
      lines.push(`committer ${line.author}`)
      lines.push(`committer-mail <${line.email || commitInfo?.email || ''}>`)
      lines.push(`committer-time ${line.timestamp}`)
      lines.push(`committer-tz +0000`)
      lines.push(`filename ${result.path}`)
      lines.push(`\t${line.content}`)
    }
  } else {
    // Default format - human readable
    for (const line of result.lines) {
      const sha = line.commitSha.substring(0, 8)
      const author = line.author.padEnd(15).substring(0, 15)

      let datePart = ''
      if (opts.showDate) {
        const date = new Date(line.timestamp * 1000)
        datePart = ` ${date.toISOString().substring(0, 10)}`
      }

      let authorPart = author
      if (opts.showEmail) {
        const email = line.email || result.commits.get(line.commitSha)?.email || ''
        authorPart = email.padEnd(25).substring(0, 25)
      }

      let lineNumPart = ''
      if (opts.showLineNumbers) {
        lineNumPart = `${line.lineNumber}) `
      }

      lines.push(`${sha} (${authorPart}${datePart} ${lineNumPart}${line.content}`)
    }
  }

  return lines.join('\n')
}

/**
 * Parses porcelain blame output back into a BlameResult.
 *
 * Useful for consuming blame output from external sources or
 * for round-trip serialization.
 *
 * @param output - Porcelain format blame output string
 * @returns Parsed blame result
 *
 * @example
 * ```typescript
 * const porcelainOutput = formatBlame(result, { format: 'porcelain' })
 * const parsed = parseBlameOutput(porcelainOutput)
 * ```
 */
export function parseBlameOutput(output: string): BlameResult {
  const lines: BlameLineInfo[] = []
  const commits = new Map<string, BlameCommitInfo>()

  const outputLines = output.split('\n')
  let i = 0

  while (i < outputLines.length) {
    const headerLine = outputLines[i]
    if (!headerLine || headerLine.trim() === '') {
      i++
      continue
    }

    // Parse header: <sha> <orig-line> <final-line> <num-lines>
    // Accept any 40-char alphanumeric SHA (to support test fixtures using makeSha)
    const headerMatch = headerLine.match(/^([0-9a-zA-Z]{40}) (\d+) (\d+)/)
    if (!headerMatch) {
      i++
      continue
    }

    const commitSha = headerMatch[1]
    const originalLineNumber = parseInt(headerMatch[2], 10)
    const lineNumber = parseInt(headerMatch[3], 10)

    // Parse metadata lines until we hit the content line (starts with tab)
    let author = ''
    let email = ''
    let timestamp = 0
    let content = ''

    i++
    while (i < outputLines.length) {
      const metaLine = outputLines[i]

      if (metaLine.startsWith('\t')) {
        content = metaLine.substring(1)
        i++
        break
      }

      if (metaLine.startsWith('author ')) {
        author = metaLine.substring(7)
      } else if (metaLine.startsWith('author-mail ')) {
        email = metaLine.substring(12).replace(/[<>]/g, '')
      } else if (metaLine.startsWith('author-time ')) {
        timestamp = parseInt(metaLine.substring(12), 10)
      }

      i++
    }

    lines.push({
      commitSha,
      author,
      email,
      timestamp,
      content,
      lineNumber,
      originalLineNumber
    })

    // Add commit info if not already present
    if (!commits.has(commitSha)) {
      commits.set(commitSha, {
        sha: commitSha,
        author,
        email,
        timestamp,
        summary: ''
      })
    }
  }

  return {
    path: '',
    lines,
    commits
  }
}
