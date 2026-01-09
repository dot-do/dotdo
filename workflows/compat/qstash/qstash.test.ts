/**
 * QStash Compat Layer Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client, Receiver } from './index'

describe('QStash Compat Layer', () => {
  let client: Client

  beforeEach(() => {
    client = new Client({ token: 'test-token' })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Client', () => {
    describe('publish', () => {
      it('should publish a message and return messageId', async () => {
        const result = await client.publish({
          url: 'https://example.com/webhook',
          body: 'test message',
        })

        expect(result.messageId).toBeDefined()
        expect(result.messageId).toMatch(/^msg_/)
        expect(result.url).toBe('https://example.com/webhook')
        expect(result.deduplicated).toBe(false)
      })

      it('should handle JSON body', async () => {
        const result = await client.publish({
          url: 'https://example.com/webhook',
          body: { hello: 'world' },
        })

        expect(result.messageId).toBeDefined()
      })

      it('should support delay option', async () => {
        const result = await client.publish({
          url: 'https://example.com/webhook',
          body: 'delayed message',
          delay: '5m',
        })

        expect(result.messageId).toBeDefined()
      })

      it('should support numeric delay (ms)', async () => {
        const result = await client.publish({
          url: 'https://example.com/webhook',
          body: 'delayed message',
          delay: 5000,
        })

        expect(result.messageId).toBeDefined()
      })
    })

    describe('publishJSON', () => {
      it('should publish JSON with content-type header', async () => {
        const result = await client.publishJSON({
          url: 'https://example.com/webhook',
          body: { user: 'test', action: 'signup' },
        })

        expect(result.messageId).toBeDefined()
      })
    })

    describe('batch', () => {
      it('should publish multiple messages', async () => {
        const result = await client.batch([
          { url: 'https://example.com/webhook1', body: 'message 1' },
          { url: 'https://example.com/webhook2', body: 'message 2' },
          { url: 'https://example.com/webhook3', body: 'message 3' },
        ])

        expect(result.responses).toHaveLength(3)
        expect(result.responses[0].messageId).toBeDefined()
        expect(result.responses[1].messageId).toBeDefined()
        expect(result.responses[2].messageId).toBeDefined()
      })
    })

    describe('deduplication', () => {
      it('should deduplicate by deduplicationId', async () => {
        const result1 = await client.publish({
          url: 'https://example.com/webhook',
          body: 'message',
          deduplicationId: 'unique-id',
        })

        const result2 = await client.publish({
          url: 'https://example.com/webhook',
          body: 'message',
          deduplicationId: 'unique-id',
        })

        expect(result1.deduplicated).toBe(false)
        expect(result2.deduplicated).toBe(true)
        expect(result2.messageId).toBe(result1.messageId)
      })

      it('should deduplicate by content when contentBasedDeduplication is true', async () => {
        const result1 = await client.publish({
          url: 'https://example.com/webhook',
          body: 'same content',
          contentBasedDeduplication: true,
        })

        const result2 = await client.publish({
          url: 'https://example.com/webhook',
          body: 'same content',
          contentBasedDeduplication: true,
        })

        expect(result2.deduplicated).toBe(true)
      })
    })

    describe('enqueue', () => {
      it('should be an alias for publish', async () => {
        const result = await client.enqueue({
          url: 'https://example.com/webhook',
          body: 'test',
        })

        expect(result.messageId).toBeDefined()
      })
    })
  })

  describe('Schedules', () => {
    describe('create', () => {
      it('should create a schedule', async () => {
        const result = await client.schedules.create({
          destination: 'https://example.com/webhook',
          cron: '0 9 * * MON',
        })

        expect(result.scheduleId).toBeDefined()
        expect(result.scheduleId).toMatch(/^sched_/)
      })

      it('should create a schedule with custom ID', async () => {
        const result = await client.schedules.create({
          destination: 'https://example.com/webhook',
          cron: '0 9 * * MON',
          scheduleId: 'my-custom-schedule',
        })

        expect(result.scheduleId).toBe('my-custom-schedule')
      })
    })

    describe('get', () => {
      it('should retrieve a schedule by ID', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com/webhook',
          cron: '0 9 * * MON',
        })

        const schedule = await client.schedules.get(scheduleId)

        expect(schedule).toBeDefined()
        expect(schedule?.scheduleId).toBe(scheduleId)
        expect(schedule?.cron).toBe('0 9 * * MON')
        expect(schedule?.destination).toBe('https://example.com/webhook')
      })

      it('should return null for non-existent schedule', async () => {
        const schedule = await client.schedules.get('non-existent')
        expect(schedule).toBeNull()
      })
    })

    describe('list', () => {
      it('should list all schedules', async () => {
        await client.schedules.create({
          destination: 'https://example.com/webhook1',
          cron: '0 9 * * MON',
        })

        await client.schedules.create({
          destination: 'https://example.com/webhook2',
          cron: '0 10 * * MON',
        })

        const schedules = await client.schedules.list()

        expect(schedules.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('delete', () => {
      it('should delete a schedule', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com/webhook',
          cron: '0 9 * * MON',
        })

        await client.schedules.delete(scheduleId)

        const schedule = await client.schedules.get(scheduleId)
        expect(schedule).toBeNull()
      })
    })

    describe('pause/resume', () => {
      it('should pause a schedule', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com/webhook',
          cron: '0 9 * * MON',
        })

        await client.schedules.pause(scheduleId)

        const schedule = await client.schedules.get(scheduleId)
        expect(schedule?.isPaused).toBe(true)
      })

      it('should resume a paused schedule', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com/webhook',
          cron: '0 9 * * MON',
        })

        await client.schedules.pause(scheduleId)
        await client.schedules.resume(scheduleId)

        const schedule = await client.schedules.get(scheduleId)
        expect(schedule?.isPaused).toBe(false)
      })
    })
  })

  describe('Receiver', () => {
    describe('verify', () => {
      it('should verify valid signature', async () => {
        const receiver = new Receiver({
          currentSigningKey: 'test-key',
          nextSigningKey: 'next-key',
        })

        // Create a valid signature
        const timestamp = Math.floor(Date.now() / 1000)
        const body = '{"test": "data"}'
        const payload = `${timestamp}.${body}`

        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

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

      it('should reject invalid signature', async () => {
        const receiver = new Receiver({
          currentSigningKey: 'test-key',
          nextSigningKey: 'next-key',
        })

        const isValid = await receiver.verify({
          signature: 't=12345,v1=invalid',
          body: '{"test": "data"}',
        })

        expect(isValid).toBe(false)
      })

      it('should reject malformed signature', async () => {
        const receiver = new Receiver({
          currentSigningKey: 'test-key',
          nextSigningKey: 'next-key',
        })

        const isValid = await receiver.verify({
          signature: 'malformed-signature',
          body: '{"test": "data"}',
        })

        expect(isValid).toBe(false)
      })
    })
  })
})
