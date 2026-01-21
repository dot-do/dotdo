/**
 * Deploy Command - do-7rf.9.5
 *
 * Deploys to Cloudflare Workers using wrangler deploy.
 * Implements:
 * - Build before deploy
 * - Environment selection (staging, production)
 * - Secret management via oauth.do authentication
 * - Rollback support
 * - Integration with workers.do API
 */

// Note: oauth.do/node is external dependency that provides authentication
// For now, we'll use a simplified implementation that can be swapped out

export const name = 'deploy'
export const description = 'Deploy to Cloudflare Workers'

/**
 * Spawn process options
 */
interface SpawnOptions {
  env?: Record<string, string | undefined>
  stdio?: ['inherit' | 'pipe', 'inherit' | 'pipe', 'inherit' | 'pipe'] | 'inherit'
  cwd?: string
}

/**
 * Spawned process interface
 */
interface SpawnedProcess {
  pid: number
  exited: Promise<number>
  kill: (signal?: number) => void
  stdout?: ReadableStream<Uint8Array>
  stderr?: ReadableStream<Uint8Array>
}

/**
 * Spawn function type
 */
type SpawnFn = (command: string[], options?: SpawnOptions) => SpawnedProcess

/**
 * Run options
 */
interface RunOptions {
  spawn?: SpawnFn
  apiUrl?: string
  skipAuth?: boolean // For testing/local development
  skipBuild?: boolean // Skip build step
  verbose?: boolean
}

/**
 * Run result
 */
interface RunResult {
  exitCode: number
  success: boolean
  deploymentUrl?: string
}

/**
 * Authentication result
 */
interface AuthResult {
  token: string
  isNewLogin: boolean
}

/**
 * Mock authentication function
 * TODO: Replace with actual oauth.do/node when available
 */
async function ensureLoggedIn(options: {
  openBrowser?: boolean
  print?: (message: string) => void
}): Promise<AuthResult> {
  // For now, return a mock token
  // In production, this would trigger OAuth flow via oauth.do
  if (options.print) {
    options.print('[Auth] Mock authentication - TODO: Implement oauth.do/node')
  }

  return {
    token: process.env['DO_TOKEN'] || 'mock-token-for-development',
    isNewLogin: false,
  }
}

/**
 * Parse deployment arguments to detect rollback
 */
function parseArgs(args: string[]): {
  isRollback: boolean
  rollbackVersion?: string
  remainingArgs: string[]
} {
  const rollbackIndex = args.indexOf('--rollback')

  if (rollbackIndex !== -1) {
    const version = args[rollbackIndex + 1]
    const remainingArgs = [
      ...args.slice(0, rollbackIndex),
      ...args.slice(rollbackIndex + 2),
    ]

    return {
      isRollback: true,
      rollbackVersion: version,
      remainingArgs,
    }
  }

  return {
    isRollback: false,
    remainingArgs: args,
  }
}

/**
 * Build the project before deployment
 */
