/**
 * @dotdo/salesforce - Local In-Memory Implementation
 *
 * Local Salesforce implementation for testing and edge deployment.
 * Uses in-memory storage to simulate Salesforce API without a live connection.
 *
 * @example
 * ```typescript
 * import { SalesforceLocal } from '@dotdo/salesforce/local'
 *
 * const sf = new SalesforceLocal()
 *
 * // Create records
 * const result = await sf.sobject('Account').create({
 *   Name: 'Acme Inc',
 *   Industry: 'Technology',
 * })
 *
 * // Query records
 * const accounts = await sf.query("SELECT Id, Name FROM Account WHERE Industry = 'Technology'")
 * ```
 *
 * @module @dotdo/salesforce/local
 */

import type {
  SObject,
  SaveResult,
  UpsertResult,
  QueryResult,
  DescribeGlobalResult,
  DescribeSObjectResult,
  DescribeGlobalSObject,
  DescribeField,
  WhereConditions,
  OrderDirection,
  Limits,
  LimitInfo,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_VERSION = '59.0'
const DEFAULT_INSTANCE_URL = 'https://local.salesforce.dotdo.dev'

/**
 * Standard Salesforce object prefixes
 */
const OBJECT_PREFIXES: Record<string, string> = {
  Account: '001',
  Contact: '003',
  Lead: '00Q',
  Opportunity: '006',
  Case: '500',
  Task: '00T',
  Event: '00U',
  User: '005',
  Group: '00G',
  Campaign: '701',
  Contract: '800',
  Product2: '01t',
  Asset: '02i',
  Order: '801',
  Quote: '0Q0',
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for local Salesforce implementation
 */
export interface SalesforceLocalConfig {
  /** Instance URL (default: https://local.salesforce.dotdo.dev) */
  instanceUrl?: string
  /** API version (default: 59.0) */
  version?: string
  /** Initial data to seed */
  initialData?: Record<string, SObject[]>
  /** Storage backend (in-memory by default) */
  storage?: SalesforceLocalStorage
}

/**
 * Storage backend interface
 */
export interface SalesforceLocalStorage {
  get(objectType: string): Map<string, SObject>
  set(objectType: string, records: Map<string, SObject>): void
  clear(): void
}

// =============================================================================
// In-Memory Storage
// =============================================================================

/**
 * Default in-memory storage implementation
 */
class InMemoryStorage implements SalesforceLocalStorage {
  private data: Map<string, Map<string, SObject>> = new Map()

  get(objectType: string): Map<string, SObject> {
    if (!this.data.has(objectType)) {
      this.data.set(objectType, new Map())
    }
    return this.data.get(objectType)!
  }

  set(objectType: string, records: Map<string, SObject>): void {
    this.data.set(objectType, records)
  }

  clear(): void {
    this.data.clear()
  }
}

// =============================================================================
// ID Generator
// =============================================================================

/**
 * Generate Salesforce-style 18-character IDs
 */
class IdGenerator {
  private counters: Map<string, number> = new Map()

  generate(objectType: string): string {
    const prefix = OBJECT_PREFIXES[objectType] || this.getCustomPrefix(objectType)
    const counter = (this.counters.get(prefix) || 0) + 1
    this.counters.set(prefix, counter)

    // Generate a 15-character base ID, then convert to 18
    const base = prefix + this.padNumber(counter, 12)
    return this.to18Char(base)
  }

  private getCustomPrefix(objectType: string): string {
    // Custom objects get 'a0' prefix + 1 char based on name hash
    const hash = this.simpleHash(objectType)
    return 'a0' + String.fromCharCode(65 + (hash % 26))
  }

  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  private padNumber(num: number, length: number): string {
    // Convert to base-62 for more compact representation
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let result = ''
    let n = num

    while (result.length < length) {
      result = chars[n % chars.length] + result
      n = Math.floor(n / chars.length)
    }

    return result.substring(0, length)
  }

  private to18Char(id15: string): string {
    // Salesforce 18-char IDs have 3 checksum characters
    const chunks = [id15.substring(0, 5), id15.substring(5, 10), id15.substring(10, 15)]
    let checksum = ''

    for (const chunk of chunks) {
      let sum = 0
      for (let i = 0; i < 5; i++) {
        const char = chunk[i]
        if (char >= 'A' && char <= 'Z') {
          sum += 1 << i
        }
      }
      checksum += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[sum]
    }

    return id15 + checksum
  }
}

// =============================================================================
// SOQL Parser (Simple)
// =============================================================================

interface ParsedQuery {
  fields: string[]
  objectType: string
  conditions: WhereConditions
  orderBy?: { field: string; direction: OrderDirection }[]
  limit?: number
  offset?: number
}

/**
 * Simple SOQL parser for basic queries
 */
function parseSOQL(soql: string): ParsedQuery {
  const result: ParsedQuery = {
    fields: [],
    objectType: '',
    conditions: {},
  }

  // Normalize whitespace
  const normalized = soql.replace(/\s+/g, ' ').trim()

  // Extract SELECT fields
  const selectMatch = normalized.match(/SELECT\s+(.+?)\s+FROM/i)
  if (selectMatch) {
    result.fields = selectMatch[1].split(',').map((f) => f.trim())
  }

  // Extract FROM object
  const fromMatch = normalized.match(/FROM\s+(\w+)/i)
  if (fromMatch) {
    result.objectType = fromMatch[1]
  }

  // Extract WHERE clause
  const whereMatch = normalized.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+OFFSET|$)/i)
  if (whereMatch) {
    result.conditions = parseWhereClause(whereMatch[1])
  }

  // Extract ORDER BY
  const orderMatch = normalized.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|$)/i)
  if (orderMatch) {
    result.orderBy = parseOrderBy(orderMatch[1])
  }

  // Extract LIMIT
  const limitMatch = normalized.match(/LIMIT\s+(\d+)/i)
  if (limitMatch) {
    result.limit = parseInt(limitMatch[1], 10)
  }

  // Extract OFFSET
  const offsetMatch = normalized.match(/OFFSET\s+(\d+)/i)
  if (offsetMatch) {
    result.offset = parseInt(offsetMatch[1], 10)
  }

  return result
}

