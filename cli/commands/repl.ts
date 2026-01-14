/**
 * REPL Command
 *
 * Interactive TypeScript REPL connected to a DO.
 */

import { Command } from 'commander'
import * as React from 'react'
import { render } from 'ink'
import { ensureLoggedIn, getUser } from 'oauth.do/node'
import { App } from '../ink/App'
import { loadConfig } from '../utils/do-config'
import { WorkersDoClient } from '../services/workers-do'
import { createLogger } from '../utils/logger'

const logger = createLogger('repl')

/**
 * Execute code against a DO using ai-evaluate
 * TODO: Integrate actual ai-evaluate
 */
async function executeCode($id: string, code: string): Promise<string> {
  // For now, just echo back - will integrate ai-evaluate
  return `[Would execute against ${$id}]: ${code}`
}

/**
 * Start the REPL
 */
export async function startRepl($id: string, user?: string): Promise<void> {
  let doName: string
  try {
    doName = new URL($id).hostname
  } catch {
    throw new Error(`Invalid DO URL: ${$id}`)
  }

  const { waitUntilExit } = render(
    React.createElement(App, {
      doName,
      user,
      onExecute: (code: string) => executeCode($id, code)
    })
  )

  await waitUntilExit()
}

/**
 * Commander command for 'dotdo repl'
 */
export const replCommand = new Command('repl')
  .description('Start interactive REPL')
  .option('--url <url>', 'Connect to specific DO')
  .action(async (options) => {
    // Ensure logged in
    let user: string | undefined
    let token: string
    try {
      const auth = await ensureLoggedIn({
        openBrowser: true,
        print: console.log,
      })
      token = auth.token

      // Get user info from token
      const userResult = await getUser(token)
      user = userResult.user?.email
    } catch (error) {
      logger.error('Authentication failed. Run "dotdo login" first.')
      process.exit(1)
    }

    // Get DO URL
    let $id = options.url

    if (!$id) {
      // Try loading from do.config.ts
      const config = await loadConfig()
      if (config) {
        $id = config.$id
      }
    }

    if (!$id) {
      // Interactive picker
      logger.info('No DO configured. Fetching your workers...')

      const client = new WorkersDoClient(token)
      const workers = await client.list({ sortBy: 'accessed', limit: 10 })

      if (workers.length === 0) {
        logger.error('No workers found. Deploy a DO first.')
        process.exit(1)
      }

      // For now, just use first worker
      // TODO: Interactive selection with Ink
      $id = workers[0].url
      logger.info(`Connecting to ${$id}`)
    }

    await startRepl($id, user)
  })

export default replCommand
