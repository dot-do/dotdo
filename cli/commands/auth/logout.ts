import { ensureLoggedOut } from 'oauth.do/node'
import { spin, printStatus, isInteractive } from '../../utils/spinner'

export async function run() {
  const interactive = isInteractive()
  const spinner = interactive ? spin('Clearing credentials...') : null

  try {
    await ensureLoggedOut({ print: () => {} }) // Suppress oauth.do output

    if (spinner) {
      spinner.succeed('Logged out successfully')
    } else {
      printStatus('Logged out successfully', 'success')
    }
  } catch (error) {
    if (spinner) {
      spinner.fail(`Logout failed: ${error instanceof Error ? error.message : String(error)}`)
    } else {
      printStatus(`Logout failed: ${error instanceof Error ? error.message : String(error)}`, 'fail')
    }
    throw error
  }
}
