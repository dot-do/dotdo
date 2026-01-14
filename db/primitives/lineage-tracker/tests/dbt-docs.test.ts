/**
 * dbt Docs Export Tests
 *
 * Test suite for dbt-compatible documentation generation including:
 * - catalog.json generation with table/column metadata
 * - manifest.json generation with DAG structure
 * - Docs bundle generation
 * - Lineage graph export for visualization
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbtDocsExporter,
  DbtDocsExporter,
  type DbtCatalog,
  type DbtManifest,
  type DbtDocsBundle,
} from '../dbt-docs'
import { createLineageStore, type LineageStore, type SqlExecutor } from '../storage'
import type { LineageGraph, LineageNode, LineageEdge } from '../types'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Creates an in-memory SQLite database compatible with our SqlExecutor interface
 */
function createTestDb(): SqlExecutor {
  const db = new Database(':memory:')
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        bind: (...args: unknown[]) => ({
          all: () => stmt.all(...args),
          run: () => stmt.run(...args),
          first: () => stmt.get(...args),
        }),
      }
    },
  }
}

/**
 * Creates a simple test lineage graph
 */
function createSimpleGraph(): LineageGraph {
  const nodes: LineageNode[] = [
    {
      id: 'source-1',
      type: 'source',
      name: 'raw_orders',
      namespace: 'staging',
      metadata: {
        description: 'Raw orders from external system',
        columns: [
          { name: 'id', type: 'INTEGER', description: 'Order ID' },
          { name: 'customer_id', type: 'INTEGER', description: 'Customer ID' },
          { name: 'amount', type: 'DECIMAL', description: 'Order amount' },
        ],
        rowCount: 10000,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'transform-1',
      type: 'transformation',
      name: 'stg_orders',
      namespace: 'staging',
      metadata: {
        description: 'Cleaned and staged orders',
        sql: 'SELECT id, customer_id, amount FROM raw_orders WHERE amount > 0',
        materialized: 'view',
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'customer_id', type: 'INTEGER' },
          { name: 'amount', type: 'DECIMAL' },
        ],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'entity-1',
      type: 'entity',
      name: 'fct_orders',
      namespace: 'marts',
      metadata: {
        description: 'Fact table for orders analysis',
        materialized: 'table',
        tags: ['core', 'finance'],
        outputSchema: {
          fields: [
            { name: 'order_id', type: 'INTEGER', description: 'Unique order identifier' },
            { name: 'customer_id', type: 'INTEGER', description: 'Customer reference' },
            { name: 'total_amount', type: 'DECIMAL', description: 'Order total' },
            { name: 'order_date', type: 'DATE', description: 'When order was placed' },
          ],
        },
        rowCount: 5000,
        bytes: 2048000,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'sink-1',
      type: 'sink',
      name: 'orders_dashboard',
      namespace: 'exposures',
      metadata: {
        description: 'Executive orders dashboard',
        exposureType: 'dashboard',
        owner: 'Analytics Team',
        ownerEmail: 'analytics@example.com',
        url: 'https://bi.example.com/dashboards/orders',
        maturity: 'high',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]

  const edges: LineageEdge[] = [
    {
      id: 'edge-1',
      fromNodeId: 'source-1',
      toNodeId: 'transform-1',
      operation: 'read',
      metadata: {},
      timestamp: Date.now(),
    },
    {
      id: 'edge-2',
      fromNodeId: 'transform-1',
      toNodeId: 'entity-1',
      operation: 'transform',
      metadata: {},
      timestamp: Date.now(),
    },
    {
      id: 'edge-3',
      fromNodeId: 'entity-1',
      toNodeId: 'sink-1',
      operation: 'expose',
      metadata: {},
      timestamp: Date.now(),
    },
  ]

  return {
    nodes,
    edges,
    rootId: 'source-1',
  }
}

/**
 * Creates a complex graph with multiple sources and branches
 */
function createComplexGraph(): LineageGraph {
  const nodes: LineageNode[] = [
    // Sources
    {
      id: 'src-orders',
      type: 'source',
      name: 'orders',
      namespace: 'raw',
      metadata: {
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'customer_id', type: 'INTEGER' },
          { name: 'product_id', type: 'INTEGER' },
          { name: 'amount', type: 'DECIMAL' },
          { name: 'created_at', type: 'TIMESTAMP' },
        ],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'src-customers',
      type: 'source',
      name: 'customers',
      namespace: 'raw',
      metadata: {
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'VARCHAR' },
          { name: 'email', type: 'VARCHAR' },
          { name: 'segment', type: 'VARCHAR' },
        ],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'src-products',
      type: 'source',
      name: 'products',
      namespace: 'raw',
      metadata: {
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'VARCHAR' },
          { name: 'category', type: 'VARCHAR' },
          { name: 'price', type: 'DECIMAL' },
        ],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    // Staging transforms
    {
      id: 'stg-orders',
      type: 'transformation',
      name: 'stg_orders',
      namespace: 'staging',
      metadata: {
        materialized: 'view',
        sql: 'SELECT * FROM raw.orders',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'stg-customers',
      type: 'transformation',
      name: 'stg_customers',
      namespace: 'staging',
      metadata: {
        materialized: 'view',
        sql: 'SELECT * FROM raw.customers',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'stg-products',
      type: 'transformation',
      name: 'stg_products',
      namespace: 'staging',
      metadata: {
        materialized: 'view',
        sql: 'SELECT * FROM raw.products',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    // Intermediate models
    {
      id: 'int-order-items',
      type: 'entity',
      name: 'int_order_items',
      namespace: 'intermediate',
      metadata: {
        materialized: 'table',
        sql: 'SELECT o.*, p.name as product_name, p.category FROM stg_orders o JOIN stg_products p ON o.product_id = p.id',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    // Mart models
    {
      id: 'fct-orders',
      type: 'entity',
      name: 'fct_orders',
      namespace: 'marts',
      metadata: {
        materialized: 'table',
        tags: ['core'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'dim-customers',
      type: 'entity',
      name: 'dim_customers',
      namespace: 'marts',
      metadata: {
        materialized: 'table',
        tags: ['core'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    // Exposures
    {
      id: 'exp-dashboard',
      type: 'sink',
      name: 'sales_dashboard',
      namespace: 'exposures',
      metadata: {
        exposureType: 'dashboard',
        owner: 'Sales Team',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]

  const edges: LineageEdge[] = [
    // Source to staging
    { id: 'e1', fromNodeId: 'src-orders', toNodeId: 'stg-orders', operation: 'read', metadata: {}, timestamp: Date.now() },
    { id: 'e2', fromNodeId: 'src-customers', toNodeId: 'stg-customers', operation: 'read', metadata: {}, timestamp: Date.now() },
    { id: 'e3', fromNodeId: 'src-products', toNodeId: 'stg-products', operation: 'read', metadata: {}, timestamp: Date.now() },
    // Staging to intermediate
    { id: 'e4', fromNodeId: 'stg-orders', toNodeId: 'int-order-items', operation: 'transform', metadata: {}, timestamp: Date.now() },
    { id: 'e5', fromNodeId: 'stg-products', toNodeId: 'int-order-items', operation: 'transform', metadata: {}, timestamp: Date.now() },
    // Intermediate/staging to marts
    { id: 'e6', fromNodeId: 'int-order-items', toNodeId: 'fct-orders', operation: 'transform', metadata: {}, timestamp: Date.now() },
    { id: 'e7', fromNodeId: 'stg-customers', toNodeId: 'dim-customers', operation: 'transform', metadata: {}, timestamp: Date.now() },
    // Marts to exposures
    { id: 'e8', fromNodeId: 'fct-orders', toNodeId: 'exp-dashboard', operation: 'expose', metadata: {}, timestamp: Date.now() },
    { id: 'e9', fromNodeId: 'dim-customers', toNodeId: 'exp-dashboard', operation: 'expose', metadata: {}, timestamp: Date.now() },
  ]

  return {
    nodes,
    edges,
    rootId: 'src-orders',
  }
}

// =============================================================================
// CATALOG GENERATION TESTS
// =============================================================================

describe('DbtDocsExporter - Catalog Generation', () => {
  let exporter: DbtDocsExporter

  beforeEach(() => {
    exporter = createDbtDocsExporter()
  })

  it('should generate valid catalog structure', () => {
    const graph = createSimpleGraph()
    const catalog = exporter.toCatalog(graph, { projectName: 'test_project' })

    expect(catalog.metadata).toBeDefined()
    expect(catalog.metadata.dbt_schema_version).toContain('schemas.getdbt.com')
    expect(catalog.metadata.generated_at).toBeDefined()
    expect(catalog.metadata.invocation_id).toBeDefined()
    expect(catalog.nodes).toBeDefined()
    expect(catalog.sources).toBeDefined()
  })

  it('should separate sources from nodes', () => {
    const graph = createSimpleGraph()
    const catalog = exporter.toCatalog(graph, { projectName: 'test_project' })

    // Source nodes should be in sources
    const sourceKeys = Object.keys(catalog.sources)
    expect(sourceKeys.length).toBe(1)
    expect(sourceKeys[0]).toContain('source.test_project.raw_orders')

    // Non-source nodes should be in nodes
    const nodeKeys = Object.keys(catalog.nodes)
    expect(nodeKeys.length).toBe(3) // transform + entity + sink
  })

  it('should extract column information from metadata', () => {
    const graph = createSimpleGraph()
    const catalog = exporter.toCatalog(graph, { projectName: 'test_project' })

    // Check source columns
    const sourceId = Object.keys(catalog.sources)[0]
    const source = catalog.sources[sourceId]
    expect(Object.keys(source.columns)).toHaveLength(3)
    expect(source.columns.id).toBeDefined()
    expect(source.columns.id.type).toBe('INTEGER')
    expect(source.columns.id.index).toBe(1)

    // Check entity columns (from outputSchema)
    const entityNodeId = Object.keys(catalog.nodes).find((k) => k.includes('fct_orders'))
    if (entityNodeId) {
      const entity = catalog.nodes[entityNodeId]
      expect(Object.keys(entity.columns)).toHaveLength(4)
      expect(entity.columns.order_id).toBeDefined()
      expect(entity.columns.order_id.comment).toBe('Unique order identifier')
    }
  })

  it('should include statistics when enabled', () => {
    const graph = createSimpleGraph()
    const catalog = exporter.toCatalog(graph, {
      projectName: 'test_project',
      includeStats: true,
    })

    // Check entity with rowCount and bytes
    const entityNodeId = Object.keys(catalog.nodes).find((k) => k.includes('fct_orders'))
    if (entityNodeId) {
      const entity = catalog.nodes[entityNodeId]
      expect(entity.stats.row_count).toBeDefined()
      expect(entity.stats.row_count?.value).toBe(5000)
      expect(entity.stats.bytes).toBeDefined()
      expect(entity.stats.bytes?.value).toBe(2048000)
    }
  })

  it('should respect database and schema options', () => {
    const graph = createSimpleGraph()
    const catalog = exporter.toCatalog(graph, {
      projectName: 'test_project',
      database: 'analytics',
      defaultSchema: 'dbt_prod',
    })

    const nodeId = Object.keys(catalog.nodes)[0]
    const node = catalog.nodes[nodeId]
    expect(node.metadata.database).toBe('analytics')
    // Nodes with explicit namespace should use that, others use default
    const sourceId = Object.keys(catalog.sources)[0]
    const source = catalog.sources[sourceId]
    expect(source.metadata.schema).toBe('staging') // From node's namespace
  })

  it('should handle empty graph', () => {
    const emptyGraph: LineageGraph = { nodes: [], edges: [], rootId: '' }
    const catalog = exporter.toCatalog(emptyGraph, { projectName: 'test' })

    expect(Object.keys(catalog.nodes)).toHaveLength(0)
    expect(Object.keys(catalog.sources)).toHaveLength(0)
    expect(catalog.metadata.generated_at).toBeDefined()
  })
})

// =============================================================================
// MANIFEST GENERATION TESTS
// =============================================================================

describe('DbtDocsExporter - Manifest Generation', () => {
  let exporter: DbtDocsExporter

  beforeEach(() => {
    exporter = createDbtDocsExporter()
  })

  it('should generate valid manifest structure', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, { projectName: 'test_project' })

    expect(manifest.metadata).toBeDefined()
    expect(manifest.metadata.dbt_schema_version).toContain('schemas.getdbt.com')
    expect(manifest.metadata.project_name).toBe('test_project')
    expect(manifest.nodes).toBeDefined()
    expect(manifest.sources).toBeDefined()
    expect(manifest.exposures).toBeDefined()
    expect(manifest.parent_map).toBeDefined()
    expect(manifest.child_map).toBeDefined()
  })

  it('should map sink nodes to exposures', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, { projectName: 'test_project' })

    const exposureKeys = Object.keys(manifest.exposures)
    expect(exposureKeys.length).toBe(1)

    const exposure = manifest.exposures[exposureKeys[0]]
    expect(exposure.resource_type).toBe('exposure')
    expect(exposure.name).toBe('orders_dashboard')
    expect(exposure.type).toBe('dashboard')
    expect(exposure.owner.name).toBe('Analytics Team')
    expect(exposure.owner.email).toBe('analytics@example.com')
    expect(exposure.url).toBe('https://bi.example.com/dashboards/orders')
    expect(exposure.maturity).toBe('high')
  })

  it('should build correct parent_map and child_map', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, { projectName: 'test_project' })

    // Find node IDs
    const sourceId = Object.keys(manifest.sources)[0]
    const transformId = Object.keys(manifest.nodes).find((k) => k.includes('stg_orders'))!
    const entityId = Object.keys(manifest.nodes).find((k) => k.includes('fct_orders'))!
    const exposureId = Object.keys(manifest.exposures)[0]

    // Check parent_map
    expect(manifest.parent_map[transformId]).toContain(sourceId)
    expect(manifest.parent_map[entityId]).toContain(transformId)
    expect(manifest.parent_map[exposureId]).toContain(entityId)

    // Check child_map
    expect(manifest.child_map[sourceId]).toContain(transformId)
    expect(manifest.child_map[transformId]).toContain(entityId)
    expect(manifest.child_map[entityId]).toContain(exposureId)
  })

  it('should handle complex DAG with multiple parents', () => {
    const graph = createComplexGraph()
    const manifest = exporter.toManifest(graph, { projectName: 'ecommerce' })

    // int_order_items should have two parents (stg_orders and stg_products)
    const intOrderItemsId = Object.keys(manifest.nodes).find((k) => k.includes('int_order_items'))!
    expect(manifest.parent_map[intOrderItemsId]).toHaveLength(2)

    // sales_dashboard exposure should have two parents (fct_orders and dim_customers)
    const dashboardId = Object.keys(manifest.exposures)[0]
    expect(manifest.parent_map[dashboardId]).toHaveLength(2)
  })

  it('should include model configurations', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, {
      projectName: 'test_project',
      defaultMaterialization: 'view',
    })

    // Check transformation node (should be view from metadata)
    const transformId = Object.keys(manifest.nodes).find((k) => k.includes('stg_orders'))!
    const transform = manifest.nodes[transformId]
    expect(transform.config.materialized).toBe('view')
    expect(transform.config.enabled).toBe(true)

    // Check entity node (should be table from metadata)
    const entityId = Object.keys(manifest.nodes).find((k) => k.includes('fct_orders'))!
    const entity = manifest.nodes[entityId]
    expect(entity.config.materialized).toBe('table')
    expect(entity.config.tags).toContain('core')
    expect(entity.config.tags).toContain('finance')
  })

  it('should include SQL when enabled', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, {
      projectName: 'test_project',
      includeRawSql: true,
    })

    const transformId = Object.keys(manifest.nodes).find((k) => k.includes('stg_orders'))!
    const transform = manifest.nodes[transformId]
    expect(transform.raw_sql).toContain('SELECT')
    expect(transform.raw_sql).toContain('raw_orders')
  })

  it('should set depends_on for nodes', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, { projectName: 'test_project' })

    // Entity should depend on transform
    const entityId = Object.keys(manifest.nodes).find((k) => k.includes('fct_orders'))!
    const entity = manifest.nodes[entityId]
    expect(entity.depends_on.nodes.length).toBe(1)
    expect(entity.depends_on.nodes[0]).toContain('stg_orders')

    // Exposure should depend on entity
    const exposureId = Object.keys(manifest.exposures)[0]
    const exposure = manifest.exposures[exposureId]
    expect(exposure.depends_on.nodes.length).toBe(1)
    expect(exposure.depends_on.nodes[0]).toContain('fct_orders')
  })

  it('should generate correct file paths', () => {
    const graph = createSimpleGraph()
    const manifest = exporter.toManifest(graph, { projectName: 'test_project' })

    const transformId = Object.keys(manifest.nodes).find((k) => k.includes('stg_orders'))!
    const transform = manifest.nodes[transformId]
    expect(transform.path).toContain('models/')
    expect(transform.path).toContain('staging/')
    expect(transform.path).toContain('.sql')
  })
})

// =============================================================================
// DOCS BUNDLE TESTS
// =============================================================================

describe('DbtDocsExporter - Docs Bundle', () => {
  let exporter: DbtDocsExporter

  beforeEach(() => {
    exporter = createDbtDocsExporter()
  })

  it('should generate complete docs bundle', () => {
    const graph = createSimpleGraph()
    const bundle = exporter.toDocsBundle(graph, {
      projectName: 'analytics',
      version: '2.0.0',
    })

    expect(bundle.catalog).toBeDefined()
    expect(bundle.manifest).toBeDefined()
    expect(bundle.project.name).toBe('analytics')
    expect(bundle.project.version).toBe('2.0.0')
    expect(bundle.generatedAt).toBeDefined()
  })

  it('should use consistent timestamps and invocation IDs', () => {
    const graph = createSimpleGraph()
    const bundle = exporter.toDocsBundle(graph, { projectName: 'test' })

    // Timestamps should match
    expect(bundle.catalog.metadata.generated_at).toBe(bundle.manifest.metadata.generated_at)
    expect(bundle.catalog.metadata.generated_at).toBe(bundle.generatedAt)

    // Invocation IDs should match
    expect(bundle.catalog.metadata.invocation_id).toBe(bundle.manifest.metadata.invocation_id)
  })

  it('should pass through shared options', () => {
    const graph = createSimpleGraph()
    const bundle = exporter.toDocsBundle(graph, {
      projectName: 'shared_project',
      database: 'shared_db',
      defaultSchema: 'shared_schema',
      dbtVersion: '1.5.0',
    })

    expect(bundle.catalog.metadata.dbt_version).toBe('1.5.0')
    expect(bundle.manifest.metadata.dbt_version).toBe('1.5.0')
    expect(bundle.manifest.metadata.project_name).toBe('shared_project')
  })
})

// =============================================================================
// LINEAGE GRAPH EXPORT TESTS
// =============================================================================

describe('DbtDocsExporter - Lineage Graph', () => {
  let exporter: DbtDocsExporter

  beforeEach(() => {
    exporter = createDbtDocsExporter()
  })

  it('should generate lineage graph structure', () => {
    const graph = createSimpleGraph()
    const lineage = exporter.toLineageGraph(graph, { projectName: 'test' })

    expect(lineage.nodes).toHaveLength(4)
    expect(lineage.edges).toHaveLength(3)
  })

  it('should include depends_on and depended_on_by', () => {
    const graph = createSimpleGraph()
    const lineage = exporter.toLineageGraph(graph, { projectName: 'test' })

    // Find transform node
    const transformNode = lineage.nodes.find((n) => n.name === 'stg_orders')!
    expect(transformNode.depends_on).toHaveLength(1) // depends on source
    expect(transformNode.depended_on_by).toHaveLength(1) // entity depends on it

    // Source should have no dependencies
    const sourceNode = lineage.nodes.find((n) => n.name === 'raw_orders')!
    expect(sourceNode.depends_on).toHaveLength(0)
    expect(sourceNode.depended_on_by).toHaveLength(1)

    // Sink should have no dependents
    const sinkNode = lineage.nodes.find((n) => n.name === 'orders_dashboard')!
    expect(sinkNode.depends_on).toHaveLength(1)
    expect(sinkNode.depended_on_by).toHaveLength(0)
  })

  it('should map node types to dbt resource types', () => {
    const graph = createSimpleGraph()
    const lineage = exporter.toLineageGraph(graph, { projectName: 'test' })

    const sourceNode = lineage.nodes.find((n) => n.name === 'raw_orders')!
    expect(sourceNode.resourceType).toBe('source')

    const transformNode = lineage.nodes.find((n) => n.name === 'stg_orders')!
    expect(transformNode.resourceType).toBe('model')

    const entityNode = lineage.nodes.find((n) => n.name === 'fct_orders')!
    expect(entityNode.resourceType).toBe('model')

    const sinkNode = lineage.nodes.find((n) => n.name === 'orders_dashboard')!
    expect(sinkNode.resourceType).toBe('exposure')
  })

  it('should handle complex graph with fan-in and fan-out', () => {
    const graph = createComplexGraph()
    const lineage = exporter.toLineageGraph(graph, { projectName: 'test' })

    // int_order_items has fan-in (2 parents)
    const intNode = lineage.nodes.find((n) => n.name === 'int_order_items')!
    expect(intNode.depends_on).toHaveLength(2)

    // sales_dashboard has fan-in (2 parents)
    const dashboardNode = lineage.nodes.find((n) => n.name === 'sales_dashboard')!
    expect(dashboardNode.depends_on).toHaveLength(2)

    // stg_customers has fan-out (used by dim_customers and indirectly affects dashboard)
    const stgCustomersNode = lineage.nodes.find((n) => n.name === 'stg_customers')!
    expect(stgCustomersNode.depended_on_by).toHaveLength(1) // directly: dim_customers
  })
})

// =============================================================================
// JSON OUTPUT TESTS
// =============================================================================

describe('DbtDocsExporter - JSON Output', () => {
  let exporter: DbtDocsExporter

  beforeEach(() => {
    exporter = createDbtDocsExporter()
  })

  it('should output valid JSON for catalog', () => {
    const graph = createSimpleGraph()
    const json = exporter.catalogToJSON(graph, { projectName: 'test' })

    expect(() => JSON.parse(json)).not.toThrow()

    const parsed = JSON.parse(json)
    expect(parsed.metadata).toBeDefined()
    expect(parsed.nodes).toBeDefined()
    expect(parsed.sources).toBeDefined()
  })

  it('should output valid JSON for manifest', () => {
    const graph = createSimpleGraph()
    const json = exporter.manifestToJSON(graph, { projectName: 'test' })

    expect(() => JSON.parse(json)).not.toThrow()

    const parsed = JSON.parse(json)
    expect(parsed.metadata).toBeDefined()
    expect(parsed.nodes).toBeDefined()
    expect(parsed.sources).toBeDefined()
    expect(parsed.exposures).toBeDefined()
    expect(parsed.parent_map).toBeDefined()
    expect(parsed.child_map).toBeDefined()
  })

  it('should format JSON with proper indentation', () => {
    const graph = createSimpleGraph()
    const json = exporter.catalogToJSON(graph, { projectName: 'test' })

    // Should contain newlines and indentation
    expect(json).toContain('\n')
    expect(json).toContain('  ')
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('DbtDocsExporter - Edge Cases', () => {
  let exporter: DbtDocsExporter

  beforeEach(() => {
    exporter = createDbtDocsExporter()
  })

  it('should handle nodes without metadata', () => {
    const graph: LineageGraph = {
      nodes: [
        {
          id: 'minimal',
          type: 'entity',
          name: 'minimal_table',
          metadata: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      edges: [],
      rootId: 'minimal',
    }

    const catalog = exporter.toCatalog(graph, { projectName: 'test' })
    const manifest = exporter.toManifest(graph, { projectName: 'test' })

    expect(Object.keys(catalog.nodes)).toHaveLength(1)
    expect(Object.keys(manifest.nodes)).toHaveLength(1)
  })

  it('should handle special characters in names', () => {
    const graph: LineageGraph = {
      nodes: [
        {
          id: 'special',
          type: 'entity',
          name: 'table_with_underscores',
          namespace: 'schema-with-dashes',
          metadata: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      edges: [],
      rootId: 'special',
    }

    const manifest = exporter.toManifest(graph, { projectName: 'test' })
    const nodeId = Object.keys(manifest.nodes)[0]
    const node = manifest.nodes[nodeId]

    expect(node.name).toBe('table_with_underscores')
    expect(node.schema).toBe('schema-with-dashes')
  })

  it('should handle disconnected nodes', () => {
    const graph: LineageGraph = {
      nodes: [
        { id: 'a', type: 'entity', name: 'table_a', metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'b', type: 'entity', name: 'table_b', metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'c', type: 'entity', name: 'table_c', metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ],
      edges: [], // No edges - all disconnected
      rootId: 'a',
    }

    const manifest = exporter.toManifest(graph, { projectName: 'test' })

    // All nodes should have empty parent/child maps
    for (const nodeId of Object.keys(manifest.nodes)) {
      expect(manifest.parent_map[nodeId]).toEqual([])
      expect(manifest.child_map[nodeId]).toEqual([])
    }
  })

  it('should handle circular references gracefully', () => {
    // Note: Lineage graphs shouldn't have cycles, but test defensive handling
    const graph: LineageGraph = {
      nodes: [
        { id: 'a', type: 'entity', name: 'table_a', metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'b', type: 'entity', name: 'table_b', metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ],
      edges: [
        { id: 'e1', fromNodeId: 'a', toNodeId: 'b', operation: 'ref', metadata: {}, timestamp: Date.now() },
        { id: 'e2', fromNodeId: 'b', toNodeId: 'a', operation: 'ref', metadata: {}, timestamp: Date.now() },
      ],
      rootId: 'a',
    }

    // Should not throw
    const manifest = exporter.toManifest(graph, { projectName: 'test' })

    // Both nodes should appear as parents and children of each other
    const nodeAId = Object.keys(manifest.nodes).find((k) => k.includes('table_a'))!
    const nodeBId = Object.keys(manifest.nodes).find((k) => k.includes('table_b'))!

    expect(manifest.parent_map[nodeAId]).toContain(nodeBId)
    expect(manifest.parent_map[nodeBId]).toContain(nodeAId)
  })

  it('should handle very large graphs', () => {
    // Generate a graph with 100 nodes in a chain
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []

    for (let i = 0; i < 100; i++) {
      nodes.push({
        id: `node-${i}`,
        type: i === 0 ? 'source' : i === 99 ? 'sink' : 'entity',
        name: `table_${i}`,
        namespace: 'test',
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      if (i > 0) {
        edges.push({
          id: `edge-${i}`,
          fromNodeId: `node-${i - 1}`,
          toNodeId: `node-${i}`,
          operation: 'transform',
          metadata: {},
          timestamp: Date.now(),
        })
      }
    }

    const graph: LineageGraph = { nodes, edges, rootId: 'node-0' }

    // Should complete without error
    const manifest = exporter.toManifest(graph, { projectName: 'test' })

    expect(Object.keys(manifest.sources)).toHaveLength(1)
    expect(Object.keys(manifest.exposures)).toHaveLength(1)
    expect(Object.keys(manifest.nodes)).toHaveLength(98) // 100 - 1 source - 1 sink
  })
})

// =============================================================================
// FACTORY FUNCTION TESTS
// =============================================================================

describe('createDbtDocsExporter', () => {
  it('should create a new exporter instance', () => {
    const exporter = createDbtDocsExporter()
    expect(exporter).toBeInstanceOf(DbtDocsExporter)
  })

  it('should create independent instances', () => {
    const exporter1 = createDbtDocsExporter()
    const exporter2 = createDbtDocsExporter()
    expect(exporter1).not.toBe(exporter2)
  })
})
