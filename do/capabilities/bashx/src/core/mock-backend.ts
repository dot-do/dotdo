/**
 * MockShellBackend
 *
 * A mock implementation of ShellBackend for testing purposes.
 * Provides recording of calls, configurable results, and verification helpers.
 */

import type {
  ShellBackend,
  ExecOptions,
  ExecResult,
  SpawnOptions,
  ShellProcess,
  StdinStream,
  ReadableStream,
} from './backend.js'

// ============================================================================
// Types for recording and configuration
// ============================================================================

/** Recorded execute() call */
export interface ExecuteCall {
  command: string
  options?: ExecOptions
}

/** Recorded spawn() call */
export interface SpawnCall {
  command: string
  options?: SpawnOptions
}

/** Recorded setEnv() call */
export interface SetEnvCall {
  key: string
  value: string
}

/** Configuration for an execute result */
interface ExecuteConfig {
  matcher: string | RegExp
  result?: ExecResult
  error?: Error
  callback?: (command: string, options?: ExecOptions) => ExecResult
  delay?: number
  timesOut?: boolean
  onAbort?: () => void
}

/** Configuration for a spawn result */
interface SpawnConfig {
  matcher: string | RegExp
  pid?: number
  exitCode?: number
  stdoutChunks?: string[]
  stderrChunks?: string[]
  captureStdin?: string[]
  simulatesKill?: boolean
}

// ============================================================================
// Builder classes for fluent API
// ============================================================================

/**
 * Builder for configuring execute() results
 */
export class ExecuteConfigBuilder {
  constructor(
    private config: ExecuteConfig,
    private configs: ExecuteConfig[],
  ) {
    this.configs.push(this.config)
  }

  /** Set the result to return */
  returns(result: Partial<ExecResult>): this {
    this.config.result = {
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      aborted: false,
      killed: false,
      ...result,
    }
    return this
  }

  /** Set an error to throw */
  throws(error: Error): this {
    this.config.error = error
    return this
  }

  /** Set a callback for dynamic results */
  callback(fn: (command: string, options?: ExecOptions) => ExecResult): this {
    this.config.callback = fn
    return this
  }

  /** Add a delay before returning */
  delays(ms: number): ExecuteConfigBuilder {
    this.config.delay = ms
    return this
  }

  /** Simulate a timeout */
  timesOut(): this {
    this.config.timesOut = true
    return this
  }

  /** Set a callback when aborted */
  onAbort(fn: () => void): this {
    this.config.onAbort = fn
    return this
  }
}

/**
 * Builder for configuring spawn() results
 */
export class SpawnConfigBuilder {
  constructor(
    private config: SpawnConfig,
    private configs: SpawnConfig[],
  ) {
    this.configs.push(this.config)
  }

  /** Set the process ID */
  withPid(pid: number): this {
    this.config.pid = pid
    return this
  }

  /** Set stdout chunks to emit */
  emitsStdout(...chunks: string[]): this {
    this.config.stdoutChunks = chunks
    return this
  }

  /** Set stderr chunks to emit */
  emitsStderr(...chunks: string[]): this {
    this.config.stderrChunks = chunks
    return this
  }

  /** Set exit code */
  exitsWithCode(code: number): this {
    this.config.exitCode = code
    return this
  }

  /** Enable kill simulation */
  simulatesKill(): this {
    this.config.simulatesKill = true
    return this
  }

  /** Capture stdin writes to an array */
  capturesStdin(target: string[]): this {
    this.config.captureStdin = target
    return this
  }
}

// ============================================================================
// Mock Process Implementation
// ============================================================================

class MockStdinStream implements StdinStream {
  private closed = false
  private captureTarget?: string[]
  private onData?: (data: string) => void
  private onEnd?: () => void

  constructor(
    captureTarget?: string[],
    onData?: (data: string) => void,
    onEnd?: () => void,
  ) {
    this.captureTarget = captureTarget
    this.onData = onData
    this.onEnd = onEnd
  }

  write(data: string): void {
    if (this.closed) return
    if (this.captureTarget) {
      this.captureTarget.push(data)
    }
    if (this.onData) {
      this.onData(data)
    }
  }

