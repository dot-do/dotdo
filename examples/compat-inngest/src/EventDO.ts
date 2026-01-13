/**
 * EventDO - Durable Object for Event Storage and Routing
 *
 * Handles:
 * - Event ingestion and storage
 * - Event routing to registered functions
 * - Event batching
 * - Event replay
 * - waitForEvent correlation
 * - Debouncing
 */

import {
  type InngestEvent,
  type SendEventPayload,
  type StoredEvent,
  type BatchConfig,
  type DebounceConfig,
  generateEventId,
  parseDuration,
  getValueByPath,
  ensureError,
} from './types'

/**
 * SQL schema for event storage
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    user_data TEXT,
    ts INTEGER NOT NULL,
    v TEXT,
    stored_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    processed INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed);

  -- Function registrations
  CREATE TABLE IF NOT EXISTS function_triggers (
    function_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    expression TEXT,
    PRIMARY KEY (function_id, event_name)
  );

  CREATE INDEX IF NOT EXISTS idx_triggers_event ON function_triggers(event_name);

  -- Wait for event correlations
  CREATE TABLE IF NOT EXISTS event_waiters (
    waiter_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    match_expr TEXT,
    if_expr TEXT,
    timeout_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_waiters_event ON event_waiters(event_name);
  CREATE INDEX IF NOT EXISTS idx_waiters_timeout ON event_waiters(timeout_at);

  -- Batches in progress
  CREATE TABLE IF NOT EXISTS batches (
    batch_key TEXT PRIMARY KEY,
    function_id TEXT NOT NULL,
    events TEXT NOT NULL,
    max_size INTEGER NOT NULL,
    timeout_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_batches_timeout ON batches(timeout_at);

  -- Debounce state
  CREATE TABLE IF NOT EXISTS debounces (
    debounce_key TEXT PRIMARY KEY,
    function_id TEXT NOT NULL,
    event TEXT NOT NULL,
    trigger_at INTEGER NOT NULL,
    max_wait_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_debounces_trigger ON debounces(trigger_at);
`

/**
 * EventDO - Manages event storage and routing
 */
export class EventDO implements DurableObject {
  private state: DurableObjectState
  private initialized = false

  constructor(state: DurableObjectState) {
    this.state = state
  }

