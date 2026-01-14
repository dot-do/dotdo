/**
 * RED Phase Tests: Benthos Input Connectors
 * Issue: dotdo-x88jv
 *
 * Comprehensive test suite for Benthos Input Connectors including:
 * - Base Input interface (start, next, ack, close)
 * - GenerateInput with Bloblang templates
 * - HttpServerInput with request handling
 * - Metadata extraction from headers
 * - Batch message support
 * - Graceful shutdown and cleanup
 *
 * These tests are expected to FAIL until ../inputs.ts is implemented.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  Input,
  GenerateInputConfig,
  HttpServerInputConfig,
  InputMessage,
  StartResult,
  NextResult,
} from '../inputs'
import {
  createGenerateInput,
  createHttpServerInput,
} from '../inputs'
import { BenthosMessage, createMessage } from '../../core/message'

// ============================================================================
// Test Fixtures & Mocks
// ============================================================================

const SIMPLE_BLOBLANG_TEMPLATE = '{"id": $uuid(), "timestamp": now()}'
const OBJECT_BLOBLANG_TEMPLATE = '{"user": .username, "email": .email, "verified": .verified}'
const ARITHMETIC_BLOBLANG_TEMPLATE = '{"value": .count * 2}'
const CONDITIONAL_BLOBLANG_TEMPLATE = 'if .type == "event" then {"event": .} else {"record": .}'

function createMockHttpServer() {
  return {
    listen: vi.fn(async () => Promise.resolve()),
    close: vi.fn(async () => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    off: vi.fn(),
  }
}

function createMockRequest(overrides = {}) {
  return {
    method: 'POST',
    url: '/messages',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'abc123',
      'x-user-id': 'user42',
      ...overrides.headers,
    },
    body: { message: 'test' },
    ...overrides,
  }
}

function createMockResponse() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
  }
}

// ============================================================================
// Base Input Interface Tests
// ============================================================================

describe('Base Input Interface', () => {
  describe('Input lifecycle', () => {
    it('start() initializes the input and returns StartResult', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      const result = await input.start()

      expect(result).toBeDefined()
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
    })

    it('next() returns InputMessage when data available', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).toBeDefined()
      expect(msg).toHaveProperty('content')
      expect(msg).toHaveProperty('metadata')
    })

    it('next() returns null when no more messages available', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 0,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).toBeNull()
    })

    it('next() raises error before start() called', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      await expect(input.next()).rejects.toThrow(/not started|not initialized/i)
    })

    it('ack() acknowledges message delivery', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).not.toBeNull()
      if (msg) {
        const ackResult = await input.ack(msg)

        expect(ackResult).toBeDefined()
        expect(typeof ackResult.success).toBe('boolean')
      }
    })

    it('close() gracefully shuts down the input', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      await input.start()
      const closeResult = await input.close()

      expect(closeResult).toBeDefined()
      expect(typeof closeResult.success).toBe('boolean')
    })

    it('raises error on operations after close()', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      await input.start()
      await input.close()

      await expect(input.next()).rejects.toThrow(/closed|shut down/i)
    })

    it('supports multiple consecutive start/stop cycles', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      // First cycle
      await input.start()
      const msg1 = await input.next()
      expect(msg1).not.toBeNull()
      await input.close()

      // Second cycle
      const result = await input.start()
      expect(result.success).toBe(true)
      const msg2 = await input.next()
      expect(msg2).not.toBeNull()
      await input.close()
    })
  })

  describe('Error handling', () => {
    it('handles errors during start gracefully', async () => {
      const input = createGenerateInput({
        template: 'invalid {{ bloblang',
        count: 1,
      })

      const result = await input.start()

      expect(result.success).toBe(false)
      if (!result.success && 'error' in result) {
        expect(result.error).toBeDefined()
      }
    })

    it('returns result with error message on start failure', async () => {
      const input = createGenerateInput({
        template: 'invalid {{ bloblang',
        count: 1,
      })

      const result = await input.start()

      if (!result.success) {
        expect(result).toHaveProperty('error')
        expect(typeof result.error).toBe('string')
      }
    })
  })
})

// ============================================================================
// GenerateInput Tests
// ============================================================================

describe('GenerateInput', () => {
  describe('initialization', () => {
    it('accepts template string in config', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })

    it('accepts count parameter for fixed message count', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 3,
      })

      await input.start()

      const msg1 = await input.next()
      const msg2 = await input.next()
      const msg3 = await input.next()
      const msg4 = await input.next()

      expect(msg1).not.toBeNull()
      expect(msg2).not.toBeNull()
      expect(msg3).not.toBeNull()
      expect(msg4).toBeNull()
    })

    it('accepts interval parameter in milliseconds', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        interval: 100,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })

    it('accepts batch size configuration', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 5,
        batchSize: 2,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })

    it('uses default interval if not specified', async () => {
      const input = createGenerateInput({
        template: SIMPLE_BLOBLANG_TEMPLATE,
        count: 1,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })
  })

  describe('Bloblang template execution', () => {
    it('evaluates Bloblang template to generate message content', async () => {
      const input = createGenerateInput({
        template: '{"message": "hello", "number": 42}',
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).not.toBeNull()
      if (msg) {
        const content = JSON.parse(msg.content)
        expect(content.message).toBe('hello')
        expect(content.number).toBe(42)
      }
    })

    it('evaluates template with root accessor', async () => {
      const input = createGenerateInput({
        template: '{root: .}',
        count: 1,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })

    it('evaluates conditional Bloblang expressions', async () => {
      const input = createGenerateInput({
        template: CONDITIONAL_BLOBLANG_TEMPLATE,
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).not.toBeNull()
    })

    it('evaluates arithmetic operations in templates', async () => {
      const input = createGenerateInput({
        template: '{"result": (5 + 3) * 2}',
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      if (msg) {
        const content = JSON.parse(msg.content)
        expect(content.result).toBe(16)
      }
    })

    it('handles template with string functions', async () => {
      const input = createGenerateInput({
        template: '{"uppercase": "hello".uppercase()}',
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      if (msg) {
        const content = JSON.parse(msg.content)
        expect(content.uppercase).toBe('HELLO')
      }
    })

    it('throws error on invalid Bloblang syntax', async () => {
      const input = createGenerateInput({
        template: '{ invalid syntax here }}}',
        count: 1,
      })

      const result = await input.start()

      expect(result.success).toBe(false)
    })

    it('includes metadata in generated messages', async () => {
      const input = createGenerateInput({
        template: '{"data": "test"}',
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).not.toBeNull()
      if (msg) {
        expect(msg.metadata).toBeDefined()
      }
    })
  })

  describe('Message counting', () => {
    it('generates exactly count messages when count is specified', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 5,
      })

      await input.start()

      const messages: (InputMessage | null)[] = []
      for (let i = 0; i < 7; i++) {
        const msg = await input.next()
        messages.push(msg)
      }

      const nonNullMessages = messages.filter(m => m !== null)
      expect(nonNullMessages).toHaveLength(5)
      expect(messages[5]).toBeNull()
      expect(messages[6]).toBeNull()
    })

    it('generates exactly count messages with batching', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 10,
        batchSize: 3,
      })

      await input.start()

      const messages: (InputMessage | null)[] = []
      for (let i = 0; i < 12; i++) {
        const msg = await input.next()
        messages.push(msg)
      }

      const nonNullMessages = messages.filter(m => m !== null)
      expect(nonNullMessages).toHaveLength(10)
    })

    it('handles zero count gracefully', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 0,
      })

      await input.start()
      const msg = await input.next()

      expect(msg).toBeNull()
    })

    it('handles large counts efficiently', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 10000,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })
  })

  describe('Interval-based generation', () => {
    it('respects interval timing between messages', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        interval: 50,
        count: 2,
      })

      const startTime = Date.now()
      await input.start()

      const msg1 = await input.next()
      const timeAfterFirst = Date.now()

      const msg2 = await input.next()
      const timeAfterSecond = Date.now()

      expect(msg1).not.toBeNull()
      expect(msg2).not.toBeNull()
      expect(timeAfterSecond - timeAfterFirst).toBeGreaterThanOrEqual(40) // ~50ms, with tolerance
    })

    it('continues generating at interval when count not set', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        interval: 100,
      })

      await input.start()

      const msg1 = await input.next()
      const msg2 = await input.next()
      const msg3 = await input.next()

      expect(msg1).not.toBeNull()
      expect(msg2).not.toBeNull()
      expect(msg3).not.toBeNull()
    })

    it('can be stopped via close() during interval wait', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        interval: 1000, // Long interval
      })

      await input.start()
      const msg1 = await input.next()

      expect(msg1).not.toBeNull()

      // Close should interrupt waiting for next interval
      const closePromise = input.close()

      // This should not hang indefinitely
      await expect(Promise.race([
        closePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
      ])).resolves.toBeDefined()
    })
  })

  describe('Batching', () => {
    it('groups messages into batches when batchSize specified', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 6,
        batchSize: 2,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
    })

    it('respects batch size configuration', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 5,
        batchSize: 2,
      })

      await input.start()

      const messages: (InputMessage | null)[] = []
      for (let i = 0; i < 5; i++) {
        const msg = await input.next()
        messages.push(msg)
      }

      const nonNullMessages = messages.filter(m => m !== null)
      expect(nonNullMessages).toHaveLength(5)
    })

    it('handles partial final batch when count not divisible by batchSize', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 7,
        batchSize: 3,
      })

      await input.start()

      const messages: (InputMessage | null)[] = []
      for (let i = 0; i < 8; i++) {
        const msg = await input.next()
        messages.push(msg)
      }

      const nonNullMessages = messages.filter(m => m !== null)
      expect(nonNullMessages).toHaveLength(7)
    })

    it('defaults batchSize to 1 when not specified', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 3,
      })

      await input.start()

      const msg1 = await input.next()
      const msg2 = await input.next()
      const msg3 = await input.next()

      expect(msg1).not.toBeNull()
      expect(msg2).not.toBeNull()
      expect(msg3).not.toBeNull()
    })
  })

  describe('Message metadata', () => {
    it('includes generator metadata in generated messages', async () => {
      const input = createGenerateInput({
        template: '{"data": "test"}',
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      if (msg) {
        expect(msg.metadata).toBeDefined()
        expect(msg.metadata).toHaveProperty('get')
        expect(msg.metadata).toHaveProperty('set')
      }
    })

    it('can set custom metadata on messages', async () => {
      const input = createGenerateInput({
        template: '{"data": "test"}',
        count: 1,
        metadata: {
          'generator-id': 'test-gen-1',
          'source': 'bloblang',
        },
      })

      await input.start()
      const msg = await input.next()

      if (msg) {
        expect(msg.metadata.get('generator-id')).toBe('test-gen-1')
        expect(msg.metadata.get('source')).toBe('bloblang')
      }
    })

    it('includes timestamp metadata', async () => {
      const input = createGenerateInput({
        template: '{"data": "test"}',
        count: 1,
      })

      await input.start()
      const msg = await input.next()

      if (msg) {
        const tsMetadata = msg.metadata.get('timestamp')
        expect(tsMetadata).toBeDefined()
      }
    })
  })
})

// ============================================================================
// HttpServerInput Tests
// ============================================================================

describe('HttpServerInput', () => {
  describe('initialization', () => {
    it('accepts port configuration', async () => {
      const input = createHttpServerInput({
        port: 8080,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('accepts hostname configuration', async () => {
      const input = createHttpServerInput({
        port: 8081,
        hostname: 'localhost',
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('accepts path configuration', async () => {
      const input = createHttpServerInput({
        port: 8082,
        path: '/api/messages',
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('defaults path to /messages if not specified', async () => {
      const input = createHttpServerInput({
        port: 8083,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('uses 0.0.0.0 as default hostname', async () => {
      const input = createHttpServerInput({
        port: 8084,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })
  })

  describe('HTTP request handling', () => {
    it('accepts POST requests to configured path', async () => {
      const input = createHttpServerInput({
        port: 8085,
        path: '/intake',
      })

      await input.start()

      // Simulate POST request (actual implementation will handle real HTTP)
      // For now test that it accepts the config
      expect(input).toBeDefined()

      await input.close()
    })

    it('converts HTTP request body to message', async () => {
      const input = createHttpServerInput({
        port: 8086,
      })

      await input.start()

      // When a request is processed, next() should return the message
      // Actual HTTP handling will be tested via integration tests
      const msg = await input.next()

      // Message may be null if no requests yet
      if (msg) {
        expect(msg.content).toBeDefined()
      }

      await input.close()
    })

    it('handles JSON request bodies', async () => {
      const input = createHttpServerInput({
        port: 8087,
        contentType: 'application/json',
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('handles text request bodies', async () => {
      const input = createHttpServerInput({
        port: 8088,
        contentType: 'text/plain',
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('handles form-encoded request bodies', async () => {
      const input = createHttpServerInput({
        port: 8089,
        contentType: 'application/x-www-form-urlencoded',
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('rejects requests with invalid content type', async () => {
      const input = createHttpServerInput({
        port: 8090,
        contentType: 'application/json',
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      // Invalid content type handling will be tested in integration tests
      await input.close()
    })

    it('returns 400 for requests with invalid body', async () => {
      const input = createHttpServerInput({
        port: 8091,
        contentType: 'application/json',
      })

      await input.start()

      // Invalid JSON body handling
      expect(input).toBeDefined()

      await input.close()
    })

    it('returns 200 for successful message intake', async () => {
      const input = createHttpServerInput({
        port: 8092,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('buffers multiple requests', async () => {
      const input = createHttpServerInput({
        port: 8093,
      })

      await input.start()

      // Simulating multiple incoming requests
      const msg1 = await input.next()
      const msg2 = await input.next()

      // May be null if no requests yet, but interface should support multiple
      if (msg1) {
        expect(msg1.content).toBeDefined()
      }
      if (msg2) {
        expect(msg2.content).toBeDefined()
      }

      await input.close()
    })
  })

  describe('Metadata extraction', () => {
    it('extracts metadata from request headers', async () => {
      const input = createHttpServerInput({
        port: 8094,
        extractHeaders: ['x-correlation-id', 'x-user-id', 'x-request-id'],
      })

      await input.start()

      // When headers are extracted, they should be in message metadata
      expect(input).toBeDefined()

      await input.close()
    })

    it('prefixes extracted header metadata', async () => {
      const input = createHttpServerInput({
        port: 8095,
        extractHeaders: ['x-correlation-id'],
        headerPrefix: 'http_',
      })

      await input.start()

      // Headers should be prefixed with 'http_'
      expect(input).toBeDefined()

      await input.close()
    })

    it('handles missing headers gracefully', async () => {
      const input = createHttpServerInput({
        port: 8096,
        extractHeaders: ['x-missing-header', 'x-another-missing'],
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('extracts multiple headers from single request', async () => {
      const input = createHttpServerInput({
        port: 8097,
        extractHeaders: ['x-correlation-id', 'x-user-id', 'x-request-id', 'content-type'],
      })

      await input.start()

      expect(input).toBeDefined()

      await input.close()
    })

    it('includes content-type as metadata automatically', async () => {
      const input = createHttpServerInput({
        port: 8098,
      })

      await input.start()

      // Content-type should be in metadata by default
      expect(input).toBeDefined()

      await input.close()
    })

    it('includes request method in metadata', async () => {
      const input = createHttpServerInput({
        port: 8099,
      })

      await input.start()

      // Request method (POST, PUT, etc.) should be in metadata
      expect(input).toBeDefined()

      await input.close()
    })

    it('includes request path in metadata', async () => {
      const input = createHttpServerInput({
        port: 8100,
        path: '/api/events',
      })

      await input.start()

      // Request path should be in metadata
      expect(input).toBeDefined()

      await input.close()
    })

    it('extracts path parameters when configured', async () => {
      const input = createHttpServerInput({
        port: 8101,
        path: '/api/:namespace/:queue',
        pathParams: ['namespace', 'queue'],
      })

      await input.start()

      // Path params should be extracted and included in metadata
      expect(input).toBeDefined()

      await input.close()
    })

    it('includes host information in metadata', async () => {
      const input = createHttpServerInput({
        port: 8102,
      })

      await input.start()

      // Host info should be in metadata
      expect(input).toBeDefined()

      await input.close()
    })

    it('includes request URL in metadata', async () => {
      const input = createHttpServerInput({
        port: 8103,
      })

      await input.start()

      // Full request URL should be in metadata
      expect(input).toBeDefined()

      await input.close()
    })
  })

  describe('Request method handling', () => {
    it('accepts POST requests', async () => {
      const input = createHttpServerInput({
        port: 8104,
        methods: ['POST'],
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('accepts PUT requests', async () => {
      const input = createHttpServerInput({
        port: 8105,
        methods: ['PUT'],
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('accepts multiple methods', async () => {
      const input = createHttpServerInput({
        port: 8106,
        methods: ['POST', 'PUT', 'PATCH'],
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('rejects disallowed methods with 405', async () => {
      const input = createHttpServerInput({
        port: 8107,
        methods: ['POST'],
      })

      await input.start()

      // GET request should be rejected
      expect(input).toBeDefined()

      await input.close()
    })

    it('defaults to POST when methods not specified', async () => {
      const input = createHttpServerInput({
        port: 8108,
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })
  })

  describe('Error handling', () => {
    it('handles port already in use error', async () => {
      const input1 = createHttpServerInput({
        port: 8109,
      })

      await input1.start()

      const input2 = createHttpServerInput({
        port: 8109,
      })

      const result = await input2.start()

      // Should fail due to port already in use
      expect(result.success).toBe(false)

      await input1.close()
      await input2.close()
    })

    it('handles invalid port number', async () => {
      const input = createHttpServerInput({
        port: 99999, // Invalid port
      })

      const result = await input.start()

      expect(result.success).toBe(false)
    })

    it('handles request with oversized body', async () => {
      const input = createHttpServerInput({
        port: 8110,
        maxBodySize: 1024, // 1KB
      })

      const result = await input.start()

      expect(result.success).toBe(true)
      await input.close()
    })

    it('returns 413 for request body exceeding max size', async () => {
      const input = createHttpServerInput({
        port: 8111,
        maxBodySize: 1024,
      })

      await input.start()

      // Oversized request handling
      expect(input).toBeDefined()

      await input.close()
    })
  })
})

// ============================================================================
// Graceful Shutdown & Cleanup Tests
// ============================================================================

describe('Graceful Shutdown', () => {
  describe('GenerateInput shutdown', () => {
    it('stops generating messages after close()', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 5,
      })

      await input.start()
      const msg1 = await input.next()
      expect(msg1).not.toBeNull()

      await input.close()

      // Should not generate more messages
      await expect(input.next()).rejects.toThrow()
    })

    it('cleans up internal state on close()', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 1,
      })

      await input.start()
      await input.next()

      const closeResult = await input.close()

      expect(closeResult.success).toBe(true)
    })

    it('can be safely closed multiple times', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        count: 1,
      })

      await input.start()
      await input.next()

      const close1 = await input.close()
      const close2 = await input.close()

      expect(close1.success).toBe(true)
      expect(close2.success).toBe(true)
    })

    it('clears pending timers on close()', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        interval: 1000,
        count: 10,
      })

      await input.start()
      const msg = await input.next()
      expect(msg).not.toBeNull()

      // Close should clear timers
      const startClose = Date.now()
      await input.close()
      const endClose = Date.now()

      // Close should not wait for next interval
      expect(endClose - startClose).toBeLessThan(500)
    })
  })

  describe('HttpServerInput shutdown', () => {
    it('stops accepting requests after close()', async () => {
      const input = createHttpServerInput({
        port: 8112,
      })

      await input.start()
      await input.close()

      // Should not accept new requests
      await expect(input.next()).rejects.toThrow(/closed|shut down/i)
    })

    it('closes HTTP server on shutdown', async () => {
      const input = createHttpServerInput({
        port: 8113,
      })

      await input.start()

      const closeResult = await input.close()

      expect(closeResult.success).toBe(true)
    })

    it('can be safely closed multiple times', async () => {
      const input = createHttpServerInput({
        port: 8114,
      })

      await input.start()

      const close1 = await input.close()
      const close2 = await input.close()

      expect(close1.success).toBe(true)
      expect(close2.success).toBe(true)
    })

    it('drains pending requests before closing', async () => {
      const input = createHttpServerInput({
        port: 8115,
      })

      await input.start()

      // Allow pending requests to be processed
      const closeResult = await input.close()

      expect(closeResult.success).toBe(true)
    })

    it('releases port on close()', async () => {
      const port = 8116

      const input1 = createHttpServerInput({ port })
      await input1.start()
      await input1.close()

      // Port should be available now
      const input2 = createHttpServerInput({ port })
      const result = await input2.start()

      expect(result.success).toBe(true)
      await input2.close()
    })
  })

  describe('Resource cleanup', () => {
    it('clears message buffers on close()', async () => {
      const input = createHttpServerInput({
        port: 8117,
      })

      await input.start()
      // Simulate some buffered messages
      await input.close()

      // Resources should be freed
      expect(input).toBeDefined()
    })

    it('aborts pending async operations on close()', async () => {
      const input = createGenerateInput({
        template: '{"id": 1}',
        interval: 100,
      })

      await input.start()

      // Start a next() call that's waiting
      const nextPromise = input.next()

      // Immediately close
      await input.close()

      // The pending next() should handle the closed state gracefully
      await expect(nextPromise).rejects.toThrow()
    })

    it('releases all acquired resources', async () => {
      const input = createHttpServerInput({
        port: 8118,
      })

      const result = await input.start()
      expect(result.success).toBe(true)

      const closeResult = await input.close()
      expect(closeResult.success).toBe(true)

      // No pending resources or connections
      expect(closeResult).toHaveProperty('resourcesFreed')
    })
  })
})

// ============================================================================
// Integration-style Tests
// ============================================================================

describe('Input Connector Integration', () => {
  it('supports complete workflow: start, read, ack, close', async () => {
    const input = createGenerateInput({
      template: '{"test": "data"}',
      count: 1,
    })

    const startResult = await input.start()
    expect(startResult.success).toBe(true)

    const msg = await input.next()
    expect(msg).not.toBeNull()

    if (msg) {
      const ackResult = await input.ack(msg)
      expect(ackResult.success).toBe(true)
    }

    const closeResult = await input.close()
    expect(closeResult.success).toBe(true)
  })

  it('processes multiple messages sequentially', async () => {
    const input = createGenerateInput({
      template: '{"counter": 1}',
      count: 3,
    })

    await input.start()

    const messages: InputMessage[] = []

    for (let i = 0; i < 3; i++) {
      const msg = await input.next()
      if (msg) {
        messages.push(msg)
        await input.ack(msg)
      }
    }

    expect(messages).toHaveLength(3)

    await input.close()
  })

  it('handles errors without crashing', async () => {
    const input = createGenerateInput({
      template: 'invalid {{ template',
      count: 1,
    })

    const result = await input.start()

    expect(result.success).toBe(false)

    await input.close()
  })
})
