/**
 * RED Phase Tests: Benthos Output Connectors
 * Issue: dotdo-phvqg
 *
 * These tests define the expected behavior for output connectors.
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BaseOutput,
  StdoutOutput,
  DropOutput,
  HttpClientOutput,
  OutputConfig,
  OutputMetrics,
  createOutput,
  isOutput
} from '../outputs'
import { createMessage, createBatch } from '../../core/message'

describe('BaseOutput interface', () => {
  describe('Output contract', () => {
    it('should have write method accepting single message', () => {
      const msg = createMessage('test')
      const output = createOutput({ type: 'drop' })

      expect(typeof output.write).toBe('function')
      expect(() => output.write(msg)).not.toThrow()
    })

    it('should have write method accepting batch', () => {
      const batch = createBatch(['msg1', 'msg2'])
      const output = createOutput({ type: 'drop' })

      expect(typeof output.write).toBe('function')
      expect(() => output.write(batch)).not.toThrow()
    })

    it('should have close method', () => {
      const output = createOutput({ type: 'drop' })

      expect(typeof output.close).toBe('function')
      expect(() => output.close()).not.toThrow()
    })

    it('should have isOpen getter', () => {
      const output = createOutput({ type: 'drop' })

      expect(typeof output.isOpen).toBe('boolean')
      expect(output.isOpen).toBe(true)
    })

    it('should track metrics', () => {
      const output = createOutput({ type: 'drop' })

      expect(typeof output.metrics).toBe('object')
      expect(output.metrics).toHaveProperty('messagesWritten')
      expect(output.metrics).toHaveProperty('bytesSent')
      expect(output.metrics).toHaveProperty('errors')
    })

    it('should return promise from write', async () => {
      const msg = createMessage('test')
      const output = createOutput({ type: 'drop' })

      const result = output.write(msg)
      expect(result).toBeInstanceOf(Promise)
      await expect(result).resolves.toBeUndefined()
    })

    it('should prevent write after close', async () => {
      const msg = createMessage('test')
      const output = createOutput({ type: 'drop' })

      output.close()
      expect(output.isOpen).toBe(false)

      await expect(output.write(msg)).rejects.toThrow()
    })

    it('should prevent double close', () => {
      const output = createOutput({ type: 'drop' })

      expect(() => output.close()).not.toThrow()
      expect(() => output.close()).not.toThrow()
    })
  })

  describe('Metrics tracking', () => {
    it('tracks messagesWritten count', async () => {
      const output = createOutput({ type: 'drop' })

      expect(output.metrics.messagesWritten).toBe(0)

      await output.write(createMessage('msg1'))
      expect(output.metrics.messagesWritten).toBe(1)

      await output.write(createMessage('msg2'))
      expect(output.metrics.messagesWritten).toBe(2)
    })

    it('tracks bytesSent for individual messages', async () => {
      const output = createOutput({ type: 'drop' })

      const msg1 = createMessage('hello')
      const msg2 = createMessage('world')

      expect(output.metrics.bytesSent).toBe(0)

      await output.write(msg1)
      expect(output.metrics.bytesSent).toBe(5)

      await output.write(msg2)
      expect(output.metrics.bytesSent).toBe(10)
    })

    it('tracks errors count on write failure', async () => {
      const output = createOutput({
        type: 'http',
        url: 'http://invalid-host-that-does-not-exist-12345.local',
        timeout: 100
      })

      expect(output.metrics.errors).toBe(0)

      try {
        await output.write(createMessage('test'))
      } catch {
        // Expected to fail
      }

      expect(output.metrics.errors).toBeGreaterThan(0)
    })
  })
})

describe('StdoutOutput', () => {
  let originalLog: typeof console.log
  let capturedOutput: string[]

  beforeEach(() => {
    capturedOutput = []
    originalLog = console.log
    console.log = vi.fn((...args: unknown[]) => {
      capturedOutput.push(args.join(' '))
    })
  })

  afterEach(() => {
    console.log = originalLog
  })

  describe('basic output', () => {
    it('writes message content to stdout', async () => {
      const output = createOutput({ type: 'stdout' })
      const msg = createMessage('hello world')

      await output.write(msg)

      expect(capturedOutput.length).toBe(1)
      expect(capturedOutput[0]).toContain('hello world')
    })

    it('writes JSON formatted message', async () => {
      const output = createOutput({ type: 'stdout' })
      const msg = createMessage({ name: 'test', value: 42 })

      await output.write(msg)

      expect(capturedOutput.length).toBe(1)
      const logged = capturedOutput[0]
      expect(() => JSON.parse(logged)).not.toThrow()
      expect(JSON.parse(logged)).toEqual({ name: 'test', value: 42 })
    })

    it('adds newline after each message', async () => {
      const output = createOutput({ type: 'stdout' })

      await output.write(createMessage('line1'))
      await output.write(createMessage('line2'))

      expect(capturedOutput.length).toBe(2)
      expect(capturedOutput[0]).toBe('line1')
      expect(capturedOutput[1]).toBe('line2')
    })

    it('includes metadata in output when available', async () => {
      const output = createOutput({ type: 'stdout' })
      const msg = createMessage('test', { source: 'kafka', topic: 'events' })

      await output.write(msg)

      expect(capturedOutput.length).toBeGreaterThan(0)
      // Should include metadata info in output
      const logged = JSON.stringify(capturedOutput)
      expect(logged).toContain('source')
      expect(logged).toContain('kafka')
    })
  })

  describe('batch output', () => {
    it('writes each message in batch separately', async () => {
      const output = createOutput({ type: 'stdout' })
      const batch = createBatch(['msg1', 'msg2', 'msg3'])

      await output.write(batch)

      expect(capturedOutput.length).toBe(3)
      expect(capturedOutput[0]).toContain('msg1')
      expect(capturedOutput[1]).toContain('msg2')
      expect(capturedOutput[2]).toContain('msg3')
    })

    it('tracks batch metrics correctly', async () => {
      const output = createOutput({ type: 'stdout' })
      const batch = createBatch(['a', 'b', 'c'])

      expect(output.metrics.messagesWritten).toBe(0)

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(3)
      expect(output.metrics.bytesSent).toBeGreaterThanOrEqual(3)
    })

    it('preserves message order in batch', async () => {
      const output = createOutput({ type: 'stdout' })
      const messages = [
        { seq: 1 },
        { seq: 2 },
        { seq: 3 },
        { seq: 4 },
        { seq: 5 }
      ]
      const batch = createBatch(messages)

      await output.write(batch)

      expect(capturedOutput.length).toBe(5)
      for (let i = 0; i < 5; i++) {
        const parsed = JSON.parse(capturedOutput[i])
        expect(parsed.seq).toBe(i + 1)
      }
    })

    it('handles empty batch gracefully', async () => {
      const output = createOutput({ type: 'stdout' })
      const batch = createBatch([])

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(0)
      expect(capturedOutput.length).toBe(0)
    })
  })

  describe('formatting', () => {
    it('handles binary content encoding', async () => {
      const output = createOutput({ type: 'stdout' })
      const bytes = new Uint8Array([72, 101, 108, 108, 111])
      const msg = createMessage(bytes)

      await output.write(msg)

      expect(capturedOutput.length).toBe(1)
      expect(capturedOutput[0]).toContain('Hello')
    })

    it('escapes special characters in strings', async () => {
      const output = createOutput({ type: 'stdout' })
      const msg = createMessage('line1\nline2\ttab')

      await output.write(msg)

      expect(capturedOutput.length).toBe(1)
      const logged = capturedOutput[0]
      expect(logged).toMatch(/line1/)
      expect(logged).toMatch(/line2/)
    })

    it('handles very large messages', async () => {
      const output = createOutput({ type: 'stdout' })
      const largeContent = 'x'.repeat(10000)
      const msg = createMessage(largeContent)

      await output.write(msg)

      expect(capturedOutput.length).toBe(1)
      expect(capturedOutput[0].length).toBe(10000)
    })
  })
})

describe('DropOutput', () => {
  describe('silent discard', () => {
    it('accepts messages without writing anywhere', async () => {
      const output = createOutput({ type: 'drop' })
      const msg = createMessage('test')

      await expect(output.write(msg)).resolves.toBeUndefined()
    })

    it('silently discards batches', async () => {
      const output = createOutput({ type: 'drop' })
      const batch = createBatch(['msg1', 'msg2', 'msg3'])

      await expect(output.write(batch)).resolves.toBeUndefined()
    })

    it('never throws on write', async () => {
      const output = createOutput({ type: 'drop' })

      await expect(output.write(createMessage(''))).resolves.toBeUndefined()
      await expect(output.write(createBatch([]))).resolves.toBeUndefined()
      await expect(output.write(createBatch([null, undefined, 'test']))).resolves.toBeUndefined()
    })
  })

  describe('metrics tracking', () => {
    it('tracks message count despite discarding', async () => {
      const output = createOutput({ type: 'drop' })

      await output.write(createMessage('msg1'))
      await output.write(createMessage('msg2'))
      await output.write(createBatch(['msg3', 'msg4']))

      expect(output.metrics.messagesWritten).toBe(4)
    })

    it('tracks bytes for discarded messages', async () => {
      const output = createOutput({ type: 'drop' })

      await output.write(createMessage('hello'))
      await output.write(createMessage('world'))

      expect(output.metrics.bytesSent).toBe(10)
    })

    it('tracks zero errors on success', async () => {
      const output = createOutput({ type: 'drop' })

      await output.write(createMessage('test'))
      await output.write(createBatch(['a', 'b', 'c']))

      expect(output.metrics.errors).toBe(0)
    })
  })

  describe('lifecycle', () => {
    it('can be closed without side effects', () => {
      const output = createOutput({ type: 'drop' })

      expect(() => output.close()).not.toThrow()
      expect(output.isOpen).toBe(false)
    })

    it('rejects writes after close', async () => {
      const output = createOutput({ type: 'drop' })
      output.close()

      await expect(output.write(createMessage('test'))).rejects.toThrow()
    })
  })
})

describe('HttpClientOutput', () => {
  describe('basic POST', () => {
    it('POSTs message to configured URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })
      const msg = createMessage('test payload')

      await output.write(msg)

      expect(mockFetch).toHaveBeenCalled()
      const call = mockFetch.mock.calls[0]
      expect(call[0]).toBe('http://localhost:8000/events')
      expect(call[1]?.method).toBe('POST')
    })

    it('sends message body in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })
      const msg = createMessage('test content')

      await output.write(msg)

      const call = mockFetch.mock.calls[0]
      expect(call[1]?.body).toContain('test content')
    })

    it('includes default headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })

      await output.write(createMessage('test'))

      const call = mockFetch.mock.calls[0]
      const headers = call[1]?.headers as Record<string, string>
      expect(headers['Content-Type']).toMatch(/application\/json|text\/plain/)
      expect(headers['User-Agent']).toContain('benthos')
    })

    it('accepts success status 200-299', async () => {
      const successCodes = [200, 201, 202, 204, 299]

      for (const code of successCodes) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: code,
          statusText: 'OK',
          text: () => Promise.resolve('')
        })
        global.fetch = mockFetch

        const output = createOutput({
          type: 'http',
          url: 'http://localhost:8000/events'
        })

        await expect(output.write(createMessage('test'))).resolves.toBeUndefined()
      }
    })

    it('rejects error status codes', async () => {
      const errorCodes = [400, 401, 403, 404, 500, 502, 503]

      for (const code of errorCodes) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: code,
          statusText: 'Error',
          text: () => Promise.resolve('error details')
        })
        global.fetch = mockFetch

        const output = createOutput({
          type: 'http',
          url: 'http://localhost:8000/events'
        })

        await expect(output.write(createMessage('test'))).rejects.toThrow()
      }
    })
  })

  describe('custom headers', () => {
    it('includes custom headers from config', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        headers: {
          'X-API-Key': 'secret-token',
          'X-Custom-Header': 'custom-value'
        }
      })

      await output.write(createMessage('test'))

      const call = mockFetch.mock.calls[0]
      const headers = call[1]?.headers as Record<string, string>
      expect(headers['X-API-Key']).toBe('secret-token')
      expect(headers['X-Custom-Header']).toBe('custom-value')
    })

    it('allows override of default headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        headers: {
          'Content-Type': 'application/xml'
        }
      })

      await output.write(createMessage('test'))

      const call = mockFetch.mock.calls[0]
      const headers = call[1]?.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/xml')
    })

    it('supports metadata-derived headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })
      const msg = createMessage('test', { 'x-trace-id': 'abc123' })

      await output.write(msg)

      const call = mockFetch.mock.calls[0]
      const headers = call[1]?.headers as Record<string, string>
      expect(headers['x-trace-id']).toBe('abc123')
    })
  })

  describe('timeout handling', () => {
    it('uses configured timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        new Promise(resolve => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              text: () => Promise.resolve('')
            })
          }, 100)
        })
      )
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        timeout: 500
      })

      await expect(output.write(createMessage('test'))).resolves.toBeUndefined()
    })

    it('throws on timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error('Request timeout'))
          }, 50)
        })
      )
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        timeout: 10
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow()
    })

    it('defaults to reasonable timeout', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })

      await output.write(createMessage('test'))

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('retry logic', () => {
    it('retries on transient errors (5xx)', async () => {
      let attempts = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            text: () => Promise.resolve('retry me')
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: () => Promise.resolve('')
        })
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        maxRetries: 3
      })

      await output.write(createMessage('test'))

      expect(mockFetch.mock.calls.length).toBeGreaterThan(1)
    })

    it('does not retry on client errors (4xx)', async () => {
      let attempts = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        attempts++
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve('bad request')
        })
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        maxRetries: 3
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow()

      // Should fail immediately without retries
      expect(mockFetch.mock.calls.length).toBe(1)
    })

    it('respects maxRetries config', async () => {
      let attempts = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        attempts++
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: () => Promise.resolve('retry me')
        })
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        maxRetries: 2
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow()

      // Should attempt initial + 2 retries = 3 total
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(3)
    })

    it('uses exponential backoff for retries', async () => {
      const timestamps: number[] = []
      const mockFetch = vi.fn().mockImplementation(() => {
        timestamps.push(Date.now())
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: () => Promise.resolve('retry me')
        })
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        maxRetries: 2
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow()

      // Should have multiple attempts
      expect(timestamps.length).toBeGreaterThan(1)
    })
  })

  describe('batch handling', () => {
    it('sends batch as array of messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/batch'
      })
      const batch = createBatch([
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ])

      await output.write(batch)

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1]?.body as string)
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(3)
    })

    it('tracks metrics per message in batch', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/batch'
      })
      const batch = createBatch(['msg1', 'msg2', 'msg3'])

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(3)
      expect(output.metrics.bytesSent).toBeGreaterThanOrEqual(9)
    })
  })

  describe('error handling', () => {
    it('tracks errors in metrics', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })

      try {
        await output.write(createMessage('test'))
      } catch {
        // Expected
      }

      expect(output.metrics.errors).toBeGreaterThan(0)
    })

    it('preserves error info on failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow('Connection refused')
    })
  })
})

describe('Batch write support', () => {
  describe('batch processing', () => {
    it('processes all messages in batch', async () => {
      const output = createOutput({ type: 'drop' })
      const batch = createBatch([
        'message1',
        'message2',
        'message3',
        'message4',
        'message5'
      ])

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(5)
    })

    it('maintains batch order during write', async () => {
      const originalLog = console.log
      const capturedOutput: string[] = []
      console.log = vi.fn((...args: unknown[]) => {
        capturedOutput.push(args.join(' '))
      })

      const output = createOutput({ type: 'stdout' })
      const batch = createBatch([
        { order: 1 },
        { order: 2 },
        { order: 3 }
      ])

      await output.write(batch)

      console.log = originalLog

      for (let i = 0; i < 3; i++) {
        const parsed = JSON.parse(capturedOutput[i])
        expect(parsed.order).toBe(i + 1)
      }
    })

    it('handles large batches', async () => {
      const output = createOutput({ type: 'drop' })
      const largeMessages = Array.from({ length: 1000 }, (_, i) => `msg-${i}`)
      const batch = createBatch(largeMessages)

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(1000)
    })

    it('handles mixed content types in batch', async () => {
      const output = createOutput({ type: 'drop' })
      const batch = createBatch([
        'string message',
        { json: 'object' },
        new Uint8Array([72, 101, 108, 108, 111]),
        123,
        true
      ])

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(5)
    })
  })

  describe('batch atomicity', () => {
    it('succeeds or fails as unit for http output', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/batch'
      })
      const batch = createBatch(['a', 'b', 'c'])

      await output.write(batch)

      // Should make one POST with entire batch
      expect(mockFetch.mock.calls.length).toBe(1)
    })

    it('processes batch even if one message is large', async () => {
      const output = createOutput({ type: 'drop' })
      const batch = createBatch([
        'small',
        'x'.repeat(10000),
        'small again'
      ])

      await output.write(batch)

      expect(output.metrics.messagesWritten).toBe(3)
    })
  })
})

describe('Error handling', () => {
  describe('resilience', () => {
    it('handles network timeouts gracefully', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10)
        )
      )
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events',
        timeout: 100
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow()
    })

    it('handles malformed responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('malformed json {]')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })

      // Should handle gracefully even if response is malformed
      try {
        await output.write(createMessage('test'))
      } catch {
        // Expected or not depending on implementation
      }
    })

    it('handles HTTP redirect responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 301,
        statusText: 'Moved Permanently',
        headers: { location: 'http://new-location:8000' },
        text: () => Promise.resolve('')
      })
      global.fetch = mockFetch

      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000/events'
      })

      // Should handle redirects
      try {
        await output.write(createMessage('test'))
      } catch {
        // May fail depending on implementation
      }
    })
  })

  describe('invalid configuration', () => {
    it('throws on invalid URL', () => {
      expect(() => {
        createOutput({
          type: 'http',
          url: 'not-a-valid-url'
        })
      }).toThrow()
    })

    it('throws on missing required config', () => {
      expect(() => {
        createOutput({
          type: 'http'
          // Missing url
        } as any)
      }).toThrow()
    })

    it('throws on unknown output type', () => {
      expect(() => {
        createOutput({
          type: 'unknown-output-type'
        } as any)
      }).toThrow()
    })
  })

  describe('message validation', () => {
    it('accepts valid messages', async () => {
      const output = createOutput({ type: 'drop' })

      await expect(output.write(createMessage('test'))).resolves.toBeUndefined()
    })

    it('accepts valid batches', async () => {
      const output = createOutput({ type: 'drop' })

      await expect(output.write(createBatch(['a', 'b']))).resolves.toBeUndefined()
    })

    it('rejects invalid message type', async () => {
      const output = createOutput({ type: 'drop' })

      await expect(output.write('not a message' as any)).rejects.toThrow()
    })

    it('rejects null message', async () => {
      const output = createOutput({ type: 'drop' })

      await expect(output.write(null as any)).rejects.toThrow()
    })

    it('rejects undefined', async () => {
      const output = createOutput({ type: 'drop' })

      await expect(output.write(undefined as any)).rejects.toThrow()
    })
  })
})

describe('Factory function', () => {
  describe('createOutput', () => {
    it('creates stdout output with type string', () => {
      const output = createOutput({ type: 'stdout' })

      expect(output).toBeDefined()
      expect(output.isOpen).toBe(true)
    })

    it('creates drop output', () => {
      const output = createOutput({ type: 'drop' })

      expect(output).toBeDefined()
      expect(output.isOpen).toBe(true)
    })

    it('creates http output with config', () => {
      const output = createOutput({
        type: 'http',
        url: 'http://localhost:8000'
      })

      expect(output).toBeDefined()
      expect(output.isOpen).toBe(true)
    })

    it('throws on unknown type', () => {
      expect(() => {
        createOutput({ type: 'unknown' } as any)
      }).toThrow()
    })
  })

  describe('isOutput type guard', () => {
    it('identifies valid outputs', () => {
      const output = createOutput({ type: 'drop' })

      expect(isOutput(output)).toBe(true)
    })

    it('rejects non-outputs', () => {
      expect(isOutput('string')).toBe(false)
      expect(isOutput({})).toBe(false)
      expect(isOutput(null)).toBe(false)
      expect(isOutput(undefined)).toBe(false)
    })
  })
})

describe('Output lifecycle', () => {
  it('can write before close', async () => {
    const output = createOutput({ type: 'drop' })

    await expect(output.write(createMessage('test'))).resolves.toBeUndefined()
  })

  it('cannot write after close', async () => {
    const output = createOutput({ type: 'drop' })
    output.close()

    await expect(output.write(createMessage('test'))).rejects.toThrow()
  })

  it('isOpen reflects close state', () => {
    const output = createOutput({ type: 'drop' })

    expect(output.isOpen).toBe(true)

    output.close()

    expect(output.isOpen).toBe(false)
  })

  it('multiple messages before close', async () => {
    const output = createOutput({ type: 'drop' })

    await output.write(createMessage('msg1'))
    await output.write(createMessage('msg2'))
    await output.write(createBatch(['msg3', 'msg4']))

    expect(output.metrics.messagesWritten).toBe(4)

    output.close()

    expect(output.isOpen).toBe(false)
  })
})