  /**
   * Initialize the database schema
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    await this.state.storage.sql.exec(SCHEMA)
    this.initialized = true
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.init()

    const url = new URL(request.url)
    const method = request.method

    try {
      // POST /events - Ingest events
      if (method === 'POST' && url.pathname === '/events') {
        const body = await request.json() as SendEventPayload | SendEventPayload[]
        const result = await this.ingestEvents(body)
        return Response.json(result)
      }

      // GET /events - List events
      if (method === 'GET' && url.pathname === '/events') {
        const name = url.searchParams.get('name')
        const limit = parseInt(url.searchParams.get('limit') ?? '100')
        const events = await this.listEvents(name ?? undefined, limit)
        return Response.json(events)
      }

      // GET /event/:id - Get single event
      if (method === 'GET' && url.pathname.startsWith('/event/')) {
        const eventId = url.pathname.split('/')[2]
        const event = await this.getEvent(eventId)
        return Response.json(event)
      }

      // POST /register - Register function trigger
      if (method === 'POST' && url.pathname === '/register') {
        const body = await request.json() as {
          functionId: string
          eventName: string
          expression?: string
        }
        await this.registerTrigger(body.functionId, body.eventName, body.expression)
        return Response.json({ success: true })
      }

      // DELETE /register - Unregister function trigger
      if (method === 'DELETE' && url.pathname === '/register') {
        const body = await request.json() as {
          functionId: string
          eventName: string
        }
        await this.unregisterTrigger(body.functionId, body.eventName)
        return Response.json({ success: true })
      }

      // GET /triggers/:eventName - Get functions for event
      if (method === 'GET' && url.pathname.startsWith('/triggers/')) {
        const eventName = decodeURIComponent(url.pathname.split('/')[2])
        const functions = await this.getFunctionsForEvent(eventName)
        return Response.json(functions)
      }

      // POST /wait - Register a waiter for event
      if (method === 'POST' && url.pathname === '/wait') {
        const body = await request.json() as {
          waiterId: string
          runId: string
          eventName: string
          match?: string
          if?: string
          timeout?: string | number
        }
        await this.registerWaiter(body)
        return Response.json({ success: true })
      }

      // DELETE /wait/:waiterId - Cancel a waiter
      if (method === 'DELETE' && url.pathname.startsWith('/wait/')) {
        const waiterId = url.pathname.split('/')[2]
        await this.cancelWaiter(waiterId)
        return Response.json({ success: true })
      }

      // POST /batch - Add event to batch
      if (method === 'POST' && url.pathname === '/batch') {
        const body = await request.json() as {
          functionId: string
          event: InngestEvent
          config: BatchConfig
        }
        const result = await this.addToBatch(body.functionId, body.event, body.config)
        return Response.json(result)
      }

      // POST /debounce - Add event with debouncing
      if (method === 'POST' && url.pathname === '/debounce') {
        const body = await request.json() as {
          functionId: string
          event: InngestEvent
          config: DebounceConfig
        }
        await this.debounceEvent(body.functionId, body.event, body.config)
        return Response.json({ success: true })
      }

      // POST /replay - Replay events
      if (method === 'POST' && url.pathname === '/replay') {
        const body = await request.json() as {
          eventName?: string
          fromTs?: number
          toTs?: number
          limit?: number
        }
        const events = await this.replayEvents(body)
        return Response.json(events)
      }

      // DELETE /events - Purge old events
      if (method === 'DELETE' && url.pathname === '/events') {
        const olderThan = parseInt(url.searchParams.get('olderThan') ?? '0')
        const count = await this.purgeEvents(olderThan)
        return Response.json({ deleted: count })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      const err = ensureError(error)
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  /**
   * Handle DO alarm for batch/debounce/waiter timeouts
   */
  async alarm(): Promise<void> {
    await this.init()

    const now = Date.now()

    // Process batch timeouts
    await this.processBatchTimeouts(now)

    // Process debounce triggers
    await this.processDebounceTimeouts(now)

    // Process waiter timeouts
    await this.processWaiterTimeouts(now)

    // Schedule next alarm
    await this.scheduleNextAlarm()
  }

  // ===========================================================================
  // Event Ingestion
  // ===========================================================================

  /**
   * Ingest one or more events
   */
  private async ingestEvents(
    payload: SendEventPayload | SendEventPayload[]
  ): Promise<{ ids: string[]; triggeredFunctions: string[] }> {
    const events = Array.isArray(payload) ? payload : [payload]
    const ids: string[] = []
    const triggeredFunctions: string[] = []

    for (const evt of events) {
      const eventId = evt.id ?? generateEventId()
      const ts = evt.ts ?? Date.now()

      // Store event
      this.state.storage.sql.exec(
        `INSERT INTO events (id, name, data, user_data, ts, v)
         VALUES (?, ?, ?, ?, ?, ?)`,
        eventId,
        evt.name,
        JSON.stringify(evt.data),
        evt.user ? JSON.stringify(evt.user) : null,
        ts,
        evt.v ?? null
      )

      ids.push(eventId)

      // Build full event object
      const fullEvent: InngestEvent = {
        id: eventId,
        name: evt.name,
        data: evt.data,
        user: evt.user,
        ts,
        v: evt.v,
      }

      // Check waiters
      await this.checkWaiters(fullEvent)

      // Get triggered functions
      const functions = await this.getFunctionsForEvent(evt.name)
      triggeredFunctions.push(...functions.map(f => f.functionId))
    }

    return { ids, triggeredFunctions }
  }

