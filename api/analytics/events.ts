/**
 * Event Collector API Router
 *
 * Segment-compatible HTTP API for event collection:
 * - POST /v1/track - Record user actions
 * - POST /v1/identify - Associate user with traits
 * - POST /v1/page - Record page views
 * - POST /v1/screen - Record mobile screen views
 * - POST /v1/group - Associate user with a group
 * - POST /v1/alias - Link user identities
 * - POST /v1/batch - Send multiple events at once
 *
 * @module api/analytics/events
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import type {
  TrackRequest,
  IdentifyRequest,
  PageRequest,
  ScreenRequest,
  GroupRequest,
  AliasRequest,
  BatchRequest,
  BatchEvent,
  EventResponse,
  BatchResponse,
  EventError,
  EventErrorCode,
  EventValidationResult,
  EventContext,
  EventType,
} from '../../types/events-api'

// ============================================================================
// ROUTER SETUP
// ============================================================================

export const eventsRouter = new Hono<{ Bindings: Env }>()

// ============================================================================
// CONSTANTS
// ============================================================================

const SDK_NAME = 'dotdo-events-api'
const SDK_VERSION = '1.0.0'
const MAX_BATCH_SIZE = 100
const MAX_PROPERTY_SIZE = 32768 // 32KB per property value

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a UUID v4 message ID
 */
function generateMessageId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version 4
  const byte6 = bytes[6]
  const byte8 = bytes[8]
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40
  }
  // Set variant
  if (byte8 !== undefined) {
    bytes[8] = (byte8 & 0x3f) | 0x80
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Get ISO timestamp
 */
function getTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Enrich context with library info
 */
function enrichContext(context?: EventContext): EventContext {
  return {
    ...context,
    library: {
      name: SDK_NAME,
      version: SDK_VERSION,
    },
  }
}

/**
 * Normalize timestamp to ISO string
 */
function normalizeTimestamp(timestamp?: string | Date): string {
  if (!timestamp) {
    return getTimestamp()
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString()
  }
  // Validate it's a valid date string
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) {
    return getTimestamp()
  }
  return date.toISOString()
}

// ============================================================================
// ERROR HELPERS
// ============================================================================

/**
 * Create an event error response
 */
