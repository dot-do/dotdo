/**
 * LineageTracker Drizzle Schema - SQLite Schema Definitions
 *
 * Drizzle ORM schema definitions for lineage graph storage with proper
 * indexes for efficient graph traversal operations.
 *
 * @module db/primitives/lineage-tracker/schema
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// =============================================================================
// NODE TYPE ENUM
// =============================================================================

/**
 * Valid node types for the lineage graph.
 *
 * - `'entity'` - A data entity (table, dataset, file)
 * - `'transformation'` - A data transformation (ETL job, query)
 * - `'source'` - An external data source
 * - `'sink'` - An external data sink (destination)
 */
export type NodeType = 'entity' | 'transformation' | 'source' | 'sink'

// =============================================================================
// LINEAGE NODES TABLE
// =============================================================================

/**
 * The lineage_nodes table - stores all entities in the lineage graph.
 *
 * Nodes represent data entities, transformations, sources, and sinks in
 * the data lineage graph. Each node has a unique ID, type, name, optional
 * namespace for grouping, and custom metadata.
 *
 * ## Columns
 *
 * - `id` - Unique identifier (TEXT PRIMARY KEY)
 * - `type` - Node type: entity, transformation, source, or sink
 * - `name` - Human-readable name
 * - `namespace` - Optional grouping (schema, service, etc.)
 * - `metadata` - JSON metadata for custom attributes
 * - `created_at` - Creation timestamp (epoch ms)
 * - `updated_at` - Last update timestamp (epoch ms)
 *
 * @example Direct Drizzle query
 * ```ts
 * import { lineageNodes } from 'dotdo/db/primitives/lineage-tracker/schema'
 * import { eq } from 'drizzle-orm'
 *
 * // Get all transformation nodes
 * const transforms = await db
 *   .select()
 *   .from(lineageNodes)
 *   .where(eq(lineageNodes.type, 'transformation'))
 * ```
 */
export const lineageNodes = sqliteTable(
  'lineage_nodes',
  {
    // Primary key
    id: text('id').primaryKey(),

    // Node type with check constraint
    type: text('type')
      .notNull()
      .$type<NodeType>(),

    // Human-readable name
    name: text('name').notNull(),

    // Optional namespace for grouping (schema, service, etc.)
    namespace: text('namespace'),

    // Custom metadata stored as JSON
    metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),

    // Timestamps (epoch milliseconds)
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Index for filtering by node type
    index('idx_lineage_nodes_type').on(table.type),

    // Index for filtering by namespace
    index('idx_lineage_nodes_namespace').on(table.namespace),

    // Composite index for type + namespace queries
    index('idx_lineage_nodes_type_namespace').on(table.type, table.namespace),

    // Index for name search (partial match queries)
    index('idx_lineage_nodes_name').on(table.name),
  ],
)

// =============================================================================
// LINEAGE EDGES TABLE
// =============================================================================

/**
 * The lineage_edges table - stores relationships between nodes.
 *
 * Edges represent data flows and dependencies between nodes in the lineage
 * graph. Each edge connects a source node to a target node with an operation
 * name describing the transformation.
 *
 * ## Columns
 *
 * - `id` - Unique identifier (TEXT PRIMARY KEY)
 * - `from_node_id` - Source node ID (FK to lineage_nodes)
 * - `to_node_id` - Target node ID (FK to lineage_nodes)
 * - `operation` - Operation/transformation name
 * - `metadata` - JSON metadata for custom attributes
 * - `timestamp` - Edge creation timestamp (epoch ms)
 *
 * ## Foreign Keys
 *
 * Both `from_node_id` and `to_node_id` reference `lineage_nodes(id)` with
 * ON DELETE CASCADE to automatically clean up edges when nodes are deleted.
 *
 * @example Direct Drizzle query
 * ```ts
 * import { lineageEdges, lineageNodes } from 'dotdo/db/primitives/lineage-tracker/schema'
 * import { eq } from 'drizzle-orm'
 *
 * // Get all edges from a specific node
 * const outgoingEdges = await db
 *   .select()
 *   .from(lineageEdges)
 *   .where(eq(lineageEdges.fromNodeId, 'node-123'))
 * ```
 */
