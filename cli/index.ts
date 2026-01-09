/**
 * CLI Router
 *
 * Routes CLI commands to appropriate handlers or AI fallback.
 */

import { commands } from './commands/index'
import pkg from '../package.json'

export type RouteResult =
  | { type: 'help' }
  | { type: 'version' }
  | { type: 'command'; name: string; args: string[] }
  | { type: 'fallback'; input: string[] }

/** Known command names */
const knownCommands = ['login', 'logout', 'dev', 'build', 'deploy', 'init']

/** Version from package.json */
export const version = pkg.version

/** Help text for CLI */
export const helpText = `
Usage: do [command] [options]

Commands:
  login     Log in to your account
  logout    Log out of your account
  dev       Start development server
  build     Build the project
  deploy    Deploy to production
  init      Initialize a new project

Options:
  -h, --help     Show help
  -v, --version  Show version

Any unrecognized commands will be passed to the AI fallback for natural language processing.
`

/**
 * Parse process.argv to extract CLI arguments
 * Strips the runtime and script path
 */
export function parseArgv(argv: string[]): string[] {
  return argv.slice(2)
}

/**
 * Route CLI input to the appropriate handler
 */
export function route(argv: string[]): RouteResult {
  const [command, ...args] = argv

  // No command or help flag
  if (!command || command === '--help' || command === '-h') {
    return { type: 'help' }
  }

  // Version flag
  if (command === '--version' || command === '-v') {
    return { type: 'version' }
  }

  // help command with no additional args
  if (command === 'help' && args.length === 0) {
    return { type: 'help' }
  }

  // Known commands
  if (knownCommands.includes(command)) {
    return { type: 'command', name: command, args }
  }

  // AI fallback for unknown commands
  return { type: 'fallback', input: argv }
}