  end(): void {
    this.closed = true
    if (this.onEnd) {
      this.onEnd()
    }
  }
}

class MockReadableStream implements ReadableStream {
  private dataListeners: Array<(data: string) => void> = []
  private endListeners: Array<() => void> = []
  private errorListeners: Array<(error: Error) => void> = []
  private chunks: string[]
  private emitted = false

  constructor(chunks: string[] = []) {
    this.chunks = chunks
  }

  on(event: 'data', callback: (data: string) => void): void
  on(event: 'end', callback: () => void): void
  on(event: 'error', callback: (error: Error) => void): void
  on(event: string, callback: (...args: unknown[]) => void): void
  on(
    event: string,
    callback: ((data: string) => void) | (() => void) | ((error: Error) => void) | ((...args: unknown[]) => void),
  ): void {
    if (event === 'data') {
      this.dataListeners.push(callback as (data: string) => void)
    } else if (event === 'end') {
      this.endListeners.push(callback as () => void)
    } else if (event === 'error') {
      this.errorListeners.push(callback as (error: Error) => void)
    }
  }

  emit(): void {
    if (this.emitted) return
    this.emitted = true

    // Emit data chunks
    for (const chunk of this.chunks) {
      for (const listener of this.dataListeners) {
        listener(chunk)
      }
    }

    // Emit end event
    for (const listener of this.endListeners) {
      listener()
    }
  }
}

class MockShellProcess implements ShellProcess {
  pid: number
  stdin: MockStdinStream
  stdout: MockReadableStream
  stderr: MockReadableStream

  private killed = false
  private killSignal?: string
  private exitCode: number
  private resolveWait?: (result: ExecResult) => void
  private stdinData: string[] = []
  private completed = false

