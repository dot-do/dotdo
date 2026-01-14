/**
 * Queue Command (Commander wrapper)
 *
 * Queue operations via queue.do
 *
 * Usage:
 *   do queue publish my-queue '{"event": "user.signup"}'
 *   do queue publish my-queue '{}' --delay 60
 *   do queue list
 */

import { Command } from 'commander'
import { run } from '../../src/commands/queue'

export const queueCommand = new Command('queue')
  .description('Queue operations via queue.do')

// Publish subcommand
queueCommand
  .command('publish')
  .description('Publish a message to a queue')
  .argument('<queue>', 'Queue name')
  .argument('<message>', 'Message body (JSON)')
  .option('--delay <seconds>', 'Delay in seconds')
  .option('--content-type <type>', 'Content type (default: application/json)')
  .option('--json', 'Output as JSON')
  .action(async (queue, message, options) => {
    // Build args array for existing run function
    const args = ['publish', queue, message]
    if (options.delay) {
      args.push('--delay', options.delay)
    }
    if (options.contentType) {
      args.push('--content-type', options.contentType)
    }
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

// List subcommand
queueCommand
  .command('list')
  .description('List all queues')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const args = ['list']
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

export default queueCommand
