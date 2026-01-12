/**
 * @dotdo/salesforce - Salesforce API Compatibility Layer
 *
 * Drop-in replacement for jsforce SDK with edge compatibility.
 * Supports Cloudflare Workers, Deno, and Node.js.
 *
 * @example
 * ```typescript
 * import jsforce from '@dotdo/salesforce'
 *
 * const conn = new jsforce.Connection({
 *   loginUrl: 'https://login.salesforce.com',
 * })
 *
 * await conn.login('user@example.com', 'password+token')
 *
 * // Query records
 * const result = await conn.query("SELECT Id, Name FROM Account")
 *
 * // Create records
 * const account = await conn.sobject('Account').create({
 *   Name: 'Acme Inc',
 *   Industry: 'Technology',
 * })
 *
 * // Bulk operations
 * const job = conn.bulk.createJob('Account', 'insert')
 * const batch = job.createBatch()
 * batch.execute([{ Name: 'Account 1' }, { Name: 'Account 2' }])
 * ```
 *
 * @module @dotdo/salesforce
 */

import { EventEmitter } from '../shared/event-emitter'
import type {
  SObject,
  SaveResult,
  UpsertResult,
  QueryResult,
  UserInfo,
  Identity,
  ConnectionConfig,
  AuthorizeParams,
  TokenResponse,
  AuthUrlOptions,
  OAuth2Config,
  DescribeGlobalResult,
  DescribeSObjectResult,
  DescribeOptions,
  BulkOperation,
  BulkJobInfo,
  BulkJobOptions,
  BulkJob,
  BulkBatch,
  BulkQueryJob,
  BulkResult,
  Report,
  ReportResult,
  ReportExecuteOptions,
  ReportInstance,
  ReportMetadata,
  DashboardListResult,
  MetadataType,
  MetadataComponent,
  MetadataListQuery,
  MetadataReadResult,
  WhereConditions,
  OrderDirection,
  SalesforceErrorData,
  OAuthError,
  Limits,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_VERSION = '59.0'
const DEFAULT_LOGIN_URL = 'https://login.salesforce.com'
const DEFAULT_TIMEOUT = 60000 // 60 seconds

// =============================================================================
// Salesforce Error Class
// =============================================================================

/**
 * Salesforce API Error
 */
export class SalesforceError extends Error {
  errorCode: string
  fields?: string[]
  statusCode: number

  constructor(error: SalesforceErrorData | OAuthError, statusCode: number) {
    const message = 'error_description' in error ? error.error_description : error.message
    super(message)
    this.name = 'SalesforceError'
    this.errorCode = 'error' in error ? error.error : error.errorCode
    this.fields = 'fields' in error ? error.fields : undefined
    this.statusCode = statusCode
  }
}

// =============================================================================
// OAuth2 Class
// =============================================================================

/**
 * OAuth2 handler for Salesforce authentication
 */
export class OAuth2 {
  private conn: Connection
  private config: OAuth2Config

  constructor(conn: Connection, config: OAuth2Config) {
    this.conn = conn
    this.config = config
  }

  /**
   * Get the authorization URL for web server flow
   */
  getAuthorizationUrl(options: AuthUrlOptions = {}): string {
    const loginUrl = this.config.loginUrl || this.conn.loginUrl || DEFAULT_LOGIN_URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri || '',
    })

    if (options.scope) {
      params.set('scope', options.scope)
    }
    if (options.state) {
      params.set('state', options.state)
    }
    if (options.prompt) {
      params.set('prompt', options.prompt)
    }
    if (options.display) {
      params.set('display', options.display)
    }
    if (options.nonce) {
      params.set('nonce', options.nonce)
    }
    if (options.code_challenge) {
      params.set('code_challenge', options.code_challenge)
      params.set('code_challenge_method', options.code_challenge_method || 'S256')
    }

    return `${loginUrl}/services/oauth2/authorize?${params.toString()}`
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshToken(): Promise<TokenResponse> {
    if (!this.conn.refreshToken) {
      throw new SalesforceError(
        { errorCode: 'NO_REFRESH_TOKEN', message: 'No refresh token available' },
        400
      )
    }

    return this.conn.authorize({
      grant_type: 'refresh_token',
      refresh_token: this.conn.refreshToken,
    })
  }
}

