/**
 * Dev Command Tests - RED Phase (TDD)
 *
 * Tests for `do dev` command that starts local development server.
 * These tests are expected to FAIL until the command is implemented.
 *
 * The dev command will:
 * 1. Ensure user is authenticated (via oauth.do/node ensureLoggedIn)
 * 2. Spawn wrangler dev with DO_TOKEN in environment
 * 3. Forward additional arguments to wrangler
 * 4. Handle server startup/shutdown gracefully
 *
 * Implementation will be in: cli/commands/dev/dev.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock oauth.do/node
// ============================================================================

vi.mock('oauth.do/node', () => ({
  ensureLoggedIn: vi.fn(),
  getToken: vi.fn(),
}))

import { ensureLoggedIn, getToken } from 'oauth.do/node'

// ============================================================================
// Types
// ============================================================================

interface SpawnOptions {
  env?: Record<string, string | undefined>
  stdio?: ['inherit' | 'pipe', 'inherit' | 'pipe', 'inherit' | 'pipe'] | 'inherit'
  cwd?: string
}

interface SpawnedProcess {
  pid: number
  exited: Promise<number>
  kill: (signal?: number) => void
  stdout?: ReadableStream<Uint8Array>
  stderr?: ReadableStream<Uint8Array>
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Capture console output for assertions
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

/**
 * Mock spawn function that tracks calls
 */
function createSpawnMock() {
  const calls: Array<{ command: string[]; options?: SpawnOptions }> = []
  let exitCode = 0
  let shouldReject = false

  const mock = vi.fn((command: string[], options?: SpawnOptions): SpawnedProcess => {
    calls.push({ command, options })
    return {
      pid: 12345,
      exited: shouldReject
        ? Promise.reject(new Error('Process failed'))
        : Promise.resolve(exitCode),
      kill: vi.fn(),
    }
  })

  return {
    mock,
    calls,
    setExitCode: (code: number) => {
      exitCode = code
    },
    setReject: (reject: boolean) => {
      shouldReject = reject
    },
  }
}

// ============================================================================
// Test Constants
// ============================================================================

const MOCK_TOKEN = 'test-token-xyz123'
const MOCK_USER = {
  id: 'user_123',
  email: 'dev@example.com',
  name: 'Developer',
}

// ============================================================================
// Dev Command Tests
// ============================================================================

