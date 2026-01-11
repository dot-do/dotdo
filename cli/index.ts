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
const knownCommands = [
  // Auth commands
  'login',
  'logout',
  // Dev commands
  'dev',
  'build',
  'deploy',
  'init',
  'introspect',
  // Service commands (cli.do)
  'call',
  'text',
  'email',
  'charge',
  'queue',
  'llm',
  'config',
]

/** Version from package.json */
export const version = pkg.version

/** Help text for CLI */
export const helpText = `
Usage: do [command] [options]

Service Commands (cli.do):
  call        Make voice calls via calls.do
              do call +15551234567 "Your appointment is tomorrow"

  text        Send SMS/MMS via texts.do
              do text +15551234567 "Reply YES to confirm"

  email       Send emails via emails.do
              do email user@example.com --template=welcome

  charge      Create charges via payments.do
              do charge cus_123 --amount=9900

  queue       Queue operations via queue.do
              do queue publish my-queue '{"event": "user.signup"}'

  llm         LLM requests via llm.do (with streaming)
              do llm "Summarize this document" --model=claude-sonnet

  config      Manage CLI configuration
              do config set json_output true

Auth Commands:
  login       Log in to your account (id.org.ai OAuth)
  logout      Log out of your account

Dev Commands:
  dev         Start development server
  build       Build the project
  deploy      Deploy to production
  init        Initialize a new project
  introspect  Generate .do/types.d.ts from DB.mdx schemas

Options:
  -h, --help     Show help
  -v, --version  Show version
  --json         Output JSON (for service commands)

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
