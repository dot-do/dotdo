// OAuth Client Integration Tests for rpc.do
// TDD: These tests define the expected behavior for OAuth device flow integration
// Following RED -> GREEN -> REFACTOR methodology

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ============================================================================
// Token Store Tests
// ============================================================================

describe('TokenStore', () => {
  const testDir = path.join(os.tmpdir(), '.do-test-' + Date.now())
  const testTokensPath = path.join(testDir, 'tokens.json')

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })

  it('should read tokens from ~/.do/tokens.json', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    // Create test tokens file
    fs.mkdirSync(testDir, { recursive: true })
    const tokens = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_at: Date.now() + 3600000, // 1 hour from now
    }
    fs.writeFileSync(testTokensPath, JSON.stringify(tokens))

    const store = new TokenStore(testTokensPath)
    const result = await store.getTokens()

    expect(result).toBeDefined()
    expect(result?.access_token).toBe('test-access-token')
    expect(result?.refresh_token).toBe('test-refresh-token')
  })

  it('should return null when no tokens exist', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    const store = new TokenStore(testTokensPath)
    const result = await store.getTokens()

    expect(result).toBeNull()
  })

  it('should write tokens to ~/.do/tokens.json', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    const store = new TokenStore(testTokensPath)
    await store.saveTokens({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_at: Date.now() + 3600000,
    })

    // Verify file was written
    expect(fs.existsSync(testTokensPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(testTokensPath, 'utf-8'))
    expect(content.access_token).toBe('new-access-token')
  })

  it('should create directory if it does not exist', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    const store = new TokenStore(testTokensPath)
    await store.saveTokens({
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      expires_at: Date.now() + 3600000,
    })

    expect(fs.existsSync(testDir)).toBe(true)
  })

  it('should delete tokens', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    // Create test tokens file
    fs.mkdirSync(testDir, { recursive: true })
    fs.writeFileSync(testTokensPath, JSON.stringify({ access_token: 'test' }))

    const store = new TokenStore(testTokensPath)
    await store.deleteTokens()

    expect(fs.existsSync(testTokensPath)).toBe(false)
  })

  it('should check if token is expired', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    fs.mkdirSync(testDir, { recursive: true })
    const expiredTokens = {
      access_token: 'expired-token',
      refresh_token: 'test-refresh',
      expires_at: Date.now() - 1000, // Expired 1 second ago
    }
    fs.writeFileSync(testTokensPath, JSON.stringify(expiredTokens))

    const store = new TokenStore(testTokensPath)
    const isExpired = await store.isTokenExpired()

    expect(isExpired).toBe(true)
  })

  it('should return false for non-expired token', async () => {
    const { TokenStore } = await import('../src/auth/token-store')

    fs.mkdirSync(testDir, { recursive: true })
    const validTokens = {
      access_token: 'valid-token',
      refresh_token: 'test-refresh',
      expires_at: Date.now() + 3600000, // 1 hour from now
    }
    fs.writeFileSync(testTokensPath, JSON.stringify(validTokens))

    const store = new TokenStore(testTokensPath)
    const isExpired = await store.isTokenExpired()

    expect(isExpired).toBe(false)
  })
})

// ============================================================================
// Device Flow Tests
// ============================================================================

describe('DeviceFlow', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  it('should request device code from oauth.do/device/code', async () => {
    const { DeviceFlow } = await import('../src/auth/device-flow')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'device-123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://oauth.do/device',
          expires_in: 600,
          interval: 5,
        }),
    })

    const flow = new DeviceFlow({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      fetch: mockFetch,
    })

    const result = await flow.requestDeviceCode()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://oauth.do/device/code',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      })
    )
    expect(result.device_code).toBe('device-123')
    expect(result.user_code).toBe('ABCD-1234')
    expect(result.verification_uri).toBe('https://oauth.do/device')
  })

  it('should include client_id and scope in device code request', async () => {
    const { DeviceFlow } = await import('../src/auth/device-flow')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'device-123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://oauth.do/device',
          expires_in: 600,
          interval: 5,
        }),
    })

    const flow = new DeviceFlow({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      scope: 'read write',
      fetch: mockFetch,
    })

    await flow.requestDeviceCode()

    const calls = mockFetch.mock.calls
    const [[, options]] = calls as [[string, { body: string }]]
    expect(options.body).toContain('client_id=test-client')
    expect(options.body).toContain('scope=read+write')
  })

  it('should poll for token until authorization is complete', async () => {
    const { DeviceFlow } = await import('../src/auth/device-flow')

    // First call: authorization pending
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'authorization_pending',
        }),
    })

    // Second call: authorization pending
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'authorization_pending',
        }),
    })

    // Third call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'access-123',
          refresh_token: 'refresh-456',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    })

    const flow = new DeviceFlow({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      fetch: mockFetch,
      pollIntervalMs: 10, // Fast polling for tests
    })

    const result = await flow.pollForToken('device-123')

    expect(result.access_token).toBe('access-123')
    expect(result.refresh_token).toBe('refresh-456')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('should throw on slow_down error and increase interval', async () => {
    const { DeviceFlow } = await import('../src/auth/device-flow')

    // First call: slow_down
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'slow_down',
        }),
    })

    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'access-123',
          refresh_token: 'refresh-456',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    })

    const flow = new DeviceFlow({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      fetch: mockFetch,
      pollIntervalMs: 10,
    })

    const result = await flow.pollForToken('device-123')

    expect(result.access_token).toBe('access-123')
    // Should have been called twice (slow_down, then success)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should throw on access_denied error', async () => {
    const { DeviceFlow, DeviceFlowError } = await import('../src/auth/device-flow')

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'access_denied',
          error_description: 'User denied access',
        }),
    })

    const flow = new DeviceFlow({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      fetch: mockFetch,
    })

    await expect(flow.pollForToken('device-123')).rejects.toThrow(DeviceFlowError)
  })

  it('should throw on expired_token error', async () => {
    const { DeviceFlow, DeviceFlowError } = await import('../src/auth/device-flow')

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'expired_token',
        }),
    })

    const flow = new DeviceFlow({
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      fetch: mockFetch,
    })

    await expect(flow.pollForToken('device-123')).rejects.toThrow(DeviceFlowError)
  })
})