// =============================================================================
// SObject Resource Class
// =============================================================================

/**
 * SObject resource for CRUD operations
 */
export class SObjectResource {
  private conn: Connection
  private type: string
  private describeCache?: DescribeSObjectResult

  constructor(conn: Connection, type: string) {
    this.conn = conn
    this.type = type
  }

  /**
   * Create a single record or multiple records
   */
  async create(record: SObject): Promise<SaveResult>
  async create(records: SObject[]): Promise<SaveResult[]>
  async create(records: SObject | SObject[]): Promise<SaveResult | SaveResult[]> {
    if (Array.isArray(records)) {
      return this.createMultiple(records)
    }
    return this.createSingle(records)
  }

  private async createSingle(record: SObject): Promise<SaveResult> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${this.type}`
    const response = await this.conn._request<SaveResult | SalesforceErrorData[]>('POST', url, record)

    if (Array.isArray(response)) {
      throw new SalesforceError(response[0], 400)
    }

    return response
  }

  private async createMultiple(records: SObject[]): Promise<SaveResult[]> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/composite/sobjects`
    const body = {
      allOrNone: false,
      records: records.map((r) => ({ attributes: { type: this.type }, ...r })),
    }
    return this.conn._request<SaveResult[]>('POST', url, body)
  }

  /**
   * Retrieve a single record or multiple records by ID
   */
  async retrieve(id: string, fields?: string[]): Promise<SObject>
  async retrieve(ids: string[], fields?: string[]): Promise<SObject[]>
  async retrieve(ids: string | string[], fields?: string[]): Promise<SObject | SObject[]> {
    if (Array.isArray(ids)) {
      return this.retrieveMultiple(ids, fields)
    }
    return this.retrieveSingle(ids, fields)
  }

  private async retrieveSingle(id: string, fields?: string[]): Promise<SObject> {
    let url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${this.type}/${id}`
    if (fields?.length) {
      url += `?fields=${fields.join(',')}`
    }
    return this.conn._request<SObject>('GET', url)
  }

  private async retrieveMultiple(ids: string[], fields?: string[]): Promise<SObject[]> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/composite/sobjects/${this.type}`
    const body = { ids, fields: fields || [] }
    return this.conn._request<SObject[]>('POST', url, body)
  }

  /**
   * Update a single record or multiple records
   */
  async update(record: SObject & { Id: string }): Promise<SaveResult>
  async update(records: (SObject & { Id: string })[]): Promise<SaveResult[]>
  async update(records: (SObject & { Id: string }) | (SObject & { Id: string })[]): Promise<SaveResult | SaveResult[]> {
    if (Array.isArray(records)) {
      return this.updateMultiple(records)
    }
    return this.updateSingle(records)
  }

  private async updateSingle(record: SObject & { Id: string }): Promise<SaveResult> {
    const { Id, ...data } = record
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${this.type}/${Id}`
    await this.conn._request<null>('PATCH', url, data)
    return { id: Id, success: true, errors: [] }
  }

  private async updateMultiple(records: (SObject & { Id: string })[]): Promise<SaveResult[]> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/composite/sobjects`
    const body = {
      allOrNone: false,
      records: records.map((r) => ({ attributes: { type: this.type }, ...r })),
    }
    return this.conn._request<SaveResult[]>('PATCH', url, body)
  }

  /**
   * Delete a single record or multiple records
   */
  async destroy(id: string): Promise<SaveResult>
  async destroy(ids: string[]): Promise<SaveResult[]>
  async destroy(ids: string | string[]): Promise<SaveResult | SaveResult[]> {
    if (Array.isArray(ids)) {
      return this.destroyMultiple(ids)
    }
    return this.destroySingle(ids)
  }

  private async destroySingle(id: string): Promise<SaveResult> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${this.type}/${id}`
    await this.conn._request<null>('DELETE', url)
    return { id, success: true, errors: [] }
  }

  private async destroyMultiple(ids: string[]): Promise<SaveResult[]> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/composite/sobjects?ids=${ids.join(',')}`
    return this.conn._request<SaveResult[]>('DELETE', url)
  }

  /**
   * Upsert a single record or multiple records
   */
  async upsert(record: SObject, extIdField: string): Promise<UpsertResult>
  async upsert(records: SObject[], extIdField: string): Promise<UpsertResult[]>
  async upsert(records: SObject | SObject[], extIdField: string): Promise<UpsertResult | UpsertResult[]> {
    if (Array.isArray(records)) {
      return this.upsertMultiple(records, extIdField)
    }
    return this.upsertSingle(records, extIdField)
  }

  private async upsertSingle(record: SObject, extIdField: string): Promise<UpsertResult> {
    const extIdValue = record[extIdField] as string
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${this.type}/${extIdField}/${extIdValue}`
    return this.conn._request<UpsertResult>('PATCH', url, record)
  }

  private async upsertMultiple(records: SObject[], extIdField: string): Promise<UpsertResult[]> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/composite/sobjects/${this.type}/${extIdField}`
    const body = {
      allOrNone: false,
      records: records.map((r) => ({ attributes: { type: this.type }, ...r })),
    }
    return this.conn._request<UpsertResult[]>('PATCH', url, body)
  }

  /**
   * Describe this SObject
   */
  async describe(options: DescribeOptions = {}): Promise<DescribeSObjectResult> {
    if (this.describeCache && !options.refresh) {
      return this.describeCache
    }

    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/sobjects/${this.type}/describe`
    this.describeCache = await this.conn._request<DescribeSObjectResult>('GET', url)
    return this.describeCache
  }

  /**
   * Start a query builder
   */
  find(conditions?: WhereConditions): QueryBuilder {
    const builder = new QueryBuilder(this.conn, this.type)
    if (conditions) {
      builder.where(conditions)
    }
    return builder
  }
}

// =============================================================================
// Query Builder Class
// =============================================================================

/**
 * Query builder for SOQL queries
 */
export class QueryBuilder {
  private conn: Connection
  private sobjectType: string
  private _fields: string[] = ['Id']
  private _conditions: WhereConditions = {}
  private _orderBy: { field: string; direction: OrderDirection }[] = []
  private _limit?: number
  private _offset?: number

  constructor(conn: Connection, sobjectType: string) {
    this.conn = conn
    this.sobjectType = sobjectType
  }

  /**
   * Select specific fields
   */
  select(fields: string | string[]): this {
    this._fields = Array.isArray(fields) ? fields : [fields]
    return this
  }

  /**
   * Add where conditions
   */
  where(conditions: WhereConditions): this {
    this._conditions = { ...this._conditions, ...conditions }
    return this
  }

  /**
   * Order results
   */
  orderBy(field: string, direction: OrderDirection = 'ASC'): this {
    this._orderBy.push({ field, direction })
    return this
  }

  /**
   * Limit results
   */
  limit(count: number): this {
    this._limit = count
    return this
  }

  /**
   * Offset results
   */
  offset(count: number): this {
    this._offset = count
    return this
  }

  /**
   * Build the SOQL query string
   */
  toSOQL(): string {
    let query = `SELECT ${this._fields.join(', ')} FROM ${this.sobjectType}`

    // WHERE clause
    const conditions = Object.entries(this._conditions)
    if (conditions.length > 0) {
      const whereParts = conditions.map(([field, value]) => {
        if (value === null) {
          return `${field} = null`
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle operators
          const ops = Object.entries(value)
          return ops
            .map(([op, val]) => {
              switch (op) {
                case '$eq':
                  return `${field} = ${this.formatValue(val)}`
                case '$ne':
                  return `${field} != ${this.formatValue(val)}`
                case '$lt':
                  return `${field} < ${this.formatValue(val)}`
                case '$lte':
                  return `${field} <= ${this.formatValue(val)}`
                case '$gt':
                  return `${field} > ${this.formatValue(val)}`
                case '$gte':
                  return `${field} >= ${this.formatValue(val)}`
                case '$like':
                  return `${field} LIKE ${this.formatValue(val)}`
                case '$in':
                  return `${field} IN (${(val as unknown[]).map((v) => this.formatValue(v)).join(', ')})`
                case '$nin':
                  return `${field} NOT IN (${(val as unknown[]).map((v) => this.formatValue(v)).join(', ')})`
                case '$includes':
                  return `${field} INCLUDES (${(val as string[]).map((v) => this.formatValue(v)).join(', ')})`
                case '$excludes':
                  return `${field} EXCLUDES (${(val as string[]).map((v) => this.formatValue(v)).join(', ')})`
                default:
                  return `${field} = ${this.formatValue(val)}`
              }
            })
            .join(' AND ')
        }
        if (Array.isArray(value)) {
          return `${field} IN (${value.map((v) => this.formatValue(v)).join(', ')})`
        }
        return `${field} = ${this.formatValue(value)}`
      })
      query += ` WHERE ${whereParts.join(' AND ')}`
    }

    // ORDER BY clause
    if (this._orderBy.length > 0) {
      const orderParts = this._orderBy.map((o) => `${o.field} ${o.direction.toUpperCase()}`)
      query += ` ORDER BY ${orderParts.join(', ')}`
    }

    // LIMIT clause
    if (this._limit !== undefined) {
      query += ` LIMIT ${this._limit}`
    }

    // OFFSET clause
    if (this._offset !== undefined) {
      query += ` OFFSET ${this._offset}`
    }

    return query
  }

  private formatValue(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
    if (typeof value === 'boolean') return value.toString()
    if (value instanceof Date) return value.toISOString()
    return String(value)
  }

  /**
   * Execute the query
   */
  async execute<T = SObject>(): Promise<QueryResult<T>> {
    return this.conn.query<T>(this.toSOQL())
  }
}

// =============================================================================
// Bulk API Classes
// =============================================================================

/**
 * Bulk batch with event emitter
 */
class BulkBatchImpl extends EventEmitter implements BulkBatch {
  private conn: Connection
  private job: BulkJobImpl
  private records: SObject[] = []
  private _queued = false

  constructor(conn: Connection, job: BulkJobImpl) {
    super()
    this.conn = conn
    this.job = job
  }

  /**
   * Execute the batch with records
   */
  execute(records: SObject[] | string): void {
    if (typeof records === 'string') {
      // CSV string - parse it
      this.records = this.parseCSV(records)
    } else {
      this.records = records
    }

    // Upload asynchronously
    this.uploadRecords().catch((error) => {
      this.emit('error', error)
    })
  }

  private parseCSV(csv: string): SObject[] {
    const lines = csv.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/"/g, ''))
      const record: SObject = {}
      headers.forEach((header, i) => {
        record[header] = values[i]
      })
      return record
    })
  }

  private async uploadRecords(): Promise<void> {
    try {
      // Create the job first
      const jobInfo = await this.job.open()

      // Upload data
      const csv = this.toCSV(this.records)
      const uploadUrl = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/ingest/${jobInfo.id}/batches`
      await this.conn._request<null>('PUT', uploadUrl, csv, {
        'Content-Type': 'text/csv',
      })

      // Close the job to start processing
      await this.job.close()

      this._queued = true
      this.emit('queue')
    } catch (error) {
      this.emit('error', error as Error)
    }
  }

  private toCSV(records: SObject[]): string {
    if (records.length === 0) return ''

    const headers = Object.keys(records[0]).filter((k) => k !== 'attributes')
    const lines = [headers.join(',')]

    for (const record of records) {
      const values = headers.map((h) => {
        const val = record[h]
        if (val === null || val === undefined) return ''
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`
        }
        return String(val)
      })
      lines.push(values.join(','))
    }

    return lines.join('\n')
  }

  /**
   * Poll for results
   */
  async poll(): Promise<BulkResult[]> {
    const jobInfo = await this.job.check()

    if (jobInfo.state === 'JobComplete') {
      const resultsUrl = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/ingest/${this.job.id}/successfulResults`
      const results = await this.conn._request<string>('GET', resultsUrl, undefined, {
        Accept: 'text/csv',
      })

      // Parse CSV results
      const parsedResults = this.parseResultsCSV(results)
      this.emit('response', parsedResults)
      return parsedResults
    }

    if (jobInfo.state === 'Failed' || jobInfo.state === 'Aborted') {
      const error = new SalesforceError(
        { errorCode: 'JOB_FAILED', message: jobInfo.errorMessage || 'Bulk job failed' },
        400
      )
      this.emit('error', error)
      throw error
    }

    // Still processing - wait and poll again
    await sleep(2000)
    return this.poll()
  }

  private parseResultsCSV(csv: string): BulkResult[] {
    const lines = csv.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
    const idIndex = headers.indexOf('sf__Id')
    const createdIndex = headers.indexOf('sf__Created')

    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/"/g, ''))
      return {
        id: idIndex >= 0 ? values[idIndex] : undefined,
        success: true,
        created: createdIndex >= 0 ? values[createdIndex] === 'true' : undefined,
        errors: [],
      }
    })
  }
}

