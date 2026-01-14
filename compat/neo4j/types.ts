/**
 * Neo4j Driver Types
 *
 * TypeScript type definitions compatible with the official neo4j-driver package.
 * These types enable drop-in replacement of the Neo4j driver with our DO-backed implementation.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Represents a Node in the graph database.
 */
export interface Neo4jNode<T = Record<string, unknown>> {
  identity: Neo4jInteger
  labels: string[]
  properties: T
  elementId: string
}

/**
 * Represents a Relationship (edge) in the graph database.
 */
export interface Neo4jRelationship<T = Record<string, unknown>> {
  identity: Neo4jInteger
  type: string
  start: Neo4jInteger
  end: Neo4jInteger
  properties: T
  elementId: string
  startNodeElementId: string
  endNodeElementId: string
}

/**
 * Represents a Path through the graph.
 */
export interface Neo4jPath<N = Record<string, unknown>, R = Record<string, unknown>> {
  start: Neo4jNode<N>
  end: Neo4jNode<N>
  segments: PathSegment<N, R>[]
  length: number
}

/**
 * A segment of a path.
 */
export interface PathSegment<N = Record<string, unknown>, R = Record<string, unknown>> {
  start: Neo4jNode<N>
  relationship: Neo4jRelationship<R>
  end: Neo4jNode<N>
}

/**
 * Neo4j Integer representation (for IDs).
 */
export interface Neo4jInteger {
  low: number
  high: number
  toNumber(): number
  toString(): string
  toInt(): number
}

/**
 * Neo4j Point for spatial data.
 */
export interface Neo4jPoint {
  srid: Neo4jInteger
  x: number
  y: number
  z?: number
}

/**
 * Neo4j Date types.
 */
export interface Neo4jDate {
  year: Neo4jInteger
  month: Neo4jInteger
  day: Neo4jInteger
  toString(): string
  toStandardDate(): Date
}

export interface Neo4jTime {
  hour: Neo4jInteger
  minute: Neo4jInteger
  second: Neo4jInteger
  nanosecond: Neo4jInteger
  timeZoneOffsetSeconds?: Neo4jInteger
  toString(): string
}

export interface Neo4jDateTime {
  year: Neo4jInteger
  month: Neo4jInteger
  day: Neo4jInteger
  hour: Neo4jInteger
  minute: Neo4jInteger
  second: Neo4jInteger
  nanosecond: Neo4jInteger
  timeZoneOffsetSeconds?: Neo4jInteger
  timeZoneId?: string
  toString(): string
  toStandardDate(): Date
}

export interface Neo4jDuration {
  months: Neo4jInteger
  days: Neo4jInteger
  seconds: Neo4jInteger
  nanoseconds: Neo4jInteger
  toString(): string
}

// ============================================================================
// SESSION & TRANSACTION TYPES
// ============================================================================

/**
 * Access mode for sessions.
 */
export type SessionMode = 'READ' | 'WRITE'

/**
 * Session configuration.
 */
export interface SessionConfig {
  defaultAccessMode?: SessionMode
  database?: string
  bookmarks?: string[]
  fetchSize?: number
  impersonatedUser?: string
}

/**
 * Transaction configuration.
 */
export interface TransactionConfig {
  timeout?: number
  metadata?: Record<string, unknown>
}

/**
 * Query result.
 */
export interface QueryResult<T = Record<string, unknown>> {
  records: Record<T>[]
  summary: ResultSummary
}

/**
 * A single result record.
 */
export interface Record<T = Record<string, unknown>> {
  keys: string[]
  length: number
  get(key: string | number): unknown
  toObject(): T
  has(key: string): boolean
  forEach(visitor: (value: unknown, key: string, record: Record<T>) => void): void
  map<U>(mapper: (value: unknown, key: string, record: Record<T>) => U): U[]
  entries(): IterableIterator<[string, unknown]>
  values(): IterableIterator<unknown>
}

/**
 * Result summary after query execution.
 */
export interface ResultSummary {
  query: { text: string; parameters: Record<string, unknown> }
  queryType: string
  counters: Counters
  updateStatistics: Counters
  plan?: Plan
  profile?: Plan
  notifications: Notification[]
  server: ServerInfo
  resultConsumedAfter: Neo4jInteger
  resultAvailableAfter: Neo4jInteger
  database: { name: string }
}

/**
 * Query execution counters.
 */
