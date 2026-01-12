/**
 * RED Phase Tests: Input/Output Connectors
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tests for input sources and output sinks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createGenerateInput,
  createHttpServerInput,
  createOutput,
  StdoutOutput,
  DropOutput,
  HttpClientOutput,
  createMessage,
  createBatch,
  type Input,
  type Output,
} from '../src'

describe('GenerateInput', () => {
  describe('construction', () => {
    it('should create with template', async () => {
      const input = createGenerateInput({ template: '{"id": 1}' })
      const result = await input.start()
      expect(result.success).toBe(true)
      await input.close()
    })

    it('should fail on invalid template', async () => {
      const input = createGenerateInput({ template: 'invalid bloblang +' })
      const result = await input.start()
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('message generation', () => {
    it('should generate messages from template', async () => {
      const input = createGenerateInput({
        template: '{"value": "test"}',
        count: 3
      })

      await input.start()
      const msg1 = await input.next()
      const msg2 = await input.next()
      const msg3 = await input.next()
      const msg4 = await input.next()
      await input.close()

      expect(msg1).not.toBeNull()
      expect(msg2).not.toBeNull()
      expect(msg3).not.toBeNull()
      expect(msg4).toBeNull() // No more messages
    })

    it('should respect count limit', async () => {
      const input = createGenerateInput({
        template: '"msg"',
        count: 2
      })

      await input.start()
      await input.next()
      await input.next()
      const extra = await input.next()
      await input.close()

      expect(extra).toBeNull()
    })

    it('should add metadata', async () => {
      const input = createGenerateInput({
        template: '{"data": "test"}',
        metadata: { source: 'generator' },
        count: 1
      })

      await input.start()
      const msg = await input.next()
      await input.close()

      expect(msg).not.toBeNull()
      expect(msg!.metadata.get('source')).toBe('generator')
    })

    it('should add timestamp metadata', async () => {
      const input = createGenerateInput({
        template: '1',
        count: 1
      })

      await input.start()
      const msg = await input.next()
      await input.close()

      expect(msg!.metadata.has('timestamp')).toBe(true)
    })
  })

  describe('lifecycle', () => {
    it('should throw when not started', async () => {
      const input = createGenerateInput({ template: '1' })
      await expect(input.next()).rejects.toThrow('not started')
    })

    it('should throw when closed', async () => {
      const input = createGenerateInput({ template: '1' })
      await input.start()
      await input.close()
      await expect(input.next()).rejects.toThrow('closed')
    })

    it('should ack successfully', async () => {
      const input = createGenerateInput({ template: '1', count: 1 })
      await input.start()
      const msg = await input.next()
      const ack = await input.ack(msg!)
      await input.close()

      expect(ack.success).toBe(true)
    })

    it('should restart after close', async () => {
      const input = createGenerateInput({
        template: '"msg"',
        count: 1
      })

      await input.start()
      await input.next()
      await input.close()

      await input.start()
      const msg = await input.next()
      await input.close()

      expect(msg).not.toBeNull()
    })
  })
})

describe('HttpServerInput', () => {
  describe('construction', () => {
    it('should create with port', async () => {
      const input = createHttpServerInput({ port: 8888 })
      // In test environment, server is mocked
      const result = await input.start()
      expect(result.success).toBe(true)
      await input.close()
    })

    it('should fail on invalid port', async () => {
      const input = createHttpServerInput({ port: -1 })
      const result = await input.start()
      expect(result.success).toBe(false)
    })
  })

  describe('configuration', () => {
    it('should accept path option', async () => {
      const input = createHttpServerInput({
        port: 8889,
        path: '/events'
      })
      const result = await input.start()
      expect(result.success).toBe(true)
      await input.close()
    })

    it('should accept methods option', async () => {
      const input = createHttpServerInput({
        port: 8890,
        methods: ['POST', 'PUT']
      })
      const result = await input.start()
      expect(result.success).toBe(true)
      await input.close()
    })
  })

  describe('lifecycle', () => {
    it('should throw when not started', async () => {
      const input = createHttpServerInput({ port: 8891 })
      await expect(input.next()).rejects.toThrow('not started')
    })

    it('should return null when no requests', async () => {
      const input = createHttpServerInput({ port: 8892 })
      await input.start()
      const msg = await input.next()
      await input.close()

      expect(msg).toBeNull()
    })

    it('should close gracefully', async () => {
      const input = createHttpServerInput({ port: 8893 })
      await input.start()
      const result = await input.close()
      expect(result.success).toBe(true)
    })
  })
})

describe('StdoutOutput', () => {
  let consoleLog: typeof console.log

  beforeEach(() => {
    consoleLog = console.log
    console.log = vi.fn()
  })

  afterEach(() => {
    console.log = consoleLog
  })

  it('should write to console', async () => {
    const output = new StdoutOutput()
    const msg = createMessage({ data: 'test' })

    await output.write(msg)

    expect(console.log).toHaveBeenCalled()
  })

  it('should track metrics', async () => {
    const output = new StdoutOutput()
    await output.write(createMessage('hello'))
    await output.write(createMessage('world'))

    expect(output.metrics.messagesWritten).toBe(2)
    expect(output.metrics.bytesSent).toBeGreaterThan(0)
  })

  it('should be closeable', () => {
    const output = new StdoutOutput()
    expect(output.isOpen).toBe(true)
    output.close()
    expect(output.isOpen).toBe(false)
  })

  it('should throw when closed', async () => {
    const output = new StdoutOutput()
    output.close()
    await expect(output.write(createMessage('test'))).rejects.toThrow('closed')
  })

  it('should handle batch', async () => {
    const output = new StdoutOutput()
    const batch = createBatch(['a', 'b', 'c'])

    await output.write(batch)

    expect(output.metrics.messagesWritten).toBe(3)
  })
})

describe('DropOutput', () => {
  it('should silently discard messages', async () => {
    const output = new DropOutput()
    await output.write(createMessage('discarded'))

    // No error thrown, message just dropped
    expect(output.metrics.messagesWritten).toBe(1)
  })

  it('should track metrics despite dropping', async () => {
    const output = new DropOutput()
    await output.write(createMessage('a'))
    await output.write(createMessage('b'))

    expect(output.metrics.messagesWritten).toBe(2)
  })
})

describe('HttpClientOutput', () => {
  let fetchMock: typeof fetch

  beforeEach(() => {
    fetchMock = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('OK')
    } as Response)
  })

  afterEach(() => {
    global.fetch = fetchMock
  })

  describe('construction', () => {
    it('should create with valid URL', () => {
      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/events'
      })
      expect(output.isOpen).toBe(true)
    })

    it('should throw on invalid URL', () => {
      expect(() => new HttpClientOutput({
        type: 'http',
        url: 'not-a-url'
      })).toThrow('Invalid URL')
    })
  })

  describe('writing', () => {
    it('should POST message', async () => {
      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/events'
      })

      await output.write(createMessage({ event: 'test' }))

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/events',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String)
        })
      )
    })

    it('should include custom headers', async () => {
      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/events',
        headers: { 'X-API-Key': 'secret' }
      })

      await output.write(createMessage('test'))

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'secret'
          })
        })
      )
    })

    it('should write batch as array', async () => {
      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/batch'
      })

      await output.write(createBatch(['a', 'b', 'c']))

      const call = (global.fetch as any).mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(3)
    })
  })

  describe('error handling', () => {
    it('should throw on 4xx error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid payload')
      } as Response)

      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/events'
      })

      await expect(output.write(createMessage('test'))).rejects.toThrow('HTTP 400')
    })

    it('should retry on 5xx error', async () => {
      let attempts = 0
      global.fetch = vi.fn().mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          status: 200
        } as Response)
      })

      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/events',
        maxRetries: 3
      })

      await output.write(createMessage('test'))
      expect(attempts).toBeGreaterThanOrEqual(1)
    })

    it('should track error metrics', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Error')
      } as Response)

      const output = new HttpClientOutput({
        type: 'http',
        url: 'https://api.example.com/events'
      })

      try {
        await output.write(createMessage('test'))
      } catch {}

      expect(output.metrics.errors).toBe(1)
    })
  })
})

describe('createOutput factory', () => {
  it('should create stdout output', () => {
    const output = createOutput({ type: 'stdout' })
    expect(output).toBeInstanceOf(StdoutOutput)
  })

  it('should create drop output', () => {
    const output = createOutput({ type: 'drop' })
    expect(output).toBeInstanceOf(DropOutput)
  })

  it('should create http output', () => {
    const output = createOutput({
      type: 'http',
      url: 'https://example.com/api'
    })
    expect(output).toBeInstanceOf(HttpClientOutput)
  })

  it('should throw for unknown type', () => {
    expect(() => createOutput({ type: 'unknown' } as any)).toThrow()
  })

  it('should throw for invalid config', () => {
    expect(() => createOutput(null as any)).toThrow()
  })

  it('should throw for http without URL', () => {
    expect(() => createOutput({ type: 'http' } as any)).toThrow()
  })
})

describe('output validation', () => {
  it('should reject null messages', async () => {
    const output = new StdoutOutput()
    await expect(output.write(null as any)).rejects.toThrow()
  })

  it('should reject invalid message types', async () => {
    const output = new StdoutOutput()
    await expect(output.write('not a message' as any)).rejects.toThrow()
  })
})