/**
 * Bulk job implementation
 */
class BulkJobImpl implements BulkJob {
  private conn: Connection
  id?: string
  object: string
  operation: BulkOperation
  options?: BulkJobOptions
  private _state: string = 'Open'

  constructor(conn: Connection, object: string, operation: BulkOperation, options?: BulkJobOptions) {
    this.conn = conn
    this.object = object
    this.operation = operation
    this.options = options
  }

  /**
   * Open the job (create it on Salesforce)
   */
  async open(): Promise<BulkJobInfo> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/ingest`
    const body: Record<string, unknown> = {
      object: this.object,
      operation: this.operation,
      contentType: 'CSV',
      lineEnding: this.options?.lineEnding || 'LF',
    }

    if (this.options?.externalIdFieldName) {
      body.externalIdFieldName = this.options.externalIdFieldName
    }

    const result = await this.conn._request<BulkJobInfo>('POST', url, body)
    this.id = result.id
    this._state = result.state
    return result
  }

  /**
   * Create a new batch for this job
   */
  createBatch(): BulkBatch {
    return new BulkBatchImpl(this.conn, this)
  }

  /**
   * Close the job (start processing)
   */
  async close(): Promise<BulkJobInfo> {
    if (!this.id) {
      throw new SalesforceError({ errorCode: 'JOB_NOT_OPENED', message: 'Job has not been opened' }, 400)
    }

    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/ingest/${this.id}`
    const result = await this.conn._request<BulkJobInfo>('PATCH', url, { state: 'UploadComplete' })
    this._state = result.state
    return result
  }

  /**
   * Abort the job
   */
  async abort(): Promise<BulkJobInfo> {
    if (!this.id) {
      throw new SalesforceError({ errorCode: 'JOB_NOT_OPENED', message: 'Job has not been opened' }, 400)
    }

    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/ingest/${this.id}`
    const result = await this.conn._request<BulkJobInfo>('PATCH', url, { state: 'Aborted' })
    this._state = result.state
    return result
  }

  /**
   * Check job status
   */
  async check(): Promise<BulkJobInfo> {
    if (!this.id) {
      throw new SalesforceError({ errorCode: 'JOB_NOT_OPENED', message: 'Job has not been opened' }, 400)
    }

    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/ingest/${this.id}`
    const result = await this.conn._request<BulkJobInfo>('GET', url)
    this._state = result.state
    return result
  }
}

