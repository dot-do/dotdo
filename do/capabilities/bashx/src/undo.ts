/**
 * Undo Tracking Module
 *
 * Provides undo functionality for reversible file operations:
 * - cp: track destination to remove
 * - mv: track source and destination to reverse
 * - rm: track deleted file content for restoration
 * - mkdir: track created directory to remove
 *
 * This module provides both:
 * 1. An UndoManager class for request-scoped state (recommended for Workers)
 * 2. Module-level functions using a default instance (for backward compatibility)
 *
 * @module bashx/undo
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import type { BashResult, SafetyClassification } from './types.js'

const execAsync = promisify(exec)

/**
 * Error type for child_process exec errors.
 * Extends the standard Error with process-specific fields.
 *
 * @remarks
 * When child_process.exec() fails, it throws an Error with additional properties:
 * - `code`: The exit code of the process (number or undefined if killed)
 * - `killed`: Whether the process was terminated by a signal
 * - `stdout`: Standard output captured before the error occurred
 * - `stderr`: Standard error output
 */
interface ExecError extends Error {
  /** Exit code from the process (undefined if process was killed by signal) */
  code?: number
  /** Whether the process was killed by a signal */
  killed?: boolean
  /** Standard output captured before error (may be Buffer or string) */
  stdout?: Buffer | string
  /** Standard error captured (may be Buffer or string) */
  stderr?: Buffer | string
}

/**
 * Type guard to check if an error is an ExecError from child_process.
 *
 * An ExecError is an Error instance that has at least one of the exec-specific
 * properties (code, killed, stdout, stderr) with the correct type.
 *
 * @param error - The value to check
 * @returns True if the error is an ExecError with proper exec properties
 */
function isExecError(error: unknown): error is ExecError {
  // Must be an Error instance
  if (!(error instanceof Error)) {
    return false
  }

  // Cast to check properties (Error + additional properties)
  const err = error as unknown as Record<string, unknown>

  // Check for at least one exec-specific property with correct type
  const hasValidCode = 'code' in err && (typeof err.code === 'number' || err.code === undefined)
  const hasValidKilled = 'killed' in err && typeof err.killed === 'boolean'
  const hasValidStdout = 'stdout' in err && (typeof err.stdout === 'string' || Buffer.isBuffer(err.stdout))
  const hasValidStderr = 'stderr' in err && (typeof err.stderr === 'string' || Buffer.isBuffer(err.stderr))

  // Must have at least one exec-specific property
  return hasValidCode || hasValidKilled || hasValidStdout || hasValidStderr
}

/**
 * Error record structure returned by getErrorRecord
 */
export interface ErrorRecord {
  /** The error message */
  message: string
  /** Optional error code (e.g., 'ENOENT', 'EACCES') */
  code?: string
}

/**
 * Convert any error type to a normalized ErrorRecord.
 *
 * Handles multiple error types:
 * - Error objects: extracts message and optional code
 * - Strings: uses the string as the message
 * - Objects with message/code properties: extracts those properties
 * - null/undefined: returns a generic "Unknown error" message
 * - Other types: attempts to convert to string
 *
 * @param error - Any error value to normalize
 * @returns An ErrorRecord with at least a message property
 *
 * @example
 * ```typescript
 * getErrorRecord(new Error('test'))        // { message: 'test' }
 * getErrorRecord('string error')           // { message: 'string error' }
 * getErrorRecord({ code: 'ENOENT' })       // { message: 'Unknown error', code: 'ENOENT' }
 * getErrorRecord(null)                     // { message: 'Unknown error' }
 * ```
 */
export function getErrorRecord(error: unknown): ErrorRecord {
  // Handle null or undefined
  if (error === null || error === undefined) {
    return { message: 'Unknown error' }
  }

  // Handle Error instances
  if (error instanceof Error) {
    const record: ErrorRecord = { message: error.message }
    // Check for code property (common on Node.js errors)
    const errWithCode = error as unknown as { code?: unknown }
    if (typeof errWithCode.code === 'string') {
      record.code = errWithCode.code
    }
    return record
  }

  // Handle string errors
  if (typeof error === 'string') {
    return { message: error }
  }

  // Handle objects with message and/or code properties
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const record: ErrorRecord = {
      message: typeof obj.message === 'string' ? obj.message : 'Unknown error',
    }
    if (typeof obj.code === 'string') {
      record.code = obj.code
    }
    return record
  }

  // Fallback: try to convert to string
  return { message: String(error) }
}

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

/**
 * Undo info returned from tracking operations
 */
export interface UndoInfo {
  undoCommand: string
  type: UndoEntry['type']
  files: UndoEntry['files']
}

// ============================================================================
// UndoManager Class - Request-scoped state management
// ============================================================================

