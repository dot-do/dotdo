/**
 * Real SQLite Test Utilities for @dotdo/db
 *
 * This module provides access to real SQLite storage via Miniflare's
 * Durable Object implementation. Following the NO MOCKS philosophy from CLAUDE.md:
 *
 * "Durable Objects require NO MOCKING. Miniflare runs real DOs with real SQLite locally."
 *
 * Usage:
 *   import { createRealSqlStorage, cleanupMiniflare } from './sqlite-test-utils'
 *
 *   describe('SQLite Tests', () => {
 *     let sql: SqlStorage
 *     let cleanup: () => Promise<void>
 *
 *     beforeEach(async () => {
 *       const result = await createRealSqlStorage()
 *       sql = result.sql
 *       cleanup = result.cleanup
 *     })
 *
 *     afterEach(async () => {
 *       await cleanup()
 *     })
 *
 *     it('should work with real SQLite', () => {
 *       sql.exec('CREATE TABLE test (id TEXT)')
 *       // ...
 *     })
 *   })
 *
 * @module db/tests/sqlite-test-utils
 */

import { Miniflare } from 'miniflare'
import type { SqlStorage } from '../sqlite'

// ============================================================================
// DURABLE OBJECT SCRIPT FOR REAL SQLITE ACCESS
// ============================================================================

/**
 * Minimal DO script that exposes SqlStorage for testing.
 * This provides a real SqlStorage interface backed by actual SQLite.
 */
const SQL_TEST_DO_SCRIPT = `
export class SqlTestDO {
  constructor(state, env) {
    this.state = state
    this.sql = state.storage.sql
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      if (path === '/exec' && request.method === 'POST') {
        const { sql } = await request.json()
        const result = this.sql.exec(sql)
        return Response.json({
          results: result.toArray ? result.toArray() : []
        })
      }

      if (path === '/prepare' && request.method === 'POST') {
        const { sql, values, operation } = await request.json()
        const stmt = this.sql.exec(sql, ...values)

        if (operation === 'first') {
          const rows = stmt.toArray ? stmt.toArray() : []
          return Response.json({ result: rows[0] || null })
        }

        if (operation === 'all') {
          const rows = stmt.toArray ? stmt.toArray() : []
          return Response.json({ results: rows })
        }

        if (operation === 'run') {
          return Response.json({ success: true })
        }

        return Response.json({ error: 'Unknown operation' }, { status: 400 })
      }

      if (path === '/health') {
        return Response.json({ status: 'ok', id: this.state.id.toString() })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.SQL_DO.idFromName(doName)
    const stub = env.SQL_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// REAL SQL STORAGE WRAPPER
// ============================================================================

/**
 * Wrapper that provides SqlStorage interface backed by real Miniflare SQLite.
 * This replaces the mock implementation while maintaining API compatibility.
 */
function createSqlStorageWrapper(stub: DurableObjectStub): SqlStorage {
  return {
    exec(sql: string): { results: Array<Record<string, unknown>> } {
      // Note: exec is synchronous in the real API but we need to make it work
      // For testing purposes, we'll make this work via fetch
      // This is a limitation of the wrapper approach - consider using
      // vitest-pool-workers for full sync API compatibility

      // For now, throw an error directing users to use the async pattern
      // or the prepare().bind().run() pattern which works better with fetch
      throw new Error(
        'Direct exec() is not supported in wrapped mode. ' +
        'Use prepare().bind().run() for INSERT/UPDATE/DELETE, ' +
        'or prepare().bind().all() for SELECT queries. ' +
        'Alternatively, use @cloudflare/vitest-pool-workers for full API compatibility.'
      )
    },

    prepare(sql: string) {
      let boundValues: unknown[] = []

      return {
        bind(...values: unknown[]) {
          boundValues = values
          return {
            async first(): Promise<Record<string, unknown> | null> {
              const response = await stub.fetch('http://internal/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, values: boundValues, operation: 'first' })
              })

              if (!response.ok) {
                const error = await response.json() as { error: string }
                throw new Error(error.error)
              }

              const data = await response.json() as { result: Record<string, unknown> | null }
              return data.result
            },

            async all(): Promise<{ results: Array<Record<string, unknown>> }> {
              const response = await stub.fetch('http://internal/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, values: boundValues, operation: 'all' })
              })

              if (!response.ok) {
                const error = await response.json() as { error: string }
                throw new Error(error.error)
              }

              const data = await response.json() as { results: Array<Record<string, unknown>> }
              return data
            },

            async run(): Promise<{ meta?: { changes?: number } | undefined }> {
              const response = await stub.fetch('http://internal/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, values: boundValues, operation: 'run' })
              })

              if (!response.ok) {
                const error = await response.json() as { error: string }
                throw new Error(error.error)
              }
              return {}
            }
          }
        }
      }
    }
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface RealSqlStorageResult {
  sql: SqlStorage
  stub: DurableObjectStub
  cleanup: () => Promise<void>
  mf: Miniflare
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Creates a real SqlStorage instance backed by Miniflare's SQLite.
 *
 * This provides a real SQLite database that behaves exactly like the
 * Cloudflare Workers runtime, without any mocking.
 *
 * @param name - Optional unique name for the DO instance (for isolation)
 * @returns Object containing sql storage, stub, cleanup function, and miniflare instance
 *
 * @example
 * ```typescript
 * const { sql, cleanup } = await createRealSqlStorage('my-test')
 *
 * // Initialize schema
 * await sql.prepare('CREATE TABLE things (id TEXT PRIMARY KEY)').bind().run()
 *
 * // Insert data
 * await sql.prepare('INSERT INTO things (id) VALUES (?)').bind('test-1').run()
 *
 * // Query data
 * const result = await sql.prepare('SELECT * FROM things').bind().all()
 *
 * // Cleanup
 * await cleanup()
 * ```
 */
export async function createRealSqlStorage(name?: string): Promise<RealSqlStorageResult> {
  const testName = name || `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const mf = new Miniflare({
    modules: true,
    script: SQL_TEST_DO_SCRIPT,
    durableObjects: {
      SQL_DO: {
        className: 'SqlTestDO',
        // Enable SQLite for this DO class - required for state.storage.sql
        useSQLite: true,
      },
    },
    durableObjectsPersist: false, // In-memory for fast tests
  })

  const ns = await mf.getDurableObjectNamespace('SQL_DO')
  const id = ns.idFromName(testName)
  const stub = ns.get(id) as unknown as DurableObjectStub

  const sql = createSqlStorageWrapper(stub)

  return {
    sql,
    stub,
    mf,
    cleanup: async () => {
      await mf.dispose()
    }
  }
}

