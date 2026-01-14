/**
 * Command Execution Tests
 *
 * Tests for command execution with mock backend.
 * Verifies execution flow, safety gates, dry-run mode, and result handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { BashResult, BashOptions } from '../src/types.js'
import {
  MockExecutor,
  createMockExecutor,
  registerMock,
  registerMockError,
  clearMocks,
  createBlockedResult,
  createSuccessResult,
  createErrorResult,
} from './utils/mock-executor.js'
import {
  SAFE_COMMANDS,
  DANGEROUS_COMMANDS,
  CRITICAL_COMMANDS,
} from './utils/safety-cases.js'

describe('Mock Executor', () => {
  let executor: MockExecutor

  beforeEach(() => {
    clearMocks()
    executor = createMockExecutor()
  })

  afterEach(() => {
    clearMocks()
  })

  describe('Basic Execution', () => {
    it('should execute registered mock commands', async () => {
      const result = await executor.execute('ls')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
      expect(result.stderr).toBe('')
    })

    it('should execute ls -la mock', async () => {
      const result = await executor.execute('ls -la')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('drwxr-xr-x')
    })

    it('should execute pwd mock', async () => {
      const result = await executor.execute('pwd')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/home/user/project')
    })

    it('should execute cat mock', async () => {
      const result = await executor.execute('cat package.json')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test-package')
    })

    it('should execute echo mock', async () => {
      const result = await executor.execute('echo "hello world"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hello world')
    })

    it('should execute git status mock', async () => {
      const result = await executor.execute('git status')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('On branch main')
    })

    it('should return error for non-mocked commands', async () => {
      const result = await executor.execute('unmocked-command')
      expect(result.exitCode).toBe(127)
      expect(result.stderr).toContain('Command not mocked')
    })
  })

  describe('Custom Mock Registration', () => {
    it('should allow registering custom mocks', async () => {
      registerMock('custom-command', {
        stdout: 'custom output',
        stderr: '',
        exitCode: 0,
      })

      const result = await executor.execute('custom-command')
      expect(result.stdout).toBe('custom output')
      expect(result.exitCode).toBe(0)
    })

    it('should allow registering error mocks', async () => {
      registerMockError('failing-command', 'Command failed')

      await expect(executor.execute('failing-command')).rejects.toThrow(
        'Command failed'
      )
    })

    it('should override existing mocks', async () => {
      registerMock('ls', {
        stdout: 'overridden output',
        stderr: '',
        exitCode: 0,
      })

      const result = await executor.execute('ls')
      expect(result.stdout).toBe('overridden output')
    })
  })

  describe('Execution Log', () => {
    it('should track executed commands', async () => {
      await executor.execute('ls')
      await executor.execute('pwd')

      const log = executor.getExecutionLog()
      expect(log).toHaveLength(2)
      expect(log[0].command).toBe('ls')
      expect(log[1].command).toBe('pwd')
    })

    it('should track execution timestamps', async () => {
      const before = new Date()
      await executor.execute('ls')
      const after = new Date()

      const log = executor.getExecutionLog()
      expect(log[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(log[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should track options in log', async () => {
      await executor.execute('ls', { dryRun: true })

      const log = executor.getExecutionLog()
      expect(log[0].options?.dryRun).toBe(true)
    })

    it('should check if command was executed', async () => {
      await executor.execute('ls')

      expect(executor.wasExecuted('ls')).toBe(true)
      expect(executor.wasExecuted('pwd')).toBe(false)
    })

    it('should count executions', async () => {
      await executor.execute('ls')
      await executor.execute('ls')
      await executor.execute('pwd')

      expect(executor.getExecutionCount('ls')).toBe(2)
      expect(executor.getExecutionCount('pwd')).toBe(1)
      expect(executor.getExecutionCount('nonexistent')).toBe(0)
    })

    it('should clear execution log', async () => {
      await executor.execute('ls')
      executor.clearLog()

      expect(executor.getExecutionLog()).toHaveLength(0)
    })
  })

  describe('Dry Run Mode', () => {
    it('should return dry run result without executing', async () => {
      const result = await executor.execute('dangerous-command', { dryRun: true })

      expect(result.stdout).toContain('[DRY RUN]')
      expect(result.stdout).toContain('dangerous-command')
      expect(result.exitCode).toBe(0)
    })

    it('should still log dry run executions', async () => {
      await executor.execute('ls', { dryRun: true })

      expect(executor.wasExecuted('ls')).toBe(true)
      const log = executor.getExecutionLog()
      expect(log[0].options?.dryRun).toBe(true)
    })

    it('should not throw on error mocks in dry run', async () => {
      registerMockError('failing-command', 'This would fail')

      const result = await executor.execute('failing-command', { dryRun: true })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[DRY RUN]')
    })
  })

  describe('Error Handling', () => {
    it('should handle cat on nonexistent file', async () => {
      await expect(executor.execute('cat nonexistent.txt')).rejects.toThrow(
        'No such file or directory'
      )
    })

    it('should handle rm -rf / mock error', async () => {
      await expect(executor.execute('rm -rf /')).rejects.toThrow(
        'refusing to remove root directory'
      )
    })
  })

  describe('Result Structure', () => {
    it('should return complete BashResult structure', async () => {
      const result = await executor.execute('ls')

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

    it('should set correct input', async () => {
      const result = await executor.execute('ls -la')
      expect(result.input).toBe('ls -la')
      expect(result.command).toBe('ls -la')
    })

    it('should set valid to true for successful execution', async () => {
      const result = await executor.execute('ls')
      expect(result.valid).toBe(true)
    })

    it('should set generated to false for direct commands', async () => {
      const result = await executor.execute('ls')
      expect(result.generated).toBe(false)
    })

    it('should include basic intent extraction', async () => {
      const result = await executor.execute('ls')
      expect(result.intent.commands).toContain('ls')
    })

    it('should include basic classification', async () => {
      const result = await executor.execute('ls')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })
  })
})

describe('Result Factory Functions', () => {
  describe('createBlockedResult', () => {
    it('should create a blocked result', () => {
      const result = createBlockedResult('rm -rf /', 'Cannot delete root')

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toBe('Cannot delete root')
      expect(result.command).toBe('rm -rf /')
    })

    it('should set critical classification', () => {
      const result = createBlockedResult('rm -rf /', 'Dangerous')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.reversible).toBe(false)
    })
  })

  describe('createSuccessResult', () => {
    it('should create a success result', () => {
      const result = createSuccessResult('ls', 'file1.txt\nfile2.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('file1.txt\nfile2.txt')
      expect(result.blocked).toBeUndefined()
    })

    it('should handle empty output', () => {
      const result = createSuccessResult('touch file.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })

    it('should include stderr when provided', () => {
      const result = createSuccessResult('ls', 'output', 'warning')

      expect(result.stdout).toBe('output')
      expect(result.stderr).toBe('warning')
    })
  })

  describe('createErrorResult', () => {
    it('should create an error result', () => {
      const result = createErrorResult('cat missing.txt', 'File not found')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('File not found')
      expect(result.stdout).toBe('')
    })

    it('should allow custom exit codes', () => {
      const result = createErrorResult('command', 'Permission denied', 126)

      expect(result.exitCode).toBe(126)
    })
  })
})

describe('Safety Gate Simulation', () => {
  let executor: MockExecutor

  beforeEach(() => {
    clearMocks()
    executor = createMockExecutor()
  })

  describe('Safe Commands', () => {
    it.each(SAFE_COMMANDS.slice(0, 5).map((c) => [c.command, c.description]))(
      'should allow safe command: %s (%s)',
      async (command) => {
        registerMock(command, { stdout: 'ok', stderr: '', exitCode: 0 })
        const result = await executor.execute(command)
        expect(result.blocked).toBeUndefined()
      }
    )
  })

  describe('Blocking Logic Simulation', () => {
    it('should simulate blocking critical commands', () => {
      const criticalCommand = 'rm -rf /'
      const result = createBlockedResult(
        criticalCommand,
        'Blocked: attempts to delete entire filesystem'
      )

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
    })

    it('should simulate allowing with confirm flag', async () => {
      // In real implementation, confirm=true would bypass the safety gate
      // For mock, we register a successful execution
      const command = 'rm -rf /tmp/safe-to-delete'
      registerMock(command, { stdout: '', stderr: '', exitCode: 0 })

      const result = await executor.execute(command, { confirm: true })
      expect(result.exitCode).toBe(0)
      expect(result.blocked).toBeUndefined()
    })
  })
})

describe('Execution Flow Simulation', () => {
  let executor: MockExecutor

  beforeEach(() => {
    clearMocks()
    executor = createMockExecutor()
  })

  describe('Parse -> Classify -> Execute Flow', () => {
    it('should simulate full execution flow for safe command', async () => {
      // Step 1: Parse (mocked - command is valid)
      const command = 'ls -la'

      // Step 2: Classify (from mock executor)
      const result = await executor.execute(command)
      expect(result.classification.type).toBe('read')

      // Step 3: Check safety gate (not blocked)
      expect(result.blocked).toBeUndefined()

      // Step 4: Execute
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('drwxr-xr-x')
    })

    it('should simulate flow for command requiring confirmation', () => {
      const command = 'rm -rf /important'

      // Create result as if it were blocked
      const result = createBlockedResult(
        command,
        'Recursive delete requires confirmation'
      )

      // Verify blocked state
      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.exitCode).toBe(0) // Not executed, so no error
      expect(result.stdout).toBe('')
    })
  })

  describe('Error Recovery Flow', () => {
    it('should handle command not found', async () => {
      const result = await executor.execute('nonexistent-command')

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toContain('Command not mocked')
    })

    it('should handle execution errors gracefully', async () => {
      registerMock('failing-cmd', {
        stdout: '',
        stderr: 'Error: operation failed',
        exitCode: 1,
      })

      const result = await executor.execute('failing-cmd')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Error')
    })
  })

  describe('Undo Capability Simulation', () => {
    it('should include undo command for reversible operations', () => {
      // Simulating a result with undo capability
      const result = createSuccessResult('mv old.txt new.txt')

      // Add undo information (would be added by actual implementation)
      const resultWithUndo: BashResult = {
        ...result,
        undo: 'mv new.txt old.txt',
      }

      expect(resultWithUndo.undo).toBe('mv new.txt old.txt')
    })

    it('should not include undo for irreversible operations', () => {
      const result = createSuccessResult('rm file.txt')

      // No undo for delete operations
      expect(result.undo).toBeUndefined()
    })
  })
})

describe('Options Handling', () => {
  let executor: MockExecutor

  beforeEach(() => {
    clearMocks()
    executor = createMockExecutor()
  })

  describe('Timeout Option', () => {
    it('should accept timeout option', async () => {
      const result = await executor.execute('ls', { timeout: 5000 })

      const log = executor.getExecutionLog()
      expect(log[0].options?.timeout).toBe(5000)
    })
  })

  describe('CWD Option', () => {
    it('should accept cwd option', async () => {
      const result = await executor.execute('ls', { cwd: '/tmp' })

      const log = executor.getExecutionLog()
      expect(log[0].options?.cwd).toBe('/tmp')
    })
  })

  describe('Confirm Option', () => {
    it('should accept confirm option', async () => {
      const result = await executor.execute('rm -rf temp/', { confirm: true })

      const log = executor.getExecutionLog()
      expect(log[0].options?.confirm).toBe(true)
    })
  })

  describe('Multiple Options', () => {
    it('should handle all options together', async () => {
      const options: BashOptions = {
        dryRun: true,
        timeout: 10000,
        cwd: '/home/user',
        confirm: false,
      }

      const result = await executor.execute('ls', options)

      const log = executor.getExecutionLog()
      expect(log[0].options).toEqual(options)
    })
  })
})
