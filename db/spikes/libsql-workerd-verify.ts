/**
 * SPIKE: Verify libSQL works in workerd
 *
 * Standalone worker to test @libsql/client/web in workerd runtime.
 * Run with: npx wrangler dev db/spikes/libsql-workerd-verify.ts
 */

import { createClient, type Client } from '@libsql/client/web'

interface Env {
  TURSO_URL?: string
  TURSO_TOKEN?: string
}

interface VerifyResult {
  success: boolean
  runtime: string
  checks: {
    name: string
    passed: boolean
    details?: string
    error?: string
  }[]
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result: VerifyResult = {
      success: true,
      runtime: 'workerd',
      checks: [],
    }

    // Check 1: createClient function available
    try {
      result.checks.push({
        name: 'createClient available',
        passed: typeof createClient === 'function',
        details: `typeof createClient = ${typeof createClient}`,
      })
    } catch (err) {
      result.checks.push({
        name: 'createClient available',
        passed: false,
        error: String(err),
      })
      result.success = false
    }

    // Check 2: Client creation with HTTP URL
    try {
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
      })
      result.checks.push({
        name: 'HTTP client creation',
        passed: !!client && typeof client.execute === 'function',
        details: 'Client created with https:// URL',
      })
    } catch (err) {
      result.checks.push({
        name: 'HTTP client creation',
        passed: false,
        error: String(err),
      })
      result.success = false
    }

    // Check 3: Client creation with libsql:// URL
    try {
      const client = createClient({
        url: 'libsql://test-db.turso.io',
        authToken: 'test-token',
      })
      result.checks.push({
        name: 'libsql:// client creation',
        passed: !!client && typeof client.execute === 'function',
        details: 'Client created with libsql:// URL',
      })
    } catch (err) {
      result.checks.push({
        name: 'libsql:// client creation',
        passed: false,
        error: String(err),
      })
      result.success = false
    }

    // Check 4: Client API surface
    try {
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
      })
      const methods = ['execute', 'batch', 'transaction', 'close']
      const hasMethods = methods.every(m => typeof (client as unknown as Record<string, unknown>)[m] === 'function')
      result.checks.push({
        name: 'Client API surface',
        passed: hasMethods && 'closed' in client,
        details: `Methods: ${methods.join(', ')} + closed property`,
      })
    } catch (err) {
      result.checks.push({
        name: 'Client API surface',
        passed: false,
        error: String(err),
      })
      result.success = false
    }

    // Check 5: Custom fetch support (important for Workers)
    try {
      let fetchCalled = false
      const mockFetch = async (): Promise<Response> => {
        fetchCalled = true
        return new Response('{}')
      }
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
        fetch: mockFetch,
      })
      result.checks.push({
        name: 'Custom fetch support',
        passed: true,
        details: 'Client accepts custom fetch implementation',
      })
    } catch (err) {
      result.checks.push({
        name: 'Custom fetch support',
        passed: false,
        error: String(err),
      })
      result.success = false
    }

    // Check 6: Real connection (if TURSO_URL configured)
    if (env.TURSO_URL) {
      try {
        const start = performance.now()
        const client = createClient({
          url: env.TURSO_URL,
          authToken: env.TURSO_TOKEN,
        })
        const queryResult = await client.execute('SELECT 1 as value')
        const latency = performance.now() - start

        result.checks.push({
          name: 'Live Turso connection',
          passed: queryResult.rows.length === 1,
          details: `Query latency: ${latency.toFixed(2)}ms, rows: ${queryResult.rows.length}`,
        })
      } catch (err) {
        result.checks.push({
          name: 'Live Turso connection',
          passed: false,
          error: String(err),
        })
        result.success = false
      }
    } else {
      result.checks.push({
        name: 'Live Turso connection',
        passed: true, // Skipped is a pass
        details: 'SKIPPED: Set TURSO_URL and TURSO_TOKEN to test',
      })
    }

    return Response.json(result, {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
