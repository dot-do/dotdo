/**
 * CLI Command Registry
 *
 * Exports all available CLI commands.
 *
 * This module provides two interfaces:
 * 1. `commands` - Legacy command registry (Record<string, Command>)
 * 2. Commander command exports - For use with the unified CLI in main.ts
 */

import { run as introspectRun } from './introspect'

// Service commands (cli.do) - legacy run functions
import { run as callRun } from '../src/commands/call'
import { run as textRun } from '../src/commands/text'
import { run as emailRun } from '../src/commands/email'
import { run as chargeRun } from '../src/commands/charge'
import { run as queueRun } from '../src/commands/queue'
import { run as llmRun } from '../src/commands/llm'
import { run as configRun } from '../src/commands/config'

// Commander-based command exports (for unified CLI)
export {
  callCommand,
  textCommand,
  emailCommand,
  chargeCommand,
  queueCommand,
  llmCommand,
  configCommand,
} from './services'

// Dev command exports (already Commander-based)
export { startCommand } from './start'
export { devCommand } from './dev-local'
export { deployCommand } from './deploy-multi'
export { tunnelCommand } from './tunnel'
export { doCommand } from './do-ops'

export type CommandHandler = (args: string[]) => Promise<void> | void

export interface Command {
  run: CommandHandler
  description?: string
}

/** Command registry object */
export const commands: Record<string, Command> = {
  // Auth commands
  login: {
    run: async (_args: string[]) => {
      // Placeholder - will be implemented
    },
    description: 'Log in to your account',
  },
  logout: {
    run: async (_args: string[]) => {
      // Placeholder - will be implemented
    },
    description: 'Log out of your account',
  },

  // Dev commands
  dev: {
    run: async (_args: string[]) => {
      // Placeholder - will be implemented
    },
    description: 'Start development server',
  },
  build: {
    run: async (_args: string[]) => {
      // Placeholder - will be implemented
    },
    description: 'Build the project',
  },
  deploy: {
    run: async (_args: string[]) => {
      // Placeholder - will be implemented
    },
    description: 'Deploy to production',
  },
  init: {
    run: async (_args: string[]) => {
      // Placeholder - will be implemented
    },
    description: 'Initialize a new project',
  },
  introspect: {
    run: introspectRun,
    description: 'Generate .do/types.d.ts from DB.mdx schemas',
  },

  // Service commands (cli.do)
  call: {
    run: callRun,
    description: 'Make voice calls via calls.do',
  },
  text: {
    run: textRun,
    description: 'Send SMS/MMS via texts.do',
  },
  email: {
    run: emailRun,
    description: 'Send emails via emails.do',
  },
  charge: {
    run: chargeRun,
    description: 'Create charges via payments.do',
  },
  queue: {
    run: queueRun,
    description: 'Queue operations via queue.do',
  },
  llm: {
    run: llmRun,
    description: 'LLM requests via llm.do',
  },
  config: {
    run: configRun,
    description: 'Manage CLI configuration',
  },
}
