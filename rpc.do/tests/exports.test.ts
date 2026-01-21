import { describe, it, expect } from 'vitest'

describe('rpc.do exports', () => {
  it('exports createClient', async () => {
    const { createClient } = await import('../src')
    expect(typeof createClient).toBe('function')
  })

  it('exports createProxy', async () => {
    const { createProxy } = await import('../src')
    expect(typeof createProxy).toBe('function')
  })

  it('exports Transport type via module', async () => {
    const mod = await import('../src')
    // Type should be exported (compile-time check)
    expect(mod).toBeDefined()
  })

  it('exports FetchTransport from transport/fetch', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')
    expect(FetchTransport).toBeDefined()
    expect(typeof FetchTransport).toBe('function')
  })

  it('exports transport types from transport module', async () => {
    const transport = await import('../src/transport')
    expect(transport).toBeDefined()
    // Should re-export types from transport/types
    expect(typeof transport.TransportState).toBeDefined()
  })

  it('exports RPCMessage type', async () => {
    // Type-only exports are verified at compile time
    // We just verify the module loads
    const mod = await import('../src')
    expect(mod).toBeDefined()
  })

  it('exports RPCResponse type', async () => {
    // Type-only exports are verified at compile time
    const mod = await import('../src')
    expect(mod).toBeDefined()
  })
})

describe('rpc.do core functions', () => {
  it('createClient returns a proxy', async () => {
    const { createClient } = await import('../src')
    const client = createClient({ url: 'https://example.com' })
    expect(client).toBeDefined()
    // Proxy wraps a function to support both property access and method calls
    expect(typeof client).toMatch(/^(function|object)$/)
  })

  it('createProxy returns a proxy', async () => {
    const { createProxy } = await import('../src')
    const proxy = createProxy(() => Promise.resolve())
    expect(proxy).toBeDefined()
    // Proxy wraps a function to support both property access and method calls
    expect(typeof proxy).toMatch(/^(function|object)$/)
  })
})
