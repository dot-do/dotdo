/**
 * Test Worker for DuckDB WASM Verification
 *
 * This worker tests that our custom DuckDB WASM build works correctly
 * in the Cloudflare Workers runtime. It:
 * 1. Loads DuckDB WASM via direct import
 * 2. Creates a DuckDB instance
 * 3. Executes a simple query
 * 4. Returns the result as JSON
 */

import { createDuckDB, clearCache, type DuckDBInstance } from './index.js'
// Import WASM as compiled module (ES module style)
import duckdbWasm from '../wasm/duckdb-worker.wasm'

// Cache the DuckDB instance across requests for better performance
let cachedDb: DuckDBInstance | null = null

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const startTime = performance.now()

    try {
      // Route handling
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', timestamp: Date.now() })
      }

      if (url.pathname === '/clear-cache') {
        if (cachedDb) {
          await cachedDb.close()
          cachedDb = null
        }
        clearCache()
        return Response.json({ status: 'cache_cleared' })
      }

      // Main test endpoint
      if (url.pathname === '/' || url.pathname === '/test') {
        const initStart = performance.now()

        // Create or reuse DuckDB instance
        if (!cachedDb || !cachedDb.isOpen()) {
          cachedDb = await createDuckDB({}, { wasmModule: duckdbWasm })
        }

        const initTime = performance.now() - initStart

        // Execute the test query
        const queryStart = performance.now()
        const result = await cachedDb.query<{ answer: number }>('SELECT 1 + 1 as answer')
        const queryTime = performance.now() - queryStart

        const totalTime = performance.now() - startTime

        return Response.json({
          success: true,
          result: {
            answer: result.rows[0]?.answer,
            columns: result.columns,
            rowCount: result.rowCount,
          },
          timing: {
            initializationMs: Math.round(initTime * 100) / 100,
            queryMs: Math.round(queryTime * 100) / 100,
            totalMs: Math.round(totalTime * 100) / 100,
          },
          metadata: {
            wasmModuleLoaded: duckdbWasm !== undefined,
            dbInstanceCached: cachedDb !== null,
          },
        })
      }

      // Custom query endpoint
      if (url.pathname === '/query') {
        const sql = url.searchParams.get('sql')
        if (!sql) {
          return Response.json({ error: 'Missing sql parameter' }, { status: 400 })
        }

        // Create or reuse DuckDB instance
        if (!cachedDb || !cachedDb.isOpen()) {
          cachedDb = await createDuckDB({}, { wasmModule: duckdbWasm })
        }

        const queryStart = performance.now()
        const result = await cachedDb.query(sql)
        const queryTime = performance.now() - queryStart

        return Response.json({
          success: true,
          result: {
            rows: result.rows,
            columns: result.columns,
            rowCount: result.rowCount,
          },
          timing: {
            queryMs: Math.round(queryTime * 100) / 100,
            totalMs: Math.round((performance.now() - startTime) * 100) / 100,
          },
        })
      }

      return Response.json({ error: 'Not found', path: url.pathname }, { status: 404 })
    } catch (error) {
      const totalTime = performance.now() - startTime

      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timing: {
            totalMs: Math.round(totalTime * 100) / 100,
          },
        },
        { status: 500 }
      )
    }
  },
}
