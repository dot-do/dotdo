/**
 * CLI E2E Test Utilities
 *
 * Helpers for spawning and managing dotdo CLI processes in tests.
 */

import { spawn, ChildProcess, execSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, rmSync, existsSync } from 'node:fs'

/** Project root directory */
export const PROJECT_ROOT = join(__dirname, '../../../../')

/** Examples directory */
export const EXAMPLES_DIR = join(PROJECT_ROOT, 'examples')

/** CLI binary path */
export const CLI_BIN = join(PROJECT_ROOT, 'cli/bin.ts')

/**
 * Server instance returned by startServer
 */
export interface ServerInstance {
  /** The spawned child process */
  process: ChildProcess
  /** The port the server is running on */
  port: number
  /** The base URL of the server */
  url: string
  /** Stop the server and clean up */
  stop: () => Promise<void>
  /** Combined stdout/stderr output */
  output: string[]
}

/**
 * Options for starting a server
 */
export interface StartServerOptions {
  /** Working directory for the server */
  cwd: string
  /** Port to run on */
  port?: number
  /** Additional CLI arguments */
  args?: string[]
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout for server readiness (ms) */
  timeout?: number
}

/**
 * Find an available port starting from the given port
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('node:net')

  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, try the next one
        resolve(findAvailablePort(startPort + 1))
      } else {
        reject(err)
      }
    })

    server.listen(startPort, () => {
      server.close(() => {
        resolve(startPort)
      })
    })
  })
}

/**
 * Wait for a server to be ready by polling the URL
 */
async function waitForServer(url: string, timeout: number): Promise<void> {
  const start = Date.now()
  const pollInterval = 100

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok || response.status < 500) {
        return
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(`Server at ${url} did not become ready within ${timeout}ms`)
}

/**
 * Start a dotdo server in the specified directory
 */
export async function startServer(options: StartServerOptions): Promise<ServerInstance> {
  const { cwd, args = [], env = {}, timeout = 30000 } = options

  // Find an available port
  const port = options.port ?? (await findAvailablePort(4000))
  const url = `http://localhost:${port}`

  const output: string[] = []

  // Spawn the CLI process
  const proc = spawn('bun', ['run', CLI_BIN, 'start', '-p', String(port), '--no-open', ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
      // Disable interactive prompts
      CI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Capture output
  proc.stdout?.on('data', (data) => {
    output.push(data.toString())
  })

  proc.stderr?.on('data', (data) => {
    output.push(data.toString())
  })

  // Handle early exit
  let exited = false
  proc.on('exit', (code) => {
    exited = true
    if (code !== 0 && code !== null) {
      console.error(`Server exited with code ${code}`)
      console.error('Output:', output.join(''))
    }
  })

  // Wait for server to be ready
  try {
    await waitForServer(url, timeout)
  } catch (error) {
    proc.kill('SIGTERM')
    throw new Error(
      `Server failed to start: ${error instanceof Error ? error.message : String(error)}\nOutput: ${output.join('')}`
    )
  }

  // If server exited during startup, throw
  if (exited) {
    throw new Error(`Server exited during startup.\nOutput: ${output.join('')}`)
  }

  return {
    process: proc,
    port,
    url,
    output,
    stop: async () => {
      if (!proc.killed) {
        proc.kill('SIGTERM')
        // Wait for graceful shutdown
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            proc.kill('SIGKILL')
            resolve()
          }, 5000)
          proc.on('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }
    },
  }
}

/**
 * Start the dev command (alternative to start)
 */
export async function startDevServer(options: StartServerOptions): Promise<ServerInstance> {
  const { cwd, args = [], env = {}, timeout = 30000 } = options

  // Find an available port
  const port = options.port ?? (await findAvailablePort(8787))
  const url = `http://localhost:${port}`

  const output: string[] = []

  // Spawn the CLI process
  const proc = spawn('bun', ['run', CLI_BIN, 'dev', '-p', String(port), ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
      CI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Capture output
  proc.stdout?.on('data', (data) => {
    output.push(data.toString())
  })

  proc.stderr?.on('data', (data) => {
    output.push(data.toString())
  })

  // Handle early exit
  let exited = false
  proc.on('exit', (code) => {
    exited = true
    if (code !== 0 && code !== null) {
      console.error(`Server exited with code ${code}`)
      console.error('Output:', output.join(''))
    }
  })

  // Wait for server to be ready
  try {
    await waitForServer(url, timeout)
  } catch (error) {
    proc.kill('SIGTERM')
    throw new Error(
      `Server failed to start: ${error instanceof Error ? error.message : String(error)}\nOutput: ${output.join('')}`
    )
  }

  if (exited) {
    throw new Error(`Server exited during startup.\nOutput: ${output.join('')}`)
  }

  return {
    process: proc,
    port,
    url,
    output,
    stop: async () => {
      if (!proc.killed) {
        proc.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            proc.kill('SIGKILL')
            resolve()
          }, 5000)
          proc.on('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }
    },
  }
}

/**
 * Run a CLI command and wait for it to complete
 */
export function runCommand(
  command: string,
  options: {
    cwd: string
    args?: string[]
    env?: Record<string, string>
    timeout?: number
  }
): { stdout: string; stderr: string; exitCode: number } {
  const { cwd, args = [], env = {}, timeout = 30000 } = options

  try {
    const fullCommand = `bun run ${CLI_BIN} ${command} ${args.join(' ')}`
    const stdout = execSync(fullCommand, {
      cwd,
      env: { ...process.env, ...env, CI: '1' },
      timeout,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return {
      stdout,
      stderr: '',
      exitCode: 0,
    }
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    }
  }
}

/**
 * Create a temporary directory for testing
 */
export function createTempDir(name: string): string {
  const tempDir = join(PROJECT_ROOT, 'tests', 'e2e', 'cli', '.temp', name)

  // Clean up if exists
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }

  mkdirSync(tempDir, { recursive: true })
  return tempDir
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true })
  }
}

/**
 * Kill any orphaned processes on a port
 */
export async function killProcessOnPort(port: number): Promise<void> {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: 'ignore',
    })
  } catch {
    // Ignore errors - no process to kill
  }
}
