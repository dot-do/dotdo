/**
 * Webhook Utilities Tests
 *
 * Tests for webhook signature verification and event delivery.
 */

import { describe, it, expect } from 'vitest'
import { WebhookUtils, LinearLocal } from '../src/client'

describe('WebhookUtils', () => {
  describe('sign', () => {
    it('generates consistent signatures', async () => {
      const payload = '{"action":"create","type":"Issue"}'
      const secret = 'test_secret'

      const sig1 = await WebhookUtils.sign(payload, secret)
      const sig2 = await WebhookUtils.sign(payload, secret)

      expect(sig1).toBe(sig2)
      expect(sig1).toHaveLength(64) // SHA-256 hex
    })

    it('generates different signatures for different payloads', async () => {
      const secret = 'test_secret'

      const sig1 = await WebhookUtils.sign('payload1', secret)
      const sig2 = await WebhookUtils.sign('payload2', secret)

      expect(sig1).not.toBe(sig2)
    })

    it('generates different signatures for different secrets', async () => {
      const payload = 'test payload'

      const sig1 = await WebhookUtils.sign(payload, 'secret1')
      const sig2 = await WebhookUtils.sign(payload, 'secret2')

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('verify', () => {
    it('verifies valid signatures', async () => {
      const payload = '{"action":"create","type":"Issue"}'
      const secret = 'test_secret'

      const signature = await WebhookUtils.sign(payload, secret)
      const valid = await WebhookUtils.verify(payload, signature, secret)

      expect(valid).toBe(true)
    })

    it('rejects invalid signatures', async () => {
      const payload = '{"action":"create","type":"Issue"}'
      const secret = 'test_secret'

      const valid = await WebhookUtils.verify(payload, 'invalid_signature', secret)
      expect(valid).toBe(false)
    })

    it('rejects tampered payloads', async () => {
      const originalPayload = '{"action":"create","type":"Issue"}'
      const tamperedPayload = '{"action":"delete","type":"Issue"}'
      const secret = 'test_secret'

      const signature = await WebhookUtils.sign(originalPayload, secret)
      const valid = await WebhookUtils.verify(tamperedPayload, signature, secret)

      expect(valid).toBe(false)
    })

    it('rejects wrong secrets', async () => {
      const payload = '{"action":"create","type":"Issue"}'

      const signature = await WebhookUtils.sign(payload, 'correct_secret')
      const valid = await WebhookUtils.verify(payload, signature, 'wrong_secret')

      expect(valid).toBe(false)
    })
  })

  describe('createHeader', () => {
    it('creates valid Linear-style headers', async () => {
      const payload = '{"action":"create"}'
      const secret = 'test_secret'

      const headers = await WebhookUtils.createHeader(payload, secret)

      expect(headers['linear-signature']).toBeDefined()
      expect(headers['linear-timestamp']).toBeDefined()
      expect(parseInt(headers['linear-timestamp'])).toBeGreaterThan(0)
    })

    it('uses custom timestamp when provided', async () => {
      const payload = '{"action":"create"}'
      const secret = 'test_secret'
      const customTimestamp = 1704067200000 // 2024-01-01

      const headers = await WebhookUtils.createHeader(payload, secret, customTimestamp)

      expect(headers['linear-timestamp']).toBe('1704067200000')
    })
  })

  describe('verifyRequest', () => {
    it('verifies valid requests', async () => {
      const payload = '{"action":"create"}'
      const secret = 'test_secret'
      const timestamp = Date.now()

      const signaturePayload = `${timestamp}.${payload}`
      const signature = await WebhookUtils.sign(signaturePayload, secret)

      const valid = await WebhookUtils.verifyRequest(
        payload,
        {
          'linear-signature': signature,
          'linear-timestamp': timestamp.toString(),
        },
        secret
      )

      expect(valid).toBe(true)
    })

    it('rejects requests with old timestamps', async () => {
      const payload = '{"action":"create"}'
      const secret = 'test_secret'
      const oldTimestamp = Date.now() - 10 * 60 * 1000 // 10 minutes ago

      const signaturePayload = `${oldTimestamp}.${payload}`
      const signature = await WebhookUtils.sign(signaturePayload, secret)

      // Default tolerance is 5 minutes
      const valid = await WebhookUtils.verifyRequest(
        payload,
        {
          'linear-signature': signature,
          'linear-timestamp': oldTimestamp.toString(),
        },
        secret
      )

      expect(valid).toBe(false)
    })

    it('accepts requests within custom tolerance', async () => {
      const payload = '{"action":"create"}'
      const secret = 'test_secret'
      const oldTimestamp = Date.now() - 10 * 60 * 1000 // 10 minutes ago

      const signaturePayload = `${oldTimestamp}.${payload}`
      const signature = await WebhookUtils.sign(signaturePayload, secret)

      // Custom tolerance of 15 minutes
      const valid = await WebhookUtils.verifyRequest(
        payload,
        {
          'linear-signature': signature,
          'linear-timestamp': oldTimestamp.toString(),
        },
        secret,
        15 * 60 * 1000
      )

      expect(valid).toBe(true)
    })

    it('rejects invalid timestamp format', async () => {
      const payload = '{"action":"create"}'
      const secret = 'test_secret'

      const valid = await WebhookUtils.verifyRequest(
        payload,
        {
          'linear-signature': 'some_signature',
          'linear-timestamp': 'invalid',
        },
        secret
      )

      expect(valid).toBe(false)
    })
  })
})

describe('Webhook event delivery', () => {
  it('emits events when webhooks are enabled', async () => {
    const events: unknown[] = []

    const linear = new LinearLocal({
      webhooks: true,
      onWebhookEvent: (event) => {
        events.push(event)
      },
    })

    const team = await linear.teamCreate({ name: 'Test', key: 'TEST' })
    await linear.issueCreate({ teamId: team.team!.id, title: 'Test Issue' })

    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e: any) => e.type === 'Issue' && e.action === 'create')).toBe(true)
  })

  it('does not emit events when webhooks are disabled', async () => {
    const events: unknown[] = []

    const linear = new LinearLocal({
      webhooks: false,
      onWebhookEvent: (event) => {
        events.push(event)
      },
    })

    const team = await linear.teamCreate({ name: 'Test', key: 'TEST' })
    await linear.issueCreate({ teamId: team.team!.id, title: 'Test Issue' })

    expect(events.length).toBe(0)
  })
})
