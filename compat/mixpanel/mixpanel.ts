/**
 * @dotdo/mixpanel - Core Implementation
 *
 * Edge-compatible Mixpanel SDK implementation.
 * Provides full API compatibility including Funnels, Cohorts, JQL, and Export APIs.
 *
 * @module @dotdo/mixpanel/mixpanel
 */

import type {
  MixpanelConfig,
  TrackProperties,
  TrackEvent,
  Callback,
  PeopleProperties,
  PeopleUpdate,
  GroupUpdate,
  ExportOptions,
  JQLOptions,
  FunnelOptions,
  SegmentationOptions,
  RetentionOptions,
  TrackResponse,
  EngageResponse,
  QueryResult,
  ImportEvent,
  ImportResponse,
  Transport,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/mixpanel'
const SDK_VERSION = '0.1.0'
const DEFAULT_HOST = 'https://api.mixpanel.com'
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_BATCH_FLUSH_INTERVAL = 10000
const DEFAULT_MAX_RETRIES = 3

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a UUID v4 for insert_id.
 */
function generateInsertId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const byte6 = bytes[6]
  const byte8 = bytes[8]
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40
  }
  if (byte8 !== undefined) {
    bytes[8] = (byte8 & 0x3f) | 0x80
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Generate a random device ID.
 */
function generateDeviceId(): string {
  return `$device:${generateInsertId()}`
}

/**
 * Base64 encode for Mixpanel API.
 */
function base64Encode(str: string): string {
  return btoa(str)
}

// =============================================================================
// In-Memory Transport (for testing)
// =============================================================================

/**
 * Extended transport interface with event recording for testing.
 */
export interface RecordingTransport extends Transport {
  recordEvent(event: TrackEvent): void
  recordPeopleUpdate(update: PeopleUpdate): void
  recordGroupUpdate(update: GroupUpdate): void
  getEvents(): TrackEvent[]
  getPeopleUpdates(): PeopleUpdate[]
  getGroupUpdates(): GroupUpdate[]
}

/**
 * In-memory transport for testing.
 */
export class InMemoryTransport implements RecordingTransport {
  private events: TrackEvent[] = []
  private peopleUpdates: PeopleUpdate[] = []
  private groupUpdates: GroupUpdate[] = []
  private imports: ImportEvent[] = []
  private batches: TrackEvent[][] = []

  recordEvent(event: TrackEvent): void {
    this.events.push(event)
  }

  recordPeopleUpdate(update: PeopleUpdate): void {
    this.peopleUpdates.push(update)
  }

  recordGroupUpdate(update: GroupUpdate): void {
    this.groupUpdates.push(update)
  }

  recordImport(event: ImportEvent): void {
    this.imports.push(event)
  }

  recordBatch(events: TrackEvent[]): void {
    this.batches.push([...events])
  }

  async track(events: TrackEvent[]): Promise<TrackResponse> {
    // Record batch when flush is called
    if (events.length > 0) {
      this.recordBatch(events)
    }
    return { status: 1 }
  }

  async engage(updates: PeopleUpdate[]): Promise<EngageResponse> {
    return { status: 1 }
  }

  async groups(updates: GroupUpdate[]): Promise<EngageResponse> {
    return { status: 1 }
  }

  // Alias methods for test compatibility
  getTrackEvents(): TrackEvent[] {
    return [...this.events]
  }

  getEngageUpdates(): PeopleUpdate[] {
    return [...this.peopleUpdates]
  }

  getGroupUpdates(): GroupUpdate[] {
    return [...this.groupUpdates]
  }

  getImports(): ImportEvent[] {
    return [...this.imports]
  }

  getBatches(): TrackEvent[][] {
    return [...this.batches]
  }

  // Original method names
  getEvents(): TrackEvent[] {
    return this.getTrackEvents()
  }

  getPeopleUpdates(): PeopleUpdate[] {
    return this.getEngageUpdates()
  }

  clear(): void {
    this.events = []
    this.peopleUpdates = []
    this.groupUpdates = []
    this.imports = []
    this.batches = []
  }
}

// =============================================================================
// HTTP Transport
// =============================================================================

/**
 * HTTP transport using fetch.
 */
export class HttpTransport implements Transport {
  private readonly token: string
  private readonly host: string
  private readonly secret?: string

  constructor(options: { token: string; host?: string; secret?: string }) {
    this.token = options.token
    this.host = options.host || DEFAULT_HOST
    this.secret = options.secret
  }

  async track(events: TrackEvent[]): Promise<TrackResponse> {
    const url = `${this.host}/track`
    const data = base64Encode(JSON.stringify(events))

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/plain',
        },
        body: `data=${encodeURIComponent(data)}`,
      })

      const text = await response.text()
      return { status: text === '1' ? 1 : 0 }
    } catch {
      return { status: 0, error: 'Network error' }
    }
  }

  async engage(updates: PeopleUpdate[]): Promise<EngageResponse> {
    const url = `${this.host}/engage`
    const data = base64Encode(JSON.stringify(updates))

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/plain',
        },
        body: `data=${encodeURIComponent(data)}`,
      })

      const text = await response.text()
      return { status: text === '1' ? 1 : 0 }
    } catch {
      return { status: 0, error: 'Network error' }
    }
  }

  async groups(updates: GroupUpdate[]): Promise<EngageResponse> {
    const url = `${this.host}/groups`
    const data = base64Encode(JSON.stringify(updates))

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/plain',
        },
        body: `data=${encodeURIComponent(data)}`,
      })

      const text = await response.text()
      return { status: text === '1' ? 1 : 0 }
    } catch {
      return { status: 0, error: 'Network error' }
    }
  }
}

