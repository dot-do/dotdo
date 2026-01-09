import { Hono } from 'hono'
import type { Env } from '../index'
import { validateBrowserConfig } from '../../types/Browser'

/**
 * Browser Session REST API Routes
 *
 * Routes for managing browser automation sessions via the Browser Durable Object.
 *
 * Endpoints:
 * - GET /browsers - List all browser sessions
 * - POST /browsers - Create a new browser session
 * - GET /browsers/:id/state - Get session state
 * - POST /browsers/:id/browse - Navigate to URL
 * - POST /browsers/:id/act - Execute action instruction
 * - POST /browsers/:id/extract - Extract data from page
 * - POST /browsers/:id/observe - Observe available actions
 * - POST /browsers/:id/stop - Stop session
 * - GET /browsers/:id/screenshot - Take screenshot
 * - GET /browsers/:id/events - SSE event stream
 * - GET /browsers/:id/live - Redirect to live view URL
 *
 * @see objects/Browser.ts - Browser Durable Object implementation
 */

// ============================================================================
// Types
// ============================================================================

interface BrowserEnv extends Env {
  BROWSER_DO: DurableObjectNamespace
}

interface BrowserSession {
  id: string
  status: 'idle' | 'active' | 'paused' | 'stopped'
  provider?: 'cloudflare' | 'browserbase'
  currentUrl?: string
  liveViewUrl?: string
  createdAt: string
  updatedAt: string
}

interface CreateSessionBody {
  provider?: 'cloudflare' | 'browserbase'
  liveView?: boolean
  viewport?: { width: number; height: number }
  stealth?: boolean
}

interface BrowseBody {
  url: string
}

interface ActBody {
  instruction: string
}

interface ExtractBody {
  instruction: string
  schema?: unknown
}

interface ObserveBody {
  instruction?: string
}

// In-memory session registry (for listing - real state is in DO)
const sessionRegistry = new Map<string, { id: string; createdAt: string; provider: string }>()

// ============================================================================
// Helper Functions
// ============================================================================

function jsonError(code: string, message: string, status: number) {
  return {
    error: { code, message },
    status,
  }
}

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Only allow http and https protocols
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function getSessionStub(c: { env: BrowserEnv }, id: string): Promise<DurableObjectStub> {
  const doId = c.env.BROWSER_DO.idFromName(id)
  return c.env.BROWSER_DO.get(doId)
}

// ============================================================================
// Routes
// ============================================================================

export const browsersRoutes = new Hono<{ Bindings: BrowserEnv }>()

// --------------------------------------------------------------------------
// GET /browsers - List all browser sessions
// --------------------------------------------------------------------------
browsersRoutes.get('/', async (c) => {
  const status = c.req.query('status')
  const limitStr = c.req.query('limit')
  const offsetStr = c.req.query('offset')

  const limit = limitStr ? parseInt(limitStr, 10) : 100
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0

  // Get sessions from registry
  let sessions: BrowserSession[] = []

  for (const [id, meta] of sessionRegistry.entries()) {
    try {
      // Fetch actual state from DO
      const stub = await getSessionStub(c, id)
      const stateRes = await stub.fetch(new Request('http://do/state'))
      const state = (await stateRes.json()) as {
        status: string
        provider?: string
        currentUrl?: string
        liveViewUrl?: string
      }

      sessions.push({
        id,
        status: state.status as BrowserSession['status'],
        provider: (state.provider || meta.provider) as BrowserSession['provider'],
        currentUrl: state.currentUrl,
        liveViewUrl: state.liveViewUrl,
        createdAt: meta.createdAt,
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // Session may no longer exist, remove from registry
      sessionRegistry.delete(id)
    }
  }

  // Filter by status if provided
  if (status) {
    sessions = sessions.filter((s) => s.status === status)
  }

  // Apply pagination
  sessions = sessions.slice(offset, offset + limit)

  return c.json({ sessions })
})

// --------------------------------------------------------------------------
// POST /browsers - Create new browser session
// --------------------------------------------------------------------------
browsersRoutes.post('/', async (c) => {
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

  // Validate provider
  const provider = body.provider ?? 'cloudflare'
  if (provider !== 'cloudflare' && provider !== 'browserbase') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'provider must be "cloudflare" or "browserbase"' } },
      400
    )
  }

  // Validate viewport if provided
  if (body.viewport) {
    if (
      typeof body.viewport.width !== 'number' ||
      typeof body.viewport.height !== 'number' ||
      body.viewport.width <= 0 ||
      body.viewport.height <= 0
    ) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'viewport width and height must be positive numbers' } },
        400
      )
    }
  }

  // Use validateBrowserConfig for additional validation
  const validation = validateBrowserConfig(body)
  if (!validation.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: validation.errors.map(e => e.message).join(', ') } },
      400
    )
  }

  // Generate session ID
  const id = crypto.randomUUID()

  // Get DO stub and start session
  const stub = await getSessionStub(c, id)
  const startRes = await stub.fetch(
    new Request('http://do/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        liveView: body.liveView,
        viewport: body.viewport,
        stealth: body.stealth,
      }),
    })
  )

  if (!startRes.ok) {
    const error = await startRes.json() as { error?: string; message?: string }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: error.message || error.error || 'Failed to start session' } },
      500
    )
  }

  const result = (await startRes.json()) as {
    sessionId: string
    provider: string
    liveViewUrl?: string
  }

  // Register session
  sessionRegistry.set(id, {
    id,
    createdAt: new Date().toISOString(),
    provider,
  })

  return c.json(
    {
      id,
      sessionId: result.sessionId,
      provider: result.provider,
      liveViewUrl: result.liveViewUrl,
    },
    201
  )
})

