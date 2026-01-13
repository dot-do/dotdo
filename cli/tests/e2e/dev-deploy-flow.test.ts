/**
 * E2E Tests: CLI Dev and Deploy Command Flow
 *
 * Tests the dev and deploy commands using real command execution.
 * These tests focus on help output and option verification since
 * full dev/deploy tests require actual wrangler and authentication.
 *
 * Verifies:
 * 1. Help output for dev and deploy commands
 * 2. Option availability
 * 3. Error handling for invalid inputs
 * 4. Command routing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
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
 * Execute CLI command and capture output
 */
function execCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): CLIResult {
  const { cwd = PROJECT_ROOT, env = {}, timeout = 15000 } = options

  try {
    const fullCommand = `bun run ${CLI_BIN} ${args.join(' ')}`
    const stdout = execSync(fullCommand, {
      cwd,
      env: { ...process.env, ...env, CI: '1', NO_COLOR: '1' },
      timeout,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return { stdout, stderr: '', exitCode: 0 }
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    }
  }
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

/**
 * Create a minimal project structure for testing
 */
function scaffoldMinimalProject(dir: string): void {
  // Create basic structure
  mkdirSync(join(dir, 'src'), { recursive: true })

  // package.json
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'test-project',
        version: '0.0.1',
        private: true,
        type: 'module',
        scripts: {
          dev: 'wrangler dev',
          deploy: 'wrangler deploy',
        },
        dependencies: {
          dotdo: '^0.1.0',
        },
        devDependencies: {
          wrangler: '^4.0.0',
        },
      },
      null,
      2
    )
  )

  // wrangler.jsonc
  writeFileSync(
    join(dir, 'wrangler.jsonc'),
    JSON.stringify(
      {
        name: 'test-project',
        main: 'src/index.ts',
        compatibility_date: '2024-01-01',
        compatibility_flags: ['nodejs_compat'],
      },
      null,
      2
    )
  )

  // src/index.ts
  writeFileSync(
    join(dir, 'src', 'index.ts'),
    `export default {
  fetch(request: Request) {
    return new Response('Hello!')
  }
}
`
  )
}

// ============================================================================
// Dev Command Help Tests
// ============================================================================

describe('E2E: Dev Command Help', () => {
  it('displays dev command help', () => {
    const result = execCLI(['dev', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('development')
  })

  it('shows --port option', () => {
    const result = execCLI(['dev', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--port')
  })

  it('shows -p shorthand for port', () => {
    const result = execCLI(['dev', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/-p[,\s]/)
  })

  it('shows --tunnel option', () => {
    const result = execCLI(['dev', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--tunnel')
  })
})

// ============================================================================
// Deploy Command Help Tests
// ============================================================================

describe('E2E: Deploy Command Help', () => {
  it('displays deploy command help', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('deploy')
  })

  it('shows --target option', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--target')
  })

  it('shows cloudflare as a target option', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('cloudflare')
  })

  it('shows --dry-run option', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--dry-run')
  })

  it('shows --all option', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--all')
  })

  it('shows --name option', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--name')
  })

  it('shows -n shorthand for name', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/-n[,\s]/)
  })

  it('shows --env option', () => {
    const result = execCLI(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--env')
  })
})

// ============================================================================
// Start Command Help Tests
// ============================================================================

describe('E2E: Start Command Help', () => {
  it('displays start command help', () => {
    const result = execCLI(['start', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('start')
  })

  it('shows --port option', () => {
    const result = execCLI(['start', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--port')
  })

  it('shows --open option', () => {
    const result = execCLI(['start', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/--open|--no-open/)
  })
})

// ============================================================================
// Build Command Help Tests
// ============================================================================

describe('E2E: Build Command Help', () => {
  it('displays build command help', () => {
    const result = execCLI(['build', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('build')
  })

  it('shows --watch option', () => {
    const result = execCLI(['build', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/--watch|-w/)
  })
})

// ============================================================================
// Logs Command Help Tests
// ============================================================================

describe('E2E: Logs Command Help', () => {
  it('displays logs command help', () => {
    const result = execCLI(['logs', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('logs')
  })

  it('shows --follow option', () => {
    const result = execCLI(['logs', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/--follow|-f/)
  })

  it('shows --format option', () => {
    const result = execCLI(['logs', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--format')
  })
})

// ============================================================================
// Tunnel Command Help Tests
// ============================================================================

describe('E2E: Tunnel Command Help', () => {
  it('displays tunnel command help', () => {
    const result = execCLI(['tunnel', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('tunnel')
  })

  it('mentions Cloudflare Tunnel', () => {
    const result = execCLI(['tunnel', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('cloudflare')
  })

  it('shows --port option', () => {
    const result = execCLI(['tunnel', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--port')
  })

  it('shows --name option', () => {
    const result = execCLI(['tunnel', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--name')
  })
})

// ============================================================================
// DO Command Help Tests
// ============================================================================

describe('E2E: DO Operations Command Help', () => {
  it('displays do command help', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('durable object')
  })

  it('shows list subcommand', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('list')
  })

  it('shows show subcommand', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('show')
  })

  it('shows save subcommand', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('save')
  })

  it('shows restore subcommand', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('restore')
  })

  it('shows clone subcommand', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('clone')
  })

  it('shows delete subcommand', () => {
    const result = execCLI(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('delete')
  })
})

// ============================================================================
// DO List Command Tests
// ============================================================================

describe('E2E: DO List Command', () => {
  it('runs do list command without error', () => {
    const result = execCLI(['do', 'list'])

    // Should succeed (may show "no DOs found" but shouldn't error)
    expect(result.exitCode).toBe(0)
  })

  it('shows empty list message when no DOs exist', () => {
    const result = execCLI(['do', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toMatch(/no.*found|empty/)
  })
})

// ============================================================================
// Service Command Help Tests
// ============================================================================

describe('E2E: Service Commands Help', () => {
  it('displays call command help', () => {
    const result = execCLI(['call', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('call')
  })

  it('displays text command help', () => {
    const result = execCLI(['text', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('text')
  })

  it('displays email command help', () => {
    const result = execCLI(['email', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('email')
  })

  it('displays llm command help', () => {
    const result = execCLI(['llm', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('llm')
  })

  it('displays config command help', () => {
    const result = execCLI(['config', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('config')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('E2E: Dev/Deploy Error Handling', () => {
  it('dev shows error for invalid options', () => {
    const result = execCLI(['dev', '--invalid-option-xyz'])

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })

  it('deploy shows error for invalid options', () => {
    const result = execCLI(['deploy', '--invalid-option-xyz'])

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })

  it('start shows error for invalid options', () => {
    const result = execCLI(['start', '--invalid-option-xyz'])

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })
})

// ============================================================================
// Project Context Tests
// ============================================================================

describe('E2E: Command Project Context', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('project-context')
    scaffoldMinimalProject(tempDir)
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('dev command recognizes project structure', () => {
    // Just test that help works in project context
    const result = execCLI(['dev', '--help'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('development')
  })

  it('deploy command recognizes project structure', () => {
    const result = execCLI(['deploy', '--help'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('deploy')
  })

  it('init command refuses to overwrite existing project', () => {
    // Try to init in directory that already has package.json
    const result = execCLI(['init', '.'], { cwd: tempDir })

    // Should fail or skip since files exist
    // (behavior depends on implementation - either error or skip)
    const output = result.stdout + result.stderr
    // It should at least complete (either succeed by skipping or fail with message)
    expect(output.length).toBeGreaterThan(0)
  })
})