// =============================================================================
// People API Class
// =============================================================================

/**
 * People (user profiles) API.
 */
export class People {
  constructor(
    private readonly client: Mixpanel,
    private readonly transport: Transport,
    private readonly token: string
  ) {}

  /**
   * Set user properties.
   */
  set(distinctId: string, properties: PeopleProperties, callback?: Callback): void
  set(distinctId: string, property: string, value: unknown, callback?: Callback): void
  set(
    distinctId: string,
    propertiesOrKey: PeopleProperties | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $set: props as PeopleProperties,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Set user property only if not already set.
   */
  set_once(distinctId: string, properties: PeopleProperties, callback?: Callback): void
  set_once(distinctId: string, property: string, value: unknown, callback?: Callback): void
  set_once(
    distinctId: string,
    propertiesOrKey: PeopleProperties | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $set_once: props as PeopleProperties,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Increment numeric property.
   */
  increment(distinctId: string, properties: Record<string, number>, callback?: Callback): void
  increment(distinctId: string, property: string, value?: number, callback?: Callback): void
  increment(
    distinctId: string,
    propertiesOrKey: Record<string, number> | string,
    valueOrCallback?: number | Callback,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: typeof valueOrCallback === 'number' ? valueOrCallback : 1 }
        : propertiesOrKey
    const cb =
      typeof valueOrCallback === 'function'
        ? valueOrCallback
        : callback

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $add: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Append to list property.
   */
  append(distinctId: string, properties: Record<string, unknown>, callback?: Callback): void
  append(distinctId: string, property: string, value: unknown, callback?: Callback): void
  append(
    distinctId: string,
    propertiesOrKey: Record<string, unknown> | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $append: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Union with list property (unique values only).
   */
  union(distinctId: string, properties: Record<string, unknown[]>, callback?: Callback): void
  union(distinctId: string, property: string, values: unknown[], callback?: Callback): void
  union(
    distinctId: string,
    propertiesOrKey: Record<string, unknown[]> | string,
    valuesOrCallback?: unknown[] | Callback,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valuesOrCallback as unknown[] }
        : propertiesOrKey
    const cb =
      typeof valuesOrCallback === 'function'
        ? valuesOrCallback
        : callback

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $union: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Remove from list property.
   */
  remove(distinctId: string, properties: Record<string, unknown>, callback?: Callback): void
  remove(distinctId: string, property: string, value: unknown, callback?: Callback): void
  remove(
    distinctId: string,
    propertiesOrKey: Record<string, unknown> | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $remove: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Unset (delete) properties.
   */
  unset(distinctId: string, properties: string[], callback?: Callback): void
  unset(distinctId: string, property: string, callback?: Callback): void
  unset(
    distinctId: string,
    propertiesOrKey: string[] | string,
    callback?: Callback
  ): void {
    const props = Array.isArray(propertiesOrKey) ? propertiesOrKey : [propertiesOrKey]

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $unset: props,
    }

    this.enqueueUpdate(update, callback)
  }

  /**
   * Delete the user profile.
   */
  deleteUser(distinctId: string, callback?: Callback): void {
    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $delete: true,
    }

    this.enqueueUpdate(update, callback)
  }

  /**
   * Track a charge (revenue).
   */
  track_charge(
    distinctId: string,
    amount: number,
    properties?: Record<string, unknown>,
    callback?: Callback
  ): void {
    const transaction = {
      $amount: amount,
      $time: new Date().toISOString(),
      ...properties,
    }

    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $append: { $transactions: transaction },
    }

    this.enqueueUpdate(update, callback)
  }

  /**
   * Clear all charges.
   */
  clear_charges(distinctId: string, callback?: Callback): void {
    const update: PeopleUpdate = {
      $token: this.token,
      $distinct_id: distinctId,
      $set: { $transactions: [] },
    }

    this.enqueueUpdate(update, callback)
  }

  private enqueueUpdate(update: PeopleUpdate, callback?: Callback): void {
    // Record immediately for testing
    if ('recordPeopleUpdate' in this.transport) {
      (this.transport as RecordingTransport).recordPeopleUpdate(update)
    }

    this.client.enqueuePeopleUpdate(update, callback)
  }
}

// =============================================================================
// Groups API Class
// =============================================================================

/**
 * Groups analytics API.
 */
export class Groups {
  constructor(
    private readonly client: Mixpanel,
    private readonly transport: Transport,
    private readonly token: string
  ) {}

