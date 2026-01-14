/**
 * Connect Command
 *
 * Links current folder to a DO by creating do.config.ts
 */

import { Command } from 'commander'
import { writeConfig, configExists } from '../utils/do-config'
import { generateTypes } from './generate'
import { createLogger } from '../utils/logger'
import type { DO } from '../types/config'

const logger = createLogger('connect')

export interface ConnectOptions {
  $id: string
  dir?: string
  skipTypes?: boolean
  force?: boolean
}

/**
 * Connect folder to a DO
 */
export async function connectToDO(options: ConnectOptions): Promise<void> {
  const { $id, dir = process.cwd(), skipTypes = false, force = false } = options

  // Check for existing config
  if (configExists(dir) && !force) {
    logger.warn('do.config.ts already exists. Use --force to overwrite.')
    return
  }

  // Create config
  const config: DO.Config = { $id }
  await writeConfig(config, dir)
  logger.success(`Connected to ${$id}`)

  // Generate types
  if (!skipTypes) {
    await generateTypes({ $id, outputDir: dir, mockTypes: true })
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
    if (!url) {
      // TODO: Interactive picker using workers.do
      logger.error('Please provide a DO URL: dotdo connect <url>')
      process.exit(1)
    }

    await connectToDO({
      $id: url,
      force: options.force,
      skipTypes: !options.types
    })
  })

export default connectCommand
