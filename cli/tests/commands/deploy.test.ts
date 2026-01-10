/**
 * Deploy Command Tests - RED Phase (TDD)
 *
 * Tests for `do deploy` command that deploys to Cloudflare Workers.
 * These tests are expected to FAIL until the command is implemented.
 *
 * The deploy command will:
 * 1. Ensure user is authenticated (via oauth.do/node ensureLoggedIn)
 * 2. Run wrangler deploy with DO_TOKEN in environment
 * 3. Forward additional arguments to wrangler
 * 4. Handle deployment success/failure
 * 5. Display deployment URL on success
 *
 * Implementation will be in: cli/commands/dev/deploy.ts
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
  let stdoutOutput = ''

  const mock = vi.fn((command: string[], options?: SpawnOptions): SpawnedProcess => {
    calls.push({ command, options })
    return {
      pid: 12345,
      exited: shouldReject
        ? Promise.reject(new Error('Process failed'))
        : Promise.resolve(exitCode),
      kill: vi.fn(),
      stdout: new ReadableStream({
        start(controller) {
          if (stdoutOutput) {
            controller.enqueue(new TextEncoder().encode(stdoutOutput))
          }
          controller.close()
        },
      }),
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
    setStdout: (output: string) => {
      stdoutOutput = output
    },
  }
}

// ============================================================================
// Test Constants
// ============================================================================

const MOCK_TOKEN = 'deploy-token-xyz123'
const MOCK_USER = {
  id: 'user_123',
  email: 'deployer@example.com',
  name: 'Deployer',
}
const MOCK_WORKER_URL = 'https://my-worker.workers.dev'

// ============================================================================
// Deploy Command Tests
// ============================================================================

describe('do deploy', () => {
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
    it('ensures user is authenticated before deploying', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(ensureLoggedIn).toHaveBeenCalledTimes(1)
      expect(ensureLoggedIn).toHaveBeenCalledWith(
        expect.objectContaining({
          openBrowser: true,
        })
      )
    })

    it('does not deploy if authentication fails', async () => {
      vi.mocked(ensureLoggedIn).mockRejectedValue(new Error('Authentication failed'))

      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow(/authentication/i)
      expect(spawnMock.calls).toHaveLength(0)
    })

    it('triggers login flow if not authenticated', async () => {
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: MOCK_TOKEN,
        isNewLogin: true,
      })

      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(ensureLoggedIn).toHaveBeenCalledWith(
        expect.objectContaining({
          print: expect.any(Function),
        })
      )
    })

    it('uses existing token when already logged in', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })
  })

  // ==========================================================================
  // Wrangler Deploy Tests
  // ==========================================================================

  describe('Wrangler Deploy', () => {
    it('spawns wrangler deploy command', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls).toHaveLength(1)
      expect(spawnMock.calls[0].command).toContain('wrangler')
      expect(spawnMock.calls[0].command).toContain('deploy')
    })

    it('uses bunx to run wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command[0]).toBe('bunx')
      expect(spawnMock.calls[0].command[1]).toBe('wrangler')
      expect(spawnMock.calls[0].command[2]).toBe('deploy')
    })

    it('passes DO_TOKEN environment variable to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('preserves existing environment variables', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      const env = spawnMock.calls[0].options?.env
      expect(env).toBeDefined()
      expect(env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('uses inherited stdio', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.stdio).toEqual(['inherit', 'inherit', 'inherit'])
    })
  })

  // ==========================================================================
  // Argument Forwarding Tests
  // ==========================================================================

  describe('Argument Forwarding', () => {
    it('forwards --name argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--name', 'my-worker'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--name')
      expect(command).toContain('my-worker')
    })

    it('forwards --env argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--env', 'production'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--env')
      expect(command).toContain('production')
    })

    it('forwards --compatibility-date argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--compatibility-date', '2024-01-01'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--compatibility-date')
      expect(command).toContain('2024-01-01')
    })

    it('forwards --minify flag to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--minify'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--minify')
    })

    it('forwards --dry-run flag to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--dry-run'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--dry-run')
    })

    it('forwards --config argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--config', 'wrangler.prod.toml'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--config')
      expect(command).toContain('wrangler.prod.toml')
    })

    it('forwards multiple arguments correctly', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--env', 'staging', '--minify', '--name', 'staging-worker'], {
        spawn: spawnMock.mock,
      })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--env')
      expect(command).toContain('staging')
      expect(command).toContain('--minify')
      expect(command).toContain('--name')
      expect(command).toContain('staging-worker')
    })

    it('forwards positional script argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['src/worker.ts'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('src/worker.ts')
    })

    it('forwards --outdir argument to wrangler', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--outdir', 'dist'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      expect(command).toContain('--outdir')
      expect(command).toContain('dist')
    })
  })

  // ==========================================================================
  // Deployment Result Tests
  // ==========================================================================

  describe('Deployment Result', () => {
    it('returns success on exit code 0', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(0)

      const result = await run([], { spawn: spawnMock.mock })

      expect(result?.success).toBe(true)
      expect(result?.exitCode).toBe(0)
    })

    it('returns failure on non-zero exit code', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const result = await run([], { spawn: spawnMock.mock })

      expect(result?.success).toBe(false)
      expect(result?.exitCode).toBe(1)
    })

    it('handles spawn failure', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setReject(true)

      await expect(run([], { spawn: spawnMock.mock })).rejects.toThrow()
    })

    it('waits for deployment to complete', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      const result = await run([], { spawn: spawnMock.mock })

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // Output Tests
  // ==========================================================================

  describe('Output', () => {
    it('prints deploying message', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/deploy')
        const spawnMock = createSpawnMock()

        await run([], { spawn: spawnMock.mock })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('deploy') || log.toLowerCase().includes('deploying')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints success message on successful deployment', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/deploy')
        const spawnMock = createSpawnMock()
        spawnMock.setExitCode(0)

        await run([], { spawn: spawnMock.mock })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('success') ||
              log.toLowerCase().includes('deployed') ||
              log.toLowerCase().includes('complete')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints error message on failed deployment', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../../cli/commands/dev/deploy')
        const spawnMock = createSpawnMock()
        spawnMock.setExitCode(1)

        await run([], { spawn: spawnMock.mock })

        expect(
          output.errors.some(
            (log) =>
              log.toLowerCase().includes('fail') || log.toLowerCase().includes('error')
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
      const { run } = await import('../../../cli/commands/dev/deploy')
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

    it('handles network errors during deployment gracefully', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const output = captureConsole()

      try {
        await run([], { spawn: spawnMock.mock })

        // Deploy command should handle errors gracefully
        expect(spawnMock.calls).toHaveLength(1)
      } finally {
        output.restore()
      }
    })

    it('handles missing wrangler.toml', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const output = captureConsole()

      try {
        await run([], { spawn: spawnMock.mock })

        // Wrangler will handle the error, we just need to forward it
        expect(spawnMock.calls).toHaveLength(1)
      } finally {
        output.restore()
      }
    })

    it('handles invalid configuration', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      await run(['--config', 'nonexistent.toml'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('nonexistent.toml')
    })
  })

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('uses wrangler.toml from current directory by default', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls).toHaveLength(1)
    })

    it('respects DO_API_URL environment variable', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, apiUrl: 'https://custom.api.do' })

      const env = spawnMock.calls[0].options?.env
      expect(env?.DO_API_URL).toBe('https://custom.api.do')
    })

    it('supports custom wrangler config path', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
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
  // Rollback Tests
  // ==========================================================================

  describe('Rollback Support', () => {
    it('supports --rollback flag', async () => {
      const { run } = await import('../../../cli/commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await run(['--rollback', 'abc123'], { spawn: spawnMock.mock })

      const command = spawnMock.calls[0].command
      // Wrangler uses 'deployments rollback' subcommand
      // but we may alias --rollback to that
      expect(command.join(' ')).toMatch(/rollback|abc123/)
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Deploy Command Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set up mock for ensureLoggedIn so tests don't fail with unhandled rejection
    vi.mocked(ensureLoggedIn).mockResolvedValue({
      token: MOCK_TOKEN,
      isNewLogin: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports a run function', async () => {
    const deployModule = await import('../../../cli/commands/dev/deploy')

    expect(deployModule.run).toBeDefined()
    expect(typeof deployModule.run).toBe('function')
  })

  it('run function is async', async () => {
    const deployModule = await import('../../../cli/commands/dev/deploy')

    const result = deployModule.run([], { spawn: vi.fn() })
    expect(result).toBeInstanceOf(Promise)
    // Await to prevent unhandled rejection
    await result.catch(() => {})
  })

  it('exports command metadata', async () => {
    const deployModule = await import('../../../cli/commands/dev/deploy')

    expect(deployModule.name).toBe('deploy')
    expect(deployModule.description).toBeDefined()
    expect(typeof deployModule.description).toBe('string')
  })
})