function parseWhereClause(clause: string): WhereConditions {
  const conditions: WhereConditions = {}

  // Simple parsing - handles basic "field = 'value'" and "field = value"
  const parts = clause.split(/\s+AND\s+/i)

  for (const part of parts) {
    const match = part.trim().match(/^(\w+)\s*(=|!=|<|<=|>|>=|LIKE|IN)\s*(.+)$/i)
    if (match) {
      const [, field, operator, valueStr] = match
      const value = parseValue(valueStr.trim())

      switch (operator.toUpperCase()) {
        case '=':
          conditions[field] = value
          break
        case '!=':
          conditions[field] = { $ne: value }
          break
        case '<':
          conditions[field] = { $lt: value }
          break
        case '<=':
          conditions[field] = { $lte: value }
          break
        case '>':
          conditions[field] = { $gt: value }
          break
        case '>=':
          conditions[field] = { $gte: value }
          break
        case 'LIKE':
          conditions[field] = { $like: value as string }
          break
        case 'IN':
          conditions[field] = { $in: parseInList(valueStr) }
          break
      }
    }
  }

  return conditions
}

function parseValue(valueStr: string): string | number | boolean | null {
  // Remove surrounding quotes
  if ((valueStr.startsWith("'") && valueStr.endsWith("'")) || (valueStr.startsWith('"') && valueStr.endsWith('"'))) {
    return valueStr.slice(1, -1)
  }

  if (valueStr.toLowerCase() === 'null') return null
  if (valueStr.toLowerCase() === 'true') return true
  if (valueStr.toLowerCase() === 'false') return false
  if (/^\d+$/.test(valueStr)) return parseInt(valueStr, 10)
  if (/^\d+\.\d+$/.test(valueStr)) return parseFloat(valueStr)

  return valueStr
}

function parseInList(valueStr: string): (string | number)[] {
  const match = valueStr.match(/\((.+)\)/)
  if (!match) return []

  return match[1].split(',').map((v) => {
    const trimmed = v.trim()
    return parseValue(trimmed) as string | number
  })
}

function parseOrderBy(clause: string): { field: string; direction: OrderDirection }[] {
  return clause.split(',').map((part) => {
    const match = part.trim().match(/^(\w+)(?:\s+(ASC|DESC))?$/i)
    if (match) {
      return {
        field: match[1],
        direction: (match[2]?.toUpperCase() || 'ASC') as OrderDirection,
      }
    }
    return { field: part.trim(), direction: 'ASC' as OrderDirection }
  })
}