  /**
   * Set group properties.
   */
  set(groupKey: string, groupId: string, properties: Record<string, unknown>, callback?: Callback): void
  set(groupKey: string, groupId: string, property: string, value: unknown, callback?: Callback): void
  set(
    groupKey: string,
    groupId: string,
    propertiesOrKey: Record<string, unknown> | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: GroupUpdate = {
      $token: this.token,
      $group_key: groupKey,
      $group_id: groupId,
      $set: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Set group property only if not already set.
   */
  set_once(groupKey: string, groupId: string, properties: Record<string, unknown>, callback?: Callback): void
  set_once(groupKey: string, groupId: string, property: string, value: unknown, callback?: Callback): void
  set_once(
    groupKey: string,
    groupId: string,
    propertiesOrKey: Record<string, unknown> | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: GroupUpdate = {
      $token: this.token,
      $group_key: groupKey,
      $group_id: groupId,
      $set_once: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Delete the group.
   */
  deleteGroup(groupKey: string, groupId: string, callback?: Callback): void {
    const update: GroupUpdate = {
      $token: this.token,
      $group_key: groupKey,
      $group_id: groupId,
      $delete: true,
    }

    this.enqueueUpdate(update, callback)
  }

  /**
   * Remove from list property.
   */
  remove(groupKey: string, groupId: string, properties: Record<string, unknown>, callback?: Callback): void
  remove(groupKey: string, groupId: string, property: string, value: unknown, callback?: Callback): void
  remove(
    groupKey: string,
    groupId: string,
    propertiesOrKey: Record<string, unknown> | string,
    valueOrCallback?: unknown,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valueOrCallback }
        : propertiesOrKey
    const cb = typeof valueOrCallback === 'function' ? valueOrCallback as Callback : callback

    const update: GroupUpdate = {
      $token: this.token,
      $group_key: groupKey,
      $group_id: groupId,
      $remove: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Union with list property.
   */
  union(groupKey: string, groupId: string, properties: Record<string, unknown[]>, callback?: Callback): void
  union(groupKey: string, groupId: string, property: string, values: unknown[], callback?: Callback): void
  union(
    groupKey: string,
    groupId: string,
    propertiesOrKey: Record<string, unknown[]> | string,
    valuesOrCallback?: unknown[] | Callback,
    callback?: Callback
  ): void {
    const props =
      typeof propertiesOrKey === 'string'
        ? { [propertiesOrKey]: valuesOrCallback as unknown[] }
        : propertiesOrKey
    const cb =
      typeof valuesOrCallback === 'function'
        ? valuesOrCallback
        : callback

    const update: GroupUpdate = {
      $token: this.token,
      $group_key: groupKey,
      $group_id: groupId,
      $union: props,
    }

    this.enqueueUpdate(update, cb)
  }

  /**
   * Unset (delete) properties.
   */
  unset(groupKey: string, groupId: string, properties: string[], callback?: Callback): void {
    const update: GroupUpdate = {
      $token: this.token,
      $group_key: groupKey,
      $group_id: groupId,
      $unset: properties,
    }

    this.enqueueUpdate(update, callback)
  }

  private enqueueUpdate(update: GroupUpdate, callback?: Callback): void {
    // Record immediately for testing
    if ('recordGroupUpdate' in this.transport) {
      (this.transport as RecordingTransport).recordGroupUpdate(update)
    }

    this.client.enqueueGroupUpdate(update, callback)
  }
}

// =============================================================================
// Data Export API
// =============================================================================

/**
 * Data Export API for raw data access.
 */
export class DataExport {
  constructor(
    private readonly host: string,
    private readonly secret: string
  ) {}

  /**
   * Export raw event data.
   */
  async export(options: ExportOptions): Promise<AsyncIterable<Record<string, unknown>>> {
    const params = new URLSearchParams({
      from_date: options.from_date,
      to_date: options.to_date,
    })

    if (options.limit) params.set('limit', String(options.limit))
    if (options.event) {
      const events = Array.isArray(options.event) ? options.event : [options.event]
      params.set('event', JSON.stringify(events))
    }
    if (options.where) params.set('where', options.where)

    const url = `${this.host}/api/2.0/export?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`)
    }

    // Return async generator for streaming JSONL
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    return this.parseJsonLines(reader)
  }

  private async *parseJsonLines(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncIterable<Record<string, unknown>> {
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line)
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    // Handle any remaining buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer)
      } catch {
        // Skip malformed lines
      }
    }
  }
}

// =============================================================================
// JQL Query API
// =============================================================================

/**
 * JQL (JavaScript Query Language) API.
 */
export class JQL {
  constructor(
    private readonly host: string,
    private readonly secret: string
  ) {}

