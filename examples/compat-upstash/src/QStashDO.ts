/**
 * QStashDO - Upstash QStash-compatible Message Queue Durable Object
 *
 * Drop-in replacement for @upstash/qstash that runs on Cloudflare Workers.
 * Implements the QStash API for message queuing, scheduling, and delivery.
 *
 * Features:
 * - publish() - Send message to endpoint
 * - publishJSON() - Send JSON payload
 * - Schedules: create, delete, get, list cron schedules
 * - Topics: create topics, publish to topics
 * - DLQ: dead letter queue handling
 * - Retries with exponential backoff
 * - Deduplication
 * - Callbacks and webhooks
 * - Message delays
 *
 * @see https://docs.upstash.com/qstash
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPES
// ============================================================================

export interface PublishOptions {
  /** Destination URL */
  url?: string
  /** Message body */
  body?: string | object
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Custom headers */
  headers?: Record<string, string>
  /** Delay delivery by seconds */
  delay?: number
  /** Retry configuration */
  retries?: number
  /** Callback URL on completion */
  callback?: string
  /** Callback URL on failure */
  failureCallback?: string
  /** Deduplication ID */
  deduplicationId?: string
  /** Content-based deduplication */
  contentBasedDeduplication?: boolean
  /** Timeout in seconds for delivery */
  timeout?: number
  /** Topic name */
  topic?: string
}

export interface Message {
  id: string
  destination: string
  body: string
  method: string
  headers: Record<string, string>
  createdAt: string
  scheduledAt: string
  attempts: number
  maxRetries: number
  callback?: string
  failureCallback?: string
  deduplicationId?: string
  topicName?: string
  status: 'pending' | 'delivered' | 'failed' | 'dead-lettered'
}

export interface Schedule {
  id: string
  cron: string
  destination: string
  body?: string
  method: string
  headers: Record<string, string>
  createdAt: string
  paused: boolean
  lastRun?: string
  nextRun: string
  retries: number
  callback?: string
}

export interface Topic {
  name: string
  endpoints: string[]
  createdAt: string
}

export interface DeadLetter {
  id: string
  messageId: string
  destination: string
  body: string
  method: string
  headers: Record<string, string>
  failureReason: string
  failedAt: string
  attempts: number
  originalScheduledAt: string
}

export interface PublishResponse {
  messageId: string
  url?: string
  deduplicated?: boolean
}

export interface QStashError {
  error: string
  code?: string
}

// ============================================================================
// QSTASH DO
// ============================================================================

/**
 * QStashDO - Message Queue Durable Object
 */
export class QStashDO extends DO {
  static readonly $type = 'QStashDO'