async function buildProject(spawnFn: SpawnFn, verbose?: boolean): Promise<boolean> {
  if (verbose) {
    console.log('[Build] Building project...')
  } else {
    console.log('Building...')
  }

  try {
    const proc = spawnFn(['bunx', 'wrangler', 'deploy', '--dry-run'], {
      env: process.env,
      stdio: verbose ? ['inherit', 'inherit', 'inherit'] : ['inherit', 'pipe', 'pipe'],
    })

    const exitCode = await proc.exited

    if (exitCode === 0) {
      if (verbose) {
        console.log('[Build] Build completed successfully')
      }
      return true
    } else {
      console.error('Build failed with exit code:', exitCode)
      return false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Check for common errors
    if (message.includes('ENOENT') || message.includes('not found')) {
      console.error('Failed to start wrangler. Please ensure wrangler is installed.')
      console.error('Install with: bun add -D wrangler')
    } else {
      console.error('Build error:', message)
    }

    throw error
  }
}

/**
 * Perform rollback to a previous deployment
 */
async function rollback(
  version: string | undefined,
  spawnFn: SpawnFn,
  env: Record<string, string | undefined>,
  verbose?: boolean
): Promise<RunResult> {
  if (!version) {
    console.error('Rollback version not specified')
    return { exitCode: 1, success: false }
  }

  console.log(`Rolling back to version: ${version}`)

  try {
    // Wrangler uses: wrangler deployments rollback [<deployment-id>|--message <message>]
    const proc = spawnFn(['bunx', 'wrangler', 'deployments', 'rollback', version], {
      env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })

    const exitCode = await proc.exited
    const success = exitCode === 0

    if (success) {
      console.log('Rollback completed successfully')
    } else {
      console.error('Rollback failed with exit code:', exitCode)
    }

    return { exitCode, success }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Rollback error:', message)
    throw error
  }
}

/**
 * Extract deployment URL from wrangler output
 */
function extractDeploymentUrl(output: string): string | undefined {
  // Wrangler outputs: "Published <worker-name> (X.XX sec)"
  // "  https://<worker-name>.<account>.workers.dev"
  const urlMatch = output.match(/https:\/\/[^\s]+\.workers\.dev/)
  return urlMatch?.[0]
}

/**
 * Main deployment function
 */
export async function run(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const spawnFn = options.spawn ?? defaultSpawn
  const verbose = options.verbose ?? false

  // Parse arguments for rollback
  const { isRollback, rollbackVersion, remainingArgs } = parseArgs(args)

  // Authenticate first (unless skipped for testing)
  let token: string
  if (!options.skipAuth) {
    try {
      const result = await ensureLoggedIn({
        openBrowser: true,
        ...(verbose && { print: console.log }),
      })
      token = result.token

      if (result.isNewLogin) {
        console.log('Logged in successfully')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Authentication error:', message)
      throw new Error(`Authentication failed: ${message}`)
    }
  } else {
    token = process.env['DO_TOKEN'] || 'mock-token'
  }

  // Build environment with token
  const env: Record<string, string | undefined> = {
    ...process.env,
    DO_TOKEN: token,
  }

  if (options.apiUrl) {
    env['DO_API_URL'] = options.apiUrl
  }

  // Handle rollback
  if (isRollback) {
    return rollback(rollbackVersion, spawnFn, env, verbose)
  }

  // Build project first (unless --dry-run or --skip-build)
  if (!remainingArgs.includes('--dry-run') && !options.skipBuild) {
    const buildSuccess = await buildProject(spawnFn, verbose)
    if (!buildSuccess) {
      return { exitCode: 1, success: false }
    }
  }

  // Deploy
  console.log('Deploying...')

  let proc: SpawnedProcess
  try {
    proc = spawnFn(['bunx', 'wrangler', 'deploy', ...remainingArgs], {
      env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Check for common errors
    if (message.includes('ENOENT') || message.includes('not found')) {
      console.error('Failed to start wrangler. Please ensure wrangler is installed.')
      console.error('Install with: bun add -D wrangler')
    } else {
      console.error('Failed to start deployment:', message)
    }

    throw error
  }

  const exitCode = await proc.exited
  const success = exitCode === 0

  if (success) {
    console.log('Deployment completed successfully')
  } else {
    console.error('Deployment failed with exit code:', exitCode)
  }

  return { exitCode, success }
}

/**
 * Default spawn function using Bun.spawn
 */
function defaultSpawn(command: string[], options?: SpawnOptions): SpawnedProcess {
  // Check if Bun is available
  if (typeof Bun === 'undefined' || !Bun.spawn) {
    throw new Error('Bun runtime required for spawn. Please run with Bun or provide custom spawn function.')
  }

  // Use Bun.spawn
  const proc = Bun.spawn(command, {
    env: options?.env,
    stdio: options?.stdio || ['inherit', 'inherit', 'inherit'],
    cwd: options?.cwd,
  })

  return {
    pid: proc.pid,
    exited: proc.exited,
    kill: (signal?: number) => proc.kill(signal),
    stdout: proc.stdout,
    stderr: proc.stderr,
  }
}