  constructor(config: SpawnConfig, command: string = '') {
    this.pid = config.pid ?? Math.floor(Math.random() * 100000)
    this.exitCode = config.exitCode ?? 0

    // Parse exit code from command if not configured
    if (config.exitCode === undefined && command.startsWith('exit ')) {
      const code = parseInt(command.slice(5), 10)
      if (!isNaN(code)) {
        this.exitCode = code
      }
    }

    // Simulate command output if not configured
    let stdoutChunks = config.stdoutChunks || []
    let stderrChunks = config.stderrChunks || []

    if (stdoutChunks.length === 0 && stderrChunks.length === 0) {
      // Simulate common commands
      if (command.startsWith('echo ')) {
        let output = command.slice(5)
        if (output.includes('>&2')) {
          output = output.replace(' >&2', '').replace('>&2', '')
          stderrChunks = [output.replace(/^["']|["']$/g, '') + '\n']
        } else {
          stdoutChunks = [output.replace(/^["']|["']$/g, '') + '\n']
        }
      }
    }

    this.stdout = new MockReadableStream(stdoutChunks)
    this.stderr = new MockReadableStream(stderrChunks)

    // Determine if this is a long-running command
    const isCatCommand = command === 'cat'
    const isSleepCommand = command.startsWith('sleep ')

    // If config has output data or capture configured, we need to handle completion properly
    const hasConfiguredOutput = (config.stdoutChunks?.length ?? 0) > 0 || (config.stderrChunks?.length ?? 0) > 0
    const hasStdinCapture = config.captureStdin !== undefined

    this.stdin = new MockStdinStream(
      config.captureStdin,
      (data) => {
        this.stdinData.push(data)
      },
      // onEnd callback - complete cat command when stdin ends (if it's a stdin-capturing command)
      (isCatCommand || hasStdinCapture) ? () => this.complete() : undefined,
    )

    // Schedule emission of stdout/stderr after a tick
    // Commands are long-running unless they have configured output or exit code
    const hasExplicitConfig = hasConfiguredOutput || config.exitCode !== undefined
    const isLongRunning = (isSleepCommand || isCatCommand) && !hasExplicitConfig

    setTimeout(() => {
      this.stdout.emit()
      this.stderr.emit()
      if (!this.killed && !isLongRunning) {
        this.complete()
      }
    }, 0)
  }

  kill(signal?: string): void {
    this.killed = true
    this.killSignal = signal || 'SIGTERM'
    // Always complete when killed
    this.complete()
  }

  private complete(): void {
    if (this.completed) return
    this.completed = true

    if (this.resolveWait) {
      const result: ExecResult = {
        stdout: this.stdinData.join(''),
        stderr: '',
        exitCode: this.killed ? 128 + 15 : this.exitCode,
        killed: this.killed,
        signal: this.killSignal,
        timedOut: false,
        aborted: false,
      }
      this.resolveWait(result)
    }
  }

  wait(): Promise<ExecResult> {
    return new Promise((resolve) => {
      this.resolveWait = resolve
      // If already completed, resolve immediately
      if (this.completed) {
        const result: ExecResult = {
          stdout: this.stdinData.join(''),
          stderr: '',
          exitCode: this.killed ? 128 + 15 : this.exitCode,
          killed: this.killed,
          signal: this.killSignal,
          timedOut: false,
          aborted: false,
        }
        resolve(result)
      }
    })
  }
}

// ============================================================================
// MockShellBackend Implementation
// ============================================================================

/**
 * MockShellBackend - A mock implementation of ShellBackend for testing.
 *
 * Features:
 * - Records all calls for verification
 * - Configurable results per command
 * - Pattern matching with regex
 * - Timeout and abort simulation
 * - Fluent API for configuration
 */
export class MockShellBackend implements ShellBackend {
  private env: Record<string, string> = {}
  private cwd: string = '/mock'
  private validPaths: Set<string> = new Set(['/tmp', '/home', '/mock', '/'])

  // Recording storage
  private executeCalls: ExecuteCall[] = []
  private spawnCalls: SpawnCall[] = []
  private setEnvCalls: SetEnvCall[] = []
  private setCwdCalls: string[] = []

  // Configuration storage
  private executeConfigs: ExecuteConfig[] = []
  private spawnConfigs: SpawnConfig[] = []
  private defaultResult: ExecResult = {
    stdout: '',
    stderr: 'command not found',
    exitCode: 127,
    timedOut: false,
    aborted: false,
    killed: false,
  }

  // Track which commands matched a configuration
  private unmatchedExecuteCalls: string[] = []

  // ============================================================================
  // ShellBackend Interface Implementation
  // ============================================================================

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    // Record the call
    this.executeCalls.push({ command, options })

    // Find matching configuration
    const config = this.findExecuteConfig(command)

    // Handle abort signal that's already aborted
    if (options?.signal?.aborted) {
      if (config?.onAbort) config.onAbort()
      return {
        stdout: '',
        stderr: '',
        exitCode: 128 + 6,
        aborted: true,
        timedOut: false,
        killed: false,
      }
    }

    // Helper to create abort result
    const createAbortResult = (): ExecResult => ({
      stdout: '',
      stderr: '',
      exitCode: 128 + 6,
      aborted: true,
      timedOut: false,
      killed: false,
    })

    // For long-running commands (sleep), always check for abort
    const isLongRunning = command.startsWith('sleep ')
    if (isLongRunning && options?.signal) {
      // Create an abort promise that resolves when signal fires
      const abortPromise = new Promise<'aborted'>((resolve) => {
        if (options.signal!.aborted) {
          resolve('aborted')
        } else {
          options.signal!.addEventListener('abort', () => resolve('aborted'))
        }
      })

      // Use a small delay to allow abort to happen
      const result = await Promise.race([
        abortPromise,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10)),
      ])

      if (result === 'aborted') {
        if (config?.onAbort) config.onAbort()
        return createAbortResult()
      }
    }

    // If no config found, track as unmatched and return default
    if (!config) {
      this.unmatchedExecuteCalls.push(command)
      return this.simulateCommand(command, options)
    }

    // If the config has an onAbort callback and signal is provided, wait for potential abort
    if (config.onAbort && options?.signal && !config.delay) {
      // Wait a tick to allow abort to fire
      const abortPromise = new Promise<'aborted'>((resolve) => {
        if (options.signal!.aborted) {
          resolve('aborted')
        } else {
          options.signal!.addEventListener('abort', () => resolve('aborted'))
        }
      })

      const result = await Promise.race([
        abortPromise,
        new Promise<'continue'>((resolve) => setTimeout(() => resolve('continue'), 10)),
      ])

      if (result === 'aborted') {
        config.onAbort()
        return createAbortResult()
      }
    }

    // Handle timeout simulation
    if (config.timesOut) {
      return {
        stdout: '',
        stderr: 'Command timed out',
        exitCode: 124,
        timedOut: true,
        aborted: false,
        killed: false,
      }
    }

    // Handle delay with abort check
    if (config.delay) {
      const abortPromise = options?.signal
        ? new Promise<'aborted'>((resolve) => {
            if (options.signal!.aborted) {
              resolve('aborted')
            } else {
              options.signal!.addEventListener('abort', () => resolve('aborted'))
            }
          })
        : null

      const delayPromise = new Promise<'done'>((resolve) =>
        setTimeout(() => resolve('done'), config.delay),
      )

      const promises: Promise<'done' | 'aborted'>[] = [delayPromise]
      if (abortPromise) promises.push(abortPromise)

      const result = await Promise.race(promises)

      if (result === 'aborted') {
        if (config.onAbort) config.onAbort()
        return createAbortResult()
      }
    }

    // Handle error throwing
    if (config.error) {
      throw config.error
    }

    // Handle callback
    if (config.callback) {
      return config.callback(command, options)
    }

    // Return configured result
    if (config.result) {
      return config.result
    }

    // Fall back to simulated command
    return this.simulateCommand(command, options)
  }

  spawn(command: string, options?: SpawnOptions): ShellProcess {
    // Record the call
    this.spawnCalls.push({ command, options })

    // Find matching configuration
    const config = this.findSpawnConfig(command)

    // Create mock process with command for simulation
    return new MockShellProcess(config || { matcher: command }, command)
  }

  getEnv(): Record<string, string> {
    return { ...this.env }
  }

  setEnv(key: string, value: string): void {
    this.setEnvCalls.push({ key, value })
    this.env[key] = value
  }

  getCwd(): string {
    return this.cwd
  }

  setCwd(path: string): void {
    // For mock, we accept any path unless it contains 'nonexistent'
    if (path.includes('nonexistent')) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    this.setCwdCalls.push(path)
    this.cwd = path
    // Add path to valid paths
    this.validPaths.add(path)
  }

  // ============================================================================
  // Configuration API
  // ============================================================================

  /**
   * Configure behavior for a specific execute() command
   */
  onExecute(matcher: string | RegExp): ExecuteConfigBuilder {
    const config: ExecuteConfig = { matcher }
    return new ExecuteConfigBuilder(config, this.executeConfigs)
  }

  /**
   * Configure behavior for a specific spawn() command
   */
  onSpawn(matcher: string | RegExp): SpawnConfigBuilder {
    const config: SpawnConfig = { matcher }
    return new SpawnConfigBuilder(config, this.spawnConfigs)
  }

  /**
   * Set the default result for unconfigured commands
   */
  setDefaultResult(result: Partial<ExecResult>): void {
    this.defaultResult = {
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      aborted: false,
      killed: false,
      ...result,
    }
  }

  // ============================================================================
  // Recording API
  // ============================================================================

  /** Get all recorded execute() calls */
  getExecuteCalls(): ExecuteCall[] {
    return [...this.executeCalls]
  }

  /** Get all recorded spawn() calls */
  getSpawnCalls(): SpawnCall[] {
    return [...this.spawnCalls]
  }

  /** Get all recorded setEnv() calls */
  getSetEnvCalls(): SetEnvCall[] {
    return [...this.setEnvCalls]
  }

  /** Get all recorded setCwd() calls */
  getSetCwdCalls(): string[] {
    return [...this.setCwdCalls]
  }

  /** Clear all recordings */
  clearRecordings(): void {
    this.executeCalls = []
    this.spawnCalls = []
    this.setEnvCalls = []
    this.setCwdCalls = []
    this.unmatchedExecuteCalls = []
  }

  // ============================================================================
  // Verification Helpers
  // ============================================================================

  /** Check if a command was executed */
  wasExecuted(command: string): boolean {
    return this.executeCalls.some((call) => call.command === command)
  }

  /** Check if a command was executed with specific options */
  wasExecutedWith(command: string, options: Partial<ExecOptions>): boolean {
    return this.executeCalls.some((call) => {
      if (call.command !== command) return false
      if (!call.options) return false
      for (const [key, value] of Object.entries(options)) {
        if ((call.options as Record<string, unknown>)[key] !== value) return false
      }
      return true
    })
  }

  /** Check if a command was spawned */
  wasSpawned(command: string): boolean {
    return this.spawnCalls.some((call) => call.command === command)
  }

  /** Count how many times a command was executed */
  executeCallCount(command: string): number {
    return this.executeCalls.filter((call) => call.command === command).length
  }

  /** Verify commands were executed in a specific order */
  verifyOrder(commands: string[]): boolean {
    let lastIndex = -1
    for (const command of commands) {
      const index = this.executeCalls.findIndex(
        (call, i) => call.command === command && i > lastIndex,
      )
      if (index === -1) return false
      lastIndex = index
    }
    return true
  }

  /** Assert that no execute calls went unmatched by configuration */
  assertNoUnmatchedCalls(): void {
    if (this.unmatchedExecuteCalls.length > 0) {
      throw new Error(
        `Unmatched execute calls: ${this.unmatchedExecuteCalls.join(', ')}`,
      )
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private findExecuteConfig(command: string): ExecuteConfig | undefined {
    return this.executeConfigs.find((config) => {
      if (typeof config.matcher === 'string') {
        return command === config.matcher || command.startsWith(config.matcher + ' ')
      }
      return config.matcher.test(command)
    })
  }

  private findSpawnConfig(command: string): SpawnConfig | undefined {
    return this.spawnConfigs.find((config) => {
      if (typeof config.matcher === 'string') {
        return command === config.matcher || command.startsWith(config.matcher + ' ')
      }
      return config.matcher.test(command)
    })
  }

  /**
   * Simulate common shell commands for better default behavior
   */
  private simulateCommand(command: string, options?: ExecOptions): ExecResult {
    const effectiveEnv = { ...this.env, ...options?.env }
    const effectiveCwd = options?.cwd || this.cwd

    // Handle echo command
    if (command.startsWith('echo ')) {
      let output = command.slice(5)
      // Handle stderr redirection
      if (output.includes('>&2')) {
        output = output.replace(' >&2', '').replace('>&2', '')
        // Expand variables
        output = this.expandVariables(output, effectiveEnv)
        return {
          stdout: '',
          stderr: output.replace(/^["']|["']$/g, '') + '\n',
          exitCode: 0,
          timedOut: false,
          aborted: false,
          killed: false,
        }
      }
      // Expand variables
      output = this.expandVariables(output, effectiveEnv)
      return {
        stdout: output.replace(/^["']|["']$/g, '') + '\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        aborted: false,
        killed: false,
      }
    }

    // Handle pwd command
    if (command === 'pwd') {
      return {
        stdout: effectiveCwd + '\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        aborted: false,
        killed: false,
      }
    }

    // Handle exit command
    if (command.startsWith('exit ')) {
      const code = parseInt(command.slice(5), 10)
      return {
        stdout: '',
        stderr: '',
        exitCode: isNaN(code) ? 0 : code,
        timedOut: false,
        aborted: false,
        killed: false,
      }
    }

    // Handle sleep command (simulate timeout)
    if (command.startsWith('sleep ')) {
      const timeout = options?.timeout
      if (timeout !== undefined) {
        return {
          stdout: '',
          stderr: '',
          exitCode: 124,
          timedOut: true,
          aborted: false,
          killed: false,
        }
      }
    }

    // Return default result for unknown commands
    return this.defaultResult
  }

  private expandVariables(
    text: string,
    env: Record<string, string>,
  ): string {
    return text.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, name) => env[name] || '')
  }
}

/**
 * Factory function to create a new MockShellBackend instance
 */
export function createMockBackend(): MockShellBackend {
  return new MockShellBackend()
}
