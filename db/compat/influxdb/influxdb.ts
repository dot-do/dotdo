/**
 * @dotdo/influxdb - InfluxDB v2 SDK compat
 * Built on unified primitives: TemporalStore, TypedColumnStore, WindowManager, ExactlyOnceContext
 */
import { createTemporalStore, type TemporalStore, type TimeRange } from '../../primitives/temporal-store'
import { createColumnStore, type TypedColumnStore } from '../../primitives/typed-column-store'
import { createExactlyOnceContext, type ExactlyOnceContext } from '../../primitives/exactly-once-context'
import { WindowManager, minutes, hours, seconds, type Duration, EventTimeTrigger } from '../../primitives/window-manager'
import type { Bucket, Point, ParsedLine, FluxQuery, QueryResult, FluxTable, FluxRecord, FluxColumn, DeletePredicate, Health, InfluxDBClientOptions, RetentionRule } from './types'
import { InfluxDBError, WriteError, QueryError } from './types'

// Line Protocol Parser
export function parseLineProtocol(line: string): ParsedLine {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) throw new WriteError('Empty or comment line')

  const firstSpaceIdx = trimmed.indexOf(' ')
  if (firstSpaceIdx === -1) throw new WriteError('Invalid line protocol: missing fields')

  const measurementAndTags = trimmed.substring(0, firstSpaceIdx)
  const rest = trimmed.substring(firstSpaceIdx + 1)

  let fieldsStr = rest, timestampStr: string | undefined
  let inQuote = false, lastSpaceOutsideQuote = -1
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '"') inQuote = !inQuote
    else if (rest[i] === ' ' && !inQuote) lastSpaceOutsideQuote = i
  }

  if (lastSpaceOutsideQuote > 0) {
    const possibleTs = rest.substring(lastSpaceOutsideQuote + 1)
    if (/^\d+$/.test(possibleTs)) {
      fieldsStr = rest.substring(0, lastSpaceOutsideQuote)
      timestampStr = possibleTs
    }
  }

  const tagParts = measurementAndTags.split(',')
  const measurement = tagParts[0]
  if (!measurement) throw new WriteError('Invalid line protocol: missing measurement')

  const tags: Record<string, string> = {}
  for (let i = 1; i < tagParts.length; i++) {
    const [k, v] = tagParts[i].split('=')
    if (k && v !== undefined) tags[k] = v
  }

  const fields: Record<string, number | string | boolean> = {}
  let idx = 0
  while (idx < fieldsStr.length) {
    const eqIdx = fieldsStr.indexOf('=', idx)
    if (eqIdx === -1) break
    const key = fieldsStr.substring(idx, eqIdx)
    let valueStart = eqIdx + 1, valueEnd: number
    if (fieldsStr[valueStart] === '"') {
      valueEnd = fieldsStr.indexOf('"', valueStart + 1)
      if (valueEnd === -1) valueEnd = fieldsStr.length
      else valueEnd++
    } else {
      valueEnd = fieldsStr.indexOf(',', valueStart)
      if (valueEnd === -1) valueEnd = fieldsStr.length
    }
    let val: string | number | boolean = fieldsStr.substring(valueStart, valueEnd)
    if (val === 'true' || val === 'True' || val === 'TRUE') fields[key] = true
    else if (val === 'false' || val === 'False' || val === 'FALSE') fields[key] = false
    else if (val.startsWith('"') && val.endsWith('"')) fields[key] = val.slice(1, -1)
    else if (val.endsWith('i')) fields[key] = parseInt(val.slice(0, -1), 10)
    else { const n = parseFloat(val); fields[key] = isNaN(n) ? val : n }
    idx = valueEnd + 1
  }
  if (Object.keys(fields).length === 0) throw new WriteError('Invalid line protocol: no valid fields')

  let timestamp: number | undefined
  if (timestampStr) {
    timestamp = parseInt(timestampStr, 10)
    const digits = timestampStr.length
    if (digits >= 19) timestamp = Math.floor(timestamp / 1e6)
    else if (digits >= 16) timestamp = Math.floor(timestamp / 1e3)
    else if (digits <= 10) timestamp = timestamp * 1000
  }
  return { measurement, tags, fields, timestamp }
}

