/**
 * sdk.do Exports Tests
 *
 * TDD RED Phase: These tests should fail until implementation is complete.
 * Tests that sdk.do correctly re-exports from rpc.do and @dotdo/oauth.
 */

import { describe, it, expect } from 'vitest'

describe('sdk.do main exports', () => {
  it('should export createClient from rpc.do', async () => {
    const { createClient } = await import('sdk.do')
    expect(createClient).toBeDefined()
    expect(typeof createClient).toBe('function')
  })

  it('should export createProxy from rpc.do', async () => {
    const { createProxy } = await import('sdk.do')
    expect(createProxy).toBeDefined()
    expect(typeof createProxy).toBe('function')
  })

  it('should export type definitions from rpc.do', async () => {
    // These are type-only exports, but we can verify the module loads
    const sdkModule = await import('sdk.do')
    expect(sdkModule).toBeDefined()
    // Type exports like RPCClientOptions, RPCResponse should be available
    // (verified at compile time, not runtime)
  })

  it('should export transport utilities from rpc.do', async () => {
    const { FetchTransport, generateCorrelationId, CORRELATION_ID_HEADER } = await import('sdk.do')
    expect(FetchTransport).toBeDefined()
    expect(typeof FetchTransport).toBe('function')
    expect(generateCorrelationId).toBeDefined()
    expect(typeof generateCorrelationId).toBe('function')
    expect(CORRELATION_ID_HEADER).toBeDefined()
    expect(typeof CORRELATION_ID_HEADER).toBe('string')
  })
})

describe('sdk.do auth exports', () => {
  it('should export ensureLoggedIn from rpc.do/auth', async () => {
    const { ensureLoggedIn } = await import('sdk.do')
    expect(ensureLoggedIn).toBeDefined()
    expect(typeof ensureLoggedIn).toBe('function')
  })

  it('should export TokenStore from rpc.do/auth', async () => {
    const { TokenStore } = await import('sdk.do')
    expect(TokenStore).toBeDefined()
    expect(typeof TokenStore).toBe('function')
    // Verify it's a class/constructor
    const store = new TokenStore('/tmp/test-tokens.json')
    expect(store).toBeDefined()
  })

  it('should export ITokenStore interface type (compile-time check)', async () => {
    // Type-only export - module loading verifies it doesn't break
    const sdkModule = await import('sdk.do')
    expect(sdkModule).toBeDefined()
  })

  it('should export DeviceFlow from rpc.do/auth', async () => {
    const { DeviceFlow } = await import('sdk.do')
    expect(DeviceFlow).toBeDefined()
    expect(typeof DeviceFlow).toBe('function')
  })

  it('should export AuthTransport from rpc.do/auth', async () => {
    const { AuthTransport } = await import('sdk.do')
    expect(AuthTransport).toBeDefined()
    expect(typeof AuthTransport).toBe('function')
  })

  it('should export createRefreshFn from rpc.do/auth', async () => {
    const { createRefreshFn } = await import('sdk.do')
    expect(createRefreshFn).toBeDefined()
    expect(typeof createRefreshFn).toBe('function')
  })

  it('should export refreshToken from rpc.do/auth', async () => {
    const { refreshToken } = await import('sdk.do')
    expect(refreshToken).toBeDefined()
    expect(typeof refreshToken).toBe('function')
  })
})

describe('sdk.do/oauth middleware exports', () => {
  it('should export oauthMiddleware from sdk.do/oauth', async () => {
    const { oauthMiddleware } = await import('sdk.do/oauth')
    expect(oauthMiddleware).toBeDefined()
    expect(typeof oauthMiddleware).toBe('function')
  })

  it('should export createCallbackHandler from sdk.do/oauth', async () => {
    const { createCallbackHandler } = await import('sdk.do/oauth')
    expect(createCallbackHandler).toBeDefined()
    expect(typeof createCallbackHandler).toBe('function')
  })

  it('should export createAuthorizeHandler from sdk.do/oauth', async () => {
    const { createAuthorizeHandler } = await import('sdk.do/oauth')
    expect(createAuthorizeHandler).toBeDefined()
    expect(typeof createAuthorizeHandler).toBe('function')
  })

  it('should export createTokenEndpoint from sdk.do/oauth', async () => {
    const { createTokenEndpoint } = await import('sdk.do/oauth')
    expect(createTokenEndpoint).toBeDefined()
    expect(typeof createTokenEndpoint).toBe('function')
  })

  it('should export session stores from sdk.do/oauth', async () => {
    const { MemorySessionStore, KVSessionStore, D1SessionStore } = await import('sdk.do/oauth')
    expect(MemorySessionStore).toBeDefined()
    expect(KVSessionStore).toBeDefined()
    expect(D1SessionStore).toBeDefined()
  })

  it('should export provider utilities from sdk.do/oauth', async () => {
    const {
      ProviderRegistry,
      defaultRegistry,
      createGoogleProvider,
      createGitHubProvider,
      createMicrosoftProvider,
      createCustomProvider,
    } = await import('sdk.do/oauth')
    expect(ProviderRegistry).toBeDefined()
    expect(defaultRegistry).toBeDefined()
    expect(createGoogleProvider).toBeDefined()
    expect(createGitHubProvider).toBeDefined()
    expect(createMicrosoftProvider).toBeDefined()
    expect(createCustomProvider).toBeDefined()
  })

  it('should export PKCE utilities from sdk.do/oauth', async () => {
    const { generatePKCE, validatePKCE, generateVerifier, createChallenge } = await import('sdk.do/oauth')
    expect(generatePKCE).toBeDefined()
    expect(validatePKCE).toBeDefined()
    expect(generateVerifier).toBeDefined()
    expect(createChallenge).toBeDefined()
  })

  it('should export state utilities from sdk.do/oauth', async () => {
    const { generateState, validateState, createStateWithMetadata, parseStateMetadata } = await import('sdk.do/oauth')
    expect(generateState).toBeDefined()
    expect(validateState).toBeDefined()
    expect(createStateWithMetadata).toBeDefined()
    expect(parseStateMetadata).toBeDefined()
  })
})

describe('sdk.do re-exports are valid', () => {
  it('should allow creating a client through sdk.do', async () => {
    const { createClient } = await import('sdk.do')
    const client = createClient({ url: 'https://example.com' })
    expect(client).toBeDefined()
  })

  it('should allow creating a TokenStore through sdk.do', async () => {
    const { TokenStore } = await import('sdk.do')
    const store = new TokenStore('/tmp/sdk-test-tokens.json')
    expect(store).toBeDefined()
    expect(typeof store.getTokens).toBe('function')
    expect(typeof store.saveTokens).toBe('function')
    expect(typeof store.isTokenExpired).toBe('function')
  })

  it('should have consistent exports between sdk.do and rpc.do', async () => {
    const sdkModule = await import('sdk.do')
    const rpcModule = await import('rpc.do')

    // Core exports should match
    expect(sdkModule.createClient).toBe(rpcModule.createClient)
    expect(sdkModule.createProxy).toBe(rpcModule.createProxy)
    expect(sdkModule.FetchTransport).toBe(rpcModule.FetchTransport)
    expect(sdkModule.TokenStore).toBe(rpcModule.TokenStore)
    expect(sdkModule.ensureLoggedIn).toBe(rpcModule.ensureLoggedIn)
  })
})