/**
 * Bulk query job implementation
 */
class BulkQueryJobImpl implements BulkQueryJob {
  private conn: Connection
  id: string
  operation: 'query' | 'queryAll'
  state: string

  constructor(conn: Connection, id: string, operation: 'query' | 'queryAll', state: string) {
    this.conn = conn
    this.id = id
    this.operation = operation
    this.state = state
  }

  /**
   * Poll for query results
   */
  async poll(): Promise<SObject[]> {
    // Check status
    const statusUrl = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/query/${this.id}`
    const status = await this.conn._request<BulkJobInfo>('GET', statusUrl)
    this.state = status.state

    if (status.state === 'JobComplete') {
      return this.result()
    }

    if (status.state === 'Failed' || status.state === 'Aborted') {
      throw new SalesforceError(
        { errorCode: 'QUERY_JOB_FAILED', message: status.errorMessage || 'Query job failed' },
        400
      )
    }

    // Still processing
    await sleep(2000)
    return this.poll()
  }

  /**
   * Get query results
   */
  async result(): Promise<SObject[]> {
    const resultsUrl = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/query/${this.id}/results`
    const csv = await this.conn._request<string>('GET', resultsUrl, undefined, {
      Accept: 'text/csv',
    })

    return this.parseCSV(csv)
  }

