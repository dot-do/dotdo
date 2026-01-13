/**
 * Event/Streaming Source Connectors - Stubs
 *
 * Kafka, SQS, and Pub/Sub source connectors for the connector framework.
 * These stubs define the interface - full implementation pending.
 *
 * @module db/primitives/connector-framework/sources/event
 */

import type { Source, SourceState, Record as SourceRecord } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Message format configuration
 */
export type MessageFormat = 'json' | 'avro' | 'protobuf' | 'raw'

/**
 * Base event source configuration
 */
export interface EventSourceConfig {
  /** Message format */
  format: MessageFormat
  /** Batch size */
  batchSize?: number
  /** Poll timeout in ms */
  pollTimeout?: number
  /** ID field in message */
  idField?: string
  /** Timestamp field in message */
  timestampField?: string
}

/**
 * Kafka source configuration
 */
export interface KafkaSourceConfig extends EventSourceConfig {
  /** Kafka broker list */
  brokers: string[]
  /** Topic name */
  topic: string
  /** Consumer group ID */
  groupId: string
  /** Auto offset reset */
  autoOffsetReset?: 'earliest' | 'latest'
  /** SASL configuration */
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512'
    username: string
    password: string
  }
  /** SSL configuration */
  ssl?: boolean | {
    ca?: string
    cert?: string
    key?: string
  }
  /** Schema registry URL (for Avro) */
  schemaRegistryUrl?: string
}

/**
 * AWS SQS source configuration
 */
export interface SQSSourceConfig extends EventSourceConfig {
  /** SQS queue URL */
  queueUrl: string
  /** AWS region */
  region: string
  /** AWS credentials */
  accessKeyId?: string
  secretAccessKey?: string
  /** Visibility timeout in seconds */
  visibilityTimeout?: number
  /** Wait time in seconds (long polling) */
  waitTimeSeconds?: number
  /** Delete messages after reading */
  deleteAfterRead?: boolean
}

/**
 * Google Pub/Sub source configuration
 */
export interface PubSubSourceConfig extends EventSourceConfig {
  /** GCP project ID */
  projectId: string
  /** Subscription name */
  subscription: string
  /** Service account key JSON */
  serviceAccountKey?: string | Record<string, unknown>
  /** Max messages per batch */
  maxMessages?: number
  /** Ack deadline in seconds */
  ackDeadlineSeconds?: number
}

// ============================================================================
// Factory Functions (Stubs)
// ============================================================================

/**
 * Create a Kafka source connector
 */
export function createKafkaSource(_config: KafkaSourceConfig): Source {
  return {
    name: 'kafka',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      throw new Error('Not implemented')
    },
  }
}

/**
 * Create an AWS SQS source connector
 */
export function createSQSSource(_config: SQSSourceConfig): Source {
  return {
    name: 'sqs',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op
    },
  }
}

/**
 * Create a Google Pub/Sub source connector
 */
export function createPubSubSource(_config: PubSubSourceConfig): Source {
  return {
    name: 'pubsub',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op
    },
  }
}
