/**
 * Dev Command Tests
 *
 * Tests for `dotdo dev` command using dependency injection.
 * NO MOCKS - uses injected spawn function for testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { startDevServer, type SpawnFn } from '../commands/dev'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a fake spawn function that returns a controllable mock process.
 * This is NOT vi.mock - it's dependency injection with a test double.
 */
function createFakeSpawn() {
  const calls: Array<{ command: string; args: string[]; options?: object }> = []

  // Create a fake child process using EventEmitter
  const createFakeProcess = (): ChildProcess => {
    const proc = new EventEmitter() as ChildProcess & EventEmitter
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()

    // Assign required properties
    ;(proc as any).stdout = stdout
    ;(proc as any).stderr = stderr
    ;(proc as any).stdin = null
    ;(proc as any).stdio = [null, stdout, stderr]
    ;(proc as any).pid = 12345
    ;(proc as any).killed = false
    ;(proc as any).connected = false
    ;(proc as any).exitCode = null
    ;(proc as any).signalCode = null
    ;(proc as any).spawnargs = []
    ;(proc as any).spawnfile = ''
    ;(proc as any).kill = () => {
      ;(proc as any).killed = true
      return true
    }
    ;(proc as any).send = () => false
    ;(proc as any).disconnect = () => {}
    ;(proc as any).unref = () => {}
    ;(proc as any).ref = () => {}
    ;(proc as any)[Symbol.dispose] = () => {}

    return proc
  }

  let currentProcess: ChildProcess | null = null

  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options })
    currentProcess = createFakeProcess()
    return currentProcess
  }

  return {
    spawn,
    calls,
    getCurrentProcess: () => currentProcess,
    simulateOutput: (data: string) => {
      if (currentProcess?.stdout) {
        ;(currentProcess.stdout as EventEmitter).emit('data', Buffer.from(data))
      }
    },
    simulateError: (data: string) => {
      if (currentProcess?.stderr) {
        ;(currentProcess.stderr as EventEmitter).emit('data', Buffer.from(data))
      }
    },
    simulateClose: (code: number) => {
      if (currentProcess) {
        ;(currentProcess as EventEmitter).emit('close', code)
      }
    },
    simulateProcessError: (error: Error) => {
      if (currentProcess) {
        ;(currentProcess as EventEmitter).emit('error', error)
      }
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
// Tests
// ============================================================================

describe('dotdo dev command', () => {
  let fakeSpawn: ReturnType<typeof createFakeSpawn>
  let output: ReturnType<typeof captureConsole>

  beforeEach(() => {
    fakeSpawn = createFakeSpawn()
    output = captureConsole()
  })

  afterEach(() => {
    output.restore()
  })

  describe('Basic functionality', () => {
    it('should start wrangler dev server with injected spawn', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      expect(fakeSpawn.calls.length).toBe(1)
      expect(fakeSpawn.calls[0].command).toContain('wrangler')
      expect(fakeSpawn.calls[0].args).toContain('dev')
      expect(fakeSpawn.calls[0].options).toMatchObject({
        stdio: 'pipe',
      })

      server.stop()
    })

    it('should use default port 8787', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      // Wrangler uses 8787 by default, so --port should not be in args
      expect(fakeSpawn.calls[0].args).not.toContain('--port')
      expect(server.port).toBe(8787)

      server.stop()
    })

    it('should accept custom port via port option', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn, port: 3000 })

      expect(fakeSpawn.calls[0].args).toContain('--port')
      expect(fakeSpawn.calls[0].args).toContain('3000')
      expect(server.port).toBe(3000)

      server.stop()
    })

    it('should support --inspect flag for debugging', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn, inspect: true })

      expect(fakeSpawn.calls[0].args).toContain('--inspect')

      server.stop()
    })

    it('should pass through wrangler config file if specified', () => {
      const server = startDevServer({
        spawn: fakeSpawn.spawn,
        config: 'custom-wrangler.toml',
      })

      expect(fakeSpawn.calls[0].args).toContain('--config')
      expect(fakeSpawn.calls[0].args).toContain('custom-wrangler.toml')

      server.stop()
    })
  })

  describe('Environment handling', () => {
    it('should load .env file if present', () => {
      const server = startDevServer({
        spawn: fakeSpawn.spawn,
        env: '.env.local',
      })

      expect(fakeSpawn.calls[0].args).toContain('--env')
      expect(fakeSpawn.calls[0].args).toContain('.env.local')

      server.stop()
    })

    it('should inherit environment variables', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      expect(fakeSpawn.calls[0].options?.env).toMatchObject(
        expect.objectContaining({
          FORCE_COLOR: '1',
        })
      )

      server.stop()
    })
  })

  describe('Output handling', () => {
    it('should display startup banner', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      expect(output.logs.some((log) => log.includes('dotdo dev'))).toBe(true)

      server.stop()
    })

    it('should handle stdout data events', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn, verbose: true })

      // Simulate wrangler output
      fakeSpawn.simulateOutput('Ready on http://localhost:8787\n')

      server.stop()
    })

    it('should display request logs in dev mode', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      // Simulate a request log from wrangler
      fakeSpawn.simulateOutput('[wrangler] GET / 200 OK (5ms)\n')

      server.stop()
    })
  })

  describe('File watching and hot reload', () => {
    it('should enable hot reload by default', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      // Wrangler has hot reload enabled by default, so we shouldn't see --no-bundle
      expect(fakeSpawn.calls[0].args).not.toContain('--no-bundle')

      server.stop()
    })

    it('should support live reload flag', () => {
      const server = startDevServer({
        spawn: fakeSpawn.spawn,
        liveReload: true,
      })

      expect(fakeSpawn.calls[0].args).toContain('--live-reload')

      server.stop()
    })

    it('should watch for file changes', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      // Simulate file change notification
      fakeSpawn.simulateOutput('[wrangler] Detected changes, reloading...\n')

      server.stop()
    })
  })

  describe('Process management', () => {
    it('should cleanup process on stop', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })
      const proc = fakeSpawn.getCurrentProcess()

      server.stop()

      expect((proc as any).killed).toBe(true)
    })

    it('should handle process errors gracefully', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn })

      // Trigger error
      fakeSpawn.simulateProcessError(new Error('Process failed'))

      // Should have logged the error
      expect(output.errors.some((log) => log.includes('Failed to start dev server'))).toBe(true)

      server.stop()
    })

    it('should return process info', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn, port: 3000 })

      expect(server).toHaveProperty('port', 3000)
      expect(server).toHaveProperty('stop')
      expect(typeof server.stop).toBe('function')
      expect(server).toHaveProperty('process')

      server.stop()
    })
  })

  describe('Advanced features', () => {
    it('should support local protocol flag', () => {
      const server = startDevServer({
        spawn: fakeSpawn.spawn,
        localProtocol: 'https',
      })

      expect(fakeSpawn.calls[0].args).toContain('--local-protocol')
      expect(fakeSpawn.calls[0].args).toContain('https')

      server.stop()
    })

    it('should support persist state flag for DO', () => {
      const server = startDevServer({
        spawn: fakeSpawn.spawn,
        persist: true,
      })

      expect(fakeSpawn.calls[0].args).toContain('--persist')

      server.stop()
    })

    it('should display helpful info on startup', () => {
      const server = startDevServer({ spawn: fakeSpawn.spawn, port: 3000 })

      // Should show URL
      expect(output.logs.some((log) => log.includes('localhost:3000'))).toBe(true)

      server.stop()
    })
  })
})