  private parseCSV(csv: string): SObject[] {
    const lines = csv.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/"/g, ''))
      const record: SObject = {}
      headers.forEach((header, i) => {
        record[header] = values[i]
      })
      return record
    })
  }
}

/**
 * Bulk API handler
 */
export class Bulk {
  private conn: Connection

  constructor(conn: Connection) {
    this.conn = conn
  }

  /**
   * Create a bulk job
   */
  createJob(object: string, operation: BulkOperation, options?: BulkJobOptions): BulkJob {
    return new BulkJobImpl(this.conn, object, operation, options)
  }

  /**
   * Create a bulk query job
   */
  async query(soql: string): Promise<BulkQueryJob> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/query`
    const result = await this.conn._request<BulkJobInfo>('POST', url, {
      operation: 'query',
      query: soql,
    })

    return new BulkQueryJobImpl(this.conn, result.id, 'query', result.state)
  }

  /**
   * Create a bulk queryAll job (includes deleted/archived)
   */
  async queryAll(soql: string): Promise<BulkQueryJob> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/jobs/query`
    const result = await this.conn._request<BulkJobInfo>('POST', url, {
      operation: 'queryAll',
      query: soql,
    })

    return new BulkQueryJobImpl(this.conn, result.id, 'queryAll', result.state)
  }
}

