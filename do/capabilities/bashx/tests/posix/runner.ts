/**
 * POSIX Compliance Test Runner
 *
 * Runs POSIX compliance tests and collects results for reporting.
 * Supports running tests for specific commands or all commands.
 *
 * @module tests/posix/runner
 */

import { TieredExecutor, type TieredExecutorConfig } from '../../src/do/tiered-executor.js'
import {
  MockFileSystem,
  type TestCase,
  type TestResult,
  type TestStatus,
  runTestCase,
} from './helpers.js'
import type { FsCapability } from '../../src/types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Results for a single command's test suite
 */
export interface CommandTestResults {
  /** Command name (e.g., 'echo', 'cat') */
  command: string
  /** Total number of tests */
  total: number
  /** Number of passed tests */
  passed: number
  /** Number of failed tests */
  failed: number
  /** Number of skipped tests */
  skipped: number
  /** Individual test results */
  results: TestResult[]
  /** Time taken in milliseconds */
  duration: number
}

/**
 * Full compliance test results
 */
export interface ComplianceResults {
  /** Results per command */
  commands: CommandTestResults[]
  /** Total number of tests */
  totalTests: number
  /** Total passed tests */
  totalPassed: number
  /** Total failed tests */
  totalFailed: number
  /** Total skipped tests */
  totalSkipped: number
  /** Overall compliance percentage */
  compliancePercentage: number
  /** Total time taken in milliseconds */
  duration: number
  /** Timestamp of the run */
  timestamp: Date
}

/**
 * Options for the test runner
 */
export interface RunnerOptions {
  /** Only run tests for these commands */
  commands?: string[]
  /** Skip tests for these commands */
  skip?: string[]
  /** Custom filesystem */
  fs?: FsCapability
  /** Custom executor config */
  executorConfig?: Partial<TieredExecutorConfig>
  /** Verbose output */
  verbose?: boolean
  /** Stop on first failure */
  failFast?: boolean
  /** Timeout per test in milliseconds */
  timeout?: number
}

/**
 * Test suite definition for a command
 */
export interface CommandTestSuite {
  /** Command name */
  command: string
  /** Test cases */
  tests: TestCase[]
  /** Setup function called before all tests */
  setup?: (fs: MockFileSystem) => void | Promise<void>
  /** Teardown function called after all tests */
  teardown?: () => void | Promise<void>
}

// ============================================================================
// TEST RUNNER CLASS
// ============================================================================

/**
 * POSIX Compliance Test Runner
 *
 * Executes POSIX compliance tests and collects results.
 *
 * @example
 * ```typescript
 * const runner = new POSIXTestRunner()
 *
 * // Register test suites
 * runner.registerSuite({
 *   command: 'echo',
 *   tests: [
 *     { name: 'basic', command: 'echo hello', stdout: 'hello\n', exitCode: 0 },
 *     { name: 'multiple args', command: 'echo hello world', stdout: 'hello world\n', exitCode: 0 },
 *   ]
 * })
 *
 * // Run all tests
 * const results = await runner.run()
 * console.log(`Compliance: ${results.compliancePercentage}%`)
 * ```
 */
export class POSIXTestRunner {
  private suites: Map<string, CommandTestSuite> = new Map()
  private options: RunnerOptions

  constructor(options: RunnerOptions = {}) {
    this.options = options
  }

  /**
   * Register a test suite for a command
   */
  registerSuite(suite: CommandTestSuite): void {
    this.suites.set(suite.command, suite)
  }

  /**
   * Register multiple test suites
   */
  registerSuites(suites: CommandTestSuite[]): void {
    for (const suite of suites) {
      this.registerSuite(suite)
    }
  }

