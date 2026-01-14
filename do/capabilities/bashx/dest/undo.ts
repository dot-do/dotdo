/**
 * Undo Tracking Module
 *
 * Provides undo functionality for reversible file operations:
 * - cp: track destination to remove
 * - mv: track source and destination to reverse
 * - rm: track deleted file content for restoration
 * - mkdir: track created directory to remove
 *
 * @module bashx/undo
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import type { BashResult, SafetyClassification } from './types.js'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

/**
 * An entry in the undo history
 */
export interface UndoEntry {
  /** Unique identifier for this undo entry */
  id: string
  /** The original command that was executed */
  command: string
  /** The generated undo command */
  undoCommand: string
  /** Timestamp when the command was executed */
  timestamp: Date
  /** Type of operation */
  type: 'cp' | 'mv' | 'rm' | 'mkdir' | 'rmdir' | 'touch' | 'write'
  /** Files affected by the operation */
  files: {
    path: string
    /** Original content (for file modifications) */
    originalContent?: string
    /** Original path (for mv operations) */
    originalPath?: string
    /** Whether the file existed before the operation */
    existed: boolean
  }[]
}

/**
 * Options for undo tracking
 */
export interface UndoOptions {
  /** Maximum number of undo entries to keep */
  historyLimit?: number
  /** Whether to track file content for rm operations */
  trackDeletedContent?: boolean
}

// ============================================================================
// State
// ============================================================================

/** Undo history stack (LIFO) */
let undoHistory: UndoEntry[] = []

/** Current undo options */
let undoOptions: UndoOptions = {
  historyLimit: 100,
  trackDeletedContent: true,
}

/** Counter for generating unique IDs */
let idCounter = 0

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID for an undo entry
 */
function generateId(): string {
  return `undo-${Date.now()}-${++idCounter}`
}

/**
 * Shell escape a string for safe use in commands
 */
function shellEscape(str: string): string {
  if (str === '') return "''"
  if (/^[a-zA-Z0-9_\-./:=@]+$/.test(str)) return str
  return "'" + str.replace(/'/g, "'\"'\"'") + "'"
}

/**
 * Parse command arguments respecting quotes
 */
function parseArgs(command: string): { cmd: string; args: string[] } {
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
    } else if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(stripQuotes(current))
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(stripQuotes(current))
  }

  return {
    cmd: tokens[0] || '',
    args: tokens.slice(1),
  }
}

/**
 * Strip outer quotes from a string
 */
function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * Extract flags and paths from arguments
 */
function extractFlagsAndPaths(args: string[]): { flags: string[]; paths: string[] } {
  const flags: string[] = []
  const paths: string[] = []

  for (const arg of args) {
    if (arg.startsWith('-')) {
      flags.push(arg)
    } else {
      paths.push(arg)
    }
  }

  return { flags, paths }
}

/**
 * Check if flags include recursive
 */
function hasRecursive(flags: string[]): boolean {
  return flags.some(f => f === '-r' || f === '-R' || f === '-rf' || f === '-fr' || f === '-rp' || f.includes('r'))
}

/**
 * Read file content safely
 */
function readFileSafely(path: string): string | undefined {
  try {
    if (existsSync(path)) {
      const stats = statSync(path)
      if (stats.isFile() && stats.size < 10 * 1024 * 1024) { // Max 10MB
        return readFileSync(path, 'utf-8')
      }
    }
  } catch {
    // Ignore read errors
  }
  return undefined
}

/**
 * Check if path exists
 */
function pathExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Check if path is a directory
 */
function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

// ============================================================================
// Undo Command Generation
// ============================================================================

/**
 * Generate undo command for cp operation
 */