// =============================================================================
// Local SObject Resource
// =============================================================================

/**
 * Local SObject resource for CRUD operations
 */
export class LocalSObjectResource {
  private sf: SalesforceLocal
  private type: string

  constructor(sf: SalesforceLocal, type: string) {
    this.sf = sf
    this.type = type
  }

  /**
   * Create a single record or multiple records
   */
  async create(record: SObject): Promise<SaveResult>
  async create(records: SObject[]): Promise<SaveResult[]>
  async create(records: SObject | SObject[]): Promise<SaveResult | SaveResult[]> {
    if (Array.isArray(records)) {
      return Promise.all(records.map((r) => this.createSingle(r)))
    }
    return this.createSingle(records)
  }

  private async createSingle(record: SObject): Promise<SaveResult> {
    const id = this.sf['idGenerator'].generate(this.type)
    const storedRecord: SObject = {
      ...record,
      Id: id,
      attributes: {
        type: this.type,
        url: `/services/data/v${this.sf.version}/sobjects/${this.type}/${id}`,
      },
      CreatedDate: new Date().toISOString(),
      LastModifiedDate: new Date().toISOString(),
    }

    const records = this.sf['storage'].get(this.type)
    records.set(id, storedRecord)

    return { id, success: true, errors: [] }
  }

  /**
   * Retrieve a single record or multiple records by ID
   */
  async retrieve(id: string, fields?: string[]): Promise<SObject>
  async retrieve(ids: string[], fields?: string[]): Promise<SObject[]>
  async retrieve(ids: string | string[], fields?: string[]): Promise<SObject | SObject[]> {
    if (Array.isArray(ids)) {
      return Promise.all(ids.map((id) => this.retrieveSingle(id, fields)))
    }
    return this.retrieveSingle(ids, fields)
  }

  private async retrieveSingle(id: string, fields?: string[]): Promise<SObject> {
    const records = this.sf['storage'].get(this.type)
    const record = records.get(id)

    if (!record) {
      throw new Error(`Record not found: ${this.type}/${id}`)
    }

    if (fields?.length) {
      const filtered: SObject = { Id: record.Id, attributes: record.attributes }
      for (const field of fields) {
        if (field in record) {
          filtered[field] = record[field]
        }
      }
      return filtered
    }

    return { ...record }
  }

  /**
   * Update a single record or multiple records
   */
  async update(record: SObject & { Id: string }): Promise<SaveResult>
  async update(records: (SObject & { Id: string })[]): Promise<SaveResult[]>
  async update(records: (SObject & { Id: string }) | (SObject & { Id: string })[]): Promise<SaveResult | SaveResult[]> {
    if (Array.isArray(records)) {
      return Promise.all(records.map((r) => this.updateSingle(r)))
    }
    return this.updateSingle(records)
  }

  private async updateSingle(record: SObject & { Id: string }): Promise<SaveResult> {
    const records = this.sf['storage'].get(this.type)
    const existing = records.get(record.Id)

    if (!existing) {
      return { id: record.Id, success: false, errors: [{ errorCode: 'NOT_FOUND', message: 'Record not found' }] }
    }

    const updated: SObject = {
      ...existing,
      ...record,
      LastModifiedDate: new Date().toISOString(),
    }
    records.set(record.Id, updated)

    return { id: record.Id, success: true, errors: [] }
  }

  /**
   * Delete a single record or multiple records
   */
  async destroy(id: string): Promise<SaveResult>
  async destroy(ids: string[]): Promise<SaveResult[]>
  async destroy(ids: string | string[]): Promise<SaveResult | SaveResult[]> {
    if (Array.isArray(ids)) {
      return Promise.all(ids.map((id) => this.destroySingle(id)))
    }
    return this.destroySingle(ids)
  }

  private async destroySingle(id: string): Promise<SaveResult> {
    const records = this.sf['storage'].get(this.type)
    const deleted = records.delete(id)

    return { id, success: deleted, errors: deleted ? [] : [{ errorCode: 'NOT_FOUND', message: 'Record not found' }] }
  }

  /**
   * Upsert a single record or multiple records
   */
  async upsert(record: SObject, extIdField: string): Promise<UpsertResult>
  async upsert(records: SObject[], extIdField: string): Promise<UpsertResult[]>
  async upsert(records: SObject | SObject[], extIdField: string): Promise<UpsertResult | UpsertResult[]> {
    if (Array.isArray(records)) {
      return Promise.all(records.map((r) => this.upsertSingle(r, extIdField)))
    }
    return this.upsertSingle(records, extIdField)
  }

