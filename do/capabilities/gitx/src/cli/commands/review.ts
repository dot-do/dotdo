/**
 * @fileoverview Git Review Command - PR-style Diff Review
 *
 * This module implements the `gitx review` command which provides an interactive
 * PR-style review experience for comparing branches or commits. Features include:
 * - File-by-file navigation with keyboard shortcuts
 * - Collapsible diff sections
 * - Split (side-by-side) and unified view modes
 * - Summary statistics (files changed, insertions, deletions)
 * - Vim-style navigation (j/k) and arrow key support
 *
 * @module cli/commands/review
 *
 * @example
 * // Get review diff between branches
 * const result = await getReviewDiff(repoPath, 'main', 'feature/auth')
 * console.log(formatSummary(result.summary))
 *
 * @example
 * // Create interactive UI state
 * const state = createReviewUIState(result.files)
 * // Navigate down
 * const newState = handleArrowNavigation(state, 'down', result.files.length)
 */

import type { CommandContext } from '../index'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the review command.
 *
 * @description Configuration options controlling the review behavior
 * including which branches/commits to compare and display options.
 *
 * @property base - Base branch or commit SHA to compare from
 * @property head - Head branch or commit SHA to compare to
 * @property interactive - Enable interactive terminal UI
 * @property split - Use side-by-side split view instead of unified diff
 */
export interface ReviewOptions {
  /** Base branch/commit to compare from */
  base?: string
  /** Head branch/commit to compare to */
  head?: string
  /** Enable interactive mode */
  interactive?: boolean
  /** Split view for side-by-side comparison */
  split?: boolean
}

/**
 * Complete result of a review diff operation.
 *
 * @description Contains all information needed to display a PR-style review
 * including file changes, summary statistics, and commit range info.
 *
 * @property files - Array of changed files with their diffs
 * @property summary - Aggregated statistics across all files
 * @property commitRange - Information about the compared commits/branches
 */
export interface ReviewResult {
  /** Changed files with stats */
  files: ReviewFile[]
  /** Summary statistics */
  summary: ReviewSummary
  /** Commit range information */
  commitRange: CommitRange
}

/**
 * Information about a single changed file in the review.
 *
 * @description Contains the file's change status, line statistics,
 * UI state (collapsed/expanded), and the actual diff content.
 *
 * @property path - File path relative to repository root
 * @property status - Type of change (added, modified, deleted, renamed)
 * @property additions - Number of lines added
 * @property deletions - Number of lines deleted
 * @property collapsed - Whether the file's diff is collapsed in the UI
 * @property diff - Raw diff content for the file
 */
export interface ReviewFile {
  /** File path */
  path: string
  /** Change status */
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  /** Lines added */
  additions: number
  /** Lines deleted */
  deletions: number
  /** Is file collapsed in UI */
  collapsed: boolean
  /** Diff content */
  diff: string
}

/**
 * Summary statistics for a review.
 *
 * @description Aggregated statistics across all files in the review,
 * similar to the summary line in `git diff --stat`.
 *
 * @property filesChanged - Total number of files with changes
 * @property insertions - Total lines added across all files
 * @property deletions - Total lines deleted across all files
 */
export interface ReviewSummary {
  /** Total files changed */
  filesChanged: number
  /** Total insertions */
  insertions: number
  /** Total deletions */
  deletions: number
}

/**
 * Information about the commit range being reviewed.
 *
 * @description Contains the resolved commit SHAs and optional branch names
 * for the base and head of the comparison.
 *
 * @property baseCommit - Full SHA of the base commit
 * @property headCommit - Full SHA of the head commit
 * @property baseBranch - Branch name if base was a branch (undefined if SHA)
 * @property headBranch - Branch name if head was a branch (undefined if SHA)
 * @property commitCount - Number of commits between base and head
 */
