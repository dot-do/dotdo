/**
 * Zapier Authentication Tests
 *
 * Comprehensive tests for Zapier authentication compatibility:
 * - OAuth2 flow (authorize, token exchange, refresh)
 * - API key authentication
 * - Session authentication
 * - Basic authentication
 * - Custom authentication
 * - Digest authentication
 * - Connection label generation
 * - Token expiration checking
 * - Auth middleware
 * - PKCE support
 *
 * TDD RED Phase - These tests define expected behavior for features
 * that may not exist yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // Core
  App,
  createZObject,
  // Auth
  Authentication,
  createBasicAuthHeader,
  createBearerAuthHeader,
  generateCodeVerifier,
  generateCodeChallenge,
  OAuth2Flow,
  SessionAuthFlow,
  createAuthMiddleware,
  // Types
  type Bundle,
  type ZObject,
  type AuthenticationConfig,
  type OAuth2Config,
  type SessionConfig,
  // Errors
  ExpiredAuthError,
  RefreshAuthError,
} from '../index'

describe('Zapier Authentication', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // ============================================================================
  // OAUTH2 AUTHENTICATION
  // ============================================================================

  describe('OAuth2 Authentication', () => {
    describe('Authorization URL Building', () => {
      it('should build authorization URL with required params', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/oauth/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({ id: 'user123' }),
        })

        const url = auth.getAuthorizeUrl({
          client_id: 'my-client-id',
          redirect_uri: 'https://zapier.com/dashboard/auth/oauth/return/App123CLIAPI/',
          state: 'random-state-string',
          response_type: 'code',
        })

        expect(url).toContain('https://auth.example.com/oauth/authorize')
        expect(url).toContain('client_id=my-client-id')
        expect(url).toContain('redirect_uri=')
        expect(url).toContain('state=random-state-string')
        expect(url).toContain('response_type=code')
      })

      it('should include scope in authorization URL when configured', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/oauth/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            scope: 'read write profile email',
          },
          test: async () => ({}),
        })

        const url = auth.getAuthorizeUrl({
          client_id: 'client123',
          redirect_uri: 'https://zapier.com/callback',
          state: 'state123',
        })

        expect(url).toContain('scope=read')
        expect(url).toContain('write')
        expect(url).toContain('profile')
        expect(url).toContain('email')
      })

      it('should support dynamic authorization URL function', async () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: (z, bundle) => {
              const region = bundle.inputData.region as string || 'us'
              return `https://${region}.auth.example.com/oauth/authorize`
            },
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = {
          inputData: { region: 'eu' },
          authData: {},
        }

        const url = await auth.getAuthorizeUrlAsync(z, bundle, {
          client_id: 'client123',
          redirect_uri: 'https://zapier.com/callback',
          state: 'state123',
        })

        expect(url).toContain('https://eu.auth.example.com/oauth/authorize')
      })

      it('should throw error when calling getAuthorizeUrl on non-OAuth2 auth', () => {
        const auth = new Authentication({
          type: 'api_key',
          fields: [{ key: 'api_key', label: 'API Key', required: true }],
          test: async () => ({}),
        })

        expect(() => {
          auth.getAuthorizeUrl({ client_id: 'test' })
        }).toThrow('getAuthorizeUrl only available for OAuth2 authentication')
      })
    })

    describe('Token Exchange', () => {
      it('should exchange authorization code for access token', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            access_token: 'new_access_token_123',
            refresh_token: 'new_refresh_token_456',
            expires_in: 3600,
            token_type: 'Bearer',
          }), { status: 200 })
        )
        vi.stubGlobal('fetch', mockFetch)

        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/oauth/authorize',
            getAccessToken: async (z, bundle) => {
              const response = await z.request({
                url: 'https://auth.example.com/oauth/token',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  grant_type: 'authorization_code',
                  code: bundle.inputData.code as string,
                  client_id: process.env.CLIENT_ID || '',
                  client_secret: process.env.CLIENT_SECRET || '',
                  redirect_uri: bundle.inputData.redirect_uri as string,
                }).toString(),
                skipThrowForStatus: true,
              })
              return response.data as {
                access_token: string
                refresh_token?: string
                expires_in?: number
              }
            },
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = {
          inputData: {
            code: 'auth_code_from_callback',
            redirect_uri: 'https://zapier.com/callback',
          },
          authData: {},
        }

        const tokens = await auth.getAccessToken(z, bundle)

        expect(tokens.access_token).toBe('new_access_token_123')
        expect(tokens.refresh_token).toBe('new_refresh_token_456')
        expect(tokens.expires_in).toBe(3600)
      })

      it('should throw error when getAccessToken called on non-OAuth2 auth', async () => {
        const auth = new Authentication({
          type: 'api_key',
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = { inputData: {}, authData: {} }

        await expect(auth.getAccessToken(z, bundle)).rejects.toThrow(
          'getAccessToken only available for OAuth2 authentication'
        )
      })

      it('should include additional data from token response', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            access_token: 'token123',
            refresh_token: 'refresh456',
            expires_in: 7200,
            user_id: 'user_abc',
            account_id: 'account_xyz',
            scope: 'read write',
          }), { status: 200 })
        )
        vi.stubGlobal('fetch', mockFetch)

        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async (z, bundle) => {
              const response = await z.request({
                url: 'https://auth.example.com/token',
                method: 'POST',
                json: { code: bundle.inputData.code },
                skipThrowForStatus: true,
              })
              return response.data as {
                access_token: string
                refresh_token?: string
                expires_in?: number
                user_id?: string
                account_id?: string
              }
            },
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = {
          inputData: { code: 'auth_code' },
          authData: {},
        }

        const tokens = await auth.getAccessToken(z, bundle)

        expect(tokens.access_token).toBe('token123')
        expect((tokens as any).user_id).toBe('user_abc')
        expect((tokens as any).account_id).toBe('account_xyz')
      })
    })

    describe('Token Refresh', () => {
      it('should refresh expired access token', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            access_token: 'refreshed_access_token',
            expires_in: 3600,
          }), { status: 200 })
        )
        vi.stubGlobal('fetch', mockFetch)

        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'initial' }),
            refreshAccessToken: async (z, bundle) => {
              const response = await z.request({
                url: 'https://auth.example.com/oauth/token',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  grant_type: 'refresh_token',
                  refresh_token: bundle.authData.refresh_token as string,
                  client_id: process.env.CLIENT_ID || '',
                  client_secret: process.env.CLIENT_SECRET || '',
                }).toString(),
                skipThrowForStatus: true,
              })
              return response.data as { access_token: string; expires_in?: number }
            },
            autoRefresh: true,
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = {
          inputData: {},
          authData: {
            access_token: 'expired_token',
            refresh_token: 'valid_refresh_token',
          },
        }

        const tokens = await auth.refreshAccessToken(z, bundle)

        expect(tokens.access_token).toBe('refreshed_access_token')
        expect(tokens.expires_in).toBe(3600)
      })

      it('should throw error when refresh not configured', async () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            // No refreshAccessToken configured
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = { inputData: {}, authData: {} }

        await expect(auth.refreshAccessToken(z, bundle)).rejects.toThrow(
          'refreshAccessToken not configured'
        )
      })

      it('should throw RefreshAuthError on refresh failure', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Refresh token has been revoked',
          }), { status: 400 })
        )
        vi.stubGlobal('fetch', mockFetch)

        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            refreshAccessToken: async (z, bundle) => {
              const response = await z.request({
                url: 'https://auth.example.com/token',
                method: 'POST',
                json: {
                  grant_type: 'refresh_token',
                  refresh_token: bundle.authData.refresh_token,
                },
                skipThrowForStatus: true,
              })

              if (response.status !== 200) {
                throw new RefreshAuthError('Failed to refresh token')
              }

              return response.data as { access_token: string }
            },
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = {
          inputData: {},
          authData: { refresh_token: 'revoked_token' },
        }

        await expect(auth.refreshAccessToken(z, bundle)).rejects.toThrow(RefreshAuthError)
      })

      it('should check autoRefresh setting', () => {
        const authWithAutoRefresh = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            refreshAccessToken: async () => ({ access_token: 'new_token' }),
            autoRefresh: true,
          },
          test: async () => ({}),
        })

        const authWithoutAutoRefresh = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            refreshAccessToken: async () => ({ access_token: 'new_token' }),
            autoRefresh: false,
          },
          test: async () => ({}),
        })

        expect(authWithAutoRefresh.shouldAutoRefresh()).toBe(true)
        expect(authWithoutAutoRefresh.shouldAutoRefresh()).toBe(false)
      })
    })

    describe('Token Expiration', () => {
      it('should detect expired token via expires_at', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({}),
        })

        const expired = auth.isTokenExpired({
          access_token: 'some_token',
          expires_at: Date.now() - 1000, // 1 second ago
        })

        expect(expired).toBe(true)

        const valid = auth.isTokenExpired({
          access_token: 'some_token',
          expires_at: Date.now() + 3600000, // 1 hour from now
        })

        expect(valid).toBe(false)
      })

      it('should detect expired token via expires_in + token_received_at', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({}),
        })

        const now = Date.now()

        const expired = auth.isTokenExpired({
          access_token: 'some_token',
          expires_in: 3600, // 1 hour
          token_received_at: now - 4000000, // 4000 seconds ago
        })

        expect(expired).toBe(true)

        const valid = auth.isTokenExpired({
          access_token: 'some_token',
          expires_in: 3600, // 1 hour
          token_received_at: now - 1800000, // 30 minutes ago
        })

        expect(valid).toBe(false)
      })

      it('should assume not expired when expiration cannot be determined', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({}),
        })

        const indeterminate = auth.isTokenExpired({
          access_token: 'some_token',
          // No expiration info
        })

        expect(indeterminate).toBe(false)
      })
    })

    describe('PKCE Support', () => {
      it('should generate code verifier', () => {
        const verifier = generateCodeVerifier()

        expect(verifier.length).toBeGreaterThan(42)
        // Should be base64url encoded (no +, /, or =)
        expect(verifier).not.toContain('+')
        expect(verifier).not.toContain('/')
        expect(verifier).not.toContain('=')
      })

      it('should generate code challenge from verifier', async () => {
        const verifier = generateCodeVerifier()
        const challenge = await generateCodeChallenge(verifier)

        expect(challenge.length).toBeGreaterThan(0)
        // Should be base64url encoded
        expect(challenge).not.toContain('+')
        expect(challenge).not.toContain('/')
        expect(challenge).not.toContain('=')
        // Challenge should be different from verifier
        expect(challenge).not.toBe(verifier)
      })

      it('should include PKCE params when enabled', async () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            enablePkce: true,
          },
          test: async () => ({}),
        })

        const z = createZObject()
        const bundle: Bundle = { inputData: {}, authData: {} }
        const codeChallenge = await generateCodeChallenge(generateCodeVerifier())

        const url = await auth.getAuthorizeUrlAsync(z, bundle, {
          client_id: 'client123',
          redirect_uri: 'https://zapier.com/callback',
          state: 'state123',
          code_challenge: codeChallenge,
        })

        expect(url).toContain('code_challenge=')
        expect(url).toContain('code_challenge_method=S256')
      })
    })

    describe('OAuth2Flow Helper', () => {
      it('should start authorization flow', async () => {
        const flow = new OAuth2Flow({
          authorizeUrl: 'https://auth.example.com/authorize',
          getAccessToken: async () => ({ access_token: 'token' }),
        })

        const result = await flow.startAuthorization({
          clientId: 'my-client-id',
          redirectUri: 'https://zapier.com/callback',
          state: 'random-state',
          scope: 'read write',
        })

        expect(result.url).toContain('https://auth.example.com/authorize')
        expect(result.url).toContain('client_id=my-client-id')
        expect(result.url).toContain('response_type=code')
        expect(result.url).toContain('scope=read')
      })

      it('should include PKCE in authorization flow when enabled', async () => {
        const flow = new OAuth2Flow({
          authorizeUrl: 'https://auth.example.com/authorize',
          getAccessToken: async () => ({ access_token: 'token' }),
          enablePkce: true,
        })

        const result = await flow.startAuthorization({
          clientId: 'my-client-id',
          redirectUri: 'https://zapier.com/callback',
          state: 'random-state',
        })

        expect(result.url).toContain('code_challenge=')
        expect(result.url).toContain('code_challenge_method=S256')
        expect(result.codeVerifier).toBeDefined()
        expect(flow.getCodeVerifier()).toBe(result.codeVerifier)
      })
    })
  })

  // ============================================================================
  // API KEY AUTHENTICATION
  // ============================================================================

  describe('API Key Authentication', () => {
    it('should configure API key authentication with fields', () => {
      const auth = new Authentication({
        type: 'api_key',
        fields: [
          { key: 'api_key', label: 'API Key', required: true, type: 'password' },
        ],
        test: async () => ({ authenticated: true }),
      })

      expect(auth.type).toBe('api_key')
      expect(auth.getFields()).toHaveLength(1)
      expect(auth.getFields()[0].key).toBe('api_key')
      expect(auth.getFields()[0].type).toBe('password')
    })

    it('should support multiple API key fields', () => {
      const auth = new Authentication({
        type: 'api_key',
        fields: [
          { key: 'api_key', label: 'API Key', required: true },
          { key: 'api_secret', label: 'API Secret', required: true, type: 'password' },
          { key: 'account_id', label: 'Account ID', required: true },
        ],
        test: async () => ({ authenticated: true }),
      })

      expect(auth.getFields()).toHaveLength(3)
    })

    it('should test API key credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          id: 'user_123',
          email: 'user@example.com',
          plan: 'premium',
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'api_key',
        fields: [
          { key: 'api_key', label: 'API Key', required: true },
        ],
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/me',
            headers: {
              'Authorization': `Bearer ${bundle.authData.api_key}`,
            },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'my-secret-api-key' },
      }

      const result = await auth.test(z, bundle)

      expect((result as any).id).toBe('user_123')
      expect((result as any).email).toBe('user@example.com')
    })

    it('should throw ExpiredAuthError on invalid API key', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'api_key',
        fields: [{ key: 'api_key', label: 'API Key', required: true }],
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/me',
            headers: {
              'Authorization': `Bearer ${bundle.authData.api_key}`,
            },
            skipThrowForStatus: true,
          })

          if (response.status === 401) {
            throw new ExpiredAuthError('API key is invalid or has expired')
          }

          return response.data
        },
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'invalid-key' },
      }

      await expect(auth.test(z, bundle)).rejects.toThrow(ExpiredAuthError)
    })

    it('should support API key in header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'api_key',
        fields: [{ key: 'api_key', label: 'API Key', required: true }],
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/verify',
            headers: {
              'X-API-Key': bundle.authData.api_key as string,
            },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'my-api-key' },
      }

      await auth.test(z, bundle)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'my-api-key',
          }),
        })
      )
    })

    it('should support API key in query params', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'api_key',
        fields: [{ key: 'api_key', label: 'API Key', required: true }],
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/verify',
            params: {
              api_key: bundle.authData.api_key as string,
            },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'my-api-key' },
      }

      await auth.test(z, bundle)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api_key=my-api-key'),
        expect.anything()
      )
    })
  })

  // ============================================================================
  // SESSION AUTHENTICATION
  // ============================================================================

  describe('Session Authentication', () => {
    it('should configure session authentication', () => {
      const auth = new Authentication({
        type: 'session',
        sessionConfig: {
          perform: async () => ({ sessionKey: 'session123' }),
        },
        fields: [
          { key: 'username', label: 'Username', required: true },
          { key: 'password', label: 'Password', required: true, type: 'password' },
        ],
        test: async () => ({ authenticated: true }),
      })

      expect(auth.type).toBe('session')
      expect(auth.getFields()).toHaveLength(2)
    })

    it('should acquire session with username/password', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          session_token: 'session_abc123',
          expires_at: '2024-01-15T12:00:00Z',
          user_id: 'user_456',
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'session',
        sessionConfig: {
          perform: async (z, bundle) => {
            const response = await z.request({
              url: 'https://api.example.com/auth/login',
              method: 'POST',
              json: {
                username: bundle.authData.username,
                password: bundle.authData.password,
              },
              skipThrowForStatus: true,
            })
            const data = response.data as { session_token: string; user_id?: string }
            return {
              sessionKey: data.session_token,
              user_id: data.user_id,
            }
          },
        },
        fields: [
          { key: 'username', label: 'Username', required: true },
          { key: 'password', label: 'Password', required: true, type: 'password' },
        ],
        test: async () => ({}),
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: {
          username: 'john@example.com',
          password: 'secretpassword',
        },
      }

      const session = await auth.getSession(z, bundle)

      expect(session.sessionKey).toBe('session_abc123')
      expect((session as any).user_id).toBe('user_456')
    })

    it('should throw error when getSession called on non-session auth', async () => {
      const auth = new Authentication({
        type: 'api_key',
        test: async () => ({}),
      })

      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      await expect(auth.getSession(z, bundle)).rejects.toThrow(
        'getSession only available for session authentication'
      )
    })

    it('should use SessionAuthFlow helper', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          sessionKey: 'session_xyz',
          permissions: ['read', 'write'],
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const sessionConfig: SessionConfig = {
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/session',
            method: 'POST',
            json: bundle.authData,
            skipThrowForStatus: true,
          })
          return response.data as { sessionKey: string; permissions?: string[] }
        },
      }

      const flow = new SessionAuthFlow(sessionConfig)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { username: 'user', password: 'pass' },
      }

      await flow.acquireSession(z, bundle)

      expect(flow.getSessionKey()).toBe('session_xyz')
      expect(flow.getSessionData()).toBeDefined()
      expect((flow.getSessionData() as any).permissions).toEqual(['read', 'write'])
    })

    it('should clear session in SessionAuthFlow', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sessionKey: 'session_abc' }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const sessionConfig: SessionConfig = {
        perform: async (z) => {
          const response = await z.request({
            url: 'https://api.example.com/session',
            method: 'POST',
            skipThrowForStatus: true,
          })
          return response.data as { sessionKey: string }
        },
      }

      const flow = new SessionAuthFlow(sessionConfig)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      await flow.acquireSession(z, bundle)
      expect(flow.getSessionKey()).toBe('session_abc')

      flow.clearSession()

      expect(flow.getSessionKey()).toBeUndefined()
      expect(flow.getSessionData()).toBeUndefined()
    })

    it('should test session authentication credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'user123', name: 'John' }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'session',
        sessionConfig: {
          perform: async () => ({ sessionKey: 'session123' }),
        },
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/me',
            headers: {
              'X-Session-Token': bundle.authData.sessionKey as string,
            },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { sessionKey: 'valid_session' },
      }

      const result = await auth.test(z, bundle)

      expect((result as any).id).toBe('user123')
    })
  })

  // ============================================================================
  // BASIC AUTHENTICATION
  // ============================================================================

  describe('Basic Authentication', () => {
    it('should create basic auth header', () => {
      const header = createBasicAuthHeader('username', 'password')

      expect(header).toBe('Basic dXNlcm5hbWU6cGFzc3dvcmQ=')
    })

    it('should handle special characters in basic auth', () => {
      const header = createBasicAuthHeader('user@example.com', 'p@ss:word!')

      // Should properly encode special characters
      expect(header.startsWith('Basic ')).toBe(true)

      // Decode and verify
      const decoded = atob(header.replace('Basic ', ''))
      expect(decoded).toBe('user@example.com:p@ss:word!')
    })

    it('should configure basic authentication', () => {
      const auth = new Authentication({
        type: 'basic',
        fields: [
          { key: 'username', label: 'Username', required: true },
          { key: 'password', label: 'Password', required: true, type: 'password' },
        ],
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/me',
            headers: {
              'Authorization': createBasicAuthHeader(
                bundle.authData.username as string,
                bundle.authData.password as string
              ),
            },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      expect(auth.type).toBe('basic')
      expect(auth.getFields()).toHaveLength(2)
    })

    it('should test basic auth credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'user123' }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'basic',
        fields: [
          { key: 'username', label: 'Username', required: true },
          { key: 'password', label: 'Password', required: true, type: 'password' },
        ],
        test: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/me',
            headers: {
              'Authorization': createBasicAuthHeader(
                bundle.authData.username as string,
                bundle.authData.password as string
              ),
            },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { username: 'user', password: 'pass' },
      }

      await auth.test(z, bundle)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Basic dXNlcjpwYXNz',
          }),
        })
      )
    })
  })

  // ============================================================================
  // CUSTOM AUTHENTICATION
  // ============================================================================

  describe('Custom Authentication', () => {
    it('should configure custom authentication', () => {
      const auth = new Authentication({
        type: 'custom',
        customConfig: {
          perform: async (z, bundle) => {
            // Custom auth logic - e.g., HMAC signature
            const timestamp = Date.now().toString()
            const signature = z.hash('sha256', `${bundle.authData.secret}:${timestamp}`)
            return {
              'X-Timestamp': timestamp,
              'X-Signature': signature,
              'X-API-Key': bundle.authData.api_key as string,
            }
          },
        },
        fields: [
          { key: 'api_key', label: 'API Key', required: true },
          { key: 'secret', label: 'Secret', required: true, type: 'password' },
        ],
        test: async () => ({ authenticated: true }),
      })

      expect(auth.type).toBe('custom')
    })

    it('should apply custom auth through middleware', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'custom',
        customConfig: {
          perform: async (z, bundle) => {
            const apiKey = bundle.authData.api_key as string
            const timestamp = '1234567890'
            return {
              'X-API-Key': apiKey,
              'X-Timestamp': timestamp,
              'X-Signature': 'computed_signature',
            }
          },
        },
        test: async () => ({}),
      })

      const middleware = createAuthMiddleware(auth)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'my-key', secret: 'my-secret' },
      }

      const request = await middleware(
        { url: 'https://api.example.com/test', headers: {} },
        z,
        bundle
      )

      expect(request.headers!['X-API-Key']).toBe('my-key')
      expect(request.headers!['X-Timestamp']).toBe('1234567890')
      expect(request.headers!['X-Signature']).toBe('computed_signature')
    })
  })

  // ============================================================================
  // DIGEST AUTHENTICATION
  // ============================================================================

  describe('Digest Authentication', () => {
    it('should configure digest authentication', () => {
      const auth = new Authentication({
        type: 'digest',
        fields: [
          { key: 'username', label: 'Username', required: true },
          { key: 'password', label: 'Password', required: true, type: 'password' },
        ],
        test: async () => ({ authenticated: true }),
      })

      expect(auth.type).toBe('digest')
    })

    // Digest auth implementation would be more complex
    // These are placeholder tests for the RED phase
  })

  // ============================================================================
  // CONNECTION LABEL
  // ============================================================================

  describe('Connection Label', () => {
    it('should return static connection label', async () => {
      const auth = new Authentication({
        type: 'api_key',
        connectionLabel: 'API Key Connection',
        test: async () => ({}),
      })

      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const label = await auth.getConnectionLabel(z, bundle)

      expect(label).toBe('API Key Connection')
    })

    it('should return dynamic connection label', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          email: 'user@example.com',
          company: 'Acme Inc',
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const auth = new Authentication({
        type: 'oauth2',
        oauth2Config: {
          authorizeUrl: 'https://auth.example.com/authorize',
          getAccessToken: async () => ({ access_token: 'token' }),
        },
        connectionLabel: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/me',
            headers: {
              'Authorization': `Bearer ${bundle.authData.access_token}`,
            },
            skipThrowForStatus: true,
          })
          const user = response.data as { email: string; company: string }
          return `${user.email} (${user.company})`
        },
        test: async () => ({}),
      })

      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'valid_token' },
      }

      const label = await auth.getConnectionLabel(z, bundle)

      expect(label).toBe('user@example.com (Acme Inc)')
    })

    it('should return default label when not configured', async () => {
      const auth = new Authentication({
        type: 'api_key',
        test: async () => ({}),
      })

      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const label = await auth.getConnectionLabel(z, bundle)

      expect(label).toBe('Connected')
    })
  })

  // ============================================================================
  // AUTH MIDDLEWARE
  // ============================================================================

  describe('Auth Middleware', () => {
    it('should create middleware for API key auth', async () => {
      const auth = new Authentication({
        type: 'api_key',
        test: async () => ({}),
      })

      const middleware = createAuthMiddleware(auth)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'my-api-key' },
      }

      const request = await middleware(
        { url: 'https://api.example.com/test', headers: {} },
        z,
        bundle
      )

      expect(request.headers!['Authorization']).toBe('Bearer my-api-key')
    })

    it('should create middleware for OAuth2 auth', async () => {
      const auth = new Authentication({
        type: 'oauth2',
        oauth2Config: {
          authorizeUrl: 'https://auth.example.com/authorize',
          getAccessToken: async () => ({ access_token: 'token' }),
        },
        test: async () => ({}),
      })

      const middleware = createAuthMiddleware(auth)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'oauth_access_token' },
      }

      const request = await middleware(
        { url: 'https://api.example.com/test', headers: {} },
        z,
        bundle
      )

      expect(request.headers!['Authorization']).toBe('Bearer oauth_access_token')
    })

    it('should create middleware for basic auth', async () => {
      const auth = new Authentication({
        type: 'basic',
        test: async () => ({}),
      })

      const middleware = createAuthMiddleware(auth)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { username: 'user', password: 'pass' },
      }

      const request = await middleware(
        { url: 'https://api.example.com/test', headers: {} },
        z,
        bundle
      )

      expect(request.headers!['Authorization']).toBe('Basic dXNlcjpwYXNz')
    })

    it('should create middleware for session auth', async () => {
      const auth = new Authentication({
        type: 'session',
        sessionConfig: {
          perform: async () => ({ sessionKey: 'session123' }),
        },
        test: async () => ({}),
      })

      const middleware = createAuthMiddleware(auth)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { sessionKey: 'active_session' },
      }

      const request = await middleware(
        { url: 'https://api.example.com/test', headers: {} },
        z,
        bundle
      )

      expect(request.headers!['X-Session-Key']).toBe('active_session')
    })

    it('should preserve existing headers', async () => {
      const auth = new Authentication({
        type: 'api_key',
        test: async () => ({}),
      })

      const middleware = createAuthMiddleware(auth)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'my-key' },
      }

      const request = await middleware(
        {
          url: 'https://api.example.com/test',
          headers: {
            'Content-Type': 'application/json',
            'X-Custom': 'value',
          },
        },
        z,
        bundle
      )

      expect(request.headers!['Content-Type']).toBe('application/json')
      expect(request.headers!['X-Custom']).toBe('value')
      expect(request.headers!['Authorization']).toBe('Bearer my-key')
    })
  })

  // ============================================================================
  // BEARER TOKEN HELPER
  // ============================================================================

  describe('Bearer Token Helper', () => {
    it('should create bearer auth header', () => {
      const header = createBearerAuthHeader('my_access_token')

      expect(header).toBe('Bearer my_access_token')
    })

    it('should handle empty token', () => {
      const header = createBearerAuthHeader('')

      expect(header).toBe('Bearer ')
    })
  })

  // ============================================================================
  // APP INTEGRATION WITH AUTH
  // ============================================================================

  describe('App Integration with Authentication', () => {
    it('should include authentication in app config', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        authentication: {
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://auth.example.com/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({ id: 'user123' }),
          connectionLabel: async (z, bundle) => {
            return `User: ${bundle.authData.user_id}`
          },
        },
        triggers: {},
        actions: {},
        searches: {},
      })

      expect(app.config.authentication).toBeDefined()
      expect(app.config.authentication?.type).toBe('oauth2')
    })

    it('should export authentication in Zapier format', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        authentication: {
          type: 'api_key',
          fields: [{ key: 'api_key', label: 'API Key', required: true }],
          test: async () => ({}),
        },
        triggers: {},
        actions: {},
        searches: {},
      })

      const exported = app.toZapierFormat()

      expect(exported.authentication).toBeDefined()
      expect(exported.authentication?.type).toBe('api_key')
    })

    it('should validate authentication configuration', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        authentication: {
          type: 'oauth2',
          // Missing oauth2Config
          test: async () => ({}),
        } as AuthenticationConfig,
        triggers: {},
        actions: {},
        searches: {},
      })

      const validation = app.validate()

      // Should warn about missing OAuth2 config
      expect(
        validation.warnings.some(w => w.includes('oauth2Config'))
      ).toBe(true)
    })

    it('should test authentication through app', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'user123', email: 'test@example.com' }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        authentication: {
          type: 'api_key',
          fields: [{ key: 'api_key', label: 'API Key', required: true }],
          test: async (z, bundle) => {
            const response = await z.request({
              url: 'https://api.example.com/me',
              headers: {
                'Authorization': `Bearer ${bundle.authData.api_key}`,
              },
              skipThrowForStatus: true,
            })
            return response.data
          },
        },
        triggers: {},
        actions: {},
        searches: {},
      })

      const result = await app.testAuthentication({
        inputData: {},
        authData: { api_key: 'test_key' },
      })

      expect((result as any).id).toBe('user123')
    })
  })
})
