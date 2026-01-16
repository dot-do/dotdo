/**
 * History Manager - Persistent REPL history
 *
 * Features:
 * - Persists history to ~/.dotdo/repl_history
 * - Creates directory with 0700 permissions
 * - Creates file with 0600 permissions
 * - Filters sensitive commands (token, password, secret, key - case insensitive)
 * - Max size default 1000, FIFO removal
 * - Handles malformed files gracefully
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface HistoryManagerOptions {
  historyPath?: string
  maxSize?: number
}

// Sensitive patterns - case insensitive
const SENSITIVE_PATTERNS = ['token', 'password', 'secret', 'key']

function isSensitive(entry: string): boolean {
  const lower = entry.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
}

export class HistoryManager {
  private readonly _historyPath: string
  private readonly _dotdoDir: string
  private readonly _maxSize: number
  private _history: string[] = []

  constructor(options?: HistoryManagerOptions) {
    this._historyPath = options?.historyPath ?? path.join(os.homedir(), '.dotdo', 'repl_history')
    this._dotdoDir = path.dirname(this._historyPath)
    this._maxSize = options?.maxSize ?? 1000
  }

  get maxSize(): number {
    return this._maxSize
  }

  get size(): number {
    return this._history.length
  }

  initialize(): void {
    // Ensure directory exists with proper permissions
    this._ensureDirectory()

    // Load existing history
    this._loadHistory()

    // Check and fix file permissions if needed
    this._checkPermissions()
  }

  add(entry: string): void {
    // Skip empty or whitespace-only entries
    if (!entry || !entry.trim()) {
      return
    }

    // Skip duplicate consecutive entries
    if (this._history.length > 0 && this._history[this._history.length - 1] === entry) {
      return
    }

    // Add to in-memory history
    this._history.push(entry)

    // Enforce max size (FIFO removal)
    while (this._history.length > this._maxSize) {
      this._history.shift()
    }

    // Only persist non-sensitive commands
    if (!isSensitive(entry)) {
      this._persistHistory()
    }
  }

  getHistory(): string[] {
    return [...this._history]
  }

  getEntry(index: number): string | undefined {
    if (index < 0 || index >= this._history.length) {
      return undefined
    }
    return this._history[index]
  }

  clear(): void {
    this._history = []
    this._persistHistory()
  }

  search(query: string): string[] {
    return this._history.filter((entry) => entry.includes(query))
  }

  private _ensureDirectory(): void {
    try {
      if (!fs.existsSync(this._dotdoDir)) {
        fs.mkdirSync(this._dotdoDir, {
          recursive: true,
          mode: 0o700,
        })
      }
    } catch {
      // Silently handle errors - history is optional
    }
  }

  private _loadHistory(): void {
    try {
      if (!fs.existsSync(this._historyPath)) {
        this._history = []
        return
      }

      const content = fs.readFileSync(this._historyPath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim() !== '')

      // Respect max size - keep most recent entries
      if (lines.length > this._maxSize) {
        this._history = lines.slice(-this._maxSize)
      } else {
        this._history = lines
      }
    } catch {
      // Handle read errors gracefully - start with empty history
      this._history = []
    }
  }

  private _checkPermissions(): void {
    try {
      if (!fs.existsSync(this._historyPath)) {
        return
      }

      const stats = fs.statSync(this._historyPath)
      // Check if permissions are not 0600 (owner read/write only)
      // The mode includes file type bits, so we mask to get just permissions
      const permissions = stats.mode & 0o777
      if (permissions !== 0o600) {
        fs.chmodSync(this._historyPath, 0o600)
      }
    } catch {
      // Silently handle permission check errors
    }
  }

  private _persistHistory(): void {
    try {
      // Filter out sensitive commands before persisting
      const nonSensitiveHistory = this._history.filter((entry) => !isSensitive(entry))
      const content = nonSensitiveHistory.join('\n')

      fs.writeFileSync(this._historyPath, content, {
        encoding: 'utf-8',
        mode: 0o600,
      })
    } catch {
      // Silently handle write errors - in-memory history is still valid
    }
  }
}
