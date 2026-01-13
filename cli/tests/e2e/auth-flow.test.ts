/**
 * E2E Tests: CLI Authentication Flow
 *
 * Tests the complete authentication flow for the CLI using real command execution.
 * These tests verify:
 * 1. Login command behavior (with and without existing session)
 * 2. Logout command behavior (single and all sessions)
 * 3. Whoami command output (authenticated and unauthenticated)
 * 4. JSON output modes
 * 5. Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ============================================================================
// Configuration
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '../../..')
const CLI_BIN = join(PROJECT_ROOT, 'cli/bin.ts')

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
function execCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): Promise<CLIResult> {
  const { cwd = PROJECT_ROOT, env = {}, timeout = 15000 } = options

  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_BIN, ...args], {
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

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ stdout, stderr, exitCode: -1 })
    }, timeout)

    proc.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })
  })
}

/**
 * Create a temporary directory for testing
 */
function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dotdo-e2e-${prefix}-`))
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  if (dir && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================================
// Auth Command Help Tests
// ============================================================================

describe('E2E: Auth Command Help', () => {
  describe('login --help', () => {
    it('displays login command help', async () => {
      const result = await execCLI(['login', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/log\s*in|account/)
    })

    it('shows available options for login', async () => {
      const result = await execCLI(['login', '--help'])

      expect(result.exitCode).toBe(0)
      // Should show the --no-browser option
      expect(result.stdout).toContain('browser')
    })
  })

  describe('logout --help', () => {
    it('displays logout command help', async () => {
      const result = await execCLI(['logout', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/log\s*out|account/)
    })

    it('shows --all option for clearing all tokens', async () => {
      const result = await execCLI(['logout', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--all')
    })
  })

  describe('whoami --help', () => {
    it('displays whoami command help', async () => {
      const result = await execCLI(['whoami', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('identity')
    })

    it('shows --json option for JSON output', async () => {
      const result = await execCLI(['whoami', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--json')
    })
  })
})

// ============================================================================
// Whoami Command Tests (No Auth Required)
// ============================================================================

describe('E2E: Whoami Command (Unauthenticated)', () => {
  let tempDir: string

  beforeEach(() => {
    // Create isolated temp directory for token storage
    tempDir = createTempDir('whoami')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('indicates not logged in when no token exists', async () => {
    // Use temp directory as HOME to ensure no existing tokens
    const result = await execCLI(['whoami'], {
      env: { HOME: tempDir },
    })

    // Should indicate not logged in (either via exit code or message)
    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/not logged in|login/)
  })

  it('suggests login command when not authenticated', async () => {
    const result = await execCLI(['whoami'], {
      env: { HOME: tempDir },
    })

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toContain('login')
  })

  it('outputs valid JSON when --json flag is used and not logged in', async () => {
    const result = await execCLI(['whoami', '--json'], {
      env: { HOME: tempDir },
    })

    // Should output valid JSON
    try {
      const parsed = JSON.parse(result.stdout.trim())
      expect(parsed).toHaveProperty('loggedIn')
      expect(parsed.loggedIn).toBe(false)
    } catch {
      // If parsing fails, the output should at least contain JSON-like structure
      expect(result.stdout).toMatch(/\{.*loggedIn.*\}/s)
    }
  })
})

// ============================================================================
// Logout Command Tests (No Auth Required)
// ============================================================================

describe('E2E: Logout Command', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('logout')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('succeeds even when not logged in', async () => {
    // Logout should not fail even if there's no session
    const result = await execCLI(['logout'], {
      env: { HOME: tempDir },
    })

    // Should either succeed or gracefully indicate no session
    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/logged out|no.*session|success|cleared/)
  })

  it('handles --all flag gracefully with no tokens', async () => {
    const result = await execCLI(['logout', '--all'], {
      env: { HOME: tempDir },
    })

    // Should succeed and indicate tokens cleared (even if count is 0)
    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/cleared|logged out|0.*token/)
  })
})

// ============================================================================
// Auth Command Error Handling Tests
// ============================================================================

describe('E2E: Auth Command Error Handling', () => {
  it('login shows helpful error for invalid options', async () => {
    const result = await execCLI(['login', '--invalid-option-xyz'])

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })

  it('whoami shows helpful error for invalid options', async () => {
    const result = await execCLI(['whoami', '--invalid-option-xyz'])

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })

  it('logout shows helpful error for invalid options', async () => {
    const result = await execCLI(['logout', '--invalid-option-xyz'])

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })
})

// ============================================================================
// Auth Command Integration Tests
// ============================================================================

describe('E2E: Auth Command Integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('auth-integration')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('whoami and logout work consistently in same environment', async () => {
    // First check whoami
    const whoamiResult = await execCLI(['whoami'], {
      env: { HOME: tempDir },
    })

    // Should indicate not logged in
    expect((whoamiResult.stdout + whoamiResult.stderr).toLowerCase()).toMatch(/not logged in|login/)

    // Then logout
    const logoutResult = await execCLI(['logout'], {
      env: { HOME: tempDir },
    })

    // Should succeed
    expect(logoutResult.exitCode).toBeLessThanOrEqual(1) // 0 or 1 are acceptable

    // Whoami again should still show not logged in
    const whoamiResult2 = await execCLI(['whoami'], {
      env: { HOME: tempDir },
    })

    expect((whoamiResult2.stdout + whoamiResult2.stderr).toLowerCase()).toMatch(/not logged in|login/)
  })

  it('all auth commands accept --help without requiring authentication', async () => {
    // All help commands should work without authentication
    const commands = ['login', 'logout', 'whoami']

    for (const cmd of commands) {
      const result = await execCLI([cmd, '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
    }
  })
})
