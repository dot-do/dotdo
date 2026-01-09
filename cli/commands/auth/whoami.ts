import { getToken, getUser } from 'oauth.do/node'

export async function run() {
  const token = await getToken()
  if (!token) {
    console.log('Not logged in. Run: do login')
    return
  }

  const { user } = await getUser(token)
  if (user) {
    console.log(`Logged in as: ${user.email}`)
  } else {
    console.log('Session expired. Run: do login')
  }
}
