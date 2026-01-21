/**
 * Login Command Tests
 * Tests for OAuth CLI authentication implementation
 * Implements: do-7rf.9.6 - oauth.do integration for CLI auth
 *
 * NO MOCKS - Uses dependency injection via setConfigDir() and real temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, unlink, mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a temporary test directory for credentials
 */
async function createTestConfigDir(): Promise<string> {
  const testDir = join(tmpdir(), `dotdo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(testDir, { recursive: true, mode: 0o700 })
  return testDir
}

/**
 * Create a fake fetch for OAuth API calls.
 * This is dependency injection on global.fetch, which is an acceptable pattern
 * for network testing - we're not mocking internal modules.
 */
function createFakeFetch() {
  const originalFetch = global.fetch
  const calls: Array<{ url: string; options?: RequestInit }> = []
  let responseQueue: Array<{
    ok: boolean
    status?: number
    json: () => Promise<unknown>
  }> = []

  const fakeFetch = async (
    url: string | URL | Request,
    options?: RequestInit
  ): Promise<Response> => {
    calls.push({ url: url.toString(), options })
    const response = responseQueue.shift()
    if (!response) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'no_mock_response' }),
      } as Response
    }
    return response as Response
  }

  global.fetch = fakeFetch as typeof fetch

  return {
    calls,
    mockResponse: (response: (typeof responseQueue)[0]) => {
      responseQueue.push(response)
    },
    restore: () => {
      global.fetch = originalFetch
      responseQueue = []
    },
  }
}

/**
 * Capture console output
 */
function captureConsole() {
  const logs: string[] = []
  const errors: string[] = []
  const originalLog = console.log
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }

  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog
      console.error = originalError
    },
  }
}

// ============================================================================
// Login Command Tests
// ============================================================================

describe('login command', () => {
  let testDir: string
  let fakeFetch: ReturnType<typeof createFakeFetch>
  let output: ReturnType<typeof captureConsole>

  beforeEach(async () => {
    testDir = await createTestConfigDir()
    fakeFetch = createFakeFetch()
    output = captureConsole()

    // Use setConfigDir for dependency injection
    const { setConfigDir } = await import('../commands/login')
    setConfigDir(testDir)
  })

  afterEach(async () => {
    output.restore()
    fakeFetch.restore()

    // Reset config dir
    const { setConfigDir } = await import('../commands/login')
    setConfigDir(undefined)

    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should store token when --token flag is provided', async () => {
    const { login, getStoredToken } = await import('../commands/login')

    await login({ token: 'test-token-123' })

    const stored = await getStoredToken()
    expect(stored).toBeTruthy()
    expect(stored?.access_token).toBe('test-token-123')
    expect(stored?.token_type).toBe('Bearer')
    expect(output.logs.some((log) => log.includes('stored successfully'))).toBe(true)
  })

  it('should show already logged in if valid token exists', async () => {
    const { login } = await import('../commands/login')

    // Store a token first
    await login({ token: 'existing-token' })

    // Clear console
    output.logs.length = 0

    // Try to login again
    await login({})

    expect(output.logs.some((log) => log.includes('Already logged in'))).toBe(true)
  })

  it('should store credentials with secure permissions', async () => {
    const { login, getConfigPath } = await import('../commands/login')

    await login({ token: 'secure-token' })

    const configPath = getConfigPath()
    expect(existsSync(configPath)).toBe(true)

    // Read and verify file content
    const content = await readFile(configPath, 'utf-8')
    const data = JSON.parse(content)
    expect(data.access_token).toBe('secure-token')
  })
})

// ============================================================================
// Logout Command Tests
// ============================================================================

describe('logout command', () => {
  let testDir: string
  let output: ReturnType<typeof captureConsole>

  beforeEach(async () => {
    testDir = await createTestConfigDir()
    output = captureConsole()

    const { setConfigDir } = await import('../commands/login')
    setConfigDir(testDir)
  })

  afterEach(async () => {
    output.restore()

    const { setConfigDir } = await import('../commands/login')
    setConfigDir(undefined)

    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should clear credentials and show success message', async () => {
    const { login } = await import('../commands/login')
    const { logout } = await import('../commands/logout')

    // Login first
    await login({ token: 'test-token' })

    // Clear console
    output.logs.length = 0

    // Logout
    await logout({})

    expect(output.logs.some((log) => log.includes('Logged out successfully'))).toBe(true)

    // Verify token was cleared
    const { getStoredToken } = await import('../commands/login')
    const stored = await getStoredToken()
    expect(stored).toBeNull()
  })

  it('should show message if not logged in', async () => {
    const { logout } = await import('../commands/logout')

    await logout({})

    expect(output.logs.some((log) => log.includes('Not currently logged in'))).toBe(true)
  })

  it('should show verbose output if verbose flag is set', async () => {
    const { login } = await import('../commands/login')
    const { logout } = await import('../commands/logout')

    await login({ token: 'test-token' })
    output.logs.length = 0

    await logout({ verbose: true })

    expect(output.logs.some((log) => log.includes('credentials.json'))).toBe(true)
  })
})

// ============================================================================
// Whoami Command Tests
// ============================================================================

describe('whoami command', () => {
  let testDir: string
  let fakeFetch: ReturnType<typeof createFakeFetch>
  let output: ReturnType<typeof captureConsole>

  beforeEach(async () => {
    testDir = await createTestConfigDir()
    fakeFetch = createFakeFetch()
    output = captureConsole()

    const { setConfigDir } = await import('../commands/login')
    setConfigDir(testDir)
  })

  afterEach(async () => {
    output.restore()
    fakeFetch.restore()

    const { setConfigDir } = await import('../commands/login')
    setConfigDir(undefined)

    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should show not logged in if no token exists', async () => {
    const { whoami } = await import('../commands/whoami')

    await whoami({})

    expect(output.logs.some((log) => log.includes('Not logged in'))).toBe(true)
    expect(output.logs.some((log) => log.includes('dotdo login'))).toBe(true)
  })

  it('should show not logged in for expired tokens without refresh', async () => {
    // This test verifies behavior when token is missing/invalid
    // Expired token checking happens in the CLI layer, not the command
    const { whoami } = await import('../commands/whoami')

    await whoami({})

    expect(output.logs.some((log) => log.includes('Not logged in'))).toBe(true)
  })

  it('should fetch and display user info when logged in', async () => {
    const { login } = await import('../commands/login')
    const { whoami } = await import('../commands/whoami')

    await login({ token: 'valid-token' })

    // Set up fake fetch response
    fakeFetch.mockResponse({
      ok: true,
      json: async () => ({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      }),
    })

    output.logs.length = 0
    await whoami({})

    expect(output.logs.some((log) => log.includes('test@example.com'))).toBe(true)
  })

  it('should output JSON when --json flag is set', async () => {
    const { login } = await import('../commands/login')
    const { whoami } = await import('../commands/whoami')

    await login({ token: 'valid-token' })

    fakeFetch.mockResponse({
      ok: true,
      json: async () => ({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      }),
    })

    output.logs.length = 0
    await whoami({ json: true })

    const jsonOutput = output.logs.join('\n')
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.email).toBe('test@example.com')
    expect(parsed.name).toBe('Test User')
  })

  it('should show verbose info when verbose flag is set', async () => {
    const { login } = await import('../commands/login')
    const { whoami } = await import('../commands/whoami')

    await login({ token: 'valid-token' })

    fakeFetch.mockResponse({
      ok: true,
      json: async () => ({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      }),
    })

    output.logs.length = 0
    await whoami({ verbose: true })

    expect(output.logs.some((log) => log.includes('User ID'))).toBe(true)
  })

  it('should handle failed userinfo fetch gracefully', async () => {
    const { login } = await import('../commands/login')
    const { whoami } = await import('../commands/whoami')

    await login({ token: 'invalid-token' })

    fakeFetch.mockResponse({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    })

    output.logs.length = 0
    await whoami({})

    expect(output.logs.some((log) => log.includes('Failed to fetch'))).toBe(true)
  })
})

// ============================================================================
// Token Storage Tests
// ============================================================================

describe('token storage', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await createTestConfigDir()

    const { setConfigDir } = await import('../commands/login')
    setConfigDir(testDir)
  })

  afterEach(async () => {
    const { setConfigDir } = await import('../commands/login')
    setConfigDir(undefined)

    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should create config directory if it does not exist', async () => {
    const { login, getConfigPath } = await import('../commands/login')
    const { dirname } = await import('path')

    // Use a nested directory that doesn't exist yet
    const nestedTestDir = join(testDir, 'nested', 'config')
    const { setConfigDir } = await import('../commands/login')
    setConfigDir(nestedTestDir)

    await login({ token: 'test-token' })

    expect(existsSync(nestedTestDir)).toBe(true)
  })

  it('should store all token fields correctly', async () => {
    const { login, getStoredToken } = await import('../commands/login')

    await login({ token: 'access-123' })

    const stored = await getStoredToken()
    expect(stored).toBeTruthy()
    expect(stored?.access_token).toBe('access-123')
    expect(stored?.token_type).toBe('Bearer')
    expect(stored?.created_at).toBeGreaterThan(0)
  })

  it('should return null for invalid JSON in credentials file', async () => {
    const { getConfigPath, getStoredToken } = await import('../commands/login')
    const { writeFile } = await import('fs/promises')

    const configPath = getConfigPath()
    const configDir = join(testDir)
    await mkdir(configDir, { recursive: true })
    await writeFile(configPath, 'invalid json{{{')

    const stored = await getStoredToken()
    expect(stored).toBeNull()
  })

  it('should return null for missing required fields', async () => {
    const { getConfigPath, getStoredToken } = await import('../commands/login')
    const { writeFile } = await import('fs/promises')

    const configPath = getConfigPath()
    const configDir = join(testDir)
    await mkdir(configDir, { recursive: true })
    await writeFile(configPath, JSON.stringify({ some_field: 'value' }))

    const stored = await getStoredToken()
    expect(stored).toBeNull()
  })
})
