/**
 * @dotdo/sentry - Transport Tests
 *
 * RED phase: Tests for transport implementations
 * - InMemoryTransport for testing
 * - FetchTransport for production
 */

import { describe, it, expect, vi } from 'vitest'
import { InMemoryTransport, FetchTransport } from '../src/transport.js'
import type { Envelope, SentryEvent } from '../src/types.js'

describe('@dotdo/sentry - Transport', () => {
  describe('InMemoryTransport', () => {
    it('should store events', async () => {
      const transport = new InMemoryTransport()

      const event: SentryEvent = {
        event_id: 'abc123',
        message: 'Test event',
      }

      const envelope: Envelope = [
        { event_id: 'abc123', sent_at: new Date().toISOString() },
        [[{ type: 'event' }, event]],
      ]

      const result = await transport.send(envelope)

      expect(result.statusCode).toBe(200)
      expect(transport.getEvents()).toHaveLength(1)
      expect(transport.getEvents()[0]).toEqual(event)
    })

    it('should store multiple events', async () => {
      const transport = new InMemoryTransport()

      for (let i = 0; i < 5; i++) {
        const envelope: Envelope = [
          { event_id: `event-${i}`, sent_at: new Date().toISOString() },
          [[{ type: 'event' }, { event_id: `event-${i}`, message: `Event ${i}` }]],
        ]
        await transport.send(envelope)
      }

      expect(transport.getEvents()).toHaveLength(5)
    })

    it('should clear events', async () => {
      const transport = new InMemoryTransport()

      const envelope: Envelope = [
        { event_id: 'abc123', sent_at: new Date().toISOString() },
        [[{ type: 'event' }, { event_id: 'abc123', message: 'Test' }]],
      ]

      await transport.send(envelope)
      expect(transport.getEvents()).toHaveLength(1)

      transport.clear()
      expect(transport.getEvents()).toHaveLength(0)
    })

    it('should flush immediately', async () => {
      const transport = new InMemoryTransport()

      const result = await transport.flush(1000)
      expect(result).toBe(true)
    })

    it('should ignore non-event items', async () => {
      const transport = new InMemoryTransport()

      const envelope: Envelope = [
        { sent_at: new Date().toISOString() },
        [
          [{ type: 'session' }, { sid: 'session-1' }],
          [{ type: 'event' }, { event_id: 'abc', message: 'Test' }],
        ],
      ]

      await transport.send(envelope)

      expect(transport.getEvents()).toHaveLength(1)
    })
  })

  describe('FetchTransport', () => {
    it('should send envelope to Sentry API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([['x-sentry-rate-limits', '']]),
      })

      const transport = new FetchTransport(
        {
          protocol: 'https',
          publicKey: 'testkey',
          host: 'o0.ingest.sentry.io',
          projectId: '123',
        },
        mockFetch as unknown as typeof fetch
      )

      const envelope: Envelope = [
        { event_id: 'abc123', sent_at: new Date().toISOString() },
        [[{ type: 'event' }, { event_id: 'abc123', message: 'Test' }]],
      ]

      await transport.send(envelope)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://o0.ingest.sentry.io/api/123/envelope/',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-sentry-envelope',
          }),
        })
      )
    })

    it('should include auth header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map(),
      })

      const transport = new FetchTransport(
        {
          protocol: 'https',
          publicKey: 'my-public-key',
          host: 'sentry.io',
          projectId: '456',
        },
        mockFetch as unknown as typeof fetch
      )

      await transport.send([
        { event_id: 'test', sent_at: new Date().toISOString() },
        [[{ type: 'event' }, { event_id: 'test' }]],
      ])

      const call = mockFetch.mock.calls[0]
      expect(call[1].headers['X-Sentry-Auth']).toContain('sentry_key=my-public-key')
    })

    it('should handle network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const transport = new FetchTransport(
        {
          protocol: 'https',
          publicKey: 'key',
          host: 'sentry.io',
          projectId: '123',
        },
        mockFetch as unknown as typeof fetch
      )

      const result = await transport.send([
        { sent_at: new Date().toISOString() },
        [[{ type: 'event' }, { event_id: 'test' }]],
      ])

      expect(result.statusCode).toBe(0)
    })

    it('should serialize envelope body correctly', async () => {
      let capturedBody = ''

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = options.body
        return { status: 200, headers: new Map() }
      })

      const transport = new FetchTransport(
        {
          protocol: 'https',
          publicKey: 'key',
          host: 'sentry.io',
          projectId: '123',
        },
        mockFetch as unknown as typeof fetch
      )

      const event = { event_id: 'abc', message: 'Test' }

      await transport.send([
        { event_id: 'abc', sent_at: '2024-01-01T00:00:00.000Z' },
        [[{ type: 'event' }, event]],
      ])

      const lines = capturedBody.split('\n')
      expect(lines).toHaveLength(3)

      // Header
      expect(JSON.parse(lines[0])).toEqual({
        event_id: 'abc',
        sent_at: '2024-01-01T00:00:00.000Z',
      })

      // Item header
      expect(JSON.parse(lines[1])).toEqual({ type: 'event' })

      // Item payload
      expect(JSON.parse(lines[2])).toEqual(event)
    })
  })
})
