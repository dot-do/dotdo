/**
 * Connect Command
 *
 * Links current folder to a DO by creating do.config.ts
 */

import { Command } from 'commander'
import * as React from 'react'
import { render } from 'ink'
import { ensureLoggedIn } from 'oauth.do/node'
import { writeConfig, configExists } from '../utils/do-config'
import { generateTypes } from './generate'
import { createLogger } from '../utils/logger'
import { WorkerPicker } from '../ink/WorkerPicker'
import { WorkersDoClient, type Worker } from '../services/workers-do'
import type { DO } from '../types/config'

const logger = createLogger('connect')

export interface ConnectOptions {
  $id: string
  dir?: string
  skipTypes?: boolean
  force?: boolean
}

/**
 * Validate that $id is a valid URL
 */
function isValidUrl($id: string): boolean {
  try {
    new URL($id)
    return true
  } catch {
    return false
  }
}

/**
 * Connect folder to a DO
 */
export async function connectToDO(options: ConnectOptions): Promise<void> {
  const { $id, dir = process.cwd(), skipTypes = false, force = false } = options

  // Validate URL
  if (!isValidUrl($id)) {
    throw new Error(`Invalid DO URL: ${$id}. Must be a valid URL like https://example.com`)
  }

  // Check for existing config
  if (configExists(dir) && !force) {
    logger.warn('do.config.ts already exists. Use --force to overwrite.')
    return
  }

  // Create config
  try {
    const config: DO.Config = { $id }
    await writeConfig(config, dir)
    logger.success(`Connected to ${$id}`)
  } catch (error) {
    logger.error(`Failed to write config: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  // Generate types
  if (!skipTypes) {
    try {
      await generateTypes({ $id, outputDir: dir, mockTypes: true })
    } catch (error) {
      logger.warn(`Config created but type generation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * Commander command for 'dotdo connect'
 */
export const connectCommand = new Command('connect')
  .description('Connect current folder to a DO')
  .argument('[url]', 'DO URL to connect to')
  .option('-f, --force', 'Overwrite existing config')
  .option('--no-types', 'Skip type generation')
  .action(async (url, options) => {
    let $id = url

    if (!$id) {
      // Interactive picker using workers.do
      logger.info('No URL provided. Fetching your workers...')

      let token: string
      try {
        const auth = await ensureLoggedIn({
          openBrowser: true,
          print: console.log,
        })
        token = auth.token
      } catch (error) {
        logger.error('Authentication failed. Run "dotdo login" first.')
        process.exit(1)
      }

      const client = new WorkersDoClient(token)
      const workers = await client.list({ sortBy: 'accessed', limit: 10 })

      if (workers.length === 0) {
        logger.error('No workers found. Deploy a DO first.')
        process.exit(1)
      }

      // Interactive selection with Ink
      const selected = await new Promise<Worker | null>((resolve) => {
        const { unmount } = render(
          React.createElement(WorkerPicker, {
            workers,
            onSelect: (w: Worker) => { unmount(); resolve(w) },
            onCancel: () => { unmount(); resolve(null) }
          })
        )
      })

      if (!selected) {
        logger.info('Cancelled')
        process.exit(0)
      }

      $id = selected.url
      logger.info(`Selected: ${selected.name || selected.url}`)
    }

    await connectToDO({
      $id,
      force: options.force,
      skipTypes: !options.types
    })
  })

export default connectCommand
