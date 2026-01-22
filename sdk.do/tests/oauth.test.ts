/**
 * sdk.do/oauth Tests
 *
 * Tests for the OAuth subpath export that re-exports from @dotdo/oauth.
 * This ensures the separate subpath entry point works correctly.
 */

import { describe, it, expect } from 'vitest'

describe('sdk.do/oauth subpath export', () => {
  describe('OAuth middleware exports', () => {
    it('should export oauthMiddleware', async () => {
      const { oauthMiddleware } = await import('sdk.do/oauth')
      expect(oauthMiddleware).toBeDefined()
      expect(typeof oauthMiddleware).toBe('function')
    })

    it('should export createCallbackHandler', async () => {
      const { createCallbackHandler } = await import('sdk.do/oauth')
      expect(createCallbackHandler).toBeDefined()
      expect(typeof createCallbackHandler).toBe('function')
    })

    it('should export createAuthorizeHandler', async () => {
      const { createAuthorizeHandler } = await import('sdk.do/oauth')
      expect(createAuthorizeHandler).toBeDefined()
      expect(typeof createAuthorizeHandler).toBe('function')
    })

    it('should export createTokenEndpoint', async () => {
      const { createTokenEndpoint } = await import('sdk.do/oauth')
      expect(createTokenEndpoint).toBeDefined()
      expect(typeof createTokenEndpoint).toBe('function')
    })
  })

  describe('Session store exports', () => {
    it('should export MemorySessionStore', async () => {
      const { MemorySessionStore } = await import('sdk.do/oauth')
      expect(MemorySessionStore).toBeDefined()
      expect(typeof MemorySessionStore).toBe('function')

      // Create instance
      const store = new MemorySessionStore()
      expect(store).toBeDefined()
      expect(typeof store.get).toBe('function')
      expect(typeof store.set).toBe('function')
      expect(typeof store.delete).toBe('function')
    })

    it('should export KVSessionStore', async () => {
      const { KVSessionStore } = await import('sdk.do/oauth')
      expect(KVSessionStore).toBeDefined()
      expect(typeof KVSessionStore).toBe('function')
    })

    it('should export D1SessionStore', async () => {
      const { D1SessionStore } = await import('sdk.do/oauth')
      expect(D1SessionStore).toBeDefined()
      expect(typeof D1SessionStore).toBe('function')
    })
  })

  describe('Provider registry exports', () => {
    it('should export ProviderRegistry class', async () => {
      const { ProviderRegistry } = await import('sdk.do/oauth')
      expect(ProviderRegistry).toBeDefined()
      expect(typeof ProviderRegistry).toBe('function')

      // Create instance
      const registry = new ProviderRegistry()
      expect(registry).toBeDefined()
      expect(typeof registry.register).toBe('function')
      expect(typeof registry.get).toBe('function')
    })

    it('should export defaultRegistry', async () => {
      const { defaultRegistry } = await import('sdk.do/oauth')
      expect(defaultRegistry).toBeDefined()
      // defaultRegistry should have pre-registered providers
      expect(typeof defaultRegistry.get).toBe('function')
    })

    it('should export provider factory functions', async () => {
      const {
        createGoogleProvider,
        createGitHubProvider,
        createMicrosoftProvider,
        createCustomProvider,
      } = await import('sdk.do/oauth')

      expect(createGoogleProvider).toBeDefined()
      expect(typeof createGoogleProvider).toBe('function')
      expect(createGitHubProvider).toBeDefined()
      expect(typeof createGitHubProvider).toBe('function')
      expect(createMicrosoftProvider).toBeDefined()
      expect(typeof createMicrosoftProvider).toBe('function')
      expect(createCustomProvider).toBeDefined()
      expect(typeof createCustomProvider).toBe('function')
    })
  })

  describe('PKCE utility exports', () => {
    it('should export generatePKCE', async () => {
      const { generatePKCE } = await import('sdk.do/oauth')
      expect(generatePKCE).toBeDefined()
      expect(typeof generatePKCE).toBe('function')
    })

    it('should export validatePKCE', async () => {
      const { validatePKCE } = await import('sdk.do/oauth')
      expect(validatePKCE).toBeDefined()
      expect(typeof validatePKCE).toBe('function')
    })

    it('should export generateVerifier', async () => {
      const { generateVerifier } = await import('sdk.do/oauth')
      expect(generateVerifier).toBeDefined()
      expect(typeof generateVerifier).toBe('function')
    })

    it('should export createChallenge', async () => {
      const { createChallenge } = await import('sdk.do/oauth')
      expect(createChallenge).toBeDefined()
      expect(typeof createChallenge).toBe('function')
    })

    it('should generate valid PKCE pairs', async () => {
      const { generatePKCE } = await import('sdk.do/oauth')
      const pkce = await generatePKCE()

      expect(pkce).toBeDefined()
      expect(pkce.verifier).toBeDefined()
      expect(typeof pkce.verifier).toBe('string')
      expect(pkce.challenge).toBeDefined()
      expect(typeof pkce.challenge).toBe('string')
      // Verifier should be 43-128 characters (RFC 7636)
      expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
      expect(pkce.verifier.length).toBeLessThanOrEqual(128)
    })
  })

  describe('State utility exports', () => {
    it('should export generateState', async () => {
      const { generateState } = await import('sdk.do/oauth')
      expect(generateState).toBeDefined()
      expect(typeof generateState).toBe('function')
    })

    it('should export validateState', async () => {
      const { validateState } = await import('sdk.do/oauth')
      expect(validateState).toBeDefined()
      expect(typeof validateState).toBe('function')
    })

    it('should export createStateWithMetadata', async () => {
      const { createStateWithMetadata } = await import('sdk.do/oauth')
      expect(createStateWithMetadata).toBeDefined()
      expect(typeof createStateWithMetadata).toBe('function')
    })

    it('should export parseStateMetadata', async () => {
      const { parseStateMetadata } = await import('sdk.do/oauth')
      expect(parseStateMetadata).toBeDefined()
      expect(typeof parseStateMetadata).toBe('function')
    })

    it('should generate valid state strings', async () => {
      const { generateState } = await import('sdk.do/oauth')
      const state = await generateState()

      expect(state).toBeDefined()
      expect(typeof state).toBe('string')
      expect(state.length).toBeGreaterThan(0)
    })

    it('should validate state correctly', async () => {
      const { generateState, validateState } = await import('sdk.do/oauth')
      const state = await generateState()

      // Same state should validate
      expect(validateState(state, state)).toBe(true)
      // Different state should not validate
      expect(validateState(state, 'different-state')).toBe(false)
    })
  })

  describe('OAuth consistency with @dotdo/oauth', () => {
    it('should export same MemorySessionStore as @dotdo/oauth', async () => {
      const sdkOauth = await import('sdk.do/oauth')
      const dotdoOauth = await import('@dotdo/oauth')

      expect(sdkOauth.MemorySessionStore).toBe(dotdoOauth.MemorySessionStore)
    })

    it('should export same ProviderRegistry as @dotdo/oauth', async () => {
      const sdkOauth = await import('sdk.do/oauth')
      const dotdoOauth = await import('@dotdo/oauth')

      expect(sdkOauth.ProviderRegistry).toBe(dotdoOauth.ProviderRegistry)
    })

    it('should export same generatePKCE as @dotdo/oauth', async () => {
      const sdkOauth = await import('sdk.do/oauth')
      const dotdoOauth = await import('@dotdo/oauth')

      expect(sdkOauth.generatePKCE).toBe(dotdoOauth.generatePKCE)
    })
  })
})
