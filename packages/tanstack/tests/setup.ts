import '@testing-library/jest-dom/vitest'

// Mock WebSocket
type WSEventHandler = (event: MessageEvent | Event | CloseEvent) => void

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  url: string
  private handlers: Map<string, WSEventHandler[]> = new Map()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Simulate async connection
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.emit('open', new Event('open'))
    })
  }

  send = vi.fn()

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close'))
  })

  addEventListener(event: string, handler: WSEventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
  }

  removeEventListener(event: string, handler: WSEventHandler) {
    const handlers = this.handlers.get(event)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  emit(event: string, data: Event | MessageEvent | CloseEvent) {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(data)
    }
  }

  receiveMessage(data: unknown) {
    const messageEvent = new MessageEvent('message', {
      data: JSON.stringify(data),
    })
    this.emit('message', messageEvent)
  }

  simulateError() {
    this.emit('error', new Event('error'))
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close'))
  }
}

// @ts-expect-error - mocking global WebSocket
globalThis.WebSocket = MockWebSocket

// Reset instances before each test
beforeEach(() => {
  MockWebSocket.instances = []
})

// Export for use in tests
export { MockWebSocket }

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
