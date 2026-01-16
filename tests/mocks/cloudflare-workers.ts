/**
 * Mock for cloudflare:workers module
 *
 * Used when running tests in Node.js environment (e.g., coverage)
 * instead of the Cloudflare Workers runtime.
 */

export class DurableObject {
  state: unknown
  env: unknown

  constructor(state: unknown, env: unknown) {
    this.state = state
    this.env = env
  }

  fetch(_request: Request): Promise<Response> {
    return Promise.resolve(new Response('Mock DurableObject'))
  }
}

export class WorkerEntrypoint {
  env: unknown

  constructor(env: unknown) {
    this.env = env
  }
}

export class RpcTarget {}

// Stub storage class for testing
export class DurableObjectState {
  storage = new DurableObjectStorage()
  id = { toString: () => 'mock-id', name: 'mock-name' }
}

export class DurableObjectStorage {
  private data = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(): Promise<Map<string, unknown>> {
    return new Map(this.data)
  }
}
