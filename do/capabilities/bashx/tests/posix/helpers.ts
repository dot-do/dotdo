/**
 * POSIX Test Helpers
 *
 * Utilities for testing bashx POSIX compliance.
 * Provides a standardized interface for executing commands and asserting results.
 *
 * @module tests/posix/helpers
 */

import { expect } from 'vitest'
import { TieredExecutor, type TieredExecutorConfig } from '../../src/do/tiered-executor.js'
import type { FsCapability, BashResult } from '../../src/types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for test command execution
 */
export interface ExecTestOptions {
  /** Standard input to provide to the command */
  stdin?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Working directory */
  cwd?: string
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Result from test command execution
 */
export interface ExecTestResult {
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Exit code */
  exitCode: number
}

/**
 * Configuration for the test executor
 */
export interface TestExecutorConfig {
  /** Custom filesystem implementation */
  fs?: FsCapability
  /** Additional executor config */
  config?: Partial<TieredExecutorConfig>
}

// ============================================================================
// MOCK FILESYSTEM
// ============================================================================

/**
 * In-memory filesystem for testing
 */
export class MockFileSystem implements FsCapability {
  private files: Map<string, string | Uint8Array> = new Map()
  private directories: Set<string> = new Set(['/'])

  /**
   * Add a file to the mock filesystem
   */
  addFile(path: string, content: string | Uint8Array): void {
    this.files.set(path, content)
    // Ensure parent directories exist
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/') || '/'
      this.directories.add(dir)
    }
  }