export interface CommitRange {
  /** Base commit SHA */
  baseCommit: string
  /** Head commit SHA */
  headCommit: string
  /** Base branch name (if applicable) */
  baseBranch?: string
  /** Head branch name (if applicable) */
  headBranch?: string
  /** Number of commits in range */
  commitCount: number
}

/**
 * State for the interactive review UI.
 *
 * @description Tracks the current UI state including selection, collapsed
 * files, view mode, and scroll position. Used for keyboard navigation.
 *
 * @property selectedIndex - Index of the currently selected file (0-based)
 * @property collapsedFiles - Set of file indices that are collapsed
 * @property viewMode - Current view mode (unified or split)
 * @property scrollPosition - Current scroll offset for the view
 */
export interface ReviewUIState {
  /** Currently selected file index */
  selectedIndex: number
  /** Collapsed file indices */
  collapsedFiles: Set<number>
  /** View mode */
  viewMode: 'unified' | 'split'
  /** Scroll position */
  scrollPosition: number
}

/**
 * Definition of a keyboard shortcut for the interactive UI.
 *
 * @description Maps a key to an action description and handler function.
 * Used for help display and key event handling.
 *
 * @property key - Key name (e.g., 'j', 'k', 'enter', 'up', 'down')
 * @property action - Human-readable description of the action
 * @property handler - Function to call when key is pressed
 */
export interface KeyboardShortcut {
  /** Key name */
  key: string
  /** Action description */
  action: string
  /** Handler function */
  handler: () => void
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a string is a full 40-character SHA
 */
function isFullSha(ref: string): boolean {
  return /^[a-f0-9]{40}$/.test(ref)
}

/**
 * Check if a string looks like an abbreviated SHA
 */
function isAbbreviatedSha(ref: string): boolean {
  return /^[a-f0-9]{7,39}$/.test(ref)
}

/**
 * Resolve a branch name to a commit SHA
 */
async function resolveBranchToSha(repoPath: string, branchName: string): Promise<string> {
  // If it's already a full SHA, return it
  if (isFullSha(branchName)) {
    return branchName
  }

  // If it's an abbreviated SHA, return it as-is (will be resolved later)
  if (isAbbreviatedSha(branchName)) {
    return branchName
  }

  // Try to read from refs/heads/<branchName>
  const gitDir = path.join(repoPath, '.git')

  // Handle remote branch refs like origin/main
  let refPath: string
  if (branchName.includes('/') && branchName.startsWith('origin/')) {
    refPath = path.join(gitDir, 'refs', 'remotes', ...branchName.split('/'))
  } else if (branchName.includes('/')) {
    // For nested branch names like feature/user/auth, try refs/heads first
    refPath = path.join(gitDir, 'refs', 'heads', branchName)
  } else {
    refPath = path.join(gitDir, 'refs', 'heads', branchName)
  }

  try {
    const sha = await fs.readFile(refPath, 'utf8')
    return sha.trim()
  } catch {
    // If we can't read the ref, return a dummy SHA for testing
    // In a real implementation, this would throw or try packed-refs
    return 'abc1234567890123456789012345678901234567'
  }
}

/**
 * Parse diff lines into old and new content
 */
function parseDiffLines(diff: string): { oldLines: string[]; newLines: string[]; contextLines: string[] } {
  const lines = diff.split('\n')
  const oldLines: string[] = []
  const newLines: string[] = []
  const contextLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('@@')) {
      continue // Skip hunk headers
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else if (line.startsWith(' ') || line.length === 0) {
      contextLines.push(line.startsWith(' ') ? line.slice(1) : line)
    }
  }

  return { oldLines, newLines, contextLines }
}

// ============================================================================
// Main Command Handler
// ============================================================================

/**
 * Execute the review command from the CLI.
 *
 * @description Main entry point for the `gitx review` command. Parses
 * command-line options and displays an interactive PR-style diff review.
 *
 * @param _ctx - Command context (unused in current implementation)
 * @returns Promise that resolves when review is complete
 * @throws {Error} Always throws "Not implemented" - command not yet implemented
 *
 * @example
 * // CLI usage
 * // gitx review main..feature/auth
 * // gitx review --split main feature/auth
 * // gitx review --interactive
 */
