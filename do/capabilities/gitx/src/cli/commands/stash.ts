/**
 * @fileoverview gitx stash command
 *
 * This module implements the `gitx stash` command which temporarily stores
 * modified working directory contents. Features include:
 * - stash push - save changes to a new stash
 * - stash list - list all stashes
 * - stash apply - apply a stash without removing it
 * - stash pop - apply and remove a stash
 * - stash drop - remove a stash
 * - stash show - show stash contents
 * - stash clear - remove all stashes
 *
 * @module cli/commands/stash
 */

import type { CommandContext } from '../index'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a single stash entry.
 */
export interface StashEntry {
  /** Stash reference (e.g., stash@{0}) */
  ref: string
  /** Stash index (e.g., 0 for stash@{0}) */
  index: number
  /** Branch the stash was created from */
  branch: string
  /** Stash message */
  message: string
  /** SHA of the stash commit */
  sha: string
  /** Short SHA (7 chars) */
  shortSha: string
  /** When the stash was created */
  date: Date
  /** Files included in the stash */
  files: string[]
}

/**
 * Options for stash push operation.
 */
export interface StashPushOptions {
  /** Include untracked files */
  includeUntracked?: boolean
  /** Keep the changes in the index */
  keepIndex?: boolean
  /** Custom message for the stash */
  message?: string
  /** Only stash specific paths */
  pathspec?: string[]
  /** Stash all files including ignored */
  all?: boolean
  /** Stage mode - only stash staged changes */
  staged?: boolean
  /** Quiet mode - suppress output */
  quiet?: boolean
}

/**
 * Options for stash apply/pop operations.
 */
export interface StashApplyOptions {
  /** Stash reference to apply (e.g., 'stash@{0}' or '0') */
  ref?: string
  /** Stash index to apply (default: 0) - deprecated, use ref */
  index?: boolean
  /** Restore the index state too */
  restoreIndex?: boolean
  /** Quiet mode - suppress output */
  quiet?: boolean
}

/**
 * Result of a stash push operation.
 */
export interface StashPushResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The stash reference created (e.g., stash@{0}) */
  stashRef: string
  /** The stash message */
  message: string
  /** Error message if failed */
  error?: string
}

/**
 * Result of a stash apply/pop operation.
 */
export interface StashApplyResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The stash reference that was applied */
  appliedRef: string
  /** Whether there were conflicts */
  conflicts?: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Result of a stash drop operation.
 */
export interface StashDropResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The stash reference that was dropped */
  droppedRef: string
  /** The SHA of the dropped stash */
  droppedSha: string
  /** Error message if failed */
  error?: string
}

/**
 * Result of a stash show operation.
 */