// --------------------------------------------------------------------------
// Method not allowed handlers for /browsers collection
// --------------------------------------------------------------------------
browsersRoutes.delete('/', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

browsersRoutes.put('/', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

browsersRoutes.patch('/', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

// --------------------------------------------------------------------------
// GET /browsers/:id/state - Get session state
// --------------------------------------------------------------------------
browsersRoutes.get('/:id/state', async (c) => {
  const id = c.req.param('id')

  // Check if session exists in registry
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  try {
    const stub = await getSessionStub(c, id)
    const stateRes = await stub.fetch(new Request('http://do/state'))

    if (!stateRes.ok) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
    }

    const state = await stateRes.json()
    return c.json(state)
  } catch {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }
})

// Method not allowed for state endpoint
browsersRoutes.patch('/:id/state', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET' } },
    405,
    { Allow: 'GET' }
  )
})

// --------------------------------------------------------------------------
// POST /browsers/:id/browse - Navigate to URL
// --------------------------------------------------------------------------
browsersRoutes.post('/:id/browse', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  // Parse body
  let body: BrowseBody
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate URL
  if (!body.url) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'url is required' } }, 400)
  }

  if (!validateUrl(body.url)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid URL format. Must be http or https.' } },
      400
    )
  }

  try {
    const stub = await getSessionStub(c, id)

    // Check session state first
    const stateRes = await stub.fetch(new Request('http://do/state'))
    const state = (await stateRes.json()) as { status: string }

    if (state.status === 'stopped') {
      return c.json(
        { error: { code: 'CONFLICT', message: 'Browser session is stopped' } },
        409
      )
    }

    // Navigate
    const gotoRes = await stub.fetch(
      new Request('http://do/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: body.url }),
      })
    )

    if (!gotoRes.ok) {
      const error = (await gotoRes.json()) as { error?: string; message?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to navigate' } },
        500
      )
    }

    return c.json({ success: true, url: body.url })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to navigate' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /browsers/:id/act - Execute action instruction
// --------------------------------------------------------------------------
browsersRoutes.post('/:id/act', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  // Parse body
  let body: ActBody
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate instruction
  if (!body.instruction || body.instruction.trim() === '') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'instruction is required' } }, 400)
  }

  try {
    const stub = await getSessionStub(c, id)
    const actRes = await stub.fetch(
      new Request('http://do/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: body.instruction }),
      })
    )

    if (!actRes.ok) {
      const error = (await actRes.json()) as { error?: string; message?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to execute action' } },
        500
      )
    }

    const result = await actRes.json()
    return c.json({ success: true, action: body.instruction, ...(typeof result === 'object' && result !== null ? result : { result }) })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to execute action' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /browsers/:id/extract - Extract data from page
