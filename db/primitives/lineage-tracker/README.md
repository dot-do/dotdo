# LineageTracker

A foundational primitive for tracking data lineage, dependencies, and provenance across the dotdo platform.

## Overview

LineageTracker enables understanding of how data flows through your system, what transformations were applied, and maintaining audit trails for compliance and debugging.

### Key Capabilities

- **Track data origins and transformations** - Record where data comes from and how it changes
- **Build dependency graphs** - Understand relationships between entities
- **Impact analysis** - Answer "what breaks if X changes?"
- **Audit/compliance support** - Maintain provenance trails with time-travel queries
- **Cache invalidation** - Know what to invalidate when sources change
- **Cross-system lineage** - Stitch lineage across databases, warehouses, and BI tools
- **Visualization** - Export to DOT, Mermaid, D3, PlantUML, Cytoscape, ASCII, and OpenLineage

## Quick Start

```typescript
import { createLineageTracker } from 'dotdo/db/primitives/lineage-tracker'

// Create tracker with SQLite storage (in a Durable Object)
const tracker = createLineageTracker(ctx.storage.sql)

// Create nodes representing data entities
const rawEvents = tracker.createNode({
  type: 'source',
  name: 'raw_events',
  namespace: 'warehouse',
})

const aggregator = tracker.createNode({
  type: 'transformation',
  name: 'aggregate_events',
  metadata: { sql: 'SELECT event_type, COUNT(*) FROM events GROUP BY 1' },
})

const summary = tracker.createNode({
  type: 'sink',
  name: 'event_summary',
  namespace: 'warehouse',
})

// Create edges representing data flow
tracker.createEdge({
  fromNodeId: rawEvents.id,
  toNodeId: aggregator.id,
  operation: 'read',
})

tracker.createEdge({
  fromNodeId: aggregator.id,
  toNodeId: summary.id,
  operation: 'write',
})

// Query lineage
const upstream = tracker.getUpstream(summary.id)
console.log('Summary depends on:', upstream.nodes.map(n => n.name))

// Impact analysis
const impact = tracker.analyzeImpact(rawEvents.id)
console.log(`Changing raw_events affects ${impact.totalAffected} nodes`)
```

## Core Concepts

### Nodes

Nodes represent data entities in your lineage graph. Each node has a type:

| Type | Description | Example |
|------|-------------|---------|
| `source` | External data origins | APIs, databases, files |
| `transformation` | Processing steps | ETL jobs, SQL queries, functions |
| `entity` | Intermediate data artifacts | Tables, views, cached datasets |
| `sink` | Final destinations | Dashboards, exports, notifications |

```typescript
interface LineageNode {
  id: string
  type: 'entity' | 'transformation' | 'source' | 'sink'
  name: string
  namespace?: string  // For grouping (e.g., schema, service)
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
```

### Edges

Edges represent data flow or dependencies between nodes:

```typescript
interface LineageEdge {
  id: string
  fromNodeId: string  // Data flows FROM this node
  toNodeId: string    // Data flows TO this node
  operation: string   // E.g., 'read', 'write', 'transform', 'derive'
  metadata: Record<string, unknown>
  timestamp: number
}
```

### Graphs

Query results return a graph containing nodes and edges:

```typescript
interface LineageGraph {
  nodes: LineageNode[]
  edges: LineageEdge[]
  rootId: string  // The node that was queried
}
```

## API Reference

### Creating and Managing Nodes

```typescript
// Create a node
const node = tracker.createNode({
  type: 'entity',
  name: 'users',
  namespace: 'warehouse',
  metadata: { owner: 'data-team' }
})

// Get a node by ID
const found = tracker.getNode(node.id)

// Update a node
tracker.updateNode(node.id, { name: 'customers' })

// Delete a node (cascades to edges)
tracker.deleteNode(node.id)

// Find nodes by criteria
const sources = tracker.findNodes({ type: 'source' })
const warehouseNodes = tracker.findNodes({ namespace: 'warehouse' })
const userNodes = tracker.findNodes({ nameContains: 'user' })

// Bulk create
tracker.createNodes([
  { type: 'entity', name: 'orders' },
  { type: 'entity', name: 'products' },
])
```