  /**
   * Get registered command names
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.suites.keys())
  }

  /**
   * Run tests for a specific command
   */
  async runCommand(commandName: string): Promise<CommandTestResults> {
    const suite = this.suites.get(commandName)
    if (!suite) {
      throw new Error(`No test suite registered for command: ${commandName}`)
    }

    const startTime = Date.now()
    const results: TestResult[] = []
    let passed = 0
    let failed = 0
    let skipped = 0

    // Create filesystem and executor
    const fs = this.options.fs ?? new MockFileSystem()
    const executor = new TieredExecutor({
      fs,
      ...this.options.executorConfig,
    })

    // Run setup if defined
    if (suite.setup && fs instanceof MockFileSystem) {
      await suite.setup(fs)
    }

    // Run each test
    for (const testCase of suite.tests) {
      const result = await runTestCase(testCase, executor)
      results.push(result)

      switch (result.status) {
        case 'pass':
          passed++
          if (this.options.verbose) {
            console.log(`  [PASS] ${result.name}`)
          }
          break
        case 'fail':
          failed++
          if (this.options.verbose) {
            console.log(`  [FAIL] ${result.name}: ${result.error}`)
          }
          if (this.options.failFast) {
            break
          }
          break
        case 'skip':
          skipped++
          if (this.options.verbose) {
            console.log(`  [SKIP] ${result.name}`)
          }
          break
      }

      if (this.options.failFast && failed > 0) {
        break
      }
    }

    // Run teardown if defined
    if (suite.teardown) {
      await suite.teardown()
    }

    return {
      command: commandName,
      total: results.length,
      passed,
      failed,
      skipped,
      results,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Run all registered tests
   */
  async run(): Promise<ComplianceResults> {
    const startTime = Date.now()
    const commandResults: CommandTestResults[] = []

    // Determine which commands to run
    let commandsToRun = Array.from(this.suites.keys())

    if (this.options.commands && this.options.commands.length > 0) {
      commandsToRun = commandsToRun.filter(cmd => this.options.commands!.includes(cmd))
    }

    if (this.options.skip && this.options.skip.length > 0) {
      commandsToRun = commandsToRun.filter(cmd => !this.options.skip!.includes(cmd))
    }

    // Run tests for each command
    for (const command of commandsToRun) {
      if (this.options.verbose) {
        console.log(`\nRunning tests for: ${command}`)
      }

      const results = await this.runCommand(command)
      commandResults.push(results)

      if (this.options.failFast && results.failed > 0) {
        break
      }
    }

    // Calculate totals
    const totalTests = commandResults.reduce((sum, r) => sum + r.total, 0)
    const totalPassed = commandResults.reduce((sum, r) => sum + r.passed, 0)
    const totalFailed = commandResults.reduce((sum, r) => sum + r.failed, 0)
    const totalSkipped = commandResults.reduce((sum, r) => sum + r.skipped, 0)

    // Calculate compliance percentage (excluding skipped tests)
    const countedTests = totalTests - totalSkipped
    const compliancePercentage = countedTests > 0
      ? Math.round((totalPassed / countedTests) * 100 * 100) / 100
      : 0

    return {
      commands: commandResults,
      totalTests,
      totalPassed,
      totalFailed,
      totalSkipped,
      compliancePercentage,
      duration: Date.now() - startTime,
      timestamp: new Date(),
    }
  }

  /**
   * Reset the runner (clear all registered suites)
   */
  reset(): void {
    this.suites.clear()
  }
}

// ============================================================================
// BUILT-IN TEST SUITES
// ============================================================================

/**
 * Basic echo command test suite
 */
export const echoTestSuite: CommandTestSuite = {
  command: 'echo',
  tests: [
    {
      name: 'basic output',
      command: 'echo hello',
      stdout: 'hello\n',
      exitCode: 0,
    },
    {
      name: 'multiple arguments',
      command: 'echo hello world',
      stdout: 'hello world\n',
      exitCode: 0,
    },
    {
      name: 'no arguments',
      command: 'echo',
      stdout: '\n',
      exitCode: 0,
    },
    {
      name: 'no newline -n',
      command: 'echo -n hello',
      stdout: 'hello',
      exitCode: 0,
    },
    {
      name: 'escape sequences -e',
      command: 'echo -e "hello\\nworld"',
      stdout: 'hello\nworld\n',
      exitCode: 0,
    },
    {
      name: 'single quoted string',
      command: "echo 'hello world'",
      stdout: 'hello world\n',
      exitCode: 0,
    },
    {
      name: 'double quoted string',
      command: 'echo "hello world"',
      stdout: 'hello world\n',
      exitCode: 0,
    },
  ],
}

/**
 * Basic true/false command test suite
 */
export const trueFalseTestSuite: CommandTestSuite = {
  command: 'true-false',
  tests: [
    {
      name: 'true exits with 0',
      command: 'true',
      exitCode: 0,
    },
    {
      name: 'false exits with 1',
      command: 'false',
      exitCode: 1,
    },
  ],
}

/**
 * Basic cat command test suite
 */
export const catTestSuite: CommandTestSuite = {
  command: 'cat',
  setup: (fs) => {
    fs.addFile('/test/file1.txt', 'Hello, World!\n')
    fs.addFile('/test/file2.txt', 'Line 1\nLine 2\nLine 3\n')
    fs.addFile('/test/empty.txt', '')
  },
  tests: [
    {
      name: 'read single file',
      command: 'cat /test/file1.txt',
      stdout: 'Hello, World!\n',
      exitCode: 0,
    },
    {
      name: 'read multi-line file',
      command: 'cat /test/file2.txt',
      stdout: 'Line 1\nLine 2\nLine 3\n',
      exitCode: 0,
    },
    {
      name: 'read empty file',
      command: 'cat /test/empty.txt',
      stdout: '',
      exitCode: 0,
    },
    {
      name: 'nonexistent file',
      command: 'cat /test/nonexistent.txt',
      exitCode: 1,
      stderrPattern: /ENOENT/,
    },
    {
      name: 'missing operand',
      command: 'cat',
      exitCode: 1,
      stderrPattern: /missing operand/,
    },
  ],
}

/**
 * Basic wc command test suite
 */
export const wcTestSuite: CommandTestSuite = {
  command: 'wc',
  tests: [
    {
      name: 'count lines -l',
      command: 'wc -l',
      stdin: 'line1\nline2\nline3\n',
      stdout: '3\n',
      exitCode: 0,
    },
    {
      name: 'count words -w',
      command: 'wc -w',
      stdin: 'one two three four\n',
      stdout: '4\n',
      exitCode: 0,
    },
    {
      name: 'count chars -c',
      command: 'wc -c',
      stdin: 'hello',
      stdout: '5\n',
      exitCode: 0,
    },
    {
      name: 'default output (lines words chars)',
      command: 'wc',
      stdin: 'hello world\n',
      stdoutPattern: /\d+ \d+ \d+/,
      exitCode: 0,
    },
  ],
}

/**
 * Basic sort command test suite
 */
export const sortTestSuite: CommandTestSuite = {
  command: 'sort',
  tests: [
    {
      name: 'sort lines alphabetically',
      command: 'sort',
      stdin: 'banana\napple\ncherry\n',
      stdout: 'apple\nbanana\ncherry\n',
      exitCode: 0,
    },
    {
      name: 'sort reverse -r',
      command: 'sort -r',
      stdin: 'apple\nbanana\ncherry\n',
      stdout: 'cherry\nbanana\napple\n',
      exitCode: 0,
    },
    {
      name: 'sort empty input',
      command: 'sort',
      stdin: '',
      stdout: '',
      exitCode: 0,
    },
  ],
}

/**
 * Basic head command test suite
 */
export const headTestSuite: CommandTestSuite = {
  command: 'head',
  setup: (fs) => {
    fs.addFile('/test/lines.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\n')
  },
  tests: [
    {
      name: 'default 10 lines',
      command: 'head /test/lines.txt',
      stdoutPattern: /^Line 1\n.*Line 10\n$/s,
      exitCode: 0,
    },
    {
      name: 'specific number of lines -n',
      command: 'head -n3 /test/lines.txt',
      stdout: 'Line 1\nLine 2\nLine 3\n',
      exitCode: 0,
    },
    {
      name: 'missing operand',
      command: 'head',
      exitCode: 1,
      stderrPattern: /missing operand/,
    },
  ],
}

/**
 * Basic tail command test suite
 */
export const tailTestSuite: CommandTestSuite = {
  command: 'tail',
  setup: (fs) => {
    fs.addFile('/test/lines.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11\nLine 12\n')
  },
  tests: [
    {
      name: 'default 10 lines',
      command: 'tail /test/lines.txt',
      stdoutPattern: /Line 3\n.*Line 12\n$/s,
      exitCode: 0,
    },
    {
      name: 'specific number of lines -n',
      command: 'tail -n3 /test/lines.txt',
      stdout: 'Line 10\nLine 11\nLine 12\n',
      exitCode: 0,
    },
    {
      name: 'missing operand',
      command: 'tail',
      exitCode: 1,
      stderrPattern: /missing operand/,
    },
  ],
}

/**
 * All built-in test suites
 */
export const builtInSuites: CommandTestSuite[] = [
  echoTestSuite,
  trueFalseTestSuite,
  catTestSuite,
  wcTestSuite,
  sortTestSuite,
  headTestSuite,
  tailTestSuite,
]

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a runner with all built-in test suites
 */
export function createRunner(options?: RunnerOptions): POSIXTestRunner {
  const runner = new POSIXTestRunner(options)
  runner.registerSuites(builtInSuites)
  return runner
}

/**
 * Run all POSIX compliance tests
 */
export async function runAllTests(options?: RunnerOptions): Promise<ComplianceResults> {
  const runner = createRunner(options)
  return runner.run()
}

/**
 * Run tests for specific commands
 */
export async function runCommandTests(
  commands: string[],
  options?: Omit<RunnerOptions, 'commands'>
): Promise<ComplianceResults> {
  return runAllTests({ ...options, commands })
}
