/**
 * Deploy Command Tests - do-7rf.9.5
 *
 * Tests for `dotdo deploy` command that deploys to Cloudflare Workers.
 * These tests verify:
 * 1. Authentication flow
 * 2. Build before deploy
 * 3. Deployment execution
 * 4. Environment selection (staging, production)
 * 5. Secret management
 * 6. Rollback support
 * 7. Integration with workers.do API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run, name, description } from '../commands/deploy'

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
      stderr: new ReadableStream({
        start(controller) {
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

// ============================================================================
// Deploy Command Tests
// ============================================================================

describe('dotdo deploy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set DO_TOKEN for tests
    process.env.DO_TOKEN = MOCK_TOKEN
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.DO_TOKEN
  })

  // ==========================================================================
  // Module Exports
  // ==========================================================================

  describe('Module Exports', () => {
    it('exports name', () => {
      expect(name).toBe('deploy')
    })

    it('exports description', () => {
      expect(description).toBeDefined()
      expect(typeof description).toBe('string')
      expect(description.length).toBeGreaterThan(0)
    })

    it('exports run function', () => {
      expect(run).toBeDefined()
      expect(typeof run).toBe('function')
    })

    it('run function is async', () => {
      const spawnMock = createSpawnMock()
      const result = run([], { spawn: spawnMock.mock, skipAuth: true })
      expect(result).toBeInstanceOf(Promise)
      return result
    })
  })

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('Authentication', () => {
    it('uses DO_TOKEN from environment when skipAuth is true', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(spawnMock.calls[1].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('uses mock token when DO_TOKEN not set and skipAuth is true', async () => {
      delete process.env.DO_TOKEN
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(spawnMock.calls[1].options?.env?.DO_TOKEN).toBeDefined()
    })
  })

  // ==========================================================================
  // Build Tests
  // ==========================================================================

  describe('Build Before Deploy', () => {
    it('builds project before deployment by default', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      // First call should be build (wrangler deploy --dry-run)
      expect(spawnMock.calls[0].command).toContain('wrangler')
      expect(spawnMock.calls[0].command).toContain('deploy')
      expect(spawnMock.calls[0].command).toContain('--dry-run')
    })

    it('skips build when --dry-run flag is present', async () => {
      const spawnMock = createSpawnMock()

      await run(['--dry-run'], { spawn: spawnMock.mock, skipAuth: true })

      // Should only have one call (no separate build step)
      expect(spawnMock.calls.length).toBe(1)
      expect(spawnMock.calls[0].command).toContain('--dry-run')
    })

    it('skips build when skipBuild option is true', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true, skipBuild: true })

      // Should only have one call (deploy, no build)
      expect(spawnMock.calls.length).toBe(1)
    })

    it('fails deployment if build fails', async () => {
      const spawnMock = createSpawnMock()
      // First call (build) fails
      let callCount = 0
      spawnMock.mock.mockImplementation((command: string[], options?: SpawnOptions) => {
        const exitCode = callCount === 0 ? 1 : 0
        callCount++
        spawnMock.calls.push({ command, options })

        return {
          pid: 12345,
          exited: Promise.resolve(exitCode),
          kill: vi.fn(),
          stdout: new ReadableStream({ start(c) { c.close() } }),
          stderr: new ReadableStream({ start(c) { c.close() } }),
        }
      })

      const result = await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
      // Should only have build call, not deployment call
      expect(spawnMock.calls.length).toBe(1)
    })
  })

  // ==========================================================================
  // Wrangler Deploy Tests
  // ==========================================================================

  describe('Wrangler Deploy', () => {
    it('spawns wrangler deploy command', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      // Second call should be actual deploy
      expect(spawnMock.calls[1].command).toContain('wrangler')
      expect(spawnMock.calls[1].command).toContain('deploy')
    })

    it('uses bunx to run wrangler', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(spawnMock.calls[1].command[0]).toBe('bunx')
      expect(spawnMock.calls[1].command[1]).toBe('wrangler')
    })

    it('passes DO_TOKEN environment variable to wrangler', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(spawnMock.calls[1].options?.env?.DO_TOKEN).toBe(MOCK_TOKEN)
    })

    it('uses inherited stdio', async () => {
      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(spawnMock.calls[1].options?.stdio).toEqual(['inherit', 'inherit', 'inherit'])
    })
  })

  // ==========================================================================
  // Argument Forwarding Tests
  // ==========================================================================

  describe('Argument Forwarding', () => {
    it('forwards --name argument to wrangler', async () => {
      const spawnMock = createSpawnMock()

      await run(['--name', 'my-worker'], { spawn: spawnMock.mock, skipAuth: true })

      const command = spawnMock.calls[1].command
      expect(command).toContain('--name')
      expect(command).toContain('my-worker')
    })

    it('forwards --env argument to wrangler', async () => {
      const spawnMock = createSpawnMock()

      await run(['--env', 'production'], { spawn: spawnMock.mock, skipAuth: true })

      const command = spawnMock.calls[1].command
      expect(command).toContain('--env')
      expect(command).toContain('production')
    })

    it('forwards --minify flag to wrangler', async () => {
      const spawnMock = createSpawnMock()

      await run(['--minify'], { spawn: spawnMock.mock, skipAuth: true })

      expect(spawnMock.calls[1].command).toContain('--minify')
    })

    it('forwards --config argument to wrangler', async () => {
      const spawnMock = createSpawnMock()

      await run(['--config', 'wrangler.prod.toml'], {
        spawn: spawnMock.mock,
        skipAuth: true,
      })

      const command = spawnMock.calls[1].command
      expect(command).toContain('--config')
      expect(command).toContain('wrangler.prod.toml')
    })

    it('forwards multiple arguments correctly', async () => {
      const spawnMock = createSpawnMock()

      await run(['--env', 'staging', '--minify', '--name', 'staging-worker'], {
        spawn: spawnMock.mock,
        skipAuth: true,
      })

      const command = spawnMock.calls[1].command
      expect(command).toContain('--env')
      expect(command).toContain('staging')
      expect(command).toContain('--minify')
      expect(command).toContain('--name')
      expect(command).toContain('staging-worker')
    })
  })

  // ==========================================================================
  // Deployment Result Tests
  // ==========================================================================

  describe('Deployment Result', () => {
    it('returns success on exit code 0', async () => {
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(0)

      const result = await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
    })

    it('returns failure on non-zero exit code', async () => {
      const spawnMock = createSpawnMock()
      // Build succeeds (first call), deploy fails (second call)
      let callCount = 0
      spawnMock.mock.mockImplementation((command: string[], options?: SpawnOptions) => {
        const exitCode = callCount === 0 ? 0 : 1
        callCount++
        spawnMock.calls.push({ command, options })

        return {
          pid: 12345,
          exited: Promise.resolve(exitCode),
          kill: vi.fn(),
          stdout: new ReadableStream({ start(c) { c.close() } }),
          stderr: new ReadableStream({ start(c) { c.close() } }),
        }
      })

      const result = await run([], { spawn: spawnMock.mock, skipAuth: true })

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
    })

    it('handles spawn failure', async () => {
      const spawnMock = createSpawnMock()
      spawnMock.setReject(true)

      await expect(run([], { spawn: spawnMock.mock, skipAuth: true })).rejects.toThrow()
    })
  })

  // ==========================================================================
  // Output Tests
  // ==========================================================================

  describe('Output', () => {
    it('prints deploying message', async () => {
      const output = captureConsole()

      try {
        const spawnMock = createSpawnMock()

        await run([], { spawn: spawnMock.mock, skipAuth: true })

        expect(
          output.logs.some((log) => log.toLowerCase().includes('deploy'))
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints success message on successful deployment', async () => {
      const output = captureConsole()

      try {
        const spawnMock = createSpawnMock()
        spawnMock.setExitCode(0)

        await run([], { spawn: spawnMock.mock, skipAuth: true })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('success') ||
              log.toLowerCase().includes('completed')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints error message on failed deployment', async () => {
      const output = captureConsole()

      try {
        const spawnMock = createSpawnMock()
        // Build succeeds, deploy fails
        let callCount = 0
        spawnMock.mock.mockImplementation((command: string[], options?: SpawnOptions) => {
          const exitCode = callCount === 0 ? 0 : 1
          callCount++
          spawnMock.calls.push({ command, options })

          return {
            pid: 12345,
            exited: Promise.resolve(exitCode),
            kill: vi.fn(),
            stdout: new ReadableStream({ start(c) { c.close() } }),
            stderr: new ReadableStream({ start(c) { c.close() } }),
          }
        })

        await run([], { spawn: spawnMock.mock, skipAuth: true })

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
  // Environment Variable Tests
  // ==========================================================================

  describe('Environment Variables', () => {
    it('sets DO_API_URL when apiUrl option provided', async () => {
      const spawnMock = createSpawnMock()

      await run([], {
        spawn: spawnMock.mock,
        skipAuth: true,
        apiUrl: 'https://custom.api.do',
      })

      const env = spawnMock.calls[1].options?.env
      expect(env?.DO_API_URL).toBe('https://custom.api.do')
    })

    it('preserves existing environment variables', async () => {
      const customEnvVar = 'CUSTOM_VAR'
      const customValue = 'custom-value'
      process.env[customEnvVar] = customValue

      const spawnMock = createSpawnMock()

      await run([], { spawn: spawnMock.mock, skipAuth: true })

      const env = spawnMock.calls[1].options?.env
      expect(env?.[customEnvVar]).toBe(customValue)

      delete process.env[customEnvVar]
    })
  })

  // ==========================================================================
  // Rollback Tests
  // ==========================================================================

  describe('Rollback Support', () => {
    it('handles --rollback flag with version', async () => {
      const spawnMock = createSpawnMock()

      await run(['--rollback', 'abc123'], { spawn: spawnMock.mock, skipAuth: true })

      // Should call wrangler deployments rollback
      expect(spawnMock.calls[0].command).toContain('wrangler')
      expect(spawnMock.calls[0].command).toContain('deployments')
      expect(spawnMock.calls[0].command).toContain('rollback')
      expect(spawnMock.calls[0].command).toContain('abc123')
    })

    it('skips build when rolling back', async () => {
      const spawnMock = createSpawnMock()

      await run(['--rollback', 'abc123'], { spawn: spawnMock.mock, skipAuth: true })

      // Should only have one call (rollback, no build or deploy)
      expect(spawnMock.calls.length).toBe(1)
    })

    it('returns error when rollback version not specified', async () => {
      const spawnMock = createSpawnMock()
      const output = captureConsole()

      try {
        const result = await run(['--rollback'], {
          spawn: spawnMock.mock,
          skipAuth: true,
        })

        expect(result.success).toBe(false)
        expect(output.errors.some((log) => log.includes('version'))).toBe(true)
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
      const spawnMock = createSpawnMock()
      spawnMock.mock.mockImplementation(() => {
        throw new Error('ENOENT: wrangler not found')
      })

      const output = captureConsole()

      try {
        await expect(run([], { spawn: spawnMock.mock, skipAuth: true })).rejects.toThrow()

        expect(
          output.errors.some((log) => log.includes('wrangler'))
        ).toBe(true)
      } finally {
        output.restore()
      }
    })
  })
})
