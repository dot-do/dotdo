import { getToken, getUser } from 'oauth.do/node'
import { spin, printStatus, isInteractive } from '../../utils/spinner'

export async function run() {
  const interactive = isInteractive()
  const spinner = interactive ? spin('Checking authentication status...') : null

  try {
    const token = await getToken()

    if (!token) {
      if (spinner) {
        spinner.info('Not logged in. Run: do login')
      } else {
        printStatus('Not logged in. Run: do login', 'info')
      }
      return
    }

    const { user } = await getUser(token)

    if (user) {
      if (spinner) {
        spinner.succeed(`Logged in as: ${user.email}`)
      } else {
        printStatus(`Logged in as: ${user.email}`, 'success')
      }
    } else {
      if (spinner) {
        spinner.warn('Session expired. Run: do login')
      } else {
        printStatus('Session expired. Run: do login', 'warn')
      }
    }
  } catch (error) {
    if (spinner) {
      spinner.fail(`Failed to check auth: ${error instanceof Error ? error.message : String(error)}`)
    } else {
      printStatus(`Failed to check auth: ${error instanceof Error ? error.message : String(error)}`, 'fail')
    }
    throw error
  }
}