  private sql!: SqlStorage

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sql = ctx.storage.sql
  }

  /**
   * Initialize database schema
   */
  async initialize() {
    // Messages table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        destination TEXT NOT NULL,
        body TEXT,
        method TEXT NOT NULL DEFAULT 'POST',
        headers TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        callback TEXT,
        failure_callback TEXT,
        deduplication_id TEXT,
        topic_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `)

    // Schedules table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        destination TEXT NOT NULL,
        body TEXT,
        method TEXT NOT NULL DEFAULT 'POST',
        headers TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        last_run TEXT,
        next_run TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 3,
        callback TEXT
      )
    `)

    // Topics table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS topics (
        name TEXT PRIMARY KEY,
        endpoints TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      )
    `)

    // Dead letter queue
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS dlq (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        destination TEXT NOT NULL,
        body TEXT,
        method TEXT NOT NULL,
        headers TEXT NOT NULL,
        failure_reason TEXT NOT NULL,
        failed_at TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        original_scheduled_at TEXT NOT NULL
      )
    `)

    // Deduplication tracking
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS dedup (
        dedup_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `)

    // Indexes
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_scheduled ON messages(scheduled_at, status)
    `)
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_dedup ON messages(deduplication_id)
    `)
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(next_run, paused)
    `)
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_dedup_expires ON dedup(expires_at)
    `)
  }

  // ===========================================================================
  // HTTP HANDLER - QStash REST API Compatible
  // ===========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // Cleanup expired deduplications
      await this.cleanupDedup()

      // POST /v2/publish/:destination - Publish message
      if (method === 'POST' && path.startsWith('/v2/publish/')) {
        const destination = decodeURIComponent(path.slice('/v2/publish/'.length))
        return await this.handlePublish(request, destination)
      }

      // POST /v2/publish - Publish to topic (destination in header)
      if (method === 'POST' && path === '/v2/publish') {
        const destination = request.headers.get('Upstash-Forward-To')
          ?? request.headers.get('Upstash-Topic')
        if (!destination) {
          return Response.json({ error: 'Missing destination' }, { status: 400 })
        }
        return await this.handlePublish(request, destination)
      }

      // GET /v2/messages - List messages
      if (method === 'GET' && path === '/v2/messages') {
        return await this.handleListMessages(url)
      }

      // GET /v2/messages/:id - Get message
      if (method === 'GET' && path.startsWith('/v2/messages/')) {
        const id = path.slice('/v2/messages/'.length)
        return await this.handleGetMessage(id)
      }

      // DELETE /v2/messages/:id - Cancel message
      if (method === 'DELETE' && path.startsWith('/v2/messages/')) {
        const id = path.slice('/v2/messages/'.length)
        return await this.handleCancelMessage(id)
      }

      // Schedules
      // POST /v2/schedules - Create schedule
      if (method === 'POST' && path === '/v2/schedules') {
        return await this.handleCreateSchedule(request)
      }

      // GET /v2/schedules - List schedules
      if (method === 'GET' && path === '/v2/schedules') {
        return await this.handleListSchedules()
      }

      // GET /v2/schedules/:id - Get schedule
      if (method === 'GET' && path.startsWith('/v2/schedules/')) {
        const id = path.slice('/v2/schedules/'.length)
        return await this.handleGetSchedule(id)
      }

      // DELETE /v2/schedules/:id - Delete schedule
      if (method === 'DELETE' && path.startsWith('/v2/schedules/')) {
        const id = path.slice('/v2/schedules/'.length)
        return await this.handleDeleteSchedule(id)
      }

      // POST /v2/schedules/:id/pause - Pause schedule
      if (method === 'POST' && path.match(/^\/v2\/schedules\/[^/]+\/pause$/)) {
        const id = path.split('/')[3]
        return await this.handlePauseSchedule(id)
      }

      // POST /v2/schedules/:id/resume - Resume schedule
      if (method === 'POST' && path.match(/^\/v2\/schedules\/[^/]+\/resume$/)) {
        const id = path.split('/')[3]
        return await this.handleResumeSchedule(id)
      }

      // Topics
      // POST /v2/topics - Create topic
      if (method === 'POST' && path === '/v2/topics') {
        return await this.handleCreateTopic(request)
      }

      // GET /v2/topics - List topics
      if (method === 'GET' && path === '/v2/topics') {
        return await this.handleListTopics()
      }

      // GET /v2/topics/:name - Get topic
      if (method === 'GET' && path.startsWith('/v2/topics/')) {
        const name = path.slice('/v2/topics/'.length)
        return await this.handleGetTopic(name)
      }

      // DELETE /v2/topics/:name - Delete topic
      if (method === 'DELETE' && path.startsWith('/v2/topics/')) {
        const name = path.slice('/v2/topics/'.length)
        return await this.handleDeleteTopic(name)
      }

      // POST /v2/topics/:name/endpoints - Add endpoint to topic
      if (method === 'POST' && path.match(/^\/v2\/topics\/[^/]+\/endpoints$/)) {
        const name = path.split('/')[3]
        return await this.handleAddTopicEndpoint(request, name)
      }

      // DELETE /v2/topics/:name/endpoints - Remove endpoint from topic
      if (method === 'DELETE' && path.match(/^\/v2\/topics\/[^/]+\/endpoints$/)) {
        const name = path.split('/')[3]
        return await this.handleRemoveTopicEndpoint(request, name)
      }

      // DLQ
      // GET /v2/dlq - List dead letters
      if (method === 'GET' && path === '/v2/dlq') {
        return await this.handleListDLQ(url)
      }

      // GET /v2/dlq/:id - Get dead letter
      if (method === 'GET' && path.startsWith('/v2/dlq/')) {
        const id = path.slice('/v2/dlq/'.length)
        return await this.handleGetDeadLetter(id)
      }

      // POST /v2/dlq/:id/retry - Retry dead letter
      if (method === 'POST' && path.match(/^\/v2\/dlq\/[^/]+\/retry$/)) {
        const id = path.split('/')[3]
        return await this.handleRetryDeadLetter(id)
      }

      // DELETE /v2/dlq/:id - Delete dead letter
      if (method === 'DELETE' && path.startsWith('/v2/dlq/')) {
        const id = path.slice('/v2/dlq/'.length)
        return await this.handleDeleteDeadLetter(id)
      }

      // DELETE /v2/dlq - Purge DLQ
      if (method === 'DELETE' && path === '/v2/dlq') {
        return await this.handlePurgeDLQ()
      }

      // Process pending messages (internal)
      // POST /internal/process
      if (method === 'POST' && path === '/internal/process') {
        return await this.handleProcessMessages()
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ===========================================================================
  // PUBLISH OPERATIONS
  // ===========================================================================

  private async handlePublish(request: Request, destination: string): Promise<Response> {
    const headers = Object.fromEntries(request.headers.entries())

    // Parse options from headers
    const delay = parseInt(headers['upstash-delay'] ?? '0')
    const retries = parseInt(headers['upstash-retries'] ?? '3')
    const callback = headers['upstash-callback']
    const failureCallback = headers['upstash-failure-callback']
    const deduplicationId = headers['upstash-deduplication-id']
    const contentBasedDedup = headers['upstash-content-based-deduplication'] === 'true'
    const method = (headers['upstash-method'] ?? request.method) as string
    const timeout = parseInt(headers['upstash-timeout'] ?? '30')

    // Get body
    let body: string | null = null
    const contentType = request.headers.get('content-type')

    if (contentType?.includes('application/json')) {
      body = JSON.stringify(await request.json())
    } else {
      body = await request.text()
    }

    // Check deduplication
    const dedupId = deduplicationId ?? (contentBasedDedup && body
      ? await this.computeHash(body)
      : undefined)

    if (dedupId) {
      const existing = this.sql.exec<{ message_id: string }>(
        'SELECT message_id FROM dedup WHERE dedup_id = ?',
        dedupId
      ).toArray()[0]

      if (existing) {
        return Response.json({
          messageId: existing.message_id,
          deduplicated: true
        })
      }
    }

    // Check if destination is a topic
    const topic = this.sql.exec<{ endpoints: string }>(
      'SELECT endpoints FROM topics WHERE name = ?',
      destination
    ).toArray()[0]

    if (topic) {
      // Publish to all topic endpoints
      const endpoints: string[] = JSON.parse(topic.endpoints)
      const messageIds: string[] = []

      for (const endpoint of endpoints) {
        const messageId = await this.createMessage({
          destination: endpoint,
          body,
          method,
          headers: this.filterHeaders(headers),
          delay,
          retries,
          callback,
          failureCallback,
          deduplicationId: dedupId,
          topicName: destination
        })
        messageIds.push(messageId)
      }

      // Store dedup if needed
      if (dedupId && messageIds.length > 0) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        this.sql.exec(
          'INSERT INTO dedup (dedup_id, message_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
          dedupId, messageIds[0], new Date().toISOString(), expiresAt
        )
      }

      return Response.json({ messageIds })
    }

    // Single destination publish
    const messageId = await this.createMessage({
      destination,
      body,
      method,
      headers: this.filterHeaders(headers),
      delay,
      retries,
      callback,
      failureCallback,
      deduplicationId: dedupId
    })

    // Store dedup if needed
    if (dedupId) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      this.sql.exec(
        'INSERT INTO dedup (dedup_id, message_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        dedupId, messageId, new Date().toISOString(), expiresAt
      )
    }

    return Response.json({ messageId })
  }

  private async createMessage(options: {
    destination: string
    body: string | null
    method: string
    headers: Record<string, string>
    delay: number
    retries: number
    callback?: string
    failureCallback?: string
    deduplicationId?: string
    topicName?: string
  }): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date()
    const scheduledAt = new Date(now.getTime() + options.delay * 1000)

    this.sql.exec(`
      INSERT INTO messages (
        id, destination, body, method, headers, created_at, scheduled_at,
        max_retries, callback, failure_callback, deduplication_id, topic_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      options.destination,
      options.body,
      options.method,
      JSON.stringify(options.headers),
      now.toISOString(),
      scheduledAt.toISOString(),
      options.retries,
      options.callback ?? null,
      options.failureCallback ?? null,
      options.deduplicationId ?? null,
      options.topicName ?? null
    )

    // Schedule alarm for delivery
    await this.ctx.storage.setAlarm(scheduledAt.getTime())

    return id
  }

  private async handleListMessages(url: URL): Promise<Response> {
    const cursor = url.searchParams.get('cursor')
    const limit = parseInt(url.searchParams.get('limit') ?? '100')
    const status = url.searchParams.get('status')

    let query = 'SELECT * FROM messages'
    const params: (string | number)[] = []

    if (status) {
      query += ' WHERE status = ?'
      params.push(status)
    }

    query += ' ORDER BY scheduled_at DESC LIMIT ?'
    params.push(limit)

    if (cursor) {
      query = query.replace('ORDER BY', `AND id < ? ORDER BY`)
      params.splice(params.length - 1, 0, cursor)
    }

    const rows = this.sql.exec<any>(query, ...params).toArray()
    const messages = rows.map(this.rowToMessage)

    return Response.json({
      messages,
      cursor: messages.length === limit ? messages[messages.length - 1]?.id : null
    })
  }

  private async handleGetMessage(id: string): Promise<Response> {
    const row = this.sql.exec<any>(
      'SELECT * FROM messages WHERE id = ?', id
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Message not found' }, { status: 404 })
    }

    return Response.json(this.rowToMessage(row))
  }

  private async handleCancelMessage(id: string): Promise<Response> {
    const result = this.sql.exec(
      `UPDATE messages SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
      id
    )

    if (result.rowsWritten === 0) {
      return Response.json({ error: 'Message not found or already processed' }, { status: 404 })
    }

    return Response.json({ success: true })
  }

  // ===========================================================================
  // SCHEDULE OPERATIONS
  // ===========================================================================

  private async handleCreateSchedule(request: Request): Promise<Response> {
    const body = await request.json() as {
      destination: string
      cron: string
      body?: string
      method?: string
      headers?: Record<string, string>
      retries?: number
      callback?: string
    }

    if (!body.destination || !body.cron) {
      return Response.json({ error: 'destination and cron are required' }, { status: 400 })
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const nextRun = this.getNextCronRun(body.cron)

    this.sql.exec(`
      INSERT INTO schedules (
        id, cron, destination, body, method, headers, created_at, next_run, retries, callback
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      body.cron,
      body.destination,
      body.body ?? null,
      body.method ?? 'POST',
      JSON.stringify(body.headers ?? {}),
      now,
      nextRun,
      body.retries ?? 3,
      body.callback ?? null
    )

    // Set alarm for next run
    await this.ctx.storage.setAlarm(new Date(nextRun).getTime())

    return Response.json({
      scheduleId: id,
      cron: body.cron,
      destination: body.destination,
      nextRun
    })
  }

  private async handleListSchedules(): Promise<Response> {
    const rows = this.sql.exec<any>(
      'SELECT * FROM schedules ORDER BY created_at DESC'
    ).toArray()

    return Response.json({
      schedules: rows.map(this.rowToSchedule)
    })
  }

  private async handleGetSchedule(id: string): Promise<Response> {
    const row = this.sql.exec<any>(
      'SELECT * FROM schedules WHERE id = ?', id
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Schedule not found' }, { status: 404 })
    }

    return Response.json(this.rowToSchedule(row))
  }

  private async handleDeleteSchedule(id: string): Promise<Response> {
    const result = this.sql.exec('DELETE FROM schedules WHERE id = ?', id)

    if (result.rowsWritten === 0) {
      return Response.json({ error: 'Schedule not found' }, { status: 404 })
    }

    return Response.json({ success: true })
  }

  private async handlePauseSchedule(id: string): Promise<Response> {
    const result = this.sql.exec(
      'UPDATE schedules SET paused = 1 WHERE id = ?', id
    )

    if (result.rowsWritten === 0) {
      return Response.json({ error: 'Schedule not found' }, { status: 404 })
    }

    return Response.json({ success: true })
  }

  private async handleResumeSchedule(id: string): Promise<Response> {
    const schedule = this.sql.exec<{ cron: string }>(
      'SELECT cron FROM schedules WHERE id = ?', id
    ).toArray()[0]

    if (!schedule) {
      return Response.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const nextRun = this.getNextCronRun(schedule.cron)

    this.sql.exec(
      'UPDATE schedules SET paused = 0, next_run = ? WHERE id = ?',
      nextRun, id
    )

    // Set alarm for next run
    await this.ctx.storage.setAlarm(new Date(nextRun).getTime())

    return Response.json({ success: true, nextRun })
  }

  // ===========================================================================
  // TOPIC OPERATIONS
  // ===========================================================================

  private async handleCreateTopic(request: Request): Promise<Response> {
    const body = await request.json() as { name: string; endpoints?: string[] }

    if (!body.name) {
      return Response.json({ error: 'name is required' }, { status: 400 })
    }

    const now = new Date().toISOString()

    try {
      this.sql.exec(
        'INSERT INTO topics (name, endpoints, created_at) VALUES (?, ?, ?)',
        body.name,
        JSON.stringify(body.endpoints ?? []),
        now
      )
    } catch {
      return Response.json({ error: 'Topic already exists' }, { status: 409 })
    }

    return Response.json({
      name: body.name,
      endpoints: body.endpoints ?? [],
      createdAt: now
    })
  }

  private async handleListTopics(): Promise<Response> {
    const rows = this.sql.exec<any>(
      'SELECT * FROM topics ORDER BY created_at DESC'
    ).toArray()

    return Response.json({
      topics: rows.map(row => ({
        name: row.name,
        endpoints: JSON.parse(row.endpoints),
        createdAt: row.created_at
      }))
    })
  }

  private async handleGetTopic(name: string): Promise<Response> {
    const row = this.sql.exec<any>(
      'SELECT * FROM topics WHERE name = ?', name
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    return Response.json({
      name: row.name,
      endpoints: JSON.parse(row.endpoints),
      createdAt: row.created_at
    })
  }

  private async handleDeleteTopic(name: string): Promise<Response> {
    const result = this.sql.exec('DELETE FROM topics WHERE name = ?', name)

    if (result.rowsWritten === 0) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    return Response.json({ success: true })
  }

  private async handleAddTopicEndpoint(request: Request, name: string): Promise<Response> {
    const body = await request.json() as { endpoint: string }

    if (!body.endpoint) {
      return Response.json({ error: 'endpoint is required' }, { status: 400 })
    }

    const topic = this.sql.exec<{ endpoints: string }>(
      'SELECT endpoints FROM topics WHERE name = ?', name
    ).toArray()[0]

    if (!topic) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    const endpoints: string[] = JSON.parse(topic.endpoints)
    if (!endpoints.includes(body.endpoint)) {
      endpoints.push(body.endpoint)
      this.sql.exec(
        'UPDATE topics SET endpoints = ? WHERE name = ?',
        JSON.stringify(endpoints), name
      )
    }

    return Response.json({ success: true, endpoints })
  }

  private async handleRemoveTopicEndpoint(request: Request, name: string): Promise<Response> {
    const body = await request.json() as { endpoint: string }

    if (!body.endpoint) {
      return Response.json({ error: 'endpoint is required' }, { status: 400 })
    }

    const topic = this.sql.exec<{ endpoints: string }>(
      'SELECT endpoints FROM topics WHERE name = ?', name
    ).toArray()[0]

    if (!topic) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    const endpoints: string[] = JSON.parse(topic.endpoints)
    const index = endpoints.indexOf(body.endpoint)
    if (index > -1) {
      endpoints.splice(index, 1)
      this.sql.exec(
        'UPDATE topics SET endpoints = ? WHERE name = ?',
        JSON.stringify(endpoints), name
      )
    }

    return Response.json({ success: true, endpoints })
  }

  // ===========================================================================
  // DLQ OPERATIONS
  // ===========================================================================

  private async handleListDLQ(url: URL): Promise<Response> {
    const cursor = url.searchParams.get('cursor')
    const limit = parseInt(url.searchParams.get('limit') ?? '100')

    let query = 'SELECT * FROM dlq'
    const params: (string | number)[] = []

    query += ' ORDER BY failed_at DESC LIMIT ?'
    params.push(limit)

    if (cursor) {
      query = query.replace('ORDER BY', 'WHERE id < ? ORDER BY')
      params.splice(params.length - 1, 0, cursor)
    }

    const rows = this.sql.exec<any>(query, ...params).toArray()
    const deadLetters = rows.map(this.rowToDeadLetter)

    return Response.json({
      deadLetters,
      cursor: deadLetters.length === limit ? deadLetters[deadLetters.length - 1]?.id : null
    })
  }

  private async handleGetDeadLetter(id: string): Promise<Response> {
    const row = this.sql.exec<any>(
      'SELECT * FROM dlq WHERE id = ?', id
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Dead letter not found' }, { status: 404 })
    }

    return Response.json(this.rowToDeadLetter(row))
  }

  private async handleRetryDeadLetter(id: string): Promise<Response> {
    const row = this.sql.exec<any>(
      'SELECT * FROM dlq WHERE id = ?', id
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Dead letter not found' }, { status: 404 })
    }

    // Create a new message from the dead letter
    const messageId = await this.createMessage({
      destination: row.destination,
      body: row.body,
      method: row.method,
      headers: JSON.parse(row.headers),
      delay: 0,
      retries: 3
    })

    // Delete from DLQ
    this.sql.exec('DELETE FROM dlq WHERE id = ?', id)

    return Response.json({ messageId })
  }

  private async handleDeleteDeadLetter(id: string): Promise<Response> {
    const result = this.sql.exec('DELETE FROM dlq WHERE id = ?', id)

    if (result.rowsWritten === 0) {
      return Response.json({ error: 'Dead letter not found' }, { status: 404 })
    }

    return Response.json({ success: true })
  }

  private async handlePurgeDLQ(): Promise<Response> {
    this.sql.exec('DELETE FROM dlq')
    return Response.json({ success: true })
  }

  // ===========================================================================
  // MESSAGE PROCESSING
  // ===========================================================================

  async alarm(): Promise<void> {
    await this.processMessages()
  }

  private async handleProcessMessages(): Promise<Response> {
    const processed = await this.processMessages()
    return Response.json({ processed })
  }

  private async processMessages(): Promise<number> {
    const now = new Date().toISOString()
    let processed = 0

    // Process scheduled messages
    const pendingMessages = this.sql.exec<any>(`
      SELECT * FROM messages
      WHERE status = 'pending' AND scheduled_at <= ?
      ORDER BY scheduled_at
      LIMIT 100
    `, now).toArray()

    for (const row of pendingMessages) {
      const success = await this.deliverMessage(row)
      if (success) {
        this.sql.exec(`UPDATE messages SET status = 'delivered' WHERE id = ?`, row.id)
      } else {
        const attempts = row.attempts + 1
        if (attempts >= row.max_retries) {
          // Move to DLQ
          await this.moveToDeadLetter(row, 'Max retries exceeded')
          this.sql.exec(`UPDATE messages SET status = 'dead-lettered', attempts = ? WHERE id = ?`, attempts, row.id)
        } else {
          // Exponential backoff: 2^attempt seconds
          const delay = Math.pow(2, attempts)
          const nextAttempt = new Date(Date.now() + delay * 1000).toISOString()
          this.sql.exec(`UPDATE messages SET attempts = ?, scheduled_at = ? WHERE id = ?`, attempts, nextAttempt, row.id)
        }
      }
      processed++
    }

    // Process scheduled runs
    const dueSchedules = this.sql.exec<any>(`
      SELECT * FROM schedules
      WHERE paused = 0 AND next_run <= ?
      ORDER BY next_run
      LIMIT 100
    `, now).toArray()

    for (const schedule of dueSchedules) {
      // Create message for this schedule run
      await this.createMessage({
        destination: schedule.destination,
        body: schedule.body,
        method: schedule.method,
        headers: JSON.parse(schedule.headers),
        delay: 0,
        retries: schedule.retries,
        callback: schedule.callback
      })

      // Update next run
      const nextRun = this.getNextCronRun(schedule.cron)
      this.sql.exec(
        `UPDATE schedules SET last_run = ?, next_run = ? WHERE id = ?`,
        now, nextRun, schedule.id
      )

      processed++
    }

    // Schedule next alarm
    const nextMessage = this.sql.exec<{ scheduled_at: string }>(`
      SELECT MIN(scheduled_at) as scheduled_at FROM messages WHERE status = 'pending'
    `).toArray()[0]

    const nextSchedule = this.sql.exec<{ next_run: string }>(`
      SELECT MIN(next_run) as next_run FROM schedules WHERE paused = 0
    `).toArray()[0]

    const times: number[] = []
    if (nextMessage?.scheduled_at) times.push(new Date(nextMessage.scheduled_at).getTime())
    if (nextSchedule?.next_run) times.push(new Date(nextSchedule.next_run).getTime())

    if (times.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...times))
    }

    return processed
  }

  private async deliverMessage(row: any): Promise<boolean> {
    try {
      const response = await fetch(row.destination, {
        method: row.method,
        headers: {
          ...JSON.parse(row.headers),
          'Content-Type': 'application/json',
          'Upstash-Message-Id': row.id,
          'Upstash-Retries': row.attempts.toString()
        },
        body: row.body
      })

      // Call success callback if configured
      if (response.ok && row.callback) {
        await fetch(row.callback, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: row.id,
            destination: row.destination,
            status: 'delivered',
            responseStatus: response.status
          })
        }).catch(() => {}) // Ignore callback failures
      }

      // Call failure callback if configured
      if (!response.ok && row.failure_callback) {
        await fetch(row.failure_callback, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: row.id,
            destination: row.destination,
            status: 'failed',
            responseStatus: response.status,
            attempt: row.attempts + 1
          })
        }).catch(() => {}) // Ignore callback failures
      }

      return response.ok
    } catch (error) {
      // Network error
      if (row.failure_callback) {
        await fetch(row.failure_callback, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: row.id,
            destination: row.destination,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            attempt: row.attempts + 1
          })
        }).catch(() => {})
      }
      return false
    }
  }

  private async moveToDeadLetter(row: any, reason: string): Promise<void> {
    const id = crypto.randomUUID()

    this.sql.exec(`
      INSERT INTO dlq (
        id, message_id, destination, body, method, headers,
        failure_reason, failed_at, attempts, original_scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      row.id,
      row.destination,
      row.body,
      row.method,
      row.headers,
      reason,
      new Date().toISOString(),
      row.attempts,
      row.scheduled_at
    )
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private filterHeaders(headers: Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {}
    const exclude = [
      'upstash-delay', 'upstash-retries', 'upstash-callback',
      'upstash-failure-callback', 'upstash-deduplication-id',
      'upstash-content-based-deduplication', 'upstash-method',
      'upstash-timeout', 'upstash-forward-to', 'upstash-topic',
      'host', 'content-length', 'connection', 'cf-', 'x-forwarded-'
    ]

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase()
      if (!exclude.some(ex => lower.startsWith(ex))) {
        filtered[key] = value
      }
    }

    return filtered
  }

  private async computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hash = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hash))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private getNextCronRun(cron: string): string {
    // Simple cron parser for common patterns
    // Format: minute hour day month weekday
    const parts = cron.split(' ')

    if (parts.length !== 5) {
      // Default to next minute for invalid cron
      return new Date(Date.now() + 60000).toISOString()
    }

    const now = new Date()
    const next = new Date(now)

    // Handle simple patterns
    const [minute, hour, day, month, weekday] = parts

    // Every minute: * * * * *
    if (minute === '*' && hour === '*') {
      next.setMinutes(now.getMinutes() + 1)
      next.setSeconds(0)
      next.setMilliseconds(0)
      return next.toISOString()
    }

    // Specific minute: 0 * * * * (every hour at minute 0)
    if (minute !== '*' && hour === '*') {
      const targetMinute = parseInt(minute)
      if (now.getMinutes() >= targetMinute) {
        next.setHours(now.getHours() + 1)
      }
      next.setMinutes(targetMinute)
      next.setSeconds(0)
      next.setMilliseconds(0)
      return next.toISOString()
    }

    // Specific hour and minute: 30 9 * * * (9:30 every day)
    if (minute !== '*' && hour !== '*' && day === '*') {
      const targetHour = parseInt(hour)
      const targetMinute = parseInt(minute)

      next.setHours(targetHour)
      next.setMinutes(targetMinute)
      next.setSeconds(0)
      next.setMilliseconds(0)

      if (next <= now) {
        next.setDate(next.getDate() + 1)
      }
      return next.toISOString()
    }

    // Fallback: next minute
    next.setMinutes(now.getMinutes() + 1)
    next.setSeconds(0)
    next.setMilliseconds(0)
    return next.toISOString()
  }

  private rowToMessage(row: any): Message {
    return {
      id: row.id,
      destination: row.destination,
      body: row.body,
      method: row.method,
      headers: JSON.parse(row.headers),
      createdAt: row.created_at,
      scheduledAt: row.scheduled_at,
      attempts: row.attempts,
      maxRetries: row.max_retries,
      callback: row.callback ?? undefined,
      failureCallback: row.failure_callback ?? undefined,
      deduplicationId: row.deduplication_id ?? undefined,
      topicName: row.topic_name ?? undefined,
      status: row.status
    }
  }

  private rowToSchedule(row: any): Schedule {
    return {
      id: row.id,
      cron: row.cron,
      destination: row.destination,
      body: row.body ?? undefined,
      method: row.method,
      headers: JSON.parse(row.headers),
      createdAt: row.created_at,
      paused: row.paused === 1,
      lastRun: row.last_run ?? undefined,
      nextRun: row.next_run,
      retries: row.retries,
      callback: row.callback ?? undefined
    }
  }

  private rowToDeadLetter(row: any): DeadLetter {
    return {
      id: row.id,
      messageId: row.message_id,
      destination: row.destination,
      body: row.body,
      method: row.method,
      headers: JSON.parse(row.headers),
      failureReason: row.failure_reason,
      failedAt: row.failed_at,
      attempts: row.attempts,
      originalScheduledAt: row.original_scheduled_at
    }
  }

  private async cleanupDedup(): Promise<void> {
    const now = new Date().toISOString()
    this.sql.exec('DELETE FROM dedup WHERE expires_at < ?', now)
  }

  // ===========================================================================
  // SDK-COMPATIBLE METHODS (for direct DO access)
  // ===========================================================================

  /**
   * Publish a message to a destination
   */
  async publish(options: PublishOptions): Promise<PublishResponse> {
    const destination = options.url ?? options.topic
    if (!destination) {
      throw new Error('url or topic is required')
    }

    const body = typeof options.body === 'object'
      ? JSON.stringify(options.body)
      : options.body ?? ''

    const dedupId = options.deduplicationId ?? (options.contentBasedDeduplication && body
      ? await this.computeHash(body)
      : undefined)

    // Check deduplication
    if (dedupId) {
      const existing = this.sql.exec<{ message_id: string }>(
        'SELECT message_id FROM dedup WHERE dedup_id = ?',
        dedupId
      ).toArray()[0]

      if (existing) {
        return { messageId: existing.message_id, deduplicated: true }
      }
    }

    const messageId = await this.createMessage({
      destination,
      body,
      method: options.method ?? 'POST',
      headers: options.headers ?? {},
      delay: options.delay ?? 0,
      retries: options.retries ?? 3,
      callback: options.callback,
      failureCallback: options.failureCallback,
      deduplicationId: dedupId
    })

    // Store dedup if needed
    if (dedupId) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      this.sql.exec(
        'INSERT INTO dedup (dedup_id, message_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        dedupId, messageId, new Date().toISOString(), expiresAt
      )
    }

    return { messageId, url: destination }
  }

  /**
   * Publish JSON message
   */
  async publishJSON<T>(options: Omit<PublishOptions, 'body'> & { body: T }): Promise<PublishResponse> {
    return this.publish({
      ...options,
      body: options.body,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json'
      }
    })
  }

  /**
   * Create a cron schedule
   */
  async createSchedule(options: {
    destination: string
    cron: string
    body?: string | object
    method?: string
    headers?: Record<string, string>
    retries?: number
    callback?: string
  }): Promise<Schedule> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const nextRun = this.getNextCronRun(options.cron)
    const body = typeof options.body === 'object'
      ? JSON.stringify(options.body)
      : options.body

    this.sql.exec(`
      INSERT INTO schedules (
        id, cron, destination, body, method, headers, created_at, next_run, retries, callback
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      options.cron,
      options.destination,
      body ?? null,
      options.method ?? 'POST',
      JSON.stringify(options.headers ?? {}),
      now,
      nextRun,
      options.retries ?? 3,
      options.callback ?? null
    )

    // Set alarm for next run
    await this.ctx.storage.setAlarm(new Date(nextRun).getTime())

    return {
      id,
      cron: options.cron,
      destination: options.destination,
      body: body ?? undefined,
      method: options.method ?? 'POST',
      headers: options.headers ?? {},
      createdAt: now,
      paused: false,
      nextRun,
      retries: options.retries ?? 3,
      callback: options.callback
    }
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(scheduleId: string): Promise<boolean> {
    const result = this.sql.exec('DELETE FROM schedules WHERE id = ?', scheduleId)
    return result.rowsWritten > 0
  }

  /**
   * Get schedule by ID
   */
  async getSchedule(scheduleId: string): Promise<Schedule | null> {
    const row = this.sql.exec<any>(
      'SELECT * FROM schedules WHERE id = ?', scheduleId
    ).toArray()[0]

    return row ? this.rowToSchedule(row) : null
  }

  /**
   * List all schedules
   */
  async listSchedules(): Promise<Schedule[]> {
    const rows = this.sql.exec<any>(
      'SELECT * FROM schedules ORDER BY created_at DESC'
    ).toArray()

    return rows.map(this.rowToSchedule)
  }

  /**
   * Create a topic
   */
  async createTopic(name: string, endpoints: string[] = []): Promise<Topic> {
    const now = new Date().toISOString()

    this.sql.exec(
      'INSERT INTO topics (name, endpoints, created_at) VALUES (?, ?, ?)',
      name, JSON.stringify(endpoints), now
    )

    return { name, endpoints, createdAt: now }
  }

  /**
   * Delete a topic
   */
  async deleteTopic(name: string): Promise<boolean> {
    const result = this.sql.exec('DELETE FROM topics WHERE name = ?', name)
    return result.rowsWritten > 0
  }

  /**
   * List dead letters
   */
  async listDeadLetters(limit = 100): Promise<DeadLetter[]> {
    const rows = this.sql.exec<any>(
      'SELECT * FROM dlq ORDER BY failed_at DESC LIMIT ?', limit
    ).toArray()

    return rows.map(this.rowToDeadLetter)
  }

  /**
   * Retry a dead letter
   */
  async retryDeadLetter(id: string): Promise<string> {
    const row = this.sql.exec<any>(
      'SELECT * FROM dlq WHERE id = ?', id
    ).toArray()[0]

    if (!row) {
      throw new Error('Dead letter not found')
    }

    const messageId = await this.createMessage({
      destination: row.destination,
      body: row.body,
      method: row.method,
      headers: JSON.parse(row.headers),
      delay: 0,
      retries: 3
    })

    this.sql.exec('DELETE FROM dlq WHERE id = ?', id)

    return messageId
  }

  /**
   * Purge dead letter queue
   */
  async purgeDLQ(): Promise<void> {
    this.sql.exec('DELETE FROM dlq')
  }
}