  /**
   * Execute a JQL script.
   */
  async query<T = unknown>(options: JQLOptions): Promise<QueryResult<T>> {
    const url = `${this.host}/api/2.0/jql`
    const auth = base64Encode(`${this.secret}:`)

    const body: Record<string, unknown> = {
      script: options.script,
    }
    if (options.params) {
      body.params = JSON.stringify(options.params)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body as Record<string, string>),
    })

    if (!response.ok) {
      return { error: `JQL query failed: ${response.status}` }
    }

    const data = await response.json() as T
    return { results: data }
  }
}

// =============================================================================
// Funnels API
// =============================================================================

/**
 * Funnels analytics API.
 */
export class Funnels {
  constructor(
    private readonly host: string,
    private readonly secret: string
  ) {}

  /**
   * Get funnel data.
   */
  async get(options: FunnelOptions): Promise<QueryResult<FunnelResult>> {
    const params = new URLSearchParams({
      funnel_id: String(options.funnel_id),
    })

    if (options.from_date) params.set('from_date', options.from_date)
    if (options.to_date) params.set('to_date', options.to_date)
    if (options.length) params.set('length', String(options.length))
    if (options.unit) params.set('unit', options.unit)
    if (options.on) params.set('on', options.on)
    if (options.where) params.set('where', options.where)
    if (options.limit) params.set('limit', String(options.limit))

    const url = `${this.host}/api/2.0/funnels?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Funnel query failed: ${response.status}` }
    }

    const data = await response.json() as FunnelResult
    return { results: data, computed_at: new Date().toISOString() }
  }

  /**
   * List available funnels.
   */
  async list(): Promise<QueryResult<FunnelMeta[]>> {
    const url = `${this.host}/api/2.0/funnels/list`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Funnel list failed: ${response.status}` }
    }

    const data = await response.json() as FunnelMeta[]
    return { results: data }
  }
}

/**
 * Funnel result data structure.
 */
export interface FunnelResult {
  meta: {
    dates: string[]
  }
  data: Record<string, FunnelStepData[]>
}

/**
 * Funnel step data.
 */
export interface FunnelStepData {
  step_label: string
  count: number
  overall_conv_ratio: number
  step_conv_ratio: number
  avg_time?: number
}

/**
 * Funnel metadata.
 */
export interface FunnelMeta {
  funnel_id: number
  name: string
}

// =============================================================================
// Segmentation API
// =============================================================================

/**
 * Segmentation analytics API.
 */
export class Segmentation {
  constructor(
    private readonly host: string,
    private readonly secret: string
  ) {}

  /**
   * Get segmentation data.
   */
  async get(options: SegmentationOptions): Promise<QueryResult<SegmentationResult>> {
    const params = new URLSearchParams({
      event: options.event,
      from_date: options.from_date,
      to_date: options.to_date,
    })

    if (options.on) params.set('on', options.on)
    if (options.where) params.set('where', options.where)
    if (options.type) params.set('type', options.type)
    if (options.unit) params.set('unit', options.unit)

    const url = `${this.host}/api/2.0/segmentation?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Segmentation query failed: ${response.status}` }
    }

    const data = await response.json() as SegmentationResult
    return { results: data, computed_at: new Date().toISOString() }
  }

  /**
   * Get numeric segmentation.
   */
  async numeric(options: SegmentationOptions & { buckets?: number }): Promise<QueryResult<SegmentationResult>> {
    const params = new URLSearchParams({
      event: options.event,
      from_date: options.from_date,
      to_date: options.to_date,
    })

    if (options.on) params.set('on', options.on)
    if (options.buckets) params.set('buckets', String(options.buckets))

    const url = `${this.host}/api/2.0/segmentation/numeric?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Numeric segmentation query failed: ${response.status}` }
    }

    const data = await response.json() as SegmentationResult
    return { results: data, computed_at: new Date().toISOString() }
  }

  /**
   * Get sum segmentation.
   */
  async sum(options: SegmentationOptions): Promise<QueryResult<SegmentationResult>> {
    const params = new URLSearchParams({
      event: options.event,
      from_date: options.from_date,
      to_date: options.to_date,
    })

    if (options.on) params.set('on', options.on)
    if (options.where) params.set('where', options.where)

    const url = `${this.host}/api/2.0/segmentation/sum?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Sum segmentation query failed: ${response.status}` }
    }

    const data = await response.json() as SegmentationResult
    return { results: data, computed_at: new Date().toISOString() }
  }
}

/**
 * Segmentation result.
 */
export interface SegmentationResult {
  legend_size: number
  data: {
    series: string[]
    values: Record<string, Record<string, number>>
  }
}

// =============================================================================
// Retention API
// =============================================================================

/**
 * Retention analytics API.
 */
export class Retention {
  constructor(
    private readonly host: string,
    private readonly secret: string
  ) {}

  /**
   * Get retention data.
   */
  async get(options: RetentionOptions): Promise<QueryResult<RetentionResult>> {
    const params = new URLSearchParams({
      from_date: options.from_date,
      to_date: options.to_date,
    })

    if (options.born_event) params.set('born_event', options.born_event)
    if (options.event) params.set('event', options.event)
    if (options.born_where) params.set('born_where', options.born_where)
    if (options.where) params.set('where', options.where)
    if (options.interval_count) params.set('interval_count', String(options.interval_count))
    if (options.unit) params.set('unit', options.unit)
    if (options.retention_type) params.set('retention_type', options.retention_type)

    const url = `${this.host}/api/2.0/retention?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Retention query failed: ${response.status}` }
    }

    const data = await response.json() as RetentionResult
    return { results: data, computed_at: new Date().toISOString() }
  }
}

/**
 * Retention result.
 */
export interface RetentionResult {
  data: {
    [date: string]: {
      first: number
      counts: number[]
    }
  }
}

// =============================================================================
// Cohorts API
// =============================================================================

/**
 * Cohorts management API.
 */
export class Cohorts {
  constructor(
    private readonly host: string,
    private readonly secret: string
  ) {}

  /**
   * List all cohorts.
   */
  async list(): Promise<QueryResult<CohortMeta[]>> {
    const url = `${this.host}/api/2.0/cohorts/list`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Cohort list failed: ${response.status}` }
    }

    const data = await response.json() as CohortMeta[]
    return { results: data }
  }

  /**
   * Get cohort members.
   */
  async members(cohortId: number, options?: { page?: number }): Promise<QueryResult<CohortMembers>> {
    const params = new URLSearchParams({
      id: String(cohortId),
    })
    if (options?.page) params.set('page', String(options.page))

    const url = `${this.host}/api/2.0/engage?${params}`
    const auth = base64Encode(`${this.secret}:`)

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return { error: `Cohort members failed: ${response.status}` }
    }

    const data = await response.json() as CohortMembers
    return { results: data }
  }
}

