/**
 * Config Set Command - do-tqkb
 *
 * Set configuration values in .dotdo.json.
 * Supports nested keys and type coercion.
 */

import { resolve, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { DotdoConfig } from '../cli'

export const name = 'config-set'
export const description = 'Set a configuration value'

export interface ConfigSetOptions {
  /** Configuration key (supports dot notation for nested keys) */
  key: string
  /** Value to set */
  value: string
  /** Global config (~/.dotdo/config.json) instead of local */
  global?: boolean
  /** Enable verbose output */
  verbose?: boolean
}

export interface ConfigSetResult {
  success: boolean
  key: string
  value: unknown
  path: string
}

/**
 * Get the config file path
 */
function getConfigPath(global: boolean = false): string {
  if (global) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~'
    return resolve(homeDir, '.dotdo', 'config.json')
  }

  // Local config in current directory
  return resolve(process.cwd(), '.dotdo.json')
}

/**
 * Parse a value string to the appropriate type
 */
function parseValue(value: string): unknown {
  // Try to parse as JSON first (handles arrays, objects, booleans, numbers)
  try {
    return JSON.parse(value)
  } catch {
    // Not valid JSON, treat as string
  }

  // Check for boolean strings
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false

  // Check for null
  if (value.toLowerCase() === 'null') return null

  // Check for numbers
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value)

  // Return as string
  return value
}

/**
 * Set a nested key in an object using dot notation
 */
function setNestedKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]

    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }

    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}

/**
 * Load existing config or return empty object
 */
function loadConfig(path: string): DotdoConfig {
  if (!existsSync(path)) {
    return {}
  }

  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Save config to file
 */
function saveConfig(path: string, config: DotdoConfig): void {
  // Ensure directory exists
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
}

/**
 * Main config set command function
 */
export async function configSet(options: ConfigSetOptions): Promise<ConfigSetResult> {
  const { key, value, global = false, verbose = false } = options

  if (verbose) {
    console.log('[config set] Options:', options)
  }

  // Get config path
  const configPath = getConfigPath(global)

  if (verbose) {
    console.log(`[config set] Config path: ${configPath}`)
  }

  // Load existing config
  const config = loadConfig(configPath)

  // Parse and set value
  const parsedValue = parseValue(value)

  if (verbose) {
    console.log(`[config set] Parsed value:`, parsedValue, `(type: ${typeof parsedValue})`)
  }

  // Set the key (supports dot notation)
  setNestedKey(config as Record<string, unknown>, key, parsedValue)

  // Save config
  saveConfig(configPath, config)

  // Output
  console.log('')
  console.log(`  \x1b[32mSet ${key} = ${JSON.stringify(parsedValue)}\x1b[0m`)
  console.log(`  \x1b[2mSaved to: ${configPath}\x1b[0m`)
  console.log('')

  return {
    success: true,
    key,
    value: parsedValue,
    path: configPath,
  }
}

/**
 * CLI command handler
 */
export function configSetCommand(
  key: string,
  value: string,
  options: Omit<ConfigSetOptions, 'key' | 'value'> = {}
): Promise<ConfigSetResult> {
  return configSet({ key, value, ...options })
}
