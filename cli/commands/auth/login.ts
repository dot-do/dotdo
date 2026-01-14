import { ensureLoggedIn } from 'oauth.do/node'
import { spin, printStatus, isInteractive } from '../../utils/spinner'

export async function run() {
  const interactive = isInteractive()

  // Start spinner while waiting for browser auth
  const spinner = interactive ? spin('Opening browser for authentication...', { style: 'dots' }) : null

  try {
    const { token, isNewLogin } = await ensureLoggedIn({
      openBrowser: true,
      print: (msg: string) => {
        // Update spinner text with auth progress messages
        if (spinner) {
          if (msg.includes('http')) {
            spinner.update(`Visit: ${msg}`)
          } else if (msg.includes('waiting') || msg.includes('Waiting')) {
            spinner.update('Waiting for browser authorization...')
          }
        } else {
          console.log(msg)
        }
      },
    })

    if (spinner) {
      spinner.succeed(isNewLogin ? 'Logged in successfully' : 'Already logged in')
    } else {
      printStatus(isNewLogin ? 'Logged in successfully' : 'Already logged in', 'success')
    }
  } catch (error) {
    if (spinner) {
      spinner.fail(`Login failed: ${error instanceof Error ? error.message : String(error)}`)
    } else {
      printStatus(`Login failed: ${error instanceof Error ? error.message : String(error)}`, 'fail')
    }
    throw error
  }
}
