import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * CLI Device Authorization Flow Tests (TDD RED Phase)
 *
 * These tests define the expected behavior for CLI device authentication.
 * They are expected to FAIL until the implementation is created.
 *
 * Flow overview:
 * 1. User runs `org.ai login`
 * 2. CLI requests device code from oauth.do
 * 3. CLI displays user code and verification URL
 * 4. User opens browser, enters code, authorizes
 * 5. CLI polls for token until authorized
 * 6. Token stored in local config file
 * 7. Subsequent commands use stored token
 * 8. `org.ai logout` clears token
 *
 * Implementation location: cli/device-auth.ts
 * OAuth provider: oauth.do/node
 */

// ============================================================================
// Import the device auth module (will fail - module doesn't exist yet)
// ============================================================================

import {
  requestDeviceCode,
  pollForToken,
  storeToken,
  getStoredToken,
  clearToken,
  getConfigPath,
  type DeviceCodeResponse,
  type TokenResponse,
  type PollError,
} from '../device-auth'

// ============================================================================
// Type Definitions for Tests
// ============================================================================

interface DeviceCodeResponseExpected {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

interface TokenResponseExpected {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the oauth.do API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock filesystem operations for token storage
const mockFs = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
}

vi.mock('fs/promises', () => mockFs)

// Mock os for config directory
vi.mock('os', () => ({
  homedir: () => '/home/testuser',
  platform: () => 'darwin',
}))

// ============================================================================
// Device Code Request Tests
// ============================================================================

describe('requestDeviceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns device_code, user_code, and verification_uri on success', async () => {
    const mockResponse: DeviceCodeResponseExpected = {
      device_code: 'GmRh-device-code-12345',
      user_code: 'WDJB-MJHT',
      verification_uri: 'https://oauth.do/device',
      verification_uri_complete: 'https://oauth.do/device?user_code=WDJB-MJHT',
      expires_in: 600,
      interval: 5,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const result = await requestDeviceCode()

    expect(result).toHaveProperty('device_code')
    expect(result).toHaveProperty('user_code')
    expect(result).toHaveProperty('verification_uri')
    expect(result.device_code).toBe('GmRh-device-code-12345')
    expect(result.user_code).toBe('WDJB-MJHT')
    expect(result.verification_uri).toBe('https://oauth.do/device')
  })

  it('calls oauth.do device authorization endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'test',
          user_code: 'TEST-CODE',
          verification_uri: 'https://oauth.do/device',
          expires_in: 600,
          interval: 5,
        }),
    })

    await requestDeviceCode()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('oauth.do'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      })
    )
  })

  it('includes client_id and scope in request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'test',
          user_code: 'TEST-CODE',
          verification_uri: 'https://oauth.do/device',
          expires_in: 600,
          interval: 5,
        }),
    })

    await requestDeviceCode({ scope: 'openid profile email' })

    const [url, options] = mockFetch.mock.calls[0]
    expect(options.body).toContain('client_id=')
    expect(options.body).toContain('scope=openid')
  })

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(requestDeviceCode()).rejects.toThrow('Network error')
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ error: 'invalid_request' }),
    })

    await expect(requestDeviceCode()).rejects.toThrow()
  })

  it('includes verification_uri_complete when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'test',
          user_code: 'TEST-CODE',
          verification_uri: 'https://oauth.do/device',
          verification_uri_complete: 'https://oauth.do/device?user_code=TEST-CODE',
          expires_in: 600,
          interval: 5,
        }),
    })

    const result = await requestDeviceCode()

    expect(result.verification_uri_complete).toBe('https://oauth.do/device?user_code=TEST-CODE')
  })

  it('includes expires_in and interval for polling', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'test',
          user_code: 'TEST-CODE',
          verification_uri: 'https://oauth.do/device',
          expires_in: 900,
          interval: 10,
        }),
    })

    const result = await requestDeviceCode()

    expect(result.expires_in).toBe(900)
    expect(result.interval).toBe(10)
  })
})