// =============================================================================
// Analytics Classes
// =============================================================================

/**
 * Report reference implementation
 */
class ReportRef implements Report {
  private conn: Connection
  id: string
  name?: string

  constructor(conn: Connection, id: string) {
    this.conn = conn
    this.id = id
  }

  /**
   * Execute the report synchronously
   */
  async execute(options?: ReportExecuteOptions): Promise<ReportResult> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/analytics/reports/${this.id}`

    const body: Record<string, unknown> = {}
    if (options?.details !== undefined || options?.includeDetails !== undefined) {
      body.includeDetails = options.details ?? options.includeDetails
    }
    if (options?.reportFilters) {
      body.reportFilters = options.reportFilters
    }
    if (options?.reportBooleanFilter) {
      body.reportBooleanFilter = options.reportBooleanFilter
    }

    return this.conn._request<ReportResult>('POST', url, body)
  }

  /**
   * Execute the report asynchronously
   */
  async executeAsync(): Promise<ReportInstance> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/analytics/reports/${this.id}/instances`
    return this.conn._request<ReportInstance>('POST', url, {})
  }

  /**
   * Get report metadata
   */
  async describe(): Promise<ReportMetadata> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/analytics/reports/${this.id}/describe`
    return this.conn._request<ReportMetadata>('GET', url)
  }
}

/**
 * Analytics API handler
 */
export class Analytics {
  private conn: Connection

  constructor(conn: Connection) {
    this.conn = conn
  }

  /**
   * Get a report by ID
   */
  async report(id: string): Promise<Report> {
    // Verify the report exists
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/analytics/reports/${id}`
    await this.conn._request<unknown>('GET', url)
    return new ReportRef(this.conn, id)
  }

  /**
   * List all dashboards
   */
  async dashboards(): Promise<DashboardListResult> {
    const url = `${this.conn.instanceUrl}/services/data/v${this.conn.version}/analytics/dashboards`
    return this.conn._request<DashboardListResult>('GET', url)
  }
}

// =============================================================================
// Metadata API Class
// =============================================================================

/**
 * Metadata API handler
 */
export class Metadata {
  private conn: Connection

  constructor(conn: Connection) {
    this.conn = conn
  }

