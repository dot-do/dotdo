/**
 * HATEOAS Worker
 *
 * Standalone Hono app that routes requests to Durable Objects and wraps
 * responses with HATEOAS navigation links and discoverable endpoints.
 *
 * Routes:
 * - /{ns}/                    -> Root discovery for namespace
 * - /{ns}/{collection}/       -> Collection listing
 * - /{ns}/{collection}/{id}   -> Instance details
 * - /{ns}/*                   -> Forward other methods to DO
 *
 * This worker uses the HATEOAS response wrappers from api/hateoas.ts
 * to provide apis.vin-style self-documenting, clickable REST APIs.
 *
 * @module workers/hateoas
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { CloudflareEnv } from '../types/CloudflareBindings'
import {
  createRootResponse,
  createCollectionResponse,
  createInstanceResponse,
  type HATEOASResponse,
} from '../api/hateoas'

// ============================================================================
// Types
// ============================================================================

interface HATEOASEnv extends CloudflareEnv {
  /** Known nouns registered for this namespace */
  KNOWN_NOUNS?: string
  /** Known schema tables (better-auth, drizzle) */
  SCHEMA_TABLES?: string
  /** API name for root response */
  API_NAME?: string
  /** API version for root response */
  API_VERSION?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get DO stub for a namespace
 */
function getDOStub(c: Context<{ Bindings: HATEOASEnv }>, ns: string) {
  if (!c.env.DO) {
    throw new Error('DO binding not found')
  }
  const doId = c.env.DO.idFromName(ns)
  return c.env.DO.get(doId)
}

/**
 * Build the $context URL for the namespace
 */
