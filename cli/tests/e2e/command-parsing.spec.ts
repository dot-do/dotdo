/**
 * E2E Tests: CLI Command Parsing
 *
 * Tests that the CLI correctly parses commands, arguments, and options
 * from the command line using real execution.
 *
 * These tests:
 * 1. Verify command routing works correctly
 * 2. Test argument parsing for all major commands
 * 3. Test option flags (short and long forms)
 * 4. Test help and version output
 * 5. Test error handling for invalid commands
 */

import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import {
  createTempDir,
  cleanupTempDir,
  runCommand,
  CLI_BIN,
  PROJECT_ROOT,
} from '../../../tests/e2e/cli/utils/server'
import { execSync } from 'node:child_process'

/**
 * Helper to run CLI directly and capture output
 */
function execCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): { stdout: string; stderr: string; exitCode: number } {
  const { cwd = PROJECT_ROOT, env = {}, timeout = 10000 } = options

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

test.describe('CLI Command Parsing', () => {
  test.describe('Help and Version', () => {
    test('should display help with --help flag', () => {
      const result = execCLI(['--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage')
      expect(result.stdout).toContain('dotdo')
    })

    test('should display help with -h flag', () => {
      const result = execCLI(['-h'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage')
    })

    test('should display version with --version flag', () => {
      const result = execCLI(['--version'])

      expect(result.exitCode).toBe(0)
      // Version should be a semver-like string
      expect(result.stdout.trim()).toMatch(/\d+\.\d+\.\d+/)
    })

    test('should display version with -v flag', () => {
      const result = execCLI(['-v'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/\d+\.\d+\.\d+/)
    })

    test('should display command-specific help', () => {
      const result = execCLI(['init', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('init')
      expect(result.stdout.toLowerCase()).toContain('project')
    })
  })

  test.describe('Command Routing', () => {
    test('should recognize init command', () => {
      const result = execCLI(['init', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('initialize')
    })

    test('should recognize dev command', () => {
      const result = execCLI(['dev', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('development')
    })

    test('should recognize deploy command', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('deploy')
    })

    test('should recognize start command', () => {
      const result = execCLI(['start', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('start')
    })

    test('should recognize login command', () => {
      const result = execCLI(['login', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/login|log in/)
    })

    test('should recognize logout command', () => {
      const result = execCLI(['logout', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/logout|log out/)
    })

    test('should recognize whoami command', () => {
      const result = execCLI(['whoami', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('identity')
    })

    test('should recognize config command', () => {
      const result = execCLI(['config', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('config')
    })

    test('should recognize logs command', () => {
      const result = execCLI(['logs', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('logs')
    })

    test('should recognize build command', () => {
      const result = execCLI(['build', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('build')
    })
  })

  test.describe('Init Command Options', () => {
    let tempDir: string

    test.beforeEach(() => {
      tempDir = createTempDir(`cmd-parse-${Date.now()}`)
    })

    test.afterEach(() => {
      cleanupTempDir(tempDir)
    })

    test('should accept project name argument', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['my-project'],
      })

      expect(result.exitCode).toBe(0)
      const fs = require('fs')
      expect(fs.existsSync(join(tempDir, 'my-project'))).toBe(true)
    })

    test('should accept --template option', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['template-project', '--template', 'minimal'],
      })

      expect(result.exitCode).toBe(0)
    })

    test('should accept -t shorthand for template', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['shorthand-project', '-t', 'api'],
      })

      expect(result.exitCode).toBe(0)
    })

    test('should list templates with --list-templates', () => {
      const result = execCLI(['init', '--list-templates'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('template')
      expect(result.stdout.toLowerCase()).toContain('default')
    })

    test('should accept --git flag', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['git-project', '--git'],
      })

      expect(result.exitCode).toBe(0)
    })

    test('should accept --no-git flag', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['no-git-project', '--no-git'],
      })

      expect(result.exitCode).toBe(0)
    })

    test('should accept --pm option for package manager', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['pm-project', '--pm', 'pnpm'],
      })

      expect(result.exitCode).toBe(0)
    })

    test('should accept --force flag', () => {
      // Create directory first
      const fs = require('fs')
      fs.mkdirSync(join(tempDir, 'force-project'))

      const result = runCommand('init', {
        cwd: tempDir,
        args: ['force-project', '--force'],
      })

      expect(result.exitCode).toBe(0)
    })
  })

  test.describe('Deploy Command Options', () => {
    test('should accept --target option', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.stdout).toContain('--target')
      expect(result.stdout).toContain('cloudflare')
    })

    test('should accept --dry-run flag', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.stdout).toContain('--dry-run')
    })

    test('should accept --all flag', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.stdout).toContain('--all')
    })

    test('should accept --name option for app name', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.stdout).toContain('--name')
    })

    test('should accept -n shorthand for name', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.stdout).toMatch(/-n[,\s]/)
    })

    test('should accept --env option', () => {
      const result = execCLI(['deploy', '--help'])

      expect(result.stdout).toContain('--env')
    })
  })

  test.describe('Dev/Start Command Options', () => {
    test('should accept --port option', () => {
      const result = execCLI(['dev', '--help'])

      expect(result.stdout).toContain('--port')
    })

    test('should accept -p shorthand for port', () => {
      const result = execCLI(['dev', '--help'])

      expect(result.stdout).toMatch(/-p[,\s]/)
    })

    test('should accept --host option', () => {
      const result = execCLI(['dev', '--help'])

      expect(result.stdout).toContain('--host')
    })
  })

  test.describe('Error Handling', () => {
    test('should show error for unknown command', () => {
      const result = execCLI(['unknowncommand123'])

      // Should either fail or show help
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/unknown|error|not found|invalid|usage/)
    })

    test('should show error for invalid option', () => {
      const result = execCLI(['init', '--invalid-option-xyz'])

      // Commander should report unknown option
      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/unknown|error|option/)
    })
  })

  test.describe('Global Options', () => {
    test('should accept --debug flag', () => {
      const result = execCLI(['--debug', '--help'])

      expect(result.exitCode).toBe(0)
    })

    test('should accept --json flag where supported', () => {
      const result = execCLI(['whoami', '--help'])

      expect(result.stdout).toContain('--json')
    })
  })

  test.describe('Service Commands', () => {
    test('should recognize call command', () => {
      const result = execCLI(['call', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('call')
    })

    test('should recognize text command', () => {
      const result = execCLI(['text', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('text')
    })

    test('should recognize email command', () => {
      const result = execCLI(['email', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('email')
    })

    test('should recognize llm command', () => {
      const result = execCLI(['llm', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('llm')
    })
  })
})