  private async upsertSingle(record: SObject, extIdField: string): Promise<UpsertResult> {
    const extIdValue = record[extIdField] as string
    const allRecords = this.sf['storage'].get(this.type)

    // Find existing record with matching external ID
    let existingId: string | null = null
    for (const [id, r] of allRecords) {
      if (r[extIdField] === extIdValue) {
        existingId = id
        break
      }
    }

    if (existingId) {
      // Update existing
      const existing = allRecords.get(existingId)!
      const updated: SObject = {
        ...existing,
        ...record,
        LastModifiedDate: new Date().toISOString(),
      }
      allRecords.set(existingId, updated)
      return { id: existingId, success: true, created: false, errors: [] }
    }

    // Create new
    const createResult = await this.createSingle(record)
    return { ...createResult, created: true }
  }

  /**
   * Describe this SObject
   */
  async describe(): Promise<DescribeSObjectResult> {
    return {
      name: this.type,
      label: this.type,
      labelPlural: this.type + 's',
      keyPrefix: OBJECT_PREFIXES[this.type] || 'a0',
      queryable: true,
      createable: true,
      updateable: true,
      deletable: true,
      custom: this.type.endsWith('__c'),
      fields: this.getStandardFields(),
      recordTypeInfos: [],
      childRelationships: [],
    }
  }

  private getStandardFields(): DescribeField[] {
    return [
      { name: 'Id', type: 'id', label: 'Record ID', length: 18 },
      { name: 'Name', type: 'string', label: 'Name', length: 255 },
      { name: 'CreatedDate', type: 'datetime', label: 'Created Date' },
      { name: 'LastModifiedDate', type: 'datetime', label: 'Last Modified Date' },
      { name: 'CreatedById', type: 'reference', label: 'Created By ID', length: 18 },
      { name: 'LastModifiedById', type: 'reference', label: 'Last Modified By ID', length: 18 },
    ]
  }

  /**
   * Start a query builder
   */
  find(conditions?: WhereConditions): LocalQueryBuilder {
    const builder = new LocalQueryBuilder(this.sf, this.type)
    if (conditions) {
      builder.where(conditions)
    }
    return builder
  }
}

// =============================================================================
// Local Query Builder
// =============================================================================

/**
 * Query builder for local SOQL-like queries
 */
export class LocalQueryBuilder {
  private sf: SalesforceLocal
  private sobjectType: string
  private _fields: string[] = ['Id']
  private _conditions: WhereConditions = {}
  private _orderBy: { field: string; direction: OrderDirection }[] = []
  private _limit?: number
  private _offset?: number

  constructor(sf: SalesforceLocal, sobjectType: string) {
    this.sf = sf
    this.sobjectType = sobjectType
  }

  select(fields: string | string[]): this {
    this._fields = Array.isArray(fields) ? fields : [fields]
    return this
  }

  where(conditions: WhereConditions): this {
    this._conditions = { ...this._conditions, ...conditions }
    return this
  }

