/**
 * @dotdo/payload - Payload CMS Database Adapter for dotdo
 *
 * Drop-in database adapter that maps Payload CMS operations to dotdo's
 * Things + Relationships storage model.
 *
 * @example
 * ```typescript
 * import { payloadAdapter } from '@dotdo/payload'
 * import { buildConfig } from 'payload'
 *
 * export default buildConfig({
 *   db: payloadAdapter({
 *     ns: 'https://my-app.dotdo.dev',
 *   }),
 *   collections: [
 *     // Your collections
 *   ],
 * })
 * ```
 *
 * @module @dotdo/payload
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Adapter configuration
  PayloadAdapterConfig,
  PayloadAdapterResult,
  PayloadAdapter,

  // Field mappings
  PayloadFieldType,
  FieldTypeMapping,
  FieldTransformContext,
  PayloadFieldDefinition,

  // Document mappings
  PayloadThingData,
  PayloadVersionMeta,
  PayloadDocument,

  // Query translation
  PayloadWhereClause,
  PayloadWhereOperator,
  ThingsQuery,
  ThingsWhereClause,
  ThingsOperator,
  ThingsJoinQuery,

  // Transaction types
  PayloadTransaction,
  TransactionOperation,

  // Migration types
  PayloadMigration,

  // Utility types
  PayloadRelationship,
  LocalizedValue,
  BatchResult,

  // Re-exported Payload types
  BaseDatabaseAdapter,
  PaginatedDocs,
  FindArgs,
  FindOneArgs,
  CreateArgs,
  UpdateOneArgs,
  UpdateManyArgs,
  DeleteOneArgs,
  DeleteManyArgs,
  CountArgs,
  QueryDraftsArgs,
  FindVersionsArgs,
  CreateVersionArgs,
  UpdateVersionArgs,
  DeleteVersionsArgs,
  FindGlobalArgs,
  CreateGlobalArgs,
  UpdateGlobalArgs,
  FindGlobalVersionsArgs,
  CreateGlobalVersionArgs,
  UpdateGlobalVersionArgs,
  CountGlobalVersionArgs,
  UpsertArgs,
  FindDistinctArgs,
  PaginatedDistinctDocs,
} from './types'

// =============================================================================
// Testing utilities (separate entry point for tests)
// =============================================================================

// Note: Import from '@dotdo/payload/testing' for test utilities
// export * from './testing' - only exported in testing entry

// =============================================================================
// Adapter Factory (placeholder - full implementation in separate task)
// =============================================================================

import type { PayloadAdapterConfig, PayloadAdapterResult } from './types'

/**
 * Create a dotdo Payload database adapter
 *
 * This adapter maps Payload CMS operations to dotdo's Things + Relationships
 * storage model, providing:
 *
 * - **Automatic type mapping**: Payload collections become Thing types
 * - **Relationship handling**: Uses dotdo's Relationships table
 * - **Versioning**: Leverages dotdo's append-only event model
 * - **Soft deletes**: Consistent with dotdo's deletedAt pattern
 * - **Git sync**: Optional sync with git repositories
 *
 * @param config - Adapter configuration
 * @returns Payload adapter result
 *
 * @example Basic usage
 * ```typescript
 * import { payloadAdapter } from '@dotdo/payload'
 *
 * export default buildConfig({
 *   db: payloadAdapter({
 *     ns: 'https://my-app.dotdo.dev',
 *   }),
 *   collections: [Posts, Users, Media],
 * })
 * ```
 *
 * @example With DO instance
 * ```typescript
 * import { payloadAdapter } from '@dotdo/payload'
 * import { MyDO } from './objects/MyDO'
 *
 * // In your worker
 * export default {
 *   async fetch(req, env) {
 *     const adapter = payloadAdapter({
 *       do: env.MY_DO.get(env.MY_DO.idFromName('main')),
 *     })
 *     // Use with Payload
 *   }
 * }
 * ```
 */
export function payloadAdapter(config: PayloadAdapterConfig = {}): PayloadAdapterResult {
  return {
    defaultIDType: 'text',
    allowIDOnCreate: true,
    name: 'dotdo',

    init: ({ payload }) => {
      // Placeholder for full implementation
      // This will be implemented in subsequent GREEN tasks
      throw new Error(
        '@dotdo/payload adapter is not yet fully implemented. ' +
          'See issue dotdo-4sd6 (A03 GREEN) and subsequent tasks for implementation progress.'
      )
    },
  }
}

/**
 * Default export for convenience
 */
export default payloadAdapter
