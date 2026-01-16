/**
 * Admin Example Worker Entry Point
 *
 * This module exports the AdminDO class for admin.example.org.ai endpoint.
 * It provides schema introspection and admin functionality.
 *
 * @module admin.example.org.ai
 */

// Export AdminDO class for wrangler bindings
export { AdminDO, SchemasAccessor, type AdminDOEnv } from './AdminDO'

// Re-export schema utilities for convenience
export {
  zodToJson,
  SCHEMA_NAMES,
  SCHEMAS,
  type SchemaName,
  type JsonSchema,
  type JsonSchemaField,
} from './schemas'

// Re-export drizzle adapter and types
export {
  DrizzleAdapter,
  type ListOptions,
  type TableAccessor,
  type Noun,
  type NewNoun,
  type Verb,
  type NewVerb,
  type Action,
  type NewAction,
  type Relationship,
  type NewRelationship,
  type Function,
  type NewFunction,
} from './db'

// Import for default export
import { AdminDO, type AdminDOEnv } from './AdminDO'

// ============================================================================
// Default Worker Export
// ============================================================================

export default {
  async fetch(request: Request, env: AdminDOEnv): Promise<Response> {
    const url = new URL(request.url)

    // Route based on hostname prefix or use default
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.AdminDO.idFromName(ns)
    const stub = env.AdminDO.get(id)

    return stub.fetch(request)
  },
}
