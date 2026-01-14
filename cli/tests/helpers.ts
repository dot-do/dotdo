/**
 * CLI Test Helpers
 *
 * Shared utilities for testing CLI commands (init, dev, deploy).
 * These helpers provide:
 * - CLI execution via child_process
 * - Temporary directory management
 * - Console output capture
 * - Process spawn mocking
 *
 * @see cli/tests/commands.test.ts - Main CLI tests
 * @see cli/tests/commands/cli-commands-red.test.ts - Extended RED phase tests
 */

import { spawn, ChildProcess } from 'child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { vi, type Mock } from 'vitest'
import { fileURLToPath } from 'node:url'

// ============================================================================
// Path Constants
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Path to the CLI main entry point */
export const CLI_PATH = path.join(__dirname, '..', 'main.ts')

/** Path to the CLI bin entry */
export const CLI_BIN_PATH = path.join(__dirname, '..', 'bin.ts')

/** Default timeout for CLI operations (ms) */
export const DEFAULT_CLI_TIMEOUT = 10000

/** Extended timeout for operations that may take longer */
export const EXTENDED_CLI_TIMEOUT = 30000

// ============================================================================
// Types
// ============================================================================

/**
 * Result of running a CLI command
 */
export interface CLIResult {
  /** Process exit code */
  exitCode: number
  /** Captured stdout output */
  stdout: string
  /** Captured stderr output */
  stderr: string
  /** Whether the command timed out */
  timedOut: boolean
}

/**
 * Options for running CLI commands
 */
export interface RunCLIOptions {
  /** Working directory for the command */
  cwd?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Environment variables to set */
  env?: Record<string, string>
  /** Input to pipe to stdin */
  stdin?: string
}

/**
 * Spawn options passed to child_process
 */
export interface SpawnOptions {
  env?: Record<string, string | undefined>
  stdio?: ['inherit' | 'pipe', 'inherit' | 'pipe', 'inherit' | 'pipe'] | 'inherit'
  cwd?: string
}

/**
 * Mock spawned process interface
 */
export interface SpawnedProcess {
  pid: number
  exited: Promise<number>
  kill: (signal?: number) => void
  stdout?: ReadableStream<Uint8Array>
  stderr?: ReadableStream<Uint8Array>
}

/**
 * Console capture result
 */
export interface ConsoleCaptureResult {
  /** Captured console.log output */
  logs: string[]
  /** Captured console.error output */
  errors: string[]
  /** Restore original console methods */
  restore: () => void
  /** Get all output (logs + errors) */
  all: () => string[]
}

// ============================================================================
// CLI Execution Helpers
// ============================================================================

/**
 * Run a CLI command and capture output
 *
 * @example
 * ```typescript
 * const result = await runCLI(['init', '--help'])
 * expect(result.exitCode).toBe(0)
 * expect(result.stdout).toContain('Initialize')
 * ```
 */
export async function runCLI(
  args: string[],
  options: RunCLIOptions = {}
): Promise<CLIResult> {
  const {
    cwd = process.cwd(),
    timeout = DEFAULT_CLI_TIMEOUT,
    env = {},
    stdin,
  } = options

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    })

    // Set up timeout
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      // Give it a moment to clean up, then force kill
      setTimeout(() => proc.kill('SIGKILL'), 1000)
    }, timeout)

    // Capture stdout
    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    // Capture stderr
    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    // Handle stdin if provided
    if (stdin && proc.stdin) {
      proc.stdin.write(stdin)
      proc.stdin.end()
    }

    // Handle process exit
    proc.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? (timedOut ? -1 : 0),
        timedOut,
      })
    })

    // Handle spawn errors
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Run CLI command with npx/bunx for testing installed package behavior
 */
export async function runCLIViaNpx(
  command: string,
  args: string[],
  options: RunCLIOptions = {}
): Promise<CLIResult> {
  const { cwd = process.cwd(), timeout = DEFAULT_CLI_TIMEOUT, env = {} } = options

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const proc = spawn('bunx', [command, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
        NO_COLOR: '1',
      },
    })

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
    }, timeout)

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? (timedOut ? -1 : 0),
        timedOut,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// ============================================================================
// Temporary Directory Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 *
 * @example
 * ```typescript
 * const tempDir = createTempDir()
 * // Use tempDir for testing
 * cleanupTempDir(tempDir)
 * ```
 */
export function createTempDir(prefix = 'dotdo-cli-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Create a temporary directory and return cleanup function
 * Useful for beforeEach/afterEach patterns
 *
 * @example
 * ```typescript
 * let cleanup: () => void
 * let tempDir: string
 *
 * beforeEach(() => {
 *   const { dir, cleanup: c } = createTempDirWithCleanup()
 *   tempDir = dir
 *   cleanup = c
 * })
 *
 * afterEach(() => cleanup())
 * ```
 */
export function createTempDirWithCleanup(prefix = 'dotdo-cli-test-'): {
  dir: string
  cleanup: () => void
} {
  const dir = createTempDir(prefix)
  return {
    dir,
    cleanup: () => cleanupTempDir(dir),
  }
}

// ============================================================================
// Console Capture Helpers
// ============================================================================

/**
 * Capture console output for assertions
 *
 * @example
 * ```typescript
 * const output = captureConsole()
 * try {
 *   console.log('Hello')
 *   console.error('World')
 *   expect(output.logs).toContain('Hello')
 *   expect(output.errors).toContain('World')
 * } finally {
 *   output.restore()
 * }
 * ```
 */
export function captureConsole(): ConsoleCaptureResult {
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
    all: () => [...logs, ...errors],
  }
}

