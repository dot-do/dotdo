declare module 'cloudflare:test' {
  export const env: {
    TEST_KV?: KVNamespace
    TEST_DO?: DurableObjectNamespace
    [key: string]: unknown
  }
  export const SELF: {
    fetch: typeof fetch
  }
  export const fetchMock: {
    activate: () => void
    deactivate: () => void
    get: (matcher: string | RegExp) => { reply: (status: number, body?: unknown) => void }
    post: (matcher: string | RegExp) => { reply: (status: number, body?: unknown) => void }
  }
}
