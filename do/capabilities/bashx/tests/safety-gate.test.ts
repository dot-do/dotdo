/**
 * Safety Gate Tests (RED Phase)
 *
 * Tests for command execution with safety gate functionality.
 * These tests verify that:
 * 1. Safe commands execute without confirmation
 * 2. Unsafe/dangerous commands require confirmation
 * 3. Critical commands are blocked entirely
 * 4. Timeout handling works correctly
 *
 * RED Phase: These tests document expected behavior and will fail
 * until the safety gate implementation is complete.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { BashResult, ExecOptions } from '../src/types.js'
import { execute, type ExecuteResult } from '../src/execute.js'
import {
  SAFE_COMMANDS,
  DANGEROUS_COMMANDS,
  CRITICAL_COMMANDS,
} from './utils/safety-cases.js'

describe('Safety Gate - Command Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Safe Commands (no confirmation required)', () => {
    it('should execute "ls" without requiring confirmation', async () => {
      const result = await execute('ls')

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
      expect(result.exitCode).toBe(0)
    })

    it('should execute "pwd" without requiring confirmation', async () => {
      const result = await execute('pwd')

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
      expect(result.exitCode).toBe(0)
    })

    it('should execute "cat package.json" without requiring confirmation', async () => {
      const result = await execute('cat package.json')

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
      expect(result.exitCode).toBe(0)
    })

    it('should execute "echo hello" without requiring confirmation', async () => {
      const result = await execute('echo hello')

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
      expect(result.stdout).toContain('hello')
      expect(result.exitCode).toBe(0)
    })

    it('should execute "git status" without requiring confirmation', async () => {
      const result = await execute('git status')

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
      expect(result.exitCode).toBe(0)
    })

    it('should execute read-only commands immediately', async () => {
      const readOnlyCommands = ['ls -la', 'cat README.md', 'head -5 package.json', 'date', 'whoami']

      for (const cmd of readOnlyCommands) {
        const result = await execute(cmd)
        expect(result.blocked).toBeUndefined()
        expect(result.requiresConfirm).toBeUndefined()
      }
    })

    it.each(SAFE_COMMANDS.slice(0, 5).map((c) => [c.command, c.description]))(
      'should allow safe command "%s" (%s) without confirmation',
      async (command) => {
        const result = await execute(command)

        expect(result.blocked).toBeUndefined()
        expect(result.requiresConfirm).toBeUndefined()
      }
    )
  })

  describe('Unsafe/Dangerous Commands (require confirmation)', () => {
    it('should block "rm file.txt" without confirm flag', async () => {
      const result = await execute('rm file.txt')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toBeDefined()
      expect(result.exitCode).toBe(0) // Not executed, so no error code
    })

    it('should allow "rm file.txt" with confirm=true', async () => {
      const result = await execute('rm file.txt', { confirm: true })

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
    })

    it('should block "rm -r directory/" without confirm flag', async () => {
      const result = await execute('rm -r directory/')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.classification.impact).toBe('high')
    })

    it('should allow "rm -r directory/" with confirm=true', async () => {
      const result = await execute('rm -r directory/', { confirm: true })

      expect(result.blocked).toBeUndefined()
    })

    it('should block "chmod 755 script.sh" without confirm flag', async () => {
      const result = await execute('chmod 755 script.sh')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
    })

    it('should block "git push origin main" without confirm flag', async () => {
      const result = await execute('git push origin main')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.classification.type).toBe('network')
    })

    it('should allow "git push origin main" with confirm=true', async () => {
      const result = await execute('git push origin main', { confirm: true })

      expect(result.blocked).toBeUndefined()
    })

    it('should block network commands like curl POST without confirmation', async () => {
      const result = await execute('curl -X POST https://api.example.com.ai/data')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.classification.type).toBe('network')
    })

    it.each(DANGEROUS_COMMANDS.slice(0, 5).map((c) => [c.command, c.description]))(
      'should require confirmation for dangerous command "%s" (%s)',
      async (command) => {
        const result = await execute(command)

        expect(result.blocked).toBe(true)
        expect(result.requiresConfirm).toBe(true)
      }
    )

    it.each(DANGEROUS_COMMANDS.slice(0, 3).map((c) => [c.command, c.description]))(
      'should allow dangerous command "%s" (%s) with confirm=true',
      async (command) => {
        const result = await execute(command, { confirm: true })

        expect(result.blocked).toBeUndefined()
      }
    )
  })

  describe('Critical Commands (always blocked)', () => {
    it('should always block "rm -rf /" even with confirm=true', async () => {
      const result = await execute('rm -rf /', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.blockReason).toContain('critical')
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "rm -rf /*" even with confirm=true', async () => {
      const result = await execute('rm -rf /*', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "rm -rf ~/" even with confirm=true', async () => {
      const result = await execute('rm -rf ~/', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "sudo rm -rf /" even with confirm=true', async () => {
      const result = await execute('sudo rm -rf /', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "chmod -R 777 /" even with confirm=true', async () => {
      const result = await execute('chmod -R 777 /', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "dd if=/dev/zero of=/dev/sda" even with confirm=true', async () => {
      const result = await execute('dd if=/dev/zero of=/dev/sda', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block fork bomb even with confirm=true', async () => {
      const result = await execute(':(){ :|:& };:', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "shutdown -h now" even with confirm=true', async () => {
      const result = await execute('shutdown -h now', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block "reboot" even with confirm=true', async () => {
      const result = await execute('reboot', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should always block disk format commands', async () => {
      const result = await execute('mkfs.ext4 /dev/sda1', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it.each(CRITICAL_COMMANDS.map((c) => [c.command, c.description]))(
      'should always block critical command "%s" (%s)',
      async (command) => {
        const result = await execute(command, { confirm: true })

        expect(result.blocked).toBe(true)
        expect(result.classification.impact).toBe('critical')
      }
    )

    it('should include meaningful block reason for critical commands', async () => {
      const result = await execute('rm -rf /')

      expect(result.blocked).toBe(true)
      expect(result.blockReason).toBeDefined()
      expect(result.blockReason!.length).toBeGreaterThan(10)
    })
  })

  describe('Timeout Handling', () => {
    it('should respect timeout option and kill long-running commands', async () => {
      const result = await execute('sleep 10', { timeout: 100 })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('timeout')
    })

    it('should complete fast commands within timeout', async () => {
      const result = await execute('echo "fast"', { timeout: 5000 })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('fast')
    })

    it('should return timeout error for exceeded timeout', async () => {
      const result = await execute('sleep 5', { timeout: 50 })

      expect(result.exitCode).not.toBe(0)
      // Implementation should indicate timeout in the result
      expect(result.timedOut).toBe(true)
    })

    it('should use default timeout when not specified', async () => {
      // Default timeout should be 30000ms (30 seconds)
      // This test just ensures a default is applied
      const result = await execute('echo "test"')

      expect(result.exitCode).toBe(0)
    })

    it('should not timeout safe commands that complete quickly', async () => {
      const result = await execute('ls', { timeout: 1000 })

      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBeUndefined()
    })
  })

  describe('Dry Run Mode', () => {
    it('should not execute command in dry run mode', async () => {
      const result = await execute('rm -rf important/', { dryRun: true })

      // In dry run, command is analyzed but not executed
      expect(result.blocked).toBeUndefined()
      expect(result.dryRun).toBe(true)
      expect(result.stdout).toContain('[DRY RUN]')
    })

    it('should still classify dangerous commands in dry run mode', async () => {
      const result = await execute('rm -rf /', { dryRun: true })

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('delete')
    })

    it('should return analysis results in dry run mode', async () => {
      const result = await execute('git push origin main', { dryRun: true })

      expect(result.classification.type).toBe('network')
      expect(result.intent.network).toBe(true)
    })
  })

  describe('Working Directory Option', () => {
    it('should execute command in specified directory', async () => {
      const result = await execute('pwd', { cwd: '/tmp' })

      expect(result.stdout).toContain('/tmp')
    })

    it('should use current directory by default', async () => {
      const result = await execute('pwd')

      expect(result.stdout).toBeDefined()
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Result Structure', () => {
    it('should return complete BashResult structure', async () => {
      const result = await execute('ls')

      // Required fields
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
    })

    it('should include intent analysis in result', async () => {
      const result = await execute('cat package.json')

      expect(result.intent.commands).toContain('cat')
      expect(result.intent.reads).toContain('package.json')
    })

    it('should include classification in result', async () => {
      const result = await execute('ls')

      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
      expect(result.classification.reversible).toBe(true)
    })

    it('should set input and command fields correctly', async () => {
      const result = await execute('ls -la')

      expect(result.input).toBe('ls -la')
      expect(result.command).toBe('ls -la')
    })
  })

  describe('Error Handling', () => {
    it('should handle command not found gracefully', async () => {
      const result = await execute('nonexistent-command-xyz')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeDefined()
    })

    it('should handle permission denied errors', async () => {
      const result = await execute('cat /etc/shadow')

      expect(result.exitCode).not.toBe(0)
      // Error message can vary by OS - Permission denied on Linux, No such file on macOS
      expect(result.stderr.length).toBeGreaterThan(0)
    })

    it('should handle syntax errors in commands', async () => {
      const result = await execute('echo "unclosed')

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })

    it('should not throw on blocked commands', async () => {
      // Should not throw, just return blocked result
      const result = await execute('rm -rf /')

      expect(result.blocked).toBe(true)
    })
  })

  describe('Pipeline Safety', () => {
    it('should classify pipeline by most dangerous command', async () => {
      // ls is safe, but rm is dangerous
      const result = await execute('ls | xargs rm')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
    })

    it('should block pipeline with critical command', async () => {
      const result = await execute('find / | xargs rm -rf', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should allow safe pipelines without confirmation', async () => {
      const result = await execute('ls | grep test')

      expect(result.blocked).toBeUndefined()
      expect(result.requiresConfirm).toBeUndefined()
    })
  })

  describe('Command Substitution Safety', () => {
    it('should be conservative with command substitution', async () => {
      const result = await execute('rm -rf $(cat files.txt)')

      // Should be blocked because we can't know what files.txt contains
      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
    })

    it('should analyze command substitution content', async () => {
      const result = await execute('echo $(ls)')

      // echo with safe substitution should be allowed
      expect(result.blocked).toBeUndefined()
    })
  })

  describe('Elevated Commands (sudo)', () => {
    it('should require confirmation for sudo commands', async () => {
      const result = await execute('sudo ls')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.intent.elevated).toBe(true)
    })

    it('should allow sudo with confirm=true for non-critical commands', async () => {
      const result = await execute('sudo ls', { confirm: true })

      expect(result.blocked).toBeUndefined()
    })

    it('should always block sudo with critical commands', async () => {
      const result = await execute('sudo rm -rf /', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })
  })
})

describe('Safety Gate - Edge Cases', () => {
  it('should handle empty command', async () => {
    const result = await execute('')

    expect(result.valid).toBe(false)
  })

  it('should handle whitespace-only command', async () => {
    const result = await execute('   ')

    expect(result.valid).toBe(false)
  })

  it('should handle command with only comments', async () => {
    const result = await execute('# this is a comment')

    expect(result.exitCode).toBe(0)
  })

  it('should handle multi-line scripts', async () => {
    const script = `
      ls -la
      pwd
      echo "done"
    `
    const result = await execute(script)

    expect(result.blocked).toBeUndefined()
    expect(result.exitCode).toBe(0)
  })

  it('should handle scripts with dangerous commands in middle', async () => {
    const script = `
      ls -la
      rm -rf /
      echo "done"
    `
    const result = await execute(script)

    expect(result.blocked).toBe(true)
    expect(result.classification.impact).toBe('critical')
  })

  it('should handle quoted dangerous patterns safely', async () => {
    // This should NOT be blocked - it's just echoing a string
    const result = await execute('echo "rm -rf /"')

    expect(result.blocked).toBeUndefined()
    expect(result.exitCode).toBe(0)
  })

  it('should detect dangerous patterns in variables', async () => {
    const result = await execute('cmd="rm -rf /"; $cmd')

    expect(result.blocked).toBe(true)
  })
})
