/**
 * Config Command
 *
 * Manage CLI configuration
 *
 * Usage:
 *   do config get                    # Show all config
 *   do config get api_url            # Show specific config value
 *   do config set json_output true   # Set config value
 *   do config unset api_url          # Remove config value
 *   do config list                   # List available config keys
 */

import { parseArgs, requirePositional } from '../args'
import { getConfig, setConfig, unsetConfig, defaultConfig, configKeys, isValidConfigKey, parseConfigValue, type Config, type ConfigKey } from '../config'
import { formatJson, formatTable } from '../output'

// ============================================================================
// Subcommands
// ============================================================================

async function get(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)
  const key = args.positional[0] as ConfigKey | undefined

  const config = await getConfig()

  if (key) {
    if (!isValidConfigKey(key)) {
      throw new Error(`Unknown config key: ${key}. Run 'do config list' to see available keys.`)
    }
    const value = config[key] ?? defaultConfig[key as keyof typeof defaultConfig]
    console.log(value)
  } else {
    // Show all config
    console.log(formatJson(config, { pretty: true }))
  }
}

async function set(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  const key = requirePositional(args, 0, 'config key')
  const valueStr = requirePositional(args, 1, 'config value')

  if (!isValidConfigKey(key)) {
    throw new Error(`Unknown config key: ${key}. Run 'do config list' to see available keys.`)
  }

  const value = parseConfigValue(key, valueStr)
  await setConfig({ [key]: value } as Partial<Config>)

  console.log(`Set ${key} = ${JSON.stringify(value)}`)
}

async function unset(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  const key = requirePositional(args, 0, 'config key')

  if (!isValidConfigKey(key)) {
    throw new Error(`Unknown config key: ${key}. Run 'do config list' to see available keys.`)
  }

  await unsetConfig(key)
  console.log(`Unset ${key}`)
}

async function list(_rawArgs: string[]): Promise<void> {
  const descriptions: Record<ConfigKey, string> = {
    api_url: 'Base API URL for rpc.do gateway',
    json_output: 'Output JSON instead of human-readable format',
    default_model: 'Default LLM model for llm command',
    default_from: 'Default sender for calls/texts',
    default_email_from: 'Default email sender',
    default_currency: 'Default currency for charges',
    custom_headers: 'Custom headers to include in all requests',
  }

  for (const key of configKeys) {
    const desc = descriptions[key]
    const defaultValue = defaultConfig[key as keyof typeof defaultConfig]
    console.log(`${key}`)
    console.log(`  ${desc}`)
    if (defaultValue !== undefined) {
      console.log(`  Default: ${JSON.stringify(defaultValue)}`)
    }
    console.log('')
  }
}

// ============================================================================
// Command Router
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const [subcommand, ...restArgs] = rawArgs

  switch (subcommand) {
    case 'get':
      return get(restArgs)
    case 'set':
      return set(restArgs)
    case 'unset':
      return unset(restArgs)
    case 'list':
      return list(restArgs)
    default:
      if (!subcommand) {
        // Default to get (show all config)
        return get([])
      }
      throw new Error(`Unknown subcommand: ${subcommand}. Available: get, set, unset, list`)
  }
}
