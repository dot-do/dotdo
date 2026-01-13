/**
 * CouchDB Client
 *
 * Main entry point for CouchDB-compatible API.
 * Supports multiple storage backends.
 */

import type { Backend } from './backends/interface'
import { MemoryBackend } from './backends/memory'
import { Database } from './database'
import type { DatabaseInfo, ReplicateOptions, ReplicateResult } from './types'

/**
 * CouchDB client options
 */
export interface CouchDBOptions {
  /**
   * Storage backend to use
   * Defaults to MemoryBackend for testing
   */
  backend?: Backend
}

/**
 * CouchDB Client
 *
 * Provides access to databases with CouchDB-compatible API.
 */
export class CouchDB {
  private backend: Backend

  constructor(options?: CouchDBOptions) {
    this.backend = options?.backend ?? new MemoryBackend()
  }

  /**
   * Create a new database
   */
  async createDatabase(name: string): Promise<{ ok: boolean }> {
    const exists = await this.backend.hasDatabase(name)
    if (exists) {
      throw new Error(`Database '${name}' already exists`)
    }
    await this.backend.createDatabase(name)
    return { ok: true }
  }

  /**
   * Delete a database
   */
  async deleteDatabase(name: string): Promise<{ ok: boolean }> {
    const exists = await this.backend.hasDatabase(name)
    if (!exists) {
      throw new Error(`Database '${name}' not found`)
    }
    await this.backend.deleteDatabase(name)
    return { ok: true }
  }

  /**
   * Get database info
   */
  async info(name: string): Promise<DatabaseInfo> {
    return this.backend.getDatabaseInfo(name)
  }

  /**
   * List all databases
   */
  async listDatabases(): Promise<string[]> {
    return this.backend.listDatabases()
  }

  /**
   * Get a Database instance for the given name
   */
  use(name: string): Database {
    return new Database(name, this.backend)
  }

  /**
   * Alias for use()
   */
  db(name: string): Database {
    return this.use(name)
  }

  /**
   * Get the revision number from a revision string
   */
  private getRevNum(rev: string): number {
    const match = rev.match(/^(\d+)-/)
    return match ? parseInt(match[1], 10) : 0
  }

  /**
   * Replicate from source to target database
   */
  async replicate(
    source: string,
    target: string,
    options?: ReplicateOptions
  ): Promise<ReplicateResult> {
    const sourceExists = await this.backend.hasDatabase(source)
    if (!sourceExists) {
      throw new Error(`Source database '${source}' not found`)
    }

    const targetExists = await this.backend.hasDatabase(target)
    if (!targetExists) {
      if (options?.create_target) {
        await this.backend.createDatabase(target)
      } else {
        throw new Error(`Target database '${target}' not found`)
      }
    }

    const sourceDb = this.use(source)
    const targetDb = this.use(target)

    // Get source changes from the beginning
    const sourceChanges = await sourceDb.changes({ since: 0 })

    let docsRead = 0
    let docsWritten = 0
    let docWriteFailures = 0

    for (const change of sourceChanges.results) {
      docsRead++

      try {
        if (change.deleted) {
          // Replicate deletion
          try {
            const existing = await targetDb.get(change.id)
            await targetDb.delete(change.id, existing._rev!)
            docsWritten++
          } catch {
            // Document doesn't exist in target, nothing to delete
          }
        } else {
          // Replicate document
          const sourceDoc = await sourceDb.get(change.id)

          try {
            // Try to get existing doc to handle update
            const existing = await targetDb.get(change.id)

            // Compare source revision number - only update if source is newer
            const sourceRevNum = this.getRevNum(sourceDoc._rev!)
            const targetRevNum = this.getRevNum(existing._rev!)

            if (sourceRevNum > targetRevNum) {
              await targetDb.put({ ...sourceDoc, _rev: existing._rev })
              docsWritten++
            }
            // If same or older, skip - already replicated
          } catch {
            // New document in target
            const { _rev, ...docWithoutRev } = sourceDoc
            await targetDb.put(docWithoutRev)
            docsWritten++
          }
        }
      } catch (error) {
        docWriteFailures++
      }
    }

    return {
      ok: true,
      docs_read: docsRead,
      docs_written: docsWritten,
      doc_write_failures: docWriteFailures,
    }
  }
}
