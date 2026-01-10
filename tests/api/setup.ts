/**
 * Test Setup for API Discovery Tests
 *
 * This setup provides mock bindings for testing API routes in Node environment.
 * The tests verify API structure, response formats, and HATEOAS patterns
 * without requiring actual Cloudflare Workers runtime.
 */

import { vi, beforeEach, afterEach } from 'vitest'

// In-memory storage for test data
const inMemoryStorage = new Map<string, Map<string, unknown>>()

/**
 * Mock DurableObjectStorage
 */
function createMockStorage(storageKey: string) {
  if (!inMemoryStorage.has(storageKey)) {
    inMemoryStorage.set(storageKey, new Map())
  }
  const storage = inMemoryStorage.get(storageKey)!

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return storage.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      storage.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return storage.delete(key)
    },
    async deleteAll(): Promise<void> {
      storage.clear()
    },
    async list<T>(): Promise<Map<string, T>> {
      return storage as Map<string, T>
    },
  }
}

/**
 * Mock DurableObjectStub that handles fetch calls
 */
function createMockDOStub(namespace: string, instanceId: string) {
  const storageKey = `${namespace}:${instanceId}`
  const storage = createMockStorage(storageKey)

  // Store things in this structure
  const getThingsMap = async () => {
    const existing = await storage.get<Map<string, unknown>>('things')
    return existing || new Map()
  }

  return {
    id: {
      toString: () => instanceId,
      name: instanceId,
      equals: (other: unknown) => (other as { name: string })?.name === instanceId,
    },
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method

      // Handle things collection routes
      if (path === '/things' || path === '/things/') {
        if (method === 'GET') {
          const thingsMap = await getThingsMap()
          const things = Array.from(thingsMap.values())
          return new Response(JSON.stringify(things), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'POST') {
          const body = await request.json() as Record<string, unknown>
          const id = body.id as string || crypto.randomUUID()
          const now = new Date().toISOString()

          const thing = {
            id,
            $id: id,
            $type: body.$type || 'Thing',
            name: body.name,
            ...body,
            createdAt: now,
            updatedAt: now,
          }

          const thingsMap = await getThingsMap()
          if (thingsMap.has(id)) {
            return new Response(
              JSON.stringify({ error: { code: 'CONFLICT', message: 'Item already exists' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            )
          }

          thingsMap.set(id, thing)
          await storage.put('things', thingsMap)

          return new Response(JSON.stringify(thing), {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
              'Location': `/api/things/${id}`,
            },
          })
        }
      }

      // Handle single thing routes
      if (path.startsWith('/things/') && path.length > 8) {
        const thingId = decodeURIComponent(path.slice(8))
        const thingsMap = await getThingsMap()
        const thing = thingsMap.get(thingId) as Record<string, unknown> | undefined

        if (method === 'GET') {
          if (!thing) {
            return new Response(
              JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          return new Response(JSON.stringify(thing), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'PUT') {
          if (!thing) {
            return new Response(
              JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          const body = await request.json() as Record<string, unknown>
          const updated = {
            ...thing,
            ...body,
            $id: thing.$id, // Preserve $id
            $type: thing.$type, // Preserve $type
            updatedAt: new Date().toISOString(),
          }
          thingsMap.set(thingId, updated)
          await storage.put('things', thingsMap)
          return new Response(JSON.stringify(updated), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'PATCH') {
          if (!thing) {
            return new Response(
              JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          const body = await request.json() as Record<string, unknown>
          // Remove $id from body to prevent overwriting
          delete body.$id
          const updated = {
            ...thing,
            ...body,
            updatedAt: new Date().toISOString(),
          }
          thingsMap.set(thingId, updated)
          await storage.put('things', thingsMap)
          return new Response(JSON.stringify(updated), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'DELETE') {
          if (!thing) {
            return new Response(
              JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          thingsMap.delete(thingId)
          await storage.put('things', thingsMap)
          return new Response(null, { status: 204 })
        }
      }

      // Instance root - return info
      if (path === '/' || path === '') {
        return new Response(JSON.stringify({
          id: instanceId,
          ns: `${namespace}/${instanceId}`,
          class: namespace,
          status: 'active',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Health endpoint
      if (path === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          ns: `${namespace}/${instanceId}`,
          uptime: 0,
          storageUsed: 0,
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // State endpoints
      if (path === '/state' || path.startsWith('/state/')) {
        const stateKey = path === '/state' ? null : path.slice(7)

        if (method === 'GET') {
          const state = await storage.get<Record<string, unknown>>('_state') || {}
          if (stateKey) {
            return new Response(JSON.stringify({ value: state[stateKey] }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }
          return new Response(JSON.stringify(state), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'PUT') {
          try {
            const body = await request.json()
            await storage.put('_state', body)
            return new Response(JSON.stringify(body), {
              headers: { 'Content-Type': 'application/json' },
            })
          } catch (err) {
            return new Response(
              JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }
        }

        if (method === 'PATCH') {
          const state = await storage.get<Record<string, unknown>>('_state') || {}
          const body = await request.json() as Record<string, unknown>
          const merged = { ...state, ...body }
          await storage.put('_state', merged)
          return new Response(JSON.stringify(merged), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'DELETE') {
          if (stateKey) {
            const state = await storage.get<Record<string, unknown>>('_state') || {}
            delete state[stateKey]
            await storage.put('_state', state)
          } else {
            await storage.put('_state', {})
          }
          return new Response(null, { status: 204 })
        }
      }

      // Metadata endpoint
      if (path === '/meta') {
        return new Response(JSON.stringify({
          id: instanceId,
          class: namespace,
          status: 'active',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // RPC endpoints
      if (path.startsWith('/rpc/')) {
        const methodName = path.slice(5)

        // Private methods not allowed
        if (methodName.startsWith('_')) {
          return new Response(
            JSON.stringify({ error: { code: 'METHOD_NOT_FOUND', message: `Method ${methodName} not found` } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Mock methods
        if (methodName === 'ping') {
          return new Response(JSON.stringify({ result: 'pong' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (methodName === 'echo') {
          const body = await request.json() as { args?: unknown[] }
          return new Response(JSON.stringify({ result: body.args }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (methodName === 'add') {
          const body = await request.json() as { args?: [number, number] }
          const [a, b] = body.args || [0, 0]
          return new Response(JSON.stringify({ result: a + b }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (methodName === 'throwError') {
          return new Response(
            JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Mock error' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Unknown method
        return new Response(
          JSON.stringify({ error: { code: 'METHOD_NOT_FOUND', message: `Method ${methodName} not found` } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Events endpoint
      if (path === '/events') {
        if (method === 'GET') {
          return new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'POST') {
          const body = await request.json() as { verb: string; data?: unknown }
          return new Response(JSON.stringify({
            id: crypto.randomUUID(),
            verb: body.verb,
            data: body.data,
            timestamp: new Date().toISOString(),
          }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      // Actions endpoint
      if (path === '/actions') {
        if (method === 'GET') {
          return new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'POST') {
          const body = await request.json() as { verb: string; input?: unknown }
          return new Response(JSON.stringify({
            id: crypto.randomUUID(),
            verb: body.verb,
            status: 'pending',
          }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      // Resolve endpoint
      if (path === '/resolve') {
        const queryPath = url.searchParams.get('path')
        if (!queryPath) {
          return new Response(
            JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'path parameter is required' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        }
        // Mock resolve - return 404 for non-existent
        return new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Default 404
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `Not found: ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    },
  }
}

/**
 * Mock DurableObjectNamespace
 */
function createMockDONamespace(name: string) {
  return {
    idFromName(instanceId: string) {
      return {
        toString: () => instanceId,
        name: instanceId,
        equals: (other: unknown) => (other as { name: string })?.name === instanceId,
      }
    },
    idFromString(id: string) {
      return this.idFromName(id)
    },
    newUniqueId() {
      return this.idFromName(crypto.randomUUID())
    },
    get(id: { name?: string; toString: () => string }) {
      return createMockDOStub(name, id.name || id.toString())
    },
  }
}

/**
 * Mock KV namespace
 */
function createMockKVNamespace() {
  const kvStorage = new Map<string, string>()

  return {
    async get(key: string): Promise<string | null> {
      return kvStorage.get(key) || null
    },
    async put(key: string, value: string): Promise<void> {
      kvStorage.set(key, value)
    },
    async delete(key: string): Promise<void> {
      kvStorage.delete(key)
    },
    async list(): Promise<{ keys: { name: string }[] }> {
      return { keys: Array.from(kvStorage.keys()).map(name => ({ name })) }
    },
  }
}

/**
 * Mock Fetcher (for ASSETS)
 */
function createMockFetcher() {
  return {
    async fetch(): Promise<Response> {
      return new Response('Mock asset', { status: 200 })
    },
  }
}

// Create mock bindings
export const mockEnv = {
  DO: createMockDONamespace('DO'),
  TEST_DO: createMockDONamespace('TEST_DO'),
  BROWSER_DO: createMockDONamespace('BROWSER_DO'),
  SANDBOX_DO: createMockDONamespace('SANDBOX_DO'),
  OBS_BROADCASTER: createMockDONamespace('OBS_BROADCASTER'),
  KV: createMockKVNamespace(),
  TEST_KV: createMockKVNamespace(),
  ASSETS: createMockFetcher(),
}

// Clear storage before each test
beforeEach(() => {
  inMemoryStorage.clear()
})

afterEach(() => {
  inMemoryStorage.clear()
})

/**
 * Helper to create app with mock bindings for testing
 * Use this to wrap app.request calls with the mock env
 */
export async function createTestApp() {
  // Dynamically import the app to avoid circular dependencies
  const { app } = await import('../../api/index')

  return {
    request: async (path: string | Request, options?: RequestInit) => {
      return app.request(path, options, mockEnv)
    },
  }
}

export default mockEnv
