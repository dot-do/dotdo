/**
 * Auth Commands Tests - RED Phase
 *
 * These tests verify the auth commands (login, logout, whoami) for the `do` CLI.
 * They are expected to FAIL until the commands are implemented.
 *
 * The commands will use oauth.do/node:
 * - ensureLoggedIn: Initiates device flow if no token, returns token info
 * - ensureLoggedOut: Clears stored token
 * - getToken: Returns stored token or null
 * - getUser: Fetches user info from token
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock oauth.do/node
// ============================================================================

// Mock the oauth.do/node module before importing commands
vi.mock('oauth.do/node', () => ({
  ensureLoggedIn: vi.fn(),
  ensureLoggedOut: vi.fn(),
  getToken: vi.fn(),
  getUser: vi.fn(),
}))

// Import mocked functions for test assertions
import { ensureLoggedIn, ensureLoggedOut, getToken, getUser } from 'oauth.do/node'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Capture console output for assertions
 */
function captureConsole() {
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  return {
    logs,
    restore: () => {
      console.log = originalLog
    },
  }
}

// ============================================================================
// Login Command Tests
// ============================================================================

describe('do login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls ensureLoggedIn from oauth.do/node', async () => {
    // Setup mock
    vi.mocked(ensureLoggedIn).mockResolvedValue({
      token: 'test-token-123',
      isNewLogin: true,
    })

    // Import and run the login command
    const { run } = await import('../../cli/commands/auth/login')
    await run()

    // Verify ensureLoggedIn was called
    expect(ensureLoggedIn).toHaveBeenCalledTimes(1)
    expect(ensureLoggedIn).toHaveBeenCalledWith(
      expect.objectContaining({
        openBrowser: true,
      })
    )
  })

  it('prints success message on new login', async () => {
    // Setup mock for new login
    vi.mocked(ensureLoggedIn).mockResolvedValue({
      token: 'new-token-456',
      isNewLogin: true,
    })

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/login')
      await run()

      // Should print success message for new login
      expect(output.logs.some((log) => log.includes('Logged in') || log.includes('success'))).toBe(
        true
      )
    } finally {
      output.restore()
    }
  })

  it('prints "already logged in" if token exists', async () => {
    // Setup mock for existing login
    vi.mocked(ensureLoggedIn).mockResolvedValue({
      token: 'existing-token-789',
      isNewLogin: false,
    })

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/login')
      await run()

      // Should print already logged in message
      expect(
        output.logs.some((log) => log.toLowerCase().includes('already logged in'))
      ).toBe(true)
    } finally {
      output.restore()
    }
  })

  it('passes print function to ensureLoggedIn for device flow messages', async () => {
    vi.mocked(ensureLoggedIn).mockResolvedValue({
      token: 'test-token',
      isNewLogin: true,
    })

    const { run } = await import('../../cli/commands/auth/login')
    await run()

    // Verify print option was passed (for device flow URL display)
    expect(ensureLoggedIn).toHaveBeenCalledWith(
      expect.objectContaining({
        print: expect.any(Function),
      })
    )
  })
})

// ============================================================================
// Logout Command Tests
// ============================================================================

describe('do logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls ensureLoggedOut from oauth.do/node', async () => {
    vi.mocked(ensureLoggedOut).mockResolvedValue(undefined)

    const { run } = await import('../../cli/commands/auth/logout')
    await run()

    expect(ensureLoggedOut).toHaveBeenCalledTimes(1)
  })

  it('prints confirmation message after logout', async () => {
    vi.mocked(ensureLoggedOut).mockResolvedValue(undefined)

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/logout')
      await run()

      // Should print logout confirmation
      expect(
        output.logs.some(
          (log) => log.toLowerCase().includes('logged out') || log.toLowerCase().includes('logout')
        )
      ).toBe(true)
    } finally {
      output.restore()
    }
  })

  it('passes print function to ensureLoggedOut', async () => {
    vi.mocked(ensureLoggedOut).mockResolvedValue(undefined)

    const { run } = await import('../../cli/commands/auth/logout')
    await run()

    expect(ensureLoggedOut).toHaveBeenCalledWith(
      expect.objectContaining({
        print: expect.any(Function),
      })
    )
  })
})

// ============================================================================
// Whoami Command Tests
// ============================================================================

describe('do whoami', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and displays current user when logged in', async () => {
    // Setup mocks for logged in user
    vi.mocked(getToken).mockResolvedValue('valid-token-123')
    vi.mocked(getUser).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'test@example.com.ai',
        name: 'Test User',
      },
    })

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/whoami')
      await run()

      // Should display user email
      expect(output.logs.some((log) => log.includes('test@example.com.ai'))).toBe(true)
    } finally {
      output.restore()
    }
  })

  it('shows "not logged in" if no token exists', async () => {
    // Setup mock for no token
    vi.mocked(getToken).mockResolvedValue(null)

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/whoami')
      await run()

      // Should indicate not logged in
      expect(
        output.logs.some(
          (log) =>
            log.toLowerCase().includes('not logged in') ||
            log.toLowerCase().includes('run: do login')
        )
      ).toBe(true)
    } finally {
      output.restore()
    }
  })

  it('calls getToken to check for existing token', async () => {
    vi.mocked(getToken).mockResolvedValue(null)

    const { run } = await import('../../cli/commands/auth/whoami')
    await run()

    expect(getToken).toHaveBeenCalledTimes(1)
  })

  it('calls getUser with token when token exists', async () => {
    vi.mocked(getToken).mockResolvedValue('my-token')
    vi.mocked(getUser).mockResolvedValue({
      user: { id: 'u1', email: 'user@test.com' },
    })

    const { run } = await import('../../cli/commands/auth/whoami')
    await run()

    expect(getUser).toHaveBeenCalledWith('my-token')
  })

  it('handles expired/invalid token gracefully', async () => {
    vi.mocked(getToken).mockResolvedValue('expired-token')
    vi.mocked(getUser).mockResolvedValue({
      user: null,
    })

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/whoami')
      await run()

      // Should suggest re-login for expired session
      expect(
        output.logs.some(
          (log) =>
            log.toLowerCase().includes('expired') || log.toLowerCase().includes('do login')
        )
      ).toBe(true)
    } finally {
      output.restore()
    }
  })

  it('displays user name if available', async () => {
    vi.mocked(getToken).mockResolvedValue('token')
    vi.mocked(getUser).mockResolvedValue({
      user: {
        id: 'u1',
        email: 'john@example.com.ai',
        name: 'John Doe',
      },
    })

    const output = captureConsole()

    try {
      const { run } = await import('../../cli/commands/auth/whoami')
      await run()

      // Should display user info (name or email)
      const hasUserInfo = output.logs.some(
        (log) => log.includes('John Doe') || log.includes('john@example.com.ai')
      )
      expect(hasUserInfo).toBe(true)
    } finally {
      output.restore()
    }
  })
})
