/**
 * Email Command (Commander wrapper)
 *
 * Send emails via emails.do
 *
 * Usage:
 *   do email user@example.com --subject "Hello"
 *   do email user@example.com --template welcome
 *   do email user@example.com --subject "Hi" --body "Hello there!"
 *   do email user@example.com --subject "Hi" --html "<h1>Hello</h1>"
 */

import { Command } from 'commander'
import { run } from '../../src/commands/email'

export const emailCommand = new Command('email')
  .description('Send emails via emails.do')
  .argument('<address>', 'Email address to send to')
  .option('--subject <subject>', 'Email subject')
  .option('--template <template>', 'Email template name')
  .option('--from <address>', 'Sender email address')
  .option('--body <text>', 'Plain text body')
  .option('--html <html>', 'HTML body')
  .option('--json', 'Output as JSON')
  .action(async (address, options) => {
    // Build args array for existing run function
    const args = [address]
    if (options.subject) {
      args.push('--subject', options.subject)
    }
    if (options.template) {
      args.push('--template', options.template)
    }
    if (options.from) {
      args.push('--from', options.from)
    }
    if (options.body) {
      args.push('--body', options.body)
    }
    if (options.html) {
      args.push('--html', options.html)
    }
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

export default emailCommand