// ============================================================================
// Spawn Mock Helpers
// ============================================================================

/**
 * Create a mock spawn function for testing CLI commands
 *
 * @example
 * ```typescript
 * const spawnMock = createSpawnMock()
 * spawnMock.setExitCode(0)
 *
 * await run([], { spawn: spawnMock.mock })
 *
 * expect(spawnMock.calls).toHaveLength(1)
 * expect(spawnMock.calls[0].command).toContain('wrangler')
 * ```
 */
export function createSpawnMock() {
  const calls: Array<{ command: string[]; options?: SpawnOptions }> = []
  let exitCode = 0
  let shouldReject = false
  let stdoutOutput = ''
  let stderrOutput = ''

  const mock = vi.fn((command: string[], options?: SpawnOptions): SpawnedProcess => {
    calls.push({ command, options })

    const process: SpawnedProcess = {
      pid: 12345 + calls.length,
      exited: shouldReject
        ? Promise.reject(new Error('Process failed'))
        : Promise.resolve(exitCode),
      kill: vi.fn(),
    }

    // Add stdout stream if output is configured
    if (stdoutOutput) {
      process.stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stdoutOutput))
          controller.close()
        },
      })
    }

    // Add stderr stream if output is configured
    if (stderrOutput) {
      process.stderr = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stderrOutput))
          controller.close()
        },
      })
    }

    return process
  })

  return {
    /** The mock function to pass to commands */
    mock,
    /** Array of all spawn calls made */
    calls,
    /** Set the exit code for the next spawn */
    setExitCode: (code: number) => {
      exitCode = code
    },
    /** Configure the mock to reject (simulate spawn failure) */
    setReject: (reject: boolean) => {
      shouldReject = reject
    },
    /** Set stdout output for the spawned process */
    setStdout: (output: string) => {
      stdoutOutput = output
    },
    /** Set stderr output for the spawned process */
    setStderr: (output: string) => {
      stderrOutput = output
    },
    /** Reset all mock state */
    reset: () => {
      calls.length = 0
      exitCode = 0
      shouldReject = false
      stdoutOutput = ''
      stderrOutput = ''
      mock.mockClear()
    },
  }
}

// ============================================================================
// File System Helpers
// ============================================================================

/**
 * Check if a file exists and contains expected content
 */
export function assertFileContains(
  filePath: string,
  content: string | RegExp
): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`)
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8')

  if (typeof content === 'string') {
    if (!fileContent.includes(content)) {
      throw new Error(
        `File ${filePath} does not contain expected content.\n` +
        `Expected: ${content}\n` +
        `Actual: ${fileContent.substring(0, 200)}...`
      )
    }
  } else {
    if (!content.test(fileContent)) {
      throw new Error(
        `File ${filePath} does not match expected pattern.\n` +
        `Pattern: ${content}\n` +
        `Actual: ${fileContent.substring(0, 200)}...`
      )
    }
  }
}

/**
 * Assert that a directory exists
 */
export function assertDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${dirPath}`)
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Path exists but is not a directory: ${dirPath}`)
  }
}

/**
 * Assert that a file exists
 */
export function assertFileExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`)
  }
  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`Path exists but is not a file: ${filePath}`)
  }
}

/**
 * Write a file in a temp directory
 */
export function writeTestFile(
  dir: string,
  relativePath: string,
  content: string
): string {
  const fullPath = path.join(dir, relativePath)
  const dirPath = path.dirname(fullPath)

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }

  fs.writeFileSync(fullPath, content)
  return fullPath
}

/**
 * Read a test file
 */
export function readTestFile(dir: string, relativePath: string): string {
  const fullPath = path.join(dir, relativePath)
  return fs.readFileSync(fullPath, 'utf-8')
}

// ============================================================================
// Project Scaffolding Helpers
// ============================================================================

/**
 * Create a minimal dotdo project structure for testing
 */
export function scaffoldMinimalProject(
  dir: string,
  options: {
    name?: string
    withGit?: boolean
    withNodeModules?: boolean
  } = {}
): void {
  const { name = 'test-project', withGit = false, withNodeModules = false } = options

  // Create basic structure
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.do'), { recursive: true })

  // package.json
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
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
  fs.writeFileSync(
    path.join(dir, 'wrangler.jsonc'),
    JSON.stringify(
      {
        name,
        main: 'src/index.ts',
        compatibility_date: '2024-01-01',
        compatibility_flags: ['nodejs_compat'],
      },
      null,
      2
    )
  )

  // src/index.ts
  fs.writeFileSync(
    path.join(dir, 'src', 'index.ts'),
    `import { DO } from 'dotdo'

export class TestDO extends DO {
  static readonly $type = 'TestDO'
}

export default {
  fetch(request: Request) {
    return new Response('Hello!')
  }
}
`
  )

  // dotdo.config.ts
  fs.writeFileSync(
    path.join(dir, 'dotdo.config.ts'),
    `export default {
  port: 8787,
  entryPoint: 'src/index.ts',
}
`
  )

  if (withGit) {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  }

  if (withNodeModules) {
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for a condition to be true (with timeout)
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((r) => setTimeout(r, interval))
  }

  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Environment Helpers
// ============================================================================

/**
 * Run a test with modified environment variables
 */
export async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => T | Promise<T>
): Promise<T> {
  const original: Record<string, string | undefined> = {}

  // Save original values and set new ones
  for (const [key, value] of Object.entries(env)) {
    original[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await fn()
  } finally {
    // Restore original values
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}
