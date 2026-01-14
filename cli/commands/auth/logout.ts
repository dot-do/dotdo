import { ensureLoggedOut } from 'oauth.do/node'

export async function run() {
  await ensureLoggedOut({ print: console.log })
  console.log('Logged out')
}
