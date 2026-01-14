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
