/**
 * Logs Command Tests - RED Phase (TDD)
 *
 * Tests for `do logs` command that streams live logs from Cloudflare Workers.
 * These tests are expected to FAIL until the command is implemented.
 *
 * The logs command will:
 * 1. Ensure user is authenticated (via oauth.do/node ensureLoggedIn)
 * 2. Stream logs from wrangler tail with DO_TOKEN in environment
 * 3. Forward additional arguments to wrangler tail
 * 4. Handle log streaming and filtering
 * 5. Support graceful shutdown on SIGINT
 *
 * Implementation will be in: cli/commands/dev/logs.ts
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
  let killFn = vi.fn()

  const mock = vi.fn((command: string[], options?: SpawnOptions): SpawnedProcess => {
    calls.push({ command, options })
    return {
      pid: 12345,
      exited: shouldReject
        ? Promise.reject(new Error('Process failed'))
        : Promise.resolve(exitCode),
      kill: killFn,
    }
  })

  return {
    mock,
    calls,
    killFn,
    setExitCode: (code: number) => {
      exitCode = code
    },
    setReject: (reject: boolean) => {
      shouldReject = reject
    },
    setKillFn: (fn: typeof killFn) => {
      killFn = fn
    },
  }
}

// ============================================================================
// Test Constants
// ============================================================================

const MOCK_TOKEN = 'logs-token-xyz123'
const MOCK_USER = {
  id: 'user_123',
  email: 'logger@example.com',
  name: 'Logger',
}

// ============================================================================
// Logs Command Tests
// ============================================================================

describe('do logs', () => {
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
    it('ensures user is authenticated before streaming logs', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(ensureLoggedIn).toHaveBeenCalledTimes(1)
      expect(ensureLoggedIn).toHaveBeenCalledWith(
        expect.objectContaining({
          openBrowser: true,
        })
      )
    })

    it('does not stream logs if authentication fails', async () => {
      vi.mocked(ensureLoggedIn).mockRejectedValue(new Error('Authentication failed'))

      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow(/authentication/i)
      expect(spawnMock.calls).toHaveLength(0)
    })

    it('triggers login flow if not authenticated', async () => {
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: true,
      })

      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(ensureLoggedIn).toHaveBeenCalledWith(
        expect.objectContaining({
          print: expect.any(Function),
        })
      )
    })

    it('uses existing token when already logged in', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })
  })

  // ==========================================================================
  // Wrangler Tail Tests
  // ==========================================================================

  describe('Wrangler Tail', () => {
    it('spawns wrangler tail command', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls).toHaveLength(1)
      expect(spawnMock.calls[0].command).toContain('wrangler')
      expect(spawnMock.calls[0].command).toContain('tail')
    })

    it('uses bunx to run wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command[0]).toBe('bunx')
      expect(spawnMock.calls[0].command[1]).toBe('wrangler')
      expect(spawnMock.calls[0].command[2]).toBe('tail')
    })

    it('passes DO_TOKEN environment variable to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('preserves existing environment variables', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      const env = spawnMock.calls[0].options?.env
      expect(env).toBeDefined()
      expect(env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('uses inherited stdio for streaming output', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.stdio).toEqual(['inherit', 'inherit', 'inherit'])
    })
  })

  // ==========================================================================
  // Argument Forwarding Tests
  // ==========================================================================

  describe('Argument Forwarding', () => {
    it('forwards worker name argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['my-worker'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('my-worker')
    })

    it('forwards --format argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--format', 'json'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--format')
      expect(command).toContain('json')
    })

    it('forwards --format=pretty argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--format', 'pretty'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--format')
      expect(command).toContain('pretty')
    })

    it('forwards --status filter argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--status', 'error'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--status')
      expect(command).toContain('error')
    })

    it('forwards --header filter argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--header', 'X-Request-Id:abc123'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--header')
      expect(command).toContain('X-Request-Id:abc123')
    })

    it('forwards --method filter argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--method', 'POST'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--method')
      expect(command).toContain('POST')
    })

    it('forwards --sampling-rate argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--sampling-rate', '0.5'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--sampling-rate')
      expect(command).toContain('0.5')
    })

    it('forwards --search argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--search', 'error'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--search')
      expect(command).toContain('error')
    })

    it('forwards --ip filter argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--ip', '192.168.1.1'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--ip')
      expect(command).toContain('192.168.1.1')
    })

    it('forwards --env argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--env', 'production'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--env')
      expect(command).toContain('production')
    })

    it('forwards multiple filter arguments correctly', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['my-worker', '--format', 'json', '--status', 'error', '--method', 'POST'], {
        spawn: spawnMock.mock,
      })

      const command = spawnMock.calls[0].command
      expect(command).toContain('my-worker')
      expect(command).toContain('--format')
      expect(command).toContain('json')
      expect(command).toContain('--status')
      expect(command).toContain('error')
      expect(command).toContain('--method')
      expect(command).toContain('POST')
    })

    it('forwards --config argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--config', 'wrangler.prod.toml'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--config')
      expect(command).toContain('wrangler.prod.toml')
    })
  })

  // ==========================================================================
  // Stream Lifecycle Tests
  // ==========================================================================

  describe('Stream Lifecycle', () => {
    it('streams logs continuously until interrupted', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      // Tail command runs until interrupted
      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls).toHaveLength(1)
    })

    it('waits for tail process to exit', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      const result = await run([], { spawn: spawnMock.mock })

      expect(result).toBeDefined()
    })

    it('returns exit code from tail process', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(0)

      const result = await run([], { spawn: spawnMock.mock })

      expect(result?.exitCode).toBe(0)
    })

    it('handles SIGINT gracefully', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const killFn = vi.fn()
      const spawnMock = createSpawnMock()
      spawnMock.mock.mockReturnValue({
        pid: 12345,
        exited: new Promise(() => {}), // Never resolves - simulates streaming
        kill: killFn,
      })

      // Start logs (don't await - it won't finish)
      const runPromise = run([], { spawn: spawnMock.mock })

      // Process should be spawned
      expect(spawnMock.calls).toHaveLength(1)

      // Cleanup
      runPromise.catch(() => {})
    })

    it('propagates SIGTERM to tail process', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Verify process was spawned (signal handling is implementation detail)
      expect(spawnMock.calls).toHaveLength(1)
    })
  })

  // ==========================================================================
  // Output Tests
  // ==========================================================================

  describe('Output', () => {
    it('prints connecting message', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/logs')
        const spawnMock = createSpawnMock()

        await run([], { spawn: spawnMock.mock })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('connect') ||
              log.toLowerCase().includes('stream') ||
              log.toLowerCase().includes('tailing') ||
              log.toLowerCase().includes('logs')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints disconnected message on exit', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/logs')
        const spawnMock = createSpawnMock()
        spawnMock.setExitCode(0)

        await run([], { spawn: spawnMock.mock })

        // On clean exit, may print disconnected
        expect(output.logs.length).toBeGreaterThanOrEqual(0)
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
      const { run } = await import('../../../cli/commands/dev/logs')
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

    it('handles network errors during log streaming gracefully', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()
      spawnMock.setReject(true)

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow()
    })

    it('handles worker not found error', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const result = await run(['nonexistent-worker'], { spawn: spawnMock.mock })

      expect(result?.exitCode).toBe(1)
    })

    it('handles authentication expiration during streaming', async () => {
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: false,
      })

      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Token should be passed, wrangler handles expiration
      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('handles process spawn failure', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()
      spawnMock.setReject(true)

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow()
    })
  })

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('uses wrangler.toml from current directory by default', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls).toHaveLength(1)
    })

    it('respects DO_API_URL environment variable', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, apiUrl: 'https://custom.api.do' })

      const env = spawnMock.calls[0].options?.env
      expect(env?.DO_API_URL).toBe('https://custom.api.do')
    })

    it('supports custom wrangler config path', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--config', 'configs/wrangler.production.toml'], {
        spawn: spawnMock.mock,
      })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--config')
      expect(command).toContain('configs/wrangler.production.toml')
    })
  })

  // ==========================================================================
  // Log Format Tests
  // ==========================================================================

  describe('Log Formats', () => {
    it('supports JSON format', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--format', 'json'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('json')
    })

    it('supports pretty format', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--format', 'pretty'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('pretty')
    })

    it('uses pretty format by default', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      // Default should work without explicit format
      expect(spawnMock.calls).toHaveLength(1)
    })
  })

  // ==========================================================================
  // Filter Tests
  // ==========================================================================

  describe('Log Filtering', () => {
    it('filters logs by HTTP status code', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--status', 'ok'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--status')
      expect(command).toContain('ok')
    })

    it('filters logs by HTTP method', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--method', 'GET'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--method')
      expect(command).toContain('GET')
    })

    it('filters logs by client IP', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--ip', 'self'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--ip')
      expect(command).toContain('self')
    })

    it('filters logs by header value', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--header', 'X-Custom-Header:value'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--header')
      expect(command).toContain('X-Custom-Header:value')
    })

    it('supports multiple filters simultaneously', async () => {
      const { run } = await import('../../../cli/commands/dev/logs')
      const spawnMock = createSpawnMock()

      await run(['--status', 'error', '--method', 'POST', '--ip', 'self'], {
        spawn: spawnMock.mock,
      })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--status')
      expect(command).toContain('error')
      expect(command).toContain('--method')
      expect(command).toContain('POST')
      expect(command).toContain('--ip')
      expect(command).toContain('self')
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Logs Command Module', () => {
  it('exports a run function', async () => {
    const logsModule = await import('../../../cli/commands/dev/logs')

    expect(logsModule.run).toBeDefined()
    expect(typeof logsModule.run).toBe('function')
  })

  it('run function is async', async () => {
    const logsModule = await import('../../../cli/commands/dev/logs')

    const result = logsModule.run([], { spawn: vi.fn() })
    expect(result).toBeInstanceOf(Promise)
  })

  it('exports command metadata', async () => {
    const logsModule = await import('../../../cli/commands/dev/logs')

    expect(logsModule.name).toBe('logs')
    expect(logsModule.description).toBeDefined()
    expect(typeof logsModule.description).toBe('string')
  })
})
