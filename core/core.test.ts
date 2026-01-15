import { describe, it, expect, beforeEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'

/**
 * DOCore Test Suite - TDD RED Phase
 *
 * These tests define the expected API for DOCore, the minimal (~5KB) Durable Object
 * foundation for dotdo v2. Tests are written to FAIL until implementation exists.
 *
 * DOCore provides:
 * 1. State management (get/set/delete/list) via RPC
 * 2. Alarm scheduling (setAlarm/deleteAlarm/getAlarm) via RPC
 * 3. Fetch routing (method/path matching)
 * 4. Lifecycle hooks (onStart/onHibernate/onWake)
 * 5. Hono integration (route registration, middleware)
 *
 * Tests use the fetch API and RPC pattern to validate behavior.
 */

// Helper to get a fresh DOCore instance
function getCore(name = 'test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

/**
 * Create a valid JWT token for testing
 * This creates a properly formatted JWT with the structure our middleware expects
 */
function createTestJwt(options: { sub?: string; permissions?: string[] } = {}): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: options.sub ?? 'test-user',
    iat: now,
    exp: now + 3600, // 1 hour from now
    permissions: options.permissions ?? [],
  }

  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '')
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '')
  // For testing purposes, we don't need a valid signature since our middleware
  // only decodes the payload (signature verification would require the secret)
  const signature = 'test-signature'

  return `${base64Header}.${base64Payload}.${signature}`
}

// =============================================================================
// 1. STATE MANAGEMENT (via RPC)
// =============================================================================

describe('State Management', () => {
  describe('get/set/delete operations via RPC', () => {
    it('should set and get a string value', async () => {
      const core = getCore('state-test-1')

      // Set a value via RPC
      const setResult = await core.set('key1', 'value1')
      expect(setResult).toBe(true)

      // Get the value back via RPC
      const result = await core.get('key1')
      expect(result).toBe('value1')
    })

    it('should set and get an object value', async () => {
      const core = getCore('state-test-2')

      const data = { name: 'Alice', age: 30, tags: ['admin', 'user'] }
      await core.set('user:123', data)

      const result = await core.get('user:123')
      expect(result).toEqual(data)
    })

    it('should return undefined for non-existent keys', async () => {
      const core = getCore('state-test-3')

      const result = await core.get('non-existent')
      expect(result).toBeUndefined()
    })

    it('should delete a value', async () => {
      const core = getCore('state-test-4')

      await core.set('to-delete', 'value')
      expect(await core.get('to-delete')).toBe('value')

      await core.delete('to-delete')
      expect(await core.get('to-delete')).toBeUndefined()
    })

    it('should handle batch set operations', async () => {
      const core = getCore('state-test-5')

      await core.setMany({
        'batch:1': 'value1',
        'batch:2': 'value2',
        'batch:3': { nested: true },
      })

      expect(await core.get('batch:1')).toBe('value1')
      expect(await core.get('batch:2')).toBe('value2')
      expect(await core.get('batch:3')).toEqual({ nested: true })
    })

    it('should handle batch delete operations', async () => {
      const core = getCore('state-test-6')

      await core.setMany({
        'del:1': 'v1',
        'del:2': 'v2',
        'del:3': 'v3',
      })

      await core.deleteMany(['del:1', 'del:2'])

      expect(await core.get('del:1')).toBeUndefined()
      expect(await core.get('del:2')).toBeUndefined()
      expect(await core.get('del:3')).toBe('v3')
    })

    it('should overwrite existing values', async () => {
      const core = getCore('state-test-7')

      await core.set('overwrite', 'original')
      await core.set('overwrite', 'updated')

      expect(await core.get('overwrite')).toBe('updated')
    })

    it('should handle null values distinctly from undefined', async () => {
      const core = getCore('state-test-8')

      await core.set('null-key', null)
      const result = await core.get('null-key')

      expect(result).toBeNull()
    })
  })

  describe('list operations via RPC', () => {
    it('should list all keys', async () => {
      const core = getCore('list-test-1')

      await core.setMany({
        'list:a': 1,
        'list:b': 2,
        'list:c': 3,
      })

      const entries = await core.list()

      expect(entries['list:a']).toBe(1)
      expect(entries['list:b']).toBe(2)
      expect(entries['list:c']).toBe(3)
    })

    it('should list keys with prefix filter', async () => {
      const core = getCore('list-test-2')

      await core.setMany({
        'user:1': { name: 'Alice' },
        'user:2': { name: 'Bob' },
        'order:1': { total: 100 },
        'order:2': { total: 200 },
      })

      const userEntries = await core.list({ prefix: 'user:' })
      const keys = Object.keys(userEntries)

      expect(keys).toHaveLength(2)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
      expect(keys).not.toContain('order:1')
    })

    it('should list keys with start/end range', async () => {
      const core = getCore('list-test-3')

      await core.setMany({
        'a': 1,
        'b': 2,
        'c': 3,
        'd': 4,
        'e': 5,
      })

      const entries = await core.list({ start: 'b', end: 'd' })
      const keys = Object.keys(entries)

      expect(keys).toContain('b')
      expect(keys).toContain('c')
      expect(keys).not.toContain('a')
      expect(keys).not.toContain('d') // end is exclusive
      expect(keys).not.toContain('e')
    })

    it('should list keys with limit', async () => {
      const core = getCore('list-test-4')

      await core.setMany({
        'limit:1': 1,
        'limit:2': 2,
        'limit:3': 3,
        'limit:4': 4,
        'limit:5': 5,
      })

      const entries = await core.list({ prefix: 'limit:', limit: 2 })
      const keys = Object.keys(entries)

      expect(keys).toHaveLength(2)
    })

    it('should return empty object for no matches', async () => {
      const core = getCore('list-test-5')

      const entries = await core.list({ prefix: 'nonexistent:' })
      expect(Object.keys(entries)).toHaveLength(0)
    })

    it('should list in reverse order', async () => {
      const core = getCore('list-test-6')

      await core.setMany({
        'sort:a': 1,
        'sort:b': 2,
        'sort:c': 3,
      })

      const entries = await core.list({ prefix: 'sort:', reverse: true })
      const keys = Object.keys(entries)

      expect(keys[0]).toBe('sort:c')
      expect(keys[keys.length - 1]).toBe('sort:a')
    })
  })
})

