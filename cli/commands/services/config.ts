/**
 * Config Command (Commander wrapper)
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

import { Command } from 'commander'
import { run } from '../../src/commands/config'

export const configCommand = new Command('config')
  .description('Manage CLI configuration')

// Get subcommand
configCommand
  .command('get')
  .description('Get config value(s)')
  .argument('[key]', 'Config key to get (omit for all)')
  .action(async (key) => {
    const args = ['get']
    if (key) {
      args.push(key)
    }
    await run(args)
  })

// Set subcommand
configCommand
  .command('set')
  .description('Set a config value')
  .argument('<key>', 'Config key to set')
  .argument('<value>', 'Value to set')
  .action(async (key, value) => {
    await run(['set', key, value])
  })

// Unset subcommand
configCommand
  .command('unset')
  .description('Remove a config value')
  .argument('<key>', 'Config key to remove')
  .action(async (key) => {
    await run(['unset', key])
  })

// List subcommand
configCommand
  .command('list')
  .description('List all available config keys')
  .action(async () => {
    await run(['list'])
  })

export default configCommand
