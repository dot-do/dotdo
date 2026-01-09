/**
 * Dev Command
 *
 * Starts local development server using wrangler dev.
 * Authenticates via oauth.do and passes DO_TOKEN to the spawned process.
 */

import { ensureLoggedIn } from 'oauth.do/node'

export const name = 'dev'
export const description = 'Start local development server'

interface SpawnOptions {
  env?: Record<string, string | undefined>
  stdio?: ['inherit' | 'pipe', 'inherit' | 'pipe', 'inherit' | 'pipe'] | 'inherit'
  cwd?: string
}

interface SpawnedProcess {
  pid: number
  exited: Promise<number>
  kill: (signal?: number) => void
  stdout?: ReadableStream<Uint8Array>
  stderr?: ReadableStream<Uint8Array>
}

type SpawnFn = (command: string[], options?: SpawnOptions) => SpawnedProcess

interface RunOptions {
  spawn?: SpawnFn
  apiUrl?: string
}

interface RunResult {
  exitCode: number
}

export async function run(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const spawnFn = options.spawn ?? defaultSpawn

  // Authenticate first
  let token: string
  try {
    const result = await ensureLoggedIn({
      openBrowser: true,
      print: console.log,
    })
    token = result.token

    if (result.isNewLogin) {
      console.log('Logged in successfully')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('network')) {
      console.error('Network connection error. Please check your internet connection.')
    } else {
      console.error('Authentication error:', message)
    }
    throw new Error(`Authentication failed: ${message}`)
  }

  console.log('Starting dev server...')

  // Build environment with token
  const env: Record<string, string | undefined> = {
    ...process.env,
    DO_TOKEN: token,
  }

  if (options.apiUrl) {
    env.DO_API_URL = options.apiUrl
  }

  // Spawn wrangler dev
  let proc: SpawnedProcess
  try {
    proc = spawnFn(['bunx', 'wrangler', 'dev', ...args], {
      env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to start wrangler. Please ensure wrangler is installed.')
    throw error
  }

  const exitCode = await proc.exited
  return { exitCode }
}

function defaultSpawn(command: string[], options?: SpawnOptions): SpawnedProcess {
  // This will be replaced by Bun.spawn in production
  throw new Error('No spawn function provided')
}
