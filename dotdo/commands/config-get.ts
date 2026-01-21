/**
 * Config Get Command - do-jrz6
 *
 * Get configuration values from .dotdo.json.
 * Supports nested keys using dot notation.
 */

import { resolve, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { DotdoConfig } from '../cli'

export const name = 'config-get'
export const description = 'Get a configuration value'

export interface ConfigGetOptions {
  /** Configuration key (supports dot notation for nested keys) */
  key?: string
  /** Global config (~/.dotdo/config.json) instead of local */
  global?: boolean
  /** Enable verbose output */
  verbose?: boolean
}

export interface ConfigGetResult {
  success: boolean
  key?: string
  value: unknown
  path: string
  found: boolean
}

/**
 * Get the config file path
 */
function getConfigPath(global: boolean = false): string {
  if (global) {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '~'
    return resolve(homeDir, '.dotdo', 'config.json')
  }

  // Local config in current directory
  return resolve(process.cwd(), '.dotdo.json')
}

/**
 * Get a nested key from an object using dot notation
 */
function getNestedKey(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (!part) continue

    if (current === null || current === undefined) {
      return undefined
    }

    if (typeof current !== 'object') {
      return undefined
    }

    current = (current as Record<string, unknown>)[part]
  }

  return current
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
 * Main config get command function
 */
export async function configGet(options: ConfigGetOptions = {}): Promise<ConfigGetResult> {
  const { key, global = false, verbose = false } = options

  if (verbose) {
    console.log('[config get] Options:', options)
  }

  // Get config path
  const configPath = getConfigPath(global)

  if (verbose) {
    console.log(`[config get] Config path: ${configPath}`)
  }

  // Load config
  const config = loadConfig(configPath)

  if (verbose) {
    console.log(`[config get] Loaded config:`, config)
  }

  // If no key specified, return all config
  if (!key) {
    console.log(JSON.stringify(config, null, 2))

    return {
      success: true,
      value: config,
      path: configPath,
      found: true,
    }
  }

  // Get the specific key (supports dot notation)
  const value = getNestedKey(config as Record<string, unknown>, key)
  const found = value !== undefined

  if (found) {
    // Output the value
    if (typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2))
    } else {
      console.log(value)
    }
  } else {
    console.error(`Configuration key not found: ${key}`)
  }

  return {
    success: found,
    key,
    value,
    path: configPath,
    found,
  }
}

/**
 * CLI command handler
 */
export function configGetCommand(
  key?: string,
  options: Omit<ConfigGetOptions, 'key'> = {}
): Promise<ConfigGetResult> {
  return configGet({ key, ...options })
}
