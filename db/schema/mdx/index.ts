/**
 * MDX Schema Parser Module
 *
 * Parse DB.mdx schema files into structured schema definitions.
 *
 * @example
 * ```typescript
 * import { parseMdxSchema, discoverSchemaFiles, loadAndMergeSchemas } from 'dotdo/db/schema/mdx'
 *
 * // Parse a single MDX file
 * const schema = parseMdxSchema(`
 * ---
 * title: My Schema
 * ---
 *
 * ## User
 *
 * | Field | Type | Description |
 * |-------|------|-------------|
 * | name | string | User's name |
 * | posts | \`[->Post]\` | User's posts |
 *
 * ### States
 * - active -> suspended -> deleted
 * `)
 *
 * // Discover all schema files in a project
 * const files = await discoverSchemaFiles('/path/to/project')
 *
 * // Load and merge all schema files
 * const merged = await loadAndMergeSchemas('/path/to/project')
 * ```
 *
 * @module
 */

// ============================================================================
// Parser
// ============================================================================

export {
  parseMdxSchema,
  type MdxSchema,
  type MdxEntity,
  type MdxFieldType,
} from './parser'

// ============================================================================
// Discovery
// ============================================================================

export {
  discoverSchemaFiles,
  loadAndMergeSchemas,
  type DiscoveryOptions,
  type MergedMdxSchema,
} from './discover'