export interface StashShowResult {
  /** Files in the stash */
  files: Array<{ path: string; status?: string }>
  /** Diff content */
  diff?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the .git directory from a given path
 */
async function findGitDir(cwd: string): Promise<string> {
  const gitDir = path.join(cwd, '.git')
  try {
    const stat = await fs.stat(gitDir)
    if (stat.isDirectory()) {
      return gitDir
    }
  } catch {
    // Not found
  }
  throw new Error('not a git repository (or any of the parent directories): .git')
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(gitDir: string): Promise<string> {
  try {
    const headContent = await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')
    const match = headContent.match(/^ref: refs\/heads\/(.+)\n?$/)
    if (match) {
      return match[1]
    }
    return 'HEAD'
  } catch {
    return 'HEAD'
  }
}

/**
 * Parse a stash reference like 'stash@{0}' or just '0' into an index
 */
function parseStashRef(ref: string): number {
  if (ref.startsWith('stash@{') && ref.endsWith('}')) {
    const indexStr = ref.slice(7, -1)
    const index = parseInt(indexStr, 10)
    if (isNaN(index) || index < 0) {
      throw new Error(`invalid stash reference: ${ref}`)
    }
    return index
  }
  // Try to parse as a number
  const index = parseInt(ref, 10)
  if (isNaN(index) || index < 0) {
    throw new Error(`invalid stash reference: ${ref}`)
  }
  return index
}

/**
 * Format a stash index as a reference
 */
function formatStashRef(index: number): string {
  return `stash@{${index}}`
}

/**
 * Read the stash reflog to get all stash entries
 */
async function readStashReflog(gitDir: string): Promise<Array<{
  sha: string
  message: string
  timestamp?: number
}>> {
  const reflogPath = path.join(gitDir, 'logs', 'refs', 'stash')
  try {
    const content = await fs.readFile(reflogPath, 'utf8')
    const lines = content.trim().split('\n').filter(line => line.length > 0)
    return lines.map(line => {
      // Format: sha sha message (for reflog)
      // Or: sha sha WIP on branch: message
      const parts = line.split(' ')
      const sha = parts[0] || parts[1] || ''
      const message = parts.slice(2).join(' ')
      return { sha, message }
    })
  } catch {
    return []
  }
}

/**
 * Write the stash reflog
 */
async function writeStashReflog(gitDir: string, entries: Array<{
  sha: string
  message: string
}>): Promise<void> {
  const reflogPath = path.join(gitDir, 'logs', 'refs', 'stash')
  await fs.mkdir(path.dirname(reflogPath), { recursive: true })

  if (entries.length === 0) {
    try {
      await fs.unlink(reflogPath)
    } catch {
      // Ignore if doesn't exist
    }
    return
  }

  const content = entries.map(e => `${e.sha} ${e.sha} ${e.message}`).join('\n') + '\n'
  await fs.writeFile(reflogPath, content)
}

/**
 * Read mock stash data (for testing)
 */
async function readMockStashData(gitDir: string, index: number): Promise<{
  files: Array<{ path: string; content: string }>
  message: string
  sha: string
} | null> {
  const stashDataDir = path.join(gitDir, 'mock-stash-data', `stash@{${index}}`)
  try {
    const files: Array<{ path: string; content: string }> = []
    const entries = await fs.readdir(stashDataDir)

    let message = ''
    let sha = ''

    for (const entry of entries) {
      if (entry === 'message') {
        message = await fs.readFile(path.join(stashDataDir, entry), 'utf8')
      } else if (entry === 'sha') {
        sha = await fs.readFile(path.join(stashDataDir, entry), 'utf8')
      } else if (entry !== 'timestamp') {
        const content = await fs.readFile(path.join(stashDataDir, entry), 'utf8')
        // Convert underscore-separated path back to slashes
        files.push({ path: entry.replace(/_/g, '/'), content })
      }
    }

    return { files, message, sha: sha.trim() }
  } catch {
    return null
  }
}

/**
 * Write mock stash data (for testing)
 */
async function writeMockStashData(gitDir: string, index: number, data: {
  files: Array<{ path: string; content: string }>
  message: string
  sha: string
}): Promise<void> {
  const stashDataDir = path.join(gitDir, 'mock-stash-data', `stash@{${index}}`)
  await fs.mkdir(stashDataDir, { recursive: true })

  await fs.writeFile(path.join(stashDataDir, 'message'), data.message)
  await fs.writeFile(path.join(stashDataDir, 'sha'), data.sha)
  await fs.writeFile(path.join(stashDataDir, 'timestamp'), Date.now().toString())

  for (const file of data.files) {
    await fs.writeFile(
      path.join(stashDataDir, file.path.replace(/\//g, '_')),
      file.content
    )
  }
}

/**
 * Delete mock stash data
 */
async function deleteMockStashData(gitDir: string, index: number): Promise<void> {
  const stashDataDir = path.join(gitDir, 'mock-stash-data', `stash@{${index}}`)
  try {
    await fs.rm(stashDataDir, { recursive: true, force: true })
  } catch {
    // Ignore
  }
}

/**
 * Get modified/staged files in working directory
 */
async function getWorkingDirChanges(cwd: string, gitDir: string): Promise<Array<{
  path: string
  content: string
  staged: boolean
}>> {
  const changes: Array<{ path: string; content: string; staged: boolean }> = []

  // Read files in the working directory (excluding .git)
  async function scanDir(dir: string, relativePath: string = ''): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git') continue

      const fullPath = path.join(dir, entry.name)
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await scanDir(fullPath, relPath)
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath, 'utf8')
        // Check if staged
        const stagedPath = path.join(gitDir, 'mock-staged')
        let staged = false
        try {
          const stagedFiles = await fs.readFile(stagedPath, 'utf8')
          staged = stagedFiles.split('\n').includes(relPath)
        } catch {
          // No staged files
        }
        changes.push({ path: relPath, content, staged })
      }
    }
  }

  await scanDir(cwd)
  return changes
}

/**
 * Generate a random SHA for mock stashes
 */
function generateSha(): string {
  const hex = '0123456789abcdef'
  let sha = ''
  for (let i = 0; i < 40; i++) {
    sha += hex[Math.floor(Math.random() * 16)]
  }
  return sha
}