// ============================================================================
// Token Polling Tests
// ============================================================================

describe('pollForToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns access token when authorization is complete', async () => {
    const mockToken: TokenResponseExpected = {
      access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token-12345',
      scope: 'openid profile email',
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockToken),
    })

    const tokenPromise = pollForToken('device-code-123', { interval: 1, maxAttempts: 1 })

    const result = await tokenPromise

    expect(result).toHaveProperty('access_token')
    expect(result.access_token).toBe(mockToken.access_token)
    expect(result.token_type).toBe('Bearer')
  })

  it('polls at specified interval while authorization_pending', async () => {
    // First two calls return pending, third returns token
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'final-token',
            token_type: 'Bearer',
          }),
      })

    const tokenPromise = pollForToken('device-code-123', { interval: 5, maxAttempts: 10 })

    // Advance timers to trigger polls
    await vi.advanceTimersByTimeAsync(5000) // First poll
    await vi.advanceTimersByTimeAsync(5000) // Second poll

    const result = await tokenPromise

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result.access_token).toBe('final-token')
  })

  it('respects slow_down response by increasing interval', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'slow_down' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'token-after-slowdown',
            token_type: 'Bearer',
          }),
      })

    const tokenPromise = pollForToken('device-code-123', { interval: 5, maxAttempts: 10 })

    // First poll at normal interval
    await vi.advanceTimersByTimeAsync(5000)
    // After slow_down, interval should increase by 5 seconds
    await vi.advanceTimersByTimeAsync(10000)

    const result = await tokenPromise

    expect(result.access_token).toBe('token-after-slowdown')
  })

  it('throws on access_denied error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'access_denied', error_description: 'User denied access' }),
    })

    const tokenPromise = pollForToken('device-code-123', { interval: 1, maxAttempts: 1 })

    await expect(tokenPromise).rejects.toThrow('access_denied')
  })

  it('throws on expired_token error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'expired_token', error_description: 'Device code expired' }),
    })

    const tokenPromise = pollForToken('device-code-123', { interval: 1, maxAttempts: 1 })

    await expect(tokenPromise).rejects.toThrow('expired_token')
  })

  it('times out after max attempts', async () => {
    // Always return pending
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'authorization_pending' }),
    })

    const tokenPromise = pollForToken('device-code-123', { interval: 1, maxAttempts: 3 })

    // Advance through all attempts
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(tokenPromise).rejects.toThrow('timeout')
  })

  it('calls oauth.do token endpoint with device_code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'test-token',
          token_type: 'Bearer',
        }),
    })

    await pollForToken('my-device-code', { interval: 1, maxAttempts: 1 })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('oauth.do'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('device_code=my-device-code'),
      })
    )
  })

  it('includes grant_type in token request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'test-token',
          token_type: 'Bearer',
        }),
    })

    await pollForToken('device-code', { interval: 1, maxAttempts: 1 })

    const [, options] = mockFetch.mock.calls[0]
    expect(options.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code')
  })

  it('returns refresh_token when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'access-token',
          token_type: 'Bearer',
          refresh_token: 'refresh-token-xyz',
          expires_in: 3600,
        }),
    })

    const result = await pollForToken('device-code', { interval: 1, maxAttempts: 1 })

    expect(result.refresh_token).toBe('refresh-token-xyz')
  })

  it('provides progress callback during polling', async () => {
    const onProgress = vi.fn()

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'token',
            token_type: 'Bearer',
          }),
      })

    const tokenPromise = pollForToken('device-code', { interval: 1, maxAttempts: 5, onProgress })

    await vi.advanceTimersByTimeAsync(1000)
    await tokenPromise

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }))
  })
})

// ============================================================================
// Token Storage Tests
// ============================================================================

