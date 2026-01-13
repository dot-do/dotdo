/**
 * Clerk Webhook Tests
 *
 * Tests for webhook signature verification and event handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Webhook,
  createWebhook,
  WebhookVerificationError,
  WebhookHandler,
  createWebhookHandler,
  type WebhookEventMap,
} from '../index'
import type { ClerkWebhookEvent, ClerkWebhookEventType, ClerkUser, ClerkSession } from '../types'

describe('Webhook Signature Verification', () => {
  const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
  let webhook: Webhook

  beforeEach(() => {
    webhook = new Webhook(testSecret)
  })

  describe('constructor', () => {
    it('should accept secret with whsec_ prefix', () => {
      const wh = new Webhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')
      expect(wh).toBeInstanceOf(Webhook)
    })

    it('should accept secret without prefix', () => {
      const wh = new Webhook('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')
      expect(wh).toBeInstanceOf(Webhook)
    })

    it('should accept raw string secret', () => {
      const wh = new Webhook('simple-test-secret-key')
      expect(wh).toBeInstanceOf(Webhook)
    })
  })

  describe('verify', () => {
    it('should verify a valid webhook payload', async () => {
      const payload = JSON.stringify({
        data: { id: 'user_123', object: 'user' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      const event = await webhook.verify(payload, headers)

      expect(event).toBeDefined()
      expect(event.type).toBe('user.created')
      expect(event.data.id).toBe('user_123')
    })

    it('should reject missing svix-id header', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })

      await expect(
        webhook.verify(payload, {
          'svix-timestamp': '1234567890',
          'svix-signature': 'v1,xxx',
        })
      ).rejects.toThrow(WebhookVerificationError)
    })

    it('should reject missing svix-timestamp header', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })

      await expect(
        webhook.verify(payload, {
          'svix-id': 'msg_123',
          'svix-signature': 'v1,xxx',
        })
      ).rejects.toThrow(WebhookVerificationError)
    })

    it('should reject missing svix-signature header', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })

      await expect(
        webhook.verify(payload, {
          'svix-id': 'msg_123',
          'svix-timestamp': '1234567890',
        })
      ).rejects.toThrow(WebhookVerificationError)
    })

    it('should reject expired timestamp', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600 // 10 minutes ago

      const signature = await webhook.sign('msg_123', oldTimestamp, payload)

      await expect(
        webhook.verify(payload, {
          'svix-id': 'msg_123',
          'svix-timestamp': oldTimestamp.toString(),
          'svix-signature': signature,
        })
      ).rejects.toThrow('Message timestamp too old')
    })

    it('should reject future timestamp', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })
      const futureTimestamp = Math.floor(Date.now() / 1000) + 600 // 10 minutes in future

      const signature = await webhook.sign('msg_123', futureTimestamp, payload)

      await expect(
        webhook.verify(payload, {
          'svix-id': 'msg_123',
          'svix-timestamp': futureTimestamp.toString(),
          'svix-signature': signature,
        })
      ).rejects.toThrow('Message timestamp too new')
    })

    it('should reject invalid signature', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })
      const timestamp = Math.floor(Date.now() / 1000)

      await expect(
        webhook.verify(payload, {
          'svix-id': 'msg_123',
          'svix-timestamp': timestamp.toString(),
          'svix-signature': 'v1,invalid_signature_here',
        })
      ).rejects.toThrow('Invalid signature')
    })

    it('should reject invalid JSON payload', async () => {
      const payload = 'not valid json'
      const headers = await webhook.generateTestHeaders(payload)

      await expect(webhook.verify(payload, headers)).rejects.toThrow('Invalid JSON payload')
    })

    it('should accept custom tolerance', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400 // 6+ minutes ago

      const signature = await webhook.sign('msg_123', oldTimestamp, payload)

      // Default tolerance (300s) should reject
      await expect(
        webhook.verify(payload, {
          'svix-id': 'msg_123',
          'svix-timestamp': oldTimestamp.toString(),
          'svix-signature': signature,
        })
      ).rejects.toThrow('Message timestamp too old')

      // Extended tolerance (600s) should accept
      const event = await webhook.verify(
        payload,
        {
          'svix-id': 'msg_123',
          'svix-timestamp': oldTimestamp.toString(),
          'svix-signature': signature,
        },
        { tolerance: 600 }
      )

      expect(event).toBeDefined()
    })

    it('should handle ArrayBuffer payload', async () => {
      const payload = JSON.stringify({ data: { id: 'user_456' }, object: 'event', type: 'user.updated' })
      const headers = await webhook.generateTestHeaders(payload)

      const buffer = new TextEncoder().encode(payload).buffer
      const event = await webhook.verify(buffer, headers)

      expect(event.type).toBe('user.updated')
      expect(event.data.id).toBe('user_456')
    })

    it('should handle multiple signatures', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })
      const timestamp = Math.floor(Date.now() / 1000)

      const validSig = await webhook.sign('msg_123', timestamp, payload)
      const multiSig = `v1,invalid_signature ${validSig}` // Multiple signatures

      const event = await webhook.verify(payload, {
        'svix-id': 'msg_123',
        'svix-timestamp': timestamp.toString(),
        'svix-signature': multiSig,
      })

      expect(event).toBeDefined()
    })

    it('should normalize header keys', async () => {
      const payload = JSON.stringify({ data: {}, object: 'event', type: 'user.created' })
      const headers = await webhook.generateTestHeaders(payload)

      // Use different casing
      const event = await webhook.verify(payload, {
        'Svix-Id': headers['svix-id'],
        'SVIX-TIMESTAMP': headers['svix-timestamp'],
        'svix-SIGNATURE': headers['svix-signature'],
      })

      expect(event).toBeDefined()
    })
  })

  describe('sign', () => {
    it('should generate v1 signature', async () => {
      const signature = await webhook.sign('msg_123', 1234567890, '{"test":true}')

      expect(signature).toMatch(/^v1,.+$/)
    })
  })

  describe('generateTestHeaders', () => {
    it('should generate valid test headers', async () => {
      const payload = JSON.stringify({ test: true })
      const headers = await webhook.generateTestHeaders(payload)

      expect(headers['svix-id']).toMatch(/^msg_[a-f0-9]+$/)
      expect(headers['svix-timestamp']).toMatch(/^\d+$/)
      expect(headers['svix-signature']).toMatch(/^v1,.+$/)

      // Headers should be valid for verification
      await expect(
        webhook.verify(JSON.stringify({ data: {}, object: 'event', type: 'user.created' }), headers)
      ).rejects.toThrow() // Payload mismatch
    })
  })
})

describe('WebhookHandler', () => {
  const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
  let handler: WebhookHandler
  let webhook: Webhook

  beforeEach(() => {
    webhook = new Webhook(testSecret)
    handler = createWebhookHandler(testSecret)
  })

  describe('on', () => {
    it('should register and call user.created handler', async () => {
      const callback = vi.fn()
      handler.on('user.created', callback)

      const userData = {
        id: 'user_123',
        object: 'user',
        first_name: 'John',
        last_name: 'Doe',
        email_addresses: [{ email_address: 'john@example.com' }],
      }

      const payload = JSON.stringify({
        data: userData,
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'user.created',
          data: expect.objectContaining({ id: 'user_123' }),
        })
      )
    })

    it('should register and call user.updated handler', async () => {
      const callback = vi.fn()
      handler.on('user.updated', callback)

      const payload = JSON.stringify({
        data: { id: 'user_456', first_name: 'Jane' },
        object: 'event',
        type: 'user.updated',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call user.deleted handler', async () => {
      const callback = vi.fn()
      handler.on('user.deleted', callback)

      const payload = JSON.stringify({
        data: { id: 'user_789', deleted: true },
        object: 'event',
        type: 'user.deleted',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call session.created handler', async () => {
      const callback = vi.fn()
      handler.on('session.created', callback)

      const payload = JSON.stringify({
        data: { id: 'sess_123', user_id: 'user_123', status: 'active' },
        object: 'event',
        type: 'session.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call session.ended handler', async () => {
      const callback = vi.fn()
      handler.on('session.ended', callback)

      const payload = JSON.stringify({
        data: { id: 'sess_456', user_id: 'user_456', status: 'ended' },
        object: 'event',
        type: 'session.ended',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call session.removed handler', async () => {
      const callback = vi.fn()
      handler.on('session.removed', callback)

      const payload = JSON.stringify({
        data: { id: 'sess_789', status: 'removed' },
        object: 'event',
        type: 'session.removed',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call session.revoked handler', async () => {
      const callback = vi.fn()
      handler.on('session.revoked', callback)

      const payload = JSON.stringify({
        data: { id: 'sess_abc', status: 'revoked' },
        object: 'event',
        type: 'session.revoked',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call organization.created handler', async () => {
      const callback = vi.fn()
      handler.on('organization.created', callback)

      const payload = JSON.stringify({
        data: { id: 'org_123', name: 'Acme Inc', slug: 'acme' },
        object: 'event',
        type: 'organization.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call organization.updated handler', async () => {
      const callback = vi.fn()
      handler.on('organization.updated', callback)

      const payload = JSON.stringify({
        data: { id: 'org_456', name: 'Acme Corp' },
        object: 'event',
        type: 'organization.updated',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call organization.deleted handler', async () => {
      const callback = vi.fn()
      handler.on('organization.deleted', callback)

      const payload = JSON.stringify({
        data: { id: 'org_789', deleted: true },
        object: 'event',
        type: 'organization.deleted',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call organizationMembership.created handler', async () => {
      const callback = vi.fn()
      handler.on('organizationMembership.created', callback)

      const payload = JSON.stringify({
        data: { id: 'mem_123', organization: { id: 'org_123' }, public_user_data: { user_id: 'user_123' } },
        object: 'event',
        type: 'organizationMembership.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should register and call organizationInvitation.created handler', async () => {
      const callback = vi.fn()
      handler.on('organizationInvitation.created', callback)

      const payload = JSON.stringify({
        data: { id: 'inv_123', email_address: 'invite@example.com', status: 'pending' },
        object: 'event',
        type: 'organizationInvitation.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should support multiple handlers for same event', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      handler.on('user.created', callback1)
      handler.on('user.created', callback2)

      const payload = JSON.stringify({
        data: { id: 'user_multi' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)
    })

    it('should only call handler for matching event type', async () => {
      const userHandler = vi.fn()
      const sessionHandler = vi.fn()

      handler.on('user.created', userHandler)
      handler.on('session.created', sessionHandler)

      const payload = JSON.stringify({
        data: { id: 'user_only' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(userHandler).toHaveBeenCalledTimes(1)
      expect(sessionHandler).not.toHaveBeenCalled()
    })

    it('should return the handler for chaining', () => {
      const result = handler.on('user.created', () => {})

      expect(result).toBe(handler)
    })
  })

  describe('off', () => {
    it('should remove a handler', async () => {
      const callback = vi.fn()
      handler.on('user.created', callback)
      handler.off('user.created', callback)

      const payload = JSON.stringify({
        data: { id: 'user_off' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback).not.toHaveBeenCalled()
    })

    it('should only remove the specific handler', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      handler.on('user.created', callback1)
      handler.on('user.created', callback2)
      handler.off('user.created', callback1)

      const payload = JSON.stringify({
        data: { id: 'user_partial' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledTimes(1)
    })
  })

  describe('onAll', () => {
    it('should register a handler for all events', async () => {
      const callback = vi.fn()
      handler.onAll(callback)

      const userPayload = JSON.stringify({
        data: { id: 'user_all' },
        object: 'event',
        type: 'user.created',
      })

      const userHeaders = await webhook.generateTestHeaders(userPayload)
      await handler.handleRequest(userPayload, userHeaders)

      const sessionPayload = JSON.stringify({
        data: { id: 'sess_all' },
        object: 'event',
        type: 'session.created',
      })

      const sessionHeaders = await webhook.generateTestHeaders(sessionPayload)
      await handler.handleRequest(sessionPayload, sessionHeaders)

      expect(callback).toHaveBeenCalledTimes(2)
    })
  })

  describe('handleRequest', () => {
    it('should throw on invalid signature', async () => {
      handler.on('user.created', vi.fn())

      const payload = JSON.stringify({
        data: { id: 'user_invalid' },
        object: 'event',
        type: 'user.created',
      })

      await expect(
        handler.handleRequest(payload, {
          'svix-id': 'msg_123',
          'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
          'svix-signature': 'v1,invalid',
        })
      ).rejects.toThrow(WebhookVerificationError)
    })

    it('should return the verified event', async () => {
      handler.on('user.created', vi.fn())

      const payload = JSON.stringify({
        data: { id: 'user_return' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      const event = await handler.handleRequest(payload, headers)

      expect(event).toBeDefined()
      expect(event.type).toBe('user.created')
      expect(event.data.id).toBe('user_return')
    })

    it('should handle Request object', async () => {
      const callback = vi.fn()
      handler.on('user.created', callback)

      const payload = JSON.stringify({
        data: { id: 'user_request' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: payload,
        headers: headers,
      })

      const event = await handler.handleRequest(request)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(event.data.id).toBe('user_request')
    })

    it('should propagate handler errors', async () => {
      const error = new Error('Handler failed')
      handler.on('user.created', () => {
        throw error
      })

      const payload = JSON.stringify({
        data: { id: 'user_error' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)

      await expect(handler.handleRequest(payload, headers)).rejects.toThrow('Handler failed')
    })

    it('should handle async handlers', async () => {
      const results: string[] = []

      handler.on('user.created', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        results.push('first')
      })

      handler.on('user.created', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        results.push('second')
      })

      const payload = JSON.stringify({
        data: { id: 'user_async' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)
      await handler.handleRequest(payload, headers)

      // Both handlers should have completed
      expect(results).toContain('first')
      expect(results).toContain('second')
    })
  })

  describe('createHandler', () => {
    it('should create a fetch handler', async () => {
      const callback = vi.fn()
      handler.on('user.created', callback)

      const payload = JSON.stringify({
        data: { id: 'user_fetch' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)

      const fetchHandler = handler.createHandler()

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: payload,
        headers: headers,
      })

      const response = await fetchHandler(request)

      expect(response.status).toBe(200)
      expect(callback).toHaveBeenCalledTimes(1)

      const body = await response.json()
      expect(body.success).toBe(true)
    })

    it('should return 400 for verification failure', async () => {
      handler.on('user.created', vi.fn())

      const fetchHandler = handler.createHandler()

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: JSON.stringify({ data: {}, object: 'event', type: 'user.created' }),
        headers: {
          'svix-id': 'msg_123',
          'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
          'svix-signature': 'v1,invalid',
        },
      })

      const response = await fetchHandler(request)

      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error).toBeDefined()
    })

    it('should return 500 for handler errors', async () => {
      handler.on('user.created', () => {
        throw new Error('Internal error')
      })

      const fetchHandler = handler.createHandler()

      const payload = JSON.stringify({
        data: { id: 'user_500' },
        object: 'event',
        type: 'user.created',
      })

      const headers = await webhook.generateTestHeaders(payload)

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: payload,
        headers: headers,
      })

      const response = await fetchHandler(request)

      expect(response.status).toBe(500)
    })

    it('should return 405 for non-POST requests', async () => {
      const fetchHandler = handler.createHandler()

      const request = new Request('https://example.com/webhook', {
        method: 'GET',
      })

      const response = await fetchHandler(request)

      expect(response.status).toBe(405)
    })
  })
})

describe('createWebhook', () => {
  it('should create a Webhook instance', () => {
    const wh = createWebhook('whsec_test')
    expect(wh).toBeInstanceOf(Webhook)
  })
})

describe('createWebhookHandler', () => {
  it('should create a WebhookHandler instance', () => {
    const handler = createWebhookHandler('whsec_test')
    expect(handler).toBeInstanceOf(WebhookHandler)
  })
})