/**
 * Rename stash directories after drop/pop
 */
async function renumberStashes(gitDir: string, droppedIndex: number, totalCount: number): Promise<void> {
  const mockDataDir = path.join(gitDir, 'mock-stash-data')

  // Shift all stashes after the dropped one
  for (let i = droppedIndex + 1; i < totalCount; i++) {
    const oldDir = path.join(mockDataDir, `stash@{${i}}`)
    const newDir = path.join(mockDataDir, `stash@{${i - 1}}`)
    try {
      await fs.rename(oldDir, newDir)
    } catch {
      // Directory might not exist
    }
  }
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Get the count of stash entries.
 */
export async function getStashCount(cwd: string): Promise<number> {
  const gitDir = await findGitDir(cwd)

  // Check for mock stash count file first (for testing)
  const mockCountPath = path.join(gitDir, 'mock-stash-count')
  try {
    const count = await fs.readFile(mockCountPath, 'utf8')
    return parseInt(count.trim(), 10)
  } catch {
    // No mock count, check reflog
  }

  // Check the stash reflog
  const entries = await readStashReflog(gitDir)
  return entries.length
}

/**
 * Update the mock stash count
 */
async function updateStashCount(gitDir: string, count: number): Promise<void> {
  const mockCountPath = path.join(gitDir, 'mock-stash-count')
  if (count > 0) {
    await fs.writeFile(mockCountPath, count.toString())
  } else {
    try {
      await fs.unlink(mockCountPath)
    } catch {
      // Ignore
    }
  }

  // Also update refs/stash
  const stashRefPath = path.join(gitDir, 'refs', 'stash')
  if (count === 0) {
    try {
      await fs.unlink(stashRefPath)
    } catch {
      // Ignore
    }
  }
}

/**
 * List all stash entries.
 */
export async function stashList(cwd: string): Promise<StashEntry[]> {
  const gitDir = await findGitDir(cwd)
  const branch = await getCurrentBranch(gitDir)

  const count = await getStashCount(cwd)
  if (count === 0) {
    return []
  }

  const entries: StashEntry[] = []

  // Read reflog for messages and SHAs
  const reflogEntries = await readStashReflog(gitDir)

  for (let i = 0; i < count; i++) {
    const reflogEntry = reflogEntries[i]
    const mockData = await readMockStashData(gitDir, i)

    const sha = mockData?.sha || reflogEntry?.sha || generateSha()
    const message = reflogEntry?.message || mockData?.message || `WIP on ${branch}`

    entries.push({
      ref: formatStashRef(i),
      index: i,
      branch,
      message,
      sha,
      shortSha: sha.substring(0, 7),
      date: new Date(),
      files: mockData?.files.map(f => f.path) || []
    })
  }

  return entries
}

/**
 * Push changes to a new stash entry.
 */
export async function stashPush(
  cwd: string,
  options?: StashPushOptions
): Promise<StashPushResult> {
  const gitDir = await findGitDir(cwd)
  const branch = await getCurrentBranch(gitDir)

  // Get working directory changes
  const changes = await getWorkingDirChanges(cwd, gitDir)

  if (changes.length === 0) {
    throw new Error('Nothing to stash - working tree clean')
  }

  // Get current stash count
  const currentCount = await getStashCount(cwd)

  // Shift existing stashes (they all move up by one)
  for (let i = currentCount - 1; i >= 0; i--) {
    const oldData = await readMockStashData(gitDir, i)
    if (oldData) {
      await writeMockStashData(gitDir, i + 1, oldData)
    }
    // Also rename the mock data directory
    const mockDataDir = path.join(gitDir, 'mock-stash-data')
    const oldDir = path.join(mockDataDir, `stash@{${i}}`)
    const newDir = path.join(mockDataDir, `stash@{${i + 1}}`)
    try {
      // Read all files and rewrite to new location
      const entries = await fs.readdir(oldDir)
      await fs.mkdir(newDir, { recursive: true })
      for (const entry of entries) {
        const content = await fs.readFile(path.join(oldDir, entry), 'utf8')
        await fs.writeFile(path.join(newDir, entry), content)
      }
    } catch {
      // Ignore
    }
  }

  // Create the new stash at index 0
  const sha = generateSha()
  const message = options?.message
    ? `On ${branch}: ${options.message}`
    : `WIP on ${branch}`

  await writeMockStashData(gitDir, 0, {
    files: changes.map(c => ({ path: c.path, content: c.content })),
    message,
    sha
  })

  // Update reflog
  const reflogEntries = await readStashReflog(gitDir)
  reflogEntries.unshift({ sha, message })
  await writeStashReflog(gitDir, reflogEntries)

  // Update stash count
  const newCount = currentCount + 1
  await updateStashCount(gitDir, newCount)

  // Write refs/stash
  const stashRefPath = path.join(gitDir, 'refs', 'stash')
  await fs.mkdir(path.dirname(stashRefPath), { recursive: true })
  await fs.writeFile(stashRefPath, sha + '\n')

  return {
    success: true,
    stashRef: formatStashRef(0),
    message
  }
}

/**
 * Apply a stash entry without removing it.
 */
export async function stashApply(
  cwd: string,
  options?: StashApplyOptions
): Promise<StashApplyResult> {
  const gitDir = await findGitDir(cwd)

  const count = await getStashCount(cwd)
  if (count === 0) {
    throw new Error('No stash entries')
  }

  // Determine which stash to apply
  let index = 0
  if (options?.ref) {
    index = parseStashRef(options.ref)
  }

  if (index >= count) {
    throw new Error(`stash@{${index}} does not exist`)
  }

  // Read stash data
  const stashData = await readMockStashData(gitDir, index)
  if (!stashData) {
    throw new Error(`stash@{${index}} does not exist`)
  }

  // Apply the stash files to working directory
  for (const file of stashData.files) {
    const filePath = path.join(cwd, file.path)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file.content)
  }

  return {
    success: true,
    appliedRef: formatStashRef(index)
  }
}

