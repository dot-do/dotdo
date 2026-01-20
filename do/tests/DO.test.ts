import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO } from '../DO'

// Mock DurableObjectState
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('DO Class', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  describe('health check', () => {
    it('should respond to GET /', async () => {
      const request = new Request('https://do/')
      const response = await doInstance.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.status).toBe('ok')
      expect(json.id).toBe('test-do-id')
    })
  })

  describe('RPC endpoint', () => {
    it('should call DO methods via /rpc', async () => {
      // Add a test method to the DO
      (doInstance as any).greet = (name: string) => `Hello, ${name}!`

      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
      expect(await response.json()).toBe('Hello, World!')
    })

    it('should return 404 for unknown methods', async () => {
      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'unknown', args: [] })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(404)
    })

    it('should handle errors gracefully', async () => {
      (doInstance as any).throws = () => { throw new Error('Test error') }

      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'throws', args: [] })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(500)
      const json = await response.json()
      // Error is returned in serialized RPCError format with 'message' field
      expect(json.message).toContain('Test error')
    })

    it('should handle nested methods via dot notation', async () => {
      // Add a nested method structure
      (doInstance as any).math = {
        add: (a: number, b: number) => a + b
      }

      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'math.add', args: [2, 3] })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
      expect(await response.json()).toBe(5)
    })

    it('should handle async methods', async () => {
      (doInstance as any).asyncGreet = async (name: string) => {
        return `Hello, ${name}!`
      }

      const request = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'asyncGreet', args: ['Async'] })
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
      expect(await response.json()).toBe('Hello, Async!')
    })
  })

  describe('info endpoint', () => {
    it('should return storage info at /info', async () => {
      const request = new Request('https://do/info')
      const response = await doInstance.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.id).toBe('test-do-id')
      expect(typeof json.keys).toBe('number')
    })
  })

  describe('subclassing', () => {
    it('should allow subclasses to add routes', async () => {
      class CustomDO extends DO {
        protected routes(app: any) {
          app.get('/custom', (c: any) => c.json({ custom: true }))
        }
      }

      const custom = new CustomDO(mockState, {})
      const request = new Request('https://do/custom')
      const response = await custom.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ custom: true })
    })

    it('should still have base routes when subclassed', async () => {
      class CustomDO extends DO {
        protected routes(app: any) {
          app.get('/custom', (c: any) => c.json({ custom: true }))
        }
      }

      const custom = new CustomDO(mockState, {})

      // Check base health endpoint still works
      const request = new Request('https://do/')
      const response = await custom.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.status).toBe('ok')
    })
  })

  describe('CORS', () => {
    it('should include CORS headers by default', async () => {
      const request = new Request('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      })

      const response = await doInstance.fetch(request)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })

    it('should allow disabling CORS', async () => {
      const noCors = new DO(mockState, {}, { cors: false })

      const request = new Request('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      })

      const response = await noCors.fetch(request)
      // Without CORS middleware, OPTIONS will return 404 or no CORS headers
      const corsHeader = response.headers.get('Access-Control-Allow-Origin')
      expect(corsHeader).toBeNull()
    })
  })

  describe('lifecycle methods', () => {
    it('should have alarm method', () => {
      expect(typeof doInstance.alarm).toBe('function')
    })

    it('should have webSocketMessage method', () => {
      expect(typeof doInstance.webSocketMessage).toBe('function')
    })

    it('should have webSocketClose method', () => {
      expect(typeof doInstance.webSocketClose).toBe('function')
    })
  })
})