export const lineageEdges = sqliteTable(
  'lineage_edges',
  {
    // Primary key
    id: text('id').primaryKey(),

    // Source node (data flows FROM this node)
    fromNodeId: text('from_node_id')
      .notNull()
      .references(() => lineageNodes.id, { onDelete: 'cascade' }),

    // Target node (data flows TO this node)
    toNodeId: text('to_node_id')
      .notNull()
      .references(() => lineageNodes.id, { onDelete: 'cascade' }),

    // Operation or transformation name
    operation: text('operation').notNull(),

    // Custom metadata stored as JSON
    metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),

    // Timestamp when edge was created (epoch milliseconds)
    timestamp: integer('timestamp', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Index for upstream traversal (find all edges TO a node)
    index('idx_lineage_edges_from').on(table.fromNodeId),

    // Index for downstream traversal (find all edges FROM a node)
    index('idx_lineage_edges_to').on(table.toNodeId),

    // Index for filtering by operation
    index('idx_lineage_edges_operation').on(table.operation),

    // Index for time-based queries
    index('idx_lineage_edges_timestamp').on(table.timestamp),

    // Composite index for bidirectional edge lookup
    index('idx_lineage_edges_from_to').on(table.fromNodeId, table.toNodeId),
  ],
)

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/**
 * Type for a selected LineageNode record (all fields).
 *
 * Inferred from the lineageNodes table schema.
 */
export type LineageNodeRecord = typeof lineageNodes.$inferSelect

/**
 * Type for inserting a new LineageNode record.
 *
 * Inferred from the lineageNodes table schema with optional fields marked.
 */
export type NewLineageNodeRecord = typeof lineageNodes.$inferInsert

/**
 * Type for a selected LineageEdge record (all fields).
 *
 * Inferred from the lineageEdges table schema.
 */
export type LineageEdgeRecord = typeof lineageEdges.$inferSelect

/**
 * Type for inserting a new LineageEdge record.
 *
 * Inferred from the lineageEdges table schema with optional fields marked.
 */
export type NewLineageEdgeRecord = typeof lineageEdges.$inferInsert

// =============================================================================
// SQL SCHEMA GENERATION
// =============================================================================

/**
 * SQL statement to create the lineage_nodes table.
 *
 * Note: This is the raw SQL equivalent of the Drizzle schema above.
 * The Drizzle ORM will generate this automatically during migrations.
 */
export const LINEAGE_NODES_SQL = `
CREATE TABLE IF NOT EXISTS lineage_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('entity', 'transformation', 'source', 'sink')),
  name TEXT NOT NULL,
  namespace TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lineage_nodes_type ON lineage_nodes(type);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_namespace ON lineage_nodes(namespace);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_type_namespace ON lineage_nodes(type, namespace);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_name ON lineage_nodes(name);
`

/**
 * SQL statement to create the lineage_edges table.
 *
 * Note: This is the raw SQL equivalent of the Drizzle schema above.
 * The Drizzle ORM will generate this automatically during migrations.
 */
export const LINEAGE_EDGES_SQL = `
CREATE TABLE IF NOT EXISTS lineage_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (from_node_id) REFERENCES lineage_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id) REFERENCES lineage_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lineage_edges_from ON lineage_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_to ON lineage_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_operation ON lineage_edges(operation);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_timestamp ON lineage_edges(timestamp);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_from_to ON lineage_edges(from_node_id, to_node_id);
`

/**
 * Complete SQL schema for lineage tracking.
 *
 * Creates both tables with all indexes. This is equivalent to the
 * LINEAGE_SCHEMA exported from storage.ts but with additional indexes.
 */
export const LINEAGE_DRIZZLE_SCHEMA = `${LINEAGE_NODES_SQL}\n${LINEAGE_EDGES_SQL}`