  orderBy(field: string, direction: OrderDirection = 'ASC'): this {
    this._orderBy.push({ field, direction })
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  offset(count: number): this {
    this._offset = count
    return this
  }

  async execute<T = SObject>(): Promise<QueryResult<T>> {
    const records = this.sf['storage'].get(this.sobjectType)
    let results = Array.from(records.values())

    // Apply conditions
    results = results.filter((r) => this.matchesConditions(r, this._conditions))

    // Apply ordering
    if (this._orderBy.length > 0) {
      results.sort((a, b) => {
        for (const order of this._orderBy) {
          const aVal = a[order.field] as string | number
          const bVal = b[order.field] as string | number
          const dir = order.direction.toUpperCase() === 'DESC' ? -1 : 1

          if (aVal < bVal) return -1 * dir
          if (aVal > bVal) return 1 * dir
        }
        return 0
      })
    }

    // Apply offset
    if (this._offset !== undefined) {
      results = results.slice(this._offset)
    }

    // Apply limit
    if (this._limit !== undefined) {
      results = results.slice(0, this._limit)
    }

    // totalSize reflects the number of records returned (after offset/limit)
    const totalSize = results.length

    // Select fields
    results = results.map((r) => {
      const filtered: SObject = { attributes: r.attributes }
      for (const field of this._fields) {
        if (field in r) {
          filtered[field] = r[field]
        }
      }
      return filtered
    })

    return {
      totalSize,
      done: true,
      records: results as T[],
    }
  }

  private matchesConditions(record: SObject, conditions: WhereConditions): boolean {
    for (const [field, condition] of Object.entries(conditions)) {
      const value = record[field]

      if (condition === null) {
        if (value !== null && value !== undefined) return false
        continue
      }

      if (typeof condition === 'object' && !Array.isArray(condition)) {
        // Handle operators
        for (const [op, expected] of Object.entries(condition)) {
          switch (op) {
            case '$eq':
              if (value !== expected) return false
              break
            case '$ne':
              if (value === expected) return false
              break
            case '$lt':
              if (!(value < (expected as number))) return false
              break
            case '$lte':
              if (!(value <= (expected as number))) return false
              break
            case '$gt':
              if (!(value > (expected as number))) return false
              break
            case '$gte':
              if (!(value >= (expected as number))) return false
              break
            case '$like':
              const pattern = (expected as string).replace(/%/g, '.*')
              if (!new RegExp(`^${pattern}$`, 'i').test(String(value))) return false
              break
            case '$in':
              if (!(expected as (string | number)[]).includes(value as string | number)) return false
              break
            case '$nin':
              if ((expected as (string | number)[]).includes(value as string | number)) return false
              break
          }
        }
        continue
      }

      if (Array.isArray(condition)) {
        if (!condition.includes(value as string | number)) return false
        continue
      }

      if (value !== condition) return false
    }

    return true
  }
}

// =============================================================================
// Main Local Implementation
// =============================================================================

/**
 * Local Salesforce implementation for testing and edge deployment
 */
export class SalesforceLocal {
  instanceUrl: string
  version: string

  private storage: SalesforceLocalStorage
  private idGenerator: IdGenerator

  constructor(config: SalesforceLocalConfig = {}) {
    this.instanceUrl = config.instanceUrl || DEFAULT_INSTANCE_URL
    this.version = config.version || DEFAULT_VERSION
    this.storage = config.storage || new InMemoryStorage()
    this.idGenerator = new IdGenerator()

    // Seed initial data if provided
    if (config.initialData) {
      for (const [objectType, records] of Object.entries(config.initialData)) {
        const map = this.storage.get(objectType)
        for (const record of records) {
          const id = record.Id || this.idGenerator.generate(objectType)
          map.set(id, { ...record, Id: id })
        }
      }
    }
  }

  /**
   * Get an SObject resource for CRUD operations
   */
  sobject(type: string): LocalSObjectResource {
    return new LocalSObjectResource(this, type)
  }

  /**
   * Execute a SOQL query
   */
  async query<T = SObject>(soql: string): Promise<QueryResult<T>> {
    const parsed = parseSOQL(soql)
    const records = this.storage.get(parsed.objectType)
    let results = Array.from(records.values())

    // Apply conditions
    results = results.filter((r) => this.matchesConditions(r, parsed.conditions))

    // Apply ordering
    if (parsed.orderBy) {
      results.sort((a, b) => {
        for (const order of parsed.orderBy!) {
          const aVal = a[order.field] as string | number
          const bVal = b[order.field] as string | number
          const dir = order.direction.toUpperCase() === 'DESC' ? -1 : 1

          if (aVal < bVal) return -1 * dir
          if (aVal > bVal) return 1 * dir
        }
        return 0
      })
    }

    // Apply offset
    if (parsed.offset !== undefined) {
      results = results.slice(parsed.offset)
    }

    // Apply limit
    if (parsed.limit !== undefined) {
      results = results.slice(0, parsed.limit)
    }

    // totalSize reflects the number of records returned (after offset/limit)
    const totalSize = results.length

    // Select fields
    results = results.map((r) => {
      const filtered: SObject = { attributes: r.attributes }
      for (const field of parsed.fields) {
        if (field in r) {
          filtered[field] = r[field]
        }
      }
      return filtered
    })

    return {
      totalSize,
      done: true,
      records: results as T[],
    }
  }

  /**
   * Execute a SOQL query including deleted/archived records
   */
  async queryAll<T = SObject>(soql: string): Promise<QueryResult<T>> {
    // In local implementation, same as query (no soft deletes)
    return this.query<T>(soql)
  }