### Creating and Managing Edges

```typescript
// Create an edge
const edge = tracker.createEdge({
  fromNodeId: source.id,
  toNodeId: target.id,
  operation: 'transform',
  metadata: { rowsProcessed: 1000 }
})

// Get an edge by ID
const found = tracker.getEdge(edge.id)

// Delete an edge
tracker.deleteEdge(edge.id)

// Find edges by criteria
const readEdges = tracker.findEdges({ operation: 'read' })
const fromSource = tracker.findEdges({ fromNodeId: source.id })
```

### Lineage Queries

```typescript
// Get upstream dependencies (what does X depend on)
const upstream = tracker.getUpstream(nodeId)

// Get downstream dependents (what depends on X)
const downstream = tracker.getDownstream(nodeId)

// Get full lineage in both directions
const fullLineage = tracker.getFullLineage(nodeId)

// Find all paths between two nodes
const paths = tracker.findPaths(fromId, toId)

// Get immediate parents/children (one hop)
const parents = tracker.getParents(nodeId)
const children = tracker.getChildren(nodeId)

// Get root/leaf nodes
const roots = tracker.getRootNodes()  // No incoming edges
const leaves = tracker.getLeafNodes() // No outgoing edges
```

#### Traversal Options

```typescript
// Limit traversal depth
const shallow = tracker.getUpstream(nodeId, { maxDepth: 2 })

// Filter by node type
const sourcesOnly = tracker.getUpstream(nodeId, { nodeTypes: ['source'] })

// Exclude metadata for performance
const minimal = tracker.getDownstream(nodeId, { includeMetadata: false })
```

### Impact Analysis

Impact analysis answers the question: "If X changes, what else is affected?"

```typescript
// Full impact analysis
const impact = tracker.analyzeImpact(sourceId)

console.log(`Source: ${impact.sourceNode.name}`)
console.log(`Total affected: ${impact.totalAffected}`)

// Affected nodes are sorted by distance
for (const affected of impact.affectedNodes) {
  console.log(`  ${affected.node.name}:`)
  console.log(`    Distance: ${affected.distance} hops`)
  console.log(`    Impact: ${affected.impact}`) // 'direct' or 'indirect'
  console.log(`    Path count: ${affected.pathCount}`)
}

// Blast radius metrics
console.log('Metrics:', impact.metrics)
// { totalAffected, byDepth, byType, maxDepth, criticalPathCount }

// Critical paths (longest dependency chains)
for (const path of impact.criticalPaths) {
  console.log('Critical path:', path.nodeIds.join(' -> '))
}
```

#### Impact Analysis Options

```typescript
// Limit analysis depth
const shallow = tracker.analyzeImpact(nodeId, { maxDepth: 3 })

// Filter to specific types
const sinksOnly = tracker.analyzeImpact(nodeId, { nodeTypes: ['sink'] })

// Exclude indirect impacts
const directOnly = tracker.analyzeImpact(nodeId, { includeIndirect: false })
```

### Convenience Methods

```typescript
// Record a complete transformation in one call
const { source, target, edge } = tracker.record({
  source: { type: 'source', name: 'api_events' },
  target: { type: 'entity', name: 'processed_events' },
  operation: 'ingest',
  metadata: { batchSize: 1000 }
})

// Or reference existing nodes by ID
tracker.record({
  source: existingNode.id,
  target: { type: 'sink', name: 'dashboard' },
  operation: 'materialize'
})

// Get graph statistics
const stats = tracker.getStats()
// { nodeCount, nodesByType, edgeCount, rootCount, leafCount, avgConnectivity }

// Clear all data
tracker.clear()
```

## Visualization & Export

LineageTracker supports exporting graphs to multiple formats for visualization.

### DOT (Graphviz)

```typescript
const graph = tracker.getFullLineage(nodeId)
const dot = tracker.exportToDot(graph, {
  title: 'Data Pipeline',
  rankdir: 'LR',  // Left-to-right layout
  includeMetadata: true
})

// Save and render with: dot -Tpng lineage.dot -o lineage.png
```

### Mermaid

