import { Hono } from 'hono'
import type { Env } from '../index'

/**
 * DO Router - Routes requests to individual Durable Object instances
 *
 * Pattern: /:doClass/:id/*
 *
 * This router forwards requests to specific DO instances based on:
 * - doClass: The DO namespace binding name (e.g., 'DO', 'TEST_DO', 'BROWSER_DO')
 * - id: The identifier used with idFromName() to get the DO instance
 * - *: The remaining path to forward to the DO
 *
 * Example:
 *   GET /DO/user-123/profile
 *   -> Gets DO namespace 'DO' from env
 *   -> Gets stub via idFromName('user-123')
 *   -> Forwards request with path '/profile' to the DO
 */

export const doRoutes = new Hono<{ Bindings: Env }>()

/**
 * Route all HTTP methods to DO instances
 *
 * Matches: /:doClass/:id, /:doClass/:id/, /:doClass/:id/*
 */
doRoutes.all('/:doClass/:id/*', async (c) => {
  const { doClass, id } = c.req.param()

  // Get DO namespace binding by class name
  const namespace = c.env[doClass as keyof Env] as DurableObjectNamespace | undefined
  if (!namespace || typeof namespace.idFromName !== 'function') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Unknown DO class: ${doClass}` } },
      404
    )
  }

  // Get DO stub using idFromName
  const doId = namespace.idFromName(id)
  const stub = namespace.get(doId)

  // Rewrite path: remove /:doClass/:id prefix
  // Original path: /DO/user-123/some/path -> DO receives: /some/path
  const originalPath = c.req.path
  const prefixPattern = new RegExp(`^/${doClass}/${encodeURIComponent(id)}`)
  const rewrittenPath = originalPath.replace(prefixPattern, '') || '/'

  // Build the URL for the DO request
  const url = new URL(c.req.url)
  url.pathname = rewrittenPath

  // Forward request to DO with original headers and body
  return stub.fetch(
    new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    })
  )
})

/**
 * Handle requests without wildcard path (e.g., /DO/user-123)
 * Routes to the root path of the DO instance
 */
doRoutes.all('/:doClass/:id', async (c) => {
  const { doClass, id } = c.req.param()

  // Get DO namespace binding by class name
  const namespace = c.env[doClass as keyof Env] as DurableObjectNamespace | undefined
  if (!namespace || typeof namespace.idFromName !== 'function') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Unknown DO class: ${doClass}` } },
      404
    )
  }

  // Get DO stub using idFromName
  const doId = namespace.idFromName(id)
  const stub = namespace.get(doId)

  // Build the URL for the DO request (root path)
  const url = new URL(c.req.url)
  url.pathname = '/'

  // Forward request to DO with original headers and body
  return stub.fetch(
    new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    })
  )
})

export default doRoutes
