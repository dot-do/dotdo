/**
 * QStash Compat Layer Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client, Receiver, URLGroups, DLQ, Topics, Events } from './index'

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
          url: 'https://example.com.ai/webhook',
          body: 'test message',
        })

        expect(result.messageId).toBeDefined()
        expect(result.messageId).toMatch(/^msg_/)
        expect(result.url).toBe('https://example.com.ai/webhook')
        expect(result.deduplicated).toBe(false)
      })

      it('should handle JSON body', async () => {
        const result = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { hello: 'world' },
        })

        expect(result.messageId).toBeDefined()
      })

      it('should support delay option', async () => {
        const result = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: 'delayed message',
          delay: '5m',
        })

        expect(result.messageId).toBeDefined()
      })

      it('should support numeric delay (ms)', async () => {
        const result = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: 'delayed message',
          delay: 5000,
        })

        expect(result.messageId).toBeDefined()
      })
    })

    describe('publishJSON', () => {
      it('should publish JSON with content-type header', async () => {
        const result = await client.publishJSON({
          url: 'https://example.com.ai/webhook',
          body: { user: 'test', action: 'signup' },
        })

        expect(result.messageId).toBeDefined()
      })
    })

    describe('batch', () => {
      it('should publish multiple messages', async () => {
        const result = await client.batch([
          { url: 'https://example.com.ai/webhook1', body: 'message 1' },
          { url: 'https://example.com.ai/webhook2', body: 'message 2' },
          { url: 'https://example.com.ai/webhook3', body: 'message 3' },
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
          url: 'https://example.com.ai/webhook',
          body: 'message',
          deduplicationId: 'unique-id',
        })

        const result2 = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: 'message',
          deduplicationId: 'unique-id',
        })

        expect(result1.deduplicated).toBe(false)
        expect(result2.deduplicated).toBe(true)
        expect(result2.messageId).toBe(result1.messageId)
      })

      it('should deduplicate by content when contentBasedDeduplication is true', async () => {
        const result1 = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: 'same content',
          contentBasedDeduplication: true,
        })

        const result2 = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: 'same content',
          contentBasedDeduplication: true,
        })

        expect(result2.deduplicated).toBe(true)
      })
    })

    describe('enqueue', () => {
      it('should be an alias for publish', async () => {
        const result = await client.enqueue({
          url: 'https://example.com.ai/webhook',
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
          destination: 'https://example.com.ai/webhook',
          cron: '0 9 * * MON',
        })

        expect(result.scheduleId).toBeDefined()
        expect(result.scheduleId).toMatch(/^sched_/)
      })

      it('should create a schedule with custom ID', async () => {
        const result = await client.schedules.create({
          destination: 'https://example.com.ai/webhook',
          cron: '0 9 * * MON',
          scheduleId: 'my-custom-schedule',
        })

        expect(result.scheduleId).toBe('my-custom-schedule')
      })
    })

    describe('get', () => {
      it('should retrieve a schedule by ID', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com.ai/webhook',
          cron: '0 9 * * MON',
        })

        const schedule = await client.schedules.get(scheduleId)

        expect(schedule).toBeDefined()
        expect(schedule?.scheduleId).toBe(scheduleId)
        expect(schedule?.cron).toBe('0 9 * * MON')
        expect(schedule?.destination).toBe('https://example.com.ai/webhook')
      })

      it('should return null for non-existent schedule', async () => {
        const schedule = await client.schedules.get('non-existent')
        expect(schedule).toBeNull()
      })
    })

    describe('list', () => {
      it('should list all schedules', async () => {
        await client.schedules.create({
          destination: 'https://example.com.ai/webhook1',
          cron: '0 9 * * MON',
        })

        await client.schedules.create({
          destination: 'https://example.com.ai/webhook2',
          cron: '0 10 * * MON',
        })

        const schedules = await client.schedules.list()

        expect(schedules.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('delete', () => {
      it('should delete a schedule', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com.ai/webhook',
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
          destination: 'https://example.com.ai/webhook',
          cron: '0 9 * * MON',
        })

        await client.schedules.pause(scheduleId)

        const schedule = await client.schedules.get(scheduleId)
        expect(schedule?.isPaused).toBe(true)
      })

      it('should resume a paused schedule', async () => {
        const { scheduleId } = await client.schedules.create({
          destination: 'https://example.com.ai/webhook',
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

  // ===========================================================================
  // URL GROUPS - Fan-out to multiple endpoints
  // ===========================================================================
  describe('URL Groups', () => {
    describe('create', () => {
      it('should create URL group with multiple endpoints', async () => {
        const result = await client.urlGroups.create({
          name: 'my-webhook-group',
          endpoints: [
            { url: 'https://example.com.ai/webhook1' },
            { url: 'https://example.com.ai/webhook2' },
            { url: 'https://example.com.ai/webhook3' },
          ],
        })

        expect(result.name).toBe('my-webhook-group')
        expect(result.endpoints).toHaveLength(3)
      })

      it('should create URL group with empty endpoints', async () => {
        const result = await client.urlGroups.create({
          name: 'empty-group',
          endpoints: [],
        })

        expect(result.name).toBe('empty-group')
        expect(result.endpoints).toHaveLength(0)
      })
    })

    describe('get', () => {
      it('should retrieve URL group by name', async () => {
        await client.urlGroups.create({
          name: 'test-group',
          endpoints: [{ url: 'https://example.com.ai/webhook' }],
        })

        const group = await client.urlGroups.get('test-group')

        expect(group).toBeDefined()
        expect(group?.name).toBe('test-group')
        expect(group?.endpoints).toHaveLength(1)
      })

      it('should return null for non-existent group', async () => {
        const group = await client.urlGroups.get('non-existent')
        expect(group).toBeNull()
      })
    })

    describe('list', () => {
      it('should list all URL groups', async () => {
        await client.urlGroups.create({
          name: 'group-1',
          endpoints: [{ url: 'https://example.com.ai/webhook1' }],
        })

        await client.urlGroups.create({
          name: 'group-2',
          endpoints: [{ url: 'https://example.com.ai/webhook2' }],
        })

        const groups = await client.urlGroups.list()

        expect(groups.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('delete', () => {
      it('should delete a URL group', async () => {
        await client.urlGroups.create({
          name: 'to-delete',
          endpoints: [{ url: 'https://example.com.ai/webhook' }],
        })

        await client.urlGroups.delete('to-delete')

        const group = await client.urlGroups.get('to-delete')
        expect(group).toBeNull()
      })
    })

    describe('addEndpoints', () => {
      it('should add endpoints to existing group', async () => {
        await client.urlGroups.create({
          name: 'expandable-group',
          endpoints: [{ url: 'https://example.com.ai/webhook1' }],
        })

        await client.urlGroups.addEndpoints('expandable-group', [
          { url: 'https://example.com.ai/webhook2' },
          { url: 'https://example.com.ai/webhook3' },
        ])

        const group = await client.urlGroups.get('expandable-group')
        expect(group?.endpoints).toHaveLength(3)
      })
    })

    describe('removeEndpoints', () => {
      it('should remove endpoints from existing group', async () => {
        await client.urlGroups.create({
          name: 'shrinkable-group',
          endpoints: [
            { url: 'https://example.com.ai/webhook1' },
            { url: 'https://example.com.ai/webhook2' },
            { url: 'https://example.com.ai/webhook3' },
          ],
        })

        await client.urlGroups.removeEndpoints('shrinkable-group', [
          { url: 'https://example.com.ai/webhook2' },
        ])

        const group = await client.urlGroups.get('shrinkable-group')
        expect(group?.endpoints).toHaveLength(2)
        expect(group?.endpoints.find((e) => e.url === 'https://example.com.ai/webhook2')).toBeUndefined()
      })
    })

    describe('fan-out publish', () => {
      it('should fan-out publish to all group endpoints', async () => {
        const fetchCalls: string[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
          fetchCalls.push(url as string)
          return new Response('OK', { status: 200 })
        })

        await client.urlGroups.create({
          name: 'fanout-group',
          endpoints: [
            { url: 'https://example.com.ai/webhook1' },
            { url: 'https://example.com.ai/webhook2' },
            { url: 'https://example.com.ai/webhook3' },
          ],
        })

        const result = await client.publish({
          urlGroup: 'fanout-group',
          body: { event: 'test' },
        })

        // Advance timers to allow async fetch calls
        await vi.runAllTimersAsync()

        expect(result.messageId).toBeDefined()
        expect(result.urlGroup).toBe('fanout-group')
        // Should return individual delivery statuses
        expect(result.deliveries).toHaveLength(3)

        vi.restoreAllMocks()
      })

      it('should track individual endpoint delivery status', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
          if ((url as string).includes('webhook2')) {
            return new Response('Error', { status: 500 })
          }
          return new Response('OK', { status: 200 })
        })

        await client.urlGroups.create({
          name: 'mixed-group',
          endpoints: [
            { url: 'https://example.com.ai/webhook1' },
            { url: 'https://example.com.ai/webhook2' },
            { url: 'https://example.com.ai/webhook3' },
          ],
        })

        const result = await client.publish({
          urlGroup: 'mixed-group',
          body: { event: 'test' },
        })

        await vi.runAllTimersAsync()

        expect(result.deliveries).toHaveLength(3)
        const failedDelivery = result.deliveries?.find((d) => d.url === 'https://example.com.ai/webhook2')
        expect(failedDelivery?.status).toBe('failed')

        vi.restoreAllMocks()
      })
    })
  })

  // ===========================================================================
  // DEAD LETTER QUEUE - Failed message storage
  // ===========================================================================
  describe('DLQ', () => {
    describe('message flow', () => {
      it('should move failed messages to DLQ after max retries', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

        const result = await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'will-fail' },
          retries: 2,
        })

        // Wait for retries to exhaust
        await vi.runAllTimersAsync()

        const dlqMessages = await client.dlq.list()
        const dlqMessage = dlqMessages.find((m) => m.messageId === result.messageId)

        expect(dlqMessage).toBeDefined()
        expect(dlqMessage?.url).toBe('https://failing.example.com.ai/webhook')
        expect(dlqMessage?.failureReason).toContain('Connection refused')
        expect(dlqMessage?.attempts).toBe(3) // initial + 2 retries

        vi.restoreAllMocks()
      })
    })

    describe('list', () => {
      it('should list DLQ messages', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        await client.publish({
          url: 'https://failing1.example.com.ai/webhook',
          body: { event: 'fail1' },
          retries: 0,
        })

        await client.publish({
          url: 'https://failing2.example.com.ai/webhook',
          body: { event: 'fail2' },
          retries: 0,
        })

        await vi.runAllTimersAsync()

        const dlqMessages = await client.dlq.list()
        expect(dlqMessages.length).toBeGreaterThanOrEqual(2)

        vi.restoreAllMocks()
      })

      it('should list DLQ messages with pagination', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        // Create multiple failed messages
        for (let i = 0; i < 5; i++) {
          await client.publish({
            url: `https://failing${i}.example.com.ai/webhook`,
            body: { event: `fail${i}` },
            retries: 0,
          })
        }

        await vi.runAllTimersAsync()

        const page1 = await client.dlq.list({ limit: 2 })
        expect(page1.length).toBe(2)
        expect(page1[0].cursor).toBeDefined()

        const page2 = await client.dlq.list({ limit: 2, cursor: page1[1].cursor })
        expect(page2.length).toBe(2)

        vi.restoreAllMocks()
      })
    })

    describe('get', () => {
      it('should get a specific DLQ message', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        const result = await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'fail' },
          retries: 0,
        })

        await vi.runAllTimersAsync()

        const dlqMessage = await client.dlq.get(result.messageId)
        expect(dlqMessage).toBeDefined()
        expect(dlqMessage?.messageId).toBe(result.messageId)

        vi.restoreAllMocks()
      })

      it('should return null for non-existent DLQ message', async () => {
        const dlqMessage = await client.dlq.get('non-existent')
        expect(dlqMessage).toBeNull()
      })
    })

    describe('replay', () => {
      it('should replay DLQ message', async () => {
        let attempts = 0
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
          attempts++
          if (attempts <= 1) {
            throw new Error('Timeout')
          }
          return new Response('OK', { status: 200 })
        })

        const result = await client.publish({
          url: 'https://flaky.example.com.ai/webhook',
          body: { event: 'flaky' },
          retries: 0,
        })

        await vi.runAllTimersAsync()

        // Message should be in DLQ
        let dlqMessage = await client.dlq.get(result.messageId)
        expect(dlqMessage).toBeDefined()

        // Replay the message
        const replayResult = await client.dlq.replay(result.messageId)
        expect(replayResult.success).toBe(true)
        expect(replayResult.newMessageId).toBeDefined()

        await vi.runAllTimersAsync()

        // Message should be removed from DLQ after successful replay
        dlqMessage = await client.dlq.get(result.messageId)
        expect(dlqMessage).toBeNull()

        vi.restoreAllMocks()
      })

      it('should replay DLQ message to different URL', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
          if ((url as string).includes('failing')) {
            throw new Error('Still failing')
          }
          return new Response('OK', { status: 200 })
        })

        const result = await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'fail' },
          retries: 0,
        })

        await vi.runAllTimersAsync()

        const replayResult = await client.dlq.replay(result.messageId, {
          url: 'https://working.example.com.ai/webhook',
        })

        await vi.runAllTimersAsync()

        expect(replayResult.success).toBe(true)
        expect(replayResult.url).toBe('https://working.example.com.ai/webhook')

        vi.restoreAllMocks()
      })
    })

    describe('delete', () => {
      it('should delete DLQ message', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        const result = await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'fail' },
          retries: 0,
        })

        await vi.runAllTimersAsync()

        // Delete from DLQ
        await client.dlq.delete(result.messageId)

        const dlqMessage = await client.dlq.get(result.messageId)
        expect(dlqMessage).toBeNull()

        vi.restoreAllMocks()
      })

      it('should bulk delete DLQ messages', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        const messageIds: string[] = []
        for (let i = 0; i < 3; i++) {
          const result = await client.publish({
            url: `https://failing${i}.example.com.ai/webhook`,
            body: { event: `fail${i}` },
            retries: 0,
          })
          messageIds.push(result.messageId)
        }

        await vi.runAllTimersAsync()

        await client.dlq.deleteMany(messageIds)

        for (const id of messageIds) {
          const dlqMessage = await client.dlq.get(id)
          expect(dlqMessage).toBeNull()
        }

        vi.restoreAllMocks()
      })
    })

    describe('purge', () => {
      it('should purge all DLQ messages', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        for (let i = 0; i < 3; i++) {
          await client.publish({
            url: `https://failing${i}.example.com.ai/webhook`,
            body: { event: `fail${i}` },
            retries: 0,
          })
        }

        await vi.runAllTimersAsync()

        let dlqMessages = await client.dlq.list()
        expect(dlqMessages.length).toBeGreaterThanOrEqual(3)

        await client.dlq.purge()

        dlqMessages = await client.dlq.list()
        expect(dlqMessages.length).toBe(0)

        vi.restoreAllMocks()
      })
    })
  })

  // ===========================================================================
  // CALLBACKS - Completion notifications
  // ===========================================================================
  describe('Callbacks', () => {
    describe('success callback', () => {
      it('should call callback URL on success', async () => {
        const callbackPayloads: unknown[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
          if ((url as string).includes('callback')) {
            callbackPayloads.push(JSON.parse(init?.body as string))
            return new Response('OK', { status: 200 })
          }
          return new Response('{"result": "success"}', { status: 200 })
        })

        await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { event: 'test' },
          callback: 'https://example.com.ai/callback',
        })

        await vi.runAllTimersAsync()

        expect(callbackPayloads.length).toBe(1)
        expect(callbackPayloads[0]).toMatchObject({
          status: 'success',
          statusCode: 200,
        })
        expect((callbackPayloads[0] as Record<string, unknown>).messageId).toBeDefined()

        vi.restoreAllMocks()
      })

      it('should include response in callback payload', async () => {
        const callbackPayloads: unknown[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
          if ((url as string).includes('callback')) {
            callbackPayloads.push(JSON.parse(init?.body as string))
            return new Response('OK', { status: 200 })
          }
          return new Response('{"result": "webhook response"}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        })

        await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { event: 'test' },
          callback: 'https://example.com.ai/callback',
        })

        await vi.runAllTimersAsync()

        const payload = callbackPayloads[0] as Record<string, unknown>
        expect(payload.response).toBeDefined()
        expect(payload.response).toMatchObject({
          body: '{"result": "webhook response"}',
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        })

        vi.restoreAllMocks()
      })
    })

    describe('failure callback', () => {
      it('should call failure callback on max retries', async () => {
        const failurePayloads: unknown[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
          if ((url as string).includes('failure-callback')) {
            failurePayloads.push(JSON.parse(init?.body as string))
            return new Response('OK', { status: 200 })
          }
          throw new Error('Connection refused')
        })

        await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'test' },
          failureCallback: 'https://example.com.ai/failure-callback',
          retries: 1,
        })

        await vi.runAllTimersAsync()

        expect(failurePayloads.length).toBe(1)
        expect(failurePayloads[0]).toMatchObject({
          status: 'failed',
          error: expect.stringContaining('Connection refused'),
        })
        expect((failurePayloads[0] as Record<string, unknown>).messageId).toBeDefined()
        expect((failurePayloads[0] as Record<string, unknown>).attempts).toBe(2) // initial + 1 retry

        vi.restoreAllMocks()
      })

      it('should include all attempt details in failure callback', async () => {
        const failurePayloads: unknown[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
          if ((url as string).includes('failure-callback')) {
            failurePayloads.push(JSON.parse(init?.body as string))
            return new Response('OK', { status: 200 })
          }
          throw new Error('Server error')
        })

        await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'test' },
          failureCallback: 'https://example.com.ai/failure-callback',
          retries: 2,
        })

        await vi.runAllTimersAsync()

        const payload = failurePayloads[0] as Record<string, unknown>
        expect(payload.attemptHistory).toBeDefined()
        expect((payload.attemptHistory as unknown[]).length).toBe(3)

        vi.restoreAllMocks()
      })
    })

    describe('callback with URL groups', () => {
      it('should call callback for each endpoint in URL group', async () => {
        const callbackPayloads: unknown[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
          if ((url as string).includes('callback')) {
            callbackPayloads.push(JSON.parse(init?.body as string))
            return new Response('OK', { status: 200 })
          }
          return new Response('OK', { status: 200 })
        })

        await client.urlGroups.create({
          name: 'callback-group',
          endpoints: [
            { url: 'https://example.com.ai/webhook1' },
            { url: 'https://example.com.ai/webhook2' },
          ],
        })

        await client.publish({
          urlGroup: 'callback-group',
          body: { event: 'test' },
          callback: 'https://example.com.ai/callback',
        })

        await vi.runAllTimersAsync()

        expect(callbackPayloads.length).toBe(2)
        const urls = callbackPayloads.map((p) => (p as Record<string, unknown>).destinationUrl)
        expect(urls).toContain('https://example.com.ai/webhook1')
        expect(urls).toContain('https://example.com.ai/webhook2')

        vi.restoreAllMocks()
      })
    })
  })

  // ===========================================================================
  // TOPICS - Pub/sub messaging
  // ===========================================================================
  describe('Topics', () => {
    describe('create', () => {
      it('should create a topic', async () => {
        const result = await client.topics.create({
          name: 'user-events',
        })

        expect(result.name).toBe('user-events')
        expect(result.topicId).toBeDefined()
      })
    })

    describe('get', () => {
      it('should get a topic by name', async () => {
        await client.topics.create({ name: 'orders' })

        const topic = await client.topics.get('orders')

        expect(topic).toBeDefined()
        expect(topic?.name).toBe('orders')
      })

      it('should return null for non-existent topic', async () => {
        const topic = await client.topics.get('non-existent')
        expect(topic).toBeNull()
      })
    })

    describe('list', () => {
      it('should list all topics', async () => {
        await client.topics.create({ name: 'topic-1' })
        await client.topics.create({ name: 'topic-2' })

        const topics = await client.topics.list()

        expect(topics.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('delete', () => {
      it('should delete a topic', async () => {
        await client.topics.create({ name: 'to-delete' })

        await client.topics.delete('to-delete')

        const topic = await client.topics.get('to-delete')
        expect(topic).toBeNull()
      })
    })

    describe('subscribe', () => {
      it('should subscribe URL to topic', async () => {
        await client.topics.create({ name: 'notifications' })

        const subscription = await client.topics.subscribe('notifications', {
          url: 'https://example.com.ai/webhook',
        })

        expect(subscription.subscriptionId).toBeDefined()
        expect(subscription.topicName).toBe('notifications')
        expect(subscription.url).toBe('https://example.com.ai/webhook')
      })

      it('should subscribe URL group to topic', async () => {
        await client.topics.create({ name: 'alerts' })
        await client.urlGroups.create({
          name: 'alert-handlers',
          endpoints: [{ url: 'https://example.com.ai/webhook1' }],
        })

        const subscription = await client.topics.subscribe('alerts', {
          urlGroup: 'alert-handlers',
        })

        expect(subscription.subscriptionId).toBeDefined()
        expect(subscription.urlGroup).toBe('alert-handlers')
      })
    })

    describe('unsubscribe', () => {
      it('should unsubscribe from topic', async () => {
        await client.topics.create({ name: 'events' })
        const subscription = await client.topics.subscribe('events', {
          url: 'https://example.com.ai/webhook',
        })

        await client.topics.unsubscribe(subscription.subscriptionId)

        const subscriptions = await client.topics.listSubscriptions('events')
        expect(subscriptions.find((s) => s.subscriptionId === subscription.subscriptionId)).toBeUndefined()
      })
    })

    describe('listSubscriptions', () => {
      it('should list all subscriptions for a topic', async () => {
        await client.topics.create({ name: 'multi-sub' })

        await client.topics.subscribe('multi-sub', {
          url: 'https://example.com.ai/webhook1',
        })
        await client.topics.subscribe('multi-sub', {
          url: 'https://example.com.ai/webhook2',
        })

        const subscriptions = await client.topics.listSubscriptions('multi-sub')

        expect(subscriptions.length).toBe(2)
      })
    })

    describe('publish to topic', () => {
      it('should publish to topic and deliver to all subscribers', async () => {
        const deliveredUrls: string[] = []
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
          if (!(url as string).includes('qstash')) {
            deliveredUrls.push(url as string)
          }
          return new Response('OK', { status: 200 })
        })

        await client.topics.create({ name: 'broadcast' })
        await client.topics.subscribe('broadcast', {
          url: 'https://example.com.ai/webhook1',
        })
        await client.topics.subscribe('broadcast', {
          url: 'https://example.com.ai/webhook2',
        })

        const result = await client.publish({
          topic: 'broadcast',
          body: { message: 'hello' },
        })

        await vi.runAllTimersAsync()

        expect(result.messageId).toBeDefined()
        expect(result.topic).toBe('broadcast')
        expect(deliveredUrls).toContain('https://example.com.ai/webhook1')
        expect(deliveredUrls).toContain('https://example.com.ai/webhook2')

        vi.restoreAllMocks()
      })
    })
  })

  // ===========================================================================
  // EVENTS API - Event streaming
  // ===========================================================================
  describe('Events', () => {
    describe('list', () => {
      it('should list recent events', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 200 }))

        // Publish some messages to generate events
        await client.publish({
          url: 'https://example.com.ai/webhook1',
          body: { event: 'test1' },
        })
        await client.publish({
          url: 'https://example.com.ai/webhook2',
          body: { event: 'test2' },
        })

        await vi.runAllTimersAsync()

        const events = await client.events.list()

        expect(events.length).toBeGreaterThanOrEqual(2)
        expect(events[0].type).toBeDefined()
        expect(events[0].timestamp).toBeDefined()

        vi.restoreAllMocks()
      })

      it('should filter events by type', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 200 }))

        await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { event: 'test' },
        })

        await vi.runAllTimersAsync()

        const deliveredEvents = await client.events.list({ type: 'delivered' })
        const createdEvents = await client.events.list({ type: 'created' })

        expect(deliveredEvents.every((e) => e.type === 'delivered')).toBe(true)
        expect(createdEvents.every((e) => e.type === 'created')).toBe(true)

        vi.restoreAllMocks()
      })

      it('should filter events by messageId', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 200 }))

        const result1 = await client.publish({
          url: 'https://example.com.ai/webhook1',
          body: { event: 'test1' },
        })
        await client.publish({
          url: 'https://example.com.ai/webhook2',
          body: { event: 'test2' },
        })

        await vi.runAllTimersAsync()

        const events = await client.events.list({ messageId: result1.messageId })

        expect(events.every((e) => e.messageId === result1.messageId)).toBe(true)

        vi.restoreAllMocks()
      })

      it('should support pagination', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 200 }))

        for (let i = 0; i < 5; i++) {
          await client.publish({
            url: `https://example.com.ai/webhook${i}`,
            body: { event: `test${i}` },
          })
        }

        await vi.runAllTimersAsync()

        const page1 = await client.events.list({ limit: 2 })
        expect(page1.length).toBe(2)

        const page2 = await client.events.list({ limit: 2, cursor: page1[1].cursor })
        expect(page2.length).toBe(2)

        vi.restoreAllMocks()
      })
    })

    describe('get', () => {
      it('should get a specific event by ID', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 200 }))

        await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { event: 'test' },
        })

        await vi.runAllTimersAsync()

        const events = await client.events.list({ limit: 1 })
        const eventId = events[0].eventId

        const event = await client.events.get(eventId)

        expect(event).toBeDefined()
        expect(event?.eventId).toBe(eventId)

        vi.restoreAllMocks()
      })

      it('should return null for non-existent event', async () => {
        const event = await client.events.get('non-existent')
        expect(event).toBeNull()
      })
    })

    describe('event types', () => {
      it('should track created event', async () => {
        const result = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { event: 'test' },
        })

        const events = await client.events.list({ messageId: result.messageId, type: 'created' })

        expect(events.length).toBeGreaterThanOrEqual(1)
        expect(events[0].type).toBe('created')
      })

      it('should track delivered event on success', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 200 }))

        const result = await client.publish({
          url: 'https://example.com.ai/webhook',
          body: { event: 'test' },
        })

        await vi.runAllTimersAsync()

        const events = await client.events.list({ messageId: result.messageId, type: 'delivered' })

        expect(events.length).toBeGreaterThanOrEqual(1)
        expect(events[0].type).toBe('delivered')
        expect(events[0].statusCode).toBe(200)

        vi.restoreAllMocks()
      })

      it('should track failed event on error', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'))

        const result = await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'test' },
          retries: 0,
        })

        await vi.runAllTimersAsync()

        const events = await client.events.list({ messageId: result.messageId, type: 'failed' })

        expect(events.length).toBeGreaterThanOrEqual(1)
        expect(events[0].type).toBe('failed')
        expect(events[0].error).toContain('Timeout')

        vi.restoreAllMocks()
      })

      it('should track retry events', async () => {
        let attempts = 0
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
          attempts++
          if (attempts <= 2) {
            throw new Error('Temporary failure')
          }
          return new Response('OK', { status: 200 })
        })

        const result = await client.publish({
          url: 'https://flaky.example.com.ai/webhook',
          body: { event: 'test' },
          retries: 3,
        })

        await vi.runAllTimersAsync()

        const retryEvents = await client.events.list({ messageId: result.messageId, type: 'retry' })

        expect(retryEvents.length).toBe(2) // 2 retries before success

        vi.restoreAllMocks()
      })

      it('should track dlq event when message moved to DLQ', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Permanent failure'))

        const result = await client.publish({
          url: 'https://failing.example.com.ai/webhook',
          body: { event: 'test' },
          retries: 1,
        })

        await vi.runAllTimersAsync()

        const dlqEvents = await client.events.list({ messageId: result.messageId, type: 'dlq' })

        expect(dlqEvents.length).toBe(1)
        expect(dlqEvents[0].type).toBe('dlq')

        vi.restoreAllMocks()
      })
    })
  })
})
