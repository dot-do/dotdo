/**
 * QStash HTTP Delivery Tests
 *
 * Tests for real HTTP message delivery in the QStash compat layer.
 * Follows TDD: RED (write failing tests) -> GREEN (implement) -> REFACTOR
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client, Receiver, type PublishRequest } from './index'

// Mock server state for tracking requests
interface MockRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

describe('QStash HTTP Delivery', () => {
  let client: Client
  let mockRequests: MockRequest[]
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    mockRequests = []
    originalFetch = globalThis.fetch

    // Create mock fetch that tracks all requests
    mockFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const headers: Record<string, string> = {}

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value
          })
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value
          })
        } else {
          Object.assign(headers, init.headers)
        }
      }

      mockRequests.push({
        url: urlStr,
        method: init?.method || 'GET',
        headers,
        body: init?.body?.toString() || '',
      })

      // Default success response
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    globalThis.fetch = mockFetch

    client = new Client({ token: 'test-token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('Basic HTTP Delivery', () => {
    it('should POST to destination URL with payload', async () => {
      const result = await client.publish({
        url: 'https://example.com/webhook',
        body: JSON.stringify({ event: 'user.created', userId: '123' }),
      })

      // Wait for async delivery
      await vi.waitFor(() => {
        expect(mockRequests.length).toBeGreaterThan(0)
      }, { timeout: 1000 })

      const request = mockRequests.find((r) => r.url === 'https://example.com/webhook')
      expect(request).toBeDefined()
      expect(request?.method).toBe('POST')
      expect(request?.body).toBe(JSON.stringify({ event: 'user.created', userId: '123' }))
      expect(result.messageId).toBeDefined()
    })

    it('should include Upstash-Message-Id header', async () => {
      const result = await client.publish({
        url: 'https://example.com/webhook',
        body: 'test payload',
      })

      await vi.waitFor(() => {
        expect(mockRequests.length).toBeGreaterThan(0)
      }, { timeout: 1000 })

      const request = mockRequests.find((r) => r.url === 'https://example.com/webhook')
      expect(request?.headers['Upstash-Message-Id']).toBe(result.messageId)
    })

    it('should support custom HTTP methods', async () => {
      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        method: 'PUT',
      })

      await vi.waitFor(() => {
        expect(mockRequests.length).toBeGreaterThan(0)
      }, { timeout: 1000 })

      const request = mockRequests.find((r) => r.url === 'https://example.com/webhook')
      expect(request?.method).toBe('PUT')
    })

    it('should include custom headers', async () => {
      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        headers: {
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token123',
        },
      })

      await vi.waitFor(() => {
        expect(mockRequests.length).toBeGreaterThan(0)
      }, { timeout: 1000 })

      const request = mockRequests.find((r) => r.url === 'https://example.com/webhook')
      expect(request?.headers['X-Custom-Header']).toBe('custom-value')
      expect(request?.headers['Authorization']).toBe('Bearer token123')
    })
  })

  describe('Retry Logic', () => {
    it('should include Upstash-Retried header on retry', async () => {
      let attemptCount = 0

      mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        attemptCount++
        const urlStr = typeof url === 'string' ? url : url.toString()
        const headers: Record<string, string> = {}

        if (init?.headers) {
          Object.assign(headers, init.headers)
        }

        mockRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          headers,
          body: init?.body?.toString() || '',
        })

        // Fail first 2 attempts with 500, succeed on 3rd
        if (attemptCount <= 2) {
          return new Response('Internal Server Error', { status: 500 })
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      })

      const result = await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        retries: 3,
      })

      // Wait for retries to complete
      await vi.waitFor(
        () => {
          expect(mockRequests.length).toBe(3)
        },
        { timeout: 10000 }
      )

      // First request should NOT have Upstash-Retried
      expect(mockRequests[0].headers['Upstash-Retried']).toBeUndefined()

      // Second request should have Upstash-Retried: 1
      expect(mockRequests[1].headers['Upstash-Retried']).toBe('1')

      // Third request should have Upstash-Retried: 2
      expect(mockRequests[2].headers['Upstash-Retried']).toBe('2')
    })

    it('should retry on 5xx with exponential backoff', async () => {
      const timestamps: number[] = []
      let attemptCount = 0

      mockFetch.mockImplementation(async () => {
        timestamps.push(Date.now())
        attemptCount++

        if (attemptCount <= 2) {
          return new Response('Server Error', { status: 503 })
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      })

      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        retries: 3,
      })

      await vi.waitFor(
        () => {
          expect(timestamps.length).toBe(3)
        },
        { timeout: 15000 }
      )

      // Check exponential backoff: second delay should be >= first delay
      const delay1 = timestamps[1] - timestamps[0]
      const delay2 = timestamps[2] - timestamps[1]

      // First retry delay should be around 1000ms (initial delay)
      expect(delay1).toBeGreaterThanOrEqual(800)

      // Second retry delay should be >= first (exponential)
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.8) // Allow some jitter tolerance
    })

    it('should NOT retry on 4xx errors', async () => {
      mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()
        const headers: Record<string, string> = {}
        if (init?.headers) Object.assign(headers, init.headers)

        mockRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          headers,
          body: init?.body?.toString() || '',
        })

        return new Response('Bad Request', { status: 400 })
      })

      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        retries: 3,
      })

      // Wait a bit to ensure no retries happen
      await new Promise((r) => setTimeout(r, 500))

      // Should only have 1 request (no retries for 4xx)
      expect(mockRequests.length).toBe(1)
    })
  })

  describe('Dead Letter Queue', () => {
    it('should send to DLQ after max retries', async () => {
      mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()
        const headers: Record<string, string> = {}
        if (init?.headers) Object.assign(headers, init.headers)

        mockRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          headers,
          body: init?.body?.toString() || '',
        })

        // Always fail with 500
        if (urlStr === 'https://example.com/webhook') {
          return new Response('Server Error', { status: 500 })
        }

        // DLQ should succeed
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      })

      const result = await client.publish({
        url: 'https://example.com/webhook',
        body: JSON.stringify({ important: 'data' }),
        retries: 2,
        deadLetterQueue: 'https://example.com/dlq',
      })

      // Wait for retries and DLQ
      await vi.waitFor(
        () => {
          const dlqRequest = mockRequests.find((r) => r.url === 'https://example.com/dlq')
          expect(dlqRequest).toBeDefined()
        },
        { timeout: 15000 }
      )

      const dlqRequest = mockRequests.find((r) => r.url === 'https://example.com/dlq')
      expect(dlqRequest).toBeDefined()

      // DLQ request should contain original message info
      const dlqBody = JSON.parse(dlqRequest!.body)
      expect(dlqBody.messageId).toBe(result.messageId)
      expect(dlqBody.originalUrl).toBe('https://example.com/webhook')
      expect(dlqBody.error).toBeDefined()
      expect(dlqBody.attempts).toBeGreaterThan(0)
    })

    it('should include failure reason in DLQ payload', async () => {
      mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()
        mockRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          headers: init?.headers as Record<string, string> || {},
          body: init?.body?.toString() || '',
        })

        if (urlStr.includes('webhook')) {
          return new Response('Service Unavailable', { status: 503 })
        }
        return new Response('OK', { status: 200 })
      })

      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        retries: 1,
        deadLetterQueue: 'https://example.com/dlq',
      })

      await vi.waitFor(
        () => {
          const dlqRequest = mockRequests.find((r) => r.url === 'https://example.com/dlq')
          expect(dlqRequest).toBeDefined()
        },
        { timeout: 10000 }
      )

      const dlqRequest = mockRequests.find((r) => r.url === 'https://example.com/dlq')
      const dlqBody = JSON.parse(dlqRequest!.body)
      expect(dlqBody.error).toContain('503')
    })
  })

  describe('URL Groups (Fan-out)', () => {
    it('should handle URL groups (fan-out)', async () => {
      // First, create a URL group
      await client.urlGroups.create('notifications', [
        'https://service1.example.com/webhook',
        'https://service2.example.com/webhook',
        'https://service3.example.com/webhook',
      ])

      // Publish to the group
      const result = await client.publish({
        topic: 'notifications',
        body: JSON.stringify({ event: 'broadcast' }),
      })

      // Wait for all fan-out requests
      await vi.waitFor(
        () => {
          expect(mockRequests.filter((r) => r.url.includes('example.com/webhook')).length).toBe(3)
        },
        { timeout: 5000 }
      )

      // Should have sent to all 3 URLs
      expect(mockRequests.find((r) => r.url === 'https://service1.example.com/webhook')).toBeDefined()
      expect(mockRequests.find((r) => r.url === 'https://service2.example.com/webhook')).toBeDefined()
      expect(mockRequests.find((r) => r.url === 'https://service3.example.com/webhook')).toBeDefined()

      // All requests should have the same message ID
      const webhookRequests = mockRequests.filter((r) => r.url.includes('example.com/webhook'))
      const messageIds = webhookRequests.map((r) => r.headers['Upstash-Message-Id'])
      expect(new Set(messageIds).size).toBe(1) // All same message ID
    })

    it('should return multiple responses for fan-out', async () => {
      await client.urlGroups.create('multi-service', [
        'https://a.example.com/hook',
        'https://b.example.com/hook',
      ])

      const result = await client.publishToGroup({
        topic: 'multi-service',
        body: 'broadcast message',
      })

      expect(result.responses).toHaveLength(2)
      expect(result.responses[0].url).toBe('https://a.example.com/hook')
      expect(result.responses[1].url).toBe('https://b.example.com/hook')
    })
  })

  describe('Callbacks', () => {
    it('should execute callback on completion', async () => {
      const result = await client.publish({
        url: 'https://example.com/webhook',
        body: JSON.stringify({ data: 'test' }),
        callback: 'https://example.com/callback',
      })

      // Wait for both the main request and callback
      await vi.waitFor(
        () => {
          expect(mockRequests.length).toBe(2)
        },
        { timeout: 2000 }
      )

      const callbackRequest = mockRequests.find((r) => r.url === 'https://example.com/callback')
      expect(callbackRequest).toBeDefined()
      expect(callbackRequest?.method).toBe('POST')

      const callbackBody = JSON.parse(callbackRequest!.body)
      expect(callbackBody.messageId).toBe(result.messageId)
      expect(callbackBody.url).toBe('https://example.com/webhook')
      expect(callbackBody.status).toBe('success')
      expect(callbackBody.statusCode).toBe(200)
    })

    it('should execute failure callback on permanent failure', async () => {
      mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()
        mockRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          headers: init?.headers as Record<string, string> || {},
          body: init?.body?.toString() || '',
        })

        // Main webhook always fails
        if (urlStr === 'https://example.com/webhook') {
          return new Response('Server Error', { status: 500 })
        }
        // Callbacks succeed
        return new Response('OK', { status: 200 })
      })

      const result = await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        retries: 1,
        failureCallback: 'https://example.com/failure-callback',
      })

      // Wait for failure callback
      await vi.waitFor(
        () => {
          const failureCallback = mockRequests.find(
            (r) => r.url === 'https://example.com/failure-callback'
          )
          expect(failureCallback).toBeDefined()
        },
        { timeout: 10000 }
      )

      const failureCallback = mockRequests.find(
        (r) => r.url === 'https://example.com/failure-callback'
      )
      const callbackBody = JSON.parse(failureCallback!.body)
      expect(callbackBody.messageId).toBe(result.messageId)
      expect(callbackBody.error).toBeDefined()
    })

    it('should include response body in callback payload', async () => {
      mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()
        mockRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          headers: init?.headers as Record<string, string> || {},
          body: init?.body?.toString() || '',
        })

        if (urlStr === 'https://example.com/webhook') {
          return new Response(JSON.stringify({ processed: true, id: 'abc123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response('OK', { status: 200 })
      })

      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        callback: 'https://example.com/callback',
      })

      await vi.waitFor(
        () => {
          const callback = mockRequests.find((r) => r.url === 'https://example.com/callback')
          expect(callback).toBeDefined()
        },
        { timeout: 2000 }
      )

      const callback = mockRequests.find((r) => r.url === 'https://example.com/callback')
      const callbackBody = JSON.parse(callback!.body)
      expect(callbackBody.body).toBe(JSON.stringify({ processed: true, id: 'abc123' }))
    })
  })

  describe('Signature Verification', () => {
    it('should verify signatures on receiver', async () => {
      const receiver = new Receiver({
        currentSigningKey: 'my-secret-key',
        nextSigningKey: 'my-next-key',
      })

      // Generate a valid signature
      const timestamp = Math.floor(Date.now() / 1000)
      const body = JSON.stringify({ event: 'test' })
      const payload = `${timestamp}.${body}`

      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('my-secret-key'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )

      const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const isValid = await receiver.verify({
        signature: `t=${timestamp},v1=${signature}`,
        body,
      })

      expect(isValid).toBe(true)
    })

    it('should include signature header in outgoing requests when signing key configured', async () => {
      const clientWithSigning = new Client({
        token: 'test-token',
        signingKey: 'my-signing-key',
      })

      await clientWithSigning.publish({
        url: 'https://example.com/webhook',
        body: 'test payload',
      })

      await vi.waitFor(() => {
        expect(mockRequests.length).toBeGreaterThan(0)
      }, { timeout: 1000 })

      const request = mockRequests.find((r) => r.url === 'https://example.com/webhook')
      expect(request?.headers['Upstash-Signature']).toBeDefined()

      // Verify the signature format: t=<timestamp>,v1=<signature>
      const signatureHeader = request?.headers['Upstash-Signature']
      expect(signatureHeader).toMatch(/^t=\d+,v1=[a-f0-9]+$/)
    })

    it('should verify signature with clock tolerance', async () => {
      const receiver = new Receiver({
        currentSigningKey: 'my-secret-key',
        nextSigningKey: 'my-next-key',
      })

      // Generate a signature with timestamp 30 seconds in the past
      const timestamp = Math.floor(Date.now() / 1000) - 30
      const body = JSON.stringify({ event: 'test' })
      const payload = `${timestamp}.${body}`

      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('my-secret-key'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )

      const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      // Should fail with no tolerance
      const isValidNoTolerance = await receiver.verify({
        signature: `t=${timestamp},v1=${signature}`,
        body,
        clockTolerance: 10, // 10 seconds - should fail
      })
      expect(isValidNoTolerance).toBe(false)

      // Should pass with sufficient tolerance
      const isValidWithTolerance = await receiver.verify({
        signature: `t=${timestamp},v1=${signature}`,
        body,
        clockTolerance: 60, // 60 seconds - should pass
      })
      expect(isValidWithTolerance).toBe(true)
    })
  })

  describe('Timeout Handling', () => {
    it('should respect timeout option', async () => {
      let abortSignalReceived = false

      mockFetch.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
        // Check if abort signal is passed
        if (init?.signal) {
          abortSignalReceived = true
        }

        // Simulate a slow response
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return new Response('OK', { status: 200 })
      })

      await client.publish({
        url: 'https://example.com/webhook',
        body: 'test',
        timeout: 1, // 1 second timeout
      })

      // Wait a bit for the request to be made
      await new Promise((r) => setTimeout(r, 100))

      expect(abortSignalReceived).toBe(true)
    })
  })
})
