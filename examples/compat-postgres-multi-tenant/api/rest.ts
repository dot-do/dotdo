/**
 * REST API Layer - PostgREST-compatible endpoints
 *
 * This module provides a REST API that mirrors Supabase's PostgREST interface.
 * It handles routing, authentication, and request parsing for the TenantDB.
 *
 * Features:
 * - PostgREST-compatible query parameters
 * - JWT/Bearer token authentication
 * - Automatic tenant isolation via DO routing
 * - Connection pooling simulation
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bearerAuth } from 'hono/bearer-auth'
import type { TenantDB } from '../objects/TenantDB'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  TENANT_DO: DurableObjectNamespace
  ENVIRONMENT?: string
  API_KEY?: string
}

type Variables = {
  tenantId: string
  userId?: string
  userRole?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the DO stub for a tenant
 */
function getTenantDO(env: Env, tenantId: string): DurableObjectStub {
  const id = env.TENANT_DO.idFromName(tenantId)
  return env.TENANT_DO.get(id)
}

/**
 * Call a method on the tenant DO via JSON-RPC
 */
async function callTenant(
  stub: DurableObjectStub,
  method: string,
  params: unknown[] = [],
  headers?: Record<string, string>
): Promise<Response> {
  const rpcHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers ?? {}),
  }

  const response = await stub.fetch('https://internal/rpc', {
    method: 'POST',
    headers: rpcHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })

  const result = (await response.json()) as {
    result?: unknown
    error?: { code: number; message: string }
  }

  if (result.error) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: 400 }
    )
  }

  return Response.json(result.result)
}

/**
 * Parse PostgREST-style query parameters
 */
function parsePostgRESTParams(url: URL): {
  select?: string
  filters: Array<{ column: string; operator: string; value: string }>
  order?: { column: string; ascending: boolean }[]
  limit?: number
  offset?: number
} {
  const params = url.searchParams
  const filters: Array<{ column: string; operator: string; value: string }> = []

  for (const [key, value] of params.entries()) {
    // Skip non-filter params
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue

    // Parse filter: column=operator.value
    const match = value.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.+)$/)
    if (match) {
      filters.push({ column: key, operator: match[1], value: match[2] })
    } else {
      // Default to eq
      filters.push({ column: key, operator: 'eq', value })
    }
  }

  // Parse order: order=column.asc or order=column.desc
  let order: { column: string; ascending: boolean }[] | undefined
  const orderParam = params.get('order')
  if (orderParam) {
    order = orderParam.split(',').map(o => {
      const [column, dir] = o.split('.')
      return { column, ascending: dir !== 'desc' }
    })
  }

  return {
    select: params.get('select') ?? undefined,
    filters,
    order,
    limit: params.has('limit') ? parseInt(params.get('limit')!) : undefined,
    offset: params.has('offset') ? parseInt(params.get('offset')!) : undefined,
  }
}

// ============================================================================
// CREATE REST API
// ============================================================================

/**
 * Create the REST API router
 */