// ============================================================================
// Auth Transport Tests
// ============================================================================

describe('AuthTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  it('should attach Authorization header when token is available', async () => {
    const { AuthTransport } = await import('../src/auth/auth-transport')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
      headers: new Headers(),
    })

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const transport = new AuthTransport({
      url: 'https://api.example.com',
      tokenStore: mockTokenStore,
      fetch: mockFetch,
    })

    await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })

  it('should not attach Authorization header when no token is available', async () => {
    const { AuthTransport } = await import('../src/auth/auth-transport')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
      headers: new Headers(),
    })

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const transport = new AuthTransport({
      url: 'https://api.example.com',
      tokenStore: mockTokenStore,
      fetch: mockFetch,
    })

    await transport.send({ method: 'test', args: [] })

    const calls = mockFetch.mock.calls
    const [[, options]] = calls as [[string, { headers: Record<string, string> }]]
    expect(options.headers['Authorization']).toBeUndefined()
  })

  it('should trigger token refresh on 401 response', async () => {
    const { AuthTransport } = await import('../src/auth/auth-transport')

    // First call: 401 Unauthorized
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'unauthorized' }),
      headers: new Headers(),
    })

    // Second call: success after refresh
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: 'success' }),
      headers: new Headers(),
    })

    const mockTokenStore = {
      getTokens: vi
        .fn()
        .mockResolvedValueOnce({
          access_token: 'old-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() + 3600000,
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_at: Date.now() + 3600000,
        }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockRefresh = vi.fn().mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    })

    const transport = new AuthTransport({
      url: 'https://api.example.com',
      tokenStore: mockTokenStore,
      onRefreshToken: mockRefresh,
      fetch: mockFetch,
    })

    const result = await transport.send({ method: 'test', args: [] })

    expect(mockRefresh).toHaveBeenCalledWith('refresh-token')
    expect(mockTokenStore.saveTokens).toHaveBeenCalled()
    expect(result.result).toEqual({ result: 'success' })
  })

  it('should proactively refresh token when expired', async () => {
    const { AuthTransport } = await import('../src/auth/auth-transport')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: 'success' }),
      headers: new Headers(),
    })

    const mockTokenStore = {
      getTokens: vi
        .fn()
        .mockResolvedValueOnce({
          access_token: 'expired-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() - 1000, // Expired
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_at: Date.now() + 3600000,
        }),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockRefresh = vi.fn().mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    })

    const transport = new AuthTransport({
      url: 'https://api.example.com',
      tokenStore: mockTokenStore,
      onRefreshToken: mockRefresh,
      fetch: mockFetch,
    })

    await transport.send({ method: 'test', args: [] })

    expect(mockRefresh).toHaveBeenCalledWith('refresh-token')
    expect(mockTokenStore.saveTokens).toHaveBeenCalled()
  })

  it('should use new token after refresh for retry', async () => {
    const { AuthTransport } = await import('../src/auth/auth-transport')

    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'unauthorized' }),
      headers: new Headers(),
    })

    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: 'success' }),
      headers: new Headers(),
    })

    const mockTokenStore = {
      getTokens: vi
        .fn()
        .mockResolvedValueOnce({
          access_token: 'old-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() + 3600000,
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_at: Date.now() + 3600000,
        }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockRefresh = vi.fn().mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    })

    const transport = new AuthTransport({
      url: 'https://api.example.com',
      tokenStore: mockTokenStore,
      onRefreshToken: mockRefresh,
      fetch: mockFetch,
    })

    await transport.send({ method: 'test', args: [] })

    // Second call should use the new token
    const calls = mockFetch.mock.calls
    const [, [, secondOptions]] = calls as [[string, { headers: Record<string, string> }], [string, { headers: Record<string, string> }]]
    expect(secondOptions.headers['Authorization']).toBe('Bearer new-token')
  })
})

// ============================================================================
// Token Refresh Tests
// ============================================================================

