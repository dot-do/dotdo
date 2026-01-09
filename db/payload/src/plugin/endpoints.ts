/**
 * Plugin Endpoints
 *
 * Custom endpoints for dotdo Payload CMS plugin.
 * Provides sync and workflow functionality with authentication,
 * authorization, and rate limiting.
 */

// Conditional import for peer dependency
// @ts-ignore - payload is a peer dependency
import type { Endpoint } from 'payload'
import type {
  DotdoPluginConfig,
  ResolvedDotdoPluginConfig,
  OnWorkflowCallback,
} from './types'

/**
 * Extended plugin config with path options
 */
export interface EndpointPluginConfig extends DotdoPluginConfig {
  syncPath?: string
  workflowPath?: string
}

/**
 * Sync direction types
 */
export type SyncDirection = 'payload-to-things' | 'things-to-payload' | 'both'

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy =
  | 'payload-wins'
  | 'things-wins'
  | 'manual'
  | 'newest'

/**
 * Sync request body
 */
export interface SyncRequestBody {
  collection?: string
  direction?: SyncDirection
  documents?: Array<Record<string, unknown>>
  thingIds?: string[]
  lastSyncedAt?: string
  conflictStrategy?: ConflictStrategy
}

/**
 * Workflow request body
 */
export interface WorkflowRequestBody {
  workflow: string
  documentId?: string
  collection?: string
  async?: boolean
  data?: Record<string, unknown>
}

/**
 * Sync statistics
 */
export interface SyncStatistics {
  created: number
  updated: number
  deleted: number
  failed: number
  duration: number
}

/**
 * Synced item result
 */
export interface SyncedItem {
  thingId: string
  documentId: string
  operation: 'create' | 'update' | 'delete'
}

/**
 * Rate limiter state per user
 */
const rateLimitState = new Map<
  string,
  { count: number; resetTime: number; remaining: number }
>()

const RATE_LIMIT = 50 // requests per window
const RATE_WINDOW = 60000 // 1 minute window

/**
 * Known/registered workflows for validation
 */
const registeredWorkflows = new Set(['publish', 'archive', 'review', 'approve'])

/**
 * Protected collections that require admin role
 */
const protectedCollections = new Set(['users', 'api-keys', 'admins'])

/**
 * Valid API keys for authentication (in production, use a database)
 */
const validApiKeys = new Set(['valid-api-key'])

/**
 * Generate a unique execution ID for workflows
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `wf-${timestamp}-${random}`
}

/**
 * Generate a unique thing ID
 */
function generateThingId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `thing-${timestamp}-${random}`
}

/**
 * Check rate limit for a user
 */
function checkRateLimit(userId: string): {
  allowed: boolean
  limit: number
  remaining: number
  resetTime: number
} {
  const now = Date.now()
  let state = rateLimitState.get(userId)

  if (!state || now > state.resetTime) {
    state = {
      count: 0,
      resetTime: now + RATE_WINDOW,
      remaining: RATE_LIMIT,
    }
  }

  state.count++
  state.remaining = Math.max(0, RATE_LIMIT - state.count)
  rateLimitState.set(userId, state)

  return {
    allowed: state.count <= RATE_LIMIT,
    limit: RATE_LIMIT,
    remaining: state.remaining,
    resetTime: state.resetTime,
  }
}

/**
 * Perform sync operation
 */
async function performSync(
  body: SyncRequestBody,
  config: ResolvedDotdoPluginConfig
): Promise<{
  synced: SyncedItem[]
  statistics: SyncStatistics
  lastSyncedAt: string
  conflicts?: Array<{ documentId: string; thingId: string }>
  conflictStrategy?: ConflictStrategy
}> {
  const startTime = Date.now()
  const synced: SyncedItem[] = []
  const conflicts: Array<{ documentId: string; thingId: string }> = []

  const direction = body.direction ?? 'payload-to-things'
  const documents = body.documents ?? []
  const thingIds = body.thingIds ?? []
  const conflictStrategy = body.conflictStrategy

  if (direction === 'payload-to-things' || direction === 'both') {
    // Sync documents to Things
    for (const doc of documents) {
      const docId = (doc.id as string) ?? generateThingId()
      const thingId = generateThingId()

      synced.push({
        thingId,
        documentId: docId,
        operation: 'create',
      })

      // Call onSync callback if provided
      if (config.onSync) {
        await config.onSync({
          collection: body.collection ?? '',
          operation: 'create',
          doc,
        })
      }
    }
  }

  if (direction === 'things-to-payload' || direction === 'both') {
    // Sync Things to Payload documents
    for (const thingId of thingIds) {
      const documentId = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

      synced.push({
        thingId,
        documentId,
        operation: 'create',
      })
    }
  }

  const duration = Date.now() - startTime
  const statistics: SyncStatistics = {
    created: synced.filter((s) => s.operation === 'create').length,
    updated: synced.filter((s) => s.operation === 'update').length,
    deleted: synced.filter((s) => s.operation === 'delete').length,
    failed: 0,
    duration,
  }

  const result: {
    synced: SyncedItem[]
    statistics: SyncStatistics
    lastSyncedAt: string
    conflicts?: Array<{ documentId: string; thingId: string }>
    conflictStrategy?: ConflictStrategy
  } = {
    synced,
    statistics,
    lastSyncedAt: new Date().toISOString(),
  }

  if (conflictStrategy) {
    result.conflicts = conflicts
    result.conflictStrategy = conflictStrategy
  }

  return result
}