/**
 * Cohort metadata.
 */
export interface CohortMeta {
  id: number
  name: string
  description?: string
  created: string
  count: number
  is_visible: boolean
  data_group_id?: number
}

/**
 * Cohort members result.
 */
export interface CohortMembers {
  page: number
  page_size: number
  total: number
  results: Array<{
    $distinct_id: string
    $properties: Record<string, unknown>
  }>
}

// =============================================================================
// Import API
// =============================================================================

/**
 * Bulk data import API.
 */
export class Import {
  constructor(
    private readonly host: string,
    private readonly token: string,
    private readonly secret?: string
  ) {}

  /**
   * Import events.
   */
  async events(events: ImportEvent[]): Promise<ImportResponse> {
    const url = `${this.host}/import`

    const eventsWithToken = events.map((e) => ({
      event: e.event,
      properties: {
        ...e.properties,
        token: this.token,
      },
    }))

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(eventsWithToken),
    })

    if (!response.ok) {
      return {
        code: response.status,
        num_records_imported: 0,
        error: `Import failed: ${response.status}`,
      }
    }

    const data = await response.json() as ImportResponse
    return data
  }

  /**
   * Import people profiles.
   */
  async people(profiles: PeopleUpdate[]): Promise<ImportResponse> {
    const url = `${this.host}/engage#profile-batch-update`

    const profilesWithToken = profiles.map((p) => ({
      ...p,
      $token: this.token,
    }))

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(profilesWithToken),
    })

    if (!response.ok) {
      return {
        code: response.status,
        num_records_imported: 0,
        error: `People import failed: ${response.status}`,
      }
    }

    const data = await response.json() as ImportResponse
    return data
  }
}

