/**
 * DO Config Loader
 *
 * Loads do.config.ts from the current directory or specified path.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import type { DO } from '../types/config'

const CONFIG_FILENAME = 'do.config.ts'

/**
 * Get the path to do.config.ts
 */
export function getConfigPath(dir: string = process.cwd()): string {
  return join(dir, CONFIG_FILENAME)
}

/**
 * Check if do.config.ts exists
 */
export function configExists(dir: string = process.cwd()): boolean {
  return existsSync(getConfigPath(dir))
}

/**
 * Load do.config.ts from directory
 * Returns null if no config found
 */
export async function loadConfig(dir: string = process.cwd()): Promise<DO.Config | null> {
  const configPath = getConfigPath(dir)

  if (!existsSync(configPath)) {
    return null
  }

  try {
    // Use Bun's native TypeScript import
    const module = await import(configPath)
    return module.default as DO.Config
  } catch (error) {
    console.error(`Failed to load ${CONFIG_FILENAME}:`, error)
    return null
  }
}

/**
 * Write do.config.ts to directory
 */
export async function writeConfig(config: DO.Config, dir: string = process.cwd()): Promise<void> {
  const configPath = getConfigPath(dir)
  const content = `import type { DO } from 'dotdo'

export default {
  $id: '${config.$id}',${config.env ? `\n  env: '${config.env}',` : ''}
} satisfies DO.Config
`
  await Bun.write(configPath, content)
}
