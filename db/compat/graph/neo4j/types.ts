/**
 * @dotdo/neo4j types
 *
 * Neo4j driver-compatible type definitions
 * for the Neo4j SDK backed by Durable Objects with SQLite storage
 *
 * @see https://neo4j.com/docs/javascript-manual/current/
 */

// ============================================================================
// DRIVER & AUTH
// ============================================================================

/**
 * Neo4j authentication types
 */
export interface AuthToken {
  scheme: string
  principal?: string
  credentials?: string
  realm?: string
  parameters?: Record<string, unknown>
}

/**
 * Authentication helper functions
 */
export const auth = {
  /**
   * Basic authentication with username and password
   */
  basic(username: string, password: string, realm?: string): AuthToken {
    return {
      scheme: 'basic',
      principal: username,
      credentials: password,
      realm,
    }
  },

  /**
   * Kerberos authentication with base64 encoded ticket
   */
  kerberos(base64EncodedTicket: string): AuthToken {
    return {
      scheme: 'kerberos',
      credentials: base64EncodedTicket,
    }
  },

  /**
   * Bearer authentication with base64 encoded token
   */
  bearer(base64EncodedToken: string): AuthToken {
    return {
      scheme: 'bearer',
      credentials: base64EncodedToken,
    }
  },

  /**
   * Custom authentication
   */
  custom(
    principal: string,
    credentials: string,
    realm: string,
    scheme: string,
    parameters?: Record<string, unknown>
  ): AuthToken {
    return {
      scheme,
      principal,
      credentials,
      realm,
      parameters,
    }
  },
}

/**
 * Neo4j driver configuration options
 */
export interface DriverConfig {
  /** Maximum connection pool size */
  maxConnectionPoolSize?: number
  /** Connection acquisition timeout in ms */
  connectionAcquisitionTimeout?: number
  /** Connection timeout in ms */
  connectionTimeout?: number
  /** Max transaction retry time in ms */
  maxTransactionRetryTime?: number
  /** Trust strategy */
  trust?: 'TRUST_ALL_CERTIFICATES' | 'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES' | 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES'
  /** Encrypted connection */
  encrypted?: boolean | 'ENCRYPTION_ON' | 'ENCRYPTION_OFF'
  /** User agent */
  userAgent?: string
  /** Resolver function for DNS resolution */
  resolver?: (address: string) => string[] | Promise<string[]>
  /** Logging configuration */
  logging?: {
    level?: 'error' | 'warn' | 'info' | 'debug'
    logger?: (level: string, message: string) => void
  }
}

/**
 * Extended driver config for DO backing
 */
export interface ExtendedDriverConfig extends DriverConfig {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    algorithm?: 'consistent' | 'range' | 'hash'
    count?: number
  }
}

/**
 * Neo4j Driver interface
 */
export interface Driver {
  /** Create a new session */
  session(config?: SessionConfig): Session

  /** Verify connectivity to the server */
  verifyConnectivity(): Promise<ServerInfo>

  /** Get server info */
  getServerInfo(): Promise<ServerInfo>

  /** Check if session acquisition is supported */
  supportsSessionAcquisition(): boolean

  /** Check if multi-database is supported */
  supportsMultiDatabase(): boolean

  /** Check if transaction config is supported */
  supportsTransactionConfig(): boolean

  /** Execute a query (convenience method) */
  executeQuery<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>,
    config?: QueryConfig
  ): Promise<EagerResult<T>>

  /** Close the driver */
  close(): Promise<void>
}

/**
 * Server information
 */
export interface ServerInfo {
  address: string
  protocolVersion: number
  agent?: string
}

/**
 * Query configuration for executeQuery
 */
export interface QueryConfig {
  database?: string
  impersonatedUser?: string
  bookmarkManager?: BookmarkManager
  routing?: 'WRITE' | 'READ'
}

// ============================================================================
// SESSION
// ============================================================================

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Default access mode */
  defaultAccessMode?: 'READ' | 'WRITE'
  /** Database name */
  database?: string
  /** Bookmarks for causal consistency */
  bookmarks?: string | string[]
  /** Fetch size */
  fetchSize?: number
  /** Impersonated user */
  impersonatedUser?: string
  /** Bookmark manager */
  bookmarkManager?: BookmarkManager
}