export function toLineProtocol(point: Point): string {
  let mtags = point.measurement
  for (const k of Object.keys(point.tags).sort()) mtags += `,${k}=${point.tags[k]}`
  const flds = Object.entries(point.fields).map(([k, v]) =>
    typeof v === 'string' ? `${k}="${v}"` : typeof v === 'boolean' ? `${k}=${v}` : Number.isInteger(v) ? `${k}=${v}i` : `${k}=${v}`
  ).join(',')
  return `${mtags} ${flds} ${point.timestamp}`
}

// Flux Query Parser
export function parseFluxQuery(query: string): FluxQuery {
  const result: FluxQuery = { bucket: '' }
  const bucketMatch = query.match(/from\s*\(\s*bucket\s*:\s*"([^"]+)"\s*\)/)
  if (!bucketMatch) throw new QueryError('Invalid Flux query: missing from(bucket:)')
  result.bucket = bucketMatch[1]

  const rangeMatch = query.match(/range\s*\(\s*start\s*:\s*([^,)]+?)(?:\s*,\s*stop\s*:\s*([^)]+?(?:\(\))?))?\s*\)/)
  if (rangeMatch) {
    result.range = { start: parseFluxTime(rangeMatch[1]), stop: rangeMatch[2] ? parseFluxTime(rangeMatch[2]) : undefined }
  }

  const filters: FluxQuery['filters'] = []
  for (const m of query.matchAll(/filter\s*\(\s*fn\s*:\s*\([^)]*\)\s*=>\s*r(?:\.(\w+)|\["([^"]+)"\])\s*(==|!=|>|<|>=|<=)\s*"?([^")\s]+)"?\s*\)/g)) {
    let val: string | number | boolean = m[4]
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (!isNaN(Number(val))) val = Number(val)
    filters.push({ column: m[1] || m[2], operator: m[3] as any, value: val })
  }
  if (filters.length) result.filters = filters

  const windowMatch = query.match(/aggregateWindow\s*\(\s*every\s*:\s*([^,)]+)/)
  if (windowMatch) result.window = { every: windowMatch[1].trim() }

  const aggMatch = query.match(/\|\>\s*(mean|sum|count|min|max|first|last|median|stddev)\s*\(\s*\)/)
  if (aggMatch) result.aggregations = [{ fn: aggMatch[1] as any }]

  const limitMatch = query.match(/limit\s*\(\s*n\s*:\s*(\d+)\s*\)/)
  if (limitMatch) result.limit = parseInt(limitMatch[1], 10)

  return result
}

function parseFluxTime(expr: string): string | number {
  const t = expr.trim()
  if (t.startsWith('-')) return t
  if (t === 'now()') return Date.now()
  const d = new Date(t)
  return isNaN(d.getTime()) ? t : d.getTime()
}

export function resolveRelativeTime(expr: string | number, ref: number = Date.now()): number {
  if (typeof expr === 'number') return expr
  const m = expr.match(/^-(\d+)(s|m|h|d|w)$/)
  if (!m) { const d = new Date(expr); if (!isNaN(d.getTime())) return d.getTime(); throw new QueryError(`Invalid time: ${expr}`) }
  const mult: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }
  return ref - parseInt(m[1], 10) * mult[m[2]]
}

function parseDuration(expr: string): Duration {
  const m = expr.match(/^(\d+)(s|m|h)$/)
  if (!m) throw new QueryError(`Invalid duration: ${expr}`)
  const v = parseInt(m[1], 10)
  return m[2] === 's' ? seconds(v) : m[2] === 'm' ? minutes(v) : hours(v)
}

// Storage
interface BucketStorage { bucket: Bucket; temporalStore: TemporalStore<Point>; columnStore: TypedColumnStore; exactlyOnce: ExactlyOnceContext }

// InfluxDB Client
export class InfluxDB {
  private options: InfluxDBClientOptions
  private buckets: Map<string, BucketStorage> = new Map()
  private orgId: string

  constructor(options?: InfluxDBClientOptions) {
    this.options = options ?? {}
    this.orgId = options?.org ?? 'default-org'
  }

  getWriteApi(org: string, bucket: string, precision: 'ns' | 'us' | 'ms' | 's' = 'ns'): WriteApi {
    return new WriteApi(this, org, bucket, precision)
  }