// =============================================================================
// 2. ALARM SCHEDULING (via RPC)
// =============================================================================

describe('Alarm Scheduling', () => {
  it('should set an alarm with Date', async () => {
    const core = getCore('alarm-test-1')

    const alarmTime = new Date(Date.now() + 60000) // 1 minute from now
    await core.setAlarm(alarmTime)

    const scheduledAlarm = await core.getAlarm()
    expect(scheduledAlarm).toBeInstanceOf(Date)
    expect(new Date(scheduledAlarm).getTime()).toBe(alarmTime.getTime())
  })

  it('should set an alarm with timestamp number', async () => {
    const core = getCore('alarm-test-2')

    const alarmTime = Date.now() + 120000 // 2 minutes from now
    await core.setAlarm(alarmTime)

    const scheduledAlarm = await core.getAlarm()
    expect(new Date(scheduledAlarm).getTime()).toBe(alarmTime)
  })

  it('should return null when no alarm is set', async () => {
    const core = getCore('alarm-test-3')

    const alarm = await core.getAlarm()
    expect(alarm).toBeNull()
  })

  it('should delete an existing alarm', async () => {
    const core = getCore('alarm-test-4')

    await core.setAlarm(Date.now() + 60000)
    expect(await core.getAlarm()).not.toBeNull()

    await core.deleteAlarm()
    expect(await core.getAlarm()).toBeNull()
  })

  it('should overwrite existing alarm when setting new one', async () => {
    const core = getCore('alarm-test-5')

    const firstAlarm = Date.now() + 60000
    const secondAlarm = Date.now() + 120000

    await core.setAlarm(firstAlarm)
    await core.setAlarm(secondAlarm)

    const alarm = await core.getAlarm()
    expect(new Date(alarm).getTime()).toBe(secondAlarm)
  })

  it('should track alarm trigger in state', async () => {
    const core = getCore('alarm-test-6')

    // Set up alarm handler tracking
    await core.set('_alarm_triggered', false)

    // Set alarm (implementation should call alarm() which sets the flag)
    await core.setAlarm(Date.now())

    // Wait a bit for alarm to fire (miniflare handles immediately)
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify via RPC that alarm was triggered
    const triggered = await core.get('_alarm_triggered')
    expect(triggered).toBe(true)
  })
})

