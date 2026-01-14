/**
 * Node.js process polyfill for Workers runtime
 *
 * Provides a subset of Node.js process object functionality for edge runtimes
 * where the native process global is not available.
 *
 * Features:
 * - Environment variables via configurable env object
 * - Command line arguments via argv
 * - Virtual current working directory with cwd/chdir
 * - Exit handling via thrown error (captured by runtime)
 * - stdout/stderr capture for output collection
 * - hrtime via performance.now()
 * - nextTick via queueMicrotask
 *
 * @module npmx/core/npx/process
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Exit error thrown when process.exit() is called
 * This allows the runtime to capture exit codes without actually terminating
 */
export class ProcessExitError extends Error {
  readonly code: number

  constructor(code: number = 0) {
    super(`Process exited with code ${code}`)
    this.name = 'ProcessExitError'
    this.code = code
  }
}

/**
 * Stream interface for stdout/stderr
 */
export interface ProcessStream {
  write(data: string): boolean
  isTTY: boolean
}

/**
 * Stdin interface
 */
export interface ProcessStdin {
  isTTY: boolean
  read(): string | null
}

/**
 * High-resolution time tuple [seconds, nanoseconds]
 */
export type HrTime = [number, number]

/**
 * Process polyfill interface (subset of Node.js process)
 */
export interface ProcessPolyfill {
  /** Environment variables */
  env: Record<string, string | undefined>

  /** Command line arguments */
  argv: string[]

  /** Get current working directory */
  cwd(): string

  /** Change current working directory */
  chdir(dir: string): void

  /** Exit the process (throws ProcessExitError) */
  exit(code?: number): never

  /** Standard output stream */
  stdout: ProcessStream

  /** Standard error stream */
  stderr: ProcessStream

  /** Standard input stream */
  stdin: ProcessStdin

  /** Platform identifier */
  platform: string

  /** Node.js version string */
  version: string

  /** Runtime versions */
  versions: Record<string, string>

  /** Schedule callback on next tick (microtask) */
  nextTick(callback: () => void): void

  /** High-resolution time */
  hrtime(time?: HrTime): HrTime

  /** High-resolution time as bigint */
  hrtime: {
    (time?: HrTime): HrTime
    bigint(): bigint
  }

  /** Process ID (always 1 in Workers) */
  pid: number

  /** Parent process ID (always 0 in Workers) */
  ppid: number

  /** Process title */
  title: string

  /** Architecture (always 'wasm' in Workers) */
  arch: string

  /** Memory usage (returns zeros - not available in Workers) */
  memoryUsage(): {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
  }

  /** CPU usage (returns zeros - not available in Workers) */
  cpuUsage(): { user: number; system: number }

  /** Uptime since process start */
  uptime(): number
}

/**
 * Options for creating a process polyfill
 */
export interface ProcessPolyfillOptions {
  /** Initial environment variables */
  env?: Record<string, string>

  /** Initial current working directory */
  cwd?: string

  /** Command line arguments */
  argv?: string[]

  /** Platform identifier (defaults to 'linux') */
  platform?: string

  /** Node.js version to report (defaults to 'v20.0.0') */
  version?: string