  async write(bucket: string, points: Point[]): Promise<void> {
    const storage = this.getOrCreateBucket(bucket)
    for (const p of points) {
      const pid = `${p.measurement}:${JSON.stringify(p.tags)}:${p.timestamp}`
      await storage.exactlyOnce.processOnce(pid, async () => {
        const key = `${p.measurement}:${Object.entries(p.tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')}:${p.timestamp}`
        await storage.temporalStore.put(key, p, p.timestamp)
      })
    }
  }

  async writeLineProtocol(bucket: string, data: string): Promise<void> {
    const points: Point[] = []
    for (const line of data.split('\n').filter(l => l.trim() && !l.startsWith('#'))) {
      try {
        const p = parseLineProtocol(line)
        points.push({ measurement: p.measurement, tags: p.tags, fields: p.fields, timestamp: p.timestamp ?? Date.now() })
      } catch { /* skip */ }
    }
    if (points.length) await this.write(bucket, points)
  }

  getQueryApi(org: string): QueryApi { return new QueryApi(this, org) }

  async query(query: string | FluxQuery): Promise<QueryResult> {
    const q = typeof query === 'string' ? parseFluxQuery(query) : query
    const storage = this.buckets.get(q.bucket)
    if (!storage) return { tables: [] }

    const now = Date.now()
    let start = 0, end = now
    if (q.range) {
      start = resolveRelativeTime(q.range.start, now)
      if (q.range.stop) end = resolveRelativeTime(q.range.stop, now)
    }

    const points: Point[] = []
    const timeRange: TimeRange = { start, end }
    const iter = storage.temporalStore.range('', timeRange)
    let r = await iter.next()
    while (!r.done) {
      if (r.value && this.matchesFilters(r.value, q.filters)) points.push(r.value)
      r = await iter.next()
    }

    if (q.window && q.aggregations?.length) return this.aggregateWithWindow(points, q)
    if (q.aggregations?.length) return this.aggregate(points, q)
    return this.toResult(q.limit ? points.slice(0, q.limit) : points)
  }

  private aggregateWithWindow(points: Point[], q: FluxQuery): QueryResult {
    if (!q.window || !q.aggregations?.length) return this.toResult(points)
    const dur = parseDuration(q.window.every), wm = new WindowManager<Point>(WindowManager.tumbling<Point>(dur))
    wm.withTrigger(new EventTimeTrigger<Point>())
    const windows: Map<string, Point[]> = new Map()
    wm.onTrigger((w, els) => windows.set(`${w.start}-${w.end}`, els))
    for (const p of points) wm.process(p, p.timestamp)
    const maxTs = Math.max(...points.map(p => p.timestamp)), windowSize = dur.toMillis()
    wm.advanceWatermark((Math.floor(maxTs / windowSize) + 1) * windowSize + 1)

    const aggPts: Point[] = []
    for (const [wk, wps] of windows) {
      if (!wps.length) continue
      const ws = parseInt(wk.split('-')[0], 10)
      const fnames = new Set<string>(); wps.forEach(p => Object.keys(p.fields).forEach(k => fnames.add(k)))
      const agg: Record<string, number> = {}
      for (const fn of fnames) {
        const vals = wps.map(p => p.fields[fn]).filter((v): v is number => typeof v === 'number')
        if (vals.length) agg[fn] = this.compute(vals, q.aggregations![0].fn)
      }
      aggPts.push({ measurement: wps[0].measurement, tags: wps[0].tags, fields: agg, timestamp: ws })
    }
    return this.toResult(aggPts)
  }

  private aggregate(points: Point[], q: FluxQuery): QueryResult {
    if (!q.aggregations?.length || !points.length) return this.toResult(points)
    const fnames = new Set<string>(); points.forEach(p => Object.keys(p.fields).forEach(k => fnames.add(k)))
    const agg: Record<string, number> = {}
    for (const fn of fnames) {
      const vals = points.map(p => p.fields[fn]).filter((v): v is number => typeof v === 'number')
      if (vals.length) agg[fn] = this.compute(vals, q.aggregations[0].fn)
    }
    return this.toResult([{ measurement: points[0].measurement, tags: points[0].tags, fields: agg, timestamp: points[0].timestamp }])
  }

