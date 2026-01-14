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
    // Pass logger for debug logging of parse errors
    const config = await loadConfigAsync(undefined, logger)

    const port = parsePort(options.port)
    const host = options.host

    logger.info(`Starting development server...`)
    logger.debug('Options:', { port, host, tunnel: options.tunnel, persist: options.persist })

    // Create Miniflare adapter
    const adapter = createAdapter({
      logger,
      config,
      persist: options.persist === false ? false : options.persist ?? config.persist,
    })

    try {
      // Start the runtime
      const instance = await adapter.start({
        port,
        host,
        live: options.liveReload,
      })

      console.log()
      console.log(`  Local:   ${instance.url}`)

      // Start tunnel if requested
      if (options.tunnel) {
        const tunnelUrl = await startTunnel({
          port,
          name: options.tunnelName,
          logger,
        })
        console.log(`  Tunnel:  ${tunnelUrl}`)
      }

      console.log()
      console.log('  Press Ctrl+C to stop')
      console.log()

      // Handle shutdown
      const shutdown = async () => {
        console.log('\nShutting down...')
        await instance.stop()
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
