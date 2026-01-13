/**
 * Tunnel Command
 *
 * Exposes local development server via Cloudflare Tunnel.
 * Supports both quick tunnels (temporary) and named tunnels (persistent).
 */

import { Command } from 'commander'
import { createLogger, type Logger } from '../utils/logger'
import { parsePort } from '../utils/validation'
import { getHomeBinDir, getLocalBinDir, DOTDO_BIN_SUBDIR } from '../utils/paths'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Find an executable in PATH (cross-platform, no shell execution)
 * @param name - The executable name to find
 * @returns The full path to the executable, or null if not found
 */
export function findExecutable(name: string): string | null {
  const pathDirs = process.env.PATH?.split(path.delimiter) || []
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']

  for (const dir of pathDirs) {
    if (!dir) continue
    for (const ext of extensions) {
      const fullPath = path.join(dir, name + ext)
      try {
        fs.accessSync(fullPath, fs.constants.X_OK)
        return fullPath
      } catch {
        // Not found or not executable
      }
    }
  }
  return null
}

/**
 * Extract a tarball safely using spawnSync with array arguments
 * (prevents command injection vulnerabilities)
 * @param tarPath - Path to the .tgz file
 * @param destDir - Destination directory for extraction
 */
export function extractTarball(tarPath: string, destDir: string): void {
  const result = spawnSync('tar', ['-xzf', tarPath, '-C', destDir], {
    stdio: 'ignore',
  })

  if (result.status !== 0) {
    throw new Error(`Failed to extract cloudflared: exit code ${result.status}`)
  }
}

const logger = createLogger('tunnel')

/** Timeout waiting for tunnel URL (30 seconds) */
export const TUNNEL_TIMEOUT_MS = 30000

/** Delay before sending SIGKILL after SIGTERM (5 seconds) */
export const SIGKILL_DELAY_MS = 5000

export interface TunnelOptions {
  port: number
  name?: string
  configPath?: string
  logger?: Logger
}

export interface TunnelResult {
  url: string
  stop: () => void
}

/**
 * Dependencies for startTunnelWithDeps (for testing)
 */
export interface TunnelDeps {
  spawn: typeof spawn
  findCloudflared: () => Promise<string | null>
}

/**
 * Find cloudflared binary
 */
async function findCloudflared(): Promise<string | null> {
  // Check common locations
  const locations = [
    // Global install
    '/usr/local/bin/cloudflared',
    '/opt/homebrew/bin/cloudflared',
    // Windows
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    // Local .do directory
    path.join(getLocalBinDir(), 'cloudflared'),
    path.join(getHomeBinDir(), 'cloudflared'),
  ]

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc
    }
  }

  // Try to find in PATH using cross-platform findExecutable (no shell execution)
  const inPath = findExecutable('cloudflared')
  if (inPath) return inPath

  return null
}

/**
 * Download cloudflared if not installed
 */