  /**
   * Read metadata for a component
   */
  async read(type: MetadataType, fullName: string): Promise<MetadataReadResult>
  async read(type: MetadataType, fullNames: string[]): Promise<MetadataReadResult[]>
  async read(type: MetadataType, fullNames: string | string[]): Promise<MetadataReadResult | MetadataReadResult[]> {
    // Note: The Metadata API uses SOAP, but for simplicity we'll use a REST-like approach
    // In a real implementation, you'd need to construct SOAP envelopes
    const url = `${this.conn.instanceUrl}/services/Soap/m/${this.conn.version}`
    const names = Array.isArray(fullNames) ? fullNames : [fullNames]

    const result = await this.conn._request<{ result: MetadataReadResult[] }>('POST', url, {
      type,
      fullNames: names,
    })

    return Array.isArray(fullNames) ? result.result : result.result[0]
  }

  /**
   * List metadata components of specified types
   */
  async list(queries: MetadataListQuery[]): Promise<MetadataComponent[]> {
    const url = `${this.conn.instanceUrl}/services/Soap/m/${this.conn.version}`
    const result = await this.conn._request<{ result: MetadataComponent[] }>('POST', url, {
      queries,
    })
    return result.result
  }
}

// =============================================================================
// Main Connection Class
// =============================================================================

/**
 * Salesforce Connection for API interactions
 */
export class Connection {
  loginUrl: string
  instanceUrl: string | null = null
  accessToken: string | null = null
  refreshToken: string | null = null
  version: string
  oauth2: OAuth2
  bulk: Bulk
  analytics: Analytics
  metadata: Metadata

  private _fetch: typeof fetch
  private timeout: number
  private maxNetworkRetries: number
  private describeGlobalCache?: DescribeGlobalResult

  constructor(config: ConnectionConfig = {}) {
    this.loginUrl = config.loginUrl || DEFAULT_LOGIN_URL
    this.instanceUrl = config.instanceUrl || null
    this.accessToken = config.accessToken || null
    this.refreshToken = config.refreshToken || null
    this.version = config.version || DEFAULT_API_VERSION
    this.timeout = config.timeout || DEFAULT_TIMEOUT
    this.maxNetworkRetries = config.maxNetworkRetries || 0
    this._fetch = config.fetch || globalThis.fetch.bind(globalThis)

    // Initialize sub-modules
    this.oauth2 = new OAuth2(this, config.oauth2 || { clientId: '' })
    this.bulk = new Bulk(this)
    this.analytics = new Analytics(this)
    this.metadata = new Metadata(this)
  }