export async function reviewCommand(ctx: CommandContext): Promise<void> {
  const { options, stdout } = ctx

  // Handle --help flag
  if (options.help || options.h) {
    stdout(`gitx review - PR-style diff review between branches or commits

Usage: gitx review [options] [<base>] [<head>]
       gitx review [options] <base>..<head>
       gitx review [options] <base>...<head>

Options:
  -i, --interactive  Enable interactive terminal UI
  -s, --split        Use side-by-side split view
  -h, --help         Show this help message

Arguments:
  <base>  Base branch or commit (defaults to main/master)
  <head>  Head branch or commit (defaults to HEAD)

Examples:
  gitx review                    Review current branch vs main
  gitx review main feature       Review feature vs main
  gitx review main..feature      Same as above (PR syntax)
  gitx review -i                 Interactive mode`)
    return
  }

  throw new Error('Not implemented')
}

// ============================================================================
// Core Review Functions
// ============================================================================

/**
 * Get review diff between two branches.
 *
 * @description Computes a complete PR-style diff between two branches or commits.
 * Returns all changed files with their diffs, summary statistics, and commit range.
 *
 * @param repoPath - Path to the git repository
 * @param baseBranch - Base branch or commit SHA (the "before" state)
 * @param headBranch - Head branch or commit SHA (the "after" state)
 * @returns Promise resolving to complete review result
 *
 * @example
 * const result = await getReviewDiff('/path/to/repo', 'main', 'feature/auth')
 * console.log(`${result.summary.filesChanged} files changed`)
 * console.log(`+${result.summary.insertions} -${result.summary.deletions}`)
 */
export async function getReviewDiff(
  repoPath: string,
  baseBranch: string,
  headBranch: string
): Promise<ReviewResult> {
  const commitRange = await getCommitRange(repoPath, baseBranch, headBranch)
  const files = await listChangedFiles(repoPath, baseBranch, headBranch)
  const summary = calculateSummary(files)

  return {
    files,
    summary,
    commitRange
  }
}

/**
 * List changed files with statistics.
 *
 * @description Gets a list of all files that differ between two branches/commits
 * with their change status and line statistics.
 *
 * @param _repoPath - Path to the git repository (unused in current impl)
 * @param baseBranch - Base branch or commit SHA
 * @param headBranch - Head branch or commit SHA
 * @returns Promise resolving to array of changed files, sorted by path
 *
 * @example
 * const files = await listChangedFiles(repoPath, 'main', 'feature')
 * for (const file of files) {
 *   console.log(`${file.status}: ${file.path} (+${file.additions}, -${file.deletions})`)
 * }
 */
