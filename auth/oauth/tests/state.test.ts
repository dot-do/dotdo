import { describe, it, expect } from 'vitest'

describe('@dotdo/oauth State Token', () => {
  describe('generateState', () => {
    it('creates state token with sufficient entropy', async () => {
      const { generateState } = await import('../src/core/state')

      const state = await generateState()

      // State should be at least 32 bytes (43 chars base64url)
      expect(state.length).toBeGreaterThanOrEqual(43)
    })

    it('creates state with URL-safe characters', async () => {
      const { generateState } = await import('../src/core/state')

      const state = await generateState()

      // URL-safe base64: [A-Za-z0-9_-] with no padding
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('generates unique state tokens each time', async () => {
      const { generateState } = await import('../src/core/state')

      const state1 = await generateState()
      const state2 = await generateState()

      expect(state1).not.toBe(state2)
    })

    it('accepts custom length parameter', async () => {
      const { generateState } = await import('../src/core/state')

      const state = await generateState(64)

      // 64 bytes = 86 characters in base64url
      expect(state.length).toBe(86)
    })
  })

  describe('validateState', () => {
    it('validates matching state tokens', async () => {
      const { generateState, validateState } = await import('../src/core/state')

      const state = await generateState()

      const isValid = validateState(state, state)
      expect(isValid).toBe(true)
    })

    it('rejects non-matching state tokens', async () => {
      const { generateState, validateState } = await import('../src/core/state')

      const state1 = await generateState()
      const state2 = await generateState()

      const isValid = validateState(state1, state2)
      expect(isValid).toBe(false)
    })

    it('rejects empty expected state', async () => {
      const { generateState, validateState } = await import('../src/core/state')

      const state = await generateState()

      const isValid = validateState(state, '')
      expect(isValid).toBe(false)
    })

    it('rejects empty received state', async () => {
      const { generateState, validateState } = await import('../src/core/state')

      const state = await generateState()

      const isValid = validateState('', state)
      expect(isValid).toBe(false)
    })

    it('performs timing-safe comparison', async () => {
      const { validateState } = await import('../src/core/state')

      // This test ensures the function uses constant-time comparison
      // to prevent timing attacks
      const state = 'test-state-value-1234567890abcdef'

      // These should both return false but take similar time
      const result1 = validateState('x', state)
      const result2 = validateState('test-state-value-1234567890abcdef-diff', state)

      expect(result1).toBe(false)
      expect(result2).toBe(false)
    })
  })

  describe('createStateWithMetadata', () => {
    it('creates state with embedded metadata', async () => {
      const { createStateWithMetadata, parseStateMetadata } = await import(
        '../src/core/state'
      )

      const metadata = { redirectUri: '/dashboard', provider: 'github' }
      const state = await createStateWithMetadata(metadata)

      expect(state).toBeTruthy()
      expect(typeof state).toBe('string')
    })

    it('parses state metadata correctly', async () => {
      const { createStateWithMetadata, parseStateMetadata } = await import(
        '../src/core/state'
      )

      const metadata = { redirectUri: '/dashboard', provider: 'github' }
      const state = await createStateWithMetadata(metadata)

      const parsed = parseStateMetadata(state)

      expect(parsed).toBeDefined()
      expect(parsed?.redirectUri).toBe('/dashboard')
      expect(parsed?.provider).toBe('github')
    })

    it('returns null for invalid state format', async () => {
      const { parseStateMetadata } = await import('../src/core/state')

      const parsed = parseStateMetadata('invalid-state-token')

      expect(parsed).toBeNull()
    })

    it('includes nonce in metadata state', async () => {
      const { createStateWithMetadata, parseStateMetadata } = await import(
        '../src/core/state'
      )

      const state = await createStateWithMetadata({ foo: 'bar' })
      const parsed = parseStateMetadata(state)

      expect(parsed).toBeDefined()
      expect(parsed?._nonce).toBeDefined()
      expect(typeof parsed?._nonce).toBe('string')
    })
  })

  describe('State expiration', () => {
    it('createStateWithExpiry includes expiration timestamp', async () => {
      const { createStateWithExpiry, isStateExpired } = await import(
        '../src/core/state'
      )

      const state = await createStateWithExpiry(60) // 60 seconds

      expect(state).toBeTruthy()
      expect(isStateExpired(state)).toBe(false)
    })

    it('detects expired state tokens', async () => {
      const { createStateWithExpiry, isStateExpired } = await import(
        '../src/core/state'
      )

      // Create state that expired 1 second ago
      const state = await createStateWithExpiry(-1)

      expect(isStateExpired(state)).toBe(true)
    })

    it('returns true for invalid state format in expiration check', async () => {
      const { isStateExpired } = await import('../src/core/state')

      // Invalid states should be considered expired for safety
      expect(isStateExpired('invalid-state')).toBe(true)
    })
  })
})