function generateCpUndo(command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
  const { flags, paths } = extractFlagsAndPaths(args)
  const recursive = hasRecursive(flags)

  if (paths.length < 2) return null

  const sources = paths.slice(0, -1)
  const dest = paths[paths.length - 1]
  const files: UndoEntry['files'] = []

  // Check if destination is a directory (multiple sources or dest is dir)
  const destIsDir = sources.length > 1 || isDirectory(dest)

  if (destIsDir) {
    // Files will be created inside dest directory
    const createdFiles = sources.map(src => {
      const filename = basename(src)
      return join(dest, filename)
    })

    // Generate rm command for all created files
    const rmCmd = recursive ? 'rm -r' : 'rm'
    const escapedFiles = createdFiles.map(f => shellEscape(f)).join(' ')

    for (const file of createdFiles) {
      files.push({
        path: file,
        existed: pathExists(file),
      })
    }

    return {
      undoCommand: `${rmCmd} ${escapedFiles}`,
      files,
    }
  } else {
    // Single source to single dest
    files.push({
      path: dest,
      existed: pathExists(dest),
      originalContent: readFileSafely(dest),
    })

    const rmCmd = recursive ? 'rm -r' : 'rm'
    return {
      undoCommand: `${rmCmd} ${shellEscape(dest)}`,
      files,
    }
  }
}

/**
 * Generate undo command for mv operation
 */
function generateMvUndo(command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
  const { flags, paths } = extractFlagsAndPaths(args)

  if (paths.length < 2) return null

  const sources = paths.slice(0, -1)
  const dest = paths[paths.length - 1]
  const files: UndoEntry['files'] = []

  // Check if destination is/will be a directory
  const destIsDir = sources.length > 1 || isDirectory(dest)

  if (destIsDir) {
    // Multiple sources moved to directory - need to reverse each
    const mvCommands: string[] = []

    for (const src of sources) {
      const filename = basename(src)
      const movedPath = join(dest, filename)

      files.push({
        path: movedPath,
        originalPath: src,
        existed: pathExists(src),
      })

      mvCommands.push(`mv ${shellEscape(movedPath)} ${shellEscape(src)}`)
    }

    return {
      undoCommand: mvCommands.join(' && '),
      files,
    }
  } else {
    // Single source to single dest
    files.push({
      path: dest,
      originalPath: sources[0],
      existed: pathExists(sources[0]),
    })

    return {
      undoCommand: `mv ${shellEscape(dest)} ${shellEscape(sources[0])}`,
      files,
    }
  }
}

/**
 * Generate undo command for rm operation
 */
function generateRmUndo(command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
  if (!undoOptions.trackDeletedContent) return null

  const { flags, paths } = extractFlagsAndPaths(args)
  const files: UndoEntry['files'] = []

  // For rm, we need to capture file content before deletion
  // This is a simplified version - real implementation would need
  // to handle directories recursively
  for (const path of paths) {
    const content = readFileSafely(path)
    files.push({
      path,
      originalContent: content,
      existed: pathExists(path),
    })
  }

  // Generate restoration commands
  // This is simplified - real restoration would need temp storage
  const restoreCommands = files
    .filter(f => f.originalContent !== undefined)
    .map(f => `echo ${shellEscape(f.originalContent!)} > ${shellEscape(f.path)}`)
    .join(' && ')

  if (!restoreCommands) return null

  return {
    undoCommand: restoreCommands,
    files,
  }
}

/**
 * Generate undo command for mkdir operation
 */
function generateMkdirUndo(command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
  const { flags, paths } = extractFlagsAndPaths(args)
  const hasP = flags.some(f => f === '-p' || f.includes('p'))
  const files: UndoEntry['files'] = []

  if (paths.length === 0) return null

  for (const path of paths) {
    files.push({
      path,
      existed: pathExists(path),
    })
  }

  // For -p flag, we need to remove from deepest to shallowest
  // For simplicity, use rmdir which will fail on non-empty dirs
  const escapedPaths = paths.map(p => shellEscape(p)).join(' ')

  if (hasP) {
    // Reverse order for nested directories
    const reversedPaths = [...paths].reverse().map(p => shellEscape(p)).join(' ')
    return {
      undoCommand: `rmdir ${reversedPaths}`,
      files,
    }
  }

  return {
    undoCommand: `rmdir ${escapedPaths}`,
    files,
  }
}

/**
 * Generate undo command for write redirections (echo/cat > file)
 */
