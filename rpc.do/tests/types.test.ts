import { describe, it, expect } from 'vitest'

describe('rpc.do type compliance', () => {
  it('RPCClientOptions has url property', async () => {
    const { createClient } = await import('../src')

    // Should accept url option
    const client = createClient({ url: 'https://api.example.com' })
    expect(client).toBeDefined()
  })

  it('RPCClientOptions accepts optional timeout', async () => {
    const { createClient } = await import('../src')

    // Should accept timeout option
    const client = createClient({
      url: 'https://api.example.com',
      timeout: 5000,
    })
    expect(client).toBeDefined()
  })

  it('RPCClientOptions accepts optional correlationId', async () => {
    const { createClient } = await import('../src')

    // Should accept correlationId option
    const client = createClient({
      url: 'https://api.example.com',
      correlationId: 'test-123',
    })
    expect(client).toBeDefined()
  })

  it('Transport interface has send method', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')

    const transport = new FetchTransport({ url: 'https://example.com' })
    expect(typeof transport.send).toBe('function')
  })

  it('Transport interface has optional close method', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')

    const transport = new FetchTransport({ url: 'https://example.com' })
    // close is optional but FetchTransport implements it
    expect(typeof transport.close).toBe('function')
  })

  it('Transport interface has optional getState method', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')

    const transport = new FetchTransport({ url: 'https://example.com' })
    // getState is optional but FetchTransport implements it
    expect(typeof transport.getState).toBe('function')
  })

  it('TransportState enum has CONNECTED value', async () => {
    const { TransportState } = await import('../src/transport')

    expect(TransportState.CONNECTED).toBe('CONNECTED')
  })

  it('TransportState enum has DISCONNECTED value', async () => {
    const { TransportState } = await import('../src/transport')

    expect(TransportState.DISCONNECTED).toBe('DISCONNECTED')
  })
})

describe('rpc.do client proxy behavior', () => {
  it('client proxy supports method calls', async () => {
    const { createClient } = await import('../src')

    interface TestAPI {
      greet(name: string): Promise<string>
    }

    const client = createClient<TestAPI>({ url: 'https://api.example.com' })

    // Should be callable (will fail at network level, but type-checks)
    expect(typeof client.greet).toBe('function')
  })

  it('client proxy supports nested namespace access', async () => {
    const { createClient } = await import('../src')

    interface TestAPI {
      users: {
        create(data: { name: string }): Promise<{ id: string }>
      }
    }

    const client = createClient<TestAPI>({ url: 'https://api.example.com' })

    // Should support nested access
    expect(client.users).toBeDefined()
    expect(typeof client.users.create).toBe('function')
  })

  it('client proxy is not thenable', async () => {
    const { createClient } = await import('../src')

    const client = createClient({ url: 'https://api.example.com' })

    // Should not be thenable (would cause issues with await)
    expect((client as Record<string, unknown>)['then']).toBeUndefined()
    expect((client as Record<string, unknown>)['catch']).toBeUndefined()
    expect((client as Record<string, unknown>)['finally']).toBeUndefined()
  })
})
