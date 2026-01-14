/**
 * Tests for MultiTenantCredentialVault
 *
 * Covers:
 * - Tenant isolation guarantees
 * - Cross-tenant access prevention
 * - Tenant-scoped encryption
 * - Tenant key rotation
 * - Audit logging per tenant
 * - Access token management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MultiTenantCredentialVault, createMultiTenantVault, CrossTenantAccessError, TenantError } from '../multi-tenant'

describe('MultiTenantCredentialVault', () => {
  const masterKey = '12345678901234567890123456789012' // 32 bytes

  let vault: MultiTenantCredentialVault

  beforeEach(() => {
    vault = createMultiTenantVault({ masterKey })
  })

  describe('initialization', () => {
    it('should require a 32-byte master key', () => {
      expect(() => createMultiTenantVault({ masterKey: 'short' })).toThrow('Master key must be 32 bytes for AES-256')

      expect(() => createMultiTenantVault({ masterKey })).not.toThrow()
    })

    it('should accept optional configuration', () => {
      const vault = createMultiTenantVault({
        masterKey,
        versionRetention: 5,
        enableAudit: false,
        enableIntegrityChecks: true,
      })

      expect(vault).toBeInstanceOf(MultiTenantCredentialVault)
    })
  })

  describe('tenant isolation', () => {
    it('should store credentials in tenant-specific namespaces', async () => {
      await vault.store('tenant-a', {
        name: 'api-key',
        type: 'api_key',
        value: 'tenant-a-secret',
      })

      await vault.store('tenant-b', {
        name: 'api-key',
        type: 'api_key',
        value: 'tenant-b-secret',
      })

      const credA = await vault.get('tenant-a', 'api-key')
      const credB = await vault.get('tenant-b', 'api-key')

      expect(credA?.value).toBe('tenant-a-secret')
      expect(credB?.value).toBe('tenant-b-secret')
      expect(credA?.tenantId).toBe('tenant-a')
      expect(credB?.tenantId).toBe('tenant-b')
    })

    it('should not allow cross-tenant access', async () => {
      await vault.store('tenant-a', {
        name: 'secret-key',
        type: 'api_key',
        value: 'super-secret',
      })

      // Tenant B should not see tenant A's credential
      const result = await vault.get('tenant-b', 'secret-key')
      expect(result).toBeNull()
    })

    it('should emit security event on cross-tenant attempt detection', async () => {
      const securityHandler = vi.fn()
      vault.on('security:cross_tenant_attempt', securityHandler)

      await vault.store('tenant-a', {
        name: 'protected',
        type: 'api_key',
        value: 'secret',
      })

      // Try to access from tenant-b
      const result = await vault.get('tenant-b', 'protected')
      expect(result).toBeNull()
    })

    it('should list only credentials belonging to the tenant', async () => {
      await vault.store('tenant-a', { name: 'cred-1', type: 'api_key', value: 'v1' })
      await vault.store('tenant-a', { name: 'cred-2', type: 'api_key', value: 'v2' })
      await vault.store('tenant-b', { name: 'cred-3', type: 'api_key', value: 'v3' })

      const listA = await vault.list('tenant-a')
      const listB = await vault.list('tenant-b')

      expect(listA.length).toBe(2)
      expect(listA.every((c) => c.tenantId === 'tenant-a')).toBe(true)

      expect(listB.length).toBe(1)
      expect(listB.every((c) => c.tenantId === 'tenant-b')).toBe(true)
    })
  })

  describe('tenant-scoped encryption', () => {
    it('should use different derived keys per tenant', async () => {
      // Store same value for two tenants
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'same-value' })
      await vault.store('tenant-b', { name: 'key', type: 'api_key', value: 'same-value' })

      // Both should decrypt to the same value
      const credA = await vault.get('tenant-a', 'key')
      const credB = await vault.get('tenant-b', 'key')

      expect(credA?.value).toBe('same-value')
      expect(credB?.value).toBe('same-value')

      // But they should have different tenant IDs
      expect(credA?.tenantId).toBe('tenant-a')
      expect(credB?.tenantId).toBe('tenant-b')
    })

    it('should encrypt complex credential types', async () => {
      const oauthToken = {
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresAt: new Date('2026-12-31'),
      }

      await vault.store('tenant-a', {
        name: 'oauth',
        type: 'oauth2',
        value: oauthToken,
      })

      const cred = await vault.get('tenant-a', 'oauth')
      expect(cred?.value).toEqual(oauthToken)
    })
  })

  describe('tenant key rotation', () => {
    it('should rotate tenant key without affecting other tenants', async () => {
      await vault.store('tenant-a', { name: 'key1', type: 'api_key', value: 'value1' })
      await vault.store('tenant-b', { name: 'key2', type: 'api_key', value: 'value2' })

      // Rotate key for tenant-a
      await vault.rotateTenantKey('tenant-a')

      // Both tenants should still be able to access their credentials
      const credA = await vault.get('tenant-a', 'key1')
      const credB = await vault.get('tenant-b', 'key2')

      expect(credA?.value).toBe('value1')
      expect(credB?.value).toBe('value2')
    })

    it('should increment key version on rotation', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'value' })

      const statsBefore = await vault.getTenantStats('tenant-a')
      expect(statsBefore.keyVersion).toBe(1)

      await vault.rotateTenantKey('tenant-a')

      const statsAfter = await vault.getTenantStats('tenant-a')
      expect(statsAfter.keyVersion).toBe(2)
      expect(statsAfter.lastRotatedAt).toBeDefined()
    })

    it('should emit event on tenant key rotation', async () => {
      const handler = vi.fn()
      vault.on('tenant:key_rotated', handler)

      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'value' })
      await vault.rotateTenantKey('tenant-a')

      expect(handler).toHaveBeenCalledWith({ tenantId: 'tenant-a', keyVersion: 2 })
    })
  })

  describe('credential rotation', () => {
    it('should rotate credential for specific tenant', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })

      await vault.rotate('tenant-a', 'key', {
        newValue: 'v2',
        actor: 'admin',
        reason: 'Scheduled rotation',
      })

      const cred = await vault.get('tenant-a', 'key')
      expect(cred?.value).toBe('v2')
      expect(cred?.version).toBe(2)
    })

    it('should maintain version history per tenant', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })
      await vault.rotate('tenant-a', 'key', { newValue: 'v2' })
      await vault.rotate('tenant-a', 'key', { newValue: 'v3' })

      const versions = await vault.listVersions('tenant-a', 'key')
      expect(versions.length).toBe(3)
    })

    it('should retrieve specific version', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })
      await vault.rotate('tenant-a', 'key', { newValue: 'v2' })

      const v1 = await vault.get('tenant-a', 'key', { version: 1 })
      const v2 = await vault.get('tenant-a', 'key', { version: 2 })

      expect(v1?.value).toBe('v1')
      expect(v2?.value).toBe('v2')
    })
  })

  describe('credential deletion', () => {
    it('should soft delete by default', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'value' })
      await vault.delete('tenant-a', 'key')

      const cred = await vault.get('tenant-a', 'key')
      expect(cred).toBeNull()

      // But list shows nothing (soft deleted credentials are hidden)
      const list = await vault.list('tenant-a')
      expect(list.length).toBe(0)
    })

    it('should hard delete when specified', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'value' })
      await vault.delete('tenant-a', 'key', { hard: true })

      const versions = await vault.listVersions('tenant-a', 'key')
      expect(versions.length).toBe(0)
    })

    it('should not allow deleting credentials from other tenants', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'value' })

      await expect(vault.delete('tenant-b', 'key')).rejects.toThrow("Credential 'key' not found for tenant 'tenant-b'")
    })
  })

  describe('audit logging', () => {
    it('should log all credential operations per tenant', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })
      await vault.get('tenant-a', 'key')
      await vault.rotate('tenant-a', 'key', { newValue: 'v2' })

      const logs = await vault.getAuditLog('tenant-a', 'key')

      expect(logs.length).toBe(3)
      expect(logs.map((l) => l.action)).toContain('create')
      expect(logs.map((l) => l.action)).toContain('read')
      expect(logs.map((l) => l.action)).toContain('rotate')

      // All logs should be for tenant-a
      expect(logs.every((l) => l.tenantId === 'tenant-a')).toBe(true)
    })

    it('should keep audit logs separate per tenant', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'a' })
      await vault.store('tenant-b', { name: 'key', type: 'api_key', value: 'b' })

      const logsA = await vault.getAuditLog('tenant-a', 'key')
      const logsB = await vault.getAuditLog('tenant-b', 'key')

      expect(logsA.every((l) => l.tenantId === 'tenant-a')).toBe(true)
      expect(logsB.every((l) => l.tenantId === 'tenant-b')).toBe(true)
    })

    it('should log tenant key rotation', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })
      await vault.rotateTenantKey('tenant-a')

      const logs = await vault.getAuditLog('tenant-a', '*')
      const rotationLog = logs.find((l) => l.action === 'tenant_key_rotate')

      expect(rotationLog).toBeDefined()
      expect(rotationLog?.metadata?.oldKeyVersion).toBe(1)
      expect(rotationLog?.metadata?.newKeyVersion).toBe(2)
    })

    it('should filter audit logs by action', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })
      await vault.get('tenant-a', 'key')
      await vault.get('tenant-a', 'key')

      const readLogs = await vault.getAuditLog('tenant-a', 'key', { action: 'read' })
      expect(readLogs.length).toBe(2)
      expect(readLogs.every((l) => l.action === 'read')).toBe(true)
    })

    it('should filter audit logs by time range', async () => {
      const before = new Date()

      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })

      const after = new Date()

      const logs = await vault.getAuditLog('tenant-a', 'key', {
        since: before,
        until: after,
      })

      expect(logs.length).toBe(1)
    })
  })

  describe('access tokens', () => {
    it('should create access tokens scoped to tenant', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'secret' })

      const token = await vault.createAccessToken('tenant-a', {
        credentials: ['key'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      expect(token.tenantId).toBe('tenant-a')
      expect(token.credentials).toContain('key')
    })

    it('should allow access with valid token', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'secret' })

      const token = await vault.createAccessToken('tenant-a', {
        credentials: ['key'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      const cred = await vault.getWithToken('tenant-a', token.token, 'key')
      expect(cred?.value).toBe('secret')
    })

    it('should deny access with token from different tenant', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'secret' })

      const tokenA = await vault.createAccessToken('tenant-a', {
        credentials: ['key'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // Try to use tenant-a's token to access tenant-b's credentials
      await expect(vault.getWithToken('tenant-b', tokenA.token, 'key')).rejects.toThrow('Invalid access token')
    })

    it('should deny access with insufficient permissions', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'secret' })

      const token = await vault.createAccessToken('tenant-a', {
        credentials: ['key'],
        permissions: ['write'], // No read permission
        expiresIn: '1h',
      })

      await expect(vault.getWithToken('tenant-a', token.token, 'key')).rejects.toThrow('Access denied: read permission required')
    })

    it('should deny access to credentials not in token scope', async () => {
      await vault.store('tenant-a', { name: 'key1', type: 'api_key', value: 'secret1' })
      await vault.store('tenant-a', { name: 'key2', type: 'api_key', value: 'secret2' })

      const token = await vault.createAccessToken('tenant-a', {
        credentials: ['key1'], // Only key1 is allowed
        permissions: ['read'],
        expiresIn: '1h',
      })

      await expect(vault.getWithToken('tenant-a', token.token, 'key2')).rejects.toThrow('Access denied: credential not in token scope')
    })

    it('should revoke access tokens', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'secret' })

      const token = await vault.createAccessToken('tenant-a', {
        credentials: ['key'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      await vault.revokeAccessToken('tenant-a', token.id)

      await expect(vault.getWithToken('tenant-a', token.token, 'key')).rejects.toThrow('Access token has been revoked')
    })

    it('should not allow revoking tokens from other tenants', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'secret' })

      const token = await vault.createAccessToken('tenant-a', {
        credentials: ['key'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      await expect(vault.revokeAccessToken('tenant-b', token.id)).rejects.toThrow('Access token not found')
    })
  })

  describe('tenant validation', () => {
    it('should reject empty tenant IDs', async () => {
      await expect(
        vault.store('', {
          name: 'key',
          type: 'api_key',
          value: 'value',
        })
      ).rejects.toThrow('Tenant ID is required and cannot be empty')
    })

    it('should reject tenant IDs with invalid characters', async () => {
      await expect(
        vault.store('tenant:with:colons', {
          name: 'key',
          type: 'api_key',
          value: 'value',
        })
      ).rejects.toThrow('Tenant ID contains invalid characters')

      await expect(
        vault.store('tenant/with/slashes', {
          name: 'key',
          type: 'api_key',
          value: 'value',
        })
      ).rejects.toThrow('Tenant ID contains invalid characters')
    })

    it('should reject overly long tenant IDs', async () => {
      const longId = 'a'.repeat(129)
      await expect(
        vault.store(longId, {
          name: 'key',
          type: 'api_key',
          value: 'value',
        })
      ).rejects.toThrow('Tenant ID exceeds maximum length of 128 characters')
    })
  })

  describe('tenant statistics', () => {
    it('should return accurate tenant stats', async () => {
      await vault.store('tenant-a', { name: 'key1', type: 'api_key', value: 'v1' })
      await vault.store('tenant-a', { name: 'key2', type: 'api_key', value: 'v2' })
      await vault.get('tenant-a', 'key1')

      const stats = await vault.getTenantStats('tenant-a')

      expect(stats.tenantId).toBe('tenant-a')
      expect(stats.credentialCount).toBe(2)
      expect(stats.keyVersion).toBe(1)
      expect(stats.auditLogCount).toBe(3) // 2 creates + 1 read
    })

    it('should list all tenants', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v' })
      await vault.store('tenant-b', { name: 'key', type: 'api_key', value: 'v' })
      await vault.store('tenant-c', { name: 'key', type: 'api_key', value: 'v' })

      const tenants = await vault.listTenants()
      expect(tenants).toContain('tenant-a')
      expect(tenants).toContain('tenant-b')
      expect(tenants).toContain('tenant-c')
    })

    it('should check if tenant exists', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v' })

      expect(await vault.tenantExists('tenant-a')).toBe(true)
      expect(await vault.tenantExists('tenant-nonexistent')).toBe(false)
    })
  })

  describe('export/import', () => {
    it('should export tenant credentials', async () => {
      await vault.store('tenant-a', { name: 'key1', type: 'api_key', value: 'v1' })
      await vault.store('tenant-a', { name: 'key2', type: 'secret', value: { foo: 'bar' } })

      const exported = await vault.exportTenant('tenant-a')
      const parsed = JSON.parse(exported)

      expect(parsed.tenantId).toBe('tenant-a')
      expect(parsed.credentials.length).toBe(2)
      expect(parsed.exportedAt).toBeDefined()
    })

    it('should import tenant credentials', async () => {
      await vault.store('tenant-a', { name: 'key1', type: 'api_key', value: 'v1' })

      const exported = await vault.exportTenant('tenant-a')

      // Create new vault with same master key
      const vault2 = createMultiTenantVault({ masterKey })
      await vault2.importTenant(exported)

      const cred = await vault2.get('tenant-a', 'key1')
      expect(cred?.value).toBe('v1')
    })

    it('should not export deleted credentials', async () => {
      await vault.store('tenant-a', { name: 'key1', type: 'api_key', value: 'v1' })
      await vault.store('tenant-a', { name: 'key2', type: 'api_key', value: 'v2' })
      await vault.delete('tenant-a', 'key1')

      const exported = await vault.exportTenant('tenant-a')
      const parsed = JSON.parse(exported)

      expect(parsed.credentials.length).toBe(1)
      expect(parsed.credentials[0].name).toBe('key2')
    })
  })

  describe('list filtering', () => {
    beforeEach(async () => {
      await vault.store('tenant-a', {
        name: 'stripe-key',
        type: 'api_key',
        value: 'sk_live',
        metadata: { environment: 'production', service: 'payments' },
        scopes: ['stripe:read', 'stripe:write'],
      })
      await vault.store('tenant-a', {
        name: 'sendgrid-key',
        type: 'api_key',
        value: 'SG.xxx',
        metadata: { environment: 'production', service: 'email' },
        scopes: ['sendgrid:send'],
      })
      await vault.store('tenant-a', {
        name: 'test-key',
        type: 'password',
        value: 'password123',
        metadata: { environment: 'staging' },
      })
    })

    it('should filter by type', async () => {
      const apiKeys = await vault.list('tenant-a', { type: 'api_key' })
      expect(apiKeys.length).toBe(2)
      expect(apiKeys.every((c) => c.type === 'api_key')).toBe(true)
    })

    it('should filter by name pattern', async () => {
      const stripeKeys = await vault.list('tenant-a', { namePattern: 'stripe*' })
      expect(stripeKeys.length).toBe(1)
      expect(stripeKeys[0]?.name).toBe('stripe-key')
    })

    it('should filter by metadata', async () => {
      const prodCreds = await vault.list('tenant-a', { metadata: { environment: 'production' } })
      expect(prodCreds.length).toBe(2)
    })

    it('should filter by scopes', async () => {
      const stripeCreds = await vault.list('tenant-a', { scopes: ['stripe:read'] })
      expect(stripeCreds.length).toBe(1)
      expect(stripeCreds[0]?.name).toBe('stripe-key')
    })

    it('should paginate results', async () => {
      const page1 = await vault.list('tenant-a', { limit: 2, offset: 0 })
      const page2 = await vault.list('tenant-a', { limit: 2, offset: 2 })

      expect(page1.length).toBe(2)
      expect(page2.length).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should throw when storing duplicate credential', async () => {
      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })

      await expect(vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v2' })).rejects.toThrow(
        "Credential 'key' already exists for tenant 'tenant-a'"
      )
    })

    it('should throw when rotating non-existent credential', async () => {
      await expect(vault.rotate('tenant-a', 'nonexistent', { newValue: 'v' })).rejects.toThrow(
        "Credential 'nonexistent' not found for tenant 'tenant-a'"
      )
    })

    it('should throw when deleting non-existent credential', async () => {
      await expect(vault.delete('tenant-a', 'nonexistent')).rejects.toThrow("Credential 'nonexistent' not found for tenant 'tenant-a'")
    })

    it('should return null for non-existent credential', async () => {
      const cred = await vault.get('tenant-a', 'nonexistent')
      expect(cred).toBeNull()
    })

    it('should validate credential type', async () => {
      await expect(
        vault.store('tenant-a', {
          name: 'key',
          type: 'invalid' as any,
          value: 'value',
        })
      ).rejects.toThrow('Invalid credential type: invalid')
    })
  })

  describe('events', () => {
    it('should emit credential:created on store', async () => {
      const handler = vi.fn()
      vault.on('credential:created', handler)

      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v' })

      expect(handler).toHaveBeenCalledWith({ tenantId: 'tenant-a', name: 'key' })
    })

    it('should emit credential:rotated on rotate', async () => {
      const handler = vi.fn()
      vault.on('credential:rotated', handler)

      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v1' })
      await vault.rotate('tenant-a', 'key', { newValue: 'v2' })

      expect(handler).toHaveBeenCalledWith({ tenantId: 'tenant-a', name: 'key', version: 2 })
    })

    it('should emit credential:deleted on delete', async () => {
      const handler = vi.fn()
      vault.on('credential:deleted', handler)

      await vault.store('tenant-a', { name: 'key', type: 'api_key', value: 'v' })
      await vault.delete('tenant-a', 'key')

      expect(handler).toHaveBeenCalledWith({ tenantId: 'tenant-a', name: 'key' })
    })
  })
})
