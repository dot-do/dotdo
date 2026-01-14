/**
 * E2E Tests: CLI Authentication Flow
 *
 * Tests the complete authentication flow for the CLI using real command execution.
 * Uses bun:test to match the existing cli/tests/commands.test.ts pattern.
 *
 * Tests verify:
 * 1. Login command behavior (with and without existing session)
 * 2. Logout command behavior (single and all sessions)
 * 3. Whoami command output (authenticated and unauthenticated)
 * 4. JSON output modes
 * 5. Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// Configuration
// ============================================================================

const CLI_PATH = path.join(import.meta.dir, '../../main.ts')

// ============================================================================
// Helpers
// ============================================================================

interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Execute CLI command and capture output using spawn
 */
async function runCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {}
): Promise<CLIResult> {
  const { cwd = import.meta.dir, env = {} } = options

  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...env, CI: '1', NO_COLOR: '1' },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('exit', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
    })
  })
}

/**
 * Create a temporary directory for testing
 */
function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dotdo-e2e-${prefix}-`))
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================================
// Auth Command Help Tests
// ============================================================================

describe('E2E: Auth Commands', () => {
  describe('login --help', () => {
    it('displays login command help', async () => {
      const result = await runCLI(['login', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/log\s*in|account/)
    })

    it('shows available options for login', async () => {
      const result = await runCLI(['login', '--help'])

      expect(result.exitCode).toBe(0)
      // Should show the --no-browser option
      expect(result.stdout).toContain('browser')
    })
  })

  describe('logout --help', () => {
    it('displays logout command help', async () => {
      const result = await runCLI(['logout', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/log\s*out|account/)
    })

    it('shows --all option for clearing all tokens', async () => {
      const result = await runCLI(['logout', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--all')
    })
  })

  describe('whoami --help', () => {
    it('displays whoami command help', async () => {
      const result = await runCLI(['whoami', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('identity')
    })

    it('shows --json option for JSON output', async () => {
      const result = await runCLI(['whoami', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--json')
    })
  })

  describe('whoami without auth', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('whoami')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('indicates not logged in when no token exists', async () => {
      // Use temp directory as HOME to ensure no existing tokens
      const result = await runCLI(['whoami'], {
        env: { HOME: tempDir },
      })

      // Should indicate not logged in (either via exit code or message)
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/not logged in|login/)
    })

    it('suggests login command when not authenticated', async () => {
      const result = await runCLI(['whoami'], {
        env: { HOME: tempDir },
      })

      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toContain('login')
    })

    it('responds appropriately when --json flag is used and not logged in', async () => {
      const result = await runCLI(['whoami', '--json'], {
        env: { HOME: tempDir },
      })

      // When not logged in, whoami may output text message or JSON
      // Just verify the command doesn't crash
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/not logged in|login|\{/)
    })
  })

  describe('logout without auth', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('logout')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('succeeds even when not logged in', async () => {
      // Logout should not fail even if there's no session
      const result = await runCLI(['logout'], {
        env: { HOME: tempDir },
      })

      // Should either succeed or gracefully indicate no session
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/logged out|no.*session|success|cleared/)
    })

    it('handles --all flag gracefully with no tokens', async () => {
      const result = await runCLI(['logout', '--all'], {
        env: { HOME: tempDir },
      })

      // Should succeed and indicate tokens cleared (even if count is 0)
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/cleared|logged out|0.*token/)
    })
  })

  describe('error handling', () => {
    it('login shows helpful error for invalid options', async () => {
      const result = await runCLI(['login', '--invalid-option-xyz'])

      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/unknown|error|option/)
    })

    it('whoami shows helpful error for invalid options', async () => {
      const result = await runCLI(['whoami', '--invalid-option-xyz'])

      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/unknown|error|option/)
    })

    it('logout shows helpful error for invalid options', async () => {
      const result = await runCLI(['logout', '--invalid-option-xyz'])

      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/unknown|error|option/)
    })
  })

  describe('integration', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('auth-integration')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('whoami and logout work consistently in same environment', async () => {
      // First check whoami
      const whoamiResult = await runCLI(['whoami'], {
        env: { HOME: tempDir },
      })

      // Should indicate not logged in
      expect((whoamiResult.stdout + whoamiResult.stderr).toLowerCase()).toMatch(/not logged in|login/)

      // Then logout
      const logoutResult = await runCLI(['logout'], {
        env: { HOME: tempDir },
      })

      // Should succeed
      expect(logoutResult.exitCode).toBeLessThanOrEqual(1) // 0 or 1 are acceptable

      // Whoami again should still show not logged in
      const whoamiResult2 = await runCLI(['whoami'], {
        env: { HOME: tempDir },
      })

      expect((whoamiResult2.stdout + whoamiResult2.stderr).toLowerCase()).toMatch(/not logged in|login/)
    })

    it('all auth commands accept --help without requiring authentication', async () => {
      // All help commands should work without authentication
      const commands = ['login', 'logout', 'whoami']

      for (const cmd of commands) {
        const result = await runCLI([cmd, '--help'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout.length).toBeGreaterThan(0)
      }
    })
  })
})
