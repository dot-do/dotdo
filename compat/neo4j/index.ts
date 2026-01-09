/**
 * @dotdo/neo4j - Neo4j driver SDK compat
 *
 * Drop-in replacement for neo4j-driver backed by DO SQLite with JSON storage.
 *
 * Usage:
 *   import neo4j from '@dotdo/neo4j'
 *
 *   const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
 *   const session = driver.session()
 *
 *   // Create nodes
 *   await session.run('CREATE (a:Person {name: $name}) RETURN a', { name: 'Alice' })
 *
 *   // Query nodes
 *   const result = await session.run('MATCH (n:Person) RETURN n')
 *   const records = await result.records()
 *   records.forEach(record => console.log(record.get('n')))
 *
 *   await session.close()
 *   await driver.close()
 *
 * @see https://neo4j.com/docs/javascript-manual/current/
 */

// Re-export everything from neo4j.ts
export {
  driver,
  default as default,
  Integer,
  int,
  isInt,
  isNode,
  isRelationship,
  isPath,
  isPoint,
  isDate,
  isDateTime,
  isLocalDateTime,
  isDuration,
  NodeImpl,
  RelationshipImpl,
  PathImpl,
  Neo4jError,
  ServiceUnavailableError,
  SessionExpiredError,
  ProtocolError,
  DatabaseError,
  ClientError,
  TransientError,
  Point,
  Date,
  Time,
  LocalTime,
  DateTime,
  LocalDateTime,
  Duration,
  auth,
  notificationCategory,
  notificationSeverityLevel,
} from './neo4j'

// Re-export types
export type {
  Driver,
  Session,
  Transaction,
  ManagedTransaction,
  Result,
  Record,
  EagerResult,
  ResultSummary,
  ResultObserver,
  Counters,
  QueryType,
  Node,
  Relationship,
  Path,
  PathSegment,
  ServerInfo,
  DatabaseInfo,
  AuthToken,
  DriverConfig,
  ExtendedDriverConfig,
  SessionConfig,
  TransactionConfig,
  QueryConfig,
  BookmarkManager,
  Plan,
  ProfiledPlan,
  Notification,
  InputPosition,
  NotificationCategory,
  NotificationSeverityLevel,
} from './types'