describe('storeToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.access.mockRejectedValue({ code: 'ENOENT' })
  })

  it('writes token to config file', async () => {
    const token: TokenResponseExpected = {
      access_token: 'my-access-token',
      token_type: 'Bearer',
      refresh_token: 'my-refresh-token',
      expires_in: 3600,
    }

    await storeToken(token)

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.org.ai'),
      expect.any(String),
      expect.objectContaining({ mode: 0o600 }) // Secure permissions
    )
  })

  it('stores token in JSON format', async () => {
    const token: TokenResponseExpected = {
      access_token: 'json-token',
      token_type: 'Bearer',
    }

    await storeToken(token)

    const writtenContent = mockFs.writeFile.mock.calls[0][1]
    const parsed = JSON.parse(writtenContent)

    expect(parsed).toHaveProperty('access_token', 'json-token')
  })

  it('creates config directory if it does not exist', async () => {
    mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' })

    await storeToken({ access_token: 'test', token_type: 'Bearer' })

    expect(mockFs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('.org.ai'),
      expect.objectContaining({ recursive: true })
    )
  })

  it('sets secure file permissions (0600)', async () => {
    await storeToken({ access_token: 'secure-token', token_type: 'Bearer' })

    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ mode: 0o600 }))
  })

  it('stores expiration timestamp when expires_in provided', async () => {
    const now = Date.now()
    vi.setSystemTime(now)

    await storeToken({
      access_token: 'expiring-token',
      token_type: 'Bearer',
      expires_in: 3600,
    })

    const writtenContent = mockFs.writeFile.mock.calls[0][1]
    const parsed = JSON.parse(writtenContent)

    expect(parsed).toHaveProperty('expires_at')
    expect(parsed.expires_at).toBeGreaterThan(now)
  })

  it('stores refresh_token when provided', async () => {
    await storeToken({
      access_token: 'access',
      token_type: 'Bearer',
      refresh_token: 'refresh-abc',
    })

    const writtenContent = mockFs.writeFile.mock.calls[0][1]
    const parsed = JSON.parse(writtenContent)

    expect(parsed).toHaveProperty('refresh_token', 'refresh-abc')
  })

  it('throws on filesystem error', async () => {
    mockFs.writeFile.mockRejectedValueOnce(new Error('Permission denied'))

    await expect(storeToken({ access_token: 'test', token_type: 'Bearer' })).rejects.toThrow('Permission denied')
  })
})

// ============================================================================
// Token Retrieval Tests
// ============================================================================

describe('getStoredToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns stored token when present', async () => {
    const storedData = {
      access_token: 'stored-access-token',
      token_type: 'Bearer',
      refresh_token: 'stored-refresh-token',
      expires_at: Date.now() + 3600000,
    }

    mockFs.readFile.mockResolvedValueOnce(JSON.stringify(storedData))

    const result = await getStoredToken()

    expect(result).toHaveProperty('access_token', 'stored-access-token')
    expect(result).toHaveProperty('refresh_token', 'stored-refresh-token')
  })

  it('returns null when no token file exists', async () => {
    mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' })

    const result = await getStoredToken()

    expect(result).toBeNull()
  })

  it('returns null when token is expired', async () => {
    const storedData = {
      access_token: 'expired-token',
      token_type: 'Bearer',
      expires_at: Date.now() - 1000, // Already expired
    }

    mockFs.readFile.mockResolvedValueOnce(JSON.stringify(storedData))

    const result = await getStoredToken()

    expect(result).toBeNull()
  })

  it('returns token even when close to expiry (has refresh_token)', async () => {
    const storedData = {
      access_token: 'almost-expired-token',
      token_type: 'Bearer',
      refresh_token: 'can-refresh',
      expires_at: Date.now() + 60000, // 1 minute left
    }

    mockFs.readFile.mockResolvedValueOnce(JSON.stringify(storedData))

    const result = await getStoredToken()

    // Should return token because refresh_token allows renewal
    expect(result).not.toBeNull()
    expect(result?.access_token).toBe('almost-expired-token')
  })

  it('reads from correct config path', async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        access_token: 'test',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
      })
    )

    await getStoredToken()

    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('.org.ai'), 'utf-8')
  })

  it('handles malformed JSON gracefully', async () => {
    mockFs.readFile.mockResolvedValueOnce('not valid json {{{')

    const result = await getStoredToken()

    expect(result).toBeNull()
  })

  it('validates token structure', async () => {
    // Missing required fields
    mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ incomplete: true }))

    const result = await getStoredToken()

    expect(result).toBeNull()
  })
})