  /**
   * Get a single event
   */
  private async getEvent(eventId: string): Promise<StoredEvent | null> {
    const row = this.state.storage.sql.exec<{
      id: string
      name: string
      data: string
      user_data: string | null
      ts: number
      v: string | null
      stored_at: number
      processed: number
    }>(
      `SELECT * FROM events WHERE id = ?`,
      eventId
    ).one()

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      data: JSON.parse(row.data),
      user: row.user_data ? JSON.parse(row.user_data) : undefined,
      ts: row.ts,
      v: row.v ?? undefined,
      storedAt: row.stored_at,
      processed: row.processed === 1,
    }
  }

  /**
   * List events
   */
  private async listEvents(name?: string, limit = 100): Promise<StoredEvent[]> {
    const query = name
      ? `SELECT * FROM events WHERE name = ? ORDER BY ts DESC LIMIT ?`
      : `SELECT * FROM events ORDER BY ts DESC LIMIT ?`

    const args = name ? [name, limit] : [limit]

    const rows = this.state.storage.sql.exec<{
      id: string
      name: string
      data: string
      user_data: string | null
      ts: number
      v: string | null
      stored_at: number
      processed: number
    }>(query, ...args).toArray()

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      data: JSON.parse(row.data),
      user: row.user_data ? JSON.parse(row.user_data) : undefined,
      ts: row.ts,
      v: row.v ?? undefined,
      storedAt: row.stored_at,
      processed: row.processed === 1,
    }))
  }

  // ===========================================================================
  // Function Triggers
  // ===========================================================================

  /**
   * Register a function trigger
   */
  private async registerTrigger(
    functionId: string,
    eventName: string,
    expression?: string
  ): Promise<void> {
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO function_triggers (function_id, event_name, expression)
       VALUES (?, ?, ?)`,
      functionId,
      eventName,
      expression ?? null
    )
  }

  /**
   * Unregister a function trigger
   */
  private async unregisterTrigger(functionId: string, eventName: string): Promise<void> {
    this.state.storage.sql.exec(
      `DELETE FROM function_triggers WHERE function_id = ? AND event_name = ?`,
      functionId,
      eventName
    )
  }

  /**
   * Get functions registered for an event
   */
  private async getFunctionsForEvent(
    eventName: string
  ): Promise<Array<{ functionId: string; expression?: string }>> {
    const rows = this.state.storage.sql.exec<{
      function_id: string
      expression: string | null
    }>(
      `SELECT function_id, expression FROM function_triggers WHERE event_name = ?`,
      eventName
    ).toArray()

    return rows.map(row => ({
      functionId: row.function_id,
      expression: row.expression ?? undefined,
    }))
  }

  // ===========================================================================
  // Wait for Event
  // ===========================================================================

  /**
   * Register a waiter for an event
   */
  private async registerWaiter(options: {
    waiterId: string
    runId: string
    eventName: string
    match?: string
    if?: string
    timeout?: string | number
  }): Promise<void> {
    const timeoutAt = options.timeout
      ? Date.now() + parseDuration(options.timeout)
      : null

    this.state.storage.sql.exec(
      `INSERT INTO event_waiters (waiter_id, run_id, event_name, match_expr, if_expr, timeout_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      options.waiterId,
      options.runId,
      options.eventName,
      options.match ?? null,
      options.if ?? null,
      timeoutAt
    )

    if (timeoutAt) {
      await this.scheduleNextAlarm()
    }
  }

  /**
   * Cancel a waiter
   */
  private async cancelWaiter(waiterId: string): Promise<void> {
    this.state.storage.sql.exec(
      `DELETE FROM event_waiters WHERE waiter_id = ?`,
      waiterId
    )
  }

  /**
   * Check if any waiters match an incoming event
   */
  private async checkWaiters(event: InngestEvent): Promise<string[]> {
    const matchedWaiters: string[] = []

    const waiters = this.state.storage.sql.exec<{
      waiter_id: string
      run_id: string
      match_expr: string | null
      if_expr: string | null
    }>(
      `SELECT waiter_id, run_id, match_expr, if_expr FROM event_waiters
       WHERE event_name = ?`,
      event.name
    ).toArray()

    for (const waiter of waiters) {
      let matches = true

      // Check match expression (field path comparison)
      if (waiter.match_expr && matches) {
        // For waitForEvent, match is a field path that should exist in both events
        // Since we don't have the original event context here, we just check if the field exists
        const value = getValueByPath(event, waiter.match_expr.replace('async.', ''))
        matches = value !== undefined
      }

      // Check if expression
      if (waiter.if_expr && matches) {
        // Simple expression evaluation would go here
        // For now, we assume true if if_expr is present
        matches = true
      }

      if (matches) {
        matchedWaiters.push(waiter.waiter_id)

        // Store the matched event for the waiter to retrieve
        await this.state.storage.put(`waiter:${waiter.waiter_id}:result`, event)

        // Remove the waiter
        this.state.storage.sql.exec(
          `DELETE FROM event_waiters WHERE waiter_id = ?`,
          waiter.waiter_id
        )
      }
    }

    return matchedWaiters
  }

  /**
   * Process waiter timeouts
   */
  private async processWaiterTimeouts(now: number): Promise<void> {
    const timedOutWaiters = this.state.storage.sql.exec<{
      waiter_id: string
    }>(
      `SELECT waiter_id FROM event_waiters WHERE timeout_at IS NOT NULL AND timeout_at <= ?`,
      now
    ).toArray()

    for (const waiter of timedOutWaiters) {
      // Mark as timed out (null result)
      await this.state.storage.put(`waiter:${waiter.waiter_id}:result`, null)

      this.state.storage.sql.exec(
        `DELETE FROM event_waiters WHERE waiter_id = ?`,
        waiter.waiter_id
      )
    }
  }

  // ===========================================================================
  // Batching
  // ===========================================================================

  /**
   * Add event to a batch
   */
  private async addToBatch(
    functionId: string,
    event: InngestEvent,
    config: BatchConfig
  ): Promise<{ ready: boolean; events?: InngestEvent[] }> {
    // Calculate batch key
    let batchKey = functionId
    if (config.key) {
      const keyValue = getValueByPath({ event }, config.key)
      batchKey = `${functionId}:${String(keyValue)}`
    }

    // Get existing batch
    const existing = this.state.storage.sql.exec<{
      events: string
      max_size: number
      timeout_at: number
    }>(
      `SELECT events, max_size, timeout_at FROM batches WHERE batch_key = ?`,
      batchKey
    ).one()

    let events: InngestEvent[] = existing ? JSON.parse(existing.events) : []
    events.push(event)

    // Check if batch is full
    if (events.length >= config.maxSize) {
      // Remove batch and return ready
      this.state.storage.sql.exec(`DELETE FROM batches WHERE batch_key = ?`, batchKey)
      return { ready: true, events }
    }

    // Update or create batch
    const timeoutAt = existing?.timeout_at ?? (Date.now() + parseDuration(config.timeout))

    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO batches (batch_key, function_id, events, max_size, timeout_at)
       VALUES (?, ?, ?, ?, ?)`,
      batchKey,
      functionId,
      JSON.stringify(events),
      config.maxSize,
      timeoutAt
    )

    if (!existing) {
      await this.scheduleNextAlarm()
    }

    return { ready: false }
  }

  /**
   * Process batch timeouts
   */
  private async processBatchTimeouts(now: number): Promise<void> {
    const timedOutBatches = this.state.storage.sql.exec<{
      batch_key: string
      function_id: string
      events: string
    }>(
      `SELECT batch_key, function_id, events FROM batches WHERE timeout_at <= ?`,
      now
    ).toArray()

    for (const batch of timedOutBatches) {
      const events = JSON.parse(batch.events) as InngestEvent[]

      // Store ready batch for InngestDO to pick up
      await this.state.storage.put(`batch:${batch.batch_key}:ready`, {
        functionId: batch.function_id,
        events,
      })

      this.state.storage.sql.exec(`DELETE FROM batches WHERE batch_key = ?`, batch.batch_key)
    }
  }

  // ===========================================================================
  // Debouncing
  // ===========================================================================

  /**
   * Add event with debouncing
   */
  private async debounceEvent(
    functionId: string,
    event: InngestEvent,
    config: DebounceConfig
  ): Promise<void> {
    // Calculate debounce key
    let debounceKey = functionId
    if (config.key) {
      const keyValue = getValueByPath({ event }, config.key)
      debounceKey = `${functionId}:${String(keyValue)}`
    }

    const periodMs = parseDuration(config.period)
    const now = Date.now()
    const triggerAt = now + periodMs

    // Get existing debounce
    const existing = this.state.storage.sql.exec<{
      max_wait_at: number | null
      created_at: number
    }>(
      `SELECT max_wait_at, created_at FROM debounces WHERE debounce_key = ?`,
      debounceKey
    ).one()

    let maxWaitAt = existing?.max_wait_at
    if (!maxWaitAt && config.timeout) {
      maxWaitAt = now + parseDuration(config.timeout)
    }

    // Check if we've exceeded max wait time
    if (maxWaitAt && now >= maxWaitAt) {
      // Trigger immediately
      await this.state.storage.put(`debounce:${debounceKey}:ready`, {
        functionId,
        event,
      })
      this.state.storage.sql.exec(`DELETE FROM debounces WHERE debounce_key = ?`, debounceKey)
      return
    }

    // Update or create debounce
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO debounces (debounce_key, function_id, event, trigger_at, max_wait_at)
       VALUES (?, ?, ?, ?, ?)`,
      debounceKey,
      functionId,
      JSON.stringify(event),
      triggerAt,
      maxWaitAt ?? null
    )

    await this.scheduleNextAlarm()
  }

  /**
   * Process debounce triggers
   */
  private async processDebounceTimeouts(now: number): Promise<void> {
    const readyDebounces = this.state.storage.sql.exec<{
      debounce_key: string
      function_id: string
      event: string
    }>(
      `SELECT debounce_key, function_id, event FROM debounces WHERE trigger_at <= ?`,
      now
    ).toArray()

    for (const debounce of readyDebounces) {
      const event = JSON.parse(debounce.event) as InngestEvent

      // Store ready debounce for InngestDO to pick up
      await this.state.storage.put(`debounce:${debounce.debounce_key}:ready`, {
        functionId: debounce.function_id,
        event,
      })

      this.state.storage.sql.exec(
        `DELETE FROM debounces WHERE debounce_key = ?`,
        debounce.debounce_key
      )
    }
  }

  // ===========================================================================
  // Replay
  // ===========================================================================

  /**
   * Replay events for reprocessing
   */
  private async replayEvents(options: {
    eventName?: string
    fromTs?: number
    toTs?: number
    limit?: number
  }): Promise<InngestEvent[]> {
    let query = `SELECT * FROM events WHERE 1=1`
    const args: (string | number)[] = []

    if (options.eventName) {
      query += ` AND name = ?`
      args.push(options.eventName)
    }

    if (options.fromTs) {
      query += ` AND ts >= ?`
      args.push(options.fromTs)
    }

    if (options.toTs) {
      query += ` AND ts <= ?`
      args.push(options.toTs)
    }

    query += ` ORDER BY ts ASC`

    if (options.limit) {
      query += ` LIMIT ?`
      args.push(options.limit)
    }

    const rows = this.state.storage.sql.exec<{
      id: string
      name: string
      data: string
      user_data: string | null
      ts: number
      v: string | null
    }>(query, ...args).toArray()

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      data: JSON.parse(row.data),
      user: row.user_data ? JSON.parse(row.user_data) : undefined,
      ts: row.ts,
      v: row.v ?? undefined,
    }))
  }

  /**
   * Purge old events
   */
  private async purgeEvents(olderThan: number): Promise<number> {
    const result = this.state.storage.sql.exec(
      `DELETE FROM events WHERE stored_at < ?`,
      olderThan
    )
    return result.rowsWritten
  }

  // ===========================================================================
  // Alarm Scheduling
  // ===========================================================================

  /**
   * Schedule the next alarm
   */
  private async scheduleNextAlarm(): Promise<void> {
    // Find earliest timeout across all types
    const batchTimeout = this.state.storage.sql.exec<{ timeout_at: number }>(
      `SELECT MIN(timeout_at) as timeout_at FROM batches`
    ).one()

    const debounceTimeout = this.state.storage.sql.exec<{ trigger_at: number }>(
      `SELECT MIN(trigger_at) as trigger_at FROM debounces`
    ).one()

    const waiterTimeout = this.state.storage.sql.exec<{ timeout_at: number }>(
      `SELECT MIN(timeout_at) as timeout_at FROM event_waiters WHERE timeout_at IS NOT NULL`
    ).one()

    const times = [
      batchTimeout?.timeout_at,
      debounceTimeout?.trigger_at,
      waiterTimeout?.timeout_at,
    ].filter((t): t is number => t !== null && t !== undefined)

    if (times.length > 0) {
      const nextAlarm = Math.min(...times)
      await this.state.storage.setAlarm(nextAlarm)
    }
  }
}
