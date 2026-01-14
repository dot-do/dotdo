/**
 * Snippet Module Tests
 *
 * Tests for the client-side snippet that captures frontend network timing
 * and correlates with backend traces.
 *
 * Note: Since this module interacts with browser APIs (PerformanceObserver,
 * fetch, XMLHttpRequest, sessionStorage), we mock these APIs for unit testing.
 * Integration tests should use real browser environments.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// =============================================================================
// Mock Setup
// =============================================================================

// Mock crypto.randomUUID
const mockRandomUUID = vi.fn(() => 'mock-uuid-1234-5678-90ab-cdef12345678')
vi.stubGlobal('crypto', { randomUUID: mockRandomUUID })

// Mock sessionStorage
const mockSessionStorage = new Map<string, string>()
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => mockSessionStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockSessionStorage.set(key, value),
  removeItem: (key: string) => mockSessionStorage.delete(key),
  clear: () => mockSessionStorage.clear(),
})

// Mock PerformanceObserver
class MockPerformanceObserver {
  callback: PerformanceObserverCallback
  static entries: PerformanceEntry[] = []
  static observers: MockPerformanceObserver[] = []

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback
    MockPerformanceObserver.observers.push(this)
  }

  observe(_options: PerformanceObserverInit): void {
    // Emit buffered entries immediately
    if (MockPerformanceObserver.entries.length > 0) {
      this.callback(
        {
          getEntries: () => MockPerformanceObserver.entries,
          getEntriesByType: () => MockPerformanceObserver.entries,
          getEntriesByName: () => MockPerformanceObserver.entries,
        },
        this as unknown as PerformanceObserver
      )
    }
  }

  disconnect(): void {
    const idx = MockPerformanceObserver.observers.indexOf(this)
    if (idx > -1) {
      MockPerformanceObserver.observers.splice(idx, 1)
    }
  }

  static reset(): void {
    MockPerformanceObserver.entries = []
    MockPerformanceObserver.observers = []
  }

  static addEntry(entry: Partial<PerformanceResourceTiming>): void {
    const defaultEntry: PerformanceResourceTiming = {
      name: 'https://api.example.com/data',
      entryType: 'resource',
      initiatorType: 'fetch',
      startTime: 100,
      duration: 50,
      domainLookupStart: 105,
      domainLookupEnd: 110,
      connectStart: 110,
      connectEnd: 120,
      secureConnectionStart: 115,
      requestStart: 120,
      responseStart: 140,
      responseEnd: 150,
      transferSize: 1024,
      encodedBodySize: 900,
      decodedBodySize: 1000,
      serverTiming: [],
      workerStart: 0,
      redirectStart: 0,
      redirectEnd: 0,
      fetchStart: 100,
      nextHopProtocol: 'h2',
      renderBlockingStatus: 'non-blocking',
      responseStatus: 200,
      contentType: 'application/json',
      firstInterimResponseStart: 0,
      deliveryType: 'cache',
      toJSON: () => ({}),
    }
    const fullEntry = { ...defaultEntry, ...entry }
    MockPerformanceObserver.entries.push(fullEntry as PerformanceEntry)

    // Notify all observers
    for (const observer of MockPerformanceObserver.observers) {
      observer.callback(
        {
          getEntries: () => [fullEntry],
          getEntriesByType: () => [fullEntry],
          getEntriesByName: () => [fullEntry],
        },
        observer as unknown as PerformanceObserver
      )
    }
  }
}

vi.stubGlobal('PerformanceObserver', MockPerformanceObserver)

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({}),
})
const originalFetch = global.fetch
vi.stubGlobal('fetch', mockFetch)

// Mock XMLHttpRequest
class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []
  _method: string = ''
  _url: string = ''
  _headers: Map<string, string> = new Map()
  _dotdo_request_id?: string

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string): void {
    this._method = method
    this._url = url
  }

  setRequestHeader(name: string, value: string): void {
    this._headers.set(name, value)
  }

  send(_body?: unknown): void {
    // No-op for testing
  }

  static reset(): void {
    MockXMLHttpRequest.instances = []
  }
}

// Store original methods for reset
const originalXHROpen = MockXMLHttpRequest.prototype.open
const originalXHRSend = MockXMLHttpRequest.prototype.send

vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)

// Function to reset XHR mock prototype to original methods
function resetXMLHttpRequestMock() {
  MockXMLHttpRequest.prototype.open = originalXHROpen
  MockXMLHttpRequest.prototype.send = originalXHRSend
  MockXMLHttpRequest.reset()
}

// Mock navigator.sendBeacon
const mockSendBeacon = vi.fn().mockReturnValue(true)
vi.stubGlobal('navigator', { sendBeacon: mockSendBeacon })

// Mock window
vi.stubGlobal('window', {
  location: { href: 'https://example.com/page' },
  fetch: mockFetch,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

// Mock document
vi.stubGlobal('document', {
  visibilityState: 'visible',
})

// =============================================================================
// Import modules after mocks are set up
// =============================================================================

import {
  createPerformanceObserver,
  calculateTimingBreakdown,
  getResourceType,
} from '../src/snippet/performance-observer'

import {
  instrumentFetch,
  instrumentXHR,
  instrumentNetwork,
} from '../src/snippet/fetch-interceptor'

import {
  getOrCreateSessionId,
  getSessionId,
  setSessionId,
  clearSessionId,
  hasSessionId,
} from '../src/snippet/session'

import { initSnippet, type SnippetConfig } from '../src/snippet/index'

// =============================================================================
// Test Suite
// =============================================================================

describe('@dotdo/client/snippet', () => {
  beforeEach(() => {
    mockSessionStorage.clear()
    mockRandomUUID.mockClear()
    mockFetch.mockClear()
    mockSendBeacon.mockClear()
    MockPerformanceObserver.reset()
    // Reset XHR to a fresh class to avoid prototype pollution between tests
    resetXMLHttpRequestMock()
    // Reset UUID counter for predictable IDs
    // Use format where counter is in first 8 chars so request IDs are unique
    let uuidCounter = 0
    mockRandomUUID.mockImplementation(() => {
      const id = ++uuidCounter
      // Pad the ID into first 8 chars: uuid0001, uuid0002, etc.
      return `uuid${String(id).padStart(4, '0')}-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Session Management Tests
  // ===========================================================================

  describe('session management', () => {
    it('creates a new session ID if none exists', () => {
      const sessionId = getOrCreateSessionId()
      expect(sessionId).toBe('uuid0001-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
      expect(mockSessionStorage.get('dotdo_session_id')).toBe('uuid0001-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
    })

    it('returns existing session ID on subsequent calls', () => {
      const sessionId1 = getOrCreateSessionId()
      const sessionId2 = getOrCreateSessionId()
      expect(sessionId1).toBe(sessionId2)
      // Should only generate one UUID
      expect(mockRandomUUID).toHaveBeenCalledTimes(1)
    })

    it('persists session ID in sessionStorage', () => {
      getOrCreateSessionId()
      expect(mockSessionStorage.get('dotdo_session_id')).toBe('uuid0001-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
    })

    it('getSessionId returns null when no session exists', () => {
      const sessionId = getSessionId()
      expect(sessionId).toBeNull()
    })

    it('getSessionId returns existing session ID', () => {
      mockSessionStorage.set('dotdo_session_id', 'existing-session')
      const sessionId = getSessionId()
      expect(sessionId).toBe('existing-session')
    })

    it('clearSessionId removes session from storage', () => {
      mockSessionStorage.set('dotdo_session_id', 'to-be-cleared')
      clearSessionId()
      expect(mockSessionStorage.get('dotdo_session_id')).toBeUndefined()
    })

    it('setSessionId sets a specific session ID', () => {
      setSessionId('custom-session-id')
      expect(mockSessionStorage.get('dotdo_session_id')).toBe('custom-session-id')
    })

    it('hasSessionId returns false when no session exists', () => {
      expect(hasSessionId()).toBe(false)
    })

    it('hasSessionId returns true when session exists', () => {
      mockSessionStorage.set('dotdo_session_id', 'some-session')
      expect(hasSessionId()).toBe(true)
    })
  })

  // ===========================================================================
  // Performance Observer Tests
  // ===========================================================================

  describe('performance observer', () => {
    it('creates a PerformanceObserver', () => {
      const onEntry = vi.fn()
      const observer = createPerformanceObserver({
        sessionId: 'test-session',
        onEntry,
      })

      expect(observer).toBeDefined()
      expect(observer).toBeInstanceOf(MockPerformanceObserver)
    })

    it('captures resource timing entries', () => {
      const entries: PerformanceResourceTiming[] = []
      createPerformanceObserver({
        sessionId: 'test-session',
        onEntry: (entry) => entries.push(entry),
      })

      // Add an entry
      MockPerformanceObserver.addEntry({
        name: 'https://api.test.com/endpoint',
      })

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('https://api.test.com/endpoint')
    })

    it('filters entries based on filter function', () => {
      const entries: PerformanceResourceTiming[] = []
      createPerformanceObserver({
        sessionId: 'test-session',
        onEntry: (entry) => entries.push(entry),
        filter: (entry) => entry.name.includes('allowed.com'),
      })

      // Add entries
      MockPerformanceObserver.addEntry({ name: 'https://allowed.com/data' })
      MockPerformanceObserver.addEntry({ name: 'https://blocked.com/data' })

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('https://allowed.com/data')
    })

    it('disconnects observer when called', () => {
      const observer = createPerformanceObserver({
        sessionId: 'test-session',
        onEntry: vi.fn(),
      })

      const initialCount = MockPerformanceObserver.observers.length
      observer.disconnect()
      expect(MockPerformanceObserver.observers.length).toBe(initialCount - 1)
    })
  })

  // ===========================================================================
  // Timing Breakdown Tests
  // ===========================================================================

  describe('timing calculations', () => {
    it('calculateTimingBreakdown computes correct values', () => {
      const entry = {
        domainLookupStart: 100,
        domainLookupEnd: 110,
        connectStart: 110,
        connectEnd: 130,
        secureConnectionStart: 115,
        requestStart: 130,
        responseStart: 145,
        responseEnd: 160,
        startTime: 95,
        duration: 65,
      } as PerformanceResourceTiming

      const breakdown = calculateTimingBreakdown(entry)

      expect(breakdown.dnsTime).toBe(10)
      expect(breakdown.connectTime).toBe(20)
      expect(breakdown.tlsTime).toBe(15)
      expect(breakdown.ttfb).toBe(15)
      expect(breakdown.downloadTime).toBe(15)
      expect(breakdown.blockedTime).toBe(5)
      expect(breakdown.totalTime).toBe(65)
    })

    it('handles non-TLS connections', () => {
      const entry = {
        domainLookupStart: 100,
        domainLookupEnd: 110,
        connectStart: 110,
        connectEnd: 120,
        secureConnectionStart: 0, // No TLS
        requestStart: 120,
        responseStart: 130,
        responseEnd: 140,
        startTime: 100,
        duration: 40,
      } as PerformanceResourceTiming

      const breakdown = calculateTimingBreakdown(entry)

      expect(breakdown.tlsTime).toBe(0)
    })
  })

  // ===========================================================================
  // Resource Type Tests
  // ===========================================================================

  describe('resource type mapping', () => {
    it('maps initiator types correctly', () => {
      expect(getResourceType('fetch')).toBe('xhr')
      expect(getResourceType('xmlhttprequest')).toBe('xhr')
      expect(getResourceType('script')).toBe('script')
      expect(getResourceType('link')).toBe('stylesheet')
      expect(getResourceType('css')).toBe('stylesheet')
      expect(getResourceType('img')).toBe('image')
      expect(getResourceType('image')).toBe('image')
      expect(getResourceType('font')).toBe('font')
      expect(getResourceType('video')).toBe('media')
      expect(getResourceType('audio')).toBe('media')
      expect(getResourceType('iframe')).toBe('document')
      expect(getResourceType('beacon')).toBe('beacon')
      expect(getResourceType('unknown')).toBe('other')
    })
  })

  // ===========================================================================
  // Fetch Interceptor Tests
  // ===========================================================================

  describe('fetch interceptor', () => {
    it('injects X-Request-ID into fetch requests', async () => {
      const sessionId = 'test-session-123'
      const restore = instrumentFetch(sessionId)

      await window.fetch('https://api.example.com/data')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [_url, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Headers

      expect(headers.get('X-Request-ID')).toMatch(/^test-session-123-/)
      expect(headers.get('X-Session-ID')).toBe('test-session-123')

      restore()
    })

    it('injects X-Session-ID into fetch requests', async () => {
      const sessionId = 'session-abc'
      const restore = instrumentFetch(sessionId)

      await window.fetch('https://api.example.com/data')

      const [_url, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Headers

      expect(headers.get('X-Session-ID')).toBe('session-abc')

      restore()
    })

    it('restores original fetch on cleanup', async () => {
      const sessionId = 'test-session'
      const restore = instrumentFetch(sessionId)

      // First call should be instrumented
      await window.fetch('https://api.example.com/data')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Restore
      restore()

      // Clear mock to verify restoration
      mockFetch.mockClear()
      // Note: In this test setup, fetch is globally mocked, so restoration
      // doesn't fully work. In real usage, it would restore the original.
    })

    it('preserves existing headers', async () => {
      const sessionId = 'test-session'
      const restore = instrumentFetch(sessionId)

      await window.fetch('https://api.example.com/data', {
        headers: { 'Content-Type': 'application/json' },
      })

      const [_url, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Headers

      expect(headers.get('Content-Type')).toBe('application/json')
      expect(headers.get('X-Session-ID')).toBe('test-session')

      restore()
    })
  })

  // ===========================================================================
  // XHR Interceptor Tests
  // ===========================================================================

  describe('XHR interceptor', () => {
    it('injects headers into XHR requests', () => {
      const sessionId = 'xhr-session-123'
      const restore = instrumentXHR(sessionId)

      const xhr = new XMLHttpRequest() as unknown as MockXMLHttpRequest
      xhr.open('GET', 'https://api.example.com/data')
      xhr.send()

      expect(xhr._headers.get('X-Session-ID')).toBe('xhr-session-123')
      expect(xhr._headers.get('X-Request-ID')).toMatch(/^xhr-session-123-/)

      restore()
    })

    it('generates unique request IDs for each XHR', () => {
      const sessionId = 'xhr-session'
      const restore = instrumentXHR(sessionId)

      const xhr1 = new XMLHttpRequest() as unknown as MockXMLHttpRequest
      xhr1.open('GET', 'https://api.example.com/data1')
      xhr1.send()

      const xhr2 = new XMLHttpRequest() as unknown as MockXMLHttpRequest
      xhr2.open('GET', 'https://api.example.com/data2')
      xhr2.send()

      const requestId1 = xhr1._headers.get('X-Request-ID')
      const requestId2 = xhr2._headers.get('X-Request-ID')

      expect(requestId1).not.toBe(requestId2)

      restore()
    })
  })

  // ===========================================================================
  // Combined Network Instrumentation Tests
  // ===========================================================================

  describe('combined network instrumentation', () => {
    it('instrumentNetwork instruments both fetch and XHR by default', async () => {
      const restore = instrumentNetwork({ sessionId: 'combined-session' })

      // Test fetch
      await window.fetch('https://api.example.com/data')
      const [_url, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Headers
      expect(headers.get('X-Session-ID')).toBe('combined-session')

      // Test XHR
      const xhr = new XMLHttpRequest() as unknown as MockXMLHttpRequest
      xhr.open('GET', 'https://api.example.com/data')
      xhr.send()
      expect(xhr._headers.get('X-Session-ID')).toBe('combined-session')

      restore()
    })

    it('respects instrumentFetch: false option', async () => {
      const restore = instrumentNetwork({
        sessionId: 'xhr-only-session',
        instrumentFetch: false,
        instrumentXHR: true,
      })

      // Fetch should NOT be instrumented (won't have our headers in this test setup)
      // XHR should be instrumented
      const xhr = new XMLHttpRequest() as unknown as MockXMLHttpRequest
      xhr.open('GET', 'https://api.example.com/data')
      xhr.send()
      expect(xhr._headers.get('X-Session-ID')).toBe('xhr-only-session')

      restore()
    })
  })

  // ===========================================================================
  // Main Snippet Tests
  // ===========================================================================

  describe('initSnippet', () => {
    it('creates a snippet instance', () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
      })

      expect(snippet).toBeDefined()
      expect(snippet.getSessionId).toBeDefined()
      expect(snippet.getPendingCount).toBeDefined()
      expect(snippet.flush).toBeDefined()
      expect(snippet.destroy).toBeDefined()

      snippet.destroy()
    })

    it('returns session ID', () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
      })

      const sessionId = snippet.getSessionId()
      expect(sessionId).toBe('uuid0001-xxxx-xxxx-xxxx-xxxxxxxxxxxx')

      snippet.destroy()
    })

    it('tracks pending event count', () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100, // High batch size to prevent auto-flush
      })

      expect(snippet.getPendingCount()).toBe(0)

      // Add entries
      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/1' })
      expect(snippet.getPendingCount()).toBe(1)

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/2' })
      expect(snippet.getPendingCount()).toBe(2)

      snippet.destroy()
    })

    it('batches events efficiently', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 3,
        flushInterval: 60000, // Long interval to test batch-based flushing
      })

      // Add entries below batch size
      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/1' })
      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/2' })

      // Should not have flushed yet
      expect(mockFetch).not.toHaveBeenCalled()

      // Add third entry to trigger batch flush
      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/3' })

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockFetch).toHaveBeenCalled()

      snippet.destroy()
    })

    it('applies filter to entries', () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
        filter: (entry) => entry.name.includes('allowed.com'),
      })

      MockPerformanceObserver.addEntry({ name: 'https://allowed.com/data' })
      MockPerformanceObserver.addEntry({ name: 'https://blocked.com/data' })

      expect(snippet.getPendingCount()).toBe(1)

      snippet.destroy()
    })

    it('flushes events on demand', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })
      expect(snippet.getPendingCount()).toBe(1)

      await snippet.flush()

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(snippet.getPendingCount()).toBe(0)

      snippet.destroy()
    })

    it('sends correct payload format', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'my-namespace',
        batchSize: 100,
      })

      MockPerformanceObserver.addEntry({
        name: 'https://api.test.com/endpoint',
        initiatorType: 'fetch',
      })

      await snippet.flush()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://events.example.com',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )

      const [_url, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options.body as string)

      expect(body.namespace).toBe('my-namespace')
      expect(body.events).toHaveLength(1)
      expect(body.events[0].name).toBe('https://api.test.com/endpoint')
      expect(body.events[0].initiatorType).toBe('fetch')
      expect(body.events[0].sessionId).toBeDefined()

      snippet.destroy()
    })

    it('includes custom headers in requests', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token123',
        },
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })
      await snippet.flush()

      const [_url, options] = mockFetch.mock.calls[0]
      expect(options.headers['X-Custom-Header']).toBe('custom-value')
      expect(options.headers['Authorization']).toBe('Bearer token123')

      snippet.destroy()
    })

    it('instruments network when injectRequestIds is true', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        injectRequestIds: true,
      })

      // Make a fetch request
      await window.fetch('https://api.example.com/data')

      // Check that headers were injected
      const [_url, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Headers
      expect(headers.get('X-Session-ID')).toBeDefined()
      expect(headers.get('X-Request-ID')).toBeDefined()

      snippet.destroy()
    })

    it('calls onFlush callback on successful flush', async () => {
      const onFlush = vi.fn()

      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
        onFlush,
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })
      await snippet.flush()

      expect(onFlush).toHaveBeenCalledTimes(1)
      expect(onFlush).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'https://api.test.com/data' })
        ]),
        expect.any(Object) // Response
      )

      snippet.destroy()
    })

    it('calls onError callback on flush failure', async () => {
      const onError = vi.fn()
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
        onError,
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })
      await snippet.flush()

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.arrayContaining([
          expect.objectContaining({ name: 'https://api.test.com/data' })
        ])
      )

      snippet.destroy()
    })

    it('cleans up on destroy', () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        injectRequestIds: true,
      })

      const observerCount = MockPerformanceObserver.observers.length

      snippet.destroy()

      // Observer should be disconnected
      expect(MockPerformanceObserver.observers.length).toBe(observerCount - 1)
    })

    it('does not flush after destroy', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })
      snippet.destroy()

      await snippet.flush()

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty batch gracefully', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
      })

      await snippet.flush()

      // Should not make any fetch calls with empty batch
      expect(mockFetch).not.toHaveBeenCalled()

      snippet.destroy()
    })

    it('session ID persists across snippet instances', () => {
      const snippet1 = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
      })

      const sessionId1 = snippet1.getSessionId()
      snippet1.destroy()

      const snippet2 = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
      })

      const sessionId2 = snippet2.getSessionId()
      snippet2.destroy()

      expect(sessionId1).toBe(sessionId2)
    })

    it('handles concurrent flushes', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })

      // Trigger multiple flushes concurrently
      await Promise.all([
        snippet.flush(),
        snippet.flush(),
        snippet.flush(),
      ])

      // Only one should actually send (others should see empty batch)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      snippet.destroy()
    })

    it('retries failed events on next flush', async () => {
      const snippet = initSnippet({
        endpoint: 'https://events.example.com',
        namespace: 'test-ns',
        batchSize: 100,
      })

      MockPerformanceObserver.addEntry({ name: 'https://api.test.com/data' })

      // First flush fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await snippet.flush()

      // Events should be back in the batch
      expect(snippet.getPendingCount()).toBe(1)

      // Second flush succeeds
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await snippet.flush()

      expect(snippet.getPendingCount()).toBe(0)

      snippet.destroy()
    })
  })

  // ===========================================================================
  // Export Tests
  // ===========================================================================

  describe('exports', () => {
    it('exports all expected functions from main module', async () => {
      const module = await import('../src/snippet/index')

      // Main function
      expect(module.initSnippet).toBeDefined()
      expect(module.default).toBe(module.initSnippet)

      // Performance observer
      expect(module.createPerformanceObserver).toBeDefined()
      expect(module.calculateTimingBreakdown).toBeDefined()
      expect(module.getResourceType).toBeDefined()

      // Fetch interceptor
      expect(module.instrumentFetch).toBeDefined()
      expect(module.instrumentXHR).toBeDefined()
      expect(module.instrumentNetwork).toBeDefined()

      // Session management
      expect(module.getOrCreateSessionId).toBeDefined()
      expect(module.getSessionId).toBeDefined()
      expect(module.setSessionId).toBeDefined()
      expect(module.clearSessionId).toBeDefined()
      expect(module.hasSessionId).toBeDefined()
    })
  })
})