  /**
   * Add a directory to the mock filesystem
   */
  addDirectory(path: string): void {
    this.directories.add(path)
    // Ensure parent directories exist
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/') || '/'
      this.directories.add(dir)
    }
  }

  /**
   * Clear all files and directories
   */
  clear(): void {
    this.files.clear()
    this.directories.clear()
    this.directories.add('/')
  }

  // FsCapability implementation

  async read(path: string, options?: { encoding?: string }): Promise<string | Uint8Array> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    if (options?.encoding === 'utf-8' || options?.encoding === 'utf8') {
      return typeof content === 'string' ? content : new TextDecoder().decode(content)
    }
    return content
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    this.addFile(path, content)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path)
  }

  async list(path: string, options?: { withFileTypes?: boolean; recursive?: boolean }): Promise<Array<{ name: string; path?: string; isDirectory(): boolean; isFile(): boolean }>> {
    const entries: Array<{ name: string; path?: string; isDirectory(): boolean; isFile(): boolean }> = []
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path

    // Add files
    for (const filePath of this.files.keys()) {
      if (options?.recursive) {
        if (filePath.startsWith(normalizedPath + '/') || (normalizedPath === '' && filePath.startsWith('/'))) {
          const name = filePath.split('/').pop()!
          entries.push({
            name,
            path: filePath,
            isDirectory: () => false,
            isFile: () => true,
          })
        }
      } else {
        const parent = filePath.substring(0, filePath.lastIndexOf('/')) || '/'
        if (parent === normalizedPath || (normalizedPath === '/' && parent === '')) {
          entries.push({
            name: filePath.split('/').pop()!,
            isDirectory: () => false,
            isFile: () => true,
          })
        }
      }
    }

    // Add directories
    for (const dirPath of this.directories) {
      if (dirPath === normalizedPath) continue
      if (options?.recursive) {
        if (dirPath.startsWith(normalizedPath + '/')) {
          entries.push({
            name: dirPath.split('/').pop()!,
            path: dirPath,
            isDirectory: () => true,
            isFile: () => false,
          })
        }
      } else {
        const parent = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/'
        if (parent === normalizedPath) {
          entries.push({
            name: dirPath.split('/').pop()!,
            isDirectory: () => true,
            isFile: () => false,
          })
        }
      }
    }

    return entries
  }

  async stat(path: string): Promise<{
    size: number
    mode: number
    uid: number
    gid: number
    atime: Date
    mtime: Date
    ctime: Date
    isFile(): boolean
    isDirectory(): boolean
  }> {
    const now = new Date()
    if (this.files.has(path)) {
      const content = this.files.get(path)!
      const size = typeof content === 'string' ? content.length : content.length
      return {
        size,
        mode: 0o644,
        uid: 0,
        gid: 0,
        atime: now,
        mtime: now,
        ctime: now,
        isFile: () => true,
        isDirectory: () => false,
      }
    }
    if (this.directories.has(path)) {
      return {
        size: 0,
        mode: 0o755,
        uid: 0,
        gid: 0,
        atime: now,
        mtime: now,
        ctime: now,
        isFile: () => false,
        isDirectory: () => true,
      }
    }
    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join('/') || '/'
        this.directories.add(dir)
      }
    } else {
      const parent = path.substring(0, path.lastIndexOf('/')) || '/'
      if (!this.directories.has(parent)) {
        throw new Error(`ENOENT: no such file or directory: ${parent}`)
      }
      this.directories.add(path)
    }
  }

  async rmdir(path: string): Promise<void> {
    if (!this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    this.directories.delete(path)
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    if (this.files.has(path)) {
      this.files.delete(path)
      return
    }
    if (this.directories.has(path)) {
      if (options?.recursive) {
        // Remove all files and subdirectories
        for (const filePath of [...this.files.keys()]) {
          if (filePath.startsWith(path + '/')) {
            this.files.delete(filePath)
          }
        }
        for (const dirPath of [...this.directories]) {
          if (dirPath.startsWith(path + '/') || dirPath === path) {
            this.directories.delete(dirPath)
          }
        }
      } else {
        this.directories.delete(path)
      }
      return
    }
    if (!options?.force) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = this.files.get(src)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory: ${src}`)
    }
    this.files.set(dest, content)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.files.has(oldPath)) {
      const content = this.files.get(oldPath)!
      this.files.delete(oldPath)
      this.files.set(newPath, content)
    } else if (this.directories.has(oldPath)) {
      this.directories.delete(oldPath)
      this.directories.add(newPath)
    } else {
      throw new Error(`ENOENT: no such file or directory: ${oldPath}`)
    }
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    if (!this.files.has(path) && !this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    // In-memory fs doesn't track timestamps, but we can just acknowledge success
  }

  async truncate(path: string, len: number): Promise<void> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    if (typeof content === 'string') {
      this.files.set(path, content.slice(0, len))
    } else {
      this.files.set(path, content.slice(0, len))
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    if (!this.files.has(path) && !this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    // In-memory fs doesn't track permissions
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    if (!this.files.has(path) && !this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    // In-memory fs doesn't track ownership
  }

  async readlink(path: string): Promise<string> {
    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async symlink(target: string, path: string): Promise<void> {
    // Simple implementation - just store the link target as file content prefixed with special marker
    this.files.set(path, `__SYMLINK__${target}`)
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const content = this.files.get(existingPath)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory: ${existingPath}`)
    }
    this.files.set(newPath, content)
  }
}

// ============================================================================
// TEST EXECUTOR
// ============================================================================

/**
 * Create a test executor with optional custom filesystem
 */
export function createTestExecutor(config?: TestExecutorConfig): TieredExecutor {
  const fs = config?.fs ?? new MockFileSystem()
  return new TieredExecutor({
    fs,
    ...config?.config,
  })
}

/**
 * Execute a command for testing
 */
