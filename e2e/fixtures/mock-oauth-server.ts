/**
 * Mock OAuth Server for E2E Testing
 *
 * Provides a complete mock OAuth 2.0 server that implements:
 * - Device Authorization Grant (RFC 8628)
 * - Token refresh
 * - Token validation
 * - Basic RPC endpoint for testing authenticated calls
 *
 * Uses in-memory state, no real network calls required.
 *
 * @module e2e/fixtures/mock-oauth-server
 * @see do-iidr.20
 */

/**
 * Pending device authorization request
 */
interface PendingDevice {
  deviceCode: string
  userCode: string
  clientId: string
  scope: string
  expiresAt: number
  status: 'pending' | 'approved' | 'denied' | 'expired'
  userId?: string
}

/**
 * Stored token info
 */
interface TokenInfo {
  userId: string
  scope: string
  expiresAt: number
}

/**
 * Thing stored in mock database
 */
interface MockThing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Mock OAuth Server interface
 */
export interface MockOAuthServer {
  /** Base URL for OAuth endpoints */
  baseUrl: string
  /** URL for RPC endpoint */
  rpcEndpoint: string
  /** Custom fetch that routes to mock server */
  fetch: typeof globalThis.fetch
  /** Approve a pending device authorization */
  approveDevice(deviceCode: string, userId?: string): void
  /** Deny a pending device authorization */
  denyDevice(deviceCode: string): void
  /** Expire a pending device authorization */
  expireDevice(deviceCode: string): void
  /** Create a valid access token for testing */
  createAccessToken(userId: string, expiresInMs?: number): string
  /** Create a valid refresh token for testing */
  createRefreshToken(userId: string): string
  /** Close the mock server (cleanup) */
  close(): Promise<void>
}

/**
 * Generate a random string for IDs
 */