/**
 * UndoManager encapsulates all undo-related state for thread-safe operation.
 *
 * In a Cloudflare Workers environment, each request should create its own
 * UndoManager instance to avoid race conditions from concurrent requests.
 *
 * @example
 * ```typescript
 * // Per-request usage in Workers
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const undoManager = new UndoManager({ historyLimit: 50 })
 *     // ... use undoManager for this request
 *   }
 * }
 *
 * // Or with Durable Objects for persistent state
 * class BashSession extends DurableObject {
 *   private undoManager = new UndoManager()
 *   // ... undoManager persists across requests to this DO
 * }
 * ```
 */
export class UndoManager {
  /** Undo history stack (LIFO) */
  private history: UndoEntry[] = []

  /** Current undo options */
  private options: Required<UndoOptions>

  /** Counter for generating unique IDs - scoped to this instance */
  private idCounter = 0

  constructor(options?: UndoOptions) {
    this.options = {
      historyLimit: options?.historyLimit ?? 100,
      trackDeletedContent: options?.trackDeletedContent ?? true,
    }
  }

  /**
   * Generate a unique ID for an undo entry
   */
  private generateId(): string {
    return `undo-${Date.now()}-${++this.idCounter}`
  }

  /**
   * Get the current undo history
   */
  getHistory(): UndoEntry[] {
    return [...this.history]
  }

  /**
   * Clear all undo history
   */
  clearHistory(): void {
    this.history = []
  }

  /**
   * Set undo tracking options
   */
  setOptions(options: UndoOptions): void {
    if (options.historyLimit !== undefined) {
      this.options.historyLimit = options.historyLimit
    }
    if (options.trackDeletedContent !== undefined) {
      this.options.trackDeletedContent = options.trackDeletedContent
    }

    // Enforce new history limit
    if (options.historyLimit !== undefined) {
      if (options.historyLimit === 0) {
        this.history = []
      } else {
        while (this.history.length > options.historyLimit) {
          this.history.shift() // Remove oldest
        }
      }
    }
  }

  /**
   * Get current options
   */
  getOptions(): Required<UndoOptions> {
    return { ...this.options }
  }

  /**
   * Add an entry to undo history
   */
  addEntry(entry: Omit<UndoEntry, 'id' | 'timestamp'>): void {
    if (this.options.historyLimit === 0) return

    const fullEntry: UndoEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date(),
    }

    this.history.push(fullEntry)