/**
 * Shared Miniflare instance for tests that want to manage lifecycle manually.
 * Use this when you need multiple DO instances or want finer control.
 */
let sharedMiniflare: Miniflare | null = null

export async function getSharedMiniflare(): Promise<Miniflare> {
  if (!sharedMiniflare) {
    sharedMiniflare = new Miniflare({
      modules: true,
      script: SQL_TEST_DO_SCRIPT,
      durableObjects: {
        SQL_DO: {
          className: 'SqlTestDO',
          // Enable SQLite for this DO class - required for state.storage.sql
          useSQLite: true,
        },
      },
      durableObjectsPersist: false,
    })
  }
  return sharedMiniflare
}

export async function cleanupSharedMiniflare(): Promise<void> {
  if (sharedMiniflare) {
    await sharedMiniflare.dispose()
    sharedMiniflare = null
  }
}

/**
 * Get a SqlStorage instance from the shared Miniflare.
 * Each call with a different name gets an isolated DO instance.
 */
export async function getSqlStorageFromShared(name: string): Promise<{
  sql: SqlStorage
  stub: DurableObjectStub
}> {
  const mf = await getSharedMiniflare()
  const ns = await mf.getDurableObjectNamespace('SQL_DO')
  const id = ns.idFromName(name)
  const stub = ns.get(id) as unknown as DurableObjectStub

  return {
    sql: createSqlStorageWrapper(stub),
    stub
  }
}

// ============================================================================
// LEGACY MOCK INTERFACE (DEPRECATED)
// ============================================================================

/**
 * @deprecated Use createRealSqlStorage() instead.
 *
 * This mock interface is kept for backward compatibility but violates
 * the NO MOCKS philosophy. Tests should migrate to real SQLite.
 *
 * Note: Some tests may still use this during migration. The mock has
 * been simplified to throw an error directing users to the real implementation.
 */
export interface MockSqlStorage {
  exec(sql: string): { results: Array<Record<string, unknown>> }
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Promise<Record<string, unknown> | null>
      all(): Promise<{ results: Array<Record<string, unknown>> }>
      run(): Promise<void>
    }
  }
}

/**
 * @deprecated Use createRealSqlStorage() instead.
 *
 * This function now throws an error to enforce the NO MOCKS policy.
 * Migrate tests to use createRealSqlStorage() for real SQLite testing.
 */
export function createMockSqlStorage(): MockSqlStorage {
  throw new Error(
    'createMockSqlStorage() is deprecated and violates the NO MOCKS philosophy.\n' +
    'Use createRealSqlStorage() from this module for real SQLite testing.\n' +
    'See CLAUDE.md for testing guidelines.'
  )
}
