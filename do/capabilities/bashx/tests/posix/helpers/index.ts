/**
 * POSIX Test Helpers
 *
 * Provides utilities for running POSIX compliance tests.
 * Uses the actual system shell to execute commands for realistic testing.
 */

import { exec as execCallback, spawn } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

const execPromise = promisify(execCallback)

/**
 * Result from executing a command
 */
export interface ExecResult {
  /** Standard output from the command */
  stdout: string
  /** Standard error from the command */
  stderr: string
  /** Exit code (0 = success) */
  exitCode: number
  /** The command that was executed */
  command: string
}

/**
 * Options for command execution
 */
export interface ExecOptions {
  /** Working directory for command execution */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** Input to pipe to stdin */
  stdin?: string
}

/**
 * Execute a shell command and return the result.
 *
 * This function executes commands using /bin/sh for POSIX compatibility.
 * It captures stdout, stderr, and the exit code.
 *
 * @param command - The shell command to execute
 * @param options - Optional execution options
 * @returns Promise resolving to the execution result
 *
 * @example
 * ```typescript
 * const result = await exec('echo hello')
 * expect(result.stdout).toBe('hello\n')
 * expect(result.exitCode).toBe(0)
 * ```
 */
export async function exec(command: string, options?: ExecOptions): Promise<ExecResult> {
  const cwd = options?.cwd || process.cwd()
  const env = { ...process.env, ...options?.env }
  const timeout = options?.timeout || 30000

  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    // Handle stdin if provided
    if (options?.stdin) {
      child.stdin.write(options.stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: timedOut ? 124 : (code ?? 1),
        command,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
        command,
      })
    })
  })
}

/**
 * Create a temporary directory for test isolation.
 *
 * @param prefix - Optional prefix for the directory name
 * @returns Promise resolving to the temporary directory path
 */
export async function createTempDir(prefix = 'posix-test-'): Promise<string> {
  const tmpBase = os.tmpdir()
  const tmpDir = await fs.mkdtemp(path.join(tmpBase, prefix))
  return tmpDir
}

/**
 * Remove a directory and all its contents.
 *
 * @param dirPath - Path to the directory to remove
 */
export async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Create a test file with content.
 *
 * @param filePath - Path to the file
 * @param content - Content to write
 */
export async function createFile(filePath: string, content: string = ''): Promise<void> {
  await fs.writeFile(filePath, content)
}

/**
 * Create a test directory.
 *
 * @param dirPath - Path to the directory
 */
export async function createDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Check if a file or directory exists.
 *
 * @param path - Path to check
 * @returns Promise resolving to true if exists
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Read file contents.
 *
 * @param filePath - Path to the file
 * @returns Promise resolving to file contents
 */
export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8')
}

/**
 * Get file stats.
 *
 * @param filePath - Path to the file
 * @returns Promise resolving to file stats
 */
export async function stat(filePath: string): Promise<fs.FileHandle['stat'] extends (...args: any[]) => infer R ? Awaited<R> : never> {
  return fs.stat(filePath)
}

/**
 * Get file stats without following symlinks.
 *
 * @param filePath - Path to the file
 * @returns Promise resolving to file stats
 */
export async function lstat(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  return fs.lstat(filePath)
}

/**
 * Read the target of a symbolic link.
 *
 * @param linkPath - Path to the symlink
 * @returns Promise resolving to the link target
 */
export async function readlink(linkPath: string): Promise<string> {
  return fs.readlink(linkPath)
}

/**
 * List directory contents.
 *
 * @param dirPath - Path to the directory
 * @returns Promise resolving to array of entry names
 */
export async function readdir(dirPath: string): Promise<string[]> {
  return fs.readdir(dirPath)
}

/**
 * Test context for managing test resources.
 */
export interface TestContext {
  /** Temporary directory for the test */
  tmpDir: string
  /** Execute a command in the temp directory */
  exec: (command: string, options?: Omit<ExecOptions, 'cwd'>) => Promise<ExecResult>
  /** Create a file in the temp directory */
  createFile: (name: string, content?: string) => Promise<string>
  /** Create a directory in the temp directory */
  createDir: (name: string) => Promise<string>
  /** Check if a path exists in the temp directory */
  exists: (name: string) => Promise<boolean>
  /** Read a file from the temp directory */
  readFile: (name: string) => Promise<string>
  /** Get file stats from the temp directory */
  stat: (name: string) => Promise<Awaited<ReturnType<typeof fs.stat>>>
  /** Get file stats without following symlinks */
  lstat: (name: string) => Promise<Awaited<ReturnType<typeof fs.lstat>>>
  /** Read symlink target */
  readlink: (name: string) => Promise<string>
  /** List directory contents */
  readdir: (name?: string) => Promise<string[]>
  /** Cleanup the temp directory */
  cleanup: () => Promise<void>
}

/**
 * Create a test context with an isolated temporary directory.
 *
 * @returns Promise resolving to a test context
 *
 * @example
 * ```typescript
 * describe('my tests', () => {
 *   let ctx: TestContext
 *
 *   beforeEach(async () => {
 *     ctx = await createTestContext()
 *   })
 *
 *   afterEach(async () => {
 *     await ctx.cleanup()
 *   })
 *
 *   it('creates files', async () => {
 *     await ctx.createFile('test.txt', 'hello')
 *     const result = await ctx.exec('cat test.txt')
 *     expect(result.stdout).toBe('hello')
 *   })
 * })
 * ```
 */
export async function createTestContext(): Promise<TestContext> {
  const tmpDir = await createTempDir()

  const resolvePath = (name: string) => path.join(tmpDir, name)

  return {
    tmpDir,

    exec: async (command, options) => {
      return exec(command, { ...options, cwd: tmpDir })
    },

    createFile: async (name, content = '') => {
      const filePath = resolvePath(name)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content)
      return filePath
    },

    createDir: async (name) => {
      const dirPath = resolvePath(name)
      await fs.mkdir(dirPath, { recursive: true })
      return dirPath
    },

    exists: async (name) => {
      return exists(resolvePath(name))
    },

    readFile: async (name) => {
      return fs.readFile(resolvePath(name), 'utf-8')
    },

    stat: async (name) => {
      return fs.stat(resolvePath(name))
    },

    lstat: async (name) => {
      return fs.lstat(resolvePath(name))
    },

    readlink: async (name) => {
      return fs.readlink(resolvePath(name))
    },

    readdir: async (name = '.') => {
      return fs.readdir(resolvePath(name))
    },

    cleanup: async () => {
      await removeTempDir(tmpDir)
    },
  }
}

/**
 * Expectation helpers for common POSIX test patterns
 */
export const posixExpect = {
  /**
   * Assert command succeeded (exit code 0)
   */
  success(result: ExecResult): void {
    if (result.exitCode !== 0) {
      throw new Error(
        `Expected success but got exit code ${result.exitCode}.\n` +
        `Command: ${result.command}\n` +
        `stderr: ${result.stderr}`
      )
    }
  },

  /**
   * Assert command failed (exit code non-zero)
   */
  failure(result: ExecResult): void {
    if (result.exitCode === 0) {
      throw new Error(
        `Expected failure but got success.\n` +
        `Command: ${result.command}\n` +
        `stdout: ${result.stdout}`
      )
    }
  },

  /**
   * Assert specific exit code
   */
  exitCode(result: ExecResult, expected: number): void {
    if (result.exitCode !== expected) {
      throw new Error(
        `Expected exit code ${expected} but got ${result.exitCode}.\n` +
        `Command: ${result.command}\n` +
        `stderr: ${result.stderr}`
      )
    }
  },
}
