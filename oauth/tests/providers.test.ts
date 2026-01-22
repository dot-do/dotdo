/**
 * @dotdo/oauth Provider Registry and Built-in Providers Tests
 *
 * Tests for the provider registry pattern and built-in OAuth providers.
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/providers
 */

import { describe, it, expect } from 'vitest'
import { createTestProvider } from './test-utils'

describe('@dotdo/oauth providers', () => {
  describe('ProviderRegistry', () => {
    it('register() adds provider', async () => {
      const { ProviderRegistry } = await import('../src/providers/registry')
      const registry = new ProviderRegistry()

      const testProvider = createTestProvider({ name: 'test' })
      registry.register(testProvider)

      expect(registry.get('test')).toBe(testProvider)
    })

    it('get() returns null for unknown provider', async () => {
      const { ProviderRegistry } = await import('../src/providers/registry')
      const registry = new ProviderRegistry()

      expect(registry.get('unknown')).toBeNull()
    })

    it('list() returns all providers', async () => {
      const { ProviderRegistry } = await import('../src/providers/registry')
      const registry = new ProviderRegistry()

      registry.register(createTestProvider({ name: 'a' }))
      registry.register(createTestProvider({ name: 'b' }))

      expect(registry.list().map((p) => p.name)).toEqual(['a', 'b'])
    })

    it('has() returns true for registered provider', async () => {
      const { ProviderRegistry } = await import('../src/providers/registry')
      const registry = new ProviderRegistry()

      registry.register(createTestProvider({ name: 'test' }))

      expect(registry.has('test')).toBe(true)
      expect(registry.has('unknown')).toBe(false)
    })

    it('unregister() removes provider', async () => {
      const { ProviderRegistry } = await import('../src/providers/registry')
      const registry = new ProviderRegistry()

      registry.register(createTestProvider({ name: 'test' }))
      expect(registry.has('test')).toBe(true)

      registry.unregister('test')
      expect(registry.has('test')).toBe(false)
    })
  })

  describe('GoogleProvider', () => {
    it('getAuthorizationUrl() includes correct params', async () => {
      const { createGoogleProvider } = await import('../src/providers/google')

      const provider = createGoogleProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
      })

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('accounts.google.com')
      expect(url).toContain('client_id=test-client')
      expect(url).toContain('code_challenge=challenge456')
      expect(url).toContain('code_challenge_method=S256')
      expect(url).toContain('state=state123')
      expect(url).toContain('redirect_uri=')
    })

    it('getAuthorizationUrl() includes scopes', async () => {
      const { createGoogleProvider } = await import('../src/providers/google')

      const provider = createGoogleProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
        scopes: ['openid', 'email', 'profile'],
      })

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('scope=')
      expect(url).toContain('openid')
    })

    it('has correct name', async () => {
      const { createGoogleProvider } = await import('../src/providers/google')

      const provider = createGoogleProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
      })

      expect(provider.name).toBe('google')
    })
  })

  describe('GitHubProvider', () => {
    it('getAuthorizationUrl() includes correct params', async () => {
      const { createGitHubProvider } = await import('../src/providers/github')

      const provider = createGitHubProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
      })

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('github.com')
      expect(url).toContain('client_id=test-client')
      expect(url).toContain('state=state123')
    })

    it('getAuthorizationUrl() includes scopes', async () => {
      const { createGitHubProvider } = await import('../src/providers/github')

      const provider = createGitHubProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
        scopes: ['user', 'repo'],
      })

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('scope=')
    })

    it('has correct name', async () => {
      const { createGitHubProvider } = await import('../src/providers/github')

      const provider = createGitHubProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
      })

      expect(provider.name).toBe('github')
    })
  })

  describe('MicrosoftProvider', () => {
    it('getAuthorizationUrl() includes correct params', async () => {
      const { createMicrosoftProvider } = await import('../src/providers/microsoft')

      const provider = createMicrosoftProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
      })

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('login.microsoftonline.com')
      expect(url).toContain('client_id=test-client')
      expect(url).toContain('code_challenge=challenge456')
      expect(url).toContain('state=state123')
    })

    it('supports tenant configuration', async () => {
      const { createMicrosoftProvider } = await import('../src/providers/microsoft')

      const provider = createMicrosoftProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
        tenant: 'my-tenant-id',
      })

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('my-tenant-id')
    })

    it('has correct name', async () => {
      const { createMicrosoftProvider } = await import('../src/providers/microsoft')

      const provider = createMicrosoftProvider({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
      })

      expect(provider.name).toBe('microsoft')
    })
  })

  describe('CustomProvider', () => {
    it('createCustomProvider() creates provider with custom endpoints', async () => {
      const { createCustomProvider } = await import('../src/providers/custom')

      const provider = createCustomProvider({
        name: 'custom-idp',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: 'https://example.com/callback',
        authorizationEndpoint: 'https://custom.idp.com/auth',
        tokenEndpoint: 'https://custom.idp.com/token',
        userInfoEndpoint: 'https://custom.idp.com/userinfo',
      })

      expect(provider.name).toBe('custom-idp')

      const url = provider.getAuthorizationUrl('state123', 'challenge456')
      expect(url).toContain('custom.idp.com/auth')
      expect(url).toContain('client_id=test-client')
    })
  })

  describe('OAuthProvider interface', () => {
    it('exports OAuthProvider type', async () => {
      const { createGoogleProvider } = await import('../src/providers/google')

      // Type check - ensure provider conforms to interface
      const provider = createGoogleProvider({
        clientId: 'test',
        clientSecret: 'test',
        redirectUri: 'https://example.com/callback',
      })

      // Verify all required methods exist
      expect(typeof provider.name).toBe('string')
      expect(typeof provider.getAuthorizationUrl).toBe('function')
      expect(typeof provider.exchangeCode).toBe('function')
      expect(typeof provider.getUser).toBe('function')
    })
  })

  describe('defaultRegistry', () => {
    it('exports pre-configured registry', async () => {
      const { defaultRegistry } = await import('../src/providers')

      expect(defaultRegistry).toBeDefined()
      expect(typeof defaultRegistry.get).toBe('function')
      expect(typeof defaultRegistry.register).toBe('function')
    })
  })
})
