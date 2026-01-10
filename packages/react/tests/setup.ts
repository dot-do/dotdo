import '@testing-library/jest-dom'

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string

  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null

  private listeners: Map<string, Set<Function>> = new Map()

  constructor(url: string) {
    this.url = url
    // Simulate connection after microtask
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
      this.listeners.get('open')?.forEach(fn => fn())
    })
  }

  addEventListener(type: string, listener: Function) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: Function) {
    this.listeners.get(type)?.delete(listener)
  }

  send(_data: string) {
    // Mock send - can be extended for specific tests
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
    this.listeners.get('close')?.forEach(fn => fn())
  }

  // Test helper to simulate receiving a message
  _receiveMessage(data: unknown) {
    const event = { data: JSON.stringify(data) }
    this.onmessage?.(event)
    this.listeners.get('message')?.forEach(fn => fn(event))
  }
}

// @ts-expect-error - mocking global
globalThis.WebSocket = MockWebSocket

// Mock fetch
globalThis.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ results: [{ value: { success: true, rowid: 1 } }] }),
  } as Response)
)

// Mock crypto.randomUUID
if (!globalThis.crypto) {
  // @ts-expect-error - mocking global
  globalThis.crypto = {}
}
globalThis.crypto.randomUUID = () => 'test-uuid-' + Math.random().toString(36).slice(2)