```typescript
const graph = tracker.getDownstream(sourceId)
const mermaid = tracker.exportToMermaid(graph, {
  direction: 'TB',
  includeOperations: true
})

// Embed in Markdown:
// ```mermaid
// ${mermaid}
// ```
```

### D3.js

```typescript
const graph = tracker.getFullLineage(nodeId)
const d3Data = tracker.exportToD3(graph)

// d3Data.nodes: [{ id, name, type, group, ... }]
// d3Data.links: [{ source, target, operation, value, ... }]

// Use with d3.forceSimulation() for interactive graphs
```

### ASCII (Terminal)

```typescript
const graph = tracker.getDownstream(sourceId)
console.log(tracker.exportToAscii(graph))

// Output:
// +------------+     +-------------+     +-----------+
// | Raw Events | --> | Aggregation | --> | Dashboard |
// | [source]   |     | [transform] |     | [sink]    |
// +------------+     +-------------+     +-----------+
```

### Additional Formats

```typescript
const exporter = tracker.getExporter()

// PlantUML
const plantuml = exporter.toPlantUML(graph)

// Cytoscape.js
const cyto = exporter.toCytoscape(graph)

// JSON
const json = tracker.exportToJSON(graph)
```

### OpenLineage Export

Export to the industry-standard OpenLineage format for interoperability with data catalogs like Marquez, DataHub, and Atlan:

```typescript
const graph = tracker.getFullLineage('transform-1')
const events = tracker.exportToOpenLineage(graph, {
  namespace: 'warehouse',
  producer: 'https://my-org/my-app',
})

