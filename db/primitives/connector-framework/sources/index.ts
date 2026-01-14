/**
 * Source Connectors Index
 *
 * Provides pre-built source connectors for common connector categories:
 * - API: REST and GraphQL endpoints
 * - Database: SQL and NoSQL databases
 * - File: Object storage (S3, R2, GCS)
 * - Event: Streaming platforms (Kafka, SQS)
 *
 * @module db/primitives/connector-framework/sources
 */

// API Sources
export {
  createRestApiSource,
  createGraphQLSource,
  type RestApiSourceConfig,
  type GraphQLSourceConfig,
  type PaginationConfig,
  type AuthConfig,
} from './api'

// Database Sources
export {
  createPostgresSource,
  createMySQLSource,
  createMongoDBSource,
  type PostgresSourceConfig,
  type MySQLSourceConfig,
  type MongoDBSourceConfig,
  type DatabaseSourceConfig,
} from './database'

// File Sources
export {
  createS3Source,
  createR2Source,
  createGCSSource,
  type FileSourceConfig,
  type S3SourceConfig,
  type R2SourceConfig,
  type GCSSourceConfig,
  type FileFormat,
  type FileParserConfig,
} from './file'

// Event Sources
export {
  createKafkaSource,
  createSQSSource,
  createPubSubSource,
  type EventSourceConfig,
  type KafkaSourceConfig,
  type SQSSourceConfig,
  type PubSubSourceConfig,
  type MessageFormat,
} from './event'
