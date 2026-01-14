/**
 * Sandbox Session REST API Routes
 *
 * Routes for managing code execution sandbox sessions via the SandboxDO Durable Object.
 *
 * Endpoints:
 * - GET /sandboxes - List all sandbox sessions
 * - POST /sandboxes - Create a new sandbox session
 * - GET /sandboxes/:id/state - Get session state
 * - DELETE /sandboxes/:id - Destroy sandbox session
 * - POST /sandboxes/:id/exec - Execute command
 * - GET /sandboxes/:id/terminal - WebSocket terminal upgrade
 * - POST /sandboxes/:id/file - Write file
 * - GET /sandboxes/:id/file - Read file
 * - GET /sandboxes/:id/ports - List exposed ports
 * - POST /sandboxes/:id/port - Expose a port
 *
 * @see objects/SandboxDO.ts - Sandbox Durable Object implementation
 */

import { Hono } from 'hono'
import type { Env } from '../types'

// ============================================================================
// Types
// ============================================================================

interface SandboxEnv extends Env {
  SANDBOX_DO: DurableObjectNamespace
}

interface SandboxSessionMeta {
  id: string
  createdAt: string
}

interface CreateSessionBody {
  sleepAfter?: string
  keepAlive?: boolean
}

interface ExecBody {
  command: string
}

interface WriteFileBody {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

interface ExposePortBody {
  port: number
  name?: string
}

// In-memory session registry (for listing - real state is in DO)
const sessionRegistry = new Map<string, SandboxSessionMeta>()

// ============================================================================
// Helper Functions
// ============================================================================

function jsonError(code: string, message: string, status: number) {
  return {
    error: { code, message },
    status,
  }
}

async function getSandboxStub(c: { env: SandboxEnv }, id: string): Promise<DurableObjectStub> {
  const doId = c.env.SANDBOX_DO.idFromName(id)
  return c.env.SANDBOX_DO.get(doId)
}

// ============================================================================
// Routes
// ============================================================================

export const sandboxesRoutes = new Hono<{ Bindings: SandboxEnv }>()

// --------------------------------------------------------------------------
// GET /sandboxes - List all sandbox sessions
// --------------------------------------------------------------------------
sandboxesRoutes.get('/', async (c) => {
  // Get sessions from registry
  const sandboxes: Array<{
    id: string
    status: string
    createdAt: string
  }> = []

  for (const [id, meta] of sessionRegistry.entries()) {
    try {
      // Fetch actual state from DO
      const stub = await getSandboxStub(c, id)
      const stateRes = await stub.fetch(new Request('http://do/state'))
      const state = (await stateRes.json()) as {
        status: string
      }

      sandboxes.push({
        id,
        status: state.status,
        createdAt: meta.createdAt,
      })
    } catch {
      // Session may no longer exist, remove from registry
      sessionRegistry.delete(id)
    }
  }

  return c.json({ sandboxes })
})

// --------------------------------------------------------------------------
// POST /sandboxes - Create new sandbox session
// --------------------------------------------------------------------------
sandboxesRoutes.post('/', async (c) => {
  // Validate Content-Type
  const contentType = c.req.header('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Content-Type must be application/json' } },
      400
    )
  }

  // Parse body
  let body: CreateSessionBody
  try {
    const text = await c.req.text()
    if (!text || text.trim() === '') {
      body = {}
    } else {
      body = JSON.parse(text)
    }
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Generate session ID
  const id = `sandbox-${crypto.randomUUID().slice(0, 8)}`

  // Get DO stub and create session
  const stub = await getSandboxStub(c, id)
  const createRes = await stub.fetch(
    new Request('http://do/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sleepAfter: body.sleepAfter,
        keepAlive: body.keepAlive,
      }),
    })
  )

  if (!createRes.ok) {
    const error = (await createRes.json()) as { error?: string; message?: string }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: error.error || error.message || 'Failed to create session' } },
      500
    )
  }

  // Register session
  sessionRegistry.set(id, {
    id,
    createdAt: new Date().toISOString(),
  })

  return c.json(
    {
      id,
      status: 'created',
    },
    201
  )
})

// --------------------------------------------------------------------------
// Method not allowed handlers for /sandboxes collection
// --------------------------------------------------------------------------
sandboxesRoutes.delete('/', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

sandboxesRoutes.put('/', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

sandboxesRoutes.patch('/', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

// --------------------------------------------------------------------------
// GET /sandboxes/:id/state - Get session state
// --------------------------------------------------------------------------
sandboxesRoutes.get('/:id/state', async (c) => {
  const id = c.req.param('id')

  // Check if session exists in registry
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const stateRes = await stub.fetch(new Request('http://do/state'))

    if (!stateRes.ok) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
    }

    const state = await stateRes.json()
    return c.json(state)
  } catch {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }
})

// --------------------------------------------------------------------------
// DELETE /sandboxes/:id - Destroy sandbox session
// --------------------------------------------------------------------------
sandboxesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')

  // Check if session exists in registry
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const destroyRes = await stub.fetch(
      new Request('http://do/destroy', {
        method: 'POST',
      })
    )

    if (!destroyRes.ok) {
      const error = (await destroyRes.json()) as { error?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.error || 'Failed to destroy session' } },
        500
      )
    }

    // Remove from registry
    sessionRegistry.delete(id)

    return c.json({ success: true })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to destroy session' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /sandboxes/:id/exec - Execute command
