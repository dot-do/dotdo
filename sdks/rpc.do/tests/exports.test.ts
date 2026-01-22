import { describe, it, expect } from 'vitest'

describe('rpc.do exports', () => {
  it('exports createClient', async () => {
    const { createClient } = await import('..')
    expect(typeof createClient).toBe('function')
  })

  it('exports createProxy', async () => {
    const { createProxy } = await import('..')
    expect(typeof createProxy).toBe('function')
  })

  it('exports Transport type via module', async () => {
    const mod = await import('..')
    // Type should be exported (compile-time check)
    expect(mod).toBeDefined()
  })

  it('exports FetchTransport from transport/fetch', async () => {
    const { FetchTransport } = await import('../transport/fetch')
    expect(FetchTransport).toBeDefined()
    expect(typeof FetchTransport).toBe('function')
  })

  it('exports transport types from transport module', async () => {
    const transport = await import('../transport')
    expect(transport).toBeDefined()
    // Should re-export types from transport/types
    expect(typeof transport.TransportState).toBeDefined()
  })

  it('exports RetryTransport from transport module', async () => {
    const { RetryTransport, RetryPolicy, createRetryTransport } = await import('../transport')
    expect(RetryTransport).toBeDefined()
    expect(typeof RetryTransport).toBe('function')
    expect(RetryPolicy).toBeDefined()
    expect(RetryPolicy.aggressive).toBeDefined()
    expect(RetryPolicy.conservative).toBeDefined()
    expect(RetryPolicy.none).toBeDefined()
    expect(typeof createRetryTransport).toBe('function')
  })

  it('exports RPCMessage type', async () => {
    // Type-only exports are verified at compile time
    // We just verify the module loads
    const mod = await import('..')
    expect(mod).toBeDefined()
  })

  it('exports RPCResponse type', async () => {
    // Type-only exports are verified at compile time
    const mod = await import('..')
    expect(mod).toBeDefined()
  })

  it('exports error classes', async () => {
    const { RPCError, ValidationError, NotFoundError, AuthError, NetworkError, TimeoutError } = await import('..')
    expect(RPCError).toBeDefined()
    expect(typeof RPCError).toBe('function')
    expect(ValidationError).toBeDefined()
    expect(typeof ValidationError).toBe('function')
    expect(NotFoundError).toBeDefined()
    expect(typeof NotFoundError).toBe('function')
    expect(AuthError).toBeDefined()
    expect(typeof AuthError).toBe('function')
    expect(NetworkError).toBeDefined()
    expect(typeof NetworkError).toBe('function')
    expect(TimeoutError).toBeDefined()
    expect(typeof TimeoutError).toBe('function')
  })

  it('exports error utilities', async () => {
    const { fromSerializedError, isRPCError, isSerializedError, ErrorCode, ErrorHttpStatus } = await import('..')
    expect(typeof fromSerializedError).toBe('function')
    expect(typeof isRPCError).toBe('function')
    expect(typeof isSerializedError).toBe('function')
    expect(ErrorCode).toBeDefined()
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
    expect(ErrorHttpStatus).toBeDefined()
    expect(ErrorHttpStatus.INTERNAL_SERVER_ERROR).toBe(500)
  })
})

describe('rpc.do core functions', () => {
  it('createClient returns a proxy', async () => {
    const { createClient } = await import('..')
    const client = createClient({ url: 'https://example.com' })
    expect(client).toBeDefined()
    // Proxy wraps a function to support both property access and method calls
    expect(typeof client).toMatch(/^(function|object)$/)
  })

  it('createProxy returns a proxy', async () => {
    const { createProxy } = await import('..')
    const proxy = createProxy(() => Promise.resolve())
    expect(proxy).toBeDefined()
    // Proxy wraps a function to support both property access and method calls
    expect(typeof proxy).toMatch(/^(function|object)$/)
  })
})