// ============================================================================
// Token Clearing Tests
// ============================================================================

describe('clearToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes token file from filesystem', async () => {
    mockFs.unlink.mockResolvedValueOnce(undefined)

    await clearToken()

    expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('.org.ai'))
  })

  it('does not throw if token file does not exist', async () => {
    mockFs.unlink.mockRejectedValueOnce({ code: 'ENOENT' })

    // Should not throw
    await expect(clearToken()).resolves.not.toThrow()
  })

  it('throws on other filesystem errors', async () => {
    mockFs.unlink.mockRejectedValueOnce(new Error('Permission denied'))

    await expect(clearToken()).rejects.toThrow('Permission denied')
  })

  it('returns true when token was cleared', async () => {
    mockFs.unlink.mockResolvedValueOnce(undefined)

    const result = await clearToken()

    expect(result).toBe(true)
  })

  it('returns false when no token existed', async () => {
    mockFs.unlink.mockRejectedValueOnce({ code: 'ENOENT' })

    const result = await clearToken()

    expect(result).toBe(false)
  })
})

// ============================================================================
// Config Path Tests
// ============================================================================

describe('getConfigPath', () => {
  it('returns path in user home directory', () => {
    const path = getConfigPath()

    expect(path).toContain('/home/testuser')
  })

  it('uses .org.ai directory for config', () => {
    const path = getConfigPath()

    expect(path).toContain('.org.ai')
  })

  it('returns path to credentials.json file', () => {
    const path = getConfigPath()

    expect(path).toContain('credentials.json')
  })

  it('returns consistent path on multiple calls', () => {
    const path1 = getConfigPath()
    const path2 = getConfigPath()

    expect(path1).toBe(path2)
  })
})

// ============================================================================
// Full Login Flow Integration Tests
// ============================================================================

describe('CLI Login Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockFs.access.mockRejectedValue({ code: 'ENOENT' })
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.writeFile.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('complete flow: request code -> poll -> store token', async () => {
    // Step 1: Request device code
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'flow-device-code',
          user_code: 'FLOW-CODE',
          verification_uri: 'https://oauth.do/device',
          expires_in: 600,
          interval: 5,
        }),
    })

    const deviceCode = await requestDeviceCode()

    expect(deviceCode.user_code).toBe('FLOW-CODE')
    expect(deviceCode.verification_uri).toBe('https://oauth.do/device')

    // Step 2: Poll for token (user authorizes in browser)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'flow-access-token',
          token_type: 'Bearer',
          refresh_token: 'flow-refresh-token',
          expires_in: 3600,
        }),
    })

    const tokenPromise = pollForToken(deviceCode.device_code, { interval: 1, maxAttempts: 1 })
    const token = await tokenPromise

    expect(token.access_token).toBe('flow-access-token')

    // Step 3: Store token
    await storeToken(token)

    expect(mockFs.writeFile).toHaveBeenCalled()
    const storedContent = JSON.parse(mockFs.writeFile.mock.calls[0][1])
    expect(storedContent.access_token).toBe('flow-access-token')
  })

  it('displays user code and verification URL for user', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'display-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://oauth.do/device',
          verification_uri_complete: 'https://oauth.do/device?user_code=ABCD-EFGH',
          expires_in: 600,
          interval: 5,
        }),
    })

    const result = await requestDeviceCode()

    // These values should be displayed to user in CLI
    expect(result.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(result.verification_uri).toBeTruthy()
    expect(result.verification_uri_complete).toContain(result.user_code)
  })

  it('uses stored token for subsequent commands', async () => {
    const storedData = {
      access_token: 'stored-for-command',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600000,
    }

    mockFs.readFile.mockResolvedValueOnce(JSON.stringify(storedData))

    const token = await getStoredToken()

    // Token should be available for making authenticated API calls
    expect(token).not.toBeNull()
    expect(token?.access_token).toBe('stored-for-command')
  })
})