function generateWriteUndo(command: string): { undoCommand: string; type: UndoEntry['type']; files: UndoEntry['files'] } | null {
  // Match echo/cat commands with > or >> redirection
  const overwriteMatch = command.match(/^(echo|cat|printf)\s+.*?\s*>\s*([^\s>]+)$/)
  const appendMatch = command.match(/^(echo|cat|printf)\s+.*?\s*>>\s*([^\s>]+)$/)

  if (overwriteMatch) {
    const targetFile = stripQuotes(overwriteMatch[2])
    const originalContent = readFileSafely(targetFile)
    const existed = pathExists(targetFile)

    const files: UndoEntry['files'] = [{
      path: targetFile,
      originalContent,
      existed,
    }]

    // If file existed, restore content; otherwise remove
    const undoCommand = existed && originalContent !== undefined
      ? `echo ${shellEscape(originalContent)} > ${shellEscape(targetFile)}`
      : `rm ${shellEscape(targetFile)}`

    return { undoCommand, type: 'write', files }
  }

  if (appendMatch) {
    const targetFile = stripQuotes(appendMatch[2])
    const originalContent = readFileSafely(targetFile)

    const files: UndoEntry['files'] = [{
      path: targetFile,
      originalContent,
      existed: pathExists(targetFile),
    }]

    // For append, we'd need to know what was appended - simplified version
    if (originalContent !== undefined) {
      return {
        undoCommand: `echo ${shellEscape(originalContent)} > ${shellEscape(targetFile)}`,
        type: 'write',
        files,
      }
    }
  }

  return null
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current undo history
 */
export function getUndoHistory(): UndoEntry[] {
  return [...undoHistory]
}

/**
 * Clear all undo history
 */
export function clearUndoHistory(): void {
  undoHistory = []
}

/**
 * Set undo tracking options
 */
export function setUndoOptions(options: UndoOptions): void {
  undoOptions = { ...undoOptions, ...options }

  // Enforce new history limit
  if (options.historyLimit !== undefined) {
    if (options.historyLimit === 0) {
      undoHistory = []
    } else {
      while (undoHistory.length > options.historyLimit) {
        undoHistory.shift() // Remove oldest
      }
    }
  }
}

/**
 * Add an entry to undo history
 */
export function addUndoEntry(entry: Omit<UndoEntry, 'id' | 'timestamp'>): void {
  if (undoOptions.historyLimit === 0) return

  const fullEntry: UndoEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date(),
  }

  undoHistory.push(fullEntry)

  // Enforce history limit
  while (undoHistory.length > (undoOptions.historyLimit ?? 100)) {
    undoHistory.shift() // Remove oldest
  }
}

/**
 * Execute an undo operation
 *
 * @param entryId - Optional ID of specific entry to undo. If not provided, undoes the most recent.
 * @returns Result of the undo command execution
 */
