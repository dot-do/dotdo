/**
 * Tunnel Command
 *
 * Exposes local development server via Cloudflare Tunnel.
 * Supports both quick tunnels (temporary) and named tunnels (persistent).
 */

import { Command } from 'commander'
import { createLogger, type Logger } from '../utils/logger'
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const logger = createLogger('tunnel')

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
    // Local .dotdo directory
    path.join(process.cwd(), '.dotdo', 'bin', 'cloudflared'),
    path.join(os.homedir(), '.dotdo', 'bin', 'cloudflared'),
  ]

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc
    }
  }

  // Try to find in PATH
  try {
    const { execSync } = await import('child_process')
    const result = execSync('which cloudflared', { encoding: 'utf-8' }).trim()
    if (result) return result
  } catch {
    // Not in PATH
  }

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

  const binDir = path.join(os.homedir(), '.dotdo', 'bin')
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
    // For simplicity, we'll use tar command
    const tempPath = path.join(binDir, 'cloudflared.tgz')
    fs.writeFileSync(tempPath, Buffer.from(buffer))

    const { execSync } = await import('child_process')
    execSync(`tar -xzf "${tempPath}" -C "${binDir}"`, { stdio: 'ignore' })
    fs.unlinkSync(tempPath)
  } else {
    fs.writeFileSync(binaryPath, Buffer.from(buffer))
    fs.chmodSync(binaryPath, 0o755)
  }

  logger.success('cloudflared installed')
  return binaryPath
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

    const proc = spawn(cloudflared, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let tunnelUrl: string | null = null

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      log.debug('cloudflared stdout:', output)

      // Parse tunnel URL from output
      const urlMatch = output.match(/https:\/\/[^\s]+\.trycloudflare\.com/)
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0]
        resolve(tunnelUrl)
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString()
      log.debug('cloudflared stderr:', output)

      // Also check stderr for URL (cloudflared logs there)
      const urlMatch = output.match(/https:\/\/[^\s]+\.trycloudflare\.com/)
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0]
        resolve(tunnelUrl)
      }
    })

    proc.on('error', (error) => {
      log.error('Tunnel error:', { error: error.message })
      reject(error)
    })

    proc.on('exit', (code) => {
      if (!tunnelUrl) {
        reject(new Error(`cloudflared exited with code ${code}`))
      }
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!tunnelUrl) {
        proc.kill()
        reject(new Error('Timeout waiting for tunnel URL'))
      }
    }, 30000)
  })
}

export const tunnelCommand = new Command('tunnel')
  .description('Expose local server via Cloudflare Tunnel')
  .option('-p, --port <port>', 'Local port to expose', '8787')
  .option('-n, --name <name>', 'Tunnel name (requires auth)')
  .option('-c, --config <path>', 'Path to tunnel config file')
  .action(async (options) => {
    const port = parseInt(options.port, 10)

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