// Send to OpenLineage-compatible endpoint
for (const event of events) {
  await fetch('https://marquez.example.com/api/v1/lineage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
}

// Or export as NDJSON for streaming
const ndjson = tracker.exportToOpenLineageNDJSON(graph)
await kafka.send({ topic: 'lineage', messages: ndjson.split('\n') })
```

## Time-Travel Queries

Query historical lineage state using the event-sourced time-travel store:

```typescript
import { createTimeTravelStore } from 'dotdo/db/primitives/lineage-tracker'

// Create time-travel store
const timeTravel = createTimeTravelStore(ctx.storage.sql, {
  trackPreviousState: true,  // Enable rollback capability
})

// Get lineage as it existed at a specific point in time
const pastGraph = timeTravel.getLineageAt(assetId, timestamp)

// Get change history for an entity
const history = timeTravel.getEntityHistory(nodeId, startTime, endTime)

// Calculate diff between two points in time
const diff = timeTravel.diffLineage(t1, t2)
console.log(`Changes: ${diff.summary.totalChanges}`)
console.log(`Nodes added: ${diff.nodesAdded.map(n => n.name)}`)
console.log(`Nodes removed: ${diff.nodesRemoved.map(n => n.name)}`)

// Find when a dependency was established
const firstSeen = timeTravel.findDependencyStartTime(sourceId, targetId)
```

### Recording Changes

The time-travel store automatically records events when used with the LineageTracker:

```typescript
// Record events manually for audit purposes
timeTravel.recordNodeCreated(node, 'user@example.com', 'Initial creation')
timeTravel.recordNodeUpdated(oldNode, newNode, 'system', 'Schema migration')
timeTravel.recordNodeDeleted(node, 'admin', 'Deprecated table')
```

## Cross-System Lineage

Track lineage across multiple systems and stitch them together:

```typescript
import {
  createCrossSystemLineageTracker,
  BaseSystemAdapter
} from 'dotdo/db/primitives/lineage-tracker'

// Create cross-system tracker
const crossSystem = createCrossSystemLineageTracker({
  minConfidence: 0.7,
  fuzzyMatching: true,
})

// Register system adapters
crossSystem.registerSystem(new PostgresAdapter({
  id: 'main-db',
  type: 'postgres',
  category: 'source_database',
  // ...connection config
}))

crossSystem.registerSystem(new DuckDBAdapter({
  id: 'analytics',
  type: 'duckdb',
  category: 'warehouse',
}))

// Sync metadata from all systems
await crossSystem.syncAll()

// Stitch lineage across systems
const result = crossSystem.stitchLineage()
console.log(`Matched ${result.stats.matched} cross-system edges`)
console.log(`Avg confidence: ${result.stats.avgConfidence}`)

// Query end-to-end lineage
const lineage = crossSystem.getEndToEndLineage(
  'db://duckdb/analytics/daily_summary',
  { direction: 'upstream', maxDepth: 10 }
)
```

### Custom System Adapters

Implement adapters for your specific systems:

```typescript
class MySystemAdapter extends BaseSystemAdapter {
  async extractAssets(): Promise<CrossSystemAsset[]> {
    // Query your system for assets
    const tables = await this.connection.getTables()
    return tables.map(t => this.createCrossSystemAsset(
      `db://${this.info.id}/${t.schema}/${t.name}`,
      'table',
      t.name,
      t.fqn
    ))
  }

  async extractLineage(): Promise<CrossSystemEdge[]> {
    // Extract lineage relationships
    const deps = await this.connection.getDependencies()
    return deps.map(d => this.createCrossSystemEdge(
      d.sourceUrn,
      d.targetUrn,
      { transformationType: d.type }
    ))
  }

  async getAsset(identifier: string): Promise<CrossSystemAsset | null> {
    // Lookup specific asset
  }

  async healthCheck(): Promise<boolean> {
    return this.connection.ping()
  }
}
```

## Integration with $ Workflow Context

LineageTracker can automatically record lineage for workflow operations:

```typescript
// Future integration (coming soon)
$.do(async ($) => {
  // Actions automatically recorded in lineage
  const data = await $.read('source-table')
  const processed = await $.transform(data, aggregator)
  await $.write('destination-table', processed)
})

// Lineage is captured:
// source-table -> aggregator -> destination-table
```

## Real-World Examples

### Example 1: ETL Pipeline Tracking

Track a complete ETL pipeline from source systems to warehouse:

```typescript
// Model an ETL pipeline
const sources = tracker.createNodes([
  { type: 'source', name: 'salesforce_leads', namespace: 'crm' },
  { type: 'source', name: 'hubspot_contacts', namespace: 'marketing' },
])

const merge = tracker.createNode({
  type: 'transformation',
  name: 'merge_customer_data',
  metadata: {
    sql: 'SELECT ... UNION ALL ...',
    schedule: 'daily',
    owner: 'data-team'
  }
})

const customers = tracker.createNode({
  type: 'entity',
  name: 'dim_customers',
  namespace: 'warehouse'
})

// Record data flow
for (const source of sources) {
  tracker.createEdge({
    fromNodeId: source.id,
    toNodeId: merge.id,
    operation: 'read'
  })
}

tracker.createEdge({
  fromNodeId: merge.id,
  toNodeId: customers.id,
  operation: 'materialize'
})

// Later: what sources power the customers table?
const upstream = tracker.getUpstream(customers.id)
// Returns: salesforce_leads, hubspot_contacts, merge_customer_data

// Visualize the pipeline
const mermaid = tracker.exportToMermaid(upstream)
console.log(mermaid)
// graph TB
//   salesforce_leads[(salesforce_leads)]
//   hubspot_contacts[(hubspot_contacts)]
//   merge_customer_data(merge_customer_data)
//   dim_customers[dim_customers]
//   salesforce_leads -->|read| merge_customer_data
//   hubspot_contacts -->|read| merge_customer_data
//   merge_customer_data -->|materialize| dim_customers
```

### Example 2: Audit Trail for Compliance

Track data processing for GDPR/compliance requirements:

```typescript
// Track data processing for compliance
const transaction = tracker.record({
  source: {
    type: 'source',
    name: 'pii_data',
    metadata: { classification: 'sensitive', gdprApplicable: true }
  },
  target: {
    type: 'transformation',
    name: 'anonymize',
    metadata: { algorithm: 'k-anonymity', k: 5 }
  },
  operation: 'process',
  metadata: {
    operator: 'data-privacy-job',
    timestamp: new Date().toISOString(),
    auditId: 'AUDIT-2024-001'
  }
})

tracker.record({
  source: transaction.target.id,
  target: {
    type: 'sink',
    name: 'analytics_dataset',
    metadata: { classification: 'internal' }
  },
  operation: 'export',
  metadata: { destination: 's3://analytics/' }
})

// For compliance audits: trace all processing of PII data
const piiLineage = tracker.getDownstream(transaction.source.id)

// Export audit trail
const auditReport = {
  dataSource: transaction.source,
  processingSteps: piiLineage.nodes.filter(n => n.type === 'transformation'),
  destinations: piiLineage.nodes.filter(n => n.type === 'sink'),
  edges: piiLineage.edges,
  exportedAt: new Date().toISOString()
}

// Export to OpenLineage for external audit tools
const openLineageEvents = tracker.exportToOpenLineage(piiLineage, {
  namespace: 'compliance',
  includeOwnership: true,
  includeDocumentation: true,
})
```

### Example 3: Cache Invalidation

Automatically invalidate caches when upstream data changes:

```typescript
// When a source changes, what caches need invalidation?
async function invalidateDownstreamCaches(sourceId: string) {
  const impact = tracker.analyzeImpact(sourceId)

  const invalidated: string[] = []

  for (const affected of impact.affectedNodes) {
    if (affected.node.metadata.cacheKey) {
      await cache.invalidate(affected.node.metadata.cacheKey as string)
      invalidated.push(affected.node.name)
    }
  }

  console.log(`Invalidated ${invalidated.length} caches:`, invalidated)
  return {
    totalAffected: impact.totalAffected,
    cachesInvalidated: invalidated.length,
    blastRadius: impact.metrics.maxDepth
  }
}

// Example: user table changes, invalidate all dependent caches
await invalidateDownstreamCaches('users-table-id')
// Output: Invalidated 5 caches: ['user-profile-cache', 'dashboard-cache', ...]
```

### Example 4: Debugging Data Flow Issues

Trace why a dashboard shows unexpected data:

```typescript
// Trace why a dashboard shows unexpected data
const dashboard = tracker.findNodes({ name: 'revenue_dashboard' })[0]
const upstream = tracker.getUpstream(dashboard.id)

console.log('=== Data Flow Debug Report ===\n')

console.log('Data sources powering the dashboard:')
for (const node of upstream.nodes) {
  if (node.type === 'source') {
    console.log(`  - ${node.name} (${node.namespace})`)
    if (node.metadata.lastUpdated) {
      console.log(`    Last updated: ${node.metadata.lastUpdated}`)
    }
  }
}

console.log('\nTransformations applied:')
for (const node of upstream.nodes) {
  if (node.type === 'transformation') {
    console.log(`  - ${node.name}`)
    if (node.metadata.sql) {
      console.log(`    SQL: ${node.metadata.sql}`)
    }
    if (node.metadata.schedule) {
      console.log(`    Schedule: ${node.metadata.schedule}`)
    }
  }
}

// Find all paths from sources to dashboard
const sources = upstream.nodes.filter(n => n.type === 'source')
for (const source of sources) {
  const paths = tracker.findPaths(source.id, dashboard.id)
  console.log(`\nPaths from ${source.name} to dashboard:`)
  for (const path of paths) {
    const nodeNames = path.nodeIds.map(id => {
      const n = upstream.nodes.find(n => n.id === id)
      return n?.name ?? id
    })
    console.log(`  ${nodeNames.join(' -> ')}`)
  }
}

// Export visual debug diagram
const ascii = tracker.exportToAscii(upstream)
console.log('\n=== Visual Flow ===\n')
console.log(ascii)
```

### Example 5: Data Quality Monitoring

Track data quality metrics along the lineage:

```typescript
// Add data quality metadata to nodes
const rawData = tracker.createNode({
  type: 'source',
  name: 'orders_raw',
  metadata: {
    rowCount: 1_000_000,
    nullPercentage: { orderId: 0, customerId: 0.1, amount: 0.05 },
    lastValidated: new Date().toISOString()
  }
})

const cleanedData = tracker.createNode({
  type: 'entity',
  name: 'orders_cleaned',
  metadata: {
    rowCount: 995_000,  // 5k rows dropped
    nullPercentage: { orderId: 0, customerId: 0, amount: 0 },
    droppedRows: 5000,
    droppedReason: 'null customerId or amount'
  }
})

tracker.createEdge({
  fromNodeId: rawData.id,
  toNodeId: cleanedData.id,
  operation: 'clean',
  metadata: {
    rowsIn: 1_000_000,
    rowsOut: 995_000,
    rowsDropped: 5000
  }
})

// Query data quality across lineage
function getDataQualityReport(nodeId: string) {
  const upstream = tracker.getUpstream(nodeId)

  return upstream.edges.map(edge => {
    const source = upstream.nodes.find(n => n.id === edge.fromNodeId)
    const target = upstream.nodes.find(n => n.id === edge.toNodeId)
    return {
      step: `${source?.name} -> ${target?.name}`,
      operation: edge.operation,
      rowsIn: edge.metadata.rowsIn,
      rowsOut: edge.metadata.rowsOut,
      dropRate: edge.metadata.rowsDropped
        ? `${((edge.metadata.rowsDropped as number) / (edge.metadata.rowsIn as number) * 100).toFixed(2)}%`
        : 'N/A'
    }
  })
}
```

## Performance Considerations

### Indexing

LineageTracker creates indexes on:
- `lineage_nodes(type)` - Fast type filtering
- `lineage_nodes(namespace)` - Fast namespace queries
- `lineage_nodes(type, namespace)` - Composite index for common queries
- `lineage_edges(from_node_id)` - Fast downstream traversal
- `lineage_edges(to_node_id)` - Fast upstream traversal
- `lineage_edges(operation)` - Fast operation filtering
- `lineage_edges(timestamp)` - Fast time-based queries
- `lineage_edges(from_node_id, to_node_id)` - Fast bidirectional edge lookup

### Large Graphs

For graphs with 10,000+ nodes:

1. **Use depth limits**: `getUpstream(id, { maxDepth: 5 })`
2. **Filter by type**: `getDownstream(id, { nodeTypes: ['sink'] })`
3. **Exclude metadata**: `{ includeMetadata: false }`
4. **Paginate queries**: `findNodes({ limit: 100, offset: 0 })`
5. **Use blast radius first**: Check `getBlastRadius()` before full `analyzeImpact()`

### Cycle Detection

By default, LineageTracker prevents cycles in the graph. This check has O(V+E) complexity. For performance-critical insertions where you've verified no cycles exist:

```typescript
const tracker = createLineageTracker(sql, {
  detectCycles: false  // Disable cycle detection
})
```

### Batch Operations

For bulk imports, use batch methods:

```typescript
// Batch create nodes (faster than individual creates)
const nodes = tracker.createNodes([
  { type: 'entity', name: 'table1' },
  { type: 'entity', name: 'table2' },
  // ... hundreds more
])

// Batch create edges
tracker.createEdges(edgeInputs)
```

## Configuration

```typescript
const tracker = createLineageTracker(sql, {
  // ID generation
  autoGenerateIds: true,  // Auto-generate IDs if not provided
  idPrefix: 'ln',         // Prefix for generated IDs

  // Safety
  detectCycles: true,     // Prevent cycles (recommended)

  // Limits
  maxTraversalDepth: 100  // Maximum graph traversal depth
})
```

### Time-Travel Configuration

```typescript
const timeTravel = createTimeTravelStore(sql, {
  idPrefix: 'evt',           // Prefix for event IDs
  maxEventRetention: 0,      // 0 = unlimited retention
  trackPreviousState: true   // Enable rollback capability
})
```

### Cross-System Configuration

```typescript
const crossSystem = createCrossSystemLineageTracker({
  minConfidence: 0.7,      // Minimum match confidence (0-1)
  fuzzyMatching: true,     // Enable fuzzy name matching
  maxCandidates: 10,       // Max candidates per asset
  customRules: [           // Custom matching rules
    {
      name: 'pg-to-duckdb',
      sourcePattern: 'pg://.*',
      targetPattern: 'duckdb://.*',
      confidence: 0.9
    }
  ]
})
```

## Troubleshooting

### "Edge would create a cycle"

The graph must be a DAG (directed acyclic graph). Check your edge direction:
- Edges flow from source to target
- `fromNodeId` produces data
- `toNodeId` consumes data

### "Source/Target node not found"

Ensure nodes exist before creating edges:

```typescript
// Wrong: creating edge before nodes exist
tracker.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 'x' })