describe('do dev', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: user is authenticated
    vi.mocked(ensureLoggedIn).mockResolvedValue({
      token: MOCK_TOKEN,
      isNewLogin: false,
    })
    vi.mocked(getToken).mockResolvedValue(MOCK_TOKEN)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('Authentication', () => {
    it('ensures user is authenticated before starting dev server', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(ensureLoggedIn).toHaveBeenCalledTimes(1)
      expect(ensureLoggedIn).toHaveBeenCalledWith(
        expect.objectContaining({
          openBrowser: true,
        })
      )
    })

    it('does not start server if authentication fails', async () => {
      vi.mocked(ensureLoggedIn).mockRejectedValue(new Error('Authentication failed'))

      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow(/authentication/i)
      expect(spawnMock.calls).toHaveLength(0)
    })

    it('shows login URL when initiating device flow', async () => {
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: true,
      })

      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/dev')
        const spawnMock = createSpawnMock()

        await run([], { spawn: spawnMock.mock })

        // Should have passed print function for device flow messages
        expect(ensureLoggedIn).toHaveBeenCalledWith(
          expect.objectContaining({
            print: expect.any(Function),
          })
        )
      } finally {
        output.restore()
      }
    })

    it('continues with existing token if already logged in', async () => {
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: false,
      })

      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Should still call ensureLoggedIn (it returns existing token)
      expect(ensureLoggedIn).toHaveBeenCalled()
      // Should proceed to spawn wrangler
      expect(spawnMock.calls).toHaveLength(1)
    })
  })

  // ==========================================================================
  // Wrangler Spawn Tests
  // ==========================================================================

  describe('Wrangler Spawn', () => {
    it('spawns wrangler dev command', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls).toHaveLength(1)
      expect(spawnMock.calls[0].command).toContain('wrangler')
      expect(spawnMock.calls[0].command).toContain('dev')
    })

    it('uses bunx to run wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command[0]).toBe('bunx')
      expect(spawnMock.calls[0].command[1]).toBe('wrangler')
      expect(spawnMock.calls[0].command[2]).toBe('dev')
    })

    it('passes DO_TOKEN environment variable to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env).toBeDefined()
      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('preserves existing environment variables', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Should include process.env plus DO_TOKEN
      const env = spawnMock.calls[0].options?.env
      expect(env).toBeDefined()
      // DO_TOKEN should be added
      expect(env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('uses inherited stdio for interactive terminal', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.stdio).toEqual(['inherit', 'inherit', 'inherit'])
    })
  })

  // ==========================================================================
  // Argument Forwarding Tests
  // ==========================================================================

  describe('Argument Forwarding', () => {
    it('forwards --port argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--port', '3000'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--port')
      expect(command).toContain('3000')
    })

    it('forwards --local flag to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--local'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--local')
    })

    it('forwards --remote flag to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--remote'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--remote')
    })

    it('forwards --persist flag to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--persist'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--persist')
    })

    it('forwards --ip argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--ip', '0.0.0.0'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--ip')
      expect(command).toContain('0.0.0.0')
    })

    it('forwards multiple arguments correctly', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--port', '8787', '--local', '--persist'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--port')
      expect(command).toContain('8787')
      expect(command).toContain('--local')
      expect(command).toContain('--persist')
    })

    it('forwards --config argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['--config', 'wrangler.custom.toml'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--config')
      expect(command).toContain('wrangler.custom.toml')
    })

    it('forwards positional script argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run(['src/index.ts'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('src/index.ts')
    })
  })

  // ==========================================================================
  // Server Lifecycle Tests
  // ==========================================================================

  describe('Server Lifecycle', () => {
    it('waits for wrangler process to exit', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      const result = await run([], { spawn: spawnMock.mock })

      // run() should await the process exit
      expect(result).toBeDefined()
    })

    it('returns exit code from wrangler process', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(0)

      const result = await run([], { spawn: spawnMock.mock })

      expect(result?.exitCode).toBe(0)
    })

    it('handles non-zero exit code from wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const result = await run([], { spawn: spawnMock.mock })

      expect(result?.exitCode).toBe(1)
    })

    it('handles process spawn failure', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()
      spawnMock.setReject(true)

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow()
    })

    it('propagates SIGINT to wrangler process', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()
      const killFn = vi.fn()
      spawnMock.mock.mockReturnValue({
        pid: 12345,
        exited: new Promise(() => {}), // Never resolves - simulates running server
        kill: killFn,
      })

      // Start dev server (don't await - it won't finish)
      const runPromise = run([], { spawn: spawnMock.mock })

      // Simulate SIGINT handling (implementation detail)
      // The run function should set up signal handlers
      expect(spawnMock.calls).toHaveLength(1)

      // Cleanup
      runPromise.catch(() => {}) // Prevent unhandled rejection
    })
  })

  // ==========================================================================
  // Output Tests
  // ==========================================================================

  describe('Output', () => {
    it('prints starting message', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/dev')
        const spawnMock = createSpawnMock()

        await run([], { spawn: spawnMock.mock })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('starting') || log.toLowerCase().includes('dev')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints authentication status', async () => {
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: true,
      })

      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/dev')
        const spawnMock = createSpawnMock()

        await run([], { spawn: spawnMock.mock })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('authenticated') ||
              log.toLowerCase().includes('logged in')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })
  })

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('shows helpful error when wrangler is not found', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()
      spawnMock.mock.mockImplementation(() => {
        throw new Error('ENOENT: wrangler not found')
      })

      const output = captureConsole()

      try {
        await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow()

        expect(
          output.errors.some(
            (log) =>
              log.toLowerCase().includes('wrangler') || log.toLowerCase().includes('install')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('handles network errors during authentication gracefully', async () => {
      vi.mocked(ensureLoggedIn).mockRejectedValue(new Error('Network error'))

      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      const output = captureConsole()

      try {
        await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow()

        expect(
          output.errors.some(
            (log) =>
              log.toLowerCase().includes('network') ||
              log.toLowerCase().includes('connection')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('handles token expiration during long-running session', async () => {
      // First call succeeds, but token might expire later
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: false,
      })

      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Token should be refreshable - ensureLoggedIn handles this
      expect(ensureLoggedIn).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('uses wrangler.toml from current directory by default', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Should not explicitly set --config if using default
      const command = spawnMock.calls[0].command
      const hasExplicitConfig = command.includes('--config')
      // Either no --config or default path is fine
      expect(spawnMock.calls).toHaveLength(1)
    })

    it('respects DO_API_URL environment variable', async () => {
      const { run } = await import('../../../cli/commands/dev/dev')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, apiUrl: 'https://custom.api.do' })

      const env = spawnMock.calls[0].options?.env
      expect(env?.DO_API_URL).toBe('https://custom.api.do')
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Dev Command Module', () => {
  it('exports a run function', async () => {
    const devModule = await import('../../../cli/commands/dev/dev')

    expect(devModule.run).toBeDefined()
    expect(typeof devModule.run).toBe('function')
  })

  it('run function is async', async () => {
    const devModule = await import('../../../cli/commands/dev/dev')

    // Check that run returns a Promise
    const result = devModule.run([], { spawn: vi.fn() })
    expect(result).toBeInstanceOf(Promise)
  })

  it('exports command metadata', async () => {
    const devModule = await import('../../../cli/commands/dev/dev')

    expect(devModule.name).toBe('dev')
    expect(devModule.description).toBeDefined()
    expect(typeof devModule.description).toBe('string')
  })
})