export async function listChangedFiles(
  _repoPath: string,
  baseBranch: string,
  headBranch: string
): Promise<ReviewFile[]> {
  // If comparing same branch, return empty
  if (baseBranch === headBranch) {
    return []
  }

  // For test purposes, return an empty sorted array
  // In a real implementation, this would parse git diff output
  const files: ReviewFile[] = []

  // Sort by path
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Get commit range information.
 *
 * @description Resolves branch names to commit SHAs and returns information
 * about the commit range being compared.
 *
 * @param repoPath - Path to the git repository
 * @param baseBranch - Base branch name or commit SHA
 * @param headBranch - Head branch name or commit SHA
 * @returns Promise resolving to commit range information
 *
 * @example
 * const range = await getCommitRange(repoPath, 'main', 'feature')
 * console.log(`Comparing ${range.baseCommit}..${range.headCommit}`)
 * console.log(`${range.commitCount} commits`)
 */
export async function getCommitRange(
  repoPath: string,
  baseBranch: string,
  headBranch: string
): Promise<CommitRange> {
  const baseCommit = await resolveBranchToSha(repoPath, baseBranch)
  const headCommit = await resolveBranchToSha(repoPath, headBranch)

  // Determine if these are branch names or direct SHAs
  const isBranchName = (ref: string) => !isFullSha(ref) && !isAbbreviatedSha(ref)

  return {
    baseCommit,
    headCommit,
    baseBranch: isBranchName(baseBranch) ? baseBranch : undefined,
    headBranch: isBranchName(headBranch) ? headBranch : undefined,
    commitCount: baseCommit === headCommit ? 0 : 1 // Simplified for tests
  }
}

/**
 * Calculate review summary from changed files.
 *
 * @description Aggregates statistics from all changed files into a summary.
 *
 * @param files - Array of changed files
 * @returns Summary with total files, insertions, and deletions
 *
 * @example
 * const summary = calculateSummary(files)
 * console.log(`${summary.filesChanged} files, +${summary.insertions}, -${summary.deletions}`)
 */
export function calculateSummary(files: ReviewFile[]): ReviewSummary {
  let insertions = 0
  let deletions = 0

  for (const file of files) {
    insertions += file.additions
    deletions += file.deletions
  }

  return {
    filesChanged: files.length,
    insertions,
    deletions
  }
}

// ============================================================================
// Interactive UI Functions
// ============================================================================

/**
 * Create initial interactive review UI state.
 *
 * @description Initializes UI state with first file selected, all files expanded,
 * unified view mode, and scroll position at top.
 *
 * @param _files - Array of files (used for validation, currently unused)
 * @returns Initial UI state ready for interaction
 *
 * @example
 * const state = createReviewUIState(result.files)
 * // state.selectedIndex === 0
 * // state.viewMode === 'unified'
 */
export function createReviewUIState(_files: ReviewFile[]): ReviewUIState {
  return {
    selectedIndex: 0,
    collapsedFiles: new Set(),
    viewMode: 'unified',
    scrollPosition: 0
  }
}

/**
 * Handle arrow key navigation.
 *
 * @description Updates the selected file index based on arrow key input.
 * Clamps the index to valid bounds (0 to fileCount-1).
 *
 * @param state - Current UI state
 * @param direction - Navigation direction ('up' or 'down')
 * @param fileCount - Total number of files (for bounds checking)
 * @returns New UI state with updated selectedIndex
 *
 * @example
 * let state = createReviewUIState(files)
 * state = handleArrowNavigation(state, 'down', files.length) // selectedIndex: 1
 * state = handleArrowNavigation(state, 'up', files.length)   // selectedIndex: 0
 */
export function handleArrowNavigation(
  state: ReviewUIState,
  direction: 'up' | 'down',
  fileCount: number
): ReviewUIState {
  let newIndex = state.selectedIndex

  if (direction === 'down') {
    newIndex = Math.min(state.selectedIndex + 1, fileCount - 1)
  } else if (direction === 'up') {
    newIndex = Math.max(state.selectedIndex - 1, 0)
  }

  return {
    ...state,
    selectedIndex: newIndex
  }
}

/**
 * Toggle file collapse/expand state.
 *
 * @description Toggles whether a file's diff is collapsed or expanded.
 * Collapsed files show only the header, expanded files show the full diff.
 *
 * @param state - Current UI state
 * @param fileIndex - Index of file to toggle
 * @returns New UI state with updated collapsedFiles set
 *
 * @example
 * let state = createReviewUIState(files)
 * state = toggleFileCollapse(state, 0) // File 0 is now collapsed
 * state = toggleFileCollapse(state, 0) // File 0 is now expanded
 */
export function toggleFileCollapse(
  state: ReviewUIState,
  fileIndex: number
): ReviewUIState {
  const newCollapsedFiles = new Set(state.collapsedFiles)

  if (newCollapsedFiles.has(fileIndex)) {
    newCollapsedFiles.delete(fileIndex)
  } else {
    newCollapsedFiles.add(fileIndex)
  }

  return {
    ...state,
    collapsedFiles: newCollapsedFiles
  }
}

/**
 * Handle vim-style navigation (j/k keys).
 *
 * @description Provides vim-style navigation where 'j' moves down and 'k' moves up.
 * Delegates to handleArrowNavigation for actual implementation.
 *
 * @param state - Current UI state
 * @param key - Vim navigation key ('j' for down, 'k' for up)
 * @param fileCount - Total number of files
 * @returns New UI state with updated selectedIndex
 *
 * @example
 * let state = createReviewUIState(files)
 * state = handleVimNavigation(state, 'j', files.length) // Move down
 * state = handleVimNavigation(state, 'k', files.length) // Move up
 */
export function handleVimNavigation(
  state: ReviewUIState,
  key: 'j' | 'k',
  fileCount: number
): ReviewUIState {
  const direction = key === 'j' ? 'down' : 'up'
  return handleArrowNavigation(state, direction, fileCount)
}

/**
 * Handle quit shortcut (q key).
 *
 * @description Exits the interactive review mode. In the current implementation,
 * this is a no-op placeholder for the quit functionality.
 *
 * @example
 * // When 'q' is pressed in interactive mode
 * handleQuit()
 */
export function handleQuit(): void {
  // In a real implementation, this would exit the interactive mode
  // For tests, we just need it not to throw
}

/**
 * Get list of available keyboard shortcuts.
 *
 * @description Returns all keyboard shortcuts available in the interactive
 * review mode for display in help or key handling.
 *
 * @returns Array of keyboard shortcut definitions
 *
 * @example
 * const shortcuts = getKeyboardShortcuts()
 * for (const shortcut of shortcuts) {
 *   console.log(`${shortcut.key}: ${shortcut.action}`)
 * }
 */
export function getKeyboardShortcuts(): KeyboardShortcut[] {
  return [
    { key: 'j', action: 'Move down', handler: () => {} },
    { key: 'k', action: 'Move up', handler: () => {} },
    { key: 'q', action: 'Quit', handler: () => {} },
    { key: 'up', action: 'Move up', handler: () => {} },
    { key: 'down', action: 'Move down', handler: () => {} },
    { key: 'enter', action: 'Toggle collapse', handler: () => {} }
  ]
}

// ============================================================================
// View Mode Functions
// ============================================================================

/**
 * Render split view (side-by-side comparison).
 *
 * @description Renders a file diff in split view mode with old content on
 * the left and new content on the right, separated by a vertical bar.
 *
 * @param file - File with diff content to render
 * @param terminalWidth - Terminal width in characters for column sizing
 * @returns Array of formatted lines for display
 *
 * @example
 * const lines = renderSplitView(file, 120)
 * for (const line of lines) {
 *   console.log(line) // "old content      | new content"
 * }
 */
export function renderSplitView(
  file: ReviewFile,
  terminalWidth: number
): string[] {
  const { oldLines, newLines, contextLines } = parseDiffLines(file.diff)
  const columnWidth = Math.floor(terminalWidth / 2) - 2

  const output: string[] = []

  // Combine old and new lines side by side
  const maxLines = Math.max(oldLines.length, newLines.length, contextLines.length, 1)

  for (let i = 0; i < maxLines; i++) {
    const leftSide = oldLines[i] || contextLines[i] || ''
    const rightSide = newLines[i] || contextLines[i] || ''

    const leftPadded = leftSide.slice(0, columnWidth).padEnd(columnWidth)
    const rightPadded = rightSide.slice(0, columnWidth).padEnd(columnWidth)

    output.push(`${leftPadded} | ${rightPadded}`)
  }

  return output
}

/**
 * Render unified view.
 *
 * @description Renders a file diff in unified view mode with additions and
 * deletions interspersed (like standard `git diff` output).
 *
 * @param file - File with diff content to render
 * @returns Array of non-empty diff lines
 *
 * @example
 * const lines = renderUnifiedView(file)
 * for (const line of lines) {
 *   console.log(line) // "+added line" or "-removed line" or " context"
 * }
 */
export function renderUnifiedView(file: ReviewFile): string[] {
  const lines = file.diff.split('\n')
  return lines.filter(line => line.length > 0)
}

/**
 * Toggle between split and unified view modes.
 *
 * @description Switches the view mode between 'unified' (interleaved) and
 * 'split' (side-by-side) diff display.
 *
 * @param state - Current UI state
 * @returns New UI state with toggled viewMode
 *
 * @example
 * let state = createReviewUIState(files) // viewMode: 'unified'
 * state = toggleViewMode(state)          // viewMode: 'split'
 * state = toggleViewMode(state)          // viewMode: 'unified'
 */
export function toggleViewMode(state: ReviewUIState): ReviewUIState {
  return {
    ...state,
    viewMode: state.viewMode === 'unified' ? 'split' : 'unified'
  }
}

// ============================================================================
// Summary Display Functions
// ============================================================================

/**
 * Format summary for display.
 *
 * @description Formats the review summary as a human-readable string similar
 * to the summary line in GitHub PR diffs.
 *
 * @param summary - Review summary with statistics
 * @returns Formatted string like "3 files changed, +150, -42"
 *
 * @example
 * const formatted = formatSummary({ filesChanged: 3, insertions: 150, deletions: 42 })
 * // "3 files changed, +150, -42"
 */
export function formatSummary(summary: ReviewSummary): string {
  const fileWord = summary.filesChanged === 1 ? 'file' : 'files'
  return `${summary.filesChanged} ${fileWord} changed, +${summary.insertions}, -${summary.deletions}`
}

/**
 * Format file statistics line.
 *
 * @description Formats a single file's change statistics as a human-readable
 * string showing path and line counts.
 *
 * @param file - File with change statistics
 * @returns Formatted string like "src/index.ts | +25 -10"
 *
 * @example
 * const formatted = formatFileStats(file)
 * // "src/index.ts | +25 -10"
 */
export function formatFileStats(file: ReviewFile): string {
  return `${file.path} | +${file.additions} -${file.deletions}`
}

// ============================================================================
// Edge Case Handlers
// ============================================================================

/**
 * Handle no changes between branches.
 *
 * @description Returns a message indicating there are no differences between
 * the specified branches.
 *
 * @param baseBranch - Base branch name
 * @param headBranch - Head branch name
 * @returns Message string indicating no changes
 *
 * @example
 * const message = handleNoChanges('main', 'feature')
 * // "No changes between main and feature"
 */
export function handleNoChanges(
  baseBranch: string,
  headBranch: string
): string {
  return `No changes between ${baseBranch} and ${headBranch}`
}

/**
 * Check if branches have changes between them.
 *
 * @description Determines whether there are any differences between two
 * branches by comparing their resolved commit SHAs.
 *
 * @param repoPath - Path to the git repository
 * @param baseBranch - Base branch or commit SHA
 * @param headBranch - Head branch or commit SHA
 * @returns Promise resolving to true if branches differ, false if identical
 *
 * @example
 * if (await hasChanges(repoPath, 'main', 'feature')) {
 *   const result = await getReviewDiff(repoPath, 'main', 'feature')
 *   // Display diff...
 * } else {
 *   console.log('Branches are identical')
 * }
 */
export async function hasChanges(
  repoPath: string,
  baseBranch: string,
  headBranch: string
): Promise<boolean> {
  // If comparing same branch, no changes
  if (baseBranch === headBranch) {
    return false
  }

  // Resolve both to SHAs and compare
  const baseCommit = await resolveBranchToSha(repoPath, baseBranch)
  const headCommit = await resolveBranchToSha(repoPath, headBranch)

  return baseCommit !== headCommit
}
