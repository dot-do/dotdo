/**
 * Capability Token System Tests
 *
 * TDD tests for HMAC-signed capability tokens that enable three-party handoff:
 * - Auth service creates token with shared secret
 * - Broker passes token opaquely (cannot use it)
 * - Worker verifies token with shared secret
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CapabilityPayload,
  CapabilityError,
  createCapabilityToken,
  verifyCapabilityToken,
  attenuateCapability,
  isMethodAllowed,
  isScopeAllowed,
} from '../capability-token'

describe('Capability Tokens', () => {
  const testSecret = 'test-secret-key-for-hmac-signing-256-bits'

  describe('Token Creation', () => {
    it('should create HMAC-signed capability token', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-123',
        methods: ['getData', 'setData'],
        scope: 'write',
        exp: Date.now() + 3600000, // 1 hour from now
      }

      const token = await createCapabilityToken(payload, testSecret)

      // Token should be a string with two base64 parts separated by a dot
      expect(typeof token).toBe('string')
      expect(token.split('.').length).toBe(2)

      // Both parts should be valid base64url
      const [payloadPart, signaturePart] = token.split('.')
      expect(payloadPart.length).toBeGreaterThan(0)
      expect(signaturePart.length).toBeGreaterThan(0)
    })

    it('should include target, method, expiry in token', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-abc',
        methods: ['read', 'write', 'delete'],
        scope: 'admin',
        exp: Date.now() + 7200000,
        sub: 'user-456',
      }

      const token = await createCapabilityToken(payload, testSecret)
      const verified = await verifyCapabilityToken(token, testSecret)

      expect(verified.target).toBe('worker-abc')
      expect(verified.methods).toEqual(['read', 'write', 'delete'])
      expect(verified.scope).toBe('admin')
      expect(verified.sub).toBe('user-456')
      expect(verified.exp).toBe(payload.exp)
    })

    it('should support scoped capabilities (read-only, etc.)', async () => {
      const readOnlyPayload: CapabilityPayload = {
        target: 'worker-data',
        methods: ['get', 'list', 'query'],
        scope: 'read',
        exp: Date.now() + 3600000,
      }

      const writePayload: CapabilityPayload = {
        target: 'worker-data',
        methods: ['get', 'set', 'delete'],
        scope: 'write',
        exp: Date.now() + 3600000,
      }

      const adminPayload: CapabilityPayload = {
        target: 'worker-data',
        methods: ['*'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      }

      const readToken = await createCapabilityToken(readOnlyPayload, testSecret)
      const writeToken = await createCapabilityToken(writePayload, testSecret)
      const adminToken = await createCapabilityToken(adminPayload, testSecret)

      const readVerified = await verifyCapabilityToken(readToken, testSecret)
      const writeVerified = await verifyCapabilityToken(writeToken, testSecret)
      const adminVerified = await verifyCapabilityToken(adminToken, testSecret)

      expect(readVerified.scope).toBe('read')
      expect(writeVerified.scope).toBe('write')
      expect(adminVerified.scope).toBe('admin')
    })

    it('should auto-set iat (issued at) if not provided', async () => {
      const before = Date.now()

      const payload: CapabilityPayload = {
        target: 'worker-123',
        methods: ['test'],
        scope: 'read',
        exp: Date.now() + 3600000,
      }

      const token = await createCapabilityToken(payload, testSecret)
      const verified = await verifyCapabilityToken(token, testSecret)

      const after = Date.now()

      expect(verified.iat).toBeDefined()
      expect(verified.iat).toBeGreaterThanOrEqual(before)
      expect(verified.iat).toBeLessThanOrEqual(after)
    })

    it('should preserve iat if explicitly provided', async () => {
      const specificIat = Date.now() - 60000 // 1 minute ago

      const payload: CapabilityPayload = {
        target: 'worker-123',
        methods: ['test'],
        scope: 'read',
        exp: Date.now() + 3600000,
        iat: specificIat,
      }

      const token = await createCapabilityToken(payload, testSecret)
      const verified = await verifyCapabilityToken(token, testSecret)

      expect(verified.iat).toBe(specificIat)
    })
  })

  describe('Token Verification', () => {
    it('should verify valid token with shared secret', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-xyz',
        methods: ['processOrder', 'getStatus'],
        scope: 'write',
        exp: Date.now() + 3600000,
        sub: 'service-account-1',
      }

      const token = await createCapabilityToken(payload, testSecret)
      const verified = await verifyCapabilityToken(token, testSecret)

      expect(verified.target).toBe(payload.target)
      expect(verified.methods).toEqual(payload.methods)
      expect(verified.scope).toBe(payload.scope)
      expect(verified.sub).toBe(payload.sub)
    })

    it('should reject expired token', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-123',
        methods: ['test'],
        scope: 'read',
        exp: Date.now() - 1000, // Expired 1 second ago
      }

      const token = await createCapabilityToken(payload, testSecret)

      await expect(verifyCapabilityToken(token, testSecret)).rejects.toThrow(CapabilityError)

      try {
        await verifyCapabilityToken(token, testSecret)
      } catch (err) {
        expect(err).toBeInstanceOf(CapabilityError)
        expect((err as CapabilityError).code).toBe('EXPIRED')
      }
    })

    it('should reject tampered token', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-123',
        methods: ['getData'],
        scope: 'read',
        exp: Date.now() + 3600000,
      }

      const token = await createCapabilityToken(payload, testSecret)

      // Tamper with the payload to try to escalate privileges
      const [payloadPart, signature] = token.split('.')
      const decodedPayload = JSON.parse(atob(payloadPart))
      decodedPayload.scope = 'admin' // Try to escalate
      decodedPayload.methods = ['*'] // Try to add all methods
      const tamperedPayloadPart = btoa(JSON.stringify(decodedPayload))
      const tamperedToken = `${tamperedPayloadPart}.${signature}`

      await expect(verifyCapabilityToken(tamperedToken, testSecret)).rejects.toThrow(CapabilityError)

      try {
        await verifyCapabilityToken(tamperedToken, testSecret)
      } catch (err) {
        expect(err).toBeInstanceOf(CapabilityError)
        expect((err as CapabilityError).code).toBe('INVALID_SIGNATURE')
      }
    })

    it('should reject token with wrong secret', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-123',
        methods: ['test'],
        scope: 'read',
        exp: Date.now() + 3600000,
      }

      const token = await createCapabilityToken(payload, testSecret)
      const wrongSecret = 'different-secret-key-that-does-not-match'

      await expect(verifyCapabilityToken(token, wrongSecret)).rejects.toThrow(CapabilityError)

      try {
        await verifyCapabilityToken(token, wrongSecret)
      } catch (err) {
        expect(err).toBeInstanceOf(CapabilityError)
        expect((err as CapabilityError).code).toBe('INVALID_SIGNATURE')
      }
    })

    it('should reject malformed tokens', async () => {
      await expect(verifyCapabilityToken('not-a-valid-token', testSecret)).rejects.toThrow(
        CapabilityError
      )

      await expect(verifyCapabilityToken('', testSecret)).rejects.toThrow(CapabilityError)

      await expect(verifyCapabilityToken('just.one.part', testSecret)).rejects.toThrow(
        CapabilityError
      )
    })
  })

  describe('Three-Party Handoff', () => {
    const authSecret = 'shared-secret-between-auth-and-worker'

    it('should pass token opaquely through broker', async () => {
      // Step 1: Auth service creates token
      const payload: CapabilityPayload = {
        target: 'worker-processing',
        methods: ['processTask', 'getResult'],
        scope: 'write',
        exp: Date.now() + 3600000,
        sub: 'client-app-1',
      }

      const token = await createCapabilityToken(payload, authSecret)

      // Step 2: Broker receives and forwards token (opaque - cannot verify or use)
      const brokerReceivedToken = token // Just passes through

      // Broker cannot use the token without the secret
      const brokerWrongSecret = 'broker-does-not-have-the-secret'
      await expect(
        verifyCapabilityToken(brokerReceivedToken, brokerWrongSecret)
      ).rejects.toThrow()

      // Step 3: Worker verifies token with shared secret
      const workerVerified = await verifyCapabilityToken(brokerReceivedToken, authSecret)

      expect(workerVerified.target).toBe('worker-processing')
      expect(workerVerified.methods).toEqual(['processTask', 'getResult'])
      expect(workerVerified.sub).toBe('client-app-1')
    })

    it('should allow worker to verify without broker seeing secret', async () => {
      // Auth creates token
      const payload: CapabilityPayload = {
        target: 'secure-worker',
        methods: ['sensitiveOperation'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      }

      const token = await createCapabilityToken(payload, authSecret)

      // Broker can see the token string but cannot:
      // 1. Verify its authenticity
      // 2. Modify it without detection
      // 3. Create new valid tokens

      // Broker tries to forge a token
      const forgedPayload: CapabilityPayload = {
        target: 'secure-worker',
        methods: ['sensitiveOperation'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      }
      const brokerForgedToken = await createCapabilityToken(forgedPayload, 'brokers-fake-secret')

      // Worker rejects forged token
      await expect(verifyCapabilityToken(brokerForgedToken, authSecret)).rejects.toThrow()

      // Worker accepts real token
      const verified = await verifyCapabilityToken(token, authSecret)
      expect(verified.target).toBe('secure-worker')
    })

    it('should support capability attenuation', async () => {
      // Parent creates a broad capability
      const parentPayload: CapabilityPayload = {
        target: 'worker-data',
        methods: ['read', 'write', 'delete', 'admin'],
        scope: 'admin',
        exp: Date.now() + 3600000,
        sub: 'parent-service',
      }

      const parentToken = await createCapabilityToken(parentPayload, authSecret)

      // Attenuate to create a more restricted capability
      const childToken = await attenuateCapability(parentToken, authSecret, {
        methods: ['read', 'write'], // Remove delete and admin
        scope: 'write', // Downgrade from admin to write
        exp: Date.now() + 1800000, // Shorter expiry (30 min instead of 1 hour)
      })

      const childVerified = await verifyCapabilityToken(childToken, authSecret)

      // Child has restricted permissions
      expect(childVerified.methods).toEqual(['read', 'write'])
      expect(childVerified.scope).toBe('write')
      expect(childVerified.exp).toBeLessThan(parentPayload.exp)

      // Original parent token still has full permissions
      const parentVerified = await verifyCapabilityToken(parentToken, authSecret)
      expect(parentVerified.methods).toEqual(['read', 'write', 'delete', 'admin'])
      expect(parentVerified.scope).toBe('admin')
    })

    it('should prevent capability escalation via attenuation', async () => {
      const parentPayload: CapabilityPayload = {
        target: 'worker-data',
        methods: ['read'],
        scope: 'read',
        exp: Date.now() + 3600000,
      }

      const parentToken = await createCapabilityToken(parentPayload, authSecret)

      // Cannot add methods
      await expect(
        attenuateCapability(parentToken, authSecret, {
          methods: ['read', 'write'], // Trying to add 'write'
        })
      ).rejects.toThrow()

      // Cannot escalate scope
      await expect(
        attenuateCapability(parentToken, authSecret, {
          scope: 'admin', // Trying to escalate from read to admin
        })
      ).rejects.toThrow()

      // Cannot extend expiry
      await expect(
        attenuateCapability(parentToken, authSecret, {
          exp: Date.now() + 7200000, // Trying to extend expiry
        })
      ).rejects.toThrow()
    })
  })

  describe('Method Authorization', () => {
    it('should check if specific method is allowed', () => {
      const capability: CapabilityPayload = {
        target: 'worker-test',
        methods: ['getData', 'setData', 'deleteData'],
        scope: 'write',
        exp: Date.now() + 3600000,
      }

      expect(isMethodAllowed(capability, 'getData')).toBe(true)
      expect(isMethodAllowed(capability, 'setData')).toBe(true)
      expect(isMethodAllowed(capability, 'deleteData')).toBe(true)
      expect(isMethodAllowed(capability, 'adminReset')).toBe(false)
      expect(isMethodAllowed(capability, 'unknownMethod')).toBe(false)
    })

    it('should allow all methods with wildcard', () => {
      const capability: CapabilityPayload = {
        target: 'worker-test',
        methods: ['*'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      }

      expect(isMethodAllowed(capability, 'anyMethod')).toBe(true)
      expect(isMethodAllowed(capability, 'anotherMethod')).toBe(true)
      expect(isMethodAllowed(capability, 'getData')).toBe(true)
    })
  })

  describe('Scope Authorization', () => {
    it('should check scope hierarchy (read < write < admin)', () => {
      const readCap: CapabilityPayload = {
        target: 'worker-test',
        methods: ['test'],
        scope: 'read',
        exp: Date.now() + 3600000,
      }

      const writeCap: CapabilityPayload = {
        target: 'worker-test',
        methods: ['test'],
        scope: 'write',
        exp: Date.now() + 3600000,
      }

      const adminCap: CapabilityPayload = {
        target: 'worker-test',
        methods: ['test'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      }

      // Read scope can only do read operations
      expect(isScopeAllowed(readCap, 'read')).toBe(true)
      expect(isScopeAllowed(readCap, 'write')).toBe(false)
      expect(isScopeAllowed(readCap, 'admin')).toBe(false)

      // Write scope can do read and write
      expect(isScopeAllowed(writeCap, 'read')).toBe(true)
      expect(isScopeAllowed(writeCap, 'write')).toBe(true)
      expect(isScopeAllowed(writeCap, 'admin')).toBe(false)

      // Admin scope can do everything
      expect(isScopeAllowed(adminCap, 'read')).toBe(true)
      expect(isScopeAllowed(adminCap, 'write')).toBe(true)
      expect(isScopeAllowed(adminCap, 'admin')).toBe(true)
    })
  })

  describe('CapabilityError', () => {
    it('should include error code in CapabilityError', () => {
      const expiredError = new CapabilityError('Token has expired', 'EXPIRED')
      expect(expiredError.message).toBe('Token has expired')
      expect(expiredError.code).toBe('EXPIRED')
      expect(expiredError).toBeInstanceOf(Error)

      const signatureError = new CapabilityError('Invalid signature', 'INVALID_SIGNATURE')
      expect(signatureError.code).toBe('INVALID_SIGNATURE')

      const targetError = new CapabilityError('Wrong target', 'WRONG_TARGET')
      expect(targetError.code).toBe('WRONG_TARGET')

      const scopeError = new CapabilityError('Insufficient scope', 'INSUFFICIENT_SCOPE')
      expect(scopeError.code).toBe('INSUFFICIENT_SCOPE')
    })
  })

  describe('Target Validation', () => {
    it('should allow specifying and checking target', async () => {
      const payload: CapabilityPayload = {
        target: 'worker-specific',
        methods: ['process'],
        scope: 'write',
        exp: Date.now() + 3600000,
      }

      const token = await createCapabilityToken(payload, testSecret)
      const verified = await verifyCapabilityToken(token, testSecret)

      expect(verified.target).toBe('worker-specific')
    })
  })
})