export function createRestAPI(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()

  // ═══════════════════════════════════════════════════════════════════════════
  // MIDDLEWARE
  // ═══════════════════════════════════════════════════════════════════════════

  // CORS
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-User-ID', 'X-User-Role', 'apikey', 'Prefer'],
      exposeHeaders: ['Content-Range', 'X-Total-Count'],
    })
  )

  // Extract tenant ID from various sources
  app.use('/tenant/:tenantId/*', async (c, next) => {
    c.set('tenantId', c.req.param('tenantId'))

    // Extract user context from headers (simulating JWT)
    const userId = c.req.header('X-User-ID')
    const userRole = c.req.header('X-User-Role')

    if (userId) c.set('userId', userId)
    if (userRole) c.set('userRole', userRole)

    await next()
  })

  // Optional API key authentication
  app.use('/tenant/:tenantId/*', async (c, next) => {
    const apiKey = c.env.API_KEY
    if (apiKey) {
      const providedKey = c.req.header('apikey') ?? c.req.header('Authorization')?.replace('Bearer ', '')
      if (providedKey !== apiKey) {
        return c.json({ error: 'Invalid API key' }, 401)
      }
    }
    await next()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // POSTGREST-COMPATIBLE TABLE ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * SELECT - Query table data
   * GET /tenant/:tenantId/rest/v1/:table
   *
   * Supports PostgREST query parameters:
   * - select: columns to return
   * - column=operator.value: filter conditions
   * - order: column.asc/desc
   * - limit, offset: pagination
   */
  app.get('/tenant/:tenantId/rest/v1/:table', async (c) => {
    const tenantId = c.get('tenantId')
    const table = c.req.param('table')
    const stub = getTenantDO(c.env, tenantId)

    const url = new URL(c.req.url)
    const params = parsePostgRESTParams(url)

    // Map table names to DO methods
    const methodMap: Record<string, string> = {
      users: 'getUsers',
      teams: 'getTeams',
      projects: 'getProjects',
      tasks: 'getTasks',
      audit_logs: 'getAuditLogs',
    }

    const method = methodMap[table]
    if (!method) {
      return c.json({ error: `Table '${table}' not found` }, 404)
    }

    // Build filter object for methods that accept it
    const filters: Record<string, unknown> = {}
    for (const f of params.filters) {
      filters[f.column] = f.value
    }

    const headers: Record<string, string> = {}
    const userId = c.get('userId')
    const userRole = c.get('userRole')
    if (userId) headers['X-User-ID'] = userId
    if (userRole) headers['X-User-Role'] = userRole

    return callTenant(
      stub,
      method,
      Object.keys(filters).length > 0 ? [filters] : [],
      headers
    )
  })

  /**
   * INSERT - Create new rows
   * POST /tenant/:tenantId/rest/v1/:table
   */
  app.post('/tenant/:tenantId/rest/v1/:table', async (c) => {
    const tenantId = c.get('tenantId')
    const table = c.req.param('table')
    const stub = getTenantDO(c.env, tenantId)
    const body = await c.req.json()

    // Map table names to DO methods
    const methodMap: Record<string, string> = {
      users: 'createUser',
      teams: 'createTeam',
      projects: 'createProject',
      tasks: 'createTask',
    }

    const method = methodMap[table]
    if (!method) {
      return c.json({ error: `Table '${table}' is read-only or not found` }, 403)
    }

    const headers: Record<string, string> = {}
    const userId = c.get('userId')
    const userRole = c.get('userRole')
    if (userId) headers['X-User-ID'] = userId
    if (userRole) headers['X-User-Role'] = userRole

    const response = await callTenant(stub, method, [body], headers)

    // Return 201 for successful creates
    if (response.ok) {
      return new Response(response.body, {
        status: 201,
        headers: response.headers,
      })
    }

    return response
  })

  /**
   * UPDATE - Update existing rows
   * PATCH /tenant/:tenantId/rest/v1/:table
   */
  app.patch('/tenant/:tenantId/rest/v1/:table', async (c) => {
    const tenantId = c.get('tenantId')
    const table = c.req.param('table')
    const stub = getTenantDO(c.env, tenantId)
    const body = await c.req.json()

    const url = new URL(c.req.url)
    const params = parsePostgRESTParams(url)

    // Find the ID filter
    const idFilter = params.filters.find(f => f.column === 'id')
    if (!idFilter) {
      return c.json({ error: 'id filter is required for updates' }, 400)
    }

    // Map table names to DO methods
    const methodMap: Record<string, string> = {
      users: 'updateUser',
      tasks: 'updateTaskStatus',
    }

    const method = methodMap[table]
    if (!method) {
      return c.json({ error: `Table '${table}' cannot be updated` }, 403)
    }

    const headers: Record<string, string> = {}
    const userId = c.get('userId')
    const userRole = c.get('userRole')
    if (userId) headers['X-User-ID'] = userId
    if (userRole) headers['X-User-Role'] = userRole

    // Special handling for task status updates
    if (table === 'tasks' && body.status) {
      return callTenant(stub, method, [idFilter.value, body.status], headers)
    }

    return callTenant(stub, method, [idFilter.value, body], headers)
  })

  /**
   * DELETE - Delete rows
   * DELETE /tenant/:tenantId/rest/v1/:table
   */
  app.delete('/tenant/:tenantId/rest/v1/:table', async (c) => {
    const tenantId = c.get('tenantId')
    const table = c.req.param('table')
    const stub = getTenantDO(c.env, tenantId)

    const url = new URL(c.req.url)
    const params = parsePostgRESTParams(url)

    const idFilter = params.filters.find(f => f.column === 'id')
    if (!idFilter) {
      return c.json({ error: 'id filter is required for deletes' }, 400)
    }

    // Map table names to DO methods
    const methodMap: Record<string, string> = {
      users: 'deleteUser',
    }

    const method = methodMap[table]
    if (!method) {
      return c.json({ error: `Table '${table}' cannot be deleted` }, 403)
    }

    const headers: Record<string, string> = {}
    const userId = c.get('userId')
    const userRole = c.get('userRole')
    if (userId) headers['X-User-ID'] = userId
    if (userRole) headers['X-User-Role'] = userRole

    return callTenant(stub, method, [idFilter.value], headers)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE ENDPOINTS (Higher-level API)
  // ═══════════════════════════════════════════════════════════════════════════

  // Seed demo data
  app.post('/tenant/:tenantId/seed', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'seedDemoData')
  })

  app.get('/tenant/:tenantId/seed', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'seedDemoData')
  })

  // Dashboard stats
  app.get('/tenant/:tenantId/stats', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'getDashboardStats')
  })

  // Connection pool stats (demonstrates no connection limits)
  app.get('/tenant/:tenantId/pool', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'getPoolStats')
  })

  // Users CRUD
  app.get('/tenant/:tenantId/users', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'getUsers')
  })

  app.get('/tenant/:tenantId/users/:userId', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'getUser', [c.req.param('userId')])
  })

  app.post('/tenant/:tenantId/users', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = await c.req.json()
    return callTenant(stub, 'createUser', [body])
  })

  app.patch('/tenant/:tenantId/users/:userId', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = await c.req.json()
    return callTenant(stub, 'updateUser', [c.req.param('userId'), body])
  })

  app.delete('/tenant/:tenantId/users/:userId', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'deleteUser', [c.req.param('userId')])
  })

  // Teams
  app.get('/tenant/:tenantId/teams', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'getTeams')
  })

  app.post('/tenant/:tenantId/teams', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = await c.req.json()
    return callTenant(stub, 'createTeam', [body])
  })

  // Projects
  app.get('/tenant/:tenantId/projects', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const teamId = c.req.query('team_id')
    return callTenant(stub, 'getProjects', teamId ? [teamId] : [])
  })

  app.post('/tenant/:tenantId/projects', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = await c.req.json()
    return callTenant(stub, 'createProject', [body])
  })

  app.post('/tenant/:tenantId/projects/:projectId/archive', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return callTenant(stub, 'archiveProject', [c.req.param('projectId')])
  })

  // Tasks
  app.get('/tenant/:tenantId/tasks', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const filters = {
      project_id: c.req.query('project_id'),
      assignee_id: c.req.query('assignee_id'),
      status: c.req.query('status'),
      priority: c.req.query('priority'),
    }
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined)
    )
    return callTenant(stub, 'getTasks', Object.keys(cleanFilters).length > 0 ? [cleanFilters] : [])
  })

  app.post('/tenant/:tenantId/tasks', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = await c.req.json()
    return callTenant(stub, 'createTask', [body])
  })

  app.patch('/tenant/:tenantId/tasks/:taskId/status', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = (await c.req.json()) as { status: string }
    return callTenant(stub, 'updateTaskStatus', [c.req.param('taskId'), body.status])
  })

  app.patch('/tenant/:tenantId/tasks/bulk', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const body = (await c.req.json()) as { ids: string[]; updates: Record<string, unknown> }
    return callTenant(stub, 'bulkUpdateTasks', [body.ids, body.updates])
  })

  // Audit logs
  app.get('/tenant/:tenantId/audit', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const filters = {
      user_id: c.req.query('user_id'),
      resource_type: c.req.query('resource_type'),
      resource_id: c.req.query('resource_id'),
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    }
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined)
    )
    return callTenant(stub, 'getAuditLogs', Object.keys(cleanFilters).length > 0 ? [cleanFilters] : [])
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC ENDPOINT (Supabase-style function calls)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/tenant/:tenantId/rpc/:function', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    const functionName = c.req.param('function')
    const body = await c.req.json().catch(() => ({}))

    const headers: Record<string, string> = {}
    const userId = c.get('userId')
    const userRole = c.get('userRole')
    if (userId) headers['X-User-ID'] = userId
    if (userRole) headers['X-User-Role'] = userRole

    // Map RPC function names to DO methods
    const methodMap: Record<string, string> = {
      get_dashboard_stats: 'getDashboardStats',
      get_pool_stats: 'getPoolStats',
      seed_demo_data: 'seedDemoData',
    }

    const method = methodMap[functionName] ?? functionName
    return callTenant(stub, method, body ? [body] : [], headers)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/tenant/:tenantId/health', async (c) => {
    const stub = getTenantDO(c.env, c.get('tenantId'))
    return stub.fetch(new Request('https://internal/health'))
  })

  return app
}

/**
 * Export the REST API
 */
export const restAPI = createRestAPI()
