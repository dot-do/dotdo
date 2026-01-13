/**
 * Auth Commands - Commander exports
 *
 * Commands:
 *   login   - Log in to your account (device flow)
 *   logout  - Log out of your account
 *   whoami  - Show current identity
 */

import { Command } from 'commander'
import { run as loginRun } from './login'
import { run as logoutRun } from './logout'
import { run as whoamiRun } from './whoami'

/**
 * login command - Authenticate via device flow
 *
 * @example
 * dotdo login
 * dotdo login --no-browser
 */
export const loginCommand = new Command('login')
  .description('Log in to your account')
  .option('--no-browser', 'Do not open browser automatically')
  .action(async (options) => {
    await loginRun([], { noBrowser: !options.browser })
  })

/**
 * logout command - Clear stored credentials
 *
 * @example
 * dotdo logout
 * dotdo logout --all
 */
export const logoutCommand = new Command('logout')
  .description('Log out of your account')
  .option('--all', 'Clear all stored tokens')
  .action(async (options) => {
    await logoutRun([], { all: options.all })
  })

/**
 * whoami command - Show current identity
 *
 * @example
 * dotdo whoami
 * dotdo whoami --json
 */
export const whoamiCommand = new Command('whoami')
  .description('Show current identity')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await whoamiRun([], { json: options.json })
  })