function generateId(prefix: string = ''): string {
  const random = Math.random().toString(36).substring(2, 10)
  const timestamp = Date.now().toString(36)
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`
}

/**
 * Generate a user code (8 alphanumeric characters with hyphen)
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude confusing chars
  let code = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-'
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

/**
 * Create a mock OAuth server for testing
 *
 * @example
 * ```typescript
 * const mockOAuth = await createMockOAuthServer()
 *
 * // Use with DeviceFlow
 * const deviceFlow = new DeviceFlow({
 *   clientId: 'test',
 *   oauthBaseUrl: mockOAuth.baseUrl,
 *   fetch: mockOAuth.fetch,
 * })
 *
 * // Simulate user approval
 * const code = await deviceFlow.requestDeviceCode()
 * mockOAuth.approveDevice(code.device_code)
 * const token = await deviceFlow.pollForToken(code.device_code)
 * ```
 */
export async function createMockOAuthServer(): Promise<MockOAuthServer> {
  // In-memory state
  const pendingDevices = new Map<string, PendingDevice>()
  const accessTokens = new Map<string, TokenInfo>()
  const refreshTokens = new Map<string, { userId: string; scope: string }>()
  const things = new Map<string, MockThing>()

  // Virtual URLs
  const baseUrl = 'https://mock-oauth.test'
  const rpcEndpoint = 'https://mock-rpc.test'

  /**
   * Handle device code request
   */
  function handleDeviceCodeRequest(body: URLSearchParams): Response {
    const clientId = body.get('client_id')
    const scope = body.get('scope') || 'read'

    if (!clientId) {
      return Response.json(
        { error: 'invalid_request', error_description: 'client_id required' },
        { status: 400 }
      )
    }

    const deviceCode = generateId('device')
    const userCode = generateUserCode()

    const pending: PendingDevice = {
      deviceCode,
      userCode,
      clientId,
      scope,
      expiresAt: Date.now() + 600000, // 10 minutes
      status: 'pending',
    }

    pendingDevices.set(deviceCode, pending)

    return Response.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${baseUrl}/device`,
      verification_uri_complete: `${baseUrl}/device?code=${userCode}`,
      expires_in: 600,
      interval: 5,
    })
  }

  /**
   * Handle device token request
   */
  function handleDeviceTokenRequest(body: URLSearchParams): Response {
    const deviceCode = body.get('device_code')
    const clientId = body.get('client_id')

    if (!deviceCode || !clientId) {
      return Response.json(
        { error: 'invalid_request', error_description: 'device_code and client_id required' },
        { status: 400 }
      )
    }

    const pending = pendingDevices.get(deviceCode)

    if (!pending) {
      return Response.json(
        { error: 'invalid_grant', error_description: 'Unknown device code' },
        { status: 400 }
      )
    }

    if (pending.clientId !== clientId) {
      return Response.json(
        { error: 'invalid_grant', error_description: 'Client ID mismatch' },
        { status: 400 }
      )
    }

    // Check expiration
    if (Date.now() > pending.expiresAt || pending.status === 'expired') {
      pendingDevices.delete(deviceCode)
      return Response.json(
        { error: 'expired_token', error_description: 'Device code has expired' },
        { status: 400 }
      )
    }

    // Check status
    switch (pending.status) {
      case 'pending':
        return Response.json(
          { error: 'authorization_pending', error_description: 'User has not yet authorized' },
          { status: 400 }
        )

      case 'denied':
        pendingDevices.delete(deviceCode)
        return Response.json(
          { error: 'access_denied', error_description: 'User denied authorization' },
          { status: 400 }
        )

      case 'approved': {
        pendingDevices.delete(deviceCode)

        const userId = pending.userId || 'anonymous'
        const accessToken = generateId('at')
        const refreshToken = generateId('rt')

        // Store tokens
        accessTokens.set(accessToken, {
          userId,
          scope: pending.scope,
          expiresAt: Date.now() + 3600000, // 1 hour
        })

        refreshTokens.set(refreshToken, {
          userId,
          scope: pending.scope,
        })

        return Response.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
          scope: pending.scope,
        })
      }

      default:
        return Response.json(
          { error: 'server_error', error_description: 'Unknown status' },
          { status: 500 }
        )
    }
  }

  /**
   * Handle token refresh request
   */
  function handleRefreshTokenRequest(body: URLSearchParams): Response {
    const refreshToken = body.get('refresh_token')
    const clientId = body.get('client_id')

    if (!refreshToken || !clientId) {
      return Response.json(
        { error: 'invalid_request', error_description: 'refresh_token and client_id required' },
        { status: 400 }
      )
    }

    const tokenInfo = refreshTokens.get(refreshToken)

    if (!tokenInfo) {
      return Response.json(
        { error: 'invalid_grant', error_description: 'Invalid refresh token' },
        { status: 400 }
      )
    }

    // Generate new access token
    const newAccessToken = generateId('at')

    accessTokens.set(newAccessToken, {
      userId: tokenInfo.userId,
      scope: tokenInfo.scope,
      expiresAt: Date.now() + 3600000,
    })

    // Optionally rotate refresh token
    const newRefreshToken = generateId('rt')
    refreshTokens.delete(refreshToken)
    refreshTokens.set(newRefreshToken, tokenInfo)

    return Response.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: tokenInfo.scope,
    })
  }

  /**
   * Validate access token from Authorization header
   */
  function validateAccessToken(authHeader: string | null): TokenInfo | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.slice(7)
    const tokenInfo = accessTokens.get(token)

    if (!tokenInfo) {
      return null
    }

    if (Date.now() > tokenInfo.expiresAt) {
      accessTokens.delete(token)
      return null
    }

    return tokenInfo
  }

  /**
   * Handle RPC requests
   */
  function handleRpcRequest(request: Request, body: { method: string; args: unknown[] }): Response {
    const authHeader = request.headers.get('Authorization')
    const tokenInfo = validateAccessToken(authHeader)

    // Some methods require auth
    const requiresAuth = !['health', '_types', '_schema'].includes(body.method.split('.')[0] || '')

    if (requiresAuth && !tokenInfo) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        {
          status: 401,
          headers: getTelemetryHeaders(),
        }
      )
    }

    // Route to method handlers
    const [namespace, method] = body.method.includes('.')
      ? body.method.split('.')
      : [body.method, null]

    switch (namespace) {
      case 'health':
        return Response.json(
          { result: { status: 'ok', timestamp: Date.now() } },
          { headers: getTelemetryHeaders() }
        )

      case '_types':
        return Response.json(
          {
            result: `
interface $Context {
  things: ThingsService
  events: EventsService
  health(): Promise<{ status: string }>
}

interface ThingsService {
  create(data: { $type: string; name?: string; data?: Record<string, unknown> }): Promise<Thing>
  get(id: string): Promise<Thing>
  list(): Promise<Thing[]>
  update(id: string, data: Partial<Thing>): Promise<Thing>
  delete(id: string): Promise<void>
}

interface Thing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface EventsService {
  emit(event: { type: string; payload?: unknown }): Promise<Event>
  list(): Promise<Event[]>
}

interface Event {
  $id: string
  type: string
  payload?: unknown
  timestamp: string
}
`,
          },
          { headers: getTelemetryHeaders() }
        )

      case '_eval':
        // Simple eval for testing
        try {
          const code = body.args[0] as string
          // Very basic evaluation for test purposes
          if (code === '1 + 1') {
            return Response.json({ result: 2 }, { headers: getTelemetryHeaders() })
          }
          if (code === '$.health()') {
            return Response.json(
              { result: { status: 'ok' } },
              { headers: getTelemetryHeaders() }
            )
          }
          if (code === '$.things.list()') {
            return Response.json(
              { result: Array.from(things.values()) },
              { headers: getTelemetryHeaders() }
            )
          }
          return Response.json({ result: undefined }, { headers: getTelemetryHeaders() })
        } catch (error) {
          return Response.json(
            {
              error: {
                code: 'EVAL_ERROR',
                message: error instanceof Error ? error.message : 'Eval failed',
              },
            },
            { status: 500, headers: getTelemetryHeaders() }
          )
        }

      case 'things':
        return handleThingsMethod(method, body.args)

      case 'Functions':
        return handleFunctionsMethod(method, body.args)

      case 'Workflows':
        return handleWorkflowsMethod(method, body.args)

      case 'Agents':
        return handleAgentsMethod(method, body.args)

      case 'Database':
        return handleDatabaseMethod(method, body.args)

      default:
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Unknown method: ${body.method}` } },
          { status: 404, headers: getTelemetryHeaders() }
        )
    }
  }

  /**
   * Handle things.* methods
   */
  function handleThingsMethod(method: string | null, args: unknown[]): Response {
    switch (method) {
      case 'create': {
        const data = args[0] as { $type: string; name?: string; data?: Record<string, unknown> }
        const thing: MockThing = {
          $id: generateId('thing'),
          $type: data.$type,
          name: data.name,
          data: data.data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        things.set(thing.$id, thing)
        return Response.json({ result: thing }, { headers: getTelemetryHeaders() })
      }

      case 'get': {
        const id = args[0] as string
        const thing = things.get(id)
        if (!thing) {
          return Response.json(
            { error: { code: 'NOT_FOUND', message: 'Thing not found' } },
            { status: 404, headers: getTelemetryHeaders() }
          )
        }
        return Response.json({ result: thing }, { headers: getTelemetryHeaders() })
      }

      case 'list':
        return Response.json(
          { result: Array.from(things.values()) },
          { headers: getTelemetryHeaders() }
        )

      case 'update': {
        const [id, updates] = args as [string, Partial<MockThing>]
        const thing = things.get(id)
        if (!thing) {
          return Response.json(
            { error: { code: 'NOT_FOUND', message: 'Thing not found' } },
            { status: 404, headers: getTelemetryHeaders() }
          )
        }
        const updated = { ...thing, ...updates, updatedAt: new Date().toISOString() }
        things.set(id, updated)
        return Response.json({ result: updated }, { headers: getTelemetryHeaders() })
      }

      case 'delete': {
        const id = args[0] as string
        things.delete(id)
        return Response.json({ result: undefined }, { headers: getTelemetryHeaders() })
      }

      default:
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Unknown things method: ${method}` } },
          { status: 404, headers: getTelemetryHeaders() }
        )
    }
  }

  /**
   * Handle Functions.* methods (platform.do)
   */
  function handleFunctionsMethod(method: string | null, args: unknown[]): Response {
    switch (method) {
      case 'create': {
        const data = args[0] as { name: string; description?: string; code?: string; runtime?: string }
        return Response.json(
          {
            result: {
              $id: generateId('fn'),
              name: data.name,
              description: data.description,
              runtime: data.runtime || 'javascript',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          { headers: getTelemetryHeaders() }
        )
      }

      case 'invoke':
        return Response.json(
          { result: { output: 'mock function result' } },
          { headers: getTelemetryHeaders() }
        )

      case 'list':
        return Response.json({ result: [] }, { headers: getTelemetryHeaders() })

      default:
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Unknown Functions method: ${method}` } },
          { status: 404, headers: getTelemetryHeaders() }
        )
    }
  }

  /**
   * Handle Workflows.* methods (platform.do)
   */
  function handleWorkflowsMethod(method: string | null, args: unknown[]): Response {
    switch (method) {
      case 'create': {
        const data = args[0] as { name: string; description?: string; steps?: unknown[] }
        return Response.json(
          {
            result: {
              $id: generateId('wf'),
              name: data.name,
              description: data.description,
              steps: data.steps || [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          { headers: getTelemetryHeaders() }
        )
      }

      case 'run':
        return Response.json(
          {
            result: {
              $id: generateId('run'),
              workflowId: 'mock',
              status: 'pending',
              startedAt: new Date().toISOString(),
            },
          },
          { headers: getTelemetryHeaders() }
        )

      case 'get':
        return Response.json(
          {
            result: {
              $id: args[0],
              workflowId: 'mock',
              status: 'completed',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
          },
          { headers: getTelemetryHeaders() }
        )

      default:
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Unknown Workflows method: ${method}` } },
          { status: 404, headers: getTelemetryHeaders() }
        )
    }
  }

  /**
   * Handle Agents.* methods (platform.do)
   */
  function handleAgentsMethod(method: string | null, args: unknown[]): Response {
    switch (method) {
      case 'create': {
        const data = args[0] as { name: string; description?: string; systemPrompt?: string; model?: string }
        return Response.json(
          {
            result: {
              $id: generateId('agent'),
              name: data.name,
              description: data.description,
              systemPrompt: data.systemPrompt,
              model: data.model || 'gpt-4',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          { headers: getTelemetryHeaders() }
        )
      }

      case 'invoke':
        return Response.json(
          { result: 'Hello! I am a mock agent response.' },
          { headers: getTelemetryHeaders() }
        )

      default:
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Unknown Agents method: ${method}` } },
          { status: 404, headers: getTelemetryHeaders() }
        )
    }
  }

  /**
   * Handle Database.* methods (platform.do)
   */
  function handleDatabaseMethod(method: string | null, args: unknown[]): Response {
    switch (method) {
      case 'query':
        return Response.json(
          {
            result: {
              rows: [],
              columns: ['id', 'name'],
              rowCount: 0,
            },
          },
          { headers: getTelemetryHeaders() }
        )

      case 'execute':
        return Response.json(
          {
            result: {
              rowsAffected: 0,
            },
          },
          { headers: getTelemetryHeaders() }
        )

      default:
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Unknown Database method: ${method}` } },
          { status: 404, headers: getTelemetryHeaders() }
        )
    }
  }

  /**
   * Get telemetry headers for responses
   */
  function getTelemetryHeaders(): Record<string, string> {
    return {
      'X-Worker-Colo': 'SJC',
      'X-DO-Colo': 'SJC',
      'X-Latency-Ms': String(Math.floor(Math.random() * 50) + 1),
      'Content-Type': 'application/json',
    }
  }

  /**
   * Mock fetch implementation that routes to appropriate handlers
   */
  const mockFetch: typeof globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const request = new Request(url, init)
    const urlObj = new URL(url)

    // OAuth endpoints
    if (url.startsWith(baseUrl)) {
      const pathname = urlObj.pathname

      if (pathname === '/device/code' && request.method === 'POST') {
        const text = await request.text()
        const body = new URLSearchParams(text)
        return handleDeviceCodeRequest(body)
      }

      if (pathname === '/device/token' && request.method === 'POST') {
        const text = await request.text()
        const body = new URLSearchParams(text)
        return handleDeviceTokenRequest(body)
      }

      if (pathname === '/token' && request.method === 'POST') {
        const text = await request.text()
        const body = new URLSearchParams(text)
        const grantType = body.get('grant_type')

        if (grantType === 'refresh_token') {
          return handleRefreshTokenRequest(body)
        }

        return Response.json(
          { error: 'unsupported_grant_type', error_description: 'Unsupported grant type' },
          { status: 400 }
        )
      }

      return Response.json({ error: 'not_found' }, { status: 404 })
    }

    // RPC endpoints
    if (url.startsWith(rpcEndpoint)) {
      const pathname = urlObj.pathname

      if (pathname === '/health') {
        return Response.json({ status: 'ok' }, { headers: getTelemetryHeaders() })
      }

      if (pathname === '/rpc' && request.method === 'POST') {
        try {
          const body = await request.json() as { method: string; args: unknown[] }
          return handleRpcRequest(request, body)
        } catch {
          return Response.json(
            { error: { code: 'PARSE_ERROR', message: 'Invalid JSON' } },
            { status: 400, headers: getTelemetryHeaders() }
          )
        }
      }

      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404, headers: getTelemetryHeaders() }
      )
    }

    // Unknown URL - throw network error
    throw new Error(`Mock server does not handle: ${url}`)
  }

  return {
    baseUrl,
    rpcEndpoint,
    fetch: mockFetch,

    approveDevice(deviceCode: string, userId?: string): void {
      const pending = pendingDevices.get(deviceCode)
      if (pending) {
        pending.status = 'approved'
        pending.userId = userId || 'test-user'
      }
    },

    denyDevice(deviceCode: string): void {
      const pending = pendingDevices.get(deviceCode)
      if (pending) {
        pending.status = 'denied'
      }
    },

    expireDevice(deviceCode: string): void {
      const pending = pendingDevices.get(deviceCode)
      if (pending) {
        pending.status = 'expired'
      }
    },

    createAccessToken(userId: string, expiresInMs: number = 3600000): string {
      const token = generateId('at')
      accessTokens.set(token, {
        userId,
        scope: 'read write',
        expiresAt: Date.now() + expiresInMs,
      })
      return token
    },

    createRefreshToken(userId: string): string {
      const token = generateId('rt')
      refreshTokens.set(token, {
        userId,
        scope: 'read write',
      })
      return token
    },

    async close(): Promise<void> {
      // Clear all state
      pendingDevices.clear()
      accessTokens.clear()
      refreshTokens.clear()
      things.clear()
    },
  }
}
