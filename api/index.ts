/**
 * dotdo Worker - Proxies all requests to the DO
 */
export { DO } from '../objects/DO'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  }
}