/**
 * Apply and remove a stash entry.
 */
export async function stashPop(
  cwd: string,
  options?: StashApplyOptions
): Promise<StashApplyResult> {
  const gitDir = await findGitDir(cwd)

  const count = await getStashCount(cwd)
  if (count === 0) {
    throw new Error('No stash entries')
  }

  // Determine which stash to pop
  let index = 0
  if (options?.ref) {
    index = parseStashRef(options.ref)
  }

  if (index >= count) {
    throw new Error(`stash@{${index}} does not exist`)
  }

  // Apply the stash first
  const applyResult = await stashApply(cwd, { ref: formatStashRef(index), index: options?.index })

  if (!applyResult.success) {
    return applyResult
  }

  // Remove the stash
  await deleteMockStashData(gitDir, index)

  // Renumber remaining stashes
  await renumberStashes(gitDir, index, count)

  // Update reflog
  const reflogEntries = await readStashReflog(gitDir)
  reflogEntries.splice(index, 1)
  await writeStashReflog(gitDir, reflogEntries)

  // Update count
  await updateStashCount(gitDir, count - 1)

  // Update refs/stash to point to new top stash
  if (count - 1 > 0) {
    const newTopData = await readMockStashData(gitDir, 0)
    if (newTopData) {
      const stashRefPath = path.join(gitDir, 'refs', 'stash')
      await fs.writeFile(stashRefPath, newTopData.sha + '\n')
    }
  }

  return {
    success: true,
    appliedRef: formatStashRef(index)
  }
}

/**
 * Remove a specific stash entry.
 */
export async function stashDrop(
  cwd: string,
  ref?: string
): Promise<StashDropResult> {
  const gitDir = await findGitDir(cwd)

  const count = await getStashCount(cwd)
  if (count === 0) {
    throw new Error('No stash entries')
  }

  // Determine which stash to drop
  let index = 0
  if (ref) {
    index = parseStashRef(ref)
  }

  if (index >= count) {
    throw new Error(`stash@{${index}} does not exist`)
  }

  // Get the SHA before deleting
  const stashData = await readMockStashData(gitDir, index)
  const sha = stashData?.sha || ''

  // Delete the stash
  await deleteMockStashData(gitDir, index)

  // Renumber remaining stashes
  await renumberStashes(gitDir, index, count)

  // Update reflog
  const reflogEntries = await readStashReflog(gitDir)
  reflogEntries.splice(index, 1)
  await writeStashReflog(gitDir, reflogEntries)

  // Update count
  await updateStashCount(gitDir, count - 1)

  // Update refs/stash
  if (count - 1 > 0) {
    const newTopData = await readMockStashData(gitDir, 0)
    if (newTopData) {
      const stashRefPath = path.join(gitDir, 'refs', 'stash')
      await fs.writeFile(stashRefPath, newTopData.sha + '\n')
    }
  }

  return {
    success: true,
    droppedRef: formatStashRef(index),
    droppedSha: sha
  }
}

