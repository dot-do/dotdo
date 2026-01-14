/**
 * Mock Execution Backend
 *
 * Provides a mock implementation for testing command execution
 * without actually running bash commands.
 */

import type { BashResult, BashOptions, Intent, CommandClassification } from '../../src/types.js'

// ============================================================================
// Types
// ============================================================================

export interface MockExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface MockCommand {
  command: string
  result: MockExecutionResult
  /** If true, execution should throw */
  shouldThrow?: boolean
  /** Error message if shouldThrow is true */
  errorMessage?: string
}

// ============================================================================
// Mock Command Registry
// ============================================================================

const mockRegistry = new Map<string, MockCommand>()

/**
 * Register a mock command result
 */
export function registerMock(command: string, result: MockExecutionResult): void {
  mockRegistry.set(command, { command, result })
}

/**
 * Register a mock command that throws
 */
export function registerMockError(command: string, errorMessage: string): void {
  mockRegistry.set(command, {
    command,
    result: { stdout: '', stderr: errorMessage, exitCode: 1 },
    shouldThrow: true,
    errorMessage,
  })
}

/**
 * Clear all registered mocks
 */
export function clearMocks(): void {
  mockRegistry.clear()
}

/**
 * Get registered mock for a command
 */
export function getMock(command: string): MockCommand | undefined {
  return mockRegistry.get(command)
}

// ============================================================================
// Pre-registered Common Mocks
// ============================================================================

export function registerCommonMocks(): void {
  // Read commands
  registerMock('ls', {
    stdout: 'file1.txt\nfile2.txt\ndirectory/\n',
    stderr: '',
    exitCode: 0,
  })

  registerMock('ls -la', {
    stdout: `total 24
drwxr-xr-x  5 user  staff   160 Jan  1 12:00 .
drwxr-xr-x  3 user  staff    96 Jan  1 12:00 ..
-rw-r--r--  1 user  staff  1024 Jan  1 12:00 file1.txt
-rw-r--r--  1 user  staff  2048 Jan  1 12:00 file2.txt
drwxr-xr-x  2 user  staff    64 Jan  1 12:00 directory
`,
    stderr: '',
    exitCode: 0,
  })

  registerMock('pwd', {
    stdout: '/home/user/project\n',
    stderr: '',
    exitCode: 0,
  })

  registerMock('cat package.json', {
    stdout: '{"name": "test-package", "version": "1.0.0"}\n',
    stderr: '',
    exitCode: 0,
  })

  registerMock('echo "hello world"', {
    stdout: 'hello world\n',
    stderr: '',
    exitCode: 0,
  })

  registerMock('date', {
    stdout: 'Wed Jan  8 12:00:00 UTC 2025\n',
    stderr: '',
    exitCode: 0,
  })

  registerMock('git status', {
    stdout: `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
`,
    stderr: '',
    exitCode: 0,
  })

  registerMock('which node', {
    stdout: '/usr/local/bin/node\n',
    stderr: '',
    exitCode: 0,
  })

  // Error cases
  registerMockError('cat nonexistent.txt', 'cat: nonexistent.txt: No such file or directory')
  registerMockError('rm -rf /', 'rm: refusing to remove root directory')
}

// ============================================================================
// Mock Executor
// ============================================================================

/**
 * Mock executor that simulates command execution
 */
export class MockExecutor {
  private executionLog: Array<{ command: string; options?: BashOptions; timestamp: Date }> = []

  /**
   * Execute a command and return mock result
   */
  async execute(command: string, options?: BashOptions): Promise<BashResult> {
    this.executionLog.push({ command, options, timestamp: new Date() })

    // Check for dry run
    if (options?.dryRun) {
      return this.createDryRunResult(command)
    }

    // Look up mock
    const mock = getMock(command)

    if (mock) {
      if (mock.shouldThrow) {
        throw new Error(mock.errorMessage || 'Mock execution error')
      }

      return this.createResult(command, mock.result, false)
    }

    // No mock found - return default result
    return this.createResult(
      command,
      {
        stdout: '',
        stderr: `Command not mocked: ${command}`,
        exitCode: 127,
      },
      false
    )
  }

  /**
   * Get execution log
   */
  getExecutionLog(): Array<{ command: string; options?: BashOptions; timestamp: Date }> {
    return [...this.executionLog]
  }

