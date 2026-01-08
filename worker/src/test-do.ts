/**
 * Test Durable Object for vitest infrastructure testing
 * This DO is used only in tests to verify storage isolation works correctly.
 */
export class TestDurableObject implements DurableObject {
  private state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/store' && request.method === 'POST') {
      const body = await request.json() as { key: string; value: string }
      await this.state.storage.put(body.key, body.value)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/get') {
      const key = url.searchParams.get('key')
      if (!key) {
        return new Response(JSON.stringify({ error: 'Missing key' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const value = await this.state.storage.get(key)
      return new Response(JSON.stringify({ value: value ?? null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
