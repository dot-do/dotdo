/**
 * Token Manager Tests
 *
 * TDD tests for JWT, API key, and token management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TokenManager,
  JWTHandler,
  RefreshTokenStore,
  APIKeyGenerator,
  TokenRevocationList,
  ClaimsValidator,
  TokenRotation,
  InMemoryTokenStorage,
} from './index'
import type {
  TokenPayload,
  TokenConfig,
  APIKeyOptions,
  RefreshConfig,
} from './types'

describe('TokenManager', () => {
  let tokenManager: TokenManager
  const testSecret = 'test-secret-key-at-least-32-characters-long'

  beforeEach(() => {
    tokenManager = new TokenManager({
      secret: testSecret,
      algorithm: 'HS256',
      expiresIn: '1h',
    })
  })

  describe('createToken', () => {
    it('creates a JWT with claims', async () => {
      const payload = {
        sub: 'user-123',
        claims: { role: 'admin', tenantId: 'tenant-456' },
      }

      const token = await tokenManager.createToken(payload)

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      // JWT format: header.payload.signature
      expect(token.split('.')).toHaveLength(3)
    })

    it('includes standard JWT claims (iat, exp)', async () => {
      const payload = { sub: 'user-123' }

      const token = await tokenManager.createToken(payload)
      const decoded = await tokenManager.verifyToken(token)

      expect(decoded.valid).toBe(true)
      expect(decoded.payload?.iat).toBeDefined()
      expect(decoded.payload?.exp).toBeDefined()
      expect(decoded.payload?.exp).toBeGreaterThan(decoded.payload!.iat)
    })

    it('respects custom expiration', async () => {
      const manager = new TokenManager({
        secret: testSecret,
        expiresIn: '15m',
      })
      const payload = { sub: 'user-123' }

      const token = await manager.createToken(payload)
      const decoded = await manager.verifyToken(token)

      expect(decoded.valid).toBe(true)
      // 15 minutes = 900 seconds
      const expectedExp = decoded.payload!.iat + 900
      expect(decoded.payload?.exp).toBe(expectedExp)
    })

    it('generates unique token IDs (jti)', async () => {
      const payload = { sub: 'user-123' }

      const token1 = await tokenManager.createToken(payload)
      const token2 = await tokenManager.createToken(payload)

      const decoded1 = await tokenManager.verifyToken(token1)
      const decoded2 = await tokenManager.verifyToken(token2)

      expect(decoded1.payload?.jti).toBeDefined()
      expect(decoded2.payload?.jti).toBeDefined()
      expect(decoded1.payload?.jti).not.toBe(decoded2.payload?.jti)
    })
  })

  describe('verifyToken', () => {
    it('verifies a valid JWT', async () => {
      const payload = { sub: 'user-123', claims: { role: 'admin' } }
      const token = await tokenManager.createToken(payload)

      const result = await tokenManager.verifyToken(token)

      expect(result.valid).toBe(true)
      expect(result.payload?.sub).toBe('user-123')
      expect(result.payload?.claims?.role).toBe('admin')
    })

    it('rejects an expired token', async () => {
      const manager = new TokenManager({
        secret: testSecret,
        expiresIn: -1, // Already expired
      })
      const payload = { sub: 'user-123' }
      const token = await manager.createToken(payload)

      const result = await manager.verifyToken(token)

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('expired')
      expect(result.error).toContain('expired')
    })

    it('rejects a token with invalid signature', async () => {
      const token = await tokenManager.createToken({ sub: 'user-123' })
      // Tamper with the signature
      const parts = token.split('.')
      parts[2] = 'invalid-signature'
      const tamperedToken = parts.join('.')

      const result = await tokenManager.verifyToken(tamperedToken)

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('invalid_signature')
    })

    it('rejects a malformed token', async () => {
      const result = await tokenManager.verifyToken('not-a-valid-token')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('malformed')
    })

    it('rejects a token with wrong secret', async () => {
      const token = await tokenManager.createToken({ sub: 'user-123' })

      const otherManager = new TokenManager({
        secret: 'different-secret-key-at-least-32-chars',
      })
      const result = await otherManager.verifyToken(token)

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('invalid_signature')
    })
  })

  describe('refreshToken', () => {
    it('creates a token pair with access and refresh tokens', async () => {
      const pair = await tokenManager.createTokenPair({ sub: 'user-123' })

      expect(pair.accessToken).toBeDefined()
      expect(pair.refreshToken).toBeDefined()
      expect(pair.tokenType).toBe('Bearer')
      expect(pair.accessTokenExpiresAt).toBeGreaterThan(Date.now())
      expect(pair.refreshTokenExpiresAt).toBeGreaterThan(pair.accessTokenExpiresAt)
    })

    it('refreshes access token using refresh token', async () => {
      const pair = await tokenManager.createTokenPair({ sub: 'user-123' })

      const newPair = await tokenManager.refreshToken(pair.refreshToken)

      expect(newPair.accessToken).toBeDefined()
      expect(newPair.accessToken).not.toBe(pair.accessToken)
      expect(newPair.refreshToken).toBeDefined()
    })

    it('invalidates used refresh token when rotation is enabled', async () => {
      const pair = await tokenManager.createTokenPair({ sub: 'user-123' })

      await tokenManager.refreshToken(pair.refreshToken)
      // Try to use the old refresh token again
      const result = await tokenManager.refreshToken(pair.refreshToken)

      expect(result).toBeNull()
    })

    it('rejects expired refresh token', async () => {
      const manager = new TokenManager({
        secret: testSecret,
        refreshConfig: { expiresIn: -1 },
      })
      const pair = await manager.createTokenPair({ sub: 'user-123' })

      const result = await manager.refreshToken(pair.refreshToken)

      expect(result).toBeNull()
    })
  })

  describe('revokeToken', () => {
    it('revokes a token', async () => {
      const token = await tokenManager.createToken({ sub: 'user-123' })

      await tokenManager.revokeToken(token)
      const result = await tokenManager.verifyToken(token)

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('revoked')
    })

    it('revokes a token by jti', async () => {
      const token = await tokenManager.createToken({ sub: 'user-123' })
      const decoded = await tokenManager.verifyToken(token)
      const jti = decoded.payload!.jti!

      await tokenManager.revokeTokenById(jti)
      const result = await tokenManager.verifyToken(token)

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('revoked')
    })
  })

  describe('API Keys', () => {
    it('creates an API key with name and permissions', async () => {
      const apiKey = await tokenManager.createAPIKey({
        name: 'Production Key',
        permissions: ['read', 'write'],
      })

      expect(apiKey.key).toBeDefined()
      expect(apiKey.name).toBe('Production Key')
      expect(apiKey.permissions).toEqual(['read', 'write'])
      expect(apiKey.createdAt).toBeLessThanOrEqual(Date.now())
    })

    it('creates API key with custom prefix', async () => {
      const apiKey = await tokenManager.createAPIKey({
        name: 'Live Key',
        prefix: 'sk_live_',
      })

      expect(apiKey.key.startsWith('sk_live_')).toBe(true)
    })

    it('validates a valid API key', async () => {
      const apiKey = await tokenManager.createAPIKey({
        name: 'Test Key',
        permissions: ['read'],
      })

      const result = await tokenManager.validateAPIKey(apiKey.key)

      expect(result.valid).toBe(true)
      expect(result.apiKey?.name).toBe('Test Key')
    })

    it('rejects an invalid API key', async () => {
      const result = await tokenManager.validateAPIKey('invalid-key')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('not_found')
    })

    it('rejects an expired API key', async () => {
      const apiKey = await tokenManager.createAPIKey({
        name: 'Expiring Key',
        expiresIn: -1, // Already expired
      })

      const result = await tokenManager.validateAPIKey(apiKey.key)

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('expired')
    })

    it('checks API key permissions', async () => {
      const apiKey = await tokenManager.createAPIKey({
        name: 'Limited Key',
        permissions: ['read'],
      })

      const hasRead = await tokenManager.checkAPIKeyPermission(apiKey.key, 'read')
      const hasWrite = await tokenManager.checkAPIKeyPermission(apiKey.key, 'write')

      expect(hasRead).toBe(true)
      expect(hasWrite).toBe(false)
    })
  })
})

describe('JWTHandler', () => {
  const secret = 'test-secret-key-at-least-32-characters-long'

  describe('HS256 algorithm', () => {
    it('creates and verifies JWT with HS256', async () => {
      const handler = new JWTHandler({ secret, algorithm: 'HS256' })
      const payload: TokenPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await handler.sign(payload)
      const result = await handler.verify(token)

      expect(result.valid).toBe(true)
      expect(result.payload?.sub).toBe('user-123')
    })
  })

  describe('RS256 algorithm', () => {
    // RSA key pair for testing (PKCS#8 format for private key, SPKI format for public key)
    const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDSoszoqzVgkcet
WlM3udRxuFf0l4KeiI55T8Dwp+SdfazjyGYTuEjYUU4QrEN0MHKhhDNxTjwrUU9g
tYjxBl0MDDOCNrUEZNiUflSvY8imHDP47YngIJqfokFqXoyLuVrFEGYmaGmFKd6O
ggoJvCMPViBbk1FL4qCOHCIBBwRP21kBMwsodTJoocO1rJhk2Hv7ojsJLezJNrvV
eVbRIDnTrNFPtPkuGLcWo0KkFIxgWREsOSQePI5Y5OKZt/WJe5XGMV2iATSNgxXQ
7pLj1PMA6sisMRr7FgWIN2PGQlIqAdgeAbaA1pZylShQOtPn80Nz5voRlt7gjT00
oApHIbiVAgMBAAECggEAVQuwilzeT2Bs69xlb0GTulrBAJvP/GyMggSmlURktQYS
MWIvfNTSbKzfRTIYhigtkHNNRfldp+vLjfOeGBsGpJ+kiHXIPr7tB3++d5ZlZFRM
07wtCBaB9+ROX0FPo/ax5JFLfUR5HnAaURXGMcoJqd6PcAoaL/aP9vD69ck8f3UI
f4uqpo0QOT3O7AfrgepymT/21MqFYNLWrOz6gTNUnc62IJAsAqG1XfDCrEdPavtf
LMQAAkS1+mZkEETjLGPZjkFXmVDaAyhmiha+b4K73bj6Va2WNKHdNC102ecKczXY
Joph0flZxDn52Qeowep9iZ4loh2GwQBW4SuCdrtdXQKBgQDrz73veZUuoesrmCZt
z5lNBJs8rtR/eroGrX2Z8pED29tNALK0u+9U0aG3tJ67JYBSAidsp1TOQPyrr6q+
zQWRqBrCKns67wb+3ggjiAOht1HuSGprcnHGvJHUAiI7/1z9pceiWbiPf76ddM/E
QaEcDSRg+xiKk6xdb8TE3SG6gwKBgQDkq0nNeyhG0YAJlyemWhi9wWoyP/uK+a1n
osHv/QHMeYXXtfkPrrfBacI3Z4W5rdTdnmKqlcArS/ZuhH9mJhaWEVkLVnhyYKZ3
psv/tg0X5KxJ8P9LALF2YDGtw3zkSqAZg/ALifiKX2Y/mSRmWRiCFxe96qWFvf48
2mrgAJ21BwKBgQC017i98uwpuxtzb1fpVxAmNKYov5tPuHr5rAtrCM+VugJQ53wl
hwtgbPQswmQI+hWSzvwVI66yDry3nhy//tOKhPUgexvOcolW5Egxl5nRZ5l5uCeF
B1uiIfNkN86xXIGgNIcJRu13f2xbrL25sOsxbBK+HVMQ03eYoKKypzO6qQKBgFgM
iI+Bk6GpO6b1uAO6/3nZht2we1gpCZc1OX4CKvYj+OB1pmBeg00LPwh8aSZ1A9kO
CqnqnaNOTaaCiFe55MqGBYZzFk/cXV0HMdfVrrb7i0exb2ve6XZOVfK1qlpxTbJl
dkHLL5OAZmuouTZbqi81WyP6vR+BZ+rgo3R7aD5zAoGAGGYxJ2lIfTHI+U0IOZnt
AnUTPWWfFu3zoOs5GF4NdNK1z98JIVZQVcR6H8pMN+90QjjfJOhkZ0V/3CxQekQX
Z8padfKIdrbk/Kq1GH4VsDHXPwG+EP8waslEZq5D/bGi7KFciCPv1lNyWXXBHHen
0pylntWJ10Clj7xBeA1Nla0=
-----END PRIVATE KEY-----`

    const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0qLM6Ks1YJHHrVpTN7nU
cbhX9JeCnoiOeU/A8KfknX2s48hmE7hI2FFOEKxDdDByoYQzcU48K1FPYLWI8QZd
DAwzgja1BGTYlH5Ur2PIphwz+O2J4CCan6JBal6Mi7laxRBmJmhphSnejoIKCbwj
D1YgW5NRS+KgjhwiAQcET9tZATMLKHUyaKHDtayYZNh7+6I7CS3syTa71XlW0SA5
06zRT7T5Lhi3FqNCpBSMYFkRLDkkHjyOWOTimbf1iXuVxjFdogE0jYMV0O6S49Tz
AOrIrDEa+xYFiDdjxkJSKgHYHgG2gNaWcpUoUDrT5/NDc+b6EZbe4I09NKAKRyG4
lQIDAQAB
-----END PUBLIC KEY-----`

    it('creates and verifies JWT with RS256', async () => {
      const handler = new JWTHandler({
        algorithm: 'RS256',
        privateKey,
        publicKey,
      })
      const payload: TokenPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await handler.sign(payload)
      const result = await handler.verify(token)

      expect(result.valid).toBe(true)
      expect(result.payload?.sub).toBe('user-123')
    })

    it('verifies RS256 token with only public key', async () => {
      const signer = new JWTHandler({
        algorithm: 'RS256',
        privateKey,
        publicKey,
      })
      const verifier = new JWTHandler({
        algorithm: 'RS256',
        publicKey, // Only public key for verification
      })
      const payload: TokenPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await signer.sign(payload)
      const result = await verifier.verify(token)

      expect(result.valid).toBe(true)
    })
  })
})

describe('RefreshTokenStore', () => {
  let store: RefreshTokenStore

  beforeEach(() => {
    store = new RefreshTokenStore()
  })

  it('stores and retrieves refresh tokens', async () => {
    const token = 'refresh-token-123'
    const userId = 'user-456'

    await store.store(token, userId)
    const data = await store.get(token)

    expect(data).toBeDefined()
    expect(data?.userId).toBe(userId)
    expect(data?.used).toBe(false)
  })

  it('marks tokens as used', async () => {
    const token = 'refresh-token-123'
    await store.store(token, 'user-456')

    await store.markUsed(token)
    const data = await store.get(token)

    expect(data?.used).toBe(true)
    expect(data?.usedAt).toBeDefined()
  })

  it('revokes all tokens in a family', async () => {
    const family = 'family-123'
    const token1 = 'token-1'
    const token2 = 'token-2'

    await store.store(token1, 'user-456', { family })
    await store.store(token2, 'user-456', { family })

    await store.revokeFamily(family)

    expect(await store.get(token1)).toBeNull()
    expect(await store.get(token2)).toBeNull()
  })
})

describe('APIKeyGenerator', () => {
  let generator: APIKeyGenerator

  beforeEach(() => {
    generator = new APIKeyGenerator()
  })

  it('generates secure API keys', async () => {
    const key = await generator.generate()

    expect(key).toBeDefined()
    expect(key.length).toBeGreaterThanOrEqual(32)
  })

  it('generates keys with custom prefix', async () => {
    const key = await generator.generate({ prefix: 'sk_test_' })

    expect(key.startsWith('sk_test_')).toBe(true)
  })

  it('generates keys with custom length', async () => {
    const key = await generator.generate({ length: 64, prefix: '' })

    // Base64 encoding increases length, but underlying bytes should be 64
    expect(key.length).toBeGreaterThanOrEqual(64)
  })

  it('generates unique keys', async () => {
    const keys = await Promise.all(
      Array.from({ length: 100 }, () => generator.generate())
    )
    const uniqueKeys = new Set(keys)

    expect(uniqueKeys.size).toBe(100)
  })
})

describe('TokenRevocationList', () => {
  let revocationList: TokenRevocationList

  beforeEach(() => {
    revocationList = new TokenRevocationList()
  })

  it('adds tokens to revocation list', async () => {
    const jti = 'token-id-123'
    const expiresAt = Date.now() + 3600000

    await revocationList.add(jti, expiresAt)
    const isRevoked = await revocationList.isRevoked(jti)

    expect(isRevoked).toBe(true)
  })

  it('reports non-revoked tokens as valid', async () => {
    const isRevoked = await revocationList.isRevoked('non-existent-token')

    expect(isRevoked).toBe(false)
  })

  it('cleans up expired revocations', async () => {
    const jti = 'token-id-123'
    const expiresAt = Date.now() - 1000 // Already expired

    await revocationList.add(jti, expiresAt)
    await revocationList.cleanup()
    const isRevoked = await revocationList.isRevoked(jti)

    // Expired revocations can be cleaned up since the token itself is expired
    expect(isRevoked).toBe(false)
  })
})

describe('ClaimsValidator', () => {
  let validator: ClaimsValidator

  beforeEach(() => {
    validator = new ClaimsValidator()
  })

  it('validates required claims', async () => {
    validator.require('role')

    const valid = await validator.validate({ role: 'admin' })
    const invalid = await validator.validate({})

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })

  it('validates claim values', async () => {
    validator.requireValue('role', ['admin', 'superadmin'])

    const valid = await validator.validate({ role: 'admin' })
    const invalid = await validator.validate({ role: 'user' })

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })

  it('validates with custom functions', async () => {
    validator.custom('age', (value) => typeof value === 'number' && value >= 18)

    const valid = await validator.validate({ age: 21 })
    const invalid = await validator.validate({ age: 16 })

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })
})

describe('TokenRotation', () => {
  let rotation: TokenRotation
  let tokenManager: TokenManager
  const secret = 'test-secret-key-at-least-32-characters-long'

  beforeEach(() => {
    tokenManager = new TokenManager({ secret })
    rotation = new TokenRotation(tokenManager, {
      interval: '1h',
      gracePeriod: '5m',
    })
  })

  it('rotates tokens at specified interval', async () => {
    const pair = await tokenManager.createTokenPair({ sub: 'user-123' })

    // Simulate time passing - use vi.useFakeTimers
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 3600001) // Just past 1 hour

    const needsRotation = rotation.needsRotation(pair.accessToken)

    vi.useRealTimers()
    expect(needsRotation).toBe(true)
  })

  it('honors grace period for old tokens', async () => {
    const token = await tokenManager.createToken({ sub: 'user-123' })

    // Rotate to get new token
    const { oldToken, newToken } = await rotation.rotate(token)

    // Old token should still be valid during grace period
    const oldResult = await tokenManager.verifyToken(oldToken)
    const newResult = await tokenManager.verifyToken(newToken)

    expect(oldResult.valid).toBe(true)
    expect(newResult.valid).toBe(true)
  })

  it('invalidates old tokens after grace period', async () => {
    const token = await tokenManager.createToken({ sub: 'user-123' })

    const { oldToken } = await rotation.rotate(token)

    // Simulate time passing past grace period
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 300001) // Just past 5 minutes

    const result = await rotation.verifyWithGrace(oldToken)

    vi.useRealTimers()
    expect(result.valid).toBe(false)
  })

  it('calls onRotate callback', async () => {
    const onRotate = vi.fn()
    const rotationWithCallback = new TokenRotation(tokenManager, {
      interval: '1h',
      onRotate,
    })
    const token = await tokenManager.createToken({ sub: 'user-123' })

    await rotationWithCallback.rotate(token)

    expect(onRotate).toHaveBeenCalledOnce()
  })
})

describe('InMemoryTokenStorage', () => {
  let storage: InMemoryTokenStorage

  beforeEach(() => {
    storage = new InMemoryTokenStorage()
  })

  it('stores and retrieves refresh tokens', async () => {
    const data = {
      token: 'refresh-123',
      userId: 'user-456',
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      used: false,
      family: 'family-123',
    }

    await storage.storeRefreshToken(data)
    const retrieved = await storage.getRefreshToken('refresh-123')

    expect(retrieved).toEqual(data)
  })

  it('stores and retrieves API keys', async () => {
    const apiKey = {
      key: 'sk_test_123',
      id: 'key-id-456',
      name: 'Test Key',
      permissions: ['read'],
      createdAt: Date.now(),
      expiresAt: null,
    }

    await storage.storeAPIKey(apiKey)
    const retrieved = await storage.getAPIKey('sk_test_123')

    expect(retrieved).toEqual(apiKey)
  })

  it('tracks token revocations', async () => {
    const jti = 'token-id-123'
    const expiresAt = Date.now() + 3600000

    await storage.revokeToken(jti, expiresAt)
    const isRevoked = await storage.isRevoked(jti)

    expect(isRevoked).toBe(true)
  })
})