function buildContext(c: Context<{ Bindings: HATEOASEnv }>, ns: string): string {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}/${ns}`
}

/**
 * Parse comma-separated environment variable to array
 */
function parseEnvArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Forward request to DO and return raw response
 */
async function forwardToDO(
  c: Context<{ Bindings: HATEOASEnv }>,
  ns: string,
  path: string
): Promise<Response> {
  const stub = getDOStub(c, ns)
  const url = new URL(c.req.url)
  const doUrl = new URL(path + url.search, url.origin)

  const doRequest = new Request(doUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    duplex: 'half',
  } as RequestInit)

  return stub.fetch(doRequest)
}

// ============================================================================
// Hono App
// ============================================================================

const app = new Hono<{ Bindings: HATEOASEnv }>()

// ============================================================================
// Middleware: Check DO binding
// ============================================================================

app.use('*', async (c, next) => {
  if (!c.env.DO) {
    return c.json(
      { error: { code: 'CONFIGURATION_ERROR', message: 'DO binding not configured' } },
      500
    )
  }
  await next()
})

// ============================================================================
// Root Discovery Routes
// ============================================================================

/**
 * GET /{ns}/ - Root discovery endpoint
 * Returns available collections, schema tables, and actions
 */
app.get('/:ns/', async (c) => {
  const ns = c.req.param('ns')
  const $context = buildContext(c, ns)

  // Get nouns from DO metadata if available
  let nouns = parseEnvArray(c.env.KNOWN_NOUNS)
  let schemaTables = parseEnvArray(c.env.SCHEMA_TABLES)

  // Try to fetch metadata from DO
  try {
    const stub = getDOStub(c, ns)
    const metaResponse = await stub.fetch(new Request('http://do/_meta', {
      method: 'GET',
    }))

    if (metaResponse.ok) {
      const meta = await metaResponse.json() as {
        nouns?: string[]
        schemaTables?: string[]
      }
      nouns = meta.nouns || nouns
      schemaTables = meta.schemaTables || schemaTables
    }
  } catch {
    // Metadata endpoint not available, use env vars
  }

  const response = createRootResponse({
    $context,
    name: c.env.API_NAME || ns,
    version: c.env.API_VERSION || '1.0.0',
    nouns,
    schemaTables,
    request: c.req.raw,
  })

  return c.json(response)
})

/**
 * GET /{ns} - Root discovery (without trailing slash)
 */
app.get('/:ns', async (c) => {
  const ns = c.req.param('ns')
  const $context = buildContext(c, ns)

  let nouns = parseEnvArray(c.env.KNOWN_NOUNS)
  let schemaTables = parseEnvArray(c.env.SCHEMA_TABLES)

  try {
    const stub = getDOStub(c, ns)
    const metaResponse = await stub.fetch(new Request('http://do/_meta', {
      method: 'GET',
    }))

    if (metaResponse.ok) {
      const meta = await metaResponse.json() as {
        nouns?: string[]
        schemaTables?: string[]
      }
      nouns = meta.nouns || nouns
      schemaTables = meta.schemaTables || schemaTables
    }
  } catch {
    // Metadata endpoint not available
  }

  const response = createRootResponse({
    $context,
    name: c.env.API_NAME || ns,
    version: c.env.API_VERSION || '1.0.0',
    nouns,
    schemaTables,
    request: c.req.raw,
  })

  return c.json(response)
})

// ============================================================================
// Collection Routes
// ============================================================================

/**
 * GET /{ns}/{collection}/ - Collection listing
 * Forwards to DO and wraps response with HATEOAS links
 */
app.get('/:ns/:collection/', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const $context = buildContext(c, ns)

  // Forward to DO to get items
  const doResponse = await forwardToDO(c, ns, `/${collection}/`)

  if (!doResponse.ok) {
    // Forward error responses as-is
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  // Parse items from DO response
  let items: Array<{ $id?: string; [key: string]: unknown }> = []
  let verbs: string[] | undefined

  try {
    const data = await doResponse.json() as {
      items?: Array<{ $id?: string }>
      verbs?: string[]
    } | Array<{ $id?: string }>

    if (Array.isArray(data)) {
      items = data
    } else if (data && typeof data === 'object') {
      items = data.items || []
      verbs = data.verbs
    }
  } catch {
    items = []
  }

  const response = createCollectionResponse(items, {
    $context,
    $type: collection,
    verbs,
    request: c.req.raw,
  })

  return c.json(response)
})

/**
 * GET /{ns}/{collection} - Collection listing (without trailing slash)
 */
app.get('/:ns/:collection', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const $context = buildContext(c, ns)

  const doResponse = await forwardToDO(c, ns, `/${collection}`)

  if (!doResponse.ok) {
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  let items: Array<{ $id?: string; [key: string]: unknown }> = []
  let verbs: string[] | undefined

  try {
    const data = await doResponse.json() as {
      items?: Array<{ $id?: string }>
      verbs?: string[]
    } | Array<{ $id?: string }>

    if (Array.isArray(data)) {
      items = data
    } else if (data && typeof data === 'object') {
      items = data.items || []
      verbs = data.verbs
    }
  } catch {
    items = []
  }

  const response = createCollectionResponse(items, {
    $context,
    $type: collection,
    verbs,
    request: c.req.raw,
  })

  return c.json(response)
})

// ============================================================================
// Instance Routes
// ============================================================================

/**
 * GET /{ns}/{collection}/{id} - Instance details
 * Forwards to DO and wraps response with HATEOAS links
 */
app.get('/:ns/:collection/:id', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const id = c.req.param('id')
  const $context = buildContext(c, ns)

  const doResponse = await forwardToDO(c, ns, `/${collection}/${id}`)

  if (!doResponse.ok) {
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  let item: Record<string, unknown> = {}
  let verbs: string[] | undefined
  let relationships: Record<string, string> | undefined

  try {
    const data = await doResponse.json() as {
      data?: Record<string, unknown>
      verbs?: string[]
      relationships?: Record<string, string>
    } & Record<string, unknown>

    // Handle wrapped response or raw data
    if (data && typeof data === 'object') {
      if ('data' in data && data.data && typeof data.data === 'object') {
        item = data.data as Record<string, unknown>
        verbs = data.verbs
        relationships = data.relationships
      } else {
        item = data
        verbs = data.verbs as string[] | undefined
        relationships = data.relationships as Record<string, string> | undefined
      }
    }
  } catch {
    item = {}
  }

  const response = createInstanceResponse(item, {
    $context,
    $type: collection,
    $id: id,
    verbs,
    relationships,
    request: c.req.raw,
  })

  return c.json(response)
})

// ============================================================================
// Passthrough Routes (POST, PUT, PATCH, DELETE)
// ============================================================================

/**
 * POST /{ns}/{collection}/ - Create item in collection
 * Forwards to DO, wraps successful response with HATEOAS links
 */
app.post('/:ns/:collection/', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const $context = buildContext(c, ns)

  const doResponse = await forwardToDO(c, ns, `/${collection}/`)

  if (!doResponse.ok) {
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  // For successful creates, wrap with instance response
  let item: Record<string, unknown> = {}
  let id = ''

  try {
    item = await doResponse.json() as Record<string, unknown>
    id = (item.$id as string) || (item.id as string) || ''
  } catch {
    item = {}
  }

  if (id) {
    const response = createInstanceResponse(item, {
      $context,
      $type: collection,
      $id: id,
      request: c.req.raw,
    })

    return c.json(response, 201, {
      Location: `/${ns}/${collection}/${id}`,
    })
  }

  // If no ID, return raw response
  return c.json(item, 201)
})

app.post('/:ns/:collection', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const $context = buildContext(c, ns)

  const doResponse = await forwardToDO(c, ns, `/${collection}`)

  if (!doResponse.ok) {
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  let item: Record<string, unknown> = {}
  let id = ''

  try {
    item = await doResponse.json() as Record<string, unknown>
    id = (item.$id as string) || (item.id as string) || ''
  } catch {
    item = {}
  }

  if (id) {
    const response = createInstanceResponse(item, {
      $context,
      $type: collection,
      $id: id,
      request: c.req.raw,
    })

    return c.json(response, 201, {
      Location: `/${ns}/${collection}/${id}`,
    })
  }

  return c.json(item, 201)
})

/**
 * PUT/PATCH/DELETE /{ns}/{collection}/{id} - Modify instance
 * Forwards to DO and wraps response appropriately
 */
app.put('/:ns/:collection/:id', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const id = c.req.param('id')
  const $context = buildContext(c, ns)

  const doResponse = await forwardToDO(c, ns, `/${collection}/${id}`)

  if (!doResponse.ok) {
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  let item: Record<string, unknown> = {}

  try {
    item = await doResponse.json() as Record<string, unknown>
  } catch {
    item = {}
  }

  const response = createInstanceResponse(item, {
    $context,
    $type: collection,
    $id: id,
    request: c.req.raw,
  })

  return c.json(response)
})

app.patch('/:ns/:collection/:id', async (c) => {
  const ns = c.req.param('ns')
  const collection = c.req.param('collection')
  const id = c.req.param('id')
  const $context = buildContext(c, ns)

  const doResponse = await forwardToDO(c, ns, `/${collection}/${id}`)

  if (!doResponse.ok) {
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    })
  }

  let item: Record<string, unknown> = {}

  try {
    item = await doResponse.json() as Record<string, unknown>
  } catch {
    item = {}
  }

  const response = createInstanceResponse(item, {
    $context,
    $type: collection,
    $id: id,
    request: c.req.raw,
  })

  return c.json(response)
})

app.delete('/:ns/:collection/:id', async (c) => {
  const ns = c.req.param('ns')

  const doResponse = await forwardToDO(c, ns, `/${c.req.param('collection')}/${c.req.param('id')}`)

  // DELETE typically returns 204 No Content on success
  return new Response(doResponse.body, {
    status: doResponse.status,
    headers: doResponse.headers,
  })
})

// ============================================================================
// Catch-all for other methods on namespace routes
// ============================================================================

/**
 * Forward any other methods to DO
 * This handles RPC, MCP, sync WebSocket connections, etc.
 */
app.all('/:ns/*', async (c) => {
  const ns = c.req.param('ns')
  const url = new URL(c.req.url)

  // Extract path after namespace
  const pathParts = url.pathname.split('/')
  const nsIndex = pathParts.indexOf(ns)
  const subPath = '/' + pathParts.slice(nsIndex + 1).join('/')

  return forwardToDO(c, ns, subPath)
})

// ============================================================================
// Error Handling
// ============================================================================

app.onError((err, c) => {
  console.error('HATEOAS Worker Error:', err)

  if (err.message === 'DO binding not found') {
    return c.json(
      { error: { code: 'CONFIGURATION_ERROR', message: 'DO binding not configured' } },
      500
    )
  }

  return c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } },
    500
  )
})

// ============================================================================
// Export
// ============================================================================

export default app
