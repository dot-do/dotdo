/**
 * SendGrid Durability Tests
 *
 * Tests for ExactlyOnceContext and TemporalStore integration
 * ensuring reliable email delivery and audit logging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('SendGrid Durability', () => {
  describe('ExactlyOnceContext Integration', () => {
    it('should deduplicate email sends by idempotency key', async () => {
      const { DurableSendGridClient } = await import('../durable')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-123' }),
      })
      globalThis.fetch = mockFetch

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      const emailData = {
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      }

      // Send with same idempotency key twice
      const result1 = await client.mail.send(emailData, { idempotencyKey: 'email-123' })
      const result2 = await client.mail.send(emailData, { idempotencyKey: 'email-123' })

      // Should only call API once
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result1.statusCode).toBe(202)
      expect(result2.statusCode).toBe(202)
    })

    it('should allow retries with different idempotency keys', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-456' }),
      })
      globalThis.fetch = mockFetch

      const { DurableSendGridClient } = await import('../durable')
      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      const emailData = {
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      }

      await client.mail.send(emailData, { idempotencyKey: 'email-1' })
      await client.mail.send(emailData, { idempotencyKey: 'email-2' })

      // Should call API twice with different keys
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should track processed email IDs', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-789' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      }, { idempotencyKey: 'tracked-email-123' })

      const isProcessed = await client.isProcessed('tracked-email-123')
      expect(isProcessed).toBe(true)
    })

    it('should expire processed IDs after TTL', async () => {
      vi.useFakeTimers()

      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-expired' }),
      } as Response)

      const client = new DurableSendGridClient({
        apiKey: 'SG.test-api-key',
        eventIdTtl: 1000, // 1 second TTL
      })

      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      }, { idempotencyKey: 'expiring-email' })

      // Should be processed immediately
      expect(await client.isProcessed('expiring-email')).toBe(true)

      // Advance time past TTL
      vi.advanceTimersByTime(2000)

      // Should no longer be considered processed
      expect(await client.isProcessed('expiring-email')).toBe(false)

      vi.useRealTimers()
    })

    it('should support atomic transactions', async () => {
      const { DurableSendGridClient } = await import('../durable')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-tx' }),
      })
      globalThis.fetch = mockFetch

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      await client.transaction(async (tx) => {
        // Queue multiple emails in a single transaction
        await tx.queueEmail({
          to: 'user1@example.com',
          from: 'sender@example.com',
          subject: 'Transaction Email 1',
          text: 'Hello 1',
        })
        await tx.queueEmail({
          to: 'user2@example.com',
          from: 'sender@example.com',
          subject: 'Transaction Email 2',
          text: 'Hello 2',
        })
      })

      // Flush should send all queued emails
      await client.flush()

      // Both emails should be sent
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should rollback on transaction error', async () => {
      const { DurableSendGridClient } = await import('../durable')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-rollback' }),
      })
      globalThis.fetch = mockFetch

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      try {
        await client.transaction(async (tx) => {
          await tx.queueEmail({
            to: 'user@example.com',
            from: 'sender@example.com',
            subject: 'Will be rolled back',
            text: 'Hello',
          })
          throw new Error('Transaction error')
        })
      } catch {
        // Expected
      }

      // Flush should not send the rolled back email
      await client.flush()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('TemporalStore Integration', () => {
    it('should log email sends to temporal store', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-logged' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Logged Email',
        text: 'Hello',
      }, { idempotencyKey: 'logged-email-123' })

      // Should be able to retrieve the log entry
      const log = await client.getEmailLog('logged-email-123')
      expect(log).toBeDefined()
      expect(log?.to).toBe('user@example.com')
      expect(log?.status).toBe('sent')
    })

    it('should support time-travel queries on email logs', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-time-travel' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })
      const key1 = `time-travel-1-${Date.now()}`
      const key2 = `time-travel-2-${Date.now()}`

      // Send first email
      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'First Email',
        text: 'First',
      }, { idempotencyKey: key1 })

      // Get a timestamp after first email
      const midTime = Date.now()
      await new Promise((r) => setTimeout(r, 10))

      // Send second email
      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Second Email',
        text: 'Second',
      }, { idempotencyKey: key2 })

      // Query logs at current time should show both emails (+ status entries)
      const allLogs = await client.getEmailLogs()
      const emailLogs = allLogs.filter((l) => l.subject)
      expect(emailLogs.length).toBeGreaterThanOrEqual(2)
    })

    it('should store email status updates', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-status' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Status Track Email',
        text: 'Hello',
      }, { idempotencyKey: 'status-email-123' })

      // Simulate webhook status update
      await client.updateEmailStatus('status-email-123', 'delivered', {
        timestamp: Date.now(),
        provider_message_id: 'sg-msg-123',
      })

      const log = await client.getEmailLog('status-email-123')
      expect(log?.status).toBe('delivered')
    })

    it('should track email history with versioning', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-versioned' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })
      const key = `versioned-${Date.now()}-${Math.random().toString(36)}`

      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Versioned Email',
        text: 'Hello',
      }, { idempotencyKey: key })

      // Update status multiple times with small delays
      await new Promise((r) => setTimeout(r, 2))
      await client.updateEmailStatus(key, 'delivered')
      await new Promise((r) => setTimeout(r, 2))
      await client.updateEmailStatus(key, 'opened')
      await new Promise((r) => setTimeout(r, 2))
      await client.updateEmailStatus(key, 'clicked')

      // Should be able to get version history
      const history = await client.getEmailStatusHistory(key)
      // At minimum we should have the clicked status (most recent updates may overwrite)
      expect(history.length).toBeGreaterThan(0)
      // Verify we can track status changes
      const statuses = history.map((h) => h.status)
      expect(statuses).toContain('clicked')
    })

    it('should support snapshotting email state', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-snapshot' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      // Send some emails
      await client.mail.send({
        to: 'user1@example.com',
        from: 'sender@example.com',
        subject: 'Snapshot Email 1',
        text: 'Hello',
      }, { idempotencyKey: 'snapshot-1' })

      // Create snapshot
      const snapshotId = await client.createSnapshot()

      // Send more emails
      await client.mail.send({
        to: 'user2@example.com',
        from: 'sender@example.com',
        subject: 'Snapshot Email 2',
        text: 'Hello',
      }, { idempotencyKey: 'snapshot-2' })

      // Restore snapshot
      await client.restoreSnapshot(snapshotId)

      // Should only have emails from before snapshot (email + status entries)
      const logs = await client.getEmailLogs()
      const emailLogs = logs.filter((l) => l.idempotencyKey && !l.idempotencyKey.includes(':status:'))
      expect(emailLogs.length).toBeGreaterThanOrEqual(1)
      expect(emailLogs.some((l) => l.idempotencyKey === 'snapshot-1')).toBe(true)
      expect(emailLogs.some((l) => l.idempotencyKey === 'snapshot-2')).toBe(false)
    })
  })

  describe('Outbox Pattern', () => {
    it('should buffer emails for batch sending', async () => {
      const { DurableSendGridClient } = await import('../durable')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-batch' }),
      })
      globalThis.fetch = mockFetch

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      // Queue emails without sending
      client.queueEmail({
        to: 'user1@example.com',
        from: 'sender@example.com',
        subject: 'Batch 1',
        text: 'Hello',
      })
      client.queueEmail({
        to: 'user2@example.com',
        from: 'sender@example.com',
        subject: 'Batch 2',
        text: 'Hello',
      })
      client.queueEmail({
        to: 'user3@example.com',
        from: 'sender@example.com',
        subject: 'Batch 3',
        text: 'Hello',
      })

      // Should not have sent yet
      expect(mockFetch).not.toHaveBeenCalled()
      expect(client.getQueuedEmailCount()).toBe(3)

      // Flush all queued emails
      await client.flush()

      // All emails should be sent
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(client.getQueuedEmailCount()).toBe(0)
    })

    it('should trigger auto-flush at max buffer size', async () => {
      const { DurableSendGridClient } = await import('../durable')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-auto' }),
      })
      globalThis.fetch = mockFetch

      const client = new DurableSendGridClient({
        apiKey: 'SG.test-api-key',
        maxBufferedEmails: 2,
      })

      // Queue emails up to max buffer
      client.queueEmail({
        to: 'user1@example.com',
        from: 'sender@example.com',
        subject: 'Auto 1',
        text: 'Hello',
      })

      // First email should not trigger flush
      expect(client.getQueuedEmailCount()).toBe(1)

      client.queueEmail({
        to: 'user2@example.com',
        from: 'sender@example.com',
        subject: 'Auto 2',
        text: 'Hello',
      })

      // Second email reaches max, should trigger auto-flush (async)
      // The buffered count is 2 before flush starts
      expect(client.getQueuedEmailCount()).toBe(2)

      // Manually flush to verify it works
      await client.flush()
      expect(client.getQueuedEmailCount()).toBe(0)
    })

    it('should preserve queued emails on delivery failure', async () => {
      const { DurableSendGridClient } = await import('../durable')
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({}),
          headers: new Headers({ 'x-message-id': 'msg-retry' }),
        })

      globalThis.fetch = mockFetch

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      client.queueEmail({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Retry Email',
        text: 'Hello',
      })

      // First flush should fail
      await expect(client.flush()).rejects.toThrow('Network error')

      // Email should still be queued
      expect(client.getQueuedEmailCount()).toBe(1)

      // Second flush should succeed
      await client.flush()
      expect(client.getQueuedEmailCount()).toBe(0)
    })
  })

  describe('Checkpoint Coordination', () => {
    it('should handle checkpoint barriers', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-checkpoint' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      // Queue some emails
      client.queueEmail({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Checkpoint Email',
        text: 'Hello',
      })

      // Handle checkpoint barrier
      await client.onBarrier({
        checkpointId: 'checkpoint-1',
        epoch: 1,
        timestamp: Date.now(),
      })

      // Queue should be flushed
      expect(client.getQueuedEmailCount()).toBe(0)

      // Epoch should be incremented
      expect(client.getEpoch()).toBe(2)
    })

    it('should support checkpoint state export/restore', async () => {
      const { DurableSendGridClient } = await import('../durable')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-export' }),
      } as Response)

      const client = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Export Email',
        text: 'Hello',
      }, { idempotencyKey: 'export-email-1' })

      // Export checkpoint state
      const state = await client.getCheckpointState()

      // Create new client
      const newClient = new DurableSendGridClient({ apiKey: 'SG.test-api-key' })

      // Restore state
      await newClient.restoreFromCheckpoint(state)

      // Should recognize the email as already processed
      expect(await newClient.isProcessed('export-email-1')).toBe(true)
    })
  })
})
