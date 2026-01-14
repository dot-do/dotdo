/**
 * Call Command (Commander wrapper)
 *
 * Make voice calls via calls.do
 *
 * Usage:
 *   do call +15551234567 "Your appointment is tomorrow"
 *   do call +15551234567 "Hello" --from +15559876543
 *   do call +15551234567 "Hello" --voice alice
 *   do call +15551234567 "Hello" --json
 */

import { Command } from 'commander'
import { run } from '../../src/commands/call'

export const callCommand = new Command('call')
  .description('Make voice calls via calls.do')
  .argument('<phone>', 'Phone number to call (E.164 format)')
  .argument('<message>', 'Message to speak')
  .option('--from <phone>', 'Caller ID phone number')
  .option('--voice <voice>', 'TTS voice to use')
  .option('--json', 'Output as JSON')
  .action(async (phone, message, options) => {
    // Build args array for existing run function
    const args = [phone, message]
    if (options.from) {
      args.push('--from', options.from)
    }
    if (options.voice) {
      args.push('--voice', options.voice)
    }
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

export default callCommand
