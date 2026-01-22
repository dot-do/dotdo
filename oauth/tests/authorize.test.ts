/**
 * @dotdo/oauth Authorization Handler Tests
 *
 * Extended tests for the authorize handler covering edge cases,
 * error handling, and registry-based provider selection.
 *
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/authorize
 */

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createTestProvider } from './test-utils'
import type { PKCEPair } from '../src/core/types'

describe('@dotdo/oauth authorize handler', () => {
  describe('createAuthorizeHandler() with single provider', () => {
    it('generates PKCE pair and stores it', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')

      const provider = createTestProvider()
      let storedPKCE: PKCEPair | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async (pkce) => {
          storedPKCE = pkce
        },
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login')

      expect(storedPKCE).toBeDefined()
      expect(storedPKCE?.verifier).toBeDefined()
      expect(storedPKCE?.challenge).toBeDefined()
      expect(storedPKCE?.method).toBe('S256')
    })

    it('stores state with provider name in metadata', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createTestProvider({ name: 'test-provider' })
      let storedState: string | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login')

      expect(storedState).toBeDefined()
      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.provider).toBe('test-provider')
    })

    it('passes context to storePKCE and storeState', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')

      const provider = createTestProvider()
      let pkceContext: unknown
      let stateContext: unknown

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async (_pkce, c) => {
          pkceContext = c
        },
        storeState: async (_state, c) => {
          stateContext = c
        },
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login')

      expect(pkceContext).toBeDefined()
      expect(stateContext).toBeDefined()
    })

    it('uses redirect_uri from query parameter', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createTestProvider()
      let storedState: string | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
        defaultRedirectUri: '/default',
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login?redirect_uri=/custom-path')

      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.redirectUri).toBe('/custom-path')
    })

    it('uses defaultRedirectUri when not specified', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createTestProvider()
      let storedState: string | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
        defaultRedirectUri: '/dashboard',
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login')

      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.redirectUri).toBe('/dashboard')
    })

    it('defaults to "/" when no redirect URI is specified', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createTestProvider()
      let storedState: string | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login')

      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.redirectUri).toBe('/')
    })
  })

  describe('createAuthorizeHandler() with registry', () => {
    it('returns 400 when provider not specified and no default', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { ProviderRegistry } = await import('../src/providers/registry')

      const registry = new ProviderRegistry()
      registry.register(createTestProvider({ name: 'github' }))
      registry.register(createTestProvider({ name: 'google' }))

      const handler = createAuthorizeHandler({
        registry,
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login')

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('not specified')
    })

    it('returns 400 for unknown provider', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { ProviderRegistry } = await import('../src/providers/registry')

      const registry = new ProviderRegistry()
      registry.register(createTestProvider({ name: 'github' }))

      const handler = createAuthorizeHandler({
        registry,
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login?provider=unknown')

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Unknown provider')
    })

    it('uses default provider when specified', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { ProviderRegistry } = await import('../src/providers/registry')

      const googleProvider = createTestProvider({ name: 'google' })
      // Override getAuthorizationUrl to use google.com
      googleProvider.getAuthorizationUrl = (state, challenge) =>
        `https://google.com/auth?state=${state}&code_challenge=${challenge}`

      const registry = new ProviderRegistry()
      registry.register(googleProvider)

      const handler = createAuthorizeHandler({
        registry,
        defaultProvider: 'google',
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login')

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toContain('google.com')
    })

    it('query param overrides default provider', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { ProviderRegistry } = await import('../src/providers/registry')

      const googleProvider = createTestProvider({ name: 'google' })
      googleProvider.getAuthorizationUrl = (state, challenge) =>
        `https://google.com/auth?state=${state}&code_challenge=${challenge}`

      const githubProvider = createTestProvider({ name: 'github' })
      githubProvider.getAuthorizationUrl = (state, challenge) =>
        `https://github.com/auth?state=${state}&code_challenge=${challenge}`

      const registry = new ProviderRegistry()
      registry.register(googleProvider)
      registry.register(githubProvider)

      const handler = createAuthorizeHandler({
        registry,
        defaultProvider: 'google',
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login?provider=github')

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toContain('github.com')
    })
  })

  describe('Authorization URL generation', () => {
    it('includes state in authorization URL', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')

      let capturedState: string | undefined
      const provider = createTestProvider()
      provider.getAuthorizationUrl = (state, challenge) => {
        capturedState = state
        return `https://test.provider/auth?state=${state}&code_challenge=${challenge}`
      }

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login')
      const location = res.headers.get('Location')

      expect(location).toContain(`state=${capturedState}`)
    })

    it('includes code challenge in authorization URL', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')

      let capturedChallenge: string | undefined
      const provider = createTestProvider()
      provider.getAuthorizationUrl = (state, challenge) => {
        capturedChallenge = challenge
        return `https://test.provider/auth?state=${state}&code_challenge=${challenge}`
      }

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login')
      const location = res.headers.get('Location')

      expect(location).toContain(`code_challenge=${capturedChallenge}`)
    })
  })

  describe('Error handling', () => {
    it('handles storePKCE failure gracefully', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')

      const provider = createTestProvider()

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {
          throw new Error('Storage failure')
        },
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      try {
        const res = await app.request('/auth/login')
        // If we get here, the error was handled internally
        expect(res.status).toBe(500)
      } catch (error) {
        // Error propagated - also acceptable behavior
        expect(error).toBeInstanceOf(Error)
      }
    })
  })
})
