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

import { getStoredToken, login, type StoredToken } from './login'
import { createProgress } from '../utils/progress'

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
  /**
   * Skip authentication check. ONLY for unit testing with mocked spawn.
   * This allows tests to run without requiring OAuth flow.
   * NEVER use in production code paths.
   */
  skipAuth?: boolean
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
 * Known mock/test token patterns that should be rejected in production
 */
const MOCK_TOKEN_PATTERNS = [
  'mock-token',
  'test-token',
  'fake-token',
  'mock-token-for-development',
]

/**
 * Check if a token looks like a mock/test token
 */
function isMockToken(token: string): boolean {
  const lowerToken = token.toLowerCase()
  return MOCK_TOKEN_PATTERNS.some(pattern => lowerToken.includes(pattern))
}

/**
 * Check if a stored token is expired
 */
function isTokenExpired(token: StoredToken): boolean {
  if (!token.expires_at) {
    return false
  }
  return token.expires_at < Date.now()
}

/**
 * Ensure user is logged in with a valid token
 * Uses real OAuth flow via login.ts
 */
async function ensureLoggedIn(options: {
  openBrowser?: boolean
  print?: (message: string) => void
}): Promise<AuthResult> {
  // First, check for DO_TOKEN environment variable (CI/CD use case)
  const envToken = process.env['DO_TOKEN']
  if (envToken) {
    // Reject mock tokens in production deployments
    if (isMockToken(envToken)) {
      throw new Error(
        'Mock tokens cannot be used for deployment. Please set a valid DO_TOKEN or run `dotdo login`.'
      )
    }
    if (options.print) {
      options.print('[Auth] Using token from DO_TOKEN environment variable')
    }
    return {
      token: envToken,
      isNewLogin: false,
    }
  }

  // Check for stored token from previous login
  const storedToken = await getStoredToken()

  if (storedToken) {
    // Validate the stored token
    if (isMockToken(storedToken.access_token)) {
      throw new Error(
        'Stored token appears to be a mock token. Please run `dotdo login` to authenticate.'
      )
    }

    // Check if token is expired
    if (isTokenExpired(storedToken)) {
      if (options.print) {
        options.print('[Auth] Stored token is expired, initiating login flow...')
      }
      // Fall through to trigger login
    } else {
      if (options.print) {
        options.print('[Auth] Using stored token from previous login')
      }
      return {
        token: storedToken.access_token,
        isNewLogin: false,
      }
    }
  }

  // No valid token found, trigger OAuth login flow
  if (options.print) {
    options.print('[Auth] No valid token found, initiating OAuth login flow...')
  }

  await login({ noBrowser: !options.openBrowser })

  // Get the newly stored token
  const newToken = await getStoredToken()
  if (!newToken) {
    throw new Error('Login completed but no token was stored. Please try again.')
  }

  // Final validation - ensure we didn't somehow get a mock token
  if (isMockToken(newToken.access_token)) {
    throw new Error(
      'Authentication returned an invalid token. Please contact support.'
    )
  }

  return {
    token: newToken.access_token,
    isNewLogin: true,
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
  const progress = createProgress()
  progress.start('Building project...')

  try {
    const proc = spawnFn(['bunx', 'wrangler', 'deploy', '--dry-run'], {
      env: process.env,
      stdio: verbose ? ['inherit', 'inherit', 'inherit'] : ['inherit', 'pipe', 'pipe'],
    })

    const exitCode = await proc.exited

    if (exitCode === 0) {
      progress.succeed('Build completed')
      return true
    } else {
      progress.fail('Build failed')
      console.error('Build failed with exit code:', exitCode)
      return false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    progress.fail('Build failed')

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

  const progress = createProgress()
  progress.start(`Rolling back to version: ${version}...`)

  try {
    // Wrangler uses: wrangler deployments rollback [<deployment-id>|--message <message>]
    const proc = spawnFn(['bunx', 'wrangler', 'deployments', 'rollback', version], {
      env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })

    const exitCode = await proc.exited
    const success = exitCode === 0

    if (success) {
      progress.succeed('Rollback completed')
    } else {
      progress.fail('Rollback failed')
      console.error('Rollback failed with exit code:', exitCode)
    }

    return { exitCode, success }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    progress.fail('Rollback failed')
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
    // skipAuth is only for unit testing with mocked spawn functions
    // Still require a valid DO_TOKEN environment variable
    const envToken = process.env['DO_TOKEN']
    if (!envToken) {
      throw new Error(
        'DO_TOKEN environment variable is required when skipAuth is enabled. ' +
        'This option is only for unit testing.'
      )
    }
    // Reject mock tokens even in test mode to prevent accidental deployment
    if (isMockToken(envToken)) {
      throw new Error(
        'Mock tokens cannot be used for deployment, even in test mode. ' +
        'Use a valid token or ensure your test properly mocks the spawn function.'
      )
    }
    token = envToken
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
  const progress = createProgress()
  progress.start('Deploying to Cloudflare Workers...')

  let proc: SpawnedProcess
  try {
    proc = spawnFn(['bunx', 'wrangler', 'deploy', ...remainingArgs], {
      env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    progress.fail('Deployment failed')

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
    progress.succeed('Deployment completed successfully')
  } else {
    progress.fail('Deployment failed')
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
