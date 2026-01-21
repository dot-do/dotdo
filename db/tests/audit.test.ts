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

// ============================================================================
// maskSensitiveFields Tests (do-0unq)
// ============================================================================

import { maskSensitiveFields, defaultAuditConfig } from '../audit'

describe('maskSensitiveFields (do-0unq)', () => {
  const REDACTED = '***REDACTED***'

  describe('Basic Field Masking', () => {
    it('should mask fields matching exact names', () => {
      const data = {
        password: 'secret123',
        username: 'alice'
      }

      const result = maskSensitiveFields(data, ['password'])

      expect(result.password).toBe(REDACTED)
      expect(result.username).toBe('alice')
    })

    it('should mask fields with case-insensitive matching', () => {
      const data = {
        Password: 'secret123',
        PASSWORD: 'secret456',
        passWORD: 'secret789'
      }

      const result = maskSensitiveFields(data, ['password'])

      expect(result.Password).toBe(REDACTED)
      expect(result.PASSWORD).toBe(REDACTED)
      expect(result.passWORD).toBe(REDACTED)
    })

    it('should mask fields containing sensitive substrings', () => {
      const data = {
        userPassword: 'secret123',
        passwordHash: 'abc123',
        oldPassword: 'old123',
        newPassword: 'new123'
      }

      const result = maskSensitiveFields(data, ['password'])

      expect(result.userPassword).toBe(REDACTED)
      expect(result.passwordHash).toBe(REDACTED)
      expect(result.oldPassword).toBe(REDACTED)
      expect(result.newPassword).toBe(REDACTED)
    })

    it('should not mask unrelated fields', () => {
      const data = {
        name: 'Alice',
        email: 'alice@example.com',
        status: 'active'
      }

      const result = maskSensitiveFields(data, ['password', 'secret'])

      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
      expect(result.status).toBe('active')
    })
  })

  describe('Nested Object Masking', () => {
    it('should recursively mask nested objects', () => {
      const data = {
        user: {
          name: 'Alice',
          credentials: {
            password: 'secret123',
            token: 'abc123'
          }
        }
      }

      const result = maskSensitiveFields(data, ['password', 'token'])

      expect(result.user).toEqual({
        name: 'Alice',
        credentials: {
          password: REDACTED,
          token: REDACTED
        }
      })
    })

    it('should handle deeply nested structures', () => {
      const data = {
        level1: {
          level2: {
            level3: {
              apiKey: 'key123',
              data: 'safe'
            }
          }
        }
      }

      const result = maskSensitiveFields(data, ['apikey'])

      expect(result.level1.level2.level3.apiKey).toBe(REDACTED)
      expect(result.level1.level2.level3.data).toBe('safe')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null values', () => {
      const data = {
        password: null,
        name: 'Alice'
      }

      const result = maskSensitiveFields(data, ['password'])

      // null is not an object, so it passes through but field name still matches
      expect(result.password).toBe(REDACTED)
      expect(result.name).toBe('Alice')
    })

    it('should handle arrays without masking array elements', () => {
      const data = {
        tags: ['admin', 'user'],
        password: 'secret'
      }

      const result = maskSensitiveFields(data, ['password'])

      expect(result.tags).toEqual(['admin', 'user'])
      expect(result.password).toBe(REDACTED)
    })

    it('should handle empty objects', () => {
      const data = {}

      const result = maskSensitiveFields(data, ['password'])

      expect(result).toEqual({})
    })

    it('should handle numeric and boolean values', () => {
      const data = {
        count: 42,
        active: true,
        secretCount: 100,
        password: 'abc'
      }

      const result = maskSensitiveFields(data, ['password', 'secret'])

      expect(result.count).toBe(42)
      expect(result.active).toBe(true)
      expect(result.secretCount).toBe(REDACTED)
      expect(result.password).toBe(REDACTED)
    })
  })

  describe('Default Config Coverage', () => {
    it('should mask password variations', () => {
      const data = {
        password: 'pass1',
        passwd: 'pass2',
        userPwd: 'pass3',
        oldPassword: 'pass4'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.password).toBe(REDACTED)
      expect(result.passwd).toBe(REDACTED)
      expect(result.userPwd).toBe(REDACTED)
      expect(result.oldPassword).toBe(REDACTED)
    })

    it('should mask token variations', () => {
      const data = {
        token: 'tok1',
        accessToken: 'tok2',
        refreshToken: 'tok3',
        bearerToken: 'tok4',
        jwtToken: 'tok5',
        oauthToken: 'tok6'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.token).toBe(REDACTED)
      expect(result.accessToken).toBe(REDACTED)
      expect(result.refreshToken).toBe(REDACTED)
      expect(result.bearerToken).toBe(REDACTED)
      expect(result.jwtToken).toBe(REDACTED)
      expect(result.oauthToken).toBe(REDACTED)
    })

    it('should mask API keys', () => {
      const data = {
        apiKey: 'key1',
        api_key: 'key2',
        clientSecret: 'sec1',
        client_secret: 'sec2',
        consumerKey: 'key3'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.apiKey).toBe(REDACTED)
      expect(result.api_key).toBe(REDACTED)
      expect(result.clientSecret).toBe(REDACTED)
      expect(result.client_secret).toBe(REDACTED)
      expect(result.consumerKey).toBe(REDACTED)
    })

    it('should mask PII fields', () => {
      const data = {
        ssn: '123-45-6789',
        socialSecurityNumber: '987-65-4321',
        taxId: 'TX123',
        driversLicense: 'DL456',
        passportNumber: 'P789',
        dateOfBirth: '1990-01-01'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.ssn).toBe(REDACTED)
      expect(result.socialSecurityNumber).toBe(REDACTED)
      expect(result.taxId).toBe(REDACTED)
      expect(result.driversLicense).toBe(REDACTED)
      expect(result.passportNumber).toBe(REDACTED)
      expect(result.dateOfBirth).toBe(REDACTED)
    })

    it('should mask financial data', () => {
      const data = {
        creditCard: '4111111111111111',
        cardNumber: '5500000000000004',
        cvv: '123',
        cvc: '456',
        securityCode: '789',
        bankAccount: 'ACC123',
        accountNumber: '000123456789',
        routingNumber: '021000021',
        iban: 'DE89370400440532013000',
        pin: '1234'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.creditCard).toBe(REDACTED)
      expect(result.cardNumber).toBe(REDACTED)
      expect(result.cvv).toBe(REDACTED)
      expect(result.cvc).toBe(REDACTED)
      expect(result.securityCode).toBe(REDACTED)
      expect(result.bankAccount).toBe(REDACTED)
      expect(result.accountNumber).toBe(REDACTED)
      expect(result.routingNumber).toBe(REDACTED)
      expect(result.iban).toBe(REDACTED)
      expect(result.pin).toBe(REDACTED)
    })

    it('should mask encryption keys', () => {
      const data = {
        privateKey: 'priv123',
        private_key: 'priv456',
        publicKey: 'pub123',
        signingKey: 'sign123',
        encryptionKey: 'enc123',
        masterKey: 'master123'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.privateKey).toBe(REDACTED)
      expect(result.private_key).toBe(REDACTED)
      expect(result.publicKey).toBe(REDACTED)
      expect(result.signingKey).toBe(REDACTED)
      expect(result.encryptionKey).toBe(REDACTED)
      expect(result.masterKey).toBe(REDACTED)
    })

    it('should mask healthcare data (HIPAA)', () => {
      const data = {
        healthRecord: 'HR123',
        medicalRecord: 'MR456',
        diagnosis: 'D789',
        prescription: 'RX101',
        patientId: 'PAT123'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.healthRecord).toBe(REDACTED)
      expect(result.medicalRecord).toBe(REDACTED)
      expect(result.diagnosis).toBe(REDACTED)
      expect(result.prescription).toBe(REDACTED)
      expect(result.patientId).toBe(REDACTED)
    })

    it('should mask connection strings', () => {
      const data = {
        connectionString: 'Server=localhost;Database=db;User=user;Password=pass',
        dbPassword: 'dbpass123',
        db_password: 'dbpass456'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.connectionString).toBe(REDACTED)
      expect(result.dbPassword).toBe(REDACTED)
      expect(result.db_password).toBe(REDACTED)
    })

    it('should mask session and auth data', () => {
      const data = {
        sessionId: 'sess123',
        sessionToken: 'sesstok456',
        authHeader: 'Bearer abc123',
        authorization: 'Basic xyz789',
        cookie: 'sid=abc123'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.sessionId).toBe(REDACTED)
      expect(result.sessionToken).toBe(REDACTED)
      expect(result.authHeader).toBe(REDACTED)
      expect(result.authorization).toBe(REDACTED)
      expect(result.cookie).toBe(REDACTED)
    })

    it('should mask contact information', () => {
      const data = {
        phone: '555-1234',
        mobile: '555-5678',
        cellphone: '555-9012',
        email: 'alice@example.com'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.phone).toBe(REDACTED)
      expect(result.mobile).toBe(REDACTED)
      expect(result.cellphone).toBe(REDACTED)
      expect(result.email).toBe(REDACTED)
    })
  })

  describe('Real-world Scenarios', () => {
    it('should mask user registration payload', () => {
      const data = {
        username: 'alice',
        email: 'alice@example.com',
        password: 'SecureP@ss123',
        confirmPassword: 'SecureP@ss123',
        phone: '+1-555-1234',
        dateOfBirth: '1990-05-15'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.username).toBe('alice')
      expect(result.email).toBe(REDACTED)
      expect(result.password).toBe(REDACTED)
      expect(result.confirmPassword).toBe(REDACTED)
      expect(result.phone).toBe(REDACTED)
      expect(result.dateOfBirth).toBe(REDACTED)
    })

    it('should mask payment processing payload', () => {
      const data = {
        orderId: 'ORD-123',
        amount: 99.99,
        currency: 'USD',
        cardNumber: '4111111111111111',
        cvv: '123',
        expiryMonth: '12',
        expiryYear: '2025',
        billingAddress: '123 Main St'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.orderId).toBe('ORD-123')
      expect(result.amount).toBe(99.99)
      expect(result.currency).toBe('USD')
      expect(result.cardNumber).toBe(REDACTED)
      expect(result.cvv).toBe(REDACTED)
      expect(result.expiryMonth).toBe(REDACTED)
      expect(result.expiryYear).toBe(REDACTED)
      expect(result.billingAddress).toBe('123 Main St')
    })

    it('should mask OAuth callback payload', () => {
      const data = {
        code: 'auth_code_123',
        state: 'state_456',
        accessToken: 'at_789',
        refreshToken: 'rt_012',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read write'
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.code).toBe('auth_code_123')
      expect(result.state).toBe('state_456')
      expect(result.accessToken).toBe(REDACTED)
      expect(result.refreshToken).toBe(REDACTED)
      expect(result.tokenType).toBe(REDACTED) // Contains 'token'
      expect(result.expiresIn).toBe(3600)
      expect(result.scope).toBe('read write')
    })

    it('should mask database connection config', () => {
      const data = {
        host: 'db.example.com',
        port: 5432,
        database: 'myapp',
        user: 'dbuser',
        password: 'dbpass123',
        connectionString: 'postgresql://user:pass@host:5432/db',
        ssl: true
      }

      const result = maskSensitiveFields(data, defaultAuditConfig.maskFields)

      expect(result.host).toBe('db.example.com')
      expect(result.port).toBe(5432)
      expect(result.database).toBe('myapp')
      expect(result.user).toBe('dbuser')
      expect(result.password).toBe(REDACTED)
      expect(result.connectionString).toBe(REDACTED)
      expect(result.ssl).toBe(true)
    })
  })
})
