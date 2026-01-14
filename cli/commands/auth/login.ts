import { ensureLoggedIn } from 'oauth.do/node'

export async function run() {
  const { token, isNewLogin } = await ensureLoggedIn({
    openBrowser: true,
    print: console.log,
  })

  if (isNewLogin) {
    console.log('Logged in successfully')
  } else {
    console.log('Already logged in')
  }
}
