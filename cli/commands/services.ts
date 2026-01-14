/**
 * Service Commands (cli.do)
 *
 * Commander wrappers for cli.do service commands.
 * These wrap the legacy run functions in Commander commands.
 */

import { Command } from 'commander'
import { run as callRun } from '../src/commands/call'
import { run as textRun } from '../src/commands/text'
import { run as emailRun } from '../src/commands/email'
import { run as chargeRun } from '../src/commands/charge'
import { run as queueRun } from '../src/commands/queue'
import { run as llmRun } from '../src/commands/llm'
import { run as configRun } from '../src/commands/config'

/**
 * Helper to wrap legacy run functions in Commander
 */
function wrapCommand(
  name: string,
  description: string,
  run: (args: string[]) => Promise<void>
): Command {
  return new Command(name)
    .description(description)
    .allowUnknownOption()
    .action(async (options, cmd) => {
      // Get raw args after the command name
      const args = cmd.args || []
      try {
        await run(args)
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}

/**
 * Call command - Make voice calls via calls.do
 */
export const callCommand = wrapCommand(
  'call',
  'Make voice calls via calls.do',
  callRun
)

/**
 * Text command - Send SMS/MMS via texts.do
 */
export const textCommand = wrapCommand(
  'text',
  'Send SMS/MMS via texts.do',
  textRun
)

/**
 * Email command - Send emails via emails.do
 */
export const emailCommand = wrapCommand(
  'email',
  'Send emails via emails.do',
  emailRun
)

/**
 * Charge command - Create charges via payments.do
 */
export const chargeCommand = wrapCommand(
  'charge',
  'Create charges via payments.do',
  chargeRun
)

/**
 * Queue command - Queue operations via queue.do
 */
export const queueCommand = wrapCommand(
  'queue',
  'Queue operations via queue.do',
  queueRun
)

/**
 * LLM command - LLM requests via llm.do
 */
export const llmCommand = wrapCommand(
  'llm',
  'LLM requests via llm.do',
  llmRun
)

/**
 * Config command - Manage CLI configuration
 */
export const configCommand = wrapCommand(
  'config',
  'Manage CLI configuration',
  configRun
)
