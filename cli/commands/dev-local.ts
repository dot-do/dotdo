/**
 * Dev Command
 *
 * Starts local development server with embedded DO runtime.
 * Uses Miniflare for full Durable Object support locally.
 */

import { Command } from 'commander'
import { createAdapter } from '../runtime/miniflare-adapter'
import { createLogger } from '../utils/logger'
import { loadConfigAsync } from '../utils/config'
import { parsePort } from '../utils/validation'
import { startTunnel } from './tunnel'
import { spin, isInteractive, formatElapsed, createStopwatch } from '../utils/spinner'

const logger = createLogger('dev')

export const devCommand = new Command('dev')
  .description('Start local development runtime')
  .option('-p, --port <port>', 'Port to listen on', '8787')
  .option('--host <host>', 'Host to bind to', 'localhost')
  .option('--tunnel', 'Expose via Cloudflare Tunnel')
  .option('--tunnel-name <name>', 'Custom tunnel name')
  .option('--no-persist', 'Disable state persistence')
  .option('--persist <path>', 'Custom persistence path')
  .option('--inspect', 'Enable V8 inspector')
  .option('--live-reload', 'Enable live reload on file changes', true)
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const interactive = isInteractive()
    const stopwatch = createStopwatch()

    // Pass logger for debug logging of parse errors
    const configSpinner = interactive ? spin('Loading configuration...') : null
    const config = await loadConfigAsync(undefined, logger)
    configSpinner?.succeed('Configuration loaded')

    const port = parsePort(options.port)
    const host = options.host

    logger.debug('Options:', { port, host, tunnel: options.tunnel, persist: options.persist })

    // Create Miniflare adapter
    const adapter = createAdapter({
      logger,
      config,
      persist: options.persist === false ? false : options.persist ?? config.persist,
    })

    try {
      // Start the runtime with spinner
      const runtimeSpinner = interactive ? spin('Starting Miniflare runtime...', { style: 'dots' }) : null

      const instance = await adapter.start({
        port,
        host,
        live: options.liveReload,
      })

      runtimeSpinner?.succeed(`Development server started`)

      // Start tunnel if requested
      let tunnelUrl: string | undefined
      if (options.tunnel) {
        const tunnelSpinner = interactive ? spin('Setting up Cloudflare Tunnel...') : null
        tunnelUrl = await startTunnel({
          port,
          name: options.tunnelName,
          logger,
        })
        tunnelSpinner?.succeed('Tunnel connected')
      }

      // Print server info
      console.log()
      console.log(`  Server ready in ${stopwatch.formatted()}`)
      console.log()
      console.log(`  Local:   ${instance.url}`)
      if (tunnelUrl) {
        console.log(`  Tunnel:  ${tunnelUrl}`)
      }
      console.log()
      console.log('  Press Ctrl+C to stop')
      console.log()

      // Handle shutdown
      const shutdown = async () => {
        const shutdownSpinner = interactive ? spin('Shutting down...') : null
        if (!interactive) console.log('\nShutting down...')

        try {
          await instance.stop()
          shutdownSpinner?.succeed('Server stopped')
        } catch {
          shutdownSpinner?.fail('Error during shutdown')
        }
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)

      // Keep process alive
      await new Promise(() => {})
    } catch (error) {
      logger.error('Failed to start dev server', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    }
  })

export default devCommand