  /** Whether stdout/stderr are TTY (defaults to false) */
  isTTY?: boolean
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Create a writable stream for stdout/stderr
 */
function createOutputStream(
  buffer: string[],
  isTTY: boolean
): ProcessStream {
  return {
    write(data: string): boolean {
      buffer.push(data)
      return true
    },
    isTTY,
  }
}

/**
 * Create a process polyfill for the Workers runtime
 *
 * @param options - Configuration options
 * @returns Process polyfill object
 *
 * @example
 * ```typescript
 * const process = createProcessPolyfill({
 *   env: { NODE_ENV: 'production' },
 *   cwd: '/app',
 *   argv: ['node', 'script.js', '--port', '3000'],
 * })
 *
 * console.log(process.env.NODE_ENV) // 'production'
 * console.log(process.cwd()) // '/app'
 * console.log(process.argv) // ['node', 'script.js', '--port', '3000']
 * ```
 */
export function createProcessPolyfill(
  options: ProcessPolyfillOptions = {}
): ProcessPolyfill {
  // Initialize state
  let currentCwd = options.cwd ?? '/'
  const startTime = performance.now()

  // Output buffers for stdout/stderr
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []

  // Create the hrtime function with bigint method
  const hrtime = Object.assign(
    function (time?: HrTime): HrTime {
      const now = performance.now()
      const seconds = Math.floor(now / 1000)
      const nanoseconds = Math.round((now % 1000) * 1e6)

      if (time) {
        const [prevSeconds, prevNanoseconds] = time
        let diffSeconds = seconds - prevSeconds
        let diffNanoseconds = nanoseconds - prevNanoseconds

        if (diffNanoseconds < 0) {
          diffSeconds -= 1
          diffNanoseconds += 1e9
        }

        return [diffSeconds, diffNanoseconds]
      }

      return [seconds, nanoseconds]
    },
    {
      bigint(): bigint {
        const now = performance.now()
        // Convert milliseconds to nanoseconds as bigint
        return BigInt(Math.round(now * 1e6))
      },
    }
  )

  const process: ProcessPolyfill = {
    // Environment variables (shallow copy for isolation)
    env: { ...options.env },

    // Command line arguments
    argv: options.argv ?? ['node'],

    // Current working directory
    cwd(): string {
      return currentCwd
    },

    chdir(dir: string): void {
      // Normalize the path
      if (dir.startsWith('/')) {
        currentCwd = dir
      } else {
        // Handle relative paths
        currentCwd = currentCwd.endsWith('/')
          ? `${currentCwd}${dir}`
          : `${currentCwd}/${dir}`
      }
      // Remove trailing slash (except for root)
      if (currentCwd !== '/' && currentCwd.endsWith('/')) {
        currentCwd = currentCwd.slice(0, -1)
      }
    },

    // Exit throws an error to signal exit (captured by runtime)
    exit(code: number = 0): never {
      throw new ProcessExitError(code)
    },

    // Standard streams
    stdout: createOutputStream(stdoutBuffer, options.isTTY ?? false),
    stderr: createOutputStream(stderrBuffer, options.isTTY ?? false),
    stdin: {
      isTTY: options.isTTY ?? false,
      read(): string | null {
        // Stdin is not readable in Workers runtime
        return null
      },
    },

    // Platform info - Workers runs on Linux
    platform: options.platform ?? 'linux',

    // Node.js version string (compatibility target)
    version: options.version ?? 'v20.0.0',

    // Runtime versions
    versions: {
      node: (options.version ?? 'v20.0.0').slice(1),
      v8: '11.3.244.8', // Approximate V8 version in Workers
      modules: '115',
      worker: '1.0.0',
    },

    // nextTick via queueMicrotask (standard Web API)
    nextTick(callback: () => void): void {
      queueMicrotask(callback)
    },

    // High-resolution time
    hrtime,

    // Process IDs (Workers always report 1/0)
    pid: 1,
    ppid: 0,

    // Process title
    title: 'node',

    // Architecture (Workers run on WebAssembly/V8)
    arch: 'wasm',

    // Memory usage (not available in Workers - return zeros)
    memoryUsage(): {
      rss: number
      heapTotal: number
      heapUsed: number
      external: number
      arrayBuffers: number
    } {
      return {
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
      }
    },

    // CPU usage (not available in Workers - return zeros)
    cpuUsage(): { user: number; system: number } {
      return { user: 0, system: 0 }
    },

    // Uptime since polyfill creation
    uptime(): number {
      return (performance.now() - startTime) / 1000
    },
  }

  return process
}

/**
 * Get captured stdout output
 * Useful for testing or capturing CLI output
 */
export function getStdoutBuffer(_process: ProcessPolyfill): string[] {
  // Access the internal buffer through closure
  // This is a helper for testing
  const output: string[] = []
  const originalWrite = _process.stdout.write.bind(_process.stdout)

  // Wrap to capture
  _process.stdout.write = (data: string): boolean => {
    output.push(data)
    return originalWrite(data)
  }

  return output
}

/**
 * Get captured stderr output
 * Useful for testing or capturing CLI output
 */
export function getStderrBuffer(_process: ProcessPolyfill): string[] {
  const output: string[] = []
  const originalWrite = _process.stderr.write.bind(_process.stderr)

  _process.stderr.write = (data: string): boolean => {
    output.push(data)
    return originalWrite(data)
  }

  return output
}

// Default export for convenience
export default createProcessPolyfill