async function downloadCloudflared(): Promise<string> {
  const platform = process.platform
  const arch = process.arch

  let downloadUrl: string
  let binaryName = 'cloudflared'

  if (platform === 'darwin') {
    downloadUrl = arch === 'arm64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz'
  } else if (platform === 'linux') {
    downloadUrl = arch === 'arm64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
  } else if (platform === 'win32') {
    downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    binaryName = 'cloudflared.exe'
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const binDir = getHomeBinDir()
  const binaryPath = path.join(binDir, binaryName)

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  logger.info('Downloading cloudflared...')

  // Download using fetch
  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download cloudflared: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()

  // Handle tarball on macOS
  if (downloadUrl.endsWith('.tgz')) {
    // Use safe extraction with spawnSync (prevents command injection)
    const tempPath = path.join(binDir, 'cloudflared.tgz')
    fs.writeFileSync(tempPath, Buffer.from(buffer))

    extractTarball(tempPath, binDir)
    fs.unlinkSync(tempPath)
  } else {
    fs.writeFileSync(binaryPath, Buffer.from(buffer))
    fs.chmodSync(binaryPath, 0o755)
  }

  logger.success('cloudflared installed')
  return binaryPath
}

/**
 * Start a Cloudflare Tunnel with injectable dependencies (for testing)
 */
export async function startTunnelWithDeps(
  options: TunnelOptions,
  deps: TunnelDeps
): Promise<string> {
  const log = options.logger ?? logger

  // Find cloudflared using injected dependency
  const cloudflared = await deps.findCloudflared()
  if (!cloudflared) {
    throw new Error('cloudflared not found')
  }

  return new Promise((resolve, reject) => {
    const args: string[] = ['tunnel']

    if (options.name) {
      // Named tunnel (requires auth)
      args.push('--name', options.name)
      args.push('run')
    } else {
      // Quick tunnel (no auth required)
      args.push('--url', `http://localhost:${options.port}`)
    }

    if (options.configPath) {
      args.push('--config', options.configPath)
    }

    log.debug('Starting tunnel:', { cloudflared, args })

    const proc = deps.spawn(cloudflared, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let tunnelUrl: string | null = null
    let settled = false

    // Helper to ensure promise resolves/rejects exactly once
    const safeResolve = (url: string) => {
      if (!settled) {
        settled = true
        clearTimeout(timeoutId)
        resolve(url)
      }
    }

    const safeReject = (error: Error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeoutId)
        reject(error)
      }
    }

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      log.debug('cloudflared stdout:', { output })

      // Parse tunnel URL from output
      const urlMatch = output.match(/https:\/\/[^\s]+\.trycloudflare\.com/)
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0]
        safeResolve(tunnelUrl)
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString()
      log.debug('cloudflared stderr:', { output })

      // Also check stderr for URL (cloudflared logs there)
      const urlMatch = output.match(/https:\/\/[^\s]+\.trycloudflare\.com/)
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0]
        safeResolve(tunnelUrl)
      }
    })

    proc.on('error', (error) => {
      log.error('Tunnel error:', { error: error.message })
      safeReject(error)
    })

    proc.on('exit', (code) => {
      if (!tunnelUrl) {
        safeReject(new Error(`cloudflared exited with code ${code}`))
      }
    })

    // Timeout with graceful shutdown (SIGTERM then SIGKILL)
    const timeoutId = setTimeout(() => {
      if (!tunnelUrl) {
        // Try graceful shutdown first
        proc.kill('SIGTERM')

        // Force kill after SIGKILL_DELAY_MS if still running
        setTimeout(() => {
          try {
            proc.kill('SIGKILL')
          } catch {
            // Process already exited
          }
        }, SIGKILL_DELAY_MS)

        safeReject(
          new Error(`Timeout waiting for tunnel URL after ${TUNNEL_TIMEOUT_MS}ms`)
        )
      }
    }, TUNNEL_TIMEOUT_MS)
  })
}

/**
 * Start a Cloudflare Tunnel
 */
export async function startTunnel(options: TunnelOptions): Promise<string> {
  const log = options.logger ?? logger

  // Find or download cloudflared
  let cloudflared = await findCloudflared()
  if (!cloudflared) {
    cloudflared = await downloadCloudflared()
  }

  return startTunnelWithDeps(options, {
    spawn,
    findCloudflared: async () => cloudflared,
  })
}

export const tunnelCommand = new Command('tunnel')
  .description('Expose local server via Cloudflare Tunnel')
  .option('-p, --port <port>', 'Local port to expose', '8787')
  .option('-n, --name <name>', 'Tunnel name (requires auth)')
  .option('-c, --config <path>', 'Path to tunnel config file')
  .action(async (options) => {
    const port = parsePort(options.port)

    logger.info(`Starting tunnel for localhost:${port}...`)

    try {
      const url = await startTunnel({
        port,
        name: options.name,
        configPath: options.config,
      })

      console.log()
      console.log('Tunnel is running!')
      console.log()
      console.log(`  Local:  http://localhost:${port}`)
      console.log(`  Public: ${url}`)
      console.log()
      console.log('Press Ctrl+C to stop')

      // Keep process alive
      await new Promise(() => {})
    } catch (error) {
      logger.error('Failed to start tunnel', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    }
  })

export default tunnelCommand
