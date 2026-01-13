/**
 * Start Command
 *
 * Main entry point for local development with `do start`.
 * Combines surface discovery, scaffolding, and runtime into a single command.
 *
 * Usage:
 *   do start                 # Start dev server with defaults
 *   do start -p 5000         # Custom port
 *   do start --no-open       # Don't open browser
 *   do start --tunnel        # Expose via Cloudflare Tunnel
 *   do start --reset         # Clear state and start fresh
 */

import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createAdapter, type RunningInstance } from '../runtime/miniflare-adapter'
import { createLogger } from '../utils/logger'
import { loadConfigAsync } from '../utils/config'
import { parsePort } from '../utils/validation'
import { discoverAll, type DiscoveryResult, type Surface } from '../utils/discover'
import { scaffold } from '../utils/scaffold'
import { startTunnel } from './tunnel'
import { formatSectionHeader, formatUrl } from '../utils/output'

const logger = createLogger('start')

// ============================================================================
// Types
// ============================================================================

export interface StartOptions {
  port: string
  open: boolean
  tunnel: boolean
  reset: boolean
  /** Working directory (for testing) */
  cwd?: string
}

export interface StartResult {
  url: string
  port: number
  surfaces: Record<Surface, string | null>
  instance: RunningInstance
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if the directory has an existing dotdo project.
 * Looks for:
 * - do.config.ts
 * - Any surface file (App.tsx, Admin.tsx, etc.)
 * - .do directory with surface files
 */
export async function hasExistingProject(rootDir: string): Promise<boolean> {
  // Check for do.config.ts
  const configPath = path.join(rootDir, 'do.config.ts')
  if (fs.existsSync(configPath)) {
    return true
  }

  // Check for surface files
  const discovery = await discoverAll(rootDir)

  // If any surface is found, we have an existing project
  for (const surface of Object.values(discovery.surfaces)) {
    if (surface !== null) {
      return true
    }
  }

  return false
}

/**
 * Print URLs for discovered surfaces
 */
export function printSurfaceUrls(port: number, surfaces: Record<Surface, string | null>): void {
  const baseUrl = `http://localhost:${port}`

  console.log(formatSectionHeader('Surfaces'))

  // App is the root
  if (surfaces.App) {
    console.log(formatUrl('App:', baseUrl))
  }

  // Other surfaces have their own paths
  const surfaceRoutes: Record<Exclude<Surface, 'App'>, string> = {
    Admin: '/admin',
    Site: '/site',
    Docs: '/docs',
    Blog: '/blog',
  }

  for (const [surface, route] of Object.entries(surfaceRoutes) as [Exclude<Surface, 'App'>, string][]) {
    const configured = surfaces[surface] !== null
    console.log(formatUrl(surface, `${baseUrl}${route}`, configured))
  }
}

/**
 * Clear state directory for --reset flag
 */
function clearState(rootDir: string): void {
  const stateDir = path.join(rootDir, '.do', 'state')

  if (fs.existsSync(stateDir)) {
    // Remove all files in state directory
    const files = fs.readdirSync(stateDir)
    for (const file of files) {
      fs.unlinkSync(path.join(stateDir, file))
    }
    logger.info('Cleared state directory')
  }
}

// ============================================================================
// Main Action
// ============================================================================

/**
 * Main start action - exported for testing
 */
export async function startAction(options: StartOptions): Promise<StartResult> {
  const rootDir = options.cwd ?? process.cwd()
  const port = parsePort(options.port)

  // Handle --reset flag
  if (options.reset) {
    clearState(rootDir)
  }

  // Check for existing project
  const hasProject = await hasExistingProject(rootDir)

  if (!hasProject) {
    logger.info('No project found. Scaffolding new project...')

    // Scaffold default files
    const result = await scaffold({
      targetDir: rootDir,
      skipConfig: false,
      skipApp: false,
    })

    if (result.created.length > 0) {
      logger.success(`Created: ${result.created.join(', ')}`)
    }
  }

  // Discover surfaces
  const discovery = await discoverAll(rootDir)

  // Load config (pass logger for debug logging of parse errors)
  const config = await loadConfigAsync(rootDir, logger)

  // Create miniflare adapter with state persistence
  const stateDir = path.join(rootDir, '.do', 'state')
  const adapter = createAdapter({
    logger,
    config,
    persist: stateDir,
  })

  // Start the runtime
  logger.info('Starting development server...')

  const instance = await adapter.start({
    port,
    host: 'localhost',
  })

  // Print URLs
  console.log()
  console.log(`  Local:    ${instance.url}`)

  // Print surface URLs
  printSurfaceUrls(port, discovery.surfaces)

  // Handle tunnel
  if (options.tunnel) {
    try {
      const tunnelUrl = await startTunnel({
        port,
        logger,
      })
      console.log()
      console.log(`  Tunnel:   ${tunnelUrl}`)
    } catch (error) {
      logger.warn('Failed to start tunnel', { error: String(error) })
    }
  }

  console.log()
  console.log('  Press Ctrl+C to stop')
  console.log()

  // Open browser (unless --no-open)
  if (options.open) {
    try {
      const open = await import('open')
      await open.default(instance.url)
    } catch {
      // Ignore open errors
    }
  }

  return {
    url: instance.url,
    port: instance.port,
    surfaces: discovery.surfaces,
    instance,
  }
}

// ============================================================================
// Command Definition
// ============================================================================

export const startCommand = new Command('start')
  .description('Start local development server')
  .option('-p, --port <port>', 'Port to listen on', '4000')
  .option('--no-open', 'Do not open browser')
  .option('--tunnel', 'Expose via Cloudflare Tunnel')
  .option('--reset', 'Clear state and start fresh')
  .action(async (options) => {
    try {
      const result = await startAction(options as StartOptions)

      // Handle shutdown
      const shutdown = async () => {
        console.log('\nShutting down...')
        await result.instance.stop()
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)

      // Keep process alive
      await new Promise(() => {})
    } catch (error) {
      logger.error('Failed to start', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    }
  })

export default startCommand