function eventError(
  code: EventErrorCode,
  message: string,
  details?: Record<string, unknown>
): EventError {
  return { code, message, details }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that request has userId or anonymousId
 */
function validateIdentity(body: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (!body.userId && !body.anonymousId) {
    errors.push('Either userId or anonymousId is required')
  }
  if (body.userId !== undefined && typeof body.userId !== 'string') {
    errors.push('userId must be a string')
  }
  if (body.anonymousId !== undefined && typeof body.anonymousId !== 'string') {
    errors.push('anonymousId must be a string')
  }
  return errors
}

/**
 * Validate track request
 */
function validateTrackRequest(body: unknown): EventValidationResult<TrackRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate identity
  errors.push(...validateIdentity(req))

  // Validate event name (required)
  if (!req.event) {
    errors.push('event name is required')
  } else if (typeof req.event !== 'string') {
    errors.push('event must be a string')
  } else if (req.event.trim().length === 0) {
    errors.push('event name cannot be empty')
  }

  // Validate properties (optional)
  if (req.properties !== undefined && (typeof req.properties !== 'object' || req.properties === null || Array.isArray(req.properties))) {
    errors.push('properties must be an object')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      event: req.event as string,
      userId: req.userId as string | undefined,
      anonymousId: req.anonymousId as string | undefined,
      properties: req.properties as Record<string, unknown> | undefined,
      context: req.context as EventContext | undefined,
      timestamp: req.timestamp as string | Date | undefined,
      messageId: req.messageId as string | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

/**
 * Validate identify request
 */
function validateIdentifyRequest(body: unknown): EventValidationResult<IdentifyRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate identity
  errors.push(...validateIdentity(req))

  // Validate traits (optional)
  if (req.traits !== undefined && (typeof req.traits !== 'object' || req.traits === null || Array.isArray(req.traits))) {
    errors.push('traits must be an object')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      userId: req.userId as string | undefined,
      anonymousId: req.anonymousId as string | undefined,
      traits: req.traits as Record<string, unknown> | undefined,
      context: req.context as EventContext | undefined,
      timestamp: req.timestamp as string | Date | undefined,
      messageId: req.messageId as string | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

/**
 * Validate page request
 */
function validatePageRequest(body: unknown): EventValidationResult<PageRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate identity
  errors.push(...validateIdentity(req))

  // Validate name (optional)
  if (req.name !== undefined && typeof req.name !== 'string') {
    errors.push('name must be a string')
  }

  // Validate category (optional)
  if (req.category !== undefined && typeof req.category !== 'string') {
    errors.push('category must be a string')
  }

  // Validate properties (optional)
  if (req.properties !== undefined && (typeof req.properties !== 'object' || req.properties === null || Array.isArray(req.properties))) {
    errors.push('properties must be an object')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      userId: req.userId as string | undefined,
      anonymousId: req.anonymousId as string | undefined,
      name: req.name as string | undefined,
      category: req.category as string | undefined,
      properties: req.properties as Record<string, unknown> | undefined,
      context: req.context as EventContext | undefined,
      timestamp: req.timestamp as string | Date | undefined,
      messageId: req.messageId as string | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

/**
 * Validate screen request
 */
function validateScreenRequest(body: unknown): EventValidationResult<ScreenRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate identity
  errors.push(...validateIdentity(req))

  // Validate name (required for screen)
  if (!req.name) {
    errors.push('name is required for screen events')
  } else if (typeof req.name !== 'string') {
    errors.push('name must be a string')
  }

  // Validate category (optional)
  if (req.category !== undefined && typeof req.category !== 'string') {
    errors.push('category must be a string')
  }

  // Validate properties (optional)
  if (req.properties !== undefined && (typeof req.properties !== 'object' || req.properties === null || Array.isArray(req.properties))) {
    errors.push('properties must be an object')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      userId: req.userId as string | undefined,
      anonymousId: req.anonymousId as string | undefined,
      name: req.name as string,
      category: req.category as string | undefined,
      properties: req.properties as Record<string, unknown> | undefined,
      context: req.context as EventContext | undefined,
      timestamp: req.timestamp as string | Date | undefined,
      messageId: req.messageId as string | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

/**
 * Validate group request
 */
function validateGroupRequest(body: unknown): EventValidationResult<GroupRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate identity
  errors.push(...validateIdentity(req))

  // Validate groupId (required)
  if (!req.groupId) {
    errors.push('groupId is required')
  } else if (typeof req.groupId !== 'string') {
    errors.push('groupId must be a string')
  } else if (req.groupId.trim().length === 0) {
    errors.push('groupId cannot be empty')
  }

  // Validate traits (optional)
  if (req.traits !== undefined && (typeof req.traits !== 'object' || req.traits === null || Array.isArray(req.traits))) {
    errors.push('traits must be an object')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      userId: req.userId as string | undefined,
      anonymousId: req.anonymousId as string | undefined,
      groupId: req.groupId as string,
      traits: req.traits as Record<string, unknown> | undefined,
      context: req.context as EventContext | undefined,
      timestamp: req.timestamp as string | Date | undefined,
      messageId: req.messageId as string | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

/**
 * Validate alias request
 */
function validateAliasRequest(body: unknown): EventValidationResult<AliasRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate previousId (required)
  if (!req.previousId) {
    errors.push('previousId is required')
  } else if (typeof req.previousId !== 'string') {
    errors.push('previousId must be a string')
  } else if (req.previousId.trim().length === 0) {
    errors.push('previousId cannot be empty')
  }

  // Validate userId (required)
  if (!req.userId) {
    errors.push('userId is required')
  } else if (typeof req.userId !== 'string') {
    errors.push('userId must be a string')
  } else if (req.userId.trim().length === 0) {
    errors.push('userId cannot be empty')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      previousId: req.previousId as string,
      userId: req.userId as string,
      context: req.context as EventContext | undefined,
      timestamp: req.timestamp as string | Date | undefined,
      messageId: req.messageId as string | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

/**
 * Validate a single batch event
 */
function validateBatchEvent(event: unknown, index: number): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!event || typeof event !== 'object') {
    return { valid: false, errors: [`batch[${index}] must be an object`] }
  }

  const evt = event as Record<string, unknown>

  // Validate type (required for batch)
  const validTypes: EventType[] = ['track', 'identify', 'page', 'screen', 'group', 'alias']
  if (!evt.type) {
    errors.push(`batch[${index}].type is required`)
  } else if (!validTypes.includes(evt.type as EventType)) {
    errors.push(`batch[${index}].type must be one of: ${validTypes.join(', ')}`)
  }

  // Type-specific validation
  if (evt.type === 'track') {
    if (!evt.event) {
      errors.push(`batch[${index}].event is required for track events`)
    }
    if (!evt.userId && !evt.anonymousId) {
      errors.push(`batch[${index}] requires userId or anonymousId`)
    }
  } else if (evt.type === 'identify' || evt.type === 'page' || evt.type === 'screen') {
    if (!evt.userId && !evt.anonymousId) {
      errors.push(`batch[${index}] requires userId or anonymousId`)
    }
    if (evt.type === 'screen' && !evt.name) {
      errors.push(`batch[${index}].name is required for screen events`)
    }
  } else if (evt.type === 'group') {
    if (!evt.groupId) {
      errors.push(`batch[${index}].groupId is required for group events`)
    }
    if (!evt.userId && !evt.anonymousId) {
      errors.push(`batch[${index}] requires userId or anonymousId`)
    }
  } else if (evt.type === 'alias') {
    if (!evt.previousId) {
      errors.push(`batch[${index}].previousId is required for alias events`)
    }
    if (!evt.userId) {
      errors.push(`batch[${index}].userId is required for alias events`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate batch request
 */
function validateBatchRequest(body: unknown): EventValidationResult<BatchRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate batch array (required)
  if (!req.batch) {
    errors.push('batch array is required')
  } else if (!Array.isArray(req.batch)) {
    errors.push('batch must be an array')
  } else if (req.batch.length === 0) {
    errors.push('batch array cannot be empty')
  } else if (req.batch.length > MAX_BATCH_SIZE) {
    errors.push(`batch size cannot exceed ${MAX_BATCH_SIZE} events`)
  } else {
    // Validate each event in the batch
    for (let i = 0; i < req.batch.length; i++) {
      const result = validateBatchEvent(req.batch[i], i)
      if (!result.valid) {
        errors.push(...result.errors)
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      batch: req.batch as BatchEvent[],
      context: req.context as EventContext | undefined,
      integrations: req.integrations as Record<string, boolean | Record<string, unknown>> | undefined,
    },
  }
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

/**
 * Store event to the appropriate storage backend
 * This is a placeholder that will be expanded to support:
 * - Analytics Engine (writeDataPoint)
 * - Queue (for async processing)
 * - DO (for real-time)
 */
async function storeEvent(
  _env: Env,
  type: EventType,
  event: Record<string, unknown>
): Promise<void> {
  // TODO: Integrate with AnalyticsCollector primitive
  // TODO: Write to Analytics Engine if available
  // TODO: Queue for async destination delivery

  // For now, we just validate and return success
  // In production, this would:
  // 1. Write to Analytics Engine (AE.writeDataPoint)
  // 2. Enqueue for destination fan-out (Queue)
  // 3. Update user identity store (DO)

  // Example Analytics Engine integration (when available):
  // if (env.AE) {
  //   env.AE.writeDataPoint({
  //     indexes: [event.userId || event.anonymousId],
  //     blobs: [type, event.event || '', JSON.stringify(event.properties || {})],
  //     doubles: [Date.now()],
  //   })
  // }

  // Suppress unused variable warning
  void type
  void event
}

// ============================================================================
// TRACK ENDPOINT
// ============================================================================

/**
 * POST /v1/track - Record a user action
 *
 * Records an event representing a user action with optional properties.
 * This is the primary method for recording user behavior.
 */
eventsRouter.post('/v1/track', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validateTrackRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_EVENT', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const messageId = request.messageId || generateMessageId()
  const timestamp = normalizeTimestamp(request.timestamp)

  // Build the complete event
  const event = {
    type: 'track' as const,
    messageId,
    timestamp,
    userId: request.userId,
    anonymousId: request.anonymousId,
    event: request.event,
    properties: request.properties,
    context: enrichContext(request.context),
    integrations: request.integrations,
  }

  // Store the event
  try {
    await storeEvent(c.env, 'track', event)
  } catch (error) {
    return c.json(
      {
        error: eventError('INTERNAL_ERROR', 'Failed to store event', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      500
    )
  }

  // Return success response
  const response: EventResponse = {
    success: true,
    messageId,
    receivedAt: getTimestamp(),
  }

  return c.json(response, 200)
})

// ============================================================================
// IDENTIFY ENDPOINT
// ============================================================================

/**
 * POST /v1/identify - Associate traits with a user
 *
 * Links a user ID with traits like email, name, plan, etc.
 * Creates or updates the user's profile.
 */
eventsRouter.post('/v1/identify', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validateIdentifyRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_EVENT', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const messageId = request.messageId || generateMessageId()
  const timestamp = normalizeTimestamp(request.timestamp)

  // Build the complete event
  const event = {
    type: 'identify' as const,
    messageId,
    timestamp,
    userId: request.userId,
    anonymousId: request.anonymousId,
    traits: request.traits,
    context: enrichContext(request.context),
    integrations: request.integrations,
  }

  // Store the event
  try {
    await storeEvent(c.env, 'identify', event)
  } catch (error) {
    return c.json(
      {
        error: eventError('INTERNAL_ERROR', 'Failed to store event', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      500
    )
  }

  // Return success response
  const response: EventResponse = {
    success: true,
    messageId,
    receivedAt: getTimestamp(),
  }

  return c.json(response, 200)
})

// ============================================================================
// PAGE ENDPOINT
// ============================================================================

/**
 * POST /v1/page - Record a page view
 *
 * Records when a user views a page on your website.
 * Includes page name, category, and URL properties.
 */
eventsRouter.post('/v1/page', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validatePageRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_EVENT', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const messageId = request.messageId || generateMessageId()
  const timestamp = normalizeTimestamp(request.timestamp)

  // Build the complete event
  const event = {
    type: 'page' as const,
    messageId,
    timestamp,
    userId: request.userId,
    anonymousId: request.anonymousId,
    name: request.name,
    category: request.category,
    properties: request.properties,
    context: enrichContext(request.context),
    integrations: request.integrations,
  }

  // Store the event
  try {
    await storeEvent(c.env, 'page', event)
  } catch (error) {
    return c.json(
      {
        error: eventError('INTERNAL_ERROR', 'Failed to store event', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      500
    )
  }

  // Return success response
  const response: EventResponse = {
    success: true,
    messageId,
    receivedAt: getTimestamp(),
  }

  return c.json(response, 200)
})

// ============================================================================
// SCREEN ENDPOINT
// ============================================================================

/**
 * POST /v1/screen - Record a mobile screen view
 *
 * The mobile equivalent of page. Records when a user views
 * a screen in your mobile app.
 */
eventsRouter.post('/v1/screen', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validateScreenRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_EVENT', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const messageId = request.messageId || generateMessageId()
  const timestamp = normalizeTimestamp(request.timestamp)

  // Build the complete event
  const event = {
    type: 'screen' as const,
    messageId,
    timestamp,
    userId: request.userId,
    anonymousId: request.anonymousId,
    name: request.name,
    category: request.category,
    properties: request.properties,
    context: enrichContext(request.context),
    integrations: request.integrations,
  }

  // Store the event
  try {
    await storeEvent(c.env, 'screen', event)
  } catch (error) {
    return c.json(
      {
        error: eventError('INTERNAL_ERROR', 'Failed to store event', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      500
    )
  }

  // Return success response
  const response: EventResponse = {
    success: true,
    messageId,
    receivedAt: getTimestamp(),
  }

  return c.json(response, 200)
})

// ============================================================================
// GROUP ENDPOINT
// ============================================================================

/**
 * POST /v1/group - Associate user with a group
 *
 * Associates a user with a group (company, organization, team).
 * Includes group traits like name, plan, size.
 */
eventsRouter.post('/v1/group', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validateGroupRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_EVENT', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const messageId = request.messageId || generateMessageId()
  const timestamp = normalizeTimestamp(request.timestamp)

  // Build the complete event
  const event = {
    type: 'group' as const,
    messageId,
    timestamp,
    userId: request.userId,
    anonymousId: request.anonymousId,
    groupId: request.groupId,
    traits: request.traits,
    context: enrichContext(request.context),
    integrations: request.integrations,
  }

  // Store the event
  try {
    await storeEvent(c.env, 'group', event)
  } catch (error) {
    return c.json(
      {
        error: eventError('INTERNAL_ERROR', 'Failed to store event', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      500
    )
  }

  // Return success response
  const response: EventResponse = {
    success: true,
    messageId,
    receivedAt: getTimestamp(),
  }

  return c.json(response, 200)
})

// ============================================================================
// ALIAS ENDPOINT
// ============================================================================

/**
 * POST /v1/alias - Link two user identities
 *
 * Links two user identities together (e.g., anonymous ID to user ID).
 * Useful for merging user profiles after signup/login.
 */
eventsRouter.post('/v1/alias', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validateAliasRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_EVENT', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const messageId = request.messageId || generateMessageId()
  const timestamp = normalizeTimestamp(request.timestamp)

  // Build the complete event
  const event = {
    type: 'alias' as const,
    messageId,
    timestamp,
    previousId: request.previousId,
    userId: request.userId,
    context: enrichContext(request.context),
    integrations: request.integrations,
  }

  // Store the event
  try {
    await storeEvent(c.env, 'alias', event)
  } catch (error) {
    return c.json(
      {
        error: eventError('INTERNAL_ERROR', 'Failed to store event', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      500
    )
  }

  // Return success response
  const response: EventResponse = {
    success: true,
    messageId,
    receivedAt: getTimestamp(),
  }

  return c.json(response, 200)
})

// ============================================================================
// BATCH ENDPOINT
// ============================================================================

/**
 * POST /v1/batch - Send multiple events at once
 *
 * Accepts an array of events to process. More efficient than
 * individual requests for high-volume scenarios.
 */
eventsRouter.post('/v1/batch', async (c) => {
  // Parse request body
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: eventError('INVALID_REQUEST', 'Invalid JSON body') },
      400
    )
  }

  // Validate request
  const validation = validateBatchRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: eventError('INVALID_BATCH', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const results: Array<{ messageId: string; success: boolean; error?: string }> = []
  let succeeded = 0
  let failed = 0

  // Process each event in the batch
  for (const batchEvent of request.batch) {
    const messageId = batchEvent.messageId || generateMessageId()
    const timestamp = normalizeTimestamp(batchEvent.timestamp)

    // Merge batch-level context with event context
    const mergedContext = {
      ...request.context,
      ...batchEvent.context,
    }

    // Build the complete event
    const event = {
      ...batchEvent,
      messageId,
      timestamp,
      context: enrichContext(mergedContext),
      integrations: {
        ...request.integrations,
        ...batchEvent.integrations,
      },
    }

    // Store the event
    try {
      await storeEvent(c.env, batchEvent.type, event)
      results.push({ messageId, success: true })
      succeeded++
    } catch (error) {
      results.push({
        messageId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      failed++
    }
  }

  // Return batch response
  const response: BatchResponse = {
    success: failed === 0,
    processed: request.batch.length,
    succeeded,
    failed,
    events: results,
  }

  // Return 200 even if some events failed (partial success)
  // Return 500 only if all events failed
  const status = succeeded > 0 ? 200 : 500
  return c.json(response, status)
})

// ============================================================================
// IMPORT ENDPOINT (LEGACY SUPPORT)
// ============================================================================

/**
 * POST /v1/import - Legacy batch import endpoint
 *
 * Alias for /v1/batch for backward compatibility with
 * Segment's historical data import API.
 */
eventsRouter.post('/v1/import', async (c) => {
  // Delegate to batch handler
  return eventsRouter.fetch(
    new Request(new URL('/v1/batch', c.req.url), {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    }),
    c.env
  )
})

// ============================================================================
// CATCH-ALL
// ============================================================================

/**
 * Catch-all for unknown event endpoints
 */
eventsRouter.all('*', (c) => {
  return c.json(
    { error: eventError('INVALID_REQUEST', `Unknown endpoint: ${c.req.path}`) },
    404
  )
})
