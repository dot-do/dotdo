import { describe, it, expect, beforeEach } from 'vitest'
import { createServer } from '../server'

describe('RPC Server', () => {
  const testTarget = {
    greet: (name: string) => `Hello, ${name}!`,
    add: (a: number, b: number) => a + b,
    async asyncMethod() {
      return 'async result'
    },
    users: {
      create: (data: { name: string }) => ({ id: '1', ...data }),
      list: () => [{ id: '1', name: 'Alice' }]
    },
    throws: () => { throw new Error('Test error') }
  }

  let app: ReturnType<typeof createServer>

  beforeEach(() => {
    app = createServer({ target: testTarget })
  })

  it('should call a simple method', async () => {
    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'greet', args: ['World'] })
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toBe('Hello, World!')
  })

  it('should call a method with multiple args', async () => {
    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'add', args: [2, 3] })
    })

    expect(await res.json()).toBe(5)
  })

  it('should call async methods', async () => {
    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'asyncMethod', args: [] })
    })

    expect(await res.json()).toBe('async result')
  })

  it('should call nested methods', async () => {
    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob' }] })
    })

    expect(await res.json()).toEqual({ id: '1', name: 'Bob' })
  })

  it('should return 404 for unknown methods', async () => {
    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'unknown', args: [] })
    })

    expect(res.status).toBe(404)
  })

  it('should handle errors gracefully', async () => {
    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'throws', args: [] })
    })

    expect(res.status).toBe(500)
    const json = await res.json()
    // Server now returns structured error with message field
    expect(json.message).toContain('Test error')
    expect(json.type).toBe('InternalError')
    expect(json.code).toBe('INTERNAL_ERROR')
  })

  it('should respond to health check', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