  /**
   * Clear execution log
   */
  clearLog(): void {
    this.executionLog = []
  }

  /**
   * Check if a command was executed
   */
  wasExecuted(command: string): boolean {
    return this.executionLog.some((entry) => entry.command === command)
  }

  /**
   * Get execution count for a command
   */
  getExecutionCount(command: string): number {
    return this.executionLog.filter((entry) => entry.command === command).length
  }

  private createDryRunResult(command: string): BashResult {
    return {
      input: command,
      valid: true,
      intent: this.extractMockIntent(command),
      classification: this.classifyMockCommand(command),
      command,
      generated: false,
      stdout: '[DRY RUN] Would execute: ' + command,
      stderr: '',
      exitCode: 0,
    }
  }

  private createResult(
    command: string,
    result: MockExecutionResult,
    generated: boolean
  ): BashResult {
    return {
      input: command,
      valid: true,
      intent: this.extractMockIntent(command),
      classification: this.classifyMockCommand(command),
      command,
      generated,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }
  }

  private extractMockIntent(command: string): Intent {
    // Basic intent extraction for mocks
    const parts = command.split(/\s+/)
    const cmd = parts[0] || ''

    return {
      commands: [cmd],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: command.startsWith('sudo'),
    }
  }

  private classifyMockCommand(command: string): CommandClassification {
    // Basic classification for mocks
    const readCommands = ['ls', 'cat', 'head', 'tail', 'grep', 'find', 'pwd', 'echo', 'date', 'git']
    const writeCommands = ['cp', 'mv', 'mkdir', 'touch', 'chmod', 'chown']
    const deleteCommands = ['rm', 'rmdir']
    const networkCommands = ['curl', 'wget', 'ssh', 'scp']

    const firstWord = command.split(/\s+/)[0] || ''

    if (readCommands.includes(firstWord)) {
      return {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only command',
      }
    }

    if (deleteCommands.includes(firstWord)) {
      const isCritical = command.includes('-rf /') || command.includes('-rf ~')
      return {
        type: 'delete',
        impact: isCritical ? 'critical' : 'medium',
        reversible: false,
        reason: 'Deletes files or directories',
      }
    }

    if (writeCommands.includes(firstWord)) {
      return {
        type: 'write',
        impact: 'medium',
        reversible: true,
        reason: 'Modifies filesystem',
      }
    }

    if (networkCommands.includes(firstWord)) {
      return {
        type: 'network',
        impact: 'medium',
        reversible: false,
        reason: 'Network operation',
      }
    }

    return {
      type: 'execute',
      impact: 'low',
      reversible: true,
      reason: 'Executes command',
    }
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a new mock executor with common mocks pre-registered
 */
export function createMockExecutor(): MockExecutor {
  registerCommonMocks()
  return new MockExecutor()
}

// ============================================================================
// Test helpers
// ============================================================================

/**
 * Create a blocked result for testing safety gates
 */
export function createBlockedResult(
  command: string,
  reason: string
): BashResult {
  return {
    input: command,
    valid: true,
    intent: {
      commands: [command.split(/\s+/)[0] || ''],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
    classification: {
      type: 'delete',
      impact: 'critical',
      reversible: false,
      reason,
    },
    command,
    generated: false,
    stdout: '',
    stderr: '',
    exitCode: 0,
    blocked: true,
    requiresConfirm: true,
    blockReason: reason,
  }
}

/**
 * Create a successful result for testing
 */
export function createSuccessResult(
  command: string,
  stdout: string = '',
  stderr: string = ''
): BashResult {
  return {
    input: command,
    valid: true,
    intent: {
      commands: [command.split(/\s+/)[0] || ''],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
    classification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command',
    },
    command,
    generated: false,
    stdout,
    stderr,
    exitCode: 0,
  }
}

/**
 * Create an error result for testing
 */
export function createErrorResult(
  command: string,
  stderr: string,
  exitCode: number = 1
): BashResult {
  return {
    input: command,
    valid: true,
    intent: {
      commands: [command.split(/\s+/)[0] || ''],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
    classification: {
      type: 'execute',
      impact: 'low',
      reversible: true,
      reason: 'Command execution',
    },
    command,
    generated: false,
    stdout: '',
    stderr,
    exitCode,
  }
}
