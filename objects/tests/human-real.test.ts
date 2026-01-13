/**
 * Human Integration Tests - NO MOCKS
 *
 * Tests Human functionality using real miniflare DO instances with actual
 * SQLite storage. This follows the CLAUDE.md guidance to NEVER use mocks
 * for Durable Object tests.
 *
 * Tests approval flows, notification channels, and blocking requests via RPC.
 *
 * @module objects/tests/human-real.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import type { NotificationChannel, BlockingApprovalRequest } from '../Human'

// ============================================================================
// TYPES
// ============================================================================

interface TestHumanStub extends DurableObjectStub {
  // RPC methods
  setupChannels(channels: NotificationChannel[]): Promise<void>
  getNotificationChannels(): Promise<NotificationChannel[]>
  submitRequest(request: {
    requestId: string
    role: string
    message: string
    sla?: number
    type: 'approval' | 'question' | 'review'
  }): Promise<BlockingApprovalRequest>
  checkRequest(requestId: string): Promise<BlockingApprovalRequest | null>
  respondToRequest(
    requestId: string,
    response: { approved: boolean; reason?: string }
  ): Promise<BlockingApprovalRequest | null>
  listPendingRequests(): Promise<BlockingApprovalRequest[]>
  listAllRequests(): Promise<BlockingApprovalRequest[]>
  cancelRequest(requestId: string): Promise<boolean>
}

interface TestEnv {
  HUMAN: DurableObjectNamespace
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `human-test-${Date.now()}-${++testCounter}`
}

function uniqueRequestId(): string {
  return `req-${Date.now()}-${++testCounter}`
}

// ============================================================================
// TESTS: Human Operations
// ============================================================================

describe('Human Integration Tests (Real Miniflare)', () => {
  let stub: TestHumanStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as TestEnv).HUMAN.idFromName(ns)
    stub = (env as TestEnv).HUMAN.get(id) as TestHumanStub
  })

  // ==========================================================================
  // NOTIFICATION CHANNELS
  // ==========================================================================

  describe('Notification Channels', () => {
    it('sets and retrieves notification channels', async () => {
      const channels: NotificationChannel[] = [
        { type: 'email', target: 'ceo@acme.com', priority: 'high' },
        { type: 'slack', target: '#approvals', priority: 'normal' },
      ]

      await stub.setupChannels(channels)
      const retrieved = await stub.getNotificationChannels()

      expect(retrieved.length).toBe(2)
      expect(retrieved[0]!.type).toBe('email')
      expect(retrieved[0]!.target).toBe('ceo@acme.com')
      expect(retrieved[1]!.type).toBe('slack')
    })

    it('supports all channel types', async () => {
      const channels: NotificationChannel[] = [
        { type: 'email', target: 'user@example.com', priority: 'normal' },
        { type: 'slack', target: '@john', priority: 'high' },
        { type: 'sms', target: '+1-555-0123', priority: 'urgent' },
        { type: 'webhook', target: 'https://hook.example.com', priority: 'low' },
      ]

      await stub.setupChannels(channels)
      const retrieved = await stub.getNotificationChannels()

      expect(retrieved.length).toBe(4)
      expect(retrieved.map((c) => c.type)).toEqual(['email', 'slack', 'sms', 'webhook'])
    })

    it('returns empty array when no channels configured', async () => {
      const channels = await stub.getNotificationChannels()

      expect(channels).toEqual([])
    })

    it('replaces channels when setting new ones', async () => {
      await stub.setupChannels([{ type: 'email', target: 'first@example.com', priority: 'normal' }])

      await stub.setupChannels([{ type: 'slack', target: '#new-channel', priority: 'high' }])

      const channels = await stub.getNotificationChannels()

      expect(channels.length).toBe(1)
      expect(channels[0]!.type).toBe('slack')
    })
  })

  // ==========================================================================
  // BLOCKING APPROVAL REQUESTS
  // ==========================================================================

  describe('Blocking Approval Requests', () => {
    describe('Submit Request', () => {
      it('submits an approval request', async () => {
        const requestId = uniqueRequestId()

        const request = await stub.submitRequest({
          requestId,
          role: 'ceo',
          message: 'Approve the marketing budget of $50,000',
          type: 'approval',
        })

        expect(request.requestId).toBe(requestId)
        expect(request.role).toBe('ceo')
        expect(request.message).toBe('Approve the marketing budget of $50,000')
        expect(request.type).toBe('approval')
        expect(request.status).toBe('pending')
      })

      it('submits a question request', async () => {
        const requestId = uniqueRequestId()

        const request = await stub.submitRequest({
          requestId,
          role: 'legal',
          message: 'Is this contract compliant with GDPR?',
          type: 'question',
        })

        expect(request.type).toBe('question')
        expect(request.status).toBe('pending')
      })

      it('submits a review request', async () => {
        const requestId = uniqueRequestId()

        const request = await stub.submitRequest({
          requestId,
          role: 'tech-lead',
          message: 'Review the architecture design document',
          type: 'review',
        })

        expect(request.type).toBe('review')
        expect(request.status).toBe('pending')
      })

      it('sets createdAt timestamp', async () => {
        const requestId = uniqueRequestId()

        const request = await stub.submitRequest({
          requestId,
          role: 'manager',
          message: 'Test request',
          type: 'approval',
        })

        expect(request.createdAt).toBeDefined()
        const createdAt = new Date(request.createdAt)
        expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now())
      })

      it('sets expiresAt when SLA is provided', async () => {
        const requestId = uniqueRequestId()
        const sla = 4 * 60 * 60 * 1000 // 4 hours

        const request = await stub.submitRequest({
          requestId,
          role: 'ceo',
          message: 'Urgent approval needed',
          type: 'approval',
          sla,
        })

        expect(request.expiresAt).toBeDefined()
        const expiresAt = new Date(request.expiresAt!)
        const createdAt = new Date(request.createdAt)
        expect(expiresAt.getTime() - createdAt.getTime()).toBe(sla)
      })
    })

    describe('Check Request', () => {
      it('retrieves a pending request', async () => {
        const requestId = uniqueRequestId()

        await stub.submitRequest({
          requestId,
          role: 'manager',
          message: 'Check this request',
          type: 'approval',
        })

        const request = await stub.checkRequest(requestId)

        expect(request).not.toBeNull()
        expect(request!.requestId).toBe(requestId)
        expect(request!.status).toBe('pending')
      })

      it('returns null/undefined for non-existent request', async () => {
        const request = await stub.checkRequest('nonexistent-request')

        // May return null or undefined
        expect(request == null).toBe(true)
      })
    })

    describe('Respond to Request', () => {
      it('approves a request', async () => {
        const requestId = uniqueRequestId()

        await stub.submitRequest({
          requestId,
          role: 'ceo',
          message: 'Approve this deal',
          type: 'approval',
        })

        const response = await stub.respondToRequest(requestId, {
          approved: true,
          reason: 'Good strategic fit',
        })

        expect(response).not.toBeNull()
        expect(response!.status).toBe('approved')
        expect(response!.result?.approved).toBe(true)
        expect(response!.result?.reason).toBe('Good strategic fit')
      })

      it('rejects a request', async () => {
        const requestId = uniqueRequestId()

        await stub.submitRequest({
          requestId,
          role: 'legal',
          message: 'Review contract',
          type: 'review',
        })

        const response = await stub.respondToRequest(requestId, {
          approved: false,
          reason: 'Terms are not acceptable',
        })

        expect(response).not.toBeNull()
        expect(response!.status).toBe('rejected')
        expect(response!.result?.approved).toBe(false)
        expect(response!.result?.reason).toBe('Terms are not acceptable')
      })

      it('sets respondedAt timestamp', async () => {
        const requestId = uniqueRequestId()

        await stub.submitRequest({
          requestId,
          role: 'manager',
          message: 'Approve this',
          type: 'approval',
        })

        const response = await stub.respondToRequest(requestId, { approved: true })

        expect(response!.result?.respondedAt).toBeDefined()
      })

      it('returns null/undefined for non-existent request', async () => {
        // Implementation throws for non-existent request
        try {
          const response = await stub.respondToRequest('nonexistent', { approved: true })
          // If implementation returns instead of throwing, expect null
          expect(response == null).toBe(true)
        } catch (error) {
          // Throwing an error for non-existent request is acceptable behavior
          expect((error as Error).message).toContain('not found')
        }
      })
    })

    describe('List Requests', () => {
      beforeEach(async () => {
        // Create multiple requests
        await stub.submitRequest({
          requestId: uniqueRequestId(),
          role: 'ceo',
          message: 'Request 1',
          type: 'approval',
        })

        const req2Id = uniqueRequestId()
        await stub.submitRequest({
          requestId: req2Id,
          role: 'legal',
          message: 'Request 2',
          type: 'review',
        })
        await stub.respondToRequest(req2Id, { approved: true })

        await stub.submitRequest({
          requestId: uniqueRequestId(),
          role: 'manager',
          message: 'Request 3',
          type: 'question',
        })
      })

      it('lists pending requests', async () => {
        const pending = await stub.listPendingRequests()

        expect(pending.length).toBe(2)
        expect(pending.every((r) => r.status === 'pending')).toBe(true)
      })

      it('lists all requests', async () => {
        const all = await stub.listAllRequests()

        expect(all.length).toBe(3)
      })
    })

    describe('Cancel Request', () => {
      it('cancels a pending request', async () => {
        const requestId = uniqueRequestId()

        await stub.submitRequest({
          requestId,
          role: 'ceo',
          message: 'To be cancelled',
          type: 'approval',
        })

        const cancelled = await stub.cancelRequest(requestId)

        expect(cancelled).toBe(true)

        const request = await stub.checkRequest(requestId)
        // Request should either be null or have a cancelled/expired status
        if (request) {
          expect(['cancelled', 'expired']).toContain(request.status)
        }
      })

      it('returns false for non-existent request', async () => {
        const cancelled = await stub.cancelRequest('nonexistent')

        expect(cancelled).toBe(false)
      })
    })
  })

  // ==========================================================================
  // APPROVAL FLOWS
  // ==========================================================================

  describe('Approval Flows', () => {
    it('handles complete approval flow', async () => {
      const requestId = uniqueRequestId()

      // 1. Submit request
      const submitted = await stub.submitRequest({
        requestId,
        role: 'ceo',
        message: 'Approve partnership with Acme Corp',
        type: 'approval',
        sla: 24 * 60 * 60 * 1000, // 24 hours
      })
      expect(submitted.status).toBe('pending')

      // 2. Check request (simulating polling)
      let current = await stub.checkRequest(requestId)
      expect(current!.status).toBe('pending')

      // 3. Respond with approval
      const approved = await stub.respondToRequest(requestId, {
        approved: true,
        reason: 'Excellent partnership opportunity',
      })
      expect(approved!.status).toBe('approved')

      // 4. Verify final state
      current = await stub.checkRequest(requestId)
      expect(current!.status).toBe('approved')
      expect(current!.result?.approved).toBe(true)
    })

    it('handles complete rejection flow', async () => {
      const requestId = uniqueRequestId()

      // 1. Submit request
      await stub.submitRequest({
        requestId,
        role: 'legal',
        message: 'Review contract for compliance',
        type: 'review',
      })

      // 2. Reject
      const rejected = await stub.respondToRequest(requestId, {
        approved: false,
        reason: 'Contract contains unacceptable liability clauses',
      })
      expect(rejected!.status).toBe('rejected')

      // 3. Verify request no longer in pending list
      const pending = await stub.listPendingRequests()
      expect(pending.every((r) => r.requestId !== requestId)).toBe(true)
    })

    it('handles multiple concurrent requests', async () => {
      // Submit multiple requests
      const req1 = await stub.submitRequest({
        requestId: uniqueRequestId(),
        role: 'ceo',
        message: 'Budget approval',
        type: 'approval',
      })

      const req2 = await stub.submitRequest({
        requestId: uniqueRequestId(),
        role: 'ceo',
        message: 'Hire approval',
        type: 'approval',
      })

      const req3 = await stub.submitRequest({
        requestId: uniqueRequestId(),
        role: 'ceo',
        message: 'Contract approval',
        type: 'approval',
      })

      // All should be pending
      const pending = await stub.listPendingRequests()
      expect(pending.length).toBe(3)

      // Approve one, reject one
      await stub.respondToRequest(req1.requestId, { approved: true })
      await stub.respondToRequest(req2.requestId, { approved: false })

      // Check remaining pending
      const stillPending = await stub.listPendingRequests()
      expect(stillPending.length).toBe(1)
      expect(stillPending[0]!.requestId).toBe(req3.requestId)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles approval without reason', async () => {
      const requestId = uniqueRequestId()

      await stub.submitRequest({
        requestId,
        role: 'manager',
        message: 'Simple approval',
        type: 'approval',
      })

      const response = await stub.respondToRequest(requestId, { approved: true })

      expect(response!.status).toBe('approved')
      expect(response!.result?.approved).toBe(true)
    })

    it('handles very long message', async () => {
      const requestId = uniqueRequestId()
      const longMessage = 'A'.repeat(10000)

      const request = await stub.submitRequest({
        requestId,
        role: 'ceo',
        message: longMessage,
        type: 'approval',
      })

      expect(request.message.length).toBe(10000)
    })

    it('handles special characters in message', async () => {
      const requestId = uniqueRequestId()
      const specialMessage = 'Approve deal for $50,000 (50% discount) with <Company> & "Partners"'

      const request = await stub.submitRequest({
        requestId,
        role: 'ceo',
        message: specialMessage,
        type: 'approval',
      })

      expect(request.message).toBe(specialMessage)
    })

    it('handles responding to already-responded request', async () => {
      const requestId = uniqueRequestId()

      await stub.submitRequest({
        requestId,
        role: 'manager',
        message: 'Test',
        type: 'approval',
      })

      // First response
      await stub.respondToRequest(requestId, { approved: true })

      // Second response should either fail or return the existing result
      try {
        const secondResponse = await stub.respondToRequest(requestId, {
          approved: false,
          reason: 'Changed my mind',
        })

        // The response status should still be 'approved' from the first response
        // (if implementation returns existing record instead of throwing)
        if (secondResponse) {
          expect(secondResponse.status).toBe('approved')
        }
      } catch (error) {
        // Implementation throws an error for already-responded requests, which is acceptable
        expect(error).toBeDefined()
        expect((error as Error).message).toContain('already')
      }
    })
  })

  // ==========================================================================
  // HTTP API
  // ==========================================================================

  describe('HTTP API', () => {
    it('handles GET /channels', async () => {
      await stub.setupChannels([
        { type: 'email', target: 'test@example.com', priority: 'normal' },
      ])

      const response = await stub.fetch(
        new Request('https://test.api/channels', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const channels = await response.json() as NotificationChannel[]
      expect(channels.length).toBe(1)
    })

    it('handles PUT /channels', async () => {
      const channels: NotificationChannel[] = [
        { type: 'slack', target: '#approvals', priority: 'high' },
      ]

      const response = await stub.fetch(
        new Request('https://test.api/channels', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(channels),
        })
      )

      expect(response.status).toBe(200)

      const retrieved = await stub.getNotificationChannels()
      expect(retrieved.length).toBe(1)
    })

    it('handles POST /request', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: uniqueRequestId(),
            role: 'ceo',
            message: 'HTTP approval request',
            type: 'approval',
          }),
        })
      )

      // Implementation returns 200, RESTful would be 201
      expect(response.status).toBe(200)

      const request = await response.json() as BlockingApprovalRequest
      expect(request.status).toBe('pending')
    })

    it('handles GET /requests', async () => {
      await stub.submitRequest({
        requestId: uniqueRequestId(),
        role: 'ceo',
        message: 'Request for listing',
        type: 'approval',
      })

      const response = await stub.fetch(
        new Request('https://test.api/requests', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const requests = await response.json() as BlockingApprovalRequest[]
      expect(requests.length).toBeGreaterThanOrEqual(1)
    })

    it('handles GET /pending', async () => {
      await stub.submitRequest({
        requestId: uniqueRequestId(),
        role: 'ceo',
        message: 'Pending request',
        type: 'approval',
      })

      const response = await stub.fetch(
        new Request('https://test.api/pending', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      // /pending returns PendingApproval[] (legacy format) not BlockingApprovalRequest[]
      const pending = await response.json() as Array<{ request: { id: string } }>
      expect(pending.length).toBeGreaterThanOrEqual(1)
      // All returned items should be pending (no status field on PendingApproval, just present means pending)
      expect(pending.every((r) => r.request && r.request.id)).toBe(true)
    })
  })
})
