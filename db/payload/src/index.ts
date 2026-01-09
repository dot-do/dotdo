/**
 * @dotdo/payload - Payload CMS Database Adapter
 *
 * This module provides type mappings and adapters for using Payload CMS
 * as a data source for dotdo Things.
 *
 * @module @dotdo/payload
 */

// ============================================================================
// ADAPTER TYPES
// ============================================================================

export type {
  PayloadDatabaseAdapter,
  PayloadAdapterConfig,
  PayloadField,
  PayloadFieldType,
  PayloadCollection,
  PayloadDocument,
  CollectionToNoun,
  FieldToData,
  PayloadDocumentToThing,
  RelationshipFieldMapping,
} from './adapter/types'

export { slugToNounName, fieldNameToVerb, mapFieldType } from './adapter/types'

// ============================================================================
// TESTING HARNESS
// ============================================================================

export type {
  AdapterOperation,
  SeedData,
  PayloadAdapterHarnessConfig,
  PayloadAdapterHarness,
  ThingsStore,
  RelationshipsStore,
  NounsStore,
  MockPayloadAdapter,
} from './testing/harness'

export { createPayloadAdapterHarness } from './testing/harness'