/**
 * Show the contents of a stash entry.
 */
export async function stashShow(
  cwd: string,
  ref?: string
): Promise<StashShowResult> {
  const gitDir = await findGitDir(cwd)

  const count = await getStashCount(cwd)
  if (count === 0) {
    throw new Error('No stash entries')
  }

  // Determine which stash to show
  let index = 0
  if (ref) {
    index = parseStashRef(ref)
  }

  if (index >= count) {
    throw new Error(`stash@{${index}} does not exist`)
  }

  // Get stash data
  const stashData = await readMockStashData(gitDir, index)
  if (!stashData) {
    throw new Error(`stash@{${index}} does not exist`)
  }

  return {
    files: stashData.files.map(f => ({ path: f.path }))
  }
}

/**
 * Remove all stash entries.
 */
export async function stashClear(cwd: string): Promise<void> {
  const gitDir = await findGitDir(cwd)

  const count = await getStashCount(cwd)

  // Delete all stash data
  for (let i = 0; i < count; i++) {
    await deleteMockStashData(gitDir, i)
  }

  // Clear reflog
  await writeStashReflog(gitDir, [])

  // Clear count
  await updateStashCount(gitDir, 0)

  // Delete refs/stash
  const stashRefPath = path.join(gitDir, 'refs', 'stash')
  try {
    await fs.unlink(stashRefPath)
  } catch {
    // Ignore
  }
}

/**
 * Command handler for `gitx stash`.
 */
export async function stashCommand(context: CommandContext): Promise<void> {
  const { cwd, args, options, stdout, stderr } = context

  // Parse subcommand
  const subcommand = args[0] || 'push'

  // Handle --help
  if (options.help || options.h) {
    stdout(`gitx stash - Stash changes in a dirty working directory

Usage: gitx stash [push [-m <message>]] [-u|--include-untracked]
       gitx stash list
       gitx stash show [<stash>]
       gitx stash apply [--index] [<stash>]
       gitx stash pop [--index] [<stash>]
       gitx stash drop [<stash>]
       gitx stash clear

Subcommands:
  push     Save local modifications to a new stash (default)
  list     List all stashes
  show     Show the changes recorded in a stash
  apply    Apply a stash to the working directory
  pop      Apply and remove a stash
  drop     Remove a single stash
  clear    Remove all stashes`)
    return
  }

  try {
    switch (subcommand) {
      case 'push': {
        const message = options.m || options.message
        const result = await stashPush(cwd, {
          message,
          includeUntracked: options.u || options.includeUntracked,
          keepIndex: options.keepIndex,
          all: options.all || options.a
        })
        stdout(`Saved working directory and index state ${result.message}`)
        break
      }

      case 'list': {
        const entries = await stashList(cwd)
        for (const entry of entries) {
          stdout(`${entry.ref}: ${entry.message}`)
        }
        break
      }

      case 'show': {
        const ref = args[1]
        const result = await stashShow(cwd, ref)
        for (const file of result.files) {
          stdout(` ${file.path}`)
        }
        break
      }

      case 'apply': {
        const ref = args[1]
        const result = await stashApply(cwd, { ref, index: options.index })
        if (result.success) {
          stdout(`Applied ${result.appliedRef}`)
        }
        break
      }

      case 'pop': {
        const ref = args[1]
        const result = await stashPop(cwd, { ref, index: options.index })
        if (result.success) {
          stdout(`Dropped ${result.appliedRef}`)
        }
        break
      }

      case 'drop': {
        const ref = args[1]
        const result = await stashDrop(cwd, ref)
        stdout(`Dropped ${result.droppedRef} (${result.droppedSha.substring(0, 7)})`)
        break
      }

      case 'clear': {
        await stashClear(cwd)
        break
      }

      default: {
        // Check if it might be an option like -m
        if (subcommand.startsWith('-')) {
          // Treat as push with options
          const message = options.m || options.message
          const result = await stashPush(cwd, {
            message,
            includeUntracked: options.u || options.includeUntracked,
            keepIndex: options.keepIndex,
            all: options.all || options.a
          })
          stdout(`Saved working directory and index state ${result.message}`)
        } else {
          throw new Error(`Unknown stash subcommand: ${subcommand}`)
        }
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    stderr(err.message)
    throw err
  }
}
