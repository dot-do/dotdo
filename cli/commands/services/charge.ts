/**
 * Charge Command (Commander wrapper)
 *
 * Create charges via payments.do
 *
 * Usage:
 *   do charge cus_123 --amount 9900
 *   do charge cus_123 --amount 1000 --currency eur
 *   do charge cus_123 --amount 1000 --description "Monthly subscription"
 *   do charge cus_123 --amount 1000 --metadata '{"order_id":"ord_123"}'
 */

import { Command } from 'commander'
import { run } from '../../src/commands/charge'

export const chargeCommand = new Command('charge')
  .description('Create charges via payments.do')
  .argument('<customer>', 'Customer ID to charge')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .option('--currency <currency>', 'Currency code (default: usd)')
  .option('--description <desc>', 'Charge description')
  .option('--metadata <json>', 'Metadata as JSON string')
  .option('--json', 'Output as JSON')
  .action(async (customer, options) => {
    // Build args array for existing run function
    const args = [customer]
    if (options.amount) {
      args.push('--amount', options.amount)
    }
    if (options.currency) {
      args.push('--currency', options.currency)
    }
    if (options.description) {
      args.push('--description', options.description)
    }
    if (options.metadata) {
      args.push('--metadata', options.metadata)
    }
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

export default chargeCommand