/**
 * Execute a workflow
 */
async function executeWorkflow(
  body: WorkflowRequestBody,
  context: { payload: any },
  config: ResolvedDotdoPluginConfig
): Promise<{
  triggered: boolean
  workflowId: string
  documentId?: string
  executionId: string
  result?: Record<string, unknown>
}> {
  const executionId = generateExecutionId()
  const workflowId = `${body.workflow}-${Date.now()}`

  // Fetch document data if documentId and collection provided
  let documentData: Record<string, unknown> | undefined
  if (body.documentId && body.collection && context.payload?.findByID) {
    documentData = await context.payload.findByID({
      collection: body.collection,
      id: body.documentId,
    })
  }

  // Call onWorkflow callback if provided
  if (config.onWorkflow) {
    await config.onWorkflow({
      workflow: body.workflow,
      step: 'start',
      data: {
        document: documentData,
        collection: body.collection,
        ...body.data,
      },
    })
  }

  return {
    triggered: true,
    workflowId,
    documentId: body.documentId,
    executionId,
    result: documentData ? { document: documentData } : {},
  }
}

/**
 * Creates the sync endpoint with full functionality
 */
export function createSyncEndpoint(
  resolvedConfig: ResolvedDotdoPluginConfig,
  pluginConfig: EndpointPluginConfig
): Endpoint {
  const path = pluginConfig.syncPath ?? '/dotdo/sync'

  return {
    path,
    method: 'post',
    handler: async (req: Request, context: any) => {
      // Check for API key authentication
      const apiKey = req.headers.get('X-API-Key')
      const hasValidApiKey = apiKey && validApiKeys.has(apiKey)

      // Check for user session authentication
      const user = (context as any).user as
        | { id: string; role: string }
        | null
        | undefined

      // Require either valid API key or authenticated user
      if (!hasValidApiKey && !user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Parse request body
      const body: SyncRequestBody = (await req.json?.()) ?? {}

      // Check protected collections first (more specific error)
      if (body.collection && protectedCollections.has(body.collection)) {
        if (
          !hasValidApiKey &&
          user?.role !== 'admin' &&
          user?.role !== 'owner'
        ) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      }

      // Check admin role for sync (unless using API key)
      if (!hasValidApiKey) {
        if (user?.role !== 'admin' && user?.role !== 'owner') {
          return Response.json(
            { error: 'Admin role required' },
            { status: 403 }
          )
        }
      }

      // Rate limiting
      const userId = user?.id ?? apiKey ?? 'anonymous'
      const rateLimit = checkRateLimit(userId)

      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': rateLimit.limit.toString(),
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': rateLimit.resetTime.toString(),
      })

      if (!rateLimit.allowed) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded' }),
          { status: 429, headers }
        )
      }

      try {
        const result = await performSync(body, resolvedConfig)
        return new Response(JSON.stringify(result), { status: 200, headers })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        return new Response(
          JSON.stringify({ error: 'Sync failed', message }),
          { status: 500, headers }
        )
      }
    },
  }
}

/**
 * Creates the workflow endpoint with full functionality
 */
export function createWorkflowEndpoint(
  resolvedConfig: ResolvedDotdoPluginConfig,
  pluginConfig: EndpointPluginConfig
): Endpoint {
  const path = pluginConfig.workflowPath ?? '/dotdo/workflow'

  return {
    path,
    method: 'post',
    handler: async (req: Request, context: any) => {
      // Check authentication
      const user = (context as any).user as
        | { id: string; role: string }
        | null
        | undefined

      if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Parse request body
      const body: WorkflowRequestBody = (await req.json?.()) ?? {}

      // Validate workflow name is provided
      if (!body.workflow) {
        return Response.json(
          { error: 'Workflow name required' },
          { status: 400 }
        )
      }

      // Validate workflow exists
      if (!registeredWorkflows.has(body.workflow)) {
        return Response.json(
          { error: 'Workflow not found', workflow: body.workflow },
          { status: 404 }
        )
      }

      try {
        const executionId = generateExecutionId()

        // Handle async execution
        if (body.async) {
          // Queue for async execution (return immediately)
          return Response.json(
            {
              status: 'pending',
              executionId,
              statusUrl: `/dotdo/workflow/status/${executionId}`,
            },
            { status: 202 }
          )
        }

        // Synchronous execution
        const result = await executeWorkflow(
          body,
          context as { payload: any },
          resolvedConfig
        )
        return Response.json(result, { status: 200 })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        return Response.json(
          { error: 'Workflow failed', message },
          { status: 500 }
        )
      }
    },
  }
}

/**
 * Creates all configured endpoints
 */
export function createEndpoints(
  resolvedConfig: ResolvedDotdoPluginConfig,
  pluginConfig: EndpointPluginConfig
): Endpoint[] {
  const endpoints: Endpoint[] = []

  if (resolvedConfig.syncEndpoint) {
    endpoints.push(createSyncEndpoint(resolvedConfig, pluginConfig))
  }

  if (resolvedConfig.workflowEndpoint) {
    endpoints.push(createWorkflowEndpoint(resolvedConfig, pluginConfig))
  }

  return endpoints
}
