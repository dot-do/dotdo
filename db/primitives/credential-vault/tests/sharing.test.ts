/**
 * Credential Sharing Tests
 *
 * Tests for cross-DO credential sharing functionality:
 * - Delegation tokens (creation, validation, expiration)
 * - Scope-based access control
 * - Revocation propagation
 * - Audit logging
 *
 * @module db/primitives/credential-vault/tests/sharing
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CredentialSharingManager,
  createCredentialSharingManager,
  createCredentialVaultRPC,
  type DelegationToken,
  type DelegationTokenOptions,
  type RevocationBroadcast,
  type CredentialSharingConfig,
} from '../sharing'

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestConfig(overrides?: Partial<CredentialSharingConfig>): CredentialSharingConfig {
  return {
    tenantId: 'test-tenant',
    sourceDoId: 'source-do-123',
    signingKey: 'test-signing-key-must-be-32-chars!',
    ...overrides,
  }
}

function createTestManager(overrides?: Partial<CredentialSharingConfig>): CredentialSharingManager {
  return createCredentialSharingManager(createTestConfig(overrides))
}

// =============================================================================
// DELEGATION TOKEN CREATION TESTS
// =============================================================================

describe('CredentialSharingManager', () => {
  describe('Delegation Token Creation', () => {
    it('should create a delegation token with credentials', async () => {
      const manager = createTestManager()

      const token = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['stripe-api-key', 'sendgrid-key'],
        permissions: ['read'],
        expiresIn: '5m',
        purpose: 'Payment workflow',
      })

      expect(token.id).toBeDefined()
      expect(token.token).toBeDefined()
      expect(token.token.length).toBeGreaterThan(32)
      expect(token.sourceDoId).toBe('source-do-123')
      expect(token.targetDoId).toBe('target-do-456')
      expect(token.credentials).toEqual(['stripe-api-key', 'sendgrid-key'])
      expect(token.permissions).toContain('read')
      expect(token.purpose).toBe('Payment workflow')
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('should create a delegation token with scopes', async () => {
      const manager = createTestManager()

      const token = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        scopes: ['payments:*', 'analytics:read'],
        permissions: ['read', 'use'],
        expiresIn: '1h',
      })

      expect(token.scopes).toEqual(['payments:*', 'analytics:read'])
      expect(token.permissions).toContain('use')
    })

    it('should create single-use delegation token', async () => {
      const manager = createTestManager()

      const token = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
        singleUse: true,
      })

      expect(token.singleUse).toBe(true)
      expect(token.used).toBeFalsy()
    })

    it('should create token with max uses limit', async () => {
      const manager = createTestManager()

      const token = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
        maxUses: 3,
      })

      expect(token.maxUses).toBe(3)
      expect(token.useCount).toBe(0)
    })

    it('should require target DO ID', async () => {
      const manager = createTestManager()

      await expect(
        manager.createDelegationToken({
          targetDoId: '',
          credentials: ['api-key'],
          permissions: ['read'],
          expiresIn: '5m',
        })
      ).rejects.toThrow(/targetDoId.*required/i)
    })

    it('should require permissions', async () => {
      const manager = createTestManager()

      await expect(
        manager.createDelegationToken({
          targetDoId: 'target-do-456',
          credentials: ['api-key'],
          permissions: [],
          expiresIn: '5m',
        })
      ).rejects.toThrow(/permission.*required/i)
    })

    it('should require credentials or scopes', async () => {
      const manager = createTestManager()

      await expect(
        manager.createDelegationToken({
          targetDoId: 'target-do-456',
          permissions: ['read'],
          expiresIn: '5m',
        })
      ).rejects.toThrow(/credentials.*scopes.*specified/i)
    })

    it('should emit delegation:created event', async () => {
      const manager = createTestManager()
      const events: DelegationToken[] = []

      manager.on('delegation:created', (token) => events.push(token))

      await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      expect(events).toHaveLength(1)
      expect(events[0].targetDoId).toBe('target-do-456')
    })
  })

  // ===========================================================================
  // DELEGATION TOKEN VALIDATION TESTS
  // ===========================================================================

  describe('Delegation Token Validation', () => {
    it('should validate token for correct target DO', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['stripe-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const result = await manager.validateDelegation(delegation.token, 'stripe-key', 'target-do-456')

      expect(result.granted).toBe(true)
      expect(result.auditId).toBeDefined()
    })

    it('should deny invalid token', async () => {
      const manager = createTestManager()

      const result = await manager.validateDelegation('invalid-token', 'stripe-key', 'target-do-456')

      expect(result.granted).toBe(false)
      expect(result.error?.code).toBe('INVALID_TOKEN')
    })

    it('should deny token for wrong target DO', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['stripe-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const result = await manager.validateDelegation(delegation.token, 'stripe-key', 'wrong-do-789')

      expect(result.granted).toBe(false)
      expect(result.error?.code).toBe('TARGET_MISMATCH')
    })

    it('should deny token for credential not in scope', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['stripe-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const result = await manager.validateDelegation(delegation.token, 'sendgrid-key', 'target-do-456')

      expect(result.granted).toBe(false)
      expect(result.error?.code).toBe('CREDENTIAL_NOT_ALLOWED')
    })

    it('should deny expired token', async () => {
      vi.useFakeTimers()

      try {
        const manager = createTestManager()

        const delegation = await manager.createDelegationToken({
          targetDoId: 'target-do-456',
          credentials: ['api-key'],
          permissions: ['read'],
          expiresIn: '5m',
        })

        // Advance time past expiry
        vi.advanceTimersByTime(6 * 60 * 1000) // 6 minutes

        const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')

        expect(result.granted).toBe(false)
        expect(result.error?.code).toBe('TOKEN_EXPIRED')
      } finally {
        vi.useRealTimers()
      }
    })

    it('should deny revoked token', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.revokeDelegationToken(delegation.id, 'Security concern')

      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')

      expect(result.granted).toBe(false)
      expect(result.error?.code).toBe('TOKEN_REVOKED')
    })

    it('should deny single-use token after first use', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
        singleUse: true,
      })

      // First use should succeed
      const result1 = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result1.granted).toBe(true)

      // Second use should fail
      const result2 = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result2.granted).toBe(false)
      expect(result2.error?.code).toBe('TOKEN_ALREADY_USED')
    })

    it('should deny token after max uses exceeded', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
        maxUses: 2,
      })

      // First two uses should succeed
      await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')

      // Third use should fail
      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result.granted).toBe(false)
      expect(result.error?.code).toBe('MAX_USES_EXCEEDED')
    })

    it('should emit delegation:used event on successful validation', async () => {
      const manager = createTestManager()
      const events: { tokenId: string; credentialName: string }[] = []

      manager.on('delegation:used', (e) => events.push(e))

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')

      expect(events).toHaveLength(1)
      expect(events[0].credentialName).toBe('api-key')
    })

    it('should emit delegation:denied event on failed validation', async () => {
      const manager = createTestManager()
      const events: { tokenId: string; reason: string }[] = []

      manager.on('delegation:denied', (e) => events.push(e))

      await manager.validateDelegation('invalid-token', 'api-key', 'target-do-456')

      expect(events).toHaveLength(1)
      expect(events[0].reason).toContain('not found')
    })
  })

  // ===========================================================================
  // SCOPE-BASED ACCESS TESTS
  // ===========================================================================

  describe('Scope-Based Access', () => {
    it('should grant access with matching wildcard scope', async () => {
      const manager = createTestManager()

      // Register credential scopes
      manager.registerCredentialScope('stripe-live-key', 'payments:stripe:live')
      manager.registerCredentialScope('stripe-test-key', 'payments:stripe:test')
      manager.registerCredentialScope('sendgrid-key', 'email:sendgrid')

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        scopes: ['payments:*'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      // Should grant access to payment credentials
      const result1 = await manager.validateDelegation(delegation.token, 'stripe-live-key', 'target-do-456')
      expect(result1.granted).toBe(true)

      const result2 = await manager.validateDelegation(delegation.token, 'stripe-test-key', 'target-do-456')
      expect(result2.granted).toBe(true)

      // Should deny access to non-payment credentials
      const result3 = await manager.validateDelegation(delegation.token, 'sendgrid-key', 'target-do-456')
      expect(result3.granted).toBe(false)
    })

    it('should support registering multiple scopes at once', async () => {
      const manager = createTestManager()

      manager.registerCredentialScopes({
        'stripe-key': 'payments:stripe',
        'paypal-key': 'payments:paypal',
        'twilio-key': 'messaging:twilio',
      })

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        scopes: ['payments:*'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const result1 = await manager.validateDelegation(delegation.token, 'stripe-key', 'target-do-456')
      expect(result1.granted).toBe(true)

      const result2 = await manager.validateDelegation(delegation.token, 'paypal-key', 'target-do-456')
      expect(result2.granted).toBe(true)

      const result3 = await manager.validateDelegation(delegation.token, 'twilio-key', 'target-do-456')
      expect(result3.granted).toBe(false)
    })
  })

  // ===========================================================================
  // REVOCATION TESTS
  // ===========================================================================

  describe('Token Revocation', () => {
    it('should revoke token by ID', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.revokeDelegationToken(delegation.id, 'Security concern')

      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result.granted).toBe(false)
      expect(result.error?.code).toBe('TOKEN_REVOKED')
    })

    it('should revoke all tokens for a target DO', async () => {
      const manager = createTestManager()

      const token1 = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['key-1'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token2 = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['key-2'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token3 = await manager.createDelegationToken({
        targetDoId: 'other-do-789',
        credentials: ['key-3'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const revokedCount = await manager.revokeAllForTarget('target-do-456', 'DO terminated')

      expect(revokedCount).toBe(2)

      // Tokens for target DO should be revoked
      const result1 = await manager.validateDelegation(token1.token, 'key-1', 'target-do-456')
      expect(result1.granted).toBe(false)

      const result2 = await manager.validateDelegation(token2.token, 'key-2', 'target-do-456')
      expect(result2.granted).toBe(false)

      // Token for other DO should still work
      const result3 = await manager.validateDelegation(token3.token, 'key-3', 'other-do-789')
      expect(result3.granted).toBe(true)
    })

    it('should revoke all tokens for a credential', async () => {
      const manager = createTestManager()

      const token1 = await manager.createDelegationToken({
        targetDoId: 'do-1',
        credentials: ['stripe-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token2 = await manager.createDelegationToken({
        targetDoId: 'do-2',
        credentials: ['stripe-key', 'other-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token3 = await manager.createDelegationToken({
        targetDoId: 'do-3',
        credentials: ['sendgrid-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const revokedCount = await manager.revokeAllForCredential('stripe-key', 'Key compromised')

      expect(revokedCount).toBe(2)

      // Tokens with stripe-key should be revoked
      const result1 = await manager.validateDelegation(token1.token, 'stripe-key', 'do-1')
      expect(result1.granted).toBe(false)

      const result2 = await manager.validateDelegation(token2.token, 'stripe-key', 'do-2')
      expect(result2.granted).toBe(false)

      // Token without stripe-key should still work
      const result3 = await manager.validateDelegation(token3.token, 'sendgrid-key', 'do-3')
      expect(result3.granted).toBe(true)
    })

    it('should emit delegation:revoked event', async () => {
      const manager = createTestManager()
      const events: { tokenId: string; reason: string }[] = []

      manager.on('delegation:revoked', (e) => events.push(e))

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.revokeDelegationToken(delegation.id, 'Test revocation')

      expect(events).toHaveLength(1)
      expect(events[0].tokenId).toBe(delegation.id)
      expect(events[0].reason).toBe('Test revocation')
    })

    it('should throw on revoking non-existent token', async () => {
      const manager = createTestManager()

      await expect(manager.revokeDelegationToken('non-existent-id')).rejects.toThrow(/not found/i)
    })
  })

  // ===========================================================================
  // REVOCATION BROADCAST TESTS
  // ===========================================================================

  describe('Revocation Broadcast', () => {
    it('should handle token revocation broadcast', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      // Simulate broadcast from another DO
      const broadcast: RevocationBroadcast = {
        type: 'token',
        targetId: delegation.id,
        tenantId: 'test-tenant',
        revokedAt: new Date(),
        reason: 'Remote revocation',
      }

      manager.handleRevocationBroadcast(broadcast)

      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result.granted).toBe(false)
    })

    it('should handle credential revocation broadcast', async () => {
      const manager = createTestManager()

      const token1 = await manager.createDelegationToken({
        targetDoId: 'do-1',
        credentials: ['stripe-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token2 = await manager.createDelegationToken({
        targetDoId: 'do-2',
        credentials: ['sendgrid-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      // Broadcast credential revocation
      const broadcast: RevocationBroadcast = {
        type: 'credential',
        targetId: 'stripe-key',
        tenantId: 'test-tenant',
        revokedAt: new Date(),
      }

      manager.handleRevocationBroadcast(broadcast)

      // Token with stripe-key should be revoked
      const result1 = await manager.validateDelegation(token1.token, 'stripe-key', 'do-1')
      expect(result1.granted).toBe(false)

      // Token without stripe-key should still work
      const result2 = await manager.validateDelegation(token2.token, 'sendgrid-key', 'do-2')
      expect(result2.granted).toBe(true)
    })

    it('should handle tenant revocation broadcast', async () => {
      const manager = createTestManager()

      const token1 = await manager.createDelegationToken({
        targetDoId: 'do-1',
        credentials: ['key-1'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token2 = await manager.createDelegationToken({
        targetDoId: 'do-2',
        credentials: ['key-2'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      // Broadcast tenant-wide revocation
      const broadcast: RevocationBroadcast = {
        type: 'tenant',
        targetId: 'test-tenant',
        tenantId: 'test-tenant',
        revokedAt: new Date(),
        reason: 'Tenant suspended',
      }

      manager.handleRevocationBroadcast(broadcast)

      // All tokens should be revoked
      const result1 = await manager.validateDelegation(token1.token, 'key-1', 'do-1')
      expect(result1.granted).toBe(false)

      const result2 = await manager.validateDelegation(token2.token, 'key-2', 'do-2')
      expect(result2.granted).toBe(false)
    })

    it('should ignore broadcast from different tenant', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      // Broadcast from different tenant
      const broadcast: RevocationBroadcast = {
        type: 'token',
        targetId: delegation.id,
        tenantId: 'other-tenant',
        revokedAt: new Date(),
      }

      manager.handleRevocationBroadcast(broadcast)

      // Token should still be valid
      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result.granted).toBe(true)
    })

    it('should emit revocation:received event', async () => {
      const manager = createTestManager()
      const events: RevocationBroadcast[] = []

      manager.on('revocation:received', (e) => events.push(e))

      const broadcast: RevocationBroadcast = {
        type: 'credential',
        targetId: 'some-key',
        tenantId: 'test-tenant',
        revokedAt: new Date(),
      }

      manager.handleRevocationBroadcast(broadcast)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('credential')
    })
  })

  // ===========================================================================
  // AUDIT LOGGING TESTS
  // ===========================================================================

  describe('Audit Logging', () => {
    it('should log token creation', async () => {
      const manager = createTestManager()

      await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const logs = manager.getAuditLog({ type: 'created' })

      expect(logs).toHaveLength(1)
      expect(logs[0].type).toBe('created')
      expect(logs[0].targetDoId).toBe('target-do-456')
    })

    it('should log successful access', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456', {
        workflowId: 'wf-123',
        stepId: 'step-1',
      })

      const logs = manager.getAuditLog({ type: 'used' })

      expect(logs).toHaveLength(1)
      expect(logs[0].credentialName).toBe('api-key')
      expect(logs[0].context?.workflowId).toBe('wf-123')
    })

    it('should log access denials', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.validateDelegation(delegation.token, 'unauthorized-key', 'target-do-456')

      const logs = manager.getAuditLog({ type: 'denied' })

      expect(logs).toHaveLength(1)
      expect(logs[0].credentialName).toBe('unauthorized-key')
      expect(logs[0].error?.code).toBe('CREDENTIAL_NOT_ALLOWED')
    })

    it('should log token revocation', async () => {
      const manager = createTestManager()

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.revokeDelegationToken(delegation.id)

      const logs = manager.getAuditLog({ type: 'revoked' })

      expect(logs).toHaveLength(1)
      expect(logs[0].delegationTokenId).toBe(delegation.id)
    })

    it('should filter audit logs by target DO', async () => {
      const manager = createTestManager()

      await manager.createDelegationToken({
        targetDoId: 'do-1',
        credentials: ['key-1'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.createDelegationToken({
        targetDoId: 'do-2',
        credentials: ['key-2'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const logs = manager.getAuditLog({ targetDoId: 'do-1' })

      expect(logs).toHaveLength(1)
      expect(logs[0].targetDoId).toBe('do-1')
    })

    it('should filter audit logs by time', async () => {
      const manager = createTestManager()

      const beforeTime = new Date()

      await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const logs = manager.getAuditLog({ since: beforeTime })

      expect(logs.length).toBeGreaterThan(0)
      expect(logs.every((l) => l.timestamp >= beforeTime)).toBe(true)
    })

    it('should limit audit log results', async () => {
      const manager = createTestManager()

      for (let i = 0; i < 10; i++) {
        await manager.createDelegationToken({
          targetDoId: `do-${i}`,
          credentials: ['key'],
          permissions: ['read'],
          expiresIn: '5m',
        })
      }

      const logs = manager.getAuditLog({ limit: 5 })

      expect(logs).toHaveLength(5)
    })
  })

  // ===========================================================================
  // STATISTICS AND MONITORING TESTS
  // ===========================================================================

  describe('Statistics and Monitoring', () => {
    it('should return active delegations', async () => {
      const manager = createTestManager()

      await manager.createDelegationToken({
        targetDoId: 'do-1',
        credentials: ['key-1'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const token2 = await manager.createDelegationToken({
        targetDoId: 'do-2',
        credentials: ['key-2'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await manager.revokeDelegationToken(token2.id)

      const active = manager.getActiveDelegations()

      expect(active).toHaveLength(1)
      expect(active[0].targetDoId).toBe('do-1')
      // Should not include raw token
      expect((active[0] as unknown as { token: string }).token).toBeUndefined()
    })

    it('should return delegation statistics', async () => {
      vi.useFakeTimers()

      try {
        const manager = createTestManager()

        // Create some tokens
        const token1 = await manager.createDelegationToken({
          targetDoId: 'do-1',
          credentials: ['key-1'],
          permissions: ['read'],
          expiresIn: '5m',
        })

        const token2 = await manager.createDelegationToken({
          targetDoId: 'do-2',
          credentials: ['key-2'],
          permissions: ['read'],
          expiresIn: '1m',
        })

        const token3 = await manager.createDelegationToken({
          targetDoId: 'do-3',
          credentials: ['key-3'],
          permissions: ['read'],
          expiresIn: '5m',
        })

        // Use one token
        await manager.validateDelegation(token1.token, 'key-1', 'do-1')

        // Revoke one token
        await manager.revokeDelegationToken(token3.id)

        // Expire one token
        vi.advanceTimersByTime(2 * 60 * 1000)

        const stats = manager.getStats()

        expect(stats.totalCreated).toBe(3)
        expect(stats.active).toBe(1) // Only token1 is active
        expect(stats.revoked).toBe(1)
        expect(stats.expired).toBe(1)
        expect(stats.used).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should cleanup expired tokens', async () => {
      vi.useFakeTimers()

      try {
        const manager = createTestManager()

        await manager.createDelegationToken({
          targetDoId: 'do-1',
          credentials: ['key-1'],
          permissions: ['read'],
          expiresIn: '1m',
        })

        await manager.createDelegationToken({
          targetDoId: 'do-2',
          credentials: ['key-2'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        // Advance time past 24 hours after expiry
        vi.advanceTimersByTime(25 * 60 * 60 * 1000)

        const cleanedCount = manager.cleanupExpiredTokens()

        expect(cleanedCount).toBe(1)

        const stats = manager.getStats()
        expect(stats.totalCreated).toBe(1) // Only the 1h token remains
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // ===========================================================================
  // RPC HANDLER TESTS
  // ===========================================================================

  describe('RPC Handler', () => {
    it('should create RPC handler', () => {
      const manager = createTestManager()
      const rpc = createCredentialVaultRPC(manager)

      expect(rpc.requestCredential).toBeDefined()
      expect(rpc.createDelegation).toBeDefined()
      expect(rpc.revokeDelegation).toBeDefined()
      expect(rpc.validateDelegation).toBeDefined()
      expect(rpc.handleRevocation).toBeDefined()
    })

    it('should handle credential request via RPC', async () => {
      const manager = createTestManager()
      const rpc = createCredentialVaultRPC(manager)

      const delegation = await rpc.createDelegation({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const result = await rpc.requestCredential({
        delegationToken: delegation.token,
        credentialName: 'api-key',
        requestingDoId: 'target-do-456',
      })

      expect(result.granted).toBe(true)
    })

    it('should validate delegation via RPC', async () => {
      const manager = createTestManager()
      const rpc = createCredentialVaultRPC(manager)

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      const result = await rpc.validateDelegation(delegation.token, 'api-key', 'target-do-456')

      expect(result.valid).toBe(true)
    })

    it('should revoke delegation via RPC', async () => {
      const manager = createTestManager()
      const rpc = createCredentialVaultRPC(manager)

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await rpc.revokeDelegation(delegation.id, 'Test revocation')

      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result.granted).toBe(false)
    })

    it('should handle revocation via RPC', async () => {
      const manager = createTestManager()
      const rpc = createCredentialVaultRPC(manager)

      const delegation = await manager.createDelegationToken({
        targetDoId: 'target-do-456',
        credentials: ['api-key'],
        permissions: ['read'],
        expiresIn: '5m',
      })

      await rpc.handleRevocation({
        type: 'token',
        targetId: delegation.id,
        tenantId: 'test-tenant',
        revokedAt: new Date(),
      })

      const result = await manager.validateDelegation(delegation.token, 'api-key', 'target-do-456')
      expect(result.granted).toBe(false)
    })
  })

  // ===========================================================================
  // ERROR HANDLING TESTS
  // ===========================================================================

  describe('Error Handling', () => {
    it('should require tenant ID', () => {
      expect(() =>
        createCredentialSharingManager({
          tenantId: '',
          sourceDoId: 'source-do-123',
          signingKey: 'test-signing-key-must-be-32-chars!',
        })
      ).toThrow(/tenantId.*required/i)
    })

    it('should require source DO ID', () => {
      expect(() =>
        createCredentialSharingManager({
          tenantId: 'test-tenant',
          sourceDoId: '',
          signingKey: 'test-signing-key-must-be-32-chars!',
        })
      ).toThrow(/sourceDoId.*required/i)
    })

    it('should require signing key of sufficient length', () => {
      expect(() =>
        createCredentialSharingManager({
          tenantId: 'test-tenant',
          sourceDoId: 'source-do-123',
          signingKey: 'short',
        })
      ).toThrow(/signingKey.*32/i)
    })
  })
})