export async function exec(
  command: string,
  options?: ExecTestOptions,
  executorConfig?: TestExecutorConfig
): Promise<ExecTestResult> {
  const executor = createTestExecutor(executorConfig)
  const result = await executor.execute(command, {
    stdin: options?.stdin,
    env: options?.env,
    cwd: options?.cwd,
    timeout: options?.timeout,
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  }
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert that stdout matches expected value
 */
export function expectOutput(result: { stdout: string }, expected: string): void {
  expect(result.stdout).toBe(expected)
}

/**
 * Assert that stdout contains expected substring
 */
export function expectOutputContains(result: { stdout: string }, expected: string): void {
  expect(result.stdout).toContain(expected)
}

/**
 * Assert that stdout matches expected pattern
 */
export function expectOutputMatches(result: { stdout: string }, pattern: RegExp): void {
  expect(result.stdout).toMatch(pattern)
}

/**
 * Assert that exit code matches expected value
 */
export function expectExitCode(result: { exitCode: number }, code: number): void {
  expect(result.exitCode).toBe(code)
}

/**
 * Assert that exit code is success (0)
 */
export function expectSuccess(result: { exitCode: number }): void {
  expect(result.exitCode).toBe(0)
}

/**
 * Assert that exit code is failure (non-zero)
 */
export function expectFailure(result: { exitCode: number }): void {
  expect(result.exitCode).not.toBe(0)
}

/**
 * Assert that stderr contains expected pattern
 */
export function expectStderr(result: { stderr: string }, pattern: string | RegExp): void {
  if (typeof pattern === 'string') {
    expect(result.stderr).toContain(pattern)
  } else {
    expect(result.stderr).toMatch(pattern)
  }
}

/**
 * Assert that stderr is empty
 */
export function expectNoStderr(result: { stderr: string }): void {
  expect(result.stderr).toBe('')
}

// ============================================================================
// TEST CASE TYPES
// ============================================================================

/**
 * POSIX compliance test status
 */
export type TestStatus = 'pass' | 'fail' | 'skip'

/**
 * Result of a single POSIX compliance test
 */
export interface TestResult {
  /** Test name */
  name: string
  /** Command being tested */
  command: string
  /** Test status */
  status: TestStatus
  /** Expected result */
  expected?: string
  /** Actual result */
  actual?: string
  /** Error message if failed */
  error?: string
  /** Time taken in milliseconds */
  duration?: number
}

/**
 * Test case definition for a POSIX command
 */
export interface TestCase {
  /** Test name */
  name: string
  /** Command to execute */
  command: string
  /** Expected stdout (exact match) */
  stdout?: string
  /** Expected stdout pattern */
  stdoutPattern?: RegExp
  /** Expected stderr (exact match) */
  stderr?: string
  /** Expected stderr pattern */
  stderrPattern?: RegExp
  /** Expected exit code */
  exitCode?: number
  /** Input to provide via stdin */
  stdin?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Whether to skip this test */
  skip?: boolean
  /** Reason for skipping */
  skipReason?: string
}

/**
 * Run a single test case
 */
export async function runTestCase(
  testCase: TestCase,
  executor: TieredExecutor
): Promise<TestResult> {
  const startTime = Date.now()

  if (testCase.skip) {
    return {
      name: testCase.name,
      command: testCase.command,
      status: 'skip',
      error: testCase.skipReason,
      duration: 0,
    }
  }

  try {
    const result = await executor.execute(testCase.command, {
      stdin: testCase.stdin,
      env: testCase.env,
    })

    const duration = Date.now() - startTime
    const failures: string[] = []

    // Check stdout
    if (testCase.stdout !== undefined && result.stdout !== testCase.stdout) {
      failures.push(`stdout: expected ${JSON.stringify(testCase.stdout)}, got ${JSON.stringify(result.stdout)}`)
    }
    if (testCase.stdoutPattern && !testCase.stdoutPattern.test(result.stdout)) {
      failures.push(`stdout: expected to match ${testCase.stdoutPattern}, got ${JSON.stringify(result.stdout)}`)
    }

    // Check stderr
    if (testCase.stderr !== undefined && result.stderr !== testCase.stderr) {
      failures.push(`stderr: expected ${JSON.stringify(testCase.stderr)}, got ${JSON.stringify(result.stderr)}`)
    }
    if (testCase.stderrPattern && !testCase.stderrPattern.test(result.stderr)) {
      failures.push(`stderr: expected to match ${testCase.stderrPattern}, got ${JSON.stringify(result.stderr)}`)
    }

    // Check exit code
    if (testCase.exitCode !== undefined && result.exitCode !== testCase.exitCode) {
      failures.push(`exitCode: expected ${testCase.exitCode}, got ${result.exitCode}`)
    }

    if (failures.length > 0) {
      return {
        name: testCase.name,
        command: testCase.command,
        status: 'fail',
        expected: testCase.stdout,
        actual: result.stdout,
        error: failures.join('; '),
        duration,
      }
    }

    return {
      name: testCase.name,
      command: testCase.command,
      status: 'pass',
      duration,
    }
  } catch (error) {
    return {
      name: testCase.name,
      command: testCase.command,
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { TieredExecutor }
export type { BashResult, FsCapability }