// =============================================================================
// Mixpanel Client
// =============================================================================

/**
 * Mixpanel analytics client with full API compatibility.
 */
export class Mixpanel {
  readonly token: string
  readonly config: Required<Pick<MixpanelConfig, 'host' | 'trackPath' | 'engagePath' | 'groupsPath' | 'debug' | 'batch' | 'batchSize' | 'batchFlushInterval' | 'maxRetries'>> & MixpanelConfig

  readonly people: People
  readonly groups: Groups

  // Query APIs (require secret)
  readonly export?: DataExport
  readonly jql?: JQL
  readonly funnels?: Funnels
  readonly segmentation?: Segmentation
  readonly retention?: Retention
  readonly cohorts?: Cohorts
  readonly importApi: Import

  private readonly transport: Transport & Partial<{ recordImport: (event: ImportEvent) => void }>
  private eventQueue: TrackEvent[] = []
  private peopleQueue: PeopleUpdate[] = []
  private groupQueue: GroupUpdate[] = []
  private pendingCallbacks: Array<{ callback: Callback; count: number }> = []
  private flushTimer?: ReturnType<typeof setTimeout>
  private distinctId?: string

  constructor(options: MixpanelConfig & { transport?: Transport }) {
    if (!options.token || options.token.trim() === '') {
      throw new Error('Token is required')
    }

    this.token = options.token
    this.config = {
      ...options,
      host: options.host || DEFAULT_HOST,
      trackPath: options.trackPath || '/track',
      engagePath: options.engagePath || '/engage',
      groupsPath: options.groupsPath || '/groups',
      debug: options.debug ?? false,
      batch: options.batch ?? true,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      batchFlushInterval: options.batchFlushInterval ?? DEFAULT_BATCH_FLUSH_INTERVAL,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    }

    this.transport = options.transport || new HttpTransport({
      token: this.token,
      host: this.config.host,
      secret: options.secret,
    })

    // Initialize People and Groups APIs
    this.people = new People(this, this.transport, this.token)
    this.groups = new Groups(this, this.transport, this.token)
    this.importApi = new Import(this.config.host, this.token, options.secret)

    // Initialize Query APIs if secret is provided
    if (options.secret) {
      this.export = new DataExport(this.config.host, options.secret)
      this.jql = new JQL(this.config.host, options.secret)
      this.funnels = new Funnels(this.config.host, options.secret)
      this.segmentation = new Segmentation(this.config.host, options.secret)
      this.retention = new Retention(this.config.host, options.secret)
      this.cohorts = new Cohorts(this.config.host, options.secret)
    }
  }

