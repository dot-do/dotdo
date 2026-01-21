import { describe, it, expect } from 'vitest'

describe('@dotdo/oauth PKCE', () => {
  describe('generatePKCE', () => {
    it('creates valid verifier (43-128 characters)', async () => {
      const { generatePKCE } = await import('../src/core/pkce')

      const { verifier } = await generatePKCE()

      // RFC 7636: verifier must be 43-128 characters
      expect(verifier.length).toBeGreaterThanOrEqual(43)
      expect(verifier.length).toBeLessThanOrEqual(128)
    })

    it('creates verifier with URL-safe base64 characters', async () => {
      const { generatePKCE } = await import('../src/core/pkce')

      const { verifier } = await generatePKCE()

      // URL-safe base64: [A-Za-z0-9_-] with no padding
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('creates valid S256 challenge', async () => {
      const { generatePKCE } = await import('../src/core/pkce')

      const { challenge, method } = await generatePKCE()

      expect(method).toBe('S256')
      // Challenge is base64url encoded SHA256 (43 characters without padding)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(challenge.length).toBe(43)
    })

    it('generates unique verifiers each time', async () => {
      const { generatePKCE } = await import('../src/core/pkce')

      const pkce1 = await generatePKCE()
      const pkce2 = await generatePKCE()

      expect(pkce1.verifier).not.toBe(pkce2.verifier)
      expect(pkce1.challenge).not.toBe(pkce2.challenge)
    })

    it('generates different challenge for different verifier', async () => {
      const { generatePKCE } = await import('../src/core/pkce')

      const pkce1 = await generatePKCE()
      const pkce2 = await generatePKCE()

      // Different verifiers should produce different challenges
      if (pkce1.verifier !== pkce2.verifier) {
        expect(pkce1.challenge).not.toBe(pkce2.challenge)
      }
    })
  })

  describe('validatePKCE', () => {
    it('verifies correct verifier', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { verifier, challenge } = await generatePKCE()

      const isValid = await validatePKCE(verifier, challenge, 'S256')
      expect(isValid).toBe(true)
    })

    it('rejects wrong verifier', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { challenge } = await generatePKCE()

      const isValid = await validatePKCE('wrong-verifier-value', challenge, 'S256')
      expect(isValid).toBe(false)
    })

    it('rejects empty verifier', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { challenge } = await generatePKCE()

      const isValid = await validatePKCE('', challenge, 'S256')
      expect(isValid).toBe(false)
    })

    it('rejects empty challenge', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { verifier } = await generatePKCE()

      const isValid = await validatePKCE(verifier, '', 'S256')
      expect(isValid).toBe(false)
    })

    it('handles S256 method validation', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { verifier, challenge } = await generatePKCE()

      // S256 is the only supported method by default
      const isValid = await validatePKCE(verifier, challenge, 'S256')
      expect(isValid).toBe(true)
    })
  })

  describe('PKCE utilities', () => {
    it('createChallenge produces consistent output for same verifier', async () => {
      const { createChallenge } = await import('../src/core/pkce')

      const verifier = 'test-verifier-abc123'
      const challenge1 = await createChallenge(verifier, 'S256')
      const challenge2 = await createChallenge(verifier, 'S256')

      expect(challenge1).toBe(challenge2)
    })

    it('generateVerifier creates valid verifier', async () => {
      const { generateVerifier } = await import('../src/core/pkce')

      const verifier = await generateVerifier()

      expect(verifier.length).toBeGreaterThanOrEqual(43)
      expect(verifier.length).toBeLessThanOrEqual(128)
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('generateVerifier accepts custom length', async () => {
      const { generateVerifier } = await import('../src/core/pkce')

      const verifier = await generateVerifier(64)

      // 64 bytes = 86 characters in base64url (without padding)
      expect(verifier.length).toBe(86)
    })
  })

  describe('plain method (backwards compatibility)', () => {
    it('generatePKCE with plain method returns verifier as challenge', async () => {
      const { generatePKCE } = await import('../src/core/pkce')

      const { verifier, challenge, method } = await generatePKCE('plain')

      expect(method).toBe('plain')
      expect(challenge).toBe(verifier)
    })

    it('validatePKCE with plain method validates correctly', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { verifier, challenge } = await generatePKCE('plain')

      const isValid = await validatePKCE(verifier, challenge, 'plain')
      expect(isValid).toBe(true)
    })

    it('validatePKCE with plain method rejects wrong verifier', async () => {
      const { generatePKCE, validatePKCE } = await import('../src/core/pkce')

      const { challenge } = await generatePKCE('plain')

      const isValid = await validatePKCE('wrong-verifier', challenge, 'plain')
      expect(isValid).toBe(false)
    })

    it('createChallenge with plain method returns verifier unchanged', async () => {
      const { createChallenge } = await import('../src/core/pkce')

      const verifier = 'my-test-verifier'
      const challenge = await createChallenge(verifier, 'plain')

      expect(challenge).toBe(verifier)
    })
  })
})