  /**
   * Login with username and password
   */
  async login(username: string, password: string): Promise<UserInfo> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: 'dotdo-salesforce-compat',
      username,
      password,
    })

    const response = await this._fetch(`${this.loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new SalesforceError(data as OAuthError, response.status)
    }

    const tokenResponse = data as TokenResponse
    this.accessToken = tokenResponse.access_token
    this.instanceUrl = tokenResponse.instance_url

    // Parse user ID from the id URL
    const idParts = tokenResponse.id.split('/')
    const userId = idParts[idParts.length - 1]
    const orgId = idParts[idParts.length - 2]

    return {
      id: userId,
      organizationId: orgId,
      url: tokenResponse.id,
    }
  }

  /**
   * Logout and revoke the access token
   */
  async logout(): Promise<void> {
    if (this.accessToken) {
      const params = new URLSearchParams({ token: this.accessToken })
      await this._fetch(`${this.instanceUrl || this.loginUrl}/services/oauth2/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })
    }

    this.accessToken = null
    this.refreshToken = null
  }

  /**
   * Authorize using various OAuth flows
   */
  async authorize(params: AuthorizeParams): Promise<TokenResponse> {
    const body = new URLSearchParams()

    if (params.grant_type) {
      body.set('grant_type', params.grant_type)
    } else if (params.code) {
      body.set('grant_type', 'authorization_code')
      body.set('code', params.code)
    }

    if (params.assertion) {
      body.set('assertion', params.assertion)
    }
    if (params.code) {
      body.set('code', params.code)
    }
    if (params.refresh_token) {
      body.set('refresh_token', params.refresh_token)
    }

    // Add OAuth2 credentials if available
    if (this.oauth2['config'].clientId) {
      body.set('client_id', this.oauth2['config'].clientId)
    }
    if (this.oauth2['config'].clientSecret) {
      body.set('client_secret', this.oauth2['config'].clientSecret)
    }
    if (this.oauth2['config'].redirectUri) {
      body.set('redirect_uri', this.oauth2['config'].redirectUri)
    }

    const response = await this._fetch(`${this.loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new SalesforceError(data as OAuthError, response.status)
    }

    const tokenResponse = data as TokenResponse
    this.accessToken = tokenResponse.access_token
    if (tokenResponse.refresh_token) {
      this.refreshToken = tokenResponse.refresh_token
    }
    this.instanceUrl = tokenResponse.instance_url

    return tokenResponse
  }

  /**
   * Get user identity information
   */
  async identity(): Promise<Identity> {
    const url = `${this.instanceUrl}/services/oauth2/userinfo`
    const data = await this._request<Record<string, unknown>>('GET', url)

    return {
      id: data.sub as string,
      user_id: data.sub as string,
      organization_id: data.organization_id as string,
      username: data.preferred_username as string,
      display_name: data.name as string,
      email: data.email as string,
      first_name: data.given_name as string | undefined,
      last_name: data.family_name as string | undefined,
    }
  }

  /**
   * Get an SObject resource for CRUD operations
   */
  sobject(type: string): SObjectResource {
    return new SObjectResource(this, type)
  }

  /**
   * Execute a SOQL query
   */
  async query<T = SObject>(soql: string): Promise<QueryResult<T>> {
    const url = `${this.instanceUrl}/services/data/v${this.version}/query`
    const params = new URLSearchParams({ q: soql })
    return this._request<QueryResult<T>>('GET', `${url}?${params.toString()}`)
  }

  /**
   * Execute a SOQL query including deleted/archived records
   */
  async queryAll<T = SObject>(soql: string): Promise<QueryResult<T>> {
    const url = `${this.instanceUrl}/services/data/v${this.version}/queryAll`
    const params = new URLSearchParams({ q: soql })
    return this._request<QueryResult<T>>('GET', `${url}?${params.toString()}`)
  }

  /**
   * Fetch more records from a query
   */
  async queryMore<T = SObject>(nextRecordsUrl: string): Promise<QueryResult<T>> {
    const url = nextRecordsUrl.startsWith('http') ? nextRecordsUrl : `${this.instanceUrl}${nextRecordsUrl}`
    return this._request<QueryResult<T>>('GET', url)
  }

  /**
   * Describe all SObjects
   */
  async describeGlobal(): Promise<DescribeGlobalResult> {
    if (this.describeGlobalCache) {
      return this.describeGlobalCache
    }

    const url = `${this.instanceUrl}/services/data/v${this.version}/sobjects`
    this.describeGlobalCache = await this._request<DescribeGlobalResult>('GET', url)
    return this.describeGlobalCache
  }

  /**
   * Get organization limits
   */
  async limits(): Promise<Limits> {
    const url = `${this.instanceUrl}/services/data/v${this.version}/limits`
    return this._request<Limits>('GET', url)
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      ...headers,
    }

    // Set content type for requests with body
    if (body !== undefined && !headers?.['Content-Type']) {
      if (typeof body === 'string') {
        requestHeaders['Content-Type'] = 'text/csv'
      } else {
        requestHeaders['Content-Type'] = 'application/json'
      }
    }

    const requestBody = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxNetworkRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        try {
          const response = await this._fetch(url, {
            method,
            headers: requestHeaders,
            body: requestBody,
            signal: controller.signal,
          })

          // Handle no content responses
          if (response.status === 204) {
            return null as T
          }

          const contentType = response.headers.get('content-type') || ''

          // Handle CSV responses
          if (contentType.includes('text/csv') || headers?.Accept === 'text/csv') {
            const text = await response.text()
            if (!response.ok) {
              throw new SalesforceError(
                { errorCode: 'API_ERROR', message: text },
                response.status
              )
            }
            return text as T
          }

          const data = await response.json()

          if (!response.ok) {
            const errorData = Array.isArray(data) ? data[0] : data
            throw new SalesforceError(errorData as SalesforceErrorData, response.status)
          }

          return data as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors
        if (error instanceof SalesforceError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error
        }

        // Retry with exponential backoff
        if (attempt < this.maxNetworkRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Default Export
// =============================================================================

export default { Connection }