    // Enforce history limit
    while (this.history.length > this.options.historyLimit) {
      this.history.shift() // Remove oldest
    }
  }

  /**
   * Execute an undo operation
   *
   * @param entryId - Optional ID of specific entry to undo. If not provided, undoes the most recent.
   * @returns Result of the undo command execution
   */
  async undo(entryId?: string): Promise<BashResult> {
    if (this.history.length === 0) {
      throw new Error('No undo history available')
    }

    let entry: UndoEntry | undefined
    let index: number

    if (entryId) {
      index = this.history.findIndex(e => e.id === entryId)
      if (index === -1) {
        throw new Error('Undo entry not found')
      }
      entry = this.history[index]
    } else {
      // Get most recent (last in array)
      index = this.history.length - 1
      entry = this.history[index]
    }

    // Execute the undo command
    try {
      const { stdout, stderr } = await execAsync(entry.undoCommand)

      // Remove from history on success
      this.history.splice(index, 1)

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
    } catch (error: unknown) {
      const execError = isExecError(error) ? error : null
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
        stdout: execError?.stdout?.toString() || '',
        stderr: execError?.stderr?.toString() || execError?.message || 'Undo failed',
        exitCode: execError?.code || 1,
      }
    }
  }

  /**
   * Generate undo information for a command before execution
   * Returns undo command and files to track, or null if not undoable
   */
  generateUndoInfo(command: string): UndoInfo | null {
    const { cmd, args } = parseArgs(command.trim())

    switch (cmd) {
      case 'cp': {
        const cpUndo = generateCpUndo(command, args)
        return cpUndo ? { ...cpUndo, type: 'cp' } : null
      }

      case 'mv': {
        const mvUndo = generateMvUndo(command, args)
        return mvUndo ? { ...mvUndo, type: 'mv' } : null
      }

      case 'rm': {
        const rmUndo = generateRmUndoWithOptions(command, args, this.options.trackDeletedContent)
        return rmUndo ? { ...rmUndo, type: 'rm' } : null
      }

      case 'mkdir': {
        const mkdirUndo = generateMkdirUndo(command, args)
        return mkdirUndo ? { ...mkdirUndo, type: 'mkdir' } : null
      }

      case 'rmdir':
        // rmdir is not easily undoable without content
        return null

      case 'touch': {
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
      }

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
  isReversible(command: string, classification: SafetyClassification): boolean {
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
    if (cmd === 'rm' && this.options.trackDeletedContent) {
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
  trackForUndo(command: string, classification: SafetyClassification): UndoInfo | null {
    // Don't track read-only or blocked commands
    if (classification.type === 'read' || classification.impact === 'none') {
      return null
    }

    // Don't track critical/blocked commands
    if (classification.impact === 'critical') {
      return null
    }

    return this.generateUndoInfo(command)
  }

  /**
   * Record a successful command execution in undo history
   *
   * @param command - The executed command
   * @param undoInfo - The undo information from trackForUndo
   */
  recordEntry(command: string, undoInfo: UndoInfo): void {
    this.addEntry({
      command,
      undoCommand: undoInfo.undoCommand,
      type: undoInfo.type,
      files: undoInfo.files,
    })
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a new UndoManager instance with optional configuration.
 * Use this for request-scoped undo tracking in concurrent environments.
 *
 * @param options - Configuration options
 * @returns A new UndoManager instance
 */
export function createUndoManager(options?: UndoOptions): UndoManager {
  return new UndoManager(options)
}

// ============================================================================
// Default instance for backward compatibility
// ============================================================================

/**
 * Default UndoManager instance.
 *
 * WARNING: This uses global mutable state and is NOT safe for concurrent
 * Workers requests. Use createUndoManager() for request-scoped tracking.
 *
 * @deprecated Use createUndoManager() for new code in concurrent environments
 */
const defaultManager = new UndoManager()

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
function generateCpUndo(_command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
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
function generateMvUndo(_command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
  const { paths } = extractFlagsAndPaths(args)

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
 *
 * @param _command - The original rm command
 * @param args - Parsed arguments
 * @param trackDeletedContent - Whether to track deleted file content
 */
function generateRmUndoWithOptions(_command: string, args: string[], trackDeletedContent: boolean): { undoCommand: string; files: UndoEntry['files'] } | null {
  if (!trackDeletedContent) return null

  const { paths } = extractFlagsAndPaths(args)
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
function generateMkdirUndo(_command: string, args: string[]): { undoCommand: string; files: UndoEntry['files'] } | null {
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
// Backward-Compatible Public API (delegates to defaultManager)
// ============================================================================

/**
 * Get the current undo history
 *
 * @deprecated For new code in concurrent environments, use UndoManager.getHistory()
 */
export function getUndoHistory(): UndoEntry[] {
  return defaultManager.getHistory()
}

/**
 * Clear all undo history
 *
 * @deprecated For new code in concurrent environments, use UndoManager.clearHistory()
 */
export function clearUndoHistory(): void {
  defaultManager.clearHistory()
}

/**
 * Set undo tracking options
 *
 * @deprecated For new code in concurrent environments, use UndoManager.setOptions()
 */
export function setUndoOptions(options: UndoOptions): void {
  defaultManager.setOptions(options)
}

/**
 * Add an entry to undo history
 *
 * @deprecated For new code in concurrent environments, use UndoManager.addEntry()
 */
export function addUndoEntry(entry: Omit<UndoEntry, 'id' | 'timestamp'>): void {
  defaultManager.addEntry(entry)
}

/**
 * Execute an undo operation
 *
 * @param entryId - Optional ID of specific entry to undo. If not provided, undoes the most recent.
 * @returns Result of the undo command execution
 *
 * @deprecated For new code in concurrent environments, use UndoManager.undo()
 */
export async function undo(entryId?: string): Promise<BashResult> {
  return defaultManager.undo(entryId)
}

/**
 * Generate undo information for a command before execution
 * Returns undo command and files to track, or null if not undoable
 *
 * @deprecated For new code in concurrent environments, use UndoManager.generateUndoInfo()
 */
export function generateUndoInfo(command: string): UndoInfo | null {
  return defaultManager.generateUndoInfo(command)
}

/**
 * Determine if a command is reversible based on analysis
 *
 * @deprecated For new code in concurrent environments, use UndoManager.isReversible()
 */
export function isReversible(
  command: string,
  classification: SafetyClassification
): boolean {
  return defaultManager.isReversible(command, classification)
}

/**
 * Track a command execution for undo
 * Call this BEFORE executing the command to capture original state
 *
 * @param command - The command being executed
 * @param classification - Safety classification of the command
 * @returns Undo info if trackable, null otherwise
 *
 * @deprecated For new code in concurrent environments, use UndoManager.trackForUndo()
 */
export function trackForUndo(
  command: string,
  classification: SafetyClassification
): UndoInfo | null {
  return defaultManager.trackForUndo(command, classification)
}

/**
 * Record a successful command execution in undo history
 *
 * @param command - The executed command
 * @param undoInfo - The undo information from trackForUndo
 *
 * @deprecated For new code in concurrent environments, use UndoManager.recordEntry()
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
