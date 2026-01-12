/**
 * SPIKE: libSQL/Turso in workerd V8 isolates
 *
 * This test verifies that @libsql/client/web works in the actual
 * Cloudflare Workers runtime (miniflare / vitest-pool-workers).
 *
 * Run with: npx vitest run --project=workers-integration db/spikes/libsql-workerd.test.ts
 */

import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

describe('libSQL in workerd runtime', () => {
  it('should verify workerd environment', () => {
    // Verify we're running in the Workers runtime
    expect(typeof globalThis.Response).toBe('function')
    expect(typeof globalThis.fetch).toBe('function')
    expect(typeof globalThis.Request).toBe('function')
  })

  it('should import @libsql/client/web dynamically', async () => {
    // Dynamic import to test runtime loading in workerd
    const { createClient } = await import('@libsql/client/web')
    expect(typeof createClient).toBe('function')
  })

  it('should create client without network calls', async () => {
    const { createClient } = await import('@libsql/client/web')

    const client = createClient({
      url: 'https://test-db.turso.io',
      authToken: 'test-token',
    })

    expect(client).toBeDefined()
    expect(typeof client.execute).toBe('function')
    expect(typeof client.batch).toBe('function')
    expect(typeof client.transaction).toBe('function')
    expect(client.closed).toBe(false)
  })

  it('should accept custom fetch implementation', async () => {
    const { createClient } = await import('@libsql/client/web')

    // Workers-compatible fetch mock
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return new Response(JSON.stringify({ result: 'mocked' }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    const client = createClient({
      url: 'https://test-db.turso.io',
      authToken: 'test-token',
      fetch: mockFetch,
    })

    expect(client).toBeDefined()
  })

  it('should handle protocol detection correctly', async () => {
    const { createClient } = await import('@libsql/client/web')

    // HTTP/HTTPS protocol (uses fetch)
    const httpClient = createClient({
      url: 'https://test-db.turso.io',
      authToken: 'test-token',
    })
    expect(httpClient).toBeDefined()

    // libsql:// protocol (uses WebSocket / Hrana)
    const libsqlClient = createClient({
      url: 'libsql://test-db.turso.io',
      authToken: 'test-token',
    })
    expect(libsqlClient).toBeDefined()
  })
})
