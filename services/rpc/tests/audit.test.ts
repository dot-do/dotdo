/**
 * Audit Tests
 *
 * Tests for audit logging including:
 * - Event recording
 * - Field redaction
 * - Query functionality
 * - Sink implementations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  AuditLogger,
  InMemoryAuditSink,
  createDevAuditLogger,
} from '../src/audit'
import type { AuditLogEntry, AuditConfig } from '../src/audit'

describe('Audit Logging', () => {
  describe('InMemoryAuditSink', () => {
    let sink: InMemoryAuditSink

    beforeEach(() => {
      sink = new InMemoryAuditSink()
    })

    it('should write entries', async () => {
      const entries: AuditLogEntry[] = [
        {
          id: 'entry-1',
          timestamp: new Date(),
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'agents.list',
          resourceType: 'agents',
          service: 'agents',
          method: 'list',
          requestId: 'req-1',
          status: 'success',
          durationMs: 100,
        },
      ]

      await sink.write(entries)

      const stored = sink.getAll()
      expect(stored.length).toBe(1)
      expect(stored[0].id).toBe('entry-1')
    })

    it('should query by tenant', async () => {
      await sink.write([
        { id: 'e1', timestamp: new Date(), tenantId: 'tenant-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r1', status: 'success', durationMs: 100 },
        { id: 'e2', timestamp: new Date(), tenantId: 'tenant-2', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r2', status: 'success', durationMs: 100 },
      ])

      const results = await sink.query({ tenantId: 'tenant-1' })
      expect(results.length).toBe(1)
      expect(results[0].tenantId).toBe('tenant-1')
    })

    it('should query by user', async () => {
      await sink.write([
        { id: 'e1', timestamp: new Date(), tenantId: 'tenant-1', userId: 'user-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r1', status: 'success', durationMs: 100 },
        { id: 'e2', timestamp: new Date(), tenantId: 'tenant-1', userId: 'user-2', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r2', status: 'success', durationMs: 100 },
      ])

      const results = await sink.query({ userId: 'user-1' })
      expect(results.length).toBe(1)
      expect(results[0].userId).toBe('user-1')
    })

    it('should query by action', async () => {
      await sink.write([
        { id: 'e1', timestamp: new Date(), tenantId: 'tenant-1', action: 'agents.list', resourceType: 'agents', service: 'agents', method: 'list', requestId: 'r1', status: 'success', durationMs: 100 },
        { id: 'e2', timestamp: new Date(), tenantId: 'tenant-1', action: 'llm.complete', resourceType: 'llm', service: 'llm', method: 'complete', requestId: 'r2', status: 'success', durationMs: 100 },
      ])

      const results = await sink.query({ action: 'agents.list' })
      expect(results.length).toBe(1)
      expect(results[0].action).toBe('agents.list')
    })

    it('should query by status', async () => {
      await sink.write([
        { id: 'e1', timestamp: new Date(), tenantId: 'tenant-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r1', status: 'success', durationMs: 100 },
        { id: 'e2', timestamp: new Date(), tenantId: 'tenant-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r2', status: 'error', errorCode: 'ERR', durationMs: 100 },
      ])

      const results = await sink.query({ status: 'error' })
      expect(results.length).toBe(1)
      expect(results[0].status).toBe('error')
    })

    it('should query by time range', async () => {
      const now = Date.now()
      await sink.write([
        { id: 'e1', timestamp: new Date(now - 10000), tenantId: 'tenant-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r1', status: 'success', durationMs: 100 },
        { id: 'e2', timestamp: new Date(now), tenantId: 'tenant-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r2', status: 'success', durationMs: 100 },
      ])

      const results = await sink.query({
        from: new Date(now - 5000),
        to: new Date(now + 1000),
      })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('e2')
    })

    it('should paginate results', async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `e${i}`,
        timestamp: new Date(Date.now() - i * 1000),
        tenantId: 'tenant-1',
        action: 'test',
        resourceType: 'test',
        service: 'test',
        method: 'test',
        requestId: `r${i}`,
        status: 'success' as const,
        durationMs: 100,
      }))

      await sink.write(entries)

      const page1 = await sink.query({ limit: 3, offset: 0 })
      const page2 = await sink.query({ limit: 3, offset: 3 })

      expect(page1.length).toBe(3)
      expect(page2.length).toBe(3)
      expect(page1[0].id).not.toBe(page2[0].id)
    })

    it('should clear entries', async () => {
      await sink.write([
        { id: 'e1', timestamp: new Date(), tenantId: 'tenant-1', action: 'test', resourceType: 'test', service: 'test', method: 'test', requestId: 'r1', status: 'success', durationMs: 100 },
      ])

      sink.clear()

      expect(sink.getAll().length).toBe(0)
    })
  })

  describe('AuditLogger', () => {
    let logger: AuditLogger
    let sink: InMemoryAuditSink

    beforeEach(() => {
      const result = createDevAuditLogger({ consoleOutput: false })
      logger = result.logger
      sink = result.sink
    })

    it('should log entries', async () => {
      await logger.log({
        tenantId: 'tenant-1',
        action: 'agents.list',
        resourceType: 'agents',
        service: 'agents',
        method: 'list',
        requestId: 'req-1',
        status: 'success',
        durationMs: 100,
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries.length).toBe(1)
      expect(entries[0].action).toBe('agents.list')
    })

    it('should auto-generate ID and timestamp', async () => {
      await logger.log({
        tenantId: 'tenant-1',
        action: 'test',
        resourceType: 'test',
        service: 'test',
        method: 'test',
        requestId: 'req-1',
        status: 'success',
        durationMs: 100,
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].id).toBeDefined()
      expect(entries[0].timestamp).toBeInstanceOf(Date)
    })

    it('should redact sensitive fields', async () => {
      await logger.log({
        tenantId: 'tenant-1',
        action: 'test',
        resourceType: 'test',
        service: 'test',
        method: 'test',
        requestId: 'req-1',
        status: 'success',
        durationMs: 100,
        context: {
          password: 'secret123',
          api_key: 'sk-1234',
          data: 'visible',
        },
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].context?.password).toBe('[REDACTED]')
      expect(entries[0].context?.api_key).toBe('[REDACTED]')
      expect(entries[0].context?.data).toBe('visible')
    })

    it('should log authentication events', async () => {
      await logger.logAuth('success', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        method: 'jwt',
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].action).toBe('auth.success')
      expect(entries[0].status).toBe('success')
    })

    it('should log auth failure events', async () => {
      await logger.logAuth('failure', {
        method: 'api_key',
        reason: 'Invalid key',
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].action).toBe('auth.failure')
      expect(entries[0].status).toBe('error')
      expect(entries[0].errorCode).toBe('AUTH_FAILURE')
    })

    it('should log access events', async () => {
      await logger.logAccess(true, {
        tenantId: 'tenant-1',
        userId: 'user-1',
        resource: 'agents',
        resourceId: 'agent-123',
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].action).toBe('access.granted')
      expect(entries[0].resourceId).toBe('agent-123')
    })

    it('should log access denied events', async () => {
      await logger.logAccess(false, {
        tenantId: 'tenant-1',
        userId: 'user-1',
        resource: 'agents',
        permission: 'admin',
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].action).toBe('access.denied')
      expect(entries[0].errorCode).toBe('ACCESS_DENIED')
    })

    it('should log rate limit events', async () => {
      await logger.logRateLimit({
        tenantId: 'tenant-1',
        userId: 'user-1',
        limitType: 'rpm',
        service: 'agents',
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].action).toBe('rate_limit')
      expect(entries[0].context?.limitType).toBe('rpm')
    })

    it('should log security events', async () => {
      await logger.logSecurity({
        tenantId: 'tenant-1',
        event: 'suspicious_activity',
        severity: 'high',
        context: { reason: 'Multiple failed auth attempts' },
      })

      await logger.flush()

      const entries = sink.getAll()
      expect(entries[0].action).toBe('security.suspicious_activity')
      expect(entries[0].context?.severity).toBe('high')
    })

    it('should respect disabled config', async () => {
      const { logger: disabledLogger, sink: disabledSink } = createDevAuditLogger({
        enabled: false,
      })

      await disabledLogger.log({
        tenantId: 'tenant-1',
        action: 'test',
        resourceType: 'test',
        service: 'test',
        method: 'test',
        requestId: 'req-1',
        status: 'success',
        durationMs: 100,
      })

      await disabledLogger.flush()

      expect(disabledSink.getAll().length).toBe(0)
    })

    it('should query logs', async () => {
      await logger.log({
        tenantId: 'tenant-1',
        action: 'agents.list',
        resourceType: 'agents',
        service: 'agents',
        method: 'list',
        requestId: 'req-1',
        status: 'success',
        durationMs: 100,
      })

      await logger.flush()

      const results = await logger.query({ tenantId: 'tenant-1' })
      expect(results.length).toBe(1)
    })
  })
})