// Right: create nodes first
const a = tracker.createNode({ type: 'source', name: 'A' })
const b = tracker.createNode({ type: 'sink', name: 'B' })
tracker.createEdge({ fromNodeId: a.id, toNodeId: b.id, operation: 'x' })
```

### Graph too large to export

Use filtering to reduce graph size:

```typescript
// Get only direct dependencies
const graph = tracker.getUpstream(nodeId, { maxDepth: 1 })

// Get only specific types
const sinks = tracker.getDownstream(nodeId, { nodeTypes: ['sink'] })
```

### Cross-system stitching not finding matches

Check these common issues:

1. **Naming conventions differ**: Enable fuzzy matching
2. **Different namespaces**: Configure custom matching rules
3. **Low confidence threshold**: Reduce `minConfidence` temporarily to see candidates
4. **Assets not synced**: Run `syncAll()` before stitching

```typescript
// Debug stitching candidates
const candidates = crossSystem.findStitchingCandidates()
for (const c of candidates) {
  console.log(`${c.source.name} <-> ${c.target.name}: ${c.confidence}`)
  console.log('  Evidence:', c.evidence.map(e => e.description))
}
```

### Time-travel queries returning empty results

1. Ensure events are being recorded
2. Check the timestamp is correct (use epoch milliseconds)
3. Verify the event store was initialized

```typescript
// Debug time-travel state
console.log('Event count:', timeTravel.getEventCount())
console.log('Earliest:', new Date(timeTravel.getEarliestTimestamp() ?? 0))
console.log('Latest:', new Date(timeTravel.getLatestTimestamp() ?? 0))
```

## Advanced Features

### SQL Lineage Parser

Parse SQL queries to automatically extract lineage:

```typescript
import { parseSqlLineage } from 'dotdo/db/primitives/lineage-tracker'

