import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions as NodeSpawnOptions } from 'child_process'
import { resolve, join } from 'path'
import { existsSync } from 'fs'

/**
 * Spawn function type for dependency injection
 */
export type SpawnFn = (
  command: string,
  args: string[],
  options?: NodeSpawnOptions
) => ChildProcess

export interface DevServerOptions {
  port?: number
  inspect?: boolean
  config?: string
  env?: string
  verbose?: boolean
  liveReload?: boolean
  localProtocol?: 'http' | 'https'
  persist?: boolean
  /** Dependency injection for spawn function (for testing) */
  spawn?: SpawnFn
}

export interface DevServer {
  port: number
  stop: () => void
  process: ChildProcess
}

/**
 * Start the development server using wrangler dev
 */
export function startDevServer(options: DevServerOptions = {}): DevServer {
  const {
    port = 8787,
    inspect = false,
    config,
    env,
    verbose = false,
    liveReload = false,
    localProtocol,
    persist = false,
    spawn = nodeSpawn,
  } = options

  // Find wrangler binary
  const wranglerPath = findWrangler()

  // Build wrangler dev command args
  const args = ['dev']

  // Add port if specified
  if (port !== 8787) {
    args.push('--port', String(port))
  }

  // Add config file if specified
  if (config) {
    args.push('--config', config)
  }

  // Add environment if specified
  if (env) {
    args.push('--env', env)
  }

  // Add inspect flag for debugging
  if (inspect) {
    args.push('--inspect')
  }

  // Add live reload
  if (liveReload) {
    args.push('--live-reload')
  }

  // Add local protocol
  if (localProtocol) {
    args.push('--local-protocol', localProtocol)
  }

  // Add persist flag for DO state
  if (persist) {
    args.push('--persist')
  }

  // Get current working directory (should be in dotdo package)
  const cwd = process.cwd()

  // Display startup banner
  displayBanner(port, { inspect, persist, liveReload })

  // Spawn wrangler process using injected or default spawn
  const childProcess = spawn(wranglerPath, args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '1', // Enable colors in output
    },
  })

  // Handle stdout
  if (childProcess.stdout) {
    childProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString()

      if (verbose || shouldDisplayOutput(output)) {
        // Format and display output
        formatOutput(output)
      }
    })
  }

  // Handle stderr
  if (childProcess.stderr) {
    childProcess.stderr.on('data', (data: Buffer) => {
      const output = data.toString()
      console.error(output)
    })
  }

  // Handle process errors
  childProcess.on('error', (error) => {
    console.error('Failed to start dev server:', error.message)
  })

  // Handle process exit
  childProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Dev server exited with code ${code}`)
    }
  })

  // Return server control object
  return {
    port,
    process: childProcess,
    stop: () => {
      if (childProcess && !childProcess.killed) {
        childProcess.kill()
      }
    },
  }
}

/**
 * Find wrangler binary in node_modules or global install
 */
function findWrangler(): string {
  // Try local node_modules first
  const localWrangler = resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    'wrangler'
  )
  if (existsSync(localWrangler)) {
    return localWrangler
  }

  // Try workspace root
  const workspaceWrangler = resolve(
    process.cwd(),
    '..',
    '..',
    'node_modules',
    '.bin',
    'wrangler'
  )
  if (existsSync(workspaceWrangler)) {
    return workspaceWrangler
  }

  // Fall back to global wrangler
  return 'wrangler'
}

/**
 * Display startup banner with configuration info
 */
function displayBanner(
  port: number,
  options: { inspect?: boolean; persist?: boolean; liveReload?: boolean }
) {
  console.log('')
  console.log('  \x1b[36m⚡ dotdo dev\x1b[0m')
  console.log('')
  console.log('  \x1b[2mStarting development server...\x1b[0m')
  console.log('')
  console.log(`  \x1b[1mLocal:\x1b[0m    http://localhost:${port}`)

  if (options.inspect) {
    console.log('  \x1b[1mDebug:\x1b[0m    Chrome DevTools enabled')
  }

  if (options.persist) {
    console.log('  \x1b[1mPersist:\x1b[0m  Durable Object state persistence enabled')
  }

  if (options.liveReload) {
    console.log('  \x1b[1mReload:\x1b[0m   Live reload enabled')
  }

  console.log('')
  console.log('  \x1b[2mWatching for file changes...\x1b[0m')
  console.log('')
}

/**
 * Determine if output should be displayed
 */
function shouldDisplayOutput(output: string): boolean {
  // Always show important messages
  const importantPatterns = [
    /Ready on/i,
    /Starting/i,
    /Listening/i,
    /Error/i,
    /Warning/i,
    /Detected changes/i,
    /reloading/i,
    /GET|POST|PUT|DELETE|PATCH/i, // HTTP requests
  ]

  return importantPatterns.some((pattern) => pattern.test(output))
}

/**
 * Format wrangler output for better readability
 */
function formatOutput(output: string) {
  const lines = output.split('\n')

  for (const line of lines) {
    if (!line.trim()) continue

    // Color-code HTTP methods
    let formatted = line
      .replace(/GET/g, '\x1b[32mGET\x1b[0m')
      .replace(/POST/g, '\x1b[33mPOST\x1b[0m')
      .replace(/PUT/g, '\x1b[34mPUT\x1b[0m')
      .replace(/DELETE/g, '\x1b[31mDELETE\x1b[0m')
      .replace(/PATCH/g, '\x1b[35mPATCH\x1b[0m')

    // Highlight status codes
    formatted = formatted
      .replace(/\s2\d{2}\s/g, (match) => `\x1b[32m${match}\x1b[0m`) // 2xx green
      .replace(/\s4\d{2}\s/g, (match) => `\x1b[33m${match}\x1b[0m`) // 4xx yellow
      .replace(/\s5\d{2}\s/g, (match) => `\x1b[31m${match}\x1b[0m`) // 5xx red

    console.log(`  ${formatted}`)
  }
}

/**
 * CLI command handler for dotdo dev
 */
export function devCommand(options: DevServerOptions = {}) {
  const server = startDevServer(options)

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\n\n  \x1b[2mStopping dev server...\x1b[0m\n')
    server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return server
}
