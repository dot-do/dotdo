// Audit Logging Tests - TDD approach (do-xebw)
// Tests written FIRST before implementation

import { describe, it, expect, beforeEach } from 'vitest'
import type { AuditLog, AuditLogStore, AuditLogLevel, AuditAction } from '../audit'

// Mock in-memory store for initial tests
// Will be replaced with SQLite implementation
function createMockAuditStore(): AuditLogStore {
  const logs: AuditLog[] = []

  return {
    async log(entry: Omit<AuditLog, '$id' | '$timestamp'>): Promise<AuditLog> {
      const log: AuditLog = {
        ...entry,
        $id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        $timestamp: Date.now()
      }
      logs.push(log)
      return log
    },

    async get(id: string): Promise<AuditLog | null> {
      return logs.find(l => l.$id === id) ?? null
    },

    async query(options = {}): Promise<AuditLog[]> {
      const { actor, action, resource, resourceId, level, since, until, limit = 100, offset = 0 } = options

      let results = logs.filter(l => {
        if (actor && l.actor !== actor) return false
        if (action && l.action !== action) return false
        if (resource && l.resource !== resource) return false
        if (resourceId && l.resourceId !== resourceId) return false
        if (level && l.level !== level) return false
        if (since && l.$timestamp < since) return false
        if (until && l.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending (newest first)
      results.sort((a, b) => b.$timestamp - a.$timestamp)

      return results.slice(offset, offset + limit)
    },

    async count(options = {}): Promise<number> {
      const results = await this.query({ ...options, limit: Number.MAX_SAFE_INTEGER })
      return results.length
    },

    async deleteOlderThan(timestamp: number): Promise<number> {
      const before = logs.length
      const toKeep = logs.filter(l => l.$timestamp >= timestamp)
      logs.length = 0
      logs.push(...toKeep)
      return before - toKeep.length
    },

    async deleteAll(): Promise<number> {
      const count = logs.length
      logs.length = 0
      return count
    }
  }
}

describe('Audit Logging (do-xebw)', () => {
  let auditStore: AuditLogStore

  beforeEach(() => {
    auditStore = createMockAuditStore()
  })

  describe('AuditLog Entity', () => {
    it('should create an audit log entry', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'create',
        resource: 'Customer',
        resourceId: 'cust-456',
        level: 'info',
        details: { name: 'Alice' }
      })

      expect(log.$id).toBeDefined()
      expect(log.$id).toMatch(/^audit-/)
      expect(log.$timestamp).toBeDefined()
      expect(log.actor).toBe('user-123')
      expect(log.action).toBe('create')
      expect(log.resource).toBe('Customer')
      expect(log.resourceId).toBe('cust-456')
      expect(log.level).toBe('info')
      expect(log.details).toEqual({ name: 'Alice' })
    })

    it('should get an audit log by id', async () => {
      const created = await auditStore.log({
        actor: 'user-123',
        action: 'read',
        resource: 'Order',
        resourceId: 'order-789',
        level: 'info'
      })

      const fetched = await auditStore.get(created.$id)
      expect(fetched).not.toBeNull()
      expect(fetched!.$id).toBe(created.$id)
      expect(fetched!.action).toBe('read')
    })

    it('should return null for non-existent log', async () => {
      const result = await auditStore.get('non-existent')
      expect(result).toBeNull()
    })

    it('should support optional fields', async () => {
      const log = await auditStore.log({
        actor: 'system',
        action: 'cleanup',
        resource: 'AuditLog',
        level: 'info'
        // No resourceId, details, or correlationId
      })

      expect(log.$id).toBeDefined()
      expect(log.resourceId).toBeUndefined()
      expect(log.details).toBeUndefined()
      expect(log.correlationId).toBeUndefined()
    })

    it('should support correlation ID for tracing', async () => {
      const correlationId = 'req-abc-123'

      const log1 = await auditStore.log({
        actor: 'user-1',
        action: 'create',
        resource: 'Order',
        resourceId: 'order-1',
        level: 'info',
        correlationId
      })

      const log2 = await auditStore.log({
        actor: 'system',
        action: 'create',
        resource: 'Payment',
        resourceId: 'payment-1',
        level: 'info',
        correlationId
      })

      expect(log1.correlationId).toBe(correlationId)
      expect(log2.correlationId).toBe(correlationId)
    })
  })

  describe('Audit Log Levels', () => {
    it('should support info level for normal operations', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'read',
        resource: 'Customer',
        resourceId: 'cust-1',
        level: 'info'
      })

      expect(log.level).toBe('info')
    })

    it('should support warn level for suspicious activity', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'access_denied',
        resource: 'Admin',
        level: 'warn',
        details: { reason: 'Insufficient permissions' }
      })

      expect(log.level).toBe('warn')
    })

    it('should support error level for failures', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'update',
        resource: 'Customer',
        resourceId: 'cust-1',
        level: 'error',
        details: { error: 'Validation failed', fields: ['email'] }
      })

      expect(log.level).toBe('error')
    })

    it('should support security level for auth events', async () => {
      const log = await auditStore.log({
        actor: 'unknown',
        action: 'auth_failed',
        resource: 'Session',
        level: 'security',
        details: { ip: '192.168.1.1', attempts: 3 }
      })

      expect(log.level).toBe('security')
    })
  })

  describe('Audit Log Actions', () => {
    const actions: AuditAction[] = ['create', 'read', 'update', 'delete', 'auth_success', 'auth_failed', 'access_denied', 'export', 'import', 'admin_action']

    actions.forEach(action => {
      it(`should support '${action}' action`, async () => {
        const log = await auditStore.log({
          actor: 'user-123',
          action,
          resource: 'Test',
          level: 'info'
        })

        expect(log.action).toBe(action)
      })
    })
  })

  describe('Querying Audit Logs', () => {
    beforeEach(async () => {
      // Create test data
      await auditStore.log({
        actor: 'user-1',
        action: 'create',
        resource: 'Customer',
        resourceId: 'cust-1',
        level: 'info',
        details: { name: 'Alice' }
      })

      await auditStore.log({
        actor: 'user-2',
        action: 'update',
        resource: 'Customer',
        resourceId: 'cust-1',
        level: 'info',
        details: { name: 'Alicia' }
      })

      await auditStore.log({
        actor: 'user-1',
        action: 'delete',
        resource: 'Order',
        resourceId: 'order-1',
        level: 'warn'
      })

      await auditStore.log({
        actor: 'system',
        action: 'auth_failed',
        resource: 'Session',
        level: 'security',
        details: { ip: '10.0.0.1' }
      })
    })

    it('should query all logs', async () => {
      const logs = await auditStore.query()
      expect(logs.length).toBe(4)
    })

    it('should query by actor', async () => {
      const logs = await auditStore.query({ actor: 'user-1' })
      expect(logs.length).toBe(2)
      expect(logs.every(l => l.actor === 'user-1')).toBe(true)
    })

    it('should query by action', async () => {
      const logs = await auditStore.query({ action: 'create' })
      expect(logs.length).toBe(1)
      expect(logs[0].action).toBe('create')
    })

    it('should query by resource type', async () => {
      const logs = await auditStore.query({ resource: 'Customer' })
      expect(logs.length).toBe(2)
      expect(logs.every(l => l.resource === 'Customer')).toBe(true)
    })

    it('should query by resource ID', async () => {
      const logs = await auditStore.query({ resourceId: 'cust-1' })
      expect(logs.length).toBe(2)
    })

    it('should query by level', async () => {
      const logs = await auditStore.query({ level: 'security' })
      expect(logs.length).toBe(1)
      expect(logs[0].action).toBe('auth_failed')
    })

    it('should query by time range (since)', async () => {
      const now = Date.now()
      const logs = await auditStore.query({ since: now - 1000 })
      expect(logs.length).toBeGreaterThan(0)
    })

    it('should query by time range (until)', async () => {
      const now = Date.now()
      const logs = await auditStore.query({ until: now + 1000 })
      expect(logs.length).toBe(4)
    })

    it('should support pagination with limit', async () => {
      const logs = await auditStore.query({ limit: 2 })
      expect(logs.length).toBe(2)
    })

    it('should support pagination with offset', async () => {
      const all = await auditStore.query()
      const offset = await auditStore.query({ offset: 2 })
      expect(offset.length).toBe(2)
      expect(offset[0].$id).toBe(all[2].$id)
    })

    it('should order by timestamp descending (newest first)', async () => {
      const logs = await auditStore.query()
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i - 1].$timestamp).toBeGreaterThanOrEqual(logs[i].$timestamp)
      }
    })

    it('should combine multiple filters', async () => {
      const logs = await auditStore.query({
        actor: 'user-1',
        resource: 'Customer'
      })
      expect(logs.length).toBe(1)
      expect(logs[0].action).toBe('create')
    })

    it('should count logs with filters', async () => {
      const total = await auditStore.count()
      expect(total).toBe(4)

      const userCount = await auditStore.count({ actor: 'user-1' })
      expect(userCount).toBe(2)
    })
  })

  describe('Log Retention and Cleanup', () => {
    beforeEach(async () => {
      // Create logs at different times
      const now = Date.now()

      // Old logs (simulated by modifying timestamp after creation)
      const oldLog = await auditStore.log({
        actor: 'user-1',
        action: 'create',
        resource: 'Customer',
        level: 'info'
      })
      // Hack: modify timestamp for testing (in real impl, this would be actual old data)
      ;(oldLog as any).$timestamp = now - 100 * 24 * 60 * 60 * 1000 // 100 days ago

      await auditStore.log({
        actor: 'user-2',
        action: 'update',
        resource: 'Order',
        level: 'info'
      })
    })

    it('should delete logs older than specified timestamp', async () => {
      const now = Date.now()
      const cutoff = now - 30 * 24 * 60 * 60 * 1000 // 30 days ago

      const deleted = await auditStore.deleteOlderThan(cutoff)
      expect(deleted).toBeGreaterThanOrEqual(0)

      const remaining = await auditStore.query()
      remaining.forEach(log => {
        expect(log.$timestamp).toBeGreaterThanOrEqual(cutoff)
      })
    })

    it('should return count of deleted logs', async () => {
      const before = await auditStore.count()
      const deleted = await auditStore.deleteOlderThan(Date.now() + 1000) // Delete all
      expect(deleted).toBe(before)
    })

    it('should delete all logs', async () => {
      await auditStore.log({
        actor: 'user-1',
        action: 'create',
        resource: 'Test',
        level: 'info'
      })

      const deleted = await auditStore.deleteAll()
      expect(deleted).toBeGreaterThan(0)

      const remaining = await auditStore.count()
      expect(remaining).toBe(0)
    })
  })

  describe('PII Handling', () => {
    it('should support masking sensitive data in details', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'update',
        resource: 'Customer',
        resourceId: 'cust-1',
        level: 'info',
        details: {
          email: 'a***@example.com', // Pre-masked
          phone: '***-***-1234',
          name: 'Alice Smith'
        }
      })

      expect(log.details).toEqual({
        email: 'a***@example.com',
        phone: '***-***-1234',
        name: 'Alice Smith'
      })
    })

    it('should store actor as identifier, not PII', async () => {
      // Actor should be a user ID, not email or name
      const log = await auditStore.log({
        actor: 'user-123', // Good: ID
        action: 'create',
        resource: 'Order',
        level: 'info'
      })

      expect(log.actor).toBe('user-123')
      expect(log.actor).not.toContain('@') // Not an email
    })
  })

  describe('Structured Log Format', () => {
    it('should produce JSON-serializable logs', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'create',
        resource: 'Customer',
        resourceId: 'cust-1',
        level: 'info',
        details: { name: 'Alice', metadata: { source: 'api' } }
      })

      // Should be serializable to JSON
      const json = JSON.stringify(log)
      const parsed = JSON.parse(json)

      expect(parsed.$id).toBe(log.$id)
      expect(parsed.$timestamp).toBe(log.$timestamp)
      expect(parsed.actor).toBe(log.actor)
      expect(parsed.details).toEqual(log.details)
    })

    it('should have consistent field naming', async () => {
      const log = await auditStore.log({
        actor: 'user-123',
        action: 'update',
        resource: 'Order',
        resourceId: 'order-1',
        level: 'info',
        details: {},
        correlationId: 'req-abc'
      })

      // Verify all expected fields exist
      expect(log).toHaveProperty('$id')
      expect(log).toHaveProperty('$timestamp')
      expect(log).toHaveProperty('actor')
      expect(log).toHaveProperty('action')
      expect(log).toHaveProperty('resource')
      expect(log).toHaveProperty('resourceId')
      expect(log).toHaveProperty('level')
      expect(log).toHaveProperty('details')
      expect(log).toHaveProperty('correlationId')
    })
  })
})

// Note: Automatic audit logging integration tests are in do/tests/audit.test.ts
// as they require the EntityManager from @dotdo/do