// =============================================================================
// 3. FETCH ROUTING
// =============================================================================

describe('Fetch Routing', () => {
  describe('Method matching', () => {
    it('should handle GET requests', async () => {
      const core = getCore('fetch-test-1')

      const response = await core.fetch('https://test.local/api/items')
      expect(response.status).not.toBe(501) // Should not be "not implemented"
    })

    it('should handle POST requests', async () => {
      const core = getCore('fetch-test-2')

      const response = await core.fetch('https://test.local/api/items', {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBeLessThan(500)
    })

    it('should handle PUT requests', async () => {
      const core = getCore('fetch-test-3')

      const response = await core.fetch('https://test.local/api/items/123', {
        method: 'PUT',
        body: JSON.stringify({ name: 'updated' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBeLessThan(500)
    })

    it('should handle DELETE requests', async () => {
      const core = getCore('fetch-test-4')

      const response = await core.fetch('https://test.local/api/items/123', {
        method: 'DELETE',
      })

      expect(response.status).toBeLessThan(500)
    })

    it('should handle PATCH requests', async () => {
      const core = getCore('fetch-test-5')

      const response = await core.fetch('https://test.local/api/items/123', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'patched' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBeLessThan(500)
    })
  })

  describe('Path matching with params', () => {
    it('should match exact paths', async () => {
      const core = getCore('path-test-1')

      const response = await core.fetch('https://test.local/health')
      const data = await response.json()

      expect(data.path).toBe('/health')
    })

    it('should extract path parameters', async () => {
      const core = getCore('path-test-2')

      // Route should be defined as /users/:id
      const response = await core.fetch('https://test.local/users/456')
      const data = await response.json()

      expect(data.params?.id).toBe('456')
    })

    it('should handle multiple path parameters', async () => {
      const core = getCore('path-test-3')

      // Route: /users/:userId/posts/:postId
      const response = await core.fetch('https://test.local/users/123/posts/789')
      const data = await response.json()

      expect(data.params?.userId).toBe('123')
      expect(data.params?.postId).toBe('789')
    })

    it('should handle wildcard routes', async () => {
      const core = getCore('path-test-4')

      // Route: /files/*
      const response = await core.fetch('https://test.local/files/path/to/file.txt')
      const data = await response.json()

      expect(data.wildcard).toBe('path/to/file.txt')
    })

    it('should handle query parameters', async () => {
      const core = getCore('path-test-5')

      const response = await core.fetch('https://test.local/search?q=hello&limit=10')
      const data = await response.json()

      expect(data.query?.q).toBe('hello')
      expect(data.query?.limit).toBe('10')
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unmatched routes', async () => {
      const core = getCore('404-test-1')

      const response = await core.fetch('https://test.local/this/route/does/not/exist')

      expect(response.status).toBe(404)
    })

    it('should return JSON error for 404', async () => {
      const core = getCore('404-test-2')

      const response = await core.fetch('https://test.local/unknown')
      const data = await response.json()

      expect(data.error).toBeDefined()
      expect(data.error).toContain('Not Found')
    })

    it('should return 405 for wrong method on existing route', async () => {
      const core = getCore('405-test')

      // Assuming /health only accepts GET
      const response = await core.fetch('https://test.local/health', {
        method: 'DELETE',
      })

      expect(response.status).toBe(405)
    })
  })
})

// =============================================================================
// 4. LIFECYCLE HOOKS (via RPC inspection)
// =============================================================================

describe('Lifecycle Hooks', () => {
  describe('onStart (cold start)', () => {
    it('should call onStart on first access', async () => {
      const core = getCore('lifecycle-start-1')

      // Access the DO - should trigger onStart
      await core.fetch('https://test.local/health')

      // Verify onStart was called by checking state via RPC
      const startCalled = await core.get('_lifecycle:onStart')
      expect(startCalled).toBe(true)
    })

    it('should only call onStart once per instance', async () => {
      const core = getCore('lifecycle-start-2')

      // Multiple accesses
      await core.fetch('https://test.local/health')
      await core.fetch('https://test.local/health')
      await core.fetch('https://test.local/health')

      // Count should be 1
      const startCount = await core.get('_lifecycle:onStartCount')
      expect(startCount).toBe(1)
    })

    it('should have access to state in onStart', async () => {
      const core = getCore('lifecycle-start-3')

      // onStart should be able to initialize default state
      await core.fetch('https://test.local/health')

      const initialized = await core.get('_initialized')
      expect(initialized).toBe(true)
    })

    it('should complete onStart before handling requests', async () => {
      const core = getCore('lifecycle-start-4')

      const response = await core.fetch('https://test.local/ready')
      const data = await response.json()

      // onStart should have completed, setting ready state
      expect(data.ready).toBe(true)
    })
  })

  describe('onHibernate (before eviction)', () => {
    it('should call onHibernate when preparing for hibernation', async () => {
      const core = getCore('lifecycle-hibernate-1')

      // Access DO
      await core.fetch('https://test.local/health')

      // Signal DO to prepare for hibernation via RPC
      await core.prepareHibernate()

      const hibernateCalled = await core.get('_lifecycle:onHibernate')
      expect(hibernateCalled).toBe(true)
    })

    it('should allow cleanup in onHibernate', async () => {
      const core = getCore('lifecycle-hibernate-2')

      // Set some temporary state
      await core.set('temp:session', { active: true })
      await core.fetch('https://test.local/health')

      // Prepare for hibernation - should clean up temp state
      await core.prepareHibernate()

      // Temp state should be cleared
      const temp = await core.get('temp:session')
      expect(temp).toBeUndefined()
    })

    it('should persist important state before hibernation', async () => {
      const core = getCore('lifecycle-hibernate-3')

      await core.set('important:data', { value: 42 })
      await core.fetch('https://test.local/health')

      await core.prepareHibernate()

      // Important state should still exist
      const important = await core.get('important:data')
      expect(important).toEqual({ value: 42 })
    })
  })

  describe('onWake (after hibernate)', () => {
    it('should call onWake after waking from hibernation', async () => {
      const core = getCore('lifecycle-wake-1')

      // First access
      await core.fetch('https://test.local/health')
      await core.prepareHibernate()

      // Simulate wake via RPC
      await core.wake()

      const wakeCalled = await core.get('_lifecycle:onWake')
      expect(wakeCalled).toBe(true)
    })

    it('should restore connections in onWake', async () => {
      const core = getCore('lifecycle-wake-2')

      await core.fetch('https://test.local/health')
      await core.prepareHibernate()
      await core.wake()

      const connectionRestored = await core.get('_connections:restored')
      expect(connectionRestored).toBe(true)
    })

    it('should track wake count', async () => {
      const core = getCore('lifecycle-wake-3')

      await core.fetch('https://test.local/health')

      // Multiple hibernate/wake cycles
      await core.prepareHibernate()
      await core.wake()
      await core.prepareHibernate()
      await core.wake()

      const wakeCount = await core.get('_lifecycle:wakeCount')
      expect(wakeCount).toBe(2)
    })
  })
})

// =============================================================================
// 5. BASIC HONO INTEGRATION
// =============================================================================

describe('Hono Integration', () => {
  describe('Route registration', () => {
    it('should register GET routes', async () => {
      const core = getCore('hono-test-1')

      // Routes should be registered in DOCore constructor
      const response = await core.fetch('https://test.local/api/status')
      expect(response.ok).toBe(true)
    })

    it('should register POST routes with body parsing', async () => {
      const core = getCore('hono-test-2')

      const response = await core.fetch('https://test.local/api/echo', {
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      expect(data.message).toBe('hello')
    })

    it('should support route chaining', async () => {
      const core = getCore('hono-test-3')

      // Routes defined with .get().post().put() chaining
      const getRes = await core.fetch('https://test.local/api/resource')
      const postRes = await core.fetch('https://test.local/api/resource', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(getRes.ok).toBe(true)
      expect(postRes.ok).toBe(true)
    })

    it('should support route groups', async () => {
      const core = getCore('hono-test-4')

      // Routes under /admin/* group now require admin authentication
      const adminToken = createTestJwt({
        sub: 'admin-user',
        permissions: ['admin:users:read'],
      })

      const response = await core.fetch('https://test.local/admin/users', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(response.ok).toBe(true)
    })
  })

  describe('Middleware support', () => {
    it('should execute global middleware', async () => {
      const core = getCore('middleware-test-1')

      const response = await core.fetch('https://test.local/api/status')

      // Global middleware should add X-DO-Version header
      expect(response.headers.get('X-DO-Version')).toBeDefined()
    })

    it('should execute route-specific middleware', async () => {
      const core = getCore('middleware-test-2')

      // Use a properly formatted JWT token
      const token = createTestJwt({ sub: 'test-user', permissions: ['read'] })

      const response = await core.fetch('https://test.local/protected/data', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.ok).toBe(true)
    })

    it('should reject unauthorized requests with auth middleware', async () => {
      const core = getCore('middleware-test-3')

      const response = await core.fetch('https://test.local/protected/data')

      expect(response.status).toBe(401)
    })

    it('should pass context through middleware chain', async () => {
      const core = getCore('middleware-test-4')

      const response = await core.fetch('https://test.local/api/context-check')
      const data = await response.json()

      // Middleware should set context values
      expect(data.middlewareExecuted).toBe(true)
      expect(data.requestId).toBeDefined()
    })

    it('should support error handling middleware', async () => {
      const core = getCore('middleware-test-5')

      const response = await core.fetch('https://test.local/api/error-trigger')

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBeDefined()
      expect(data.stack).toBeUndefined() // Should not leak stack in production
    })

    it('should support CORS middleware', async () => {
      const core = getCore('middleware-test-6')

      const response = await core.fetch('https://test.local/api/status', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined()
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined()
    })
  })

  describe('Context and bindings', () => {
    it('should provide Hono context with DO state', async () => {
      const core = getCore('context-test-1')

      await core.set('ctx:value', 'from-state')

      // The /api/state-read endpoint now requires authentication
      const token = createTestJwt({ sub: 'test-user', permissions: ['state:read'] })

      const response = await core.fetch('https://test.local/api/state-read', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      expect(data.value).toBe('from-state')
    })

    it('should provide env bindings in context', async () => {
      const core = getCore('context-test-2')

      const response = await core.fetch('https://test.local/api/bindings-check')
      const data = await response.json()

      expect(data.hasBindings).toBe(true)
    })

    it('should support c.json() helper', async () => {
      const core = getCore('context-test-3')

      const response = await core.fetch('https://test.local/api/json-response')

      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should support c.text() helper', async () => {
      const core = getCore('context-test-4')

      const response = await core.fetch('https://test.local/api/text-response')

      expect(response.headers.get('Content-Type')).toContain('text/plain')
    })

    it('should support c.html() helper', async () => {
      const core = getCore('context-test-5')

      const response = await core.fetch('https://test.local/api/html-response')

      expect(response.headers.get('Content-Type')).toContain('text/html')
    })
  })
})

// =============================================================================
// 6. RPC SUPPORT (validates RPC binding pattern)
// =============================================================================

describe('RPC Support', () => {
  it('should expose RPC methods on stub', async () => {
    const core = getCore('rpc-test-1')

    // RPC methods should be callable directly on the stub
    const result = await core.ping()
    expect(result).toBe('pong')
  })

  it('should support RPC with arguments', async () => {
    const core = getCore('rpc-test-2')

    const result = await core.add(2, 3)
    expect(result).toBe(5)
  })

  it('should support async RPC methods', async () => {
    const core = getCore('rpc-test-3')

    const result = await core.asyncOperation('test')
    expect(result.status).toBe('complete')
    expect(result.input).toBe('test')
  })

  it('should handle RPC errors gracefully', async () => {
    const core = getCore('rpc-test-4')

    await expect(core.throwError()).rejects.toThrow()
  })
})

// =============================================================================
// 7. SQLITE INTEGRATION (validates SQLite-backed state)
// =============================================================================

describe('SQLite Integration', () => {
  it('should persist state across simulated restarts', async () => {
    const coreBefore = getCore('sqlite-test-1')
    await coreBefore.set('persist:key', 'persist:value')

    // Get new reference (simulates restart)
    const coreAfter = getCore('sqlite-test-1')
    const value = await coreAfter.get('persist:key')

    expect(value).toBe('persist:value')
  })

  it('should support transactional writes', async () => {
    const core = getCore('sqlite-test-2')

    const result = await core.transaction([
      { op: 'set', key: 'tx:1', value: 'value1' },
      { op: 'set', key: 'tx:2', value: 'value2' },
    ])

    expect(result.success).toBe(true)
    expect(await core.get('tx:1')).toBe('value1')
    expect(await core.get('tx:2')).toBe('value2')
  })

  it('should rollback on transaction error', async () => {
    const core = getCore('sqlite-test-3')

    await core.set('rollback:key', 'original')

    const result = await core.transaction([
      { op: 'set', key: 'rollback:key', value: 'changed' },
      { op: 'error' }, // This should cause rollback
    ])

    expect(result.success).toBe(false)
    expect(await core.get('rollback:key')).toBe('original')
  })

  it('should expose raw SQL for advanced queries', async () => {
    const core = getCore('sqlite-test-4')

    await core.setMany({
      'sql:user:1': { name: 'Alice', age: 30 },
      'sql:user:2': { name: 'Bob', age: 25 },
      'sql:user:3': { name: 'Charlie', age: 35 },
    })

    // Raw SQL query via RPC
    const results = await core.query(
      'SELECT * FROM state WHERE key LIKE ? ORDER BY key',
      ['sql:user:%']
    )

    expect(results.length).toBe(3)
  })
})

// =============================================================================
// 8. WEBSOCKET SUPPORT
// =============================================================================

describe('WebSocket Support', () => {
  it('should accept WebSocket upgrade requests', async () => {
    const core = getCore('ws-test-1')

    const response = await core.fetch('https://test.local/ws', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    expect(response.webSocket).toBeDefined()
  })

  it('should reject non-WebSocket requests to ws endpoint', async () => {
    const core = getCore('ws-test-2')

    const response = await core.fetch('https://test.local/ws')

    expect(response.status).toBe(426) // Upgrade Required
  })

  it('should attach tags to WebSocket connections', async () => {
    const core = getCore('ws-test-3')

    const response = await core.fetch('https://test.local/ws?room=lobby', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    // Verify via RPC that connection has room tag
    // Note: WebSocket objects cannot be passed over RPC, so we check the last connected WebSocket's tags
    const tags = await core.getWebSocketTags()
    expect(tags).toContain('room:lobby')
  })

  it('should broadcast to tagged connections', async () => {
    const core = getCore('ws-test-4')

    // This test verifies the broadcast RPC method exists
    const result = await core.broadcast('room:lobby', { type: 'message', text: 'hello' })
    expect(result.sent).toBeGreaterThanOrEqual(0)
  })

  it('should handle hibernatable WebSockets', async () => {
    const core = getCore('ws-test-5')

    // Verify acceptWebSocket with hibernate option
    const response = await core.fetch('https://test.local/ws/hibernatable', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    // Verify WebSocket is marked as hibernatable
    // Note: WebSocket objects cannot be passed over RPC, so we check the last connected WebSocket's status
    const isHibernatable = await core.isWebSocketHibernatable()
    expect(isHibernatable).toBe(true)
  })
})