export async function undo(entryId?: string): Promise<BashResult> {
  if (undoHistory.length === 0) {
    throw new Error('No undo history available')
  }

  let entry: UndoEntry | undefined
  let index: number

  if (entryId) {
    index = undoHistory.findIndex(e => e.id === entryId)
    if (index === -1) {
      throw new Error('Undo entry not found')
    }
    entry = undoHistory[index]
  } else {
    // Get most recent (last in array)
    index = undoHistory.length - 1
    entry = undoHistory[index]
  }

  // Execute the undo command
  try {
    const { stdout, stderr } = await execAsync(entry.undoCommand)

    // Remove from history on success
    undoHistory.splice(index, 1)

    return {
      input: entry.undoCommand,
      valid: true,
      intent: {
        commands: [entry.undoCommand.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'write',
        impact: 'low',
        reversible: true,
        reason: 'Undo operation',
      },
      command: entry.undoCommand,
      generated: false,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
    }
  } catch (error: any) {
    return {
      input: entry.undoCommand,
      valid: true,
      intent: {
        commands: [entry.undoCommand.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'write',
        impact: 'low',
        reversible: true,
        reason: 'Undo operation failed',
      },
      command: entry.undoCommand,
      generated: false,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
      exitCode: error.code || 1,
    }
  }
}

/**
 * Generate undo information for a command before execution
 * Returns undo command and files to track, or null if not undoable
 */
export function generateUndoInfo(command: string): {
  undoCommand: string
  type: UndoEntry['type']
  files: UndoEntry['files']
} | null {
  const { cmd, args } = parseArgs(command.trim())

  switch (cmd) {
    case 'cp':
      const cpUndo = generateCpUndo(command, args)
      return cpUndo ? { ...cpUndo, type: 'cp' } : null

    case 'mv':
      const mvUndo = generateMvUndo(command, args)
      return mvUndo ? { ...mvUndo, type: 'mv' } : null

    case 'rm':
      const rmUndo = generateRmUndo(command, args)
      return rmUndo ? { ...rmUndo, type: 'rm' } : null

    case 'mkdir':
      const mkdirUndo = generateMkdirUndo(command, args)
      return mkdirUndo ? { ...mkdirUndo, type: 'mkdir' } : null

    case 'rmdir':
      // rmdir is not easily undoable without content
      return null

    case 'touch':
      // touch creates or updates timestamp - track file creation
      const { paths: touchPaths } = extractFlagsAndPaths(args)
      if (touchPaths.length > 0) {
        const touchFiles = touchPaths.map(p => ({
          path: p,
          existed: pathExists(p),
        }))
        const newFiles = touchPaths.filter(p => !pathExists(p))
        if (newFiles.length > 0) {
          return {
            undoCommand: `rm ${newFiles.map(f => shellEscape(f)).join(' ')}`,
            type: 'touch',
            files: touchFiles,
          }
        }
      }
      return null

    case 'echo':
    case 'cat':
    case 'printf':
      // Check for redirect
      if (command.includes('>')) {
        return generateWriteUndo(command)
      }
      return null

    default:
      return null
  }
}

/**
 * Determine if a command is reversible based on analysis
 */
export function isReversible(
  command: string,
  classification: SafetyClassification
): boolean {
  // Read-only commands are trivially "reversible" (no change)
  if (classification.type === 'read' || classification.impact === 'none') {
    return true
  }

  // Network operations are not reversible
  if (classification.type === 'network') {
    return false
  }

  // Check for specific reversible commands
  const { cmd } = parseArgs(command.trim())
  const reversibleCommands = new Set(['cp', 'mv', 'mkdir', 'touch'])

  if (reversibleCommands.has(cmd)) {
    return true
  }

  // rm is reversible only with content tracking enabled
  if (cmd === 'rm' && undoOptions.trackDeletedContent) {
    return true
  }

  // Write redirections are reversible
  if ((cmd === 'echo' || cmd === 'cat' || cmd === 'printf') && command.includes('>')) {
    return true
  }

  // Pipelines with file output are generally not reversible
  if (command.includes('|')) {
    return false
  }

  return classification.reversible
}

/**
 * Track a command execution for undo
 * Call this BEFORE executing the command to capture original state
 *
 * @param command - The command being executed
 * @param classification - Safety classification of the command
 * @returns Undo info if trackable, null otherwise
 */
export function trackForUndo(
  command: string,
  classification: SafetyClassification
): { undoCommand: string; type: UndoEntry['type']; files: UndoEntry['files'] } | null {
  // Don't track read-only or blocked commands
  if (classification.type === 'read' || classification.impact === 'none') {
    return null
  }

  // Don't track critical/blocked commands
  if (classification.impact === 'critical') {
    return null
  }

  return generateUndoInfo(command)
}

/**
 * Record a successful command execution in undo history
 *
 * @param command - The executed command
 * @param undoInfo - The undo information from trackForUndo
 */
export function recordUndoEntry(
  command: string,
  undoInfo: { undoCommand: string; type: UndoEntry['type']; files: UndoEntry['files'] }
): void {
  addUndoEntry({
    command,
    undoCommand: undoInfo.undoCommand,
    type: undoInfo.type,
    files: undoInfo.files,
  })
}