describe('refreshToken', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  it('should exchange refresh token for new tokens', async () => {
    const { refreshToken } = await import('../src/auth/refresh')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    })

    const result = await refreshToken({
      refreshToken: 'old-refresh-token',
      clientId: 'test-client',
      oauthBaseUrl: 'https://oauth.do',
      fetch: mockFetch,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://oauth.do/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      })
    )

    const calls = mockFetch.mock.calls
    const [[, options]] = calls as [[string, { body: string }]]
    expect(options.body).toContain('grant_type=refresh_token')
    expect(options.body).toContain('refresh_token=old-refresh-token')
    expect(options.body).toContain('client_id=test-client')

    expect(result.access_token).toBe('new-access-token')
    expect(result.refresh_token).toBe('new-refresh-token')
  })

  it('should throw on invalid refresh token', async () => {
    const { refreshToken, RefreshError } = await import('../src/auth/refresh')

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'invalid_grant',
          error_description: 'Refresh token is invalid or expired',
        }),
    })

    await expect(
      refreshToken({
        refreshToken: 'invalid-token',
        clientId: 'test-client',
        oauthBaseUrl: 'https://oauth.do',
        fetch: mockFetch,
      })
    ).rejects.toThrow(RefreshError)
  })
})

// ============================================================================
// ensureLoggedIn Tests
// ============================================================================

describe('ensureLoggedIn', () => {
  it('should return true when valid token exists', async () => {
    const { ensureLoggedIn } = await import('../src/auth/index')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const result = await ensureLoggedIn({ tokenStore: mockTokenStore })

    expect(result).toBe(true)
  })

  it('should return false when no token exists and no device flow available', async () => {
    const { ensureLoggedIn } = await import('../src/auth/index')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const result = await ensureLoggedIn({
      tokenStore: mockTokenStore,
      interactive: false,
    })

    expect(result).toBe(false)
  })

  it('should initiate device flow when interactive and no token', async () => {
    const { ensureLoggedIn } = await import('../src/auth/index')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    }

    const mockDisplay = vi.fn()

    const result = await ensureLoggedIn({
      tokenStore: mockTokenStore,
      deviceFlow: mockDeviceFlow,
      interactive: true,
      onDisplayCode: mockDisplay,
    })

    expect(mockDeviceFlow.requestDeviceCode).toHaveBeenCalled()
    expect(mockDisplay).toHaveBeenCalledWith({
      userCode: 'ABCD-1234',
      verificationUri: 'https://oauth.do/device',
    })
    expect(mockDeviceFlow.pollForToken).toHaveBeenCalledWith('device-123')
    expect(mockTokenStore.saveTokens).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('should refresh token when expired and refresh token is available', async () => {
    const { ensureLoggedIn } = await import('../src/auth/index')

    const mockTokenStore = {
      getTokens: vi
        .fn()
        .mockResolvedValueOnce({
          access_token: 'expired-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() - 1000, // Expired
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_at: Date.now() + 3600000,
        }),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockRefresh = vi.fn().mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    })

    const result = await ensureLoggedIn({
      tokenStore: mockTokenStore,
      onRefreshToken: mockRefresh,
    })

    expect(mockRefresh).toHaveBeenCalledWith('refresh-token')
    expect(mockTokenStore.saveTokens).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})

// ============================================================================
// Complete Device Flow Integration Test
// ============================================================================

describe('Device Flow Integration', () => {
  it('should complete full device flow and store tokens', async () => {
    const { DeviceFlow } = await import('../src/auth/device-flow')
    const { TokenStore } = await import('../src/auth/token-store')
    const testDir = path.join(os.tmpdir(), '.do-integration-test-' + Date.now())
    const testTokensPath = path.join(testDir, 'tokens.json')

    const mockFetch = vi.fn()

    // Device code request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'device-123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://oauth.do/device',
          verification_uri_complete: 'https://oauth.do/device?user_code=ABCD-1234',
          expires_in: 600,
          interval: 5,
        }),
    })

    // Token poll - authorization pending
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'authorization_pending',
        }),
    })

    // Token poll - success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'final-access-token',
          refresh_token: 'final-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    })

    try {
      const deviceFlow = new DeviceFlow({
        clientId: 'test-client',
        oauthBaseUrl: 'https://oauth.do',
        fetch: mockFetch,
        pollIntervalMs: 10,
      })

      const tokenStore = new TokenStore(testTokensPath)

      // Request device code
      const codeResponse = await deviceFlow.requestDeviceCode()
      expect(codeResponse.user_code).toBe('ABCD-1234')

      // Poll for token
      const tokenResponse = await deviceFlow.pollForToken(codeResponse.device_code)
      expect(tokenResponse.access_token).toBe('final-access-token')

      // Save tokens
      await tokenStore.saveTokens({
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token!,
        expires_at: Date.now() + tokenResponse.expires_in * 1000,
      })

      // Verify tokens were saved
      const savedTokens = await tokenStore.getTokens()
      expect(savedTokens?.access_token).toBe('final-access-token')
      expect(savedTokens?.refresh_token).toBe('final-refresh-token')
    } finally {
      // Cleanup
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true })
      }
    }
  })
})