// ============================================================================
// Logout Flow Tests
// ============================================================================

describe('CLI Logout Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logout clears stored token', async () => {
    mockFs.unlink.mockResolvedValueOnce(undefined)

    await clearToken()

    expect(mockFs.unlink).toHaveBeenCalled()
  })

  it('subsequent getStoredToken returns null after logout', async () => {
    // First call clears the token
    mockFs.unlink.mockResolvedValueOnce(undefined)
    await clearToken()

    // Second call should return null
    mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' })
    const token = await getStoredToken()

    expect(token).toBeNull()
  })

  it('logout is idempotent (can be called multiple times)', async () => {
    mockFs.unlink.mockRejectedValue({ code: 'ENOENT' })

    // Multiple logouts should not throw
    await expect(clearToken()).resolves.not.toThrow()
    await expect(clearToken()).resolves.not.toThrow()
    await expect(clearToken()).resolves.not.toThrow()
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Device Auth Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles oauth server unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(requestDeviceCode()).rejects.toThrow()
  })

  it('handles invalid client_id error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: 'invalid_client',
          error_description: 'Unknown client',
        }),
    })

    await expect(requestDeviceCode()).rejects.toThrow('invalid_client')
  })

  it('handles rate limiting gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '60' }),
      json: () => Promise.resolve({ error: 'rate_limit_exceeded' }),
    })

    await expect(requestDeviceCode()).rejects.toThrow()
  })

  it('provides meaningful error messages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'unsupported_grant_type',
          error_description: 'The authorization grant type is not supported',
        }),
    })

    try {
      await requestDeviceCode()
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('unsupported')
    }
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('Device Auth Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('token file has restricted permissions (owner read/write only)', async () => {
    mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' })
    mockFs.mkdir.mockResolvedValueOnce(undefined)
    mockFs.writeFile.mockResolvedValueOnce(undefined)

    await storeToken({ access_token: 'secure', token_type: 'Bearer' })

    const [, , options] = mockFs.writeFile.mock.calls[0]
    expect(options.mode).toBe(0o600)
  })

  it('config directory has restricted permissions', async () => {
    mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' })
    mockFs.mkdir.mockResolvedValueOnce(undefined)
    mockFs.writeFile.mockResolvedValueOnce(undefined)

    await storeToken({ access_token: 'secure', token_type: 'Bearer' })

    const [, options] = mockFs.mkdir.mock.calls[0]
    expect(options.mode).toBe(0o700)
  })

  it('does not log sensitive token values', async () => {
    // This test verifies that tokens are not accidentally logged
    // Implementation should use appropriate redaction
    const consoleSpy = vi.spyOn(console, 'log')
    const consoleErrorSpy = vi.spyOn(console, 'error')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: 'secret-device-code',
          user_code: 'USER-CODE',
          verification_uri: 'https://oauth.do/device',
          expires_in: 600,
          interval: 5,
        }),
    })

    await requestDeviceCode()

    // Check that sensitive values weren't logged
    for (const call of consoleSpy.mock.calls) {
      expect(call.join(' ')).not.toContain('secret-device-code')
    }
    for (const call of consoleErrorSpy.mock.calls) {
      expect(call.join(' ')).not.toContain('secret-device-code')
    }

    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })
})