  /**
   * Describe all SObjects
   */
  async describeGlobal(): Promise<DescribeGlobalResult> {
    const standardObjects: DescribeGlobalSObject[] = Object.keys(OBJECT_PREFIXES).map((name) => ({
      name,
      label: name,
      labelPlural: name + 's',
      keyPrefix: OBJECT_PREFIXES[name],
      queryable: true,
      createable: true,
      updateable: true,
      deletable: true,
    }))

    return {
      encoding: 'UTF-8',
      maxBatchSize: 200,
      sobjects: standardObjects,
    }
  }

  /**
   * Get organization limits (mock values)
   */
  async limits(): Promise<Limits> {
    const mockLimit = (max: number): LimitInfo => ({
      Max: max,
      Remaining: max,
    })

    return {
      DailyApiRequests: mockLimit(100000),
      DailyAsyncApexExecutions: mockLimit(250000),
      DailyBulkApiRequests: mockLimit(10000),
      DailyBulkV2QueryJobs: mockLimit(10000),
      DailyBulkV2QueryFileStorageMB: mockLimit(100000),
      DailyDurableGenericStreamingApiEvents: mockLimit(10000),
      DailyDurableStreamingApiEvents: mockLimit(10000),
      DailyGenericStreamingApiEvents: mockLimit(10000),
      DailyStandardVolumePlatformEvents: mockLimit(1000000),
      DailyStreamingApiEvents: mockLimit(10000),
      DailyWorkflowEmails: mockLimit(1000),
      DataStorageMB: mockLimit(10000),
      FileStorageMB: mockLimit(10000),
      HourlyAsyncReportRuns: mockLimit(1200),
      HourlyDashboardRefreshes: mockLimit(200),
      HourlyDashboardResults: mockLimit(200),
      HourlyDashboardStatuses: mockLimit(500),
      HourlyLongTermIdMapping: mockLimit(10000),
      HourlyManagedContentPublicRequests: mockLimit(50000),
      HourlyODataCallout: mockLimit(10000),
      HourlyPublishedPlatformEvents: mockLimit(50000),
      HourlyPublishedStandardVolumePlatformEvents: mockLimit(50000),
      HourlyShortTermIdMapping: mockLimit(10000),
      HourlySyncReportRuns: mockLimit(500),
      HourlyTimeBasedWorkflow: mockLimit(1000),
      MassEmail: mockLimit(1000),
      MonthlyPlatformEvents: mockLimit(1000000),
      MonthlyPlatformEventsUsageEntitlement: mockLimit(1000000),
      Package2VersionCreates: mockLimit(100),
      Package2VersionCreatesWithoutValidation: mockLimit(100),
      PermissionSets: mockLimit(1000),
      PrivateConnectOutboundCalloutHourlyLimitMB: mockLimit(1000),
      SingleEmail: mockLimit(1000),
      StreamingApiConcurrentClients: mockLimit(2000),
    }
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.storage.clear()
  }

  private matchesConditions(record: SObject, conditions: WhereConditions): boolean {
    for (const [field, condition] of Object.entries(conditions)) {
      const value = record[field]

      if (condition === null) {
        if (value !== null && value !== undefined) return false
        continue
      }

      if (typeof condition === 'object' && !Array.isArray(condition)) {
        for (const [op, expected] of Object.entries(condition)) {
          switch (op) {
            case '$eq':
              if (value !== expected) return false
              break
            case '$ne':
              if (value === expected) return false
              break
            case '$lt':
              if (!(value < (expected as number))) return false
              break
            case '$lte':
              if (!(value <= (expected as number))) return false
              break
            case '$gt':
              if (!(value > (expected as number))) return false
              break
            case '$gte':
              if (!(value >= (expected as number))) return false
              break
            case '$like':
              const pattern = (expected as string).replace(/%/g, '.*')
              if (!new RegExp(`^${pattern}$`, 'i').test(String(value))) return false
              break
            case '$in':
              if (!(expected as (string | number)[]).includes(value as string | number)) return false
              break
            case '$nin':
              if ((expected as (string | number)[]).includes(value as string | number)) return false
              break
          }
        }
        continue
      }

      if (Array.isArray(condition)) {
        if (!condition.includes(value as string | number)) return false
        continue
      }

      if (value !== condition) return false
    }

    return true
  }
}
