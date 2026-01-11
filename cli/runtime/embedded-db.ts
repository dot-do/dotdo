/**
 * Embedded DB
 *
 * SQLite-based storage for local DO development.
 * Provides persistence for DO state, snapshots, and cloning.
 */

import { Logger, createLogger } from '../utils/logger'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface DOState {
  id: string
  className: string
  state: Record<string, unknown>
  storage: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface DOSnapshot {
  id: string
  doId: string
  state: DOState
  createdAt: number
  label?: string
}

export interface EmbeddedDBOptions {
  logger?: Logger
  persist?: boolean | string
}

/**
 * Embedded SQLite database for DO storage
 */
export class EmbeddedDB {
  private logger: Logger
  private dbPath: string
  private db: unknown | null = null // Will be better-sqlite3 or bun:sqlite instance

  constructor(options: EmbeddedDBOptions = {}) {
    this.logger = options.logger ?? createLogger('db')

    // Determine storage path
    if (typeof options.persist === 'string') {
      this.dbPath = options.persist
    } else if (options.persist === false) {
      this.dbPath = ':memory:'
    } else {
      // Default: .dotdo directory in project or home
      const dotdoDir = this.findDotdoDir()
      this.dbPath = path.join(dotdoDir, 'local.db')
    }

    this.ensureDir()
  }

  /**
   * Find or create .dotdo directory
   */
  private findDotdoDir(): string {
    // Look for project .dotdo first
    const projectDir = process.cwd()
    const projectDotdo = path.join(projectDir, '.dotdo')

    if (fs.existsSync(projectDotdo)) {
      return projectDotdo
    }

    // Fall back to home directory
    const homeDotdo = path.join(os.homedir(), '.dotdo')
    return homeDotdo
  }

  /**
   * Ensure the database directory exists
   */
  private ensureDir(): void {
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        this.logger.debug(`Created directory: ${dir}`)
      }
    }
  }

  /**
   * Initialize the database with schema
   */
  async init(): Promise<void> {
    // Use dynamic import for SQLite (works with both Bun and Node)
    try {
      // Bun has built-in SQLite
      if (typeof Bun !== 'undefined') {
        const { Database } = await import('bun:sqlite')
        this.db = new Database(this.dbPath)
      } else {
        // Node.js fallback
        const betterSqlite = await import('better-sqlite3')
        this.db = new betterSqlite.default(this.dbPath)
      }

      this.logger.debug(`Database initialized at ${this.dbPath}`)
      await this.createTables()
    } catch (error) {
      this.logger.error('Failed to initialize database', { error })
      throw error
    }
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    const db = this.getDB()

    // Durable Object state table
    db.exec(`
      CREATE TABLE IF NOT EXISTS do_state (
        id TEXT PRIMARY KEY,
        class_name TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '{}',
        storage TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    // Snapshots table
    db.exec(`
      CREATE TABLE IF NOT EXISTS do_snapshots (
        id TEXT PRIMARY KEY,
        do_id TEXT NOT NULL,
        state TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (do_id) REFERENCES do_state(id)
      )
    `)

    // Alarms table
    db.exec(`
      CREATE TABLE IF NOT EXISTS do_alarms (
        id TEXT PRIMARY KEY,
        do_id TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (do_id) REFERENCES do_state(id)
      )
    `)

    this.logger.debug('Database tables created')
  }

  /**
   * Get the underlying database instance
   */
  private getDB(): { exec: (sql: string) => void; prepare: (sql: string) => { run: (...params: unknown[]) => void; get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] } } {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.')
    }
    return this.db as { exec: (sql: string) => void; prepare: (sql: string) => { run: (...params: unknown[]) => void; get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] } }
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.dbPath
  }

  /**
   * List all DO instances
   */
  async list(className?: string): Promise<DOState[]> {
    const db = this.getDB()

    let rows: unknown[]
    if (className) {
      rows = db.prepare('SELECT * FROM do_state WHERE class_name = ?').all(className)
    } else {
      rows = db.prepare('SELECT * FROM do_state').all()
    }

    return (rows as Array<{ id: string; class_name: string; state: string; storage: string; created_at: number; updated_at: number }>).map(row => ({
      id: row.id,
      className: row.class_name,
      state: JSON.parse(row.state),
      storage: JSON.parse(row.storage),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Get a specific DO instance
   */
  async get(id: string): Promise<DOState | null> {
    const db = this.getDB()
    const row = db.prepare('SELECT * FROM do_state WHERE id = ?').get(id) as { id: string; class_name: string; state: string; storage: string; created_at: number; updated_at: number } | undefined

    if (!row) return null

    return {
      id: row.id,
      className: row.class_name,
      state: JSON.parse(row.state),
      storage: JSON.parse(row.storage),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Save a DO instance
   */
  async save(state: DOState): Promise<void> {
    const db = this.getDB()
    db.prepare(`
      INSERT OR REPLACE INTO do_state (id, class_name, state, storage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      state.id,
      state.className,
      JSON.stringify(state.state),
      JSON.stringify(state.storage),
      state.createdAt,
      Date.now()
    )
  }

  /**
   * Delete a DO instance
   */
  async delete(id: string): Promise<boolean> {
    const db = this.getDB()

    // Delete associated snapshots first
    db.prepare('DELETE FROM do_snapshots WHERE do_id = ?').run(id)
    db.prepare('DELETE FROM do_alarms WHERE do_id = ?').run(id)
    db.prepare('DELETE FROM do_state WHERE id = ?').run(id)

    return true
  }

  /**
   * Create a snapshot of a DO instance
   */
  async snapshot(doId: string, label?: string): Promise<string> {
    const state = await this.get(doId)
    if (!state) {
      throw new Error(`DO not found: ${doId}`)
    }

    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const db = this.getDB()

    db.prepare(`
      INSERT INTO do_snapshots (id, do_id, state, label, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(snapshotId, doId, JSON.stringify(state), label ?? null, Date.now())

    return snapshotId
  }

  /**
   * List snapshots for a DO
   */
  async listSnapshots(doId: string): Promise<DOSnapshot[]> {
    const db = this.getDB()
    const rows = db.prepare('SELECT * FROM do_snapshots WHERE do_id = ? ORDER BY created_at DESC').all(doId) as Array<{
      id: string
      do_id: string
      state: string
      label: string | null
      created_at: number
    }>

    return rows.map(row => ({
      id: row.id,
      doId: row.do_id,
      state: JSON.parse(row.state),
      label: row.label ?? undefined,
      createdAt: row.created_at,
    }))
  }

  /**
   * Restore a DO from a snapshot
   */
  async restore(doId: string, snapshotId: string): Promise<void> {
    const db = this.getDB()
    const row = db.prepare('SELECT * FROM do_snapshots WHERE id = ? AND do_id = ?').get(snapshotId, doId) as {
      state: string
    } | undefined

    if (!row) {
      throw new Error(`Snapshot not found: ${snapshotId}`)
    }

    const state: DOState = JSON.parse(row.state)
    state.updatedAt = Date.now()
    await this.save(state)
  }

  /**
   * Clone a DO instance
   */
  async clone(sourceId: string, targetId: string): Promise<void> {
    const state = await this.get(sourceId)
    if (!state) {
      throw new Error(`DO not found: ${sourceId}`)
    }

    const newState: DOState = {
      ...state,
      id: targetId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await this.save(newState)
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db && typeof (this.db as { close?: () => void }).close === 'function') {
      (this.db as { close: () => void }).close()
      this.db = null
    }
  }
}

/**
 * Create a new embedded DB instance
 */
export function createDB(options?: EmbeddedDBOptions): EmbeddedDB {
  return new EmbeddedDB(options)
}
