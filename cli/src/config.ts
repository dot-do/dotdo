/**
 * CLI Configuration Management
 *
 * Manages configuration stored in ~/.dotdo/config
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR_NAME = '.dotdo'
const CONFIG_FILE_NAME = 'config'

// ============================================================================
// Types
// ============================================================================

export interface Config {
  /** Base API URL for rpc.do gateway */
  api_url: string
  /** Output JSON instead of human-readable format */
  json_output: boolean
  /** Default LLM model */
  default_model?: string
  /** Default sender for calls/texts */
  default_from?: string
  /** Default email sender */
  default_email_from?: string
  /** Default currency for charges */
  default_currency?: string
  /** Custom headers to include in all requests */
  custom_headers?: Record<string, string>
}

/** Available config keys for validation */
export const configKeys = [
  'api_url',
  'json_output',
  'default_model',
  'default_from',
  'default_email_from',
  'default_currency',
  'custom_headers',
] as const

export type ConfigKey = (typeof configKeys)[number]

// ============================================================================
// Default Configuration
// ============================================================================

export const defaultConfig: Config = {
  api_url: 'https://rpc.do',
  json_output: false,
}

// ============================================================================
// Paths
// ============================================================================

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME)
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE_NAME)
}

// ============================================================================
// Config Operations
// ============================================================================

/**
 * Read stored configuration, merging with defaults
 */
export async function getConfig(): Promise<Config> {
  const configPath = getConfigPath()

  try {
    const content = await readFile(configPath, 'utf-8')
    const stored = JSON.parse(content)

    // Merge stored config with defaults
    return {
      ...defaultConfig,
      ...stored,
    }
  } catch (error: unknown) {
    // File doesn't exist or is malformed - return defaults
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { ...defaultConfig }
    }
    // JSON parse error - return defaults
    return { ...defaultConfig }
  }
}

/**
 * Update configuration values
 */
export async function setConfig(updates: Partial<Config>): Promise<void> {
  const configDir = getConfigDir()
  const configPath = getConfigPath()

  // Ensure config directory exists
  try {
    await access(configDir)
  } catch {
    await mkdir(configDir, { recursive: true, mode: 0o700 })
  }

  // Read existing config
  let existing: Partial<Config> = {}
  try {
    const content = await readFile(configPath, 'utf-8')
    existing = JSON.parse(content)
  } catch {
    // No existing config
  }

  // Merge and write
  const merged = {
    ...existing,
    ...updates,
  }

  await writeFile(configPath, JSON.stringify(merged, null, 2), { mode: 0o600 })
}

/**
 * Remove a configuration key
 */
export async function unsetConfig(key: ConfigKey): Promise<void> {
  const config = await getConfig()
  // Use a type-safe delete
  const configAny = config as unknown as Record<string, unknown>
  delete configAny[key]
  await setConfig(config)
}

/**
 * Validate a config key exists
 */
export function isValidConfigKey(key: string): key is ConfigKey {
  return configKeys.includes(key as ConfigKey)
}

/**
 * Parse and validate a config value by key
 */
export function parseConfigValue(key: ConfigKey, value: string): unknown {
  switch (key) {
    case 'json_output':
      if (value === 'true') return true
      if (value === 'false') return false
      throw new Error(`Invalid value for ${key}: expected 'true' or 'false'`)

    case 'api_url':
    case 'default_model':
    case 'default_from':
    case 'default_email_from':
    case 'default_currency':
      return value

    case 'custom_headers':
      try {
        return JSON.parse(value)
      } catch {
        throw new Error(`Invalid value for ${key}: expected valid JSON`)
      }

    default:
      return value
  }
}