export interface Counters {
  nodesCreated(): number
  nodesDeleted(): number
  relationshipsCreated(): number
  relationshipsDeleted(): number
  propertiesSet(): number
  labelsAdded(): number
  labelsRemoved(): number
  indexesAdded(): number
  indexesRemoved(): number
  constraintsAdded(): number
  constraintsRemoved(): number
  containsUpdates(): boolean
  containsSystemUpdates(): boolean
  systemUpdates(): number
}

/**
 * Query plan.
 */
export interface Plan {
  operatorType: string
  arguments: Record<string, unknown>
  identifiers: string[]
  children: Plan[]
}

/**
 * Server notification.
 */
export interface Notification {
  code: string
  title: string
  description: string
  position?: { offset: number; line: number; column: number }
  severity: 'WARNING' | 'INFORMATION'
  category: string
}

/**
 * Server information.
 */
export interface ServerInfo {
  address: string
  version: string
  protocolVersion: number
}

// ============================================================================
// DRIVER CONFIGURATION
// ============================================================================

/**
 * Driver configuration options.
 */
export interface DriverConfig {
  maxConnectionPoolSize?: number
  connectionAcquisitionTimeout?: number
  connectionTimeout?: number
  maxTransactionRetryTime?: number
  logging?: LoggingConfig
  resolver?: (address: string) => string[] | Promise<string[]>
  userAgent?: string
  fetchSize?: number
  encrypted?: boolean | 'ENCRYPTION_ON' | 'ENCRYPTION_OFF'
  trust?: 'TRUST_ALL_CERTIFICATES' | 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES' | 'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES'
  trustedCertificates?: string[]
}

/**
 * Logging configuration.
 */
export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug'
  logger: (level: string, message: string) => void
}

/**
 * Authentication token.
 */
export interface AuthToken {
  scheme: 'basic' | 'bearer' | 'kerberos' | 'none'
  principal?: string
  credentials?: string
  realm?: string
  parameters?: Record<string, unknown>
}

// ============================================================================
// STREAMING & REACTIVE TYPES
// ============================================================================

/**
 * Result stream for reactive processing.
 */
export interface ResultObserver<T = Record<string, unknown>> {
  onKeys(keys: string[]): void
  onNext(record: Record<T>): void
  onCompleted(summary: ResultSummary): void
  onError(error: Error): void
}

/**
 * Streaming result subscription.
 */
export interface ResultSubscription {
  request(n: number): void
  cancel(): void
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Neo4j error with code and message.
 */
export interface Neo4jError extends Error {
  code: string
  retriable: boolean
}

export type Neo4jErrorCode =
  | 'Neo.ClientError.Statement.SyntaxError'
  | 'Neo.ClientError.Statement.SemanticError'
  | 'Neo.ClientError.Statement.ParameterMissing'
  | 'Neo.ClientError.Statement.EntityNotFound'
  | 'Neo.ClientError.Schema.ConstraintValidationFailed'
  | 'Neo.ClientError.Security.Unauthorized'
  | 'Neo.ClientError.Security.Forbidden'
  | 'Neo.TransientError.Transaction.DeadlockDetected'
  | 'Neo.TransientError.Transaction.LockClientStopped'
  | 'Neo.DatabaseError.General.UnknownError'

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Type for Cypher query parameters.
 */
export type CypherParams = Record<string, unknown>

/**
 * Result from running a query.
 */
export type RunResult<T = Record<string, unknown>> = Promise<QueryResult<T>>

/**
 * Function signature for transaction work.
 */
export type TransactionWork<T> = (tx: Transaction) => Promise<T>

/**
 * Transaction interface.
 */
export interface Transaction {
  run<T = Record<string, unknown>>(query: string, params?: CypherParams): Promise<QueryResult<T>>
  commit(): Promise<void>
  rollback(): Promise<void>
  isOpen(): boolean
}

/**
 * Session interface.
 */
export interface Session {
  run<T = Record<string, unknown>>(query: string, params?: CypherParams, config?: TransactionConfig): Promise<QueryResult<T>>
  readTransaction<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T>
  writeTransaction<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T>
  executeRead<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T>
  executeWrite<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T>
  beginTransaction(config?: TransactionConfig): Transaction
  lastBookmark(): string
  lastBookmarks(): string[]
  close(): Promise<void>
}

/**
 * Driver interface.
 */
export interface Driver {
  session(config?: SessionConfig): Session
  verifyConnectivity(): Promise<ServerInfo>
  supportsMultiDb(): Promise<boolean>
  supportsTransactionConfig(): Promise<boolean>
  close(): Promise<void>
  getServerInfo(): Promise<ServerInfo>
}
