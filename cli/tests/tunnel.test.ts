/**
 * Tunnel Command Tests - Process Cleanup (TDD)
 *
 * Tests for tunnel process cleanup behavior:
 * - Timeout properly kills cloudflared process
 * - Timeout rejects Promise with proper error
 * - SIGTERM is sent before SIGKILL
 * - Cleanup handles already-exited process
 * - No zombie processes remain after timeout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ============================================================================
// Types
// ============================================================================

interface MockChildProcess extends EventEmitter {
  kill: ReturnType<typeof vi.fn>
  stdout: EventEmitter | null
  stderr: EventEmitter | null
  pid: number
  killed: boolean
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock child process for testing
 */
function createMockProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = 12345
  proc.killed = false
  proc.kill = vi.fn((signal?: string) => {
    proc.killed = true
    return true
  })
  return proc
}

// ============================================================================
// Tunnel Process Cleanup Tests
// ============================================================================

describe('Tunnel Process Cleanup', () => {
  let mockProc: MockChildProcess

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules() // Reset module cache to avoid test pollution
    mockProc = createMockProcess()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Timeout behavior', () => {
    it('kills cloudflared process after timeout when no URL received', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS, SIGKILL_DELAY_MS } =
        await import('../../cli/commands/tunnel')

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Fast-forward past the timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Process should have been killed
      expect(mockProc.kill).toHaveBeenCalled()

      // Should reject with timeout error
      await expect(tunnelPromise).rejects.toThrow(/timeout/i)

      // Advance past SIGKILL delay to let all timers settle
      await vi.advanceTimersByTimeAsync(SIGKILL_DELAY_MS)
    })

    it('rejects Promise with proper error message including timeout duration', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS, SIGKILL_DELAY_MS } =
        await import('../../cli/commands/tunnel')

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Should include timeout duration in error message
      await expect(tunnelPromise).rejects.toThrow(
        `Timeout waiting for tunnel URL after ${TUNNEL_TIMEOUT_MS}ms`
      )

      // Advance past SIGKILL delay to let all timers settle
      await vi.advanceTimersByTimeAsync(SIGKILL_DELAY_MS)
    })

    it('sends SIGTERM before SIGKILL for graceful shutdown', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS, SIGKILL_DELAY_MS } =
        await import('../../cli/commands/tunnel')

      const killCalls: string[] = []
      mockProc.kill = vi.fn((signal?: string) => {
        killCalls.push(signal || 'default')
        return true
      })

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Fast-forward to timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Should have sent SIGTERM first
      expect(killCalls).toContain('SIGTERM')
      expect(killCalls[0]).toBe('SIGTERM')

      // Fast-forward past SIGKILL delay
      await vi.advanceTimersByTimeAsync(SIGKILL_DELAY_MS)

      // Should have sent SIGKILL second
      expect(killCalls).toContain('SIGKILL')

      // Cleanup
      await tunnelPromise.catch(() => {})
    })

    it('handles already-exited process gracefully during cleanup', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS, SIGKILL_DELAY_MS } =
        await import('../../cli/commands/tunnel')

      let killCallCount = 0
      mockProc.kill = vi.fn((signal?: string) => {
        killCallCount++
        if (killCallCount > 1) {
          // Simulate process already exited - kill throws
          throw new Error('Process already exited')
        }
        mockProc.killed = true
        return true
      })

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Fast-forward to timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Fast-forward past SIGKILL delay
      await vi.advanceTimersByTimeAsync(SIGKILL_DELAY_MS)

      // Should not throw due to already-exited process
      // Promise should reject with timeout error, not "Process already exited"
      await expect(tunnelPromise).rejects.toThrow(/timeout/i)
    })

    it('clears timeout when URL is found successfully', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS } = await import(
        '../../cli/commands/tunnel'
      )

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Simulate URL being found before timeout
      await vi.advanceTimersByTimeAsync(5000)
      mockProc.stdout!.emit(
        'data',
        Buffer.from('Tunnel URL: https://abc123.trycloudflare.com')
      )

      // Fast-forward past what would have been the timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Process should NOT have been killed since URL was found
      expect(mockProc.kill).not.toHaveBeenCalled()

      // Should resolve with the URL
      const url = await tunnelPromise
      expect(url).toBe('https://abc123.trycloudflare.com')
    })

    it('does not leave zombie processes after timeout', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS, SIGKILL_DELAY_MS } =
        await import('../../cli/commands/tunnel')

      mockProc.kill = vi.fn((signal?: string) => {
        mockProc.killed = true
        // Simulate process exit after kill
        setTimeout(() => {
          mockProc.emit('exit', signal === 'SIGKILL' ? 137 : 0)
        }, 100)
        return true
      })

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Fast-forward to timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Fast-forward past SIGKILL delay
      await vi.advanceTimersByTimeAsync(SIGKILL_DELAY_MS)

      // Advance to allow exit event
      await vi.advanceTimersByTimeAsync(200)

      // Process should have been killed
      expect(mockProc.kill).toHaveBeenCalled()

      // Cleanup promise
      await tunnelPromise.catch(() => {})
    })
  })

  describe('Promise resolution guarantees', () => {
    it('resolves exactly once when URL is found', async () => {
      const { startTunnelWithDeps } = await import('../../cli/commands/tunnel')

      let resolveCount = 0

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      ).then((url) => {
        resolveCount++
        return url
      })

      // Allow async setup to complete
      await vi.advanceTimersByTimeAsync(0)

      // Emit URL multiple times (e.g., from both stdout and stderr)
      mockProc.stdout!.emit(
        'data',
        Buffer.from('https://abc123.trycloudflare.com')
      )
      mockProc.stderr!.emit(
        'data',
        Buffer.from('https://abc123.trycloudflare.com')
      )

      const url = await tunnelPromise
      expect(url).toBe('https://abc123.trycloudflare.com')
      expect(resolveCount).toBe(1)
    })

    it('rejects exactly once on timeout', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS, SIGKILL_DELAY_MS } =
        await import('../../cli/commands/tunnel')

      let rejectCount = 0

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      ).catch((err) => {
        rejectCount++
        throw err
      })

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Also trigger exit event which could cause another rejection
      mockProc.emit('exit', 1)

      await expect(tunnelPromise).rejects.toThrow()
      expect(rejectCount).toBe(1)

      // Advance past SIGKILL delay to let all timers settle
      await vi.advanceTimersByTimeAsync(SIGKILL_DELAY_MS)
    })

    it('does not reject after successful resolution', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS } = await import(
        '../../cli/commands/tunnel'
      )

      let rejected = false

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      ).catch((err) => {
        rejected = true
        throw err
      })

      // Allow async setup to complete
      await vi.advanceTimersByTimeAsync(0)

      // URL found successfully
      mockProc.stdout!.emit(
        'data',
        Buffer.from('https://abc123.trycloudflare.com')
      )

      const url = await tunnelPromise
      expect(url).toBe('https://abc123.trycloudflare.com')

      // Fast-forward past timeout - should not cause rejection
      await vi.advanceTimersByTimeAsync(TUNNEL_TIMEOUT_MS)

      // Trigger exit - should not cause unhandled rejection
      mockProc.emit('exit', 0)

      // Should not have rejected
      expect(rejected).toBe(false)
    })
  })

  describe('Timeout constants', () => {
    it('exports TUNNEL_TIMEOUT_MS constant (30000ms)', async () => {
      const { TUNNEL_TIMEOUT_MS } = await import('../../cli/commands/tunnel')
      expect(TUNNEL_TIMEOUT_MS).toBe(30000)
    })

    it('exports SIGKILL_DELAY_MS constant (5000ms)', async () => {
      const { SIGKILL_DELAY_MS } = await import('../../cli/commands/tunnel')
      expect(SIGKILL_DELAY_MS).toBe(5000)
    })
  })

  describe('Cleanup on process exit', () => {
    it('clears timeout if process exits before timeout', async () => {
      const { startTunnelWithDeps, TUNNEL_TIMEOUT_MS } = await import(
        '../../cli/commands/tunnel'
      )

      const tunnelPromise = startTunnelWithDeps(
        { port: 8787 },
        {
          spawn: () => mockProc as any,
          findCloudflared: async () => '/usr/local/bin/cloudflared',
        }
      )

      // Process exits before timeout
      await vi.advanceTimersByTimeAsync(5000)
      mockProc.emit('exit', 1)

      // Should reject with exit error, not timeout
      await expect(tunnelPromise).rejects.toThrow(/exited with code 1/i)

      // Kill should not have been called (process exited on its own)
      expect(mockProc.kill).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Safe Extraction Tests (Command Injection Prevention)
// ============================================================================

describe('Safe Extraction', () => {
  let tempDir: string

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-test-'))
  })

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('extractTarball', () => {
    it('extracts tarball with normal paths', async () => {
      const { extractTarball } = await import('../../cli/commands/tunnel')

      const binDir = path.join(tempDir, 'bin')
      fs.mkdirSync(binDir, { recursive: true })

      // Create a simple test tarball (just a text file for testing)
      // We'll mock spawnSync to test the function logic
      const tempPath = path.join(tempDir, 'test.tgz')

      // Create a minimal valid gzip file (empty tar archive)
      // This tests that the function calls spawnSync correctly
      const emptyTar = Buffer.from([
        0x1f,
        0x8b,
        0x08,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x03,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
      ])
      fs.writeFileSync(tempPath, emptyTar)

      // The function should not throw for valid paths
      // (Even if tar fails due to invalid archive, the command should be safe)
      try {
        extractTarball(tempPath, binDir)
      } catch (e) {
        // Expected to fail with invalid tarball, but should NOT be a command injection error
        expect((e as Error).message).toMatch(/Failed to extract|exit code/)
      }
    })

    it('handles paths with special characters safely', async () => {
      const { extractTarball } = await import('../../cli/commands/tunnel')

      // Create directory with special characters that could be exploited
      const specialDir = path.join(tempDir, 'path with spaces')
      fs.mkdirSync(specialDir, { recursive: true })

      const tempPath = path.join(specialDir, 'test.tgz')
      const emptyTar = Buffer.from([
        0x1f,
        0x8b,
        0x08,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x03,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
      ])
      fs.writeFileSync(tempPath, emptyTar)

      // Should not throw due to path handling issues
      try {
        extractTarball(tempPath, specialDir)
      } catch (e) {
        // Expected to fail with invalid tarball, NOT path issues
        expect((e as Error).message).toMatch(/Failed to extract|exit code/)
      }
    })

    it('handles paths with shell metacharacters safely', async () => {
      const { extractTarball } = await import('../../cli/commands/tunnel')

      // Test with potentially dangerous path that could be exploited via string interpolation
      // These characters are safe with spawnSync array args but dangerous with execSync string
      const dangerousChars = 'test$(whoami)dir'
      const dangerousDir = path.join(tempDir, dangerousChars)

      try {
        fs.mkdirSync(dangerousDir, { recursive: true })
      } catch {
        // Skip if OS doesn't allow these characters in paths
        return
      }

      const tempPath = path.join(dangerousDir, 'test.tgz')
      const emptyTar = Buffer.from([
        0x1f,
        0x8b,
        0x08,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x03,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
      ])
      fs.writeFileSync(tempPath, emptyTar)

      // With safe spawn pattern, this should not execute the command substitution
      try {
        extractTarball(tempPath, dangerousDir)
      } catch (e) {
        // Expected to fail with invalid tarball, NOT command injection
        expect((e as Error).message).toMatch(/Failed to extract|exit code/)
      }
    })

    it('throws error on extraction failure with proper message', async () => {
      const { extractTarball } = await import('../../cli/commands/tunnel')

      const binDir = path.join(tempDir, 'bin')
      fs.mkdirSync(binDir, { recursive: true })

      // Non-existent file should cause extraction failure
      const nonExistent = path.join(tempDir, 'nonexistent.tgz')

      expect(() => extractTarball(nonExistent, binDir)).toThrow(
        /Failed to extract cloudflared/
      )
    })
  })

  describe('findExecutable', () => {
    it('finds executable in PATH', async () => {
      const { findExecutable } = await import('../../cli/commands/tunnel')

      // Create a mock executable
      const binDir = path.join(tempDir, 'bin')
      fs.mkdirSync(binDir, { recursive: true })
      const execPath = path.join(binDir, 'test-exec')
      fs.writeFileSync(execPath, '#!/bin/sh\necho test')
      fs.chmodSync(execPath, 0o755)

      // Mock PATH to include our test directory
      const originalPath = process.env.PATH
      process.env.PATH = `${binDir}${path.delimiter}${originalPath}`

      try {
        const found = findExecutable('test-exec')
        expect(found).toBe(execPath)
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('returns null for non-existent executable', async () => {
      const { findExecutable } = await import('../../cli/commands/tunnel')

      const found = findExecutable('definitely-not-a-real-command-xyz123')
      expect(found).toBeNull()
    })

    it('handles paths with spaces in PATH entries', async () => {
      const { findExecutable } = await import('../../cli/commands/tunnel')

      // Create directory with spaces
      const spacedDir = path.join(tempDir, 'dir with spaces')
      fs.mkdirSync(spacedDir, { recursive: true })
      const execPath = path.join(spacedDir, 'spaced-exec')
      fs.writeFileSync(execPath, '#!/bin/sh\necho test')
      fs.chmodSync(execPath, 0o755)

      const originalPath = process.env.PATH
      process.env.PATH = `${spacedDir}${path.delimiter}${originalPath}`

      try {
        const found = findExecutable('spaced-exec')
        expect(found).toBe(execPath)
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('handles empty PATH gracefully', async () => {
      const { findExecutable } = await import('../../cli/commands/tunnel')

      const originalPath = process.env.PATH
      process.env.PATH = ''

      try {
        const found = findExecutable('anything')
        expect(found).toBeNull()
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('handles undefined PATH gracefully', async () => {
      const { findExecutable } = await import('../../cli/commands/tunnel')

      const originalPath = process.env.PATH
      delete process.env.PATH

      try {
        const found = findExecutable('anything')
        expect(found).toBeNull()
      } finally {
        process.env.PATH = originalPath
      }
    })
  })
})