const sql = `
  INSERT INTO summary
  SELECT a.id, b.value
  FROM tableA a
  JOIN tableB b ON a.id = b.id
  WHERE b.active = true
`

const lineage = parseSqlLineage(sql)
console.log('Sources:', lineage.sources)  // ['tableA', 'tableB']
console.log('Targets:', lineage.targets)  // ['summary']
console.log('Columns:', lineage.columnMappings)
```

### Column-Level Lineage

Track lineage at the column level:

```typescript
import { extractColumnLineage } from 'dotdo/db/primitives/lineage-tracker'

const schema = {
  orders: { id: 'int', customer_id: 'int', amount: 'decimal' },
  customers: { id: 'int', name: 'string' }
}

const sql = `
  SELECT o.id, c.name, o.amount
  FROM orders o
  JOIN customers c ON o.customer_id = c.id
`

const columnLineage = extractColumnLineage(sql, schema)
// Maps output columns to their source columns
```

### Visualization API

Advanced visualization with layout algorithms:

```typescript
import {
  createVisualization,
  layoutGraph,
  filterGraph
} from 'dotdo/db/primitives/lineage-tracker'

const graph = tracker.getFullLineage(nodeId)

// Apply layout algorithm
const positioned = layoutGraph(graph, { algorithm: 'dagre' })

// Filter to specific subgraph
const filtered = filterGraph(graph, {
  nodeTypes: ['source', 'sink'],
  minDepth: 1,
  maxDepth: 5
})

// Fluent builder API
const viz = createVisualization(graph)
  .layout('dagre')
  .filter({ nodeTypes: ['transformation'] })
  .highlight([nodeId])
  .export('mermaid')
```

## Related Primitives

- [Business Event Store](../business-event-store/) - Event sourcing with causality tracking
- [DAG Scheduler](../dag-scheduler/) - Workflow orchestration with dependencies
- [Semantic Layer](../semantic-layer/) - Metrics and dimensions with lineage
- [Data Contracts](../contracts/) - Schema validation with lineage integration