// --------------------------------------------------------------------------
sandboxesRoutes.post('/:id/exec', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  // Parse body
  let body: ExecBody
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate command
  if (!body.command || body.command.trim() === '') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: command' } }, 400)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const execRes = await stub.fetch(
      new Request('http://do/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: body.command }),
      })
    )

    if (!execRes.ok) {
      const error = (await execRes.json()) as { error?: string; message?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.error || error.message || 'Failed to execute command' } },
        500
      )
    }

    const result = await execRes.json()
    return c.json(result)
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to execute command' } }, 500)
  }
})

// --------------------------------------------------------------------------
// GET /sandboxes/:id/terminal - WebSocket terminal upgrade
// --------------------------------------------------------------------------
sandboxesRoutes.get('/:id/terminal', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return c.json({ error: { code: 'UPGRADE_REQUIRED', message: 'WebSocket upgrade required' } }, 426)
  }

  // Forward WebSocket upgrade to DO
  try {
    const stub = await getSandboxStub(c, id)
    return stub.fetch(c.req.raw)
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to upgrade connection' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /sandboxes/:id/file - Write file
// --------------------------------------------------------------------------
sandboxesRoutes.post('/:id/file', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  // Parse body
  let body: WriteFileBody
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate path
  if (!body.path) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: path' } }, 400)
  }

  // Validate content
  if (body.content === undefined || body.content === null) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: content' } }, 400)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const writeRes = await stub.fetch(
      new Request('http://do/file/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: body.path,
          content: body.content,
          encoding: body.encoding || 'utf-8',
        }),
      })
    )

    if (!writeRes.ok) {
      const error = (await writeRes.json()) as { error?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.error || 'Failed to write file' } },
        500
      )
    }

    return c.json({ success: true })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to write file' } }, 500)
  }
})

// --------------------------------------------------------------------------
// GET /sandboxes/:id/file - Read file
// --------------------------------------------------------------------------
sandboxesRoutes.get('/:id/file', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  const path = c.req.query('path')
  if (!path) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required query parameter: path' } }, 400)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const readRes = await stub.fetch(
      new Request(`http://do/file/read?path=${encodeURIComponent(path)}`)
    )

    if (!readRes.ok) {
      const error = (await readRes.json()) as { error?: string }
      if (error.error?.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
      }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.error || 'Failed to read file' } },
        500
      )
    }

    const result = await readRes.json()
    return c.json(result)
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read file' } }, 500)
  }
})

// --------------------------------------------------------------------------
// GET /sandboxes/:id/ports - List exposed ports
// --------------------------------------------------------------------------
sandboxesRoutes.get('/:id/ports', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const portsRes = await stub.fetch(new Request('http://do/ports'))

    if (!portsRes.ok) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get ports' } }, 500)
    }

    const result = (await portsRes.json()) as { ports?: unknown[] } | unknown[]
    // Wrap in { ports: [...] } for consistency
    if (Array.isArray(result)) {
      return c.json({ ports: result })
    }
    return c.json({ ports: result.ports || [] })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get ports' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /sandboxes/:id/port - Expose a port
// --------------------------------------------------------------------------
sandboxesRoutes.post('/:id/port', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sandbox session not found' } }, 404)
  }

  // Parse body
  let body: ExposePortBody
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate port
  if (body.port === undefined || body.port === null) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: port' } }, 400)
  }

  if (typeof body.port !== 'number' || body.port < 1 || body.port > 65535) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid port number' } }, 400)
  }

  try {
    const stub = await getSandboxStub(c, id)
    const exposeRes = await stub.fetch(
      new Request('http://do/port/expose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: body.port,
          name: body.name,
        }),
      })
    )

    if (!exposeRes.ok) {
      const error = (await exposeRes.json()) as { error?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.error || 'Failed to expose port' } },
        500
      )
    }

    const result = await exposeRes.json()
    return c.json(result)
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to expose port' } }, 500)
  }
})

// --------------------------------------------------------------------------
// Catch-all for unknown sandbox routes
// --------------------------------------------------------------------------
sandboxesRoutes.all('*', (c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
})

export default sandboxesRoutes
