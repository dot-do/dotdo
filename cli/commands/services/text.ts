/**
 * Text Command (Commander wrapper)
 *
 * Send SMS/MMS via texts.do
 *
 * Usage:
 *   do text +15551234567 "Reply YES to confirm"
 *   do text +15551234567 "Hello" --from +15559876543
 *   do text +15551234567 "Check this" --media-url https://example.com/image.jpg
 *   do text +15551234567 "Hello" --json
 */

import { Command } from 'commander'
import { run } from '../../src/commands/text'

export const textCommand = new Command('text')
  .description('Send SMS/MMS via texts.do')
  .argument('<phone>', 'Phone number to text (E.164 format)')
  .argument('<message>', 'Message to send')
  .option('--from <phone>', 'Sender phone number')
  .option('--media-url <url>', 'Media URL for MMS')
  .option('--json', 'Output as JSON')
  .action(async (phone, message, options) => {
    // Build args array for existing run function
    const args = [phone, message]
    if (options.from) {
      args.push('--from', options.from)
    }
    if (options.mediaUrl) {
      args.push('--media-url', options.mediaUrl)
    }
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

export default textCommand