/**
 * Bookmark manager for causal consistency
 */
export interface BookmarkManager {
  getBookmarks(): string[]
  updateBookmarks(previousBookmarks: string[], newBookmarks: string[]): void
}

/**
 * Session interface
 */
export interface Session {
  /** Run a Cypher query */
  run<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>,
    config?: TransactionConfig
  ): Result<T>

  /** Begin a new transaction */
  beginTransaction(config?: TransactionConfig): Transaction

  /** Execute a read transaction */
  executeRead<T>(
    work: (tx: ManagedTransaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T>

  /** Execute a write transaction */
  executeWrite<T>(
    work: (tx: ManagedTransaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T>

  /** Legacy: Read transaction */
  readTransaction<T>(
    work: (tx: Transaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T>

  /** Legacy: Write transaction */
  writeTransaction<T>(
    work: (tx: Transaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T>

  /** Get last bookmarks */
  lastBookmarks(): string[]

  /** Get last bookmark (deprecated) */
  lastBookmark(): string[]

  /** Close the session */
  close(): Promise<void>
}

/**
 * Transaction configuration
 */
export interface TransactionConfig {
  /** Transaction timeout in ms */
  timeout?: number
  /** Transaction metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// TRANSACTION
// ============================================================================

/**
 * Transaction interface
 */
export interface Transaction {
  /** Run a Cypher query in this transaction */
  run<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>
  ): Result<T>

  /** Commit the transaction */
  commit(): Promise<void>

  /** Rollback the transaction */
  rollback(): Promise<void>

  /** Close the transaction (will rollback if not committed) */
  close(): Promise<void>

  /** Check if transaction is open */
  isOpen(): boolean
}

/**
 * Managed transaction (cannot be committed/rolled back manually)
 */
export interface ManagedTransaction {
  /** Run a Cypher query in this transaction */
  run<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>
  ): Result<T>
}

// ============================================================================
// RESULT
// ============================================================================

/**
 * Query result interface
 */
export interface Result<T = Record<string, unknown>> extends AsyncIterable<Record<T>> {
  /** Get all records as array */
  records(): Promise<Record<T>[]>

  /** Get result summary */
  summary(): Promise<ResultSummary>

  /** Consume all records and return summary */
  consume(): Promise<ResultSummary>

  /** Get keys (column names) */
  keys(): Promise<string[]>

  /** Peek at the first record without consuming */
  peek(): Promise<Record<T> | null>

  /** Subscribe to results */
  subscribe(observer: ResultObserver<T>): void
}

/**
 * Eager result (all records loaded)
 */
export interface EagerResult<T = Record<string, unknown>> {
  keys: string[]
  records: Record<T>[]
  summary: ResultSummary
}

/**
 * Result observer for streaming
 */
export interface ResultObserver<T = Record<string, unknown>> {
  onKeys?: (keys: string[]) => void
  onNext?: (record: Record<T>) => void
  onCompleted?: (summary: ResultSummary) => void
  onError?: (error: Error) => void
}

/**
 * Single record from query result
 */
export interface Record<T = Record<string, unknown>> {
  /** Get all keys */
  keys: string[]

  /** Get number of fields */
  length: number

  /** Get value by key or index */
  get(key: string | number): unknown

  /** Check if record has key */
  has(key: string | number): boolean

  /** Iterate over values */
  forEach(visitor: (value: unknown, key: string, record: Record<T>) => void): void

  /** Convert to object */
  toObject(): T

  /** Get values as array */
  values(): unknown[]

  /** Get entries as array */
  entries(): Array<[string, unknown]>
}

/**
 * Result summary
 */
export interface ResultSummary {
  /** Query type */
  queryType: QueryType

  /** Counters for the query */
  counters: Counters

  /** Query plan (if available) */
  plan?: Plan

  /** Profile (if available) */
  profile?: ProfiledPlan

  /** Notifications */
  notifications: Notification[]

  /** Server info */
  server: ServerInfo

  /** Database info */
  database: DatabaseInfo

  /** Result consumed after time */
  resultConsumedAfter: number

  /** Result available after time */
  resultAvailableAfter: number

  /** Check if plan is available */
  hasPlan(): boolean

  /** Check if profile is available */
  hasProfile(): boolean
}

/**
 * Query type
 */
export type QueryType =
  | 'r'   // read
  | 'w'   // write
  | 'rw'  // read-write
  | 's'   // schema

/**
 * Query counters
 */
export interface Counters {
  nodesCreated: number
  nodesDeleted: number
  relationshipsCreated: number
  relationshipsDeleted: number
  propertiesSet: number
  labelsAdded: number
  labelsRemoved: number
  indexesAdded: number
  indexesRemoved: number
  constraintsAdded: number
  constraintsRemoved: number
  systemUpdates: number

  /** Check if any updates occurred */
  containsUpdates(): boolean

  /** Check if system updates occurred */
  containsSystemUpdates(): boolean
}

/**
 * Query plan
 */
export interface Plan {
  operatorType: string
  identifiers: string[]
  arguments: Record<string, unknown>
  children: Plan[]
}

/**
 * Profiled query plan
 */
export interface ProfiledPlan extends Plan {
  dbHits: number
  rows: number
  pageCacheMisses: number
  pageCacheHits: number
  time: number
  children: ProfiledPlan[]
}

/**
 * Query notification
 */
export interface Notification {
  code: string
  title: string
  description: string
  position?: InputPosition
  severity: 'WARNING' | 'INFORMATION' | 'DEPRECATED'
}

/**
 * Input position for notifications
 */
export interface InputPosition {
  offset: number
  line: number
  column: number
}

/**
 * Database info
 */
export interface DatabaseInfo {
  name: string
}

// ============================================================================
// GRAPH TYPES - NODE
// ============================================================================

/**
 * Graph node
 */
export interface Node<T = Record<string, unknown>> {
  /** Internal node identity */
  identity: Integer

  /** Node labels */
  labels: string[]

  /** Node properties */
  properties: T

  /** Element ID (string form) */
  elementId: string

  /** Check if this is a Node */
  readonly isNode: true
}

/**
 * Create a Node instance
 */
export class NodeImpl<T = Record<string, unknown>> implements Node<T> {
  readonly isNode = true as const

  constructor(
    public readonly identity: Integer,
    public readonly labels: string[],
    public readonly properties: T,
    public readonly elementId: string
  ) {}
}

// ============================================================================
// GRAPH TYPES - RELATIONSHIP
// ============================================================================

/**
 * Graph relationship
 */
export interface Relationship<T = Record<string, unknown>> {
  /** Internal relationship identity */
  identity: Integer

  /** Relationship type */
  type: string

  /** Start node identity */
  start: Integer

  /** End node identity */
  end: Integer

  /** Relationship properties */
  properties: T

  /** Element ID (string form) */
  elementId: string

  /** Start node element ID */
  startNodeElementId: string

  /** End node element ID */
  endNodeElementId: string

  /** Check if this is a Relationship */
  readonly isRelationship: true
}

/**
 * Create a Relationship instance
 */
export class RelationshipImpl<T = Record<string, unknown>> implements Relationship<T> {
  readonly isRelationship = true as const

  constructor(
    public readonly identity: Integer,
    public readonly type: string,
    public readonly start: Integer,
    public readonly end: Integer,
    public readonly properties: T,
    public readonly elementId: string,
    public readonly startNodeElementId: string,
    public readonly endNodeElementId: string
  ) {}
}

// ============================================================================
// GRAPH TYPES - PATH
// ============================================================================

/**
 * Graph path (sequence of nodes and relationships)
 */
export interface Path<N = Record<string, unknown>, R = Record<string, unknown>> {
  /** Start node */
  start: Node<N>

  /** End node */
  end: Node<N>

  /** Segments in the path */
  segments: PathSegment<N, R>[]

  /** Length of the path */
  length: number
}

/**
 * Path segment
 */
export interface PathSegment<N = Record<string, unknown>, R = Record<string, unknown>> {
  start: Node<N>
  relationship: Relationship<R>
  end: Node<N>
}

/**
 * Create a Path instance
 */
export class PathImpl<N = Record<string, unknown>, R = Record<string, unknown>> implements Path<N, R> {
  constructor(
    public readonly start: Node<N>,
    public readonly end: Node<N>,
    public readonly segments: PathSegment<N, R>[]
  ) {}

  get length(): number {
    return this.segments.length
  }
}

// ============================================================================
// INTEGER TYPE
// ============================================================================

/**
 * Neo4j Integer type (64-bit integer support)
 */
export class Integer {
  private _value: bigint

  constructor(value: bigint | number | string) {
    if (typeof value === 'bigint') {
      this._value = value
    } else if (typeof value === 'number') {
      this._value = BigInt(Math.floor(value))
    } else {
      this._value = BigInt(value)
    }
  }

  /** Create from number */
  static fromNumber(value: number): Integer {
    return new Integer(BigInt(Math.floor(value)))
  }

  /** Create from string */
  static fromString(value: string): Integer {
    return new Integer(BigInt(value))
  }

  /** Create from bigint */
  static fromBigInt(value: bigint): Integer {
    return new Integer(value)
  }

  /** Zero integer */
  static ZERO = new Integer(BigInt(0))

  /** One integer */
  static ONE = new Integer(BigInt(1))

  /** Negative one integer */
  static NEG_ONE = new Integer(BigInt(-1))

  /** Check if value is safe as JavaScript number */
  inSafeRange(): boolean {
    return this._value >= BigInt(Number.MIN_SAFE_INTEGER) &&
           this._value <= BigInt(Number.MAX_SAFE_INTEGER)
  }

  /** Convert to number (may lose precision) */
  toNumber(): number {
    return Number(this._value)
  }

  /** Convert to number, throw if not safe */
  toNumberOrThrow(): number {
    if (!this.inSafeRange()) {
      throw new Error('Integer value is not safe to convert to number')
    }
    return Number(this._value)
  }

  /** Convert to bigint */
  toBigInt(): bigint {
    return this._value
  }

  /** Convert to string */
  toString(): string {
    return this._value.toString()
  }

  /** Convert to JSON */
  toJSON(): string {
    return this._value.toString()
  }

  /** Check equality */
  equals(other: Integer | number | bigint): boolean {
    if (other instanceof Integer) {
      return this._value === other._value
    }
    return this._value === BigInt(other)
  }

  /** Compare to another integer */
  compare(other: Integer): number {
    if (this._value < other._value) return -1
    if (this._value > other._value) return 1
    return 0
  }

  /** Add */
  add(other: Integer): Integer {
    return new Integer(this._value + other._value)
  }

  /** Subtract */
  subtract(other: Integer): Integer {
    return new Integer(this._value - other._value)
  }

  /** Multiply */
  multiply(other: Integer): Integer {
    return new Integer(this._value * other._value)
  }

  /** Divide */
  divide(other: Integer): Integer {
    return new Integer(this._value / other._value)
  }

  /** Negate */
  negate(): Integer {
    return new Integer(-this._value)
  }

  /** Check if zero */
  isZero(): boolean {
    return this._value === BigInt(0)
  }

  /** Check if positive */
  isPositive(): boolean {
    return this._value > BigInt(0)
  }

  /** Check if negative */
  isNegative(): boolean {
    return this._value < BigInt(0)
  }
}

/**
 * Check if value is a Neo4j Integer
 */
export function isInt(value: unknown): value is Integer {
  return value instanceof Integer
}

/**
 * Convert value to Neo4j Integer
 */
export function int(value: number | bigint | string): Integer {
  return new Integer(value)
}

// ============================================================================
// TEMPORAL TYPES
// ============================================================================

/**
 * Neo4j Date type
 */
export class Date {
  constructor(
    public readonly year: number,
    public readonly month: number,
    public readonly day: number
  ) {}

  static fromStandardDate(standardDate: globalThis.Date): Date {
    return new Date(
      standardDate.getFullYear(),
      standardDate.getMonth() + 1,
      standardDate.getDate()
    )
  }

  toStandardDate(): globalThis.Date {
    return new globalThis.Date(this.year, this.month - 1, this.day)
  }

  toString(): string {
    return `${this.year.toString().padStart(4, '0')}-${this.month.toString().padStart(2, '0')}-${this.day.toString().padStart(2, '0')}`
  }
}

/**
 * Neo4j Time type
 */
export class Time {
  constructor(
    public readonly hour: number,
    public readonly minute: number,
    public readonly second: number,
    public readonly nanosecond: number,
    public readonly timeZoneOffsetSeconds?: number
  ) {}

  toString(): string {
    const timeStr = `${this.hour.toString().padStart(2, '0')}:${this.minute.toString().padStart(2, '0')}:${this.second.toString().padStart(2, '0')}`
    if (this.nanosecond > 0) {
      return `${timeStr}.${this.nanosecond.toString().padStart(9, '0')}`
    }
    return timeStr
  }
}

/**
 * Neo4j LocalTime type
 */
export class LocalTime {
  constructor(
    public readonly hour: number,
    public readonly minute: number,
    public readonly second: number,
    public readonly nanosecond: number
  ) {}

  static fromStandardDate(standardDate: globalThis.Date): LocalTime {
    return new LocalTime(
      standardDate.getHours(),
      standardDate.getMinutes(),
      standardDate.getSeconds(),
      standardDate.getMilliseconds() * 1000000
    )
  }

  toString(): string {
    return `${this.hour.toString().padStart(2, '0')}:${this.minute.toString().padStart(2, '0')}:${this.second.toString().padStart(2, '0')}`
  }
}

/**
 * Neo4j DateTime type
 */
export class DateTime {
  constructor(
    public readonly year: number,
    public readonly month: number,
    public readonly day: number,
    public readonly hour: number,
    public readonly minute: number,
    public readonly second: number,
    public readonly nanosecond: number,
    public readonly timeZoneOffsetSeconds?: number,
    public readonly timeZoneId?: string
  ) {}

  static fromStandardDate(standardDate: globalThis.Date): DateTime {
    return new DateTime(
      standardDate.getFullYear(),
      standardDate.getMonth() + 1,
      standardDate.getDate(),
      standardDate.getHours(),
      standardDate.getMinutes(),
      standardDate.getSeconds(),
      standardDate.getMilliseconds() * 1000000,
      -standardDate.getTimezoneOffset() * 60
    )
  }

  toStandardDate(): globalThis.Date {
    return new globalThis.Date(
      this.year,
      this.month - 1,
      this.day,
      this.hour,
      this.minute,
      this.second,
      Math.floor(this.nanosecond / 1000000)
    )
  }

  toString(): string {
    const dateStr = `${this.year.toString().padStart(4, '0')}-${this.month.toString().padStart(2, '0')}-${this.day.toString().padStart(2, '0')}`
    const timeStr = `${this.hour.toString().padStart(2, '0')}:${this.minute.toString().padStart(2, '0')}:${this.second.toString().padStart(2, '0')}`
    return `${dateStr}T${timeStr}`
  }
}

/**
 * Neo4j LocalDateTime type
 */
export class LocalDateTime {
  constructor(
    public readonly year: number,
    public readonly month: number,
    public readonly day: number,
    public readonly hour: number,
    public readonly minute: number,
    public readonly second: number,
    public readonly nanosecond: number
  ) {}

  static fromStandardDate(standardDate: globalThis.Date): LocalDateTime {
    return new LocalDateTime(
      standardDate.getFullYear(),
      standardDate.getMonth() + 1,
      standardDate.getDate(),
      standardDate.getHours(),
      standardDate.getMinutes(),
      standardDate.getSeconds(),
      standardDate.getMilliseconds() * 1000000
    )
  }

  toStandardDate(): globalThis.Date {
    return new globalThis.Date(
      this.year,
      this.month - 1,
      this.day,
      this.hour,
      this.minute,
      this.second,
      Math.floor(this.nanosecond / 1000000)
    )
  }

  toString(): string {
    const dateStr = `${this.year.toString().padStart(4, '0')}-${this.month.toString().padStart(2, '0')}-${this.day.toString().padStart(2, '0')}`
    const timeStr = `${this.hour.toString().padStart(2, '0')}:${this.minute.toString().padStart(2, '0')}:${this.second.toString().padStart(2, '0')}`
    return `${dateStr}T${timeStr}`
  }
}

/**
 * Neo4j Duration type
 */
export class Duration {
  constructor(
    public readonly months: number,
    public readonly days: number,
    public readonly seconds: number,
    public readonly nanoseconds: number
  ) {}

  toString(): string {
    return `P${this.months}M${this.days}DT${this.seconds}S`
  }
}

// ============================================================================
// SPATIAL TYPES
// ============================================================================

/**
 * Neo4j Point type (spatial)
 */
export class Point {
  constructor(
    public readonly srid: number,
    public readonly x: number,
    public readonly y: number,
    public readonly z?: number
  ) {}

  /** Create a 2D Cartesian point */
  static cartesian(x: number, y: number): Point {
    return new Point(7203, x, y)
  }

  /** Create a 3D Cartesian point */
  static cartesian3D(x: number, y: number, z: number): Point {
    return new Point(9157, x, y, z)
  }

  /** Create a 2D geographic point (WGS-84) */
  static geographic(longitude: number, latitude: number): Point {
    return new Point(4326, longitude, latitude)
  }

  /** Create a 3D geographic point (WGS-84-3D) */
  static geographic3D(longitude: number, latitude: number, height: number): Point {
    return new Point(4979, longitude, latitude, height)
  }

  toString(): string {
    if (this.z !== undefined) {
      return `Point({srid: ${this.srid}, x: ${this.x}, y: ${this.y}, z: ${this.z}})`
    }
    return `Point({srid: ${this.srid}, x: ${this.x}, y: ${this.y}})`
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base Neo4j error
 */
export class Neo4jError extends Error {
  code?: string
  retriable: boolean

  constructor(message: string, code?: string, retriable = false) {
    super(message)
    this.name = 'Neo4jError'
    this.code = code
    this.retriable = retriable
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends Neo4jError {
  constructor(message: string) {
    super(message, 'ServiceUnavailable', true)
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * Session expired error
 */
export class SessionExpiredError extends Neo4jError {
  constructor(message: string) {
    super(message, 'SessionExpired', true)
    this.name = 'SessionExpiredError'
  }
}

/**
 * Protocol error
 */
export class ProtocolError extends Neo4jError {
  constructor(message: string) {
    super(message, 'ProtocolError', false)
    this.name = 'ProtocolError'
  }
}

/**
 * Database error (from server)
 */
export class DatabaseError extends Neo4jError {
  constructor(message: string, code?: string) {
    super(message, code, false)
    this.name = 'DatabaseError'
  }
}

/**
 * Client error
 */
export class ClientError extends Neo4jError {
  constructor(message: string, code?: string) {
    super(message, code, false)
    this.name = 'ClientError'
  }
}

/**
 * Transient error (retriable)
 */
export class TransientError extends Neo4jError {
  constructor(message: string, code?: string) {
    super(message, code, true)
    this.name = 'TransientError'
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if value is a Node
 */
export function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && 'isNode' in value && (value as Node).isNode === true
}

/**
 * Check if value is a Relationship
 */
export function isRelationship(value: unknown): value is Relationship {
  return value !== null && typeof value === 'object' && 'isRelationship' in value && (value as Relationship).isRelationship === true
}

/**
 * Check if value is a Path
 */
export function isPath(value: unknown): value is Path {
  return value !== null && typeof value === 'object' && 'start' in value && 'end' in value && 'segments' in value
}

/**
 * Check if value is a Point
 */
export function isPoint(value: unknown): value is Point {
  return value instanceof Point
}

/**
 * Check if value is a Date
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date
}

/**
 * Check if value is a DateTime
 */
export function isDateTime(value: unknown): value is DateTime {
  return value instanceof DateTime
}

/**
 * Check if value is a LocalDateTime
 */
export function isLocalDateTime(value: unknown): value is LocalDateTime {
  return value instanceof LocalDateTime
}

/**
 * Check if value is a Duration
 */
export function isDuration(value: unknown): value is Duration {
  return value instanceof Duration
}

// ============================================================================
// NOTIFICATION CATEGORIES
// ============================================================================

export const notificationCategory = {
  HINT: 'HINT',
  UNRECOGNIZED: 'UNRECOGNIZED',
  UNSUPPORTED: 'UNSUPPORTED',
  PERFORMANCE: 'PERFORMANCE',
  DEPRECATION: 'DEPRECATION',
  GENERIC: 'GENERIC',
  SECURITY: 'SECURITY',
  TOPOLOGY: 'TOPOLOGY',
} as const

export type NotificationCategory = typeof notificationCategory[keyof typeof notificationCategory]

// ============================================================================
// NOTIFICATION SEVERITY
// ============================================================================

export const notificationSeverityLevel = {
  WARNING: 'WARNING',
  INFORMATION: 'INFORMATION',
  DEPRECATED: 'DEPRECATED',
} as const

export type NotificationSeverityLevel = typeof notificationSeverityLevel[keyof typeof notificationSeverityLevel]