  private compute(vals: number[], fn: string): number {
    switch (fn) {
      case 'mean': return vals.reduce((a, b) => a + b, 0) / vals.length
      case 'sum': return vals.reduce((a, b) => a + b, 0)
      case 'count': return vals.length
      case 'min': return Math.min(...vals)
      case 'max': return Math.max(...vals)
      case 'first': return vals[0]
      case 'last': return vals[vals.length - 1]
      case 'median': { const s = [...vals].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
      case 'stddev': { const avg = vals.reduce((a, b) => a + b, 0) / vals.length; return Math.sqrt(vals.map(v => (v - avg) ** 2).reduce((a, b) => a + b, 0) / vals.length) }
      default: return vals[0]
    }
  }

  private matchesFilters(p: Point, filters?: FluxQuery['filters']): boolean {
    if (!filters?.length) return true
    for (const f of filters) {
      const v = f.column === '_measurement' ? p.measurement : f.column === '_time' ? p.timestamp : p.tags[f.column] ?? p.fields[f.column]
      if (v === undefined) return false
      if (f.operator === '==' && v !== f.value) return false
      if (f.operator === '!=' && v === f.value) return false
      if (f.operator === '>' && !(v > f.value)) return false
      if (f.operator === '<' && !(v < f.value)) return false
      if (f.operator === '>=' && !(v >= f.value)) return false
      if (f.operator === '<=' && !(v <= f.value)) return false
    }
    return true
  }

  private toResult(points: Point[]): QueryResult {
    if (!points.length) return { tables: [] }
    const fnames = new Set<string>(), tnames = new Set<string>()
    points.forEach(p => { Object.keys(p.fields).forEach(k => fnames.add(k)); Object.keys(p.tags).forEach(k => tnames.add(k)) })
    const cols: FluxColumn[] = [
      { label: '_time', dataType: 'dateTime:RFC3339', group: false },
      { label: '_measurement', dataType: 'string', group: true },
      ...Array.from(tnames).map(n => ({ label: n, dataType: 'string' as const, group: true })),
      ...Array.from(fnames).map(n => ({ label: `_value_${n}`, dataType: 'double' as const, group: false })),
    ]
    const table: FluxTable = { columns: cols, records: [] }
    for (const p of points) {
      const vals: Record<string, unknown> = { _time: new Date(p.timestamp).toISOString(), _measurement: p.measurement, ...p.tags }
      for (const [f, v] of Object.entries(p.fields)) vals[`_value_${f}`] = v
      table.records.push({ values: vals, tableMeta: table })
    }
    return { tables: [table] }
  }

  getBucketsApi(): BucketsApi { return new BucketsApi(this) }

  async createBucket(name: string, retentionSec: number = 0, org?: string): Promise<Bucket> {
    const id = `bucket-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const bucket: Bucket = { id, name, orgID: org ?? this.orgId, retentionRules: retentionSec > 0 ? [{ type: 'expire', everySeconds: retentionSec }] : [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const storage: BucketStorage = { bucket, temporalStore: createTemporalStore<Point>({ enableTTL: retentionSec > 0 }), columnStore: createColumnStore(), exactlyOnce: createExactlyOnceContext({ eventIdTtl: 60000 }) }
    storage.columnStore.addColumn('_time', 'timestamp'); storage.columnStore.addColumn('_measurement', 'string')
    this.buckets.set(name, storage)
    return bucket
  }

  async listBuckets(): Promise<Bucket[]> { return Array.from(this.buckets.values()).map(s => s.bucket) }
  async getBucket(name: string): Promise<Bucket | null> { return this.buckets.get(name)?.bucket ?? null }
  async deleteBucket(name: string): Promise<boolean> { return this.buckets.delete(name) }

  getDeleteApi(): DeleteApi { return new DeleteApi(this) }

  async delete(bucket: string, predicate: DeletePredicate): Promise<void> {
    const storage = this.buckets.get(bucket)
    if (!storage) throw new InfluxDBError(`Bucket not found: ${bucket}`, 404)
    const newStorage: BucketStorage = { bucket: storage.bucket, temporalStore: createTemporalStore<Point>({ enableTTL: storage.bucket.retentionRules.length > 0 }), columnStore: createColumnStore(), exactlyOnce: storage.exactlyOnce }
    newStorage.columnStore.addColumn('_time', 'timestamp'); newStorage.columnStore.addColumn('_measurement', 'string')
    this.buckets.set(bucket, newStorage)
  }

  async health(): Promise<Health> { return { name: 'influxdb-compat', message: 'ready for queries and writes', status: 'pass', version: '2.0.0', commit: 'dotdo-primitives' } }

  private getOrCreateBucket(name: string): BucketStorage {
    let s = this.buckets.get(name)
    if (!s) {
      const bucket: Bucket = { id: `bucket-${Date.now()}`, name, orgID: this.orgId, retentionRules: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      s = { bucket, temporalStore: createTemporalStore<Point>(), columnStore: createColumnStore(), exactlyOnce: createExactlyOnceContext({ eventIdTtl: 60000 }) }
      s.columnStore.addColumn('_time', 'timestamp'); s.columnStore.addColumn('_measurement', 'string')
      this.buckets.set(name, s)
    }
    return s
  }
}

// Write API
export class WriteApi {
  private client: InfluxDB; private bucket: string; private points: Point[] = []
  constructor(client: InfluxDB, _org: string, bucket: string, _precision: string) { this.client = client; this.bucket = bucket }
  writePoint(p: PointBuilder): void { this.points.push(p.toPoint()) }
  writePoints(ps: PointBuilder[]): void { ps.forEach(p => this.points.push(p.toPoint())) }
  writeRecord(r: string): void { const p = parseLineProtocol(r); this.points.push({ measurement: p.measurement, tags: p.tags, fields: p.fields, timestamp: p.timestamp ?? Date.now() }) }
  writeRecords(rs: string[]): void { rs.forEach(r => this.writeRecord(r)) }
  async flush(): Promise<void> { if (this.points.length) { await this.client.write(this.bucket, this.points); this.points = [] } }
  async close(): Promise<void> { await this.flush() }
}

// Point Builder
export class PointBuilder {
  private _measurement: string; private _tags: Record<string, string> = {}; private _fields: Record<string, number | string | boolean> = {}; private _timestamp?: number
  constructor(measurement: string) { this._measurement = measurement }
  static measurement(name: string): PointBuilder { return new PointBuilder(name) }
  tag(k: string, v: string): this { this._tags[k] = v; return this }
  intField(k: string, v: number): this { this._fields[k] = Math.round(v); return this }
  floatField(k: string, v: number): this { this._fields[k] = v; return this }
  stringField(k: string, v: string): this { this._fields[k] = v; return this }
  booleanField(k: string, v: boolean): this { this._fields[k] = v; return this }
  timestamp(t: Date | number): this { this._timestamp = typeof t === 'number' ? t : t.getTime(); return this }
  toPoint(): Point { return { measurement: this._measurement, tags: { ...this._tags }, fields: { ...this._fields }, timestamp: this._timestamp ?? Date.now() } }
  toLineProtocol(): string { return toLineProtocol(this.toPoint()) }
}

// Query API
export class QueryApi {
  private client: InfluxDB
  constructor(client: InfluxDB, _org: string) { this.client = client }
  async queryRows(query: string): Promise<FluxRecord[]> { return (await this.client.query(query)).tables.flatMap(t => t.records) }
  async collectRows<T = Record<string, unknown>>(query: string): Promise<T[]> { return (await this.client.query(query)).tables.flatMap(t => t.records.map(r => r.values as T)) }
  async queryRaw(query: string): Promise<QueryResult> { return this.client.query(query) }
}

// Buckets API
export class BucketsApi {
  private client: InfluxDB
  constructor(client: InfluxDB) { this.client = client }
  async createBucket(opts: { name: string; orgID?: string; retentionRules?: RetentionRule[] }): Promise<Bucket> { return this.client.createBucket(opts.name, opts.retentionRules?.[0]?.everySeconds ?? 0, opts.orgID) }
  async getBuckets(): Promise<Bucket[]> { return this.client.listBuckets() }
  async deleteBucket(name: string): Promise<void> { await this.client.deleteBucket(name) }
}

// Delete API
export class DeleteApi {
  private client: InfluxDB
  constructor(client: InfluxDB) { this.client = client }
  async postDelete(opts: { bucket: string; org?: string; body: DeletePredicate }): Promise<void> { await this.client.delete(opts.bucket, opts.body) }
}

// Factory functions
export function createClient(options?: InfluxDBClientOptions): InfluxDB { return new InfluxDB(options) }
export function Point(measurement: string): PointBuilder { return new PointBuilder(measurement) }
