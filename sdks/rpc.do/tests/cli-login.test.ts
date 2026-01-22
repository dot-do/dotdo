// CLI Login Command Tests - TDD for rpc.do CLI
// Tests the `rpc.do login`, `rpc.do logout`, and `rpc.do whoami` commands
// Following RED -> GREEN -> REFACTOR methodology

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ============================================================================
// Test Setup
// ============================================================================

let testDir: string
let testTokensPath: string

beforeEach(() => {
  testDir = path.join(os.tmpdir(), '.do-cli-login-test-' + Date.now())
  testTokensPath = path.join(testDir, 'tokens.json')
  // Clean up any existing test directory
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

// ============================================================================
// `rpc.do login` - Basic functionality
// ============================================================================

describe('rpc.do login', () => {
  it('login command is registered in CLI', async () => {
    // Import the CLI commands module
    const { loginCommand } = await import('../cli/login')
    expect(loginCommand).toBeDefined()
    expect(typeof loginCommand).toBe('function')
  })

  it('initiates OAuth device flow', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      }),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(mockDeviceFlow.requestDeviceCode).toHaveBeenCalled()
    expect(mockDeviceFlow.pollForToken).toHaveBeenCalledWith('device-123')
  })

  it('displays user code and verification URL', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'WXYZ-5678',
        verification_uri: 'https://auth.example.com/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      }),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    // Should display the user code
    const outputStr = output.join('\n')
    expect(outputStr).toContain('WXYZ-5678')
    expect(outputStr).toContain('https://auth.example.com/device')
  })

  it('stores tokens after successful auth', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      }),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: () => {},
    })

    expect(mockTokenStore.saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      })
    )
  })

  it('shows success message after login', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      }),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(true)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/success|logged in|authenticated/)
  })

  it('handles already logged in user gracefully', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn(),
      pollForToken: vi.fn(),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'existing-token',
        refresh_token: 'existing-refresh',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    // Should not initiate device flow since already logged in
    expect(mockDeviceFlow.requestDeviceCode).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/already|logged in/)
  })

  it('handles login failure gracefully', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockRejectedValue(new Error('access_denied')),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('handles expired device code gracefully', async () => {
    const { loginCommand } = await import('../cli/login')
    const { DeviceFlowError } = await import('../auth/device-flow')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockRejectedValue(
        new DeviceFlowError('expired_token', 'Device code has expired')
      ),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(false)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/expired|timeout|timed out/)
  })
})

// ============================================================================
// `rpc.do logout` - Clear stored tokens
// ============================================================================

describe('rpc.do logout', () => {
  it('logout command is registered', async () => {
    const { logoutCommand } = await import('../cli/login')
    expect(logoutCommand).toBeDefined()
    expect(typeof logoutCommand).toBe('function')
  })

  it('clears stored tokens', async () => {
    const { logoutCommand } = await import('../cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    await logoutCommand({
      tokenStore: mockTokenStore,
      onOutput: () => {},
    })

    expect(mockTokenStore.deleteTokens).toHaveBeenCalled()
  })

  it('shows success message after logout', async () => {
    const { logoutCommand } = await import('../cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await logoutCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(true)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/logged out|success/)
  })

  it('handles logout when not logged in', async () => {
    const { logoutCommand } = await import('../cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await logoutCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    // Should still succeed (idempotent operation)
    expect(result.success).toBe(true)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/not logged in|logged out|already/)
  })
})

// ============================================================================
// `rpc.do whoami` - Show current auth status
// ============================================================================

describe('rpc.do whoami', () => {
  it('whoami command is registered', async () => {
    const { whoamiCommand } = await import('../cli/login')
    expect(whoamiCommand).toBeDefined()
    expect(typeof whoamiCommand).toBe('function')
  })

  it('shows current auth status when logged in', async () => {
    const { whoamiCommand } = await import('../cli/login')

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

    const output: string[] = []
    const result = await whoamiCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(true)
    expect(result.loggedIn).toBe(true)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/logged in|authenticated/)
  })

  it('shows not logged in when no token exists', async () => {
    const { whoamiCommand } = await import('../cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await whoamiCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(true)
    expect(result.loggedIn).toBe(false)
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/not logged in|not authenticated/)
  })

  it('shows expired token status', async () => {
    const { whoamiCommand } = await import('../cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'expired-token',
        refresh_token: 'refresh-token',
        expires_at: Date.now() - 1000, // Expired 1 second ago
      }),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await whoamiCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(true)
    // Token exists but is expired
    const outputStr = output.join('\n').toLowerCase()
    expect(outputStr).toMatch(/expired|refresh/)
  })

  it('shows token expiration time', async () => {
    const { whoamiCommand } = await import('../cli/login')

    const expiresAt = Date.now() + 3600000 // 1 hour from now
    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        expires_at: expiresAt,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await whoamiCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(true)
    expect(result.expiresAt).toBeDefined()
  })
})

// ============================================================================
// CLI Integration - Commands wired to CLI
// ============================================================================

describe('CLI integration', () => {
  it('login command can use default DeviceFlow and TokenStore', async () => {
    const { createDefaultLoginOptions } = await import('../cli/login')

    // This helper should create default options with real DeviceFlow and TokenStore
    const options = createDefaultLoginOptions({
      clientId: 'test-cli',
      oauthBaseUrl: 'https://oauth.do',
      tokensPath: testTokensPath,
    })

    expect(options.deviceFlow).toBeDefined()
    expect(options.tokenStore).toBeDefined()
  })

  it('login respects --force flag to re-authenticate', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://oauth.do/device',
        expires_in: 600,
        interval: 5,
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'existing-token',
        refresh_token: 'existing-refresh',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      force: true, // Force re-authentication
      onOutput: () => {},
    })

    // Should initiate device flow even though already logged in
    expect(mockDeviceFlow.requestDeviceCode).toHaveBeenCalled()
  })
})

// ============================================================================
// Error handling
// ============================================================================

describe('Error handling', () => {
  it('login handles network error during device code request', async () => {
    const { loginCommand } = await import('../cli/login')

    const mockDeviceFlow = {
      requestDeviceCode: vi.fn().mockRejectedValue(new Error('Network error')),
      pollForToken: vi.fn(),
    }

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue(null),
      isTokenExpired: vi.fn().mockResolvedValue(true),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const output: string[] = []
    const result = await loginCommand({
      deviceFlow: mockDeviceFlow,
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Network error')
  })

  it('logout handles error when deleting tokens', async () => {
    const { logoutCommand } = await import('../cli/login')

    const mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn().mockRejectedValue(new Error('Permission denied')),
    }

    const output: string[] = []
    const result = await logoutCommand({
      tokenStore: mockTokenStore,
      onOutput: (msg: string) => output.push(msg),
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Permission denied')
  })
})