// --------------------------------------------------------------------------
browsersRoutes.post('/:id/extract', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  // Parse body
  let body: ExtractBody
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate instruction
  if (!body.instruction || body.instruction.trim() === '') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'instruction is required' } }, 400)
  }

  try {
    const stub = await getSessionStub(c, id)
    const extractRes = await stub.fetch(
      new Request('http://do/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: body.instruction,
          schema: body.schema,
        }),
      })
    )

    if (!extractRes.ok) {
      const error = (await extractRes.json()) as { error?: string; message?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to extract data' } },
        500
      )
    }

    const result = await extractRes.json()
    return c.json({ success: true, data: result })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to extract data' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /browsers/:id/observe - Observe available actions
// --------------------------------------------------------------------------
browsersRoutes.post('/:id/observe', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  // Parse body (optional)
  let body: ObserveBody = {}
  try {
    const text = await c.req.text()
    if (text && text.trim()) {
      body = JSON.parse(text)
    }
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  try {
    const stub = await getSessionStub(c, id)
    const observeRes = await stub.fetch(
      new Request('http://do/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: body.instruction }),
      })
    )

    if (!observeRes.ok) {
      const error = (await observeRes.json()) as { error?: string; message?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to observe' } },
        500
      )
    }

    const result = await observeRes.json()
    return c.json({ actions: result })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to observe' } }, 500)
  }
})

// --------------------------------------------------------------------------
// POST /browsers/:id/stop - Stop session
// --------------------------------------------------------------------------
browsersRoutes.post('/:id/stop', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  try {
    const stub = await getSessionStub(c, id)
    const stopRes = await stub.fetch(
      new Request('http://do/stop', {
        method: 'POST',
      })
    )

    if (!stopRes.ok) {
      // Check if already stopped
      const stateRes = await stub.fetch(new Request('http://do/state'))
      const state = (await stateRes.json()) as { status: string }
      if (state.status === 'stopped') {
        return c.json({ status: 'stopped' })
      }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Failed to stop session' } },
        500
      )
    }

    return c.json({ status: 'stopped' })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to stop session' } }, 500)
  }
})

// --------------------------------------------------------------------------
// GET /browsers/:id/screenshot - Take screenshot
// --------------------------------------------------------------------------
browsersRoutes.get('/:id/screenshot', async (c) => {
  const id = c.req.param('id')
  const fullPage = c.req.query('fullPage') === 'true'

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  try {
    const stub = await getSessionStub(c, id)
    const screenshotRes = await stub.fetch(
      new Request(`http://do/screenshot?fullPage=${fullPage}`)
    )

    if (!screenshotRes.ok) {
      const error = (await screenshotRes.json()) as { error?: string; message?: string }
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to take screenshot' } },
        500
      )
    }

    const result = (await screenshotRes.json()) as { image?: string }
    return c.json({ image: result.image || result })
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to take screenshot' } }, 500)
  }
})

// --------------------------------------------------------------------------
// GET /browsers/:id/events - SSE event stream
// --------------------------------------------------------------------------
browsersRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  // Create SSE response
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Send initial connection event
  writer.write(encoder.encode('event: connected\ndata: {"status":"connected"}\n\n'))

  // Set up keep-alive ping every 30 seconds
  const pingInterval = setInterval(() => {
    try {
      writer.write(encoder.encode(': ping\n\n'))
    } catch {
      clearInterval(pingInterval)
    }
  }, 30000)

  // Clean up on close
  c.req.raw.signal.addEventListener('abort', () => {
    clearInterval(pingInterval)
    writer.close()
  })

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// --------------------------------------------------------------------------
// GET /browsers/:id/live - Redirect to live view URL
// --------------------------------------------------------------------------
browsersRoutes.get('/:id/live', async (c) => {
  const id = c.req.param('id')

  // Check if session exists
  if (!sessionRegistry.has(id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }

  try {
    const stub = await getSessionStub(c, id)
    const stateRes = await stub.fetch(new Request('http://do/state'))
    const state = (await stateRes.json()) as { liveViewUrl?: string; provider?: string }

    if (!state.liveViewUrl) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Live view not available for this session' } },
        404
      )
    }

    return c.redirect(state.liveViewUrl, 302)
  } catch {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Browser session not found' } }, 404)
  }
})

// --------------------------------------------------------------------------
// Catch-all for unknown browser routes
// --------------------------------------------------------------------------
browsersRoutes.all('*', (c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
})

export default browsersRoutes