  // ===========================================================================
  // Track API
  // ===========================================================================

  /**
   * Track an event.
   */
  async track(event: string, properties?: TrackProperties, callback?: Callback): Promise<void> {
    if (!event) {
      throw new Error('Event name is required')
    }

    // Get distinct_id from properties, identified user, or throw
    const distinctId = properties?.distinct_id || this.distinctId
    if (!distinctId) {
      throw new Error('distinct_id is required. Either provide it in properties or call identify() first.')
    }

    const trackEvent: TrackEvent = {
      event,
      properties: {
        ...properties,
        token: this.token,
        distinct_id: distinctId as string,
        time: properties?.time ?? Math.floor(Date.now() / 1000),
        $insert_id: properties?.$insert_id || generateInsertId(),
        mp_lib: SDK_NAME,
        $lib_version: SDK_VERSION,
      },
    }

    // Record immediately for testing
    if ('recordEvent' in this.transport) {
      (this.transport as RecordingTransport).recordEvent(trackEvent)
    }

    this.eventQueue.push(trackEvent)

    // If callback is provided, flush immediately to invoke callback with result
    // Otherwise, use normal batching behavior
    if (callback) {
      try {
        await this.flush()
        callback()
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)))
      }
    } else {
      await this.scheduleFlush()
    }
  }

  /**
   * Create an alias linking two distinct IDs.
   */
  async alias(aliasId: string, distinctId: string, callback?: Callback): Promise<void> {
    await this.track('$create_alias', {
      distinct_id: distinctId,
      alias: aliasId,
    }, callback)
  }

  /**
   * Set the default distinct_id for all tracking calls.
   */
  identify(distinctId: string): void {
    this.distinctId = distinctId
  }

  /**
   * Clear the identified user.
   */
  reset(): void {
    this.distinctId = undefined
  }

  /**
   * Import a single historical event.
   */
  async import(event: string, properties: { distinct_id: string; time: number; [key: string]: unknown }, callback?: Callback): Promise<void> {
    const importEvent: ImportEvent = {
      event,
      properties: {
        ...properties,
        distinct_id: properties.distinct_id,
        time: properties.time,
      },
    }

    // Record for testing
    if (this.transport.recordImport) {
      this.transport.recordImport(importEvent)
    }

    try {
      await this.importApi.events([importEvent])
      callback?.()
    } catch (err) {
      callback?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /**
   * Batch import multiple historical events.
   */
  async import_batch(events: ImportEvent[], callback?: Callback): Promise<void> {
    // Record for testing
    if (this.transport.recordImport) {
      for (const event of events) {
        this.transport.recordImport(event)
      }
    }

    try {
      await this.importApi.events(events)
      callback?.()
    } catch (err) {
      callback?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // ===========================================================================
  // Internal Queue Methods
  // ===========================================================================

  /**
   * Enqueue a people update (internal).
   */
  enqueuePeopleUpdate(update: PeopleUpdate, callback?: Callback): void {
    this.peopleQueue.push(update)
    if (callback) {
      this.pendingCallbacks.push({ callback, count: 1 })
    }
    this.scheduleFlush()
  }

  /**
   * Enqueue a group update (internal).
   */
  enqueueGroupUpdate(update: GroupUpdate, callback?: Callback): void {
    this.groupQueue.push(update)
    if (callback) {
      this.pendingCallbacks.push({ callback, count: 1 })
    }
    this.scheduleFlush()
  }

  private async scheduleFlush(): Promise<void> {
    const shouldFlush =
      this.eventQueue.length >= this.config.batchSize ||
      this.peopleQueue.length >= this.config.batchSize ||
      this.groupQueue.length >= this.config.batchSize

    if (shouldFlush) {
      await this.flush()
      return
    }

    // For non-batching mode or immediate flush scenarios, flush now
    if (!this.config.batch) {
      await this.flush()
      return
    }

    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush().catch(() => {})
    }, this.config.batchFlushInterval)
  }

  /**
   * Flush all pending data.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    const events = [...this.eventQueue]
    const people = [...this.peopleQueue]
    const groups = [...this.groupQueue]

    this.eventQueue = []
    this.peopleQueue = []
    this.groupQueue = []

    const promises: Promise<unknown>[] = []

    if (events.length > 0) {
      promises.push(this.transport.track(events))
    }

    if (people.length > 0) {
      promises.push(this.transport.engage(people))
    }

    if (groups.length > 0) {
      promises.push(this.transport.groups(groups))
    }

    try {
      await Promise.all(promises)
      this.invokeCallbacks()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.invokeCallbacks(error)
      // Re-throw so callers can handle if needed
      throw error
    }
  }

  private invokeCallbacks(error?: Error): void {
    for (const { callback } of this.pendingCallbacks) {
      try {
        callback(error)
      } catch {
        // Ignore callback errors
      }
    }
    this.pendingCallbacks = []
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a Mixpanel client.
 */
export function createMixpanel(options: MixpanelConfig & { transport?: Transport }): Mixpanel {
  return new Mixpanel(options)
}

/**
 * Initialize Mixpanel with a token and optional config.
 */
export function init(token: string, config?: Partial<MixpanelConfig>): Mixpanel {
  return new Mixpanel({ ...config, token })
}
